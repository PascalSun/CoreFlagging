"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Compass, Ruler } from "lucide-react";
import { coreScan, type Trace, type TraceView } from "@/lib/coreScan";
import { groupColor, groupName, lithColor, SERIES } from "@/components/coretrace/palette";
import { fine, logged, mixed, STEP, type Mix } from "@/components/coretrace/sceneColour";
import { Section } from "@/components/coretrace/Section";
import { KeyTips } from "@/components/coretrace/MapKey";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const glass = "rounded-2xl border border-white/60 bg-white/85 shadow-glass backdrop-blur-xl";

/** A row of choices in a glass pill, the chosen one in ink: the map page's tab bar, reused for every option here. */
function Pill<T extends string | number>({ value, onChange, items, label, icon, tip }: { value: T; onChange: (v: T) => void; items: readonly (readonly [T, string] | readonly [T, string, string])[]; label: string; icon?: React.ReactNode; tip?: string }) {
  return (
    <div className={cn(glass, "flex h-11 items-center gap-0.5 rounded-full p-1")} role="group" aria-label={label}>
      {icon && <span className="grid size-9 place-items-center text-slate-500" data-keytip={tip}>{icon}</span>}
      {items.map(([v, text, t]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)} data-keytip={t ?? tip}
          className={cn("flex h-9 items-center whitespace-nowrap rounded-full px-3 text-sm font-semibold transition-colors", value === v ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>{text}</button>
      ))}
    </div>
  );
}
const RINGS = [2, 5, 10] as const;
const NEIGHBOUR_LOGS = 30;                                      // how many neighbours' spectral logs to fetch when they are coloured
const FINE_NEIGHBOURS = 12;                                     // up to this many neighbours take the 0.1 m log; more take the 1 m one
/** What colours the lines: the mineral group TSG read most of in each metre, the HyLogger data itself, SWIR or TIR. */
type Paint = "rock" | "swir" | "tir";
export function Scene() {
  const sp = useSearchParams(); const router = useRouter();
  const key = sp.get("hole"); const [km, setKm] = useState<number>(Number(sp.get("km")) || 2);
  const colourAll = true;                                        // the neighbours are always coloured from their own logs
  const [chosen, setChosen] = useState<Paint | null>(null);     // null: the logged rock when the hole has one, else SWIR
  const [view, setView] = useState<"3d" | "section">(sp.get("view") === "section" ? "section" : "3d");
  const [azimuth, setAzimuth] = useState<number | null>(null);   // the section line's bearing, null = the hole's own dip direction
  const [corridor, setCorridor] = useState<number>(250);         // the section takes holes within this many metres of its line
  const q = useQuery({ queryKey: ["core-trace", key, km], queryFn: () => coreScan.trace(key as string, km), enabled: !!key, staleTime: 10 * 60_000 });
  const host = useRef<HTMLDivElement>(null);
  // the spectral logs (1 m) behind the mineral colouring: this hole's, and the neighbours' when they are coloured
  const sq = useQuery({ queryKey: ["core-spectral-whole", key, 0.1], queryFn: () => coreScan.spectralLog(key as string, 0.1), enabled: !!key, staleTime: 60 * 60_000, retry: false });
  const nearKeys = useMemo(() => (q.data?.nearby ?? []).slice(0, NEIGHBOUR_LOGS).map((n) => n.key), [q.data]);
  const nearStep: 1 | 0.1 = nearKeys.length <= FINE_NEIGHBOURS ? 0.1 : 1;
  const nq = useQueries({ queries: nearKeys.map((k) => ({ queryKey: ["core-spectral-whole", k, nearStep], queryFn: () => coreScan.spectralLog(k, nearStep), staleTime: 60 * 60_000, retry: false })) });
  const nearStamp = nq.map((r) => r.dataUpdatedAt).join(",");                 // useQueries hands back a new array each render; redraw only when a log arrives
  const nearLogs = useMemo(() => new Map(nearKeys.map((k, i) => [k, nq[i]?.data])), [nearKeys, nearStamp]);  // eslint-disable-line react-hooks/exhaustive-deps
  // the holes' own logs (the hole panel's record) for the logged-rock colouring: this hole's always, to know whether it has one
  const hq = useQuery({ queryKey: ["core-hole", key], queryFn: () => coreScan.hole(key as string), enabled: !!key, staleTime: 10 * 60_000 });
  const hasRock = (hq.data?.metres.lith ?? []).some(Boolean);
  const paint: Paint = chosen ?? (hasRock ? "rock" : "swir");
  const rockKeys = paint === "rock" ? nearKeys.slice(0, FINE_NEIGHBOURS) : [];
  const rq = useQueries({ queries: rockKeys.map((k) => ({ queryKey: ["core-hole", k], queryFn: () => coreScan.hole(k), staleTime: 10 * 60_000, retry: false })) });
  const rockStamp = rq.map((r) => r.dataUpdatedAt).join(",");
  const rockLogs = useMemo(() => new Map(rockKeys.map((k, i) => [k, rq[i]?.data])), [rockKeys, rockStamp]);  // eslint-disable-line react-hooks/exhaustive-deps
  const mainMix = useMemo(() => (paint === "rock" ? logged(hq.data) : mixed(sq.data, paint)), [hq.data, sq.data, paint]);
  // every hole's colouring by key, for the 3D view and the section alike
  const mixOf = useMemo(() => (k: string): Mix => (k === key ? mainMix : paint === "rock" ? logged(rockLogs.get(k)) : mixed(nearLogs.get(k), paint)), [key, mainMix, paint, rockLogs, nearLogs]);
  const mainGroups = mainMix.rank;                                // the groups this hole shows, most core first, for the key
  const swatch = (g: string) => (paint === "rock" ? lithColor(g) : groupColor(g));
  const name = (g: string) => (paint === "rock" ? g : groupName(g));

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
        const mix = mixOf(t.key);
        const P = coloured ? fine(t.points) : t.points;
        // a piece with no colour (not scanned, or nothing read there) is drawn thin and pale, so it is never mistaken for a pale
        // rock colour such as GSWA's grey for sediments; the coloured line breaks there (Plotly ends a line at a null)
        const C = P.map((p) => mix.colour.get(Math.round(p.m / STEP)) ?? null);
        const V: { p: Trace["points"][number]; c: string | null }[] = coloured ? P.flatMap((p, i) => (i < P.length - 1 ? [{ p, c: C[i] }, { p: P[i + 1], c: C[i] }] : [])) : P.map((p, i) => ({ p, c: C[i] }));
        const scanned = (m: number) => m >= t.depth_min - 0.5 && m <= t.depth_max + 0.5;
        const at = (v: (typeof V)[number], want: boolean) => (coloured && (v.c !== null) !== want ? null : v.p);
        const xyz = (want: boolean) => ({ x: V.map((v) => { const p = at(v, want); return p && p.e + dx; }), y: V.map((v) => { const p = at(v, want); return p && p.n + dy; }), z: V.map((v) => { const p = at(v, want); return p && p.u + dz; }) });
        const hover = { hovertemplate: `${t.name}${main ? "" : ` · ${t.km} km`}<br>%{text}<extra></extra>`,
          text: V.map((v) => `${v.p.m.toFixed(1)} m${coloured ? `<br>${mix.text.get(Math.round(v.p.m / STEP)) ?? (scanned(v.p.m) ? "no reading" : "not scanned")}` : ""}${!main && t.target ? `<br>drilled for ${t.target}` : ""}${!main && t.n_again ? `<br>look again: ${t.n_again} intervals` : ""}`),
          customdata: V.map((v) => [t.key, v.p.m]), showlegend: false };
        // this hole wears a dark halo under its colours, so it stands out among coloured neighbours in the wide view
        if (main) traces.push({ type: "scatter3d", mode: "lines", ...xyz(true), line: { color: "#0f172a", width: 22 }, opacity: 0.9, hoverinfo: "skip", showlegend: false });
        if (coloured) traces.push({ type: "scatter3d", mode: "lines", ...xyz(true), line: { color: V.map((v) => v.c ?? NO), width: main ? 14 : 5 }, ...hover, opacity: main ? 1 : 0.85 });
        traces.push({ type: "scatter3d", mode: "lines", ...xyz(false), line: { color: "#cbd5e1", width: main ? 4 : 2 }, ...hover, opacity: 0.9 });
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
      // the ground: a faint square at this collar's level, spanning every hole drawn
      const all = [d.hole, ...d.nearby].flatMap((t) => { const { dx, dy } = rel(t); return t.points.map((p) => ({ e: p.e + dx, n: p.n + dy })); });
      const ex = all.map((p) => p.e), ny = all.map((p) => p.n);
      const x0 = Math.min(...ex) - 50, x1 = Math.max(...ex) + 50, y0 = Math.min(...ny) - 50, y1 = Math.max(...ny) + 50;
      traces.push({ type: "mesh3d", x: [x0, x1, x1, x0], y: [y0, y0, y1, y1], z: [0, 0, 0, 0], i: [0, 0], j: [1, 2], k: [2, 3], color: "#cbd5e1", opacity: 0.2, hoverinfo: "skip", showlegend: false, name: "ground" });
      // the view fits every hole at true proportions, seen from the south-east and a little above
      const axis = (title: string) => ({ title: { text: title }, gridcolor: "#e2e8f0", zerolinecolor: "#cbd5e1" });
      const layout = {
        margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: "rgba(0,0,0,0)", showlegend: false,
        scene: { aspectmode: "data", xaxis: axis("east (m)"), yaxis: axis("north (m)"), zaxis: axis(c0.rl !== null ? "up (m, from this collar)" : "up (m)"),
          camera: { eye: { x: 0.75, y: -0.9, z: 0.45 } }, bgcolor: "#f8fafc" },
      };
      await Plotly.react(el, traces, layout, { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["toImage"] });
      (el as any).on?.("plotly_click", (ev: any) => {
        const cd = ev.points?.[0]?.customdata; if (!cd) return;
        const [k, m, f, t] = cd as [string, number, number?, number?];
        router.push(`/map?hole=${encodeURIComponent(k)}&full=1${f !== undefined && t !== undefined ? `&tab=window&w=${f}-${t}` : `&m=${Math.floor(m)}`}`);
      });
    })();
    return () => { gone = true; };
  }, [q.data, colourAll, router, mixOf, view]);

  const d: TraceView | undefined = q.data;
  const presets = [["N–S", 0, "The line runs north–south: look at the holes from the east or west"], ["NE–SW", 45, "The line runs north-east to south-west"], ["E–W", 90, "The line runs east–west: look at the holes from the north or south"], ["NW–SE", 135, "The line runs north-west to south-east"]] as const;
  return (
    <div className="fixed inset-0 bg-slate-100">
      {view === "3d" ? <div ref={host} className="absolute inset-0" /> : d && (
        <Section d={d} mixOf={mixOf} colourAll azimuth={azimuth} corridor={corridor} onAzimuth={setAzimuth}
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
        <div className="pointer-events-auto"><Pill value={view} onChange={setView} items={[["3d", "3D", "The holes as lines in space, to turn and zoom"], ["section", "Section", "A vertical slice through this collar: the nearby holes projected onto one plane, as a geologist draws a cross-section"]] as const} label="View" /></div>
        <div className="pointer-events-auto"><Pill value={km} onChange={setKm} items={RINGS.map((r) => [r, `${r} km`, `Draw the scanned holes within ${r} km of this collar`] as const)} label="Neighbours within" /></div>
        <div className="pointer-events-auto"><Pill value={paint} onChange={setChosen} items={[
          ...(hasRock ? [["rock", "Logged rock", "Colour by the rock type the company geologist logged, in GSWA's map colours: the way a drillhole is usually drawn"] as const] : []),
          ["swir", "SWIR minerals", "Colour by the SWIR reading: clays, micas, chlorite, carbonate (the alteration minerals), in TSG's colours"], ["tir", "TIR minerals", "Colour by the TIR reading: quartz, feldspars, pyroxene, garnet (the rock-forming minerals), in TSG's colours"]] as const} label="Coloured by" /></div>
        {view === "section" && (
          <>
            <div className={cn(glass, "pointer-events-auto flex h-11 items-center gap-1 rounded-full p-1")} role="group" aria-label="Section line">
              <span className="grid size-9 place-items-center text-slate-500" data-keytip="Which way the section line runs through this collar: the slice is the vertical plane along it"><Compass size={16} /></span>
              <button type="button" aria-pressed={azimuth === null} onClick={() => setAzimuth(null)} data-keytip="The line runs the way this hole leans, so the hole lies flat in the slice and shows its true dip"
                className={cn("flex h-9 items-center rounded-full px-3 text-sm font-semibold", azimuth === null ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>Along the dip</button>
              {presets.map(([l, a, t]) => <button key={l} type="button" aria-pressed={azimuth === a} onClick={() => setAzimuth(a)} data-keytip={t} className={cn("flex h-9 items-center rounded-full px-3 text-sm font-semibold", azimuth === a ? "bg-ink text-white" : "text-slate-600 hover:text-slate-900")}>{l}</button>)}
              <input type="range" min={0} max={179} value={azimuth ?? 0} onChange={(e) => setAzimuth(Number(e.target.value))} className="mx-1 w-20 accent-ink" aria-label="Bearing" data-keytip="Any bearing, 0° (north) to 179°: turn the slice to look at the holes from another side" />
              <span className="w-9 pr-2 text-right font-mono text-xs text-slate-600" data-keytip="The line's bearing, clockwise from north">{azimuth === null ? "dip" : `${azimuth}°`}</span>
            </div>
            <div className="pointer-events-auto"><Pill value={corridor} onChange={setCorridor} items={[[100, "±100 m"], [250, "±250 m"], [500, "±500 m"], [2000, "±2 km"]] as const} label="Holes within the corridor" icon={<Ruler size={16} />}
              tip="How far either side of the line a hole may sit and still be drawn in the slice. A hole off the line is projected onto it and drawn fainter; a wide corridor shows more holes but flattens the gaps between them" /></div>
          </>
        )}
      </div>
      <KeyTips />
      {/* the key, as on the map: the groups this hole shows, the marks, and what the view is */}
      {d && (
        <aside aria-label="Key" className={cn(glass, "absolute right-3 bottom-3 z-10 w-[300px] max-w-[calc(100vw-24px)] overflow-hidden bg-white/90")}>
          <div className="flex items-center gap-2 border-b border-white/75 py-2 pr-3 pl-4">
            <b className="font-display text-sm font-bold tracking-tight">{paint === "rock" ? "Logged rock" : `${paint.toUpperCase()} mineral groups`}</b>
            <span className="ml-auto text-[11.5px] whitespace-nowrap text-slate-500">{paint === "rock" ? "GSWA colours, per metre" : "TSG colours, every 10 cm"}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-2.5 text-xs text-slate-700">
            {mainGroups.slice(0, 12).map((g) => <span key={g} className="flex items-center gap-1.5"><i className="inline-block size-3 flex-none rounded-[3px] border border-slate-900/10" style={{ background: swatch(g) }} />{name(g)}</span>)}
            {paint !== "rock" && sq.isError && <span className="col-span-2 text-amber-700">No spectral log for this hole: it is drawn grey.</span>}
          </div>
          <div className="flex flex-col gap-1 border-t border-white/75 px-4 py-2 text-xs text-slate-700">
            <span className="flex items-center gap-1.5"><i className="inline-block h-1.5 w-4 rounded-full bg-ink" />this hole, with a dark edge</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-1 w-4 rounded-full bg-slate-300" />not scanned, or nothing read there (thin)</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-1.5 w-4 rounded-full bg-violet-700" />stands out from its surroundings</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-1.5 w-4 rounded-full" style={{ background: SERIES.orange }} />model disagrees with the log</span>
          </div>
          <p className="border-t border-white/75 px-4 py-2 text-[11px] leading-relaxed text-slate-500">
            {paint === "rock" ? "Colours are the rock types in the hole's own log, mapped to GSWA's rock families in the colours of GSWA's bedrock map; a neighbour without a log is grey." : "Colours are the HyLogger data itself: the mineral groups TSG read in each 10 cm, their standard colours mixed by share."} True proportions, no vertical exaggeration.{" "}
            {view === "3d" ? "Drag to turn, scroll to zoom." : "A vertical section through this collar along the line; holes within the corridor are projected onto it, fainter the further off the line. Drag to pan, scroll to zoom, double-click to reset."} Click a point to open that depth on the map.
          </p>
        </aside>
      )}
    </div>
  );
}
