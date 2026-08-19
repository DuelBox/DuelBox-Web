import type { SeatId } from './seat.js';

/**
 * The one definition of what each seat looks like.
 *
 * Seat identity is a product-wide fact, not a per-game decision. Left to each game, the
 * seven built so far invented four different palettes and two of them disagreed about
 * which player was the warm colour — so a pair who learned that they were orange in one
 * game were blue in the next, and the shell's scoreboard named a colour that was not on
 * the board. Games take their seat colours from here.
 *
 * `base` is the fill, `deep` the outline or shadow, `tint` a wash for owned territory,
 * and `soft` a translucent form for trails and ghosts. Colour is never the only signal
 * (CLAUDE.md rule 7): these pair with the per-seat shapes the shell draws.
 */
export interface SeatPalette {
  readonly base: string;
  readonly deep: string;
  readonly tint: string;
  readonly soft: string;
}

export const SEAT_PALETTE: Readonly<Record<SeatId, SeatPalette>> = {
  p1: {
    base: '#ff5a4e',
    deep: '#e0332a',
    tint: '#ffeceb',
    soft: 'rgba(255, 90, 78, 0.45)',
  },
  p2: {
    base: '#21b0e8',
    deep: '#118cbd',
    tint: '#e8f6ff',
    soft: 'rgba(33, 176, 232, 0.45)',
  },
};

export function seatPalette(seat: SeatId): SeatPalette {
  return SEAT_PALETTE[seat];
}
