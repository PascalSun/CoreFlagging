import Link from "next/link";
import { DataPage, HoleList, LINK, Prose, Section, type Source } from "@/components/holePages/Page";
import { hubSentences, relatedHubs } from "@/lib/holePages/hubs";
import { OUTSIDE_WA } from "@/lib/holePages/sentences";
import { breadcrumbLd } from "@/lib/holePages/jsonld";
import { NVCL, termsOf } from "@/lib/holePages/licence";
import { byName, holePath, type IndexRow } from "@/lib/holePages/rules";

/** A hub: counts over its holes, links to the hubs they share, and every hole it lists. */
export function Hub({ crumbs, title, where, rows, indexed, extra, extraSource, listed }: {
  crumbs: { name: string; path: string }[]; title: string; where: string; rows: IndexRow[]; indexed: IndexRow[];
  extra?: string; extraSource?: Source;
  /** the holes to list, when not every one of `rows` (a State hub lists only those no region hub lists) */
  listed?: { title: string; rows: IndexRow[] };
}) {
  const states = [...new Set(rows.map((r) => r.state))];
  const sources: Source[] = states.map((s) => { const t = termsOf(s); return { name: `${t?.survey ?? s}, ${NVCL.name}`, url: NVCL.url, licence: t?.licence?.name ?? "not confirmed", licenceUrl: t?.licence?.url }; });
  const model: Source = { name: "CoreFlagging, HyFormer model", url: "/faq", licence: "none published for the model's readings" };
  const rel = relatedHubs(rows, indexed);
  const here = crumbs[crumbs.length - 1].path;
  const sentences = hubSentences(rows, where);
  return (
    <DataPage crumbs={crumbs.map((c, i) => (i === crumbs.length - 1 ? { name: c.name } : c))} title={title}
      lede={<p>{sentences[0]}{extra ? ` ${extra}` : ""}</p>} ld={[breadcrumbLd(crumbs)]}>
      {states.some((s) => s !== "WA") && (
        <p className="mb-8 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{OUTSIDE_WA}</p>
      )}
      <Section id="summary" title="In numbers" sources={[...sources, ...(extraSource ? [extraSource] : []), model]}>
        <Prose sentences={sentences.slice(1)} />
      </Section>
      {[["regions", "By tectonic region", rel.regions] as const, ["commodities", "By commodity", rel.commodities] as const].map(([id, t, xs]) =>
        xs.filter((x) => x.path !== here).length > 0 && (
          <Section key={id} id={id} title={t} sources={id === "regions" ? [{ name: "Geological Survey of Western Australia, tectonic units on each hole's record", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/" }] : sources}>
            <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
              {xs.filter((x) => x.path !== here).map((x) => <li key={x.path}><Link href={x.path} className={LINK}>{x.name}</Link> <span className="text-ink-soft/80">({x.n.toLocaleString("en-AU")})</span></li>)}
            </ul>
          </Section>
        ))}
      {(listed ? listed.rows : rows).length > 0 && <Section id="holes" title={listed?.title ?? "The holes"} sources={sources}>
        <HoleList holes={byName(listed ? listed.rows : rows).map((r) => ({ name: r.name, path: holePath(r), note: r.drilled ? String(r.drilled) : undefined }))} />
      </Section>}
    </DataPage>
  );
}
