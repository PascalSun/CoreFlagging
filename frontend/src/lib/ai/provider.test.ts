import { afterEach, describe, expect, test } from "bun:test";
import { chatChoices, chatChoicesNow, chatModel, chatModelId, chatTag, localModelNow } from "./provider";

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; });
const gateway = () => {
  process.env.OLLAMA_BASE_URL = "https://gateway.ai4wa.com/v1";
  process.env.OLLAMA_API_KEY = "k";
  delete process.env.OLLAMA_CODE_MODEL;
};

describe("the coding model", () => {
  test("is offered beside cloud and local when the gateway is set, with its own queue", () => {
    gateway();
    const { options } = chatChoices();
    expect(options.map((o) => o.id)).toEqual(["cloud", "local", "code"]);
    const code = options.find((o) => o.id === "code")!;
    expect(code.model).toBe("Qwen3 Coder 30B");
    expect(code.queue).toBe("https://gateway.ai4wa.com/queue?model=qwen3-coder-30b");
    expect(code.fallback).toBeUndefined();                     // no smaller coder to fall back to
  });

  test("answers a chat that picked it, and the answer says so", async () => {
    gateway();
    const local = await localModelNow("code");
    expect(local).toBe("qwen3-coder-30b");
    expect(chatModelId("code", local)).toBe("ollama/qwen3-coder-30b");
    expect(chatTag("code", local)).toEqual({ llm: "code", model: "Qwen3 Coder 30B" });
  });

  test("is not offered without the gateway, or when OLLAMA_CODE_MODEL is empty; a pick of it then goes to the default", async () => {
    delete process.env.OLLAMA_BASE_URL; delete process.env.OLLAMA_API_KEY;
    expect(chatChoices().options.map((o) => o.id)).toEqual(["cloud"]);
    gateway(); process.env.OLLAMA_CODE_MODEL = "";
    expect(chatChoices().options.map((o) => o.id)).toEqual(["cloud", "local"]);
    expect(await localModelNow("code")).toBeUndefined();
    expect(chatTag("code").llm).toBe("cloud");
  });

  test("the model a chat is sent to: the coder for Code, the local model for Local, the cloud one for Cloud", async () => {
    gateway(); process.env.OLLAMA_MODEL = "qwen3-6-35b-a3b-32k"; process.env.OLLAMA_FALLBACK_MODEL = "";   // no fallback: no queue read
    const id = (m: unknown) => (m as { modelId: string }).modelId;
    expect(id(chatModel("code", await localModelNow("code")))).toBe("qwen3-coder-30b");
    expect(id(chatModel("code"))).toBe("qwen3-coder-30b");
    expect(await localModelNow("local")).toBe("qwen3-6-35b-a3b-32k");
    expect(id(chatModel("local"))).toBe("qwen3-6-35b-a3b-32k");
    process.env.CHAT_MODEL = "google/gemini-2.5-flash";
    expect(id(chatModel("cloud"))).toBe("google/gemini-2.5-flash");
  });
});

describe("what the chat bar offers now", () => {
  // the gateway's /queue: `up` lists the models a backend serves; anything else answers "available": false
  const gw = (up: string[], fail = false) => (async (url: string) => {
    if (fail) throw new Error("gateway down");
    const m = new URL(url).searchParams.get("model")!;
    return Response.json({ model: m, available: up.includes(m) });
  }) as unknown as typeof fetch;
  const ids = (c: { options: { id: string }[] }) => c.options.map((o) => o.id);

  test("the coding model is left out while nothing serves it", async () => {
    gateway(); process.env.OLLAMA_MODEL = "big"; process.env.OLLAMA_FALLBACK_MODEL = "small";
    expect(ids(await chatChoicesNow(gw(["big", "small", "qwen3-coder-30b"])))).toEqual(["cloud", "local", "code"]);
    expect(ids(await chatChoicesNow(gw(["big", "small"])))).toEqual(["cloud", "local"]);
  });

  test("local stays while its fallback serves; goes, and the default with it, when neither does", async () => {
    gateway(); process.env.OLLAMA_MODEL = "big"; process.env.OLLAMA_FALLBACK_MODEL = "small"; process.env.CHAT_PROVIDER = "ollama";
    expect(await chatChoicesNow(gw(["small"]))).toMatchObject({ default: "local" });
    const none = await chatChoicesNow(gw([]));
    expect(ids(none)).toEqual(["cloud"]);
    expect(none.default).toBe("cloud");
    process.env.OLLAMA_FALLBACK_MODEL = "";
    expect(ids(await chatChoicesNow(gw(["qwen3-coder-30b"])))).toEqual(["cloud", "code"]);
  });

  test("a gateway that does not answer hides nothing; without the gateway nothing is asked", async () => {
    gateway();
    expect(ids(await chatChoicesNow(gw([], true)))).toEqual(["cloud", "local", "code"]);
    delete process.env.OLLAMA_BASE_URL; delete process.env.OLLAMA_API_KEY;
    expect(ids(await chatChoicesNow(gw([], true)))).toEqual(["cloud"]);
  });
});
