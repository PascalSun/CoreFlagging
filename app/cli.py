"""Command line.

  python -m app.cli process <hole> <folder> [<folder> ...]   run one hole from TSG folders, write the package to ./work
  python -m app.cli register [--requeue]                      tell the platform about every hole in the NVCL mirror
  python -m app.cli tray-mm [--only ...]                      give stored tray rows their positions along the scan (reads .tsg headers only)
  python -m app.cli spectral-log [--only ...] [--state WA]    hand the platform each mirrored hole's spectral log (reads TSG scalars only)
  python -m app.cli work [--once]                             take jobs from the platform (no HTTP server); --once stops when the queue is empty
"""
from __future__ import annotations

import argparse, json, logging
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(prog="coretrace"); sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("process"); p.add_argument("hole"); p.add_argument("folders", nargs="+")
    r = sub.add_parser("register"); r.add_argument("--requeue", action="store_true"); r.add_argument("--only", nargs="*", default=[])
    w = sub.add_parser("work"); w.add_argument("--once", action="store_true")
    tm = sub.add_parser("tray-mm"); tm.add_argument("--only", nargs="*", default=[]); tm.add_argument("--threads", type=int, default=8)
    sl = sub.add_parser("spectral-log"); sl.add_argument("--only", nargs="*", default=[]); sl.add_argument("--state", nargs="*", default=[]); sl.add_argument("--workers", type=int, default=4)
    a = ap.parse_args(); logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    if a.cmd == "register":
        from .platform import Platform
        from .sources import holes_in_catalogue
        holes = holes_in_catalogue()
        if a.only:
            want = {x.lower() for x in a.only}; holes = [h for h in holes if h["name"].lower() in want or h["key"].lower() in want]
        pf = Platform(); out = {"created": 0, "queued": 0}
        for i in range(0, len(holes), 200):
            res = pf.register(holes[i:i + 200], requeue=a.requeue); out = {k: out[k] + res[k] for k in out}
        print(json.dumps({"holes": len(holes), **out})); return
    if a.cmd == "tray-mm":
        from .platform import Platform
        from .sources import holes_in_catalogue
        from .traymm import backfill
        holes = holes_in_catalogue()
        if a.only:
            want = {x.lower() for x in a.only}; holes = [h for h in holes if h["key"].lower() in want]
        print(json.dumps(backfill(holes, Platform(), a.threads))); return
    if a.cmd == "spectral-log":
        from .sources import holes_in_catalogue
        from .spectral import backfill
        holes = holes_in_catalogue()
        if a.only:
            want = {x.lower() for x in a.only}; holes = [h for h in holes if h["key"].lower() in want]
        if a.state:
            want = {x.upper() for x in a.state}; holes = [h for h in holes if h["state"].upper() in want]
        print(json.dumps(backfill(holes, a.workers))); return
    from .runner import Runner
    runner = Runner()
    if a.cmd == "process":
        pkg = runner.process(a.hole, a.hole, [Path(f) for f in a.folders], progress=lambda s, m, f=None: print(f"[{s}] {m}"))
        out = runner.ws.root / f"{a.hole}.package.json"; out.write_text(json.dumps(pkg, ensure_ascii=False, default=str)); print(out)
    else:
        from .worker import Worker
        wk = Worker(runner); wk.announce()
        wk.loop(until_idle=a.once)


if __name__ == "__main__":
    main()
