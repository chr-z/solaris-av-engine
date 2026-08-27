// Solaris v3 — F4 UI de Gamificação.
//
// Toast elegante de conquista desbloqueada (spec C3) com micro-confete no
// level-up (spec C1). Acessível: role="status" (anunciado por leitor de tela),
// respeita prefers-reduced-motion (sem animação/confete — só o anúncio).

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { AchievementDef } from '../../features/gamification/achievements';

export interface Celebration {
  kind: 'achievement' | 'levelup';
  /** Chave estável p/ não repetir o mesmo toast na sessão. */
  id: string;
  icon: string;
  title: string;
  subtitle?: string;
}

const TOAST_MS = 5200;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * Fonte externa canônica (React 18 useSyncExternalStore): sem setState em
 * effect e sem leitura impura no render. Server snapshot = false (decoração).
 */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

const CONFETTI_COLORS = ['#f09a52', '#8f6ff7', '#f43f5e', '#34d399', '#fbbf24'];

const ConfettiBurst: React.FC = () => (
  <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-40 overflow-hidden">
    {Array.from({ length: 14 }, (_, i) => (
      <span
        key={i}
        className="solaris-confetti absolute top-0 block h-2 w-2 rounded-sm"
        style={{
          left: `${6 + i * 6.6}%`,
          backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          animationDelay: `${(i % 7) * 90}ms`,
        }}
      />
    ))}
  </div>
);

export interface AchievementToastProps {
  celebration: Celebration | null;
  onDone: () => void;
}

/** Um toast por vez; a fila fica a cargo do dono (App). */
const AchievementToast: React.FC<AchievementToastProps> = ({ celebration, onDone }) => {
  const reducedMotion = usePrefersReducedMotion();
  // Chave de sessão do toast atual: trocar celebration remonta via render
  // (estado derivado da prop — sem setState em effect).
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  if (celebration && seenKey !== celebration.id) {
    setSeenKey(celebration.id);
    setLeaving(false);
  }

  useEffect(() => {
    if (!celebration || seenKey !== celebration.id) return;
    const leaveTimer = window.setTimeout(() => setLeaving(true), TOAST_MS - 400);
    const doneTimer = window.setTimeout(onDone, TOAST_MS);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, [celebration, seenKey, onDone]);

  if (!celebration) return null;
  const isLevelUp = celebration.kind === 'levelup';

  return (
    <>
      {isLevelUp && !reducedMotion && <ConfettiBurst />}
      <div
        role="status"
        data-testid="gamification-toast"
        className={`fixed bottom-4 right-4 z-[70] max-w-xs rounded-xl border px-4 py-3 shadow-pop transition-all duration-300 ${
          isLevelUp
            ? 'border-amber-400/50 bg-gradient-to-r from-amber-400/10 to-orange-400/10'
            : 'border-solar-dark-border bg-solar-dark-surface'
        } ${leaving ? 'translate-y-2 opacity-0' : 'animate-fade-in-fast'}`}
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-100">
          <span aria-hidden="true" className="text-lg">{celebration.icon}</span>
          {celebration.title}
        </p>
        {celebration.subtitle && (
          <p className="mt-0.5 text-xs text-gray-400">{celebration.subtitle}</p>
        )}
      </div>
    </>
  );
};

/** Def → celebração de conquista (título/subtítulo já localizados). */
export function achievementCelebration(
  def: AchievementDef,
  lang: 'pt' | 'en',
  unlockedLabel: string,
): Celebration {
  return {
    kind: 'achievement',
    id: `ach:${def.key}`,
    icon: def.iconPt,
    title: lang === 'pt' ? def.namePt : def.nameEn,
    subtitle: unlockedLabel,
  };
}

export default AchievementToast;
