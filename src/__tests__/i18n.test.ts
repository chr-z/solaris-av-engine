import { describe, it, expect, vi, afterEach } from 'vitest';
import { en, pt } from '../i18n/translations';
import { interpolate, detectInitialLocale, persistLocale } from '../i18n/core';

describe('i18n dictionaries', () => {
  it('has exactly the same keys in pt and en (compile-time parity + runtime check)', () => {
    const enKeys = Object.keys(en).sort();
    const ptKeys = Object.keys(pt).sort();
    expect(enKeys.length).toBeGreaterThan(30);
    expect(ptKeys).toEqual(enKeys);
  });

  it('has non-empty string values in both languages', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(typeof en[key]).toBe('string');
      expect(en[key].length).toBeGreaterThan(0);
      expect(typeof pt[key]).toBe('string');
      expect(pt[key].length).toBeGreaterThan(0);
    }
  });

  it('keeps placeholders consistent between locales', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const tokens = (s: string) => (s.match(/\{(\w+)\}/g) || []).sort();
      expect(tokens(pt[key])).toEqual(tokens(en[key]));
    }
  });
});

describe('interpolate', () => {
  it('replaces named tokens', () => {
    expect(interpolate('Expand monitor {monitor}', { monitor: 'Waveform' })).toBe('Expand monitor Waveform');
    expect(interpolate('{count} usuário(s) ativo(s)', { count: 3 })).toBe('3 usuário(s) ativo(s)');
  });

  it('leaves templates without params untouched and drops unknown tokens', () => {
    expect(interpolate('Load Failed')).toBe('Load Failed');
    expect(interpolate('Hello {name}, {missing}!', { name: 'Zee' })).toBe('Hello Zee, !');
  });

  it('handles repeated tokens and numeric values', () => {
    expect(interpolate('{n}+{n}', { n: 2 })).toBe('2+2');
    expect(interpolate('x={x}', { x: 0 })).toBe('x=0');
  });
});

describe('locale detection & persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.removeItem('solaris.locale');
  });

  it('defaults to pt when nothing is stored and no usable navigator.language exists', () => {
    window.localStorage.clear();
    vi.stubGlobal('navigator', {});
    expect(detectInitialLocale()).toBe('pt');
  });

  it('detects pt from a stored preference even when browser language is en', () => {
    window.localStorage.clear();
    vi.stubGlobal('navigator', { language: 'en-US' });
    window.localStorage.setItem('solaris.locale', 'pt');
    expect(detectInitialLocale()).toBe('pt');
  });

  it('falls back to browser language pt-BR -> pt and en-US -> en', () => {
    window.localStorage.clear();
    vi.stubGlobal('navigator', { language: 'pt-BR' });
    expect(detectInitialLocale()).toBe('pt');
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(detectInitialLocale()).toBe('en');
  });

  it('persists locale changes via localStorage', () => {
    window.localStorage.clear();
    persistLocale('en');
    expect(window.localStorage.getItem('solaris.locale')).toBe('en');
    persistLocale('pt');
    expect(window.localStorage.getItem('solaris.locale')).toBe('pt');
  });
});
