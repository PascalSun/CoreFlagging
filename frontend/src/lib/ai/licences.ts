// What every assistant says when asked about the platform's licences (Groundwork #835). A question about the licence, copyright
// or permitted use of the platform's data is about the platform, not about what a document says: searching the
// library for it quotes a few documents' own notices and answers the wrong question. Kept word for word in Groundwork's hub
// (frontend/src/lib/ai/licences.ts, #835), GeoThought (app/licences.py), MineTrace and CoreFlagging.

export const LICENCES_URL = "https://geo.nlp-tlp.org/data/licences";

export const LICENCE_STATEMENT =
  "The platform's data comes from public sources. Survey data and maps are mostly under Creative Commons Attribution " +
  "(CC BY). Company exploration reports are released open-file by each State: the State makes them public, but the " +
  "copyright stays with the company that wrote them, and only some States (Queensland, South Australia) put an open " +
  "licence on the reports themselves; the others are held for research. Survey publications and published papers " +
  "carry their own licences: a paper without an open licence is searchable and quoted, but its PDF is not shared, and " +
  "the viewer links to the publisher. No language model is trained on these documents. Every document shows its " +
  `licence beside it, and the full list, with how sure each one is, is at ${LICENCES_URL}. This describes the ` +
  "platform's research use; it is not legal advice.";

export const LICENCE_RULE =
  "Questions about the licence, copyright, terms or permitted use of the platform's data, documents or papers (not " +
  "a mining or exploration licence, which is a tenement) are about the platform, not about what the documents say: " +
  `do not search for them. Answer with this statement, in the user's language, and nothing from the documents: "${LICENCE_STATEMENT}" ` +
  "When the question names one document, add that its own licence is shown beside it and that a licence shown " +
  "wrongly can be reported there (\"Wrong licence?\").";
