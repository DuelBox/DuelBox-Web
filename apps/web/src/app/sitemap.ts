import { execFileSync } from 'node:child_process';
import type { MetadataRoute } from 'next';
import { CATALOGUE } from '../data/catalogue.generated';
import { PLAYABLE } from '../data/registry';
import { absoluteUrl } from '../lib/site';

/**
 * `/sitemap.xml`, generated at build time from the lists the routes are built from (#199).
 *
 * A metadata route rather than a file in `public/`, because a file would be right for
 * exactly as long as nobody added a game. This reads `CATALOGUE` for the game pages and
 * `PLAYABLE` for the play routes — the same two sources `generateStaticParams` reads — so a
 * game registered today is in the sitemap in the same build, and a game the site has no page
 * for cannot be in it either.
 */

type Entry = MetadataRoute.Sitemap[number];

/**
 * Declared static for the reason `robots.ts` gives: Next's export mode refuses a metadata
 * route that has not said so, and rendering once at build is the only thing this can be.
 */
export const dynamic = 'force-static';

/**
 * One `lastmod` for every entry, and it is the commit's date rather than each page's.
 *
 * Per-page dates would be the nicer signal and would be a lie in the one place this runs. The
 * exported HTML of every page changes on every deploy — chunk names are hashed, so an edit
 * anywhere renames scripts that every page references — and the deploy workflow checks out
 * with depth 1, so `git log` has one commit to answer with whatever file it is asked about.
 * Both point at the same honest answer: everything was last modified when HEAD was committed.
 *
 * The committer date rather than the build's clock, so that rebuilding the same commit says
 * the same thing and a crawler is not told to come back for nothing. The clock is only the
 * fallback for a checkout without git — an exported tarball, a bare `next build` in a
 * container — where the alternative is no date at all.
 *
 * Computed once, at module load: the build calls the route exactly once, and a hundred and
 * thirty entries do not need a hundred and thirty subprocesses to agree.
 */
function headCommittedAt(): Date {
  try {
    const stdout = execFileSync('git', ['log', '-1', '--format=%cI'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const committed = new Date(stdout.trim());
    if (!Number.isNaN(committed.getTime())) return committed;
  } catch {
    // No git on the path, or no repository around this checkout. The build's own time is
    // the best answer left, and the comment above says why it is only the second best.
  }
  return new Date();
}

const lastModified = headCommittedAt();

export default function sitemap(): MetadataRoute.Sitemap {
  const playable = new Set(PLAYABLE);
  return [
    { url: absoluteUrl('/'), lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/games/'), lastModified, changeFrequency: 'weekly', priority: 0.9 },
    { url: absoluteUrl('/how-to-play/'), lastModified, changeFrequency: 'monthly', priority: 0.6 },
    { url: absoluteUrl('/privacy/'), lastModified, changeFrequency: 'yearly', priority: 0.3 },
    { url: absoluteUrl('/terms/'), lastModified, changeFrequency: 'yearly', priority: 0.3 },
    // The catalogue page is the one that earns search traffic: it carries the rule, the
    // controls and the related games, where the play route is a shell that fills itself in
    // on the client. A page whose game is not built yet still exists and still ranks, but
    // lower, so a crawler with a budget spends it on the games a visitor can play.
    ...CATALOGUE.map((game): Entry => ({
      url: absoluteUrl(`/games/${game.slug}/`),
      lastModified,
      changeFrequency: 'monthly',
      priority: playable.has(game.slug) ? 0.8 : 0.5,
    })),
    ...PLAYABLE.map((slug): Entry => ({
      url: absoluteUrl(`/play/${slug}/`),
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    })),
  ];
}
