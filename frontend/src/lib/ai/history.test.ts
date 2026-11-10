import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { askedWith, canRetry, cleanHistory, describeOpen, noteSelections } from "./history";

const user = (id: string, text: string, context?: unknown): UIMessage =>
  ({ id, role: "user", parts: [{ type: "text", text }], ...(context !== undefined ? { metadata: { context } } : {}) }) as UIMessage;
const answer = (id: string, parts: unknown[]): UIMessage => ({ id, role: "assistant", parts }) as UIMessage;
const ids = (ms: UIMessage[]) => ms.map((m) => m.id);

describe("cleanHistory", () => {
  test("drops past reasoning and tool calls without a result", () => {
    const out = cleanHistory([
      user("u1", "q"),
      answer("a1", [
        { type: "step-start" },
        { type: "reasoning", text: "hm" },
        { type: "tool-fly_to", toolCallId: "t1", state: "input-available", input: {} },
        { type: "tool-score", toolCallId: "t2", state: "output-available", input: {}, output: {} },
        { type: "dynamic-tool", toolName: "x", toolCallId: "t3", state: "output-error", input: {}, errorText: "no" },
        { type: "text", text: "done" },
      ]),
    ]);
    expect(out[1].parts.map((p) => p.type)).toEqual(["step-start", "tool-score", "dynamic-tool", "text"]);
  });

  test("drops an assistant turn that is left with nothing to say", () => {
    const out = cleanHistory([user("u1", "q"), answer("a1", [{ type: "step-start" }, { type: "reasoning", text: "hm" }])]);
    expect(ids(out)).toEqual(["u1"]);
  });

  test("of unanswered questions in a row only the last is kept", () => {
    const out = cleanHistory([
      user("u1", "first"), answer("a1", [{ type: "text", text: "ok" }]),
      user("u2", "same q"), answer("a2", [{ type: "step-start" }]),   // failed: nothing came back
      user("u3", "same q"),                                            // failed before the answer began
      user("u4", "same q"),
    ]);
    expect(ids(out)).toEqual(["u1", "a1", "u4"]);
  });

  test("answered questions all stay", () => {
    const ms = [user("u1", "a"), answer("a1", [{ type: "text", text: "1" }]), user("u2", "b"), answer("a2", [{ type: "text", text: "2" }])];
    expect(ids(cleanHistory(ms))).toEqual(["u1", "a1", "u2", "a2"]);
  });
});

describe("selections", () => {
  test("describeOpen says the hole, the metre and the model", () => {
    expect(describeOpen(undefined)).toBeUndefined();
    expect(describeOpen({ hole: null, m: 3 })).toBeUndefined();
    expect(describeOpen({ hole: "MND036" })).toBe("hole MND036");
    expect(describeOpen({ hole: "MND036", m: 120, model: "v2" })).toBe("hole MND036, at 120–121 m, model v2");
    expect(describeOpen({ hole: "MND036", m: null, model: null })).toBe("hole MND036");
  });

  test("askedWith reads a non-empty string context", () => {
    expect(askedWith(user("u", "q", " Point 1 "))).toBe("Point 1");
    expect(askedWith(user("u", "q", ""))).toBeUndefined();
    expect(askedWith(user("u", "q", { hole: "x" }))).toBeUndefined();
    expect(askedWith(user("u", "q"))).toBeUndefined();
  });

  test("an earlier question asked with another selection says which", () => {
    const ms = [
      user("u1", "what is here?", "Point A"), answer("a1", [{ type: "text", text: "A is…" }]),
      user("u2", "and the geology?", "Point B"), answer("a2", [{ type: "text", text: "B is…" }]),
      user("u3", "and now?", "Point B"),
    ];
    const out = noteSelections(ms, "Point B");
    expect(out[0].parts[0]).toEqual({ type: "text", text: "[Asked while the reader had open: Point A]" });
    expect(out[0].parts[1]).toEqual(ms[0].parts[0]);
    expect(out[2]).toBe(ms[2]);      // same selection as now: left alone
    expect(out[4]).toBe(ms[4]);      // the latest question: the system prompt speaks for it
    expect(out[1]).toBe(ms[1]);
  });

  test("with nothing selected now every earlier selection is noted, clipped", () => {
    const ms = [user("u1", "q", "x".repeat(50)), user("u2", "q2")];
    const out = noteSelections(ms, undefined, 10);
    expect((out[0].parts[0] as { text: string }).text).toBe(`[Asked while the reader had open: ${"x".repeat(10)}]`);
    expect(out[1]).toBe(ms[1]);
  });
});

describe("canRetry", () => {
  test("a question left without an answer, or an answer that broke off", () => {
    expect(canRetry([])).toBe(false);
    expect(canRetry([user("u1", "q")])).toBe(true);
    expect(canRetry([user("u1", "q"), answer("a1", [{ type: "text", text: "half" }])])).toBe(true);
  });
  test("not over a card the map added since", () => {
    expect(canRetry([user("u1", "q"), answer("manual-err-1", [{ type: "text", text: "x" }])])).toBe(false);
    expect(canRetry([user("u1", "q"), { ...answer("m1", [{ type: "text", text: "x" }]), metadata: { evidence: {} } } as UIMessage])).toBe(false);
    expect(canRetry([answer("a0", []), answer("a1", [])])).toBe(false);
    expect(canRetry([{ id: "s", role: "system", parts: [] } as UIMessage])).toBe(false);
  });
});
