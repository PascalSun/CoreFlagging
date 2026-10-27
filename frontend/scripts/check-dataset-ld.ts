// Fetches pages of a running site and checks every schema.org Dataset in their JSON-LD has name, description, creator
// and license (Google's required and recommended fields). Exits 1 on any gap.
// Run against a local build: bun run build && bun run start &  bun scripts/check-dataset-ld.ts http://localhost:3000
// or the live site:          bun scripts/check-dataset-ld.ts https://coreflagging.nlp-tlp.org
import { datasetNodes, ldBlocks, missingFields } from "../src/lib/ldcheck";

const [base = "http://localhost:3000", ...given] = process.argv.slice(2);
const PATHS = given.length ? given : ["/", "/faq", "/map"];

let failed = 0;
for (const path of PATHS) {
  const r = await fetch(new URL(path, base));
  if (!r.ok) { console.log(`FAIL ${path}: HTTP ${r.status}`); failed++; continue; }
  const blocks = ldBlocks(await r.text());
  const nodes = datasetNodes(blocks);
  const bad = nodes.map((n) => [n, missingFields(n)] as const).filter(([, m]) => m.length);
  for (const [n, m] of bad) console.log(`FAIL ${path}: Dataset "${n.name ?? n["@id"] ?? "?"}" lacks ${m.join(", ")}`);
  if (bad.length) failed++;
  else console.log(`ok   ${path}: ${blocks.length} JSON-LD block(s), ${nodes.length} Dataset node(s) complete`);
}
if (failed) { console.log(`${failed} page(s) failed`); process.exit(1); }
