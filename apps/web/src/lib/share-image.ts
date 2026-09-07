import {
  DEFAULT_SHARE_IMAGE_FILE,
  SHARE_IMAGE_DIR,
  SHARE_IMAGE_FILES,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
} from '../data/share-images.generated';
import { absoluteUrl } from './site';

/**
 * What a page tells a platform to show when somebody shares its link (#197, #2453).
 *
 * The pictures themselves are composed by `scripts/generate-share-images.mjs` before
 * `next build` and land in the export as ordinary files; `lib/share/card.ts` explains what
 * is in them and why they are drawn rather than commissioned. This module is only the
 * address of one — but the address is where this kind of thing goes wrong, so it is worth
 * the file.
 *
 * **Nothing here composes a file name.** The names come from
 * `data/share-images.generated.ts`, which the generator writes as a record of the files it
 * actually produced, and a slug that is not in that list gets `null` rather than a URL that
 * looks right and 404s. Renaming the cards therefore cannot leave the metadata pointing at
 * the old name: the list changes in the same commit, and `share-image.test.ts` fails for
 * every game that lost its picture. That failure mode — metadata naming a file the build
 * does not emit — is the one this repository has been bitten by, and a preview is the worst
 * place for it, because the page still looks perfect to everybody except the person who
 * pasted the link.
 *
 * An absolute URL, not a relative one. `metadataBase` would resolve a relative path, but
 * every other address on this site is built with `absoluteUrl` — canonical, `og:url`, the
 * sitemap — and one that goes through a different mechanism is one that can disagree with
 * the rest about the base path.
 */

export interface ShareImage {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly type: string;
}

/** Written by the generator, so membership means the build emitted that file. */
const EMITTED = new Set(SHARE_IMAGE_FILES);

function shareImage(file: string, alt: string): ShareImage {
  return {
    url: absoluteUrl(`${SHARE_IMAGE_DIR}/${file}`),
    width: SHARE_IMAGE_WIDTH,
    height: SHARE_IMAGE_HEIGHT,
    alt,
    type: 'image/png',
  };
}

/**
 * The card for everything that is not one game: the home page, the catalogue, the category
 * hubs, and the pages that are neither. A montage of nine tiles, which is the honest
 * picture of a site whose whole proposition is that it holds a hundred and eight games.
 */
export const SITE_SHARE_IMAGE: ShareImage = shareImage(
  DEFAULT_SHARE_IMAGE_FILE,
  'Nine DuelBox game tiles, each a mark on a coloured ground.',
);

/**
 * One game's card, or `null` if the build did not emit one.
 *
 * The alt text names the game and says what the picture is, because a platform that renders
 * the preview for a screen-reader user reads this and nothing else about the image. It does
 * not repeat the game's rule: that is the description, which sits beside the image already.
 */
export function shareImageFor(slug: string, name: string): ShareImage | null {
  const file = `${slug}.png`;
  if (!EMITTED.has(file)) return null;
  return shareImage(file, `The DuelBox tile for ${name}.`);
}
