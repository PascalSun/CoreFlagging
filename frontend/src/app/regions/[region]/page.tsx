import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Hub } from "@/components/holePages/Hub";
import { indexedRows } from "@/lib/holePages/data";
import { regionHubs, regionPath, statePath } from "@/lib/holePages/rules";
import { pageMeta } from "@/lib/seo";

// A Western Australian tectonic region's scanned holes, when enough of them are indexed.
export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

type Params = { params: Promise<{ region: string }> };

async function hub(slug: string) {
  const indexed = await indexedRows();
  const h = regionHubs(indexed).find((x) => x.slug === slug);
  return h ? { h, indexed } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const x = await hub((await params).region);
  if (!x) return { title: "Not found", robots: { index: false, follow: true } };
  return pageMeta(regionPath(x.h.name), `Scanned drillholes in the ${x.h.name}, Western Australia | CoreFlagging`,
    `${x.h.holes.length.toLocaleString("en-AU")} HyLogger-scanned drillholes in the ${x.h.name}, Western Australia, each with GSWA's record of the hole and HyFormer's reading of its scan.`);
}

export default async function RegionPage({ params }: Params) {
  const x = await hub((await params).region);
  if (!x) notFound();
  return <Hub crumbs={[{ name: "Western Australia", path: statePath("WA") }, { name: x.h.name, path: regionPath(x.h.name) }]}
    title={`Scanned drillholes in the ${x.h.name}`} where={`in the ${x.h.name}, Western Australia,`} rows={x.h.holes} indexed={x.indexed} />;
}
