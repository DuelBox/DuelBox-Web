/**
 * What a seat is called, and which keys are its own. One source of truth for both.
 *
 * ## Why this file exists
 *
 * Five things in the shell used to name the two players, and none of them agreed:
 *
 * 1. `styles/tokens.ts` carried a `name` on each entry of `seatColour`, so the palette
 *    doubled as the name table.
 * 2. `PlaySurface` built a `Partial<Record<SeatId, string>>` of *overrides* and filled in
 *    only `p2` — which is the whole of the reported bug, a HUD reading "Pip vs Player two".
 * 3. `MatchHud` resolved a name as `seatNames?.[seat] ?? seatColour[seat].name`.
 * 4. `MatchOverlay` had its own private `seatName()` doing the same thing again.
 * 5. The How to play page wrote "Player one" and "Player two" in prose and in its key
 *    table, so the page that teaches the product taught different names from the product.
 *
 * A partial override map is the shape of the defect: it lets a caller name one seat and
 * leave the other to somebody else's fallback, and nothing in the type system objects.
 * So the type here is **total**. {@link SeatNames} names every seat or it does not compile,
 * and no component carries a fallback of its own — there is nothing to fall back to.
 *
 * ## What a seat is called
 *
 * A seat's name belongs to the seat, not to whoever is sitting in it. Pip is the near seat
 * and Bo the far seat in every mode, on every page, in the HUD, the result screen, the
 * control legend and the guide. A bot in a seat is *marked* rather than renamed — the
 * player is still playing Bo, and the scoreboard, the pips and the pause menu all agree
 * about that. Nothing here is ever a placeholder: "Player two" named a seat the product
 * has never called anything but Bo.
 */

import { SEATS, type SeatId } from '@duelbox/engine';

/** A name for every seat. Total by construction — see the note above. */
export type SeatNames = Readonly<Record<SeatId, string>>;

/**
 * The two characters, and the only place either name is spelled.
 *
 * `seats.test.ts` fails if a second spelling appears anywhere else under `apps/web/src`,
 * because that is exactly how the five systems above grew in the first place.
 */
export const SEAT_CHARACTERS: SeatNames = { p1: 'Pip', p2: 'Bo' };

/** How a seat held by a bot is marked. The name is unchanged; the occupant is noted. */
function botLabel(name: string): string {
  return `${name} (bot)`;
}

/**
 * The names to show for one match.
 *
 * `bots` is any map keyed by seat — the shell passes the `botSeatsFor()` tier map straight
 * in — and a seat present in it is played by a bot. Taking the same object the host is
 * given means "who is a bot" is decided once per match rather than re-derived from `mode`
 * beside every place a name is drawn.
 */
export function seatNamesFor(bots?: Readonly<Partial<Record<SeatId, unknown>>>): SeatNames {
  const names: Partial<Record<SeatId, string>> = {};
  for (const seat of SEATS) {
    const name = SEAT_CHARACTERS[seat];
    names[seat] = bots?.[seat] === undefined ? name : botLabel(name);
  }
  // Built as a partial and asserted once, rather than spelling both seats out: a literal
  // would have to be edited again the day a third seat exists, and the loop cannot leave
  // one out.
  return names as SeatNames;
}

/**
 * Which keys belong to which seat, from the engine's own defaults.
 *
 * Written out rather than described, because "W A S D or the arrow keys" tells a player
 * what the game accepts and not what is *theirs* — and two strangers sitting down at one
 * laptop need the second thing far more than the first.
 *
 * Here rather than in the component because two surfaces show it: the pre-match control
 * legend and the How to play table. Written twice they drift, and a key legend that
 * disagrees with the guide is worse than no legend.
 */
export const SEAT_KEYS: readonly { readonly seat: SeatId; move: string; action: string }[] = [
  { seat: 'p1', move: 'W A S D', action: 'Space' },
  { seat: 'p2', move: '↑ ← ↓ →', action: 'Enter' },
];
