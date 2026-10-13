// "Look again": where the model's reading of the core disagrees with the geologist's log.
//
// The one rule validated against chemistry (the Findings page: 74% of disagreements backed, 51% by chance)
// is the ultramafic one: the model reads a talc–serpentine–Mg-chlorite type where the log says basalt,
// gabbro, granite or sediment, or the reverse. Everything here keeps to that rule; other kinds of
// disagreement are not listed until they have been checked the same way.

import type { HoleDetail, Metres, ModelView, Segment } from "@/lib/coreScan";

export type Family = "ultramafic" | "mafic" | "felsic" | "carbonate" | "sediment" | "clay" | "";

/** The rock family a core type's mineral assemblage points to; "" when it could be several. */
export function typeFamily(name: string): Family {
  const n = name.toLowerCase();
  if (/mg-oh|talc|serpentin/.test(n)) return "ultramafic";
  if (/kaolin|smectite/.test(n)) return "clay";
  if (/carbonate/.test(n)) return "carbonate";
  if (/plagioclase/.test(n)) return "mafic";
  if (/white mica|k-feldspar/.test(n)) return "felsic";
  return "";
}

/** The family of a logged rock class (the pipeline's 12 classes, in English). */
export function logFamily(cls: string): Family {
  switch (cls) {
    case "Ultramafic": return "ultramafic";
    case "Mafic volcanic": case "Mafic intrusive": return "mafic";
    case "Granitoid": case "Felsic and intermediate volcanic": case "Intermediate intrusive": return "felsic";
    case "Carbonate rock": return "carbonate";
    case "Clastic sedimentary": case "Metamorphic": case "Iron formation and chert": return "sediment";
    case "Regolith and cover": return "clay";
    default: return "";
  }
}

export type Disagreement = {
  from_m: number; to_m: number; length_m: number;
  /** "log" = the log says a rock the model does not read; both directions of the ultramafic rule */
  direction: "model_ultramafic" | "log_ultramafic";
  logged: string;           // the log's own words, the most common over the interval
  logged_class: string;     // the pipeline's class for them
  reads: string;            // the model's core type, the most common over the interval
  share: number;            // share of metres in the interval the model reads as the disagreeing family
  um_minerals: number | null; // share of talc, serpentine and Mg-chlorite in the scanner's own minerals, from the segments
  assays: { n: number; max: number | null; pos: number };  // gold assays inside the interval
  flagged: number;          // metres inside it that also stand out from their surroundings
};

const MIN_LEN = 5;        // the Findings rule: at least 5 m
const MIN_SHARE = 0.5;    // ... with the disagreeing type over half
const GAP = 1;            // metres of other reading tolerated inside a run

function mode(xs: string[]): string {
  const c = new Map<string, number>(); for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function umShare(segments: Segment[], from: number, to: number): number | null {
  let w = 0, um = 0;
  for (const s of segments) {
    const o = Math.min(s.to_m, to) - Math.max(s.from_m, from); if (o <= 0) continue;
    const share = s.swir_minerals.filter(([c]) => /talc|serpentin|chlorite-mg/i.test(c)).reduce((a, [, , p]) => a + p, 0);
    w += o; um += o * share;
  }
  return w > 0 ? um / w : null;
}

/** The intervals where the ultramafic rule fires, in depth order. Needs the log (metres.lith) and a model view. */
export function disagreements(hole: HoleDetail, mv: ModelView): Disagreement[] {
  const m: Metres = hole.metres; if (!hole.has_lith) return [];
  const typeName = new Map(mv.core_types.map((c) => [c.k, c.name]));
  const fam = new Map(mv.core_types.map((c) => [c.k, typeFamily(c.name)]));
  const byM = new Map(mv.m.map((x, i) => [x, i]));
  const flagAt = (i: number) => mv.anom_raw[i] >= mv.anomaly.flag_raw && mv.anom[i] >= mv.anomaly.flag_at;
  const out: Disagreement[] = [];
  // walk the logged intervals (runs of one class), and inside each look for runs of the conflicting reading
  let a = 0;
  while (a < m.m.length) {
    let b = a; while (b + 1 < m.m.length && m.lith[b + 1] === m.lith[a]) b++;
    const lf = logFamily(m.lith[a] ?? "");
    if (lf) {
      const want: Family | null = lf === "ultramafic" ? null : "ultramafic";   // null: anything that is not ultramafic
      const hit = (i: number) => { const j = byM.get(m.m[i]); if (j === undefined) return false; const f = fam.get(mv.core[j]) ?? ""; return want ? f === want : (f !== "" && f !== "ultramafic"); };
      let i = a;
      while (i <= b) {
        if (!hit(i)) { i++; continue; }
        let j = i, last = i, n = 0;
        while (j <= b && (hit(j) || j - last <= GAP)) { if (hit(j)) { last = j; n++; } j++; }
        const from = m.m[i], to = m.m[last] + 1, len = to - from;
        if (len >= MIN_LEN && n / len >= MIN_SHARE) {
          const idx = Array.from({ length: last - i + 1 }, (_, k) => i + k);
          const reads = mode(idx.map((k) => { const q = byM.get(m.m[k]); return q === undefined ? "" : typeName.get(mv.core[q]) ?? ""; }));
          const au = idx.map((k) => m.au[k]).filter((v): v is number => v !== null);
          out.push({ from_m: from, to_m: to, length_m: len, direction: want ? "model_ultramafic" : "log_ultramafic",
            logged: mode(idx.map((k) => m.lith_raw[k])), logged_class: m.lith[a], reads, share: n / len, um_minerals: umShare(mv.segments, from, to),
            assays: { n: au.length, max: au.length ? Math.max(...au) : null, pos: au.filter((v) => v >= 0.1).length },
            flagged: idx.filter((k) => { const q = byM.get(m.m[k]); return q !== undefined && flagAt(q); }).length });
        }
        i = j;
      }
    }
    a = b + 1;
  }
  return out;
}

/** One line of the "worth a second look" sheet, for the CSV. */
export function csvRows(hole: string, run: string, ds: Disagreement[], flags: ModelView["anomaly"]["runs"], verdictOf: (kind: "log" | "flag", from: number, to: number) => string): string {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["hole", "model", "kind", "from_m", "to_m", "length_m", "logged", "model_reads", "share", "um_minerals", "assays_n", "assay_max_ppm", "flagged_m", "verdict"];
  const rows: unknown[][] = [
    ...ds.map((d) => [hole, run, d.direction === "model_ultramafic" ? "model reads ultramafic, log does not" : "log says ultramafic, model does not", d.from_m, d.to_m, d.length_m, d.logged, d.reads, d.share.toFixed(2), d.um_minerals === null ? "" : d.um_minerals.toFixed(2), d.assays.n, d.assays.max ?? "", d.flagged, verdictOf("log", d.from_m, d.to_m)]),
    ...flags.map((r) => [hole, run, "stands out from its surroundings", r.from_m, r.to_m, r.to_m - r.from_m, "", "", "", "", "", "", r.to_m - r.from_m, verdictOf("flag", r.from_m, r.to_m)]),
  ];
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n";
}
