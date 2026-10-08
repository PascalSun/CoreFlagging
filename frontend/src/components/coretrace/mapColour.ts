// What the points on the CoreTrace map are coloured by. Each mode turns a hole into one class, with a
// colour and a plain name for the legend; colours come from the shared palette, so a mineral family
// has the same colour on the map as in the logs.

import type { HoleRow } from "@/lib/coreScan";
import { SERIES, coreTypeColor } from "@/components/coretrace/palette";
import type { Shape } from "@/components/coretrace/shapes";

export type ColourMode = "type" | "gold" | "data" | "state";
export const COLOUR_MODES: { id: ColourMode; label: string; short: string; hint: string }[] = [
  { id: "type", short: "Core type", label: "Core type", hint: "The core type the model reads most often down the hole, by its leading mineral." },
  { id: "gold", short: "Gold", label: "Gold assays", hint: "Whether the scan carries gold assays, and whether any reach 0.1 ppm." },
  { id: "data", short: "Models", label: "Read by the model", hint: "Whether the models read the hole, or it is shown from the scan alone." },
  { id: "state", short: "Library", label: "State library", hint: "The State survey whose core library scanned the hole." },
];

const WAIT = "#94a3b8", PLAIN = "#475569";
/** `ring` set = drawn as a hollow ring of that colour (holes the models have nothing to say about) */
export type Class = { label: string; color: string; order: number; ring?: string; wait?: boolean };

const FAMILY: [string, string][] = [
  ["chlorite", "Chlorite"], ["white mica", "White mica"], ["kaolin", "Kaolin"], ["amphibole", "Amphibole"], ["carbonate", "Carbonate"],
  ["smectite", "Smectite"], ["dark mica", "Dark mica"],
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
  if (mode === "state") return { label: h.state || "Upload", color: STATE_COLOUR[h.state] ?? SERIES.orange, order: 0 };
  const k = mainType(h.strip);
  if (k === null || !modelled) return { label: "No model reading", color: "#ffffff", ring: PLAIN, order: 98 };
  const name = typeName.get(k) ?? ""; const main = name.split(",")[0].toLowerCase();
  const fam = FAMILY.find(([w]) => main.includes(w))?.[1] ?? (main.includes("plagioclase") ? "Plagioclase only" : main.includes("quartz") ? "Quartz only" : "Other");
  return { label: fam, color: coreTypeColor(name), order: 0 };
}

// ---- shape: a second attribute, a few classes only (a reader can tell three or four shapes apart, not eight)

export type ShapeMode = "none" | "gold" | "data" | "setting";
export const SHAPE_MODES: { id: ShapeMode; short: string }[] = [
  { id: "gold", short: "Gold" }, { id: "data", short: "Models" }, { id: "setting", short: "On/offshore" }, { id: "none", short: "None" },
];
export type ShapeClass = { label: string; shape: Shape; order: number };

export function shapeOf(h: HoleRow, mode: ShapeMode): ShapeClass | null {
  if (h.status !== "ready" || mode === "none") return null;
  if (mode === "gold") {
    if (h.au_pos_m > 0) return { label: "Gold ≥ 0.1 ppm", shape: "triangle", order: 0 };
    if (h.au_m > 0) return { label: "Assayed, below 0.1", shape: "square", order: 1 };
    return { label: "No assays", shape: "circle", order: 2 };
  }
  if (mode === "data") return h.message ? { label: "Scan only", shape: "square", order: 1 } : { label: "Read by the models", shape: "circle", order: 0 };
  return h.offshore ? { label: "Offshore well", shape: "diamond", order: 1 } : { label: "Onshore", shape: "circle", order: 0 };
}
