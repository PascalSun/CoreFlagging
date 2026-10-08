"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { StatusDot } from "@/components/landing/status-dot";
import { FeedbackButton } from "@/components/FeedbackButton";
import { LOCALES, useLocale } from "@/lib/i18n";
import { groundworkChrome, type Chrome } from "@/lib/sites";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Language picker restyled for the landing chrome: caps label + chevron,
 * flat white card menu. `up` opens the card above the trigger (for the
 * bottom row of the mobile menu). */
function LangMenu({ up = false }: { up?: boolean }) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Language"
        className={cn(
          "label-caps flex items-center gap-1 transition-colors",
          open ? "text-ink" : "text-ink-soft hover:text-ink"
        )}
      >
        {locale}
        <ChevronDown className={cn("size-3.5 transition-transform duration-300", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <span
            className={cn(
              "absolute right-0 z-50 flex w-32 flex-col overflow-hidden rounded-xl border border-line bg-white py-1.5 shadow-glass-sm",
              up ? "bottom-[calc(100%+14px)]" : "top-[calc(100%+14px)]"
            )}
          >
            {LOCALES.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => { setLocale(l.key); setOpen(false); }}
                className={cn(
                  "px-4 py-2 text-left font-display text-sm font-semibold transition-colors",
                  locale === l.key ? "text-ink" : "text-ink-soft/60 hover:text-ink"
                )}
              >
                {l.label}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}

/** The map CTA: a quiet ink pill reading just MAP. On hover the pill
 * stretches (leftward — its right edge is anchored by the nav) while an
 * arrow grows out on the right, with the same rhythmic easing as the
 * scrollspy index and the footer CTA — and it plays in reverse on leave. */
function MapCta({ cta, className }: { cta: Chrome["cta"]; className?: string }) {
  return (
    <Link
      href={cta.href}
      className={cn(
        "group flex h-12 items-center rounded-full bg-ink px-7 font-display text-sm font-bold tracking-wide text-white uppercase",
        className
      )}
    >
      <span className="transition-colors duration-700 ease-[cubic-bezier(0.87,0,0.13,1)] group-hover:text-cyan">
        {cta.label}
      </span>
      {/* zero-width slot that opens up; the arrow rides its right edge so it
          appears to grow out of the label */}
      <span className="flex w-0 items-center justify-end overflow-hidden transition-[width] duration-700 ease-[cubic-bezier(0.87,0,0.13,1)] group-hover:w-8">
        <ArrowRight className="size-5 flex-none -translate-x-5 text-cyan transition-transform duration-700 ease-[cubic-bezier(0.87,0,0.13,1)] group-hover:translate-x-0" />
      </span>
    </Link>
  );
}

/** Brand lockup: the platform name, breaking to two lines on small screens
 * where it would otherwise crowd the hamburger. */
function BrandLockup({ chrome }: { chrome: Chrome }) {
  return (
    <Link
      href={chrome.home}
      className="flex items-center gap-3 font-display text-lg leading-[1.05] font-bold tracking-tight text-ink md:text-2xl"
    >
      <Image src={chrome.mark} alt="" width={36} height={36} priority className="size-9 shrink-0 rounded-[9px] md:size-10" />
      <span>{chrome.brand[0]}<br className="md:hidden" /> {chrome.brand[1]}</span>
    </Link>
  );
}

function UnderlineLink({
  href,
  label,
  current,
  className,
}: {
  href: string;
  label: string;
  current: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "group relative py-1 font-display text-lg font-semibold text-ink",
        className
      )}
    >
      {label}
      {/* Orange underline wipes in from the left on hover */}
      <span className="absolute -bottom-px left-0 h-[3px] w-full overflow-hidden">
        <span className="absolute inset-y-0 left-0 w-full -translate-x-[102%] bg-orange transition-transform duration-300 ease-out group-hover:translate-x-0" />
      </span>
    </Link>
  );
}

export function Navbar({ chrome = groundworkChrome }: { chrome?: Chrome }) {
  const pathname = usePathname();
  const navLinks = chrome.navLinks;
  const [open, setOpen] = useState(false);

  // close the mobile menu on navigation — the React-sanctioned
  // "adjust state during render when a prop changes" pattern
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    // Paper-tinted glass, no bottom shadow/edge: over the paper page the bar
    // dissolves into the background; over the hero it still frosts.
    <header className="fixed inset-x-0 top-0 z-50">
      {/* The glass lives on its own layer: backdrop-filter turns an element
          into the containing block for fixed descendants, which would pin the
          full-screen mobile menu inside this 80px bar. The header itself must
          stay filter-free. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-paper/55 backdrop-blur-xl backdrop-saturate-150"
      />
      <nav className="container-site relative flex h-20 items-center justify-between">
        <BrandLockup chrome={chrome} />

        {/* Desktop: links · hairline · status dot + language · the Map CTA */}
        <div className="hidden items-center gap-7 md:flex">
          <ul className="flex items-center gap-7">
            {navLinks.map((link) => (
              <li key={link.href}>
                <UnderlineLink
                  href={link.href}
                  label={link.label}
                  current={
                    pathname === link.href || pathname.startsWith(`${link.href}/`) ||
                    (link.href.startsWith("/research") && pathname.startsWith("/research"))
                  }
                />
              </li>
            ))}
          </ul>
          <span aria-hidden className="h-5 w-px bg-line" />
          {/* Same cluster as the workspace pill — status, language, feedback — so the
              control is in the same relative place whichever chrome you are under. It
              renders only when signed in; a signed-out visitor gets no dead button. */}
          <span className="flex items-center gap-5">
            <StatusDot />
            {chrome.languages && <LangMenu />}
            <FeedbackButton tone="paper" />
          </span>
          <MapCta cta={chrome.cta} />
        </div>

        {/* Mobile hamburger: two bars meet in the middle, then cross */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="relative z-[70] flex size-10 items-center justify-center md:hidden"
        >
          <span
            className={cn(
              "absolute h-[3px] w-7 bg-ink transition-transform duration-300",
              open ? "rotate-45" : "-translate-y-[5px]"
            )}
          />
          <span
            className={cn(
              "absolute h-[3px] w-7 bg-ink transition-transform duration-300",
              open ? "-rotate-45" : "translate-y-[5px]"
            )}
          />
        </button>
      </nav>

      {/* Mobile menu: full-screen cyan overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)" }}
            exit={{ clipPath: "inset(0 0 100% 0)" }}
            transition={{ duration: 0.45, ease: EASE }}
            className="fixed inset-0 z-[60] flex flex-col bg-cyan/85 backdrop-blur-xl md:hidden"
          >
            <div className="container-site flex h-20 items-center">
              <BrandLockup chrome={chrome} />
            </div>
            {/* Order: Home · Map · Gold Run — the Map CTA sits between the
                two text links rather than leading the list. */}
            <ul className="container-site flex flex-col gap-1 pt-8">
              {[
                navLinks[0],
                chrome.cta,
                ...navLinks.slice(1),
              ].map((link, i) => (
                <motion.li
                  key={link.href}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.12 + i * 0.06,
                    duration: 0.4,
                    ease: EASE,
                  }}
                >
                  <Link
                    href={link.href}
                    className="block py-3 font-display text-5xl font-semibold text-ink"
                  >
                    {link.label}
                  </Link>
                </motion.li>
              ))}
            </ul>
            {/* platform status + language, pinned to the overlay's bottom */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32, duration: 0.4, ease: EASE }}
              className="container-site mt-auto mb-10 flex items-center gap-6"
            >
              <StatusDot />
              {chrome.languages && <LangMenu up />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
