/**
 * SOLARIS Pro licensing (SOLA-34) — pure, framework-free client core.
 *
 * Entitlements are Ed25519 tokens (see `./token`). This module holds NO secret
 * and cannot sign: the old HMAC-SHA256 design put a symmetric key in the client,
 * where anyone who reads the bundle could mint eternal Pro keys. That is gone.
 *
 * Trust model:
 *  - The signed token is the only source of truth. `edition`, `exp` and
 *    `grace_exp` are read from the signed claims, never from the storage record.
 *  - Local storage is a cache; tampering with it cannot create entitlement
 *    without a token that verifies against the embedded public key.
 *  - The server (`src/licensing/server/`) is authoritative for activation
 *    counting and revocation; the client revalidates when reachable and keeps
 *    the signed, time-bounded entitlement while the backend is down.
 */

import { verifyLicenseToken } from './token';
import type { LicenseClaims, PublicKeyRing, SolarisEdition } from './token';
import { LICENSE_PUBLIC_KEYS } from './keys';

export type { SolarisEdition, LicenseClaims, PublicKeyRing } from './token';

export interface FeatureFlags {
  /** Export the printable QC report (HTML download + print). */
  qcReportExport: boolean;
  /** A/B compare mode: challenger pane + transport sync toolbar. */
  abCompareMode: boolean;
}

/** Free tier: everything needed for day-to-day signal review. */
export const FREE_FLAGS: Readonly<FeatureFlags> = Object.freeze({
  qcReportExport: true,
  abCompareMode: false,
});

/** Pro tier: unlocks every analyst power-feature. */
export const PRO_FLAGS: Readonly<FeatureFlags> = Object.freeze({
  qcReportExport: true,
  abCompareMode: true,
});

export function flagsForEdition(edition: SolarisEdition): Readonly<FeatureFlags> {
  return edition === 'pro' ? PRO_FLAGS : FREE_FLAGS;
}

// --- Storage (cache only — never the authority) ------------------------------

export const LICENSE_CACHE_KEY = 'solaris.proLicense';

export interface StoredEntitlement {
  /** The signed token exactly as issued. */
  token: string;
  /** Server activation id, when the token has been activated. */
  activationId: string | null;
  /** Last successful server revalidation (unix ms); 0 = never revalidated. */
  verifiedAt: number;
  /**
   * Monotonic high-water mark of observed server-clock time (unix ms). Used to
   * detect a client clock rolled back below the last trusted time (Riven R-05).
   * Optional for backward compatibility with older cache entries.
   */
  timeFloor?: number;
}

/** Tolerated skew before a clock is treated as rolled back / not-yet-valid. */
export const CLOCK_SKEW_ALLOWANCE_MS = 5 * 60 * 1000;
/** Extra slack when comparing against the monotonic time floor. */
export const CLOCK_FLOOR_TOLERANCE_MS = 5 * 60 * 1000;

export function loadStoredEntitlement(
  storage: Pick<Storage, 'getItem'> | undefined,
): StoredEntitlement | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LICENSE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredEntitlement).token === 'string' &&
      (typeof (parsed as StoredEntitlement).activationId === 'string' ||
        (parsed as StoredEntitlement).activationId === null) &&
      typeof (parsed as StoredEntitlement).verifiedAt === 'number' &&
      (typeof (parsed as StoredEntitlement).timeFloor === 'number' ||
        (parsed as StoredEntitlement).timeFloor === undefined)
    ) {
      return parsed as StoredEntitlement;
    }
    return null;
  } catch {
    return null;
  }
}

export function persistStoredEntitlement(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  entry: StoredEntitlement | null,
): void {
  if (!storage) return;
  try {
    if (entry === null) storage.removeItem(LICENSE_CACHE_KEY);
    else storage.setItem(LICENSE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* storage unavailable — persistence is best-effort */
  }
}

// --- Verification & resolution ----------------------------------------------

export interface LocalEntitlement {
  /** Token verifies against the public ring and is inside its offline window. */
  verified: boolean;
  claims?: LicenseClaims;
  reason?: string;
}

/** Verify a token locally (signature + clock). No network, no secret. */
export async function verifyLocalEntitlement(
  token: string | null | undefined,
  now: number = Date.now(),
  publicKeys: PublicKeyRing = LICENSE_PUBLIC_KEYS,
  options: { clockSkewMs?: number } = {},
): Promise<LocalEntitlement> {
  if (!token) return { verified: false, reason: 'no-token' };
  const result = await verifyLicenseToken(token, publicKeys, now, options);
  if (result.valid) return { verified: true, claims: result.claims };
  return { verified: false, reason: result.reason, claims: result.claims };
}

export type EditionOverride =
  | { kind: 'stored-license' }
  | { kind: 'env-override' }
  | { kind: 'none' };

/**
 * Pure resolution: a locally verified Pro entitlement wins over the build-time
 * env override wins over free. The env override is an operator/self-host switch,
 * not a customer entitlement and not a security boundary.
 */
export function resolveEditionFromSources(
  hasVerifiedProEntitlement: boolean,
  envEdition: string | undefined,
): { edition: SolarisEdition; source: EditionOverride } {
  if (hasVerifiedProEntitlement) return { edition: 'pro', source: { kind: 'stored-license' } };
  if (envEdition === 'pro' || envEdition === 'free') {
    return { edition: envEdition, source: { kind: 'env-override' } };
  }
  return { edition: 'free', source: { kind: 'none' } };
}

/** True when a server revalidation is due (default: once per 24h). */
export const REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * True when the client should talk to the server again.
 *
 * Riven R-06: never trust a cache-supplied `verifiedAt` blindly. A future
 * timestamp (impossible from our own writes) is treated as a tampered or
 * rolled-back cache and forces revalidation. An entry that has never been
 * verified (e.g. installed during an outage) also revalidates, so it can obtain
 * an activation id and become revocable later (Naomi finding B).
 */
export function shouldRevalidate(entry: StoredEntitlement | null, now: number = Date.now()): boolean {
  if (!entry?.token) return false;
  if (!(entry.verifiedAt > 0)) return true;
  if (entry.verifiedAt > now + CLOCK_SKEW_ALLOWANCE_MS) return true;
  return now - entry.verifiedAt >= REVALIDATE_INTERVAL_MS;
}

/**
 * True when the local clock is consistent with the highest server time we have
 * observed. A client clock rolled back below `timeFloor` by more than the
 * tolerance is not trusted for offline entitlement evaluation (Riven R-05).
 */
export function isClockConsistent(
  entry: StoredEntitlement | null,
  now: number = Date.now(),
  tolerance: number = CLOCK_FLOOR_TOLERANCE_MS,
): boolean {
  const floor = entry?.timeFloor ?? 0;
  if (!(floor > 0)) return true;
  return now + tolerance >= floor;
}

// --- Gate helpers -----------------------------------------------------------

/** True when the feature is available on the current edition. */
export function isFeatureUnlocked(flags: Readonly<FeatureFlags>, flag: keyof FeatureFlags): boolean {
  return flags[flag];
}

/** Stable human label used by the upsell UI and tests. */
export function describeFeature(feature: keyof FeatureFlags): string {
  switch (feature) {
    case 'abCompareMode':
      return 'A/B Compare';
    case 'qcReportExport':
      return 'QC Report Export';
    default:
      return 'Solaris Pro feature';
  }
}
