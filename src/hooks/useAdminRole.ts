// Admin role resolution for the v3 AdminConsole.
//
// Pure decision logic lives in adminRoleCore.ts (unit-testable without the
// Firebase SDK); this module composes it with Firebase auth state.

import { useState, useEffect } from 'react';
import { getFirebaseCompat } from '../config/firebase';
import {
  resolveAdminSource,
  readGuestEmail,
  isLocalAdmin,
  ADMIN_ROLE_CLAIM,
  type RoleSource,
} from './adminRoleCore';

export * from './adminRoleCore';

export interface AdminRoleState {
  isAdmin: boolean;
  source: RoleSource;
  /** True until the first Firebase token result arrives. */
  loading: boolean;
}

function deny(cancelled: boolean, setState: (s: AdminRoleState) => void): void {
  if (!cancelled) setState({ isAdmin: false, source: 'none', loading: false });
}

/**
 * Resolves admin status for the signed-in user:
 *   1. Firebase custom claim `role` on the current ID token;
 *   2. local allowlist fallback (demo/guest mode);
 *   3. otherwise not admin.
 * Re-evaluates on auth state changes and token refreshes.
 */
export function useAdminRole(): AdminRoleState {
  const [state, setState] = useState<AdminRoleState>({ isAdmin: false, source: 'none', loading: true });

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      const user = (await getFirebaseCompat()).fbAuth.currentUser;
      if (!user) {
        // Guest/demo path: no Firebase user → local allowlist decides.
        const email = readGuestEmail();
        if (isLocalAdmin(email)) {
          if (!cancelled) setState({ isAdmin: true, source: 'local-fallback', loading: false });
          return;
        }
        deny(cancelled, setState);
        return;
      }
      try {
        const token = await user.getIdTokenResult();
        const source = resolveAdminSource(token.claims?.[ADMIN_ROLE_CLAIM.key], user.email);
        if (source !== 'none') {
          if (!cancelled) setState({ isAdmin: true, source, loading: false });
          return;
        }
      } catch {
        /* fall through to deny */
      }
      deny(cancelled, setState);
    };

    // Deferred off the effect's synchronous path (microtask) — the initial
    // decision lands after paint, mirroring the auth-listener updates below.
    void Promise.resolve().then(resolve);
    // turbo-web: attach after the lazy SDK resolves; unmount before that is a no-op.
    let unsub: (() => void) | null = null;
    void getFirebaseCompat().then(({ fbAuth }) => {
      if (cancelled) return;
      unsub = fbAuth.onAuthStateChanged(() => { void resolve(); });
    }).catch(() => { /* deny path below stays */ });
    return () => { cancelled = true; if (unsub) unsub(); };
  }, []);

  return state;
}
