// What the points on the CoreTrace map are coloured by. Each mode turns a hole into one class, with a
// colour and a plain name for the legend; colours come from the shared palette, so a mineral family
// has the same colour on the map as in the logs.

import { inferred, type HoleRow } from "@/lib/coreScan";
import { SERIES, coreTypeColor } from "@/components/coretrace/palette";
import type { Shape } from "@/components/coretrace/shapes";

export type ColourMode = "target" | "again" | "type" | "gold" | "data" | "state";
export const COLOUR_MODES: { id: ColourMode; label: string; short: string; hint: string }[] = [
  { id: "target", short: "Target", label: "Target commodity", hint: "What the hole was drilled for: its survey record, its exploration report, or (dashed) the nearest known deposit." },
  { id: "again", short: "Look again", label: "Worth a second look", hint: "Intervals where the model's reading disagrees with the geologist's log (the ultramafic rule), by metres." },
  { id: "type", short: "Core type", label: "Core type", hint: "The core type the model reads most often down the hole, by its leading mineral." },
  { id: "gold", short: "Gold", label: "Gold assays", hint: "Whether the scan carries gold assays, and whether any reach 0.1 ppm." },
  { id: "data", short: "Models", label: "Read by the model", hint: "Whether the models read the hole, or it is shown from the scan alone." },
  { id: "state", short: "Library", label: "State library", hint: "The State survey whose core library scanned the hole." },
];

const WAIT = "#94a3b8", PLAIN = "#475569";
/** `ring` set = drawn as a hollow ring of that colour (holes the models have nothing to say about) */
/** `glyph` set = the mark carries letters (a commodity's chemical symbol), drawn as a badge when zoomed in */
export type Class = { label: string; color: string; order: number; ring?: string; wait?: boolean; glyph?: string; dashed?: boolean };

const FAMILY: [string, string][] = [
  ["chlorite", "Chlorite"], ["white mica", "White mica"], ["kaolin", "Kaolin"], ["amphibole", "Amphibole"], ["carbonate", "Carbonate"],
  ["smectite", "Smectite"], ["dark mica", "Dark mica"],
];
// the targets with enough holes to earn a colour and a symbol of their own; the rest are "Other"
const TARGET_COLOUR: [string, string, string, string][] = [
  ["gold", "Gold", "#f5c518", "Au"], ["copper", "Copper", "#e8701a", "Cu"], ["nickel", "Nickel", "#17a398", "Ni"], ["base metals", "Base metals", "#3b6fd6", "BM"],
  ["iron", "Iron", "#b42318", "Fe"], ["uranium", "Uranium", "#5cb531", "U"], ["rare earth elements", "Rare earths", "#d63384", "REE"], ["lithium", "Lithium", "#8b5cf6", "Li"],
  ["petroleum", "Petroleum", "#3f3a36", "Oil"], ["zinc", "Zinc", "#0f8fa8", "Zn"], ["lead", "Lead", "#5b6472", "Pb"], ["coal", "Coal", "#1f1d1b", "C"],
  ["cobalt", "Cobalt", "#2a4bd7", "Co"], ["platinum group elements", "PGE", "#6d28d9", "PGE"], ["silver", "Silver", "#8a94a6", "Ag"], ["manganese", "Manganese", "#a3165a", "Mn"],
  ["tin", "Tin", "#0f766e", "Sn"], ["tungsten", "Tungsten", "#4338ca", "W"], ["vanadium", "Vanadium", "#c2410c", "V"], ["diamonds", "Diamonds", "#38bdf8", "Dia"],
  ["heavy mineral sands", "Mineral sands", "#a16207", "HMS"], ["water", "Water", "#0ea5e9", "H₂O"], ["molybdenum", "Molybdenum", "#475569", "Mo"], ["antimony", "Antimony", "#7e22ce", "Sb"],
];
const STATE_COLOUR: Record<string, string> = {
  WA: SERIES.orange, NSW: SERIES.blue, QLD: SERIES.magenta, SA: SERIES.green, NT: SERIES.yellow, TAS: SERIES.violet, VIC: SERIES.aqua, CSIRO: PLAIN,
};

/** The leading core type of a hole: the one the strip shows most often. */
function mainType(strip: number[] | undefined): number | null {
  if (!strip?.length) return null;
  const c = new Map<number, number>(); let best: number | null = null, n = 0;
  for (const k of strip) { const v = (c.get(k) ?? 0) + 1; c.set(k, v); if (v > n) { n = v; best = k; } }
  return best;
}

export function classify(h: HoleRow, mode: ColourMode, typeName: Map<number, string>): Class {
  if (h.status !== "ready") return { label: "Waiting", color: WAIT, order: 99, wait: true };
  const modelled = !h.message;
  if (mode === "data") return modelled ? { label: "Read by the models", color: "#111111", order: 0 } : { label: "Scan only", color: "#ffffff", ring: PLAIN, order: 1 };
  if (mode === "gold") {
    if (h.au_pos_m > 0) return { label: "Gold ≥ 0.1 ppm", color: SERIES.yellow, order: 0 };
    if (h.au_m > 0) return { label: "Assayed, below 0.1", color: SERIES.blue, order: 1 };
    return { label: "No assays", color: "#94a3b8", order: 2 };
  }
  if (mode === "target") {
    if (!h.target) return { label: "No target on record", color: "#cbd5e1", order: 99 };   // a quiet dot, not a ring: the rings mean "no model reading"
    const i = TARGET_COLOUR.findIndex(([k]) => k === h.target);
    const dashed = inferred(h.target_source);               // a report's or a deposit's commodity, not the hole's own record
    return i >= 0 ? { label: TARGET_COLOUR[i][1], color: TARGET_COLOUR[i][2], order: i, glyph: TARGET_COLOUR[i][3], dashed } : { label: "Other", color: "#94a3b8", order: 50, dashed };
  }
  if (mode === "again") {
    if (!modelled) return { label: "No model reading", color: "#ffffff", ring: PLAIN, order: 5 };
    if (!h.has_lith) return { label: "No log to compare", color: "#e2e8f0", order: 4 };
    if (h.again_m >= 50) return { label: "50 m or more", color: SERIES.orange, order: 0 };
    if (h.again_m >= 10) return { label: "10–50 m", color: SERIES.yellow, order: 1 };
    if (h.n_again > 0) return { label: "Under 10 m", color: "#c4b5fd", order: 2 };
    return { label: "Log and model agree", color: "#94a3b8", order: 3 };
  }
  if (mode === "state") return { label: h.state || "Upload", color: STATE_COLOUR[h.state] ?? SERIES.orange, order: 0 };
  const k = mainType(h.strip);
  if (k === null || !modelled) return { label: "No model reading", color: "#ffffff", ring: PLAIN, order: 98 };
  const name = typeName.get(k) ?? ""; const main = name.split(",")[0].toLowerCase();
  const fam = FAMILY.find(([w]) => main.includes(w))?.[1] ?? (main.includes("plagioclase") ? "Plagioclase only" : main.includes("quartz") ? "Quartz only" : "Other");
  return { label: fam, color: coreTypeColor(name), order: 0 };
}

// ---- shape: one fixed second attribute. Round = the models read the hole; square = the scan is shown as it
// came (chips, an unusable mask, another band grid). Gold and on/offshore used to be options here; a reader
// never needed to choose, and the choice made the legend harder to read.

export type ShapeClass = { label: string; shape: Shape; order: number };

export function shapeOf(h: HoleRow): ShapeClass | null {
  if (h.status !== "ready") return null;
  return h.message ? { label: "Scan only", shape: "square", order: 1 } : { label: "Read by the models", shape: "circle", order: 0 };
}
