import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FitWordmark } from "@/components/landing/fit-wordmark";
import { FOOTER_HEIGHT_CLASS, site } from "@/lib/landing-site";
import { groundworkChrome, type Chrome } from "@/lib/sites";
import { cn } from "@/lib/utils";
import { HERO_IMG_BASE } from "@/lib/hero";

function LinkColumn({
  title,
  links,
}: {
  title: string;
  links: readonly { label: string; href: string }[];
}) {
  // mailto: is external too — and must NOT open in a new tab, which would leave a
  // blank window behind when the mail client takes over.
  const external = (href: string) => href.startsWith("http") || href.startsWith("mailto:");
  const newTab = (href: string) => href.startsWith("http");
  return (
    <div className="flex flex-col gap-4">
      <span className="label-caps text-ink/60">{title}</span>
      <ul className="flex flex-col gap-2.5">
        {links.map((l) =>
          external(l.href) ? (
            <li key={l.label}>
              <a
                href={l.href}
                target={newTab(l.href) ? "_blank" : undefined}
                rel={newTab(l.href) ? "noreferrer" : undefined}
                className="font-display text-lg font-medium text-ink transition-colors hover:text-white"
              >
                {l.label}
              </a>
            </li>
          ) : (
            <li key={l.label}>
              <Link
                href={l.href}
                className="font-display text-lg font-medium text-ink transition-colors hover:text-white"
              >
                {l.label}
              </Link>
            </li>
          )
        )}
      </ul>
    </div>
  );
}

/**
 * Template reveal footer: fixed to the viewport bottom BEHIND the page (z-0);
 * <main> carries z-10 and a bg, and FooterSpacer reserves matching scroll
 * room at the end of the page so the footer is progressively revealed as the
 * content scrolls away. Frosted-cyan pane over the real WA scene kept.
 */
export function Footer({ chrome = groundworkChrome }: { chrome?: Chrome }) {
  return (
    <footer
      className={cn(
        "fixed inset-x-0 bottom-0 z-0 flex flex-col justify-between overflow-hidden",
        FOOTER_HEIGHT_CLASS
      )}
    >
      {/* the scene BEHIND the glass: the real WA survey chart + Au surface.
          Frost is only frost when there is something textured to blur. */}
      <div aria-hidden className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${HERO_IMG_BASE}/hero_terrain_light.jpg`} alt="" className="h-full w-full scale-105 object-cover" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${HERO_IMG_BASE}/hero_heat_Au.png`} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover opacity-80" />
      </div>
      {/* the frosted pane, keeping the cyan hue */}
      <div aria-hidden className="absolute inset-0 bg-cyan/35 backdrop-blur-2xl backdrop-saturate-150" />
      <div className="container-site relative flex flex-1 flex-col pt-14 md:pt-20">
        <div className="flex flex-col justify-between gap-12 md:flex-row">
          <div className="flex flex-col items-start gap-10">
            <Link
              href={chrome.footerCta.href}
              className="group flex items-center gap-5 font-display text-3xl font-semibold tracking-tight text-ink md:text-[40px]"
            >
              {chrome.footerCta.label}
              {/* Black pill; on hover the white arrow exits right and a cyan
                  twin swaps in from the left, both with the rhythmic easing
                  (which also plays in reverse on mouse leave). */}
              <span className="relative flex h-10 w-[72px] items-center justify-center overflow-hidden rounded-full bg-ink">
                <ArrowRight className="size-6 text-white transition-transform duration-700 ease-[cubic-bezier(0.87,0,0.13,1)] group-hover:translate-x-12" />
                <ArrowRight className="absolute size-6 -translate-x-12 text-cyan transition-transform duration-700 ease-[cubic-bezier(0.87,0,0.13,1)] group-hover:translate-x-0" />
              </span>
            </Link>
          </div>
          <div className="flex gap-16 md:gap-24">
            <LinkColumn title="SITEMAP" links={chrome.sitemap} />
            <LinkColumn title="SOCIALS" links={chrome.socials} />
            {/* Plainly, where anyone can find it signed out — which is the only state
                the person who could not sign in is ever in. */}
            <LinkColumn title="CONTACT" links={chrome.contact} />
          </div>
        </div>

        {/* Push the legal row down, but cap the gap so the middle of the
            footer doesn't feel empty. */}
        <div className="min-h-10 max-h-28 flex-1" />
        <div className="label-caps flex flex-col justify-between gap-2 pb-10 text-ink/80 md:flex-row">
          <p>Copyright 2026 {site.name}. All rights reserved.</p>
          <p className="flex items-center gap-2">
            <Link href="https://geo.nlp-tlp.org/privacy" className="hover:text-ink">
              Privacy policy
            </Link>
            <span aria-hidden>・</span>
            <Link href="https://geo.nlp-tlp.org/terms" className="hover:text-ink">
              Terms of use
            </Link>
          </p>
        </div>
      </div>

      {/* Giant wordmark, fit exactly to the header content width. The tight
          -0.06em tracking shrinks the text's aspect ratio, which lets the
          fit-to-width font size grow — closer letters, bigger presence. */}
      <div className="container-site relative">
        {/* emWidth measured in the rendered font (Geist 600, -0.06em tracking) */}
        <FitWordmark
          text={chrome.wordmark.text}
          emWidth={chrome.wordmark.emWidth}
          className="pointer-events-none font-sans font-semibold tracking-[-0.06em] text-ink select-none"
        />
      </div>
    </footer>
  );
}

/** Scroll room for the fixed footer — keep at the very end of the page. */
export function FooterSpacer() {
  return <div aria-hidden className={FOOTER_HEIGHT_CLASS} />;
}
