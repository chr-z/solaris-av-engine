// Admin role resolution — pure core (no Firebase import).
//
// Everything here is decision logic + localStorage persistence so it stays
// unit-testable without touching the Firebase SDK. The React hook lives in
// useAdminRole.ts and composes this core with auth state.

const ADMIN_CLAIM_KEY = 'role';
const ADMIN_CLAIM_VALUE = 'admin';
const LOCAL_ADMIN_KEY = 'solaris.v3.local-admins';
const GUEST_EMAIL_KEY = 'solaris.guest-email';

// Demo identities are admins so the public demo can showcase the whole
// AdminConsole — persistence stays in the browser's localStorage, never server-side.
export const LOCAL_ADMIN_EMAILS = ['zee@solaris.local', 'admin@solaris.demo', 'guest@solaris.demo'];

export function localAdmins(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_ADMIN_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  return LOCAL_ADMIN_EMAILS;
}

/** Grants/revoke local admin (demo fallback only). Passing null revokes everyone. */
export function setLocalAdmin(email: string | null): void {
  const list = new Set(localAdmins());
  if (email) list.add(email);
  else list.clear();
  localStorage.setItem(LOCAL_ADMIN_KEY, JSON.stringify([...list]));
}

export function isLocalAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return localAdmins().map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

/**
 * Pure decision used by both the signed-in and guest paths:
 *   1. an explicit Firebase claim wins (wrong claim value denies, even if allowlisted);
 *   2. absent claim, the local allowlist decides;
 *   3. otherwise not admin.
 */
export function resolveAdminSource(claim: unknown, email: string | null | undefined): RoleSource {
  if (claim === ADMIN_CLAIM_VALUE) return 'firebase-claim';
  if (!claim && isLocalAdmin(email)) return 'local-fallback';
  return 'none';
}

/** Guest/demo identity persistence (so the admin gate survives reloads in demo mode). */
export function persistGuestEmail(email: string): void {
  try { localStorage.setItem(GUEST_EMAIL_KEY, JSON.stringify(email)); } catch { /* ignore */ }
}

export function clearGuestEmail(): void {
  try { localStorage.removeItem(GUEST_EMAIL_KEY); } catch { /* ignore */ }
}

export function readGuestEmail(): string | null {
  try {
    const raw = localStorage.getItem(GUEST_EMAIL_KEY);
    return raw ? (JSON.parse(raw) as string) : null;
  } catch {
    return null;
  }
}

export const ADMIN_ROLE_CLAIM = { key: ADMIN_CLAIM_KEY, value: ADMIN_CLAIM_VALUE } as const;

export type RoleSource = 'firebase-claim' | 'local-fallback' | 'none';
