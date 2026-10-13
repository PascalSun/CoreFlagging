"""The finest level of a hole: every spectrum sample (about 8 mm) and the line-scan photograph at full resolution.

Both come straight from the TSG package in the mirror, unpacked once per dataset into a cache under
CORETRACE_WORK/pkg (the spectral files, the laser profile and the line scan; trimmed least-recently-used):

    samples(refs, dataset, lo, hi)   one row per sample in the depth window: depth, tray, section, position
                                     along the section, the TSG mineral read there, the laser height; the
                                     SWIR spectrum too when asked
    linescan(refs, dataset, lo, hi)  the line-scan image rows for the window as one JPEG strip, read by
                                     decoding only the chunks that cover those rows (the cras file is a
                                     stack of JPEG chunks of a fixed number of lines each)
"""
from __future__ import annotations

import io
import re
import shutil
import struct
import threading
import zipfile
from collections import OrderedDict
from pathlib import Path

import numpy as np
from PIL import Image

from .pipeline import config as C
from . import sources

ROOT = C.DATA / "pkg"
MAX_BYTES = 40 * 1024**3                       # packages kept, least recently used first
WANTED = re.compile(r"_tsg(_tir)?\.(tsg|bip)$|_tsg_hires\.dat$|_tsg_cras\.bip$", re.I)
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
_spectra: OrderedDict[str, object] = OrderedDict()    # dataset -> pytsg Spectra, a few at a time


class NoPackage(LookupError):
    pass


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s)


def _unpack(zip_path: Path, dest: Path, dataset: str) -> int:
    """The package's spectral, profile and line-scan members for one dataset, flat in `dest`."""
    dest.mkdir(parents=True, exist_ok=True); n = 0
    with zipfile.ZipFile(zip_path) as z:
        for i in z.infolist():
            name = i.filename.replace("\\", "/").split("/")[-1]
            if i.is_dir() or not WANTED.search(name):
                continue
            # a zip holding several datasets: keep the members of this one (named after it)
            if dataset and not name.lower().startswith(dataset.lower()):
                continue
            with z.open(i) as src, open(dest / name, "wb") as f:
                shutil.copyfileobj(src, f, 1 << 22)
            n += 1
    return n


def package(refs: list[str], dataset: str) -> Path:
    """Where the dataset's files are, unpacking them from the first mirrored zip that holds them on first use."""
    d = ROOT / _safe(dataset)
    done = d / ".ready"
    if done.exists():
        done.touch(); return d
    with _guard:
        lock = _locks.setdefault(dataset, threading.Lock())
    with lock:
        if done.exists():
            return d
        for ref in refs:
            zp = sources.zip_path(ref)
            if zp and zp.exists():
                tmp = d.with_suffix(".tmp"); shutil.rmtree(tmp, ignore_errors=True)
                try:
                    n = _unpack(zp, tmp, dataset)
                except zipfile.BadZipFile:
                    continue
                if n:
                    shutil.rmtree(d, ignore_errors=True); tmp.rename(d); done.touch(); _trim(); return d
                shutil.rmtree(tmp, ignore_errors=True)
        raise NoPackage(f"no package for {dataset} in the mirror")


def _trim() -> None:
    dirs = sorted(((p.parent, p.stat().st_mtime) for p in ROOT.glob("*/.ready")), key=lambda x: x[1])
    size = lambda d: sum(f.stat().st_size for f in d.iterdir() if f.is_file())   # noqa: E731
    total = sum(size(d) for d, _ in dirs)
    for d, _ in dirs[:-1]:
        if total <= MAX_BYTES:
            break
        total -= size(d); shutil.rmtree(d, ignore_errors=True)


def _files(d: Path) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for f in d.iterdir():
        n = f.name.lower()
        if n.endswith("_tsg.tsg"): out["tsg"] = f
        elif n.endswith("_tsg.bip"): out["bip"] = f
        elif n.endswith("_tsg_tir.tsg"): out["tir_tsg"] = f
        elif n.endswith("_tsg_tir.bip"): out["tir_bip"] = f
        elif n.endswith("_hires.dat"): out["hires"] = f
        elif n.endswith("_cras.bip"): out["cras"] = f
    return out


def _spectra_of(d: Path, dataset: str):
    with _guard:
        if dataset in _spectra:
            _spectra.move_to_end(dataset); return _spectra[dataset]
    from pytsg import parse_tsg as p
    f = _files(d)
    if "tsg" not in f or "bip" not in f:
        raise NoPackage("the package has no SWIR spectra")
    sp = p.read_tsg_bip_pair(str(f["tsg"]), str(f["bip"]), "nir")
    with _guard:
        _spectra[dataset] = sp; _spectra.move_to_end(dataset)
        while len(_spectra) > 4:
            _spectra.popitem(last=False)
    return sp


def _window(sp, lo: float, hi: float) -> tuple[int, int, np.ndarray]:
    D = sp.sampleheaders["D"].astype(float).to_numpy()
    i0, i1 = int(np.searchsorted(D, lo)), int(np.searchsorted(D, hi))
    return i0, i1, D


def _col(sp, *names: str):
    for n in names:
        if n in sp.scalars.columns:
            return sp.scalars[n]
    return None


def samples(refs: list[str], dataset: str, lo: float, hi: float, spectra: bool = False) -> dict:
    """One row per spectrum sample in [lo, hi): depth, tray, section, mm along the section, the TSG mineral and
    group read there (SWIR), the laser height (mm), and the SWIR spectrum when asked. At most 2,000 samples."""
    d = package(refs, dataset); sp = _spectra_of(d, dataset)
    i0, i1, D = _window(sp, lo, hi)
    i1 = min(i1, i0 + 2000)
    sh = sp.sampleheaders.iloc[i0:i1]
    min1 = _col(sp, "Min1 sTSAS", "Min1 uTSAS"); grp1 = _col(sp, "Grp1 sTSAS", "Grp1 uTSAS"); wt1 = _col(sp, "Wt1 sTSAS", "Wt1 uTSAS")
    height = None
    f = _files(d)
    if "hires" in f:
        from pytsg import parse_tsg as p
        try:
            h = p.read_hires_dat(str(f["hires"]), per_spectra=True); height = h[i0:i1]
        except Exception:        # noqa: BLE001 - a damaged profile is not worth failing the samples for
            height = None
    def cls(col, i):
        if col is None: return ""
        v = col.iloc[i]
        return "" if v is None or (isinstance(v, float) and np.isnan(v)) else str(v)
    rows = []
    for j, i in enumerate(range(i0, i1)):
        r = {"i": int(i), "depth": round(float(D[i]), 4), "tray": str(sh["T"].iloc[j]), "section": int(float(sh["L"].iloc[j])) if str(sh["L"].iloc[j]).strip() else None,
             "x_mm": round(float(sh["X"].iloc[j]), 1), "mineral": cls(min1, i), "group": cls(grp1, i),
             "weight": None if wt1 is None or np.isnan(float(wt1.iloc[i])) else round(float(wt1.iloc[i]), 3),
             "height_mm": None if height is None or np.isnan(height[j]) else round(float(height[j]), 2)}
        if spectra:
            r["swir"] = [round(float(x), 4) for x in sp.spectra[i]]
        rows.append(r)
    out = {"dataset": dataset, "from_m": lo, "to_m": hi, "n": len(rows), "step_mm": round(float(np.median(np.diff(D[i0:i1])) * 1000), 2) if i1 - i0 > 2 else None, "samples": rows}
    if spectra:
        out["swir_wl"] = [round(float(x), 1) for x in sp.wavelength]
    return out


_CRAS_HEAD = "20s2I8h4I2h"


def linescan(refs: list[str], dataset: str, lo: float, hi: float, width: int = 600) -> bytes:
    """The line-scan rows of [lo, hi) as one JPEG strip `width` pixels across (the core runs top to bottom,
    shallow at the top). Only the JPEG chunks covering those rows are decoded."""
    from simplejpeg import decode_jpeg
    d = package(refs, dataset); f = _files(d)
    if "cras" not in f:
        raise NoPackage("the package has no line-scan image")
    sp = _spectra_of(d, dataset)
    i0, i1, _ = _window(sp, lo, hi)
    if i1 <= i0:
        raise NoPackage("no samples in that window")
    with open(f["cras"], "rb") as fh:
        hd = struct.unpack(_CRAS_HEAD, fh.read(64))
        ns, nl, nb, specny, ctype, chunksize, nchunks = hd[1], hd[2], hd[3], hd[6], hd[9], hd[10], hd[11]
        if ctype != 1 or not chunksize:
            raise NoPackage("the line scan is not chunked JPEG")
        offs = np.frombuffer(fh.read(4 * (nchunks + 1)), np.uint32).astype(np.int64)
        offs = np.where(np.diff(offs, prepend=0) < 0, offs + (1 << 32), offs)   # a file over 4 GB wraps the 32-bit offsets
        r0, r1 = i0 * specny, min(i1 * specny, nl)
        c0, c1 = r0 // chunksize, min((r1 - 1) // chunksize, nchunks - 1)
        base = 64 + 4 * (nchunks + 1)
        parts = []
        for c in range(c0, c1 + 1):
            fh.seek(base + int(offs[c])); chunk = fh.read(int(offs[c + 1] - offs[c]))
            parts.append(np.ascontiguousarray(np.flipud(decode_jpeg(chunk, colorspace="RGB"))))
    img = np.concatenate(parts, axis=0)[r0 - c0 * chunksize: r1 - c0 * chunksize]
    im = Image.fromarray(img)
    if width and width < im.width:
        im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=86); return buf.getvalue()
