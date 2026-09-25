import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CATALOGUE } from '@/data/catalogue.generated';
import { PLAYABLE } from '@/data/registry';
import { absoluteUrl } from '@/lib/site';
import { embedBacklinkPath, embedStaticParams } from '@/lib/embed';
import { T } from '@/lib/i18n/T';
import { Wordmark } from '@/components/Wordmark';
import { EmbedBrandLink } from './EmbedBrandLink';
import { EmbedFrame } from './EmbedFrame';
import styles from './page.module.css';

/**
 * The embeddable view of one game (#202, #2367).
 *
 * A portal frames this route, the game plays inside it, and DuelBox's name and a link back to
 * the game's own page ride along — the two things a free distribution channel is asked to
 * carry. The branding and the backlink are rendered here, in the server component, so they are
 * in the exported HTML and present with JavaScript disabled; the client `EmbedFrame` enforces
 * the frame allowlist and owns the `postMessage` channel on top of that.
 *
 * The backlink's sentence is one msgid with the game's name as a value (#220): the visible
 * text through `<T>`, which a server component can render, and the wordmark link's
 * `aria-label` through `EmbedBrandLink`, because an attribute cannot hold an element. The
 * `metadata` title stays English, like every other, for the crawlers that read it.
 *
 * The embed holds nothing authenticated or personal — there is none anywhere in this product —
 * and it is marked `noindex`: the game's own page is the canonical, indexable one, and a
 * hundred embed URLs competing with it in search would only split the signal.
 */

export function generateStaticParams() {
  return embedStaticParams();
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
  return {
    title: game ? `${game.name} — DuelBox embed` : 'DuelBox embed',
    // A distribution surface, not a page to index; the game's own page is canonical.
    robots: { index: false, follow: true },
    alternates: { canonical: absoluteUrl(embedBacklinkPath(slug)) },
  };
}

export default async function EmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = find(slug);
  // Only a playable game gets an embed; an unknown or unbuilt slug is a 404 rather than an
  // empty frame. `generateStaticParams` builds exactly the playable set, so this is a guard
  // for a hand-typed URL rather than a path the router reaches on its own.
  if (!game || !PLAYABLE.includes(slug)) notFound();

  const backlinkHref = absoluteUrl(embedBacklinkPath(slug));

  return (
    <div className={styles.embed}>
      <div className={styles.stage}>
        <EmbedFrame slug={slug} gameName={game.name} backlinkHref={backlinkHref} />
      </div>
      <footer className={styles.attribution}>
        <EmbedBrandLink className={styles.brand} href={backlinkHref} name={game.name}>
          <Wordmark />
        </EmbedBrandLink>
        <a
          className={styles.backlink}
          href={backlinkHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          <T id="Play {name} on DuelBox" values={{ name: game.name }} />
        </a>
      </footer>
    </div>
  );
}
