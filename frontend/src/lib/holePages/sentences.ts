// The hole page's prose: fixed sentences, each filled from queried values. A sentence whose value is missing is
// dropped whole, never written around. Nothing here is generated: every word that is not a value is below.

import type { AgainFact, HoleFacts } from "./facts";
import { stateName } from "./facts";

type V = string | number | null | undefined;
const has = (...v: V[]) => v.every((x) => x !== null && x !== undefined && x !== "" && !(typeof x === "number" && !Number.isFinite(x)));
/** A sentence, or null when any of its values is missing. */
export function S(values: V[], text: () => string): string | null { return has(...values) ? text() : null; }

/** 988 -> "988", 913.04 -> "913", 0.2 -> "0.2": metres as the page writes them. */
export const m = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-AU");
/** 0.413 -> "41%" */
export const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export const HOLE_TYPES: Record<string, string> = { DD: "a diamond hole", RC: "a reverse-circulation hole", RCD: "a reverse-circulation hole with a diamond tail",
  AC: "an aircore hole", RAB: "a rotary-air-blast hole" };

/** The banner on a hole the models were trained on (the same words as the map's hole panel). */
export const TRAINING = "The models saw this hole in training. Results here will look better than on core they have not seen.";
/** The caveat on every hole outside Western Australia, and on a hub that lists any. */
export const OUTSIDE_WA = "Not yet checked outside WA. HyFormer reads holes from every State the same way, but its readings have been checked against logs and chemistry in Western Australia only.";

/** What the hole's own record says: collar, drilling, operator, target, logs and assays. */
export function recordSentences(f: HoleFacts): string[] {
  const st = stateName(f.state);
  return [
    S([f.name, st], () => `${f.name} is a drillhole in ${st} whose core was scanned by a HyLogger.`),
    S([f.lat, f.lon], () => `Its collar is at latitude ${f.lat!.toFixed(5)}, longitude ${f.lon!.toFixed(5)}.`),
    S([f.region], () => `It lies in the ${f.region}.`),
    S([f.drilled], () => `It was drilled in ${f.drilled}.`),
    S([f.operator], () => `The operator on record is ${f.operator}.`),
    S([f.project], () => `The project on record is ${f.project}.`),
    S([f.inclination, f.azimuth], () => `The scan records an inclination of ${f.inclination}° and an azimuth of ${f.azimuth}°.`),
    S([f.depth_min, f.depth_max], () => `The scan covers ${m(f.depth_min!)}–${m(f.depth_max!)} m down the hole.`),
    S([f.instrument], () => `It was scanned on a ${f.instrument}.`),
    f.target_source === "survey" ? S([f.target], () => `The hole's own record names ${f.target} as its target commodity.`) : null,
    f.has_lith ? "The State's record holds a geologist's lithology log for the hole." : null,
    f.au_m > 0 ? `${plural(f.au_m, "metre", "metres")} of the hole carry a gold assay in the State's record.` : null,
  ].filter((x): x is string => !!x);
}

/** HyFormer's reading: model output, never a measurement and never a grade. */
export function modelSentences(f: HoleFacts): string[] {
  const md = f.model;
  if (!md) return [];
  const types = md.main_types.slice(0, 3).map((t) => `${t.name} (${pct(t.share)})`);
  const flagged = md.n_flag === 0
    ? "It flags none of the metres it read as standing out from the core around them."
    : S([md.n_flag], () => `It flags ${plural(md.n_flag!, "metre", "metres")} as standing out from the core around them.`);
  return [
    S([md.name, md.read_m], () => `${md.name}, a core-spectra model, read ${m(md.read_m!)} m of this hole's scan, every 10 cm.`),
    types.length ? `Of the metres it read, it classes the most as ${list(types)}.` : null,
    S([md.n_segments], () => `It divides the hole into ${plural(md.n_segments!, "segment", "segments")} where the rock changes.`),
    flagged,
    md.again.length ? `On ${plural(md.again.length, "interval", "intervals")} its reading and the geologist's log disagree, so it suggests looking again.` : null,
  ].filter((x): x is string => !!x);
}

/** One "look again" interval. */
export const againSentence = (a: AgainFact) =>
  S([a.from_m, a.to_m, a.logged, a.reads], () =>
    `${m(a.from_m)}–${m(a.to_m)} m: logged as ${a.logged}${a.logged_class && a.logged_class !== a.logged ? ` (${a.logged_class})` : ""}; HyFormer reads ${a.reads}.`);

/** The hole against its region, from the model's reading of both. */
export function regionSentences(f: HoleFacts): string[] {
  const c = f.region_cmp;
  if (!c) return [];
  return c.items.map((i) => S([i.name, i.hole_share, i.region_share, c.n_holes, c.region], () =>
    `HyFormer classes ${pct(i.hole_share)} of this hole as ${i.name}, against ${pct(i.region_share)} across the ${c.n_holes.toLocaleString("en-AU")} scanned holes of the ${c.region}.`))
    .filter((x): x is string => !!x);
}

export function traySentences(f: HoleFacts): string[] {
  const t = f.trays;
  if (!t) return [];
  return [
    `The Geological Survey of Western Australia photographed the core in ${plural(t.n, "tray", "trays")}.`,
    t.pick ? `Shown: the tray holding ${m(t.pick.from_m)}–${m(t.pick.to_m)} m.` : null,
  ].filter((x): x is string => !!x);
}

export function wamexSentence(f: HoleFacts): string | null {
  const a = f.wamex.map((w) => w.anumber);
  return a.length ? `The hole was logged in WAMEX ${a.length === 1 ? "report" : "reports"} ${list(a)}.` : null;
}

/** The DMIRS HyLogger drillhole package, as a summary only. */
export function packageSentences(f: HoleFacts): string[] {
  const p = f.pkg;
  if (!p) return [];
  const label = HOLE_TYPES[p.hole_type.toUpperCase()];
  return [
    S([p.collar_id], () => `The DMIRS HyLogger drillhole package matches the hole to WAMEX collar ${p.collar_id}.`),
    label ? `That record lists it as ${label} (type ${p.hole_type}).` : S([p.hole_type], () => `That record gives its hole type as ${p.hole_type}.`),
    S([p.max_depth], () => `It gives the hole's depth as ${m(p.max_depth!)} m.`),
    p.n_geology > 0 ? `It holds ${plural(p.n_geology, "logged geology interval", "logged geology intervals")} for the hole.` : null,
    p.n_assay > 0 ? `It holds ${plural(p.n_assay, "assayed interval", "assayed intervals")} for the hole.` : null,
  ].filter((x): x is string => !!x);
}

/** The meta description: the first record facts and the model's headline, from the same templates. */
export function describe(f: HoleFacts): string {
  const st = stateName(f.state);
  const parts = [
    `${f.name}, a HyLogger-scanned drillhole in ${st}.`,
    S([f.drilled], () => `Drilled ${f.drilled}.`),
    S([f.depth_min, f.depth_max], () => `Scanned ${m(f.depth_min!)}–${m(f.depth_max!)} m.`),
    f.model ? S([f.model.read_m], () => `Read by HyFormer (model output): ${m(f.model!.read_m!)} m, ${f.model!.n_flag ?? 0} m flagged.`) : null,
  ];
  return parts.filter(Boolean).join(" ");
}
