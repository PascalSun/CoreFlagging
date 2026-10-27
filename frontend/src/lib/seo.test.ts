import { describe, expect, test } from "bun:test";
import { answerParts, FAQ_JSON_LD } from "./faq";
import { datasetNodes, ldBlocks, missingFields } from "./ldcheck";
import { JSON_LD, pageMeta } from "./seo";

describe("structured data", () => {
  test("every Dataset node has name, description, creator and license", () => {
    for (const n of datasetNodes([JSON_LD, FAQ_JSON_LD])) expect([n.name, missingFields(n)]).toEqual([n.name, []]);
  });

  test("the readings, which have no published licence, are not typed Dataset", () => {
    const readings = JSON_LD["@graph"].find((n) => (n as { "@id"?: string })["@id"]?.endsWith("/#readings")) as Record<string, unknown>;
    expect(readings["@type"]).toBe("CreativeWork");
  });

  test("the checker reads blocks out of HTML and catches a Dataset without a licence", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Dataset", name: "x", description: "y".repeat(60), creator: "z" })}</script>`;
    expect(datasetNodes(ldBlocks(html)).map(missingFields)).toEqual([["license"]]);
  });

  test("a page's metadata and an answer's links, the other helpers the JSON-LD sits beside", () => {
    expect(pageMeta("/faq", "FAQ", "Answers.").alternates).toEqual({ canonical: "/faq" });
    expect(answerParts("See the [map](/map) first.")).toEqual([{ text: "See the " }, { text: "map", href: "/map" }, { text: " first." }]);
  });
});
