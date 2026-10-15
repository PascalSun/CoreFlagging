import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Manrope, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { Providers } from "./providers";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// landing-page faces (home page chrome only; other routes keep Geist)
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CoreFlagging — Australia's scanned drill core, read metre by metre",
  description: "Every HyLogger-scanned drillhole in Australia's core libraries, read by a core-spectra model.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // extend under the notch/home-indicator; panels add safe-area padding
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} ${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <Providers>{children}</Providers>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
