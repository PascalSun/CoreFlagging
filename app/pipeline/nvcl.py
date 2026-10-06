"""Download one drillhole from the NVCL data service (GSWA, CC-BY-4.0) into <data>/raw/<HOLE>/.

The layout is the same as the research download (download_nvcl.py tiers A-C), so holes downloaded by the server and
holes copied from the research archive go through the same preprocessing. Only what CoreScope uses is fetched:

  datasets.xml, scalar_logs_<dsid>.xml, manifest.json     dataset list, instruments, TSG header fields, log list
  spectra/vnswir_<d8>.npy, spectra/tir_<d8>.npy (+ _wavelengths.npy)   full-resolution reflectance, float32
  samples/<d8>.parquet                                     per spectrum: depth, TSG Final Mask (SWIR / TIR),
                                                           software mineral group / mineral (TSA, jCLST)
  ds1m/<log>__<id8>.csv                                    1 m lithology and gold logs, when the hole has them
"""
from __future__ import annotations

import io, json, re, time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from . import config as C

SPEC_CHUNK = 5000
LABEL_LOGS = {"Grp1 uTSAS", "Grp1 sTSAS", "Grp1 ujCLST", "Grp1 sjCLST", "Min1 uTSAS", "Min1 sTSAS"}
LITH_RE = re.compile(r"^(lith|rock|geol|strat|primary[ _]lith|company[ _]lith|gswa[ _]lith)", re.I)
AU_RE = re.compile(r"^au([ _]?(ppm|ppb|assay.*))?$", re.I)
_sess = requests.Session(); _sess.headers["User-Agent"] = "CoreScope (HyLogger core-spectra demo)"


class NVCLError(RuntimeError):
    pass


def get(url, dest: Path | None = None, tries=4, timeout=180) -> bytes:
    if dest is not None and dest.exists() and dest.stat().st_size > 0:
        return dest.read_bytes()
    err = ""
    for k in range(tries):
        try:
            r = _sess.get(url, timeout=timeout)
            if r.status_code == 200 and r.content:
                if dest is not None:
                    tmp = dest.with_suffix(dest.suffix + ".part"); tmp.write_bytes(r.content); tmp.rename(dest)
                return r.content
            err = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            err = repr(e)
        time.sleep(2 ** k)
    raise NVCLError(f"{url}: {err}")


def parse_datasets(xml: str) -> list[dict]:
    out = []
    for m in re.finditer(r"<Dataset>(.*?)</Dataset>", xml, re.S):
        s = m.group(1)
        d = {"dsid": re.search(r"<DatasetID>(.*?)<", s).group(1), "name": re.search(r"<DatasetName>(.*?)<", s).group(1)}
        dr = re.search(r"<DepthRange><start>(.*?)</start><end>(.*?)</end>", s); d["depth"] = [float(dr.group(1)), float(dr.group(2))] if dr else None
        d["spectral"] = []
        for sm in re.finditer(r"<SpectralLog>(.*?)</SpectralLog>", s, re.S):
            ss = sm.group(1)
            d["spectral"].append({"logid": re.search(r"<logID>(.*?)<", ss).group(1), "name": re.search(r"<logName>(.*?)<", ss).group(1),
                                  "n": int(re.search(r"<sampleCount>(.*?)<", ss).group(1)), "wl": [float(w) for w in re.search(r"<wavelengths>(.*?)<", ss).group(1).split(",")]})
        inst = re.search(r"&lt;InstrumentName&gt;(.*?)&lt;", s); d["instrument"] = inst.group(1) if inst else None
        out.append(d)
    return out


def parse_logs(xml: str) -> list[dict]:
    out = []
    for m in re.finditer(r"<Log>(.*?)</Log>", xml, re.S):
        s = m.group(1)
        g = lambda t: (re.search(rf"<{t}>(.*?)<", s, re.I) or [None, None])[1]   # noqa: E731
        out.append({"logid": g("LogID"), "name": g("LogName"), "type": g("logType"), "n": int(g("SampleCount") or 0), "mask": g("maskLogID")})
    return out


def spec_tag(wl):
    return "vnswir" if wl[0] < 1000 else "mir" if wl[0] < 5000 else "tir"


def fetch_spectra(logid, s0, s1, nb, repairs):
    """Samples s0..s1 as (n, nb) float32; repairs the rare spectrum the server returns one byte short (as download_nvcl.py)."""
    raw = get(C.NVCL + f"getspectraldata.html?speclogid={logid}&startsampleno={s0}&endsampleno={s1}", timeout=600)
    n = s1 - s0 + 1
    if len(raw) == n * nb * 4:
        return np.frombuffer(raw, "<f4").reshape(n, nb)
    if n > 1:
        m = (s0 + s1) // 2
        return np.concatenate([fetch_spectra(logid, s0, m, nb, repairs), fetch_spectra(logid, m + 1, s1, nb, repairs)])
    if len(raw) != nb * 4 - 1:
        repairs.append({"sample": s0, "bytes": len(raw), "action": "nan"}); return np.full((1, nb), np.nan, "f4")
    front = np.frombuffer(raw[:4 * (nb - 1)], "<f4"); back = np.frombuffer(raw[-4 * (nb - 1):], "<f4"); best = None
    for k in range(nb):
        v = np.concatenate([front[:k], back[k:]]); r = np.abs(np.diff(v)).sum() if np.isfinite(v).all() else np.inf
        if best is None or r < best[0]:
            best = (r, k)
    k = best[1]; lo, hi = (front[k - 1] if k > 0 else back[k]), (back[k] if k < nb - 1 else front[k - 1])
    repairs.append({"sample": s0, "bytes": len(raw), "action": "interpolated band", "band": k})
    return np.concatenate([front[:k], [(lo + hi) / 2], back[k:]]).astype("f4")[None]


def download_hole(hole: str, raw_root: Path, progress=lambda msg, frac=None: None) -> Path:
    """Fetch everything CoreScope needs for one hole. Resumable: files already on disk are kept."""
    hd = raw_root / hole; hd.mkdir(parents=True, exist_ok=True)
    if (hd / "_done").exists():
        return hd
    xml = get(C.NVCL + f"getDatasetCollection.html?holeidentifier={hole}", hd / "datasets.xml").decode(errors="ignore")
    datasets = parse_datasets(xml)
    if not datasets:
        (hd / "datasets.xml").unlink(missing_ok=True)
        raise NVCLError(f"NVCL has no scanned dataset for '{hole}' (check the hole name)")
    manifest = {"hole": hole, "source": C.NVCL, "downloaded": time.strftime("%Y-%m-%d %H:%M"), "datasets": []}
    total = sum(s["n"] for d in datasets for s in d["spectral"] if s["name"] in ("Reflectance", "Base Refl", "Mir Reflectance") and spec_tag(s["wl"]) != "mir") or 1
    done_n = 0
    for di, d in enumerate(datasets):
        dsid, d8 = d["dsid"], d["dsid"][:8]
        logs = parse_logs(get(C.NVCL + f"getLogCollection.html?datasetid={dsid}", hd / f"scalar_logs_{dsid}.xml").decode(errors="ignore"))
        d["scalar_logs"] = [{k: l[k] for k in ("logid", "name", "type", "n")} for l in logs]
        # ---- spectra
        (hd / "spectra").mkdir(exist_ok=True)
        for sl in d["spectral"]:
            if sl["name"] not in ("Reflectance", "Base Refl", "Mir Reflectance") or sl["n"] == 0 or spec_tag(sl["wl"]) == "mir":
                continue
            tag = spec_tag(sl["wl"]); out = hd / "spectra" / f"{tag}_{d8}.npy"
            if not out.exists():
                parts, repairs = [], []
                for s0 in range(0, sl["n"], SPEC_CHUNK):
                    s1 = min(s0 + SPEC_CHUNK, sl["n"]) - 1
                    parts.append(fetch_spectra(sl["logid"], s0, s1, len(sl["wl"]), repairs)); done_n += s1 - s0 + 1
                    progress(f"下载光谱 数据集 {di + 1}/{len(datasets)} · {'短波红外' if tag == 'vnswir' else '热红外'} {s1 + 1:,}/{sl['n']:,} 个采样点", min(done_n / total, 1) * 0.85)
                if repairs:
                    (hd / "spectra" / f"{tag}_{d8}_repairs.json").write_text(json.dumps(repairs, indent=1))
                np.save(hd / "spectra" / f"{tag}_{d8}_wavelengths.npy", np.array(sl["wl"], "f4"))
                tmp = hd / "spectra" / f"{tag}_{d8}.part.npy"; np.save(tmp, np.concatenate(parts)); tmp.rename(out)
            else:
                done_n += sl["n"]
        # ---- per-sample table: masks + software mineral interpretation (as download_samples.py, only the columns used)
        progress(f"下载采样点信息 数据集 {di + 1}/{len(datasets)}", 0.87)
        sfile = hd / "samples" / f"{d8}.parquet"
        if not sfile.exists():
            users = {}
            for lg in logs:
                if lg["mask"]:
                    users.setdefault(lg["mask"], []).append(lg["name"] or "")
            cols, depth = {}, None
            for lg in logs:
                name = lg["name"] or ""
                if lg["type"] == "6":
                    u = users.get(lg["logid"], []); col = "mask_tir" if any(n.endswith("jCLST") for n in u) else "mask_swir" if any(n.endswith(("TSAS", "TSAV")) for n in u) else None
                elif name in LABEL_LOGS:
                    col = name
                else:
                    col = None
                if col is None or col in cols:
                    continue
                raw = get(C.NVCL + f"downloadscalars.html?logid={lg['logid']}", timeout=600)
                df = pd.read_csv(io.BytesIO(raw), na_values=["null"], keep_default_na=False, dtype=str)
                if list(df.columns[:2]) != ["StartDepth", "EndDepth"] or df.shape[1] != 3:
                    continue
                dep = df[["StartDepth", "EndDepth"]].astype("float64").to_numpy()
                if depth is None:
                    depth = dep
                elif dep.shape != depth.shape:
                    continue
                v = df.iloc[:, 2]
                cols[col] = pd.to_numeric(v, errors="coerce").fillna(0).astype("uint8") if lg["type"] == "6" else v.astype("category")
            if depth is not None:
                (hd / "samples").mkdir(exist_ok=True)
                out = pd.DataFrame({"start_depth": depth[:, 0], "end_depth": depth[:, 1], **cols}); tmp = hd / "samples" / f"{d8}.parquet.part"
                out.to_parquet(tmp, index=False); tmp.rename(sfile)
        # ---- 1 m lithology and gold logs
        progress(f"下载岩性和化验记录 数据集 {di + 1}/{len(datasets)}", 0.93)
        for lg in logs:
            name = lg["name"] or ""
            want = (lg["type"] == "1" and LITH_RE.match(name) and name != "RockMarks") or (lg["type"] == "2" and AU_RE.match(name))
            if not want:
                continue
            (hd / "ds1m").mkdir(exist_ok=True); fn = re.sub(r"[^A-Za-z0-9_.-]+", "_", name) + f"__{lg['logid'][:8]}.csv"
            try:
                get(C.NVCL + f"getDownsampledData.html?logid={lg['logid']}&interval=1.0&outputformat=csv", hd / "ds1m" / fn, tries=2, timeout=120)
            except NVCLError:
                pass
        dd = dict(d)
        for sl in dd["spectral"]:
            sl["wl"] = [sl["wl"][0], sl["wl"][-1], len(sl["wl"])]
        manifest["datasets"].append(dd)
    (hd / "manifest.json").write_text(json.dumps(manifest, indent=1)); (hd / "_done").touch()
    return hd
