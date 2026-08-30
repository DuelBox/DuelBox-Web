/**
 * Copy helpers shared by the catalogue and the game pages.
 *
 * Pure and free of Next imports so they can be unit tested without pulling a page
 * component and its server-side data into the test.
 */

/**
 * Round length in words, hedge included.
 *
 * One renderer, and the whole phrase rather than the number alone. There were two: the
 * catalogue card wrote its own `${minutes} min` while the page the card links to called
 * this one and prefixed "about", so the same 120 seconds read `2 min` on the grid and
 * `about 2 minutes` one click later (#2513).
 *
 * The hedge belongs *inside* the function rather than at each call site, because that is
 * the half that drifted — and because it is true on both surfaces. A 90-second round
 * rounds to two minutes, so the abbreviated card was the more misleading of the two, not
 * merely the terser.
 *
 * Pluralised, because 98 of the 107 catalogue pages declare a 60- or 75-second round and
 * every one of them rendered "about 1 minutes".
 */
export function formatRound(seconds: number): string {
  if (seconds < 60) return `about ${String(seconds)} ${plural(seconds, 'second')}`;
  const minutes = Math.round(seconds / 60);
  return `about ${String(minutes)} ${plural(minutes, 'minute')}`;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
