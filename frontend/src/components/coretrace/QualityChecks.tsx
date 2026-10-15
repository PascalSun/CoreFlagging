"use client";

import { CircleCheck, CircleMinus, CircleX } from "lucide-react";
import { fmt, issueLabel } from "@/components/coretrace/palette";
import type { DatasetRow, Issue } from "@/lib/coreScan";
import { cn } from "@/lib/utils";

/** The data-quality checks the cleaning pipeline runs on every hole (app/pipeline/preprocess.py, ISSUES). The pipeline
 * records only what failed, so a check with no issue of its codes passed, unless it could not run (`skip`). */
type Check = { id: string; label: string; rule: string; codes: string[]; skip?: (c: Ctx) => string | null };
type Ctx = { codes: Set<string>; datasets: DatasetRow[] };

const GROUPS: { title: string; checks: Check[] }[] = [
  { title: "Scan datasets", checks: [
    { id: "used", label: "Every scanned dataset is used", codes: ["dataset_skipped"],
      rule: "A dataset is dropped when it is chips (samples over 25 cm apart), lacks spectra or the validity mask, or a higher-priority instrument already covers its depths." },
    { id: "valid", label: "At least half the samples are valid core", codes: ["low_valid_share"],
      rule: "Share of SWIR samples marked valid (Final Mask = 1) in each dataset kept." },
  ] },
  { title: "Thermal infrared", checks: [
    { id: "tir", label: "Thermal infrared is usable", codes: ["tir_miscalibrated", "tir_none", "tir_sparse"],
      rule: "TIR covers at least half the 10 cm bins, and no more than 5% of samples read above 1 (a sign of miscalibration)." },
    { id: "tir_bad", label: "Thermal infrared samples are clean", codes: ["tir_many_bad"],
      rule: "Under 30% of TIR samples dropped as too dark (mean below 0.03), mostly negative, or above 1.",
      skip: ({ datasets }) => datasets.some((d) => d.tir !== undefined) && !datasets.some((d) => d.kept && d.tir === "ok") ? "No dataset had usable TIR to check." : null },
  ] },
  { title: "Core coverage", checks: [
    { id: "gap", label: "No stretch of missing core over 5 m", codes: ["core_gap"],
      rule: "Distance between consecutive valid 10 cm bins within each dataset." },
  ] },
  { title: "Collar details", checks: [
    { id: "coords", label: "Scan file has coordinates", codes: ["no_tsg_coordinates"], rule: "The TSG header's latitude and longitude are not 0, 0." },
    { id: "match", label: "Coordinates agree with the hole list", codes: ["coordinate_mismatch"], rule: "Scan file and hole list within 1 km of each other.",
      skip: ({ codes }) => codes.has("no_tsg_coordinates") ? "The scan file has no coordinates to compare." : null },
    { id: "inc", label: "Inclination recorded", codes: ["inclination_missing"], rule: "Between −90° and 0° in the TSG header." },
    { id: "rl", label: "Collar elevation recorded", codes: ["elevation_missing"], rule: "RL in the TSG header is not empty or 0." },
    { id: "date", label: "Drill date recorded", codes: ["drill_date_missing"], rule: "Drill date in the TSG header." },
    { id: "unit", label: "Tectonic unit recorded", codes: ["tectonic_unit_missing"], rule: "Tectonic unit in the TSG header." },
  ] },
];
const CHECKED = new Set(GROUPS.flatMap((g) => g.checks.flatMap((c) => c.codes)));

type State = "pass" | "fail" | "skip";
const ICON = {
  pass: <CircleCheck size={15} className="flex-none text-emerald-600" aria-label="Passed" />,
  fail: <CircleX size={15} className="flex-none text-red-600" aria-label="Failed" />,
  skip: <CircleMinus size={15} className="flex-none text-slate-400" aria-label="Not checked" />,
};

function IssueRow({ i, jump, title }: { i: Issue; jump: (m: number) => void; title?: boolean }) {
  const detail = [i.dataset, i.value, i.evidence].filter((x) => x !== null && x !== undefined && x !== "").join(" · ");
  return (
    <div className="rounded-md border border-red-100 bg-red-50/50 px-2.5 py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn("text-slate-800", title && "font-semibold")}>{issueLabel(i.issue)}</span>
        {i.depth_from !== null && <button type="button" className="flex-none font-mono text-slate-600 underline decoration-slate-300 underline-offset-2" onClick={() => jump(Math.floor(i.depth_from as number))}>{fmt(i.depth_from, 1)}–{fmt(i.depth_to, 1)} m</button>}
      </div>
      {detail && <div className="text-slate-600">{detail}</div>}
    </div>
  );
}

export function QualityChecks({ issues, datasets, jump }: { issues: Issue[]; datasets: DatasetRow[]; jump: (m: number) => void }) {
  const ctx: Ctx = { codes: new Set(issues.map((i) => i.issue)), datasets };
  // a hole listed with no scan data at all: none of the checks could run
  const noData = ctx.codes.has("listed_no_data");
  const rows = GROUPS.map((g) => ({ ...g, checks: g.checks.map((c) => {
    const found = issues.filter((i) => c.codes.includes(i.issue));
    const why = noData ? "There is no scan data to check." : c.skip?.(ctx) ?? null;
    const state: State = found.length ? "fail" : why ? "skip" : "pass";
    return { ...c, found, state, why };
  }) }));
  const all = rows.flatMap((g) => g.checks);
  const n = (s: State) => all.filter((c) => c.state === s).length;
  const other = issues.filter((i) => !CHECKED.has(i.issue));
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <span className="font-semibold text-slate-900">{n("pass")} of {all.length} checks passed</span>
        <span className="flex items-center gap-1 text-slate-600">{ICON.pass}{n("pass")} passed</span>
        <span className="flex items-center gap-1 text-slate-600">{ICON.fail}{n("fail")} failed{issues.length ? ` (${issues.length} ${issues.length === 1 ? "issue" : "issues"})` : ""}</span>
        {n("skip") > 0 && <span className="flex items-center gap-1 text-slate-600">{ICON.skip}{n("skip")} not checked</span>}
      </div>
      <p className="leading-relaxed text-slate-600">Checks run while the scan was cleaned. A failed check lists each problem it found and where it is.</p>
      {rows.map((g) => (
        <section key={g.title} className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</h4>
          <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {g.checks.map((c) => (
              <li key={c.id} className="flex gap-2 px-3 py-2">
                <span className="mt-px">{ICON[c.state]}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cn("font-medium", c.state === "fail" ? "text-red-700" : "text-slate-900")}>{c.label}</span>
                    {c.state === "fail" && <span className="flex-none text-red-700">{c.found.length} {c.found.length === 1 ? "issue" : "issues"}</span>}
                  </div>
                  <div className="text-slate-500">{c.why ?? c.rule}</div>
                  {c.found.map((i, k) => <IssueRow key={k} i={i} jump={jump} title={c.codes.length > 1} />)}
                </div>
              </li>))}
          </ul>
        </section>))}
      {other.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Other findings</h4>
          {other.map((i, k) => <IssueRow key={k} i={i} jump={jump} title />)}
        </section>)}
    </div>
  );
}
