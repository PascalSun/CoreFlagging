import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Manrope, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { Providers } from "./providers";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { KEYWORDS, SHARE_IMAGE, SITE_NAME, SITE_URL } from "@/lib/seo";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// landing-page faces (home page chrome only; other routes keep Geist)
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL), // canonicals and Open Graph URLs resolve against the public host
  applicationName: SITE_NAME,
  keywords: KEYWORDS,
  title: "CoreFlagging — Australia's scanned drill core, read metre by metre",
  description: "Every HyLogger-scanned drillhole in Australia's core libraries, read by a core-spectra model.",
  // the share image for pages that don't set their own Open Graph (public pages use pageMeta, which carries it too)
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_AU", images: [SHARE_IMAGE] },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE] },
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
