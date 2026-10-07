# CoreTrace

The **core-scan service** behind the Geo Research Platform ([Groundwork](../Groundwork)).
It reads HyLogger drill-core scans (TSG files), cleans them into 10 cm bins, runs the
core-spectra models over them and hands the platform everything it found:

1. data-quality issues
2. an automatic log (where the core changes, and what each piece is)
3. unusual intervals
4. gold likelihood per metre
5. thermal infrared filled in from shortwave infrared
6. fingerprints for finding similar core elsewhere in the State

> The models and the research pipeline come from the CoreScope research code. The pipeline
> modules under `app/pipeline/` are that code, kept as it was evaluated; see
> [Parity](#parity) for what was checked and what differs.

## How it fits together

CoreTrace keeps **no data of its own**. The platform's database is the record.

```
Groundwork (platform)                         CoreTrace (this repo)
  core_scan tables, uploads,   ──jobs──▶        worker: fetch scan → clean → models
  object storage, the map      ◀─results──      (tokens, per-metre results, tray photographs)
                               ──fingerprint──▶ /api/v1/similar  (the State library lives here)
```

- A **job** is one hole. The worker claims it over HTTP with a lease, so a worker that dies
  loses the job to the next one.
- A hole comes from the **NVCL mirror** (the worker reads `<dataset>.zip` from its own mount: WA from
  GSWA's node, every other State from the AuScope store)
  or from a **user upload** (the worker downloads the zip from the platform).
- The result is plain data. The platform stores it and serves every page from its tables,
  so the map and the reports work with this service down. Only "similar core" needs it live.

The link is one shared secret, `PLATFORM_API_TOKEN`, plus `PLATFORM_API_URL`. The platform
calls back on `CORETRACE_SERVICE_URL`.

## Layout

```
app/
  pipeline/        the research pipeline: cleaning, the model, the six functions
    tsg.py         TSG files → the raw layout the cleaning expects (new here)
  runner.py        one hole: TSG folders → the result package
  extras.py        per-metre outputs stored so opening a metre needs no model run
  labels.py        English for what the pipeline names in Chinese
  trays.py         tray photographs and where each row of core sits in them
  sources.py       getting a job's TSG files onto local disk
  platform.py      the platform's job and result API
  worker.py        the job loop
  main.py          FastAPI: /health, /api/v1/models, /api/v1/similar
  cli.py           process | register | work
bundle/            trained models, fitted heads, the State library (read-only, 190 MB)
reference/         State reference tables: collars, regions, training split
scripts/           parity checks against the research app
```

## Run locally

Python 3.12, CPU only. Bring the platform up first (`cd ../Groundwork && just local`).

```bash
uv sync
# mint a service token on the platform
docker compose -f ../Groundwork/backend/docker-compose.local.yml exec platform python manage.py create_service_token

PLATFORM_API_URL=http://localhost:8011 PLATFORM_API_TOKEN=<token> \
  uv run uvicorn app.main:app --port 8020
```

The local platform expects the service at `http://host.docker.internal:8020`
(`CORETRACE_SERVICE_URL` in `backend/docker-compose.local.yml`).

One hole without a platform:

```bash
uv run python -m app.cli process MND036 /path/to/folder/with/MND036_tsg.tsg
```

## Settings

| Variable | Default | What it is |
|---|---|---|
| `PLATFORM_API_URL` | — | the platform, e.g. `http://platform:8000` |
| `PLATFORM_API_TOKEN` | — | the service token both sides hold |
| `CORETRACE_NVCL_ROOT` | empty | folder of mirrored NVCL zips; empty = this worker takes uploads only |
| `CORETRACE_CATALOGUE` | empty | the WA mirror's `all_datasets.json` (TSG header fields per dataset); GSWA's `hylogger_drillholes.json` beside it gives the collars |
| `CORETRACE_NVCL_STORE` | empty | the AuScope store mirror (`<State>/<dataset>.zip`, `_catalog/store_index.json`) for every other State |
| `CORETRACE_WORK` | `./work` | scratch directory; safe to delete |
| `CORETRACE_MODEL` | `v2` | the default model |
| `CORETRACE_THREADS` | min(8, cores) | CPU threads for the model |
| `CORETRACE_WORKER` | `1` | `0` = serve `/similar` only, take no jobs |

## Processing the NVCL mirror

```bash
uv run python -m app.cli register            # tell the platform about every hole in the mirror; queues the new ones
uv run python -m app.cli work                # take jobs until stopped (run several, each with its own CORETRACE_WORK)
```

A hole's datasets are the catalogue entries that share a borehole URI. The WA node gives a few
different holes one URI (BH01 at Behemoth and at Bunbury), so WA datasets whose GSWA collars are
more than 20 km apart are kept as separate holes. Keys: a WA hole is keyed by its name, another
State's by `<STATE>-<name>`; when two holes share a name, the one with a dataset of exactly that
name keeps it and the other is keyed by its dataset. The collar comes from the State's own list
(GSWA's HyLogger drillholes, the AuScope store index) and the platform keeps it over the scan header.

Only WA holes use the NVCL node's TIR mask and the WA reference list; the models were trained on
WA core, so another State's results are read outside the training area. Uploads are always taken
before the mirror backlog.

## Deploy

Its own compose stack next to the platform, on the shared network `geo_shared`:

```bash
cp .env.example .env      # PLATFORM_API_TOKEN, the mirror's path
docker compose up -d --build
```

One process per container: the worker takes one job at a time and the models hold about
1 GB. To go faster, run more containers.

## Parity

Checked on the nine demo holes of the research app, read here from the NVCL TSG packages
and there from the NVCL data service (`scripts/parity_tokens.py`):

- **Identical:** SWIR spectra, bin counts, lithology, gold assays and quality issues on all
  nine. With identical input, the three foundation models give identical output.
- **TIR mask.** A TSG package carries one validity mask for TIR, synchronised to the SWIR mask
  when the package was written. The NVCL data service keeps the TIR mask as logged, and the
  models were trained on that one. For mirrored holes the worker fetches it from the service
  (`sources.service_tir_mask`), which makes TIR identical too (checked on DRDD380, WF14-98,
  MND036). An uploaded scan has only its package mask, so its TIR can differ from what the
  service would give for the same hole (on DRDD380, 15,000 fewer valid TIR samples).
- **Ties.** Where two minerals tie in a 10 cm bin the research code let the sort decide, so
  its answer depended on the machine. Here the alphabetically first wins. This moves 1–3 %
  of labels, and through them the conventional-methods gold score.
- **Depth.** TSG stores depth as float32; it is rounded to 5 decimals, as the data service
  prints it, so a sample on a bin boundary lands in the same bin.
- **Gold.** A metre with samples but no assay comes out as 0 ppm, not as missing, as the
  data service returns it. Kept the same because the gold probe was fitted that way.

## Known limits

- Chips and cuttings (samples more than 0.25 m apart) are skipped: the models were trained
  on continuous core. HyLogger 4 mid-infrared is not used.
- Auto-log descriptions are written by rule from the TSG software's minerals. A geologist
  has not reviewed them.
- The State library covers the 1,692 holes it was built from. A newly processed hole can be
  searched *from*, but does not appear in other holes' results until the bundle is rebuilt.
- An uploaded scan has no collar details unless the TSG header carries them.

## Tests

```bash
uv run pytest
```
