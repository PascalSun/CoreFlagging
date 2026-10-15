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
      description: "Core elsewhere in Western Australia that looks like the 2 m starting at metre m of a hole (holes within 5 km left out, one interval per hole).",
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

    open_hole: tool({
      description: "Show a hole on the map page, at a metre if given, so the reader sees what you are describing. Call it when you discuss a specific hole or metre.",
      inputSchema: z.object({ hole, m: z.number().int().optional(), tab: z.enum(["metre", "log", "unusual", "gold", "similar", "quality", "report"]).optional() }),
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
- Keep answers short: a few sentences or a short list, then offer the next step. Use markdown lists and bold sparingly. Refer to a hole and metre as [HOLE m](hole:HOLE?m=M) so the reader can click it.
- Answer in the language the reader writes in${locale ? ` (interface language: ${locale})` : ""}.
${ctx.hole ? `\nThe reader has hole ${ctx.hole} open${ctx.m !== null && ctx.m !== undefined ? `, at ${ctx.m}–${ctx.m + 1} m` : ""}${ctx.model ? `, model ${ctx.model}` : ""}. "This hole" / "here" means that.` : ""}`;
}
