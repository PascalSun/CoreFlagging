import { SITE_NAME, SITE_URL } from "@/lib/seo";

// The questions people ask about CoreFlagging, in the words they search with, for /faq and its FAQPage structured
// data. Every answer restates what the landing page, the upload dialog or llms.txt already says, or the platform's
// data library and terms (geo.nlp-tlp.org). A link is written [text](href); the page renders it, the structured
// data keeps only its text, so the two always read the same.

const PLATFORM_SITE = "https://geo.nlp-tlp.org";

export type Faq = { id: string; q: string; a: string };

export const FAQ: Faq[] = [
  {
    id: "what-is-coreflagging",
    q: "What is CoreFlagging?",
    a: "CoreFlagging is a second opinion on every metre of drill core. It reads every HyLogger-scanned drillhole in Australia's core libraries, about 6,600 holes in the National Virtual Core Library, the same way, with a core-spectra foundation model called HyFormer. It sets that reading beside the geologist's log, so the intervals where the core and the log disagree get another look. Every hole is on the [map](/map).",
  },
  {
    id: "what-data",
    q: "What data does CoreFlagging use?",
    a: "HyLogger scans from the National Virtual Core Library. A HyLogger records a spectrum about every centimetre of core: the visible to short-wave infrared (0.4–2.5 µm) picks up iron oxides, clays, micas, chlorite, carbonates and talc, and the thermal infrared (6–14.5 µm) picks up quartz and feldspar. The scans are cleaned the same way for every hole and averaged over 10 cm intervals. The tray photographs from the Geological Survey of Western Australia are shown beside them.",
  },
  {
    id: "coverage",
    q: "Which drillholes and States does CoreFlagging cover?",
    a: "Every State's core library in the National Virtual Core Library, about 6,600 holes in all: 1,898 in Western Australia, 1,833 in South Australia, 1,269 in New South Wales, 562 in the Northern Territory, 540 in Queensland, 496 in Tasmania, 29 in Victoria and 5 from CSIRO. Every hole is read the same way, but the results have been checked against logs and chemistry in Western Australia only.",
  },
  {
    id: "how-does-hyformer-work",
    q: "How does the HyFormer model work?",
    a: "HyFormer is trained on millions of 10 cm intervals without labels. In each training example part of the scan is hidden (a run of depth across both sensors, one whole sensor, or a band of wavelengths) and the model has to rebuild it, which teaches it how minerals go together and how they change down a hole. It then turns each interval into a representation that is reused for several tasks without training a new model. Logs and assays are kept for scoring only; the rock classifier alone is fine-tuned on the training holes' logs.",
  },
  {
    id: "what-does-it-find",
    q: "What does CoreFlagging tell me about a drillhole?",
    a: "For every hole it classifies each 10 cm into one of 12 rock classes, from ultramafic to regolith, and flags the metres that stand out from the core around them, the metres most worth assaying. It draws domain boundaries where the rock changes, from the spectra alone, and estimates the thermal infrared for older scans that only measured the short-wave infrared. It also finds core like a chosen interval or hole, nearby or across the State, by similarity in HyFormer's representation rather than in the logs.",
  },
  {
    id: "accuracy",
    q: "How accurate is CoreFlagging?",
    a: "Checked against gold assays on 105 holes, its unusual-metre score picks out gold-bearing metres better than the best conventional method: 0.75 against 0.64, where 0.5 is a coin toss. Its rock classification is right 58% of the time on 26 holes it had never seen, against 44% for always guessing the commonest class. Its domain boundaries land within a metre of the geologist's more often than any conventional method (0.45 against 0.39), and its thermal-infrared estimates beat the best conventional method on all 10 test sets. These numbers are from the model's first version, measured in Western Australia.",
  },
  {
    id: "gold-and-grade",
    q: "Can CoreFlagging find gold or estimate grade?",
    a: "It points at the metres worth assaying; it gives no grade and replaces no assay. In hole EMSD1138, about 1,000 m long with 13 gold-bearing metres, 100 metres picked at random would turn up about one gold metre, while the 100 metres the model ranks most unusual turn up four. Same assay budget, four times the chance of hitting gold.",
  },
  {
    id: "limits",
    q: "Can I rely on CoreFlagging's results?",
    a: "Read them with care: it is a second opinion, not a replacement, and the decision stays with the geologist, the tray photograph and the core itself. It has been checked in Western Australia only; holes from other States are read the same way, but nobody has checked those results yet. It is sometimes wrong: some intervals it calls ultramafic turn out to be basalt by their chemistry, and in weathered core the clays hide the rock they came from. It is a first version, and the model and its results will keep being updated.",
  },
  {
    id: "is-it-free",
    q: "Is CoreFlagging free, and do I need an account?",
    a: `Yes, it is free to use, as part of a research platform in beta run by The University of Western Australia. Browsing holes on the [map](/map) needs no account. Signing in, through the Geo Research Platform, is needed to upload your own scan and to use the assistant; the [terms of use](${PLATFORM_SITE}/terms) cover CoreFlagging.`,
  },
  {
    id: "upload",
    q: "How do I upload my own HyLogger scan?",
    a: "Sign in, open the [map](/map) and choose Upload a scan, then upload one .zip of the hole's TSG files as The Spectral Geologist saves them or as NVCL packages them: NAME_tsg.tsg and NAME_tsg.bip, plus NAME_tsg_tir.tsg and its .bip if thermal infrared was scanned. Tray photographs are optional, and no assays, logging or thermal infrared are needed. Chips and cuttings are not supported, because the models were trained on continuous core.",
  },
  {
    id: "report",
    q: "Can I download a report for a drillhole?",
    a: "Yes. Every hole has a PDF report with the data-quality problems found in the scan, the intervals that stand out and why, the metres most worth assaying, the rock classification down the hole and the domain boundaries. The data-quality problems also download as a CSV file, so the relevant parties can review them. Open any hole on the [map](/map) to get its report.",
  },
  {
    id: "licence",
    q: "Where does the data come from, and what licence does it have?",
    a: `The core scans come from the AuScope National Virtual Core Library, and the tray photographs from the Geological Survey of Western Australia are published under CC BY 4.0. What CoreFlagging shows comes from the Geo Research Platform's public API, documented at [platform.nlp-tlp.org/api/docs](https://platform.nlp-tlp.org/api/docs/). The [HyLogger core scans](${PLATFORM_SITE}/data/hylogger-core-scans) page in the platform's data library gives the source, licence and citation.`,
  },
  {
    id: "who-built-it",
    q: "Who built CoreFlagging?",
    a: "CoreFlagging is built by the UWA Centre for Natural and Technical Language Processing (NLP-TLP) at The University of Western Australia, with the ARC Training Centre in Critical Resources for the Future and the Geological Survey of Western Australia. The team is Wei Liu (leader), Yihao Ding, Pascal Sun, Daniel Su and Yiran (Grant) Zhang. It runs on the [Geo Research Platform](https://geo.nlp-tlp.org).",
  },
];

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/** An answer as text and links, in order, for the page to render. */
export function answerParts(a: string): ({ text: string } | { text: string; href: string })[] {
  const parts: ({ text: string } | { text: string; href: string })[] = [];
  let at = 0;
  for (const m of a.matchAll(LINK)) {
    if (m.index > at) parts.push({ text: a.slice(at, m.index) });
    parts.push({ text: m[1], href: m[2] });
    at = m.index + m[0].length;
  }
  if (at < a.length) parts.push({ text: a.slice(at) });
  return parts;
}

/** An answer as the visitor reads it, without the link markup. */
export const answerText = (a: string) => a.replace(LINK, "$1");

/** FAQPage + BreadcrumbList for /faq; the text is the visible text, word for word. */
export const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/faq#faq`,
      url: `${SITE_URL}/faq`,
      name: `${SITE_NAME} FAQ`,
      inLanguage: "en-AU",
      isPartOf: { "@id": `${SITE_URL}/#site` },
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: answerText(f.a) },
      })),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "FAQ", item: `${SITE_URL}/faq` },
      ],
    },
  ],
};
