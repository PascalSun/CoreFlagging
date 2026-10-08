"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { coreScan, type Tray } from "@/lib/coreScan";
import { marks } from "@/components/coretrace/TrayPhoto";
import { useCoreBands } from "@/components/coretrace/coreBands";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A tray photograph at its original resolution (about 11,000 px wide), zoomable to the grain.
 * While the tiles are cut on first view the browser-sized copy stands in; an upload, which keeps
 * no original, stays on the copy. The metre being read is boxed at every zoom. */
export function DeepZoom({ holeKey, tray, boxes, label, onClose, onStep }: {
  holeKey: string; tray: Tray; boxes: [number, number, number, number][]; label: string; onClose: () => void;
  /** previous / next tray; a side is missing at the ends of the hole */
  onStep?: { prev?: () => void; next?: () => void };
}) {
  // the browser-sized copy stands in while tiles load (shared with the thumbnails, so usually already here)
  const { data: preview } = useQuery({ queryKey: ["core-tray", holeKey, tray.id], queryFn: () => coreScan.trayImage(holeKey, tray.id), staleTime: Infinity, gcTime: 5 * 60_000 });
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<any>(null);
  const [state, setState] = useState<"loading" | "ready" | "copy">("loading");

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onStep?.prev?.();
      else if (e.key === "ArrowRight") onStep?.next?.();
    };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, [onClose, onStep]);

  useEffect(() => {
    let gone = false;
    (async () => {
      let info;
      try { info = await coreScan.trayZoom(holeKey, tray.id); } catch { if (!gone) setState("copy"); return; }
      const OSD = (await import("openseadragon")).default as any;
      if (gone || !host.current) return;
      const v = OSD({
        element: host.current, showNavigationControl: false, showNavigator: true, navigatorPosition: "BOTTOM_RIGHT", navigatorBackground: "#000",
        maxZoomPixelRatio: 2, visibilityRatio: 1, constrainDuringPan: true, animationTime: 0.6, gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true },
        tileSources: {
          width: info.width, height: info.height, tileSize: info.tile, tileOverlap: info.overlap, minLevel: 8,
          getTileUrl: (level: number, x: number, y: number) => coreScan.trayZoomTile(holeKey, tray.id, level, x, y),
        },
      });
      viewer.current = v;
      v.addHandler("open", () => {
        if (gone) return;
        const r = info.height / info.width;                         // OpenSeadragon's viewport runs 0..1 across, 0..height/width down
        for (const [x0, y0, x1, y1] of boxes) {
          const el = document.createElement("div");
          el.style.cssText = "border:3px solid #00c4f5;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none";
          v.addOverlay({ element: el, location: new OSD.Rect(x0, y0 * r, x1 - x0, (y1 - y0) * r) });
        }
        if (boxes.length) {
          const [x0, y0] = boxes[0], [, , x1, y1] = boxes[boxes.length - 1];
          v.viewport.fitBounds(new OSD.Rect(Math.max(0, Math.min(x0, boxes[1]?.[0] ?? x0) - 0.05), Math.max(0, y0 * r - 0.05), Math.min(1, x1 - Math.min(x0, boxes[1]?.[0] ?? x0) + 0.1), (y1 - y0) * r + 0.1), true);
        }
      });
      v.addHandler("tile-loaded", () => { if (!gone) setState("ready"); });
      v.addHandler("open-failed", () => { if (!gone) setState("copy"); });
    })();
    return () => { gone = true; viewer.current?.destroy(); viewer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeKey, tray.id]);

  const zoomBy = (k: number) => { const v = viewer.current; if (v) { v.viewport.zoomBy(k); v.viewport.applyConstraints(); } };
  const btn = "grid size-9 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20";
  // portalled to <body>: the hole panel's backdrop blur makes it the containing block for anything
  // fixed inside it, which would confine the viewer to the panel
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black" role="dialog" aria-modal aria-label={label}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{label}</p>
          <p className="text-xs text-white/60">{state === "copy" ? "This scan keeps no full-resolution photograph; showing the browser copy." : state === "loading" ? "Opening the full-resolution photograph. The first view of a tray takes a few seconds." : "Full resolution. Scroll or pinch to zoom, drag to move, double-click to zoom in."}</p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {state !== "copy" && <>
            <button type="button" className={btn} onClick={() => zoomBy(1.6)} aria-label="Zoom in"><Plus size={16} /></button>
            <button type="button" className={btn} onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out"><Minus size={16} /></button>
            <button type="button" className={btn} onClick={() => viewer.current?.viewport.goHome()} aria-label="Whole tray"><RotateCcw size={15} /></button>
          </>}
          {onStep && <>
            <span className="mx-1 h-6 w-px bg-white/20" aria-hidden />
            <button type="button" className={`${btn} disabled:opacity-30`} disabled={!onStep.prev} onClick={onStep.prev} aria-label="Previous tray" title="Previous tray (←)"><ChevronLeft size={18} /></button>
            <button type="button" className={`${btn} disabled:opacity-30`} disabled={!onStep.next} onClick={onStep.next} aria-label="Next tray" title="Next tray (→)"><ChevronRight size={18} /></button>
            <span className="mx-1 h-6 w-px bg-white/20" aria-hidden />
          </>}
          <button type="button" className={btn} onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {state !== "ready" && preview && (
          <div className="absolute inset-0 grid place-items-center p-4">
            <div className="relative w-full max-w-[1800px]" style={{ aspectRatio: `${tray.width || 1800} / ${tray.height || 672}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="" className="absolute inset-0 h-full w-full object-fill" />
              {boxes.map(([x0, y0, x1, y1], i) => <div key={i} className="absolute border-[3px] border-cyan" style={{ left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` }} />)}
              {state === "loading" && <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-xs text-white"><Loader2 size={13} className="animate-spin" />Loading full resolution</span>}
            </div>
          </div>
        )}
        <div ref={host} className={state === "ready" ? "absolute inset-0" : "pointer-events-none absolute inset-0 opacity-0"} />
        {onStep?.prev && <button type="button" onClick={onStep.prev} aria-label="Previous tray" className="absolute left-3 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/25 hover:bg-black/80"><ChevronLeft size={26} /></button>}
        {onStep?.next && <button type="button" onClick={onStep.next} aria-label="Next tray" className="absolute right-3 top-1/2 z-10 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/25 hover:bg-black/80"><ChevronRight size={26} /></button>}
      </div>
    </div>,
    document.body,
  );
}

/** The full-screen viewer over a hole's trays, starting at `start`, stepping tray by tray. The metre being
 * read is boxed on the tray that holds it. */
export function TrayViewer({ holeKey, trays, start, metre, onClose }: { holeKey: string; trays: Tray[]; start: number; metre: number | null; onClose: () => void }) {
  const [k, setK] = useState(start);
  const { data: src } = useQuery({ queryKey: ["core-tray", holeKey, trays[k]?.id], queryFn: () => coreScan.trayImage(holeKey, trays[k].id), enabled: !!trays[k], staleTime: Infinity, gcTime: 5 * 60_000 });
  const t = useCoreBands(trays[k] ?? null, src);
  if (!t) return null;
  const boxes = metre !== null ? marks(t, metre) : [];
  const label = `Tray ${t.n} of ${trays.length}, ${t.from_m.toFixed(1)}–${t.to_m.toFixed(1)} m${boxes.length ? ` · ${metre}–${(metre as number) + 1} m boxed` : ""}`;
  const step = { prev: k > 0 ? () => setK(k - 1) : undefined, next: k < trays.length - 1 ? () => setK(k + 1) : undefined };
  return <DeepZoom key={t.id} holeKey={holeKey} tray={t} boxes={boxes} label={label} onClose={onClose} onStep={step} />;
}
