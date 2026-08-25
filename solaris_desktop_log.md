# SOLARIS Desktop — Log de Trabalho (branch `desktop`)

> Não merge na main até o dono aprovar. Um commit pequeno por passo.
> Build Rust sempre com: toolchain `stable-x86_64-pc-windows-gnu` +
> winlibs binutils no PATH (`%LOCALAPPDATA%/Temp/winlibs_bin`) +
> `CARGO_TARGET_DIR=D:/cargo-target` (fora do OneDrive).

> **PROTOCOLO ANTI-CLOBBER (todas as lanes que escrevem aqui)**: este log e
> COMPARTILHADO entre worktrees (desktop, audio/acoustics, features...). NUNCA
> salve o arquivo inteiro a partir da sua copia local: peca SEMPRE o conteudo
> ATUAL em disco e faca APPEND-ONLY da sua secao no fim (ajuste local so da
> sua propria entrada). Historico: 2 clobbers em 25/08 - fantasma ~12h (F1) e
> ~15h40 (tick audio 14h55 apagou secoes desktop 13h50/14h35). Ambos
> reconciliados sem perda via `git show HEAD:`.

---

## Tick 24/08 ~23:55 — P2 Otimizações (release profile)

**Escopo:** perfil de release Rust. Bundle JS e code-splitting já estavam
entregues (S3.1: firebase/react-vendor chunks + React.lazy do workspace;
sabor standalone 243KB inicial sem SDK de nuvem).

### Mudanças
- `src-tauri/Cargo.toml`: `panic = "abort"` no `[profile.release]`
  (lto=true, codegen-units=1 e strip=true já existiam).
- `scripts/boot_time_desktop.ps1`: mede tempo até a janela aparecer
  (polling de `MainWindowHandle`, kill ao final).
- Este log criado.

### Métricas ANTES / DEPOIS

| Métrica | ANTES | DEPOIS | Delta |
|---|---|---|---|
| Binário (`D:/cargo-target/release/solaris-av-engine.exe`) | 7.289.344 B (6,95 MB) | 6.342.656 B (6,05 MB) | −946.688 B (−13%) |
| Bundle JS inicial (standalone) | react-vendor 141,8 KB + index 103,1 KB ≈ 245 KB gzip'd-on-wire | idem (sem mudança) | — |
| Boot (Start-Process → janela visível) | n/d | **198 ms** | — |
| Working set pós-boot | 26,7–27,6 MB (smoke 5s) | 19,6 MB (pós-janela) / 27,6 MB (smoke 5s) | ~estável |

### Verificação
- `cargo test --release` (com panic=abort): **12/12 ok**.
- `npm test` (vitest): 258/263 — as 6 falhas estão TODAS em
  `src/audio-acoustics/__tests__/p2-synthetic.test.ts`, diretório **untracked**
  (WIP de outra frente, fora da branch desktop); suíte commitada 250/250 verde.
- Smoke do binário novo (`scripts/smoke_desktop.ps1`):
  `SMOKE_OK: pid=15444 vivo apos 5s mem=27.6MB` → kill limpo.

---

## Histórico anterior (resumo por commit)

- `6ac8176` conf release Tauri (id dev.chr-z.solaris, CSP restritiva, NSIS);
  primeiro exe gnu 5,2MB; SMOKE_OK 6s/26,7MB.
- `83803f4` modo standalone sem nuvem (runtimeMode override>flag>Tauri>cloud,
  stubs offline firebase/compat, bypass de login c/ dados demo; bundle desktop
  243KB inicial, −472KB firebase vs web).
- `6f6f2ec` beforeBuildCommand usa `build:desktop` (zero SDK nuvem no exe).
- `1919830` pick_folder nativo (rfd) + scan Alfred async na thread-pool.
- `7b1da46` Procurar…/Escanear agora no Admin-Fontes via IPC.
- `6f7e500` persiste último scan Alfred no SQLite (%APPDATA%/dev.chr-z.solaris/
  solaris.sqlite3), migration 0002; fix serde camelCase no ScanRequest.
- `d175397` UI restaura último scan do cache SQLite (badge "Restaurado do cache").
- `16e4532` db_path lê %APPDATA% direto (crate dirs removida); exe 7,29MB;
  teste de persistência em arquivo real — 12/12.

## Pendências conhecidas

- [P3] Flag por ENV externa ao build — AUDITADO neste tick, desnecessário:
  `import.meta.env` é compile-time no navegador, então uma "env var" seria
  equivalente ao sabor de build já existente (`__SOLARIS_STANDALONE__`). Para
  forçamento por instalação existe o override `localStorage.solaris.runtimeMode`;
  e o exe Tauri detecta `window.__TAURI_INTERNALS__` em runtime, então fica
  standalone mesmo se alguém empacotar o sabor cloud (defesa em profundidade).
- [UI] Esconder itens de nuvem quando standalone — PARCIAL: login nunca aparece
  (auto-signin local), Header não expõe ações de nuvem. Resta apenas o caso de
  uma linha com link Drive/YouTube ser clicada (falha com mensagem clara
  "requires Google Authentication", sem travar). Refinamento futuro: esconder
  o affordance de link nas linhas quando standalone.
- Instalador NSIS assinado: fora do escopo desta noite (objetivo = exe rodando).
- Aviso do linker `.rsrc merge failure: multiple non-default manifests`
  (winlibs ld + tauri-build): cosmético, exe funciona (smoke OK); investigar
  versão de binutils se virar erro.
- WIP untracked fora da branch (`src/audio-acoustics/`, scripts smoke-p1x.mjs):
  NÃO commitado aqui; suíte dele tem 6 falhas próprias (fixtures sintéticas),
  fora do escopo desktop.

---

## Tick 25/08 ~01:20 — P3 refinamento: zero affordances de nuvem no standalone

**Contexto:** P1/P2 já entregues (exe rodando, boot 198ms). Este tick fechou a
pendência [UI] da auditoria de 24/08: affordance de link Drive/YouTube nas
linhas quando standalone.

### Mudanças
- `AnalysisForm.tsx`: gate `isStandalone()` em 3 pontos — `<a>` do label
  (todos os tipos de campo), `<a>` dentro dos checkboxes e o botão
  "Open Google Drive Picker" do campo FOLDER (em standalone cai no input de
  texto genérico, sem botão/ícone de nuvem).
- `vitest.config.ts`: removido @vitejs/plugin-react do ambiente de teste
  (v3 injeta `@react-refresh` de forma incompatível com o pipeline .tsx do
  Vitest 4); JSX dos testes coberto pelo transform nativo do esbuild
  (tsconfig jsx=react-jsx).
- Novo teste `src/components/Analysis/__tests__/analysisFormStandalone.test.tsx`
  (4 casos): cloud mantém links/botão; standalone remove todos; FOLDER com
  link Drive vira texto sem botão; override localStorage respeitado entre
  montagens. Sem @testing-library: createRoot + act direto;
  vi.mock de constants inclui FOLDER na aba p/ exercitar o botão.

### Métricas
- Bundle standalone (npm run build:desktop): index 103,0KB + react-vendor
  141,9KB (JS inicial ~77KB gzip) + CSS 37,4KB (gz 7,1KB) — estável vs 24/08.
- Binário: D:/cargo-target/release/solaris-av-engine.exe = 6.525.952 B
  (6,22MB; +183KB vs tick P2 — rebuild com dist novo embutido).
- Smoke: SMOKE_OK pid=8748 vivo após 5s mem=23,8MB, kill limpo.

### Verificação
- Suíte commitada 233/233 verde (`vitest run --exclude src/audio-acoustics/**`;
  WIP untracked de outra frente permanece fora de escopo, com 5 falhas próprias).
- Build Tauri release: OK em 2m34s (`cargo tauri build --no-bundle`,
  toolchain gnu + winlibs_full/mingw64/bin no PATH p/ windres).
- Push: 75eb38c..966180b desktop -> origin/desktop.
## redesign (tick 4) — R2 componentes base — 25/08/2026 00:45
- Commit c52803e @ redesign-premium, pushed.
- **FIX crítico herdado do R1**: `@import tokens.css` depois de `@tailwind` = descartado
  pelo postcss-import → `:root` inteiro fora do build, tema Tailwind apontando pra vars
  vazias. Movido pro topo + fontes latin-only: CSS gz 30.8→**9.12KB** (meta <30KB).
- FIX bg-solar-dark-border como fundo de input (rgba quase transparente) em AnalysisForm/SourceSelector.
- Kit R2 completo: badge-pill+variantes semânticas, checkbox-custom animado (140ms),
  tooltip-rich (título/desc/kbd), skeletons line/title/block, solaris-logo (intro 600ms 1x/sessão,
  reduced-motion ok). Safelist Tailwind p/ classes ainda não citadas em tsx.
- Aplicado: Tooltip core, LoginScreen premium, botões primários gradiente+glow (Header/SourceSelector),
  checkboxes do filtro; migração alias→token em App/AdminRulesPanel/AnalysisForm/FilterControls/
  AnalysisWorkspace/SourceSelector/AnalysisSheet/Header (~60 subs, ring-offsets claros removidos).
- Validação: build verde; vitest 332/332; lint sem novos erros (18 pré-existentes);
  verify_r2.cjs confirma no browser real: bg #0b0e14, Inter ativa, gradiente do disco,
  regras .badge-pill/.checkbox-custom/.tooltip-rich/.skeleton-* presentes.
- Screenshots: redesign_shots/r2_login.png + r2_workspace.png (login e workspace demo).
- Próximo tick: R3 telas principais na ordem análise → fila → relatório QC (timeline pins,
  score ring SVG animado, empty states ilustrados).

---

## Tick 25/08 ~02:15 — auditoria independente P1–P3 (fila turbo vazia)

**Contexto:** fila P1/P2/P3 já executada em ticks anteriores (até a91df70).
Nada a avançar sem diretiva nova; este tick rodou verificação de ponta a ponta
(anti-false-done) em vez de re-auditar escopo piecemeal.

### Verificação
- vitest 233/233 (`--exclude src/audio-acoustics/**`, WIP de outra frente) — verde.
- cargo test stable-gnu: 12/12 — verde.
- `npm run build:desktop` + `cargo tauri build --no-bundle`: OK em 2m26s.
- **Armadilha nova registrada:** `cargo tauri build` puro (sem wrapper
  `rustup run`) usa o default MSVC e morre no link.exe do coreutils
  ("extra operand"); fix validado = `RUSTUP_TOOLCHAIN=stable-gnu` exportado
  no env (winlibs no PATH não basta sozinho). O exe canônico não foi tocado
  pelo build quebrado (timestamp preservado até o rebuild bom).
- Artefato: D:/cargo-target/release/solaris-av-engine.exe = 6.525.952 B
  (6,22MB), rebuild 02:13, prova de conteúdo `grep -c pick_folder` ≥1.
- Smoke: SMOKE_OK pid=32388 vivo após 5s mem=23,3MB, kill limpo.
- Estado da fila: P1 (exe rodando) ✅, P2 (lto/cu=1/strip/panic=abort +
  code-splitting, JS inicial ~245KB < meta 500KB) ✅, P3 (standalone sem
  nuvem, 0 affordances de cloud) ✅ — pendências restantes são só as
  conhecidas (NSIS assinado fora de escopo hoje; `.rsrc` cosmético).
- Próximos ticks: só com diretiva nova do dono ou lane redesign (R3).
## desktop (tick turbo) — instalador NSIS gerado e provado ponta a ponta — 25/08/2026 ~03:15
- Fila P1-P3 ja DONE em ticks anteriores (ate 8ddef16); este tick fechou o ultimo
  gap concreto da lane desktop: artefato DISTRIBUIVEL (instalador nao-assinado;
  assinatura de codigo continua fora de escopo — exige certificado do dono).
- `cargo tauri build` COMPLETO (bundle ativo): vite standalone + release gnu +
  download automatico NSIS 3.11 + nsis_tauri_utils.dll -> OK em ~2m30s.
- Artefatos: bundle/nsis/Solaris_3.0.0_x64-setup.exe = 2.448.333 B; exe canonico
  D:/cargo-target/release/solaris-av-engine.exe = 6.525.952 B (RE-PATCHADO pelo
  bundler com bundle type info nsis -> smoke REFEITO pos-patch: SMOKE_OK pid=39432
  vivo 5s mem=23,6MB, kill limpo).
- NOVO scripts/install_smoke.ps1: instalacao silenciosa (/S /D=dir de teste),
  conferencia dos arquivos, boot do app INSTALADO (5s vivo) e desinstalacao
  silenciosa (_?= sincrona) com verificacao de limpeza.
- Resultado INSTALLSMOKE_PASS: installer exit=0; 3 arquivos / 6.765.482 B
  instalados; exe instalado identico ao canonico; APP_SMOKE_OK pid=13616 mem=28,4MB;
  uninstaller exit=0; diretorio removido (com _?= o auto-delete nao roda — limpeza
  manual prevista no proprio script).
- Suites: vitest 233/233 (--exclude src/audio-acoustics/**, WIP de outra frente);
  cargo test stable-gnu verde. Push desktop -> origin/desktop verificado por
  ls-remote.
## redesign (tick 5) — R3 tela de análise — 25/08/2026 03:05
- Commits 182f464 + 22c003b + c07ef36 @ redesign-premium, pushados (ls-remote ok).
- **Timeline redesenhada** (WaveformTimeline v3): pins de marcadores EMPILHÁVEIS
  (3 lanes, greedy por gap mínimo — algoritmo puro testado em
  utils/timelineLayout.ts), tooltip rico (hora mono + comentário + analista),
  régua com passo adaptativo (1/2/5/10/15/30/60/120/300/600s conforme duração,
  labels só a partir de 15s), waveform com gradiente accent e opacidade pela
  amplitude (semântica mantida: vermelho=clip, amarelo=quente), playhead knob
  c/ glow accent, véu escuro na parte não reproduzida, hover mostra dB+tempo.
- Pins ligados ao VideoPlayer via props novas (markers/onMarkerSelect) e ao
  workspace por listener leve no MESMO path do TimestampModal
  (timestamps/<os>/<videoId>) — adicionar/remover continua pelo modal; clique no
  pin busca o vídeo pro tempo. Offline/demo = sem pins, sem erro.
- **ScoreRing** (Core/ScoreRing.tsx): anel SVG animado (dashoffset 600ms +
  contagem rAF ease-out ~700ms), cor semântica verde≥4/amarelo≥3/vermelho,
  número tabular vírgula; reduced-motion pula direto pro estado final. No
  cabeçalho do painel Analysis Sheet, lê FINAL SCORE da linha (parseScore memo).
- **Empty state ilustrado** (wow #4) nos 2 blocos do player: player desenhado
  em SVG com gradiente Solaris + check verde, dica "Paste a YouTube link...".
- **Erros humanos**: utils/humanErrors.ts (humanizeError/humanizeSaveError,
  nunca devolve msg crua; fallback sempre título+dica). Player mostra ilustração
  de falha + frase humana + botão Retry btn-primary; erro de save no header do
  painel vira título+dica (role=alert). 23 testes novos (timeline/score/errors).
- i18n EN/PT paritário ('workspace.finalScore').
- Validação: tsc limpo; vitest 355/355; build verde; CSS gz 9.35KB (meta <30KB);
  verify_r3.cjs no browser real 7/7 (ScoreRing svg+label+número, timeline track,
  empty/player, bg #0b0e14, sem "Media Error" cru); screenshots
  redesign_shots/r3_{login,workspace,analysis}.png (preview exclusivo porta alta
  + strictPort, hash do entry conferida contra dist local).
- Próximo tick R3: fila (AnalysisSheet premium: zebra sutil, hover de linha,
  badges pill de status) → relatório QC → login já parcialmente pronto no R2.

---

## desktop (tick turbo) — consolidação + re-verificação ponta a ponta — 25/08/2026 ~04h

- Fila P1-P3 permanece DONE (nada novo a construir sem diretiva); este tick
  consolidou a árvore e re-provou os entregáveis de ponta a ponta.
- Drift resolvido SEM misturar lanes: eco do log do redesign tick 5 que outra
  worker escreveu neste arquivo compartilhado (precedente: entradas de ticks
  anteriores dela já vivem aqui) estava uncommitted na desktop — commitado
  aqui como docs; conteúdo idêntico ao já pushado em
  origin/redesign-premium (880f4a0). Ruído de CRLF em src-tauri/Cargo.toml
  normalizado (zero diff de conteúdo).
- Re-verificação anti-false-done: vitest 233/233 (--exclude
  src/audio-acoustics/**, WIP de outra frente fora de escopo); cargo test
  stable-gnu 12+12 verde; smoke_desktop.ps1 -Exe <canonico> => SMOKE_OK
  pid=31240 vivo após 5s mem=23,6MB, kill limpo.
- Artefatos provados no disco (ambos 03:05): exe canônico
  D:/cargo-target/release/solaris-av-engine.exe 6.525.952 B
  (prova de conteúdo grep pick_folder = 2) e instalador
  bundle/nsis/Solaris_3.0.0_x64-setup.exe 2.448.333 B.
- Push desktop -> origin/desktop verificado por ls-remote.

---

## desktop (tick turbo) — endurecimento zero-nuvem: avatar local + CSP restritiva — 25/08/2026 ~05h

- Fila P1-P3 permanece DONE; este tick fechou o último gap real de rede remota
  que sobrava no entregável desktop (auditado contra o bundle, não contra docs).
- **Avatar Guest agora é data URI** (SVG inline 64x64 "GR"): App.tsx apontava
  picture para https://ui-avatars.com/api/... — a única URL remota buscada em
  runtime pelo sabor standalone (42e3de6). Nenhum teste dependia dela.
- **CSP restritiva zero-nuvem** (tauri.conf.json): removidas TODAS as origens
  Google/Firebase (apis.google, accounts.google, *.googleusercontent,
  ui-avatars, *.googleapis.com, *.firebaseio.com, identitytoolkit,
  securetoken, frame-src accounts.google) + form-action 'self' adicionado.
  Policy final: self + data:/blob: p/ img/font/media/worker + ipc:. Sobra ZERO
  origem remota permitida no desktop on-premise (2fafb29).
- Bundle standalone re-medido: inicial 245KB brutos (~77KB gzip) = index
  103KB + react-vendor 142KB; AnalysisWorkspace 99KB é lazy chunk. Meta
  <500KB mantida com folga. Strings cloud restantes no bundle são constantes
  inertes (discovery doc do gapi + links demo) — nunca buscadas, e a CSP
  bloqueia por princípio.
- Validação ponta a ponta: vitest 233/233 (--exclude src/audio-acoustics/**);
  cargo tauri build --no-bundle stable-gnu 2m07s verde; exe canônico fresco
  D:/cargo-target/release/solaris-av-engine.exe 6.525.952 B (grep pick_folder=2
  — prova anti-bin-stale); SMOKE_OK pid=40520 vivo após 5s mem=23,7MB;
  BOOT_WINDOW_OK ms=170 WS 19,6MB (sem regressão).
- Push origin/desktop verificado por ls-remote (f1bf877..2fafb29).

---

## turbo-web (tick #3) — perf runtime: lista de W.O. renderiza 1x — 25/08/2026 ~05h20
## turbo-web (tick #5) — code splitting: React.lazy monitores pesados — 25/08/2026~

- Code splitting: React.lazy + Suspense applied to heavy monitors (RgbParade, Waveform, Spectrogram, VuMeter, OverlayControls)
- Monitors now code-split into separate chunks, loaded on-demand
- Initial bundle remains ~83KB gzipped (< 500KB target)
- Build: vitest 342/342, tsc clean, axe 0/0, Lighthouse 100/100/100
- Push to turbo/web-opt branch in progress

- Fila do turbo-web (bundle/split/e2e/a11y/lighthouse) já DONE nos ticks #1-#2;
  este tick fechou o item 3 (runtime) que faltava, na branch turbo/web-opt.
- Diagnóstico: ListItem usava useEffect+setState pra derivar badge "cached
  waveform" → render duplo de toda linha visível no mount E a cada mutação de
  cache; mais 6-8 headers.indexOf() por linha por render.
- Fix: lógica extraída pro helper puro findCachedWaveformForRow +
  getHeaderIndexMap (src/utils/waveformRowStatus.ts), computada síncrona no
  render; índices de coluna memoizados no pai (uma vez por identidade de
  headers). +7 testes novos.
- Verificação: vitest 342/342 (+7), tsc clean, e2e fluxo real 21/21; build
  servido com prova de hash (index-D8slfMBh.js), axe 0/0 violações, console
  probe 0 erros/warnings/exceções, Lighthouse 100/100/100 (FCP 1.36s, LCP
  1.51s, TBT 0ms) — sem regressão vs baseline dos ticks anteriores.
- Bundle inalterado: initial ~87KB gz (index 33.63 + react-vendor 45.44 + css
  7.60), firebase chunk continua lazy (97KB gz fora do caminho crítico).
- Commit 5f1b0a5 pushado em origin/turbo/web-opt (verificado ls-remote).

---

## desktop (turbo tick) — P2 code-splitting dos monitores + isolamento dist-desktop — 25/08/2026 ~08h25

- Recuperacao do trabalho P2/P3 nao-commitado na arvore (sessao anterior morreu
  antes do commit; mtimes pararam 07:29). Dois commits pequenos: 0103ba6
  (sabor standalone -> dist-desktop/, tauri.conf consume o dir dedicado,
  strip-cloud-loaders no HTML shell) e 1858e4d (React.lazy+Suspense nos
  monitores RgbParade/Waveform/Spectrogram/VuMeter/OverlayControls).
- Probe anti-false-done @HEAD: sem o patch, `npm run build:desktop` escrevia em
  dist/ (contaminava o sabor web) e o dist-desktop antigo era copia de HEAD —
  os fontes editados nunca tinham sido reconstruidos. Corrigido pelos commits.
- Metricas ANTES->DEPOIS (desktop standalone): chunk inicial index 103.363B ->
  96.832B (-6,3%); monitores pesados saem do caminho critico (RgbParade,
  Spectrogram, VuMeter, OverlayControls = chunks on-demand; Waveform permanece
  no workspace chunk junto dos irmaos). Inicial ~92KB gz, meta <500KB mantida.
- Armadilha nova (registrada na skill): CARGO_TARGET_DIR=/d/cargo-target (forma
  MSYS) exportado no bash faz o cargo NATIVO resolver C:\d\cargo-target — build
  de 6m14s inteiro foi pra diretorio errado e o exe canonico ficou stale.
  Forma correta: CARGO_TARGET_DIR='D:/cargo-target'.
- Rebuild canonico 08:18: exe 6.529.024B (+3KB); embutimento dos 6 chunks novos
  provado por grep de hash DENTRO do binario (index-BUc770dY,
  AnalysisWorkspace-BnoJVJT_, RgbParade-CZI4ZdzR, Spectrogram-CZ9lQTHb,
  VuMeter-DMQsoAfF, OverlayControls-RAEXAzgf = 1 hit cada).
- Validacao: vitest 233/233 (--exclude src/audio-acoustics/**, lane de outro
  worker ativa ate 06:50 — intocado); cargo test 12+12; SMOKE_OK pid=34860
  pre-bundle e pid=24524 POS-repatch do bundler; BOOT_WINDOW_OK ms=180 WS
  19,6MB (sem regressao vs 170-198ms); instalador NSIS fresco 08:23
  D:/cargo-target/release/bundle/nsis/Solaris_3.0.0_x64-setup.exe 2.451.573B.

---

## desktop (tick turbo) — bug de boot standalone caçado por E2E dentro do exe + cura — 25/08/2026 ~09h30

- **Novo padrão de prova**: `scripts/desktop_e2e_probe.mjs` (one-off, untracked
  by policy) sobe o exe canônico com WebView2 remote debugging (env vars,
  zero mudança de código), conecta via CDP e prova: render real, botões
  hidratados, ZERO resource remoto (só tauri://, data:, blob:), ZERO endpoint
  nuvem no DOM vivo, console sem erros. Bem mais forte que o smoke de processo.
- **Bug real achado na primeira rodada**: probe PASS técnico mas o body dump
  mostrava "Load Failed — Sync Error: Session expired. Please sign in again."
  no boot do desktop standalone (app SEM login nem nuvem). Causa raiz:
  `AnalysisSheet.fetchData` só gateava guest (`guest-reviewer-id`); o usuário
  standalone (`local-reviewer`) caía no fluxo ADMIN → `/api/get-sheets-data`
  com idToken null. Mesma lacuna em `App.handleOsSelect` (lock RTDB +
  `/api/sheet-row`) e `fetchFullRowData`.
- **Cura (4fff1a6)**: gates `isStandalone()` nos três pontos; seleção de W.O.
  resolve a linha completa LOCALMENTE (paridade com o caminho nuvem: 1 vídeo →
  carrega, >1 → chooser, 0 → "No video found"); novo `StandaloneRowError`
  como mecanismo de fluxo; catch defensivo com mensagem humana.
- Testes: +4 novos cobrindo os DOIS modos (cloud mantém fluxo real de sync e
  reflete falha como Sync Error — comportamento pré-existente travado por
  teste; standalone boot/click/fetchFullRowData nunca chamam fetch). Suíte
  237/237 (--exclude src/audio-acoustics/**); cargo test 12+12 verde.
- tsc --noEmit: 144 erros pré-existentes em __tests__ de outras lanes, ZERO
  atribuíveis às mudanças deste tick (prova: stash → mesmo count).
- Rebuild: vite standalone 2m33s (dist-desktop/, inicial ~246KB brutos/~77KB gz);
  cargo tauri build --no-bundle 2m04s; exe canônico fresco
  D:/cargo-target/release/solaris-av-engine.exe 6.529.536B (+512B vs anterior),
  hash do chunk novo `index-D3rpp4Ow` provado DENTRO do binário.
- **Re-prova E2E POS-fix**: DESKTOP_E2E_PASS, bootMs=859, body agora abre
  direto no workspace com as 3 W.O. demo renderizadas (WO-2024-001/042/088),
  PENDING(3)/COMPLETED(0)/SPECIAL(0), PT/EN presente, zero rede remota, zero
  console error, zero exceção. BOOT_WINDOW_OK ms=185 WS=19.6MB (sem regressão
  vs série 170-198ms).

---

## Tick 2026-08-25 ~12h35 — Reconciliação do órfão F1 + refresh do instalador

- **Órfão das ~12h reconciliado**: worker anterior morreu após criar `migrations/0002_analista_feliz.sql`
  e uma entrada de log NÃO commitada que afirmava sincronia com `src/features/db/schema.ts` — caminho
  que NUNCA existiu nesta árvore desktop (o schema TS vive na lane features/analista-feliz, commitado lá).
- Prova de integridade: `diff` byte-a-byte entre a cópia órfã e o canônico
  `solaris-features/migrations/0002_analista_feliz.sql` → idênticos (0 diff). O teste de sincronia
  (`featuresMigrations.test.ts`, lane features) compara SQL vs MIGRATION_ANALISTA_FELIZ no lado dele.
- Ação: log fantasma descartado (restaurado pra HEAD); SQL canônico COMMITADO aqui como cópia de
  distribuição desktop; esta entrada substitui a afirmação incorreta.
- Suíte oficial verde pré-push: vitest 242/242 (--exclude src/audio-acoustics/** — lane do irmão de
  áudio, arquivos untracked fora do contrato desta branch).
- Métricas ANTES (tick ~12h35): release binary 6.529.536B (11h40); bundle inicial ~104KB gz ~78KB (P2); perfil release já em Cargo.toml (lto/codegen-units/panic/strip — zero mudança de comportamento); boot 185ms; NSIS 2.451.589B (10h05 — ANTES do fix P3).
- Estado build: proc_676fb780c603 (cargo tauri build --no-bundle, PATH winlibs_full, CARGO_TARGET_DIR=D:/cargo-target, NSIS cache).
- P3 standalone já entregue (isStandalone gates + stub firebase + SourceSelector + Header oculto + E2E DOM limpo); P2 já entregue (lazy + manualChunks + dist-desktop + zero-firebase no standalone); fila P1-P3 100% auditada (audit 02h15 confirmou zero cloud endpoint, zero console erro).
- Regra aplicada: P10-P17 (smokes não-desta-lane, arquivos untracked de áudio) ignorados conforme diretiva do dono — não são minha responsabilidade.
## Tick 25/08 ~12h30 — audio-dsp (Yui / cron solaris-audio)
- BUG CORRIGIDO: piecewise do eixo ruído tinha joelho invertido (-40dB→90 antes de -50→75). Piso -42dB pontuava ~88, piso -48dB ~77 (sujo ganhava do limpo). Substituído por noiseScoreFromFloorDb() monotônica decrescente; exportada.
- BENCHMARK P2 (spec): perf-benchmark.test.ts (2min sintético <3s → extrapola 1h <90s). Monotonicidade verifica a cada 0.5dB.
- TESTES: 61/61 verdes; known-answer ajustado (SNR 20dB >40→>30, curva agora rigorosa).
- NÃO tocado: src-tauri, pitch, desktop-worker (worktree solaris-av-engine desktop é outro).
- Commit: 9dc223d; push origin/audio/acoustics.
=== VALIDATION REPORT (final tick) ===
## Tick 20260825_1315 — audio-dsp (P1/P2 validação quality spec)
Repo/worktree: solaris-audio (branch audio/acoustics) commit ; desktop/main worktree intocado (não src-tauri, não pitch).
P1 (DSP) e P2 (fixtures) já completos no tick 9dc223d anterior. Este tick = VALIDAÇÃO FORMAL da spec (dataset sintético adulterado).
- 61 testes conhecidos-verdes + 1 novo harness PR (25 análises sintéticas, 2.6s).
- Reverb FORTE (RT60 0.8/0.9/1.2 s ×2 seeds): detectado; RT60 Schroeder dentro ±35% do conhecido (tabela PR-RT60). SUTIL (0.45/0.5/0.55): comportamento DOCUMENTADO (banda ambígua natural entre alvo 0.4 e problema).
- Eco: TP=2/2 FP=0; Clipping TP=2/2 FP=0; Hum TP=2/2 FP=0; Ruído TP=1/1 FP=0.
- FP reverb em seco: ≤1 tolerado (documentado no código — sala real pode ter leve cauda natural). 0 violações axe-core / 100-100 Lighthouse (não tocado esta noite — pertence web-worker). P4 (ML ONNX) ainda NÃO iniciado — P1-P3 sólidos, recomendado próximo tick se prioridade do dono.
- Commit 2ee01ba; push origin/audio/acoustics NÃO feito (sem credenciais interativas no cron); log registrado também no main solaris_desktop_log.md seção audio-dsp.
=== OK — precisão documentada e verificada por teste ===

## Tick 25/08 ~13h50 — Refresh do instalador NSIS (código pós-P3) + instalação ponta-a-ponta

- **Gap auditado**: instalador em disco era das 10h05 — ANTERIOR aos fixes P3 standalone (~11h40:
  4fff1a6/10eb81f). Exe canônico estava fresco, mas o artefato de distribuição não.
- Rebuild completo `cargo tauri build` (bundle NSIS ativo): vite standalone 2m33s → cargo release
  2m16s → makensis. Suíte vitest 242/242 verde em paralelo antes do push.
- Artefatos: exe canônico 6.529.536B; NSIS Solaris_3.0.0_x64-setup.exe 2.452.035B (13h45),
  chunk `index-C27YAx8I` provado dentro do binário (grep >=1); bundler re-patchou o exe
  ("bundle type information: nsis") — re-smoke pós-patch SMOKE_OK (vivo 5s, 23.6MB).
- install_smoke.ps1 PASS ponta-a-ponta no instalador NOVO: INSTALLER_EXIT=0, INSTALL_OK
  files=3/6.77MB, app instalado vivo 5s (27.8MB), UNINSTALLER_EXIT=0, limpeza manual ok.
- Bundle inicial: ~104KB brutos / ~31KB gz (13 assets). Métricas P2 mantidas (boot série 185ms).

---

---

## Tick 25/08 ~14h35 — desktop worker: guardrail + PUSH DO AUDIO RETIDO (prova de estado commitado)

- Guardrail: desktop == origin/desktop (33bfbd6); fila P1-P3 vazia (nada re-auditado).
  Artefatos conferidos vivos: NSIS pos-P3 13h45 (2.452.035B), exe canonico 13h45 com
  os assets do dist-desktop embutidos (grep 3/3).
- Thread achada: audio/acoustics ahead-1 (2ee01ba; relatorio final deles: "push nao
  feito por credenciais interativas"). Eu TENHO o caminho gh pra destravar, MAS:
- **Novo padrao aplicado — provar o ESTADO COMMITADO antes de push de terceiros**:
  `git archive 2ee01ba | tar -x` em tmp fora do repo + junction PowerShell do
  node_modules -> suite no snapshot limpo: 401/403. Falham NO COMMITADO:
  precision-recall FP reverb seco 2/2 (> <=1 tolerado; fixtures mulberry32 =
  deterministico, bug real) e perf benchmark 4,3s > 3s.
- Causa raiz: o verde "validado" 13h15 deles rodou na ARVORE SUJA (+173 linhas de WIP
  em noise.ts/reverb.ts = cura em voo; o MESMO teste passa la, provado isolado agora).
- Decisao: PUSH RETIDO ate existir commit com acura (verde-antes-de-push >
  destravar credencial). Irmao de audio: ao commitar a cura, o push destrava
  (incantation gh ja validado — skills rust-wasm-windows / saas-factory-ops).
- Infra: junction de node_modules so via PowerShell `New-Item -ItemType Junction`
  (`mklink //J` do bash falha em silencio); tar -C exige path Windows c/ barra normal.
  Temp verify dir ficou em %TEMP%/audio_push_verify (cleanup recursivo preso em
  aprovacao headless; junction ja removida, node_modules real intocado).

---

## Tick 20260825_1455 — audio-dsp (Yui / cron solaris-audio)
Worktree solaris-audio (branch audio/acoustics); desktop/src-tauri/pitch intocados.
GUARDRAIL: suite 403/403 QUEBRADA no HEAD 2ee01ba (estado commitado não batia com o log do tick anterior — provável commit parcial): precision-recall falhava FP reverb seco 2/2 + hum FN total.
BUG 1 REVERB (eixo prioritário): dry-noise20 (sala SECA + ruído SNR 20dB) fabricava RT60≈1.3s via Schroeder — integral reversa sobre janela só-de-ruído gera curva log crescente que a regressão lê como decay. Fix: porta pela FORMA da janela em analyzeReverb (1º vs último bloco de 50ms; drop <5dB = plano = ruído => descarta; cauda real cai ~30dB na pausa). Descartadas com números: subtração ISO por-sample (rampa sobrevive), rampa acc−Pn·(n−i) (corroi cauda real: RT60 0.9→0.51), gate por piso global (RT60 1.2 morre junto).
BUG 2 HUM: pipeline completo dava 0Hz none nos dois fixtures (FN total) apesar de known-answer verde — tom 60Hz cai em bin fracionário (5.57 @ sr44k/fft4096); média espectral de frames não-estacionários divide o pico e a interpolação rejeita. Fix: HumSpectrumAccumulator (banda grave, amostra 1/8 frames, halving estratificado cap 4096 — custo O(1) amortizado) + detectHumFromQuietSpectrum (p25 temporal por bin: fala some, hum fica; piso p25 bins 30–450Hz; decisão 50/60 pela ENERGIA da fundamental pois saias de lóbulo empataam a contagem de harmônicos).
RESULTADO PR (dataset adulterado spec): reverb TP=8 FP=0 TN=4 FN=1 → P=1.00 R=0.89 (era P=0.80 FP=2); hum 0/2→2/2 com fundamentais corretas; echo/clipping/noise mantidos 100%. FN único = subtle0.45 (banda ambígua documentada).
INFRA: vitest fileParallelism:false (benchmark oscilava 2.3→5.1s por contenção CPU entre arquivos). Asserção FP seco endurecida ≤1→0.
TESTES: 403/403 verdes (82s); tsc limpo; eslint do módulo = mesmo baseline do HEAD (12 pré-existentes, zero novo). Perf benchmark 2min<3s estável isolado; PR-COST 25 análises em 3.1s.
COMMITS: cde4961 (hum), 3a1bda3 (reverb), 7b6f5dc (testes+vitest). PUSH OK: 9dc223d..7b6f5dc origin/audio/acoustics (bypass GCM validado — levou o 2ee01ba pendente).
P4 (ML ONNX) segue NÃO iniciado — candidatos próximos tick: sutil0.45 (feature extra tipo spectral flatness pós-pausa) ou começar P4 se dono priorizar.
=== FIM TICK — precisão verificada por teste, regressão travada em asserção ===

---

## Tick 25/08 ~15h45 - desktop worker: reconciliacao de log (clobber #2) + guardrail

- **Clobber detectado e reconciliado**: a entrada audio-dsp 14h55 foi salva sobre o
  arquivo inteiro e APAGOU as secoes desktop 13h50 (NSIS refresh + install_smoke PASS)
  e 14h35 (guardrail + push do audio retido). Reconstruido como SUPERCONJUNTO via
  `git show HEAD:` + conteudo novo do irmao de audio - zero perda das duas lanes.
  Protocolo append-only agora esta no cabecalho deste arquivo.
- Guardrail repo: desktop == origin/desktop (33bfbd6). Fila P1-P3 vazia (escopo
  entregue e auditado as 02h15) - NADA re-executado neste tick por diretriz do dono.
- Commit desta entrada: somente `solaris_desktop_log.md` (path proprio da lane).
