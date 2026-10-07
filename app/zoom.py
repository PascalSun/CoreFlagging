"""Tray photographs at full resolution, as Deep Zoom tiles.

The platform keeps a browser-sized copy of each tray photograph. The original (about 11,000 x 4,000 px) stays in
the scan package on the NVCL mirror; when a reader zooms in, its tile pyramid is cut once and kept in the work
directory, so later views of the same tray are served straight from disk.

    info(refs, dataset, n)          {width, height, tile, overlap, format} of the original
    tile(refs, dataset, n, l, c, r) one JPEG tile of the Deep Zoom pyramid (OpenSeadragon's DZI layout)
"""
from __future__ import annotations

import io, json, math, re, shutil, threading, time, zipfile
from pathlib import Path

from PIL import Image

from .pipeline import config as C
from .trays import PHOTO, _norm

Image.MAX_IMAGE_PIXELS = 300_000_000
TILE, OVERLAP, QUALITY = 510, 1, 84
ROOT = C.DATA / "zoom"
MAX_BYTES = 20 * 1024**3                       # the tile cache is trimmed to this, least recently viewed first
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


class NoPhoto(LookupError):
    pass


def _safe(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s)


def _original(refs: list[str], dataset: str, n: int) -> bytes:
    """The original photograph of tray `n` of `dataset`, from whichever of the hole's mirrored zips holds it."""
    if not C.NVCL_ROOT:
        raise NoPhoto("this service has no NVCL mirror")
    for ref in refs:
        z = Path(C.NVCL_ROOT) / f"{ref}.zip"
        if not z.exists():
            continue
        with zipfile.ZipFile(z) as zf:
            names = [(i, i.filename.replace("\\\\", "/").split("/")[-1]) for i in zf.infolist()]
            alone = sum(fn.lower().endswith("_tsg.tsg") for _, fn in names) <= 1
            for i, fn in names:
                m = PHOTO.search(fn)
                if m and int(m.group(1)) == n and (alone or _norm(fn[:m.start()]) == _norm(dataset)):
                    return zf.read(i)
    raise NoPhoto(f"tray {n} of {dataset} is not in the mirror")


def _build(refs: list[str], dataset: str, n: int, d: Path) -> None:
    im = Image.open(io.BytesIO(_original(refs, dataset, n))).convert("RGB")
    W, H = im.size; top = math.ceil(math.log2(max(W, H)))
    tmp = d.with_name(d.name + ".part"); shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir(parents=True)
    level_img = im
    for lv in range(top, -1, -1):
        w, h = max(1, math.ceil(W / 2 ** (top - lv))), max(1, math.ceil(H / 2 ** (top - lv)))
        if level_img.size != (w, h):
            level_img = level_img.resize((w, h), Image.LANCZOS if lv >= top - 2 else Image.BILINEAR)
        ld = tmp / str(lv); ld.mkdir()
        for c in range(math.ceil(w / TILE)):
            for r in range(math.ceil(h / TILE)):
                x0, y0 = max(0, c * TILE - OVERLAP), max(0, r * TILE - OVERLAP)
                x1, y1 = min(w, (c + 1) * TILE + OVERLAP), min(h, (r + 1) * TILE + OVERLAP)
                level_img.crop((x0, y0, x1, y1)).save(ld / f"{c}_{r}.jpg", quality=QUALITY, optimize=False)
    (tmp / "info.json").write_text(json.dumps({"width": W, "height": H, "tile": TILE, "overlap": OVERLAP, "format": "jpg"}))
    shutil.rmtree(d, ignore_errors=True); tmp.rename(d)


def _dir(refs: list[str], dataset: str, n: int) -> Path:
    d = ROOT / _safe(dataset) / str(n)
    if (d / "info.json").exists():
        (d / "info.json").touch()                                    # recently used: kept when the cache is trimmed
        return d
    key = f"{dataset}/{n}"
    with _guard:
        lock = _locks.setdefault(key, threading.Lock())
    with lock:                                                       # two readers opening the same tray cut it once
        if not (d / "info.json").exists():
            _build(refs, dataset, n, d); _trim()
    return d


def _trim() -> None:
    trays = sorted(((p.parent, p.stat().st_mtime) for p in ROOT.glob("*/*/info.json")), key=lambda x: x[1])
    total = sum(f.stat().st_size for d, _ in trays for f in d.rglob("*.jpg"))
    for d, _ in trays:
        if total <= MAX_BYTES:
            break
        size = sum(f.stat().st_size for f in d.rglob("*.jpg")); shutil.rmtree(d, ignore_errors=True); total -= size


def info(refs: list[str], dataset: str, n: int) -> dict:
    return json.loads((_dir(refs, dataset, n) / "info.json").read_text())


def tile(refs: list[str], dataset: str, n: int, level: int, col: int, row: int) -> Path:
    f = _dir(refs, dataset, n) / str(level) / f"{col}_{row}.jpg"
    if not f.exists():
        raise NoPhoto("no such tile")
    return f
