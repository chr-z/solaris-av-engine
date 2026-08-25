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

### 2026-08-25 (noite) — tick turbo-web: lazy A/B compare + Lighthouse ANTES/DEPOIS

Code splitting fechado: ComparePane (modo A/B) era eager dentro do
AnalysisWorkspace; agora e React.lazy + Suspense (fallback inline) — chunk
proprio baixa so ao ativar o modo compare.

| chunk | antes raw/gz | depois raw/gz |
|---|---|---|
| ComparePane.js | (dentro do workspace) | 3,55 KB / 1,36 KB gz |
| AnalysisWorkspace.js | 70,30 KB / 20,11 KB | 67,47 KB / 19,68 KB |
| initial total | ~293 KB / ~86 KB gz | ~293 KB / ~86 KB gz (inalterado, como esperado) |

Lighthouse 13.4.1 local (preview estatico em porta aleatoria alta, hash do
entry conferido, headless novo sem GPU, mobile default):

| categoria | ANTES | DEPOIS |
|---|---|---|
| Performance | 95 | 95 |
| Accessibility | 100 | 100 |
| Best Practices | 96 | 96 |

Metricas: FCP 1,7->1,4 s, Speed Index 1,7->1,4 s, LCP 2,9 s estavel,
TBT 0 ms, CLS 0. Axe-core re-validado na build nova: login 0 violacoes,
app principal 0 violacoes (fallback do Suspense passa em contraste).

Suite: vitest 29 arquivos / 332 passed, tsc --noEmit limpo, build ok.
Fila do turbo-web: itens 1-6 todos executados (1/3/4 em ticks 24-25/08,
2 e 6 neste tick).

### 2026-08-25 (noite) — tick turbo-web #2: modo offline/demo + Lighthouse 95/100/96 -> 100/100/100

Fila 1-6 já estava completa; este tick atacou os pontos perdidos que
restavam nos audits (unminified/unused JS + errors-in-console).

Causa raiz: builds sem env Firebase (demo/local) bootavam o compat SDK
igualmente -> `FIREBASE FATAL ERROR` no console de TODO visitante demo;
e a index.html puxava gapi + GSI (~100 KB, 80 KiB apontados como unused
pelo LH) mesmo sem uso.

Mudanças:
- `config/firebase.ts`: gate `isFirebaseConfigured()` (projectId &&
  databaseURL); `loadFirebase()` rejeita rápido SEM baixar o SDK.
- `index.html`: scripts do Google removidos do HTML estático; agora são
  injetados on-demand em `pollForApis()` só quando há config.
- Assinantes DB silenciados sem config: locks (AnalysisSheet),
  timestamps (Workspace + TimestampDock), presence (OnlineUsers +
  App), bugReports (Viewer), adminRole (`useAdminRole.resolve()` —
  era o fire-and-forget sem catch que estourava exceção não capturada).
- LoginScreen: aviso i18n "Modo demo: build local sem serviços em nuvem".
- Logout guest-safe sem config.

| Lighthouse | antes | depois |
|---|---|---|
| Performance | 95 | **100** |
| Accessibility | 100 | 100 |
| Best Practices | 96 | **100** |
| FCP / LCP | 1,7 s / 2,9 s | **1,4 s / 1,5 s** |
| TBT / CLS | 0 ms / 0 | 0 ms / 0 |
| Console errors (LH) | 2 | **0** |

Bundle initial inalterado (~86 KB gz; firebase chunk continua lazy e fora
do caminho crítico). Axe-core re-validado na build nova: 0 violações
(scanner adaptado para build demo, que não tem login screen).
Console-probe CDP próprio: 0 eventos de erro/warning/exceção.

Suite: vitest 30 arquivos / 335 passed (+3 firebaseConfig), tsc limpo,
test:e2e 21/21. Commits 9b274e2 + 56df76c na turbo/web-opt.
Nota: redeploy Vercel da web herda os ganhos no próximo push para main.

### 2026-08-25 (noite) — tick turbo-web #4: ilha LiveMonitors isola o loop de 15 Hz

Fila 1-6 já DONE; auditoria do tick achou o último ponto quente de runtime:
`useAVAnalysis` fazia setState a ~15 Hz DENTRO do AnalysisWorkspace durante
todo o playback — cada tick re-renderizava a árvore inteira de 1036 linhas
(sheet form, filtros, header, shortcuts) só para atualizar 4 canvases.

Mudança: novo `src/components/Analysis/LiveMonitors.tsx` — ilha memoizada que
vira DONA do estado de análise (hook + 4 docks RGB Parade/Waveform/
Spectrogram/VU Meter + modal de zoom). Workspace passa a receber só
`<LiveMonitors videoRef videoSrc/>`; videoRef continua compartilhado com o
VideoPlayer. Modal de zoom migrou para `createPortal(document.body)`.

| métrica | antes | depois |
|---|---|---|
| re-renders por tick de playback | workspace inteiro (~1036 linhas + filhos) | só a ilha (4 docks) |
| AnalysisWorkspace.js | 68,8 KB raw | 67,7 KB raw (-1,1 KB) |
| initial gz | 86 KB | 86 KB (inalterado) |
| Lighthouse P/A/BP | 100/100/100 | **100/100/100** |
| FCP / LCP / TBT / CLS | 1,4 s / 1,5 s / 0 ms / 0 | idem |
| axe-core | 0 violações | **0 violações** |
| console (probe CDP + LH) | 0 eventos | **0 eventos** |

Suite: vitest 31 arquivos / 342 passed, tsc --noEmit limpo, test:e2e 21/21.
Commit d67c66f em origin/turbo/web-opt.

Incidente operacional (protocolo de porta validado funcionou): axe-scan da
primeira tentativa falhou SAFE — hash servido ≠ dist local; um órfão de
preview deste projeto (tick anterior, porta fixa baixa) respondia com build
velha. Listados todos os `vite preview` via Win32_Process, matados SOMENTE os
do solaris-web-turbo (3 grupos, portas 4214/4482/4371), re-scan em porta
aleatória alta passou com hash conferido. Scripts auxiliares:
scripts/list_preview_orphans.ps1 e kill_turbo_orphans.ps1.

### 2026-08-25 (madrugada) — tick turbo-web #5: re-auditoria ponta a ponta (fila 1–6 já DONE)

Fila da noite (bundle, code splitting, runtime, e2e, axe, lighthouse)
confirmada 100% implementada nos ticks #1–#4. Este tick foi prova de
não-regressão na HEAD (ac7ce76) com números frescos:

| verificação | resultado |
|---|---|
| build (vite) | determinística — hashes idênticos em 2 builds seguidas |
| initial gz (index+react-vendor+css) | **86,9 KB** (alvo <500KB: 6× folga) |
| chunks | index 33,63 + react-vendor 45,44 + firebase 97,35 gz; firebase/ComparePane/BugReport* lazy |
| vitest / tsc / test:e2e | 31 arq · **342 passed** / limpo / **21/21** |
| axe-core (build servida, hash conferido) | **0 violações** (login n/a demo, app principal 0) |
| console-probe CDP | **0 eventos** de erro/warning/exceção |
| Lighthouse P/A/BP/SEO | **100 / 100 / 100 / 100** — FCP 1,4s · LCP 1,5s · TBT 0ms · CLS 0 · SI 1,9s |

Fluxo E2E mandado coberto em scripts/e2e-flow.mjs (load→YouTube URL→análise
mockada→export QC via funções puras + esbuild). Sem gaps novos: nenhum
componente pesado fora de lazy, nenhum setState quente fora da ilha
LiveMonitors, lista de 1036 linhas já memoizada com render único.
Commit desta entrada em origin/turbo/web-opt.


---

## turbo-web (tick #6) — higiene: upstream da branch + orfaos de preview — 25/08/2026 ~09h40

- Fila 1-6 do turbo-web segue DONE (ticks #1-#5); este tick NAO re-auditou nada,
  so fechou dividas de infraestrutura do worker.
- Upstream corrigido: branch turbo/web-opt apontava origin/main (lia "ahead 14"
  como trabalho nao-pushado, risco de outro worker descartar a lane). A branch
  remota EXISTE em 4183037 = HEAD local; ls-remote provou; --set-upstream-to=
  origin/turbo/web-opt aplicado. Estado real: em dia com o remoto.
- axe-report.json revertido: diff era so timestamp de re-run (11:14->11:55Z),
  zero mudanca de conteudo.
- Orfaos vite preview mortos: 4 no total — dir principal solaris-av-engine
  ports 4199 (22h vazando) e 4173 (20.4h) + deste worktree ports 4297 e 4207.
  Lane redesign intocada (worker vivo la as 09:35:33, spawnou redesign_axe_t9).
  kill_turbo_orphans.ps1 reescrito: auto-descoberta por cmdline com filtro de
  idade (-MaxAgeHours 3), skip duro da lane redesign, skip de processos frescos;
  fim dos PIDs hardcoded. Protocolo de prova anti-auto-deteccao mantido:
  processos da propria checagem se listam (bash/powershell criados no mesmo
  segundo) — filtrar por CreationDate antes de concluir "restou algo".

---

## turbo-web (tick #7) — re-auditoria pos-P16/P17 + divida do tooling — 25/08/2026 ~10h20

- Fila 1-6 segue DONE. Mudanca de estado desde o tick #5: main avancou com
  P16 (heatmap/XLSX twin) e P17 (category filter chips). rev-list provou
  turbo/web-opt = origin/main +15 commits proprios, 0 atras — NADA a
  sincronizar; as features novas ja nascem dentro da lane turbo.
- Re-auditoria fresca na HEAD nova (25b66d3):
  | gate | resultado |
  |---|---|
  | build vite | deterministica; initial gz 86,7KB (index 33,63 + react-vendor 45,44 + css 7,60); alvo <500KB: 5,8x folga |
  | chunks lazy | firebase 472,58 raw/97,35 gz (on-demand), AdminGate 74,11, AnalysisWorkspace 67,70, sheetSync 33,53, ComparePane/BugReport* ~1-2 gz cada |
  | vazamento de deps pesadas no cliente (googleapis/firebase-admin/ffmpeg/xlsx/lodash/moment) | ZERO imports em src/ |
  | vitest / tsc / e2e | 31 arq · 342/342 · limpo · 21/21 |
- Unica divida achada pelo tooling: caniuse-lite com 8 meses. Fixada neste
  tick (commit 25b66d3): build byte-identica apos update, warning fora,
  gates re-provados na arvore final.
- Sem Telegram, sem toque em src-tauri (lane desktop intacta).

### 2026-08-25 (madrugada) — tick turbo-web pós-merge #8 (worktree no main)
Lane turbo-web absorvida pelo main @ 30b4b7b (merge ticks #1-#7). Worktree solaris-web-turbo movido para main, pull ff-only ok, árvore limpa. Gates reprovados na árvore final mesclada: build determinística, initial gz 86,7 KB (index 33,67 + react-vendor 45,44 + css 7,60) <500KB alvo; chunks lazy idem (firebase 97,35, AdminGate 18,93, AnalysisWorkspace 19,68 gz); vitest/tsc limpar; E2E 21/21; axe 0; Lighthouse 100/100/100 (FCP 1,4/LCP 1,5/TBT 0/CLS 0). src-tauri intocado. Sem Telegram.

## turbo-web tick #9 — push do main + gates re-provados na árvore final — 25/08/2026 ~13h45

- Estado encontrado: fila turbo-web 100% DONE e mergeada no main local
  (30b4b7b), mas o push tinha ficado preso: main local = origin/main + 2
  commits (30b4b7b merge + eb90c8f lint-ratchet) que só existiam localmente.
- Este tick fechou a dívida de publicação + re-provou todos os gates na árvore
  mesclada final (solaris-web-turbo @ main):
  - build vite: initial gz 86,71 KB (index 33,67 + react-vendor 45,44 +
    css 7,60) — alvo <500KB mantido com folga (5,8x); chunks lazy idem:
    firebase 97,35 / AdminGate 18,93 / AnalysisWorkspace 19,71 /
    sheetSync 11,18 / ComparePane+BugReport* ~1-2 gz cada.
  - tsc --noEmit limpo; vitest 31 arquivos · 342/342 verdes;
  - E2E fluxo real (scripts/e2e-flow.mjs): 21/21 asserts ok;
  - axe-core na build servida (vite preview + headless Chrome --disable-gpu):
    0 violações login, 0 no app principal (criticalOrSerious=0);
  - console probe CDP: 0 erros / 0 warnings / 0 exceções (build offline entra
    direto no app demo, sem botão visitante);
  - Lighthouse 13.4.1 (--headless=new --disable-gpu): 100 performance ·
    100 accessibility · 100 best-practices · 100 seo — FCP 1,4s · LCP 1,5s ·
    TBT 0ms · CLS 0 · SI 1,8s.
- Push origin/main efetuado (ff 30b4b7b), verificado por ls-remote.
- src-tauri intocado (lane desktop é de outro worker). Sem Telegram.
