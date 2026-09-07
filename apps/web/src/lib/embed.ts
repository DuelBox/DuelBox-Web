/**
 * The embeddable game surface, in the parts that are pure enough to test without a DOM
 * (#202, #2367).
 *
 * A portal that embeds a DuelBox game is the main distribution a browser game has, and the
 * deal is explicit: the game plays inside the portal, and the portal carries DuelBox's name
 * and a link back to the game's own page. Those two — the branding and the backlink — are the
 * acceptance criteria of #202, so the backlink is computed here, once, where a test can hold
 * it to the game page and the route can render it.
 *
 * The route itself lives in `app/embed/[slug]`. What is here is only the arithmetic it needs:
 * the static params it generates, the path back to a game, the path the iframe is served at,
 * and the snippet a portal pastes. None of it reads a DOM, so all of it is testable.
 */

import { PLAYABLE } from '../data/registry';

/** The brand shown on the embed and in the backlink label. */
export const EMBED_BRAND = 'DuelBox';

/** Only playable games get an embed route — the same set the play route builds. */
export function embedStaticParams(): { slug: string }[] {
  return PLAYABLE.map((slug) => ({ slug }));
}

/** The path to a game's own page — the required backlink target. */
export function embedBacklinkPath(slug: string): string {
  return `/games/${slug}/`;
}

/** The path the embed iframe is served at. */
export function embedIframeSrcPath(slug: string): string {
  return `/embed/${slug}/`;
}

/** The visible label of the backlink, e.g. "Play Chess on DuelBox". */
export function embedBacklinkLabel(gameName: string): string {
  return `Play ${gameName} on ${EMBED_BRAND}`;
}

/**
 * The snippet a portal pastes to embed a game (#202: "Document the embed snippet").
 *
 * `siteUrl` is the deployed origin-plus-base-path; the iframe `src` is absolute so it works
 * wherever the snippet is pasted. A `title` is included because an embedded game with no
 * accessible name is a frame a screen-reader user cannot identify, and `loading="lazy"` keeps
 * a page full of them cheap.
 */
export function embedSnippet(slug: string, gameName: string, siteUrl: string): string {
  const src = `${siteUrl}${embedIframeSrcPath(slug)}`;
  return (
    `<iframe src="${src}" title="${gameName} on ${EMBED_BRAND}" ` +
    `width="480" height="720" loading="lazy" ` +
    `style="border:0;max-width:100%" allow="fullscreen"></iframe>`
  );
}
