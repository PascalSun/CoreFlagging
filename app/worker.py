"""Take jobs from the platform, one at a time: fetch the scan, clean it, run the models, hand the result back.

A job is held on a lease. A heartbeat thread keeps it alive while a long step (reading a 4 GB zip off the NAS) says
nothing; if this process dies the lease runs out and another worker takes the job.
"""
from __future__ import annotations

import logging, os, shutil, socket, tempfile, threading, time, traceback
from pathlib import Path

import httpx

from .pipeline import config as C
from .pipeline.tsg import TSGError
from .platform import Platform
from .runner import Runner
from .sources import SourceError, fetch, is_wa
from .trays import extract

log = logging.getLogger("coretrace.worker")
IDLE_S, HEARTBEAT_S = 5, 60
STAGE = {"reading": "reading", "cleaning": "cleaning", "modelling": "modelling"}


class Worker:
    def __init__(self, runner: Runner, platform: Platform | None = None):
        self.runner = runner; self.platform = platform or Platform()
        self.name = f"{socket.gethostname()}:{os.getpid()}"; self.sources = ["upload"] + (["nvcl"] if C.NVCL_ROOT or C.NVCL_STORE else [])
        self.stop = threading.Event()

    def announce(self) -> None:
        self.platform.announce_models([{"run": m["run"], "name": m["card"].get("name_en") or m["name"], "kind": m["kind"], "description": m["card"].get("desc_en") or m["desc"], "default": m["default"],
                                        "card": {**m["card"], "tir_wl": [float(x) for x in self.runner.models.get(m["run"]).tir_wl]}} for m in self.runner.models.listing()])

    def run_one(self) -> bool:
        """Claim and process one job. Returns False if there was nothing to do."""
        job = self.platform.claim(self.name, self.sources)
        if job is None:
            return False
        key, name = job["hole"]["key"], job["hole"]["name"]; log.info("job %s: %s (%s)", job["job"], name, job["hole"]["source"])
        state = {"status": "reading", "message": "Fetching the scan", "progress": 0.0}; done = threading.Event(); lost = threading.Event()

        def beat():
            while not done.wait(HEARTBEAT_S):
                try:
                    if not self.platform.heartbeat(job, **state):
                        lost.set(); return
                except httpx.HTTPError:
                    pass                                      # the platform may be restarting; the lease is 10 minutes

        def progress(stage, message, frac=None):
            base, span = {"reading": (0.0, 0.1), "cleaning": (0.1, 0.3), "modelling": (0.4, 0.6)}[stage]
            state.update(status=STAGE[stage], message=message, progress=round(base + span * (frac or 0.0), 3))

        threading.Thread(target=beat, daemon=True).start()
        tmp = Path(tempfile.mkdtemp(prefix="coretrace-", dir=self.runner.ws.root))
        try:
            self.platform.heartbeat(job, **state)
            folders, meta, zips = fetch(job, self.platform, tmp)
            # only a WA mirrored hole is matched to the WA reference list by its name: an upload's "DDH-1", or
            # another State's, is not GSWA's
            # (and only by its name when that is its key: BH01_Behemoth is not the BH01 of the list)
            ref = None if job["hole"]["source"] == "nvcl" and is_wa([p["ref"] for p in job["parts"]]) and key == name else {}
            pkg = self.runner.process(key, name, folders, meta=meta, ref=ref, source="NVCL mirror" if job["hole"]["source"] == "nvcl" else "upload", progress=progress)
            if lost.is_set():
                log.warning("job %s: lease lost, result dropped", job["job"]); return True
            self.platform.result(job, pkg)                    # the hole is readable from here on; photographs follow
            self.photos(job, key, zips, tmp, state)
            self.platform.done(job)
            log.info("job %s: done", job["job"])
        except (SourceError, TSGError, ValueError) as e:      # the scan itself is the problem: retrying will not help
            self._fail(job, str(e)); log.warning("job %s failed: %s", job["job"], e)
        except Exception as e:                                # noqa: BLE001 - NAS hiccup, platform restart: try again later
            log.error("job %s error:\n%s", job["job"], traceback.format_exc()); self._fail(job, f"{type(e).__name__}: {e}", transient=True)
        finally:
            done.set(); shutil.rmtree(tmp, ignore_errors=True); self.runner.ws.remove(key)
        return True

    def photos(self, job: dict, key: str, zips: list[Path], tmp: Path, state: dict) -> None:
        """Tray photographs of the datasets that were used. A hole without photographs, or with a damaged one, is still a hole."""
        index = self.runner.trays.pop(key, {}); sent = 0
        state.clear()                                         # the hole is ready: heartbeats now only keep the lease
        for z in zips:
            for name, trays in index.items():
                try:
                    for tray, jpeg in extract(z, name, trays, tmp / "trays" / name):
                        self.platform.tray(job, name, tray, jpeg); jpeg.unlink(missing_ok=True); sent += 1
                except Exception as e:                        # noqa: BLE001
                    log.warning("job %s: tray photographs of %s stopped: %s", job["job"], name, e)
        log.info("job %s: %s tray photographs", job["job"], sent)

    def _fail(self, job: dict, error: str, transient: bool = False) -> None:
        """Report a failure. If the platform cannot be reached (it may be redeploying) the lease simply
        runs out and the job is handed on, so this never takes the worker down."""
        try:
            self.platform.fail(job, error, transient=transient)
        except httpx.HTTPError as e:
            log.warning("job %s: could not report the failure (%s); its lease will run out", job["job"], e)

    def loop(self, until_idle: bool = False) -> None:
        """Take jobs until stopped (or, with until_idle, until the queue is empty). A platform that is
        down for a while (a deploy) is waited out, not fatal."""
        while not self.stop.is_set():
            try:
                if not self.run_one():
                    if until_idle:
                        return
                    self.stop.wait(IDLE_S)
            except httpx.HTTPError as e:
                log.warning("platform not reachable (%s); waiting", e); self.stop.wait(30)
            except Exception:                                 # noqa: BLE001 - never let the loop die
                log.error("worker error:\n%s", traceback.format_exc()); self.stop.wait(30)
