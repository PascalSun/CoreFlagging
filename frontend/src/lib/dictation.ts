"use client";
// Speak instead of typing. Signed in, the words come from our own Whisper (large-v3-turbo on the GPU, through the LLM
// gateway): the page streams the microphone to it and the text grows in the field while one speaks, every ~0.6 s,
// with the site's own place names and terms spelt right. Otherwise, or when that is not reachable, the browser's own
// speech recognition (Web Speech API: Safari on iPhone/iPad from iOS 14.5, Chrome, Edge; not Firefox). Either way the
// words stay in the field for the user to read and send: nothing is sent by itself. A pause ends it.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authToken } from "@/lib/auth";

/** The UI language as a recognition language (regional defaults; the recogniser accepts the base tag too). */
export const SPEECH_LANG: Record<string, string> = {
  en: "en-AU", zh: "zh-CN", fr: "fr-FR", es: "es-ES", pt: "pt-BR", id: "id-ID",
};

/** This site's server route that asks the gateway for a live session (it holds the gateway key; the page never does). */
const SESSION_PATH = "/api/stt-session";

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

/** The browser can stream the microphone (our Whisper): an audio worklet, getUserMedia and a socket. */
function canStream(): boolean {
  if (typeof window === "undefined") return false;
  return typeof AudioWorkletNode !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof WebSocket !== "undefined";
}

const noop = () => () => {};
/** Whether this browser can take dictation; false on the server and in the first client render (no mismatch). */
export function useDictationSupported(): boolean {
  return useSyncExternalStore(noop, () => recognitionCtor() !== null || (canStream() && !!authToken()), () => false);
}

export type DictationState = "idle" | "listening" | "denied" | "error";

const joinText = (base: string, heard: string) => (base && heard ? `${base} ${heard}` : base || heard);

// The audio tap: the microphone's samples, as they come, to the page (a worklet: no main-thread glitches).
const TAP = `class Tap extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("pcm-tap",Tap)`;

/** Float samples at the context's rate → 16 kHz PCM16, sent 100 ms at a time. */
class Pcm16k {
  private pending: number[] = [];
  private pos = 0;
  constructor(private rate: number, private send: (b: ArrayBuffer) => void) {}
  push(x: Float32Array) {
    const step = this.rate / 16000;
    // average the samples each output sample stands for (a cheap low-pass before taking every step-th)
    for (; this.pos < x.length; this.pos += step) {
      const a = Math.floor(this.pos), b = Math.min(x.length, Math.floor(this.pos + step));
      let s = 0;
      for (let i = a; i < Math.max(a + 1, b); i++) s += x[i];
      this.pending.push(s / Math.max(1, b - a));
    }
    this.pos -= x.length;
    while (this.pending.length >= 1600) {
      const out = new Int16Array(1600);
      for (let i = 0; i < 1600; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(this.pending[i] * 32767)));
      this.pending.splice(0, 1600);
      this.send(out.buffer);
    }
  }
}

type Live = { ws: WebSocket | null; ctx: AudioContext | null; stream: MediaStream | null; node: AudioWorkletNode | null };

/** Dictation into a text value: `start(current)` keeps what is already typed and appends what is heard. */
export function useDictation(lang: string, onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const rec = useRef<Recognition | null>(null);
  const live = useRef<Live | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  const release = useCallback(() => {
    const l = live.current;
    live.current = null;
    if (!l) return;
    l.node?.disconnect();
    l.stream?.getTracks().forEach((t) => t.stop());
    l.ctx?.close().catch(() => {});
    if (l.ws && l.ws.readyState <= WebSocket.OPEN) l.ws.close();
  }, []);
  useEffect(() => () => { rec.current?.abort(); release(); }, [release]);

  /** The browser's own recogniser (the fallback). */
  const startBrowser = useCallback((current: string) => {
    const Ctor = recognitionCtor();
    if (!Ctor) { setState("error"); return; }
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
      onTextRef.current(joinText(base, heard.trim()));
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

  /** Our Whisper, streamed: a session from this site's server, the microphone, a socket to the gateway. */
  const startStream = useCallback(async (current: string, ctx: AudioContext): Promise<boolean> => {
    const token = authToken();
    if (!token) return false;
    const base = current.trimEnd();
    const l: Live = { ws: null, ctx, stream: null, node: null };
    live.current = l;
    let session: { url?: string };
    try {
      const res = await fetch(SESSION_PATH, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lang }),
      });
      if (!res.ok) throw new Error(String(res.status));
      session = await res.json();
      if (!session.url) throw new Error("no url");
    } catch {
      return false;                                 // not reachable: the browser's recogniser instead
    }
    try {
      l.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      release();
      setState((e as DOMException)?.name === "NotAllowedError" ? "denied" : "error");
      return true;                                  // handled: no fallback (it would ask for the microphone again)
    }
    if (live.current !== l) { l.stream.getTracks().forEach((t) => t.stop()); return true; }  // stopped meanwhile
    const ws = new WebSocket(session.url);
    ws.binaryType = "arraybuffer";
    l.ws = ws;
    const opened = await new Promise<boolean>((ok) => {
      const t = setTimeout(() => ok(false), 5000);
      ws.onopen = () => { clearTimeout(t); ok(true); };
      ws.onerror = () => { clearTimeout(t); ok(false); };
      ws.onclose = () => { clearTimeout(t); ok(false); };
    });
    if (!opened) { release(); return false; }
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(typeof ev.data === "string" ? ev.data : "") as { type: string; committed?: string; tentative?: string; text?: string };
        if (m.type === "partial") onTextRef.current(joinText(base, [m.committed, m.tentative].filter(Boolean).join(" ").trim()));
        else if (m.type === "final") onTextRef.current(joinText(base, (m.text ?? "").trim()));
        else if (m.type === "error") setState("error");
      } catch { /* not ours */ }
    };
    ws.onclose = () => { release(); setState((s) => (s === "listening" ? "idle" : s)); };
    ws.onerror = () => { release(); setState((s) => (s === "listening" ? "error" : s)); };
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: "application/javascript" })));
    const src = ctx.createMediaStreamSource(l.stream);
    const node = new AudioWorkletNode(ctx, "pcm-tap");
    const mute = ctx.createGain();
    mute.gain.value = 0;                             // the worklet must reach the output to run; it is not heard
    const pcm = new Pcm16k(ctx.sampleRate, (b) => { if (ws.readyState === WebSocket.OPEN) ws.send(b); });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => pcm.push(e.data);
    src.connect(node).connect(mute).connect(ctx.destination);
    l.node = node;
    return true;
  }, [lang, release]);

  const stop = useCallback(() => {
    rec.current?.stop();
    const l = live.current;
    if (l?.ws?.readyState === WebSocket.OPEN) {
      l.ws.send(JSON.stringify({ type: "end" }));   // the final text comes, then the gateway closes the socket
      l.node?.disconnect();
      l.stream?.getTracks().forEach((t) => t.stop());
    } else {
      release();
      setState("idle");
    }
  }, [release]);

  const start = useCallback((current: string) => {
    rec.current?.abort();
    release();
    if (canStream() && authToken()) {
      // the audio context is made now, inside the tap: Safari lets audio start only from a gesture
      let ctx: AudioContext | null = null;
      try { ctx = new AudioContext(); void ctx.resume(); } catch { ctx = null; }
      if (ctx) {
        setState("listening");
        const c = ctx;
        void startStream(current, c).then((handled) => {
          if (!handled) { c.close().catch(() => {}); if (recognitionCtor()) startBrowser(current); else setState("error"); }
        }).catch(() => { release(); if (recognitionCtor()) startBrowser(current); else setState("error"); });
        return;
      }
    }
    startBrowser(current);
  }, [release, startBrowser, startStream]);

  const reset = useCallback(() => setState("idle"), []);
  return { state, start, stop, reset };
}
