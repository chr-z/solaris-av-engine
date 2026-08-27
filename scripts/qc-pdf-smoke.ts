// Smoke one-off (untracked por política): prova ponta a ponta do F6/D pdfmake
// — gera o relatório QC REAL (locale pt, modo filtrado) e valida o binário.
import { writeFileSync } from 'node:fs';
import { generateQCReport } from '../src/utils/qcReport';
import {
  exportQCReportPdf,
  suggestedQCFileName,
} from '../src/utils/qcPdf';

const report = generateQCReport('pt', { filtered: true });
const blob = await exportQCReportPdf(report);
const buf = Buffer.from(await blob.arrayBuffer());
const head = buf.subarray(0, 5).toString('ascii');
const tail = buf.subarray(Math.max(0, buf.length - 32)).toString('latin1');
const out = process.env.SMOKE_OUT || 'qc-report-smoke.pdf';
writeFileSync(out, buf);
const result = {
  bytes: buf.length,
  headerOk: head === '%PDF-',
  eofOk: tail.includes('%%EOF'),
  pagesHint: (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length,
  hasRobotoSubset: buf.toString('latin1').includes('Roboto'),
  fileName: suggestedQCFileName(report),
  title: report.title,
  locale: report.locale,
};
console.log(`QCPDF_SMOKE ${JSON.stringify(result)}`);
if (!result.headerOk || !result.eofOk || result.bytes < 2000) {
  console.error('QCPDF_SMOKE_FAIL');
  process.exit(1);
}
