import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  CATCH_RADIUS,
  CENTRE_Y,
  CORAL_COUNT,
  CORAL_RADIUS,
  CROSSOVER_SECONDS,
  ESCAPE_ROOM,
  HEADINGS,
  LAGOON_DIAGONAL,
  LAGOON_HEIGHT,
  LAGOON_WIDTH,
  MATCH_SECONDS,
  MAX_X,
  MAX_Y,
  MIN_X,
  MIN_Y,
  MOVE_DEADZONE,
  PIRANHA_BASE,
  PIRANHA_COUNT,
  PIRANHA_RADIUS,
  PIRANHA_RAMP,
  SCORE_UNIT,
  SEATS,
  SNAG_RADIUS,
  SNAG_SECONDS,
  START_X,
  START_Y,
  SWIM_RADIUS,
  SWIM_SPEED,
  botStep,
  chooseHeading,
  clamp,
  coralAlong,
  createBotState,
  createCommand,
  createGame,
  crossesCoral,
  lagoonOf,
  lengthsOf,
  nearestPiranha,
  otherOf,
  piranhaSpeed,
  resetBotState,
  resetGame,
  rimAlong,
  seatAxisSign,
  step,
  survivalOf,
  terminationBoundSeconds,
  toBoardX,
  toBoardY,
  winnerOf,
} from './rules.js';
import type {
  BotDifficulty,
  BotProfile,
  Command,
  Coral,
  Game,
  Lagoon,
  Piranha,
  Swimmer,
} from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function still(): Command {
  return { dirX: 0, dirY: 0 };
}

/** The command a player's keys or finger produce for a compass direction. */
function swim(dx: number, dy: number): Command {
  if (dx !== 0 && dy !== 0) return { dirX: dx * Math.SQRT1_2, dirY: dy * Math.SQRT1_2 };
  return { dirX: dx, dirY: dy };
}

function fresh(seed: number | null = null): Game {
  const game = createGame();
  if (seed !== null) resetGame(game, new Rng(seed));
  return game;
}

/** Push the reef out of the way when a test is about something else. */
function clearReef(game: Game): void {
  for (let i = 0; i < game.corals.length; i += 1) {
    const coral = game.corals[i] as Coral;
    coral.x = -100_000;
    coral.y = -100_000;
  }
}

/** Push the shoal out of the way when a test is about something else. */
function callOffShoal(lagoon: Lagoon): void {
  for (let i = 0; i < lagoon.piranhas.length; i += 1) {
    const piranha = lagoon.piranhas[i] as Piranha;
    piranha.x = -100_000;
    piranha.y = -100_000;
    piranha.prevX = piranha.x;
    piranha.prevY = piranha.y;
  }
}

function callOffEverything(game: Game): void {
  clearReef(game);
  callOffShoal(game.p1);
  callOffShoal(game.p2);
}

/* ------------------------------------------------------------------------------------ */
/* The one frame both seats live in                                                      */
/* ------------------------------------------------------------------------------------ */

describe('the two lagoons', () => {
  it('are one lagoon in the simulation, placed twice on the device', () => {
    const game = fresh(11);
    // There is no second reef to drift from the first: `corals` is one list and both seats
    // read it. That is the whole "both seats face the same hazards" argument, and it is a
    // property of the type rather than a measurement.
    expect(game.corals).toHaveLength(CORAL_COUNT);
    expect(game.p1.swimmer.x).toBe(game.p2.swimmer.x);
    expect(game.p1.swimmer.y).toBe(game.p2.swimmer.y);
    for (let i = 0; i < PIRANHA_COUNT; i += 1) {
      const a = game.p1.piranhas[i] as Piranha;
      const b = game.p2.piranhas[i] as Piranha;
      expect(a.x).toBe(b.x);
      expect(a.y).toBe(b.y);
    }
  });

  it('lands both seats on exactly the same rim values under the half-turn', () => {
    // The Frozen Beaks defect family: a threshold a state variable lands on *exactly* by
    // construction. Written as `BOARD - (offset + local)` rather than as a rotation, the
    // two seats' rims come out exactly equal in floating point as well as in arithmetic.
    expect(toBoardX('p1', 0)).toBe(20);
    expect(toBoardX('p2', LAGOON_WIDTH)).toBe(20);
    expect(toBoardX('p1', LAGOON_WIDTH)).toBe(BOARD_WIDTH - 20);
    expect(toBoardX('p2', 0)).toBe(BOARD_WIDTH - 20);
    expect(toBoardY('p1', 0)).toBe(CENTRE_Y + 10);
    expect(toBoardY('p2', LAGOON_HEIGHT)).toBe(20);
    expect(toBoardY('p1', LAGOON_HEIGHT)).toBe(BOARD_HEIGHT - 20);
    expect(toBoardY('p2', 0)).toBe(CENTRE_Y - 10);
  });

  it('places seat two exactly where the half-turn of seat one puts it', () => {
    const rng = new Rng(4242);
    for (let i = 0; i < 400; i += 1) {
      const x = rng.float() * LAGOON_WIDTH;
      const y = rng.float() * LAGOON_HEIGHT;
      expect(toBoardX('p2', x)).toBe(BOARD_WIDTH - toBoardX('p1', x));
      expect(toBoardY('p2', y)).toBe(BOARD_HEIGHT - toBoardY('p1', y));
    }
  });

  it('keeps every seat inside its own half of the device', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 400; i += 1) {
      const y = rng.float() * LAGOON_HEIGHT;
      expect(toBoardY('p1', y)).toBeGreaterThan(CENTRE_Y);
      expect(toBoardY('p2', y)).toBeLessThan(CENTRE_Y);
    }
  });

  it('gives the two seats opposite axis signs and nothing else', () => {
    expect(seatAxisSign('p1')).toBe(1);
    expect(seatAxisSign('p2')).toBe(-1);
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

/* ------------------------------------------------------------------------------------ */
/* The reef                                                                              */
/* ------------------------------------------------------------------------------------ */

describe('the reef', () => {
  it('always leaves every gap swimmable, over 300 seeds', () => {
    // The jittered grid's whole point: clearance is guaranteed by arithmetic rather than by
    // a rejection loop that might not converge. Two heads 100 apart leave exactly enough
    // water for a swimmer to pass, so this is the claim that the reef never seals itself.
    const game = createGame();
    let closest = Infinity;
    let nearestRim = Infinity;
    for (let seed = 0; seed < 300; seed += 1) {
      resetGame(game, new Rng(seed * 977 + 13));
      expect(game.corals).toHaveLength(CORAL_COUNT);
      for (let i = 0; i < game.corals.length; i += 1) {
        const a = game.corals[i] as Coral;
        expect(a.x).toBeGreaterThan(CORAL_RADIUS);
        expect(a.x).toBeLessThan(LAGOON_WIDTH - CORAL_RADIUS);
        expect(a.y).toBeGreaterThan(CORAL_RADIUS);
        expect(a.y).toBeLessThan(LAGOON_HEIGHT - CORAL_RADIUS);
        nearestRim = Math.min(nearestRim, a.x, a.y, LAGOON_WIDTH - a.x, LAGOON_HEIGHT - a.y);
        for (let j = i + 1; j < game.corals.length; j += 1) {
          const b = game.corals[j] as Coral;
          closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
        }
      }
    }
    // Two heads this far apart leave `closest - 2 * CORAL_RADIUS` of open water, and a
    // swimmer needs `2 * SWIM_RADIUS` of it.
    expect(closest).toBeGreaterThanOrEqual(2 * CORAL_RADIUS + 2 * SWIM_RADIUS);
    expect(nearestRim).toBeGreaterThanOrEqual(CORAL_RADIUS + 2 * SWIM_RADIUS);
  });

  it('never puts a head where a swimmer starts', () => {
    const game = createGame();
    for (let seed = 0; seed < 300; seed += 1) {
      resetGame(game, new Rng(seed * 613 + 5));
      expect(crossesCoral(game.corals, START_X, START_Y, 0, 0)).toBe(false);
      for (let i = 0; i < game.corals.length; i += 1) {
        const coral = game.corals[i] as Coral;
        expect(Math.hypot(coral.x - START_X, coral.y - START_Y)).toBeGreaterThan(SNAG_RADIUS);
      }
    }
  });

  it('draws the same number of values whichever cells it skips', () => {
    // A generator whose consumption varies with the board is how two seats stop being able
    // to share one seed. Two layouts from the same seed leave the stream in the same place.
    for (let seed = 0; seed < 60; seed += 1) {
      const a = new Rng(seed * 31 + 1);
      const b = new Rng(seed * 31 + 1);
      const one = createGame();
      const two = createGame();
      resetGame(one, a);
      resetGame(two, b);
      expect(a.float()).toBe(b.float());
      for (let i = 0; i < CORAL_COUNT; i += 1) {
        expect((one.corals[i] as Coral).x).toBe((two.corals[i] as Coral).x);
      }
    }
  });

  it('hands back a real, playable reef before anybody has a seed', () => {
    // `createGame()` is used by tests, by the balance harness and by `game.ts` before
    // `init`, so the golden-ratio fallback has to produce a legal board, not a pile at
    // the origin.
    const game = createGame();
    for (let i = 0; i < game.corals.length; i += 1) {
      const a = game.corals[i] as Coral;
      for (let j = i + 1; j < game.corals.length; j += 1) {
        const b = game.corals[j] as Coral;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * CORAL_RADIUS);
      }
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* Swimming                                                                              */
/* ------------------------------------------------------------------------------------ */

describe('a swimmer', () => {
  it('swims at one speed whichever of the eight ways it goes', () => {
    for (let i = 0; i < HEADINGS.length; i += 1) {
      const heading = HEADINGS[i] as { readonly x: number; readonly y: number };
      const game = fresh(3);
      callOffEverything(game);
      const before = game.p1.swimmer.distance;
      step(game, STEP, { dirX: heading.x, dirY: heading.y }, still());
      const moved = game.p1.swimmer.distance - before;
      expect(moved).toBeCloseTo(SWIM_SPEED * STEP, 9);
    }
  });

  it('scores nothing at all while treading water', () => {
    const game = fresh(3);
    callOffEverything(game);
    for (let i = 0; i < 600; i += 1) step(game, STEP, still(), still());
    expect(game.p1.swimmer.distance).toBe(0);
    expect(lengthsOf(game.p1)).toBe(0);
  });

  it('never leaves its own lagoon however it is driven', () => {
    const rng = new Rng(777);
    const game = fresh(21);
    for (let i = 0; i < 6000; i += 1) {
      const a = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
      const b = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
      step(game, STEP, { dirX: a.x, dirY: a.y }, { dirX: b.x, dirY: b.y });
      for (const seat of SEATS) {
        const swimmer = lagoonOf(game, seat).swimmer;
        expect(swimmer.x).toBeGreaterThanOrEqual(MIN_X);
        expect(swimmer.x).toBeLessThanOrEqual(MAX_X);
        expect(swimmer.y).toBeGreaterThanOrEqual(MIN_Y);
        expect(swimmer.y).toBeLessThanOrEqual(MAX_Y);
        // And never *inside* a coral head, which would be a swimmer that could never move
        // again: every move out of one is refused for the same reason it got in.
        if (swimmer.snag === 0) {
          expect(crossesCoral(game.corals, swimmer.x, swimmer.y, 0, 0)).toBe(false);
        }
      }
      if (game.winner !== null) resetGame(game, new Rng(i));
    }
  });

  it('is stopped dead by a coral head rather than sliding along it', () => {
    const game = fresh(3);
    callOffEverything(game);
    const coral = game.corals[0] as Coral;
    coral.x = START_X + SNAG_RADIUS + 1;
    coral.y = START_Y;
    const swimmer = game.p1.swimmer;
    step(game, STEP, swim(1, 0), still());
    // Refused outright: the swimmer does not end up sitting *on* the rim at exactly
    // SNAG_RADIUS, which is the threshold the next step's inside-test compares against.
    expect(swimmer.x).toBe(START_X);
    expect(swimmer.y).toBe(START_Y);
    expect(swimmer.distance).toBe(0);
    expect(swimmer.snags).toBe(1);
    // The whole half-second is still owed: the step that hits the coral spends none of it.
    expect(swimmer.snag).toBe(SNAG_SECONDS);
  });

  it('sits out the whole snag and scores nothing during it', () => {
    const game = fresh(3);
    callOffEverything(game);
    const coral = game.corals[0] as Coral;
    coral.x = START_X + SNAG_RADIUS + 1;
    coral.y = START_Y;
    const swimmer = game.p1.swimmer;
    step(game, STEP, swim(1, 0), still());
    const frozen = swimmer.snags;
    let held = 0;
    while (swimmer.snag > 0) {
      step(game, STEP, swim(-1, 0), still());
      held += 1;
      expect(swimmer.distance).toBe(0);
    }
    // 31 frames rather than 30, because half a second is not a whole number of sixtieths
    // and the residue costs one more step. Both seats pay it identically, which is the
    // thing that matters; a test that pinned the count would be pinning the step rate.
    expect(Math.abs(held * STEP - SNAG_SECONDS)).toBeLessThanOrEqual(STEP);
    expect(swimmer.snags).toBe(frozen);
    // And it swims again the moment the snag clears.
    step(game, STEP, swim(-1, 0), still());
    expect(swimmer.x).toBeCloseTo(START_X - SWIM_SPEED * STEP, 9);
  });

  it('cannot skate through a coral head, even at forty times swimming pace', () => {
    // Swept rather than sampled at the endpoints. Nothing can tunnel at today's speeds;
    // the point of a closed-form test is that it stays true when somebody doubles one.
    const corals: Coral[] = [{ x: 300, y: 235 }];
    expect(crossesCoral(corals, 100, 235, 400, 0)).toBe(true);
    expect(crossesCoral(corals, 100, 235, 0, 0)).toBe(false);
    // A pass that clears the head by a unit is not a snag.
    expect(crossesCoral(corals, 100, 235 - SNAG_RADIUS - 1, 400, 0)).toBe(false);
  });

  it('plans against exactly the reef it steps: coralAlong agrees with crossesCoral', () => {
    // Issue #2465's shape: a bot that reasons analytically about a quantity the simulation
    // integrates numerically must agree with it exactly, or it is aiming at a different
    // board from the one it is standing on.
    const rng = new Rng(5150);
    const game = createGame();
    for (let trial = 0; trial < 2000; trial += 1) {
      resetGame(game, new Rng(trial * 89 + 3));
      const x = MIN_X + rng.float() * (MAX_X - MIN_X);
      const y = MIN_Y + rng.float() * (MAX_Y - MIN_Y);
      const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
      const reach = coralAlong(game.corals, x, y, heading.x, heading.y);
      const travel = rng.float() * 300;
      const hits = crossesCoral(game.corals, x, y, heading.x * travel, heading.y * travel);
      // A step that stops short of the analytic hit must not snag, and one that goes past
      // it must. The one unit of slack is for the tangent case, where the two are the same
      // number and floating point may put them either side of it.
      if (travel < reach - 1) expect(hits, `trial ${String(trial)} short`).toBe(false);
      if (travel > reach + 1) expect(hits, `trial ${String(trial)} long`).toBe(true);
    }
  });

  it('measures the rim the same way the clamp does', () => {
    const rng = new Rng(606);
    for (let trial = 0; trial < 2000; trial += 1) {
      const x = MIN_X + rng.float() * (MAX_X - MIN_X);
      const y = MIN_Y + rng.float() * (MAX_Y - MIN_Y);
      const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
      const reach = rimAlong(x, y, heading.x, heading.y);
      expect(reach).toBeGreaterThanOrEqual(0);
      const at = reach + 0.001;
      expect(
        clamp(x + heading.x * at, MIN_X, MAX_X) !== x + heading.x * at ||
          clamp(y + heading.y * at, MIN_Y, MAX_Y) !== y + heading.y * at,
      ).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* The shoal, and why the match must end                                                 */
/* ------------------------------------------------------------------------------------ */

describe('the shoal', () => {
  it('speeds up as a function of elapsed time and nothing else', () => {
    expect(piranhaSpeed(0)).toBe(PIRANHA_BASE);
    expect(piranhaSpeed(10)).toBeCloseTo(PIRANHA_BASE + PIRANHA_RAMP * 10, 9);
    expect(piranhaSpeed(CROSSOVER_SECONDS)).toBeCloseTo(SWIM_SPEED, 9);
    expect(CROSSOVER_SECONDS).toBeGreaterThan(0);
  });

  it('is pure pursuit: straight at the swimmer, capped at the gap', () => {
    const game = fresh(3);
    clearReef(game);
    const lagoon = game.p1;
    const piranha = lagoon.piranhas[0] as Piranha;
    piranha.x = 100;
    piranha.y = 100;
    for (let i = 1; i < lagoon.piranhas.length; i += 1) {
      const other = lagoon.piranhas[i] as Piranha;
      other.x = -100_000;
      other.y = -100_000;
    }
    const before = Math.hypot(lagoon.swimmer.x - piranha.x, lagoon.swimmer.y - piranha.y);
    step(game, STEP, still(), still());
    const after = Math.hypot(lagoon.swimmer.x - piranha.x, lagoon.swimmer.y - piranha.y);
    expect(before - after).toBeCloseTo(piranhaSpeed(0) * STEP, 9);
  });

  it('never overshoots a swimmer it has reached', () => {
    const game = fresh(3);
    clearReef(game);
    const lagoon = game.p1;
    const piranha = lagoon.piranhas[0] as Piranha;
    piranha.x = lagoon.swimmer.x + 0.1;
    piranha.y = lagoon.swimmer.y;
    step(game, STEP, still(), still());
    expect(piranha.x).toBe(lagoon.swimmer.x);
    expect(piranha.y).toBe(lagoon.swimmer.y);
    expect(lagoon.swimmer.alive).toBe(false);
  });

  it('closes the gap by at least the arithmetic the termination bound assumes', () => {
    // The premise of `terminationBoundSeconds`, checked against the code rather than
    // argued: on every step, whatever anybody does, the gap obeys
    // `d' <= d + (SWIM_SPEED - piranhaSpeed(t)) * dt`.
    const rng = new Rng(2718);
    const game = fresh(64);
    for (let i = 0; i < 4000; i += 1) {
      if (game.winner !== null) resetGame(game, new Rng(i));
      const before = nearestPiranha(game.p1, game.p1.swimmer.x, game.p1.swimmer.y);
      const speed = piranhaSpeed(game.elapsed);
      const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
      const alive = game.p1.swimmer.alive;
      step(game, STEP, { dirX: heading.x, dirY: heading.y }, still());
      if (!alive) continue;
      const after = nearestPiranha(game.p1, game.p1.swimmer.x, game.p1.swimmer.y);
      expect(after).toBeLessThanOrEqual(before + (SWIM_SPEED - speed) * STEP + 1e-9);
    }
  });

  it('swims through coral, which is what keeps the bound true', () => {
    const game = fresh(3);
    const lagoon = game.p1;
    const coral = game.corals[0] as Coral;
    const piranha = lagoon.piranhas[0] as Piranha;
    // Park a head exactly between a piranha and the swimmer.
    piranha.x = 60;
    piranha.y = START_Y;
    coral.x = (60 + START_X) / 2;
    coral.y = START_Y;
    const before = piranha.x;
    for (let i = 0; i < 60; i += 1) step(game, STEP, still(), still());
    expect(piranha.x).toBeGreaterThan(before);
    // It went *through* the head rather than around it: still on the line it started on.
    expect(piranha.y).toBeCloseTo(START_Y, 9);
  });
});

describe('termination', () => {
  it('puts the closed-form bound under the round length the card advertises', () => {
    for (const rate of [15, 30, 60, 120, 240]) {
      const bound = terminationBoundSeconds(1 / rate);
      expect(bound, `${String(rate)} Hz`).toBeLessThan(manifest.roundSeconds);
      expect(bound, `${String(rate)} Hz`).toBeLessThan(MATCH_SECONDS);
    }
    // The bound is the guarantee; the clock is a backstop well above it.
    expect(MATCH_SECONDS).toBeGreaterThan(terminationBoundSeconds(STEP) + 25);
    expect(LAGOON_DIAGONAL).toBeGreaterThan(CATCH_RADIUS);
  });

  it('ends inside the bound whatever either player does, with no step cap at all', () => {
    // No `for (let i = 0; i < N; i += 1)` anywhere in here on purpose: a game that could
    // not finish should hang this suite rather than pass quietly with a large enough cap.
    const rng = new Rng(31415);
    const drivers: readonly [string, (n: number) => Command][] = [
      ['never moves', () => still()],
      ['always north', () => swim(0, -1)],
      ['hides in a corner', () => swim(-1, -1)],
      [
        'random',
        () => {
          const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
          return { dirX: heading.x, dirY: heading.y };
        },
      ],
      ['oscillates', (n) => (n % 2 === 0 ? swim(1, 0) : swim(-1, 0))],
    ];
    for (const rate of [30, 60, 144]) {
      const dt = 1 / rate;
      const bound = terminationBoundSeconds(dt);
      for (const [label, drive] of drivers) {
        for (let seed = 0; seed < 8; seed += 1) {
          const game = fresh(seed * 71 + 3);
          let n = 0;
          while (game.winner === null) {
            step(game, dt, drive(n), drive(n + 1));
            n += 1;
          }
          expect(game.elapsed, `${label} at ${String(rate)} Hz, seed ${String(seed)}`).toBeLessThan(
            bound + dt,
          );
          expect(game.clock).toBeGreaterThan(0);
        }
      }
    }
  });

  it('two easy bots finish, and never anywhere near the ten-minute ceiling', () => {
    let worst = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const played = playBots(seed * 5701 + 11, 'easy', 'easy');
      expect(played.winner).not.toBeNull();
      worst = Math.max(worst, played.seconds);
    }
    expect(worst).toBeLessThan(terminationBoundSeconds(STEP));
    expect(worst).toBeLessThan(60 * 10);
  });

  it('never once lets the backstop clock decide a match', () => {
    let byClock = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 60; seed += 1) {
        const played = playBots(seed * 3607 + 7, tier, tier);
        if (played.clock <= 0) byClock += 1;
      }
    }
    expect(byClock).toBe(0);
  });

  it('still ends on the clock if the shoal is somehow removed', () => {
    // The backstop, exercised directly, because a branch nothing ever reaches is a branch
    // nobody knows works.
    const game = fresh(3);
    callOffEverything(game);
    let n = 0;
    while (game.winner === null) {
      step(game, 0.25, swim(1, 0), swim(1, 0));
      n += 1;
    }
    expect(game.clock).toBe(0);
    expect(n).toBe(MATCH_SECONDS / 0.25);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The half-turn: the seats are the same arithmetic, and that is asserted                */
/* ------------------------------------------------------------------------------------ */

/** Everything a step can touch in one lagoon, to twelve decimals. Slot order is compared. */
function describeLagoon(lagoon: Readonly<Lagoon>): string {
  const twelve = (v: number): string => v.toFixed(12);
  const swimmer = lagoon.swimmer;
  return [
    twelve(swimmer.x),
    twelve(swimmer.y),
    twelve(swimmer.prevX),
    twelve(swimmer.prevY),
    twelve(swimmer.dirX),
    twelve(swimmer.dirY),
    twelve(swimmer.snag),
    twelve(swimmer.distance),
    String(swimmer.snags),
    String(swimmer.alive),
    twelve(swimmer.diedAt),
    twelve(swimmer.flash),
    lagoon.piranhas
      .map((p) => `${twelve(p.x)},${twelve(p.y)},${twelve(p.prevX)},${twelve(p.prevY)}`)
      .join(' '),
  ].join('|');
}

function describeGame(game: Readonly<Game>): string {
  return [
    describeLagoon(game.p1),
    describeLagoon(game.p2),
    game.corals.map((c) => `${c.x.toFixed(12)},${c.y.toFixed(12)}`).join(' '),
    game.elapsed.toFixed(12),
    game.clock.toFixed(12),
    String(game.winner),
  ].join('#');
}

function copySwimmer(from: Readonly<Swimmer>, to: Swimmer): void {
  to.x = from.x;
  to.y = from.y;
  to.prevX = from.prevX;
  to.prevY = from.prevY;
  to.dirX = from.dirX;
  to.dirY = from.dirY;
  to.snag = from.snag;
  to.distance = from.distance;
  to.snags = from.snags;
  to.alive = from.alive;
  to.diedAt = from.diedAt;
  to.flash = from.flash;
}

function copyLagoon(from: Readonly<Lagoon>, to: Lagoon): void {
  copySwimmer(from.swimmer, to.swimmer);
  for (let i = 0; i < from.piranhas.length; i += 1) {
    const a = from.piranhas[i] as Piranha;
    const b = to.piranhas[i] as Piranha;
    b.x = a.x;
    b.y = a.y;
    b.prevX = a.prevX;
    b.prevY = a.prevY;
  }
}

/**
 * The half-turn, as this game spells it: **swap the seats**.
 *
 * There is no coordinate mirror to apply, and that is the point. Both lagoons are the same
 * 560 × 470 box read through two different placements, so turning the device over is
 * exchanging which seat is which and nothing else. A rule that failed to be covariant here
 * would have to be a rule that reads the seat's *name*.
 */
function swapInto(from: Readonly<Game>, to: Game): void {
  copyLagoon(from.p2, to.p1);
  copyLagoon(from.p1, to.p2);
  for (let i = 0; i < from.corals.length; i += 1) {
    const a = from.corals[i] as Coral;
    const b = to.corals[i] as Coral;
    b.x = a.x;
    b.y = a.y;
  }
  to.elapsed = from.elapsed;
  to.clock = from.clock;
  to.winner = from.winner === 'p1' ? 'p2' : from.winner === 'p2' ? 'p1' : from.winner;
}

/**
 * An arbitrary but legal board: any state the game could ever hold.
 *
 * Positions are put on the lattice an axis-aligned swim actually produces, so that the
 * exact ties this file exists to catch are everyday events in the sample rather than
 * measure-zero ones — and several of them are pinned *against a rim*, which is the one
 * value a swimmer lands on exactly by construction rather than by coincidence.
 */
function scramble(game: Game, rng: Rng): void {
  game.elapsed = rng.float() * 40;
  game.clock = MATCH_SECONDS - game.elapsed;
  const stride = SWIM_SPEED * STEP;
  for (const seat of SEATS) {
    const lagoon = lagoonOf(game, seat);
    const swimmer = lagoon.swimmer;
    const pin = rng.float();
    swimmer.x =
      pin < 0.15
        ? MIN_X
        : pin < 0.3
          ? MAX_X
          : clamp(START_X + rng.int(-90, 91) * stride, MIN_X, MAX_X);
    swimmer.y =
      pin < 0.45 && pin >= 0.3
        ? MIN_Y
        : pin < 0.6 && pin >= 0.45
          ? MAX_Y
          : clamp(START_Y + rng.int(-75, 76) * stride, MIN_Y, MAX_Y);
    swimmer.prevX = swimmer.x;
    swimmer.prevY = swimmer.y;
    const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
    swimmer.dirX = heading.x;
    swimmer.dirY = heading.y;
    swimmer.snag = rng.bool(0.25) ? rng.int(1, 31) * STEP : 0;
    swimmer.distance = rng.int(0, 4000) * 0.5;
    swimmer.snags = rng.int(0, 6);
    swimmer.alive = true;
    swimmer.diedAt = 0;
    swimmer.flash = rng.int(0, 20) * 0.05;
    for (let i = 0; i < lagoon.piranhas.length; i += 1) {
      const piranha = lagoon.piranhas[i] as Piranha;
      // Some of them placed at exactly the catch radius, which is the other threshold a
      // state variable can land on by construction rather than by chance.
      if (rng.bool(0.12)) {
        const angle = rng.int(0, 8) * (Math.PI / 4);
        piranha.x = swimmer.x + Math.cos(angle) * CATCH_RADIUS;
        piranha.y = swimmer.y + Math.sin(angle) * CATCH_RADIUS;
      } else {
        piranha.x = rng.float() * LAGOON_WIDTH;
        piranha.y = rng.float() * LAGOON_HEIGHT;
      }
      piranha.prevX = piranha.x;
      piranha.prevY = piranha.y;
    }
  }
}

function randomCommand(rng: Rng): Command {
  if (rng.bool(0.2)) return still();
  const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
  return { dirX: heading.x, dirY: heading.y };
}

describe('the half-turn', () => {
  it('steps the swapped board to the swap of the stepped board, over 800 boards', () => {
    const rng = new Rng(20260829);
    const game = createGame();
    const swapped = createGame();
    const expected = createGame();
    for (let trial = 0; trial < 800; trial += 1) {
      resetGame(game, new Rng(trial * 131 + 7));
      scramble(game, rng);
      swapInto(game, swapped);
      const a = randomCommand(rng);
      const b = randomCommand(rng);
      step(game, STEP, a, b);
      step(swapped, STEP, b, a);
      swapInto(game, expected);
      expect(describeGame(swapped), `trial ${String(trial)}`).toBe(describeGame(expected));
    }
  });

  it('gives two seats driven by one command stream bit-identical lagoons', () => {
    // The strongest form of the check, and the one this game's shape makes available:
    // the seats do not run mirror-image simulations that have to be *shown* to agree, they
    // run the identical arithmetic on the identical numbers.
    const rng = new Rng(8675309);
    const game = fresh(4242);
    for (let i = 0; i < 4000; i += 1) {
      const command = randomCommand(rng);
      step(game, STEP, command, command);
      expect(describeLagoon(game.p1), `step ${String(i)}`).toBe(describeLagoon(game.p2));
      if (game.winner !== null) {
        expect(game.winner).toBe('draw');
        resetGame(game, new Rng(i));
      }
    }
  });

  it('holds bit-identity while both seats sit pinned against a rim', () => {
    // The Frozen Beaks family, aimed at directly: `clamp` puts a swimmer *exactly* on
    // MIN_X or MAX_Y, which is the value `rimAlong` divides by and the value the next
    // step's clamp compares against. Both seats reach it, and they must reach the same one.
    const game = fresh(19);
    callOffEverything(game);
    for (let i = 0; i < 1200; i += 1) {
      step(game, STEP, swim(-1, -1), swim(-1, -1));
      expect(describeLagoon(game.p1), `step ${String(i)}`).toBe(describeLagoon(game.p2));
    }
    expect(game.p1.swimmer.x).toBe(MIN_X);
    expect(game.p1.swimmer.y).toBe(MIN_Y);
    expect(game.p2.swimmer.x).toBe(MIN_X);
    expect(game.p2.swimmer.y).toBe(MIN_Y);
    // And a pinned swimmer scores nothing further, so the rim cannot be farmed.
    const held = game.p1.swimmer.distance;
    step(game, STEP, swim(-1, 0), swim(-1, 0));
    expect(game.p1.swimmer.distance).toBe(held);
  });

  it('makes a bot want the same thing on the same lagoon whichever seat holds it', () => {
    const rng = new Rng(31337);
    const game = createGame();
    const swapped = createGame();
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      for (let trial = 0; trial < 400; trial += 1) {
        resetGame(game, new Rng(trial * 197 + 3));
        scramble(game, rng);
        swapInto(game, swapped);
        const here = createBotState();
        const there = createBotState();
        chooseHeading(game, 'p1', profile, here);
        chooseHeading(swapped, 'p2', profile, there);
        expect(here.wantX, `${tier} trial ${String(trial)} x`).toBe(there.wantX);
        expect(here.wantY, `${tier} trial ${String(trial)} y`).toBe(there.wantY);
      }
    }
  });

  it('plays a whole match to its exact swap when the two bot streams are exchanged', () => {
    // End to end rather than argued. This is the property that makes seat one's share
    // 50.0% by construction rather than by sampling: a seed and its stream-swapped twin
    // are one match and its exact mirror.
    let flipped = 0;
    let mismatched = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 100; seed += 1) {
        const forward = playBots(seed * 3571 + 1, tier, tier);
        const backward = playBots(seed * 3571 + 1, tier, tier, true);
        const want =
          forward.winner === 'p1' ? 'p2' : forward.winner === 'p2' ? 'p1' : forward.winner;
        if (backward.winner !== want) flipped += 1;
        if (backward.p1 !== forward.p2 || backward.p2 !== forward.p1) mismatched += 1;
      }
    }
    expect(flipped).toBe(0);
    expect(mismatched).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Scoring and the end of a match                                                        */
/* ------------------------------------------------------------------------------------ */

/** Take a lagoon out of the match at a chosen moment with a chosen scoreline. */
function settle(lagoon: Lagoon, lengths: number, diedAt: number, snags: number): void {
  const swimmer = lagoon.swimmer;
  swimmer.distance = lengths * SCORE_UNIT + SCORE_UNIT / 2;
  swimmer.alive = false;
  swimmer.diedAt = diedAt;
  swimmer.snags = snags;
}

describe('the end of a match', () => {
  it('is not over while either swimmer is still going', () => {
    const game = fresh(3);
    settle(game.p1, 10, 4, 0);
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBeNull();
  });

  it('goes to the higher score once both have been taken', () => {
    const game = fresh(3);
    settle(game.p1, 40, 9, 1);
    settle(game.p2, 12, 5, 0);
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('p1');
    expect(lengthsOf(game.p1)).toBe(40);
    expect(lengthsOf(game.p2)).toBe(12);
  });

  it('breaks a level score on the swimmer that was taken later', () => {
    const game = fresh(3);
    settle(game.p1, 30, 8, 4);
    settle(game.p2, 30, 12, 0);
    step(game, STEP, still(), still());
    // p2 lasted longer, and lasting longer beats hitting less coral.
    expect(winnerOf(game)).toBe('p2');
    expect(survivalOf(game.p1)).toBe(8);
    expect(survivalOf(game.p2)).toBe(12);
  });

  it('breaks a level score and a level last breath on the fewer coral heads', () => {
    const game = fresh(3);
    settle(game.p1, 30, 11, 3);
    settle(game.p2, 30, 11, 5);
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw only when nothing separates them at all', () => {
    const game = fresh(3);
    settle(game.p1, 30, 11, 2);
    settle(game.p2, 30, 11, 2);
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('draw');
  });

  it('calls a swimmer still swimming the longer-lived one', () => {
    const game = fresh(3);
    settle(game.p1, 30, 11, 0);
    expect(survivalOf(game.p2)).toBe(Infinity);
    expect(survivalOf(game.p1)).toBe(11);
  });

  it('settles the tiebreak on something that is not a function of the board', () => {
    // Maze Paint's finding, and it is sharper here than anywhere else in the catalogue:
    // the two lagoons are not merely congruent, they are the same six coral heads at the
    // same six coordinates. Any rule written in positions returns the mirror answer on a
    // level position, so the two quantities the tiebreak reads are a *time* and a *count*.
    const game = fresh(77);
    const rng = new Rng(5);
    for (let trial = 0; trial < 200; trial += 1) {
      resetGame(game, new Rng(trial));
      scramble(game, rng);
      // A perfectly level position: same place, same everything.
      copySwimmer(game.p1.swimmer, game.p2.swimmer);
      copyLagoon(game.p1, game.p2);
      settle(game.p1, 20, 9, 2);
      settle(game.p2, 20, 9, 2);
      step(game, STEP, still(), still());
      expect(winnerOf(game), `trial ${String(trial)}`).toBe('draw');
      // Move one event — not one coordinate — and it decides.
      resetGame(game, new Rng(trial));
      settle(game.p1, 20, 9, 2);
      settle(game.p2, 20, 9, 3);
      step(game, STEP, still(), still());
      expect(winnerOf(game), `trial ${String(trial)}`).toBe('p1');
    }
  });

  it('freezes once it is decided', () => {
    const game = fresh(3);
    settle(game.p1, 40, 9, 1);
    settle(game.p2, 12, 5, 0);
    step(game, STEP, still(), still());
    const frozen = describeGame(game);
    for (let i = 0; i < 100; i += 1) step(game, STEP, swim(1, 1), swim(-1, -1));
    expect(describeGame(game)).toBe(frozen);
  });

  it('stops a taken lagoon entirely, shoal included', () => {
    const game = fresh(3);
    const lagoon = game.p1;
    const piranha = lagoon.piranhas[0] as Piranha;
    piranha.x = lagoon.swimmer.x;
    piranha.y = lagoon.swimmer.y;
    step(game, STEP, still(), still());
    expect(lagoon.swimmer.alive).toBe(false);
    const frozen = describeLagoon(lagoon);
    for (let i = 0; i < 200; i += 1) step(game, STEP, swim(1, 0), still());
    expect(describeLagoon(lagoon)).toBe(frozen);
  });

  it('counts the score in whole body lengths swum', () => {
    const game = fresh(3);
    callOffEverything(game);
    for (let i = 0; i < 60; i += 1) step(game, STEP, swim(1, 0), still());
    expect(game.p1.swimmer.distance).toBeCloseTo(SWIM_SPEED, 9);
    expect(lengthsOf(game.p1)).toBe(Math.floor(SWIM_SPEED / SCORE_UNIT));
  });
});

/* ------------------------------------------------------------------------------------ */
/* Determinism                                                                           */
/* ------------------------------------------------------------------------------------ */

describe('determinism', () => {
  it('replays an input trace to the identical final state', () => {
    const script = (seed: number): Game => {
      const rng = new Rng(4);
      const game = fresh(seed);
      for (let i = 0; i < 900; i += 1) step(game, STEP, randomCommand(rng), randomCommand(rng));
      return game;
    };
    expect(describeGame(script(1234))).toBe(describeGame(script(1234)));
  });

  it('holds its shape: nothing in the state grows over a whole match', () => {
    const game = fresh(88);
    const before = [game.corals.length, game.p1.piranhas.length, game.p2.piranhas.length];
    const rng = new Rng(9);
    while (game.winner === null) step(game, STEP, randomCommand(rng), randomCommand(rng));
    expect([game.corals.length, game.p1.piranhas.length, game.p2.piranhas.length]).toEqual(before);
  });

  it('keeps every drawn quantity inside the declared logical box', () => {
    const rng = new Rng(31);
    const game = fresh(55);
    const reach = Math.max(SWIM_RADIUS, PIRANHA_RADIUS, CORAL_RADIUS);
    for (let i = 0; i < 3000; i += 1) {
      if (game.winner !== null) resetGame(game, new Rng(i));
      step(game, STEP, randomCommand(rng), randomCommand(rng));
      for (const seat of SEATS) {
        const lagoon = lagoonOf(game, seat);
        const points: readonly (readonly [number, number])[] = [
          [lagoon.swimmer.x, lagoon.swimmer.y],
          ...lagoon.piranhas.map((p) => [p.x, p.y] as const),
          ...game.corals.map((c) => [c.x, c.y] as const),
        ];
        for (const [lx, ly] of points) {
          expect(toBoardX(seat, lx) - reach).toBeGreaterThanOrEqual(0);
          expect(toBoardX(seat, lx) + reach).toBeLessThanOrEqual(manifest.logical.width);
          expect(toBoardY(seat, ly) - reach).toBeGreaterThanOrEqual(0);
          expect(toBoardY(seat, ly) + reach).toBeLessThanOrEqual(manifest.logical.height);
        }
      }
    }
  });

  it('advertises the box it simulates in', () => {
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
    expect(manifest.logical.height).toBe(BOARD_HEIGHT);
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

interface Played {
  readonly winner: SeatId | 'draw' | null;
  readonly p1: number;
  readonly p2: number;
  readonly seconds: number;
  readonly clock: number;
}

/**
 * One bot-against-bot match, derived exactly the way `game.ts` derives one.
 *
 * `swapStreams` exchanges the two generators without touching anything else, which is the
 * only asymmetry the package has and the one the balance table is measured across.
 */
function playBots(seed: number, a: BotDifficulty, b: BotDifficulty, swapStreams = false): Played {
  const source = new Rng(seed);
  const layout = new Rng(source.next() | 0);
  const first = new Rng(source.next() | 0);
  const second = new Rng(source.next() | 0);
  const rng: Record<SeatId, Rng> = swapStreams
    ? { p1: second, p2: first }
    : { p1: first, p2: second };
  const profile: Record<SeatId, BotProfile> = { p1: BOT_PROFILES[a], p2: BOT_PROFILES[b] };
  const state = { p1: createBotState(), p2: createBotState() };
  const command = { p1: createCommand(), p2: createCommand() };
  const game = createGame();
  resetGame(game, layout);
  while (game.winner === null) {
    for (const seat of SEATS) {
      botStep(game, seat, profile[seat], state[seat], rng[seat], STEP, command[seat]);
    }
    step(game, STEP, command.p1, command.p2);
  }
  return {
    winner: game.winner,
    p1: lengthsOf(game.p1),
    p2: lengthsOf(game.p2),
    seconds: game.elapsed,
    clock: game.clock,
  };
}

describe('the bot', () => {
  it('draws the same number of values whatever the water looks like', () => {
    // Always, unconditionally, before any branch: a draw count that depends on the board
    // is how two seats stop being able to share one seed.
    for (const tier of TIERS) {
      for (let seed = 0; seed < 40; seed += 1) {
        const game = fresh(seed * 17 + 1);
        const rng = new Rng(5);
        const state = createBotState();
        const command = createCommand();
        let decisions = 0;
        let before = 0;
        for (let i = 0; i < 600; i += 1) {
          const cooling = state.cooldown - STEP > 0;
          botStep(game, 'p1', BOT_PROFILES[tier], state, rng, STEP, command);
          if (!cooling) decisions += 1;
          step(game, STEP, command, still());
          if (game.winner !== null) break;
        }
        // Every decision costs exactly BOT_DRAWS_PER_DECISION values and nothing else does.
        const spent = new Rng(5);
        for (let i = 0; i < decisions * BOT_DRAWS_PER_DECISION; i += 1) spent.float();
        before = spent.float();
        expect(before, `${tier} seed ${String(seed)}`).toBe(rng.float());
      }
    }
  });

  it('only ever asks for one of the nine headings a person can name', () => {
    const allowed = new Set<string>(['0,0']);
    for (let i = 0; i < HEADINGS.length; i += 1) {
      const heading = HEADINGS[i] as { x: number; y: number };
      allowed.add(`${String(heading.x)},${String(heading.y)}`);
      // And each is a unit vector, so no heading swims faster than another.
      expect(Math.hypot(heading.x, heading.y)).toBeCloseTo(1, 12);
    }
    expect(HEADINGS).toHaveLength(8);
    for (const tier of TIERS) {
      const game = fresh(3);
      const rng = new Rng(11);
      const state = createBotState();
      const command = createCommand();
      for (let i = 0; i < 3000; i += 1) {
        if (game.winner !== null) resetGame(game, new Rng(i));
        botStep(game, 'p1', BOT_PROFILES[tier], state, rng, STEP, command);
        expect(allowed.has(`${String(command.dirX)},${String(command.dirY)}`)).toBe(true);
        step(game, STEP, command, still());
      }
    }
  });

  it('never swims knowingly into a coral head or a rim', () => {
    for (const tier of TIERS) {
      const game = fresh(101);
      const state = createBotState();
      const command = createCommand();
      let blind = 0;
      let looks = 0;
      for (let i = 0; i < 4000; i += 1) {
        if (game.winner !== null) resetGame(game, new Rng(i));
        chooseHeading(game, 'p1', BOT_PROFILES[tier], state);
        const swimmer = game.p1.swimmer;
        const room = Math.min(
          rimAlong(swimmer.x, swimmer.y, state.wantX, state.wantY),
          coralAlong(game.corals, swimmer.x, swimmer.y, state.wantX, state.wantY),
        );
        looks += 1;
        if (room < ESCAPE_ROOM) blind += 1;
        command.dirX = state.wantX;
        command.dirY = state.wantY;
        step(game, STEP, command, still());
      }
      // A heading with less than ESCAPE_ROOM in front of it is only ever chosen when
      // *every* heading is that bad — a swimmer boxed into a corner still has to move.
      expect(blind / looks, tier).toBeLessThan(0.06);
    }
  });

  it('cannot swim anywhere a person could not, or any faster', () => {
    const game = fresh(3);
    callOffEverything(game);
    const rng = new Rng(21);
    const state = createBotState();
    const command = createCommand();
    for (let i = 0; i < 900; i += 1) {
      botStep(game, 'p1', BOT_PROFILES.hard, state, rng, STEP, command);
      const before = game.p1.swimmer.distance;
      step(game, STEP, command, still());
      expect(game.p1.swimmer.distance - before).toBeLessThanOrEqual(SWIM_SPEED * STEP + 1e-9);
    }
  });

  it('reads nothing a player cannot see', () => {
    // Rule 6, as a structural claim: `chooseHeading` consults the corals, the piranhas and
    // its own swimmer — all drawn — plus `piranhaSpeed(elapsed)`, which is drawn as the
    // gauge down the middle of the device precisely so that "they are faster than me now"
    // is something a player reads rather than something a bot knows.
    const game = fresh(3);
    const state = createBotState();
    chooseHeading(game, 'p1', BOT_PROFILES.hard, state);
    const wanted = `${String(state.wantX)},${String(state.wantY)}`;
    // Change the *other* seat entirely and the answer must not move: a bot cannot see
    // across the divider, because there is nothing there for it to read.
    game.p2.swimmer.x = MIN_X;
    game.p2.swimmer.y = MIN_Y;
    game.p2.swimmer.distance = 9999;
    const again = createBotState();
    chooseHeading(game, 'p1', BOT_PROFILES.hard, again);
    expect(`${String(again.wantX)},${String(again.wantY)}`).toBe(wanted);
  });

  it('climbs the ladder in both seat orders', () => {
    const seeds = 120;
    const table: Record<string, number> = {};
    const pairs: readonly [BotDifficulty, BotDifficulty][] = [
      ['normal', 'easy'],
      ['hard', 'normal'],
      ['hard', 'easy'],
    ];
    for (const [strong, weak] of pairs) {
      let wins = 0;
      let decided = 0;
      for (let seed = 0; seed < seeds; seed += 1) {
        const asOne = playBots(seed * 7919 + 3, strong, weak);
        if (asOne.winner === 'p1') wins += 1;
        if (asOne.winner === 'p1' || asOne.winner === 'p2') decided += 1;
        const asTwo = playBots(seed * 7919 + 3, weak, strong);
        if (asTwo.winner === 'p2') wins += 1;
        if (asTwo.winner === 'p1' || asTwo.winner === 'p2') decided += 1;
      }
      table[`${strong}>${weak}`] = wins / decided;
    }
    expect(table['normal>easy'], 'normal must beat easy').toBeGreaterThan(0.6);
    expect(table['hard>normal'], 'hard must beat normal').toBeGreaterThan(0.55);
    expect(table['hard>easy'], 'hard must beat easy').toBeGreaterThan(
      table['normal>easy'] as number,
    );
  });

  it('gives seat one exactly half the matches, by construction rather than by sampling', () => {
    // The two arms are the same seeds with the two bot generators exchanged. Because a
    // stream swap is an exact seat swap (asserted above), the two columns are exact
    // complements and their mean is 50.0% with no sample behind it at all.
    for (const tier of TIERS) {
      let a = 0;
      let b = 0;
      let decided = 0;
      for (let seed = 0; seed < 150; seed += 1) {
        const forward = playBots(seed * 7919 + 1000003, tier, tier);
        const backward = playBots(seed * 7919 + 1000003, tier, tier, true);
        if (forward.winner === 'p1') a += 1;
        if (backward.winner === 'p1') b += 1;
        if (forward.winner === 'p1' || forward.winner === 'p2') decided += 1;
      }
      expect(a + b, tier).toBe(decided);
    }
  });

  it('finishes every match well inside the round length the card advertises', () => {
    let longest = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 60; seed += 1) {
        const played = playBots(seed * 991 + 17, tier, tier);
        expect(played.winner).not.toBeNull();
        longest = Math.max(longest, played.seconds);
      }
    }
    expect(longest).toBeLessThan(manifest.roundSeconds);
  });

  it('separates the tiers on the coral it hits, not on how fast it swims', () => {
    // The ladder in one number. Every tier swims at exactly SWIM_SPEED; what a weaker tier
    // gives up is attention, and the visible price of inattention is the reef.
    const snags: Record<string, number> = {};
    for (const tier of TIERS) {
      let total = 0;
      let matches = 0;
      for (let seed = 0; seed < 80; seed += 1) {
        const source = new Rng(seed * 4801 + 9);
        const layout = new Rng(source.next() | 0);
        const one = new Rng(source.next() | 0);
        const two = new Rng(source.next() | 0);
        const game = createGame();
        resetGame(game, layout);
        const state = { p1: createBotState(), p2: createBotState() };
        const command = { p1: createCommand(), p2: createCommand() };
        const rng = { p1: one, p2: two };
        while (game.winner === null) {
          for (const seat of SEATS) {
            botStep(game, seat, BOT_PROFILES[tier], state[seat], rng[seat], STEP, command[seat]);
          }
          step(game, STEP, command.p1, command.p2);
        }
        total += (game.p1.swimmer.snags + game.p2.swimmer.snags) / 2;
        matches += 1;
      }
      snags[tier] = total / matches;
    }
    expect(snags.hard as number).toBeLessThan(snags.normal as number);
    expect(snags.hard as number).toBeLessThan(snags.easy as number);
  });

  it('resets to a clean state so a rematch is not a continuation', () => {
    const state = createBotState();
    state.cooldown = 3;
    state.wantX = 1;
    state.wantY = -1;
    state.blundering = true;
    resetBotState(state);
    expect(state).toEqual(createBotState());
  });
});

/* ------------------------------------------------------------------------------------ */
/* Fairness across input families, as far as rules.ts can see it                          */
/* ------------------------------------------------------------------------------------ */

describe('fairness', () => {
  it('puts the deadzone at four precision envelopes, not at a hand-picked number', () => {
    // `docs/input-idiom.md` rule 2. One envelope in this box is min(600, 1000) / 200 = 3.
    expect(MOVE_DEADZONE).toBe(12);
    expect(MOVE_DEADZONE).toBeLessThan(SWIM_RADIUS);
  });

  it('moves a swimmer exactly one precision envelope per 20 ms', () => {
    // The whole latency argument in one number: 30 ms of disagreement between a key and a
    // thumb is 4.5 units, against a 33-unit catch radius and a 50-unit coral head.
    expect(SWIM_SPEED * 0.02).toBeCloseTo(3, 12);
    expect(SWIM_SPEED * 0.03).toBeLessThan(CATCH_RADIUS / 5);
    expect(SWIM_SPEED * 0.03).toBeLessThan(SNAG_RADIUS / 10);
  });

  it('asks nobody to press anything, ever', () => {
    // There is no action in this game at all. `actionHeld` is `keys.action || pointerDown`
    // in the engine, so a finger on the glass *is* the action and a key player can hold a
    // direction without one — any rule bound to the action costs one instrument something
    // the other gets free. Nothing here reads it, so the asymmetry cannot arise, and there
    // is no rapid-pressing cadence for `docs/input-idiom.md`'s two-presses-a-second rule
    // to measure.
    // The claim, structurally: a Command is a heading and nothing else, and `step` accepts
    // nothing else, so there is no channel through which a press could reach the rules.
    expect(Object.keys(createCommand()).sort()).toEqual(['dirX', 'dirY']);
    expect(step.length).toBe(4);
  });
});
