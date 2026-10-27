import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataPage, LINK, Prose, Section, type Source } from "@/components/holePages/Page";
import { holePage, indexedRows, PUBLIC_PLATFORM } from "@/lib/holePages/data";
import { stateName } from "@/lib/holePages/facts";
import { holeJsonLd } from "@/lib/holePages/jsonld";
import { DASC, NVCL, termsOf, WAMEX } from "@/lib/holePages/licence";
import { regionHubs, regionPath, statePath } from "@/lib/holePages/rules";
import {
  againSentence, describe, m, OUTSIDE_WA, TRAINING, modelSentences, packageSentences, recordSentences, regionSentences, traySentences, wamexSentence,
} from "@/lib/holePages/sentences";
import { pageMeta } from "@/lib/seo";

// One public page per scanned drillhole: the State's record of the hole, HyFormer's reading of its scan (labelled
// model output), how it compares with its region, its trays, documents and neighbours. Rendered on the server on
// first request and regenerated at most daily (ISR); no hole is built ahead.

export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

type Params = { params: Promise<{ state: string; slug: string }> };


export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { state, slug } = await params;
  const p = await holePage(state, slug);
  if (!p) return { title: "Drillhole not found", robots: { index: false, follow: true } };
  const f = p.facts;
  return {
    ...pageMeta(f.path, `${f.name}, ${stateName(f.state)}: HyLogger-scanned drillhole | CoreFlagging`, describe(f)),
    robots: p.indexed ? { index: true, follow: true } : { index: false, follow: true },
    icons: { icon: "/brand/coretrace-mark.svg", apple: "/brand/coretrace-mark.svg" },
  };
}

export default async function HolePage({ params }: Params) {
  const { state, slug } = await params;
  const p = await holePage(state, slug);
  if (!p) notFound();
  const f = p.facts;
  const t = termsOf(f.state);
  // the region crumb links only to a hub that exists
  const hub = f.state === "WA" && f.region ? regionHubs(await indexedRows()).find((h) => regionPath(h.name) === regionPath(f.region)) : undefined;
  const regionHub = hub ? { name: hub.name, path: regionPath(hub.name) } : null;

  const survey: Source = { name: `${t?.survey ?? f.state}, ${NVCL.name}`, url: NVCL.url, licence: t?.licence?.name ?? "not confirmed", licenceUrl: t?.licence?.url };
  const readOn = f.read_on ? new Date(f.read_on).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) : "";
  const model: Source = { name: `CoreFlagging, ${f.model?.name ?? "HyFormer"} model${f.model ? ` (run ${f.model.run})` : ""}${readOn ? `, read ${readOn}` : ""}`, url: "/faq", licence: "none published for the model's readings" };
  const record = recordSentences(f), reading = modelSentences(f), region = regionSentences(f), trays = traySentences(f), pkg = packageSentences(f);
  const wamex = wamexSentence(f);

  return (
    <DataPage
      crumbs={[{ name: stateName(f.state), path: statePath(f.state) }, ...(regionHub ? [regionHub] : []), { name: f.name }]}
      title={`Drillhole ${f.name}`}
      lede={<p>{record[0]} <Link href={`/map?hole=${encodeURIComponent(f.key)}`} className={LINK}>Open it in the map</Link> for every metre of the reading.</p>}
      ld={[holeJsonLd(f, regionHub)]}
    >
      {(f.training || f.state !== "WA") && (
        <div className="mb-8 flex flex-col gap-2">
          {f.state !== "WA" && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{OUTSIDE_WA}</p>}
          {f.training && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{TRAINING}</p>}
        </div>
      )}

      <Section id="record" title="The hole on record" sources={[survey]}>
        <Prose sentences={record.slice(1)} />
      </Section>

      {reading.length > 0 && (
        <Section id="reading" title="HyFormer's reading" model sources={[model]}>
          <Prose sentences={reading} />
          {f.model && f.model.again.length > 0 && (
            <ul className="mt-3 list-disc pl-5">
              {f.model.again.map((a, i) => { const s = againSentence(a); return s ? <li key={i}>{s}</li> : null; })}
            </ul>
          )}
          <p className="mt-3">These are a model&apos;s readings of the scan, not measurements or assays, and they give no grade.</p>
        </Section>
      )}

      {region.length > 0 && (
        <Section id="region" title="Against its region" model sources={[model]}>
          <Prose sentences={region} />
        </Section>
      )}

      {f.domains.length > 0 && (
        <Section id="domains" title="Domains that stand out" model sources={[model]}>
          <p>Stretches of core HyFormer sets apart from the rest of the hole{f.domains.length > 12 ? ` (the first 12 of ${f.domains.length})` : ""}:</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm">
            <thead><tr className="border-b border-line text-ink"><th className="py-1.5 pr-4 font-semibold">Depth</th><th className="py-1.5 pr-4 font-semibold">HyFormer class</th><th className="py-1.5 font-semibold">Why it stands out</th></tr></thead>
            <tbody>
              {f.domains.slice(0, 12).map((d, i) => (
                <tr key={i} className="border-b border-line/70 align-top">
                  <td className="py-1.5 pr-4 whitespace-nowrap">{m(d.from_m)}–{m(d.to_m)} m</td>
                  <td className="py-1.5 pr-4">{d.type}</td>
                  <td className="py-1.5">{d.why.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Section>
      )}

      {f.trays && (
        <Section id="trays" title="Core trays" sources={[{ name: "Geological Survey of Western Australia, HyLogger tray photographs", url: NVCL.url, licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/" }]}>
          <Prose sentences={trays} />
          {f.trays.pick && (
            <figure className="mt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${PUBLIC_PLATFORM}/core-scan/api/holes/${encodeURIComponent(f.key)}/trays/${f.trays.pick.id}.jpg`} alt={`Core tray of drillhole ${f.name}, ${m(f.trays.pick.from_m)}–${m(f.trays.pick.to_m)} m`}
                width={f.trays.pick.width || undefined} height={f.trays.pick.height || undefined} loading="lazy" decoding="async" className="h-auto w-full rounded-lg bg-line" />
              <figcaption className="mt-2 text-[13px]">Photograph © State of Western Australia (GSWA), CC BY 4.0.</figcaption>
            </figure>
          )}
        </Section>
      )}

      {(f.pdfs.length > 0 || wamex) && (
        <Section id="documents" title="Documents" sources={[
          ...(f.pdfs.length ? [{ name: `${t?.survey ?? f.state}, ${NVCL.name} (HyLogger reports)`, url: NVCL.url, licence: t?.licence?.name ?? "not confirmed", licenceUrl: t?.licence?.url }] : []),
          ...(wamex ? [{ name: `${WAMEX.name}, matched through the DMIRS HyLogger drillhole package`, url: WAMEX.url, licence: "each report's own terms, as WAMEX states them" }] : []),
        ]}>
          {f.pdfs.length > 0 && (
            <ul className="list-disc pl-5">
              {f.pdfs.map((d) => <li key={d.url}><a href={d.url} className={LINK} rel="noopener">{d.title}</a> ({d.kind}{d.pages ? `, ${d.pages} pages` : ""}, PDF)</li>)}
            </ul>
          )}
          {wamex && <p className={f.pdfs.length ? "mt-3" : ""}>{wamex}</p>}
          {f.wamex.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {f.wamex.map((w) => <li key={w.anumber}><a href={w.url} className={LINK} rel="noopener">{w.anumber}</a>{w.title ? `: ${w.title}` : ""}{w.year ? ` (${w.year})` : ""}</li>)}
            </ul>
          )}
        </Section>
      )}

      {pkg.length > 0 && (
        <Section id="package" title="DMIRS drillhole package" sources={[{ name: DASC.name, url: DASC.url, licence: DASC.licence.name, licenceUrl: DASC.licence.url }]}>
          <Prose sentences={pkg} />
          <p className="mt-3">The package is interim data, so it is summarised here and its tables are not reproduced.</p>
        </Section>
      )}

      {f.nearby.length > 0 && (
        <Section id="nearby" title="Nearby holes" sources={[survey]}>
          <p>Scanned holes within 5 km of the collar that have a page here:</p>
          <ul className="mt-2 list-disc pl-5">
            {f.nearby.map((n) => <li key={n.path}><Link href={n.path} className={LINK}>{n.name}</Link>, {n.km < 0.05 ? "at the same collar" : `${n.km.toLocaleString("en-AU", { maximumFractionDigits: 1 })} km away`}</li>)}
          </ul>
        </Section>
      )}
    </DataPage>
  );
}
