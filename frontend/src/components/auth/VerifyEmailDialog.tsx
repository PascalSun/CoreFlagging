"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";
import { ShieldCheck, ArrowRight, X, MailCheck, KeyRound } from "lucide-react";

import { getAuth, graceDaysLeft, requestEmailCode, resendVerifyLink, signInWithPassword, verifyEmailCode, SUPPORT_EMAIL_FALLBACK } from "@/lib/auth";
import { useT } from "@/lib/i18n";

/**
 * Shown when an unverified session reaches something that needs a verified email (the
 * assistant, My data), or when its grace period has run out. Says where the link went,
 * resends it, and offers the password sign-in as the no-email way through. Existing
 * sessions keep their account; only the token changes, gaining the `ver` claim.
 */
export function VerifyEmailDialog({ open, onClose, onVerified, expired = false }: {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
  /** The grace period is over: nothing signed-in works until verified. */
  expired?: boolean;
}) {
  const t = useT();
  const email = getAuth()?.email ?? "";
  const days = graceDaysLeft();
  // "code" first: this dialog is shown to someone whose verification mail has not done its
  // job, which is exactly the case where a link is the thing that never arrived.
  const [mode, setMode] = useState<"code" | "password">("code");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) { setMode("code"); setPassword(""); setCode(""); setSent(false); setError(null); setBusy(false); }
  }

  async function sendCode() {
    if (busy) return;
    setBusy(true); setError(null); setSent(false);
    try { await requestEmailCode(email); setCode(""); setSent(true); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  /** The link, kept one click away for anyone the code does not suit. */
  async function resendLink() {
    if (busy) return;
    setBusy(true); setError(null); setSent(false);
    try { await resendVerifyLink(email); setSent(true); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy || code.trim().length < 6) return;
    setBusy(true); setError(null);
    try { await verifyEmailCode(email, code.trim()); onVerified(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true); setError(null);
    try { await signInWithPassword(email, password); onVerified(); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  const SECONDARY = "flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-white transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40";

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/60 bg-white/90 p-7 shadow-glass ring-1 ring-black/5 backdrop-blur-xl"
          >
            <button onClick={onClose} disabled={busy}
              className="absolute right-3.5 top-3.5 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40">
              <X size={16} />
            </button>

            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-white">
              <ShieldCheck size={19} />
            </span>
            <h2 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
              {expired ? t("ve.expiredTitle") : t("ve.title")}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {mode === "password"
                ? t("eg.pwBody")
                : (expired ? t("ve.expiredBody") : t("ve.linkBody")).replace("{email}", email).replace("{days}", String(days ?? 0))}
            </p>

            {mode === "code" ? (
              <form onSubmit={submitCode} className="mt-5 space-y-3">
                {sent && (
                  <>
                    <p className="flex items-center gap-1.5 text-sm text-emerald-700"><MailCheck size={15} /> {t("eg.codeSent")}</p>
                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                      {t("eg.checkSpam")}
                    </p>
                  </>
                )}
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric" autoComplete="one-time-code" placeholder="000000"
                  aria-label={t("eg.codeAria")}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.4em] text-slate-800 outline-none placeholder:text-slate-300 focus:border-slate-400"
                />
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <button
                  type="submit" disabled={busy || code.length < 6}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
                >
                  {busy ? t("eg.verifying") : t("eg.verify")} <ArrowRight size={16} />
                </button>
                <button
                  type="button" onClick={sendCode} disabled={busy}
                  className={SECONDARY.replace("text-white", "text-slate-700")}
                >
                  <MailCheck size={16} /> {busy ? t("ve.sending") : t("eg.resendCode")}
                </button>
                <button type="button" onClick={resendLink} disabled={busy}
                  className="w-full text-xs text-slate-400 hover:text-slate-600">
                  {t("ve.resendLink")}
                </button>
                <button type="button" disabled={busy} onClick={() => { setMode("password"); setError(null); }}
                  className={SECONDARY.replace("text-white", "text-slate-700")}>
                  <KeyRound size={16} /> {t("eg.noCode")}
                </button>
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  {t("eg.noMailHelp")} <a href={`mailto:${SUPPORT_EMAIL_FALLBACK}`} className="font-semibold underline">{SUPPORT_EMAIL_FALLBACK}</a>
                </p>
              </form>
            ) : (
              <form onSubmit={submitPassword} className="mt-5 space-y-3">
                <input
                  type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("eg.password")} aria-label={t("eg.password")} autoComplete="current-password"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400"
                />
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <button
                  type="submit" disabled={!password || busy}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
                >
                  {busy ? t("ve.verifying") : t("ve.verify")} <ArrowRight size={16} />
                </button>
                <button type="button" disabled={busy} onClick={() => { setMode("code"); setError(null); }}
                  className="w-full text-xs text-slate-400 hover:text-slate-600">
                  {t("eg.useCode")}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
