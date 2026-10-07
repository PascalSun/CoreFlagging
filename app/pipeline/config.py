"""Settings, all overridable by environment variables.

  PLATFORM_API_URL      the platform (Groundwork) this service works for, e.g. http://platform:8000
  PLATFORM_API_TOKEN    the service token both sides hold
  CORETRACE_WORK        local working directory (scratch; the platform database is the record)   default: <repo>/work
  CORETRACE_BUNDLE      trained models + fitted heads (read-only)                                default: <repo>/bundle
  CORETRACE_REFERENCE   State reference tables (collars, regions, training split)                default: <repo>/reference
  CORETRACE_NVCL_ROOT   folder of the mirrored NVCL TSG zips (<dataset>.zip); empty = this worker takes uploads only
  CORETRACE_NVCL_STORE  folder of the AuScope NVCL store mirror (every other State: <State>/<dataset>.zip, _catalog/store_index.json)
  CORETRACE_CATALOGUE   NVCL dataset catalogue (all_datasets.json) with the TSG header of each dataset
  CORETRACE_MODEL       default model run                                                        default: v2
  CORETRACE_THREADS     CPU threads for the model                                                default: min(8, cores)
  CORETRACE_WORKER      1 = this process also takes jobs from the platform                       default: 1
  CORETRACE_NVCL        NVCL data service (not used by the TSG path)
"""
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("CORETRACE_WORK", REPO / "work")).resolve()   # local working cache; nothing here is the record
REFERENCE = Path(os.environ.get("CORETRACE_REFERENCE", REPO / "reference")).resolve()
BUNDLE = Path(os.environ.get("CORETRACE_BUNDLE", REPO / "bundle")).resolve()
PLATFORM_API_URL = os.environ.get("PLATFORM_API_URL", "").rstrip("/")
PLATFORM_API_TOKEN = os.environ.get("PLATFORM_API_TOKEN", "")
NVCL_ROOT = os.environ.get("CORETRACE_NVCL_ROOT", "")
NVCL_STORE = os.environ.get("CORETRACE_NVCL_STORE", "")       # AuScope store mirror, one folder per State: <State>/<dataset>.zip
CATALOGUE = os.environ.get("CORETRACE_CATALOGUE", "")
WORKER = os.environ.get("CORETRACE_WORKER", "1") == "1"
THREADS = int(os.environ.get("CORETRACE_THREADS", min(8, os.cpu_count() or 1)))
NVCL = os.environ.get("CORETRACE_NVCL", "https://geossdi.dmp.wa.gov.au/NVCLDataServices/")

# ── cleaning rules: identical to fm/config.py of the research code (the model was trained on data cleaned this way) ──
BIN_M = 0.10                      # one token = 10 cm of core
MIN_VALID = 3                     # a 10 cm bin needs at least 3 valid samples
MAX_STEP_M = 0.25                 # sample spacing above this = chips / cuttings, not a continuous core scan
SWIR_CLIP = (0.0, 1.0)            # SWIR reflectance clipped to 0-1
TIR_CLIP_MIN = 0.0                # negative TIR reflectance clipped to 0 ...
TIR_DARK = 0.03                   # ... samples darker than this (mean 6.5-14 um) dropped
TIR_NEG_BAND_SHARE = 0.10         # ... samples with more than 10 % negative bands dropped
TIR_MAX = 1.0                     # ... samples with a band above 1 dropped
TIR_OVER_SHARE = 0.05             # more than 5 % of samples above 1 = miscalibrated dataset, TIR not used
TIR_BANDS = (6500.0, 14000.0)     # TIR range given to the model (noisy band ends trimmed)
TIR_GRID = (6000.0, 14500.0, 341) # HyLogger 3 TIR grid; HyLogger 4 TIR is resampled onto it
SWIR_GRID = (380.0, 2500.0, 531)  # VNIR-SWIR grid
PRIORITY = ("HyLogger 3", "HyLogger 4", "HyLogger 2")   # where datasets of one hole overlap in depth, keep this order
STORE_DTYPE = "float16"
