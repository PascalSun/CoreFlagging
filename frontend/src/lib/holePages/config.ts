// Which States' hole pages are published. The first release is Western Australia only: the model was checked
// against WA logs and chemistry, and the other States' pages wait for the owner's go-ahead.
// HOLE_PAGE_STATES=WA,SA,NSW,... turns more on (read on the server, at build and at request time).

export const ALL_STATES = ["WA", "SA", "NSW", "NT", "QLD", "TAS", "VIC", "CSIRO"] as const;

export const ENABLED_STATES: string[] = (process.env.HOLE_PAGE_STATES ?? "WA")
  .split(",").map((s) => s.trim().toUpperCase()).filter((s) => (ALL_STATES as readonly string[]).includes(s));

export const stateEnabled = (state: string) => ENABLED_STATES.includes(state.toUpperCase());

/** A day: pages and the index they are built from are regenerated at most this often. */
export const REVALIDATE_S = 86400;
/** URLs per hole sitemap. */
export const SITEMAP_CHUNK = 2000;
