import type { MetadataRoute } from "next";
import { indexedRowsOrNone } from "@/lib/holePages/data";
import { chunkCount, holeEntries } from "@/lib/holePages/sitemap";

// The indexed hole pages, about 2,000 to a file: /holes/sitemap/0.xml, /holes/sitemap/1.xml, ...
// A page that is not indexed (noindex) is never listed.
export const revalidate = 86400;

export async function generateSitemaps() {
  return Array.from({ length: chunkCount(await indexedRowsOrNone()) }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  return holeEntries(await indexedRowsOrNone(), Number(await id) || 0);
}
