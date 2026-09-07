import type { SoundEvent } from '@duelbox/engine';
import type { MatchState } from '@duelbox/game-sdk';

/**
 * The four cues the match flow owns, derived from one step of the match machine.
 *
 * They live here rather than in a game for the same reason the countdown, the HUD, the
 * pause menu and the result screen do: a bespoke version of any of them inside a game
 * package is a bug (CLAUDE.md). One hundred and seven games inherit these by existing.
 *
 * Pure, and a function of two states rather than of a phase, so it is unit-testable
 * without React and so that "did anything happen" is answered by comparing rather than by
 * a pile of refs in a component.
 */
export function matchCue(previous: MatchState, next: MatchState): SoundEvent | null {
  if (next.phase === previous.phase) {
    // The count ticking down inside its own phase: one blip per whole second crossed.
    // Ceilings rather than raw seconds, so the beeps land on the numbers the overlay
    // shows — the sound and the numeral are the same event, which is what #180 asks for.
    if (next.phase !== 'countdown') return null;
    const before = Math.ceil(previous.countdownRemaining);
    const after = Math.ceil(next.countdownRemaining);
    return after < before && after > 0 ? 'countdown' : null;
  }

  switch (next.phase) {
    // Entering a count is the first of its blips; the ticks above supply the rest.
    case 'countdown':
      return 'countdown';
    // The board going live. Also the cue for a turn-based game with no count at all,
    // which drops straight from `idle` to `playing` and would otherwise start in silence.
    case 'playing':
      return 'start';
    case 'paused':
      return 'pause';
    case 'round-over':
    case 'match-over':
      return 'win';
    // Quitting is a player leaving, not an outcome. Nothing to announce.
    case 'idle':
      return null;
  }
}
