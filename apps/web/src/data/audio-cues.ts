import type { SoundEvent } from '@duelbox/engine';

/**
 * Issue #180: **no cue may be carried by sound alone.**
 *
 * Every sound the product can make is here, beside the thing a player sees instead of
 * hearing it, and beside a piece of real source that produces that thing. The list of
 * cues is closed (`SOUND_EVENTS`), which is what makes the promise checkable at all: an
 * open vocabulary turns #180 into a sentence nothing can enforce, which is the failure
 * this repository keeps finding in its own guards.
 *
 * `audio-cues.test.ts` reads every `file` and requires every `token`, so the guard fails
 * in both directions that matter:
 *
 * - a cue with no declared counterpart, and
 * - a declared counterpart whose drawing code has been deleted.
 *
 * The second is the one worth having. A table that only refers to itself would pass for
 * ever; a table that names a line of code goes red when somebody removes the line.
 */
export interface VisualCue {
  /** What a player sees, in the player's terms. */
  readonly indicator: string;
  /** Path from the repository root of the file that produces it. */
  readonly file: string;
  /** Text that must appear in that file. Deleting the drawing deletes the token. */
  readonly token: string;
}

/**
 * The four cues the match flow owns. Their counterparts are all in the shared overlay and
 * the shared HUD, which is the point: 107 games inherit them without writing anything.
 */
export const SHELL_CUE_VISUALS: Readonly<Record<'countdown' | 'start' | 'pause' | 'win', VisualCue>> =
  {
    countdown: {
      indicator: 'the count itself, shown as a numeral over the board and announced live',
      file: 'apps/web/src/components/MatchOverlay.tsx',
      token: '<Countdown remaining={state.countdownRemaining} />',
    },
    start: {
      indicator: 'the count reaching "Go", in the same place the numerals were',
      file: 'apps/web/src/components/MatchOverlay.tsx',
      token: "const label = count <= 0 ? 'Go' : String(count);",
    },
    pause: {
      indicator: 'the pause panel covering the board',
      file: 'apps/web/src/components/MatchOverlay.tsx',
      token: '<Panel heading="Paused" role="dialog">',
    },
    win: {
      indicator: 'the result panel naming the winning seat by glyph and by name',
      file: 'apps/web/src/components/MatchOverlay.tsx',
      token: 'className={styles.winner}',
    },
  };

/**
 * What a game must show for each cue it is allowed to raise.
 *
 * A specification, not an implementation: it is what somebody wiring the hundred-and-sixth
 * game reads before choosing a name. The per-game table below is where the implementation
 * is named, and the guard requires one for every cue a game actually emits.
 */
export const GAME_CUE_REQUIREMENT: Readonly<
  Record<'hit' | 'bounce' | 'launch' | 'score' | 'fault' | 'select', string>
> = {
  hit: 'a marker at the point of contact, held long enough to be seen at a glance',
  bounce: 'a marker on the surface that was struck, at the point it was struck',
  launch: 'a marker where the thing was released, or the thing visibly leaving',
  score: 'the tally changing, which the shared HUD already shows and announces',
  fault: 'a marker on the attempt that failed, distinct from the one for a hit',
  select: 'the chosen thing visibly changing state — filled, lifted, outlined',
};

/**
 * Games wired to the bus, and what each of their cues looks like.
 *
 * One entry today. The other 106 are follow-up work, and the guard is written so that the
 * hundred-and-seventh cannot be added without an entry here: a game that emits a cue with
 * no counterpart fails, and an entry naming a cue the game never emits fails too, so the
 * table cannot rot in either direction.
 */
export const GAME_CUE_VISUALS: Readonly<
  Record<string, Readonly<Partial<Record<SoundEvent, VisualCue>>>>
> = {
  // Cricket had an entry here for about an hour, and losing it is the best evidence this
  // table works. It landed emitting six cues while absent from this file entirely, so
  // nothing checked them (#2519); the registry sweep in the test caught that, `win` and
  // `bounce` came out of the game, and the other four were declared against real drawing
  // code. Then Cricket was made silent on main — `GameContext.audio` is not there yet —
  // and the *opposite* assertion caught the entry that had gone stale, naming it: "cricket
  // is declared as wired and raised no cue at all". Both directions have now failed for a
  // real reason rather than a contrived one.

  'air-hockey': {
    hit: {
      indicator: 'a bright ring around the puck where the mallet met it',
      file: 'packages/games/air-hockey/src/game.ts',
      token: 'this.#impactSteps = FLASH_STEPS;',
    },
    bounce: {
      indicator: 'a bright length of the rail the puck came off',
      file: 'packages/games/air-hockey/src/game.ts',
      token: 'this.#wallSteps = FLASH_STEPS;',
    },
    launch: {
      indicator: 'a flare on the centre spot the puck has just left',
      file: 'packages/games/air-hockey/src/game.ts',
      token: 'this.#serveSteps = FLASH_STEPS;',
    },
    score: {
      indicator: "the seat's score in the shared HUD changing, and bumping as it does",
      file: 'apps/web/src/components/MatchHud.tsx',
      token: 'const bumped = useScoreBump(score);',
    },
  },


};
