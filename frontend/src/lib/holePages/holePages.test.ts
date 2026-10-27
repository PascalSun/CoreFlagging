import { describe, expect, test } from "bun:test";
import detail from "./fixtures/cd16056.detail.json";
import documents from "./fixtures/cd16056.documents.json";
import nearby from "./fixtures/cd16056.nearby.json";
import pkg from "./fixtures/cd16056.package.json";
import standout from "./fixtures/cd16056.standout.json";
import trays from "./fixtures/cd16056.trays.json";
import waIndex from "./fixtures/wa-index.json";
import { type HoleFacts, holeFacts, type Raw } from "./facts";
import { holeJsonLd } from "./jsonld";
import { datasetNodes, missingFields } from "../ldcheck";
import {
  commodityHubs, h1Reasons, holePath, type HoleIndex, type IndexRow, MIN_HUB_HOLES, passesH0, passesH1, regionHubs, rowsOf, slugify, stateHubs,
} from "./rules";
import {
  againSentence, describe as describeHole, modelSentences, OUTSIDE_WA, TRAINING, packageSentences, recordSentences, regionSentences, traySentences, wamexSentence,
} from "./sentences";
import { hubSentences } from "./hubs";
import { chunkCount, holeEntries } from "./sitemap";

const BASE: IndexRow = {
  key: "X1", slug: "x1", name: "X1", state: "WA", lon: 121, lat: -31, offshore: false, operator: "", project: "", region: "", depth_min: 0, depth_max: 100,
  drilled: null, has_lith: false, au_m: 0, n_again: 0, target: "", target_source: "", commodities: [], split: "", read_m: 95, n_flag: 0, wamex: false,
  updated: "2026-10-06T18:44:46+00:00", source: "nvcl",
};
const row = (o: Partial<IndexRow>): IndexRow => ({ ...BASE, ...o });

const rows = rowsOf(waIndex as unknown as HoleIndex);
const cdRow = rows.find((r) => r.key === "CD16056")!;
const raw = (o: Partial<Raw> = {}): Raw => ({
  row: cdRow, run: "v2", detail: detail as never, standout: standout as never, documents: documents as never, trays: trays as never, pkg: pkg as never,
  nearby: nearby as never, pages: new Map(rows.map((r) => [r.key, r])), platformUrl: "https://platform.nlp-tlp.org", ...o,
});
const allText = (f: HoleFacts) => [
  ...recordSentences(f), ...modelSentences(f), ...(f.model?.again ?? []).map(againSentence), ...regionSentences(f), ...traySentences(f),
  wamexSentence(f), ...packageSentences(f), describeHole(f), JSON.stringify(holeJsonLd(f, null)), JSON.stringify(f),
].join("\n");

describe("H0: which holes get a page", () => {
  test("an NVCL hole, read by the model, onshore with a collar, at least 20 m scanned, not a petroleum well", () => {
    expect(passesH0(BASE)).toBe(true);
    expect(passesH0(row({ source: "upload" }))).toBe(false);
    expect(passesH0(row({ read_m: null }))).toBe(false);
    expect(passesH0(row({ read_m: 0 }))).toBe(false);
    expect(passesH0(row({ offshore: true }))).toBe(false);
    expect(passesH0(row({ lat: null }))).toBe(false);
    expect(passesH0(row({ lon: null }))).toBe(false);
    expect(passesH0(row({ depth_min: 100, depth_max: 119.9 }))).toBe(false);
    expect(passesH0(row({ depth_min: 100, depth_max: 120 }))).toBe(true);
    expect(passesH0(row({ depth_max: null }))).toBe(false);
    expect(passesH0(row({ split: "petroleum" }))).toBe(false);
    expect(passesH0(row({ slug: "" }))).toBe(false);
  });
});

describe("H1: which pages are indexed", () => {
  test("H0 plus one fact of the hole's own", () => {
    expect(passesH1(BASE)).toBe(false);
    for (const o of [{ operator: "ACME" }, { project: "P" }, { target: "gold", target_source: "survey" }, { has_lith: true }, { n_again: 1 }, { au_m: 3 }, { wamex: true }] as Partial<IndexRow>[])
      expect([o, passesH1(row(o))]).toEqual([o, true]);
    // a target inferred from the nearest deposit, or named by a report, is not the hole's own record
    expect(passesH1(row({ target: "gold", target_source: "deposit" }))).toBe(false);
    expect(passesH1(row({ target: "gold", target_source: "report" }))).toBe(false);
    // H1 never rescues a hole that fails H0
    expect(passesH1(row({ operator: "ACME", offshore: true }))).toBe(false);
    expect(h1Reasons(cdRow)).toEqual(["operator or project", "target from the hole's own record", "logged lithology", "look-again interval", "gold assays", "linked WAMEX report"]);
  });
});

describe("addresses", () => {
  test("hole paths are the State and the platform's stored slug, URL-safe", () => {
    expect(holePath(cdRow)).toBe("/holes/wa/cd16056");
    for (const r of rows) expect(holePath(r)).toMatch(/^\/holes\/[a-z]+\/[a-z0-9-]+$/);
  });
  test("region and commodity slugs fold case and punctuation", () => {
    expect(slugify("Albany–Fraser Orogen")).toBe("albany-fraser-orogen");
    expect(slugify("YILGARN CRATON")).toBe(slugify("Yilgarn Craton"));
    expect(slugify("platinum group elements")).toBe("platinum-group-elements");
  });
  test("every (State, slug) in an index is unique", () => {
    const seen = new Set(rows.map((r) => `${r.state}/${r.slug}`));
    expect(seen.size).toBe(rows.length);
  });
});

describe("hubs", () => {
  const mk = (i: number, o: Partial<IndexRow>) => row({ key: `K${i}`, slug: `k${i}`, name: `K${i}`, operator: "ACME", ...o });
  const many = [
    ...Array.from({ length: MIN_HUB_HOLES }, (_, i) => mk(i, { region: i % 2 ? "Yilgarn Craton" : "YILGARN CRATON", commodities: ["gold"], target_source: "survey" })),
    ...Array.from({ length: MIN_HUB_HOLES - 1 }, (_, i) => mk(100 + i, { region: "Pilbara Craton", commodities: ["iron"], target_source: "deposit" })),
  ];
  test("a hub needs enough indexed holes, merges spellings and is named by the commonest", () => {
    // 5 holes spell it "YILGARN CRATON", 5 "Yilgarn Craton": one hub
    expect(regionHubs(many).map((h) => [h.slug, h.holes.length])).toEqual([["yilgarn-craton", MIN_HUB_HOLES]]);
    const mostly = [...many, mk(50, { region: "YILGARN CRATON" }), mk(51, { region: "YILGARN CRATON" })];
    expect(regionHubs(mostly).map((h) => h.name)).toEqual(["YILGARN CRATON"]);
    expect(commodityHubs(many).map((h) => h.slug)).toEqual(["gold"]);       // iron: too few, and inferred targets never count
    expect(stateHubs(many).map((h) => [h.slug, h.holes.length])).toEqual([["wa", many.length]]);
  });
  test("hub sentences drop what is zero", () => {
    const s = hubSentences([mk(1, { drilled: 2001 }), mk(2, { drilled: 2011, has_lith: true })], "in the test region");
    expect(s).toEqual([
      "2 HyLogger-scanned drillholes in the test region have a page here.",
      "Those with a drilling date on record were drilled between 2001 and 2011.",
      "1 hole carries a geologist's lithology log in the State's record.",
      "HyFormer, a core-spectra model, has read 190 m of their scans (model output).",
    ]);
  });
});

describe("the worked example, CD16056", () => {
  const f = holeFacts(raw());
  test("the facts the page states, each from the platform's record", () => {
    expect(f.path).toBe("/holes/wa/cd16056");
    expect(recordSentences(f)).toEqual([
      "CD16056 is a drillhole in Western Australia whose core was scanned by a HyLogger.",
      "Its collar is at latitude -31.32632, longitude 121.79025.",
      "It lies in the Eastern Goldfields Superterrane.",
      "It was drilled in 2011.",
      "The operator on record is ST IVES GOLD MINING CO PTY LTD.",
      "The project on record is Playa Shear Hole.",
      "The scan records an inclination of -70° and an azimuth of 270°.",
      "The scan covers 0–988 m down the hole.",
      "It was scanned on a HyLogger 3-2.",
      "The hole's own record names gold as its target commodity.",
      "The State's record holds a geologist's lithology log for the hole.",
      "978 metres of the hole carry a gold assay in the State's record.",
    ]);
    expect(modelSentences(f)).toEqual([
      "HyFormer, a core-spectra model, read 965 m of this hole's scan, every 10 cm.",
      "Of the metres it read, it classes the most as Plagioclase + chlorite, more amphibole (II) (41%), Quartz (no SWIR response), more dark mica (41%) and Quartz + white mica, more K-feldspar (6%).",
      "It divides the hole into 131 segments where the rock changes.",
      "It flags 29 metres as standing out from the core around them.",
      "On 1 interval its reading and the geologist's log disagree, so it suggests looking again.",
    ]);
    expect(f.model!.again.map(againSentence)).toEqual(["913–920 m: logged as Mafic/Ultramafic Schist (Ultramafic); HyFormer reads Quartz + white mica, more K-feldspar."]);
    expect(traySentences(f)[0]).toBe("The Geological Survey of Western Australia photographed the core in 230 trays.");
    expect(f.trays!.pick!.from_m).toBeLessThanOrEqual(913);
    expect(f.trays!.pick!.to_m).toBeGreaterThanOrEqual(913);
    expect(wamexSentence(f)).toBe("The hole was logged in WAMEX reports A95267 and A97166.");
    expect(packageSentences(f)).toEqual([
      "The DMIRS HyLogger drillhole package matches the hole to WAMEX collar " + f.pkg!.collar_id + ".",
      "That record lists it as a diamond hole (type DD).",
      "It gives the hole's depth as 988 m.",
      "It holds 63 logged geology intervals for the hole.",
      "It holds 666 assayed intervals for the hole.",
    ]);
    expect(regionSentences(f)).toEqual([
      "HyFormer classes 40% of this hole as Plagioclase + chlorite, more amphibole (II), against 13% across the 476 scanned holes of the Eastern Goldfields Superterrane.",
      "HyFormer classes 40% of this hole as Quartz (no SWIR response), more dark mica, against 6% across the 476 scanned holes of the Eastern Goldfields Superterrane.",
    ]);
    expect(f.training).toBe(true);
    expect(f.nearby.map((n) => n.name)).toEqual(["CD16056A", "CD20297W1", "CD20297", "CD20297W2", "CD14460"]);
  });

  test("the model's readings never state a grade", () => {
    const model = [...modelSentences(f), ...regionSentences(f), ...f.model!.again.map(againSentence)].join(" ");
    expect(model).not.toMatch(/ppm|ppb|g\/t|grade|%\s*(Au|Cu|Ni)|ounce/i);
  });

  test("structured data: a Dataset by the State survey, under its licence, placed at the collar", () => {
    const ld = holeJsonLd(f, { name: "Eastern Goldfields Superterrane", path: "/regions/eastern-goldfields-superterrane" });
    const ds = datasetNodes(ld);
    expect(ds.length).toBe(1);
    expect(missingFields(ds[0])).toEqual([]);
    expect(ds[0].license).toBe("https://creativecommons.org/licenses/by/4.0/");
    expect((ds[0].creator as { name: string }).name).toBe("Geological Survey of Western Australia");
    expect((ds[0].spatialCoverage as { geo: { latitude: number } }).geo.latitude).toBeCloseTo(-31.3263, 3);
    const crumbs = (ld["@graph"][0] as { itemListElement: { name: string }[] }).itemListElement.map((c) => c.name);
    expect(crumbs).toEqual(["Western Australia", "Eastern Goldfields Superterrane", "CD16056"]);
  });

  test("a State without a confirmed licence gets no Dataset", () => {
    for (const st of ["VIC", "CSIRO"]) expect(datasetNodes(holeJsonLd({ ...f, state: st }, null))).toEqual([]);
    expect(datasetNodes(holeJsonLd({ ...f, state: "TAS" }, null))[0].license).toBe("https://creativecommons.org/licenses/by/3.0/au/");
  });
});

describe("a missing value drops its sentence", () => {
  test("no operator, project, region, year, orientation, instrument or model: those sentences go, nothing is written around them", () => {
    const bare = row({ key: "B1", slug: "b1", name: "B1" });
    const f = holeFacts({ row: bare, run: "v2", detail: null, standout: null, documents: null, trays: null, pkg: null, nearby: null, pages: new Map(), platformUrl: "" });
    expect(recordSentences(f)).toEqual([
      "B1 is a drillhole in Western Australia whose core was scanned by a HyLogger.",
      "Its collar is at latitude -31.00000, longitude 121.00000.",
      "The scan covers 0–100 m down the hole.",
    ]);
    expect(modelSentences(f)).toEqual([]);
    expect([regionSentences(f), traySentences(f), packageSentences(f), [wamexSentence(f)]]).toEqual([[], [], [], [null]]);
    expect(describeHole(f)).toBe("B1, a HyLogger-scanned drillhole in Western Australia. Scanned 0–100 m.");
  });

  test("each value alone: present it is stated, absent its sentence is gone", () => {
    const full = holeFacts(raw());
    const cases: [Partial<HoleFacts>, RegExp][] = [
      [{ operator: "" }, /operator on record/], [{ project: "" }, /project on record/], [{ region: "" }, /It lies in/],
      [{ drilled: null }, /was drilled in/], [{ inclination: null }, /inclination/], [{ azimuth: null }, /azimuth/],
      [{ instrument: "" }, /scanned on a/], [{ depth_max: null }, /The scan covers/], [{ au_m: 0 }, /gold assay/], [{ has_lith: false }, /lithology log/],
      [{ target: "" }, /target commodity/], [{ target_source: "deposit" }, /target commodity/],
    ];
    for (const [o, re] of cases) {
      expect(recordSentences(full).some((s) => re.test(s))).toBe(true);
      expect([o, recordSentences({ ...full, ...o }).some((s) => re.test(s))]).toEqual([o, false]);
    }
    const md = full.model!;
    expect(modelSentences({ ...full, model: { ...md, read_m: null } }).some((s) => /read .* m of this hole/.test(s))).toBe(false);
    expect(modelSentences({ ...full, model: { ...md, n_segments: null } }).some((s) => /segments/.test(s))).toBe(false);
    expect(modelSentences({ ...full, model: { ...md, n_flag: null } }).some((s) => /flags/.test(s))).toBe(false);
    expect(modelSentences({ ...full, model: { ...md, n_flag: 0 } })).toContain("It flags none of the metres it read as standing out from the core around them.");
    expect(packageSentences({ ...full, pkg: { ...full.pkg!, max_depth: null } }).some((s) => /depth/.test(s))).toBe(false);
    expect(packageSentences({ ...full, pkg: { ...full.pkg!, hole_type: "XYZ" } })).toContain("That record gives its hole type as XYZ.");
    expect(packageSentences({ ...full, pkg: { ...full.pkg!, hole_type: "" } }).some((s) => /hole type|lists it/.test(s))).toBe(false);
    expect(againSentence({ from_m: 1, to_m: 2, logged: "", logged_class: "", reads: "Carbonate" })).toBeNull();
  });

  test("no sentence ever carries an empty or placeholder value", () => {
    const f = holeFacts(raw());
    for (const o of [{}, { operator: "" }, { drilled: null }, { region: "" }] as Partial<HoleFacts>[])
      expect(allText({ ...f, ...o })).not.toMatch(/\bundefined\b|\bnull\b(?!,)|\bNaN\b|  |\(\)|on record is \.|in \./);
  });
});

describe("nothing forbidden reaches a page", () => {
  test("no fingerprints, reviews, DMIRS geology or assay values, or pre-signed links survive into the facts", () => {
    const text = allText(holeFacts(raw()));
    for (const bad of ["-0.987654321", "sig", "FORBIDDEN-REVIEW-NOTE", "FORBIDDEN-GEOLOGY-COMMENT", "4242.4242", "FORBIDDEN-PRESIGNED", "X-Amz", "au_ppm", "abstract"])
      expect([bad, text.includes(bad)]).toEqual([bad, false]);
  });
  test("another State's tray photographs are never shown", () => {
    for (const st of ["SA", "NSW", "NT", "QLD", "TAS", "VIC", "CSIRO"]) {
      const f = holeFacts(raw({ row: { ...cdRow, state: st } }));
      expect([st, f.trays, f.pkg]).toEqual([st, null, null]);
    }
  });
  test("an upload never gets a page, and PDFs without a confirmed licence are not linked", () => {
    expect(passesH0(row({ source: "upload" }))).toBe(false);
    const docs = structuredClone(documents) as typeof documents;
    (docs.hole_pdfs[0] as { licence: { confirmed: boolean } }).licence.confirmed = false;
    expect(holeFacts(raw({ documents: docs as never })).pdfs.length).toBe(1);
  });
});

describe("caveats", () => {
  test("outside WA and training holes carry their banners", () => {
    expect(OUTSIDE_WA).toMatch(/^Not yet checked outside WA\./);
    expect(TRAINING).toBe("The models saw this hole in training. Results here will look better than on core they have not seen.");
    expect(holeFacts(raw({ row: { ...cdRow, split: "test" } })).training).toBe(false);
    expect(holeFacts(raw({ row: { ...cdRow, split: "val" } })).training).toBe(true);
  });
});

describe("sitemaps", () => {
  test("only indexed holes, chunked, each with the date its hole last changed", () => {
    const idx = Array.from({ length: 4100 }, (_, i) => row({ key: `K${i}`, slug: `k${String(i).padStart(4, "0")}`, operator: "A" }));
    expect(chunkCount(idx)).toBe(3);
    expect(chunkCount([])).toBe(1);
    const e = holeEntries(idx, 2);
    expect(e.length).toBe(100);
    expect(e[0].url).toBe("https://coreflagging.nlp-tlp.org/holes/wa/k4000");
    expect((e[0].lastModified as Date).toISOString()).toBe("2026-10-06T18:44:46.000Z");
  });
});
