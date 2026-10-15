"use client";

import { useEffect, useState } from "react";
import type { CoreModelInfo, HoleDetail, ModelView, Tray } from "@/lib/coreScan";
import { coreScan, readDate, surveyOf } from "@/lib/coreScan";
import { HatchDefs, hatchFill } from "@/components/coretrace/HatchDefs";
import { GRID, INK, MUTED, NONE, SERIES, coreTypeBg, fmt, groupColor, groupName, issueLabel, lithColor, pct } from "@/components/coretrace/palette";
import { CORE_TEAM } from "@/components/coretrace/team";
import { useT } from "@/lib/i18n";

// The scan report as a document: an A4 page at 96 dpi (794 px wide), laid out for paper. The same
// node is shown in the Report tab and rendered to the PDF, so what you see is what you download.

export const PAGE_W = 794;
const PAD = 48, W = PAGE_W - 2 * PAD;

const nf = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));

async function dataUrl(objectUrl: string): Promise<string> {
  const blob = await fetch(objectUrl).then((r) => r.blob());
  return new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(blob); });
}

function Section({ n, title, intro, children }: { n: number; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="flex items-baseline gap-3 border-b-2 border-slate-900 pb-1.5 font-display text-[17px] font-semibold text-slate-900">
        <span className="tabular-nums text-slate-400">{n}</span>{title}
      </h2>
      {intro && <p data-nobreak className="mt-2 max-w-[62ch] text-[11.5px] leading-relaxed text-slate-600">{intro}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

const th = "border-b border-slate-300 py-1.5 pr-3 text-left align-bottom text-[10.5px] font-medium text-slate-500";
const td = "border-b border-slate-100 py-1.5 pr-3 align-top text-[11.5px] text-slate-800";
const num = "tabular-nums text-right";

const SHOW_MODEL_TABLE = false;
/** The auto log's table of segments, hidden from the report with the Auto log tab (its boundaries still mark the strip). */
const SHOW_AUTO_LOG = false;

/** The hole drawn across the page: what the scan reads and what the model makes of it, metre by
 * metre, each track on its own scale, with the auto-log boundaries and the flagged metres marked. */
function HoleFigure({ hole, mv }: { hole: HoleDetail; mv: ModelView }) {
  const ms = hole.metres; const m0 = ms.m[0] ?? 0, m1 = (ms.m[ms.m.length - 1] ?? 0) + 1, span = Math.max(1, m1 - m0);
  const L = 92, PW = W - L; const x = (m: number) => L + ((m - m0) / span) * PW; const bw = Math.max(PW / span, 0.7);
  const idx = new Map(mv.m.map((m, i) => [m, i])); const type = new Map(mv.core_types.map((c) => [c.k, c.name]));
  const flagged = (j: number) => mv.anom_raw[j] >= mv.anomaly.flag_raw && mv.anom[j] >= mv.anomaly.flag_at;
  const rawTop = Math.max(mv.anomaly.flag_raw * 1.4, 1e-6);
  const auMax = Math.max(0.5, ...ms.au.map((v) => v ?? 0));
  const tracks: { label: string; h: number; draw: (y: number, h: number) => React.ReactNode }[] = [
    { label: "SWIR minerals", h: 13, draw: (y, h) => ms.m.map((m, i) => <rect key={m} x={x(m)} y={y} width={bw} height={h} fill={groupColor(ms.gs[i])} />) },
    { label: "TIR minerals", h: 13, draw: (y, h) => ms.m.map((m, i) => <rect key={m} x={x(m)} y={y} width={bw} height={h} fill={groupColor(ms.gt[i])} />) },
    ...(hole.has_lith ? [{ label: "Logged rock", h: 13, draw: (y: number, h: number) => ms.m.map((m, i) => <rect key={m} x={x(m)} y={y} width={bw} height={h} fill={lithColor(ms.lith[i])} />) }] : []),
    { label: "Rock Classification", h: 13, draw: (y, h) => <>
      {ms.m.map((m) => { const j = idx.get(m); return j === undefined ? null : <rect key={m} x={x(m)} y={y} width={bw} height={h} fill={hatchFill("rh", type.get(mv.core[j]))} />; })}
      {mv.segments.map((s) => s.from_m > m0 + 0.5 ? <rect key={s.seg} x={x(s.from_m) - 0.4} y={y - 3} width={0.8} height={h + 6} fill={INK} /> : null)}
    </> },
    { label: "Unusual", h: 24, draw: (y, h) => ms.m.map((m) => { const j = idx.get(m); if (j === undefined) return null; const v = Math.min(1, mv.anom_raw[j] / rawTop) * h;
      return <rect key={m} x={x(m)} y={y + h - v} width={bw} height={v} fill={flagged(j) ? SERIES.orange : "#c4c8cf"} />; }) },
    { label: "Gold likelihood", h: 24, draw: (y, h) => ms.m.map((m) => { const j = idx.get(m); if (j === undefined) return null; const v = mv.gold[j] * h;
      return <rect key={m} x={x(m)} y={y + h - v} width={bw} height={v} fill={SERIES.blue} />; }) },
    ...(hole.au_m ? [{ label: "Au assay", h: 20, draw: (y: number, h: number) => ms.m.map((m, i) => { const v = ms.au[i]; if (v === null || v <= 0) return null; const hh = Math.max(1, Math.min(1, v / auMax) * h);
      return <rect key={m} x={x(m)} y={y + h - hh} width={Math.max(bw, 1)} height={hh} fill={v >= 0.1 ? INK : "#9ca3af"} />; }) }] : []),
  ];
  const GAP = 7; let y = 0; const rows = tracks.map((t) => { const r = { ...t, y }; y += t.h + GAP; return r; });
  const H = y + 18; const step = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => (s / span) * PW >= 48) ?? 1000;
  const ticks: number[] = []; for (let d = Math.ceil(m0 / step) * step; d <= m1; d += step) ticks.push(d);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The hole from top (left) to bottom (right)">
      <defs><HatchDefs prefix="rh" names={mv.core_types.map((c) => c.name)} /></defs>
      {rows.map((r) => (
        <g key={r.label}>
          <text x={0} y={r.y + r.h / 2} dominantBaseline="middle" fontSize="10" fill={MUTED}>{r.label}</text>
          <rect x={L} y={r.y} width={PW} height={r.h} fill="#f6f7f9" />
          {r.draw(r.y, r.h)}
        </g>
      ))}
      {ticks.map((d) => <g key={d}><line x1={x(d)} x2={x(d)} y1={y - GAP} y2={y - GAP + 4} stroke={MUTED} /><text x={x(d)} y={y + 9} textAnchor={x(d) > W - 16 ? "end" : "middle"} fontSize="9.5" fill={MUTED}>{d}</text></g>)}
      <text x={L - 6} y={y + 9} textAnchor="end" fontSize="9.5" fill={MUTED}>Depth (m)</text>
      <line x1={L} x2={W} y1={y - GAP} y2={y - GAP} stroke={GRID} />
    </svg>
  );
}

const Sw = ({ c }: { c: string }) => <i className="inline-block size-2.5 rounded-[2px]" style={{ background: c }} />;

function Legend({ hole, mv }: { hole: HoleDetail; mv: ModelView }) {
  const count = new Map<string, number>();
  for (const g of [...hole.metres.gs, ...hole.metres.gt]) if (g && g !== "INVALID" && g !== "nan") count.set(g, (count.get(g) ?? 0) + 1);
  const groups = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([g]) => g);
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-600">
      {groups.map((g) => <span key={g} className="flex items-center gap-1"><Sw c={groupColor(g)} />{groupName(g)}</span>)}
      <span className="flex items-center gap-1"><Sw c={NONE} />no response</span>
      <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-px bg-slate-900" />auto-log boundary</span>
      <span className="flex items-center gap-1"><Sw c={SERIES.orange} />flagged unusual</span>
      {hole.au_m > 0 && <span className="flex items-center gap-1"><Sw c={INK} />assay ≥ 0.1 ppm</span>}
      <span className="text-slate-400">· rock classes: {mv.summary.main_types.map(([n, s]) => `${n} ${pct(s)}`).join(", ")}</span>
    </div>
  );
}

export function ReportDocument({ hole, mv, run, models, trays, nodeRef }: {
  hole: HoleDetail; mv: ModelView | undefined; run: string; models: CoreModelInfo[]; trays: Tray[]; nodeRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const f = hole.report.funnel ?? {};
  const model = models.find((m) => m.run === run);
  const rank = (r: string) => { const m = models.find((x) => x.run === r); return m?.default ? 0 : m?.kind === "baseline" ? 2 : 1; };
  const peak = mv?.anomaly.runs[0]?.peak_m ?? null;
  const tray = (peak !== null ? trays.find((t) => t.from_m <= peak + 0.5 && peak + 0.5 <= t.to_m + 0.05) : null) ?? trays[Math.floor(trays.length / 3)] ?? null;
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    if (tray) coreScan.trayImage(hole.key, tray.id).then(dataUrl).then((u) => { if (!gone) setPhoto(u); }).catch(() => {});
    return () => { gone = true; };
  }, [hole.key, tray]);
  // the tray is chosen for the most unusual metre; it is named, not boxed (a box placed from the scan positions can miss)
  const holdsPeak = !!tray && peak !== null && tray.from_m <= peak + 0.5 && peak + 0.5 <= tray.to_m + 0.05;
  const res = hole.results.find((r) => r.run === run);
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const training = hole.split === "train" || hole.split === "val";
  let k = 0; const next = () => ++k;   // sections are numbered in the order they appear; some are absent without a model

  return (
    <div ref={nodeRef} className="bg-white text-slate-900" style={{ width: PAGE_W, padding: `${PAD}px ${PAD}px 56px` }}>
      {/* masthead */}
      <header className="flex items-end justify-between gap-6 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/coretrace-mark.svg" alt="" className="size-9 rounded-[8px]" />
          <div className="leading-tight"><div className="font-display text-[13px] font-bold tracking-tight">CoreFlagging</div><div className="text-[10.5px] text-slate-500">Scan report · UWA NTLP</div></div>
        </div>
        <div className="flex items-center gap-4">
          {/* the lab, the ARC training centre and the survey, as on the landing page */}
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ntlp-logo.png" alt="UWA NTLP" className="size-9 rounded-full" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/critical-resources-logo.svg" alt="ARC Training Centre in Critical Resources for the Future" className="h-7 w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gswa-logo.png" alt="Geological Survey of Western Australia" className="size-9" />
          </div>
          <div className="text-right text-[10.5px] leading-snug text-slate-500"><div>{today}</div><div>coretrace.nlp-tlp.org</div></div>
        </div>
      </header>

      {/* title */}
      <div className="mt-7">
        <h1 className="font-display text-[40px] font-semibold leading-none tracking-tight">{hole.name}</h1>
        <p className="mt-2 text-[13px] text-slate-600">{[hole.operator, hole.project, hole.region].filter(Boolean).join(" · ") || "No collar details in the scan"}</p>
        <p className="mt-0.5 text-[11.5px] text-slate-500">
          {hole.instrument || "Instrument not recorded"} · {fmt(hole.depth_min, 1)}–{fmt(hole.depth_max, 1)} m scanned
          {hole.lat !== null && hole.lon !== null ? ` · ${Math.abs(hole.lat).toFixed(4)}° S, ${hole.lon.toFixed(4)}° E` : ""}
          {hole.source === "upload" ? " · uploaded scan" : ` · ${surveyOf(hole.state || "WA")} core library (NVCL)`}
          {hole.processed_at ? ` · read ${readDate(hole)}` : ""}
          {hole.meta.wamex ? ` · WAMEX report ${String(hole.meta.wamex)}` : ""}
        </p>
      </div>

      {hole.results.length === 0 && hole.message && <p className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-[11.5px] leading-relaxed text-slate-700">{hole.message}</p>}

      {/* the core */}
      {tray && (
        <figure className="mt-6">
          <div className="relative overflow-hidden rounded-md bg-slate-900" style={{ aspectRatio: `${tray.width || 1800} / ${tray.height || 672}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo && <img src={photo} alt="" className="absolute inset-0 h-full w-full object-fill" />}
          </div>
          <figcaption className="mt-1.5 text-[10.5px] text-slate-500">Tray {tray.n}, {tray.from_m.toFixed(1)}–{tray.to_m.toFixed(1)} m.{holdsPeak ? ` It holds ${peak}–${peak! + 1} m, the most unusual metre in the hole.` : ""} Photograph: GSWA, NVCL, CC BY 4.0.</figcaption>
        </figure>
      )}

      {/* the hole in figures */}
      <dl className="mt-6 grid grid-cols-4 border-y border-slate-200">
        {[
          ["Core read", `${nf(f.tokens)} bins`, `${nf(f.metres)} m in 10 cm bins`],
          ["Valid samples", pct((f.samples_valid ?? 0) / Math.max(f.samples ?? 1, 1)), `${nf(f.samples_valid)} of ${nf(f.samples)}`],
          ["Unusual metres", res ? nf(res.anomaly.n_flag_m) : "—", res ? `${pct(res.anomaly.share_flag, 1)} of the hole` : ""],
          hole.au_m ? ["Gold ranking", res?.gold.auc !== null && res?.gold.auc !== undefined ? `AUC ${fmt(res.gold.auc)}` : "—", `${hole.au_m} m assayed, ${hole.au_pos_m} ≥ 0.1 ppm`]
            : ["Quality issues", nf(hole.n_issues), hole.issues[0] ? issueLabel(hole.issues[0].issue) : "none found"],
        ].map(([k, v, sub], i) => (
          <div key={k} className={`px-4 py-3 ${i ? "border-l border-slate-200" : "pl-0"}`}>
            <dt className="text-[10.5px] text-slate-500">{k}</dt>
            <dd className="font-display text-[20px] font-semibold tabular-nums leading-tight">{v}</dd>
            <dd className="text-[10.5px] text-slate-500">{sub}</dd>
          </div>
        ))}
      </dl>
      {training && <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-[11px] text-amber-900">The models saw this hole in training, so the figures in this report look better than they would on core the models have not seen.</p>}

      {mv && (
        <Section n={next()} title="Down the hole" intro={`From the top of the hole (left) to the bottom (right), as read by ${model?.name ?? run}. Each track has its own scale. Unusual compares a metre with the 15 m either side of it; gold likelihood comes from a probe fitted on assayed holes and reads the spectra only.`}>
          <figure><HoleFigure hole={hole} mv={mv} /><Legend hole={hole} mv={mv} /></figure>
        </Section>
      )}

      {mv && (
        <Section n={next()} title="What stands out" intro={`The intervals the model flags as unusual, strongest first, and the metres it ranks highest for gold. Contrast is how far a metre's reading sits from the core around it; a typical metre in this hole scores ${mv.anomaly.median_raw.toFixed(2)}. Unusual is not the same as mineralised.`}>
          <div data-keep className="grid grid-cols-2 gap-8">
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Unusual interval</th><th className={th}>Peak</th><th className={`${th} ${num}`}>Contrast with ±15 m</th></tr></thead>
              <tbody>{mv.anomaly.runs.slice(0, 10).map((r) => <tr key={r.from_m}><td className={td}>{r.from_m}–{r.to_m} m</td><td className={td}>{r.peak_m} m</td><td className={`${td} ${num}`}>{r.raw.toFixed(2)}</td></tr>)}
                {!mv.anomaly.runs.length && <tr><td className={td} colSpan={3}>Nothing stands out enough to flag.</td></tr>}</tbody>
            </table>
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Metre</th><th className={`${th} ${num}`}>Gold likelihood</th>{hole.au_m ? <th className={`${th} ${num}`}>Assay (ppm)</th> : null}</tr></thead>
              <tbody>{mv.gold_summary.top.slice(0, 10).map((g) => <tr key={g.m}><td className={td}>{g.m}–{g.m + 1} m</td><td className={`${td} ${num}`}>{g.p.toFixed(2)}</td>{hole.au_m ? <td className={`${td} ${num}`}>{g.au !== null ? g.au.toFixed(2) : "—"}</td> : null}</tr>)}</tbody>
            </table>
          </div>
        </Section>
      )}

      <Section n={next()} title="Data quality" intro="Checks run while the scan was cleaned: unused datasets, thermal-infrared problems, missing core and missing collar details.">
        {hole.issues.length ? (
          <table data-keep className="w-full border-collapse">
            <thead><tr><th className={th}>Issue</th><th className={th}>Where</th><th className={th}>Evidence</th></tr></thead>
            <tbody>{hole.issues.map((i, k) => (
              <tr key={k}><td className={`${td} font-medium`}>{issueLabel(i.issue)}</td><td className={`${td} whitespace-nowrap`}>{i.depth_from !== null ? `${fmt(i.depth_from, 1)}–${fmt(i.depth_to, 1)} m` : "Whole hole"}</td>
                <td className={`${td} text-slate-600`}>{[i.value, i.evidence].filter(Boolean).join(" · ") || "—"}</td></tr>))}</tbody>
          </table>
        ) : <p className="text-[11.5px] text-slate-700">The checks found nothing to report.</p>}
      </Section>

{/* the models-side-by-side table is a research view; hidden from the report with the model picker (Oct 2026) */}
{SHOW_MODEL_TABLE && hole.results.length > 0 && (
      <Section n={next()} title="The models side by side" intro={`TIR agreement compares the mineral group a model fills in from SWIR alone with the TSG software's reading of the measured TIR.${hole.au_m ? " Gold AUC ranks this hole's assayed metres: 0.5 is chance, 1 is perfect." : ""}`}>
        <table data-keep className="w-full border-collapse">
          <thead><tr><th className={th}>Model</th><th className={`${th} ${num}`}>Auto-log segments</th><th className={`${th} ${num}`}>Unusual metres</th><th className={`${th} ${num}`}>TIR agreement</th>{hole.au_m ? <th className={`${th} ${num}`}>Gold AUC</th> : null}</tr></thead>
          <tbody>{[...hole.results].sort((a, b) => rank(a.run) - rank(b.run)).map((r) => (
            <tr key={r.run} className={r.run === run ? "bg-slate-50" : ""}>
              <td className={`${td} font-medium`}>{models.find((m) => m.run === r.run)?.name ?? r.run}{r.run === run ? <span className="ml-1.5 text-[10px] font-normal text-slate-500">(this report)</span> : null}</td>
              <td className={`${td} ${num}`}>{r.summary.n_segments}</td><td className={`${td} ${num}`}>{r.anomaly.n_flag_m}</td>
              <td className={`${td} ${num}`}>{r.tir.measured ? pct(r.tir.acc) : "no TIR"}</td>{hole.au_m ? <td className={`${td} ${num}`}>{fmt(r.gold.auc)}</td> : null}
            </tr>))}</tbody>
        </table>
      </Section>
      )}

      {SHOW_AUTO_LOG && mv && (
        <Section n={next()} title="Auto log" intro={`${mv.segments.length} segments cut by ${model?.name ?? run} where its reading of the spectra changes. Descriptions are written by rule from the TSG software's minerals; a geologist has not reviewed them.`}>
          <table className="w-full border-collapse">
            <thead><tr><th className={`${th} w-[78px]`}>Depth (m)</th><th className={`${th} w-[150px]`}>Rock Classification</th><th className={th}>Minerals</th></tr></thead>
            <tbody>{mv.segments.map((s) => (
              <tr key={s.seg}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{s.from_m.toFixed(1)}–{s.to_m.toFixed(1)}</td>
                <td className={td}><span className="flex items-start gap-1.5"><i className="mt-[3px] inline-block size-2.5 flex-none rounded-[2px]" style={{ background: coreTypeBg(s.core_type_name) }} />{s.core_type_name}</span></td>
                <td className={`${td} text-slate-600`}>{s.desc_en.replace(/^[\d.]+–[\d.]+ m \([\d.]+ m\); /, "")}</td>
              </tr>))}</tbody>
          </table>
        </Section>
      )}

      <Section n={next()} title="Data and method">
        <div data-keep className="grid grid-cols-2 gap-8">
          <div>
            <h3 className="mb-1.5 text-[11.5px] font-semibold">What went in</h3>
            <table className="w-full border-collapse"><tbody>
              {hole.datasets.map((d) => <tr key={d.dsid + d.name}><td className={td}>{d.name}</td><td className={`${td} text-slate-600`}>{d.instrument}, {nf(d.n_samples)} samples{d.kept ? "" : ` — not used: ${d.reason}`}</td></tr>)}
              <tr><td className={td}>Samples kept</td><td className={td}>{nf(f.samples_valid)} of {nf(f.samples)}</td></tr>
              <tr><td className={td}>10 cm bins</td><td className={td}>{nf(f.tokens)}, {nf(f.tokens_tir)} with TIR</td></tr>
              <tr><td className={td}>Logs in the scan</td><td className={td}>{f.lith_m ?? 0} m logged rock, {f.au_m ?? 0} m gold assay</td></tr>
            </tbody></table>
          </div>
          <div>
            <h3 className="mb-1.5 text-[11.5px] font-semibold">Cleaning rules</h3>
            <ul className="flex flex-col gap-1 text-[10.5px] leading-snug text-slate-600">{(hole.report.rules ?? []).map((r) => <li key={r.step}><span className="font-medium text-slate-800">{r.step}.</span> {r.rule}</li>)}</ul>
          </div>
        </div>
        <p className="mt-5 border-t border-slate-200 pt-3 text-[10px] leading-relaxed text-slate-500">
          {model?.name ?? run}: {model?.description}{" "}Scans, photographs and logs: {hole.source === "upload" ? "uploaded by the reader" : `${surveyOf(hole.state || "WA")}, National Virtual Core Library node, CC BY 4.0`}. Generated by CoreFlagging from the platform&rsquo;s records of this hole.
        </p>
      </Section>

      {/* who made it */}
      <section data-keep className="mt-10 rounded-lg bg-slate-50 px-6 py-5">
        <div className="flex items-center justify-between gap-6">
          <h2 className="font-display text-[15px] font-semibold">The team behind CoreFlagging</h2>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ntlp-logo.png" alt="NTLP" className="size-8 rounded-full" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/critical-resources-logo.svg" alt="ARC Training Centre in Critical Resources for the Future" className="h-6 w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gswa-logo.png" alt="GSWA" className="size-8 mix-blend-multiply" />
          </div>
        </div>
        <p className="mt-1 max-w-[68ch] text-[10.5px] leading-relaxed text-slate-600">UWA Centre for Natural and Technical Language Processing (NTLP), The University of Western Australia, with the ARC Training Centre in Critical Resources for the Future and the Geological Survey of Western Australia (GSWA).</p>
        <ul className="mt-4 grid grid-cols-5 gap-3">
          {CORE_TEAM.map((m) => (
            <li key={m.name} className="flex flex-col items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.img} alt="" className="size-12 rounded-full object-cover" />
              <span className="mt-2 text-[11px] font-semibold leading-tight">{m.name}</span>
              {m.leader && <span className="text-[10px] text-amber-700">{t("team.leader")}</span>}
              <span className="mt-1 text-[9.5px] leading-snug text-slate-500">{t(m.blurb)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
