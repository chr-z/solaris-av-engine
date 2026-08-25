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
  buildAnalystQuality,
  buildLiveKpis,
  buildThroughputByDay,
  buildThroughputByHour,
  mergeFeed,
  visibleQualityRows,
  type AnalystActivity,
  type FeedEvent,
  type LiveKpis,
} from '../../utils/liveDashboard';
import { SAO_PAULO_CLOCK, localDayKey } from '../../features/gamification/periods';
import { canReadIndividualMetrics, type UserContext } from '../../features/db/roles';
import type { Dataset } from '../../utils/dashboard';
import { buildDashboardDataset } from '../../utils/dashboard';
import {
  loadDashboardEntries,
  type DashboardEntryInput,
} from '../../utils/dashboardData';
import { useI18n } from '../../i18n/I18nContext';

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

  const dataset: Dataset = useMemo(
    () => buildDashboardDataset(ownEntries),
    [ownEntries],
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

  const todayKey = useMemo(
    () => localDayKey(tickNow, SAO_PAULO_CLOCK),
    [tickNow],
  );

  const kpis: LiveKpis = useMemo(
    () => buildLiveKpis(dataset, { todayKey, queue }),
    [dataset, todayKey, queue],
  );

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
      buildAnalystCards(effectiveActivities, dataset, {
        todayKey,
        nowMs: tickNow,
      }),
    [effectiveActivities, dataset, todayKey, tickNow],
  );

  const qualityAll = useMemo(() => buildAnalystQuality(dataset), [dataset]);
  const qualityVisible = useMemo(
    () => visibleQualityRows(qualityAll, viewerCtx),
    [qualityAll, viewerCtx],
  );
  const canSeeIndividual = canReadIndividualMetrics(viewerCtx);

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      </div>

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
              <li
                key={c.userId}
                data-testid="live-analyst-card"
                className="rounded-lg border border-gray-600/60 bg-gray-800/40 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">{PRESENCE_DOT[c.state] ?? '⚪'}</span>
                  <span className="truncate text-sm font-medium text-gray-100">
                    {c.name}
                  </span>
                  <span className="ml-auto text-xs text-gray-500">
                    {c.analyzingOsId
                      ? t('dash.live.workingOn', { os: c.analyzingOsId })
                      : ''}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                  <span>{t('dash.live.todayCount', { n: String(c.todayCount) })}</span>
                  {canSeeIndividual && c.avgGiven != null && (
                    <span>{t('dash.live.avgGiven', { score: fmtScore(c.avgGiven, language === 'pt') })}</span>
                  )}
                </div>
                {canSeeIndividual && c.avgGiven == null && c.todayCount === 0 && (
                  <p className="mt-1 text-xs text-gray-600">{t('dash.live.noDataToday')}</p>
                )}
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
                </tr>
              ))}
              {qualityVisible.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-gray-500">
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
