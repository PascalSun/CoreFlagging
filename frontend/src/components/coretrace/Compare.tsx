"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { commodityName, coreScan, inferred, sourceLabel, TARGET_SOURCE_LABEL, type HoleDetail, type ModelView } from "@/lib/coreScan";
import { StripLog, StripLegend } from "@/components/coretrace/StripLog";
import { coreTypeColor, fmt, pct } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

const glass = "rounded-2xl border border-white/60 bg-white/85 shadow-glass backdrop-blur-xl";

function useHole(key: string | null) {
  const hq = useQuery({ queryKey: ["core-hole", key], queryFn: () => coreScan.hole(key as string), enabled: !!key });
  const mq = useQuery({ queryKey: ["core-models"], queryFn: coreScan.models, staleTime: 10 * 60_000 });
  const run = mq.data?.find((m) => m.default)?.run ?? hq.data?.results[0]?.run ?? "";
  const vq = useQuery({ queryKey: ["core-model", key, run], queryFn: () => coreScan.model(key as string, run), enabled: !!key && !!run && !!hq.data?.results.some((r) => r.run === run), staleTime: 5 * 60_000 });
  return { hole: hq.data, mv: vq.data, run, loading: hq.isPending, error: hq.isError };
}

/** One hole's column: its header, its log on the shared axis, and where the model disagrees with its log. */
function Column({ hole, mv, run, range, cursor, onCursor, missing }: { hole: HoleDetail | undefined; mv: ModelView | undefined; run: string; range: [number, number]; cursor: number | null; onCursor: (m: number) => void; missing: string }) {
  if (!hole) return <div className={cn(glass, "flex min-h-[60vh] items-center justify-center p-6 text-sm text-slate-500")}>{missing}</div>;
  const again = mv?.summary.again?.intervals ?? [];
  const tops = (mv?.summary.main_types ?? []).slice(0, 3);
  return (
    <div className={cn(glass, "glass-print flex min-h-0 flex-col overflow-hidden")}>
      <div className="border-b border-slate-200/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Link href={`/map?hole=${encodeURIComponent(hole.key)}`} className="truncate text-base font-semibold text-slate-900 hover:underline">{hole.name}</Link>
          <span className="flex-none rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{sourceLabel(hole)}</span>
        </div>
        <p className="truncate text-xs text-slate-500">{[hole.operator, hole.project, hole.region].filter(Boolean).join(" · ") || "No collar details in the scan"}</p>
        {hole.target && <p className="text-[11px] text-slate-600" title={TARGET_SOURCE_LABEL[hole.target_source] || ""}>{inferred(hole.target_source) ? "Likely drilled for " : "Drilled for "}<b className="font-semibold text-slate-800">{commodityName(hole.target)}</b>{inferred(hole.target_source) ? <span className="text-slate-400"> ({hole.target_source === "deposit" ? "nearest deposit" : "the report"})</span> : null}</p>}
        <p className="text-[11px] text-slate-500">{fmt(hole.depth_min, 0)}–{fmt(hole.depth_max, 0)} m · {hole.instrument || "instrument not recorded"}{hole.au_m ? ` · ${hole.au_pos_m} of ${hole.au_m} assayed m ≥ 0.1 ppm Au` : " · no gold assays"}</p>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[auto_1fr]">
        <div className="flex h-[60vh] flex-col lg:h-[70vh] print:h-[150mm]">
          <StripLog metres={hole.metres} model={mv} cursor={cursor} onCursor={onCursor} hasLith={hole.has_lith} hasAu={hole.au_m > 0} range={range} />
        </div>
        <div className="flex min-w-0 flex-col gap-3 text-xs text-slate-700">
          {tops.length > 0 && <div><div className="mb-1 text-[11px] font-medium text-slate-500">The model reads mostly</div>
            <ul className="flex flex-col gap-0.5">{tops.map(([n, s]) => <li key={n} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(n) }} />{n}<span className="ml-auto font-mono text-slate-500">{pct(s)}</span></li>)}</ul></div>}
          <div>
            <div className="mb-1 text-[11px] font-medium text-slate-500">Where the model disagrees with the log</div>
            {!hole.has_lith ? <p className="text-[11px] text-slate-500">No geologist&rsquo;s log came with this scan.</p>
              : again.length === 0 ? <p className="text-[11px] text-slate-500">The log and the model agree, by the ultramafic rule.</p>
              : <ul className="flex flex-col gap-1">{again.map((d) => (
                <li key={d.from_m}><button type="button" onClick={() => onCursor(d.from_m)} className="text-left hover:underline"><span className="font-mono">{d.from_m}–{d.to_m} m</span> · log: {d.logged || d.logged_class} · reads: {d.reads}</button></li>))}</ul>}
          </div>
          {mv && <div><div className="mb-1 text-[11px] font-medium text-slate-500">Stands out from its surroundings</div><p>{mv.anomaly.n_flag_m} {mv.anomaly.n_flag_m === 1 ? "metre" : "metres"} flagged{mv.anomaly.runs[0] ? `, most at ${mv.anomaly.runs[0].peak_m} m` : ""}.</p></div>}
          <div className="mt-auto border-t border-slate-100 pt-2"><StripLegend metres={hole.metres} model={mv} hasLith={hole.has_lith} hasAu={hole.au_m > 0} /></div>
          <p className="text-[10px] text-slate-400">Read by {run || "the model"}.</p>
        </div>
      </div>
    </div>
  );
}

/** Two holes on one depth axis: what each log says, what the model reads in each, and where it disagrees.
 * ?a=KEY&b=KEY. Reached from a hole's Nearby list or its similar-core results. */
export function Compare() {
  const sp = useSearchParams();
  const a = useHole(sp.get("a")), b = useHole(sp.get("b"));
  const [cursor, setCursor] = useState<number | null>(null);
  // one axis for both: from the shallower top to the deeper bottom
  const range = useMemo<[number, number]>(() => {
    const tops = [a.hole, b.hole].filter(Boolean).map((h) => h!.metres.m[0] ?? 0), bots = [a.hole, b.hole].filter(Boolean).map((h) => h!.metres.m[h!.metres.m.length - 1] ?? 0);
    return [tops.length ? Math.min(...tops) : 0, bots.length ? Math.max(...bots) : 0];
  }, [a.hole, b.hole]);
  const missing = (x: typeof a, which: string) => (x.error ? `Hole ${which} could not be opened.` : !sp.get(which) ? `Add ?${which}=HOLE to the address.` : "Loading…");
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="compare-root min-h-screen bg-slate-100 px-3 py-3 sm:px-4 print:bg-white print:p-0">
      {/* the printed page is landscape, the two columns side by side, with a header the screen does not need */}
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } .compare-root .no-print { display: none !important; } .compare-root .glass-print { box-shadow: none !important; backdrop-filter: none !important; background: #fff !important; border-color: #cbd5e1 !important; } }`}</style>
      <div className="mb-3 flex flex-wrap items-center gap-3 no-print">
        <Link href={a.hole ? `/map?hole=${encodeURIComponent(a.hole.key)}` : "/map"} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"><ArrowLeft size={14} />Back to the map</Link>
        <h1 className="font-display text-base font-semibold text-slate-900">{a.hole && b.hole ? `${a.hole.name} and ${b.hole.name}, side by side` : "Two holes side by side"}</h1>
        <span className="text-[11px] text-slate-500">One depth axis for both; click a metre on either log to mark it on both.</span>
        {a.hole && b.hole && <button type="button" onClick={() => window.print()} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"><Printer size={13} />Print / save as PDF</button>}
      </div>
      <div className="hidden print:block mb-3">
        <div className="font-display text-lg font-semibold text-slate-900">{a.hole && b.hole ? `${a.hole.name} and ${b.hole.name}, side by side` : "Two holes side by side"}</div>
        <div className="text-[11px] text-slate-500">CoreTrace comparison · {today} · one depth axis for both logs · coretrace.nlp-tlp.org/compare?a={a.hole?.key ?? ""}&amp;b={b.hole?.key ?? ""}</div>
        <div className="text-[10px] text-slate-400">The model&rsquo;s readings are suggestions to check against the core, an assay or a geologist, not findings. Data: the State surveys&rsquo; HyLogger libraries (CC BY 4.0).</div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 print:grid-cols-2">
        <Column hole={a.hole} mv={a.mv} run={a.run} range={range} cursor={cursor} onCursor={setCursor} missing={missing(a, "a")} />
        <Column hole={b.hole} mv={b.mv} run={b.run} range={range} cursor={cursor} onCursor={setCursor} missing={missing(b, "b")} />
      </div>
    </div>
  );
}
