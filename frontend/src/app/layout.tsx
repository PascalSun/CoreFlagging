import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import { Providers } from "./providers";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { KEYWORDS, SHARE_IMAGE, SITE_NAME, SITE_URL } from "@/lib/seo";
import { THEME_BOOT } from "@/lib/theme";

// The faces come from pinned Fontsource packages (the Google Fonts files, latin subset) through next/font/local:
// next/font/google downloads them during `next build`, and a failed download failed the deploy (GeoThought,
// 2026-11-02). With these the build fetches nothing but the packages bun installs.
const geistSans = localFont({ variable: "--font-geist-sans", src: "../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2", weight: "100 900" });
const geistMono = localFont({ variable: "--font-geist-mono", src: "../../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2", weight: "100 900" });
// landing-page faces (home page chrome only; other routes keep Geist)
const manrope = localFont({ variable: "--font-manrope", src: "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2", weight: "200 800" });
const jakarta = localFont({ variable: "--font-jakarta", src: "../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2", weight: "200 800" });

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
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} ${jakarta.variable} h-full antialiased`}>
      {/* the saved day/night choice, before the first paint (only the home page is themed; elsewhere it is inert) */}
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <Providers>{children}</Providers>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
