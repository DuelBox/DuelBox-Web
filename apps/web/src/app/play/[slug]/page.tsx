import type { Metadata } from 'next';
import { CATALOGUE } from '@/data/catalogue.generated';
import { PLAYABLE } from '@/data/registry';
import { suggestNextGame } from '@/data/next-game';
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
  // Resolved here rather than in the browser: this page is statically exported per slug
  // and the suggestion depends on nothing else, so doing it in the client cost every
  // visitor the whole name table for one lookup. See `data/next-game.ts`.
  const nextGame = suggestNextGame(slug);
  return (
    <div className="db-wrap db-fill">
      <PlaySurface slug={slug} nextGame={nextGame} />
    </div>
  );
}
