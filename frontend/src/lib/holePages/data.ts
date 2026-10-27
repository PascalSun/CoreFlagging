// Server-side reads from the platform for the public hole pages. Every read goes through Next's data cache for a
// day (the pages' own revalidate), so a page regenerates at most daily and the platform is asked once per hole.

import type { HoleDetail, HoleDocuments, HolePackage, Standout, Tray } from "@/lib/coreScan";
import { ENABLED_STATES, REVALIDATE_S, stateEnabled } from "./config";
import { type HoleFacts, holeFacts } from "./facts";
import { type HoleIndex, type IndexRow, passesH0, passesH1, rowsOf } from "./rules";

/** Where the server reaches the platform (it may be an internal address) and the public address for links. */
const API = (process.env.PLATFORM_API_URL || process.env.NEXT_PUBLIC_PLATFORM_URL || "https://platform.nlp-tlp.org").replace(/\/$/, "");
export const PUBLIC_PLATFORM = (process.env.NEXT_PUBLIC_PLATFORM_URL || "https://platform.nlp-tlp.org").replace(/\/$/, "");

const enc = encodeURIComponent;

async function get<T>(path: string, tag: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}/core-scan/api${path}`, { next: { revalidate: REVALIDATE_S, tags: [tag] }, headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export type StateIndex = { model: string | null; rows: IndexRow[] };

/** One State's rows from the slim index (cached a day). Throws when the platform cannot be reached, so a page
 * regeneration fails and the last good page stays up, instead of a "not found" being cached for a day. */
export async function stateIndex(state: string): Promise<StateIndex> {
  const ix = await get<HoleIndex>(`/hole-index/?state=${enc(state.toUpperCase())}`, `hole-index-${state.toUpperCase()}`);
  if (!ix || !Array.isArray(ix.holes) || !Array.isArray(ix.fields)) throw new Error(`the platform's hole index for ${state} is unavailable`);
  return { model: ix.model, rows: rowsOf(ix) };
}

/** The enabled States' rows, H0 holes only (the ones that have a page). */
export async function pageRows(): Promise<{ model: string | null; rows: IndexRow[] }> {
  const all = await Promise.all(ENABLED_STATES.map(stateIndex));
  return { model: all.find((a) => a.model)?.model ?? null, rows: all.flatMap((a) => a.rows).filter(passesH0) };
}
export const indexedRows = async () => (await pageRows()).rows.filter(passesH1);
/** For the sitemaps and robots.txt: the indexed rows, or none when the platform is away (they must still render). */
export const indexedRowsOrNone = () => indexedRows().catch(() => [] as IndexRow[]);

export type HolePage = { facts: HoleFacts; row: IndexRow; indexed: boolean };

/** Everything one hole page shows, or null when the hole has no page (unknown, State not enabled, fails H0). */
export async function holePage(state: string, slug: string): Promise<HolePage | null> {
  if (!stateEnabled(state)) return null;
  const ix = await stateIndex(state);
  const row = ix.rows.find((r) => r.slug === slug);
  if (!row || !passesH0(row)) return null;
  const k = enc(row.key), tag = `hole-${row.key}`;
  const wa = row.state === "WA";
  const run = ix.model;
  const [detail, standout, documents, trays, pkg, nearby] = await Promise.all([
    get<HoleDetail>(`/holes/${k}/`, tag),
    run ? get<Standout>(`/holes/${k}/standout/?model=${enc(run)}`, tag) : Promise.resolve(null),
    get<HoleDocuments>(`/holes/${k}/documents/`, tag),
    wa ? get<{ trays: Tray[] }>(`/holes/${k}/trays/`, tag) : Promise.resolve(null),
    wa ? get<HolePackage>(`/holes/${k}/package/`, tag) : Promise.resolve(null),
    get<{ holes: { key: string; km: number }[] }>(`/holes/${k}/nearby/?km=5`, tag),
  ]);
  const pages = new Map(ix.rows.filter(passesH0).map((r) => [r.key, r]));
  return { row, indexed: passesH1(row), facts: holeFacts({ row, run, detail, standout, documents, trays, pkg, nearby, pages, platformUrl: PUBLIC_PLATFORM }) };
}
