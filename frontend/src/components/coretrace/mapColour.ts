// How a hole is classed on the Core Flagging map. Colour is always the target commodity; the map key can also
// filter by core type, by where the target comes from (a hatched fill when inferred) and by whether the models
// read the hole (the shape). Colours come from the shared palette, so a mineral family has the same colour on
// the map as in the logs.

import { inferred, type HoleRow } from "@/lib/coreScan";
import type { Shape } from "@/components/coretrace/shapes";

const WAIT = "#94a3b8";
/** `glyph` set = the mark carries letters (a commodity's chemical symbol), drawn as a badge when zoomed in;
 * `hatched` = the target is inferred (a report's or a deposit's commodity); `small` = a quiet, smaller dot */
export type Class = { label: string; color: string; order: number; wait?: boolean; glyph?: string; hatched?: boolean; small?: boolean };

export const OTHER_LABEL = "Other commodities", UNKNOWN_LABEL = "Target unknown";

// the targets with enough holes to earn a colour and a symbol of their own; the rest are "Other commodities"
const TARGET_COLOUR: [string, string, string, string][] = [
  ["gold", "Gold", "#f5c518", "Au"], ["copper", "Copper", "#e8701a", "Cu"], ["nickel", "Nickel", "#17a398", "Ni"], ["base metals", "Base metals", "#3b6fd6", "BM"],
  ["iron", "Iron", "#b42318", "Fe"], ["uranium", "Uranium", "#5cb531", "U"], ["rare earth elements", "Rare earths", "#d63384", "REE"], ["lithium", "Lithium", "#8b5cf6", "Li"],
  ["petroleum", "Petroleum", "#3f3a36", "Oil"], ["zinc", "Zinc", "#0f8fa8", "Zn"], ["lead", "Lead", "#5b6472", "Pb"], ["coal", "Coal", "#1f1d1b", "C"],
  ["cobalt", "Cobalt", "#2a4bd7", "Co"], ["platinum group elements", "PGE", "#6d28d9", "PGE"], ["silver", "Silver", "#8a94a6", "Ag"], ["manganese", "Manganese", "#a3165a", "Mn"],
  ["tin", "Tin", "#0f766e", "Sn"], ["tungsten", "Tungsten", "#4338ca", "W"], ["vanadium", "Vanadium", "#c2410c", "V"], ["diamonds", "Diamonds", "#38bdf8", "Dia"],
  ["heavy mineral sands", "Mineral sands", "#a16207", "HMS"], ["water", "Water", "#0ea5e9", "H₂O"], ["molybdenum", "Molybdenum", "#475569", "Mo"], ["antimony", "Antimony", "#7e22ce", "Sb"],
];

/** A hole's target commodity: a colour and a symbol of its own, slate "+" for the rarer ones, a small pale dot
 * when no target is known at all. */
export function classify(h: HoleRow): Class {
  if (h.status !== "ready") return { label: "Waiting", color: WAIT, order: 99, wait: true };
  if (!h.target) return { label: UNKNOWN_LABEL, color: "#cbd5e1", order: 99, small: true };
  const i = TARGET_COLOUR.findIndex(([k]) => k === h.target);
  const hatched = inferred(h.target_source);               // a report's or a deposit's commodity, not the hole's own record
  return i >= 0 ? { label: TARGET_COLOUR[i][1], color: TARGET_COLOUR[i][2], order: i, glyph: TARGET_COLOUR[i][3], hatched }
    : { label: OTHER_LABEL, color: "#64748b", order: 50, glyph: "+", hatched };
}

// ---- where the target comes from: the fill. Null when no target is known.
export const RECORDED_LABEL = "Recorded on the hole", INFERRED_LABEL = "Inferred";
export function sourceOf(h: HoleRow): string | null {
  if (h.status !== "ready" || !h.target) return null;
  return inferred(h.target_source) ? INFERRED_LABEL : RECORDED_LABEL;
}

// ---- core type: the family of the core type the models read most often down the hole. Null when the models
// did not read it.
const FAMILY: [string, string][] = [
  ["chlorite", "Chlorite"], ["white mica", "White mica"], ["kaolin", "Kaolin"], ["amphibole", "Amphibole"], ["carbonate", "Carbonate"],
  ["smectite", "Smectite"], ["dark mica", "Dark mica"],
];
function mainType(strip: number[] | undefined): number | null {
  if (!strip?.length) return null;
  const c = new Map<number, number>(); let best: number | null = null, n = 0;
  for (const k of strip) { const v = (c.get(k) ?? 0) + 1; c.set(k, v); if (v > n) { n = v; best = k; } }
  return best;
}
export function coreFamily(h: HoleRow, typeName: Map<number, string>): string | null {
  if (h.status !== "ready" || h.message) return null;
  const k = mainType(h.strip); if (k === null) return null;
  const main = (typeName.get(k) ?? "").split(",")[0].toLowerCase();
  return FAMILY.find(([w]) => main.includes(w))?.[1] ?? (main.includes("plagioclase") ? "Plagioclase only" : main.includes("quartz") ? "Quartz only" : "Other");
}

// ---- shape: round = the models read the hole; square = the scan is shown as it came (chips, an unusable
// mask, another band grid).
export type ShapeClass = { label: string; shape: Shape; order: number };
export const READ_LABEL = "Read by the models", RAW_LABEL = "Raw scan only";
export function shapeOf(h: HoleRow): ShapeClass | null {
  if (h.status !== "ready") return null;
  return h.message ? { label: RAW_LABEL, shape: "square", order: 1 } : { label: READ_LABEL, shape: "circle", order: 0 };
}
