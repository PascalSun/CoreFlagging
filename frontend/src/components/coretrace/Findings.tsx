"use client";
// The findings page: Core Flagging's reading of every WA metre set beside the geologist's log.
// Numbers are aggregates from the analysis (src/data/findings.json); the strip and the tray
// photographs are fetched live from the platform, so no scan data is kept in this repository.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { coreScan } from "@/lib/coreScan";
import { SERIES } from "@/components/coretrace/palette";
import data from "@/data/findings.json";

const UM = SERIES.orange, LOGGED = "#8d96a3", OTHER = "#c9ced6";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (n: number) => n.toLocaleString("en-AU");
const holeHref = (hole: string, m?: number | null) => `/map?hole=${encodeURIComponent(hole)}&full=1${m != null ? `&m=${m}` : ""}`;

type Beyond = typeof data.beyond;

export function Findings() {
  return (
    <>
      <Hero />
      <Case />
      <Underlogged />
      <Referee />
      <Misses />
      <BeyondWA />
      <Limits />
    </>
  );
}

function Section({ id, title, lead, children, tone = "paper" }: { id: string; title: string; lead?: React.ReactNode; children: React.ReactNode; tone?: "paper" | "white" }) {
  return (
    <section id={id} className={`scroll-mt-24 py-16 md:py-24 ${tone === "white" ? "bg-white" : "bg-paper"}`}>
      <div className="container-site flex flex-col gap-8">
        <Reveal>
          <h2 className="max-w-4xl font-display text-[30px] font-medium leading-[1.1] tracking-tight text-balance text-ink md:text-5xl">{title}</h2>
          {lead && <p className="mt-4 max-w-3xl text-[17px] leading-relaxed text-ink-soft">{lead}</p>}
        </Reveal>
        {children}
      </div>
    </section>
  );
}

function Hero() {
  const h = data.headline;
  return (
    <section className="bg-ink pt-[72px] text-white md:pt-[80px]">
      <div className="container-site py-16 md:py-24">
        <Reveal>
          <p className="text-sm font-medium text-white/60">Findings · GSWA HyLogger Hackathon 2026, Data Crunch</p>
          <h1 className="mt-5 max-w-4xl font-display text-[40px] font-semibold leading-[1.05] tracking-tight text-balance md:text-7xl">A second opinion on every metre of WA core</h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/80">Core Flagging reads {fmt(h.wa_holes)} HyLogger-scanned WA holes the same way, and checks them against the geologist&rsquo;s log.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <dl className="mt-10 grid max-w-3xl grid-cols-3 gap-6 border-t border-white/15 pt-6">
            <div><dt className="text-sm text-white/55">WA holes</dt><dd className="font-display text-3xl font-semibold md:text-4xl">{fmt(h.wa_holes)}</dd></div>
            <div><dt className="text-sm text-white/55">WA metres</dt><dd className="font-display text-3xl font-semibold md:text-4xl">{fmt(Math.round(h.wa_metres / 1000))}k</dd></div>
            <div><dt className="text-sm text-white/55">Holes read Australia-wide</dt><dd className="font-display text-3xl font-semibold md:text-4xl">~{fmt(h.au_holes_read)}</dd></div>
          </dl>
          <p className="mt-10 max-w-3xl border-l-2 pl-5 text-lg leading-relaxed text-white/90" style={{ borderColor: UM }}>
            Core Flagging doesn&rsquo;t replace the geologist. It reads every metre the geologist didn&rsquo;t have time to, and where the core and the log disagree, it asks for another pair of eyes.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/** A tray photograph fetched through the platform (object URL, revoked on unmount). */
function Tray({ hole, id, caption }: { hole: string; id: string; caption: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null, dead = false;
    coreScan.trayImage(hole, id).then((u) => { if (dead) URL.revokeObjectURL(u); else { url = u; setSrc(u); } }).catch(() => {});
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [hole, id]);
  return (
    <figure>
      <div className="aspect-[1800/628] overflow-hidden rounded-xl bg-ink/90">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src && <img src={src} alt={caption} className="h-full w-full object-cover" />}
      </div>
      <figcaption className="mt-2 text-[13px] text-ink-soft">{caption}</figcaption>
    </figure>
  );
}

/** KPDDH 006 down the hole: the log, Core Flagging's type per metre (live), and the assays. */
function CaseStrip() {
  const c = data.case;
  const { data: model } = useQuery({ queryKey: ["findings-model", c.hole], queryFn: () => coreScan.model(c.hole, "v2"), staleTime: Infinity });
  const lo = 100, hi = 360, H = 460, W = 560, y = (m: number) => ((m - lo) / (hi - lo)) * H;
  const x = (mg: number) => 250 + (mg / 30) * 290;
  const metres = model ? model.m.map((m, i) => [m, model.core[i]] as const).filter(([m]) => m >= lo && m < hi) : [];
  return (
    <svg viewBox={`0 0 ${W} ${H + 40}`} className="w-full" role="img" aria-label={`${c.hole}: logged ${c.log} from ${c.log_from} to ${c.log_to} m; Core Flagging reads its ultramafic type down to ${c.um_to} m; MgO 25.1% at 204 m and 5.7% at 320 m`}>
      <g transform="translate(0,24)">
        <text x={70} y={-8} textAnchor="middle" className="fill-ink-soft text-[12px]">Geologist&rsquo;s log</text>
        <text x={160} y={-8} textAnchor="middle" className="fill-ink-soft text-[12px]">Core Flagging</text>
        <text x={395} y={-8} textAnchor="middle" className="fill-ink-soft text-[12px]">MgO in the assay</text>
        {[100, 150, 200, 250, 300, 350].map((m) => (
          <g key={m}><text x={24} y={y(m) + 4} textAnchor="end" className="fill-ink-soft text-[11px] tabular-nums">{m}</text><line x1={250} x2={540} y1={y(m)} y2={y(m)} stroke="#e5e7eb" /></g>
        ))}
        <rect x={40} y={y(c.log_from)} width={60} height={y(c.log_to) - y(c.log_from)} rx={4} fill={LOGGED} />
        <text x={70} y={y(230)} textAnchor="middle" className="fill-white text-[12px] font-semibold">mafic</text>
        <text x={70} y={y(230) + 15} textAnchor="middle" className="fill-white text-[12px] font-semibold">volcanic</text>
        {metres.length ? metres.map(([m, k]) => <rect key={m} x={130} y={y(m)} width={60} height={Math.max(1, H / (hi - lo))} fill={k === 11 ? UM : OTHER} />)
          : <rect x={130} y={0} width={60} height={H} rx={4} fill="#eef0f3" />}
        <rect x={x(18)} y={0} width={x(30) - x(18)} height={H} fill={UM} opacity={0.07} />
        <text x={x(30) - 4} y={H - 6} textAnchor="end" className="text-[11px]" fill={UM}>ultramafic range</text>
        <line x1={250} x2={540} y1={y(c.um_to + 0.5)} y2={y(c.um_to + 0.5)} stroke="#111" strokeDasharray="4 3" />
        <text x={252} y={y(c.um_to) - 6} className="fill-ink text-[11px]">Core Flagging contact, {c.um_to} m</text>
        {c.assays.filter((a) => a.MgO != null).map((a) => (
          <g key={a.m}>
            <circle cx={x(a.MgO as number)} cy={y(a.m)} r={7} fill={(a.MgO as number) >= 18 ? UM : LOGGED} stroke="#fff" strokeWidth={2} />
            <text x={(a.MgO as number) >= 18 ? x(a.MgO as number) - 12 : x(a.MgO as number) + 12} y={y(a.m) + 4} textAnchor={(a.MgO as number) >= 18 ? "end" : "start"} className="fill-ink text-[12px] tabular-nums">
              {a.m} m · MgO {a.MgO}% · Ni {fmt(a.Ni)} ppm
            </text>
          </g>
        ))}
        {[0, 10, 20, 30].map((v) => <text key={v} x={x(v)} y={H + 14} textAnchor="middle" className="fill-ink-soft text-[11px]">{v}%</text>)}
      </g>
    </svg>
  );
}

function Case() {
  const c = data.case;
  return (
    <Section id="case" title={`One hole: ${c.hole}`} tone="white"
      lead={<>The log that came with the scan records <b className="text-ink">&ldquo;{c.log.toLowerCase()}&rdquo; from {c.log_from} to {c.log_to} m</b>. Core Flagging reads its talc&ndash;serpentine (Mg-OH) ultramafic type down to {c.um_to} m (on the map this type is labelled &ldquo;Other Mg-OH minerals + chlorite&rdquo;). Core Flagging never saw an assay; the one inside its ultramafic stretch is textbook ultramafic, and below its contact the assays are basalt.</>}>
      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <Reveal><CaseStrip /></Reveal>
        <Reveal delay={0.1} className="flex flex-col gap-5">
          <dl className="grid grid-cols-3 gap-4">
            {[["25.1%", "MgO at 204 m"], ["1,300", "ppm Ni at 204 m"], ["5.7%", "MgO at 320 m (basalt)"]].map(([n, l]) => (
              <div key={l} className="rounded-2xl bg-paper p-4"><dd className="font-display text-2xl font-semibold text-ink md:text-3xl">{n}</dd><dt className="mt-1 text-[13px] leading-snug text-ink-soft">{l}</dt></div>
            ))}
          </dl>
          <Tray hole={c.hole} id={c.tray.id} caption={`${c.hole}, tray at ${c.tray.from_m}–${c.tray.to_m} m, inside the stretch Core Flagging reads as ultramafic.`} />
          <Link href={holeHref(c.hole, 204)} className="inline-flex items-center gap-2 self-start rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white">Open {c.hole} at 204 m <ArrowRight size={15} /></Link>
        </Reveal>
      </div>
    </Section>
  );
}

const CHEM: Record<string, string> = {
  ultramafic: "Ultramafic", "not ultramafic": "Not ultramafic", mixed: "Mixed", "not assayed": "Not assayed",
  "ni only": "Ni only", "ni-cr": "Ni and Cr only", "split at the contact": "Ultramafic above 305 m, basalt below",
};

function Underlogged() {
  const u = data.underlogged;
  const [all, setAll] = useState(false);
  const rows = all ? u.list : u.list.slice(0, 12);
  return (
    <Section id="underlogged" title={`Not one hole: ${u.intervals} intervals in ${u.holes} holes`}
      lead={<>Logged as basalt, gabbro or sediment; read by Core Flagging as ultramafic ({fmt(u.metres)} m under our rule: at least 5 m, with Core Flagging&rsquo;s ultramafic type over half). The bars use the scanner&rsquo;s own mineral identification, which is separate from Core Flagging. Where assays exist, most confirm ultramafic chemistry.</>}>
      <Reveal>
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 md:p-8">
          <p className="text-[13px] text-ink-soft">Metres where the scanner&rsquo;s minerals include talc, serpentine or Mg-chlorite (95% interval from resampling holes)</p>
          {u.minerals.map((b) => (
            <div key={b.label} className="grid items-center gap-2 md:grid-cols-[280px_1fr]">
              <span className="text-[14px] leading-snug text-ink">{b.label}</span>
              <div className="relative h-7 rounded-md bg-paper">
                <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: pct(b.share), background: "highlight" in b && b.highlight ? UM : LOGGED }} />
                <div className="absolute top-1/2 h-px -translate-y-1/2 bg-ink" style={{ left: pct(b.ci[0]), width: `${(b.ci[1] - b.ci[0]) * 100}%` }} />
                <span className="absolute top-1/2 -translate-y-1/2 pl-2 text-sm font-semibold tabular-nums text-ink" style={{ left: pct(Math.max(b.share, b.ci[1])) }}>{pct(b.share)}</span>
              </div>
            </div>
          ))}
        </div>
      </Reveal>
      <Reveal>
        <div className="overflow-x-auto rounded-3xl bg-white">
          <table className="w-full min-w-[640px] text-left text-[14px]">
            <thead className="text-[12px] text-ink-soft"><tr className="border-b border-line">
              <th className="px-5 py-3 font-medium">Hole</th><th className="px-3 py-3 font-medium">Depth</th><th className="px-3 py-3 font-medium">Logged as</th>
              <th className="px-3 py-3 font-medium">Log</th><th className="px-3 py-3 text-right font-medium">Ultramafic type</th><th className="px-5 py-3 font-medium">Chemistry</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.hole}-${r.from_m}`} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-2.5"><Link href={holeHref(r.hole, r.from_m)} className="font-medium text-ink underline-offset-4 hover:underline">{r.hole}</Link></td>
                  <td className="px-3 py-2.5 tabular-nums text-ink-soft">{r.from_m}–{r.to_m} m</td>
                  <td className="px-3 py-2.5 text-ink-soft">{r.logged}</td>
                  <td className="px-3 py-2.5 text-ink-soft">{r.source}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">{pct(r.share)}</td>
                  <td className="px-5 py-2.5 text-ink-soft">{CHEM[r.chem] ?? r.chem}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!all && u.list.length > rows.length && (
            <button type="button" onClick={() => setAll(true)} className="w-full border-t border-line px-5 py-3 text-left text-sm font-medium text-ink hover:bg-paper">Show all {u.list.length} intervals</button>
          )}
        </div>
      </Reveal>
    </Section>
  );
}

function Referee() {
  const r = data.referee;
  const X = (v: number) => 20 + v * 520;
  return (
    <Section id="chemistry" title="When they disagree, whom does the chemistry back?" tone="white"
      lead={<>Over {r.n} disagreements of 10 m or more in {r.holes} WA holes (clay types excluded), the chemistry fits Core Flagging&rsquo;s reading better than the log&rsquo;s in {r.labels.observed} of cases (95% interval {r.labels.ci}). Shuffling Core Flagging&rsquo;s types between holes gives {r.labels.chance}. Intervals resample whole holes, so one long hole cannot carry the result.</>}>
      <Reveal>
        <svg viewBox="0 0 560 150" className="w-full max-w-4xl" role="img" aria-label={`Observed ${r.labels.observed} (95% interval ${r.labels.ci}) against ${r.labels.chance} by chance`}>
          <rect x={X(r.chance_band[0])} y={30} width={X(r.chance_band[1]) - X(r.chance_band[0])} height={50} fill={OTHER} opacity={0.6} rx={3} />
          <line x1={X(r.chance)} x2={X(r.chance)} y1={30} y2={80} stroke="#6b7280" strokeWidth={2} />
          <text x={X(r.chance)} y={22} textAnchor="middle" className="fill-ink-soft text-[12px]">By chance {r.labels.chance}</text>
          <line x1={X(r.ci[0])} x2={X(r.ci[1])} y1={55} y2={55} stroke="#111" strokeWidth={2} />
          <circle cx={X(r.observed)} cy={55} r={9} fill={SERIES.blue} stroke="#fff" strokeWidth={2} />
          <text x={X(r.observed)} y={102} textAnchor="middle" className="fill-ink text-[13px] font-semibold">Observed {r.labels.observed} (95% interval {r.labels.ci})</text>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => <text key={v} x={X(v)} y={136} textAnchor="middle" className="fill-ink-soft text-[11px]">{pct(v)}</text>)}
        </svg>
      </Reveal>
      <p className="max-w-3xl text-[15px] leading-relaxed text-ink-soft">In weathered clays it goes the other way: the chemistry backs Core Flagging in {pct(r.clay.observed)} of {r.clay.n} intervals, because clay keeps the parent rock&rsquo;s chemistry while the scanner sees the clay.</p>
    </Section>
  );
}

function Misses() {
  const m = data.misses;
  return (
    <Section id="misses" title="Where Core Flagging is wrong"
      lead="A second opinion is only useful if you know how it fails. The output is a list of places to look again, not a new log.">
      <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <Reveal><Tray hole={m.example.hole} id={m.example.tray.id} caption={`${m.example.hole}, ${m.example.tray.from_m}–${m.example.tray.to_m} m. Core Flagging reads ultramafic from ${m.example.from_m} to ${m.example.to_m} m; the assays say basalt (MgO ${m.example.MgO}%, Ni ${m.example.Ni} ppm).`} /></Reveal>
        <Reveal delay={0.1}>
          <ul className="flex flex-col gap-4 text-[16px] leading-relaxed text-ink-soft">
            <li><b className="text-ink">{m.example.hole}</b>: read as ultramafic, chemistry basalt. <Link href={holeHref(m.example.hole, 230)} className="text-ink underline underline-offset-4">Open it</Link>.</li>
            <li><b className="text-ink">{m.reverse} intervals</b> the geologist logged as ultramafic are not read as ultramafic.</li>
            <li>In <b className="text-ink">weathered rock</b> it reports the clay; the log and the chemistry keep the parent rock.</li>
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}

function BeyondWA() {
  const b: Beyond = data.beyond;
  const t = b.confirmed_by_text, f = b.false_positive;
  return (
    <Section id="beyond" title="Beyond WA: candidates awaiting verification" tone="white"
      lead={<>Core Flagging has read {fmt(b.holes_read)} holes across Australia. Outside WA it can only flag candidates. WA is the only State where we could check every claim against a log and multi-element chemistry, because GSWA&rsquo;s drillhole database compiles both.</>}>
      <Reveal>
        <div className="grid gap-8 rounded-3xl bg-paper p-6 md:grid-cols-[1.2fr_1fr] md:p-8">
          <Tray hole={t.key} id={t.tray_id} caption={`${t.hole}, ${t.tray_from}–${t.tray_to} m (${t.state}, ${t.region}).`} />
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-semibold" style={{ color: UM }}>Confirmed by the log&rsquo;s own words</p>
            <p className="text-[16px] leading-relaxed text-ink"><Link href={holeHref(t.key, t.from_m)} className="font-semibold underline-offset-4 hover:underline">{t.hole}</Link>, {t.from_m}–{t.to_m} m: the rock code says <b>&ldquo;{t.code}&rdquo;</b>; the geologist&rsquo;s description says <b>&ldquo;{t.text}&rdquo;</b>. Core Flagging reads its ultramafic type here: it agrees with the words, which the code lost.</p>
            <p className="text-[14px] text-ink-soft">{t.also}</p>
          </div>
        </div>
      </Reveal>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {b.candidates.map((c) => (
          <Reveal key={c.key} className="flex flex-col gap-3 rounded-2xl bg-paper p-4">
            <Tray hole={c.key} id={c.tray_id} caption={`${c.tray_from}–${c.tray_to} m`} />
            <p className="text-[14px] text-ink"><Link href={holeHref(c.key, c.from_m)} className="font-semibold underline-offset-4 hover:underline">{c.hole}</Link> · {c.state} · {c.from_m}–{c.to_m} m</p>
            <p className="text-[13px] text-ink-soft">Log: {c.log ? <>&ldquo;{c.log}&rdquo;</> : "none we hold"}. Ultramafic type {pct(c.share)} of metres; scanner talc, serpentine or Mg-chlorite {pct(c.scanner)}.</p>
            <span className="self-start rounded-full border px-2.5 py-0.5 text-[12px] font-semibold" style={{ color: UM, borderColor: UM }}>Awaiting verification</span>
          </Reveal>
        ))}
      </div>
      <p className="text-[14px] text-ink-soft">Likely wrong: <Link href={holeHref(f.key, f.from_m)} className="text-ink underline underline-offset-4">{f.hole}</Link> ({f.state}, {f.from_m}–{f.to_m} m) is {f.note}.</p>
      <Reveal>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[14px]">
            <thead className="text-[12px] text-ink-soft"><tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">State</th><th className="px-3 py-2 text-right font-medium">Scanned holes</th><th className="px-3 py-2 text-right font-medium">Read by Core Flagging</th>
              <th className="px-3 py-2 text-right font-medium">With a log we hold</th><th className="px-3 py-2 font-medium">Multi-element chemistry</th><th className="px-3 py-2 font-medium">Can be checked today</th>
            </tr></thead>
            <tbody>{b.readiness.map((r) => (
              <tr key={r.state} className="border-b border-line/70">
                <td className="py-2 pr-3 font-medium text-ink">{r.state}</td><td className="px-3 py-2 text-right tabular-nums text-ink-soft">{fmt(r.scanned)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-soft">{fmt(r.read_by_coretrace)}</td><td className="px-3 py-2 text-right tabular-nums text-ink-soft">{fmt(r.with_a_log)}</td>
                <td className="px-3 py-2 text-ink-soft">{r.chemistry}</td><td className="px-3 py-2 text-ink-soft">{r.check_today}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Reveal>
    </Section>
  );
}

function Limits() {
  const w = data.weathering;
  return (
    <Section id="limits" title="Read it with care">
      <dl className="grid gap-x-12 sm:grid-cols-2">
        {[
          ["Machine readings need care", "Machine-only (Level 1) interpretations need care, and so do ours."],
          ["What the scanner cannot see", "Short-wave infrared cannot see quartz or feldspar; thermal infrared is not measured in every hole."],
          ["Few assays", "Only a small number of the under-logged ultramafic intervals have multi-element assays."],
          ["Our rule", "The ultramafic rule is ours; other thresholds give other counts. Validation is in WA only."],
          ["Also from the same reading", `Base of weathering: within a median ${w.median_err} m of the log in ${w.n} holes (95% interval ${w.ci[0]}–${w.ci[1]} m), and an estimate for ${w.added} holes with no logged base.`],
        ].map(([t, d]) => (
          <div key={t} className="border-t border-line py-6">
            <dt className="font-display text-xl font-semibold text-ink">{t}</dt>
            <dd className="mt-2 max-w-[46ch] text-[15px] leading-relaxed text-ink-soft">{d}</dd>
          </div>
        ))}
      </dl>
      <Link href="/map" className="inline-flex items-center gap-2 self-start rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white">Open the map <ArrowRight size={15} /></Link>
    </Section>
  );
}
