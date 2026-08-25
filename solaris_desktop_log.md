# SOLARIS — log de trabalho

## turbo-web

### 2026-08-24 — tick 1: auditoria de bundle (baseline)

Branch `turbo/web-opt` @ 729dd9b (v2-upgrade + lazy firebase + perf runtime já aplicados).

Build de produção (`npm run build`, vite 4.5.14, 130 módulos):

| chunk | raw | gzip |
|---|---|---|
| index.js (entry) | 111.5 KB | **33.2 KB** |
| react-vendor.js | 141.8 KB | **45.4 KB** |
| index.css | 40.2 KB | **7.6 KB** |
| **initial total** | ~293 KB | **~86 KB gz** |
| AnalysisWorkspace.js (lazy) | 70.2 KB | 20.1 KB |
| AdminGate.js (lazy) | 74.1 KB | 18.9 KB |
| sheetSync.js (lazy) | 33.5 KB | 11.2 KB |
| BugReportModal/Viewer (lazy) | 7.7 KB | 3.2 KB |
| firebase.js (lazy) | 472.6 KB | 97.4 KB |

- Alvo initial < 500 KB gz: **cumprido com folga (~86 KB)**.
- Firebase compat SDK (maior chunk) já é lazy — não carrega no initial.
- Code splitting React.lazy+Suspense (AnalysisWorkspace, AdminGate) e vendor chunks
  (react/firebase via src/utils/chunking.ts testado) já presentes de ticks anteriores.
- Testes: 29 arquivos / 332 passed antes do commit.

Próximos ticks candidatos: runtime perf em Monitors (memo), axe-core scan,
Lighthouse CI baseline ANTES/DEPOIS.

### 2026-08-24 — tick 3: E2E do fluxo real (fallback node puro)

Playwright não instalado ⇒ fallback da fila: script node + esbuild (mesma
versão do lockfile) compilando as funções puras TS on-the-fly.
`scripts/e2e-flow.mjs` (`npm run test:e2e`), 21 asserts cobrindo o fluxo real:

1. colar URL YouTube → `getVideoIdFromUrl` (watch/youtu.be/embed/sem protocolo/nulos)
2. análise mockada → `recalculateScoresWithEngine`: linha limpa = 5,00; 2 marcações
   reais do seed (Audio Clipping, Focus Hunting) derrubam a nota, penalidades nas
   categorias certas, zero órfãs; `applyScoreUpdates` persiste FINAL na linha
3. fila → `computeFilteredRows`: pendente/concluída/especial + filtro por estúdio + busca guest
4. export QC → `generateQCReport('pt')` localizado + blob HTML com título/métricas

Resultado: **E2E_FLOW OK — 21/21 asserts**; suíte vitest 29 arquivos / 332 passed
intacta. Zero dependência nova. Próximo tick: a11y pass (axe-core) ou Lighthouse baseline.
