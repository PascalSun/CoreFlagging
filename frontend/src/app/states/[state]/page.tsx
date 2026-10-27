import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Hub } from "@/components/holePages/Hub";
import { indexedRows } from "@/lib/holePages/data";
import { termsOf } from "@/lib/holePages/licence";
import { regionHubs, slugify, stateHubs, statePath } from "@/lib/holePages/rules";
import { pageMeta } from "@/lib/seo";

// A State's scanned holes: one hub per enabled State with enough indexed holes.
export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

type Params = { params: Promise<{ state: string }> };

async function hub(state: string) {
  const indexed = await indexedRows();
  const h = stateHubs(indexed).find((x) => x.slug === state.toLowerCase());
  return h ? { h, indexed, name: termsOf(h.holes[0].state)?.name ?? h.name } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const x = await hub((await params).state);
  if (!x) return { title: "Not found", robots: { index: false, follow: true } };
  return pageMeta(statePath(x.h.holes[0].state), `Scanned drillholes in ${x.name} | CoreFlagging`,
    `${x.h.holes.length.toLocaleString("en-AU")} HyLogger-scanned drillholes in ${x.name}, each with the State's record of the hole and HyFormer's reading of its scan.`);
}

export default async function StatePage({ params }: Params) {
  const x = await hub((await params).state);
  if (!x) notFound();
  // every hole is listed on one hub: the region hubs list theirs, this page the rest
  const inHub = new Set(regionHubs(x.indexed).map((r) => r.slug));
  const rest = x.h.holes.filter((h) => !inHub.has(slugify(h.region)));
  const regional = rest.length < x.h.holes.length;
  return <Hub crumbs={[{ name: x.name, path: statePath(x.h.holes[0].state) }]} title={`Scanned drillholes in ${x.name}`} where={`in ${x.name}`} rows={x.h.holes} indexed={x.indexed}
    listed={regional ? { title: "Holes outside the regions above", rows: rest } : undefined} />;
}
