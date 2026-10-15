"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { coreScan, type HoleDetail, type ModelView, type SpectralLog, type Tray } from "@/lib/coreScan";
import { LINE, SpectraChart } from "@/components/coretrace/SpectraChart";
import { TrayPhoto } from "@/components/coretrace/TrayPhoto";
import { coreTypeColor, fmt, groupColor, groupName, mineralName, pct } from "@/components/coretrace/palette";
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
  const sq = useQuery({ queryKey: ["core-bin", hole.key, shownBin], queryFn: () => coreScan.bin(hole.key, shownBin as number), enabled: shownBin !== null, staleTime: 10 * 60_000 });
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
          <button type="button" onClick={() => step(-1)} aria-label="Up the hole" className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronLeft size={13} className="rotate-90" /></button>
          <button type="button" onClick={() => step(1)} aria-label="Down the hole" className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight size={13} className="rotate-90" /></button>
          <button type="button" onClick={() => onWindow([round1(Math.max(d0, from - span / 2)), round1(Math.min(d1, to + span / 2))])} title="Zoom out" className="grid h-6 w-6 place-items-center rounded border border-slate-200 text-slate-600 hover:bg-slate-50"><Maximize2 size={12} /></button>
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
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(typeName(mv.core[j])) }} /><span className="truncate">{typeName(mv.core[j])}</span></div>
                  <div className="text-[11px] text-slate-500">unusual {pct(mv.anom[j])} · gold {fmt(mv.gold[j])}</div>
                </button>); })}</div>
              <p className="pt-1 text-[10.5px] text-slate-400">The model reads the core by the metre; below that, what you see is the scanner&rsquo;s own reading and the photograph.</p>
            </section>
          )}
          {level === "1m" && metreDetail}
          <section>
            <H4>Every 10 cm: what the scanner read</H4>
            {bq.data ? (
              <BinStrip bins={bq.data.bins} from={from} to={to} pick={pick} hover={hover} onHover={setHover} onPick={(b) => setPick(pick === b ? null : b)} onZoom={(b) => onWindow([b / 10, b / 10 + MIN_SPAN])} log={spectralFine} order={order} />
            ) : <p className="text-xs text-slate-500">{bq.isPending ? "Reading the bins…" : "No bins in this window."}</p>}
            {shownBin !== null && sq.data && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs"><b className="font-semibold text-slate-900">{sq.data.from_m.toFixed(1)}–{(sq.data.from_m + 0.1).toFixed(1)} m</b>
                  <span>SWIR <b className="font-medium">{mixOf(spectralFine, shownBin, "swir") ?? groupName(sq.data.gs)}</b>{sq.data.ms ? ` · ${mineralName(sq.data.ms)}` : ""}</span><span>TIR <b className="font-medium">{mixOf(spectralFine, shownBin, "tir") ?? groupName(sq.data.gt)}</b></span>
                  <span className="text-slate-500">{sq.data.n_swir} samples{sq.data.n_tir ? `, ${sq.data.n_tir} with TIR` : ", no TIR"}</span>
                  {hover !== null && pick !== hover && <span className="text-slate-400">· hovering; click a bin to keep it</span>}</div>
                <SpectraChart title="SWIR, this 10 cm" unit="nm" xTicks={[500, 1000, 1500, 2000, 2500]} xFmt={nm} height={140} lines={[{ name: "this bin", color: LINE.measured, x: sq.data.swir_wl, y: sq.data.swir }]} />
                {sq.data.tir && <SpectraChart title="TIR, this 10 cm" unit="µm" xTicks={[7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000]} xFmt={um} height={140} lines={[{ name: "this bin", color: LINE.measured, x: sq.data.tir_wl, y: sq.data.tir }]} />}
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
      <table className="w-full border-collapse">
        <thead><tr>{["Depth (m)", "SWIR", "TIR", "Rock Classification"].map((h) => <th key={h} className={th10}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.k} onClick={() => onWindow([r.k, r.k + 10])} className="cursor-pointer hover:bg-slate-50" title={`Open ${r.k}–${r.k + 10} m`}>
            <td className={cn(td10, "font-mono whitespace-nowrap")}>{r.k}–{r.k + 10}{r.n < 10 ? <span className="ml-1 font-sans text-[10px] text-slate-400">({r.n} m of core)</span> : null}</td>
            <td className={td10}>{sw(r.sw, groupColor)}</td>
            <td className={td10}>{sw(r.tr, groupColor)}</td>
            <td className={td10}>{sw(r.rc, (c) => coreTypeColor(typeName(Number(c))))}</td>
          </tr>))}</tbody>
      </table>
      <p className="pt-1 text-[10.5px] text-slate-400">SWIR and TIR: the share of each mineral group the scanner&rsquo;s TSG software reads, over the 10 m. Rock Classification: the class HyFormer reads in most of its metres, and in what share of them.</p>
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
      <TenMetres hole={hole} mv={mv} spectral={spectral} from={d0} to={d1} typeName={typeName} onWindow={onWindow} />
    </div>
  );
}
