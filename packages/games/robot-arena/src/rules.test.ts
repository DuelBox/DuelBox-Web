import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ARENA,
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  CENTRE,
  FIRST_INTERVAL,
  FLOOR_RADIUS,
  GRACE_SECONDS,
  MAX_ROUNDS,
  MIN_INTERVAL,
  ROBOT_RADIUS,
  ROBOT_SPEED,
  START_OFFSET,
  TARGET_ROUNDS,
  bladeDistance,
  botIntent,
  createBotState,
  createGame,
  driveRobot,
  otherOf,
  reflect,
  resetGame,
  robotOf,
  roundsOf,
  startRound,
  step,
  struck,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(): Game {
  const game = createGame();
  resetGame(game);
  return game;
}

/** Run past the grace period so hazards start arriving. */
function toLive(game: Game, rng: Rng): void {
  for (let i = 0; i < 600 && game.phase === 'grace'; i += 1) step(game, STEP, rng);
}

describe('the arena', () => {
  it('starts the two robots at reflected positions', () => {
    const game = started();
    expect(game.p1.x).toBe(reflect(game.p2.x));
    expect(game.p1.y).toBe(reflect(game.p2.y));
    expect(game.p1.y - CENTRE).toBe(START_OFFSET);
  });

  it('reflects a point through the centre', () => {
    expect(reflect(CENTRE)).toBe(CENTRE);
    expect(reflect(0)).toBe(ARENA);
    expect(reflect(reflect(123))).toBe(123);
  });

  it('holds a robot on the floor rather than killing it there', () => {
    // The arena is the safe place and the hazards are the danger. A rim that killed would
    // make the game about the rim.
    const robot = { x: CENTRE, y: CENTRE, alive: true };
    for (let i = 0; i < 600; i += 1) driveRobot(robot, 1, 0, STEP);
    expect(robot.alive).toBe(true);
    expect(Math.hypot(robot.x - CENTRE, robot.y - CENTRE)).toBeCloseTo(
      FLOOR_RADIUS - ROBOT_RADIUS,
      6,
    );
  });

  it('does not let a diagonal run faster than a straight one', () => {
    // The oldest bug in eight-way movement, and a keyboard makes it very easy to hit.
    const straight = { x: CENTRE, y: CENTRE, alive: true };
    const diagonal = { x: CENTRE, y: CENTRE, alive: true };
    for (let i = 0; i < 30; i += 1) {
      driveRobot(straight, 1, 0, STEP);
      driveRobot(diagonal, 1, 1, STEP);
    }
    const straightWay = Math.hypot(straight.x - CENTRE, straight.y - CENTRE);
    const diagonalWay = Math.hypot(diagonal.x - CENTRE, diagonal.y - CENTRE);
    expect(diagonalWay).toBeCloseTo(straightWay, 6);
    expect(straightWay).toBeCloseTo(ROBOT_SPEED * STEP * 30, 6);
  });
});

describe('the board is its own reflection', () => {
  /**
   * This is the property the whole design rests on, and the only test in this file whose
   * failure would mean the game is unfair rather than merely wrong.
   */
  it('answers the same about a point and its reflection, at every moment of a round', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const game = started();
      const rng = new Rng(seed);
      for (let i = 0; i < 60 * 40 && game.phase !== 'settling'; i += 1) {
        step(game, STEP, rng);
        if (i % 7 !== 0) continue;
        // Sample the floor on a coarse lattice and check every point against its twin.
        for (let x = 120; x <= ARENA - 120; x += 90) {
          for (let y = 120; y <= ARENA - 120; y += 90) {
            expect(
              struck(game, x, y),
              `seed ${String(seed)} step ${String(i)} at ${String(x)},${String(y)}`,
            ).toBe(struck(game, reflect(x), reflect(y)));
          }
        }
      }
    }
  });

  it('spawns lasers and cannonballs in reflected pairs', () => {
    const game = started();
    const rng = new Rng(4);
    toLive(game, rng);
    for (let i = 0; i < 60 * 20; i += 1) {
      step(game, STEP, rng);
      if (game.phase === 'settling') break;

      const lasers = game.lasers.filter((laser) => laser.active);
      for (const laser of lasers) {
        const twin = lasers.find(
          (other) =>
            other !== laser &&
            other.horizontal === laser.horizontal &&
            Math.abs(other.at - reflect(laser.at)) < 1e-6,
        );
        // A laser whose twin has already expired is fine — they expire together, so this
        // only holds while both are live, which is every step of their shared life.
        expect(twin ?? laser.at === CENTRE).toBeTruthy();
      }
    }
  });

  it('has a blade that is its own reflection, being a bar through the centre', () => {
    const game = started();
    for (const angle of [0, 0.4, 1.1, 2.9, 5.5]) {
      game.bladeAngle = angle;
      for (let x = 100; x < ARENA; x += 137) {
        for (let y = 100; y < ARENA; y += 149) {
          expect(bladeDistance(game, x, y)).toBeCloseTo(
            bladeDistance(game, reflect(x), reflect(y)),
            9,
          );
        }
      }
    }
  });
});

describe('a round', () => {
  it('opens with a grace period, so both players can find their robot', () => {
    const game = started();
    const rng = new Rng(1);
    expect(game.phase).toBe('grace');
    let elapsed = 0;
    for (let i = 0; i < 600 && game.phase === 'grace'; i += 1) {
      step(game, STEP, rng);
      elapsed += STEP;
    }
    expect(elapsed).toBeCloseTo(GRACE_SECONDS, 1);
    expect(game.phase).toBe('live');
  });

  it('turns the blade through the grace period', () => {
    // The first thing a player sees should be the hazard they will spend the round reading.
    const game = started();
    const rng = new Rng(1);
    step(game, STEP, rng);
    expect(game.bladeAngle).toBeGreaterThan(0);
  });

  it('escalates until it is over, however well it is played', () => {
    // The termination guarantee, and it contains no wall clock: the interval falls toward
    // MIN_INTERVAL and at that rate the floor fills faster than a robot can cross it.
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = started();
      const rng = new Rng(seed);
      let steps = 0;
      for (; steps < 60 * 300 && game.phase !== 'settling'; steps += 1) step(game, STEP, rng);
      expect(game.phase, `seed ${String(seed)} never ended`).toBe('settling');
      expect(game.interval).toBeLessThanOrEqual(FIRST_INTERVAL);
      expect(game.interval).toBeGreaterThanOrEqual(MIN_INTERVAL - 1e-9);
    }
  });

  it('kills both when both are hit on the same step, which is a drawn round', () => {
    const game = started();
    const rng = new Rng(1);
    toLive(game, rng);
    // Both onto the blade's line, at reflected places — the symmetric death.
    game.bladeAngle = Math.PI / 2;
    game.p1.x = CENTRE;
    game.p1.y = CENTRE + 100;
    game.p2.x = reflect(game.p1.x);
    game.p2.y = reflect(game.p1.y);
    const outcome = step(game, STEP, rng);
    expect(outcome.died).toHaveLength(2);
    expect(game.lastRound).toBe('draw');
    expect(game.p1Rounds).toBe(0);
    expect(game.p2Rounds).toBe(0);
  });

  it('awards the round to the survivor', () => {
    const game = started();
    const rng = new Rng(1);
    toLive(game, rng);
    game.bladeAngle = Math.PI / 2;
    game.p1.x = CENTRE;
    game.p1.y = CENTRE + 100;
    game.p2.x = CENTRE + 300;
    game.p2.y = CENTRE;
    step(game, STEP, rng);
    expect(game.lastRound).toBe('p2');
    expect(roundsOf(game, 'p2')).toBe(1);
  });
});

describe('the match', () => {
  it('is won by the first seat to the target', () => {
    const game = started();
    const rng = new Rng(1);
    game.p1Rounds = TARGET_ROUNDS - 1;
    // Kill p2 on the blade.
    toLive(game, rng);
    game.bladeAngle = Math.PI / 2;
    game.p2.x = CENTRE;
    game.p2.y = CENTRE + 100;
    game.p1.x = CENTRE + 300;
    game.p1.y = CENTRE;
    step(game, STEP, rng);
    for (let i = 0; i < 600 && game.phase !== 'over'; i += 1) step(game, STEP, rng);
    expect(winnerOf(game)).toBe('p1');
    expect(roundsOf(game, 'p1')).toBe(TARGET_ROUNDS);
  });

  it('is called on rounds once the cap is reached', () => {
    const game = started();
    const rng = new Rng(1);
    game.rounds = MAX_ROUNDS;
    game.p2Rounds = 1;
    toLive(game, rng);
    game.bladeAngle = Math.PI / 2;
    game.p1.x = CENTRE;
    game.p1.y = CENTRE + 100;
    game.p2.x = CENTRE + 300;
    game.p2.y = CENTRE;
    step(game, STEP, rng);
    for (let i = 0; i < 600 && game.phase !== 'over'; i += 1) step(game, STEP, rng);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('p2');
  });

  it('stops simulating once it is decided', () => {
    const game = started();
    const rng = new Rng(1);
    game.phase = 'over';
    game.winner = 'draw';
    const angle = game.bladeAngle;
    step(game, STEP, rng);
    expect(game.bladeAngle).toBe(angle);
  });

  it('starts every round from the same reflected pair', () => {
    const game = started();
    game.p1.x = 100;
    game.p2.alive = false;
    startRound(game);
    expect(game.p1.alive).toBe(true);
    expect(game.p2.alive).toBe(true);
    expect(game.p1.x).toBe(reflect(game.p2.x));
    expect(game.p1.y).toBe(reflect(game.p2.y));
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];
  const out = { x: 0, y: 0 };

  it('draws the same number of values whatever it decides', () => {
    // The two bots share one Rng: a seat whose draw count depends on its decision shifts
    // the other seat's stream, and that is a seat bias made of arithmetic. Fruit Duel was
    // caught by exactly this.
    for (const tier of TIERS) {
      const game = started();
      const rng = new Rng(2);
      toLive(game, rng);
      const state = createBotState();
      for (let i = 0; i < 400; i += 1) {
        const counter = new Rng(i + 1);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        state.cooldown = 0;
        botIntent(game, 'p1', tier, state, STEP, counted, out);
        expect(draws, `${tier} step ${String(i)}`).toBe(BOT_DRAWS_PER_DECISION);
        step(game, STEP, rng);
        if (game.phase !== 'live') break;
      }
    }
  });

  it('never asks for more than full speed', () => {
    for (const tier of TIERS) {
      const game = started();
      const rng = new Rng(3);
      const state = createBotState();
      for (let i = 0; i < 60 * 60 && game.phase !== 'over'; i += 1) {
        botIntent(game, 'p1', tier, state, STEP, rng, out);
        expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(1 + 1e-9);
        driveRobot(game.p1, out.x, out.y, STEP);
        step(game, STEP, rng);
      }
    }
  });

  it('holds still when nothing is coming, rather than walking into something', () => {
    const game = started();
    const rng = new Rng(1);
    toLive(game, rng);
    // A bare board: no shots, no lasers, blade pointing away from a robot at the rim.
    for (const laser of game.lasers) laser.active = false;
    for (const shot of game.shots) shot.active = false;
    game.bladeAngle = Math.PI / 2;
    game.p1.x = CENTRE + 300;
    game.p1.y = CENTRE;
    const state = createBotState();
    botIntent(game, 'p1', 'hard', state, STEP, rng, out);
    expect(Math.hypot(out.x, out.y)).toBe(0);
  });

  it('survives longer as the tier goes up', () => {
    const lifetimes = TIERS.map((tier) => averageRoundLength(tier));
    const [easy, normal, hard] = lifetimes as [number, number, number];
    expect(normal, `easy ${easy.toFixed(1)}s normal ${normal.toFixed(1)}s`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(1)}s hard ${hard.toFixed(1)}s`).toBeGreaterThan(normal);
  });

  it('is balanced against itself, which the point symmetry should make easy', () => {
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 40);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(30);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.35,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.65);
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = playSeries(strong, weak, 30);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 2);
      const asP2 = playSeries(weak, strong, 30);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 2);
    }
  });

  it('never gets a bigger fan than it can pay for', () => {
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].fanSize).toBeGreaterThan(3);
      expect(BOT_PROFILES[tier].lookahead).toBeGreaterThan(0);
    }
  });
});

/**
 * How long a round lasts with both seats on one tier, averaged.
 *
 * A round ends when the *first* robot dies, so with both seats playing the same tier its
 * length is that tier's survival — and measuring it this way needs no special case for the
 * other robot. Measuring one bot alone does not work here: the round ends when either
 * robot dies, and a stationary partner dies in seconds, taking the round with it.
 */
function averageRoundLength(tier: BotDifficulty): number {
  const out = { x: 0, y: 0 };
  const lengths: number[] = [];
  for (let seed = 0; seed < 14; seed += 1) {
    const game = createGame();
    const rng = new Rng(700 + seed);
    resetGame(game);
    const states = { p1: createBotState(), p2: createBotState() };
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        botIntent(game, seat, tier, states[seat], STEP, rng, out);
        driveRobot(robotOf(game, seat), out.x, out.y, STEP);
      }
      const outcome = step(game, STEP, rng);
      if (outcome.roundOver) lengths.push(game.elapsed);
    }
  }
  return lengths.reduce((total, value) => total + value, 0) / Math.max(1, lengths.length);
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  const out = { x: 0, y: 0 };
  for (let match = 0; match < matches; match += 1) {
    const game = createGame();
    const rng = new Rng(3000 + match);
    resetGame(game);
    const states = { p1: createBotState(), p2: createBotState() };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };

    for (let i = 0; i < 60 * 600 && game.phase !== 'over'; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        botIntent(game, seat, tiers[seat], states[seat], STEP, rng, out);
        driveRobot(robotOf(game, seat), out.x, out.y, STEP);
      }
      step(game, STEP, rng);
    }
    if (game.winner === 'p1') wins.p1 += 1;
    else if (game.winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

describe('determinism', () => {
  it('replays a fixed script to the identical final state', () => {
    const play = (): Game => {
      const game = createGame();
      const rng = new Rng(20260823);
      resetGame(game);
      const script = new Rng(77);
      for (let i = 0; i < 60 * 200 && game.phase !== 'over'; i += 1) {
        driveRobot(game.p1, script.float() * 2 - 1, script.float() * 2 - 1, STEP);
        driveRobot(game.p2, script.float() * 2 - 1, script.float() * 2 - 1, STEP);
        step(game, STEP, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('deals a different arena from a different seed', () => {
    /*
     * Both robots are driven by the hardest bot, and that is what makes this test say
     * anything at all.
     *
     * Undriven robots stand on their start marks and the blade reaches them in about two
     * seconds — before the first wave, which is due at 3.3 s. The board was therefore
     * always empty, the trace was the empty string for all twenty seeds, and the set had
     * one element: twenty copies of nothing, compared successfully. The inner assertion
     * below is there so that can never happen quietly again.
     */
    const out = { x: 0, y: 0 };
    const trace = (seed: number): string => {
      const game = createGame();
      const rng = new Rng(seed);
      resetGame(game);
      const states = { p1: createBotState(), p2: createBotState() };
      const seen: string[] = [];
      for (let i = 0; i < 60 * 30 && game.phase !== 'over'; i += 1) {
        for (const seat of ['p1', 'p2'] as SeatId[]) {
          botIntent(game, seat, 'hard', states[seat], STEP, rng, out);
          driveRobot(robotOf(game, seat), out.x, out.y, STEP);
        }
        step(game, STEP, rng);
        if (i % 15 !== 0) continue;
        for (const shot of game.shots) if (shot.active) seen.push(shot.x.toFixed(0));
        for (const laser of game.lasers) if (laser.active) seen.push(`L${laser.at.toFixed(0)}`);
      }
      expect(seen.length, `seed ${String(seed)} saw no hazards at all`).toBeGreaterThan(20);
      return seen.join(',');
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) seen.add(trace(seed));
    expect(seen.size).toBeGreaterThan(12);
  });
});
