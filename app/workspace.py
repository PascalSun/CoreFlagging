"""The service's local working directory.

Nothing in it is the record: the platform database holds every hole, its 10 cm tokens and its results. This folder
is where a hole is unpacked, cleaned and run through the models, and where processed holes are kept so the two live
questions (spectra around one metre, similar core elsewhere) do not refetch them. It can be deleted at any time.

  raw/<key>/              TSG scan rewritten in the raw-hole layout (removed once the hole is processed)
  processed/<key>.npz     10 cm tokens + logs;  <key>.json  metadata + cleaning report + quality issues
  results/<run>/<key>.pkl model outputs per model
"""
from __future__ import annotations

import json, shutil, threading
from pathlib import Path

from .pipeline import config as C


class Workspace:
    def __init__(self, root: Path = C.DATA, reference: Path = C.REFERENCE):
        self.root = Path(root); self.raw, self.proc, self.res = (self.root / x for x in ("raw", "processed", "results"))
        for d in (self.raw, self.proc, self.res):
            d.mkdir(parents=True, exist_ok=True)
        self.ref_dir = Path(reference); self.lock = threading.RLock()
        f = self.ref_dir / "holes_ref.json"
        self.ref = {r["hole"]: r for r in json.loads(f.read_text())} if f.exists() else {}
        self._ref_lower = {h.lower(): r for h, r in self.ref.items()}

    @property
    def cat(self) -> set[str]:
        """Holes held locally (the engine only asks whether a hole is in here)."""
        return {p.stem for p in self.proc.glob("*.json")}

    def ref_for(self, hole: str) -> dict | None:
        """The State reference row (collar, operator, region, training split) of an NVCL hole, matched without case."""
        return self.ref.get(hole) or self._ref_lower.get(hole.lower())

    def has(self, key: str) -> bool:
        return (self.proc / f"{key}.npz").exists() and (self.proc / f"{key}.json").exists()

    def meta(self, key: str) -> dict:
        return json.loads((self.proc / f"{key}.json").read_text())

    def remove(self, key: str) -> None:
        with self.lock:
            for p in [self.proc / f"{key}.npz", self.proc / f"{key}.arrays.npz", self.proc / f"{key}.json", *self.res.glob(f"*/{key}.pkl")]:
                p.unlink(missing_ok=True)
            shutil.rmtree(self.raw / key, ignore_errors=True)
