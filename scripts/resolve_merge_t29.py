# Tick #29 redesign v2: resolve conflitos do log compartilhado com parser
# linha-a-linha (trata EOF sem newline e '=======' de markdown dentro de conteudo;
# separador do git tem EXATAMENTE 7 '=').
import subprocess, sys

ROOT = r"C:\Yui\data\saas\solaris-redesign"

def sh(*args):
    return subprocess.run(list(args), cwd=ROOT, capture_output=True, text=True)

def shb(*args):
    return subprocess.run(list(args), cwd=ROOT, capture_output=True)

# restaura o conflito pristine a partir dos stages 2/3
r = sh("git", "checkout", "-m", "--", "solaris_desktop_log.md")
if r.returncode != 0:
    print(f"FAIL checkout -m: {r.stderr}")
    sys.exit(1)

p = shb("git", "status", "--porcelain", "solaris_desktop_log.md")
if not p.stdout.startswith(b"UU"):
    print("FAIL: log nao esta em conflito apos checkout -m")
    sys.exit(1)
print("conflito restaurado (UU)")

with open(ROOT + r"\solaris_desktop_log.md", "rb") as fh:
    lines = fh.read().splitlines(keepends=True)

out, ours, theirs = [], [], []
state = "normal"  # normal | ours | theirs
nconf = 0
for ln in lines:
    s = ln.rstrip(b"\r\n")
    if state == "normal" and s.startswith(b"<<<<<<< "):
        state, ours, theirs = "ours", [], []
        nconf += 1
    elif state == "ours" and s == b"=======":
        state = "theirs"
    elif state == "theirs" and s.startswith(b">>>>>>> "):
        out.extend(ours)
        out.append(b"\n")
        out.extend(theirs)
        out.append(b"\n")
        state = "normal"
    elif state == "ours":
        ours.append(ln)
    elif state == "theirs":
        theirs.append(ln)
    else:
        out.append(ln)

if state != "normal":
    print(f"FAIL: conflito nao fechado (estado={state})")
    sys.exit(1)
print(f"blocos de conflito processados: {nconf}")

merged = b"".join(out)
chk = [l for l in merged.splitlines() if l.startswith(b"<<<<<<<") or l.startswith(b">>>>>>>") or l.rstrip(b"\r\n") == b"======="]
if chk:
    print(f"FAIL: residuos: {chk[:3]}")
    sys.exit(1)

with open(ROOT + r"\solaris_desktop_log.md", "wb") as fh:
    fh.write(merged)

for f in ("scripts/axe-report.json", "scripts/lh-report-r1.json", "scripts/lh-report-r2.json",
          "solaris_desktop_log.md"):
    r = sh("git", "add", f)
    if r.returncode != 0:
        print(f"FAIL add {f}: {r.stderr}")
        sys.exit(1)

st = sh("git", "status", "--porcelain")
print("--- status pos-resolucao ---")
print(st.stdout or "(clean)")
unmerged = [l for l in st.stdout.splitlines() if l[:2] in ("UU", "AA", "DD", "AU", "UA")]
if unmerged:
    print(f"FAIL unmerged: {unmerged}")
    sys.exit(1)
print("OK: merge pronto para commit")
