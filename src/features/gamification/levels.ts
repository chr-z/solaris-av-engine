// Solaris v3 — Feature Pack "Analista Feliz" — F3 Gamificação.
//
// Escada de níveis da spec C1: Trainee → Assistente → Analista →
// Editor Sênior → Diretor de QC → Lenda do Estúdio. Cada nível define a
// moldura do avatar (UI da F4 consome `levelProgress` p/ barra animada).
//
// PURA: entrada = XP acumulado; saída determinística. Sem estado.

export type LevelId =
  | 'trainee'
  | 'assistente'
  | 'analista'
  | 'editor_senior'
  | 'diretor_qc'
  | 'lenda';

export interface LevelDef {
  id: LevelId;
  namePt: string;
  nameEn: string;
  /** XP mínimo p/ alcançar o nível (limiar inferior inclusivo). */
  minXp: number;
}

export const LEVELS: readonly LevelDef[] = Object.freeze([
  { id: 'trainee',       namePt: 'Trainee',          nameEn: 'Trainee',       minXp: 0 },
  { id: 'assistente',    namePt: 'Assistente',       nameEn: 'Assistant',     minXp: 500 },
  { id: 'analista',      namePt: 'Analista',         nameEn: 'Analyst',       minXp: 2_000 },
  { id: 'editor_senior', namePt: 'Editor Sênior',    nameEn: 'Senior Editor', minXp: 6_000 },
  { id: 'diretor_qc',    namePt: 'Diretor de QC',    nameEn: 'QC Director',   minXp: 15_000 },
  { id: 'lenda',         namePt: 'Lenda do Estúdio', nameEn: 'Studio Legend', minXp: 40_000 },
]);

/** Nível atual dado o XP (limiares ordenados; empata no limite inferior). */
export function levelForXp(xp: number): LevelDef {
  if (!Number.isFinite(xp)) return LEVELS[0];
  let current = LEVELS[0];
  for (const lvl of LEVELS) if (xp >= lvl.minXp) current = lvl;
  return current;
}

/** Próximo nível ou null quando já é Lenda (topo da escada). */
export function nextLevelForXp(xp: number): LevelDef | null {
  for (const lvl of LEVELS) if (lvl.minXp > xp) return lvl;
  return null;
}

/** Fração 0–1 dentro do nível atual (barra de XP animada do perfil). */
export function levelProgress(xp: number): {
  current: LevelDef;
  next: LevelDef | null;
  fraction: number;
  xpIntoLevel: number;
  xpToNext: number | null;
} {
  const current = levelForXp(xp);
  const next = nextLevelForXp(xp);
  if (!next) {
    return { current, next: null, fraction: 1, xpIntoLevel: xp - current.minXp, xpToNext: null };
  }
  const span = next.minXp - current.minXp;
  const xpIntoLevel = xp - current.minXp;
  return {
    current,
    next,
    fraction: Math.max(0, Math.min(1, xpIntoLevel / span)),
    xpIntoLevel,
    xpToNext: next.minXp - xp,
  };
}

/** XP exato em que o próximo level-up acontece (p/ toast/preview). */
export function xpForLevel(levelId: LevelId): number {
  const lvl = LEVELS.find((l) => l.id === levelId);
  if (!lvl) throw new Error(`nível desconhecido: ${levelId}`);
  return lvl.minXp;
}
