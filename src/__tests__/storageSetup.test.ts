import { describe, expect, it } from 'vitest';

/**
 * Regression: Node >= 22 exposes an experimental global `localStorage` that is
 * `undefined` without `--localstorage-file`, shadowing jsdom's implementation
 * and breaking every storage-backed test. `src/test/setup.ts` must guarantee a
 * usable Web Storage API regardless of the host Node version.
 */
describe('test setup: Web Storage availability', () => {
  it.each(['localStorage', 'sessionStorage'] as const)('%s is a usable Storage', key => {
    const storage = globalThis[key] as Storage;
    expect(storage).toBeDefined();
    expect(typeof storage.getItem).toBe('function');
    expect(typeof storage.setItem).toBe('function');
    expect(typeof storage.removeItem).toBe('function');
    expect(typeof storage.clear).toBe('function');
    expect(typeof storage.key).toBe('function');
  });

  it('round-trips string values and coerces keys/values like the DOM Storage spec', () => {
    localStorage.clear();
    localStorage.setItem('solaris.k', 'v');
    expect(localStorage.getItem('solaris.k')).toBe('v');
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe('solaris.k');

    localStorage.setItem('solaris.n', '1');
    expect(localStorage.getItem('solaris.n')).toBe('1');
    expect(localStorage.key(5)).toBeNull();

    localStorage.removeItem('solaris.k');
    expect(localStorage.getItem('solaris.k')).toBeNull();
    expect(localStorage.length).toBe(1);

    localStorage.clear();
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem('solaris.n')).toBeNull();
  });

  it('isolates localStorage from sessionStorage', () => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('iso', 'local');
    expect(sessionStorage.getItem('iso')).toBeNull();
    localStorage.clear();
    sessionStorage.clear();
  });
});
