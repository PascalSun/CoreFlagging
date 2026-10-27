import type { Metadata } from "next";
import Link from "next/link";
import { FooterSpacer } from "@/components/landing/footer";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { CoreFooter, CoreNavbar } from "@/components/coretrace/landing";
import { answerParts, FAQ, FAQ_JSON_LD } from "@/lib/faq";
import { pageMeta } from "@/lib/seo";

// Questions about CoreFlagging, every answer open on the page: what a search engine or an answer engine reads is
// what a person reads. Laid out like the landing's "Read it with care": the title on the left, hairline rows right.

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  ...pageMeta("/faq", "CoreFlagging FAQ — HyLogger drill core, read by HyFormer",
    "Answers about CoreFlagging: which HyLogger-scanned drillholes it reads, how the HyFormer model works, how accurate it is, uploading your own scan, reports, licences and who built it."),
};

const LINK_CLASS = "text-ink underline decoration-ink/30 underline-offset-4 transition-colors hover:decoration-ink";

/** One answer, its [text](href) links rendered: the site's own pages as Link, other sites as plain anchors. */
function Answer({ a }: { a: string }) {
  return (
    <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ink-soft">
      {answerParts(a).map((p, i) =>
        !("href" in p) ? p.text : p.href.startsWith("/")
          ? <Link key={i} href={p.href} className={LINK_CLASS}>{p.text}</Link>
          : <a key={i} href={p.href} className={LINK_CLASS}>{p.text}</a>
      )}
    </p>
  );
}

export default function FaqPage() {
  return (
    <div className="bg-paper text-ink [font-family:var(--font-jakarta),system-ui,sans-serif]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD).replace(/</g, "\\u003c") }} />
      <SmoothScroll />
      <CoreNavbar />
      <main className="relative z-10 bg-paper pt-28 pb-20 md:pt-36 md:pb-28">
        <div className="container-site flex flex-col gap-10 lg:flex-row lg:gap-20">
          <div className="lg:w-2/5">
            <div className="lg:sticky lg:top-32">
              <nav aria-label="Breadcrumb">
                <ol className="flex items-center gap-2 text-sm text-ink-soft">
                  <li><Link href="/" className="hover:text-ink hover:underline underline-offset-4">CoreFlagging</Link></li>
                  <li aria-hidden>/</li>
                  <li aria-current="page" className="text-ink">FAQ</li>
                </ol>
              </nav>
              <h1 className="mt-4 font-display text-[32px] font-medium leading-[1.1] tracking-tight text-balance text-ink md:text-6xl">
                Questions about CoreFlagging
              </h1>
              <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-ink-soft">
                What it reads, how the model works, how far to trust it, and how to use it on your own core.
              </p>
            </div>
          </div>
          <ol className="flex-1">
            {FAQ.map((f) => (
              <li key={f.id} id={f.id} className="scroll-mt-28 border-t border-line py-6">
                <h2 className="font-display text-xl font-semibold text-ink md:text-2xl">{f.q}</h2>
                <Answer a={f.a} />
              </li>
            ))}
          </ol>
        </div>
      </main>
      <FooterSpacer />
      <CoreFooter />
    </div>
  );
}
