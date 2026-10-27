"use client";

import { useEffect, useRef } from "react";
import type { HoleRow } from "@/lib/coreScan";
import { ICON_PIXEL_RATIO, drawIcon, iconId, type Shape } from "@/components/coretrace/shapes";


const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
export type Basemap = "satellite" | "map";
const STYLES: Record<Basemap, string> = { satellite: "mapbox://styles/mapbox/satellite-streets-v12", map: "mapbox://styles/mapbox/outdoors-v12" };
// a thumbnail of each basemap (the goldfields round Kalgoorlie), from the Static Images API, for the layers menu
const thumb = (style: string) => `https://api.mapbox.com/styles/v1/mapbox/${style}/static/121.45,-30.75,7.2,0/184x128@2x?attribution=false&logo=false&access_token=${TOKEN}`;
export const BASEMAPS: { id: Basemap; label: string; thumb: string }[] = [
  { id: "satellite", label: "Satellite", thumb: thumb("satellite-streets-v12") }, { id: "map", label: "Terrain", thumb: thumb("outdoors-v12") },
];

/* eslint-disable @typescript-eslint/no-explicit-any */

type Look = { color: string; label: string; wait?: boolean; shape?: Shape; shapeLabel?: string; glyph?: string; hatched?: boolean; small?: boolean };
const BADGE_FROM = 6;      // zoom from which a mark with letters is drawn as a badge; further out it is a dot like the rest
// the furthest the map zooms out: the scale bar at about 300 km (Australia's breadth fills a wide screen)
const MIN_ZOOM = 4.5;
/** The furthest zoom for a map this wide: Australia's width (about 44° of longitude) fits it, never further out than
 * MIN_ZOOM's view on a desktop. On a phone that is about 2.7, and the bounds then leave room above and below. */
const homeZoom = (w: number) => Math.min(MIN_ZOOM, Math.log2((w * 360) / (512 * 44)));
const HOME: [number, number] = [134, -27];

// the rarer marks draw over the common ones, so a raw scan is not buried under the circles around it
const RANK: Record<Shape, number> = { circle: 1, square: 2, diamond: 3, triangle: 4 };

/** What the zoom buttons outside the map call. */
export type MapApi = { zoomIn: () => void; zoomOut: () => void };

function features(holes: HoleRow[], colour: (h: HoleRow) => Look) {
  const placed = holes.filter((h) => h.lon !== null && h.lat !== null && h.status === "ready");
  return {
    type: "FeatureCollection" as const,
    features: placed.map((h) => {
      const { color, label, wait, shape = "circle", shapeLabel, glyph, hatched, small } = colour(h);
      const edge = h.mine ? "#111111" : "rgba(255,255,255,0.9)", w = h.mine ? 1.6 : 1;
      return {
        type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [h.lon as number, h.lat as number] },
        properties: { key: h.key, name: h.name, mine: h.mine ? 1 : 0, issues: h.n_issues, color, cls: [label, shapeLabel].filter(Boolean).join(" · "),
          wait: wait ? 1 : 0, z: small ? 0 : RANK[shape], shape, glyph: glyph ?? "", hatch: hatched ? 1 : 0, small: small ? 1 : 0,
          icon: iconId(shape, color, edge, w, "", !!hatched), badge: glyph ? iconId(shape, color, edge, w, glyph, !!hatched) : "" },
      };
    }),
  };
}

/** The holes still waiting, as their own small source. */
function waiting(holes: HoleRow[]) {
  return { type: "FeatureCollection" as const, features: holes.filter((h) => h.lon !== null && h.lat !== null && h.status !== "ready").map((h) => ({
    type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [h.lon as number, h.lat as number] }, properties: { key: h.key, name: h.name, wait: 1 } })) };
}

/** A circle of `km` around a point, as a polygon (geodesic enough at these sizes). */
function ring(lon: number, lat: number, km: number) {
  const pts: [number, number][] = []; const dLat = km / 110.574, dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 72; i++) { const a = (i / 72) * 2 * Math.PI; pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
  return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: {} }] };
}

/** The map of scanned holes, on satellite imagery or a terrain map; each hole has a white edge so its colour reads on any ground. A point is a hole; clicking one selects it. */
/** fitBounds without the padding staying behind: mapbox keeps a camera's padding after the move, and maxBounds is then
 * held against the padded view, which pinned the map to one side. The padding only places the bounds; the move itself
 * is a plain centre and zoom. */
function fit(map: mapboxgl.Map, bounds: mapboxgl.LngLatBoundsLike, opts: { padding: number | mapboxgl.PaddingOptions; maxZoom?: number; duration: number }) {
  // maxZoom only when given: an undefined one turns the zoom to NaN and no camera comes back
  const cam = map.cameraForBounds(bounds, opts.maxZoom === undefined ? { padding: opts.padding } : { padding: opts.padding, maxZoom: opts.maxZoom });
  if (!cam) return;
  // cameraForBounds centres on the bounds whatever the padding; uneven padding moves them off the middle by half the difference
  const p = typeof opts.padding === "number" ? { top: 0, bottom: 0, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0, ...opts.padding };
  map.easeTo({ center: cam.center, zoom: cam.zoom, offset: [(p.left - p.right) / 2, (p.top - p.bottom) / 2], duration: opts.duration });
}

export function CoreMap({ holes, colour, card, selected, onSelect, padRight, padLeft = 0, padBottom = 0, fitTo, basemap = "satellite", ringKm = null, apiRef }: {
  holes: HoleRow[]; selected: HoleRow | null; onSelect: (key: string | null) => void; padRight: number;
  /** room taken at the left by the map key: the scale bar sits just right of it */
  padLeft?: number;
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
  /** filled with the map's zoom calls, for buttons drawn outside the map */
  apiRef?: React.MutableRefObject<MapApi | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const readyRef = useRef(false);
  const holesRef = useRef(holes); const fitted = useRef(false); const colourRef = useRef(colour); const cardRef = useRef(card);
  useEffect(() => { cardRef.current = card; }, [card]);
  const basemapRef = useRef(basemap); const pickedRef = useRef<any>({ type: "FeatureCollection", features: [] }); const ringRef = useRef<any>({ type: "FeatureCollection", features: [] });
  useEffect(() => {
    if (basemapRef.current === basemap) return;
    basemapRef.current = basemap; const map = mapRef.current;
    if (map && readyRef.current) map.setStyle(STYLES[basemap]);
  }, [basemap]);
  const selectRef = useRef(onSelect);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  // the scale bar (Mapbox's bottom-left corner) moves out from under the key
  const padLeftRef = useRef(padLeft);
  useEffect(() => {
    padLeftRef.current = padLeft;
    const corner = mapRef.current?.getContainer().querySelector(".mapboxgl-ctrl-bottom-left") as HTMLElement | null;
    if (corner) corner.style.left = `${padLeft}px`;
  }, [padLeft]);

  useEffect(() => {
    let map: any; let gone = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (gone || !ref.current) return;
      mapboxgl.accessToken = TOKEN;
      const z0 = homeZoom(ref.current.clientWidth), narrow = z0 < MIN_ZOOM;
      map = new mapboxgl.Map({ container: ref.current, style: STYLES[basemapRef.current], center: HOME, zoom: z0, minZoom: z0, maxBounds: narrow ? [[88, -72], [180, 14]] : [[100, -46], [160, -7]], fadeDuration: 0,
        // flat at every zoom: Mapbox v3 draws a globe below about zoom 6, and the furthest zoom (4.5) is in that range, so
        // zooming out would bend the map into a globe pinned at the edge of its bounds
        projection: "mercator" });
      mapRef.current = map;
      if (apiRef) apiRef.current = { zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut() };
      map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");
      // the map's box changes when the chat column opens or closes (the map is pushed aside, not covered): follow it
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null; ro?.observe(ref.current);
      map.once("remove", () => ro?.disconnect());
      const corner = map.getContainer().querySelector(".mapboxgl-ctrl-bottom-left") as HTMLElement | null;
      if (corner) corner.style.left = `${padLeftRef.current}px`;
      // A deep link from another app (the Geo Data Platform's "Explore in CoreFlagging"): ?lon&lat(&r km)(&bbox=w,s,e,n).
      // The map opens on that place, marked (and its radius drawn), close enough to click the holes around it.
      const q = new URLSearchParams(window.location.search);
      const aLon = Number(q.get("lon")), aLat = Number(q.get("lat")), aKm = Number(q.get("r"));
      const bbox = q.get("bbox")?.split(",").map(Number);
      const arrived = q.has("lon") && q.has("lat") && Number.isFinite(aLon) && Number.isFinite(aLat);
      const arrival: any = { type: "FeatureCollection", features: arrived ? [
        { type: "Feature", geometry: { type: "Point", coordinates: [aLon, aLat] }, properties: {} },
        ...(aKm > 0 ? ring(aLon, aLat, aKm).features : []),
      ] : [] };
      const arrive = () => {
        if (bbox && bbox.length === 4 && bbox.every(Number.isFinite)) fit(map, [[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { maxZoom: 12, duration: 0,
          padding: map.getContainer().clientWidth > 900 ? { top: 60, bottom: 60, left: padLeftRef.current + 40, right: padRight + 40 } : 24 });
        else if (arrived) map.jumpTo({ center: [aLon, aLat], zoom: Number(q.get("z")) || 10 });
      };
      const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: "ct-popup", offset: 12, maxWidth: "none" });
      // the holes' layers go on whichever basemap is showing: a change of basemap replaces the whole style, so they
      // are added again each time a style has loaded (the click and hover handlers, bound by layer id, carry over)
      const D = ["==", ["get", "small"], 1], HOV = ["boolean", ["feature-state", "hover"], false];
      // zoom outermost, the hover and small cases inside each stop
      const size = (k: number) => ["interpolate", ["linear"], ["zoom"], ...[[3, 3], [6, 4.2], [9, 6], [12, 8]].flatMap(([z, r]) => [z, ["case", HOV, r * k, D, r * 0.7, r]])];
      // mapbox-gl 3.25: a symbol layer with no paint that reads the feature state crashes a repaint made while a hole is
      // hovered (its bucket is updated with an empty list of state-dependent layers, "reading 'paint' of undefined").
      // An opacity that reads the hover state and is 1 either way gives each symbol layer one.
      const STATEFUL = { "icon-opacity": ["case", HOV, 1, 1] };
      const addLayers = () => {
        if (map.getSource("holes")) return;
        map.addSource("holes", { type: "geojson", data: features(holesRef.current, colourRef.current), promoteId: "key" });
        map.addSource("holes-waiting", { type: "geojson", data: waiting(holesRef.current), promoteId: "key" });
        map.addSource("picked", { type: "geojson", data: pickedRef.current });
        map.addSource("ring", { type: "geojson", data: ringRef.current });
        map.addLayer({ id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": "#00c4f5", "fill-opacity": 0.08 } });
        map.addLayer({ id: "ring-line", type: "line", source: "ring", paint: { "line-color": "#00c4f5", "line-width": 1.5, "line-dasharray": [2, 2] } });
        // where a deep link arrived: the place and its radius, under the holes so the holes around it stay clickable
        map.addSource("arrival", { type: "geojson", data: arrival });
        // the platform's circle (a tinted fill, a solid orange edge), with a white casing so it reads on red ground
        const AREA = ["==", ["geometry-type"], "Polygon"];
        map.addLayer({ id: "arrival-fill", type: "fill", source: "arrival", filter: AREA, paint: { "fill-color": "#D9772B", "fill-opacity": 0.14 } });
        map.addLayer({ id: "arrival-casing", type: "line", source: "arrival", filter: AREA, paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.85 } });
        map.addLayer({ id: "arrival-area", type: "line", source: "arrival", filter: AREA, paint: { "line-color": "#D9772B", "line-width": 2.5 } });
        map.addLayer({ id: "arrival-pt", type: "circle", source: "arrival", filter: ["==", ["geometry-type"], "Point"], paint: {
          "circle-radius": 6, "circle-color": "#D9772B", "circle-stroke-width": 2.5, "circle-stroke-color": "#ffffff" } });
        // holes still waiting are faint pinpricks underneath; every processed hole is a coloured mark with a fine
        // white edge, lifted off the imagery by a soft dark halo, that grows under the pointer
        map.addLayer({ id: "holes-wait", type: "circle", source: "holes-waiting", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.2, 6, 2, 9, 3, 12, 4.5], "circle-color": "#f8fafc", "circle-opacity": 0.45 } });
        map.addLayer({ id: "holes-halo", type: "circle", source: "holes", filter: ["==", ["get", "small"], 0], paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 5, 6, 6.5, 9, 9, 12, 12], "circle-color": "#020617", "circle-blur": 0.9, "circle-opacity": 0.4 } });
        // a mark with letters is a dot (or its drawn shape, or its hatched dot) until BADGE_FROM, a badge from there on;
        // a mark without letters (target unknown) is a small pale dot at every zoom
        const G = ["!=", ["get", "glyph"], ""], PLAIN = ["all", ["==", ["get", "shape"], "circle"], ["==", ["get", "hatch"], 0]];
        map.addLayer({ id: "holes-badge", type: "symbol", source: "holes", minzoom: BADGE_FROM, filter: G, layout: {
          "icon-image": ["get", "badge"], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "z"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 5.5, 0.6, 8, 0.78, 11, 0.95, 14, 1.15] }, paint: STATEFUL });
        map.addLayer({ id: "holes-pt", type: "circle", source: "holes", maxzoom: BADGE_FROM, filter: ["all", G, PLAIN],
          layout: { "circle-sort-key": ["get", "z"] }, paint: {
            "circle-radius": size(1.45), "circle-color": ["get", "color"],
            "circle-stroke-width": ["case", ["==", ["get", "mine"], 1], 1.8, 1], "circle-stroke-color": ["case", ["==", ["get", "mine"], 1], "#111111", "#ffffff"], "circle-stroke-opacity": 0.9 } });
        map.addLayer({ id: "holes-sym-far", type: "symbol", source: "holes", maxzoom: BADGE_FROM, filter: ["all", G, ["!", PLAIN]], layout: {
          "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "z"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.72, 6, 0.95] }, paint: STATEFUL });
        map.addLayer({ id: "holes-pt-plain", type: "circle", source: "holes", filter: ["all", ["!", G], ["==", ["get", "shape"], "circle"]],
          layout: { "circle-sort-key": ["get", "z"] }, paint: {
            "circle-radius": size(1.45), "circle-color": ["get", "color"], "circle-opacity": ["case", D, 0.85, 1],
            "circle-stroke-width": ["case", ["==", ["get", "mine"], 1], 1.8, 1], "circle-stroke-color": ["case", ["==", ["get", "mine"], 1], "#111111", "#ffffff"],
            "circle-stroke-opacity": 0.9, "circle-radius-transition": { duration: 120 } } });
        map.addLayer({ id: "holes-sym", type: "symbol", source: "holes", filter: ["all", ["!", G], ["!=", ["get", "shape"], "circle"]], layout: {
          "icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "z"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 6, 0.8, 9, 1.1, 12, 1.4] }, paint: STATEFUL });
        map.addLayer({ id: "picked-ring", type: "circle", source: "picked", paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 10, 12, 16], "circle-color": "rgba(0,196,245,0.12)", "circle-stroke-width": 2.5, "circle-stroke-color": "#00c4f5" } });
      };
      map.on("style.load", addLayers);
      // icons are drawn the first time the map asks for one: a shape in a fill colour with an edge
      map.on("styleimagemissing", (e: any) => {
        const im = drawIcon(e.id);
        if (im && !map.hasImage(e.id)) map.addImage(e.id, im, { pixelRatio: ICON_PIXEL_RATIO });
      });
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
        readyRef.current = true;
        arrive();
        // the list may have arrived between the style loading (when the source was made) and now, when the effect
        // below still saw the map as not ready: bring the source up to date
        map.getSource("holes")?.setData(features(holesRef.current, colourRef.current)); map.getSource("holes-waiting")?.setData(waiting(holesRef.current));
        map.resize();
      });
    })();
    return () => { gone = true; readyRef.current = false; map?.remove(); mapRef.current = null; if (apiRef) apiRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    holesRef.current = holes; colourRef.current = colour;
    const map = mapRef.current;
    if (map && readyRef.current) { map.getSource("holes")?.setData(features(holes, colour)); map.getSource("holes-waiting")?.setData(waiting(holes)); }
  }, [holes, colour]);

  useEffect(() => {
    const map = mapRef.current; if (!map || fitTo === undefined) return;
    if (!fitted.current) { fitted.current = true; if (!fitTo) return; }        // the first view is the default one
    const apply = () => {
      const wide = map.getContainer().clientWidth > 900;
      const pts = holesRef.current.filter((h) => h.lon !== null && h.lat !== null && !h.offshore);
      if (!fitTo || !pts.length) { map.easeTo({ center: HOME, zoom: map.getMinZoom(), offset: [-padRight / 2, 0], duration: 900 }); return; }
      const xs = pts.map((h) => h.lon as number), ys = pts.map((h) => h.lat as number);
      fit(map, [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: wide ? { top: 60, bottom: 60, left: padLeftRef.current + 40, right: padRight + 40 } : 24, maxZoom: 8, duration: 900 });
    };
    if (readyRef.current) apply(); else map.once("load", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTo]);

  const key = selected?.key ?? null; const lon = selected?.lon ?? null; const lat = selected?.lat ?? null;
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const apply = () => {
      ringRef.current = ringKm && lon !== null && lat !== null ? ring(lon, lat, ringKm) : { type: "FeatureCollection", features: [] };
      map.getSource("ring")?.setData(ringRef.current);
      if (ringKm && lon !== null && lat !== null) {
        const dLat = ringKm / 110.574, dLon = ringKm / (111.32 * Math.cos((lat * Math.PI) / 180));
        fit(map, [[lon - dLon, lat - dLat], [lon + dLon, lat + dLat]], { padding: { right: padRight + 40, left: 40, top: 40, bottom: padBottom + 40 }, duration: 700 });
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
      // close enough that the hole's neighbours are badges, and in the middle of the map the panels leave open. An offset,
      // not `padding`: mapbox keeps a camera's padding after the move, and maxBounds is then held against the padded
      // view, which pinned the map to its east half once a hole had been opened
      if (lon !== null && lat !== null) map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8.2), offset: [(padLeftRef.current - padRight) / 2, padBottom ? (60 - padBottom) / 2 : 0], duration: 900 });
    };
    if (readyRef.current) apply(); else map.once("load", apply);
  }, [key, lon, lat, padRight, padBottom]);

  // mapbox-gl makes its container position:relative, so the container takes its size from a parent
  return <div className="absolute inset-0"><div ref={ref} className="h-full w-full" /></div>;
}
