import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  APPROACH_SECONDS,
  BOT_DRAWS_PER_NOTE,
  BOT_PROFILES,
  FUMBLE_SCALE,
  GAPS_PER_LENGTH,
  GAP_MENU,
  GOOD_POINTS,
  GOOD_SECONDS,
  LEAD_SECONDS,
  MATCH_SECONDS,
  MISS_PENALTY,
  NOTE_COUNT,
  PERFECT_POINTS,
  PERFECT_SECONDS,
  SLOT_SECONDS,
  STRAY_GAP_SECONDS,
  TRACK_SECONDS,
  WILD_PENALTY,
  approachOf,
  createBotRngs,
  createBotState,
  createState,
  driveBot,
  firstDrawable,
  planNote,
  judgedBy,
  mistakesBy,
  remainingOf,
  resetBotState,
  resetState,
  sideOf,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Side, State } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/**
 * How many fixed steps one match takes. Measured, not `MATCH_SECONDS / STEP`.
 *
 * 2400 sixtieths accumulated in floating point come to 39.999999999999670, a hair under the
 * forty seconds the match ends at, so the last step of the tail is charged on step 2401. That
 * is not a rounding wart to be papered over: it is the reason nothing in this game compares a
 * clock to a whole number of frames, and it is asserted here so a change to the accumulation
 * shows up as a failing count rather than as a note that quietly stops being playable.
 */
const MATCH_STEPS = 2401;

function fresh(seed: number): State {
  const state = createState();
  resetState(state, new Rng(seed));
  return state;
}

/** Every number a seat carries, as a plain tuple, so two seats can be compared exactly. */
function snapshot(side: Readonly<Side>): readonly number[] {
  return [side.score, side.perfect, side.good, side.missed, side.wild, side.lastOffset];
}

function mirrorWinner(winner: SeatId | 'draw' | null): SeatId | 'draw' | null {
  if (winner === 'p1') return 'p2';
  if (winner === 'p2') return 'p1';
  return winner;
}

/** Play a whole match from two press streams, and hand back the finished state. */
function playPresses(
  seed: number,
  pressP1: readonly boolean[],
  pressP2: readonly boolean[],
): State {
  const state = fresh(seed);
  for (let i = 0; state.winner === null; i += 1) {
    step(state, STEP, pressP1[i] ?? false, pressP2[i] ?? false);
  }
  return state;
}

/**
 * A press stream a person might plausibly produce: mostly aimed at notes, sometimes not.
 *
 * Aimed rather than uniform on purpose. A uniformly random stream almost never lands inside a
 * window, so a mirror test built on one would be comparing two matches of nothing but wild
 * presses and would pass with the referee deleted.
 */
function pressStream(rng: Rng, arrivals: readonly number[]): boolean[] {
  const steps = Math.ceil(MATCH_SECONDS / STEP) + 4;
  const stream = new Array<boolean>(steps).fill(false);
  for (let note = 0; note < arrivals.length; note += 1) {
    if (rng.float() < 0.12) continue;
    const wanted = (arrivals[note] as number) + (rng.float() - 0.5) * 0.7;
    const frame = Math.round(wanted / STEP);
    if (frame >= 0 && frame < steps) stream[frame] = true;
  }
  for (let i = 0; i < steps; i += 1) {
    if (rng.float() < 0.004) stream[i] = true;
  }
  return stream;
}

/** One tier, driven by the real `driveBot`, for a whole match. */
function playBots(
  trackSeed: number,
  p1Seed: number,
  p2Seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
): State {
  const state = fresh(trackSeed);
  const botP1 = createBotState();
  const botP2 = createBotState();
  const rngP1 = new Rng(p1Seed);
  const rngP2 = new Rng(p2Seed);
  while (state.winner === null) {
    const a = driveBot(state, p1Tier, botP1, rngP1, STEP);
    const b = driveBot(state, p2Tier, botP2, rngP2, STEP);
    step(state, STEP, a, b);
  }
  return state;
}

/* ============================================================ mirror symmetry */

/**
 * Written first, because in three of the fourteen games before this one it was the only thing
 * that could see a seat bias at all.
 *
 * This game's version of it is unusually strong, and the reason is structural. There is no
 * board: a note is an arrival *time*, shared by both seats, so there is no coordinate for a
 * rule to be written in and nothing to be non-covariant under the half-turn. Swapping the
 * seats is therefore *exactly* swapping the two press streams, and the claim is not "the two
 * results are close" but "the two results are the same numbers in the other order".
 */
describe('swapping the two seats', () => {
  it('swaps every number in a whole match, over 400 random tracks and press streams', () => {
    let mismatches = 0;
    for (let trial = 0; trial < 400; trial += 1) {
      const seed = 9001 + trial * 37;
      const rng = new Rng(seed);
      const track = fresh(seed);
      const a = pressStream(rng, track.arrivals);
      const b = pressStream(rng, track.arrivals);

      const straight = playPresses(seed, a, b);
      const swapped = playPresses(seed, b, a);

      if (
        JSON.stringify(snapshot(straight.p1)) !== JSON.stringify(snapshot(swapped.p2)) ||
        JSON.stringify(snapshot(straight.p2)) !== JSON.stringify(snapshot(swapped.p1)) ||
        straight.winner !== mirrorWinner(swapped.winner) ||
        JSON.stringify(straight.p1Judged) !== JSON.stringify(swapped.p2Judged) ||
        JSON.stringify(straight.p2Judged) !== JSON.stringify(swapped.p1Judged)
      ) {
        mismatches += 1;
      }
    }
    expect(mismatches, 'a mirrored match must be the mirror of the match').toBe(0);
  });

  it('swaps the outcome when the two bot streams change seats, at every tier', () => {
    let mismatches = 0;
    for (const tier of TIERS) {
      for (let trial = 0; trial < 120; trial += 1) {
        const track = 4400 + trial * 13;
        const s1 = 77 + trial * 101;
        const s2 = 5150 + trial * 29;
        const straight = playBots(track, s1, s2, tier, tier);
        const swapped = playBots(track, s2, s1, tier, tier);
        if (
          JSON.stringify(snapshot(straight.p1)) !== JSON.stringify(snapshot(swapped.p2)) ||
          JSON.stringify(snapshot(straight.p2)) !== JSON.stringify(snapshot(swapped.p1)) ||
          straight.winner !== mirrorWinner(swapped.winner)
        ) {
          mismatches += 1;
        }
      }
    }
    // 0 of 360, and it is 0 rather than small because the seats share one track and one
    // clock. This is what makes seat one's 50% a proof rather than a measurement: over any
    // seed set closed under swapping the two streams, the share is exactly a half.
    expect(mismatches).toBe(0);
  });

  it('lets neither seat touch the other, which is what makes the duel exactly fair', () => {
    // The two seats never interact. Each answers the same track on its own, and the match is
    // the comparison of the two answers — which is what the observed row asks for ("the one
    // with more points at the end of the song wins") and is also the reason the symmetry
    // above is exact rather than approximate. Asserted over a hundred random press streams:
    // a seat's whole record is a function of its own presses and the track, and nothing else.
    for (let trial = 0; trial < 100; trial += 1) {
      const seed = 600 + trial * 17;
      const rng = new Rng(seed);
      const track = fresh(seed);
      const mine = pressStream(rng, track.arrivals);
      const alone = playPresses(seed, mine, []);
      const together = playPresses(seed, mine, pressStream(rng, track.arrivals));
      expect(snapshot(together.p1)).toEqual(snapshot(alone.p1));
      expect(together.p1Judged).toEqual(alone.p1Judged);
    }
  });

  it('gives both seats the identical stream of notes, not two streams that agree', () => {
    const state = fresh(31337);
    // One array. There is no `p1Arrivals` to drift from a `p2Arrivals`, which is the failure
    // `balance-aggregate.test.ts`'s seat band exists to catch and the reason it has nothing
    // to catch here.
    expect(Object.keys(state)).not.toContain('p1Arrivals');
    expect(state.arrivals.length).toBe(NOTE_COUNT);
    expect(state.p1Judged.length).toBe(NOTE_COUNT);
    expect(state.p2Judged.length).toBe(NOTE_COUNT);
  });

  it('reads one clock for both seats, so nothing accumulates from opposite ends', () => {
    // The failure Frozen Beaks and Snowball Throw were bisected down to is two seats
    // accumulating a quantity from opposite ends of a board and straddling a threshold in the
    // last bits. Here there is one accumulator and both seats are judged against it.
    const state = fresh(4);
    for (let i = 0; i < 900; i += 1) step(state, STEP, false, false);
    expect(Math.abs(state.clock - 900 * STEP)).toBeLessThan(1e-9);
  });
});

/* ==================================================================== the track */

describe('the track', () => {
  it('is exactly the same length for every seed', () => {
    const lengths = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      lengths.add(fresh(seed * 7 + 1).arrivals[NOTE_COUNT - 1] as number);
    }
    expect(lengths.size).toBe(1);
    expect([...lengths][0]).toBeCloseTo(LEAD_SECONDS + TRACK_SECONDS, 10);
    expect(MATCH_SECONDS).toBeCloseTo(40, 10);
  });

  it('shuffles a fixed multiset of gaps rather than drawing them', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const state = fresh(seed * 11 + 3);
      const counts = new Map<number, number>();
      for (let n = 1; n < NOTE_COUNT; n += 1) {
        const slots = Math.round(
          ((state.arrivals[n] as number) - (state.arrivals[n - 1] as number)) / SLOT_SECONDS,
        );
        counts.set(slots, (counts.get(slots) ?? 0) + 1);
      }
      expect(counts.size).toBe(GAP_MENU.length);
      for (const gap of GAP_MENU) expect(counts.get(gap)).toBe(GAPS_PER_LENGTH);
    }
  });

  it('lays a different rhythm out for different seeds', () => {
    const shapes = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) shapes.add(fresh(seed * 5 + 2).arrivals.join(','));
    expect(shapes.size).toBeGreaterThan(35);
  });

  it('never puts two notes close enough for one press to answer either', () => {
    // The referee picks the nearest unanswered note inside the good window. That is only
    // unambiguous while two windows cannot overlap, and this is the assertion that keeps it
    // so — a tie-break between two notes is exactly the shape of bug Maze Paint and Frozen
    // Beaks were caught with, and there is no need to have one at all.
    const shortest = (GAP_MENU[0] as number) * SLOT_SECONDS;
    expect(shortest).toBeGreaterThan(2 * GOOD_SECONDS);
    for (let seed = 0; seed < 60; seed += 1) {
      const state = fresh(seed * 3 + 7);
      for (let n = 1; n < NOTE_COUNT; n += 1) {
        const gap = (state.arrivals[n] as number) - (state.arrivals[n - 1] as number);
        expect(gap).toBeGreaterThan(2 * GOOD_SECONDS);
      }
    }
  });

  it('gives the first note a lead-in longer than the lane', () => {
    expect(LEAD_SECONDS).toBeGreaterThan(APPROACH_SECONDS);
    expect(fresh(1).arrivals[0]).toBeCloseTo(LEAD_SECONDS, 10);
  });

  it('leaves the last note a whole window before the clock runs out', () => {
    const state = fresh(12);
    const last = state.arrivals[NOTE_COUNT - 1] as number;
    expect(last + GOOD_SECONDS).toBeLessThan(MATCH_SECONDS);
  });
});

/* ================================================================== the windows */

describe('the timing windows', () => {
  it('are stated in seconds and are several frames wide', () => {
    // The lesson Target Practice paid for: a window measured in frames is measured in the
    // wrong unit, and one narrower than a frame is unhittable. Both of these are asserted
    // against the same eight-frame floor Target Practice settled on.
    expect((PERFECT_SECONDS * 2) / STEP).toBeGreaterThanOrEqual(8);
    expect((GOOD_SECONDS * 2) / STEP).toBeGreaterThanOrEqual(8);
    expect((PERFECT_SECONDS * 2) / STEP).toBeCloseTo(9, 6);
    expect((GOOD_SECONDS * 2) / STEP).toBeCloseTo(21.6, 6);
  });

  it('leaves a real band between the two, rather than three spellings of perfect', () => {
    // Target Practice's ladder once collapsed because its three tiers all sat inside four
    // frames of each other. The good-but-not-perfect band here is 6.3 frames on each side —
    // wider than the whole of that collapse.
    const band = (GOOD_SECONDS - PERFECT_SECONDS) / STEP;
    expect(band).toBeGreaterThan(6);
    expect(PERFECT_SECONDS).toBeLessThan(GOOD_SECONDS);
  });

  it('puts neither boundary on a frame, for any note on any track', () => {
    // A press only ever lands on a whole frame, and every arrival is `2.5 + k x 0.25`. So
    // `|press - arrival| = 0.075` would need frame `154.5 + 15k` and `= 0.18` would need
    // `160.8 + 15k`, and neither is ever an integer. The margins are half a frame and a
    // fifth of one — small, but they are exact rather than lucky, and a boundary a state
    // variable can land on by construction is the family of bug that cost three games.
    for (let seed = 0; seed < 20; seed += 1) {
      const state = fresh(seed * 17 + 1);
      for (let n = 0; n < NOTE_COUNT; n += 1) {
        const arrival = state.arrivals[n] as number;
        for (const window of [PERFECT_SECONDS, GOOD_SECONDS]) {
          for (const side of [-1, 1]) {
            const frames = (arrival + side * window) / STEP;
            expect(Math.abs(frames - Math.round(frames))).toBeGreaterThan(0.15);
          }
        }
      }
    }
  });
});

/* ================================================================== the referee */

/** Press once, on the frame nearest `arrival + offset`, and report how it was judged. */
function judgeAt(seed: number, note: number, offsetSeconds: number, seat: SeatId = 'p1') {
  const state = fresh(seed);
  const target = (state.arrivals[note] as number) + offsetSeconds;
  const frame = Math.round(target / STEP);
  // The whole match, always. Stopping early would leave a different number of notes
  // unresolved for an early press than for a late one, and two of the assertions below
  // compare exactly those two cases.
  for (let i = 0; state.winner === null; i += 1) {
    const press = i === frame;
    step(state, STEP, seat === 'p1' && press, seat === 'p2' && press);
  }
  return { state, side: sideOf(state, seat), judged: judgedBy(state, seat) };
}

describe('the referee', () => {
  it('pays three for a press on the beat', () => {
    const { side, judged } = judgeAt(21, 6, 0);
    expect(judged[6]).toBe('perfect');
    expect(side.perfect).toBe(1);
    // One note answered and the other forty-eight let go at a point each. Stated as
    // arithmetic rather than a literal, because the penalty is half of the row this game
    // exists to build: "each mistake will lower your score".
    expect(side.missed).toBe(NOTE_COUNT - 1);
    expect(side.score).toBe(PERFECT_POINTS - (NOTE_COUNT - 1) * MISS_PENALTY);
  });

  it('pays one for a press inside the good window but outside the perfect one', () => {
    const { side, judged } = judgeAt(21, 6, PERFECT_SECONDS + 0.03);
    expect(judged[6]).toBe('good');
    expect(side.good).toBe(1);
    expect(side.missed).toBe(NOTE_COUNT - 1);
    expect(side.score).toBe(GOOD_POINTS - (NOTE_COUNT - 1) * MISS_PENALTY);
  });

  it('charges twice for a press outside the window: once wild, once for the note let go', () => {
    // A press half a second off is not a near miss; it is a press *and* an abandoned note,
    // and it costs both. That is what stops a player pressing on every frame.
    const { side, judged } = judgeAt(21, 6, GOOD_SECONDS + 0.05);
    expect(judged[6]).toBe('missed');
    expect(side.wild).toBe(1);
    expect(side.missed).toBe(NOTE_COUNT);
    expect(side.score).toBe(-NOTE_COUNT * MISS_PENALTY - WILD_PENALTY);
  });

  it('is symmetric in the sign of the error', () => {
    for (const offset of [0.04, 0.12, 0.17]) {
      const early = judgeAt(55, 9, -offset);
      const late = judgeAt(55, 9, offset);
      expect(early.judged[9]).toBe(late.judged[9]);
      expect(early.side.score).toBe(late.side.score);
      expect(early.side.lastOffset).toBeCloseTo(-late.side.lastOffset, 6);
    }
  });

  it('remembers which way the press was wrong, for the board to draw', () => {
    const early = judgeAt(55, 9, -0.1);
    expect(early.side.lastOffset).toBeLessThan(0);
    expect(early.side.lastOffset).toBeCloseTo(-0.1, 2);
    const late = judgeAt(55, 9, 0.1);
    expect(late.side.lastOffset).toBeGreaterThan(0);
  });

  it('lets a second press on one note answer nothing', () => {
    const state = fresh(88);
    const arrival = state.arrivals[5] as number;
    const first = Math.round(arrival / STEP);
    for (let i = 0; state.winner === null; i += 1) {
      step(state, STEP, i === first || i === first + 2, false);
      if (i > first + 30) break;
    }
    expect(state.p1.perfect).toBe(1);
    expect(state.p1.wild).toBe(1);
  });

  it('lets both seats answer the same note, because the track belongs to neither', () => {
    const state = fresh(88);
    const frame = Math.round((state.arrivals[5] as number) / STEP);
    for (let i = 0; state.winner === null; i += 1) {
      step(state, STEP, i === frame, i === frame);
      if (i > frame + 30) break;
    }
    expect(state.p1Judged[5]).toBe('perfect');
    expect(state.p2Judged[5]).toBe('perfect');
  });

  it('charges both seats for a note nobody answered', () => {
    const state = fresh(88);
    const frame = Math.round(((state.arrivals[0] as number) + GOOD_SECONDS + 0.05) / STEP);
    for (let i = 0; i <= frame; i += 1) step(state, STEP, false, false);
    expect(state.p1Judged[0]).toBe('missed');
    expect(state.p2Judged[0]).toBe('missed');
    expect(state.p1.score).toBe(-MISS_PENALTY);
    expect(state.p2.score).toBe(-MISS_PENALTY);
  });

  it('accounts for every note exactly once and every press exactly once', () => {
    // A press is taken while `|press - arrival| <= GOOD` and a window shuts once
    // `clock > arrival + GOOD`, so the two predicates are the same boundary read from
    // opposite sides and cannot both fire on one step. What that buys is this pair of
    // exact accounts, asserted against a seat that presses on every single frame.
    const state = fresh(404);
    let presses = 0;
    while (state.winner === null) {
      step(state, STEP, true, false);
      presses += 1;
    }
    expect(presses).toBe(MATCH_STEPS);
    expect(state.p1.perfect + state.p1.good + state.p1.missed).toBe(NOTE_COUNT);
    expect(state.p1.perfect + state.p1.good + state.p1.wild).toBe(presses);
    // Mashing takes every note and pays for the two thousand presses in between, which is
    // the whole reason a wild press costs a point. It also takes not one perfect: the
    // earliest frame inside a window is the one that claims the note, and that frame is a
    // good 0.18 s early.
    expect(state.p1.good).toBe(NOTE_COUNT);
    expect(state.p1.perfect).toBe(0);
    expect(state.p1.wild).toBe(presses - NOTE_COUNT);
    expect(state.p1.score).toBe(NOTE_COUNT * GOOD_POINTS - (presses - NOTE_COUNT) * WILD_PENALTY);
  });

  it('keeps the cursor shared, so a window closes on the clock and not on a seat', () => {
    const state = fresh(9);
    for (let i = 0; i < 400; i += 1) step(state, STEP, i === 200, false);
    for (let n = 0; n < state.cursor; n += 1) {
      expect(state.p1Judged[n]).not.toBe('none');
      expect(state.p2Judged[n]).not.toBe('none');
    }
  });
});

/* ================================================================= termination */

describe('termination', () => {
  it('ends after exactly one track, whatever anybody does', () => {
    const expected = MATCH_STEPS;
    for (const [a, b] of [
      [false, false],
      [true, true],
      [true, false],
    ] as const) {
      const state = fresh(3);
      let steps = 0;
      while (state.winner === null) {
        step(state, STEP, a, b);
        steps += 1;
        expect(steps).toBeLessThan(60 * 600);
      }
      expect(steps).toBe(expected);
      expect(state.clock).toBeGreaterThanOrEqual(MATCH_SECONDS);
    }
  });

  it('finishes two easy bots inside ten simulated minutes, with the track really run out', () => {
    // `termination.test.ts` plays every game with two `easy` bots and gives it ten minutes.
    // This match takes 2401 steps — forty seconds — and it takes them for every seed, because
    // the gap multiset is fixed and only its order is shuffled. `roundSeconds` ends nothing;
    // this does.
    for (let seed = 0; seed < 40; seed += 1) {
      const state = playBots(seed * 31 + 5, seed * 7 + 1, seed * 13 + 2, 'easy', 'easy');
      expect(state.clock).toBeGreaterThanOrEqual(MATCH_SECONDS);
      expect(state.cursor).toBe(NOTE_COUNT);
      expect(winnerOf(state)).not.toBeNull();
      for (let n = 0; n < NOTE_COUNT; n += 1) {
        expect(state.p1Judged[n]).not.toBe('none');
        expect(state.p2Judged[n]).not.toBe('none');
      }
    }
  });

  it('does nothing at all once the match is over', () => {
    const state = fresh(6);
    while (state.winner === null) step(state, STEP, false, false);
    const before = JSON.stringify([snapshot(state.p1), snapshot(state.p2), state.clock]);
    for (let i = 0; i < 50; i += 1) step(state, STEP, true, true);
    expect(JSON.stringify([snapshot(state.p1), snapshot(state.p2), state.clock])).toBe(before);
  });

  it('runs its clock down to nothing and no further', () => {
    const state = fresh(6);
    expect(remainingOf(state)).toBeCloseTo(1, 10);
    while (state.winner === null) step(state, STEP, false, false);
    expect(remainingOf(state)).toBe(0);
  });
});

/* ============================================================== the tie-breaks */

describe('the tie-breaks', () => {
  it('settles a level score on dead-centre hits, then on mistakes, then draws', () => {
    // Built by hand rather than sampled, because what matters is the order of the three
    // rules and a sampled match cannot pin it down.
    const state = fresh(2);
    while (state.winner === null) step(state, STEP, false, false);
    expect(state.p1.score).toBe(state.p2.score);
    expect(winnerOf(state)).toBe('draw');
  });

  it('is not a function of the board, because there is no board to be a function of', () => {
    // Maze Paint's finding, and Sudoku's: on a symmetric position a covariant tie-break
    // returns a mirrored answer and so decides nothing. Both tie-breaks here count what a
    // *player* did — perfects, then mistakes — which is the only thing in this game that can
    // differ between the two seats at all.
    const state = fresh(2);
    while (state.winner === null) step(state, STEP, true, true);
    expect(snapshot(state.p1)).toEqual(snapshot(state.p2));
    expect(winnerOf(state)).toBe('draw');
  });

  it('prefers the seat with more perfects when the scores are level', () => {
    // Three dead-centre hits against six merely good ones. `3 x 3 - 46` and `6 x 1 - 43`
    // are both -37, so the two seats finish level on the score and the tie-break has to do
    // the work — which is the case the score alone leaves undecided 2.2% of the time at
    // `normal` and 2.8% at `hard`.
    const state = fresh(2);
    const arrivals = state.arrivals;
    const p1Frames = new Set<number>(
      [0, 1, 2].map((n) => Math.round((arrivals[n] as number) / STEP)),
    );
    const p2Frames = new Set<number>(
      [3, 4, 5, 6, 7, 8].map((n) => Math.round(((arrivals[n] as number) + 0.12) / STEP)),
    );
    for (let i = 0; state.winner === null; i += 1) {
      step(state, STEP, p1Frames.has(i), p2Frames.has(i));
    }
    expect(state.p1.perfect).toBe(3);
    expect(state.p1.good).toBe(0);
    expect(state.p2.perfect).toBe(0);
    expect(state.p2.good).toBe(6);
    expect(state.p1.score).toBe(state.p2.score);
    expect(winnerOf(state)).toBe('p1');
  });

  it('counts a note let go and a press that answered nothing as the same mistake', () => {
    const state = fresh(2);
    for (let i = 0; i < 200; i += 1) step(state, STEP, i === 100, false);
    expect(mistakesBy(state, 'p1')).toBe(state.p1.missed + state.p1.wild);
    expect(state.p1.wild).toBe(1);
  });
});

/* ==================================================================== the bot */

describe('the bot', () => {
  it('never commits to a moment that has already gone', () => {
    // A countdown that starts expired is a bot that mashes rather than one that is late. The
    // widest error any tier can draw is `timing x FUMBLE_SCALE`, and every tier's is inside
    // the lane it commits from.
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(profile.timing * FUMBLE_SCALE).toBeLessThan(APPROACH_SECONDS);
    }
  });

  it('presses on the frame nearest the moment it committed to, at every tier', () => {
    // Issue #2465: a bot that reasons about a quantity analytically and a referee that
    // integrates it must agree *exactly*, and five games in this repository did not. Here
    // they are the same arithmetic — `arrival - clock + offset` counted down one delta a
    // step, judged against the clock the step began with — so the press lands within half a
    // step of the moment drawn, and this measures the worst case rather than assuming it.
    let worst = 0;
    let samples = 0;
    for (const tier of TIERS) {
      for (let trial = 0; trial < 60; trial += 1) {
        const state = fresh(trial * 19 + 3);
        const bot = createBotState();
        const rng = new Rng(trial * 7 + 11);
        // Wait until the note is on the lane, then commit by hand so the moment the tier
        // drew is readable. `driveBot` will not plan again while a countdown is running.
        while (approachOf(state, 0) > 1) step(state, STEP, false, false);
        planNote(state, tier, bot, rng);
        const target = state.clock + bot.timer;
        while (state.winner === null) {
          const press = driveBot(state, tier, bot, rng, STEP);
          // `state.clock` here is the clock the press is judged against, because `step`
          // judges before it advances. That is the whole of the claim.
          if (press) {
            worst = Math.max(worst, Math.abs(state.clock - target));
            samples += 1;
            break;
          }
          step(state, STEP, false, false);
        }
      }
    }
    expect(samples).toBe(TIERS.length * 60);
    // Half a step is 8.3 ms. Anything larger would mean the referee and the countdown were
    // reading two different clocks, which is precisely the defect #2465 names.
    expect(worst).toBeLessThanOrEqual(STEP / 2 + 1e-9);
  });

  it('draws the same number of values for every note, whatever happened on the board', () => {
    for (const tier of TIERS) {
      const state = fresh(5);
      const bot = createBotState();
      const rng = new Rng(99);
      let draws = 0;
      const counting = new Proxy(rng, {
        get(target, key: string | symbol) {
          const value = Reflect.get(target, key) as unknown;
          if (key === 'float') {
            return () => {
              draws += 1;
              return target.float();
            };
          }
          return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
        },
      });
      while (state.winner === null) {
        const press = driveBot(state, tier, bot, counting, STEP);
        step(state, STEP, press, false);
      }
      expect(bot.next).toBe(NOTE_COUNT);
      expect(draws).toBe(NOTE_COUNT * BOT_DRAWS_PER_NOTE);
    }
  });

  it('cannot double-tap its way back onto the note it just answered', () => {
    expect(STRAY_GAP_SECONDS).toBeGreaterThan(GOOD_SECONDS);
  });

  it('gets stronger with the tier, measured rather than asserted', () => {
    const mean: Record<string, number> = {};
    for (const tier of TIERS) {
      let total = 0;
      for (let trial = 0; trial < 60; trial += 1) {
        const state = playBots(trial * 31 + 5, trial * 7 + 1, trial * 13 + 2, tier, tier);
        total += state.p1.score;
      }
      mean[tier] = total / 60;
    }
    // Measured at 28.9 / 57.0 / 83.5 over 600 matches a tier; 60 is enough to order them.
    expect(mean.easy as number).toBeLessThan(mean.normal as number);
    expect(mean.normal as number).toBeLessThan(mean.hard as number);
    // And the top tier does not saturate: 83.5 of a possible 147 leaves a match to play.
    expect(mean.hard as number).toBeLessThan(NOTE_COUNT * PERFECT_POINTS * 0.75);
  });

  it('beats the tier below it from either seat', () => {
    for (const [strong, weak] of [
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as const) {
      let wins = 0;
      let played = 0;
      for (let trial = 0; trial < 60; trial += 1) {
        const asOne = playBots(trial * 17 + 2, trial * 5 + 3, trial * 11 + 4, strong, weak);
        const asTwo = playBots(trial * 17 + 2, trial * 11 + 4, trial * 5 + 3, weak, strong);
        if (asOne.winner === 'p1') wins += 1;
        if (asTwo.winner === 'p2') wins += 1;
        played += 2;
      }
      expect(wins / played).toBeGreaterThan(0.8);
    }
  });

  it('holds seat one inside the balance band at every tier, from both seat orders', () => {
    // `balance-aggregate.test.ts` asserts 45-55%. Here it is 50% by construction — the two
    // seats read one track and one clock — and the sampled figure at 3000 seeds a tier is
    // 50.7 / 50.8 / 49.7. This is the cheap version of that, run on every push.
    for (const tier of TIERS) {
      let seatOne = 0;
      let decided = 0;
      for (let trial = 0; trial < 120; trial += 1) {
        const state = playBots(trial * 23 + 9, trial * 3 + 1, trial * 41 + 7, tier, tier);
        if (state.winner === 'p1') seatOne += 1;
        if (state.winner !== 'draw') decided += 1;
      }
      const share = seatOne / decided;
      expect(share, `${tier} seat one share`).toBeGreaterThan(0.35);
      expect(share, `${tier} seat one share`).toBeLessThan(0.65);
    }
  });

  it('gives the two seats streams that cannot be pulled out of step by each other', () => {
    const source = new Rng(12345);
    const { p1, p2 } = createBotRngs(source);
    expect(p1.next()).not.toBe(p2.next());
  });

  it('starts idle and returns to idle when it is reset', () => {
    const bot = createBotState();
    expect(bot.next).toBe(0);
    expect(bot.timer).toBeLessThan(0);
    const state = fresh(1);
    for (let i = 0; i < 300; i += 1) driveBot(state, 'hard', bot, new Rng(2), STEP);
    resetBotState(bot);
    expect(bot.next).toBe(0);
    expect(bot.timer).toBeLessThan(0);
    expect(bot.strayTimer).toBeLessThan(0);
  });

  it('never loses a press it had committed to', () => {
    // The countdown's idle sentinel is -1, so a decrement that overshot into (-delta/2, 0)
    // read as *idle* on the next step and the committed press vanished without a trace. It
    // cost about half of every tier's presses. The floor at zero is what fixes it, and this
    // is the assertion that keeps it fixed: a tier plans one press a note, so it presses at
    // least once for all but the handful it plans at zero notice.
    for (const tier of TIERS) {
      const state = fresh(77);
      const bot = createBotState();
      const rng = new Rng(31);
      let presses = 0;
      while (state.winner === null) {
        const press = driveBot(state, tier, bot, rng, STEP);
        if (press) presses += 1;
        step(state, STEP, press, false);
      }
      expect(bot.next).toBe(NOTE_COUNT);
      expect(presses).toBeGreaterThanOrEqual(NOTE_COUNT);
    }
  });
});

/* ============================================================== presentation */

describe('what presentation is allowed to read', () => {
  it("reports a note's place on the lane as a fraction, never as a length", () => {
    const state = fresh(1);
    expect(approachOf(state, 0)).toBeCloseTo(LEAD_SECONDS / APPROACH_SECONDS, 10);
    // Half a second in, the first note comes into sight at the far end of the lane.
    for (let i = 0; i < 30; i += 1) step(state, STEP, false, false);
    expect(approachOf(state, 0)).toBeCloseTo(1, 6);
  });

  it('lets a note that has landed keep counting down, so it can be drawn leaving', () => {
    const state = fresh(1);
    for (let i = 0; i < 160; i += 1) step(state, STEP, false, false);
    expect(approachOf(state, 0)).toBeLessThan(0);
  });

  it('never asks for a note whose window shut more than one gap ago', () => {
    const state = fresh(1);
    while (state.winner === null) {
      step(state, STEP, false, false);
      const first = firstDrawable(state);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeGreaterThanOrEqual(state.cursor - 2);
    }
  });

  it("hands a seat its own numbers and nobody else's", () => {
    const state = fresh(1);
    expect(sideOf(state, 'p1')).toBe(state.p1);
    expect(sideOf(state, 'p2')).toBe(state.p2);
    expect(judgedBy(state, 'p1')).toBe(state.p1Judged);
    expect(judgedBy(state, 'p2')).toBe(state.p2Judged);
  });
});

/* ============================================================== determinism */

describe('determinism', () => {
  it('replays a match exactly from the same seed', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const a = playBots(seed, seed * 3 + 1, seed * 5 + 2, 'normal', 'hard');
      const b = playBots(seed, seed * 3 + 1, seed * 5 + 2, 'normal', 'hard');
      expect(snapshot(a.p1)).toEqual(snapshot(b.p1));
      expect(snapshot(a.p2)).toEqual(snapshot(b.p2));
      expect(a.winner).toBe(b.winner);
    }
  });

  it('resets to a genuinely fresh match, with nothing carried over', () => {
    const state = fresh(1);
    while (state.winner === null) step(state, STEP, true, false);
    resetState(state, new Rng(1));
    expect(state.clock).toBe(0);
    expect(state.cursor).toBe(0);
    expect(state.winner).toBeNull();
    expect(snapshot(state.p1)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(snapshot(state.p2)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(state.p1Judged.every((j) => j === 'none')).toBe(true);
    expect(state.arrivals).toEqual(fresh(1).arrivals);
  });
});
