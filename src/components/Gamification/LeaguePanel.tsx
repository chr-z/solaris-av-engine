// Solaris v3 — F4 UI de Gamificação — "Liga dos Analistas" (#/liga).
//
// Perfil com barra XP animada + moldura por nível, pódio Semana/Mês/Ano ao
// vivo, vitrine de conquistas, histórico navegável de pódios e toggle admin
// ON/OFF global. Chunk SEPARADO (React.lazy) — o initial bundle não paga nada
// disto (guardrail E: features pesadas sempre lazy).
//
// Era offline/local: os dados vêm do profileStore (localStorage por usuário).
// O F5 (dashboard) trocará a fonte por users_roles/xp_events do backend —
// os núcleos puros permanecem idênticos.

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useI18n } from '../../i18n/I18nContext';
// Troca D #3: rótulo i18n de chaves de período ('2026-03' → 'março de 2026').
import { formatPeriodLabel } from '../../features/i18n/format';
import { useAdminRole } from '../../hooks/useAdminRole';
import {
  LEVELS,
  levelProgress,
  type LevelId,
} from '../../features/gamification/levels';
import { ACHIEVEMENTS } from '../../features/gamification/achievements';
import { totalXp } from '../../features/gamification/xp';
import {
  PROFILE_KEY_PREFIX,
  parseProfile,
  isGamificationEnabled,
  setGamificationEnabled,
  type ProfileState,
} from '../../features/gamification/profileStore';
import {
  livePodiumFor,
  historyKeys,
  analystsFromEvents,
} from '../../features/gamification/podiumFreeze';
import {
  isPodiumShareAllowed,
  setPodiumShareAllowed,
} from '../../features/gamification/podiumSharePref';
import {
  buildPodiumCsv,
  buildPodiumXlsx,
  podiumExportFilename,
  type PodiumExportInput,
} from '../../features/gamification/podiumExport';
import {
  SAO_PAULO_CLOCK,
  currentPeriodKey,
  closedPeriodRange,
} from '../../features/gamification/periods';
import {
  loadTeamGoal,
  saveTeamGoal,
  teamProgress,
  goalStatus,
  type TeamGoalConfig,
} from '../../features/gamification/teamGoal';

// Relógio FORA do render (purity): o valor muda sem re-render do React.
let nowMsCached = 0;
function readNowMs(): number {
  if (!nowMsCached) nowMsCached = Date.now();
  return nowMsCached;
}

/** Moldura CSS por nível (gradiente fica mais rico subindo a escada). */
const LEVEL_FRAME: Record<LevelId, string> = {
  trainee: 'ring-1 ring-gray-500',
  assistente: 'ring-2 ring-sky-400',
  analista: 'ring-2 ring-emerald-400',
  editor_senior: 'ring-2 ring-violet-400',
  diretor_qc: 'ring-2 ring-amber-400',
  lenda: 'ring-2 ring-transparent bg-gradient-to-r from-fuchsia-500 via-orange-400 to-amber-300',
};

const PODIUM_MEDALS = ['🥇', '🥈', '🥉'] as const;

/** Abas de período do pódio ao vivo (spec C2: Semana/Mês/Ano). */
type PodiumPeriod = 'week' | 'month' | 'year';
const PERIOD_TABS: readonly PodiumPeriod[] = ['week', 'month', 'year'];

function levelName(id: LevelId, lang: 'pt' | 'en'): string {
  const def = LEVELS.find((l) => l.id === id);
  if (!def) return id;
  return lang === 'pt' ? def.namePt : def.nameEn;
}

function formatNumber(n: number, lang: 'pt' | 'en'): string {
  return new Intl.NumberFormat(lang === 'pt' ? 'pt-BR' : 'en-US').format(n);
}

const PodiumColumn: React.FC<{
  medal: string;
  name: string;
  xp: number;
  tied: boolean;
  heightCls: string;
}> = ({ medal, name, xp, tied, heightCls }) => (
  <div className={`flex flex-col items-center justify-end rounded-t-lg border border-solar-dark-border bg-solar-dark-surface px-3 pt-3 pb-2 ${heightCls}`}>
    <span aria-hidden="true" className="text-2xl leading-none">{medal}</span>
    <span className="mt-1 max-w-full truncate text-sm font-semibold text-gray-100" title={name}>{name}</span>
    <span className="tnum text-xs text-amber-300">XP {formatNumber(xp, 'pt')}</span>
    {tied && <span className="text-[10px] text-gray-400">(empate)</span>}
  </div>
);

export interface LeaguePanelProps {
  userProfile: { id: string; name: string };
}

const LeaguePanel: React.FC<LeaguePanelProps> = ({ userProfile }) => {
  const { t, locale } = useI18n();
  const lang = locale === 'pt' ? 'pt' : 'en';
  const { isAdmin } = useAdminRole();

  const storage = useMemo(
    () => ({
      getItem: (k: string) => window.localStorage.getItem(k),
      setItem: (k: string, v: string) => window.localStorage.setItem(k, v),
      removeItem: (k: string) => window.localStorage.removeItem(k),
    }),
    [],
  );

  // Storage é autoritativo e ASSINADO (useSyncExternalStore): gravações do
  // hook (mesma aba via evento custom, outras abas via 'storage') chegam
  // aqui sem nenhum effect. Snapshot com identidade estável por raw-string.
  const snapRef = useRef<{ raw: string; val: ProfileState } | null>(null);
  const subscribeStorage = useCallback((onChange: () => void) => {
    window.addEventListener('storage', onChange);
    window.addEventListener('solaris:gamification', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('solaris:gamification', onChange);
    };
  }, []);
  const getProfileSnapshot = useCallback(() => {
    const raw = window.localStorage.getItem(PROFILE_KEY_PREFIX + userProfile.id) ?? '';
    if (!snapRef.current || snapRef.current.raw !== raw) {
      snapRef.current = { raw, val: parseProfile(raw) };
    }
    return snapRef.current.val;
  }, [userProfile.id]);
  const profile = useSyncExternalStore(subscribeStorage, getProfileSnapshot, getProfileSnapshot);
  const [gamificationOn, setGamificationOn] = useState(() =>
    isGamificationEnabled(storage),
  );

  const events = profile.events;
  const nowMs = readNowMs(); // relógio capturado fora do render (ver readNowMs)
  const xp = useMemo(() => totalXp(events), [events]);
  const progress = levelProgress(xp);

  // Pódios ao vivo por período — memo por (events, analysts, nowMs) para não
  // recomputar os três rankings a cada render.
  const podiumWeek = useMemo(
    () => livePodiumFor('week', events, analystsFromEvents(events, userProfile), nowMs, SAO_PAULO_CLOCK),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events],
  );
  const top3 = podiumWeek.slice(0, 3);
  const podiumMonth = useMemo(
    () => livePodiumFor('month', events, analystsFromEvents(events, userProfile), nowMs, SAO_PAULO_CLOCK),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events],
  );
  const podiumYear = useMemo(
    () => livePodiumFor('year', events, analystsFromEvents(events, userProfile), nowMs, SAO_PAULO_CLOCK),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events],
  );
  // Aba ativa do pódio ao vivo (default: Semana — o coração da meritocracia).
  const [podiumPeriod, setPodiumPeriod] = useState<PodiumPeriod>('week');

  // ── C4 Modo time: meta mensal do grupo vs XP somado ─────────────────
  const [goal, setGoal] = useState<TeamGoalConfig | null>(() => loadTeamGoal(storage));
  const [goalInput, setGoalInput] = useState('');
  const [goalError, setGoalError] = useState(false);
  const storageRef = useRef(storage);
  storageRef.current = storage;
  // Hot-reload: gravação aqui mesma, outra aba ('storage') ou outro lugar da
  // aba (evento 'solaris:team-goal-changed' emitido pelo saveTeamGoal).
  useEffect(() => {
    const reload = () => setGoal(loadTeamGoal(storageRef.current));
    window.addEventListener('solaris:team-goal-changed', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('solaris:team-goal-changed', reload);
      window.removeEventListener('storage', reload);
    };
  }, []);
  // Roster do time = mesmos analistas do pódio ao vivo + o usuário atual.
  const teamMemberIds = useMemo(
    () => [
      ...new Set([
        ...analystsFromEvents(events, userProfile).map((a) => a.userId),
      ]),
    ],
    [events, userProfile],
  );
  const monthRange = useMemo(
    () => closedPeriodRange('month', currentPeriodKey('month', nowMsCached, SAO_PAULO_CLOCK), SAO_PAULO_CLOCK),
    [], // mês corrente no boot — virada de mês re-monta o painel inteiro.
  );
  const teamMonth = useMemo(
    () => teamProgress(events, teamMemberIds, monthRange.fromMs, monthRange.toMs),
    [events, teamMemberIds, monthRange],
  );
  const goalStatusNow = goal
    ? { ...goalStatus(teamMonth.total, goal.monthlyXp), monthlyXp: goal.monthlyXp }
    : null;
  const liveTop3 =
    podiumPeriod === 'week' ? top3
      : podiumPeriod === 'month' ? podiumMonth.slice(0, 3)
        : podiumYear.slice(0, 3);

  const history = useMemo(() => historyKeys(profile), [profile]);

  // ── C4/E: exportação de pódio com opt-in explícito ─────────────────
  // Default OFF; só admin vê a seção e só o toggle liga o gate real.
  const [shareAllowed, setShareAllowedState] = useState(() =>
    isPodiumShareAllowed(storage),
  );

  /** Baixa bytes como arquivo (mesma mecânica dos exports do dashboard). */
  const downloadBytes = useCallback((bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadText = useCallback((text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  /** Exporta UM pódio (histórico ou ao vivo) no formato pedido. */
  const exportPodium = useCallback(
    (
      input: PodiumExportInput,
      format: 'csv' | 'xlsx',
    ) => {
      // O gate é duplo: bandeira de consentimento E papel admin (defesa em
      // profundidade — a UI já esconde, o núcleo recusa sem optIn).
      if (!isPodiumShareAllowed(storage)) return;
      if (format === 'csv') {
        const csv = buildPodiumCsv(input, { locale: lang, optIn: true });
        if (csv != null) {
          downloadText(csv, podiumExportFilename(input, 'csv'));
        }
        return;
      }
      const xlsx = buildPodiumXlsx(input, { locale: lang, optIn: true, now: new Date() });
      if (xlsx != null) {
        downloadBytes(xlsx, podiumExportFilename(input, 'xlsx'));
      }
    },
    [storage, lang, downloadText, downloadBytes],
  );

  if (!gamificationOn) {
    return (
      <main className="flex flex-col items-center justify-center h-screen gap-4 bg-solar-dark-bg text-gray-300 p-8 text-center">
        <h1 className="text-xl font-bold">{t('league.offTitle')}</h1>
        <p className="max-w-md text-sm">{t('league.offBody')}</p>
        {isAdmin && (
          <button
            data-testid="league-enable"
            onClick={() => {
              setGamificationEnabled(storage, true);
              setGamificationOn(true);
            }}
            className="px-4 py-2 text-sm font-semibold rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover"
          >
            {t('league.reenable')}
          </button>
        )}
      </main>
    );
  }

  const achievementsShown = ACHIEVEMENTS.map((def) => ({
    ...def,
    unlockedAt: profile.achievements[def.key as string] as number | undefined,
  }));

  return (
    <main className="min-h-screen bg-solar-dark-bg pb-16">
      {/* ── Cabeçalho ─────────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 pt-4 flex items-center justify-between gap-2">
        <a
          href="#/"
          data-testid="league-back"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-gray-500 text-gray-300 hover:bg-gray-500/10 text-sm transition-colors"
        >
          ← {t('admin.backToApp')}
        </a>
        {isAdmin && (
          <button
            data-testid="league-toggle"
            onClick={() => {
              setGamificationEnabled(storage, false);
              setGamificationOn(false);
            }}
            className="px-3 py-1.5 text-xs rounded-md border border-red-500/50 text-red-300 hover:bg-red-500/10 transition-colors"
          >
            {t('league.disable')}
          </button>
        )}
      </div>

      {/* ── Perfil / barra XP animada + moldura por nível ─────────── */}
      <section className="max-w-5xl mx-auto px-4 mt-6" aria-labelledby="league-profile-title">
        <h1 id="league-profile-title" className="text-lg font-bold text-gray-100">
          {t('league.title')}
        </h1>
        <div className="mt-4 flex items-center gap-4">
          <div
            data-testid="league-level-frame"
            className={`flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold text-white ${LEVEL_FRAME[progress.current.id]}`}
          >
            {userProfile.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold text-gray-100 truncate">{userProfile.name}</p>
              <p className="tnum text-sm text-amber-300">
                {formatNumber(xp, lang)} XP
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuenow={Math.round(progress.fraction * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('league.xpBar')}
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-solar-dark-border"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-orange-400 transition-all duration-700 motion-reduce:transition-none"
                style={{ width: `${Math.round(progress.fraction * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-gray-400">
              {levelName(progress.current.id, lang)}
              {progress.next && (
                <>
                  {' · '}
                  {formatNumber(progress.xpToNext ?? 0, lang)} XP →{' '}
                  {levelName(progress.next.id, lang)}
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ── Pódio ao vivo Semana/Mês/Ano (abas) 🥇🥈🥉 ──────────── */}
      <section className="max-w-5xl mx-auto px-4 mt-8" aria-labelledby="league-podium-title">
        <h2 id="league-podium-title" className="text-base font-bold text-gray-100">
          {t('league.podiumLive')}
        </h2>
        {/* Abas de período (radiogroup acessível, setas navegam). */}
        <div
          role="tablist"
          aria-label={t('league.podiumPeriod')}
          data-testid="league-period-tabs"
          className="mt-3 inline-flex rounded-md border border-solar-dark-border p-0.5"
        >
          {PERIOD_TABS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={podiumPeriod === p}
              tabIndex={podiumPeriod === p ? 0 : -1}
              onKeyDown={(e) => {
                const idx = PERIOD_TABS.indexOf(podiumPeriod);
                if (e.key === 'ArrowRight') setPodiumPeriod(PERIOD_TABS[(idx + 1) % PERIOD_TABS.length]);
                if (e.key === 'ArrowLeft') setPodiumPeriod(PERIOD_TABS[(idx + 2) % PERIOD_TABS.length]);
              }}
              onClick={() => setPodiumPeriod(p)}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                podiumPeriod === p
                  ? 'bg-solar-accent text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t(`league.period.${p}` as Parameters<typeof t>[0])}
            </button>
          ))}
        </div>
        {liveTop3.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">{t('league.podiumEmpty')}</p>
        ) : (
          <div data-testid="league-podium" className="mt-3 grid grid-cols-3 items-end gap-3">
            {/* Layout clássico: prata, ouro, bronze (empates preservados). */}
            {[1, 0, 2].map((slot) => {
              const entry = liveTop3[slot];
              if (!entry) return <div key={slot} />;
              return (
                <PodiumColumn
                  key={entry.userId}
                  medal={PODIUM_MEDALS[entry.rank - 1]}
                  name={entry.name}
                  xp={entry.xp}
                  tied={entry.tied}
                  heightCls={slot === 0 ? 'h-32' : slot === 1 ? 'h-24' : 'h-20'}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ── C4 Modo time: meta mensal do grupo ────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 mt-8" aria-labelledby="league-team-title">
        <h2 id="league-team-title" className="text-base font-bold text-gray-100">
          {t('league.team.title')}
        </h2>
        {goalStatusNow ? (
          <div data-testid="league-team-progress" className="mt-3 rounded-lg border border-solar-dark-border p-4">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <p className={goalStatusNow.met ? 'font-semibold text-emerald-300' : 'text-gray-100'}>
                {goalStatusNow.met
                  ? t('league.team.met')
                  : goalStatusNow.pct > 0
                    ? t('league.team.remaining', { remaining: formatNumber(Math.ceil(goalStatusNow.remaining), lang) })
                    : ''}
              </p>
              <p className="tnum text-gray-300">
                {t('league.team.progress', {
                  pct: Math.floor(goalStatusNow.pct),
                  goal: formatNumber(goalStatusNow.monthlyXp, lang),
                })}
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuenow={Math.min(100, Math.floor(goalStatusNow.pct))}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('league.team.title')}
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-solar-dark-border"
            >
              <div
                className={`h-full rounded-full transition-all duration-700 motion-reduce:transition-none ${goalStatusNow.met ? 'bg-emerald-400' : 'bg-solar-accent'}`}
                style={{ width: `${Math.min(100, Math.max(0, goalStatusNow.pct))}%` }}
              />
            </div>
          </div>
        ) : (
          <p data-testid="league-team-nogoal" className="mt-3 text-sm text-gray-400">
            {t('league.team.noGoal')}
          </p>
        )}
        {isAdmin && (
          <form
            data-testid="league-team-form"
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = Number(goalInput);
              if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
                setGoalError(true);
                return;
              }
              if (saveTeamGoal(storage, parsed)) {
                setGoal(loadTeamGoal(storage));
                setGoalInput('');
                setGoalError(false);
              }
            }}
          >
            <label htmlFor="team-goal-input" className="text-xs text-gray-400">
              {t('league.team.setLabel')}
            </label>
            <input
              id="team-goal-input"
              type="number"
              min={1}
              step={1}
              value={goalInput}
              onChange={(e) => {
                setGoalInput(e.target.value);
                setGoalError(false);
              }}
              className="w-32 rounded-md border border-solar-dark-border bg-solar-dark-surface px-2 py-1 text-sm text-gray-100"
            />
            <button
              type="submit"
              className="px-3 py-1 text-xs font-semibold rounded-md bg-solar-accent text-white hover:bg-solar-accent-hover"
            >
              {t('league.team.save')}
            </button>
            {goal != null && (
              <button
                type="button"
                onClick={() => {
                  if (saveTeamGoal(storage, null)) setGoal(null);
                }}
                className="px-3 py-1 text-xs rounded-md border border-red-500/50 text-red-300 hover:bg-red-500/10 transition-colors"
              >
                {t('league.team.remove')}
              </button>
            )}
          </form>
        )}
        {isAdmin && goalError && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {t('league.team.invalid')}
          </p>
        )}
      </section>

      {/* ── Conquistas (vitrine) ──────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 mt-8" aria-labelledby="league-ach-title">
        <h2 id="league-ach-title" className="text-base font-bold text-gray-100">
          {t('league.achievements')}
        </h2>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {achievementsShown.map((ach) => (
            <li
              key={ach.key}
              className={`rounded-lg border px-3 py-2 ${
                ach.unlockedAt != null
                  ? 'border-amber-400/40 bg-amber-400/5'
                  : 'border-solar-dark-border opacity-50'
              }`}
            >
              <p className="text-sm text-gray-100">
                <span aria-hidden="true">{ach.iconPt}</span>{' '}
                {lang === 'pt' ? ach.namePt : ach.nameEn}
              </p>
              <p className="text-xs text-gray-400">{ach.descriptionPt}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Histórico de pódios fechados ──────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 mt-8" aria-labelledby="league-history-title">
        <h2 id="league-history-title" className="text-base font-bold text-gray-100">
          {t('league.history')}
        </h2>
        {isAdmin && (
          <div className="mt-3 rounded-lg border border-solar-dark-border px-3 py-2">
            {/* C4/E: dados de pódio só saem daqui com consentimento EXPLÍCITO.
                Default OFF — sem esta chave ligada, nenhum botão exporta nada. */}
            <label className="flex items-start gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                data-testid="podium-share-toggle"
                checked={shareAllowed}
                onChange={(e) => {
                  const next = e.target.checked;
                  setPodiumShareAllowed(storage, next);
                  setShareAllowedState(next);
                }}
                className="mt-0.5 h-4 w-4 accent-solar-accent"
              />
              <span>
                {t('league.export.shareLabel')}
                <span className="block text-xs text-gray-500">
                  {t('league.export.shareHint')}
                </span>
              </span>
            </label>
          </div>
        )}
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">{t('league.historyEmpty')}</p>
        ) : (
          <ul className="mt-3 space-y-2" data-testid="league-history">
            {history.map(({ type, key }) => {
              const rows = profile.podiumHistory[`${type}:${key}`] ?? [];
              const canExport = isAdmin && shareAllowed && rows.length > 0;
              return (
                <li
                  key={`${type}:${key}`}
                  className="rounded-lg border border-solar-dark-border px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-gray-200">
                      {formatPeriodLabel(type, key, lang)}
                    </p>
                    {canExport && (
                      <span className="ml-auto flex gap-1">
                        <button
                          type="button"
                          data-testid={`podium-export-csv-${type}-${key}`}
                          onClick={() =>
                            exportPodium({ periodType: type, periodKey: key, rows }, 'csv')
                          }
                          className="rounded-md px-2 py-0.5 text-xs text-solar-accent hover:bg-solar-accent/10 transition-colors"
                        >
                          {t('league.export.csv')}
                        </button>
                        <button
                          type="button"
                          data-testid={`podium-export-xlsx-${type}-${key}`}
                          onClick={() =>
                            exportPodium({ periodType: type, periodKey: key, rows }, 'xlsx')
                          }
                          className="rounded-md px-2 py-0.5 text-xs text-solar-accent hover:bg-solar-accent/10 transition-colors"
                        >
                          {t('league.export.xlsx')}
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="tnum mt-1 text-xs text-gray-400">
                    {rows
                      .slice(0, 3)
                      .map((r, i) => `${PODIUM_MEDALS[i]} ${r.name} (${r.xp})`)
                      .join(' · ') || t('league.podiumEmpty')}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
};

export default LeaguePanel;
