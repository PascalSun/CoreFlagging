"""Raw NVCL download of one hole -> the 10 cm tokens the model reads, plus logs, metadata, data-quality checks and a
report of every cleaning step. The cleaning is fm/build_cache.py of the research code, line for line (same rules,
same parameters in config.py), so a hole processed here is exactly what the model saw in training.

  per dataset   keep valid samples (TSG Final Mask), reject chip / cuttings scans (spacing > 0.25 m), clip SWIR to 0-1,
                TIR: resample HyLogger 4 to the HyLogger 3 grid, clip negatives, drop dark / mostly-negative / >1 samples,
                mark the dataset miscalibrated if > 5 % exceed 1; average into 10 cm bins (>= 3 valid samples per bin);
                attach the software mineral group / mineral of each bin (evaluation and display only, never a model input)
  per hole      where datasets overlap in depth keep HyLogger 3 > 4 > 2 (then the longer one)
  logs          1 m lithology (company / GSWA log) and gold assays, when the hole has them
Output: <data>/processed/<HOLE>.npz (arrays) and <HOLE>.json (metadata, report, quality issues).
"""
from __future__ import annotations

import json, re
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from . import config as C
from .nvcl import AU_RE, LITH_RE

SW_WL = np.linspace(*C.SWIR_GRID[:2], C.SWIR_GRID[2])
TI_WL = np.linspace(*C.TIR_GRID[:2], C.TIR_GRID[2])
LABELS = {"gs": ("Grp1 uTSAS", "Grp1 sTSAS"), "gt": ("Grp1 ujCLST", "Grp1 sjCLST"), "ms": ("Min1 uTSAS", "Min1 sTSAS")}
LITH_CLASSES = [("超基性岩", r"komati|ultramaf|peridot|dunit|serpentin|pyroxenit|talc|harzburg"),
                ("铁建造和燧石", r"\bbif\b|banded iron|iron ?stone|iron formation|chert|jaspil"),
                ("碳酸盐岩", r"limestone|dolomit|dolostone|carbonate rock|marble|carbonatit|sovite|calcrete|carbonate$"),
                ("镁铁质侵入岩", r"gabbro|dolerit|norite|diabase"), ("镁铁质火山岩", r"basalt|amphibolit|mafic"),
                ("花岗岩类", r"granit|granodior|monzo|tonalit|pegmatit|syenit|granophyre|aplite"),
                ("长英质和中性火山岩", r"rhyol|dacit|andesit|felsic|tuff|porphyr|volcan|ignimbrit|intermediate"), ("中性侵入岩", r"diorit"),
                ("变质岩", r"gneiss|schist|hornfels|migmatit|phyllit|slate|quartzite|metased"),
                ("碎屑沉积岩", r"sandstone|siltstone|shale|mudstone|conglomerat|arenit|arkose|greywack|wacke|argillit|claystone|sediment|\bsst\b|grit"),
                ("脉和蚀变", r"vein|alteration|breccia|lode|quartz$|^quartz"),
                ("风化层和覆盖", r"\bclay\b|saprol|laterit|soil|regolith|cover|\bsand\b|gravel|alluvi|colluvi|transported")]   # regions/build_summary.py
TSG_META = {"project_tsg": "Project", "owner": "Owner", "drill_date": "DrillDate", "datum": "Datum", "lat_tsg": "Latitude", "lon_tsg": "Longitude",
            "azimuth": "Azimuth", "inclination": "Inclination", "rl": "RL"}
TSG_SUMM = {"uwi": "GSWA UWI", "wamex": "WAMEX Report ID", "tectonic_unit": "Tectonic Unit"}
GAP_M, BAD_TIR_SHARE, LOW_VALID = 5.0, 0.30, 0.50
ISSUES = {   # eval/qc_list.py
    "dataset_skipped": ("扫描数据集没有用上", "核对数据集类型（岩屑样不是连续岩芯）"),
    "tir_miscalibrated": ("热红外定标错误（反射率超过 1）", "重新定标或标记热红外不可用"),
    "tir_none": ("没有可用的热红外", "核对仪器型号和热红外文件"), "tir_sparse": ("可用的热红外太少", "核对热红外文件"),
    "tir_many_bad": ("三成以上热红外采样点太暗、有负值或超过 1", "检查扫描时的仪器状态"),
    "low_valid_share": ("一半以上采样点不是有效岩芯", "核对有效标记（Final Mask）"), "core_gap": ("岩芯中间缺失超过 5 米", "核对是否漏扫或深度记录有误"),
    "no_tsg_coordinates": ("扫描文件里坐标填的是 0", "从钻孔数据库补坐标"), "coordinate_mismatch": ("扫描文件和钻孔名单的坐标相差超过 1 公里", "核对哪一个坐标正确"),
    "inclination_missing": ("倾角填 0 或不可能的值", "从钻孔数据库补倾角"), "elevation_missing": ("孔口高程填 0", "从钻孔数据库补高程"),
    "drill_date_missing": ("没有钻孔日期", "补日期"), "tectonic_unit_missing": ("没填所属构造单元", "可用按 GSWA 构造单元图补出的地区（见 value 列）")}
REASON_ZH = {"no per-sample table": "缺采样点信息表", "no SWIR spectra": "缺短波红外光谱", "no SWIR validity mask": "缺短波红外有效标记",
             "SWIR shape": "光谱和采样点表对不上", "sample spacing": "采样间距太大：是岩屑或碎样，不是连续岩芯", "no valid SWIR samples": "没有有效的短波红外采样点",
             "no bin with enough valid SWIR samples": "没有一个 10 cm 段有足够的有效采样点", "fully covered by a higher-priority dataset of the same hole": "同一深度已有更优先的仪器数据"}


def lith_class(s):
    t = str(s).lower()
    for name, pat in LITH_CLASSES:
        if re.search(pat, t):
            return name
    return ""


def reason_zh(r):
    return next((v for k, v in REASON_ZH.items() if r.startswith(k)), r)


# ─────────────── one dataset (fm/build_cache.py `one`) ───────────────
def _bin_mean(x, key, min_n):
    o = np.argsort(key, kind="stable"); x, key = x[o], key[o]
    ub, st, cnt = np.unique(key, return_index=True, return_counts=True)
    m = np.add.reduceat(x, st, axis=0) / cnt[:, None]; v = np.add.reduceat(x * x, st, axis=0) / cnt[:, None] - m * m
    sd = np.sqrt(np.clip(v.mean(1), 0, None)); k = cnt >= min_n
    return ub[k], m[k].astype("f4"), sd[k].astype("f4"), cnt[k], o


def _majority(bins, lab, keep_bins):
    d = pd.DataFrame({"b": bins, "l": lab}).dropna()
    if d.empty:
        return np.full(len(keep_bins), None, object)
    # a tie between two labels goes to the alphabetically first one; the research code left it to the sort, so its
    # answer on a tied bin depended on the machine
    c = d.groupby(["b", "l"], observed=True).size().reset_index(name="n").sort_values(["n", "l"], ascending=[True, False], kind="stable").drop_duplicates("b", keep="last").set_index("b").l
    return c.reindex(keep_bins).astype(object).where(lambda s: s.notna(), None).to_numpy()


def clean_dataset(hd: Path, dsid: str, inst: str, lenient: bool = False):
    """One dataset cleaned into 10 cm bins under the rules the models were trained with.
    `lenient` is for showing a scan the models cannot read (chips, a mask that rejects nearly
    everything, another SWIR band grid): no spacing limit, a bin needs one sample, a missing or
    empty mask lets every finite sample through, and SWIR is resampled to the standard grid.
    Its output is for display only and never goes to a model."""
    min_valid = 1 if lenient else C.MIN_VALID
    d8 = dsid[:8]; f = hd / "samples" / f"{d8}.parquet"; fs = hd / "spectra" / f"vnswir_{d8}.npy"
    if not f.exists():
        return "no per-sample table"
    if not fs.exists():
        return "no SWIR spectra"
    names = set(pq.read_schema(f).names)
    if "mask_swir" not in names and not lenient:
        return "no SWIR validity mask"
    want = ["start_depth", "mask_swir", "mask_tir"] + [c for pair in LABELS.values() for c in pair]
    t = pd.read_parquet(f, columns=[c for c in want if c in names]); sw = np.load(fs, mmap_mode="r")
    if lenient and len(sw) == len(t) and sw.shape[1] != len(SW_WL):
        wf = hd / "spectra" / f"vnswir_{d8}_wavelengths.npy"
        if wf.exists():
            src = np.load(wf).astype("f8")
            sw = np.stack([np.interp(SW_WL, src, row) for row in np.asarray(sw, dtype="f8")]).astype("f4")
    if len(sw) != len(t) or sw.shape[1] != len(SW_WL):
        return f"SWIR shape {sw.shape} does not match the sample table ({len(t)})"
    depth = t.start_depth.to_numpy(); step = np.diff(depth); step = np.median(step[step > 0]) if (step > 0).any() else np.inf
    if not lenient and (not np.isfinite(step) or step > C.MAX_STEP_M):
        return f"sample spacing {step:.2f} m: chips or cuttings, not a core scan"
    b = np.floor(depth / C.BIN_M + 1e-6).astype(np.int64); st = {"n_samples": len(t), "step_mm": float(step * 1000) if np.isfinite(step) else None}
    xs = np.asarray(sw, dtype="f4"); fin = np.isfinite(xs).all(1)
    ms = t.mask_swir.to_numpy() == 1 if "mask_swir" in t else np.ones(len(t), bool)
    if lenient and (ms & fin).sum() < max(min_valid, 0.05 * len(t)):
        ms = np.ones(len(t), bool); st["mask_ignored"] = True        # the mask leaves (almost) nothing: show every finite sample
    ok = ms & fin
    st["swir_valid"] = int(ok.sum())
    if ok.sum() < min_valid:
        return "no valid SWIR samples"
    ub, m_s, sd_s, n_s, _ = _bin_mean(np.clip(xs[ok], *C.SWIR_CLIP), b[ok], min_valid)
    st["bins_any"] = int(len(np.unique(b[ok]))); st["bins_kept"] = int(len(ub))
    if len(ub) == 0:
        return "no bin with enough valid SWIR samples"
    out = {"dsid": dsid, "inst": inst, "bin": ub, "swir": m_s.astype(C.STORE_DTYPE), "sd_swir": sd_s, "n_swir": n_s.astype("i2")}
    for k, (u, s) in LABELS.items():
        src = u if (u in t and t[u].notna().any()) else (s if s in t else None)
        out[k] = _majority(b[ok], t[src].astype(object).to_numpy()[ok], ub) if src else np.full(len(ub), None, object)
    tir = np.zeros((len(ub), len(TI_WL)), C.STORE_DTYPE); n_t = np.zeros(len(ub), "i2"); sd_t = np.zeros(len(ub), "f4"); st["tir"] = "none"
    ft = hd / "spectra" / f"tir_{d8}.npy"
    if ft.exists() and "mask_tir" in t:
        ti = np.load(ft, mmap_mode="r")
        if len(ti) == len(t):
            xt = np.asarray(ti, dtype="f4")
            if xt.shape[1] != len(TI_WL):                                    # HyLogger 4: resample to the HyLogger 3 grid
                src_wl = np.load(hd / "spectra" / f"tir_{d8}_wavelengths.npy").astype("f8")
                j = np.clip(np.searchsorted(src_wl, TI_WL) - 1, 0, len(src_wl) - 2); w = (TI_WL - src_wl[j]) / (src_wl[j + 1] - src_wl[j])
                xt = xt[:, j] * (1 - w) + xt[:, j + 1] * w
            okt = (t.mask_tir.to_numpy() == 1) & np.isfinite(xt).all(1)
            if lenient and okt.sum() < max(min_valid, 0.05 * len(t)):
                okt = np.isfinite(xt).all(1)
            if okt.sum() >= min_valid:
                xv = xt[okt]; inb = (TI_WL >= C.TIR_BANDS[0]) & (TI_WL <= C.TIR_BANDS[1]); over = (xv[:, inb] > C.TIR_MAX).any(1)
                negb = (xv[:, inb] < C.TIR_CLIP_MIN).mean(1); xv = np.clip(xv, C.TIR_CLIP_MIN, 1.0); dark = xv[:, inb].mean(1) < C.TIR_DARK
                drop = dark | (negb > C.TIR_NEG_BAND_SHARE) | over
                st.update(tir_dark=float(dark.mean()), tir_over=float(over.mean()), tir_dropped=float(drop.mean()), tir_valid=int(okt.sum()))
                miscal = over.mean() > C.TIR_OVER_SHARE
                if (~drop).sum() >= min_valid and not miscal:
                    ubt, m_t, sdt, nt, _ = _bin_mean(xv[~drop], b[okt][~drop], min_valid)
                    pos = np.searchsorted(ub, ubt); hit = (pos < len(ub)) & (ub[np.minimum(pos, len(ub) - 1)] == ubt)
                    tir[pos[hit]] = m_t[hit].astype(C.STORE_DTYPE); n_t[pos[hit]] = nt[hit]; sd_t[pos[hit]] = sdt[hit]
                st["tir"] = "miscalibrated" if miscal else ("ok" if (n_t > 0).mean() >= 0.5 else ("sparse" if (n_t > 0).any() else "none"))
    out.update(tir=tir, n_tir=n_t, sd_tir=sd_t, stats=st)
    return out


# ─────────────── logs and header ───────────────
def read_logs(hd: Path):
    cls, au = [], []
    for f in sorted((hd / "ds1m").glob("*.csv")) if (hd / "ds1m").exists() else []:
        log = f.name.split("__")[0]
        lines = f.read_text(errors="ignore").splitlines()
        if lines and lines[0].startswith("Depth,Classification") and LITH_RE.match(log) and log != "RockMarks":
            rows = [(a, *b.rsplit(",", 2)) for a, b in (ln.split(",", 1) for ln in lines[1:] if ln.count(",") >= 3)]
            cls += [(log, float(x[0]), x[1].strip(), int(x[3])) for x in rows]
        elif AU_RE.match(log):
            try:
                df = pd.read_csv(f)
            except Exception:
                continue
            if list(df.columns) == ["Depth", "Value"]:
                v = pd.to_numeric(df["Value"], errors="coerce") / (1000.0 if "ppb" in log.lower() else 1.0)
                au += [(float(d), float(x)) for d, x in zip(df["Depth"], v) if x == x]
    lith = {"m": np.zeros(0, int), "raw": np.zeros(0, str), "cls": np.zeros(0, str), "log": None}
    if cls:
        L = pd.DataFrame(cls, columns=["log", "depth", "cls", "count"]); name = "Lithology" if "Lithology" in set(L.log) else L.log.value_counts().index[0]
        L = L[L.log == name].assign(m=lambda d: np.floor(d.depth).astype(int)).sort_values("count").drop_duplicates("m", keep="last").sort_values("m")
        lith = {"m": L.m.to_numpy(), "raw": np.array(L.cls.tolist(), str), "cls": np.array([lith_class(c) for c in L.cls], str), "log": name}
    A = pd.DataFrame(au, columns=["depth", "ppm"])
    A = A.assign(m=np.floor(A.depth).astype(int)).groupby("m").ppm.max() if len(A) else pd.Series(dtype=float)
    return lith, A


def tsg_header(xml: str, dsid: str) -> dict:
    blk = next((b for b in re.findall(r"<Dataset>.*?</Dataset>", xml, re.S) if dsid in b), "")
    d = {}
    for k, tag in TSG_META.items():
        m = re.search(rf"&lt;{tag}&gt;(.*?)&lt;/{tag}&gt;", blk, re.S); d[k] = m.group(1).strip() if m and m.group(1).strip() else None
    m = re.search(r"&lt;ExecSumm&gt;(.*?)&lt;/ExecSumm&gt;", blk, re.S); summ = {}
    for part in (m.group(1).split("|") if m else []):
        if ":" in part:
            k, v = part.split(":", 1); summ[k.strip()] = v.strip() or None
    for k, tag in TSG_SUMM.items():
        d[k] = summ.get(tag)
    for k in ("lat_tsg", "lon_tsg", "azimuth", "inclination", "rl"):
        try:
            d[k] = float(d[k]) if d[k] is not None else None
        except ValueError:
            d[k] = None
    return d


def _km(la1, lo1, la2, lo2):
    p = np.pi / 180; a = np.sin((la2 - la1) * p / 2) ** 2 + np.cos(la1 * p) * np.cos(la2 * p) * np.sin((lo2 - lo1) * p / 2) ** 2
    return float(6371 * 2 * np.arcsin(np.sqrt(a)))


# ─────────────── one hole ───────────────
def preprocess_hole(hd: Path, out_dir: Path, ref: dict | None = None, progress=lambda msg, frac=None: None, lenient: bool = False) -> dict:
    hole = hd.name; ref = ref or {}
    man = json.loads((hd / "manifest.json").read_text()); xml = (hd / "datasets.xml").read_text(errors="ignore")
    good, skipped, report = [], [], []
    for k, d in enumerate(man["datasets"]):
        progress(f"清洗数据集 {k + 1}/{len(man['datasets'])}：{d['name']}", 0.1 + 0.6 * k / max(len(man["datasets"]), 1))
        r = clean_dataset(hd, d["dsid"], d.get("instrument") or "", lenient=lenient)
        row = {"dataset": d["name"], "dsid": d["dsid"], "instrument": d.get("instrument") or "", "depth": d.get("depth")}
        if isinstance(r, str):
            skipped.append({"dsid": d["dsid"], "reason": r}); report.append({**row, "kept": False, "reason": r, "reason_zh": reason_zh(r)})
        else:
            good.append(r); report.append({**row, "kept": True, **r["stats"]})
    prio = lambda r: (next((i for i, p in enumerate(C.PRIORITY) if r["inst"].startswith(p)), len(C.PRIORITY)), -len(r["bin"]))   # noqa: E731
    keep, seen, dup = [], np.array([], np.int64), 0
    for r in sorted(good, key=prio):
        m = ~np.isin(r["bin"], seen); dup += int((~m).sum())
        rr = next(x for x in report if x["dsid"] == r["dsid"])
        if m.sum() == 0:
            reason = "fully covered by a higher-priority dataset of the same hole"; skipped.append({"dsid": r["dsid"], "reason": reason})
            rr.update(kept=False, reason=reason, reason_zh=reason_zh(reason)); continue
        for k in ("bin", "swir", "sd_swir", "n_swir", "tir", "n_tir", "sd_tir", "gs", "gt", "ms"):
            r[k] = r[k][m]
        rr.update(tokens=int(m.sum()), tokens_overlap=int((~m).sum())); seen = np.concatenate([seen, r["bin"]]); keep.append(r)
    if not keep:
        raise ValueError("No usable core scan in these files: " + "; ".join(sorted({s["reason"] for s in skipped})) + ".")
    progress("整理成 10 cm 段，读取岩性和化验", 0.8)
    n = [len(r["bin"]) for r in keep]; cat = lambda k: np.concatenate([r[k] for r in keep])   # noqa: E731
    lab = lambda k, none: np.array([none if v is None else str(v) for v in cat(k)], str)       # noqa: E731
    bins = cat("bin").astype("i4"); lith, au = read_logs(hd)
    arrays = {"swir": cat("swir"), "tir": cat("tir"), "bin": bins, "depth": (bins * C.BIN_M).astype("f4"), "n_swir": cat("n_swir"), "n_tir": cat("n_tir"),
              "sd": np.stack([cat("sd_swir"), cat("sd_tir")], 1).astype("f4"), "gs": lab("gs", "INVALID"), "gt": lab("gt", "nan"), "ms": lab("ms", "nan"),
              "dsn": np.repeat(np.arange(len(keep)), n).astype("i2"), "ds_inst": np.array([r["inst"] for r in keep], str),
              "lith_m": lith["m"].astype("i4"), "lith_raw": lith["raw"], "lith_c": lith["cls"], "au_m": au.index.to_numpy().astype("i4"), "au_ppm": au.to_numpy().astype("f4")}
    # ---- metadata
    first = man["datasets"][0]; tsg = tsg_header(xml, keep[0]["dsid"]); depth = arrays["depth"]
    meta = {"hole": hole, "lat": ref.get("lat", tsg.get("lat_tsg")), "lon": ref.get("lon", tsg.get("lon_tsg")), "operator": ref.get("operator") or tsg.get("owner"),
            "project": ref.get("project") or tsg.get("project_tsg"), "drill_date": tsg.get("drill_date") or ref.get("drill_start"), "instrument": keep[0]["inst"],
            "region": ref.get("region"), "region_zh": ref.get("region_zh"), "split": ref.get("split"), "depth_min": float(depth.min()), "depth_max": float(depth.max() + C.BIN_M),
            "n_tokens": int(len(bins)), "tir": "ok" if (arrays["n_tir"] > 0).mean() >= 0.5 else ("sparse" if (arrays["n_tir"] > 0).any() else "none"),
            "has_lith": bool(len(lith["m"])), "lith_log": lith["log"], "au_m": int(len(au)), "au_pos_m": int((au >= 0.1).sum()), "wamex": tsg.get("wamex"),
            "tsg": tsg, "source": man.get("source", "research archive"), "downloaded": man.get("downloaded"), "first_dataset": first["name"]}
    # ---- cleaning report
    kept = [x for x in report if x.get("kept")]
    funnel = {"datasets": len(report), "datasets_kept": len(kept), "samples": int(sum(x.get("n_samples", 0) for x in report)),
              "samples_valid": int(sum(x.get("swir_valid", 0) for x in report)), "bins_kept": int(sum(x.get("bins_kept", 0) for x in report)),
              "tokens_overlap": dup, "tokens": int(len(bins)), "tokens_tir": int((arrays["n_tir"] > 0).sum()),
              "metres": int(len(np.unique(np.floor(depth)))), "lith_m": int(len(lith["m"])), "au_m": int(len(au))}
    # ---- data-quality checks for this hole (eval/qc_list.py, the parts that need only this hole)
    qc = []
    def add(code, ds=None, d0=None, d1=None, value=None, evidence=None):
        qc.append({"hole": hole, "dataset": ds, "issue": code, "issue_zh": ISSUES[code][0], "depth_from": d0, "depth_to": d1, "value": value, "evidence": evidence, "suggested_fix": ISSUES[code][1]})
    for s in skipped:
        add("dataset_skipped", s["dsid"], evidence=s["reason"])
    for x in kept:
        if x.get("tir") in ("miscalibrated", "none", "sparse"):
            add("tir_" + x["tir"], x["dsid"], value=round(x.get("tir_over", 0), 4) if x["tir"] == "miscalibrated" else x.get("tir_valid"))
        elif x.get("tir") == "ok" and x.get("tir_dropped", 0) > BAD_TIR_SHARE:
            add("tir_many_bad", x["dsid"], value=round(x["tir_dropped"], 3), evidence=f"dark {x.get('tir_dark', 0):.2f}, over 1 {x.get('tir_over', 0):.3f}")
        if x["swir_valid"] / max(x["n_samples"], 1) < LOW_VALID:
            add("low_valid_share", x["dsid"], value=round(x["swir_valid"] / max(x["n_samples"], 1), 3), evidence=f"{x['swir_valid']} of {x['n_samples']} samples valid")
    for k, r in enumerate(keep):
        b = np.sort(r["bin"]); g = np.flatnonzero(np.diff(b) * C.BIN_M > GAP_M)
        for j in g:
            add("core_gap", r["dsid"], round(b[j] * C.BIN_M + C.BIN_M, 1), round(b[j + 1] * C.BIN_M, 1), round((b[j + 1] - b[j]) * C.BIN_M, 1), "metres without valid core")
    if tsg.get("lat_tsg") == 0 and tsg.get("lon_tsg") == 0:
        add("no_tsg_coordinates")
    elif ref.get("lat") is not None and tsg.get("lat_tsg") is not None and tsg.get("lon_tsg") is not None:
        km = _km(ref["lat"], ref["lon"], tsg["lat_tsg"], tsg["lon_tsg"])
        if km > 1:
            add("coordinate_mismatch", value=round(km, 1), evidence=f"list {ref['lat']:.4f},{ref['lon']:.4f}; scan file {tsg['lat_tsg']:.4f},{tsg['lon_tsg']:.4f}")
    inc = tsg.get("inclination")
    if not (inc is not None and -90 <= inc < 0):
        add("inclination_missing", value=inc)
    if not tsg.get("rl"):
        add("elevation_missing")
    if not tsg.get("drill_date"):
        add("drill_date_missing")
    if not tsg.get("tectonic_unit"):
        add("tectonic_unit_missing", value=ref.get("region"), evidence="filled from the GSWA 1:10M tectonic units by collar position" if ref.get("region") else "")
    rep = {"funnel": funnel, "datasets": report, "rules": cleaning_rules(), "qc": qc}
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / f"{hole}.part.npz"; np.savez_compressed(tmp, **arrays); tmp.rename(out_dir / f"{hole}.npz")
    (out_dir / f"{hole}.json").write_text(json.dumps({"meta": meta, "report": rep}, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    return {"meta": meta, "report": rep}


def cleaning_rules():
    return [{"step": "有效采样点", "rule": "只用 TSG 有效标记（Final Mask）为 1 的采样点"},
            {"step": "排除岩屑", "rule": f"采样间距大于 {C.MAX_STEP_M} m 的数据集是岩屑或碎样，不用"},
            {"step": "短波红外", "rule": f"反射率截到 {C.SWIR_CLIP[0]}–{C.SWIR_CLIP[1]}"},
            {"step": "热红外", "rule": f"HyLogger 4 重采样到 HyLogger 3 的波段；负值截到 0；太暗（平均 < {C.TIR_DARK}）、一成以上波段为负、或有波段超过 1 的采样点丢掉；"
                                     f"超过 1 的采样点多于 {C.TIR_OVER_SHARE:.0%} 时判为定标错误，整个数据集不用热红外"},
            {"step": "10 cm 段", "rule": f"按深度每 {C.BIN_M * 100:.0f} cm 取平均，至少 {C.MIN_VALID} 个有效采样点才保留"},
            {"step": "重叠去重", "rule": "同一钻孔多个数据集深度重叠时，按 HyLogger 3 > 4 > 2 保留一个"},
            {"step": "波段范围", "rule": f"模型只看 {C.TIR_BANDS[0] / 1000:.1f}–{C.TIR_BANDS[1] / 1000:.0f} µm 的热红外，两端噪声大的波段去掉"},
            {"step": "软件矿物", "rule": "每段附上 TSG 软件给的矿物解释，只用来展示和评测，不给模型看"}]
