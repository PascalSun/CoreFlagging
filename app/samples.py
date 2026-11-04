"""The finest level of a hole: every spectrum sample (about 8 mm) and the line-scan photograph at full resolution.

Both come straight from the TSG package in the mirror, unpacked once per dataset into a cache under
CORETRACE_WORK/pkg (the spectral files, the laser profile and the line scan; trimmed least-recently-used):

    samples(refs, dataset, lo, hi)   one row per sample in the depth window: depth, tray, section, position
                                     along the section, the TSG mineral read there, the laser height; the
                                     SWIR spectrum too when asked
    linescan(refs, dataset, lo, hi)  the line-scan image rows for the window as one JPEG strip, read by
                                     decoding only the chunks that cover those rows (the cras file is a
                                     stack of JPEG chunks of a fixed number of lines each)

A ref is a mirrored dataset (sources.zip_path), or "upload:<hole key>" for a hole someone uploaded: its kept zip is
fetched from the platform once and unpacked into the same cache, under a name of its own (two people's uploads can
both be called DDH-1).
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


UPLOAD = "upload:"


def _cache_name(refs: list[str], dataset: str) -> str:
    """The cache folder of a dataset: its own name for a mirrored one, the hole key with it for an upload."""
    up = next((r[len(UPLOAD):] for r in refs if r.startswith(UPLOAD)), None)
    return _safe(dataset) if up is None else _safe(f"upload-{up}-{dataset}")


def _upload_zip(key: str, dest: Path) -> bool:
    """The kept zip of an uploaded hole, from the platform, written to `dest`. False when the platform has none."""
    from .platform import Platform
    try:
        return Platform().package_zip(key, dest)
    except RuntimeError:                  # no platform configured: this service cannot reach uploads
        return False


def _one_dataset(zip_path: Path) -> str | None:
    """The dataset name of a zip that holds exactly one <name>_tsg.tsg, else None."""
    with zipfile.ZipFile(zip_path) as z:
        stems = {n[:-len("_tsg.tsg")] for i in z.infolist() if (n := i.filename.replace("\\", "/").split("/")[-1]).lower().endswith("_tsg.tsg")}
    return stems.pop() if len(stems) == 1 else None


def package(refs: list[str], dataset: str) -> Path:
    """Where the dataset's files are, unpacking them from the first zip that holds them on first use (a mirrored zip,
    or an uploaded hole's zip fetched from the platform)."""
    d = ROOT / _cache_name(refs, dataset)
    done = d / ".ready"
    if done.exists():
        done.touch(); return d
    with _guard:
        lock = _locks.setdefault(d.name, threading.Lock())
    with lock:
        if done.exists():
            return d
        for ref in refs:
            fetched = None
            if ref.startswith(UPLOAD):
                ROOT.mkdir(parents=True, exist_ok=True)
                fetched = zp = ROOT / f".{d.name}.zip"
                if not _upload_zip(ref[len(UPLOAD):], zp):
                    zp.unlink(missing_ok=True); continue
            else:
                zp = sources.zip_path(ref)
            if zp and zp.exists():
                tmp = d.with_suffix(".tmp"); shutil.rmtree(tmp, ignore_errors=True)
                try:
                    n = _unpack(zp, tmp, dataset)
                    # an upload holds one hole: when its files are not named the way the platform names the dataset
                    # (a rename, a cleaned-up name), its one dataset is the one meant. Not so for the mirror, where a
                    # hole's datasets are each in their own zip and the wrong zip must not answer for another.
                    if not n and fetched is not None and (only := _one_dataset(zp)) is not None:
                        n = _unpack(zp, tmp, only)
                except zipfile.BadZipFile:
                    continue
                finally:
                    if fetched is not None:
                        fetched.unlink(missing_ok=True)
                if n:
                    shutil.rmtree(d, ignore_errors=True); tmp.rename(d); done.touch(); _trim(); return d
                shutil.rmtree(tmp, ignore_errors=True)
        raise NoPackage(f"no package for {dataset}" + (" (the upload is not kept)" if any(r.startswith(UPLOAD) for r in refs) else " in the mirror"))


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
    key = d.name                          # the cache folder: an upload and a mirrored dataset of one name are not one
    with _guard:
        if key in _spectra:
            _spectra.move_to_end(key); return _spectra[key]
    from pytsg import parse_tsg as p
    f = _files(d)
    if "tsg" not in f or "bip" not in f:
        raise NoPackage("the package has no SWIR spectra")
    sp = p.read_tsg_bip_pair(str(f["tsg"]), str(f["bip"]), "nir")
    with _guard:
        _spectra[key] = sp; _spectra.move_to_end(key)
        while len(_spectra) > 4:
            _spectra.popitem(last=False)
    return sp


_tir: OrderedDict[str, object] = OrderedDict()       # dataset -> pytsg Spectra of the TIR file, or None when it has none


def _tir_of(d: Path, dataset: str):
    """The dataset's TIR spectra, when the package has the TIR pair; None otherwise. Cached like the SWIR."""
    key = d.name
    with _guard:
        if key in _tir:
            _tir.move_to_end(key); return _tir[key]
    f = _files(d)
    sp = None
    if "tir_tsg" in f and "tir_bip" in f:
        from pytsg import parse_tsg as p
        try:
            sp = p.read_tsg_bip_pair(str(f["tir_tsg"]), str(f["tir_bip"]), "tir")
        except Exception:        # noqa: BLE001 - a damaged TIR file loses the TIR, not the samples
            sp = None
    with _guard:
        _tir[key] = sp; _tir.move_to_end(key)
        while len(_tir) > 4:
            _tir.popitem(last=False)
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


_TSA = re.compile(r"^(Min|Grp|Wt)([123]) ([su])(TSAS|jCLST|TSAT)$")


def _tsa_columns(sp) -> dict[str, object]:
    """The TSA (SWIR) or jCLST/TSAT (TIR) result columns of a file: the system run when it has one, else the
    user's. Keys "Min1", "Grp1", "Wt1" … "Wt3"."""
    found: dict[str, dict[str, object]] = {"s": {}, "u": {}}
    for c in sp.scalars.columns:
        m = _TSA.match(c)
        if m: found[m.group(3)][m.group(1) + m.group(2)] = sp.scalars[c]
    return found["s"] if "Min1" in found["s"] else found["u"]


def _class_table(sp, want: str) -> dict[int, str]:
    """The class table whose name holds `want` ("Groups" or "Minerals" of the TSA run): a coded column reads
    through it. pytsg exposes the file's class headers by index."""
    for ch in (getattr(sp, "classes", None) or {}).values():
        name = str(getattr(ch, "name", "")); table = getattr(ch, "classes", None)
        if want in name and isinstance(table, dict): return {int(k): str(v) for k, v in table.items()}
    return {}


def _tsa_reader(sp):
    """A function i -> [[group, mineral, weight], …] (up to three, heaviest first) for sample i, or [] when the run
    read nothing there. Coded groups or minerals (floats) resolve through the class tables."""
    cols = _tsa_columns(sp)
    groups = _class_table(sp, "Groups"); minerals = _class_table(sp, "Minerals")
    def name(col, i, table):
        if col is None: return ""
        v = col.iloc[i]
        if v is None: return ""
        if isinstance(v, (float, np.floating)):
            if not np.isfinite(v) or v < -1e30: return ""
            return table.get(int(round(float(v))), "")
        return str(v).strip()
    def read(i):
        out = []
        for n in "123":
            g, mn, w = name(cols.get("Grp" + n), i, groups), name(cols.get("Min" + n), i, minerals), cols.get("Wt" + n)
            wt = None if w is None else float(w.iloc[i])
            if wt is not None and (not np.isfinite(wt) or wt < -1e30): wt = None
            if not (g or mn): continue
            out.append([g, mn, None if wt is None else round(wt, 3)])
        return out
    return read


def samples(refs: list[str], dataset: str, lo: float, hi: float, spectra: bool = False) -> dict:
    """One row per spectrum sample in [lo, hi): depth, tray, section, mm along the section, the TSG mineral and
    group read there (SWIR), the laser height (mm), and the SWIR spectrum when asked. At most 2,000 samples."""
    d = package(refs, dataset); sp = _spectra_of(d, dataset)
    i0, i1, D = _window(sp, lo, hi)
    i1 = min(i1, i0 + 2000)
    sh = sp.sampleheaders.iloc[i0:i1]
    swir_tsa = _tsa_reader(sp)
    height = None
    f = _files(d)
    if "hires" in f:
        from pytsg import parse_tsg as p
        try:
            h = p.read_hires_dat(str(f["hires"]), per_spectra=True); height = h[i0:i1]
        except Exception:        # noqa: BLE001 - a damaged profile is not worth failing the samples for
            height = None
    tir = _tir_of(d, dataset)
    tirD = tir.sampleheaders["D"].astype(float).to_numpy() if tir is not None else None
    tir_tsa = _tsa_reader(tir) if tir is not None else None
    def tir_index(depth: float):
        """the TIR sample measured within 5 mm of this depth, or None (the TIR file has its own sample list)"""
        if tirD is None or len(tirD) == 0: return None
        k = int(np.searchsorted(tirD, depth)); k = min(max(k, 0), len(tirD) - 1)
        if k > 0 and abs(tirD[k - 1] - depth) < abs(tirD[k] - depth): k -= 1
        return None if abs(tirD[k] - depth) > 0.005 else k
    def tir_at(depth: float):
        k = tir_index(depth)
        if k is None: return None
        v = tir.spectra[k]
        return None if not np.isfinite(v).any() else [round(float(x), 4) for x in v]
    rows = []
    for j, i in enumerate(range(i0, i1)):
        sw = swir_tsa(i); k = tir_index(float(D[i])); tw = tir_tsa(k) if (tir_tsa is not None and k is not None) else []
        first = sw[0] if sw else ["", "", None]; tfirst = tw[0] if tw else ["", "", None]
        r = {"i": int(i), "depth": round(float(D[i]), 4), "tray": str(sh["T"].iloc[j]), "section": int(float(sh["L"].iloc[j])) if str(sh["L"].iloc[j]).strip() else None,
             "x_mm": round(float(sh["X"].iloc[j]), 1), "mineral": first[1], "group": first[0], "weight": first[2],
             "height_mm": None if height is None or np.isnan(height[j]) else round(float(height[j]), 2),
             "swir_mix": sw, "tir_mineral": tfirst[1], "tir_group": tfirst[0], "tir_mix": tw}
        if spectra:
            r["swir"] = [round(float(x), 4) for x in sp.spectra[i]]
            r["tir"] = tir_at(float(D[i]))
        rows.append(r)
    out = {"dataset": dataset, "from_m": lo, "to_m": hi, "n": len(rows), "step_mm": round(float(np.median(np.diff(D[i0:i1])) * 1000), 2) if i1 - i0 > 2 else None, "samples": rows}
    if spectra:
        out["swir_wl"] = [round(float(x), 1) for x in sp.wavelength]
        out["tir_wl"] = [round(float(x), 1) for x in tir.wavelength] if tir is not None else None
    return out


_CRAS_HEAD = "20s2I8h4I2h"


def cras_rows(path: Path, i0: int, i1: int, factor: int = 1) -> np.ndarray:
    """The line-scan rows of samples [i0, i1) as an RGB array, top = sample i0. Each sample is `specny` image rows
    in the file, so the strip is linear in sample index (not in depth). Only the chunks covering those rows are
    decoded; `factor` 2, 4 or 8 decodes them that much smaller (libjpeg scales while decoding, far faster)."""
    from simplejpeg import decode_jpeg
    with open(path, "rb") as fh:
        hd = struct.unpack(_CRAS_HEAD, fh.read(64))
        ns, nl, nb, specny, ctype, chunksize, nchunks = hd[1], hd[2], hd[3], hd[6], hd[9], hd[10], hd[11]
        if ctype != 1 or not chunksize:
            raise NoPackage("the line scan is not chunked JPEG")
        offs = np.frombuffer(fh.read(4 * (nchunks + 1)), np.uint32).astype(np.int64)
        offs = np.where(np.diff(offs, prepend=0) < 0, offs + (1 << 32), offs)   # a file over 4 GB wraps the 32-bit offsets
        r0, r1 = i0 * specny, min(i1 * specny, nl)
        if r1 <= r0:
            raise NoPackage("the line scan has no rows for those samples")
        f = factor if factor in (2, 4, 8) and chunksize % factor == 0 else 1
        c0, c1 = r0 // chunksize, min((r1 - 1) // chunksize, nchunks - 1)
        base = 64 + 4 * (nchunks + 1)
        parts = []; scale = 1.0
        for c in range(c0, c1 + 1):
            fh.seek(base + int(offs[c])); chunk = fh.read(int(offs[c + 1] - offs[c]))
            # libjpeg scales only when asked for a size: min_factor alone leaves the chunk full size
            img = decode_jpeg(chunk, colorspace="RGB", min_height=-(-chunksize // f), min_width=-(-ns // f), min_factor=f) if f > 1 else decode_jpeg(chunk, colorspace="RGB")
            if c == c0:
                scale = img.shape[0] / min(chunksize, nl - c * chunksize)   # what the decoder gave, not what was asked
            # TSG writes the chunks with the channels in BGR order: decoded as RGB, a pink label comes out blue
            parts.append(np.ascontiguousarray(np.flipud(img)[..., ::-1]))
    a = (r0 - c0 * chunksize) * scale; b = (r1 - c0 * chunksize) * scale
    return np.concatenate(parts, axis=0)[int(round(a)): max(int(round(b)), int(round(a)) + 1)]


def specny_of(path: Path) -> int:
    with open(path, "rb") as fh:
        return int(struct.unpack(_CRAS_HEAD, fh.read(64))[6])


def linescan(refs: list[str], dataset: str, lo: float, hi: float, width: int = 600) -> bytes:
    """The line-scan rows of [lo, hi) as one JPEG strip `width` pixels across (the core runs top to bottom,
    shallow at the top). Only the JPEG chunks covering those rows are decoded."""
    d = package(refs, dataset); f = _files(d)
    if "cras" not in f:
        raise NoPackage("the package has no line-scan image")
    sp = _spectra_of(d, dataset)
    i0, i1, _ = _window(sp, lo, hi)
    if i1 <= i0:
        raise NoPackage("no samples in that window")
    im = Image.fromarray(cras_rows(f["cras"], i0, i1))
    if width and width < im.width:
        im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=86); return buf.getvalue()
