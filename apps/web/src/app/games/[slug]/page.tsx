import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CATALOGUE } from '@/data/catalogue.generated';
import { categorySlug } from '@/lib/categories';
import { formatRound } from '@/lib/format';
import { SEAT_CHARACTERS } from '@/lib/seats';
import { absoluteUrl } from '@/lib/site';
import { serialiseJsonLd, videoGameJsonLd } from '@/lib/structured-data';
import { FavouriteButton } from '@/components/FavouriteButton';
import { GameTile } from '@/components/GameTile';
import { GameCard } from '@/components/GameCard';
import { TileSprite } from '@/components/TileSprite';
import { CONTROLS } from '@/data/controls';
import styles from './page.module.css';

/**
 * One indexable page per game. Generated at build time — a client-rendered games portal
 * earns no organic traffic, and a static page costs nothing to serve.
 */
export function generateStaticParams() {
  return CATALOGUE.map((game) => ({ slug: game.slug }));
}

function find(slug: string) {
  return CATALOGUE.find((game) => game.slug === slug);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = find(slug);
  if (!game) return { title: 'Game not found' };
  const description = game.rule || `${game.name} — a two-player game you can play in the browser.`;
  const title = `${game.name} — DuelBox`;
  const url = absoluteUrl(`/games/${game.slug}/`);
  return {
    title: game.name,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url },
    twitter: { card: 'summary', title, description },
  };
}

const MODE_COPY: Record<string, { title: string; body: string }> = {
  friend: {
    title: 'Play together here',
    body: 'Two of you on this device, sharing the screen.',
  },
  bot: {
    title: 'Play against a bot',
    // Seat two, always: `botSeatsFor()` hands the bot `p2` and nothing else.
    body: `${SEAT_CHARACTERS.p2} takes the other seat, at three levels.`,
  },
  solo: {
    title: 'Play solo',
    body: 'Chase your own best score, no opponent needed.',
  },
};

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = find(slug);
  if (!game) notFound();

  const related = CATALOGUE.filter(
    (other) => other.category === game.category && other.id !== game.id,
  ).slice(0, 6);

  /**
   * A playable game gets a way to play it; an unbuilt one gets an honest note.
   *
   * Every one of these hundred and seven pages used to carry the note, including the
   * twenty-two that were playable — a page telling a player the game is not ready while
   * the game sits one click away.
   */
  const controls = CONTROLS.get(game.slug);

  return (
    <div className="db-wrap">
      {/*
        The schema.org description of this game, for search engines (#198). A JSON-LD block
        is data, not code: no browser executes it, so the page's CSP is not what gates it.
        `scripts/emit-host-config.mjs` hashes every src-less script it finds in the export,
        this one included, and the hash it adds to `script-src` is harmless.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serialiseJsonLd(videoGameJsonLd(game, absoluteUrl(`/games/${game.slug}/`))),
        }}
      />
      <TileSprite games={[game, ...related]} />
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/games/">All games</Link>
        <span aria-hidden="true">/</span>
        <span>{game.name}</span>
      </nav>

      <div className={styles.top}>
        <div className={styles.art}>
          <GameTile game={game} />
        </div>

        <div className={styles.detail}>
          <p className={styles.eyebrow}>
            {game.category} · {formatRound(game.roundSeconds)}
          </p>
          <h1 className={styles.title}>{game.name}</h1>
          {game.rule ? <p className={styles.rule}>{game.rule}</p> : null}

          <div className={styles.modes}>
            {game.modes.map((mode) => {
              const copy = MODE_COPY[mode];
              if (!copy) return null;
              return (
                <div key={mode} className={styles.mode}>
                  <strong>{copy.title}</strong>
                  <span>{copy.body}</span>
                </div>
              );
            })}
          </div>

          {controls ? (
            <>
              <Link href={`/play/${game.slug}/`} className={styles.play}>
                Play {game.name}
              </Link>
              <FavouriteButton slug={game.slug} name={game.name} className={styles.favourite} />
              <dl className={styles.controls}>
                <dt>On a keyboard</dt>
                <dd>{controls.keyboard}</dd>
                {controls.pointer ? (
                  <>
                    <dt>By touch</dt>
                    <dd>{controls.pointer}</dd>
                  </>
                ) : null}
              </dl>
            </>
          ) : (
            <p className={styles.soon}>
              This game is still being built. Its rules and controls are settled; the playable build
              lands with its milestone.
            </p>
          )}
        </div>
      </div>

      {/*
        The heading is a link, so the six related games below it are a sample of a category
        rather than the end of the road: the hub has the rest (#200).

        It sits *outside* the grid's guard, and that is the whole of it. Rhythm, Stealth,
        Deduction and Racing & Trails hold one game each, so on those four pages `related`
        is empty — and while the link lived inside the guard those four hubs had no inbound
        link from anywhere on the site. The footer carries the six largest only, and the
        catalogue's category chips are filter buttons rather than links, so the sitemap knew
        about four pages that no reader could reach, which is exactly what `SiteFooter.tsx`
        says the hubs exist to avoid.
      */}
      <section className={styles.related}>
        <h2 className={styles.relatedTitle}>
          <Link href={`/games/category/${categorySlug(game.category)}/`}>
            {related.length > 0 ? 'More' : 'All'} {game.category.toLowerCase()} games
          </Link>
        </h2>
        {related.length > 0 ? (
          <div className={styles.grid}>
            {related.map((other) => (
              <GameCard key={other.id} game={other} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
