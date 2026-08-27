#!/usr/bin/env python3
"""t18 fase 2 — aliases do MVP (solar-dark-*/shadow-2xl) -> tokens canônicos v3,
mesmo padrão do Popover no t16. Escopo: os 6 arquivos do painel ADMIN."""
import sys, pathlib

ROOT = pathlib.Path("C:/Yui/data/saas/solaris-redesign/src/components/Admin")

EDITS = [
    # ---------- AdminGate.tsx ----------
    ("AdminGate.tsx", "bg-solar-dark-bg", "bg-bg", 3),
    # ---------- AdminRulesPanel.tsx ----------
    ("AdminRulesPanel.tsx", "bg-solar-dark-content/70 border border-hairline",
     "bg-surface/70 border border-hairline", 2),
    # ---------- BugReportModal.tsx ----------
    ("BugReportModal.tsx",
     "bg-solar-dark-content border border-solar-dark-border rounded-lg shadow-2xl",
     "bg-surface border border-hairline rounded-lg shadow-pop", 1),
    ("BugReportModal.tsx",
     "bg-solar-dark-bg p-4 border-b border-solar-dark-border",
     "bg-surface-raised p-4 border-b border-hairline", 1),
    ("BugReportModal.tsx",
     "bg-solar-dark-bg border border-solar-dark-border rounded-md",
     "bg-surface-raised border border-hairline rounded-md", 1),
    # ---------- BugReportViewer.tsx ----------
    ("BugReportViewer.tsx", "border-b border-solar-dark-border",
     "border-b border-hairline", 1),
    ("BugReportViewer.tsx", "bg-solar-dark-bg/50 rounded-lg",
     "bg-surface-raised/50 rounded-lg", 1),
    ("BugReportViewer.tsx", "border-t border-solar-dark-border",
     "border-t border-hairline", 1),
    ("BugReportViewer.tsx", "bg-solar-dark-bg p-3 rounded-md",
     "bg-surface-raised p-3 rounded-md", 3),
    # ---------- ProLockOverlay.tsx ----------
    ("ProLockOverlay.tsx", "bg-solar-dark-bg/60", "bg-bg/60", 1),
    ("ProLockOverlay.tsx",
     "border border-solar-dark-border bg-solar-dark-content/90 backdrop-blur-sm",
     "border border-hairline bg-surface/90 backdrop-blur-sm", 1),
    # ---------- ProUpgradeModal.tsx ----------
    ("ProUpgradeModal.tsx", "border-b border-solar-dark-border",
     "border-b border-hairline", 1),
    ("ProUpgradeModal.tsx", "bg-solar-dark-bg border border-solar-dark-border",
     "bg-surface-raised border border-hairline", 1),
]

fail = False
cache: dict[str, str] = {}
for fname, old, new, expected in EDITS:
    path = ROOT / fname
    if fname not in cache:
        cache[fname] = path.read_text(encoding="utf-8")
    text = cache[fname]
    n = text.count(old)
    status = "OK " if n == expected else ("WARN" if n > 0 else "MISS")
    if n != expected:
        fail = True
    print(f"[{status}] {fname}: {n}/{expected}  <- {old[:64]}")
    if n == expected and n > 0:
        cache[fname] = text.replace(old, new)

if fail:
    print("\nABORTADO: contagens divergentes — nada foi gravado.")
    sys.exit(1)

for fname, text in cache.items():
    (ROOT / fname).write_text(text, encoding="utf-8")
    print(f"written: {fname}")

# prova final: nenhum alias restante em src/components/Admin/
leftover = []
for p in ROOT.glob("*.tsx"):
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if "solar-dark" in line or "shadow-2xl" in line:
            leftover.append(f"{p.name}:{i}")
print(f"\naliases restantes no Admin: {len(leftover)}")
for l in leftover:
    print(f"  LEFTOVER {l}")
sys.exit(1 if leftover else 0)
