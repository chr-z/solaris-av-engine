import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  FeatureFlags,
  SolarisEdition,
  StoredEntitlement,
  CLOCK_SKEW_ALLOWANCE_MS,
  flagsForEdition,
  isClockConsistent,
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

/**
 * Baseline activation endpoint; overridable for tests/self-host. An empty
 * string is treated as unset (Naomi finding E: `??` did not catch `''`).
 */
const API_OVERRIDE = (import.meta.env?.VITE_SOLARIS_LICENSE_API as string | undefined)?.trim();
const ACTIVATE_URL = API_OVERRIDE && API_OVERRIDE.length > 0 ? API_OVERRIDE : '/api/license/activate';

function siblingUrl(url: string, name: string): string {
  const trimmed = url.replace(/\/+$/, '');
  if (/\/activate$/.test(trimmed)) return `${trimmed.slice(0, -'/activate'.length)}/${name}`;
  return `${trimmed}/${name}`;
}

const REVALIDATE_OVERRIDE = (import.meta.env?.VITE_SOLARIS_LICENSE_REVALIDATE_API as string | undefined)?.trim();
const REVALIDATE_URL =
  REVALIDATE_OVERRIDE && REVALIDATE_OVERRIDE.length > 0 ? REVALIDATE_OVERRIDE : siblingUrl(ACTIVATE_URL, 'revalidate');

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

type PostResult = { kind: 'response'; status: number; data: unknown } | { kind: 'network' };

async function postJson(url: string, body: unknown): Promise<PostResult> {
  if (typeof fetch !== 'function') return { kind: 'network' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { kind: 'response', status: res.status, data };
  } catch {
    return { kind: 'network' }; // network failure → caller treats as outage
  }
}

/**
 * An authoritative API answer advertises a boolean `entitled`, regardless of
 * the HTTP status line. Anything else (HTML error page, empty body, WAF
 * interstitial) is treated as an outage so a proxy cannot brick a payer.
 */
function asEntitlement(data: unknown): { entitled: boolean; activationId?: unknown } | null {
  if (typeof data !== 'object' || data === null) return null;
  const entitled = (data as { entitled?: unknown }).entitled;
  if (typeof entitled !== 'boolean') return null;
  return { entitled, activationId: (data as { activationId?: unknown }).activationId };
}

export function LicenseProvider({ children }: { children: React.ReactNode }) {
  // Boot synchronously from localStorage; entitlement is only granted after the
  // token itself verifies, so a tampered cache cannot unlock Pro.
  const [stored, setStored] = useState<StoredEntitlement | null>(() => loadStoredEntitlement(storage()));
  const [licenseError, setLicenseError] = useState<string | null>(null);
  // null = not verified yet; resolves to the local verification of the token.
  const [local, setLocal] = useState<LocalEntitlement | null>(null);

  const storedRef = useRef(stored);
  useEffect(() => {
    storedRef.current = stored;
  }, [stored]);

  const storedToken = stored?.token ?? null;

  // Local cryptographic verification whenever the cached token changes. The
  // clock floor is evaluated here (not during render) so a rolled-back clock
  // cannot grant entitlement (Riven R-05).
  useEffect(() => {
    let cancelled = false;
    if (!storedToken) {
      queueMicrotask(() => {
        if (!cancelled) setLocal({ verified: false, reason: 'no-token' });
      });
      return;
    }
    const now = Date.now();
    if (!isClockConsistent(stored, now)) {
      queueMicrotask(() => {
        if (!cancelled) setLocal({ verified: false, reason: 'clock-untrusted' });
      });
      return;
    }
    verifyLocalEntitlement(storedToken, now, publicKeyRing(), {
      clockSkewMs: CLOCK_SKEW_ALLOWANCE_MS,
    }).then(result => {
      if (!cancelled) setLocal(result);
    });
    return () => {
      cancelled = true;
    };
  }, [stored, storedToken]);

  /**
   * Server sync (revocation check). Runs on mount and whenever the tab becomes
   * visible again — NOT on a cache-controlled interval, which an attacker could
   * suppress by editing `verifiedAt` (Riven R-06). When there is no activation
   * id yet (e.g. the first activation happened during an outage) this retries
   * activation so the entitlement becomes revocable (Naomi finding B).
   */
  useEffect(() => {
    const entry = storedRef.current;
    if (!entry?.token || !shouldRevalidate(entry)) return;
    let cancelled = false;

    const sync = async () => {
      const current = storedRef.current;
      if (!current?.token || !shouldRevalidate(current)) return;
      const useRevalidate = typeof current.activationId === 'string' && current.activationId.length > 0;
      const url = useRevalidate ? REVALIDATE_URL : ACTIVATE_URL;
      const body = useRevalidate ? { token: current.token, activationId: current.activationId } : { token: current.token };
      const res = await postJson(url, body);
      if (cancelled || res.kind !== 'response') return; // outage → keep entitlement
      const payload = asEntitlement(res.data);
      if (!payload) return; // not an API body → outage
      if (payload.entitled === false) {
        // Authoritative server denial (revoked/invalid/expired): drop entitlement.
        persistStoredEntitlement(storage(), null);
        setStored(null);
        setLocal({ verified: false, reason: 'revalidation-denied' });
        return;
      }
      const now = Date.now();
      const activationId =
        typeof payload.activationId === 'string' ? payload.activationId : current.activationId;
      const refreshed: StoredEntitlement = {
        ...current,
        activationId,
        verifiedAt: now,
        timeFloor: Math.max(current.timeFloor ?? 0, now),
      };
      persistStoredEntitlement(storage(), refreshed);
      setStored(refreshed);
    };

    void sync();
    const onVisibility = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void sync();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
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
    const localResult = await verifyLocalEntitlement(trimmed, Date.now(), publicKeyRing(), {
      clockSkewMs: CLOCK_SKEW_ALLOWANCE_MS,
    });
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
    let serverConfirmed = false;
    if (data.kind === 'response') {
      const payload = asEntitlement(data.data);
      if (payload) {
        if (payload.entitled === false) {
          setLicenseError('solaris.pro.invalidKey');
          return false;
        }
        if (payload.entitled === true) {
          activationId = typeof payload.activationId === 'string' ? payload.activationId : null;
          serverConfirmed = true;
        }
      }
    }
    // A network error / non-API body is an outage: grant offline from the signed token.

    const now = Date.now();
    const prior = storedRef.current;
    const entry: StoredEntitlement = {
      token: trimmed,
      activationId,
      verifiedAt: serverConfirmed ? now : 0,
      timeFloor: serverConfirmed ? Math.max(prior?.timeFloor ?? 0, now) : (prior?.timeFloor ?? 0),
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
