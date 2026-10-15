"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { coreScan, type HoleDetail, type SimilarScope } from "@/lib/coreScan";
import { fmt } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

const th = "border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-medium text-slate-500";
const td = "border-b border-slate-100 px-2 py-1.5 text-xs text-slate-700";

/** Holes that look like this one as a whole, metre by metre on the model's representation: every metre of this hole
 * finds its best match in the other hole and the cosines are averaged (both ways) into the likeness; ρ says whether
 * the other hole repeats this one's order down the hole, so a hole of the same make-up the other way up scores high
 * on likeness and negative on ρ. */
export function SimilarHoles({ hole, run, onOpenHole, onCompare }: { hole: HoleDetail; run: string; onOpenHole: (key: string) => void; onCompare?: (key: string) => void }) {
  const [scope, setScope] = useState<Exclude<SimilarScope, "hole">>("state");
  const q = useQuery({ queryKey: ["core-similar-holes", hole.key, run, scope], queryFn: () => coreScan.similarHoles(hole.key, run, scope), staleTime: 10 * 60_000, retry: false });
  const d = q.data;
  const scopes: { id: Exclude<SimilarScope, "hole">; label: string; hint: string }[] = [
    { id: "nearby", label: "Within 25 km", hint: "The neighbouring holes" }, { id: "region", label: hole.region ? `Region: ${hole.region}` : "Region", hint: "Holes of the same tectonic region" }, { id: "state", label: "Whole State", hint: "Every other scanned hole in WA" }];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Where to look">
        <span className="text-[11px] text-slate-500">Look in</span>
        {scopes.filter((sc) => sc.id !== "region" || hole.region).map((sc) => <button key={sc.id} type="button" role="tab" aria-selected={scope === sc.id} title={sc.hint} onClick={() => setScope(sc.id)} className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1", scope === sc.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:ring-slate-400")}>{sc.label}</button>)}
      </div>
      {q.isPending ? <p className="text-xs text-slate-500">Comparing…</p>
      : q.isError || !d ? <p className="text-xs text-slate-500">{(q.error as { status?: number })?.status === 404 ? "This hole has no metre vectors yet (they are written when a hole is read)." : "The comparison is not available right now."}</p>
      : (
        <>
          <p className="text-xs leading-relaxed text-slate-600">This hole, {d.mine.from_m}–{d.mine.to_m} m ({d.mine.n} metres), against {d.n_candidates.toLocaleString()} scanned holes{scope === "nearby" ? " within 25 km" : scope === "region" ? ` in ${hole.region}` : " across the State"}{d.compared < d.n_candidates ? ` (the ${d.compared} closest by their mean vector compared metre by metre)` : ""}: each metre finds the metre of the other hole the model reads as most alike, and the cosines are averaged both ways into the <b className="font-medium text-slate-800">likeness</b>. <b className="font-medium text-slate-800">ρ</b> says whether the other hole repeats this one&rsquo;s order down the hole: 1 the same order, 0 no relation, −1 the other way up.</p>
          {d.results.length === 0 ? <p className="text-xs text-slate-500">No other hole to compare with here.</p> : (
            <table className="w-full border-collapse">
              <thead><tr>{["Hole", "Likeness", "ρ (order)", "Metres", scope === "nearby" ? "Distance" : "Region", "Drilled for"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{d.results.map((r) => (
                <tr key={r.key} onClick={() => onOpenHole(r.key)} className="cursor-pointer hover:bg-slate-50">
                  <td className={cn(td, "font-medium text-slate-900")}>{r.name}<ArrowRight size={12} className="ml-1 inline" /><button type="button" onClick={(e) => { e.stopPropagation(); onCompare?.(r.key); }} className="ml-2 text-[11px] font-normal text-slate-500 underline-offset-2 hover:underline">compare</button></td>
                  <td className={cn(td, "font-mono")}>{r.score.toFixed(2)}</td><td className={cn(td, "font-mono text-slate-500")}>{r.rho === null ? "—" : r.rho.toFixed(2)}</td><td className={cn(td, "font-mono text-slate-500")}>{r.n}</td>
                  <td className={td}>{scope === "nearby" ? (r.km !== null ? `${fmt(r.km, 1)} km` : "—") : r.region || "—"}</td>
                  <td className={cn(td, "text-slate-500")}>{r.target || "—"}</td></tr>))}</tbody>
            </table>)}
        </>)}
    </div>
  );
}
