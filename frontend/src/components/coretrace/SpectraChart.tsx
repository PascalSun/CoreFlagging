"use client";

import { useMemo, useRef, useState } from "react";
import { GRID, INK, MUTED, SERIES } from "@/components/coretrace/palette";

export type Line = { name: string; color: string; dash?: string; x: number[]; y: number[] | null };

/** Reflectance against wavelength for a few curves that share both axes. Hover reads every
 * curve at the wavelength under the pointer. */
export function SpectraChart({ title, unit, lines, xTicks, xFmt, height = 170, note }: {
  title: string; unit: string; lines: Line[]; xTicks: number[]; xFmt: (v: number) => string; height?: number; note?: string;
}) {
  const live = lines.filter((l) => l.y && l.y.length === l.x.length && l.y.length > 1) as (Line & { y: number[] })[];
  const W = 520, H = height, L = 34, R = 8, T = 8, B = 22;
  const ref = useRef<SVGSVGElement>(null);
  const [hx, setHx] = useState<number | null>(null);
  const dom = useMemo(() => {
    if (!live.length) return null;
    let x0 = Infinity, x1 = -Infinity, y1 = 0;
    for (const l of live) { x0 = Math.min(x0, l.x[0]); x1 = Math.max(x1, l.x[l.x.length - 1]); for (const v of l.y) if (v > y1) y1 = v; }
    const top = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1].find((t) => t >= y1 * 1.05) ?? 1;
    return { x0, x1, top };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);
  if (!dom) return <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">{title}: {note ?? "not measured in this metre"}</div>;
  const sx = (x: number) => L + ((x - dom.x0) / (dom.x1 - dom.x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - Math.min(y, dom.top) / dom.top) * (H - T - B);
  const path = (l: Line & { y: number[] }) => l.x.map((x, i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(l.y[i]).toFixed(1)}`).join("");
  const yTicks = [0, dom.top / 2, dom.top];
  const read = (l: Line & { y: number[] }, x: number) => { let k = 0; for (let i = 1; i < l.x.length; i++) if (Math.abs(l.x[i] - x) < Math.abs(l.x[k] - x)) k = i; return l.y[k]; };
  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect(); if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setHx(px < L || px > W - R ? null : dom.x0 + ((px - L) / (W - L - R)) * (dom.x1 - dom.x0));
  };
  return (
    <figure className="m-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-1">
        <span className="text-xs font-semibold text-slate-900">{title} <span className="font-normal text-slate-500">· reflectance by wavelength ({unit})</span></span>
        <span className="flex flex-wrap gap-x-3 text-[11px] text-slate-600">
          {live.map((l) => (
            <span key={l.name} className="flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} /></svg>
              {l.name}{hx !== null ? <b className="font-mono font-medium text-slate-900">{read(l, hx).toFixed(3)}</b> : null}
            </span>
          ))}
        </span>
      </figcaption>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={title} onMouseMove={onMove} onMouseLeave={() => setHx(null)}>
        {yTicks.map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke={GRID} /><text x={L - 5} y={sy(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill={MUTED}>{t.toFixed(2).replace(/0$/, "")}</text></g>
        ))}
        {xTicks.filter((t) => t >= dom.x0 && t <= dom.x1).map((t) => (
          <text key={t} x={sx(t)} y={H - 6} textAnchor="middle" fontSize="10" fill={MUTED}>{xFmt(t)}</text>
        ))}
        {live.map((l) => <path key={l.name} d={path(l)} fill="none" stroke={l.color} strokeWidth="2" strokeDasharray={l.dash} strokeLinejoin="round" />)}
        {hx !== null && <line x1={sx(hx)} x2={sx(hx)} y1={T} y2={H - B} stroke={INK} strokeOpacity="0.45" />}
        {hx !== null && <text x={Math.min(Math.max(sx(hx), L + 24), W - R - 24)} y={T + 9} textAnchor="middle" fontSize="10" fill={INK}>{xFmt(hx)} {unit}</text>}
      </svg>
    </figure>
  );
}

export const LINE = { measured: INK, around: "#9ca3af", rebuilt: SERIES.blue } as const;
