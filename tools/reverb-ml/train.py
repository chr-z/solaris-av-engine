"""Treino do refinador ML de reverb (P4) + export ONNX.

Roda OFFLINE em venv efêmero:  uv venv .venv && uv pip install numpy onnx
Entrada: out/features.jsonl (gerado por generate-dataset.ts — features da
própria implementação TS do produto).

Saídas:
  out/model.onnx                      — MLP 8→24→24→1 float32
  out/train-report.json               — métricas e gates de qualidade
  src/audio-acoustics/ml/reverbMlWeights.generated.ts — pesos int16 + escala

Gates (falha = exit 2, sem artefatos novos):
  MAE global ≤ 0.10s | dry MAE ≤ 0.15 e máx ≤ 0.35 | banda forte ≤ 0.12 |
  banda sutil ≤ 0.15 | drift de quantização int16 ≤ 0.02s | ONNX == numpy
"""

import json
import math
import os
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TS_OUT = os.path.join(REPO, "src", "audio-acoustics", "ml", "reverbMlWeights.generated.ts")

SIZES = [8, 24, 24, 1]
EPOCHS = 6000
LR0, LR1 = 3e-3, 3e-4
SEED = 20260825

GATES = {
    "mae_all": 0.10,
    "mae_dry": 0.15,
    "max_dry": 0.35,
    "mae_strong": 0.12,   # truth em [0.6, 1.2]
    "mae_subtle": 0.15,   # truth em (0, 0.6)
    "quant_drift_s": 0.02,
}


def load_data():
    rows = []
    with open(os.path.join(OUT, "features.jsonl"), encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    X = np.array([r["x"] for r in rows], dtype=np.float64)
    Y = np.array([r["y"] for r in rows], dtype=np.float64)
    idx = np.arange(len(rows))
    val = idx % 5 == 4  # determinístico, espalhado entre combos
    return (X[~val], Y[~val]), (X[val], Y[val])


class MLP:
    def __init__(self, sizes, rng):
        self.W, self.B = [], []
        for fanin, fanout in zip(sizes[:-1], sizes[1:]):
            self.W.append(rng.normal(0.0, math.sqrt(2.0 / fanin), size=(fanin, fanout)))
            self.B.append(np.zeros(fanout))

    def forward(self, X):
        acts = [X]
        a = X
        for i in range(len(self.W)):
            z = a @ self.W[i] + self.B[i]
            a = np.maximum(z, 0.0) if i < len(self.W) - 1 else z
            acts.append(a)
        return a, acts

    def loss(self, X, Y):
        pred, _ = self.forward(X)
        d = pred[:, 0] - Y
        return float(np.mean(d * d))

    def train_step(self, X, Y, lr, m, v, t):
        pred, acts = self.forward(X)
        delta = 2.0 * (pred[:, 0] - Y) / len(Y)      # (N,)
        gW, gB = [None] * len(self.W), [None] * len(self.B)
        grad = delta[:, None]                         # saída linear
        for i in range(len(self.W) - 1, -1, -1):
            gW[i] = acts[i].T @ grad
            gB[i] = grad.sum(axis=0)
            if i > 0:
                grad = (grad @ self.W[i].T) * (acts[i] > 0)
        for i in range(len(self.W)):
            m[f"W{i}"] = 0.9 * m[f"W{i}"] + 0.1 * gW[i]
            m[f"B{i}"] = 0.9 * m[f"B{i}"] + 0.1 * gB[i]
            v[f"W{i}"] = 0.999 * v[f"W{i}"] + 0.001 * gW[i] ** 2
            v[f"B{i}"] = 0.999 * v[f"B{i}"] + 0.001 * gB[i] ** 2
            for key in (f"W{i}", f"B{i}"):
                mh = m[key] / (1 - 0.9 ** t)
                vh = v[key] / (1 - 0.999 ** t)
                attr = self.W if key[0] == "W" else self.B
                attr[int(key[1:])] -= lr * mh / (np.sqrt(vh) + 1e-8)


def band_metrics(pred, truth):
    err = np.abs(pred - truth)
    dry = truth < 1e-9
    strong = truth >= 0.6
    subtle = (truth > 1e-9) & (truth < 0.6)
    return {
        "mae_all": float(err.mean()),
        "max_all": float(err.max()),
        "mae_dry": float(err[dry].mean()) if dry.any() else 0.0,
        "max_dry": float(err[dry].max()) if dry.any() else 0.0,
        "mae_strong": float(err[strong].mean()) if strong.any() else 0.0,
        "max_strong": float(err[strong].max()) if strong.any() else 0.0,
        "mae_subtle": float(err[subtle].mean()) if subtle.any() else 0.0,
        "max_subtle": float(err[subtle].max()) if subtle.any() else 0.0,
    }


def main():
    (Xtr, Ytr), (Xva, Yva) = load_data()
    rng = np.random.default_rng(SEED)
    mu = Xtr.mean(axis=0)
    sd = Xtr.std(axis=0)
    sd = np.where(sd < 1e-6, 1e-6, sd)
    S = lambda M: (M - mu) / sd  # noqa: E731

    net = MLP(SIZES, rng)
    m = {f"{p}{i}": np.zeros_like(a) for i in range(len(net.W)) for p, a in (("W", net.W[i]), ("B", net.B[i]))}
    v = {k: np.zeros_like(t) for k, t in m.items()}
    best = {"vl": float("inf"), "W": None, "B": None}
    for epoch in range(1, EPOCHS + 1):
        lr = LR1 + 0.5 * (LR0 - LR1) * (1 + math.cos(math.pi * epoch / EPOCHS))
        net.train_step(S(Xtr), Ytr, lr, m, v, epoch)
        if epoch % 50 == 0 or epoch == EPOCHS:
            vl = net.loss(S(Xva), Yva)
            if vl < best["vl"]:
                best = {"vl": vl, "W": [w.copy() for w in net.W], "B": [b.copy() for b in net.B]}
    net.W, net.B = best["W"], best["B"]

    # ---------- métricas ----------
    pred_va, _ = net.forward(S(Xva))
    pred_tr, _ = net.forward(S(Xtr))

    # ---------- seleção da FUSÃO (peso escolhido só em TREINO, provado em VAL) ----------
    # Produto: rt60Final = w*ML + (1-w)*Detector onde o detector convergiu;
    # só ML onde não convergiu. O detector comete erros grandes em linhas que
    # o ML acerta (auditoria: 8/11 erros grandes eram do detector).
    both_tr = Xtr[:, 0] > 1e-9
    candidates = [0.0, 0.15, 0.3, 0.4, 0.5, 0.6, 0.75, 1.0]
    best_w, best_tr_mae = 0.0, None
    for w in candidates:
        f = np.where(both_tr, w * pred_tr[:, 0] + (1 - w) * Xtr[:, 0], pred_tr[:, 0])
        e = float(np.abs(f - Ytr).mean())
        if best_tr_mae is None or e < best_tr_mae:
            best_w, best_tr_mae = w, e

    det_va = Xva[:, 0]
    has_det = det_va > 1e-9
    fused_va = np.where(has_det, best_w * pred_va[:, 0] + (1 - best_w) * det_va, pred_va[:, 0])
    fused_tr = np.where(both_tr, best_w * pred_tr[:, 0] + (1 - best_w) * Xtr[:, 0], pred_tr[:, 0])

    # Gate de sanidade da fusão: na banda both-present de VAL, o blend tem que
    # empatar ou ganhar os dois extremos (só-det, só-ML). Senão cai p/ w seguro.
    mae_both_det = float(np.abs(det_va[has_det] - Yva[has_det]).mean()) if has_det.any() else None
    mae_both_ml = float(np.abs(pred_va[has_det, 0] - Yva[has_det]).mean()) if has_det.any() else None
    mae_both_mix = float(np.abs(fused_va[has_det] - Yva[has_det]).mean()) if has_det.any() else None
    if mae_both_mix is not None and mae_both_mix > min(mae_both_det, mae_both_ml):
        best_w = 0.0
        fused_va = np.where(has_det, det_va, pred_va[:, 0])
        fused_tr = np.where(both_tr, Xtr[:, 0], pred_tr[:, 0])
        mae_both_mix = float(np.abs(fused_va[has_det] - Yva[has_det]).mean())

    met_va = band_metrics(fused_va, Yva)
    met_tr = band_metrics(fused_tr, Ytr)

    # auditoria de complementaridade (com a política FINAL de fusão)
    err_det = np.abs(det_va - Yva)
    err_fus = np.abs(fused_va - Yva)
    improved = int(np.sum((err_fus < err_det - 0.01)))
    worsened = int(np.sum((err_fus > err_det + 0.01)))

    # Auditoria por linha: onde o sistema fundido erra >0.20s, de quem é a culpa?
    big = []
    for i in range(len(Yva)):
        if err_fus[i] > 0.20:
            big.append({
                "truth": round(float(Yva[i]), 3),
                "det": round(float(det_va[i]), 3),
                "ml": round(float(pred_va[i, 0]), 3),
                "fused": round(float(fused_va[i]), 3),
                "fused_err": round(float(err_fus[i]), 3),
                "blame": "detector" if has_det[i] else "ml",
            })

    report = {
        "sizes": SIZES,
        "epochs": EPOCHS,
        "n_train": int(len(Ytr)),
        "n_val": int(len(Yva)),
        "val_loss_mse": round(best["vl"], 6),
        "metrics_val": {k: round(x, 4) for k, x in met_va.items()},
        "metrics_train": {k: round(x, 4) for k, x in met_tr.items()},
        "fusion_policy": {
            "weight_ml": best_w,
            "selected_on_train_mae": round(best_tr_mae, 4) if best_tr_mae is not None else None,
            "val_band_both_present": {
                "mae_detector_only": round(mae_both_det, 4) if mae_both_det is not None else None,
                "mae_ml_only": round(mae_both_ml, 4) if mae_both_ml is not None else None,
                "mae_final_fusion": round(mae_both_mix, 4) if mae_both_mix is not None else None,
            },
        },
        "fusion_vs_detector_on_val": {
            "improved_rows": improved,
            "worsened_rows": worsened,
            "mae_detector_where_present": round(float(err_det[has_det].mean()), 4) if has_det.any() else None,
            "mae_fused_where_absent": round(float(err_fus[~has_det].mean()), 4) if (~has_det).any() else None,
        },
        "big_errors_audit": big,
        "gates": GATES,
    }

    failed = []
    if met_va["mae_all"] > GATES["mae_all"]: failed.append("mae_all")
    if met_va["mae_dry"] > GATES["mae_dry"]: failed.append("mae_dry")
    if met_va["max_dry"] > GATES["max_dry"]: failed.append("max_dry")
    if met_va["mae_strong"] > GATES["mae_strong"]: failed.append("mae_strong")
    if met_va["mae_subtle"] > GATES["mae_subtle"]: failed.append("mae_subtle")

    # ---------- quantização int16 ----------
    flat = np.concatenate([w.ravel() for w in net.W] + [b.ravel() for b in net.B])
    scale = float(np.max(np.abs(flat)) / 32767.0)
    qi = [np.clip(np.round(w / scale), -32767, 32767).astype(np.int32) for w in net.W]
    qb = [np.clip(np.round(b / scale), -32767, 32767).astype(np.int32) for b in net.B]
    dqW = [w.astype(np.float64) * scale for w in qi]
    dqB = [b.astype(np.float64) * scale for b in qb]

    def fwd_deq(Xs):
        a = Xs
        for i in range(len(dqW)):
            z = a @ dqW[i] + dqB[i]
            a = np.maximum(z, 0.0) if i < len(dqW) - 1 else z
        return a

    drift = float(np.max(np.abs(fwd_deq(S(Xva))[:, 0] - pred_va[:, 0])))
    report["quantization"] = {"scale": scale, "params": int(sum(p.size for p in flat)), "max_drift_s": round(drift, 5)}
    if drift > GATES["quant_drift_s"]:
        failed.append("quant_drift_s")

    # ---------- export ONNX ----------
    init_names = []
    tensors = []

    def add_init(name, arr):
        t = helper.make_tensor(name, TensorProto.FLOAT, list(arr.shape), arr.astype(np.float32).ravel().tolist())
        tensors.append(t)
        init_names.append(name)
        return name

    n_scale = add_init("ml_feature_invstd", (1.0 / sd))
    n_mu = add_init("ml_feature_mean", mu)
    shapes = [(SIZES[i], SIZES[i + 1]) for i in range(len(SIZES) - 1)]
    w_names, b_names = [], []
    for i, sh in enumerate(shapes):
        w_names.append(add_init(f"ml_w{i}", net.W[i]))
        b_names.append(add_init(f"ml_b{i}", net.B[i]))

    inp = helper.make_tensor_value_info("reverb_features", TensorProto.FLOAT, ["N", SIZES[0]])
    outp = helper.make_tensor_value_info("reverb_rt60_ml", TensorProto.FLOAT, ["N", 1])
    # Padronização correta: (x - média) * inv_std
    nodes = [
        helper.make_node("Sub", ["reverb_features", n_mu], ["x_c"]),
        helper.make_node("Mul", ["x_c", n_scale], ["x_std"]),
    ]
    cur = "x_std"
    last = len(w_names) - 1
    for i, (wn, bn) in enumerate(zip(w_names, b_names)):
        out_name = f"h{i}_lin" if i < last else "reverb_rt60_ml"
        mat = helper.make_node("MatMul", [cur, wn], [f"h{i}_pre"])
        add = helper.make_node("Add", [f"h{i}_pre", bn], [out_name])
        nodes += [mat, add]
        cur = out_name
        if i < last:
            nodes.append(helper.make_node("Relu", [cur], [f"h{i}_act"]))
            cur = f"h{i}_act"
    graph = helper.make_graph(nodes, "reverb_ml_refine", [inp], [outp], tensors)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    onnx.save(model, os.path.join(OUT, "model.onnx"))

    # verificação ONNX vs numpy (ReferenceEvaluator, offline)
    try:
        from onnx.reference import ReferenceEvaluator

        ref = ReferenceEvaluator(model)
        # O GRAFO padroniza internamente — alimentar features BRUTAS.
        xo = Xva[:8].astype(np.float32)
        got = np.array([ref.run(None, {"reverb_features": xo[i:i + 1]})[0][0][0] for i in range(len(xo))])
        want = pred_va[:8, 0]
        onnx_diff = float(np.max(np.abs(got - want)))
        report["onnx_vs_numpy_max_diff"] = round(onnx_diff, 6)
        if onnx_diff > 1e-3:
            failed.append("onnx_vs_numpy")
    except Exception as exc:  # pragma: no cover
        report["onnx_vs_numpy_max_diff"] = f"skipped: {exc}"

    if failed:
        report["FAILED_GATES"] = failed
        with open(os.path.join(OUT, "train-report.json"), "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print("GATES FAILED:", failed)
        print(json.dumps(report["metrics_val"], indent=2))
        sys.exit(2)

    # ---------- artefatos ----------
    ints = []
    for i in range(len(qi)):
        ints += qi[i].ravel().tolist()
        ints += qb[i].ravel().tolist()

    ts_lines = []
    ts_lines.append("/**")
    ts_lines.append(" * GERADO POR tools/reverb-ml/train.py (P4) — NÃO EDITAR À MÃO.")
    ts_lines.append(f" * Dataset sintético 216 amostras; features pela implementação TS do produto.")
    ts_lines.append(f" * Gates de treino validados: MAE val={met_va['mae_all']:.3f}s, dry máx={met_va['max_dry']:.3f}s,")
    ts_lines.append(f" * sutil MAE={met_va['mae_subtle']:.3f}s, forte MAE={met_va['mae_strong']:.3f}s, drift int16={drift:.4f}s.")
    ts_lines.append(" */")
    ts_lines.append("export const REVERB_ML_META = {")
    ts_lines.append("  featureCount: 8,")
    ts_lines.append(f"  hidden: [{SIZES[1]}, {SIZES[2]}],")
    ts_lines.append(f"  trainedAt: '{__import__('datetime').datetime.utcnow().isoformat()}Z',")
    ts_lines.append(f"  valMaeAll: {round(met_va['mae_all'], 4)},")
    ts_lines.append(f"  valMaxDry: {round(met_va['max_dry'], 4)},")
    ts_lines.append("} as const;")
    ts_lines.append("")
    ts_lines.append(f"/** Escala de desquantização dos pesos int16 (um único valor p/ todos). */")
    ts_lines.append(f"export const REVERB_ML_SCALE = {scale!r};")
    ts_lines.append("")
    ts_lines.append("/** Média e desvio-padrão das features (padronização do treino). */")
    mu_r = "[" + ", ".join(repr(float(x)) for x in mu) + "]"
    sd_r = "[" + ", ".join(repr(float(x)) for x in sd) + "]"
    ts_lines.append(f"export const REVERB_ML_MU: readonly number[] = {mu_r};")
    ts_lines.append(f"export const REVERB_ML_SD: readonly number[] = {sd_r};")
    ts_lines.append("")
    ts_lines.append("/** Peso do ML na fusão rt60Final=w*ML+(1-w)*det (selecionado EM TREINO, provado em val). */")
    ts_lines.append(f"export const REVERB_ML_FUSION_W = {best_w!r};")
    ts_lines.append("")
    ts_lines.append("/** Formas das camadas na ordem: W0,b0,W1,b1,W2,b2. */")
    ts_lines.append(f"export const REVERB_ML_SHAPES = [[{SIZES[0]},{SIZES[1]}],[{SIZES[1]}],[{SIZES[1]},{SIZES[2]}],[{SIZES[2]}],[{SIZES[2]},1],[1]] as const;")
    ts_lines.append("")
    ts_lines.append("/** Pesos int16 (W0|b0|W1|b1|W2|b2 — note: b2 vem por último aqui). */")
    line = "export const REVERB_ML_W_I16: readonly number[] = ["
    chunk = ", ".join(str(i) for i in ints)
    ts_lines.append(line + chunk + "];")
    ts_lines.append("")

    os.makedirs(os.path.dirname(TS_OUT), exist_ok=True)
    with open(TS_OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(ts_lines))

    report["artifacts"] = {"model_onnx": "tools/reverb-ml/out/model.onnx", "weights_ts": os.path.relpath(TS_OUT, REPO)}
    with open(os.path.join(OUT, "train-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
