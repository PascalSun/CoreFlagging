import type { MetadataRoute } from "next";
import { indexedRowsOrNone } from "@/lib/holePages/data";
import { chunkCount } from "@/lib/holePages/sitemap";
import { SITE_URL } from "@/lib/seo";

// The public pages are open to every crawler, AI answer engines included; the sign-in hand-offs and the API are not.
// The site's sitemap, then one per ~2,000 drillhole pages.
export const revalidate = 86400;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const n = chunkCount(await indexedRowsOrNone());
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }],
    sitemap: [`${SITE_URL}/sitemap.xml`, ...Array.from({ length: n }, (_, i) => `${SITE_URL}/holes/sitemap/${i}.xml`)],
    host: SITE_URL,
  };
}
