# Compose side-by-side MVP vs v3 para aceite visual do dono.
from PIL import Image, ImageDraw
import os

OUT = r"C:\Yui\data\saas_factory\redesign_shots"
H = 800           # altura comum das imagens
HEADER = 56       # barra de título do composite
GAP = 24          # respiro entre painéis
BG = (11, 14, 20)         # #0B0E14
FG = (230, 234, 242)      # #E6EAF2
SUB = (139, 147, 167)     # #8B93A7
ACC = (143, 111, 247)     # roxo accent

pairs = [
    # t17: pares recapturados pos-t8..t16 (main @ 78f6266 vs redesign-premium @ 0f66d34)
    ("mvp_login.png",      "v3_login.png",      "LOGIN",              "aceite_1_login_mvp_vs_v3.png"),
    ("mvp_fila.png",       "v3_fila.png",       "FILA DE ANALISES",   "aceite_2_fila_mvp_vs_v3.png"),
    ("mvp_analysis.png",   "v3_analysis.png",   "ANALISE (player + timeline + painel)", "aceite_3_analise_mvp_vs_v3.png"),
    ("mvp_qc_dialog.png",  "v3_qc_dialog.png",  "RELATORIO QC (dialogo de exportacao)", "aceite_4_relatorio_mvp_vs_v3.png"),
]

def fit(img, h):
    w = round(img.width * h / img.height)
    return img.resize((w, h), Image.LANCZOS)

for mvp_name, v3_name, label, out_name in pairs:
    mvp = fit(Image.open(os.path.join(OUT, mvp_name)).convert("RGB"), H)
    v3 = fit(Image.open(os.path.join(OUT, v3_name)).convert("RGB"), H)
    W = GAP + mvp.width + GAP + v3.width + GAP
    canvas = Image.new("RGB", (W, HEADER + H + GAP), BG)
    d = ImageDraw.Draw(canvas)
    title = f"SOLARIS ACEITE VISUAL  -  {label}"
    d.text((GAP, 12), title, fill=FG)
    d.text((W - GAP - 210, 12), "ESQUERDA: MVP ATUAL   |   DIREITA: V3", fill=SUB)
    x = GAP
    canvas.paste(mvp, (x, HEADER))
    d.rectangle([x - 2, HEADER - 2, x + mvp.width + 1, HEADER + H + 1], outline=(40, 46, 60))
    d.text((x, HEADER + H + 18), "MVP (main)", fill=SUB)
    x += mvp.width + GAP
    canvas.paste(v3, (x, HEADER))
    d.rectangle([x - 2, HEADER - 2, x + v3.width + 1, HEADER + H + 1], outline=ACC)
    d.text((x, HEADER + H + 18), "v3 (redesign-premium)", fill=(200, 180, 255))
    path = os.path.join(OUT, out_name)
    canvas.save(path, optimize=True)
    print(out_name, canvas.size, os.path.getsize(path), "bytes")

print("composites ok")
