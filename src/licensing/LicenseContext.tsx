import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  FeatureFlags,
  SolarisEdition,
  flagsForEdition,
  resolveEditionFromSources,
  validateLicenseKey,
  loadStoredLicense,
  persistStoredLicense,
  StoredLicense,
} from './core';

/** Edition override injected at build time (optional). VITE_ vars are public by design. */
const ENV_EDITION = (import.meta.env?.VITE_SOLARIS_EDITION as string | undefined)?.trim();

/**
 * HMAC signing secret, injected at build time via VITE_SOLARIS_LICENSE_SECRET.
 * NOTE: client-side secrets are public by definition — this is a deliberate
 * local-first trade-off (tamper resistance, not DRM). For hardened licensing,
 * move validation to the serverless `api/` functions.
 */
const ENV_LICENSE_SECRET = import.meta.env?.VITE_SOLARIS_LICENSE_SECRET as string | undefined;

export interface LicenseContextValue {
  edition: SolarisEdition;
  flags: Readonly<FeatureFlags>;
  isPro: boolean;
  /** Where the current entitlement came from (upsell/debug UI). */
  source: 'stored-license' | 'env-override' | 'none';
  /**
   * Activates a license key. Resolves to true when the key was accepted and
   * Pro unlocked; false otherwise (invalid signature, malformed, expired).
   */
  activate: (key: string) => Promise<boolean>;
  /** Removes any stored license; falls back to env/free resolution order. */
  deactivate: () => void;
  /** i18n key of the last license error (cleared on success/deactivate). */
  lastError: string | null;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({ children }: { children: React.ReactNode }) {
  // Boot synchronously from localStorage so there's no free-tier flash.
  const [stored, setStored] = useState<StoredLicense | null>(() =>
    loadStoredLicense(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const [licenseError, setLicenseError] = useState<string | null>(null);
  // null = not verified yet; keep last-known-good while re-checking.
  const [signatureVerified, setSignatureVerified] = useState<boolean | null>(null);

  const storedKey = stored?.key ?? null;

  // Re-verify the stored key's signature whenever it changes (async WebCrypto).
  useEffect(() => {
    let cancelled = false;
    if (!storedKey || !ENV_LICENSE_SECRET) {
      // Defer out of the effect body (react-hooks/set-state-in-effect).
      queueMicrotask(() => {
        if (!cancelled) setSignatureVerified(null);
      });
      return;
    }
    validateLicenseKey(storedKey, ENV_LICENSE_SECRET, Date.now()).then(result => {
      if (cancelled) return;
      setSignatureVerified(result.valid);
    });
    return () => {
      cancelled = true;
    };
  }, [storedKey]);

  const resolution = useMemo(
    () => resolveEditionFromSources(signatureVerified === true, ENV_EDITION),
    [signatureVerified],
  );

  const activate = useCallback(async (key: string): Promise<boolean> => {
    const trimmed = key.trim();
    if (!trimmed || !ENV_LICENSE_SECRET) return false;
    const result = await validateLicenseKey(trimmed, ENV_LICENSE_SECRET, Date.now());
    if (!result.valid) {
      setLicenseError(result.reason === 'expired' ? 'solaris.pro.keyExpired' : 'solaris.pro.invalidKey');
      return false;
    }
    if (result.license && result.license.edition !== 'pro') {
      setLicenseError('solaris.pro.notProKey');
      return false;
    }
    const entry: StoredLicense = { key: trimmed, activatedAt: Date.now() };
    persistStoredLicense(window.localStorage, entry);
    setStored(entry);
    setLicenseError(null);
    return true;
  }, []);

  const deactivate = useCallback((): void => {
    persistStoredLicense(window.localStorage, null);
    setStored(null);
    setSignatureVerified(null);
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
