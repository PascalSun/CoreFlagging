"use client";
// The microphone in a text field: tap to speak, tap again (or pause) to stop. Hidden where the browser cannot take
// dictation, so it is never a dead button. A refused microphone says so briefly next to the button.
import { useEffect } from "react";
import { Mic, Square } from "lucide-react";
import { SPEECH_LANG, useDictation, useDictationSupported } from "@/lib/dictation";
import { useLocale, type Locale } from "@/lib/i18n";

/** The mic's own words, so it needs no dictionary keys (same wording as the geo hub's). */
export const VOICE_TEXT: Record<Locale, { start: string; stop: string; listening: string; denied: string; error: string; fallback: string; nosound: string }> = {
  en: { start: "Speak instead of typing", stop: "Stop listening", listening: "Listening…",
        denied: "Microphone blocked: allow it in the browser's settings for this site to speak.", error: "Didn't catch that. Try again.",
        fallback: "No sound from the microphone: using the browser's speech recognition instead.", nosound: "No sound from the microphone. Check it isn't muted or in use by another app." },
  zh: { start: "语音输入", stop: "停止语音输入", listening: "正在听…",
        denied: "麦克风被阻止：请在浏览器的网站设置中允许麦克风。", error: "没听清，请再试一次。",
        fallback: "麦克风没有声音：已改用浏览器的语音识别。", nosound: "麦克风没有声音，请检查是否静音或被其他应用占用。" },
  fr: { start: "Dicter au lieu de taper", stop: "Arrêter l'écoute", listening: "Écoute…",
        denied: "Micro bloqué : autorisez-le dans les réglages du navigateur pour ce site.", error: "Rien entendu. Réessayez.",
        fallback: "Aucun son du micro : la reconnaissance vocale du navigateur prend le relais.", nosound: "Aucun son du micro. Vérifiez qu'il n'est pas coupé ni utilisé par une autre app." },
  es: { start: "Dictar en lugar de escribir", stop: "Dejar de escuchar", listening: "Escuchando…",
        denied: "Micrófono bloqueado: permítalo en la configuración del navegador para este sitio.", error: "No se oyó nada. Inténtelo de nuevo.",
        fallback: "El micrófono no envía sonido: se usa el reconocimiento de voz del navegador.", nosound: "El micrófono no envía sonido. Compruebe que no esté silenciado ni en uso por otra app." },
  pt: { start: "Ditar em vez de escrever", stop: "Parar de ouvir", listening: "A ouvir…",
        denied: "Microfone bloqueado: permita-o nas definições do navegador para este site.", error: "Não se ouviu nada. Tente de novo.",
        fallback: "O microfone não envia som: a usar o reconhecimento de voz do navegador.", nosound: "O microfone não envia som. Verifique se não está silenciado nem em uso por outra app." },
  id: { start: "Bicara alih-alih mengetik", stop: "Berhenti mendengarkan", listening: "Mendengarkan…",
        denied: "Mikrofon diblokir: izinkan di pengaturan browser untuk situs ini.", error: "Tidak terdengar. Coba lagi.",
        fallback: "Mikrofon tidak mengirim suara: memakai pengenalan suara browser.", nosound: "Mikrofon tidak mengirim suara. Periksa apakah dibisukan atau dipakai aplikasi lain." },
};

export function MicButton({ value, onChange, onStart, onListening, size = 28, tip = "above", className = "" }: {
  value: string;
  onChange: (text: string) => void;
  /** before listening starts (e.g. expand the composer, focus nothing so the keyboard stays down) */
  onStart?: () => void;
  /** the field can show "Listening…" while this is true */
  onListening?: (on: boolean) => void;
  size?: number;
  /** where the "microphone blocked" note opens: above (a field at the bottom) or below (one at the top) */
  tip?: "above" | "below";
  className?: string;
}) {
  const supported = useDictationSupported();
  const { locale } = useLocale();
  const tx = VOICE_TEXT[locale] ?? VOICE_TEXT.en;
  const { state, notice, start, stop, reset } = useDictation(SPEECH_LANG[locale] ?? "en-AU", onChange);
  const listening = state === "listening";

  useEffect(() => { onListening?.(listening); }, [listening, onListening]);
  useEffect(() => {
    if (state !== "denied" && state !== "error") return;
    const id = setTimeout(reset, 5000);
    return () => clearTimeout(id);
  }, [state, reset]);

  if (!supported) return null;
  const label = listening ? tx.stop : tx.start;
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={listening}
        onClick={() => { if (listening) stop(); else { onStart?.(); start(value); } }}
        style={{ width: size, height: size }}
        // a 44px tap area around a smaller mark, like the field's other buttons
        className={`relative grid place-items-center rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
          listening ? "bg-rose-600 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"} ${className}`}
      >
        {listening ? (
          <>
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-rose-500/40 motion-reduce:animate-none" />
            <Square size={Math.round(size * 0.38)} className="relative fill-current" />
          </>
        ) : <Mic size={Math.round(size * 0.58)} />}
      </button>
      {(state === "denied" || state === "error" || notice) && (
        <span role="status"
          className={`absolute z-50 w-max max-w-[min(16rem,calc(100vw-2rem))] ${tip === "below" ? "left-1/2 top-full mt-2 -translate-x-1/2" : "bottom-full right-0 mb-2"} rounded-xl bg-slate-900 px-3 py-2 text-xs leading-snug text-white shadow-lg`}>
          {notice === "fallback" ? tx.fallback : notice === "nosound" ? tx.nosound : state === "denied" ? tx.denied : tx.error}
        </span>
      )}
    </span>
  );
}
