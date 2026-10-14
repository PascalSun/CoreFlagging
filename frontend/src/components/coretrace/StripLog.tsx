"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Metres, ModelView } from "@/lib/coreScan";
import { GRID, INK, MUTED, SERIES, coreTypeColor, fmt, groupColor, groupName, lithColor, pct } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";
import { DepthNav } from "@/components/coretrace/DepthNav";
import { ColourNote } from "@/components/coretrace/ColourNote";
import { LEVELS, MIN_SPAN, fmtSpan, levelOf, windowAbout, windowAt } from "@/lib/depth";

type Track = { id: string; label: string; w: number; kind: "cat" | "bar" };
const AXIS_W = 44, GAP = 6, HEAD_H = 30, NAV_W = 30;

/** The hole from top to bottom, one row per metre, drawn to depth. Categorical tracks say
 * what the core is (software minerals, logged rock, the model's core type); bar tracks say
 * how much (how unusual, how likely gold, the assay). Each track has its own scale — they
 * sit side by side, never on a shared axis. Hover reads a metre, click selects it. */
export function StripLog({ metres, model, cursor, onCursor, onHover, hasLith, hasAu, range, onRange }: {
  metres: Metres; model: ModelView | undefined; cursor: number | null; onCursor: (m: number) => void; onHover?: (m: number | null) => void; hasLith: boolean; hasAu: boolean;
  /** draw to this depth range instead of the hole's own: two logs side by side share one axis, or the reader has zoomed in */
  range?: [number, number];
  /** when set, the log can be zoomed: the wheel over it and the level buttons change the range (null = whole hole) */
  onRange?: (r: [number, number] | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [boxH, setBoxH] = useState(480);
  const [zoom, setZoom] = useState<"fit" | 4 | 12>("fit");
  const [hover, setHover] = useState<number | null>(null);
  const hole0 = metres.m[0] ?? 0, hole1 = (metres.m[metres.m.length - 1] ?? 0) + 1;

  // What is drawn is `view`, which glides to `range` when the window jumps (a level button, a link, the
  // minimap) and follows it at once when it moves a little (the wheel, a drag), so the eye keeps its place.
  const target = useMemo<[number, number]>(() => range ?? [hole0, hole1], [range, hole0, hole1]);
  const [view, setView] = useState<[number, number]>(target);
  const viewRef = useRef(view); const anim = useRef(0);
  useEffect(() => {
    const from = viewRef.current, to = target;
    if (from[0] === to[0] && from[1] === to[1]) return;
    cancelAnimationFrame(anim.current);
    const s0 = from[1] - from[0], s1 = to[1] - to[0], c0 = (from[0] + from[1]) / 2, c1 = (to[0] + to[1]) / 2;
    const small = Math.abs(c1 - c0) < s0 * 0.6 && Math.max(s0, s1) / Math.min(s0, s1) < 1.6;
    if (small || typeof requestAnimationFrame === "undefined") { viewRef.current = to; setView(to); return; }
    const t0 = performance.now(), dur = 320;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      const sp = Math.exp(Math.log(s0) + (Math.log(s1) - Math.log(s0)) * e), c = c0 + (c1 - c0) * e;   // even in log-span: a 100× zoom reads as a steady dive
      const v: [number, number] = p >= 1 ? to : [c - sp / 2, c + sp / 2];
      viewRef.current = v; setView(v);
      if (p < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(anim.current);
  }, [target]);

  // the wheel and a pinch zoom about the depth under the pointer, smoothly; the window is told after a pause
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomAt = (depth: number, factor: number) => {
    if (!onRange) return;
    const [a, b] = viewRef.current; const span = b - a; const ns = Math.max(MIN_SPAN, Math.min(hole1 - hole0, span * factor));
    const f = (depth - a) / span; let na = depth - f * ns; na = Math.max(hole0, Math.min(hole1 - ns, na));
    const v: [number, number] = ns >= hole1 - hole0 - 1e-6 ? [hole0, hole1] : [na, na + ns];
    viewRef.current = v; setView(v);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => { const [x, y] = viewRef.current; onRange(y - x >= hole1 - hole0 - 1e-6 ? null : [Math.round(x * 10) / 10, Math.round(y * 10) / 10]); }, 120);
  };
  const centre = cursor !== null && (cursor + 0.5 >= view[0] && cursor + 0.5 <= view[1]) ? cursor + 0.5 : (view[0] + view[1]) / 2;
  const toLevel = (id: string) => onRange?.(windowAt(id, centre, hole0, hole1));
  const stepLevel = (dir: -1 | 1) => { const i = LEVELS.findIndex((l) => l.id === levelOf(range ?? null)); const j = Math.max(0, Math.min(LEVELS.length - 1, i + dir)); if (j !== i) toLevel(LEVELS[j].id); };
  const pan = (frac: number) => { if (!onRange || !range) return; const s = range[1] - range[0]; onRange(windowAbout((range[0] + range[1]) / 2 + s * frac, s, hole0, hole1)); };
  const pinch = useRef<number | null>(null);

  const tracks = useMemo<Track[]>(() => [
    { id: "gs", label: "SWIR", w: 22, kind: "cat" }, { id: "gt", label: "TIR", w: 22, kind: "cat" },
    ...(hasLith ? [{ id: "lith", label: "Rock", w: 22, kind: "cat" } as Track] : []),
    ...(model ? [{ id: "core", label: "Type", w: 30, kind: "cat" } as Track, { id: "anom", label: "Unusual", w: 54, kind: "bar" } as Track,
      { id: "gold", label: "Gold", w: 54, kind: "bar" } as Track] : []),
    ...(hasAu ? [{ id: "au", label: "Au ppm", w: 46, kind: "bar" } as Track] : []),
  ], [hasLith, hasAu, model]);
  const width = AXIS_W + tracks.reduce((a, t) => a + t.w + GAP, 0);

  // a zoomed range runs from its start to its end; the whole hole from its first metre to its last (inclusive)
  const m0 = view[0], m1 = view[1] - 1, span = view[1] - view[0];
  const ppm = zoom === "fit" ? Math.max(0.6, (boxH - 8) / span) : zoom;
  const height = Math.ceil(span * ppm);
  const idx = useMemo(() => new Map(metres.m.map((m, i) => [m, i])), [metres.m]);
  const midx = useMemo(() => new Map((model?.m ?? []).map((m, i) => [m, i])), [model]);
  const typeName = useMemo(() => new Map((model?.core_types ?? []).map((c) => [c.k, c.name])), [model]);
  const auMax = useMemo(() => Math.max(0.5, ...metres.au.map((v) => v ?? 0)), [metres.au]);
  const rawTop = model ? Math.max(model.anomaly.flag_raw * 1.4, 1e-6) : 1;
  const flagged = (i: number) => !!model && model.anom_raw[i] >= model.anomaly.flag_raw && model.anom[i] >= model.anomaly.flag_at;

  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setBoxH(el.clientHeight));
    ro.observe(el); setBoxH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 16000 / Math.max(height, 1));
    cv.width = Math.round(width * dpr); cv.height = Math.round(height * dpr);
    const g = cv.getContext("2d"); if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, width, height);
    const rowH = Math.max(ppm, 1 / dpr);
    // depth axis: a tick every 10 / 50 / 100 m, whichever leaves room for the label
    const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => s * ppm >= 34) ?? 500;
    g.font = "10px var(--font-geist-mono), ui-monospace, monospace"; g.textAlign = "right"; g.textBaseline = "middle";
    for (let d = Math.ceil(m0 / step) * step; d <= m1 + 1; d += step) {
      const y = (d - m0) * ppm;
      g.fillStyle = GRID; g.fillRect(AXIS_W - 4, Math.round(y), width - AXIS_W + 4, 1);
      g.fillStyle = MUTED; g.fillText(step < 1 ? d.toFixed(1) : String(Math.round(d)), AXIS_W - 8, Math.min(Math.max(y, 6), height - 6));
    }
    let x = AXIS_W;
    for (const t of tracks) {
      if (t.kind === "bar") { g.fillStyle = "#f8fafc"; g.fillRect(x, 0, t.w, height); }
      for (let i = 0; i < metres.m.length; i++) {
        const m = metres.m[i], y = (m - m0) * ppm, j = midx.get(m);
        if (t.id === "gs") { g.fillStyle = groupColor(metres.gs[i]); g.fillRect(x, y, t.w, rowH); }
        else if (t.id === "gt") { g.fillStyle = groupColor(metres.gt[i]); g.fillRect(x, y, t.w, rowH); }
        else if (t.id === "lith") { g.fillStyle = lithColor(metres.lith[i]); g.fillRect(x, y, t.w, rowH); }
        else if (t.id === "au") { const v = metres.au[i]; if (v !== null && v > 0) { g.fillStyle = v >= 0.1 ? INK : "#9ca3af"; g.fillRect(x, y, Math.max(1, Math.min(1, v / auMax) * t.w), rowH); } }
        else if (model && j !== undefined) {
          if (t.id === "core") { g.fillStyle = coreTypeColor(typeName.get(model.core[j])); g.fillRect(x, y, t.w, rowH); }
          else if (t.id === "anom") { g.fillStyle = flagged(j) ? SERIES.orange : "#9ca3af"; g.fillRect(x, y, Math.max(1, Math.min(1, model.anom_raw[j] / rawTop) * t.w), rowH); }
          else if (t.id === "gold") { g.fillStyle = SERIES.blue; g.fillRect(x, y, Math.max(1, model.gold[j] * t.w), rowH); }
        }
      }
      if (t.id === "core" && model) {            // the auto log: a line at every boundary the model drew
        g.fillStyle = INK;
        for (const s of model.segments) { const y = (s.from_m - m0) * ppm; if (y > 0.5) g.fillRect(x - 2, Math.round(y), t.w + 4, 1); }
      }
      x += t.w + GAP;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metres, model, tracks, width, height, ppm, m0, m1, auMax, rawTop]);

  // keep the selected metre in view: it may be set from a link, a table row or another tab
  useEffect(() => {
    const el = wrapRef.current; if (!el || cursor === null) return;
    const y = (cursor - m0) * ppm;
    if (y < el.scrollTop + 20 || y > el.scrollTop + el.clientHeight - 20) el.scrollTo({ top: Math.max(0, y - el.clientHeight / 3) });
  }, [cursor, m0, ppm]);

  const at = (clientY: number): number | null => {
    const cv = canvasRef.current; if (!cv) return null;
    const m = Math.floor((clientY - cv.getBoundingClientRect().top) / ppm) + m0;
    if (m < m0 || m > m1) return null;
    if (idx.has(m)) return m;
    for (let k = 1; k <= 6; k++) { if (idx.has(m - k)) return m - k; if (idx.has(m + k)) return m + k; }   // inside a gap: the nearest metre that has core
    return null;
  };
  const tipM = hover; const ti = tipM !== null ? idx.get(tipM) : undefined; const tj = tipM !== null ? midx.get(tipM) : undefined;

  return (
    // as wide as the log and no wider: the readout's single-line text would otherwise widen the column
    // to fit the metre under the pointer, and push the panel beside it sideways as you hover
    <div className="flex h-full min-h-0 flex-col" style={{ width: Math.max(width + (onRange ? NAV_W : 0), 236) }}>
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="text-[11px] font-medium text-slate-500">Depth (m)</span>
        {onRange ? (
          <div className="flex items-center gap-1" role="group" aria-label="Depth window">
            <button type="button" onClick={() => stepLevel(-1)} disabled={!range} aria-label="Zoom out a level" title="Zoom out (−)" className="grid h-6 w-6 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30">−</button>
            <span className="min-w-[44px] text-center font-mono text-[11px] text-slate-700" title="The window">{range ? fmtSpan(range[1] - range[0]) : "all"}</span>
            <button type="button" onClick={() => stepLevel(1)} disabled={levelOf(range ?? null) === "10cm"} aria-label="Zoom in a level" title="Zoom in (+)" className="grid h-6 w-6 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30">+</button>
          </div>
        ) : (
          <div className="flex overflow-hidden rounded-md border border-slate-200 text-[11px]" role="group" aria-label="Depth scale">
            {(["fit", 4, 12] as const).map((z) => (
              <button key={String(z)} type="button" onClick={() => setZoom(z)}
                className={cn("px-2 py-0.5", zoom === z ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>
                {z === "fit" ? "Whole hole" : z === 4 ? "4 px/m" : "12 px/m"}
              </button>
            ))}
          </div>
        )}
      </div>
      {onRange && (
        <div className="flex gap-1 pb-2" role="tablist" aria-label="Level">
          {LEVELS.map((l) => { const on = l.id === "hole" ? !range : levelOf(range ?? null) === l.id; return (
            <button key={l.id} type="button" role="tab" aria-selected={on} onClick={() => toLevel(l.id)} className={cn("flex-1 rounded-full px-1.5 py-1 text-[11px] font-medium ring-1 transition-colors", on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:ring-slate-400")}>{l.label}</button>); })}
        </div>)}
      <div className="flex text-[10px] font-medium text-slate-500" style={{ height: HEAD_H, width: width + (onRange ? NAV_W : 0) }}>
        {onRange && <span style={{ width: NAV_W }} />}
        <span style={{ width: AXIS_W }} />
        {tracks.map((t) => (
          <span key={t.id} className="flex items-end justify-center overflow-visible whitespace-nowrap pb-1" style={{ width: t.w + GAP }}>
            <span className={t.kind === "cat" ? "origin-bottom -rotate-45 translate-x-1" : ""}>{t.label}</span>
          </span>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 gap-0">
      {onRange && <div className="flex-none pr-1" style={{ width: NAV_W }}><DepthNav metres={metres} model={model} view={view} hole0={hole0} hole1={hole1} onRange={onRange} typeName={typeName} height={boxH} /></div>}
      <div ref={wrapRef} tabIndex={onRange ? 0 : undefined} className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
        onKeyDown={onRange ? (e) => {
          if (e.key === "+" || e.key === "=") { e.preventDefault(); stepLevel(1); } else if (e.key === "-" || e.key === "_") { e.preventDefault(); stepLevel(-1); }
          else if (e.key === "0" || e.key === "Escape") { e.preventDefault(); onRange(null); }
          else if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); pan(e.key === "PageUp" ? -1 : -0.25); } else if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); pan(e.key === "PageDown" ? 1 : 0.25); }
        } : undefined}>
        <div className="relative" style={{ width, height }}>
          <canvas ref={canvasRef} style={{ width, height, touchAction: onRange ? "pan-y" : undefined }} className="block cursor-crosshair"
            onMouseMove={(e) => { const m = at(e.clientY); setHover(m); onHover?.(m); }} onMouseLeave={() => { setHover(null); onHover?.(null); }}
            onClick={(e) => { const m = at(e.clientY); if (m !== null) onCursor(m); }}
            onDoubleClick={onRange ? (e) => { const cv = canvasRef.current; if (!cv) return; e.preventDefault(); const d = (e.clientY - cv.getBoundingClientRect().top) / ppm + m0; const i = LEVELS.findIndex((l) => l.id === levelOf(range ?? null)); const j = e.shiftKey ? Math.max(0, i - 1) : Math.min(LEVELS.length - 1, i + 1); onRange(windowAt(LEVELS[j].id, d, hole0, hole1)); } : undefined}
            onWheel={onRange ? (e) => { const cv = canvasRef.current; if (!cv) return; e.preventDefault(); const d = (e.clientY - cv.getBoundingClientRect().top) / ppm + m0; zoomAt(d, Math.exp(Math.max(-80, Math.min(80, e.deltaY)) * 0.004)); } : undefined}
            onTouchStart={onRange ? (e) => { if (e.touches.length === 2) pinch.current = Math.abs(e.touches[0].clientY - e.touches[1].clientY); } : undefined}
            onTouchMove={onRange ? (e) => { if (e.touches.length !== 2 || pinch.current === null) return; e.preventDefault(); const cv = canvasRef.current; if (!cv) return; const now = Math.abs(e.touches[0].clientY - e.touches[1].clientY); const mid = (e.touches[0].clientY + e.touches[1].clientY) / 2; zoomAt((mid - cv.getBoundingClientRect().top) / ppm + m0, pinch.current / Math.max(1, now)); pinch.current = now; } : undefined}
            onTouchEnd={onRange ? () => { pinch.current = null; } : undefined} />
          {cursor !== null && cursor >= m0 && cursor <= m1 && (
            <div className="pointer-events-none absolute left-0 border-y border-cyan bg-cyan/20" style={{ top: (cursor - m0) * ppm - 1, height: Math.max(ppm, 2) + 2, width }} />
          )}
          {tipM !== null && ti !== undefined && (
            <div className="pointer-events-none absolute left-0 border-t border-slate-900/60" style={{ top: (tipM - m0) * ppm, width }} />
          )}
        </div>
      </div>
      </div>
      {/* the readout sits below the log, not over it, so it never hides the rows it describes */}
      {/* fixed height and one line per fact: text that wrapped differently from metre to metre changed the
          readout's height, which resized the log above it and made the whole column jump while hovering */}
      <div className="mt-2 h-[86px] flex-none overflow-hidden [@media(pointer:coarse)]:hidden rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] leading-[18px] text-slate-600 [&>div]:truncate">
        {tipM !== null && ti !== undefined ? (
          <>
            <div className="font-semibold text-slate-900">{tipM}–{tipM + 1} m{hasLith && metres.lith_raw[ti] ? <span className="font-normal text-slate-600"> · {metres.lith_raw[ti]}</span> : null}</div>
            <div>SWIR <b className="font-medium text-slate-900">{groupName(metres.gs[ti])}</b> · TIR <b className="font-medium text-slate-900">{groupName(metres.gt[ti])}</b></div>
            {model && tj !== undefined ? (
              <>
                <div title={typeName.get(model.core[tj])}>{typeName.get(model.core[tj]) ?? "—"}</div>
                <div>unusual {pct(model.anom[tj])}{flagged(tj) ? " (flagged)" : ""} · gold {fmt(model.gold[tj])}{metres.au[ti] !== null ? <> · Au {fmt(metres.au[ti], 2)} ppm</> : null}</div>
              </>
            ) : metres.au[ti] !== null ? <div>Au {fmt(metres.au[ti], 2)} ppm</div> : null}
          </>
        ) : <div className="text-slate-400"><span className="[@media(pointer:coarse)]:hidden">{onRange ? "Hover reads a metre, click keeps it. Wheel or double-click to zoom; drag the box at the left to move the window." : "Move over the log to preview a metre on the right. Click to keep it."}</span><span className="hidden [@media(pointer:coarse)]:inline">Tap the log to open a metre.</span></div>}
      </div>
    </div>
  );
}

const Sw = ({ c }: { c: string }) => <span className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: c }} />;

/** What the colours and bars of the strip log mean. */
export function StripLegend({ metres, model, hasLith, hasAu }: { metres: Metres; model: ModelView | undefined; hasLith: boolean; hasAu: boolean }) {
  const groups = useMemo(() => {
    const n = new Map<string, number>();
    for (const g of [...metres.gs, ...metres.gt]) if (g && g !== "INVALID" && g !== "nan") n.set(g, (n.get(g) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [metres]);
  const named = groups.filter((g) => groupColor(g) !== "#d8d2c4").slice(0, 10); const rest = groups.filter((g) => groupColor(g) === "#d8d2c4");
  return (
    <div className="flex flex-col gap-2 text-[11px] text-slate-600">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="font-medium text-slate-900">{model ? "Minerals (SWIR, TIR, Type)" : "Minerals (SWIR, TIR)"}</span>
        {named.map((g) => <span key={g} className="flex items-center gap-1"><Sw c={groupColor(g)} />{groupName(g)}</span>)}
        {rest.length > 0 && <span className="flex items-center gap-1" title={rest.map(groupName).join(", ")}><Sw c="#d8d2c4" />Other ({rest.map(groupName).slice(0, 3).join(", ")}{rest.length > 3 ? "…" : ""})</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {model && <span className="flex items-center gap-1"><span className="inline-block h-px w-3 bg-slate-900" />auto-log boundary</span>}
        {model && <span className="flex items-center gap-1"><Sw c={SERIES.orange} />unusual, flagged</span>}
        {model && <span className="flex items-center gap-1"><Sw c="#9ca3af" />unusual, not flagged</span>}
        {model && <span className="flex items-center gap-1"><Sw c={SERIES.blue} />gold likelihood (0–1)</span>}
        {hasAu && <span className="flex items-center gap-1"><Sw c={INK} />assay ≥ 0.1 ppm</span>}
        {hasLith && <span className="text-slate-400">Rock: logged classes in GSWA map colours, named on hover</span>}
      </div>
      <div className="flex flex-wrap gap-x-2">
        <ColourNote kind="mineral" />{hasLith && <ColourNote kind="rock" />}
      </div>
    </div>
  );
}
