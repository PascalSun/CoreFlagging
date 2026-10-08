"use client";

/**
 * Tell us something, from wherever you are in the product.
 *
 * It sits in the top-right chrome beside the language and account controls rather than
 * in the map's tool rail: this is a platform affordance, not a map tool, and the rail is
 * for things that act on what is under the cursor.
 *
 * Three kinds, chosen by a tap, because "is this a bug or a suggestion" is the first
 * question the reader will have and the writer is the only one who can answer it cheaply.
 * The page and the browser ride along without being asked for — almost every report that
 * opens "it doesn't work" is answerable only with those two, and the person writing it
 * does not know that yet.
 *
 * The form is the main path, not the only one: the address is offered underneath as
 * well. A mailto: alone would have been the wrong primary — it publishes an address for
 * scrapers, does nothing for anyone whose browser has no mail handler, and opens a blank
 * message that arrives without the page or the browser. As a second option next to a form
 * that collects both, it costs nothing and covers the person who would simply rather
 * write an email.
 *
 * It renders only for a signed-in visitor. The endpoint needs a session, and a control
 * that exists only to say "sign in first" is worse than no control — it spends the one
 * moment someone wanted to talk to us on a refusal. (The visitor who cannot sign in at
 * all therefore still has no way to reach us; that wants an anonymous path, which wants
 * its own abuse story, and is not this change.)
 *
 * Two tones, one dialog. The trigger borrows the colours of whichever chrome it sits in
 * — slate in the map's glass pill, ink in the landing navbar — while the dialog itself
 * is the same glass card as Share and Verify. The button belongs to its neighbours; the
 * dialog belongs to the product.
 *
 * The dialog is portalled to the body rather than rendered where the button sits. The
 * button lives inside the top-right chrome, which is an animated motion.div — and a
 * transformed ancestor becomes the containing block for `position: fixed`, so an overlay
 * rendered in place is trapped inside that pill instead of covering the viewport.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Bug, Check, Lightbulb, Loader2, MessageSquare, MessageSquarePlus, X } from "lucide-react";

import { isAuthed, sendFeedback, SUPPORT_EMAIL_FALLBACK } from "@/lib/auth";
import { useFeature } from "@/lib/features";
import { useT } from "@/lib/i18n";

type Kind = "problem" | "idea" | "other";

const KINDS: { key: Kind; icon: typeof Bug; label: "fb.problem" | "fb.idea" | "fb.other" }[] = [
  { key: "problem", icon: Bug, label: "fb.problem" },
  { key: "idea", icon: Lightbulb, label: "fb.idea" },
  { key: "other", icon: MessageSquare, label: "fb.other" },
];

export function FeedbackButton({ tone = "glass" }: { tone?: "glass" | "paper" }) {
  const t = useT();
  // useSyncExternalStore, not an effect: isAuthed() reads localStorage, which the server
  // does not have, so the two render passes have to be told apart explicitly. The server
  // snapshot is `false`, the client snapshot is the real answer, and React reconciles the
  // two without the hydration flicker that reading during render would cause. There is no
  // subscription because a session does not change without a navigation.
  const signedIn = useSyncExternalStore(() => () => {}, () => isAuthed(), () => false);
  // The platform's own off switch. Defaults to on, so a slow or failed probe leaves the
  // button where it is rather than making it disappear for everyone.
  const featureOn = useFeature("feedback");
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("problem");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    // The dialog exists to be typed into; put the cursor where the work is.
    const id = setTimeout(() => field.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sending) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(id); window.removeEventListener("keydown", onKey); };
  }, [open, sending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending || !message.trim()) return;
    setSending(true); setError(null);
    try {
      await sendFeedback(kind, message.trim());
      setSent(true);
      setMessage("");
      // Long enough to read the confirmation, short enough not to sit in the way.
      setTimeout(() => setOpen(false), 1800);
    } catch (err) {
      setError((err as Error).message);
    } finally { setSending(false); }
  }

  if (!signedIn || !featureOn) return null;

  return (
    <>
      <button
        type="button"
        // Cleared here rather than in an effect on `open`: the reset belongs to the act
        // of opening, and doing it in the effect renders the stale result for one frame.
        onClick={() => { setSent(false); setError(null); setOpen(true); }}
        aria-label={t("fb.title")}
        title={t("fb.title")}
        className={tone === "paper"
          ? "grid size-7 place-items-center rounded-lg text-ink/70 transition hover:bg-ink/5 hover:text-ink"
          : "grid size-7 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-900/5 hover:text-slate-800"}
      >
        <MessageSquarePlus size={17} strokeWidth={1.75} />
      </button>

      {/* No mounted-state dance: the dialog only ever renders with `open` true, which
          only a click can produce, so the server and the first client render agree. */}
      {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[70] grid place-items-center p-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              onClick={sending ? undefined : () => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }} transition={{ type: "spring", stiffness: 280, damping: 28 }}
              className="relative w-full max-w-md rounded-3xl border border-white/60 bg-white/95 p-6 shadow-glass ring-1 ring-black/5 backdrop-blur-xl">
              <button onClick={() => setOpen(false)} disabled={sending}
                className="absolute right-3.5 top-3.5 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40">
                <X size={16} />
              </button>

              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-900 text-white">
                <MessageSquarePlus size={18} />
              </span>
              <h2 className="mt-3.5 text-lg font-bold tracking-tight text-slate-900">{t("fb.title")}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{t("fb.body")}</p>

              <form onSubmit={submit} className="mt-5 space-y-3">
                <div className="flex gap-2">
                  {KINDS.map(({ key, icon: Icon, label }) => (
                    <button key={key} type="button" onClick={() => setKind(key)}
                      aria-pressed={kind === key}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                        kind === key
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      <Icon size={14} /> {t(label)}
                    </button>
                  ))}
                </div>

                <textarea ref={field} value={message} onChange={(e) => setMessage(e.target.value)}
                  rows={5} maxLength={4000} placeholder={t("fb.placeholder")}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400" />

                {/* Said, not hidden: the page travels with the report, and someone should
                    be able to decide not to send it rather than discover it later. */}
                <p className="text-xs leading-relaxed text-slate-400">{t("fb.note")}</p>

                <p className="text-xs leading-relaxed text-slate-400">
                  {t("fb.orEmail")}{" "}
                  <a href={`mailto:${SUPPORT_EMAIL_FALLBACK}`}
                    className="font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900">
                    {SUPPORT_EMAIL_FALLBACK}
                  </a>
                </p>

                {sent && (
                  <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                    <Check size={15} /> {t("fb.sent")}
                  </p>
                )}
                {error && (
                  <p className="text-sm text-rose-600">
                    {error === "rate_limited" ? t("fb.tooMany")
                      : error === "signed_out" ? t("fb.signedOut")
                      : t("fb.failed")}
                  </p>
                )}

                <button type="submit" disabled={sending || !message.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">
                  {sending ? <Loader2 size={15} className="animate-spin" /> : <MessageSquarePlus size={15} />}
                  {sending ? t("fb.sending") : t("fb.send")}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body)}
    </>
  );
}
