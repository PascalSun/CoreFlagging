import { Suspense } from "react";
import type { Metadata } from "next";
import { CoreTraceMap } from "@/components/coretrace/CoreTraceMap";

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  title: "CoreTrace — Map of scanned drill core",
  description: "Every HyLogger-scanned drillhole in Australia's core libraries, read metre by metre by a core-spectra model. Upload your own scan.",
};

export default function CoreTraceMapPage() {
  return (
    // useSearchParams needs a boundary: what is open is read from the address
    <Suspense fallback={<div className="fixed inset-0 bg-slate-50" />}>
      <CoreTraceMap />
    </Suspense>
  );
}
