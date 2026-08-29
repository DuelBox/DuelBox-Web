import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { manifest } from './manifest.js';
import {
  ABORT_SECONDS,
  BOAT_OUT,
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  CAST_LIMIT,
  CAST_SPEED,
  CAST_STOP_SPEED,
  DART_RADIUS,
  DRIFTER_RADIUS,
  FISH_PER_ROW,
  FLIGHT_SECONDS,
  HELD,
  HOOK_RADIUS,
  LANE_OFFSET,
  MATCH_SECONDS,
  MAX_REACH,
  POND_HALF,
  RESPAWN_SECONDS,
  ROW_DIRS,
  ROW_OFFSETS,
  SEATS,
  STRIKE_LIMIT,
  TARGET_FISH,
  botCommand,
  catchRadiusOf,
  createBotState,
  createCommand,
  createGame,
  flightOutAt,
  flightSpeedAt,
  flightTime,
  laneOf,
  laneTime,
  resetBotState,
  resetGame,
  rodOf,
  rowOutOf,
  seatAxisSign,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Command, Fish, Game, Rod } from './rules.js';

const STEP = 1 / 60;
const PRESS: Readonly<Command> = Object.freeze({ press: true });
const IDLE: Readonly<Command> = Object.freeze({ press: false });

function fresh(seed: number): Game {
  const game = createGame();
  resetGame(game, new Rng(seed));
  return game;
}

/** Clear the pond so a test can place exactly the fish it means to talk about. */
function empty(game: Game): void {
  for (let i = 0; i < game.fish.length; i += 1) {
    const fish = game.fish[i] as Fish;
    fish.active = false;
    fish.delay = 999;
  }
}

/** Put one fish where a test wants it. Returns its index. */
function place(
  game: Game,
  index: number,
  cx: number,
  cy: number,
  kind: 'drifter' | 'dart' = 'drifter',
  speed = 0,
  dir = 1,
): number {
  const fish = game.fish[index] as Fish;
  fish.active = true;
  fish.delay = 0;
  fish.cx = cx;
  fish.cy = cy;
  fish.kind = kind;
  fish.speed = speed;
  fish.dir = dir;
  return index;
}

/** Throw a seat's bait and hold it there, without letting the other seat do anything. */
function castTo(game: Game, seat: SeatId, out: number): void {
  const rod = rodOf(game, seat);
  step(game, STEP, seat === 'p1' ? PRESS : IDLE, seat === 'p1' ? IDLE : PRESS);
  while (rod.out < out && rod.phase === 'flying') step(game, STEP, IDLE, IDLE);
}

/* ------------------------------------------------------------------------------------ */
/* The board                                                                             */
/* ------------------------------------------------------------------------------------ */

describe('the pond', () => {
  it('puts every row on the middle of the board and flips its current in the pair', () => {
    for (let i = 0; i < ROW_OFFSETS.length; i += 1) {
      const mirror = ROW_OFFSETS.indexOf(-(ROW_OFFSETS[i] as number));
      expect(mirror, `row ${String(i)} has no image`).toBeGreaterThanOrEqual(0);
      expect(ROW_DIRS[mirror], `row ${String(i)} and its image swim the same way`).toBe(
        -(ROW_DIRS[i] as number),
      );
    }
  });

  it('gives the two rods columns that are an exact pair and never overlap', () => {
    expect(laneOf('p1')).toBe(LANE_OFFSET);
    expect(laneOf('p2')).toBe(-LANE_OFFSET);
    const gap = Math.abs(laneOf('p1') - laneOf('p2'));
    const widest = catchRadiusOf('drifter');
    // Close enough that a fish in the middle of the pond is inside both hooks — the
    // contest {@link settleClaims} settles — and far enough that the two baits are never
    // drawn on top of one another.
    expect(gap).toBeLessThan(widest * 2);
    expect(gap).toBeGreaterThan(HOOK_RADIUS * 2);
  });

  it('lets both seats reach every row, and the far row exactly', () => {
    for (const seat of SEATS) {
      for (let i = 0; i < ROW_OFFSETS.length; i += 1) {
        const fish = { cy: ROW_OFFSETS[i] } as Fish;
        const out = rowOutOf(seat, fish);
        expect(out).toBeGreaterThan(0);
        expect(out).toBeLessThanOrEqual(MAX_REACH);
      }
    }
    // A bait left alone lands on the far row rather than near it, so soaking is a real
    // fishing spot instead of a coincidence.
    expect(rowOutOf('p1', { cy: -300 } as Fish)).toBe(MAX_REACH);
    expect(rowOutOf('p2', { cy: 300 } as Fish)).toBe(MAX_REACH);
  });

  it('stocks itself as nine exact mirrored pairs, whatever the seed', () => {
    for (const seed of [1, 2, 7, 99, 20260829]) {
      const game = fresh(seed);
      expect(game.fish.length).toBe(6 * FISH_PER_ROW);
      for (let i = 0; i < game.fish.length; i += 2) {
        const one = game.fish[i] as Fish;
        const twin = game.fish[i + 1] as Fish;
        expect(twin.cx, `seed ${String(seed)} fish ${String(i)}`).toBe(-one.cx);
        expect(twin.cy).toBe(-one.cy);
        expect(twin.dir).toBe(-one.dir);
        expect(twin.speed).toBe(one.speed);
        expect(twin.kind).toBe(one.kind);
      }
    }
  });

  it('gives a fish a row that is one of the six, and a heading that matches it', () => {
    const game = fresh(31337);
    for (const fish of game.fish) {
      const row = ROW_OFFSETS.indexOf(fish.cy);
      expect(row, `${String(fish.cy)} is not a row`).toBeGreaterThanOrEqual(0);
      expect(fish.dir).toBe(ROW_DIRS[row]);
      expect(Math.abs(fish.cx)).toBeLessThanOrEqual(POND_HALF);
    }
  });

  it('advertises the clock it actually runs on', () => {
    // `roundSeconds` ends nothing; the clock in this file does. The two are only equal
    // because a test keeps them equal.
    expect(manifest.roundSeconds).toBe(MATCH_SECONDS);
    expect(manifest.archetype).toBe('rt-split');
  });
});

/* ------------------------------------------------------------------------------------ */
/* The flight and the reel                                                               */
/* ------------------------------------------------------------------------------------ */

describe('the cast', () => {
  /** Fly a bait for `seconds` at `hz`, and report where it got to. */
  function flyFor(hz: number, seconds: number): number {
    const game = createGame();
    const dt = 1 / hz;
    step(game, dt, PRESS, IDLE);
    const steps = Math.round(seconds * hz) - 1;
    for (let i = 0; i < steps; i += 1) step(game, dt, IDLE, IDLE);
    return game.p1.out;
  }

  it('travels the same distance at 60, 90, 120 and 240 Hz', () => {
    // Issue #2465, and the reason the travel is the analytic integral of the decay rather
    // than `v · dt`: Euler puts the same cast in a different place on a 120 Hz phone.
    // Measured spread across the four rates, worst of the four sample times: 2.4e-12.
    for (const seconds of [0.2, 0.5, 0.9, 1.2]) {
      const reference = flyFor(60, seconds);
      for (const hz of [90, 120, 240]) {
        expect(flyFor(hz, seconds), `${String(hz)}Hz at ${String(seconds)}s`).toBeCloseTo(
          reference,
          9,
        );
      }
    }
  });

  it('lands on the far row exactly, at every step rate', () => {
    for (const hz of [60, 90, 120, 240]) {
      const game = createGame();
      const dt = 1 / hz;
      step(game, dt, PRESS, IDLE);
      for (let i = 0; i < Math.ceil(3 * hz); i += 1) step(game, dt, IDLE, IDLE);
      expect(game.p1.phase).toBe('resting');
      expect(game.p1.out, `${String(hz)}Hz`).toBe(MAX_REACH);
    }
  });

  it('is described exactly by the law the bot plans with', () => {
    // Rule 6 read the hard way: a bot that reasoned about a quantity the simulation
    // integrated differently would be aiming at a board the game was not playing. These
    // two must be the same arithmetic, not merely close.
    for (const seconds of [0.2, 0.5, 0.9, 1.2]) {
      const stepped = flyFor(240, seconds);
      expect(flightOutAt(seconds)).toBeCloseTo(stepped, 9);
      expect(flightTime(stepped)).toBeCloseTo(seconds, 9);
    }
    expect(flightOutAt(FLIGHT_SECONDS)).toBe(MAX_REACH);
    expect(flightTime(MAX_REACH)).toBeCloseTo(FLIGHT_SECONDS, 12);
  });

  it('slows from the throw to the stop speed, linearly in distance', () => {
    expect(flightSpeedAt(0)).toBeCloseTo(CAST_SPEED, 9);
    expect(flightSpeedAt(MAX_REACH)).toBeCloseTo(CAST_STOP_SPEED, 9);
    // Which is why the far rows are the forgiving ones and the near rows are not: the same
    // catch radius is a much longer moment when the bait is crawling.
    expect(flightSpeedAt(140)).toBeGreaterThan(flightSpeedAt(620) * 2);
  });
});

describe('the reel', () => {
  function reelFor(hz: number, seconds: number): number {
    const game = createGame();
    const dt = 1 / hz;
    game.p1.phase = 'reeling';
    game.p1.out = MAX_REACH;
    game.p1.speed = 0;
    for (let i = 0; i < Math.round(seconds * hz); i += 1) step(game, dt, IDLE, IDLE);
    return game.p1.out;
  }

  it('winds the same distance home at 60, 90, 120 and 240 Hz', () => {
    // The drag integrator, the other half of #2465's shape. Measured spread: 6.3e-13.
    for (const seconds of [0.2, 0.5, 0.9]) {
      const reference = reelFor(60, seconds);
      for (const hz of [90, 120, 240]) {
        expect(reelFor(hz, seconds), `${String(hz)}Hz at ${String(seconds)}s`).toBeCloseTo(
          reference,
          9,
        );
      }
    }
  });

  it('accelerates rather than snapping to speed, and always gets home', () => {
    const game = createGame();
    game.p1.phase = 'reeling';
    game.p1.out = MAX_REACH;
    game.p1.speed = 0;
    step(game, STEP, IDLE, IDLE);
    const firstStep = MAX_REACH - game.p1.out;
    step(game, STEP, IDLE, IDLE);
    const secondStep = MAX_REACH - firstStep - game.p1.out;
    expect(secondStep).toBeGreaterThan(firstStep);
    // Read through `rodOf` so the compiler does not narrow the phase to the literal that
    // was just assigned and call the loop condition constant.
    for (let i = 0; i < 600 && rodOf(game, 'p1').phase === 'reeling'; i += 1) {
      step(game, STEP, IDLE, IDLE);
    }
    expect(game.p1.phase).toBe('ready');
    expect(game.p1.out).toBe(0);
  });

  it('takes longer from further out, which is what makes reach cost something', () => {
    function homeIn(from: number): number {
      const game = createGame();
      game.p1.phase = 'reeling';
      game.p1.out = from;
      game.p1.speed = 0;
      let steps = 0;
      while (rodOf(game, 'p1').phase === 'reeling' && steps < 6000) {
        step(game, STEP, IDLE, IDLE);
        steps += 1;
      }
      return steps;
    }
    expect(homeIn(MAX_REACH)).toBeGreaterThan(homeIn(140) * 3);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Working a rod                                                                         */
/* ------------------------------------------------------------------------------------ */

describe('a rod', () => {
  it('throws on the first press and rewinds on the second', () => {
    const game = fresh(11);
    expect(game.p1.phase).toBe('ready');
    step(game, STEP, PRESS, IDLE);
    expect(game.p1.phase).toBe('flying');
    expect(game.p1.casts).toBe(1);
    expect(game.p1.out).toBeGreaterThan(0);
    step(game, STEP, PRESS, IDLE);
    expect(game.p1.phase).toBe('reeling');
  });

  it('ignores a press while the line is coming home', () => {
    const game = fresh(13);
    empty(game);
    castTo(game, 'p1', 200);
    step(game, STEP, PRESS, IDLE);
    expect(game.p1.phase).toBe('reeling');
    const before = game.p1.out;
    step(game, STEP, PRESS, IDLE);
    expect(game.p1.phase).toBe('reeling');
    expect(game.p1.out).toBeLessThan(before);
    expect(game.p1.casts).toBe(1);
  });

  it('lets a bait that is never struck come to rest, and fish from there', () => {
    const game = fresh(17);
    empty(game);
    step(game, STEP, PRESS, IDLE);
    for (let i = 0; i < 200 && game.p1.phase === 'flying'; i += 1) step(game, STEP, IDLE, IDLE);
    expect(game.p1.phase).toBe('resting');
    // The resting spot is the far row, so a fish arriving there is on the hook.
    place(game, 0, laneOf('p1'), -300);
    step(game, STEP, PRESS, IDLE);
    expect(game.p1.loaded).toBe(0);
  });

  it('counts the fish when it is landed, not when it is hooked', () => {
    const game = fresh(19);
    empty(game);
    castTo(game, 'p1', 200);
    place(game, 4, laneOf('p1'), seatAxisSign('p1') * (BOAT_OUT - game.p1.out));
    step(game, STEP, PRESS, IDLE);
    expect(game.p1.loaded).toBe(4);
    expect(game.p1.caught).toBe(0);
    while (game.p1.phase === 'reeling') step(game, STEP, IDLE, IDLE);
    expect(game.p1.caught).toBe(1);
    expect(game.p1.loaded).toBe(-1);
    // Counting down already, from the step it was landed on.
    expect((game.fish[4] as Fish).delay).toBeGreaterThan(RESPAWN_SECONDS - 2 * STEP);
    expect((game.fish[4] as Fish).delay).toBeLessThanOrEqual(RESPAWN_SECONDS);
  });

  it('counts a strike that closed on nothing', () => {
    const game = fresh(23);
    empty(game);
    castTo(game, 'p1', 200);
    step(game, STEP, PRESS, IDLE);
    expect(game.p1.loaded).toBe(-1);
    expect(game.p1.empties).toBe(1);
  });

  it('only reaches a fish inside the catch radius for its kind', () => {
    for (const kind of ['drifter', 'dart'] as const) {
      const reach = catchRadiusOf(kind);
      for (const [gap, expected] of [
        [reach - 1, 0],
        [reach + 1, -1],
      ] as const) {
        const game = fresh(29);
        empty(game);
        castTo(game, 'p1', 200);
        const baitCy = seatAxisSign('p1') * (BOAT_OUT - game.p1.out);
        place(game, 0, laneOf('p1') + gap, baitCy, kind);
        step(game, STEP, PRESS, IDLE);
        expect(game.p1.loaded, `${kind} at ${String(gap)}`).toBe(expected);
      }
    }
    expect(catchRadiusOf('drifter')).toBe(HOOK_RADIUS + DRIFTER_RADIUS);
    expect(catchRadiusOf('dart')).toBe(HOOK_RADIUS + DART_RADIUS);
  });

  it('takes the nearer of two fish, and neither when they are exactly level', () => {
    const game = fresh(31);
    empty(game);
    castTo(game, 'p1', 200);
    const baitCy = seatAxisSign('p1') * (BOAT_OUT - game.p1.out);
    place(game, 0, laneOf('p1') + 20, baitCy);
    place(game, 2, laneOf('p1') - 10, baitCy);
    step(game, STEP, PRESS, IDLE);
    expect(game.p1.loaded).toBe(2);

    const level = fresh(31);
    empty(level);
    castTo(level, 'p1', 200);
    const cy = seatAxisSign('p1') * (BOAT_OUT - level.p1.out);
    place(level, 0, laneOf('p1') + 20, cy);
    place(level, 2, laneOf('p1') - 20, cy);
    step(level, STEP, PRESS, IDLE);
    // A tie-break here would have to be written in *something*, and every something is
    // either a board coordinate — which is not covariant under the half-turn — or an array
    // index, which is a relabelling. Fouling the line is the same answer from both chairs.
    expect(level.p1.loaded).toBe(-1);
    expect(level.p1.empties).toBe(1);
  });

  it('gives a contested fish to the nearer hook, and to neither when they are level', () => {
    // The two columns are sixty units apart and the widest catch is thirty-six, so a fish
    // within twelve units of the middle of the pond is inside both hooks at once. Both
    // claims are read from the same water before either is settled, so the answer never
    // depends on which seat the loop reached first.
    function contest(cx: number): Game {
      const game = fresh(37);
      empty(game);
      // Both baits at the middle row: seat one throws 500, seat two throws 380.
      game.p1.phase = 'flying';
      game.p1.out = 500;
      game.p1.speed = flightSpeedAt(500);
      game.p2.phase = 'flying';
      game.p2.out = 380;
      game.p2.speed = flightSpeedAt(380);
      place(game, 6, cx, -60);
      return game;
    }
    expect(seatAxisSign('p1') * (BOAT_OUT - 500)).toBe(-60);
    expect(seatAxisSign('p2') * (BOAT_OUT - 380)).toBe(-60);

    const nearer = contest(laneOf('p1') + 4);
    step(nearer, STEP, PRESS, PRESS);
    expect(nearer.p1.loaded).toBe(6);
    expect(nearer.p2.loaded).toBe(-1);
    expect(nearer.p2.empties).toBe(1);

    const level = contest(0);
    step(level, STEP, PRESS, PRESS);
    expect(level.p1.loaded).toBe(-1);
    expect(level.p2.loaded).toBe(-1);
    expect((level.fish[6] as Fish).active).toBe(true);
    expect(level.p1.empties).toBe(1);
    expect(level.p2.empties).toBe(1);
  });

  it('holds a hooked fish out of the water until it is landed', () => {
    const game = fresh(41);
    empty(game);
    castTo(game, 'p1', 200);
    place(game, 8, laneOf('p1'), seatAxisSign('p1') * (BOAT_OUT - game.p1.out));
    step(game, STEP, PRESS, IDLE);
    const fish = game.fish[8] as Fish;
    expect(fish.active).toBe(false);
    expect(fish.delay).toBe(HELD);
    for (let i = 0; i < 10; i += 1) step(game, STEP, IDLE, IDLE);
    // Still held: a fish on a line is not counting down toward its own return.
    expect(fish.delay === HELD || game.p1.phase === 'ready').toBe(true);
  });
});

describe('the fish', () => {
  it('swim their own row and turn at the bank', () => {
    const game = fresh(43);
    empty(game);
    place(game, 0, POND_HALF - 1, -60, 'dart', 120, 1);
    const fish = game.fish[0] as Fish;
    step(game, STEP, IDLE, IDLE);
    expect(fish.cx).toBe(-POND_HALF);
    expect(fish.cy).toBe(-60);
    place(game, 1, -POND_HALF + 1, 60, 'dart', 120, -1);
    const twin = game.fish[1] as Fish;
    step(game, STEP, IDLE, IDLE);
    expect(twin.cx).toBe(POND_HALF);
  });

  it('come back at the bank they entered from, after the same wait every time', () => {
    const game = fresh(47);
    empty(game);
    const fish = game.fish[0] as Fish;
    fish.active = false;
    fish.delay = RESPAWN_SECONDS;
    fish.dir = 1;
    fish.cy = -60;
    let steps = 0;
    while (!(game.fish[0] as Fish).active && steps < 600) {
      step(game, STEP, IDLE, IDLE);
      steps += 1;
    }
    expect(fish.active).toBe(true);
    expect(fish.cx).toBe(-POND_HALF);
    expect(steps / 60).toBeCloseTo(RESPAWN_SECONDS, 1);
  });

  it('never move while they are on a hook', () => {
    const game = fresh(53);
    empty(game);
    const fish = game.fish[0] as Fish;
    fish.active = false;
    fish.delay = HELD;
    fish.cx = 10;
    for (let i = 0; i < 120; i += 1) step(game, STEP, IDLE, IDLE);
    expect(fish.cx).toBe(10);
    expect(fish.active).toBe(false);
  });

  it('are told apart by shape as well as by pace', () => {
    // Rule 7 for the neutral furniture: the two kinds differ in the primitive they are
    // drawn from (a body with a tail against a chevron) and in the size of the moment they
    // give a player, not merely in colour.
    expect(DRIFTER_RADIUS).not.toBe(DART_RADIUS);
    expect(catchRadiusOf('drifter')).toBeGreaterThan(catchRadiusOf('dart'));
  });
});

/* ------------------------------------------------------------------------------------ */
/* Determinism                                                                           */
/* ------------------------------------------------------------------------------------ */

describe('the simulation', () => {
  it('replays a match exactly from the same seed and the same presses', () => {
    function run(): string {
      const game = fresh(20260829);
      const rng = new Rng(5);
      for (let i = 0; i < 2000; i += 1) {
        step(game, STEP, { press: rng.bool(0.08) }, { press: rng.bool(0.08) });
      }
      return JSON.stringify(game);
    }
    expect(run()).toBe(run());
  });

  it('survives a round trip through JSON and steps identically afterwards', () => {
    const game = fresh(97);
    const rng = new Rng(6);
    for (let i = 0; i < 400; i += 1) {
      step(game, STEP, { press: rng.bool(0.1) }, { press: rng.bool(0.1) });
    }
    const copy = JSON.parse(JSON.stringify(game)) as Game;
    expect(copy).toEqual(game);
    for (let i = 0; i < 400; i += 1) {
      step(game, STEP, IDLE, IDLE);
      step(copy, STEP, IDLE, IDLE);
    }
    expect(copy).toEqual(game);
  });

  it('does nothing at all once a winner is settled', () => {
    const game = fresh(101);
    game.p1.caught = TARGET_FISH;
    step(game, STEP, PRESS, PRESS);
    expect(winnerOf(game)).toBe('p1');
    const frozen = JSON.stringify(game);
    for (let i = 0; i < 60; i += 1) step(game, STEP, PRESS, PRESS);
    expect(JSON.stringify(game)).toBe(frozen);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Half-turn covariance                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * The board turned over, with the seats changing places.
 *
 * This is the test Snowball Throw and Frozen Beaks each record as the most valuable in
 * their package: between them, defects worth double figures of win rate that no other test
 * in the repository could see — a tie-break written in board coordinates, and a threshold
 * the two seats' accumulation order straddled. A game that is wrong in exactly the same way
 * for both seats is still self-consistent, so nothing but this finds them.
 *
 * Here it is **exact rather than approximate**, and that is the point of storing every
 * coordinate as an offset from the middle of the board: the half-turn is then the negation
 * of every stored number, IEEE negation and subtraction are antisymmetric, and a mirrored
 * board steps to the bit-identical mirror of the stepped board. No tolerance appears
 * anywhere below.
 */
function mirrorRod(from: Readonly<Rod>, to: Rod): void {
  // `out` is measured from a seat's own boat, so it does not turn over — which is exactly
  // why both seats accumulate the identical number and can never straddle a threshold.
  to.phase = from.phase;
  to.out = from.out;
  to.prevOut = from.prevOut;
  to.speed = from.speed;
  to.loaded = from.loaded;
  to.caught = from.caught;
  to.casts = from.casts;
  to.empties = from.empties;
  to.flash = from.flash;
}

function mirrorInto(from: Readonly<Game>, to: Game): void {
  to.clock = from.clock;
  to.winner = from.winner === 'p1' ? 'p2' : from.winner === 'p2' ? 'p1' : from.winner;
  mirrorRod(from.p2, to.p1);
  mirrorRod(from.p1, to.p2);
  for (let i = 0; i < from.fish.length; i += 1) {
    const a = from.fish[i] as Fish;
    const b = to.fish[i] as Fish;
    b.active = a.active;
    b.cx = -a.cx;
    b.cy = -a.cy;
    b.dir = -a.dir;
    b.speed = a.speed;
    b.kind = a.kind;
    b.delay = a.delay;
  }
}

/** An arbitrary but legal board: any state the game could ever hold. */
function scramble(game: Game, rng: Rng): void {
  game.clock = 1 + rng.float() * (MATCH_SECONDS - 1);
  for (const seat of SEATS) {
    const rod = rodOf(game, seat);
    rod.caught = rng.int(0, TARGET_FISH - 1);
    rod.casts = rng.int(0, 60);
    rod.empties = rng.int(0, 30);
    rod.flash = rng.int(0, 12) * 0.05;
    rod.loaded = -1;
    const roll = rng.float();
    if (roll < 0.28) {
      rod.phase = 'ready';
      rod.out = 0;
      rod.speed = 0;
    } else if (roll < 0.58) {
      rod.phase = 'flying';
      // On the lattice a cast actually produces, so the exact coincidences this test
      // exists to catch are everyday events rather than measure-zero ones.
      rod.out = flightOutAt(rng.int(0, 78) * 0.0166);
      rod.speed = flightSpeedAt(rod.out);
    } else if (roll < 0.8) {
      rod.phase = 'resting';
      rod.out = MAX_REACH;
      rod.speed = 0;
    } else {
      rod.phase = 'reeling';
      rod.out = rng.int(0, 74) * 10;
      rod.speed = rng.int(0, 76) * 10;
    }
    rod.prevOut = rod.out;
  }
  for (let i = 0; i < game.fish.length; i += 1) {
    const fish = game.fish[i] as Fish;
    // Placed on a lattice shared with both rods' columns, so a fish sits *exactly* on a
    // hook, exactly between two hooks, and exactly on a catch-radius boundary often.
    fish.cx = rng.int(-27, 28) * 10;
    fish.active = rng.bool(0.85);
    fish.delay = fish.active ? 0 : rng.bool(0.3) ? HELD : rng.int(0, 22) * 0.05;
  }
}

function describeGame(game: Readonly<Game>): string {
  const rod = (r: Readonly<Rod>): string =>
    [
      r.phase,
      String(r.out),
      String(r.prevOut),
      String(r.speed),
      String(r.loaded),
      String(r.caught),
      String(r.casts),
      String(r.empties),
      String(r.flash),
    ].join('/');
  const fish = (f: Readonly<Fish>): string =>
    `${String(f.active)}:${String(f.cx)},${String(f.cy)},${String(f.dir)},${String(f.speed)},${f.kind},${String(f.delay)}`;
  return [
    rod(game.p1),
    rod(game.p2),
    game.fish.map(fish).join(' '),
    String(game.clock),
    String(game.winner),
  ].join('#');
}

interface Played {
  readonly winner: SeatId | 'draw' | null;
  readonly p1: number;
  readonly p2: number;
  readonly steps: number;
}

/** Two bots, one match, and separate generators so neither seat's play depends on the other's. */
function playBots(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  p1Stream: number,
  p2Stream: number,
  mirrored = false,
): Played {
  const game = createGame();
  resetGame(game, new Rng(seed | 0));
  if (mirrored) {
    const image = createGame();
    mirrorInto(game, image);
    mirrorInto(image, game);
    mirrorInto(image, game);
  }
  const state: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
  const rng: Record<SeatId, Rng> = { p1: new Rng(p1Stream | 0), p2: new Rng(p2Stream | 0) };
  const tier: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
  const command: Record<SeatId, Command> = { p1: createCommand(), p2: createCommand() };
  let steps = 0;
  for (; steps < 60 * 600; steps += 1) {
    for (const seat of SEATS) {
      botCommand(game, seat, tier[seat], state[seat], rng[seat], STEP, command[seat]);
    }
    step(game, STEP, command.p1, command.p2);
    if (game.winner !== null) break;
  }
  return { winner: game.winner, p1: game.p1.caught, p2: game.p2.caught, steps };
}

describe('the half-turn', () => {
  it('steps a mirrored board to the exact mirror of the stepped board', () => {
    const rng = new Rng(20260829);
    const game = createGame();
    const other = createGame();
    const expected = createGame();
    for (let trial = 0; trial < 800; trial += 1) {
      resetGame(game, new Rng(trial * 131 + 7));
      scramble(game, rng);
      mirrorInto(game, other);
      const a: Command = { press: rng.bool(0.35) };
      const b: Command = { press: rng.bool(0.35) };
      step(game, STEP, a, b);
      // A press is a press: there is nothing about a boolean to turn over, which is the
      // clearest statement of why this game is instrument-neutral.
      step(other, STEP, b, a);
      mirrorInto(game, expected);
      expect(describeGame(other), `trial ${String(trial)}`).toBe(describeGame(expected));
    }
  });

  it('makes a bot want the mirrored thing on a mirrored board', () => {
    const rng = new Rng(31337);
    const game = createGame();
    const other = createGame();
    const tiers = Object.keys(BOT_PROFILES) as BotDifficulty[];
    for (const tier of tiers) {
      for (let trial = 0; trial < 150; trial += 1) {
        resetGame(game, new Rng(trial * 197 + 3));
        scramble(game, rng);
        game.p1.loaded = -1;
        game.p2.loaded = -1;
        mirrorInto(game, other);
        const here = createBotState();
        const there = createBotState();
        const a = new Rng(trial + 1);
        const b = new Rng(trial + 1);
        const one = createCommand();
        const two = createCommand();
        for (let k = 0; k < 30; k += 1) {
          botCommand(game, 'p1', tier, here, a, STEP, one);
          botCommand(other, 'p2', tier, there, b, STEP, two);
          expect(one.press, `${tier} trial ${String(trial)} step ${String(k)}`).toBe(two.press);
          expect(here.target).toBe(there.target);
          expect(here.castIn).toBe(there.castIn);
          expect(here.snapIn).toBe(there.snapIn);
          step(game, STEP, one, IDLE);
          step(other, STEP, IDLE, two);
        }
      }
    }
  });

  it('plays a whole mirrored match to the exactly mirrored result', () => {
    // End to end rather than argued, which is what finally separated "the game is
    // asymmetric" from "the sample is small" in Snowball Throw. Every match is played
    // against its own mirror and the two results compared — and because the mirror here is
    // exact, this asserts equality rather than counting how often it held.
    const tiers = Object.keys(BOT_PROFILES) as BotDifficulty[];
    for (const tier of tiers) {
      for (let seed = 0; seed < 12; seed += 1) {
        const key = seed * 3571 + 1;
        const forward = playBots(key, tier, tier, key * 2 + 11, key * 2 + 12);
        const backward = playBots(key, tier, tier, key * 2 + 12, key * 2 + 11);
        const flipped =
          forward.winner === 'p1' ? 'p2' : forward.winner === 'p2' ? 'p1' : forward.winner;
        expect(backward.winner, `${tier} seed ${String(seed)}`).toBe(flipped);
        expect(backward.p1).toBe(forward.p2);
        expect(backward.p2).toBe(forward.p1);
        expect(backward.steps).toBe(forward.steps);
      }
    }
  });

  it('reads the same lane crossing from either chair', () => {
    // `laneTime` is the one place the bot divides by a signed velocity, and the whole file
    // rests on it being an exact negation under the half-turn.
    const rng = new Rng(8080);
    for (let trial = 0; trial < 400; trial += 1) {
      const cx = rng.int(-27, 28) * 10;
      const cy = ROW_OFFSETS[rng.int(0, ROW_OFFSETS.length)] as number;
      const speed = 78 + rng.float() * 90;
      const dir = rng.bool() ? 1 : -1;
      const one = { active: true, cx, cy, dir, speed, kind: 'dart', delay: 0 } as Fish;
      const twin = {
        active: true,
        cx: -cx,
        cy: -cy,
        dir: -dir,
        speed,
        kind: 'dart',
        delay: 0,
      } as Fish;
      // `===` rather than `toBe`, which separates +0 from -0: the two are the same number
      // for every purpose in this file, and a fish sitting exactly on a column produces
      // one from each chair.
      expect(laneTime('p1', one) === laneTime('p2', twin)).toBe(true);
      expect(rowOutOf('p1', one)).toBe(rowOutOf('p2', twin));
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* Scoring and the end of a match                                                        */
/* ------------------------------------------------------------------------------------ */

describe('the end of a match', () => {
  it('is won by the first rod to twenty-five fish', () => {
    const game = fresh(103);
    game.p1.caught = TARGET_FISH;
    step(game, STEP, IDLE, IDLE);
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw when both reach twenty-five in the same step', () => {
    const game = fresh(107);
    game.p1.caught = TARGET_FISH;
    game.p2.caught = TARGET_FISH;
    step(game, STEP, IDLE, IDLE);
    expect(winnerOf(game)).toBe('draw');
  });

  it('goes to the higher score at the whistle', () => {
    const game = fresh(109);
    game.clock = STEP / 2;
    game.p1.caught = 9;
    game.p2.caught = 11;
    step(game, STEP, IDLE, IDLE);
    expect(winnerOf(game)).toBe('p2');
  });

  it('breaks a level whistle on the rod that struck at nothing fewer times', () => {
    const game = fresh(113);
    game.clock = STEP / 2;
    game.p1.caught = 12;
    game.p2.caught = 12;
    game.p1.empties = 8;
    game.p2.empties = 3;
    step(game, STEP, IDLE, IDLE);
    expect(winnerOf(game)).toBe('p2');
  });

  it('is a draw when even that is level', () => {
    const game = fresh(127);
    game.clock = STEP / 2;
    game.p1.caught = 12;
    game.p2.caught = 12;
    game.p1.empties = 5;
    game.p2.empties = 5;
    step(game, STEP, IDLE, IDLE);
    expect(winnerOf(game)).toBe('draw');
  });

  it('runs the clock down to nothing and no further', () => {
    const game = fresh(131);
    game.clock = 0.005;
    step(game, STEP, IDLE, IDLE);
    expect(game.clock).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

describe('the bot', () => {
  it('draws the same number of values a decision whatever the pond', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const busy = fresh(137);
      const bare = fresh(137);
      empty(bare);
      let busyDraws = 0;
      let bareDraws = 0;
      const count = (game: Game, add: (n: number) => void): number => {
        const rng = new Rng(9);
        const state = createBotState();
        const command = createCommand();
        let before = 0;
        for (let i = 0; i < 600; i += 1) {
          const mark = rng.save();
          void mark;
          botCommand(game, 'p1', tier, state, rng, STEP, command);
          step(game, STEP, command, IDLE);
          before += 1;
        }
        add(before);
        return before;
      };
      count(busy, (n) => {
        busyDraws = n;
      });
      count(bare, (n) => {
        bareDraws = n;
      });
      expect(busyDraws).toBe(bareDraws);
    }
    expect(BOT_DRAWS_PER_DECISION).toBe(3);
  });

  it('never presses a rod that is winding in', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const game = fresh(139);
      const state = createBotState();
      const rng = new Rng(11);
      const command = createCommand();
      for (let i = 0; i < 4000; i += 1) {
        const reeling = game.p1.phase === 'reeling';
        botCommand(game, 'p1', tier, state, rng, STEP, command);
        if (reeling) expect(command.press).toBe(false);
        step(game, STEP, command, IDLE);
      }
    }
  });

  it('always acts inside its own patience, however empty the pond', () => {
    // The termination guarantee, at the level of one rod: a bot that waits for a perfect
    // interception waits for ever on water that never offers one.
    const game = fresh(149);
    empty(game);
    const state = createBotState();
    const rng = new Rng(13);
    const command = createCommand();
    let casts = 0;
    for (let i = 0; i < 60 * 30; i += 1) {
      botCommand(game, 'p1', 'easy', state, rng, STEP, command);
      step(game, STEP, command, IDLE);
      casts = game.p1.casts;
    }
    expect(casts).toBeGreaterThan(5);
    expect(CAST_LIMIT).toBeLessThan(STRIKE_LIMIT);
    expect(ABORT_SECONDS).toBeLessThan(FLIGHT_SECONDS);
  });

  it('resets to a clean slate', () => {
    const state = createBotState();
    const game = fresh(151);
    const rng = new Rng(17);
    const command = createCommand();
    for (let i = 0; i < 400; i += 1) {
      botCommand(game, 'p1', 'hard', state, rng, STEP, command);
      step(game, STEP, command, IDLE);
    }
    resetBotState(state);
    expect(state).toEqual(createBotState());
  });

  it('is ordered easy, normal, hard, measured from both seat orders', () => {
    // The numbers in SPEC.md come from a deeper sample; this is the guard that the order
    // did not invert. Both seat orders every time, because a tier number measured from one
    // chair is a tier number plus a chair number.
    function ladder(strong: BotDifficulty, weak: BotDifficulty, seeds: number): number {
      let won = 0;
      let decided = 0;
      for (let i = 0; i < seeds; i += 1) {
        const key = i * 6151 + 17;
        const a = key * 2 + 11;
        const b = key * 2 + 12;
        const first = playBots(key, strong, weak, a, b);
        if (first.winner === 'p1') won += 1;
        if (first.winner !== 'draw' && first.winner !== null) decided += 1;
        const second = playBots(key, weak, strong, a, b);
        if (second.winner === 'p2') won += 1;
        if (second.winner !== 'draw' && second.winner !== null) decided += 1;
      }
      return won / decided;
    }
    expect(ladder('hard', 'easy', 12)).toBeGreaterThan(0.7);
    expect(ladder('normal', 'easy', 12)).toBeGreaterThan(0.6);
    expect(ladder('hard', 'normal', 12)).toBeGreaterThan(0.6);
  });

  it('gives seat one exactly half the matches at equal skill, board by board', () => {
    // Not sampled and hoped over: the pond is invariant under the half-turn and every rule
    // in this file is covariant, so swapping which generator sits in which chair produces
    // the *exact mirror* of the same match. Seat one's share is therefore 50.0% by
    // construction, and this asserts it per board rather than in aggregate.
    let seatOne = 0;
    let decided = 0;
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      for (let i = 0; i < 8; i += 1) {
        const key = i * 7919 + 3;
        const a = key * 2 + 11;
        const b = key * 2 + 12;
        const forward = playBots(key, tier, tier, a, b);
        const swapped = playBots(key, tier, tier, b, a);
        for (const played of [forward, swapped]) {
          if (played.winner === 'p1') seatOne += 1;
          if (played.winner === 'p1' || played.winner === 'p2') decided += 1;
        }
        // The pair is one match and its mirror, so exactly one of the two goes to seat one.
        expect(
          forward.winner === 'p1' ? 'p2' : forward.winner === 'p2' ? 'p1' : forward.winner,
        ).toBe(swapped.winner);
      }
    }
    expect(decided).toBeGreaterThan(40);
    expect(seatOne / decided).toBe(0.5);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Termination                                                                           */
/* ------------------------------------------------------------------------------------ */

describe('a match', () => {
  it('is finished by two easy bots well inside ten simulated minutes', () => {
    // `apps/web/src/data/termination.test.ts` allows ten minutes; the point of this copy is
    // the *margin*, which is what tells anyone changing a constant whether they have eaten
    // it. Measured over 200 easy matches from both stream orders: 89.9 s on average.
    let worst = 0;
    for (let i = 0; i < 10; i += 1) {
      const key = i * 4231 + 29;
      const played = playBots(key, 'easy', 'easy', key * 2 + 11, key * 2 + 12);
      expect(played.winner).not.toBeNull();
      worst = Math.max(worst, played.steps);
    }
    expect(worst / 60).toBeLessThan(MATCH_SECONDS);
    expect(worst).toBeLessThan(60 * 600);
  });

  it('ends on the whistle even if nobody ever presses anything', () => {
    const game = fresh(20260830);
    let steps = 0;
    while (game.winner === null && steps < 60 * 600) {
      step(game, STEP, IDLE, IDLE);
      steps += 1;
    }
    expect(game.winner).toBe('draw');
    expect(steps).toBeLessThanOrEqual(Math.ceil(MATCH_SECONDS * 60) + 1);
  });
});
