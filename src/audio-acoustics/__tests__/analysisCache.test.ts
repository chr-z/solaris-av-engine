/**
 * Tests for the per-media analysis cache (LRU + optional persistence).
 * Real synthetic reports, fake storage — no jsdom localStorage dependency.
 */
import { describe, expect, it } from 'vitest';
import { createAnalysisCache, makeMediaFingerprint } from '../analysisCache';
import { analyzeAudioPcm } from '../audioAcoustics';
import { makeSpeechLike } from '../fixtures';

const SR = 16000;

function realReport(): ReturnType<typeof analyzeAudioPcm> {
  const pcm = makeSpeechLike(
    [
      { word: 1.2, pause: 0.9 },
      { word: 1.4, pause: 0.9 },
      { word: 1.3, pause: 0.0 },
    ],
    SR
  );
  return analyzeAudioPcm(pcm, SR);
}

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

describe('createAnalysisCache', () => {
  it('set→get returns the identical report; miss on unknown key', () => {
    const c = createAnalysisCache({ storage: null });
    const rep = realReport();
    expect(c.get('m1')).toBeUndefined();
    c.set('m1', rep);
    expect(c.get('m1')).toBe(rep);
    expect(c.has('m1')).toBe(true);
    expect(c.size()).toBe(1);
    expect(typeof c.ageMs('m1')).toBe('number');
    c.clear();
    expect(c.get('m1')).toBeUndefined();
  });

  it('persists through injectable storage and survives a fresh cache instance', () => {
    const st = fakeStorage();
    const rep = realReport();
    createAnalysisCache({ storage: st }).set('url:yt/abc', rep);
    // Nova instância, mesmo storage = hit (é o caso "voltou na tela ontem").
    const c2 = createAnalysisCache({ storage: st });
    const got = c2.get('url:yt/abc');
    expect(got).toBeDefined();
    expect(got?.overallScore).toBe(rep.overallScore);
    expect(got?.axes.reverb.score).toBe(rep.axes.reverb.score);
  });

  it('corrupted persisted payload is a MISS and gets purged', () => {
    const st = fakeStorage();
    const rep = realReport();
    const writer = createAnalysisCache({ storage: st });
    writer.set('bad', rep);
    // Corrompe no storage por trás.
    const key = Array.from(st._map.keys())[0];
    st._map.set(key, '{not-json-at-all');
    const reader = createAnalysisCache({ storage: st });
    expect(reader.get('bad')).toBeUndefined();
    expect(st._map.get(key)).toBeUndefined(); // purgada
  });

  it('version mismatch invalidates old entries', () => {
    const st = fakeStorage();
    const rep = realReport();
    createAnalysisCache({ storage: st }).set('old', rep);
    const key = Array.from(st._map.keys())[0];
    const parsed = JSON.parse(st._map.get(key) as string) as { v: number };
    parsed.v = 999;
    st._map.set(key, JSON.stringify(parsed));
    expect(createAnalysisCache({ storage: st }).get('old')).toBeUndefined();
  });

  it('evicts least-recently-used beyond maxEntries', () => {
    const c = createAnalysisCache({ storage: null, maxEntries: 2 });
    const rep = realReport();
    c.set('a', rep);
    c.set('b', rep);
    c.get('a'); // touch a → b vira o mais velho
    c.set('c', rep); // evicta b
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
    expect(c.size()).toBe(2);
  });

  it('media fingerprints: url passthrough and file triple', () => {
    expect(makeMediaFingerprint({ url: 'https://x/y.mp4' })).toBe('url:https://x/y.mp4');
    expect(makeMediaFingerprint({ name: 'aula.mp4', size: 123, lastModified: 7 })).toBe(
      'file:aula.mp4:123:7'
    );
  });
});
