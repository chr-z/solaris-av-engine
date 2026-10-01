/**
 * Durable activation store backed by a KV namespace (Cloudflare KV, Redis-style
 * REST, or any store exposing `get`/`put`/`list`). Production counters and
 * revocation live here; `MemoryActivationStore` is tests/single-process only.
 *
 * Key layout (all JSON, no secrets, no PII beyond the opaque subject ref).
 * The subject is length-prefixed so a subject containing `:` (e.g. `order:A:B`)
 * cannot collide with another subject's prefix nor mis-parse activation ids —
 * Riven R-08:
 *
 *   act:<activationId>                       -> ActivationRecord
 *   tok:<tokenHash>                          -> activationId
 *   subj:<len>:<subject>:<activationId>      -> activationId   (prefix counting)
 *   subjrev:<len>:<subject>                  -> SubjectRevocation
 *   replay:<eventId>                         -> <seenAt ms>     (webhook de-dup)
 *
 * Ceiling: `insertIfUnderLimit` serialises per subject within the isolate and
 * then count-then-inserts. KV has no compare-and-set, so a strict cross-isolate
 * ceiling requires D1 (`UNIQUE`) or a Durable Object; see docs/entitlements.md.
 */

import type {
  ActivationRecord,
  ActivationStore,
  InsertIfUnderLimitResult,
  SubjectRevocation,
} from './activation';
import type { ReplayStore } from './webhook';

export interface MinimalKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
  }): Promise<{ keys: { name: string }[]; cursor?: string; list_complete?: boolean }>;
}

const ACT = 'act:';
const TOK = 'tok:';
const SUBJ = 'subj:';
const SUBJREV = 'subjrev:';
const REPLAY = 'replay:';

/** Unambiguous, prefix-safe subject encoding: `subj:<len>:<subject>:`. */
function subjectPrefix(subject: string): string {
  return `${SUBJ}${subject.length}:${subject}:`;
}

function subjectRevocationKey(subject: string): string {
  return `${SUBJREV}${subject.length}:${subject}`;
}

/** Minimal async mutex keyed by subject — serialises ceiling checks per isolate. */
class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.tails.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}

export class KvActivationStore implements ActivationStore {
  private readonly mutex = new KeyedMutex();

  constructor(private readonly kv: MinimalKv) {}

  private static parse(raw: string | null): ActivationRecord | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as ActivationRecord;
      if (typeof parsed?.activationId === 'string' && typeof parsed?.tokenHash === 'string') return parsed;
      return null;
    } catch {
      return null;
    }
  }

  /** Follows the KV list cursor to exhaustion (Riven R-08 pagination fix). */
  private async listAllKeys(prefix: string): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.kv.list(cursor ? { prefix, cursor } : { prefix });
      for (const { name } of page.keys) names.push(name);
      if (page.list_complete || !page.cursor) break;
      cursor = page.cursor;
    }
    return names;
  }

  private async idsForSubject(subject: string): Promise<string[]> {
    const prefix = subjectPrefix(subject);
    const keys = await this.listAllKeys(prefix);
    return keys.map(name => name.slice(prefix.length));
  }

  async countForSubject(subject: string): Promise<number> {
    const ids = await this.idsForSubject(subject);
    let count = 0;
    for (const id of ids) {
      const record = KvActivationStore.parse(await this.kv.get(`${ACT}${id}`));
      if (record && record.revokedAt === null) count += 1;
    }
    return count;
  }

  async findByTokenHash(tokenHash: string): Promise<ActivationRecord | null> {
    const id = await this.kv.get(`${TOK}${tokenHash}`);
    if (!id) return null;
    return KvActivationStore.parse(await this.kv.get(`${ACT}${id}`));
  }

  async findByActivationId(activationId: string): Promise<ActivationRecord | null> {
    return KvActivationStore.parse(await this.kv.get(`${ACT}${activationId}`));
  }

  async listForSubject(subject: string): Promise<readonly ActivationRecord[]> {
    const ids = await this.idsForSubject(subject);
    const records: ActivationRecord[] = [];
    for (const id of ids) {
      const record = KvActivationStore.parse(await this.kv.get(`${ACT}${id}`));
      if (record) records.push(record);
    }
    return records;
  }

  async insert(record: ActivationRecord): Promise<void> {
    await this.kv.put(`${ACT}${record.activationId}`, JSON.stringify(record));
    await this.kv.put(`${TOK}${record.tokenHash}`, record.activationId);
    await this.kv.put(`${subjectPrefix(record.subject)}${record.activationId}`, record.activationId);
  }

  async insertIfUnderLimit(record: ActivationRecord, max: number): Promise<InsertIfUnderLimitResult> {
    return this.mutex.run(`subj:${record.subject}`, async () => {
      const count = await this.countForSubject(record.subject);
      if (count >= max) return { inserted: false, count };
      await this.insert(record);
      return { inserted: true, count: count + 1 };
    });
  }

  async touch(activationId: string, now: number): Promise<void> {
    const record = await this.findByActivationId(activationId);
    if (!record) return;
    record.lastSeenAt = now;
    await this.kv.put(`${ACT}${activationId}`, JSON.stringify(record));
  }

  async revoke(activationId: string, now: number, reason: string): Promise<boolean> {
    const record = await this.findByActivationId(activationId);
    if (!record) return false;
    record.revokedAt = now;
    record.revokeReason = reason;
    await this.kv.put(`${ACT}${activationId}`, JSON.stringify(record));
    return true;
  }

  async revokeSubject(subject: string, now: number, reason: string): Promise<number> {
    const marker: SubjectRevocation = { revokedAt: now, reason };
    await this.kv.put(subjectRevocationKey(subject), JSON.stringify(marker));
    const records = await this.listForSubject(subject);
    let n = 0;
    for (const record of records) {
      if (record.revokedAt !== null) continue;
      record.revokedAt = now;
      record.revokeReason = reason;
      await this.kv.put(`${ACT}${record.activationId}`, JSON.stringify(record));
      n += 1;
    }
    return n;
  }

  async isSubjectRevoked(subject: string): Promise<SubjectRevocation | null> {
    const raw = await this.kv.get(subjectRevocationKey(subject));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as SubjectRevocation;
      if (typeof parsed?.revokedAt === 'number') return parsed;
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * KV-backed webhook replay store (Riven R-02). The event id is remembered
 * durably so a replayed delivery is rejected on the deployed path, not only in
 * a unit test. Not atomic across isolates; a strict single-delivery guarantee
 * needs D1/DO, but this closes the practical replay window.
 */
export class KvReplayStore implements ReplayStore {
  constructor(private readonly kv: MinimalKv) {}

  async has(eventId: string): Promise<boolean> {
    return (await this.kv.get(`${REPLAY}${eventId}`)) !== null;
  }

  async remember(eventId: string, now: number): Promise<void> {
    await this.kv.put(`${REPLAY}${eventId}`, String(now));
  }
}
