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
  closedPeriodRange,
  localDayKey,
  localParts,
  weekKey,
  type PodiumClockConfig,
} from '../features/gamification/periods';
import type { Dataset, OsRecord } from './dashboard';
import { canReadIndividualMetrics, type UserContext } from '../features/db/roles';
import type { QueueRowLike } from '../features/qol/queue';

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
  /** Análises na SEMANA do pódio (seg-dom, fuso -03:00) — spec B2. */
  weekCount: number;
  /** Média das notas dadas (só exibida p/ papéis autorizados). */
  avgGiven: number | null;
  /** Média de horas por O.S. concluída (fila real; null sem timestamps). */
  avgHoursPerOs: number | null;
  lastActiveMs: number | null;
}

/**
 * Tempo médio por O.S. (spec B2) — da FILA REAL (os_queue), não inventado:
 * média created_at→completed_at das linhas 'done' atribuídas ao analista com
 * timestamps parseáveis e coerentes (conclusão antes da criação = fora).
 * Sem conclusões datadas → null (a UI mostra "—", nunca zero).
 */
export function buildAnalystCards(
  activities: readonly AnalystActivity[],
  dataset: Dataset,
  opts: { todayKey: string; nowMs: number },
): AnalystCardData[] {
  const perAnalyst = new Map<
    string,
    { count: number; sum: number; weekCount: number }
  >();
  const wk = weekKey(opts.nowMs, SAO_PAULO_CLOCK);
  const weekEndExclusive = localDayKey(
    closedPeriodRange('week', wk, SAO_PAULO_CLOCK).fromMs + 7 * MS_PER_DAY_LOCAL,
    SAO_PAULO_CLOCK,
  );
  for (const rec of dataset.records) {
    if (!rec.analyst || rec.finalScore === null || !rec.date) continue;
    const id = rec.analyst;
    const entry = perAnalyst.get(id) ?? { count: 0, sum: 0, weekCount: 0 };
    if (rec.date === opts.todayKey) {
      // Card mostra o DIA: contagem e média das notas de hoje.
      entry.count++;
      entry.sum += rec.finalScore;
    }
    // Janela semanal meio-aberta [segunda 00:00, próxima segunda 00:00)
    // no fuso do pódio — a mesma régua do pódio (spec C2/B2).
    if (rec.date >= wk && rec.date < weekEndExclusive) entry.weekCount++;
    perAnalyst.set(id, entry);
  }

  const hours = analystAvgHoursFromQueue(dataset.queueRows ?? [], opts.nowMs);

  return activities.map((a) => {
    const agg = perAnalyst.get(a.userId);
    return {
      userId: a.userId,
      name: a.name,
      state: presenceState(a, opts.nowMs),
      analyzingOsId: a.analyzingOsId ?? null,
      todayCount: agg?.count ?? 0,
      weekCount: agg?.weekCount ?? 0,
      avgGiven: agg && agg.count > 0 ? agg.sum / agg.count : null,
      avgHoursPerOs: hours.get(a.userId) ?? null,
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
export function visibleQualityRows<T extends AnalystQualityRow>(
  rows: readonly T[],
  viewer: UserContext,
): T[] {
  if (canReadIndividualMetrics(viewer)) return [...rows];
  return rows.filter((r) => r.analyst === viewer.userId);
}

// ---------------------------------------------------------------------------
// Drill-down do analista (spec B2 — "clicar → histórico completo da pessoa")
// ---------------------------------------------------------------------------

/** Linha de histórico mensal do drill-down (só meses com atividade). */
export interface AnalystMonthRow {
  /** Chave 'YYYY-MM' no fuso do pódio. */
  monthKey: string;
  analyses: number;
  avgScore: number | null;
  /** Marcações médias por O.S. (null quando nenhuma linha veio marcada). */
  avgMarksPerOs: number | null;
}

/** Uma O.S. recente do analista (mais nova primeiro). */
export interface AnalystOsRow {
  osId: string;
  date: string | null;
  score: number | null;
  marks: number;
}

export interface AnalystDrilldown {
  userId: string;
  name: string;
  todayCount: number;
  weekCount: number;
  /** Total de O.S. com nota na planilha inteira. */
  totalCount: number;
  avgScore: number | null;
  /** Média de horas/O.S. da fila real (null sem timestamps — nunca zero). */
  avgHoursPerOs: number | null;
  /** Última atividade conhecida (evento XP/save); null = nunca visto. */
  lastActiveMs: number | null;
  state: PresenceState;
  analyzingOsId: string | null;
  /** Meses com atividade, mais recente primeiro (cap interno nenhum — dataset é pequeno). */
  months: AnalystMonthRow[];
  /** Até 8 O.S. mais recentes, mais nova primeiro. */
  recentOs: AnalystOsRow[];
}

const HOUR_MS_DRILL = 3_600_000;

/**
 * Tempo médio por O.S. concluída POR ANALISTA, da fila real (os_queue).
 * Atribuição: assignee, senão claimed_by (mesma semântica do suggestNext).
 * Timestamp ausente/inválido ou conclusão antes da criação = FORA da média.
 */
export function analystAvgHoursFromQueue(
  rows: readonly QueueRowLike[],
  now: number,
): Map<string, number> {
  void now; // assinatura estável p/ futuras janelas (ex.: só últimos 30d)
  const acc = new Map<string, { sumMs: number; n: number }>();
  for (const r of rows) {
    if (r.status !== 'done') continue;
    const who = r.assignee ?? r.claimed_by ?? null;
    if (!who) continue;
    const created = Date.parse(r.created_at);
    const completed =
      r.completed_at != null && r.completed_at !== '' ? Date.parse(r.completed_at) : NaN;
    if (!Number.isFinite(created) || !Number.isFinite(completed)) continue;
    if (completed < created) continue; // relógio corrupto não entra
    const cur = acc.get(who) ?? { sumMs: 0, n: 0 };
    cur.sumMs += completed - created;
    cur.n++;
    acc.set(who, cur);
  }
  const out = new Map<string, number>();
  for (const [who, a] of acc) {
    if (a.n > 0) out.set(who, Math.round((a.sumMs / a.n / HOUR_MS_DRILL) * 10) / 10);
  }
  return out;
}

/**
 * História completa do analista (spec B2): totais, mês a mês e O.S. recentes.
 * Puro — o painel só injeta viewer/papel via visibleQualityRows-like gates.
 */
export function buildAnalystDrilldown(
  activities: readonly AnalystActivity[],
  dataset: Dataset,
  opts: {
    userId: string;
    todayKey: string;
    nowMs: number;
    cfg?: PodiumClockConfig;
  },
): AnalystDrilldown | null {
  const cfg = opts.cfg ?? SAO_PAULO_CLOCK;
  const activity = activities.find((a) => a.userId === opts.userId);
  if (!activity) return null;

  let totalCount = 0;
  let totalSum = 0;
  let todayCount = 0;
  const wk = weekKey(opts.nowMs, cfg);
  const weekEndExclusive = localDayKey(
    closedPeriodRange('week', wk, cfg).fromMs + 7 * MS_PER_DAY_LOCAL,
    cfg,
  );
  let weekCount = 0;

  interface MonthAcc {
    n: number;
    sum: number;
    marks: number;
    marked: number;
  }
  const months = new Map<string, MonthAcc>();
  const osRows: AnalystOsRow[] = [];

  for (const rec of dataset.records) {
    if (!rec.analyst || rec.analyst !== opts.userId) continue;
    if (rec.finalScore !== null) {
      totalCount++;
      totalSum += rec.finalScore;
    }
    if (!rec.date) continue;
    if (rec.date === opts.todayKey && rec.finalScore !== null) todayCount++;
    // Semana do pódio: mesma régua meio-aberta dos cards (B2/C2).
    if (rec.date >= wk && rec.date < weekEndExclusive && rec.finalScore !== null) {
      weekCount++;
    }
    const mk = `${rec.date.slice(0, 4)}-${rec.date.slice(5, 7)}`;
    const m = months.get(mk) ?? { n: 0, sum: 0, marks: 0, marked: 0 };
    if (rec.finalScore !== null) {
      m.n++;
      m.sum += rec.finalScore;
    }
    if (rec.marks && rec.marks.length > 0) {
      m.marks += rec.marks.length;
      m.marked++;
    }
    months.set(mk, m);
    osRows.push({
      osId: rec.wo || `#${rec.rowIndex}`,
      date: rec.date,
      score: rec.finalScore,
      marks: rec.marks?.length ?? 0,
    });
  }

  const monthRows: AnalystMonthRow[] = [...months.entries()]
    .map(([monthKey, m]) => ({
      monthKey,
      analyses: m.n,
      avgScore: m.n > 0 ? m.sum / m.n : null,
      avgMarksPerOs: m.marked > 0 ? m.marks / m.marked : null,
    }))
    .sort((x, y) => y.monthKey.localeCompare(x.monthKey));

  osRows.sort((x, y) => {
    if (x.date != null && y.date != null && x.date !== y.date) {
      return y.date.localeCompare(x.date);
    }
    if (x.date == null && y.date != null) return 1;
    if (x.date != null && y.date == null) return -1;
    return x.osId.localeCompare(y.osId);
  });

  const hours = analystAvgHoursFromQueue(dataset.queueRows ?? [], opts.nowMs);

  return {
    userId: opts.userId,
    name: activity.name,
    todayCount,
    weekCount,
    totalCount,
    avgScore: totalCount > 0 ? totalSum / totalCount : null,
    avgHoursPerOs: hours.get(opts.userId) ?? null,
    lastActiveMs: activity.lastActiveMs,
    state: presenceState(activity, opts.nowMs),
    analyzingOsId: activity.analyzingOsId ?? null,
    months: monthRows,
    recentOs: osRows.slice(0, 8),
  };
}
// ---------------------------------------------------------------------------
// Qualidade cruzada COMPLETA (spec B3): nota dada vs recebida em auditoria +
// tempo/O.S. vs média do time — cada métrica existe só quando a fonte sustenta.
// ---------------------------------------------------------------------------

/** Evento mínimo de XP necessário pra derivar o veredito de auditoria. */
export interface QualityAuditEvent {
  userId: string;
  amount: number;
  reason: string;
}

/**
 * Veredito de auditoria por analista, derivado dos eventos XP (fonte real:
 * xp_events / perfil gamificado). A auditoria se manifesta como quality_bonus
 * (+150, zero retrabalho) e/ou rework_penalty (-150, estorno).
 */
export interface AuditVerdict {
  /** Auditorias que confirmaram zero retrabalho (quality_bonus). */
  auditsOk: number;
  /** Estornos por retrabalho encontrado (rework_penalty). */
  reworkEvents: number;
}

export function auditVerdictFromEvents(
  events: readonly QualityAuditEvent[],
): Map<string, AuditVerdict> {
  const out = new Map<string, AuditVerdict>();
  for (const e of events) {
    if (e.reason !== 'quality_bonus' && e.reason !== 'rework_penalty') continue;
    if (!Number.isFinite(e.amount)) continue;
    const cur = out.get(e.userId) ?? { auditsOk: 0, reworkEvents: 0 };
    if (e.reason === 'quality_bonus') cur.auditsOk++;
    else cur.reworkEvents++;
    out.set(e.userId, cur);
  }
  return out;
}

/**
 * Linha B3 enriquecida. Campos novos (auditados/tempo):
 *   - auditedOs: OSs com veredito de auditoria conhecido;
 *   - reworkRate: estornos ÷ auditadas (null sem auditoria — NUNCA zero,
 *     que leria como "perfeito");
 *   - avgHoursPerOs / teamAvgHoursPerOs: da fila real (assignee → claimed_by);
 *     null = sem timestamps confiáveis (nunca zero inventado);
 *   - deltaVsTeamPct: só existe com os DOIS números — null caso contrário.
 */
export interface AnalystQualityRowFull extends AnalystQualityRow {
  auditedOs: number | null;
  auditsOk: number;
  reworkEvents: number;
  reworkRate: number | null;
  avgHoursPerOs: number | null;
  /** Média do time (denominador do delta; null sem conclusões datadas). */
  teamAvgHoursPerOs: number | null;
  /**
   * Tempo médio do analista vs média do time, em % (positivo = mais lento).
   * Contexto de volume (spec B3): a UI mostra o n ao lado — nunca pune volume.
   */
  deltaVsTeamPct: number | null;
}

/**
 * Versão FULL de buildAnalystQuality: mesma agregação da planilha, cruzada
 * com auditoria (eventos XP) e tempo real (fila). Pura e determinística.
 */
export function buildAnalystQualityFull(
  dataset: Dataset,
  opts: {
    events?: readonly QualityAuditEvent[];
    queueRows?: readonly QueueRowLike[];
  } = {},
): AnalystQualityRowFull[] {
  // Base idêntica à função simples (mesma ordenação por volume desc).
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

  const verdicts = auditVerdictFromEvents(opts.events ?? []);
  const hours = analystAvgHoursFromQueue(opts.queueRows ?? [], 0);

  // Média do time = média das médias POR ANALISTA (mesmo peso pra cada um,
  // não ponderada pelo volume — um maratonista não mascara o time).
  const hourVals = [...hours.values()];
  const teamAvg =
    hourVals.length > 0
      ? Math.round((hourVals.reduce((s, v) => s + v, 0) / hourVals.length) * 10) / 10
      : null;

  const rows: AnalystQualityRowFull[] = [];
  for (const [analyst, a] of agg) {
    const v = verdicts.get(analyst);
    const audited = v != null ? v.auditsOk + v.reworkEvents : null;
    const rate =
      v != null && audited != null && audited > 0 ? v.reworkEvents / audited : null;
    const own = hours.get(analyst) ?? null;
    // Delta exige PELO MENOS 2 analistas medidos: um time de um só se
    // compararia consigo mesmo (0% vazio). Sem pares, sem comparação.
    const delta =
      own != null && teamAvg != null && teamAvg > 0 && hourVals.length >= 2
        ? Math.round(((own - teamAvg) / teamAvg) * 100)
        : null;
    rows.push({
      analyst,
      analyses: a.n,
      avgScore: a.n > 0 ? a.sum / a.n : null,
      avgMarksPerOs: a.marked > 0 ? a.marks / a.marked : null,
      reworkRate: rate,
      auditedOs: audited,
      auditsOk: v?.auditsOk ?? 0,
      reworkEvents: v?.reworkEvents ?? 0,
      avgHoursPerOs: own,
      teamAvgHoursPerOs: teamAvg,
      deltaVsTeamPct: delta,
    });
  }
  rows.sort((x, y) => y.analyses - x.analyses);
  return rows;
}
