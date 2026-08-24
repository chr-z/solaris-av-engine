// S3.x lazy Firebase loader (turbo-web).
//
// The Firebase compat SDK is large (~472KB raw / ~97KB gzip). Historically it
// was imported eagerly from `config/firebase.ts`, dragging the whole SDK into
// the first-paint bundle even though nothing touches auth/database until after
// the Google libraries finish polling. This module now loads the SDK on
// demand, exactly once, and hands out typed handles.
//
// Contract for consumers:
// - `getFirebaseCompat()` → Promise of the `firebase/compat/app` default
//   export (for ServerValue.TIMESTAMP and the `firebase.*` TYPE namespaces).
// - `getDb()` / `getFbAuth()` → awaited Realtime Database / Auth handles,
//   memoized so repeated calls never re-initialize the app.
// - Types: use `FirebaseCompatApp` (the instance type) instead of the
//   namespace — e.g. `firebase.database.DataSnapshot` becomes
//   `FirebaseCompatApp['database']['DataSnapshot']`.
//
// Initialization stays side-effect free until the first getter call, which
// keeps unit tests and SSR-ish imports from booting the SDK accidentally.

import type firebaseTopLevel from 'firebase/compat/app';

/** Instance type of the firebase/compat app module's default export. */
export type FirebaseCompatApp = typeof firebaseTopLevel;

/**
 * Structural stand-ins for the compat namespace types (which only exist at
 * type level after the side-effect packages load). Consumers annotate their
 * callbacks with these instead of reaching into `firebase.*` namespaces.
 */
export interface SnapshotLike {
    val(): any;
    exists(): boolean;
}

/** Minimal shape App needs from an authenticated user. */
export interface FbUserLike {
    uid: string;
    displayName: string | null;
    photoURL: string | null;
    email: string | null;
}

/** Cancel function returned by RTDB `.on()` handlers (extra params tolerated). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UnsubscribeFn = (a?: any, b?: any) => void;

export interface FirebaseHandles {
    /** firebase/compat/app default export (namespaces + ServerValue). */
    app: FirebaseCompatApp;
    /** Initialized Realtime Database handle. */
    db: ReturnType<FirebaseCompatApp['database']>;
    /** Initialized Auth handle. */
    fbAuth: ReturnType<FirebaseCompatApp['auth']>;
}

// Configuration injected via Vite Environment Variables
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let handlesPromise: Promise<FirebaseHandles> | null = null;

/**
 * Load the compat SDK once, initialize the app once, and memoize the
 * database/auth handles. Concurrent callers share the same promise.
 */
export function loadFirebase(): Promise<FirebaseHandles> {
    if (!handlesPromise) {
        handlesPromise = (async () => {
            const app = (await import('firebase/compat/app')).default;
            await import('firebase/compat/auth');
            await import('firebase/compat/database');
            if (!app.apps.length) {
                app.initializeApp(firebaseConfig);
            }
            return { app, db: app.database(), fbAuth: app.auth() };
        })();
    }
    return handlesPromise;
}

/** Memoized Realtime Database handle (SDK loaded on first call). */
export async function getDb(): Promise<ReturnType<FirebaseCompatApp['database']>> {
    return (await loadFirebase()).db;
}

/** Memoized Auth handle (SDK loaded on first call). */
export async function getFbAuth(): Promise<ReturnType<FirebaseCompatApp['auth']>> {
    return (await loadFirebase()).fbAuth;
}

/**
 * Combined handle for call sites needing the SDK namespace itself (e.g.
 * `app.database.ServerValue.TIMESTAMP`, `new app.auth.GoogleAuthProvider()`).
 */
export async function getFirebaseCompat(): Promise<FirebaseHandles> {
    return loadFirebase();
}
