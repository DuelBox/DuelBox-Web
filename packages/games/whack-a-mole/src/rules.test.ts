import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { BotDifficulty, Mole } from './rules.js';
import {
  BASE_SPAWN_RATE,
  BOT_PROFILES,
  GRID_COLUMNS,
  GRID_ROWS,
  HOLE_COUNT,
  MAX_LIFETIME,
  MAX_SPAWN_RATE,
  MIN_LIFETIME,
  MOLE_POOL,
  MOLE_SHAPE,
  NO_HOLE,
  RAMP_SECONDS,
  botTarget,
  createMoles,
  hit,
  moleAt,
  retireAll,
  spawn,
  spawnRateAt,
  step,
  upCount,
} from './rules.js';

const STEP = 1 / 60;

const DIFFICULTIES: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function raise(moles: Mole[], slot: number, hole: number, seat: SeatId, lifetime = 1): Mole {
  const mole = moles[slot]!;
  mole.hole = hole;
  mole.seat = seat;
  mole.upSeconds = 0;
  mole.lifetime = lifetime;
  return mole;
}

/** Every hole currently occupied, in slot order. Duplicates are exactly what we hunt for. */
function occupiedHoles(moles: readonly Mole[]): number[] {
  const holes: number[] = [];
  for (const mole of moles) {
    if (mole.hole !== NO_HOLE) holes.push(mole.hole);
  }
  return holes;
}

describe('the grid', () => {
  it('is four columns by three rows', () => {
    expect(GRID_COLUMNS).toBe(4);
    expect(GRID_ROWS).toBe(3);
    expect(HOLE_COUNT).toBe(12);
  });

  it('gives the two seats different silhouettes, so colour is never the only signal', () => {
    expect(MOLE_SHAPE.p1).not.toBe(MOLE_SHAPE.p2);
  });
});

describe('createMoles', () => {
  it('hands back a full pool with every slot free', () => {
    const moles = createMoles();
    expect(moles).toHaveLength(MOLE_POOL);
    expect(upCount(moles)).toBe(0);
    for (const mole of moles) expect(mole.hole).toBe(NO_HOLE);
  });
});

describe('spawn', () => {
  it('never raises more moles than the pool holds', () => {
    const moles = createMoles();
    const rng = new Rng(1234);
    for (let i = 0; i < 5000; i += 1) {
      spawn(moles, HOLE_COUNT, rng, STEP, 1000);
      expect(upCount(moles)).toBeLessThanOrEqual(MOLE_POOL);
    }
    expect(upCount(moles)).toBe(MOLE_POOL);
  });

  it('never puts two moles in one hole', () => {
    const moles = createMoles();
    const rng = new Rng(99);
    for (let i = 0; i < 6000; i += 1) {
      spawn(moles, HOLE_COUNT, rng, STEP, 40);
      step(moles, STEP);
      const holes = occupiedHoles(moles);
      expect(new Set(holes).size).toBe(holes.length);
      for (const hole of holes) {
        expect(hole).toBeGreaterThanOrEqual(0);
        expect(hole).toBeLessThan(HOLE_COUNT);
      }
    }
  });

  it('reports the hole it raised, and reports nothing when it raises nothing', () => {
    const moles = createMoles();
    const rng = new Rng(5);
    let raised = 0;
    for (let i = 0; i < 400; i += 1) {
      const hole = spawn(moles, HOLE_COUNT, rng, STEP, 6);
      if (hole === NO_HOLE) continue;
      raised += 1;
      expect(moleAt(moles, hole)).toBeGreaterThanOrEqual(0);
      step(moles, STEP);
    }
    expect(raised).toBeGreaterThan(0);
  });

  it('stays inside the hole count it is given', () => {
    const moles = createMoles();
    const rng = new Rng(77);
    for (let i = 0; i < 500; i += 1) spawn(moles, 3, rng, STEP, 1000);
    expect(upCount(moles)).toBe(3);
    for (const mole of moles) {
      if (mole.hole !== NO_HOLE) expect(mole.hole).toBeLessThan(3);
    }
  });

  it('raises nothing at all at a rate of zero', () => {
    const moles = createMoles();
    const rng = new Rng(3);
    for (let i = 0; i < 2000; i += 1) expect(spawn(moles, HOLE_COUNT, rng, STEP, 0)).toBe(NO_HOLE);
    expect(upCount(moles)).toBe(0);
  });

  it('raises both seats colours and gives every mole a lifetime in the band', () => {
    const moles = createMoles();
    const rng = new Rng(2026);
    const seats = new Set<SeatId>();
    for (let i = 0; i < 3000; i += 1) {
      const hole = spawn(moles, HOLE_COUNT, rng, STEP, 20);
      if (hole !== NO_HOLE) {
        const mole = moles[moleAt(moles, hole)]!;
        seats.add(mole.seat);
        expect(mole.upSeconds).toBe(0);
        expect(mole.lifetime).toBeGreaterThanOrEqual(MIN_LIFETIME);
        expect(mole.lifetime).toBeLessThan(MAX_LIFETIME);
      }
      step(moles, STEP);
    }
    expect(seats.size).toBe(2);
  });
});

describe('spawnRateAt', () => {
  it('starts at the base rate and climbs to the ceiling', () => {
    expect(spawnRateAt(0)).toBe(BASE_SPAWN_RATE);
    expect(spawnRateAt(RAMP_SECONDS)).toBe(MAX_SPAWN_RATE);
    expect(spawnRateAt(RAMP_SECONDS * 10)).toBe(MAX_SPAWN_RATE);
    expect(spawnRateAt(-5)).toBe(BASE_SPAWN_RATE);
  });

  it('never falls back as a match goes on', () => {
    let previous = spawnRateAt(0);
    for (let second = 1; second <= 120; second += 1) {
      const rate = spawnRateAt(second);
      expect(rate).toBeGreaterThanOrEqual(previous);
      previous = rate;
    }
    expect(spawnRateAt(RAMP_SECONDS)).toBeGreaterThan(spawnRateAt(0));
  });

  it('actually puts more moles on the board at the later rate', () => {
    function countSpawns(rate: number): number {
      const moles = createMoles();
      const rng = new Rng(4242);
      let count = 0;
      for (let i = 0; i < 1200; i += 1) {
        if (spawn(moles, HOLE_COUNT, rng, STEP, rate) !== NO_HOLE) count += 1;
        step(moles, STEP);
      }
      return count;
    }
    expect(countSpawns(MAX_SPAWN_RATE)).toBeGreaterThan(countSpawns(BASE_SPAWN_RATE));
  });
});

describe('step', () => {
  it('ages a mole and retires it the moment its lifetime is up', () => {
    const moles = createMoles();
    const mole = raise(moles, 0, 5, 'p1', 1);

    for (let i = 0; i < 3; i += 1) expect(step(moles, 0.25)).toBe(0);
    expect(mole.hole).toBe(5);
    expect(mole.upSeconds).toBeCloseTo(0.75, 12);

    expect(step(moles, 0.25)).toBe(1);
    expect(mole.hole).toBe(NO_HOLE);
    expect(upCount(moles)).toBe(0);
  });

  it('retires several moles in one step and counts them', () => {
    const moles = createMoles();
    raise(moles, 0, 1, 'p1', 0.5);
    raise(moles, 1, 2, 'p2', 0.5);
    raise(moles, 2, 3, 'p1', 2);
    expect(step(moles, 0.5)).toBe(2);
    expect(upCount(moles)).toBe(1);
  });

  it('leaves free slots alone', () => {
    const moles = createMoles();
    expect(step(moles, 10)).toBe(0);
    for (const mole of moles) {
      expect(mole.hole).toBe(NO_HOLE);
      expect(mole.upSeconds).toBe(0);
    }
  });
});

describe('hit', () => {
  it('scores your own colour and takes the mole down', () => {
    const moles = createMoles();
    const mole = raise(moles, 0, 7, 'p1');
    expect(hit(moles, 7, 'p1')).toBe('own');
    expect(mole.hole).toBe(NO_HOLE);
  });

  it('reports the other seats colour as a penalty and still takes it down', () => {
    const moles = createMoles();
    const mole = raise(moles, 0, 7, 'p2');
    expect(hit(moles, 7, 'p1')).toBe('other');
    expect(mole.hole).toBe(NO_HOLE);
  });

  it('is a miss on an empty hole and changes nothing', () => {
    const moles = createMoles();
    raise(moles, 0, 7, 'p1');
    expect(hit(moles, 4, 'p1')).toBe('miss');
    expect(upCount(moles)).toBe(1);
  });

  it('is a miss on a hole that does not exist, free slots included', () => {
    const moles = createMoles();
    raise(moles, 0, 7, 'p1');
    expect(hit(moles, NO_HOLE, 'p1')).toBe('miss');
    expect(hit(moles, -9, 'p2')).toBe('miss');
    expect(hit(moles, HOLE_COUNT + 3, 'p1')).toBe('miss');
    expect(upCount(moles)).toBe(1);
  });

  it('only ever pays out once for one mole', () => {
    const moles = createMoles();
    raise(moles, 0, 2, 'p2');
    expect(hit(moles, 2, 'p2')).toBe('own');
    expect(hit(moles, 2, 'p1')).toBe('miss');
  });
});

describe('retireAll', () => {
  it('clears the board without disturbing the pool', () => {
    const moles = createMoles();
    raise(moles, 0, 1, 'p1');
    raise(moles, 3, 9, 'p2');
    retireAll(moles);
    expect(moles).toHaveLength(MOLE_POOL);
    expect(upCount(moles)).toBe(0);
  });
});

describe('botTarget', () => {
  it('sees nothing on an empty board', () => {
    const rng = new Rng(8);
    for (const difficulty of DIFFICULTIES) {
      const moles = createMoles();
      for (let i = 0; i < 50; i += 1) {
        expect(botTarget(moles, 'p1', difficulty, rng)).toBe(NO_HOLE);
      }
    }
  });

  it('never swings at a mole it has not had time to notice', () => {
    for (const difficulty of DIFFICULTIES) {
      const moles = createMoles();
      const mole = raise(moles, 0, 6, 'p1', 5);
      mole.upSeconds = BOT_PROFILES[difficulty].reactionSeconds - 0.001;
      const rng = new Rng(17);
      for (let i = 0; i < 200; i += 1) {
        expect(botTarget(moles, 'p1', difficulty, rng)).toBe(NO_HOLE);
      }
    }
  });

  it('never swings at the other seats mole', () => {
    const moles = createMoles();
    const mole = raise(moles, 0, 6, 'p2', 5);
    mole.upSeconds = 3;
    const rng = new Rng(23);
    for (let i = 0; i < 200; i += 1) {
      expect(botTarget(moles, 'p1', 'hard', rng)).toBe(NO_HOLE);
    }
  });

  it('goes for the mole that has been up longest, since that is the one about to sink', () => {
    const moles = createMoles();
    raise(moles, 0, 2, 'p1', 5).upSeconds = 0.5;
    raise(moles, 1, 9, 'p1', 5).upSeconds = 0.9;
    raise(moles, 2, 4, 'p1', 5).upSeconds = 0.7;

    const rng = new Rng(31);
    let onTarget = 0;
    for (let i = 0; i < 400; i += 1) {
      const hole = botTarget(moles, 'p1', 'hard', rng);
      expect(hole).toBeGreaterThanOrEqual(0);
      expect(hole).toBeLessThan(HOLE_COUNT);
      if (hole === 9) onTarget += 1;
    }
    expect(onTarget).toBeGreaterThan(320);
  });

  it('makes difficulty a matter of error and reaction, never of extra sight', () => {
    function strayRate(difficulty: BotDifficulty): number {
      const moles = createMoles();
      raise(moles, 0, 5, 'p1', 5).upSeconds = 2;
      const rng = new Rng(101);
      let stray = 0;
      for (let i = 0; i < 800; i += 1) {
        if (botTarget(moles, 'p1', difficulty, rng) !== 5) stray += 1;
      }
      return stray / 800;
    }
    expect(strayRate('easy')).toBeGreaterThan(strayRate('normal'));
    expect(strayRate('normal')).toBeGreaterThan(strayRate('hard'));
    expect(BOT_PROFILES.easy.reactionSeconds).toBeGreaterThan(BOT_PROFILES.hard.reactionSeconds);
    expect(BOT_PROFILES.easy.strikeSeconds).toBeGreaterThan(BOT_PROFILES.hard.strikeSeconds);
  });
});

describe('determinism', () => {
  function runRound(seed: number): number[] {
    const moles = createMoles();
    const rng = new Rng(seed);
    let p1 = 0;
    let p2 = 0;

    for (let i = 0; i < 6000; i += 1) {
      step(moles, STEP);

      const first = botTarget(moles, 'p1', 'normal', rng);
      if (first !== NO_HOLE) {
        const result = hit(moles, first, 'p1');
        if (result === 'own') p1 += 1;
        else if (result === 'other') p1 -= 1;
      }
      const second = botTarget(moles, 'p2', 'easy', rng);
      if (second !== NO_HOLE) {
        const result = hit(moles, second, 'p2');
        if (result === 'own') p2 += 1;
        else if (result === 'other') p2 -= 1;
      }

      spawn(moles, HOLE_COUNT, rng, STEP, spawnRateAt(i * STEP));
    }

    const snapshot = [p1, p2];
    for (const mole of moles) {
      snapshot.push(mole.hole, mole.seat === 'p1' ? 0 : 1, mole.upSeconds, mole.lifetime);
    }
    return snapshot;
  }

  it('replays a whole round identically from the same seed', () => {
    const first = runRound(2026);
    expect(first).toEqual(runRound(2026));
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('diverges on a different seed, so a round is not a fixed script', () => {
    expect(runRound(2026)).not.toEqual(runRound(4052));
  });
});
