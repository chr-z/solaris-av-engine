/**
 * remoteModeFlag.ts — P3: opinião de modo vindA do ambiente de execução.
 *
 * Duas fontes de flag STANDALONE_MODE em RUNTIME (sem rebuild):
 *
 * 1. Core Tauri (`get_runtime_config_command`): env `STANDALONE_MODE` >
 *    `%APPDATA%/dev.chr-z.solaris/config.local.json`. Só existe dentro do
 *    exe; em exe antigo (comando ausente) ou na web pura resolve sem opinião.
 *
 * 2. Config same-origin do deploy (`solaris.config.json` ao lado do
 *    index.html): o caso on-premise WEB — operações editam/derrubam o
 *    arquivo na pasta servida e recarregam o app. Ausente/malformado ⇒ sem
 *    opinião. Consulta com timeout curto: arquivo que não responde nunca
 *    segura o boot do app.
 *
 * A APLICAÇÃO fica em runtimeMode.applyRemoteModeOpinion com a guarda
 * anti-rebaixamento (opinionToApply): opinião cloud só vale quando nenhum
 * sinal local já indica standalone — num artefato que nasceu sem nuvem os
 * SDKs de nuvem nem existem no bundle, então "desligar o modo" seria
 * mentira pro usuário.
 */

export interface ModeOpinion {
  /** `null` = sem opinião; `true` = standalone; `false` = cloud. */
  standalone: boolean | null;
  /** Origem legível da opinião (diagnóstico/badge de suporte). */
  origin: string | null;
}

/** Opinião nula compartilhada — toda falha converge pra cá. */
export function noOpinion(origin: string | null = null): ModeOpinion {
  return { standalone: null, origin };
}

/** Timeout padrão das consultas (ms): boot não pode ficar refém delas. */
export const OPINION_TIMEOUT_MS = 1500;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

interface TauriInternalsShape {
  invoke?: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
}

function getInvoke(): ((cmd: string, args?: unknown) => Promise<unknown>) | null {
  try {
    if (typeof window === 'undefined') return null;
    const internals = (
      window as unknown as { __TAURI_INTERNALS__?: TauriInternalsShape }
    ).__TAURI_INTERNALS__;
    if (internals && typeof internals.invoke === 'function') {
      return (cmd, args) => internals.invoke!(cmd, args);
    }
  } catch {
    /* runtime sem Tauri — segue null */
  }
  return null;
}

/** Normaliza o payload do comando Rust (camelCase por contrato serde). */
export function normalizeCommandPayload(res: unknown): ModeOpinion {
  if (!res || typeof res !== 'object') return noOpinion();
  const r = res as { standalone?: unknown; source?: unknown };
  const standalone = typeof r.standalone === 'boolean' ? r.standalone : null;
  if (standalone === null) return noOpinion();
  const source =
    r.source === 'env' || r.source === 'file'
      ? `${r.source} (core)`
      : 'core';
  return { standalone, origin: source };
}

/**
 * Fonte 1: comando do core Tauri. Nunca rejeita — qualquer falha resolve
 * "sem opinião" (best-effort por contrato).
 */
export function fetchCoreModeOpinion(timeoutMs = OPINION_TIMEOUT_MS): Promise<ModeOpinion> {
  const invoke = getInvoke();
  if (!invoke) return Promise.resolve(noOpinion());
  const call = invoke('get_runtime_config_command')
    .then(normalizeCommandPayload)
    .catch(() => noOpinion());
  return withTimeout(call, timeoutMs, noOpinion());
}

/** Interpreta o corpo bruto do solaris.config.json do deploy. */
export function normalizeDeployConfigBody(body: unknown): ModeOpinion {
  if (!body || typeof body !== 'object') return noOpinion();
  const b = body as { standaloneMode?: unknown };
  if (typeof b.standaloneMode !== 'boolean') return noOpinion();
  return { standalone: b.standaloneMode, origin: 'deploy config.local' };
}

/**
 * Fonte 2: `solaris.config.json` same-origin (deploy on-premise web).
 * 404/arquivo travado/JSON ruim ⇒ sem opinião, sem erro pro console de crash.
 */
export async function fetchDeployModeOpinion(): Promise<ModeOpinion> {
  try {
    if (typeof document === 'undefined') return noOpinion();
    const url = new URL('solaris.config.json', document.baseURI);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) return noOpinion();
    const body: unknown = await res.json();
    return normalizeDeployConfigBody(body);
  } catch {
    return noOpinion();
  }
}

// Re-export com timeout aplicado (assinatura estável p/ runtimeMode).
export function guardedFetchDeployModeOpinion(
  timeoutMs = OPINION_TIMEOUT_MS,
): Promise<ModeOpinion> {
  const call = fetchDeployModeOpinion();
  return withTimeout(call, timeoutMs, noOpinion());
}

/**
 * Guarda anti-rebaixamento: qual decisão tomar dado o estado local?
 *
 * @param opinion           opinião efetiva do ambiente (pode ser nula).
 * @param localIsStandalone o modo JÁ indicado por sinais locais (build flag,
 *        runtime Tauri). Override manual do usuário nem chega aqui — ele tem
 *        precedência máxima e bloqueia a aplicação antes disso.
 * @returns `true` (força standalone), `false` (força cloud — só possível
 *          quando o local NÃO já é standalone) ou `null` (não se aplica).
 */
export function opinionToApply(
  opinion: ModeOpinion,
  localIsStandalone: boolean,
): boolean | null {
  if (opinion.standalone === true) return true;
  if (opinion.standalone === false && !localIsStandalone) return false;
  return null;
}
