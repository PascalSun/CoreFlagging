"use client";
// Speak instead of typing: the browser's own speech recognition (Web Speech API: Safari on iPhone/iPad from iOS
// 14.5, Chrome and Edge on Android and desktop; not Firefox). Words stream into the field as they are heard and
// stay there for the user to read and send: nothing is sent by itself. One phrase per tap; a pause ends it.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Locale } from "@/lib/i18n";

/** The UI language as a recognition language (regional defaults; the recogniser accepts the base tag too). */
export const SPEECH_LANG: Record<Locale, string> = {
  en: "en-AU", zh: "zh-CN", fr: "fr-FR", es: "es-ES", pt: "pt-BR", id: "id-ID",
};

/* Minimal typing of the parts used (the DOM lib does not ship SpeechRecognition types everywhere). */
type Alt = { transcript: string };
type Result = { isFinal: boolean; 0: Alt; length: number };
type ResultEvent = { resultIndex: number; results: { length: number; [i: number]: Result } };
type ErrorEvent = { error: string };
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};
/** Whether this browser can take dictation; false on the server and in the first client render (no mismatch). */
export function useDictationSupported(): boolean {
  return useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
}

export type DictationState = "idle" | "listening" | "denied" | "error";

/** Dictation into a text value: `start(current)` keeps what is already typed and appends what is heard. */
export function useDictation(lang: string, onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const rec = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);
  useEffect(() => () => rec.current?.abort(), []);

  const stop = useCallback(() => { rec.current?.stop(); }, []);

  const start = useCallback((current: string) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    r.lang = lang;
    r.continuous = false;          // one phrase: the recogniser ends it at a pause (auto-stop on silence)
    r.interimResults = true;       // words appear while still speaking
    r.maxAlternatives = 1;
    const base = current.trimEnd();
    let failed = false;
    r.onresult = (e) => {
      let heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
      heard = heard.trim();
      onTextRef.current(base && heard ? `${base} ${heard}` : base || heard);
    };
    r.onerror = (e) => {
      failed = true;
      // the user (or the site's settings) refused the microphone, or speech is not available here
      setState(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied"
        : e.error === "aborted" ? "idle" : "error");
    };
    r.onend = () => { rec.current = null; if (!failed) setState("idle"); };
    rec.current = r;
    try {
      r.start();                   // the first start asks for the microphone
      setState("listening");
    } catch {
      rec.current = null;
      setState("error");
    }
  }, [lang]);

  const reset = useCallback(() => setState("idle"), []);
  return { state, start, stop, reset };
}
