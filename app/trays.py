"""Core-tray photographs.

A TSG package carries one photograph per tray (<name>_NNNN.jpg, about 11,000 x 4,000 px). Each sample of the scan
records which tray and which row of core it came from, so the depth range of every row is known exactly. The
photograph records where its rows are (pixel extents, in the JPEG comment written by the HyLogger software).
Together these place any depth on the photograph.

  index(spectra)                  trays of a dataset: number, depth range, depth range of each row
  extract(zip, index, out_dir)    a browser-sized copy of each photograph + where its rows are in it
"""
from __future__ import annotations

import io, re, zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

Image.MAX_IMAGE_PIXELS = 300_000_000
WIDTH = 1800
PHOTO = re.compile(r"_(\d{1,5})\.jpe?g$", re.I)
_norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())   # noqa: E731 - photographs are sometimes named without the spaces of the dataset name


def index(sp, depth: np.ndarray) -> list[dict]:
    """Trays of a scan from its sample headers (T = tray, L = row of core in the tray, X = position along the row in
    mm). Each row keeps its depth range and `xmm`, where its first and last samples lie along the scan: within a row
    depth is linear in X, and the photograph runs at a fixed scale in X, so this places any depth on the photograph."""
    h = sp.sampleheaders
    if "T" not in h or "L" not in h:
        return []
    x = pd.to_numeric(h["X"], errors="coerce") if "X" in h else np.nan
    d = pd.DataFrame({"t": pd.to_numeric(h["T"], errors="coerce"), "l": pd.to_numeric(h["L"], errors="coerce"), "d": depth, "x": x}).dropna(subset=["t", "l", "d"])
    out = []
    for t, g in d.groupby("t"):
        rows = []
        for _, r in g.groupby("l"):
            row = {"from_m": round(float(r.d.min()), 3), "to_m": round(float(r.d.max()), 3)}
            if r.x.notna().any():
                row["xmm"] = [round(float(r.x.min()), 2), round(float(r.x.max()), 2)]
            rows.append(row)
        out.append({"n": int(t), "from_m": round(float(g.d.min()), 3), "to_m": round(float(g.d.max()), 3), "rows": rows})
    return out


def row_mm(tsg: Path) -> dict[int, list[list[float]]]:
    """{tray: [[first, last] mm per row, top to bottom]} from the sample headers of a .tsg file alone (no spectra)."""
    from pytsg import parse_tsg
    lines = parse_tsg._read_tsg_file(tsg)
    info = parse_tsg._parse_tsg(lines, parse_tsg._find_header_sections(lines))
    h = info.get("sample headers")
    if h is None or not {"T", "L", "X"} <= set(h.columns):
        return {}
    d = pd.DataFrame({"t": pd.to_numeric(h["T"], errors="coerce"), "l": pd.to_numeric(h["L"], errors="coerce"), "x": pd.to_numeric(h["X"], errors="coerce")}).dropna()
    return {int(t): [[round(float(r.x.min()), 2), round(float(r.x.max()), 2)] for _, r in g.groupby("l")] for t, g in d.groupby("t")}


def layout(comment: str) -> list[list[int]] | None:
    """Rows of core in the photograph as [y0, y1, x0, x1] pixels, from the 'IOL..' JPEG comment; None if absent."""
    v = comment.strip("\x00 ").split(",")
    if len(v) < 10 or not v[0].startswith("IOL"):
        return None
    try:
        n, y = int(v[2]), int(v[7]); rows = []
        for k in range(n):
            rh, x0, x1 = int(v[9 + 3 * k]), int(v[10 + 3 * k]), int(v[11 + 3 * k]); rows.append([y, y + rh, x0, x1]); y += rh
        return rows
    except (ValueError, IndexError):
        return None


def extract(zip_path: Path, name: str, trays: list[dict], out_dir: Path, width: int = WIDTH):
    """Yield (tray, jpeg path) for every tray of dataset `name` that has a photograph (<name>_NNNN.jpg) in the zip. `tray` gains the size of
    the copy and, per row, `box` = [x0, y0, x1, y1] as fractions of the photograph."""
    out_dir.mkdir(parents=True, exist_ok=True); by = {t["n"]: t for t in trays}
    with zipfile.ZipFile(zip_path) as z:
        base = lambda i: i.filename.replace("\\", "/").split("/")[-1]   # noqa: E731
        alone = sum(base(i).lower().endswith("_tsg.tsg") for i in z.infolist()) <= 1     # one dataset in the zip: every photograph is its own
        for i in z.infolist():
            fn = base(i); m = PHOTO.search(fn)
            if not m or int(m.group(1)) not in by or not (alone or _norm(fn[:m.start()]) == _norm(name)):
                continue
            t = dict(by[int(m.group(1))])
            try:
                with Image.open(io.BytesIO(z.read(i))) as im:
                    c = im.info.get("comment", b""); rows = layout(c.decode(errors="ignore") if isinstance(c, bytes) else str(c)); W, H = im.size
                    im.draft("RGB", (width, width))                          # decode at reduced size: several times faster
                    im = im.convert("RGB"); im.thumbnail((width, width))
                    f = out_dir / f"{t['n']:05d}.jpg"; im.save(f, quality=82, optimize=True); t["width"], t["height"] = im.size
            except Exception:                                                # noqa: BLE001 - one damaged photograph should not stop the rest
                continue
            if rows and len(rows) == len(t["rows"]):
                t["rows"] = [{**r, "box": [round(x0 / W, 4), round(y0 / H, 4), round(x1 / W, 4), round(y1 / H, 4)]} for r, (y0, y1, x0, x1) in zip(t["rows"], rows)]
            yield t, f
