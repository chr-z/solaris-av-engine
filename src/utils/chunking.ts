/**
 * SOLARIS bundle chunking strategy (S3.1).
 *
 * Single source of truth consumed by `vite.config.ts` (rollup `manualChunks`)
 * and by unit tests, so the split policy cannot drift between build and spec.
 *
 * Policy:
 * - `firebase` vendor chunk: firebase/compat + @firebase/* — huge (~40% of the
 *   old monolith), changes rarely, so it gets a stable hash for cross-deploy caching.
 * - `react-vendor` chunk: react + react-dom + scheduler — stable across app deploys.
 * - Everything else (including all first-party code) follows Rollup defaults,
 *   which puts dynamically-imported modules in their own chunks.
 */

export type ChunkName = 'firebase' | 'react-vendor';

export const FIREBASE_CHUNK: ChunkName = 'firebase';
export const REACT_VENDOR_CHUNK: ChunkName = 'react-vendor';

/** Path fragments (forward-slash normalized) that identify Firebase runtime code. */
const FIREBASE_PACKAGE_FRAGMENTS = ['node_modules/firebase/', 'node_modules/@firebase/'];

/** Path fragments identifying the React rendering stack. */
const REACT_PACKAGE_FRAGMENTS = [
  'node_modules/react/',
  'node_modules/react-dom/',
  'node_modules/scheduler/',
];

export interface ModuleChunkInput {
  /** Module id exactly as handed to rollup's `manualChunks` (may contain `\`). */
  id: string;
  /** Whether the id points inside some installed package. */
  inNodeModules: boolean;
}

/**
 * Resolve which vendor chunk (if any) a module belongs to.
 * Pure: same input always yields the same chunk name; never mutates inputs.
 */
export const resolveVendorChunk = ({
  id,
  inNodeModules,
}: ModuleChunkInput): ChunkName | null => {
  if (!inNodeModules) return null;
  const normalized = id.replace(/\\/g, '/');
  if (FIREBASE_PACKAGE_FRAGMENTS.some((frag) => normalized.includes(frag))) {
    return FIREBASE_CHUNK;
  }
  if (REACT_PACKAGE_FRAGMENTS.some((frag) => normalized.includes(frag))) {
    return REACT_VENDOR_CHUNK;
  }
  return null;
};

/**
 * Convenience wrapper mirroring rollup's `manualChunks(id)` signature.
 * Kept trivially thin so vite.config.ts stays declarative.
 */
export const manualChunkForId = (id: string): ChunkName | null =>
  resolveVendorChunk({ id, inNodeModules: id.includes('node_modules') });
