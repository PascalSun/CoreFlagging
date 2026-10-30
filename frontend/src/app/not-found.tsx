import type { Metadata } from "next";

// A page that does not exist sends the visitor to the platform's front door, geo.nlp-tlp.org. The answer stays a 404,
// so search engines drop the address; the refresh moves people on.
const GEO = "https://geo.nlp-tlp.org/";

export const metadata: Metadata = { title: "Page not found", robots: { index: false, follow: true } };

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <meta httpEquiv="refresh" content={`0;url=${GEO}`} />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-md text-slate-600">
        CoreFlagging has no page at this address. Taking you to <a href={GEO} className="font-semibold text-slate-900 underline underline-offset-4">the NTLP Geo Data Platform</a>.
      </p>
    </main>
  );
}
