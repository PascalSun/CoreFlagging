// Base URL for hero IMAGE assets (magnetics/terrain renders + the Au prospectivity heatmap).
// Defaults to the local `/hero` path (works for anyone who has the files in public/hero).
// Production sets NEXT_PUBLIC_HERO_IMG_BASE to the S3 bucket so these images live OFF-repo —
// they are third-party geophysics (GSWA/DMIRS) / MineTrace-model derivatives and are kept out
// of the open-source tree. hero_geo.json is NOT an image (projection geometry, no licence) and
// stays under /hero in the repo, so it is intentionally not routed through this base.
export const HERO_IMG_BASE = process.env.NEXT_PUBLIC_HERO_IMG_BASE || "/hero";
