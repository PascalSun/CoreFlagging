"""CoreTrace service.

It keeps no data of its own. It takes scans from the platform's queue, turns each into cleaned 10 cm tokens and the
models' readings, and hands those back; the platform stores and serves them. The one question it answers live is
"which core elsewhere in the State looks like this", because that needs the State library the models ship with.
"""
from __future__ import annotations

import logging, threading
from contextlib import asynccontextmanager

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from fastapi import Query
from fastapi.responses import FileResponse

from . import extras, zoom
from .pipeline import config as C
from .runner import Runner

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("coretrace")
torch.set_num_threads(C.THREADS)
state: dict = {"runner": None, "worker": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["runner"] = Runner()
    if C.WORKER and C.PLATFORM_API_URL:
        from .worker import Worker
        w = Worker(state["runner"]); state["worker"] = w

        def start():
            while not w.stop.is_set():
                try:
                    w.announce(); break
                except Exception as e:                        # noqa: BLE001 - the platform may come up after us
                    log.warning("could not announce models yet (%s)", e); w.stop.wait(15)
            w.loop()

        threading.Thread(target=start, daemon=True, name="coretrace-worker").start()
    yield
    if state["worker"]:
        state["worker"].stop.set()


app = FastAPI(title="CoreTrace", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    r = state["runner"]
    return {"status": "ok", "models": list(r.models.dirs) if r else [], "default": r.models.default if r else None,
            "worker": bool(state["worker"]), "sources": state["worker"].sources if state["worker"] else []}


@app.get("/api/v1/models")
def models():
    return state["runner"].models.listing()


class Similar(BaseModel):
    model: str = ""
    fp: list[float]
    hole: str = ""
    lat: float | None = None
    lon: float | None = None
    k: int = 10
    scope: str = "state"          # state | nearby | region | hole
    radius_km: float = 10.0       # for "nearby"
    region: str = ""              # for "region"


@app.post("/api/v1/similar")
def similar(body: Similar):
    try:
        eng = state["runner"].models.get(body.model or None)
    except KeyError:
        raise HTTPException(404, f"no model '{body.model}'")
    try:
        if body.scope not in ("state", "nearby", "region", "hole"):
            raise ValueError(f"unknown scope '{body.scope}'")
        res = extras.similar(eng, np.array(body.fp, "f4"), body.hole, body.lat, body.lon, max(1, min(body.k, 50)),
                             scope=body.scope, radius_km=max(1.0, min(body.radius_km, 200.0)), region=body.region)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"model": eng.run, "library": {"intervals": int(len(eng.L["hole"])), "holes": int(len(set(eng.L["hole"].tolist())))}, "results": res}


@app.get("/api/v1/samples")
def samples_in_window(dataset: str, lo: float, hi: float, refs: list[str] = Query(...), spectra: int = 0):
    """Every spectrum sample of a dataset in [lo, hi) m, from the mirrored package (unpacked on first use)."""
    from . import samples as smp
    if not (hi > lo) or hi - lo > 20:
        raise HTTPException(400, "a window is up to 20 m")
    try:
        return smp.samples(refs, dataset, lo, hi, spectra=bool(spectra))
    except smp.NoPackage as e:
        raise HTTPException(404, str(e))


@app.get("/api/v1/linescan.jpg")
def linescan_in_window(dataset: str, lo: float, hi: float, refs: list[str] = Query(...), width: int = 600):
    """The line-scan photograph of [lo, hi) m as one JPEG strip."""
    from . import samples as smp
    from fastapi.responses import Response as RawResponse
    if not (hi > lo) or hi - lo > 5:
        raise HTTPException(400, "a line-scan window is up to 5 m")
    try:
        return RawResponse(smp.linescan(refs, dataset, lo, hi, width=max(100, min(width, 1500))), media_type="image/jpeg")
    except smp.NoPackage as e:
        raise HTTPException(404, str(e))


@app.get("/api/v1/trays/zoom/info")
def tray_zoom_info(dataset: str, n: int, refs: list[str] = Query(...)):
    """Size and tile layout of a tray photograph's original, cutting its tiles on first use."""
    try:
        return zoom.info(refs, dataset, n)
    except zoom.NoPhoto as e:
        raise HTTPException(404, str(e))


@app.get("/api/v1/trays/zoom/tile/{level}/{col}_{row}.jpg")
def tray_zoom_tile(level: int, col: int, row: int, dataset: str, n: int, refs: list[str] = Query(...)):
    try:
        return FileResponse(zoom.tile(refs, dataset, n, level, col, row), media_type="image/jpeg")
    except zoom.NoPhoto as e:
        raise HTTPException(404, str(e))
