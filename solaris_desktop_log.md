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
