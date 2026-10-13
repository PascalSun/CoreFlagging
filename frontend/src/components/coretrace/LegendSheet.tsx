"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, X } from "lucide-react";
import { Mark, type Shape } from "@/components/coretrace/shapes";
import { cn } from "@/lib/utils";

type Entry = { color: string; n: number; ring?: string; wait?: boolean; glyph?: string };
type ShapeEntry = { shape: Shape; n: number };

/** The legend on a phone: one small bar over the map, opening a bottom sheet with the basemap, what colour and
 * shape mean (as chips) and the key, where a tap on a row shows only those holes. */
export function LegendSheet<C extends string, S extends string, B extends string>(p: {
  modes: { id: C; label: string }[]; mode: C; onMode: (m: C) => void;
  shapeModes: { id: S; short: string }[]; shapeMode: S; onShapeMode: (m: S) => void;
  basemaps: { id: B; label: string }[]; basemap: B; onBasemap: (b: B) => void;
  legend: [string, Entry][]; shapes: [string, ShapeEntry][]; focus: string | null; onFocus: (f: string | null) => void;
  /** context layers that can be shown under the holes */
  overlays?: { id: string; label: string; color: string; on: boolean }[]; onOverlay?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0); const start = useRef<number | null>(null);
  const shown = p.legend.filter(([, e]) => !e.wait); const waiting = p.legend.find(([, e]) => e.wait)?.[1].n ?? 0;
  const modeLabel = p.modes.find((m) => m.id === p.mode)?.label ?? "";
  const shapeLabel = p.shapeModes.find((m) => m.id === p.shapeMode)?.short ?? "";
  const chip = (on: boolean) => cn("rounded-full px-3 py-1.5 text-[13px] font-medium ring-1 transition-colors", on ? "bg-ink text-white ring-ink" : "bg-white text-slate-700 ring-slate-200 active:bg-slate-50");
  const row = (label: string, mark: React.ReactNode, n: number) => {
    const on = p.focus === label, off = p.focus !== null && !on;
    return (
      <button key={label} type="button" onClick={() => p.onFocus(on ? null : label)} aria-pressed={on}
        className={cn("flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]", on ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700", off && "opacity-40")}>
        {mark}<span className="min-w-0 flex-1 truncate">{label}</span><span className="font-mono text-[11px] text-slate-400">{n.toLocaleString()}</span>
      </button>
    );
  };
  return (
    <>
      <button type="button" onClick={() => { setDrag(0); setOpen(true); }} aria-label="Map key and layers"
        className="absolute bottom-9 left-1/2 z-10 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/60 bg-white/90 py-2 pr-3 pl-3.5 shadow-glass backdrop-blur-xl">
        <span className="flex -space-x-1" aria-hidden>
          {shown.slice(0, 5).map(([l, e]) => <i key={l} className="inline-block size-3 rounded-full ring-2 ring-white" style={{ background: e.ring ? "#fff" : e.color, boxShadow: e.ring ? `inset 0 0 0 1.5px ${e.ring}` : undefined }} />)}
        </span>
        <span className="truncate text-[13px] font-semibold text-slate-800">{p.focus ?? modeLabel}{p.focus ? "" : <span className="font-normal text-slate-500"> · {shapeLabel}</span>}</span>
        <Layers size={16} className="flex-none text-slate-500" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal aria-label="Map key and layers">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]" />
          <div className="absolute inset-x-0 bottom-0 max-h-[78vh] overflow-y-auto rounded-t-3xl bg-white pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(15,23,42,0.25)] transition-transform"
            style={{ transform: `translateY(${drag}px)` }}
            onTouchStart={(e) => { start.current = e.touches[0].clientY; }}
            onTouchMove={(e) => { if (start.current !== null) setDrag(Math.max(0, e.touches[0].clientY - start.current)); }}
            onTouchEnd={() => { if (drag > 90) setOpen(false); else setDrag(0); start.current = null; }}>
            <div className="sticky top-0 z-10 bg-white px-5 pt-2.5 pb-2">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-300" aria-hidden />
              <div className="mt-2 flex items-center justify-between">
                <p className="font-display text-[17px] font-semibold text-slate-900">Map</p>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600"><X size={16} /></button>
              </div>
            </div>
            <div className="flex flex-col gap-5 px-5 pt-1">
              <section>
                <p className="mb-2 text-xs font-semibold text-slate-500">Basemap</p>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                  {p.basemaps.map((b) => <button key={b.id} type="button" onClick={() => p.onBasemap(b.id)} className={cn("rounded-lg py-2 text-[13px] font-semibold", p.basemap === b.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{b.label}</button>)}
                </div>
              </section>
              <section>
                <p className="mb-2 text-xs font-semibold text-slate-500">Colour the holes by</p>
                <div className="flex flex-wrap gap-1.5">{p.modes.map((m) => <button key={m.id} type="button" onClick={() => { p.onMode(m.id); p.onFocus(null); }} className={chip(p.mode === m.id)}>{m.label}</button>)}</div>
                <div className="mt-2.5 grid grid-cols-2 gap-x-1">{shown.map(([l, e]) => row(l, <Mark color={e.color} ring={e.ring} glyph={e.glyph} size={12} />, e.n))}</div>
              </section>
              <section>
                <p className="mb-2 text-xs font-semibold text-slate-500">Shape the holes by</p>
                <div className="flex flex-wrap gap-1.5">{p.shapeModes.map((m) => <button key={m.id} type="button" onClick={() => { p.onShapeMode(m.id); p.onFocus(null); }} className={chip(p.shapeMode === m.id)}>{m.short}</button>)}</div>
                {p.shapes.length > 0 && <div className="mt-2.5 grid grid-cols-2 gap-x-1">{p.shapes.map(([l, e]) => row(l, <Mark shape={e.shape} color="#64748b" size={12} />, e.n))}</div>}
              </section>
              {p.overlays && p.overlays.length > 0 && (
                <section>
                  <p className="mb-2 text-xs font-semibold text-slate-500">Also show</p>
                  <div className="flex flex-col gap-1">{p.overlays.map((o) => (
                    <label key={o.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-slate-700">
                      <input type="checkbox" checked={o.on} onChange={() => p.onOverlay?.(o.id)} className="size-4 accent-slate-900" />
                      <i className="inline-block size-3 rounded-full" style={{ background: o.color }} /><span className="min-w-0 flex-1 truncate">{o.label}</span><span className="text-[11px] text-slate-400">interim</span>
                    </label>))}</div>
                </section>
              )}
              <p className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>{p.focus ? `Showing only: ${p.focus}` : "Tap a row to show only those holes"}{waiting ? ` · ${waiting.toLocaleString()} still being processed` : ""}</span>
                {p.focus && <button type="button" onClick={() => p.onFocus(null)} className="font-semibold text-slate-900">Show all</button>}
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
