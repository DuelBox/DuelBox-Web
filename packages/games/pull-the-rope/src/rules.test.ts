import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  DECAY_RATE,
  EXHAUSTED_PULL,
  MARKS_TO_WIN,
  MARK_SPACING,
  PULL_COST,
  PULL_STRENGTH,
  RECOVER_RATE,
  STAMINA_MAX,
  SUSTAINED_TAP_RATE,
  WIN_DISTANCE,
  botPull,
  createState,
  decay,
  marksHeld,
  pull,
  pullFactor,
  recover,
  staminaOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, RopeState } from './rules.js';

const STEP = 1 / 60;
const DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function stateAt(position: number, p1Stamina = STAMINA_MAX, p2Stamina = STAMINA_MAX): RopeState {
  return { position, p1Stamina, p2Stamina };
}

/** Taps a seat until its reserve is empty, then re-centres the marker. */
function drain(state: RopeState, seat: SeatId): void {
  while (staminaOf(state, seat) > 0) pull(state, seat, PULL_STRENGTH);
  state.position = 0;
}

/** Taps a bot seat over `steps` fixed steps and reports how many taps it made. */
function countTaps(
  state: RopeState,
  seat: SeatId,
  difficulty: BotDifficulty,
  seed: number,
  steps: number,
): number {
  const rng = new Rng(seed);
  let taps = 0;
  for (let i = 0; i < steps; i += 1) {
    if (botPull(state, seat, difficulty, rng, STEP) > 0) taps += 1;
  }
  return taps;
}

describe('createState', () => {
  it('starts the marker centred with both reserves full', () => {
    const state = createState();
    expect(state.position).toBe(0);
    expect(state.p1Stamina).toBe(STAMINA_MAX);
    expect(state.p2Stamina).toBe(STAMINA_MAX);
    expect(winnerOf(state)).toBeNull();
    expect(marksHeld(state, 'p1')).toBe(0);
    expect(marksHeld(state, 'p2')).toBe(0);
  });
});

describe('pull', () => {
  it('drags the marker toward p1 and spends only p1 reserve', () => {
    const state = createState();
    const worth = pull(state, 'p1', PULL_STRENGTH);

    expect(worth).toBeCloseTo(PULL_STRENGTH, 9);
    expect(state.position).toBeCloseTo(PULL_STRENGTH, 9);
    expect(state.p1Stamina).toBeCloseTo(STAMINA_MAX - PULL_COST, 9);
    expect(state.p2Stamina).toBe(STAMINA_MAX);
  });

  it('drags the marker toward p2 and spends only p2 reserve', () => {
    const state = createState();
    pull(state, 'p2', PULL_STRENGTH);

    expect(state.position).toBeCloseTo(-PULL_STRENGTH, 9);
    expect(state.p2Stamina).toBeCloseTo(STAMINA_MAX - PULL_COST, 9);
    expect(state.p1Stamina).toBe(STAMINA_MAX);
  });

  it('is worth its whole strength at a full reserve and a fifth at an empty one', () => {
    expect(pullFactor(STAMINA_MAX)).toBeCloseTo(1, 9);
    expect(pullFactor(0)).toBeCloseTo(EXHAUSTED_PULL, 9);
    expect(pullFactor(-3)).toBeCloseTo(EXHAUSTED_PULL, 9);
    expect(pullFactor(9)).toBeCloseTo(1, 9);
  });

  it('pulls measurably weaker once the reserve is empty', () => {
    const fresh = createState();
    const freshGain = pull(fresh, 'p1', PULL_STRENGTH);

    const spent = createState();
    drain(spent, 'p1');
    expect(spent.p1Stamina).toBe(0);
    const spentGain = pull(spent, 'p1', PULL_STRENGTH);

    expect(spentGain).toBeCloseTo(PULL_STRENGTH * EXHAUSTED_PULL, 9);
    expect(spentGain).toBeLessThan(freshGain / 3);
    expect(spent.position).toBeLessThan(fresh.position / 3);
  });

  it('never drives a reserve below empty', () => {
    const state = createState();
    for (let i = 0; i < 200; i += 1) pull(state, 'p2', PULL_STRENGTH);
    expect(state.p2Stamina).toBe(0);
  });

  it('ignores a strength that is not a positive number', () => {
    const state = createState();
    for (const strength of [0, -PULL_STRENGTH, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pull(state, 'p1', strength)).toBe(0);
    }
    expect(state.position).toBe(0);
    expect(state.p1Stamina).toBe(STAMINA_MAX);
  });

  it('stops the marker on the win line however many taps land', () => {
    const toP1 = createState();
    for (let i = 0; i < 400; i += 1) pull(toP1, 'p1', PULL_STRENGTH);
    expect(toP1.position).toBe(WIN_DISTANCE);

    const toP2 = createState();
    for (let i = 0; i < 400; i += 1) pull(toP2, 'p2', PULL_STRENGTH);
    expect(toP2.position).toBe(-WIN_DISTANCE);
  });
});

describe('recover', () => {
  it('returns stamina at the recover rate', () => {
    const state = stateAt(0, 0, 0);
    recover(state, 1);
    expect(state.p1Stamina).toBeCloseTo(RECOVER_RATE, 9);
    expect(state.p2Stamina).toBeCloseTo(RECOVER_RATE, 9);
  });

  it('caps at a full reserve however long it runs', () => {
    const state = stateAt(0, 0.9, 0);
    recover(state, 60);
    expect(state.p1Stamina).toBe(STAMINA_MAX);
    expect(state.p2Stamina).toBe(STAMINA_MAX);
  });

  it('refills the same amount however the second is chopped up', () => {
    const fine = stateAt(0, 0, 0);
    for (let i = 0; i < 60; i += 1) recover(fine, STEP);
    const coarse = stateAt(0, 0, 0);
    recover(coarse, 1);
    expect(fine.p1Stamina).toBeCloseTo(coarse.p1Stamina, 9);
  });

  it('ignores a step that is not positive', () => {
    const state = stateAt(0, 0.4, 0.4);
    recover(state, 0);
    recover(state, -1);
    recover(state, Number.NaN);
    expect(state.p1Stamina).toBe(0.4);
  });
});

describe('decay', () => {
  it('drifts the marker toward the centre without ever crossing it', () => {
    const state = stateAt(300);
    decay(state, 1);
    expect(state.position).toBeCloseTo(300 * Math.exp(-DECAY_RATE), 9);
    for (let i = 0; i < 5000; i += 1) decay(state, STEP);
    expect(state.position).toBeGreaterThan(0);
    expect(state.position).toBeLessThan(1);
  });

  it('brings a marker on p2 side back up toward the centre', () => {
    const state = stateAt(-300);
    decay(state, 1);
    expect(state.position).toBeGreaterThan(-300);
    expect(state.position).toBeLessThan(0);
  });

  it('is frame-rate independent: two half steps equal one whole step', () => {
    const fine = stateAt(250);
    decay(fine, STEP);
    decay(fine, STEP);
    const coarse = stateAt(250);
    decay(coarse, STEP * 2);
    expect(fine.position).toBeCloseTo(coarse.position, 9);
  });

  it('leaves a centred marker and a non-positive step alone', () => {
    const centred = stateAt(0);
    decay(centred, 1);
    expect(centred.position).toBe(0);

    const held = stateAt(120);
    decay(held, 0);
    decay(held, -2);
    expect(held.position).toBe(120);
  });
});

describe('marksHeld', () => {
  it('counts nothing inside the dead ground at the centre', () => {
    expect(marksHeld(stateAt(MARK_SPACING - 0.001), 'p1')).toBe(0);
    expect(marksHeld(stateAt(-MARK_SPACING + 0.001), 'p2')).toBe(0);
  });

  it('counts a mark for each rung taken', () => {
    expect(marksHeld(stateAt(MARK_SPACING), 'p1')).toBe(1);
    expect(marksHeld(stateAt(MARK_SPACING * 4.5), 'p1')).toBe(4);
    expect(marksHeld(stateAt(-MARK_SPACING * 7), 'p2')).toBe(7);
  });

  it('gives the seat losing ground nothing at all', () => {
    expect(marksHeld(stateAt(MARK_SPACING * 6), 'p2')).toBe(0);
    expect(marksHeld(stateAt(-MARK_SPACING * 6), 'p1')).toBe(0);
  });

  it('never reports more marks than the rope has', () => {
    expect(marksHeld(stateAt(WIN_DISTANCE), 'p1')).toBe(MARKS_TO_WIN);
    expect(marksHeld(stateAt(WIN_DISTANCE * 4), 'p1')).toBe(MARKS_TO_WIN);
  });

  it('measures against the win distance it is given', () => {
    expect(marksHeld(stateAt(50), 'p1', 100)).toBe(5);
    expect(marksHeld(stateAt(50), 'p1', 0)).toBe(0);
    expect(marksHeld(stateAt(50), 'p1', Number.NaN)).toBe(0);
  });
});

describe('winnerOf', () => {
  it('has no winner while the marker is short of a line', () => {
    expect(winnerOf(createState())).toBeNull();
    expect(winnerOf(stateAt(WIN_DISTANCE - 0.000_001))).toBeNull();
    expect(winnerOf(stateAt(-WIN_DISTANCE + 0.000_001))).toBeNull();
  });

  it('awards the match exactly at the win distance', () => {
    expect(winnerOf(stateAt(WIN_DISTANCE))).toBe('p1');
    expect(winnerOf(stateAt(-WIN_DISTANCE))).toBe('p2');
  });

  it('measures against the win distance it is given', () => {
    expect(winnerOf(stateAt(100), 100)).toBe('p1');
    expect(winnerOf(stateAt(100), 200)).toBeNull();
  });
});

describe('botPull', () => {
  it('taps with exactly a player tap or not at all', () => {
    const state = createState();
    const rng = new Rng(4711);
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < 3000; i += 1) {
        const strength = botPull(state, 'p2', difficulty, rng, STEP);
        expect(strength === 0 || strength === PULL_STRENGTH).toBe(true);
      }
    }
  });

  it('taps at about the cadence its profile declares', () => {
    const state = createState();
    const steps = 36_000;
    for (const difficulty of DIFFICULTIES) {
      const taps = countTaps(state, 'p1', difficulty, 99, steps);
      const expected = BOT_PROFILES[difficulty].tapsPerSecond * steps * STEP;
      expect(taps).toBeGreaterThan(expected * 0.75);
      expect(taps).toBeLessThan(expected * 1.25);
    }
  });

  it('taps more often the harder the tier', () => {
    const state = createState();
    const easy = countTaps(state, 'p1', 'easy', 31_337, 36_000);
    const normal = countTaps(state, 'p1', 'normal', 31_337, 36_000);
    const hard = countTaps(state, 'p1', 'hard', 31_337, 36_000);
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
  });

  it('eases off on a spent reserve instead of mashing through it', () => {
    const rested = countTaps(createState(), 'p1', 'hard', 7, 18_000);
    const spent = countTaps(stateAt(0, 0.05), 'p1', 'hard', 7, 18_000);
    expect(spent * 3).toBeLessThan(rested);
  });

  it('never taps on a step that is not positive', () => {
    const rng = new Rng(5);
    const state = createState();
    expect(botPull(state, 'p1', 'hard', rng, 0)).toBe(0);
    expect(botPull(state, 'p1', 'hard', rng, -STEP)).toBe(0);
    expect(botPull(state, 'p1', 'hard', rng, Number.NaN)).toBe(0);
  });

  it('gives no tier a cadence a paced player cannot match', () => {
    let previousRate = 0;
    let previousJitter = Number.POSITIVE_INFINITY;
    for (const difficulty of DIFFICULTIES) {
      const profile = BOT_PROFILES[difficulty];
      expect(profile.tapsPerSecond).toBeLessThan(SUSTAINED_TAP_RATE);
      expect(profile.tapsPerSecond).toBeGreaterThan(previousRate);
      expect(profile.jitter).toBeLessThan(previousJitter);
      previousRate = profile.tapsPerSecond;
      previousJitter = profile.jitter;
    }
  });
});

describe('determinism', () => {
  function runTugOfWar(seed: number): number[] {
    const rng = new Rng(seed);
    const state = createState();
    for (let step = 0; step < 3000; step += 1) {
      const p1 = botPull(state, 'p1', 'normal', rng, STEP);
      if (p1 > 0) pull(state, 'p1', p1);
      const p2 = botPull(state, 'p2', 'hard', rng, STEP);
      if (p2 > 0) pull(state, 'p2', p2);
      recover(state, STEP);
      decay(state, STEP);
    }
    return [state.position, state.p1Stamina, state.p2Stamina];
  }

  it('replays a whole tug-of-war identically from the same seed', () => {
    const first = runTugOfWar(2026);
    expect(first).toEqual(runTugOfWar(2026));
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('diverges on a different seed, so the contest is not a fixed script', () => {
    expect(runTugOfWar(2026)).not.toEqual(runTugOfWar(4052));
  });
});
