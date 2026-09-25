import { ICON_SPRITE } from './icon-sprite.generated';

/**
 * The interface glyphs, dropped into the document once (#74).
 *
 * The same-document pattern `TileSprite` uses: the geometry goes in as `<symbol>`s here,
 * hidden and inert, and every `<Icon>` on the page is a `<use>` pointing at one of them
 * rather than another copy of the path. Rendered once, high in the tree — the site shell —
 * so a `<use>` anywhere below it resolves.
 *
 * `dangerouslySetInnerHTML` with the build-time string rather than JSX per shape: the markup
 * is generated and checked (`scripts/emit-icon-sprite.mjs`, `icon-sprite.test.ts`), so there
 * is nothing a hand-written element tree would add except bytes and a second place for the
 * geometry to live.
 */
export function IconSprite() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={0}
      height={0}
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      dangerouslySetInnerHTML={{ __html: `<defs>${ICON_SPRITE}</defs>` }}
    />
  );
}
