// When the GA4 tag loads (src/lib/ga.ts, src/components/GoogleAnalytics.tsx). Run: bun test
import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { GA_MEASUREMENT_ID, gaMeasurementId, gtagInit, gtagSrc } from "./ga";

describe("gaMeasurementId", () => {
  test("production build: the committed ID", () => {
    expect(gaMeasurementId("production", undefined)).toBe(GA_MEASUREMENT_ID);
  });
  test("no analytics outside production", () => {
    for (const env of ["development", "test", undefined]) expect(gaMeasurementId(env, undefined)).toBeNull();
    expect(gaMeasurementId("development", "G-ABC123")).toBeNull();
  });
  test("the build-time override wins, and an empty one turns it off", () => {
    expect(gaMeasurementId("production", "G-ABC123")).toBe("G-ABC123");
    expect(gaMeasurementId("production", " G-ABC123 ")).toBe("G-ABC123");
    expect(gaMeasurementId("production", "")).toBeNull();
    expect(gaMeasurementId("production", "  ")).toBeNull();
  });
  test("refuses anything that is not a GA4 ID", () => {
    for (const bad of ["UA-12345-1", "G-abc", "G-", "G-ABC');alert(1)//"]) expect(gaMeasurementId("production", bad)).toBeNull();
  });
});

describe("GoogleAnalytics", () => {
  test("renders nothing without an ID (the default under test)", () => {
    expect(GoogleAnalytics({})).toBeNull();
    expect(GoogleAnalytics({ id: null })).toBeNull();
  });
  test("with an ID: gtag.js for that ID and the init snippet", () => {
    const out = GoogleAnalytics({ id: "G-ABC123" });
    expect(isValidElement(out)).toBe(true);
    const kids = (out as ReactElement<{ children: ReactNode }>).props.children as ReactElement<Record<string, unknown>>[];
    expect(kids).toHaveLength(2);
    expect(kids[0].props.src).toBe(gtagSrc("G-ABC123"));
    expect(kids[0].props.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-ABC123");
    expect(kids[1].props.children).toBe(gtagInit("G-ABC123"));
    expect(gtagInit("G-ABC123")).toContain("gtag('config', 'G-ABC123');");
    for (const k of kids) expect(k.props.strategy).toBe(kids[0].props.strategy);
  });
});
