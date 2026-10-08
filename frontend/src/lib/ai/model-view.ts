// What the MODEL sees of a tool result, as opposed to what the pane sees.
//
// Every data tool attaches a `citation` carrying the evidence the companion pane renders:
// the full result set, a report's passages, a 2,000-feature GeoJSON. That payload is for
// the browser. It was also going to the model — and worse, going again on every subsequent
// turn, because the conversation history is replayed in full on each request. One map_query
// of 58 WAMEX footprints was enough to wedge a session: the turn itself succeeded, and
// every message after it died with "Something went wrong".
//
// `toModelOutput` is the seam: the AI SDK calls it inside convertToModelMessages, so it
// applies to history as well as to fresh results — sessions already carrying a heavy
// payload recover the moment this ships, without the user having to start over.

import type { Tool } from "ai";

/** Beyond this a tool result is not informing the model, it is crowding it out. */
const MAX_CHARS = 12_000;
const MAX_ITEMS = 25;
const MAX_STRING = 1_500;

function shrink(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") {
    return v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…(+${v.length - MAX_STRING} chars)` : v;
  }
  if (typeof v !== "object") return v;
  if (depth > 6) return "…";
  if (Array.isArray(v)) {
    const head = v.slice(0, MAX_ITEMS).map((x) => shrink(x, depth + 1));
    return v.length > MAX_ITEMS ? [...head, `…(+${v.length - MAX_ITEMS} more)`] : head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    // the pane's copy of the evidence, by definition not for the model
    if (k === "citation" || k === "featureCollection" || k === "geom" || k === "tsv") continue;
    out[k] = shrink(val, depth + 1);
  }
  return out;
}

/**
 * A `toModelOutput` for tools whose result carries a UI payload. Keeps the shape the model
 * reasons about (counts, columns, the head of the rows) and drops the bulk.
 */
export function modelView(): NonNullable<Tool["toModelOutput"]> {
  return ({ output }) => {
    let text: string;
    try {
      text = JSON.stringify(shrink(output)) ?? "null";
    } catch {
      text = String(output);
    }
    // last-resort ceiling: a single result should never be able to fill the context
    if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}…"(truncated)"}`;
    return { type: "text", value: text };
  };
}
