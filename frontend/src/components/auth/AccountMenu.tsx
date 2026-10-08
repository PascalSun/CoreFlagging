"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, ShieldAlert, ShieldCheck } from "lucide-react";

import { AccountDialog } from "@/components/auth/AccountDialog";
import { clearAuth, getAuth, graceDaysLeft, isVerified } from "@/lib/auth";
import { VerifyEmailDialog } from "@/components/auth/VerifyEmailDialog";
import { track } from "@/lib/analytics";
import { useT } from "@/lib/i18n";

/**
 * Account avatar for the map chrome: the first letter of the signed-in email in a
 * disc, opening a small card with the address, its verified state, and sign-out.
 * Sits beside LangSwitcher and copies its sizing so the two read as one row.
 * "Account & password" opens the AccountDialog over the map, where the password
 * for the MCP login is changed and where future preferences will live.
 */
export function AccountMenu() {
  const t = useT();
  const router = useRouter();
  // The card is portalled to <body> and positioned from the button's rect, measured when it
  // opens: the avatar lives inside the tab strip / glass bar, whose stacking contexts sit
  // under the floating map chrome, so an in-place popover would be covered by it.
  const [at, setAt] = useState<React.CSSProperties | null>(null);
  const [dialog, setDialog] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const verified = useSyncExternalStore(() => () => {}, () => isVerified(), () => true);
  const days = graceDaysLeft();
  const open = at !== null;
  const btnRef = useRef<HTMLButtonElement>(null);
  // localStorage is read on the client only; the server snapshot renders nothing so
  // hydration matches, then the avatar appears once the session is known.
  const email = useSyncExternalStore(() => () => {}, () => getAuth()?.email ?? null, () => null);

  useEffect(() => {
    if (!open) return;
    const close = () => setAt(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [open]);

  if (!email) return null;

  function toggle() {
    if (open) { setAt(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setAt({ position: "fixed", top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  }
  const setOpen = (v: boolean) => { if (!v) setAt(null); };

  const initial = (email[0] ?? "?").toUpperCase();

  function signOut() {
    track("sign_out");
    clearAuth();
    setOpen(false);
    router.push("/");
  }

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef} onClick={toggle}
        aria-label={t("ac.aria")} title={email} aria-expanded={open}
        className={`relative grid h-8 w-8 place-items-center rounded-full text-xs font-bold ring-1 transition ${
          verified ? "bg-blue/10 text-blue-deep ring-blue/25 hover:bg-blue/20" : "bg-amber-100 text-amber-800 ring-amber-300 hover:bg-amber-200"} ${open ? "bg-blue/20" : ""}`}
      >
        {initial}
        {!verified && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <>
          <span className="fixed inset-0 z-[110]" onClick={() => setOpen(false)} />
          <span style={at ?? undefined} className="z-[120] flex w-64 flex-col rounded-2xl border border-white/60 bg-white/95 p-1.5 shadow-glass-sm ring-1 ring-black/5 backdrop-blur-xl">
            <span className="flex items-center gap-3 px-2.5 py-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue/10 text-sm font-bold text-blue-deep ring-1 ring-blue/25">{initial}</span>
              <span className="min-w-0">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("ac.signedInAs")}</span>
                <span className="block truncate text-sm font-semibold text-slate-900" title={email}>{email}</span>
                {verified ? (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                    <ShieldCheck size={12} /> {t("ac.verified")}
                  </span>
                ) : (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <ShieldAlert size={12} /> {days === 0 ? t("ac.expired") : t("ac.unverified").replace("{days}", String(days ?? "?"))}
                  </span>
                )}
              </span>
            </span>
            <span className="my-1 h-px bg-slate-900/8" />
            {!verified && (
              <button
                type="button" onClick={() => { setOpen(false); setVerifyOpen(true); }}
                className="flex items-center gap-2 rounded-xl bg-amber-50 px-2.5 py-2 text-left text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
              >
                <ShieldAlert size={15} /> {t("ac.verifyNow")}
              </button>
            )}
            <button
              type="button" onClick={() => { setOpen(false); setDialog(true); }}
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-900/5 hover:text-slate-900"
            >
              <KeyRound size={15} /> {t("ac.account")}
            </button>
            <button
              type="button" onClick={signOut}
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-900/5 hover:text-slate-900"
            >
              <LogOut size={15} /> {t("ac.signOut")}
            </button>
          </span>
        </>,
        document.body,
      )}
      <AccountDialog open={dialog} onClose={() => setDialog(false)} />
      <VerifyEmailDialog open={verifyOpen} onClose={() => setVerifyOpen(false)} onVerified={() => setVerifyOpen(false)} />
    </span>
  );
}
