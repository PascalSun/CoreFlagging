"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { KeyRound, LogOut, ShieldAlert, ShieldCheck, X } from "lucide-react";

import { changePassword, fetchMe, type Me } from "@/lib/auth";
import { useT } from "@/lib/i18n";

/**
 * The account card, shown over the map (same glass as EmailGate / VerifyEmailDialog so
 * it reads as part of the workspace, not a separate site): the signed-in address and
 * when it was verified, the password for the MCP / OAuth login page, and sign-out.
 * `notice` is a one-line banner for the reset flow ("email confirmed, now set a password").
 */
export function AccountDialog({ open, onClose, onSignOut, notice }: {
  open: boolean;
  onClose: () => void;
  /** Shown only where there is no avatar menu beside the dialog (standalone pages). */
  onSignOut?: () => void;
  notice?: string | null;
}) {
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  // Days left in the grace period, computed when the profile arrives (not during render).
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void fetchMe().then((m) => {
      if (!live) return;
      setMe(m);
      setDaysLeft(m?.verificationDueAt
        ? Math.max(0, Math.ceil((new Date(m.verificationDueAt).getTime() - Date.now()) / 86_400_000))
        : null);
    });
    return () => { live = false; };
  }, [open]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/60 bg-white/90 p-7 shadow-glass ring-1 ring-black/5 backdrop-blur-xl"
          >
            <button onClick={onClose} aria-label="Close"
              className="absolute right-3.5 top-3.5 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X size={16} />
            </button>

            {/* who */}
            <div className="flex items-center gap-3.5">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-blue/10 text-lg font-bold text-blue-deep ring-1 ring-blue/25">
                {me?.email[0]?.toUpperCase() ?? "…"}
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("ac.signedInAs")}</div>
                <div className="truncate text-base font-semibold text-slate-900" title={me?.email}>{me?.email ?? "…"}</div>
                {me && (me.verified ? (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                    <ShieldCheck size={12} /> {t("acp.verifiedOn")}{me.emailVerifiedAt ? ` · ${new Date(me.emailVerifiedAt).toLocaleDateString()}` : ""}
                  </div>
                ) : (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <ShieldAlert size={12} /> {me.graceActive && daysLeft !== null
                      ? t("ac.unverified").replace("{days}", String(daysLeft))
                      : t("ac.expired")}
                  </div>
                ))}
              </div>
            </div>

            {notice && <p className="mt-4 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

            {/* password */}
            <div className="mt-6 border-t border-slate-900/8 pt-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><KeyRound size={15} /> {t("acp.pwTitle")}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{t("acp.pwBody")}</p>
              {me && !me.verified
                ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{t("acp.pwNeedsVerified")}</p>
                : <PasswordForm />}
            </div>

            {onSignOut && (
              <button
                onClick={onSignOut}
                className="mt-6 flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-700"
              >
                <LogOut size={14} /> {t("ac.signOut")}
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PasswordForm() {
  const t = useT();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canSave = pw.length >= 8 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    if (pw !== pw2) { setError(t("acp.pwMismatch")); return; }
    setBusy(true); setError(null); setSaved(false);
    try {
      await changePassword(pw);
      setSaved(true); setPw(""); setPw2("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400";
  return (
    <form onSubmit={submit} className="mt-4 space-y-2.5">
      <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
        placeholder={t("acp.pwNew")} aria-label={t("acp.pwNew")} className={input} />
      <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}
        placeholder={t("acp.pwConfirm")} aria-label={t("acp.pwConfirm")} className={input} />
      <p className="text-[11px] text-slate-400">{t("acp.pwHint")}</p>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {saved && <p className="text-sm text-emerald-700">{t("acp.pwSaved")}</p>}
      <button
        type="submit" disabled={!canSave}
        className="flex w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
      >
        {busy ? t("acp.pwSaving") : t("acp.pwSave")}
      </button>
    </form>
  );
}
