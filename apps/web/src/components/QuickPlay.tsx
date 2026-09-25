'use client';

import { useRouter } from 'next/navigation';
import { t } from '@/lib/i18n/messages';
import { useMessages } from '@/lib/i18n/use-messages';
import { pickQuickPlay } from '@/lib/quick-play';
import { readRecent } from '@/lib/recent';

/**
 * "Surprise me": open a game the player did not choose (#163).
 *
 * A button rather than a link, because the destination is not known until it is pressed —
 * it depends on what was played recently, which only this device knows — and because
 * `e2e/smoke.spec.ts` fetches every link in the header to prove none is dead, which a link
 * with no fixed target could never pass.
 *
 * `slugs` are handed in by a server page from the registry. The registry carries a dynamic
 * import for every game, and a client component that imported it would put all hundred
 * and eight loaders in the shell; a list of strings costs nothing.
 *
 * `Math.random` is fine here and forbidden in `packages/**`: this is shell, not
 * simulation, and nothing about a match depends on which game it opened.
 */
export function QuickPlay({
  slugs,
  className,
}: {
  slugs: readonly string[];
  // `| undefined` because a CSS-module class is `string | undefined` under
  // `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` will not widen it.
  className?: string | undefined;
}) {
  const router = useRouter();
  const messages = useMessages();
  if (slugs.length === 0) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        const slug = pickQuickPlay(slugs, readRecent(), Math.random);
        if (slug !== undefined) router.push(`/play/${slug}/`);
      }}
    >
      {t(messages, 'Surprise me')}
    </button>
  );
}
