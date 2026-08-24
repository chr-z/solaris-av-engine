/**
 * SourcesStore — persistência local da configuração das fontes (Admin → Fontes).
 *
 * Desktop on-premise: localStorage já vive dentro da máquina do cliente;
 * nada sai da rede. A API key do Saturno é guardada aqui (não em telemetria,
 * não em logs — ver sanitizeConfigForLog) até migrarmos pra cofre do Tauri.
 */
import {
  DEFAULT_SATURNO_CONFIG,
  SaturnoSourceConfig,
  SaturnoResponseMode,
} from '../services/saturno';

export interface AlfredSourceConfig {
  /** RAIZ_ALFRED configurável; ex.: D:\Alfred\Producao */
  root: string;
  maxDepth: number;
  osRegex: string;
}

export interface SheetSourceConfig {
  spreadsheetId: string;
  tabName: string;
}

export interface SourcesConfig {
  saturno: SaturnoSourceConfig;
  alfred: AlfredSourceConfig;
  sheet: SheetSourceConfig;
}

const STORAGE_KEY = 'solaris.sources.v1';

export const DEFAULT_SOURCES_CONFIG: SourcesConfig = {
  saturno: { ...DEFAULT_SATURNO_CONFIG },
  alfred: {
    root: '',
    maxDepth: 6,
    osRegex: 'os[-_ ]?(\\d+)',
  },
  sheet: { spreadsheetId: '', tabName: 'OS' },
};

/** Valida sem lançar: devolve lista de problemas legíveis pro Admin. */
export function validateSourcesConfig(cfg: SourcesConfig): string[] {
  const problems: string[] = [];
  if (cfg.saturno.enabled) {
    if (!cfg.saturno.baseUrl.trim()) {
      problems.push('Saturno: Base URL é obrigatória quando habilitado');
    }
    if (!cfg.saturno.apiKey.trim()) {
      problems.push('Saturno: API Key é obrigatória quando habilitado');
    }
    if (!cfg.saturno.headerName.trim()) {
      problems.push('Saturno: header de autenticação é obrigatório');
    }
    if (!cfg.saturno.endpointTemplate.includes('{os_id}')) {
      problems.push("Saturno: template precisa conter {os_id}");
    }
    if (
      cfg.saturno.responseMode !== 'json' &&
      cfg.saturno.responseMode !== 'saturno-quirky'
    ) {
      problems.push('Saturno: modo de resposta inválido');
    }
    if (!Number.isFinite(cfg.saturno.timeoutMs) || cfg.saturno.timeoutMs < 1000) {
      problems.push('Saturno: timeout deve ser ≥ 1000 ms');
    }
  }
  if (cfg.alfred.maxDepth < 1 || cfg.alfred.maxDepth > 20) {
    problems.push('Alfred: profundidade deve estar entre 1 e 20');
  }
  try {
    new RegExp(cfg.alfred.osRegex);
  } catch {
    problems.push('Alfred: regex de OS inválida');
  }
  return problems;
}

function coerce(raw: Partial<SourcesConfig> | null | undefined): SourcesConfig {
  const merged: SourcesConfig = {
    saturno: { ...DEFAULT_SOURCES_CONFIG.saturno, ...(raw?.saturno ?? {}) },
    alfred: { ...DEFAULT_SOURCES_CONFIG.alfred, ...(raw?.alfred ?? {}) },
    sheet: { ...DEFAULT_SOURCES_CONFIG.sheet, ...(raw?.sheet ?? {}) },
  };
  merged.saturno.responseMode = (
    merged.saturno.responseMode === 'json' ? 'json' : 'saturno-quirky'
  ) as SaturnoResponseMode;
  return merged;
}

export function loadSourcesConfig(): SourcesConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SOURCES_CONFIG };
    return coerce(JSON.parse(raw) as Partial<SourcesConfig>);
  } catch {
    // Config corrompida → volta pro default (fonte Planilha), sem quebrar a UI.
    return { ...DEFAULT_SOURCES_CONFIG };
  }
}

export function saveSourcesConfig(cfg: SourcesConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}
