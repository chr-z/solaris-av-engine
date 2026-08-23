/**
 * PWA registration + offline status tracking (S2.1).
 *
 * Pure decision logic (`shouldRegisterSW`, `applyConnectivityEvent`) is kept
 * separate from browser side effects so it stays unit-testable.
 */
import { useEffect, useState } from 'react';

export type OfflineStatus = {
  isOnline: boolean;
  /** True once we have observed boot state or at least one connectivity event. */
  initialized: boolean;
};

/** Connectivity state transitions, extracted pure for tests. */
export function applyConnectivityEvent(_prev: OfflineStatus, isOnline: boolean): OfflineStatus {
  return { isOnline, initialized: true };
}

/**
 * SW applies to real browsers over http(s); skipped in dev server and on
 * non-http schemes (file:, about:, etc.). Dependencies injected for tests.
 */
export function shouldRegisterSW(
  loc: { protocol: string } = typeof window !== 'undefined' ? window.location : { protocol: 'https:' },
  opts: { dev?: boolean } = {}
): boolean {
  if (loc.protocol !== 'https:' && loc.protocol !== 'http:') return false;
  let dev = opts.dev;
  if (dev === undefined) {
    try {
      dev = Boolean(import.meta.env && import.meta.env.DEV);
    } catch {
      dev = false;
    }
  }
  return !dev;
}

/** Register the service worker; resolves to the registration or null when skipped/failed. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!shouldRegisterSW()) return null;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    // Never break the app because of SW registration issues.
    console.warn('[solaris] Service worker registration skipped:', err);
    return null;
  }
}

function computeOnline(): boolean {
  try {
    return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  } catch {
    return true;
  }
}

/**
 * Tracks browser connectivity via `online`/`offline` events.
 * Note: navigator.onLine is a coarse signal — good enough for an indicator.
 */
export function useOfflineStatus(): OfflineStatus {
  const [status, setStatus] = useState<OfflineStatus>(() => ({
    isOnline: computeOnline(),
    initialized: typeof navigator !== 'undefined',
  }));

  useEffect(() => {
    const goOnline = () => setStatus((prev) => applyConnectivityEvent(prev, true));
    const goOffline = () => setStatus((prev) => applyConnectivityEvent(prev, false));
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return status;
}
