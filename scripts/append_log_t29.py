# turbo-web tick #29 - prepend log entry at top (single read/transform/write-back)
# ASCII-only script; inserts after the FIRST line regardless of its content.
import io

PATH = r"C:\Yui\data\saas\solaris-web-turbo\solaris_desktop_log.md"

ENTRY = """## Tick #29 26/08 ~08h30 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD aedb89b == origin/main provado pos-fetch/ls-remote; CI remoto
  success no sha aedb89b. Branches pendentes re-auditadas: v2-upgrade,
  v2-upgrade-recovery e turbo/web-opt TODAS contidas em main (0 ahead) -
  nada a sincronizar de nenhuma lane. Zero deltas.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 31 arquivos /
  342/342 (~34s); e2e fluxo real (YouTube -> scoring -> fila -> export QC) 21/21;
  axe-core 0 violacoes ({loginRules:0, mainAppRules:0, criticalOrSeriousMainApp:0});
  console probe 0 eventos; Lighthouse x2 (--headless=new --disable-gpu): R1 e R2
  ambos P100/A100/BP100 (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms).
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#28 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,60KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do
  caminho critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate
  18,49 KB gz. Alvo initial <500KB gz mantido com folga (~12x).
- Higiene da PROPRIA lane: removido scripts/lh_report.mjs (morto desde o tick 1:
  require() dentro de .mjs, porta fixa 5173, URL errada /dist/index.html,
  hardcode 177KB pre-splitting, zero referencias em qualquer script/log);
  adicionado run_build_t29.mjs (npm run build via execSync - protocolo
  anti-falso-positivo do foreground guard).
- Deps: npm audit --omit=dev segue 10 moderates major-gated (0 high/critical),
  sem advisory nova desde o tick #12.
- Higiene geral: zero orfaos da lane - so ContractKit (:4179, work_ck_repo) e
  Hein/Zimny (:4188, Hein-Esthetics), atribuidos por PATH+porta e POUPADOS
  (Hein intocavel sem ordem explicita do Zee). src-tauri/pitch intocados (do
  outro worker); suite commitada segue valendo. Sem Telegram.
"""

with io.open(PATH, "r", encoding="utf-8", newline="") as f:
    txt = f.read()

nl = txt.find("\n")
assert nl != -1, "no newline found"
insert_at = nl + 1

entry_norm = ENTRY.rstrip("\n").replace("\n", "\r\n")
new_txt = txt[:insert_at] + "\r\n" + entry_norm + "\r\n" + txt[insert_at:]

assert new_txt.count("## Tick #29") == 1, "entry duplicated?"
assert len(new_txt) == len(txt) + len(entry_norm) + 4, "unexpected size delta"

with io.open(PATH, "w", encoding="utf-8", newline="") as f:
    f.write(new_txt)

print("ok - prepended tick #29")
