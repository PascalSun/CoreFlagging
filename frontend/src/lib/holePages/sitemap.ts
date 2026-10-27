// What the sitemaps list: the hubs (in the site's main sitemap) and the indexed hole pages (in chunks of
// SITEMAP_CHUNK, each URL with the date its hole last changed on the platform).

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { SITEMAP_CHUNK } from "./config";
import { commodityHubs, commodityPath, holePath, type IndexRow, regionHubs, regionPath, stateHubs, statePath } from "./rules";

const latest = (rows: IndexRow[]) => new Date(Math.max(...rows.map((r) => Date.parse(r.updated)).filter(Number.isFinite)));

export function hubEntries(indexed: IndexRow[]): MetadataRoute.Sitemap {
  return [
    ...stateHubs(indexed).map((h) => ({ url: `${SITE_URL}${statePath(h.holes[0].state)}`, lastModified: latest(h.holes), changeFrequency: "weekly" as const, priority: 0.7 })),
    ...regionHubs(indexed).map((h) => ({ url: `${SITE_URL}${regionPath(h.name)}`, lastModified: latest(h.holes), changeFrequency: "weekly" as const, priority: 0.6 })),
    ...commodityHubs(indexed).map((h) => ({ url: `${SITE_URL}${commodityPath(h.name)}`, lastModified: latest(h.holes), changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}

/** The indexed holes in a fixed order (State, then address), so a hole stays in its chunk while the set is stable. */
export const holeOrder = (indexed: IndexRow[]) => [...indexed].sort((a, b) => a.state.localeCompare(b.state) || a.slug.localeCompare(b.slug));
export const chunkCount = (indexed: IndexRow[]) => Math.max(1, Math.ceil(indexed.length / SITEMAP_CHUNK));

export function holeEntries(indexed: IndexRow[], chunk: number): MetadataRoute.Sitemap {
  return holeOrder(indexed).slice(chunk * SITEMAP_CHUNK, (chunk + 1) * SITEMAP_CHUNK)
    .map((r) => ({ url: `${SITE_URL}${holePath(r)}`, lastModified: new Date(r.updated), changeFrequency: "monthly" as const, priority: 0.5 }));
}
