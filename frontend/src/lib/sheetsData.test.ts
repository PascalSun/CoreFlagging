import { describe, expect, test } from "bun:test";
import { sheetsDataError } from "./coreScan";

describe("sheetsDataError", () => {
  test("a platform without the zip export says not available yet", () => {
    const e = sheetsDataError(400, { error: "bad_format", message: "format is pdf or png." });
    expect(e.code).toBe("no_zip"); expect(e.message).toBe("Data export isn't available yet.");
  });
  test("too many readings asks for fewer intervals or no spectra", () => {
    const e = sheetsDataError(400, { error: "bad_request", message: "every reading's spectrum is capped at 20,000 readings (these intervals have 31,204)" });
    expect(e.code).toBe("too_many");
    expect(e.message).toContain("Pick fewer intervals");
    expect(e.message).toContain("include every reading");
  });
  test("other answers are plain sentences", () => {
    expect(sheetsDataError(503, {}).message).toContain("not answering");
    expect(sheetsDataError(404, { error: "no package" }).message).toContain("not available for this hole");
    expect(sheetsDataError(400, { error: "bad_intervals", message: "At most 300 intervals." }).message).toBe("At most 300 intervals.");
  });
});
