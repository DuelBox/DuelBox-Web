import { describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { Wrestler } from './rules.js';
import {
  BOT_PROFILES,
  DRIVE_ACCELERATION,
  FRICTION,
  MAX_SPEED,
  MIN_RADIUS,
  SHRINK_PER_SECOND,
  START_RADIUS,
  WRESTLER_MASS,
  WRESTLER_RADIUS,
  botInput,
  collideWrestlers,
  createArena,
  createWrestler,
  isOut,
  shrinkArena,
  stepWrestler,
  traction,
} from './rules.js';

const STEP = 1 / 60;

/** Contact distance of a pair, i.e. the distance at which two wrestlers touch. */
const CONTACT = WRESTLER_RADIUS * 2;

function wrestlerAt(x: number, y: number, vx = 0, vy = 0): Wrestler {
  return { x, y, vx, vy, radius: WRESTLER_RADIUS, mass: WRESTLER_MASS };
}

function speed(w: Wrestler): number {
  return Math.sqrt(w.vx * w.vx + w.vy * w.vy);
}

function gap(a: Wrestler, b: Wrestler): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
}

describe('stepWrestler friction', () => {
  it('decays a coasting wrestler exponentially', () => {
    const arena = createArena();
    const w = wrestlerAt(arena.centreX, arena.centreY, 0, 200);
    stepWrestler(w, 0, 0, arena, 1);

    expect(w.vy).toBeCloseTo(200 * Math.exp(-FRICTION), 9);
    expect(w.y).toBeCloseTo(arena.centreY + (200 * (1 - Math.exp(-FRICTION))) / FRICTION, 9);
    expect(w.vx).toBe(0);
  });

  it('is frame-rate independent while coasting: two half steps equal one whole step', () => {
    const arena = createArena();
    const fine = wrestlerAt(arena.centreX, arena.centreY, 240, -160);
    stepWrestler(fine, 0, 0, arena, STEP);
    stepWrestler(fine, 0, 0, arena, STEP);

    const coarse = wrestlerAt(arena.centreX, arena.centreY, 240, -160);
    stepWrestler(coarse, 0, 0, arena, STEP * 2);

    expect(fine.x).toBeCloseTo(coarse.x, 9);
    expect(fine.y).toBeCloseTo(coarse.y, 9);
    expect(fine.vx).toBeCloseTo(coarse.vx, 9);
    expect(fine.vy).toBeCloseTo(coarse.vy, 9);
    expect(speed(fine)).toBeLessThan(Math.sqrt(240 * 240 + 160 * 160));
  });

  it('is frame-rate independent under drive too', () => {
    const arena = createArena();
    const fine = wrestlerAt(arena.centreX, arena.centreY, 180, -120);
    stepWrestler(fine, 1, 0, arena, STEP);
    stepWrestler(fine, 1, 0, arena, STEP);

    const coarse = wrestlerAt(arena.centreX, arena.centreY, 180, -120);
    stepWrestler(coarse, 1, 0, arena, STEP * 2);

    expect(fine.x).toBeCloseTo(coarse.x, 9);
    expect(fine.y).toBeCloseTo(coarse.y, 9);
    expect(fine.vx).toBeCloseTo(coarse.vx, 9);
    expect(fine.vy).toBeCloseTo(coarse.vy, 9);
  });

  it('agrees across a whole second however it is chopped up', () => {
    const arena = createArena();
    const fine = wrestlerAt(arena.centreX, arena.centreY, 200, 0);
    for (let i = 0; i < 240; i += 1) stepWrestler(fine, 0, 0, arena, 1 / 240);
    const coarse = wrestlerAt(arena.centreX, arena.centreY, 200, 0);
    for (let i = 0; i < 60; i += 1) stepWrestler(coarse, 0, 0, arena, 1 / 60);

    expect(fine.x).toBeCloseTo(coarse.x, 8);
    expect(fine.vx).toBeCloseTo(coarse.vx, 8);
  });
});

describe('stepWrestler drive', () => {
  it('accelerates from rest towards the input direction', () => {
    const arena = createArena();
    const w = wrestlerAt(arena.centreX, arena.centreY);
    stepWrestler(w, 0, -1, arena, STEP);

    expect(w.vy).toBeLessThan(0);
    expect(w.vx).toBe(0);
    expect(w.y).toBeLessThan(arena.centreY);
  });

  it('drives a diagonal no faster than a straight push', () => {
    const arena = createArena();
    const straight = wrestlerAt(arena.centreX, arena.centreY);
    const diagonal = wrestlerAt(arena.centreX, arena.centreY);
    for (let i = 0; i < 30; i += 1) {
      stepWrestler(straight, 1, 0, arena, STEP);
      stepWrestler(diagonal, 1, 1, arena, STEP);
    }

    expect(speed(diagonal)).toBeCloseTo(speed(straight), 6);
  });

  it('keeps a gently held direction gentle', () => {
    const arena = createArena();
    const gentle = wrestlerAt(arena.centreX, arena.centreY);
    const full = wrestlerAt(arena.centreX, arena.centreY);
    stepWrestler(gentle, 0.5, 0, arena, STEP);
    stepWrestler(full, 1, 0, arena, STEP);

    expect(gentle.vx).toBeCloseTo(full.vx / 2, 9);
  });

  it('never reaches the speed cap under its own power', () => {
    const arena = createArena();
    const w = wrestlerAt(arena.centreX, arena.centreY);
    for (let i = 0; i < 45; i += 1) stepWrestler(w, 0, 1, arena, STEP);

    expect(speed(w)).toBeLessThanOrEqual(DRIVE_ACCELERATION / FRICTION);
    expect(speed(w)).toBeLessThan(MAX_SPEED);
  });

  it('trims a shove faster than the cap before it can carry anyone through anyone', () => {
    const arena = createArena();
    const w = wrestlerAt(arena.centreX, arena.centreY, 90_000, -90_000);
    stepWrestler(w, 0, 0, arena, STEP);

    expect(speed(w)).toBeLessThanOrEqual(MAX_SPEED);
    const travelled = Math.sqrt(
      (w.x - arena.centreX) * (w.x - arena.centreX) + (w.y - arena.centreY) * (w.y - arena.centreY),
    );
    expect(travelled).toBeLessThan(CONTACT);
  });
});

describe('traction', () => {
  it('is full for a wrestler standing clear of the edge', () => {
    const arena = createArena();
    expect(traction(wrestlerAt(arena.centreX, arena.centreY), arena)).toBe(1);
  });

  it('is halved when the centre sits exactly on the boundary', () => {
    const arena = createArena();
    expect(traction(wrestlerAt(arena.centreX + arena.radius, arena.centreY), arena)).toBeCloseTo(
      0.5,
      9,
    );
  });

  it('is gone once the whole disc is off the clay', () => {
    const arena = createArena();
    const off = wrestlerAt(arena.centreX + arena.radius + WRESTLER_RADIUS * 2, arena.centreY);
    expect(traction(off, arena)).toBe(0);
  });

  it('costs a leaning wrestler drive it would have had in the middle', () => {
    const arena = createArena();
    const middle = wrestlerAt(arena.centreX, arena.centreY);
    const leaning = wrestlerAt(arena.centreX + arena.radius, arena.centreY);
    stepWrestler(middle, 1, 0, arena, STEP);
    stepWrestler(leaning, 1, 0, arena, STEP);

    expect(leaning.vx).toBeCloseTo(middle.vx / 2, 9);
  });
});

describe('collideWrestlers', () => {
  it('reports a miss without touching either wrestler', () => {
    const a = wrestlerAt(200, 400, 50, 0);
    const b = wrestlerAt(600, 400);

    expect(collideWrestlers(a, b)).toBe(false);
    expect(a.x).toBe(200);
    expect(a.vx).toBe(50);
    expect(b.x).toBe(600);
    expect(speed(b)).toBe(0);
  });

  it('separates an overlap so the pair cannot stick', () => {
    const a = wrestlerAt(360, 400);
    const b = wrestlerAt(440, 400);

    expect(collideWrestlers(a, b)).toBe(true);
    expect(gap(a, b)).toBeCloseTo(CONTACT, 9);
    // Shared by mass, and the masses are equal, so neither is teleported past the other.
    expect(a.x).toBeCloseTo(400 - CONTACT / 2, 9);
    expect(b.x).toBeCloseTo(400 + CONTACT / 2, 9);
  });

  it('conserves momentum through a head-on collision', () => {
    const a = wrestlerAt(360, 400, 300, 0);
    const b = wrestlerAt(440, 400, -100, 0);
    const before = a.mass * a.vx + b.mass * b.vx;

    expect(collideWrestlers(a, b)).toBe(true);
    expect(a.mass * a.vx + b.mass * b.vx).toBeCloseTo(before, 9);
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('swaps the normal velocity of two equal masses', () => {
    const a = wrestlerAt(400 - CONTACT, 400, 500, 0);
    const b = wrestlerAt(400, 400, 0, 0);

    collideWrestlers(a, b);

    expect(a.vx).toBeCloseTo(0, 9);
    expect(b.vx).toBeCloseTo(500, 9);
  });

  it('gives a faster wrestler a proportionally harder push', () => {
    function shove(charge: number): number {
      const a = wrestlerAt(400 - CONTACT, 400, charge, 0);
      const b = wrestlerAt(400, 400, 0, 0);
      collideWrestlers(a, b);
      return b.vx;
    }

    expect(shove(600)).toBeGreaterThan(shove(200));
    expect(shove(600)).toBeCloseTo(shove(200) * 3, 6);
  });

  it('leaves a pair that is already separating alone', () => {
    const a = wrestlerAt(400 - CONTACT, 400, -200, 0);
    const b = wrestlerAt(400, 400, 200, 0);

    expect(collideWrestlers(a, b)).toBe(true);
    expect(a.vx).toBe(-200);
    expect(b.vx).toBe(200);
  });

  it('pushes along the line of centres rather than along the charge', () => {
    // A charge straight along x that lands on a corner sends the opponent off at the
    // diagonal, which is what makes angle of attack worth anything.
    const a = wrestlerAt(400 - CONTACT * 0.6, 400 - CONTACT * 0.6, 500, 0);
    const b = wrestlerAt(400, 400, 0, 0);

    expect(collideWrestlers(a, b)).toBe(true);
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vy).toBeCloseTo(b.vx, 6);
    expect(a.vy).toBeLessThan(0);
    expect(gap(a, b)).toBeGreaterThanOrEqual(CONTACT - 1e-9);
  });
});

describe('shrinkArena', () => {
  it('closes the ring at its declared rate', () => {
    const arena = createArena();
    shrinkArena(arena, 1);
    expect(arena.radius).toBeCloseTo(START_RADIUS - SHRINK_PER_SECOND, 9);
  });

  it('never shrinks past the minimum however long it runs', () => {
    const arena = createArena();
    for (let i = 0; i < 6000; i += 1) {
      shrinkArena(arena, STEP);
      expect(arena.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
    }
    expect(arena.radius).toBe(MIN_RADIUS);
  });

  it('closes to a ring too narrow for two wrestlers to share', () => {
    // Separated wrestlers stand a full contact distance apart, so at least one centre is
    // further out than half of it. A ring narrower than that always puts somebody out,
    // which is why no bout can stall.
    expect(MIN_RADIUS).toBeLessThan(CONTACT / 2);
  });
});

describe('isOut', () => {
  it('keeps a wrestler in while its centre is on the clay', () => {
    const arena = createArena();
    expect(isOut(wrestlerAt(arena.centreX, arena.centreY), arena)).toBe(false);
  });

  it('lets a wrestler lean out over the edge', () => {
    const arena = createArena();
    const leaning = wrestlerAt(arena.centreX + arena.radius - 1, arena.centreY);
    expect(isOut(leaning, arena)).toBe(false);
  });

  it('does not put a wrestler out while its centre is exactly on the boundary', () => {
    const arena = createArena();
    expect(isOut(wrestlerAt(arena.centreX + arena.radius, arena.centreY), arena)).toBe(false);
    expect(isOut(wrestlerAt(arena.centreX, arena.centreY - arena.radius), arena)).toBe(false);
  });

  it('puts a wrestler out once its centre has crossed', () => {
    const arena = createArena();
    const over = wrestlerAt(arena.centreX + arena.radius + 0.001, arena.centreY);
    expect(isOut(over, arena)).toBe(true);
  });

  it('catches a wrestler that stood still while the ring closed past it', () => {
    const arena = createArena();
    const w = wrestlerAt(arena.centreX, arena.centreY + MIN_RADIUS + 20);
    for (let i = 0; i < 6000; i += 1) shrinkArena(arena, STEP);
    expect(isOut(w, arena)).toBe(true);
  });
});

describe('botInput', () => {
  const difficulties = ['easy', 'normal', 'hard'] as const;

  it('offers a difficulty ladder of delay and steering error alone', () => {
    expect(BOT_PROFILES.easy.reactionSeconds).toBeGreaterThan(BOT_PROFILES.normal.reactionSeconds);
    expect(BOT_PROFILES.normal.reactionSeconds).toBeGreaterThan(BOT_PROFILES.hard.reactionSeconds);
    expect(BOT_PROFILES.easy.steerError).toBeGreaterThan(BOT_PROFILES.normal.steerError);
    expect(BOT_PROFILES.normal.steerError).toBeGreaterThan(BOT_PROFILES.hard.steerError);
  });

  it('never asks for more than a player can hold, whatever the position', () => {
    const rng = new Rng(31_337);
    const arena = createArena();
    const out = vec2();
    for (const difficulty of difficulties) {
      for (let i = 0; i < 400; i += 1) {
        arena.radius = MIN_RADIUS + rng.float() * (START_RADIUS - MIN_RADIUS);
        const self = wrestlerAt(rng.float() * 800, rng.float() * 800);
        const other = wrestlerAt(
          rng.float() * 800,
          rng.float() * 800,
          (rng.float() * 2 - 1) * 600,
          (rng.float() * 2 - 1) * 600,
        );
        botInput(out, self, other, arena, difficulty, rng);
        const length = Math.sqrt(out.x * out.x + out.y * out.y);
        expect(Number.isFinite(length)).toBe(true);
        expect(length).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('steers at the opponent from the middle of the ring', () => {
    const rng = new Rng(7);
    const arena = createArena();
    const out = vec2();
    const self = wrestlerAt(arena.centreX, arena.centreY);
    const other = wrestlerAt(arena.centreX + 120, arena.centreY);

    botInput(out, self, other, arena, 'hard', rng);

    expect(out.x).toBeGreaterThan(0.9);
    expect(Math.abs(out.y)).toBeLessThan(0.2);
  });

  it('backs off towards the middle when it is the one on the brink', () => {
    const rng = new Rng(7);
    const arena = createArena();
    const out = vec2();
    // Chasing the opponent would take the bot further out, and the opponent is not far
    // enough gone to be worth the trade.
    const self = wrestlerAt(arena.centreX + arena.radius * 0.9, arena.centreY);
    const other = wrestlerAt(arena.centreX, arena.centreY + arena.radius * 0.95);

    botInput(out, self, other, arena, 'hard', rng);

    expect(out.x).toBeLessThan(-0.8);
  });

  it('charges an opponent that is about to fall out', () => {
    const rng = new Rng(7);
    const arena = createArena();
    const out = vec2();
    const self = wrestlerAt(arena.centreX + arena.radius * 0.6, arena.centreY);
    const other = wrestlerAt(arena.centreX + arena.radius * 0.92, arena.centreY);

    botInput(out, self, other, arena, 'hard', rng);

    expect(out.x).toBeGreaterThan(0.9);
  });

  it('acts on where the opponent was, not on where it is', () => {
    const arena = createArena();
    const atRest = vec2();
    const rushing = vec2();
    const self = wrestlerAt(arena.centreX - 50, arena.centreY + 100);
    const parked = wrestlerAt(arena.centreX, arena.centreY - 40);
    const charging = wrestlerAt(arena.centreX, arena.centreY - 40, 0, -600);

    // Both calls draw from a generator at the same position, so the only difference
    // between the two answers is the reaction delay.
    botInput(atRest, self, parked, arena, 'hard', new Rng(7));
    botInput(rushing, self, charging, arena, 'hard', new Rng(7));

    // The stale reading leaves the charging opponent lower down the ring than it really
    // is, so the bot steers less far up after it.
    expect(rushing.y).toBeGreaterThan(atRest.y);
  });
});

describe('determinism', () => {
  function runBout(seed: number): number[] {
    const rng = new Rng(seed);
    const arena = createArena();
    const aim = vec2();
    const a = createWrestler(400, 550);
    const b = createWrestler(400, 250);

    for (let step = 0; step < 1500; step += 1) {
      botInput(aim, a, b, arena, 'normal', rng);
      const aimAX = aim.x;
      const aimAY = aim.y;
      botInput(aim, b, a, arena, 'easy', rng);
      stepWrestler(a, aimAX, aimAY, arena, STEP);
      stepWrestler(b, aim.x, aim.y, arena, STEP);
      collideWrestlers(a, b);
      shrinkArena(arena, STEP);

      if (isOut(a, arena) || isOut(b, arena)) {
        a.x = 400;
        a.y = 550;
        a.vx = 0;
        a.vy = 0;
        b.x = 400;
        b.y = 250;
        b.vx = 0;
        b.vy = 0;
        arena.radius = START_RADIUS;
      }
    }

    return [a.x, a.y, a.vx, a.vy, b.x, b.y, b.vx, b.vy, arena.radius];
  }

  it('replays a full bout identically from the same seed', () => {
    const first = runBout(2026);
    expect(first).toEqual(runBout(2026));
    for (const value of first) expect(Number.isFinite(value)).toBe(true);
  });

  it('diverges on a different seed, so the bout is not a fixed script', () => {
    expect(runBout(2026)).not.toEqual(runBout(4052));
  });
});
