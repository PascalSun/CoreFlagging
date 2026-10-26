import type { MetadataRoute } from "next";
import { PAGES, SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(([path, changeFrequency, priority]) => ({ url: `${SITE_URL}${path}`, lastModified: new Date(), changeFrequency, priority }));
}
