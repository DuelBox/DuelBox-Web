/**
 * Where the site lives, for the few places that need an address rather than a path.
 *
 * A statically exported page never knows its own origin: there is no request to read a host
 * from, and reading `location` while rendering is exactly what a static export forbids. So
 * the address arrives from the build environment, the way `basePath` does — `deploy.yml`
 * sets `NEXT_PUBLIC_SITE_URL` from the repository's owner and name, so a fork or a rename
 * still deploys with its own address baked in.
 *
 * The fallback is the GitHub Pages project URL this repository publishes to. A fallback, not
 * a guess to be corrected later: a sitemap and a set of canonical URLs that name a different
 * origin from the one serving them are worse than none, because a crawler reads them as an
 * instruction to index somebody else.
 *
 * This is a *site* URL, not an origin. A project page serves from `/<repo>/`, so the base
 * path is part of the address and every route already sits under it. `absoluteUrl` joins a
 * route to this and nothing more — adding the base path here a second time is the mistake
 * the name is meant to make hard.
 */

const FALLBACK = 'https://duelbox.github.io/DuelBox-Web';

/**
 * Normalised, so that two builds cannot disagree about one address.
 *
 * `github.repository_owner` keeps the owner's capitalisation, and a host is case-insensitive,
 * so `DuelBox.github.io` and `duelbox.github.io` are one origin — but a canonical URL that
 * spells it two ways is two URLs to a crawler. Parsing through `URL` lowercases the host and
 * leaves the path's case alone, which is what a project page needs: `/DuelBox-Web/` is served
 * with those capitals. The trailing slash comes off so that a joined route never carries two.
 *
 * A value that does not parse fails the build rather than falling back. The variable was set
 * on purpose, and quietly publishing the fallback's address in its place is the failure this
 * module exists to prevent.
 */
function siteUrlFrom(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return FALLBACK;
  const parsed = new URL(trimmed);
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

export const SITE_URL: string = siteUrlFrom(process.env.NEXT_PUBLIC_SITE_URL);

/** The full address of a site-relative route such as `/games/chess/`. */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
