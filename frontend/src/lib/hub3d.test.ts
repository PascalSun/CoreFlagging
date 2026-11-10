import { describe, expect, test } from "bun:test";
import { hub3DFor, hub3DUrl, stateOfKey } from "./hub3d";

describe("hub 3D link", () => {
  test("point, radius and view", () => {
    expect(hub3DUrl(121.5584, -26.7914, 2)).toBe("https://geo.nlp-tlp.org/map?pick=121.55840,-26.79140&r=2&view=3d");
    expect(hub3DUrl(121, -26, 50)).toContain("&r=10&");
    expect(hub3DUrl(121, -26, 0)).toContain("&r=2&");
    expect(hub3DUrl(121, -26, 0.1)).toContain("&r=0.5&");
  });
  test("only where the hub holds more", () => {
    expect(hub3DFor({ lon: 121, lat: -26, state: "WA" })).toContain("pick=121.00000,-26.00000&r=2");
    expect(hub3DFor({ lon: 121, lat: -26, state: "" }, 5)).toContain("&r=5&");
    expect(hub3DFor({ lon: 138, lat: -30, state: "SA" })).toBeNull();
    expect(hub3DFor({ lon: null, lat: -30, state: "WA" })).toBeNull();
  });
  test("State from the key", () => {
    expect([stateOfKey("SA-18189_BD1"), stateOfKey("MFED220"), stateOfKey("G50-22-001E"), stateOfKey(null), stateOfKey("NSW-DDH2 - Melrose")]).toEqual(["SA", "WA", "WA", "WA", "NSW"]);
  });
});
