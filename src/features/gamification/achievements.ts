// Solaris v3 — Feature Pack "Analista Feliz" — F3 Gamificação.
//
// Catálogo de conquistas da spec C3 com predicados PUROS: a função central
// `evaluateAchievements` recebe um snapshot imutável da atividade do analista
// e devolve o conjunto de chaves que DEVEM estar desbloqueadas. O chamador
// persiste em `achievements` (idempotente por user+key) e dispara toast só
// para chaves NOVAS (diferença contra o estado já salvo).
//
// Nenhuma conquista pontua velocidade pura; Velocista exige manter QUALIDADE
// (zero retrabalho), senão seria incentivo a análise rasa (spec C4).

export interface AchievementSnapshot {
  /** Total de OSs completadas na carreira. */
  totalCompleted: number;
  /** Máximo de OSs completas num único dia-chave ('YYYY-MM-DD'). */
  maxInOneDay: number;
  /**
   * Chaves de dia com conclusão FORA do horário comercial — 'late' = após
   * 23h, 'early' = antes das 7h (fuso do pódio; quem calcula é periods.
   * localDayKey + localParts no chamador).
   */
  lateNightDays: readonly string[];
  earlyMorningDays: readonly string[];
  /** Comprimento atual da sequência de OSs seguidas sem retrabalho. */
  currentCleanRun: number;
  /** Melhor sequência histórica de OSs seguidas sem retrabalho. */
  bestCleanRun: number;
  /** Melhor tempo médio por OS mantendo qualidade (zero retrabalho), em s. */
  bestQualityMaintainingAvgSec: number | null;
  /** Comentários de ajuda enviados a colegas (via comentário/mentor). */
  helpCommentsSent: number;
}

export type AchievementKey =
  | 'first_os'
  | 'os_100'
  | 'os_500'
  | 'marathon'
  | 'owl'
  | 'early_bird'
  | 'perfectionist'
  | 'sprinter'
  | 'mentor';

export interface AchievementDef {
  key: AchievementKey;
  iconPt: string;
  namePt: string;
  nameEn: string;
  descriptionPt: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([
  {
    key: 'first_os',
    iconPt: '🔰',
    namePt: 'Primeira OS',
    nameEn: 'First OS',
    descriptionPt: 'Completou a primeira análise.',
  },
  {
    key: 'os_100',
    iconPt: '💯',
    namePt: '100 OSs',
    nameEn: '100 OSs',
    descriptionPt: '100 análises completas na carreira.',
  },
  {
    key: 'os_500',
    iconPt: '🏆',
    namePt: '500 OSs',
    nameEn: '500 OSs',
    descriptionPt: '500 análises completas na carreira.',
  },
  {
    key: 'marathon',
    iconPt: '🏃',
    namePt: 'Maratona',
    nameEn: 'Marathon',
    descriptionPt: '10 análises num único dia.',
  },
  {
    key: 'owl',
    iconPt: '🦉',
    namePt: 'Coruja',
    nameEn: 'Night Owl',
    descriptionPt: 'Concluiu uma análise após as 23h.',
  },
  {
    key: 'early_bird',
    iconPt: '🌅',
    namePt: 'Madrugador',
    nameEn: 'Early Bird',
    descriptionPt: 'Concluiu uma análise antes das 7h.',
  },
  {
    key: 'perfectionist',
    iconPt: '✨',
    namePt: 'Perfeccionista',
    nameEn: 'Perfectionist',
    descriptionPt: '10 OSs seguidas sem nenhum retrabalho.',
  },
  {
    key: 'sprinter',
    iconPt: '⚡',
    namePt: 'Velocista',
    nameEn: 'Sprinter',
    descriptionPt: 'Melhor tempo médio mantendo zero retrabalho.',
  },
  {
    key: 'mentor',
    iconPt: '🎓',
    namePt: 'Mentor',
    nameEn: 'Mentor',
    descriptionPt: 'Ajudou colegas via comentário 5 vezes.',
  },
]);

/** Limiar do Velocista: média (s) que conta como "melhor tempo c/ qualidade". */
export const SPRINTER_AVG_SECONDS = 900; // 15 min por OS, ajustável pelo admin

/**
 * Conjunto completo de conquistas desbloqueadas dado o snapshot.
 * Determinístico: mesmo snapshot → mesmo Set (ordem de inserção fixa).
 */
export function evaluateAchievements(s: AchievementSnapshot): Set<AchievementKey> {
  const unlocked = new Set<AchievementKey>();
  if (s.totalCompleted >= 1) unlocked.add('first_os');
  if (s.totalCompleted >= 100) unlocked.add('os_100');
  if (s.totalCompleted >= 500) unlocked.add('os_500');
  if (s.maxInOneDay >= 10) unlocked.add('marathon');
  if (s.lateNightDays.length >= 1) unlocked.add('owl');
  if (s.earlyMorningDays.length >= 1) unlocked.add('early_bird');
  // Perfeccionista usa a MELHOR sequência histórica: atingiu uma vez, é seu.
  if (Math.max(s.currentCleanRun, s.bestCleanRun) >= 10) unlocked.add('perfectionist');
  if (s.bestQualityMaintainingAvgSec !== null && s.bestQualityMaintainingAvgSec > 0
      && s.bestQualityMaintainingAvgSec <= SPRINTER_AVG_SECONDS) {
    unlocked.add('sprinter');
  }
  if (s.helpCommentsSent >= 5) unlocked.add('mentor');
  return unlocked;
}

/** Diferença: chaves novas (p/ toast) dado o que já estava persistido. */
export function newAchievements(
  snapshotUnlocked: ReadonlySet<AchievementKey>,
  alreadyStored: ReadonlySet<string>,
): AchievementKey[] {
  return [...snapshotUnlocked].filter((k) => !alreadyStored.has(k));
}

export function achievementDef(key: AchievementKey): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.key === key);
}
