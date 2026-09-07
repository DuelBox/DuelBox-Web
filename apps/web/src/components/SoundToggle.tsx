'use client';

import { useEffect, useState } from 'react';
import { audio, setSoundMuted, soundPreference } from '@/lib/audio';

/**
 * The one control for sound in the whole product.
 *
 * It lives in the pause menu rather than beside the score, because the score is shared by
 * two people playing and a control there is one either of them can hit by accident on a
 * device they are both reaching across. Pause is already the place a pair stops to change
 * something.
 *
 * There is deliberately **no "enable sound" prompt** anywhere. Unlocking happens off the
 * tap the player was already making (see `lib/audio.ts`), and this button is about a
 * preference, not a permission — a player who never opens it never learns that browsers
 * have an autoplay policy, which is the correct amount to learn about it.
 *
 * The label says which state it is in, in words. Colour carries nothing here, which is
 * rule 7's requirement and also what makes it legible in greyscale and to a screen reader
 * without a second announcement.
 */
export function SoundToggle({ className }: { className?: string | undefined }) {
  /**
   * Starts as the OS-derived default and is corrected in an effect.
   *
   * This site is a static export: `localStorage` does not exist on the build machine, so
   * reading a stored preference during render would make the server's HTML and the
   * browser's first paint disagree. The same reason `PlaySurface` reads `location` in an
   * effect rather than while rendering.
   */
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const stored = soundPreference();
    setMuted(stored.muted);
    // Applied as well as read: the system may have been built before anything was stored,
    // or the preference may have been changed in another tab since this one loaded.
    audio().setMuted(stored.muted);
    audio().setMasterGain(stored.volume);
  }, []);

  return (
    <button
      type="button"
      className={className}
      aria-pressed={muted}
      onClick={() => {
        setMuted(setSoundMuted(!muted));
      }}
    >
      {muted ? 'Sound off' : 'Sound on'}
    </button>
  );
}
