// "Look again" sheets as CSV. The rule itself lives on the platform (`core_scan/look_again.py`), so the
// map, the list and the hole page read one answer; this file only writes it out.

import type { AgainInterval, AgainRow, ModelView } from "@/lib/coreScan";

const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const kind = (d: AgainInterval) => (d.direction === "model_ultramafic" ? "model reads ultramafic, log does not" : "log says ultramafic, model does not");

/** One hole's sheet: its disagreements and its flagged metres, with the reader's verdicts. */
export function csvRows(hole: string, run: string, ds: AgainInterval[], flags: ModelView["anomaly"]["runs"], verdictOf: (kind: "log" | "flag", from: number, to: number) => string): string {
  const head = ["hole", "model", "kind", "from_m", "to_m", "length_m", "logged", "model_reads", "share", "um_minerals", "assays_n", "assay_max_ppm", "flagged_m", "verdict"];
  const rows: unknown[][] = [
    ...ds.map((d) => [hole, run, kind(d), d.from_m, d.to_m, d.length_m, d.logged, d.reads, d.share.toFixed(2), d.um_minerals === null ? "" : d.um_minerals.toFixed(2), d.assays.n, d.assays.max ?? "", d.flagged, verdictOf("log", d.from_m, d.to_m)]),
    ...flags.map((r) => [hole, run, "stands out from its surroundings", r.from_m, r.to_m, r.to_m - r.from_m, "", "", "", "", "", "", r.to_m - r.from_m, verdictOf("flag", r.from_m, r.to_m)]),
  ];
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

/** The cross-hole sheet: every disagreement in a State or a project, holes with the most metres first. */
export function csvSheet(model: string, rows: AgainRow[]): string {
  const head = ["hole", "state", "company", "project", "region", "model", "kind", "from_m", "to_m", "length_m", "logged", "model_reads", "share", "um_minerals", "assays_n", "assay_max_ppm", "flagged_m"];
  const body = rows.map((d) => [d.hole, d.state, d.operator, d.project, d.region, model, kind(d), d.from_m, d.to_m, d.length_m, d.logged, d.reads, d.share.toFixed(2), d.um_minerals === null ? "" : d.um_minerals.toFixed(2), d.assays.n, d.assays.max ?? "", d.flagged]);
  return [head, ...body].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
