import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CATALOGUE, type CatalogueEntry } from '@/data/catalogue.generated';
import { CATEGORY_HUBS, gridHeading, hubFor, roundLine } from '@/lib/categories';
import { T } from '@/lib/i18n/T';
import { SITE_SHARE_IMAGE } from '@/lib/share-image';
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
 * is no client directive here and nothing imported that carries one **except the locale
 * lookup**: `GameCard` and `TileSprite` are server components, and the copy is a module of
 * strings. What reaches the browser is finished HTML — which is also what a crawler reads,
 * so the two goals are the same goal.
 *
 * The exception is `<T>` (#220), which is a client component because a server one cannot
 * read the chosen locale. It costs this route no chunk it would not already have: the
 * provider is mounted in the root layout, so the i18n modules are in the shell on every
 * page. With no values it renders the English string itself, so the eighteen exported
 * documents are byte for byte what they were.
 *
 * Everything a reader sees comes from `lib/categories.ts` and is registered for the
 * extractor there; the `metadata` below, including the JSON-LD block, stays English,
 * because a crawler renders no client component and follows no `?lang=`
 * (`docs/i18n.md`). That is why `hub.intent` — which only the description uses — is not
 * registered, and why the description still calls `countLine` and `roundLine` directly.
 */
export function generateStaticParams() {
  return CATEGORY_HUBS.map((hub) => ({ slug: hub.slug }));
}

function gamesIn(category: string): CatalogueEntry[] {
  return CATALOGUE.filter((game) => game.category === category);
}

/**
 * The id that names the games grid.
 *
 * A constant rather than a generated one: this is a server component rendered once per
 * route, so there is exactly one of these per page and nothing to collide with.
 */
const GRID_HEADING_ID = 'category-games';

/**
 * "20 games" — the plural is spelled out because 4 of the 18 categories hold one game.
 *
 * The `description` above is the only thing left that uses it. What the *page* renders goes
 * through the i18n lookup with the number as a value, so that a locale's own plural rule
 * decides the form rather than English's (#220).
 */
function countLine(count: number): string {
  return `${String(count)} ${count === 1 ? 'game' : 'games'}`;
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
    // The site's own card rather than a game's. A hub is eighteen games wide and picking
    // one of them to stand for it would be arbitrary; the montage says "a lot of games",
    // which is what the page is. `images` has to be repeated here at all because a route
    // that declares `openGraph` replaces the layout's object rather than extending it.
    openGraph: { title, description, url, images: [SITE_SHARE_IMAGE] },
    twitter: { card: 'summary', title, description, images: [SITE_SHARE_IMAGE] },
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

      {/* eslint-disable-next-line duelbox/no-untranslated-text -- the landmark's name is an
          attribute, and an attribute in a server component cannot render an element; noted
          with the other untranslated names in the pull request. */}
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/games/">
          <T id="All games" />
        </Link>
        <span aria-hidden="true">/</span>
        <span>
          <T id={hub.category} />
        </span>
      </nav>

      <header className={styles.head}>
        <h1 className={styles.title}>
          <T id={hub.title} />
        </h1>
        <p className={styles.blurb}>
          <T id={hub.blurb} />
        </p>
        <p className={styles.count}>
          <T
            id={
              games.length === 1
                ? '{count} game, played by two people on one device.'
                : '{count} games, played by two people on one device.'
            }
            values={{ count: games.length }}
          />
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
          <T id={gridHeading(hub.category)} />
        </h2>
        <p className={styles.rounds}>
          <T id={roundLine(games)} />
        </p>
        <div className={styles.grid}>
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      </section>

      <p className={styles.back}>
        <Link href="/games/" className={styles.backLink}>
          <T id="All {count} games" values={{ count: CATALOGUE.length }} />
        </Link>
      </p>
    </div>
  );
}
