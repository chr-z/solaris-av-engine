import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  FeatureFlags,
  SolarisEdition,
  StoredEntitlement,
  flagsForEdition,
  loadStoredEntitlement,
  persistStoredEntitlement,
  resolveEditionFromSources,
  shouldRevalidate,
  verifyLocalEntitlement,
  LocalEntitlement,
} from './core';
import { resolvePublicKeyRing } from './keys';

/** Edition override injected at build time (optional, operator/self-host only). */
const ENV_EDITION = (import.meta.env?.VITE_SOLARIS_EDITION as string | undefined)?.trim();

/**
 * Optional PUBLIC key ring override (JSON kid -> base64url key). Public by
 * definition; the client holds no signing material. Resolved lazily so tests
 * can substitute a ring.
 */
function publicKeyRing() {
  return resolvePublicKeyRing(import.meta.env?.VITE_SOLARIS_LICENSE_PUBLIC_KEYS as string | undefined);
}

function storage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

/** Baseline activation endpoint; overridable for tests/self-host. */
const ACTIVATE_URL = (import.meta.env?.VITE_SOLARIS_LICENSE_API as string | undefined) ?? '/api/license/activate';
const REVALIDATE_URL = ACTIVATE_URL.replace(/\/activate$/, '/revalidate');

export interface LicenseContextValue {
  edition: SolarisEdition;
  flags: Readonly<FeatureFlags>;
  isPro: boolean;
  /** Where the current entitlement came from (upsell/debug UI). */
  source: 'stored-license' | 'env-override' | 'none';
  /**
   * Activates a license key. Verifies the Ed25519 token locally first, then
   * confirms with the server (activation counting / revocation). When the
   * backend is unreachable the signed, time-bounded token is honoured so an
   * outage never bricks a paying customer.
   */
  activate: (key: string) => Promise<boolean>;
  /** Removes any stored license; falls back to env/free resolution order. */
  deactivate: () => void;
  /** i18n key of the last license error (cleared on success/deactivate). */
  lastError: string | null;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

async function postJson(url: string, body: unknown): Promise<unknown | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { __httpError: res.status };
    return await res.json();
  } catch {
    return null; // network failure → caller treats as outage
  }
}

export function LicenseProvider({ children }: { children: React.ReactNode }) {
  // Boot synchronously from localStorage; entitlement is only granted after the
  // token itself verifies, so a tampered cache cannot unlock Pro.
  const [stored, setStored] = useState<StoredEntitlement | null>(() => loadStoredEntitlement(storage()));
  const [licenseError, setLicenseError] = useState<string | null>(null);
  // null = not verified yet; resolves to the local verification of the token.
  const [local, setLocal] = useState<LocalEntitlement | null>(null);

  const storedToken = stored?.token ?? null;

  // Local cryptographic verification whenever the cached token changes.
  useEffect(() => {
    let cancelled = false;
    if (!storedToken) {
      queueMicrotask(() => {
        if (!cancelled) setLocal({ verified: false, reason: 'no-token' });
      });
      return;
    }
    verifyLocalEntitlement(storedToken, Date.now(), publicKeyRing()).then(result => {
      if (!cancelled) setLocal(result);
    });
    return () => {
      cancelled = true;
    };
  }, [storedToken]);

  // Server revalidation (revocation check). Skipped while offline; the signed
  // grace window keeps the customer entitled until `grace_exp`.
  useEffect(() => {
    if (!stored?.token || !stored.activationId || !shouldRevalidate(stored)) return;
    let cancelled = false;
    postJson(REVALIDATE_URL, { token: stored.token, activationId: stored.activationId }).then(data => {
      if (cancelled || !data || typeof data !== 'object') return; // outage → keep entitlement
      const payload = data as { entitled?: unknown; activationId?: unknown };
      if (payload.entitled === true) {
        const refreshed: StoredEntitlement = {
          ...stored,
          activationId: typeof payload.activationId === 'string' ? payload.activationId : stored.activationId,
          verifiedAt: Date.now(),
        };
        persistStoredEntitlement(storage(), refreshed);
        setStored(refreshed);
      } else if (payload.entitled === false) {
        // Authoritative server denial (revoked/invalid/expired): drop entitlement.
        persistStoredEntitlement(storage(), null);
        setStored(null);
        setLocal({ verified: false, reason: 'revalidation-denied' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [stored]);

  const hasVerifiedPro = local?.verified === true && local.claims?.edition === 'pro';

  const resolution = useMemo(
    () => resolveEditionFromSources(hasVerifiedPro, ENV_EDITION),
    [hasVerifiedPro],
  );

  const activate = useCallback(async (key: string): Promise<boolean> => {
    const trimmed = key.trim();
    if (!trimmed) {
      setLicenseError('solaris.pro.invalidKey');
      return false;
    }

    // 1. Offline cryptographic verification (no secret, no network).
    const localResult = await verifyLocalEntitlement(trimmed, Date.now(), publicKeyRing());
    if (localResult.reason === 'expired') {
      setLicenseError('solaris.pro.keyExpired');
      return false;
    }
    if (!localResult.verified) {
      setLicenseError('solaris.pro.invalidKey');
      return false;
    }
    if (localResult.claims?.edition !== 'pro') {
      setLicenseError('solaris.pro.notProKey');
      return false;
    }

    // 2. Server round-trip: counting + revocation. Offline → honour the signed token.
    let activationId: string | null = null;
    const data = await postJson(ACTIVATE_URL, { token: trimmed });
    if (data && typeof data === 'object' && 'entitled' in data) {
      const payload = data as { entitled?: unknown; activationId?: unknown };
      if (payload.entitled === false) {
        setLicenseError('solaris.pro.invalidKey');
        return false;
      }
      if (payload.entitled === true) {
        activationId = typeof payload.activationId === 'string' ? payload.activationId : null;
      }
    }
    // A non-2xx / network error is an outage: grant offline from the signed token.

    const entry: StoredEntitlement = {
      token: trimmed,
      activationId,
      verifiedAt: activationId ? Date.now() : 0,
    };
    persistStoredEntitlement(storage(), entry);
    setStored(entry);
    setLocal({ verified: true, claims: localResult.claims });
    setLicenseError(null);
    return true;
  }, []);

  const deactivate = useCallback((): void => {
    persistStoredEntitlement(storage(), null);
    setStored(null);
    setLocal({ verified: false, reason: 'deactivated' });
    setLicenseError(null);
  }, []);

  const value = useMemo<LicenseContextValue>(
    () => ({
      edition: resolution.edition,
      flags: flagsForEdition(resolution.edition),
      isPro: resolution.edition === 'pro',
      source: resolution.source.kind,
      activate,
      deactivate,
      lastError: licenseError,
    }),
    [resolution, activate, deactivate, licenseError],
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

export function useLicense(): LicenseContextValue {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error('useLicense must be used within a <LicenseProvider>');
  return ctx;
}

/**
 * S6.1: gate for Pro features — renders `children` only on an entitled
 * edition, with an optional upsell fallback (e.g. lock overlay).
 */
export function ProGate({
  feature,
  fallback = null,
  children,
}: {
  feature: keyof FeatureFlags;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { flags } = useLicense();
  return <>{flags[feature] ? children : fallback}</>;
}
