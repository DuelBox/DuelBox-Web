import { describe, expect, it } from 'vitest';
import {
  advanceClock,
  clockElapsed,
  clockExpired,
  clockRemaining,
  clockWarning,
  createClock,
  formatClock,
  resetClock,
  type MatchClock,
} from './match-clock.js';
import { initialMatchState, reduce, type MatchRules } from './match.js';

const STEP = 1 / 60;

/** Advance a clock through `steps` fixed steps in a given phase. */
function run(clock: MatchClock, phase: Parameters<typeof advanceClock>[1], steps: number): MatchClock {
  let out = clock;
  for (let i = 0; i < steps; i += 1) out = advanceClock(out, phase, STEP);
  return out;
}

describe('createClock', () => {
  it('is a limitless stopwatch with no argument', () => {
    const clock = createClock();
    expect(clock.elapsed).toBe(0);
    expect(clock.limit).toBeNull();
    expect(clockRemaining(clock)).toBeNull();
    expect(clockExpired(clock)).toBe(false);
  });

  it('carries a limit and clamps a warning threshold to it', () => {
    expect(createClock(30, 5).warnAt).toBe(5);
    // A warning threshold past the whole limit would fire from the first second.
    expect(createClock(4, 10).warnAt).toBe(4);
  });

  it('rejects a negative limit', () => {
    expect(() => createClock(-1)).toThrow(RangeError);
  });
});

describe('advanceClock', () => {
  it('advances only while playing', () => {
    const start = createClock(30);
    // Ten seconds of countdown and ten of pause move nothing.
    expect(clockElapsed(run(start, 'countdown', 600))).toBe(0);
    expect(clockElapsed(run(start, 'paused', 600))).toBe(0);
    // The same ten seconds of play do.
    expect(clockElapsed(run(start, 'playing', 600))).toBeCloseTo(10, 5);
  });

  it('returns the same reference when it does not move', () => {
    const clock = createClock(30);
    // Wrong phase, and a zero-length step, are both no-ops that must not allocate.
    expect(advanceClock(clock, 'paused', STEP)).toBe(clock);
    expect(advanceClock(clock, 'playing', 0)).toBe(clock);
  });

  it('pausing does not consume time', () => {
    // Play five seconds, pause for a hundred, play five more: ten seconds, not a hundred and ten.
    let clock = run(createClock(30), 'playing', 300);
    clock = run(clock, 'paused', 6000);
    clock = run(clock, 'playing', 300);
    expect(clockElapsed(clock)).toBeCloseTo(10, 5);
  });

  it('rejects a negative delta', () => {
    expect(() => advanceClock(createClock(30), 'playing', -STEP)).toThrow(RangeError);
  });
});

describe('remaining and expiry', () => {
  it('counts a limited clock down and clamps at zero', () => {
    const clock = run(createClock(10), 'playing', 60 * 12); // twelve seconds of a ten-second limit
    expect(clockRemaining(clock)).toBe(0);
    expect(clockExpired(clock)).toBe(true);
  });

  it('is not expired before the limit', () => {
    const clock = run(createClock(10), 'playing', 60 * 9);
    expect(clockExpired(clock)).toBe(false);
    expect(clockRemaining(clock)).toBeCloseTo(1, 5);
  });

  it('a limitless clock never expires', () => {
    expect(clockExpired(run(createClock(), 'playing', 60 * 600))).toBe(false);
  });
});

describe('clockWarning', () => {
  it('is true only inside the band and before expiry', () => {
    const clock = createClock(10, 3);
    expect(clockWarning(run(clock, 'playing', 60 * 6))).toBe(false); // 4s left, outside the band
    expect(clockWarning(run(clock, 'playing', 60 * 8))).toBe(true); // 2s left, inside it
    expect(clockWarning(run(clock, 'playing', 60 * 11))).toBe(false); // expired, warning is over
  });

  it('is never true without a warning threshold', () => {
    expect(clockWarning(run(createClock(10), 'playing', 60 * 9.5))).toBe(false);
  });
});

describe('resetClock', () => {
  it('returns to zero keeping the limit', () => {
    const clock = resetClock(run(createClock(30, 5), 'playing', 600));
    expect(clock.elapsed).toBe(0);
    expect(clock.limit).toBe(30);
    expect(clock.warnAt).toBe(5);
  });

  it('returns the same reference when already at zero', () => {
    const clock = createClock(30);
    expect(resetClock(clock)).toBe(clock);
  });
});

describe('formatClock', () => {
  it('renders m:ss and ceils the last second', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(0.4)).toBe('0:01');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(-5)).toBe('0:00');
  });
});

describe('expiry drives round and match end', () => {
  const rules: MatchRules = { win: { kind: 'highest-when-time-expires' }, rounds: 1 };

  it('a game with a time limit ends when the clock expires', () => {
    // Reach the playing phase.
    let state = reduce(initialMatchState(), { kind: 'start' }, rules);
    state = reduce(state, { kind: 'tick', seconds: 5 }, rules);
    expect(state.phase).toBe('playing');

    // Run the clock to expiry, then report the tally with the expiry the clock detected.
    const clock = run(createClock(20), 'playing', 60 * 21);
    expect(clockExpired(clock)).toBe(true);

    const ended = reduce(
      state,
      { kind: 'score', tally: { p1: 3, p2: 1 }, timeExpired: clockExpired(clock) },
      rules,
    );
    expect(ended.phase).toBe('match-over');
    expect(ended.matchOutcome).toBe('p1');
  });

  it('does not end the round while the clock is still running', () => {
    let state = reduce(initialMatchState(), { kind: 'start' }, rules);
    state = reduce(state, { kind: 'tick', seconds: 5 }, rules);

    const clock = run(createClock(20), 'playing', 60 * 5);
    const still = reduce(
      state,
      { kind: 'score', tally: { p1: 3, p2: 1 }, timeExpired: clockExpired(clock) },
      rules,
    );
    expect(still.phase).toBe('playing');
    expect(still.matchOutcome).toBeNull();
  });
});
