import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ARM_X,
  ARM_Y,
  BAR,
  BLAME_SECONDS,
  BLAME_SPEED,
  BOT_DRAWS_PER_LOOK,
  BOT_PROFILES,
  CAR_RADIUS,
  CRUISE_SPEED,
  DRIVE_ACCELERATION,
  FLOOD_SECONDS,
  GRIP_FORWARD,
  GRIP_LATERAL,
  LANE_MIN,
  LORRY_HALF_LENGTH,
  LORRY_HALF_WIDTH,
  LORRY_RESTITUTION,
  LORRY_SPEED,
  MAX_SPEED,
  MIN_ARM,
  MIN_BAR,
  ROUND_SECONDS,
  SETTLE_STEPS,
  SPAWN_BASE,
  SPAWN_FIRST,
  SPAWN_JITTER,
  SPLASH_TARGET,
  START_ALONG,
  START_SPREAD,
  TRAFFIC_DRAWS_PER_SPAWN,
  TRAFFIC_MIN_BAR,
  TRAFFIC_SLOTS,
  TURN_RATE,
  ageBlame,
  beginBout,
  botAim,
  carOf,
  clearMatch,
  clearTraffic,
  collideCars,
  collideLorry,
  createArena,
  createBotState,
  createCar,
  createDirection,
  createLorry,
  createMatch,
  floodedArena,
  judge,
  lorryHalfX,
  lorryHalfY,
  lorryVX,
  lorryVY,
  lorryX,
  lorryY,
  marginOf,
  onRoad,
  otherOf,
  placeCars,
  resetBotState,
  resetMatch,
  scoreOf,
  spawnTraffic,
  stepCar,
  stepMatch,
  stepTraffic,
  towardSafety,
  turnToward,
  winnerOf,
  wrapAngle,
} from './rules.js';
import type { BotDifficulty, Direction, Match } from './rules.js';

const STEP = 1 / 60;

/** A generator that counts what is drawn from it, so draw budgets can be asserted. */
class CountingRng extends Rng {
  calls = 0;

  override float(): number {
    this.calls += 1;
    return super.float();
  }
}

function driveless(): Direction {
  return createDirection();
}

/** Run a bot-against-bot match to a decision, capped so a stall fails rather than hangs. */
function playBots(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  maxSteps = 60 * 200,
): { match: Match; steps: number } {
  const match = createMatch();
  const rng = new Rng(seed);
  resetMatch(match, rng);
  const p1Brain = createBotState();
  const p2Brain = createBotState();
  const want1 = createDirection();
  const want2 = createDirection();
  let steps = 0;
  for (; steps < maxSteps; steps += 1) {
    if (match.winner !== null) break;
    botAim(want1, match, 'p1', p1Tier, p1Brain, STEP, rng);
    botAim(want2, match, 'p2', p2Tier, p2Brain, STEP, rng);
    stepMatch(match, STEP, want1.x, want1.y, want2.x, want2.y, rng);
  }
  return { match, steps };
}

describe('the island', () => {
  it('starts as two carriageways crossing at the origin', () => {
    const arena = createArena();
    expect(arena.armX).toBe(ARM_X);
    expect(arena.armY).toBe(ARM_Y);
    expect(arena.bar).toBe(BAR);
  });

  it('fits inside the logical box with room for the kerb', () => {
    expect(ARM_X).toBeLessThan(300);
    expect(ARM_Y).toBeLessThan(500);
  });

  it('is wide enough for a car to be shouldered across', () => {
    // Four car widths, which is what leaves room for the manoeuvre the game is about.
    expect(BAR * 2).toBeGreaterThanOrEqual(CAR_RADIUS * 2 * 3);
  });

  it('shrinks to its minimum at full flood and no further', () => {
    const arena = createArena();
    floodedArena(arena, 1);
    expect(arena.armX).toBeCloseTo(MIN_ARM, 10);
    expect(arena.armY).toBeCloseTo(MIN_ARM, 10);
    expect(arena.bar).toBeCloseTo(MIN_BAR, 10);
  });

  it('is back at rest at flood zero', () => {
    const arena = createArena();
    floodedArena(arena, 1);
    floodedArena(arena, 0);
    expect(arena.armX).toBe(ARM_X);
    expect(arena.armY).toBe(ARM_Y);
    expect(arena.bar).toBe(BAR);
  });

  it('clamps a flood outside zero to one', () => {
    const low = createArena();
    floodedArena(low, -4);
    expect(low.bar).toBe(BAR);
    const high = createArena();
    floodedArena(high, 9);
    expect(high.bar).toBeCloseTo(MIN_BAR, 10);
  });

  it('only ever shrinks as the flood rises', () => {
    const arena = createArena();
    let lastBar = Infinity;
    let lastArm = Infinity;
    for (let i = 0; i <= 20; i += 1) {
      floodedArena(arena, i / 20);
      expect(arena.bar).toBeLessThanOrEqual(lastBar);
      expect(arena.armY).toBeLessThanOrEqual(lastArm);
      lastBar = arena.bar;
      lastArm = arena.armY;
    }
  });

  it('is smaller than a car once the flood is full', () => {
    // The termination guarantee in one line: every point of the road is inside a car.
    expect(Math.hypot(MIN_ARM, MIN_BAR)).toBeLessThan(CAR_RADIUS);
  });
});

describe('the road', () => {
  const arena = createArena();

  it('holds the junction', () => {
    expect(onRoad(arena, 0, 0)).toBe(true);
  });

  it('runs the length of both arms', () => {
    expect(onRoad(arena, ARM_X, 0)).toBe(true);
    expect(onRoad(arena, -ARM_X, 0)).toBe(true);
    expect(onRoad(arena, 0, ARM_Y)).toBe(true);
    expect(onRoad(arena, 0, -ARM_Y)).toBe(true);
  });

  it('stops at the end of an arm', () => {
    expect(onRoad(arena, ARM_X + 0.001, 0)).toBe(false);
    expect(onRoad(arena, 0, ARM_Y + 0.001)).toBe(false);
  });

  it('counts a point exactly on the kerb as on the road', () => {
    expect(onRoad(arena, 200, BAR)).toBe(true);
    expect(onRoad(arena, 200, -BAR)).toBe(true);
    expect(onRoad(arena, BAR, 400)).toBe(true);
  });

  it('drops a point a hair past the kerb into the water', () => {
    expect(onRoad(arena, 200, BAR + 0.001)).toBe(false);
    expect(onRoad(arena, BAR + 0.001, 400)).toBe(false);
  });

  it('leaves the four corners as water', () => {
    expect(onRoad(arena, 200, 300)).toBe(false);
    expect(onRoad(arena, -200, 300)).toBe(false);
    expect(onRoad(arena, 200, -300)).toBe(false);
    expect(onRoad(arena, -200, -300)).toBe(false);
  });

  it('is its own half turn, point for point', () => {
    // The one property the seats rest on, checked over a lattice rather than at corners.
    for (let x = -320; x <= 320; x += 17) {
      for (let y = -520; y <= 520; y += 23) {
        expect(onRoad(arena, x, y), `(${String(x)}, ${String(y)})`).toBe(onRoad(arena, -x, -y));
      }
    }
  });

  it('is its own half turn at every flood too', () => {
    const flooded = createArena();
    for (let step = 0; step <= 10; step += 1) {
      floodedArena(flooded, step / 10);
      for (let x = -320; x <= 320; x += 41) {
        for (let y = -520; y <= 520; y += 53) {
          expect(onRoad(flooded, x, y)).toBe(onRoad(flooded, -x, -y));
        }
      }
    }
  });
});

describe('the margin to the water', () => {
  const arena = createArena();

  it('is positive on the road and negative off it', () => {
    for (let x = -340; x <= 340; x += 19) {
      for (let y = -540; y <= 540; y += 29) {
        const margin = marginOf(arena, x, y);
        expect(margin >= 0, `(${String(x)}, ${String(y)}) margin ${String(margin)}`).toBe(
          onRoad(arena, x, y),
        );
      }
    }
  });

  it('is the same for a point and its half turn', () => {
    for (let x = -300; x <= 300; x += 31) {
      for (let y = -500; y <= 500; y += 37) {
        expect(marginOf(arena, x, y)).toBeCloseTo(marginOf(arena, -x, -y), 12);
      }
    }
  });

  it('is never more than half the width of a carriageway', () => {
    // A road is as safe as it is wide, so the middle of the junction and the middle of a
    // lane are worth the same: what the margin measures is the nearest kerb, not the
    // nearest anything.
    expect(marginOf(arena, 0, 0)).toBeCloseTo(BAR, 10);
    expect(marginOf(arena, 0, 300)).toBeCloseTo(BAR, 10);
    expect(marginOf(arena, 0, 0)).toBeGreaterThan(marginOf(arena, 60, 300));
    expect(marginOf(arena, 0, 0)).toBeGreaterThan(marginOf(arena, 0, ARM_Y - 20));
  });

  it('falls to zero at the kerb', () => {
    expect(marginOf(arena, 200, BAR)).toBeCloseTo(0, 10);
    expect(marginOf(arena, BAR, 400)).toBeCloseTo(0, 10);
  });

  it('shrinks with the flood', () => {
    const flooded = createArena();
    floodedArena(flooded, 0.5);
    expect(marginOf(flooded, 0, 0)).toBeLessThan(marginOf(arena, 0, 0));
  });
});

describe('the way back to safety', () => {
  const arena = createArena();

  it('is always a unit vector', () => {
    const out = createDirection();
    for (let x = -300; x <= 300; x += 43) {
      for (let y = -500; y <= 500; y += 47) {
        towardSafety(out, arena, x, y);
        expect(Math.hypot(out.x, out.y)).toBeCloseTo(1, 12);
      }
    }
  });

  it('never costs a car margin, from anywhere on the road', () => {
    const out = createDirection();
    for (let x = -240; x <= 240; x += 31) {
      for (let y = -440; y <= 440; y += 41) {
        if (!onRoad(arena, x, y)) continue;
        const before = marginOf(arena, x, y);
        towardSafety(out, arena, x, y);
        const after = marginOf(arena, x + out.x * 4, y + out.y * 4);
        expect(after, `from (${String(x)}, ${String(y)})`).toBeGreaterThanOrEqual(before - 1e-9);
      }
    }
  });

  it('walks a car all the way to the safest road there is', () => {
    // Following it step by step has to end in the middle of a carriageway, wherever it
    // started — which is what the bot is doing when it gives up on a charge.
    const out = createDirection();
    for (let x = -240; x <= 240; x += 53) {
      for (let y = -440; y <= 440; y += 71) {
        if (!onRoad(arena, x, y)) continue;
        let atX = x;
        let atY = y;
        for (let step = 0; step < 400; step += 1) {
          towardSafety(out, arena, atX, atY);
          atX += out.x * 2;
          atY += out.y * 2;
        }
        expect(marginOf(arena, atX, atY), `from (${String(x)}, ${String(y)})`).toBeGreaterThan(
          BAR - 4,
        );
      }
    }
  });

  it('crosses the road when the kerb is the tighter constraint', () => {
    const out = createDirection();
    towardSafety(out, arena, 200, BAR - 6);
    expect(out.x).toBe(0);
    expect(out.y).toBe(-1);
    towardSafety(out, arena, 200, -BAR + 6);
    expect(out.y).toBe(1);
  });

  it('heads back down the arm when the end is the tighter constraint', () => {
    const out = createDirection();
    towardSafety(out, arena, ARM_X - 4, 0);
    expect(out.x).toBe(-1);
    expect(out.y).toBe(0);
    towardSafety(out, arena, 0, -ARM_Y + 4);
    expect(out.y).toBe(1);
  });

  it('still answers from the dead centre of the junction, where nothing is tighter', () => {
    // Every constraint ties here, so the answer is arbitrary — but it must be *an* answer:
    // a zero vector would reach `turnToward` as "hold this line" and a bot standing on the
    // junction would stop steering altogether. East along the side road is the tie break.
    const out = createDirection();
    towardSafety(out, arena, 0, 0);
    expect(out.x).toBe(1);
    expect(out.y).toBe(0);
    expect(Math.hypot(out.x, out.y)).toBe(1);
  });

  it('answers the half turn with the half-turned answer', () => {
    const here = createDirection();
    const there = createDirection();
    for (let x = -260; x <= 260; x += 37) {
      for (let y = -460; y <= 460; y += 43) {
        towardSafety(here, arena, x, y);
        towardSafety(there, arena, -x, -y);
        expect(there.x).toBeCloseTo(-here.x, 12);
        expect(there.y).toBeCloseTo(-here.y, 12);
      }
    }
  });
});

describe('angles', () => {
  it('fold into a half turn either side of zero', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 12);
    expect(wrapAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 12);
  });

  it('always land inside the half turn', () => {
    for (let i = -40; i <= 40; i += 1) {
      const folded = wrapAngle(i * 0.7);
      expect(folded).toBeGreaterThan(-Math.PI - 1e-9);
      expect(folded).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe('turning', () => {
  it('never turns further than it is allowed to', () => {
    for (let i = 0; i < 32; i += 1) {
      const from = wrapAngle(i * 0.37);
      const wantX = Math.cos(i * 1.13);
      const wantY = Math.sin(i * 1.13);
      const to = turnToward(from, wantX, wantY, 0.1);
      expect(Math.abs(wrapAngle(to - from))).toBeLessThanOrEqual(0.1 + 1e-12);
    }
  });

  it('settles exactly on the direction once it is within reach', () => {
    expect(turnToward(0, 0, 1, 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(turnToward(0, 0, 1, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('stops short of the direction when it is not', () => {
    expect(turnToward(0, 0, 1, 1)).toBeCloseTo(1, 12);
  });

  it('takes the short way round', () => {
    // Facing east, asked for something just south of west: the short way is clockwise.
    const to = turnToward(0, -1, 0.2, 0.4);
    expect(to).toBeCloseTo(0.4, 12);
  });

  it('holds its line for a direction of no length', () => {
    expect(turnToward(1.2, 0, 0, 0.5)).toBe(1.2);
  });

  it('holds its line for a direction that is not a number', () => {
    expect(turnToward(1.2, Number.NaN, 0, 0.5)).toBe(1.2);
    expect(turnToward(1.2, 0, Number.NaN, 0.5)).toBe(1.2);
    expect(turnToward(1.2, Infinity, 1, 0.5)).toBe(1.2);
  });

  it('resolves a dead-astern direction the same way every time', () => {
    const first = turnToward(0, -1, 0, 0.05);
    const second = turnToward(0, -1, 0, 0.05);
    expect(first).toBe(second);
  });

  it('reaches a quarter turn in the time the turn rate says it should', () => {
    let heading = 0;
    const steps = Math.ceil(Math.PI / 2 / (TURN_RATE * STEP));
    for (let i = 0; i < steps; i += 1) heading = turnToward(heading, 0, 1, TURN_RATE * STEP);
    expect(heading).toBeCloseTo(Math.PI / 2, 6);
    expect((steps * STEP).toFixed(2)).toBe('0.47');
  });
});

describe('a car', () => {
  it('drives forward with nobody asking it to do anything', () => {
    const car = createCar();
    stepCar(car, 0, 0, STEP);
    expect(car.x).toBeGreaterThan(0);
    expect(car.y).toBe(0);
  });

  it('never stops, on any step', () => {
    const car = createCar();
    let last = car.x;
    for (let i = 0; i < 600; i += 1) {
      stepCar(car, 0, 0, STEP);
      expect(car.x).toBeGreaterThan(last);
      last = car.x;
    }
  });

  it('winds up to the cruising speed and settles there', () => {
    const car = createCar();
    for (let i = 0; i < 600; i += 1) stepCar(car, 0, 0, STEP);
    expect(Math.hypot(car.vx, car.vy)).toBeCloseTo(CRUISE_SPEED, 6);
  });

  it('cruises at the drive divided by the grip, which is what the constant says', () => {
    expect(CRUISE_SPEED).toBe(DRIVE_ACCELERATION / GRIP_FORWARD);
  });

  it('covers the same ground in a second whether that second is sixty steps or a hundred and twenty', () => {
    const slow = createCar();
    const fast = createCar();
    for (let i = 0; i < 60 * 3; i += 1) stepCar(slow, 1, 0, 1 / 60);
    for (let i = 0; i < 120 * 3; i += 1) stepCar(fast, 1, 0, 1 / 120);
    expect(fast.x).toBeCloseTo(slow.x, 10);
    expect(fast.vx).toBeCloseTo(slow.vx, 10);
  });

  it('lands a slide in the same place at either step size', () => {
    const slow = createCar();
    slow.vy = 300;
    const fast = createCar();
    fast.vy = 300;
    for (let i = 0; i < 60 * 2; i += 1) stepCar(slow, 1, 0, 1 / 60);
    for (let i = 0; i < 120 * 2; i += 1) stepCar(fast, 1, 0, 1 / 120);
    expect(fast.x).toBeCloseTo(slow.x, 10);
    expect(fast.y).toBeCloseTo(slow.y, 10);
    expect(fast.vy).toBeCloseTo(slow.vy, 10);
  });

  it('turns through the same angle at either step size', () => {
    let slow = 0;
    let fast = 0;
    for (let i = 0; i < 60; i += 1) slow = turnToward(slow, 0, 1, TURN_RATE / 60);
    for (let i = 0; i < 120; i += 1) fast = turnToward(fast, 0, 1, TURN_RATE / 120);
    expect(fast).toBeCloseTo(slow, 12);
  });

  it('lands a standing U-turn within a hundredth of a unit at either step size', () => {
    // The one residual: while the nose is coming round, the frame the translation is
    // integrated in moves between steps, exactly as it does for any rotating body. Taking
    // the heading at the middle of the step rather than at its start makes the scheme
    // second order, which is what puts this number where it is — 2.58 units before, 0.0097
    // after. Measured rather than asserted away.
    const slow = createCar();
    const fast = createCar();
    for (let i = 0; i < 60 * 2; i += 1) stepCar(slow, -1, 0, 1 / 60);
    for (let i = 0; i < 120 * 2; i += 1) stepCar(fast, -1, 0, 1 / 120);
    const drift = Math.hypot(fast.x - slow.x, fast.y - slow.y);
    expect(drift).toBeLessThan(0.05);
    expect(wrapAngle(fast.heading - slow.heading)).toBeCloseTo(0, 9);
  });

  it('lands ten seconds of weaving within a hundredth of a unit at either step size', () => {
    const slow = createCar();
    const fast = createCar();
    for (let i = 0; i < 600; i += 1) stepCar(slow, Math.cos(i * 0.05), Math.sin(i * 0.05), 1 / 60);
    for (let i = 0; i < 1200; i += 1) {
      const held = Math.floor(i / 2) * 0.05;
      stepCar(fast, Math.cos(held), Math.sin(held), 1 / 120);
    }
    expect(Math.hypot(fast.x - slow.x, fast.y - slow.y)).toBeLessThan(0.05);
  });

  it('slides a shove out over the distance the lateral grip says it should', () => {
    const car = createCar();
    car.vy = 300;
    const before = car.y;
    // Held straight, so nothing is being driven sideways: the whole of the sideways
    // motion is the slide decaying away.
    for (let i = 0; i < 60 * 8; i += 1) stepCar(car, 1, 0, STEP);
    expect(car.y - before).toBeCloseTo(300 / GRIP_LATERAL, 3);
  });

  it('loses a shove faster than it loses its drive, which is what makes it a car', () => {
    expect(GRIP_LATERAL).toBeLessThan(GRIP_FORWARD);
  });

  it('trims a velocity above the cap before it uses it', () => {
    const car = createCar();
    car.vx = MAX_SPEED * 4;
    stepCar(car, 1, 0, STEP);
    expect(car.x).toBeLessThan(MAX_SPEED * STEP + 1);
    expect(Math.hypot(car.vx, car.vy)).toBeLessThanOrEqual(MAX_SPEED + 1);
  });

  it('cannot outrun the cap on its own', () => {
    expect(CRUISE_SPEED).toBeLessThan(MAX_SPEED);
    // One step at the cap must move a car less than the distance at which it would have hit
    // something, or a shove passes straight through the other car between two tests.
    expect(MAX_SPEED * STEP).toBeLessThan(CAR_RADIUS * 2);
  });

  it('drives the half-turned car the half-turned way', () => {
    const here = createCar();
    const there = createCar();
    there.heading = wrapAngle(here.heading + Math.PI);
    here.vx = 40;
    here.vy = -70;
    there.vx = -40;
    there.vy = 70;
    for (let i = 0; i < 90; i += 1) {
      stepCar(here, 0.6, -0.8, STEP);
      stepCar(there, -0.6, 0.8, STEP);
    }
    expect(there.x).toBeCloseTo(-here.x, 8);
    expect(there.y).toBeCloseTo(-here.y, 8);
    expect(there.vx).toBeCloseTo(-here.vx, 8);
    expect(there.vy).toBeCloseTo(-here.vy, 8);
    expect(Math.abs(wrapAngle(there.heading - here.heading))).toBeCloseTo(Math.PI, 8);
  });

  it('turns towards a thumb and a key at exactly the same rate', () => {
    const thumb = createCar();
    const key = createCar();
    // A key gives a unit vector; a thumb gives the same unit vector from a longer drag.
    for (let i = 0; i < 30; i += 1) {
      stepCar(thumb, 0, 1, STEP);
      stepCar(key, 0, 1, STEP);
    }
    expect(thumb.heading).toBe(key.heading);
  });
});

describe('blame', () => {
  it('lapses back to nobody after its window', () => {
    const car = createCar();
    car.blame = 'rival';
    car.blameFor = BLAME_SECONDS;
    for (let i = 0; i < Math.ceil(BLAME_SECONDS / STEP) + 1; i += 1) ageBlame(car, STEP);
    expect(car.blame).toBe('solo');
    expect(car.blameFor).toBe(0);
  });

  it('stands for the whole window', () => {
    const car = createCar();
    car.blame = 'traffic';
    car.blameFor = BLAME_SECONDS;
    for (let i = 0; i < Math.floor(BLAME_SECONDS / STEP) - 2; i += 1) ageBlame(car, STEP);
    expect(car.blame).toBe('traffic');
  });

  it('does nothing at all to a car nobody has touched', () => {
    const car = createCar();
    ageBlame(car, STEP);
    expect(car.blame).toBe('solo');
    expect(car.blameFor).toBe(0);
  });
});

describe('two cars meeting', () => {
  it('do not touch when they are apart', () => {
    const a = createCar();
    const b = createCar();
    b.x = CAR_RADIUS * 2 + 1;
    expect(collideCars(a, b)).toBe(false);
    expect(a.x).toBe(0);
  });

  it('are pushed apart to exactly a diameter', () => {
    const a = createCar();
    const b = createCar();
    b.x = 10;
    collideCars(a, b);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(CAR_RADIUS * 2, 9);
  });

  it('share the correction evenly, so neither seat is moved further than the other', () => {
    const a = createCar();
    const b = createCar();
    b.x = 20;
    collideCars(a, b);
    expect(a.x).toBeCloseTo(-20, 9);
    expect(b.x).toBeCloseTo(40, 9);
  });

  it('swap the part of their speed along the line between them', () => {
    const a = createCar();
    const b = createCar();
    a.x = -CAR_RADIUS;
    b.x = CAR_RADIUS;
    a.vx = 300;
    collideCars(a, b);
    expect(a.vx).toBeCloseTo(0, 9);
    expect(b.vx).toBeCloseTo(300, 9);
  });

  it('leave the sideways part of their speed alone', () => {
    const a = createCar();
    const b = createCar();
    a.x = -CAR_RADIUS;
    b.x = CAR_RADIUS;
    a.vx = 300;
    a.vy = 120;
    collideCars(a, b);
    expect(a.vy).toBeCloseTo(120, 9);
    expect(b.vy).toBeCloseTo(0, 9);
  });

  it('are not pulled back together when they are already parting', () => {
    const a = createCar();
    const b = createCar();
    a.x = -CAR_RADIUS + 2;
    b.x = CAR_RADIUS - 2;
    a.vx = -100;
    b.vx = 100;
    collideCars(a, b);
    expect(a.vx).toBe(-100);
    expect(b.vx).toBe(100);
  });

  it('blame each other for a proper hit', () => {
    const a = createCar();
    const b = createCar();
    a.x = -CAR_RADIUS;
    b.x = CAR_RADIUS;
    a.vx = BLAME_SPEED + 40;
    expect(collideCars(a, b)).toBe(true);
    expect(a.blame).toBe('rival');
    expect(b.blame).toBe('rival');
    expect(a.blameFor).toBe(BLAME_SECONDS);
  });

  it('blame nobody for a brush', () => {
    const a = createCar();
    const b = createCar();
    a.x = -CAR_RADIUS;
    b.x = CAR_RADIUS;
    a.vx = BLAME_SPEED - 10;
    expect(collideCars(a, b)).toBe(false);
    expect(a.blame).toBe('solo');
    expect(b.blame).toBe('solo');
  });

  it('conserve their total speed along the line, whatever the angle', () => {
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const a = createCar();
      const b = createCar();
      a.x = -Math.cos(angle) * CAR_RADIUS;
      a.y = -Math.sin(angle) * CAR_RADIUS;
      b.x = Math.cos(angle) * CAR_RADIUS;
      b.y = Math.sin(angle) * CAR_RADIUS;
      a.vx = 200;
      b.vy = -150;
      const before = a.vx + b.vx;
      const beforeY = a.vy + b.vy;
      collideCars(a, b);
      expect(a.vx + b.vx).toBeCloseTo(before, 8);
      expect(a.vy + b.vy).toBeCloseTo(beforeY, 8);
    }
  });
});

describe('a car meeting a lorry', () => {
  function parked(axis: 0 | 1, along: number, lateral: number, speed: number) {
    const lorry = createLorry();
    lorry.active = true;
    lorry.axis = axis;
    lorry.along = along;
    lorry.lateral = lateral;
    lorry.speed = speed;
    return lorry;
  }

  it('is never touched by a lorry that is not on the road', () => {
    const car = createCar();
    const lorry = parked(1, 0, 0, 0);
    lorry.active = false;
    expect(collideLorry(car, lorry)).toBe(false);
  });

  it('is pushed clear of one it is inside', () => {
    const car = createCar();
    const lorry = parked(1, 0, 0, 0);
    car.x = 4;
    collideLorry(car, lorry);
    expect(Math.abs(car.x)).toBeGreaterThanOrEqual(LORRY_HALF_WIDTH + CAR_RADIUS - 1e-6);
  });

  it('takes the lorry momentum when the lorry runs into it', () => {
    const car = createCar();
    car.x = 0;
    car.y = -(LORRY_HALF_LENGTH + CAR_RADIUS) + 4;
    const lorry = parked(1, 0, 0, -LORRY_SPEED);
    collideLorry(car, lorry);
    expect(car.vy).toBeLessThan(-LORRY_SPEED * 0.5);
  });

  it('is not hit at all when it is running alongside at the same speed', () => {
    const car = createCar();
    car.x = 0;
    car.y = -(LORRY_HALF_LENGTH + CAR_RADIUS) + 4;
    car.vy = -LORRY_SPEED;
    const lorry = parked(1, 0, 0, -LORRY_SPEED);
    expect(collideLorry(car, lorry)).toBe(false);
    expect(car.vy).toBe(-LORRY_SPEED);
  });

  it('gives back only a fraction of what it took', () => {
    const car = createCar();
    car.x = 0;
    car.y = -(LORRY_HALF_LENGTH + CAR_RADIUS) + 2;
    car.vy = 400;
    const lorry = parked(1, 0, 0, 0);
    collideLorry(car, lorry);
    expect(car.vy).toBeCloseTo(-400 * LORRY_RESTITUTION, 6);
  });

  it('never moves the lorry', () => {
    const car = createCar();
    car.vx = 800;
    car.x = -(LORRY_HALF_WIDTH + CAR_RADIUS) + 5;
    const lorry = parked(1, 0, 0, -LORRY_SPEED);
    const before = { along: lorry.along, lateral: lorry.lateral, speed: lorry.speed };
    collideLorry(car, lorry);
    expect(lorry.along).toBe(before.along);
    expect(lorry.lateral).toBe(before.lateral);
    expect(lorry.speed).toBe(before.speed);
  });

  it('blames the traffic for a proper hit and nobody for a brush', () => {
    const hard = createCar();
    hard.y = -(LORRY_HALF_LENGTH + CAR_RADIUS) + 2;
    hard.vy = BLAME_SPEED + 60;
    expect(collideLorry(hard, parked(1, 0, 0, 0))).toBe(true);
    expect(hard.blame).toBe('traffic');

    const soft = createCar();
    soft.y = -(LORRY_HALF_LENGTH + CAR_RADIUS) + 2;
    soft.vy = BLAME_SPEED - 20;
    expect(collideLorry(soft, parked(1, 0, 0, 0))).toBe(false);
    expect(soft.blame).toBe('solo');
  });

  it('reads a lorry box from its road coordinates', () => {
    const down = parked(1, 40, -60, -LORRY_SPEED);
    expect(lorryX(down)).toBe(-60);
    expect(lorryY(down)).toBe(40);
    expect(lorryVX(down)).toBe(0);
    expect(lorryVY(down)).toBe(-LORRY_SPEED);
    expect(lorryHalfX(down)).toBe(LORRY_HALF_WIDTH);
    expect(lorryHalfY(down)).toBe(LORRY_HALF_LENGTH);

    const across = parked(0, 40, -60, LORRY_SPEED);
    expect(lorryX(across)).toBe(40);
    expect(lorryY(across)).toBe(-60);
    expect(lorryVX(across)).toBe(LORRY_SPEED);
    expect(lorryVY(across)).toBe(0);
    expect(lorryHalfX(across)).toBe(LORRY_HALF_LENGTH);
    expect(lorryHalfY(across)).toBe(LORRY_HALF_WIDTH);
  });
});

describe('the traffic', () => {
  it('spends the same draws on a tick whatever comes of it', () => {
    const match = createMatch();
    const rng = new CountingRng(11);
    resetMatch(match, rng);
    rng.calls = 0;
    expect(spawnTraffic(match, rng)).toBe(true);
    expect(rng.calls).toBe(TRAFFIC_DRAWS_PER_SPAWN);

    // Fill the pool, then tick again: still no draws saved.
    for (let i = 0; i < 4; i += 1) spawnTraffic(match, rng);
    rng.calls = 0;
    expect(spawnTraffic(match, rng)).toBe(false);
    expect(rng.calls).toBe(TRAFFIC_DRAWS_PER_SPAWN);
  });

  it('spends the same draws when the road is too narrow to take any', () => {
    const match = createMatch();
    const rng = new CountingRng(12);
    resetMatch(match, rng);
    floodedArena(match.arena, 1);
    rng.calls = 0;
    expect(spawnTraffic(match, rng)).toBe(false);
    expect(rng.calls).toBe(TRAFFIC_DRAWS_PER_SPAWN);
  });

  it('arrives as a pair that is its own half turn', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const match = createMatch();
      const rng = new Rng(seed);
      resetMatch(match, rng);
      clearTraffic(match.traffic);
      expect(spawnTraffic(match, rng)).toBe(true);
      const live = match.traffic.filter((lorry) => lorry.active);
      expect(live.length).toBe(2);
      const [a, b] = live;
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) continue;
      expect(lorryX(b)).toBeCloseTo(-lorryX(a), 12);
      expect(lorryY(b)).toBeCloseTo(-lorryY(a), 12);
      expect(lorryVX(b)).toBeCloseTo(-lorryVX(a), 12);
      expect(lorryVY(b)).toBeCloseTo(-lorryVY(a), 12);
      expect(b.axis).toBe(a.axis);
    }
  });

  it('puts the two of a pair in lanes that do not overlap', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const match = createMatch();
      const rng = new Rng(seed * 13);
      resetMatch(match, rng);
      clearTraffic(match.traffic);
      spawnTraffic(match, rng);
      const live = match.traffic.filter((lorry) => lorry.active);
      const [a] = live;
      if (a === undefined) continue;
      expect(Math.abs(a.lateral)).toBeGreaterThanOrEqual(LANE_MIN);
      // The twin sits at −lateral, so the gap between the two is twice this.
      expect(Math.abs(a.lateral) * 2).toBeGreaterThanOrEqual(LORRY_HALF_WIDTH * 2);
    }
  });

  it('never puts a lorry half over the water at the moment it joins', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const match = createMatch();
      const rng = new Rng(seed * 29);
      resetMatch(match, rng);
      // Part-way through the flood, where the lanes have to have narrowed with the road.
      match.flood = 0.4;
      floodedArena(match.arena, match.flood);
      clearTraffic(match.traffic);
      spawnTraffic(match, rng);
      for (const lorry of match.traffic) {
        if (!lorry.active) continue;
        expect(Math.abs(lorry.lateral) + LORRY_HALF_WIDTH).toBeLessThanOrEqual(match.arena.bar);
      }
    }
  });

  it('enters at the end of the road it is joining and drives inwards', () => {
    const match = createMatch();
    const rng = new Rng(7);
    resetMatch(match, rng);
    clearTraffic(match.traffic);
    spawnTraffic(match, rng);
    for (const lorry of match.traffic) {
      if (!lorry.active) continue;
      const arm = lorry.axis === 1 ? match.arena.armY : match.arena.armX;
      expect(Math.abs(lorry.along)).toBeCloseTo(arm + LORRY_HALF_LENGTH, 9);
      // Signs opposed: it is heading towards the junction rather than away from it.
      expect(Math.sign(lorry.along)).toBe(-Math.sign(lorry.speed));
    }
  });

  it('retires a lorry once it is off the far end', () => {
    const match = createMatch();
    const rng = new Rng(3);
    resetMatch(match, rng);
    clearTraffic(match.traffic);
    spawnTraffic(match, rng);
    match.spawnIn = 1e6;
    let steps = 0;
    for (; steps < 60 * 30; steps += 1) {
      stepTraffic(match, STEP, rng);
      if (!match.traffic.some((lorry) => lorry.active)) break;
    }
    expect(match.traffic.some((lorry) => lorry.active)).toBe(false);
    // Crossing the main road at LORRY_SPEED takes about four seconds, never thirty.
    expect(steps * STEP).toBeLessThan(10);
  });

  it('retires a lorry the flood has taken the lane out from under', () => {
    const match = createMatch();
    const rng = new Rng(5);
    resetMatch(match, rng);
    clearTraffic(match.traffic);
    spawnTraffic(match, rng);
    match.spawnIn = 1e6;
    floodedArena(match.arena, 1);
    stepTraffic(match, STEP, rng);
    expect(match.traffic.some((lorry) => lorry.active)).toBe(false);
  });

  it('stops joining the road once the flood has narrowed it', () => {
    const match = createMatch();
    const rng = new Rng(9);
    resetMatch(match, rng);
    clearTraffic(match.traffic);
    // Just below the threshold, so there is no room for two lanes any more.
    const tight = (BAR - TRAFFIC_MIN_BAR + 1) / (BAR - MIN_BAR);
    floodedArena(match.arena, tight);
    expect(match.arena.bar).toBeLessThan(TRAFFIC_MIN_BAR);
    expect(spawnTraffic(match, rng)).toBe(false);
  });

  it('holds the board as its own half turn for a whole bot match', () => {
    // The strongest statement of seat fairness this game can make: at no instant does
    // either seat face traffic the other is not facing from the other end.
    const match = createMatch();
    const rng = new Rng(202608);
    resetMatch(match, rng);
    const brain1 = createBotState();
    const brain2 = createBotState();
    const want1 = createDirection();
    const want2 = createDirection();
    for (let step = 0; step < 60 * 60; step += 1) {
      if (match.winner !== null) break;
      botAim(want1, match, 'p1', 'normal', brain1, STEP, rng);
      botAim(want2, match, 'p2', 'normal', brain2, STEP, rng);
      stepMatch(match, STEP, want1.x, want1.y, want2.x, want2.y, rng);
      for (const lorry of match.traffic) {
        if (!lorry.active) continue;
        const twin = match.traffic.find(
          (other) =>
            other !== lorry &&
            other.active &&
            Math.abs(lorryX(other) + lorryX(lorry)) < 1e-9 &&
            Math.abs(lorryY(other) + lorryY(lorry)) < 1e-9,
        );
        expect(twin, `step ${String(step)} had a lorry with no twin`).toBeDefined();
      }
    }
  });

  it('keeps a pool it never grows', () => {
    const match = createMatch();
    expect(match.traffic.length).toBe(TRAFFIC_SLOTS);
    const rng = new Rng(4);
    resetMatch(match, rng);
    for (let i = 0; i < 400; i += 1) stepTraffic(match, STEP, rng);
    expect(match.traffic.length).toBe(TRAFFIC_SLOTS);
  });

  it('waits between spawns for a time inside the band the constants name', () => {
    const match = createMatch();
    const rng = new Rng(6);
    resetMatch(match, rng);
    for (let i = 0; i < 30; i += 1) {
      spawnTraffic(match, rng);
      expect(match.spawnIn).toBeGreaterThanOrEqual(SPAWN_BASE);
      expect(match.spawnIn).toBeLessThanOrEqual(SPAWN_BASE + SPAWN_JITTER);
    }
  });
});

describe('the marks', () => {
  it('places the two cars as each other half turned', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const match = createMatch();
      placeCars(match, new Rng(seed));
      expect(match.p2.x).toBe(-match.p1.x);
      expect(match.p2.y).toBe(-match.p1.y);
      expect(Math.abs(wrapAngle(match.p1.heading - match.p2.heading))).toBeCloseTo(Math.PI, 12);
    }
  });

  it('spends exactly one draw doing it', () => {
    const match = createMatch();
    const rng = new CountingRng(2);
    placeCars(match, rng);
    expect(rng.calls).toBe(1);
  });

  it('keeps the spread inside the road', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const match = createMatch();
      placeCars(match, new Rng(seed * 7));
      expect(Math.abs(match.p1.x)).toBeLessThanOrEqual(START_SPREAD);
      expect(onRoad(match.arena, match.p1.x, match.p1.y)).toBe(true);
      expect(onRoad(match.arena, match.p2.x, match.p2.y)).toBe(true);
      expect(marginOf(match.arena, match.p1.x, match.p1.y)).toBeGreaterThan(CAR_RADIUS);
    }
  });

  it('starts both cars pointing at the junction', () => {
    const match = createMatch();
    placeCars(match, new Rng(1));
    expect(match.p1.y).toBe(START_ALONG);
    expect(Math.sin(match.p1.heading)).toBeCloseTo(-1, 12);
    expect(Math.sin(match.p2.heading)).toBeCloseTo(1, 12);
  });

  it('starts both cars still', () => {
    const match = createMatch();
    placeCars(match, new Rng(1));
    expect(match.p1.vx).toBe(0);
    expect(match.p1.vy).toBe(0);
    expect(match.p2.vx).toBe(0);
    expect(match.p2.vy).toBe(0);
  });

  it('empties the roads and lets the water out at the start of a bout', () => {
    const match = createMatch();
    const rng = new Rng(8);
    resetMatch(match, rng);
    match.flood = 0.8;
    spawnTraffic(match, rng);
    beginBout(match, rng);
    expect(match.flood).toBe(0);
    expect(match.arena.bar).toBe(BAR);
    expect(match.traffic.some((lorry) => lorry.active)).toBe(false);
    expect(match.spawnIn).toBe(SPAWN_FIRST);
    expect(match.phase).toBe('driving');
  });
});

describe('a fresh match', () => {
  it('starts level, undecided and dry', () => {
    const match = createMatch();
    expect(match.p1Score).toBe(0);
    expect(match.p2Score).toBe(0);
    expect(match.winner).toBeNull();
    expect(match.phase).toBe('driving');
    expect(match.flood).toBe(0);
    expect(match.elapsed).toBe(0);
    expect(winnerOf(match)).toBeNull();
  });

  it('is put back to nothing without spending a draw', () => {
    const match = createMatch();
    const rng = new CountingRng(3);
    resetMatch(match, rng);
    for (let i = 0; i < 200; i += 1) stepMatch(match, STEP, 1, 0, 0, 1, rng);
    const before = rng.calls;
    clearMatch(match);
    expect(rng.calls).toBe(before);
    expect(match.elapsed).toBe(0);
    expect(match.p1Score).toBe(0);
    expect(match.p2Score).toBe(0);
    expect(match.bouts).toBe(0);
    expect(match.winner).toBeNull();
    expect(match.traffic.some((lorry) => lorry.active)).toBe(false);
  });

  it('names the seats and their scores the way the rest of the game does', () => {
    const match = createMatch();
    match.p1Score = 2;
    expect(carOf(match, 'p1')).toBe(match.p1);
    expect(carOf(match, 'p2')).toBe(match.p2);
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
    expect(scoreOf(match, 'p1')).toBe(2);
    expect(scoreOf(match, 'p2')).toBe(0);
  });
});

describe('a splash', () => {
  function driveOff(match: Match, seat: SeatId): void {
    const car = carOf(match, seat);
    car.x = ARM_X + 400;
    car.y = ARM_Y + 400;
  }

  it('scores for the other seat', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    driveOff(match, 'p1');
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.p2Score).toBe(1);
    expect(match.p1Score).toBe(0);
    expect(match.p1.inWater).toBe(true);
    expect(match.p1.splashes).toBe(1);
  });

  it('scores for both seats when both go in on the same step', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    driveOff(match, 'p1');
    driveOff(match, 'p2');
    match.p2.x = -match.p2.x;
    match.p2.y = -match.p2.y;
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.p1Score).toBe(1);
    expect(match.p2Score).toBe(1);
  });

  it('holds the board for the settle and then starts a fresh bout', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    driveOff(match, 'p1');
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.phase).toBe('settling');
    const where = match.p1.x;
    for (let i = 0; i < SETTLE_STEPS - 1; i += 1) {
      stepMatch(match, STEP, 1, 0, 1, 0, rng);
      expect(match.phase).toBe('settling');
      expect(match.p1.x).toBe(where);
    }
    stepMatch(match, STEP, 1, 0, 1, 0, rng);
    expect(match.phase).toBe('driving');
    expect(match.p1.inWater).toBe(false);
    expect(match.p1.y).toBe(START_ALONG);
  });

  it('sinks the car that went in and leaves the other one alone', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    driveOff(match, 'p1');
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    for (let i = 0; i < SETTLE_STEPS - 2; i += 1) stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.p1.sink).toBeGreaterThan(0.9);
    expect(match.p2.sink).toBe(0);
  });

  it('lets the water back out across the settle', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    for (let i = 0; i < 240; i += 1) stepMatch(match, STEP, 0, 0, 0, 0, rng);
    driveOff(match, 'p1');
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    const wet = match.flood;
    expect(wet).toBeGreaterThan(0);
    let last = wet;
    for (let i = 0; i < SETTLE_STEPS - 1; i += 1) {
      stepMatch(match, STEP, 0, 0, 0, 0, rng);
      expect(match.flood).toBeLessThanOrEqual(last);
      last = match.flood;
    }
    expect(match.flood).toBeLessThan(wet * 0.02);
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.flood).toBe(0);
    expect(match.phase).toBe('driving');
  });

  it('counts a bout', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    driveOff(match, 'p1');
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.bouts).toBe(1);
  });
});

describe('winning', () => {
  function scoreTo(match: Match, p1: number, p2: number): void {
    match.p1Score = p1;
    match.p2Score = p2;
  }

  it('is the third car in the water', () => {
    const match = createMatch();
    scoreTo(match, SPLASH_TARGET, 1);
    expect(judge(match)).toBe('p1');
    scoreTo(match, 1, SPLASH_TARGET);
    expect(judge(match)).toBe('p2');
  });

  it('is not the second', () => {
    const match = createMatch();
    scoreTo(match, SPLASH_TARGET - 1, SPLASH_TARGET - 1);
    expect(judge(match)).toBeNull();
  });

  it('is a draw when both reach it on the same step', () => {
    const match = createMatch();
    scoreTo(match, SPLASH_TARGET, SPLASH_TARGET);
    expect(judge(match)).toBe('draw');
  });

  it('ends the match the step the target is reached', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    scoreTo(match, SPLASH_TARGET - 1, 0);
    match.p2.x = ARM_X + 400;
    match.p2.y = ARM_Y + 400;
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.phase).toBe('over');
    expect(match.winner).toBe('p1');
  });

  it('leaves the losing car where it fell', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    scoreTo(match, SPLASH_TARGET - 1, 0);
    match.p2.x = ARM_X + 400;
    match.p2.y = ARM_Y + 400;
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.p2.x).toBe(ARM_X + 400);
  });

  it('does nothing at all once the match is over', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    match.phase = 'over';
    match.winner = 'p1';
    const before = match.p1.x;
    const elapsed = match.elapsed;
    stepMatch(match, STEP, 1, 0, 1, 0, rng);
    expect(match.p1.x).toBe(before);
    expect(match.elapsed).toBe(elapsed);
  });

  it('is settled on score once the clock is out', () => {
    const match = createMatch();
    match.elapsed = ROUND_SECONDS;
    scoreTo(match, 2, 1);
    expect(judge(match)).toBe('p1');
    scoreTo(match, 0, 1);
    expect(judge(match)).toBe('p2');
  });

  it('is a draw when the clock finds the two level', () => {
    const match = createMatch();
    match.elapsed = ROUND_SECONDS;
    scoreTo(match, 1, 1);
    expect(judge(match)).toBe('draw');
    scoreTo(match, 0, 0);
    expect(judge(match)).toBe('draw');
  });

  it('calls the match when the clock runs out mid-bout', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    match.elapsed = ROUND_SECONDS - STEP / 2;
    match.p1Score = 1;
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.phase).toBe('over');
    expect(match.winner).toBe('p1');
  });

  it('calls the match when the clock runs out during a settle', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    match.p1.x = ARM_X + 400;
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.phase).toBe('settling');
    match.elapsed = ROUND_SECONDS - STEP / 2;
    stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(match.phase).toBe('over');
    expect(match.winner).toBe('p2');
  });
});

describe('the flood', () => {
  it('puts somebody in the water on the very next step, wherever the two cars are', () => {
    // The termination guarantee, exercised rather than argued. Every placement here has
    // both cars sitting comfortably on the junction of a *full-size* road; the flood alone
    // is what ends it.
    for (let i = 0; i < 40; i += 1) {
      const match = createMatch();
      const rng = new Rng(100 + i);
      resetMatch(match, rng);
      match.flood = 1;
      floodedArena(match.arena, 1);
      const angle = (i / 40) * Math.PI * 2;
      match.p1.x = Math.cos(angle) * (i % 17);
      match.p1.y = Math.sin(angle) * (i % 13);
      match.p2.x = -match.p1.x;
      match.p2.y = -match.p1.y;
      const report = stepMatch(match, STEP, 0, 0, 0, 0, rng);
      expect(
        report.p1Splashed || report.p2Splashed,
        `placement ${String(i)} survived a full flood`,
      ).toBe(true);
    }
  });

  it('reaches full in exactly the seconds it says it does', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    const steps = Math.ceil(FLOOD_SECONDS / STEP);
    for (let i = 0; i < steps; i += 1) {
      if (match.phase !== 'driving') break;
      stepMatch(match, STEP, 0, 0, 0, 0, rng);
    }
    // Either the bout ended sooner — which is the usual case — or the flood is full.
    expect(match.phase !== 'driving' || match.flood === 1).toBe(true);
  });

  it('ends a bout in which neither car is ever steered', () => {
    const match = createMatch();
    const rng = new Rng(77);
    resetMatch(match, rng);
    let steps = 0;
    const cap = Math.ceil((FLOOD_SECONDS + 1) / STEP);
    for (; steps < cap; steps += 1) {
      const report = stepMatch(match, STEP, 0, 0, 0, 0, rng);
      if (report.boutOver) break;
    }
    expect(steps).toBeLessThan(cap);
  });

  it('cannot let any bout outlive it, over many seeds', () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const match = createMatch();
      const rng = new Rng(seed * 101);
      resetMatch(match, rng);
      let steps = 0;
      const cap = Math.ceil((FLOOD_SECONDS + 1) / STEP);
      for (; steps < cap; steps += 1) {
        // Both cars driven straight at each other's start, which is the least likely
        // pairing to end anything by itself.
        const report = stepMatch(match, STEP, 0, -1, 0, 1, rng);
        if (report.boutOver) break;
      }
      expect(steps, `seed ${String(seed)}`).toBeLessThan(cap);
    }
  });
});

describe('the match always ends', () => {
  it('inside the worst case the constants multiply out to', () => {
    // Five bouts is the most first-to-three can take: every bout awards at least one
    // point, so 2–2 and then one more. Five floods and four settles is the arithmetic.
    const worst = SPLASH_TARGET * 2 - 1;
    const bound = worst * FLOOD_SECONDS + (worst - 1) * SETTLE_STEPS * STEP;
    expect(bound).toBeCloseTo(104.8, 6);
    expect(bound).toBeLessThan(ROUND_SECONDS);
    // And the guard suite allows ten minutes of simulated play.
    expect(ROUND_SECONDS).toBeLessThan(600);
  });

  it('for two bots of every pairing', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const p1 of tiers) {
      for (const p2 of tiers) {
        const { match, steps } = playBots(4242, p1, p2);
        expect(match.winner, `${p1} v ${p2}`).not.toBeNull();
        expect(steps * STEP).toBeLessThan(ROUND_SECONDS);
      }
    }
  });

  it('with nobody touching the controls', () => {
    const match = createMatch();
    const rng = new Rng(19);
    resetMatch(match, rng);
    let steps = 0;
    const cap = Math.ceil((ROUND_SECONDS + 2) / STEP);
    for (; steps < cap; steps += 1) {
      stepMatch(match, STEP, 0, 0, 0, 0, rng);
      if (match.winner !== null) break;
    }
    expect(match.winner).not.toBeNull();
  });

  it('with both seats holding the same direction for ever', () => {
    const match = createMatch();
    const rng = new Rng(23);
    resetMatch(match, rng);
    let steps = 0;
    const cap = Math.ceil((ROUND_SECONDS + 2) / STEP);
    for (; steps < cap; steps += 1) {
      stepMatch(match, STEP, 1, 0, 1, 0, rng);
      if (match.winner !== null) break;
    }
    expect(match.winner).not.toBeNull();
  });
});

describe('determinism', () => {
  function trace(seed: number): string {
    const match = createMatch();
    const rng = new Rng(seed);
    resetMatch(match, rng);
    const rows: string[] = [];
    for (let i = 0; i < 900; i += 1) {
      const swing = Math.sin(i * 0.037);
      stepMatch(match, STEP, swing, 1 - Math.abs(swing), -swing, -1, rng);
      rows.push(
        `${match.p1.x.toFixed(9)}:${match.p1.y.toFixed(9)}:${match.p2.x.toFixed(9)}:` +
          `${match.p2.y.toFixed(9)}:${String(match.p1Score)}:${String(match.p2Score)}`,
      );
    }
    return rows.join('|');
  }

  it('plays the identical match twice from one seed', () => {
    expect(trace(31337)).toBe(trace(31337));
  });

  it('plays a different match from a different seed', () => {
    expect(trace(31337)).not.toBe(trace(31338));
  });

  it('gives two bots on one seed the identical match twice', () => {
    const first = playBots(555, 'normal', 'hard');
    const second = playBots(555, 'normal', 'hard');
    expect(second.steps).toBe(first.steps);
    expect(second.match.winner).toBe(first.match.winner);
    expect(second.match.p1.x).toBe(first.match.p1.x);
    expect(second.match.p2.y).toBe(first.match.p2.y);
  });

  it('reads a whole match out of the generator and the inputs alone', () => {
    // Nothing here is a clock: the same state and the same delta must produce the same
    // step whatever order two matches are run in.
    const a = createMatch();
    const b = createMatch();
    const rngA = new Rng(88);
    const rngB = new Rng(88);
    resetMatch(a, rngA);
    for (let i = 0; i < 300; i += 1) stepMatch(a, STEP, 0.3, -0.9, -0.3, 0.9, rngA);
    resetMatch(b, rngB);
    for (let i = 0; i < 300; i += 1) stepMatch(b, STEP, 0.3, -0.9, -0.3, 0.9, rngB);
    expect(b.p1.x).toBe(a.p1.x);
    expect(b.p1.heading).toBe(a.p1.heading);
    expect(b.elapsed).toBeCloseTo(a.elapsed, 12);
  });
});

describe('seat symmetry', () => {
  it('gives the mirrored duel the mirrored result', () => {
    // The board is its own half turn, so a match in which the two seats swap places and
    // swap their steering must be the first match seen upside down. Compared with a
    // tolerance rather than exactly, because cos(h + pi) is not bit-for-bit -cos(h).
    for (let seed = 1; seed <= 6; seed += 1) {
      const a = createMatch();
      const b = createMatch();
      const rngA = new Rng(seed * 613);
      const rngB = new Rng(seed * 613);
      resetMatch(a, rngA);
      resetMatch(b, rngB);
      for (let i = 0; i < 300; i += 1) {
        const x1 = Math.cos(i * 0.041);
        const y1 = Math.sin(i * 0.041);
        const x2 = Math.cos(i * 0.017 + 2);
        const y2 = Math.sin(i * 0.017 + 2);
        stepMatch(a, STEP, x1, y1, x2, y2, rngA);
        stepMatch(b, STEP, -x2, -y2, -x1, -y1, rngB);
        expect(b.p2.x, `seed ${String(seed)} step ${String(i)}`).toBeCloseTo(-a.p1.x, 6);
        expect(b.p2.y).toBeCloseTo(-a.p1.y, 6);
        expect(b.p1.x).toBeCloseTo(-a.p2.x, 6);
        expect(b.p1.y).toBeCloseTo(-a.p2.y, 6);
      }
      expect(b.p2Score).toBe(a.p1Score);
      expect(b.p1Score).toBe(a.p2Score);
    }
  });

  it('spends the same draws on both seats, so neither shifts the other stream', () => {
    const match = createMatch();
    const rng = new CountingRng(41);
    resetMatch(match, rng);
    const p1Brain = createBotState();
    const p2Brain = createBotState();
    const want = createDirection();
    rng.calls = 0;
    botAim(want, match, 'p1', 'normal', p1Brain, STEP, rng);
    const forP1 = rng.calls;
    rng.calls = 0;
    botAim(want, match, 'p2', 'normal', p2Brain, STEP, rng);
    expect(rng.calls).toBe(forP1);
  });
});

describe('the bot', () => {
  it('spends exactly two draws on a look and none between looks', () => {
    const match = createMatch();
    const rng = new CountingRng(17);
    resetMatch(match, rng);
    const brain = createBotState();
    const want = createDirection();
    rng.calls = 0;
    botAim(want, match, 'p1', 'normal', brain, STEP, rng);
    expect(rng.calls).toBe(BOT_DRAWS_PER_LOOK);
    rng.calls = 0;
    botAim(want, match, 'p1', 'normal', brain, STEP, rng);
    expect(rng.calls).toBe(0);
  });

  it('holds its last answer between looks', () => {
    const match = createMatch();
    const rng = new Rng(17);
    resetMatch(match, rng);
    const brain = createBotState();
    const want = createDirection();
    botAim(want, match, 'p1', 'easy', brain, STEP, rng);
    const first = { x: want.x, y: want.y };
    botAim(want, match, 'p1', 'easy', brain, STEP, rng);
    expect(want.x).toBe(first.x);
    expect(want.y).toBe(first.y);
  });

  it('looks again inside the window its profile names', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const tier of tiers) {
      const match = createMatch();
      const rng = new CountingRng(19);
      resetMatch(match, rng);
      const brain = createBotState();
      const want = createDirection();
      const profile = BOT_PROFILES[tier];
      botAim(want, match, 'p1', tier, brain, STEP, rng);
      rng.calls = 0;
      const steps = Math.ceil((profile.reaction + profile.waver) / STEP) + 1;
      for (let i = 0; i < steps; i += 1) botAim(want, match, 'p1', tier, brain, STEP, rng);
      expect(rng.calls, tier).toBeGreaterThanOrEqual(BOT_DRAWS_PER_LOOK);
    }
  });

  it('always asks for a direction of unit length, or for none at all', () => {
    const match = createMatch();
    const rng = new Rng(23);
    resetMatch(match, rng);
    const brain = createBotState();
    const want = createDirection();
    for (let i = 0; i < 900; i += 1) {
      botAim(want, match, 'p1', 'normal', brain, STEP, rng);
      const length = Math.hypot(want.x, want.y);
      expect(length === 0 || Math.abs(length - 1) < 1e-9).toBe(true);
      stepMatch(match, STEP, want.x, want.y, 0, 0, rng);
      if (match.winner !== null) break;
    }
  });

  it('turns for the middle of the road when it is about to run out of it', () => {
    const match = createMatch();
    const rng = new Rng(29);
    resetMatch(match, rng);
    // Hard against the right-hand kerb of the main road, driving straight at it.
    match.p1.x = BAR - 6;
    match.p1.y = 200;
    match.p1.vx = CRUISE_SPEED;
    match.p1.vy = 0;
    match.p1.heading = 0;
    match.p2.x = 0;
    match.p2.y = -400;
    const brain = createBotState();
    const want = createDirection();
    botAim(want, match, 'p1', 'hard', brain, STEP, rng);
    expect(want.x).toBeLessThan(0);
  });

  it('goes after the rival when it has road to spare', () => {
    const match = createMatch();
    const rng = new Rng(31);
    resetMatch(match, rng);
    match.p1.x = 0;
    match.p1.y = 0;
    match.p1.vx = 0;
    match.p1.vy = 0;
    match.p2.x = 0;
    match.p2.y = 300;
    match.p2.vx = 0;
    match.p2.vy = 0;
    const brain = createBotState();
    const want = createDirection();
    botAim(want, match, 'p1', 'hard', brain, STEP, rng);
    expect(want.y).toBeGreaterThan(0.5);
  });

  it('aims past the rival, on the side the water is', () => {
    const match = createMatch();
    const rng = new Rng(37);
    resetMatch(match, rng);
    // The rival is hard against the left kerb, so the way to push it in is from its right.
    match.p1.x = 0;
    match.p1.y = 260;
    match.p1.vx = 0;
    match.p1.vy = 0;
    match.p2.x = -BAR + 10;
    match.p2.y = 260;
    match.p2.vx = 0;
    match.p2.vy = 0;
    const brain = createBotState();
    const want = createDirection();
    botAim(want, match, 'p1', 'hard', brain, STEP, rng);
    expect(want.x).toBeLessThan(0);
  });

  it('bends away from a lorry that is close', () => {
    const match = createMatch();
    const rng = new Rng(43);
    resetMatch(match, rng);
    match.p1.x = 0;
    match.p1.y = 0;
    match.p2.x = 0;
    match.p2.y = 300;
    clearTraffic(match.traffic);
    const lorry = match.traffic[0];
    expect(lorry).toBeDefined();
    if (lorry === undefined) return;
    lorry.active = true;
    lorry.axis = 1;
    lorry.along = 90;
    lorry.lateral = 0;
    lorry.speed = -LORRY_SPEED;
    const brain = createBotState();
    const want = createDirection();
    botAim(want, match, 'p1', 'hard', brain, STEP, rng);
    // Without the lorry it would drive straight up the road at the rival; with one in the
    // way it leans off that line.
    expect(want.y).toBeLessThan(0.95);
  });

  it('reads a rival that is standing still exactly where it is', () => {
    // Rule 6 in its narrowest form: the lag can only ever cost the bot information.
    const match = createMatch();
    const rng = new Rng(47);
    resetMatch(match, rng);
    match.p1.x = 0;
    match.p1.y = 0;
    match.p2.x = 200;
    match.p2.y = 0;
    match.p2.vx = 0;
    match.p2.vy = 0;
    const easy = createBotState();
    const hard = createBotState();
    const easyWant = createDirection();
    const hardWant = createDirection();
    botAim(easyWant, match, 'p1', 'easy', easy, STEP, new Rng(1));
    botAim(hardWant, match, 'p1', 'hard', hard, STEP, new Rng(1));
    // Same board, same draw: only the profile differs, and a still rival cannot be stale.
    expect(Math.abs(Math.atan2(easyWant.y, easyWant.x))).toBeGreaterThan(
      Math.abs(Math.atan2(hardWant.y, hardWant.x)) - 1e-9,
    );
  });

  it('resets to a fresh look when its state is cleared', () => {
    const brain = createBotState();
    brain.look = 3;
    brain.wantX = 0.5;
    brain.wantY = -0.5;
    resetBotState(brain);
    expect(brain.look).toBe(0);
    expect(brain.wantX).toBe(0);
    expect(brain.wantY).toBe(0);
  });
});

describe('the difficulty ladder', () => {
  it('is ordered by reaction and by error, and by nothing else', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.error).toBeGreaterThan(BOT_PROFILES.normal.error);
    expect(BOT_PROFILES.normal.error).toBeGreaterThan(BOT_PROFILES.hard.error);
    expect(BOT_PROFILES.easy.waver).toBeGreaterThan(BOT_PROFILES.hard.waver);
    // Three fields and no more: a tier that could drive faster or see further would be
    // breaking rule 6 rather than being harder.
    expect(Object.keys(BOT_PROFILES.easy).sort()).toEqual(['error', 'reaction', 'waver']);
  });

  it('has the stronger tier win, measured over both seat orders', () => {
    function duel(strong: BotDifficulty, weak: BotDifficulty): number {
      let wins = 0;
      let decided = 0;
      for (let seed = 0; seed < 24; seed += 1) {
        const forward = playBots(9000 + seed * 331, strong, weak);
        if (forward.match.winner === 'p1') wins += 1;
        if (forward.match.winner !== null && forward.match.winner !== 'draw') decided += 1;
        const reverse = playBots(9000 + seed * 331 + 1, weak, strong);
        if (reverse.match.winner === 'p2') wins += 1;
        if (reverse.match.winner !== null && reverse.match.winner !== 'draw') decided += 1;
      }
      return wins / decided;
    }
    expect(duel('normal', 'easy')).toBeGreaterThan(0.6);
    expect(duel('hard', 'normal')).toBeGreaterThan(0.55);
    expect(duel('hard', 'easy')).toBeGreaterThan(0.75);
  });

  it('produces visibly different play at the two ends of the ladder', () => {
    const easy = playBots(1234, 'easy', 'easy');
    const hard = playBots(1234, 'hard', 'hard');
    expect(hard.match.p1.x).not.toBe(easy.match.p1.x);
  });
});

describe('the headline verb', () => {
  it('actually happens: cars are crashed into the water by the other car', () => {
    // The whole game is "crash your opponent", and a suite can be entirely green while
    // that never once occurs — Spin War shipped exactly that way. So this counts it.
    let rivalSplashes = 0;
    let splashes = 0;
    let rammings = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const match = createMatch();
      const rng = new Rng(70000 + seed * 977);
      resetMatch(match, rng);
      const brain1 = createBotState();
      const brain2 = createBotState();
      const want1 = createDirection();
      const want2 = createDirection();
      for (let step = 0; step < 60 * 200; step += 1) {
        if (match.winner !== null) break;
        botAim(want1, match, 'p1', 'normal', brain1, STEP, rng);
        botAim(want2, match, 'p2', 'normal', brain2, STEP, rng);
        const report = stepMatch(match, STEP, want1.x, want1.y, want2.x, want2.y, rng);
        if (report.rammed) rammings += 1;
        if (report.p1Splashed) {
          splashes += 1;
          if (match.p1.blame === 'rival') rivalSplashes += 1;
        }
        if (report.p2Splashed) {
          splashes += 1;
          if (match.p2.blame === 'rival') rivalSplashes += 1;
        }
      }
    }
    expect(splashes).toBeGreaterThan(100);
    expect(rammings, 'the two cars never once hit each other hard').toBeGreaterThan(40);
    expect(
      rivalSplashes,
      'no car was ever crashed into the water by the other, over forty matches',
    ).toBeGreaterThan(20);
    // A quarter of everything that happens is the thing the game is named after.
    expect(rivalSplashes / splashes).toBeGreaterThan(0.2);
  });

  it('and the other two ways in are both reachable too', () => {
    const seen = { rival: false, traffic: false, solo: false };
    for (let seed = 0; seed < 20 && !(seen.rival && seen.traffic && seen.solo); seed += 1) {
      const match = createMatch();
      const rng = new Rng(81000 + seed * 613);
      resetMatch(match, rng);
      const brain1 = createBotState();
      const brain2 = createBotState();
      const want1 = createDirection();
      const want2 = createDirection();
      for (let step = 0; step < 60 * 200; step += 1) {
        if (match.winner !== null) break;
        botAim(want1, match, 'p1', 'easy', brain1, STEP, rng);
        botAim(want2, match, 'p2', 'normal', brain2, STEP, rng);
        const report = stepMatch(match, STEP, want1.x, want1.y, want2.x, want2.y, rng);
        if (report.p1Splashed) seen[match.p1.blame] = true;
        if (report.p2Splashed) seen[match.p2.blame] = true;
      }
    }
    expect(seen).toEqual({ rival: true, traffic: true, solo: true });
  });
});

describe('the step report', () => {
  it('says nothing happened on a quiet step', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    const report = stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(report.p1Splashed).toBe(false);
    expect(report.p2Splashed).toBe(false);
    expect(report.boutOver).toBe(false);
  });

  it('names the seat that went in', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    match.p2.x = 999;
    const report = stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(report.p2Splashed).toBe(true);
    expect(report.p1Splashed).toBe(false);
    expect(report.boutOver).toBe(true);
  });

  it('is empty once the match is over', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    match.phase = 'over';
    match.winner = 'draw';
    const report = stepMatch(match, STEP, 0, 0, 0, 0, rng);
    expect(report.boutOver).toBe(false);
    expect(report.rammed).toBe(false);
  });

  it('reports a ram between the two cars', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    match.p1.x = -CAR_RADIUS + 4;
    match.p1.y = 0;
    match.p1.vx = 400;
    match.p1.heading = 0;
    match.p2.x = CAR_RADIUS - 4;
    match.p2.y = 0;
    match.p2.vx = -400;
    match.p2.heading = Math.PI;
    const report = stepMatch(match, STEP, 1, 0, -1, 0, rng);
    expect(report.rammed).toBe(true);
    expect(match.p1.blame).toBe('rival');
  });
});

describe('a nonsense direction', () => {
  it('is ignored rather than poisoning the car for ever', () => {
    const match = createMatch();
    const rng = new Rng(1);
    resetMatch(match, rng);
    stepMatch(match, STEP, Number.NaN, Number.NaN, 0, 0, rng);
    expect(Number.isFinite(match.p1.x)).toBe(true);
    expect(Number.isFinite(match.p1.heading)).toBe(true);
  });

  it('is ignored when it is longer than any instrument could produce', () => {
    const a = createCar();
    const b = createCar();
    stepCar(a, 900, 0, STEP);
    stepCar(b, 1, 0, STEP);
    expect(a.heading).toBe(b.heading);
    expect(a.x).toBe(b.x);
  });

  it('leaves a car driving when a direction of zero arrives', () => {
    const car = createCar();
    car.heading = 1.1;
    stepCar(car, 0, 0, STEP);
    expect(car.heading).toBe(1.1);
    expect(Math.hypot(car.vx, car.vy)).toBeGreaterThan(0);
  });
});

describe('the constants', () => {
  it('leave a car room to turn round on a full-width road', () => {
    const radius = CRUISE_SPEED / TURN_RATE;
    expect(radius * 2).toBeLessThan(BAR * 2);
  });

  it('leave two lorries room to pass on a full-width road', () => {
    expect(LANE_MIN + LORRY_HALF_WIDTH).toBeLessThanOrEqual(BAR);
    expect(LANE_MIN).toBeGreaterThanOrEqual(LORRY_HALF_WIDTH);
  });

  it('still leave two lanes at the narrowest road that takes traffic', () => {
    expect(TRAFFIC_MIN_BAR - LORRY_HALF_WIDTH).toBeGreaterThan(LANE_MIN);
  });

  it('start both cars far enough out that the flood is what closes the bout', () => {
    expect(START_ALONG).toBeGreaterThan(MIN_ARM);
    expect(START_ALONG + CAR_RADIUS).toBeLessThan(ARM_Y);
  });

  it('slide a hard shove about a lane and a half', () => {
    const slide = CRUISE_SPEED / GRIP_LATERAL;
    expect(slide).toBeGreaterThan(BAR * 0.8);
    expect(slide).toBeLessThan(BAR * 1.6);
  });

  it('give the settle a length in steps rather than in seconds', () => {
    expect(Number.isInteger(SETTLE_STEPS)).toBe(true);
  });

  it('name a car that is bigger than a lorry is wide, so a lane is a real choice', () => {
    expect(CAR_RADIUS * 2).toBeGreaterThan(LORRY_HALF_WIDTH * 2);
  });

  it('are the numbers the module documents', () => {
    expect(driveless()).toEqual({ x: 0, y: 0 });
    expect(TRAFFIC_SLOTS % 2).toBe(0);
    expect(SPAWN_FIRST).toBeLessThan(SPAWN_BASE);
    expect(FLOOD_SECONDS).toBeGreaterThan(SPAWN_BASE + SPAWN_JITTER);
  });
});
