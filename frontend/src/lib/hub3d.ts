// The Geo Research Platform's 3D view of every drillhole around a point (Groundwork #677): company assays, rock
// logs, open-file collars and the scanned holes, on the hub map at geo.nlp-tlp.org. CoreFlagging stays the place
// for minerals, trays and spectra; this is the way across for the rest of what is known about the ground there.

export const HUB = "https://geo.nlp-tlp.org";
/** States whose drillhole databases the platform holds; elsewhere the hub's 3D would only repeat the scanned holes. */
export const HUB_3D_STATES = new Set(["WA"]);

/** `/map?pick=<lon>,<lat>&r=<km>&view=3d`: opens the hub on that point with its 3D drillholes tab. */
export function hub3DUrl(lon: number, lat: number, km: number): string {
  const r = Math.max(0.5, Math.min(10, km || 2));
  return `${HUB}/map?pick=${lon.toFixed(5)},${lat.toFixed(5)}&r=${+r.toFixed(2)}&view=3d`;
}

/** The link for a hole, or null where the hub has nothing more than CoreFlagging (no collar, or outside WA). */
export function hub3DFor(h: { lon: number | null; lat: number | null; state?: string | null }, km = 2): string | null {
  if (h.lon == null || h.lat == null || !HUB_3D_STATES.has((h.state || "WA").toUpperCase())) return null;
  return hub3DUrl(h.lon, h.lat, km);
}

const PREFIXED = ["NSW", "NT", "QLD", "SA", "TAS", "VIC", "CSIRO"];
/** The State a hole key belongs to: another State's NVCL key carries it as a prefix ("SA-18189_BD1"), a WA key does not. */
export function stateOfKey(key: string | null | undefined): string {
  const p = (key ?? "").split("-")[0].toUpperCase();
  return PREFIXED.includes(p) && (key ?? "").includes("-") ? p : "WA";
}
