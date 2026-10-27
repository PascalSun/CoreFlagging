// Who holds each State's HyLogger scans and the licence they are published under: the platform's per-State
// HyLogger licences (Groundwork backend/catalog/hylogger.py, checked 2026-10-27). WA, SA, NSW, NT and Qld are
// CC BY 4.0; Tasmania is CC BY 3.0 AU (MRT's own stated licence). Victoria is not in that list and CSIRO's
// custodian is not confirmed, so no licence is claimed for either: their pages carry no Dataset markup.

export type StateTerms = {
  id: string; name: string; survey: string; surveyUrl: string;
  licence: { name: string; url: string } | null;
  attribution: string;
};

const CC_BY = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
const CC_BY_AU3 = { name: "CC BY 3.0 AU", url: "https://creativecommons.org/licenses/by/3.0/au/" };

export const STATE_TERMS: Record<string, StateTerms> = {
  WA: { id: "WA", name: "Western Australia", survey: "Geological Survey of Western Australia", surveyUrl: "https://www.dmp.wa.gov.au/Geological-Survey/",
    licence: CC_BY, attribution: "Contains information © State of Western Australia (GSWA), used under CC BY 4.0." },
  SA: { id: "SA", name: "South Australia", survey: "Geological Survey of South Australia", surveyUrl: "https://catalog.sarig.sa.gov.au/",
    licence: CC_BY, attribution: "Contains information © Government of South Australia, Department for Energy and Mining (Geological Survey of South Australia), used under CC BY 4.0." },
  NSW: { id: "NSW", name: "New South Wales", survey: "Geological Survey of New South Wales", surveyUrl: "https://www.resources.nsw.gov.au/geological-survey",
    licence: CC_BY, attribution: "Contains information © State of New South Wales (Geological Survey of New South Wales), used under CC BY 4.0." },
  NT: { id: "NT", name: "Northern Territory", survey: "Northern Territory Geological Survey", surveyUrl: "https://geoscience.nt.gov.au/gemis/",
    licence: CC_BY, attribution: "Contains information © Northern Territory Government (Northern Territory Geological Survey), used under CC BY 4.0." },
  QLD: { id: "QLD", name: "Queensland", survey: "Geological Survey of Queensland", surveyUrl: "https://geoscience.data.qld.gov.au/",
    licence: CC_BY, attribution: "Contains information © State of Queensland (Geological Survey of Queensland), used under CC BY 4.0." },
  TAS: { id: "TAS", name: "Tasmania", survey: "Mineral Resources Tasmania", surveyUrl: "https://www.mrt.tas.gov.au/",
    licence: CC_BY_AU3, attribution: "Contains information © State of Tasmania (Mineral Resources Tasmania), used under CC BY 3.0 AU." },
  VIC: { id: "VIC", name: "Victoria", survey: "Geological Survey of Victoria", surveyUrl: "https://earthresources.vic.gov.au/geology-exploration",
    licence: null, attribution: "HyLogger scan from the Geological Survey of Victoria's core library; its licence is not confirmed." },
  CSIRO: { id: "CSIRO", name: "CSIRO", survey: "CSIRO (AuScope National Virtual Core Library)", surveyUrl: "https://www.auscope.org.au/nvcl",
    licence: null, attribution: "HyLogger scan filed under CSIRO in the National Virtual Core Library; its custodian and licence are not confirmed." },
};

export const termsOf = (state: string): StateTerms | null => STATE_TERMS[state.toUpperCase()] ?? null;

/** Tray photographs are shown only where their licence is confirmed: GSWA's (CC BY 4.0). */
export const TRAY_PHOTO_STATES = ["WA"];

export const NVCL = { name: "National Virtual Core Library (AuScope)", url: "https://www.auscope.org.au/nvcl" };
export const DASC = { name: "DMIRS HyLogger drillhole package (GSWA Data and Software Centre, interim data)", url: "https://dasc.dmirs.wa.gov.au/", licence: CC_BY };
export const WAMEX = { name: "WAMEX, Geological Survey of Western Australia", url: "https://wamex.dmp.wa.gov.au/" };
