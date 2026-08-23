import { describe, it, expect } from 'vitest';
import {
  resolveVendorChunk,
  manualChunkForId,
  FIREBASE_CHUNK,
  REACT_VENDOR_CHUNK,
} from '../utils/chunking';

const inNodeModules = { inNodeModules: true };

describe('resolveVendorChunk — firebase grouping', () => {
  it('routes firebase compat entry into the firebase chunk', () => {
    expect(
      resolveVendorChunk({
        id: 'C:/Yui/data/saas/solaris-av-engine/node_modules/firebase/compat/app.js',
        ...inNodeModules,
      }),
    ).toBe(FIREBASE_CHUNK);
  });

  it('normalizes backslash module ids (Windows paths)', () => {
    expect(
      resolveVendorChunk({
        id: 'C:\\Yui\\data\\saas\\solaris-av-engine\\node_modules\\@firebase\\database\\dist\\index.js',
        ...inNodeModules,
      }),
    ).toBe(FIREBASE_CHUNK);
  });

  it('does not leak lookalike first-party code into vendor chunks', () => {
    expect(
      resolveVendorChunk({
        id: 'C:/app/src/utils/firebaseHelpers.ts',
        ...inNodeModules,
      }),
    ).toBeNull();
  });
});

describe('resolveVendorChunk — react grouping', () => {
  it('groups react-dom into the react-vendor chunk', () => {
    expect(
      resolveVendorChunk({
        id: '/home/ci/project/node_modules/react-dom/cjs/react-dom.production.min.js',
        ...inNodeModules,
      }),
    ).toBe(REACT_VENDOR_CHUNK);
  });

  it('groups the scheduler alongside react (react-dom dependency)', () => {
    expect(
      resolveVendorChunk({ id: '.../node_modules/scheduler/index.js', ...inNodeModules }),
    ).toBe(REACT_VENDOR_CHUNK);
  });
});

describe('resolveVendorChunk — fallbacks and edge cases', () => {
  it('returns null for first-party source modules (rollup defaults apply)', () => {
    expect(
      resolveVendorChunk({ id: '/proj/src/components/Analysis/AnalysisWorkspace.tsx', ...inNodeModules }),
    ).toBeNull();
  });

  it('never classifies app code even when node_modules is false', () => {
    expect(
      resolveVendorChunk({ id: '/proj/node_modules/firebase/app.js', inNodeModules: false }),
    ).toBeNull();
  });

  it('is deterministic across repeated calls (pure function)', () => {
    const id = 'X:\\repo\\node_modules\\@firebase\\auth\\dist\\index.mjs';
    const first = manualChunkForId(id);
    const second = manualChunkForId(id);
    expect(first).toBe(FIREBASE_CHUNK);
    expect(first).toBe(second);
  });
});

describe('manualChunkForId — rollup signature wrapper', () => {
  it('infers node_modules membership from the id itself', () => {
    expect(manualChunkForId('/x/node_modules/react/index.js')).toBe(REACT_VENDOR_CHUNK);
    expect(manualChunkForId('/x/src/main.tsx')).toBeNull();
  });
});
