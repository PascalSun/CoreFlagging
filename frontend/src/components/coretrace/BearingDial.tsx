"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/** The section line as a compass: the line through the collar drawn on a dial, turned by dragging anywhere on it.
 * A section line has no direction of its own (N–S is S–N), so a bearing is 0–179° clockwise from north. The hole's
 * own lean (the default line) is marked in orange; the line snaps to it, and to the four cardinal lines, within a few
 * degrees, and snapping onto the lean hands back null ("along the dip"). Arrow keys turn it a degree (Shift: 15°). */
export function BearingDial({ value, dip, onChange, size = 104, className }: {
  /** the chosen bearing, or null for the hole's own lean */
  value: number | null;
  /** the bearing of the hole's own lean */
  dip: number;
  onChange: (b: number | null) => void;
  size?: number;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const shown = value ?? dip;
  const r = size / 2, ring = r - 3, inner = ring - 13;
  const at = (deg: number, rad: number) => { const a = (deg * Math.PI) / 180; return [r + rad * Math.sin(a), r - rad * Math.cos(a)] as const; };
  const pick = (deg: number) => {
    const b = ((Math.round(deg) % 180) + 180) % 180;
    const near = (x: number) => Math.min(Math.abs(b - x), 180 - Math.abs(b - x));
    if (near(dip) <= 4) return onChange(null);
    for (const c of [0, 90]) if (near(c) <= 3) return onChange(c);
    onChange(b);
  };
  const fromPointer = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2);
    if (Math.hypot(dx, dy) < 4) return;
    pick((Math.atan2(dx, -dy) * 180) / Math.PI);
  };
  const line = (deg: number, rad: number) => { const [x1, y1] = at(deg, rad), [x2, y2] = at(deg + 180, rad); return { x1, y1, x2, y2 }; };
  return (
    <svg ref={ref} width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="slider" tabIndex={0}
      aria-label="Section line bearing" aria-valuemin={0} aria-valuemax={179} aria-valuenow={Math.round(shown)} aria-valuetext={value === null ? `along the dip, ${Math.round(dip)}°` : `${value}°`}
      className={cn("flex-none cursor-grab touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 active:cursor-grabbing", className)}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); fromPointer(e); }}
      onPointerMove={(e) => { if (e.buttons) fromPointer(e); }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 1;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); pick(Math.round(shown) + step); }
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); pick(Math.round(shown) - step + 180); }
        if (e.key === "Home") { e.preventDefault(); onChange(null); }
      }}>
      <circle cx={r} cy={r} r={ring} fill="white" stroke="#cbd5e1" />
      {/* ticks: every 15°, longer every 45° */}
      {Array.from({ length: 24 }, (_, i) => i * 15).map((t) => { const [x1, y1] = at(t, ring), [x2, y2] = at(t, ring - (t % 45 ? 4 : 7)); return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth={t % 90 ? 1 : 1.5} />; })}
      {([["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const).map(([l, t]) => { const [x, y] = at(t, inner); return <text key={l} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size > 90 ? 10 : 9} fontWeight={l === "N" ? 700 : 500} fill={l === "N" ? "#0f172a" : "#64748b"}>{l}</text>; })}
      {/* the hole's own lean */}
      <line {...line(dip, inner - 7)} stroke="#eb6834" strokeWidth={1.5} strokeDasharray="3 3" opacity={value === null ? 0 : 0.9} />
      {/* the section line, with its ends marked */}
      <line {...line(shown, inner - 7)} stroke={value === null ? "#eb6834" : "#0b0b0b"} strokeWidth={3} strokeLinecap="round" />
      {[shown, shown + 180].map((t) => { const [x, y] = at(t, inner - 7); return <circle key={t} cx={x} cy={y} r={3.5} fill={value === null ? "#eb6834" : "#0b0b0b"} />; })}
      <circle cx={r} cy={r} r={3} fill="white" stroke="#0b0b0b" strokeWidth={1.5} />
    </svg>
  );
}
