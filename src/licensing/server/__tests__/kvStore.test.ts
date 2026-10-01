import { describe, it, expect } from 'vitest';
import { KvActivationStore, KvReplayStore, type MinimalKv } from '../kvStore';
import { MemoryActivationStore, activateLicense, revalidateActivation, type ActivationRecord } from '../activation';
import { newTestKeyPair, issueTestToken } from '../../__tests__/keypair';

const NOW = 1_700_000_000_000;

/**
 * Minimal in-memory KV matching the Cloudflare KV surface used by the store,
 * including pagination: `pageSize` bounds each `list` page and a cursor is
 * returned until the keyspace is exhausted (Riven R-08).
 */
class FakeKv implements MinimalKv {
  private readonly map = new Map<string, string>();
  constructor(private readonly pageSize = Number.POSITIVE_INFINITY) {}
  async get(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async list(options: { prefix?: string; cursor?: string } = {}): Promise<{
    keys: { name: string }[];
    cursor?: string;
    list_complete?: boolean;
  }> {
    const prefix = options.prefix ?? '';
    const all = [...this.map.keys()].filter(k => k.startsWith(prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = all.slice(start, start + this.pageSize);
    const next = start + page.length;
    const complete = next >= all.length;
    return {
      keys: page.map(name => ({ name })),
      list_complete: complete,
      ...(complete ? {} : { cursor: String(next) }),
    };
  }
}

function fakeRecord(subject: string, i: number): ActivationRecord {
  return {
    activationId: i.toString(16).padStart(32, '0'),
    kid: 'kid-1',
    subject,
    tokenHash: `hash-${i}`,
    activatedAt: NOW,
    lastSeenAt: NOW,
    revokedAt: null,
    revokeReason: null,
    expiresAt: NOW + 1000,
  };
}

describe('KvActivationStore', () => {
  it('counts, finds, touches and revokes across act/tok/subj keys', async () => {
    const kv = new FakeKv();
    const store = new KvActivationStore(kv);
    const pair = await newTestKeyPair('kid-1');
    const { token } = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });

    const activated = await activateLicense({ token, publicKeys: pair.publicKeys, store, now: NOW });
    expect(activated.entitled).toBe(true);
    expect(await store.countForSubject('order:P1')).toBe(1);

    const found = await store.findByActivationId(activated.activationId!);
    expect(found?.subject).toBe('order:P1');

    await store.touch(activated.activationId!, NOW + 5);
    expect((await store.findByActivationId(activated.activationId!))?.lastSeenAt).toBe(NOW + 5);

    expect(await store.revoke(activated.activationId!, NOW + 10, 'refund')).toBe(true);
    expect(await store.countForSubject('order:P1')).toBe(0);
    expect(
      await revalidateActivation({
        token,
        activationId: activated.activationId!,
        publicKeys: pair.publicKeys,
        store,
        now: NOW + 11,
      }),
    ).toMatchObject({ entitled: false, status: 'revoked' });
  });

  it('enforces the ceiling durably (parity with the memory store)', async () => {
    const store = new KvActivationStore(new FakeKv());
    const pair = await newTestKeyPair('kid-1');
    const a = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const b = await issueTestToken(pair, { issuedAt: NOW - 2000, subject: 'order:P1' });
    expect((await activateLicense({ token: a.token, publicKeys: pair.publicKeys, store, now: NOW, maxActivations: 1 })).entitled).toBe(true);
    expect(
      await activateLicense({ token: b.token, publicKeys: pair.publicKeys, store, now: NOW, maxActivations: 1 }),
    ).toMatchObject({ status: 'activation_limit' });
  });

  it('R-04: concurrent activation burst cannot exceed the ceiling under an async store', async () => {
    const store = new KvActivationStore(new FakeKv());
    const pair = await newTestKeyPair('kid-1');
    const tokens = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        issueTestToken(pair, { issuedAt: NOW - 1000 - i * 1000, subject: 'order:BURST' }),
      ),
    );
    const results = await Promise.all(
      tokens.map(t => activateLicense({ token: t.token, publicKeys: pair.publicKeys, store, now: NOW, maxActivations: 5 })),
    );
    expect(results.filter(r => r.entitled).length).toBe(5);
    expect(await store.countForSubject('order:BURST')).toBe(5);
  });

  it('parity check: memory store counts only live activations', async () => {
    const store = new MemoryActivationStore();
    const pair = await newTestKeyPair('kid-1');
    const a = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P1' });
    const activated = await activateLicense({ token: a.token, publicKeys: pair.publicKeys, store, now: NOW });
    store.revokeSubject('order:P1', NOW, 'refund');
    expect(store.countForSubject('order:P1')).toBe(0);
    expect(store.findByActivationId(activated.activationId!)?.revokeReason).toBe('refund');
  });
});

describe('KvActivationStore · Riven R-08 key layout', () => {
  it('follows the KV list cursor so counting is not truncated at 1000 keys', async () => {
    const store = new KvActivationStore(new FakeKv(1000));
    for (let i = 0; i < 1200; i += 1) await store.insert(fakeRecord('order:BIG', i));
    expect(await store.countForSubject('order:BIG')).toBe(1200);
    expect((await store.listForSubject('order:BIG')).length).toBe(1200);
  });

  it('does not confuse a subject that is a prefix of another subject', async () => {
    const store = new KvActivationStore(new FakeKv(2));
    await store.insert(fakeRecord('order:A', 1));
    await store.insert(fakeRecord('order:A:B', 2));
    expect(await store.countForSubject('order:A')).toBe(1);
    expect(await store.countForSubject('order:A:B')).toBe(1);
  });

  it('R-03: a subject-level revocation marker denies a different activation', async () => {
    const store = new KvActivationStore(new FakeKv());
    const pair = await newTestKeyPair('kid-1');
    const a = await issueTestToken(pair, { issuedAt: NOW - 1000, subject: 'order:P9' });
    const b = await issueTestToken(pair, { issuedAt: NOW - 2000, subject: 'order:P9' });
    await activateLicense({ token: a.token, publicKeys: pair.publicKeys, store, now: NOW });
    await store.revokeSubject('order:P9', NOW + 1, 'chargeback');
    expect(await store.isSubjectRevoked('order:P9')).toMatchObject({ reason: 'chargeback' });
    expect(
      await activateLicense({ token: b.token, publicKeys: pair.publicKeys, store, now: NOW + 2 }),
    ).toMatchObject({ entitled: false, status: 'revoked' });
  });
});

describe('KvReplayStore', () => {
  it('remembers an event id so a replayed webhook is rejected', async () => {
    const store = new KvReplayStore(new FakeKv());
    expect(await store.has('evt-1')).toBe(false);
    await store.remember('evt-1', NOW);
    expect(await store.has('evt-1')).toBe(true);
  });
});
