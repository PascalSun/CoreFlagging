"""The per-metre vectors, for every hole already on the platform.

Two jobs share one loop: a hole's tokens come back from the platform as the processed .npz, the models run on them
(the same code as a job), and the metre vectors (engine.metre_vectors) go

  * up to the platform, one row per metre per model (`backfill`): the hole-to-hole match and the window search read
    them from there; or
  * into a library file for Similar core (`build_library`): one row per metre of every hole of a State, with the labels
    the result list shows (the TSA mineral groups, the logged rock, the gold assay).

As in token_scores, the processed files and the engines' memory of a hole are dropped again after each hole.
"""
from __future__ import annotations

import json, logging
from pathlib import Path

import numpy as np

from . import extras
from .pipeline.engine import _mode, metre_vectors
from .platform import Platform

log = logging.getLogger("coretrace.fingerprints")


def _fetch(key: str, runner, pf: Platform) -> dict | None:
    """The platform's record of a processed hole, with its tokens written into the workspace. None when it has no such hole."""
    ws = runner.ws; h = pf.hole(key)
    if h is None or not h.get("runs"):
        return None
    if not pf.hole_tokens(key, ws.proc / f"{key}.npz"):
        return None
    (ws.proc / f"{key}.json").write_text(json.dumps({"meta": h["meta"], "report": h["report"]}))
    return h


def one(key: str, runner, pf: Platform, force: bool = False) -> str:
    """One hole's metre vectors, for every model the platform has a result for, handed to the platform."""
    h = pf.hole(key)
    if h is None:
        return "not on the platform"
    if not h.get("runs"):
        return "no models"
    runs = [r for r in h["runs"] if r in runner.models.dirs and (force or not h["runs"][r].get("fp_1m"))]
    if not runs:
        return "has them"
    try:
        if _fetch(key, runner, pf) is None:
            return "not on the platform"
        arrays = {}
        for run in runs:
            _, fp = extras.metre_arrays(runner.models.get(run), key)
            arrays[f"fp__{run}"] = fp.astype("<f4")
        out = runner.ws.proc / f"{key}.arrays.npz"; np.savez_compressed(out, **arrays)
        return "sent" if pf.fingerprints(key, out) else "not on the platform"
    finally:
        runner.forget(key)


def backfill(keys: list[str], runner, force: bool = False) -> dict:
    pf = Platform(); out: dict[str, int] = {}
    for i, key in enumerate(keys, 1):
        try:
            res = one(key, runner, pf, force)
        except Exception as e:                                # noqa: BLE001 - one hole never stops the rest
            res = f"error: {type(e).__name__}: {e}"
        kind = "error" if res.startswith("error") else res
        out[kind] = out.get(kind, 0) + 1
        if kind in ("error", "not on the platform"):
            log.warning("%s: %s", key, res)
        if i % 50 == 0:
            log.info("%d of %d holes: %s", i, len(keys), out)
    return {"holes": len(keys), **out}


def library_rows(key: str, name: str, runner, pf: Platform, run: str) -> dict | None:
    """One hole's rows for the library: its metre vectors and, per metre, the labels Similar core lists."""
    if _fetch(key, runner, pf) is None:
        return None
    try:
        eng = runner.models.get(run); R = eng.compute(key); um, V = metre_vectors(R)
        m = np.floor(R["depth"]).astype(int)
        gs = [_mode(R["gs"][m == mm]) if (m == mm).any() else "" for mm in um]
        gt = [_mode(R["gt"][(m == mm) & R["has_t"]]) if ((m == mm) & R["has_t"]).any() else "" for mm in um]
        lith = dict(zip(R["lith_m"].tolist(), R["lith_c"].tolist())); au = dict(zip(R["au_m"].tolist(), R["au_ppm"].tolist()))
        ref = runner.ws.ref_for(name) or {}
        return {"Z": V.astype("<f2"), "hole": np.array([name] * len(um)), "d0": um.astype("f4"), "d1": (um + 1).astype("f4"),
                "gs": np.array(gs), "gt": np.array(gt), "rock": np.array([lith.get(int(mm), "") or "" for mm in um]),
                "au": np.array([au.get(int(mm), np.nan) for mm in um], "f4"), "split": np.array([ref.get("split") or ""] * len(um)),
                "group": np.zeros(len(um), "i4")}
    finally:
        runner.forget(key)


def build_library(holes: list[dict], runner, run: str, out: Path) -> dict:
    """Every metre of `holes` ([{key, name}]) for model `run` -> `out` (.npz in the layout the engine loads)."""
    pf = Platform(); parts = []; n_err = 0; n_missing = 0
    for i, h in enumerate(holes, 1):
        try:
            rows = library_rows(h["key"], h["name"], runner, pf, run)
        except Exception as e:                                # noqa: BLE001
            log.warning("%s: %s: %s", h["key"], type(e).__name__, e); n_err += 1; continue
        if rows is None:
            n_missing += 1; continue
        parts.append(rows)
        if i % 50 == 0:
            log.info("%d of %d holes, %d metres so far", i, len(holes), sum(len(p["hole"]) for p in parts))
    if not parts:
        raise RuntimeError("no hole gave any metre")
    lib = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
    out = Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, **lib)
    return {"holes": len(parts), "metres": int(len(lib["hole"])), "errors": n_err, "not_on_platform": n_missing, "file": str(out)}
