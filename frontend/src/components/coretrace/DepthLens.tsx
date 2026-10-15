"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { coreScan, type HoleDetail, type ModelView, type Sample, type Tray } from "@/lib/coreScan";
import { LINE, SpectraChart } from "@/components/coretrace/SpectraChart";
import { TrayPhoto } from "@/components/coretrace/TrayPhoto";
import { coreTypeColor, fmt, groupColor, groupName, mineralName, pct } from "@/components/coretrace/palette";
import { useState as useStateReact } from "react";
import { cn } from "@/lib/utils";

import { LEVELS, MIN_SPAN, fmtSpan, fmtWindow, levelOf, windowAt, type Window } from "@/lib/depth";
export { LEVELS, MIN_SPAN, levelOf, type Window };

const H4 = ({ children }: { children: React.ReactNode }) => <h4 className="pb-1.5 font-display text-[14px] font-semibold text-slate-900">{children}</h4>;
const th = "border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-medium text-slate-500";
const td = "border-b border-slate-100 px-2 py-1.5 align-top text-xs text-slate-700";

/** One window of a hole, read at the level its length calls for: a long window lists what the model found in
 * it; a metre or two shows the 10 cm bins with their spectra and the photographs; the finest shows one bin.
 * The model's reading never goes below the metre it was made at. */
export function DepthLens({ hole, mv, win, onWindow, trays, metre, onMetre, typeName }: {
  hole: HoleDetail; mv: ModelView | undefined; win: Window; onWindow: (w: Window | null) => void; trays: Tray[];
  metre: number | null; onMetre: (m: number) => void; typeName: (k: number) => string;
}) {
  const [from, to] = win; const span = to - from; const level = levelOf(win);
  const d0 = hole.metres.m[0] ?? 0, d1 = (hole.metres.m[hole.metres.m.length - 1] ?? 0) + 1;
  const bq = useQuery({ queryKey: ["core-bins", hole.key, Math.round(from * 10), Math.round(to * 10)], queryFn: () => coreScan.bins(hole.key, from, to), enabled: span <= 50, staleTime: 10 * 60_000 });
  const [pick, setPick] = useState<number | null>(null); const [hover, setHover] = useState<number | null>(null);
  const shownBin = hover ?? pick;
  const sq = useQuery({ queryKey: ["core-bin", hole.key, shownBin], queryFn: () => coreScan.bin(hole.key, shownBin as number), enabled: shownBin !== null, staleTime: 10 * 60_000 });
  const step = (dir: -1 | 1) => { const d = span * 0.5 * dir; const a = Math.max(d0, Math.min(d1 - span, from + d)); onWindow([round1(a), round1(a + span)]); };
  const metres = useMemo(() => { const out: number[] = []; for (let m = Math.floor(from); m < to; m++) if (hole.metres.m.includes(m)) out.push(m); return out; }, [from, to, hole.metres.m]);
  const midx = useMemo(() => new Map((mv?.m ?? []).map((m, i) => [m, i])), [mv]);
  const inWin = (a: number, b: number) => b > from && a < to;
  const segs = (mv?.segments ?? []).filter((s) => inWin(s.from_m, s.to_m));
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
          <button type="button" onClick={() => step(-1)} aria-label="Up the hole" className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronLeft size={13} className="rotate-90" /></button>
          <button type="button" onClick={() => step(1)} aria-label="Down the hole" className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight size={13} className="rotate-90" /></button>
          <button type="button" onClick={() => onWindow([round1(Math.max(d0, from - span / 2)), round1(Math.min(d1, to + span / 2))])} title="Zoom out" className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><Maximize2 size={12} /></button>
        </div>
      </div>

      {level === "hole" || level === "10m" ? (
        <>
          {again.length > 0 && (
            <section>
              <H4>Where the model disagrees with the log, in this window</H4>
              <ul className="flex flex-col gap-1 text-xs text-slate-700">{again.map((d) => (
                <li key={d.from_m}><button type="button" onClick={() => onWindow([d.from_m, d.to_m])} className="text-left hover:underline"><span className="font-mono">{d.from_m}–{d.to_m} m</span> · log: {d.logged || d.logged_class} · reads: {d.reads}</button></li>))}</ul>
            </section>
          )}
          <section>
            <H4>The model&rsquo;s auto log in this window</H4>
            {segs.length ? (
              <table className="w-full border-collapse">
                <thead><tr>{["From–to (m)", "Core type", "SWIR minerals"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{segs.map((s) => (
                  <tr key={s.seg} onClick={() => onWindow([round1(Math.max(from, s.from_m)), round1(Math.min(to, s.to_m))])} className="cursor-pointer hover:bg-slate-50">
                    <td className={cn(td, "font-mono whitespace-nowrap")}>{s.from_m.toFixed(1)}–{s.to_m.toFixed(1)}</td>
                    <td className={td}><span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(s.core_type_name) }} />{s.core_type_name}</span></td>
                    <td className={td}>{s.swir_minerals.slice(0, 3).map(([c, , p]) => `${mineralName(c)} ${pct(p)}`).join(", ") || "—"}</td></tr>))}</tbody>
              </table>) : <p className="text-xs text-slate-500">No model reading in this window.</p>}
          </section>
          {flags.length > 0 && (
            <section>
              <H4>Metres that stand out, in this window</H4>
              <ul className="flex flex-wrap gap-1.5">{flags.map((r) => (
                <li key={r.from_m}><button type="button" onClick={() => onWindow([r.from_m - 0.5, r.to_m + 0.5])} className="rounded-full border border-orange/50 bg-orange/10 px-2 py-0.5 font-mono text-[11px] text-slate-800 hover:border-orange">{r.from_m}–{r.to_m} m · {r.raw.toFixed(2)}</button></li>))}</ul>
            </section>
          )}
          {metres.length <= 12 && trayMetres(trays, metres).map((m) => <TrayPhoto key={m} holeKey={hole.key} trays={trays} metre={m} onMetre={onMetre} />)}
          {metres.length > 12 && <p className="text-[11px] text-slate-500">Zoom to 10 m or closer to see the photographs of each metre.</p>}
        </>
      ) : (
        <>
          {/* the metre level: the model's reading of each metre in the window, then the 10 cm bins */}
          {mv && metres.length > 0 && (
            <section>
              <H4>HyFormer reads, per metre</H4>
              <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-3">{metres.map((m) => { const j = midx.get(m); if (j === undefined) return null; return (
                <button key={m} type="button" onClick={() => onMetre(m)} className={cn("rounded-lg border bg-white px-3 py-2 text-left hover:border-slate-400", metre === m ? "border-cyan" : "border-slate-200")}>
                  <div className="text-[11px] text-slate-500">{m}–{m + 1} m</div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(typeName(mv.core[j])) }} /><span className="truncate">{typeName(mv.core[j])}</span></div>
                  <div className="text-[11px] text-slate-500">unusual {pct(mv.anom[j])} · gold {fmt(mv.gold[j])}</div>
                </button>); })}</div>
              <p className="pt-1 text-[10.5px] text-slate-400">The model reads the core by the metre; below that, what you see is the scanner&rsquo;s own reading and the photograph.</p>
            </section>
          )}
          {hole.source === "nvcl" && span <= 2.5 && <SampleLevel hole={hole} from={from} to={to} />}
          <section>
            <H4>Every 10 cm: what the scanner read</H4>
            {bq.data ? (
              <BinStrip bins={bq.data.bins} from={from} to={to} pick={pick} hover={hover} onHover={setHover} onPick={(b) => setPick(pick === b ? null : b)} onZoom={(b) => onWindow([b / 10, b / 10 + MIN_SPAN])} />
            ) : <p className="text-xs text-slate-500">{bq.isPending ? "Reading the bins…" : "No bins in this window."}</p>}
            {shownBin !== null && sq.data && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs"><b className="font-semibold text-slate-900">{sq.data.from_m.toFixed(1)}–{(sq.data.from_m + 0.1).toFixed(1)} m</b>
                  <span>SWIR <b className="font-medium">{groupName(sq.data.gs)}</b>{sq.data.ms ? ` · ${mineralName(sq.data.ms)}` : ""}</span><span>TIR <b className="font-medium">{groupName(sq.data.gt)}</b></span>
                  <span className="text-slate-500">{sq.data.n_swir} samples{sq.data.n_tir ? `, ${sq.data.n_tir} with TIR` : ", no TIR"}</span>
                  {hover !== null && pick !== hover && <span className="text-slate-400">· hovering; click a bin to keep it</span>}</div>
                <SpectraChart title="SWIR, this 10 cm" unit="nm" xTicks={[500, 1000, 1500, 2000, 2500]} xFmt={nm} height={140} lines={[{ name: "this bin", color: LINE.measured, x: sq.data.swir_wl, y: sq.data.swir }]} />
                {sq.data.tir && <SpectraChart title="TIR, this 10 cm" unit="µm" xTicks={[7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000]} xFmt={um} height={140} lines={[{ name: "this bin", color: LINE.measured, x: sq.data.tir_wl, y: sq.data.tir }]} />}
              </div>
            )}
          </section>
          {trayMetres(trays, metres).map((m) => <TrayPhoto key={m} holeKey={hole.key} trays={trays} metre={m} onMetre={onMetre} range={span <= 2.5 ? [Math.max(from, m), Math.min(to, m + 4)] : undefined} />)}
        </>
      )}
    </div>
  );
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The finest level: the line-scan photograph of the window at full resolution beside every ~8 mm sample's
 * TSG mineral, both from the mirrored package through the service (the first look at a hole unpacks it:
 * a few seconds). Hover a sample for its depth and mineral. */
function SampleLevel({ hole, from, to }: { hole: HoleDetail; from: number; to: number }) {
  const lo = Math.floor(from * 100) / 100, hi = Math.ceil(to * 100) / 100;
  const sq = useQuery({ queryKey: ["core-samples", hole.key, lo, hi], queryFn: () => coreScan.samples(hole.key, lo, hi), staleTime: 60 * 60_000, retry: false });
  const [imgState, setImgState] = useStateReact<"loading" | "ok" | "none">("loading");
  const [hov, setHov] = useStateReact<Sample | null>(null);
  const url = coreScan.linescanUrl(hole.key, lo, hi, 420);
  const samples = sq.data?.samples ?? [];
  const span = hi - lo; const y = (d: number) => `${Math.max(0, Math.min(100, ((d - lo) / span) * 100))}%`;
  return (
    <section>
      <H4>Every sample ({sq.data?.step_mm ? `${Math.round(sq.data.step_mm)} mm` : "~8 mm"}): the line scan and the scanner&rsquo;s mineral</H4>
      {sq.isError && <p className="text-[11px] text-slate-500">{(sq.error as { status?: number }).status === 404 ? "This hole has no package to read at sample level." : "The sample level is not available right now (the service may be unpacking the package; try again in a moment)."}</p>}
      <div className="flex gap-3">
        {/* the line scan runs top to bottom at the window's scale; the mineral ticks sit beside it at the same scale */}
        <div className="relative w-[120px] flex-none overflow-hidden rounded-md bg-slate-100" style={{ height: 420 }}>
          {imgState !== "none" && <img src={url} alt={`Line scan, ${lo}–${hi} m`} onLoad={() => setImgState("ok")} onError={() => setImgState("none")} className="h-full w-full object-fill" />}
          {imgState === "loading" && <div className="absolute inset-0 grid place-items-center text-[10px] text-slate-400">reading the line scan…</div>}
          {imgState === "none" && <div className="absolute inset-0 grid place-items-center px-2 text-center text-[10px] text-slate-400">no line scan for this window yet</div>}
          {hov && <div className="pointer-events-none absolute inset-x-0 border-t border-cyan" style={{ top: y(hov.depth) }} />}
        </div>
        <div className="relative w-7 flex-none rounded bg-slate-50" style={{ height: 420 }} onMouseLeave={() => setHov(null)}>
          {samples.map((s, i) => { const next = samples[i + 1]?.depth ?? s.depth + (sq.data?.step_mm ?? 8) / 1000; return (
            <div key={s.i} onMouseEnter={() => setHov(s)} title={`${s.depth.toFixed(3)} m · ${mineralName(s.mineral) || "no mineral read"}`}
              className="absolute inset-x-0" style={{ top: y(s.depth), height: `${Math.max(0.2, ((next - s.depth) / span) * 100)}%`, background: s.mineral ? groupColor(s.group) : "#e2e8f0" }} />); })}
        </div>
        <div className="min-w-0 flex-1 text-xs text-slate-700">
          {hov ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="font-semibold text-slate-900">{hov.depth.toFixed(3)} m</div>
              <div>{mineralName(hov.mineral) || "No SWIR mineral read"}{hov.group ? <span className="text-slate-500"> · {groupName(hov.group)}</span> : null}{hov.weight !== null ? <span className="text-slate-500"> · weight {hov.weight}</span> : null}</div>
              <div className="text-[11px] text-slate-500">tray {hov.tray}{hov.section !== null ? `, section ${hov.section}` : ""}, {hov.x_mm.toFixed(0)} mm along{hov.height_mm !== null ? ` · surface ${hov.height_mm.toFixed(1)} mm` : ""}</div>
            </div>
          ) : <p className="text-[11px] leading-relaxed text-slate-500">{samples.length ? `${samples.length} samples in this window. Move over the colour strip to read one.` : sq.isPending ? "Reading the samples…" : ""}</p>}
          <p className="mt-2 text-[10.5px] leading-relaxed text-slate-400">The model does not read at this scale; what you see here is the scanner&rsquo;s own mineral per sample and its photograph, from the TSG package.</p>
        </div>
      </div>
    </section>
  );
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

/** The 10 cm bins of a window as two coloured rows (SWIR group over TIR group), to scale, with a depth rule. */
function BinStrip({ bins, from, to, pick, hover, onHover, onPick, onZoom }: {
  bins: { bin: number; from_m: number; n_swir: number; n_tir: number; gs: string; ms: string; gt: string }[]; from: number; to: number;
  pick: number | null; hover: number | null; onHover: (b: number | null) => void; onPick: (b: number) => void; onZoom: (b: number) => void;
}) {
  const span = to - from; const x = (d: number) => `${Math.max(0, Math.min(100, ((d - from) / span) * 100))}%`;
  const w = `${(0.1 / span) * 100}%`;
  const ticks: number[] = []; const stepM = span <= 1 ? 0.1 : span <= 3 ? 0.5 : 1;
  for (let d = Math.ceil(from / stepM) * stepM; d <= to + 1e-9; d += stepM) ticks.push(Math.round(d * 100) / 100);
  const row = (key: "gs" | "gt", label: string) => (
    <div className="flex items-center gap-2">
      <span className="w-8 flex-none text-[10px] font-medium text-slate-500">{label}</span>
      <div className="relative h-5 flex-1 rounded bg-slate-100" onMouseLeave={() => onHover(null)}>
        {bins.map((b) => (
          <button key={b.bin} type="button" title={`${b.from_m.toFixed(1)} m · ${groupName(b[key])}${key === "gs" && b.ms ? ` · ${mineralName(b.ms)}` : ""}`}
            onMouseEnter={() => onHover(b.bin)} onClick={() => onPick(b.bin)} onDoubleClick={() => onZoom(b.bin)}
            className={cn("absolute top-0 h-full border-r border-white/70", (pick === b.bin || hover === b.bin) && "ring-2 ring-cyan ring-inset z-10")}
            style={{ left: x(b.from_m), width: w, background: key === "gt" && !b.n_tir ? "#e2e8f0" : groupColor(b[key]) }} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      {row("gs", "SWIR")}{row("gt", "TIR")}
      <div className="relative ml-10 h-4 font-mono text-[9px] text-slate-400">{ticks.map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: x(t) }}>{t}</span>)}</div>
      <p className="text-[10.5px] text-slate-400">Hover a bin for its spectra, click to keep it, double-click to zoom to it. Grey TIR = not measured.</p>
    </div>
  );
}


/** The Window tab before a window is chosen: what the scale ladder is for, and places to start from — the
 * metres that stand out and where the model disagrees with the log, each a window one click away. */
export function WindowStart({ hole, mv, onWindow }: { hole: HoleDetail; mv: ModelView | undefined; onWindow: (w: Window) => void }) {
  const d0 = hole.metres.m[0] ?? 0, d1 = (hole.metres.m[hole.metres.m.length - 1] ?? 0) + 1;
  const flags = [...(mv?.anomaly.runs ?? [])].sort((a, b) => b.raw - a.raw).slice(0, 6);
  const again = (mv?.summary.again?.intervals ?? []).slice(0, 6);
  const levels = [{ label: "10 m", span: 10 }, { label: "1 m", span: 1 }, { label: "10 cm", span: 0.1 }];
  return (
    <div className="flex flex-col gap-5">
      <section>
        <H4>Read the hole at any scale</H4>
        <p className="text-xs leading-relaxed text-slate-600">The log on the left is the whole hole. Zoom with the wheel or double-click a depth, pick a level above it, or drag the box in the narrow column beside it. Each level shows what there is at that scale: the auto log and the photographs over 10 m, the 10 cm bins and their spectra over a metre, the line scan and every sample at 10 cm.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{levels.map((l) => <button key={l.label} type="button" onClick={() => onWindow(windowAt(l.label === "10 m" ? "10m" : l.label === "1 m" ? "1m" : "10cm", (d0 + d1) / 2, d0, d1) as Window)} className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-700">Open {l.label} at the middle</button>)}</div>
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
    </div>
  );
}
