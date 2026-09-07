import { soundEventSpec, type SoundEvent } from '@duelbox/engine';

/**
 * What a player *sees* for every sound this product may play (#180).
 *
 * ## The acceptance criterion, and the honest state of it
 *
 * No information may be carried by sound alone. Today nothing is carried by sound at all —
 * there is no sound file in the repository (#169, #170) and no game emits a cue — so the
 * deliverable is not a list of fixes, it is the mapping and the guard: every name in the
 * vocabulary is answered here with the thing that is drawn instead, and
 * `sound-visuals.test.ts` fails when a cue has no answer, when the answer names a piece of
 * the shell that has stopped existing, or when a game emits a cue nobody declared.
 *
 * The reason to build the guard before the sounds is that a sound arrives one commit at a
 * time and each one is individually obviously fine. The check has to be older than the
 * library it is checking, or it is written after the first cue that needed it.
 *
 * ## Why the coverage is derived and not listed
 *
 * Issue #2519 was this guard, done once and useless: it walked its own table and asked
 * whether each row had a visual, so a cue that was never added to the table was a cue the
 * check could not see — and the cue nobody remembered to declare is exactly the cue nobody
 * remembered to draw. A guard whose coverage is a hand-maintained list stops covering the
 * thing it was written for, silently, on the day somebody forgets.
 *
 * So nothing here is the source of coverage. This table is typed
 * `Record<SoundEvent, …>` — the compiler fails the build when a cue in
 * `packages/engine/src/sound-events.ts` has no row, and fails it again for a row that
 * answers a cue the vocabulary does not have. The test then walks the vocabulary for what a
 * type cannot check, and walks **every game package on disk** for cues being emitted, which
 * is the half #2519 was missing: a game that emits an undeclared cue is found by reading the
 * catalogue, not by reading this file.
 *
 * ## Where a counterpart lives
 *
 * Two kinds. `shell` means the shell already draws it, in a named file, and the guard holds
 * that file to it. `game` means it is each game's own drawing, and the entry says what the
 * game owes — checkable only by a QA pass and by the emission scan below, which is the
 * honest limit of a static check over a hundred and eight renderers.
 */

export type VisualCounterpart =
  | {
      readonly kind: 'shell';
      /** What a player sees, in the words somebody reviewing the screen would use. */
      readonly shows: string;
      /** Repo-relative source file that draws it. */
      readonly source: string;
      /** A string that must appear in that file's code, so the counterpart cannot vanish
       *  quietly. Comments are stripped before the search — prose about a thing is not the
       *  thing. */
      readonly marker: string;
    }
  | {
      readonly kind: 'game';
      readonly shows: string;
      /** What a game owes before it may emit this cue at all. */
      readonly requires: string;
    };

const OVERLAY = 'apps/web/src/components/MatchOverlay.tsx';

/**
 * One row per cue. Missing a row is a compile error; see the note above.
 */
export const VISUAL_COUNTERPARTS: Readonly<Record<SoundEvent, VisualCounterpart>> = {
  countdown: {
    kind: 'shell',
    shows: 'The count filling the middle of the board, one number a second, in the overlay.',
    source: OVERLAY,
    marker: '<Countdown remaining={state.countdownRemaining}',
  },
  /*
   * `start` is the weakest row here and it is worth saying so out loud rather than dressing
   * it up. What a player sees is the count-in overlay *leaving* — a number that filled the
   * board is suddenly gone and the board is live — which is real, unmissable and drawn, but
   * it is the absence of a thing rather than a thing.
   *
   * The stylesheet has a `.go` rule and `Countdown` has a `count <= 0 ? 'Go'` branch that
   * would have been the obvious answer, and neither can ever render: `reduce` leaves the
   * countdown phase on the same step that would have taken the remaining time to zero, so
   * `countdownRemaining` is above zero for every frame that branch is drawn on. A visual
   * counterpart that never appears is worse than admitting there is none — that is cricket's
   * `bounce`, and the reason its cue is not emitted — so it is not claimed here. Making "Go"
   * real needs either a shell-side timer or a step the match machine holds at zero, and both
   * are design decisions rather than wiring.
   */
  start: {
    kind: 'shell',
    shows: 'The count-in overlay clears from the board, and the board starts moving.',
    source: OVERLAY,
    marker: "case 'countdown':",
  },
  pause: {
    kind: 'shell',
    shows: 'The pause panel, named, over a board that has visibly stopped.',
    source: OVERLAY,
    marker: 'heading="Paused"',
  },
  'round-over': {
    kind: 'shell',
    shows: 'The round panel: who took the round, the running tally, and a filled pip in the HUD.',
    source: OVERLAY,
    marker: 'outcome={state.roundOutcome}',
  },
  'match-win': {
    kind: 'shell',
    shows: "The result panel naming the winner, with that seat's own glyph beside the name.",
    source: OVERLAY,
    marker: '{seatNames[outcome]} wins',
  },
  'match-draw': {
    kind: 'shell',
    shows: 'The result panel reading "A draw", with no seat glyph on it.',
    source: OVERLAY,
    marker: 'A draw',
  },

  launch: {
    kind: 'game',
    shows: 'The launched thing drawn leaving, at the speed and in the direction it was given.',
    requires:
      'The object must be visible from the frame it is released, moving away from whatever released it. A launch a player cannot see leaving is not a launch they can be told about by sound alone.',
  },
  hit: {
    kind: 'game',
    shows: 'The contact drawn where it happened: the struck thing changes direction on that frame.',
    requires:
      'The striker and the struck must be drawn touching on the frame of contact, and the result of the contact must be visible in the next few frames. Shake and flash are decoration and vanish under reduced motion; the change of direction is the information.',
  },
  bounce: {
    kind: 'game',
    shows: 'The rebound drawn at the surface it came off.',
    requires:
      "The point of contact must be drawn. Cricket carries the worked example: a ball pitching raised a `bounce` and nothing marked where, because height is drawn as radius and a pitched ball was only a ball that got briefly smaller. Where the contact is not drawn the cue is not emitted — a mark left on the pitch would earn the sound back, and until then the game's silence is the correct behaviour.",
  },
  score: {
    kind: 'shell',
    shows: "The seat's number in the HUD changing, with a bump so the change is caught by eye.",
    source: 'apps/web/src/components/MatchHud.tsx',
    marker: 'data-bumped',
  },
  fault: {
    kind: 'game',
    shows: 'The loss drawn on the thing that was lost: the wicket falls, the life leaves the row.',
    requires:
      'What the fault cost must be drawn where the player was already looking, and must persist rather than flash — a player who blinked still has to be able to see that they are a life down.',
  },
  select: {
    kind: 'game',
    shows: 'The chosen cell or piece drawn apart from the others.',
    requires:
      'The selection must differ by more than colour (rule 7): an outline, a lift, a marker. It must survive the seat flip, because the same selection is read from both sides of the device.',
  },
  place: {
    kind: 'game',
    shows: 'The board itself different where the move was made.',
    requires:
      'The moved piece must be drawn at its destination, and — where the game has turns — the shell HUD carries whose turn it now is. A move whose only feedback is a sound is a move the other seat cannot tell has been made.',
  },
  reject: {
    kind: 'game',
    shows: 'The refused thing marked as refused, where the player was aiming.',
    requires:
      'The refusal must be drawn at the cell or control the player aimed at, for long enough to be read, and must not rely on motion — a reduced-motion device gets no shake, and a muted device gets no sound, so a rejection with only those two is a rejection that never happened as far as the player can tell.',
  },
};

/**
 * Cue names emitted by one source file.
 *
 * Deliberately loose about *how* a cue is played, because the bus a game will be handed does
 * not exist yet (`GameContext` carries no audio, and cricket's `game.ts` records what
 * happened the last time somebody wrote against one that had not landed). Anything that
 * looks like asking for a sound by name counts, and it is better for this to over-match a
 * method called `play` than to miss the one shape that arrives.
 *
 * Comments are stripped first. Half the reason this vocabulary exists is written in comments
 * that name cues — cricket names four of them in a paragraph about not emitting any — and a
 * scanner that could not tell a mention from an emission would report the honest files.
 */
export function emittedCuesIn(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const found: string[] = [];
  for (const match of code.matchAll(/\.(?:play|playVaried|emit)\(\s*(['"])([^'"]*)\1/g)) {
    const name = match[2];
    if (name !== undefined) found.push(name);
  }
  return found;
}

/**
 * The cues in `source` that a game package has no business emitting: names the vocabulary
 * does not have, and names the shell owns.
 *
 * The second half is the one the type system cannot reach. `GameSoundBus` stops a game
 * raising a shell cue through a typed bus, and a game that reached for the shell's
 * `AudioSystem` some other way — or wrote the string into a table — would slip past it.
 */
export function undeclaredCuesIn(source: string): string[] {
  return emittedCuesIn(source).filter((name) => soundEventSpec(name)?.owner !== 'game');
}
