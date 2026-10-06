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
- A hole comes from the **NVCL mirror** (the worker reads `<dataset>.zip` from its own mount)
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
| `CORETRACE_CATALOGUE` | empty | the mirror's `all_datasets.json` (TSG header fields per dataset) |
| `CORETRACE_WORK` | `./work` | scratch directory; safe to delete |
| `CORETRACE_MODEL` | `v2` | the default model |
| `CORETRACE_THREADS` | min(8, cores) | CPU threads for the model |
| `CORETRACE_WORKER` | `1` | `0` = serve `/similar` only, take no jobs |

## Processing the NVCL mirror

```bash
uv run python -m app.cli register            # tell the platform about every hole in the mirror; queues the new ones
uv run python -m app.cli work                # take jobs until stopped (run several, each with its own CORETRACE_WORK)
```

A hole's datasets are the catalogue entries that share a borehole. Uploads are always taken
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
- **TIR differs on two holes.** A TSG package carries one validity mask for TIR, synchronised
  to the SWIR mask when the package was written. The data service keeps a separate, wider
  TIR mask. On DRDD380 the package marks 15,000 fewer TIR samples valid, and results shift
  (42 auto-log segments against 38). On WF14-98 the difference is 87 samples.
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
