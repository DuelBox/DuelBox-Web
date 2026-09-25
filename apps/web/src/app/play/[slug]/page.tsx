import type { Metadata } from 'next';
import Link from 'next/link';
import { CATALOGUE } from '@/data/catalogue.generated';
import { PLAYABLE } from '@/data/registry';
import { PlaySurface } from '@/components/PlaySurface';
import { T } from '@/lib/i18n/T';

/**
 * Only games with a playable build get a play route; the rest keep their catalogue page.
 *
 * `PLAYABLE` is the registry's answer *after* the kill switch (#208), so a game switched off
 * in `lib/flags.ts` has no exported page here at all and the host answers `/play/<slug>/`
 * with `not-found.tsx`. That is the whole of what this route does about a switch, and it is
 * deliberate: this page is the shell a match mounts into, so there is nothing honest for it
 * to say that the game's own page — which stays, and explains itself — does not say better.
 * A branch here would be code no build can reach, which is the shape of guard this
 * repository keeps finding it never ran.
 */
export function generateStaticParams() {
  return PLAYABLE.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = CATALOGUE.find((entry) => entry.slug === slug);
  return { title: game ? `Play ${game.name}` : 'Play' };
}

export default async function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = CATALOGUE.find((entry) => entry.slug === slug);
  return (
    <div className="db-wrap db-fill">
      {/*
        The only route in the site with no heading at all, which is what `e2e/axe.spec.ts`
        reports as `page-has-heading-one` (#181). A screen-reader user lands here from a
        catalogue of 108 links and the first thing they can ask a page is what it is; on
        this one there was nothing to answer with, in any phase — the lobby's `h2` names the
        game but is not a level one, and once a match starts even that is gone.

        Visually hidden, because the board is the page and a title above it would take space
        two people sharing a phone do not have. Rendered here rather than in `PlaySurface`
        deliberately: this is a server component, so the heading is in the exported HTML and
        costs the shell budget nothing, and it is present in every phase rather than only in
        the ones a client component happens to render.

        A `<T>` rather than a literal, and the one in this territory whose price had to be
        argued (#220): a server component's translated copy is serialised into the route
        payload, and this route has 108 of them. Measured on the built export by rewriting
        the element back to plain text in every payload and gzipping again — the number is in
        the commit — and `speculatedBytes` still clears its budget, so the only heading a
        screen-reader user gets on this page is translated like the rest of the copy. The
        `<noscript>` below is deliberately not: nothing in it is translated anywhere on the
        site, and it is already the most expensive markup on this line.
      */}
      <h1 className="db-visually-hidden">
        <T id="Play {name}" values={{ name: game?.name ?? slug }} />
      </h1>
      {/*
        What a visitor with scripting off is told, instead of being told to wait.

        `PlaySurface` starts at `loadState === 'loading'` and only leaves it from an effect,
        so with no script its panel says "Loading …" and never resolves — on the destination
        every card on the site links to, with the footer hidden by `globals.css` and the
        header the only way out. A game is a canvas driven by a fixed-timestep loop and there
        is no version of it that runs without script; that is a limit rather than a defect.
        Saying so was the part that was missing, and `e2e/no-javascript.spec.ts` asserts this
        is what the page shows.

        Here rather than in `PlaySurface`, for the reason the heading above is here: this is a
        server component, so it is in the exported HTML rather than in a chunk. The browser
        renders a `<noscript>` only when scripting is off, so a visitor with script sees none
        of it.

        It does not follow that it is free, and this block is the measurement that says so.
        Server-rendered markup costs neither *JavaScript* budget — but the router's payload
        for this route carries it too, and `next/link` fetches that payload for every card a
        catalogue browse scrolls past. Measured by stripping this block out of each of the
        108 built payloads and gzipping them again: 207 bytes here, **22.4 KB speculated on
        every visitor who browses the grid**, for a block only a visitor with scripting off
        ever reads. That is more than the whole batch cost on both script budgets put
        together, and nothing could see it until `speculatedBytes` in `size-budget.json`.
        It is worth keeping — a page that tells somebody to wait forever is worse — but
        "costs nothing" was the wrong sentence, and it was written here first.
      */}
      <noscript>
        <div className="db-panel">
          <h2>A game needs JavaScript</h2>
          <p>
            Every match runs in your own browser — the rules, the bot and the physics are all on
            this device — so with scripting switched off there is nothing here to play.
          </p>
          <p>
            The rest of the site works without it. Every game has a page of its own with its rules
            and its controls written out: start from <Link href="/games/">all the games</Link>, or
            read <Link href="/how-to-play/">How to play</Link>.
          </p>
        </div>
      </noscript>
      <PlaySurface slug={slug} />
    </div>
  );
}
