// Solaris v3 — F4 UI de Gamificação — hash router da "Liga dos Analistas".
//
// Mesmo esquema do admin (#/admin): SPA single-screen sem react-router,
// deep-linkable e back-button friendly. A liga é acessível a qualquer
// usuário autenticado (analista incluído) — o gate é só o login.

export const LEAGUE_ROUTE = '#/liga';

/** True quando a hash endereça a Liga (exata, subpath ou query). */
export function isLeagueHash(hash: string): boolean {
  return (
    hash === LEAGUE_ROUTE ||
    hash.startsWith(LEAGUE_ROUTE + '/') ||
    hash.startsWith(LEAGUE_ROUTE + '?')
  );
}
