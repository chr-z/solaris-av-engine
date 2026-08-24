/**
 * SaturnoConnector — Solaris v3 (spec: SOLARIS_V3_SATURNO.md)
 *
 * Adapter configurável para a fonte "Saturno" (sistema de OSs do Gran).
 * NÃO replica a gambiarra de cookies do MVP: autenticação por API key em
 * header customizável e normalizador tolerante ("saturno-quirky") para o
 * JSON malformado histórico.
 */

export type SaturnoResponseMode = 'json' | 'saturno-quirky';

export interface SaturnoSourceConfig {
  /** Fonte habilitada. Quando false, o Solaris usa só Planilha (fallback). */
  enabled: boolean;
  /** Ex.: https://saturno.gran.example.br — sem barra final. */
  baseUrl: string;
  /** Valor do token. NUNCA logado nem serializado em telemetria. */
  apiKey: string;
  /** Header onde o token viaja: 'X-API-Key' (default) ou 'Authorization'. */
  headerName: string;
  /**
   * Prefixo do valor quando headerName === 'Authorization' ('Bearer ' default;
   * vazio = valor cru). Ignorado nos demais headers.
   */
  authScheme: string;
  /** Template com {os_id}, ex.: '/api/os/{os_id}'. */
  endpointTemplate: string;
  responseMode: SaturnoResponseMode;
  timeoutMs: number;
}

/** Registro de OS vindo do Saturno (campos da planilha/OS histórica). */
export interface SaturnoOsRecord {
  osId: string;
  professor?: string;
  operador?: string;
  /** ISO yyyy-mm-dd quando parseável; string crua caso contrário. */
  data?: string;
  estudio?: string;
  tipo?: string;
  kit?: string;
  mic?: string;
  evento?: string;
  fundo?: string;
  streaming?: string;
  uniforme?: string;
  /**
   * Caminho/pasta declarado no Alfred (fonte da verdade p/ match exato),
   * se o Saturno informar.
   */
  alfredPath?: string;
  rawJson: unknown;
}

export class SaturnoError extends Error {
  readonly kind:
    | 'disabled'
    | 'config-invalid'
    | 'network'
    | 'timeout'
    | 'http'
    | 'unparseable';
  readonly status?: number;
  constructor(kind: SaturnoError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'SaturnoError';
    this.kind = kind;
    this.status = status;
  }
}

export const DEFAULT_SATURNO_CONFIG: SaturnoSourceConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  headerName: 'X-API-Key',
  authScheme: '',
  endpointTemplate: '/api/os/{os_id}',
  responseMode: 'saturno-quirky',
  timeoutMs: 15000,
};

const OS_ID_RE = /\{os_id\}/;

/** Campos aceitos no payload, com aliases comuns (case/space-insensitive). */
const FIELD_ALIASES: Record<string, string[]> = {
  osId: ['os', 'os_id', 'osid', 'numero_os', 'numeroso', 'o s', 'codigo', 'id'],
  professor: ['professor', 'professora', 'professor(a)', 'docente'],
  operador: ['operador', 'operadora'],
  data: ['data', 'date', 'dia'],
  estudio: ['estudio', 'estúdio', 'studio', 'sede'],
  tipo: ['tipo', 'type'],
  kit: ['kit'],
  mic: ['mic', 'microfone'],
  evento: ['evento', 'event'],
  fundo: ['fundo', 'background'],
  streaming: ['streaming', 'stream'],
  uniforme: ['uniforme'],
  alfredPath: [
    'caminho',
    'caminho_alfred',
    'path',
    'alfred_path',
    'pasta',
    'folder',
  ],
};

function normalizeKey(k: string): string {
  return k
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function pickField(
  obj: Record<string, unknown>,
  field: keyof typeof FIELD_ALIASES,
): unknown {
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) byKey.set(normalizeKey(k), v);
  for (const alias of FIELD_ALIASES[field]) {
    const hit = byKey.get(normalizeKey(alias));
    if (hit !== undefined && hit !== null && hit !== '') return hit;
  }
  return undefined;
}

/** yyyy-mm-dd se a string carregar uma data reconhecível; senão devolve crua. */
export function toIsoDateLoose(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (br) {
    const [, d, m, y] = br;
    const fullYear = y.length === 2 ? `20${y}` : y;
    return `${fullYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return s;
}

/** Extrai o número da OS de valores como "OS-12345" ou 12345. */
export function extractOsNumber(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value !== 'string') return undefined;
  const m = /(\d+)/.exec(value);
  return m ? m[1] : undefined;
}

/**
 * Correções em nível de caractere sobre um recorte já escolhido:
 * aspas simples → duplas, vírgulas penduradas, chaves sem aspas.
 */
function fixQuirkyChars(s: string): string {
  // Aspas simples → duplas fora de strings já duplas.
  let out = '';
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== '\\') inDouble = !inDouble;
    if (c === "'" && !inDouble) {
      // Aspas simples dentro de string dupla são conteúdo literal.
      out += '"';
    } else {
      out += c;
    }
    // Escapes: consome próximo char para não confundir delimitadores.
    if (c === '\\' && i + 1 < s.length) {
      out += s[i + 1];
      i++;
    }
  }
  s = out;

  // Vírgulas penduradas antes de fechamento (fora de strings).
  out = '';
  inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inDouble = !inDouble;
    if (!inDouble && c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') continue; // descarta a vírgula
    }
    out += c;
  }
  s = out;

  // Chaves não-aspadas → aspadas ({os_id: 1} → {"os_id": 1}).
  return s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3');
}

/**
 * Normalizador "saturno-quirky": cobre os males históricos do JSON do
 * Saturno sem cookies:
 * - prefixos anti-hijack tipo `)]}',` / `while(1);`
 * - lixo textual (logs, BOM) antes do corpo
 * - aspas simples → duplas (preservando aspas literais escapadas)
 * - vírgulas soltas antes de } ou ]
 * - chaves sem aspas
 */
export function normalizeQuirkyJson(input: string): string {
  let s = String(input);

  // 1) Prefixos anti-hijack conhecidos (com/sem espaço após a vírgula).
  s = s.replace(/^\s*(?:\)\]\}'|while\s*\(\s*1\s*\)\s*;\s*)+/, '');

  // 2) Se não começa com corpo JSON, recorta pro primeiro '{' (payload de
  //    OS é objeto) ou, na falta, pro primeiro '['.
  const t = s.trimStart();
  if (t && !t.startsWith('{') && !t.startsWith('[')) {
    const iObj = t.indexOf('{');
    const iArr = t.indexOf('[');
    const cut =
      iObj !== -1 && (iArr === -1 || iObj < iArr)
        ? iObj
        : iArr;
    if (cut > 0) s = t.slice(cut);
  }

  return fixQuirkyChars(s);
}

/** Parse tolerante: tenta JSON direto; se falhar e modo quirky, normaliza. */
export function parseSaturnoPayload(
  text: string,
  mode: SaturnoResponseMode,
): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* segue pro normalizador */
  }
  if (mode !== 'saturno-quirky') {
    throw new SaturnoError('unparseable', 'Resposta do Saturno não é JSON válido');
  }

  // Candidatos: texto inteiro / a partir do 1º '{' / a partir do 1º '['.
  // Cobre tanto "log antes de objeto" quanto "lixo com [ antes de array".
  const base = text.replace(
    /^\s*(?:\)\]\}'|while\s*\(\s*1\s*\)\s*;\s*)+/,
    '',
  );
  const candidates = [base];
  const iObj = base.indexOf('{');
  if (iObj > 0) candidates.push(base.slice(iObj));
  const iArr = base.indexOf('[');
  if (iArr > 0) candidates.push(base.slice(iArr));

  let lastErr: Error | null = null;
  for (const cand of candidates) {
    try {
      return JSON.parse(fixQuirkyChars(cand));
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw new SaturnoError(
    'unparseable',
    `Falhou mesmo após normalização quirky: ${lastErr?.message ?? 'desconhecido'}`,
  );
}

interface RawOsLike {
  [k: string]: unknown;
}

export function mapSaturnoRecord(raw: unknown): SaturnoOsRecord {
  if (typeof raw !== 'object' || raw === null) {
    throw new SaturnoError('unparseable', 'Registro OS não é um objeto');
  }
  const obj = raw as RawOsLike;

  // Payload pode vir aninhado ({data: {...}} / {os: {...}}).
  let target: RawOsLike = obj;
  for (const wrapper of ['data', 'os', 'result', 'results']) {
    const inner = obj[wrapper];
    if (
      inner &&
      typeof inner === 'object' &&
      !Array.isArray(inner) &&
      Object.keys(inner).length > 0
    ) {
      target = inner as RawOsLike;
      break;
    }
  }

  const osId =
    extractOsNumber(pickField(target, 'osId')) ??
    extractOsNumber((target as { id?: unknown }).id);

  const record: SaturnoOsRecord = {
    osId: osId ?? '',
    rawJson: raw,
  };
  const prof = pickField(target, 'professor');
  if (prof !== undefined) record.professor = String(prof).trim();
  const op = pickField(target, 'operador');
  if (op !== undefined) record.operador = String(op).trim();
  const dataIso = toIsoDateLoose(pickField(target, 'data'));
  if (dataIso !== undefined) record.data = dataIso;
  const est = pickField(target, 'estudio');
  if (est !== undefined) record.estudio = String(est).trim();
  for (const f of ['tipo', 'kit', 'mic', 'evento', 'fundo', 'streaming', 'uniforme'] as const) {
    const v = pickField(target, f);
    if (v !== undefined) record[f] = String(v).trim();
  }
  const path = pickField(target, 'alfredPath');
  if (path !== undefined) record.alfredPath = String(path).replace(/[\\/]+$/, '');

  if (!record.osId) {
    throw new SaturnoError('unparseable', 'OS sem número identificável no payload');
  }
  return record;
}

/** Serializa config pra persistência SEM expor a chave (privacidade). */
export function sanitizeConfigForLog(cfg: SaturnoSourceConfig): Record<string, unknown> {
  return {
    ...cfg,
    apiKey: cfg.apiKey ? `<set:${cfg.apiKey.length} chars>` : '<unset>',
  };
}

export class SaturnoConnector {
  private cfg: SaturnoSourceConfig;

  constructor(cfg: Partial<SaturnoSourceConfig> = {}) {
    this.cfg = { ...DEFAULT_SATURNO_CONFIG, ...cfg };
  }

  getConfig(): SaturnoSourceConfig {
    return this.cfg;
  }

  updateConfig(patch: Partial<SaturnoSourceConfig>): void {
    this.cfg = { ...this.cfg, ...patch };
  }

  buildUrl(osId: string | number): string {
    const { baseUrl, endpointTemplate } = this.cfg;
    if (!baseUrl) throw new SaturnoError('config-invalid', 'baseUrl ausente');
    if (!OS_ID_RE.test(endpointTemplate)) {
      throw new SaturnoError(
        'config-invalid',
        "endpointTemplate sem marcador {os_id}",
      );
    }
    const base = baseUrl.replace(/\/+$/, '');
    const path = endpointTemplate.replace(OS_ID_RE, encodeURIComponent(String(osId)));
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private buildHeaders(): HeadersInit {
    const h: Record<string, string> = { Accept: 'application/json' };
    const name = this.cfg.headerName || 'X-API-Key';
    const scheme =
      name === 'Authorization' && this.cfg.authScheme
        ? `${this.cfg.authScheme.replace(/\s+$/, '')} `
        : '';
    h[name] = `${scheme}${this.cfg.apiKey}`;
    return h;
  }

  /** Busca + parse de UMA OS. Nunca lança em rede caída — devolve erro tipado. */
  async fetchOs(osId: string | number): Promise<SaturnoOsRecord> {
    if (!this.cfg.enabled) {
      throw new SaturnoError('disabled', 'Fonte Saturno desabilitada');
    }
    if (!this.cfg.apiKey) {
      throw new SaturnoError('config-invalid', 'apiKey ausente');
    }
    const url = this.buildUrl(osId);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(1000, this.cfg.timeoutMs));
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new SaturnoError('http', `HTTP ${res.status} de ${url}`, res.status);
      }
      const text = await res.text();
      const payload = parseSaturnoPayload(text, this.cfg.responseMode);
      return mapSaturnoRecord(payload);
    } catch (err) {
      if (err instanceof SaturnoError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new SaturnoError('timeout', `Timeout após ${this.cfg.timeoutMs}ms`);
      }
      throw new SaturnoError('network', `Falha de rede: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fallback estrutural: modo Planilha puro. O conector não é consultado;
   * existe pra deixar explícito na UI que a fonte ativa é a planilha.
   */
  static planilhaFallbackReason(cfg: SaturnoSourceConfig): string | null {
    if (cfg.enabled) return null;
    return 'Saturno desabilitado — OSs vindas da Planilha (modo manual)';
  }
}
