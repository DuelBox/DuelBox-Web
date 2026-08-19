import { describe, it, expect } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { Body, GoalResult } from './rules.js';
import {
  BOT_PROFILES,
  MALLET_RADIUS,
  MAX_PUCK_SPEED,
  PUCK_RADIUS,
  STEP_SECONDS,
  TABLE,
  botTarget,
  collidePuckMallet,
  stepMallet,
  stepPuck,
} from './rules.js';

const STEP = STEP_SECONDS;

function puck(x: number, y: number, vx: number, vy: number): Body {
  return { x, y, vx, vy, radius: PUCK_RADIUS };
}

function mallet(x: number, y: number, vx = 0, vy = 0): Body {
  return { x, y, vx, vy, radius: MALLET_RADIUS };
}

function speed(body: Body): number {
  return Math.hypot(body.vx, body.vy);
}

describe('stepPuck friction', () => {
  it('decays speed exponentially', () => {
    const p = puck(300, 500, 0, 10);
    stepPuck(p, TABLE, 1);
    expect(p.vy).toBeCloseTo(10 * Math.exp(-TABLE.friction), 9);
    expect(p.y).toBeCloseTo(500 + (10 * (1 - Math.exp(-TABLE.friction))) / TABLE.friction, 9);
  });

  it('is frame-rate independent: two half steps equal one whole step', () => {
    const fine = puck(300, 500, 400, -260);
    stepPuck(fine, TABLE, STEP);
    stepPuck(fine, TABLE, STEP);

    const coarse = puck(300, 500, 400, -260);
    stepPuck(coarse, TABLE, STEP * 2);

    expect(fine.x).toBeCloseTo(coarse.x, 9);
    expect(fine.y).toBeCloseTo(coarse.y, 9);
    expect(fine.vx).toBeCloseTo(coarse.vx, 9);
    expect(fine.vy).toBeCloseTo(coarse.vy, 9);
    expect(speed(fine)).toBeLessThan(Math.hypot(400, 260));
  });

  it('agrees across a whole second however it is chopped up', () => {
    const fine = puck(60, 500, 0, 40);
    for (let i = 0; i < 240; i += 1) stepPuck(fine, TABLE, 1 / 240);
    const coarse = puck(60, 500, 0, 40);
    for (let i = 0; i < 60; i += 1) stepPuck(coarse, TABLE, 1 / 60);

    expect(fine.y).toBeCloseTo(coarse.y, 8);
    expect(fine.vy).toBeCloseTo(coarse.vy, 8);
  });
});

describe('stepPuck walls', () => {
  it('reverses x on a side wall and loses energy to restitution', () => {
    const p = puck(PUCK_RADIUS + 1, 500, -600, 0);
    stepPuck(p, TABLE, STEP);

    expect(p.x).toBeCloseTo(PUCK_RADIUS, 9);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(600 * TABLE.wallRestitution);
    expect(p.vy).toBe(0);
  });

  it('reverses x on the far side wall', () => {
    const p = puck(TABLE.width - PUCK_RADIUS - 1, 500, 600, 0);
    stepPuck(p, TABLE, STEP);

    expect(p.x).toBeCloseTo(TABLE.width - PUCK_RADIUS, 9);
    expect(p.vx).toBeLessThan(0);
    expect(Math.abs(p.vx)).toBeLessThan(600);
  });

  it('bounces off the end wall beside the goal mouth', () => {
    const p = puck(120, 30, 0, -900);
    const result = stepPuck(p, TABLE, STEP);

    expect(result).toBe('none');
    expect(p.y).toBeCloseTo(PUCK_RADIUS, 9);
    expect(p.vy).toBeGreaterThan(0);
    expect(p.vy).toBeLessThan(900);
  });

  it('bounces a puck that only clips a goal post', () => {
    // Centre inside the mouth, rim over the post: the whole disc has to fit.
    const p = puck(210, 30, 0, -900);
    expect(stepPuck(p, TABLE, STEP)).toBe('none');
    expect(p.y).toBeCloseTo(PUCK_RADIUS, 9);
  });
});

describe('stepPuck goals', () => {
  function driveUntilDecided(p: Body): GoalResult {
    for (let i = 0; i < 200; i += 1) {
      const result = stepPuck(p, TABLE, STEP);
      if (result !== 'none') return result;
    }
    return 'none';
  }

  it('gives p1 the goal when the puck enters the top mouth', () => {
    expect(driveUntilDecided(puck(300, 60, 0, -900))).toBe('p1');
  });

  it('gives p2 the goal when the puck enters the bottom mouth', () => {
    expect(driveUntilDecided(puck(300, TABLE.height - 60, 0, 900))).toBe('p2');
  });

  it('lets the puck travel into the mouth before it counts', () => {
    const p = puck(300, 20, 0, -600);
    expect(stepPuck(p, TABLE, STEP)).toBe('none');
    expect(p.y).toBeLessThan(20);
    expect(p.y).toBeGreaterThan(0);
  });
});

describe('stepPuck speed clamp', () => {
  it('holds the clamp however hard the puck is struck', () => {
    const p = puck(300, 500, 90_000, -90_000);
    stepPuck(p, TABLE, STEP);
    expect(speed(p)).toBeLessThanOrEqual(MAX_PUCK_SPEED);
  });

  it('keeps one step shorter than the puck-mallet contact distance', () => {
    const p = puck(300, 500, 0, -50_000);
    stepPuck(p, TABLE, STEP);
    expect(Math.abs(p.y - 500)).toBeLessThan(PUCK_RADIUS + MALLET_RADIUS);
  });
});

describe('stepMallet', () => {
  it('never lets p1 cross the centre line, however the target is aimed', () => {
    const m = mallet(300, 900);
    for (let i = 0; i < 600; i += 1) {
      stepMallet(m, 300, -5000, TABLE, 'p1', STEP);
      expect(m.y).toBeGreaterThanOrEqual(TABLE.height / 2 + MALLET_RADIUS - 1e-9);
    }
  });

  it('never lets p2 cross the centre line, however the target is aimed', () => {
    const m = mallet(300, 100);
    for (let i = 0; i < 600; i += 1) {
      stepMallet(m, 300, 5000, TABLE, 'p2', STEP);
      expect(m.y).toBeLessThanOrEqual(TABLE.height / 2 - MALLET_RADIUS + 1e-9);
    }
  });

  it('keeps the whole disc inside the side walls', () => {
    const m = mallet(300, 800);
    for (let i = 0; i < 200; i += 1) stepMallet(m, -9000, 9000, TABLE, 'p1', STEP);
    expect(m.x).toBeCloseTo(MALLET_RADIUS, 9);
    for (let i = 0; i < 200; i += 1) stepMallet(m, 9000, 9000, TABLE, 'p1', STEP);
    expect(m.x).toBeCloseTo(TABLE.width - MALLET_RADIUS, 9);
  });

  it('derives velocity from the movement it actually made', () => {
    const m = mallet(300, 800);
    stepMallet(m, 300, 790, TABLE, 'p1', STEP);
    expect(m.y).toBeCloseTo(790, 9);
    expect(m.vy).toBeCloseTo(-10 / STEP, 6);
  });

  it('leaves no velocity behind when the target is unreachable', () => {
    const m = mallet(300, TABLE.height / 2 + MALLET_RADIUS);
    stepMallet(m, 300, 0, TABLE, 'p1', STEP);
    expect(m.vy).toBe(0);
  });
});

describe('collidePuckMallet', () => {
  it('reports a miss without touching the puck', () => {
    const p = puck(300, 500, 0, 0);
    const m = mallet(300, 700);
    expect(collidePuckMallet(p, m)).toBe(false);
    expect(p.x).toBe(300);
    expect(p.y).toBe(500);
    expect(speed(p)).toBe(0);
  });

  it('separates an overlap so the pair is no longer touching', () => {
    const p = puck(300, 500, 0, 0);
    const m = mallet(300, 520);
    expect(collidePuckMallet(p, m)).toBe(true);
    expect(Math.hypot(p.x - m.x, p.y - m.y)).toBeGreaterThanOrEqual(
      PUCK_RADIUS + MALLET_RADIUS - 1e-9,
    );
  });

  it('gives a moving mallet more punch than a stationary one', () => {
    const contact = PUCK_RADIUS + MALLET_RADIUS - 4;

    const still = puck(300, 600, 0, 0);
    collidePuckMallet(still, mallet(300, 600 + contact));

    const swung = puck(300, 600, 0, 0);
    collidePuckMallet(swung, mallet(300, 600 + contact, 0, -800));

    expect(speed(swung)).toBeGreaterThan(speed(still) * 4);
    expect(swung.vy).toBeLessThan(0);
    expect(still.vy).toBeLessThan(0);
  });

  it('reflects an incoming puck back off a stationary mallet', () => {
    const p = puck(300, 600, 0, 500);
    collidePuckMallet(p, mallet(300, 600 + PUCK_RADIUS + MALLET_RADIUS - 2));
    expect(p.vy).toBeLessThan(0);
    expect(Math.abs(p.vy)).toBeLessThanOrEqual(500);
  });
});

describe('botTarget', () => {
  const difficulties = ['easy', 'normal', 'hard'] as const;

  it('never offers a target outside the seat half or beyond its top speed', () => {
    const rng = new Rng(31_337);
    const out = vec2();
    for (const difficulty of difficulties) {
      const maxOffer = BOT_PROFILES[difficulty].topSpeed * STEP_SECONDS;
      for (let i = 0; i < 400; i += 1) {
        const p = puck(
          rng.float() * TABLE.width,
          rng.float() * TABLE.height,
          (rng.float() * 2 - 1) * 900,
          (rng.float() * 2 - 1) * 900,
        );
        const bottom = mallet(MALLET_RADIUS + rng.float() * (TABLE.width - 2 * MALLET_RADIUS), 800);
        botTarget(out, p, bottom, TABLE, 'p1', difficulty, rng);
        expect(out.y).toBeGreaterThanOrEqual(TABLE.height / 2 + MALLET_RADIUS - 1e-9);
        expect(out.y).toBeLessThanOrEqual(TABLE.height - MALLET_RADIUS + 1e-9);
        expect(out.x).toBeGreaterThanOrEqual(MALLET_RADIUS - 1e-9);
        expect(out.x).toBeLessThanOrEqual(TABLE.width - MALLET_RADIUS + 1e-9);
        expect(Math.hypot(out.x - bottom.x, out.y - bottom.y)).toBeLessThanOrEqual(maxOffer + 1e-9);

        const top = mallet(MALLET_RADIUS + rng.float() * (TABLE.width - 2 * MALLET_RADIUS), 200);
        botTarget(out, p, top, TABLE, 'p2', difficulty, rng);
        expect(out.y).toBeLessThanOrEqual(TABLE.height / 2 - MALLET_RADIUS + 1e-9);
        expect(out.y).toBeGreaterThanOrEqual(MALLET_RADIUS - 1e-9);
      }
    }
  });

  it('tracks an incoming puck sideways rather than staying put', () => {
    const rng = new Rng(11);
    const out = vec2();
    const m = mallet(300, 860);
    // A puck aimed at the left post: the bot should shade left to meet it.
    const p = puck(500, 300, -260, 620);
    for (let i = 0; i < 60; i += 1) {
      botTarget(out, p, m, TABLE, 'p1', 'hard', rng);
      stepMallet(m, out.x, out.y, TABLE, 'p1', STEP);
    }
    expect(m.x).toBeLessThan(300);
  });
});

describe('determinism', () => {
  function runRally(seed: number): number[] {
    const rng = new Rng(seed);
    const aim = vec2();
    const p = puck(300, 500, 210, -430);
    const m1 = mallet(300, 800);
    const m2 = mallet(300, 200);

    for (let step = 0; step < 3000; step += 1) {
      botTarget(aim, p, m1, TABLE, 'p1', 'normal', rng);
      stepMallet(m1, aim.x, aim.y, TABLE, 'p1', STEP);
      botTarget(aim, p, m2, TABLE, 'p2', 'easy', rng);
      stepMallet(m2, aim.x, aim.y, TABLE, 'p2', STEP);

      const scored = stepPuck(p, TABLE, STEP);
      if (scored !== 'none') {
        p.x = TABLE.width / 2;
        p.y = TABLE.height / 2;
        p.vx = (rng.float() * 2 - 1) * 90;
        p.vy = scored === 'p1' ? -320 : 320;
        continue;
      }
      collidePuckMallet(p, m1);
      collidePuckMallet(p, m2);
    }

    return [p.x, p.y, p.vx, p.vy, m1.x, m1.y, m2.x, m2.y];
  }

  it('replays a full rally identically from the same seed', () => {
    const first = runRally(2026);
    const second = runRally(2026);
    expect(first).toEqual(second);
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('diverges on a different seed, so the rally is not a fixed script', () => {
    expect(runRally(2026)).not.toEqual(runRally(4052));
  });
});
