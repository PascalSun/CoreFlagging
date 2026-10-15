"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { coreScan } from "@/lib/coreScan";
import { fmt, pct, coreTypeBg } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

/** Every tectonic region with enough scanned holes, and what its core is made of: the mean share of each core
 * type over the region's holes. One row per region, the types as a stacked bar in a fixed order so the same
 * colour means the same thing down the page; hover a block for the number. */
export function Regions() {
  const q = useQuery({ queryKey: ["core-regions"], queryFn: coreScan.regions, staleTime: 60 * 60_000 });
  const [sort, setSort] = useState<"holes" | "name">("holes");
  const d = q.data;
  const names = useMemo(() => new Map((d?.core_types ?? []).map((c) => [c.k, c.name])), [d]);
  const order = useMemo(() => (d?.core_types ?? []).map((c) => c.k), [d]);
  const rows = useMemo(() => [...(d?.regions ?? [])].sort((a, b) => (sort === "holes" ? b.n_holes - a.n_holes : a.region.localeCompare(b.region))), [d, sort]);
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href="/map" className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"><ArrowLeft size={14} />Map</Link>
          <h1 className="font-display text-lg font-semibold text-slate-900">Core by region</h1>
          <span className="text-xs text-slate-500">{d ? `${d.regions.length} tectonic regions with five or more scanned holes` : q.isPending ? "Loading…" : ""}</span>
          <div className="ml-auto flex overflow-hidden rounded-md border border-slate-200 text-[11px]" role="group" aria-label="Sort">
            {(["holes", "name"] as const).map((s) => <button key={s} type="button" onClick={() => setSort(s)} className={cn("px-2 py-0.5", sort === s ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>{s === "holes" ? "By holes" : "By name"}</button>)}
          </div>
        </div>
        <p className="mb-4 max-w-3xl text-xs leading-relaxed text-slate-600">
          For each region, the average share of each rock class over its holes, as the model reads them metre by metre. The same type has the same colour in every row, so a region&rsquo;s signature can be read against the others. Shares are of scanned core, which is where companies chose to drill, not of the crust.
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pb-3 text-[11px] text-slate-600">
          {order.map((k) => <span key={k} className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-[2px]" style={{ background: coreTypeBg(names.get(k)) }} />{names.get(k)}</span>)}
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-xs">
            <thead><tr className="border-b border-slate-200 text-[11px] text-slate-500">
              <th className="px-3 py-2 text-left font-medium">Region</th><th className="w-16 px-3 py-2 text-right font-medium">Holes</th><th className="w-24 px-3 py-2 text-right font-medium">Metres read</th><th className="px-3 py-2 text-left font-medium">Rock classes, by share</th>
            </tr></thead>
            <tbody>{rows.map((r) => {
              const by = new Map(r.types.map((t) => [t.k, t]));
              return (
                <tr key={r.region} className="border-b border-slate-100 align-middle hover:bg-slate-50">
                  <td className="px-3 py-2"><Link href={`/map?view=holes&q=${encodeURIComponent(r.region)}`} className="font-medium text-slate-900 underline-offset-2 hover:underline">{r.region}</Link></td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">{r.n_holes}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(r.metres, 0)}</td>
                  <td className="px-3 py-2">
                    <div className="flex h-5 w-full overflow-hidden rounded">
                      {order.map((k) => { const t = by.get(k); if (!t || t.share < 0.005) return null; return (
                        <div key={k} title={`${names.get(k)}: ${pct(t.share)} of the region's core, in ${t.holes} of ${r.n_holes} holes`} className="h-full border-r border-white/60 last:border-0" style={{ width: `${t.share * 100}%`, background: coreTypeBg(names.get(k)) }} />); })}
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-slate-500">{r.types.slice(0, 3).map((t) => `${names.get(t.k)} ${pct(t.share)}`).join(" · ")}</div>
                  </td>
                </tr>);
            })}</tbody>
          </table>
          {q.isError && <p className="px-3 py-6 text-center text-xs text-slate-500">The region profiles are not available right now.</p>}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Regions are GSWA&rsquo;s tectonic units as recorded with each hole; a region with fewer than five scanned holes is left out. Click a region to list its holes.</p>
      </div>
    </div>
  );
}
