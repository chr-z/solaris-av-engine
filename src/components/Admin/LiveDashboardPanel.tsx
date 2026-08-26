// Solaris v3 — Feature Pack "Analista Feliz" — F5 Dashboard ao vivo (UI).
//
// Painel renderizado dentro do AdminGate (rota #/admin/dashboards), atrás de
// um toggle "Ao vivo / Planilhas". Toda a matemática vem de utils/liveDashboard
// (pura); este componente só orquestra: carrega dataset, mantém feed via SSE
// com fallback de polling 5s, monta opções ECharts lazy e aplica os papéis.
//
// Guardrails (spec E): chunk pesado (echarts) só carrega quando a aba abre;
// métricas individuais filtradas por papel; sem rede obrigatória — o dataset
// local + demo fallback mantêm o painel vivo offline.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildAnalystCards,
  buildAnalystDrilldown,
  buildAnalystQuality,
  buildAnalystQualityFull,
  buildLiveKpis,
  buildSlaSummary,
  buildThroughputByDay,
  buildThroughputByHour,
  mergeFeed,
  visibleQualityRows,
  type AnalystActivity,
  type AnalystDrilldown,
  type FeedEvent,
  type LiveKpis,
} from '../../utils/liveDashboard';
import { SAO_PAULO_CLOCK, localDayKey } from '../../features/gamification/periods';
import { canManageQueue, canReadIndividualMetrics, type UserContext } from '../../features/db/roles';
import { suggestNext, type QueueRowLike } from '../../features/qol/queue';
import {
  makeAssign,
  makeReturn,
  makePrioritize,
  type QueueActionEvent,
  applyInverse,
  QUEUE_PRIORITIES,
} from '../../features/qol/queueActions';
import { getUndoLog } from '../../features/qol/undoStore';
import type { XpEventLike } from '../../features/gamification/xp';
import QueueBulkBar from './QueueBulkBar';
import QueueImportExportBar from './QueueImportExportBar';
import {
  applyImportInverse,
} from '../../features/qol/queueImport';
import { registerUndoApplier, applyUndo } from '../../features/qol/undoApply';
import type { UndoEvent } from '../../features/qol/undo';
import type { Dataset } from '../../utils/dashboard';
import { buildDashboardDataset } from '../../utils/dashboard';
import {
  loadDashboardEntries,
  type DashboardEntryInput,
} from '../../utils/dashboardData';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';

const REFRESH_MS = 5_000;

/** Estado mínimo do usuário logado p/ papéis (App guarda UserProfile). */
interface ViewerInput {
  id: string;
  name: string;
}

export interface LiveDashboardPanelProps {
  /** Entradas da planilha já carregadas pelo DashboardPanel (evita refetch). */
  entries?: DashboardEntryInput[];
  /** Usuário logado (id/name) para escopo de papel; null = visitante. */
  viewer: ViewerInput | null;
  /** Papel efetivo; default 'admin' (AdminGate só deixa admin passar hoje). */
  role?: UserContext['role'];
  /** Snapshots de fila em análise (futuro: tabela os_queue real). */
  queue?: Array<{
    osId: string;
    status: 'queued' | 'in_analysis' | 'done';
    assignee?: string | null;
    startedAtMs?: number | null;
  }>;
  /** Fila completa p/ o card de sugestão + ações com undo (spec A1/A3). */
  queueRows?: QueueRowLike[];
  /** Callback de mudança na fila (atribuir/devolver/priorizar/desfazer). */
  onQueueChange?: (rows: QueueRowLike[]) => void;
  /** Fonte de atividades por analista (futura: xp_events/os_queue reais). */
  activities?: AnalystActivity[];
  /** Injetável p/ testes e p/ futuras fontes de eventos. */
  fetchEvents?: () => Promise<FeedEvent[]>;
  nowMs?: number;
}

const PRESENCE_DOT: Record<string, string> = {
  analyzing: '🟢',
  recent: '🟢',
  idle: '🟡',
  offline: '⚪',
};

type TranslateFn = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

/** "Por quê esta?" — rótulo legível do motivo da sugestão (spec A1). */
function queueReasonLabel(
  suggestion: ReturnType<typeof suggestNext>,
  t: TranslateFn,
): string {
  switch (suggestion.reason) {
    case 'overdue':
      return t('dash.live.reasonOverdue', { h: String(suggestion.overdueHours ?? 0) });
    case 'priority-flagged':
      return t('dash.live.reasonPriority');
    case 'newest':
      return t('dash.live.reasonNewest');
    case 'oldest-queued':
      return t('dash.live.reasonOldest');
    case 'already-in-progress':
      return t('dash.live.reasonInProgress');
    case 'empty':
      return t('dash.live.queueEmpty');
  }
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Nota formatada no locale ativo (pt-BR usa vírgula). */
function fmtScore(v: number, pt: boolean): string {
  const fixed = v.toFixed(1);
  return pt ? fixed.replace('.', ',') : fixed;
}

function KpiCard({
  label,
  value,
  sub,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <div
      data-testid={testId ?? 'live-kpi'}
      className="rounded-lg border border-gray-600/60 bg-gray-800/50 px-4 py-3 min-w-[8rem]"
    >
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-2xl font-bold text-gray-100">{value}</p>
      {sub != null && sub !== '' && (
        <p className="mt-1 text-xs text-gray-500">{sub}</p>
      )}
    </div>
  );
}

export default function LiveDashboardPanel({
  entries,
  viewer,
  role = 'admin',
  queue,
  queueRows = [],
  onQueueChange,
  activities,
  fetchEvents,
  nowMs,
}: LiveDashboardPanelProps): React.ReactElement {
  const { t, locale } = useI18n();
  const language = locale as string;
  const [ownEntries, setOwnEntries] = useState<DashboardEntryInput[]>(
    entries ?? [],
  );
  const [source, setSource] = useState<'live' | 'demo'>('demo');
  const [loaded, setLoaded] = useState(false);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  // Dataset: usa entradas herdadas ou carrega as próprias (uma vez).
  useEffect(() => {
    if (entries && entries.length > 0) {
      setOwnEntries(entries);
      setLoaded(true);
      return undefined;
    }
    if (loaded || ownEntries.length > 0) return undefined;
    let cancelled = false;
    loadDashboardEntries({ maxRows: 200 }).then((res) => {
      if (cancelled) return;
      setOwnEntries(res.entries);
      setSource(res.source);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [entries, loaded, ownEntries.length]);

  const viewerCtx: UserContext = useMemo(
    () => ({
      userId: viewer?.id ?? 'guest',
      role,
      seniority: 'senior', // painel é admin-only hoje; seniority não afeta visão
    }),
    [viewer?.id, role],
  );

  // ── F2: fila inteligente com ações + undo global (spec A1/A3) ─────────
  // queueRows default [] cria array NOVO por render — sincronizar por
  // CONTEÚDO. Ajuste na FASE DE RENDER (padrão oficial p/ estado derivado
  // de props): sem effect ⇒ sem cascata e sem setState-in-effect.
  const [queueState, setQueueState] = useState<QueueRowLike[]>(queueRows);
  const [queueKey, setQueueKey] = useState(() => JSON.stringify(queueRows));
  const nextQueueKey = JSON.stringify(queueRows);
  if (nextQueueKey !== queueKey) {
    setQueueKey(nextQueueKey);
    setQueueState(JSON.parse(nextQueueKey) as QueueRowLike[]);
  }

  const commitQueue = useCallback(
    (rows: QueueRowLike[]) => {
      setQueueState(rows);
      onQueueChange?.(rows);
    },
    [onQueueChange],
  );

  const dataset: Dataset = useMemo(
    () => buildDashboardDataset(ownEntries),
    [ownEntries],
  );

  // Fila real entra no dataset p/ tempo médio por O.S. (B2) — o mesmo array
  // que alimenta sugestão/ações; a planilha sozinha não inventa tempo.
  const datasetWithQueue: Dataset = useMemo(
    () => ({ ...dataset, queueRows: queueState }),
    [dataset, queueState],
  );

  // Relógio: agora real (ou injetado), atualizado a cada tick de refresh.
  const [tickNow, setTickNow] = useState(nowMs ?? Date.now());
  useEffect(() => {
    if (nowMs != null) {
      setTickNow(nowMs);
      return undefined;
    }
    const id = window.setInterval(() => setTickNow(Date.now()), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [nowMs]);

  // Undo das ações de fila: registra o applier dos 4 kinds enquanto o
  // painel vive; Ctrl+Z global (App) resolve via applyUndo → este applier.
  // Re-registra a cada mutação da fila (closure sempre fresca).
  const queueApplier = useCallback(
    (event: UndoEvent): boolean => {
      if (event.kind === 'import-queue') {
        // Snapshot: desfazer importação = remover as linhas adicionadas.
        const imported = (event.payload as { rows?: unknown }).rows;
        if (!Array.isArray(imported)) return false;
        const { rows, changed } = applyImportInverse(queueState, {
          rows: imported as QueueRowLike[],
        });
        if (changed) commitQueue(rows);
        return changed;
      }
      if (
        event.kind !== 'assign-os' &&
        event.kind !== 'return-os' &&
        event.kind !== 'prioritize-os'
      ) {
        return false;
      }
      if (!('prev' in event.payload)) return false;
      const { rows, changed } = applyInverse(
        queueState,
        event as unknown as Parameters<typeof applyInverse>[1],
      );
      if (changed) commitQueue(rows);
      return changed;
    },
    [queueState, commitQueue],
  );
  useEffect(() => {
    const unregisters = ([
      'assign-os',
      'return-os',
      'prioritize-os',
      'import-queue',
    ] as const).map((kind) => registerUndoApplier(kind, queueApplier));
    return () => unregisters.forEach((un) => un());
  }, [queueApplier]);

  /** Botão "Desfazer": topo da pilha se for ação DE fila deste painel. */
  const lastQueueEventId = useMemo(() => {
    const log = getUndoLog();
    for (let i = log.undoable.length - 1; i >= 0; i--) {
      const e = log.undoable[i];
      if (e.kind === 'import-queue') {
        const rows = (e.payload as { rows?: unknown }).rows;
        if (
          Array.isArray(rows) &&
          rows.some(
            (r) =>
              r !== null && typeof r === 'object' &&
              typeof (r as { os_id?: unknown }).os_id === 'string' &&
              queueState.some((q) => q.os_id === (r as { os_id: string }).os_id),
          )
        ) {
          return e.id;
        }
        continue;
      }
      if (
        (e.kind === 'assign-os' || e.kind === 'return-os' || e.kind === 'prioritize-os') &&
        typeof e.payload.osId === 'string' &&
        queueState.some((r) => r.os_id === e.payload.osId)
      ) {
        return e.id;
      }
    }
    return null;
    // Recalcula a cada mutação da fila (log é externo ao estado do React).
  }, [queueState]);

  const suggestion = useMemo(() => suggestNext(queueState, { now: tickNow }), [queueState, tickNow]);
  const canManage = useMemo(() => canManageQueue(viewerCtx), [viewerCtx]);

  /** Executa uma ação do núcleo puro: aplica a linha nova e grava o undo. */
  const runAction = useCallback(
    (
      make: (
        row: QueueRowLike,
      ) =>
        | { ok: true; row: QueueRowLike; event: UndoEvent }
        | { ok: false; reason: string },
      osId: string,
    ): void => {
      const target = queueState.find((r) => r.os_id === osId);
      if (!target || !canManage) return;
      const res = make(target);
      if (!res.ok) return;
      commitQueue(queueState.map((r) => (r.os_id === osId ? res.row : r)));
      getUndoLog().record(res.event.kind, res.event.label, res.event.payload);
    },
    [queueState, canManage, commitQueue],
  );

  /** Botão Desfazer: reverte o evento de fila no topo (se houver). */
  const handleUndoClick = useCallback(() => {
    applyUndo(getUndoLog());
  }, []);

  /** Bulk: aplica linhas novas e grava um evento de undo por linha alterada. */
  const handleBulkApply = useCallback(
    (nextRows: QueueRowLike[], events: QueueActionEvent[]) => {
      commitQueue(nextRows);
      for (const ev of events) getUndoLog().record(ev.kind, ev.label, ev.payload);
    },
    [commitQueue],
  );

  /** Import A3: anexa as linhas novas e grava UM evento snapshot de undo. */
  const handleImport = useCallback(
    (nextRows: QueueRowLike[], imported: QueueRowLike[]) => {
      commitQueue(nextRows);
      getUndoLog().record('import-queue', `+${imported.length} OSs`, { rows: imported });
    },
    [commitQueue],
  );

  const todayKey = useMemo(
    () => localDayKey(tickNow, SAO_PAULO_CLOCK),
    [tickNow],
  );

  const kpis: LiveKpis = useMemo(
    () => buildLiveKpis(dataset, { todayKey, queue }),
    [dataset, todayKey, queue],
  );

  // B1 "SLA médio": da fila viva — média de conclusão + atraso sobre prazo.
  const sla = useMemo(
    () => buildSlaSummary(queueState, { now: tickNow }),
    [queueState, tickNow],
  );
  const slaSub: string = useMemo(() => {
    if (sla.overdueCount > 0) {
      return t('dash.live.kpiSlaOverdue', {
        n: String(sla.overdueCount),
        h: String(sla.avgOverdueHours ?? 0),
      });
    }
    return t('dash.live.kpiSlaOnTime');
  }, [sla, t]);
  const slaValue: string =
    sla.avgCompletionHours != null
      ? t('dash.live.kpiSlaHours', { h: String(sla.avgCompletionHours) })
      : '—';

  const throughputDays = useMemo(
    () =>
      buildThroughputByDay(dataset.records, {
        endDayKey: todayKey,
        days: 14,
      }),
    [dataset, todayKey],
  );

  // Eventos XP do perfil local alimentam o throughput por hora (offline-first).
  const hourEvents = useMemo(() => {
    try {
      const raw = window.localStorage.getItem('solaris.gamification.events');
      if (!raw) return [] as Array<{ ts: number }>;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e): e is { ts: number } =>
          typeof e === 'object' && e !== null && typeof (e as { ts?: unknown }).ts === 'number',
      );
    } catch {
      return [];
    }
    // relê uma vez por montagem; feed ao vivo cobre o resto
  }, []);

  const hourlyOptions = useMemo(() => {
    const points = buildThroughputByHour(hourEvents);
    const peakHour = points.reduce(
      (best, p) => (p.count > points[best].count ? points.indexOf(p) : best),
      0,
    );
    return {
      grid: { left: 40, right: 16, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: points.map((p) => `${String(p.hour).padStart(2, '0')}h`) },
      yAxis: { type: 'value', minInterval: 1 },
      tooltip: { trigger: 'axis' },
      series: [
        {
          type: 'bar',
          data: points.map((p, i) => ({
            value: p.count,
            itemStyle: i === peakHour && p.count > 0 ? { color: '#359aff' } : undefined,
          })),
        },
      ],
    };
  }, [hourEvents]);

  const dailyOptions = useMemo(() => {
    const peakIdx = throughputDays.reduce(
      (best, p, i) => (p.count > throughputDays[best].count ? i : best),
      0,
    );
    return {
      grid: { left: 40, right: 16, top: 28, bottom: 28 },
      xAxis: {
        type: 'category',
        data: throughputDays.map((p) => p.dayKey.slice(5)), // 'MM-DD'
      },
      yAxis: { type: 'value', minInterval: 1 },
      tooltip: { trigger: 'axis' },
      series: [
        {
          type: 'bar',
          data: throughputDays.map((p, i) => ({
            value: p.count,
            itemStyle:
              i === peakIdx && p.count > 0 ? { color: '#359aff' } : undefined,
          })),
        },
      ],
    };
  }, [throughputDays]);

  // Atividades: derivadas do dataset (analistas que aparecem hoje) quando não
  // injetadas — presença honesta com o que existe localmente.
  const effectiveActivities: AnalystActivity[] = useMemo(() => {
    if (activities) return activities;
    const names = new Set<string>();
    for (const r of dataset.records) {
      if (r.analyst && r.date === todayKey) names.add(r.analyst);
    }
    return [...names].map((name) => ({
      userId: name,
      name,
      lastActiveMs: null,
      analyzingOsId: null,
    }));
  }, [activities, dataset, todayKey]);

  const cards = useMemo(
    () =>
      buildAnalystCards(effectiveActivities, datasetWithQueue, {
        todayKey,
        nowMs: tickNow,
      }),
    [effectiveActivities, datasetWithQueue, todayKey, tickNow],
  );

  // B3 completo: planilha cruzada com auditoria (eventos XP persistidos) e
  // tempo real da fila. Papéis continuam no gate (visibleQualityRows).
  const auditEvents = useMemo(() => {
    const out: XpEventLike[] = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key || !key.startsWith('solaris.gamification.profile.')) continue;
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw) as { events?: unknown };
          if (!Array.isArray(parsed.events)) continue;
          for (const e of parsed.events) {
            if (
              e !== null && typeof e === 'object' &&
              typeof (e as { userId?: unknown }).userId === 'string' &&
              typeof (e as { amount?: unknown }).amount === 'number' &&
              typeof (e as { reason?: unknown }).reason === 'string' &&
              typeof (e as { ts?: unknown }).ts === 'number'
            ) {
              out.push(e as unknown as XpEventLike);
            }
          }
        } catch {
          /* perfil corrupto: ignora, nunca derruba o painel */
        }
      }
    } catch {
      /* storage indisponível: painel segue só com a planilha */
    }
    return out;
    // relê uma vez por montagem (mesma linha do hourEvents)
  }, []);
  const qualityAllFull = useMemo(
    () => buildAnalystQualityFull(dataset, { events: auditEvents, queueRows: queueState }),
    [dataset, auditEvents, queueState],
  );
  const qualityVisible = useMemo(
    () => visibleQualityRows(qualityAllFull, viewerCtx),
    [qualityAllFull, viewerCtx],
  );
  const canSeeIndividual = canReadIndividualMetrics(viewerCtx);

  // B2 drill-down: analista selecionado num card (null = visão geral).
  const [drillUserId, setDrillUserId] = useState<string | null>(null);
  const openDrill = useCallback((id: string) => setDrillUserId(id), []);
  const closeDrill = useCallback(() => setDrillUserId(null), []);

  const drilldown: AnalystDrilldown | null = useMemo(
    () =>
      drillUserId == null
        ? null
        : buildAnalystDrilldown(effectiveActivities, datasetWithQueue, {
            userId: drillUserId,
            todayKey,
            nowMs: tickNow,
          }),
    [drillUserId, effectiveActivities, datasetWithQueue, todayKey, tickNow],
  );

  // Feed: SSE próprio com fallback polling 5s; injetável em testes.
  const pullEvents = useCallback(async (): Promise<FeedEvent[]> => {
    if (fetchEvents) return fetchEvents();
    try {
      const res = await fetch('/api/dashboard-events?since=0');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { events?: FeedEvent[] };
      return Array.isArray(body.events) ? body.events : [];
    } catch {
      return []; // offline: feed fica vazio, painel segue inteiro
    }
  }, [fetchEvents]);

  useEffect(() => {
    let cancelled = false;
    let usingPolling = false;
    let backoffMs = REFRESH_MS;

    const startPolling = (): void => {
      if (usingPolling || cancelled) return;
      usingPolling = true;
      const loop = async (): Promise<void> => {
        while (!cancelled) {
          const evts = await pullEvents();
          if (!cancelled && evts.length > 0) setFeed((prev) => mergeFeed(prev, evts));
          await new Promise<void>((r) => window.setTimeout(r, backoffMs));
        }
      };
      void loop();
    };

    const connect = (): void => {
      if (typeof EventSource === 'undefined') {
        startPolling();
        return;
      }
      try {
        const es = new EventSource('/api/dashboard-events');
        sseRef.current = es;
        es.onopen = () => {
          if (!cancelled) setSseConnected(true);
        };
        es.onmessage = (msg: MessageEvent<string>) => {
          if (cancelled) return;
          try {
            const parsed = JSON.parse(msg.data) as FeedEvent;
            if (parsed && typeof parsed.id === 'string') {
              setFeed((prev) => mergeFeed(prev, [parsed]));
            }
          } catch {
            /* payload inválido: ignora mensagem */
          }
        };
        es.onerror = () => {
          es.close();
          sseRef.current = null;
          if (!cancelled) {
            setSseConnected(false);
            backoffMs = Math.min(backoffMs * 2, 60_000);
            startPolling();
          }
        };
      } catch {
        startPolling();
      }
    };

    connect();
    return () => {
      cancelled = true;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [pullEvents]);

  const drillLabel = (analyst: string): string => analyst;

  return (
    <section
      aria-label={t('dash.live.title')}
      data-testid="live-dashboard"
      className="mt-4 space-y-6"
    >
      {/* Cabeçalho: fonte dos dados + status do canal ao vivo */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-100">
          {t('dash.live.title')}
        </h2>
        <span
          data-testid="live-source"
          className="rounded-full border border-gray-600/60 px-2 py-0.5 text-xs text-gray-400"
        >
          {source === 'live'
            ? t('dash.live.sourceLive')
            : t('dash.live.sourceDemo')}
        </span>
        <span
          data-testid="live-channel"
          className={`rounded-full px-2 py-0.5 text-xs ${
            sseConnected
              ? 'bg-green-500/20 text-green-300'
              : 'bg-gray-600/30 text-gray-400'
          }`}
        >
          {sseConnected ? t('dash.live.sseOn') : t('dash.live.sseOff')}
        </span>
        <span className="ml-auto text-xs text-gray-500">{fmtClock(tickNow)}</span>
      </div>

      {/* KPIs topo */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label={t('dash.live.kpiToday')}
          value={String(kpis.osToday)}
          sub={t('dash.live.kpiTodaySub', { done: String(kpis.completedToday) })}
          testId="live-kpi-today"
        />
        <KpiCard
          label={t('dash.live.kpiAnalyzing')}
          value={String(kpis.inAnalysis)}
          sub={kpis.inAnalysisWho.join(', ') || t('dash.live.nobody')}
          testId="live-kpi-analyzing"
        />
        <KpiCard
          label={t('dash.live.kpiQueue')}
          value={String(kpis.queuePending)}
          testId="live-kpi-queue"
        />
        <KpiCard
          label={t('dash.live.kpiAvg')}
          value={
            kpis.avgScore != null ? fmtScore(kpis.avgScore, language === 'pt') : '—'
          }
          testId="live-kpi-avg"
        />
        <KpiCard
          label={t('dash.live.kpiSla')}
          value={slaValue}
          sub={slaSub}
          testId="live-kpi-sla"
        />
      </div>

      {/* F2 — fila inteligente: próxima OS sugerida + ações com undo */}
      {queueState.length > 0 && (
        <div
          data-testid="live-queue-suggestion"
          className="rounded-lg border border-gray-600/60 bg-gray-800/40 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-gray-200">
              {t('dash.live.queueNext')}
            </h3>
            <span className="rounded-full bg-gray-600/30 px-2 py-0.5 text-xs text-gray-400">
              {t('dash.live.queueDepth', { n: String(suggestion.queueDepth) })}
            </span>
            {suggestion.row && canManage && (
              <button
                type="button"
                data-testid="queue-undo-btn"
                disabled={lastQueueEventId == null}
                onClick={handleUndoClick}
                title={lastQueueEventId ? t('dash.live.undoHint') : undefined}
                className={`ml-auto rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  lastQueueEventId != null
                    ? 'text-solar-accent hover:bg-solar-accent/10'
                    : 'cursor-not-allowed text-gray-600'
                }`}
              >
                ↩ {t('dash.live.undo')}
              </button>
            )}
          </div>
          {suggestion.row ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                data-testid="queue-suggestion-os"
                className="font-mono text-sm font-semibold text-gray-100"
              >
                {suggestion.row.os_id}
              </span>
              <span className="text-xs text-gray-500">·</span>
              <span data-testid="queue-suggestion-reason" className="text-xs text-gray-400">
                {queueReasonLabel(suggestion, t)}
              </span>
              {suggestion.row.title && (
                <span className="max-w-[16rem] truncate text-xs text-gray-400">
                  {suggestion.row.title}
                </span>
              )}
              {canManage && (
                <>
                  <span className="mx-1 h-4 w-px bg-gray-600/60" aria-hidden="true" />
                  <button
                    type="button"
                    data-testid="queue-assign-btn"
                    onClick={() =>
                      viewer &&
                      runAction((row) => makeAssign(row, viewer.id), suggestion.row!.os_id)
                    }
                    className="rounded-md px-2.5 py-1.5 text-xs text-green-300 transition-colors hover:bg-green-500/10"
                  >
                    {t('dash.live.assignMe', { who: viewer?.name ?? viewer?.id ?? '' })}
                  </button>
                  {(suggestion.row.claimed_by ?? suggestion.row.assignee) && (
                    <button
                      type="button"
                      data-testid="queue-return-btn"
                      onClick={() => runAction(makeReturn, suggestion.row!.os_id)}
                      className="rounded-md px-2.5 py-1.5 text-xs text-yellow-300 transition-colors hover:bg-yellow-500/10"
                    >
                      {t('dash.live.returnToQueue')}
                    </button>
                  )}
                  <select
                    aria-label={t('dash.live.priorityLabel')}
                    data-testid="queue-priority-select"
                    value={suggestion.row.priority}
                    onChange={(e) =>
                      runAction(
                        (row) => makePrioritize(row, Number(e.target.value)),
                        suggestion.row!.os_id,
                      )
                    }
                    className="rounded-md border border-gray-600/60 bg-transparent px-1.5 py-1 text-xs text-gray-300"
                  >
                    {QUEUE_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        P{p}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500">{t('dash.live.queueEmpty')}</p>
          )}
          {canManage && (
            <QueueBulkBar
              rows={queueState}
              now={tickNow}
              canManage={canManage}
              viewerId={viewer?.id ?? ''}
              labels={{
                title: t('dash.live.bulkTitle'),
                selectAllTop: t('dash.live.bulkSelectTop'),
                clear: t('dash.live.bulkClear'),
                selectedN: t('dash.live.bulkSelected'),
                applicableN: t('dash.live.bulkApplicable'),
                skippedN: t('dash.live.bulkSkipped'),
                assignMe: t('dash.live.bulkAssignMe'),
                returnToQueue: t('dash.live.bulkReturn'),
                priority: t('dash.live.bulkPriority'),
              }}
              onApply={handleBulkApply}
            />
          )}
        </div>
      )}
      {/* A3 — import/export da fila FORA do condicional: existe também com
          fila vazia (importar o primeiro lote é o caso de uso principal). */}
      {canManage && (
        <QueueImportExportBar
          rows={queueState}
          canManage={canManage}
          sheetName={t('dash.live.queueSheetName')}
          labels={{
            title: t('dash.live.ioTitle'),
            importFile: t('dash.live.ioImportFile'),
            exportCsv: t('dash.live.ioExportCsv'),
            exportXlsx: t('dash.live.ioExportXlsx'),
            addedN: t('dash.live.ioAdded'),
            skippedN: t('dash.live.ioSkipped'),
            reasonMissingOs: t('dash.live.ioReasonMissingOs'),
            reasonDuplicate: t('dash.live.ioReasonDuplicate'),
            reasonBadStatus: t('dash.live.ioReasonBadStatus'),
            reasonBadPriority: t('dash.live.ioReasonBadPriority'),
            reasonNoOsColumn: t('dash.live.ioReasonNoOsColumn'),
            readFailed: t('dash.live.ioReadFailed'),
          }}
          onImport={handleImport}
        />
      )}

      {/* Gráficos lazy: montam só quando a aba Ao vivo está ativa (este painel) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-gray-600/60 bg-gray-800/40 p-3">
          <h3 className="mb-2 text-sm font-medium text-gray-200">
            {t('dash.live.throughputDaily')}
          </h3>
          <LazyChartWithFallback option={dailyOptions} ariaLabel={t('dash.live.throughputDaily')} />
        </div>
        <div className="rounded-lg border border-gray-600/60 bg-gray-800/40 p-3">
          <h3 className="mb-2 text-sm font-medium text-gray-200">
            {t('dash.live.throughputHourly')}
          </h3>
          <LazyChartWithFallback option={hourlyOptions} ariaLabel={t('dash.live.throughputHourly')} />
        </div>
      </div>

      {/* Cards por analista + feed lateral */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h3 className="mb-2 text-sm font-medium text-gray-200">
            {t('dash.live.analysts')}
          </h3>
          <ul data-testid="live-analyst-cards" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {cards.map((c) => (
              <li key={c.userId} data-testid="live-analyst-card">
                <button
                  type="button"
                  onClick={() => openDrill(c.userId)}
                  title={t('dash.live.cardHint')}
                  aria-label={t('dash.live.openDrill', { name: c.name })}
                  className="w-full rounded-lg border border-gray-600/60 bg-gray-800/40 px-3 py-2 text-left transition-colors hover:border-sky-500/70 hover:bg-gray-800/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true">{PRESENCE_DOT[c.state] ?? '⚪'}</span>
                    <span className="truncate text-sm font-medium text-gray-100">
                      {c.name}
                    </span>
                    <span className="ml-auto text-xs text-gray-500">
                      {c.analyzingOsId
                        ? t('dash.live.workingOn', { os: c.analyzingOsId })
                        : ''}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                    <span>{t('dash.live.todayCount', { n: String(c.todayCount) })}</span>
                    <span>{t('dash.live.weekCount', { n: String(c.weekCount) })}</span>
                    {canSeeIndividual && c.avgGiven != null && (
                      <span>{t('dash.live.avgGiven', { score: fmtScore(c.avgGiven, language === 'pt') })}</span>
                    )}
                    {canSeeIndividual && c.avgHoursPerOs != null && (
                      <span>
                        {t('dash.live.avgHours', { h: String(c.avgHoursPerOs).replace('.', language === 'pt' ? ',' : '.') })}
                      </span>
                    )}
                  </span>
                  {(canSeeIndividual ? c.avgGiven == null : true) && c.todayCount === 0 && (
                    <span className="mt-1 block text-xs text-gray-600">{t('dash.live.noDataToday')}</span>
                  )}
                </button>
              </li>
            ))}
            {cards.length === 0 && (
              <li className="text-xs text-gray-500">{t('dash.live.nobody')}</li>
            )}
          </ul>
        </div>

        {/* Feed ao vivo */}
        <div className="rounded-lg border border-gray-600/60 bg-gray-800/40 p-3">
          <h3 className="mb-2 text-sm font-medium text-gray-200">
            {t('dash.live.feed')}
          </h3>
          <ul data-testid="live-feed" className="max-h-56 space-y-1 overflow-y-auto text-xs">
            {feed.map((e) => (
              <li key={e.id} className="rounded bg-gray-900/70 px-2 py-1.5 text-gray-300">
                {e.text}
                <span className="ml-1 text-gray-600">{fmtClock(e.ts)}</span>
              </li>
            ))}
            {feed.length === 0 && (
              <li className="text-gray-500">{t('dash.live.feedEmpty')}</li>
            )}
          </ul>
        </div>
      </div>

      {/* B2 drill-down: histórico completo do analista (substitui a visão geral) */}
      {drilldown && (
        <div
          data-testid="analyst-drilldown"
          className="rounded-lg border border-sky-500/40 bg-gray-800/40 p-4"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span aria-hidden="true">{PRESENCE_DOT[drilldown.state] ?? '⚪'}</span>
            <h3 className="text-base font-semibold text-gray-100">
              {t('dash.live.drillTitle', { name: drilldown.name })}
            </h3>
            {drilldown.analyzingOsId && (
              <span className="text-xs text-gray-400">
                {t('dash.live.workingOn', { os: drilldown.analyzingOsId })}
              </span>
            )}
            <button
              type="button"
              data-testid="drill-close"
              onClick={closeDrill}
              className="ml-auto rounded border border-gray-600/60 px-2 py-1 text-xs text-gray-300 hover:border-sky-500/70 hover:text-sky-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            >
              {t('dash.live.backToOverview')}
            </button>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <div className="rounded bg-gray-900/60 px-2 py-1.5">
              <dt className="text-gray-500">{t('dash.live.todayCount', { n: '' }).trim()}</dt>
              <dd className="text-sm font-semibold text-gray-100">{drilldown.todayCount}</dd>
            </div>
            <div className="rounded bg-gray-900/60 px-2 py-1.5">
              <dt className="text-gray-500">{t('dash.live.weekCount', { n: '' }).trim()}</dt>
              <dd className="text-sm font-semibold text-gray-100">{drilldown.weekCount}</dd>
            </div>
            <div className="rounded bg-gray-900/60 px-2 py-1.5">
              <dt className="text-gray-500">{t('dash.live.colAnalyzed')}</dt>
              <dd className="text-sm font-semibold text-gray-100">{drilldown.totalCount}</dd>
            </div>
            <div className="rounded bg-gray-900/60 px-2 py-1.5">
              <dt className="text-gray-500">{t('dash.live.colAvgScore')}</dt>
              <dd className="text-sm font-semibold text-gray-100">
                {drilldown.avgScore == null ? '—' : fmtScore(drilldown.avgScore, language === 'pt')}
              </dd>
            </div>
            <div className="rounded bg-gray-900/60 px-2 py-1.5">
              <dt className="text-gray-500">{t('dash.live.colAvgTime')}</dt>
              <dd className="text-sm font-semibold text-gray-100" data-testid="drill-avg-time">
                {!canSeeIndividual || drilldown.avgHoursPerOs == null
                  ? '—'
                  : t('dash.live.kpiSlaHours', {
                      h: String(drilldown.avgHoursPerOs).replace('.', language === 'pt' ? ',' : '.'),
                    })}
              </dd>
            </div>
          </dl>
          {canSeeIndividual ? (
            <p className="mt-2 text-[11px] text-gray-500">
              {t('dash.live.lastActivity')}{' '}
              {drilldown.lastActiveMs == null
                ? '—'
                : fmtClock(drilldown.lastActiveMs)}
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-gray-500">
              {t('dash.live.privacyHint')}
            </p>
          )}

          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                {t('dash.live.monthHistory')}
              </h4>
              <table data-testid="drill-months" className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">{t('dash.trend.month')}</th>
                    <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">{t('dash.live.colAnalyzed')}</th>
                    <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">{t('dash.live.colAvgScore')}</th>
                    <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">{t('dash.live.colMarks')}</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.months.map((m) => (
                    <tr key={m.monthKey} className="border-t border-gray-700/60 text-gray-300">
                      <td className="py-1.5 pr-3">{m.monthKey}</td>
                      <td className="py-1.5 pr-3">{m.analyses}</td>
                      <td className="py-1.5 pr-3">
                        {m.avgScore == null ? '—' : fmtScore(m.avgScore, language === 'pt')}
                      </td>
                      <td className="py-1.5 pr-3">
                        {m.avgMarksPerOs == null ? '—' : m.avgMarksPerOs.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                  {drilldown.months.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-2 text-gray-500">{t('dash.live.noDataToday')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                {t('dash.live.recentOs')}
              </h4>
              <table data-testid="drill-recent-os" className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">O.S.</th>
                    <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">{t('dash.period.title')}</th>
                    <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">{t('dash.live.colAvgScore')}</th>
                    <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">{t('dash.live.colMarksShort')}</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldown.recentOs.map((r) => (
                    <tr key={r.osId} className="border-t border-gray-700/60 text-gray-300">
                      <td className="py-1.5 pr-3">{r.osId}</td>
                      <td className="py-1.5 pr-3">{r.date ?? '—'}</td>
                      <td className="py-1.5 pr-3">
                        {r.score == null ? '—' : fmtScore(r.score, language === 'pt')}
                      </td>
                      <td className="py-1.5 pr-3">{r.marks}</td>
                    </tr>
                  ))}
                  {drilldown.recentOs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-2 text-gray-500">{t('dash.live.noDataToday')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Qualidade cruzada (respeita papel) */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-200">
          {t('dash.live.quality')}
        </h3>
        <div className="overflow-x-auto">
          <table data-testid="live-quality" className="w-full text-left text-xs">
            <thead>
              <tr className="text-gray-500">
                <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">
                  {t('dash.live.colAnalyst')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">
                  {t('dash.live.colAnalyzed')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">
                  {t('dash.live.colAvgScore')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">
                  {t('dash.live.colMarks')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">
                  {t('dash.live.colRework')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">
                  {t('dash.live.colAvgTime')}
                </th>
                <th scope="col" className="py-1 pr-3 font-medium uppercase tracking-wide">
                  {t('dash.live.colVsTeam')}
                </th>
              </tr>
            </thead>
            <tbody>
              {qualityVisible.map((r) => (
                <tr key={r.analyst} className="border-t border-gray-700/60 text-gray-300">
                  <td className="py-1.5 pr-3">{drillLabel(r.analyst)}</td>
                  <td className="py-1.5 pr-3">{r.analyses}</td>
                  <td className="py-1.5 pr-3">
                    {r.avgScore == null ? '—' : fmtScore(r.avgScore, language === 'pt')}
                  </td>
                  <td className="py-1.5 pr-3">
                    {r.avgMarksPerOs == null
                      ? '—'
                      : r.avgMarksPerOs.toFixed(1)}
                  </td>
                  <td className="py-1.5 pr-3" data-testid={`quality-rework-${r.analyst}`}>
                    {!canSeeIndividual || r.auditedOs == null || r.auditedOs === 0
                      ? '—'
                      : `${(r.reworkRate ?? 0) >= 0 ? Math.round((r.reworkRate ?? 0) * 100) : 0}% (${t('dash.live.reworkOf', { ok: String(r.auditsOk), bad: String(r.reworkEvents) })})`}
                  </td>
                  <td className="py-1.5 pr-3">
                    {!canSeeIndividual || r.avgHoursPerOs == null
                      ? '—'
                      : t('dash.live.kpiSlaHours', {
                          h: String(r.avgHoursPerOs).replace('.', language === 'pt' ? ',' : '.'),
                        })}
                  </td>
                  <td className="py-1.5 pr-3">
                    {!canSeeIndividual || r.deltaVsTeamPct == null
                      ? '—'
                      : t(
                          r.deltaVsTeamPct > 0 ? 'dash.live.vsTeamSlow' : r.deltaVsTeamPct < 0 ? 'dash.live.vsTeamFast' : 'dash.live.vsTeamEven',
                          { pct: String(Math.abs(r.deltaVsTeamPct)) },
                        )}
                  </td>
                </tr>
              ))}
              {qualityVisible.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-2 text-gray-500">
                    {t('dash.live.noDataToday')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** Chart lazy: echarts só entra em cena quando o painel ao vivo abre. */
const LazyChart = React.lazy(() => import('../EChartsLiveChart'));

/** Fallback padrão do Suspense dos gráficos. */
export function ChartFallback(): React.ReactElement {
  return (
    <div
      data-testid="chart-fallback"
      className="flex h-[280px] items-center justify-center rounded border border-gray-700/60 text-xs text-gray-500"
    >
      …
    </div>
  );
}

/** Par (chart + fallback) — usado nas duas seções de gráfico do painel. */
function LazyChartWithFallback(props: {
  option: Record<string, unknown>;
  ariaLabel: string;
}): React.ReactElement {
  return (
    <React.Suspense fallback={<ChartFallback />}>
      <LazyChart {...props} />
    </React.Suspense>
  );
}
