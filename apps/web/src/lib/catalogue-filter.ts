/**
 * Searching, filtering, sorting and grouping the catalogue (#83, #84, #85), as functions
 * of plain data.
 *
 * Nothing here touches React, `location` or storage, with one deliberate exception noted
 * at the bottom. The browser component that owns the search box and the chips is left
 * with almost nothing to do but hold state and call these, and every rule about what a
 * search matches or how a tie is broken is tested on a list of five made-up games rather
 * than through a rendered page.
 *
 * It works on an *index* — slug, name, category, round length, playability — and never on
 * the catalogue proper. The catalogue carries sixty kilobytes of rule text that only the
 * server ever needs, and the shell has a few hundred bytes of headroom in its budget; the
 * index is the part of each game a filter can ask about, and nothing more.
 */

import { KEY_PREFIX, readVersioned, writeVersioned } from './local-store';

/** The five things the browser knows about a game. The page builds one per catalogue row. */
export interface CatalogueIndexEntry {
  readonly slug: string;
  readonly name: string;
  readonly category: string;
  readonly roundSeconds: number;
  readonly playable: boolean;
}

/**
 * The orders on offer. `category` is the page's own order — grouped, biggest group first,
 * games as the catalogue lists them — and the other two flatten the groups into one grid.
 */
export const SORT_KEYS = ['category', 'name', 'length'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value);
}

/** What the player has asked for: some words, and any number of categories. */
export interface CatalogueQuery {
  readonly text: string;
  readonly categories: readonly string[];
}

/**
 * Lower-cased, accents stripped, whitespace collapsed.
 *
 * Accents are stripped rather than matched because a player typing on a phone keyboard
 * usually cannot be bothered to produce one, and a search that fails on "cafe" against
 * "café" reads as the game being missing rather than the spelling being off.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What a search is matched against: the name, the category, and the words of the slug.
 *
 * The slug is in there because it is sometimes the shorter name a player remembers —
 * "ttt" finds Ultimate Tic Tac Toe through `ultimate-ttt` — and because it is the one
 * name of a game that appears in a URL somebody may have been sent.
 */
function searchText(entry: CatalogueIndexEntry): string {
  return normalise(`${entry.name} ${entry.category} ${entry.slug.replace(/-/g, ' ')}`);
}

/**
 * Whether `text` finds `entry`. Every word of the search must appear somewhere in the
 * entry's text, in any order, so "board chess" and "chess board" both find Chess and
 * nothing else in the Board category. No words at all finds everything.
 */
export function matches(entry: CatalogueIndexEntry, text: string): boolean {
  const words = normalise(text)
    .split(' ')
    .filter((word) => word.length > 0);
  if (words.length === 0) return true;
  const haystack = searchText(entry);
  return words.every((word) => haystack.includes(word));
}

/**
 * The entries that satisfy the query, in the order they were given.
 *
 * Categories are a union — Board *or* Dice — because a game is in exactly one category,
 * so an intersection of two could only ever be empty.
 */
export function filterEntries(
  entries: readonly CatalogueIndexEntry[],
  query: CatalogueQuery,
): readonly CatalogueIndexEntry[] {
  const { categories, text } = query;
  return entries.filter(
    (entry) =>
      (categories.length === 0 || categories.includes(entry.category)) && matches(entry, text),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The entries in the chosen order. `category` hands back the list untouched, because the
 * catalogue's own order is the category order and the grouping is done by
 * {@link groupByCategory}.
 *
 * Every tie is broken by slug, so two games of the same length sit in the same order on
 * every render and every device. A sort that let equal items fall where the engine put
 * them would reshuffle the grid under a player's thumb each time a key was pressed.
 */
export function sortEntries(
  entries: readonly CatalogueIndexEntry[],
  sort: SortKey,
): readonly CatalogueIndexEntry[] {
  if (sort === 'category') return entries;
  const byName = (a: CatalogueIndexEntry, b: CatalogueIndexEntry) =>
    compare(normalise(a.name), normalise(b.name)) || compare(a.slug, b.slug);
  const byLength = (a: CatalogueIndexEntry, b: CatalogueIndexEntry) =>
    a.roundSeconds - b.roundSeconds || compare(a.slug, b.slug);
  return [...entries].sort(sort === 'name' ? byName : byLength);
}

export interface CategoryGroup {
  readonly category: string;
  readonly games: readonly CatalogueIndexEntry[];
}

/**
 * The entries grouped by category: biggest group first, equal groups in the catalogue's
 * category order, games in the order they were given, empty groups left out.
 *
 * This is the order the page rendered before it had any controls at all, written out once
 * here so that the server's HTML and the browser's first render — which both start from
 * no query — are the same document.
 */
export function groupByCategory(
  entries: readonly CatalogueIndexEntry[],
  categories: readonly string[],
): readonly CategoryGroup[] {
  return categories
    .map((category) => ({
      category,
      games: entries.filter((entry) => entry.category === category),
    }))
    .filter((group) => group.games.length > 0)
    .sort((a, b) => b.games.length - a.games.length);
}

/**
 * The query in a page's `location.search`: `?q=words&category=Board,Dice`.
 *
 * Only categories in `known` survive, in `known`'s order. A link shared last year may name
 * a category that has since been renamed, and an empty grid under a chip that does not
 * exist is a worse answer than the whole catalogue. Both `category=A,B` and a repeated
 * `category=A&category=B` are read, since either is what a hand-edited address looks like.
 */
export function parseQuery(search: string, known: readonly string[]): CatalogueQuery {
  const params = new URLSearchParams(search);
  const wanted = params.getAll('category').flatMap((value) => value.split(','));
  return {
    text: params.get('q') ?? '',
    categories: known.filter((category) => wanted.includes(category)),
  };
}

/**
 * The query as a `location.search`, or the empty string when there is nothing to say —
 * so a cleared search leaves the page at `/games/` and not at `/games/?`.
 *
 * The comma between categories is put back after encoding: `?category=Board,Dice` is an
 * address a person can read and edit, `?category=Board%2CDice` is not, and the browser
 * accepts both.
 */
export function serialiseQuery(query: CatalogueQuery): string {
  const params = new URLSearchParams();
  const text = query.text.trim();
  if (text.length > 0) params.set('q', text);
  if (query.categories.length > 0) params.set('category', query.categories.join(','));
  const search = params.toString().replace(/%2C/g, ',');
  return search.length === 0 ? '' : `?${search}`;
}

/** What the live region says: "1 game", "12 games". */
export function countLabel(count: number): string {
  return count === 1 ? '1 game' : `${String(count)} games`;
}

/**
 * The accessible name of a favourite star, which says what pressing it will do.
 *
 * One function for the star on a catalogue card and the one on a game's own page, so the
 * two cannot drift into "Add to favourites" on one and "Favourite" on the other.
 */
export function favouriteLabel(name: string, on: boolean): string {
  return on ? `Remove ${name} from favourites` : `Add ${name} to favourites`;
}

/**
 * Something to offer when a search finds nothing: the player's favourites first, then
 * what they played recently, then the front of the catalogue, up to `limit` games.
 *
 * Filled up from each list in turn rather than taken from the first non-empty one, so a
 * player with one favourite sees that favourite and two more games, not one card and two
 * gaps. Slugs the index does not know — a favourite for a game that has since gone — are
 * skipped, and the catalogue fallback offers only games that can be started, because the
 * point of the offer is to be one tap from playing.
 */
export function suggestions(
  entries: readonly CatalogueIndexEntry[],
  favourites: readonly string[],
  recent: readonly string[],
  limit = 3,
): readonly CatalogueIndexEntry[] {
  const known = new Map(entries.map((entry) => [entry.slug, entry]));
  const fallback = entries.filter((entry) => entry.playable).map((entry) => entry.slug);
  const picked: CatalogueIndexEntry[] = [];
  for (const slug of [...favourites, ...recent, ...fallback]) {
    if (picked.length >= limit) break;
    const entry = known.get(slug);
    if (entry !== undefined && !picked.includes(entry)) picked.push(entry);
  }
  return picked;
}

/**
 * The remembered sort — the one impure corner of this file.
 *
 * It lives here rather than in the component because the key's shape is `{ sort }` and
 * the only validator for `sort` is {@link isSortKey}, three screens up; a store in a
 * separate file would import that and nothing else. Read through `local-store.ts` like
 * every other key, so it inherits the same failure story: absent, full or blocked storage
 * hands back the default and never throws.
 */
export const CATALOGUE_KEY = `${KEY_PREFIX}catalogue`;

/** The shape written today: `{ version: 1, sort }`. */
const VERSION = 1;

/** The sort the player last chose, or the page's own order if they never chose one. */
export function readSortPreference(): SortKey {
  const stored = readVersioned(CATALOGUE_KEY, VERSION);
  const sort = stored?.['sort'];
  return isSortKey(sort) ? sort : 'category';
}

export function writeSortPreference(sort: SortKey): void {
  // The result is ignored on purpose: a sort that did not stick costs one more choice
  // from the select next visit, and there is nobody to tell and nothing to retry.
  writeVersioned(CATALOGUE_KEY, VERSION, { sort });
}
