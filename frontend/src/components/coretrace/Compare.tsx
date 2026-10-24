"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, X } from "lucide-react";
import { commodityName, coreScan, inferred, sourceLabel, TARGET_SOURCE_LABEL, type HoleDetail, type ModelView, type SpectralLog } from "@/lib/coreScan";
import { StripLog, StripKeyBar } from "@/components/coretrace/StripLog";
import { CORR_SHOW, CORR_TIP, CorrelationView, correlate, type Correlation, type CorrShow } from "@/components/coretrace/Correlate";
import { fmt, pct, coreTypeBg } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

function useHole(key: string | null) {
  const hq = useQuery({ queryKey: ["core-hole", key], queryFn: () => coreScan.hole(key as string), enabled: !!key });
  const mq = useQuery({ queryKey: ["core-models"], queryFn: coreScan.models, staleTime: 10 * 60_000 });
  const run = mq.data?.find((m) => m.default)?.run ?? hq.data?.results[0]?.run ?? "";
  const vq = useQuery({ queryKey: ["core-model", key, run], queryFn: () => coreScan.model(key as string, run), enabled: !!key && !!run && !!hq.data?.results.some((r) => r.run === run), staleTime: 5 * 60_000 });
  const sq = useQuery({ queryKey: ["core-spectral", key], queryFn: () => coreScan.spectralLog(key as string, 1), enabled: !!key && hq.data?.status === "ready", staleTime: 60 * 60_000, retry: false });
  return { hole: hq.data, mv: vq.data, spectral: sq.data, run, loading: hq.isPending || vq.isPending, error: hq.isError };
}

/** One hole's column: who and what it is, and its log. */
function Column({ hole, mv, spectral, cursor, onCursor, onOpen, missing, win, onWin, mirror, tour }: {
  hole: HoleDetail | undefined; mv: ModelView | undefined; spectral?: SpectralLog; cursor: number | null; onCursor: (m: number) => void; onOpen: (key: string) => void; missing: string;
  /** this log's depth window (null: the whole hole), chosen with its own Scale column and levels */
  win: [number, number] | null; onWin: (w: [number, number] | null) => void;
  /** the right hole: its columns in the left one's mirror order, the Scale column at the outer edge */
  mirror?: boolean;
  /** the column's mark for the tour */
  tour?: string;
}) {
  if (!hole) return <div className="flex min-h-[40vh] items-center justify-center p-6 text-sm text-slate-500">{missing}</div>;
  const again = mv?.summary.again?.intervals ?? [];
  const tops = (mv?.summary.main_types ?? []).slice(0, 2);
  return (
    <div data-tour={tour} className="flex min-h-0 min-w-0 flex-col">
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
        {tops.length > 0 && <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-600">Mostly {tops.map(([n, s]) => <span key={n} className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-[2px]" style={{ background: coreTypeBg(n) }} />{n} {pct(s)}</span>)}</p>}
        {hole.has_lith && again.length > 0 && <p className="text-[11px] text-slate-600">{again.length} {again.length === 1 ? "interval" : "intervals"} where the model disagrees with the log: {again.slice(0, 3).map((d) => (
          <button key={d.from_m} type="button" onClick={() => onCursor(d.from_m)} className="mr-1 font-mono hover:underline">{d.from_m}–{d.to_m} m</button>))}</p>}
      </div>
      <div className="flex min-h-0 flex-1 justify-center max-lg:h-[70vh] max-lg:flex-none">
        <StripLog metres={hole.metres} model={mv} spectral={spectral} cursor={cursor} onCursor={onCursor} hasLith={hole.has_lith} hasAu={hole.au_m > 0} range={win ?? undefined} onRange={onWin} mirror={mirror} />
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

/** Two holes beside each other, in a panel over the map: each hole's log, and between them the metres of the left hole
 * linked to the metres of the right one they are most like. Opened from a hole's Nearby list or its similar
 * holes; closing it goes back to the hole and the map. */
export function ComparePanel({ a: aKey, b: bKey, winA = null, winB = null, onClose, onOpenHole }: {
  a: string; b: string; onClose: () => void; onOpenHole: (key: string) => void;
  /** open each log on a stretch (a similar-core match) rather than the whole hole */
  winA?: [number, number] | null; winB?: [number, number] | null;
}) {
  const a = useHole(aKey), b = useHole(bKey);
  const [ca, setCa] = useState<number | null>(winA ? Math.floor(winA[0]) : null), [cb, setCb] = useState<number | null>(winB ? Math.floor(winB[0]) : null);
  const [wa, setWa] = useState<[number, number] | null>(winA), [wb, setWb] = useState<[number, number] | null>(winB);
  // the column beside RC in the middle view
  const [show, setShow] = useState<CorrShow>("swir");
  // a metre marked outside a log's window brings the window to it, keeping its length
  const follow = (w: [number, number] | null, set: (w: [number, number] | null) => void, m: number) => {
    if (w && (m < w[0] || m + 1 > w[1])) { const s = w[1] - w[0], a0 = Math.max(0, Math.round((m + 0.5 - s / 2) * 10) / 10); set([a0, Math.round((a0 + s) * 10) / 10]); }
  };
  // HyFormer's fingerprints, matched by the platform; until it answers (or where it cannot), a stand-in by rock class
  // the whole matrix when the platform will give it (refused past 2 million pairs), else its own links
  const mq = useQuery({ queryKey: ["core-match", aKey, bKey, a.run], queryFn: () => coreScan.match(aKey, bKey, a.run, true).catch(() => coreScan.match(aKey, bKey, a.run)), enabled: !!a.run && !!a.hole && !!b.hole, staleTime: 60 * 60_000, retry: false });
  const corr = useMemo<Correlation | null>(() => {
    const mx = mq.data?.matrix;
    if (mq.data && mx?.a_m.length && mx.b_m.length) {
      // each metre of the left hole in view linked to its top-1 metre of the right hole in view, by cosine
      const inA = (m: number) => !wa || (m + 1 > wa[0] && m < wa[1]), inB = (m: number) => !wb || (m + 1 > wb[0] && m < wb[1]);
      const js = mx.b_m.map((m, j) => [m, j] as const).filter(([m]) => inB(m)); const links: Correlation["links"] = [];
      mx.a_m.forEach((am, i) => { if (!inA(am) || !js.length) return; let bj = js[0][1]; for (const [, j] of js) if (mx.sim[i][j] > mx.sim[i][bj]) bj = j; links.push({ a: am, b: mx.b_m[bj], sim: mx.sim[i][bj] }); });
      return { links, score: mq.data.score, rho: mq.data.rho, basis: "representation" };
    }
    if (mq.data?.links.length) return { links: mq.data.links.map((l) => ({ a: l.a_m, b: l.b_m, sim: l.sim })), score: mq.data.score, rho: mq.data.rho, basis: "representation" };
    return a.hole && b.hole ? correlate({ hole: a.hole, mv: a.mv, spectral: a.spectral }, { hole: b.hole, mv: b.mv, spectral: b.spectral }) : null;
  }, [mq.data, wa, wb, a.hole, a.mv, a.spectral, b.hole, b.mv, b.spectral]);
  const missing = (x: typeof a, which: string) => (x.error ? `Hole ${which} could not be opened.` : "Loading…");
  // a metre on one log marks its match on the other
  const both = (x: number, y: number) => { setCa(x); setCb(y); follow(wa, setWa, x); follow(wb, setWb, y); };
  const pickA = (m: number) => { const l = nearest(corr, m, "a"); if (l) both(m, l.b); else setCa(m); };
  const pickB = (m: number) => { const l = nearest(corr, m, "b"); if (l) both(l.a, m); else setCb(m); };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-white/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-800">{a.hole && b.hole ? `${a.hole.name} and ${b.hole.name}` : "Two holes"}</h2>
          <p className="text-xs text-slate-500">Each metre of {a.hole?.name ?? "the left hole"} is linked to the one metre of {b.hole?.name ?? "the right hole"} it is most like (in the window, when there is one). Point at a metre between them to light its link; click it, or a metre on either log, to mark it and its match.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the comparison" className="grid h-8 w-8 flex-none place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={16} /></button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 max-lg:auto-rows-max lg:grid-cols-[minmax(0,1fr)_minmax(300px,440px)_minmax(0,1fr)] lg:overflow-hidden">
        <Column hole={a.hole} mv={a.mv} spectral={a.spectral} cursor={ca} onCursor={pickA} onOpen={onOpenHole} missing={missing(a, "A")} win={wa} onWin={setWa} tour="compare-a" />
        <div data-tour="compare-mid" className="flex min-h-[420px] flex-col max-lg:h-[75vh]">
          {corr ? (
            <>
              <div className="flex items-baseline justify-center gap-4 pb-1 font-display text-2xl font-semibold text-[#b45f3c]">
                <span className="flex items-center gap-1" data-keytip={CORR_TIP.score}>{corr.score.toFixed(2)}<Info size={12} className="text-slate-400" /></span>
                <span className="flex items-center gap-1" data-keytip={CORR_TIP.rho}>ρ = {corr.rho.toFixed(2)}<Info size={12} className="text-slate-400" /></span>
              </div>
              <div data-tour="compare-show" className="flex justify-center pb-2" role="group" aria-label="Column beside RC">
                <div className="flex overflow-hidden rounded-md border border-slate-200 text-[11px]">
                  {CORR_SHOW.map((c) => <button key={c.id} type="button" aria-pressed={show === c.id} onClick={() => setShow(c.id)} className={cn("px-2 py-0.5 pointer-coarse:px-3 pointer-coarse:py-1.5", show === c.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>{c.label}</button>)}
                </div>
              </div>
              <p className="pb-2 text-center text-[11px] text-slate-500">matched by {corr.basis === "representation" ? "HyFormer\u2019s representation (2 m fingerprints), as Similar core" : corr.basis === "rock class" ? "rock class (RC) for now, until the representation match is available" : "the mineral groups the scanner reads (SWIR and TIR) for now; no model reading on both holes"}</p>
              <div className="min-h-0 flex-1"><CorrelationView a={{ hole: a.hole!, mv: a.mv, spectral: a.spectral }} b={{ hole: b.hole!, mv: b.mv, spectral: b.spectral }} corr={corr} cursorA={ca} winA={wa} winB={wb} onPick={both} show={show} /></div>
            </>
          ) : <div className="m-auto text-center text-xs text-slate-500">{a.loading || b.loading ? "Matching the two holes…" : "These two holes have nothing to match by: neither a spectral log nor a model reading on both."}</div>}
        </div>
        <Column hole={b.hole} mv={b.mv} spectral={b.spectral} cursor={cb} onCursor={pickB} onOpen={onOpenHole} missing={missing(b, "B")} win={wb} onWin={setWb} mirror />
      </div>
      {a.hole && <StripKeyBar metres={a.hole.metres} model={a.mv} spectral={a.spectral} />}
    </div>
  );
}
