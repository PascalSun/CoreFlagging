"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, X } from "lucide-react";
import { commodityName, coreScan, inferred, sourceLabel, TARGET_SOURCE_LABEL, type HoleDetail, type ModelView, type SpectralLog } from "@/lib/coreScan";
import { StripLog, StripKey } from "@/components/coretrace/StripLog";
import { CORR_TIP, CorrelationView, correlate, type Correlation } from "@/components/coretrace/Correlate";
import { coreTypeColor, fmt, pct } from "@/components/coretrace/palette";

function useHole(key: string | null) {
  const hq = useQuery({ queryKey: ["core-hole", key], queryFn: () => coreScan.hole(key as string), enabled: !!key });
  const mq = useQuery({ queryKey: ["core-models"], queryFn: coreScan.models, staleTime: 10 * 60_000 });
  const run = mq.data?.find((m) => m.default)?.run ?? hq.data?.results[0]?.run ?? "";
  const vq = useQuery({ queryKey: ["core-model", key, run], queryFn: () => coreScan.model(key as string, run), enabled: !!key && !!run && !!hq.data?.results.some((r) => r.run === run), staleTime: 5 * 60_000 });
  const sq = useQuery({ queryKey: ["core-spectral", key], queryFn: () => coreScan.spectralLog(key as string, 1), enabled: !!key && hq.data?.status === "ready", staleTime: 60 * 60_000, retry: false });
  return { hole: hq.data, mv: vq.data, spectral: sq.data, loading: hq.isPending || vq.isPending, error: hq.isError };
}

/** One hole's column: who and what it is, and its log. */
function Column({ hole, mv, spectral, cursor, onCursor, onOpen, missing }: {
  hole: HoleDetail | undefined; mv: ModelView | undefined; spectral?: SpectralLog; cursor: number | null; onCursor: (m: number) => void; onOpen: (key: string) => void; missing: string;
}) {
  if (!hole) return <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-slate-500">{missing}</div>;
  const again = mv?.summary.again?.intervals ?? [];
  const tops = (mv?.summary.main_types ?? []).slice(0, 2);
  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="px-1 pb-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onOpen(hole.key)} title={`Open ${hole.name}`} className="truncate text-base font-semibold text-slate-900 hover:underline">{hole.name}</button>
          <span className="flex-none rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{sourceLabel(hole)}</span>
        </div>
        <p className="truncate text-xs text-slate-500">{[hole.operator, hole.project, hole.region].filter(Boolean).join(" · ") || "No collar details in the scan"}</p>
        <p className="truncate text-[11px] text-slate-600">
          {hole.target && <span title={TARGET_SOURCE_LABEL[hole.target_source] || ""}>{inferred(hole.target_source) ? "Likely drilled for " : "Drilled for "}<b className="font-semibold text-slate-800">{commodityName(hole.target)}</b> · </span>}
          {fmt(hole.depth_min, 0)}–{fmt(hole.depth_max, 0)} m · {hole.instrument || "instrument not recorded"}
        </p>
        {tops.length > 0 && <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-600">Mostly {tops.map(([n, s]) => <span key={n} className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: coreTypeColor(n) }} />{n} {pct(s)}</span>)}</p>}
        {hole.has_lith && again.length > 0 && <p className="text-[11px] text-slate-600">{again.length} {again.length === 1 ? "interval" : "intervals"} where the model disagrees with the log: {again.slice(0, 3).map((d) => (
          <button key={d.from_m} type="button" onClick={() => onCursor(d.from_m)} className="mr-1 font-mono hover:underline">{d.from_m}–{d.to_m} m</button>))}</p>}
      </div>
      <div className="flex min-h-0 flex-1 justify-center">
        <StripLog metres={hole.metres} model={mv} spectral={spectral} cursor={cursor} onCursor={onCursor} hasLith={hole.has_lith} hasAu={hole.au_m > 0} />
      </div>
    </div>
  );
}

/** The nearest link to a depth, from either end. */
function nearest(corr: Correlation | null, m: number, from: "a" | "b") {
  if (!corr) return null;
  let best = corr.links[0], d = Infinity;
  for (const l of corr.links) { const e = Math.abs(l[from] - m); if (e < d) { d = e; best = l; } }
  return best ?? null;
}

/** Two holes side by side, in a panel over the map: each hole's log, and between them the metres of the left hole
 * linked to the metres of the right one they are most like. Opened from a hole's Nearby list or its similar
 * holes; closing it goes back to the hole and the map. */
export function ComparePanel({ a: aKey, b: bKey, onClose, onOpenHole }: { a: string; b: string; onClose: () => void; onOpenHole: (key: string) => void }) {
  const a = useHole(aKey), b = useHole(bKey);
  const [ca, setCa] = useState<number | null>(null), [cb, setCb] = useState<number | null>(null);
  const corr = useMemo(() => (a.hole && b.hole ? correlate({ hole: a.hole, mv: a.mv, spectral: a.spectral }, { hole: b.hole, mv: b.mv, spectral: b.spectral }) : null),
    [a.hole, a.mv, a.spectral, b.hole, b.mv, b.spectral]);
  const missing = (x: typeof a, which: string) => (x.error ? `Hole ${which} could not be opened.` : "Loading…");
  // a metre on one log marks its match on the other
  const pickA = (m: number) => { setCa(m); const l = nearest(corr, m, "a"); if (l) setCb(l.b); };
  const pickB = (m: number) => { setCb(m); const l = nearest(corr, m, "b"); if (l) setCa(l.a); };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-white/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-800">{a.hole && b.hole ? `${a.hole.name} and ${b.hole.name}, side by side` : "Two holes side by side"}</h2>
          <p className="text-xs text-slate-500">Each metre of {a.hole?.name ?? "the left hole"} is linked to the metre of {b.hole?.name ?? "the right hole"} it is most like. Click a chunk between them, or a metre on either log, to mark it and its match.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the comparison" className="grid h-8 w-8 flex-none place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={16} /></button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,380px)_minmax(0,1fr)] lg:overflow-hidden">
        <Column hole={a.hole} mv={a.mv} spectral={a.spectral} cursor={ca} onCursor={pickA} onOpen={onOpenHole} missing={missing(a, "A")} />
        <div className="flex min-h-[420px] flex-col">
          {corr ? (
            <>
              <div className="flex items-baseline justify-center gap-4 pb-1 font-display text-2xl font-semibold text-[#b45f3c]">
                <span className="flex items-center gap-1" data-keytip={CORR_TIP.score}>{corr.score.toFixed(2)}<Info size={12} className="text-slate-400" /></span>
                <span className="flex items-center gap-1" data-keytip={CORR_TIP.rho}>ρ = {corr.rho.toFixed(2)}<Info size={12} className="text-slate-400" /></span>
              </div>
              <p className="pb-2 text-center text-[11px] text-slate-500">matched by {corr.basis === "rock class" ? "HyFormer\u2019s rock class (RC), over 5 m around each metre" : "the mineral groups the scanner reads (SWIR and TIR); no model reading on both holes"}</p>
              <div className="min-h-0 flex-1"><CorrelationView a={{ hole: a.hole!, mv: a.mv, spectral: a.spectral }} b={{ hole: b.hole!, mv: b.mv, spectral: b.spectral }} corr={corr} cursorA={ca} onPick={(x, y) => { setCa(x); setCb(y); }} /></div>
            </>
          ) : <div className="m-auto text-center text-xs text-slate-500">{a.loading || b.loading ? "Matching the two holes…" : "These two holes have nothing to match by: neither a spectral log nor a model reading on both."}</div>}
        </div>
        <Column hole={b.hole} mv={b.mv} spectral={b.spectral} cursor={cb} onCursor={pickB} onOpen={onOpenHole} missing={missing(b, "B")} />
      </div>
      {a.hole && <div className="flex-none border-t border-slate-200/70 bg-white/70 px-4 py-2"><StripKey metres={a.hole.metres} model={a.mv} spectral={a.spectral} /></div>}
    </div>
  );
}
