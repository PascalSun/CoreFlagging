import { describe, expect, test } from "bun:test";
import { SITE_URL } from "@/lib/seo";
import { ENABLED_STATES, SITEMAP_CHUNK, stateEnabled } from "./config";
import { relatedHubs } from "./hubs";
import { breadcrumbLd, ldJson } from "./jsonld";
import { byName, type IndexRow, MIN_HUB_HOLES, regionPath } from "./rules";
import { chunkCount, holeEntries, holeOrder, hubEntries } from "./sitemap";

const row = (i: number, o: Partial<IndexRow> = {}): IndexRow => ({
  key: `K${i}`, slug: `h${i}`, name: `Hole ${i}`, state: "WA", lon: 121, lat: -31, offshore: false,
  operator: "", project: "", region: "Yilgarn Craton", depth_min: 0, depth_max: 100, drilled: 2011,
  has_lith: true, au_m: 0, n_again: 0, target: "gold", target_source: "survey", commodities: ["gold"], split: "test",
  read_m: 90, n_flag: 0, wamex: false, updated: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`, source: "nvcl", ...o,
});
const many = (n: number, o: Partial<IndexRow> = {}) => Array.from({ length: n }, (_, i) => row(i, o));

describe("config", () => {
  test("only WA is published by default, and the check ignores case", () => {
    expect(ENABLED_STATES).toEqual(["WA"]);
    expect(stateEnabled("wa")).toBe(true);
    expect(stateEnabled("SA")).toBe(false);
  });
});

describe("sitemap", () => {
  test("hub entries cover the State, its regions and commodities, dated by their newest hole", () => {
    const rows = many(MIN_HUB_HOLES);
    const urls = hubEntries(rows).map((e) => e.url);
    expect(urls).toContain(`${SITE_URL}/states/wa`);
    expect(urls).toContain(`${SITE_URL}${regionPath("Yilgarn Craton")}`);
    expect(urls).toContain(`${SITE_URL}/commodities/gold`);
    const state = hubEntries(rows).find((e) => e.url.endsWith("/states/wa"))!;
    expect((state.lastModified as Date).toISOString()).toBe(new Date(Math.max(...rows.map((r) => Date.parse(r.updated)))).toISOString());
  });

  test("holes are ordered by State then slug and split into fixed chunks", () => {
    const rows = [row(2, { state: "WA", slug: "b" }), row(1, { state: "SA", slug: "z" }), row(3, { state: "WA", slug: "a" })];
    expect(holeOrder(rows).map((r) => `${r.state}/${r.slug}`)).toEqual(["SA/z", "WA/a", "WA/b"]);
    const big = many(SITEMAP_CHUNK + 1);
    expect(chunkCount(big)).toBe(2);
    expect(holeEntries(big, 0)).toHaveLength(SITEMAP_CHUNK);
    expect(holeEntries(big, 1)).toHaveLength(1);
    expect(chunkCount([])).toBe(1);
  });
});

describe("hubs", () => {
  test("related hubs count only the given rows and drop hubs with none of them", () => {
    const indexed = [...many(MIN_HUB_HOLES), ...many(MIN_HUB_HOLES, { region: "Pilbara Craton", commodities: ["copper"], target: "copper" }).map((r, i) => ({ ...r, key: `P${i}`, slug: `p${i}` }))];
    const some = indexed.slice(0, 3);
    const rel = relatedHubs(some, indexed);
    expect(rel.regions).toEqual([{ name: "Yilgarn Craton", path: regionPath("Yilgarn Craton"), n: 3 }]);
    expect(rel.commodities.map((c) => [c.path, c.n])).toEqual([["/commodities/gold", 3]]);
  });

  test("hole names sort naturally", () => {
    expect(byName([row(1, { name: "DD10" }), row(2, { name: "DD2" })]).map((r) => r.name)).toEqual(["DD2", "DD10"]);
  });
});

describe("breadcrumbs", () => {
  test("positions start at 1 and items are absolute URLs", () => {
    const ld = breadcrumbLd([{ name: "Western Australia", path: "/states/wa" }, { name: "CD16056", path: "/holes/wa/cd16056" }]);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((i) => [i.position, i.item])).toEqual([[1, `${SITE_URL}/states/wa`], [2, `${SITE_URL}/holes/wa/cd16056`]]);
  });
});

describe("ldJson", () => {
  test("escapes < so a value can never close the script tag", () => {
    const out = ldJson({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});
