import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { manifest } from './manifest.js';
import {
  BIRD_RADIUS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_PROFILES,
  DUNK_COST,
  DUNK_SECONDS,
  FISH_CLEAR,
  FISH_ON_ICE,
  GLIDE_RATE,
  HEADINGS,
  HOLE_COUNT,
  HOLE_RADIUS,
  MATCH_SECONDS,
  PICKUP_RADIUS,
  REACH,
  WALK_PROBE,
  RESPAWN_SECONDS,
  SEATS,
  SPAWN_SPOTS,
  STOP_SPEED,
  TARGET_FISH,
  TIERS,
  WALK_SPEED,
  botStep,
  chooseHeading,
  clamp,
  createBotState,
  createCommand,
  createGame,
  floeOf,
  holeAlong,
  homeX,
  homeY,
  maxX,
  maxY,
  minX,
  minY,
  plantFeet,
  resetBotState,
  rimAlong,
  resetGame,
  seatAxisSign,
  step,
  tierFor,
  wantsRelease,
  winnerOf,
} from './rules.js';
import type {
  Bird,
  BotDifficulty,
  BotProfile,
  BotState,
  Command,
  Fish,
  Floe,
  Game,
  Hole,
  Spot,
  Tier,
} from './rules.js';

const STEP = 1 / 60;

function still(): Command {
  return { dirX: 0, dirY: 0 };
}

function walk(dx: number, dy: number): Command {
  if (dx !== 0 && dy !== 0) return { dirX: dx * Math.SQRT1_2, dirY: dy * Math.SQRT1_2 };
  return { dirX: dx, dirY: dy };
}

/** Push a game into a state a test wants without going through several seconds of play. */
function clearIce(game: Game): void {
  for (const seat of SEATS) {
    const floe = floeOf(game, seat);
    for (let i = 0; i < floe.holes.length; i += 1) {
      const hole = floe.holes[i] as Hole;
      hole.x = -10_000;
      hole.y = -10_000;
    }
    for (let i = 0; i < floe.fish.length; i += 1) {
      const fish = floe.fish[i] as Fish;
      fish.active = false;
      fish.delay = 1e9;
    }
  }
}

function fresh(seed: number | null = null): Game {
  const game = createGame();
  if (seed !== null) resetGame(game, new Rng(seed));
  return game;
}

/* ------------------------------------------------------------------------------------ */
/* The board                                                                             */
/* ------------------------------------------------------------------------------------ */

describe('the two floes', () => {
  it('are half-turn images of one another', () => {
    expect(minX() + maxX()).toBe(BOARD_WIDTH);
    expect(minY('p1') + maxY('p2')).toBe(BOARD_HEIGHT);
    expect(maxY('p1') + minY('p2')).toBe(BOARD_HEIGHT);
    expect(homeX() * 2).toBe(BOARD_WIDTH);
    expect(homeY('p1') + homeY('p2')).toBe(BOARD_HEIGHT);
  });

  it('lay out the same course on both, mirrored, whatever the seed', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const game = fresh(seed * 977 + 3);
      for (let i = 0; i < HOLE_COUNT; i += 1) {
        const a = game.p1.holes[i] as Hole;
        const b = game.p2.holes[i] as Hole;
        expect(a.x + b.x).toBeCloseTo(BOARD_WIDTH, 9);
        expect(a.y + b.y).toBeCloseTo(BOARD_HEIGHT, 9);
      }
      for (let i = 0; i < FISH_ON_ICE; i += 1) {
        const a = game.p1.fish[i] as Fish;
        const b = game.p2.fish[i] as Fish;
        expect(a.active).toBe(b.active);
        expect(a.x + b.x).toBeCloseTo(BOARD_WIDTH, 9);
        expect(a.y + b.y).toBeCloseTo(BOARD_HEIGHT, 9);
      }
    }
  });

  it('never overlaps two holes, and never puts a bird in one at the start', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const game = fresh(seed * 7717 + 11);
      for (let i = 0; i < HOLE_COUNT; i += 1) {
        const a = game.p1.holes[i] as Hole;
        expect(Math.hypot(a.x - homeX(), a.y - homeY('p1'))).toBeGreaterThan(HOLE_RADIUS + 40);
        // Fully on the ice, so no hole is half in the sea where it cannot be read.
        expect(a.x - HOLE_RADIUS).toBeGreaterThan(0);
        expect(a.x + HOLE_RADIUS).toBeLessThan(BOARD_WIDTH);
        for (let j = i + 1; j < HOLE_COUNT; j += 1) {
          const b = game.p1.holes[j] as Hole;
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * HOLE_RADIUS);
        }
      }
    }
  });

  it('spawns every fish far enough from a hole to be taken dry', () => {
    let tight = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const game = fresh(seed * 613 + 5);
      for (let k = 0; k < SPAWN_SPOTS; k += 1) {
        const spot = game.spots[k] as Spot;
        let nearest = Infinity;
        for (let i = 0; i < HOLE_COUNT; i += 1) {
          const hole = game.p1.holes[i] as Hole;
          nearest = Math.min(nearest, Math.hypot(spot.x - hole.x, spot.y - hole.y));
        }
        // A bird standing PICKUP_RADIUS from the fish on the far side must still be
        // outside the rim, or the fish would be bait rather than food.
        expect(nearest - PICKUP_RADIUS).toBeGreaterThan(HOLE_RADIUS);
        if (nearest < FISH_CLEAR) tight += 1;
      }
    }
    // The rejection loop settles for its best candidate rather than looping for ever, and
    // this records how often it has to. It is a fact about the placement, not a threshold.
    expect(tight).toBeLessThan(60 * SPAWN_SPOTS * 0.02);
  });

  it('keeps a bird inside its own floe however it is driven', () => {
    const game = fresh(4242);
    const rng = new Rng(99);
    for (let i = 0; i < 6000; i += 1) {
      const a = walk(rng.int(-1, 2), rng.int(-1, 2));
      const b = walk(rng.int(-1, 2), rng.int(-1, 2));
      step(game, STEP, a, b);
      if (game.winner !== null) resetGame(game, new Rng(i));
      for (const seat of SEATS) {
        const bird = floeOf(game, seat).bird;
        if (bird.phase === 'dunk') continue;
        expect(bird.x).toBeGreaterThanOrEqual(minX());
        expect(bird.x).toBeLessThanOrEqual(maxX());
        expect(bird.y).toBeGreaterThanOrEqual(minY(seat));
        expect(bird.y).toBeLessThanOrEqual(maxY(seat));
      }
    }
  });

  it('advertises the same round length its own clock uses', () => {
    // `roundSeconds` ends nothing — it is text on a catalogue card — so the two numbers
    // are only ever equal because somebody keeps them equal.
    expect(manifest.roundSeconds).toBe(MATCH_SECONDS);
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The wind-up                                                                           */
/* ------------------------------------------------------------------------------------ */

describe('the wind-up', () => {
  it('reads as three tiers with wide plateaus', () => {
    expect(tierFor(0)).toBe(-1);
    expect(tierFor((TIERS[0] as Tier).windUp - 1e-9)).toBe(-1);
    expect(tierFor((TIERS[0] as Tier).windUp)).toBe(0);
    expect(tierFor((TIERS[1] as Tier).windUp)).toBe(1);
    expect(tierFor((TIERS[2] as Tier).windUp)).toBe(2);
    expect(tierFor(99)).toBe(2);
    // The plateaus are what make input latency irrelevant: a player releases inside the
    // tier they want, not at its edge. Thirty milliseconds is under 7% of the narrowest.
    for (let i = 1; i < TIERS.length; i += 1) {
      const width = (TIERS[i] as Tier).windUp - (TIERS[i - 1] as Tier).windUp;
      expect(width).toBeGreaterThan(0.4);
      expect(0.03 / width).toBeLessThan(0.08);
    }
  });

  it('throws nothing away when a walk stops short of the first tier', () => {
    const game = fresh(7);
    clearIce(game);
    const bird = game.p1.bird;
    const startX = bird.x;
    for (let i = 0; i < 10; i += 1) step(game, STEP, walk(1, 0), still());
    expect(bird.charge).toBeCloseTo(10 * STEP, 12);
    step(game, STEP, still(), still());
    expect(bird.phase).toBe('walk');
    expect(bird.slides).toBe(0);
    expect(bird.charge).toBe(0);
    expect(bird.x - startX).toBeCloseTo(10 * STEP * WALK_SPEED, 9);
  });

  it('counts the wind-up in steps rather than deriving it from anything', () => {
    // The regression Snowball Throw's ball age records: a quantity recovered from a
    // position accumulates differently for the two seats and lands on opposite sides of
    // a hard threshold. Counting from zero gives both seats the identical sequence.
    const game = fresh(11);
    clearIce(game);
    for (let i = 0; i < 120; i += 1) {
      step(game, STEP, walk(1, 0), walk(0, 1));
      expect(game.p1.bird.charge).toBe(game.p2.bird.charge);
    }
  });

  it('cannot be spent more than twice a second, whichever instrument spends it', () => {
    // `docs/input-idiom.md`: a game is same-input-class-only when winning needs more than
    // about two committing presses a second. The floor here is one wind-up plus one whole
    // slide, because a slide reads no input at all.
    const slideSeconds = Math.log((TIERS[0] as Tier).launch / STOP_SPEED) / GLIDE_RATE;
    const cadence = 1 / ((TIERS[0] as Tier).windUp + slideSeconds);
    expect(cadence).toBeLessThan(2);
    expect(cadence).toBeCloseTo(0.76, 2);
  });

  it('is planted rather than spent when the shell pauses', () => {
    const game = fresh(13);
    clearIce(game);
    for (let i = 0; i < 60; i += 1) step(game, STEP, walk(1, 0), walk(1, 0));
    expect(tierFor(game.p1.bird.charge)).toBeGreaterThanOrEqual(0);
    plantFeet(game, 'p1');
    plantFeet(game, 'p2');
    // The pause clears every key and pointer, which arrives as a standstill next step.
    step(game, STEP, still(), still());
    expect(game.p1.bird.phase).toBe('walk');
    expect(game.p2.bird.phase).toBe('walk');
    expect(game.p1.bird.slides).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The slide                                                                             */
/* ------------------------------------------------------------------------------------ */

/** Put a bird at `(x, y)` with a full tier packed, pointed along `(dx, dy)`. */
function armed(
  game: Game,
  seat: SeatId,
  tier: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
): Bird {
  const bird = floeOf(game, seat).bird;
  bird.x = x;
  bird.y = y;
  bird.prevX = x;
  bird.prevY = y;
  bird.phase = 'walk';
  bird.charge = (TIERS[tier] as Tier).windUp;
  bird.lastDirX = dx;
  bird.lastDirY = dy;
  return bird;
}

function slideOut(game: Game, dt: number, cap = 200_000): number {
  let steps = 0;
  while (game.p1.bird.phase === 'slide' || steps === 0) {
    step(game, dt, still(), still());
    steps += 1;
    if (steps > cap) throw new Error('slide never stopped');
  }
  return steps;
}

describe('the slide', () => {
  it('ends at the same coordinate at 60, 90, 120 and 240 Hz', () => {
    // The defect commit b4af006 found in five games: a game that steps `x += v*dt` and
    // then decays disagrees with its own closed form by `dt*rate/2` — 1.9% at 60 Hz here
    // — so the same slide is a different slide on a 120 Hz phone, and the bot, which
    // plans every release against REACH, is aiming at a board the game is not playing.
    const startX = minX();
    for (let tier = 0; tier < TIERS.length; tier += 1) {
      const ends: number[] = [];
      for (const hz of [60, 90, 120, 240]) {
        const game = fresh(3);
        clearIce(game);
        armed(game, 'p1', tier, startX, homeY('p1'), 1, 0);
        slideOut(game, 1 / hz);
        ends.push(game.p1.bird.x);
      }
      const first = ends[0] as number;
      for (const end of ends) expect(end).toBeCloseTo(first, 9);
      // And the distance is exactly the one the bot plans with.
      expect(first - startX).toBeCloseTo(REACH[tier] as number, 9);
    }
  });

  it('travels the analytic distance rather than the Euler one', () => {
    // Written out so the size of the error that is being avoided is on the record.
    const tier = 1;
    const launch = (TIERS[tier] as Tier).launch;
    let euler = 0;
    let speed = launch;
    while (speed > STOP_SPEED) {
      euler += speed * STEP;
      speed *= Math.pow(0.1, STEP);
    }
    const exact = REACH[tier] as number;
    expect(euler / exact - 1).toBeGreaterThan(0.015);
    expect(euler / exact - 1).toBeLessThan(0.025);
  });

  it('leaves along the heading walked on the step before the release, not the release step', () => {
    // `docs/input-idiom.md` fact 2: the pointer is already null on the step that reports
    // the lift, so a heading read on the release step is a standstill for a finger and a
    // direction for a key. Carrying the previous step's heading makes the two identical.
    const game = fresh(17);
    clearIce(game);
    for (let i = 0; i < 60; i += 1) step(game, STEP, walk(0, -1), still());
    step(game, STEP, still(), still());
    expect(game.p1.bird.phase).toBe('slide');
    expect(game.p1.bird.slideX).toBe(0);
    expect(game.p1.bird.slideY).toBe(-1);
  });

  it('stops dead at the rim instead of bouncing', () => {
    const game = fresh(19);
    clearIce(game);
    const bird = armed(game, 'p1', 2, maxX() - 40, homeY('p1'), 1, 0);
    slideOut(game, STEP);
    expect(bird.x).toBeCloseTo(maxX(), 9);
    expect(bird.phase).toBe('walk');
    expect(bird.speed).toBe(0);
  });

  it('reads no input at all once it is away', () => {
    const game = fresh(23);
    clearIce(game);
    const bird = armed(game, 'p1', 1, homeX(), homeY('p1'), -1, 0);
    step(game, STEP, still(), still());
    expect(bird.phase).toBe('slide');
    const before = bird.x;
    for (let i = 0; i < 10; i += 1) step(game, STEP, walk(1, 0), still());
    expect(bird.x).toBeLessThan(before);
    expect(bird.charge).toBe(0);
  });

  it('cannot skate over a hole, even at three times the fastest tier', () => {
    // Swept, never sampled: a tier-two slide covers 17 units in a 60 Hz step and a rim is
    // a line with no thickness, so a static test at the two ends of a step would let a
    // bird cross one. Fired here at 5000 units a second on a 30 Hz step: 167 units a
    // step, against an 80-unit hole.
    const game = fresh(29);
    clearIce(game);
    const bird = game.p1.bird;
    const hole = game.p1.holes[0] as Hole;
    hole.x = minX() + 300;
    hole.y = homeY('p1');
    bird.x = minX();
    bird.y = homeY('p1');
    bird.prevX = bird.x;
    bird.prevY = bird.y;
    bird.phase = 'slide';
    bird.speed = 5000;
    bird.slideX = 1;
    bird.slideY = 0;
    const sliding = (): boolean => game.p1.bird.phase === 'slide';
    for (let i = 0; i < 40 && sliding(); i += 1) step(game, 1 / 30, still(), still());
    expect(game.p1.bird.phase).toBe('dunk');
  });
});

/* ------------------------------------------------------------------------------------ */
/* Fish and holes                                                                        */
/* ------------------------------------------------------------------------------------ */

describe('fish and holes', () => {
  it('takes every fish a slide passes over', () => {
    const game = fresh(31);
    clearIce(game);
    const bird = game.p1.bird;
    const y = homeY('p1');
    for (let i = 0; i < 3; i += 1) {
      const fish = game.p1.fish[i] as Fish;
      fish.active = true;
      fish.x = minX() + 60 + i * 90;
      fish.y = y;
      fish.delay = 0;
    }
    armed(game, 'p1', 1, minX(), y, 1, 0);
    slideOut(game, STEP);
    expect(bird.caught).toBe(3);
  });

  it('sends a bird into the water when its centre crosses a rim', () => {
    const game = fresh(37);
    clearIce(game);
    const bird = game.p1.bird;
    const hole = game.p1.holes[0] as Hole;
    hole.x = homeX() + 120;
    hole.y = homeY('p1');
    bird.caught = 5;
    armed(game, 'p1', 0, homeX(), homeY('p1'), 1, 0);
    slideOut(game, STEP, 400);
    expect(bird.phase).toBe('dunk');
    expect(bird.dunks).toBe(1);
    expect(bird.caught).toBe(5 - DUNK_COST);
    // The rule and the drawn circle are the same circle.
    expect(Math.hypot(bird.x - hole.x, bird.y - hole.y)).toBeCloseTo(HOLE_RADIUS, 6);
    for (let i = 0; i < Math.ceil(DUNK_SECONDS / STEP) + 1; i += 1) {
      step(game, STEP, still(), still());
    }
    expect(bird.phase).toBe('walk');
    expect(bird.x).toBe(homeX());
    expect(bird.y).toBe(homeY('p1'));
  });

  it('never takes a score below nothing', () => {
    const game = fresh(41);
    clearIce(game);
    const bird = game.p1.bird;
    const hole = game.p1.holes[0] as Hole;
    hole.x = homeX() + 120;
    hole.y = homeY('p1');
    bird.caught = 1;
    armed(game, 'p1', 0, homeX(), homeY('p1'), 1, 0);
    slideOut(game, STEP, 400);
    expect(bird.caught).toBe(0);
  });

  it('surfaces a replacement after the delay, on the next point of the cycle', () => {
    const game = fresh(43);
    const floe = game.p1;
    const before = floe.cursor;
    const fish = floe.fish[0] as Fish;
    const bird = floe.bird;
    for (let i = 1; i < floe.fish.length; i += 1) {
      const other = floe.fish[i] as Fish;
      other.active = false;
      other.delay = 1e9;
    }
    bird.x = fish.x;
    bird.y = fish.y;
    bird.prevX = bird.x;
    bird.prevY = bird.y;
    step(game, STEP, walk(1, 0), still());
    expect(fish.active).toBe(false);
    expect(bird.caught).toBe(1);
    for (let i = 0; i < Math.ceil(RESPAWN_SECONDS / STEP) + 1; i += 1) {
      step(game, STEP, still(), still());
    }
    expect(fish.active).toBe(true);
    expect(floe.cursor).toBe((before + 1) % SPAWN_SPOTS);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Determinism                                                                           */
/* ------------------------------------------------------------------------------------ */

describe('determinism', () => {
  it('replays an input trace to the identical final state', () => {
    const script = new Rng(4242);
    const trace: [Command, Command][] = [];
    for (let i = 0; i < 3000; i += 1) {
      trace.push([
        walk(script.int(-1, 2), script.int(-1, 2)),
        walk(script.int(-1, 2), script.int(-1, 2)),
      ]);
    }
    const once = fresh(555);
    const twice = fresh(555);
    for (const [a, b] of trace) step(once, STEP, a, b);
    for (const [a, b] of trace) step(twice, STEP, a, b);
    expect(twice).toEqual(once);
    expect(once.p1.bird.slides + once.p2.bird.slides).toBeGreaterThan(10);
  });

  it('serialises and restores exactly', () => {
    const game = fresh(606);
    const rng = new Rng(7);
    const cmd = { p1: createCommand(), p2: createCommand() };
    const state = { p1: createBotState(), p2: createBotState() };
    for (let i = 0; i < 900; i += 1) {
      botStep(game, 'p1', BOT_PROFILES.normal, state.p1, rng, STEP, cmd.p1);
      botStep(game, 'p2', BOT_PROFILES.normal, state.p2, rng, STEP, cmd.p2);
      step(game, STEP, cmd.p1, cmd.p2);
    }
    const copy = JSON.parse(JSON.stringify(game)) as Game;
    expect(copy).toEqual(game);
    const plain = walk(1, 1);
    for (let i = 0; i < 400; i += 1) {
      step(game, STEP, plain, plain);
      step(copy, STEP, plain, plain);
    }
    expect(copy).toEqual(game);
  });

  it('gives a bot the identical stream whichever seat is polled first', () => {
    const forward = playBots(90210, 'hard', 'easy', false);
    const reversed = playBots(90210, 'hard', 'easy', true);
    expect(reversed).toEqual(forward);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Half-turn covariance                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * The board turned over, with the seats changing places.
 *
 * This is the test Snowball Throw's SPEC records as the most valuable in its package:
 * two defects, each worth double figures of win rate to seat one, that no other test in
 * the repository could see — a tie-break written in board coordinates, and a threshold
 * that the two seats' accumulation order straddled. A game that is wrong in exactly the
 * same way for both seats is still self-consistent, so nothing but this finds them.
 */
function mirrorBird(from: Readonly<Bird>, to: Bird): void {
  to.x = BOARD_WIDTH - from.x;
  to.y = BOARD_HEIGHT - from.y;
  to.prevX = BOARD_WIDTH - from.prevX;
  to.prevY = BOARD_HEIGHT - from.prevY;
  to.phase = from.phase;
  to.lastDirX = -from.lastDirX;
  to.lastDirY = -from.lastDirY;
  to.charge = from.charge;
  to.speed = from.speed;
  to.slideX = -from.slideX;
  to.slideY = -from.slideY;
  to.dunk = from.dunk;
  to.dunkX = BOARD_WIDTH - from.dunkX;
  to.dunkY = BOARD_HEIGHT - from.dunkY;
  to.caught = from.caught;
  to.dunks = from.dunks;
  to.slides = from.slides;
  to.flash = from.flash;
}

function mirrorFloe(from: Readonly<Floe>, to: Floe): void {
  to.cursor = from.cursor;
  mirrorBird(from.bird, to.bird);
  for (let i = 0; i < from.holes.length; i += 1) {
    const a = from.holes[i] as Hole;
    const b = to.holes[i] as Hole;
    b.x = BOARD_WIDTH - a.x;
    b.y = BOARD_HEIGHT - a.y;
  }
  for (let i = 0; i < from.fish.length; i += 1) {
    const a = from.fish[i] as Fish;
    const b = to.fish[i] as Fish;
    b.active = a.active;
    b.delay = a.delay;
    b.x = BOARD_WIDTH - a.x;
    b.y = BOARD_HEIGHT - a.y;
  }
}

function mirrorInto(from: Readonly<Game>, to: Game): void {
  to.clock = from.clock;
  to.winner = from.winner === 'p1' ? 'p2' : from.winner === 'p2' ? 'p1' : from.winner;
  // The spawn cycle is written in seat one's frame and read by each seat through its own
  // half-turn, so turning the board over leaves the list itself alone.
  for (let i = 0; i < from.spots.length; i += 1) {
    const a = from.spots[i] as Spot;
    const b = to.spots[i] as Spot;
    b.x = a.x;
    b.y = a.y;
  }
  mirrorFloe(from.p2, to.p1);
  mirrorFloe(from.p1, to.p2);
}

/** Everything a step can touch, to six decimals. Slot order is meaningful and compared. */
function describeGame(game: Readonly<Game>): string {
  const six = (v: number): string => v.toFixed(6);
  const bird = (b: Readonly<Bird>): string =>
    [
      six(b.x),
      six(b.y),
      six(b.prevX),
      six(b.prevY),
      b.phase,
      six(b.lastDirX),
      six(b.lastDirY),
      six(b.charge),
      six(b.speed),
      six(b.slideX),
      six(b.slideY),
      six(b.dunk),
      six(b.dunkX),
      six(b.dunkY),
      String(b.caught),
      String(b.dunks),
      String(b.slides),
      six(b.flash),
    ].join('/');
  const floe = (f: Readonly<Floe>): string =>
    [
      bird(f.bird),
      String(f.cursor),
      f.holes.map((h) => `${six(h.x)},${six(h.y)}`).join(' '),
      f.fish.map((h) => `${String(h.active)}:${six(h.x)},${six(h.y)},${six(h.delay)}`).join(' '),
    ].join('|');
  return [floe(game.p1), floe(game.p2), six(game.clock), String(game.winner)].join('#');
}

/** An arbitrary but legal board: any state the game could ever hold. */
function scramble(game: Game, rng: Rng): void {
  game.clock = 1 + rng.float() * (MATCH_SECONDS - 1);
  for (const seat of SEATS) {
    const floe = floeOf(game, seat);
    const bird = floe.bird;
    const sign = seatAxisSign(seat);
    // On the two-unit lattice an axis-aligned walk actually produces, so that the exact
    // ties this test exists to catch are everyday events rather than measure-zero ones.
    bird.x = clamp(homeX() + rng.int(-130, 131) * 2, minX(), maxX());
    bird.y = clamp(homeY(seat) - sign * rng.int(0, 190) * 2, minY(seat), maxY(seat));
    bird.prevX = bird.x;
    bird.prevY = bird.y;
    const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
    bird.lastDirX = heading.x * sign;
    bird.lastDirY = heading.y * sign;
    bird.charge = rng.int(0, 44) * 0.05;
    bird.caught = rng.int(0, TARGET_FISH - 1);
    bird.dunks = rng.int(0, 7);
    bird.slides = rng.int(0, 40);
    bird.flash = rng.int(0, 20) * 0.05;
    floe.cursor = rng.int(0, SPAWN_SPOTS);
    const roll = rng.float();
    if (roll < 0.15) {
      bird.phase = 'dunk';
      bird.dunk = rng.int(1, 33) * 0.05;
      bird.speed = 0;
      bird.dunkX = bird.x;
      bird.dunkY = bird.y;
    } else if (roll < 0.5) {
      bird.phase = 'slide';
      bird.dunk = 0;
      const tier = TIERS[rng.int(0, TIERS.length)] as Tier;
      bird.speed = tier.launch * (0.25 + rng.int(0, 16) * 0.05);
      bird.slideX = bird.lastDirX;
      bird.slideY = bird.lastDirY;
    } else {
      bird.phase = 'walk';
      bird.dunk = 0;
      bird.speed = 0;
    }
    for (let i = 0; i < floe.fish.length; i += 1) {
      const fish = floe.fish[i] as Fish;
      fish.active = rng.bool(0.8);
      fish.delay = fish.active ? 0 : rng.int(0, 20) * 0.05;
      fish.x = clamp(homeX() + rng.int(-130, 131) * 2, minX(), maxX());
      fish.y = clamp(homeY(seat) - sign * rng.int(0, 190) * 2, minY(seat), maxY(seat));
    }
  }
}

function randomHeading(rng: Rng, seat: SeatId): Command {
  if (rng.bool(0.2)) return still();
  const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
  const sign = seatAxisSign(seat);
  return { dirX: heading.x * sign, dirY: heading.y * sign };
}

describe('the half-turn', () => {
  it('steps a mirrored board to the mirror of the stepped board', () => {
    const rng = new Rng(20260829);
    const game = createGame();
    const other = createGame();
    const expected = createGame();
    for (let trial = 0; trial < 500; trial += 1) {
      resetGame(game, new Rng(trial * 131 + 7));
      scramble(game, rng);
      mirrorInto(game, other);
      const a = randomHeading(rng, 'p1');
      const b = randomHeading(rng, 'p2');
      step(game, STEP, a, b);
      step(other, STEP, { dirX: -b.dirX, dirY: -b.dirY }, { dirX: -a.dirX, dirY: -a.dirY });
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
      const profile = BOT_PROFILES[tier];
      for (let trial = 0; trial < 400; trial += 1) {
        resetGame(game, new Rng(trial * 197 + 3));
        scramble(game, rng);
        mirrorInto(game, other);
        const here = createBotState();
        const there = createBotState();
        here.capTier = rng.int(0, TIERS.length);
        there.capTier = here.capTier;
        here.blundering = rng.bool(0.2);
        there.blundering = here.blundering;

        chooseHeading(game, 'p1', profile, here);
        chooseHeading(other, 'p2', profile, there);
        expect(here.wantX, `${tier} trial ${String(trial)} x`).toBeCloseTo(-there.wantX, 12);
        expect(here.wantY, `${tier} trial ${String(trial)} y`).toBeCloseTo(-there.wantY, 12);
        expect(wantsRelease(game, 'p1', profile, here), `${tier} trial ${String(trial)}`).toBe(
          wantsRelease(other, 'p2', profile, there),
        );
      }
    }
  });

  it('gives two mirror-image birds a bit-identical wind-up', () => {
    // The knife edge Snowball Throw's ball age fell off: `charge` is compared against a
    // threshold written in hundredths of a second, and a charge is a whole number of
    // frames, so values land on it exactly. Counting rather than deriving is what makes
    // both seats land on the same side of it.
    const game = fresh(8080);
    clearIce(game);
    for (let i = 0; i < 400; i += 1) {
      step(game, STEP, walk(1, -1), walk(-1, 1));
      expect(game.p1.bird.charge).toBe(game.p2.bird.charge);
      expect(game.p1.bird.speed).toBe(game.p2.bird.speed);
      expect(game.p1.bird.phase).toBe(game.p2.bird.phase);
    }
  });

  it('plays a whole mirrored match to the mirrored result', () => {
    // End to end rather than argued, which is what finally separated "the game is
    // asymmetric" from "the sample is small" in Snowball Throw. Every match is played
    // against its own mirror and the two winners compared.
    let flipped = 0;
    let mismatched = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const forward = playBots(seed * 3571 + 1, 'hard', 'hard', false);
      const backward = playBots(seed * 3571 + 1, 'hard', 'hard', false, true);
      const expectedWinner =
        forward.winner === 'p1' ? 'p2' : forward.winner === 'p2' ? 'p1' : forward.winner;
      if (backward.winner !== expectedWinner) flipped += 1;
      if (backward.p1 !== forward.p2 || backward.p2 !== forward.p1) mismatched += 1;
    }
    expect(flipped).toBe(0);
    // A bird's position still accumulates from opposite ends of the board and always
    // will, so a match can in principle still part company on the last bits of some
    // comparison. Measured over 900 mirrored matches, three tiers: **no winner ever
    // flipped and one scoreline in nine hundred differed.** Before the dunk fix in
    // `chooseHeading` it was 24 in 60.
    expect(mismatched).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Scoring and the end of a match                                                        */
/* ------------------------------------------------------------------------------------ */

describe('the end of a match', () => {
  it('is won by the first bird to thirty fish', () => {
    const game = fresh(101);
    game.p1.bird.caught = TARGET_FISH;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw when both reach thirty in the same step', () => {
    const game = fresh(103);
    game.p1.bird.caught = TARGET_FISH;
    game.p2.bird.caught = TARGET_FISH;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('draw');
  });

  it('goes to the higher score at the whistle', () => {
    const game = fresh(107);
    game.clock = STEP / 2;
    game.p1.bird.caught = 9;
    game.p2.bird.caught = 11;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('p2');
  });

  it('breaks a level whistle on the bird that fell in fewer times', () => {
    const game = fresh(109);
    game.clock = STEP / 2;
    game.p1.bird.caught = 12;
    game.p2.bird.caught = 12;
    game.p1.bird.dunks = 2;
    game.p2.bird.dunks = 5;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw when neither the score nor the dunks separate them', () => {
    const game = fresh(113);
    game.clock = STEP / 2;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('draw');
  });

  it('ends even when nobody ever moves, with no step cap at all', () => {
    // No cap on purpose: a match that could not finish should hang this suite rather than
    // pass quietly. `roundSeconds` ends nothing, so the clock in rules.ts is the whole
    // guarantee.
    const game = fresh(127);
    let steps = 0;
    while (winnerOf(game) === null) {
      step(game, STEP, still(), still());
      steps += 1;
    }
    expect(winnerOf(game)).toBe('draw');
    // 5400 or 5401: the clock is 90 accumulated down by a sixtieth at a time and the last
    // step lands a couple of ulps either side of nothing. It ends on the step the clock
    // says, which is the property; the ulp is not.
    expect(steps).toBeGreaterThanOrEqual(Math.ceil(MATCH_SECONDS / STEP));
    expect(steps).toBeLessThanOrEqual(Math.ceil(MATCH_SECONDS / STEP) + 1);
  });

  it('freezes once it is decided', () => {
    const game = fresh(131);
    game.p1.bird.caught = TARGET_FISH;
    step(game, STEP, still(), still());
    const after = describeGame(game);
    for (let i = 0; i < 100; i += 1) step(game, STEP, walk(1, 1), walk(1, 1));
    expect(describeGame(game)).toBe(after);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

interface Played {
  winner: SeatId | 'draw' | null;
  steps: number;
  p1: number;
  p2: number;
  dunks: number;
  slides: number;
}

/**
 * One bot-against-bot match, driven through the shipped rules exactly as `game.ts` drives
 * them: one seed, a generator for the ice and one per seat.
 */
function playBots(
  seed: number,
  a: BotDifficulty | BotProfile,
  b: BotDifficulty | BotProfile,
  reversePolling = false,
  swapSeats = false,
): Played {
  const game = createGame();
  const root = new Rng(seed);
  resetGame(game, new Rng(root.next() | 0));
  const first = new Rng(root.next() | 0);
  const second = new Rng(root.next() | 0);
  const rng: Record<SeatId, Rng> = swapSeats
    ? { p1: second, p2: first }
    : { p1: first, p2: second };
  const profile: Record<SeatId, BotProfile> = {
    p1: typeof a === 'string' ? BOT_PROFILES[a] : a,
    p2: typeof b === 'string' ? BOT_PROFILES[b] : b,
  };
  if (swapSeats) {
    const swap = profile.p1;
    profile.p1 = profile.p2;
    profile.p2 = swap;
  }
  const state: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
  const cmd: Record<SeatId, Command> = { p1: createCommand(), p2: createCommand() };
  const order: SeatId[] = reversePolling ? ['p2', 'p1'] : ['p1', 'p2'];
  const cap = Math.ceil((MATCH_SECONDS + 2) / STEP);
  for (let i = 0; i < cap; i += 1) {
    for (const seat of order) {
      botStep(game, seat, profile[seat], state[seat], rng[seat], STEP, cmd[seat]);
    }
    step(game, STEP, cmd.p1, cmd.p2);
    if (game.winner !== null) {
      return {
        winner: game.winner,
        steps: i + 1,
        p1: game.p1.bird.caught,
        p2: game.p2.bird.caught,
        dunks: game.p1.bird.dunks + game.p2.bird.dunks,
        slides: game.p1.bird.slides + game.p2.bird.slides,
      };
    }
  }
  return {
    winner: null,
    steps: cap,
    p1: game.p1.bird.caught,
    p2: game.p2.bird.caught,
    dunks: game.p1.bird.dunks + game.p2.bird.dunks,
    slides: game.p1.bird.slides + game.p2.bird.slides,
  };
}

function ladder(a: BotDifficulty, b: BotDifficulty, seeds: number): number {
  let strong = 0;
  let decided = 0;
  for (let s = 0; s < seeds; s += 1) {
    for (const swap of [false, true]) {
      const out = playBots(2000 + s * 7919, a, b, false, swap);
      if (out.winner === null || out.winner === 'draw') continue;
      decided += 1;
      // With the seats swapped the stronger profile is sitting in seat two.
      const strongSeat: SeatId = swap ? 'p2' : 'p1';
      if (out.winner === strongSeat) strong += 1;
    }
  }
  return decided === 0 ? NaN : strong / decided;
}

describe('the bot', () => {
  it('draws the same number of values whatever the ice looks like', () => {
    // A generator whose position depended on the board would make one seat's play a
    // function of the tier sitting opposite. Three draws a decision, taken before any
    // branch, is what stops it — and two very different boards must leave the two
    // generators in the identical state after the same number of steps.
    const quiet = new Rng(5);
    const busy = new Rng(5);
    const boards = [fresh(211), fresh(919)];
    const generators = [quiet, busy];
    for (let b = 0; b < 2; b += 1) {
      const game = boards[b] as Game;
      const rng = generators[b] as Rng;
      const state = createBotState();
      const out = createCommand();
      for (let i = 0; i < 1800; i += 1) {
        botStep(game, 'p1', BOT_PROFILES.hard, state, rng, STEP, out);
        step(game, STEP, out, still());
        if (game.winner !== null) resetGame(game, new Rng(i));
      }
    }
    expect(quiet.save()).toEqual(busy.save());
  });

  it('never walks knowingly into a hole or off the ice', () => {
    const game = fresh(223);
    const state = createBotState();
    const out = createCommand();
    const rng = new Rng(3);
    const scrambleRng = new Rng(17);
    for (let trial = 0; trial < 400; trial += 1) {
      scramble(game, scrambleRng);
      const bird = game.p1.bird;
      bird.phase = 'walk';
      bird.speed = 0;
      resetBotState(state);
      botStep(game, 'p1', BOT_PROFILES.hard, state, rng, STEP, out);
      if (state.blundering) continue;
      if (state.wantX === 0 && state.wantY === 0) continue;
      const roomAlong = (dx: number, dy: number): number =>
        Math.min(
          rimAlong('p1', bird.x, bird.y, dx, dy),
          holeAlong(game.p1, bird.x, bird.y, dx, dy),
        );
      // Either it has room, or every heading was cramped and it took the roomiest.
      if (roomAlong(state.wantX, state.wantY) >= WALK_PROBE) continue;
      let best = 0;
      for (const heading of HEADINGS) {
        best = Math.max(best, roomAlong(heading.x, heading.y));
      }
      expect(best, `trial ${String(trial)}`).toBeLessThan(WALK_PROBE);
    }
  });

  it('climbs the ladder in both seat orders', () => {
    const normalOverEasy = ladder('normal', 'easy', 90);
    const hardOverNormal = ladder('hard', 'normal', 90);
    const hardOverEasy = ladder('hard', 'easy', 90);
    expect(normalOverEasy).toBeGreaterThan(0.6);
    expect(hardOverNormal).toBeGreaterThan(0.55);
    expect(hardOverEasy).toBeGreaterThan(normalOverEasy);
    expect(hardOverEasy).toBeGreaterThan(hardOverNormal);
  });

  it('keeps neither seat inside a match it should not have', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      let p1 = 0;
      let decided = 0;
      for (let s = 0; s < 120; s += 1) {
        for (const swap of [false, true]) {
          const out = playBots(4000 + s * 6151, tier, tier, false, swap);
          if (out.winner === null || out.winner === 'draw') continue;
          decided += 1;
          if (out.winner === 'p1') p1 += 1;
        }
      }
      const share = p1 / decided;
      expect(share, `${tier} seat one share ${(share * 100).toFixed(1)}%`).toBeGreaterThan(0.42);
      expect(share, `${tier} seat one share ${(share * 100).toFixed(1)}%`).toBeLessThan(0.58);
    }
  });

  it('finishes every match, at every pairing, well inside the clock', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const a of tiers) {
      for (const b of tiers) {
        for (let s = 0; s < 12; s += 1) {
          const out = playBots(6000 + s * 811, a, b);
          expect(out.winner, `${a} v ${b} seed ${String(s)}`).not.toBeNull();
        }
      }
    }
  });

  it('gets to thirty fish rather than limping to the whistle', () => {
    let reached = 0;
    const total = 120;
    for (let s = 0; s < total; s += 1) {
      const out = playBots(8000 + s * 2357, 'easy', 'easy');
      if (out.p1 >= TARGET_FISH || out.p2 >= TARGET_FISH) reached += 1;
    }
    expect(reached / total).toBeGreaterThan(0.9);
  });

  it('slides well under the cadence its fairness argument claims', () => {
    let slides = 0;
    let seconds = 0;
    for (let s = 0; s < 40; s += 1) {
      const out = playBots(9000 + s * 401, 'hard', 'hard');
      slides += out.slides;
      seconds += out.steps * STEP * 2;
    }
    expect(slides / seconds).toBeLessThan(0.8);
  });

  it('falls in less often the better it is', () => {
    const dunksAt = (tier: BotDifficulty): number => {
      let dunks = 0;
      for (let s = 0; s < 60; s += 1) dunks += playBots(11_000 + s * 787, tier, tier).dunks;
      return dunks / 60;
    };
    const easy = dunksAt('easy');
    const hard = dunksAt('hard');
    expect(hard).toBeLessThan(easy);
  });

  it('cannot walk anywhere a person could not, or faster', () => {
    // Rule 6, checked rather than asserted: every heading a bot emits is one of the nine
    // a human's keys or finger produce, and the walk is the same WALK_SPEED.
    const game = fresh(307);
    const state = createBotState();
    const out = createCommand();
    const rng = new Rng(23);
    const legal = new Set<string>(['0,0']);
    for (const heading of HEADINGS) {
      for (const sign of [1, -1]) {
        legal.add(`${(heading.x * sign).toFixed(12)},${(heading.y * sign).toFixed(12)}`);
      }
    }
    for (let i = 0; i < 4000; i += 1) {
      botStep(game, 'p1', BOT_PROFILES.hard, state, rng, STEP, out);
      const key =
        out.dirX === 0 && out.dirY === 0
          ? '0,0'
          : `${out.dirX.toFixed(12)},${out.dirY.toFixed(12)}`;
      expect(legal.has(key), `illegal heading ${key}`).toBe(true);
      expect(Math.hypot(out.dirX, out.dirY)).toBeLessThanOrEqual(1 + 1e-12);
      step(game, STEP, out, still());
      if (game.winner !== null) resetGame(game, new Rng(i));
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* Allocation                                                                            */
/* ------------------------------------------------------------------------------------ */

describe('the step', () => {
  it('holds its shape: no array or object grows over a whole match', () => {
    const game = fresh(401);
    const before = JSON.stringify(game).length;
    const rng = new Rng(3);
    const cmd = { p1: createCommand(), p2: createCommand() };
    const state = { p1: createBotState(), p2: createBotState() };
    for (let i = 0; i < 4000; i += 1) {
      botStep(game, 'p1', BOT_PROFILES.hard, state.p1, rng, STEP, cmd.p1);
      botStep(game, 'p2', BOT_PROFILES.hard, state.p2, rng, STEP, cmd.p2);
      step(game, STEP, cmd.p1, cmd.p2);
    }
    expect(game.spots.length).toBe(SPAWN_SPOTS);
    expect(game.p1.fish.length).toBe(FISH_ON_ICE);
    expect(game.p1.holes.length).toBe(HOLE_COUNT);
    // The state is a fixed set of records rewritten in place, so its serialised size only
    // moves by the digits in it — never by a pool that grew.
    expect(JSON.stringify(game).length).toBeLessThan(before * 1.2);
  });

  it('keeps every drawn quantity inside the declared box', () => {
    const game = fresh(409);
    const rng = new Rng(5);
    const cmd = { p1: createCommand(), p2: createCommand() };
    const state = { p1: createBotState(), p2: createBotState() };
    for (let i = 0; i < 3000; i += 1) {
      botStep(game, 'p1', BOT_PROFILES.normal, state.p1, rng, STEP, cmd.p1);
      botStep(game, 'p2', BOT_PROFILES.normal, state.p2, rng, STEP, cmd.p2);
      step(game, STEP, cmd.p1, cmd.p2);
      for (const seat of SEATS) {
        const floe = floeOf(game, seat);
        for (const fish of floe.fish) {
          if (!fish.active) continue;
          expect(fish.x).toBeGreaterThan(0);
          expect(fish.x).toBeLessThan(BOARD_WIDTH);
          expect(fish.y).toBeGreaterThan(0);
          expect(fish.y).toBeLessThan(BOARD_HEIGHT);
        }
        const bird = floe.bird;
        expect(bird.x + BIRD_RADIUS).toBeLessThanOrEqual(BOARD_WIDTH);
        expect(bird.y + BIRD_RADIUS).toBeLessThanOrEqual(BOARD_HEIGHT);
      }
      if (game.winner !== null) resetGame(game, new Rng(i));
    }
  });
});
