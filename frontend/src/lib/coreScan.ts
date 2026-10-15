// Core scans (Core Flagging): the platform's core_scan API.
//
// Reads are public for NVCL holes; a signed-in caller also sees their own uploads, so a
// token is sent when there is one. Uploading needs a verified session.

import { PLATFORM_URL, platformFetch, sharedRefresh } from "@ntlp/geodata-web/fetch";
import { authToken } from "@ntlp/geodata-web/auth";

export const CORE_BASE = `${PLATFORM_URL}/core-scan/api`;

export class CoreError extends Error {
  status: number; code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; }
}

export type HoleStatus = "awaiting_upload" | "queued" | "reading" | "cleaning" | "modelling" | "ready" | "failed";

/** Where a hole's target came from: its own survey record, the report or permit it belongs to, the nearest known deposit (an inference), or nowhere. */
export type TargetSource = "survey" | "report" | "deposit" | "";
export const TARGET_SOURCE_LABEL: Record<TargetSource, string> = { survey: "from the hole's own record", report: "from the exploration report", deposit: "inferred from the nearest known deposit", "": "" };
/** A target that is not the hole's own record: shown with a hatched fill and a ≈. */
export const inferred = (s: TargetSource | undefined) => !!s && s !== "survey";

export type HoleRow = {
  key: string; name: string; source: "nvcl" | "upload"; status: HoleStatus; message: string; progress: number;
  lon: number | null; lat: number | null; state: string; offshore: boolean; operator: string; project: string; region: string; instrument: string;
  depth_min: number | null; depth_max: number | null; tir: string; has_lith: boolean; au_m: number; au_pos_m: number;
  n_issues: number; n_again: number; again_m: number; target: string; commodities: string[]; target_source: TargetSource;
  /** the year the hole was drilled, where the list carries it */
  drilled?: number | null;
  split: string; is_public: boolean; mine: boolean; updated: string; processed_at: string | null; strip?: number[];
};

/** An interval where the model's reading disagrees with the log, by the ultramafic rule (computed on the platform, `core_scan/look_again.py`). */
export type AgainInterval = {
  from_m: number; to_m: number; length_m: number; direction: "model_ultramafic" | "log_ultramafic";
  logged: string; logged_class: string; reads: string; share: number; um_minerals: number | null;
  assays: { n: number; max: number | null; pos: number }; flagged: number;
};
export type Again = { n: number; metres: number; intervals: AgainInterval[] };
/** One row of the cross-hole sheet: an interval with its hole. */
export type AgainRow = AgainInterval & { hole: string; key: string; state: string; operator: string; project: string; region: string; au_m: number; au_pos_m: number };
export type AgainSheet = { model: string; n_holes: number; holes_listed: number; metres: number; rows: AgainRow[] };

/** A geologist's verdict on one of the model's suggestions. Notes come back only for the reader's own. */
export type Review = { run: string; kind: ReviewKind; from_m: number; to_m: number; verdict: "agree" | "disagree"; note: string; mine: boolean; at: string };
export type ReviewKind = "log" | "flag" | "domain" | "unit";
export type ReviewBody = { run: string; kind: ReviewKind; from_m: number; to_m: number; verdict: "agree" | "disagree"; note?: string };

export type Sample = { i: number; depth: number; tray: string; section: number | null; x_mm: number; mineral: string; group: string; weight: number | null; height_mm: number | null; swir?: number[] };
export type SampleView = { dataset: string; from_m: number; to_m: number; n: number; step_mm: number | null; samples: Sample[]; swir_wl?: number[] };

export type TracePoint = { m: number; e: number; n: number; u: number; lon: number; lat: number; z: number | null; k: number | null };
export type Trace = { key: string; name: string; source: "survey" | "header" | "vertical"; stations: number; collar: { lon: number; lat: number; rl: number | null }; depth_min: number; depth_max: number; points: TracePoint[]; km?: number; n_again?: number; target?: string };
export type TraceView = { hole: Trace; nearby: Trace[]; again: { from_m: number; to_m: number }[]; flags: { from_m: number; to_m: number }[]; core_types: { k: number; name: string }[] };

/** What stands out about a hole above the metre: against its region, and its domains against the rest of it. */
export type Standout = {
  run: string;
  hole_vs_region: { region: string; n_holes: number; note: string | null; items: { k: number; name: string; hole_share: number; region_share: number; ratio: number | null; region_holes_with: number }[] };
  domains: { from_m: number; to_m: number; length_m: number; type: string; why: { kind: "rare_type" | "mineral"; text: string; mineral?: string }[] }[];
  unlogged: { from_m: number; to_m: number; length_m: number; reads: string; share: number }[];
};
/** Every tectonic region with enough scanned WA holes and its core-type profile. */
export type RegionsView = { run: string; core_types: { k: number; name: string }[]; regions: { region: string; n_holes: number; metres: number; types: { k: number; share: number; holes: number }[] }[] };

export type Bin = { bin: number; from_m: number; n_swir: number; n_tir: number; gs: string; ms: string; gt: string };
export type BinSpectra = Bin & { swir_wl: number[]; swir: number[]; tir_wl: number[]; tir: number[] | null };

/** What the DMIRS HyLogger drillhole package holds for a hole: the WAMEX collar, the company's logged
 * intervals and the multi-element assays by depth. 404 for uploads, other States and unmatched holes. */
export type HolePackage = {
  collar_id: number; anumber: string;
  collar: { hole_id: string; anumber: number | null; company_hole_id: string; company: string; hole_type: string; max_depth: number | null; tectonic_region: string } | null;
  geology: { from_m: number; to_m: number; code: string; name: string; rock: string; regolith: string; comments: string }[];
  assays: { columns: string[]; rows: { from_m: number; to_m: number; v: (number | null)[] }[] };
};

/** The exploration report a hole was logged in: the mirror's files (the OCR'd PDF first) and the abstract. */
/** Every document the platform holds about a hole: its own HyLogger PDFs (every State) and, in WA, the WAMEX
 * reports it was logged in. `url` fields are same-origin streams the in-page viewer can open. */
export type HoleDocuments = {
  hole: string; name: string; state: string;
  hole_pdfs: { corpus: string; key: string; product: string; kind: string; title: string; pages: number | null; file: string; state: string; url: string }[];
  wamex: null | {
    linked: { anumber: string; found_by: string; title?: string; year?: number | null; type?: string; company?: string | null; commodities?: string | null; url: string;
      abstract?: string | null; files?: { name: string; bytes: number; download_url: string; url: string | null }[]; pdf?: string | null }[];
    covering: { anumber: string; title: string; year: number | null; type: string; company: string | null; commodities: string | null; url: string }[];
    covering_count: number;
  };
  portal: { name: string; url: string } | null;
};
export type HoleReport = {
  anumber: string; abstract: string | null; pdf_url: string | null;
  files: { name: string; bytes: number; download_url: string }[];
};

export type Issue = { issue: string; dataset: string; depth_from: number | null; depth_to: number | null; value: string; evidence: string; hole?: string; key?: string | null };

export type DatasetRow = {
  name: string; dsid: string; instrument: string; kept: boolean; reason: string;
  n_samples?: number; step_mm?: number; swir_valid?: number; bins_kept?: number; tir?: string; tir_dropped?: number; tokens?: number; depth?: [number, number];
};

export type ResultSummary = {
  run: string; seconds: number | null; model: { run: string; name: string; step?: number | null; description?: string };
  summary: { strip: number[]; n_segments: number; metres: number; main_types: [string, number][]; n_flag: number; gold_top: number | null; again?: Again;
    tir_acc: number | null; tir_r2: number | null; gold_auc: number | null; anom_auc: number | null; gold_top10?: number | null; gold_base?: number | null };
  tir: { r2: number | null; acc: number | null; measured: boolean };
  anomaly: { n_flag_m: number; share_flag: number; flag_raw: number; median_raw: number; auc_gold: number | null; au_m: number; au_pos: number };
  gold: { auc: number | null; au_m: number; au_pos: number; top10_share?: number; base_share?: number };
};

/** One side (SWIR or TIR) of a spectral-log interval: samples in it, samples with a TSG result, and each group's
 * share of those, weighted by the software's Wt1–3 (shares sum to 1). */
export type SpectralSide = { n: number; n_result: number; mix: Record<string, number> };
/** The TSG mineral-group make-up down the hole, worked out once when the hole was read (1 m or 0.1 m intervals). */
export type SpectralLog = { key: string; step: number; from_m: number; to_m: number; swir_groups: string[]; tir_groups: string[]; tir: string;
  rows: { from_m: number; swir: SpectralSide | null; tir: SpectralSide | null }[] };
/** A model's reading of every 10 cm token of a hole: the per-metre `anom` of ModelView is the maximum of these
 * over the metre, the per-metre `core` their mode. `bin` is the depth in 10 cm (bin 123 = 12.3–12.4 m), `anom` the State percentile, `anom_raw` the
 * contrast against ±15 m; a metre is flagged when its highest token reaches both `flag_at` and `flag_raw`. */
export type TokenScores = { run: string; step_m: 0.1; n: number; flag_at: number | null; flag_raw: number | null; bin: number[]; anom: number[]; anom_raw: number[];
  /** the model's core type per token (its per-metre value is the mode); absent for a hole read before the service sent it */
  core?: number[]; core_types: { k: number; name: string; share: number }[] };
export type Metres = { m: number[]; gs: string[]; ms: string[]; gt: string[]; lith: string[]; lith_raw: string[]; au: (number | null)[] };

export type HoleDetail = HoleRow & {
  meta: Record<string, unknown> & { tsg?: Record<string, unknown>; n_tokens?: number; seen_in_training?: boolean };
  report: { funnel?: Record<string, number>; rules?: { step: string; rule: string }[] };
  strip: number[]; datasets: DatasetRow[]; issues: Issue[]; metres: Metres; results: ResultSummary[];
};

export type Segment = {
  seg: number; from_m: number; to_m: number; core_type: number; length_m: number; core_type_name: string; boundary: number | null;
  swir_minerals: [string, string, number][]; tir_groups: [string, string, number][]; w2200_nm: number | null; w2250_nm: number | null; albedo: number | null;
  desc_en: string; desc_zh: string;
};

export type ModelView = {
  run: string; m: number[]; core: number[]; anom: number[]; anom_raw: number[]; gold: number[]; gold_pct: number[];
  tir_pred: string[]; tir_conf: (number | null)[]; has_tir: boolean[];
  tir: ResultSummary["tir"];
  anomaly: ResultSummary["anomaly"] & { flag_at: number; top_share: number; runs: { from_m: number; to_m: number; peak_m: number; peak: number; raw: number }[] };
  gold_summary: ResultSummary["gold"] & { top: { m: number; p: number; au: number | null }[] };
  core_types: { k: number; name: string; name_zh?: string; share: number }[];
  segments: Segment[]; summary: ResultSummary["summary"]; model: ResultSummary["model"]; seconds: number | null;
};

export type Why = { feat: string; en: string; zh: string; z: number; value: number | null; ring: number | null };

export type MetreView = {
  metre: number; n_tokens: number; swir_wl: number[]; tir_wl: number[];
  swir: number[]; swir_ring: number[] | null; tir: number[] | null; tir_ring: number[] | null;
  mix_swir: Record<string, number>; mix_swir_ring: Record<string, number>; mix_tir: Record<string, number>; mix_tir_ring: Record<string, number>;
  why: Why[]; lith_raw: string; au: number | null;
  model: null | { run: string; core: number; anom: number; anom_raw: number; gold: number; gold_pct: number; tir_group: string; tir_conf: number | null;
    has_tir: boolean; tir_wl: number[] | null; tir_pred: number[] | null };
};

export type SimilarHit = {
  hole: string; key: string | null; from_m: number; to_m: number; sim: number; gs: string; gt: string; gs_en: string; gt_en: string;
  rock: string; au: number | null; lat: number | null; lon: number | null; region: string; split: string;
};
export type SimilarScope = "state" | "nearby" | "region" | "hole";
/** A whole hole against another, metre by metre on the model's representation: `score` is the mean best cosine of each metre in
 * the other hole (both ways); `rho` says whether the other hole repeats this one's order down the hole (1 same order, -1 reversed). */
export type SimilarHole = { key: string; name: string; region: string; operator: string; project: string; target: string; lon: number | null; lat: number | null; km: number | null;
  score: number; rho: number | null; n: number };
export type SimilarHolesView = { model: string; scope: SimilarScope; km: number | null; region: string | null; n_candidates: number; compared: number;
  mine: { n: number; from_m: number; to_m: number }; results: SimilarHole[] };
export type SimilarView = { model: string; library: { intervals: number; holes: number }; results: SimilarHit[];
  query: { from_m: number; to_m: number; metres?: number; scope?: SimilarScope; km?: number | null; region?: string | null; gs: string; gt: string; rock: string } };

/** `box`: the row's band in the photograph, as fractions; `xmm`: where along the scan its first and last samples lie (mm). */
export type TrayRow = { from_m: number; to_m: number; box?: [number, number, number, number]; xmm?: [number, number] };
export type Tray = { id: string; dataset: string; n: number; from_m: number; to_m: number; width: number; height: number; rows: TrayRow[] };

export type CoreModelInfo = {
  run: string; name: string; kind: "model" | "baseline"; description: string; default: boolean;
  card: Record<string, unknown> & { tir?: { model: number; base: number }; seg_auto?: { test_f1: number; median_m: number }; seg_pairs?: { base: number };
    au_sup?: { model: number | null; base: number | null }; au_unsup?: { model: number | null; base: number | null }; gold_test?: { auc: number | null; n: number };
    retrieval?: { k: number; chance: number; hole_mean: { model: number | null; pca: number | null } }; lib_intervals?: number; lib_holes?: number };
};

export type IssueList = { counts: { issue: string; rows: number; holes: number }[]; n: number; rows: Issue[] };

// One in-flight refresh shared by concurrent 401s.
// every call goes through the shared client: token, one refresh on 401, retry
const call = (path: string, init: RequestInit = {}) => platformFetch(`/core-scan/api${path}`, init);

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await call(path, init);
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; message?: string; detail?: string };
    throw new CoreError(res.status, b.message || b.detail || b.error || `request failed (${res.status})`, b.error);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const enc = encodeURIComponent;

/** The model's name as readers see it: HyFormer. The platform may still hold the names a worker announced before the
 * rename ("CoreTrace-MAE", "CoreTrace-MAE+DINO"…) until the worker announces its models again. */
export const modelName = (name: string) => name.replace(/^CoreTrace-MAE/, "HyFormer");


export const coreScan = {
  models: () => json<CoreModelInfo[]>("/models/").then((ms) => ms.map((m) => ({ ...m, name: modelName(m.name) }))),
  holes: () => json<{ holes: HoleRow[]; n: number; core_types: { k: number; name: string }[] }>("/holes/"),
  hole: (key: string) => json<HoleDetail>(`/holes/${enc(key)}/`),
  package: (key: string) => json<HolePackage>(`/holes/${enc(key)}/package/`),
  /** Every ~8 mm sample of a window (up to 20 m), from the mirrored package; 404 for an upload, 503 when the service is away. */
  samples: (key: string, from: number, to: number, spectra = false) => json<SampleView>(`/holes/${enc(key)}/samples/?from=${from}&to=${to}${spectra ? "&spectra=1" : ""}`),
  /** The full-resolution line-scan photograph of a window (up to 5 m), as an image URL. */
  linescanUrl: (key: string, from: number, to: number, width = 600) => `${CORE_BASE}/holes/${enc(key)}/linescan.jpg?from=${from}&to=${to}&width=${width}`,
  /** The hole as a line in space, with the holes within `km` and what to highlight. */
  trace: (key: string, km = 0) => json<TraceView>(`/holes/${enc(key)}/trace/?km=${km}`),
  regions: () => json<RegionsView>(`/regions/`),
  standout: (key: string, run: string) => json<Standout>(`/holes/${enc(key)}/standout/?model=${enc(run)}`),
  /** The 10 cm bins of a depth window (up to 50 m): the scanner's reading of each. */
  bins: (key: string, from: number, to: number) => json<{ from_m: number; to_m: number; bins: Bin[] }>(`/holes/${enc(key)}/bins/?from=${from}&to=${to}`),
  /** The SWIR / TIR group make-up: the whole hole at 1 m, or a window of up to 50 m at 0.1 m. 404 when the hole has none. */
  spectralLog: (key: string, step: 1 | 0.1, from?: number, to?: number) =>
    json<SpectralLog>(`/holes/${enc(key)}/spectral-log/?step=${step}${from !== undefined && to !== undefined ? `&from=${from}&to=${to}` : ""}`),
  /** A model's unusual score per 10 cm token: the whole hole, or a depth window in metres. 404 while a hole has none. */
  tokenScores: (key: string, run: string, from?: number, to?: number) =>
    json<TokenScores>(`/holes/${enc(key)}/models/${enc(run)}/tokens/${from !== undefined && to !== undefined ? `?from=${from}&to=${to}` : ""}`),
  /** One bin's own mean spectra. */
  bin: (key: string, bin: number) => json<BinSpectra>(`/holes/${enc(key)}/bins/${bin}/`),
  /** The holes within `km` of this one, nearest first, each with its distance. */
  nearby: (key: string, km: number) => json<{ km: number; holes: (HoleRow & { km: number })[] }>(`/holes/${enc(key)}/nearby/?km=${km}`),
  /** Every interval where the model disagrees with the log, across the holes the caller may see. */
  lookAgain: (state = "", q = "", limit = 2000) => json<AgainSheet>(`/look-again/?state=${enc(state)}&q=${enc(q)}&limit=${limit}`),
  reviews: (key: string) => json<{ reviews: Review[] }>(`/holes/${enc(key)}/reviews/`),
  /** Records the signed-in person's verdict, replacing an earlier one on the same suggestion. */
  review: (key: string, body: ReviewBody) => json<{ verdict: string; note: string; at: string }>(`/holes/${enc(key)}/reviews/`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  unreview: (key: string, body: Omit<ReviewBody, "verdict">) => json<void>(`/holes/${enc(key)}/reviews/`, { method: "DELETE", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  /** 404 when the scan names no report. */
  report: (key: string) => json<HoleReport>(`/holes/${enc(key)}/report/`),
  documents: (key: string) => json<HoleDocuments>(`/holes/${enc(key)}/documents/`),
  model: (key: string, run: string) => json<ModelView>(`/holes/${enc(key)}/models/${enc(run)}/`).then((v) => v.model ? { ...v, model: { ...v.model, name: modelName(v.model.name) } } : v),
  metre: (key: string, m: number, run: string) => json<MetreView>(`/holes/${enc(key)}/metres/${m}/?model=${enc(run)}`),
  /** Core like a stretch of this hole: one metre, or a window; where to look is the scope. */
  similar: (key: string, at: { m: number } | { from: number; to: number }, run: string, scope: SimilarScope = "state", km = 10) =>
    json<SimilarView>(`/holes/${enc(key)}/similar/?${"m" in at ? `m=${at.m}` : `from=${at.from}&to=${at.to}`}&model=${enc(run)}&scope=${scope}&km=${km}`),
  /** Holes like this one as a whole, metre by metre on the model's representation; 404 when the hole has no metre vectors yet. */
  similarHoles: (key: string, run: string, scope: Exclude<SimilarScope, "hole"> = "state", km = 25) => json<SimilarHolesView>(`/holes/${enc(key)}/similar-holes/?model=${enc(run)}&scope=${scope}&km=${km}`),
  trays: (key: string) => json<{ trays: Tray[] }>(`/holes/${enc(key)}/trays/`),
  /** The original of a tray photograph as a deep-zoom pyramid; 404 for an upload (no original kept). */
  trayZoom: (key: string, id: string) => json<{ width: number; height: number; tile: number; overlap: number; format: string }>(`/holes/${enc(key)}/trays/${id}/zoom/`),
  trayZoomTile: (key: string, id: string, level: number, x: number, y: number) => `${CORE_BASE}/holes/${enc(key)}/trays/${id}/zoom/${level}/${x}_${y}.jpg`,
  issues: (issue = "", hole = "", limit = 200) => json<IssueList>(`/issues/?issue=${enc(issue)}&hole=${enc(hole)}&limit=${limit}`),
  remove: (key: string) => json<void>(`/holes/${enc(key)}/`, { method: "DELETE" }),
  /** A tray photograph as an object URL (the caller revokes it). Fetched, not linked, so a private hole's photograph carries the session. */
  async trayImage(key: string, id: string): Promise<string> {
    const res = await call(`/holes/${enc(key)}/trays/${id}.jpg`);
    if (!res.ok) throw new CoreError(res.status, "photograph not available");
    return URL.createObjectURL(await res.blob());
  },
  async segmentsCsv(key: string, run: string): Promise<Blob> {
    const res = await call(`/holes/${enc(key)}/models/${enc(run)}/segments.csv`);
    if (!res.ok) throw new CoreError(res.status, "export not available");
    return res.blob();
  },
};

function putPart(key: string, n: number, blob: Blob, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${CORE_BASE}/scans/${enc(key)}/parts/${n}/`);
    const tok = authToken();
    if (tok) xhr.setRequestHeader("Authorization", `Bearer ${tok}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let b: { error?: string; message?: string } = {};
      try { b = JSON.parse(xhr.responseText); } catch { /* empty */ }
      reject(new CoreError(xhr.status, b.message || b.error || `upload failed (${xhr.status})`, b.error));
    };
    xhr.onerror = () => reject(new CoreError(0, "network error during upload"));
    xhr.send(blob);
  });
}

/** Upload a scan (a zip of TSG files) in parts. One request cannot carry a multi-gigabyte
 * file past the proxy, and a part that fails is sent again without starting over.
 * Resolves with the hole once it is queued for processing. */
export async function uploadScan(name: string, file: File, onProgress: (frac: number) => void): Promise<HoleRow> {
  // a long upload must not outlive its token
  await sharedRefresh();
  const PART = 32 * 1024 * 1024;
  const parts = Math.max(1, Math.ceil(file.size / PART));
  const start = await json<{ key: string; part_bytes: number; parts: number }>("/scans/", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, size: file.size, parts, filename: file.name }),
  });
  let done = 0;
  for (let n = 0; n < parts; n++) {
    const blob = file.slice(n * PART, Math.min(file.size, (n + 1) * PART));
    for (let attempt = 1; ; attempt++) {
      try {
        await putPart(start.key, n, blob, (loaded) => onProgress((done + loaded) / file.size));
        break;
      } catch (e) {
        const err = e as CoreError;
        if (err.status === 401 && attempt === 1) { await sharedRefresh(); continue; }
        if ((err.status === 0 || err.status >= 500) && attempt < 4) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
        throw e;
      }
    }
    done += blob.size;
    onProgress(done / file.size);
  }
  return json<HoleRow>(`/scans/${enc(start.key)}/complete/`, { method: "POST" });
}

export const ACTIVE: HoleStatus[] = ["awaiting_upload", "queued", "reading", "cleaning", "modelling"];

/** The NVCL nodes, in the order the map lists them, and whose core library each scan is from. */
export const STATES: { id: string; name: string; survey: string }[] = [
  { id: "WA", name: "Western Australia", survey: "Geological Survey of Western Australia" },
  { id: "NSW", name: "New South Wales", survey: "Geological Survey of New South Wales" },
  { id: "QLD", name: "Queensland", survey: "Geological Survey of Queensland" },
  { id: "SA", name: "South Australia", survey: "Geological Survey of South Australia" },
  { id: "NT", name: "Northern Territory", survey: "Northern Territory Geological Survey" },
  { id: "TAS", name: "Tasmania", survey: "Mineral Resources Tasmania" },
  { id: "VIC", name: "Victoria", survey: "Geological Survey of Victoria" },
  { id: "CSIRO", name: "CSIRO", survey: "CSIRO" },
];
/** "Gold", "Platinum group elements": a commodity as the site writes it. */
export const commodityName = (c: string) => (c ? c[0].toUpperCase() + c.slice(1) : "");
/** "8 Oct 2026": when the platform last read the scan, or "" when it has not. */
export const readDate = (h: { processed_at: string | null }, long = false) =>
  h.processed_at ? new Date(h.processed_at).toLocaleDateString("en-AU", { day: "numeric", month: long ? "long" : "short", year: "numeric" }) : "";
/** "NVCL WA · 8 Oct 2026" / "Your scan · 8 Oct 2026": where a hole's scan came from and when it was read. */
export const sourceLabel = (h: { source: string; state: string; processed_at: string | null }) =>
  [h.source === "upload" ? "Your scan" : `NVCL ${h.state || "WA"}`, readDate(h)].filter(Boolean).join(" · ");

/** A WAMEX abstract is one run of "Location: … Geology: … Work done: … Results: …"; split it into its labelled parts.
 * An abstract without labels comes back as one unlabelled part. */
export function abstractParts(abstract: string): { label: string; text: string }[] {
  const clean = abstract.replace(/&nbsp;|&amp;/g, (m) => (m === "&amp;" ? "&" : " ")).replace(/\s+/g, " ").trim();
  const re = /(Location|Geology|Work done|Results|Conclusions(?: (?:&|and) Recommendations)?|Recommendations|Prospects|Assays|Tenements?)\s*:\s*/gi;
  const parts: { label: string; text: string }[] = []; let m: RegExpExecArray | null; let last: { label: string; at: number } | null = null;
  while ((m = re.exec(clean))) { if (last) parts.push({ label: last.label, text: clean.slice(last.at, m.index).trim() }); last = { label: m[1], at: m.index + m[0].length }; }
  if (last) parts.push({ label: last.label, text: clean.slice(last.at).trim() }); else if (clean) parts.push({ label: "", text: clean });
  return parts.filter((p) => p.text);
}

/** What a mirrored report file is, from its name: the OCR'd report, drill data, GIS, a 3D model, appendices. */
export function reportFileKind(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return n.includes("(ocr)") ? "Report (PDF, searchable)" : "Report (PDF)";
  if (/drill/.test(n)) return "Drill data";
  if (/gis/.test(n)) return "GIS files";
  if (/3d/.test(n)) return "3D model";
  if (/append/.test(n)) return "Appendices";
  if (/log/.test(n)) return "Logging codes";
  return n.endsWith(".zip") ? "Archive" : "File";
}
export const surveyOf = (state: string) => STATES.find((s) => s.id === state)?.survey ?? "the National Virtual Core Library";
