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

/** Float samples → 16 kHz PCM16, sent 100 ms at a time. At 16 kHz already (the context was made at 16 kHz: the
 * browser resampled, properly) they are only converted; otherwise they are resampled here with a windowed sinc
 * (a real low-pass: a plain average lets the 8–24 kHz band fold back into speech), the input carried over from one
 * buffer to the next so a window that spans two buffers is whole. */
export class Pcm16k {
  private out: number[] = [];
  private buf: number[] = [];                     // input not yet wholly used
  private t = 0;                                  // the next output sample's place in buf, in input samples
  private readonly step: number;
  private readonly half: number;                  // the filter's half-width, in input samples
  private readonly fc: number;                    // its cutoff, in cycles per input sample
  constructor(private rate: number, private send: (b: ArrayBuffer) => void) {
    this.step = rate / 16000;
    this.fc = 0.45 / Math.max(1, this.step);      // 7.2 kHz at any input rate: under 16 kHz's Nyquist
    this.half = Math.ceil(8 * Math.max(1, this.step));
  }
  private tap(d: number): number {                // sinc × Blackman, at distance d input samples
    if (Math.abs(d) >= this.half) return 0;
    const w = 0.42 + 0.5 * Math.cos(Math.PI * d / this.half) + 0.08 * Math.cos(2 * Math.PI * d / this.half);
    const x = 2 * Math.PI * this.fc * d;
    return 2 * this.fc * (d === 0 ? 1 : Math.sin(x) / x) * w;
  }
  push(x: Float32Array) {
    if (this.rate === 16000) {
      for (let i = 0; i < x.length; i++) this.out.push(x[i]);
    } else {
      for (let i = 0; i < x.length; i++) this.buf.push(x[i]);
      if (!this.t) this.t = this.half;            // the first output once a whole window is there
      while (this.t + this.half < this.buf.length) {
        const c = Math.floor(this.t);
        let s = 0, g = 0;
        for (let k = c - this.half + 1; k <= c + this.half; k++) { const h = this.tap(this.t - k); s += this.buf[k] * h; g += h; }
        this.out.push(g ? s / g : 0);
        this.t += this.step;
      }
      const drop = Math.max(0, Math.floor(this.t) - this.half);   // keep what the next window still needs
      if (drop) { this.buf.splice(0, drop); this.t -= drop; }
    }
    while (this.out.length >= 1600) {
      const o = new Int16Array(1600);
      for (let i = 0; i < 1600; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(this.out[i] * 32767)));
      this.out.splice(0, 1600);
      this.send(o.buffer);
    }
  }
}

/** An audio context at 16 kHz, so the browser resamples the microphone (well, and off the main thread); one at the
 * device's rate if this browser cannot make that. Made inside the tap and resumed there: iOS starts audio only from
 * a gesture. */
export function audioContext16k(): AudioContext {
  let ctx: AudioContext;
  try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
  void ctx.resume();
  return ctx;
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
  const startStream = useCallback(async (current: string, first: AudioContext): Promise<boolean> => {
    const token = authToken();
    if (!token) return false;
    const base = current.trimEnd();
    let ctx = first;
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
      // the voice as it is: a phone's echo cancelling and noise suppression are tuned for calls, and they cut and
      // smear what Whisper hears (it was trained on plain recordings); the gain control keeps a far voice loud enough
      l.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
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
    let src: MediaStreamAudioSourceNode;
    try {
      src = ctx.createMediaStreamSource(l.stream);
    } catch {
      // Firefox will not join a microphone to a context at another rate: one at the device's rate, resampled here
      void ctx.close().catch(() => {});
      ctx = new AudioContext();
      void ctx.resume();
      l.ctx = ctx;
      src = ctx.createMediaStreamSource(l.stream);
    }
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: "application/javascript" })));
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
      try { ctx = audioContext16k(); } catch { ctx = null; }
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
