# SOLARIS — log de trabalho

## turbo-web
### 2026-08-25 ~20h30 - tick #16: guardrail noturno - fila DONE, zero deltas, gates re-provados

- Fila bundle/split/e2e/a11y/lighthouse segue 100% DONE (ticks #1-#15); sem diretiva nova.
- Upstream auditado: origin/main sem delta (fd281fc == local); v2-upgrade contida em main;
  develop avançou só README (bd3a560, fora do escopo da lane). Nada a sincronizar.
- Gates na main @ fd281fc:
  vitest **342/342** (+tsc clean), e2e fluxo real **21/21**, axe **0/0** violacoes,
  console probe **0 eventos**, build byte-estavel `index-C1mX7UAW.js` -
  initial gz **79,65KB core** (index 33,86 + react-vendor 45,79; +CSS 7,60 = 87,25KB) vs alvo <500KB.
- Lighthouse x2 (headless --disable-gpu): R1 **99/100/100/100**, R2 **99/100/100/100**
  (FCP 1.5s / LCP 1.6s / TBT 20 e 0ms / CLS 0; perf 99 = ruido CPU ambiente documentado).
- Preview em porta alta aleatoria (4540) com PROVA de hash (entry servido == dist local);
  encerrado apos o gate. Background preview passou a esbarrar no guard de foreground do
  terminal - protocolo: background=true + probe/porta em chamada separada.


### 2026-08-25 ~21h40 - tick #15: guardrail noturno - fila DONE, zero deltas, gates re-provados

- Fila bundle/split/e2e/a11y/lighthouse segue 100% DONE (ticks #1-#14); sem diretiva nova.
- Deps: npm audit re-checado - prod 10 moderates major-gated (0 high/critical),
  sem advisory nova desde o tick #12. Nada a atualizar.
- Gates na main @ d479238 (sync origin 0/0):
  vitest **342/342** (+tsc clean), e2e fluxo real **21/21**, axe **0/0** violacoes,
  console probe **0 eventos**, build byte-estavel `index-C1mX7UAW.js` -
  initial gz **79,65KB core** (index 33,86 + react-vendor 45,79; +CSS 7,60 = 87,25KB) vs alvo <500KB.
- Lighthouse x2 (headless --disable-gpu): R1 **99/100/100/100**, R2 **98/100/100/100**
  (perf <100 = ruido CPU ambiente ~40% ja documentado nos ticks #13/#14; TBT 20/140ms).
- Preview servido em porta alta aleatoria com PROVA de hash (entry servido == dist local);
  preview v4->v6 segue IPv6-only (::1), localhost family:6 ok, 127.0.0.1 ECONNREFUSED esperado.


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

## turbo-web tick #10 — dívida de segurança: prod zera high/critical — 25/08/2026 ~15h20

- Estado encontrado: fila 1–6 segue DONE/mergeada (nada a re-auditar); main
  limpo no worktree, origin/main = main. Trabalho novo escolhido: a dívida de
  segurança marcada fora-de-escopo no tick #7 (npm audit).
- ANTES (prod): 30 vulns = 1 critical + 8 high + 20 moderate + 1 low.
  Critical = websocket-driver <=0.7.4 (GHSA-mp7j-qc5w-4988 /
  GHSA-xv26-6w52-cph6) via firebase@10 > @firebase/database > faye-websocket.
- Passo 1 — npm audit fix (só não-breaking): crítico morto com patch bump
  websocket-driver 0.7.4 -> 0.7.5; 29 pacotes re-resolvidos dentro de range;
  package.json intocado neste passo. Prod: 30 -> 24 vulns.
- Passo 2 — pins antigos de overrides viraram o gargalo: protobufjs 7.5.5 e
  fast-xml-parser 4.5.5 (de ticks anteriores) agora são eles mesmos vulneráveis
  e travavam a cadeia (@grpc/proto-loader, google-gax, proto3-json-serializer,
  @google-cloud/firestore). Bump mínimo dos pins:
  protobufjs 7.5.5 -> 7.6.5 (fix range <=7.6.4), fast-xml-parser 4.5.5 -> 5.7.0
  (fix range <5.7.0). Prod: 24 -> ~20, highs de gRPC zerados.
- Passo 3 — undici pin 6.25.0 -> 6.28.0 (vuln range <=6.27.0, fix ainda no
  próprio 6.x — sem major). PROD FINAL: 10 vulns, TODAS moderate major-gated
  (firebase 12 / firebase-admin 14 / googleapis 176), 0 high, 0 critical.
  Árvore completa (incl. dev): 35 -> 13 (resta 1 high = vite <=6.4.2, fix é
  vite@8 major — dívida documentada p/ tick próprio).
- Gates na árvore atualizada (worktree solaris-web-turbo @ main):
  - tsc --noEmit limpo; vitest 31 arquivos · 342/342 verdes;
  - build vite: initial gz 86,71 KB byte-idêntico ao tick #9 (index 33,67 +
    react-vendor 45,44 + css 7,60); chunks lazy idem (firebase 97,35,
    AdminGate 18,93, AnalysisWorkspace 19,71, sheetSync 11,18);
  - E2E fluxo real: 21/21 asserts ok;
  - axe-core build servida: 0 login / 0 app principal (report regenerado);
  - console probe CDP: 0 erros / 0 warnings / 0 exceções (guestClicked:false =
    esperado, build offline entra direto no demo);
  - Lighthouse x2 rodadas (--headless=new --disable-gpu): performance 99 ·
    accessibility 100 · best-practices 100 · seo 100 — FCP 1,4s · LCP 1,6s ·
    TBT 10ms · CLS 0. Perf 99 vs 100 do tick #9 é ruído de CPU (desktop e
    áudio lanes em paralelo); bundle inicial idêntico, tempos iguais,
    confirmado em 2 rodadas.
- Pendências registradas (major-gated, um tick cada com gates completos):
  firebase ^10->^12, firebase-admin ^12->^14, googleapis ^140->^176,
  vite ^4->^8 (high dev).
- src-tauri intocado. Sem Telegram.

### 2026-08-25 ~19h — turbo-web tick #11: guardrail noturno — zero deltas, gates re-provados

- Estado encontrado: fila 1–6 segue DONE/mergeada; origin/main = main local
  @ 86b6b85 (tick #10); worktree limpo. Branches com ahead>0 sao de OUTRAS
  lanes (desktop 37, redesign 25, audio 18, features 17) — nenhum trabalho da
  fila web ficou orfao sem PR.
- Gates re-provados nesta arvore exata:
  - tsc --noEmit limpo; vitest 342/342 (31 arquivos);
  - build deterministica: initial gz 86,71 KB byte-identico ao baseline
    (index 33,67 + react-vendor 45,44 + css 7,60); lazy idem (firebase 97,35,
    AdminGate 18,93, AnalysisWorkspace 19,71, sheetSync 11,18);
  - E2E fluxo real 21/21 asserts;
  - npm audit prod: 10 moderate major-gated, 0 high/0 critical (estavel vs #10);
  - axe-core na build servida (preview porta alta aleatoria, hash do entry
    conferido contra dist local): 0 violacoes login / 0 app principal;
  - console probe CDP: 0 erros/0 warnings/0 excecoes;
  - Lighthouse x2 rodadas (--headless=new --disable-gpu): 100/100/100/100 nas
    duas — perf 99 do tick #10 confirmado como ruido de CPU; FCP 1,4s /
    LCP 1,4s / TBT 0ms / CLS 0.
- Nenhuma mudanca de codigo => nenhum commit alem deste registro. Pendencias
  major-gated seguem as listadas no tick #10 (firebase 12, firebase-admin 14,
  googleapis 176, vite 8).
- src-tauri intocado. Sem Telegram.

---

### 2026-08-25 ~20h20 - turbo-web tick #12: vite 4->6.4.3 (security) + robots.txt; guardrail re-provado

- Guardrail inicial (arvore no estado do tick #11): tsc limpo, vitest 342/342,
  build initial gz 86,71KB byte-identica, e2e 21/21, axe 0/0 (hash entry
  conferido), console probe 0 eventos, Lighthouse 100/100/100/100.
- Divergencia de audit detectada vs tick #10/#11: 1 HIGH apareceu (13 vulns
  total) — vite <=6.4.2 com 7 advisories de dev-server (path traversal /
  server.fs.deny bypass no Windows, launch-editor cmd injection). A pendencia
  major-gated "vite 8" virou high real.
- Decisao por dados (OSV): todas as 7 advisories tem fix na linha 6.x
  (6.4.3 fecha a ultima). Upgrade MINIMO escolhido: vite ^4.2->^6.4.3 +
  plugin-react ^3.1->^4.7.0 (peer cobre vite 4-7); evita salto p/ v8
  (rolldown-by-default, blast radius maior). vitest 4 ja aceitava vite ^6.
- Resultado seguranca: 13 -> 10 vulns (0 high, 0 low); prod segue 10 moderate
  major-gated (firebase 12 / firebase-admin 14 / googleapis 176 continuam na
  fila, um tick cada).
- Bundle: initial gz 86,71 -> 87,25 KB (+0,54KB, +0,6% = runtime novo do
  bundler; alvo <500KB intacto). Chunks lazy preservados (firebase 97,38,
  AdminGate 18,99, AnalysisWorkspace 20,04, sheetSync 11,19).
- Fix colateral: vite 6 preview responde index.html com 200 em rotas nao-
  existentes (SPA fallback) => audit LH robots-txt reprovava (92).
  public/robots.txt adicionado (valido e permissivo; Disallow:/ derrubaria o
  audit is-crawlable pra 66 — testado e descartado). SEO de volta a 100.
- Gates na arvore final: tsc limpo; vitest 342/342; e2e 21/21; axe 0/0;
  console probe 0 eventos; Lighthouse x2 (--headless=new --disable-gpu):
  R1 99/100/100/100 (FCP 1,4s LCP 1,5s TBT 0 CLS 0), R2 100/100/100/100.
- Higiene de maquina: kill_turbo_orphans.ps1 -MaxAgeHours 0 limpou 6 previews
  orfaos DESTE projeto (portas 4223/4261/4707/4711/4713; kill do wrapper npx
  NAO mata o filho node do preview — usar sempre o script). ~50 orfaos de
  vite preview da lane redesign (outras pastas) FORA do meu escopo por
  politica do script — alertado aqui pro worker responsavel limpar.
- src-tauri intocado. Sem Telegram.

---

## turbo-web tick #13 — guardrail noturno + due diligence de deps pesadas — 25/08/2026 ~18h20

Worktree solaris-web-turbo @ main == origin/main (88108e3), arvore limpa.
Fila original (1-6) segue DONE desde o tick #5; nenhum delta de codigo desde
o tick #12. Este tick: re-prova dos gates com numeros frescos + investigacao
de ganho barato restante.

GATES (arvore limpa, build fresca):
- npm run build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — byte-estavel vs tick #12. Chunks lazy intactos
  (firebase 97,38 / AdminGate 18,99 / AnalysisWorkspace 20,04 / sheetSync
  11,19 / ComparePane 1,37).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~30s);
- e2e fluxo real: 21/21 asserts ok;
- axe-core scan: 0 violacoes login+main app, entry servido PROVADO igual ao
  dist local (index-C1mX7UAW.js) antes de confiar no resultado;
- Lighthouse x2 limpas (--headless=new --disable-gpu): R1 99/100/100/100,
  R3 99/100/100/100. (R2 descartada: rodei `npm audit` em paralelo por
  engano durante a medicao — contencao de CPU derrubou perf p/ 96; benchmark
  tem que rodar sozinho, licao registrada.)
- npm audit prod: estavel em 10 moderate, 0 high/critical (mesmo patamar do
  tick #12).

DUE DILIGENCE de ganho barato (sem codigo alterado):
- Deps pesadas do package.json (googleapis, firebase-admin, fluent-ffmpeg/
  ffmpeg-static/ffprobe-static, ytdl-core): ZERO imports em src/. Sao usadas
  apenas pelas funcoes serverless em api/*.ts (proxies Drive/Sheets/YouTube)
  — dependencias de backend legitimas, nao inflam o bundle cliente. NAO
  remover do package.json.
- Audits LH de otimizacao (unused-javascript, bootup-time,
  mainthread-work-breakdown) todas score 1.0 com savings ~0 — nao sobra
  fruta ao alcance da fila; proximos passos reais seriam features novas ou
  migracao de stack (fora do escopo turbo-web).
- Preview deste tick subiu em porta alta fixa 4777 e foi morto no fim
  (protocolo anti-orfao mantido).

src-tauri intocado. Sem Telegram.

## turbo-web tick #14 — guardrail noturno + higiene de orfaos — 25/08/2026 ~19h05

Estado encontrado: worktree @ main == origin/main (88108e3), untracked nenhum;
`scripts/axe-report.json` sujo era so o artefato REGENERADO pelo proprio tick
#13 (timestamp/porta novas, 0 violacoes dentro) — superado por re-scan fresco
deste tick. Fila original (1-6) segue DONE desde o tick #5.

GATES (arvore limpa, build fresca):
- npm run build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTAVEL vs ticks #12/#13 (mesmo hash de entry
  index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 / AdminGate 18,99 /
  AnalysisWorkspace 20,04 / sheetSync 11,19 / ComparePane 1,37).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~52s);
- e2e fluxo real: 21/21 asserts ok;
- axe-core scan: 0 violacoes main app (build offline/demo sem login), preview
  PROVADO nosso antes do scan (entry index-C1mX7UAW.js na porta 4425);
- Lighthouse x3 (--headless=new --disable-gpu): R1 99/100/100/100 (FCP 1,5 /
  LCP 1,6 / CLS 0,000 / TBT 27ms); R2 e R3 perf 97 (TBT 185/155ms, FCP/LCP/
  CLS identicos). Diagnostico: build byte-idêntica não regride — CPU ambiente
  medida a ~40% durante R2/R3 (enxame de workers/preview de outras lanes ativo
  hoje); ruído documentado como veio, sem re-run até "pegar" score.
- npm audit prod: 10 moderate, 0 high/critical — mesmo patamar estável de
  #12/#13.

HIGIENE (achado novo, SEM acao fora da lane):
- Enxame de `vite preview` orfaos de OUTRAS lanes vivo agora: ~30 trios
  npx/cmd/node da lane redesign (03:54–14:03 de hoje, portas 43xx–48xx),
  + work_ck_repo porta 4179 (24/08) e Hein-Esthetics porta 4188 (24/08).
  Regra de lane mantida: NAO matei processo de outra lane — registrado para o
  dono decidir varredura global.
- Preview deste tick subiu na porta alta 4761 (strictPort), entry provado
  igual ao dist local antes de qualquer medicao e foi morto no fim.

src-tauri intocado. Sem Telegram.

## turbo-web tick #17 — guardrail noturno — 25/08/2026 ~21h25

Estado encontrado: worktree @ main == origin/main (17039f1), zero delta
upstream desde o tick #16 (v2-upgrade segue contida em main; turbo/web-opt
ahead 0 do merge-base). Fila original (1-6) segue DONE desde o tick #5.

GATES (arvore limpa, build fresca):
- build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTAVEL vs ticks #12..#16 (mesmo hash de
  entry index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 /
  AdminGate 18,99 / AnalysisWorkspace 20,04 / sheetSync 11,19 /
  ComparePane 1,37).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~32s);
- e2e fluxo real: 21/21 asserts ok;
- axe-core scan: 0 violacoes main app (build demo/offline sem tela de
  login), preview PROVADO nosso antes do scan. Nota: a primeira tentativa
  falhou FECHADO na prova de identidade (index servido veio sem o entry
  esperado — consistente com colisao da porta aleatoria com um dos
  servidores estranhos conocidos; strictPort mata o nosso e a prova
  detecta). Re-run em nova porta aleatoria passou e provou o entry.
- Lighthouse x2 limpas (--headless=new --disable-gpu): R1 E R2
  100/100/100/100 (FCP 1,4s / LCP 1,5s / CLS 0 / TBT 0ms) — melhor ronda
  da noite (CPU ambiente livre nas duas).
- console probe: 0 erros/avisos no boot (build demo abre direto no app,
  sem botao guest — comportamento estavel desde tick #14);
- npm audit prod: 10 moderate, 0 high/critical — mesmo patamar estavel
  de #12/#13/#15/#16.

Preview deste tick subiu na porta alta 4652 (strictPort), entry provado
igual ao dist antes das medicoes e foi morto no fim (wrapper bash saiu
cedo e o node filho ficou vivo — matado direto por pid via
Get-NetTCPConnection; porta confirmada livre depois).

src-tauri intocado. Sem Telegram.

## turbo-web tick #18 — guardrail noturno — 25/08/2026 ~22h00

Estado encontrado: worktree @ main == origin/main (bdc4633, tick #17),
zero delta upstream desde o último tick (v2-upgrade segue contida em main;
turbo/web-opt ahead 0; audio/acoustics e desktop em suas lanes próprias).
Fila original (1-6) segue DONE desde o tick #5.

GATES (árvore limpa, build fresca):
- build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTÁVEL vs ticks #12..#17 (mesmo hash de
  entry index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 /
  AdminGate 18,99 / AnalysisWorkspace 20,04 / sheetSync 11,19 /
  ComparePane 1,37 + BugReport*).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~23s);
- e2e fluxo real: 21/21 asserts ok (YouTube → scoring → fila → export QC);
- axe-core scan: 0 violações main app (build demo/offline sem tela de
  login), preview PROVADO nosso antes do scan (entry conferido);
- console probe (preview dedicado porta 4618 strictPort): 0 erros/avisos
  no boot, entry provado igual ao dist;
- Lighthouse x2 limpas (--headless=new --disable-gpu): R1 E R2
  100/100/100/100 (FCP 1,4s / LCP 1,5s / CLS 0 / TBT 0ms) — CPU ambiente
  livre nas duas rondas.
- npm audit: não re-executado neste tick (patamar estável 10 moderate /
  0 high nos ticks #12..#17; nenhuma dependência mudou — árvore idêntica).

Higiene: wrapper npx do preview morto via process.kill + filho node morto
por pid via GetNetTCPConnection(4618); porta confirmada livre no fim.
src-tauri intocado. Sem Telegram.


## turbo-web tick #19 — guardrail noturno — 26/08/2026 ~00h30

Estado encontrado: worktree @ main == origin/main (253060e, tick #18),
zero delta upstream desde o último tick (v2-upgrade ahead 0,
turbo/web-opt ahead 0; audio/acoustics, desktop, features, redesign em
suas lanes). Fila original (1-6) segue DONE desde o tick #5.

GATES (árvore limpa, build fresca):
- build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTÁVEL vs ticks #12..#18 (mesmo hash
  index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 / AdminGate
  18,99 / AnalysisWorkspace 20,04 / sheetSync 11,19 / ComparePane 1,37
  + BugReport*).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~27s);
- e2e fluxo real: 21/21 asserts ok (YouTube → scoring → fila → export QC);
- axe-core scan: 0 violações (demo/offline, sem login screen), preview
  PROVADO nosso antes do scan (entry conferido);
- console probe (preview dedicado porta 4820 strictPort): 0 eventos de
  erro/aviso no boot, entry provado igual ao dist;
- Lighthouse x2 (--headless=new --disable-gpu): R1 E R2 100/100/100/100
  (FCP 1,4s / LCP 1,5s / CLS 0 / TBT 0ms) — CPU ambiente livre nas duas
  rondas.
- npm audit: não re-executado (patamar estável 10 moderate / 0 high nos
  ticks #10..#18; árvore idêntica).

HIGIENE DE PORTAS (achado novo deste tick):
- Porta 4477 presa por órfão REAL de 11,2h: wrappers bash/npx/cmd já
  mortos mas o filho node sobreviveu — servindo build SOLARIS STALE
  pré-tick-#12 (entry index-DubV40Sq.js), originada da lane
  solaris-audio. Identidade provada pelo <title>+assets servidos antes
  de matar (regra: fixed ports guilty until proven innocent). Morto por
  pid (node 37312); porta confirmada livre.
- Porta 4188 (órfã de 36,6h): serve build do HEIN ESTHETICS (projeto
  ZIMNY do Zee) — NÃO tocada, regra de não mexer em Zimny sem ordem.
- Porta 4599: preview VIVO da lane solaris-redesign (sessão fresca
  <30min no momento da checagem) — intocada.
- Meu próprio preview deste tick (porta 4820): wrapper morto via
  process.kill + filho node morto por pid; porta confirmada livre.

src-tauri intocado. Sem Telegram.

## turbo-web tick #20 — guardrail noturno — 26/08/2026 ~23h30

Estado encontrado: worktree @ main == origin/main (b184184, tick #19),
zero delta upstream desde o último tick (v2-upgrade ahead 0,
turbo/web-opt ahead 0, v2-upgrade-recovery contida em main; audio/
acoustics, desktop, features, redesign em suas lanes). Único fora-de-main
novo auditado: origin/develop ahead 1 = relic de fev/2026 ("Update
README.md", autoria do dono) — sem ação. Fila original (1-6) segue DONE
desde o tick #5.

GATES (árvore limpa, build fresca):
- build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTÁVEL vs ticks #12..#19 (mesmo hash
  index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 / AdminGate
  18,99 / AnalysisWorkspace 20,04 / sheetSync 11,19 / ComparePane 1,37
  + BugReport*).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~16s);
- e2e fluxo real: 21/21 asserts ok (YouTube → scoring → fila → export QC);
- axe-core scan: 0 violações (demo/offline), preview PROVADO nosso antes
  do scan (entry index-C1mX7UAW.js == dist);
- console probe: 0 eventos de erro/aviso no boot (identidade provada);
- Lighthouse x2 (--headless=new --disable-gpu): R1 E R2 100/100/100
  perf/a11y/bp (FCP 1,4s / LCP 1,5s / CLS 0 / TBT 0ms) — 3 categorias
  conforme diretiva desta noite (seo não medido neste tick);
- npm audit RE-executado: 10 moderate / 0 high/critical — mesmo patamar
  estável desde #12, árvore idêntica.

NOVO NESTE TICK:
- scripts/turbo-gates.mjs: runner único p/ console probe + LH x2 com
  prova de identidade (entry hash) e cleanup garantido no exit (servidor
  de dist + chrome mortos; portas usadas confirmadas livres depois).
  Motivo: o lighthouse deixou de existir como binário estável do cache
  npx por nome — resolvido por path _npx/0f94ee7615faf582 (lighthouse
  13.4.1, entry cli/index.js; layout antigo lighthouse-cli/ não existe
  mais). Substitui o fluxo npx ad-hoc dos ticks anteriores e torna o
  gate reprodutível.
- HIGIENE: dev-server órfão REAL de 12h da lane solaris-audio na porta
  4578 (wrappers bash-npx/cmd criados 25/08 ~11h23, sessão morta; servia
  "Solaris | AV Analysis Engine" — identidade provada antes de matar).
  Morto por pid (wrapper 8060 + node filho 32304); porta confirmada livre.
  Porta 4179 (work_ck_repo, projeto alheio) e 4188 (HEIN/ZIMNY) intocadas
  por regra; suíte vitest ativa da lane features vista rodando — intocada.

src-tauri intocado. Sem Telegram.

## Tick #21 26/08 01h32 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno
- Upstream auditado SEM DELTA: origin/main == HEAD (c42bb8d7, tick #20);
  nenhuma lane avancou desde o ultimo tick. Guardrail = re-provar gates.
- vitest: 31 arquivos / 342/342 (~37s) VERDE;
- e2e fluxo real (YouTube -> scoring -> fila -> export QC): 21/21 asserts;
- build medido com NOVO scripts/chunk_report.mjs (gzip level 9 por chunk):
  TOTAL dist 940,3KB raw / 233,2KB gz; INITIAL (entry index-C1mX7UAW.js
  33,0KB gz + CSS 7,4KB gz) = 40,35KB gz - alvo <500KB gz amplamente
  atendido; entry BYTE-ESTAVEL vs ticks #12..#20 (index-C1mX7UAW.js);
  maiores chunks: firebase 94,8 / react-vendor 44,7 / index 33,0 /
  AnalysisWorkspace 19,5 / AdminGate 18,5 / sheetSync 10,9 KB gz.
- axe-core scan: 0 violacoes (demo/offline), identidade do preview provada
  (entry hash == dist); axe-report.json regenerado;
- console probe: 0 eventos de erro/aviso no boot;
- Lighthouse x2 (--headless=new --disable-gpu): R1 E R2 100/100/100
  perf/a11y/bp (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms).
- Higiene: nenhum orfao novo detectado neste tick.

src-tauri intocado. Sem Telegram.
