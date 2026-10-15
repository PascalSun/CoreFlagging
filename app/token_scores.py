"""The backfill of per-token unusual scores: holes the models read before the service sent the score of every 10 cm
token get it now, without touching the TSG files. The platform keeps every hole's tokens, so for each hole the tokens
come back as the processed .npz, the models run on them (the same code as a job), and anom__<run> / raw__<run> go up.

  backfill(keys, runner)   every key -> one of 'sent', 'has them', 'no models', 'not on the platform' or an error
"""
from __future__ import annotations

import json, logging

import numpy as np

from . import extras
from .platform import Platform

log = logging.getLogger("coretrace.token_scores")


def one(key: str, runner, pf: Platform, force: bool = False) -> str:
    """One hole, start to finish. The processed files and the engines' memory of the hole are dropped again: the platform
    is the record (and 1,500 holes kept in memory were what the OOM killer took on 2026-10-15)."""
    ws = runner.ws; h = pf.hole(key)
    if h is None:
        return "not on the platform"
    runs = [r for r in (h.get("runs") or {}) if r in runner.models.dirs and (force or not h["runs"][r].get("token_scores"))]
    if not h.get("runs"):
        return "no models"
    if not runs:
        return "has them"
    try:
        if not pf.hole_tokens(key, ws.proc / f"{key}.npz"):
            return "not on the platform"
        (ws.proc / f"{key}.json").write_text(json.dumps({"meta": h["meta"], "report": h["report"]}))
        arrays = {}
        for run in runs:
            arrays[f"anom__{run}"], arrays[f"raw__{run}"], arrays[f"core__{run}"] = extras.token_arrays(runner.models.get(run), key)
        np.savez_compressed(ws.proc / f"{key}.arrays.npz", **arrays)
        return "sent" if pf.token_scores(key, ws.proc / f"{key}.arrays.npz") else "not on the platform"
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
