// The error the CoreFlagging API helpers throw, and the sentence a data-export failure reads as. Kept apart from
// coreScan.ts so its tests do not pull the whole API client into the coverage count.

export class CoreError extends Error {
  status: number; code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code; }
}

/** The sentence a failed data export shows, from the platform's answer. A platform without the zip export answers
 * 400 `bad_format` ("no_zip": not available yet); the service refuses every reading's spectrum past its cap with a 400
 * that names the readings ("too_many"). */
export function sheetsDataError(status: number, b: { error?: string; message?: string; detail?: string }): CoreError {
  const why = b.message || b.detail || "";
  if (status === 400 && b.error === "bad_format") return new CoreError(400, "Data export isn't available yet.", "no_zip");
  if (status === 400 && /reading/i.test(why)) return new CoreError(400, `${why.replace(/\.?\s*$/, ".")} Pick fewer intervals, or untick \u201cinclude every reading\u2019s spectrum\u201d.`, "too_many");
  if (status === 404) return new CoreError(404, "The data is not available for this hole (no package or line scan to read).", b.error);
  if (status === 401 || status === 403) return new CoreError(status, `The platform did not allow this (${status}). Sign in if the scan is your own upload.`, b.error);
  if (status >= 500) return new CoreError(status, "The sheet service is not answering right now; try again in a minute.", b.error);
  return new CoreError(status, why || b.error || `request failed (${status})`, b.error);
}
