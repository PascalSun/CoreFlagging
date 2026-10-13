// Reading the DMIRS HyLogger package against an interval: the chemistry and the company's log
// over a depth range, in the words a geologist checks a disagreement with.

import type { HolePackage } from "@/lib/coreScan";

/** A column's plain label: "mgo_pct" -> "MgO %", "ni_ppm" -> "Ni ppm". */
export function assayLabel(col: string): string {
  const [name, unit] = col.split("_");
  const pretty = name.replace(/^([a-z])([a-z]?)(\d*)o(\d*)$/, (_m, a, b, n1, n2) => `${a.toUpperCase()}${b}${n1 ? sub(n1) : ""}O${n2 ? sub(n2) : ""}`)
    .replace(/^fe2o3t$/, "Fe₂O₃T").replace(/^loi$/, "LOI");
  const el = /^[a-z]{1,2}$/.test(name) ? name[0].toUpperCase() + name.slice(1) : pretty;
  return `${el} ${unit === "pct" ? "%" : unit}`;
}
const sub = (d: string) => d.replace(/\d/g, (c) => "₀₁₂₃₄₅₆₇₈₉"[Number(c)]);

export type Chem = { n: number; mgo: number | null; ni: number | null; cr: number | null; au: number | null; cu: number | null };

/** The assays whose interval overlaps [from, to): how many, and the medians of the values that tell
 * ultramafic from mafic (MgO, Ni, Cr) plus the metals of interest. */
export function chemistryOver(pkg: HolePackage | undefined, from: number, to: number): Chem {
  const none: Chem = { n: 0, mgo: null, ni: null, cr: null, au: null, cu: null };
  if (!pkg) return none;
  const idx = (c: string) => pkg.assays.columns.indexOf(c);
  const rows = pkg.assays.rows.filter((r) => r.to_m > from && r.from_m < to);
  if (!rows.length) return none;
  const med = (c: string) => { const i = idx(c); if (i < 0) return null; const xs = rows.map((r) => r.v[i]).filter((x): x is number => x !== null).sort((a, b) => a - b); return xs.length ? xs[Math.floor(xs.length / 2)] : null; };
  const max = (c: string) => { const i = idx(c); if (i < 0) return null; const xs = rows.map((r) => r.v[i]).filter((x): x is number => x !== null); return xs.length ? Math.max(...xs) : null; };
  return { n: rows.length, mgo: med("mgo_pct"), ni: med("ni_ppm"), cr: med("cr_ppm"), au: max("au_ppm"), cu: max("cu_ppm") };
}

/** The company's logged intervals overlapping [from, to), longest overlap first, as "code (name) · comment". */
export function loggedOver(pkg: HolePackage | undefined, from: number, to: number, limit = 3): string[] {
  if (!pkg) return [];
  return pkg.geology
    .map((g) => ({ g, o: Math.min(g.to_m, to) - Math.max(g.from_m, from) }))
    .filter((x) => x.o > 0 && (x.g.code || x.g.name || x.g.rock || x.g.comments))
    .sort((a, b) => b.o - a.o).slice(0, limit)
    .map(({ g }) => [g.rock || g.name || g.code, g.rock && g.code && g.rock !== g.code ? `(${g.code})` : "", g.comments ? `· ${g.comments}` : ""].filter(Boolean).join(" "));
}

/** What a geologist reads first in the chemistry: "MgO 25%, Ni 1,300 ppm" or "no chemistry here". */
export function chemText(c: Chem): string {
  if (!c.n) return "";
  const parts = [c.mgo !== null ? `MgO ${c.mgo.toFixed(c.mgo >= 10 ? 0 : 1)}%` : "", c.ni !== null ? `Ni ${Math.round(c.ni).toLocaleString()} ppm` : "",
    c.cr !== null ? `Cr ${Math.round(c.cr).toLocaleString()}` : "", c.au !== null && c.au >= 0.1 ? `Au ${c.au.toFixed(2)} ppm` : "", c.cu !== null && c.cu >= 1000 ? `Cu ${Math.round(c.cu).toLocaleString()} ppm` : ""].filter(Boolean);
  return parts.join(" · ");
}
