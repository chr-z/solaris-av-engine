#!/usr/bin/env bash
#
# make_demo_tape.sh — generates the synthetic broadcast QC demo tape used by
# the Solaris AV QC web app.
#
# Produces (all under public/demo/):
#   tape.mp4           960x540, 25 fps, 40.0 s, H.264 yuv420p +faststart,
#                      AAC stereo 48 kHz 96k
#   tape-poster.jpg    960x540 JPEG grabbed at t=5 s
#   tape-manifest.json segment map consumed by the app
#
# Everything is synthetic: colour bars, gradients, geometric shapes, patch
# grids and generated tones. No third-party footage, no logos, no faces.
#
# Usage:  scripts/make_demo_tape.sh
# Env:    FFMPEG / FFPROBE / FONT_MONO / FONT_SANS / CRF
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$REPO_ROOT/public/demo"

FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
FONT_MONO="${FONT_MONO:-/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf}"
FONT_SANS="${FONT_SANS:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}"
CRF="${CRF:-18}"
PRESET="${PRESET:-medium}"

W=960
H=540
FPS=25
DUR=40
FRAMES=1000
ABR=96k
AR=48000


log()  { printf '\033[1;36m[tape]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[tape] FAIL:\033[0m %s\n' "$*" >&2; exit 1; }

command -v "$FFMPEG"  >/dev/null 2>&1 || fail "ffmpeg not found ($FFMPEG)"
command -v "$FFPROBE" >/dev/null 2>&1 || fail "ffprobe not found ($FFPROBE)"
[[ -f "$FONT_MONO" ]] || fail "mono font not found: $FONT_MONO"
[[ -f "$FONT_SANS" ]] || fail "sans font not found: $FONT_SANS"

mkdir -p "$OUT_DIR"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/solaris-tape.XXXXXX")"
cleanup() { if [[ -n "${TAPE_DEBUG:-}" ]]; then log "kept work dir: $WORK_DIR"; else rm -rf "$WORK_DIR"; fi; }
trap cleanup EXIT

# Artifacts are staged in the scratch dir and moved into place atomically at the
# end, so a half-written tape is never visible to the dev server (and a second
# build running at the same time cannot interleave writes into the same file).
STAGE="$WORK_DIR/out"
mkdir -p "$STAGE"
VIDEO_OUT="$STAGE/tape.mp4"
POSTER_OUT="$STAGE/tape-poster.jpg"
MANIFEST_OUT="$STAGE/tape-manifest.json"
FINAL_VIDEO="$OUT_DIR/tape.mp4"
FINAL_POSTER="$OUT_DIR/tape-poster.jpg"
FINAL_MANIFEST="$OUT_DIR/tape-manifest.json"

log "work dir: $WORK_DIR"

# ---------------------------------------------------------------------------
# helper: turn a multi-line heredoc-style blob into one filtergraph string
# ---------------------------------------------------------------------------
join() { tr -d '\n'; }

# ===========================================================================
# 1. SEGMENT PICTURES
# ===========================================================================
# Each segment is rendered on its own so the QC app's per-segment assertions
# (black, bars, dead-air picture) are guaranteed by construction.

# --- 01 slate (0.0 - 4.0) -------------------------------------------------
read -r -d '' RAW <<EOF || true
drawbox=x=0:y=0:w=$W:h=$H:color=0x0a1016:t=fill,
drawgrid=w=48:h=48:t=1:c=0x121d26@1,
drawgrid=w=192:h=192:t=1:c=0x1b3140@1,
drawbox=x=0:y=269:w=$W:h=2:color=0x2b5f78@1:t=fill,
drawbox=x=479:y=0:w=2:h=$H:color=0x2b5f78@1:t=fill,
drawbox=x=36:y=36:w=888:h=468:color=0x38b6ff@0.45:t=2,
drawbox=x=36:y=36:w=28:h=4:color=0x38b6ff@0.9:t=fill,
drawbox=x=36:y=36:w=4:h=28:color=0x38b6ff@0.9:t=fill,
drawbox=x=896:y=36:w=28:h=4:color=0x38b6ff@0.9:t=fill,
drawbox=x=920:y=36:w=4:h=28:color=0x38b6ff@0.9:t=fill,
drawbox=x=36:y=500:w=28:h=4:color=0x38b6ff@0.9:t=fill,
drawbox=x=36:y=476:w=4:h=28:color=0x38b6ff@0.9:t=fill,
drawbox=x=896:y=500:w=28:h=4:color=0x38b6ff@0.9:t=fill,
drawbox=x=920:y=476:w=4:h=28:color=0x38b6ff@0.9:t=fill,
drawtext=fontfile=$FONT_SANS:text='SOLARIS':fontsize=78:fontcolor=0xf2f6f8:x=(w-tw)/2:y=150:shadowcolor=black@0.6:shadowx=2:shadowy=2,
drawtext=fontfile=$FONT_MONO:text='QC DEMO TAPE 01':fontsize=26:fontcolor=0x7fd4ff:x=(w-tw)/2:y=246,
drawtext=fontfile=$FONT_MONO:text='960 × 540 · 25 fps · 40.0 s':fontsize=18:fontcolor=0xd5dde2:x=(w-tw)/2:y=288,
drawtext=fontfile=$FONT_MONO:text='H.264 yuv420p · AAC 96k · 48 kHz stereo':fontsize=15:fontcolor=0x8fa0ab:x=(w-tw)/2:y=318,
drawtext=fontfile=$FONT_MONO:text='SYNTHETIC TEST MATERIAL · NO THIRD-PARTY FOOTAGE':fontsize=13:fontcolor=0x6f7f8a:x=(w-tw)/2:y=462
EOF
F_SLATE="$(printf '%s' "$RAW" | join)"

# --- 02 bars (4.0 - 10.0): SMPTE 75% bars, steady ------------------------
F_BARS="format=yuv420p"

# --- 03 ramp (10.0 - 16.0) ------------------------------------------------
read -r -d '' RAW <<EOF || true
geq=lum='X/(W-1)*255':cb=128:cr=128,
drawbox=x=0:y=432:w=$W:h=108:color=0x000000:t=fill,
drawbox=x=0:y=432:w=96:h=108:color=0x000000:t=fill,
drawbox=x=96:y=432:w=96:h=108:color=0x1c1c1c:t=fill,
drawbox=x=192:y=432:w=96:h=108:color=0x393939:t=fill,
drawbox=x=288:y=432:w=96:h=108:color=0x555555:t=fill,
drawbox=x=384:y=432:w=96:h=108:color=0x717171:t=fill,
drawbox=x=480:y=432:w=96:h=108:color=0x8e8e8e:t=fill,
drawbox=x=576:y=432:w=96:h=108:color=0xaaaaaa:t=fill,
drawbox=x=672:y=432:w=96:h=108:color=0xc6c6c6:t=fill,
drawbox=x=768:y=432:w=96:h=108:color=0xe3e3e3:t=fill,
drawbox=x=864:y=432:w=96:h=108:color=0xffffff:t=fill,
drawbox=x=0:y=430:w=$W:h=2:color=0x000000:t=fill,
drawtext=fontfile=$FONT_MONO:text='LUMA RAMP 0-100 IRE · 11-STEP WEDGE':fontsize=14:fontcolor=0xffffff@0.85:box=1:boxcolor=black@0.5:boxborderw=5:x=16:y=392
EOF
F_RAMP="$(printf '%s' "$RAW" | join)"

# --- 04 deadair (16.0 - 20.0): locked-off synthetic landscape, static -----
read -r -d '' RAW <<EOF || true
geq=lum='19+min(Y/378,1)*149':cb='135-8*min(Y/378,1)':cr='121-8*min(Y/378,1)',
drawbox=x=0:y=330:w=300:h=50:color=0x20303a:t=fill,
drawbox=x=250:y=348:w=420:h=32:color=0x1a2830:t=fill,
drawbox=x=640:y=336:w=320:h=44:color=0x22323c:t=fill,
drawbox=x=0:y=380:w=$W:h=160:color=0x1b2420:t=fill,
drawbox=x=0:y=378:w=$W:h=2:color=0xa8b8c2:t=fill,
drawbox=x=0:y=380:w=$W:h=8:color=0x2e3d36:t=fill,
drawtext=fontfile=$FONT_SANS:text='●':fontsize=132:fontcolor=0xffe6b8:x=700:y=176,
drawbox=x=310:y=430:w=340:h=46:color=0x0f1614@0.45:t=fill,
drawtext=fontfile=$FONT_MONO:text='SCENE 04 · LOCKED OFF · NO AUDIO':fontsize=15:fontcolor=0xdbe4e8@0.85:x=(w-tw)/2:y=442
EOF
F_DEADAIR="$(printf '%s' "$RAW" | join)"

# --- 05 black (20.0 - 24.0): true black, full-range Y=0 -------------------
F_BLACK="geq=lum=0:cb=128:cr=128"

# --- 06 clip (24.0 - 29.0): strong blue cast over bars --------------------
F_CLIP="format=gbrp,colorchannelmixer=rr=0.30:gg=0.72:bb=1.55:gr=0.02:gb=0.02,colorlevels=rimin=0:gimin=0:bimin=0,format=yuv420p,eq=contrast=1.05"

# --- 07 skintone (29.0 - 34.0): 6x4 patch grid ----------------------------
SKIN_COLORS=(
  0xf8dcc8 0xf0cdb4 0xe7bc9c 0xdca483 0xd09170 0xc07a5b
  0xb06a4e 0x9c5940 0x83462f 0x6a3623 0x512818 0x3a1c10
  0xff0000 0x00ff00 0x0000ff 0x00ffff 0xff00ff 0xffff00
  0xffffff 0x808080 0x000000 0xff8000 0x0080ff 0x8000ff
)
PATCHES="drawbox=x=0:y=0:w=$W:h=$H:color=0x080808:t=fill"
row=0; col=0
for c in "${SKIN_COLORS[@]}"; do
  x=$((col * 160)); y=$((row * 135))
  PATCHES+=",drawbox=x=$x:y=$y:w=160:h=135:color=$c:t=fill"
  col=$((col + 1))
  if [[ $col -eq 6 ]]; then col=0; row=$((row + 1)); fi
done
for i in 1 2 3 4 5; do PATCHES+=",drawbox=x=$((i * 160 - 1)):y=0:w=2:h=$H:color=0x080808:t=fill"; done
for j in 1 2 3;   do PATCHES+=",drawbox=x=0:y=$((j * 135 - 1)):w=$W:h=2:color=0x080808:t=fill"; done
PATCHES+=",drawbox=x=0:y=0:w=$W:h=$H:color=0xffffff@1:t=2"
F_SKINTONE="$PATCHES"

# --- 08 final (34.0 - 40.0): warm graded landscape, slow drift -----------
read -r -d '' RAW <<EOF || true
geq=lum='52+min(Y/400,1)*163':cb='148-49*min(Y/400,1)':cr='110+37*min(Y/400,1)',
drawbox=x=0:y=352:w=$W:h=48:color=0x55636b:t=fill,
drawbox=x=0:y=398:w=$W:h=2:color=0xc8d2d8:t=fill,
drawbox=x=0:y=400:w=$W:h=140:color=0x3f4a2c:t=fill,
drawbox=x=0:y=400:w=$W:h=10:color=0x566138:t=fill,
drawtext=fontfile=$FONT_SANS:text='●':fontsize=110:fontcolor=0xffe9c4:x=760:y=150,
drawbox=x='mod(t*22,1160)-120':y=296:w=760:h=54:color=0xffffff@0.10:t=fill,
drawbox=x='mod(t*22,1160)-120':y=326:w=620:h=26:color=0xffffff@0.14:t=fill,
drawbox=x=140:y=428:w=300:h=52:color=0x22281a@0.45:t=fill,
drawtext=fontfile=$FONT_MONO:text='SCENE 08 · GRADED · 60Hz HUM':fontsize=15:fontcolor=0xe8eef0@0.85:x=(w-tw)/2:y=440,
colorbalance=rs=0.10:gs=0.03:bs=-0.09:rm=0.05:bm=-0.05,
eq=saturation=1.06:contrast=1.04
EOF
F_FINAL="$(printf '%s' "$RAW" | join)"

V_SRC=(
  "color=c=0x0a1016:s=${W}x${H}:r=$FPS:d=4"
  "smptebars=s=${W}x${H}:r=$FPS:d=6"
  "color=c=black:s=${W}x${H}:r=$FPS:d=6"
  "color=c=black:s=${W}x${H}:r=$FPS:d=4"
  "color=c=black:s=${W}x${H}:r=$FPS:d=4"
  "smptebars=s=${W}x${H}:r=$FPS:d=5"
  "color=c=0x080808:s=${W}x${H}:r=$FPS:d=5"
  "color=c=black:s=${W}x${H}:r=$FPS:d=6"
)
V_FILT=( "$F_SLATE" "$F_BARS" "$F_RAMP" "$F_DEADAIR" "$F_BLACK" "$F_CLIP" "$F_SKINTONE" "$F_FINAL" )

# ===========================================================================
# 2. BURN-INS
# ===========================================================================
# Timecode HH:MM:SS:FF at 25 fps, top-right; station label bottom-left. Both
# are suppressed across the black slug so the segment stays a true black frame.
read -r -d '' RAW <<EOF || true
drawtext=fontfile=$FONT_MONO:text='%{eif\:floor(t/3600)\:d\:2}\:%{eif\:mod(floor(t/60)\,60)\:d\:2}\:%{eif\:mod(floor(t)\,60)\:d\:2}\:%{eif\:mod(floor(t*25)\,25)\:d\:2}':fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6:x=w-tw-18:y=18:enable='lt(t,20)+gte(t,24)',
drawtext=fontfile=$FONT_MONO:text='SOLARIS DEMO TAPE 01 · 960x540 · 25p':fontsize=16:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6:x=18:y=h-th-18:enable='lt(t,20)+gte(t,24)',
drawtext=fontfile=$FONT_MONO:text='SLATE':fontsize=13:fontcolor=0x9fb2bd:box=1:boxcolor=black@0.45:boxborderw=4:x=w-tw-18:y=h-th-18:enable='between(t,0,3.96)',
drawtext=fontfile=$FONT_MONO:text='BARS · 75 IRE':fontsize=13:fontcolor=0x9fb2bd:box=1:boxcolor=black@0.45:boxborderw=4:x=w-tw-18:y=h-th-18:enable='between(t,4,9.96)',
drawtext=fontfile=$FONT_MONO:text='RAMP':fontsize=13:fontcolor=0x9fb2bd:box=1:boxcolor=black@0.45:boxborderw=4:x=w-tw-18:y=h-th-18:enable='between(t,10,15.96)',
drawtext=fontfile=$FONT_MONO:text='DEAD AIR':fontsize=13:fontcolor=0x9fb2bd:box=1:boxcolor=black@0.45:boxborderw=4:x=w-tw-18:y=h-th-18:enable='between(t,16,19.96)',
drawtext=fontfile=$FONT_MONO:text='CLIP +13 dB':fontsize=13:fontcolor=0xffd0d0:box=1:boxcolor=black@0.45:boxborderw=4:x=w-tw-18:y=h-th-18:enable='between(t,24,28.96)',
drawtext=fontfile=$FONT_MONO:text='SKIN / SAT':fontsize=13:fontcolor=0x9fb2bd:box=1:boxcolor=black@0.45:boxborderw=4:x=w-tw-18:y=h-th-18:enable='between(t,29,33.96)',
drawtext=fontfile=$FONT_MONO:text='FINAL · 60Hz':fontsize=13:fontcolor=0x9fb2bd:box=1:boxcolor=black@0.45:boxborderw=4:x=w-tw-18:y=h-th-18:enable='between(t,34,40)'
EOF
F_OVERLAY="$(printf '%s' "$RAW" | join)"
if [[ -n "${TAPE_DEBUG:-}" ]]; then
  printf '%s\n' "$F_OVERLAY" > "$WORK_DIR/overlay.filter.txt"
  printf '%s\n' "$WORK_DIR/overlay.filter.txt" >&2
fi

# ===========================================================================
# 3. AUDIO SOURCES (48 kHz mono upstream, stereo at the tail)
# ===========================================================================
A_SRC=(
  "aevalsrc=exprs='0.032*sin(2*PI*1000*t)':s=$AR:d=4"                                               # slate:    quiet 1 kHz ref (-30 dBFS)
  "aevalsrc=exprs='0.032*sin(2*PI*1000*t)':s=$AR:d=6"                                               # bars:     quiet 1 kHz ref
  "aevalsrc=exprs='0.032*sin(2*PI*1000*t)':s=$AR:d=6"                                               # ramp:     quiet 1 kHz ref
  "anullsrc=r=$AR:cl=mono:d=4"                                                                      # deadair:  TRUE digital silence
  "aevalsrc=exprs='0.126*sin(2*PI*200*t)':s=$AR:d=4"                                                # black:    low tone (-18 dBFS)
  "aevalsrc=exprs='sin(2*PI*100*t)+sin(2*PI*1000*t)':s=$AR:d=5"                                     # clip:     100 Hz + 1 kHz
  "aevalsrc=exprs='0.063*sin(2*PI*500*t)':s=$AR:d=5"                                                # skintone: steady tone (-24 dBFS)
  "aevalsrc=exprs='0.055*sin(2*PI*500*t)+0.022*sin(2*PI*1000*t)+0.035*sin(2*PI*60*t)':s=$AR:d=6"   # final:    tone mix + 60 Hz hum
)
# NB: this build's `sine` source peaks at -18 dBFS, not full scale, so every
# tone is an aevalsrc with its amplitude written out explicitly.
A_PROC=(
  "anull"
  "anull"
  "anull"
  "anull"                                                          # silence passes untouched
  "anull"
  "volume=6.3,alimiter=limit=1.0:level=0:attack=3:release=40"       # +16 dB into a hard limiter -> full-scale clip
  "anull"
  "anull"
)

# ===========================================================================
# 4. GRAPH
# ===========================================================================
# Video: eight lavfi pictures -> per-segment filters -> concat -> burn-ins.
# Audio: eight lavfi/Fs sources -> per-segment gain -> concat -> stereo.
VGRAPH=""
for i in "${!V_SRC[@]}"; do
  VGRAPH+="[$i:v]${V_FILT[$i]}[v$i];"
done
VGRAPH+="[v0][v1][v2][v3][v4][v5][v6][v7]concat=n=8:v=1:a=0[vc];"
VGRAPH+="[vc]setpts=N/($FPS*TB),$F_OVERLAY[vout]"

AGRAPH=""
for i in "${!A_SRC[@]}"; do
  AGRAPH+="[$((i + 8)):a]${A_PROC[$i]}[a$i];"
done
AGRAPH+="[a0][a1][a2][a3][a4][a5][a6][a7]concat=n=8:v=0:a=1,"
AGRAPH+="aresample=$AR,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]"

# ===========================================================================
# 5. ASSEMBLE
# ===========================================================================
log "encoding $VIDEO_OUT"
ARGS=()
for s in "${V_SRC[@]}"; do ARGS+=(-f lavfi -i "$s"); done
for s in "${A_SRC[@]}"; do ARGS+=(-f lavfi -i "$s"); done

# Encode to a scratch file first: asking libavformat to faststart in place on a
# large moov has produced a duplicated moov atom on this build, which decodes as
# garbage. A clean stream-copy remux below puts moov in front safely.
ENCODE_OUT="$WORK_DIR/encode.mp4"

"$FFMPEG" -hide_banner -loglevel error -y \
  "${ARGS[@]}" \
  -filter_complex "${VGRAPH};${AGRAPH}" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset "$PRESET" -crf "$CRF" -profile:v high -level 4.0 \
  -pix_fmt yuv420p -g 50 -keyint_min 25 -sc_threshold 0 \
  -fps_mode passthrough -video_track_timescale 25000 \
  -frames:v "$FRAMES" -t "$DUR" \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -c:a aac -b:a "$ABR" -ar "$AR" -ac 2 \
  "$ENCODE_OUT"

log "faststart remux"
"$FFMPEG" -hide_banner -loglevel error -y -i "$ENCODE_OUT" \
  -map 0:v:0 -map 0:a:0 -c copy -movflags +faststart "$VIDEO_OUT"

# ===========================================================================
# 5. WEBM FALLBACK (VP9 + Opus)
# ===========================================================================
# Chromium builds without proprietary codecs (many Linux distros, some CI
# images) cannot decode H.264/AAC. A VP9 twin keeps the tour working there.
log "webm $STAGE/tape.webm"
"$FFMPEG" -hide_banner -loglevel error -y -i "$VIDEO_OUT" \
  -c:v libvpx-vp9 -crf 36 -b:v 0 -row-mt 1 -deadline good -cpu-used 4 \
  -pix_fmt yuv420p -g 50 \
  -c:a libopus -b:a 64k -ar "$AR" -ac 2 \
  -movflags +faststart "$STAGE/tape.webm"

# ===========================================================================
# 6. POSTER (frame at t = 5 s)
# ===========================================================================
log "poster $POSTER_OUT"
"$FFMPEG" -hide_banner -loglevel error -y \
  -ss 5 -i "$VIDEO_OUT" -frames:v 1 -q:v 3 -update 1 "$POSTER_OUT"

# ===========================================================================
# 6. MANIFEST
# ===========================================================================
log "manifest $MANIFEST_OUT"
cat > "$MANIFEST_OUT" <<'JSON'
{
  "id": "solaris-demo-tape-01",
  "title": "Solaris QC Demo Tape 01",
  "duration": 40,
  "width": 960,
  "height": 540,
  "fps": 25,
  "video": { "codec": "h264", "pixFmt": "yuv420p", "profile": "high" },
  "audio": { "codec": "aac", "sampleRate": 48000, "channels": 2, "bitrate": "96k" },
  "segments": [
    { "id": "slate",    "start": 0.0,  "end": 4.0,  "label": "Slate — test pattern + title card" },
    { "id": "bars",     "start": 4.0,  "end": 10.0, "label": "SMPTE 75% colour bars" },
    { "id": "ramp",     "start": 10.0, "end": 16.0, "label": "Luma ramp + 11-step wedge" },
    { "id": "deadair",  "start": 16.0, "end": 20.0, "label": "Dead air — picture static, audio silent" },
    { "id": "black",    "start": 20.0, "end": 24.0, "label": "Black slug — audio present" },
    { "id": "clip",     "start": 24.0, "end": 29.0, "label": "Audio clip — 100 Hz + 1 kHz overdriven, blue cast" },
    { "id": "skintone", "start": 29.0, "end": 34.0, "label": "Skin-tone and saturated patch grid" },
    { "id": "final",    "start": 34.0, "end": 40.0, "label": "Final — graded scene, 60 Hz hum" }
  ]
}
JSON

# ===========================================================================
# 7. VERIFY
# ===========================================================================
log "verifying"

PROBE_JSON="$("$FFPROBE" -v error \
  -show_entries format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels \
  -of json "$VIDEO_OUT")"
printf '%s\n' "$PROBE_JSON"

read -r V_DUR V_W V_H V_FPS A_CH A_SR < <(python3 - "$VIDEO_OUT" <<'PY'
import json, subprocess, sys
j = json.loads(subprocess.check_output([
    "ffprobe","-v","error","-show_entries",
    "format=duration,size:stream=codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels",
    "-of","json", sys.argv[1]]))
v = next(s for s in j["streams"] if s["codec_type"] == "video")
a = next((s for s in j["streams"] if s["codec_type"] == "audio"), {})
print(j["format"]["duration"], v["width"], v["height"], v["r_frame_rate"],
      a.get("channels", 0), a.get("sample_rate", 0))
PY
)

SIZE_BYTES=$(stat -c %s "$VIDEO_OUT")

python3 - "$V_DUR" "$V_W" "$V_H" "$V_FPS" "$A_CH" "$A_SR" "$SIZE_BYTES" <<'PY'
import sys
dur, w, h, fps, ch, sr, size = sys.argv[1:8]
dur, w, h, ch, sr, size = float(dur), int(w), int(h), int(ch), int(sr), int(size)
errs = []
if abs(dur - 40.0) > 0.1:           errs.append(f"duration {dur} != 40.0±0.1")
if (w, h) != (960, 540):            errs.append(f"size {w}x{h}")
if fps != "25/1":                   errs.append(f"fps {fps}")
if ch != 2:                         errs.append(f"audio channels {ch}")
if sr != 48000:                     errs.append(f"audio rate {sr}")
if size > 5 * 1024 * 1024:          errs.append(f"size {size/1048576:.2f} MB > 5 MB")
for e in errs: print("ASSERT FAIL:", e)
sys.exit(1 if errs else 0)
PY

# --- per-segment picture checks -------------------------------------------
CHECK_DIR=/tmp
luma_of() {
  "$FFMPEG" -hide_banner -i "$1" -vf signalstats,metadata=print -f null - 2>&1 \
    | grep -m1 'signalstats.YAVG' | sed 's/.*YAVG=//'
}
uavg_of() {
  "$FFMPEG" -hide_banner -i "$1" -vf signalstats,metadata=print -f null - 2>&1 \
    | grep -m1 'signalstats.UAVG' | sed 's/.*UAVG=//'
}
check_seg() {
  local id="$1" t="$2"
  local f="$CHECK_DIR/check-$id.jpg"
  "$FFMPEG" -hide_banner -loglevel error -y -ss "$t" -i "$VIDEO_OUT" -frames:v 1 -q:v 2 "$f"
  local y u
  y="$(luma_of "$f")"
  u="$(uavg_of "$f")"
  printf '  %-9s t=%5.1fs  YAVG=%-9s UAVG=%s  -> %s\n' "$id" "$t" "$y" "$u" "$f" >&2
  printf '%s %s\n' "$y" "$u"
}
read -r BLACK_Y BLACK_U   <<<"$(check_seg black 22)"
read -r BARS_Y  BARS_U    <<<"$(check_seg bars 7)"
read -r DEAD_Y  DEAD_U    <<<"$(check_seg deadair 18)"
read -r CLIP_Y  CLIP_U    <<<"$(check_seg clip 26.5)"
check_seg slate 2       >/dev/null
check_seg ramp 13       >/dev/null
check_seg skintone 31.5 >/dev/null
check_seg final 37      >/dev/null

python3 - "$BLACK_Y" "$BARS_Y" "$DEAD_Y" "$CLIP_U" <<'PY'
import sys
b, bars, dead, u = (float(x) for x in sys.argv[1:5])
errs = []
if not b < 12:            errs.append(f"black YAVG {b} >= 12")
if not 40 <= bars <= 200: errs.append(f"bars YAVG {bars} outside 40..200")
if not dead > 40:         errs.append(f"deadair YAVG {dead} <= 40")
if not u > 135:           errs.append(f"clip UAVG {u} not blue-biased")
for e in errs: print("ASSERT FAIL:", e)
print("luma/blue assertions: OK" if not errs else "luma/blue assertions: FAILED")
sys.exit(1 if errs else 0)
PY

# --- audio checks: silence, clipping, hum ---------------------------------
# volumedetect floors at -91 dB, so levels are measured on decoded f32 samples.
log "audio levels"
python3 - "$VIDEO_OUT" "$WORK_DIR" <<'PY'
import array, math, os, subprocess, sys

mp4, tmp = sys.argv[1], sys.argv[2]
SR = 48000

def window(ss, dur, tag):
    out = os.path.join(tmp, f"a-{tag}.raw")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(ss), "-t", str(dur),
                    "-i", mp4, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", out],
                   check=True)
    a = array.array("f")
    with open(out, "rb") as fh:
        a.frombytes(fh.read())
    return a

def db(v):
    return 20 * math.log10(v) if v > 0 else -999.0

def stats(a):
    peak = max((abs(x) for x in a), default=0.0)
    rms = math.sqrt(sum(x * x for x in a) / len(a)) if a else 0.0
    return peak, rms

def goertzel_amp(a, f):
    w = 2 * math.pi * f / SR
    c = 2 * math.cos(w)
    s1 = s2 = 0.0
    for x in a:
        s1, s2 = x + c * s1 - s2, s1
    p = s1 * s1 + s2 * s2 - c * s1 * s2
    return 2 * math.sqrt(max(p, 0.0)) / len(a)

segs = [
    ("slate",    1.0, 2.0),
    ("bars",     5.0, 3.0),
    ("ramp",    12.0, 3.0),
    ("deadair", 16.5, 3.0),
    ("black",   21.0, 2.0),
    ("clip",    25.0, 3.0),
    ("skintone",30.0, 3.0),
    ("final",   35.0, 4.0),
]
res = {}
for name, ss, dur in segs:
    a = window(ss, dur, name)
    peak, rms = stats(a)
    res[name] = (a, peak, rms)
    print(f"  {name:<9} peak={db(peak):8.2f} dBFS  rms={db(rms):8.2f} dBFS  maxabs={peak:.6g}")

errs = []
peak, rms = res["deadair"][1], res["deadair"][2]
if peak != 0.0:
    errs.append(f"deadair is not digital silence (maxabs {peak:.6g})")
if not db(res["clip"][1]) >= -1.0:
    errs.append(f"clip peak {db(res['clip'][1]):.2f} dBFS is not full-scale")
if not db(res["clip"][2]) >= -12.0:
    errs.append(f"clip rms {db(res['clip'][2]):.2f} dBFS is not hot")
if not -40.0 <= db(res["bars"][1]) <= -20.0:
    errs.append(f"bars reference tone {db(res['bars'][1]):.2f} dBFS not quiet-reference level")

hum_final = db(goertzel_amp(res["final"][0], 60))
hum_black = db(goertzel_amp(res["black"][0], 60))
print(f"  60 Hz energy: final={hum_final:.1f} dBFS  black={hum_black:.1f} dBFS")
if hum_final < -50.0:
    errs.append(f"60 Hz hum in final too weak ({hum_final:.1f} dBFS)")
if hum_black > -70.0:
    errs.append(f"black segment unexpectedly carries 60 Hz ({hum_black:.1f} dBFS)")

for e in errs:
    print("ASSERT FAIL:", e)
print("audio assertions:", "FAILED" if errs else "OK")
sys.exit(1 if errs else 0)
PY

python3 -m json.tool "$MANIFEST_OUT" >/dev/null

# --- container sanity: exactly one moov, and it must precede mdat ---------
python3 - "$VIDEO_OUT" <<'PY'
import struct, sys
data = open(sys.argv[1], "rb").read()
off, boxes = 0, []
while off + 8 <= len(data):
    size, typ = struct.unpack(">I4s", data[off:off + 8])
    if size < 8:
        break
    boxes.append((typ.decode("latin1"), off, size))
    off += size
kinds = [b[0] for b in boxes]
errs = []
if kinds.count("moov") != 1:
    errs.append(f"expected exactly one moov atom, found {kinds.count('moov')} ({kinds})")
if "mdat" not in kinds:
    errs.append("no mdat atom")
elif "moov" in kinds and kinds.index("moov") > kinds.index("mdat"):
    errs.append(f"moov does not precede mdat ({kinds}) — faststart missing")
for e in errs:
    print("ASSERT FAIL:", e)
print("box layout:", " ".join(kinds[:6]))
print("container assertions:", "FAILED" if errs else "OK")
sys.exit(1 if errs else 0)
PY

# --- publish: atomic replace of the three artifacts -----------------------
log "publishing to $OUT_DIR"
mv -f "$VIDEO_OUT"     "$FINAL_VIDEO"
mv -f "$STAGE/tape.webm" "$OUT_DIR/tape.webm"
mv -f "$POSTER_OUT"    "$FINAL_POSTER"
mv -f "$MANIFEST_OUT"  "$FINAL_MANIFEST"

log "done"
ls -lh "$FINAL_VIDEO" "$FINAL_POSTER" "$FINAL_MANIFEST" | sed 's/^/  /'
