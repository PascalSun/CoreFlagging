"""Per-metre outputs the platform stores so that opening a metre needs no model run.

The research app computed these on demand from a hole held in memory (engine.metre_view, engine.similar).
Here they are computed once, when the hole is processed, for every metre:
  tir       the TIR spectrum the model rebuilds from SWIR alone, mean over the metre
  fp        the fingerprint of the 2 m interval that starts at the metre, ready to compare with the State library
  why       which spectral features set the metre apart from the core around it (no model involved)
"""
from __future__ import annotations

import warnings

import numpy as np

from . import labels
from .pipeline import names as N
from .pipeline.engine import FEAT_ZH, FEATS, LEN, Engine, _f

FEAT_EN = {"alb": "overall brightness", "vis_slope": "visible reddening (iron oxides)", "d900": "900 nm iron-oxide absorption depth", "d1400": "1400 nm hydroxyl absorption depth",
           "d1900": "1900 nm water absorption depth", "d2160": "2160 nm kaolinite shoulder", "d2200": "2200 nm Al-OH absorption depth (white mica, clays)",
           "w2200": "white-mica absorption position", "d2250": "2250 nm Fe-OH absorption depth (chlorite)", "w2250": "chlorite absorption position",
           "d2335": "2335 nm Mg-OH / carbonate absorption depth", "w2335": "2335 nm absorption position", "cryst": "white-mica / clay crystallinity",
           "talb": "thermal-infrared brightness", "tq": "quartz peak strength (TIR)", "tfmi": "felsic–mafic index (TIR)", "tc11": "carbonate 11.3 µm peak",
           "tfs": "feldspar / mafic relative to quartz", "tq12": "secondary quartz peak"}


def metre_arrays(eng: Engine, key: str) -> tuple[np.ndarray, np.ndarray]:
    """(tir, fp): one row per metre of the hole, in the order of hole_view()['m']."""
    R = eng.compute(key); um = R["metres"]; m = np.floor(R["depth"]).astype(int)
    o = R["order"]; dep = R["depth"][o]; F = R["F"]; H = eng.H
    tir = np.zeros((len(um), R["tir_pred"].shape[1]), "f4"); fp = np.zeros((len(um), F.shape[1]), "f4")
    for k, mm in enumerate(um):
        tir[k] = R["tir_pred"][m == mm].mean(0)
        i0 = int(np.searchsorted(dep, float(mm))); i0 = min(max(i0, 0), max(len(o) - LEN, 0))      # as engine.similar
        x = F[o[i0:i0 + LEN]].mean(0); x = (x - H["i_mu"]) / H["i_sd"]; fp[k] = x / (np.linalg.norm(x) + 1e-9)
    return tir, fp


def metre_why(eng: Engine, key: str) -> list[list[dict]]:
    """Per metre, up to five features at least 2 robust standard deviations from the surrounding ±15 m (as engine.metre_view)."""
    R = eng.compute(key); G = R["G"]; depth = R["depth"]; m = np.floor(depth).astype(int); out = []
    for mm in R["metres"]:
        sel = np.flatnonzero(m == mm); dd = np.abs(depth - (mm + 0.5)); ring = np.flatnonzero((dd <= 15) & (dd > 1.5)); why = []
        if len(ring) >= 20:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                gm, gr = np.nanmedian(G[sel], 0), G[ring]; med = np.nanmedian(gr, 0); mad = np.nanmedian(np.abs(gr - med), 0) * 1.4826 + 1e-6
            zz = (gm - med) / mad
            for j in np.argsort(-np.nan_to_num(np.abs(zz))):
                if FEATS[j] in FEAT_ZH and np.isfinite(zz[j]) and abs(zz[j]) >= 2 and FEATS[j][0] != "w":
                    why.append({"feat": FEATS[j], "en": FEAT_EN.get(FEATS[j], FEATS[j]), "zh": FEAT_ZH[FEATS[j]], "z": round(float(zz[j]), 1), "value": _f(gm[j], 4), "ring": _f(med[j], 4)})
                if len(why) >= 5:
                    break
        out.append(why)
    return out


def similar(eng: Engine, x: np.ndarray, hole: str = "", lat: float | None = None, lon: float | None = None, k: int = 10) -> list[dict]:
    """Intervals of the State library closest to fingerprint `x`. Leaves out the hole itself and every hole within
    5 km of it, and returns at most one interval per hole (as engine.similar)."""
    L = eng.L; x = np.asarray(x, "f4")
    if x.shape != (L["Z"].shape[1],):
        raise ValueError(f"fingerprint has {x.shape[0] if x.ndim == 1 else x.shape} numbers, this model's library has {L['Z'].shape[1]}")
    s = L["Z"] @ x
    if hole:
        s[np.char.lower(L["hole"].astype(str)) == hole.lower()] = -np.inf
    if lat is not None and lon is not None:
        p = np.pi / 180
        a = np.sin((L["lat"] - lat) * p / 2) ** 2 + np.cos(lat * p) * np.cos(L["lat"] * p) * np.sin((L["lon"] - lon) * p / 2) ** 2
        s[np.nan_to_num(6371 * 2 * np.arcsin(np.sqrt(a)), nan=1e9) < 5] = -np.inf
    top = np.argpartition(-s, 400)[:400]; top = top[np.argsort(-s[top])]; seen, res = set(), []
    for j in top:
        h = str(L["hole"][j])
        if h in seen or not np.isfinite(s[j]):
            continue
        seen.add(h); c = eng.col_by.get(h)
        res.append({"hole": h, "from_m": round(float(L["d0"][j]), 1), "to_m": round(float(L["d1"][j]), 1), "sim": round(float(s[j]), 3), "gs": str(L["gs"][j]), "gt": str(L["gt"][j]),
                    "gs_en": N.gt_en(str(L["gs"][j])), "gt_en": N.gt_en(str(L["gt"][j])) if str(L["gt"][j]) else "", "rock": labels.lith(str(L["rock"][j])) or "", "au": _f(L["au"][j]),
                    "lat": c[1] if c else None, "lon": c[2] if c else None, "region": (eng.store.ref_for(h) or {}).get("region") or "", "split": str(L["split"][j])})
        if len(res) >= k:
            break
    return res
