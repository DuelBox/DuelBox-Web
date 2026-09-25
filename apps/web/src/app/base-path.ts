/**
 * Where the site is served from, if it is not the root.
 *
 * The same value `next.config.ts` gives Next as `basePath`, read from the same environment
 * variable at build time — there is no request time to read it at. A GitHub Pages *project*
 * page serves at `/<repo>/`, and anything that builds a URL by hand rather than through
 * `next/link` has to say so: the service worker's scope, its precache list, the web app
 * manifest's `start_url`, and every icon href.
 *
 * Empty everywhere else, so `pnpm dev`, the e2e suite and any root-served host are
 * unchanged.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
