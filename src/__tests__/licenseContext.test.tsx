/**
 * SOLA-34 — LicenseProvider behaviour.
 *
 * Verifies the customer-visible half: tampered storage grants nothing, a real
 * Ed25519 token unlocks Pro, a server denial refuses, and an outage does not
 * brick a paying customer.
 */

import React, { useCallback, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const keyStore = vi.hoisted(() => ({ ring: {} as Record<string, string> }));

vi.mock('../licensing/keys', () => ({
  LICENSE_PUBLIC_KEYS: {},
  resolvePublicKeyRing: () => keyStore.ring,
}));

import { LICENSE_CACHE_KEY } from '../licensing/core';
import { LicenseProvider, useLicense } from '../licensing/LicenseContext';
import { newTestKeyPair, issueTestToken, type TestKeyPair } from '../licensing/__tests__/keypair';

let pair: TestKeyPair;
let validToken: string;

beforeAll(async () => {
  pair = await newTestKeyPair('sol-2026a');
  keyStore.ring = { ...pair.publicKeys };
  const issued = await issueTestToken(pair, {
    subject: 'order:P1001',
    issuedAt: Date.now() - 86_400_000,
    termEndsAt: Date.now() + 86_400_000,
    graceEndsAt: Date.now() + 30 * 86_400_000,
  });
  validToken = issued.token;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Probe({ token }: { token: string }) {
  const { isPro, activate, lastError } = useLicense();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      await activate(token);
    } finally {
      setBusy(false);
    }
  }, [activate, token]);
  return (
    <div>
      <span data-testid="pro">{String(isPro)}</span>
      <span data-testid="busy">{String(busy)}</span>
      <span data-testid="error">{lastError ?? ''}</span>
      <button onClick={() => void run()}>activate</button>
    </div>
  );
}

function mount(token: string) {
  return render(
    <LicenseProvider>
      <Probe token={token} />
    </LicenseProvider>,
  );
}

async function activate() {
  fireEvent.click(screen.getByText('activate'));
  await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('false'));
}

describe('LicenseProvider · tampered storage', () => {
  it('a fabricated cache record does not unlock Pro', async () => {
    window.localStorage.setItem(
      LICENSE_CACHE_KEY,
      JSON.stringify({ token: 'a.b.c', activationId: 'forged', verifiedAt: 0 }),
    );
    mount('a.b.c');
    await waitFor(() => expect(screen.getByTestId('pro').textContent).toBe('false'));
  });
});

describe('LicenseProvider · activation', () => {
  it('a real key unlocks Pro after a server-confirmed activation', async () => {
    window.localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ entitled: true, status: 'active', edition: 'pro', activationId: 'a1' }),
      }),
    );
    mount(validToken);
    await activate();
    await waitFor(() => expect(screen.getByTestId('pro').textContent).toBe('true'));
    const cached = JSON.parse(window.localStorage.getItem(LICENSE_CACHE_KEY)!);
    expect(cached).toMatchObject({ token: validToken, activationId: 'a1' });
  });

  it('an authoritative server denial refuses activation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ entitled: false, status: 'revoked', edition: 'free' }),
      }),
    );
    mount(validToken);
    await activate();
    expect(screen.getByTestId('pro').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('solaris.pro.invalidKey');
    expect(window.localStorage.getItem(LICENSE_CACHE_KEY)).toBeNull();
  });

  it('an outage does not brick the customer (signed token honoured offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    mount(validToken);
    await activate();
    await waitFor(() => expect(screen.getByTestId('pro').textContent).toBe('true'));
  });

  it('a forged key is refused locally without any network call', async () => {
    const attacker = await newTestKeyPair('attacker');
    const forged = (await issueTestToken(attacker, { subject: 'x' })).token;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mount(forged);
    await activate();
    expect(screen.getByTestId('pro').textContent).toBe('false');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tolerates small server clock skew (Naomi finding D)', async () => {
    const now = Date.now();
    const future = await issueTestToken(pair, {
      subject: 'order:skew',
      issuedAt: now + 60_000, // issued by a server 60s ahead of this machine
      termEndsAt: now + 90 * 86_400_000,
      graceEndsAt: now + 120 * 86_400_000,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    mount(future.token);
    await activate();
    await waitFor(() => expect(screen.getByTestId('pro').textContent).toBe('true'));
  });
});

describe('LicenseProvider · activation retry after outage (Naomi finding B)', () => {
  it('obtains an activation id when the backend returns', async () => {
    // A customer who installed during an outage: signed token, no activation id.
    window.localStorage.setItem(
      LICENSE_CACHE_KEY,
      JSON.stringify({ token: validToken, activationId: null, verifiedAt: 0 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ entitled: true, status: 'active', edition: 'pro', activationId: 'a2' }),
      }),
    );
    mount(validToken);
    await waitFor(() => {
      const cached = JSON.parse(window.localStorage.getItem(LICENSE_CACHE_KEY)!);
      expect(cached.activationId).toBe('a2');
    });
  });
});

describe('LicenseProvider · revalidation', () => {
  it('drops entitlement when the server reports revocation', async () => {
    // Seed a valid, previously-activated token whose revalidation is due.
    window.localStorage.setItem(
      LICENSE_CACHE_KEY,
      JSON.stringify({ token: validToken, activationId: 'a1', verifiedAt: 0 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ entitled: false, status: 'revoked', edition: 'free' }),
      }),
    );
    mount(validToken);
    // It may briefly resolve Pro from the signed token, then the server denial wins.
    await waitFor(() => expect(window.localStorage.getItem(LICENSE_CACHE_KEY)).toBeNull());
    expect(screen.getByTestId('pro').textContent).toBe('false');
  });
});
