"""Baseline: the strongest conventional method for every function, as measured in the research evaluation, behind the same
interface as the foundation models, so the app can switch between them.

  zoning        jump detector on robust-z spectral-geology features (eval/segments.py --features geo), tau from training holes
  completion    TIR from SWIR: MLP on standardised SWIR plus its +-1 m and +-5 m means ("mlp_ctx", eval/recon_extra.py);
                TIR mineral group: logistic regression on 256 PCs of SWIR ("logistic_pca256", eval/baselines_extra.py)
  anomaly       RX (Mahalanobis, Ledoit-Wolf covariance) of the geology features within the hole ("geo__rx_hole")
  gold          gradient boosting on per-metre geology features + smoothed software-mineral shares ("geomin__supervised_gbm")
  analogue      cosine similarity of 2 m means of 20 SWIR + 20 TIR principal components ("pca", eval/retrieval.py)
  core types    k-means (12) on the same 40 PCs, named by their software mineral make-up (for display only)
The feature functions here are shared with build/export_baseline.py, so serving and fitting compute the same numbers.
"""
from __future__ import annotations

import json, pickle, threading
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.covariance import LedoitWolf

from . import names as N
from .engine import Engine, geo_features, local_contrast  # noqa: F401  (local_contrast kept for parity of imports)

CLIP = 20.0


def std_swir(x, med, scale):
    return np.clip((np.asarray(x, "f4") - med) / scale, -CLIP, CLIP)


def std_tir(x_sel, med, scale):
    return np.clip((np.asarray(x_sel, "f4") - med) / scale, -CLIP, CLIP)


def window_mean(x, half):
    """Mean over tokens i-half .. i+half (truncated at the ends) along axis 0."""
    n = len(x); c = np.cumsum(np.vstack([np.zeros((1, x.shape[1]), "f8"), x.astype("f8")]), 0); i = np.arange(n)
    lo, hi = np.clip(i - half, 0, n), np.clip(i + half + 1, 0, n)
    return ((c[hi] - c[lo]) / (hi - lo)[:, None]).astype("f4")


def ctx_feats(xs, pieces):
    """[x, mean +-1 m, mean +-5 m] within each scan piece (eval/recon_extra.ctx_feats)."""
    out = np.zeros((len(xs), xs.shape[1] * 3), "f4")
    for s, n in pieces:
        x = xs[s:s + n]; out[s:s + n] = np.hstack([x, window_mean(x, 10), window_mean(x, 50)])
    return out


class MLP(nn.Module):
    def __init__(self, d_in, d_out, h=512):
        super().__init__(); self.net = nn.Sequential(nn.Linear(d_in, h), nn.GELU(), nn.Linear(h, h), nn.GELU(), nn.Linear(h, d_out))

    def forward(self, x):
        return self.net(x)


def geo_z1(G, med, mad):
    return np.nan_to_num(np.clip((G - med) / mad, -10, 10)).astype("f4")


def smooth_onehot(labels, classes, pieces, half=5):
    oh = np.stack([(labels == c).astype("f4") for c in classes], 1) if len(classes) else np.zeros((len(labels), 0), "f4")
    out = np.zeros_like(oh)
    for s, n in pieces:
        out[s:s + n] = window_mean(oh[s:s + n], half)
    return out


def rx_scores(X):
    """Mahalanobis distance of every row to the hole mean, Ledoit-Wolf covariance (eval/baselines_extra.maha / shrunk_cov)."""
    n, d = X.shape
    cov = LedoitWolf().fit(X).covariance_ if n > d + 2 else np.diag(X.var(0) + 1e-3)
    P = np.linalg.inv(cov + 1e-3 * np.eye(d) * max(np.trace(cov) / d, 1e-6)); z = X - X.mean(0)
    return np.sqrt(np.maximum(np.einsum("ij,jk,ik->i", z, P, z), 0) / d).astype("f4")


def token_features(R, H, sw_std, has_t):
    """Everything the baseline needs per token, from the processed hole R."""
    tz = std_tir(R["tir"].astype("f4")[:, H["tir_sel"]], H["t_med"], H["t_scale"]); tz[~has_t] = 0
    X40 = np.hstack([H["pca_s"].transform(sw_std), np.where(has_t[:, None], H["pca_t"].transform(tz), 0)]).astype("f4")
    return X40, tz


class BaselineEngine(Engine):
    def __init__(self, bundle: Path, store, spectra: Path | None = None):
        B = Path(bundle); self.store = store
        sp = np.load(spectra or B / "spectra.npz")
        self.swir_wl, self.tir_wl_all, self.tir_sel = sp["swir_wl"], sp["tir_wl_all"], sp["tir_sel"]; self.tir_wl = self.tir_wl_all[self.tir_sel]
        self.s_med, self.s_scale, self.t_med, self.t_scale = sp["s_med"], sp["s_scale"], sp["t_med"], sp["t_scale"]
        with open(B / "heads.pkl", "rb") as f:
            self.H = pickle.load(f)
        self.H.update(tir_sel=self.tir_sel, t_med=self.t_med, t_scale=self.t_scale)
        self.core = {c["k"]: c for c in self.H["core"]}
        st = torch.load(B / "mlp.pt", map_location="cpu", weights_only=False)
        self.mlp = MLP(st["d_in"], st["d_out"]); self.mlp.load_state_dict(st["state"]); self.mlp.eval(); self.mx, self.sx = st["mx"], st["sx"]
        lib = np.load(B / "library.npz", allow_pickle=False)
        self.L = {k: lib[k] for k in lib.files}; self.L["Z"] = self.L["Z"].astype("f4")
        self.card = json.loads((B / "card.json").read_text()); self.run = self.card.get("run", "baseline")
        self.model_info = {"run": self.run, "step": 0, "name": self.card.get("name", "Baseline"), "zh": self.card.get("zh", ""), "desc": self.card.get("desc", "")}
        R_ = store.ref_dir
        self.collars = json.loads((R_ / "collars.json").read_text()) if (R_ / "collars.json").exists() else {"wa": [], "holes": []}
        self.col_by = {r[0]: r for r in self.collars["holes"]}
        lat = {h: (r[1], r[2]) for h, r in self.col_by.items()}
        self.L["lat"] = np.array([lat.get(h, (np.nan, np.nan))[0] for h in self.L["hole"]], "f4"); self.L["lon"] = np.array([lat.get(h, (np.nan, np.nan))[1] for h in self.L["hole"]], "f4")
        self.qc = pd.read_csv(R_ / "qc_issues.csv.gz", dtype=str).fillna("") if (R_ / "qc_issues.csv.gz").exists() else pd.DataFrame(columns=["hole", "issue"])
        self.qc_summary = json.loads((R_ / "qc_summary.json").read_text()) if (R_ / "qc_summary.json").exists() else {}
        self.cache: dict[str, dict] = {}; self.locks: dict[str, threading.Lock] = {}; self._llock = threading.Lock(); self.timing: dict[str, float] = {}

    def _compute(self, hole):
        z = np.load(self.store.proc / f"{hole}.npz", allow_pickle=False); R = {k: z[k] for k in z.files}
        dsn = R["dsn"]; br = np.r_[0, np.flatnonzero(np.diff(dsn)) + 1, len(dsn)]; R["pieces"] = [(int(br[i]), int(br[i + 1] - br[i])) for i in range(len(br) - 1)]
        H = self.H; has_t = R["n_tir"] > 0; R["has_t"] = has_t; gt = R["gt"]; okt = has_t & ~np.isin(gt, list(N.BAD))
        sw = std_swir(R["swir"], self.s_med, self.s_scale)
        X40, tz = token_features(R, H, sw, has_t); R["F"] = X40
        R["core"] = np.array([H["km_order"][k] for k in H["km"].predict(X40)])
        # 1 fill in TIR: MLP with context; TIR group: logistic on 256 SWIR PCs
        cf = (ctx_feats(sw, R["pieces"]) - self.mx) / self.sx
        with torch.inference_mode():
            pt = np.concatenate([self.mlp(torch.from_numpy(cf[i:i + 4096])).numpy() for i in range(0, len(cf), 4096)]) if len(cf) else np.zeros((0, len(self.tir_sel)), "f4")
        R["tir_pred"] = pt * self.t_scale + self.t_med
        P = H["tir_lr"].predict_proba(H["pca256"].transform(sw)); cls = H["tir_lr"].classes_; R["tir_cls"] = cls[P.argmax(1)]; R["tir_conf"] = P.max(1)
        R["tir_r2"] = float(1 - ((pt[has_t] - tz[has_t]) ** 2).sum() / max((tz[has_t] ** 2).sum(), 1e-9)) if has_t.sum() >= 20 else None
        ev = okt & np.isin(gt, list(cls)); R["tir_acc"] = float((R["tir_cls"][ev] == gt[ev]).mean()) if ev.sum() >= 20 else None
        # geology features: zoning, anomaly, gold, descriptions
        G = geo_features(R["swir"].astype("f4"), R["tir"].astype("f4"), has_t, self.swir_wl, self.tir_wl_all); R["G"] = G
        order = np.argsort(R["depth"], kind="stable"); R["order"] = order
        R["segments"] = self._segments(R, order, geo_z1(G, H["seg_med"], H["seg_mad"]), okt)
        g1 = geo_z1(G, H["rx_med"], H["rx_mad"]); g2 = (g1 - H["rx_mu"]) / H["rx_sd"]
        lc = rx_scores(g2.astype("f8")) if len(g2) > 2 else np.zeros(len(g2), "f4"); R["lc"] = lc
        R["lc_pct"] = np.searchsorted(H["rx_ref_q"], lc) / (len(H["rx_ref_q"]) - 1)
        mins = np.hstack([smooth_onehot(R["gs"], H["min_gs"], R["pieces"]), smooth_onehot(R["gt"], H["min_gt"], R["pieces"])])
        mins = (mins - H["min_mu"]) / H["min_sd"]; blk = (np.hstack([g1, mins]) - H["blk_mu"]) / H["blk_sd"]
        m = np.floor(R["depth"]).astype(int); um, inv = np.unique(m, return_inverse=True); E = np.zeros((len(um), blk.shape[1]), "f8"); np.add.at(E, inv, blk); E /= np.bincount(inv)[:, None]
        R["metres"] = um; R["m_inv"] = inv; R["gold_p"] = H["gbm"].predict_proba(E.astype("f4"))[:, 1]
        R["gold_pct"] = np.searchsorted(H["gold_ref_q"], R["gold_p"]) / (len(H["gold_ref_q"]) - 1)
        return R
