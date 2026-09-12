import { iconSymbolId } from './icon-art.mjs';

/**
 * The typed names of the interface glyphs (#74).
 *
 * The geometry lives in `icon-art.mjs`, which the build-time emitter also reads; this is the
 * typed face of it. The names are declared here as a literal tuple rather than derived from
 * the `.mjs` — a plain module gives back `string[]`, which would make `IconName` just
 * `string` and let `<Icon name="ploy" />` compile. `icons.test.ts` asserts this list and the
 * geometry's keys are the same set, so the type cannot claim an icon the art does not draw,
 * or miss one it does.
 */
export const ICONS = [
  'play',
  'pause',
  'sound-on',
  'sound-off',
  'settings',
  'close',
  'back',
  'forward',
  'star',
  'star-filled',
  'trophy',
  'refresh',
  'check',
  'info',
] as const;

export type IconName = (typeof ICONS)[number];

/**
 * The glyphs that turn round under a right-to-left shell (#222).
 *
 * An icon mirrors when what it draws is a direction *along the line of reading*: `back`
 * points towards the start of the line and `forward` towards the end, and for an Arabic
 * reader the start is on the right. Everything else in the set is the same picture in
 * either direction and must not flip — a mirrored play triangle is the rewind glyph, a
 * mirrored tick is a different stroke, and a clock-wise refresh arrow turned round says
 * anti-clockwise, which is not what refresh means anywhere. Sound, settings, close, info,
 * the stars and the trophy are symmetric or have no direction to keep.
 *
 * A `Set` of names rather than a flag on the art, so `icons.test.ts` can hold it to `ICONS`
 * in both directions: every member is a real glyph, and every glyph that points along the
 * line is a member. `Icon.tsx` reads it and puts `MIRROR_CLASS` on exactly these; the flip
 * itself is one rule in `globals.css`, `scaleX(var(--db-inline-sign))`, which is -1 under
 * the shell's `[dir='rtl']` and set back to 1 inside the play surface's `ltr` island — not
 * a `[dir='rtl']` selector, which would flip an arrow drawn inside a match (docs/rtl.md).
 */
export const MIRRORED_ICONS: ReadonlySet<IconName> = new Set<IconName>(['back', 'forward']);

/**
 * The global class `globals.css` scales by `--db-inline-sign`. Also worn directly by the
 * landing page's text arrow (`page.tsx`), the one directional glyph a route renders today.
 * `styles/direction.test.ts` holds the rule in globals.css to this name, so the two strings
 * cannot drift apart with every guard green.
 */
export const MIRROR_CLASS = 'db-mirror';

/**
 * The class list for one glyph: the caller's, plus `db-mirror` for a directional name.
 *
 * A pure function so the decision can be tested without a renderer, and so a second place
 * that draws an icon (a canvas HUD, a share card) makes the same one.
 */
export function iconClassName(name: IconName, className?: string): string | undefined {
  const mirror = MIRRORED_ICONS.has(name) ? MIRROR_CLASS : undefined;
  const parts = [className, mirror].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(' ');
}

/** The DOM id the glyph's `<symbol>` is emitted under, for a `<use href="#…">`. */
export function iconId(name: IconName): string {
  return iconSymbolId(name);
}
