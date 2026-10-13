"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { coreScan, type Tray } from "@/lib/coreScan";
import { TrayViewer } from "@/components/coretrace/DeepZoom";
import { useCoreBands } from "@/components/coretrace/coreBands";

// Along a row, the photograph runs at a fixed scale in millimetres of scan: the row's recorded band spans
// (first + last sample position) mm, and the scan's 0 mm sits a little in from the band's start (25-38 mm across
// the States' photographs, fitted by matching each sample's brightness to the photograph's).
const ZERO_MM = 32;

/** Where the metre starting at `m` lies on a tray photograph: one box per row of core it touches, as fractions of
 * the photograph. A depth is placed where the scan says it was read: its position along the scan (depth is linear
 * in it within a row), at the photograph's scale. Rows without recorded positions use a typical 4-1040 mm scan. */
export function marks(t: Tray, m: number, to: number = m + 1): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const r of t.rows) {
    if (!r.box || r.to_m <= r.from_m) continue;
    const a = Math.max(m, r.from_m), b = Math.min(to, r.to_m);
    if (b <= a) continue;
    const [bx0, y0, bx1, y1] = r.box, [xa, xb] = r.xmm ?? [4, 1040], perMm = (bx1 - bx0) / (xa + xb);
    const f = (d: number) => Math.min(1, Math.max(0, bx0 + (ZERO_MM + xa + ((d - r.from_m) / (r.to_m - r.from_m)) * (xb - xa)) * perMm));
    out.push([f(a), y0, f(b), y1]);
  }
  return out;
}

export function TrayPhoto({ holeKey, trays, metre, onMetre, range }: { holeKey: string; trays: Tray[]; metre: number; onMetre: (m: number) => void;
  /** box this depth range instead of the whole metre (a zoomed window) */
  range?: [number, number];
}) {
  const k = trays.findIndex((t) => t.from_m <= metre + 0.5 && metre + 0.5 <= t.to_m + 0.05);
  const raw = k >= 0 ? trays[k] : null;
  const img = useQuery({ queryKey: ["core-tray", holeKey, raw?.id], queryFn: () => coreScan.trayImage(holeKey, raw!.id), enabled: !!raw, staleTime: Infinity, gcTime: 5 * 60_000, placeholderData: keepPreviousData });
  const tray = useCoreBands(raw, img.isPlaceholderData ? undefined : img.data);
  const [zoomed, setZoomed] = useState(false);
  if (!trays.length) return <div className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">No tray photographs for this hole.</div>;
  if (!tray) return <div className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">No tray photograph covers {metre}–{metre + 1} m.</div>;
  const boxes = range ? marks(tray, range[0], range[1]) : marks(tray, metre);
  const marked = range ? `${range[0].toFixed(2)}–${range[1].toFixed(2)} m` : `${metre}–${metre + 1} m`;
  const go = (d: number) => { const t = trays[k + d]; if (t) onMetre(Math.max(0, Math.floor(t.from_m + 0.001))); };
  const frame = (cls: string) => (
    <div className={`relative overflow-hidden rounded-lg bg-slate-900 ${cls}`} style={{ aspectRatio: `${tray.width || 1800} / ${tray.height || 672}` }}>
      {img.data
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={img.data} alt={`Core tray ${tray.n}, ${tray.from_m.toFixed(1)} to ${tray.to_m.toFixed(1)} m`} className="absolute inset-0 h-full w-full object-fill" />
        : <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">{img.isError ? "Photograph not available" : "Loading photograph…"}</div>}
      {img.isPlaceholderData && <span className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white"><Loader2 size={12} className="animate-spin" />Loading tray {tray.n}</span>}
      {img.data && !img.isPlaceholderData && boxes.map(([x0, y0, x1, y1], i) => (
        <div key={i} className="pointer-events-none absolute border-2 border-cyan shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${Math.max((x1 - x0) * 100, 0.6)}%`, height: `${(y1 - y0) * 100}%` }} />
      ))}
    </div>
  );
  return (
    <div>
      <div className="flex items-center justify-between pb-1.5 text-xs">
        <span className="font-semibold text-slate-900">Tray {tray.n} <span className="font-normal text-slate-500">· {tray.from_m.toFixed(1)}–{tray.to_m.toFixed(1)} m</span></span>
        <span className="flex items-center gap-1">
          <button type="button" aria-label="Previous tray" disabled={k <= 0} onClick={() => go(-1)} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <button type="button" aria-label="Next tray" disabled={k >= trays.length - 1} onClick={() => go(1)} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ChevronRight size={14} /></button>
        </span>
      </div>
      <div className="relative">
        <button type="button" className="block w-full cursor-zoom-in" onClick={() => setZoomed(true)} aria-label="Enlarge the photograph">{frame("w-full")}</button>
        {k > 0 && <button type="button" onClick={() => go(-1)} aria-label="Previous tray" title="Previous tray" className="absolute left-2 top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white ring-1 ring-white/30 hover:bg-black/85"><ChevronLeft size={20} /></button>}
        {k < trays.length - 1 && <button type="button" onClick={() => go(1)} aria-label="Next tray" title="Next tray" className="absolute right-2 top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white ring-1 ring-white/30 hover:bg-black/85"><ChevronRight size={20} /></button>}
      </div>
      <p className="pt-1 text-[11px] text-slate-500">{boxes.length ? `The box marks ${marked}.` : "This metre's position on the tray is not recorded."} Click for full resolution.</p>
      {zoomed && <TrayViewer holeKey={holeKey} trays={trays} start={k} metre={metre} onClose={() => setZoomed(false)} />}
    </div>
  );
}
