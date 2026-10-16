"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Trace, TraceView } from "@/lib/coreScan";
import { fine, STEP, type Mix } from "@/components/coretrace/sceneColour";

/** A vertical section: the holes near a line through this hole's collar, projected onto the vertical plane along it, drawn to
 * scale (no vertical exaggeration) the way a geologist draws a cross-section. The line's bearing is the hole's own dip direction
 * unless set; a hole is in the section when its collar is within the corridor, drawn fainter the further off the line it is.
 * Colours are the spectral log's, every 10 cm, as in the 3D view. Drag pans, the wheel zooms, hover reads a piece, click opens it. */
export function Section({ d, mixOf, colourAll, azimuth, corridor, onOpen }: {
  d: TraceView; mixOf: (key: string) => Mix; colourAll: boolean;
  azimuth: number | null; corridor: number; onAzimuth?: (a: number) => void; onOpen: (key: string, m: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1); const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const drag = useRef<{ x: number; y: number; pan: [number, number] } | null>(null);

  // the bearing by default: the way this hole leans (collar to toe), else towards the nearest neighbour, else east
  const bearing = useMemo(() => {
    if (azimuth !== null) return azimuth;
    const P = d.hole.points; const a = P[0], b = P[P.length - 1];
    const dx = b.e - a.e, dy = b.n - a.n;
    if (Math.hypot(dx, dy) > 5) return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 180;
    const c0 = d.hole.collar; const n = d.nearby[0];
    if (n) { const mlon = 111_320 * Math.cos((c0.lat * Math.PI) / 180); return ((Math.atan2((n.collar.lon - c0.lon) * mlon, (n.collar.lat - c0.lat) * 111_320) * 180) / Math.PI + 360) % 180; }
    return 90;
  }, [azimuth, d]);

  // every hole projected: along the line (x) and up (y), each 10 cm piece with its colour; off = how far the collar sits off the line
  const c0 = d.hole.collar; const mlat = 111_320, mlon = 111_320 * Math.cos((c0.lat * Math.PI) / 180);
  const collars = useMemo(() => [d.hole, ...d.nearby].map((t) => ({ t, main: t === d.hole, dx: (t.collar.lon - c0.lon) * mlon, dy: (t.collar.lat - c0.lat) * mlat })), [d, c0, mlon, mlat]);
  const holes = useMemo(() => {
    const th = (bearing * Math.PI) / 180; const sx = Math.sin(th), cx = Math.cos(th);
    const proj = (t: Trace, main: boolean) => {
      const dx = (t.collar.lon - c0.lon) * mlon, dy = (t.collar.lat - c0.lat) * mlat, dz = t.collar.rl !== null && c0.rl !== null ? t.collar.rl - c0.rl : 0;
      const off = (dx) * cx - (dy) * sx;
      const coloured = main || colourAll; const mix = mixOf(t.key);
      const P = coloured ? fine(t.points) : t.points;
      const pts = P.map((p) => ({ m: p.m, x: (p.e + dx) * sx + (p.n + dy) * cx, y: p.u + dz, c: coloured ? mix.colour.get(Math.round(p.m / STEP)) ?? null : null, t: mix.text.get(Math.round(p.m / STEP)) ?? null }));
      return { t, main, off, pts };
    };
    return [...d.nearby.map((n) => proj(n, false)).filter((h) => Math.abs(h.off) <= corridor).sort((a, b) => Math.abs(b.off) - Math.abs(a.off)), proj(d.hole, true)];
  }, [d, c0, mlon, mlat, bearing, corridor, colourAll, mixOf]);

  // the world box of what is drawn and the transform to the canvas, fitted then zoomed and panned
  const box = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const h of holes) for (const p of h.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    y1 = Math.max(y1, 0);
    return { x0, x1, y0, y1 };
  }, [holes]);

  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const W = el.clientWidth, H = el.clientHeight, R = window.devicePixelRatio || 1;
    el.width = W * R; el.height = H * R;
    const g = el.getContext("2d"); if (!g) return;
    g.setTransform(R, 0, 0, R, 0, 0);
    g.fillStyle = "#f8fafc"; g.fillRect(0, 0, W, H);
    // room for the toolbar above and the key below-left; the section fits the rest
    const padT = 150, padB = 70, padL = 80, padR = 330;   // the plan and the key sit on the right
    const w = Math.max(box.x1 - box.x0, 20), h = Math.max(box.y1 - box.y0, 20);
    const s = Math.min((W - padL - padR) / w, (H - padT - padB) / h) * zoom;
    const X = (x: number) => padL + (x - box.x0) * s + pan[0] + ((W - padL - padR) - w * s) / 2;
    const Y = (y: number) => H - padB - (y - box.y0) * s - pan[1] - ((H - padT - padB) - h * s) / 2;
    // grid: a round step in metres that gives 60–120 px
    const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find((v) => v * s >= 60) ?? 5000;
    g.font = "10px ui-sans-serif, system-ui"; g.textBaseline = "middle";
    g.strokeStyle = "#e2e8f0"; g.lineWidth = 1; g.fillStyle = "#64748b";
    for (let x = Math.floor(box.x0 / step) * step; x <= box.x1 + step; x += step) { const px = X(x); if (px < 0 || px > W) continue; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); g.textAlign = "center"; g.fillText(`${x} m`, px, H - 14); }
    for (let y = Math.floor(box.y0 / step) * step; y <= box.y1 + step; y += step) { const py = Y(y); if (py < 0 || py > H) continue; g.beginPath(); g.moveTo(0, py); g.lineTo(W, py); g.stroke(); g.textAlign = "left"; g.fillText(`${y} m`, 6, py); }
    // the ground through this collar
    g.strokeStyle = "#94a3b8"; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke(); g.setLineDash([]);
    g.textAlign = "right"; g.fillStyle = "#64748b"; g.fillText("ground at this collar", W - 8, Y(0) - 8);
    g.textAlign = "center"; g.fillStyle = "#475569"; g.fillText(`along the section line, bearing ${Math.round(bearing)}° → ${Math.round((bearing + 180) % 360)}°  (metres from this collar; up = elevation from it)`, W / 2, H - 28);
    g.lineCap = "round"; g.lineJoin = "round";
    for (const hh of holes) {
      const alpha = hh.main ? 1 : Math.max(0.3, 1 - (0.7 * Math.abs(hh.off)) / Math.max(corridor, 1));
      g.globalAlpha = alpha;
      const P = hh.pts; const wd = hh.main ? 8 : 4;
      // runs of one colour, each one stroke; a run with no colour (not scanned, or nothing read) is thin and pale, so it is
      // never mistaken for a pale rock colour; this hole's dark halo goes under its coloured runs only
      const runs: [number, number, string | null][] = []; let i = 0;
      while (i < P.length - 1) { const c = P[i].c; let j = i + 1; while (j < P.length - 1 && P[j].c === c) j++; runs.push([i, j, c]); i = j; }
      const stroke = (a: number, b: number) => { g.beginPath(); g.moveTo(X(P[a].x), Y(P[a].y)); for (let k = a + 1; k <= b; k++) g.lineTo(X(P[k].x), Y(P[k].y)); g.stroke(); };
      if (hh.main) { g.strokeStyle = "#0f172a"; g.lineWidth = wd + 4; for (const [a, b, c] of runs) if (c !== null) stroke(a, b); }
      for (const [a, b, c] of runs) { g.strokeStyle = c ?? "#cbd5e1"; g.lineWidth = c === null ? (hh.main ? 2 : 1.5) : wd; stroke(a, b); }
      // the flagged intervals beside this hole
      if (hh.main) {
        g.strokeStyle = "#6d28d9"; g.lineWidth = 3;
        for (const f of d.flags) { const a = P.find((p) => p.m >= f.from_m), b = [...P].reverse().find((p) => p.m <= f.to_m); if (!a || !b) continue; g.beginPath(); g.moveTo(X(a.x) + 9, Y(a.y)); g.lineTo(X(b.x) + 9, Y(b.y)); g.stroke(); }
      }
      // the collar, labelled
      const c = P[0]; g.fillStyle = hh.main ? "#0f172a" : "#475569"; g.beginPath(); g.arc(X(c.x), Y(c.y), hh.main ? 4 : 2.5, 0, 2 * Math.PI); g.fill();
      g.font = hh.main ? "bold 12px ui-sans-serif, system-ui" : "10px ui-sans-serif, system-ui"; g.textAlign = "center"; g.textBaseline = "bottom";
      g.fillText(hh.main ? `▶ ${hh.t.name}` : `${hh.t.name}${Math.abs(hh.off) >= 5 ? ` (${Math.round(Math.abs(hh.off))} m off)` : ""}`, X(c.x), Y(c.y) - 6);
      g.font = "10px ui-sans-serif, system-ui"; g.textBaseline = "middle";
      g.globalAlpha = 1;
    }
    // depth ticks on this hole every 50 m
    const M = holes[holes.length - 1]; g.fillStyle = "#475569"; g.textAlign = "left";
    for (const p of M.pts) if (Math.abs(p.m / 50 - Math.round(p.m / 50)) < 1e-6 && p.m > 0) g.fillText(`${p.m} m`, X(p.x) + 14, Y(p.y));
    (el as HTMLCanvasElement & { __xy?: (x: number, y: number) => [number, number] }).__xy = (x, y) => [X(x), Y(y)];
  }, [holes, box, zoom, pan, bearing, corridor, d.flags]);

  const nearest = (mx: number, my: number) => {
    const el = canvas.current as (HTMLCanvasElement & { __xy?: (x: number, y: number) => [number, number] }) | null; const xy = el?.__xy; if (!xy) return null;
    let best: { h: (typeof holes)[number]; p: (typeof holes)[number]["pts"][number]; d: number } | null = null;
    for (const h of holes) for (const p of h.pts) { const [px, py] = xy(p.x, p.y); const dd = Math.hypot(px - mx, py - my); if (dd < 8 && (!best || dd < best.d)) best = { h, p, d: dd }; }
    return best;
  };

  return (
    <div className="absolute inset-0">
      <canvas ref={canvas} className="size-full cursor-grab active:cursor-grabbing"
        onWheel={(e) => { setZoom((z) => Math.min(40, Math.max(0.5, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); }}
        onMouseDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, pan }; }}
        onMouseUp={(e) => {
          const dr = drag.current; drag.current = null;
          if (dr && Math.hypot(e.clientX - dr.x, e.clientY - dr.y) < 3) { const r = e.currentTarget.getBoundingClientRect(); const b = nearest(e.clientX - r.left, e.clientY - r.top); if (b) onOpen(b.h.t.key, b.p.m); }
        }}
        onMouseLeave={() => { drag.current = null; setHover(null); }}
        onMouseMove={(e) => {
          const dr = drag.current;
          if (dr) { setPan([dr.pan[0] + e.clientX - dr.x, dr.pan[1] - (e.clientY - dr.y)]); return; }
          const r = e.currentTarget.getBoundingClientRect(); const b = nearest(e.clientX - r.left, e.clientY - r.top);
          setHover(b ? { x: e.clientX - r.left, y: e.clientY - r.top, text: `${b.h.t.name} · ${b.p.m.toFixed(1)} m · ${b.p.t ?? (b.p.m >= b.h.t.depth_min - 0.5 && b.p.m <= b.h.t.depth_max + 0.5 ? "no reading" : "not scanned")}` } : null);
        }}
        onDoubleClick={() => { setZoom(1); setPan([0, 0]); }} />
      {hover && <div className="pointer-events-none absolute z-10 rounded-md bg-slate-900/90 px-2 py-1 text-[11px] text-white" style={{ left: hover.x + 12, top: hover.y + 12 }}>{hover.text}</div>}
      <Plan collars={collars} bearing={bearing} corridor={corridor} />
    </div>
  );
}

/** A small plan view beside the section: every collar seen from above, north up, with the section line through this
 * collar and the corridor either side of it, so the bearing and the corridor read at a glance. */
function Plan({ collars, bearing, corridor }: { collars: { t: Trace; main: boolean; dx: number; dy: number }[]; bearing: number; corridor: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const S = 200, R = window.devicePixelRatio || 1; el.width = S * R; el.height = S * R;
    const g = el.getContext("2d"); if (!g) return;
    g.setTransform(R, 0, 0, R, 0, 0); g.clearRect(0, 0, S, S);
    // the view reaches the corridor and the holes in it; holes further out sit at the edge, so the near ones keep their spacing
    const th0 = (bearing * Math.PI) / 180; const inCorr = collars.filter((c) => Math.abs(c.dx * Math.cos(th0) - c.dy * Math.sin(th0)) <= corridor);
    const reach = Math.max(1.6 * corridor, 100, ...inCorr.map((c) => Math.hypot(c.dx, c.dy) * 1.2)); const k = (S / 2 - 10) / reach;
    const clamp = (e: number, n: number) => { const r = Math.hypot(e, n); return r > reach ? [(e / r) * reach, (n / r) * reach] : [e, n]; };
    const X = (e: number) => S / 2 + e * k, Y = (n: number) => S / 2 - n * k;
    const th = (bearing * Math.PI) / 180; const ux = Math.sin(th), uy = Math.cos(th);   // along the line
    const vx = Math.cos(th), vy = -Math.sin(th);                                           // across it
    // the corridor as a band, the line through its middle
    const L = reach * 2, w = Math.min(corridor, reach) * k;
    g.save(); g.translate(S / 2, S / 2); g.rotate(-Math.atan2(uy, ux));
    g.fillStyle = "rgba(15,23,42,0.07)"; g.fillRect(-L * k, -w, 2 * L * k, 2 * w);
    g.strokeStyle = "#0f172a"; g.lineWidth = 1.2; g.setLineDash([5, 3]); g.beginPath(); g.moveTo(-L * k, 0); g.lineTo(L * k, 0); g.stroke(); g.setLineDash([]);
    g.restore();
    // the collars: in the corridor dark, outside faint; this one in ink with a ring
    g.font = "9px ui-sans-serif, system-ui"; g.textAlign = "left"; g.textBaseline = "middle";
    for (const c of collars) {
      const off = Math.abs(c.dx * vx + c.dy * vy); const inside = off <= corridor; const [e, n] = clamp(c.dx, c.dy); const far = e !== c.dx;
      g.fillStyle = c.main ? "#0f172a" : inside && !far ? "#475569" : "#cbd5e1";
      g.beginPath(); g.arc(X(e), Y(n), c.main ? 4 : 2.5, 0, 2 * Math.PI); g.fill();
      if (c.main) { g.strokeStyle = "#ffffff"; g.lineWidth = 1.5; g.stroke(); }
      if (c.main || (inside && !far && inCorr.length <= 8)) { g.fillStyle = c.main ? "#0f172a" : "#475569"; g.fillText(c.t.name, X(e) + 6, Y(n)); }
    }
    // north, and the scale
    g.fillStyle = "#64748b"; g.textAlign = "center"; g.fillText("N", S / 2, 8);
    g.beginPath(); g.moveTo(S / 2, 14); g.lineTo(S / 2, 24); g.strokeStyle = "#64748b"; g.lineWidth = 1; g.stroke();
    const bar = [50, 100, 200, 500, 1000, 2000, 5000].find((b) => b * k >= 30) ?? 10000;
    g.beginPath(); g.moveTo(8, S - 8); g.lineTo(8 + bar * k, S - 8); g.stroke(); g.textAlign = "left"; g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, 8, S - 16);
  }, [collars, bearing, corridor]);
  return (
    <div className="absolute top-[68px] right-3 z-10 w-[200px] overflow-hidden rounded-2xl border border-white/60 bg-white/85 shadow-glass backdrop-blur-xl" aria-label="Plan view of the section line">
      <canvas ref={ref} style={{ width: 200, height: 200 }} />
      <p className="border-t border-white/75 px-3 py-1.5 text-[10.5px] leading-snug text-slate-500">From above: the section line through this collar (bearing {Math.round(bearing)}°) and the holes within ±{corridor >= 1000 ? `${corridor / 1000} km` : `${corridor} m`} of it.</p>
    </div>
  );
}
