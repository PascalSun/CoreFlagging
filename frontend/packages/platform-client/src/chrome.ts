// The chrome (navbar, footer) a site wears, and where a sign-in lands on each host.

type NavLink = { label: string; href: string };

export type Chrome = {
  /** Brand lockup; the second part drops to its own line on small screens. */
  brand: readonly [string, string];
  /** The square mark beside the brand name. */
  mark: string;
  home: string;
  navLinks: readonly NavLink[];
  /** The ink pill at the right of the navbar. */
  cta: NavLink;
  /** The large link at the top of the footer. */
  footerCta: NavLink;
  sitemap: readonly NavLink[];
  socials: readonly NavLink[];
  contact: readonly NavLink[];
  /** Offer the language picker (only where the pages are translated). */
  languages: boolean;
  /** Footer wordmark and its width in em (Geist 600, -0.06em tracking). */
  wordmark: { text: string; emWidth: number };
};

/** Where a person goes once signed in on this host: each research app's own map. */
export function appEntry(hostname: string): string {
  return hostname.toLowerCase().startsWith("coretrace.") ? "/map" : "/open";
}
