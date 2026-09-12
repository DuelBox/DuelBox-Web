/**
 * The same tokens as `tokens.css`, for code that cannot read CSS custom properties —
 * chiefly canvas drawing, which would otherwise call getComputedStyle every frame.
 *
 * `tokens.test.ts` parses the stylesheet and asserts these two files agree, so the pair
 * cannot drift apart silently.
 *
 * The colours are authored here and checked against the stylesheet. The motion values are
 * not authored anywhere in this app: they are `MOTION` in the engine, and this file only
 * spells them the way CSS wants them. See {@link motion}.
 */

import { MOTION } from '@duelbox/engine/motion';

export const colour = {
  brand: '#4b3beb',
  brandDeep: '#3a2dd0',
  brandTint: '#f0eeff',

  p1: '#ff5a4e',
  p1Deep: '#e0332a',
  p1Tint: '#ffeceb',

  p2: '#21b0e8',
  p2Deep: '#118cbd',
  p2Tint: '#e8f6ff',

  sun: '#ffc53d',
  sunTint: '#fff1cf',
  grass: '#34c77b',
  grassTint: '#e9f9ef',

  ink: '#14161f',
  body: '#4a4f63',
  muted: '#6e7488',
  faint: '#9aa0b4',
  hairline: '#eceef6',
  border: '#e6e9f4',
  surface: '#f7f8fc',
  paper: '#ffffff',

  focus: '#4b3beb',
  danger: '#d93a31',
  success: '#1a7a4d',
} as const;

/**
 * Maps a seat to its colour set, so no game hardcodes which player is which colour.
 *
 * Colours only. Each entry used to carry a `name` as well, which made the palette one of
 * five places in the shell that named a player — see `lib/seats.ts`, which is now the only
 * one. A token file is where a colour is decided, not where a character is.
 */
export const seatColour = {
  p1: { base: colour.p1, deep: colour.p1Deep, tint: colour.p1Tint },
  p2: { base: colour.p2, deep: colour.p2Deep, tint: colour.p2Tint },
} as const;

export type ColourToken = keyof typeof colour;

/**
 * Seconds, as CSS milliseconds. Rounded because `0.12 * 1000` is 120.00000000000001.
 */
function ms(seconds: number): string {
  return `${String(Math.round(seconds * 1000))}ms`;
}

/**
 * The motion signature (#72), in the spellings a stylesheet or an inline style wants.
 *
 * **Derived, not decided.** The numbers are `MOTION` in `@duelbox/engine`, which is where
 * both halves of the product can reach them: the engine has no DOM and cannot read a custom
 * property, and it cannot import this app, but this app already imports the engine — so the
 * engine is the only end able to hold the values and this is the end able to restate them.
 * `tokens.test.ts` parses `tokens.css` and fails when a `--db-duration-*` or `--db-ease` has
 * drifted from the table, which is what makes the three copies one decision.
 *
 * Almost nothing needs this: a stylesheet should write `var(--db-duration)`, and
 * `motion.test.ts` fails any timed CSS that does not. It is here for the cases the cascade
 * cannot reach — a value handed to the Web Animations API, a canvas overlay timing itself —
 * and for the test, which needs something to compare the stylesheet against.
 *
 * Reduced motion is not represented. The stylesheet collapses the three durations to 1ms
 * under `prefers-reduced-motion`, so anything reading `var(--db-duration)` is already
 * answered; anything reading these strings is outside the cascade and has to ask the
 * preference itself, through the engine's `motionDuration`.
 */
export const motion = {
  durationFast: ms(MOTION.durationFastSeconds),
  duration: ms(MOTION.durationSeconds),
  durationSlow: ms(MOTION.durationSlowSeconds),
  ease: `cubic-bezier(${MOTION.ease.join(', ')})`,
} as const;
