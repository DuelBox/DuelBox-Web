'use client';

import { useEffect, useState } from 'react';
import { readGameRecord, type Opponent, type Tally } from '@/lib/head-to-head';

/**
 * One line of what this device has recorded for one game (#162).
 *
 * `lib/head-to-head.ts` has kept a per-game, per-opponent tally since #160, and the only
 * place any of it was ever shown was the settings page's five most played. #162's action
 * item names the game's own page, and that is the right place for it: the catalogue is a
 * grid of 108 cards nobody reads one at a time, and a game's page is the one route a
 * visitor arrives at on purpose, having already decided they are interested in this game.
 *
 * ## Why the numbers arrive a frame late
 *
 * A record belongs to a browser, and these pages are exported once for everybody, so there
 * is no server render of it to have. Storage is read in an effect exactly as
 * `FavouriteButton` reads whether this game is starred, and the first paint shows a dash
 * for each count rather than a zero: a zero is a claim — "you two have never finished this
 * one" — and at first paint this component has not read anything and does not know that. A
 * dash says so, and it is still the honest thing on the page for a visitor with scripting
 * switched off, who will never get the read at all.
 *
 * The line has the same shape before and after, one line at every width this page is read
 * at, so the figures replacing the dashes move nothing beneath them.
 *
 * ## Why this is a component of its own
 *
 * `FavouriteButton` is already a small client component on this page reading a per-device
 * store, and folding a second reader into it would save one `useState`, one `useEffect`
 * and one component wrapper — call it a hundred bytes at the outside. It is not worth it
 * for two reasons. The record does not belong where the star does: the star sits on the
 * call-to-action line beside "Play", and the record is a block of its own below the
 * controls, and one component cannot render in two places. And the bytes that actually
 * matter here are not the wrapper — they are `lib/head-to-head` and its tree-shaken read
 * path entering this route's chunk for the first time, which is the same cost whichever
 * component does the importing.
 *
 * ## Why the props look like this
 *
 * Everything around the numbers — the heading, the row labels, the note under them — is
 * rendered by the server component that mounts this one, where prose is markup and costs
 * no JavaScript at all. That is the whole reason this component is as small as it is, and
 * it is why the two names arrive as props rather than being read here: `lib/seats.ts` is
 * the only file allowed to spell them, the page already imports it, and importing it here
 * would drag `@duelbox/engine` onto a shell route for two words.
 */

/** What each count reads as before storage has been read, and with no scripting at all. */
const UNREAD = { p1: '–', p2: '–', draws: '–' } as const;

export function GameRecord({
  slug,
  opponent,
  near,
  far,
}: {
  slug: string;
  opponent: Opponent;
  /** What to call the near seat's wins, and the far seat's. */
  near: string;
  far: string;
}) {
  const [tally, setTally] = useState<Tally | null>(null);
  useEffect(() => {
    setTally(readGameRecord(slug, opponent));
  }, [slug, opponent]);
  const shown = tally ?? UNREAD;
  // Words rather than a colour or a glyph, so a win and a loss are the same two facts in
  // greyscale that they are on a colour screen (rule 7) — and so a screen reader is handed
  // a sentence rather than "3W 2L 1D" to spell out.
  return `${near} ${shown.p1}, ${far} ${shown.p2}, ${shown.draws} drawn`;
}
