import type { ShellSoundEvent } from '@duelbox/engine';
import type { MatchState } from '@duelbox/game-sdk';

/**
 * The sounds the shell raises from the match machine, and which of them hold the match down
 * while they are heard (#168, #172).
 *
 * ## Why the shell raises these and no game does
 *
 * CLAUDE.md: the countdown, the pause, the result and the rematch all come from the SDK, so
 * a game raising the sound of one of them is the same bug as a game drawing its own pause
 * menu. `packages/engine/src/sound-events.ts` is the vocabulary both sides read, and it
 * types the halves apart; this file is the shell's half of the wiring. Cricket's `game.ts`
 * has pointed at this filename since before it existed, which is as good a statement of
 * where the boundary runs as anything written here.
 *
 * ## Why it is a function of the state rather than of the transition
 *
 * The match machine is a pure reducer and its phase is the whole of what has happened, so a
 * cue is derived from the state the same way the result announcement is
 * (`lib/match-announcement.ts`) and the round buzz is (`vibrate`, in `PlaySurface`). The
 * caller compares this answer with the last one it acted on; nothing here remembers
 * anything, which is what lets it be tested by handing it states.
 *
 * ## Nothing is audible yet
 *
 * No sound file exists (#169, #170), so `AudioSystem.play` is being handed names nothing has
 * registered and is answering false. That is deliberate: the names are the part that has to
 * be agreed and wired now, and the recordings drop into a shell that is already asking for
 * them by name. The ducking below is audible the moment anything at all is playing, because
 * it moves the master gain rather than a sound.
 */

/** The part of the match state a cue is derived from. */
export type CuedState = Pick<MatchState, 'phase' | 'roundOutcome' | 'matchOutcome'>;

/**
 * The cue this state raises, or null in a phase the shell has nothing to say about.
 *
 * `idle` is the lobby and `playing` is the match itself: the shell is silent through both,
 * because everything a player hears while a round is running belongs to the game.
 *
 * There is no cue for resuming. `reduce` answers a resume by replaying the count-in rather
 * than dropping straight back into play, so coming back from a pause already raises
 * `countdown` and then `start` — see the same note in the vocabulary.
 */
export function shellCueFor(state: CuedState): ShellSoundEvent | null {
  switch (state.phase) {
    case 'countdown':
      return 'countdown';
    case 'playing':
      // The step the count-in ran out on. `reduce` only ever reaches `playing` through
      // `countdown`, so this is the "go" and not a second announcement of the same thing.
      return 'start';
    case 'paused':
      return 'pause';
    case 'round-over':
      // An ending with nothing settled is not a result. Unreachable today, exactly as it is
      // for the announcer, and announcing a phantom is worse than saying nothing.
      return state.roundOutcome === null ? null : 'round-over';
    case 'match-over':
      if (state.matchOutcome === null) return null;
      return state.matchOutcome === 'draw' ? 'match-draw' : 'match-win';
    case 'idle':
      return null;
  }
}

/**
 * Whether the shell holds the match down while this cue is on screen (#172).
 *
 * The two moments worth ducking for are the ones a player has to catch while the device is
 * making its usual noise: the count-in, which decides when both seats may move, and the
 * result, which is being read out to anybody using a screen reader at the same time as it
 * is drawn. Neither can be repeated, and both are short.
 *
 * `pause` and `start` are not on the list and should not be. A pause takes the match down
 * to nothing by itself, so there is nothing left to duck; `start` is the moment the duck is
 * released rather than another reason to hold one.
 *
 * The duck is *held for as long as the cue's phase lasts* rather than for the length of a
 * sound, and that is a deliberate choice rather than a shortcut. A result panel stays until
 * somebody presses Rematch, and what a duck is making room for there is an announcement
 * whose length nobody in this process knows — it is however long a screen reader takes. The
 * shell has no clock of its own outside the fixed loop, and a duck released by a guessed
 * timer while the announcement is still being spoken is precisely the failure the counted
 * `duck`/`unduck` pair exists to prevent. Quieter than strictly necessary for a moment,
 * never louder while something is still being said over it.
 *
 * ## What this cannot do yet, said plainly
 *
 * There is one output bus. `AudioSystem.duck` moves the master gain, and every voice —
 * including the count-in cue this file raises — hangs off that same node, so a duck taken
 * for the count-in attenuates the count-in along with everything else. What it genuinely
 * lowers is whatever was already ringing and whatever is not the match at all: the tail of a
 * rally when a resume counts back in, and the menu and match music of #173 when there is
 * any. Making an announcement sit *on top* rather than merely level needs a second path
 * that bypasses the duck — a match bus and a shell bus under one master, ducked separately —
 * and that is a change to the engine's graph rather than to this wiring, so it is written
 * down here rather than half-done.
 */
export function ducksMatchAudio(cue: ShellSoundEvent): boolean {
  return cue === 'countdown' || cue === 'round-over' || cue === 'match-win' || cue === 'match-draw';
}
