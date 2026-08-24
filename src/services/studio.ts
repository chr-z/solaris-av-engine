/**
 * Normalização de nomes de pasta/estúdio compartilhada entre camadas.
 * "SEDE 11" == "SEDE-11" == "sede_11" == "sede11" (lower, sem separadores).
 */
export function normalizeStudioName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_.\s/\\]+/g, '');
}
