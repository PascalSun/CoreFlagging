import { afterEach, describe, expect, test } from "bun:test";
import { chatChoices, chatModelId, chatTag, localModelNow } from "./provider";

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
});
