# turbo-web tick #27 — append log entry with EOL detection (pure append)
import io

PATH = r"C:\Yui\data\saas\solaris-web-turbo\solaris_desktop_log.md"

ENTRY = """## Tick #27 26/08 ~06h20 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD 7667657 == origin/main provado por rev-parse pos-fetch --prune;
  turbo/web-opt segue reliquia (0 ahead); develop relic fev/2026 (README bd3a560);
  NOVA branch remota auditada este tick: v2-upgrade-recovery CONTIDA em main
  (0 ahead) - nada a sincronizar de nenhuma lane. Zero deltas.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 31 arquivos /
  342/342 (~25s); e2e fluxo real (YouTube -> scoring -> fila -> export QC) 21/21;
  axe-core 0 violacoes ({loginRules:0, mainAppRules:0, criticalOrSeriousMainApp:0},
  identidade provada entry index-C1mX7UAW.js == dist); console probe 0 eventos;
  Lighthouse x2 (--headless=new --disable-gpu): R1 e R2 ambos P100/A100/BP100
  (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms) = baseline mantido.
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#26 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,37KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do caminho
  critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate 18,49 KB gz.
  Alvo initial <500KB gz mantido com folga (~12x).
- Deps: npm audit --omit=dev segue 10 moderates major-gated (0 high/critical),
  sem advisory nova desde o tick #12.
- Higiene: zero orfaos da lane - so ContractKit (:4179, work_ck_repo) e
  Hein/Zimny (:4188, intocavel sem ordem explicita), atribuidos por PATH+porta e
  POUPADOS (varredura manual Win32_Process por cmdline 'vite').
- src-tauri/pitch intocados (do outro worker); suite commitada segue valendo
  (nenhum codigo mudou desde 6933b0b - commits da lane sao docs-only). Sem Telegram.
"""

with open(PATH, "rb") as f:
    data = f.read()

crlf = data.count(b"\r\n")
lf = data.count(b"\n") - crlf
if crlf > lf:
    eol, label = b"\r\n", "CRLF"
else:
    eol, label = b"\n", "LF"
print(f"EOL detect: CRLF={crlf} LF={lf} -> using {label}")

if not data.endswith(eol):
    data += eol

data += ENTRY.replace("\n", eol.decode()).encode("utf-8")

with open(PATH, "wb") as f:
    f.write(data)

with open(PATH, "rb") as f:
    tail = f.read()[-200:]
print("tail ok:", b"Tick #27" in data and data.rstrip().endswith(b"Sem Telegram."))
