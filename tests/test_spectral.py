"""The spectral log: weights normalised per sample, INVALID kept, samples without a result left out of the mix,
the 1 m level merged from the 0.1 m level, one dataset per bin."""
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd

from app import spectral


def _sp(depth, grp, wt, prefix="s", kind="TSAS", groups=("INVALID", "CHLORITE", "WHITE-MICA", "CARBONATE")):
    """A stand-in for a pytsg Spectra: text group scalars, float weights, a class table in TSG's order."""
    cols = {"Depth (m)": depth}
    for n in "123":
        cols[f"Grp{n} {prefix}{kind}"] = pd.Series(grp[int(n) - 1], dtype=object); cols[f"Wt{n} {prefix}{kind}"] = wt[int(n) - 1]
    bands = [SimpleNamespace(name=c, class_number=(1 if c.startswith("Grp") else -1), flag=(2 if c.startswith("Grp") else 0)) for c in cols]
    classes = {1: SimpleNamespace(name=f"{prefix}_{kind} Groups", classes=dict(enumerate(groups)))}
    return SimpleNamespace(scalars=pd.DataFrame(cols), bandheaders=bands, classes=classes)


def test_mix_is_weight_averaged_over_samples_with_a_result():
    depth = np.array([0.00, 0.01, 0.02, 0.03])
    grp = [["CHLORITE", "WHITE-MICA", "INVALID", None], ["WHITE-MICA", None, None, None], [None, None, None, None]]
    wt = [np.array([0.6, 1.0, np.nan, np.nan]), np.array([0.2, np.nan, np.nan, np.nan]), np.full(4, np.nan)]
    acc = spectral.dataset_acc(_sp(depth, grp, wt), None, "HyLogger 3")
    log = spectral.hole_log([acc])
    row = log["levels"]["0.1"][0]
    assert row["from_m"] == 0.0 and row["tir"] is None
    assert row["swir"]["n"] == 4 and row["swir"]["n_result"] == 3
    # sample 1: 0.6/0.8 chlorite + 0.2/0.8 white mica; sample 2: white mica; sample 3: INVALID with no weight -> share 1
    assert row["swir"]["mix"] == {"CHLORITE": 0.25, "WHITE-MICA": 0.417, "INVALID": 0.333}
    assert abs(sum(row["swir"]["mix"].values()) - 1) < 0.005
    assert log["swir_groups"] == ["INVALID", "CHLORITE", "WHITE-MICA"] and log["tir_groups"] == []
    assert log["levels"]["1"] == [{"from_m": 0.0, "swir": row["swir"], "tir": None}]


def test_one_metre_rows_merge_the_bins_by_n_result_and_the_user_run_is_the_fallback():
    depth = np.array([5.00, 5.01, 5.15, 5.16, 5.17, 6.95])
    grp = [["CHLORITE", "CHLORITE", "CARBONATE", "CARBONATE", "CARBONATE", "CHLORITE"], [None] * 6, [None] * 6]
    wt = [np.ones(6), np.full(6, np.nan), np.full(6, np.nan)]
    tir = _sp(depth, [["SILICA"] * 6, [None] * 6, [None] * 6], wt, prefix="u", kind="jCLST", groups=("SILICA", "K-FELDSPAR"))
    log = spectral.hole_log([spectral.dataset_acc(_sp(depth, grp, wt, prefix="u"), tir, "HyLogger 4")])
    fine = {r["from_m"]: r for r in log["levels"]["0.1"]}
    assert sorted(fine) == [5.0, 5.1, 6.9]
    assert fine[5.0]["swir"]["mix"] == {"CHLORITE": 1.0} and fine[5.1]["swir"]["mix"] == {"CARBONATE": 1.0}
    coarse = {r["from_m"]: r for r in log["levels"]["1"]}
    assert sorted(coarse) == [5.0, 6.0]
    assert coarse[5.0]["swir"] == {"n": 5, "n_result": 5, "mix": {"CHLORITE": 0.4, "CARBONATE": 0.6}}
    assert coarse[5.0]["tir"] == {"n": 5, "n_result": 5, "mix": {"SILICA": 1.0}} and log["tir_groups"] == ["SILICA"]


def test_where_datasets_overlap_the_hylogger_3_scan_is_the_one_used():
    depth = np.array([10.00, 10.05, 10.12])
    one = lambda g, k: [[g] * k, [None] * k, [None] * k]   # noqa: E731
    wt = lambda k: [np.ones(k), np.full(k, np.nan), np.full(k, np.nan)]   # noqa: E731
    h4 = spectral.dataset_acc(_sp(depth, one("CHLORITE", 3), wt(3)), None, "HyLogger 4", "a")
    h3 = spectral.dataset_acc(_sp(depth[:2], one("WHITE-MICA", 2), wt(2)), None, "HyLogger 3", "b")
    log = spectral.hole_log([h4, h3])
    fine = {r["from_m"]: r["swir"]["mix"] for r in log["levels"]["0.1"]}
    assert fine == {10.0: {"WHITE-MICA": 1.0}, 10.1: {"CHLORITE": 1.0}}
    assert log["levels"]["1"][0]["swir"] == {"n": 3, "n_result": 3, "mix": {"WHITE-MICA": 0.667, "CHLORITE": 0.333}}


def test_accumulators_survive_the_round_trip_through_json(tmp_path: Path):
    depth = np.array([0.0, 0.05]); wt = [np.ones(2), np.full(2, np.nan), np.full(2, np.nan)]
    acc = spectral.dataset_acc(_sp(depth, [["CHLORITE", "INVALID"], [None] * 2, [None] * 2], wt), None, "HyLogger 3", "x")
    spectral.save_acc(acc, tmp_path / "x.json"); back = spectral.load_acc(tmp_path / "x.json")
    assert json.loads(json.dumps(spectral.hole_log([back]))) == json.loads(json.dumps(spectral.hole_log([acc])))
    assert spectral.hole_log([spectral.dataset_acc(None, None, "HyLogger 3")]) is None
