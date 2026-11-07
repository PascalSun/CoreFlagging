"use client";
// Speak instead of typing. Signed in, the words come from our own Whisper (on the GPU, through the LLM
// gateway): the page streams the microphone to it and the text grows in the field while one speaks, every ~0.6 s,
// with the site's own place names and terms spelt right. Otherwise, or when that is not reachable, the browser's own
// speech recognition (Web Speech API: Safari on iPhone/iPad from iOS 14.5, Chrome, Edge; not Firefox). Either way the
// words stay in the field for the user to read and send: nothing is sent by itself. A pause ends it.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { authToken, refreshAccessToken } from "@/lib/auth";

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

/** "starting": tapped, the microphone not yet sending; "listening": it is (what is said from here is kept). */
export type DictationState = "idle" | "starting" | "listening" | "denied" | "error";

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

/** An audio context at the device's rate (never another: WebKit, iOS above all, then hands the page silence from
 * the microphone), its samples resampled to 16 kHz by Pcm16k. Made inside the tap and resumed there: iOS starts audio
 * only from a gesture. */
export function audioContext(): AudioContext {
  const ctx = new AudioContext();
  void ctx.resume().catch(() => {});
  return ctx;
}

/** How long the microphone has to send sound before it is taken as dead (no frames, or only zeros). */
const WATCH_MS = 1500;
/** Below this RMS (about -100 dBFS) the first second is silence no microphone makes: zeros. */
const DEAD_RMS = 1e-5;

/** Said next to the button: the microphone sent nothing, so the browser's recogniser took over, or nothing could. */
export type DictationNotice = "fallback" | "nosound" | null;

type Live = {
  ws: WebSocket | null; ctx: AudioContext | null; stream: MediaStream | null; node: AudioWorkletNode | null;
  watch?: ReturnType<typeof setTimeout>; stopping?: boolean;
  /** the 16 kHz PCM heard before the socket is open, sent first and in order when it opens; null once it has */
  queue: ArrayBuffer[] | null;
  frames: number;
};

/** At most this much is kept while the socket opens (100 ms frames): 10 s. */
const QUEUE_MAX = 100;

/* A live session (one-use, short-lived) asked for ahead of the tap, so the socket opens sooner: on the button's hover,
 * focus or press. Kept until used or nearly expired; one per page language. */
type Session = { url: string; exp: number };
const sessions = new Map<string, { s?: Session; pending?: Promise<Session | null> }>();

async function fetchSession(lang: string, token: string, retried = false): Promise<Session | null> {
  try {
    const res = await fetch(SESSION_PATH, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ lang }),
    });
    // the saved access token has expired (it lives minutes; the page may be open for hours): refresh it once and ask
    // again, or every tap fell back to the browser's recogniser without saying so
    if (res.status === 401 && !retried) {
      const fresh = await refreshAccessToken();
      return fresh ? fetchSession(lang, fresh, true) : null;
    }
    if (!res.ok) return null;
    const j = (await res.json()) as { url?: string; expires_in?: number };
    if (!j.url) return null;
    return { url: j.url, exp: Date.now() + Math.max(5, (j.expires_in ?? 60) - 15) * 1000 };
  } catch {
    return null;
  }
}

/** Ask for a session now, for a tap that may come (nothing if one is in hand or on its way). */
function prewarmSession(lang: string): void {
  const token = authToken();
  if (!token || !canStream()) return;
  const e = sessions.get(lang) ?? {};
  if ((e.s && e.s.exp > Date.now()) || e.pending) return;
  const pending = fetchSession(lang, token).then((s) => {
    const cur = sessions.get(lang);
    if (cur?.pending === pending) sessions.set(lang, s ? { s } : {});
    return s;
  });
  sessions.set(lang, { pending });
}

/** The session for this tap: the one asked for ahead if it is still good (each opens one stream), else a new one. */
async function takeSession(lang: string, token: string): Promise<Session | null> {
  const e = sessions.get(lang);
  sessions.delete(lang);
  if (e?.s && e.s.exp > Date.now()) return e.s;
  if (e?.pending) {
    const s = await e.pending;
    if (s && s.exp > Date.now()) return s;
  }
  return fetchSession(lang, token);
}

/** Dictation into a text value: `start(current)` keeps what is already typed and appends what is heard. */
export function useDictation(lang: string, onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [notice, setNotice] = useState<DictationNotice>(null);
  useEffect(() => {                                // a note, not a state: it goes by itself
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  const rec = useRef<Recognition | null>(null);
  const live = useRef<Live | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  const release = useCallback(() => {
    const l = live.current;
    live.current = null;
    if (!l) return;
    clearTimeout(l.watch);
    if (l.ctx) l.ctx.onstatechange = null;
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

  /** Our Whisper, streamed: the microphone at once (what is said is kept from its first frame), and meanwhile a
   * session from this site's server and a socket to the gateway; what was heard before the socket opened goes
   * first. */
  const startStream = useCallback(async (current: string, ctx: AudioContext, dead: () => void): Promise<boolean> => {
    const token = authToken();
    if (!token) return false;
    const base = current.trimEnd();
    const l: Live = { ws: null, ctx, stream: null, node: null, queue: [], frames: 0 };
    live.current = l;
    const session = takeSession(lang, token);      // in parallel with the microphone
    try {
      // the voice as it is: a phone's echo cancelling and noise suppression are tuned for calls, and they cut and
      // smear what Whisper hears (it was trained on plain recordings); the gain control keeps a far voice loud enough
      l.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch (e) {
      if (live.current === l) release();
      setState((e as DOMException)?.name === "NotAllowedError" ? "denied" : "error");
      return true;                                  // handled: no fallback (it would ask for the microphone again)
    }
    if (live.current !== l) { l.stream.getTracks().forEach((t) => t.stop()); return true; }  // stopped meanwhile
    const src = ctx.createMediaStreamSource(l.stream);
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: "application/javascript" })));
    if (live.current !== l) return true;
    const node = new AudioWorkletNode(ctx, "pcm-tap");
    const mute = ctx.createGain();
    mute.gain.value = 0;                             // the worklet must reach the output to run; it is not heard
    const pcm = new Pcm16k(ctx.sampleRate, (b) => {
      if (l.queue) { if (l.queue.length < QUEUE_MAX) l.queue.push(b); }
      else if (l.ws?.readyState === WebSocket.OPEN) l.ws.send(b);
    });
    // the first second's level: a microphone that sends only zeros is dead (another app has it, an iOS audio session
    // switch, a rate the browser will not convert), never a quiet room
    let heard = 0, energy = 0;
    const second = ctx.sampleRate;
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (l.frames++ === 0 && live.current === l) setState((s) => (s === "starting" ? "listening" : s));  // it hears now
      const x = e.data;
      for (let i = 0; i < x.length && heard < second; i++, heard++) energy += x[i] * x[i];
      pcm.push(x);
    };
    src.connect(node).connect(mute).connect(ctx.destination);
    l.node = node;
    // getUserMedia switches iOS to play-and-record, which can suspend or interrupt the context made in the tap:
    // resume it now, and again whenever that happens while listening
    ctx.onstatechange = () => {
      if (live.current === l && (ctx.state === "suspended" || (ctx.state as string) === "interrupted")) void ctx.resume().catch(() => {});
    };
    await ctx.resume().catch(() => {});
    l.watch = setTimeout(() => {
      if (live.current !== l || l.stopping) return;
      if (!l.frames || (heard && Math.sqrt(energy / heard) < DEAD_RMS)) dead();
    }, WATCH_MS);

    // the socket, while the microphone is already heard
    const s = await session;
    if (live.current !== l) return true;
    if (!s) {
      if (l.stopping) { release(); setState("idle"); return true; }
      release();
      return false;                                 // not reachable: the browser's recogniser instead
    }
    const ws = new WebSocket(s.url);
    ws.binaryType = "arraybuffer";
    l.ws = ws;
    const opened = await new Promise<boolean>((ok) => {
      const t = setTimeout(() => ok(false), 5000);
      ws.onopen = () => { clearTimeout(t); ok(true); };
      ws.onerror = () => { clearTimeout(t); ok(false); };
      ws.onclose = () => { clearTimeout(t); ok(false); };
    });
    if (live.current !== l) return true;
    if (!opened) {
      if (l.stopping) { release(); setState("idle"); return true; }
      release();
      return false;
    }
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(typeof ev.data === "string" ? ev.data : "") as { type: string; committed?: string; tentative?: string; text?: string };
        if (m.type === "partial") onTextRef.current(joinText(base, [m.committed, m.tentative].filter(Boolean).join(" ").trim()));
        else if (m.type === "final") onTextRef.current(joinText(base, (m.text ?? "").trim()));
        else if (m.type === "error") {
          if ((m as { reason?: string }).reason === "no-audio" && !l.stopping) dead();   // the server heard nothing
          else setState("error");
        }
      } catch { /* not ours */ }
    };
    ws.onclose = () => { release(); setState((st) => (st === "listening" || st === "starting" ? "idle" : st)); };
    ws.onerror = () => { release(); setState((st) => (st === "listening" || st === "starting" ? "error" : st)); };
    const q = l.queue ?? [];
    l.queue = null;                                  // from now on frames go straight to the socket
    for (const b of q) ws.send(b);                   // what was said while the socket opened, first, in order
    if (l.stopping) ws.send(JSON.stringify({ type: "end" }));   // the tap to stop came already: the final follows
    return true;
  }, [lang, release]);

  const stop = useCallback(() => {
    rec.current?.stop();
    const l = live.current;
    if (!l) { setState("idle"); return; }
    l.stopping = true;
    if (l.ws?.readyState === WebSocket.OPEN && !l.queue) {
      l.ws.send(JSON.stringify({ type: "end" }));   // the final text comes, then the gateway closes the socket
      l.node?.disconnect();
      l.stream?.getTracks().forEach((t) => t.stop());
    } else if (l.queue?.length) {
      // heard already, the socket still opening: stop hearing; what was heard goes when it opens, then the final
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
    setNotice(null);
    if (canStream() && authToken()) {
      // the audio context is made now, inside the tap: Safari lets audio start only from a gesture
      let ctx: AudioContext | null = null;
      try { ctx = audioContext(); } catch { ctx = null; }
      if (ctx) {
        setState("starting");                       // "listening" once the microphone sends
        const c = ctx;
        // no sound reaches us: never a mic that listens to nothing; the browser's recogniser if there is one
        const dead = () => {
          release();
          if (recognitionCtor()) { setNotice("fallback"); startBrowser(current); }
          else { setNotice("nosound"); setState("error"); }
        };
        void startStream(current, c, dead).then((handled) => {
          if (!handled) { c.close().catch(() => {}); if (recognitionCtor()) startBrowser(current); else setState("error"); }
        }).catch(() => { release(); if (recognitionCtor()) startBrowser(current); else setState("error"); });
        return;
      }
    }
    startBrowser(current);
  }, [release, startBrowser, startStream]);

  /** A tap may come (hover, focus, press): ask for the session now, so the socket opens sooner. */
  const prewarm = useCallback(() => prewarmSession(lang), [lang]);

  const reset = useCallback(() => { setState("idle"); setNotice(null); }, []);
  return { state, notice, start, stop, reset, prewarm };
}
