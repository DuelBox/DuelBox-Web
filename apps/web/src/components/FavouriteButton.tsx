'use client';

import { useEffect, useState } from 'react';
import { favouriteLabel } from '@/lib/catalogue-filter';
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
 * "Add Chess to favourites", "Remove Chess from favourites" — from the same function the
 * catalogue's stars use. The word is a substring of both names, so what a sighted player
 * reads is what a voice-control user can say.
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
  useEffect(() => {
    setOn(isFavourite(slug));
  }, [slug]);
  return (
    <button
      type="button"
      className={className === undefined ? styles.button : `${styles.button} ${className}`}
      aria-pressed={on}
      aria-label={favouriteLabel(name, on)}
      onClick={() => {
        setOn(toggleFavourite(slug).includes(slug));
      }}
    >
      <span className={styles.glyph} aria-hidden="true">
        {on ? '★' : '☆'}
      </span>
      Favourite
    </button>
  );
}
