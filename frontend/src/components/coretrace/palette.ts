// Colours for core-scan charts.
//
// Seven categorical hues (a palette checked for colour-blind separation) go to the seven
// minerals that carry most of the SWIR story, always the same hue for the same mineral.
// The felsic framework minerals TIR sees (quartz, feldspars) are three neutral greys.
// Anything rarer is one "other" tone and is named in the tooltip and legend, because a
// ninth invented hue would not be told apart from the first eight.

export const INK = "#0b0b0b";
export const MUTED = "#6b7280";
export const GRID = "#e5e7eb";
export const SERIES = { blue: "#2a78d6", orange: "#eb6834", aqua: "#1baf7a", yellow: "#eda100", magenta: "#e87ba4", green: "#008300", violet: "#4a3aa7" } as const;
export const OTHER = "#d8d2c4";
export const NONE = "#f1f5f9";

const GROUP: Record<string, string> = {
  CHLORITE: SERIES.green, "WHITE-MICA": SERIES.yellow, AMPHIBOLE: SERIES.aqua, KAOLIN: SERIES.magenta, "DARK-MICA": SERIES.violet,
  CARBONATE: SERIES.blue, SMECTITE: SERIES.orange,
  SILICA: "#c9ced6", PLAGIOCLASE: "#8d96a3", "K-FELDSPAR": "#4c5a6b",
};
const NOT_ROCK = new Set(["", "INVALID", "NOTAROK", "nan", "None", "null"]);

export function groupColor(g: string | null | undefined): string {
  if (!g || NOT_ROCK.has(g)) return NONE;
  return GROUP[g] ?? OTHER;
}

const GROUP_NAME: Record<string, string> = {
  CHLORITE: "Chlorite", "WHITE-MICA": "White mica", AMPHIBOLE: "Amphibole", KAOLIN: "Kaolin", "DARK-MICA": "Dark mica", CARBONATE: "Carbonate", SMECTITE: "Smectite",
  SILICA: "Quartz", PLAGIOCLASE: "Plagioclase", "K-FELDSPAR": "K-feldspar", PYROXENE: "Pyroxene", SERPENTINE: "Serpentine", SULPHATE: "Sulphate", EPIDOTE: "Epidote",
  "OTHER-MGOH": "Other Mg-OH", "OTHER-ALOH": "Other Al-OH", TOURMALINE: "Tourmaline", OLIVINE: "Olivine", GARNET: "Garnet", PHOSPHATE: "Phosphate", OXIDE: "Oxide",
  "FE-OXIDE": "Iron oxide", ZEOLITE: "Zeolite", INVALID: "No response", NOTAROK: "Not rock",
};
export function groupName(g: string | null | undefined): string {
  if (!g || g === "nan" || g === "None") return "—";
  return GROUP_NAME[g] ?? g.charAt(0) + g.slice(1).toLowerCase();
}

/** A model core type is named after its minerals ("Quartz + chlorite, more dark mica");
 * it takes the colour of the first SWIR mineral in that name, grey when SWIR sees none. */
const NAME_KEYS: [string, string][] = [
  ["chlorite", "CHLORITE"], ["white mica", "WHITE-MICA"], ["kaolin", "KAOLIN"], ["amphibole", "AMPHIBOLE"], ["carbonate", "CARBONATE"],
  ["smectite", "SMECTITE"], ["dark mica", "DARK-MICA"],
];
export function coreTypeColor(name: string | undefined): string {
  if (!name) return NONE;
  const main = name.split(",")[0].toLowerCase();
  for (const [k, g] of NAME_KEYS) if (main.includes(k)) return GROUP[g];
  if (main.includes("plagioclase")) return GROUP.PLAGIOCLASE;
  if (main.includes("quartz")) return GROUP.SILICA;
  return OTHER;
}

/** Logged rock classes: neutral family tones, named in the tooltip. Rock is context here, not the subject. */
const LITH: Record<string, string> = {
  Ultramafic: "#3f5f4b", "Mafic intrusive": "#5d7f68", "Mafic volcanic": "#86a58f", "Intermediate intrusive": "#9aa0a8", Granitoid: "#d9a9a0",
  "Felsic and intermediate volcanic": "#e6c9a8", Metamorphic: "#8f86a8", "Clastic sedimentary": "#d9cf9a", "Carbonate rock": "#a9c7e0",
  "Iron formation and chert": "#9a5a4a", "Vein and alteration": "#f0f0f0", "Regolith and cover": "#cbb8a0",
};
export function lithColor(l: string | null | undefined): string {
  return l ? LITH[l] ?? OTHER : NONE;
}

export const ISSUE_LABEL: Record<string, { label: string; fix: string }> = {
  listed_no_data: { label: "Listed, but no scan data at all", fix: "Remove from the list, or load the data." },
  dataset_skipped: { label: "A scanned dataset was not used", fix: "Check the dataset type (chips are not continuous core)." },
  tir_miscalibrated: { label: "TIR miscalibrated (reflectance above 1)", fix: "Recalibrate, or mark the TIR unusable." },
  tir_none: { label: "No usable TIR", fix: "Check the instrument model and the TIR file." },
  tir_sparse: { label: "Very little usable TIR", fix: "Check the TIR file." },
  tir_many_bad: { label: "Over 30% of TIR samples dark, negative or above 1", fix: "Check the instrument state at scan time." },
  low_valid_share: { label: "Over half the samples are not valid core", fix: "Check the Final Mask." },
  core_gap: { label: "More than 5 m of core missing", fix: "Check for an unscanned interval or a depth error." },
  no_tsg_coordinates: { label: "Coordinates in the scan file are 0", fix: "Fill the coordinates from the drillhole database." },
  coordinate_mismatch: { label: "Scan file and hole list disagree by more than 1 km", fix: "Check which coordinate is right." },
  inclination_missing: { label: "Inclination is 0 or impossible", fix: "Fill the inclination from the drillhole database." },
  elevation_missing: { label: "Collar elevation is 0", fix: "Fill the elevation from the drillhole database." },
  drill_date_missing: { label: "No drill date", fix: "Fill the date." },
  tectonic_unit_missing: { label: "Tectonic unit not filled in", fix: "Use the region inferred from the GSWA tectonic units map." },
  not_modelled: { label: "Not run through the models", fix: "Nothing to fix in the data for this; the models only read continuous core on the grid they were trained on." },
  profilometer_bad: { label: "Core surface height 0 or above 200 mm", fix: "Check the profilometer." },
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
