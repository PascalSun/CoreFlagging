import Script from "next/script";
import { gaMeasurementId, gtagInit, gtagSrc } from "@/lib/ga";

// process.env.* is read literally here so Next inlines both at build time
const GA_ID = gaMeasurementId(process.env.NODE_ENV, process.env.NEXT_PUBLIC_GA_ID);

/** Google Analytics 4, in production builds only (see src/lib/ga.ts). Client-side route changes are counted by GA4's
 *  enhanced measurement (browser history events), so this sends no page views of its own.
 *  Loaded after the window load event (lazyOnload), so gtag.js never competes with the first screen. */
export function GoogleAnalytics({ id = GA_ID }: { id?: string | null }) {
  if (!id) return null;
  return (
    <>
      <Script src={gtagSrc(id)} strategy="lazyOnload" />
      <Script id="ga4-init" strategy="lazyOnload">
        {gtagInit(id)}
      </Script>
    </>
  );
}
