"""TSG files -> raw layout -> preprocess, compared with the demo's processed hole."""
import sys, json, tempfile, time, numpy as np
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from app.pipeline import tsg, preprocess
tsg_root, seed, holes = Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4:]
ref = {r["hole"]: r for r in json.loads((seed.parent / "reference/holes_ref.json").read_text())}
import re
cat = json.loads(Path(sys.argv[2]).parent.joinpath("nvclref/all_datasets.json").read_text())["datasetCollection"]
META = {c["datasetName"]: {t: (m.group(1) if (m := re.search(rf"<{t}>(.*?)</{t}>", c["description"] or "", re.S)) else None) for t in tsg.META_TAGS} for c in cat}
for hole in holes:
    t0 = time.time()
    with tempfile.TemporaryDirectory() as td:
        hd = tsg.write_hole(hole, [tsg_root / hole], Path(td) / "raw", META); out = preprocess.preprocess_hole(hd, Path(td) / "proc", ref.get(hole))
        a = np.load(Path(td) / "proc" / f"{hole}.npz"); b = np.load(seed / f"{hole}.npz")
        res = []
        for k in b.files:
            x, y = a[k], b[k]
            if x.shape != y.shape: res.append(f"{k}: SHAPE {x.shape} vs {y.shape}"); continue
            if x.dtype.kind in "fc":
                d = np.abs(x.astype("f8") - y.astype("f8")); res.append(f"{k}: max|d|={d.max() if d.size else 0:.3g} n_diff={(d > 0).sum()}")
            else:
                res.append(f"{k}: n_diff={(x != y).sum()}/{x.size}")
        js = json.loads((seed / f"{hole}.json").read_text())
        fa, fb = out["report"]["funnel"], js["report"]["funnel"]
        qa = sorted((q["issue"], q["depth_from"]) for q in out["report"]["qc"]); qb = sorted((q["issue"], q["depth_from"]) for q in js["report"]["qc"])
        print(f"== {hole} {time.time() - t0:.0f}s\n  " + "\n  ".join(res)); print("  funnel same:", fa == fb, {k: (fa[k], fb[k]) for k in fa if fa[k] != fb.get(k)}); print("  qc same:", qa == qb, set(qa) ^ set(qb))
