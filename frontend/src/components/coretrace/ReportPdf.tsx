"use client";

// A report opened by the assistant, read in place: pdf.js over the platform's same-origin,
// range-capable stream, so a 40 MB WAMEX report shows its first page at once and fetches the
// rest as the reader scrolls. Pages are rasterised only near the viewport and released again
// when they drift away, so a long report costs what is on screen, not the whole document.

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import { PLATFORM_URL } from "@ntlp/geodata-web/fetch";
import { cn } from "@/lib/utils";

export type ReportPdfProps = { url: string; title: string; page?: number; subtitle?: string };

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void>; cancel: () => void } };

const AHEAD = 600;   // px outside the viewport that still get drawn

export function ReportPdf({ url, title, page: openAt, subtitle }: ReportPdfProps) {
  const src = url.startsWith("http") ? url : `${PLATFORM_URL}${url}`;
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(0);
  const [current, setCurrent] = useState(openAt ?? 1);
  const [full, setFull] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hosts = useRef(new Map<number, HTMLDivElement>());
  const drawn = useRef(new Map<number, number>());
  const tasks = useRef(new Map<number, { cancel: () => void }>());
  const jumped = useRef(false);
  const scale = fit ? Math.min(3, Math.max(0.3, fit * zoom)) : 0;

  // load, then measure every page so the column has its true height
  useEffect(() => {
    let dead = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDoc(null); setDims([]); setError(null); drawn.current.clear(); jumped.current = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const d = (await pdfjs.getDocument({ url: src, withCredentials: false }).promise) as unknown as PdfDoc;
        if (dead) return;
        const first = (await d.getPage(1)).getViewport({ scale: 1 });
        if (dead) return;
        setDims(Array.from({ length: d.numPages }, () => ({ w: first.width, h: first.height })));
        setDoc(d);
        for (let n = 2; n <= d.numPages; n++) {
          const v = (await d.getPage(n)).getViewport({ scale: 1 });
          if (dead) return;
          setDims((prev) => { if (prev[n - 1]?.w === v.width && prev[n - 1]?.h === v.height) return prev; const next = [...prev]; next[n - 1] = { w: v.width, h: v.height }; return next; });
        }
      } catch (e) { if (!dead) setError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { dead = true; };
  }, [src]);

  // fit to the pane's width, and follow it
  useEffect(() => {
    const el = scrollRef.current; if (!el || !dims.length) return;
    const measure = () => { const avail = el.clientWidth - 20; if (avail > 0) setFit((c) => { const n = Math.min(2, Math.max(0.3, avail / dims[0].w)); return Math.abs(c - n) < 0.01 ? c : n; }); };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, [dims]);
  useEffect(() => { drawn.current.clear(); }, [scale]);

  const render = useCallback(async (n: number) => {
    const host = hosts.current.get(n); if (!doc || !host || !scale || drawn.current.get(n) === scale) return;
    drawn.current.set(n, scale);
    try {
      const p = await doc.getPage(n); const canvas = host.querySelector("canvas");
      if (!canvas || drawn.current.get(n) !== scale) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1); const vp = p.getViewport({ scale: scale * dpr });
      canvas.width = vp.width; canvas.height = vp.height; canvas.style.width = `${vp.width / dpr}px`; canvas.style.height = `${vp.height / dpr}px`;
      tasks.current.get(n)?.cancel();
      const task = p.render({ canvasContext: canvas.getContext("2d"), viewport: vp }); tasks.current.set(n, task);
      try { await task.promise; } finally { if (tasks.current.get(n) === task) tasks.current.delete(n); }
    } catch { drawn.current.delete(n); }
  }, [doc, scale]);
  const release = useCallback((n: number) => {
    const c = hosts.current.get(n)?.querySelector("canvas"); if (!c) return;
    tasks.current.get(n)?.cancel(); c.width = 0; c.height = 0; drawn.current.delete(n);
  }, []);

  // draw what is near the viewport, release what is far from it, track the page in view
  useEffect(() => {
    const el = scrollRef.current; if (!el || !doc || !scale) return;
    let raf = 0;
    const sweep = () => {
      raf = 0; const top = el.scrollTop, bottom = top + el.clientHeight; let best = 1, bestOverlap = -1;
      for (const [n, host] of hosts.current) {
        const y0 = host.offsetTop, y1 = y0 + host.offsetHeight;
        if (y1 >= top - AHEAD && y0 <= bottom + AHEAD) void render(n); else if (y1 < top - 4 * AHEAD || y0 > bottom + 4 * AHEAD) release(n);
        const overlap = Math.min(y1, bottom) - Math.max(y0, top); if (overlap > bestOverlap) { bestOverlap = overlap; best = n; }
      }
      setCurrent(best);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(sweep); };
    el.addEventListener("scroll", onScroll); sweep();
    return () => { el.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [doc, scale, dims, render, release]);

  // the page the assistant cited, once the column has its sizes
  useEffect(() => {
    if (jumped.current || !openAt || !scale || !dims.length) return;
    const host = hosts.current.get(openAt); const el = scrollRef.current; if (!host || !el) return;
    jumped.current = true; el.scrollTop = host.offsetTop - 6;
  }, [openAt, scale, dims]);

  const n = doc?.numPages ?? 0;
  const go = (p: number) => { const host = hosts.current.get(Math.min(n, Math.max(1, p))); const el = scrollRef.current; if (host && el) el.scrollTop = host.offsetTop - 6; };
  const frame = (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white", full ? "fixed inset-3 z-50 shadow-2xl" : "h-[460px] w-full")}>
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-2.5 py-1.5 text-xs">
        <div className="min-w-0 flex-1"><div className="truncate font-semibold text-slate-900">{title}</div>{subtitle && <div className="truncate text-[11px] text-slate-500">{subtitle}</div>}</div>
        {n > 0 && <span className="font-mono text-[11px] text-slate-500"><input type="number" min={1} max={n} value={current} onChange={(e) => go(Number(e.target.value))} className="w-10 rounded border border-slate-200 px-1 text-right" aria-label="Page" /> / {n}</span>}
        <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))} aria-label="Zoom out" className="grid size-6 place-items-center rounded hover:bg-white"><Minus size={13} /></button>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z * 1.25))} aria-label="Zoom in" className="grid size-6 place-items-center rounded hover:bg-white"><Plus size={13} /></button>
        <a href={src} target="_blank" rel="noopener" aria-label="Open in a new tab" className="grid size-6 place-items-center rounded hover:bg-white"><ExternalLink size={13} /></a>
        <button type="button" onClick={() => setFull((f) => !f)} aria-label={full ? "Shrink" : "Enlarge"} className="grid size-6 place-items-center rounded hover:bg-white">{full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-slate-200/70 p-2.5">
        {error ? <p className="p-3 text-xs text-red-800">The report could not be opened: {error}</p>
        : !doc ? <p className="flex items-center gap-2 p-3 text-xs text-slate-600"><Loader2 size={13} className="animate-spin" />Opening the report…</p>
        : dims.map((d, i) => (
          <div key={i} ref={(el) => { if (el) hosts.current.set(i + 1, el); else hosts.current.delete(i + 1); }} className="mx-auto mb-2.5 bg-white shadow-sm" style={{ width: d.w * scale, height: d.h * scale }}>
            <canvas className="block" />
          </div>))}
      </div>
    </div>);
  return full ? <>{<div className="fixed inset-0 z-40 bg-black/40" onClick={() => setFull(false)} />}{frame}</> : frame;
}
