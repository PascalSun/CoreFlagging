// Checks on the structured data the site serves: every schema.org Dataset node must carry what Google asks of one,
// name and description (required) and creator and license (recommended). Used by seo.test.ts and
// scripts/check-dataset-ld.ts, which runs it over the built site's pages.

/** Every node typed Dataset in a JSON-LD value, however deeply nested. */
export function datasetNodes(v: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(v)) v.forEach((x) => datasetNodes(x, out));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const t = o["@type"];
    if (t === "Dataset" || (Array.isArray(t) && t.includes("Dataset"))) out.push(o);
    Object.values(o).forEach((x) => datasetNodes(x, out));
  }
  return out;
}

/** What a Dataset node lacks: name, description (50 to 5,000 characters, as Google reads it), creator, license. */
export function missingFields(node: Record<string, unknown>): string[] {
  const empty = (x: unknown) => x == null || (typeof x === "string" && x.trim() === "") || (Array.isArray(x) && x.length === 0);
  const miss = ["name", "description", "creator", "license"].filter((k) => empty(node[k]));
  const n = typeof node.description === "string" ? node.description.length : 0;
  if (!miss.includes("description") && (n < 50 || n > 5000)) miss.push(`description (${n} characters, not 50 to 5,000)`);
  return miss;
}

/** The JSON-LD blocks in a page's HTML. */
export const ldBlocks = (html: string): unknown[] =>
  [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
