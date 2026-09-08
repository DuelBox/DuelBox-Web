'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ACTIVITY_EVENTS,
  IDLE_MS,
  createIdleTimer,
  shouldAttract,
  type AttractEligibility,
} from '@/lib/attract-mode';

/**
 * Twenty seconds of nothing on the catalogue, and then a match plays itself (#165).
 *
 * This is the shell half, and it is written to be small because the catalogue is a shell
 * route: every byte here is paid by every visitor to every non-play page. What it holds is a
 * timer, the listeners that reset it, and a mount. The stage that actually plays — a game
 * module, `@duelbox/engine`, two bots, a canvas — is `AttractStage`, reached through
 * `import()` only once the timer has fired, so a visitor who scrolls, taps or types never
 * pays for it. `SoundToggle` reaches `lib/audio` the same way for the same reason. A plain
 * `import()` rather than `lazy()` + `Suspense`: measured, the pair cost the shell more than
 * the component they were loading.
 *
 * ## Stopping is synchronous
 *
 * The acceptance criterion is "stops instantly on any input", and "instantly" is held to
 * the frame: the activity handler hides the stage's box *itself*, in the same task as the
 * event, and only then asks React to unmount it. A React update from a native listener is
 * flushed in a microtask, which is before the next frame — but a `hidden` attribute set in
 * the handler is before the *end of the handler*, and that is the one nothing can schedule
 * late.
 *
 * ## What is decided here and what is not
 *
 * Save-data, reduced-data and reduced-motion are read here, before the wait even starts, so
 * a device that has asked for less never has a timer running. The battery is read by the
 * stage, because `navigator.getBattery` is asynchronous and the answer belongs beside the
 * decision to start rather than twenty seconds before it. Both go through `shouldAttract`,
 * which is where the rule is written and tested.
 */
export function AttractIdle({ slugs }: { slugs: readonly string[] }) {
  const [stage, setStage] = useState<{ Stage: ComponentType<StageProps> } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (slugs.length === 0) return;
    let wanted = false;
    const timer = createIdleTimer(
      IDLE_MS,
      () => {
        if (!shouldAttract(eligibility())) return;
        wanted = true;
        void import('./AttractStage').then((m) => {
          if (wanted) setStage({ Stage: m.default });
        });
      },
      { schedule: (fn, ms) => setTimeout(fn, ms), cancel: (h) => clearTimeout(h as number) },
    );
    const stop = (): void => {
      wanted = false;
      // First the box, synchronously, then React: see the note above.
      if (box.current) box.current.hidden = true;
      setStage(null);
    };
    const wake = (): void => {
      stop();
      if (!document.hidden) timer.touch();
    };
    for (const name of ACTIVITY_EVENTS) {
      addEventListener(name, wake, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', wake);
    if (shouldAttract(eligibility())) timer.touch();
    return () => {
      timer.cancel();
      for (const name of ACTIVITY_EVENTS) removeEventListener(name, wake, { capture: true });
      document.removeEventListener('visibilitychange', wake);
    };
  }, [slugs]);

  if (stage === null) return null;
  return (
    <div ref={box}>
      <stage.Stage
        slugs={slugs}
        onStop={() => {
          setStage(null);
        }}
      />
    </div>
  );
}

interface StageProps {
  slugs: readonly string[];
  onStop: () => void;
}

/**
 * The facts the shell can read for free. The battery is left null here — the stage reads it
 * asynchronously, just before it starts — and `hidden` is the document's own word.
 */
function eligibility(): AttractEligibility {
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  return {
    saveData: connection?.saveData === true,
    reducedData: matchMedia('(prefers-reduced-data: reduce)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    hidden: document.hidden,
    battery: null,
  };
}
