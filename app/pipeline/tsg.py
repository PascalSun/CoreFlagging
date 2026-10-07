"""Read a HyLogger scan as TSG files (the package NVCL prepares for download, and what a logging lab hands over)
and write it out in the raw-hole layout that preprocess.py cleans.

One scanned dataset is a pair of TSG file sets in one folder:
  <name>_tsg.tsg + <name>_tsg.bip            VNIR-SWIR reflectance, per-sample scalars (depth, Final Mask, TSA minerals,
                                             imported logs such as lithology and assays)
  <name>_tsg_tir.tsg + <name>_tsg_tir.bip    thermal infrared reflectance, its own Final Mask and jCLST minerals
A hole can have several datasets (rescans, HyLogger 3 and 4); each goes in as one folder.

The layout written is the one nvcl.download_hole produces, so a hole read from files and a hole fetched from the
NVCL service go through the same cleaning:
  manifest.json, datasets.xml, spectra/{vnswir,tir}_<d8>.npy (+ _wavelengths.npy), samples/<d8>.parquet, ds1m/*.csv
"""
from __future__ import annotations

import json, re, time
from html import escape
from pathlib import Path

import numpy as np
import pandas as pd
from pytsg import parse_tsg

from .nvcl import LABEL_LOGS, LITH_RE

NULL = -1e30                      # TSG writes a missing scalar as -FLT_MAX
AU_RE = re.compile(r"^au[ _(]*(ppm|ppb|assay[^)]*)?\)?$", re.I)
META_TAGS = ("DrillHoleName", "InstrumentName", "Project", "Owner", "DrillDate", "ExecSumm", "Datum", "Latitude", "Longitude", "Azimuth", "Inclination", "RL")


class TSGError(ValueError):
    pass


# pytsg looks a class scalar's code up in the class table and fails on a code the table lacks
# (seen in a few NVCL packages); such a sample is left unlabelled instead
parse_tsg.ClassHeaders.map_ints = lambda self, index: [self.classes.get(int(i), "") if i >= 0 else "" for i in index]  # type: ignore[method-assign]


def find_pairs(folder: Path) -> list[dict]:
    """The datasets in a folder: [{name, swir: (tsg, bip), tir: (tsg, bip) | None}]. File names are matched without case."""
    files = {p.name.lower(): p for p in Path(folder).rglob("*") if p.is_file()}
    out = []
    for low, p in sorted(files.items()):
        if not low.endswith("_tsg.tsg"):
            continue
        stem = low[:-len("_tsg.tsg")]; bip = files.get(stem + "_tsg.bip")
        if bip is None:
            continue
        t, tb = files.get(stem + "_tsg_tir.tsg"), files.get(stem + "_tsg_tir.bip")
        out.append({"name": p.name[:-len("_tsg.tsg")], "swir": (p, bip), "tir": (t, tb) if t and tb else None})
    return out


def header(tsg: Path) -> dict:
    """Dataset id, hole name and instrument from the text part of a .tsg file."""
    txt = Path(tsg).read_bytes()[:400_000].decode("latin1", "replace")
    g = lambda pat: (m.group(1).strip() if (m := re.search(pat, txt, re.I | re.M)) else None)   # noqa: E731
    return {"dsid": g(r"^UUID\s*:\s*(\S+)"), "hole": g(r"^drillhole name\s*=\s*(.+)$"), "instrument": g(r"^hylogger name\s*=\s*(.+)$"),
            "created": g(r"^Created\s*:\s*(.+)$")}


def _text(col: pd.Series) -> pd.Series:
    return col.astype(object).where(lambda s: s.notna() & (s.astype(str).str.strip() != ""), None)


def _labels(sp, name: str) -> pd.Series:
    """A class scalar as text. pytsg leaves scalars of class 0 as numeric codes (it tests class_number > 0), so those
    are mapped here from the class table."""
    col = _col(sp.scalars, name); bh = next(b for b in sp.bandheaders if b.name == name)
    if bh.class_number == 0 and bh.flag == 2 and col.dtype.kind in "fiu":
        names = sp.classes[0].classes; v = col.to_numpy("f8")
        col = pd.Series([names.get(int(x)) if np.isfinite(x) and x > NULL else None for x in v], dtype=object)
    return _text(col)


def _col(df: pd.DataFrame, name: str) -> pd.Series:
    """One column by name. Some TSG files carry two scalars of the same name (two Final Masks); the
    first in band order is the scan's own."""
    c = df[name]
    return c.iloc[:, 0] if isinstance(c, pd.DataFrame) else c


def _numeric(col: pd.Series) -> np.ndarray:
    v = pd.to_numeric(col, errors="coerce").to_numpy("f8"); v[v < NULL] = np.nan
    return v


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_")


def _description_xml(meta: dict) -> str:
    return "<TSGDrillHoleMiscMeta>" + "".join(f"<{t}>{escape(str(meta[t]))}</{t}>" for t in META_TAGS if meta.get(t) not in (None, "")) + "</TSGDrillHoleMiscMeta>"


def write_dataset(pair: dict, hd: Path, meta: dict | None = None) -> dict:
    """One dataset into the raw-hole folder `hd`. Returns its manifest entry (with the description block for datasets.xml)."""
    h = header(pair["swir"][0])
    if not h["dsid"]:
        raise TSGError(f"{pair['swir'][0].name}: no dataset UUID in the TSG header")
    dsid, d8 = h["dsid"], h["dsid"][:8]
    try:
        s = parse_tsg.read_tsg_bip_pair(pair["swir"][0], pair["swir"][1], "nir")
    except Exception as e:  # noqa: BLE001 - pytsg raises plain exceptions on a damaged file
        raise TSGError(f"{pair['swir'][0].name}: {e}") from e
    sc = s.scalars
    if "Depth (m)" not in sc:
        raise TSGError(f"{pair['swir'][0].name}: no 'Depth (m)' scalar")
    # TSG holds depth as float32; the NVCL service prints it to 5 decimals. Rounded the same way, so a sample on a
    # 10 cm boundary (23.8 m stored as 23.799999) lands in the same bin either way.
    depth = np.round(_col(sc, "Depth (m)").to_numpy("f8"), 5); n = len(depth)
    (hd / "spectra").mkdir(parents=True, exist_ok=True); (hd / "samples").mkdir(exist_ok=True)
    np.save(hd / "spectra" / f"vnswir_{d8}.npy", np.asarray(s.spectra, "f4")); np.save(hd / "spectra" / f"vnswir_{d8}_wavelengths.npy", np.asarray(s.wavelength, "f4"))
    cols = {"start_depth": depth, "end_depth": depth}
    if "Final Mask" in sc:
        cols["mask_swir"] = (_numeric(_col(sc, "Final Mask")) == 1).astype("uint8")
    for name in sorted(LABEL_LOGS):
        if name in sc and name.endswith(("TSAS", "TSAV")):
            cols[name] = _labels(s, name)
    spectral = [{"name": "Reflectance", "n": n, "wl": [float(s.wavelength[0]), float(s.wavelength[-1]), len(s.wavelength)]}]
    if pair["tir"]:
        try:
            t = parse_tsg.read_tsg_bip_pair(pair["tir"][0], pair["tir"][1], "tir")
        except Exception as e:  # noqa: BLE001
            t = None; tir_error = str(e)
        if t is not None and len(t.spectra) == n:
            np.save(hd / "spectra" / f"tir_{d8}.npy", np.asarray(t.spectra, "f4")); np.save(hd / "spectra" / f"tir_{d8}_wavelengths.npy", np.asarray(t.wavelength, "f4"))
            spectral.append({"name": "Base Refl", "n": n, "wl": [float(t.wavelength[0]), float(t.wavelength[-1]), len(t.wavelength)]})
            mf = pair["swir"][0].with_name(f"{pair['name']}_tir_mask.npy")     # the data service's own TIR mask, when sources.py found one
            override = np.load(mf) if mf.exists() else None
            if override is not None and len(override) == n:
                cols["mask_tir"] = override.astype("uint8")
            elif "Final Mask" in t.scalars:
                cols["mask_tir"] = (_numeric(_col(t.scalars, "Final Mask")) == 1).astype("uint8")
            for name in sorted(LABEL_LOGS):
                if name in t.scalars and name.endswith("jCLST"):
                    cols[name] = _labels(t, name)
    pd.DataFrame(cols).to_parquet(hd / "samples" / f"{d8}.parquet", index=False)
    # ---- imported 1 m logs, as the NVCL service downsamples them: one row per metre (and class), all samples counted
    metre = np.floor(depth).astype(int); class_logs = {b.name for b in s.bandheaders if b.class_number >= 0}
    for name in sc.columns:
        if name in class_logs and LITH_RE.match(name) and name != "RockMarks":
            v = _labels(s, name); d = pd.DataFrame({"m": metre, "c": v}).dropna()
            if len(d):
                g = d.groupby(["m", "c"]).size().reset_index(name="n")
                (hd / "ds1m").mkdir(exist_ok=True)
                (hd / "ds1m" / f"{_safe(name)}__{d8}.csv").write_text("Depth,Classification,Colour,Count\n" + "".join(f"{m + 0.5},{c},0,{k}\n" for m, c, k in g.itertuples(index=False)))
        elif name not in class_logs and AU_RE.match(name.strip()):
            v = _numeric(_col(sc, name))
            if np.isfinite(v).any():
                # a metre with samples but no assay comes back from the service as 0, not as missing; kept the same here
                g = pd.DataFrame({"m": metre, "v": v}).groupby("m").v.mean().fillna(0.0)
                (hd / "ds1m").mkdir(exist_ok=True)
                (hd / "ds1m" / f"{_safe(name)}__{d8}.csv").write_text("Depth,Value\n" + "".join(f"{m + 0.5},{x!r}\n" for m, x in g.items()))
    m = dict(meta or {}); m.setdefault("DrillHoleName", h["hole"]); m.setdefault("InstrumentName", h["instrument"])
    from ..trays import index as tray_index
    return {"trays": tray_index(s, depth), "dsid": dsid, "name": pair["name"], "depth": [float(np.nanmin(depth)), float(np.nanmax(depth))], "instrument": m.get("InstrumentName") or h["instrument"],
            "spectral": spectral, "description": _description_xml(m)}


def write_hole(hole: str, folders: list[Path], raw_root: Path, meta: dict[str, dict] | None = None, source: str = "TSG files") -> Path:
    """All datasets of one hole (one folder each, or several in one folder) into <raw_root>/<hole>/.
    `meta` maps a dataset name to its TSG header fields (project, owner, coordinates ...) when a catalogue has them."""
    hd = Path(raw_root) / hole; hd.mkdir(parents=True, exist_ok=True)
    pairs = [p for f in folders for p in find_pairs(Path(f))]
    if not pairs:
        raise TSGError("no <name>_tsg.tsg + <name>_tsg.bip pair found")
    # a scan package sometimes carries spectral libraries as TSG files too (reference spectra with no
    # depth: "Mean VNIR-SWIR magnetite", "Lepidolite SWIR USGS"); they are not scans and are passed over
    datasets, skipped = [], []
    for p in pairs:
        try:
            datasets.append(write_dataset(p, hd, (meta or {}).get(p["name"])))
        except TSGError as e:
            if "no 'Depth (m)' scalar" not in str(e):
                raise
            skipped.append(str(e))
    if not datasets:
        raise TSGError("; ".join(skipped) or "no scan in these files")
    xml = "<DatasetCollection>" + "".join(f"<Dataset><DatasetID>{d['dsid']}</DatasetID><DatasetName>{escape(d['name'])}</DatasetName><description>{escape(d.pop('description'))}</description></Dataset>"
                                           for d in datasets) + "</DatasetCollection>"
    (hd / "datasets.xml").write_text(xml)
    (hd / "manifest.json").write_text(json.dumps({"hole": hole, "source": source, "downloaded": time.strftime("%Y-%m-%d %H:%M"), "datasets": datasets}, indent=1))
    (hd / "_done").touch()
    return hd
