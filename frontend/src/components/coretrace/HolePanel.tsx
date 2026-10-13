"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, Download, ExternalLink, FileDown, FileText, Loader2, Maximize2, Minimize2, Trash2, X } from "lucide-react";
import { downloadReportPdf } from "@/components/coretrace/pdf";
import { PAGE_W, ReportDocument } from "@/components/coretrace/ReportDocument";
import { ACTIVE, abstractParts, coreScan, readDate, reportFileKind, sourceLabel, surveyOf, type CoreModelInfo, type HoleDetail, type HoleReport, type MetreView, type ModelView, type Tray } from "@/lib/coreScan";
import { ISSUE_LABEL, STATUS_LABEL, SERIES, coreTypeColor, fmt, groupColor, groupName, issueLabel, pct } from "@/components/coretrace/palette";
import { LINE, SpectraChart } from "@/components/coretrace/SpectraChart";
import { StripLegend, StripLog } from "@/components/coretrace/StripLog";
import { TrayViewer } from "@/components/coretrace/DeepZoom";
import { TrayPhoto } from "@/components/coretrace/TrayPhoto";
import { cn } from "@/lib/utils";

export type Tab = "metre" | "log" | "unusual" | "gold" | "similar" | "quality" | "report";
const TABS: { id: Tab; label: string }[] = [
  { id: "metre", label: "This metre" }, { id: "log", label: "Auto log" }, { id: "unusual", label: "Unusual" }, { id: "gold", label: "Gold" },
  { id: "similar", label: "Similar core" }, { id: "quality", label: "Data quality" }, { id: "report", label: "Report" },
];

const Fact = ({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) => (
  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
    <div className="text-[11px] text-slate-500">{k}</div>
    <div className="text-sm font-semibold text-slate-900">{v}</div>
    {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
  </div>
);
const H3 = ({ children }: { children: React.ReactNode }) => <h3 className="pb-2 pt-1 font-display text-[15px] font-semibold text-slate-900">{children}</h3>;
const Empty = ({ children }: { children: React.ReactNode }) => <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">{children}</div>;

const kb = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** The exploration report the hole was logged in: what the company wrote, one click from the scan.
 * A document card: the abstract's labelled parts (Location, Geology, Work done, Results…), the first two
 * shown and the rest a click away, the PDF button, and the mirror's other files as chips. */
function OriginalReport({ report, loading }: { report: HoleReport | undefined; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const parts = useMemo(() => (report?.abstract ? abstractParts(report.abstract) : []), [report]);
  const shown = open ? parts : parts.slice(0, 2);
  const others = report?.files.filter((f) => f.download_url !== report.pdf_url) ?? [];
  if (loading) return <p className="text-[11px] text-slate-500">Looking up the report…</p>;
  if (!report) return <p className="text-[11px] text-slate-500">The report is on the mirror but could not be listed right now.</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-3.5 py-2.5">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"><FileText size={18} strokeWidth={1.6} /></span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">Exploration report {report.anumber}</div>
          <div className="text-[11px] text-slate-500">The geologist&rsquo;s own account, lodged with GSWA (WAMEX)</div>
        </div>
      </div>
      {parts.length > 0 && (
        <dl className="flex flex-col gap-2 px-3.5 py-3 text-xs">
          {shown.map((p, i) => (
            <div key={i} className="grid grid-cols-[5.2rem_1fr] gap-x-2">
              <dt className="pt-px text-[11px] font-medium text-slate-500">{p.label || "Abstract"}</dt>
              <dd className={cn("leading-relaxed text-slate-700", !open && "line-clamp-3")}>{p.text}</dd>
            </div>
          ))}
          {parts.length > 2 || parts.some((p) => p.text.length > 200) ? (
            <button type="button" onClick={() => setOpen((o) => !o)} className="self-start text-[11px] font-medium text-slate-700 underline-offset-2 hover:underline">{open ? "Show less" : parts.length > 2 ? `Show all ${parts.length} parts` : "Read in full"}</button>
          ) : null}
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 px-3.5 py-3">
        {report.pdf_url && <a href={report.pdf_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"><ExternalLink size={13} />Open the report</a>}
        {others.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {others.map((f) => (
              <a key={f.name} href={f.download_url} target="_blank" rel="noopener" title={`${f.name} · ${kb(f.bytes)}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900"><Download size={10} />{reportFileKind(f.name)}</a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
const th = "border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-medium text-slate-500";
const td = "border-b border-slate-100 px-2 py-1.5 align-top text-xs text-slate-700";

function save(blob: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const csv = (rows: (string | number | null)[][]) => new Blob(["﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
/** A TSG mineral ("Chlorite-FeMg", "Aspectral") or group ("WHITE-MICA") as a reader would write it. */
const mineralName = (k: string) => (k === "Aspectral" ? "No SWIR response" : k === k.toUpperCase() ? groupName(k) : k.replace(/([a-z])([A-Z])/g, "$1 $2"));
const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, "_");

/** The TSG software's SWIR mineral group down the hole, for a hole no model has read. */
function GroupStrip({ groups }: { groups: string[] }) {
  if (!groups.length) return null;
  const n = Math.min(120, groups.length); const step = groups.length / n;
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-[4px]" role="img" aria-label="SWIR mineral groups from the top of the hole (left) to the bottom (right)">
      {Array.from({ length: n }, (_, i) => groups[Math.floor(i * step)]).map((g, i) => <span key={i} className="h-full flex-1" style={{ background: groupColor(g) }} title={groupName(g)} />)}
    </div>
  );
}

/** Core types down the hole in ~120 steps: the whole hole at a glance. */
function MiniStrip({ strip, model }: { strip: number[]; model: ModelView | undefined }) {
  const name = new Map((model?.core_types ?? []).map((c) => [c.k, c.name]));
  if (!strip.length) return null;
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-[4px]" role="img" aria-label="Core types from the top of the hole (left) to the bottom (right)">
      {strip.map((k, i) => <span key={i} className="h-full flex-1" style={{ background: model ? coreTypeColor(name.get(k)) : "#cbd5e1" }} title={name.get(k)} />)}
    </div>
  );
}

/** A real tray at the top of the summary: the one holding the hole's most unusual interval, so the
 * first thing a reader sees is the core the model singles out. */
/** Every tray of the hole in depth order, as a strip to scroll along; photographs load as they come into view.
 * The tray holding the most unusual metre is ringed. A tray opens full screen at full resolution. */
function TrayStrip({ holeKey, trays, at, onOpen }: { holeKey: string; trays: Tray[]; at: number | null; onOpen: (m: number) => void }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null); const [ends, setEnds] = useState({ start: true, end: false });
  const edges = () => { const el = strip.current; if (el) setEnds({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 4 }); };
  // one press moves on by most of what is in view, so the next trays come in without losing your place
  const page = (d: number) => { const el = strip.current; if (el) el.scrollBy({ left: d * el.clientWidth * 0.8, behavior: "smooth" }); };
  if (!trays.length) return null;
  const hot = at !== null ? trays.find((x) => x.from_m <= at + 0.5 && at + 0.5 <= x.to_m + 0.05) ?? null : null;
  const lo = trays[0].from_m, hi = trays[trays.length - 1].to_m;
  return (
    <figure className="m-0 -mx-4 -mt-4 bg-slate-950">
      <div className="relative">
        <div ref={strip} onScroll={edges} className="flex snap-x gap-1 overflow-x-auto px-1 py-1 [scrollbar-width:thin]" role="list" aria-label="Tray photographs, top of the hole to the bottom">
          {trays.map((t, i) => <TrayThumb key={t.id} holeKey={holeKey} t={t} hot={t === hot} onOpen={() => setZoom(i)} />)}
        </div>
        {!ends.start && <button type="button" onClick={() => page(-1)} aria-label="Earlier trays" className="absolute left-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white ring-1 ring-white/30 hover:bg-black/85"><ChevronLeft size={20} /></button>}
        {!ends.end && <button type="button" onClick={() => page(1)} aria-label="Later trays" className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white ring-1 ring-white/30 hover:bg-black/85"><ChevronRight size={20} /></button>}
      </div>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 bg-white px-4 pt-2 text-[11px] text-slate-500">
        <span>{trays.length} trays, {lo.toFixed(0)}–{hi.toFixed(0)} m. Use the arrows to move along the hole; click a tray to open it full screen.</span>
        {hot && at !== null && <button type="button" onClick={() => onOpen(at)} className="font-medium text-slate-900 underline-offset-2 hover:underline">Most unusual: {at}–{at + 1} m (tray {hot.n})</button>}
      </figcaption>
      {zoom !== null && <TrayViewer holeKey={holeKey} trays={trays} start={zoom} metre={at} onClose={() => setZoom(null)} />}
    </figure>
  );
}

function TrayThumb({ holeKey, t, hot, onOpen }: { holeKey: string; t: Tray; hot: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null); const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el || seen) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "0px 400px" });
    io.observe(el); return () => io.disconnect();
  }, [seen]);
  const img = useQuery({ queryKey: ["core-tray", holeKey, t.id], queryFn: () => coreScan.trayImage(holeKey, t.id), enabled: seen, staleTime: Infinity, gcTime: 5 * 60_000 });
  return (
    <button ref={ref} type="button" role="listitem" onClick={onOpen} title={`Tray ${t.n}, ${t.from_m.toFixed(1)}–${t.to_m.toFixed(1)} m`}
      className={cn("group relative h-[96px] flex-none snap-start cursor-zoom-in overflow-hidden rounded-[3px] bg-slate-800", hot && "ring-2 ring-cyan ring-offset-1 ring-offset-slate-950")}
      style={{ aspectRatio: `${t.width || 1800} / ${t.height || 672}` }} aria-label={`Tray ${t.n}, ${t.from_m.toFixed(1)} to ${t.to_m.toFixed(1)} m, full screen`}>
      {img.data
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={img.data} alt="" className="absolute inset-0 h-full w-full object-cover" />
        : <span className="absolute inset-0 animate-pulse bg-slate-800" />}
      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-px font-mono text-[10px] text-white">{t.from_m.toFixed(1)}–{t.to_m.toFixed(1)} m</span>
    </button>
  );
}

function MixBars({ title, own, ring }: { title: string; own: Record<string, number>; ring: Record<string, number> }) {
  const keys = [...new Set([...Object.keys(own), ...Object.keys(ring)])].sort((a, b) => (own[b] ?? 0) - (own[a] ?? 0)).slice(0, 6);
  if (!keys.length) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between pb-1"><span className="text-xs font-semibold text-slate-900">{title}</span>
        <span className="flex gap-3 text-[11px] text-slate-500"><span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-[2px] bg-slate-900" />this metre</span><span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-[2px] bg-slate-300" />±15 m around</span></span></div>
      <div className="flex flex-col gap-1.5">
        {keys.map((k) => (
          <div key={k} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2 text-[11px]">
            <span className="truncate text-slate-700" title={mineralName(k)}>{mineralName(k)}</span>
            <span className="flex flex-col gap-[2px]">
              <span className="h-2 rounded-r-[4px] bg-slate-900" style={{ width: `${Math.max((own[k] ?? 0) * 100, 0.5)}%` }} />
              <span className="h-2 rounded-r-[4px] bg-slate-300" style={{ width: `${Math.max((ring[k] ?? 0) * 100, 0.5)}%` }} />
            </span>
            <span className="text-right font-mono text-slate-600">{pct(own[k] ?? 0)} / {pct(ring[k] ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetreTab({ hole, metre, previewing, mv, loading, trays, onMetre, typeName }: {
  hole: HoleDetail; metre: number | null; previewing: boolean; mv: MetreView | undefined; loading: boolean; trays: Tray[]; onMetre: (m: number) => void; typeName: (k: number) => string;
}) {
  if (metre === null) return <Empty>Click a metre on the log to see its photograph, spectra and what the model says about it.</Empty>;
  if (!mv) return <Empty>{loading ? "Loading…" : `No core in ${metre}–${metre + 1} m.`}</Empty>;
  // while the next metre loads the last one stays up, faded, under its own depth, so nothing flashes
  const stale = mv.metre !== metre; const at = mv.metre;
  const md = mv.model;
  const nm = (v: number) => `${Math.round(v)}`, um = (v: number) => (v / 1000).toFixed(1);
  return (
    <div className="relative flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-lg font-semibold text-slate-900">{at}–{at + 1} m</h3>
        {stale
          ? <span className="flex items-center gap-1.5 rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-medium text-white" role="status"><Loader2 size={12} className="animate-spin" />Loading {metre}–{metre + 1} m</span>
          : previewing && <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-medium text-slate-700">Preview · click the log to keep</span>}
        <span className="text-xs text-slate-500">{mv.n_tokens} of 10 ten-centimetre bins have valid core{mv.lith_raw ? ` · logged as ${mv.lith_raw}` : ""}{mv.au !== null ? ` · Au ${fmt(mv.au, 2)} ppm` : ""}</span>
      </div>
      {md && (
        <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
          <Fact k="Core type" v={<span className="flex items-start gap-1.5"><i className="mt-[0.4em] inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(typeName(md.core)) }} /><span className="line-clamp-2 text-[15px] leading-snug" title={typeName(md.core)}>{typeName(md.core)}</span></span>} />
          <Fact k="Unusual" v={pct(md.anom)} sub="State percentile of its most unusual 10 cm" />
          <Fact k="Gold likelihood" v={fmt(md.gold)} sub={`higher than ${pct(md.gold_pct)} of training metres`} />
          <Fact k={md.has_tir ? "TIR from SWIR" : "TIR filled in"} v={groupName(md.tir_group)} sub={md.tir_conf !== null ? `confidence ${pct(md.tir_conf)}` : undefined} />
        </div>
      )}
      <TrayPhoto holeKey={hole.key} trays={trays} metre={at} onMetre={onMetre} />
      <SpectraChart title="Visible to shortwave infrared" unit="nm" xTicks={[500, 1000, 1500, 2000, 2500]} xFmt={nm}
        lines={[{ name: "this metre", color: LINE.measured, x: mv.swir_wl, y: mv.swir }, { name: "±15 m around", color: LINE.around, x: mv.swir_wl, y: mv.swir_ring }]} />
      <SpectraChart title="Thermal infrared" unit="µm" xTicks={[7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000]} xFmt={um}
        note={md?.tir_pred ? undefined : "not measured in this metre"}
        lines={[{ name: "this metre", color: LINE.measured, x: mv.tir_wl, y: mv.tir }, { name: "±15 m around", color: LINE.around, x: mv.tir_wl, y: mv.tir_ring },
          { name: "rebuilt from SWIR by the model", color: LINE.rebuilt, dash: "5 3", x: md?.tir_wl ?? [], y: md?.tir_pred ?? null }]} />
      <div className="grid gap-5 @2xl:grid-cols-2">
        <MixBars title="SWIR minerals (TSG software)" own={mv.mix_swir} ring={mv.mix_swir_ring} />
        <MixBars title="TIR mineral groups (TSG software)" own={mv.mix_tir} ring={mv.mix_tir_ring} />
      </div>
      <div>
        <H3>What sets this metre apart</H3>
        {mv.why.length ? (
          <ul className="flex flex-col gap-1 text-xs text-slate-700">
            {mv.why.map((w) => (
              <li key={w.feat} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1">
                <span>{w.en.charAt(0).toUpperCase() + w.en.slice(1)} is {w.z > 0 ? "higher" : "lower"} than in the core around it</span>
                <span className="flex-none font-mono text-slate-500">{fmt(w.value, 3)} vs {fmt(w.ring, 3)} · {w.z > 0 ? "+" : ""}{w.z.toFixed(1)} sd</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-slate-500">No spectral feature of this metre stands more than 2 standard deviations away from the 15 m either side of it.</p>}
      </div>
    </div>
  );
}

function Report({ hole, models, mvw, run, trays }: { hole: HoleDetail; models: CoreModelInfo[]; mvw: ModelView | undefined; run: string; trays: Tray[] }) {
  const docRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // the page is A4 at its own width; on a narrower panel it is shown scaled down, never reflowed
  const [scale, setScale] = useState(1); const [docH, setDocH] = useState(0);
  useEffect(() => {
    const fr = frameRef.current, doc = docRef.current; if (!fr || !doc) return;
    const fit = () => { setScale(Math.min(1, fr.clientWidth / PAGE_W)); setDocH(doc.offsetHeight); };
    const ro = new ResizeObserver(fit); ro.observe(fr); ro.observe(doc); fit();
    return () => ro.disconnect();
  }, []);
  const [making, setMaking] = useState(false);
  const pdf = async () => {
    if (!docRef.current) return;
    setMaking(true);
    try { await downloadReportPdf(docRef.current, `CoreTrace_${safe(hole.name)}_report.pdf`, `CoreTrace scan report · ${hole.name} · ${models.find((m) => m.run === run)?.name ?? run}`); }
    finally { setMaking(false); }
  };
  const exportSegs = async () => save(await coreScan.segmentsCsv(hole.key, run), `${safe(hole.name)}_${run}_auto_log.csv`);
  const exportIssues = () => save(csv([["hole", "issue", "dataset", "depth_from", "depth_to", "value", "evidence", "suggested_fix"],
    ...hole.issues.map((i) => [hole.name, issueLabel(i.issue), i.dataset, i.depth_from, i.depth_to, i.value, i.evidence, ISSUE_LABEL[i.issue]?.fix ?? ""])]), `${safe(hole.name)}_quality.csv`);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <button type="button" onClick={pdf} disabled={making || (!mvw && hole.results.length > 0)} className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 sm:col-span-1 sm:justify-start sm:py-2">{making ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}{making ? "Making the PDF…" : "Download PDF"}</button>
        <button type="button" onClick={exportSegs} disabled={!mvw} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 sm:justify-start"><Download size={14} />Auto log (CSV)</button>
        <button type="button" onClick={exportIssues} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:justify-start"><Download size={14} />Quality issues (CSV)</button>
        <span className="col-span-2 text-[11px] text-slate-500">The PDF is this page, as shown, for the model selected above.</span>
      </div>
      <div ref={frameRef} className="w-full">
        <div className="overflow-hidden rounded-md shadow-[0_1px_3px_rgba(15,23,42,0.12),0_8px_28px_rgba(15,23,42,0.08)] ring-1 ring-slate-200" style={{ width: PAGE_W * scale, height: docH * scale || undefined }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: PAGE_W }}>
            <ReportDocument hole={hole} mv={mvw} run={run} models={models} trays={trays} nodeRef={docRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function HolePanel({ holeKey, tab: tabProp, onTab, models, run, onRun, metre, onMetre, wide, onWide, onClose, onOpenHole, onDeleted }: {
  holeKey: string; tab: string; onTab: (t: Tab) => void; models: CoreModelInfo[]; run: string; onRun: (r: string) => void; metre: number | null; onMetre: (m: number | null) => void;
  wide: boolean; onWide: (w: boolean) => void; onClose: () => void; onOpenHole: (key: string, m?: number) => void; onDeleted: () => void;
}) {
  const qc = useQueryClient();
  // the open tab lives in the address, so a link (or the assistant) can open a hole on any tab
  const tab: Tab = TABS.some((t) => t.id === tabProp) ? (tabProp as Tab) : "metre";
  const setTab = onTab;
  const hq = useQuery({ queryKey: ["core-hole", holeKey], queryFn: () => coreScan.hole(holeKey), refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 2500 : false),
    refetchIntervalInBackground: true });   // an upload is left to run in another tab; it should be done when the reader comes back
  const hole = hq.data; const ready = hole?.status === "ready";
  // a scan the models could not read (chips, an unusable mask, another band grid): shown, not modelled
  const displayOnly = !!hole && ready && hole.results.length === 0;
  // the default model first, the conventional methods last, as the service lists them otherwise
  const rank = (r: string) => { const m = models.find((x) => x.run === r); return m?.default ? 0 : m?.kind === "baseline" ? 2 : 1; };
  const runs = (hole?.results.map((r) => r.run) ?? []).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)); const useRun = runs.includes(run) ? run : runs[0] ?? "";
  const mq = useQuery({ queryKey: ["core-model", holeKey, useRun], queryFn: () => coreScan.model(holeKey, useRun), enabled: ready && !!useRun, staleTime: 5 * 60_000 });
  const tq = useQuery({ queryKey: ["core-trays", holeKey], queryFn: () => coreScan.trays(holeKey), enabled: ready, staleTime: 60_000 });
  // hovering over the log previews a metre on the right; a click keeps it. The preview follows the pointer
  // after a short pause, so sweeping down the hole does not fetch every metre on the way
  const [compare, setCompare] = useState(false);
  const [peekRaw, setPeekRaw] = useState<number | null>(null);
  const [peek, setPeek] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setPeek(peekRaw), peekRaw === null ? 0 : 140); return () => clearTimeout(t); }, [peekRaw]);
  const shown = peek ?? metre;
  const eq = useQuery({ queryKey: ["core-metre", holeKey, shown, useRun], queryFn: () => coreScan.metre(holeKey, shown as number, useRun),
    enabled: ready && wide && shown !== null && (!!useRun || displayOnly), staleTime: 5 * 60_000, retry: false, placeholderData: keepPreviousData });
  const sq = useQuery({ queryKey: ["core-similar", holeKey, metre, useRun], queryFn: () => coreScan.similar(holeKey, metre as number, useRun), enabled: ready && wide && tab === "similar" && metre !== null && !!useRun, staleTime: 5 * 60_000, retry: false });
  const mvw = mq.data; const trays = tq.data?.trays ?? [];
  // the original report: only holes whose scan names a WAMEX report have one
  const hasReport = !!hole?.meta.wamex;
  const rq = useQuery({ queryKey: ["core-report", holeKey], queryFn: () => coreScan.report(holeKey), enabled: hasReport, staleTime: 60 * 60_000, retry: false });
  const typeName = useMemo(() => { const n = new Map((mvw?.core_types ?? []).map((c) => [c.k, c.name])); return (k: number) => n.get(k) ?? "—"; }, [mvw]);
  const res = hole?.results.find((r) => r.run === useRun);
  const jump = (m: number) => { onMetre(m); };
  const del = async () => {
    if (!hole || !window.confirm(`Delete "${hole.name}" and everything computed from it? This cannot be undone.`)) return;
    await coreScan.remove(hole.key); qc.invalidateQueries({ queryKey: ["core-holes"] }); onDeleted();
  };

  const header = (
    <div className="flex items-start justify-between gap-3 border-b border-white/60 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-slate-800">{hole?.name ?? holeKey}</h2>
          {hole && <span className={cn("flex-none rounded-full px-2 py-0.5 text-[10px] font-medium", hole.source === "upload" ? "bg-orange/15 text-orange" : "bg-slate-100 text-slate-600")} title={`${hole.source === "upload" ? "A scan you uploaded" : `${surveyOf(hole.state || "WA")} core library, through the National Virtual Core Library`}${readDate(hole, true) ? `; read by the platform on ${readDate(hole, true)}` : ""}`}>{sourceLabel(hole)}</span>}
          {hole?.offshore && <span className="flex-none rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800" title="A petroleum well in offshore (Commonwealth) waters">Offshore</span>}
        </div>
        <p className="truncate text-xs text-slate-500">{hole ? [hole.operator, hole.project, hole.region].filter(Boolean).join(" · ") || "No collar details in the scan" : "Loading…"}</p>
      </div>
      <div className="flex flex-none items-center gap-1">
        {hasReport && rq.data?.pdf_url && <a href={rq.data.pdf_url} target="_blank" rel="noopener" aria-label="Open the original report" title={`Open the original exploration report (WAMEX ${rq.data.anumber})`} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><ExternalLink size={15} /></a>}
        {hole?.mine && <button type="button" onClick={del} aria-label="Delete this scan" title="Delete this scan" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-red-600"><Trash2 size={15} /></button>}
        {ready && <button type="button" onClick={() => onWide(!wide)} aria-label={wide ? "Back to the summary" : "Open the full log"} title={wide ? "Back to the summary" : "Open the full log"} className={cn("h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100", wide ? "grid" : "hidden sm:grid")}>{wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>}
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={16} /></button>
      </div>
    </div>
  );

  // One model by default. The others exist so the research can compare training objectives: the three CoreTrace
  // variants give near-identical results, and "Conventional methods" is the baseline without a foundation model.
  // They stay one click away for whoever wants to compare, and out of sight for everyone else.
  const defaultRun = models.find((m) => m.default)?.run ?? runs[0];
  const comparing = compare || (!!useRun && useRun !== defaultRun);
  const modelPicker = runs.length > 1 && (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
        <span>Read by <b className="font-semibold text-slate-800">{useRun === defaultRun ? "CoreTrace" : models.find((m) => m.run === useRun)?.name ?? useRun}</b>{useRun === defaultRun ? ", a foundation model for core spectra" : ""}</span>
        <button type="button" onClick={() => { if (comparing) { setCompare(false); if (useRun !== defaultRun) onRun(defaultRun); } else setCompare(true); }}
          className="font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline">{comparing ? "Back to the default" : "Compare models"}</button>
      </div>
      {comparing && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2">
          <div className="grid grid-cols-2 gap-1 text-xs" role="group" aria-label="Model">
            {runs.map((r) => { const m = models.find((x) => x.run === r); return (
              <button key={r} type="button" onClick={() => onRun(r)} title={m?.description} aria-pressed={r === useRun}
                className={cn("truncate rounded-md px-2.5 py-1.5 text-left font-medium ring-1", r === useRun ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}>{m?.name ?? r}</button>); })}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-500">The three CoreTrace models differ only in how they were trained and read core almost the same way. &ldquo;Conventional methods&rdquo; uses no foundation model: compare against it to see what the model adds.</p>
        </div>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (hq.isError) body = <div className="p-4"><Empty>This hole could not be opened. It may have been removed, or it belongs to someone else.</Empty></div>;
  else if (!hole) body = <div className="p-4 text-xs text-slate-500">Loading…</div>;
  else if (!ready) {
    body = (
      <div className="flex flex-col gap-3 p-4">
        {hole.status === "failed" ? (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800"><AlertTriangle size={15} className="mt-0.5 flex-none" /><div><div className="font-semibold">This scan could not be processed</div><div>{hole.message || "No reason was recorded."}</div></div></div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-baseline justify-between text-xs"><span className="font-semibold text-slate-900">{STATUS_LABEL[hole.status]}</span><span className="font-mono text-slate-500">{pct(hole.progress)}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-slate-900 transition-[width] duration-700" style={{ width: `${Math.max(hole.progress * 100, 3)}%` }} /></div>
            <p className="pt-2 text-[11px] text-slate-500">{hole.message || "Reading the files, cleaning to 10 cm bins, then every model in turn. A few minutes for a deep hole."} This page updates by itself.</p>
          </div>
        )}
      </div>
    );
  } else if (!wide) {
    const tops = res?.summary.main_types ?? [];
    body = (
      <div className="flex flex-col gap-4 p-4">
        <TrayStrip holeKey={hole.key} trays={trays} at={mvw?.anomaly.runs[0]?.peak_m ?? null} onOpen={(m) => { onMetre(m); onWide(true); }} />
        {displayOnly && <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-700">{hole.message}</p>}
        {hole.source === "nvcl" && hole.state && hole.state !== "WA" && <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] text-sky-900">The models were trained on GSWA&rsquo;s Western Australian core. This hole comes from the {surveyOf(hole.state)} library, outside that training set, so read its core types, unusual scores and gold ranking with more caution. Similar core is searched in WA only.</p>}
        {(hole.split === "train" || hole.split === "val") && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">The models saw this hole in training. Results here will look better than on core they have not seen.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Fact k="Depth scanned" v={`${fmt(hole.depth_min, 0)}–${fmt(hole.depth_max, 0)} m`} sub={`${(hole.meta.n_tokens as number | undefined ?? 0).toLocaleString()} ten-centimetre bins`} />
          <Fact k="Instrument" v={hole.instrument || "—"} sub={hole.tir === "ok" ? "thermal infrared measured" : hole.tir === "sparse" ? "little thermal infrared" : "no thermal infrared"} />
          <Fact k="Gold assays" v={hole.au_m ? `${hole.au_m} m` : "none in the scan"} sub={hole.au_m ? `${hole.au_pos_m} m at or above 0.1 ppm` : undefined} />
          <Fact k="Data quality" v={hole.n_issues ? `${hole.n_issues} ${hole.n_issues === 1 ? "issue" : "issues"}` : "nothing found"} sub={hole.issues[0] ? issueLabel(hole.issues[0].issue) : undefined} />
        </div>
        {hasReport && <div><H3>Original report</H3><OriginalReport report={rq.data} loading={rq.isPending} /></div>}
        {modelPicker}
        <div>
          <H3>Down the hole</H3>
          {displayOnly ? <GroupStrip groups={hole.metres.gs} /> : <MiniStrip strip={res?.summary.strip ?? hole.strip} model={mvw} />}
          <div className="flex justify-between pt-0.5 font-mono text-[10px] text-slate-400"><span>{fmt(hole.depth_min, 0)} m</span><span>{fmt(hole.depth_max, 0)} m</span></div>
          {tops.length > 0 && <ul className="flex flex-col gap-1 pt-2 text-xs text-slate-700">{tops.map(([n, s]) => <li key={n} className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(n) }} /><span className="flex-1 truncate">{n}</span><span className="font-mono text-slate-500">{pct(s)}</span></li>)}</ul>}
        </div>
        {res && (
          <div>
            <H3>What the model found</H3>
            <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-slate-700">
              <li><b className="font-semibold text-slate-900">{res.summary.n_segments} segments</b> in the auto log, over {res.summary.metres} m of core.</li>
              <li><b className="font-semibold text-slate-900">{res.anomaly.n_flag_m} unusual {res.anomaly.n_flag_m === 1 ? "metre" : "metres"}</b> flagged against the core around them.</li>
              {res.summary.gold_top !== null && <li>Highest gold likelihood at <button type="button" className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900" onClick={() => { onMetre(res.summary.gold_top as number); onWide(true); }}>{res.summary.gold_top} m</button>{res.gold.auc !== null ? <>; against this hole&rsquo;s assays the ranking scores AUC {fmt(res.gold.auc)}</> : null}.</li>}
              {res.tir.measured && res.tir.acc !== null && <li>TIR mineral group filled in from SWIR alone agrees with the measured TIR in <b className="font-semibold text-slate-900">{pct(res.tir.acc)}</b> of bins.</li>}
              {!res.tir.measured && <li>No thermal infrared was measured; the model fills in a TIR mineral group for every metre from SWIR.</li>}
            </ul>
          </div>
        )}
        <button type="button" onClick={() => onWide(true)} className="group flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800">
          Open the full log<ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
        </button>
        <p className="text-[11px] leading-relaxed text-slate-500">{displayOnly
          ? "Metre by metre: tray photographs, spectra, the TSG software's minerals, logged rock and assays, the data-quality checks, and a printable report."
          : "Metre by metre: tray photographs, spectra, the auto log, unusual intervals, gold likelihood, similar core across the State, and a printable report."}</p>
      </div>
    );
  } else {
    const flaggedRuns = mvw?.anomaly.runs ?? []; const goldTop = mvw?.gold_summary.top ?? [];
    body = (
      // a wide screen keeps the log and the reading side by side, each scrolling on its own; a phone scrolls the whole
      // page as one, with the log a fixed height at the top and the tabs held at the top of the screen as you read
      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        <div className="flex h-[min(380px,52vh)] flex-none flex-col items-center border-b border-slate-200/70 p-3 lg:h-auto lg:min-h-0 lg:items-stretch lg:border-r lg:border-b-0">
          <StripLog metres={hole.metres} model={mvw} cursor={metre} onHover={tab === "metre" ? setPeekRaw : undefined} onCursor={(m) => { setPeekRaw(null); jump(m); if (tab === "report" || tab === "quality") setTab("metre"); }} hasLith={hole.has_lith} hasAu={hole.au_m > 0} />
        </div>
        <div className="@container flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
          {/* on a phone the model line scrolls away; only the tabs stay */}
          <div className="px-4 pt-3 lg:hidden">{modelPicker}</div>
          <div className="sticky top-0 z-10 flex flex-col gap-2 border-b border-slate-200/70 bg-white/95 px-4 pt-3 backdrop-blur lg:relative lg:bg-transparent lg:backdrop-blur-none">
            {/* the next metre is on its way: a bar along the foot of the tabs, the current metre left as it is */}
            {tab === "metre" && shown !== null && eq.data && eq.data.metre !== shown && (
              <div className="pointer-events-none absolute inset-x-0 -bottom-px h-[3px] overflow-hidden bg-cyan/15" aria-hidden>
                <div className="h-full w-1/3 animate-[ct-slide_1s_ease-in-out_infinite] bg-cyan" />
                <style>{`@keyframes ct-slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
              </div>
            )}
            <div className="max-lg:hidden">{modelPicker}</div>
            <div className="flex gap-1 max-lg:flex-wrap max-lg:gap-1.5 max-lg:pb-3 lg:overflow-x-auto lg:[scrollbar-width:none]" role="tablist">
              {TABS.filter((t) => !displayOnly || t.id === "metre" || t.id === "quality" || t.id === "report").map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
                  className={cn("flex-none text-xs font-medium lg:border-b-2 lg:px-2.5 lg:py-2 max-lg:rounded-full max-lg:px-3 max-lg:py-1.5 max-lg:ring-1",
                    tab === t.id ? "lg:border-slate-900 text-slate-900 max-lg:bg-slate-900 max-lg:text-white max-lg:ring-slate-900" : "lg:border-transparent text-slate-500 hover:text-slate-800 max-lg:bg-white max-lg:ring-slate-200")}>
                  {t.label}{t.id === "quality" && hole.n_issues ? <span className={cn("ml-1 rounded-full px-1.5 text-[10px]", tab === t.id ? "bg-white/20 lg:bg-slate-100 lg:text-slate-600" : "bg-slate-100 text-slate-600")}>{hole.n_issues}</span> : null}
                </button>
              ))}
            </div>
          </div>
          <div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {displayOnly && <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">{hole.message}</p>}
            {tab === "metre" && <MetreTab hole={hole} metre={shown} previewing={peek !== null && peek !== metre} mv={eq.data} loading={eq.isLoading || eq.isPlaceholderData} trays={trays} onMetre={jump} typeName={typeName} />}
            {tab === "log" && (mvw ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-slate-600">The model cuts the hole where its reading of the spectra changes, then each piece is described from the TSG software&rsquo;s minerals. {mvw.segments.length} segments, typically {fmt(mvw.segments.map((s) => s.length_m).sort((a, b) => a - b)[Math.floor(mvw.segments.length / 2)], 1)} m long. Click a row to go there.</p>
                <table className="w-full border-collapse">
                  <thead><tr>{["From–to (m)", "Core type", "SWIR minerals", "TIR groups"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody>{mvw.segments.map((s) => { const on = metre !== null && metre >= Math.floor(s.from_m) && metre < s.to_m; return (
                    <tr key={s.seg} onClick={() => jump(Math.floor(s.from_m))} className={cn("cursor-pointer hover:bg-slate-50", on && "bg-cyan/10")}>
                      <td className={cn(td, "font-mono whitespace-nowrap")}>{s.from_m.toFixed(1)}–{s.to_m.toFixed(1)}</td>
                      <td className={td}><span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(s.core_type_name) }} />{s.core_type_name}</span></td>
                      <td className={td}>{s.swir_minerals.slice(0, 3).map(([c, , p]) => `${mineralName(c)} ${pct(p)}`).join(", ") || "—"}</td>
                      <td className={td}>{s.tir_groups.slice(0, 2).map(([c, , p]) => `${groupName(c)} ${pct(p)}`).join(", ") || "—"}</td></tr>); })}</tbody>
                </table>
              </div>) : <Empty>Loading…</Empty>)}
            {tab === "unusual" && (mvw ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-slate-600">A metre is flagged when it differs from the 15 m either side of it more than {pct(1 - mvw.anomaly.top_share)} of this hole does, and more than {pct(mvw.anomaly.flag_at, 1)} of the State&rsquo;s training core. {mvw.anomaly.n_flag_m} of {mvw.m.length} metres are flagged. Unusual is not the same as mineralised{mvw.anomaly.auc_gold !== null ? `: against this hole's assays the score ranks gold metres with AUC ${fmt(mvw.anomaly.auc_gold)}` : ""}.</p>
                {flaggedRuns.length ? (
                  <table className="w-full border-collapse">
                    <thead><tr>{["Interval (m)", "Most unusual at", "Contrast with surroundings", "State percentile"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody>{flaggedRuns.map((r) => (
                      <tr key={r.from_m} onClick={() => { jump(r.peak_m); setTab("metre"); }} className="cursor-pointer hover:bg-slate-50">
                        <td className={cn(td, "font-mono")}>{r.from_m}–{r.to_m}</td><td className={cn(td, "font-mono")}>{r.peak_m} m</td>
                        <td className={td}><span className="flex items-center gap-2"><span className="h-2 rounded-r-[4px]" style={{ width: `${Math.min(100, (r.raw / (flaggedRuns[0].raw || 1)) * 100) * 0.6}%`, background: SERIES.orange }} /><span className="font-mono">{r.raw.toFixed(2)}</span></span></td>
                        <td className={cn(td, "font-mono")}>{pct(r.peak, 1)}</td></tr>))}</tbody>
                  </table>) : <Empty>Nothing in this hole stands out from its surroundings enough to flag.</Empty>}
              </div>) : <Empty>Loading…</Empty>)}
            {tab === "gold" && (mvw ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-slate-600">The likelihood comes from a probe fitted on assayed training holes; it reads the spectra only. {hole.au_m ? `This hole has ${hole.au_m} assayed metres (${hole.au_pos_m} at or above 0.1 ppm)${mvw.gold_summary.auc !== null ? `; the model ranks them with AUC ${fmt(mvw.gold_summary.auc)}` : ""}${mvw.gold_summary.top10_share !== undefined ? `, and ${pct(mvw.gold_summary.top10_share)} of its top tenth carry gold against ${pct(mvw.gold_summary.base_share)} overall` : ""}.` : "This scan carries no assays, so the ranking cannot be checked here."}</p>
                <table className="w-full border-collapse">
                  <thead><tr>{["Metre", "Gold likelihood", ...(hole.au_m ? ["Assay (ppm)"] : [])].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                  <tbody>{goldTop.map((g) => (
                    <tr key={g.m} onClick={() => { jump(g.m); setTab("metre"); }} className="cursor-pointer hover:bg-slate-50">
                      <td className={cn(td, "font-mono")}>{g.m}–{g.m + 1}</td>
                      <td className={td}><span className="flex items-center gap-2"><span className="h-2 rounded-r-[4px]" style={{ width: `${g.p * 60}%`, background: SERIES.blue }} /><span className="font-mono">{g.p.toFixed(2)}</span></span></td>
                      {hole.au_m ? <td className={cn(td, "font-mono")}>{g.au !== null ? g.au.toFixed(2) : "—"}</td> : null}</tr>))}</tbody>
                </table>
              </div>) : <Empty>Loading…</Empty>)}
            {tab === "similar" && (metre === null ? <Empty>Click a metre on the log, then look for core like it elsewhere in the State.</Empty>
              : sq.isLoading ? <Empty>Searching the State library…</Empty>
              : sq.isError || !sq.data ? <Empty>The similarity search is not available right now. Everything else on this page still works.</Empty> : (
                <div className="flex flex-col gap-3">
                  <p className="text-xs leading-relaxed text-slate-600">The 2 m starting at {metre} m, compared with {sq.data.library.intervals.toLocaleString()} two-metre intervals from {sq.data.library.holes.toLocaleString()} holes. Holes within 5 km are left out, and each hole appears once.</p>
                  <table className="w-full border-collapse">
                    <thead><tr>{["Hole", "Interval (m)", "Similarity", "SWIR / TIR", "Region"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                    <tbody>{sq.data.results.map((r) => (
                      <tr key={r.hole} onClick={() => r.key && onOpenHole(r.key, Math.floor(r.from_m))} className={cn(r.key && "cursor-pointer hover:bg-slate-50")}>
                        <td className={cn(td, "font-medium text-slate-900")}>{r.hole}{r.key ? <ArrowRight size={12} className="ml-1 inline" /> : null}</td>
                        <td className={cn(td, "font-mono")}>{r.from_m.toFixed(0)}–{r.to_m.toFixed(0)}</td><td className={cn(td, "font-mono")}>{r.sim.toFixed(2)}</td>
                        <td className={td}><span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: groupColor(r.gs) }} />{groupName(r.gs)} / {groupName(r.gt)}</span></td>
                        <td className={td}>{r.region || "—"}{r.rock ? ` · ${r.rock}` : ""}</td></tr>))}</tbody>
                  </table>
                </div>))}
            {tab === "quality" && (
              <div className="flex flex-col gap-3">
                <p className="text-xs leading-relaxed text-slate-600">Checks run while the scan was cleaned: unused datasets, thermal-infrared problems, missing core, and missing collar details.</p>
                {hole.issues.length ? hole.issues.map((i, k) => (
                  <div key={k} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                    <div className="flex items-baseline justify-between gap-3"><span className="font-semibold text-slate-900">{issueLabel(i.issue)}</span>
                      {i.depth_from !== null && <button type="button" className="flex-none font-mono text-slate-600 underline decoration-slate-300 underline-offset-2" onClick={() => jump(Math.floor(i.depth_from as number))}>{fmt(i.depth_from, 1)}–{fmt(i.depth_to, 1)} m</button>}</div>
                    {(i.value || i.evidence) && <div className="text-slate-600">{[i.value, i.evidence].filter(Boolean).join(" · ")}</div>}
                    {ISSUE_LABEL[i.issue] && <div className="text-slate-500">Suggested fix: {ISSUE_LABEL[i.issue].fix}</div>}
                  </div>)) : <Empty>The checks found nothing to report for this hole.</Empty>}
              </div>)}
            {tab === "report" && <Report hole={hole} models={models} mvw={mvw} run={useRun} trays={trays} />}
            {tab !== "report" && tab !== "quality" && <div className="mt-6 border-t border-slate-100 pt-3"><StripLegend metres={hole.metres} model={mvw} hasLith={hole.has_lith} hasAu={hole.au_m > 0} /></div>}
          </div>
        </div>
      </div>
    );
  }
  return <div className="flex h-full min-h-0 flex-col">{header}<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</div></div>;
}
