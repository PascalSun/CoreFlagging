// Colours for core-scan charts.
//
// Mineral groups wear the HyLogger / TSG standard colours, the ones the NVCL summary reports and every TSG plot
// use, so a geologist reads a group here as anywhere else. They are the class colours the NVCL data service
// gives for the Grp logs (getDownsampledData; stored there as BGR, turned to RGB here).

export const INK = "#0b0b0b";
export const MUTED = "#6b7280";
export const GRID = "#e5e7eb";
export const SERIES = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", yellow: "#eda100", magenta: "#e87ba4", green: "#008300", violet: "#4a3aa7" } as const;
export const OTHER = "#d8d2c4";
export const NONE = "#f1f5f9";

const GROUP: Record<string, string> = {
  CHLORITE: "#00ff00", INVALID: "#888888", CARBONATE: "#0000ff", "WHITE-MICA": "#ffff00", EPIDOTE: "#00ffff", AMPHIBOLE: "#ff00ff",
  "DARK-MICA": "#683b50", NOTAROK: "#aaafaf", SMECTITE: "#c4a997", SULPHATE: "#68601c", "OTHER-ALOH": "#fffbbd", SERPENTINE: "#9bbd6f",
  "OTHER-MGOH": "#20006a", KAOLIN: "#ff0000", TOURMALINE: "#b95d75", SILICA: "#fecfe6", PLAGIOCLASE: "#950d00", "K-FELDSPAR": "#f07800",
  PYROXENE: "#873192", OXIDE: "#765246", GARNET: "#a10079", PHOSPHATE: "#bf93fe", OLIVINE: "#188c00",
};
const NO_DATA = new Set(["", "nan", "None", "null"]);

export function groupColor(g: string | null | undefined): string {
  if (!g || NO_DATA.has(g)) return NONE;
  return GROUP[g] ?? OTHER;
}

const GROUP_NAME: Record<string, string> = {
  CHLORITE: "Chlorite", "WHITE-MICA": "White mica", AMPHIBOLE: "Amphibole", KAOLIN: "Kaolin", "DARK-MICA": "Dark mica", CARBONATE: "Carbonate", SMECTITE: "Smectite",
  SILICA: "Quartz", PLAGIOCLASE: "Plagioclase", "K-FELDSPAR": "K-feldspar", PYROXENE: "Pyroxene", SERPENTINE: "Serpentine", SULPHATE: "Sulphate", EPIDOTE: "Epidote",
  "OTHER-MGOH": "Other Mg-OH", "OTHER-ALOH": "Other Al-OH", TOURMALINE: "Tourmaline", OLIVINE: "Olivine", GARNET: "Garnet", PHOSPHATE: "Phosphate", OXIDE: "Oxide",
  "FE-OXIDE": "Iron oxide", ZEOLITE: "Zeolite", INVALID: "Invalid", NOTAROK: "Not rock",
};
export function groupName(g: string | null | undefined): string {
  if (!g || g === "nan" || g === "None") return "—";
  return GROUP_NAME[g] ?? g.charAt(0) + g.slice(1).toLowerCase();
}

/** Rock Classification (RC) has colours of its own, not the minerals': a class is a cluster of HyFormer's reading, and
 * its name only describes it, so it does not take a mineral group's TSG colour (which would read as that mineral).
 * The colours are Tableau 20, muted beside TSG's pure hues; classes of related name share a hue in two shades
 * (the two "Plagioclase + chlorite, more amphibole" greens, the "Quartz + chlorite" blues, the "Quartz + white mica"
 * oranges, the "Quartz (no SWIR response)" browns). A class of another model takes a colour from its name. */
const RC: Record<string, string> = {
  "Quartz + chlorite, more dark mica": "#4e79a7", "Quartz + chlorite": "#a0cbe8",
  "Plagioclase + chlorite, more amphibole": "#59a14f", "Plagioclase + chlorite, more amphibole (II)": "#8cd17d",
  "Quartz + white mica, more K-feldspar": "#f28e2b", "Quartz + white mica, more smectite": "#ffbe7d",
  "Quartz (no SWIR response), more dark mica": "#9d7660", "Quartz (no SWIR response), more white mica": "#d7b5a6",
  "Plagioclase (no SWIR response)": "#79706e", "Carbonate": "#499894", "Quartz + kaolin": "#e15759", "Other Mg-OH minerals + chlorite": "#b07aa1",
};
const RC_SPARE = ["#b6992d", "#f1ce63", "#86bcb6", "#ff9d9a", "#d4a6c8", "#fabfd2", "#bab0ac", "#d37295"];
export function coreTypeColor(name: string | undefined): string {
  if (!name) return NONE;
  if (RC[name]) return RC[name];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RC_SPARE[h % RC_SPARE.length];
}

/** A class whose name mixes minerals is hatched over its colour, to say so: one mineral ("Carbonate") solid; two
 * ("Quartz + kaolin", "Quartz (no SWIR response), more white mica") single diagonal lines; three ("Quartz + chlorite,
 * more dark mica") a crosshatch. */
export type Hatch = "solid" | "diag" | "cross";
export function coreTypeHatch(name: string | undefined): Hatch {
  if (!name) return "solid";
  const n = name.toLowerCase().replace(/\(no swir response\)|\(ii+\)/g, ""); const comma = n.indexOf(",");
  const head = comma < 0 ? n : n.slice(0, comma);
  const k = head.split("+").length + (/more /.test(comma < 0 ? "" : n.slice(comma)) ? 1 : 0);
  return k >= 3 ? "cross" : k === 2 ? "diag" : "solid";
}
const HATCH_INK = "rgba(15,23,42,0.38)";
/** A CSS `background` for a class: its colour with its hatch over it. */
export function coreTypeBg(name: string | undefined): string {
  const c = coreTypeColor(name), h = coreTypeHatch(name), L = `${HATCH_INK} 0 1px, transparent 1px 4.24px`;
  if (h === "diag") return `repeating-linear-gradient(135deg, ${L}), ${c}`;
  if (h === "cross") return `repeating-linear-gradient(135deg, ${L}), repeating-linear-gradient(45deg, ${L}), ${c}`;
  return c;
}
/** The same for a canvas: a pattern (or the plain colour), made once per class and context. */
const PAT = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern | string>>();
export function coreTypePaint(g: CanvasRenderingContext2D, name: string | undefined): CanvasPattern | string {
  const c = coreTypeColor(name), h = coreTypeHatch(name);
  if (h === "solid" || typeof document === "undefined") return c;
  let m = PAT.get(g); if (!m) { m = new Map(); PAT.set(g, m); }
  const key = `${c}|${h}`; const hit = m.get(key); if (hit) return hit;
  // a 6 px tile drawn at 4x, the pattern scaled back down so the lines stay crisp on a dense screen
  const S = 6, R = 4, t = document.createElement("canvas"); t.width = t.height = S * R;
  const q = t.getContext("2d"); if (!q) return c;
  q.scale(R, R); q.fillStyle = c; q.fillRect(0, 0, S, S); q.strokeStyle = HATCH_INK; q.lineWidth = 1; q.beginPath();
  for (const o of [0, S, 2 * S]) { q.moveTo(o + 1, -1); q.lineTo(-1, o + 1); }                       // "/"
  if (h === "cross") for (const o of [-S, 0, S]) { q.moveTo(o - 1, -1); q.lineTo(o + S + 1, S + 1); } // "\"
  q.stroke();
  const p = g.createPattern(t, "repeat"); if (!p) return c;
  p.setTransform(new DOMMatrix().scale(1 / R));
  m.set(key, p); return p;
}

/** Logged rock classes in GSWA's own colours. Each is the modal fill GSWA gives units of that rock type in the
 * 1:500 000 Interpreted bedrock geology of Western Australia (DASC, the layer's symbology over its 1,537 unit
 * codes): granitoids pink, mafic intrusives mint, mafic volcanics green, felsic volcanics yellow, ultramafics
 * lavender, siliciclastics pale grey, chemical sediments and iron formation sky blue, metamorphics grey-green.
 * A geologist who reads GSWA maps reads the Rock track without a key. */
const LITH: Record<string, string> = {
  Ultramafic: "#c8c0fd", "Mafic intrusive": "#8ee4b4", "Mafic volcanic": "#b1feb3", "Intermediate intrusive": "#fecfcb", Granitoid: "#fe9e98",
  "Felsic and intermediate volcanic": "#fee79f", Metamorphic: "#cfdad7", "Clastic sedimentary": "#e3dddb", "Carbonate rock": "#9dd7fb",
  "Iron formation and chert": "#6bc3f9", "Vein and alteration": "#b2bdc3", "Regolith and cover": "#f3e6b8",
};
export function lithColor(l: string | null | undefined): string {
  return l ? LITH[l] ?? OTHER : NONE;
}

export const ISSUE_LABEL: Record<string, { label: string }> = {
  listed_no_data: { label: "Listed, but no scan data at all" },
  dataset_skipped: { label: "A scanned dataset was not used" },
  tir_miscalibrated: { label: "TIR miscalibrated (reflectance above 1)" },
  tir_none: { label: "No usable TIR" },
  tir_sparse: { label: "Very little usable TIR" },
  tir_many_bad: { label: "Over 30% of TIR samples dark, negative or above 1" },
  low_valid_share: { label: "Over half the samples are not valid core" },
  core_gap: { label: "More than 5 m of core missing" },
  no_tsg_coordinates: { label: "Coordinates in the scan file are 0" },
  coordinate_mismatch: { label: "Scan file and hole list disagree by more than 1 km" },
  inclination_missing: { label: "Inclination is 0 or impossible" },
  elevation_missing: { label: "Collar elevation is 0" },
  drill_date_missing: { label: "No drill date" },
  tectonic_unit_missing: { label: "Tectonic unit not filled in" },
  not_modelled: { label: "Not run through the models" },
  profilometer_bad: { label: "Core surface height 0 or above 200 mm" },
};
export function issueLabel(code: string): string { return ISSUE_LABEL[code]?.label ?? code.replace(/_/g, " "); }

export const STATUS_LABEL: Record<string, string> = {
  awaiting_upload: "Waiting for upload", queued: "Queued", reading: "Reading the scan", cleaning: "Cleaning and binning to 10 cm",
  modelling: "Running the models", ready: "Ready", failed: "Failed",
};

export const fmt = (v: number | null | undefined, d = 2): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d));
export const pct = (v: number | null | undefined, d = 0): string => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(100 * v).toFixed(d)}%`);

/** A TSG mineral code as a name: "Chlorite-FeMg" -> "Chlorite-Fe Mg", a group code -> its name, "Aspectral" -> no response. */
export const mineralName = (k: string) => (k === "Aspectral" ? "No SWIR response" : k === k.toUpperCase() ? groupName(k) : k.replace(/([a-z])([A-Z])/g, "$1 $2"));
