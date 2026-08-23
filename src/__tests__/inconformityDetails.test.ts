import { describe, it, expect } from 'vitest';
import {
  inconformityDetailsMap,
  type InconformityDetails,
} from '../utils/inconformityDetails';
import { logCaptureService } from '../utils/logCapture';

describe('inconformityDetails: catalog integrity', () => {
  it('has entries for every catalogued inconformity', () => {
    const expected = [
      'Tilted/Crooked Camera',
      'Excessive/Low Headroom',
      'Poor Logo Framing',
      'Overexposed (Clipping)',
      'Underexposed (Dark)',
      'Out of Focus',
      'A/V Desync',
      'Chroma Key Failure',
      'Audio Clipping (Peaking)',
    ];
    for (const key of expected) {
      expect(inconformityDetailsMap[key]).toBeDefined();
    }
  });

  it('gives every entry a non-empty definition and analyst action', () => {
    const entries = Object.values(inconformityDetailsMap);
    expect(entries.length).toBeGreaterThan(5);
    for (const e of entries as InconformityDetails[]) {
      expect(e.definition.trim().length).toBeGreaterThan(0);
      expect(e.analystAction.trim().length).toBeGreaterThan(0);
      expect(e.type.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps grades within the 1..3 scale', () => {
    for (const e of Object.values(inconformityDetailsMap)) {
      expect([1, 2, 3]).toContain(e.grade);
    }
  });

  it('stores numeric scores as strings parseable by the sheet math', () => {
    for (const e of Object.values(inconformityDetailsMap)) {
      expect(Number.isNaN(parseFloat(e.score2024))).toBe(false);
      expect(Number.isNaN(parseFloat(e.score2025))).toBe(false);
    }
  });

  it('uses only known category types', () => {
    const allowed = ['FRAMING', 'LIGHTING', 'VIDEO', 'AUDIO', 'SCENERY'];
    for (const e of Object.values(inconformityDetailsMap)) {
      expect(allowed).toContain(e.type);
    }
  });
});

describe('logCapture: report generation', () => {
  it('generates a bug report with description, url and screen size', () => {
    const report = logCaptureService.generateReport(
      'Waveform freezes at 4K',
      null
    );
    expect(report.description).toBe('Waveform freezes at 4K');
    expect(report.url).toContain('http');
    // jsdom reports screen as 0x0; the field must exist and be numeric
    expect(typeof report.screen.width).toBe('number');
    expect(typeof report.screen.height).toBe('number');
    expect(report.logs).toBeInstanceOf(Array);
  });

  it('serializes guest users as Guest', () => {
    const report = logCaptureService.generateReport('no user', null);
    expect(report.user).toBe('Guest');
  });

  it('keeps only safe user fields in the report', () => {
    const user = { id: 'u1', name: 'Zee', email: 'z@x.com' } as any;
    const report = logCaptureService.generateReport('check', user);
    expect(report.user).toEqual({ id: 'u1', name: 'Zee', email: 'z@x.com' });
    expect(Object.keys(report.user as object)).toHaveLength(3);
  });
});
