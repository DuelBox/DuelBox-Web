/**
 * The same tokens as `tokens.css`, for code that cannot read CSS custom properties —
 * chiefly canvas drawing, which would otherwise call getComputedStyle every frame.
 *
 * `tokens.test.ts` parses the stylesheet and asserts these two files agree, so the pair
 * cannot drift apart silently.
 */

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
