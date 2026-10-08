"""Backfill: give the tray rows a hole already has their positions along the scan (xmm), read from the .tsg
headers in the mirror. Nothing else is read (no spectra, no photographs) and nothing else changes."""
from __future__ import annotations

import logging, shutil, tempfile, zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .sources import zip_path
from .trays import row_mm

log = logging.getLogger("coretrace.traymm")


def _hole(h: dict, platform) -> int:
    trays = []
    tmp = Path(tempfile.mkdtemp(prefix="traymm-"))
    try:
        for ref in h["datasets"]:
            z = zip_path(ref)
            if z is None or not z.exists():
                continue
            with zipfile.ZipFile(z) as zf:
                for i in zf.infolist():
                    fn = i.filename.replace("\\", "/").split("/")[-1]
                    if not fn.lower().endswith("_tsg.tsg") or "_cras" in fn.lower():
                        continue
                    p = tmp / fn
                    with zf.open(i) as src, open(p, "wb") as f:
                        shutil.copyfileobj(src, f, 1 << 22)
                    name = fn[:-len("_tsg.tsg")]
                    trays += [{"dataset": name, "n": n, "xmm": rows} for n, rows in row_mm(p).items()]
                    p.unlink(missing_ok=True)
        return platform.tray_rows(h["key"], trays) if trays else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def backfill(holes: list[dict], platform, threads: int = 8) -> dict:
    done = trays = failed = 0

    def one(h):
        try:
            return _hole(h, platform)
        except Exception as e:                                # noqa: BLE001 - one hole never stops the rest
            log.warning("%s: %s", h["key"], e); return -1

    with ThreadPoolExecutor(threads) as ex:
        for n in ex.map(one, holes):
            done += 1
            if n < 0:
                failed += 1
            else:
                trays += n
            if done % 200 == 0:
                log.info("%d of %d holes, %d trays", done, len(holes), trays)
    return {"holes": len(holes), "trays_updated": trays, "failed": failed}
