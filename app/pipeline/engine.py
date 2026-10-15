"""CoreScope engine: runs the foundation model on one hole and derives the six functions from its output.

Every step follows the research code it was evaluated with (named at each function), so the app gives the same
answers as the evaluation page:
  1 fill in TIR        model with the whole TIR hidden -> rebuilt TIR spectrum + TIR mineral group (linear probe)
  2 auto log           jump detector on the model's representation, tau from training holes, rule-based description
  3 unusual intervals  local contrast of the representation against +-15 m of the same hole, as a State percentile
  4 gold prediction    linear probe on per-metre mean representations, fitted on train + val holes
  5 data quality       issue list from the cleaning pipeline (no model)
  6 similar intervals  cosine similarity of 2 m fingerprints against every 2 m interval of the State's 1,696 holes
"""
from __future__ import annotations

import json, os, pickle, threading, time, warnings
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from scipy.ndimage import uniform_filter1d

from . import names as N
from .fm_model import SEQ_LEN, CoreFM

K_HALF, GAP_TOK, LEN = 20, 10, 20          # segments: 2 m either side, a gap > 1 m is a boundary; similar: 2 m intervals
ANOM_FLAG = 0.98                           # score of a metre = its most unusual 10 cm, as a percentile of the State's training core
ANOM_TOP = 0.03                            # flagged = the top 3 % of metres in the hole, and above ANOM_FLAG (single 10 cm tokens are noisy,
                                           # so the 98th percentile alone flags 7-16 % of metres)

# ───────────────────────────── spectral-geology features (eval/geo_features.py) ─────────────────────────────
MIN_DEPTH = 0.02
FEATS = ["alb", "vis_slope", "d900", "w900", "d1400", "w1400", "d1900", "d2160", "d2200", "w2200", "d2250", "w2250", "d2335", "w2335", "cryst",
         "talb", "tq", "tfmi", "tc11", "w11", "tc65", "tfs", "tq12"]
FEAT_ZH = {"alb": "整体亮度", "vis_slope": "可见光红化（铁氧化物）", "d900": "900 nm 铁氧化物吸收深度", "d1400": "1400 nm 羟基吸收深度", "d1900": "1900 nm 水吸收深度",
           "d2160": "2160 nm 高岭石肩", "d2200": "2200 nm 铝羟基吸收深度（白云母、黏土）", "w2200": "白云母吸收位置", "d2250": "2250 nm 铁羟基吸收深度（绿泥石）",
           "w2250": "绿泥石吸收位置", "d2335": "2335 nm 镁羟基 / 碳酸盐吸收深度", "w2335": "2335 nm 吸收位置", "cryst": "白云母 / 黏土结晶度",
           "talb": "热红外整体亮度", "tq": "石英峰强度（热红外）", "tfmi": "长英质–镁铁质指数（热红外）", "tc11": "碳酸盐 11.3 µm 峰", "tfs": "长石 / 镁铁质 相对石英", "tq12": "石英次峰"}


def _cr(x, wl, a, b, lo, hi):
    ia, ib = int(np.abs(wl - a).argmin()), int(np.abs(wl - b).argmin())
    ra, rb = x[:, max(ia - 1, 0):ia + 2].mean(1), x[:, max(ib - 1, 0):ib + 2].mean(1)
    sel = np.flatnonzero((wl >= lo) & (wl <= hi)); seg = x[:, sel]; cont = ra[:, None] + (rb - ra)[:, None] * ((wl[sel] - wl[ia]) / (wl[ib] - wl[ia]))[None]
    dep = 1 - seg / np.maximum(cont, 1e-6); j = dep.argmax(1); d = dep[np.arange(len(x)), j]
    return d, np.where(d >= MIN_DEPTH, wl[sel][j], np.nan)


def _band(x, wl, lo, hi):
    return x[:, (wl >= lo) & (wl <= hi)].mean(1)


def geo_features(xs, xt, has_t, ws, wt):
    d900, w900 = _cr(xs, ws, 750, 1250, 820, 1050); d14, w14 = _cr(xs, ws, 1340, 1500, 1380, 1450); d19, _ = _cr(xs, ws, 1840, 2060, 1890, 1960)
    d216, _ = _cr(xs, ws, 2130, 2190, 2155, 2175); d22, w22 = _cr(xs, ws, 2130, 2245, 2180, 2230); d225, w225 = _cr(xs, ws, 2230, 2285, 2240, 2265); d233, w233 = _cr(xs, ws, 2285, 2400, 2300, 2360)
    s = [_band(xs, ws, 1000, 2400), _band(xs, ws, 700, 750) / np.maximum(_band(xs, ws, 450, 500), 1e-3), d900, w900, d14, w14, d19, d216, d22, w22, d225, w225, d233, w233, d22 / (np.maximum(d19, 0) + 0.02)]
    tm = np.maximum(_band(xt, wt, 6500, 14000), 1e-4); sel = np.flatnonzero((wt >= 7500) & (wt <= 12000)); sm = uniform_filter1d(xt[:, sel], 5, axis=1)
    side = (_band(xt, wt, 10500, 10900) + _band(xt, wt, 11700, 12100)) / 2; tc11 = _band(xt, wt, 11100, 11500) / np.maximum(side, 1e-4)
    c11 = np.flatnonzero((wt >= 11000) & (wt <= 11600)); w11 = np.where(tc11 > 1.05, wt[c11][xt[:, c11].argmax(1)], np.nan)
    t = [tm, _band(xt, wt, 8000, 9500) / tm, wt[sel][sm.argmax(1)], tc11, w11, _band(xt, wt, 6500, 6700) / np.maximum(_band(xt, wt, 6900, 7300), 1e-4),
         _band(xt, wt, 9500, 10000) / np.maximum(_band(xt, wt, 8000, 9500), 1e-4), _band(xt, wt, 12300, 13000) / tm]
    t = [np.where(has_t, v, np.nan) for v in t]
    return np.stack(s + t, 1).astype("f4")


# ───────────────────────────── segmentation (eval/segments.py) ─────────────────────────────
def jump_score(x, k=K_HALF):
    c = np.cumsum(np.vstack([np.zeros((1, x.shape[1])), x]), 0); n = len(x); i = np.arange(n)
    up = (c[i] - c[np.clip(i - k, 0, n)]) / np.maximum(i - np.clip(i - k, 0, n), 1)[:, None]; dn = (c[np.clip(i + k, 0, n)] - c[i]) / np.maximum(np.clip(i + k, 0, n) - i, 1)[:, None]
    s = np.sqrt(((up - dn) ** 2).mean(1)); s[:k] = 0; s[-k:] = 0
    return s


def cut(score, tau, k=K_HALF):
    loc = np.flatnonzero((score[1:-1] >= score[:-2]) & (score[1:-1] >= score[2:]) & (score[1:-1] > tau)) + 1; picks = []
    for j in loc[np.argsort(-score[loc])]:
        if all(abs(j - q) >= k for q in picks):
            picks.append(j)
    return np.sort(np.array(picks, int))


def hole_boundaries(idx, X, bins, tau):
    gaps = np.flatnonzero(np.diff(bins[idx]) > GAP_TOK) + 1; pieces = np.split(np.arange(len(idx)), gaps); starts, sc = [], []
    for p in pieces:
        if len(p) > 2 * K_HALF:
            s = jump_score(X[idx[p]].astype("f8")); b = cut(s, tau); starts += list(p[b]); sc += list(s[b])
    gap_set = set(gaps.tolist())
    out = sorted([(int(g), np.inf) for g in gaps] + [(int(b), float(v)) for b, v in zip(starts, sc) if b not in gap_set])
    return np.array([o[0] for o in out], int), np.array([o[1] for o in out])


# ───────────────────────────── anomaly (eval/model_tasks.local_contrast) ─────────────────────────────
def local_contrast(F, pieces, w_out=150, w_in=10):
    out = np.zeros(len(F), "f4")
    for s0, n in pieces:
        x = F[s0:s0 + n].astype("f8"); i = np.arange(n)
        c1 = np.cumsum(np.vstack([np.zeros((1, x.shape[1])), x]), 0); c2 = np.cumsum(np.vstack([np.zeros((1, x.shape[1])), x * x]), 0)
        lo, hi = np.clip(i - w_out, 0, n), np.clip(i + w_out + 1, 0, n); li, hi2 = np.clip(i - w_in, 0, n), np.clip(i + w_in + 1, 0, n)
        cnt = np.maximum((hi - lo) - (hi2 - li), 1)[:, None]
        mu = ((c1[hi] - c1[lo]) - (c1[hi2] - c1[li])) / cnt; var = ((c2[hi] - c2[lo]) - (c2[hi2] - c2[li])) / cnt - mu * mu
        out[s0:s0 + n] = np.sqrt((((x - mu) ** 2) / np.maximum(var, 1e-3)).mean(1))
    return out


def window_jobs(pieces):
    """(start, n, first kept, last kept): windows of SEQ_LEN with stride SEQ_LEN/2, each token keeps the window where it is most central (fm/embed.py)."""
    L, S, jobs = SEQ_LEN, SEQ_LEN // 2, []
    for s_, n in pieces:
        starts = [0] if n <= L else list(range(0, n - L, S)) + [n - L]
        for j, s0 in enumerate(starts):
            lo = 0 if j == 0 else (starts[j - 1] + L + s0) // 2 - s0; hi = min(L, n - s0) if j == len(starts) - 1 else (s0 + L + starts[j + 1]) // 2 - s0
            jobs.append((s_ + s0, min(L, n - s0), lo, hi))
    return jobs


def _mode(a):
    a = [x for x in a if x not in N.BAD]
    return pd.Series(a).value_counts().index[0] if a else ""


def _f(x, nd=3):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


class Engine:
    def __init__(self, bundle: Path, store, spectra: Path | None = None):
        B = Path(bundle); self.store = store
        sp = np.load(spectra or B / "spectra.npz")
        self.swir_wl, self.tir_wl_all, self.tir_sel = sp["swir_wl"], sp["tir_wl_all"], sp["tir_sel"]; self.tir_wl = self.tir_wl_all[self.tir_sel]
        self.s_med, self.s_scale, self.t_med, self.t_scale = sp["s_med"], sp["s_scale"], sp["t_med"], sp["t_scale"]
        ck = torch.load(B / "model.pt", map_location="cpu", weights_only=False)
        self.model = CoreFM(len(self.swir_wl), len(self.tir_sel), ck["args"]["d"], ck["args"]["layers"]); self.model.load_state_dict(ck["model"]); self.model.eval()
        # CORETRACE_DEVICE=cuda|cpu; a GPU when there is one. The outputs match the CPU to float precision.
        self.device = torch.device(os.environ.get("CORETRACE_DEVICE") or ("cuda" if torch.cuda.is_available() else "cpu")); self.model.to(self.device)
        self.model_info = {"run": ck.get("run"), "step": ck.get("step")}
        with open(B / "heads.pkl", "rb") as f:
            self.H = pickle.load(f)
        self.core = {c["k"]: c for c in self.H["core"]}
        lib = np.load(B / "library.npz", allow_pickle=False)
        self.L = {k: lib[k] for k in lib.files}; self.L["Z"] = self.L["Z"].astype("f4")
        self.card = json.loads((B / "card.json").read_text())
        self.run = self.card.get("run") or ck.get("run") or B.name
        self.model_info = {"run": self.run, "step": ck.get("step"), "name": self.card.get("name", self.run), "zh": self.card.get("zh", ""), "desc": self.card.get("desc", "")}
        R_ = store.ref_dir
        self.collars = json.loads((R_ / "collars.json").read_text()) if (R_ / "collars.json").exists() else {"wa": [], "holes": []}
        self.col_by = {r[0]: r for r in self.collars["holes"]}
        lat = {h: (r[1], r[2]) for h, r in self.col_by.items()}
        self.L["lat"] = np.array([lat.get(h, (np.nan, np.nan))[0] for h in self.L["hole"]], "f4"); self.L["lon"] = np.array([lat.get(h, (np.nan, np.nan))[1] for h in self.L["hole"]], "f4")
        self.qc = pd.read_csv(R_ / "qc_issues.csv.gz", dtype=str).fillna("") if (R_ / "qc_issues.csv.gz").exists() else pd.DataFrame(columns=["hole", "issue"])
        self.qc_summary = json.loads((R_ / "qc_summary.json").read_text()) if (R_ / "qc_summary.json").exists() else {}
        self.cache: dict[str, dict] = {}; self.locks: dict[str, threading.Lock] = {}; self._llock = threading.Lock()
        self.timing: dict[str, float] = {}

    def _lock(self, hole):
        with self._llock:
            return self.locks.setdefault(hole, threading.Lock())

    # ─────────────── model passes ───────────────
    def _batch(self, R, chunk, hide_tir):
        L = SEQ_LEN; n_b = len(chunk); nb_s, nb_t = len(self.swir_wl), len(self.tir_sel)
        sw = np.zeros((n_b, L, nb_s), "f4"); ti = np.zeros((n_b, L, nb_t), "f4"); pos = np.zeros((n_b, L), "i8"); ht = np.zeros((n_b, L), bool); pad = np.ones((n_b, L), bool); aux = np.zeros((n_b, L, 4), "f4")
        for j, (s, n, _, _) in enumerate(chunk):
            sl = slice(s, s + n)
            sw[j, :n] = (R["swir"][sl].astype("f4") - self.s_med) / self.s_scale
            t = (R["tir"][sl].astype("f4")[:, self.tir_sel] - self.t_med) / self.t_scale; h_ = R["n_tir"][sl] > 0; t[~h_] = 0; ti[j, :n] = t; ht[j, :n] = h_
            pad[j, :n] = False; pos[j, :n] = R["bin"][sl] - R["bin"][s]
            aux[j, :n] = np.stack([np.log1p(R["n_swir"][sl]) / 3, np.log1p(R["n_tir"][sl]) / 3, R["sd"][sl, 0] * 10, R["sd"][sl, 1] * 10], 1)
        b = {"swir": torch.from_numpy(sw), "tir": torch.from_numpy(ti), "pos": torch.from_numpy(pos), "has_tir": torch.from_numpy(ht), "pad": torch.from_numpy(pad),
             "aux": torch.from_numpy(aux), "inst": torch.zeros(n_b, dtype=torch.long)}
        m = None
        if hide_tir:                                            # as eval/model_tasks.py C: the TIR sample count and spread would give the TIR away
            b["aux"][..., 1] = 0; b["aux"][..., 3] = 0; z = torch.zeros_like(b["pad"])
            m = {"hide_s": z, "hide_t": ~b["pad"], "band_s": torch.zeros_like(b["swir"], dtype=torch.bool), "band_t": torch.zeros_like(b["tir"], dtype=torch.bool)}
        return b, m

    def _run(self, R, hide_tir, bs=None):
        n = len(R["depth"]); hh = np.zeros((n, self.model.norm.normalized_shape[0]), "f4"); pt = np.zeros((n, len(self.tir_sel)), "f4") if hide_tir else None
        jobs = window_jobs(R["pieces"]); bs = bs or (64 if self.device.type == "cuda" else 16); dev = self.device
        with torch.inference_mode():
            for i in range(0, len(jobs), bs):
                chunk = jobs[i:i + bs]; b, m = self._batch(R, chunk, hide_tir)
                if dev.type != "cpu":
                    b = {k: v.to(dev) for k, v in b.items()}; m = None if m is None else {k: v.to(dev) for k, v in m.items()}
                h, _, t = self.model(b, m); h = h.cpu().numpy(); t = t.cpu().numpy()
                for j, (s, n_, lo, hi) in enumerate(chunk):
                    hh[s + lo:s + hi] = h[j, lo:hi]
                    if hide_tir:
                        pt[s + lo:s + hi] = t[j, lo:hi]
        return hh, pt

    # ─────────────── one hole, all functions ───────────────
    def compute(self, hole: str) -> dict:
        if hole in self.cache:
            return self.cache[hole]
        with self._lock(hole):
            if hole in self.cache:
                return self.cache[hole]
            t0 = time.time(); (self.store.res / self.run).mkdir(parents=True, exist_ok=True); pk = self.store.res / self.run / f"{hole}.pkl"
            if pk.exists():
                try:
                    with open(pk, "rb") as f:
                        R = pickle.load(f)
                    if R.get("_version") == self._version(hole):
                        self.cache[hole] = R; return R
                except Exception:                          # stale or partial file: recompute
                    pass
            R = self._compute(hole)
            R["_version"] = self._version(hole)
            try:
                with open(pk, "wb") as f:
                    pickle.dump(R, f)
            except OSError:
                pass
            self.cache[hole] = R; self.timing[hole] = round(time.time() - t0, 1)
            return R

    def _version(self, hole):
        """Results are recomputed when the model or the processed hole changes."""
        f = self.store.proc / f"{hole}.npz"
        return f"{self.model_info['run']}-{self.model_info['step']}-2-{int(f.stat().st_mtime) if f.exists() else 0}"

    def _compute(self, hole):
        z = np.load(self.store.proc / f"{hole}.npz", allow_pickle=False); R = {k: z[k] for k in z.files}
        dsn = R["dsn"]; br = np.r_[0, np.flatnonzero(np.diff(dsn)) + 1, len(dsn)]; R["pieces"] = [(int(br[i]), int(br[i + 1] - br[i])) for i in range(len(br) - 1)]
        H = self.H
        emb, _ = self._run(R, hide_tir=False)
        emb_t, pt = self._run(R, hide_tir=True)
        F = H["pca"].transform(emb).astype("f4"); R["F"] = F
        R["core"] = np.array([H["km_order"][k] for k in H["km"].predict(F)])
        has_t = R["n_tir"] > 0; R["has_t"] = has_t; gt = R["gt"]; okt = has_t & ~np.isin(gt, list(N.BAD))
        # 1 fill in TIR
        R["tir_pred"] = pt * self.t_scale + self.t_med
        P = H["tir_probe"].predict_proba(emb_t); cls = H["tir_probe"].classes_; R["tir_cls"] = cls[P.argmax(1)]; R["tir_conf"] = P.max(1)
        tz = (R["tir"].astype("f4")[:, self.tir_sel] - self.t_med) / self.t_scale
        R["tir_r2"] = float(1 - ((pt[has_t] - tz[has_t]) ** 2).sum() / max((tz[has_t] ** 2).sum(), 1e-9)) if has_t.sum() >= 20 else None
        ev = okt & np.isin(gt, list(cls)); R["tir_acc"] = float((R["tir_cls"][ev] == gt[ev]).mean()) if ev.sum() >= 20 else None
        # geo features (descriptions, "why" panel)
        R["G"] = geo_features(R["swir"].astype("f4"), R["tir"].astype("f4"), has_t, self.swir_wl, self.tir_wl_all)
        # 2 auto log
        order = np.argsort(R["depth"], kind="stable"); R["order"] = order
        R["segments"] = self._segments(R, order, F / H["seg_scale"], okt)
        # 3 unusual intervals
        lc = local_contrast(F, R["pieces"]); R["lc"] = lc; R["lc_pct"] = np.searchsorted(H["lc_ref_q"], lc) / (len(H["lc_ref_q"]) - 1)
        # 4 gold
        m = np.floor(R["depth"]).astype(int); um, inv = np.unique(m, return_inverse=True); E = np.zeros((len(um), emb.shape[1]), "f8"); np.add.at(E, inv, emb); E /= np.bincount(inv)[:, None]
        R["metres"] = um; R["m_inv"] = inv; R["gold_p"] = H["gold"].predict_proba(E.astype("f4"))[:, 1]
        R["gold_pct"] = np.searchsorted(H["gold_ref_q"], R["gold_p"]) / (len(H["gold_ref_q"]) - 1)
        return R

    def _segments(self, R, idx, X, okt):
        tau = self.H["tau"]; bins, depth, ms, gt, lab, G = R["bin"], R["depth"], R["ms"], R["gt"], R["core"], R["G"]; gi = {n: j for j, n in enumerate(FEATS)}
        st, sc = hole_boundaries(idx, X, bins, tau); edges = np.r_[0, st, len(idx)]; prev = None; out = []
        for s_i in range(len(edges) - 1):
            p = idx[edges[s_i]:edges[s_i + 1]]
            if len(p) == 0:
                continue
            d0, d1 = float(depth[p[0]]), float(depth[p[-1]] + 0.1)
            m_ok = ~np.isin(ms[p], list(N.NONROCK)); msh = pd.Series(ms[p][m_ok]).value_counts(normalize=True)
            t_ok = okt[p]; tsh = pd.Series(gt[p][t_ok]).value_counts(normalize=True); ct = pd.Series(lab[p]).value_counts(normalize=True)

            def med_if(feat, dep, share=0.3, thr=0.03):
                v = G[p, gi[feat]]; w = G[p, gi[dep]] >= thr
                return float(np.nanmedian(v[w])) if w.mean() >= share and np.isfinite(v[w]).any() else None
            w22, w225 = med_if("w2200", "d2200"), med_if("w2250", "d2250"); alb = float(np.nanmedian(G[p, gi["alb"]]))
            cur = {"ms": msh, "gt": tsh, "w2200": w22, "alb": alb, "mica": float(sum(msh.get(k, 0) for k in N.MICA))}
            asp = float(msh.get("Aspectral", 0)); topm = [(k, v) for k, v in msh.items() if v >= 0.10 and k != "Aspectral"][:3]
            topt = [(k, v) for k, v in tsh.items() if v >= 0.15][:2]; tir_share = float(t_ok.mean())
            mica, chl = float(sum(msh.get(k, 0) for k in N.MICA)), float(sum(msh.get(k, 0) for k in N.CHL))
            zh_, en_ = [f"{d0:.1f}–{d1:.1f} m（{d1-d0:.1f} m）"], [f"{d0:.1f}–{d1:.1f} m ({d1-d0:.1f} m)"]
            if len(p) < 10:
                zh_.append("不到 1 米的短段，矿物比例不可靠"); en_.append("shorter than 1 m, mineral shares unreliable")
            if asp >= 0.5:
                zh_.append(f"短波红外大多无响应（{asp:.0%}）"); en_.append(f"mostly no SWIR response ({asp:.0%})")
            if topm:
                zh_.append(("其余" if asp >= 0.5 else "短波红外") + "以" + "、".join(f"{N.ms_zh(k)} {v:.0%}" for k, v in topm) + " 为主")
                en_.append(("otherwise " if asp >= 0.5 else "SWIR ") + "dominated by " + ", ".join(f"{N.ms_en(k)} {v:.0%}" for k, v in topm))
            if tir_share >= 0.5 and topt:
                zh_.append("热红外以" + "、".join(f"{N.gt_zh(k)} {v:.0%}" for k, v in topt) + " 为主"); en_.append("TIR dominated by " + ", ".join(f"{N.gt_en(k)} {v:.0%}" for k, v in topt))
            elif tir_share < 0.5:
                zh_.append("热红外大部分缺失"); en_.append("TIR mostly missing")
            if w22 is not None and mica >= 0.3:
                kind = "偏富铝" if w22 < 2200 else ("偏多硅、富铁镁" if w22 > 2210 else "成分居中"); kind_en = "Al-rich" if w22 < 2200 else ("phengitic" if w22 > 2210 else "intermediate")
                zh_.append(f"白云母吸收在 {w22:.0f} nm，{kind}"); en_.append(f"white-mica absorption at {w22:.0f} nm, {kind_en}")
            if w225 is not None and chl >= 0.3:
                kind = "偏富镁" if w225 < 2249 else ("偏富铁" if w225 > 2255 else "铁镁居中"); kind_en = "Mg-rich" if w225 < 2249 else ("Fe-rich" if w225 > 2255 else "intermediate Fe-Mg")
                zh_.append(f"绿泥石吸收在 {w225:.0f} nm，{kind}"); en_.append(f"chlorite absorption at {w225:.0f} nm, {kind_en}")
            ch_zh, ch_en = [], []
            if prev is not None:
                if s_i > 0 and np.isinf(sc[s_i - 1]):
                    ch_zh.append("上方有岩芯缺失"); ch_en.append("core missing above")
                diffs = []
                for kk in set(prev["ms"].index) | set(cur["ms"].index):
                    dlt = cur["ms"].get(kk, 0) - prev["ms"].get(kk, 0)
                    if abs(dlt) >= 0.15:
                        diffs.append((abs(dlt), "短波红外无响应的比例" if kk == "Aspectral" else N.ms_zh(kk), "share without SWIR response" if kk == "Aspectral" else N.ms_en(kk), dlt))
                for kk in set(prev["gt"].index) | set(cur["gt"].index):
                    dlt = cur["gt"].get(kk, 0) - prev["gt"].get(kk, 0)
                    if abs(dlt) >= 0.15 and tir_share >= 0.5:
                        diffs.append((abs(dlt), N.gt_zh(kk) + "（热红外）", N.gt_en(kk) + " (TIR)", dlt))
                for _, z_, e, dlt in sorted(diffs, reverse=True)[:3]:
                    ch_zh.append(f"{z_}{'增加' if dlt > 0 else '减少'} {abs(dlt) * 100:.0f} 个百分点"); ch_en.append(f"{e} {'up' if dlt > 0 else 'down'} {abs(dlt) * 100:.0f} points")
                if w22 is not None and prev["w2200"] is not None and mica >= 0.3 and prev["mica"] >= 0.3 and abs(w22 - prev["w2200"]) >= 5:
                    ch_zh.append(f"白云母吸收向{'长' if w22 > prev['w2200'] else '短'}波移动 {abs(w22 - prev['w2200']):.0f} nm"); ch_en.append(f"white-mica absorption shifts {w22 - prev['w2200']:+.0f} nm")
                if prev["alb"] > 0 and (alb / prev["alb"] >= 1.25 or alb / prev["alb"] <= 0.8):
                    ch_zh.append("整体" + ("变亮" if alb > prev["alb"] else "变暗")); ch_en.append("brighter" if alb > prev["alb"] else "darker")
            desc_zh = "；".join(zh_) + "。" + ("与上一段相比：" + "，".join(ch_zh) + "。" if ch_zh else ("软件给的矿物和上一段相近，分界来自光谱上更细的差别。" if prev is not None else ""))
            desc_en = "; ".join(en_) + "." + (" Against the segment above: " + ", ".join(ch_en) + "." if ch_en else (" Software minerals similar to the segment above; the boundary comes from finer spectral differences." if prev is not None else ""))
            k0 = int(ct.index[0])
            out.append({"seg": s_i + 1, "from_m": round(d0, 2), "to_m": round(d1, 2), "length_m": round(d1 - d0, 2), "n_tokens": int(len(p)),
                        "boundary": None if s_i == 0 else ("gap" if np.isinf(sc[s_i - 1]) else round(float(sc[s_i - 1]), 3)),
                        "core_type": k0, "core_type_name": self.core[k0]["name"], "core_type_share": round(float(ct.iloc[0]), 3),
                        "swir_minerals": [[k, N.ms_zh(k), round(float(v), 3)] for k, v in msh.head(5).items()],
                        "tir_groups": [[k, N.gt_zh(k), round(float(v), 3)] for k, v in tsh.head(4).items()], "tir_share": round(tir_share, 3),
                        "w2200_nm": _f(w22, 1), "w2250_nm": _f(w225, 1), "albedo": _f(alb, 4), "desc_zh": desc_zh, "desc_en": desc_en})
            prev = cur
        return out

    # ─────────────── views for the front end ───────────────
    def hole_view(self, hole):
        R = self.compute(hole); M = self.store.meta(hole); meta = dict(M["meta"])
        sp = meta.get("split"); meta["seen_in_training"] = sp in ("train", "val")
        um, inv = R["metres"], R["m_inv"]; n = len(um)
        def per_metre(vals, fn):
            out = [None] * n; order = np.argsort(inv, kind="stable"); br = np.r_[0, np.flatnonzero(np.diff(inv[order])) + 1, len(order)]
            for k in range(n):
                out[k] = fn(vals[order[br[k]:br[k + 1]]])
            return out
        an = np.zeros(n, "f4"); np.maximum.at(an, inv, R["lc_pct"].astype("f4")); araw = np.zeros(n, "f4"); np.maximum.at(araw, inv, R["lc"].astype("f4"))
        au = np.full(n, np.nan, "f4"); amap = dict(zip(R["au_m"].tolist(), R["au_ppm"].tolist()))
        for k, mm in enumerate(um):
            if mm in amap:
                au[k] = amap[mm]
        lmap_c = dict(zip(R["lith_m"].tolist(), R["lith_c"].tolist())); lmap_r = dict(zip(R["lith_m"].tolist(), R["lith_raw"].tolist()))
        tc = per_metre(R["tir_cls"], _mode); tconf = per_metre(R["tir_conf"], lambda v: round(float(v.mean()), 3))
        view = {"hole": meta, "model": self.model_info, "timing_s": self.timing.get(hole), "report": M["report"],
                "m": um.tolist(), "gs": per_metre(R["gs"], _mode), "ms": per_metre(R["ms"], _mode), "gt": per_metre(np.where(R["has_t"], R["gt"], ""), _mode),
                "core": per_metre(R["core"], lambda v: int(pd.Series(v).mode().iloc[0])), "anom": [round(float(x), 4) for x in an], "anom_raw": [round(float(x), 2) for x in araw],
                "gold": [round(float(x), 4) for x in R["gold_p"]], "gold_pct": [round(float(x), 4) for x in R["gold_pct"]],
                "au": [None if not np.isfinite(x) else round(float(x), 4) for x in au], "lith": [lmap_c.get(int(x), None) for x in um], "lith_raw": [lmap_r.get(int(x), None) for x in um],
                "tir_pred": tc, "tir_conf": tconf, "has_tir": per_metre(R["has_t"], lambda v: bool(v.mean() >= 0.5)),
                "segments": R["segments"], "core_types": [{"k": c["k"], "name": c["name"], "share": round(c["share"], 3)} for c in self.H["core"]]}
        view["tir"] = {"r2": _f(R["tir_r2"]), "acc": _f(R["tir_acc"]), "measured": bool(R["has_t"].mean() >= 0.3)}
        view["anomaly"] = self._anomaly_summary(view, au)
        view["gold_summary"] = self._gold_summary(view, au)
        view["qc"] = M["report"]["qc"]                      # checks run by this server's pipeline on this hole
        return view

    @staticmethod
    def _auc(y, s):
        y = np.asarray(y, bool); s = np.asarray(s, float)
        if y.sum() < 5 or (~y).sum() < 5:
            return None
        r = pd.Series(s).rank().to_numpy(); return float((r[y].sum() - y.sum() * (y.sum() + 1) / 2) / (y.sum() * (~y).sum()))

    def _anomaly_summary(self, v, au):
        an = np.array(v["anom"]); raw = np.array(v["anom_raw"]); m = np.array(v["m"])
        # flag on the raw contrast (the percentile saturates at 100 % for the strongest metres), gated by the State percentile
        thr_raw = float(np.quantile(raw, 1 - ANOM_TOP)); flag = (raw >= thr_raw) & (an >= ANOM_FLAG); thr = float(an[flag].min()) if flag.any() else 1.0; runs = []
        k = 0
        while k < len(m):
            if flag[k]:
                j = k
                while j + 1 < len(m) and flag[j + 1] and m[j + 1] - m[j] <= 2:
                    j += 1
                pk = k + int(np.argmax(raw[k:j + 1])); runs.append({"from_m": int(m[k]), "to_m": int(m[j]) + 1, "peak_m": int(m[pk]), "peak": round(float(an[pk]), 4), "raw": round(float(raw[pk]), 2)}); k = j + 1
            else:
                k += 1
        runs = sorted(runs, key=lambda r: -r["raw"])[:20]
        ok = np.isfinite(au); y = au[ok] >= 0.1
        return {"flag_at": round(thr, 4), "flag_raw": round(thr_raw, 2), "median_raw": round(float(np.median(raw)), 2), "top_share": ANOM_TOP, "n_flag_m": int(flag.sum()), "share_flag": round(float(flag.mean()), 4), "runs": runs,
                "auc_gold": _f(self._auc(y, an[ok])) if ok.sum() else None, "au_m": int(ok.sum()), "au_pos": int(y.sum()) if ok.sum() else 0}

    def _gold_summary(self, v, au):
        p = np.array(v["gold"]); m = np.array(v["m"]); ok = np.isfinite(au); y = au[ok] >= 0.1; o = {"au_m": int(ok.sum()), "au_pos": int(y.sum()) if ok.sum() else 0}
        o["auc"] = _f(self._auc(y, p[ok])) if ok.sum() else None
        if ok.sum() >= 20 and y.sum():
            top = p[ok] >= np.quantile(p[ok], 0.9); o["top10_share"] = round(float(y[top].mean()), 3); o["base_share"] = round(float(y.mean()), 3)
        o["top"] = [{"m": int(m[i]), "p": round(float(p[i]), 3), "au": None if not np.isfinite(au[i]) else round(float(au[i]), 3)} for i in np.argsort(-p)[:15]]
        return o

    def metre_view(self, hole, metre):
        R = self.compute(hole); m = np.floor(R["depth"]).astype(int); sel = np.flatnonzero(m == metre)
        if not len(sel):
            raise KeyError(metre)
        # neighbourhood: same hole, within 15 m but not the metre itself +-1 m (as the anomaly score)
        dd = np.abs(R["depth"] - (metre + 0.5)); ring = np.flatnonzero((dd <= 15) & (dd > 1.5))
        ds = slice(None, None, 3)
        sw = R["swir"][sel].astype("f4").mean(0); swr = R["swir"][ring].astype("f4").mean(0) if len(ring) else None
        ht = R["has_t"]; ts = sel[ht[sel]]; tr = ring[ht[ring]] if len(ring) else ring
        tir_m = R["tir"][ts].astype("f4")[:, self.tir_sel].mean(0) if len(ts) else None
        tir_r = R["tir"][tr].astype("f4")[:, self.tir_sel].mean(0) if len(tr) else None
        tir_p = R["tir_pred"][sel].mean(0)
        def mix(idx, arr, ok=None):
            a = arr[idx] if ok is None else arr[idx][ok[idx]]; a = [str(x) for x in a if x not in N.BAD and x not in N.NONROCK]
            return pd.Series(a, dtype=str).value_counts(normalize=True).head(6).round(3).to_dict()
        okt = R["has_t"] & ~np.isin(R["gt"], list(N.BAD))
        why = []
        G = R["G"]
        if len(ring) >= 20:
            with warnings.catch_warnings():                # features undefined in the whole ring (e.g. no TIR) give all-NaN medians
                warnings.simplefilter("ignore")
                gm, gr = np.nanmedian(G[sel], 0), G[ring]; med = np.nanmedian(gr, 0); mad = np.nanmedian(np.abs(gr - med), 0) * 1.4826 + 1e-6
            zz = (gm - med) / mad
            for j in np.argsort(-np.nan_to_num(np.abs(zz))):
                if FEATS[j] in FEAT_ZH and np.isfinite(zz[j]) and abs(zz[j]) >= 2 and FEATS[j][0] != "w":
                    why.append({"feat": FEATS[j], "zh": FEAT_ZH[FEATS[j]], "z": round(float(zz[j]), 1), "value": _f(gm[j], 4), "ring": _f(med[j], 4)})
                if len(why) >= 5:
                    break
        k = int(np.searchsorted(R["metres"], metre))
        return {"metre": metre, "n_tokens": int(len(sel)), "swir_wl": self.swir_wl[ds].round(1).tolist(), "tir_wl": self.tir_wl.round(0).tolist(),
                "swir": sw[ds].round(4).tolist(), "swir_ring": None if swr is None else swr[ds].round(4).tolist(),
                "tir": None if tir_m is None else tir_m.round(4).tolist(), "tir_ring": None if tir_r is None else tir_r.round(4).tolist(), "tir_pred": tir_p.round(4).tolist(),
                "mix_swir": mix(sel, R["ms"]), "mix_swir_ring": mix(ring, R["ms"]) if len(ring) else {}, "mix_tir": mix(sel, R["gt"], okt), "mix_tir_ring": mix(ring, R["gt"], okt) if len(ring) else {},
                "tir_probe": {str(k): float(v) for k, v in pd.Series(R["tir_cls"][sel]).value_counts(normalize=True).round(3).items()}, "why": why,
                "anom": round(float(R["lc_pct"][sel].max()), 4), "gold": round(float(R["gold_p"][k]), 4), "core": int(pd.Series(R["core"][sel]).mode().iloc[0])}

    def similar(self, hole, d0, k=10):
        R = self.compute(hole); o = R["order"]; dep = R["depth"][o]; i0 = int(np.searchsorted(dep, d0)); i0 = min(max(i0, 0), max(len(o) - LEN, 0))
        q = o[i0:i0 + LEN]; x = R["F"][q].mean(0); x = (x - self.H["i_mu"]) / self.H["i_sd"]; x = x / (np.linalg.norm(x) + 1e-9)
        L = self.L; s = L["Z"] @ x.astype("f4"); meta = self.store.meta(hole)["meta"]; s[L["hole"] == hole] = -np.inf
        if meta.get("lat") is not None:                     # other areas only: no hole within 5 km of this one
            p = np.pi / 180; la, lo = meta["lat"], meta["lon"]
            a = np.sin((L["lat"] - la) * p / 2) ** 2 + np.cos(la * p) * np.cos(L["lat"] * p) * np.sin((L["lon"] - lo) * p / 2) ** 2
            s[np.nan_to_num(6371 * 2 * np.arcsin(np.sqrt(a)), nan=1e9) < 5] = -np.inf
        top = np.argpartition(-s, 400)[:400]; top = top[np.argsort(-s[top])]; seen, res = set(), []
        for j in top:
            h = str(L["hole"][j])
            if h in seen:
                continue
            seen.add(h); c = self.col_by.get(h)
            res.append({"hole": h, "from_m": round(float(L["d0"][j]), 1), "to_m": round(float(L["d1"][j]), 1), "sim": round(float(s[j]), 3),
                        "gs": str(L["gs"][j]), "gs_zh": N.gt_zh(str(L["gs"][j])), "gt": str(L["gt"][j]), "gt_zh": N.gt_zh(str(L["gt"][j])) if str(L["gt"][j]) else "",
                        "rock": str(L["rock"][j]), "au": _f(L["au"][j]), "lat": c[1] if c else None, "lon": c[2] if c else None, "region": c[5] if c else "", "split": str(L["split"][j]),
                        "on_server": h in self.store.cat})
            if len(res) >= k:
                break
        dq = R["depth"][q]; lm = dict(zip(R["lith_m"].tolist(), R["lith_c"].tolist())); rk = [lm.get(int(np.floor(v))) for v in dq]; rk = [r for r in rk if r]
        query = {"from_m": round(float(dq.min()), 1), "to_m": round(float(dq.max() + 0.1), 1), "gs_zh": N.gt_zh(_mode(R["gs"][q])), "gt_zh": N.gt_zh(_mode(R["gt"][q][R["has_t"][q]])) if R["has_t"][q].any() else "",
                 "rock": pd.Series(rk).mode().iloc[0] if rk else ""}
        same_rock = [r for r in res if r["rock"]] if query["rock"] else []
        return {"query": query, "results": res, "same_rock": sum(r["rock"] == query["rock"] for r in same_rock), "with_rock": len(same_rock)}

    def summary(self, hole):
        """Small digest for hole cards: core-type strip along depth, segment count, main core types, flagged metres."""
        key = self._version(hole); hit = getattr(self, "_summ", {}).get(hole)
        if hit and hit[0] == key:
            return hit[1]
        v = self.hole_view(hole); n = len(v["m"]); idx = np.linspace(0, n - 1, min(120, n)).astype(int)
        seg = pd.DataFrame(v["segments"]); share = seg.groupby("core_type_name").length_m.sum().sort_values(ascending=False) / max(seg.length_m.sum(), 1e-9)
        out = {"strip": [int(v["core"][i]) for i in idx], "n_segments": int(len(seg)), "metres": n,
                "main_types": [[k, round(float(x), 3)] for k, x in share.head(3).items()], "n_flag": v["anomaly"]["n_flag_m"],
                "gold_top": v["gold_summary"]["top"][0]["m"] if v["gold_summary"]["top"] else None,
                "tir_acc": v["tir"]["acc"], "tir_r2": v["tir"]["r2"], "gold_auc": v["gold_summary"]["auc"], "anom_auc": v["anomaly"]["auc_gold"],
                "gold_top10": v["gold_summary"].get("top10_share"), "gold_base": v["gold_summary"].get("base_share")}
        self.__dict__.setdefault("_summ", {})[hole] = (key, out)
        return out


class Models:
    """Every model in bundle/models/<run>/ (model.pt, heads.pkl, library.npz, card.json), loaded on first use.
    A bundle with the files directly in bundle/ (single-model layout of earlier versions) counts as one model."""
    def __init__(self, bundle: Path, store):
        B = Path(bundle); self.store = store; self.spectra = B / "spectra.npz"
        md = B / "models"
        self.dirs = {p.name: p for p in sorted(md.iterdir()) if (p / "card.json").exists() and ((p / "model.pt").exists() or (p / "mlp.pt").exists())} if md.exists() else {}
        if not self.dirs and (B / "model.pt").exists():
            self.dirs = {json.loads((B / "card.json").read_text()).get("run", "v2"): B}
        if not self.dirs:
            raise FileNotFoundError(f"no model found in {B}")
        want = os.environ.get("CORETRACE_MODEL", "v2")
        self.default = want if want in self.dirs else next(iter(self.dirs))
        self._e: dict[str, Engine] = {}; self._lock = threading.Lock()

    def forget(self, hole: str) -> None:
        """Drop a hole from every loaded engine's in-memory cache. An engine keeps each hole's full result (spectra,
        representation) after compute(); a long-running worker or backfill that never forgets grows by ~10-30 MB a hole."""
        for e in list(self._e.values()):
            e.cache.pop(hole, None); e.timing.pop(hole, None)
            with e._llock:
                e.locks.pop(hole, None)

    def get(self, run: str | None = None) -> Engine:
        run = run or self.default
        if run not in self.dirs:
            raise KeyError(run)
        if run not in self._e:
            with self._lock:
                if run not in self._e:
                    sp = self.spectra if self.spectra.exists() else None
                    if (self.dirs[run] / "mlp.pt").exists():          # conventional methods, no foundation model
                        from .baseline import BaselineEngine
                        self._e[run] = BaselineEngine(self.dirs[run], self.store, sp)
                    else:
                        self._e[run] = Engine(self.dirs[run], self.store, sp)
        return self._e[run]

    def listing(self):
        out = []
        for run, d in self.dirs.items():
            c = json.loads((d / "card.json").read_text())
            out.append({"run": run, "name": c.get("name", run), "zh": c.get("zh", ""), "desc": c.get("desc", ""), "default": run == self.default, "kind": c.get("kind", "model"),
                        "loaded": run in self._e, "card": c})
        return out

