/**
 * Applying the colour-scheme choice to the document (#76).
 *
 * The tokens live in `styles/tokens.css`: the bare `:root` is light, `[data-theme='dark']`
 * is dark, and a `prefers-color-scheme` block covers a dark device that has made no choice.
 * All this module does is set or clear the one attribute that selects between them, which
 * is why it is so small — the cascade does the work.
 *
 * `system` is the absence of an override, so it removes the attribute and lets the media
 * query decide: that way a device that switches theme while the page is open follows along
 * with no listener of ours, and there is nothing to keep in sync. An explicit `light` or
 * `dark` is stamped on `<html>`, where `:not([data-theme='light'])` in the stylesheet lets
 * a forced light still win under a dark device.
 *
 * The same three-line decision runs once more as an inline script in `layout.tsx`, before
 * the first paint, so an override never flashes the wrong ground. That copy cannot import
 * this one — it has to be a string in the HTML head to beat the paint — so the logic is
 * kept trivial enough to duplicate safely, and `theme.test.ts` pins the decision table both
 * places must agree on.
 */

import type { SeatPaletteChoice, ThemeChoice } from './settings';

/**
 * The value the `data-theme` attribute should take for a choice, or `null` to remove it.
 *
 * Pure and DOM-free so it can be tested directly and so the inline head script has an
 * unambiguous table to mirror: `system` clears the attribute, the two explicit choices set
 * themselves.
 */
export function themeAttribute(theme: ThemeChoice): 'light' | 'dark' | null {
  return theme === 'light' || theme === 'dark' ? theme : null;
}

/**
 * Puts a theme choice into effect by setting or clearing `data-theme` on `<html>`.
 *
 * A no-op where there is no document — the static render on the build machine, and the unit
 * suite — so a caller need not guard. Only ever called from a client effect or event
 * handler, where the document is present.
 */
export function applyTheme(theme: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const attribute = themeAttribute(theme);
  if (attribute === null) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', attribute);
}

/**
 * The value the `data-seat-palette` attribute should take for a choice, or `null` to remove
 * it. `default` clears the attribute and lets the brand seat tokens stand; `colourblind`
 * stamps itself, which the override blocks in `tokens.css` select on. The mirror of
 * {@link themeAttribute}, and the inline head script mirrors it in turn.
 */
export function seatPaletteAttribute(palette: SeatPaletteChoice): 'colourblind' | null {
  return palette === 'colourblind' ? 'colourblind' : null;
}

/**
 * Puts a seat-palette choice into effect for the shell by setting or clearing
 * `data-seat-palette` on `<html>`. The games take the same choice through the engine's
 * `setActiveSeatPalette`, which `GameHost` calls; this is only the shell's half — the
 * scoreboard, HUD and seat glyphs that draw in CSS rather than on the canvas.
 */
export function applySeatPalette(palette: SeatPaletteChoice): void {
  if (typeof document === 'undefined') return;
  const attribute = seatPaletteAttribute(palette);
  if (attribute === null) document.documentElement.removeAttribute('data-seat-palette');
  else document.documentElement.setAttribute('data-seat-palette', attribute);
}

/**
 * Puts the seat-colour swap (#161) into effect for the shell by setting or clearing
 * `data-seat-swap` on `<html>`. `tokens.css` exchanges the two seats' colour tokens under
 * that attribute, for both palettes and both themes, so every `var(--db-p1)` in the shell
 * — the scoreboard, the HUD, the seat glyphs — follows. The glyphs' shapes do not: they are
 * drawn per seat and read the tokens, so a swap recolours a circle and never turns it into
 * a square (rule 7). The games take the same swap through the engine's `setSeatSwap`, which
 * `PlaySurface` calls beside `setActiveSeatPalette`; this is the shell's half.
 */
export function applySeatSwap(swapped: boolean): void {
  if (typeof document === 'undefined') return;
  if (swapped) document.documentElement.setAttribute('data-seat-swap', '');
  else document.documentElement.removeAttribute('data-seat-swap');
}
