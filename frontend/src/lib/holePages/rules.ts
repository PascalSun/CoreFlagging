// Which holes get a public page, which of those are indexed, and the hubs over them. Pure functions over the
// platform's slim hole index (GET /core-scan/api/hole-index/), so the rules are tested without a network.
//
// H0, a page exists: an NVCL hole (never an upload), read by the model, onshore with a collar position,
//     at least 20 m scanned, and not a petroleum well.
// H1, the page is indexed: H0 plus at least one fact of its own beyond the scan: an operator or project on
//     record, a target from the hole's own record, a logged lithology, a "look again" interval, gold assays,
//     or a linked WAMEX report. A page that passes H0 only is served with noindex,follow and left out of the sitemap.

/** One row of the platform's hole index, as named by its `fields`. */
export type IndexRow = {
  key: string; slug: string; name: string; state: string; lon: number | null; lat: number | null; offshore: boolean;
  operator: string; project: string; region: string; depth_min: number | null; depth_max: number | null; drilled: number | null;
  has_lith: boolean; au_m: number; n_again: number; target: string; target_source: string; commodities: string[]; split: string;
  read_m: number | null; n_flag: number | null; wamex: boolean; updated: string;
  /** "nvcl" for every row the index serves; kept so a row from anywhere else can never pass H0 */
  source?: string;
};
export type HoleIndex = { model: string | null; fields: string[]; n: number; holes: unknown[][] };

/** The index's compact rows as objects. Rows the platform sends are NVCL holes only. */
export function rowsOf(ix: HoleIndex): IndexRow[] {
  return ix.holes.map((r) => ({ source: "nvcl", ...Object.fromEntries(ix.fields.map((f, i) => [f, r[i]])) }) as IndexRow);
}

export const MIN_SCANNED_M = 20;

export function passesH0(h: IndexRow): boolean {
  return (h.source ?? "nvcl") === "nvcl"
    && h.read_m != null && h.read_m > 0
    && !h.offshore && h.lon != null && h.lat != null
    && h.depth_min != null && h.depth_max != null && h.depth_max - h.depth_min >= MIN_SCANNED_M
    && h.split !== "petroleum"
    && !!h.slug;
}

/** Why an H0 hole is worth indexing; empty when it is not. */
export function h1Reasons(h: IndexRow): string[] {
  const r: string[] = [];
  if (h.operator || h.project) r.push("operator or project");
  if (h.target && h.target_source === "survey") r.push("target from the hole's own record");
  if (h.has_lith) r.push("logged lithology");
  if (h.n_again > 0) r.push("look-again interval");
  if (h.au_m > 0) r.push("gold assays");
  if (h.wamex) r.push("linked WAMEX report");
  return r;
}
export const passesH1 = (h: IndexRow) => passesH0(h) && h1Reasons(h).length > 0;

// ─── addresses ───

/** "Albany–Fraser Orogen" -> "albany-fraser-orogen": a region or commodity in an address. */
export function slugify(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
export const stateSlug = (state: string) => state.toLowerCase();
export const holePath = (h: Pick<IndexRow, "state" | "slug">) => `/holes/${stateSlug(h.state)}/${h.slug}`;
export const statePath = (state: string) => `/states/${stateSlug(state)}`;
export const regionPath = (region: string) => `/regions/${slugify(region)}`;
export const commodityPath = (c: string) => `/commodities/${slugify(c)}`;

// ─── hubs ───

/** A hub is published only when this many indexed holes back it. */
export const MIN_HUB_HOLES = 10;

export type Hub = { slug: string; name: string; holes: IndexRow[] };

function group(rows: IndexRow[], keys: (h: IndexRow) => string[]): Hub[] {
  const by = new Map<string, { names: Map<string, number>; holes: IndexRow[] }>();
  for (const h of rows) {
    const done = new Set<string>();      // a hole counts once per hub, however many spellings it carries
    for (const k of keys(h).filter(Boolean)) {
      const s = slugify(k); if (!s || done.has(s)) continue;
      done.add(s);
      const g = by.get(s) ?? { names: new Map<string, number>(), holes: [] as IndexRow[] };
      g.names.set(k, (g.names.get(k) ?? 0) + 1); g.holes.push(h); by.set(s, g);
    }
  }
  return [...by.entries()]
    .filter(([, g]) => g.holes.length >= MIN_HUB_HOLES)
    // the hub is named by the spelling most of its holes use ("Yilgarn Craton" over "YILGARN CRATON")
    .map(([slug, g]) => ({ slug, name: [...g.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], holes: byName(g.holes) }))
    .sort((a, b) => b.holes.length - a.holes.length || a.name.localeCompare(b.name));
}
export const byName = (rows: IndexRow[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }) || a.slug.localeCompare(b.slug));

/** Tectonic-region hubs: WA only (the platform's regions are GSWA's tectonic units). */
export const regionHubs = (indexed: IndexRow[]) => group(indexed.filter((h) => h.state === "WA"), (h) => [h.region]);
/** Commodity hubs: the commodities the hole's own record names (the DMIRS HyLogger drillhole package in WA). */
export const commodityHubs = (indexed: IndexRow[]) => group(indexed.filter((h) => h.target_source === "survey"), (h) => h.commodities);
export const stateHubs = (indexed: IndexRow[]) => group(indexed, (h) => [h.state]).map((g) => ({ ...g, slug: stateSlug(g.holes[0].state) }));
