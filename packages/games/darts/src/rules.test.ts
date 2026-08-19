import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BOT_PROFILES,
  DARTS_PER_TURN,
  DOUBLE_INNER,
  DOUBLE_OUTER,
  INNER_BULL,
  OUTER_BULL,
  SECTORS,
  STARTING_SCORE,
  TRIPLE_INNER,
  TRIPLE_OUTER,
  aimAtSector,
  botAim,
  createSeatState,
  resetSeatState,
  scatter,
  scoreAt,
  startTurn,
  throwDart,
  winnerOf,
} from './rules.js';

const aim = { x: 0, y: 0 };

describe('the board', () => {
  it('has twenty sectors, each number exactly once', () => {
    expect(SECTORS.length).toBe(20);
    expect(new Set(SECTORS).size).toBe(20);
    expect([...SECTORS].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('interleaves high and low numbers, so a near miss is punished', () => {
    // The property that makes treble twenty a risk rather than a formality: 20 sits
    // between 1 and 5. A board in numeric order would be a different game.
    const twenty = SECTORS.indexOf(20);
    const before = SECTORS[(twenty + SECTORS.length - 1) % SECTORS.length];
    const after = SECTORS[(twenty + 1) % SECTORS.length];
    expect(before).toBe(5);
    expect(after).toBe(1);
  });

  it('puts 20 at the top', () => {
    aimAtSector(aim, 20, 0.8);
    expect(aim.x).toBeCloseTo(0, 6);
    expect(aim.y).toBeLessThan(0);
  });
});

describe('scoring a dart', () => {
  it('scores the bulls', () => {
    expect(scoreAt(0, 0)).toMatchObject({ ring: 'inner-bull', score: 50 });
    expect(scoreAt(0, -(INNER_BULL + OUTER_BULL) / 2)).toMatchObject({
      ring: 'outer-bull',
      score: 25,
    });
  });

  it('scores a miss outside the board', () => {
    expect(scoreAt(0, -1.2)).toMatchObject({ ring: 'miss', score: 0 });
    expect(scoreAt(1.5, 1.5).score).toBe(0);
  });

  it('scores single, treble and double in the same sector', () => {
    aimAtSector(aim, 20, 0.3);
    expect(scoreAt(aim.x, aim.y)).toMatchObject({ sector: 20, ring: 'single', score: 20 });

    aimAtSector(aim, 20, (TRIPLE_INNER + TRIPLE_OUTER) / 2);
    expect(scoreAt(aim.x, aim.y)).toMatchObject({ sector: 20, ring: 'triple', score: 60 });

    aimAtSector(aim, 20, (DOUBLE_INNER + DOUBLE_OUTER) / 2);
    expect(scoreAt(aim.x, aim.y)).toMatchObject({ sector: 20, ring: 'double', score: 40 });
  });

  it('scores every sector correctly at its own angle', () => {
    for (const sector of SECTORS) {
      aimAtSector(aim, sector, 0.35);
      const landing = scoreAt(aim.x, aim.y);
      expect(landing.sector, `sector ${String(sector)}`).toBe(sector);
      expect(landing.score).toBe(sector);
    }
  });

  it('never scores more than sixty from one dart', () => {
    // The highest possible dart is treble twenty. A scoring bug that let a sector run
    // over would be invisible until someone finished a leg impossibly fast.
    const rng = new Rng(9);
    for (let i = 0; i < 4000; i += 1) {
      const x = (rng.float() - 0.5) * 2.4;
      const y = (rng.float() - 0.5) * 2.4;
      const { score } = scoreAt(x, y);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(60);
    }
  });

  it('is continuous across the ring boundaries', () => {
    // Just inside and just outside the double ring must differ, and neither may be a
    // miss — an off-by-one here silently swallows the winning dart of a match.
    aimAtSector(aim, 20, DOUBLE_INNER + 0.001);
    expect(scoreAt(aim.x, aim.y).ring).toBe('double');
    aimAtSector(aim, 20, DOUBLE_OUTER - 0.001);
    expect(scoreAt(aim.x, aim.y).ring).toBe('double');
    aimAtSector(aim, 20, DOUBLE_OUTER + 0.01);
    expect(scoreAt(aim.x, aim.y).ring).toBe('miss');
  });
});

describe('a turn', () => {
  it('starts at 301 with three darts', () => {
    const state = createSeatState();
    expect(state.remaining).toBe(STARTING_SCORE);
    expect(state.thrown).toBe(0);
    expect(DARTS_PER_TURN).toBe(3);
  });

  it('subtracts each dart and ends after three', () => {
    const state = createSeatState();
    const start = state.remaining;
    let result = throwDart(state, { sector: 20, ring: 'single', score: 20 }, start);
    expect(result.outcome).toBe('scored');
    expect(result.turnOver).toBe(false);
    expect(state.remaining).toBe(281);

    throwDart(state, { sector: 20, ring: 'single', score: 20 }, start);
    result = throwDart(state, { sector: 20, ring: 'single', score: 20 }, start);
    expect(result.turnOver, 'the third dart ends the turn').toBe(true);
    expect(state.remaining).toBe(241);
  });

  it('records what each dart scored, for the HUD', () => {
    const state = createSeatState();
    throwDart(state, { sector: 5, ring: 'single', score: 5 }, state.remaining);
    expect(state.turnScores[0]).toBe(5);
    expect(state.turnScores[1], 'unthrown darts stay at -1').toBe(-1);
  });

  it('clears the turn on startTurn', () => {
    const state = createSeatState();
    throwDart(state, { sector: 5, ring: 'single', score: 5 }, state.remaining);
    startTurn(state);
    expect(state.thrown).toBe(0);
    expect(state.turnScores).toEqual([-1, -1, -1]);
  });

  it('resets to the start of the game', () => {
    const state = createSeatState();
    throwDart(state, { sector: 20, ring: 'triple', score: 60 }, state.remaining);
    resetSeatState(state);
    expect(state.remaining).toBe(STARTING_SCORE);
  });
});

describe('the double out', () => {
  it('wins on an exact double', () => {
    const state = createSeatState();
    state.remaining = 40;
    const result = throwDart(state, { sector: 20, ring: 'double', score: 40 }, 40);
    expect(result.outcome).toBe('won');
    expect(result.turnOver).toBe(true);
    expect(state.remaining).toBe(0);
  });

  it('wins on the inner bull, which counts as a double', () => {
    const state = createSeatState();
    state.remaining = 50;
    expect(throwDart(state, { sector: 0, ring: 'inner-bull', score: 50 }, 50).outcome).toBe('won');
  });

  it('busts on reaching zero without a double', () => {
    // The rule that makes the last dart the hardest throw in the game.
    const state = createSeatState();
    state.remaining = 40;
    const result = throwDart(state, { sector: 20, ring: 'double', score: 40 }, 40);
    expect(result.outcome).toBe('won');

    const other = createSeatState();
    other.remaining = 60;
    const bust = throwDart(other, { sector: 20, ring: 'triple', score: 60 }, 60);
    expect(bust.outcome, 'a treble cannot finish').toBe('bust');
    expect(other.remaining, 'a bust returns the score to the turn start').toBe(60);
  });

  it('busts on going below zero', () => {
    const state = createSeatState();
    state.remaining = 20;
    const result = throwDart(state, { sector: 20, ring: 'triple', score: 60 }, 20);
    expect(result.outcome).toBe('bust');
    expect(state.remaining).toBe(20);
  });

  it('busts on landing exactly on one, which cannot be finished', () => {
    const state = createSeatState();
    state.remaining = 21;
    const result = throwDart(state, { sector: 20, ring: 'single', score: 20 }, 21);
    expect(result.outcome).toBe('bust');
    expect(state.remaining).toBe(21);
  });

  it('voids the whole turn on a bust, not just the offending dart', () => {
    const state = createSeatState();
    const start = 60;
    state.remaining = start;
    throwDart(state, { sector: 20, ring: 'single', score: 20 }, start);
    expect(state.remaining).toBe(40);
    const result = throwDart(state, { sector: 20, ring: 'triple', score: 60 }, start);
    expect(result.outcome).toBe('bust');
    // Back to 60, not to 40: the good dart is void too.
    expect(state.remaining).toBe(start);
  });

  it('ends the turn on a bust, however many darts are left', () => {
    const state = createSeatState();
    state.remaining = 5;
    const result = throwDart(state, { sector: 20, ring: 'single', score: 20 }, 5);
    expect(result.turnOver).toBe(true);
  });
});

describe('the winner', () => {
  it('is nobody while both seats have points left', () => {
    expect(winnerOf(createSeatState(), createSeatState())).toBeNull();
  });

  it('is whichever seat reached zero', () => {
    const p1 = createSeatState();
    const p2 = createSeatState();
    p1.remaining = 0;
    expect(winnerOf(p1, p2)).toBe('p1');
    p2.remaining = 0;
    p1.remaining = 20;
    expect(winnerOf(p1, p2)).toBe('p2');
  });
});

describe('the bot', () => {
  it('aims at treble twenty while the score is high', () => {
    botAim(aim, 301);
    const landing = scoreAt(aim.x, aim.y);
    expect(landing.sector).toBe(20);
    expect(landing.ring).toBe('triple');
  });

  it('switches to the finishing double once one is reachable', () => {
    botAim(aim, 32);
    const landing = scoreAt(aim.x, aim.y);
    expect(landing.ring).toBe('double');
    expect(landing.score).toBe(32);
  });

  it('goes for the bull on fifty', () => {
    botAim(aim, 50);
    expect(scoreAt(aim.x, aim.y).ring).toBe('inner-bull');
  });

  it('scatters normally rather than in a box, and stays seeded', () => {
    const a: number[] = [];
    const b: number[] = [];
    const rngA = new Rng(4);
    const rngB = new Rng(4);
    const out = { x: 0, y: 0 };
    for (let i = 0; i < 200; i += 1) {
      scatter(out, 0, 0, 0.1, rngA);
      a.push(out.x, out.y);
      scatter(out, 0, 0, 0.1, rngB);
      b.push(out.x, out.y);
    }
    expect(a, 'the same seed must throw the same darts').toEqual(b);
    // A normal spread clusters near the aim; a uniform box would not.
    const near = a.filter((v) => Math.abs(v) < 0.1).length;
    expect(near / a.length).toBeGreaterThan(0.5);
  });

  it('never produces a non-finite dart, however unlucky the draw', () => {
    // `float()` can return 0 and log(0) is -Infinity, which would put a dart at NaN and
    // score it as a miss forever after.
    const rng = new Rng(123);
    const out = { x: 0, y: 0 };
    for (let i = 0; i < 5000; i += 1) {
      scatter(out, 0.2, -0.3, 0.2, rng);
      expect(Number.isFinite(out.x) && Number.isFinite(out.y)).toBe(true);
    }
  });

  it('gets tighter as the difficulty rises', () => {
    expect(BOT_PROFILES.easy.spread).toBeGreaterThan(BOT_PROFILES.normal.spread);
    expect(BOT_PROFILES.normal.spread).toBeGreaterThan(BOT_PROFILES.hard.spread);
  });

  it('scores better on the hard tier than the easy one, over many turns', () => {
    // The tiers must differ in strength rather than only in label.
    const average = (difficulty: 'easy' | 'hard'): number => {
      const rng = new Rng(77);
      const out = { x: 0, y: 0 };
      let total = 0;
      const darts = 600;
      for (let i = 0; i < darts; i += 1) {
        botAim(aim, 301);
        scatter(out, aim.x, aim.y, BOT_PROFILES[difficulty].spread, rng);
        total += scoreAt(out.x, out.y).score;
      }
      return total / darts;
    };
    expect(average('hard')).toBeGreaterThan(average('easy'));
  });
});
