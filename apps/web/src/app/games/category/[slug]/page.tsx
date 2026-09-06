import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CATALOGUE, type CatalogueEntry } from '@/data/catalogue.generated';
import { CATEGORY_HUBS, hubFor } from '@/lib/categories';
import { formatRound } from '@/lib/format';
import { absoluteUrl } from '@/lib/site';
import { collectionPageJsonLd, serialiseJsonLd } from '@/lib/structured-data';
import { GameCard } from '@/components/GameCard';
import { TileSprite } from '@/components/TileSprite';
import styles from './page.module.css';

/**
 * One page per category, answering the question the catalogue cannot (#200).
 *
 * `/games/` answers "what is here" for all eighteen categories at once, which is the right
 * page for somebody already on the site and the wrong page for somebody who typed "two
 * player board games on one screen" into a search engine. A hub answers exactly that one
 * question, in prose written for that category, with the category's games underneath it.
 *
 * **This route ships no JavaScript of its own, and that is a requirement rather than a
 * happy result.** The shell budget has about two kilobytes of headroom, and eighteen new
 * routes are worth nothing if they cost every visitor to `/` a browser component. So there
 * is no client directive here and nothing imported that carries one: `GameCard` and
 * `TileSprite` are server components, and the copy is a module of strings. What reaches the
 * browser is finished HTML — which is also what a crawler reads, so the two goals are the
 * same goal.
 */
export function generateStaticParams() {
  return CATEGORY_HUBS.map((hub) => ({ slug: hub.slug }));
}

function gamesIn(category: string): CatalogueEntry[] {
  return CATALOGUE.filter((game) => game.category === category);
}

/**
 * The heading that names the games grid.
 *
 * A constant rather than a generated id: this is a server component rendered once per
 * route, so there is exactly one of these per page and nothing to collide with.
 */
const GRID_HEADING_ID = 'category-games';

/** "20 games" — the plural is spelled out because 4 of the 18 categories hold one game. */
function countLine(count: number): string {
  return `${String(count)} ${count === 1 ? 'game' : 'games'}`;
}

/**
 * How long a round takes, from the real `roundSeconds` of the games on the page.
 *
 * Compared as *rendered* strings rather than as seconds, which is the difference between a
 * useful line and a silly one: Memory holds a 60-second game and a 75-second one, and both
 * render as "about 1 minute", so comparing the numbers would produce "Rounds run from about
 * 1 minute to about 1 minute". `formatRound` is the one place that decides how a length
 * reads, so it is the thing to ask.
 */
function roundLine(games: readonly CatalogueEntry[]): string {
  const seconds = games.map((game) => game.roundSeconds);
  const shortest = formatRound(Math.min(...seconds));
  const longest = formatRound(Math.max(...seconds));
  return shortest === longest
    ? `A round takes ${shortest}.`
    : `Rounds run from ${shortest} to ${longest}.`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const hub = hubFor(slug);
  if (!hub) return { title: 'Category not found' };
  const games = gamesIn(hub.category);
  // The intent opens the description because it is the phrase somebody searched for, and
  // the count and the round length follow because they are the two things that decide
  // whether the result is worth opening. Every hub's description is therefore different in
  // all three of its parts, which is the property #200 is actually asking for.
  const description = `${hub.intent}. ${countLine(games.length)}, played by two people on one device. ${roundLine(games)}`;
  const url = absoluteUrl(`/games/category/${hub.slug}/`);
  const title = `${hub.title} — DuelBox`;
  return {
    title: hub.title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
    twitter: { card: 'summary', title, description },
  };
}

export default async function CategoryHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hub = hubFor(slug);
  if (!hub) notFound();

  const games = gamesIn(hub.category);
  const url = absoluteUrl(`/games/category/${hub.slug}/`);

  return (
    <div className="db-wrap">
      {/*
        The schema.org description of the list, on the same terms as the game pages': a
        JSON-LD block is data, and `scripts/emit-host-config.mjs` hashes it into `script-src`
        along with every other src-less script in the export.

        The items point at `/games/<slug>/` rather than at the `/play/` route the cards link
        to. Both exist, and the difference matters to exactly one reader: the game page is
        the one carrying the rule, the controls and its own `VideoGame` block, and it is the
        one the sitemap ranks highest, so it is the one a listing should name.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serialiseJsonLd(
            collectionPageJsonLd(
              { name: hub.title, description: hub.blurb, url },
              games.map((game) => ({
                name: game.name,
                url: absoluteUrl(`/games/${game.slug}/`),
              })),
            ),
          ),
        }}
      />
      <TileSprite games={games} />

      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/games/">All games</Link>
        <span aria-hidden="true">/</span>
        <span>{hub.category}</span>
      </nav>

      <header className={styles.head}>
        <h1 className={styles.title}>{hub.title}</h1>
        <p className={styles.blurb}>{hub.blurb}</p>
        <p className={styles.count}>
          {countLine(games.length)}, played by two people on one device.
        </p>
      </header>

      {/*
        Named by a real heading, so the grid is a landmark a reader can jump to, a stop a
        screen reader's heading key can reach, and a section a test can count.

        It was named by `aria-label` alone, which left every hub with exactly one heading —
        the `h1` — above a grid of up to twenty links, while `/games/` puts the same twenty
        cards under an `h2` of their own. The page built for one category was the page with
        no structure in it. `GameCard` renders a game's name in a `span`, so nothing inside
        the grid supplies one either. The accessible name is unchanged, because it is now
        the heading's own text.
      */}
      <section aria-labelledby={GRID_HEADING_ID}>
        <h2 id={GRID_HEADING_ID} className={styles.gridTitle}>
          {hub.category} games
        </h2>
        <p className={styles.rounds}>{roundLine(games)}</p>
        <div className={styles.grid}>
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>

      <p className={styles.back}>
        <Link href="/games/" className={styles.backLink}>
          All {CATALOGUE.length} games
        </Link>
      </p>
    </div>
  );
}
