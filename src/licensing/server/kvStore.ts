/**
 * Durable activation store backed by a KV namespace (Cloudflare KV, Redis-style
 * REST, or any store exposing `get`/`put`/`list`). Production counters and
 * revocation live here; `MemoryActivationStore` is tests/single-process only.
 *
 * Key layout (all JSON, no secrets, no PII beyond the opaque subject ref):
 *   act:<activationId>            -> ActivationRecord
 *   tok:<tokenHash>               -> activationId
 *   subj:<subject>:<activationId> -> activationId   (enables prefix counting)
 */

import type { ActivationRecord, ActivationStore } from './activation';

export interface MinimalKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>;
}

const ACT = 'act:';
const TOK = 'tok:';
const SUBJ = 'subj:';

export class KvActivationStore implements ActivationStore {
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

  async countForSubject(subject: string): Promise<number> {
    const listed = await this.kv.list({ prefix: `${SUBJ}${subject}:` });
    let count = 0;
    for (const { name } of listed.keys) {
      const id = name.slice(`${SUBJ}${subject}:`.length);
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
    const listed = await this.kv.list({ prefix: `${SUBJ}${subject}:` });
    const records: ActivationRecord[] = [];
    for (const { name } of listed.keys) {
      const id = name.slice(`${SUBJ}${subject}:`.length);
      const record = KvActivationStore.parse(await this.kv.get(`${ACT}${id}`));
      if (record) records.push(record);
    }
    return records;
  }

  async insert(record: ActivationRecord): Promise<void> {
    await this.kv.put(`${ACT}${record.activationId}`, JSON.stringify(record));
    await this.kv.put(`${TOK}${record.tokenHash}`, record.activationId);
    await this.kv.put(`${SUBJ}${record.subject}:${record.activationId}`, record.activationId);
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
}
