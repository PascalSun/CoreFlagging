// The frame the public data pages (hole, State, region, commodity) share: the site's own navbar and footer, a
// breadcrumb, and sections that each end with where their figures come from and under what licence.

import Link from "next/link";
import type { ReactNode } from "react";
import { FooterSpacer } from "@/components/landing/footer";
import { CoreFooter, CoreNavbar } from "@/components/coretrace/landing";
import { ldJson } from "@/lib/holePages/jsonld";

export const LINK = "text-ink underline decoration-ink/30 underline-offset-4 transition-colors hover:decoration-ink";

export function DataPage({ crumbs, title, lede, ld, children }: {
  crumbs: { name: string; path?: string }[]; title: string; lede?: ReactNode; ld: unknown[]; children: ReactNode;
}) {
  return (
    <div className="bg-paper text-ink [font-family:var(--font-jakarta),system-ui,sans-serif]">
      {ld.map((x, i) => <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(x) }} />)}
      <CoreNavbar />
      <main className="relative z-10 bg-paper pt-28 pb-20 md:pt-36 md:pb-28">
        <div className="container-site">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <li><Link href="/" className="hover:text-ink hover:underline underline-offset-4">CoreFlagging</Link></li>
              {crumbs.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span aria-hidden>/</span>
                  {c.path && i < crumbs.length - 1
                    ? <Link href={c.path} className="hover:text-ink hover:underline underline-offset-4">{c.name}</Link>
                    : <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className="text-ink">{c.name}</span>}
                </li>
              ))}
            </ol>
          </nav>
          <h1 className="mt-4 max-w-[22ch] font-display text-[32px] font-medium leading-[1.1] tracking-tight text-balance text-ink md:text-6xl">{title}</h1>
          {lede && <div className="mt-6 max-w-[62ch] text-lg leading-relaxed text-ink-soft">{lede}</div>}
          <div className="mt-12 flex flex-col">{children}</div>
        </div>
      </main>
      <FooterSpacer />
      <CoreFooter />
    </div>
  );
}

/** Where a section's figures come from and the licence they are under. */
export type Source = { name: string; url?: string; licence: string; licenceUrl?: string };

export function Section({ id, title, model, sources, children }: { id: string; title: string; model?: boolean; sources: Source[]; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-28 border-t border-line py-8 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,5fr)] lg:gap-12">
      <div>
        <h2 id={`${id}-h`} className="font-display text-xl font-semibold text-ink md:text-2xl">{title}</h2>
        {model && <p className="mt-2 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Model output</p>}
      </div>
      <div className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ink-soft lg:mt-0">
        {children}
        <SourceLine sources={sources} />
      </div>
    </section>
  );
}

export function SourceLine({ sources }: { sources: Source[] }) {
  return (
    <p className="mt-4 text-[13px] text-ink-soft/90">
      {sources.map((s, i) => (
        <span key={i} className="block">
          Source: {s.url ? <a href={s.url} className={LINK} rel="noopener">{s.name}</a> : s.name}.{" "}
          Licence: {s.licenceUrl ? <a href={s.licenceUrl} className={LINK} rel="license noopener">{s.licence}</a> : s.licence}.
        </span>
      ))}
    </p>
  );
}

export const Prose = ({ sentences }: { sentences: string[] }) => <p>{sentences.join(" ")}</p>;

/** A plain list of links to hole pages. */
export function HoleList({ holes }: { holes: { name: string; path: string; note?: string }[] }) {
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {holes.map((h) => (
        <li key={h.path} className="min-w-0 truncate">
          <Link href={h.path} className={LINK}>{h.name}</Link>{h.note ? <span className="text-ink-soft/80"> · {h.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}
