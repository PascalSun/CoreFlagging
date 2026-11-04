"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, FileDown, Loader2, Upload } from "lucide-react";
import { CoreError, coreScan, safeName, saveBlob, type HoleDetail, type SheetInterval, type SheetsBody, type SpectralLog, type Tray } from "@/lib/coreScan";
import type { Window } from "@/lib/depth";
import { groupColor, groupName } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

type Source = "samples" | "trays" | "window" | "csv";
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

/** One row of the interval list: a page, or (too long) a row shown but never sent. */
type Row = SheetInterval & { ok: boolean };
const UNKNOWN = "#cbd5e1";

/** The rows of one dataset only: a hole scanned twice (HyLogger 3 and 4) lists its trays and samples twice, at the
 * same depths, and the service draws one dataset per PDF anyway. The dataset with the most rows is kept. */
function oneDataset<T extends { dataset: string }>(xs: T[]): T[] {
  const n = new Map<string, number>(); for (const x of xs) n.set(x.dataset, (n.get(x.dataset) ?? 0) + 1);
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return xs.filter((x) => x.dataset === best);
}

/** The leading SWIR or TIR group of an interval, from the hole's 1 m spectral log: each metre's group shares summed
 * over the part of the metre inside the interval. null when no metre of it has a TSG result. */
function leading(log: SpectralLog, side: "swir" | "tir", f: number, t: number): string | null {
  const rows = log.rows; let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].from_m + log.step <= f) lo = mid + 1; else hi = mid; }
  const sum = new Map<string, number>();
  for (let i = lo; i < rows.length && rows[i].from_m < t; i++) {
    const r = rows[i], s = r[side], w = Math.min(t, r.from_m + log.step) - Math.max(f, r.from_m);
    if (!s?.n_result || w <= 0) continue;
    for (const [g, v] of Object.entries(s.mix)) sum.set(g, (sum.get(g) ?? 0) + v * w);
  }
  let best: string | null = null, bv = 0; for (const [g, v] of sum) if (v > bv) { best = g; bv = v; }
  return best;
}

const Swatch = ({ g, side }: { g: string | null; side: string }) => (
  <i className="inline-block h-3 w-3 rounded-[2px] ring-1 ring-black/5" style={{ background: g ? groupColor(g) : UNKNOWN }} title={`${side}: ${g ? groupName(g) : "no TSG result"}`} />
);

/** The Sample sheets tab: one A4 page per interval of the hole (the line scan beside its SWIR and TIR group columns,
 * the groups' pies, the mean spectra). The intervals come from the TSG's own SampleIDs, the trays, the window on
 * screen or the user's CSV; the list picks which to print and shows the page of the row clicked. */
export function SampleSheets({ hole, trays, win, spectral }: { hole: HoleDetail; trays: Tray[]; win: Window | null; spectral?: SpectralLog }) {
  const tsg = useMemo(() => oneDataset(hole.samples ?? []), [hole.samples]);
  const trayRows = useMemo(() => oneDataset(trays).sort((a, b) => a.from_m - b.from_m || a.n - b.n), [trays]);
  const winOk = !!win && win[1] - win[0] <= MAX_LEN;
  const [csv, setCsv] = useState<{ name: string; intervals: SheetInterval[]; error: string } | null>(null);
  const sources: { id: Source; label: string; hint: string; ok: boolean }[] = [
    { id: "samples", label: "TSG samples", ok: tsg.length > 0, hint: tsg.length ? `${tsg.length}, by the TSG's SampleID` : "the TSG names no samples" },
    { id: "trays", label: "Every tray", ok: trayRows.length > 0, hint: trayRows.length ? `${trayRows.length} trays` : "no tray list for this hole" },
    { id: "window", label: "This window", ok: winOk, hint: win ? (winOk ? `${win[0]}–${win[1]} m` : `the window is longer than ${MAX_LEN} m`) : "open a window of up to 20 m on the log first" },
    { id: "csv", label: "From a CSV", ok: true, hint: csv?.intervals.length ? `${csv.intervals.length} from ${csv.name}` : "columns SampleID,from,to" },
  ];
  // the reader's pick, while it is still possible; else the first source that has rows (trays arrive after the hole)
  const [picked, setPicked] = useState<Source | null>(null);
  const source: Source = picked && sources.find((s) => s.id === picked)?.ok ? picked : sources.find((s) => s.ok && s.id !== "csv")?.id ?? "csv";

  const rows: Row[] = useMemo(() => {
    const iv: SheetInterval[] = source === "samples" ? tsg.map((s) => ({ label: s.id, from_m: s.from_m, to_m: s.to_m }))
      : source === "trays" ? trayRows.map((t) => ({ label: `Tray ${t.n}`, from_m: t.from_m, to_m: t.to_m }))
      : source === "window" ? (win && winOk ? [{ label: `${win[0]}–${win[1]} m`, from_m: win[0], to_m: win[1] }] : [])
      : csv?.intervals ?? [];
    return iv.map((r) => ({ ...r, ok: r.to_m > r.from_m && r.to_m - r.from_m <= MAX_LEN }));
  }, [source, tsg, trayRows, win, winOk, csv]);
  const swatches = useMemo(() => spectral ? rows.map((r) => [leading(spectral, "swir", r.from_m, r.to_m), leading(spectral, "tir", r.from_m, r.to_m)] as const) : null, [spectral, rows]);
  const hasTir = !!spectral && spectral.tir_groups.length > 0;

  // the ticked rows and the row on show, for this list only: a new source or CSV starts with every row ticked
  const listKey = `${source}|${csv?.name ?? ""}|${rows.length}|${rows[0]?.from_m ?? ""}`;
  const [tick, setTick] = useState<{ k: string; off: Set<number> }>({ k: "", off: new Set() });
  const off = tick.k === listKey ? tick.off : new Set<number>();
  const [shown, setShown] = useState<{ k: string; i: number }>({ k: "", i: 0 });
  const active = shown.k === listKey ? shown.i : Math.max(0, rows.findIndex((r) => r.ok));
  const toggle = (i: number) => { const s = new Set(off); if (s.has(i)) s.delete(i); else s.add(i); setTick({ k: listKey, off: s }); };
  const all = (on: boolean) => setTick({ k: listKey, off: on ? new Set() : new Set(rows.map((_, i) => i)) });
  const selected = rows.filter((r, i) => r.ok && !off.has(i)); const usable = rows.filter((r) => r.ok);

  const [swir, setSwir] = useState(true); const [tir, setTir] = useState(true);
  const [results, setResults] = useState<SheetsBody["results"]>("auto"); const [minShare, setMinShare] = useState(5);
  // the preview follows the share box once typing pauses, not at every keystroke
  const [shareShown, setShareShown] = useState(5);
  useEffect(() => { const t = window.setTimeout(() => setShareShown(minShare), 450); return () => window.clearTimeout(t); }, [minShare]);
  const opts = (share: number) => ({ swir, tir, results, min_share: Math.max(0, Math.min(50, share)) / 100 });

  const row = rows[active];
  const pq = useQuery({ queryKey: ["core-sheet-preview", hole.key, row?.label, row?.from_m, row?.to_m, swir, tir, results, shareShown],
    queryFn: () => coreScan.sheetPreview(hole.key, { ...opts(shareShown), intervals: [{ label: row.label, from_m: row.from_m, to_m: row.to_m }] }),
    enabled: !!row?.ok && (swir || tir), staleTime: 30 * 60_000, gcTime: 10 * 60_000, retry: false, placeholderData: keepPreviousData });
  // the PNG as an object URL, set straight on the image and revoked when the next page (or the tab) replaces it
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!pq.data || !img.current) return;
    const u = URL.createObjectURL(pq.data); img.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [pq.data]);
  const pErr = pq.error as CoreError | null;

  const [making, setMaking] = useState<{ what: "sel" | "all"; part: number; of: number } | null>(null); const [err, setErr] = useState("");
  const readCsv = async (f: File | undefined) => {
    if (!f) return;
    const r = parseIntervalsCsv(await f.text()); setCsv({ name: f.name, ...r }); setErr(""); if (!r.error) setPicked("csv");
  };
  // more than a PDF holds goes as several PDFs, one after the other
  const download = async (what: "sel" | "all") => {
    const list = what === "sel" ? selected : usable;
    if (!list.length || making || !(swir || tir)) return;
    const parts: Row[][] = []; for (let i = 0; i < list.length; i += MAX_PAGES) parts.push(list.slice(i, i + MAX_PAGES));
    setErr("");
    const base = `CoreFlagging_${safeName(hole.name)}${list.length === 1 ? `_${safeName(list[0].label)}` : ""}_sheets`;
    try {
      for (let p = 0; p < parts.length; p++) {
        setMaking({ what, part: p + 1, of: parts.length });
        const blob = await coreScan.sheetsPdf(hole.key, { ...opts(minShare), intervals: parts[p].map(({ label, from_m, to_m }) => ({ label, from_m, to_m })) });
        saveBlob(blob, `${base}${parts.length > 1 ? `_part${p + 1}of${parts.length}` : ""}.pdf`);
      }
    } catch (e) { setErr((e as Error).message || "The sheets could not be made."); }
    finally { setMaking(null); }
  };
  const pagesTxt = (n: number) => `${n} page${n === 1 ? "" : "s"}`;
  const nParts = (n: number) => Math.ceil(n / MAX_PAGES);

  const chip = (on: boolean) => cn("rounded-full px-2.5 py-0.5 pointer-coarse:py-1.5 text-[11px] font-medium ring-1", on ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:ring-slate-400");
  const th = "sticky top-0 z-[1] bg-slate-50 px-2 py-1.5 text-left text-[10.5px] font-medium text-slate-500";
  const fm = (v: number) => (Math.round(v * 100) / 100).toString();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-slate-600">One A4 page per interval: the HyLogger line scan beside its SWIR and TIR mineral groups, reading for reading, the groups&rsquo; share with their minerals, and the interval&rsquo;s mean spectra. Pick the intervals, click one to see its page, then download.</p>
      <div className="grid gap-4 @xl:grid-cols-2 @xl:grid-rows-[auto_1fr]">

        {/* the intervals: where they come from, and the list */}
        <div className="flex min-w-0 flex-col gap-2 @xl:col-start-1 @xl:row-start-1">
          <fieldset className="grid grid-cols-1 gap-1 @md:grid-cols-2 @xl:grid-cols-1">
            <legend className="pb-1 text-[11px] font-medium text-slate-500">Intervals</legend>
            {sources.map((s) => (
              <label key={s.id} className={cn("flex items-start gap-2 rounded-md px-2 py-1.5 pointer-coarse:py-2.5 text-xs", s.ok ? "cursor-pointer hover:bg-slate-50" : "cursor-not-allowed opacity-50", source === s.id && "bg-slate-50 ring-1 ring-slate-200")}>
                <input type="radio" name={`sheet-src-${hole.key}`} value={s.id} checked={source === s.id} disabled={!s.ok} onChange={() => { setPicked(s.id); setErr(""); }} className="mt-0.5 accent-slate-900" />
                <span className="min-w-0"><span className="font-medium text-slate-900">{s.label}</span> <span className="text-slate-500">· {s.hint}</span></span>
              </label>))}
          </fieldset>

          {source === "csv" && (
            <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-slate-200 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <Upload size={14} />{csv ? "Choose another CSV" : "Choose a CSV"}
                  <input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={(e) => { readCsv(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                <button type="button" onClick={() => saveBlob(new Blob([TEMPLATE], { type: "text/csv" }), "sample_sheet_template.csv")} className="flex items-center gap-1.5 text-[11px] text-slate-500 underline-offset-2 hover:underline"><Download size={12} />Template</button>
              </div>
              {csv?.error ? <p className="text-[11px] text-red-600">{csv.name}: {csv.error}</p> : null}
              <p className="text-[10.5px] leading-relaxed text-slate-400">One row per sheet, depths in metres, each at most {MAX_LEN} m: <code className="font-mono text-slate-500">SampleID,from,to</code> then e.g. <code className="font-mono text-slate-500">S001,120.0,121.0</code>.</p>
            </div>)}

          {rows.length > 0 && (<>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span><b className="font-semibold text-slate-800">{selected.length}</b> of {usable.length} ticked</span>
              <button type="button" onClick={() => all(true)} className="font-medium text-slate-700 underline-offset-2 hover:underline">Select all</button>
              <button type="button" onClick={() => all(false)} className="font-medium text-slate-700 underline-offset-2 hover:underline">None</button>
              {!spectral && <span className="text-slate-400">no spectral log, so no group colours</span>}
            </div>
            <div className="max-h-[26rem] overflow-y-auto rounded-md border border-slate-200 @xl:max-h-[min(30rem,55vh)]">
              <table className="w-full table-fixed border-collapse text-xs">
                <thead><tr>
                  <th className={cn(th, "w-8")}><span className="sr-only">Print</span></th><th className={th}>Name</th><th className={cn(th, "w-[6.75rem] text-right")}>From–to m</th>
                  {swatches && <th className={cn(th, "w-11 text-center")} title="The leading SWIR group over the interval">SWIR</th>}
                  {swatches && hasTir && <th className={cn(th, "w-9 text-center")} title="The leading TIR group over the interval">TIR</th>}
                </tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={i} onClick={() => r.ok && setShown({ k: listKey, i })} aria-selected={i === active}
                    className={cn("border-t border-slate-100", r.ok ? "cursor-pointer hover:bg-slate-50" : "text-slate-400", i === active && "bg-cyan/10 hover:bg-cyan/15")}>
                    <td className="px-2 py-1.5 pointer-coarse:py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Print ${r.label}`} checked={r.ok && !off.has(i)} disabled={!r.ok} onChange={() => toggle(i)} className="accent-slate-900" /></td>
                    <td className="truncate px-2 py-1.5 font-medium text-slate-900" title={r.label}>{r.label}{!r.ok && <span className="ml-1 font-normal text-slate-400">(over {MAX_LEN} m, left out)</span>}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11px] text-slate-600">{fm(r.from_m)}–{fm(r.to_m)}</td>
                    {swatches && <td className="px-2 py-1.5 text-center"><Swatch g={swatches[i][0]} side="SWIR" /></td>}
                    {swatches && hasTir && <td className="px-2 py-1.5 text-center"><Swatch g={swatches[i][1]} side="TIR" /></td>}
                  </tr>))}</tbody>
              </table>
            </div>
          </>)}
          {!rows.length && source === "csv" && !csv?.error && <p className="text-[11px] text-slate-500">Choose a CSV to list its intervals here.</p>}
        </div>

        {/* the page of the row on show */}
        <div className="flex min-w-0 flex-col gap-1.5 @xl:sticky @xl:top-0 @xl:col-start-2 @xl:row-span-2 @xl:row-start-1 @xl:self-start">
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-slate-500">
            <span className="min-w-0 truncate">{row ? <>Preview · <b className="font-semibold text-slate-800">{row.label}</b> · {fm(row.from_m)}–{fm(row.to_m)} m</> : "Preview"}</span>
            {pq.isFetching && <Loader2 size={13} className="flex-none animate-spin" />}
          </div>
          {/* an A4 frame while a page is drawn or shown; a short note when there is none to show */}
          <div className={cn("relative mx-auto w-full max-w-[34rem] overflow-hidden rounded-md bg-white ring-1 ring-slate-200", (pq.data && !pErr) || (row?.ok && (swir || tir) && pq.isPending)
            ? "aspect-[210/297] shadow-[0_1px_3px_rgba(15,23,42,0.12),0_8px_28px_rgba(15,23,42,0.08)]" : "min-h-32")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL of a page drawn on request */}
            {pq.data && !pErr && <img ref={img} alt={row ? `Sample sheet for ${row.label}` : "Sample sheet"} className={cn("h-full w-full object-contain transition-opacity", pq.isPlaceholderData && "opacity-50")} />}
            {(!pq.data || pErr) && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs leading-relaxed text-slate-500">
                {!row ? "Pick a source to list intervals; the page of the one you click shows here."
                  : !(swir || tir) ? "Turn on SWIR or TIR to see a page."
                  : pErr?.code === "no_preview" ? <span><b className="block pb-1 font-semibold text-slate-700">Preview not available yet</b>The page can&rsquo;t be shown here yet, but it can be downloaded as a PDF.</span>
                  : pErr?.code === "no_package" ? (hole.source === "upload" ? "This scan's package is not kept on the platform, so its sheets cannot be drawn. Upload it again." : "This hole has no package or line scan to draw sheets from.")
                  : pErr ? "The preview could not be drawn right now; try again in a minute."
                  : <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />Drawing the page…</span>}
              </div>)}
          </div>
        </div>

        {/* what each page shows, and the downloads */}
        <div className="flex min-w-0 flex-col gap-3 self-start @xl:col-start-1 @xl:row-start-2">
          <div className="flex flex-col gap-2 text-xs text-slate-700">
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
          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
            <button type="button" onClick={() => download("sel")} disabled={!!making || !selected.length || !(swir || tir)} className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 sm:py-2">
              {making?.what === "sel" ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}Download selected ({pagesTxt(selected.length)})</button>
            <button type="button" onClick={() => download("all")} disabled={!!making || !usable.length || !(swir || tir)} className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:py-2">
              {making?.what === "all" ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}Download all ({pagesTxt(usable.length)})</button>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">{making ? `Making ${making.of > 1 ? `PDF ${making.part} of ${making.of}` : "the PDF"}… The pages are drawn from the scan package; a long list takes a minute or two.`
            : Math.max(selected.length, usable.length) > MAX_PAGES ? `A PDF holds at most ${MAX_PAGES} pages, so ${usable.length} pages come as ${nParts(usable.length)} PDFs, one after the other (the browser may ask to allow several downloads).`
            : "One PDF, a page per interval."}</p>
          {err && <p className="text-[11px] text-red-600" role="alert">{err}</p>}
        </div>
      </div>
    </div>
  );
}
