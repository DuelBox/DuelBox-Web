'use client';

import type { ReactNode } from 'react';
import { t } from '@/lib/i18n/messages';
import { useMessages } from '@/lib/i18n/use-messages';

/**
 * The wordmark's link back to the game's own page, named in the player's language (#220).
 *
 * The visible backlink beside it is a `<T>` in the server component, but this link's name is
 * an `aria-label`, and an attribute cannot hold an element — so the one line that needs `t()`
 * gets the smallest client boundary that can carry it. The wordmark itself arrives as a child
 * rendered by the server: the brand is a literal by design (`Wordmark.tsx`), and nothing here
 * would translate it. This route is not in the root layout, so the boundary is paid once, on
 * the embed payload, and not in the 108 play payloads `docs/i18n.md` guards.
 */
export function EmbedBrandLink({
  href,
  name,
  className,
  children,
}: {
  readonly href: string;
  /** The game's name — a value inside the sentence, never translated. */
  readonly name: string;
  /** The stylesheet's class, `string | undefined` the way a CSS module types it. */
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const messages = useMessages();
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t(messages, 'Play {name} on DuelBox', { name })}
    >
      {children}
    </a>
  );
}
