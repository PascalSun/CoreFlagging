import type { Metadata, Viewport } from "next";
import { FooterSpacer } from "@/components/landing/footer";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { JSON_LD, pageMeta } from "@/lib/seo";
import { THEMED_VIEWPORT } from "@/lib/theme";
import { CoreClosing, CoreFeatures, CoreFooter, CoreFound, CoreHero, CoreHow, CoreIntro, CoreNavbar, CoreNotes, CoreRun, CoreTeam } from "@/components/coretrace/landing";

// CoreFlagging's landing page. Same chrome, type and rhythm as the platform's landing page;
// served at "/" on CoreFlagging's own host (src/proxy.ts) and at /coretrace everywhere else.

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  ...pageMeta("/", "CoreFlagging — a second opinion on every metre of core",
    "CoreFlagging reads every HyLogger-scanned drillhole the same way and sets its reading beside the geologist's log, so the intervals where they disagree get another look. Checked against logs and chemistry in Western Australia."),
  // added to the home screen: iOS's own status bar (a translucent one would put white text on the day ground)
  appleWebApp: { capable: true, title: "CoreFlagging", statusBarStyle: "default" },
};

// The browser's own bar (Safari's tab strip, Chrome on Android) takes the page's ground, day or night, so the top
// of the screen is one surface with the navbar instead of a band of another colour over it.
export const viewport: Viewport = THEMED_VIEWPORT;

export default function CoreTraceHome() {
  return (
    <div className="core-theme bg-paper text-ink [font-family:var(--font-jakarta),system-ui,sans-serif]">
      {/* structured data for search and answer engines (src/lib/seo.ts) */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
      <SmoothScroll />
      <CoreNavbar />
      <main className="relative z-10 bg-paper">
        <CoreHero />
        <CoreIntro />
        <CoreHow />
        <CoreFound />
        <CoreFeatures />
        <CoreRun rows={["/coretrace/07THD002-0058-r2.webp", "/coretrace/07THD002-0058-r3.webp", "/coretrace/07THD002-0058-r4.webp"]} caption="Hole 07THD002, 365.6 to 368.3 m. Geological Survey of Western Australia, NVCL." />
        <CoreNotes />
        <CoreClosing />
        <CoreTeam />
      </main>
      <FooterSpacer />
      <CoreFooter />
    </div>
  );
}
