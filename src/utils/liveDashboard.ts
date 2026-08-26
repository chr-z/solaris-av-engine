// Solaris v3 — Feature Pack "Analista Feliz" — F5 Dashboard ao vivo (núcleo puro).
//
// Toda a matemática do painel ao vive vive aqui: KPIs do topo, throughput,
// estados de presença por analista e o feed de eventos. Sem React, sem DOM,
// sem I/O — a UI (components/Admin/LiveDashboardPanel) só orquestra.
//
// Offline-first: nada aqui depende de rede; o feed ao vivo é um enfeite
// (SSE com fallback de polling) sobre dados que já existem localmente.
// Privacidade: métricas individuais passam pelo mesmo gate RLS-like do
// resto do app (features/db/roles.ts).

import {
  SAO_PAULO_CLOCK,
  localDayKey,
  localParts,
  type PodiumClockConfig,
} from '../features/gamification/periods';
import type { Dataset, OsRecord } from './dashboard';
import { canReadIndividualMetrics, type UserContext } from '../features/db/roles';

// ---------------------------------------------------------------------------
// KPIs do topo (spec B1)
// ---------------------------------------------------------------------------

/** Snapshot opcional da fila (tabela os_queue) para "em análise agora". */
export interface QueueSnapshotEntry {
  osId: string;
  status: 'queued' | 'in_analysis' | 'done';
  assignee?: string | null;
  /** Instante em que entrou em análise (para "há quanto tempo"). */
  startedAtMs?: number | null;
}

export interface LiveKpiInput {
  /** Dia local de referência ('YYYY-MM-DD', fuso do pódio). */
  todayKey: string;
  /** Snapshot da fila; ausente = deriva "em análise" só do status done. */
  queue?: readonly QueueSnapshotEntry[];
}

export interface LiveKpis {
  /** OSs com data de hoje. */
  osToday: number;
  /** Delas, quantas já concluídas (nota final presente). */
  completedToday: number;
  /** Em análise agora (da fila; fallback: 0 quando não há snapshot). */
  inAnalysis: number;
  /** Quem está em análise agora ("Nome · há 12min"). */
  inAnalysisWho: string[];
  /** Pendentes no dataset inteiro (sem nota final). */
  queuePending: number;
  /** Nota média global (null se nenhuma nota). */
  avgScore: number | null;
}

export function buildLiveKpis(
  dataset: Dataset,
  input: LiveKpiInput,
): LiveKpis {
  let osToday = 0;
  let completedToday = 0;
  let queuePending = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const rec of dataset.records) {
    if (rec.date === input.todayKey) {
      osToday++;
      if (rec.finalScore !== null) completedToday++;
    }
    if (rec.finalScore === null) queuePending++;
    else {
      scoreSum += rec.finalScore;
      scoreCount++;
    }
  }

  const analyzing = (input.queue ?? []).filter(
    (q) => q.status === 'in_analysis',
  );
  return {
    osToday,
    completedToday,
    inAnalysis: analyzing.length,
    // "Ana · 12min" — há quanto tempo está na OS (0min quando sem timestamp).
    inAnalysisWho: analyzing.map((q) => {
      const name = q.assignee ?? q.osId;
      const mins =
        q.startedAtMs != null
          ? Math.max(0, Math.round((Date.now() - q.startedAtMs) / 60_000))
          : null;
      return mins != null ? `${name} · ${mins}min` : name;
    }),
    queuePending,
    avgScore: scoreCount > 0 ? scoreSum / scoreCount : null,
  };
}

// ---------------------------------------------------------------------------
// Throughput (spec B1) — duas resoluções honestas com as fontes existentes
// ---------------------------------------------------------------------------

export interface DayPoint {
  dayKey: string; // 'YYYY-MM-DD'
  count: number;
}

/**
 * Série diária terminando hoje (janela inclusiva). A planilha tem data sem
 * hora — prometer "por hora" dela seria inventar dado; dias a série dá.
 */
export function buildThroughputByDay(
  records: readonly OsRecord[],
  opts: { endDayKey: string; days: number },
): DayPoint[] {
  const counts = new Map<string, number>();
  for (const rec of records) {
    if (!rec.date || rec.finalScore === null) continue;
    counts.set(rec.date, (counts.get(rec.date) ?? 0) + 1);
  }
  const out: DayPoint[] = [];
  // Caminha de trás pra frente a partir de endDayKey via epoch do fuso.
  const endEpoch = dayKeyToEpoch(opts.endDayKey);
  for (let i = opts.days - 1; i >= 0; i--) {
    const key = localDayKey(endEpoch - i * MS_PER_DAY_LOCAL, SAO_PAULO_CLOCK);
    out.push({ dayKey: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

export interface HourPoint {
  hour: number; // 0–23 no fuso do pódio
  count: number;
}

/** Série por hora do dia a partir de eventos com timestamp real (XP/feed). */
export function buildThroughputByHour(
  events: readonly { ts: number }[],
  cfg: PodiumClockConfig = SAO_PAULO_CLOCK,
): HourPoint[] {
  const buckets = new Array<number>(24).fill(0);
  for (const ev of events) {
    if (!Number.isFinite(ev.ts)) continue;
    const hour = localParts(ev.ts, cfg).hour;
    buckets[hour]++;
  }
  return buckets.map((count, hour) => ({ hour, count }));
}

export function peakOf(points: readonly { count: number }[]): number {
  let peak = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].count > points[peak].count) peak = i;
  }
  return points[peak]?.count ?? 0;
}

const MS_PER_DAY_LOCAL = 86_400_000;

/** Epoch do meio-dia UTC de um dayKey — base estável p/ aritmética de dias. */
function dayKeyToEpoch(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

// ---------------------------------------------------------------------------
// Presença por analista (spec B2): 🟢 analisando · 🟡 ocioso >15min · ⚪ offline
// ---------------------------------------------------------------------------

export const IDLE_THRESHOLD_MS = 15 * 60_000;

export interface AnalystActivity {
  userId: string;
  name: string;
  /** Última atividade conhecida (evento XP, save, etc.). */
  lastActiveMs: number | null;
  /** OS aberta agora neste analista. */
  analyzingOsId?: string | null;
}

export type PresenceState = 'analyzing' | 'recent' | 'idle' | 'offline';

export function presenceState(a: AnalystActivity, nowMs: number): PresenceState {
  if (a.analyzingOsId) return 'analyzing';
  if (a.lastActiveMs == null) return 'offline';
  const delta = nowMs - a.lastActiveMs;
  if (delta < 0) return 'recent'; // relógios adiantados: trate como ativo
  if (delta <= IDLE_THRESHOLD_MS) return 'recent';
  return 'idle';
}

export interface AnalystCardData {
  userId: string;
  name: string;
  state: PresenceState;
  analyzingOsId: string | null;
  /** Análises concluídas hoje (pela planilha). */
  todayCount: number;
  /** Média das notas dadas (só exibida p/ papéis autorizados). */
  avgGiven: number | null;
  lastActiveMs: number | null;
}

export function buildAnalystCards(
  activities: readonly AnalystActivity[],
  dataset: Dataset,
  opts: { todayKey: string; nowMs: number },
): AnalystCardData[] {
  const perAnalyst = new Map<string, { count: number; sum: number }>();
  for (const rec of dataset.records) {
    if (rec.date !== opts.todayKey) continue;
    const id = rec.analyst;
    const entry = perAnalyst.get(id) ?? { count: 0, sum: 0 };
    if (rec.finalScore !== null) {
      entry.count++;
      entry.sum += rec.finalScore;
    }
    perAnalyst.set(id, entry);
  }

  return activities.map((a) => {
    const agg = perAnalyst.get(a.userId);
    return {
      userId: a.userId,
      name: a.name,
      state: presenceState(a, opts.nowMs),
      analyzingOsId: a.analyzingOsId ?? null,
      todayCount: agg?.count ?? 0,
      avgGiven: agg && agg.count > 0 ? agg.sum / agg.count : null,
      lastActiveMs: a.lastActiveMs,
    };
  });
}

// ---------------------------------------------------------------------------
// Feed de eventos ao vivo (spec B1) — dedupe, ordem, cap
// ---------------------------------------------------------------------------

export interface FeedEvent {
  id: string;
  /** Texto pronto ("Ana terminou OS-12345 · 14:32") ou chave i18n+args. */
  text: string;
  ts: number;
}

/** Dedupe por id (primeiro vence), mais recente primeiro, teto de 50. */
export function mergeFeed(
  existing: readonly FeedEvent[],
  incoming: readonly FeedEvent[],
  cap = 50,
): FeedEvent[] {
  const seen = new Set(existing.map((e) => e.id));
  const merged = [...existing];
  for (const ev of incoming) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    merged.push(ev);
  }
  merged.sort((a, b) => b.ts - a.ts);
  return merged.slice(0, cap);
}

// ---------------------------------------------------------------------------
// Métricas cruzadas de qualidade (spec B3) — sem nota inventada
// ---------------------------------------------------------------------------

export interface AnalystQualityRow {
  analyst: string;
  analyses: number;
  avgScore: number | null;
  avgMarksPerOs: number | null;
  /** Retrabalho real ainda não existe na planilha — campo fica null até haver fonte. */
  reworkRate: number | null;
}

export function buildAnalystQuality(dataset: Dataset): AnalystQualityRow[] {
  const agg = new Map<string, { n: number; sum: number; marks: number; marked: number }>();
  for (const rec of dataset.records) {
    if (!rec.analyst) continue;
    const a = agg.get(rec.analyst) ?? { n: 0, sum: 0, marks: 0, marked: 0 };
    if (rec.finalScore !== null) {
      a.n++;
      a.sum += rec.finalScore;
    }
    if (rec.marks) {
      a.marks += rec.marks.length;
      a.marked++;
    }
    agg.set(rec.analyst, a);
  }
  const rows: AnalystQualityRow[] = [];
  for (const [analyst, a] of agg) {
    rows.push({
      analyst,
      analyses: a.n,
      avgScore: a.n > 0 ? a.sum / a.n : null,
      avgMarksPerOs: a.marked > 0 ? a.marks / a.marked : null,
      reworkRate: null,
    });
  }
  rows.sort((x, y) => y.analyses - x.analyses);
  return rows;
}

// ---------------------------------------------------------------------------
// SLA (spec B1 — "fila pendente, SLA médio"): honesto com as fontes.
// ---------------------------------------------------------------------------

/**
 * Resumo de SLA calculado da FILA VIVA (os_queue / QueueRowLike).
 * Duas medidas, cada uma só existe quando a fonte sustenta:
 *   - avgCompletionHours: média (created_at → completed_at) das OSs já
 *     concluídas COM timestamps parseáveis e coerentes;
 *   - overdueCount/avgOverdueHours: fila 'queued' com deadline no passado.
 * Sem dado inventado: sem timestamps → null (o card mostra "—"), nunca zero.
 */
export interface SlaSummary {
  /** Média de horas até concluir (null = nenhuma conclusão datada). */
  avgCompletionHours: number | null;
  /** OSs na fila com prazo estourado agora. */
  overdueCount: number;
  /** Atraso médio delas em horas (null = nenhuma atrasada). */
  avgOverdueHours: number | null;
}

const HOUR_MS_SLA = 3_600_000;

/** Parse tolerante: inválido/vazio = ausente (nunca epoch 0 por acidente). */
function parseTsOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function buildSlaSummary(
  rows: readonly {
    status: string;
    deadline?: string | null;
    created_at: string;
    completed_at?: string | null;
  }[],
  opts: { now?: number } = {},
): SlaSummary {
  const now = opts.now ?? Date.now();

  let completionSumMs = 0;
  let completionN = 0;
  for (const r of rows) {
    if (r.status !== 'done') continue;
    const created = parseTsOrNull(r.created_at);
    const completed = parseTsOrNull(r.completed_at);
    // Relógio corrupto (conclusão antes da criação) NÃO entra na média.
    if (created == null || completed == null || completed < created) continue;
    completionSumMs += completed - created;
    completionN++;
  }

  let overdueSumMs = 0;
  let overdueN = 0;
  for (const r of rows) {
    if (r.status !== 'queued') continue;
    const deadline = parseTsOrNull(r.deadline);
    if (deadline == null || deadline >= now) continue;
    overdueSumMs += now - deadline;
    overdueN++;
  }

  const round1 = (ms: number): number => Math.round((ms / HOUR_MS_SLA) * 10) / 10;

  return {
    avgCompletionHours: completionN > 0 ? round1(completionSumMs / completionN) : null,
    overdueCount: overdueN,
    avgOverdueHours: overdueN > 0 ? round1(overdueSumMs / overdueN) : null,
  };
}

/**
 * Privacidade (spec B4/E): analista vê só a própria linha detalhada;
 * admin/lead veem todas. O agregado do time continua visível pra todos.
 */
export function visibleQualityRows(
  rows: readonly AnalystQualityRow[],
  viewer: UserContext,
): AnalystQualityRow[] {
  if (canReadIndividualMetrics(viewer)) return [...rows];
  return rows.filter((r) => r.analyst === viewer.userId);
}
