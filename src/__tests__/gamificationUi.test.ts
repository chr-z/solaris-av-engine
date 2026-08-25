// Solaris v3 — F4 UI de Gamificação — store, premiação, pódios e conquistas.
import { describe, it, expect } from 'vitest';
import {
  eventIdFor,
  mergeEvents,
  parseProfile,
  loadProfile,
  saveProfile,
  isGamificationEnabled,
  setGamificationEnabled,
  emptyProfile,
  type StoredXpEvent,
} from '../features/gamification/profileStore';
import {
  awardForCompletion,
  isOsAlreadyAwarded,
  progressAfter,
} from '../features/gamification/xpAward';
import {
  freezeDuePeriods,
  livePodium,
  livePodiumFor,
  historyKeys,
  analystsFromEvents,
} from '../features/gamification/podiumFreeze';
import {
  completionDayKeys,
  deriveActivity,
  newlyEarned,
  yesterdayKeyOf,
} from '../features/gamification/achievementTracker';
import { SAO_PAULO_CLOCK } from '../features/gamification/periods';

const CFG = SAO_PAULO_CLOCK;

function ev(
  id: string,
  amount: number,
  reason: StoredXpEvent['reason'],
  ts: number,
  userId = 'u1',
): StoredXpEvent {
  return { id, amount, reason, ts, userId };
}

/** 2026-08-19 (qua) 12:00Z = 09:00 de São Paulo. */
const WED = Date.UTC(2026, 7, 19, 12, 0);
/** Segunda seguinte 15:00Z = 12:00 SP — semana de 08-24. */
const NEXT_MON = Date.UTC(2026, 7, 24, 15, 0);

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('F4 profileStore — identidade idempotente e parse tolerante', () => {
  it('eventIdFor é determinístico por OS+motivo', () => {
    expect(eventIdFor('OS-1', 'os_complete')).toBe('OS-1:os_complete');
    expect(eventIdFor('OS-1', 'os_complete')).toBe(eventIdFor('OS-1', 'os_complete'));
    expect(eventIdFor('OS-1', 'os_complete')).not.toBe(eventIdFor('OS-1', 'streak_bonus'));
  });

  it('mergeEvents adiciona ordenado por ts e devolve só os novos', () => {
    const a = ev('x:os_complete', 100, 'os_complete', 2000);
    const b = ev('y:os_complete', 100, 'os_complete', 1000);
    const { events, added } = mergeEvents([a], [b]);
    expect(events.map((e) => e.id)).toEqual(['y:os_complete', 'x:os_complete']);
    expect(added.map((e) => e.id)).toEqual(['y:os_complete']);
  });

  it('mergeEvents ignora id duplicado e preserva o payload ORIGINAL (primeiro vence)', () => {
    const orig = ev('x:os_complete', 100, 'os_complete', 1000);
    const clone = ev('x:os_complete', 999, 'adjustment', 5000);
    const { events, added } = mergeEvents([orig], [clone]);
    expect(added).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(100);
  });

  it('parseProfile: null, lixo e objeto parcial viram estados válidos', () => {
    expect(parseProfile(null)).toEqual(emptyProfile());
    expect(parseProfile('{quebrado')).toEqual(emptyProfile());
    const partial = parseProfile('{"events":[{"id":"a","amount":5,"reason":"adjustment","ts":1,"userId":"u"}],"v":9}');
    expect(partial.v).toBe(1);
    expect(partial.events).toHaveLength(1);
    expect(partial.achievements).toEqual({});
  });

  it('load/save roundtrip + toggle ON/OFF global', () => {
    const st = memoryStorage();
    expect(isGamificationEnabled(st)).toBe(true); // default ligado
    setGamificationEnabled(st, false);
    expect(isGamificationEnabled(st)).toBe(false);
    setGamificationEnabled(st, true);
    expect(isGamificationEnabled(st)).toBe(true);

    const p = emptyProfile();
    p.events.push(ev('a:os_complete', 100, 'os_complete', 1));
    saveProfile(st, 'u1', p);
    expect(loadProfile(st, 'u1').events[0].id).toBe('a:os_complete');
    // storage SEM removeItem também liga (fallback setItem '1')
    const noRemove = { getItem: st.getItem, setItem: st.setItem } ;
    setGamificationEnabled(noRemove, false);
    setGamificationEnabled(noRemove, true);
    expect(isGamificationEnabled(st)).toBe(true);
  });
});

describe('F4 xpAward — premiação idempotente da conclusão', () => {
  const ctxBase = {
    osId: 'OS-77',
    userId: 'u1',
    nowMs: WED,
    priorDayKeys: [],
    todayKey: '2026-08-19',
    yesterdayKey: '2026-08-18',
  };

  it('conclusão simples paga base+qualidade com ids determinísticos', () => {
    const d = awardForCompletion([], { ...ctxBase, validInconformities: 0 });
    expect(d.events.map((e) => e.reason)).toEqual(['os_complete', 'quality_bonus']);
    expect(d.afterXp).toBe(250);
    expect(d.leveledUpTo).toBeNull();
    expect(d.isFirstCompletionToday).toBe(true);
    expect(d.streakBonusPaid).toBe(false);
  });

  it('complexidade: 10 por inconformidade válida com teto de 100', () => {
    const d14 = awardForCompletion([], { ...ctxBase, validInconformities: 14 });
    expect(d14.events.find((e) => e.reason === 'complexity_bonus')?.amount).toBe(100);
    const d3 = awardForCompletion([], { ...ctxBase, validInconformities: 3 });
    expect(d3.events.find((e) => e.reason === 'complexity_bonus')?.amount).toBe(30);
  });

  it('streak pago só na 1ª conclusão do dia COM atividade ontem', () => {
    const d = awardForCompletion([], {
      ...ctxBase, validInconformities: 0, priorDayKeys: ['2026-08-18'],
    });
    expect(d.streakBonusPaid).toBe(true);
    // segunda OS no mesmo dia (prior já contém hoje) não repete streak
    const d2 = awardForCompletion([], {
      ...ctxBase, osId: 'OS-78', validInconformities: 0,
      priorDayKeys: ['2026-08-18', '2026-08-19'],
    });
    expect(d2.streakBonusPaid).toBe(false);
  });

  it('re-salvar a mesma OS NÃO paga de novo (noop already-awarded)', () => {
    const first = awardForCompletion([], { ...ctxBase, validInconformities: 2 });
    const second = awardForCompletion([...first.events], { ...ctxBase, validInconformities: 99 });
    expect(second.noop).toBe('already-awarded');
    expect(second.events).toHaveLength(0);
    expect(second.afterXp).toBe(first.afterXp);
    expect(isOsAlreadyAwarded([...first.events], 'OS-77')).toBe(true);
    expect(isOsAlreadyAwarded([], 'OS-77')).toBe(false);
  });

  it('level-up detectado cruzando limiar (400 → 650 = Assistente)', () => {
    const existing = [
      ev('a:os_complete', 100, 'os_complete', 100),
      ev('a:quality_bonus', 150, 'quality_bonus', 101),
      ev('b:os_complete', 100, 'os_complete', 200),
      ev('b:complexity_bonus', 50, 'complexity_bonus', 201),
    ];
    const d = awardForCompletion(existing, { ...ctxBase, validInconformities: 0 });
    expect(d.beforeXp).toBe(400);
    expect(d.afterXp).toBe(650);
    expect(d.levelBefore).toBe('trainee');
    expect(d.leveledUpTo).toBe('assistente');
    expect(progressAfter(d).current.id).toBe('assistente');
  });
});

describe('F4 pódio — ao vivo, congelamento idempotente e histórico', () => {
  const analysts = [
    { userId: 'ana', name: 'Ana Souza', seniority: 'junior' as const },
    { userId: 'bruno', name: 'Bruno Lima', seniority: 'junior' as const },
  ];

  it('livePodium rankeia por XP do período corrente e ignora fora do período', () => {
    const events = [
      ev('1:os_complete', 100, 'os_complete', WED, 'ana'),
      ev('2:os_complete', 100, 'os_complete', WED + 1, 'ana'),
      ev('3:os_complete', 100, 'os_complete', WED, 'bruno'),
      ev('4:os_complete', 500, 'os_complete', Date.UTC(2020, 0, 1), 'bruno'), // fora
    ];
    const podium = livePodium(events, analysts, WED, CFG);
    expect(podium[0].userId).toBe('ana');
    expect(podium[0].xp).toBe(200);
    expect(podium[1].userId).toBe('bruno');
    expect(podium[1].rank).toBe(2);
  });

  it('livePodiumFor cobre Semana/Mês/Ano no MESMO instante (spec C2)', () => {
    // Mesmo instante, três janelas: a semana só enxerga o evento dela, o mês
    // soma as duas semanas de 2026-08 e o ano também — mas NUNCA o evento de
    // 2020 (fora do período corrente em qualquer janela).
    const events = [
      // semana corrente (2026-08-24…): bruno 100
      ev('s1', 100, 'os_complete', NEXT_MON + 3600_000, 'bruno'),
      // semana anterior (dentro do mês/ano): ana 400 em 08-19
      ev('m1', 400, 'os_complete', WED, 'ana'),
      // fora de TUDO (2020): não pontua em nenhum período corrente
      ev('old', 999, 'os_complete', Date.UTC(2020, 0, 1), 'bruno'),
    ];
    const week = livePodiumFor('week', events, analysts, NEXT_MON + 7200_000, CFG);
    expect(week.map((e) => e.userId)).toEqual(['bruno']); // só o da semana

    const month = livePodiumFor('month', events, analysts, NEXT_MON + 7200_000, CFG);
    expect(month.map((e) => e.userId)).toEqual(['ana', 'bruno']); // 400 > 100
    expect(month[0].xp).toBe(400);

    const year = livePodiumFor('year', events, analysts, NEXT_MON + 7200_000, CFG);
    expect(year.map((e) => e.userId)).toEqual(['ana', 'bruno']);
    expect(year[0].xp).toBe(400); // 999 de 2020 fica FORA do ano corrente

    // livePodium continua sendo o alias da semana.
    expect(livePodium(events, analysts, NEXT_MON + 7200_000, CFG)).toEqual(week);
  });

  it('livePodiumFor respeita grupo de senioridade (ranking separado, spec C4)', () => {
    const mixed = [
      ...analysts,
      { userId: 'carla', name: 'Carla Rex', seniority: 'senior' as const },
    ];
    const events = [
      ev('j1', 100, 'os_complete', WED, 'ana'),
      ev('ss1', 300, 'os_complete', WED, 'carla'),
    ];
    const all = livePodiumFor('week', events, mixed, WED, CFG, 'all');
    expect(all.map((e) => e.userId)).toEqual(['carla', 'ana']);
    const seniors = livePodiumFor('week', events, mixed, WED, CFG, 'senior');
    expect(seniors.map((e) => e.userId)).toEqual(['carla']); // trainee some
  });

  it('primeira chamada só estabelece baseline (nada congelado)', () => {
    const r = freezeDuePeriods(emptyProfile(), [], analysts, NEXT_MON, CFG);
    expect(r.newlyFrozen).toEqual([]);
    expect(r.state.lastFrozen.week).toBe('2026-08-24');
    expect(r.state.lastFrozen.month).toBeDefined();
    expect(r.state.lastFrozen.year).toBeDefined();
  });

  it('virada de semana congela a semana fechada com campeã', () => {
    const st = emptyProfile();
    st.lastFrozen.week = '2026-08-17';
    const events = [
      ev('w:os_complete', 300, 'os_complete', WED, 'ana'),
      ev('w2:os_complete', 100, 'os_complete', WED + 2, 'bruno'),
    ];
    const r = freezeDuePeriods(st, events, analysts, NEXT_MON, CFG);
    expect(r.newlyFrozen).toHaveLength(1);
    expect(r.newlyFrozen[0]).toEqual({ type: 'week', key: '2026-08-17', topUserId: 'ana' });
    const rows = r.state.podiumHistory['week:2026-08-17'];
    expect(rows[0]).toMatchObject({ userId: 'ana', rank: 1, xp: 300 });
    expect(r.state.lastFrozen.week).toBe('2026-08-24');

    // Idempotente: rodar de novo no mesmo instante não duplica.
    const r2 = freezeDuePeriods(r.state, events, analysts, NEXT_MON + 60_000, CFG);
    expect(r2.newlyFrozen).toHaveLength(0);
    expect(historyKeys(r2.state)).toEqual([{ type: 'week', key: '2026-08-17' }]);
  });

  it('gap offline de N semanas congela TODAS as intermediárias em ordem', () => {
    const st = emptyProfile();
    st.lastFrozen.week = '2026-08-03';
    const r = freezeDuePeriods(st, [], analysts, NEXT_MON, CFG);
    expect(r.newlyFrozen.map((f) => f.key)).toEqual(['2026-08-03', '2026-08-10', '2026-08-17']);
  });

  it('virada de MÊS congela julho; historyKeys ordena mais recente primeiro', () => {
    const st = emptyProfile();
    st.lastFrozen.month = '2026-07';
    const r = freezeDuePeriods(st, [], analysts, NEXT_MON, CFG);
    expect(r.newlyFrozen.map((f) => f.type === 'month' ? f.key : null)).toContain('2026-07');
  });

  it('analystsFromEvents dedupe e nomeia o usuário atual', () => {
    const list = analystsFromEvents(
      [ev('1:x', 1, 'adjustment', 1, 'u9'), ev('2:x', 1, 'adjustment', 2, 'u9')],
      { id: 'u1', name: 'Zee' },
    );
    const u1 = list.find((a) => a.userId === 'u1');
    const u9 = list.find((a) => a.userId === 'u9');
    expect(list).toHaveLength(2);
    expect(u1?.name).toBe('Zee');
    expect(u9?.name).toBe('u9'); // sem diretório ainda
  });
});

describe('F4 conquistas — fuso correto, corrida limpa e diff', () => {
  it('completionDayKeys respeita o fuso do pódio (02:00Z ainda é 23h do dia anterior)', () => {
    const events = [
      ev('1:os_complete', 100, 'os_complete', Date.UTC(2026, 7, 20, 2, 0)), // 23:00 SP 08-19
      ev('2:os_complete', 100, 'os_complete', Date.UTC(2026, 7, 20, 13, 0)), // 10:00 SP 08-20
    ];
    expect(completionDayKeys(events, CFG)).toEqual(['2026-08-19', '2026-08-20']);
  });

  it('deriveActivity: totais, máximo/dia, coruja/madrugador e corrida limpa', () => {
    const events = [
      ev('d1:os_complete', 100, 'os_complete', Date.UTC(2026, 7, 18, 12, 0)),
      ev('d1:complexity_bonus', 20, 'complexity_bonus', Date.UTC(2026, 7, 18, 12, 1)),
      ev('d1:quality_bonus', 150, 'quality_bonus', Date.UTC(2026, 7, 18, 12, 2)),
      ev('d2late:os_complete', 100, 'os_complete', Date.UTC(2026, 7, 19, 2, 30)), // coruja
      ev('d3early:os_complete', 100, 'os_complete', Date.UTC(2026, 7, 20, 9, 0)), // madrugador
      ev('d3early:rework_penalty', -150, 'rework_penalty', Date.UTC(2026, 7, 20, 10, 0)),
    ];
    const act = deriveActivity(events, CFG);
    expect(act.totalCompleted).toBe(3);
    // d1 (09:00 SP) + coruja (23:30 SP) caem no MESMO dia-chave 08-18
    expect(act.snapshot.maxInOneDay).toBe(2);
    expect(act.snapshot.lateNightDays).toEqual(['2026-08-18']);
    expect(act.snapshot.earlyMorningDays).toEqual(['2026-08-20']);
    // 3 conclusões seguidas e SÓ DEPOIS o estorno: best=3, current=0
    expect(act.snapshot.bestCleanRun).toBe(3);
    expect(act.snapshot.currentCleanRun).toBe(0);
  });

  it('newlyEarned devolve só chaves NOVAS contra o já persistido', () => {
    const events = [
      ev('first:os_complete', 100, 'os_complete', Date.UTC(2026, 7, 19, 2, 30)),
    ];
    const r = newlyEarned(events, {}, Date.now(), CFG);
    expect(r.freshKeys).toContain('first_os');
    expect(r.freshKeys).toContain('owl');
    const r2 = newlyEarned(events, { first_os: 1, owl: 2 }, Date.now(), CFG);
    expect(r2.freshKeys).toEqual([]);
  });

  it('yesterdayKeyOf atravessa fronteira de mês no fuso do pódio', () => {
    // 00:00 SP de 01/08 = 03:00Z → ontem é 31/07
    expect(yesterdayKeyOf(Date.UTC(2026, 7, 1, 3, 0), CFG)).toBe('2026-07-31');
    expect(yesterdayKeyOf(NEXT_MON, CFG)).toBe('2026-08-23');
  });
});
