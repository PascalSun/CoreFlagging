"""The platform, as this service sees it: a job queue to take from and a place to hand results to."""
from __future__ import annotations

import json
from urllib.parse import quote
from pathlib import Path

import httpx

from .pipeline import config as C


class Platform:
    def __init__(self, url: str = C.PLATFORM_API_URL, token: str = C.PLATFORM_API_TOKEN):
        if not url or not token:
            raise RuntimeError("PLATFORM_API_URL and PLATFORM_API_TOKEN are required")
        self.http = httpx.Client(base_url=f"{url}/core-scan/api/service/", headers={"Authorization": f"Token {token}"}, timeout=httpx.Timeout(120, read=600, write=600))

    def announce_models(self, models: list[dict]) -> None:
        self.http.put("models/", json={"models": models}).raise_for_status()

    def register(self, holes: list[dict], requeue: bool = False) -> dict:
        r = self.http.post("register/", json={"holes": holes, "requeue": requeue}); r.raise_for_status()
        return r.json()

    def claim(self, worker: str, sources: list[str]) -> dict | None:
        r = self.http.post("jobs/claim/", json={"worker": worker, "sources": sources})
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    def heartbeat(self, job: dict, **kw) -> bool:
        r = self.http.post(f"jobs/{job['job']}/heartbeat/", json={"token": job["token"], **{k: v for k, v in kw.items() if v is not None}})
        return r.status_code == 200

    def fail(self, job: dict, error: str, transient: bool = False) -> None:
        self.http.post(f"jobs/{job['job']}/fail/", json={"token": job["token"], "error": error, "transient": transient})

    def download_source(self, job: dict, dest: Path) -> None:
        with self.http.stream("GET", f"jobs/{job['job']}/source/") as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)

    def tray(self, job: dict, dataset: str, tray: dict, jpeg: Path) -> None:
        with open(jpeg, "rb") as f:
            r = self.http.post(f"jobs/{job['job']}/trays/", data={"token": job["token"], "dataset": dataset, "tray": json.dumps(tray)}, files={"image": (jpeg.name, f, "image/jpeg")})
        r.raise_for_status()

    def tray_rows(self, key: str, trays: list[dict]) -> int:
        r = self.http.post(f"holes/{quote(key, safe='')}/tray-rows/", json={"trays": trays}); r.raise_for_status()
        return int(r.json().get("updated", 0))

    def spectral_log(self, key: str, log: dict) -> bool:
        """Hand the platform a hole's spectral log on its own (the backfill). False when the platform has no such hole."""
        body = json.dumps(log, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o)).encode()
        r = self.http.post(f"holes/{quote(key, safe='')}/spectral-log/", files={"log": ("log.json", body, "application/json")})
        if r.status_code == 404:
            return False
        r.raise_for_status()
        return True

    def hole(self, key: str) -> dict | None:
        """{meta, report, runs: {run: {token_scores: bool}}} of a processed hole, or None when the platform has no such hole."""
        r = self.http.get(f"holes/{quote(key, safe='')}/")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    def hole_tokens(self, key: str, dest: Path) -> bool:
        """The hole's tokens as the service's processed .npz, written to `dest`. False when the platform has no such hole."""
        with self.http.stream("GET", f"holes/{quote(key, safe='')}/", params={"part": "tokens"}) as r:
            if r.status_code == 404:
                return False
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        return True

    def token_scores(self, key: str, arrays: Path) -> bool:
        """Hand the platform a hole's per-token unusual scores on their own (the backfill). False when the hole, or a result
        for these runs, is not on the platform."""
        with open(arrays, "rb") as f:
            r = self.http.post(f"holes/{quote(key, safe='')}/token-scores/", files={"arrays": ("arrays.npz", f, "application/octet-stream")})
        if r.status_code == 404:
            return False
        r.raise_for_status()
        return True

    def done(self, job: dict) -> None:
        self.http.post(f"jobs/{job['job']}/done/", json={"token": job["token"]}).raise_for_status()

    def result(self, job: dict, package: dict) -> None:
        pkg = {k: v for k, v in package.items() if k not in ("tokens", "arrays")}
        body = json.dumps(pkg, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o)).encode()
        with open(package["tokens"], "rb") as tok, open(package["arrays"], "rb") as arr:
            r = self.http.post(f"jobs/{job['job']}/result/", data={"token": job["token"], "more": "1"},
                               files={"package": ("package.json", body, "application/json"), "tokens": ("tokens.npz", tok, "application/octet-stream"),
                                      "arrays": ("arrays.npz", arr, "application/octet-stream")})
        if r.status_code != 200:
            raise RuntimeError(f"the platform refused the result ({r.status_code}): {r.text[:500]}")
