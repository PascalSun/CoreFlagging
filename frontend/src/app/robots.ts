import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// The public pages are open to every crawler, AI answer engines included; the sign-in hand-offs and the API are not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
