# turbo-web tick #30 - prepend log entry at top (single read/transform/write-back)
# ASCII-only script; inserts after the FIRST line regardless of its content.
import io

PATH = r"C:\Yui\data\saas\solaris-web-turbo\solaris_desktop_log.md"

ENTRY = """## Tick #30 26/08 ~09h20 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD 2379323 == origin/main provado pos-fetch; rev-list 0/0 nos dois
  sentidos. Branches pendentes re-auditadas: v2-upgrade, v2-upgrade-recovery e
  turbo/web-opt TODAS contidas em main (0 ahead). Lanes irma desktop
  (+69), audio/acoustics (+37), features (+56) e redesign (+64) seguem nas
  PROPRIAS linhas (padrao conhecido, nada a sincronizar). Unico extra vs main:
  develop +1 = commit do PROPRIO dono "Update README.md" (bd3a560, 01/02) -
  conteudo de README, nao trabalho de lane. CI remoto success no sha 2379323.
  Zero deltas.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 31 arquivos /
  342/342 (~14s); e2e fluxo real (YouTube -> scoring -> fila -> export QC)
  21/21; axe-core 0 violacoes ({loginRules:0, mainAppRules:0,
  criticalOrSeriousMainApp:0}); console probe 0 eventos; Lighthouse x2
  (--headless=new --disable-gpu): R1 e R2 ambos P100/A100/BP100 (FCP 1,4s /
  LCP 1,5s / CLS 0,000 / TBT 0ms).
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#29 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,60KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do
  caminho critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate
  18,49 KB gz. Alvo initial <500KB gz mantido com folga (~12x).
- Quirk novo documentado: cadeia de gates em background=true falha aqui com
  exit 1 e saida vazia/"stdin is not a tty" no PRIMEIRO passo que usa
  execSync/preview (chunk_report/axe/turbo-gates) - os MESMOS comandos passam
  100% em foreground individual. Causa provavel: stdio herdado da sessao bash
  background desta caixa. Workaround adotado: gates longos em foreground com
  timeout alto; se voltar a acontecer, testar < /dev/null + setsid antes de
  culpar o gate.
- Deps: sem advisory nova desde o tick #12 (10 moderates omit-dev seguem
  major-gated, 0 high/critical).
- Higiene geral: zero processos vite <1h na maquina (probe por CreationDate);
  orfaos pre-existentes de OUTRAS lanes intocados. src-tauri/pitch intocados
  (do outro worker); suite commitada segue valendo. Sem Telegram.
"""

with io.open(PATH, "r", encoding="utf-8", newline="") as f:
    txt = f.read()

nl = txt.find("\n")
assert nl != -1, "no newline found"
insert_at = nl + 1

entry_norm = ENTRY.rstrip("\n").replace("\n", "\r\n")
new_txt = txt[:insert_at] + "\r\n" + entry_norm + "\r\n" + txt[insert_at:]

assert new_txt.count("## Tick #30") == 1, "entry duplicated?"
assert len(new_txt) == len(txt) + len(entry_norm) + 4, "unexpected size delta"

with io.open(PATH, "w", encoding="utf-8", newline="") as f:
    f.write(new_txt)

print("ok - prepended tick #30")
