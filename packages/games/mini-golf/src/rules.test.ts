import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  CAPTURE_SPEED,
  COURSE,
  CUP_RADIUS,
  GREEN_BOTTOM,
  GREEN_FRICTION,
  GREEN_LEFT,
  GREEN_RIGHT,
  GREEN_TOP,
  HOLES,
  MAX_ROLL_DISTANCE,
  MAX_ROLL_SECONDS,
  MAX_STROKES,
  MIN_WALL_THICKNESS,
  PICKED_UP_SCORE,
  PUTT_MAX_SPEED,
  SAND_FRICTION,
  WIN_CONDITION,
  ballOf,
  botAim,
  createGame,
  cupCaptures,
  holeAt,
  holeScoreOf,
  inAny,
  otherOf,
  pathBlocked,
  placeForHole,
  pointInRect,
  powerForDistance,
  putt,
  resetGame,
  sandCrossing,
  segmentHitsRect,
  settleHole,
  settleStroke,
  settleTheRound,
  step,
  stillPlaying,
  winnerOf,
} from './rules.js';
import type { Aim, BotProfile, Game, Hole } from './rules.js';

const STEP = 1 / 60;
const TIERS = ['easy', 'normal', 'hard'] as const;

/** Roll the ball in play until it stops. Returns the steps it took. */
function settle(game: Game, rate = STEP, maxSteps = 60 * 30): number {
  for (let i = 1; i <= maxSteps; i += 1) {
    if (step(game, rate).settled) return i;
  }
  return -1;
}

/** Put the game on a chosen hole with both balls freshly teed. */
function onHole(index: number): Game {
  const game = createGame();
  game.hole = index;
  placeForHole(game);
  return game;
}

interface MatchResult {
  readonly winner: string | null;
  readonly steps: number;
  readonly strokes: number;
}

/** A whole match between two profiles, played through the pure rules alone. */
function playMatch(seed: number, p1: BotProfile, p2: BotProfile): MatchResult {
  const game = createGame();
  const rng = new Rng(seed);
  const aim: Aim = { angle: 0, power: 0 };
  let strokes = 0;
  let steps = 0;
  while (game.winner === null && strokes < 2000) {
    botAim(aim, game, game.seat === 'p1' ? p1 : p2, rng.float(), rng.float());
    if (!putt(game, game.seat, aim.angle, aim.power)) break;
    strokes += 1;
    steps += Math.max(0, settle(game));
    if (settleStroke(game).holeOver) settleHole(game);
  }
  return { winner: game.winner, steps, strokes };
}

function series(p1: BotProfile, p2: BotProfile, count: number) {
  let a = 0;
  let b = 0;
  let draw = 0;
  let worst = 0;
  for (let seed = 1; seed <= count; seed += 1) {
    const result = playMatch(seed * 7919, p1, p2);
    if (result.winner === 'p1') a += 1;
    else if (result.winner === 'p2') b += 1;
    else draw += 1;
    if (result.steps > worst) worst = result.steps;
  }
  return { a, b, draw, worst };
}

/** How many strokes a profile needs to hole out alone, from the tee of one hole. */
function soloRound(profile: BotProfile, holeIndex: number, seeds: number): number {
  let total = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const game = onHole(holeIndex);
    const rng = new Rng(seed * 104729 + holeIndex);
    const aim: Aim = { angle: 0, power: 0 };
    while (stillPlaying(game, 'p1')) {
      game.seat = 'p1';
      botAim(aim, game, profile, rng.float(), rng.float());
      if (!putt(game, 'p1', aim.angle, aim.power)) break;
      settle(game);
      // Book-keeping for one player alone: seat two never plays in this harness.
      if (game.lastSplashed) game.p1.strokes += 1;
      game.lastSplashed = false;
      game.phase = 'aiming';
      if (!game.p1.holed && game.p1.strokes >= MAX_STROKES) game.p1.pickedUp = true;
    }
    total += holeScoreOf(game, 'p1');
  }
  return total / seeds;
}

describe('the course', () => {
  it('has nine holes, each with a par worth printing', () => {
    expect(COURSE.length).toBe(HOLES);
    for (const hole of COURSE) {
      expect(Number.isInteger(hole.par)).toBe(true);
      expect(hole.par).toBeGreaterThanOrEqual(2);
      expect(hole.par).toBeLessThanOrEqual(5);
    }
  });

  it('tees and cups every hole on the green', () => {
    for (const hole of COURSE) {
      for (const [x, y] of [hole.tee, hole.cup]) {
        expect(x).toBeGreaterThanOrEqual(GREEN_LEFT + BALL_RADIUS);
        expect(x).toBeLessThanOrEqual(GREEN_RIGHT - BALL_RADIUS);
        expect(y).toBeGreaterThanOrEqual(GREEN_TOP + BALL_RADIUS);
        expect(y).toBeLessThanOrEqual(GREEN_BOTTOM - BALL_RADIUS);
      }
    }
  });

  it('never buries a tee or a cup in something', () => {
    for (const hole of COURSE) {
      for (const [x, y] of [hole.tee, hole.cup]) {
        expect(inAny(hole.water, x, y)).toBe(false);
        for (const wall of hole.walls) {
          const dx = Math.max(wall.x - x, 0, x - (wall.x + wall.w));
          const dy = Math.max(wall.y - y, 0, y - (wall.y + wall.h));
          expect(Math.hypot(dx, dy), 'a ball has to fit there').toBeGreaterThan(BALL_RADIUS);
        }
      }
    }
  });

  it('has no wall thin enough for a fast putt to pass through', () => {
    // A ball crosses at most `PUTT_MAX_SPEED / 60` in a step and would need the thickness
    // plus its own diameter to skip a wall entirely. This is the check that a new hole
    // cannot quietly introduce one.
    const travel = PUTT_MAX_SPEED * STEP;
    for (const hole of COURSE) {
      for (const wall of hole.walls) {
        expect(Math.min(wall.w, wall.h)).toBeGreaterThanOrEqual(MIN_WALL_THICKNESS);
      }
    }
    expect(MIN_WALL_THICKNESS + BALL_RADIUS * 2).toBeGreaterThan(travel * 4);
  });

  it('separates every tee from its cup by less than the green is wide', () => {
    for (const hole of COURSE) {
      const span = Math.hypot(hole.cup[0] - hole.tee[0], hole.cup[1] - hole.tee[1]);
      expect(span).toBeGreaterThan(200);
      expect(span, 'nothing is out of reach of a single perfect putt').toBeLessThan(
        MAX_ROLL_DISTANCE,
      );
    }
  });

  it('can be finished, hole by hole, by the strongest tier', () => {
    // The property that matters more than any single constant: every cup is reachable
    // inside the stroke cap. A hole nobody can finish is a hole that is always halved.
    for (let index = 0; index < COURSE.length; index += 1) {
      const average = soloRound(BOT_PROFILES.hard, index, 40);
      expect(average, `hole ${String(index + 1)} averaged ${average.toFixed(2)}`).toBeLessThan(
        MAX_STROKES - 1,
      );
    }
  });

  it('clamps a hole index rather than falling off the end', () => {
    expect(holeAt(-3)).toBe(COURSE[0]);
    expect(holeAt(HOLES + 5)).toBe(COURSE[HOLES - 1]);
  });
});

describe('playing a stroke', () => {
  it('sends the ball the way it is aimed', () => {
    const game = createGame();
    expect(putt(game, 'p1', 0, 1)).toBe(true);
    expect(game.p1.vx).toBeCloseTo(PUTT_MAX_SPEED, 3);
    expect(game.p1.vy).toBeCloseTo(0, 6);
    expect(game.phase).toBe('rolling');
  });

  it('counts the stroke and remembers where it was played from', () => {
    const game = createGame();
    const from = { x: game.p1.x, y: game.p1.y };
    putt(game, 'p1', -Math.PI / 2, 0.5);
    expect(game.p1.strokes).toBe(1);
    expect(game.p1.fromX).toBe(from.x);
    expect(game.p1.fromY).toBe(from.y);
  });

  it('refuses a second stroke while one is rolling', () => {
    const game = createGame();
    putt(game, 'p1', 0, 1);
    expect(putt(game, 'p1', 0, 1)).toBe(false);
  });

  it('refuses a stroke from the seat whose turn it is not', () => {
    const game = createGame();
    expect(putt(game, 'p2', 0, 1)).toBe(false);
    expect(game.p2.strokes).toBe(0);
  });

  it('refuses a stroke with no weight behind it', () => {
    const game = createGame();
    expect(putt(game, 'p1', 0, 0)).toBe(false);
    expect(putt(game, 'p1', 0, 0.001)).toBe(false);
    expect(game.phase).toBe('aiming');
  });

  it('refuses nonsense rather than putting it into the simulation', () => {
    // A storm of junk input reaches this, and a NaN velocity would poison the ball for the
    // rest of the match rather than failing anywhere near where it came from.
    const game = createGame();
    expect(putt(game, 'p1', Number.NaN, 0.5)).toBe(false);
    expect(putt(game, 'p1', Number.POSITIVE_INFINITY, 0.5)).toBe(false);
    expect(putt(game, 'p1', 0, Number.NaN)).toBe(false);
    expect(game.phase).toBe('aiming');
  });

  it('clamps a power above one rather than firing a ball off the green', () => {
    const game = createGame();
    putt(game, 'p1', 0, 40);
    expect(Math.hypot(game.p1.vx, game.p1.vy)).toBeCloseTo(PUTT_MAX_SPEED, 3);
  });

  it('refuses a ball that is already in the cup', () => {
    const game = createGame();
    game.p1.holed = true;
    expect(putt(game, 'p1', 0, 0.5)).toBe(false);
  });
});

describe('the roll', () => {
  it('comes to rest rather than rolling for ever', () => {
    const game = createGame();
    putt(game, 'p1', 0.4, 1);
    expect(settle(game)).toBeGreaterThan(0);
    expect(game.p1.vx).toBe(0);
    expect(game.p1.vy).toBe(0);
    expect(Object.is(game.p1.vx, -0), 'a stopped ball is not moving backwards').toBe(false);
  });

  it('stops inside the time the friction model promises', () => {
    // The whole turn order rests on this. `v / a` seconds, whatever the ball does on the
    // way — bounces only ever take speed out.
    const promised = Math.ceil((PUTT_MAX_SPEED / GREEN_FRICTION) * 60) + 2;
    for (let index = 0; index < COURSE.length; index += 1) {
      const game = onHole(index);
      putt(game, game.seat, 1.1, 1);
      const steps = settle(game);
      expect(steps, `hole ${String(index + 1)} took ${String(steps)} steps`).toBeLessThanOrEqual(
        promised,
      );
    }
  });

  it('rolls the distance the power promises', () => {
    const game = onHole(0);
    game.p1.x = 90;
    game.p1.y = 500;
    putt(game, 'p1', 0, powerForDistance(400));
    settle(game);
    expect(game.p1.x - 90).toBeCloseTo(400, 4);
  });

  it('rolls its furthest at full power', () => {
    const game = onHole(0);
    game.p1.x = GREEN_LEFT + BALL_RADIUS;
    game.p1.y = 500;
    putt(game, 'p1', 0, 1);
    settle(game);
    // It reaches the far cushion long before it runs out, so the honest check is the model:
    // the analytic roll is what `powerForDistance` inverts.
    expect(MAX_ROLL_DISTANCE).toBeCloseTo(908.6, 1);
    expect(powerForDistance(MAX_ROLL_DISTANCE)).toBeCloseTo(1, 6);
  });

  it('stops in the same place at 60, 90, 120 and 240 Hz', () => {
    // Rule 8. The travel over a step is the exact integral of a constant deceleration
    // rather than `v · t`, so the total roll does not drift with the step size.
    const where = (rate: number): [number, number] => {
      const game = onHole(0);
      game.p1.x = 200;
      game.p1.y = 700;
      putt(game, 'p1', 0, powerForDistance(300));
      settle(game, rate, 60 * 60);
      return [game.p1.x, game.p1.y];
    };
    const base = where(1 / 60);
    for (const rate of [1 / 90, 1 / 120, 1 / 240]) {
      const other = where(rate);
      expect(other[0]).toBeCloseTo(base[0], 6);
      expect(other[1]).toBeCloseTo(base[1], 6);
    }
  });

  it('never leaves the green, however hard it is struck', () => {
    const rng = new Rng(4242);
    for (let index = 0; index < COURSE.length; index += 1) {
      const game = onHole(index);
      for (let shot = 0; shot < 12; shot += 1) {
        game.phase = 'aiming';
        game.p1.holed = false;
        game.p1.pickedUp = false;
        game.seat = 'p1';
        putt(game, 'p1', rng.float() * Math.PI * 2, 0.4 + rng.float() * 0.6);
        settle(game);
        expect(game.p1.x).toBeGreaterThanOrEqual(GREEN_LEFT + BALL_RADIUS - 0.001);
        expect(game.p1.x).toBeLessThanOrEqual(GREEN_RIGHT - BALL_RADIUS + 0.001);
        expect(game.p1.y).toBeGreaterThanOrEqual(GREEN_TOP + BALL_RADIUS - 0.001);
        expect(game.p1.y).toBeLessThanOrEqual(GREEN_BOTTOM - BALL_RADIUS + 0.001);
      }
    }
  });

  it('bounces off each edge and comes back', () => {
    for (const [angle, axis] of [
      [0, 'x'],
      [Math.PI, 'x'],
      [Math.PI / 2, 'y'],
      [-Math.PI / 2, 'y'],
    ] as [number, 'x' | 'y'][]) {
      const game = onHole(0);
      game.p1.x = 350;
      game.p1.y = 500;
      putt(game, 'p1', angle, 1);
      settle(game);
      const moved = axis === 'x' ? game.p1.x !== 350 : game.p1.y !== 500;
      expect(moved).toBe(true);
    }
  });

  it('takes speed out of a bounce rather than adding it', () => {
    const game = onHole(0);
    game.p1.x = GREEN_RIGHT - BALL_RADIUS - 20;
    game.p1.y = 500;
    putt(game, 'p1', 0, 1);
    const before = Math.hypot(game.p1.vx, game.p1.vy);
    for (let i = 0; i < 6; i += 1) step(game, STEP);
    expect(Math.hypot(game.p1.vx, game.p1.vy)).toBeLessThan(before);
  });

  it('bounces off a block instead of passing through it', () => {
    // Hole two is a bar across the middle with the tee straight below it.
    const game = onHole(1);
    const wall = holeAt(1).walls[0];
    if (wall === undefined) throw new Error('no fixture');
    putt(game, 'p1', -Math.PI / 2, 1);
    settle(game);
    expect(game.p1.y, 'it never got past the bar').toBeGreaterThan(wall.y + wall.h);
  });

  it('does not tunnel through a wall at full speed', () => {
    const game = onHole(1);
    const wall = holeAt(1).walls[0];
    if (wall === undefined) throw new Error('no fixture');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      game.phase = 'aiming';
      game.seat = 'p1';
      game.p1.x = wall.x + 8 + attempt * 4;
      game.p1.y = wall.y + wall.h + BALL_RADIUS + 6;
      putt(game, 'p1', -Math.PI / 2, 1);
      settle(game);
      expect(pointInRect(game.p1.x, game.p1.y, wall)).toBe(false);
    }
  });

  it('drags a ball down in sand', () => {
    const clean = onHole(0);
    clean.p1.x = 350;
    clean.p1.y = 700;
    putt(clean, 'p1', -Math.PI / 2, 0.7);
    settle(clean);
    const cleanRun = 700 - clean.p1.y;

    // Hole six is the same straight putt with a bunker across the middle of it.
    const sandy = onHole(5);
    sandy.p1.x = 350;
    sandy.p1.y = 700;
    putt(sandy, 'p1', -Math.PI / 2, 0.7);
    settle(sandy);
    expect(700 - sandy.p1.y, 'the bunker takes the legs off it').toBeLessThan(cleanRun);
    expect(SAND_FRICTION).toBeGreaterThan(GREEN_FRICTION);
  });

  it('stops a ball that somehow never slows, so a turn cannot hang', () => {
    const game = createGame();
    putt(game, 'p1', 0, 1);
    // Hand it a speed friction alone would take a very long time to remove, which is what
    // the safety cap is for. It is not reachable through `putt`; that is rather the point.
    game.p1.vx = 1e7;
    game.p1.vy = 0;
    const steps = settle(game);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThanOrEqual(Math.ceil(MAX_ROLL_SECONDS * 60) + 1);
    expect(game.p1.vx).toBe(0);
  });

  it('does nothing at all when nothing is in play', () => {
    const game = createGame();
    const before = JSON.stringify(game);
    expect(step(game, STEP).settled).toBe(true);
    expect(JSON.stringify(game)).toBe(before);
  });
});

describe('the cup', () => {
  it('takes a ball that arrives slowly', () => {
    const game = onHole(0);
    const hole = holeAt(0);
    game.p1.x = hole.cup[0];
    game.p1.y = hole.cup[1] + 120;
    putt(game, 'p1', -Math.PI / 2, powerForDistance(150));
    settle(game);
    expect(game.p1.holed).toBe(true);
    expect(game.p1.x).toBe(hole.cup[0]);
    expect(game.p1.y).toBe(hole.cup[1]);
  });

  it('spits out one that arrives too fast', () => {
    // Charging the hole is a real mistake, and the reason weight is a skill here.
    const game = onHole(0);
    const hole = holeAt(0);
    game.p1.x = hole.cup[0];
    game.p1.y = hole.cup[1] + 120;
    putt(game, 'p1', -Math.PI / 2, 1);
    settle(game);
    expect(game.p1.holed).toBe(false);
    const missedBy = Math.hypot(game.p1.x - hole.cup[0], game.p1.y - hole.cup[1]);
    expect(missedBy, 'it rode the rim and ran on').toBeGreaterThan(CUP_RADIUS);
  });

  it('knows the speed it will and will not accept', () => {
    const hole = holeAt(0);
    const side = { ...createGame().p1, x: hole.cup[0], y: hole.cup[1], vx: 0, vy: 0 };
    expect(cupCaptures(hole, side)).toBe(true);
    side.vx = CAPTURE_SPEED - 1;
    expect(cupCaptures(hole, side)).toBe(true);
    side.vx = CAPTURE_SPEED + 1;
    expect(cupCaptures(hole, side)).toBe(false);
    side.vx = 0;
    side.x = hole.cup[0] + CUP_RADIUS + 1;
    expect(cupCaptures(hole, side)).toBe(false);
  });
});

describe('water', () => {
  const holeIndex = 6;

  it('puts the ball back where it was played from', () => {
    const game = onHole(holeIndex);
    const pond = holeAt(holeIndex).water[0];
    if (pond === undefined) throw new Error('no fixture');
    game.seat = 'p1';
    game.p1.x = pond.x + pond.w / 2;
    game.p1.y = pond.y + pond.h + 90;
    const from = { x: game.p1.x, y: game.p1.y };
    putt(game, 'p1', -Math.PI / 2, powerForDistance(140));
    settle(game);
    expect(game.lastSplashed).toBe(true);
    expect(game.p1.x).toBe(from.x);
    expect(game.p1.y).toBe(from.y);
  });

  it('costs a stroke, and only one however long it sits there', () => {
    const game = onHole(holeIndex);
    const pond = holeAt(holeIndex).water[0];
    if (pond === undefined) throw new Error('no fixture');
    game.seat = 'p1';
    game.p1.x = pond.x + pond.w / 2;
    game.p1.y = pond.y + pond.h + 90;
    putt(game, 'p1', -Math.PI / 2, powerForDistance(140));
    settle(game);
    settleStroke(game);
    expect(game.p1.strokes, 'the stroke and the penalty').toBe(2);
    expect(game.lastSplashed, 'and it is spent').toBe(false);
  });
});

describe('the turn', () => {
  it('alternates strokes between the two seats', () => {
    const game = createGame();
    expect(game.seat).toBe('p1');
    putt(game, 'p1', -Math.PI / 2, 0.3);
    settle(game);
    expect(settleStroke(game).next).toBe('p2');
    expect(game.seat).toBe('p2');
    putt(game, 'p2', -Math.PI / 2, 0.3);
    settle(game);
    expect(settleStroke(game).next).toBe('p1');
  });

  it('leaves a seat that has holed out alone', () => {
    const game = createGame();
    game.p2.holed = true;
    putt(game, 'p1', -Math.PI / 2, 0.3);
    settle(game);
    const outcome = settleStroke(game);
    expect(outcome.holeOver).toBe(false);
    expect(outcome.next, 'nobody else can play').toBe('p1');
  });

  it('ends the hole once neither seat has a ball in play', () => {
    const game = createGame();
    game.p2.holed = true;
    game.p1.strokes = MAX_STROKES - 1;
    putt(game, 'p1', -Math.PI / 2, 0.3);
    settle(game);
    const outcome = settleStroke(game);
    expect(game.p1.pickedUp).toBe(true);
    expect(outcome.holeOver).toBe(true);
    expect(game.phase).toBe('hole-over');
  });

  it('picks a ball up at the stroke cap', () => {
    const game = createGame();
    for (let stroke = 0; stroke < MAX_STROKES; stroke += 1) {
      game.seat = 'p1';
      game.phase = 'aiming';
      putt(game, 'p1', Math.PI / 2, 0.05);
      settle(game);
      settleStroke(game);
    }
    expect(game.p1.strokes).toBe(MAX_STROKES);
    expect(game.p1.pickedUp).toBe(true);
    expect(stillPlaying(game, 'p1')).toBe(false);
  });

  it('scores a pick-up worse than any hole anybody could complete', () => {
    const game = createGame();
    game.p1.pickedUp = true;
    game.p2.holed = true;
    game.p2.strokes = MAX_STROKES;
    expect(holeScoreOf(game, 'p1')).toBe(PICKED_UP_SCORE);
    expect(holeScoreOf(game, 'p2')).toBeLessThan(PICKED_UP_SCORE);
  });

  it('has two seats and knows which is which', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('scoring a hole', () => {
  function finishHole(game: Game, p1Strokes: number, p2Strokes: number): void {
    game.p1.holed = p1Strokes <= MAX_STROKES;
    game.p1.pickedUp = !game.p1.holed;
    game.p1.strokes = p1Strokes;
    game.p2.holed = p2Strokes <= MAX_STROKES;
    game.p2.pickedUp = !game.p2.holed;
    game.p2.strokes = p2Strokes;
    settleHole(game);
  }

  it('gives the point to whoever took fewer strokes', () => {
    const game = createGame();
    finishHole(game, 2, 4);
    expect(game.points).toEqual({ p1: 1, p2: 0 });
    expect(game.lastHole).toBe('p1');
  });

  it('halves a hole taken in the same number', () => {
    const game = createGame();
    finishHole(game, 3, 3);
    expect(game.points).toEqual({ p1: 0, p2: 0 });
    expect(game.lastHole).toBe('halved');
  });

  it('halves a hole neither of them finished', () => {
    const game = createGame();
    finishHole(game, 99, 99);
    expect(game.lastHole).toBe('halved');
    expect(game.totalStrokes).toEqual({ p1: PICKED_UP_SCORE, p2: PICKED_UP_SCORE });
  });

  it('keeps the strokes round the course, which settles a level round', () => {
    const game = createGame();
    finishHole(game, 2, 4);
    finishHole(game, 5, 3);
    expect(game.totalStrokes).toEqual({ p1: 7, p2: 7 });
    expect(game.points).toEqual({ p1: 1, p2: 1 });
  });

  it('re-tees both balls on the next hole', () => {
    const game = createGame();
    finishHole(game, 2, 4);
    const next = holeAt(1);
    expect(game.hole).toBe(1);
    expect(game.p1.x).toBe(next.tee[0]);
    expect(game.p2.y).toBe(next.tee[1]);
    expect(game.p1.strokes).toBe(0);
    expect(game.p1.holed).toBe(false);
    expect(game.phase).toBe('aiming');
  });

  it('alternates who plays first, hole by hole', () => {
    // Nothing here rewards playing first — the balls never touch — but a rule that anybody
    // can see is worth more than one nobody has to remember.
    const game = createGame();
    expect(game.seat).toBe('p1');
    finishHole(game, 2, 3);
    expect(game.seat).toBe('p2');
    finishHole(game, 3, 2);
    expect(game.seat).toBe('p1');
  });
});

describe('winning the match', () => {
  function takeHoles(game: Game, p1Holes: number, p2Holes: number): void {
    for (let i = 0; i < p1Holes; i += 1) {
      game.p1.holed = true;
      game.p1.strokes = 2;
      game.p2.holed = true;
      game.p2.strokes = 3;
      settleHole(game);
    }
    for (let i = 0; i < p2Holes; i += 1) {
      game.p1.holed = true;
      game.p1.strokes = 3;
      game.p2.holed = true;
      game.p2.strokes = 2;
      settleHole(game);
    }
  }

  it('is the observed rule, resolved by the shared helper', () => {
    expect(WIN_CONDITION).toEqual({ kind: 'lead-by', margin: 2 });
  });

  it('goes to two points clear', () => {
    const game = createGame();
    takeHoles(game, 2, 0);
    expect(winnerOf(game)).toBe('p1');
    expect(game.phase).toBe('over');
  });

  it('does not end on one point clear', () => {
    const game = createGame();
    takeHoles(game, 1, 0);
    expect(winnerOf(game)).toBeNull();
    expect(game.phase).toBe('aiming');
  });

  it('does not end when the lead is given back', () => {
    const game = createGame();
    takeHoles(game, 1, 1);
    expect(winnerOf(game)).toBeNull();
    expect(game.points).toEqual({ p1: 1, p2: 1 });
  });

  it('stops after nine holes whatever the score, and gives it to the leader', () => {
    // The cap. Without it two players who keep trading holes never finish, which is the
    // shape that shipped broken in Pool and Air Hockey.
    const game = createGame();
    takeHoles(game, 5, 4);
    expect(game.hole).toBe(HOLES);
    expect(game.points).toEqual({ p1: 5, p2: 4 });
    expect(winnerOf(game), 'one clear is enough once the holes run out').toBe('p1');
  });

  it('settles a level round on the strokes round the course', () => {
    const game = createGame();
    game.points.p1 = 4;
    game.points.p2 = 4;
    game.totalStrokes.p1 = 26;
    game.totalStrokes.p2 = 29;
    expect(settleTheRound(game)).toBe('p1');
    game.totalStrokes.p1 = 31;
    expect(settleTheRound(game)).toBe('p2');
  });

  it('is a draw only when the two rounds are identical', () => {
    const game = createGame();
    game.points.p1 = 4;
    game.points.p2 = 4;
    game.totalStrokes.p1 = 27;
    game.totalStrokes.p2 = 27;
    expect(settleTheRound(game)).toBe('draw');
  });

  it('takes the lead over the strokes when there is one', () => {
    const game = createGame();
    game.points.p1 = 5;
    game.points.p2 = 4;
    game.totalStrokes.p1 = 40;
    game.totalStrokes.p2 = 20;
    expect(settleTheRound(game), 'holes won is the game; strokes only break a tie').toBe('p1');
  });

  it('starts a fresh round level and back on the first tee', () => {
    const game = createGame();
    takeHoles(game, 2, 0);
    resetGame(game);
    expect(game.points).toEqual({ p1: 0, p2: 0 });
    expect(game.totalStrokes).toEqual({ p1: 0, p2: 0 });
    expect(game.hole).toBe(0);
    expect(game.winner).toBeNull();
    expect(game.seat).toBe('p1');
    expect(game.p1.x).toBe(holeAt(0).tee[0]);
  });
});

describe('the geometry the bot reasons with', () => {
  const box = { x: 100, y: 100, w: 100, h: 100 };

  it('sees a line that crosses a box', () => {
    expect(segmentHitsRect(0, 150, 300, 150, box, 0)).toBe(true);
    expect(segmentHitsRect(150, 0, 150, 300, box, 0)).toBe(true);
  });

  it('sees a line that misses it', () => {
    expect(segmentHitsRect(0, 50, 300, 50, box, 0)).toBe(false);
    expect(segmentHitsRect(0, 250, 300, 250, box, 0)).toBe(false);
    expect(segmentHitsRect(300, 150, 400, 150, box, 0)).toBe(false);
  });

  it('grows the box by the ball, so a shaved corner counts as a miss', () => {
    expect(segmentHitsRect(0, 95, 300, 95, box, 0)).toBe(false);
    expect(segmentHitsRect(0, 95, 300, 95, box, 10)).toBe(true);
  });

  it('treats water as being in the way, the same as a wall', () => {
    const wet = holeAt(6);
    const pond = wet.water[0];
    if (pond === undefined) throw new Error('no fixture');
    const midX = pond.x + pond.w / 2;
    expect(pathBlocked(wet, midX, pond.y + pond.h + 60, midX, pond.y - 60)).toBe(true);
  });

  it('measures how much of a line is in sand', () => {
    const sandy = holeAt(5);
    const patch = sandy.sand[0];
    if (patch === undefined) throw new Error('no fixture');
    const midX = patch.x + patch.w / 2;
    const across = sandCrossing(sandy, midX, patch.y + patch.h + 100, midX, patch.y - 100);
    expect(across).toBeCloseTo(patch.h, 3);
    expect(sandCrossing(sandy, 60, 800, 60, 200), 'well clear of it').toBe(0);
  });

  it('reports no crossing for a line that goes nowhere', () => {
    expect(sandCrossing(holeAt(5), 350, 500, 350, 500)).toBe(0);
  });

  it('knows a point inside a box from one outside it', () => {
    expect(pointInRect(150, 150, box)).toBe(true);
    expect(pointInRect(99, 150, box)).toBe(false);
    expect(inAny([box], 150, 150)).toBe(true);
    expect(inAny([], 150, 150)).toBe(false);
  });
});

describe('the bot', () => {
  const aim: Aim = { angle: 0, power: 0 };

  it('aims at the cup when it can see it', () => {
    const game = onHole(0);
    botAim(aim, game, BOT_PROFILES.hard, 0.5, 0.5);
    const hole = holeAt(0);
    const straight = Math.atan2(hole.cup[1] - game.p1.y, hole.cup[0] - game.p1.x);
    expect(aim.angle).toBeCloseTo(straight, 6);
  });

  it('plays wide of a block it cannot see past', () => {
    const game = onHole(4);
    const hole = holeAt(4);
    botAim(aim, game, BOT_PROFILES.hard, 0.5, 0.5);
    const straight = Math.atan2(hole.cup[1] - game.p1.y, hole.cup[0] - game.p1.x);
    expect(Math.abs(aim.angle - straight), 'not straight at the bar').toBeGreaterThan(0.2);
  });

  it('hits harder through sand than over the same distance of green', () => {
    const clean = onHole(0);
    clean.p1.x = 350;
    clean.p1.y = 700;
    const sandy = onHole(5);
    sandy.p1.x = 350;
    sandy.p1.y = 700;
    botAim(aim, clean, BOT_PROFILES.hard, 0.5, 0.5);
    const overGreen = aim.power;
    botAim(aim, sandy, BOT_PROFILES.hard, 0.5, 0.5);
    expect(aim.power).toBeGreaterThan(overGreen);
  });

  it('draws its error once for the stroke, not per step', () => {
    // The single most repeated bug in this repository: a fresh error every step averages to
    // zero and every tier plays identically.
    const game = onHole(0);
    const low = { angle: 0, power: 0 };
    const high = { angle: 0, power: 0 };
    botAim(low, game, BOT_PROFILES.easy, 0.1, 0.1);
    botAim(high, game, BOT_PROFILES.easy, 0.9, 0.9);
    expect(low.angle).not.toBe(high.angle);
    expect(low.power).not.toBe(high.power);
    const again = { angle: 0, power: 0 };
    botAim(again, game, BOT_PROFILES.easy, 0.1, 0.1);
    expect(again.angle, 'the same roll is the same stroke').toBe(low.angle);
  });

  it('never asks for a power the rules would refuse', () => {
    const rng = new Rng(9001);
    for (let index = 0; index < COURSE.length; index += 1) {
      const game = onHole(index);
      for (const tier of TIERS) {
        for (let i = 0; i < 20; i += 1) {
          game.p1.x = GREEN_LEFT + 20 + rng.float() * (GREEN_RIGHT - GREEN_LEFT - 40);
          game.p1.y = GREEN_TOP + 20 + rng.float() * (GREEN_BOTTOM - GREEN_TOP - 40);
          botAim(aim, game, BOT_PROFILES[tier], rng.float(), rng.float());
          expect(Number.isFinite(aim.angle)).toBe(true);
          expect(aim.power).toBeGreaterThan(0);
          expect(aim.power).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is steadier and less greedy the harder the tier', () => {
    expect(BOT_PROFILES.easy.angleSpread).toBeGreaterThan(BOT_PROFILES.normal.angleSpread);
    expect(BOT_PROFILES.normal.angleSpread).toBeGreaterThan(BOT_PROFILES.hard.angleSpread);
    expect(BOT_PROFILES.easy.powerSpread).toBeGreaterThan(BOT_PROFILES.normal.powerSpread);
    expect(BOT_PROFILES.normal.powerSpread).toBeGreaterThan(BOT_PROFILES.hard.powerSpread);
    expect(BOT_PROFILES.easy.overshoot).toBeGreaterThan(BOT_PROFILES.normal.overshoot);
    expect(BOT_PROFILES.normal.overshoot).toBeGreaterThan(BOT_PROFILES.hard.overshoot);
  });

  it('gambles on a run-out the weaker it is', () => {
    // A ball can be at most this far past the cup and still drop, so `easy` is deliberately
    // over the line: it charges the hole and lips out, which is what a bad putter does.
    const furthest = (CAPTURE_SPEED * CAPTURE_SPEED) / (2 * GREEN_FRICTION);
    expect(BOT_PROFILES.easy.overshoot).toBeGreaterThan(furthest);
    expect(BOT_PROFILES.hard.overshoot).toBeLessThan(furthest);
  });

  it('goes round in fewer strokes the harder the tier', () => {
    const scores = TIERS.map((tier) => {
      let total = 0;
      for (let index = 0; index < COURSE.length; index += 1) {
        total += soloRound(BOT_PROFILES[tier], index, 20);
      }
      return total;
    });
    const [easy, normal, hard] = scores as [number, number, number];
    expect(normal, `normal ${normal.toFixed(1)} beats easy ${easy.toFixed(1)}`).toBeLessThan(easy);
    expect(hard, `hard ${hard.toFixed(1)} beats normal ${normal.toFixed(1)}`).toBeLessThan(normal);
  });
});

describe('the ladder, measured', () => {
  // The full numbers are 240 matches a pairing and are written into SPEC.md: hard takes 89%
  // of its matches against easy, normal 74% against easy, hard 76% against normal. These are
  // the versions that fit in a commit.
  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak, ratio] of [
      ['hard', 'easy', 3],
      ['normal', 'easy', 1.6],
      ['hard', 'normal', 1.8],
    ] as [(typeof TIERS)[number], (typeof TIERS)[number], number][]) {
      const asP1 = series(BOT_PROFILES[strong], BOT_PROFILES[weak], 60);
      expect(asP1.a, `${strong} as p1 v ${weak}: ${asP1.a}-${asP1.b}`).toBeGreaterThan(
        asP1.b * ratio,
      );
      const asP2 = series(BOT_PROFILES[weak], BOT_PROFILES[strong], 60);
      expect(asP2.b, `${strong} as p2 v ${weak}: ${asP2.b}-${asP2.a}`).toBeGreaterThan(
        asP2.a * ratio,
      );
    }
  });

  it('is level against itself, so no seat is advantaged', () => {
    for (const tier of TIERS) {
      const wins = series(BOT_PROFILES[tier], BOT_PROFILES[tier], 60);
      const decided = wins.a + wins.b;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(50);
      const share = wins.a / decided;
      expect(share, `${tier} p1 took ${String(wins.a)} of ${String(decided)}`).toBeGreaterThan(0.3);
      expect(share, `${tier} p1 took ${String(wins.a)} of ${String(decided)}`).toBeLessThan(0.7);
    }
  });

  it('leaves few matches undecided, so the score is doing work', () => {
    // Holes won is a coarse score and two matched players halve a lot of holes; the strokes
    // tiebreak is what keeps the draw rate in low single figures.
    for (const tier of TIERS) {
      const wins = series(BOT_PROFILES[tier], BOT_PROFILES[tier], 60);
      expect(wins.draw / 60, `${tier} drew ${String(wins.draw)} of 60`).toBeLessThan(0.15);
    }
  });

  it('finishes a match in a small fraction of the ten minutes it is given', () => {
    // The guard in `apps/web/src/data/termination.test.ts` allows 36,000 steps. The worst
    // pairing here is two `easy` bots, which halve holes all the way to the ninth.
    const worst = series(BOT_PROFILES.easy, BOT_PROFILES.easy, 60).worst;
    expect(worst, `the longest round took ${String(worst)} steps`).toBeLessThan(60 * 180);
  });

  it('always reaches a decision, at every pairing', () => {
    for (const p1 of TIERS) {
      for (const p2 of TIERS) {
        for (let seed = 1; seed <= 8; seed += 1) {
          const result = playMatch(seed * 5077, BOT_PROFILES[p1], BOT_PROFILES[p2]);
          expect(result.winner, `${p1} v ${p2} seed ${String(seed)}`).not.toBeNull();
          expect(result.strokes).toBeLessThan(HOLES * MAX_STROKES * 2 + 1);
        }
      }
    }
  });
});

describe('a hole, as a fixture', () => {
  it('exposes its walls, sand and water as read-only boxes', () => {
    const hole: Hole = holeAt(8);
    expect(hole.walls.length).toBeGreaterThan(0);
    expect(Object.isFrozen(hole.walls[0])).toBe(true);
  });

  it('places a ball on the tee with a clean card', () => {
    const game = createGame();
    game.p1.strokes = 4;
    game.p1.holed = true;
    game.hole = 3;
    placeForHole(game);
    expect(ballOf(game, 'p1').strokes).toBe(0);
    expect(ballOf(game, 'p1').holed).toBe(false);
    expect(ballOf(game, 'p2').x).toBe(holeAt(3).tee[0]);
  });
});
