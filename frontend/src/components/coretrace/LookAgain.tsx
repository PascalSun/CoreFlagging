"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Search, X } from "lucide-react";
import { coreScan, type AgainInterval, type HoleDetail, type ModelView, type Review, type ReviewBody, type ReviewKind } from "@/lib/coreScan";
import { csvRows } from "@/lib/lookAgain";
import { chemText, chemistryOver, loggedOver } from "@/lib/package";
import { coreTypeColor, fmt, pct, SERIES } from "@/components/coretrace/palette";
import { isVerified } from "@/lib/auth";
import { cn } from "@/lib/utils";

const th = "border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-medium text-slate-500";
const td = "border-b border-slate-100 px-2 py-1.5 align-top text-xs text-slate-700";
const H = ({ children, n }: { children: React.ReactNode; n: number }) => (
  <h4 className="flex items-baseline gap-2 font-display text-[14px] font-semibold text-slate-900">{children}<span className="font-sans text-[11px] font-medium text-slate-500">{n}</span></h4>
);
const Empty = ({ children }: { children: React.ReactNode }) => <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">{children}</div>;

/** Agree / disagree on one suggestion. Shows everyone's count and the reader's own choice; a verified
 * person can set or clear theirs. Without a verified session the buttons explain instead of acting. */
function Verdict({ holeKey, body, reviews, canVote }: { holeKey: string; body: Omit<ReviewBody, "verdict">; reviews: Review[]; canVote: boolean }) {
  const qc = useQueryClient();
  const same = reviews.filter((r) => r.kind === body.kind && r.run === body.run && Math.abs(r.from_m - body.from_m) < 0.05 && Math.abs(r.to_m - body.to_m) < 0.05);
  const mine = same.find((r) => r.mine)?.verdict ?? null;
  const agree = same.filter((r) => r.verdict === "agree").length, disagree = same.length - agree;
  const mut = useMutation({
    mutationFn: async (v: "agree" | "disagree" | null) => { if (v === null) await coreScan.unreview(holeKey, body); else await coreScan.review(holeKey, { ...body, verdict: v }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["core-reviews", holeKey] }),
  });
  const btn = (v: "agree" | "disagree", Icon: typeof Check, label: string) => (
    <button type="button" disabled={!canVote || mut.isPending} onClick={(e) => { e.stopPropagation(); mut.mutate(mine === v ? null : v); }}
      title={canVote ? (mine === v ? "Withdraw your verdict" : label) : "Sign in with a verified email to record a verdict"}
      className={cn("inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        mine === v ? (v === "agree" ? "border-emerald-600 bg-emerald-600 text-white" : "border-rose-600 bg-rose-600 text-white") : "border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900")}>
      <Icon size={11} strokeWidth={2.5} />{label}
    </button>
  );
  return (
    <span className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {btn("agree", Check, "Agree")}{btn("disagree", X, "Disagree")}
      {same.length > 0 && <span className="pl-1 text-[10px] text-slate-500" title={`${agree} agree, ${disagree} disagree`}>{agree}<span className="text-emerald-600">✓</span> {disagree}<span className="text-rose-600">✗</span></span>}
    </span>
  );
}

function Minerals({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-400">—</span>;
  return <span className="flex items-center gap-1.5"><span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${Math.round(v * 100)}%`, background: SERIES.aqua }} /></span><span className="font-mono">{pct(v)}</span></span>;
}

/** The "Look again" list: the two kinds of suggestion the model makes about a hole, each a row a geologist can
 * check and answer. Disagreements with the log follow the one rule validated against chemistry (the ultramafic
 * rule); the flagged metres are the anomaly detector's. Both export as one sheet. */
type Scale = "all" | "unit" | "domain" | "metre" | "log" | "gap";
const SCALES: { id: Scale; label: string }[] = [{ id: "all", label: "All" }, { id: "unit", label: "Hole vs region" }, { id: "domain", label: "Domains" }, { id: "metre", label: "Metres" }, { id: "log", label: "Vs the log" }, { id: "gap", label: "Not logged" }];

export function LookAgain({ hole, mv, run, metre, onJump, onSimilar }: { hole: HoleDetail; mv: ModelView; run: string; metre: number | null; onJump: (m: number, to?: number) => void;
  /** open the similar-core search at this metre ("find more like this") */
  onSimilar?: (m: number) => void;
}) {
  const ds = useMemo(() => mv.summary.again?.intervals ?? [], [mv]);
  const flags = mv.anomaly.runs;
  const [scale, setScale] = useState<Scale>("all");
  const show = (k: Scale) => scale === "all" || scale === k;
  const stq = useQuery({ queryKey: ["core-standout", hole.key, run], queryFn: () => coreScan.standout(hole.key, run), staleTime: 10 * 60_000, retry: false });
  const st = stq.data;
  const holeFrom = hole.metres.m[0] ?? 0, holeTo = (hole.metres.m[hole.metres.m.length - 1] ?? 0) + 1;
  const more = (from: number, to: number) => onSimilar && (
    <button type="button" onClick={(e) => { e.stopPropagation(); onSimilar(Math.floor((from + to) / 2)); }} title="Find core like this elsewhere" className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 px-1.5 text-[11px] text-slate-600 hover:border-slate-400 hover:text-slate-900"><Search size={11} />More like this</button>
  );
  const canVote = isVerified();
  const rq = useQuery({ queryKey: ["core-reviews", hole.key], queryFn: () => coreScan.reviews(hole.key), staleTime: 30_000 });
  // the DMIRS HyLogger package: the company's log and multi-element assays behind a WA hole (404 elsewhere)
  const pq = useQuery({ queryKey: ["core-package", hole.key], queryFn: () => coreScan.package(hole.key), enabled: hole.source === "nvcl" && hole.state === "WA", staleTime: 60 * 60_000, retry: false });
  const pkg = pq.data;
  const reviews = rq.data?.reviews ?? [];
  const verdictOf = (kind: ReviewKind, from: number, to: number) => reviews.find((r) => r.mine && r.kind === kind && Math.abs(r.from_m - from) < 0.05 && Math.abs(r.to_m - to) < 0.05)?.verdict ?? "";
  const exportCsv = () => {
    const blob = new Blob([csvRows(hole.name, run, ds, flags, verdictOf, (from, to) => chemistryOver(pkg, from, to))], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `CoreFlagging_${hole.name.replace(/[^A-Za-z0-9_-]+/g, "_")}_look_again.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const on = (d: { from_m: number; to_m: number }) => metre !== null && metre >= d.from_m && metre < d.to_m;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs leading-relaxed text-slate-600">
        What the scan suggests looking at again, from the whole hole down to the metre: where this hole differs from its region, which domains differ from the rest of the hole, which metres differ from their surroundings, and where the model disagrees with the log. Suggestions, not findings: confirm each against the core, an assay or a geologist before acting on it.
      </p>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Scale">
        <span className="text-[11px] text-slate-500">Scale</span>
        {SCALES.map((sc) => <button key={sc.id} type="button" role="tab" aria-selected={scale === sc.id} onClick={() => setScale(sc.id)} className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1", scale === sc.id ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:ring-slate-400")}>{sc.label}</button>)}
      </div>

      {show("unit") && (
        <section className="flex flex-col gap-2">
          <H n={st?.hole_vs_region.items.length ?? 0}>This hole against its region</H>
          {!st ? <p className="text-[11px] text-slate-500">{stq.isPending ? "Comparing with the region…" : "Not available for this hole."}</p>
            : st.hole_vs_region.note ? <Empty>{st.hole_vs_region.note}</Empty>
            : st.hole_vs_region.items.length === 0 ? <Empty>Nothing this hole reads a lot of is unusual for {st.hole_vs_region.region || "its region"} ({st.hole_vs_region.n_holes} holes).</Empty>
            : (
              <ul className="flex flex-col gap-1.5">{st.hole_vs_region.items.map((it) => (
                <li key={it.k} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                  <span className="flex items-center gap-1.5 font-medium text-slate-900"><i className="inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(it.name) }} />{it.name}</span>
                  <span><b className="font-semibold text-slate-900">{pct(it.hole_share)}</b> of this hole · <b className="font-semibold text-slate-900">{pct(it.region_share)}</b> of a hole in {st.hole_vs_region.region} on average{it.ratio !== null ? ` · ${it.ratio}×` : " · not read there"}</span>
                  <span className="text-slate-500">in {it.region_holes_with} of {st.hole_vs_region.n_holes} holes</span>
                  <span className="ml-auto flex items-center gap-2">{more(holeFrom, holeTo)}<Verdict holeKey={hole.key} body={{ run, kind: "unit", from_m: holeFrom, to_m: holeTo }} reviews={reviews} canVote={canVote} /></span>
                </li>))}</ul>
            )}
          {st && !st.hole_vs_region.note && <p className="text-[11px] leading-relaxed text-slate-500">The region&rsquo;s profile is the average share of each rock class over its {st.hole_vs_region.n_holes} scanned holes ({st.hole_vs_region.region}); a type is listed when it is at least a tenth of this hole and three times that average. <a href="/regions" className="font-medium text-slate-700 underline-offset-2 hover:underline">Every region&rsquo;s profile</a>.</p>}
        </section>
      )}

      {show("gap") && hole.has_lith && (
        <section className="flex flex-col gap-2">
          <H n={st?.unlogged.length ?? 0}>Where the log has nothing</H>
          {!st ? <p className="text-[11px] text-slate-500">{stq.isPending ? "Reading…" : "Not available for this hole."}</p>
            : st.unlogged.length === 0 ? <Empty>The log covers every metre the model read.</Empty>
            : <ul className="flex flex-col gap-1 text-xs text-slate-700">{st.unlogged.map((u) => (
                <li key={u.from_m}><button type="button" onClick={() => onJump(u.from_m, u.to_m)} className="text-left hover:underline"><span className="font-mono">{u.from_m}–{u.to_m} m</span> ({u.length_m} m) · no logged rock · the model reads <b className="font-medium text-slate-900">{u.reads}</b> {u.share >= 0.995 ? "all the way through" : `over ${pct(u.share)} of it`}</button></li>))}</ul>}
          {st && st.unlogged.length > 0 && <p className="text-[11px] leading-relaxed text-slate-500">Gaps of 2 m or more with no logged rock. Not a disagreement: a place the scan can fill in where nobody wrote anything.</p>}
        </section>
      )}

      {show("domain") && (
        <section className="flex flex-col gap-2">
          <H n={st?.domains.length ?? 0}>Domains unlike the rest of the hole</H>
          {!st ? <p className="text-[11px] text-slate-500">{stq.isPending ? "Reading the domains…" : "Not available for this hole."}</p>
            : st.domains.length === 0 ? <Empty>Every domain of the auto log is made of what the rest of the hole is made of.</Empty>
            : (
              <table className="w-full border-collapse">
                <thead><tr>{["Interval (m)", "The model reads", "Why it stands out", "Your verdict"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>{st.domains.map((d) => (
                  <tr key={`${d.from_m}-${d.to_m}`} onClick={() => onJump(Math.floor(d.from_m), d.to_m)} className={cn("cursor-pointer hover:bg-slate-50", on(d) && "bg-cyan/10")}>
                    <td className={cn(td, "font-mono whitespace-nowrap")}>{d.from_m.toFixed(1)}–{d.to_m.toFixed(1)}<div className="text-[10px] text-slate-400">{d.length_m} m</div></td>
                    <td className={td}><span className="flex items-start gap-1.5"><i className="mt-[0.35em] inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(d.type) }} />{d.type}</span></td>
                    <td className={td}>{d.why.map((w, i) => <div key={i}>{w.text}</div>)}</td>
                    <td className={cn(td, "whitespace-nowrap")}><span className="flex items-center gap-2">{more(d.from_m, d.to_m)}<Verdict holeKey={hole.key} body={{ run, kind: "domain", from_m: d.from_m, to_m: d.to_m }} reviews={reviews} canVote={canVote} /></span></td>
                  </tr>))}</tbody>
              </table>
            )}
        </section>
      )}

      {show("log") && <section className="flex flex-col gap-2">
        <H n={ds.length}>Where the model disagrees with the log</H>
        {!hole.has_lith ? <Empty>No geologist&rsquo;s log came with this scan, so there is nothing to compare the reading with.</Empty>
          : ds.length === 0 ? <Empty>The log and the model agree, by the one rule we have validated (ultramafic rock logged as something else, or the reverse). Other kinds of disagreement are not listed until they have been checked against chemistry the same way.</Empty>
          : (
            <table className="w-full border-collapse">
              <thead><tr>{["Interval (m)", "The log says", "The model reads", "Talc, serpentine, Mg-chlorite", pkg ? "Chemistry (WAMEX)" : "Gold assays", "Your verdict"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{ds.map((d: AgainInterval) => (
                <tr key={`${d.from_m}-${d.to_m}`} onClick={() => onJump(d.from_m, d.to_m)} className={cn("cursor-pointer hover:bg-slate-50", on(d) && "bg-cyan/10")}>
                  <td className={cn(td, "font-mono whitespace-nowrap")}>{d.from_m}–{d.to_m}<div className="text-[10px] text-slate-400">{d.length_m} m</div></td>
                  <td className={td}><span className="font-medium text-slate-900">{d.logged || d.logged_class}</span>{d.logged && d.logged !== d.logged_class && <div className="text-[10px] text-slate-500">{d.logged_class}</div>}
                    {(() => { const l = loggedOver(pkg, d.from_m, d.to_m); return l.length ? <div className="mt-0.5 text-[10px] leading-snug text-slate-500" title="The company's own log for this depth, from the WAMEX report">WAMEX log: {l.join("; ")}</div> : null; })()}</td>
                  <td className={td}><span className="flex items-start gap-1.5"><i className="mt-[0.35em] inline-block h-2.5 w-2.5 flex-none rounded-[2px]" style={{ background: coreTypeColor(d.reads) }} />{d.reads}</span><div className="text-[10px] text-slate-500">{pct(d.share)} of the interval{d.flagged ? ` · ${d.flagged} m also stand out` : ""}</div></td>
                  <td className={td}><Minerals v={d.um_minerals} /></td>
                  <td className={cn(td, "whitespace-nowrap")}>{pkg ? (() => { const c = chemistryOver(pkg, d.from_m, d.to_m); return c.n
                      ? <><span className="font-medium text-slate-900">{chemText(c) || `${c.n} samples`}</span><div className="text-[10px] text-slate-500">{c.n} {c.n === 1 ? "sample" : "samples"} in the interval{c.mgo !== null ? (c.mgo >= 18 ? " · ultramafic chemistry" : c.mgo <= 10 ? " · not ultramafic" : "") : ""}</div></>
                      : <span className="text-slate-400">no chemistry here</span>; })()
                    : d.assays.n ? <>{d.assays.n} m assayed<div className="text-[10px] text-slate-500">{d.assays.pos ? `${d.assays.pos} m at or above 0.1 ppm · max ${fmt(d.assays.max, 2)}` : "no gold in them"}</div></> : <span className="text-slate-400">none</span>}</td>
                  <td className={cn(td, "whitespace-nowrap")}><span className="flex items-center gap-2">{more(d.from_m, d.to_m)}<Verdict holeKey={hole.key} body={{ run, kind: "log", from_m: d.from_m, to_m: d.to_m }} reviews={reviews} canVote={canVote} /></span></td>
                </tr>))}</tbody>
            </table>
          )}
        {pkg && <p className="text-[11px] leading-relaxed text-slate-500">Chemistry and the WAMEX log come from DMIRS&rsquo;s HyLogger drillhole package (interim, Oct 2026): {pkg.assays.rows.length.toLocaleString()} assayed intervals and {pkg.geology.length.toLocaleString()} logged intervals for this hole{pkg.anumber ? `, report ${pkg.anumber}` : ""}. MgO above about 18% with high Ni and Cr is ultramafic chemistry; below 10% it is not.</p>}
        {ds.length > 0 && <p className="text-[11px] leading-relaxed text-slate-500">Rule: at least 5 m with the model&rsquo;s talc&ndash;serpentine type over half of it, inside an interval the log calls something else (or the reverse). Over 102 such disagreements in WA with chemistry, the chemistry sided with the model in 74%, against 51% by chance. The mineral bar is the scanner&rsquo;s own reading of talc, serpentine and Mg-chlorite, independent of the model.</p>}
      </section>}

      {show("metre") && <section className="flex flex-col gap-2">
        <H n={flags.length}>Metres that stand out from their surroundings</H>
        <p className="text-[11px] leading-relaxed text-slate-500">A metre is flagged when it differs from the 15 m either side of it more than {pct(1 - mv.anomaly.top_share)} of this hole does, and more than {pct(mv.anomaly.flag_at, 1)} of the State&rsquo;s training core. Nearby metres are joined into one interval.</p>
        {flags.length === 0 ? <Empty>Nothing in this hole stands out from its surroundings enough to flag.</Empty> : (
          <table className="w-full border-collapse">
            <thead><tr>{["Interval (m)", "Most unusual at", "Contrast with surroundings", "State percentile", "Your verdict"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{flags.map((r) => (
              <tr key={r.from_m} onClick={() => onJump(r.peak_m, r.to_m + 1)} className={cn("cursor-pointer hover:bg-slate-50", on(r) && "bg-cyan/10")}>
                <td className={cn(td, "font-mono")}>{r.from_m}–{r.to_m}</td><td className={cn(td, "font-mono")}>{r.peak_m} m</td>
                <td className={td}><span className="flex items-center gap-2"><span className="h-2 rounded-r-[4px]" style={{ width: `${Math.min(100, (r.raw / (flags[0].raw || 1)) * 100) * 0.6}%`, background: SERIES.orange }} /><span className="font-mono">{r.raw.toFixed(2)}</span></span></td>
                <td className={cn(td, "font-mono")}>{pct(r.peak, 1)}</td>
                <td className={cn(td, "whitespace-nowrap")}><span className="flex items-center gap-2">{more(r.from_m, r.to_m)}<Verdict holeKey={hole.key} body={{ run, kind: "flag", from_m: r.from_m, to_m: r.to_m }} reviews={reviews} canVote={canVote} /></span></td>
              </tr>))}</tbody>
          </table>
        )}
      </section>}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
        <button type="button" onClick={exportCsv} disabled={ds.length + flags.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"><Download size={13} />Export the list (CSV)</button>
        <span className="text-[11px] text-slate-500">{canVote ? "Your verdicts are saved with the hole and go into the export." : "Sign in with a verified email to record a verdict."}</span>
      </div>
    </div>
  );
}
