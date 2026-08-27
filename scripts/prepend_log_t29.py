# Tick #29 redesign: prepend da entrada do tick no topo do log compartilhado.
# Um modo so: le tudo, transforma, grava de volta (licao do bug append do W2-CIGATE).
import sys

ROOT = r"C:\Yui\data\saas\solaris-redesign"
PATH = ROOT + r"\solaris_desktop_log.md"

ENTRY = """## redesign (t29) — turbo #26 absorvido + regates — 26/08/2026 ~05h58

- **Auditoria**: spec SOLARIS_REDESIGN.md intacta; R1-R4 + wows seguem DONE.
  Unico delta: origin/main avancou 1 commit (7667657 = turbo-web #26, guardrail
  noturno docs-only). Worktree limpo ao abrir o tick.
- **Fusao**: merge 5cfe4ae absorveu origin/main. Conflitos triviais: relatorios
  regeneraveis (axe/lh-r1/lh-r2 -> --ours e REGENERADOS neste tick) e bloco de
  topo do log compartilhado (t28 primeiro, turbo #26 depois; parser linha-a-linha
  scripts/resolve_merge_t29.py — separador do git tem EXATAMENTE 7 '=', regex
  DOTALL comeu o miolo do arquivo na primeira tentativa). Codigo de app intocado.
- **GATES pos-merge** (build fresca da lane): tsc --noEmit limpo; vitest
  **403/403** (38 arquivos); e2e fluxo real **21/21**; build verde byte-estavel
  — entry **index-CHKfTLey.js**, INITIAL **46,89KB gz** + CSS index-C1l8F6-j
  **9,79KB gz** (<30KB alvo ok, ~3x folga); firebase lazy 94,82KB fora do
  caminho critico; TOTAL 1128,34KB raw / 401KB gz. Zero re-hash vs t25/t28.
- **Browser gates** (scripts/turbo-gates.mjs): console probe **0 eventos**;
  LH x2 **P99/A100/BP100** (FCP 1,5s LCP 1,8s CLS 0,001 TBT 0ms).
- **axe-core regenerado NA ARVORE MESCLADA** (scripts/axe-scan.mjs):
  login **0** / main app **0** / criticalOrSerious **0**
  (identidade provada entry index-CHKfTLey == dist).
- Shots de aceite regenerados ->
  C:/Yui/data/saas_factory/redesign_shots/r29_merge_{fila,analysis,qc_dialog}.png
  via scripts/redesign_shot_t25.cjs (hash do entry conferido antes de cada captura).
- src-tauri/audio-acoustics/pitch intocados. Fila R1-R4 segue DONE aguardando
  diretiva do dono. Sem Telegram.

"""

with open(PATH, "rb") as fh:
    old = fh.read()
text = old.decode("utf-8")
if "## redesign (t29)" in text:
    print("FAIL: entrada t29 ja existe")
    sys.exit(1)
new = ENTRY.encode("utf-8") + old
with open(PATH, "wb") as fh:
    fh.write(new)

check = open(PATH, "rb").read().decode("utf-8")
assert check.count("## redesign (t29)") == 1
assert check.count("## Tick #26") == 1
print("log prepended ok:", len(check.splitlines()), "linhas")
