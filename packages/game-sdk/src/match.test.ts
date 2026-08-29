import { describe, expect, it } from 'vitest';
import type { SeatId } from '@duelbox/engine';
import {
  canSend,
  initialMatchState,
  isBoardVisible,
  isSimulating,
  legalEvents,
  openingSeatFor,
  reduce,
  roundsToWin,
  type MatchEvent,
  type MatchEventKind,
  type MatchPhase,
  type MatchRules,
  type MatchState,
} from './match.js';

const FIRST_TO_ONE: MatchRules = { win: { kind: 'first-to', target: 1 } };
const BEST_OF_THREE: MatchRules = { win: { kind: 'first-to', target: 1 }, rounds: 3 };

const ALL_PHASES: readonly MatchPhase[] = [
  'idle',
  'countdown',
  'playing',
  'paused',
  'round-over',
  'match-over',
];

const ALL_EVENTS: readonly MatchEvent[] = [
  { kind: 'start' },
  { kind: 'tick', seconds: 1 },
  { kind: 'pause' },
  { kind: 'resume' },
  { kind: 'score', tally: { p1: 1, p2: 0 } },
  { kind: 'next-round' },
  { kind: 'rematch' },
  { kind: 'quit' },
];

/** Drives a state into the phase named, so each test starts where it means to. */
function stateIn(phase: MatchPhase, rules: MatchRules = BEST_OF_THREE): MatchState {
  let s = initialMatchState();
  if (phase === 'idle') return s;
  s = reduce(s, { kind: 'start' }, rules);
  if (phase === 'countdown') return s;
  if (phase === 'paused') return reduce(s, { kind: 'pause' }, rules);
  s = reduce(s, { kind: 'tick', seconds: 3 }, rules);
  if (phase === 'playing') return s;
  s = reduce(s, { kind: 'score', tally: { p1: 1, p2: 0 } }, rules);
  if (phase === 'round-over') return s;
  // match-over: take the remaining round needed.
  s = reduce(s, { kind: 'next-round' }, rules);
  s = reduce(s, { kind: 'tick', seconds: 3 }, rules);
  return reduce(s, { kind: 'score', tally: { p1: 1, p2: 0 } }, rules);
}

describe('the transition table', () => {
  it('covers every phase', () => {
    for (const phase of ALL_PHASES) {
      expect(legalEvents(phase).length).toBeGreaterThan(0);
    }
  });

  it('lands each phase in the phase the test helper claims', () => {
    for (const phase of ALL_PHASES) {
      expect(stateIn(phase).phase).toBe(phase);
    }
  });

  it('lets every phase but idle be abandoned', () => {
    for (const phase of ALL_PHASES) {
      expect(canSend(phase, 'quit')).toBe(phase !== 'idle');
    }
  });

  it('ignores every event a phase does not accept, returning the same object', () => {
    for (const phase of ALL_PHASES) {
      const before = stateIn(phase);
      for (const event of ALL_EVENTS) {
        const after = reduce(before, event, BEST_OF_THREE);
        if (canSend(phase, event.kind)) continue;
        // Identity, not equality: a caller can skip a re-render on reference alone.
        expect(after).toBe(before);
      }
    }
  });

  it('acts on every event a phase does accept', () => {
    for (const phase of ALL_PHASES) {
      const before = stateIn(phase);
      for (const event of ALL_EVENTS) {
        if (!canSend(phase, event.kind)) continue;
        const after = reduce(before, event, BEST_OF_THREE);
        // 'score' with an unresolved tally legitimately only updates the tally, so the
        // assertion is that something changed, not that the phase did.
        expect(after).not.toBe(before);
      }
    }
  });

  it('never leaves a phase outside the declared set', () => {
    for (const phase of ALL_PHASES) {
      for (const event of ALL_EVENTS) {
        const after = reduce(stateIn(phase), event, BEST_OF_THREE);
        expect(ALL_PHASES).toContain(after.phase);
      }
    }
  });
});

describe('the countdown', () => {
  it('starts at the configured length and counts down without starting play early', () => {
    let s = reduce(initialMatchState(), { kind: 'start' }, FIRST_TO_ONE);
    expect(s.phase).toBe('countdown');
    expect(s.countdownRemaining).toBe(3);

    s = reduce(s, { kind: 'tick', seconds: 1 }, FIRST_TO_ONE);
    expect(s.phase).toBe('countdown');
    expect(s.countdownRemaining).toBe(2);

    s = reduce(s, { kind: 'tick', seconds: 1.5 }, FIRST_TO_ONE);
    expect(s.phase).toBe('countdown');
    expect(s.countdownRemaining).toBeCloseTo(0.5);

    s = reduce(s, { kind: 'tick', seconds: 1 }, FIRST_TO_ONE);
    expect(s.phase).toBe('playing');
    expect(s.countdownRemaining).toBe(0);
  });

  it('drops the overshoot rather than carrying it into the first step', () => {
    // Two devices with different frame budgets must enter 'playing' identically.
    let a = reduce(initialMatchState(), { kind: 'start' }, FIRST_TO_ONE);
    a = reduce(a, { kind: 'tick', seconds: 100 }, FIRST_TO_ONE);
    let b = reduce(initialMatchState(), { kind: 'start' }, FIRST_TO_ONE);
    for (let i = 0; i < 200; i += 1) b = reduce(b, { kind: 'tick', seconds: 0.5 }, FIRST_TO_ONE);
    expect(a.phase).toBe('playing');
    expect(a).toEqual(b);
  });

  it('skips straight to play when the countdown is zero', () => {
    const rules: MatchRules = { win: { kind: 'first-to', target: 1 }, countdownSeconds: 0 };
    expect(reduce(initialMatchState(), { kind: 'start' }, rules).phase).toBe('playing');
  });

  it('rejects a negative countdown and a negative tick', () => {
    const bad: MatchRules = { win: { kind: 'first-to', target: 1 }, countdownSeconds: -1 };
    expect(() => reduce(initialMatchState(), { kind: 'start' }, bad)).toThrow(RangeError);
    const s = stateIn('countdown');
    expect(() => reduce(s, { kind: 'tick', seconds: -1 }, BEST_OF_THREE)).toThrow(RangeError);
  });
});

describe('pause and resume', () => {
  it('stops the simulation while paused', () => {
    const playing = stateIn('playing');
    expect(isSimulating(playing.phase)).toBe(true);
    const paused = reduce(playing, { kind: 'pause' }, BEST_OF_THREE);
    expect(isSimulating(paused.phase)).toBe(false);
  });

  it('replays the countdown on resume so neither player is ambushed', () => {
    const paused = reduce(stateIn('playing'), { kind: 'pause' }, BEST_OF_THREE);
    const resumed = reduce(paused, { kind: 'resume' }, BEST_OF_THREE);
    expect(resumed.phase).toBe('countdown');
    expect(resumed.countdownRemaining).toBe(3);
  });

  it('keeps the score and round across a pause', () => {
    let s = stateIn('playing', BEST_OF_THREE);
    s = reduce(s, { kind: 'score', tally: { p1: 0, p2: 0 } }, BEST_OF_THREE);
    s = reduce(s, { kind: 'pause' }, BEST_OF_THREE);
    s = reduce(s, { kind: 'resume' }, BEST_OF_THREE);
    s = reduce(s, { kind: 'tick', seconds: 3 }, BEST_OF_THREE);
    expect(s.phase).toBe('playing');
    expect(s.round).toBe(1);
    expect(s.roundWins).toEqual({ p1: 0, p2: 0 });
  });

  it('keeps the board visible behind a pause overlay but not before the match starts', () => {
    expect(isBoardVisible('idle')).toBe(false);
    expect(isBoardVisible('paused')).toBe(true);
    expect(isBoardVisible('match-over')).toBe(true);
  });
});

describe('scoring a single-round match', () => {
  it('stays in play while the win condition is unmet, recording the tally', () => {
    const s = reduce(
      stateIn('playing', FIRST_TO_ONE),
      { kind: 'score', tally: { p1: 0, p2: 0 } },
      FIRST_TO_ONE,
    );
    expect(s.phase).toBe('playing');
    expect(s.tally).toEqual({ p1: 0, p2: 0 });
  });

  it('ends the match rather than the round when there is only one round', () => {
    const s = reduce(
      stateIn('playing', FIRST_TO_ONE),
      { kind: 'score', tally: { p1: 1, p2: 0 } },
      FIRST_TO_ONE,
    );
    expect(s.phase).toBe('match-over');
    expect(s.matchOutcome).toBe('p1');
  });

  it('carries a draw through to the match outcome', () => {
    const rules: MatchRules = { win: { kind: 'highest-when-time-expires' } };
    const s = reduce(
      stateIn('playing', rules),
      { kind: 'score', tally: { p1: 4, p2: 4 }, timeExpired: true },
      rules,
    );
    expect(s.phase).toBe('match-over');
    expect(s.matchOutcome).toBe('draw');
  });

  it('passes elimination through to the win condition', () => {
    const rules: MatchRules = { win: { kind: 'last-standing' } };
    const s = reduce(
      stateIn('playing', rules),
      { kind: 'score', tally: { p1: 0, p2: 0 }, eliminated: ['p2'] },
      rules,
    );
    expect(s.matchOutcome).toBe('p1');
  });
});

describe('best-of matches', () => {
  it('needs two of three and one of one', () => {
    expect(roundsToWin(FIRST_TO_ONE)).toBe(1);
    expect(roundsToWin(BEST_OF_THREE)).toBe(2);
    expect(roundsToWin({ win: { kind: 'first-to', target: 1 }, rounds: 5 })).toBe(3);
  });

  it('goes to round-over and on to the next round', () => {
    let s = reduce(stateIn('playing'), { kind: 'score', tally: { p1: 1, p2: 0 } }, BEST_OF_THREE);
    expect(s.phase).toBe('round-over');
    expect(s.roundOutcome).toBe('p1');
    expect(s.roundWins).toEqual({ p1: 1, p2: 0 });
    expect(s.matchOutcome).toBeNull();

    s = reduce(s, { kind: 'next-round' }, BEST_OF_THREE);
    expect(s.phase).toBe('countdown');
    expect(s.round).toBe(2);
    // Round wins survive; the per-round tally does not.
    expect(s.roundWins).toEqual({ p1: 1, p2: 0 });
    expect(s.tally).toEqual({ p1: 0, p2: 0 });
  });

  it('ends the match as soon as a seat takes the majority, without playing round three', () => {
    let s = stateIn('playing');
    s = reduce(s, { kind: 'score', tally: { p1: 1, p2: 0 } }, BEST_OF_THREE);
    s = reduce(s, { kind: 'next-round' }, BEST_OF_THREE);
    s = reduce(s, { kind: 'tick', seconds: 3 }, BEST_OF_THREE);
    s = reduce(s, { kind: 'score', tally: { p1: 1, p2: 0 } }, BEST_OF_THREE);
    expect(s.phase).toBe('match-over');
    expect(s.round).toBe(2);
    expect(s.matchOutcome).toBe('p1');
  });

  it('ends a best-of that ran out of rounds on the round count, not on nothing', () => {
    // Every round drawn: the match must still finish rather than loop forever.
    const rules: MatchRules = { win: { kind: 'highest-when-time-expires' }, rounds: 3 };
    let s = reduce(initialMatchState(), { kind: 'start' }, rules);
    for (let round = 1; round <= 3; round += 1) {
      s = reduce(s, { kind: 'tick', seconds: 3 }, rules);
      s = reduce(s, { kind: 'score', tally: { p1: 1, p2: 1 }, timeExpired: true }, rules);
      if (round < 3) {
        expect(s.phase).toBe('round-over');
        s = reduce(s, { kind: 'next-round' }, rules);
      }
    }
    expect(s.phase).toBe('match-over');
    expect(s.round).toBe(3);
    expect(s.matchOutcome).toBe('draw');
  });

  it('rejects a fractional or zero round count', () => {
    const s = stateIn('playing');
    for (const rounds of [0, -1, 2.5]) {
      expect(() =>
        reduce(
          s,
          { kind: 'score', tally: { p1: 1, p2: 0 } },
          { win: { kind: 'first-to', target: 1 }, rounds },
        ),
      ).toThrow(RangeError);
    }
  });
});

describe('rematch and quit', () => {
  it('resets everything on rematch, including rounds won', () => {
    const over = stateIn('match-over');
    expect(over.roundWins).not.toEqual({ p1: 0, p2: 0 });
    const again = reduce(over, { kind: 'rematch' }, BEST_OF_THREE);
    expect(again.phase).toBe('countdown');
    expect(again.round).toBe(1);
    expect(again.roundWins).toEqual({ p1: 0, p2: 0 });
    expect(again.matchOutcome).toBeNull();
    expect(again.roundOutcome).toBeNull();
  });

  it('returns to a clean idle on quit from anywhere', () => {
    for (const phase of ALL_PHASES) {
      if (phase === 'idle') continue;
      expect(reduce(stateIn(phase), { kind: 'quit' }, BEST_OF_THREE)).toEqual(initialMatchState());
    }
  });
});

describe('purity', () => {
  it('never mutates the state it is given', () => {
    for (const phase of ALL_PHASES) {
      const before = stateIn(phase);
      const snapshot = structuredClone(before);
      for (const event of ALL_EVENTS) reduce(before, event, BEST_OF_THREE);
      expect(before).toEqual(snapshot);
    }
  });

  it('gives the same result for the same input', () => {
    const s = stateIn('playing');
    const event: MatchEvent = { kind: 'score', tally: { p1: 1, p2: 0 } };
    expect(reduce(s, event, BEST_OF_THREE)).toEqual(reduce(s, event, BEST_OF_THREE));
  });

  it('exposes only event kinds the reducer knows', () => {
    const known: readonly MatchEventKind[] = ALL_EVENTS.map((e) => e.kind);
    for (const phase of ALL_PHASES) {
      for (const kind of legalEvents(phase)) expect(known).toContain(kind);
    }
  });
});

describe('a game that decides its own round', () => {
  const rules: MatchRules = { win: { kind: 'first-to', target: 99 }, rounds: 3 };

  it('takes the reported outcome over the win condition', () => {
    // The tally is nowhere near first-to-99, but the game says p2 took it.
    const s = reduce(
      stateIn('playing', rules),
      { kind: 'score', tally: { p1: 0, p2: 0 }, outcome: 'p2' },
      rules,
    );
    expect(s.phase).toBe('round-over');
    expect(s.roundOutcome).toBe('p2');
  });

  it('treats a reported null as still running', () => {
    const s = reduce(
      stateIn('playing', rules),
      { kind: 'score', tally: { p1: 40, p2: 3 }, outcome: null },
      rules,
    );
    expect(s.phase).toBe('playing');
    expect(s.tally).toEqual({ p1: 40, p2: 3 });
  });

  it('falls back to the win condition when no outcome is reported', () => {
    const s = reduce(stateIn('playing', rules), { kind: 'score', tally: { p1: 99, p2: 0 } }, rules);
    expect(s.roundOutcome).toBe('p1');
  });

  it('reports a draw it was handed', () => {
    const s = reduce(
      stateIn('playing', { win: { kind: 'first-to', target: 99 } }),
      { kind: 'score', tally: { p1: 2, p2: 2 }, outcome: 'draw' },
      { win: { kind: 'first-to', target: 99 } },
    );
    expect(s.phase).toBe('match-over');
    expect(s.matchOutcome).toBe('draw');
  });
});

/**
 * Who opens each round.
 *
 * Seat one opened every round of every match until this existed, so first-mover advantage
 * never washed out of a best-of — measured in Snakes & Ladders at 51.2% to seat one on
 * `easy` and 55.0% on `hard`. The tests below are the three claims the fix rests on: round
 * one is exactly as it was, the rounds after it alternate, and the surplus opening an odd
 * round count forces on somebody is settled by a seeded coin rather than by seat order.
 */
describe('the opening seat', () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => (i + 1) * 7919);

  /** How many rounds of a match on `seed` each seat opened, over the first `rounds`. */
  function opens(rounds: number, seed: number): { p1: number; p2: number } {
    let p1 = 0;
    let p2 = 0;
    for (let round = 1; round <= rounds; round += 1) {
      if (openingSeatFor(round, seed) === 'p1') p1 += 1;
      else p2 += 1;
    }
    return { p1, p2 };
  }

  /** The first seed whose level rounds fall to `seat` — the coin's two faces, by example. */
  function seedWhoseCoinFalls(seat: SeatId): number {
    const found = SEEDS.find((seed) => openingSeatFor(3, seed) === (seat === 'p1' ? 'p1' : 'p2'));
    expect(found, `no seed in the sample gives the coin to ${seat}`).toBeDefined();
    return found ?? 0;
  }

  it('still opens round one with seat one, under every seed', () => {
    // The pin that keeps this change from shifting anything that already worked: every
    // game, screenshot and bot measurement in the catalogue was taken with seat one first.
    for (const seed of SEEDS) expect(openingSeatFor(1, seed)).toBe('p1');
    expect(initialMatchState().openingSeat).toBe('p1');
    expect(
      reduce(initialMatchState(), { kind: 'start', seed: 4242 }, BEST_OF_THREE).openingSeat,
    ).toBe('p1');
  });

  it('hands round two to seat two, under every seed', () => {
    for (const seed of SEEDS) expect(openingSeatFor(2, seed)).toBe('p2');
  });

  it('never lets one seat get more than one opening ahead', () => {
    // The property that actually means "it alternates": at no point in a match of any
    // length has either seat opened two more rounds than the other.
    for (const seed of SEEDS) {
      for (let rounds = 1; rounds <= 9; rounds += 1) {
        const { p1, p2 } = opens(rounds, seed);
        expect(
          Math.abs(p1 - p2),
          `seed ${String(seed)} after ${String(rounds)} rounds`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never gives one seat three openings in a row', () => {
    // The tails sequence repeats seat two once, across rounds two and three, and that is
    // the only repeat there is. A third would be a different bug.
    for (const seed of SEEDS) {
      let run = 0;
      let previous: SeatId | null = null;
      for (let round = 1; round <= 9; round += 1) {
        const seat = openingSeatFor(round, seed);
        run = seat === previous ? run + 1 : 1;
        previous = seat;
        expect(run, `seed ${String(seed)} at round ${String(round)}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('gives the surplus opening to whichever seat the coin named, for any odd count', () => {
    // Not only for a best-of-five that reaches round five: a best-of-five that ends at
    // round three has the same surplus, and it has to fall the same way.
    const heads = seedWhoseCoinFalls('p1');
    const tails = seedWhoseCoinFalls('p2');
    expect([1, 2, 3, 4, 5, 6, 7].map((r) => openingSeatFor(r, heads))).toEqual([
      'p1',
      'p2',
      'p1',
      'p2',
      'p1',
      'p2',
      'p1',
    ]);
    expect([1, 2, 3, 4, 5, 6, 7].map((r) => openingSeatFor(r, tails))).toEqual([
      'p1',
      'p2',
      'p2',
      'p1',
      'p2',
      'p1',
      'p2',
    ]);
    for (const rounds of [3, 5, 7]) {
      expect(
        opens(rounds, heads).p1 - opens(rounds, heads).p2,
        `heads over ${String(rounds)}`,
      ).toBe(1);
      expect(
        opens(rounds, tails).p2 - opens(rounds, tails).p1,
        `tails over ${String(rounds)}`,
      ).toBe(1);
    }
    for (const rounds of [2, 4, 6]) {
      expect(opens(rounds, heads)).toEqual(opens(rounds, tails));
    }
  });

  it('is not always the same seat that takes the extra opening', () => {
    // The whole point. A tiebreak that always lands on seat one is the original bug.
    const surplus = SEEDS.map((seed) => openingSeatFor(3, seed));
    const toSeatTwo = surplus.filter((seat) => seat === 'p2').length;
    expect(new Set(surplus)).toEqual(new Set<SeatId>(['p1', 'p2']));
    // A coin, not a pattern: within a wide band of half, over two hundred seeds.
    expect(toSeatTwo).toBeGreaterThan(SEEDS.length * 0.35);
    expect(toSeatTwo).toBeLessThan(SEEDS.length * 0.65);
  });

  it('is reproducible from the same seed and differs across seeds', () => {
    for (const seed of SEEDS) {
      for (let round = 1; round <= 7; round += 1) {
        expect(openingSeatFor(round, seed)).toBe(openingSeatFor(round, seed));
      }
    }
    const heads = seedWhoseCoinFalls('p1');
    const tails = seedWhoseCoinFalls('p2');
    expect(openingSeatFor(3, heads)).not.toBe(openingSeatFor(3, tails));
  });

  it('rejects a round that is not a positive integer, and a seed that is not finite', () => {
    for (const round of [0, -1, 1.5, Number.NaN]) {
      expect(() => openingSeatFor(round, 1)).toThrow(RangeError);
    }
    // Round one and two never consult the seed, so only a later round can catch this.
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => openingSeatFor(3, seed)).toThrow(RangeError);
    }
  });
});

describe('the opening seat across the rounds of a best-of', () => {
  const rules: MatchRules = { win: { kind: 'first-to', target: 1 }, rounds: 3 };

  /** Every round of a best-of-three driven to its end, collecting who opened each. */
  function openersOf(seed: number): readonly SeatId[] {
    let s = reduce(initialMatchState(), { kind: 'start', seed }, rules);
    const seen: SeatId[] = [s.openingSeat];
    for (let round = 1; round < 3; round += 1) {
      s = reduce(s, { kind: 'tick', seconds: 3 }, rules);
      // Alternating winners, so the match always goes the full three rounds.
      const tally = round % 2 === 1 ? { p1: 1, p2: 0 } : { p1: 0, p2: 1 };
      s = reduce(s, { kind: 'score', tally }, rules);
      s = reduce(s, { kind: 'next-round' }, rules);
      seen.push(s.openingSeat);
    }
    return seen;
  }

  it('rotates the opener as the machine advances rounds', () => {
    // Against the old machine every one of these was ['p1', 'p1', 'p1'].
    for (const seed of [1, 7919, 20260829, -5]) {
      const seen = openersOf(seed);
      expect(seen[0]).toBe('p1');
      expect(seen[1]).toBe('p2');
      expect(seen).toEqual([1, 2, 3].map((round) => openingSeatFor(round, seed)));
    }
  });

  it('carries the seed through the whole match, so every round agrees', () => {
    const s = reduce(initialMatchState(), { kind: 'start', seed: 20260829 }, rules);
    const next = reduce(
      reduce(
        reduce(s, { kind: 'tick', seconds: 3 }, rules),
        { kind: 'score', tally: { p1: 1, p2: 0 } },
        rules,
      ),
      { kind: 'next-round' },
      rules,
    );
    expect(next.seed).toBe(20260829);
    expect(next.openingSeat).toBe(openingSeatFor(2, 20260829));
  });

  it('takes a fresh seed on a rematch, so five matches in a row are not five of the same', () => {
    const over = reduce(
      reduce(
        reduce(initialMatchState(), { kind: 'start', seed: 1 }, FIRST_TO_ONE),
        { kind: 'tick', seconds: 3 },
        FIRST_TO_ONE,
      ),
      { kind: 'score', tally: { p1: 1, p2: 0 } },
      FIRST_TO_ONE,
    );
    expect(reduce(over, { kind: 'rematch', seed: 99 }, FIRST_TO_ONE).seed).toBe(99);
    // Omitted, the match keeps the seed it had rather than silently resetting to zero.
    expect(reduce(over, { kind: 'rematch' }, FIRST_TO_ONE).seed).toBe(1);
  });

  it('leaves the seed behind on quit', () => {
    const started = reduce(initialMatchState(), { kind: 'start', seed: 77 }, rules);
    expect(started.seed).toBe(77);
    expect(reduce(started, { kind: 'quit' }, rules).seed).toBe(0);
  });

  it('rejects a seed that is not finite, at the point the match starts', () => {
    // Round one never consults the coin, so a lazy check would not fire until round three
    // — two rounds after the shell handed over the broken seed.
    for (const seed of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => reduce(initialMatchState(), { kind: 'start', seed }, rules)).toThrow(RangeError);
    }
  });
});
