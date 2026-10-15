"""The spectral log: how much of each mineral group TSG read in every interval of a hole, SWIR and TIR, the way
the official HyLogger summary report draws it (one stacked bar per interval, the groups' shares adding to 1).

TSG's unmixing gives each sample (about 8 mm) up to three groups with weights:
  SWIR   Grp1/2/3 sTSAS  + Wt1/2/3 sTSAS      (the system run; the user run, uTSAS, when there is no system run)
  TIR    Grp1/2/3 sjCLST + Wt1/2/3 sjCLST     (likewise ujCLST)
Per interval the weights are summed over the samples that have a result and divided by their number, so an
interval's mix adds to 1. Samples with no result (every group empty, or the side not scanned) count in `n` but
not in `n_result`. TSG's own INVALID group (mineral Aspectral) is a group like any other: it shows where the
scan read nothing. Nothing is masked out beyond that.

Two levels are kept, computed once when the hole is processed: 0.1 m (one row per 10 cm bin, the same bin numbers
as the tokens) and 1 m (the 0.1 m rows merged, weighted by n_result). Where several datasets of a hole cover a
depth, one is used, chosen as the cleaning chooses tokens: HyLogger 3 > 4 > 2, then the larger scan.

  dataset_acc(swir, tir, instrument)   one dataset's per-bin accumulators from its TSG scalars (any object with
                                       .scalars, .classes, .bandheaders: a pytsg Spectra, or read_scalars())
  hole_log(accs)                       the datasets of one hole -> {swir_groups, tir_groups, levels: {"1", "0.1"}}
  backfill(holes, workers)             the log of every mirrored hole, read from the mirror and handed to the platform
"""
from __future__ import annotations

import json, logging, re, shutil, tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd

from .pipeline import config as C
from .pipeline.tsg import NULL, _col, _labels, _numeric, find_pairs, header

log = logging.getLogger("coretrace.spectral")
SIDES = {"swir": "TSAS", "tir": "jCLST"}
LEVELS = {"1": 10, "0.1": 1}                                  # level name -> its step in bins (10 cm)
_TSA = re.compile(r"^(Grp|Wt)([123]) ([su])(TSAS|jCLST)$")


# ---------------------------------------------------------------------------------------------- reading one dataset
def read_scalars(tsg: Path, bip: Path) -> SimpleNamespace:
    """The per-sample scalars of a TSG file pair without its spectra: the .bip holds two planes, spectra then
    scalars, and only the second is read (memory-mapped). Same attributes as a pytsg Spectra where it matters."""
    from pytsg import parse_tsg as p
    lines = p._read_tsg_file(tsg); info = p._parse_tsg(lines, p._find_header_sections(lines))
    co = info["coordinates"]; nb, ns = int(co["lastband"]), int(co["lastsample"])
    plane = np.memmap(bip, dtype=np.float32, mode="r", shape=(2, ns, nb))[1]
    scalars = p._parse_scalars(np.asarray(plane), info["class"], info["band headers"])
    return SimpleNamespace(scalars=scalars, classes=info["class"], bandheaders=info["band headers"])


def tsa_columns(sp, kind: str) -> dict[str, str] | None:
    """{"Grp1": column name, ... "Wt3": ...} of the TSAS or jCLST result in a file: the system run (s) when it has
    one, else the user run (u). None when the file holds neither."""
    found: dict[str, dict[str, str]] = {"s": {}, "u": {}}
    for c in sp.scalars.columns:
        m = _TSA.match(str(c))
        if m and m.group(4) == kind:
            found[m.group(3)][m.group(1) + m.group(2)] = c
    for pre in ("s", "u"):
        if "Grp1" in found[pre]:
            return found[pre]
    return None


def group_order(sp, grp1: str) -> list[str]:
    """The groups in TSG's own legend order: the class table the Grp1 scalar reads through, by code."""
    bh = next((b for b in sp.bandheaders if b.name == grp1), None)
    table = (sp.classes or {}).get(bh.class_number) if bh is not None else None
    names = getattr(table, "classes", None) or {}
    return [str(names[k]).strip() for k in sorted(names) if str(names[k]).strip()]


def _side(sp, kind: str) -> dict | None:
    """One side's samples: depth, three group arrays (text, "" for none) and three weight arrays (NaN for none)."""
    cols = tsa_columns(sp, kind)
    if cols is None or "Depth (m)" not in sp.scalars:
        return None
    depth = np.round(_numeric(_col(sp.scalars, "Depth (m)")), 5)
    grp = [np.array([str(x).strip() if x is not None else "" for x in _labels(sp, cols[f"Grp{n}"])], object) if f"Grp{n}" in cols else np.full(len(depth), "", object) for n in "123"]
    wt = [_numeric(_col(sp.scalars, cols[f"Wt{n}"])) if f"Wt{n}" in cols else np.full(len(depth), np.nan) for n in "123"]
    return {"depth": depth, "grp": grp, "wt": wt, "groups": group_order(sp, cols["Grp1"])}


def accumulate(side: dict) -> dict:
    """Per 10 cm bin: n (samples), nr (samples with a result) and the summed normalised weight of each group.
    {"n": Series[bin], "nr": Series[bin], "w": Series[(bin, group)]}."""
    depth = side["depth"]; ok = np.isfinite(depth)
    b = np.floor(depth[ok] / C.BIN_M + 1e-6).astype(np.int64)
    G = np.stack([g[ok] for g in side["grp"]], 1); W = np.stack([w[ok] for w in side["wt"]], 1).astype("f8")
    has = G != ""
    W = np.where(has & np.isfinite(W) & (W > 0), W, 0.0)
    s = W.sum(1); any_ = has.any(1); flat = any_ & (s <= 0)             # a result without usable weights: equal shares
    W = np.where(flat[:, None], has / np.maximum(has.sum(1), 1)[:, None], W / np.where(s > 0, s, 1)[:, None])
    n = pd.Series(b).value_counts().sort_index(); nr = pd.Series(b[any_]).value_counts().reindex(n.index, fill_value=0)
    d = pd.DataFrame({"bin": np.repeat(b, 3), "g": G.ravel(), "w": W.ravel()})
    d = d[(d.g != "") & (d.w > 0)]
    w = d.groupby(["bin", "g"], sort=True).w.sum() if len(d) else pd.Series(dtype="f8", index=pd.MultiIndex.from_arrays([[], []], names=["bin", "g"]))
    return {"n": n.astype("i8"), "nr": nr.astype("i8"), "w": w}


def dataset_acc(swir, tir, instrument: str = "", name: str = "") -> dict:
    """One dataset's accumulators: {"name", "inst", "n", "swir": acc | None, "tir": acc | None, groups per side}."""
    out = {"name": name, "inst": instrument or "", "n": 0, "swir": None, "tir": None, "swir_groups": [], "tir_groups": []}
    for key, sp in (("swir", swir), ("tir", tir)):
        side = _side(sp, SIDES[key]) if sp is not None else None
        if side is None:
            continue
        out[key] = accumulate(side); out[f"{key}_groups"] = side["groups"]; out["n"] = max(out["n"], int(np.isfinite(side["depth"]).sum()))
    return out


# ---------------------------------------------------------------------------------------------- one hole
def _prio(d: dict):
    return (next((i for i, p in enumerate(C.PRIORITY) if d["inst"].startswith(p)), len(C.PRIORITY)), -d["n"])


def _rows(acc: dict | None, step: int, bins: np.ndarray) -> dict[int, dict | None]:
    """{from_bin: {n, n_result, mix}} of one side at one level (bins merged in groups of `step`), None where the
    side has no sample in the interval."""
    if acc is None or len(acc["n"]) == 0:
        return {int(b): None for b in bins}
    k = (acc["n"].index.to_numpy() // step) * step
    n = acc["n"].groupby(k).sum(); nr = acc["nr"].groupby(k).sum()
    w = acc["w"]; wk = (w.index.get_level_values("bin").to_numpy() // step) * step
    ws = w.groupby([wk, w.index.get_level_values("g")]).sum() if len(w) else w
    mix: dict[int, dict[str, float]] = {}
    for (fb, g), v in ws.items():
        r = round(float(v) / max(int(nr.get(fb, 0)), 1), 3)
        if r > 0:
            mix.setdefault(int(fb), {})[str(g)] = r
    return {int(b): ({"n": int(n[b]), "n_result": int(nr[b]), "mix": mix.get(int(b), {})} if b in n.index else None) for b in bins}


def hole_log(accs: list[dict]) -> dict | None:
    """The datasets of a hole -> the stored log: {swir_groups, tir_groups, levels: {"1": rows, "0.1": rows}} with
    rows [{from_m, swir, tir}]. One dataset per bin (HyLogger 3 > 4 > 2, then the larger scan); an interval
    without a sample on either side is not a row. None when no dataset has a TSA result."""
    accs = [a for a in sorted(accs, key=_prio) if a["swir"] is not None or a["tir"] is not None]
    if not accs:
        return None
    owner: dict[int, int] = {}
    for i, a in enumerate(accs):
        for side in ("swir", "tir"):
            if a[side] is not None:
                for b in a[side]["n"].index:
                    owner.setdefault(int(b), i)
    def own(a: dict, i: int, side: str):
        acc = a[side]
        if acc is None:
            return None
        keep = np.array([owner.get(int(b)) == i for b in acc["n"].index], bool)
        if not keep.any():
            return None
        bins = acc["n"].index[keep]
        w = acc["w"]; w = w[w.index.get_level_values("bin").isin(bins)] if len(w) else w
        return {"n": acc["n"][keep], "nr": acc["nr"][keep], "w": w}
    merged: dict[str, dict | None] = {}
    for side in ("swir", "tir"):
        parts = [p for p in (own(a, i, side) for i, a in enumerate(accs)) if p is not None]
        merged[side] = None if not parts else {k: pd.concat([p[k] for p in parts]).sort_index() for k in ("n", "nr", "w")}
    groups = {}
    for side in ("swir", "tir"):
        order: list[str] = []
        for a in accs:
            order += [g for g in a[f"{side}_groups"] if g not in order]
        seen = set(merged[side]["w"].index.get_level_values("g")) if merged[side] is not None and len(merged[side]["w"]) else set()
        groups[side] = [g for g in order if g in seen] + sorted(g for g in seen if g not in order)
    levels = {}
    for name, step in LEVELS.items():
        bins = np.array(sorted({(b // step) * step for b in owner}), np.int64)
        s, t = _rows(merged["swir"], step, bins), _rows(merged["tir"], step, bins)
        levels[name] = [{"from_m": round(int(b) / 10, 1), "swir": s[int(b)], "tir": t[int(b)]} for b in bins if s[int(b)] is not None or t[int(b)] is not None]
    return {"swir_groups": groups["swir"], "tir_groups": groups["tir"], "levels": levels}


def from_raw(hd: Path) -> dict | None:
    """The log of a hole in the raw layout tsg.write_hole wrote (its tsa/<d8>.json accumulators)."""
    man = json.loads((hd / "manifest.json").read_text()); accs = []
    for d in man["datasets"]:
        f = hd / "tsa" / f"{d['dsid'][:8]}.json"
        if f.exists():
            accs.append(load_acc(f))
    return hole_log(accs) if accs else None


def save_acc(acc: dict, path: Path) -> None:
    def side(a):
        if a is None:
            return None
        return {"n": {int(k): int(v) for k, v in a["n"].items()}, "nr": {int(k): int(v) for k, v in a["nr"].items()},
                "w": [[int(b), str(g), float(v)] for (b, g), v in a["w"].items()]}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({**{k: acc[k] for k in ("name", "inst", "n", "swir_groups", "tir_groups")}, "swir": side(acc["swir"]), "tir": side(acc["tir"])}))


def load_acc(path: Path) -> dict:
    d = json.loads(path.read_text())
    def side(a):
        if a is None:
            return None
        idx = np.array(sorted(int(k) for k in a["n"]), np.int64)
        n = pd.Series([a["n"][str(k)] for k in idx], index=idx, dtype="i8"); nr = pd.Series([a["nr"][str(k)] for k in idx], index=idx, dtype="i8")
        w = pd.Series([v for _, _, v in a["w"]], index=pd.MultiIndex.from_arrays([[b for b, _, _ in a["w"]], [g for _, g, _ in a["w"]]], names=["bin", "g"]), dtype="f8")
        return {"n": n, "nr": nr, "w": w}
    return {**d, "swir": side(d["swir"]), "tir": side(d["tir"])}


# ---------------------------------------------------------------------------------------------- backfill from the mirror
def log_from_folders(folders: list[Path]) -> dict | None:
    """The log of a hole from folders of TSG files, reading scalars only (no spectra, no models)."""
    accs = []
    for pair in (p for f in folders for p in find_pairs(Path(f))):
        h = header(pair["swir"][0])
        try:
            s = read_scalars(*pair["swir"])
        except Exception as e:                                # noqa: BLE001 - a damaged file loses its dataset, not the hole
            log.warning("%s: %s", pair["name"], e); continue
        t = None
        if pair["tir"]:
            try:
                t = read_scalars(*pair["tir"])
            except Exception as e:                            # noqa: BLE001
                log.warning("%s (TIR): %s", pair["name"], e)
        if "Depth (m)" not in s.scalars:
            continue                                          # a spectral library in the package, not a scan
        accs.append(dataset_acc(s, t, h["instrument"] or "", pair["name"]))
    return hole_log(accs) if accs else None


def _one(h: dict) -> tuple[str, str]:
    """(key, outcome) for one mirrored hole: 'sent', 'no log', 'missing zip' or an error."""
    from .platform import Platform
    from .sources import unpack_spectral, zip_path
    tmp = Path(tempfile.mkdtemp(prefix="spectral-", dir=C.DATA if C.DATA.exists() else None))
    try:
        folders = []
        for k, ref in enumerate(h["datasets"]):
            z = zip_path(ref)
            if z is None or not z.exists():
                continue
            d = tmp / f"ds{k:03d}"
            if unpack_spectral(z, d):
                folders.append(d)
        if not folders:
            return h["key"], "missing zip"
        lg = log_from_folders(folders)
        if lg is None:
            return h["key"], "no log"
        r = Platform().spectral_log(h["key"], lg)
        return h["key"], "sent" if r else "not on the platform"
    except Exception as e:                                    # noqa: BLE001 - one hole never stops the rest
        return h["key"], f"error: {type(e).__name__}: {e}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def backfill(holes: list[dict], workers: int = 4) -> dict:
    """Read every hole's log from the mirror and hand it to the platform, several holes at a time (each in its own
    process: pandas and the zip reader hold the GIL)."""
    out: dict[str, int] = {}; done = 0
    with ProcessPoolExecutor(max(1, workers)) as ex:
        for key, res in ex.map(_one, holes, chunksize=1):
            done += 1; kind = res if not res.startswith("error") else "error"
            out[kind] = out.get(kind, 0) + 1
            if kind == "error" or res == "not on the platform":
                log.warning("%s: %s", key, res)
            if done % 100 == 0:
                log.info("%d of %d holes: %s", done, len(holes), out)
    return {"holes": len(holes), **out}
