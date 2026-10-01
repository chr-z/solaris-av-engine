/**
 * SOLARIS server-side entitlement activation (SOLA-34, P0-1c/P0-1d).
 *
 * Framework-free and storage-agnostic. All trust decisions happen here, on the
 * server, driven by an Ed25519-verified token:
 *
 *  - activation is counted per subject, so one key cannot fan out without bound;
 *  - revocation is first-class (per activation AND per subject);
 *  - the absolute offline cutoff (`grace_exp`) is carried inside the signed
 *    token, so a tampered client store cannot extend it;
 *  - the returned status encodes the outage/expiry/revocation matrix.
 *
 * The store is an interface: production binds it to a durable KV/DB. The
 * bundled `MemoryActivationStore` is for tests and single-process use only; it
 * does not survive a restart and must not be the production counter.
 *
 * SOLA-34 remediation (Riven R-03/R-04/R-07): the per-subject ceiling is
 * enforced *inside* the store via `insertIfUnderLimit`, so a count-then-insert
 * race in the caller can no longer exceed it; a revoked subject is denied even
 * when presenting a *different* valid token; and an invalid `maxActivations`
 * configuration fails closed instead of silently disabling the ceiling.
 */

import type { LicenseClaims, PublicKeyRing, SolarisEdition } from '../token';
import { verifyLicenseToken } from '../token';
import { timingSafeEqualHex } from './webhook';

export interface ActivationRecord {
  activationId: string;
  kid: string;
  subject: string;
  /** SHA-256 hex of the exact token string — never store/log the raw token. */
  tokenHash: string;
  activatedAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
  revokeReason: string | null;
  /** Absolute offline cutoff copied from the signed claims. */
  expiresAt: number;
}

/** Durable, subject-level deny marker (refund/chargeback). */
export interface SubjectRevocation {
  revokedAt: number;
  reason: string;
}

/** Result of an atomic ceiling-checked insert. */
export interface InsertIfUnderLimitResult {
  inserted: boolean;
  /** Live (non-revoked) activation count observed by the store. */
  count: number;
}

export interface ActivationStore {
  countForSubject(subject: string): Promise<number> | number;
  findByTokenHash(tokenHash: string): Promise<ActivationRecord | null> | ActivationRecord | null;
  findByActivationId(activationId: string): Promise<ActivationRecord | null> | ActivationRecord | null;
  listForSubject(subject: string): Promise<readonly ActivationRecord[]> | readonly ActivationRecord[];
  insert(record: ActivationRecord): Promise<void> | void;
  /**
   * Atomically insert `record` only while the subject has fewer than `max` live
   * activations. Implementations with a compare-and-set / unique constraint
   * enforce the ceiling strictly; stores without atomic primitives (e.g. KV)
   * must at minimum serialise within the process and document the residual
   * cross-isolate race.
   */
  insertIfUnderLimit(
    record: ActivationRecord,
    max: number,
  ): Promise<InsertIfUnderLimitResult> | InsertIfUnderLimitResult;
  touch(activationId: string, now: number): Promise<void> | void;
  /** Revoke one activation. */
  revoke(activationId: string, now: number, reason: string): Promise<boolean> | boolean;
  /** Revoke every activation for a subject and set a durable subject deny. */
  revokeSubject(subject: string, now: number, reason: string): Promise<number> | number;
  /** Subject-level deny marker, or null when the subject is not revoked. */
  isSubjectRevoked(subject: string): Promise<SubjectRevocation | null> | SubjectRevocation | null;
}

/** Default per-subject activation ceiling. Cost control, not authentication. */
export const DEFAULT_MAX_ACTIVATIONS = 5;

export type ActivateStatus = 'active' | 'grace' | 'expired' | 'revoked' | 'invalid' | 'activation_limit';

export interface ActivateInput {
  token: string;
  publicKeys: PublicKeyRing;
  store: ActivationStore;
  now?: number;
  maxActivations?: number;
  /** Caller-derived, non-secret installation hint for audit (cost control only). */
  installationHint?: string;
}

export interface ActivateResult {
  /** True when Pro should be unlocked (`active` or `grace`). */
  entitled: boolean;
  status: ActivateStatus;
  edition: SolarisEdition;
  activationId?: string;
  kid?: string;
  subject?: string;
  exp?: number;
  graceExp?: number;
  reason?: string;
}

/**
 * Builds a denial. Attacker-controlled fields (`subject`, `exp`, `grace_exp`)
 * are deliberately NOT echoed here: Riven R-10. `reason` is kept for server-side
 * logging/tests; the HTTP layer (`http.ts`) strips it from the public body.
 */
function deny(status: ActivateStatus, reason: string, claims?: LicenseClaims, kid?: string): ActivateResult {
  void claims;
  void kid;
  return { entitled: false, status, edition: 'free', reason };
}

async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto unavailable');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function newActivationId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Resolves the effective ceiling, failing closed on invalid configuration. */
function resolveMaxActivations(value: number | undefined): number | null {
  const max = value ?? DEFAULT_MAX_ACTIVATIONS;
  if (!Number.isInteger(max) || max < 1) return null;
  return max;
}

/**
 * Activate (or re-activate) a licence token. Idempotent for the same token:
 * an already-registered token is refreshed, not counted twice.
 */
export async function activateLicense(input: ActivateInput): Promise<ActivateResult> {
  const now = input.now ?? Date.now();
  const maxActivations = resolveMaxActivations(input.maxActivations);

  const verified = await verifyLicenseToken(input.token, input.publicKeys, now);
  if (!verified.valid) {
    // Expired is a first-class outcome (client falls back to free *after* grace).
    if (verified.reason === 'expired') return deny('expired', 'token_expired', verified.claims, verified.header?.kid);
    return deny('invalid', `token_${verified.reason}`, verified.claims, verified.header?.kid);
  }

  const { claims, keyId } = verified;
  if (claims.edition !== 'pro') return deny('invalid', 'not_a_pro_token', claims, keyId);

  // A revoked subject is denied even when presenting a fresh valid token.
  const subjectRevocation = await input.store.isSubjectRevoked(claims.sub);
  if (subjectRevocation) return deny('revoked', 'subject_revoked', claims, keyId);

  // Invalid ceiling configuration fails closed rather than becoming unlimited.
  if (maxActivations === null) return deny('invalid', 'invalid_max_activations_config', claims, keyId);

  const tokenHash = await sha256Hex(input.token);
  const existing = await input.store.findByTokenHash(tokenHash);
  if (existing) {
    if (existing.revokedAt !== null) return deny('revoked', 'activation_revoked', claims, keyId);
    const cutoff = claims.grace_exp > 0 ? claims.grace_exp : claims.exp;
    if (cutoff > 0 && now > cutoff) return deny('expired', 'token_expired', claims, keyId);
    await input.store.touch(existing.activationId, now);
    const inGrace = claims.exp > 0 && now > claims.exp;
    return {
      entitled: true,
      status: inGrace ? 'grace' : 'active',
      edition: 'pro',
      activationId: existing.activationId,
      kid: keyId,
      subject: claims.sub,
      exp: claims.exp,
      graceExp: claims.grace_exp,
    };
  }

  // New activation: the store enforces the ceiling atomically.
  const record: ActivationRecord = {
    activationId: newActivationId(),
    kid: keyId,
    subject: claims.sub,
    tokenHash,
    activatedAt: now,
    lastSeenAt: now,
    revokedAt: null,
    revokeReason: null,
    expiresAt: claims.grace_exp > 0 ? claims.grace_exp : claims.exp,
  };
  const inserted = await input.store.insertIfUnderLimit(record, maxActivations);
  if (!inserted.inserted) return deny('activation_limit', 'activation_limit_reached', claims, keyId);

  const inGrace = claims.exp > 0 && now > claims.exp;
  return {
    entitled: true,
    status: inGrace ? 'grace' : 'active',
    edition: 'pro',
    activationId: record.activationId,
    kid: keyId,
    subject: claims.sub,
    exp: claims.exp,
    graceExp: claims.grace_exp,
  };
}

export interface RevalidateInput {
  token: string;
  activationId: string;
  publicKeys: PublicKeyRing;
  store: ActivationStore;
  now?: number;
}

/**
 * Periodic server revalidation. Returns `invalid`/`revoked`/`expired` so the
 * client can drop entitlement; an unreachable server simply skips this call and
 * the client keeps the signed, time-bounded entitlement until `grace_exp`.
 */
export async function revalidateActivation(input: RevalidateInput): Promise<ActivateResult> {
  const now = input.now ?? Date.now();
  const verified = await verifyLicenseToken(input.token, input.publicKeys, now);
  if (!verified.valid) {
    if (verified.reason === 'expired') return deny('expired', 'token_expired', verified.claims, verified.header?.kid);
    return deny('invalid', `token_${verified.reason}`, verified.claims, verified.header?.kid);
  }
  const subjectRevocation = await input.store.isSubjectRevoked(verified.claims.sub);
  if (subjectRevocation) return deny('revoked', 'subject_revoked', verified.claims, verified.keyId);

  const record = await input.store.findByActivationId(input.activationId);
  if (!record) return deny('invalid', 'unknown_activation', verified.claims, verified.keyId);
  if (record.revokedAt !== null) return deny('revoked', 'activation_revoked', verified.claims, verified.keyId);
  const tokenHash = await sha256Hex(input.token);
  // Constant-time compare: the token hash is a secret-independent 64-hex value
  // but the codebase already has a timing-safe helper (Riven R-09).
  if (!timingSafeEqualHex(record.tokenHash, tokenHash)) {
    return deny('invalid', 'activation_token_mismatch', verified.claims, verified.keyId);
  }

  const cutoff = verified.claims.grace_exp > 0 ? verified.claims.grace_exp : verified.claims.exp;
  if (cutoff > 0 && now > cutoff) return deny('expired', 'token_expired', verified.claims, verified.keyId);

  await input.store.touch(record.activationId, now);
  const inGrace = verified.claims.exp > 0 && now > verified.claims.exp;
  return {
    entitled: true,
    status: inGrace ? 'grace' : 'active',
    edition: 'pro',
    activationId: record.activationId,
    kid: verified.keyId,
    subject: verified.claims.sub,
    exp: verified.claims.exp,
    graceExp: verified.claims.grace_exp,
  };
}

// --- In-memory store (tests / single process) --------------------------------

export class MemoryActivationStore implements ActivationStore {
  private readonly byTokenHash = new Map<string, ActivationRecord>();
  private readonly byActivationId = new Map<string, ActivationRecord>();
  private readonly subjectRevocations = new Map<string, SubjectRevocation>();

  countForSubject(subject: string): number {
    let n = 0;
    for (const record of this.byActivationId.values()) {
      if (record.subject === subject && record.revokedAt === null) n += 1;
    }
    return n;
  }

  findByTokenHash(tokenHash: string): ActivationRecord | null {
    const record = this.byTokenHash.get(tokenHash);
    return record ? { ...record } : null;
  }

  findByActivationId(activationId: string): ActivationRecord | null {
    const record = this.byActivationId.get(activationId);
    return record ? { ...record } : null;
  }

  listForSubject(subject: string): readonly ActivationRecord[] {
    return [...this.byActivationId.values()].filter(r => r.subject === subject).map(r => ({ ...r }));
  }

  insert(record: ActivationRecord): void {
    this.byTokenHash.set(record.tokenHash, record);
    this.byActivationId.set(record.activationId, record);
  }

  /**
   * Synchronous, therefore atomic within the single JS event loop: the count,
   * the check and the insert happen in one uninterruptible step.
   */
  insertIfUnderLimit(record: ActivationRecord, max: number): InsertIfUnderLimitResult {
    const count = this.countForSubject(record.subject);
    if (count >= max) return { inserted: false, count };
    this.insert(record);
    return { inserted: true, count: count + 1 };
  }

  touch(activationId: string, now: number): void {
    const record = this.byActivationId.get(activationId);
    if (record) record.lastSeenAt = now;
  }

  revoke(activationId: string, now: number, reason: string): boolean {
    const record = this.byActivationId.get(activationId);
    if (!record) return false;
    record.revokedAt = now;
    record.revokeReason = reason;
    return true;
  }

  revokeSubject(subject: string, now: number, reason: string): number {
    this.subjectRevocations.set(subject, { revokedAt: now, reason });
    let n = 0;
    for (const record of this.byActivationId.values()) {
      if (record.subject === subject && record.revokedAt === null) {
        record.revokedAt = now;
        record.revokeReason = reason;
        n += 1;
      }
    }
    return n;
  }

  isSubjectRevoked(subject: string): SubjectRevocation | null {
    const marker = this.subjectRevocations.get(subject);
    return marker ? { ...marker } : null;
  }
}
