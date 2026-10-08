> Temporary copy of the platform's `@ntlp/platform-client` (Groundwork/frontend/packages/platform-client), to be replaced by the published package.

# @ntlp/platform-client

How a research app's frontend talks to the NTLP Geo Research Platform. A research app (MineTrace,
CoreTrace, the next one) is its own site with its own frontend; it reaches the platform's data only
through the platform's public API, and this package is the client side of that contract:

- `auth`: sign-in (email link, code, password), the stored session, access-token refresh, `getAuth` /
  `setAuth` / `clearAuth`, `fetchMe`, feedback.
- `fetch`: `PLATFORM_URL` and `platformFetch(path, init)`, which attaches the bearer token and refreshes
  it once on a 401. Build every API call on it.
- `chrome`: the `Chrome` type a site's navbar and footer take, and `appEntry(host)`.

The API itself is documented at `https://platform.nlp-tlp.org/api/docs/` (schema at `/api/schema/`), and
`GET /api/research-apps/` lists the apps on the platform.

## Environment

- `NEXT_PUBLIC_PLATFORM_URL`: the platform's public origin, e.g. `https://platform.nlp-tlp.org`.

## Status

Phase 1: extracted in place. The Groundwork app imports it through the tsconfig path alias
`@ntlp/platform-client` (no build step), and `src/lib/auth.ts` re-exports it so nothing else moved.
`auth.ts` still imports two app-side helpers (`@/lib/analytics`, `@/lib/landing-site`); Phase 2 makes
those injectable, gives the package a build, and publishes it to GitHub Packages so a research app in
its own repository can depend on it.
