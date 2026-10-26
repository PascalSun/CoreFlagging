import type { Metadata } from "next";

// What search engines and AI answer engines are told about CoreFlagging: the address, the pages worth indexing,
// and the facts in structured data. Every fact here is one the landing page already states; keep them in step.

/** The one public address. The app is also reachable at its old host; canonicals point here. */
export const SITE_URL = "https://coreflagging.nlp-tlp.org";
export const SITE_NAME = "CoreFlagging";

export const KEYWORDS = [
  "HyLogger", "drill core", "drill core scans", "hyperspectral core scanning", "National Virtual Core Library", "NVCL",
  "core logging", "geological log", "drillhole", "core library", "HyFormer", "core-spectra model",
  "Geological Survey of Western Australia", "GSWA", "Western Australia", "mineral exploration",
];

/** The public pages, for the sitemap: path, how often it changes, priority. */
export const PAGES: [string, "daily" | "weekly" | "monthly", number][] = [
  ["/", "weekly", 1],
  ["/map", "weekly", 0.9],
];

/** The 1200×630 share image (a capture of the landing page's hero), for link previews on LinkedIn, WeChat, Slack, X. */
export const SHARE_IMAGE = {
  url: "/og-image.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
  alt: "CoreFlagging: a second opinion on every metre of core. The landing page over a HyLogger-scanned drill core tray, with the mineral the scan reads under each row.",
};

/** Canonical, Open Graph and Twitter tags for one public page. Open Graph is replaced, not merged, per segment,
 *  so every page carries the share image itself. */
export function pageMeta(path: string, title: string, description: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_AU", url: path, title, description, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGE] },
  };
}

export const ORG = {
  "@type": "Organization",
  "@id": "https://nlp-tlp.org/#org",
  name: "UWA Centre for Natural and Technical Language Processing",
  alternateName: "NLP-TLP",
  url: "https://nlp-tlp.org/",
  email: "pascal.sun@uwa.edu.au",
  parentOrganization: { "@type": "CollegeOrUniversity", name: "The University of Western Australia" },
};

const DESCRIPTION = "CoreFlagging reads every HyLogger-scanned drillhole the same way and sets its reading beside the geologist's log, so the intervals where they disagree get another look. Checked against logs and chemistry in Western Australia.";

/** Structured data for the landing page: the site, the app, the readings as a Dataset, and who runs it. */
export const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    ORG,
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, url: SITE_URL, name: SITE_NAME, inLanguage: "en-AU", publisher: { "@id": ORG["@id"] },
      description: "A second opinion on every metre of core." },
    { "@type": "WebApplication", "@id": `${SITE_URL}/#app`, name: SITE_NAME, url: SITE_URL, description: DESCRIPTION,
      applicationCategory: "ScientificApplication", operatingSystem: "Web", publisher: { "@id": ORG["@id"] },
      featureList: [
        "A map of about 6,600 HyLogger-scanned drillholes from every State's core library",
        "A PDF report per hole: data-quality problems, intervals that stand out, metres most worth assaying, rock classification and domain boundaries",
        "Finding core like a chosen interval or hole, nearby or across the State",
        "An assistant that answers questions about a hole and finds the WAMEX reports behind it",
        "Upload your own scan",
      ] },
    { "@type": "Dataset", "@id": `${SITE_URL}/#readings`, name: "CoreFlagging readings of Australia's scanned drill core", url: `${SITE_URL}/map`,
      description: "HyFormer's reading of the HyLogger-scanned drillholes in the National Virtual Core Library, about 6,600 holes from every State's core library: the mineral the scan reads every 10 cm, rock classification, domain boundaries, the metres that stand out from the core around them, and data-quality problems in the scan.",
      keywords: KEYWORDS, inLanguage: "en", creator: { "@id": ORG["@id"] },
      spatialCoverage: { "@type": "Place", name: "Australia" } },
  ],
};
