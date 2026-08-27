// Solaris v3 — Feature Pack "Analista Feliz" — C4/E: preferência de opt-in
// para compartilhamento EXTERNO de dados de pódio.
//
// Guardrail C4/E: "Dados do pódio NÃO vão pra planilha/dashboards externos
// do Gran sem opt-in". Esta chave é esse opt-in: default OFF, só vira ON com
// escrita explícita ('1'), e lixo de storage = OFF (falha fechada).
//
// PURA: storage injetável (mesmo padrão de profileStore/teamGoal).

export const PODIUM_SHARE_OPTIN_KEY = 'solaris.gamification.podiumShareOptIn';

export interface StorageGetSet {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Default OFF. Só '1' exato liga; qualquer outra coisa (ou lixo) desliga. */
export function isPodiumShareAllowed(storage: StorageGetSet | null): boolean {
  try {
    return storage?.getItem(PODIUM_SHARE_OPTIN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Liga/desliga; valor falsy remove a chave (mapa enxuto, sem '0' solto). */
export function setPodiumShareAllowed(
  storage: StorageGetSet | null,
  allowed: boolean,
): void {
  if (!storage) return;
  try {
    if (allowed) storage.setItem(PODIUM_SHARE_OPTIN_KEY, '1');
    else storage.removeItem(PODIUM_SHARE_OPTIN_KEY);
  } catch {
    // storage cheio/bloqueado: pref é best-effort — o gate default continua OFF.
  }
}
