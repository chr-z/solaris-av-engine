/**
 * SOLARIS Pro licensing (S6.1) — pure, framework-free core.
 *
 * Local-first feature flags: entitlements are derived from a signed license
 * key (HMAC-SHA256 via WebCrypto) plus a local edition override. No network,
 * no account, no secrets in the repo — the signing secret lives only in the
 * owner's environment (see `scripts/gen_license_key.mjs`).
 */

// --- Editions ---------------------------------------------------------------

export type SolarisEdition = 'free' | 'pro';

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

// --- License key format -----------------------------------------------------
//
//   SOLARIS-<version>-<expiresAt>-<edition>-<payload>.<signature>
//
// `payload` is an opaque base64url blob (customer/order reference). The
// signature covers everything before the final '.', computed with HMAC-SHA256
// over the raw ASCII bytes of that prefix.


export const LICENSE_KEY_PREFIX = 'SOLARIS';
export const LICENSE_EDITION_FREE = 'free' as const;
export const LICENSE_EDITION_PRO = 'pro' as const;

export const EDITION_STORAGE_KEY = 'solaris.editionOverride';
export const LICENSE_CACHE_KEY = 'solaris.proLicense';

export interface ParsedLicenseKey {
  version: number;
  /** Unix ms expiry; 0 = never expires. */
  expiresAt: number;
  edition: SolarisEdition;
  payload: string;
  signature: string;
}

export type LicenseParseResult =
  | { ok: true; license: ParsedLicenseKey }
  | { ok: false; reason: 'malformed' | 'bad-signature' };

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encodes a string as UTF-8 bytes (works under jsdom and Node). */
function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  // Fallback (never hit in browsers/Node >= 12) — keep pure & dependency-free.
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const cryptoObj: typeof globalThis.crypto | undefined =
    typeof crypto !== 'undefined' ? crypto : undefined;
  if (!cryptoObj?.subtle) throw new Error('WebCrypto unavailable');
  const key = await cryptoObj.subtle.importKey(
    'raw',
    encodeUtf8(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoObj.subtle.sign(
    'HMAC',
    key,
    encodeUtf8(message) as unknown as ArrayBuffer,
  );
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyLicenseSignature(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const expected = await hmacSign(secret, message);
    return expected === signature;
  } catch {
    return false;
  }
}

/** Structural validation only — no signature check, no clock. */
export function parseLicenseKey(raw: string | null | undefined): LicenseParseResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'malformed' };
  const parts = raw.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, signature] = parts;
  const segments = body.split('-');
  if (segments.length !== 5) return { ok: false, reason: 'malformed' };
  const [prefix, versionRaw, expiresRaw, edition, payload] = segments;
  if (prefix !== LICENSE_KEY_PREFIX) return { ok: false, reason: 'malformed' };
  if (!BASE64URL_RE.test(payload) || !BASE64URL_RE.test(signature)) {
    return { ok: false, reason: 'malformed' };
  }
  const version = Number.parseInt(versionRaw, 10);
  if (!Number.isFinite(version)) return { ok: false, reason: 'malformed' };
  const expiresAt = Number.parseInt(expiresRaw, 10);
  if (!Number.isFinite(expiresAt) || expiresAt < 0) return { ok: false, reason: 'malformed' };
  if (edition !== LICENSE_EDITION_FREE && edition !== LICENSE_EDITION_PRO) {
    return { ok: false, reason: 'malformed' };
  }
  return {
    ok: true,
    license: { version, expiresAt, edition, payload, signature },
  };
}

export async function validateLicenseKey(
  raw: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<{ valid: boolean; reason?: 'expired'; license?: ParsedLicenseKey }> {
  const parsed = parseLicenseKey(raw);
  if (!parsed.ok) return { valid: false };
  const body = raw!.slice(0, raw!.lastIndexOf('.'));
  const signatureOk = await verifyLicenseSignature(secret, body, parsed.license.signature);
  if (!signatureOk) return { valid: false };
  if (parsed.license.expiresAt > 0 && parsed.license.expiresAt <= now) {
    return { valid: false, reason: 'expired', license: parsed.license };
  }
  return { valid: true, license: parsed.license };
}

// --- Storage ----------------------------------------------------------------

export interface StoredLicense {
  key: string;
  activatedAt: number;
}

export function loadStoredLicense(storage: Pick<Storage, 'getItem'> | undefined): StoredLicense | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LICENSE_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredLicense).key === 'string' &&
      typeof (parsed as StoredLicense).activatedAt === 'number'
    ) {
      return parsed as StoredLicense;
    }
    return null;
  } catch {
    return null;
  }
}

export function persistStoredLicense(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  entry: StoredLicense | null,
): void {
  if (!storage) return;
  try {
    if (entry === null) storage.removeItem(LICENSE_CACHE_KEY);
    else storage.setItem(LICENSE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* storage unavailable — persistence is best-effort */
  }
}

export type EditionOverride =
  | { kind: 'stored-license' }
  | { kind: 'env-override' }
  | { kind: 'none' };

/** Pure resolution: stored license wins over env override wins over free. */
export function resolveEditionFromSources(
  hasStoredValidProLicense: boolean,
  envEdition: string | undefined,
): { edition: SolarisEdition; source: EditionOverride } {
  if (hasStoredValidProLicense) return { edition: 'pro', source: { kind: 'stored-license' } };
  if (envEdition === 'pro' || envEdition === 'free') {
    return { edition: envEdition, source: { kind: 'env-override' } };
  }
  return { edition: 'free', source: { kind: 'none' } };
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
