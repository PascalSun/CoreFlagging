"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { coreScan, type HoleDetail, type ModelView, type Tray } from "@/lib/coreScan";
import { LINE, SpectraChart } from "@/components/coretrace/SpectraChart";
import { TrayPhoto } from "@/components/coretrace/TrayPhoto";
import { coreTypeColor, fmt, groupColor, groupName, mineralName, pct } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

export type Window = [number, number];

/** The levels the depth axis snaps to, by window length. */
export const LEVELS: { id: string; label: string; span: number | null }[] = [
  { id: "hole", label: "Whole hole", span: null }, { id: "10m", label: "10 m", span: 10 }, { id: "1m", label: "1 m", span: 1 }, { id: "10cm", label: "10 cm", span: 0.3 },
];
export const MIN_SPAN = 0.3;

/** Which level a window is at: the finest whose span it fits. */
export function levelOf(win: Window | null): string {
  if (!win) return "hole";
  const s = win[1] - win[0];
  return s <= 0.5 ? "10cm" : s <= 2.5 ? "1m" : s <= 25 ? "10m" : "hole";
}

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
        <nav className="flex items-center gap-1 text-slate-500" aria-label="Depth">
          <button type="button" onClick={() => onWindow(null)} className="font-medium text-slate-700 hover:underline">{hole.name}</button>
          <span>›</span>
          <span className="font-semibold text-slate-900">{fmt(from, span < 1 ? 2 : span < 10 ? 1 : 0)}–{fmt(to, span < 1 ? 2 : span < 10 ? 1 : 0)} m</span>
          <span className="text-slate-400">· {span >= 1 ? `${fmt(span, span < 10 ? 1 : 0)} m` : `${Math.round(span * 100)} cm`} window</span>
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
              <H4>Second Eye reads, per metre</H4>
              <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-3">{metres.map((m) => { const j = midx.get(m); if (j === undefined) return null; return (
                <button key={m} type="button" onClick={() => onMetre(m)} className={cn("rounded-lg border bg-white px-3 py-2 text-left hover:border-slate-400", metre === m ? "border-cyan" : "border-slate-200")}>
                  <div className="text-[11px] text-slate-500">{m}–{m + 1} m</div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(typeName(mv.core[j])) }} /><span className="truncate">{typeName(mv.core[j])}</span></div>
                  <div className="text-[11px] text-slate-500">unusual {pct(mv.anom[j])} · gold {fmt(mv.gold[j])}</div>
                </button>); })}</div>
              <p className="pt-1 text-[10.5px] text-slate-400">The model reads the core by the metre; below that, what you see is the scanner&rsquo;s own reading and the photograph.</p>
            </section>
          )}
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
