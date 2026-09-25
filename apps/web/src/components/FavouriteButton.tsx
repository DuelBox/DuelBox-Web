'use client';

import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n/messages';
import { useMessages } from '@/lib/i18n/use-messages';
import { isFavourite, toggleFavourite } from '@/lib/favourites';
import styles from './FavouriteButton.module.css';

/**
 * The favourite star on a game's own page (#86).
 *
 * Off on the first paint, whatever storage says, because the page is statically exported
 * and the server cannot know what this device has starred; the effect reads the store and
 * the real state replaces the default a frame later, as `PlaySurface.tsx` does with the
 * remembered setup.
 *
 * The visible word is "Favourite" in both states and the accessible name is the action —
 * "Add Chess to favourites", "Remove Chess from favourites" — the same two sentences
 * `favouriteLabel` builds for the catalogue's stars. The word is a substring of both names, so
 * what a sighted player reads is what a voice-control user can say.
 *
 * The two names are written here as `{name}` messages rather than taken from that function
 * (#220): a game's name is a value, so `Add {name} to favourites` is one msgid a translator can
 * put the name anywhere in, where `favouriteLabel`'s concatenation would be 108 msgids the
 * extractor could not see in any case. The English is identical in both places, and
 * `catalogue-filter.ts` keeps the function for the callers this batch does not own.
 */
export function FavouriteButton({
  slug,
  name,
  className,
}: {
  slug: string;
  name: string;
  // `| undefined` because a CSS-module class is `string | undefined` under
  // `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` will not widen it.
  className?: string | undefined;
}) {
  const [on, setOn] = useState(false);
  const messages = useMessages();
  useEffect(() => {
    setOn(isFavourite(slug));
  }, [slug]);
  return (
    <button
      type="button"
      className={className === undefined ? styles.button : `${styles.button} ${className}`}
      aria-pressed={on}
      aria-label={
        on
          ? t(messages, 'Remove {name} from favourites', { name })
          : t(messages, 'Add {name} to favourites', { name })
      }
      onClick={() => {
        setOn(toggleFavourite(slug).includes(slug));
      }}
    >
      <span className={styles.glyph} aria-hidden="true">
        {on ? '★' : '☆'}
      </span>
      {t(messages, 'Favourite')}
    </button>
  );
}
