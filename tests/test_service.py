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
        img = np.full((chunk, ns, 3), 40 + 50 * c, np.uint8)
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
    assert abs(int(im[0, 0, 0]) - 90) < 6 and abs(int(im[-1, 0, 0]) - 140) < 6      # top rows from chunk 1 (90), bottom from chunk 2 (140)
