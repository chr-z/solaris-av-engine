/**
 * Testes do SaturnoConnector (spec SOLARIS_V3_SATURNO.md).
 * Cobre: normalizador quirky (7 casos de JSON malformado), mapeamento de
 * campos, datas loose, build de URL/headers e fallback Planilha.
 */
import { describe, it, expect } from 'vitest';
import {
  SaturnoConnector,
  SaturnoError,
  DEFAULT_SATURNO_CONFIG,
  normalizeQuirkyJson,
  parseSaturnoPayload,
  mapSaturnoRecord,
  toIsoDateLoose,
  extractOsNumber,
  sanitizeConfigForLog,
} from '../services/saturno';

describe('normalizeQuirkyJson — casos históricos malformados', () => {
  it('1. prefixo anti-hijack )]}\'', () => {
    const parsed = parseSaturnoPayload(`)]}'\n{"os":"12345"}`, 'saturno-quirky');
    expect(parsed).toEqual({ os: '12345' });
  });

  it('2. aspas simples no lugar das duplas', () => {
    const parsed = parseSaturnoPayload(
      `{'os': '12345', 'professor': 'Duda'}`,
      'saturno-quirky',
    );
    expect(parsed).toEqual({ os: '12345', professor: 'Duda' });
  });

  it('3. vírgula pendurada antes de fechamento', () => {
    const parsed = parseSaturnoPayload(
      `{"os": "12345", "estudio": "SEDE 11",}`,
      'saturno-quirky',
    );
    expect(parsed).toEqual({ os: '12345', estudio: 'SEDE 11' });
  });

  it('4. chaves sem aspas', () => {
    const parsed = parseSaturnoPayload(
      `{os_id: 12345, professor: "Duda"}`,
      'saturno-quirky',
    );
    expect(parsed).toEqual({ os_id: 12345, professor: 'Duda' });
  });

  it('5. lixo textual antes do JSON (log concatenado)', () => {
    const parsed = parseSaturnoPayload(
      `[2026-08-24 03:00:01] WARN cache stale\n{"os":12345}`,
      'saturno-quirky',
    );
    expect(parsed).toEqual({ os: 12345 });
  });

  it('6. apóstrofo dentro de string dupla NÃO vira delimitador', () => {
    const parsed = parseSaturnoPayload(
      `{"evento": "Natal da Igreja's Central", "os": "555"}`,
      'saturno-quirky',
    );
    expect(parsed).toEqual({ evento: "Natal da Igreja's Central", os: '555' });
  });

  it('7. while(1); + aspas simples + trailing comma combinados', () => {
    const parsed = parseSaturnoPayload(
      `while(1);{'os':'777','data':'14/07/2026',}`,
      'saturno-quirky',
    );
    expect(parsed).toEqual({ os: '777', data: '14/07/2026' });
  });

  it('JSON válido passa direto em ambos os modos', () => {
    expect(parseSaturnoPayload('{"a":1}', 'json')).toEqual({ a: 1 });
    expect(parseSaturnoPayload('{"a":1}', 'saturno-quirky')).toEqual({ a: 1 });
  });

  it('modo json estrito REJEITA payload malformado', () => {
    expect(() => parseSaturnoPayload("{'os':1}", 'json')).toThrow(SaturnoError);
  });

  it('normalizador é determinístico e não quebra string com colchetes', () => {
    const s = `{'obs': 'usar [REVISAR] se aula dupla'}`;
    expect(normalizeQuirkyJson(s)).toBe('{"obs": "usar [REVISAR] se aula dupla"}');
  });
});

describe('mapSaturnoRecord', () => {
  it('mapeia payload canônico com aliases e wrappers', () => {
    const rec = mapSaturnoRecord({
      data: {
        OS: 'OS-12345',
        'Professor(a)': 'Duda',
        OPERADOR: 'Léo',
        DATA: '14/07/2026',
        'Estúdio': 'SEDE 11',
        TIPO: 'Aula',
        caminho_alfred: '2026/07/SEDE-11/2026-07-14/OS-12345/',
      },
    });
    expect(rec.osId).toBe('12345');
    expect(rec.professor).toBe('Duda');
    expect(rec.operador).toBe('Léo');
    expect(rec.data).toBe('2026-07-14');
    expect(rec.estudio).toBe('SEDE 11');
    expect(rec.alfredPath).toBe('2026/07/SEDE-11/2026-07-14/OS-12345');
    expect(rec.rawJson).toBeDefined();
  });

  it('payload sem número de OS é rejeitado (unparseable)', () => {
    expect(() => mapSaturnoRecord({ foo: 'bar' })).toThrow(SaturnoError);
  });

  it('datas ISO, BR e cruas passam pelo toIsoDateLoose', () => {
    expect(toIsoDateLoose('2026-07-14T09:00:00Z')).toBe('2026-07-14');
    expect(toIsoDateLoose('14/07/2026')).toBe('2026-07-14');
    expect(toIsoDateLoose('7-8-26')).toBe('2026-08-07');
    expect(toIsoDateLoose('')).toBeUndefined();
  });

  it('extractOsNumber aceita número e string com ruído', () => {
    expect(extractOsNumber(12345)).toBe('12345');
    expect(extractOsNumber('OS_98765_bloco2')).toBe('98765');
    expect(extractOsNumber('sem-numero')).toBeUndefined();
  });
});

describe('SaturnoConnector — config, headers e fallback', () => {
  it('defaults: desabilitado, X-API-Key, modo saturno-quirky', () => {
    const cfg = DEFAULT_SATURNO_CONFIG;
    expect(cfg.enabled).toBe(false);
    expect(cfg.headerName).toBe('X-API-Key');
    expect(cfg.responseMode).toBe('saturno-quirky');
  });

  it('buildUrl monta base+template e encoda o id', () => {
    const c = new SaturnoConnector({
      enabled: true,
      baseUrl: 'https://saturno.gran.example.br/',
      endpointTemplate: '/api/os/{os_id}',
      apiKey: 'k',
    });
    expect(c.buildUrl('12/34')).toBe('https://saturno.gran.example.br/api/os/12%2F34');
  });

  it('buildUrl sem baseUrl ou sem {os_id} lança config-invalid', () => {
    const c = new SaturnoConnector({ enabled: true });
    expect(() => c.buildUrl('1')).toThrow(SaturnoError);
    const c2 = new SaturnoConnector({
      enabled: true,
      baseUrl: 'https://x.example',
      endpointTemplate: '/api/os/',
    });
    expect(() => c2.buildUrl('1')).toThrow(/marcador/);
  });

  it('fetchOs sem habilitar lança disabled; sem apiKey lança config-invalid', async () => {
    const c = new SaturnoConnector();
    await expect(c.fetchOs('1')).rejects.toMatchObject({ kind: 'disabled' });
    c.updateConfig({ enabled: true });
    await expect(c.fetchOs('1')).rejects.toMatchObject({ kind: 'config-invalid' });
  });

  it('fetchOs happy path com header customizável + payload quirky', async () => {
    let seenHeaders: Record<string, string> | undefined;
    let seenUrl = '';
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(")]}'\n{'os':'12345','professor':'Duda'}", {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const c = new SaturnoConnector({
      enabled: true,
      baseUrl: 'https://saturno.test',
      apiKey: 'sekret-token-abc',
      headerName: 'X-API-Key',
      responseMode: 'saturno-quirky',
    });
    // Injeção mínima de fetch (ambiente jsdom/node não tem rede aqui).
    const origFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;
    try {
      const rec = await c.fetchOs('12345');
      expect(seenUrl).toBe('https://saturno.test/api/os/12345');
      expect(seenHeaders?.['X-API-Key']).toBe('sekret-token-abc');
      expect(rec.osId).toBe('12345');
      expect(rec.professor).toBe('Duda');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('Authorization Bearer via headerName configurável', () => {
    const c = new SaturnoConnector({
      enabled: true,
      baseUrl: 'https://x.test',
      apiKey: 'tok',
      headerName: 'Authorization',
      authScheme: 'Bearer',
    });
    const h = (
      c as unknown as { buildHeaders(): Record<string, string> }
    ).buildHeaders();
    expect(h['Authorization']).toBe('Bearer tok');
    const c2 = new SaturnoConnector({
      enabled: true,
      baseUrl: 'https://x.test',
      apiKey: 'raw',
      headerName: 'Authorization',
      authScheme: '',
    });
    const h2 = (
      c2 as unknown as { buildHeaders(): Record<string, string> }
    ).buildHeaders();
    expect(h2['Authorization']).toBe('raw');
  });

  it('sanitizeConfigForLog nunca expõe o valor da chave', () => {
    const s = sanitizeConfigForLog({
      ...DEFAULT_SATURNO_CONFIG,
      apiKey: 'super-secret-value',
    });
    const str = JSON.stringify(s);
    expect(str).not.toContain('super-secret-value');
    expect(str).toContain('<set:18 chars>');
  });

  it('fallback Planilha reporta motivo quando desabilitado', () => {
    expect(SaturnoConnector.planilhaFallbackReason(DEFAULT_SATURNO_CONFIG)).toMatch(
      /Planilha/,
    );
    expect(
      SaturnoConnector.planilhaFallbackReason({
        ...DEFAULT_SATURNO_CONFIG,
        enabled: true,
      }),
    ).toBeNull();
  });

  it('HTTP 500 vira erro tipado http (não derruba o caller)', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('boom', { status: 500 })) as unknown as typeof fetch;
    try {
      const c = new SaturnoConnector({
        enabled: true,
        baseUrl: 'https://x.test',
        apiKey: 'k',
      });
      await expect(c.fetchOs('9')).rejects.toMatchObject({ kind: 'http', status: 500 });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
