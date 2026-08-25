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

import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { SAO_PAULO_CLOCK } from '../../features/gamification/periods';

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
  const liveTop3 =
    podiumPeriod === 'week' ? top3
      : podiumPeriod === 'month' ? podiumMonth.slice(0, 3)
        : podiumYear.slice(0, 3);

  const history = useMemo(() => historyKeys(profile), [profile]);

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
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">{t('league.historyEmpty')}</p>
        ) : (
          <ul className="mt-3 space-y-2" data-testid="league-history">
            {history.map(({ type, key }) => {
              const rows = profile.podiumHistory[`${type}:${key}`] ?? [];
              return (
                <li
                  key={`${type}:${key}`}
                  className="rounded-lg border border-solar-dark-border px-3 py-2"
                >
                  <p className="text-sm font-semibold text-gray-200">
                    {formatPeriodLabel(type, key, lang)}
                  </p>
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
