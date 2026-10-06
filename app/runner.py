"""One hole from TSG files to everything the platform stores about it.

    folders of TSG files -> raw layout -> cleaning + 10 cm tokens -> every model -> package

The package is plain data, so the platform can write it to its database without knowing anything about the models:
  hole        metadata of the hole (collar, instrument, depth range, training split ...)
  report      cleaning report: funnel, per-dataset statistics, rules applied
  qc          data-quality issues found in this hole
  metres      per metre, the same for every model: software minerals, logged rock, gold assay
  models      per model: per-metre outputs, auto log, summaries, timing
  tokens      path of the .npz with the 10 cm tokens (spectra as float16)
  arrays      path of the .npz with per-metre arrays per model: tir__<run> (rebuilt TIR), fp__<run> (fingerprint)
"""
from __future__ import annotations

import json, shutil, time

import numpy as np
from pathlib import Path
from typing import Callable

from . import extras, labels
from .pipeline import tsg
from .pipeline.engine import Models
from .pipeline.preprocess import preprocess_hole
from .workspace import Workspace

Progress = Callable[[str, str, float | None], None]          # (stage, message, fraction)
PER_METRE_SHARED = ("m", "gs", "ms", "gt", "lith", "lith_raw", "au")
PER_METRE_MODEL = ("core", "anom", "anom_raw", "gold", "gold_pct", "tir_pred", "tir_conf", "has_tir")
PER_MODEL = ("tir", "anomaly", "gold_summary", "segments", "core_types", "model")


class Runner:
    def __init__(self, ws: Workspace | None = None, bundle: Path | None = None):
        from .pipeline import config as C
        self.ws = ws or Workspace(); self.models = Models(bundle or C.BUNDLE, self.ws)
        self.trays: dict[str, dict[str, list[dict]]] = {}        # per hole key: tray index of each dataset, from its last clean()

    def clean(self, key: str, hole: str, folders: list[Path], meta: dict[str, dict] | None = None, ref: dict | None = None,
              source: str = "TSG files", progress: Progress = lambda *a: None) -> dict:
        """TSG files -> processed hole in the workspace. `key` names the hole locally (unique per scan); `hole` is its
        drillhole name, used to look up the State reference row unless `ref` is given."""
        ws = self.ws; ws.remove(key)
        progress("reading", "Reading the TSG files", 0.0)
        hd = tsg.write_hole(key, folders, ws.raw, meta, source)
        self.trays[key] = {d["name"]: d.get("trays", []) for d in json.loads((hd / "manifest.json").read_text())["datasets"]}
        try:
            out = preprocess_hole(hd, ws.proc, ref if ref is not None else ws.ref_for(hole), lambda msg, frac=None: progress("cleaning", "Cleaning and binning to 10 cm", frac))
        finally:
            shutil.rmtree(hd, ignore_errors=True)
        kept = {d["dataset"] for d in out["report"]["datasets"] if d.get("kept")}
        self.trays[key] = {k: v for k, v in self.trays[key].items() if k in kept}
        return out

    def run_models(self, key: str, runs: list[str] | None = None, progress: Progress = lambda *a: None) -> dict:
        """Every model on a processed hole -> the package."""
        ws = self.ws; M = ws.meta(key); pkg = {"hole": M["meta"], "report": {k: v for k, v in M["report"].items() if k != "qc"}, "qc": M["report"]["qc"],
                                               "metres": None, "models": {}, "tokens": str(ws.proc / f"{key}.npz")}
        with np.load(ws.proc / f"{key}.npz", allow_pickle=False) as z:
            pkg["hole"]["ds_inst"] = [str(x) for x in z["ds_inst"]]      # instruments of the datasets kept, in token order
        runs = runs or list(self.models.dirs)
        arrays = {}
        for i, run in enumerate(runs):
            progress("modelling", f"Model {i + 1} of {len(runs)}: {run}", i / len(runs))
            t0 = time.time(); eng = self.models.get(run); v = eng.hole_view(key)
            if pkg["metres"] is None:
                pkg["metres"] = {k: v[k] for k in PER_METRE_SHARED}; pkg["metres"]["why"] = extras.metre_why(eng, key)
            tir, fp = extras.metre_arrays(eng, key); arrays[f"tir__{run}"] = tir.astype("<f2"); arrays[f"fp__{run}"] = fp.astype("<f4")
            pkg["models"][run] = {**{k: v[k] for k in PER_METRE_MODEL}, **{k: v[k] for k in PER_MODEL}, "summary": eng.summary(key), "seconds": round(time.time() - t0, 1)}
        np.savez_compressed(ws.proc / f"{key}.arrays.npz", **arrays); pkg["arrays"] = str(ws.proc / f"{key}.arrays.npz")
        return labels.package(pkg, self.models)

    def process(self, key: str, hole: str, folders: list[Path], **kw) -> dict:
        progress = kw.get("progress", lambda *a: None)
        self.clean(key, hole, folders, **kw)
        return self.run_models(key, progress=progress)
