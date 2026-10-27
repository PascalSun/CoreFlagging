import type { MetadataRoute } from "next";
import { indexedRowsOrNone } from "@/lib/holePages/data";
import { hubEntries } from "@/lib/holePages/sitemap";
import { PAGES, SITE_URL } from "@/lib/seo";

// The site's pages and the drillhole hubs. The hole pages themselves are in /holes/sitemap/{n}.xml (robots.txt lists them).
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return [
    ...PAGES.map(([path, changeFrequency, priority]) => ({ url: `${SITE_URL}${path}`, lastModified: new Date(), changeFrequency, priority })),
    ...hubEntries(await indexedRowsOrNone()),
  ];
}
