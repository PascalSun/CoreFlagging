"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Compass, Ruler } from "lucide-react";
import { coreScan, type Trace, type TraceView } from "@/lib/coreScan";
import { groupColor, groupName, SERIES } from "@/components/coretrace/palette";
import { fine, mixed, STEP } from "@/components/coretrace/sceneColour";
import { Section } from "@/components/coretrace/Section";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const glass = "rounded-2xl border border-white/60 bg-white/85 shadow-glass backdrop-blur-xl";

/** A row of choices in a glass pill, the chosen one in ink: the map page's tab bar, reused for every option here. */
function Pill<T extends string | number>({ value, onChange, items, label, icon }: { value: T; onChange: (v: T) => void; items: readonly (readonly [T, string])[]; label: string; icon?: React.ReactNode }) {
  return (
    <div className={cn(glass, "flex h-11 items-center gap-0.5 rounded-full p-1")} role="group" aria-label={label} title={label}>
      {icon && <span className="grid size-9 place-items-center text-slate-500">{icon}</span>}
      {items.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={cn("flex h-9 items-center whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors", value === v ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>{text}</button>
      ))}
    </div>
  );
}
const RINGS = [2, 5, 10] as const;
const NEIGHBOUR_LOGS = 30;                                      // how many neighbours' spectral logs to fetch when they are coloured
const FINE_NEIGHBOURS = 12;                                     // up to this many neighbours take the 0.1 m log; more take the 1 m one
/** What colours the lines: the mineral group TSG read most of in each metre, the HyLogger data itself, SWIR or TIR. */
type Paint = "swir" | "tir";
const PAINTS: [Paint, string][] = [["swir", "SWIR minerals"], ["tir", "TIR minerals"]];
export function Scene() {
  const sp = useSearchParams(); const router = useRouter();
  const key = sp.get("hole"); const [km, setKm] = useState<number>(Number(sp.get("km")) || 2);
  const colourAll = true;                                        // the neighbours are always coloured from their own logs
  const [paint, setPaint] = useState<Paint>("swir");
  const [frame, setFrame] = useState<"hole" | "all">("all");
  const [view, setView] = useState<"3d" | "section">(sp.get("view") === "section" ? "section" : "3d");
  const [azimuth, setAzimuth] = useState<number | null>(null);   // the section line's bearing, null = the hole's own dip direction
  const [corridor, setCorridor] = useState<number>(250);         // the section takes holes within this many metres of its line      // what the view is framed on: this hole at true proportions, or every neighbour
  const q = useQuery({ queryKey: ["core-trace", key, km], queryFn: () => coreScan.trace(key as string, km), enabled: !!key, staleTime: 10 * 60_000 });
  const host = useRef<HTMLDivElement>(null);
  // the spectral logs (1 m) behind the mineral colouring: this hole's, and the neighbours' when they are coloured
  const sq = useQuery({ queryKey: ["core-spectral-whole", key, 0.1], queryFn: () => coreScan.spectralLog(key as string, 0.1), enabled: !!key, staleTime: 60 * 60_000, retry: false });
  const nearKeys = useMemo(() => (q.data?.nearby ?? []).slice(0, NEIGHBOUR_LOGS).map((n) => n.key), [q.data]);
  const nearStep: 1 | 0.1 = nearKeys.length <= FINE_NEIGHBOURS ? 0.1 : 1;
  const nq = useQueries({ queries: nearKeys.map((k) => ({ queryKey: ["core-spectral-whole", k, nearStep], queryFn: () => coreScan.spectralLog(k, nearStep), staleTime: 60 * 60_000, retry: false })) });
  const nearStamp = nq.map((r) => r.dataUpdatedAt).join(",");                 // useQueries hands back a new array each render; redraw only when a log arrives
  const nearLogs = useMemo(() => new Map(nearKeys.map((k, i) => [k, nq[i]?.data])), [nearKeys, nearStamp]);  // eslint-disable-line react-hooks/exhaustive-deps
  const mainMix = useMemo(() => mixed(sq.data, paint), [sq.data, paint]);
  const mainGroups = mainMix.rank;                                // the groups this hole shows, most core first, for the key

  useEffect(() => {
    const d = q.data; const el = host.current; if (!d || !el || view !== "3d") return;
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
      // Every 10 cm of a coloured hole takes the colour of its interval in the spectral log: the groups' TSG colours mixed by
      // share, grey where nothing was read. One trace per hole (one per run of a colour was 650+ traces at 10 km, which loses
      // the WebGL context on a laptop); a line lists each piece's two ends with the piece's own colour, so a colour changes
      // sharply at a point instead of shading across the piece.
      const NO = "#94a3b8";
      const traces: any[] = [];
      const line = (t: Trace, main: boolean) => {
        const { dx, dy, dz } = rel(t); const coloured = main || colourAll;
        const mix = main ? mainMix : mixed(nearLogs.get(t.key), paint);
        const P = coloured ? fine(t.points) : t.points;
        const C = P.map((p) => mix.colour.get(Math.round(p.m / STEP)) ?? NO);
        const V: { p: Trace["points"][number]; c: string }[] = coloured ? P.flatMap((p, i) => (i < P.length - 1 ? [{ p, c: C[i] }, { p: P[i + 1], c: C[i] }] : [])) : P.map((p, i) => ({ p, c: C[i] }));
        // this hole wears a dark halo under its colours, so it stands out among coloured neighbours in the wide view
        if (main) traces.push({ type: "scatter3d", mode: "lines", x: t.points.map((p) => p.e + dx), y: t.points.map((p) => p.n + dy), z: t.points.map((p) => p.u + dz), line: { color: "#0f172a", width: 22 }, opacity: 0.9, hoverinfo: "skip", showlegend: false });
        traces.push({ type: "scatter3d", mode: "lines", x: V.map((v) => v.p.e + dx), y: V.map((v) => v.p.n + dy), z: V.map((v) => v.p.u + dz),
          line: coloured ? { color: V.map((v) => v.c), width: main ? 14 : 5 } : { color: NO, width: 3 },
          hovertemplate: `${t.name}${main ? "" : ` · ${t.km} km`}<br>%{text}<extra></extra>`,
          text: V.map((v) => `${v.p.m.toFixed(1)} m${coloured ? `<br>${mix.text.get(Math.round(v.p.m / STEP)) ?? "no reading"}` : ""}${!main && t.target ? `<br>drilled for ${t.target}` : ""}${!main && t.n_again ? `<br>look again: ${t.n_again} intervals` : ""}`),
          customdata: V.map((v) => [t.key, v.p.m]), showlegend: false, opacity: main ? 1 : coloured ? 0.85 : 0.7 });
        // the collar, labelled
        traces.push({ type: "scatter3d", mode: "markers+text", x: [dx], y: [dy], z: [dz], text: [main ? `▶ ${t.name}` : t.name], textposition: "top center", textfont: { size: main ? 14 : 10, color: main ? "#0f172a" : "#475569" },
          marker: { size: main ? 8 : 3, color: main ? "#0f172a" : "#64748b", ...(main ? { line: { color: "#ffffff", width: 2 } } : {}) }, hoverinfo: "skip", showlegend: false });
      };
      for (const n of d.nearby) line(n, false);
      line(d.hole, true);
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
  }, [q.data, colourAll, frame, router, paint, mainMix, nearLogs, view]);

  const d: TraceView | undefined = q.data;
  const presets = [["N–S", 0], ["NE–SW", 45], ["E–W", 90], ["NW–SE", 135]] as const;
  return (
    <div className="fixed inset-0 bg-slate-100">
      {view === "3d" ? <div ref={host} className="absolute inset-0" /> : d && (
        <Section d={d} paint={paint} mainMix={mainMix} nearLogs={nearLogs} colourAll azimuth={azimuth} corridor={corridor} onAzimuth={setAzimuth}
          onOpen={(k, m) => router.push(`/map?hole=${encodeURIComponent(k)}&full=1&m=${Math.floor(m)}`)} />
      )}
      {/* top bar, as on the map: the brand and the way back on the left, the views and their options after */}
      <div className="pointer-events-none absolute top-0 right-0 left-0 z-20 flex flex-wrap items-center gap-2 p-3 sm:gap-3">
        <Link href="/" className={cn(glass, "pointer-events-auto hidden h-11 flex-none items-center gap-2 rounded-full pr-4 pl-1.5 font-display text-sm font-bold tracking-tight text-ink sm:flex")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/coretrace-mark.svg" alt="" className="size-8 rounded-full" />CoreFlagging
        </Link>
        <Link href={key ? `/map?hole=${encodeURIComponent(key)}` : "/map"} className={cn(glass, "pointer-events-auto flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-slate-700 hover:bg-white hover:text-slate-900")}><ArrowLeft size={15} />Map</Link>
        <div className={cn(glass, "pointer-events-auto flex h-11 min-w-0 items-center gap-2 rounded-full px-4")}>
          <h1 className="font-display text-sm font-bold tracking-tight text-ink">{d ? d.hole.name : key ?? "A hole"}</h1>
          {d && <span className="hidden truncate text-xs text-slate-500 md:inline">{d.hole.source === "survey" ? `${d.hole.stations} survey stations` : d.hole.source === "header" ? "straight, from the scan header" : "no survey, drawn vertical"} · {d.nearby.length} holes within {km} km</span>}
          {q.isPending && <span className="text-xs text-slate-500">Loading…</span>}
          {q.isError && <span className="text-xs text-rose-700">no collar position</span>}
        </div>
        <div className="pointer-events-auto"><Pill value={view} onChange={setView} items={[["3d", "3D"], ["section", "Section"]] as const} label="View" /></div>
        <div className="pointer-events-auto"><Pill value={km} onChange={setKm} items={RINGS.map((r) => [r, `${r} km`] as const)} label="Neighbours within" /></div>
        <div className="pointer-events-auto"><Pill value={paint} onChange={setPaint} items={PAINTS} label="Coloured by" /></div>
        {view === "3d" ? (
          <div className="pointer-events-auto"><Pill value={frame} onChange={setFrame} items={[["hole", "This hole"], ["all", "Everything"]] as const} label="Framed on" /></div>
        ) : (
          <>
            <div className={cn(glass, "pointer-events-auto flex h-11 items-center gap-1 rounded-full p-1")} role="group" aria-label="Section line" title="The section line's bearing">
              <span className="grid size-9 place-items-center text-slate-500"><Compass size={16} /></span>
              <button type="button" aria-pressed={azimuth === null} onClick={() => setAzimuth(null)} className={cn("flex h-9 items-center rounded-full px-3 text-sm font-semibold", azimuth === null ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>Along the dip</button>
              {presets.map(([l, a]) => <button key={l} type="button" aria-pressed={azimuth === a} onClick={() => setAzimuth(a)} className={cn("flex h-9 items-center rounded-full px-3 text-sm font-semibold", azimuth === a ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>{l}</button>)}
              <input type="range" min={0} max={179} value={azimuth ?? 0} onChange={(e) => setAzimuth(Number(e.target.value))} className="mx-1 w-20 accent-ink" aria-label="Bearing" />
              <span className="w-9 pr-2 text-right font-mono text-xs text-slate-600">{azimuth === null ? "dip" : `${azimuth}°`}</span>
            </div>
            <div className="pointer-events-auto"><Pill value={corridor} onChange={setCorridor} items={[[100, "±100 m"], [250, "±250 m"], [500, "±500 m"], [2000, "±2 km"]] as const} label="Holes within the corridor" icon={<Ruler size={16} />} /></div>
          </>
        )}
      </div>
      {/* the key, as on the map: the groups this hole shows, the marks, and what the view is */}
      {d && (
        <aside aria-label="Key" className={cn(glass, "absolute right-3 bottom-3 z-10 w-[300px] max-w-[calc(100vw-24px)] overflow-hidden bg-white/90")}>
          <div className="flex items-center gap-2 border-b border-white/75 py-2 pr-3 pl-4">
            <b className="font-display text-sm font-bold tracking-tight">{paint === "swir" ? "SWIR" : "TIR"} mineral groups</b>
            <span className="ml-auto text-[11.5px] whitespace-nowrap text-slate-500">every 10 cm</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 text-xs text-slate-700">
            {mainGroups.slice(0, 10).map((g) => <span key={g} className="flex items-center gap-1.5"><i className="inline-block size-3 flex-none rounded-[3px] border border-slate-900/10" style={{ background: groupColor(g) }} />{groupName(g)}</span>)}
            {sq.isError && <span className="col-span-2 text-amber-700">No spectral log for this hole: it is drawn grey.</span>}
          </div>
          <div className="flex flex-col gap-1 border-t border-white/75 px-4 py-2 text-xs text-slate-700">
            <span className="flex items-center gap-1.5"><i className="inline-block h-1.5 w-4 rounded-full bg-ink" />this hole, with a dark edge</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-1.5 w-4 rounded-full bg-violet-700" />stands out from its surroundings</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-1.5 w-4 rounded-full" style={{ background: SERIES.orange }} />model disagrees with the log</span>
          </div>
          <p className="border-t border-white/75 px-4 py-2 text-[11px] leading-relaxed text-slate-500">
            Colours are the HyLogger data itself: the mineral groups TSG read in each 10 cm, their standard colours mixed by share. True proportions, no vertical exaggeration.{" "}
            {view === "3d" ? "Drag to turn, scroll to zoom." : "A vertical section through this collar along the line; holes within the corridor are projected onto it, fainter the further off the line. Drag to pan, scroll to zoom, double-click to reset."} Click a point to open that depth on the map.
          </p>
        </aside>
      )}
    </div>
  );
}
