import { describe, expect, it } from 'vitest';
import { initialMatchState, reduce, type MatchEvent, type MatchRules } from '@duelbox/game-sdk';
import { AudioSystem, soundEventSpec, type ShellSoundEvent } from '@duelbox/engine';
import { ducksMatchAudio, shellCueFor, type CuedState } from './match-cues';

/**
 * Driven through the real match machine rather than over states written by hand.
 *
 * The interesting claims are all claims about the machine's shape — that `playing` is only
 * ever reached through the count-in, that a resume replays the count-in rather than dropping
 * into play, that a result phase always carries an outcome. Hand-built states would let this
 * file agree with itself about a machine that had changed underneath it, which is the
 * failure mode of every test that mocks the thing it is testing against.
 */

const RULES: MatchRules = { win: { kind: 'first-to', target: 1 }, rounds: 3, countdownSeconds: 3 };

/** The phases a match walks through, with the cue each one raises. */
function walk(events: readonly MatchEvent[]): (ShellSoundEvent | null)[] {
  let state = initialMatchState();
  const cues: (ShellSoundEvent | null)[] = [shellCueFor(state)];
  for (const event of events) {
    state = reduce(state, event, RULES);
    cues.push(shellCueFor(state));
  }
  return cues;
}

/** One fixed step of the shell's clock, as `GameHost` feeds it. */
const TICK: MatchEvent = { kind: 'tick', seconds: 1 };

describe('the cue a match phase raises', () => {
  it('says nothing in the lobby', () => {
    expect(shellCueFor(initialMatchState())).toBeNull();
  });

  it('counts in, goes, and then leaves the round to the game', () => {
    expect(walk([{ kind: 'start', seed: 7 }, TICK, TICK, TICK])).toEqual([
      null, // idle
      'countdown', // 3
      'countdown', // 2
      'countdown', // 1
      'start', // the step the count-in ran out on
    ]);
  });

  it('raises the count-in again on the way back from a pause', () => {
    // Not a `resume` cue, because there is no such thing: `reduce` replays the count-in, so
    // coming back is already two cues the player knows. This test is the reason the
    // vocabulary can leave `resume` out and stay honest.
    const cues = walk([{ kind: 'start', seed: 1 }, TICK, { kind: 'pause' }, { kind: 'resume' }]);
    expect(cues[cues.length - 2]).toBe('pause');
    expect(cues[cues.length - 1]).toBe('countdown');
  });

  it('marks the end of a round without saying who took it', () => {
    const cues = walk([
      { kind: 'start', seed: 1 },
      TICK,
      TICK,
      TICK,
      { kind: 'score', tally: { p1: 1, p2: 0 } },
    ]);
    expect(cues[cues.length - 1]).toBe('round-over');
  });

  it('tells a decided match from a drawn one', () => {
    const won = walk([
      { kind: 'start', seed: 1 },
      TICK,
      TICK,
      TICK,
      { kind: 'score', tally: { p1: 1, p2: 0 } },
      { kind: 'next-round' },
      TICK,
      TICK,
      TICK,
      { kind: 'score', tally: { p1: 1, p2: 0 } },
    ]);
    expect(won[won.length - 1]).toBe('match-win');

    const drawn = walk([
      { kind: 'start', seed: 1 },
      TICK,
      TICK,
      TICK,
      { kind: 'score', tally: { p1: 0, p2: 0 }, outcome: 'draw' },
      { kind: 'next-round' },
      TICK,
      TICK,
      TICK,
      { kind: 'score', tally: { p1: 0, p2: 0 }, outcome: 'draw' },
      { kind: 'next-round' },
      TICK,
      TICK,
      TICK,
      { kind: 'score', tally: { p1: 0, p2: 0 }, outcome: 'draw' },
    ]);
    expect(drawn[drawn.length - 1]).toBe('match-draw');
  });

  it('says nothing about an ending that settled nothing', () => {
    // Unreachable through the machine, which is why it is asserted directly: a phantom draw
    // is worse than silence, and `lib/match-announcement.ts` declines the same state.
    const nothingSettled: CuedState = {
      phase: 'match-over',
      roundOutcome: null,
      matchOutcome: null,
    };
    expect(shellCueFor(nothingSettled)).toBeNull();
    expect(shellCueFor({ ...nothingSettled, phase: 'round-over' })).toBeNull();
  });

  it('raises only cues the vocabulary declares, and only ones the shell owns', () => {
    // The point of the exercise. A cue this file invents would be a name no recording is
    // ever made for, and a game-owned cue raised from here would be the shell doing a game's
    // job — the mirror image of the bug the type split prevents in the other direction.
    const seen = new Set(
      walk([
        { kind: 'start', seed: 3 },
        TICK,
        TICK,
        TICK,
        { kind: 'pause' },
        { kind: 'resume' },
        TICK,
        TICK,
        TICK,
        { kind: 'score', tally: { p1: 1, p2: 0 } },
        { kind: 'next-round' },
        TICK,
        TICK,
        TICK,
        { kind: 'score', tally: { p1: 1, p2: 0 } },
      ]).filter((cue): cue is ShellSoundEvent => cue !== null),
    );
    expect(seen.size).toBeGreaterThan(3);
    for (const cue of seen) {
      expect(soundEventSpec(cue)?.owner, `${cue} is not a shell cue`).toBe('shell');
    }
  });
});

describe('what the shell ducks for', () => {
  it('holds the match down for the count-in and for a result', () => {
    expect(ducksMatchAudio('countdown')).toBe(true);
    expect(ducksMatchAudio('round-over')).toBe(true);
    expect(ducksMatchAudio('match-win')).toBe(true);
    expect(ducksMatchAudio('match-draw')).toBe(true);
  });

  it('does not duck for a pause, or for the moment the duck is released', () => {
    // A pause silences the match by itself; `start` is where the count-in's duck comes off.
    expect(ducksMatchAudio('pause')).toBe(false);
    expect(ducksMatchAudio('start')).toBe(false);
  });
});

/**
 * The policy driven against the real {@link AudioSystem}, over a real match.
 *
 * `PlaySurface` holds one duck for as long as the cue asks for one and releases it in the
 * effect's cleanup; this is that rule, written out, so the sequence of ducks a match
 * produces can be asserted without a DOM. It is not a test of the React glue — that stays
 * uncovered, and there are ten lines of it — but the thing #172 promises is a level that
 * goes down and comes back, and that is what this walks.
 *
 * There is no audio context here at all: no gesture has been made, nothing is registered and
 * nothing is playing. A duck in that state has to be a no-op rather than an error, because
 * the first count-in of a session happens before the tap that unlocks audio has finished
 * being processed.
 */
function driveDucking(sound: AudioSystem, cues: readonly (ShellSoundEvent | null)[]): boolean[] {
  let held = false;
  const seen: boolean[] = [];
  for (const cue of cues) {
    const wants = cue !== null && ducksMatchAudio(cue);
    if (wants && !held) sound.duck();
    else if (!wants && held) sound.unduck();
    held = wants;
    seen.push(sound.ducked);
  }
  return seen;
}

describe('the duck a match takes', () => {
  const MATCH: readonly MatchEvent[] = [
    { kind: 'start', seed: 5 },
    TICK,
    TICK,
    TICK,
    { kind: 'score', tally: { p1: 1, p2: 0 } },
    { kind: 'next-round' },
    TICK,
    TICK,
    TICK,
    { kind: 'score', tally: { p1: 1, p2: 0 } },
    { kind: 'rematch', seed: 6 },
  ];

  it('is held through a count-in and a result and through nothing else', () => {
    const sound = new AudioSystem({ target: null });
    expect(driveDucking(sound, walk(MATCH))).toEqual([
      false, // idle
      true, //  count-in, 3
      true, //  2
      true, //  1
      false, // playing
      true, //  the round result
      true, //  count-in of round two
      true, //  2
      true, //  1
      false, // playing
      true, //  the match result, still held while it is being read out
      true, //  the rematch counts in
    ]);
  });

  it('gives every duck back, so the next match does not start quiet', () => {
    const sound = new AudioSystem({ target: null });
    driveDucking(sound, walk(MATCH));
    // The last state of that walk is a count-in, which is holding one; releasing it is the
    // effect's cleanup on unmount.
    expect(sound.ducked).toBe(true);
    sound.unduck();
    expect(sound.ducked).toBe(false);
    // And a release with nothing held cannot run the count into debt — a debt would be paid
    // by the *next* announcement, which would then be the one nobody can hear.
    sound.unduck();
    sound.duck();
    expect(sound.ducked).toBe(true);
  });

  it('throws nothing with no context, no gesture and nothing registered', () => {
    const sound = new AudioSystem({ target: null });
    expect(() => driveDucking(sound, walk(MATCH))).not.toThrow();
    // The whole point of ducking the master gain rather than the voices: there is nothing to
    // find and turn down, so there is nothing to fail when there is nothing playing.
    expect(sound.play('countdown')).toBe(false);
  });

  it('cannot un-mute a muted device', () => {
    // The level itself is the engine's business and `audio.test.ts` holds it to this; what
    // matters here is that the shell taking a duck does not touch the player's mute.
    const sound = new AudioSystem({ target: null, muted: true, masterGain: 0.8 });
    driveDucking(sound, walk(MATCH));
    expect(sound.muted).toBe(true);
    expect(sound.masterGain).toBe(0.8);
  });
});
