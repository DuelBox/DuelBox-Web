import type { Presentation } from '@duelbox/engine';

/**
 * A dev-only switch that flips the active presentation live, so a game's two layouts can be
 * eyeballed on one screen without a second device (#1863).
 *
 * ## Why it is stripped from production, and how
 *
 * A toggle that ships to players is worse than no toggle — it is a way to put a game into a
 * presentation the match was not set up for. So it must not reach a production bundle, and the
 * honest way to guarantee that is a build-time flag, exactly as `GameHost`'s debug overlay uses
 * `process.env.NODE_ENV !== 'production'` (which the bundler folds to `false` and deletes).
 *
 * This module cannot read `process.env` itself — the engine and SDK are typed without Node and
 * lint-forbidden from touching the device — so the flag is passed in as `enabled`. The host
 * builds the toggle with `enabled: process.env.NODE_ENV !== 'production'` and, better, only
 * *constructs* it inside that same branch, so in a production build the branch is gone and this
 * code is never reached. Belt and braces: even if it were reached with `enabled: false`, every
 * flip is a no-op and the presentation stays exactly what the match began with.
 *
 * ## It is not simulation
 *
 * Presentation is a placement, never a rule (docs/presentation.md), so flipping it must not
 * disturb the match — and does not: `presentation-parity.test.ts` proves every game steps the
 * identical trace when the presentation is switched underneath it mid-match. The toggle only
 * changes what a game *draws* and where its zones sit, which is the whole point of it.
 */
export interface PresentationToggle {
  /** The presentation in force now. Read this every frame — it may have flipped since the last. */
  readonly presentation: Presentation;
  /** Flip to the other presentation and return it. A no-op that returns the current one when disabled. */
  toggle(): Presentation;
  /** Set a specific presentation. A no-op when disabled. */
  set(presentation: Presentation): void;
  /** Whether flips do anything — false in a production build, so callers can hide the control. */
  readonly enabled: boolean;
}

export function otherPresentation(presentation: Presentation): Presentation {
  return presentation === 'shared-screen' ? 'single-seat' : 'shared-screen';
}

/**
 * Build a presentation toggle.
 *
 * @param initial the presentation the match starts in.
 * @param enabled whether flips take effect. The host passes `process.env.NODE_ENV !== 'production'`
 *   so a production build both disables it and, constructing it inside that branch, drops it
 *   entirely. Defaults to `false`, so a toggle built without thinking is inert rather than live.
 */
export function createPresentationToggle(
  initial: Presentation,
  enabled = false,
): PresentationToggle {
  let current = initial;
  return {
    get presentation(): Presentation {
      return current;
    },
    get enabled(): boolean {
      return enabled;
    },
    toggle(): Presentation {
      if (enabled) current = otherPresentation(current);
      return current;
    },
    set(presentation: Presentation): void {
      if (enabled) current = presentation;
    },
  };
}
