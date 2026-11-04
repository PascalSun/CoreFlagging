"use client";

import { useState } from "react";
import { Download, FileDown, FileText, Loader2, Upload } from "lucide-react";
import { coreScan, safeName, saveBlob, type HoleDetail, type SheetInterval, type SheetsBody, type Tray } from "@/lib/coreScan";
import type { Window } from "@/lib/depth";
import { cn } from "@/lib/utils";

type Source = "window" | "trays" | "samples" | "csv";
/** what the sheets endpoint takes in one go (the service's limits) */
const MAX_PAGES = 300, MAX_LEN = 20;
const TEMPLATE = "SampleID,from,to\nS001,120.0,121.0\nS002,121.0,122.5\n";

/** A user's interval list, "SampleID,from,to" (header names are matched loosely: "Sample ID", "from_m", "depth_to"
 * …; comma, semicolon or tab). Every problem is a sentence naming the row, not a parse error. */
export function parseIntervalsCsv(text: string): { intervals: SheetInterval[]; error: string } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { intervals: [], error: "The file is empty." };
  const sep = [",", ";", "\t"].map((c) => [c, lines[0].split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const cells = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
  const head = cells(lines[0]).map((h) => h.toLowerCase().replace(/[\s_-]+/g, ""));
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = find("sampleid", "sample", "id", "label", "name"), fi = find("from", "fromm", "depthfrom", "start"), ti = find("to", "tom", "depthto", "end");
  if (fi < 0 || ti < 0) return { intervals: [], error: `The first row should name the columns: SampleID,from,to (found: ${cells(lines[0]).join(", ") || "nothing"}).` };
  const out: SheetInterval[] = [];
  for (let r = 1; r < lines.length; r++) {
    const c = cells(lines[r]); const f = Number(c[fi]), t = Number(c[ti]); const row = `Row ${r + 1}`;
    if (c[fi] === "" || c[ti] === "" || !Number.isFinite(f) || !Number.isFinite(t)) return { intervals: [], error: `${row}: "from" and "to" should be depths in metres (got "${c[fi] ?? ""}" and "${c[ti] ?? ""}").` };
    if (t <= f) return { intervals: [], error: `${row}: "to" (${t}) should be deeper than "from" (${f}).` };
    if (t - f > MAX_LEN) return { intervals: [], error: `${row}: ${f}–${t} m is ${(t - f).toFixed(1)} m long; a sheet covers at most ${MAX_LEN} m.` };
    out.push({ label: (ci >= 0 && c[ci]) || `${f}–${t} m`, from_m: f, to_m: t });
  }
  if (!out.length) return { intervals: [], error: "The file has the header but no intervals under it." };
  if (out.length > MAX_PAGES) return { intervals: [], error: `The file lists ${out.length} intervals; one PDF takes at most ${MAX_PAGES}. Split it into smaller files.` };
  return { intervals: out, error: "" };
}

/** One A4 page per interval of the hole: the line scan beside its SWIR and TIR group columns, the group pies and
 * the mean spectra. The intervals: the window on screen, every tray, the TSG's own samples, or the user's CSV. */
export function SampleSheets({ hole, trays, win }: { hole: HoleDetail; trays: Tray[]; win: Window | null }) {
  const tsg = hole.samples ?? [];
  const winOk = !!win && win[1] - win[0] <= MAX_LEN;
  const [source, setSource] = useState<Source>(winOk ? "window" : trays.length ? "trays" : tsg.length ? "samples" : "csv");
  const [swir, setSwir] = useState(true); const [tir, setTir] = useState(true);
  const [results, setResults] = useState<SheetsBody["results"]>("auto"); const [minShare, setMinShare] = useState(5);
  const [csv, setCsv] = useState<{ name: string; intervals: SheetInterval[]; error: string } | null>(null);
  const [making, setMaking] = useState(false); const [err, setErr] = useState("");

  const sources: { id: Source; label: string; hint: string; ok: boolean }[] = [
    { id: "window", label: "This window", ok: winOk, hint: win ? (winOk ? `${win[0]}–${win[1]} m, one page` : `the window is longer than ${MAX_LEN} m`) : "open a window on the Window tab first" },
    { id: "trays", label: "Every tray", ok: trays.length > 0, hint: trays.length ? `${trays.length} pages, one per tray` : "no tray list for this hole" },
    { id: "samples", label: "TSG samples", ok: tsg.length > 0, hint: tsg.length ? `${tsg.length} pages, by the TSG's SampleID` : "the TSG names no samples" },
    { id: "csv", label: "From a CSV", ok: true, hint: csv?.intervals.length ? `${csv.intervals.length} pages from ${csv.name}` : "columns SampleID,from,to" },
  ];
  const pages = source === "window" ? 1 : source === "trays" ? trays.length : source === "samples" ? tsg.length : csv?.intervals.length ?? 0;
  const ready = !making && (swir || tir) && sources.find((s) => s.id === source)?.ok && (source !== "csv" || !!csv?.intervals.length);

  const readCsv = async (f: File | undefined) => {
    if (!f) return;
    const r = parseIntervalsCsv(await f.text()); setCsv({ name: f.name, ...r }); setErr("");
  };
  const go = async () => {
    if (!ready) return;
    setMaking(true); setErr("");
    const opts = { swir, tir, results, min_share: Math.max(0, Math.min(50, minShare)) / 100 };
    const body: SheetsBody = source === "window" && win ? { ...opts, intervals: [{ label: `${win[0]}–${win[1]} m`, from_m: win[0], to_m: win[1] }] }
      : source === "csv" ? { ...opts, intervals: csv?.intervals ?? [] } : { ...opts, source: source === "trays" ? "trays" : "samples" };
    try { saveBlob(await coreScan.sheetsPdf(hole.key, body), `CoreFlagging_${safeName(hole.name)}_sheets.pdf`); }
    catch (e) { setErr((e as Error).message || "The sheets could not be made."); }
    finally { setMaking(false); }
  };

  const chip = (on: boolean) => cn("rounded-full px-2.5 py-0.5 pointer-coarse:py-1.5 text-[11px] font-medium ring-1", on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:ring-slate-400");
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="flex items-center gap-1.5 pb-1 font-display text-[15px] font-semibold text-slate-900"><FileText size={15} className="text-slate-500" />Sample sheets</h3>
      <p className="pb-3 text-xs leading-relaxed text-slate-600">One A4 page per interval: the HyLogger line scan beside its SWIR and TIR mineral groups, reading for reading, the groups&rsquo; share with their minerals, and the interval&rsquo;s mean spectra.</p>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="pb-1 text-[11px] font-medium text-slate-500">Intervals</legend>
        {sources.map((s) => (
          <label key={s.id} className={cn("flex items-start gap-2 rounded-md px-2 py-1.5 pointer-coarse:py-2.5 text-xs", s.ok ? "cursor-pointer hover:bg-slate-50" : "cursor-not-allowed opacity-50", source === s.id && "bg-slate-50 ring-1 ring-slate-200")}>
            <input type="radio" name={`sheet-src-${hole.key}`} value={s.id} checked={source === s.id} disabled={!s.ok} onChange={() => { setSource(s.id); setErr(""); }} className="mt-0.5 accent-slate-900" />
            <span className="min-w-0"><span className="font-medium text-slate-900">{s.label}</span> <span className="text-slate-500">· {s.hint}</span></span>
          </label>))}
      </fieldset>

      {source === "csv" && (
        <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-dashed border-slate-200 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <Upload size={14} />{csv ? "Choose another CSV" : "Choose a CSV"}
              <input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={(e) => { readCsv(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <button type="button" onClick={() => saveBlob(new Blob([TEMPLATE], { type: "text/csv" }), "sample_sheet_template.csv")} className="flex items-center gap-1.5 text-[11px] text-slate-500 underline-offset-2 hover:underline"><Download size={12} />Template</button>
          </div>
          {csv?.error ? <p className="text-[11px] text-red-600">{csv.name}: {csv.error}</p>
            : csv ? <p className="text-[11px] text-slate-600">{csv.name}: {csv.intervals.length} intervals, {csv.intervals[0].label} ({csv.intervals[0].from_m}–{csv.intervals[0].to_m} m){csv.intervals.length > 1 ? " first" : ""}.</p>
            : null}
          <p className="text-[10.5px] leading-relaxed text-slate-400">One row per sheet, depths in metres, each at most {MAX_LEN} m and up to {MAX_PAGES} rows: <code className="font-mono text-slate-500">SampleID,from,to</code> then e.g. <code className="font-mono text-slate-500">S001,120.0,121.0</code>.</p>
        </div>)}

      <div className="mt-3 flex flex-col gap-2 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 flex-none text-[11px] text-slate-500">Panels</span>
          <button type="button" aria-pressed={swir} onClick={() => setSwir(!swir)} className={chip(swir)}>SWIR</button>
          <button type="button" aria-pressed={tir} onClick={() => setTir(!tir)} className={chip(tir)}>TIR</button>
          {!swir && !tir && <span className="text-[11px] text-red-600">pick at least one</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Classification">
          <span className="w-24 flex-none text-[11px] text-slate-500">Classification</span>
          {([["auto", "Auto"], ["system", "System"], ["user", "User"]] as const).map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={results === v} onClick={() => setResults(v)} className={chip(results === v)}>{l}</button>)}
          <span className="basis-full pl-[6.375rem] text-[10.5px] text-slate-400 max-sm:pl-0">The TSA run the colours come from: System (the scanner&rsquo;s), User (a geologist&rsquo;s re-run), Auto = System where there is one.</span>
        </div>
        <label className="flex flex-wrap items-center gap-1.5">
          <span className="w-24 flex-none text-[11px] text-slate-500">Smallest share</span>
          <input type="number" min={0} max={50} step={1} value={minShare} onChange={(e) => setMinShare(Number(e.target.value) || 0)} className="w-16 rounded-md border border-slate-200 px-2 py-1 pointer-coarse:py-1.5 text-xs" />
          <span className="text-[11px] text-slate-500">% (groups and minerals below fold into Other)</span>
        </label>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <button type="button" onClick={go} disabled={!ready} className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 sm:py-2">
          {making ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}{making ? `Making ${pages} page${pages === 1 ? "" : "s"}…` : "Download sample sheets (PDF)"}</button>
        <span className="text-[11px] text-slate-500">{making ? "The pages are drawn from the scan package; a long list takes a minute or two." : pages > MAX_PAGES ? `${pages} intervals; the service may refuse more than ${MAX_PAGES}.` : pages ? `${pages} page${pages === 1 ? "" : "s"}.` : ""}</span>
      </div>
      {err && <p className="mt-2 text-[11px] text-red-600" role="alert">{err}</p>}
    </section>
  );
}
