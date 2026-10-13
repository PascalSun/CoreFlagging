// Core scans (CoreTrace): the platform's core_scan API.
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

export type HoleRow = {
  key: string; name: string; source: "nvcl" | "upload"; status: HoleStatus; message: string; progress: number;
  lon: number | null; lat: number | null; state: string; offshore: boolean; operator: string; project: string; region: string; instrument: string;
  depth_min: number | null; depth_max: number | null; tir: string; has_lith: boolean; au_m: number; au_pos_m: number;
  n_issues: number; n_again: number; again_m: number; split: string; is_public: boolean; mine: boolean; updated: string; processed_at: string | null; strip?: number[];
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
export type Review = { run: string; kind: "log" | "flag"; from_m: number; to_m: number; verdict: "agree" | "disagree"; note: string; mine: boolean; at: string };
export type ReviewBody = { run: string; kind: "log" | "flag"; from_m: number; to_m: number; verdict: "agree" | "disagree"; note?: string };

/** The exploration report a hole was logged in: the mirror's files (the OCR'd PDF first) and the abstract. */
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
export type SimilarView = { model: string; library: { intervals: number; holes: number }; results: SimilarHit[]; query: { from_m: number; to_m: number; gs: string; gt: string; rock: string } };

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

export const coreScan = {
  models: () => json<CoreModelInfo[]>("/models/"),
  holes: () => json<{ holes: HoleRow[]; n: number; core_types: { k: number; name: string }[] }>("/holes/"),
  hole: (key: string) => json<HoleDetail>(`/holes/${enc(key)}/`),
  /** Every interval where the model disagrees with the log, across the holes the caller may see. */
  lookAgain: (state = "", q = "", limit = 2000) => json<AgainSheet>(`/look-again/?state=${enc(state)}&q=${enc(q)}&limit=${limit}`),
  reviews: (key: string) => json<{ reviews: Review[] }>(`/holes/${enc(key)}/reviews/`),
  /** Records the signed-in person's verdict, replacing an earlier one on the same suggestion. */
  review: (key: string, body: ReviewBody) => json<{ verdict: string; note: string; at: string }>(`/holes/${enc(key)}/reviews/`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  unreview: (key: string, body: Omit<ReviewBody, "verdict">) => json<void>(`/holes/${enc(key)}/reviews/`, { method: "DELETE", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  /** 404 when the scan names no report. */
  report: (key: string) => json<HoleReport>(`/holes/${enc(key)}/report/`),
  model: (key: string, run: string) => json<ModelView>(`/holes/${enc(key)}/models/${enc(run)}/`),
  metre: (key: string, m: number, run: string) => json<MetreView>(`/holes/${enc(key)}/metres/${m}/?model=${enc(run)}`),
  similar: (key: string, m: number, run: string) => json<SimilarView>(`/holes/${enc(key)}/similar/?m=${m}&model=${enc(run)}`),
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
