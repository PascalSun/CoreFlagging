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
