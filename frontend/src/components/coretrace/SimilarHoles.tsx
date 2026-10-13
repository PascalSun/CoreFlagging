"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { coreScan, type HoleDetail, type HoleSig, type SimilarScope } from "@/lib/coreScan";
import { coreTypeColor, fmt, pct } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

const th = "border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-medium text-slate-500";
const td = "border-b border-slate-100 px-2 py-1.5 text-xs text-slate-700";

/** The 20 slices of a hole, top to bottom, as a thin bar coloured by core type: a hole's order at a glance. */
function SeqBar({ sig, names }: { sig: HoleSig; names: Map<number, string> }) {
  return <div className="flex h-2.5 w-28 overflow-hidden rounded-[2px]" title={`${sig.from_m}–${sig.to_m} m, in 20 slices`}>{sig.seq.map((k, i) => <i key={i} className="h-full flex-1" style={{ background: coreTypeColor(names.get(k)) }} />)}</div>;
}

/** Holes that look like this one as a whole: what they are made of (the share of each core type) and in what
 * order down the hole (the type read most in each of 20 slices). Both parts are shown so the reader sees
 * which one carried a match: a hole of the same make-up the other way up scores high on composition and
 * low on order. */
export function SimilarHoles({ hole, run, onOpenHole }: { hole: HoleDetail; run: string; onOpenHole: (key: string) => void }) {
  const [scope, setScope] = useState<Exclude<SimilarScope, "hole">>("state");
  const q = useQuery({ queryKey: ["core-similar-holes", hole.key, run, scope], queryFn: () => coreScan.similarHoles(hole.key, run, scope), staleTime: 10 * 60_000, retry: false });
  const d = q.data;
  const names = new Map((d?.core_types ?? []).map((c) => [c.k, c.name]));
  const scopes: { id: Exclude<SimilarScope, "hole">; label: string; hint: string }[] = [
    { id: "nearby", label: "Within 25 km", hint: "The neighbouring holes" }, { id: "region", label: hole.region ? `Region: ${hole.region}` : "Region", hint: "Holes of the same tectonic region" }, { id: "state", label: "Whole State", hint: "Every other scanned hole in WA" }];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Where to look">
        <span className="text-[11px] text-slate-500">Look in</span>
        {scopes.filter((sc) => sc.id !== "region" || hole.region).map((sc) => <button key={sc.id} type="button" role="tab" aria-selected={scope === sc.id} title={sc.hint} onClick={() => setScope(sc.id)} className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1", scope === sc.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:ring-slate-400")}>{sc.label}</button>)}
      </div>
      {q.isPending ? <p className="text-xs text-slate-500">Comparing…</p>
      : q.isError || !d ? <p className="text-xs text-slate-500">{(q.error as { status?: number })?.status === 404 ? "This hole has no whole-hole signature yet (it is written when a hole is read)." : "The comparison is not available right now."}</p>
      : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span>This hole, {d.mine.from_m}–{d.mine.to_m} m:</span><SeqBar sig={d.mine} names={names} />
            <span className="text-[11px] text-slate-500">{Object.entries(d.mine.shares).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${names.get(Number(k))} ${pct(v)}`).join(" · ")}</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600">Compared with {d.n_candidates.toLocaleString()} scanned holes{scope === "nearby" ? " within 25 km" : scope === "region" ? ` in ${hole.region}` : " across the State"}, on two counts: <b className="font-medium text-slate-800">make-up</b>, the share of each core type, and <b className="font-medium text-slate-800">order</b>, the type read most in each of 20 slices down the hole, matched so a stretched or shifted section still counts. Likeness is the mean of the two.</p>
          {d.results.length === 0 ? <p className="text-xs text-slate-500">No other hole to compare with here.</p> : (
            <table className="w-full border-collapse">
              <thead><tr>{["Hole", "Likeness", "Make-up", "Order", "Down the hole", scope === "nearby" ? "Distance" : "Region", "Drilled for"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{d.results.map((r) => (
                <tr key={r.key} onClick={() => onOpenHole(r.key)} className="cursor-pointer hover:bg-slate-50">
                  <td className={cn(td, "font-medium text-slate-900")}>{r.name}<ArrowRight size={12} className="ml-1 inline" /><a href={`/compare?a=${encodeURIComponent(hole.key)}&b=${encodeURIComponent(r.key)}`} onClick={(e) => e.stopPropagation()} className="ml-2 text-[11px] font-normal text-slate-500 underline-offset-2 hover:underline">compare</a></td>
                  <td className={cn(td, "font-mono")}>{r.score.toFixed(2)}</td><td className={cn(td, "font-mono text-slate-500")}>{r.composition.toFixed(2)}</td><td className={cn(td, "font-mono text-slate-500")}>{r.sequence.toFixed(2)}</td>
                  <td className={td}><SeqBar sig={r.sig} names={names} /></td>
                  <td className={td}>{scope === "nearby" ? (r.km !== null ? `${fmt(r.km, 1)} km` : "—") : r.region || "—"}</td>
                  <td className={cn(td, "text-slate-500")}>{r.target || "—"}</td></tr>))}</tbody>
            </table>)}
        </>)}
    </div>
  );
}
