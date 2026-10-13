"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { coreScan, type Trace, type TraceView } from "@/lib/coreScan";
import { coreTypeColor, SERIES } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const glass = "rounded-2xl border border-white/60 bg-white/85 shadow-glass backdrop-blur-xl";
const RINGS = [2, 5, 10] as const;

/** A hole and its neighbours as lines in space, in metres from this hole's collar (east, north, up). The hole is
 * coloured by the core type the model read every 2 m; the neighbours are grey, or coloured when "colour all" is on;
 * the flagged metres and the log disagreements are drawn thick. A click on a point opens that depth on the map. */
export function Scene() {
  const sp = useSearchParams(); const router = useRouter();
  const key = sp.get("hole"); const [km, setKm] = useState<number>(Number(sp.get("km")) || 2);
  const [colourAll, setColourAll] = useState(false);
  const q = useQuery({ queryKey: ["core-trace", key, km], queryFn: () => coreScan.trace(key as string, km), enabled: !!key, staleTime: 10 * 60_000 });
  const host = useRef<HTMLDivElement>(null);
  const names = useMemo(() => new Map((q.data?.core_types ?? []).map((c) => [c.k, c.name])), [q.data]);

  useEffect(() => {
    const d = q.data; const el = host.current; if (!d || !el) return;
    let gone = false;
    (async () => {
      const Plotly = (await import("plotly.js-dist-min")).default as any;
      if (gone) return;
      const c0 = d.hole.collar; const mlat = 111_320, mlon = 111_320 * Math.cos((c0.lat * Math.PI) / 180);
      // every hole in metres from this hole's collar; heights from RL when both have one, else from the hole's own collar
      const rel = (t: Trace) => { const dx = (t.collar.lon - c0.lon) * mlon, dy = (t.collar.lat - c0.lat) * mlat, dz = t.collar.rl !== null && c0.rl !== null ? t.collar.rl - c0.rl : 0; return { dx, dy, dz }; };
      const traces: any[] = [];
      const line = (t: Trace, main: boolean) => {
        const { dx, dy, dz } = rel(t); const P = t.points;
        if (main || colourAll) {
          // one segment per run of the same core type, so each keeps its colour
          let i = 0;
          while (i < P.length - 1) {
            let j = i + 1; while (j < P.length - 1 && P[j].k === P[i].k) j++;
            const seg = P.slice(i, j + 1); const k = P[i].k;
            traces.push({ type: "scatter3d", mode: "lines", x: seg.map((p) => p.e + dx), y: seg.map((p) => p.n + dy), z: seg.map((p) => p.u + dz),
              line: { color: k === null ? "#94a3b8" : coreTypeColor(names.get(k)), width: main ? 9 : 4 }, hovertemplate: `${t.name}<br>%{text} m<br>${k === null ? "no reading" : names.get(k) ?? ""}<extra></extra>`,
              text: seg.map((p) => p.m.toFixed(0)), customdata: seg.map((p) => [t.key, p.m]), showlegend: false, opacity: main ? 1 : 0.85 });
            i = j;
          }
        } else {
          traces.push({ type: "scatter3d", mode: "lines", x: P.map((p) => p.e + dx), y: P.map((p) => p.n + dy), z: P.map((p) => p.u + dz), line: { color: "#94a3b8", width: 3 },
            hovertemplate: `${t.name} · ${t.km} km<br>%{text} m${t.target ? `<br>drilled for ${t.target}` : ""}${t.n_again ? `<br>look again: ${t.n_again} intervals` : ""}<extra></extra>`,
            text: P.map((p) => p.m.toFixed(0)), customdata: P.map((p) => [t.key, p.m]), showlegend: false, opacity: 0.7 });
        }
        // the collar, labelled
        traces.push({ type: "scatter3d", mode: "markers+text", x: [dx], y: [dy], z: [dz], text: [t.name], textposition: "top center", textfont: { size: main ? 12 : 10, color: main ? "#0f172a" : "#475569" },
          marker: { size: main ? 5 : 3, color: main ? "#0f172a" : "#64748b" }, hoverinfo: "skip", showlegend: false });
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
      const layout = {
        margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: "rgba(0,0,0,0)", showlegend: false,
        scene: { aspectmode: "data", xaxis: { title: { text: "east (m)" }, gridcolor: "#e2e8f0", zerolinecolor: "#cbd5e1" }, yaxis: { title: { text: "north (m)" }, gridcolor: "#e2e8f0", zerolinecolor: "#cbd5e1" },
          zaxis: { title: { text: c0.rl !== null ? "up (m, from this collar)" : "up (m)" }, gridcolor: "#e2e8f0", zerolinecolor: "#cbd5e1" }, camera: { eye: { x: 0.75, y: -0.9, z: 0.45 } }, bgcolor: "#f8fafc" },
      };
      await Plotly.react(el, traces, layout, { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["toImage"] });
      (el as any).on?.("plotly_click", (ev: any) => {
        const cd = ev.points?.[0]?.customdata; if (!cd) return;
        const [k, m, f, t] = cd as [string, number, number?, number?];
        router.push(`/map?hole=${encodeURIComponent(k)}&full=1${f !== undefined && t !== undefined ? `&tab=window&w=${f}-${t}` : `&m=${Math.floor(m)}`}`);
      });
    })();
    return () => { gone = true; };
  }, [q.data, colourAll, names, router]);

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
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600"><input type="checkbox" checked={colourAll} onChange={(e) => setColourAll(e.target.checked)} className="size-3 accent-slate-900" />colour the neighbours too</label>
        {q.isPending && <span className="text-[11px] text-slate-500">Loading…</span>}
        {q.isError && <span className="text-[11px] text-rose-700">This hole has no collar position.</span>}
      </div>
      {d && (
        <div className={cn(glass, "absolute bottom-3 left-3 z-10 max-w-[360px] px-3 py-2 text-[11px] text-slate-600")}>
          <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1">
            {[...new Set(d.hole.points.map((p) => p.k).filter((k): k is number => k !== null))].slice(0, 8).map((k) => <span key={k} className="flex items-center gap-1"><i className="inline-block size-2.5 rounded-[2px]" style={{ background: coreTypeColor(names.get(k)) }} />{names.get(k)}</span>)}
          </div>
          <div className="flex flex-wrap gap-x-3"><span className="flex items-center gap-1"><i className="inline-block h-1.5 w-4 rounded" style={{ background: SERIES.orange }} />model disagrees with the log</span><span className="flex items-center gap-1"><i className="inline-block h-1.5 w-4 rounded bg-violet-700" />stands out from its surroundings</span><span className="flex items-center gap-1"><i className="inline-block h-1 w-4 rounded bg-slate-400" />neighbour</span></div>
          <p className="mt-1 text-slate-400">Drag to turn, scroll to zoom. Click a point to open that depth on the map.</p>
        </div>
      )}
    </div>
  );
}
