/**
 * Copy helpers shared by the catalogue and the game pages.
 *
 * Pure and free of Next imports so they can be unit tested without pulling a page
 * component and its server-side data into the test.
 */

/**
 * Round length in words.
 *
 * Pluralised, because 98 of the 107 catalogue pages declare a 60- or 75-second round
 * and every one of them rendered "about 1 minutes".
 */
export function formatRound(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} ${plural(seconds, 'second')}`;
  const minutes = Math.round(seconds / 60);
  return `${String(minutes)} ${plural(minutes, 'minute')}`;
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
