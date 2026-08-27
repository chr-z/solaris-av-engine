#!/usr/bin/env python3
"""t18 — migração dos resíduos pré-v3 do painel ADMIN para os tokens v3.
Replaces EXATOS (single-line) com contagem esperada/imprópria; zero regex.
Filosofia: mesma anatomia/DOM/vocabulário, só acabamento."""
import sys, pathlib

ROOT = pathlib.Path("C:/Yui/data/saas/solaris-redesign/src/components/Admin")

# (file, old, new, expected_count)
EDITS = [
    # ---------- DashboardPanel.tsx ----------
    ("DashboardPanel.tsx",
     "rounded-lg border border-gray-600/60 bg-gray-800/50 px-4 py-3 min-w-[9rem]",
     "card px-4 py-3 min-w-[9rem]", 1),
    ("DashboardPanel.tsx",
     "mb-5 rounded-lg border border-gray-600/60 bg-gray-800/50 px-3 py-2",
     "mb-5 card px-3 py-2", 1),
    ("DashboardPanel.tsx",
     "mb-5 rounded-lg border border-gray-600/60 bg-gray-800/50 px-3 py-3",
     "mb-5 card px-3 py-3", 1),
    # selects/inputs de período/categoria: superfície elevada + hairline
    ("DashboardPanel.tsx",
     "border-gray-600/60 bg-gray-900/70",
     "border-hairline bg-surface-raised", 4),
    # cabeçalhos de tabela: hairline
    ("DashboardPanel.tsx",
     "text-gray-400 border-b border-gray-600/60",
     "text-gray-400 border-b border-hairline", 6),
    # linhas de corpo: hairline + hover wash (zebra fica por conta do hover sutil)
    ("DashboardPanel.tsx",
     'border-b border-gray-700/40 last:border-b-0"',
     'border-b border-hairline last:border-b-0 transition-colors"', 6),
    ("DashboardPanel.tsx",
     "border-t border-gray-700/40",
     "border-t border-hairline", 1),
    # chips de copiar código: wash + accent nos hovers (antes solar-accent cru)
    ("DashboardPanel.tsx",
     "rounded border border-gray-600/60 font-mono text-[10px] uppercase text-gray-400 hover:text-solar-accent hover:border-solar-accent",
     "rounded border border-hairline font-mono text-[10px] uppercase text-gray-400 wash-hover hover:text-accent hover:border-accent", 2),
    # segmento inativo dos toggles (compare/categoria): forma citada
    ("DashboardPanel.tsx",
     '"border-gray-600/60 text-gray-300 hover:bg-gray-500/10"',
     '"border-hairline text-gray-300 wash-hover"', 4),
    # botões ghost com prefixo "border "
    ("DashboardPanel.tsx",
     "border border-gray-600/60 text-gray-300 hover:bg-gray-500/10",
     "border border-hairline text-gray-300 wash-hover", 5),
    # fechar do toast QC (ordem diferente das classes)
    ("DashboardPanel.tsx",
     "border-gray-600/60 px-2 py-1 text-xs text-gray-300 hover:bg-gray-500/10",
     "border-hairline px-2 py-1 text-xs text-gray-300 wash-hover", 1),
    # badge de tier (linha 161): superfícies v3
    ("DashboardPanel.tsx",
     "bg-gray-800/40 text-ink-secondary border border-gray-600/40",
     "bg-surface-raised text-ink-secondary border border-hairline", 1),
    # toast QC: card-raised (fim do shadow-xl cru + bg-gray-900/95)
    ("DashboardPanel.tsx",
     "rounded-lg border border-emerald-500/40 bg-gray-900/95 px-4 py-3 text-sm text-emerald-200 shadow-xl",
     "card-raised px-4 py-3 text-sm text-emerald-200", 1),
    # ---------- AdminGate.tsx ----------
    ("AdminGate.tsx",
     "border border-gray-500 text-gray-300 hover:bg-gray-500/10",
     "border border-hairline text-gray-300 wash-hover", 1),
    # ---------- AdminRulesPanel.tsx ----------
    ("AdminRulesPanel.tsx",
     "border border-gray-500 text-gray-300 hover:bg-gray-500/10",
     "border border-hairline text-gray-300 wash-hover", 2),
    ("AdminRulesPanel.tsx",
     "border border-gray-500 text-gray-300 hover:bg-gray-500/10 text-xs",
     None, -1),  # já coberto acima (substring); só contagem esperada embutida
    ("AdminRulesPanel.tsx",
     "border border-gray-500 text-gray-300 text-sm",
     "border border-hairline text-gray-300 text-sm wash-hover", 1),
    # ---------- BugReportModal.tsx ----------
    ("BugReportModal.tsx",
     "text-gray-400 hover:text-white transition-colors",
     "text-ink-secondary hover:text-ink transition-colors", 1),
    ("BugReportModal.tsx",
     "px-4 py-2 rounded-md text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors",
     "px-4 py-2 rounded-md text-sm font-medium text-gray-300 wash-hover", 1),
    # botão enviar: verde semântico mantido, texto escuro p/ AA (precedente Salvar)
    ("BugReportModal.tsx",
     'text-sm font-bold text-white transition-all ${',
     'text-sm font-bold text-bg transition-all ${', 1),
    ("BugReportModal.tsx",
     "'bg-green-600 hover:bg-green-700'",
     "'bg-ok hover:bg-ok/85'", 1),
    ("BugReportModal.tsx",
     ": 'bg-solar-accent hover:bg-solar-accent-hover'",
     ": 'bg-solar-accent hover:bg-solar-accent-hover'", 1),  # sanity: existe e fica
    # ---------- BugReportViewer.tsx ----------
    ("BugReportViewer.tsx",
     "bg-solar-dark-content text-white w-full max-w-4xl h-[80vh] rounded-lg shadow-xl flex flex-col",
     "bg-surface text-white w-full max-w-4xl h-[80vh] rounded-lg shadow-pop border border-hairline flex flex-col", 1),
    ("BugReportViewer.tsx",
     "p-2 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors",
     "p-2 rounded-full icon-btn", 1),
    ("BugReportViewer.tsx",
     "'bg-gray-500/20 text-gray-300'",
     "'bg-white/10 text-gray-200'", 1),
    # ---------- ProUpgradeModal.tsx ----------
    ("ProUpgradeModal.tsx",
     "bg-solar-dark-content text-white w-full max-w-md rounded-lg shadow-xl",
     "bg-surface text-white w-full max-w-md rounded-lg shadow-pop border border-hairline", 1),
    ("ProUpgradeModal.tsx",
     "p-2 rounded-full text-gray-400 hover:bg-gray-500/20 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-solar-accent",
     "p-2 rounded-full icon-btn focus-visible:ring-2 focus-visible:ring-solar-accent", 1),
]

fail = False
cache: dict[str, str] = {}
for fname, old, new, expected in EDITS:
    if new is None:  # entrada informativa
        print(f"  [info] {fname}: '{old[:48]}...' coberto por replace anterior")
        continue
    path = ROOT / fname
    if fname not in cache:
        cache[fname] = path.read_text(encoding="utf-8")
    text = cache[fname]
    n = text.count(old)
    status = "OK " if n == expected else ("WARN" if n > 0 else "MISS")
    if n != expected:
        fail = True
    print(f"  [{status}] {fname}: {n}/{expected}  <- {old[:64]}")
    if n == expected and n > 0:
        cache[fname] = text.replace(old, new)

if fail:
    print("\nABORTADO: contagens divergentes — nada foi gravado.")
    sys.exit(1)

for fname, text in cache.items():
    (ROOT / fname).write_text(text, encoding="utf-8")
    print(f"  written: {fname}")
print("\nTodos os replaces aplicados com contagem exata.")
