"""Sample sheets: one A4 page per depth interval of a hole, as a PDF (or one page as a PNG preview), and the same
intervals' numbers as a zip of CSV files.

A page is laid out like the GSNSW TSG sample sheets geologists know: the interval's line scan full height down the
left with thin SWIR- and TIR-group columns beside it, one reading (about 8 mm) per row; on the right a results box
with the SWIR and TIR group pies side by side, each over its group -> mineral table; below it the interval's mean
SWIR and TIR spectra and a few facts (mask, classification, min share, data source).

Alignment: the line scan has exactly `specny` image rows per spectrum sample, in sample order, while sample depths
are not linear in index (tray and section breaks, gaps). So the strip and the columns are both laid out by sample
index, every sample the same height, and depth is shown as tick labels read from the samples' own depths. No rows
are ever cut out of the strip (an "empty tray" trim would shift every reading below it).

Shares are of the spectra the Final Mask keeps (all of the interval's spectra when it keeps none, or the file has no
mask), weighted by the TSA weights of up to three minerals per spectrum. Groups and minerals below `min_share` fold
into "Other" / "+N more". Aspectral and INVALID readings are a grey "No SWIR-active minerals" wedge, not dropped.

Built on the package cache of samples.py; the same request on another hole reads nothing twice.
"""
from __future__ import annotations

import contextlib, io, re, threading, time
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import samples as smp

MAX_INTERVALS, MAX_SPAN_M = 300, 20.0
FORMATS, PNG_DPI, DPI_RANGE = ("pdf", "png", "zip"), 110, (60, 200)   # png: one page, ~910 px wide at 110 dpi
MAX_SPECTRA = 20_000                       # zip with every reading's spectrum: readings over all intervals
MAX_GROUPS, MAX_MINERALS = 8, 3            # wedges per pie (with "Other"), minerals listed under a group
NULL = -1e30
NO_SWIR, NO_TIR, NO_RESULT, OTHER = "No SWIR-active minerals", "No TIR-active minerals", "Not classified", "Other"
NOT_ACTIVE = {"ASPECTRAL", "INVALID"}
GREY, PALE, OTHER_C, NONE_C = "#9e9e9e", "#d9d9d9", "#bbbbbb", "#ffffff"
# when a file carries no class colours: a fixed set, given out in order of first appearance in the hole
PALETTE = ["#4e79a7", "#f28e2b", "#59a14f", "#e15759", "#76b7b2", "#edc948", "#b07aa1", "#ff9da7", "#9c755f",
           "#1f77b4", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#17becf", "#bcbd22"]
SWIR_MARKS = (1400, 1900, 2200, 2250, 2335)
_lock = threading.Lock()                   # matplotlib's font and text caches are not safe across threads


class BadRequest(ValueError):
    pass


# ---------------------------------------------------------------------------------------------- request checking

def check(body: dict) -> dict:
    """The request with defaults filled, or BadRequest saying what is wrong."""
    iv = body.get("intervals")
    if not isinstance(iv, list) or not 1 <= len(iv) <= MAX_INTERVALS:
        raise BadRequest(f"intervals: 1 to {MAX_INTERVALS} are needed")
    out = []
    for k, x in enumerate(iv):
        try:
            a, b = float(x["from_m"]), float(x["to_m"])
        except (KeyError, TypeError, ValueError):
            raise BadRequest(f"interval {k + 1}: from_m and to_m are needed")
        if not (np.isfinite(a) and np.isfinite(b) and b > a):
            raise BadRequest(f"interval {k + 1}: to_m must be greater than from_m")
        if b - a > MAX_SPAN_M:
            raise BadRequest(f"interval {k + 1}: an interval is up to {MAX_SPAN_M:g} m")
        out.append({"label": str(x.get("label") or f"{a:g}–{b:g} m")[:80], "from_m": a, "to_m": b})
    results = body.get("results", "auto")
    if results not in ("auto", "system", "user"):
        raise BadRequest("results is auto, system or user")
    ms = float(body.get("min_share", 0.05))
    if not 0 <= ms <= 0.5:
        raise BadRequest("min_share is between 0 and 0.5")
    swir, tir = bool(body.get("swir", True)), bool(body.get("tir", True))
    if not (swir or tir):
        raise BadRequest("ask for SWIR, TIR or both")
    fmt = body.get("format") or "pdf"
    if fmt not in FORMATS:
        raise BadRequest("format is pdf, png or zip")
    if fmt == "png" and len(out) != 1:
        raise BadRequest("a png preview is of exactly one interval")
    try:
        dpi = int(round(float(body["dpi"]))) if body.get("dpi") is not None else PNG_DPI
    except (TypeError, ValueError):
        raise BadRequest("dpi is a number")
    dpi = min(max(dpi, DPI_RANGE[0]), DPI_RANGE[1])
    return {"intervals": out, "results": results, "min_share": ms, "swir": swir, "tir": tir, "format": fmt, "dpi": dpi,
            "all_spectra": bool(body.get("all_spectra", False))}


# ---------------------------------------------------------------------------------------------- reading a file

def colorref(c: int) -> str:
    """A TSG colour (a Windows COLORREF, 0x00BBGGRR) as #rrggbb."""
    return f"#{c & 255:02x}{(c >> 8) & 255:02x}{(c >> 16) & 255:02x}"


@lru_cache(maxsize=16)
def _colours_cached(path: str, mtime: float) -> dict[int, dict[str, str]]:
    text = Path(path).read_bytes().decode("latin1", "replace")
    out: dict[int, dict[str, str]] = {}
    for m in re.finditer(r"^\[class (\d+)\][ \t]*\r?\n(.*?)(?=^\[|\Z)", text, flags=re.S | re.M):
        body = m.group(2); col = re.search(r"^colours\s*=\s*(.+)$", body, flags=re.M)
        if not col:
            continue
        cs = [int(x) for x in col.group(1).split() if x.lstrip("-").isdigit()]
        items = {}
        for line in body.splitlines():
            if im := re.match(r"^(\d+):(.*)$", line.strip()):
                i = int(im.group(1))
                if i < len(cs):
                    items[im.group(2).strip()] = colorref(cs[i])
        out[int(m.group(1))] = items
    return out


def class_colours(tsg: Path | None) -> dict[int, dict[str, str]]:
    """{class number: {item name: colour}} from the [class N] sections of a .tsg file (pytsg drops the colours)."""
    if tsg is None or not Path(tsg).exists():
        return {}
    return _colours_cached(str(tsg), Path(tsg).stat().st_mtime)


_RANK = re.compile(r"^(Grp|Min|Wt)([123]) ([su])(TSAS|jCLST|TSAT)$")


def run_of(sp, kinds: tuple[str, ...], results: str) -> tuple[str, dict[str, str]] | None:
    """The TSA run to read: (its suffix, e.g. "sTSAS", {"Grp1": column, ...}). `results` system / user picks the s* or
    u* run; auto takes the system run when the file has one, else the user's. A TIR file is read through jCLST, else
    TSAT."""
    found: dict[str, dict[str, str]] = {}
    for c in sp.scalars.columns:
        if (m := _RANK.match(str(c))) and m.group(4) in kinds:
            found.setdefault(m.group(3) + m.group(4), {})[m.group(1) + m.group(2)] = c
    order = {"system": "s", "user": "u", "auto": "su"}[results]
    for who in order:
        for kind in kinds:
            cols = found.get(who + kind)
            if cols and "Grp1" in cols and "Wt1" in cols:
                return who + kind, cols
    return None


def _column(sp, name: str):
    c = sp.scalars[name]
    return c.iloc[:, 0] if getattr(c, "ndim", 1) == 2 else c       # two scalars of one name: the first is the scan's


def _names(sp, name: str | None, n: int) -> np.ndarray:
    """A class scalar as text per sample ("" where nothing was read). pytsg leaves class 0 as numeric codes: those
    are read through the file's class table of that column."""
    if name is None:
        return np.full(n, "", object)
    col = _column(sp, name)
    if col.dtype.kind in "fiu":
        bh = next((b for b in sp.bandheaders if b.name == name), None)
        table = (sp.classes[bh.class_number].classes if bh is not None and bh.class_number in range(len(sp.classes)) else
                 smp._class_table(sp, "Minerals" if name.startswith("Min") else "Groups"))
        v = col.to_numpy("f8")
        return np.array([table.get(int(round(x)), "") if np.isfinite(x) and x > NULL else "" for x in v], object)
    return np.array(["" if x is None else str(x).strip() for x in col], object)


def _class_number(sp, name: str) -> int | None:
    bh = next((b for b in sp.bandheaders if b.name == name), None)
    return None if bh is None or bh.class_number < 0 else int(bh.class_number)


class Run:
    """One file's TSA reading, for every sample: groups, minerals and weights of ranks 1-3, the Final Mask, and the
    group colours of the file's class table."""

    def __init__(self, sp, tsg: Path | None, kinds: tuple[str, ...], results: str):
        n = len(sp.sampleheaders); self.n = n
        r = run_of(sp, kinds, results)
        self.label, cols = (r if r else ("", {}))
        self.G = np.stack([_names(sp, cols.get(f"Grp{k}"), n) for k in "123"])
        self.M = np.stack([_names(sp, cols.get(f"Min{k}"), n) for k in "123"])
        W = np.zeros((3, n))
        for j, k in enumerate("123"):
            if (c := cols.get(f"Wt{k}")) is not None:
                w = _column(sp, c).to_numpy("f8"); W[j] = np.where(np.isfinite(w) & (w > NULL), w, 0.0)
        self.W = W
        self.mask = None
        if "Final Mask" in sp.scalars.columns:
            m = _column(sp, "Final Mask")
            self.mask = (m.to_numpy("f8") == 1) if m.dtype.kind in "fiu" else np.array([str(x).strip().lower() in ("on", "1", "1.0") for x in m])
        cn = _class_number(sp, cols["Grp1"]) if cols else None
        self.colours = class_colours(tsg).get(cn, {}) if cn is not None else {}
        self.who = {"s": "system", "u": "user"}.get(self.label[:1], "")
        # the name TSG gives the run, as geologists quote it: "S_SWIR_TSA705 Groups" -> TSA705, the user's -> uTSA705
        cname = ""
        if cn is not None:
            ch = sp.classes.get(cn) if isinstance(sp.classes, dict) else (sp.classes[cn] if cn < len(sp.classes) else None)
            cname = str(getattr(ch, "name", "") or "")
        core = re.sub(r"^(?:[SU]_)?(?:SWIR_|TIR_|VNIR_)?|\s+Groups$", "", cname).strip()
        self.name = ((("u" if self.who == "user" else "") + core) if core else self.label)
        self.D = sp.sampleheaders["D"].astype(float).to_numpy()

    def rows(self, idx: np.ndarray) -> tuple[np.ndarray, bool]:
        """The masked-on samples of `idx`, or all of them when the mask keeps none (second value: the mask was used)."""
        if self.mask is None or len(idx) == 0:
            return idx, False
        on = idx[self.mask[idx]]
        return (on, True) if len(on) else (idx, False)


class Palette:
    """Group colours: the file's class colours, else a fixed palette in order of first use (stable within a PDF)."""

    def __init__(self, *tables: dict[str, str]):
        self.known: dict[str, str] = {}
        for t in tables:
            for k, v in t.items():
                self.known.setdefault(k.upper(), v)
        self.given: dict[str, str] = {}

    def __call__(self, group: str) -> str:
        g = group.upper()
        if g in NOT_ACTIVE or group in (NO_SWIR, NO_TIR):
            return GREY
        if group == OTHER:
            return OTHER_C
        if group == NO_RESULT or not g:
            return PALE
        if g in self.known:
            return self.known[g]
        if g not in self.given:
            self.given[g] = PALETTE[len(self.given) % len(PALETTE)]
        return self.given[g]


# ---------------------------------------------------------------------------------------------- shares

def shares(G: np.ndarray, M: np.ndarray, W: np.ndarray, rows: np.ndarray, min_share: float, inactive: str) -> list[dict]:
    """Group -> mineral shares of the spectra `rows`: [{group, share, minerals: [(name, share)]}], heaviest first.

    Each spectrum counts once, split over its (up to three) TSA minerals by their weights; a share is that weight
    summed over the rows, over the number of rows. Aspectral / INVALID readings are the `inactive` group; what the
    run left unread is "Not classified". Groups below min_share (and any past the eighth) fold into "Other", and
    minerals below it (and past the third) into "+N more"."""
    n = len(rows)
    if n == 0:
        return []
    acc: dict[str, dict] = {}
    for r in range(G.shape[0]):
        g, m, w = G[r, rows], M[r, rows], W[r, rows]
        for gi, mi, wi in zip(g, m, w):
            if wi <= 0 or not (gi or mi):
                continue
            if gi.upper() in NOT_ACTIVE or mi.upper() in NOT_ACTIVE:
                gi, mi = inactive, ""
            e = acc.setdefault(gi or "?", {"w": 0.0, "min": {}})
            e["w"] += float(wi)
            if mi:
                e["min"][mi] = e["min"].get(mi, 0.0) + float(wi)
    total = sum(e["w"] for e in acc.values())
    if n - total > 1e-6 * n:
        acc.setdefault(NO_RESULT, {"w": 0.0, "min": {}})["w"] += n - total
    special = (inactive, NO_RESULT)
    groups = sorted(((g, e) for g, e in acc.items() if g not in special), key=lambda x: -x[1]["w"])
    out, other = [], 0.0
    for g, e in groups:
        s = e["w"] / n
        if s < min_share or len(out) >= MAX_GROUPS - 1:
            other += s; continue
        mins = sorted(e["min"].items(), key=lambda x: -x[1])
        keep = [(k, w / n) for k, w in mins if w / n >= min_share][:MAX_MINERALS]
        rest = len(mins) - len(keep)
        if rest > 0:
            keep.append((f"+{rest} more", sum(w for _, w in mins) / n - sum(s_ for _, s_ in keep)))
        out.append({"group": g, "share": s, "minerals": keep})
    for g in special:
        if g in acc:
            s = acc[g]["w"] / n
            if s >= min_share:
                out.append({"group": g, "share": s, "minerals": []})
            else:
                other += s
    if other > 1e-9:
        out.insert(len([x for x in out if x["group"] not in special]), {"group": OTHER, "share": other, "minerals": []})
    return out


def dominant(G: np.ndarray, W: np.ndarray, idx: np.ndarray) -> np.ndarray:
    """The heaviest group of each sample in `idx` ("" where nothing was read)."""
    if len(idx) == 0:
        return np.array([], object)
    w = W[:, idx]; best = np.argmax(w, axis=0)
    g = G[best, idx]
    return np.where(w[best, np.arange(len(idx))] > 0, g, G[0, idx])


def nearest(src: np.ndarray, dst: np.ndarray, tol: float = 0.005) -> np.ndarray:
    """For each depth in `src`, the index of the `dst` sample within `tol` m of it, or -1. The TIR file has its own
    sample list in some packages; neither list need be sorted."""
    if len(dst) == 0:
        return np.full(len(src), -1)
    order = np.argsort(dst, kind="stable"); sd = dst[order]
    k = np.clip(np.searchsorted(sd, src), 1, len(sd) - 1) if len(sd) > 1 else np.zeros(len(src), int)
    if len(sd) > 1:
        left = np.abs(sd[k - 1] - src) <= np.abs(sd[k] - src); k = np.where(left, k - 1, k)
    out = order[k]
    return np.where(np.abs(dst[out] - src) <= tol, out, -1)


def window(D: np.ndarray, lo: float, hi: float) -> tuple[int, int]:
    """Samples [i0, i1) of [lo, hi) m, found as samples.py finds a window (so a sheet and the Window tab agree)."""
    return int(np.searchsorted(D, lo)), int(np.searchsorted(D, hi))


# ---------------------------------------------------------------------------------------------- the line scan

STRIP_W, STRIP_MAX_H = 260, 2000


def strip(cras: Path | None, i0: int, i1: int, specny: int, width: int | None = None) -> np.ndarray | None:
    """The line scan of samples [i0, i1), resized to STRIP_W across and at most STRIP_MAX_H tall: uniform in both
    directions, so sample k still spans rows k*H/n .. (k+1)*H/n."""
    from PIL import Image
    if cras is None or i1 <= i0:
        return None
    rows = (i1 - i0) * specny; factor = 1
    for f in (8, 4, 2):                      # decode at the smallest scale that still leaves the page enough rows
        if rows / f >= min(STRIP_MAX_H, rows) and (width or 1209) / f >= STRIP_W * 0.5:
            factor = f; break
    try:
        a = smp.cras_rows(cras, i0, i1, factor)
    except smp.NoPackage:
        return None
    h = min(STRIP_MAX_H, a.shape[0]); w = STRIP_W
    return np.asarray(Image.fromarray(a).resize((w, max(1, h)), Image.BILINEAR))




# ---------------------------------------------------------------------------------------------- reading a hole once

class Hole:
    """What one request reads from a package, once for all its intervals: the SWIR and TIR runs, depths, trays,
    the TIR pairing, and the line-scan file."""

    def __init__(self, refs: list[str], dataset: str, req: dict):
        d = smp.package(refs, dataset); f = smp._files(d); self.files = f
        self.sp = smp._spectra_of(d, dataset)
        self.tir = smp._tir_of(d, dataset) if req["tir"] else None
        self.sw = Run(self.sp, f.get("tsg"), ("TSAS",), req["results"])
        self.tw = Run(self.tir, f.get("tir_tsg"), ("jCLST", "TSAT"), req["results"]) if self.tir is not None else None
        self.pal = Palette(self.sw.colours, self.tw.colours if self.tw else {})
        self.D = self.sw.D
        self.tmap = nearest(self.D, self.tw.D) if self.tw is not None else None
        sh = self.sp.sampleheaders
        self.trays = sh["T"].astype(str).to_numpy() if "T" in sh.columns else None
        self.swl = np.asarray(self.sp.wavelength, float)
        self.twl = np.asarray(self.tir.wavelength, float) / 1000.0 if self.tir is not None else None
        self.cras = f.get("cras"); self.specny = smp.specny_of(self.cras) if self.cras else 0; self.cras_w = None
        if self.cras:
            import struct
            with open(self.cras, "rb") as fh:
                self.cras_w = struct.unpack(smp._CRAS_HEAD, fh.read(64))[1]

    def interval(self, lo: float, hi: float) -> dict:
        """The samples of [lo, hi): idx (all), rows (the masked-on SWIR ones, used: whether the mask chose them),
        tk (the TIR samples paired with idx) and trows / tused likewise."""
        i0, i1 = window(self.D, lo, hi); idx = np.arange(i0, i1)
        rows, used = self.sw.rows(idx)
        out = {"i0": i0, "i1": i1, "idx": idx, "rows": rows, "used": used, "k": None, "tk": np.array([], int), "trows": np.array([], int), "tused": False}
        if self.tw is not None and len(idx):
            k = self.tmap[idx]; tk = np.unique(k[k >= 0]); trows, tused = self.tw.rows(tk)
            out.update(k=k, tk=tk, trows=trows, tused=tused)
        return out

    def tray_text(self, idx: np.ndarray) -> str:
        if self.trays is None or not len(idx):
            return ""
        t = sorted({x for x in self.trays[idx] if x.strip()})
        return (f"tray {t[0]}" if len(t) == 1 else f"trays {t[0]}–{t[-1]}") if t else ""


def _valid(X: np.ndarray) -> np.ndarray:
    """The rows of a spectra block that are real readings (TSG marks a missing one with NaN or a huge null)."""
    return np.isfinite(X).all(axis=1) & (np.abs(X) < 1e3).all(axis=1) if len(X) else np.array([], bool)


# ---------------------------------------------------------------------------------------------- rendering

A4 = (8.27, 11.69)
INK, NAVY, BAND, RULE = "#1d1d1f", "#1f3a5f", "#e8edf3", "#c8d0da"
MARGIN, HEAD_H, GAP, BAND_H = 0.3, 0.66, 0.12, 0.27
ROW_H, ROW_MIN = 0.158, 0.118              # table row height (in): wanted, and the least before minerals give way


def _rect(fig, x, y, w, h, **kw):
    """A rectangle in inches from the page's lower left."""
    from matplotlib.patches import Rectangle
    W, H = A4
    fig.patches.append(Rectangle((x / W, y / H), w / W, h / H, transform=fig.transFigure, **kw))


def _text(fig, x, y, s, **kw):
    W, H = A4
    return fig.text(x / W, y / H, s, **kw)


def _axes(fig, x, y, w, h, **kw):
    W, H = A4
    return fig.add_axes([x / W, y / H, w / W, h / H], **kw)


def _box(fig, x, y, w, h, title: str = "", right: str = ""):
    """A bordered box with a title band (the sheet's sections); the content top in inches."""
    _rect(fig, x, y, w, h, facecolor="white", edgecolor=NAVY, lw=1.0, zorder=-2)
    if not title:
        return y + h
    _rect(fig, x, y + h - BAND_H, w, BAND_H, facecolor=BAND, edgecolor=NAVY, lw=1.0, zorder=-1)
    _text(fig, x + 0.1, y + h - BAND_H / 2, title, fontsize=9.5, fontweight="bold", color=NAVY, va="center")
    if right:
        _text(fig, x + w - 0.1, y + h - BAND_H / 2, right, fontsize=6.8, color="#555", va="center", ha="right")
    return y + h - BAND_H


def _fits(s: str, width_in: float, fs: float, bold: bool = False) -> str:
    """`s` cut with an ellipsis to about `width_in` inches at `fs` points (DejaVu Sans averages ~0.6 em a letter)."""
    n = max(4, int(width_in * 72 / (fs * (0.66 if bold else 0.6))))
    return s if len(s) <= n else s[:n - 1] + "…"


def _ticks(D: np.ndarray, n: int, want: int = 18) -> tuple[list[float], list[str]]:
    """Depth labels at sample positions (index units), about `want` of them, at round depths where possible."""
    if n == 0:
        return [], []
    span = D[-1] - D[0] if n > 1 else 0.0
    step = next((s for s in (0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5) if span / s <= want), 5)
    pos, lab = [], []
    for t in np.arange(np.ceil(D[0] / step - 1e-6) * step, D[-1] + 1e-9, step):
        k = int(np.argmin(np.abs(D - t)))
        if pos and k - pos[-1] < n * 0.035:
            continue
        pos.append(k + 0.5); lab.append(f"{D[k]:.2f}")
    return pos, lab


def _pct(s: float) -> str:
    return "<1%" if s < 0.005 else f"{s * 100:.0f}%"


def _trim(minerals: list, keep: int) -> list:
    """A group's mineral rows cut to `keep` named minerals, the rest (and any "+N more") folded into one "+N more"."""
    named = [(k, v) for k, v in minerals if not k.startswith("+")]
    more = next(((int(k[1:].split()[0]), v) for k, v in minerals if k.startswith("+")), (0, 0.0))
    if len(named) <= keep:
        return minerals
    if keep == 0:
        return []
    drop = named[keep:]
    return named[:keep] + [(f"+{more[0] + len(drop)} more", more[1] + sum(v for _, v in drop))]


def _table_layout(data: list[dict], h: float) -> tuple[list[dict], float]:
    """The table's rows and row height fitted into h inches: rows shrink to ROW_MIN, then minerals give way (three,
    two, one, none per group), then rows shrink further. It never runs past h."""
    for keep in (MAX_MINERALS, 2, 1, 0):
        rows = [dict(d, minerals=_trim(d["minerals"], keep)) for d in data]
        n = sum(1 + len(d["minerals"]) for d in rows)
        rh = min(ROW_H, h / max(n, 1))
        if rh >= ROW_MIN or keep == 0:
            return rows, rh
    return rows, rh


def _table(fig, x: float, y_top: float, w: float, rows: list[dict], rh: float, pal: Palette):
    """Group rows (colour square, bold name, share) with their minerals indented beneath, as on the GSNSW sheets;
    `rows` and `rh` from _table_layout."""
    fs = max(4.0, min(7.2, rh * 46)); sq = min(0.13, rh * 0.75)
    y = y_top
    for d in rows:
        y -= rh
        _rect(fig, x, y + (rh - sq * 0.75) / 2, sq, sq * 0.75, facecolor=pal(d["group"]), edgecolor="#777", lw=0.4)
        _text(fig, x + sq + 0.07, y + rh / 2, _fits(d["group"], w - sq - 0.5, fs, True), fontsize=fs, fontweight="bold", va="center", color=INK)
        _text(fig, x + w, y + rh / 2, _pct(d["share"]), fontsize=fs, fontweight="bold", va="center", ha="right", color="#33475e")
        for name, s in d["minerals"]:
            y -= rh
            _text(fig, x + sq + 0.2, y + rh / 2, _fits(name, w - sq - 0.6, fs - 0.6), fontsize=fs - 0.6, va="center", color="#444")
            _text(fig, x + w, y + rh / 2, _pct(s), fontsize=fs - 0.6, va="center", ha="right", color="#666")


def _pie(fig, x: float, y: float, d: float, data: list[dict], pal: Palette, empty: str):
    ax = _axes(fig, x, y, d, d); ax.set_aspect("equal")
    if not data:
        ax.text(0.5, 0.5, empty, ha="center", va="center", fontsize=7.5, color="#666"); ax.axis("off"); return
    ax.pie([p["share"] for p in data], colors=[pal(p["group"]) for p in data], startangle=90, counterclock=False,
           wedgeprops={"linewidth": 0.6, "edgecolor": "white"}, normalize=True)


def _results(fig, x: float, y: float, w: float, h: float, title: str, panels: list[dict], pal: Palette):
    """The results box: one column per panel, side by side, each a title, its pie and its table beneath. One panel
    alone takes the whole box: a bigger pie over a table centred under it."""
    from matplotlib.lines import Line2D
    top = _box(fig, x, y, w, h, title)
    cw = w / len(panels)
    need = max(max(sum(1 + len(q["minerals"]) for q in p["data"]), 1) for p in panels) * ROW_H   # one pie size, tables level
    d = float(np.clip(h - BAND_H - 0.62 - need - 0.15, 1.2, min(1.75 if len(panels) > 1 else 2.6, cw - 0.5)))
    ty = top - 0.5 - d - 0.08
    fitted = [_table_layout(p["data"], ty - (y + 0.08)) for p in panels]
    rh = min(f[1] for f in fitted)                # one row height (and type size) for both tables
    for j, p in enumerate(panels):
        cx = x + j * cw
        if j:
            fig.lines.append(Line2D([cx / A4[0]] * 2, [(y + 0.1) / A4[1], (top - 0.1) / A4[1]], transform=fig.transFigure, color=RULE, lw=0.8))
        _text(fig, cx + cw / 2, top - 0.2, p["title"], fontsize=9, fontweight="bold", color=NAVY, ha="center", va="center")
        _text(fig, cx + cw / 2, top - 0.38, p["sub"], fontsize=6.5, color="#666", ha="center", va="center")
        _pie(fig, cx + (cw - d) / 2, top - 0.5 - d, d, p["data"], pal, p["empty"])
        tw = min(cw - 0.4, 3.6)
        _table(fig, cx + (cw - tw) / 2, ty, tw, fitted[j][0], rh, pal)


def _spectrum(ax, wl: np.ndarray, X: np.ndarray, title: str, xlabel: str, marks, bands=()):
    X = X[_valid(X)]
    ax.set_title(title, fontsize=8, color=NAVY, loc="left", fontweight="bold", pad=3)
    ax.tick_params(labelsize=6, length=2, pad=1.5); ax.set_xlabel(xlabel, fontsize=6.5, labelpad=1); ax.set_ylabel("Reflectance", fontsize=6.5, labelpad=2)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for a, b, name in bands:
        ax.axvspan(a, b, color="#f2e6c9", lw=0, zorder=0)
        ax.text((a + b) / 2, 0.03, name, transform=ax.get_xaxis_transform(), fontsize=5.3, ha="center", va="bottom", color="#8a6d2b",
                rotation=90 if b - a < 0.6 else 0)
    if not len(X):
        ax.text(0.5, 0.5, "No valid spectra", transform=ax.transAxes, ha="center", va="center", fontsize=7.5, color="#666"); return
    lo, mid, hi = np.percentile(X, 10, axis=0), X.mean(axis=0), np.percentile(X, 90, axis=0)
    ax.fill_between(wl, lo, hi, color="#9db4cf", alpha=0.45, lw=0, label="10–90 %")
    ax.plot(wl, mid, color=NAVY, lw=0.9, label=f"mean of {len(X)}")
    ax.set_xlim(wl[0], wl[-1])
    for m, name in marks:
        ax.axvline(m, color="#b03a2e", lw=0.5, ls=(0, (3, 2)), zorder=1)
        if name:
            ax.text(m, 0.98, name, transform=ax.get_xaxis_transform(), fontsize=5.3, rotation=90, ha="right", va="top", color="#b03a2e")
    ax.legend(fontsize=5.8, frameon=False, loc="lower right", bbox_to_anchor=(1.0, 1.0), ncol=2, borderaxespad=0.1, handlelength=1.4)


def _colour_column(ax, groups: np.ndarray, faded: np.ndarray, pal: Palette):
    from matplotlib.colors import to_rgb
    n = len(groups)
    rgb = np.array([to_rgb(pal(g) if g else NONE_C) for g in groups]).reshape(n, 1, 3)
    if n:
        rgb[faded] = 1 - (1 - rgb[faded]) * 0.3                     # masked-off readings drawn pale
    ax.imshow(rgb, aspect="auto", interpolation="nearest", extent=(0, 1, n, 0))
    # never set_yticks here: the column shares its y axis with the line scan, whose depth ticks it would clear
    ax.set_xticks([]); ax.tick_params(axis="y", left=False, labelleft=False)
    for s in ax.spines.values():
        s.set_linewidth(0.5); s.set_color("#888")


def _strip_box(fig, x: float, y: float, h: float, D: np.ndarray, img, cols: list[tuple[str, np.ndarray, np.ndarray]], pal: Palette) -> float:
    """The left column, full height: the line scan with the colour columns right beside it, all in sample-index
    units (each reading the same height), depth ticks on the left. Returns its width."""
    n = len(D); lab, iw, cw, g = 0.38, 1.12, 0.12, 0.025
    w = 0.05 + lab + iw + len(cols) * (g + cw) + 0.06
    _box(fig, x, y, w, h)
    ix = x + 0.05 + lab; iy = y + 0.44; ih = h - 0.44 - 0.34
    ax = _axes(fig, ix, iy, iw, ih)
    if img is not None:
        ax.imshow(img, aspect="auto", extent=(0, 1, n, 0), interpolation="bilinear")
    else:
        ax.set_xlim(0, 1); ax.text(0.5, n / 2, "No line scan", ha="center", va="center", fontsize=8, color="#666", rotation=90)
    pos, labs = _ticks(D, n)
    ax.set_yticks(pos); ax.set_yticklabels(labs, fontsize=5.6); ax.set_xticks([]); ax.tick_params(axis="y", length=2.2, pad=1.2, width=0.5)
    for s in ax.spines.values():
        s.set_linewidth(0.5); s.set_color("#888")
    _text(fig, ix + iw / 2, iy + ih + 0.09, "Line scan", fontsize=6.3, color=NAVY, ha="center", va="bottom", fontweight="bold")
    _text(fig, x + 0.07, iy + ih + 0.09, "Depth\n(m)", fontsize=5.3, color="#555", ha="left", va="bottom", linespacing=1.05)
    cx = ix + iw + g
    for name, groups, faded in cols:
        _colour_column(_axes(fig, cx, iy, cw, ih, sharey=ax), groups, faded, pal)
        _text(fig, cx + cw / 2, iy + ih + 0.05, name, fontsize=5.3, color=NAVY, ha="center", va="bottom", rotation=90, fontweight="bold")
        cx += cw + g
    ax.set_ylim(n, 0)
    _text(fig, x + 0.07, y + 0.37, "One row per reading (~8 mm),\nnot to depth scale. Columns:\nheaviest group; pale = outside\nthe Final Mask.",
          fontsize=4.9, color="#666", va="top", linespacing=1.1)
    return w


def page(fig, *, label: str, hole: str, lo: float, hi: float, D: np.ndarray, img, cols, panels, specs, facts: list[str],
         results_title: str, pal: Palette, foot: str, trays: str):
    """Draw one sheet on an A4 figure."""
    W, H = A4; m = MARGIN; n = len(D)
    # header: dark band, centred title, a small line of what the interval is
    _rect(fig, m, H - m - HEAD_H, W - 2 * m, HEAD_H, facecolor=NAVY, lw=0)
    title = f"SAMPLE SHEET - {label}   ({hole})"
    _text(fig, W / 2, H - m - 0.25, title, fontsize=min(14.0, (W - 2 * m - 0.4) * 72 / (len(title) * 0.68)), fontweight="bold",
          color="white", ha="center", va="center")
    _text(fig, W / 2, H - m - 0.5, "   ·   ".join(x for x in (f"{lo:.2f}–{hi:.2f} m", f"{n} readings", trays) if x), fontsize=8,
          color="#dfe6ee", ha="center", va="center")
    _text(fig, m, 0.24, foot, fontsize=6.0, color="#555", va="center")
    if n == 0:
        _text(fig, W / 2, H * 0.55, f"No spectrum readings between {lo:.2f} and {hi:.2f} m", fontsize=12, ha="center", color="#555")
        return
    top, bottom = H - m - HEAD_H - GAP, 0.42
    sw = _strip_box(fig, m, bottom, top - bottom, D, img, cols, pal)
    rx = m + sw + GAP + 0.02; rw = W - m - rx
    # below the results, smallest first from the bottom: the facts, then the spectra
    fh = BAND_H + 0.16 + 0.135 * len(facts)
    ftop = _box(fig, rx, bottom, rw, fh, "ABOUT THIS SHEET")
    for j, line in enumerate(facts):
        _text(fig, rx + 0.12, ftop - 0.09 - 0.135 * j, _fits(line, rw - 0.2, 6.6), fontsize=6.6, color=INK, va="top")
    y = bottom + fh + GAP
    if specs:
        slot = 1.62; sh = BAND_H + slot * len(specs) + 0.04
        stop = _box(fig, rx, y, rw, sh, "MEAN SPECTRA", "masked-on readings")
        for j, s in enumerate(specs):
            sy = stop - (j + 1) * slot
            _spectrum(_axes(fig, rx + 0.55, sy + 0.36, rw - 0.72, slot - 0.66), **s)
        y += sh + GAP
    if panels:
        _results(fig, rx, y, rw, top - y, results_title, panels, pal)


def _run_title(kind: str, r: Run) -> str:
    return f"{kind} group ({r.name})" if r.name else f"{kind} group"


def render(refs: list[str], dataset: str, hole_name: str, req: dict) -> bytes:
    """The PDF for a checked request (see check()), or with format png the one interval's page as a PNG."""
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.figure import Figure

    h = Hole(refs, dataset, req); sw, tw, pal = h.sw, h.tw, h.pal
    runs = [(k, r) for k, r in (("SWIR", sw if req["swir"] else None), ("TIR", tw)) if r is not None and r.label]
    foot_run = ", ".join(f"{k} {r.label} ({r.who})" for k, r in runs) or "none"
    whos = {r.who for _, r in runs}
    results_title = {frozenset({"system"}): "SYSTEM RESULTS", frozenset({"user"}): "USER RESULTS"}.get(frozenset(whos), "RESULTS")
    mask_txt = "Final Mask" if sw.mask is not None else "none (all spectra)"
    foot = (f"Data: {dataset}   ·   Classification: {foot_run}   ·   Mask: {mask_txt}   ·   Min share {req['min_share'] * 100:g} %   ·   "
            f"CoreFlagging · coreflagging.nlp-tlp.org   ·   {time.strftime('%Y-%m-%d')}")
    buf = io.BytesIO(); png = req.get("format") == "png"
    with _lock, matplotlib.rc_context({"pdf.fonttype": 42, "font.family": "DejaVu Sans", "axes.linewidth": 0.6}):
        with (contextlib.nullcontext() if png else PdfPages(buf, metadata={"Title": f"{hole_name} sample sheets", "Creator": "CoreFlagging"})) as pdf:
            for iv in req["intervals"]:
                t = h.interval(iv["from_m"], iv["to_m"]); idx, rows = t["idx"], t["rows"]
                fig = Figure(figsize=A4)
                kw: dict = {"img": None, "cols": [], "panels": [], "specs": [], "facts": [], "trays": h.tray_text(idx)}
                if len(idx):
                    f = kw["facts"]
                    mrun, mrows, mused = (sw, rows, t["used"]) if req["swir"] or tw is None else (tw, t["trows"], t["tused"])
                    f.append(f"Readings: {len(idx)} in the interval; " + (f"{len(mrows)} inside the Final Mask, and the pies and spectra use those." if mused else
                             ("the Final Mask keeps none here, so all are used." if mrun.mask is not None else "the file has no Final Mask, so all are used.")))
                    if req["swir"]:
                        faded = ~sw.mask[idx] if sw.mask is not None else np.zeros(len(idx), bool)
                        kw["cols"].append(("SWIR", dominant(sw.G, sw.W, idx), faded))
                        kw["panels"].append({"title": _run_title("SWIR", sw), "sub": f"{sw.label} ({sw.who}) · {len(rows)} spectra" if sw.label else "no TSA run in the file",
                                             "data": shares(sw.G, sw.M, sw.W, rows, req["min_share"], NO_SWIR), "empty": "No SWIR results"})
                        kw["specs"].append({"wl": h.swl, "X": np.asarray(h.sp.spectra[rows], float), "title": "Mean SWIR reflectance", "xlabel": "Wavelength (nm)",
                                            "marks": [(w_, f"{w_}") for w_ in SWIR_MARKS if h.swl[0] <= w_ <= h.swl[-1]]})
                        f.append(f"SWIR classification: {sw.name} ({sw.who}), columns Grp1–3 / Min1–3 / Wt1–3 {sw.label}." if sw.label else "SWIR classification: the file has no TSA run.")
                    if tw is not None:
                        k = t["k"]; has = k >= 0; trows = t["trows"]
                        faded = (~tw.mask[np.where(has, k, 0)] | ~has) if tw.mask is not None else ~has
                        kw["cols"].append(("TIR", np.where(has, dominant(tw.G, tw.W, np.where(has, k, 0)), ""), faded))
                        kw["panels"].append({"title": _run_title("TIR", tw), "sub": f"{tw.label} ({tw.who}) · {len(trows)} spectra" if tw.label else "no jCLST run in the file",
                                             "data": shares(tw.G, tw.M, tw.W, trows, req["min_share"], NO_TIR), "empty": "No TIR results"})
                        if len(trows):
                            kw["specs"].append({"wl": h.twl, "X": np.asarray(h.tir.spectra[trows], float), "title": "Mean TIR reflectance", "xlabel": "Wavelength (µm)",
                                                "marks": [(8.2, "8.2"), (8.6, "8.6"), (9.2, "9.2")],
                                                "bands": [(8.0, 9.4, "quartz doublet"), (9.6, 10.0, "feldspar")]})
                        f.append(f"TIR classification: {tw.name} ({tw.who}), columns {tw.label}; {int(has.sum())} readings paired within 5 mm." if tw.label else
                                 "TIR classification: the TIR file has no jCLST or TSAT run.")
                    f.append(f"Min share: {req['min_share'] * 100:g} %. Smaller groups fold into Other, smaller minerals into \"+N more\".")
                    f.append(f"Data source: {dataset}, the HyLogger TSG package of {hole_name or dataset}.")
                    if h.cras:
                        kw["img"] = strip(h.cras, t["i0"], t["i1"], h.specny, h.cras_w)
                page(fig, label=iv["label"], hole=hole_name or dataset, lo=iv["from_m"], hi=iv["to_m"], D=h.D[t["i0"]:t["i1"]], pal=pal, foot=foot,
                     results_title=results_title, **kw)
                if png:
                    fig.savefig(buf, format="png", dpi=req.get("dpi", PNG_DPI), facecolor="white")
                else:
                    pdf.savefig(fig)
    return buf.getvalue()


# ---------------------------------------------------------------------------------------------- the data behind the sheets

def breakdown(G: np.ndarray, M: np.ndarray, W: np.ndarray, rows: np.ndarray, inactive: str) -> list[tuple[str, str, float, int]]:
    """Every group and mineral of the spectra `rows`, nothing folded: [(group, mineral or "", share, readings)].
    Shares are as in shares() (each spectrum split over its minerals by weight, over len(rows), so a panel's group
    rows sum to 1 with "Not classified" making up what the run left unread); readings is how many of `rows` have
    that group or mineral at any of the three ranks. Groups heaviest first, each followed by its minerals."""
    n = len(rows)
    if n == 0:
        return []
    acc: dict[str, dict] = {}
    for i in rows:
        seen: set = set()
        for r in range(G.shape[0]):
            g, m, w = G[r, i], M[r, i], float(W[r, i])
            if w <= 0 or not (g or m):
                continue
            if g.upper() in NOT_ACTIVE or m.upper() in NOT_ACTIVE:
                g, m = inactive, ""
            e = acc.setdefault(g or "?", {"w": 0.0, "n": 0, "min": {}})
            e["w"] += w
            if (g or "?") not in seen:
                e["n"] += 1; seen.add(g or "?")
            if m:
                mm = e["min"].setdefault(m, [0.0, 0]); mm[0] += w
                if (g, m) not in seen:
                    mm[1] += 1; seen.add((g, m))
    total = sum(e["w"] for e in acc.values())
    if n - total > 1e-6 * n:       # the readings the run left (partly) unread
        acc[NO_RESULT] = {"w": n - total, "n": int((W[:, rows].clip(0).sum(axis=0) < 1 - 1e-6).sum()), "min": {}}
    special = (inactive, NO_RESULT)
    order = sorted((g for g in acc if g not in special), key=lambda g: -acc[g]["w"]) + [g for g in special if g in acc]
    out = []
    for g in order:
        e = acc[g]; out.append((g, "", e["w"] / n, e["n"]))
        out += [(g, m, v[0] / n, v[1]) for m, v in sorted(e["min"].items(), key=lambda x: -x[1][0])]
    return out


def _num(v, nd: int = 5) -> str:
    return "" if v is None or not np.isfinite(v) else f"{v:.{nd}g}"


README = """CoreFlagging sample-sheet data
==============================

Hole: {hole}
Data source: {dataset} (HyLogger TSG package, as mirrored or uploaded)
Made: {date} by CoreFlagging (coreflagging.nlp-tlp.org)
Intervals: {n_iv}
SWIR classification: {swir}
TIR classification: {tir}
Mask: {mask}

These are the numbers behind the PDF sample sheets of the same intervals, for making your own plots (Excel,
Python, R). Every file is comma-separated UTF-8 text with a header row. An interval's readings are those whose
depth is at least from_m and less than to_m. A reading is one HyLogger spectrum, about 8 mm of core.

readings.csv
  One row per reading in each interval (a reading in two intervals is listed under each).
  label, from_m, to_m     the interval
  reading_index           the reading's position in the TSG file (0 = first)
  depth_m                 depth of the reading (m)
  tray, section, x_mm     where it lies: tray number, section (row) in the tray, mm along the section
  in_final_mask           1 if the TSG Final Mask keeps the reading, 0 if not (empty: the file has no Final Mask)
  laser_height_mm         laser profile height of the core surface (empty when the package has none)
  swir_group_1..3, swir_mineral_1..3, swir_weight_1..3
                          the SWIR TSA result: up to three minerals per reading, heaviest first, with their groups
                          and weights (the weights of a reading sum to 1 when the run read it fully)
  tir_group_1..3, tir_mineral_1..3, tir_weight_1..3
                          the same for TIR, from the TIR reading measured within 5 mm of this one (empty when none)

summary.csv
  The group and mineral shares of each interval, as in the sheet's pies and tables but with nothing folded into
  "Other" or "+N more" (the min share of the sheets is not applied here).
  label            the interval
  panel            SWIR or TIR
  group, mineral   a group's own row has mineral empty; its minerals follow it
  share            0-1: the TSA weight of that group or mineral summed over the readings used, over their number.
                   A panel's group rows sum to 1. "{no_swir}" / "{no_tir}" are Aspectral or
                   INVALID readings; "{no_result}" is weight the run left unassigned.
  n_readings       how many of the readings used have that group or mineral at any of the three ranks
  of_readings      the readings used: those inside the Final Mask (all of the interval's when the mask keeps none
                   there, or the file has none); for TIR, the TIR readings paired with the interval's readings

spectra_swir_mean.csv, spectra_tir_mean.csv
  wavelength       nm (SWIR file, 380-2500 nm) or micrometres (TIR file)
  "<label> mean", "<label> p10", "<label> p90"
                   per interval: the mean reflectance of the readings used, and the 10th and 90th percentiles
                   (the envelope drawn on the sheet). Empty for an interval with no valid readings.
{all_spectra}"""

ALL_SPECTRA = """
spectra_swir_readings.csv, spectra_tir_readings.csv
  Every reading's spectrum, one row per reading (all readings, inside the mask or not).
  label, depth_m, then one column per wavelength (the column names are the wavelengths, nm or micrometres).
  The TIR file lists the TIR readings paired with each interval's readings, at their own depth.
"""


def export(refs: list[str], dataset: str, hole_name: str, req: dict) -> bytes:
    """The zip of CSV files for a checked request (format zip): readings, summary, mean spectra, and with
    all_spectra every reading's spectrum. BadRequest when all_spectra would be over MAX_SPECTRA readings."""
    import csv, zipfile
    h = Hole(refs, dataset, req); sw, tw = h.sw, h.tw
    ivs = [(iv, h.interval(iv["from_m"], iv["to_m"])) for iv in req["intervals"]]
    total = sum(len(t["idx"]) for _, t in ivs)
    if req.get("all_spectra") and total > MAX_SPECTRA:
        raise BadRequest(f"every reading's spectrum is for up to {MAX_SPECTRA:,} readings; these intervals have {total:,}")
    sh = h.sp.sampleheaders
    T, L, X = (sh[c].to_numpy() if c in sh.columns else None for c in ("T", "L", "X"))
    height = None
    if "hires" in h.files:
        from pytsg import parse_tsg as p
        try:
            height = np.asarray(p.read_hires_dat(str(h.files["hires"]), per_spectra=True), float)
        except Exception:        # noqa: BLE001 - a damaged profile loses the height column, not the export
            height = None
    swir_on, tir_on = req["swir"], tw is not None
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        def table(name: str):
            info = zipfile.ZipInfo(name, date_time=time.localtime()[:6]); info.compress_type = zipfile.ZIP_DEFLATED
            return io.TextIOWrapper(z.open(info, "w", force_zip64=True), encoding="utf-8", newline="")

        def ranks(run: Run | None, i: int | None) -> list:
            if run is None or i is None or i < 0:
                return [""] * 9
            out = []
            for r in range(3):
                g, m, w = run.G[r, i], run.M[r, i], run.W[r, i]
                out += [g, m, _num(w, 4) if (w > 0 or g or m) else ""]
            return out

        with table("readings.csv") as fh:
            wr = csv.writer(fh)
            wr.writerow(["label", "from_m", "to_m", "reading_index", "depth_m", "tray", "section", "x_mm", "in_final_mask", "laser_height_mm"]
                        + [f"swir_{k}_{r}" for r in (1, 2, 3) for k in ("group", "mineral", "weight")]
                        + [f"tir_{k}_{r}" for r in (1, 2, 3) for k in ("group", "mineral", "weight")])
            for iv, t in ivs:
                for j, i in enumerate(t["idx"]):
                    k = int(t["k"][j]) if t["k"] is not None else None
                    wr.writerow([iv["label"], f"{iv['from_m']:g}", f"{iv['to_m']:g}", int(i), f"{h.D[i]:.4f}",
                                 "" if T is None else str(T[i]).strip(), "" if L is None else str(L[i]).strip(), "" if X is None else _num(float(X[i]), 6),
                                 "" if sw.mask is None else int(sw.mask[i]),
                                 "" if height is None or i >= len(height) else _num(float(height[i]), 4)]
                                + (ranks(sw, int(i)) if swir_on else [""] * 9) + (ranks(tw, k) if tir_on else [""] * 9))
        with table("summary.csv") as fh:
            wr = csv.writer(fh)
            wr.writerow(["label", "panel", "group", "mineral", "share", "n_readings", "of_readings"])
            for iv, t in ivs:
                for panel, run, rows, inactive, on in (("SWIR", sw, t["rows"], NO_SWIR, swir_on), ("TIR", tw, t["trows"], NO_TIR, tir_on)):
                    if on:
                        for g, m, s, n in breakdown(run.G, run.M, run.W, rows, inactive):
                            wr.writerow([iv["label"], panel, g, m, f"{s:.6f}", n, len(rows)])
        for panel, on, wl, spectra, key in (("swir", swir_on, h.swl, h.sp.spectra if swir_on else None, "rows"),
                                            ("tir", tir_on, h.twl, h.tir.spectra if tir_on else None, "trows")):
            if not on:
                continue
            cols, head = [wl], ["wavelength"]
            for iv, t in ivs:
                X_ = np.asarray(spectra[t[key]], float) if len(t[key]) else np.zeros((0, len(wl)))
                X_ = X_[_valid(X_)]
                if len(X_):
                    cols += [X_.mean(axis=0), np.percentile(X_, 10, axis=0), np.percentile(X_, 90, axis=0)]
                else:
                    cols += [np.full(len(wl), np.nan)] * 3
                head += [f"{iv['label']} mean", f"{iv['label']} p10", f"{iv['label']} p90"]
            with table(f"spectra_{panel}_mean.csv") as fh:
                wr = csv.writer(fh); wr.writerow(head)
                for row in np.column_stack(cols):
                    wr.writerow([_num(row[0], 6)] + [_num(v) for v in row[1:]])
            if req.get("all_spectra"):
                with table(f"spectra_{panel}_readings.csv") as fh:
                    wr = csv.writer(fh); wr.writerow(["label", "depth_m"] + [_num(w, 6) for w in wl])
                    Dk = h.D if panel == "swir" else tw.D
                    for iv, t in ivs:
                        for i in (t["idx"] if panel == "swir" else t["tk"]):
                            v = np.asarray(spectra[i], float)
                            wr.writerow([iv["label"], f"{Dk[i]:.4f}"] + ["" if not np.isfinite(x) or abs(x) >= 1e3 else f"{x:.5g}" for x in v])
        def who(r: Run | None) -> str:
            return f"{r.name} ({r.who}), columns Grp/Min/Wt 1-3 {r.label}" if r is not None and r.label else "none"
        z.writestr("README.txt", README.format(
            hole=hole_name or dataset, dataset=dataset, date=time.strftime("%Y-%m-%d"), n_iv=len(ivs),
            swir=who(sw) if swir_on else "not asked for", tir=who(tw) if tir_on else ("not asked for" if not req["tir"] else "the package has no TIR file"),
            mask=("Final Mask (readings it keeps; all readings of an interval where it keeps none)" if sw.mask is not None else "none: the file has no Final Mask, all readings used"),
            no_swir=NO_SWIR, no_tir=NO_TIR, no_result=NO_RESULT, all_spectra=ALL_SPECTRA if req.get("all_spectra") else ""))
    return buf.getvalue()
