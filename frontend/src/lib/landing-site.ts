// Landing-page chrome constants (ported from the landing-sample template).
// Naming values are placeholders until the product rename lands.

export const site = {
  name: "nlp-tlp",
  // The one copy of the address the platform is reachable at, so the footer, the
  // verify dialog and the feedback form cannot drift apart. It is deliberately in
  // the open: the people who most need to reach us are the ones who could not sign
  // in, and they cannot use anything that lives behind a session. The address is
  // already public on the UWA research repository; being reachable is worth more
  // than the spam.
  email: "pascal.sun@uwa.edu.au",
  emailDisplay: "PASCAL.SUN@UWA.EDU.AU",
  phone: "",
  phoneHref: "",
};

// Text links only — the Map CTA is a separate pill button in the navbar.
// (/open mints a session and forwards to the map workspace; signed-out
// visitors come back to "/?gate=1" where the email-gate modal takes over.)
export const navLinks = [
  { label: "Home", href: "/" },
  { label: "Gold Run", href: "/game" },
  { label: "Research", href: "/research/minetrace" },
] as const;

export const footerSitemap = [
  { label: "Map", href: "/open" },
  { label: "Data sources", href: "/data" },
  { label: "Shared datasets", href: "/datasets" },
] as const;

export const footerContact = [
  { label: "pascal.sun@uwa.edu.au", href: "mailto:pascal.sun@uwa.edu.au" },
] as const;

export const footerSocials = [
  { label: "GitHub", href: "https://github.com/" },
  { label: "Linkedin", href: "https://linkedin.com/" },
] as const;

/** Footer reveal: the fixed footer and the spacer at the end of <main> must
 * share this height so content scrolls up to reveal it exactly. The md height
 * tracks the viewport width because the fit-to-width wordmark (~21vw tall)
 * dominates the footer's lower half. */
export const FOOTER_HEIGHT_CLASS =
  "h-[720px] min-h-fit md:h-[calc(26rem+23vw)]";
