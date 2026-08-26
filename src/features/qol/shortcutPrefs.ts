// Solaris v3 — Feature Pack "Analista Feliz" — QoL A1.
//
// Atalhos configuráveis (spec A1): remapeamento completo de teclado no painel
// do usuário. Núcleo PURO: validação, sanitização e resolução de conflitos;
// persistência é injetada (localStorage no web/Tauri) e o hook React só
// espelha estado + escuta o evento de mudança p/ hot-reload global.
//
// Regras de segurança (honestas, sem pegadinha silenciosa):
//   * Teclas NATIVAS do player (Space/←/→/F/M) são RESERVADAS — o container
//     de vídeo trata elas num listener próprio; um atalho global na mesma
//     tecla dispararia duas ações por pressionamento.
//   * Escape/Tab reservados (fecho de modais/foco acessível).
//   * Conflito recusado com nome do atalho dono da tecla — nunca "último
//     ganha" silencioso.
//   * Mapa persistido é SANITIZADO na leitura: id ou tecla desconhecida
//     (atalho renomeado/removido em versão futura) cai fora sem quebrar.

import {
  ANALYST_SHORTCUTS,
  type ShortcutDef,
} from '../../utils/shortcuts';

/** Mapa id → tecla (`e.key` lowercased), apenas para ids não-nativos. */
export type ShortcutMap = Record<string, string>;

export const SHORTCUT_PREFS_KEY = 'solaris.qol.shortcuts';
/** Evento window disparado após qualquer gravação (hot-reloa das camadas). */
export const SHORTCUTS_CHANGED_EVENT = 'solaris:shortcuts-changed';

const RESERVED_KEYS = new Set([
  ' ', // Space — play/pause nativo do player
  'arrowleft',
  'arrowright',
  'f',
  'm',
  'escape',
  'tab',
]);

function defaultKeyById(): Map<string, string> {
  const map = new Map<string, string>();
  for (const def of ANALYST_SHORTCUTS) {
    if (!def.native) map.set(def.id, def.keys);
  }
  return map;
}

const DEFAULTS = defaultKeyById();

export function isRemappableId(id: string): boolean {
  return DEFAULTS.has(id);
}

/** Nome legível do atalho (descrição i18n resolvida fora; aqui o id cai p/ trás). */
export function defaultKeyFor(id: string): string | null {
  return DEFAULTS.get(id) ?? null;
}

/** Tecla efetiva de um atalho: mapa do usuário ou padrão. */
export function resolveKey(id: string, map: ShortcutMap): string {
  return map[id] ?? DEFAULTS.get(id) ?? '';
}

/**
 * Sanitiza JSON bruto do storage: só ids remapeáveis, teclas single-char
 * válidas, sem reservadas. Retorna mapa vazio em qualquer lixo.
 */
export function sanitizeMap(raw: unknown): ShortcutMap {
  if (raw === null || typeof raw !== 'object') return {};
  const out: ShortcutMap = {};
  for (const [id, key] of Object.entries(raw as Record<string, unknown>)) {
    if (!DEFAULTS.has(id)) continue;
    if (typeof key !== 'string') continue;
    const normalized = key.toLowerCase();
    // Só teclas simples (single-char); combos/reservadas nunca entram.
    if (normalized.length !== 1) continue;
    if (RESERVED_KEYS.has(normalized)) continue;
    out[id] = normalized;
  }
  return out;
}

/** Lê o mapa persistido; storage ausente/corrompido = padrões. */
export function loadShortcutMap(storage: Pick<Storage, 'getItem'> | null): ShortcutMap {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SHORTCUT_PREFS_KEY) ?? null;
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    return sanitizeMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Grava best-effort; dispara o evento de hot-reload quando conseguiu. */
export function saveShortcutMap(
  storage: Pick<Storage, 'setItem'> | null,
  map: ShortcutMap,
  target: Pick<typeof window, 'dispatchEvent'> | null = typeof window !== 'undefined' ? window : null,
): boolean {
  try {
    storage?.setItem(SHORTCUT_PREFS_KEY, JSON.stringify(map));
  } catch {
    return false;
  }
  if (target) {
    try {
      target.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT));
    } catch {
      /* ambiente sem eventos (teste puro): mapa ainda assim foi salvo */
    }
  }
  return true;
}

export type BindingRejection = 'conflict' | 'reserved' | 'invalid';

export interface BindingVerdict {
  ok: boolean;
  reason?: BindingRejection;
  /** Dono atual da tecla (quando reason === 'conflict'). */
  ownerId?: string;
}

/**
 * Valida atribuir `key` ao atalho `id` DADO o mapa atual.
 * Puro — a UI chama antes de gravar e mostra o motivo quando recusa.
 */
export function validateBinding(id: string, key: string, map: ShortcutMap): BindingVerdict {
  if (!isRemappableId(id)) return { ok: false, reason: 'invalid' };
  const normalized = typeof key === 'string' ? key.toLowerCase() : '';
  if (!normalized || normalized.length !== 1 || normalized === 'dead') {
    return { ok: false, reason: 'invalid' };
  }
  if (RESERVED_KEYS.has(normalized)) return { ok: false, reason: 'reserved' };
  const owner = Object.entries(map).find(
    ([otherId, otherKey]) => otherId !== id && otherKey === normalized,
  );
  if (owner) return { ok: false, reason: 'conflict', ownerId: owner[0] };
  // Igual ao padrão → remove do mapa (mapa enxuto = menos superfície de drift).
  if (DEFAULTS.get(id) === normalized) {
    const next = { ...map };
    delete next[id];
    return { ok: true };
  }
  return { ok: true };
}

/**
 * Aplica veredito positivo sobre uma cópia imutável do mapa.
 * Chamar somente depois de validateBinding().ok.
 */
export function commitBinding(map: ShortcutMap, id: string, key: string): ShortcutMap {
  const verdict = validateBinding(id, key, map);
  if (!verdict.ok) return map;
  const normalized = key.toLowerCase();
  if (normalized === DEFAULTS.get(id)) {
    const without = { ...map };
    delete without[id];
    return without;
  }
  return { ...map, [id]: normalized.toLowerCase() };
}

/** Remove um remap individual (volta ao padrão). */
export function clearBinding(map: ShortcutMap, id: string): ShortcutMap {
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

/**
 * Definições EFETIVAS p/ matching: ANALYST_SHORTCUTS com keys/display
 * substituídos pelo mapa do usuário. Nativos intocados (não são remapeáveis).
 * Ordem preservada — help modal agrupa pela mesma lista.
 */
export function applyShortcutMap(map: ShortcutMap, base: readonly ShortcutDef[] = ANALYST_SHORTCUTS): ShortcutDef[] {
  return base.map((def) => {
    const custom = !def.native ? map[def.id] : undefined;
    if (!custom || custom === def.keys) return def;
    return { ...def, keys: custom, display: custom.toUpperCase() };
  });
}

/** Ids não-nativos (universo remapeável), na ordem do catálogo. */
export function remappableShortcuts(base: readonly ShortcutDef[] = ANALYST_SHORTCUTS): ShortcutDef[] {
  return base.filter((def) => !def.native);
}
