"""Getting the TSG files of a job onto local disk: from the NVCL mirror, or from an uploaded zip.

Only the spectral members are unpacked (.tsg, .bip). A scan package is mostly tray photographs and the
linescan image (gigabytes); the pipeline does not read them.
"""
from __future__ import annotations

import json, re, shutil, zipfile
from functools import lru_cache
from pathlib import Path

from .pipeline import config as C
from .pipeline.nvcl import NVCLError, get, parse_logs
from .pipeline.tsg import META_TAGS, find_pairs, header

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


# AuScope store folder -> the State code the platform shows. WA is not here: it is mirrored from its own node.
STATES = {"NSW": "NSW", "NT": "NT", "Qld": "QLD", "SA": "SA", "Tas": "TAS", "Vic": "VIC", "CSIRO": "CSIRO"}


def zip_path(ref: str) -> Path | None:
    """Where a mirrored dataset's zip is. A WA ref is the bare dataset name (the WA mirror); another State's
    is its path in the store mirror, <State>/<dataset>."""
    root = C.NVCL_STORE if "/" in ref else C.NVCL_ROOT
    return Path(root) / f"{ref}.zip" if root else None


def is_wa(refs: list[str]) -> bool:
    return not any("/" in r for r in refs)


@lru_cache(maxsize=16)
def catalogue(path: str | None = None) -> dict[str, dict]:
    """TSG header fields per NVCL dataset name, from a node's catalogue (default: the WA one)."""
    path = path or C.CATALOGUE
    if not path or not Path(path).exists():
        return {}
    rows = json.loads(Path(path).read_text()).get("datasetCollection") or []; out = {}
    for c in rows:
        d = c.get("description") or ""
        out[c["datasetName"]] = {t: (m.group(1) if (m := re.search(rf"<{t}>(.*?)</{t}>", d, re.S)) else None) for t in META_TAGS}
    return out


def _uri(u: str) -> str:
    return re.sub(r"^https?://", "", (u or "").strip().lower()).rstrip("/")


def _f(v) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x != x else x


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math
    p = math.pi / 180; x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(x))


def _keys(groups: list[dict], prefix: str = "") -> None:
    """Give every hole a unique key. Two different holes can share a name (BH01 at Behemoth and BH01 at
    Bunbury); the one with a dataset of exactly that name keeps it, the other is keyed by its dataset."""
    safe = lambda s: re.sub(r"[^A-Za-z0-9 ._()-]+", "-", s).strip(" -")[:120]
    by: dict[str, list[dict]] = {}
    for g in groups:
        by.setdefault(g["name"].lower(), []).append(g)
    used: set[str] = set()
    for same in by.values():
        same.sort(key=lambda g: (not any(d.split("/")[-1].lower() == g["name"].lower() for d in g["datasets"]), g["datasets"][0]))
        for i, g in enumerate(same):
            k = prefix + safe(g["name"] if i == 0 else g["datasets"][0].split("/")[-1])
            while k.lower() in used:
                k += "-2"
            used.add(k.lower()); g["key"] = k


def _wa_holes() -> list[dict]:
    root = Path(C.NVCL_ROOT); rows = json.loads(Path(C.CATALOGUE).read_text())["datasetCollection"]; by: dict[str, dict] = {}
    # collars from GSWA's HyLogger drillhole list (the scan header is sometimes wrong or empty), then the research list
    gswa = {}
    gp = Path(C.CATALOGUE).with_name("hylogger_drillholes.json")
    if gp.exists():
        gswa = {r["DATA_NAME"]: r for r in json.loads(gp.read_text()) if r.get("DATA_NAME")}
    for c in rows:
        if (root / f"{c['datasetName']}.zip").exists():
            u = c["boreholeURI"].rstrip("/"); hole = u.split("/borehole/", 1)[1] if "/borehole/" in u else u.rsplit("/", 1)[-1]
            e = by.setdefault(_uri(u), {"name": hole, "datasets": [], "state": "WA"}); e["datasets"].append(c["datasetName"])
            if c["datasetName"].lower() == e["name"].lower().replace("/", "-"):
                e["name"] = c["datasetName"]                                 # prefer the spelling of the dataset (URIs are sometimes lower-cased)
    # the WA node gives some different holes one URI (BH01 at Behemoth and BH01 at Bunbury, 1,250 km apart):
    # datasets whose GSWA collars are more than 20 km apart are different holes
    groups = []
    for e in by.values():
        parts: list[tuple[tuple[float, float] | None, list[str]]] = []
        for d in e["datasets"]:
            g = gswa.get(d); at = (_f(g.get("LATITUDE")), _f(g.get("LONGITUDE"))) if g else None
            at = at if at and None not in at and at != (0.0, 0.0) else None
            home = next((p for p in parts if at is None or p[0] is None or _km(at, p[0]) < 20), None)
            if home is None:
                parts.append((at, [d]))
            else:
                home[1].append(d)
                if home[0] is None and at is not None:
                    parts[parts.index(home)] = (at, home[1])
        for _, ds in parts:
            groups.append({**e, "datasets": ds})
    ref = {}
    rp = Path(C.REFERENCE) / "holes_ref.json"
    if rp.exists():
        ref = {r["hole"].lower(): r for r in json.loads(rp.read_text())}
    for e in groups:
        g = next((gswa[d] for d in e["datasets"] if d in gswa and _f(gswa[d].get("LATITUDE")) not in (None, 0.0)), None)
        if g:
            e.update(lat=_f(g["LATITUDE"]), lon=_f(g["LONGITUDE"]), offshore=(g.get("SHORE_TYPE") == "Offshore" or g.get("TITLES") == "Commonwealth"))
            e.update({k: g[f].strip() for k, f in (("operator", "DRILL_OPER"), ("project", "PROJECT"), ("region", "TECT_NAME")) if (g.get(f) or "").strip()})
        else:
            e["offshore"] = False
        r = ref.get(e["name"].lower())
        if r:
            e.update({k: r.get(k) for k in ("operator", "project", "region") if r.get(k) not in (None, "")})
            if "lat" not in e and r.get("lat") not in (None, ""):
                e.update(lat=r["lat"], lon=r["lon"])
    _keys(groups)
    return groups


def _store_holes() -> list[dict]:
    root = Path(C.NVCL_STORE); idx = json.loads((root / "_catalog" / "store_index.json").read_text()); out = []
    for folder, st in STATES.items():
        by: dict[str, dict] = {}
        for r in idx.get(folder, []):
            ds = r["Download Link"]
            ref = next((f"{folder}/{p}{ds}" for p in ("", "NVCL/tsg/") if (root / folder / f"{p}{ds}.zip").exists()), None)
            if ref is None:
                continue
            name, project = (r.get("Borehole Name") or ds).strip(), ""
            if ": " in name:                                                  # NSW: "Kaiser Mine - Wellington: NKD002"
                project, name = (x.strip() for x in name.rsplit(": ", 1))
            e = by.setdefault(_uri(r.get("Borehole URI")) or f"{folder}/{name}".lower(), {"name": name, "datasets": [], "state": st, "offshore": False})
            e["datasets"].append(ref)
            lat, lon = _f(r.get("Latitude")), _f(r.get("Longitude"))
            if "lat" not in e and lat not in (None, 0.0) and lon not in (None, 0.0):
                e.update(lat=lat, lon=lon)
            if project and not e.get("project"):
                e["project"] = project
        groups = list(by.values()); _keys(groups, f"{st}-"); out += groups
    return out


def holes_in_catalogue() -> list[dict]:
    """[{key, name, datasets, state, offshore, lat?, lon?, ...}] for every mirrored hole that has a zip on disk. A
    hole's datasets are the catalogue entries that point at the same borehole (its URI, not its name)."""
    out = _wa_holes() if C.NVCL_ROOT and C.CATALOGUE else []
    if C.NVCL_STORE and (Path(C.NVCL_STORE) / "_catalog" / "store_index.json").exists():
        out += _store_holes()
    return sorted(out, key=lambda e: e["key"])


def service_tir_mask(folder: Path) -> int:
    """Put the NVCL data service's own TIR validity mask beside each dataset of a mirrored hole
    (<name>_tir_mask.npy). Returns how many datasets got one.

    A TSG package carries one Final Mask for TIR, synchronised to the SWIR mask when the package
    was written. The data service keeps the TIR mask as the scan was logged, and that is the one the
    models were trained with, so for NVCL holes it is the one used. A dataset the service does not
    know, or one without a TIR mask there, keeps the package's."""
    n = 0
    for pair in find_pairs(folder):
        if not pair["tir"]:
            continue
        dsid = header(pair["swir"][0])["dsid"]
        try:
            logs = parse_logs(get(C.NVCL + f"getLogCollection.html?datasetid={dsid}", timeout=60).decode(errors="ignore"))
        except NVCLError as e:
            raise RuntimeError(f"NVCL data service not reachable for {pair['name']}: {e}") from e   # retried later
        users: dict[str, list[str]] = {}
        for lg in logs:
            if lg["mask"]:
                users.setdefault(lg["mask"], []).append(lg["name"] or "")
        tir = next((lg for lg in logs if lg["type"] == "6" and any(u.endswith("jCLST") for u in users.get(lg["logid"], []))), None)
        if tir is None:
            continue
        try:
            raw = get(C.NVCL + f"downloadscalars.html?logid={tir['logid']}", timeout=600)
        except NVCLError as e:
            raise RuntimeError(f"NVCL TIR mask of {pair['name']} could not be downloaded: {e}") from e
        import io
        import numpy as np
        import pandas as pd
        v = pd.read_csv(io.BytesIO(raw), na_values=["null"], keep_default_na=False).iloc[:, 2]
        np.save(pair["swir"][0].with_name(f"{pair['name']}_tir_mask.npy"), (pd.to_numeric(v, errors="coerce").fillna(0).to_numpy() == 1).astype("uint8"))
        n += 1
    return n


def fetch(job: dict, platform, tmp: Path) -> tuple[list[Path], dict[str, dict], list[Path]]:
    """Folders of TSG files for a job, the header fields known for its datasets, and the zips they came from
    (the tray photographs are read from those afterwards)."""
    parts = job["parts"]; folders = []; zips = []
    if job["hole"]["source"] == "nvcl":
        refs = [p["ref"] for p in parts]; meta: dict[str, dict] = {}
        for p in parts:
            z = zip_path(p["ref"])
            if z is None:
                raise SourceError("This worker has no NVCL mirror.")
            if not z.exists():
                raise NotHere(f"{p['ref']}.zip is not in this worker's NVCL mirror.")
            d = tmp / f"ds{p['number']:03d}"
            if unpack_spectral(z, d):
                # WA holes use the WA node's TIR mask, as the models were trained with. Another State's hole keeps
                # its package mask: the models never saw that State's core, so there is no parity to keep
                if is_wa(refs):
                    service_tir_mask(d)
                folders.append(d); zips.append(z)
            if "/" in p["ref"]:
                meta.update(catalogue(str(Path(C.NVCL_STORE) / p["ref"].split("/")[0] / "_catalog" / "all_datasets.json")))
        return folders, (catalogue() if is_wa(refs) else meta), zips
    z = tmp / "upload.zip"; platform.download_source(job, z)
    d = tmp / "upload"
    if not unpack_spectral(z, d):
        raise SourceError("No TSG spectral files found in the zip. It needs <name>_tsg.tsg and <name>_tsg.bip (and the _tsg_tir pair for thermal infrared).")
    return [d], {}, [z]
