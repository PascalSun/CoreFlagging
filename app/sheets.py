"""Sample sheets: one A4 page per depth interval of a hole, as a PDF.

A page shows the interval's line-scan photograph with a SWIR-group and a TIR-group column beside it, one reading
(about 8 mm) per row; SWIR and TIR group pies with their minerals; and the interval's mean SWIR and TIR spectra.

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

import io, re, threading, time
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import samples as smp

MAX_INTERVALS, MAX_SPAN_M = 300, 20.0
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
    return {"intervals": out, "results": results, "min_share": ms, "swir": swir, "tir": tir}


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

STRIP_W, STRIP_MAX_H = 260, 1600


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


# ---------------------------------------------------------------------------------------------- rendering

A4 = (8.27, 11.69)
INK, NAVY, BAND, RULE = "#1d1d1f", "#1f3a5f", "#e8edf3", "#c8d0da"


def _ticks(D: np.ndarray, n: int, want: int = 11) -> tuple[list[float], list[str]]:
    """Depth labels at sample positions (index units), about `want` of them, at round depths where possible."""
    if n == 0:
        return [], []
    span = D[-1] - D[0] if n > 1 else 0.0
    step = next((s for s in (0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5) if span / s <= want), 5)
    pos, lab = [], []
    for t in np.arange(np.ceil(D[0] / step - 1e-6) * step, D[-1] + 1e-9, step):
        k = int(np.argmin(np.abs(D - t)))
        if pos and k - pos[-1] < n * 0.05:
            continue
        pos.append(k + 0.5); lab.append(f"{D[k]:.2f}")
    return pos, lab


def _pie(fig, rect, data: list[dict], pal: Palette, empty: str):
    ax = fig.add_axes(rect); ax.set_aspect("equal")
    if not data:
        ax.text(0.5, 0.5, empty, ha="center", va="center", fontsize=7.5, color="#666", wrap=True); ax.axis("off"); return
    ax.pie([d["share"] for d in data], colors=[pal(d["group"]) for d in data], startangle=90, counterclock=False,
           wedgeprops={"linewidth": 0.6, "edgecolor": "white"}, normalize=True)


def _pct(s: float) -> str:
    return "<1%" if s < 0.005 else f"{s * 100:.0f}%"


def _table(fig, x: float, y_top: float, w: float, h: float, data: list[dict], pal: Palette):
    """Group rows (swatch, name, share) with their minerals beneath, fitted into h inches."""
    from matplotlib.patches import Rectangle
    W, H = A4
    mins = MAX_MINERALS
    while True:
        rows = sum(1 + min(len(d["minerals"]), mins) for d in data)
        rh = min(0.17, h / max(rows, 1))
        if rh >= 0.115 or mins == 0:
            break
        mins -= 1
    fs = max(5.5, min(7.5, rh * 50))
    y = y_top
    for d in data:
        y -= rh
        fig.patches.append(Rectangle(((x) / W, (y + rh * 0.2) / H), 0.13 / W, rh * 0.6 / H, transform=fig.transFigure,
                                     facecolor=pal(d["group"]), edgecolor="#777", lw=0.4))
        fig.text((x + 0.2) / W, (y + rh / 2) / H, d["group"], fontsize=fs, fontweight="bold", va="center", color=INK)
        fig.text((x + w) / W, (y + rh / 2) / H, _pct(d['share']), fontsize=fs, fontweight="bold", va="center", ha="right", color=INK)
        for name, s in d["minerals"][:mins]:
            y -= rh
            fig.text((x + 0.32) / W, (y + rh / 2) / H, name, fontsize=fs - 0.6, va="center", color="#444")
            fig.text((x + w) / W, (y + rh / 2) / H, _pct(s), fontsize=fs - 0.6, va="center", ha="right", color="#666")


def _section(fig, x: float, y: float, w: float, h: float, title: str, sub: str, data: list[dict], pal: Palette, empty: str):
    from matplotlib.patches import Rectangle
    W, H = A4
    fig.patches.append(Rectangle((x / W, y / H), w / W, h / H, transform=fig.transFigure, facecolor="white", edgecolor=RULE, lw=0.8, zorder=-2))
    fig.patches.append(Rectangle((x / W, (y + h - 0.28) / H), w / W, 0.28 / H, transform=fig.transFigure, facecolor=BAND, edgecolor=RULE, lw=0.8, zorder=-1))
    fig.text((x + 0.1) / W, (y + h - 0.14) / H, title, fontsize=9, fontweight="bold", color=NAVY, va="center")
    fig.text((x + w - 0.1) / W, (y + h - 0.14) / H, sub, fontsize=7, color="#555", va="center", ha="right")
    d = min(1.75, h - 0.5, w * 0.38)
    _pie(fig, [(x + 0.12) / W, (y + h - 0.4 - d) / H, d / W, d / H], data, pal, empty)
    tx = x + 0.12 + d + 0.22
    _table(fig, tx, y + h - 0.4, x + w - 0.12 - tx, h - 0.52, data, pal)


def _spectrum(fig, rect, wl: np.ndarray, X: np.ndarray, title: str, xlabel: str, marks, bands=()):
    ax = fig.add_axes(rect)
    ok = np.isfinite(X).all(axis=1) & (np.abs(X) < 1e3).all(axis=1) if len(X) else np.array([], bool)
    X = X[ok]
    ax.set_title(title, fontsize=8.5, color=NAVY, loc="left", fontweight="bold")
    ax.tick_params(labelsize=6.5, length=2); ax.set_xlabel(xlabel, fontsize=7); ax.set_ylabel("Reflectance", fontsize=7)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for a, b, name in bands:
        ax.axvspan(a, b, color="#f2e6c9", lw=0, zorder=0)
        ax.text((a + b) / 2, 0.03, name, transform=ax.get_xaxis_transform(), fontsize=5.5, ha="center", va="bottom", color="#8a6d2b",
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
            ax.text(m, 0.98, name, transform=ax.get_xaxis_transform(), fontsize=5.5, rotation=90, ha="right", va="top", color="#b03a2e")
    ax.legend(fontsize=6, frameon=False, loc="lower right", bbox_to_anchor=(1.0, 1.0), ncol=2, borderaxespad=0.1, handlelength=1.4)


def _colour_column(ax, groups: np.ndarray, faded: np.ndarray, pal: Palette, title: str):
    from matplotlib.colors import to_rgb
    n = len(groups)
    rgb = np.array([to_rgb(pal(g) if g else NONE_C) for g in groups]).reshape(n, 1, 3)
    if n:
        rgb[faded] = 1 - (1 - rgb[faded]) * 0.3                     # masked-off readings drawn pale
    ax.imshow(rgb, aspect="auto", interpolation="nearest", extent=(0, 1, n, 0))
    # never set_yticks here: the column shares its y axis with the line scan, whose depth ticks it would clear
    ax.set_xticks([]); ax.tick_params(axis="y", left=False, labelleft=False); ax.set_title(title, fontsize=6.5, color=NAVY, pad=3)
    for s in ax.spines.values():
        s.set_linewidth(0.5); s.set_color("#888")


def page(fig, *, label: str, hole: str, lo: float, hi: float, D: np.ndarray, img, swir_col, tir_col, swir_faded, tir_faded,
         swir_data, tir_data, swir_spec, tir_spec, pal: Palette, notes: dict, foot: str, trays: str):
    """Draw one sheet on an A4 figure."""
    from matplotlib.patches import Rectangle
    W, H = A4; m = 0.35; n = len(D)
    # header
    fig.patches.append(Rectangle((m / W, (H - m - 0.62) / H), (W - 2 * m) / W, 0.62 / H, transform=fig.transFigure, facecolor=NAVY, lw=0))
    fig.text((m + 0.15) / W, (H - m - 0.24) / H, label, fontsize=15, fontweight="bold", color="white", va="center")
    fig.text((m + 0.15) / W, (H - m - 0.48) / H, f"{hole}   ·   {lo:.2f}–{hi:.2f} m" + (f"   ·   {trays}" if trays else ""), fontsize=8.5, color="#dfe6ee", va="center")
    fig.text((W - m - 0.15) / W, (H - m - 0.24) / H, f"{n} samples", fontsize=10, color="white", va="center", ha="right", fontweight="bold")
    fig.text((W - m - 0.15) / W, (H - m - 0.48) / H, notes.get("mask_line", ""), fontsize=7.5, color="#dfe6ee", va="center", ha="right")
    top = H - m - 0.62 - 0.2
    # footer
    fig.text(m / W, 0.3 / H, foot, fontsize=6.3, color="#555", va="center")
    if n == 0:
        fig.text(0.5, 0.55, f"No spectrum samples between {lo:.2f} and {hi:.2f} m", fontsize=12, ha="center", color="#555")
        return
    spec_h = 2.35 if (swir_spec or tir_spec) else 0.0
    body_lo = 0.45 + (spec_h + 0.45 if spec_h else 0.1)
    # left: line scan + columns, all in sample-index units
    ys, yh = body_lo, top - body_lo - 0.18
    x = m + 0.55; iw = 1.35; cw = 0.26
    ax = fig.add_axes([x / W, ys / H, iw / W, yh / H])
    if img is not None:
        ax.imshow(img, aspect="auto", extent=(0, 1, n, 0), interpolation="bilinear")
    else:
        ax.set_xlim(0, 1); ax.set_ylim(n, 0); ax.text(0.5, n / 2, "No line scan", ha="center", va="center", fontsize=8, color="#666", rotation=90)
    pos, lab = _ticks(D, n)
    ax.set_yticks(pos); ax.set_yticklabels(lab, fontsize=6.5); ax.set_xticks([]); ax.tick_params(axis="y", length=2.5, pad=1.5)
    ax.set_title("Line scan", fontsize=6.5, color=NAVY, pad=3); ax.set_ylabel("Depth (m)", fontsize=7, labelpad=2)
    for s in ax.spines.values():
        s.set_linewidth(0.5); s.set_color("#888")
    cx = x + iw + 0.06
    if swir_col is not None:
        _colour_column(fig.add_axes([cx / W, ys / H, cw / W, yh / H], sharey=ax), swir_col, swir_faded, pal, "SWIR"); cx += cw + 0.05
    if tir_col is not None:
        _colour_column(fig.add_axes([cx / W, ys / H, cw / W, yh / H], sharey=ax), tir_col, tir_faded, pal, "TIR"); cx += cw + 0.05
    ax.set_ylim(n, 0)
    fig.text((x - 0.0) / W, (ys - 0.13) / H, "One row per reading (~8 mm), not to depth scale.\nPale: outside the Final Mask.",
             fontsize=5.6, color="#666", va="top")
    # right: pies
    rx = cx + 0.15; rw = W - m - rx
    secs = [s for s in (("SWIR groups", notes.get("swir_run", ""), swir_data, "No SWIR results") if swir_col is not None else None,
                        ("TIR groups", notes.get("tir_run", ""), tir_data, "No TIR results") if tir_col is not None else None) if s]
    if secs:
        gap = 0.15; sh = (top - body_lo - gap * (len(secs) - 1)) / len(secs); y = top
        for title, sub, data, empty in secs:
            y -= sh; _section(fig, rx, y, rw, sh, title, sub, data, pal, empty); y -= gap
    # bottom: spectra
    specs = [s for s in (swir_spec, tir_spec) if s]
    if specs:
        sw = (W - 2 * m - 0.6 * (len(specs) - 1) - 0.5) / len(specs); sx = m + 0.45
        for s in specs:
            _spectrum(fig, [sx / W, 0.8 / H, sw / W, (spec_h - 0.55) / H], **s); sx += sw + 0.6


def render(refs: list[str], dataset: str, hole_name: str, req: dict) -> bytes:
    """The PDF for a checked request (see check())."""
    import matplotlib
    matplotlib.use("Agg")
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.figure import Figure

    d = smp.package(refs, dataset); f = smp._files(d)
    sp = smp._spectra_of(d, dataset)
    tir = smp._tir_of(d, dataset) if req["tir"] else None
    sw = Run(sp, f.get("tsg"), ("TSAS",), req["results"])
    tw = Run(tir, f.get("tir_tsg"), ("jCLST", "TSAT"), req["results"]) if tir is not None else None
    pal = Palette(sw.colours, tw.colours if tw else {})
    cras = f.get("cras"); specny = smp.specny_of(cras) if cras else 0
    cras_w = None
    if cras:
        import struct
        with open(cras, "rb") as fh:
            cras_w = struct.unpack(smp._CRAS_HEAD, fh.read(64))[1]
    D = sw.D
    tmap = nearest(D, tw.D) if tw is not None else None
    trays = sp.sampleheaders["T"].astype(str).to_numpy() if "T" in sp.sampleheaders.columns else None
    swl = np.asarray(sp.wavelength, float); twl = np.asarray(tir.wavelength, float) / 1000.0 if tir is not None else None
    who = lambda r: {"s": "system", "u": "user"}.get(r.label[:1], "") if r and r.label else ""   # noqa: E731
    foot_run = ", ".join(x for x in (f"SWIR {sw.label} ({who(sw)})" if req["swir"] and sw.label else "",
                                     f"TIR {tw.label} ({who(tw)})" if tw is not None and tw.label else "") if x) or "none"
    mask_txt = "Final Mask" if sw.mask is not None else "none (all spectra)"
    foot = (f"Data: {dataset}   ·   Classification: {foot_run}   ·   Mask: {mask_txt}   ·   Min share {req['min_share'] * 100:g} %   ·   "
            f"CoreFlagging · coreflagging.nlp-tlp.org   ·   {time.strftime('%Y-%m-%d')}")
    buf = io.BytesIO()
    with _lock, matplotlib.rc_context({"pdf.fonttype": 42, "font.family": "DejaVu Sans", "axes.linewidth": 0.6}):
        with PdfPages(buf, metadata={"Title": f"{hole_name} sample sheets", "Creator": "CoreFlagging"}) as pdf:
            for iv in req["intervals"]:
                i0, i1 = window(D, iv["from_m"], iv["to_m"]); idx = np.arange(i0, i1)
                fig = Figure(figsize=A4)
                kw: dict = {"swir_col": None, "tir_col": None, "swir_faded": None, "tir_faded": None, "swir_data": [], "tir_data": [],
                            "swir_spec": None, "tir_spec": None, "img": None, "trays": "", "notes": {}}
                if len(idx):
                    rows, used = sw.rows(idx)
                    kw["notes"]["mask_line"] = (f"{len(rows)} inside the Final Mask" if used else
                                                ("Final Mask keeps none here: all spectra used" if sw.mask is not None else "no Final Mask: all spectra used"))
                    if trays is not None:
                        t = sorted({x for x in trays[idx] if x.strip()})
                        kw["trays"] = (f"tray {t[0]}" if len(t) == 1 else f"trays {t[0]}–{t[-1]}") if t else ""
                    if req["swir"]:
                        kw["swir_col"] = dominant(sw.G, sw.W, idx)
                        kw["swir_faded"] = ~sw.mask[idx] if sw.mask is not None else np.zeros(len(idx), bool)
                        kw["swir_data"] = shares(sw.G, sw.M, sw.W, rows, req["min_share"], NO_SWIR)
                        kw["notes"]["swir_run"] = f"{sw.label} ({who(sw)}), {len(rows)} spectra" if sw.label else "no TSA run"
                        kw["swir_spec"] = {"wl": swl, "X": np.asarray(sp.spectra[rows], float), "title": "Mean SWIR reflectance", "xlabel": "Wavelength (nm)",
                                           "marks": [(w_, f"{w_}") for w_ in SWIR_MARKS if swl[0] <= w_ <= swl[-1]]}
                    if tw is not None:
                        k = tmap[idx]; has = k >= 0
                        kw["tir_col"] = np.where(has, dominant(tw.G, tw.W, np.where(has, k, 0)), "")
                        kw["tir_faded"] = (~tw.mask[np.where(has, k, 0)] | ~has) if tw.mask is not None else ~has
                        tk = np.unique(k[has])
                        trows, tused = tw.rows(tk)
                        kw["tir_data"] = shares(tw.G, tw.M, tw.W, trows, req["min_share"], NO_TIR)
                        kw["notes"]["tir_run"] = f"{tw.label} ({who(tw)}), {len(trows)} spectra" if tw.label else "no jCLST run"
                        if len(trows):
                            kw["tir_spec"] = {"wl": twl, "X": np.asarray(tir.spectra[trows], float), "title": "Mean TIR reflectance", "xlabel": "Wavelength (µm)",
                                              "marks": [(8.2, "8.2"), (8.6, "8.6"), (9.2, "9.2")],
                                              "bands": [(8.0, 9.4, "quartz doublet"), (9.6, 10.0, "feldspar")]}
                    if cras:
                        kw["img"] = strip(cras, i0, i1, specny, cras_w)
                page(fig, label=iv["label"], hole=hole_name or dataset, lo=iv["from_m"], hi=iv["to_m"], D=D[i0:i1], pal=pal, foot=foot, **kw)
                pdf.savefig(fig)
    return buf.getvalue()
