'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { readFavourites, toggleFavourite } from '@/lib/favourites';
import { annotateOfflineReady } from '@/lib/offline-ready';
import { clearRecent, readRecent } from '@/lib/recent';
import {
  countLabel,
  favouriteLabel,
  filterEntries,
  groupByCategory,
  isSortKey,
  parseQuery,
  readSortPreference,
  serialiseQuery,
  sortEntries,
  suggestions,
  writeSortPreference,
  type CatalogueIndexEntry,
  type SortKey,
} from '@/lib/catalogue-filter';
import styles from './CatalogBrowser.module.css';

/**
 * The catalogue's controls: search, category chips, sort, favourites, recent games.
 *
 * ## Where the cards come from
 *
 * Not from here. This component never sees the catalogue — it is handed an index of five
 * fields per game and, separately, every card *already rendered* by the server page.
 * A card carries a tile, a link and a mode list, and rendering one needs the catalogue's
 * sixty kilobytes of rule text plus the tile geometry; putting that in a client component
 * would put all of it in the shell, which has a few hundred bytes of headroom. Server
 * output passed as a prop is serialised with the page instead and costs the browser no
 * script at all, so the only JavaScript here is the part that has to react to a player.
 *
 * ## Why the first render is the old page
 *
 * The page is statically exported, and the server knows nothing about this device's
 * address or storage. So the initial state is no query, no categories, the category order
 * and nothing starred — exactly the sections the page rendered before it had controls —
 * and one effect then reads `location.search` and the stores and lets the real state
 * replace it a frame later. Reading either during render would make the server's HTML and
 * the browser's first paint disagree, which React reports as a hydration error and shows
 * as a flash.
 *
 * ## The address as state
 *
 * A filtered view is worth sharing and worth coming back to, so the query lives in the
 * address: `?q=…&category=A,B`. Typing replaces the current entry, because forty
 * keystrokes are not forty places a player wants Back to visit; choosing a chip pushes a
 * new one, so Back undoes the last chip. A `popstate` listener reads the address again
 * when that happens, which is also what makes a reload and a shared link land on the same
 * grid the sender saw.
 *
 * ## Why the offline annotation is done from here, of all places
 *
 * Because this is the only client component on this route that owns the whole grid, and the
 * cards themselves cannot do it. `GameCard` is a server component and has to stay one — its
 * docstring sets out what a directive at the top of that file would cost the shell, and
 * `lib/landing.test.ts` fails the build if one appears — so it renders `data-offline-ready`
 * empty and both possible words, and something with a browser in front of it has to supply
 * the value. That is `lib/offline-ready.ts`, called below over this component's own subtree.
 *
 * It runs after **every** render rather than once on mount, and that is not caution: a
 * keystroke in the search box or a category chip re-renders the grid with a different set of
 * cards in it, and a card React has just brought back carries the server's empty attribute
 * again. The measurement of what is in Cache Storage is taken once and kept, so a re-run is
 * a set lookup per card and no trip to the cache at all.
 *
 * The subtree, not the document, and that is structural rather than careful. Everything
 * above this component — the site header, the page's own heading and its Surprise me button
 * — is outside the ref below and cannot be reached from it, which is what
 * `e2e/offline.spec.ts` is asserting when it counts `header a[data-offline-ready]` and
 * expects zero: navigation chrome is the same on every route, and marking a link to a *page*
 * with whether a *game* is saved would be nonsense.
 */
export interface CatalogBrowserProps {
  readonly entries: readonly CatalogueIndexEntry[];
  /** Every category in the catalogue's own order, including any with no games in it. */
  readonly categories: readonly string[];
  /** One server-rendered card per slug. */
  readonly cards: Readonly<Record<string, ReactNode>>;
}

/**
 * How long typing pauses before the grid follows. The input itself moves with every key;
 * only the filtering waits, so a player typing "air hockey" sees one grid rather than ten.
 */
const DEBOUNCE_MS = 150;

const SEARCH_ID = 'catalogue-search';

export function CatalogBrowser({ entries, categories, cards }: CatalogBrowserProps) {
  const [text, setText] = useState('');
  const [applied, setApplied] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [sort, setSort] = useState<SortKey>('category');
  const [favourites, setFavourites] = useState<readonly string[]>([]);
  const [recent, setRecent] = useState<readonly string[]>([]);
  /**
   * Whether the address and the stores have been read. Until then the address must not be
   * written, or the effect below would push the empty query over a shared link before the
   * link had been read. It is also stamped on the root as `data-ready`, because the server
   * renders every control before the script that drives them has arrived, and a test that
   * presses a star on a page that cannot yet respond is testing the network.
   */
  const [ready, setReady] = useState(false);
  /** The subtree the annotation may reach: every card, and no navigation chrome. */
  const root = useRef<HTMLDivElement>(null);

  // Only categories that have a game in them get a chip; a chip that can only ever show an
  // empty grid is a control that does nothing. Memoised because two effects depend on it.
  const offered = useMemo(
    () => categories.filter((category) => entries.some((entry) => entry.category === category)),
    [categories, entries],
  );

  useEffect(() => {
    const fromAddress = () => {
      const query = parseQuery(globalThis.location.search, offered);
      setText(query.text);
      setApplied(query.text);
      setSelected(query.categories);
    };
    fromAddress();
    setFavourites(readFavourites());
    setRecent(readRecent());
    setSort(readSortPreference());
    setReady(true);
    globalThis.addEventListener('popstate', fromAddress);
    return () => {
      globalThis.removeEventListener('popstate', fromAddress);
    };
  }, [offered]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(text);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    if (!ready) return;
    const next = serialiseQuery({ text: applied, categories: selected });
    // The address already says this — which is the case after the effect above read it,
    // and after Back restored it — so there is nothing to write.
    if (next === globalThis.location.search) return;
    // Whether the categories changed is what decides between a new history entry and a
    // replaced one, and the address itself is the record of what they were.
    const before = parseQuery(globalThis.location.search, offered).categories;
    const method = before.join() === selected.join() ? 'replaceState' : 'pushState';
    const { pathname, hash } = globalThis.location;
    globalThis.history[method](null, '', `${pathname}${next}${hash}`);
  }, [ready, applied, selected, offered]);

  // No dependency array, on purpose: the thing that changes is the DOM, not a value this
  // component holds. See the section on the annotation in the docstring above.
  useEffect(() => {
    if (root.current !== null) void annotateOfflineReady(root.current);
  });

  const filtered = filterEntries(entries, { text: applied, categories: selected });
  const shown = new Set(filtered.map((entry) => entry.slug));
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
  // A stored slug the catalogue no longer has, or one the filter has hidden, shows nothing.
  const pick = (slugs: readonly string[]) =>
    slugs.flatMap((slug) => {
      const entry = bySlug.get(slug);
      return entry !== undefined && shown.has(slug) ? [entry] : [];
    });
  const pinned = pick(favourites);
  const played = pick(recent);

  const toggle = (slug: string) => {
    setFavourites(toggleFavourite(slug));
  };

  const grid = (list: readonly CatalogueIndexEntry[]) => (
    <div className={styles.grid}>
      {list.map((entry) => (
        <Slot
          key={entry.slug}
          entry={entry}
          card={cards[entry.slug]}
          on={favourites.includes(entry.slug)}
          onToggle={toggle}
        />
      ))}
    </div>
  );

  return (
    <div ref={root} data-ready={ready ? '' : undefined}>
      <div className={styles.controls}>
        <label htmlFor={SEARCH_ID} className="db-visually-hidden">
          Search games
        </label>
        <input
          id={SEARCH_ID}
          type="search"
          className={styles.search}
          value={text}
          placeholder="Search by name or category"
          autoComplete="off"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <label className={styles.sort}>
          Sort by
          <select
            className={styles.select}
            value={sort}
            onChange={(event) => {
              const next = event.target.value;
              if (!isSortKey(next)) return;
              setSort(next);
              writeSortPreference(next);
            }}
          >
            <option value="category">Category</option>
            <option value="name">Name</option>
            <option value="length">Round length</option>
          </select>
        </label>
      </div>

      <div role="group" aria-label="Categories" className={styles.chips}>
        {offered.map((category) => {
          const on = selected.includes(category);
          return (
            <button
              key={category}
              type="button"
              className={styles.chip}
              aria-pressed={on}
              onClick={() => {
                // Kept in the catalogue's order whatever order they were pressed in, so
                // the address reads the same for the same choice.
                setSelected(offered.filter((c) => (c === category ? !on : selected.includes(c))));
              }}
            >
              {/* The shape half of the chosen state, so a pressed chip reads without its
                  tint (rule 7). In the markup and `aria-hidden` rather than a CSS
                  `::before`, because generated content is part of the accessible name:
                  as a pseudo-element this turned every pressed chip into "✓ Arcade",
                  which is a control renaming itself on press and says with a glyph what
                  `aria-pressed` already says properly. It is always rendered and hidden
                  when off, so pressing one does not resize it. */}
              <span className={styles.tick} aria-hidden="true">
                ✓
              </span>
              {category}
            </button>
          );
        })}
        {selected.length > 0 ? (
          <button
            type="button"
            className={`${styles.chip} ${styles.chipClear}`}
            onClick={() => {
              setSelected([]);
            }}
          >
            Clear all
          </button>
        ) : null}
      </div>

      <p aria-live="polite" className="db-visually-hidden">
        {countLabel(filtered.length)}
      </p>

      {pinned.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Favourites
            <span className={styles.sectionCount}>{pinned.length}</span>
          </h2>
          {grid(pinned)}
        </section>
      ) : null}

      {played.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.rowHead}>
            <h2 className={styles.sectionTitle}>Recently played</h2>
            <button
              type="button"
              className={styles.button}
              aria-label="Clear recently played"
              onClick={() => {
                clearRecent();
                setRecent([]);
              }}
            >
              Clear
            </button>
          </div>
          {grid(played)}
        </section>
      ) : null}

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No games match “{applied.trim()}”</p>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setText('');
              setApplied('');
            }}
          >
            Clear search
          </button>
          <p className={styles.emptyHint}>Try one of these instead.</p>
          {grid(suggestions(entries, favourites, recent))}
        </div>
      ) : sort === 'category' ? (
        groupByCategory(filtered, categories).map((group) => (
          <section key={group.category} className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {group.category}
              <span className={styles.sectionCount}>{group.games.length}</span>
            </h2>
            {grid(group.games)}
          </section>
        ))
      ) : (
        <section className={styles.section}>{grid(sortEntries(filtered, sort))}</section>
      )}
    </div>
  );
}

/**
 * One card with its star.
 *
 * The card is a link, and a button cannot live inside a link, so the two are siblings: the
 * card as the server rendered it, and over it a box the size of the tile that lets every
 * press through except the ones on the star. The star sits in the tile's bottom-left
 * corner, the one corner the art leaves empty — the seat dots take the top-left, the Play
 * badge the top-right, and the tile's own chip the bottom-right (see `lib/tiles.ts`).
 *
 * A filled ★ when on and an outline ☆ when off: the two differ by shape as well as by
 * colour, as rule 7 asks, and the accessible name says what pressing will do.
 */
function Slot({
  entry,
  card,
  on,
  onToggle,
}: {
  entry: CatalogueIndexEntry;
  card: ReactNode;
  on: boolean;
  onToggle: (slug: string) => void;
}) {
  return (
    <div className={styles.slot}>
      {card}
      <div className={styles.overlay}>
        <button
          type="button"
          className={styles.star}
          aria-pressed={on}
          aria-label={favouriteLabel(entry.name, on)}
          onClick={() => {
            onToggle(entry.slug);
          }}
        >
          <span className={styles.starGlyph} aria-hidden="true">
            {on ? '★' : '☆'}
          </span>
        </button>
      </div>
    </div>
  );
}
