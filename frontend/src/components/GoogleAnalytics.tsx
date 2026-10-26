import Script from "next/script";

// GA4 measurement ID (public — it ships to the client). Override via NEXT_PUBLIC_GA_ID if needed.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-BQK1R4CS7C";

/** Google Analytics 4. Enhanced measurement (on by default in GA4) tracks SPA page views via the
 *  History API, so client-side route changes are counted without extra wiring. Loaded after the page's
 *  own load (lazyOnload) so its ~180 KB never competes with the first screen. */
export function GoogleAnalytics() {
  if (!GA_ID) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="lazyOnload" />
      <Script id="ga4-init" strategy="lazyOnload">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
      </Script>
    </>
  );
}
