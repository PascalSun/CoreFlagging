"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Eye, EyeOff, Focus, Info, Minimize2 } from "lucide-react";
import type { HoleRow } from "@/lib/coreScan";
import { ColourNote } from "@/components/coretrace/ColourNote";
import { INFERRED_LABEL, OTHER_LABEL, RAW_LABEL, READ_LABEL, RECORDED_LABEL, UNKNOWN_LABEL, classify, coreFamily, shapeOf, sourceOf } from "@/components/coretrace/mapColour";
import { Mark } from "@/components/coretrace/shapes";
import { cn } from "@/lib/utils";

// ---- what the key filters by: four facets, each a set of hidden rows, and a range of years drilled

export type Facet = "core" | "target" | "source" | "shape";
export type Hidden = Record<Facet, ReadonlySet<string>>;
export const NO_HIDDEN: Hidden = { core: new Set(), target: new Set(), source: new Set(), shape: new Set() };
export const PANEL_W = 300;

/** A hole's place in each facet; null where the facet does not apply (no target known, no model reading). */
export type Faceted = { h: HoleRow; core: string | null; target: string; source: string | null; shape: string; year: number | null; again: boolean; glyph?: string; color: string };
export function facet(h: HoleRow, typeName: Map<number, string>): Faceted {
  const c = classify(h);
  return { h, core: coreFamily(h, typeName), target: c.label, source: sourceOf(h), shape: shapeOf(h)?.label ?? READ_LABEL, year: h.drilled ?? null, again: h.n_again > 0, glyph: c.glyph, color: c.color };
}

/** Whether a hole passes the key, leaving one facet out (for that facet's own counts). `again` keeps only the holes worth a second look. A hole with no rock class
 * passes the core facet only while no rock class is hidden; a hole with no year passes any range. */
export function passes(f: Faceted, hidden: Hidden, years: [number, number] | null, again: boolean, skip?: Facet | "year" | "again"): boolean {
  if (skip !== "again" && again && !f.again) return false;
  if (skip !== "target" && hidden.target.has(f.target)) return false;
  if (skip !== "source" && f.source && hidden.source.has(f.source)) return false;
  if (skip !== "shape" && hidden.shape.has(f.shape)) return false;
  if (skip !== "core" && hidden.core.size && (!f.core || hidden.core.has(f.core))) return false;
  if (skip !== "year" && years && f.year !== null && (f.year < years[0] || f.year > years[1])) return false;
  return true;
}
export const filtering = (hidden: Hidden, years: [number, number] | null, again: boolean) => again || Object.values(hidden).some((s) => s.size > 0) || years !== null;

const tally = (rows: Faceted[], key: (f: Faceted) => string | number | null) => {
  const c = new Map<string, number>(); for (const f of rows) { const k = key(f); if (k !== null) c.set(String(k), (c.get(String(k)) ?? 0) + 1); } return c;
};
const NEUTRAL = "#94a3b8";

// ---- tooltips: the key scrolls inside a blurred panel, which would clip a bubble (and a bubble wider than the
// panel would let it scroll sideways), so the bubble is drawn on the page, over everything, from [data-keytip]

export function KeyTips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean; end?: number } | null>(null);
  useEffect(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-keytip]") as HTMLElement | null;
      if (!el) { setTip(null); return; }
      const r = el.getBoundingClientRect();
      // [data-keytip-end]: the bubble's right edge lines up with its group's right edge (the row's hover actions)
      const end = el.dataset.keytipEnd !== undefined ? el.parentElement?.getBoundingClientRect().right : undefined;
      setTip({ text: el.dataset.keytip ?? "", x: r.left + r.width / 2, y: r.top < 60 ? r.bottom + 6 : r.top - 6, below: r.top < 60, end });
    };
    const away = () => setTip(null);
    document.addEventListener("mouseover", over); document.addEventListener("scroll", away, true); document.addEventListener("click", away, true);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("scroll", away, true); document.removeEventListener("click", away, true); };
  }, []);
  if (!tip) return null;
  // centred on the control (or ending where its group ends), kept 8 px inside the window
  const w = Math.min(256, window.innerWidth - 16), left = Math.max(8, Math.min(window.innerWidth - w - 8, tip.end !== undefined ? tip.end - w : tip.x - w / 2));
  return createPortal(
    <div role="tooltip" className="pointer-events-none fixed z-[90] flex" style={{ left, width: w, top: tip.y, transform: tip.below ? undefined : "translateY(-100%)", justifyContent: tip.end !== undefined ? "flex-end" : tip.x - left < 40 ? "flex-start" : tip.x - left > w - 40 ? "flex-end" : "center" }}>
      <span className="rounded-md bg-slate-900 px-2 py-1 text-[11px] leading-snug font-medium text-white shadow-lg">{tip.text}</span>
    </div>,
    document.body,
  );
}

// ---- a row: mark, name and count; on hover "show only this" and "hide" float over its right end

function Row({ label, n, off, only, onOnly, onHide, mark, info, hint, bar, onClick, open }: {
  label: string; n: number; off: boolean; only: boolean; onOnly: () => void; onHide: () => void;
  mark?: React.ReactNode; info?: string; hint?: string; bar?: number; onClick?: () => void; open?: boolean;
}) {
  const quiet = off || n === 0;
  return (
    <div className="group relative rounded-lg hover:bg-white/90" onClick={onClick ?? onHide}>
      <div className={cn("flex cursor-pointer items-center gap-2.5 px-2", bar === undefined ? "min-h-8 py-1" : "pt-1.5")}>
        {mark && <span className={cn("grid size-6 flex-none place-items-center", quiet && "opacity-35")}>{mark}</span>}
        <span className={cn("min-w-0 flex-1", quiet && "opacity-40")}>
          <span className="flex items-center gap-1 text-[13px] font-medium text-slate-800">
            <span className={cn("truncate", off && "line-through decoration-slate-400")}>{label}</span>
            {info && <span data-keytip={info} onClick={(e) => e.stopPropagation()} className="grid size-4 flex-none cursor-help place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-800"><Info size={12} /></span>}
            {open !== undefined && <ChevronDown size={14} className={cn("flex-none text-slate-400 transition-transform", open && "rotate-180")} />}
          </span>
          {hint && <span className="mt-px block text-[11px] leading-snug text-slate-500">{hint}</span>}
        </span>
        <span className={cn("flex-none font-mono text-[11.5px] tabular-nums", quiet ? "text-slate-300" : "text-slate-500")}>{n.toLocaleString()}</span>
      </div>
      {bar !== undefined && <div className={cn("mx-2 mt-1.5 mb-2 h-0.5 rounded-full bg-slate-900/[0.08]", quiet && "opacity-40")}><i className="block h-full rounded-full bg-slate-500" style={{ width: `${bar * 100}%` }} /></div>}
      <span className="absolute top-1/2 right-1.5 z-10 hidden -translate-y-1/2 gap-0.5 rounded-[10px] bg-white p-[3px] shadow-[0_0_0_1px_rgba(15,23,42,0.08),0_4px_14px_rgba(15,23,42,0.16)] group-focus-within:flex group-hover:flex" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onOnly} aria-label={only ? "Show all again" : "Show only this"} data-keytip={only ? "Show all again" : "Show only this"} data-keytip-end=""
          className={cn("grid h-[26px] w-[30px] place-items-center rounded-[7px]", only ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}><Focus size={15} /></button>
        <button type="button" onClick={onHide} aria-label={off ? "Show" : "Hide"} data-keytip={off ? "Show" : "Hide"} data-keytip-end=""
          className="grid h-[26px] w-[30px] place-items-center rounded-[7px] text-slate-600 hover:bg-slate-100 hover:text-slate-900">{off ? <EyeOff size={15} /> : <Eye size={15} />}</button>
      </span>
    </div>
  );
}

/** The "Dominant rock types" section is hidden for now; the filter behind it stays, so it can come back. */
const SHOW_ROCK_TYPES = false;

function Section({ title, tag, info, onReset, children }: { title: string; tag?: string; info?: string; onReset?: () => void; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/75 px-2 pt-3 pb-2 first:border-t-0">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <h3 className="font-display text-[10.5px] leading-none font-semibold tracking-[0.12em] text-slate-800 uppercase">{title}</h3>
        {tag && <span className="font-mono text-[10px] text-slate-400">{tag}</span>}
        {info && <span data-keytip={info} className="grid size-4 cursor-help place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-800"><Info size={12} /></span>}
        {onReset && <button type="button" onClick={onReset} className="ml-auto text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:underline">Show all</button>}
      </div>
      {children}
    </section>
  );
}

const More = ({ open, n, onClick }: { open: boolean; n: number; onClick: () => void }) => n > 0 ? (
  <button type="button" onClick={onClick} className="mx-2 mt-0.5 flex items-center gap-1 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
    {open ? "Show fewer" : `Show ${n} more`}<ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
  </button>) : null;

/** The sections of the key: rock class, target commodity, where the target comes from, model reading, year drilled
 * (rock class is hidden for now). Each count is of the holes the other sections let through. */
export function MapKeyBody({ rows, hidden, onHidden, years, onYears, again }: {
  rows: Faceted[]; hidden: Hidden; onHidden: (f: Facet, s: Set<string>) => void;
  years: [number, number] | null; onYears: (y: [number, number] | null) => void;
  /** only the holes worth a second look (switched in the top bar; the counts follow it) */
  again: boolean;
}) {
  const [more, setMore] = useState({ core: false, target: false }); const [othersOpen, setOthersOpen] = useState(false);
  // the rows of each section, in the order of their totals, so a row stays put while the counts change
  const order = useMemo(() => {
    const by = (key: (f: Faceted) => string | null) => [...tally(rows, key).entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const target = by((f) => f.target);
    return {
      core: by((f) => f.core), source: [RECORDED_LABEL, INFERRED_LABEL], shape: [READ_LABEL, RAW_LABEL],
      target: [...target.filter((k) => k !== OTHER_LABEL && k !== UNKNOWN_LABEL), ...target.filter((k) => k === OTHER_LABEL), ...target.filter((k) => k === UNKNOWN_LABEL)],
    };
  }, [rows]);
  const look = useMemo(() => new Map(rows.map((f) => [f.target, f] as const)), [rows]);
  const count = useMemo(() => ({
    core: tally(rows.filter((f) => passes(f, hidden, years, again, "core")), (f) => f.core),
    target: tally(rows.filter((f) => passes(f, hidden, years, again, "target")), (f) => f.target),
    source: tally(rows.filter((f) => passes(f, hidden, years, again, "source")), (f) => f.source),
    shape: tally(rows.filter((f) => passes(f, hidden, years, again, "shape")), (f) => f.shape),
    other: tally(rows.filter((f) => f.target === OTHER_LABEL && passes(f, hidden, years, again, "target")), (f) => f.h.target),
    year: tally(rows.filter((f) => passes(f, hidden, years, again, "year")), (f) => f.year),
  }), [rows, hidden, years, again]);

  const isOnly = (fc: Facet, k: string) => hidden[fc].size === order[fc].length - 1 && !hidden[fc].has(k);
  const row = (fc: Facet, k: string, props: Partial<React.ComponentProps<typeof Row>> = {}) => {
    const off = hidden[fc].has(k), only = isOnly(fc, k);
    const toggle = () => { const s = new Set(hidden[fc]); if (off) s.delete(k); else s.add(k); onHidden(fc, s); };
    return <Row key={k} label={k} n={count[fc].get(k) ?? 0} off={off} only={only} onHide={toggle}
      onOnly={() => onHidden(fc, only ? new Set() : new Set(order[fc].filter((x) => x !== k)))} {...props} />;
  };
  const reset = (fc: Facet) => hidden[fc].size ? () => onHidden(fc, new Set()) : undefined;

  const cmax = Math.max(1, ...order.core.map((k) => count.core.get(k) ?? 0));
  const named = order.target.filter((k) => k !== OTHER_LABEL && k !== UNKNOWN_LABEL);
  const kinds = [...count.other.entries()].sort((a, b) => b[1] - a[1]);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const targetRow = (k: string) => { const f = look.get(k); return row("target", k, { mark: <Mark color={f?.color ?? NEUTRAL} glyph={f?.glyph} size={20} /> }); };

  // year drilled: only when the hole list carries the year
  const yearSpan = useMemo(() => { const ys = rows.map((f) => f.year).filter((y): y is number => y !== null); return ys.length ? [Math.min(...ys), Math.max(...ys)] as [number, number] : null; }, [rows]);
  const undated = useMemo(() => rows.filter((f) => f.year === null).length, [rows]);

  return (
    <>
      {SHOW_ROCK_TYPES && order.core.length > 0 && (
        <Section title="Dominant rock types" info="The rock type the models read most often down the hole, by its leading mineral. Raw-scan holes have no model reading and so no rock type: they show while every rock type is on, and drop out once any is hidden." onReset={reset("core")}>
          {(more.core ? order.core : order.core.slice(0, 5)).map((k) => row("core", k, { bar: (count.core.get(k) ?? 0) / cmax }))}
          <More open={more.core} n={order.core.length - 5} onClick={() => setMore((m) => ({ ...m, core: !m.core }))} />
        </Section>
      )}

      <Section title="Target commodity" tag="colour" onReset={reset("target")}>
        {named.slice(0, 6).map(targetRow)}
        <More open={more.target} n={named.length - 6} onClick={() => setMore((m) => ({ ...m, target: !m.target }))} />
        {more.target && named.slice(6).map(targetRow)}
        {order.target.includes(OTHER_LABEL) && <>
          {row("target", OTHER_LABEL, { mark: <Mark color="#64748b" glyph="+" size={20} />, open: othersOpen, onClick: () => setOthersOpen((o) => !o),
            info: `Commodities with too few holes for a colour of their own${kinds.length ? `: ${kinds.map(([k]) => cap(k)).join(", ")}` : ""}. Click the row to list them.` })}
          {othersOpen && <div className="mr-2 mb-1 ml-11 border-l border-slate-200 py-0.5 pl-2.5 text-[11.5px] text-slate-600">
            {kinds.map(([k, v]) => <div key={k} className="flex justify-between py-px"><span>{cap(k)}</span><span className="font-mono text-slate-400">{v.toLocaleString()}</span></div>)}
          </div>}
        </>}
        {order.target.includes(UNKNOWN_LABEL) && row("target", UNKNOWN_LABEL, { mark: <Mark color="#cbd5e1" glyph=" " size={20} />,
          info: "No target is recorded on the hole, and there is no exploration report or known deposit nearby to infer one from." })}
        <div className="px-1.5 pt-1"><ColourNote kind="target" inline /></div>
      </Section>

      <Section title="Where the target comes from" tag="fill" onReset={reset("source")}>
        {row("source", RECORDED_LABEL, { mark: <Mark color={NEUTRAL} glyph=" " size={20} />, hint: "The survey's own record of the hole" })}
        {row("source", INFERRED_LABEL, { mark: <Mark color={NEUTRAL} glyph=" " hatched size={20} />, hint: "From the exploration report (QLD, NT) or the nearest deposit within 5 km (NSW, TAS)" })}
      </Section>

      <Section title="Model reading" tag="shape" onReset={reset("shape")}>
        {row("shape", READ_LABEL, { mark: <Mark color={NEUTRAL} glyph=" " size={20} />, hint: "Rock types, look-again intervals, everything" })}
        {row("shape", RAW_LABEL, { mark: <Mark shape="square" color={NEUTRAL} glyph=" " size={20} />, hint: "Chips, a heavy mask or another band grid: the models cannot read it, so only the scan is shown" })}
      </Section>

      {yearSpan && (
        <Section title="Year drilled" info={`The year the hole was drilled. ${undated.toLocaleString()} holes have no date on record; they stay on the map whatever range is picked.`} onReset={years ? () => onYears(null) : undefined}>
          <Years span={yearSpan} counts={count.year} value={years ?? yearSpan} onChange={(y) => onYears(y[0] === yearSpan[0] && y[1] === yearSpan[1] ? null : y)} />
        </Section>
      )}
    </>
  );
}

/** A bar a year, and a two-handled range under them. */
function Years({ span, counts, value, onChange }: { span: [number, number]; counts: Map<string, number>; value: [number, number]; onChange: (y: [number, number]) => void }) {
  const ys: [number, number][] = []; for (let y = span[0]; y <= span[1]; y++) ys.push([y, counts.get(String(y)) ?? 0]);
  const max = Math.max(1, ...ys.map(([, v]) => v)), w = span[1] - span[0] || 1;
  const set = (i: 0 | 1, v: number) => { const next: [number, number] = [...value]; next[i] = v; onChange(next[0] <= next[1] ? next : [next[1], next[0]]); };
  return (
    <div className="px-2">
      <span className="font-mono text-[10.5px] text-slate-400">{max.toLocaleString()}</span>
      <div className="mt-1 flex h-16 items-end gap-px">
        {ys.map(([y, v]) => <i key={y} title={`${y}: ${v.toLocaleString()} holes`} className={cn("min-h-0.5 flex-1 rounded-t-[1px] bg-slate-500", (y < value[0] || y > value[1]) && "opacity-20")} style={{ height: `${(100 * v) / max}%` }} />)}
      </div>
      <div className="ct-range relative mt-0.5 h-[18px]">
        <span className="absolute top-2 h-0.5 rounded-full bg-slate-900" style={{ left: `${(100 * (value[0] - span[0])) / w}%`, right: `${(100 * (span[1] - value[1])) / w}%` }} />
        <input type="range" min={span[0]} max={span[1]} value={value[0]} onChange={(e) => set(0, Number(e.target.value))} aria-label="From year" />
        <input type="range" min={span[0]} max={span[1]} value={value[1]} onChange={(e) => set(1, Number(e.target.value))} aria-label="To year" />
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[11.5px] text-slate-700"><span>{value[0]}</span><span>{value[1]}</span></div>
    </div>
  );
}

/** The key on a wide screen: a single column down the left edge of the map, folding to its title. */
export function MapKey({ rows, shown, waiting, folded, onFold, onReset, ...body }: React.ComponentProps<typeof MapKeyBody> & {
  /** holes the key lets through */
  shown: number; waiting: number; folded: boolean; onFold: (f: boolean) => void; onReset: () => void;
}) {
  const on = filtering(body.hidden, body.years, body.again);
  return (
    <aside data-tour="legend" aria-label="Map key" style={{ width: PANEL_W }}
      className={cn("absolute top-[68px] left-3 z-10 flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-white/60 bg-white/90 shadow-glass backdrop-blur-xl", !folded && "bottom-3")}>
      <div className="flex items-center gap-2 border-b border-white/75 py-2 pr-2 pl-4">
        <b className="font-display text-sm font-bold tracking-tight">Drillholes</b>
        <span className="ml-auto text-[11.5px] whitespace-nowrap text-slate-500">
          {on ? <><b className="font-mono font-semibold text-slate-700">{shown.toLocaleString()}</b> of <b className="font-mono font-semibold text-slate-700">{rows.length.toLocaleString()}</b> shown</>
            : <><b className="font-mono font-semibold text-slate-700">{rows.length.toLocaleString()}</b> holes</>}
        </span>
        <button type="button" onClick={() => onFold(!folded)} aria-label={folded ? "Open the key" : "Fold the key"} data-keytip={folded ? "Open the key" : "Fold the key"}
          className="grid size-7 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900">{folded ? <ChevronDown size={16} /> : <Minimize2 size={15} />}</button>
      </div>
      {!folded && <>
        <div className="flex-1 overflow-x-hidden overflow-y-auto pt-0.5 pb-1.5 [scrollbar-width:thin]"><MapKeyBody rows={rows} {...body} /></div>
        <div className="flex items-center gap-2 border-t border-white/75 px-4 pt-2 pb-2.5 text-[11.5px] text-slate-500">
          {waiting > 0 && <><i className="inline-block size-1.5 rounded-full bg-slate-50 ring-1 ring-slate-300" />{waiting.toLocaleString()} still being processed</>}
          {on && <button type="button" onClick={onReset} className="ml-auto font-semibold text-slate-800 hover:underline">Show every hole</button>}
        </div>
      </>}
    </aside>
  );
}
