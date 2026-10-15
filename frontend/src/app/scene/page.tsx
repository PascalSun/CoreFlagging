import { Suspense } from "react";
import type { Metadata } from "next";
import { Scene } from "@/components/coretrace/Scene";

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  title: "CoreFlagging — A hole in space",
  description: "A scanned drillhole and its neighbours as lines in space, coloured by what the model read, with the intervals worth a second look.",
};

export default function ScenePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-slate-50" />}>
      <Scene />
    </Suspense>
  );
}
