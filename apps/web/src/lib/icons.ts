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

/** The DOM id the glyph's `<symbol>` is emitted under, for a `<use href="#…">`. */
export function iconId(name: IconName): string {
  return iconSymbolId(name);
}
