// The Core Flagging assistant's tools: read the platform's core-scan API as the signed-in user, so
// a private upload is visible to its owner and to nobody else, exactly as on the map.
//
// One tool runs in the browser (open_hole): it moves the map page to a hole and metre, so an
// answer can show the reader what it is talking about.

import { tool } from "ai";
import { z } from "zod";

import { modelView } from "@/lib/ai/model-view";

const PLATFORM = (process.env.PLATFORM_API_URL ?? process.env.NEXT_PUBLIC_PLATFORM_URL ?? "http://localhost:8001").replace(/\/$/, "");
const err = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });
const r3 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v ?? null);

type Row = { key: string; name: string; source: string; status: string; state: string; offshore: boolean; operator: string; project: string; region: string; instrument: string;
  depth_min: number | null; depth_max: number | null; tir: string; au_m: number; au_pos_m: number; n_issues: number; split: string; mine: boolean; lat: number | null; lon: number | null };

export function coretraceTools(token: string) {
  const get = async <T,>(path: string): Promise<T> => {
    const res = await fetch(`${PLATFORM}/core-scan/api${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (res.status === 404) throw new Error("not found");
    if (!res.ok) throw new Error(`platform answered ${res.status}`);
    return (await res.json()) as T;
  };
  let listCache: Promise<Row[]> | null = null;
  const holes = () => (listCache ??= get<{ holes: Row[] }>("/holes/").then((d) => d.holes));
  /** A hole the reader names ("mnd036", "Wilson Cliffs 1") → its key. */
  const resolve = async (name: string): Promise<Row> => {
    const all = await holes(); const n = name.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = all.find((h) => h.key.toLowerCase() === n) ?? all.find((h) => h.name.toLowerCase() === n)
      ?? all.find((h) => h.name.toLowerCase().replace(/[^a-z0-9]/g, "") === n.replace(/[^a-z0-9]/g, ""));
    if (!hit) throw new Error(`no hole called "${name}" (use find_holes)`);
    if (hit.status !== "ready") throw new Error(`${hit.name} is not processed yet (status: ${hit.status})`);
    return hit;
  };
  const geo = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${PLATFORM}/geo/api${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
    if (!res.ok) throw new Error(`platform answered ${res.status}`);
    return (await res.json()) as T;
  };
  /** Same-origin stream of one document file, for the in-page viewer. */
  const docUrl = (corpus: string, key: string, file: string) => corpus === "wamex"
    ? `/geo/api/wamex/report/${encodeURIComponent(key)}/${encodeURIComponent(file)}`
    : `/geo/api/doc/file/?corpus=${encodeURIComponent(corpus)}&key=${encodeURIComponent(key)}&filename=${encodeURIComponent(file)}`;
  const corpus = z.enum(["wamex", "hylogger", "ebookshop", "geolit"]).optional().describe("Which document store: wamex (WA open-file exploration reports, default), hylogger (NVCL and GSWA HyLogger reports for every State), ebookshop (GSWA publications), geolit (peer-reviewed papers).");
  const defaultRun = async (run?: string) => run || (await get<{ run: string; default: boolean }[]>("/models/")).find((m) => m.default)?.run || "v2";
  const hole = z.string().describe("Hole key as the tools return it, e.g. 'MND036', 'Wilson Cliffs 1' or 'NSW-NKD002' (holes outside WA are prefixed with their State).");
  const model = z.string().optional().describe("Model run: v2 (HyFormer, default), s2_mae_dino, s2_mae_jepa, baseline (conventional methods).");

  return {
    find_holes: tool({
      description: "Search the scanned holes (every Australian State's NVCL core library, plus uploads) by name, company, project or region, with optional filters. Returns up to `limit` holes with collar, depth, instrument and counts.",
      inputSchema: z.object({
        query: z.string().optional().describe("Words to match in name, company, project or region."),
        state: z.enum(["WA", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "CSIRO"]).optional().describe("Only holes from this State's core library."),
        processed_only: z.boolean().default(true),
        with_assays: z.boolean().optional().describe("Only holes whose scan carries gold assays."),
        with_issues: z.boolean().optional(), no_tir: z.boolean().optional().describe("Only holes without thermal infrared."),
        mine: z.boolean().optional().describe("Only the reader's own uploads."),
        limit: z.number().int().min(1).max(50).default(15),
      }),
      toModelOutput: modelView(),
      execute: async (a) => {
        try {
          const q = (a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
          const all = await holes();
          const hits = all.filter((h) => (!a.processed_only || h.status === "ready") && (!a.state || h.state === a.state) && (!a.with_assays || h.au_m > 0) && (!a.with_issues || h.n_issues > 0)
            && (!a.no_tir || h.tir !== "ok") && (!a.mine || h.mine)
            && q.every((w) => `${h.name} ${h.operator} ${h.project} ${h.region}`.toLowerCase().includes(w)));
          return { total_holes: all.length, by_state: Object.fromEntries([...new Set(all.map((h) => h.state || "upload"))].map((k) => [k, all.filter((h) => (h.state || "upload") === k).length])), processed: all.filter((h) => h.status === "ready").length, matches: hits.length,
            holes: hits.slice(0, a.limit).map((h) => ({ hole: h.key, state: h.state, status: h.status, operator: h.operator, project: h.project, region: h.region, instrument: h.instrument,
              depth_m: [r3(h.depth_min), r3(h.depth_max)], tir: h.tir, assayed_m: h.au_m, au_ge_0_1ppm_m: h.au_pos_m, issues: h.n_issues, lat: r3(h.lat), lon: r3(h.lon), upload: h.source === "upload" })) };
        } catch (e) { return err(e); }
      },
    }),

    hole_summary: tool({
      description: "One hole: collar, instrument, cleaning report, data-quality issues, and each model's headline results (segments, unusual metres, TIR agreement, gold ranking against assays).",
      inputSchema: z.object({ hole }),
      toModelOutput: modelView(),
      execute: async ({ hole: name }) => {
        try {
          const h = await resolve(name);
          type D = { meta: Record<string, unknown>; report: { funnel?: Record<string, number> }; issues: { issue: string; depth_from: number | null; depth_to: number | null; value: string; evidence: string }[];
            results: { run: string; model: { name: string }; summary: { n_segments: number; main_types: [string, number][]; gold_top: number | null }; tir: unknown; anomaly: { n_flag_m: number; auc_gold: number | null }; gold: { auc: number | null; top10_share?: number; base_share?: number } }[] };
          const d = await get<D>(`/holes/${encodeURIComponent(h.key)}/`);
          return { hole: h.key, state: h.state, operator: h.operator, project: h.project, region: h.region, instrument: h.instrument, depth_m: [h.depth_min, h.depth_max],
            training_split: h.split || "not in the training list", tir: h.tir, assayed_m: h.au_m, au_ge_0_1ppm_m: h.au_pos_m, funnel: d.report.funnel,
            issues: d.issues.map((i) => ({ issue: i.issue, from_m: i.depth_from, to_m: i.depth_to, value: i.value, evidence: i.evidence })),
            models: d.results.map((r) => ({ run: r.run, name: r.model?.name, segments: r.summary.n_segments, main_core_types: r.summary.main_types, unusual_metres: r.anomaly.n_flag_m,
              unusual_vs_gold_auc: r.anomaly.auc_gold, gold_auc_on_this_hole: r.gold.auc, gold_top10_share: r.gold.top10_share, gold_base_share: r.gold.base_share,
              highest_gold_likelihood_at_m: r.summary.gold_top, tir: r.tir })) };
        } catch (e) { return err(e); }
      },
    }),

    hole_log: tool({
      description: "A model's reading of a whole hole: the auto log (segments with depths, core type and description), the flagged unusual intervals, and the metres ranked highest for gold (with assays where the scan has them).",
      inputSchema: z.object({ hole, model }),
      toModelOutput: modelView(),
      execute: async ({ hole: name, model: run }) => {
        try {
          const h = await resolve(name); const m = await defaultRun(run);
          type V = { segments: { from_m: number; to_m: number; core_type_name: string; desc_en: string }[]; anomaly: { runs: { from_m: number; to_m: number; peak_m: number; peak: number }[]; n_flag_m: number };
            gold_summary: { top: { m: number; p: number; au: number | null }[]; auc: number | null } };
          const v = await get<V>(`/holes/${encodeURIComponent(h.key)}/models/${encodeURIComponent(m)}/`);
          return { hole: h.key, state: h.state, model: m, segments: v.segments.map((s) => ({ from_m: s.from_m, to_m: s.to_m, core_type: s.core_type_name, description: s.desc_en })),
            unusual_intervals: v.anomaly.runs.map((x) => ({ from_m: x.from_m, to_m: x.to_m, peak_m: x.peak_m, state_percentile: r3(x.peak) })),
            gold_ranked_metres: v.gold_summary.top.map((g) => ({ m: g.m, likelihood: r3(g.p), assay_ppm: g.au })), gold_auc_on_this_hole: v.gold_summary.auc };
        } catch (e) { return err(e); }
      },
    }),

    unusual_10cm: tool({
      description: "The model's unusual score for every 10 cm of a depth window (up to 50 m): which 10 cm pieces make a metre stand out. Each row is a 10 cm bin with its State percentile and raw contrast against the 15 m either side; a metre is flagged when its highest 10 cm reaches both thresholds returned. Use after hole_log to see where in a flagged interval the signal sits.",
      inputSchema: z.object({ hole, from_m: z.number().describe("Top of the window in metres."), to_m: z.number().describe("Bottom of the window in metres, at most 50 m below the top."), model }),
      toModelOutput: modelView(),
      execute: async ({ hole: name, from_m, to_m, model: run }) => {
        try {
          const h = await resolve(name); const m = await defaultRun(run);
          if (!(to_m > from_m) || to_m - from_m > 50) return { error: "to_m must be above from_m and at most 50 m below it" };
          type T = { flag_at: number | null; flag_raw: number | null; bin: number[]; anom: number[]; anom_raw: number[] };
          const t = await get<T>(`/holes/${encodeURIComponent(h.key)}/models/${encodeURIComponent(m)}/tokens/?from=${from_m}&to=${to_m}`);
          return { hole: h.key, state: h.state, model: m, flag_thresholds: { state_percentile: t.flag_at, raw_contrast: t.flag_raw },
            bins: t.bin.map((b, i) => ({ from_m: Math.round(b) / 10, state_percentile: r3(t.anom[i]), raw_contrast: r3(t.anom_raw[i]),
              above_flag: t.flag_at !== null && t.flag_raw !== null && t.anom[i] >= t.flag_at && t.anom_raw[i] >= t.flag_raw })) };
        } catch (e) { return err(e); }
      },
    }),

    metre_detail: tool({
      description: "One metre of one hole: logged rock and assay, the TSG software's minerals in it and in the 15 m around it, the spectral features that set it apart, and the model's readings (core type, unusual percentile, gold likelihood, TIR group filled in from SWIR).",
      inputSchema: z.object({ hole, m: z.number().int().describe("Depth in metres; the metre from m to m+1."), model }),
      toModelOutput: modelView(),
      execute: async ({ hole: name, m, model: run }) => {
        try {
          const h = await resolve(name); const mm = await defaultRun(run);
          type M = { n_tokens: number; lith_raw: string; au: number | null; mix_swir: unknown; mix_swir_ring: unknown; mix_tir: unknown; mix_tir_ring: unknown; why: { en: string; z: number }[];
            model: null | { core: number; anom: number; gold: number; gold_pct: number; tir_group: string; tir_conf: number | null; has_tir: boolean } };
          const d = await get<M>(`/holes/${encodeURIComponent(h.key)}/metres/${m}/?model=${encodeURIComponent(mm)}`);
          return { hole: h.key, state: h.state, metre: `${m}-${m + 1} m`, valid_10cm_bins: d.n_tokens, logged_rock: d.lith_raw || null, au_ppm: d.au,
            swir_minerals: d.mix_swir, swir_minerals_around: d.mix_swir_ring, tir_groups: d.mix_tir, tir_groups_around: d.mix_tir_ring,
            stands_apart_by: d.why.map((w) => `${w.en} (${w.z > 0 ? "+" : ""}${w.z} sd)`),
            model: d.model && { run: mm, unusual_state_percentile: r3(d.model.anom), gold_likelihood: r3(d.model.gold), gold_percentile: r3(d.model.gold_pct),
              tir_group: d.model.tir_group, tir_measured: d.model.has_tir, tir_confidence: r3(d.model.tir_conf) } };
        } catch (e) { return err(e); }
      },
    }),

    similar_core: tool({
      description: "Core elsewhere in Western Australia that looks like the 2 m starting at metre m of a hole: the model's fingerprint of that interval against every interval of the State's library (cosine; holes within 5 km left out, one interval per hole).",
      inputSchema: z.object({ hole, m: z.number().int(), model }),
      toModelOutput: modelView(),
      execute: async ({ hole: name, m, model: run }) => {
        try {
          const h = await resolve(name); const mm = await defaultRun(run);
          type S = { results: { hole: string; from_m: number; to_m: number; sim: number; gs_en: string; gt_en: string; rock: string; au: number | null; region: string }[] };
          const d = await get<S>(`/holes/${encodeURIComponent(h.key)}/similar/?m=${m}&model=${encodeURIComponent(mm)}`);
          return { hole: h.key, state: h.state, from_m: m, to_m: m + 2, matches: d.results.map((x) => ({ hole: x.hole, from_m: x.from_m, to_m: x.to_m, similarity: x.sim, swir: x.gs_en, tir: x.gt_en, rock: x.rock || null, au_ppm: x.au, region: x.region })) };
        } catch (e) { return err(e); }
      },
    }),

    quality_issues: tool({
      description: "Data-quality issues across the State's scanned holes: counts per issue type, and rows filtered by issue type or hole name.",
      inputSchema: z.object({ issue: z.string().optional().describe("Issue code, e.g. core_gap, tir_none, elevation_missing."), hole: z.string().optional(), limit: z.number().int().min(1).max(100).default(30) }),
      toModelOutput: modelView(),
      execute: async ({ issue, hole: name, limit }) => {
        try {
          const d = await get<{ counts: unknown; n: number; rows: unknown[] }>(`/issues/?issue=${encodeURIComponent(issue ?? "")}&hole=${encodeURIComponent(name ?? "")}&limit=${limit}`);
          return d;
        } catch (e) { return err(e); }
      },
    }),

    hole_documents: tool({
      description: "The documents behind a hole: its own HyLogger PDFs (the NVCL spectral summary report for every State; GSWA's mineralogy histograms and HyLogger record in WA) and, for a WA hole, the WAMEX open-file exploration reports it was logged in (with abstract and files) plus the reports whose footprint covers the collar. Holes outside WA have no WAMEX report: the answer names the State survey's portal instead. Call this first for any question about a hole's report, paperwork or PDF.",
      inputSchema: z.object({ hole }),
      toModelOutput: modelView(),
      execute: async ({ hole: name }) => {
        try {
          const h = await resolve(name);
          type D = { hole: string; name: string; state: string; portal: { name: string; url: string } | null;
            hole_pdfs: { corpus: string; key: string; kind: string; title: string; pages: number | null; file: string }[];
            wamex: null | { linked: { anumber: string; found_by: string; title?: string; year?: number | null; type?: string; company?: string | null; commodities?: string | null; url: string; abstract?: string | null; pdf?: string | null; files?: { name: string; bytes: number }[] }[];
              covering: { anumber: string; title: string; year: number | null; type: string; company: string | null; commodities: string | null; abstract?: string; url?: string }[]; covering_count: number } };
          const d = await get<D>(`/holes/${encodeURIComponent(h.key)}/documents/`);
          // the interface draws this tool's output as a document list with links; the first pages of every report the hole was
          // logged in (else its own summary PDF) come along, so each gets a summary without further calls
          const firstPages = async (corpus: string, key: string, file: string) => {
            try {
              const q = new URLSearchParams({ corpus, key, file, pages: "1-3" });
              const t = await geo<{ pages: { page: number; text: string }[] }>(`/doc/text/?${q}`);
              return t.pages.map((pg) => ({ page: pg.page, text: pg.text.slice(0, 3000) }));
            } catch { return null; }
          };
          const linked = (d.wamex?.linked ?? []).filter((r) => r.pdf).slice(0, 3);
          const read = linked.length
            ? await Promise.all(linked.map(async (r) => ({ corpus: "wamex", key: r.anumber, file: r.pdf as string, title: `${r.anumber} · ${r.title ?? ""}`, first_pages: await firstPages("wamex", r.anumber, r.pdf as string) })))
            : d.hole_pdfs[0] ? [{ corpus: d.hole_pdfs[0].corpus, key: d.hole_pdfs[0].key, file: d.hole_pdfs[0].file, title: d.hole_pdfs[0].title, first_pages: await firstPages(d.hole_pdfs[0].corpus, d.hole_pdfs[0].key, d.hole_pdfs[0].file) }] : [];
          return { hole: h.key, state: h.state, operator: h.operator, project: h.project,
            hole_pdfs: d.hole_pdfs.map((p) => ({ corpus: p.corpus, key: p.key, file: p.file, kind: p.kind, title: p.title, pages: p.pages, url: docUrl(p.corpus, p.key, p.file) })),
            wamex: d.wamex ? { note: "WAMEX is Western Australia's open-file exploration report system.",
              reports_this_hole_was_logged_in: d.wamex.linked.map((r) => ({ anumber: r.anumber, found_by: r.found_by, title: r.title, year: r.year, type: r.type, company: r.company, commodities: r.commodities,
                abstract: r.abstract ? r.abstract.slice(0, 700) : null, pdf: r.pdf, url: r.pdf ? docUrl("wamex", r.anumber, r.pdf) : null, files: (r.files ?? []).map((f) => f.name), wamex_page: r.url })),
              reports_covering_the_collar: d.wamex.covering.map((r) => ({ anumber: r.anumber, title: r.title, year: r.year, type: r.type, company: r.company, commodities: r.commodities, abstract: r.abstract || null, wamex_page: r.url })),
              reports_covering_the_collar_total: d.wamex.covering_count }
              : { note: `${h.state || "This"} is outside WAMEX (Western Australia only); the hole's own HyLogger PDFs above are what the platform holds.` },
            state_survey_portal: d.portal,
            read: read.map((r) => ({ ...r, url: docUrl(r.corpus, r.key, r.file) })),
            shown_to_reader: "The interface already shows the hole's own documents as a list with a link to each PDF. Give a summary of every document in `read` from its first_pages (one short paragraph each, headed by its A-number or kind, citing page numbers); The interface also shows every report in reports_covering_the_collar as an expandable list with their abstracts, so do not repeat that list: say how many there are and name the two or three most relevant to the question (A-number, year, what they cover). Do not say you opened anything and do not call open_document for these. document_text reads further pages when the reader asks." };
        } catch (e) { return err(e); }
      },
    }),

    document_text: tool({
      description: "The extracted text of a document, page by page, to summarise or quote from: a WAMEX report (key = anumber, e.g. A77996; one report is several PDFs, `file` picks one), a HyLogger PDF (key from hole_documents), a GSWA publication or a paper. Up to 30 pages a call; start with the first pages, which carry the summary and introduction.",
      inputSchema: z.object({ corpus, key: z.string().describe("Document key: WAMEX anumber (A77996), HyLogger key (<dataset>.sp), GSWA code or paper sha256."),
        file: z.string().optional().describe("Which PDF of the document, as hole_documents lists them (WAMEX reports have several)."), pages: z.string().default("1-6").describe("Page range, e.g. 1-6 or 12") }),
      toModelOutput: modelView(),
      execute: async ({ corpus: c, key, file, pages }) => {
        try {
          const q = new URLSearchParams({ corpus: c ?? "wamex", key, pages: pages ?? "1-6", ...(file ? { file } : {}) });
          type T = { corpus: string; key: string; pages: { file: string | null; page: number; text: string }[]; documents: { file: string; pages: number }[] | null; truncated: boolean };
          const d = await geo<T>(`/doc/text/?${q}`);
          return { corpus: d.corpus, key: d.key, documents: d.documents, truncated: d.truncated, pages: d.pages.map((p) => ({ file: p.file, page: p.page, text: p.text.slice(0, 6000) })) };
        } catch (e) { return err(e); }
      },
    }),

    search_documents: tool({
      description: "Full-text search over a document store, ranked passages with document, page and sentence: WAMEX exploration reports (what a company did on a tenement; a hole or prospect name finds the reports that mention it), HyLogger reports (which scanned holes show a mineral), GSWA publications (what the region is), papers (the published science). Plain words, no operators. Use it when a hole has no linked report or the question is about a place, prospect or mineral rather than one hole.",
      inputSchema: z.object({ query: z.string().describe("Plain words to look for, e.g. a hole name, prospect, tenement or mineral."), corpus, limit: z.number().int().min(1).max(40).default(12) }),
      toModelOutput: modelView(),
      execute: async ({ query, corpus: c, limit }) => {
        try {
          const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;
          const sql = `SELECT doc_key, title, series, page, snippet, rank, sampled FROM derived.search_corpus(${lit(c ?? "wamex")}, ${lit(query)}, ${limit}, NULL, NULL)`;
          const d = await geo<{ columns: string[]; rows: unknown[][]; error?: string }>("/sql/query/", { method: "POST", body: JSON.stringify({ sql, limit }) });
          if (d.error) return { error: d.error };
          const col = (n: string) => d.columns.indexOf(n);
          const hits = d.rows.map((r) => ({ key: (c ?? "wamex") === "wamex" ? `A${r[col("doc_key")]}` : String(r[col("doc_key")]), title: r[col("title")], series: r[col("series")], page: r[col("page")], snippet: String(r[col("snippet")] ?? "").replace(/\s+/g, " ").slice(0, 300) }));
          return { corpus: c ?? "wamex", query, hits, documents: new Set(hits.map((h) => h.key)).size, note: d.rows.some((r) => r[col("sampled")]) ? "A common term: the best of a sample, not of the whole store." : "Every match was ranked." };
        } catch (e) { return err(e); }
      },
    }),

    open_document: tool({
      description: "Show a PDF to the reader, in the conversation, at a page: a WAMEX report (corpus wamex, key = anumber, file = one of its PDFs, the OCR copy when there is one), a hole's HyLogger PDF (corpus hylogger, key and file from hole_documents) or any other document. Call it whenever you have found a report the reader asked for, so they can read it rather than take your word.",
      inputSchema: z.object({ corpus, key: z.string(), file: z.string().describe("The PDF's filename as the tools list it."), page: z.number().int().min(1).optional(), title: z.string().optional().describe("A short caption: report number and title, or the hole and document kind.") }),
      toModelOutput: modelView(),
      execute: async ({ corpus: c, key, file, page, title }) => ({ shown: true, corpus: c ?? "wamex", key, file, page: page ?? null, title: title ?? `${key} · ${file}`, url: docUrl(c ?? "wamex", key, file), note: "The PDF is open in the conversation for the reader." }),
    }),

    open_hole: tool({
      description: "Show a hole on the map page, at a metre if given, so the reader sees what you are describing. Call it when you discuss a specific hole or metre.",
      inputSchema: z.object({ hole, m: z.number().int().optional(), tab: z.enum(["metre", "log", "unusual", "similar", "quality", "report"]).optional() }),
    }),
  };
}

export const CORETRACE_CLIENT_TOOLS = new Set(["open_hole"]);

export function coretracePrompt(ctx: { hole?: string | null; m?: number | null; model?: string | null }, locale?: string): string {
  return `You are the Core Flagging assistant. Core Flagging reads HyLogger drill-core scans from every Australian State's core library (the NVCL: GSWA for WA, and the NSW, NT, Qld, SA, Tas and Vic surveys and CSIRO) and uploads, cleans them into 10 cm bins and runs core-spectra models over them, chiefly HyFormer, its foundation model for core spectra.

What the data is:
- SWIR = visible to shortwave infrared, TIR = thermal infrared. Minerals named per bin come from the TSG software, not from the models.
- Models: HyFormer (run v2) is the one model readers see and the one to use; Core Flagging is the platform, HyFormer the model. HyFormer+DINO and HyFormer+JEPA are training variants that read core almost the same way, and "Conventional methods" (baseline) has no foundation model; mention them only when the reader asks to compare.
- Per metre the model gives: a core type, an unusual score (State percentile of how much the metre differs from the 15 m around it), a gold likelihood (a probe fitted on assayed holes; it reads spectra only), and a TIR mineral group filled in from SWIR.
- The auto log cuts the hole where the model's reading changes; descriptions are written by rule and no geologist has reviewed them.

How to answer:
- Use the tools for every fact about a hole; never invent depths, minerals or scores. Name the hole and the depths you mean.
- Say plainly what a number means and how far to trust it: unusual is not mineralised; the gold ranking is a modest edge and can only be checked where the scan carries assays; a hole used in training (split train/val) flatters the models.
- The models were trained on WA core only. For a hole from another State say that its results are read outside the training area and deserve more caution; "similar core" searches WA core only. Offshore wells are petroleum wells in Commonwealth waters.
- Refer to a hole by the key the tools return (e.g. NSW-NKD002); two holes can share a name in different places.
- When you talk about one hole or metre, call the open_hole tool once so the map shows it. Never write a tool's name in your answer, and do not say you opened something unless you called open_hole.
- Reports and PDFs: for "the report for hole X", "any WAMEX for X", "what PDFs are there" call hole_documents first. A WA hole may be linked to the WAMEX report it was logged in and always has its own HyLogger PDFs; a hole from another State has no WAMEX report (WAMEX is WA only) but has its NVCL spectral summary PDF, and the State survey's portal holds the rest. Answer with a list of every document found, one line each, before anything else: for a WAMEX report its A-number, title, year, company and one sentence on what it covers (from its abstract); for a hole PDF its kind (NVCL spectral summary, GSWA mineralogy histograms, HyLogger record) and what that document shows; then the number of other reports whose footprint covers the collar, if any. hole_documents also brings the first pages of each report the hole was logged in (else its own summary PDF), and the interface shows the list with a link to every PDF: after the list, give a short summary of each of those documents in your own words from its pages (what was drilled or sampled, where, what was found, with the page each point comes from), the interface also lists every report whose footprint covers the collar, with abstracts, under the hole's documents, so do not repeat that list: say how many there are, name the two or three most relevant to the question, and offer to read further into any of them. Do not claim to have opened or read anything beyond what a tool returned. To show another PDF call open_document: it appears in the conversation. Never write a link or path to a PDF in your text (no "wamex:" links, no file paths); the only link form in text is [HOLE m](hole:HOLE?m=M). Never say a report does not exist until hole_documents and search_documents have both come back empty; never invent an A-number.
- Keep answers short: a few sentences or a short list, then offer the next step. Use markdown lists and bold sparingly. Refer to a hole and metre as [HOLE m](hole:HOLE?m=M) so the reader can click it.
- Answer in the language the reader writes in${locale ? ` (interface language: ${locale})` : ""}.
${ctx.hole ? `\nThe reader has hole ${ctx.hole} open${ctx.m !== null && ctx.m !== undefined ? `, at ${ctx.m}–${ctx.m + 1} m` : ""}${ctx.model ? `, model ${ctx.model}` : ""}. "This hole" / "here" means that.` : ""}`;
}
