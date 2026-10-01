import { describe, it, expect } from 'vitest';
import { KvActivationStore, type MinimalKv } from '../kvStore';
import { MemoryActivationStore, activateLicense, revalidateActivation } from '../activation';
import { newTestKeyPair, issueTestToken } from '../../__tests__/keypair';

const NOW = 1_700_000_000_000;

/** Minimal in-memory KV matching the Cloudflare KV surface used by the store. */
class FakeKv implements MinimalKv {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async list(options: { prefix?: string } = {}): Promise<{ keys: { name: string }[] }> {
    const prefix = options.prefix ?? '';
    const keys = [...this.map.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
    return { keys };
  }
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
