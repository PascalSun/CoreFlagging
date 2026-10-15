"""One hole from TSG files to everything the platform stores about it.

    folders of TSG files -> raw layout -> cleaning + 10 cm tokens -> every model -> package

The package is plain data, so the platform can write it to its database without knowing anything about the models:
  hole        metadata of the hole (collar, instrument, depth range, training split ...)
  report      cleaning report: funnel, per-dataset statistics, rules applied
  qc          data-quality issues found in this hole
  metres      per metre, the same for every model: software minerals, logged rock, gold assay
  models      per model: per-metre outputs, auto log, summaries, timing
  spectral_log  group shares per 0.1 m and 1 m interval, SWIR and TIR (app/spectral.py), or None
  tokens      path of the .npz with the 10 cm tokens (spectra as float16)
  arrays      path of the .npz with per-metre arrays per model: tir__<run> (rebuilt TIR), fp__<run> (fingerprint),
              and per-token arrays: anom__<run>, raw__<run> (the unusual score of every 10 cm token, in token order)
"""
from __future__ import annotations

import json, re, shutil, time

import numpy as np
from pathlib import Path
from typing import Callable

from . import extras, labels, spectral
from .pipeline import tsg
from .pipeline.engine import Models
from .pipeline.preprocess import preprocess_hole
from .workspace import Workspace

Progress = Callable[[str, str, float | None], None]          # (stage, message, fraction)
PER_METRE_SHARED = ("m", "gs", "ms", "gt", "lith", "lith_raw", "au")
PER_METRE_MODEL = ("core", "anom", "anom_raw", "gold", "gold_pct", "tir_pred", "tir_conf", "has_tir")
PER_MODEL = ("tir", "anomaly", "gold_summary", "segments", "core_types", "model")


def plain_reason(why: str) -> str:
    """Why the training rules turned a scan away, in a reader's words."""
    if m := re.search(r"sample spacing ([\d.]+) m", why):
        return f"the scan is of chips or cuttings sampled every {float(m.group(1)):.2f} m, not of continuous core, which is all the models were trained on."
    if m := re.search(r"SWIR shape \(\d+, (\d+)\)", why):
        return f"its shortwave infrared was recorded on {m.group(1)} bands, not the 531 the models were trained on; it is resampled for display."
    if "enough valid SWIR" in why or "no valid SWIR" in why:
        return "the scan's validity mask leaves too few samples to read as core; every sample is shown regardless."
    if "validity mask" in why:
        return "the scan carries no validity mask, so the cleaning the models depend on cannot be applied."
    return why.removeprefix("No usable core scan in these files: ")


class Runner:
    def __init__(self, ws: Workspace | None = None, bundle: Path | None = None):
        from .pipeline import config as C
        self.ws = ws or Workspace(); self.models = Models(bundle or C.BUNDLE, self.ws)
        self.trays: dict[str, dict[str, list[dict]]] = {}        # per hole key: tray index of each dataset, from its last clean()
        self.logs: dict[str, dict | None] = {}                    # per hole key: the spectral log (group shares per interval), from its last clean()

    def clean(self, key: str, hole: str, folders: list[Path], meta: dict[str, dict] | None = None, ref: dict | None = None,
              source: str = "TSG files", progress: Progress = lambda *a: None, lenient: bool = False) -> dict:
        """TSG files -> processed hole in the workspace. `key` names the hole locally (unique per scan); `hole` is its
        drillhole name, used to look up the State reference row unless `ref` is given."""
        ws = self.ws; ws.remove(key)
        progress("reading", "Reading the TSG files", 0.0)
        hd = tsg.write_hole(key, folders, ws.raw, meta, source)
        self.trays[key] = {d["name"]: d.get("trays", []) for d in json.loads((hd / "manifest.json").read_text())["datasets"]}
        try:
            out = preprocess_hole(hd, ws.proc, ref if ref is not None else ws.ref_for(hole), lambda msg, frac=None: progress("cleaning", "Cleaning and binning to 10 cm", frac), lenient=lenient)
            self.logs[key] = spectral.from_raw(hd)
        finally:
            shutil.rmtree(hd, ignore_errors=True)
        kept = {d["dataset"] for d in out["report"]["datasets"] if d.get("kept")}
        self.trays[key] = {k: v for k, v in self.trays[key].items() if k in kept}
        return out

    def forget(self, key: str) -> None:
        """The hole's processed files and every engine's memory of it: the platform is the record."""
        self.ws.remove(key); self.models.forget(key)

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
            arrays[f"anom__{run}"], arrays[f"raw__{run}"] = extras.token_arrays(eng, key)
            pkg["models"][run] = {**{k: v[k] for k in PER_METRE_MODEL}, **{k: v[k] for k in PER_MODEL}, "summary": eng.summary(key), "seconds": round(time.time() - t0, 1)}
        np.savez_compressed(ws.proc / f"{key}.arrays.npz", **arrays); pkg["arrays"] = str(ws.proc / f"{key}.arrays.npz")
        return labels.package(pkg, self.models)

    def display_package(self, key: str, why: str) -> dict:
        """A scan the models cannot read, cleaned leniently: everything the platform can show without a model
        (spectra, software minerals, logs, photographs, quality issues). No model output, and it says why."""
        ws = self.ws; M = ws.meta(key); meta = dict(M["meta"]); qc = list(M["report"]["qc"])
        note = "Shown without the models: " + plain_reason(why) + " What the scan itself recorded is shown; nothing on this hole comes from a model."
        qc.append({"hole": meta.get("hole"), "dataset": None, "issue": "not_modelled", "issue_zh": "没有用模型处理", "depth_from": None, "depth_to": None,
                   "value": None, "evidence": why, "suggested_fix": ""})
        with np.load(ws.proc / f"{key}.npz", allow_pickle=False) as z:
            meta["ds_inst"] = [str(x) for x in z["ds_inst"]]
            m = np.floor(z["depth"]).astype(int); um = np.unique(m)
            def mode(a):
                v, c = np.unique(a, return_counts=True); return str(v[np.argmax(c)]) if len(v) else ""
            gs = [mode(z["gs"][m == x]) for x in um]; ms = [mode(z["ms"][m == x]) for x in um]
            gt = [mode(z["gt"][(m == x) & (z["n_tir"] > 0)]) for x in um]
            lith = dict(zip(z["lith_m"].tolist(), z["lith_c"].tolist())); raw = dict(zip(z["lith_m"].tolist(), z["lith_raw"].tolist())); au = dict(zip(z["au_m"].tolist(), z["au_ppm"].tolist()))
        metres = {"m": um.tolist(), "gs": gs, "ms": ms, "gt": gt, "lith": [labels.lith(lith.get(int(x))) for x in um], "lith_raw": [raw.get(int(x)) for x in um],
                  "au": [None if int(x) not in au else round(float(au[int(x)]), 4) for x in um], "why": [[] for _ in um]}
        np.savez_compressed(ws.proc / f"{key}.arrays.npz")
        report = {k: v for k, v in M["report"].items() if k != "qc"}; report["rules"] = labels.rules()
        return {"hole": meta, "report": report, "qc": qc, "metres": metres, "models": {}, "note": note,
                "tokens": str(ws.proc / f"{key}.npz"), "arrays": str(ws.proc / f"{key}.arrays.npz")}

    def process(self, key: str, hole: str, folders: list[Path], **kw) -> dict:
        """Clean under the training rules and run every model. A scan those rules turn away whole (chips, a mask
        that rejects nearly everything, another band grid) is cleaned again leniently and kept for display."""
        progress = kw.get("progress", lambda *a: None)
        try:
            self.clean(key, hole, folders, **kw)
        except ValueError as e:
            if not str(e).startswith("No usable core scan"):
                raise
            self.clean(key, hole, folders, lenient=True, **kw)
            pkg = self.display_package(key, str(e))
        else:
            pkg = self.run_models(key, progress=progress)
        pkg["spectral_log"] = self.logs.pop(key, None)            # the platform stores it beside the result
        return pkg
