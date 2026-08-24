# Solaris Desktop (src-tauri)

Core Rust do Solaris v3 on-premise (specs: `SOLARIS_V3_ALFRED.md`, `SOLARIS_V3_SATURNO.md`).

## Módulos
- `src/scan_alfred.rs` — varredura tolerante da RAIZ_ALFRED (ano/mês/estúdio/dia/OS-*/blocos),
  ordenação natural, vídeos soltos agrupados por janela dia+estúdio e candidatos de match
  temporal pro front resolver as camadas de confiança.
- `src/db.rs` — SQLite local (`rusqlite` bundled): cache `saturno_os_cache`, aprendizado da
  triagem em `matching_decisions` (assinatura_pasta → OS, UPSERT), auditoria em
  `matching_audit` e invariante de unicidade em `os_blocks` (PK em block_path — bloco nunca
  em duas OSs).
- `migrations/0001_saturno_matching.sql` — schema idempotente versionado em `_migrations`.

## Comando Tauri
```rust
scan_alfred_command({ root, max_depth?, declared_os_paths? })
// → { report: { oss[], orphan_groups[], window_matches[] } }
```

## Status de build
Toolchain Rust + MSVC Build Tools não estavam disponíveis na máquina de desenvolvimento
deste tick. Os testes unitários dos módulos (`cargo test`) foram escritos e estão prontos;
**não foram executados ainda**. Primeiro passo do próximo tick com toolchain:
`cargo test` dentro de `src-tauri/`. A suíte TS (Vitest) que cobre normalizador Saturno e
matching em camadas ESTÁ verde (ver `solaris_desktop_log.md`).

## Segurança
- Leitura-only no filesystem; allowlist fs limitada à RAIZ_ALFRED configurável.
- API key do Saturno nunca logada (`sanitizeConfigForLog`); dados nunca saem da rede.
