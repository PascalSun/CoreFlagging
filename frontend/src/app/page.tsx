import type { Metadata } from "next";
import { FooterSpacer } from "@/components/landing/footer";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import { CoreClosing, CoreFeatures, CoreFooter, CoreFound, CoreHero, CoreHow, CoreIntro, CoreNavbar, CoreNotes, CoreRun, CoreTeam } from "@/components/coretrace/landing";

// CoreTrace's landing page. Same chrome, type and rhythm as the platform's landing page;
// served at "/" on CoreTrace's own host (src/proxy.ts) and at /coretrace everywhere else.

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  title: "CoreTrace — a second opinion on every metre of core",
  description: "CoreTrace reads every HyLogger-scanned drillhole the same way and sets its reading beside the geologist's log, so the intervals where they disagree get another look. Checked against logs and chemistry in Western Australia.",
};

export default function CoreTraceHome() {
  return (
    <div className="bg-paper text-ink [font-family:var(--font-jakarta),system-ui,sans-serif]">
      <SmoothScroll />
      <CoreNavbar />
      <main className="relative z-10 bg-paper">
        <CoreHero />
        <CoreIntro />
        <CoreHow />
        <CoreFound />
        <CoreFeatures />
        <CoreRun rows={["/coretrace/07THD002-0058-r2.jpg", "/coretrace/07THD002-0058-r3.jpg", "/coretrace/07THD002-0058-r4.jpg"]} caption="Hole 07THD002, 365.6 to 368.3 m. Geological Survey of Western Australia, NVCL." />
        <CoreNotes />
        <CoreClosing />
        <CoreTeam />
      </main>
      <FooterSpacer />
      <CoreFooter />
    </div>
  );
}
