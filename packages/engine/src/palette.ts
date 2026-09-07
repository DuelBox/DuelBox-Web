import { SEATS, type SeatId } from './seat.js';

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

/** Which named seat palette is in effect. `default` is the brand red/blue. */
export type SeatPaletteId = 'default' | 'colourblind';

/**
 * The named palettes a player can choose between (#174).
 *
 * `default` is the brand pair. It is 1.03:1 between the seats under deuteranopia — for
 * roughly one man in sixteen, a two-player game with one colour — which shape and label
 * differentiation make survivable but do not fix. `colourblind` is the alternative: a deep
 * blue and an amber, a pair separated by a large luminance gap as well as a hue one, so it
 * clears 3:1 between the seats under every dichromacy. `palette-vision.test.ts` measures
 * both. The warm seat stays p1 in each, so a pair does not swap sides when they switch.
 */
export const SEAT_PALETTES: Readonly<Record<SeatPaletteId, Readonly<Record<SeatId, SeatPalette>>>> =
  {
    default: {
      p1: { base: '#ff5a4e', deep: '#e0332a', tint: '#ffeceb', soft: 'rgba(255, 90, 78, 0.45)' },
      p2: { base: '#21b0e8', deep: '#118cbd', tint: '#e8f6ff', soft: 'rgba(33, 176, 232, 0.45)' },
    },
    colourblind: {
      p1: { base: '#ffc107', deep: '#c79705', tint: '#fff5d6', soft: 'rgba(255, 193, 7, 0.45)' },
      p2: { base: '#0d4ea6', deep: '#0a3d81', tint: '#e4ecf8', soft: 'rgba(13, 78, 166, 0.45)' },
    },
  };

/**
 * The live palette every game reads, mutated in place by {@link setActiveSeatPalette}.
 *
 * Mutated in place rather than reassigned so the two ways a game reaches for it stay in
 * agreement: one game captures `SEAT_PALETTE.p1` at module load and reads `.base` off it
 * each frame, another reads `SEAT_PALETTE.p1.base` straight into a `const`. Swapping the
 * whole object would leave the first pointing at the old one; swapping the fields inside
 * each seat's object updates both. The `const` capturer is why the shell selects the
 * palette **before the game chunk loads** — `GameHost` calls `setActiveSeatPalette` from
 * the settings it reads at match start, and the game's module body runs after. Colour is
 * presentation, never simulation, so a swap changes nothing about how a match steps
 * (CLAUDE.md rule 8 is about pixels in the simulation, not the colours on top of it).
 *
 * It starts on `default`, so anything that reads it before a selection — the unit suite,
 * a game opened with no stored choice — sees the brand pair, exactly as it did before this
 * became switchable.
 */
type MutableSeatPalette = { base: string; deep: string; tint: string; soft: string };

const live: Record<SeatId, MutableSeatPalette> = {
  p1: { ...SEAT_PALETTES.default.p1 },
  p2: { ...SEAT_PALETTES.default.p2 },
};

export const SEAT_PALETTE: Readonly<Record<SeatId, SeatPalette>> = live;

let activeId: SeatPaletteId = 'default';

/**
 * Switches the live {@link SEAT_PALETTE} to a named palette.
 *
 * The seat objects are the same references throughout — only their fields are reassigned —
 * so a game that captured `SEAT_PALETTE.p1` at module load, one that captured
 * `SEAT_PALETTE.p1.base`, and one that reads either per frame all end up agreeing (the
 * first and third update immediately; the second is why the shell selects before the game
 * chunk loads). Idempotent and total: an id the build does not know falls back to `default`
 * rather than leaving the seats half-recoloured. Returns the id that took effect so a
 * caller can tell a fallback from a hit.
 */
export function setActiveSeatPalette(id: SeatPaletteId): SeatPaletteId {
  const resolved: SeatPaletteId = SEAT_PALETTES[id] ? id : 'default';
  const chosen = SEAT_PALETTES[resolved];
  for (const seat of SEATS) {
    Object.assign(live[seat], chosen[seat]);
  }
  activeId = resolved;
  return resolved;
}

/** The id currently in effect. */
export function activeSeatPaletteId(): SeatPaletteId {
  return activeId;
}

export function seatPalette(seat: SeatId): SeatPalette {
  return SEAT_PALETTE[seat];
}
