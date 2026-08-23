import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyConnectivityEvent,
  shouldRegisterSW,
} from '../pwa/registerSW';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('PWA connectivity status (pure logic)', () => {
  it('marks the status initialized on any event', () => {
    const prev = { isOnline: true, initialized: false };
    const next = applyConnectivityEvent(prev, false);
    expect(next.initialized).toBe(true);
  });

  it('transitions online -> offline and back', () => {
    const online = { isOnline: true, initialized: true };
    const offline = applyConnectivityEvent(online, false);
    expect(offline.isOnline).toBe(false);
    const restored = applyConnectivityEvent(offline, true);
    expect(restored.isOnline).toBe(true);
  });

  it('does not mutate the previous status object', () => {
    const prev = { isOnline: true, initialized: true };
    const next = applyConnectivityEvent(prev, false);
    expect(prev.isOnline).toBe(true);
    expect(next).not.toBe(prev);
  });
});

describe('shouldRegisterSW environment gating', () => {
  it('registers in production over https', () => {
    expect(shouldRegisterSW({ protocol: 'https:' }, { dev: false })).toBe(true);
  });

  it('registers in production over http (e.g. preview)', () => {
    expect(shouldRegisterSW({ protocol: 'http:' }, { dev: false })).toBe(true);
  });

  it('skips registration in dev mode regardless of protocol', () => {
    expect(shouldRegisterSW({ protocol: 'https:' }, { dev: true })).toBe(false);
    expect(shouldRegisterSW({ protocol: 'http:' }, { dev: true })).toBe(false);
  });

  it('skips registration on non-http schemes (file:, about:) even in prod', () => {
    expect(shouldRegisterSW({ protocol: 'file:' }, { dev: false })).toBe(false);
    expect(shouldRegisterSW({ protocol: 'about:' }, { dev: false })).toBe(false);
  });
});

describe('PWA static assets are coherent', () => {
  const manifestPath = path.join(repoRoot, 'public', 'manifest.webmanifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  it('declares required PWA identity fields', () => {
    expect(manifest.name).toContain('Solaris');
    expect(typeof manifest.short_name).toBe('string');
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
    expect(typeof manifest.theme_color).toBe('string');
    expect(typeof manifest.background_color).toBe('string');
  });

  it('references icon files that actually exist on disk', () => {
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const iconPath = path.join(repoRoot, 'public', icon.src);
      expect(fs.existsSync(iconPath)).toBe(true);
      const png = fs.readFileSync(iconPath);
      // PNG magic number
      expect(png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    }
  });

  it('includes a maskable icon for Android adaptive shapes', () => {
    const maskable = manifest.icons.filter((i: { purpose?: string }) => i.purpose === 'maskable');
    expect(maskable.length).toBeGreaterThanOrEqual(1);
  });

  it('service worker precaches the shell, manifest and icons', () => {
    const sw = fs.readFileSync(path.join(repoRoot, 'public', 'sw.js'), 'utf-8');
    for (const token of [
      "'./'",
      "'index.html'",
      "'manifest.webmanifest'",
      "'icons/icon-192.png'",
      "'icons/icon-512.png'",
      "addEventListener('fetch'",
      "addEventListener('install'",
      "addEventListener('activate'",
    ]) {
      expect(sw).toContain(token);
    }
  });
});
