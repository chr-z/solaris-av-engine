#!/usr/bin/env bash
# t30 gate runner: ephemeral preview (random high port) -> console probe -> LH x2 -> cleanup
set -u
cd "$(dirname "$0")/.."
P=$((4200 + RANDOM % 500))
node_modules/.bin/vite preview --port "$P" --strictPort > /tmp/t30_preview.log 2>&1 &
PID=$!
UP=0
for i in $(seq 1 24); do
  sleep 0.5
  BODY=$(curl -s "http://localhost:$P/" || true)
  if printf '%s' "$BODY" | grep -q 'index-CHKfTLey'; then UP=1; break; fi
done
if [ "$UP" != "1" ]; then echo "[FAIL] preview did not serve expected entry hash index-CHKfTLey"; cat /tmp/t30_preview.log; kill $PID 2>/dev/null; exit 3; fi
echo "[serve] ok http://localhost:$P/ (entry hash == dist)"
node scripts/console-probe.mjs "$P"
CP=$?
echo "[console-probe exit=$CP]"
npx lighthouse "http://localhost:$P/" --quiet --chrome-flags="--headless=new --disable-gpu" --only-categories=performance,accessibility,best-practices --output=json --output-path=scripts/lh-report-r1.json > /tmp/t30_lh1.log 2>&1
echo "[lh] r1 exit=$?"
npx lighthouse "http://localhost:$P/" --quiet --chrome-flags="--headless=new --disable-gpu" --only-categories=performance,accessibility,best-practices --output=json --output-path=scripts/lh-report-r2.json > /tmp/t30_lh2.log 2>&1
echo "[lh] r2 exit=$?"
kill $PID 2>/dev/null
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort $P -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }" > /dev/null 2>&1
echo "[cleanup] preview on :$P down"
