"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The key on a phone: one small bar over the map, opening a bottom sheet with the basemap and the key's
 * sections (the same ones the wide screen shows down the left edge). */
export function LegendSheet<B extends string>(p: {
  basemaps: { id: B; label: string }[]; basemap: B; onBasemap: (b: B) => void;
  /** the commonest colours on the map, for the bar */
  dots: string[]; label: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0); const start = useRef<number | null>(null);
  return (
    <>
      <button type="button" onClick={() => { setDrag(0); setOpen(true); }} aria-label="Map key and layers"
        className="absolute bottom-9 left-1/2 z-10 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/60 bg-white/90 py-2 pr-3 pl-3.5 shadow-glass backdrop-blur-xl">
        <span className="flex -space-x-1" aria-hidden>
          {p.dots.slice(0, 5).map((c) => <i key={c} className="inline-block size-3 rounded-full ring-2 ring-white" style={{ background: c }} />)}
        </span>
        <span className="truncate text-[13px] font-semibold text-slate-800">{p.label}</span>
        <Layers size={16} className="flex-none text-slate-500" />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-[80]" role="dialog" aria-modal aria-label="Map key and layers">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]" />
          <div className="absolute inset-x-0 bottom-0 max-h-[78vh] overflow-x-hidden overflow-y-auto rounded-t-3xl bg-white pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(15,23,42,0.25)] transition-transform"
            style={{ transform: `translateY(${drag}px)` }}
            onTouchStart={(e) => { start.current = e.touches[0].clientY; }}
            onTouchMove={(e) => { if (start.current !== null) setDrag(Math.max(0, e.touches[0].clientY - start.current)); }}
            onTouchEnd={() => { if (drag > 90) setOpen(false); else setDrag(0); start.current = null; }}>
            <div className="sticky top-0 z-20 bg-white px-5 pt-2.5 pb-2">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-300" aria-hidden />
              <div className="mt-2 flex items-center justify-between">
                <p className="font-display text-[17px] font-semibold text-slate-900">Map</p>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600"><X size={16} /></button>
              </div>
            </div>
            <div className="px-5 pt-1 pb-2">
              <p className="mb-2 text-xs font-semibold text-slate-500">Basemap</p>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                {p.basemaps.map((b) => <button key={b.id} type="button" onClick={() => p.onBasemap(b.id)} className={cn("rounded-lg py-2 text-[13px] font-semibold", p.basemap === b.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{b.label}</button>)}
              </div>
            </div>
            <div className="px-3">{p.children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
