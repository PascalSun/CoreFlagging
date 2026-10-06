"""Getting the TSG files of a job onto local disk: from the NVCL mirror, or from an uploaded zip.

Only the spectral members are unpacked (.tsg, .bip). A scan package is mostly tray photographs and the
linescan image (gigabytes); the pipeline does not read them.
"""
from __future__ import annotations

import json, re, shutil, zipfile
from functools import lru_cache
from pathlib import Path

from .pipeline import config as C
from .pipeline.tsg import META_TAGS

WANTED = re.compile(r"_tsg(_tir)?\.(tsg|bip)$", re.I)
MAX_UNPACKED = 12 * 1024**3


class SourceError(ValueError):
    pass


class NotHere(RuntimeError):
    """This worker cannot reach the scan (its mirror lacks the zip). Another worker may; the job is retried, not failed."""


def unpack_spectral(zip_path: Path, dest: Path) -> int:
    """Unpack the spectral members of a TSG zip into `dest` (flat). Returns how many files were written."""
    dest.mkdir(parents=True, exist_ok=True); n = total = 0
    try:
        z = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as e:
        raise SourceError("The upload is not a zip archive.") from e
    with z:
        for i in z.infolist():
            name = i.filename.replace("\\", "/").split("/")[-1]           # NVCL packages use backslashes; never trust a path
            if i.is_dir() or not WANTED.search(name) or "_cras" in name.lower():
                continue
            total += i.file_size
            if total > MAX_UNPACKED:
                raise SourceError("The spectral files in the zip are larger than 12 GB.")
            with z.open(i) as src, open(dest / name, "wb") as f:
                shutil.copyfileobj(src, f, 1 << 22)
            n += 1
    return n


@lru_cache(maxsize=1)
def catalogue() -> dict[str, dict]:
    """TSG header fields per NVCL dataset name, from the mirror's catalogue."""
    if not C.CATALOGUE or not Path(C.CATALOGUE).exists():
        return {}
    rows = json.loads(Path(C.CATALOGUE).read_text())["datasetCollection"]; out = {}
    for c in rows:
        d = c.get("description") or ""
        out[c["datasetName"]] = {t: (m.group(1) if (m := re.search(rf"<{t}>(.*?)</{t}>", d, re.S)) else None) for t in META_TAGS}
    return out


def holes_in_catalogue() -> list[dict]:
    """[{name, datasets}] for every hole of the mirror that has a zip on disk. A hole's datasets are the catalogue
    entries that point at the same borehole."""
    root = Path(C.NVCL_ROOT); rows = json.loads(Path(C.CATALOGUE).read_text())["datasetCollection"]; by: dict[str, dict] = {}
    for c in rows:
        hole = c["boreholeURI"].rstrip("/").rsplit("/", 1)[-1]
        if (root / f"{c['datasetName']}.zip").exists():
            e = by.setdefault(hole.lower(), {"name": hole, "datasets": []}); e["datasets"].append(c["datasetName"])
            if c["datasetName"].lower() == hole.lower():
                e["name"] = c["datasetName"]                                 # prefer the spelling of the dataset (URIs are sometimes lower-cased)
    return sorted(by.values(), key=lambda e: e["name"])


def fetch(job: dict, platform, tmp: Path) -> tuple[list[Path], dict[str, dict], list[Path]]:
    """Folders of TSG files for a job, the header fields known for its datasets, and the zips they came from
    (the tray photographs are read from those afterwards)."""
    parts = job["parts"]; folders = []; zips = []
    if job["hole"]["source"] == "nvcl":
        if not C.NVCL_ROOT:
            raise SourceError("This worker has no NVCL mirror.")
        for p in parts:
            z = Path(C.NVCL_ROOT) / f"{p['ref']}.zip"
            if not z.exists():
                raise NotHere(f"{p['ref']}.zip is not in this worker's NVCL mirror.")
            d = tmp / f"ds{p['number']:03d}"
            if unpack_spectral(z, d):
                folders.append(d); zips.append(z)
        return folders, catalogue(), zips
    z = tmp / "upload.zip"; platform.download_source(job, z)
    d = tmp / "upload"
    if not unpack_spectral(z, d):
        raise SourceError("No TSG spectral files found in the zip. It needs <name>_tsg.tsg and <name>_tsg.bip (and the _tsg_tir pair for thermal infrared).")
    return [d], {}, [z]
