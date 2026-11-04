"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileDown, Loader2, Maximize2 } from "lucide-react";
import { coreScan, safeName, saveBlob, type HoleDetail, type ModelView, type Sample, type SpectralLog, type Tray } from "@/lib/coreScan";
import { LINE, SpectraChart } from "@/components/coretrace/SpectraChart";
import { TrayPhoto } from "@/components/coretrace/TrayPhoto";
import { fmt, groupColor, groupName, mineralName, pct, coreTypeBg } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

import { LEVELS, MIN_SPAN, fmtSpan, fmtWindow, levelOf, windowAt, type Window } from "@/lib/depth";
export { LEVELS, MIN_SPAN, levelOf, type Window };

const H4 = ({ children }: { children: React.ReactNode }) => <h4 className="pb-1.5 font-display text-[14px] font-semibold text-slate-900">{children}</h4>;

/** One window of a hole, read at the level its length calls for: a long window lists what the model found in
 * it; a metre shows everything about that metre (`metreDetail`: the model's reading, the photograph, the spectra
 * against the core around it) and its 10 cm bins; the finest shows the bins and the photographs.
 * The model's reading never goes below the metre it was made at. */
export function DepthLens({ hole, mv, win, onWindow, trays, metre, onMetre, typeName, metreDetail, spectral, spectralFine, order = [] }: {
  hole: HoleDetail; mv: ModelView | undefined; win: Window; onWindow: (w: Window | null) => void; trays: Tray[];
  metre: number | null; onMetre: (m: number) => void; typeName: (k: number) => string;
  /** shown at the 1 m level: the old "This metre" page, for the metre in the window */
  metreDetail?: React.ReactNode;
  /** the window's 0.1 m group make-up, and the order the groups stack in (the whole hole's) */
  spectralFine?: SpectralLog; order?: string[];
  /** the whole hole's 1 m group make-up, for the 10 m summary */
  spectral?: SpectralLog;
}) {
  const [from, to] = win; const span = to - from; const level = levelOf(win);
  const d0 = hole.metres.m[0] ?? 0, d1 = (hole.metres.m[hole.metres.m.length - 1] ?? 0) + 1;
  const bq = useQuery({ queryKey: ["core-bins", hole.key, Math.round(from * 10), Math.round(to * 10)], queryFn: () => coreScan.bins(hole.key, from, to), enabled: span <= 50, staleTime: 10 * 60_000 });
  const [pick, setPick] = useState<number | null>(null); const [hover, setHover] = useState<number | null>(null);
  const shownBin = hover ?? pick;
  // the bin's spectra; the last one stays up (faded) while the next loads, so the box below never empties and the page never jumps
  const sq = useQuery({ queryKey: ["core-bin", hole.key, shownBin], queryFn: () => coreScan.bin(hole.key, shownBin as number), enabled: shownBin !== null, staleTime: 10 * 60_000, placeholderData: keepPreviousData });
  const step = (dir: -1 | 1) => { const d = span * 0.5 * dir; const a = Math.max(d0, Math.min(d1 - span, from + d)); onWindow([round1(a), round1(a + span)]); };
  const metres = useMemo(() => { const out: number[] = []; for (let m = Math.floor(from); m < to; m++) if (hole.metres.m.includes(m)) out.push(m); return out; }, [from, to, hole.metres.m]);
  const midx = useMemo(() => new Map((mv?.m ?? []).map((m, i) => [m, i])), [mv]);
  const inWin = (a: number, b: number) => b > from && a < to;
  const flags = (mv?.anomaly.runs ?? []).filter((r) => inWin(r.from_m, r.to_m));
  const again = (mv?.summary.again?.intervals ?? []).filter((d) => inWin(d.from_m, d.to_m));
  const nm = (v: number) => `${Math.round(v)}`, um = (v: number) => (v / 1000).toFixed(1);

  return (
    <div className="flex flex-col gap-5">
      {/* where we are, and the way up and sideways */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* the way down to here, level by level: each coarser window is a step back up */}
        <nav className="flex flex-wrap items-center gap-1 text-slate-500" aria-label="Depth">
          <button type="button" onClick={() => onWindow(null)} className="font-medium text-slate-700 hover:underline">{hole.name}</button>
          {LEVELS.slice(1, LEVELS.findIndex((l) => l.id === level)).map((l) => { const w = windowAt(l.id, (from + to) / 2, d0, d1); return w ? (
            <span key={l.id} className="flex items-center gap-1"><span>›</span><button type="button" onClick={() => onWindow(w)} className="font-mono text-slate-600 hover:underline" title={`Back out to ${l.label}`}>{fmtWindow(w)}</button></span>) : null; })}
          <span>›</span>
          <span className="font-mono font-semibold text-slate-900">{fmtWindow(win)}</span>
          <span className="text-slate-400">· {fmtSpan(span)} window</span>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} aria-label="Up the hole" className="grid h-6 w-6 pointer-coarse:h-8 pointer-coarse:w-8 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronLeft size={13} className="rotate-90" /></button>
          <button type="button" onClick={() => step(1)} aria-label="Down the hole" className="grid h-6 w-6 pointer-coarse:h-8 pointer-coarse:w-8 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight size={13} className="rotate-90" /></button>
          <button type="button" onClick={() => onWindow([round1(Math.max(d0, from - span / 2)), round1(Math.min(d1, to + span / 2))])} title="Zoom out" className="grid h-6 w-6 pointer-coarse:h-8 pointer-coarse:w-8 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><Maximize2 size={12} /></button>
        </div>
      </div>

      {level === "hole" || level === "10m" ? (
        <>
          {flags.length > 0 && (
            <section>
              <H4>Metres that stand out, in this window</H4>
              <ul className="flex flex-wrap gap-1.5">{flags.map((r) => (
                <li key={r.from_m}><button type="button" onClick={() => onWindow([r.from_m - 0.5, r.to_m + 0.5])} className="rounded-full border border-orange/50 bg-orange/10 px-2 py-0.5 font-mono text-[11px] text-slate-800 hover:border-orange">{r.from_m}–{r.to_m} m · {r.raw.toFixed(2)}</button></li>))}</ul>
            </section>
          )}
          {again.length > 0 && (
            <section>
              <H4>Where the model disagrees with the log, in this window</H4>
              <ul className="flex flex-col gap-1 text-xs text-slate-700">{again.map((d) => (
                <li key={d.from_m}><button type="button" onClick={() => onWindow([d.from_m, d.to_m])} className="text-left hover:underline"><span className="font-mono">{d.from_m}–{d.to_m} m</span> · log: {d.logged || d.logged_class} · reads: {d.reads}</button></li>))}</ul>
            </section>
          )}
          <TenMetres hole={hole} mv={mv} spectral={spectral} from={from} to={to} typeName={typeName} onWindow={onWindow} />
          {metres.length <= 12 && trayMetres(trays, metres).map((m) => <TrayPhoto key={m} holeKey={hole.key} trays={trays} metre={m} onMetre={onMetre} />)}
          {metres.length > 12 && <p className="text-[11px] text-slate-500">Zoom to 10 m or closer to see the photographs of each metre.</p>}
        </>
      ) : (
        <>
          {/* the metre level: the model's reading of each metre in the window (one card per metre when the window
              spans more than one), everything about the metre, then the 10 cm bins */}
          {mv && (level !== "1m" || metres.length > 1) && metres.length > 0 && (
            <section>
              <H4>HyFormer reads, per metre</H4>
              <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-3">{metres.map((m) => { const j = midx.get(m); if (j === undefined) return null; return (
                <button key={m} type="button" onClick={() => onMetre(m)} className={cn("rounded-lg border bg-white px-3 py-2 text-left hover:border-slate-400", metre === m ? "border-cyan" : "border-slate-200")}>
                  <div className="text-[11px] text-slate-500">{m}–{m + 1} m</div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeBg(typeName(mv.core[j])) }} /><span className="truncate">{typeName(mv.core[j])}</span></div>
                  <div className="text-[11px] text-slate-500">unusual {pct(mv.anom[j])} · gold {fmt(mv.gold[j])}</div>
                </button>); })}</div>
              <p className="pt-1 text-[10.5px] text-slate-400">The model reads the core by the metre; below that, what you see is the scanner&rsquo;s own reading and the photograph.</p>
            </section>
          )}
          {level === "1m" && metreDetail}
          {span <= 2.5 && <SampleLevel hole={hole} from={from} to={to} />}
          <section>
            <H4>Every 10 cm: what the scanner read</H4>
            {bq.data ? (
              <BinStrip bins={bq.data.bins} from={from} to={to} pick={pick} hover={hover} onHover={setHover} onPick={(b) => setPick(pick === b ? null : b)} onZoom={(b) => onWindow([b / 10, b / 10 + MIN_SPAN])} log={spectralFine} order={order} />
            ) : <p className="text-xs text-slate-500">{bq.isPending ? "Reading the bins…" : "No bins in this window."}</p>}
            {/* one box of one height whatever is in it (nothing yet, a bin loading, a bin with or without TIR): hovering
                along the strip changes its contents, never its size */}
            {bq.data && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3" style={{ height: 390 }}>
                {shownBin !== null && sq.data ? (
                  <div className={cn("flex min-h-0 flex-col gap-3 transition-opacity", sq.isPlaceholderData && "opacity-50")}>
                    <div className="flex items-baseline gap-x-3 overflow-hidden whitespace-nowrap text-xs"><b className="font-semibold text-slate-900">{(shownBin / 10).toFixed(1)}–{(shownBin / 10 + 0.1).toFixed(1)} m</b>
                      <span className="truncate">SWIR <b className="font-medium">{mixOf(spectralFine, shownBin, "swir") ?? groupName(sq.data.gs)}</b>{sq.data.ms ? ` · ${mineralName(sq.data.ms)}` : ""}</span><span className="truncate">TIR <b className="font-medium">{mixOf(spectralFine, shownBin, "tir") ?? groupName(sq.data.gt)}</b></span>
                      <span className="flex-none text-slate-500">{sq.data.n_swir} samples{sq.data.n_tir ? `, ${sq.data.n_tir} with TIR` : ", no TIR"}</span>
                      <span className="ml-auto flex-none text-slate-400">{hover !== null && pick !== hover ? "hovering; click a bin to keep it" : pick !== null ? "kept; click it again to let go" : ""}</span></div>
                    <SpectraChart title="SWIR, this 10 cm" unit="nm" xTicks={[500, 1000, 1500, 2000, 2500]} xFmt={nm} height={140} lines={[{ name: "this bin", color: LINE.measured, x: sq.data.swir_wl, y: sq.data.swir }]} />
                    <SpectraChart title="TIR, this 10 cm" unit="µm" xTicks={[7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000]} xFmt={um} height={140} note={sq.data.tir ? undefined : "not measured in this bin"}
                      lines={[{ name: "this bin", color: LINE.measured, x: sq.data.tir_wl, y: sq.data.tir ?? null }]} />
                  </div>
                ) : <p className="m-auto text-center text-xs text-slate-400">Move over a bin above to read its spectra here; click one to keep it.</p>}
              </div>
            )}
          </section>
          {/* at 1 m the metre's own photograph is in the detail above */}
          {level !== "1m" && trayMetres(trays, metres).map((m) => <TrayPhoto key={m} holeKey={hole.key} trays={trays} metre={m} onMetre={onMetre} />)}
        </>
      )}
    </div>
  );
}

const round1 = (v: number) => Math.round(v * 10) / 10;

const PRED = "bg-cyan/[0.08] border-b-transparent";   // the tint of a column the model predicts: one band, no row rules across it
const th10 = "border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-medium text-slate-500";
const td10 = "border-b border-slate-100 px-2 py-1.5 align-top text-xs text-slate-700";

/** The leading entries of a tally, as "Chlorite 62%, Invalid 21%". */
function leading(tally: Map<string, number>, n: number, name: (k: string) => string): { k: string; text: string }[] {
  const tot = [...tally.values()].reduce((a, b) => a + b, 0); if (!tot) return [];
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, text: `${name(k)} ${pct(v / tot)}` }));
}

/** The window in 10 m steps (on the tens: 300–310, 310–320 …), each with what the three readings say: the TSG
 * groups of SWIR and TIR (weighted by the software's fit, from the spectral log; the leading group per metre
 * without one) and HyFormer's rock classification (the class read most, by metre). Click a row to open it. */
function TenMetres({ hole, mv, spectral, from, to, typeName, onWindow }: {
  hole: HoleDetail; mv: ModelView | undefined; spectral?: SpectralLog; from: number; to: number; typeName: (k: number) => string; onWindow: (w: Window) => void;
}) {
  const rows = useMemo(() => {
    const spec = new Map((spectral?.rows ?? []).map((r) => [Math.round(r.from_m), r]));
    const midx = new Map((mv?.m ?? []).map((m, i) => [m, i]));
    const bins = new Map<number, { sw: Map<string, number>; tr: Map<string, number>; rc: Map<string, number>; n: number }>();
    hole.metres.m.forEach((m, i) => {
      if (m + 1 <= from || m >= to) return;
      const k = Math.floor(m / 10) * 10; let b = bins.get(k);
      if (!b) { b = { sw: new Map(), tr: new Map(), rc: new Map(), n: 0 }; bins.set(k, b); }
      b.n++;
      const add = (t: Map<string, number>, g: string, v: number) => { if (g && g !== "nan") t.set(g, (t.get(g) ?? 0) + v); };
      const r = spec.get(m);
      if (r?.swir?.n_result) for (const [g, v] of Object.entries(r.swir.mix)) add(b.sw, g, v * r.swir.n_result); else add(b.sw, hole.metres.gs[i], 1);
      if (r?.tir?.n_result) for (const [g, v] of Object.entries(r.tir.mix)) add(b.tr, g, v * r.tir.n_result); else if (!spectral) add(b.tr, hole.metres.gt[i], 1);
      const j = midx.get(m); if (j !== undefined && mv) add(b.rc, String(mv.core[j]), 1);
    });
    return [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => ({ k, n: b.n,
      sw: leading(b.sw, 2, groupName), tr: leading(b.tr, 2, groupName), rc: leading(b.rc, 1, (c) => typeName(Number(c))) }));
  }, [hole, mv, spectral, from, to, typeName]);
  if (!rows.length) return null;
  const sw = (xs: { k: string; text: string }[], colour: (k: string) => string) => xs.length
    ? <span className="flex flex-col gap-0.5">{xs.map((x) => <span key={x.k} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: colour(x.k) }} />{x.text}</span>)}</span>
    : <span className="text-slate-400">—</span>;
  return (
    <section>
      <H4>Every 10 m: what each reading says</H4>
      <div className="overflow-x-auto"><table className="w-full min-w-[26rem] border-collapse">
        {/* the model's column is tinted: what HyFormer predicts, beside what the scanner's software read */}
        <thead><tr>{["Depth (m)", "SWIR", "TIR"].map((h) => <th key={h} className={th10}>{h}</th>)}<th className={cn(th10, PRED, "rounded-t-md")}>Rock Classification</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.k} onClick={() => onWindow([r.k, r.k + 10])} className="cursor-pointer hover:bg-slate-50" title={`Open ${r.k}–${r.k + 10} m`}>
            <td className={cn(td10, "font-mono whitespace-nowrap")}>{r.k}–{r.k + 10}{r.n < 10 ? <span className="ml-1 font-sans text-[10px] text-slate-400">({r.n} m of core)</span> : null}</td>
            <td className={td10}>{sw(r.sw, groupColor)}</td>
            <td className={td10}>{sw(r.tr, groupColor)}</td>
            <td className={cn(td10, PRED)}>{sw(r.rc, (c) => coreTypeBg(typeName(Number(c))))}</td>
          </tr>))}</tbody>
      </table></div>
      <p className="pt-1 text-[10.5px] text-slate-400">SWIR and TIR: the share of each mineral group the scanner&rsquo;s TSG software reads, over the 10 m. Rock Classification: the class HyFormer reads in most of its metres, and in what share of them.</p>
    </section>
  );
}

/** The finest level: the window's line-scan photograph beside every ~8 mm sample's SWIR and TIR group, from the
 * mirrored package through the service (the first look at a hole unpacks it: a few seconds).
 *
 * Laid out by sample INDEX, not depth. The line scan holds the same number of image rows for every spectrum
 * sample, in index order, but the samples' depths are not linear in index (tray and section breaks, gaps). So each
 * sample gets the same height in every column, the image is stretched to the columns' height (which is then exact:
 * its rows map one-to-one onto the samples), and depth is shown by tick labels taken from the samples themselves.
 * Placing the image by depth (the old column) drifted against the mineral ticks at every break. */
function SampleLevel({ hole, from, to }: { hole: HoleDetail; from: number; to: number }) {
  const lo = Math.floor(from * 100) / 100, hi = Math.ceil(to * 100) / 100;
  const sq = useQuery({ queryKey: ["core-samples", hole.key, lo, hi], queryFn: () => coreScan.samples(hole.key, lo, hi), staleTime: 60 * 60_000, retry: false });
  const samples = useMemo(() => sq.data?.samples ?? [], [sq.data]);
  const n = samples.length;
  // the photograph, fetched (an upload's needs the session) once the samples say there is something to show
  // keyed by the window, so a new window reads as loading without resetting state inside the effect
  const id = `${hole.key}:${lo}:${hi}`;
  const [shot, setShot] = useState<{ id: string; url: string | null; state: "loading" | "ok" | "none"; w: number; h: number } | null>(null);
  const img = shot?.id === id ? shot : { id, url: null, state: "loading" as const, w: 0, h: 0 };
  const setImg = (f: (v: typeof img) => typeof img) => setShot((v) => f(v?.id === id ? v : img));
  useEffect(() => {
    if (!n) return;
    let url: string | null = null, gone = false;
    coreScan.linescanImage(hole.key, lo, hi, 400).then((u) => { if (gone) URL.revokeObjectURL(u); else { url = u; setShot({ id: `${hole.key}:${lo}:${hi}`, url: u, state: "loading", w: 0, h: 0 }); } })
      .catch(() => { if (!gone) setShot({ id: `${hole.key}:${lo}:${hi}`, url: null, state: "none", w: 0, h: 0 }); });
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [hole.key, lo, hi, n]);
  const [hov, setHov] = useState<number | null>(null);
  const [making, setMaking] = useState(false); const [err, setErr] = useState("");
  const sheet = async () => {
    setMaking(true); setErr("");
    try {
      const blob = await coreScan.sheetsPdf(hole.key, { intervals: [{ label: `${lo}–${hi} m`, from_m: lo, to_m: hi }], swir: true, tir: true, results: "auto", min_share: 0.05 });
      saveBlob(blob, `CoreFlagging_${safeName(hole.name)}_${lo}-${hi}m_sheet.pdf`);
    } catch (e) { setErr((e as Error).message || "The sheet could not be made."); }
    finally { setMaking(false); }
  };
  // every sample the same height: at least the old 420 px for the window, at least 3 px a sample (a 2.5 m window
  // of ~300 samples runs ~900 px and scrolls); the image's width follows the core's own width at that height
  const H = n ? Math.max(420, n * 3) : 420; const hp = n ? H / n : 0;
  const colW = img.w && img.h ? Math.max(56, Math.min(180, Math.round((H * img.w) / img.h))) : 120;
  const ticks = useMemo(() => sampleTicks(samples, hi - lo, hp ? Math.ceil(14 / hp) : 1), [samples, hi, lo, hp]);
  const breaks = useMemo(() => samples.flatMap((s, k) => k && (s.tray !== samples[k - 1].tray || s.section !== samples[k - 1].section) ? [{ k, label: s.tray !== samples[k - 1].tray ? `tray ${s.tray}` : `section ${s.section}` }] : []), [samples]);
  const hs: Sample | null = hov !== null ? samples[hov] ?? null : null;
  const status = (sq.error as { status?: number } | null)?.status;
  const col = (g: string | undefined, m: string | undefined) => (m ? groupColor(g) : "#e2e8f0");
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2 pb-1.5">
        <h4 className="font-display text-[14px] font-semibold text-slate-900">Every sample ({sq.data?.step_mm ? `${Math.round(sq.data.step_mm)} mm` : "~8 mm"}): the line scan, SWIR and TIR</h4>
        {n > 0 && <button type="button" onClick={sheet} disabled={making} className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 pointer-coarse:py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {making ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}{making ? "Making the sheet…" : "Sheet for this window (PDF)"}</button>}
      </div>
      {err && <p className="pb-2 text-[11px] text-red-600">{err}</p>}
      {sq.isError ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-500">{status === 404
          ? hole.source === "upload" ? "This scan's package is not kept on the platform, so it cannot be read sample by sample. Upload it again to see the line scan here." : "This hole has no package to read at sample level."
          : "The sample level is not available right now (the service may be unpacking the package; try again in a moment)."}</p>
      ) : !n ? <p className="text-[11px] text-slate-500">{sq.isPending ? "Reading the samples…" : "No samples in this window."}</p> : (
        <div className="flex flex-col gap-3 @md:flex-row">
          {/* the reading: above the strip on a narrow panel (so a tap reads without scrolling away), beside it on a wide one */}
          <div className="text-xs text-slate-700 @md:order-2 @md:min-w-0 @md:flex-1">
            <div className="rounded-lg border border-slate-200 bg-white p-3 @md:sticky @md:top-0">
              {hs ? <SampleCard s={hs} /> : <p className="text-[11px] leading-relaxed text-slate-500">{n} samples in this window. Move over the strip (or tap it) to read one.</p>}
              <p className="mt-2 text-[10.5px] leading-relaxed text-slate-400">Each sample is the same height here, in the order it was scanned, so the photograph and the columns line up reading for reading; the depths on the left are the samples&rsquo; own, and jump where a tray or section breaks. The model does not read at this scale: this is the scanner&rsquo;s TSG reading and its photograph.</p>
            </div>
          </div>
          <div className="max-h-[70vh] flex-none overflow-y-auto overscroll-contain rounded-md @md:order-1">
            <div className="relative flex gap-1" style={{ height: H }} onMouseLeave={() => setHov(null)}
              onPointerMove={(e) => { const y = e.clientY - e.currentTarget.getBoundingClientRect().top; setHov(Math.max(0, Math.min(n - 1, Math.floor(y / hp)))); }}>
              <div className="relative w-12 flex-none font-mono text-[9px] text-slate-400">
                {ticks.map((t) => <span key={t.k} className="absolute right-1 -translate-y-1/2 whitespace-nowrap" style={{ top: t.k * hp }}>{t.d}</span>)}
              </div>
              <div className="relative flex-none overflow-hidden bg-slate-100" style={{ width: colW, height: H }}>
                {/* stretched to the columns' height on purpose: its rows are the samples, one block each */}
                {/* eslint-disable-next-line @next/next/no-img-element -- an object URL of a fetched strip, no optimising to do */}
                {img.url && <img src={img.url} alt={`Line scan, ${lo}–${hi} m`} onLoad={(e) => { const t = e.currentTarget; setImg((v) => ({ ...v, state: "ok", w: t.naturalWidth, h: t.naturalHeight })); }} onError={() => setImg((v) => ({ ...v, state: "none" }))} className="block h-full w-full object-fill" draggable={false} />}
                {img.state === "loading" && <div className="absolute inset-0 grid place-items-center text-[10px] text-slate-400">reading the line scan…</div>}
                {img.state === "none" && <div className="absolute inset-0 grid place-items-center px-2 text-center text-[10px] text-slate-400">no line scan for this window</div>}
              </div>
              {(["swir", "tir"] as const).map((side) => (
                <div key={side} className="relative w-6 flex-none bg-slate-50" title={side.toUpperCase()}>
                  {samples.map((s, k) => <div key={s.i} className="absolute inset-x-0" style={{ top: k * hp, height: Math.max(hp, 1), background: side === "swir" ? col(s.group, s.mineral) : col(s.tir_group, s.tir_mineral) }} />)}
                </div>))}
              {breaks.map((b) => <div key={b.k} className="pointer-events-none absolute left-12 right-0 border-t border-dashed border-slate-900/50" style={{ top: b.k * hp }} title={b.label} />)}
              {hov !== null && <>
                <div className="pointer-events-none absolute left-12 right-0 bg-cyan/25" style={{ top: hov * hp, height: Math.max(hp, 1) }} />
                <div className="pointer-events-none absolute left-10 right-0 border-t border-cyan" style={{ top: (hov + 0.5) * hp }} />
              </>}
            </div>
            <div className="sticky bottom-0 flex gap-1 bg-white pt-1 text-[9px] font-medium text-slate-500"><span className="w-12" /><span className="text-center" style={{ width: colW }}>line scan</span><span className="w-6 text-center">SWIR</span><span className="w-6 text-center">TIR</span></div>
          </div>
        </div>
      )}
    </section>
  );
}

/** What the scanner read at one sample. */
function SampleCard({ s }: { s: Sample }) {
  const side = (label: string, g: string | undefined, m: string | undefined, none: string) => (
    <div className="flex items-center gap-1.5"><span className="w-8 flex-none text-[10px] font-medium text-slate-500">{label}</span>
      <i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: m ? groupColor(g) : "#e2e8f0" }} />
      <span className="min-w-0 truncate">{m ? <>{mineralName(m)}{g ? <span className="text-slate-500"> · {groupName(g)}</span> : null}</> : <span className="text-slate-400">{none}</span>}</span></div>);
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono font-semibold text-slate-900">{s.depth.toFixed(3)} m</div>
      {side("SWIR", s.group, s.mineral, "no SWIR mineral read")}
      {side("TIR", s.tir_group, s.tir_mineral, s.tir_group === undefined ? "not in this reading" : "no TIR reading here")}
      <div className="text-[11px] text-slate-500">tray {s.tray}{s.section !== null ? `, section ${s.section}` : ""}, {s.x_mm.toFixed(0)} mm along{s.height_mm !== null ? ` · laser height ${s.height_mm.toFixed(1)} mm` : ""}{s.weight !== null ? ` · SWIR weight ${s.weight}` : ""}</div>
    </div>
  );
}

/** Depth labels for an index-laid strip: the first sample, then the first sample at or past each round depth,
 * labelled with its own depth; a label closer than `gap` samples to the last is left out (the dashed lines mark
 * the breaks). */
function sampleTicks(samples: Sample[], span: number, gap: number): { k: number; d: string }[] {
  const step = span <= 0.3 ? 0.05 : span <= 1.2 ? 0.1 : 0.25; const out: { k: number; d: string }[] = [];
  let next = -Infinity, last = -Infinity;
  samples.forEach((s, k) => {
    if (s.depth + 1e-6 < next) return;
    next = (Math.floor((s.depth + 1e-6) / step) + 1) * step;
    if (k - last >= gap) { out.push({ k, d: s.depth.toFixed(2) }); last = k; }
  });
  return out;
}

/** One photograph per tray the window touches: the first metre of the window on each tray (a tray holds ~3.5 m). */
function trayMetres(trays: Tray[], metres: number[]): number[] {
  const seen = new Set<number>(); const out: number[] = [];
  for (const m of metres) {
    const k = trays.findIndex((t) => t.from_m <= m + 0.5 && m + 0.5 <= t.to_m + 0.05);
    if (k < 0 || seen.has(k)) continue;
    seen.add(k); out.push(m);
  }
  return out;
}

/** "Chlorite 55%, Invalid 30%, Carbonate 8%": the leading groups of a 10 cm bin in the 0.1 m log, or null. */
function mixOf(log: SpectralLog | undefined, bin: number | null, side: "swir" | "tir", n = 3): string | null {
  if (!log || bin === null) return null;
  const sd = log.rows.find((r) => Math.round(r.from_m * 10) === bin)?.[side];
  if (!sd || !sd.n_result) return null;
  return Object.entries(sd.mix).sort((a, b) => b[1] - a[1]).slice(0, n).map(([g, v]) => `${groupName(g)} ${pct(v)}`).join(", ");
}

/** The 10 cm bins of a window as two rows (SWIR over TIR), to scale, with a depth rule. Each bin is the share of
 * every TSG group in it, stacked top to bottom in the order the log on the left uses; without a spectral log, the
 * bin's leading group. */
function BinStrip({ bins, from, to, pick, hover, onHover, onPick, onZoom, log, order }: {
  bins: { bin: number; from_m: number; n_swir: number; n_tir: number; gs: string; ms: string; gt: string }[]; from: number; to: number;
  pick: number | null; hover: number | null; onHover: (b: number | null) => void; onPick: (b: number) => void; onZoom: (b: number) => void;
  log?: SpectralLog; order: string[];
}) {
  const byBin = useMemo(() => new Map((log?.rows ?? []).map((r) => [Math.round(r.from_m * 10), r])), [log]);
  const stack = (mix: Record<string, number>) => [...order, ...Object.keys(mix).filter((k) => !order.includes(k))].filter((k) => mix[k] > 0)
    .map((k) => <span key={k} className="block w-full" style={{ height: `${mix[k] * 100}%`, background: groupColor(k) }} />);
  const span = to - from; const x = (d: number) => `${Math.max(0, Math.min(100, ((d - from) / span) * 100))}%`;
  const w = `${(0.1 / span) * 100}%`;
  const ticks: number[] = []; const stepM = span <= 1 ? 0.1 : span <= 3 ? 0.5 : 1;
  for (let d = Math.ceil(from / stepM) * stepM; d <= to + 1e-9; d += stepM) ticks.push(Math.round(d * 100) / 100);
  const row = (key: "gs" | "gt", label: string) => {
    const side = key === "gs" ? "swir" : "tir";
    return (
      <div className="flex items-center gap-2">
        <span className="w-8 flex-none text-[10px] font-medium text-slate-500">{label}</span>
        <div className="relative h-10 flex-1 overflow-hidden rounded bg-slate-100" onMouseLeave={() => onHover(null)}>
          {bins.map((b) => {
            const sd = byBin.get(b.bin)?.[side];
            const mixed = !!sd && sd.n_result > 0;
            const text = (mixed ? mixOf(log, b.bin, side) : null) ?? `${groupName(b[key])}${key === "gs" && b.ms ? ` · ${mineralName(b.ms)}` : ""}`;
            return (
              <button key={b.bin} type="button" title={`${b.from_m.toFixed(1)} m · ${text}`}
                onMouseEnter={() => onHover(b.bin)} onClick={() => onPick(b.bin)} onDoubleClick={() => onZoom(b.bin)}
                className={cn("absolute top-0 flex h-full flex-col overflow-hidden border-r border-white/70", (pick === b.bin || hover === b.bin) && "z-10 outline outline-2 -outline-offset-2 outline-cyan")}
                style={{ left: x(b.from_m), width: w, background: mixed ? undefined : key === "gt" && !b.n_tir ? "#e2e8f0" : groupColor(b[key]) }}>
                {mixed && stack(sd.mix)}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-1">
      {row("gs", "SWIR")}{row("gt", "TIR")}
      <div className="relative ml-10 h-4 font-mono text-[9px] text-slate-400">{ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: x(t) }}>{t}</span>)}</div>
      <p className="text-[10.5px] text-slate-400">Each bin is the share of every mineral group the scanner&rsquo;s TSG software reads in it, in the colours of the key below. Hover a bin for its spectra, click to keep it, double-click to zoom to it. Pale grey TIR = not measured.</p>
    </div>
  );
}


/** The Window tab before a window is chosen: what the scale ladder is for, and places to start from — the
 * metres that stand out and where the model disagrees with the log, each a window one click away. */
export function WindowStart({ hole, mv, onWindow, spectral, typeName }: { hole: HoleDetail; mv: ModelView | undefined; onWindow: (w: Window) => void; spectral?: SpectralLog; typeName: (k: number) => string }) {
  const d0 = hole.metres.m[0] ?? 0, d1 = (hole.metres.m[hole.metres.m.length - 1] ?? 0) + 1;
  const flags = [...(mv?.anomaly.runs ?? [])].sort((a, b) => b.raw - a.raw).slice(0, 6);
  const again = (mv?.summary.again?.intervals ?? []).slice(0, 6);
  const levels = [{ label: "10 m", span: 10 }, { label: "1 m", span: 1 }, { label: "10 cm", span: 0.1 }];
  return (
    <div className="flex flex-col gap-5">
      <section>
        <H4>Read the hole at any scale</H4>
        <p className="text-xs leading-relaxed text-slate-600">The log on the left is the whole hole. Zoom with the wheel or double-click a depth, pick a level above it, or drag the box in the narrow column beside it. Each level shows what there is at that scale: where the model disagrees with the log, the metres that stand out and the photographs over 10 m; at 1 m, everything about the metre (the model&rsquo;s reading, the photograph, the spectra against the core around it) and its 10 cm bins; at 10 cm, the bins and their spectra.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{levels.map((l) => <button key={l.label} type="button" onClick={() => onWindow(windowAt(l.label === "10 m" ? "10m" : l.label === "1 m" ? "1m" : "10cm", (d0 + d1) / 2, d0, d1) as Window)} className="rounded-full bg-slate-900 px-3 py-1 pointer-coarse:py-2 text-[11px] font-medium text-white hover:bg-slate-700">Open {l.label} at the middle</button>)}</div>
      </section>
      {flags.length > 0 && (
        <section>
          <H4>Start where the core stands out</H4>
          <ul className="flex flex-wrap gap-1.5">{flags.map((r) => (
            <li key={r.from_m}><button type="button" onClick={() => onWindow([r.from_m - 0.5, r.to_m + 0.5])} className="rounded-full border border-orange/50 bg-orange/10 px-2.5 py-1 font-mono text-[11px] text-slate-800 hover:border-orange">{r.from_m}–{r.to_m} m · {r.raw.toFixed(2)}</button></li>))}</ul>
        </section>)}
      {again.length > 0 && (
        <section>
          <H4>Or where the model disagrees with the log</H4>
          <ul className="flex flex-col gap-1 text-xs text-slate-700">{again.map((d) => (
            <li key={d.from_m}><button type="button" onClick={() => onWindow([d.from_m, d.to_m])} className="text-left hover:underline"><span className="font-mono">{d.from_m}–{d.to_m} m</span> · log: {d.logged || d.logged_class} · reads: {d.reads}</button></li>))}</ul>
        </section>)}
      <TenMetres hole={hole} mv={mv} spectral={spectral} from={d0} to={d1} typeName={typeName} onWindow={onWindow} />
    </div>
  );
}
