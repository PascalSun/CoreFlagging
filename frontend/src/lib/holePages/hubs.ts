// The prose of the hub pages (a State, a WA tectonic region, a commodity): counts over the indexed holes they
// list, each a fixed sentence that is dropped when its count is zero or its value is missing.

import type { IndexRow } from "./rules";
import { commodityHubs, commodityPath, regionHubs, regionPath } from "./rules";

const n = (x: number) => x.toLocaleString("en-AU");
const holes = (x: number) => `${n(x)} ${x === 1 ? "hole" : "holes"}`;
export const titleCase = (c: string) => (c ? c[0].toUpperCase() + c.slice(1) : c);

/** Sentences every hub carries about the holes it lists. */
export function hubSentences(rows: IndexRow[], where: string): string[] {
  const years = rows.map((r) => r.drilled).filter((y): y is number => typeof y === "number");
  const lith = rows.filter((r) => r.has_lith).length, au = rows.filter((r) => r.au_m > 0).length;
  const again = rows.filter((r) => r.n_again > 0).length, wamex = rows.filter((r) => r.wamex).length;
  const metres = rows.reduce((s, r) => s + (r.read_m ?? 0), 0);
  return [
    rows.length ? `${n(rows.length)} HyLogger-scanned ${rows.length === 1 ? "drillhole" : "drillholes"} ${where} ${rows.length === 1 ? "has" : "have"} a page here.` : null,
    years.length >= 2 ? `Those with a drilling date on record were drilled between ${Math.min(...years)} and ${Math.max(...years)}.` : null,
    lith ? `${holes(lith)} ${lith === 1 ? "carries" : "carry"} a geologist's lithology log in the State's record.` : null,
    au ? `${holes(au)} ${au === 1 ? "carries" : "carry"} gold assays in the State's record.` : null,
    wamex ? `${holes(wamex)} ${wamex === 1 ? "is" : "are"} linked to a WAMEX report.` : null,
    metres > 0 ? `HyFormer, a core-spectra model, has read ${n(Math.round(metres))} m of their scans (model output).` : null,
    again ? `On ${holes(again)} its reading and the geologist's log disagree somewhere, so it suggests looking again (model output).` : null,
  ].filter((x): x is string => !!x);
}

/** Links to the other hubs these rows fall in: regions, then commodities, each with its count among these rows. */
export function relatedHubs(rows: IndexRow[], indexed: IndexRow[]) {
  const keys = new Set(rows.map((r) => r.key));
  const count = (hs: IndexRow[]) => hs.filter((h) => keys.has(h.key)).length;
  return {
    regions: regionHubs(indexed).map((h) => ({ name: h.name, path: regionPath(h.name), n: count(h.holes) })).filter((x) => x.n > 0),
    commodities: commodityHubs(indexed).map((h) => ({ name: titleCase(h.name), path: commodityPath(h.name), n: count(h.holes) })).filter((x) => x.n > 0),
  };
}
