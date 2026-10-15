"use client";

import type { ModelView } from "@/lib/coreScan";
import { pct, SERIES } from "@/components/coretrace/palette";
import { cn } from "@/lib/utils";

const th = "border-b border-slate-200 px-2 py-1.5 text-left text-[11px] font-medium text-slate-500";
const td = "border-b border-slate-100 px-2 py-1.5 align-top text-xs text-slate-700";
const H = ({ children, n }: { children: React.ReactNode; n: number }) => (
  <h4 className="flex items-baseline gap-2 font-display text-[14px] font-semibold text-slate-900">{children}<span className="font-sans text-[11px] font-medium text-slate-500">{n}</span></h4>
);
const Empty = ({ children }: { children: React.ReactNode }) => <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">{children}</div>;

/** The Unusual tab: the metres that stand out from their surroundings (the anomaly detector's flags), each a row
 * that opens its window on the log. Data only: the page asks nothing of the reader. */
export function LookAgain({ mv, metre, onJump }: { mv: ModelView; metre: number | null; onJump: (m: number, to?: number) => void }) {
  const flags = mv.anomaly.runs;
  const on = (d: { from_m: number; to_m: number }) => metre !== null && metre >= d.from_m && metre < d.to_m;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <H n={flags.length}>Metres that stand out from their surroundings</H>
        <p className="text-[11px] leading-relaxed text-slate-500">A metre is flagged when it differs from the 15 m either side of it more than {pct(1 - mv.anomaly.top_share)} of this hole does, and more than {pct(mv.anomaly.flag_at, 1)} of the State&rsquo;s training core. Nearby metres are joined into one interval.</p>
        {flags.length === 0 ? <Empty>Nothing in this hole stands out from its surroundings enough to flag.</Empty> : (
          <table className="w-full border-collapse">
            <thead><tr>{["Interval (m)", "Most unusual at", "Contrast with surroundings", "State percentile"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>{flags.map((r) => (
              <tr key={r.from_m} onClick={() => onJump(r.peak_m, r.to_m + 1)} className={cn("cursor-pointer hover:bg-slate-50", on(r) && "bg-cyan/10")}>
                <td className={cn(td, "font-mono")}>{r.from_m}–{r.to_m}</td><td className={cn(td, "font-mono")}>{r.peak_m} m</td>
                <td className={td}><span className="flex items-center gap-2"><span className="h-2 rounded-r-[4px]" style={{ width: `${Math.min(100, (r.raw / (flags[0].raw || 1)) * 100) * 0.6}%`, background: SERIES.orange }} /><span className="font-mono">{r.raw.toFixed(2)}</span></span></td>
                <td className={cn(td, "font-mono")}>{pct(r.peak, 1)}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>

    </div>
  );
}
