import type { CatalogueEntry } from '@/data/catalogue.generated';
import { FIELD_ALPHA, INK, RADIUS, groundFor, tileFor } from '@/lib/tiles';
import { chipId, fieldId, markId, tileClip } from './TileSprite';

/**
 * One game's catalogue tile: a ground, a texture, a mark, a chip.
 *
 * The geometry lives in `lib/tiles.ts` and is drawn once per page by {@link TileSprite};
 * this is three references into it plus the ground colour. A page that renders a tile must
 * also render the sprite, or the `<use>` elements point at nothing — `tiles.test.ts` checks
 * that the sprite covers every tile it is asked for.
 *
 * `aria-hidden`, on purpose. The game's name is always beside the tile as text — that is
 * part of the tile's design, not an accident of this layout — so announcing the art as well
 * reads the name twice and tells a screen-reader user nothing they did not have.
 */
export function GameTile({ game }: { game: CatalogueEntry }) {
  const spec = tileFor(game);
  return (
    <svg viewBox="0 0 64 64" width="100%" aria-hidden="true" style={{ display: 'block' }}>
      <rect width="64" height="64" rx={RADIUS} fill={groundFor(spec.tint)} />
      {spec.field === 'plain' ? null : (
        <use
          href={`#${fieldId(spec.field)}`}
          color={INK}
          opacity={FIELD_ALPHA}
          clipPath={tileClip}
        />
      )}
      <use href={`#${markId(spec.mark)}`} color={INK} />
      <use href={`#${chipId(spec.chip)}`} color={INK} />
    </svg>
  );
}
