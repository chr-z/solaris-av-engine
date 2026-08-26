// Solaris v3 — Feature Pack "Analista Feliz" — C4/E: exportação de pódio
// com opt-in EXPLÍCITO.
//
// Guardrail da spec C4/E: "Dados do pódio NÃO vão pra planilha/dashboards
// externos do Gran sem opt-in". Até este tick isso era garantido por OMISSÃO
// (nenhum caminho de exportação tocava em dados de pódio). Aqui a regra vira
// POSITIVA: existe um único caminho de exportação e ele exige a bandeira de
// consentimento ligada NA HORA da chamada — sem flag não há bytes, nem CSV,
// nem XLSX. A UI (LeaguePanel) é a única porta; quem chama por fora esbarra
// no mesmo gate porque as funções recusam sem optIn.
//
// PURA: nada de DOM/storage aqui — o chamador injeta timestamp p/ ZIP
// determinístico e decide como persistir os bytes.

import {
  buildSingleSheetXlsx,
  escapeXmlText,
  columnIndexToLetter,
} from '../../utils/dashboardXlsx';

/** Linha de ranking congelada ou ao vivo (mesma forma do podium_history). */
export interface PodiumExportRow {
  userId: string;
  name: string;
  rank: number;
  xp: number;
  /** Eventos de retrabalho no período (desempate da spec C2). */
  reworkCount: number;
}

export type PodiumPeriodType = 'week' | 'month' | 'year';

/** Um pódio completo: rótulo do período + linhas já ranqueadas. */
export interface PodiumExportInput {
  periodType: PodiumPeriodType;
  /** Chave canônica ('2026-W34', '2026-08', '2026'…). */
  periodKey: string;
  rows: readonly PodiumExportRow[];
}

const PERIOD_LABELS: Record<PodiumPeriodType, { en: string; pt: string }> = {
  week: { en: 'Week', pt: 'Semana' },
  month: { en: 'Month', pt: 'Mês' },
  year: { en: 'Year', pt: 'Ano' },
};

/**
 * O gate. Opt-in é um valor, não um comentário: tem que ser `true` de verdade.
 * Chamadas sem a bandeira devolvem null — é assim que "sem opt-in" se prova
 * em teste.
 */
export function buildPodiumCsv(
  input: PodiumExportInput,
  opts: { locale?: 'en' | 'pt'; optIn: boolean },
): string | null {
  if (opts.optIn !== true) return null;
  const locale = opts.locale ?? 'en';
  const periodLabel = PERIOD_LABELS[input.periodType][locale];

  const header = [
    'rank',
    'analyst',
    'user_id',
    'xp',
    'rework_count',
    'period',
    'period_key',
  ];
  const lines = [header.join(',')];
  for (const row of input.rows) {
    lines.push(
      [
        String(row.rank),
        escapeCsvField(row.name),
        escapeCsvField(row.userId),
        String(row.xp),
        String(row.reworkCount),
        escapeCsvField(periodLabel),
        escapeCsvField(input.periodKey),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}

function escapeCsvField(value: string): string {
  const text = value ?? '';
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Mesmas colunas/ordem do CSV — uma fonte de verdade por formato de linha.
 * Números viram células numéricas de verdade; resto, inline strings.
 */
const PODIUM_XLSX_COLUMNS: Array<{
  header: string;
  pick: (row: PodiumExportRow, input: PodiumExportInput, periodLabel: string) => string | null;
}> = [
  { header: 'rank', pick: (r) => String(r.rank) },
  { header: 'analyst', pick: (r) => r.name },
  { header: 'user_id', pick: (r) => r.userId },
  { header: 'xp', pick: (r) => String(r.xp) },
  { header: 'rework_count', pick: (r) => String(r.reworkCount) },
  {
    header: 'period',
    pick: (_r, _input, periodLabel) => periodLabel,
  },
  { header: 'period_key', pick: (_r, input) => input.periodKey },
];

function cellXml(ref: string, value: string | null): string {
  if (value === null || value === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`;
}

function buildPodiumSheetXml(
  input: PodiumExportInput,
  locale: 'en' | 'pt',
): string {
  const periodLabel = PERIOD_LABELS[input.periodType][locale];
  const rows: string[] = [];
  const headerCells = PODIUM_XLSX_COLUMNS.map((c, i) =>
    `<c r="${columnIndexToLetter(i)}1" t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(c.header)}</t></is></c>`,
  ).join('');
  rows.push(`<row r="1">${headerCells}</row>`);

  input.rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const cells = PODIUM_XLSX_COLUMNS.map((col, i) =>
      cellXml(`${columnIndexToLetter(i)}${rowNumber}`, col.pick(row, input, periodLabel)),
    )
      .filter(Boolean)
      .join('');
    rows.push(`<row r="${rowNumber}">${cells}</row>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`
  );
}

/**
 * XLSX de UM pódio ('Podium' sheet), mesmo pacote OOXML dos demais exports.
 * Sem opt-in → null (nem bytes são montados).
 */
export function buildPodiumXlsx(
  input: PodiumExportInput,
  opts: { locale?: 'en' | 'pt'; optIn: boolean; now?: Date },
): Uint8Array | null {
  if (opts.optIn !== true) return null;
  return buildSingleSheetXlsx(
    'Podium',
    buildPodiumSheetXml(input, opts.locale ?? 'en'),
    opts.now ?? new Date(),
  );
}

/**
 * Nomes de arquivo estáveis: solaris-podium_<type>_<key>.<ext>
 * (ex.: solaris-podium_month_2026-08.xlsx). Determinísticos p/ testes e
 * para downloads CSV/XLSX gêmeos compartilharem o radical.
 */
export function podiumExportFilename(
  input: Pick<PodiumExportInput, 'periodType' | 'periodKey'>,
  ext: 'csv' | 'xlsx',
): string {
  return `solaris-podium_${input.periodType}_${input.periodKey}.${ext}`;
}
