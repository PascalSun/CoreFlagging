import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Hub } from "@/components/holePages/Hub";
import { indexedRows } from "@/lib/holePages/data";
import { titleCase } from "@/lib/holePages/hubs";
import { commodityHubs, commodityPath } from "@/lib/holePages/rules";
import { pageMeta } from "@/lib/seo";

// The scanned holes whose own record names a commodity, when enough of them are indexed.
export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

type Params = { params: Promise<{ commodity: string }> };

async function hub(slug: string) {
  const indexed = await indexedRows();
  const h = commodityHubs(indexed).find((x) => x.slug === slug);
  return h ? { h, indexed } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const x = await hub((await params).commodity);
  if (!x) return { title: "Not found", robots: { index: false, follow: true } };
  return pageMeta(commodityPath(x.h.name), `${titleCase(x.h.name)}: scanned drillholes | CoreFlagging`,
    `${x.h.holes.length.toLocaleString("en-AU")} HyLogger-scanned drillholes whose own record names ${x.h.name} among their target commodities.`);
}

export default async function CommodityPage({ params }: Params) {
  const x = await hub((await params).commodity);
  if (!x) notFound();
  return <Hub crumbs={[{ name: titleCase(x.h.name), path: commodityPath(x.h.name) }]} title={`${titleCase(x.h.name)}: scanned drillholes`}
    where={`whose own record names ${x.h.name} among their target commodities`} rows={x.h.holes} indexed={x.indexed}
    extraSource={x.h.holes.every((r) => r.state === "WA") ? { name: "DMIRS HyLogger drillhole package (each hole's own record)", url: "https://dasc.dmirs.wa.gov.au/", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/" } : undefined} />;
}
