
## redesign (tick 10) — R2 remanescente: checklist de inconformidades com kit animado — 25/08/2026 ~10h20

- Auditoria anti-false-done da spec INTEIRA (R1-R4 + momentos wow) antes de
  qualquer commit: tokens/CSS 9.92KB gz, timeline com pins empilháveis,
  ScoreRing SVG, sparkline da tendência, contagem animada, print v3 do relatório,
  favicon kit, empty states ilustrados, erros humanos — tudo DONE nos ticks 1-9.
  Suíte 385/385 verde na base.
- **Gap real achado**: os checkboxes do CHECKLIST de inconformidades
  (AnalysisForm — onde o analista marca, coração do fluxo) ainda usavam o
  estilo cru do MVP (h-4 w-4 border-gray-500 text-solar-accent focus:ring);
  o kit .checkbox-custom animado do R2 só tinha sido aplicado no FilterControls.
- Fix mínimo (1 linha): className -> checkbox-custom. Anatomia, vocabulário e
  comportamento intactos (mesmo input, mesmo onChange, YES/NO e TRUE/FALSE).
- Decisão documentada: migração p/ lucide-react fica FORA — dependência nova
  contra a restrição "zero dependência pesada nova" da spec; kit SVG inline
  atual já é consistente (stroke-2/currentColor/aria-hidden).
- Prova no browser real (scripts/verify_t10_checkbox.cjs, protocolo anti-stale:
  hash do entry servido conferida contra dist local): appearance:none, 16x16px,
  borda hairline rgba(255,255,255,.12), classe antiga ausente, clique dispara
  onChange e gradiente accent 135deg #8F6FF7->#F09A52 computado ao marcar.
  7/7 checks = VERIFY_T10_OK. Screenshots t10_checklist{,_marcado}.png.
- Validação: tsc limpo; vitest 385/385; build verde; CSS gz 9.92KB inalterado.

---

## redesign (tick 6) — R4 polimento final — 25/08/2026 ~06h
- Commits fac4ec3 + 6f1edc3 + 59c30eb + ac7dac8 @ redesign-premium, pushados
  (ls-remote ok, 880f4a0..ac7dac8). Fila R1-R4 da spec agora 100% executada.
- **R4a print**: relatório QC exportado era fragmento HTML cru sem estilo —
  virou documento completo com identidade v3 (gradiente accent no header,
  stats em grid tabular, JetBrains Mono nos dados) + @media print/@page A4
  próprio; escape XSS no título/headers interpolados. CSS morto qc-print.css
  removido (mirava .qc-report-card que não existe na v3). +2 testes (365/365).
- **R4b motion**: duration-300/200 -> 150ms (7+1 ocorrências; VuMeter mantém
  75ms por ser VU meter em tempo real). Reduced-motion global já existente
  provado no CSS built.
- **R4c ícones**: kit v3 completo 16/32/192/512/maskable gerado por
  scripts/gen_icons_v3.py (gradiente 135deg #8F6FF7->#F09A52 espelhando o
  SolarisLogo; antes era laranja #f97316 pré-redesign); favicon svg+png no
  index.html, theme-color/manifest -> #0B0E14, SW cache bump v3-r4.
- **R4d axe/AA**: axe-core scan real (npm i --no-save, sem tocar no manifest
  compartilhado) nas 4 telas via scripts/verify_r4.cjs (protocolo anti-órfão:
  preview próprio + hash do build conferida + interceptação do blob do relatório).
  Antes: 31 violações blocking (color-contrast serious x30, label critical x1).
  Depois: ZERO critical/serious (sobram só moderates 'region'/'heading-order').
- **Achado estrutural** (causa dos docks claros): Tailwind 3 NÃO gera variante
  alpha sobre cor var() hex — dark:bg-solar-dark-content/80 não saía no build
  e o fundo aplicado era o light (#fffc). Fix: tokens ganham gêmeos _rgb +
  <alpha-value> no config; Dock/VuMeter -> bg-surface/90 + hairline.
  Armadilha registrada p/ próximos workers: /NN sobre token hex silencia.
- Varredura AA complementar: gray-500 -> text-ink-secondary (~15 arquivos),
  CTAs accent+branco -> kit btn-primary/text-bg (tinta escura sobre gradiente),
  linha selecionada da fila com texto ink sobre tinta accent, slider de volume
  com aria-label i18n ('workspace.volume' EN/PT).
- Contraste matemático dos pares novos: pior caso AA normal 4.70 (accent-from
  sobre raised); botão primário 5.32-8.69; tema claro também passa.
- Validação: tsc limpo; vitest 365/365; build verde; CSS gz 9.85KB (meta <30KB);
  screenshots redesign_shots/r4_{login,fila,analysis,qc_dialog,qc_report}.png
  + r4_axe_summary.json (números do scan) + r4_qc_report.html (documento real).

---

## redesign (tick 7) — aceite visual MVP vs v3 + consolidacao anti-false-done — 25/08/2026 ~07h

- Fila R1-R4 permanece DONE (ticks 1-6); este tick fechou o unico item que
  faltava na spec (SOLARIS_REDESIGN.md, secao Aceite visual): composites
  side-by-side MVP vs v3 das 4 telas para o dono aprovar.
- Baselines MVP capturados do build REAL da main: worktree de prova
  (%TEMP%/probe-solaris-mvp @ origin/main 5353d1d) + .env.local copiado do
  checkout de redesign — a main exige VITE_FIREBASE_* no build; sem elas o
  boot morre em FIREBASE FATAL ERROR antes do React montar (diagnosticado
  via CDP console). Nenhuma mudanca de codigo na main.
- Protocolo anti-orfa respeitado: porta alta aleatoria por run, localhost
  (nao 127.0.0.1), screenshot so apos conferir hash do entry servido contra
  o dist local (index-D15riw2h.js), chrome headless --disable-gpu, profile
  descartavel, servidores estaticos proprios fechados no finally. Conteudo
  das telas provado por texto (visao auxiliar indisponivel nesta sessao):
  guest login -> fila demo WO-2024-001..115 -> workspace "Demo Video Mode"
  + RGB Parade/Waveform/Spectrogram/VU + Analysis Sheet -> dialogo QC aberto.
- Artefatos para aprovacao do dono em redesign_shots/: aceite_1_login_,
  aceite_2_fila_, aceite_3_analise_ e aceite_4_relatorio_mvp_vs_v3.png
  (3220x880, MVP a esquerda / v3 a direita, moldura accent na v3). Diferenca
  real entre paineis provada por estatistica de pixels (ex.: relatorio =
  documento branco do print stylesheet apenas no lado v3).
- Scripts versionados: scripts/mvp_shot_acceptance.cjs (captura MVP) +
  scripts/compose_aceite.py (composite PIL rotulado).
- Consolidacao anti-false-done @ HEAD 6cc12a5 (= origin/redesign-premium):
  tsc limpo; vitest 365/365 (33 arquivos); npm run build verde (initial gz
  index 36.41KB + react-vendor 45.44KB; AnalysisWorkspace 22.83KB lazy;
  firebase 97.24KB lazy). src-tauri/audio-acoustics/pitch intocados.
- Residuais axe moderate documentados no tick 6 (region x3 no login,
  heading-order x1 no dialogo QC); zero critical/serious.

## redesign (tick 8) — momento wow #2: contagem dos achados animada — 25/08/2026 ~08h

- Fila R1-R4 estava DONE (ticks 1-7); auditoria fina da spec achou UM residual:
  wow #2 ("ao concluir análise: contagem dos achados anima de 0 até o total")
  não existia — grep por useCountUp/countUp vazio. Os outros 3 momentos wow já
  viviam no código (logo animado LoginScreen:30, ScoreRing workspace:982,
  empty states fila r3).
- Implementação (padrão do repo: matemática pura em utils/, hook fino):
  - src/utils/countUp.ts — easeOutCubic + countFrame com snap EXATO no destino
    (último frame == texto estático antigo), guards p/ duração<=0 e destino
    não finito;
  - src/hooks/useCountUp.ts — rAF + prefers-reduced-motion (estado direto,
    sem frames);
  - QCExportButton: AnimatedStat no diálogo de confirmação — rows/avg/errors
    sobem de 0 ao total (900ms ease-out). Texto final byte-idêntico ao anterior.
- Testes: src/__tests__/countUp.test.ts 10 novos (clamp, snap exato, interpolação
  from!=0, guards NaN/Infinity, elapsed negativo). Suite: 365 -> 375/375 verde.
  tsc --noEmit limpo. npm run build verde: CSS 9.92KB gz (<30KB spec), initial
  index 36.41 -> 36.77KB gz (+0.36KB), chunks lazy intocados.
- Prova em browser real (scripts/redesign_shot_t8_countup.cjs, protocolo anti-
  órfão: preview próprio porta alta + hash servido==dist + profile descartável +
  chrome headless --disable-gpu):
  - headless NOVO reporta prefers-reduced-motion:reduce por padrão — app
    respeitou e foi direto ao estado final (comportamento correto provado);
  - com Emulation.setEmulatedMedia(no-preference): burst sampling 100ms pegou a
    contagem viva "2 rows -> 3 rows -> 4 rows -> 5 rows", terminando no formato
    estático exato. Shots: redesign_shots/t8_qc_final.png (+r3b_* revalidados:
    fila, empty state, diálogo QC, erro humano login — build pós-tick-8).
- src-tauri/audio-acoustics/pitch intocados (só worktree redesign-premium).

## redesign (tick 9) — micro-sparkline da tendência + housekeeping — 25/08/2026 ~09h

- Housekeeping: o registro do tick 8 tinha ficado SEM COMMIT (código pushed
  em b80c422, log não) — resgatado no commit 56b50d6 antes de qualquer coisa.
- Auditoria fina da spec pós-tick-8 achou UM residual real: "Badges de score:
  pill com número tabular + micro-sparkline da tendência" não existia (grep
  spark vazio). Decisão de leitura da spec: NÃO há série temporal de análises
  anteriores no domínio (e inventá-la seria mudança funcional — proibido). A
  "tendência" implementada é o PERFIL das notas por categoria do ScoringEngine
  (fração nota/máximo das 5 categorias, normalizada pois os máximos diferem
  1.27..0.70): dado real já computado a cada marcação, zero funcionalidade nova.
- Implementação (padrões da casa):
  - src/utils/scoreSpark.ts — categoryFractions + sparkPoints puros
    (guards NaN/max<=0, clamp 0..1, pad vertical, ponto único centralizado);
  - src/components/Core/ScoreSpark.tsx — svg decorativo aria-hidden,
    polyline com gradiente accent dos tokens (--color-accent-from→to),
    ponto final marca a categoria mais fraca;
  - AnalysisWorkspace: memo categoryBreakdownForSpark (recalculateScoresWithEngine)
    + spark ao lado do ScoreRing, tooltip rico com nota/máximo por categoria
    (IDs do seed JÁ são o vocabulário MVP: ENQUADRAMENTO, ILUMINAÇÃO...);
  - i18n en/pt ('workspace.scoreSparkTitle').
- Testes: scoreSpark.test.ts 10 novos (frações seed reais, guards, clamp,
  pontos, dimensões inválidas). Suite 375 -> 385/385 verde. tsc limpo. Build:
  CSS 9.92KB gz estável (<30KB spec); index 36.83KB gz (+0.06); spark dentro
  do chunk lazy AnalysisWorkspace (23.43KB gz). Commit 107f6e3.
- Prova em browser real x2 (protocolo anti-órfão, preview própria porta alta +
  hash servido==dist, chrome headless --disable-gpu):
  - estado limpo: points "0,2 14,2 28,2 42,2 56,2", dot no topo, tooltip lista
    as 5 categorias 100% (1,27/1,27 ... 0,94/0,94);
  - marcando 'Uneven Lighting': ILUMINAÇÃO cai pra 0,77/0,87 -> y 2->3,61 na
    linha, dot migra pra categoria mais fraca, tooltip reflete na hora.
    Shots: redesign_shots/t9_workspace_spark.png + t9_workspace_spark_marked.png.
- axe-core 4.10.2 no workspace COM sparkline e regra marcada: ZERO violações
  (todas as impacts). Spark svg aria-hidden+focusable=false confirmado.
  Script: scripts/redesign_axe_t9.cjs (axe via init-script + Page.reload —
  evaluate gigante por WS provou-se frágil p/ 553KB).
- Armadilha registrada: o seletor "ul li > 0" como sinal de login é FRÁGIL —
  a fila demo pré-renderiza atrás do overlay de login. Sinal correto: botão
  guest SUMIR da tela. (Custo: ~6 iterações perdidas no axe script.)
- DECISÃO PENDENTE DO DONO (não implementado): spec pede "labels flutuantes"
  nos inputs; o app usa labels permanentes acima dos campos em TODO lugar.
  Flutuantes mudam a anatomia que o usuário do MVP conhece — mantive permanentes
  (filosofia inegociável > detalhe estético). Se o dono quiser, vira tick próprio
  com aceite visual.
- src-tauri/audio-acoustics/pitch intocados (worktree dedicado solaris-redesign).

## redesign (tick 12) — badges de score com tier semantico (R3 lista) — 25/08/2026
- Residual: spec pede "Badges de score: pill com número tabular + micro-sparkline da tendência"; o badge existia apenas no ScoreRing, nao na lista.
- Não invente a tendencia temporal (não existe série; mesma decisao do tick 9 — sparkline = perfil categoria do ScoringEngine). Aqui: o número vira pill colorido pelo tier (verde >=4 / amarelo >=3 / vermelho <3), mesmo vocabulário do MVP (verde=ok, amarelo=atencao, vermelho=inconformidade).
- Implementacao: scoreFormat.ts + scoreBandClass(); AnalysisSheet.tsx lista com .badge-pill.badge-score; CSS .badge-score (tamanho maior); zebra/hover na lista (even:bg-surface + hover:bg-surface/50). Zero mudanca funcional — mesmos dados do demo.
- Testes: scoreFormat 388/388 (+3 novos: tiers, vírgula decimal, garbage nao inventa cor). tsc 0. build verde. CSS 10.18KB gz (<30KB).
- Prova browser (verify_t12_badge.cjs, protocolo anti-órfão: preview próprio + hash servido==dist + chrome --disable-gpu + cleanup): badges 5/5, classe badge-ok, cor rgb(52,211,153), .tnum font-family mono + font-variant tabular-nums; workspace abre; ScoreRing prova tier ao vivo via stroke. Shots: redesign_shots/t12_fila_badges.png, t12_fila_badges_marked.png.
- Restriçoes respeitadas: mesma anatomia de tela (player+timeline+painel), mesmos nomes/atalhos, nenhum src-tauri/audio/pitch alterado. Labels flutuantes: mantidos permanentes (filosofia inegociavel > detalhe estético — pendência do dono registrada).

## redesign (tick 13) — resgate da divida t12 + re-prova de qualidade pos-t11/t12 — 25/08/2026 ~14h
- DÍVIDA DESTRavada: o pacote t12 (a9f5c10) tinha ficado parado SEM PUSH e o
  registro sem commit — ambos subiram (log resgatado em 2f1a628; push
  origin/redesign-premium verificado por ls-remote @ 2f1a628).
- Esclarecimento honesto sobre as shots t12_fila_badges{,_marked}.png serem
  byte-idênticas: comportamento ESPERADO e documentado no próprio script —
  modo demo não propaga marcação pra lista (escrita vai por sheetSync/nuvem),
  então a prova C cai no caminho da NOTA (tier warn coberto por testes
  unitários + prova A do CSS). Não é captura fabricada nem prova perdida.
- RE-AUDITORIA axe-core nas 4 telas sobre o estado final (t11 remapeou 214 usos
  de cor; t12 adicionou badges semânticos — nenhum dos dois tinha passado por
  axe depois): fila e análise ZERO; login mantém só o residual conhecido
  (region x3, moderado, decisão documentada no tick 6). NOVO achado e cura:
  heading-order moderado no diálogo QC (h3 sem h2 anterior) -> h3 virou h2
  (classes idênticas, visual byte-equal); re-scan: diálogo QC com ZERO
  violações de qualquer impacto. Prova: scripts/verify_r4.cjs x2 (antes/depois).
- Gates finais: vitest 388/388, tsc limpo, build verde, CSS 10.18KB gz (<30KB
  spec), index inicial 37.08KB gz (+react-vendor 45.44 = ~82.5KB gz initial).
- Shots regeneradas pós-t12 pro aceite do dono: r4_{login,fila,analysis,
  qc_dialog,qc_report}.png em saas_factory/redesign_shots/.
- src-tauri/audio-acoustics/pitch intocados (worktree dedicado solaris-redesign).

---


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


