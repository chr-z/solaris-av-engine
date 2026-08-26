/**
 * SOLARIS — guardas de sessão para efeitos de NUVEM (P3, contrato "zero
 * rede executada" no standalone).
 *
 * Motivação (achado do tick 26/08 ~12h): o efeito de presence do App.tsx só
 * saía cedo para o perfil guest — o perfil local standalone (`local-reviewer`)
 * passava direto e executava `database.goOnline()` em todo boot. Sob stub é
 * no-op; num sabor cloud com override manual de modo tocaria a RTDB real.
 *
 * Contrato: funções PURAS (sem imports de firebase/React), decidíveis sem DOM,
 * cobertas por vitest nos dois modos.
 */

/** Perfis que nunca representam uma sessão Google real (sem presence). */
const LOCAL_SESSION_IDS: ReadonlySet<string> = new Set([
  'guest-reviewer-id',
  'local-reviewer',
]);

export interface PresenceSessionLike {
  id?: string | null;
}

/**
 * true quando a sessão NÃO é uma sessão Google viva → presence deve sair
 * cedo SEM tocar database.goOnline() nem registrar listeners.
 */
export function isLocalOnlySession(
  profile?: PresenceSessionLike | null,
): boolean {
  return (
    !profile || !profile.id || LOCAL_SESSION_IDS.has(profile.id)
  );
}
