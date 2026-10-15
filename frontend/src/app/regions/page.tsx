import type { Metadata } from "next";
import { Regions } from "@/components/coretrace/Regions";

export const metadata: Metadata = {
  icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  title: "CoreFlagging — Core by region",
  description: "What the scanned core of each tectonic region of Western Australia is made of, from one model's reading of every HyLogger hole.",
};

export default function RegionsPage() {
  return <Regions />;
}
