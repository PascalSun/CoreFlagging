// The sites served from this codebase, and the chrome (navbar, footer) each one wears.
// A site is picked by hostname in src/proxy.ts; the landing components take a Chrome
// so the same navbar and footer serve every site.

import { footerContact, footerSitemap, footerSocials, navLinks } from "@/lib/landing-site";

// the Chrome type and appEntry live in the shared client; re-exported so imports keep working
export type { Chrome } from "@ntlp/geodata-web/chrome";
export { appEntry } from "@ntlp/geodata-web/chrome";
import type { Chrome } from "@ntlp/geodata-web/chrome";

export const groundworkChrome: Chrome = {
  brand: ["MINETRACE", ""],
  mark: "/brand/minetrace-mark.svg",
  home: "/",
  navLinks,
  cta: { label: "Map", href: "/open" },
  footerCta: { label: "Open the Map", href: "/open" },
  sitemap: footerSitemap,
  socials: footerSocials,
  contact: footerContact,
  languages: true,
  wordmark: { text: "MINETRACE", emWidth: 5.75 },
};

/** "" on CoreFlagging's own host, "/coretrace" when its pages are opened on the main host. */
/** This app serves CoreFlagging alone, at the root of its own host: there is no path prefix. */
export function coretraceBase(_pathname: string): string {
  return "";
}

export function coretraceChrome(base: string): Chrome {
  const home = base || "/";
  return {
    brand: ["CoreFlagging", ""],
    mark: "/brand/coretrace-mark.svg",
    home,
    navLinks: [
      { label: "Home", href: home },
      { label: "What it does", href: `${home}#what` },
      { label: "Read with care", href: `${home}#notes` },
      { label: "Team", href: `${home}#team` },
    ],                                                  // the FAQ: in the footer's site map
    cta: { label: "Map", href: `${base}/map` },
    footerCta: { label: "Open the Map", href: `${base}/map` },
    sitemap: [
      { label: "Map", href: `${base}/map` },
      { label: "Upload a scan", href: `${base}/map?upload=1` },
      { label: "FAQ", href: `${base}/faq` },
      { label: "Geo Research Platform", href: "https://geo.nlp-tlp.org" },
    ],
    socials: footerSocials,
    contact: footerContact,
    languages: false,
    wordmark: { text: "CoreFlagging", emWidth: 5.86 },
  };
}
