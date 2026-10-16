"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { coreScan, type SpectralLog, type Trace, type TraceView } from "@/lib/coreScan";
import { groupColor, groupName, SERIES } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const glass = "rounded-2xl border border-white/60 bg-white/85 shadow-glass backdrop-blur-xl";
const RINGS = [2, 5, 10] as const;
/** What colours the lines: the mineral group TSG read most of in each metre, the HyLogger data itself, SWIR or TIR. */
type Paint = "swir" | "tir";
const PAINTS: [Paint, string][] = [["swir", "SWIR minerals"], ["tir", "TIR minerals"]];
const NEIGHBOUR_LOGS = 30;                                      // how many neighbours' spectral logs to fetch when they are coloured

/** The group with the largest share in each metre of a spectral log, keyed by the metre's top. */
function leading(log: SpectralLog | undefined, side: "swir" | "tir"): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of log?.rows ?? []) {
    const mix = r[side]?.mix; if (!mix) continue;
    let best: string | null = null, bv = -1;
    for (const [g, v] of Object.entries(mix)) if (v > bv) { best = g; bv = v; }
    if (best !== null) out.set(Math.floor(r.from_m), best);
  }
  return out;
}

/** A hole and its neighbours as lines in space, in metres from this hole's collar (east, north, up). The hole is
 * coloured every metre by the HyLogger data itself (the mineral group TSG read most of, in TSG's colours); the neighbours are grey, or coloured the same way when "colour the neighbours" is on; the flagged
 * metres and the log disagreements are drawn thick. A click on a point opens that depth on the map. */
export function Scene() {
  const sp = useSearchParams(); const router = useRouter();
  const key = sp.get("hole"); const [km, setKm] = useState<number>(Number(sp.get("km")) || 2);
  const [colourAll, setColourAll] = useState(false);
  const [paint, setPaint] = useState<Paint>("swir");
  const [frame, setFrame] = useState<"hole" | "all">("hole");      // what the view is framed on: this hole at true proportions, or every neighbour
  const q = useQuery({ queryKey: ["core-trace", key, km], queryFn: () => coreScan.trace(key as string, km), enabled: !!key, staleTime: 10 * 60_000 });
  const host = useRef<HTMLDivElement>(null);
  // the spectral logs (1 m) behind the mineral colouring: this hole's, and the neighbours' when they are coloured
  const sq = useQuery({ queryKey: ["core-spectral", key], queryFn: () => coreScan.spectralLog(key as string, 1), enabled: !!key, staleTime: 60 * 60_000, retry: false });
  const nearKeys = useMemo(() => (colourAll ? (q.data?.nearby ?? []).slice(0, NEIGHBOUR_LOGS).map((n) => n.key) : []), [q.data, colourAll]);
  const nq = useQueries({ queries: nearKeys.map((k) => ({ queryKey: ["core-spectral", k], queryFn: () => coreScan.spectralLog(k, 1), staleTime: 60 * 60_000, retry: false })) });
  const nearStamp = nq.map((r) => r.dataUpdatedAt).join(",");                 // useQueries hands back a new array each render; redraw only when a log arrives
  const nearLogs = useMemo(() => new Map(nearKeys.map((k, i) => [k, nq[i]?.data])), [nearKeys, nearStamp]);  // eslint-disable-line react-hooks/exhaustive-deps
  const mainLead = useMemo(() => leading(sq.data, paint), [sq.data, paint]);
  // the groups this hole shows, most metres first, for the key
  const mainGroups = useMemo(() => { const c = new Map<string, number>(); for (const g of mainLead.values()) c.set(g, (c.get(g) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g); }, [mainLead]);

  useEffect(() => {
    const d = q.data; const el = host.current; if (!d || !el) return;
    let gone = false;
    (async () => {
      const Plotly = (await import("plotly.js-dist-min")).default as any;
      if (gone) return;
      const c0 = d.hole.collar; const mlat = 111_320, mlon = 111_320 * Math.cos((c0.lat * Math.PI) / 180);
      // every hole in metres from this hole's collar; heights from RL when both have one, else from the hole's own collar
      const rel = (t: Trace) => { const dx = (t.collar.lon - c0.lon) * mlon, dy = (t.collar.lat - c0.lat) * mlat, dz = t.collar.rl !== null && c0.rl !== null ? t.collar.rl - c0.rl : 0; return { dx, dy, dz }; };
      // One trace per hole, coloured point by point through a discrete colour scale (one step per rock class, grey for
      // no reading). One trace per run of the same class was 650+ traces at 10 km, which is what loses the WebGL
      // context on a laptop and what made every hover and click slow.
      // Each point's label: the leading TSG mineral group of its metre, from the spectral log. The line is
      // coloured through a discrete colour scale with one step per label (grey for no reading): one trace per hole, because one
      // per run of the same colour was 650+ traces at 10 km, which is what loses the WebGL context on a laptop.
      const labelOf = (t: Trace, p: Trace["points"][number], main: boolean): string | null => (main ? mainLead : leading(nearLogs.get(t.key), paint)).get(Math.floor(p.m)) ?? null;
      const colourOf = (label: string) => groupColor(label);
      const labels: string[] = []; const idx = (l: string | null) => { if (l === null) return -1; let i = labels.indexOf(l); if (i < 0) { i = labels.length; labels.push(l); } return i; };
      const traces: any[] = [];
      const line = (t: Trace, main: boolean) => {
        const { dx, dy, dz } = rel(t); const P = t.points;
        const coloured = main || colourAll;
        // a coloured line lists each segment's two ends with the label of its top end, so a colour changes sharply at a
        // point instead of blending along the segment (Plotly shades a segment between its ends' colours)
        const L = P.map((p) => labelOf(t, p, main));
        const V: { p: Trace["points"][number]; l: string | null }[] = coloured ? P.flatMap((p, i) => (i < P.length - 1 ? [{ p, l: L[i] }, { p: P[i + 1], l: L[i] }] : [])) : P.map((p, i) => ({ p, l: L[i] }));
        traces.push({ type: "scatter3d", mode: "lines", x: V.map((v) => v.p.e + dx), y: V.map((v) => v.p.n + dy), z: V.map((v) => v.p.u + dz),
          line: coloured ? { color: V.map((v) => idx(v.l)), width: main ? 14 : 5, showscale: false } : { color: "#94a3b8", width: 3 },
          hovertemplate: `${t.name}${main ? "" : ` · ${t.km} km`}<br>%{text}<extra></extra>`,
          text: V.map((v) => `${v.p.m.toFixed(0)} m${coloured ? `<br>${v.l === null ? "no reading" : groupName(v.l)}` : ""}${!main && t.target ? `<br>drilled for ${t.target}` : ""}${!main && t.n_again ? `<br>look again: ${t.n_again} intervals` : ""}`),
          customdata: V.map((v) => [t.key, v.p.m]), showlegend: false, opacity: main ? 1 : coloured ? 0.85 : 0.7 });
        // the collar, labelled
        traces.push({ type: "scatter3d", mode: "markers+text", x: [dx], y: [dy], z: [dz], text: [t.name], textposition: "top center", textfont: { size: main ? 12 : 10, color: main ? "#0f172a" : "#475569" },
          marker: { size: main ? 5 : 3, color: main ? "#0f172a" : "#64748b" }, hoverinfo: "skip", showlegend: false });
      };
      for (const n of d.nearby) line(n, false);
      line(d.hole, true);
      // the colour scale, now every label is known: label i at step i, "no reading" grey at the end
      const steps = [...labels.map(colourOf), "#94a3b8"]; const n = steps.length; const NONE = labels.length;
      const colorscale = steps.flatMap((c, i) => [[i / n, c], [(i + 1) / n, c]]);
      for (const tr of traces) if (tr.type === "scatter3d" && tr.mode === "lines" && Array.isArray(tr.line?.color)) Object.assign(tr.line, { color: tr.line.color.map((i: number) => (i < 0 ? NONE : i)), colorscale, cmin: 0, cmax: n });
      // what to look at again, drawn thick on the hole
      const mark = (ivs: { from_m: number; to_m: number }[], color: string, label: string) => {
        for (const iv of ivs) {
          const seg = d.hole.points.filter((p) => p.m >= iv.from_m - 1 && p.m <= iv.to_m + 1); if (seg.length < 2) continue;
          traces.push({ type: "scatter3d", mode: "lines", x: seg.map((p) => p.e), y: seg.map((p) => p.n), z: seg.map((p) => p.u), line: { color, width: 16 }, opacity: 0.55,
            hovertemplate: `${label}<br>${iv.from_m}–${iv.to_m} m<extra></extra>`, customdata: seg.map((p) => [d.hole.key, p.m, iv.from_m, iv.to_m]), showlegend: false });
        }
      };
      mark(d.again, SERIES.orange, "Model disagrees with the log"); mark(d.flags, "#7c3aed", "Stands out from its surroundings");
      // depth every 50 m down the hole, so the eye reads it as a drillhole and not a stick
      const H = d.hole.points; const ticks = H.filter((p) => Math.round(p.m) % 50 === 0 && Math.abs(p.m - Math.round(p.m)) < 0.05);
      if (ticks.length) traces.push({ type: "scatter3d", mode: "markers+text", x: ticks.map((p) => p.e), y: ticks.map((p) => p.n), z: ticks.map((p) => p.u), text: ticks.map((p) => `${Math.round(p.m)} m`),
        textposition: "middle right", textfont: { size: 10, color: "#475569" }, marker: { size: 2.5, color: "#0f172a" }, hoverinfo: "skip", showlegend: false });
      // framed on this hole: a cube around it at true proportions, the ground as a faint square at the collar's level
      const ex = H.map((p) => p.e), ny = H.map((p) => p.n), up = H.map((p) => p.u);
      const lo = [Math.min(...ex), Math.min(...ny), Math.min(...up)], hi = [Math.max(...ex), Math.max(...ny), Math.max(...up)];
      const half = Math.max(40, 0.62 * Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])); const c = lo.map((v, i) => (v + hi[i]) / 2);
      const rng = (i: number) => [c[i] - half, c[i] + half];
      if (frame === "hole") {
        const [x0, x1] = rng(0), [y0, y1] = rng(1);
        traces.push({ type: "mesh3d", x: [x0, x1, x1, x0], y: [y0, y0, y1, y1], z: [0, 0, 0, 0], i: [0, 0], j: [1, 2], k: [2, 3], color: "#cbd5e1", opacity: 0.25, hoverinfo: "skip", showlegend: false, name: "ground" });
      }
      // look at the hole side-on: from the side of its dip direction, so an inclined hole reads as inclined rather than
      // being seen end-on and looking vertical (a vertical hole is viewed from the south-east)
      const end = H[H.length - 1]; const hx = end.e - H[0].e, hy = end.n - H[0].n; const hl = Math.hypot(hx, hy);
      const side = hl > 5 ? { x: (-hy / hl) * 1.7, y: (hx / hl) * 1.7 } : { x: 1.2, y: -1.2 };
      const axis = (title: string, i: number) => ({ title: { text: title }, gridcolor: "#e2e8f0", zerolinecolor: "#cbd5e1", ...(frame === "hole" ? { range: rng(i), autorange: false } : {}) });
      const layout = {
        margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: "rgba(0,0,0,0)", showlegend: false,
        scene: { aspectmode: frame === "hole" ? "cube" : "data", xaxis: axis("east (m)", 0), yaxis: axis("north (m)", 1), zaxis: axis(c0.rl !== null ? "up (m, from this collar)" : "up (m)", 2),
          camera: { eye: frame === "hole" ? { ...side, z: 0.55 } : { x: 0.75, y: -0.9, z: 0.45 } }, bgcolor: "#f8fafc" },
      };
      await Plotly.react(el, traces, layout, { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["toImage"] });
      (el as any).on?.("plotly_click", (ev: any) => {
        const cd = ev.points?.[0]?.customdata; if (!cd) return;
        const [k, m, f, t] = cd as [string, number, number?, number?];
        router.push(`/map?hole=${encodeURIComponent(k)}&full=1${f !== undefined && t !== undefined ? `&tab=window&w=${f}-${t}` : `&m=${Math.floor(m)}`}`);
      });
    })();
    return () => { gone = true; };
  }, [q.data, colourAll, frame, router, paint, mainLead, nearLogs]);

  const d: TraceView | undefined = q.data;
  return (
    <div className="fixed inset-0 bg-slate-100">
      <div ref={host} className="absolute inset-0" />
      <div className={cn(glass, "absolute top-3 left-3 z-10 flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-3 px-4 py-2.5")}>
        <Link href={key ? `/map?hole=${encodeURIComponent(key)}` : "/map"} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"><ArrowLeft size={14} />Map</Link>
        <h1 className="font-display text-sm font-semibold text-slate-900">{d ? d.hole.name : key ?? "A hole"} in space</h1>
        {d && <span className="text-[11px] text-slate-500">{d.hole.source === "survey" ? `${d.hole.stations} survey stations` : d.hole.source === "header" ? "straight, from the scan header" : "no survey: drawn vertical"} · {d.nearby.length} holes within</span>}
        <div className="flex overflow-hidden rounded-md border border-slate-200 text-[11px]" role="group" aria-label="Neighbours within">
          {RINGS.map((r) => <button key={r} type="button" onClick={() => setKm(r)} className={cn("px-2 py-0.5", km === r ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>{r} km</button>)}
        </div>
        <div className="flex overflow-hidden rounded-md border border-slate-200 text-[11px]" role="group" aria-label="Framed on">
          {([["hole", "This hole"], ["all", "Everything"]] as const).map(([f, label]) => <button key={f} type="button" onClick={() => setFrame(f)} className={cn("px-2 py-0.5", frame === f ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>{label}</button>)}
        </div>
        <div className="flex overflow-hidden rounded-md border border-slate-200 text-[11px]" role="group" aria-label="Coloured by">
          {PAINTS.map(([p, label]) => <button key={p} type="button" onClick={() => setPaint(p)} className={cn("px-2 py-0.5", paint === p ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>{label}</button>)}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600"><input type="checkbox" checked={colourAll} onChange={(e) => setColourAll(e.target.checked)} className="size-3 accent-slate-900" />colour the neighbours too</label>
        {q.isPending && <span className="text-[11px] text-slate-500">Loading…</span>}
        {q.isError && <span className="text-[11px] text-rose-700">This hole has no collar position.</span>}
        {sq.isError && <span className="text-[11px] text-amber-700">No spectral log for this hole: the line is grey.</span>}
      </div>
      {d && (
        <div className={cn(glass, "absolute bottom-3 left-3 z-10 max-w-[360px] px-3 py-2 text-[11px] text-slate-600")}>
          <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1">
            {mainGroups.slice(0, 10).map((g) => <span key={g} className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-[2px] border border-slate-300/60" style={{ background: groupColor(g) }} />{groupName(g)}</span>)}
          </div>
          <div className="flex flex-wrap gap-x-3"><span className="flex items-center gap-1"><i className="inline-block h-1.5 w-4 rounded" style={{ background: SERIES.orange }} />model disagrees with the log</span><span className="flex items-center gap-1"><i className="inline-block h-1.5 w-4 rounded bg-violet-700" />stands out from its surroundings</span><span className="flex items-center gap-1"><i className="inline-block h-1 w-4 rounded bg-slate-400" />neighbour</span></div>
          <p className="mt-1 text-slate-400">Colours are the HyLogger data itself: the {paint.toUpperCase()} mineral group TSG read most of in each metre, in TSG&apos;s standard colours. True proportions, no vertical exaggeration. Drag to turn, scroll to zoom; Everything fits every neighbour in. Click a point to open that depth on the map.</p>
        </div>
      )}
    </div>
  );
}
