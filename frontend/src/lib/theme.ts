import type { Viewport } from "next";

// Day and night for the home page. The page's ground in each mode is also the browser's own bar (theme-color), so
// the top of the screen is one surface with the navbar. The tokens themselves live in globals.css (.core-theme);
// these two colours are the same `--color-paper` values, written once here for the places CSS cannot reach (the
// theme-color meta and the script that runs before the first paint).

export const THEME_STORE = "cf-theme";
export const THEME_EVENT = "cf-theme";                 // fired on window when the choice changes
export const THEME_GROUND = { light: "#f4f4f4", dark: "#0b1215" } as const;
export type ThemeChoice = "system" | "light" | "dark";

/** The viewport of a themed page (home, FAQ, the drillhole pages): night by default under either device setting, the
 * browser's bar on the page's ground; a saved day choice repaints it before paint (THEME_BOOT). */
export const THEMED_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_GROUND.dark },
    { media: "(prefers-color-scheme: dark)", color: THEME_GROUND.dark },
  ],
  colorScheme: "dark light",
};

/** Runs in <head> before the page paints: night unless a day choice is saved, as html[data-theme] (no flash of the
 * other mode), and the theme-color metas follow it. */
export const THEME_BOOT = `(function(){try{var k=${JSON.stringify(THEME_STORE)},g=${JSON.stringify(THEME_GROUND)};
var c=null;try{c=localStorage.getItem(k)}catch(e){}var d=document.documentElement;
d.setAttribute("data-theme",c==="light"?"light":"dark");
var sync=function(){var t=d.getAttribute("data-theme");document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){
if(!m.hasAttribute("data-media")){m.setAttribute("data-media",m.getAttribute("media")||"");}
if(t){m.setAttribute("content",g[t]);m.removeAttribute("media");}
else{var q=m.getAttribute("data-media");if(q){m.setAttribute("media",q);m.setAttribute("content",q.indexOf("dark")>=0?g.dark:g.light);}}});};
window.__cfThemeSync=sync;sync();document.addEventListener("DOMContentLoaded",sync);}catch(e){}})();`;

/** Apply a choice now (the toggle): html[data-theme], the theme-color metas, and the saved value. */
export function applyTheme(choice: ThemeChoice) {
  const d = document.documentElement;
  d.setAttribute("data-theme", choice === "light" ? "light" : "dark");      // night unless day is chosen
  try {
    if (choice === "light") localStorage.setItem(THEME_STORE, "light");
    else localStorage.removeItem(THEME_STORE);
  } catch { /* private mode: the choice lasts for this page only */ }
  (window as unknown as { __cfThemeSync?: () => void }).__cfThemeSync?.();
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function savedTheme(): ThemeChoice {
  try {
    const c = localStorage.getItem(THEME_STORE);
    return c === "light" ? "light" : "dark";
  } catch { return "dark"; }
}
