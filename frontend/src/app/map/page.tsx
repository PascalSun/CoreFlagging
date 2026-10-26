import { Suspense } from "react";
import type { Metadata } from "next";
import { CoreTraceMap } from "@/components/coretrace/CoreTraceMap";
import { pageMeta } from "@/lib/seo";

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  // canonical without the query: ?hole=&m= views are the same page with a different hole open
  ...pageMeta("/map", "CoreFlagging — Map of scanned drill core",
    "Every HyLogger-scanned drillhole in Australia's core libraries, read metre by metre by a core-spectra model. Upload your own scan."),
};

export default function CoreTraceMapPage() {
  return (
    // useSearchParams needs a boundary: what is open is read from the address
    <Suspense fallback={<div className="fixed inset-0 bg-slate-50" />}>
      <CoreTraceMap />
    </Suspense>
  );
}
