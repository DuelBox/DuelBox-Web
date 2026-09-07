/**
 * What the two people at this device would rather be called (#161).
 *
 * A seat has a name of its own — `lib/seats.ts` owns it, and a seat keeps it whoever is
 * sitting there — but two friends who play every evening want their own names on the
 * scoreboard, and a pair handing the device to somebody else want to change them back in
 * one gesture. So a name here *replaces* the seat's name for as long as it is set, and
 * clearing the field hands the seat its own name back rather than leaving a blank.
 *
 * These names are local in the strongest sense the product can offer: typed by the two
 * people sitting there, stored in this browser, shown to nobody else. There is no server
 * to send them to and nothing shareable to leak them into, which is also why there is no
 * filter on what they contain — the only readers are the two people who typed them at
 * each other.
 *
 * Sanitised on the way in *and* on the way out, unlike the stores that only check reads.
 * The write is a text field a person is typing into, so it is the one place a stray space
 * or a pasted paragraph actually comes from, and trimming it there is what makes the
 * stored value the same value the settings page shows back. The read still checks, for the
 * usual reason: another tab, an older build, or somebody with the console open.
 */

import type { SeatId } from '@duelbox/engine';
import { KEY_PREFIX, readVersioned, removeJson, writeVersioned } from './local-store';

export const PLAYER_NAMES_KEY = `${KEY_PREFIX}player-names`;

/** The shape written today: `{ version: 1, p1?: string, p2?: string }`. */
const VERSION = 1;

/**
 * As long as a name may be.
 *
 * Twelve characters is a name, not a sentence: it fits the HUD beside a score on a 320px
 * phone in both seats at once, which is the width every layout in this product is
 * measured at.
 */
export const MAX_NAME_LENGTH = 12;

/**
 * The two seats, spelled out rather than taken from the engine's `SEATS`.
 *
 * This module is read by the settings page, which is shell code every visitor downloads,
 * and a value import of `@duelbox/engine` there would pull the engine along with it. The
 * *type* comes from the engine as it should, so a third seat is still a compile error
 * here.
 */
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/**
 * A name as it will be stored: trimmed, with runs of inner whitespace collapsed to one
 * space, and cut to {@link MAX_NAME_LENGTH}.
 *
 * Trimmed again after the cut, so a name truncated mid-space does not end in one. An empty
 * result is not a name at all, and the caller reads it as "this seat has no chosen name".
 */
function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH).trim();
}

/** The chosen names, with a seat left out entirely when it has none. */
export function readPlayerNames(): Readonly<Partial<Record<SeatId, string>>> {
  const stored = readVersioned(PLAYER_NAMES_KEY, VERSION);
  if (stored === null) return {};
  const names: Partial<Record<SeatId, string>> = {};
  for (const seat of SEATS) {
    const name = clean(stored[seat]);
    if (name !== '') names[seat] = name;
  }
  return names;
}

/**
 * Names one seat, or hands it back its own name when `name` is empty.
 *
 * Merged rather than replaced, so naming one seat cannot silently unname the other. When
 * neither seat has a name left the key goes altogether: a player who clears both fields
 * has nothing stored, and an export from that browser should say so rather than carrying
 * an empty envelope.
 */
export function writePlayerName(seat: SeatId, name: string): void {
  const chosen = clean(name);
  const next: Partial<Record<SeatId, string>> = { ...readPlayerNames() };
  if (chosen === '') delete next[seat];
  else next[seat] = chosen;
  if (next.p1 === undefined && next.p2 === undefined) {
    removeJson(PLAYER_NAMES_KEY);
    return;
  }
  writeVersioned(PLAYER_NAMES_KEY, VERSION, { ...next });
}

export function clearPlayerNames(): void {
  removeJson(PLAYER_NAMES_KEY);
}
