// Google Analytics 4. The measurement ID is public (it ships in every page), so it is committed here, the one place
// it is set. NEXT_PUBLIC_GA_ID overrides it at build time; set it to an empty value to build without analytics.

export const GA_MEASUREMENT_ID = "G-ZCGVJ94FVV";

const ID_FORMAT = /^G-[A-Z0-9]+$/;

/** The ID to load, or null for no analytics. Only production builds count visits (dev and test never do), an empty
 *  override turns it off (e.g. for a preview build), and anything that is not a GA4 ID is refused, since the ID is
 *  written into an inline script. */
export function gaMeasurementId(nodeEnv: string | undefined, override: string | undefined): string | null {
  if (nodeEnv !== "production") return null;
  const id = (override ?? GA_MEASUREMENT_ID).trim();
  return ID_FORMAT.test(id) ? id : null;
}

export const gtagSrc = (id: string) => `https://www.googletagmanager.com/gtag/js?id=${id}`;

/** The standard gtag bootstrap. `config` sends the first page view; GA4's enhanced measurement ("page changes based
 *  on browser history events", on by default) counts client-side navigations, so nothing else sends page views. */
export const gtagInit = (id: string) => `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');`;
