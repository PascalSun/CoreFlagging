import { describe, expect, test } from "bun:test";
import { busy, pickLocalModel } from "./localModel";

const Q = (o: object) => ({ available: true, running: 10, parallel: 48, waiting: 0, eta_s: { interactive: 0, batch: 0 }, ...o });
const answer = (by: Record<string, object | number>) =>
  (async (url: string) => {
    const m = new URL(url).searchParams.get("model")!;
    const v = by[m];
    if (v === undefined) throw new Error("down");
    if (typeof v === "number") return new Response("no", { status: v });
    return Response.json(v);
  }) as unknown as typeof fetch;
const queueUrl = (m: string) => `https://gw.test/queue?model=${m}`;
const pick = (by: Record<string, object | number>, extra = {}) =>
  pickLocalModel({ primary: "big", fallback: "small", queueUrl, fetcher: answer(by), ...extra });

describe("local model", () => {
  test("busy", () => {
    expect(busy(Q({}), 20)).toBe(false);
    expect(busy(Q({ eta_s: { interactive: 45 } }), 20)).toBe(true);
    expect(busy(Q({ running: 48 }), 20)).toBe(true);
    expect(busy(Q({ available: false }), 20)).toBe(true);
    expect(busy(null, 20)).toBe(true);
    expect(busy({ available: true }, 20)).toBe(false);
  });

  test("the 5090 free: the main model", async () => {
    expect(await pick({ big: Q({}), small: Q({}) })).toEqual({ model: "big", fellBack: false });
  });

  test("the 5090 deep: the small one", async () => {
    expect(await pick({ big: Q({ eta_s: { interactive: 60 } }), small: Q({}) })).toEqual({ model: "small", fellBack: true });
    expect(await pick({ big: Q({ running: 48 }), small: Q({}) })).toEqual({ model: "small", fellBack: true });
    expect(await pick({ big: Q({ available: false }), small: Q({}) })).toEqual({ model: "small", fellBack: true });
  });

  test("both busy: the main one", async () => {
    expect(await pick({ big: Q({ running: 48 }), small: Q({ running: 16, parallel: 16 }) })).toEqual({ model: "big", fellBack: false });
  });

  test("the fallback's queue unknown: still the fallback", async () => {
    expect(await pick({ big: Q({ running: 48 }), small: 500 })).toEqual({ model: "small", fellBack: true });
  });

  test("the gateway not answering, or nothing to fall back to: the main one", async () => {
    expect(await pick({})).toEqual({ model: "big", fellBack: false });
    expect(await pick({ big: 503 })).toEqual({ model: "big", fellBack: false });
    expect(await pickLocalModel({ primary: "big", queueUrl, fetcher: answer({ big: Q({ running: 48 }) }) })).toEqual({ model: "big", fellBack: false });
    expect(await pickLocalModel({ primary: "big", fallback: "small", queueUrl: () => undefined })).toEqual({ model: "big", fellBack: false });
  });

  test("a slow gateway times out to the main model", async () => {
    const slow = ((_: string, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("timeout"))))) as unknown as typeof fetch;
    expect(await pickLocalModel({ primary: "big", fallback: "small", queueUrl, fetcher: slow, timeoutMs: 20 })).toEqual({ model: "big", fellBack: false });
  });
});
