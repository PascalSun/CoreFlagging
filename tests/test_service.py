"""What can be checked without scan files: labels, tray geometry, zip handling, similarity search on a toy library."""
import io, zipfile
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest
from PIL import Image

from app import labels, trays
from app.sources import NotHere, SourceError, unpack_spectral


def test_core_type_names_are_put_into_english():
    assert labels.core_type("石英 + 绿泥石，较多黑云母") == "Quartz + chlorite, more dark mica"
    assert labels.core_type("石英（短波红外无响应），较多白云母（Ⅱ）") == "Quartz (no SWIR response), more white mica (II)"
    assert labels.lith("镁铁质侵入岩") == "Mafic intrusive" and labels.lith(None) is None and labels.lith("未知") == "未知"


def test_every_rock_class_of_the_pipeline_has_an_english_name():
    from app.pipeline.preprocess import LITH_CLASSES
    assert {zh for zh, _ in LITH_CLASSES} == set(labels.LITH_EN)


def test_tray_index_gives_each_row_its_own_depth_range():
    sp = SimpleNamespace(sampleheaders=pd.DataFrame({"T": ["0001", "0001", "0001", "0002"], "L": ["1", "1", "2", "1"]}))
    idx = trays.index(sp, np.array([0.0, 0.9, 1.0, 5.0]))
    assert [t["n"] for t in idx] == [1, 2]
    assert idx[0]["rows"] == [{"from_m": 0.0, "to_m": 0.9}, {"from_m": 1.0, "to_m": 1.0}] and (idx[0]["from_m"], idx[0]["to_m"]) == (0.0, 1.0)


def test_layout_reads_row_boxes_from_the_photograph_comment():
    rows = trays.layout("IOL34_JID1,0002,2,1,79.9,4183,11201,370,260,721,43,10756,719,40,10753\x00")
    assert rows == [[370, 1091, 43, 10756], [1091, 1810, 40, 10753]]
    assert trays.layout("") is None and trays.layout("IOL34,1,2") is None


def _zip(tmp: Path, members: dict[str, bytes]) -> Path:
    p = tmp / "scan.zip"
    with zipfile.ZipFile(p, "w") as z:
        for k, v in members.items():
            z.writestr(k, v)
    return p


def _jpeg(comment: bytes = b"") -> bytes:
    b = io.BytesIO(); Image.new("RGB", (400, 100), (90, 80, 70)).save(b, "JPEG", comment=comment)
    return b.getvalue()


def test_photographs_are_matched_by_number_whatever_the_padding_or_spacing(tmp_path):
    z = _zip(tmp_path, {"id\\Hole 1_tsg.tsg": b"x", "id\\Hole1_0001.jpg": _jpeg(b"IOL34_J,0001,1,1,10,100,400,10,0,80,20,380"), "id\\Hole1_12.jpg": _jpeg(),
                        "id\\Hole 1_tsg_Mosaic.jpg": _jpeg()})
    idx = [{"n": 1, "from_m": 0.0, "to_m": 4.0, "rows": [{"from_m": 0.0, "to_m": 4.0}]}, {"n": 12, "from_m": 40.0, "to_m": 44.0, "rows": [{"from_m": 40.0, "to_m": 44.0}]}]
    got = {t["n"]: (t, f) for t, f in trays.extract(z, "Hole 1", idx, tmp_path / "out")}
    assert set(got) == {1, 12} and all(f.exists() for _, f in got.values())
    assert got[1][0]["rows"][0]["box"] == [0.05, 0.1, 0.95, 0.9] and "box" not in got[12][0]["rows"][0]


def test_in_a_zip_of_several_datasets_a_photograph_goes_to_its_own_dataset(tmp_path):
    z = _zip(tmp_path, {"A_tsg.tsg": b"x", "B_tsg.tsg": b"x", "A_0001.jpg": _jpeg(), "B_0001.jpg": _jpeg()})
    idx = [{"n": 1, "from_m": 0.0, "to_m": 4.0, "rows": []}]
    assert len(list(trays.extract(z, "A", idx, tmp_path / "a"))) == 1 and len(list(trays.extract(z, "C", idx, tmp_path / "c"))) == 0


def test_only_spectral_members_are_unpacked_and_paths_in_the_zip_are_ignored(tmp_path):
    z = _zip(tmp_path, {"../../evil/H_tsg.tsg": b"t", "id\\H_tsg.bip": b"b", "H_tsg_tir.tsg": b"t", "H_tsg_cras.bip": b"big", "H_0001.jpg": b"j", "H_tsg.ini": b"i"})
    out = tmp_path / "out"
    assert unpack_spectral(z, out) == 3
    assert sorted(p.name for p in out.iterdir()) == ["H_tsg.bip", "H_tsg.tsg", "H_tsg_tir.tsg"] and not (tmp_path / "evil").exists()


def test_a_file_that_is_not_a_zip_is_the_uploaders_problem_not_a_crash(tmp_path):
    p = tmp_path / "x.zip"; p.write_bytes(b"not a zip")
    with pytest.raises(SourceError):
        unpack_spectral(p, tmp_path / "out")


def test_a_zip_missing_from_this_workers_mirror_is_left_for_another_worker(tmp_path, monkeypatch):
    from app import sources
    monkeypatch.setattr(sources.C, "NVCL_ROOT", str(tmp_path))
    with pytest.raises(NotHere):
        sources.fetch({"hole": {"source": "nvcl"}, "parts": [{"ref": "ABSENT", "number": 0}]}, None, tmp_path)


def test_similar_leaves_out_the_hole_itself_and_its_neighbours_and_returns_each_hole_once():
    from app import extras
    n = 500; rng = np.random.default_rng(1); Z = rng.normal(size=(n, 4)).astype("f4"); Z /= np.linalg.norm(Z, axis=1, keepdims=True)
    hole = np.array(["SELF"] * 5 + ["NEAR"] * 5 + [f"H{i // 2}" for i in range(n - 10)])
    lat = np.full(n, -30.0, "f4"); lon = np.full(n, 120.0, "f4"); lat[:10] = -25.0; lon[5:10] = 121.0
    L = {"Z": Z, "hole": hole, "lat": lat, "lon": lon, "d0": np.zeros(n), "d1": np.full(n, 2.0), "gs": np.array(["CHLORITE"] * n), "gt": np.array([""] * n),
         "rock": np.array(["花岗岩类"] * n), "au": np.full(n, np.nan), "split": np.array(["train"] * n)}
    eng = SimpleNamespace(L=L, col_by={}, store=SimpleNamespace(ref_for=lambda h: {"region": "R"}))
    res = extras.similar(eng, Z[0], hole="self", lat=-25.0, lon=121.0, k=10)
    names = [r["hole"] for r in res]
    assert "SELF" not in names and "NEAR" not in names and len(set(names)) == len(names) == 10
    assert res[0]["rock"] == "Granitoid" and res[0]["region"] == "R" and res == sorted(res, key=lambda r: -r["sim"])
    with pytest.raises(ValueError):
        extras.similar(eng, np.zeros(7, "f4"))


def test_similar_scopes_nearby_region_and_this_hole():
    from app import extras
    n = 300; rng = np.random.default_rng(2); Z = rng.normal(size=(n, 4)).astype("f4"); Z /= np.linalg.norm(Z, axis=1, keepdims=True)
    hole = np.array(["SELF"] * 10 + ["NEAR"] * 10 + ["FAR"] * 10 + [f"H{i // 2}" for i in range(n - 30)])
    lat = np.full(n, -30.0, "f4"); lon = np.full(n, 120.0, "f4")
    lat[:10] = -25.0; lon[:10] = 121.0            # SELF
    lat[10:20] = -25.02; lon[10:20] = 121.0        # NEAR: ~2 km from SELF
    lat[20:30] = -25.5; lon[20:30] = 121.0         # FAR: ~55 km
    L = {"Z": Z, "hole": hole, "lat": lat, "lon": lon, "d0": np.arange(n, dtype="f4"), "d1": np.arange(n, dtype="f4") + 2, "gs": np.array(["CHLORITE"] * n), "gt": np.array([""] * n),
         "rock": np.array(["花岗岩类"] * n), "au": np.full(n, np.nan), "split": np.array(["train"] * n)}
    regions = {"NEAR": "A", "FAR": "B"}
    eng = SimpleNamespace(L=L, col_by={}, store=SimpleNamespace(ref_for=lambda h: {"region": regions.get(h, "C")}))
    nearby = extras.similar(eng, Z[0], hole="SELF", lat=-25.0, lon=121.0, k=10, scope="nearby", radius_km=10)
    assert [r["hole"] for r in nearby] == ["NEAR"]                                   # one interval per hole, only within 10 km
    region = extras.similar(eng, Z[0], hole="SELF", lat=-25.0, lon=121.0, k=10, scope="region", region="b")
    assert [r["hole"] for r in region] == ["FAR"]
    own = extras.similar(eng, Z[0], hole="SELF", lat=-25.0, lon=121.0, k=5, scope="hole")
    assert len(own) == 5 and {r["hole"] for r in own} == {"SELF"} and own[0]["from_m"] == 0.0   # the query interval itself comes first
    state = extras.similar(eng, Z[0], hole="SELF", lat=-25.0, lon=121.0, k=10)
    assert "SELF" not in {r["hole"] for r in state} and "NEAR" not in {r["hole"] for r in state}
    with pytest.raises(ValueError):
        extras.similar(eng, Z[0], hole="SELF", scope="nearby")


def test_linescan_decodes_only_the_chunks_of_the_window(tmp_path, monkeypatch):
    """A toy cras: 4 JPEG chunks of 10 lines, a 3-sample-per-line... the rows of a sample window come back in depth order."""
    import struct
    from simplejpeg import encode_jpeg
    from app import samples as smp
    from types import SimpleNamespace
    import pandas as pd
    ns, chunk, nchunks, specny = 8, 10, 4, 5                      # 40 lines, 8 samples of 5 lines each
    chunks = []
    for c in range(nchunks):                                       # each chunk a flat colour, stored upside down as TSG does
        img = np.full((chunk, ns, 3), 40 + 50 * c, np.uint8); img[..., 0] = 200      # stored BGR: 200 in the first channel is blue
        chunks.append(encode_jpeg(np.ascontiguousarray(np.flipud(img)), quality=100, colorspace="RGB"))
    offs = np.cumsum([0] + [len(c) for c in chunks]).astype(np.uint32)
    head = struct.pack(smp._CRAS_HEAD, b"CoreLog Linescan 1.1", ns, chunk * nchunks, 3, 2, 1, specny, 0, 0, 1, chunk, nchunks, 0, 0, 0, 0, 0)
    assert len(head) == 64
    d = tmp_path / "pkg" / "DS"; d.mkdir(parents=True)
    (d / "DS_tsg_cras.bip").write_bytes(head + offs.tobytes() + b"".join(chunks)); (d / ".ready").touch()
    monkeypatch.setattr(smp, "ROOT", tmp_path / "pkg")
    # samples at 0.1 m spacing: depth 0.0 .. 0.7
    sp = SimpleNamespace(sampleheaders=pd.DataFrame({"D": np.arange(8) * 0.1}))
    monkeypatch.setattr(smp, "_spectra_of", lambda d_, ds: sp)
    jpg = smp.linescan(["x"], "DS", 0.3, 0.5, width=0)              # samples 3 and 4 -> rows 15..24: chunk 1 (10..19) and 2 (20..29)
    from PIL import Image
    import io
    im = np.asarray(Image.open(io.BytesIO(jpg)).convert("RGB"))
    assert im.shape == (10, ns, 3)
    assert abs(int(im[0, 0, 1]) - 90) < 6 and abs(int(im[-1, 0, 1]) - 140) < 6      # top rows from chunk 1 (90), bottom from chunk 2 (140)
    assert abs(int(im[0, 0, 2]) - 200) < 6 and int(im[0, 0, 0]) < 100                 # the stored first channel is blue, so it lands in B


def test_samples_pair_each_swir_sample_with_the_nearest_tir_spectrum(tmp_path, monkeypatch):
    """The TIR file has its own sample list: a SWIR sample gets the TIR measured within 5 mm of it, or none."""
    from app import samples as smp
    from types import SimpleNamespace
    import pandas as pd
    d = tmp_path / "pkg" / "DS"; d.mkdir(parents=True); (d / ".ready").touch()
    monkeypatch.setattr(smp, "ROOT", tmp_path / "pkg")
    monkeypatch.setattr(smp, "package", lambda refs, ds: d)
    # the SWIR run: groups coded through the file's class table (as TSG writes them), two minerals on the first sample
    swir = SimpleNamespace(sampleheaders=pd.DataFrame({"D": [1.000, 1.008, 1.016], "T": ["t1"] * 3, "L": ["1"] * 3, "X": [0.0, 8.0, 16.0]}),
                           scalars=pd.DataFrame({"Grp1 sTSAS": np.array([5.0, -3.4e38, 2.0], np.float32), "Min1 sTSAS": ["Chlorite-Fe", "", "Phengite"], "Wt1 sTSAS": np.array([0.7, -3.4e38, 1.0], np.float32),
                                                 "Grp2 sTSAS": np.array([2.0, -3.4e38, -3.4e38], np.float32), "Min2 sTSAS": ["Muscovite", "", ""], "Wt2 sTSAS": np.array([0.3, -3.4e38, -3.4e38], np.float32)}),
                           classes={0: SimpleNamespace(name="S_SWIR_TSA705 Groups", classes={2: "WHITE-MICA", 5: "CHLORITE"})},
                           spectra=np.ones((3, 4)), wavelength=np.array([400.0, 1000.0, 2000.0, 2500.0]))
    # the TIR run: jCLST columns, names in the clear
    tir = SimpleNamespace(sampleheaders=pd.DataFrame({"D": [1.001, 1.030]}), spectra=np.array([[0.1, 0.2], [0.3, 0.4]]), wavelength=np.array([6000.0, 14000.0]),
                          scalars=pd.DataFrame({"Min1 sjCLST": ["Quartz", "Albite"], "Grp1 sjCLST": ["SILICA", "PLAGIOCLASE"], "Wt1 sjCLST": np.array([0.9, 1.0], np.float32)}), classes={})
    monkeypatch.setattr(smp, "_spectra_of", lambda d_, ds: swir)
    monkeypatch.setattr(smp, "_tir_of", lambda d_, ds: tir)
    out = smp.samples(["x"], "DS", 0.0, 2.0, spectra=True)
    assert out["tir_wl"] == [6000.0, 14000.0]
    assert [r["tir"] for r in out["samples"]] == [[0.1, 0.2], None, None]     # 1.000 ↔ 1.001; 1.008 and 1.016 are > 5 mm from either
    assert [(r["tir_mineral"], r["tir_group"]) for r in out["samples"]] == [("Quartz", "SILICA"), ("", ""), ("", "")]
    assert out["samples"][0]["tir_mix"] == [["SILICA", "Quartz", 0.9]]
    assert out["samples"][0]["swir_mix"] == [["CHLORITE", "Chlorite-Fe", 0.7], ["WHITE-MICA", "Muscovite", 0.3]]   # the coded group read through the class table
    assert (out["samples"][0]["group"], out["samples"][0]["mineral"], out["samples"][0]["weight"]) == ("CHLORITE", "Chlorite-Fe", 0.7)
    assert out["samples"][1]["swir_mix"] == [] and out["samples"][1]["group"] == ""                                 # nothing read there
    assert out["samples"][2]["swir_mix"] == [["WHITE-MICA", "Phengite", 1.0]]
    plain = smp.samples(["x"], "DS", 0.0, 2.0)
    assert "tir" not in plain["samples"][0] and "tir_wl" not in plain
    assert plain["samples"][0]["tir_mineral"] == "Quartz"          # the TIR mineral comes without the spectra too


def test_token_scores_backfill_runs_the_models_on_the_platforms_tokens_and_cleans_up(tmp_path):
    from app import extras, token_scores
    from app.workspace import Workspace
    ws = Workspace(tmp_path); n = 25
    R = {"lc_pct": np.linspace(0, 1, n), "lc": np.linspace(0, 4, n)}
    eng = SimpleNamespace(compute=lambda key: R)
    anom, raw = extras.token_arrays(eng, "H1")
    assert anom.dtype == np.dtype("<f4") and raw.dtype == np.dtype("<f4") and len(anom) == len(raw) == n and anom[-1] == 1.0
    forgotten = []
    runner = SimpleNamespace(ws=ws, models=SimpleNamespace(dirs={"v2": None, "v9": None}, get=lambda run: eng), forget=lambda key: (ws.remove(key), forgotten.append(key)))
    sent = {}

    class FakePlatform:
        def __init__(self, runs):
            self.runs = runs
        def hole(self, key):
            return None if key == "GONE" else {"meta": {"hole": key}, "report": {}, "runs": self.runs}
        def hole_tokens(self, key, dest):
            np.savez(dest, bin=np.arange(n)); return True
        def token_scores(self, key, arrays):
            with np.load(arrays) as z:
                sent[key] = sorted(z.files)
            return True

    assert token_scores.one("GONE", runner, FakePlatform({}), False) == "not on the platform"
    assert token_scores.one("H0", runner, FakePlatform({}), False) == "no models"
    assert token_scores.one("H1", runner, FakePlatform({"v2": {"token_scores": True}}), False) == "has them"
    assert token_scores.one("H1", runner, FakePlatform({"v2": {"token_scores": True}}), True) == "sent"
    assert sent["H1"] == ["anom__v2", "raw__v2"]
    # only the runs this service has models for, and only those still missing scores
    assert token_scores.one("H2", runner, FakePlatform({"v2": {"token_scores": False}, "v9": {"token_scores": True}, "old": {"token_scores": False}}), False) == "sent"
    assert sent["H2"] == ["anom__v2", "raw__v2"]
    assert not list(ws.proc.iterdir())                       # the platform is the record: nothing kept
    assert forgotten == ["H1", "H2"]                         # ... and the engines forget the hole too


def test_models_forget_drops_a_hole_from_every_engines_cache():
    import threading
    from app.pipeline.engine import Models
    e = SimpleNamespace(cache={"H1": {"F": 1}, "H2": {}}, timing={"H1": 2.0}, locks={"H1": threading.Lock()}, _llock=threading.Lock())
    m = Models.__new__(Models); m._e = {"v2": e}
    m.forget("H1"); m.forget("nothing")
    assert e.cache == {"H2": {}} and e.timing == {} and e.locks == {}


def test_metre_vectors_are_the_2m_fingerprints_standardised_against_the_library():
    from app.pipeline.engine import metre_vectors, window_vector
    depth = np.arange(0, 4.0, 0.1, dtype="f4")                                  # 40 tokens: metres 0-3
    F = np.zeros((40, 3), "f4"); F[:, 0] = np.arange(40); F[:, 1] = 1.0           # a ramp and a constant
    R = {"depth": depth, "F": F, "order": np.arange(40), "metres": np.array([0, 1, 2, 3])}
    H = {"i_mu": np.array([10.0, 1.0, 0.0], "f4"), "i_sd": np.array([5.0, 1.0, 1.0], "f4")}
    um, V = metre_vectors(R, H)
    assert um.tolist() == [0, 1, 2, 3] and V.shape == (4, 3)
    np.testing.assert_allclose(np.linalg.norm(V, axis=1), 1.0, atol=1e-5)
    # metre 1: tokens 10..29 (the 2 m from 1.0 m), mean of the ramp 19.5 -> (19.5-10)/5 = 1.9; the constant standardises to 0
    np.testing.assert_allclose(V[1] * np.hypot(1.9, 0), [1.9, 0, 0], atol=1e-4)
    # the last metre cannot start a full 2 m window: it slides back so the window still holds 20 tokens (as the search does)
    np.testing.assert_allclose(V[3], V[2], atol=1e-5)
    # a window asked for by depth: [1, 3) is exactly metre 1's window; a window shorter than 2 m widens to 2 m from its start
    np.testing.assert_allclose(window_vector(R, H, 1, 3), V[1], atol=1e-5)
    np.testing.assert_allclose(window_vector(R, H, 1, 1.5), V[1], atol=1e-5)


def test_metre_arrays_fingerprint_is_the_metre_vector(monkeypatch):
    from app import extras
    depth = np.arange(0, 4.0, 0.1, dtype="f4"); F = np.zeros((40, 2), "f4"); F[:, 0] = np.arange(40)
    R = {"depth": depth, "F": F, "order": np.arange(40), "metres": np.array([0, 1, 2, 3]), "tir_pred": np.ones((40, 2), "f4")}
    H = {"i_mu": np.array([0.0, 0.0], "f4"), "i_sd": np.array([1.0, 1.0], "f4")}
    eng = SimpleNamespace(compute=lambda key: R, H=H)
    tir, fp = extras.metre_arrays(eng, "h")
    assert tir.shape == (4, 2) and fp.shape == (4, 2)
    np.testing.assert_allclose(fp[0], [1, 0], atol=1e-5)                       # the ramp only: unit vector along it
