"""Sample sheets, upload refs and TSG samples, on toy packages."""
import struct, zipfile
from pathlib import Path
from types import SimpleNamespace

import httpx
import numpy as np
import pandas as pd
import pytest

from app import samples as smp, sheets


# ---------------------------------------------------------------------------------------------- request checking

def test_a_request_is_checked_and_filled_with_defaults():
    r = sheets.check({"intervals": [{"from_m": 1, "to_m": 2}]})
    assert r["intervals"] == [{"label": "1–2 m", "from_m": 1.0, "to_m": 2.0}] and r["results"] == "auto" and r["min_share"] == 0.05 and r["swir"] and r["tir"]
    for bad in ({"intervals": []}, {"intervals": [{"from_m": 2, "to_m": 2}]}, {"intervals": [{"from_m": 0, "to_m": 20.5}]},
                {"intervals": [{"from_m": 0, "to_m": 1}] * 301}, {"intervals": [{"from_m": 0}]}, {"intervals": [{"from_m": 0, "to_m": 1}], "results": "mine"},
                {"intervals": [{"from_m": 0, "to_m": 1}], "min_share": 0.9}, {"intervals": [{"from_m": 0, "to_m": 1}], "swir": False, "tir": False}):
        with pytest.raises(sheets.BadRequest):
            sheets.check(bad)


# ---------------------------------------------------------------------------------------------- shares

def _ranks(rows):
    """[[(g, m, w), ...] per sample] -> G, M, W arrays of 3 ranks."""
    n = len(rows); G = np.full((3, n), "", object); M = np.full((3, n), "", object); W = np.zeros((3, n))
    for i, r in enumerate(rows):
        for k, (g, m, w) in enumerate(r):
            G[k, i], M[k, i], W[k, i] = g, m, w
    return G, M, W


def test_shares_weight_each_spectrum_once_and_fold_small_groups_and_minerals():
    G, M, W = _ranks([[("CHLORITE", "Chlorite-Fe", 0.7), ("WHITE-MICA", "Muscovite", 0.3)]] * 6 + [[("WHITE-MICA", "Phengite", 1.0)]] * 3 +
                     [[("INVALID", "Aspectral", 1.0)]] + [[("SULPHATE", "Gypsum", 0.4)]])     # 0.6 of the last spectrum unread
    out = sheets.shares(G, M, W, np.arange(11), 0.05, sheets.NO_SWIR)
    assert [(d["group"], round(d["share"] * 11, 6)) for d in out] == [("WHITE-MICA", 4.8), ("CHLORITE", 4.2), (sheets.OTHER, 0.4),   # SULPHATE 3.6 % folds
                                                                     (sheets.NO_SWIR, 1.0), (sheets.NO_RESULT, 0.6)]                   # grey wedges last
    assert abs(sum(d["share"] for d in out) - 1) < 1e-9                     # every spectrum is accounted for
    assert out[0]["minerals"] == [("Phengite", pytest.approx(3 / 11)), ("Muscovite", pytest.approx(1.8 / 11))]
    assert [d["group"] for d in sheets.shares(G, M, W, np.arange(11), 0.0, sheets.NO_SWIR)][:3] == ["WHITE-MICA", "CHLORITE", "SULPHATE"]


def test_minerals_below_the_share_fold_into_n_more():
    G, M, W = _ranks([[("CHLORITE", "Chlorite-Fe", 1.0)]] * 90 + [[("CHLORITE", "Chlorite-Mg", 1.0)]] * 4 + [[("CHLORITE", "Clinochlore", 1.0)]] * 6)
    out = sheets.shares(G, M, W, np.arange(100), 0.05, sheets.NO_SWIR)
    assert out == [{"group": "CHLORITE", "share": 1.0, "minerals": [("Chlorite-Fe", 0.9), ("Clinochlore", 0.06), ("+1 more", pytest.approx(0.04))]}]
    assert sheets.shares(G, M, W, np.arange(0), 0.05, sheets.NO_SWIR) == []


def test_the_dominant_group_is_the_heaviest_rank_and_tir_samples_pair_within_5_mm():
    G, _, W = _ranks([[("A", "a", 0.3), ("B", "b", 0.7)], [("C", "c", 1.0)], []])
    assert sheets.dominant(G, W, np.arange(3)).tolist() == ["B", "C", ""]
    src = np.array([1.000, 1.008, 1.016, 0.990])
    assert sheets.nearest(src, np.array([1.030, 1.001, 0.991])).tolist() == [1, -1, -1, 2]    # unsorted target list


def test_class_colours_are_read_from_the_tsg_file(tmp_path):
    t = tmp_path / "H_tsg.tsg"
    t.write_text("[class 1]\nname = S_SWIR_TSA705 Groups\nmax = 2\ncolours = 255 65280\n0:SILICA\n1:CHLORITE\n[class 2]\nname = x\nmax = 0\n")
    assert sheets.class_colours(t) == {1: {"SILICA": "#ff0000", "CHLORITE": "#00ff00"}}
    pal = sheets.Palette({"SILICA": "#ff0000"})
    assert pal("silica") == "#ff0000" and pal("INVALID") == sheets.GREY and pal("NEWGROUP") == sheets.PALETTE[0] and pal("NEWGROUP") == sheets.PALETTE[0]


# ---------------------------------------------------------------------------------------------- the line scan

def _cras(path: Path, n_samples: int, specny: int, chunk: int, ns: int = 64) -> None:
    """A toy cras: sample k is a flat grey of 8*k (green channel), chunks stored upside down as TSG does."""
    from simplejpeg import encode_jpeg
    nl = n_samples * specny; img = np.zeros((nl, ns, 3), np.uint8)
    for k in range(n_samples):
        img[k * specny:(k + 1) * specny, :, 1] = (8 * k) % 256
    chunks = [encode_jpeg(np.ascontiguousarray(np.flipud(img[c:c + chunk])), quality=100, colorspace="RGB") for c in range(0, nl, chunk)]
    offs = np.cumsum([0] + [len(c) for c in chunks]).astype(np.uint32)
    head = struct.pack(smp._CRAS_HEAD, b"CoreLog Linescan 1.1", ns, nl, 3, 2, 1, specny, 0, 0, 1, chunk, len(chunks), 0, 0, 0, 0, 0)
    path.write_bytes(head + offs.tobytes() + b"".join(chunks))


@pytest.mark.parametrize("factor", [1, 2, 4, 8])
def test_the_strip_is_linear_in_sample_index_at_every_decode_scale(tmp_path, factor):
    p = tmp_path / "H_tsg_cras.bip"; _cras(p, 30, 16, 64)
    a = smp.cras_rows(p, 5, 17, factor)                       # samples 5..16: 12 samples, crossing chunk borders
    per = 16 // factor
    assert a.shape[0] == 12 * per and a.shape[1] == 64 // factor
    mids = a[per // 2::per, a.shape[1] // 2, 1].astype(int)   # the middle row of each sample's band
    assert np.all(np.abs(mids - 8 * np.arange(5, 17)) <= 4)


@pytest.mark.parametrize("factor", [2, 4, 8])
def test_the_last_short_chunk_decodes_at_the_same_scale(tmp_path, factor):
    # 29 samples x 16 rows = 464 rows in chunks of 64: the last chunk holds 16 rows. Asked for a full chunk's height,
    # libjpeg left it full width and the strip to the end of the hole would not stack (a 502 on the live site).
    p = tmp_path / "H_tsg_cras.bip"; _cras(p, 29, 16, 64)
    a = smp.cras_rows(p, 20, 29, factor)
    per = 16 // factor
    assert a.shape[:2] == (9 * per, 64 // factor)
    assert np.all(np.abs(a[per // 2::per, a.shape[1] // 2, 1].astype(int) - 8 * np.arange(20, 29)) <= 4)


# ---------------------------------------------------------------------------------------------- upload refs

def _zipped(tmp: Path, members: dict[str, bytes]) -> bytes:
    p = tmp / "src.zip"
    with zipfile.ZipFile(p, "w") as z:
        for k, v in members.items():
            z.writestr(k, v)
    return p.read_bytes()


def _platform(monkeypatch, handler):
    from app import platform as plat
    real = plat.Platform
    def make():
        p = real("http://platform", "tok")
        p.http = httpx.Client(base_url="http://platform/core-scan/api/service/", headers={"Authorization": "Token tok"}, transport=httpx.MockTransport(handler))
        return p
    monkeypatch.setattr(plat, "Platform", make)


def test_an_upload_ref_fetches_the_kept_zip_from_the_platform(tmp_path, monkeypatch):
    body = _zipped(tmp_path, {"x\\DDH-1_tsg.tsg": b"t", "x\\DDH-1_tsg.bip": b"b", "x\\DDH-1_tsg_cras.bip": b"c", "x\\DDH-1_0001.jpg": b"j"})
    seen = []
    def handler(req):
        seen.append((req.url.path, req.headers.get("authorization")))
        return httpx.Response(200, content=body) if "K1" in req.url.path else httpx.Response(404)
    _platform(monkeypatch, handler); monkeypatch.setattr(smp, "ROOT", tmp_path / "pkg")
    d = smp.package(["upload:K1"], "DDH-1")
    assert seen == [("/core-scan/api/service/holes/K1/package.zip", "Token tok")]
    assert d.name == "upload-K1-DDH-1" and sorted(p.name for p in d.iterdir()) == [".ready", "DDH-1_tsg.bip", "DDH-1_tsg.tsg", "DDH-1_tsg_cras.bip"]
    assert not list((tmp_path / "pkg").glob(".*.zip"))       # the download is not kept beside the unpacked files
    smp.package(["upload:K1"], "DDH-1"); assert len(seen) == 1                       # cached
    with pytest.raises(smp.NoPackage):
        smp.package(["upload:K2"], "DDH-1")                   # not kept: 404


def test_an_upload_whose_files_are_named_otherwise_gives_its_one_dataset(tmp_path, monkeypatch):
    body = _zipped(tmp_path, {"Hole A_tsg.tsg": b"t", "Hole A_tsg.bip": b"b"})
    _platform(monkeypatch, lambda req: httpx.Response(200, content=body)); monkeypatch.setattr(smp, "ROOT", tmp_path / "pkg")
    d = smp.package(["upload:K9"], "Hole_A")
    assert sorted(p.name for p in d.iterdir() if p.name != ".ready") == ["Hole A_tsg.bip", "Hole A_tsg.tsg"]


# ---------------------------------------------------------------------------------------------- TSG samples

def test_sample_ids_become_intervals_in_dataset_order():
    from app.pipeline.tsg import sample_ids
    depth = np.array([10.0, 10.01, 10.02, 10.03, 10.04, 10.05, 10.06])
    ids = ["", "S2", "S2", "Empty core tray", "S1", "S1", "S2"]
    sp = SimpleNamespace(scalars=pd.DataFrame({"Sample ID": ids}), sampleheaders=pd.DataFrame({"D": depth}), bandheaders=[])
    assert sample_ids(sp, depth, "DS") == [{"id": "S2", "from_m": 10.01, "to_m": 10.07, "dataset": "DS"}, {"id": "S1", "from_m": 10.04, "to_m": 10.06, "dataset": "DS"}]
    none = SimpleNamespace(scalars=pd.DataFrame({"Other": ids}), sampleheaders=pd.DataFrame({"D": depth}), bandheaders=[])
    assert sample_ids(none, depth, "DS") == []


# ---------------------------------------------------------------------------------------------- a whole PDF

def _toy_package(tmp_path, monkeypatch, n=60):
    d = tmp_path / "pkg" / "DS"; d.mkdir(parents=True); (d / ".ready").touch()
    (d / "DS_tsg.tsg").write_text("[class 1]\nname = S_SWIR_TSA705 Groups\nmax = 2\ncolours = 255 65280\n0:WHITE-MICA\n1:CHLORITE\n")
    _cras(d / "DS_tsg_cras.bip", n, 8, 32)
    depth = 5.0 + np.arange(n) * 0.008; depth[30:] += 0.5                      # a gap: depth is not linear in index
    grp = np.where(np.arange(n) % 3 == 0, 1.0, 0.0).astype(np.float32); grp[5] = -3.4e38   # coded through class 1
    minl = np.where(grp == 1.0, "Chlorite-Fe", "Muscovite").astype(object); minl[7] = "Aspectral"
    swir = SimpleNamespace(sampleheaders=pd.DataFrame({"D": depth, "T": ["0001"] * 30 + ["0002"] * 30}),
                           scalars=pd.DataFrame({"Grp1 sTSAS": grp, "Min1 sTSAS": minl, "Wt1 sTSAS": np.ones(n, np.float32),
                                                 "Final Mask": np.where(np.arange(n) % 10 == 9, 0.0, 1.0)}),
                           bandheaders=[SimpleNamespace(name="Grp1 sTSAS", class_number=1, flag=2)],
                           classes=[SimpleNamespace(name="S_VNIR", classes={}), SimpleNamespace(name="S_SWIR_TSA705 Groups", classes={0: "WHITE-MICA", 1: "CHLORITE"})],
                           spectra=np.random.default_rng(0).uniform(0.1, 0.4, (n, 50)), wavelength=np.linspace(380, 2500, 50))
    tir = SimpleNamespace(sampleheaders=pd.DataFrame({"D": depth + 0.001}), bandheaders=[], classes=[],
                          scalars=pd.DataFrame({"Grp1 ujCLST": ["SILICA"] * n, "Min1 ujCLST": ["Quartz"] * n, "Wt1 ujCLST": np.ones(n)}),
                          spectra=np.random.default_rng(1).uniform(0.0, 0.2, (n, 40)), wavelength=np.linspace(6000, 14500, 40))
    monkeypatch.setattr(smp, "ROOT", tmp_path / "pkg")
    monkeypatch.setattr(smp, "_spectra_of", lambda d_, ds: swir)
    monkeypatch.setattr(smp, "_tir_of", lambda d_, ds: tir)
    return swir, tir


def test_a_sheet_per_interval_with_an_empty_interval_saying_so(tmp_path, monkeypatch):
    _toy_package(tmp_path, monkeypatch)
    req = sheets.check({"intervals": [{"label": "A", "from_m": 5.0, "to_m": 6.0}, {"label": "none", "from_m": 50, "to_m": 51}], "results": "auto"})
    pdf = sheets.render(["x"], "DS", "HOLE", req)
    assert pdf.startswith(b"%PDF")
    assert pdf.count(b"/Type /Page") - pdf.count(b"/Type /Pages") == 2
    with pytest.raises(sheets.BadRequest):
        sheets.check({"intervals": [{"from_m": 5, "to_m": 6}], "results": "x"})


def test_the_user_run_is_used_when_the_system_one_is_missing():
    sp = SimpleNamespace(scalars=pd.DataFrame(columns=["Grp1 uTSAS", "Min1 uTSAS", "Wt1 uTSAS", "Grp1 ujCLST", "Wt1 ujCLST", "Grp1 sTSAT", "Wt1 sTSAT"]))
    assert sheets.run_of(sp, ("TSAS",), "auto")[0] == "uTSAS" and sheets.run_of(sp, ("TSAS",), "system") is None
    assert sheets.run_of(sp, ("jCLST", "TSAT"), "auto")[0] == "sTSAT"     # the system run first, whichever kind
    assert sheets.run_of(sp, ("jCLST", "TSAT"), "user")[0] == "ujCLST"


def test_the_endpoint_answers_400_on_a_bad_request_and_404_without_a_package(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    monkeypatch.setattr(smp, "ROOT", tmp_path / "pkg")
    c = TestClient(app)
    body = {"dataset": "NOPE", "refs": ["NOPE"], "hole_name": "H", "intervals": [{"label": "a", "from_m": 1, "to_m": 30}]}
    r = c.post("/api/v1/sheets.pdf", json=body); assert r.status_code == 400 and "20 m" in r.json()["detail"]
    body["intervals"][0]["to_m"] = 2
    r = c.post("/api/v1/sheets.pdf", json=body); assert r.status_code == 404
    _toy_package(tmp_path, monkeypatch)
    body.update(dataset="DS", refs=["x"], intervals=[{"label": "a", "from_m": 5.0, "to_m": 5.3}])
    r = c.post("/api/v1/sheets.pdf", json=body)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")


# ---------------------------------------------------------------------------------------------- the png preview

def _png_size(b: bytes) -> tuple[int, int]:
    assert b.startswith(b"\x89PNG\r\n\x1a\n")
    return struct.unpack(">II", b[16:24])


def test_png_is_checked_one_interval_and_the_dpi_clamped():
    iv = [{"from_m": 1, "to_m": 2}]
    assert sheets.check({"intervals": iv})["format"] == "pdf"
    r = sheets.check({"intervals": iv, "format": "png"}); assert r["format"] == "png" and r["dpi"] == sheets.PNG_DPI
    assert sheets.check({"intervals": iv, "format": "png", "dpi": 10})["dpi"] == 60
    assert sheets.check({"intervals": iv, "format": "png", "dpi": 999})["dpi"] == 200
    for bad in ({"intervals": iv * 2, "format": "png"}, {"intervals": iv, "format": "svg"}, {"intervals": iv, "format": "png", "dpi": "x"}):
        with pytest.raises(sheets.BadRequest):
            sheets.check(bad)


def test_a_png_is_the_one_page_at_about_900_px(tmp_path, monkeypatch):
    _toy_package(tmp_path, monkeypatch)
    png = sheets.render(["x"], "DS", "HOLE", sheets.check({"intervals": [{"label": "A", "from_m": 5.0, "to_m": 6.0}], "format": "png"}))
    w, h = _png_size(png)
    assert 880 <= w <= 940 and abs(h / w - sheets.A4[1] / sheets.A4[0]) < 0.01
    w2, _ = _png_size(sheets.render(["x"], "DS", "HOLE", sheets.check({"intervals": [{"from_m": 50, "to_m": 51}], "format": "png", "dpi": 60})))
    assert abs(w2 - 8.27 * 60) <= 2                             # an empty interval still gives its page


def test_the_endpoint_returns_a_png_for_one_interval_and_400_for_two(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    _toy_package(tmp_path, monkeypatch)
    c = TestClient(app)
    body = {"dataset": "DS", "refs": ["x"], "hole_name": "H", "format": "png", "dpi": 100, "intervals": [{"label": "a", "from_m": 5.0, "to_m": 5.3}]}
    r = c.post("/api/v1/sheets.pdf", json=body)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and "content-disposition" not in r.headers
    assert abs(_png_size(r.content)[0] - 827) <= 2
    body["intervals"] = body["intervals"] * 2
    r = c.post("/api/v1/sheets.pdf", json=body); assert r.status_code == 400 and "one interval" in r.json()["detail"]


# ---------------------------------------------------------------------------------------------- the v2 layout

def test_a_table_never_runs_past_its_box_minerals_give_way_first():
    data = [{"group": f"G{k}", "share": 0.1, "minerals": [(f"m{k}{j}", 0.03) for j in range(3)] + [("+2 more", 0.01)]} for k in range(10)]
    rows, rh = sheets._table_layout(data, 4.0)                  # 50 rows wanted, ~25 fit at ROW_MIN
    n = sum(1 + len(d["minerals"]) for d in rows)
    assert n * rh <= 4.0 + 1e-9 and rh >= sheets.ROW_MIN
    assert all(len(d["minerals"]) < 4 for d in rows) and rows[0]["minerals"][-1][0].startswith("+")
    rows, rh = sheets._table_layout(data, 0.6)                   # not even the group rows fit: rows shrink further
    assert sum(1 + len(d["minerals"]) for d in rows) * rh <= 0.6 + 1e-9 and all(not d["minerals"] for d in rows)
    assert sheets._trim([("a", 0.5), ("b", 0.2), ("c", 0.1), ("+2 more", 0.05)], 1) == [("a", 0.5), ("+4 more", pytest.approx(0.35))]


def test_one_panel_pages_and_the_run_names_geologists_quote(tmp_path, monkeypatch):
    swir, _ = _toy_package(tmp_path, monkeypatch)
    for opt in ({"tir": False}, {"swir": False}):
        pdf = sheets.render(["x"], "DS", "HOLE", sheets.check({"intervals": [{"label": "A", "from_m": 5.0, "to_m": 6.0}], **opt}))
        assert pdf.startswith(b"%PDF")
    r = sheets.Run(swir, None, ("TSAS",), "auto")
    assert r.label == "sTSAS" and r.who == "system" and r.name == "TSA705"


# ---------------------------------------------------------------------------------------------- the data zip

def _zip(b: bytes) -> dict[str, str]:
    import io
    with zipfile.ZipFile(io.BytesIO(b)) as z:
        return {n: z.read(n).decode() for n in z.namelist()}


def test_breakdown_folds_nothing_and_its_groups_sum_to_one():
    G, M, W = _ranks([[("CHLORITE", "Chlorite-Fe", 0.7), ("WHITE-MICA", "Muscovite", 0.3)]] * 6 + [[("WHITE-MICA", "Phengite", 1.0)]] * 3 +
                     [[("INVALID", "Aspectral", 1.0)]] + [[("SULPHATE", "Gypsum", 0.4)]])
    out = sheets.breakdown(G, M, W, np.arange(11), sheets.NO_SWIR)
    groups = [(g, round(s * 11, 6), n) for g, m, s, n in out if not m]
    assert groups == [("WHITE-MICA", 4.8, 9), ("CHLORITE", 4.2, 6), ("SULPHATE", 0.4, 1), (sheets.NO_SWIR, 1.0, 1), (sheets.NO_RESULT, 0.6, 1)]
    assert abs(sum(s for _, m, s, _ in out if not m) - 1) < 1e-9
    assert [(m, n) for g, m, s, n in out if g == "WHITE-MICA" and m] == [("Phengite", 3), ("Muscovite", 6)]


def test_the_zip_has_a_row_per_reading_shares_and_mean_spectra(tmp_path, monkeypatch):
    import csv, io
    _toy_package(tmp_path, monkeypatch)
    ivs = [{"label": "A", "from_m": 5.0, "to_m": 5.2}, {"label": "B", "from_m": 5.2, "to_m": 6.0}, {"label": "none", "from_m": 50, "to_m": 51}]
    req = sheets.check({"intervals": ivs, "format": "zip"}); assert req["all_spectra"] is False
    f = _zip(sheets.export(["x"], "DS", "HOLE", req))
    assert sorted(f) == ["README.txt", "readings.csv", "spectra_swir_mean.csv", "spectra_tir_mean.csv", "summary.csv"]
    rd = list(csv.DictReader(io.StringIO(f["readings.csv"])))
    assert [sum(r["label"] == k for r in rd) for k in "AB"] == [25, 35] and len(rd) == 60       # 5.0 + 25 * 8 mm, then the gap
    r0 = rd[0]
    assert r0["reading_index"] == "0" and r0["depth_m"] == "5.0000" and r0["tray"] == "0001" and r0["in_final_mask"] == "1"
    assert (r0["swir_group_1"], r0["swir_mineral_1"], r0["swir_weight_1"]) == ("CHLORITE", "Chlorite-Fe", "1") and r0["tir_mineral_1"] == "Quartz"
    assert rd[9]["in_final_mask"] == "0" and rd[5]["swir_group_1"] == "" and rd[7]["swir_mineral_1"] == "Aspectral"
    sm = list(csv.DictReader(io.StringIO(f["summary.csv"])))
    for lab in "AB":
        for panel in ("SWIR", "TIR"):
            g = [r for r in sm if r["label"] == lab and r["panel"] == panel and not r["mineral"]]
            assert abs(sum(float(r["share"]) for r in g) - 1) < 1e-5 and len({r["of_readings"] for r in g}) == 1
    assert {r["label"] for r in sm} == {"A", "B"}
    mean = list(csv.reader(io.StringIO(f["spectra_swir_mean.csv"])))
    assert mean[0] == ["wavelength", "A mean", "A p10", "A p90", "B mean", "B p10", "B p90", "none mean", "none p10", "none p90"]
    assert len(mean) == 51 and mean[1][-1] == "" and 0.1 <= float(mean[1][1]) <= 0.4
    assert "Final Mask" in f["README.txt"] and "sTSAS" in f["README.txt"]


def test_every_spectrum_on_request_and_capped(tmp_path, monkeypatch):
    import csv, io
    _toy_package(tmp_path, monkeypatch)
    req = sheets.check({"intervals": [{"label": "A", "from_m": 5.0, "to_m": 6.0}], "format": "zip", "all_spectra": True, "tir": False})
    f = _zip(sheets.export(["x"], "DS", "HOLE", req))
    assert "spectra_tir_mean.csv" not in f and "spectra_tir_readings.csv" not in f
    rows = list(csv.reader(io.StringIO(f["spectra_swir_readings.csv"])))
    assert len(rows) == 61 and len(rows[0]) == 52 and rows[0][:3] == ["label", "depth_m", "380"]
    monkeypatch.setattr(sheets, "MAX_SPECTRA", 59)
    with pytest.raises(sheets.BadRequest):
        sheets.export(["x"], "DS", "HOLE", req)


def test_the_endpoint_returns_the_zip_as_an_attachment(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    _toy_package(tmp_path, monkeypatch)
    c = TestClient(app)
    body = {"dataset": "DS", "refs": ["x"], "hole_name": "H 1", "format": "zip", "intervals": [{"label": "a", "from_m": 5.0, "to_m": 5.3}] * 3}
    r = c.post("/api/v1/sheets.pdf", json=body)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"] == 'attachment; filename="CoreFlagging_H_1_sheets_data.zip"' and "readings.csv" in _zip(r.content)
    monkeypatch.setattr(sheets, "MAX_SPECTRA", 10)
    r = c.post("/api/v1/sheets.pdf", json={**body, "all_spectra": True}); assert r.status_code == 400 and "10" in r.json()["detail"]
