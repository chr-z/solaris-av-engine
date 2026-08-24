// Solaris v3 — tiny hash router for the admin console.
//
// The v2 app is a single-screen SPA (no router dependency); the AdminConsole
// rides on the URL hash so it stays deep-linkable and back-button friendly
// without pulling react-router into the bundle. Vercel serves the SPA shell,
// so refreshing #/admin boots straight into the console.

export const ADMIN_ROUTE = '#/admin';

/** True when a location hash addresses the admin console (exact, subpath or query). */
export function isAdminHash(hash: string): boolean {
  return (
    hash === ADMIN_ROUTE ||
    hash.startsWith(ADMIN_ROUTE + '/') ||
    hash.startsWith(ADMIN_ROUTE + '?')
  );
}
