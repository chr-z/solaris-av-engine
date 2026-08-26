import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('isFirebaseConfigured (turbo-web offline gate)', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllEnvs();
    });

    it('returns false without Firebase env vars', async () => {
        vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
        vi.stubEnv('VITE_FIREBASE_DATABASE_URL', '');
        const mod = await import('../config/firebase');
        expect(mod.isFirebaseConfigured()).toBe(false);
    });

    it('returns true when project id and database url exist', async () => {
        vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'solaris-demo');
        vi.stubEnv('VITE_FIREBASE_DATABASE_URL', 'https://solaris-demo.firebaseio.com');
        const mod = await import('../config/firebase');
        expect(mod.isFirebaseConfigured()).toBe(true);
    });

    it('loadFirebase rejects fast and never boots the SDK when unconfigured', async () => {
        vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
        vi.stubEnv('VITE_FIREBASE_DATABASE_URL', '');
        const mod = await import('../config/firebase');
        await expect(mod.loadFirebase()).rejects.toThrow(/not configured/i);
        // memoized rejection: second call returns the same promise
        await expect(mod.loadFirebase()).rejects.toThrow(/not configured/i);
    });
});
