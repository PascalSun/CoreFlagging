"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useT } from "@/lib/i18n";
import { CORE_TEAM } from "@/components/coretrace/team";
import { Footer } from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Reveal } from "@/components/landing/reveal";
import { HERO_TRAY } from "@/components/coretrace/landing-data";
import { groupColor, groupName } from "@/components/coretrace/palette";
import { coretraceBase, coretraceChrome } from "@/lib/sites";
import { cn } from "@/lib/utils";

// CoreFlagging's landing page, in the platform landing's language: a full-bleed picture with the lockup at
// its foot, a two-column statement, large picture cards, the team, and the footer revealed underneath.
// The picture here is the thing itself: a real tray of core, with what the scan read under each row.

function useChrome() { const base = coretraceBase(usePathname()); return { base, chrome: coretraceChrome(base) }; }
export function CoreNavbar() { return <Navbar chrome={useChrome().chrome} />; }
export function CoreFooter() { return <Footer chrome={useChrome().chrome} />; }

const T = HERO_TRAY;
/** A row photograph is 3200 x 172 px; the depth tag takes its left 4.7 % and the tray rail its lower third. */
const ROW = { w: 3200, h: 172, left: 0.047, keep: 0.66 };

/** A window onto one row of core: `from`..`to` are fractions of the row's length (after the depth tag). */
function RowStrip({ src, from = 0, to = 1, className, label }: { src: string; from?: number; to?: number; className?: string; label?: string }) {
  const span = (1 - ROW.left) * (to - from), start = ROW.left + (1 - ROW.left) * from;
  return (
    <div role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn("w-full bg-no-repeat", className)}
      style={{ backgroundImage: `url(${src})`, backgroundSize: `${100 / span}% auto`, backgroundPosition: `${span >= 1 ? 0 : (start / (1 - span)) * 100}% 0`,
        aspectRatio: `${ROW.w * span} / ${ROW.h * ROW.keep}` }} />
  );
}

/** What the scan read along a row, every 10 cm, as a thin bar of mineral colours. */
function Readings({ row, from = 0, to = 1, className }: { row: (typeof T.rows)[number]; from?: number; to?: number; className?: string }) {
  const len = row.to - row.from, a = row.from + from * len, b = row.from + to * len;
  return (
    <div className={cn("relative h-2 md:h-2.5", className)} aria-hidden>
      {row.bins.filter((x) => x[0] + 0.1 > a && x[0] < b).map((x) => {
        const g: string = x[1]; const l = Math.max(0, (x[0] - a) / (b - a)), r = Math.min(1, (x[0] + 0.1 - a) / (b - a));
        return <span key={x[0]} className="absolute inset-y-0 rounded-[2px]" style={{ left: `calc(${l * 100}% + 1px)`, width: `calc(${(r - l) * 100}% - 2px)`, background: g === "INVALID" || !g ? "rgba(255,255,255,0.12)" : groupColor(g) }} />;
      })}
    </div>
  );
}

const GROUPS = [...new Set(T.rows.flatMap((r) => r.bins.map((b) => b[1] as string)))].filter((g) => g && g !== "INVALID");

/** Opening screen: the tray, full bleed, row under row, each with its readings; one scan line crosses it as
 * the page opens. The lockup sits at the foot, as on the platform's landing page. */
export function CoreHero() {
  const { base } = useChrome();
  const still = useReducedMotion();
  return (
    // the navbar's glass sits on paper, as on the platform's landing; the core table fills the rest of the screen
    <section id="top" aria-label="CoreFlagging" className="bg-paper pt-[72px] md:pt-[80px]">
    <div className="relative h-[calc(100dvh-72px)] min-h-[560px] overflow-hidden bg-ink text-white md:h-[calc(100dvh-80px)]">
      <style>{`@keyframes ct-reveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}.ct-reveal{animation:ct-reveal 2.8s cubic-bezier(.4,0,.2,1) .6s both}@media (prefers-reduced-motion:reduce){.ct-reveal{animation:none}}`}</style>
      {/* the tray: wider than the screen, so the core reads large; drifts very slowly sideways */}
      <motion.div aria-hidden className="absolute inset-x-0 top-3 flex flex-col gap-3 md:top-4 md:gap-4"
        initial={{ x: 0 }} animate={still ? undefined : { x: "-6vw" }} transition={{ duration: 40, ease: "linear" }}>
        {[...T.rows, ...T.rows].map((r, i) => (
          <div key={i} className="w-[260vw] md:w-[150vw]">
            <RowStrip src={r.img} />
            <Readings row={r} className="ct-reveal mt-1.5" />
          </div>
        ))}
      </motion.div>
      {!still && (
        <motion.div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-cyan shadow-[0_0_22px_5px_rgba(0,196,245,0.55)]"
          initial={{ left: "0%", opacity: 1 }} animate={{ left: "100%", opacity: 0 }}
          transition={{ left: { duration: 2.8, delay: 0.6, ease: [0.4, 0, 0.2, 1] }, opacity: { duration: 0.4, delay: 3.2 } }} />
      )}
      {/* shade for the lockup */}
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-ink via-ink/75 via-45% to-ink/10" />

      <div className="absolute inset-x-0 bottom-0">
        <div className="container-site flex flex-col gap-5 pb-6 md:flex-row md:items-end md:justify-between md:gap-8 md:pb-12">
          <div className="max-w-4xl">
            <p className="font-display text-lg font-semibold tracking-tight text-white md:text-xl">CoreFlagging</p>
            <h1 className="mt-1.5 font-display text-[34px] font-semibold leading-[1.1] tracking-tight md:mt-2.5 md:text-6xl md:leading-tight">
              <span className="bg-linear-to-r from-white from-40% to-cyan bg-clip-text text-transparent">A second opinion on every metre of core.</span>
            </h1>
            <p className="mt-2 max-w-3xl font-display text-base font-medium text-white/75 md:mt-3 md:text-2xl">CoreFlagging reads HyLogger scans the same way for every hole, and shows where the core and the geologist&rsquo;s log tell different stories.</p>
            <div className="mt-5 flex flex-wrap items-center gap-2.5 md:mt-7 md:gap-3">
              <Link href={`${base}/map`} className="flex h-11 items-center gap-2 rounded-full bg-white px-5 font-display text-[15px] font-bold md:h-12 md:px-6 text-ink transition-colors hover:bg-cyan focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan">
                Open the map<ArrowRight className="size-4" />
              </Link>
            </div>
            <Link href={`${base}/map?upload=1`} className="mt-3 inline-block text-sm text-white/60 underline-offset-4 hover:text-white hover:underline md:mt-4">Or upload your own scan</Link>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <div className="flex max-w-sm flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/70 md:justify-end md:gap-y-1.5 md:text-xs">
              {GROUPS.map((g) => <span key={g} className="flex items-center gap-1.5"><i className="inline-block h-2 w-3 rounded-[2px]" style={{ background: groupColor(g) }} />{groupName(g)}</span>)}
            </div>
            <p className="text-[11px] text-white/50 md:hidden">Hole {T.hole}, tray {T.tray}. GSWA, NVCL, CC BY 4.0.</p>
            <p className="hidden max-w-sm text-xs leading-relaxed text-white/55 md:block md:text-right">Hole {T.hole}, tray {T.tray}, {T.from.toFixed(1)}–{T.to.toFixed(1)} m. Under each row, the mineral the scan reads every 10 cm. Geological Survey of Western Australia, NVCL, CC BY 4.0.</p>
            <div className="hidden items-center gap-3 md:flex">
              <a href="https://nlp-tlp.org/" target="_blank" rel="noopener noreferrer" aria-label="UWA Centre for Natural and Technical Language Processing">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/ntlp-logo.png" alt="" className="size-14 rounded-full ring-1 ring-white/20" />
              </a>
              <a href="https://criticalresources.org.au/" target="_blank" rel="noopener noreferrer" aria-label="ARC Training Centre in Critical Resources for the Future" className="flex h-14 items-center rounded-lg bg-white px-3 ring-1 ring-white/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/critical-resources-logo.svg" alt="" className="h-9 w-auto" />
              </a>
              <a href="https://www.dmirs.wa.gov.au/gswa" target="_blank" rel="noopener noreferrer" aria-label="Geological Survey of Western Australia, Department of Mines, Petroleum and Exploration" className="flex h-14 items-center gap-2.5 rounded-lg bg-white px-3 ring-1 ring-white/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/gswa-logo.png" alt="" className="h-11 w-11" />
                <span className="text-[11px] font-semibold leading-tight text-slate-800">Geological Survey of<br />Western Australia</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
    </section>
  );
}

/** Holes per core library, as registered on the platform (October 2026). */
const LIBRARIES: [string, string][] = [
  ["1,898", "Western Australia"], ["1,833", "South Australia"], ["1,269", "New South Wales"], ["562", "Northern Territory"],
  ["540", "Queensland"], ["496", "Tasmania"], ["29", "Victoria"], ["5", "CSIRO"],
];

/** Why the scan is worth a second reading: three plain reasons. */
const WHY: [string, string][] = [
  ["Logs are written by eye.", "By many geologists, for many companies, over decades, each with their own codes and level of detail."],
  ["Nobody has time to check them again.", "Re-reading hundreds of thousands of metres of core by hand does not happen."],
  ["The scan sees what the eye can miss.", "Minerals such as talc and serpentine in altered ultramafic rock, which in a tray can look like basalt."],
];

/** The statement: heading left, reasons right, then where the holes come from. */
export function CoreIntro() {
  return (
    <section id="intro" className="bg-paper pt-24 pb-16 md:pt-32 md:pb-24">
      <div className="container-site flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-20">
        <Reveal className="lg:w-2/5">
          <h2 className="font-display text-[32px] font-medium leading-[1.1] tracking-tight text-balance text-ink md:text-6xl">Why a second opinion</h2>
        </Reveal>
        <Reveal delay={0.12} className="flex flex-1 flex-col gap-12">
          <ul className="flex flex-col gap-5">
            {WHY.map(([t, b]) => (
              <li key={t} className="border-t border-line pt-5">
                <p className="font-display text-[19px] font-semibold text-ink md:text-2xl">{t}</p>
                <p className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-ink-soft md:text-lg">{b}</p>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-6 border-t border-line pt-8 sm:grid-cols-4">
            {LIBRARIES.map(([n, where]) => (
              <div key={where}>
                <dt className="sr-only">{where}</dt>
                <dd className="font-display text-3xl font-semibold tracking-tight text-ink tabular-nums md:text-4xl">{n}</dd>
                <dd className="mt-1 text-sm text-ink-soft">{where}</dd>
              </div>
            ))}
          </dl>
          <p className="-mt-6 text-sm text-ink-soft">Drillholes per core library in the National Virtual Core Library, about 6,600 in all.</p>
        </Reveal>
      </div>
    </section>
  );
}

/** A card's picture: the tray's rows stacked, each a window onto a different stretch of core. */
function TrayPicture({ offset }: { offset: number }) {
  return (
    <div aria-hidden className="absolute inset-x-0 top-0 flex flex-col gap-2 bg-ink pt-4">
      {T.rows.map((r, i) => {
        const a = ((offset + i * 0.13) % 0.7);
        return (
          <div key={r.from}>
            <RowStrip src={r.img} from={a} to={a + 0.3} />
            <Readings row={r} from={a} to={a + 0.3} className="mt-1" />
          </div>
        );
      })}
    </div>
  );
}

const FEATURES: { title: string; body: string; offset: number; tint: string; to: string }[] = [
  { title: "Every hole, one map", body: "About 6,600 scanned holes from every State's core library, coloured by what each was drilled for or by what the core is made of. Upload a scan, or fetch one by drillhole name from NVCL.", offset: 0.05, tint: "#0d3a4c", to: "map" },
  { title: "A drillhole report", body: "Domain boundaries, the TIR an older scan never recorded, the intervals that stand out and why, and the metres most worth assaying \u2014 beside the tray photographs and the geologist's log.", offset: 0.3, tint: "#173523", to: "map" },
  { title: "Core like this one", body: "For any interval or whole hole, the most similar core nearby or across the State, matched metre by metre on the model's reading.", offset: 0.55, tint: "#3b2916", to: "map" },
  { title: "Ask about the core", body: "An assistant that answers from the same data, finds the reports behind a hole and sums them up, and opens the hole it is talking about.", offset: 0.15, tint: "#2a2446", to: "map" },
];

/** What you can do: four large picture cards, title at the foot, as on the platform's landing page. */
export function CoreFeatures() {
  const { base } = useChrome();
  return (
    <section id="what" className="scroll-mt-24 bg-paper pb-16 md:pb-24">
      <div className="container-site">
        <Reveal>
          <h2 className="max-w-4xl font-display text-2xl font-medium tracking-tight text-balance text-ink md:text-4xl">What you can do with it.</h2>
        </Reveal>
      </div>
      <div className="container-site mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.06}>
            <Link href={`${base}/${f.to}`} className="group relative block aspect-[4/5] overflow-hidden rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue">
              <div className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-[1.03]"><TrayPicture offset={f.offset} /></div>
              {/* the words sit on a solid panel in the card's colour, which fades up into the core */}
              <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(to top, ${f.tint} 0%, ${f.tint} 44%, ${f.tint}00 64%)` }} />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white md:p-7">
                <h3 className="font-display text-2xl font-medium tracking-tight md:text-[28px]">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-white/80">{f.body}</p>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/** A full-bleed band of real core between sections: consecutive rows of one tray. */
export function CoreRun({ rows, caption }: { rows: string[]; caption: string }) {
  return (
    <figure className="m-0 bg-ink">
      <div className="flex flex-col gap-[3px] py-[3px]">
        {rows.map((src) => (
          <div key={src} role="img" aria-label={`Drill core, ${caption}`} className="w-full bg-no-repeat"
            style={{ backgroundImage: `url(${src})`, backgroundSize: `${100 / (1 - 0.057)}% auto`, backgroundPosition: "100% 0", aspectRatio: `${3200 * (1 - 0.057)} / ${172 * 0.62}` }} />
        ))}
      </div>
      <figcaption className="container-site py-2 text-xs text-white/60">{caption}</figcaption>
    </figure>
  );
}

const NOTES: [string, string][] = [
  ["A second opinion, not a replacement.", "CoreFlagging points at intervals worth another look. A geologist, the tray photograph and the core decide."],
  ["Checked in Western Australia.", "Against the logs and the chemistry in GSWA's drillhole database. Holes from other States are read the same way but not yet checked."],
  ["It is wrong sometimes.", "Some intervals it reads as ultramafic are basalt by their chemistry, and weathering clays hide the rock they came from."],
  ["Not a grade estimate.", "It points at the metres worth assaying; it gives no grade and replaces no assay."],
];

/** What to keep in mind, in plain words. */
export function CoreNotes() {
  return (
    <section id="notes" className="bg-paper py-16 md:py-24">
      <div className="container-site flex flex-col gap-10 lg:flex-row lg:gap-20">
        <Reveal className="lg:w-2/5">
          <h2 className="font-display text-[32px] font-medium leading-[1.1] tracking-tight text-balance text-ink md:text-6xl">Read it with care</h2>
        </Reveal>
        <Reveal delay={0.1} className="flex-1">
          <dl className="grid gap-x-12 sm:grid-cols-2">
            {NOTES.map(([t, b]) => (
              <div key={t} className="border-t border-line py-6">
                <dt className="font-display text-xl font-semibold text-ink">{t}</dt>
                <dd className="mt-2 max-w-[46ch] text-[15px] leading-relaxed text-ink-soft">{b}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

/** Who built it, in the platform's team-card layout. */
export function CoreTeam() {
  const t = useT();
  return (
    <section id="team" className="scroll-mt-24 bg-paper pt-8 pb-20 md:pb-28">
      <div className="container-site flex flex-col gap-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <Reveal><h2 className="font-display text-3xl font-medium tracking-tight text-ink md:text-5xl">The team built this.</h2></Reveal>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <a href="https://nlp-tlp.org/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ntlp-logo.png" alt="" className="size-12 rounded-full" />
              <span className="max-w-[17rem] text-[15px] leading-snug text-ink-soft">UWA Centre for Natural and Technical Language Processing</span>
            </a>
            <a href="https://criticalresources.org.au/" target="_blank" rel="noopener noreferrer" aria-label="ARC Training Centre in Critical Resources for the Future">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/critical-resources-logo.svg" alt="" className="h-10 w-auto" />
            </a>
            <a href="https://www.dmirs.wa.gov.au/gswa" target="_blank" rel="noopener noreferrer" aria-label="Geological Survey of Western Australia, Department of Mines, Petroleum and Exploration" className="flex h-12 items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/gswa-logo.png" alt="" className="h-10 w-10" />
              <span className="text-[11px] font-semibold leading-tight text-slate-800">Geological Survey of<br />Western Australia</span>
            </a>
          </div>
        </div>
        <ul className="-mx-5 flex snap-x gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 xl:grid-cols-5">
          {CORE_TEAM.map((m) => (
            <li key={m.name} className="flex w-[300px] shrink-0 snap-start flex-col rounded-3xl border border-line bg-white p-6 md:w-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.img} alt={m.name} className="size-20 rounded-full object-cover" />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-semibold text-ink">{m.name}</span>
                {m.leader && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{t("team.leader")}</span>}
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{t(m.blurb)}</p>
              <a href={m.href} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-ink underline-offset-4 hover:underline">
                {t("team.viewProfile")}<ArrowUpRight className="size-4" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STEPS: [string, string][] = [
  ["The scanner reads the core every centimetre", "A HyLogger records a spectrum about every centimetre of core. The visible to short-wave infrared (0.4\u20132.5 \u00b5m) picks up iron oxides, clays, micas, chlorite, carbonates and talc; the thermal infrared (6\u201314.5 \u00b5m) picks up quartz and feldspar, which the short-wave infrared cannot see."],
  ["Every hole is cleaned the same way", "All 1,747 scans in GSWA's core library are downloaded. Scans of drill chips rather than solid core are dropped. Bad readings are masked: the short-wave infrared by TSG's own quality mask, the thermal infrared where it is too dark, broken or above 1, and only 6.5\u201314 \u00b5m is kept. HyLogger 4's thermal infrared is resampled onto HyLogger 3's wavelength grid, and the readings are averaged over 10 cm, which cuts the noise about 3.5 times. That gives 5.38 million intervals in 1,696 holes."],
  ["HyFormer learns the core by filling in blanks", "HyFormer is trained on millions of 10 cm intervals without labels. In each training example part of the scan is hidden, in one of three ways: a run of depth is blanked out across both sensors (0.5\u20135 m of core), or one whole sensor is blanked out (the thermal infrared, or the short-wave infrared), or a band of wavelengths within one sensor is blanked out. The model has to rebuild the hidden part from what is left, and to do that it learns how minerals go together and how they change down a hole. Logs and assays are kept for scoring only; the rock classifier alone is fine-tuned on the training holes' logs."],
  ["One foundation model, multiple tasks", "Once trained, HyFormer turns each 10 cm interval into a representation: a vector that summarises what the scan says about that interval. The same representation is reused for several tasks without training a new model: it classifies the rock, fills in the thermal infrared for scans that had no such sensor, finds the domain boundaries, flags the metres that stand out from their surroundings, and finds similar core across the State by nearest neighbours in the representation space."],
];

/** How it works: four steps in order, in the notes' quiet card style. */
export function CoreHow() {
  return (
    <section id="how" className="scroll-mt-24 bg-paper pb-16 md:pb-24">
      <div className="container-site">
        <Reveal><h2 className="font-display text-2xl font-medium tracking-tight text-ink md:text-4xl">How it works</h2></Reveal>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2">
          {STEPS.map(([t, b], i) => (
            <Reveal key={t} delay={i * 0.06}>
              <li className="flex h-full flex-col rounded-3xl border border-line bg-white p-6">
                <span className="font-display text-sm font-semibold text-ink-soft tabular-nums">{i + 1}</span>
                <p className="mt-3 font-display text-xl font-semibold text-ink">{t}</p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{b}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

const FOUND: [string, string, string][] = [
  ["Anomaly detection \u00b7 which metres hold gold", "0.75 vs 0.64", "HyFormer's unusualness score ranks the gold-bearing metres with an AUC of 0.75 on 105 assayed holes and 0.77 on 23 unseen ones; the best conventional method stays near 0.64. With no assays to calibrate against, the two tie."],
  ["Domain boundaries \u00b7 where the rock changes", "0.45 vs 0.39 F1", "HyFormer's domain boundaries fall within a metre of the geologists' logged contacts with an F1 of 0.45; principal components of the raw spectra reach 0.39, TSG scalars and wavelets less. The gap holds statistically (p = 0.002)."],
  ["TIR completion \u00b7 thermal infrared without the sensor", "10 of 10 test sets", "Older scans have no thermal infrared, so their quartz and feldspar were never recorded. HyFormer predicts it from the short-wave infrared alone and beats the best conventional method on all ten test sets, from unseen Western Australian holes to other instruments, petroleum wells and the other States."],
  ["Rock classification \u00b7 rock type from spectra", "58% vs 44%", "Fine-tuned HyFormer names the rock class of a 10 cm interval correctly 58% of the time, over 12 classes from ultramafic to regolith, on 26 unseen holes; always guessing the commonest class gives 44%, TSG scalars with a linear model 31%. Pre-training adds little here: the same network from scratch reaches 56%."],
];

/** What it found: the four results of the hackathon deck, each against the best conventional method. */
export function CoreFound() {
  return (
    <section id="found" className="scroll-mt-24 bg-paper pb-16 md:pb-24">
      <div className="container-site">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <Reveal><h2 className="font-display text-2xl font-medium tracking-tight text-ink md:text-4xl">What it found</h2></Reveal>
        </div>
        <dl className="mt-8 grid gap-x-10 sm:grid-cols-2">
          {FOUND.map(([t, n, b]) => (
            <Reveal key={t}>
              <div className="border-t border-line py-6">
                <dt><span className="block text-[13px] font-medium uppercase tracking-wide text-ink-soft">{t}</span><span className="mt-1 block font-display text-3xl font-semibold tracking-tight text-ink tabular-nums md:text-4xl">{n}</span></dt>
                <dd className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-ink-soft">{b}</dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** The closing line, on its own before the team. */
export function CoreClosing() {
  return (
    <section aria-label="In short" className="bg-paper py-16 md:py-24">
      <div className="container-site">
        <Reveal>
          <p className="max-w-4xl font-display text-[26px] font-medium leading-snug tracking-tight text-balance text-ink md:text-[40px]">
            CoreFlagging doesn&rsquo;t replace the geologist. It reads every metre the geologist didn&rsquo;t have time to, and where the core and the log disagree, it asks for another pair of eyes.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
