import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CATALOGUE } from '@/data/catalogue.generated';
import { categorySlug } from '@/lib/categories';
import { offeredModes } from '@/lib/match-setup';
import { killSwitchFor } from '@/lib/flags';
import { formatRound } from '@/lib/format';
import type { Opponent } from '@/lib/head-to-head';
import { T } from '@/lib/i18n/T';
import { SEAT_CHARACTERS } from '@/lib/seats';
import { SITE_SHARE_IMAGE, shareImageFor } from '@/lib/share-image';
import { absoluteUrl } from '@/lib/site';
import { serialiseJsonLd, videoGameJsonLd } from '@/lib/structured-data';
import { FavouriteButton } from '@/components/FavouriteButton';
import { GameRecord } from '@/components/GameRecord';
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
  /**
   * This game's own card, composed at build time from its own tile (#2453).
   *
   * The fallback is the site's montage rather than nothing: a game whose picture the build
   * did not emit still shares as a DuelBox link rather than as a bare title. That case is a
   * bug and `share-image.test.ts` fails on it — but it fails in the test run, where somebody
   * is looking, instead of in a preview nobody on this side of the link ever sees.
   */
  const image = shareImageFor(game.slug, game.name) ?? SITE_SHARE_IMAGE;
  return {
    title: game.name,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images: [image] },
    twitter: { card: 'summary', title, description, images: [image] },
  };
}

/**
 * The three offers, as elements rather than strings since #220.
 *
 * A `<T>` per line, because the id has to be a literal the extractor can read by shape — a
 * table of English strings rendered through one `<T id={copy.title} />` would need this module
 * registered in `sources.ts`, and a page is not a data module. The elements are built once at
 * module scope, exactly as the strings were, and render the same text they always did.
 */
const MODE_COPY: Record<string, { title: ReactNode; body: ReactNode }> = {
  friend: {
    title: <T id="Play together here" />,
    body: <T id="Two of you on this device, sharing the screen." />,
  },
  bot: {
    title: <T id="Play against a bot" />,
    // Seat two, always: `botSeatsFor()` hands the bot `p2` and nothing else. The name is a
    // value rather than part of the sentence: `lib/seats.ts` owns it and it is not translated.
    body: (
      <T id="{seat} takes the other seat, at three levels." values={{ seat: SEAT_CHARACTERS.p2 }} />
    ),
  },
  solo: {
    title: <T id="Play solo" />,
    body: <T id="Chase your own best score, no opponent needed." />,
  },
};

/**
 * The head-to-head this device has for this game, one row per kind of match (#162).
 *
 * Keyed by mode and read exactly as `MODE_COPY` above is, so a mode with no head-to-head in
 * it falls out rather than needing a rule of its own: `solo` is one person against their own
 * best score, and there is nobody on the other side of it to be ahead of.
 *
 * `far` is what the wins on the other side of the line are called — the far seat's own name
 * between two people, and the bot where a bot is sitting in it, since `botSeatsFor()` hands
 * the bot seat two and nothing else. The near side is the near seat in both rows for the
 * same reason.
 */
const RECORD_ROWS: Record<string, { title: ReactNode; opponent: Opponent; far: ReactNode }> = {
  friend: {
    title: <T id="Between the two of you" />,
    opponent: 'friend',
    far: SEAT_CHARACTERS.p2,
  },
  // `far` is a node: `GameRecord` puts it into its sentence through `<T values>`, so the
  // page can hand it a translated word where the friend row hands it a name (#220).
  bot: { title: <T id="Against the bot" />, opponent: 'bot', far: <T id="the bot" /> },
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

  /**
   * The third case, and the reason this page is the one a switched-off game keeps (#208).
   *
   * A game the kill switch has taken off the site has no play route, so every link to it
   * lands here — and "still being built" would be a lie about a game that was built, played
   * and then found broken. It is asked first because a switched-off game still has its
   * controls table, so the branch below would otherwise offer a match this build cannot
   * start.
   */
  const switchedOff = killSwitchFor(game.slug);

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
      {/*
        The one string on this page still in English, and it is an attribute. A server
        component cannot call `t()` — the catalogue lives in a context only a client component
        can read — and `<T>` renders an element, which an `aria-label` cannot hold. The choices
        were to lift this `<nav>` into a client component, which puts a client boundary and its
        payload on all 108 of these pages for one word, or to leave it and say so. It is left,
        and `/games/category/[slug]/page.tsx` has the identical line; both want one small
        client wrapper, or a server-side lookup, which is a change to the framework rather than
        to this page.
      */}
      {/* eslint-disable-next-line duelbox/no-untranslated-text */}
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/games/">
          <T id="All games" />
        </Link>
        <span aria-hidden="true">/</span>
        <span>{game.name}</span>
      </nav>

      <div className={styles.top}>
        <div className={styles.art}>
          <GameTile game={game} />
        </div>

        <div className={styles.detail}>
          <p className={styles.eyebrow}>
            <T id={game.category} /> · <T id={formatRound(game.roundSeconds)} />
          </p>
          <h1 className={styles.title}>{game.name}</h1>
          {/*
            The rule is copy that lives in a data module, so the id is the variable and the 108
            sentences it can resolve to are registered in `lib/i18n/sources.ts` — the shape
            `docs/i18n.md` prescribes for a string the extractor cannot see at the call site.
          */}
          {game.rule ? (
            <p className={styles.rule}>
              <T id={game.rule} />
            </p>
          ) : null}

          {/*
            `offeredModes`, not `game.modes`, and the difference is six live broken promises.

            The manifest's vocabulary is `friend | bot | solo`; the shell's `PlayMode` is
            `friend | bot`. Nothing in `apps/web` seats one player alone — there is no route,
            no reducer state and no seating rule for it — so `solo` is a mode this build
            cannot start. Six games declare it anyway (animal-stack, blocks, brainrot-stack,
            maze-paint, solitaire, sudoku), and each of their pages was rendering a card
            reading "Play solo — Chase your own best score, no opponent needed." one click
            away from a lobby that offers "Play together here" and "Play against Pip" and
            nothing else.

            The declarations are not wrong and are deliberately left alone: they record what
            the genre does, which is what `data/catalog.yaml` and the manifests were made to
            agree about (#2531), and `packages/games/solitaire/src/manifest.ts` says as much
            in its own comment. `scripts/validate-manifests.mjs` names all six and points at
            #1749 so the gap is visible rather than lost. What was wrong was this page
            treating an observation as an offer. It advertises what a player can actually
            press, and nothing else.

            Withheld entirely from a switched-off game, for the same reason one level up:
            every one of these cards is written as an offer, and an offer sitting a line
            above "switched off at the moment" is a page contradicting itself in the reader's
            own eyeline. CLAUDE.md's eighth and ninth entries are both that shape.
          */}
          {switchedOff ? null : (
            <div className={styles.modes}>
              {offeredModes(game.modes).map((mode) => {
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
          )}

          {switchedOff ? (
            <p className={styles.soon}>
              <T
                id="{game} is switched off at the moment. {reason} It comes back on here as soon as that is put right, and nothing else in the catalogue is affected."
                values={{
                  // The name is a name; the reason is a sentence somebody wrote for a player,
                  // so it goes through the lookup like the rule above and is registered in
                  // `sources.ts`. The list is empty in a healthy build, which is why nothing
                  // it contributes appears in the catalogues today.
                  game: game.name,
                  reason: <T id={switchedOff.reason} />,
                }}
              />
            </p>
          ) : controls ? (
            <>
              <Link href={`/play/${game.slug}/`} className={styles.play}>
                <T id="Play {game}" values={{ game: game.name }} />
              </Link>
              <FavouriteButton slug={game.slug} name={game.name} className={styles.favourite} />
              <dl className={styles.controls}>
                <dt>
                  <T id="On a keyboard" />
                </dt>
                <dd>
                  <T id={controls.keyboard} />
                </dd>
                {controls.pointer ? (
                  <>
                    <dt>
                      <T id="By touch" />
                    </dt>
                    <dd>
                      <T id={controls.pointer} />
                    </dd>
                  </>
                ) : null}
              </dl>

              {/*
                What the two of you have done at this one (#162), which until now existed
                only in storage and on the settings page's five most played.

                Everything here but the six numbers is server-rendered: the heading, the two
                row labels and the note are markup, and `scripts/check-size.mjs` counts
                JavaScript, so the words are free and only the counts are paid for. That is
                also why the labels are props on `GameRecord` rather than strings inside it.

                It is the last thing in this column deliberately. The counts arrive a frame
                after the page paints, and while the rows are in the exported HTML either
                way — dashes until the read lands — a block whose height could change is
                better below the controls than above them.
              */}
              <section className={styles.record}>
                <h2 className={styles.recordTitle}>
                  <T id="Your record here" />
                </h2>
                <dl className={styles.tallies}>
                  {game.modes.map((mode) => {
                    const row = RECORD_ROWS[mode];
                    if (!row) return null;
                    return (
                      <div key={mode}>
                        <dt>{row.title}</dt>
                        <dd>
                          <GameRecord
                            slug={game.slug}
                            opponent={row.opponent}
                            near={SEAT_CHARACTERS.p1}
                            far={row.far}
                          />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                <p className={styles.recordNote}>
                  <T id="Counted on this device only, kept in this browser and sent nowhere. The settings page clears it." />
                </p>
              </section>
            </>
          ) : (
            <p className={styles.soon}>
              <T id="This game is still being built. Its rules and controls are settled; the playable build lands with its milestone." />
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
            {/*
              Two ids rather than one with a `{more}` in it: "More" and "All" are the whole
              difference between the two headings, and a conditional between two literals is a
              shape the extractor reads. The category travels as a value and is translated on
              its own, in the lower-case spelling this sentence puts it in — registered beside
              the capitalised names in `lib/i18n/sources.ts`, because case belongs to the
              position in a sentence and a locale may not lower-case the way English does.
            */}
            <T
              id={related.length > 0 ? 'More {category} games' : 'All {category} games'}
              values={{ category: <T id={game.category.toLowerCase()} /> }}
            />
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
