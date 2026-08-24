import { describe, it, expect } from 'vitest';
import firebaseStandalone, {
  stubAuth,
  stubDatabase,
  getRef,
  StubGoogleAuthProvider,
} from '../config/firebaseStandalone';

describe('firebaseStandalone — stub offline p/ builds desktop', () => {
  it('set + once(value) retorna o valor gravado (store em memória)', async () => {
    const ref = getRef('teste/set-basico');
    await ref.set({ a: 1 });
    const snap = await ref.once('value');
    expect(snap.exists()).toBe(true);
    expect(snap.val()).toEqual({ a: 1 });
    expect(ref.key).toBe('set-basico');
  });

  it('refs com o mesmo caminho compartilham identidade e dados', async () => {
    const a = getRef('identidade/x');
    const b = getRef('/identidade/x/'); // barras nas bordas são normalizadas
    expect(a).toBe(b);
    await a.set(42);
    expect((await b.once('value')).val()).toBe(42);
  });

  it('on(value) dispara estado inicial e para após unsubscribe', async () => {
    const ref = getRef('listeners/y');
    await ref.set('inicial');
    const seen: unknown[] = [];
    const off = ref.on('value', (snap) => seen.push(snap.val()));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['inicial']);
    await ref.set('segundo'); // listener ainda ativo
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(['inicial', 'segundo']);
    off();
    await ref.set('terceiro');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(2); // nada novo após off
  });

  it('push() grava no filho, resolve como thenable e gera chave', async () => {
    const ref = getRef('fila/pushes');
    const pushed = await ref.push({ item: 1 });
    expect(pushed.key).toBeTruthy();
    const children = (await ref.once('value')).val() as Record<string, unknown>;
    expect(Object.values(children)).toEqual([{ item: 1 }]);
  });

  it('update faz merge parcial em objeto existente', async () => {
    const ref = getRef('merge/z');
    await ref.set({ keep: true, old: 1 });
    await ref.update({ old: 2, extra: 'novo' });
    expect((await ref.once('value')).val()).toEqual({
      keep: true,
      old: 2,
      extra: 'novo',
    });
  });

  it('transaction aplica a função sobre o valor atual', async () => {
    const ref = getRef('tx/w');
    await ref.set(10);
    const result = await ref.transaction((cur) => ((cur as number) ?? 0) + 5);
    expect(result.committed).toBe(true);
    expect(result.snapshot.val()).toBe(15);
  });

  it('ServerValue.TIMESTAMP resolve pra número no write', async () => {
    const before = Date.now();
    await getRef('ts/v').set(firebaseStandalone.database.ServerValue.TIMESTAMP);
    const val = (await getRef('ts/v').once('value')).val();
    expect(typeof val).toBe('number');
    expect(val as number).toBeGreaterThanOrEqual(before);
  });

  it('remove limpa o caminho (exists false)', async () => {
    const ref = getRef('remover/u');
    await ref.set({ x: 1 });
    await ref.remove();
    expect((await ref.once('value')).exists()).toBe(false);
  });

  it('goOffline/goOnline e onDisconnect são no-ops seguros', async () => {
    expect(() => stubDatabase.goOffline()).not.toThrow();
    expect(() => stubDatabase.goOnline()).not.toThrow();
    await expect(
      getRef('disc/q').onDisconnect().set('qualquer'),
    ).resolves.toBeUndefined();
  });

  it('auth: sessão sempre nula; popup rejeita com código standalone', async () => {
    let fired: unknown = 'nunca';
    const stop = stubAuth.onAuthStateChanged((u) => {
      fired = u;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fired).toBeNull();
    stop();
    stubAuth.currentUser = null;
    await expect(stubAuth.signInWithPopup({})).rejects.toMatchObject({
      code: 'auth/standalone-mode',
    });
  });

  it('default export expõe superfície compat usada pelo app', () => {
    expect(Array.isArray(firebaseStandalone.apps)).toBe(true);
    expect(() => firebaseStandalone.initializeApp({})).not.toThrow();
    expect(typeof firebaseStandalone.database().ref('qualquer').set).toBe('function');
    const provider = new firebaseStandalone.auth.GoogleAuthProvider();
    expect(provider.addScope('email')).toBeInstanceOf(StubGoogleAuthProvider);
  });
});
