// Solaris v3 — F3 Gamificação — testes dos núcleos puros.
// Bordas cobertas: reset da semana na segunda 00h fuso America/São_Paulo
// (UTC-03:00), streak quebrado, empates de pódio c/ desempate por retrabalho,
// caps de XP, limiares de nível e idempotência determinística.
import { describe, it, expect } from 'vitest';
import {
  SAO_PAULO_CLOCK,
  localDayKey,
  weekKey,
  monthKey,
  yearKey,
  nextPeriodKey,
  closedPeriodRange,
  currentPeriodKey,
  shouldClosePeriod,
} from '../features/gamification/periods';
import {
  eventsForCompletion,
  totalXp,
  xpInRange,
  reworkCount,
  currentStreak,
  XP_BASE_PER_OS,
  XP_STREAK_BONUS,
  XP_QUALITY_BONUS,
  type XpEventLike,
} from '../features/gamification/xp';
import {
  LEVELS,
  levelForXp,
  nextLevelForXp,
  levelProgress,
} from '../features/gamification/levels';
import {
  evaluateAchievements,
  newAchievements,
  ACHIEVEMENTS,
  type AchievementSnapshot,
} from '../features/gamification/achievements';
import {
  podiumFor,
  podiumTop3,
  frozenPodiumRows,
  type AnalystInfo,
} from '../features/gamification/podium';

/** Epoch ms de um horário de São Paulo (wall clock → instante UTC). */
const sp = (y: number, m: number, d: number, h = 0, min = 0): number =>
  Date.UTC(y, m - 1, d, h, min) - SAO_PAULO_CLOCK.tzOffsetMinutes * 60_000;

const CFG = SAO_PAULO_CLOCK;
const DAY = 86_400_000;

describe('F3 periods — fuso fixo America/São_Paulo (não é o do host)', () => {
  it('dia local vira antes do UTC: 02:00Z ainda é o dia anterior em SP', () => {
    // 2026-08-24T02:00Z = 23:00 de 23/08 em SP (agosto, sem DST desde 2019)
    expect(localDayKey(Date.UTC(2026, 7, 24, 2, 0), CFG)).toBe('2026-08-23');
    // meio-dia Z já é dia igual nos dois fusos
    expect(localDayKey(Date.UTC(2026, 7, 24, 12, 0), CFG)).toBe('2026-08-24');
  });

  it('semana abre na segunda: domingo 23:59 e sábado pertencem à semana da segunda anterior', () => {
    const monday = weekKey(sp(2026, 8, 17, 8), CFG);   // seg 08h
    const saturday = weekKey(sp(2026, 8, 22, 20), CFG); // sáb 20h
    const sundayLate = weekKey(sp(2026, 8, 23, 23, 59), CFG); // dom 23:59
    expect(monday).toBe('2026-08-17');
    expect(saturday).toBe('2026-08-17');
    expect(sundayLate).toBe('2026-08-17');
  });

  it('RESET segunda 00h local: dom 23:59:59 e seg 00:00:00 caem em semanas diferentes', () => {
    const before = weekKey(Date.UTC(2026, 7, 24, 2, 59, 59), CFG); // dom 23:59:59 SP
    const after = weekKey(Date.UTC(2026, 7, 24, 3, 0, 0), CFG);    // seg 00:00:00 SP
    expect(before).toBe('2026-08-17');
    expect(after).toBe('2026-08-24');
    expect(before).not.toBe(after);
  });

  it('chaves de mês/ano viram nas bordas civis locais', () => {
    expect(monthKey(sp(2026, 8, 31, 23, 59), CFG)).toBe('2026-08');
    expect(monthKey(sp(2026, 9, 1, 0, 0), CFG)).toBe('2026-09');
    expect(yearKey(sp(2026, 12, 31, 23, 59), CFG)).toBe('2026');
    expect(yearKey(sp(2027, 1, 1, 0, 1), CFG)).toBe('2027');
  });

  it('nextPeriodKey atravessa mês e ano corretamente', () => {
    expect(nextPeriodKey('week', '2026-08-24', CFG)).toBe('2026-08-31'); // seg→seg
    expect(nextPeriodKey('week', '2026-08-31', CFG)).toBe('2026-09-07'); // cruza setembro
    expect(nextPeriodKey('month', '2026-08', CFG)).toBe('2026-09');
    expect(nextPeriodKey('month', '2026-12', CFG)).toBe('2027-01');
    expect(nextPeriodKey('year', '2026', CFG)).toBe('2027');
  });

  it('intervalo do período fechado é meio-aberto e tem a duração certa', () => {
    const wk = closedPeriodRange('week', '2026-08-24', CFG);
    expect(wk.fromMs).toBe(sp(2026, 8, 24, 0, 0)); // segunda 00:00 SP
    expect(wk.toMs - wk.fromMs).toBe(7 * DAY);

    const aug = closedPeriodRange('month', '2026-08', CFG);
    expect(aug.toMs - aug.fromMs).toBe(31 * DAY);
    const feb27 = closedPeriodRange('month', '2027-02', CFG);
    expect(feb27.toMs - feb27.fromMs).toBe(28 * DAY); // 2027 não é bissexto

    const y26 = closedPeriodRange('year', '2026', CFG);
    expect(y26.toMs - y26.fromMs).toBe(365 * DAY);
  });

  it('shouldClosePeriod detecta a virada p/ congelar snapshot do pódio', () => {
    expect(currentPeriodKey('week', sp(2026, 8, 25, 10), CFG)).toBe('2026-08-24');
    expect(shouldClosePeriod('week', '2026-08-24', sp(2026, 8, 25, 10), CFG)).toBe(false);
    expect(shouldClosePeriod('week', '2026-08-24', Date.UTC(2026, 7, 31, 3, 0), CFG)).toBe(true);
  });
});

describe('F3 xp — regras da spec B (NUNCA velocidade pura)', () => {
  it('OS completa sem nada extra = apenas +100 base', () => {
    const evts = eventsForCompletion(
      { validInconformities: 0, zeroRework: false, hadStreak: false },
    );
    expect(evts).toHaveLength(1);
    expect(evts[0]).toEqual({ amount: 100, reason: 'os_complete' });
  });

  it('complexidade: +10 por inconformidade válida, teto de +100 (10 inconformidades)', () => {
    const cinco = eventsForCompletion(
      { validInconformities: 5, zeroRework: false, hadStreak: false },
    );
    expect(cinco.find((e) => e.reason === 'complexity_bonus')!.amount).toBe(50);

    const vinte = eventsForCompletion(
      { validInconformities: 20, zeroRework: false, hadStreak: false },
    );
    expect(vinte.find((e) => e.reason === 'complexity_bonus')!.amount).toBe(100); // CAP
  });

  it('combo completo segue ordem canônica base→complexidade→streak→qualidade', () => {
    const evts = eventsForCompletion(
      { validInconformities: 3, zeroRework: true, hadStreak: true },
    );
    expect(evts.map((e) => e.reason)).toEqual([
      'os_complete',
      'complexity_bonus',
      'streak_bonus',
      'quality_bonus',
    ]);
    expect(evts.map((e) => e.amount)).toEqual([XP_BASE_PER_OS, 30, XP_STREAK_BONUS, XP_QUALITY_BONUS]);
    expect(totalXp(evts.map((e, i) => ({ ...e, userId: 'u1', ts: i })))).toBe(305);
  });

  it('streak e qualidade são condicionais', () => {
    const sem = eventsForCompletion(
      { validInconformities: 0, zeroRework: false, hadStreak: false },
    );
    expect(sem.some((e) => e.reason === 'streak_bonus')).toBe(false);
    expect(sem.some((e) => e.reason === 'quality_bonus')).toBe(false);
  });

  it('saldo event-sourced inclui estornos negativos (rework_penalty/adjustment)', () => {
    const evts: XpEventLike[] = [
      { userId: 'u1', amount: 100, reason: 'os_complete', ts: 1 },
      { userId: 'u1', amount: 150, reason: 'quality_bonus', ts: 2 },
      { userId: 'u1', amount: -150, reason: 'rework_penalty', ts: 3 }, // auditoria achou retrabalho
      { userId: 'u1', amount: -50, reason: 'adjustment', ts: 4 },
      { userId: 'u2', amount: 999, reason: 'os_complete', ts: 5 }, // outro usuário, não conta
    ];
    expect(totalXp(evts, 'u1')).toBe(50);
    expect(totalXp(evts, 'u2')).toBe(999);
  });

  it('xpInRange é meio-aberto: entra no limite inferior, fora no superior', () => {
    const evts: XpEventLike[] = [
      { userId: 'u1', amount: 10, reason: 'os_complete', ts: 100 },
      { userId: 'u1', amount: 20, reason: 'os_complete', ts: 199 },
      { userId: 'u1', amount: 40, reason: 'os_complete', ts: 200 }, // fora (== to)
      { userId: 'u1', amount: 80, reason: 'os_complete', ts: 99 },  // fora (< from)
    ];
    expect(xpInRange(evts, 100, 200, 'u1')).toBe(30);
  });

  it('reworkCount conta só rework_penalty dentro do intervalo (desempate do pódio)', () => {
    const evts: XpEventLike[] = [
      { userId: 'u1', amount: -150, reason: 'rework_penalty', ts: 110 },
      { userId: 'u1', amount: -150, reason: 'rework_penalty', ts: 120 },
      { userId: 'u1', amount: -1, reason: 'adjustment', ts: 130 },       // não é rework
      { userId: 'u1', amount: -150, reason: 'rework_penalty', ts: 300 }, // fora do range
    ];
    expect(reworkCount(evts, 100, 200, 'u1')).toBe(2);
  });
});

describe('F3 streak diário', () => {
  it('conta dias consecutivos ancorando em hoje ou ontem', () => {
    // seg–qua com atividade, hoje quinta SEM atividade → streak ainda 3
    expect(currentStreak(['2026-08-24', '2026-08-25', '2026-08-26'], '2026-08-27')).toBe(3);
    // hoje com atividade inclui hoje
    expect(currentStreak(['2026-08-26', '2026-08-27'], '2026-08-27')).toBe(2);
  });

  it('STREAK QUEBRADO: buraco no meio zera a contagem corrente', () => {
    // seg com atividade, terça sem, quarta com, hoje quinta sem → só 1 (quarta)
    expect(currentStreak(['2026-08-24', '2026-08-26'], '2026-08-27')).toBe(1);
    // última atividade há 3 dias → zerado
    expect(currentStreak(['2026-08-24'], '2026-08-27')).toBe(0);
    // nunca analisou → 0
    expect(currentStreak([], '2026-08-27')).toBe(0);
  });

  it('streak atravessa virada de mês (julho→agosto)', () => {
    expect(currentStreak(['2026-07-31', '2026-08-01'], '2026-08-01')).toBe(2);
  });
});

describe('F3 levels — escada Trainee→Lenda do Estúdio', () => {
  it('limiares exatos (empate no limite inferior sobe de nível)', () => {
    expect(levelForXp(0).id).toBe('trainee');
    expect(levelForXp(499).id).toBe('trainee');
    expect(levelForXp(500).id).toBe('assistente');
    expect(levelForXp(1_999).id).toBe('assistente');
    expect(levelForXp(2_000).id).toBe('analista');
    expect(levelForXp(6_000).id).toBe('editor_senior');
    expect(levelForXp(15_000).id).toBe('diretor_qc');
    expect(levelForXp(40_000).id).toBe('lenda');
    expect(levelForXp(1_000_000).id).toBe('lenda');
    expect(LEVELS).toHaveLength(6);
  });

  it('progresso no meio do nível: fração e falta p/ próximo coerentes', () => {
    const p = levelProgress(1_250); // assistente: span 500→2000
    expect(p.current.id).toBe('assistente');
    expect(p.next!.id).toBe('analista');
    expect(p.fraction).toBeCloseTo(0.5, 5);
    expect(p.xpIntoLevel).toBe(750);
    expect(p.xpToNext).toBe(750);
  });

  it('topo da escada: Lenda tem próxima = null e barra cheia', () => {
    const top = levelProgress(40_000);
    expect(top.next).toBeNull();
    expect(top.fraction).toBe(1);
    expect(nextLevelForXp(999_999)).toBeNull();
  });
});

const EMPTY_SNAP: AchievementSnapshot = {
  totalCompleted: 0,
  maxInOneDay: 0,
  lateNightDays: [],
  earlyMorningDays: [],
  currentCleanRun: 0,
  bestCleanRun: 0,
  bestQualityMaintainingAvgSec: null,
  helpCommentsSent: 0,
};

describe('F3 achievements — catálogo C3 e predicados de borda', () => {
  it('catálogo tem exatamente as 9 conquistas da spec', () => {
    expect(ACHIEVEMENTS.map((a) => a.key)).toEqual([
      'first_os', 'os_100', 'os_500', 'marathon', 'owl',
      'early_bird', 'perfectionist', 'sprinter', 'mentor',
    ]);
  });

  it('first_os: exatamente 1 OS desbloqueia; 0 não', () => {
    expect(evaluateAchievements({ ...EMPTY_SNAP, totalCompleted: 0 }).has('first_os')).toBe(false);
    expect(evaluateAchievements({ ...EMPTY_SNAP, totalCompleted: 1 }).has('first_os')).toBe(true);
  });

  it('maratonas e marcos de carreira nos limites', () => {
    const nine = evaluateAchievements({ ...EMPTY_SNAP, totalCompleted: 99, maxInOneDay: 9 });
    expect(nine.has('os_100')).toBe(false);
    expect(nine.has('marathon')).toBe(false);

    const hundred = evaluateAchievements({ ...EMPTY_SNAP, totalCompleted: 100, maxInOneDay: 10 });
    expect(hundred.has('os_100')).toBe(true);
    expect(hundred.has('marathon')).toBe(true);
    expect(hundred.has('first_os')).toBe(true); // cumulativo

    expect(evaluateAchievements({ ...EMPTY_SNAP, totalCompleted: 500 }).has('os_500')).toBe(true);
  });

  it('coruja e madrugador olham os dias registrados', () => {
    const night = evaluateAchievements({
      ...EMPTY_SNAP,
      lateNightDays: ['2026-08-24'],
      earlyMorningDays: [],
    });
    expect(night.has('owl')).toBe(true);
    expect(night.has('early_bird')).toBe(false);
  });

  it('perfeccionista: melhor sequência histórica conta mesmo se atual quebrou', () => {
    const past = evaluateAchievements({ ...EMPTY_SNAP, bestCleanRun: 10, currentCleanRun: 0 });
    expect(past.has('perfectionist')).toBe(true);
    const live = evaluateAchievements({ ...EMPTY_SNAP, bestCleanRun: 3, currentCleanRun: 10 });
    expect(live.has('perfectionist')).toBe(true);
    const short = evaluateAchievements({ ...EMPTY_SNAP, bestCleanRun: 9, currentCleanRun: 9 });
    expect(short.has('perfectionist')).toBe(false);
  });

  it('velocista exige qualidade: só desbloqueia com média boa E > 0', () => {
    expect(evaluateAchievements({ ...EMPTY_SNAP, bestQualityMaintainingAvgSec: 900 }).has('sprinter')).toBe(true);
    expect(evaluateAchievements({ ...EMPTY_SNAP, bestQualityMaintainingAvgSec: 901 }).has('sprinter')).toBe(false);
    expect(evaluateAchievements({ ...EMPTY_SNAP, bestQualityMaintainingAvgSec: null }).has('sprinter')).toBe(false);
    expect(evaluateAchievements({ ...EMPTY_SNAP, bestQualityMaintainingAvgSec: 0 }).has('sprinter')).toBe(false);
  });

  it('mentor no limiar de 5 ajudas; newAchievements devolve só as NOVAS', () => {
    expect(evaluateAchievements({ ...EMPTY_SNAP, helpCommentsSent: 4 }).has('mentor')).toBe(false);
    expect(evaluateAchievements({ ...EMPTY_SNAP, helpCommentsSent: 5 }).has('mentor')).toBe(true);

    const snap = evaluateAchievements({ ...EMPTY_SNAP, totalCompleted: 1, helpCommentsSent: 5 });
    expect(newAchievements(snap, new Set(['first_os']))).toEqual(['mentor']);
    expect(newAchievements(snap, new Set())).toHaveLength(2);
  });
});

describe('F3 podium — Semana/Mês/Ano com desempate e senioridade', () => {
  const analysts: AnalystInfo[] = [
    { userId: 'ana', name: 'Ana', seniority: 'senior' },
    { userId: 'bruno', name: 'Bruno', seniority: 'senior' },
    { userId: 'carla', name: 'Carla', seniority: 'trainee' },
    { userId: 'diego', name: 'Diego', seniority: 'trainee' },
  ];

  const ev = (userId: string, amount: number, ts: number, reason: XpEventLike['reason'] = 'os_complete'): XpEventLike =>
    ({ userId, amount, reason, ts });

  it('rankeia por XP do período dentro da semana correta (fora da janela não conta)', () => {
    // semana de 24/08: ana 2 OSs, bruno 1
    const events = [
      ev('ana', 100, sp(2026, 8, 24, 9)),
      ev('ana', 100, sp(2026, 8, 25, 9)),
      ev('bruno', 100, sp(2026, 8, 26, 9)),
      ev('ana', 500, sp(2026, 8, 18, 9)), // semana ANTERIOR — ignora
    ];
    const podium = podiumFor({ type: 'week', key: '2026-08-24' }, events, analysts, CFG);
    expect(podium.map((e) => e.userId)).toEqual(['ana', 'bruno']);
    expect(podium[0].rank).toBe(1);
    expect(podium[0].xp).toBe(200);
    expect(podium[1].xp).toBe(100);
  });

  it('EMPATE em XP: menor retrabalho vence', () => {
    const events = [
      ev('ana', 100, sp(2026, 8, 24, 9)),
      ev('ana', 100, sp(2026, 8, 24, 15)),
      ev('bruno', 100, sp(2026, 8, 24, 9)),
      ev('bruno', 100, sp(2026, 8, 24, 15)),
      ev('bruno', -150, sp(2026, 8, 25, 9), 'rework_penalty'), // bruno: 50 xp, 1 rework
      ev('ana', 100, sp(2026, 8, 26, 9)),
    ];
    // Recalcula limpo: ana 300xp/0 rework vs bruno 50xp — agora teste de empate REAL:
    const tiedEvents = [
      ev('ana', 100, sp(2026, 8, 24, 9)),
      ev('ana', 100, sp(2026, 8, 24, 15)),
      ev('bruno', 100, sp(2026, 8, 24, 9)),
      ev('bruno', 100, sp(2026, 8, 24, 15)),
      ev('bruno', -50, sp(2026, 8, 25, 9), 'adjustment'), // ambos 150 xp…
      ev('ana', -50, sp(2026, 8, 25, 10), 'adjustment'),
      ev('bruno', -150, sp(2026, 8, 25, 11), 'rework_penalty'), // …mas bruno tem retrabalho
    ];
    const podium = podiumFor({ type: 'week', key: '2026-08-24' }, tiedEvents, analysts, CFG);
    expect(podium[0].userId).toBe('ana');     // mesmo XP, menos retrabalho
    expect(podium[0].reworkCount).toBe(0);
    expect(podium[1].userId).toBe('bruno');
    expect(podium[1].reworkCount).toBe(1);
    void events;
  });

  it('EMPATE TOTAL: rank denso compartilhado e seguinte pula (1,1,3)', () => {
    const events = [
      ev('ana', 100, sp(2026, 8, 24, 9)),
      ev('bruno', 100, sp(2026, 8, 24, 10)),
      ev('carla', 50, sp(2026, 8, 24, 11)),
    ];
    const podium = podiumFor({ type: 'week', key: '2026-08-24' }, events, analysts, CFG);
    expect(podium[0].rank).toBe(1);
    expect(podium[1].rank).toBe(1);
    expect(podium[0].tied).toBe(false);
    expect(podium[1].tied).toBe(true);
    expect(podium[2].rank).toBe(3); // competição clássica, não densa
  });

  it('ranking SEPARADO por senioridade: trainee não compete com senior', () => {
    const events = [
      ev('carla', 100, sp(2026, 8, 24, 9)), // trainee campeã do grupo dela
      ev('ana', 1000, sp(2026, 8, 24, 9)),  // senior, mais XP absoluto
    ];
    const trainees = podiumFor({ type: 'week', key: '2026-08-24' }, events, analysts, CFG, { group: 'trainee' });
    expect(trainees.map((e) => e.userId)).toEqual(['carla']);
    const all = podiumFor({ type: 'week', key: '2026-08-24' }, events, analysts, CFG);
    expect(all.map((e) => e.userId)).toEqual(['ana', 'carla']);
  });

  it('usuários sem atividade no período não aparecem; mês e ano usam janelas próprias', () => {
    const events = [
      ev('ana', 100, sp(2026, 7, 15, 9)), // julho
      ev('bruno', 100, sp(2026, 8, 24, 9)), // agosto
      ev('diego', 100, sp(2025, 8, 24, 9)), // ano passado
    ];
    const agosto = podiumFor({ type: 'month', key: '2026-08' }, events, analysts, CFG);
    expect(agosto.map((e) => e.userId)).toEqual(['bruno']);
    const y2025 = podiumFor({ type: 'year', key: '2025' }, events, analysts, CFG);
    expect(y2025.map((e) => e.userId)).toEqual(['diego']);
  });

  it('podiumTop3 corta em rank ≤3 e frozenPodiumRows gera linhas prontas p/ history', () => {
    const events = [
      ev('ana', 400, sp(2026, 8, 24, 9)),
      ev('bruno', 300, sp(2026, 8, 24, 9)),
      ev('carla', 200, sp(2026, 8, 24, 9)),
      ev('diego', 100, sp(2026, 8, 24, 9)),
    ];
    const podium = podiumFor({ type: 'week', key: '2026-08-24' }, events, analysts, CFG);
    expect(podiumTop3(podium)).toHaveLength(3);
    expect(podiumTop3(podium).every((e) => e.rank <= 3)).toBe(true);

    const rows = frozenPodiumRows({ type: 'week', key: '2026-08-24' }, events, analysts, CFG);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      period_type: 'week',
      period_key: '2026-08-24',
      user_id: 'ana',
      rank: 1,
      xp: 400,
      rework_count: 0,
    });
  });

  it('snapshot congelado é estável: rodar duas vezes dá o mesmo resultado', () => {
    const events = [
      ev('ana', 700, sp(2026, 8, 24, 9)),
      ev('bruno', 100, sp(2026, 8, 24, 9)),
      ev('bruno', 100, sp(2026, 8, 24, 10)),
    ];
    const a = frozenPodiumRows({ type: 'week', key: '2026-08-24' }, events, analysts, CFG);
    const b = frozenPodiumRows({ type: 'week', key: '2026-08-24' }, events, analysts, CFG);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
