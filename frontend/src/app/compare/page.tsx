import { Suspense } from "react";
import type { Metadata } from "next";
import { Compare } from "@/components/coretrace/Compare";

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  title: "CoreTrace — Two holes side by side",
  description: "Two scanned drillholes on one depth axis: what was logged, what the model reads, and where the two disagree.",
};

export default function ComparePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-slate-50" />}>
      <Compare />
    </Suspense>
  );
}
