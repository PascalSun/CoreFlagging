// Checks the public drillhole pages of a running site against the platform they are built from:
//  1. the sitemaps list only well-formed, unique, indexable hole pages;
//  2. facts: on a few rendered pages, every figure the platform holds for the hole is stated, exactly;
//  3. nothing forbidden appears on any checked page: model fingerprints, pre-signed storage links, the DMIRS
//     package's geology comments or assay columns, another State's tray photographs, uploads.
// Run: bun scripts/check-hole-pages.ts http://localhost:3000 https://platform.nlp-tlp.org [sample=40] [hole paths...]
export {};

const [site = "http://localhost:3000", platform = "https://platform.nlp-tlp.org", sampleArg = "40", ...factPaths] = process.argv.slice(2);
const API = `${platform.replace(/\/$/, "")}/core-scan/api`;
let failed = 0;
const fail = (m: string) => { console.log(`FAIL ${m}`); failed++; };
const ok = (m: string) => console.log(`ok   ${m}`);
const text = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.text(); };
const json = async <T,>(u: string) => (await (await fetch(u)).json()) as T;
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
/** The page's visible text, as a reader sees it: tags dropped, entities decoded, whitespace folded. */
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, "")
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const metres = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-AU");

// 1. sitemaps
const robots = await text(`${site}/robots.txt`);
const maps = [...robots.matchAll(/^Sitemap: (.+)$/gm)].map((m) => m[1].replace(/^https:\/\/coreflagging\.nlp-tlp\.org/, site));
const urls = (await Promise.all(maps.map(async (u) => locs(await text(u))))).flat().map((u) => u.replace(/^https:\/\/coreflagging\.nlp-tlp\.org/, ""));
const holes = urls.filter((u) => u.startsWith("/holes/"));
const hubs = urls.filter((u) => /^\/(states|regions|commodities)\//.test(u));
if (holes.some((u) => !/^\/holes\/[a-z]+\/[a-z0-9-]+$/.test(u))) fail("a hole URL in the sitemaps is not /holes/{state}/{slug}"); else ok(`${holes.length} hole URLs in ${maps.length} sitemaps, all well-formed`);
if (new Set(holes).size !== holes.length) fail("duplicate hole URLs in the sitemaps"); else ok("hole URLs unique");
ok(`${hubs.length} hubs: ${["states", "regions", "commodities"].map((k) => `${hubs.filter((u) => u.startsWith(`/${k}/`)).length} ${k}`).join(", ")}`);

// 2. facts on a few pages, each figure checked against the platform's own answer
type Detail = { key: string; name: string; state: string; drilled: number | null; depth_min: number; depth_max: number; operator: string; split: string;
  results: { run: string; summary: { metres: number; n_flag: number; n_segments: number; again?: { intervals: { from_m: number; to_m: number }[] } } }[] };
const index = new Map<string, { key: string; slug: string; state: string }>();
for (const st of [...new Set(holes.map((u) => u.split("/")[2].toUpperCase()))]) {
  const ix = await json<{ model: string; fields: string[]; holes: unknown[][] }>(`${API}/hole-index/?state=${st}`);
  for (const r of ix.holes) { const o = Object.fromEntries(ix.fields.map((f, i) => [f, r[i]])) as { key: string; slug: string; state: string }; index.set(`/holes/${o.state.toLowerCase()}/${o.slug}`, o); }
}
const facts = factPaths.length ? factPaths : ["/holes/wa/cd16056", holes[Math.floor(holes.length / 3)], holes[Math.floor((2 * holes.length) / 3)]];
for (const path of facts) {
  const row = index.get(path);
  if (!row) { fail(`${path}: not in the platform's index`); continue; }
  const k = encodeURIComponent(row.key);
  const [page, d, trays, docs] = await Promise.all([text(`${site}${path}`), json<Detail>(`${API}/holes/${k}/`), json<{ trays: unknown[] }>(`${API}/holes/${k}/trays/`),
    json<{ wamex: null | { linked: { anumber: string }[] } }>(`${API}/holes/${k}/documents/`)]);
  const t = visible(page);
  const res = d.results.find((r) => r.run === "v2")?.summary;
  const want: [string, string | null][] = [
    ["name", `Drillhole ${d.name}`],
    ["drilled", d.drilled ? `It was drilled in ${d.drilled}.` : null],
    ["operator", d.operator ? `The operator on record is ${d.operator}.` : null],
    ["scanned depths", `The scan covers ${metres(d.depth_min)}–${metres(d.depth_max)} m down the hole.`],
    ["metres read", res ? `read ${metres(res.metres)} m of this hole's scan` : null],
    ["flagged metres", res ? (res.n_flag ? `It flags ${res.n_flag.toLocaleString("en-AU")} metre${res.n_flag === 1 ? "" : "s"} as standing out` : "It flags none of the metres") : null],
    ["segments", res?.n_segments ? `into ${res.n_segments.toLocaleString("en-AU")} segment` : null],
    ...((res?.again?.intervals ?? []).map((a) => ["look again", `${metres(a.from_m)}–${metres(a.to_m)} m: logged as`] as [string, string])),
    ["trays", d.state === "WA" && trays.trays.length ? `photographed the core in ${trays.trays.length.toLocaleString("en-AU")} tray` : null],
    ...((docs.wamex?.linked ?? []).map((l) => ["WAMEX", l.anumber] as [string, string])),
    ["training banner", d.split === "train" || d.split === "val" ? "The models saw this hole in training." : null],
    ["outside WA", d.state !== "WA" ? "not yet checked outside WA" : null],
    ["model output label", "Model output"],
  ];
  const missing = want.filter(([, s]) => s && !t.includes(s));
  if (missing.length) fail(`${path}: ${missing.map(([w, s]) => `${w} ("${s}")`).join("; ")} not on the page`);
  else ok(`${path}: ${want.filter(([, s]) => s).length} facts match the platform`);
}

// 3. nothing forbidden, on every hub and a sample of hole pages
const sample = [...hubs, ...facts, ...holes.filter((_, i) => i % Math.max(1, Math.floor(holes.length / Number(sampleArg))) === 0)];
let checked = 0;
for (const path of [...new Set(sample)]) {
  const html = await text(`${site}${path}`);
  const bad: string[] = [];
  if (/X-Amz-|s3\.nlp-tlp\.org/.test(html)) bad.push("pre-signed storage link");
  if (/\/reviews\/|"verdict"|"note":/.test(html)) bad.push("reviews");
  if (/"sig"|fp1m/.test(html)) bad.push("fingerprints");
  if (/\b(sio2|mgo|au|ni|cu|cr)_(pct|ppm)\b/.test(html)) bad.push("DMIRS assay columns");
  if (/\/holes\/u-[0-9a-f]+/.test(html)) bad.push("an upload");
  const row = index.get(path);
  if (row) {
    const k = encodeURIComponent(row.key);
    if (row.state !== "WA" && /\/trays\/[0-9a-f-]{36}\.jpg/.test(html)) bad.push("another State's tray photograph");
    const d = await json<{ results: { summary: { sig?: { v: number[] } } }[] }>(`${API}/holes/${k}/`);
    for (const r of d.results) for (const v of (r.summary.sig?.v ?? []).slice(0, 5)) if (Math.abs(v) > 0.01 && html.includes(String(v))) bad.push(`fingerprint value ${v}`);
    if (row.state === "WA") {
      const p = await fetch(`${API}/holes/${k}/package/`);
      if (p.ok) {
        const pk = (await p.json()) as { geology: { comments: string }[]; assays: { rows: { v: (number | null)[] }[] } };
        for (const g of pk.geology) if (g.comments.length > 24 && html.includes(g.comments)) { bad.push("a DMIRS geology comment"); break; }
        const vals = pk.assays.rows.flatMap((r) => r.v).filter((v): v is number => v != null && String(v).length >= 6);
        // a value as a number of its own, not a run of digits inside another (a collar coordinate, say)
        const vt = visible(html);
        if (vals.slice(0, 50).some((v) => new RegExp(`(?<![\\d.])${String(v).replace(".", "\\.")}(?![\\d])`).test(vt))) bad.push("a DMIRS assay value");
      }
    }
  }
  if (bad.length) fail(`${path}: ${[...new Set(bad)].join(", ")}`);
  checked++;
}
ok(`${checked} pages checked for forbidden data`);
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
