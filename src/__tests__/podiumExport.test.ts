// Solaris v3 — C4/E — exportação de pódio com opt-in EXPLÍCITO.
// O gate é o teste central: sem `optIn: true`, NENHUM byte existe (null).
// Com opt-in: CSV e XLSX gêmeos, determinísticos, com nomes estáveis.

import { describe, expect, it } from 'vitest';
import {
  buildPodiumCsv,
  buildPodiumXlsx,
  podiumExportFilename,
  type PodiumExportInput,
} from '../features/gamification/podiumExport';
import {
  isPodiumShareAllowed,
  setPodiumShareAllowed,
  PODIUM_SHARE_OPTIN_KEY,
} from '../features/gamification/podiumSharePref';

const INPUT: PodiumExportInput = {
  periodType: 'month',
  periodKey: '2026-08',
  rows: [
    { userId: 'u1', name: 'Ana', rank: 1, xp: 1200, reworkCount: 0 },
    { userId: 'u2', name: 'Bruno, "B"', rank: 2, xp: 900, reworkCount: 1 },
    { userId: 'u3', name: 'Carla', rank: 2, xp: 900, reworkCount: 1 },
    { userId: 'u4', name: 'Diogo', rank: 4, xp: 100, reworkCount: 2 },
  ],
};

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('buildPodiumCsv — o gate de opt-in', () => {
  it('SEM opt-in devolve null (nenhum dado sai)', () => {
    expect(buildPodiumCsv(INPUT, { optIn: false })).toBeNull();
  });

  it('optIn ausente/lixo também recusa (gate é valor, não comentário)', () => {
    expect(buildPodiumCsv(INPUT, {} as { optIn: boolean })).toBeNull();
    // @ts-expect-error — lixo de tipo em runtime não abre o gate
    expect(buildPodiumCsv(INPUT, { optIn: 'sim' })).toBeNull();
  });

  it('COM opt-in gera CSV completo, ordenado por rank, CRLF', () => {
    const csv = buildPodiumCsv(INPUT, { locale: 'en', optIn: true });
    expect(csv).not.toBeNull();
    const lines = (csv as string).split('\r\n');
    expect(lines[0]).toBe(
      'rank,analyst,user_id,xp,rework_count,period,period_key',
    );
    expect(lines[1]).toBe('1,Ana,u1,1200,0,Month,2026-08');
    expect(lines[2]).toContain('"Bruno, ""B"""'); // escape RFC 4180
    expect(lines[3]).toContain('Carla');
    expect(lines.length).toBe(5); // header + 4 linhas
  });

  it('rótulo do período segue o locale (pt → Mês)', () => {
    const csv = buildPodiumCsv(INPUT, { locale: 'pt', optIn: true }) as string;
    expect(csv.split('\r\n')[1]).toBe('1,Ana,u1,1200,0,Mês,2026-08');
  });
});

describe('buildPodiumXlsx — mesmo gate, pacote OOXML', () => {
  const FIXED = new Date(Date.UTC(2026, 7, 25, 12, 0, 0));

  it('sem opt-in nem monta bytes', () => {
    expect(buildPodiumXlsx(INPUT, { optIn: false, now: FIXED })).toBeNull();
  });

  it('com opt-in: ZIP assinado, sheet Podium, números como células numéricas', () => {
    const x = buildPodiumXlsx(INPUT, { locale: 'en', optIn: true, now: FIXED });
    expect(x).toBeInstanceOf(Uint8Array);
    // assinatura do ZIP local file header
    expect([x![0], x![1], x![2], x![3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const xml = new TextDecoder().decode(x!);
    expect(xml).toContain('Podium'); // nome da sheet no workbook.xml
    expect(xml).toMatch(/<c r="D2"><v>1200<\/v><\/c>/); // xp numérico
    expect(xml).toContain('Ana');
  });

  it('determinístico para a mesma entrada+timestamp', () => {
    const a = buildPodiumXlsx(INPUT, { optIn: true, now: FIXED });
    const b = buildPodiumXlsx(INPUT, { optIn: true, now: FIXED });
    expect(a).toEqual(b);
  });
});

describe('podiumExportFilename — estável para os gêmeos', () => {
  it('mesmo radical para csv/xlsx', () => {
    expect(podiumExportFilename(INPUT, 'csv')).toBe('solaris-podium_month_2026-08.csv');
    expect(podiumExportFilename(INPUT, 'xlsx')).toBe('solaris-podium_month_2026-08.xlsx');
  });

  it('funciona p/ todos os períodos', () => {
    expect(
      podiumExportFilename({ periodType: 'week', periodKey: '2026-W34' }, 'csv'),
    ).toBe('solaris-podium_week_2026-W34.csv');
    expect(
      podiumExportFilename({ periodType: 'year', periodKey: '2026' }, 'xlsx'),
    ).toBe('solaris-podium_year_2026.xlsx');
  });
});

describe('podiumSharePref — default OFF, falha fechada', () => {
  it('storage vazio → OFF', () => {
    const s = memoryStorage();
    expect(isPodiumShareAllowed(s)).toBe(false);
  });

  it('só o valor exato \'1\' liga', () => {
    const s = memoryStorage({ [PODIUM_SHARE_OPTIN_KEY]: '1' });
    expect(isPodiumShareAllowed(s)).toBe(true);
    const sujo = memoryStorage({ [PODIUM_SHARE_OPTIN_KEY]: 'true' });
    expect(isPodiumShareAllowed(sujo)).toBe(false);
  });

  it('set ON grava \'1\'; set OFF REMOVE a chave (mapa enxuto)', () => {
    const s = memoryStorage();
    setPodiumShareAllowed(s, true);
    expect(s.getItem(PODIUM_SHARE_OPTIN_KEY)).toBe('1');
    setPodiumShareAllowed(s, false);
    expect(s.getItem(PODIUM_SHARE_OPTIN_KEY)).toBeNull();
  });

  it('storage null ou explosivo → OFF (nunca abre por erro)', () => {
    expect(isPodiumShareAllowed(null)).toBe(false);
    const bomba = {
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(isPodiumShareAllowed(bomba)).toBe(false);
    // setItem que explode não derruba o chamador
    const bombaSet = {
      getItem: () => null,
      setItem: () => {
        throw new Error('boom');
      },
      removeItem: () => {},
    };
    expect(() => setPodiumShareAllowed(bombaSet, true)).not.toThrow();
  });
});
