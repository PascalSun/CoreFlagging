"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Download, Info, Loader2, MessageCircle, Search, X } from "lucide-react";
import { commodityName, coreScan, type HoleRow, inferred, TARGET_SOURCE_LABEL } from "@/lib/coreScan";
import { csvSheet } from "@/lib/lookAgain";
import { NONE, coreTypeColor, fmt } from "@/components/coretrace/palette";
import { Mark, type Shape } from "@/components/coretrace/shapes";
import { STATUS_LABEL } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

type Look = { color: string; label: string; ring?: string; wait?: boolean; shape?: Shape; shapeLabel?: string; glyph?: string; hatched?: boolean };
type Key = "name" | "state" | "target" | "depth" | "again" | "gold" | "issues";
const PAGE = 100;

// the strips colour each rock type by its leading mineral; one example name per colour gives the key (behind the ⓘ)
const KEY: [string, string][] = [
  ["Chlorite", "Quartz + chlorite"], ["White mica", "Quartz + white mica"], ["Kaolin", "Quartz + kaolin"], ["Carbonate", "Carbonate"],
  ["Amphibole", "Amphibole"], ["Smectite", "Smectite"], ["Dark mica", "Dark mica"], ["Plagioclase, no SWIR minerals", "Plagioclase"],
  ["Quartz, no SWIR minerals", "Quartz"], ["Other", "Other"],
];

/** The key to the rock-type strips: an ⓘ by the column's name, opening on hover or focus. */
function RockKey() {
  return (
    <span className="group relative inline-flex">
      <button type="button" aria-label="What the colours mean" className="grid size-4 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-800 focus-visible:text-slate-800"><Info size={12} /></button>
      <span role="tooltip" className="pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 hidden w-60 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] font-normal text-slate-600 shadow-glass group-focus-within:block group-hover:block">
        <span className="mb-2 block leading-snug">Down the hole, top to bottom, each rock type coloured by its leading mineral:</span>
        <span className="grid grid-cols-1 gap-1">
          {KEY.map(([label, name]) => <span key={label} className="flex items-center gap-1.5"><i className="inline-block size-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(name) }} />{label}</span>)}
          <span className="flex items-center gap-1.5"><i className="inline-block size-2.5 flex-none rounded-[2px] ring-1 ring-slate-200" style={{ background: NONE }} />No model reading</span>
        </span>
      </span>
    </span>
  );
}

/** Every hole on the map as a table, its own tab beside the map: search, sort, open. */
export function HoleTable({ holes, q, onQ, look, typeName, onOpen, onAsk, loading, sheet }: {
  holes: HoleRow[]; q: string; onQ: (q: string) => void; look: (h: HoleRow) => Look; typeName: Map<number, string>;
  onOpen: (key: string) => void; onAsk?: () => void; loading: boolean;
  /** the State and search the "worth a second look" sheet is exported for */
  sheet?: { state: string; q: string };
}) {
  const [sort, setSort] = useState<{ k: Key; desc: boolean }>({ k: "state", desc: true });   // by State, descending: WA first
  const [shown, setShown] = useState(PAGE);
  const [exporting, setExporting] = useState(false);
  const againHoles = holes.filter((h) => h.n_again > 0).length;
  // the cross-hole sheet: every disagreement in the State (and search) shown, holes with the most metres first
  const exportSheet = async () => {
    setExporting(true);
    try {
      const got = await coreScan.lookAgain(sheet?.state ?? "", sheet?.q ?? "");
      const blob = new Blob([csvSheet(got.model, got.rows)], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `CoreTrace_look_again_${sheet?.state || "all"}${sheet?.q ? "_" + sheet.q.replace(/[^A-Za-z0-9]+/g, "_") : ""}.csv`; a.click(); URL.revokeObjectURL(a.href);
    } finally { setExporting(false); }
  };
  const rows = useMemo(() => {
    const v = (h: HoleRow): number | string => sort.k === "name" ? h.name.toLowerCase() : sort.k === "state" ? h.state : sort.k === "target" ? h.target || "~" : sort.k === "depth" ? h.depth_max ?? -1 : sort.k === "again" ? h.again_m : sort.k === "gold" ? h.au_pos_m * 1e6 + h.au_m : h.n_issues;
    return [...holes].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.status === "ready") - Number(a.status === "ready")
      || (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * (sort.desc ? -1 : 1));
  }, [holes, sort]);
  const head = (k: Key, label: string, cls = "") => (
    <th scope="col" className={cn("sticky top-0 z-10 bg-white/95 px-3 py-2 font-medium backdrop-blur", cls)}>
      <button type="button" onClick={() => { setSort((s) => ({ k, desc: s.k === k ? !s.desc : k !== "name" && k !== "state" })); setShown(PAGE); }}
        className={cn("inline-flex items-center gap-1 hover:text-slate-900", sort.k === k && "text-slate-900")}>
        {label}{sort.k === k && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </th>
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200/70 px-4 py-3">
        <label className="flex min-w-0 flex-1 basis-[240px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-cyan">
          <Search size={14} className="text-slate-400" />
          <input autoFocus value={q} onChange={(e) => { onQ(e.target.value); setShown(PAGE); }} placeholder="Find a hole, company, project or region" aria-label="Search holes"
            onKeyDown={(e) => { if (e.key === "Enter" && rows[0]) onOpen(rows[0].key); }} className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
          {q && <button type="button" onClick={() => onQ("")} aria-label="Clear the search" className="text-slate-400 hover:text-slate-700"><X size={14} /></button>}
        </label>
        <span className="text-xs text-slate-500">{loading ? "Loading holes…" : `${rows.length.toLocaleString()} holes`}{!loading && againHoles > 0 && <span className="text-slate-400"> · {againHoles.toLocaleString()} worth a second look</span>}</span>
        {againHoles > 0 && <button type="button" onClick={exportSheet} disabled={exporting} title="Every interval where the model disagrees with the log, for the holes shown, as a CSV" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60">{exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}Export the second-look sheet</button>}
        {onAsk && <button type="button" onClick={onAsk} className="ml-auto flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"><MessageCircle size={13} />Or ask: &ldquo;holes with gold in NSW&rdquo;</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {/* a phone gets a list of cards; the columns need a wide screen */}
        <ul className="divide-y divide-slate-100 sm:hidden">
          {rows.slice(0, shown).map((h) => {
            const c = look(h);
            return (
              <li key={h.key}>
                <button type="button" onClick={() => onOpen(h.key)} className="flex w-full flex-col gap-1 px-4 py-2.5 text-left active:bg-cyan/5">
                  <span className="flex items-center gap-2 text-sm">
                    {c.wait ? <i className="inline-block size-1.5 flex-none rounded-full bg-slate-400/70" /> : <Mark shape={c.shape} color={c.color} ring={c.ring} glyph={c.glyph ?? " "} hatched={c.hatched} size={11} />}
                    <span className="font-medium text-slate-900">{h.name}</span><span className="text-[11px] text-slate-400">{h.state}</span>
                    <span className="ml-auto font-mono text-[11px] text-slate-500">{h.depth_max !== null ? `${fmt(h.depth_max, 0)} m` : ""}</span>
                  </span>
                  <span className="truncate text-[11px] text-slate-500">{h.status !== "ready" ? STATUS_LABEL[h.status] : [h.operator, h.project].filter(Boolean).join(" · ") || "—"}{h.target ? ` · ${commodityName(h.target)}` : ""}{h.n_again > 0 ? ` · look again: ${fmt(h.again_m, 0)} m` : ""}{h.au_pos_m > 0 ? ` · gold ${h.au_pos_m} m ≥ 0.1 ppm` : ""}</span>
                  <span className="flex h-1.5 w-full overflow-hidden rounded-full" aria-hidden>
                    {h.strip?.length ? h.strip.map((k, i) => <i key={i} className="h-full flex-1" style={{ background: coreTypeColor(typeName.get(k)) }} />) : <i className="h-full flex-1" style={{ background: NONE }} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <table className="hidden w-full border-collapse text-left text-xs sm:table">
          <thead className="text-[11px] text-slate-500">
            <tr className="border-b border-slate-200">
              {head("name", "Hole")}{head("state", "State", "w-16")}
              <th scope="col" className="sticky top-0 z-10 bg-white/95 px-3 py-2 font-medium backdrop-blur">Company · project · region</th>
              {head("target", "Drilled for", "w-28")}
              <th scope="col" className="sticky top-0 z-20 w-44 bg-white/95 px-3 py-2 font-medium backdrop-blur"><span className="inline-flex items-center gap-1">Dominant rock types<RockKey /></span></th>
              {head("depth", "Depth", "w-20 text-right")}{head("again", "Look again", "w-28")}{head("gold", "Gold assays", "w-28")}{head("issues", "Issues", "w-16 text-right")}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((h) => {
              const c = look(h);
              return (
                <tr key={h.key} onClick={() => onOpen(h.key)} className="cursor-pointer border-b border-slate-100 hover:bg-cyan/5">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {c.wait ? <i className="inline-block size-1.5 flex-none rounded-full bg-slate-400/70" title={c.label} /> : <Mark shape={c.shape} color={c.color} ring={c.ring} glyph={c.glyph ?? " "} hatched={c.hatched} size={11} title={[c.label, c.shapeLabel].filter(Boolean).join(" · ")} />}
                      <span className="font-medium text-slate-900">{h.name}</span>
                      {h.offshore && <span className="rounded bg-sky-50 px-1 text-[10px] text-sky-800">Offshore</span>}
                      {h.status === "ready" && h.message && <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-600">No models</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{h.state || "Upload"}</td>
                  <td className="max-w-[22rem] truncate px-3 py-2 text-slate-600">{h.status !== "ready" ? <span className="text-slate-400">{STATUS_LABEL[h.status]}</span> : [h.operator, h.project, h.region].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2 text-slate-600" title={h.commodities.length > 1 ? h.commodities.map(commodityName).join(", ") : undefined}>{h.target ? <>{inferred(h.target_source) && <span className="text-slate-400" title={TARGET_SOURCE_LABEL[h.target_source]}>≈ </span>}{commodityName(h.target)}{h.commodities.length > 1 && <span className="text-slate-400"> +{h.commodities.length - 1}</span>}</> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2">
                    <span className="flex h-1.5 w-40 overflow-hidden rounded-full" aria-hidden>
                      {h.strip?.length ? h.strip.map((k, i) => <i key={i} className="h-full flex-1" style={{ background: coreTypeColor(typeName.get(k)) }} />) : <i className="h-full flex-1" style={{ background: NONE }} />}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">{h.depth_max !== null ? `${fmt(h.depth_max, 0)} m` : "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{h.n_again > 0 ? <span className="font-medium text-slate-900">{fmt(h.again_m, 0)} m<span className="font-normal text-slate-500"> · {h.n_again}</span></span> : h.has_lith && h.status === "ready" && !h.message ? <span className="text-slate-400">agree</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-slate-600">{h.au_pos_m > 0 ? <span className="font-medium text-slate-900">{h.au_pos_m} m ≥ 0.1 ppm</span> : h.au_m > 0 ? `${h.au_m} m assayed` : <span className="text-slate-400">none</span>}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{h.n_issues > 0 ? <span className="inline-flex items-center gap-0.5"><AlertTriangle size={10} />{h.n_issues}</span> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > shown && <button type="button" onClick={() => setShown((n) => n + PAGE * 3)} className="w-full py-3 text-xs font-medium text-slate-600 hover:bg-white">Show more ({(rows.length - shown).toLocaleString()} left)</button>}
        {!loading && !rows.length && <p className="px-4 py-10 text-center text-xs text-slate-500">No hole matches.</p>}
      </div>
    </div>
  );
}
