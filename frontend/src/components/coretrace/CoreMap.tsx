"use client";

import { useEffect, useRef } from "react";
import type { HoleRow } from "@/lib/coreScan";
import { ICON_PIXEL_RATIO, drawIcon, iconId, type Shape } from "@/components/coretrace/shapes";
import { PLATFORM_URL } from "@ntlp/geodata-web/fetch";

/** Context layers from the platform's tiles (DMIRS interim data): drawn under the holes, each toggled on its own. */
export type Overlay = "open_pits" | "officer_copper";
export const OVERLAYS: { id: Overlay; label: string; hint: string; color: string }[] = [
  { id: "open_pits", label: "Open pit lakes", hint: "921 open pits seen in 2023–24 imagery, by how full they were (DMIRS interim data).", color: "#0284c7" },
  { id: "officer_copper", label: "Officer Basin copper samples", hint: "169 core samples from the Officer Basin sediment-hosted copper study, coloured by Cu ppm (DMIRS interim data).", color: "#c2410c" },
];
const tilesUrl = (layer: string) => `${PLATFORM_URL}/geo/api/tiles/${layer}/{z}/{x}/{y}`;

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
export type Basemap = "satellite" | "map";
const STYLES: Record<Basemap, string> = { satellite: "mapbox://styles/mapbox/satellite-streets-v12", map: "mapbox://styles/mapbox/outdoors-v12" };

/* eslint-disable @typescript-eslint/no-explicit-any */

type Look = { color: string; label: string; ring?: string; wait?: boolean; dim?: boolean; shape?: Shape; shapeLabel?: string; glyph?: string };
const BADGE_FROM = 5.5;      // zoom from which a mark with letters is drawn as a badge; further out it is a dot like the rest

// the rarer marks draw over the common ones, so a gold triangle is not buried under the circles around it
const RANK: Record<Shape, number> = { circle: 1, square: 2, diamond: 3, triangle: 4 };

function features(holes: HoleRow[], colour: (h: HoleRow) => Look) {
  return {
    type: "FeatureCollection" as const,
    features: holes.filter((h) => h.lon !== null && h.lat !== null).map((h) => ({
      type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [h.lon as number, h.lat as number] },
      properties: { key: h.key, name: h.name, mine: h.mine ? 1 : 0, ready: h.status === "ready" ? 1 : 0, issues: h.n_issues, ...(({ color, label, ring, wait, dim, shape, shapeLabel, glyph }) => ({
        color, cls: [label, shapeLabel].filter(Boolean).join(" · "), ring: ring ?? "", wait: wait ? 1 : 0, dim: dim ? 1 : 0, z: dim ? 0 : RANK[shape ?? "circle"], shape: shape ?? "circle", glyph: glyph ?? "",
        icon: iconId(shape ?? "circle", ring ? "#ffffff" : color, h.mine ? "#111111" : ring ?? "rgba(255,255,255,0.9)", ring || h.mine ? 1.6 : 1),
        badge: glyph ? iconId(shape ?? "circle", ring ? "#ffffff" : color, h.mine ? "#111111" : ring ?? "rgba(255,255,255,0.9)", ring || h.mine ? 1.6 : 1, glyph) : "" }))(colour(h)) },
    })),
  };
}

/** The map of scanned holes, on satellite imagery or a terrain map; each hole has a white edge so its colour reads on any ground. A point is a hole; clicking one selects it. */
/** A circle of `km` around a point, as a polygon (geodesic enough at these sizes). */
function ring(lon: number, lat: number, km: number) {
  const pts: [number, number][] = []; const dLat = km / 110.574, dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 72; i++) { const a = (i / 72) * 2 * Math.PI; pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: {} }] };
}

export function CoreMap({ holes, colour, card, selected, onSelect, padRight, padBottom = 0, fitTo, basemap = "satellite", ringKm = null, overlays = {} }: {
  holes: HoleRow[]; selected: HoleRow | null; onSelect: (key: string | null) => void; padRight: number;
  /** which context layers are shown */
  overlays?: Partial<Record<Overlay, boolean>>;
  /** a ring of this many km around the selected hole (its neighbours), or none */
  ringKm?: number | null;
  /** room taken at the foot by a bottom sheet: the selected hole is framed above it */
  padBottom?: number;
  /** the colour of each point (what the map is coloured by) */
  colour: (h: HoleRow) => Look;
  /** the card shown on a hole under the pointer */
  card?: (h: HoleRow) => HTMLElement;
  /** changes when the reader picks a State: the map then frames the holes it is given */
  fitTo?: string;
  basemap?: Basemap;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const readyRef = useRef(false);
  const holesRef = useRef(holes); const fitted = useRef(false); const colourRef = useRef(colour); const cardRef = useRef(card);
  useEffect(() => { cardRef.current = card; }, [card]);
  const overlaysRef = useRef(overlays);
  useEffect(() => {
    overlaysRef.current = overlays; const map = mapRef.current; if (!map || !readyRef.current) return;
    for (const o of OVERLAYS) if (map.getLayer(`ov-${o.id}`)) map.setLayoutProperty(`ov-${o.id}`, "visibility", overlays[o.id] ? "visible" : "none");
  }, [overlays]);
  const basemapRef = useRef(basemap); const pickedRef = useRef<any>({ type: "FeatureCollection", features: [] }); const ringRef = useRef<any>({ type: "FeatureCollection", features: [] });
  useEffect(() => {
    if (basemapRef.current === basemap) return;
    basemapRef.current = basemap; const map = mapRef.current;
    if (map && readyRef.current) map.setStyle(STYLES[basemap]);
  }, [basemap]);
  const selectRef = useRef(onSelect);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    let map: any; let gone = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (gone || !ref.current) return;
      mapboxgl.accessToken = TOKEN;
      map = new mapboxgl.Map({ container: ref.current, style: STYLES[basemapRef.current], center: [134, -27], zoom: 3.5, maxBounds: [[100, -46], [160, -7]], fadeDuration: 0 });
      mapRef.current = map;
      // zoom buttons on a wide screen only: a phone pinches, and the legend needs the corner
      if (window.innerWidth >= 640) map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-left");
      map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");
      const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "ct-popup", offset: 12, maxWidth: "none" });
      // the holes' layers go on whichever basemap is showing: a change of basemap replaces the whole style, so they
      // are added again each time a style has loaded (the click and hover handlers, bound by layer id, carry over)
      const addLayers = () => {
        if (map.getSource("holes")) return;
          map.addSource("holes", { type: "geojson", data: features(holesRef.current, colourRef.current), promoteId: "key" });
          map.addSource("picked", { type: "geojson", data: pickedRef.current });
          // context layers under the holes: hidden until toggled, so they cost nothing by default
          map.addSource("open_pits", { type: "vector", tiles: [tilesUrl("open_pits")], minzoom: 4, maxzoom: 14, attribution: "Interim data © Gov of WA (DMIRS, CC BY 4.0)" });
          map.addLayer({ id: "ov-open_pits", type: "circle", source: "open_pits", "source-layer": "open_pits", layout: { visibility: overlaysRef.current.open_pits ? "visible" : "none" }, paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 9, 5.5, 12, 8], "circle-color": "#ffffff", "circle-opacity": 0.15,
            "circle-stroke-width": 2, "circle-stroke-color": ["match", ["get", "pitfillamt"], "full", "#0284c7", "partial", "#38bdf8", "dry", "#a8a29e", "#0284c7"] } });
          map.addSource("officer_copper", { type: "vector", tiles: [tilesUrl("officer_copper")], minzoom: 4, maxzoom: 14, attribution: "Interim data © Gov of WA (DMIRS, CC BY 4.0)" });
          map.addLayer({ id: "ov-officer_copper", type: "circle", source: "officer_copper", "source-layer": "officer_copper", layout: { visibility: overlaysRef.current.officer_copper ? "visible" : "none" }, paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 9, 5.5, 12, 8],
            "circle-color": ["step", ["coalesce", ["get", "cu_ppm"], 0], "#fdba74", 100, "#f97316", 1000, "#c2410c", 10000, "#7c2d12"],
            "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" } });
          map.addSource("ring", { type: "geojson", data: ringRef.current });
          map.addLayer({ id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": "#00c4f5", "fill-opacity": 0.08 } });
          map.addLayer({ id: "ring-line", type: "line", source: "ring", paint: { "line-color": "#00c4f5", "line-width": 1.5, "line-dasharray": [2, 2] } });
          // holes still waiting are small grey dots underneath; every processed hole is a coloured shape with a thin
          // white edge (so every colour reads on the satellite ground); a class picked in the legend leaves the rest faint
          // markers: a small coloured dot with a fine white edge, lifted off the imagery by a soft dark halo; a dot grows
          // under the pointer. Holes still waiting are faint pinpricks underneath. A class picked in the legend leaves
          // the rest faint. (Zoom must be the outer expression in Mapbox.)
          const D = ["==", ["get", "dim"], 1], R = ["!=", ["get", "ring"], ""], HOV = ["boolean", ["feature-state", "hover"], false];
          // zoom outermost, the hover case inside each stop
          const size = (k: number) => ["interpolate", ["linear"], ["zoom"], ...[[3, 3], [6, 4.2], [9, 6], [12, 8]].flatMap(([z, r]) => [z, ["case", HOV, r * k, r]])];
          map.addLayer({ id: "holes-wait", type: "circle", source: "holes", filter: ["==", ["get", "wait"], 1], paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.2, 6, 2, 9, 3, 12, 4.5],
            "circle-color": "#f8fafc", "circle-opacity": ["case", D, 0.1, 0.45] } });
          map.addLayer({ id: "holes-halo", type: "circle", source: "holes", filter: ["==", ["get", "wait"], 0], paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 6, 6.5, 9, 9, 12, 12],
            "circle-color": "#020617", "circle-blur": 0.9, "circle-opacity": ["case", D, 0.03, 0.4] } });
          // a mark with letters is a dot or its shape until BADGE_FROM, a badge from there on
          const G = ["!=", ["get", "glyph"], ""];
          map.addLayer({ id: "holes-badge", type: "symbol", source: "holes", minzoom: BADGE_FROM, filter: ["all", ["==", ["get", "wait"], 0], G], layout: {
            "icon-image": ["get", "badge"], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "z"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 5.5, 0.62, 8, 0.8, 11, 1, 14, 1.2] },
            paint: { "icon-opacity": ["case", D, 0.12, 1] } });
          map.addLayer({ id: "holes-pt", type: "circle", source: "holes", maxzoom: BADGE_FROM, filter: ["all", ["==", ["get", "wait"], 0], G, ["==", ["get", "shape"], "circle"]],
            layout: { "circle-sort-key": ["get", "z"] }, paint: {
              "circle-radius": size(1.45), "circle-color": ["case", R, "#ffffff", ["get", "color"]], "circle-opacity": ["case", D, 0.12, 1],
              "circle-stroke-width": ["case", R, 1.6, ["==", ["get", "mine"], 1], 1.8, 1], "circle-stroke-color": ["case", ["==", ["get", "mine"], 1], "#111111", R, ["get", "ring"], "#ffffff"],
              "circle-stroke-opacity": ["case", D, 0.08, R, 1, 0.9] } });
          map.addLayer({ id: "holes-sym-far", type: "symbol", source: "holes", maxzoom: BADGE_FROM, filter: ["all", ["==", ["get", "wait"], 0], G, ["!=", ["get", "shape"], "circle"]], layout: {
            "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "z"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.72, 6, 0.95] }, paint: { "icon-opacity": ["case", D, 0.12, 1] } });
          map.addLayer({ id: "holes-pt-plain", type: "circle", source: "holes", filter: ["all", ["==", ["get", "wait"], 0], ["==", ["get", "glyph"], ""], ["==", ["get", "shape"], "circle"]],
            layout: { "circle-sort-key": ["get", "z"] }, paint: {
              "circle-radius": size(1.45),
              "circle-color": ["case", R, "#ffffff", ["get", "color"]],
              "circle-opacity": ["case", D, 0.12, 1],
              "circle-stroke-width": ["case", R, 1.6, ["==", ["get", "mine"], 1], 1.8, 1],
              "circle-stroke-color": ["case", ["==", ["get", "mine"], 1], "#111111", R, ["get", "ring"], "#ffffff"],
              "circle-stroke-opacity": ["case", D, 0.08, R, 1, 0.9],
              "circle-radius-transition": { duration: 120 } } });
          map.addLayer({ id: "holes-sym", type: "symbol", source: "holes", filter: ["all", ["==", ["get", "wait"], 0], ["==", ["get", "glyph"], ""], ["!=", ["get", "shape"], "circle"]], layout: {
            "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "z"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.72, 6, 0.95, 9, 1.3, 12, 1.7] },
            paint: { "icon-opacity": ["case", D, 0.12, 1] } });
          map.addLayer({ id: "picked-ring", type: "circle", source: "picked", paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 10, 12, 16], "circle-color": "rgba(0,196,245,0.12)", "circle-stroke-width": 2.5, "circle-stroke-color": "#00c4f5" } });
      };
      map.on("style.load", addLayers);
      // icons are drawn the first time the map asks for one: a shape in a fill colour with an edge
      map.on("styleimagemissing", (e: any) => { const im = drawIcon(e.id); if (im && !map.hasImage(e.id)) map.addImage(e.id, im, { pixelRatio: ICON_PIXEL_RATIO }); });
      map.on("load", () => {
        addLayers();
        let hovered: string | null = null;
        const hover = (k: string | null) => {
          if (hovered) map.setFeatureState({ source: "holes", id: hovered }, { hover: false });
          hovered = k; if (k) map.setFeatureState({ source: "holes", id: k }, { hover: true });
        };
        const LAYERS = ["holes-badge", "holes-sym", "holes-sym-far", "holes-pt", "holes-pt-plain", "holes-wait"];
        map.on("click", LAYERS, (e: any) => { const k = e.features?.[0]?.properties?.key; if (k) selectRef.current(k); });
        map.on("mouseenter", LAYERS, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mousemove", LAYERS, (e: any) => {
          const f = e.features?.[0]; if (!f) return;
          if (f.properties.key === hovered && tip.isOpen()) return;
          hover(f.properties.key);
          const h = holesRef.current.find((x) => x.key === f.properties.key);
          let el: HTMLElement;
          if (h && cardRef.current) el = cardRef.current(h);
          else { el = document.createElement("div"); el.className = "ct-card"; el.textContent = f.properties.name; }
          tip.setLngLat(f.geometry.coordinates).setDOMContent(el).addTo(map);
        });
        map.on("mouseleave", LAYERS, () => { map.getCanvas().style.cursor = ""; tip.remove(); hover(null); });
        const html = (s: string) => { const el = document.createElement("div"); el.className = "ct-card"; el.innerHTML = s; return el; };
        map.on("mousemove", "ov-open_pits", (e: any) => {
          const p = e.features?.[0]?.properties; if (!p) return;
          const d = String(p.imagedate ?? ""); const when = d.length === 8 ? `${d.slice(6)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : d;
          tip.setLngLat(e.lngLat).setDOMContent(html(`<b>${p.name ?? ""}</b><br>Open pit lake · ${p.pitfillamt ?? "?"}${when ? ` · imaged ${when}` : ""}`)).addTo(map);
        });
        map.on("mouseleave", "ov-open_pits", () => tip.remove());
        map.on("mousemove", "ov-officer_copper", (e: any) => {
          const p = e.features?.[0]?.properties; if (!p) return;
          const el = ["cu", "ni", "co", "pb"].map((k) => (p[`${k}_ppm`] != null ? `${k[0].toUpperCase()}${k.slice(1)} ${Number(p[`${k}_ppm`]).toLocaleString()} ppm` : null)).filter(Boolean).join(" · ");
          tip.setLngLat(e.lngLat).setDOMContent(html(`<b>${p.holeid ?? ""}</b> ${p.from_m != null ? `${Number(p.from_m).toFixed(1)}–${Number(p.to_m).toFixed(1)} m` : ""}<br>${[p.lithology, p.rock_type].filter(Boolean).join(" · ")}${el ? `<br>${el}` : ""}`)).addTo(map);
        });
        map.on("mouseleave", "ov-officer_copper", () => tip.remove());
        readyRef.current = true;
        map.resize();
      });
    })();
    return () => { gone = true; readyRef.current = false; map?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    holesRef.current = holes; colourRef.current = colour;
    const map = mapRef.current;
    if (map && readyRef.current) map.getSource("holes")?.setData(features(holes, colour));
  }, [holes, colour]);

  useEffect(() => {
    const map = mapRef.current; if (!map || fitTo === undefined) return;
    if (!fitted.current) { fitted.current = true; if (!fitTo) return; }        // the first view is the default one
    const apply = () => {
      const wide = map.getContainer().clientWidth > 900;
      const pts = holesRef.current.filter((h) => h.lon !== null && h.lat !== null && !h.offshore);
      if (!fitTo || !pts.length) { map.easeTo({ center: [134, -27], zoom: 3.5, padding: { right: padRight, left: 0, top: 0, bottom: 0 }, duration: 900 }); return; }
      const xs = pts.map((h) => h.lon as number), ys = pts.map((h) => h.lat as number);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: wide ? { top: 60, bottom: 60, left: 380, right: padRight + 40 } : 24, maxZoom: 8, duration: 900 });
    };
    if (readyRef.current) apply(); else map.once("load", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTo]);

  // A deep link from another app (the Geo Data Platform's "Explore in CoreTrace"): ?bbox=w,s,e,n
  // fits that box, else ?lon&lat(&z) flies there. Applied once, after the first view.
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const q = new URLSearchParams(window.location.search);
    const bbox = q.get("bbox")?.split(",").map(Number); const lon = Number(q.get("lon")), lat = Number(q.get("lat"));
    const go = () => {
      if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, maxZoom: 11, duration: 0 });
      else if (Number.isFinite(lon) && Number.isFinite(lat) && q.has("lon")) map.jumpTo({ center: [lon, lat], zoom: Number(q.get("z")) || 9 });
    };
    if (readyRef.current) go(); else map.once("load", go);
  }, []);

  const key = selected?.key ?? null; const lon = selected?.lon ?? null; const lat = selected?.lat ?? null;
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const apply = () => {
      ringRef.current = ringKm && lon !== null && lat !== null ? ring(lon, lat, ringKm) : { type: "FeatureCollection", features: [] };
      map.getSource("ring")?.setData(ringRef.current);
      if (ringKm && lon !== null && lat !== null) {
        const dLat = ringKm / 110.574, dLon = ringKm / (111.32 * Math.cos((lat * Math.PI) / 180));
        map.fitBounds([[lon - dLon, lat - dLat], [lon + dLon, lat + dLat]], { padding: { right: padRight + 40, left: 40, top: 40, bottom: padBottom + 40 }, duration: 700 });
      }
    };
    if (readyRef.current) apply(); else map.once("load", apply);
  }, [ringKm, lon, lat, padRight, padBottom]);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const apply = () => {
      pickedRef.current = { type: "FeatureCollection", features: lon !== null && lat !== null
        ? [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} }] : [] };
      map.getSource("picked")?.setData(pickedRef.current);
      if (lon !== null && lat !== null) map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 7.5), padding: { right: padRight, left: 0, top: padBottom ? 60 : 0, bottom: padBottom }, duration: 900 });
    };
    if (readyRef.current) apply(); else map.once("load", apply);
  }, [key, lon, lat, padRight, padBottom]);

  // mapbox-gl makes its container position:relative, so the container takes its size from a parent
  return <div className="absolute inset-0"><div ref={ref} className="h-full w-full" /></div>;
}
