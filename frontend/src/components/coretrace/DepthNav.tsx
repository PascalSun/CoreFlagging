"use client";

import { useEffect, useRef } from "react";
import type { Metres, ModelView } from "@/lib/coreScan";
import { SERIES, coreTypePaint, groupColor } from "@/components/coretrace/palette";
import { MIN_SPAN, fmtWindow, windowAbout } from "@/lib/depth";

/** The whole hole in one narrow column beside the zoomed log, so a reader always knows where the window
 * is: the model's rock class (or the SWIR mineral group) down the hole, the flagged metres as orange ticks,
 * and the window as a box. Drag the box to move the window, drag its ends to resize it, click anywhere
 * else to put the window there. */
export function DepthNav({ metres, model, view, hole0, hole1, onRange, typeName, height }: {
  metres: Metres; model: ModelView | undefined; view: [number, number]; hole0: number; hole1: number;
  onRange: (r: [number, number] | null) => void; typeName: Map<number, string>; height: number;
}) {
  const W = 16, TICK = 5, PAD = 6;                       // the column, the flag ticks beside it, and room above and below
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ kind: "move" | "top" | "bottom"; y0: number; win: [number, number] } | null>(null);
  const H = Math.max(40, height - 2 * PAD), ppm = H / Math.max(1e-6, hole1 - hole0);
  const yOf = (d: number) => PAD + (d - hole0) * ppm, dOf = (y: number) => hole0 + (y - PAD) / ppm;
  const whole = view[0] <= hole0 + 1e-6 && view[1] >= hole1 - 1e-6;

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1, w = W + TICK + 2, h = H + 2 * PAD;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext("2d"); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.fillStyle = "#f1f5f9"; g.fillRect(0, PAD, W, H);
    const midx = new Map((model?.m ?? []).map((m, i) => [m, i]));
    const rowH = Math.max(ppm, 1);
    for (let i = 0; i < metres.m.length; i++) {
      const m = metres.m[i], j = midx.get(m);
      g.fillStyle = model && j !== undefined ? coreTypePaint(g, typeName.get(model.core[j])) : groupColor(metres.gs[i]);
      g.fillRect(0, yOf(m), W, rowH);
    }
    if (model) {
      g.fillStyle = SERIES.orange;
      for (const r of model.anomaly.runs) g.fillRect(W + 2, yOf(r.from_m), TICK, Math.max(1.5, (r.to_m - r.from_m) * ppm));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metres, model, typeName, H, ppm, hole0]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect(); const y = e.clientY - box.top; const d = dOf(y);
    const span = view[1] - view[0];
    const bh0 = Math.max(10, span * ppm), top = yOf((view[0] + view[1]) / 2) - bh0 / 2, bottom = top + bh0;
    let kind: "move" | "top" | "bottom";
    if (!whole && Math.abs(y - top) <= 5) kind = "top";
    else if (!whole && Math.abs(y - bottom) <= 5) kind = "bottom";
    else if (!whole && y > top && y < bottom) kind = "move";
    else {                                              // outside the box: put the window here (a 10 m one when the whole hole was shown)
      onRange(windowAbout(d, whole ? 10 : span, hole0, hole1)); kind = "move";
    }
    drag.current = { kind, y0: e.clientY, win: whole ? windowAbout(d, 10, hole0, hole1) : view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const dr = drag.current; if (!dr) return;
    const dd = (e.clientY - dr.y0) / ppm; const [a, b] = dr.win;
    if (dr.kind === "move") onRange(windowAbout((a + b) / 2 + dd, b - a, hole0, hole1));
    else if (dr.kind === "top") { const na = Math.max(hole0, Math.min(b - MIN_SPAN, a + dd)); onRange([Math.round(na * 10) / 10, b]); }
    else { const nb = Math.min(hole1, Math.max(a + MIN_SPAN, b + dd)); onRange([a, Math.round(nb * 10) / 10]); }
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); };

  // a 30 cm window is a hair's breadth on a 400 m hole: the box keeps a height a finger can take hold of
  const bh = Math.max(10, (view[1] - view[0]) * ppm), top = yOf((view[0] + view[1]) / 2) - bh / 2;
  return (
    <div className="relative flex-none select-none" style={{ width: W + TICK + 2, height: H + 2 * PAD, touchAction: "none" }} title={whole ? "Click to open a 10 m window here" : `${fmtWindow(view)} — drag to move, drag the ends to resize`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <canvas ref={canvasRef} style={{ width: W + TICK + 2, height: H + 2 * PAD }} className="block" />
      {!whole && (
        <div className="pointer-events-none absolute -left-[3px] rounded-[3px] border-2 border-slate-900 bg-slate-900/10 shadow-[0_0_0_1px_rgba(255,255,255,0.9)]" style={{ top: top - 1, height: bh + 2, width: W + 6 }}>
          <i className="absolute -top-[3px] left-1/2 h-1 w-2 -translate-x-1/2 rounded-sm bg-slate-900" /><i className="absolute -bottom-[3px] left-1/2 h-1 w-2 -translate-x-1/2 rounded-sm bg-slate-900" />
        </div>)}
      {!whole && <div className="pointer-events-none absolute inset-y-0 left-0 bg-white/55" style={{ width: W, top: PAD, height: Math.max(0, top - PAD) }} />}
      {!whole && <div className="pointer-events-none absolute left-0 bg-white/55" style={{ width: W, top: top + bh, height: Math.max(0, PAD + H - top - bh) }} />}
    </div>
  );
}
