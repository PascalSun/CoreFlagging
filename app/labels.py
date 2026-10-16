"""English for what the pipeline names in Chinese.

The research code labels rock classes, core types and its cleaning rules in Chinese, and those strings are also keys
inside the fitted models (a rock class is its Chinese name). The pipeline is left as it is; names are put into English
here, where a result leaves the service. The Chinese stays next to it (`*_zh`) for a Chinese view of the same data.
"""
from __future__ import annotations

from .pipeline import config as C
from .pipeline import names as N

LITH_EN = {"超基性岩": "Ultramafic", "铁建造和燧石": "Iron formation and chert", "碳酸盐岩": "Carbonate rock", "镁铁质侵入岩": "Mafic intrusive", "镁铁质火山岩": "Mafic volcanic",
           "花岗岩类": "Granitoid", "长英质和中性火山岩": "Felsic and intermediate volcanic", "中性侵入岩": "Intermediate intrusive", "变质岩": "Metamorphic",
           "碎屑沉积岩": "Clastic sedimentary", "脉和蚀变": "Vein and alteration", "风化层和覆盖": "Regolith and cover"}
_MINERAL = {zh: N.gt_en(code) for code, zh in N.ZH.items()}
_MINERAL.update({"石英": "quartz", "白云母": "white mica", "黑云母": "dark mica", "无响应": "no response", "高岭石": "kaolin"})
_PHRASES = [("（短波红外无响应）", " (no SWIR response)"), ("（Ⅱ）", " (II)"), ("，较多", ", more "), (" + ", " + ")]


def lith(zh: str | None) -> str | None:
    return LITH_EN.get(zh, zh) if zh else zh


def core_type(zh: str) -> str:
    """'石英 + 绿泥石，较多黑云母' -> 'Quartz + chlorite, more dark mica'."""
    s = zh
    for a, b in _PHRASES:
        s = s.replace(a, b)
    for z, en in sorted(_MINERAL.items(), key=lambda kv: -len(kv[0])):
        s = s.replace(z, en)
    return s[:1].upper() + s[1:]


def rules() -> list[dict]:
    return [{"step": "Valid samples", "rule": "Only samples the TSG Final Mask marks as valid (1) are used."},
            {"step": "No chips", "rule": f"A dataset sampled more than {C.MAX_STEP_M} m apart is chips or cuttings, not continuous core, and is not used."},
            {"step": "SWIR", "rule": f"Reflectance is clipped to {C.SWIR_CLIP[0]:g}–{C.SWIR_CLIP[1]:g}."},
            {"step": "TIR", "rule": f"HyLogger 4 is resampled to the HyLogger 3 bands. Negative values are clipped to 0. A sample is dropped if it is too dark (mean below {C.TIR_DARK}), "
                                    f"has more than {C.TIR_NEG_BAND_SHARE:.0%} negative bands, or has a band above 1. If more than {C.TIR_OVER_SHARE:.0%} of samples go above 1 the dataset "
                                    "is taken as miscalibrated and its TIR is not used."},
            {"step": "10 cm bins", "rule": f"Samples are averaged every {C.BIN_M * 100:.0f} cm of depth; a bin needs at least {C.MIN_VALID} valid samples."},
            {"step": "Overlaps", "rule": "Where datasets of one hole overlap in depth, one is kept, in the order HyLogger 3, 4, 2."},
            {"step": "Band range", "rule": f"The models see TIR from {C.TIR_BANDS[0] / 1000:.1f} to {C.TIR_BANDS[1] / 1000:.0f} µm; the noisy ends are left out."}]


REASON_EN = {"fully covered by a higher-priority dataset of the same hole": "Another instrument's scan already covers the same depths."}


def package(pkg: dict, models) -> dict:
    """Put a result package into English, in place. `models` is the service's model set (for display names)."""
    m = pkg["metres"]; m["lith"] = [lith(x) for x in m["lith"]]              # lith_raw keeps the log's own words
    pkg["report"]["rules"] = rules()
    cards = {x["run"]: x["card"] for x in models.listing()}
    for run, r in pkg["models"].items():
        for c in r.get("core_types", []):
            c["name_zh"] = c["name"]; c["name"] = core_type(c["name"])
        for s in r.get("segments", []):
            if s.get("core_type_name"):
                s["core_type_name_zh"] = s["core_type_name"]; s["core_type_name"] = core_type(s["core_type_name"])
        summ = r.get("summary") or {}
        if summ.get("main_types"):
            summ["main_types"] = [[core_type(k), v] for k, v in summ["main_types"]]
        card = cards.get(run, {})
        r["model"] = {"run": run, "step": (r.get("model") or {}).get("step"), "name": card.get("name_en") or run, "name_zh": card.get("name"), "description": card.get("desc_en", "")}
    return pkg
