// Structured data for a hole page: the State survey's HyLogger scan of the hole as a schema.org Dataset (creator
// the survey, licence the State's), placed by its collar, plus the breadcrumb State › region › hole. HyFormer's
// readings are not part of the Dataset: no licence is published for them. A State whose licence is not confirmed
// (Victoria, CSIRO) gets no Dataset node, only the breadcrumb.

import { SITE_URL } from "@/lib/seo";
import type { HoleFacts } from "./facts";
import { NVCL, termsOf } from "./licence";
import { statePath } from "./rules";
import { m } from "./sentences";

export function holeJsonLd(f: HoleFacts, regionHub: { name: string; path: string } | null) {
  const t = termsOf(f.state);
  const url = `${SITE_URL}${f.path}`;
  const crumbs = [
    { name: t?.name ?? f.state, item: `${SITE_URL}${statePath(f.state)}` },
    ...(regionHub ? [{ name: regionHub.name, item: `${SITE_URL}${regionHub.path}` }] : []),
    { name: f.name, item: url },
  ];
  const graph: Record<string, unknown>[] = [{
    "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`,
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })),
  }];
  if (t?.licence) {
    const span = f.depth_min != null && f.depth_max != null ? `, ${m(f.depth_min)} to ${m(f.depth_max)} m down the hole` : "";
    graph.push({
      "@type": "Dataset", "@id": `${url}#scan`, name: `HyLogger scan of drillhole ${f.name}, ${t.name}`, url,
      description: `Hyperspectral (HyLogger) scan of the drill core of ${f.name}, a drillhole in ${t.name}${span}, held in the ${NVCL.name} by the ${t.survey}.`,
      identifier: f.key,
      creator: { "@type": "GovernmentOrganization", name: t.survey, url: t.surveyUrl },
      license: t.licence.url,
      creditText: t.attribution,
      isAccessibleForFree: true,
      includedInDataCatalog: { "@type": "DataCatalog", name: NVCL.name, url: NVCL.url },
      ...(f.lat != null && f.lon != null ? { spatialCoverage: { "@type": "Place", name: `Collar of ${f.name}`, geo: { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lon } } } : {}),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

export const breadcrumbLd = (items: { name: string; path: string }[]) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SITE_URL}${c.path}` })),
});

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export const ldJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
