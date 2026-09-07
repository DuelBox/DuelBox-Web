import { describe, expect, it } from 'vitest';
import { SOUND_EVENTS, SOUND_EVENT_SPECS } from '@duelbox/engine';
import { initialMatchState, reduce, type MatchRules, type MatchState } from '@duelbox/game-sdk';
import { matchCue } from './match-cues';

/**
 * The four cues the match flow owns, checked against the real state machine rather than
 * against a hand-built state: the point of deriving them from a transition is that they
 * cannot disagree with what the machine actually did.
 */

const RULES: MatchRules = { win: { kind: 'first-to', target: 2 }, rounds: 3 };

/** Plays a sequence of events through the machine and collects the cues it produces. */
function cuesFor(events: readonly Parameters<typeof reduce>[1][]): string[] {
  let state: MatchState = initialMatchState();
  const cues: string[] = [];
  for (const event of events) {
    const next = reduce(state, event, RULES);
    const cue = matchCue(state, next);
    if (cue !== null) cues.push(cue);
    state = next;
  }
  return cues;
}

describe('matchCue', () => {
  it('says nothing when nothing happened', () => {
    const state = initialMatchState();
    expect(matchCue(state, state)).toBeNull();
  });

  it('beeps once per whole second of the count, then says go', () => {
    const cues = cuesFor([
      { kind: 'start', seed: 7 },
      { kind: 'tick', seconds: 1 },
      { kind: 'tick', seconds: 1 },
      { kind: 'tick', seconds: 1 },
    ]);
    // Three beeps for "3", "2" and "1" — the numerals the overlay shows — then the go.
    expect(cues).toEqual(['countdown', 'countdown', 'countdown', 'start']);
  });

  it('does not beep for a fraction of a second', () => {
    let state = reduce(initialMatchState(), { kind: 'start', seed: 7 }, RULES);
    const cues: (string | null)[] = [];
    // A quarter is exact in binary, so the fourth tick lands on 2 rather than on
    // 2.0000000000000004 — which is the kind of arithmetic a real frame delta produces
    // and the reason this counts whole numerals crossed rather than seconds elapsed.
    for (let i = 0; i < 4; i += 1) {
      const next = reduce(state, { kind: 'tick', seconds: 0.25 }, RULES);
      cues.push(matchCue(state, next));
      state = next;
    }
    expect(cues).toEqual([null, null, null, 'countdown']);
  });

  it('says start for a game with no count at all', () => {
    // A turn-based game sets `countdownSeconds: 0` and goes straight to playing. Without
    // this branch its match would begin in silence.
    const instant: MatchRules = { win: { kind: 'first-to', target: 1 }, countdownSeconds: 0 };
    const before = initialMatchState();
    const after = reduce(before, { kind: 'start', seed: 1 }, instant);
    expect(after.phase).toBe('playing');
    expect(matchCue(before, after)).toBe('start');
  });

  it('says pause when the board stops, and counts back in on resume', () => {
    const cues = cuesFor([
      { kind: 'start', seed: 7 },
      { kind: 'tick', seconds: 3 },
      { kind: 'pause' },
      { kind: 'resume' },
    ]);
    // Resuming re-enters the countdown, which is what the machine does so that nobody is
    // ambushed by a moving board — so the count announces itself and no separate
    // "resumed" cue is needed or wanted.
    expect(cues).toEqual(['countdown', 'start', 'pause', 'countdown']);
  });

  it('says win for a round and for the match', () => {
    const cues = cuesFor([
      { kind: 'start', seed: 7 },
      { kind: 'tick', seconds: 3 },
      { kind: 'score', tally: { p1: 2, p2: 0 } },
      { kind: 'next-round' },
      { kind: 'tick', seconds: 3 },
      { kind: 'score', tally: { p1: 2, p2: 0 } },
    ]);
    expect(cues.filter((cue) => cue === 'win')).toHaveLength(2);
  });

  it('says nothing about quitting, which is a player leaving rather than an outcome', () => {
    const cues = cuesFor([
      { kind: 'start', seed: 7 },
      { kind: 'tick', seconds: 3 },
      { kind: 'pause' },
      { kind: 'quit' },
    ]);
    expect(cues[cues.length - 1]).toBe('pause');
  });

  it('only ever names cues the shell owns', () => {
    const cues = cuesFor([
      { kind: 'start', seed: 7 },
      { kind: 'tick', seconds: 3 },
      { kind: 'pause' },
      { kind: 'resume' },
      { kind: 'tick', seconds: 3 },
      { kind: 'score', tally: { p1: 2, p2: 0 } },
      { kind: 'next-round' },
    ]);
    expect(cues.length).toBeGreaterThan(0);
    for (const cue of new Set(cues)) {
      expect(SOUND_EVENTS).toContain(cue);
      expect(SOUND_EVENT_SPECS[cue as (typeof SOUND_EVENTS)[number]].source).toBe('shell');
    }
  });
});
