import type { Metadata } from "next";
import { FooterSpacer } from "@/components/landing/footer";
import { CoreFooter, CoreNavbar } from "@/components/coretrace/landing";
import { Findings } from "@/components/coretrace/Findings";

// What Core Flagging found when its reading of every WA metre was set beside the geologist's log.
// The same storyline as the hackathon pitch, in scroll form.

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  title: "Core Flagging findings",
  description: "A second opinion on every metre of WA core: where Core Flagging's reading and the geologist's log disagree, and what the chemistry says.",
};

export default function FindingsPage() {
  return (
    <div className="bg-paper text-ink [font-family:var(--font-jakarta),system-ui,sans-serif]">
      <CoreNavbar />
      <main className="relative z-10 bg-paper">
        <Findings />
      </main>
      <FooterSpacer />
      <CoreFooter />
    </div>
  );
}
