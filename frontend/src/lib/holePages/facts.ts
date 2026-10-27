// The facts a hole page states, picked field by field out of the platform's answers. Only what is named here
// reaches a page: nothing of the model's fingerprints, the geologists' reviews, uploads, the DMIRS assay values
// or another State's tray photographs is ever copied across, so it cannot be rendered by mistake.

import type { HoleDetail, HoleDocuments, HolePackage, Standout, Tray } from "@/lib/coreScan";
import { type IndexRow, holePath, passesH0 } from "./rules";
import { TRAY_PHOTO_STATES, termsOf } from "./licence";

export type AgainFact = { from_m: number; to_m: number; logged: string; logged_class: string; reads: string };
export type HoleFacts = {
  key: string; slug: string; name: string; state: string; path: string;
  lat: number | null; lon: number | null; region: string; operator: string; project: string; drilled: number | null;
  depth_min: number | null; depth_max: number | null; instrument: string; azimuth: number | null; inclination: number | null;
  target: string; target_source: string; has_lith: boolean; au_m: number; training: boolean; read_on: string | null; updated: string;
  model: null | { name: string; run: string; read_m: number | null; n_segments: number | null; n_flag: number | null;
    main_types: { name: string; share: number }[]; again: AgainFact[] };
  region_cmp: null | { region: string; n_holes: number; items: { name: string; hole_share: number; region_share: number }[] };
  domains: { from_m: number; to_m: number; type: string; why: string[] }[];
  trays: null | { n: number; pick: { id: string; from_m: number; to_m: number; width: number; height: number } | null };
  pdfs: { title: string; kind: string; pages: number | null; url: string; licence: string }[];
  wamex: { anumber: string; title: string; year: number | null; url: string }[];
  pkg: null | { collar_id: number; hole_type: string; max_depth: number | null; n_geology: number; n_assay: number };
  nearby: { name: string; km: number; path: string }[];
};

export type Raw = {
  row: IndexRow; run: string | null; detail: HoleDetail | null; standout: Standout | null; documents: HoleDocuments | null;
  trays: { trays: Tray[] } | null; pkg: HolePackage | null; nearby: { holes: { key: string; km: number }[] } | null;
  /** every hole that has a page, by key, to link the neighbours that have one */
  pages: Map<string, IndexRow>;
  /** the platform's public address, for links to its PDFs */
  platformUrl: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
/** The model's name as readers see it (the platform may still hold its working name). */
export const modelName = (name: string) => (name || "HyFormer").replace(/^CoreTrace-MAE/, "HyFormer");

export function holeFacts(r: Raw): HoleFacts {
  const { row, detail } = r;
  const tsg = (detail?.meta?.tsg ?? {}) as Record<string, unknown>;
  const res = r.run ? detail?.results?.find((x) => x.run === r.run) : undefined;
  const s = res?.summary;
  const traysOk = TRAY_PHOTO_STATES.includes(row.state) && r.trays && r.trays.trays.length > 0;
  const again: AgainFact[] = (s?.again?.intervals ?? []).map((i) => ({ from_m: i.from_m, to_m: i.to_m, logged: str(i.logged), logged_class: str(i.logged_class), reads: str(i.reads) }));
  let pick = null;
  if (traysOk) {
    const ts = r.trays!.trays;
    const at = again[0]?.from_m;
    const t = (at != null ? ts.find((x) => x.from_m <= at && at <= x.to_m) : undefined) ?? ts[0];
    pick = { id: t.id, from_m: t.from_m, to_m: t.to_m, width: t.width, height: t.height };
  }
  const hv = r.standout?.hole_vs_region;
  return {
    key: row.key, slug: row.slug, name: row.name, state: row.state, path: holePath(row),
    lat: row.lat, lon: row.lon, region: str(row.region), operator: str(row.operator), project: str(row.project), drilled: row.drilled,
    depth_min: row.depth_min, depth_max: row.depth_max, instrument: str(detail?.instrument),
    azimuth: num(tsg.azimuth), inclination: num(tsg.inclination),
    target: str(row.target), target_source: str(row.target_source), has_lith: !!row.has_lith, au_m: row.au_m || 0,
    training: row.split === "train" || row.split === "val", read_on: detail?.processed_at ?? null, updated: row.updated,
    model: res && s ? {
      name: modelName(str(res.model?.name)), run: res.run, read_m: num(s.metres), n_segments: num(s.n_segments), n_flag: num(s.n_flag),
      main_types: (s.main_types ?? []).filter(([n, sh]) => n && typeof sh === "number" && sh > 0).map(([name, share]) => ({ name, share })),
      again,
    } : null,
    region_cmp: hv && hv.region && hv.n_holes > 0 && hv.items.length
      ? { region: hv.region, n_holes: hv.n_holes, items: hv.items.map((i) => ({ name: i.name, hole_share: i.hole_share, region_share: i.region_share })) }
      : null,
    domains: (r.standout?.domains ?? []).map((d) => ({ from_m: d.from_m, to_m: d.to_m, type: d.type, why: d.why.map((w) => w.text) })),
    trays: traysOk ? { n: r.trays!.trays.length, pick } : null,
    pdfs: (r.documents?.hole_pdfs ?? [])
      .filter((p) => (p as { licence?: { confirmed?: boolean } }).licence?.confirmed)
      .map((p) => ({ title: p.title, kind: p.kind, pages: p.pages, url: `${r.platformUrl}${p.url}`, licence: (p as { licence?: { name?: string } }).licence?.name ?? "" })),
    wamex: (r.documents?.wamex?.linked ?? []).filter((l) => /^A\d+$/.test(l.anumber))
      .map((l) => ({ anumber: l.anumber, title: str(l.title), year: l.year ?? null, url: `https://wamex.dmp.wa.gov.au/Wamex/Search/ReportDetails?ANumber=${l.anumber.slice(1)}` })),
    // a summary only: the package is interim, so its geology and assay rows are counted, never copied
    pkg: row.state === "WA" && r.pkg ? { collar_id: r.pkg.collar_id, hole_type: str(r.pkg.collar?.hole_type), max_depth: num(r.pkg.collar?.max_depth),
      n_geology: r.pkg.geology?.length ?? 0, n_assay: r.pkg.assays?.rows?.length ?? 0 } : null,
    nearby: (r.nearby?.holes ?? []).filter((n) => n.key !== row.key && r.pages.has(n.key) && passesH0(r.pages.get(n.key)!))
      .slice(0, 8).map((n) => { const p = r.pages.get(n.key)!; return { name: p.name, km: n.km, path: holePath(p) }; }),
  };
}

export const stateName = (state: string) => termsOf(state)?.name ?? state;
