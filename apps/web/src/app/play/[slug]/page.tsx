import type { Metadata } from 'next';
import { CATALOGUE } from '@/data/catalogue.generated';
import { PLAYABLE } from '@/data/registry';
import { PlaySurface } from '@/components/PlaySurface';

/** Only games with a playable build get a play route; the rest keep their catalogue page. */
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
      */}
      <h1 className="db-visually-hidden">Play {game?.name ?? slug}</h1>
      <PlaySurface slug={slug} />
    </div>
  );
}
