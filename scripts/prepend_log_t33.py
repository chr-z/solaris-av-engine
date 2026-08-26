#!/usr/bin/env python3
"""t33: prepend redesign entry at the top of the shared log (newest first)."""
import io

P = r"C:\Yui\data\saas_factory\solaris_desktop_log.md"

ENTRY = """## redesign (t33) \u2014 turbo #30 absorvido + regates \u2014 26/08/2026 ~09h55\r
\r
- **Auditoria**: spec SOLARIS_REDESIGN.md intacta; R1-R4 + wows seguem DONE.\r
  \u00danico delta: origin/main +1 (64d90d5 = turbo-web #30, guardrail noturno\r
  docs-only: log + relat\u00f3rios regener\u00e1veis). Worktree limpo ao abrir o tick;\r
  lane == origin/redesign-premium (85f3d21).\r
- **Fus\u00e3o**: merge 0ea9b68 absorveu origin/main. Conflitos triviais:\r
  relat\u00f3rios regener\u00e1veis (axe/lh-r1/lh-r2 -> --ours e REGENERADOS neste\r
  tick); log compartilhado auto-mesclado (bloco do turbo #30 ap\u00f3s o t32).\r
  C\u00f3digo de app intocado (diff do merge = scripts do turbo + log).\r
- **GATES p\u00f3s-merge** (build fresca da lane): tsc --noEmit limpo; vitest\r
  **403/403** (38 arquivos); e2e fluxo real **21/21**; build byte-est\u00e1vel \u2014\r
  entry **index-CHKfTLey.js** 38,09KB gz + CSS index-C1l8F6-j **10,12KB gz**\r
  (alvo <30KB ok); firebase lazy fora do caminho cr\u00edtico. Zero re-hash vs\r
  t25/t28/t29/t30/t31/t32.\r
- **Browser gates** (scripts/run_gates_t30.sh): console probe **0 eventos**;\r
  LH x2 **P99/A100/BP100** (FCP 1,5s / LCP 1,8s / CLS 0,001 / TBT 0ms);\r
  axe-core regenerado NA \u00c1RVORE MESCLADA (scripts/axe-scan.mjs): login n/a\r
  (build demo sobe direto no app por design p\u00f3s-t24) / main app **0** /\r
  criticalOrSerious **0**.\r
- Shots de aceite regenerados ->\r
  C:/Yui/data/saas_factory/redesign_shots/r33_merge_{fila,analysis,qc_dialog}.png\r
  (PIL dark 97,9/95,9/96,1%, stdev 19,3-29,7 \u2014 perfil visual == r29..r32).\r
- src-tauri/audio-acoustics/pitch intocados. Fila R1-R4 segue DONE aguardando\r
  diretiva do dono. Sem Telegram.\r
\r
"""

with io.open(P, "r", encoding="utf-8", newline="") as f:
    txt = f.read()

marker = "## redesign"
idx = txt.find(marker)
assert idx != -1, "secao redesign nao encontrada"

new = txt[:idx] + ENTRY + txt[idx:]
with io.open(P, "w", encoding="utf-8", newline="") as f:
    f.write(new)

# sanity: exactly one t33 header, section order preserved
assert new.count("## redesign (t33)") == 1
assert new.count("## redesign") == new.count("\n## redesign") + new.startswith("## redesign")
print("ok: t33 prepended, file", len(new), "chars")
