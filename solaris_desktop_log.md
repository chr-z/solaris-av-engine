# SOLARIS Desktop — Log de Trabalho (branch `desktop`)

> Não merge na main até o dono aprovar. Um commit pequeno por passo.
> Build Rust sempre com: toolchain `stable-x86_64-pc-windows-gnu` +
> winlibs binutils no PATH (`%LOCALAPPDATA%/Temp/winlibs_bin`) +
> `CARGO_TARGET_DIR=D:/cargo-target` (fora do OneDrive).

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
