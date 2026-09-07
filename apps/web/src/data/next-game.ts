import { PLAYABLE } from './registry';
import { GAME_NAMES } from './game-names.generated';

export interface NextGame {
  readonly slug: string;
  readonly name: string;
}

/**
 * Something to play next, so a result screen is never a dead end.
 *
 * Deterministic — the slug picks it — because a suggestion that changes on every render
 * reads as a glitch.
 *
 * **Resolved on the server, at build time, and handed to `PlaySurface` as a prop.** It
 * used to run in the browser, which meant the client bundle carried `GAME_NAMES` — all
 * one hundred and eight display names — so that one of them could be read once. The play
 * route is statically exported per slug and this function depends on nothing but the slug,
 * so every visitor was paying 1.4 KB gzipped for a lookup the build had already done.
 *
 * That is the same mistake `game-names.generated.ts` records having made with `CATALOGUE`
 * — "the registry is imported by a client component, so reading it from `CATALOGUE`
 * pulled every game's prose into the shell" — one level further in. The general form: a
 * client component that derives a value from a build-time table ships the whole table.
 */
export function suggestNextGame(slug: string): NextGame | undefined {
  const others = PLAYABLE.filter((candidate) => candidate !== slug);
  const first = others[0];
  if (first === undefined) return undefined;
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  const pick = others[hash % others.length] ?? first;
  return { slug: pick, name: GAME_NAMES[pick] ?? pick.replace(/-/g, ' ') };
}
