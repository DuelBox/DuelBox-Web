import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  CRAWL,
  DRAG,
  GRIP,
  LAPS,
  LAP_LENGTH,
  MAX_SPEED,
  OFF_SECONDS,
  RACE_LENGTH,
  REJOIN_SPEED,
  THROTTLE,
  TRACK,
  TRACK_TURN,
  botThrottle,
  carOf,
  createBotState,
  createGame,
  curvatureAt,
  lapOf,
  otherOf,
  resetGame,
  safeSpeedAt,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(): Game {
  const game = createGame();
  resetGame(game);
  return game;
}

describe('the circuit', () => {
  it('closes on itself', () => {
    // A profile whose signed turn is not a full circle draws a track that spirals, and the
    // gap is only visible on screen. The first hand-written version came to 3π.
    expect(TRACK_TURN).toBeCloseTo(Math.PI * 2, 6);
  });

  it('closes in position as well as in heading, which is the stronger claim', () => {
    // Four right-angles bring the heading back whatever the radii are; the *place* only
    // comes back if each straight is what is left of its side after its two corners.
    let x = 0;
    let y = 0;
    let heading = 0;
    for (const segment of TRACK) {
      const steps = 400;
      for (let i = 0; i < steps; i += 1) {
        const ds = segment.length / steps;
        x += Math.cos(heading) * ds;
        y += Math.sin(heading) * ds;
        heading += segment.curvature * ds;
      }
    }
    expect(Math.hypot(x, y)).toBeLessThan(LAP_LENGTH * 0.005);
  });

  it('has four corners, all of different radii', () => {
    const radii = TRACK.filter((segment) => segment.curvature !== 0).map(
      (segment) => 1 / segment.curvature,
    );
    expect(radii).toHaveLength(4);
    expect(new Set(radii.map((radius) => radius.toFixed(3))).size).toBe(4);
  });

  it('reads its curvature by arc length, and wraps between laps', () => {
    expect(curvatureAt(0)).toBe(curvatureAt(LAP_LENGTH));
    expect(curvatureAt(LAP_LENGTH * 2.5)).toBe(curvatureAt(LAP_LENGTH * 0.5));
    expect(curvatureAt(-5)).toBe(curvatureAt(LAP_LENGTH - 5));
  });

  it('has corners the motor can actually be too fast for', () => {
    // The whole game is one control, and the first grip constant made it do nothing: every
    // corner was safe above 1,200 units a second against a motor that tops out at 620.
    const limits = TRACK.filter((segment) => segment.curvature !== 0).map((segment) =>
      Math.sqrt(GRIP / Math.abs(segment.curvature)),
    );
    for (const limit of limits) expect(limit).toBeLessThan(MAX_SPEED);
    // And the tightest is genuinely tight — under two thirds of top speed.
    expect(Math.min(...limits)).toBeLessThan(MAX_SPEED * 0.65);
  });

  it('treats a straight as having no limit at all', () => {
    // Which is correct rather than convenient: nothing about a straight limits speed, and
    // MAX_SPEED is the motor's business, not the track's.
    const straight = TRACK.findIndex((segment) => segment.curvature === 0);
    expect(straight).toBeGreaterThanOrEqual(0);
    expect(safeSpeedAt(1)).toBe(Infinity);
  });
});

describe('a car', () => {
  it('starts at the crawl and never stops', () => {
    // A slot car is fed by the rail; it does not stop because you stopped asking. This is
    // what makes a race between two absent players end.
    const game = started();
    expect(game.p1.speed).toBe(CRAWL);
    for (let i = 0; i < 60 * 30; i += 1) {
      step(game, STEP, false, false);
      expect(game.p1.speed).toBeGreaterThanOrEqual(CRAWL - 1e-9);
    }
  });

  it('accelerates on the throttle and slows without it', () => {
    const game = started();
    step(game, STEP, true, false);
    expect(game.p1.speed).toBeCloseTo(CRAWL + THROTTLE * STEP, 6);
    expect(game.p2.speed).toBe(CRAWL);
  });

  it('never goes faster than the motor allows', () => {
    const game = started();
    for (let i = 0; i < 60 * 40; i += 1) {
      step(game, STEP, true, true);
      expect(game.p1.speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
    }
  });

  it('leaves the slot when it is too fast for the bend it reaches', () => {
    const game = started();
    let spilled = false;
    for (let i = 0; i < 60 * 60 && !spilled; i += 1) {
      const outcome = step(game, STEP, true, false);
      spilled = outcome.spilled.includes('p1');
    }
    expect(spilled, 'flat out for a minute and it never fell off').toBe(true);
    expect(game.p1.off).toBeCloseTo(OFF_SECONDS, 5);
    expect(game.p1.speed).toBe(0);
    expect(game.p1.spills).toBe(1);
  });

  it('rejoins slowly after its time is up', () => {
    const game = started();
    for (let i = 0; i < 60 * 60 && game.p1.off <= 0; i += 1) step(game, STEP, true, false);
    expect(game.p1.off).toBeGreaterThan(0);
    const stoppedAt = game.p1.distance;

    let waited = 0;
    for (let i = 0; i < 600 && game.p1.off > 0; i += 1) {
      step(game, STEP, true, false);
      waited += STEP;
    }
    expect(waited).toBeCloseTo(OFF_SECONDS, 1);
    expect(game.p1.speed).toBe(REJOIN_SPEED);
    // And it lost no ground while it was off — only time.
    expect(game.p1.distance).toBe(stoppedAt);
  });

  it('counts laps from one', () => {
    const game = started();
    expect(lapOf(game.p1)).toBe(1);
    game.p1.distance = LAP_LENGTH * 1.5;
    expect(lapOf(game.p1)).toBe(2);
    game.p1.distance = RACE_LENGTH;
    expect(lapOf(game.p1)).toBe(LAPS);
  });
});

describe('the race', () => {
  it('is won by whoever crosses first', () => {
    const game = started();
    game.p1.distance = RACE_LENGTH - 1;
    step(game, STEP, true, false);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('p1');
    expect(game.p1.finished).toBeGreaterThan(0);
  });

  it('is a dead heat when both cross on the same step', () => {
    // Both cars are advanced from the same state before either finish is recorded, so this
    // is a genuine tie rather than whichever was read first.
    const game = started();
    game.p1.distance = RACE_LENGTH - 1;
    game.p2.distance = RACE_LENGTH - 1;
    const outcome = step(game, STEP, true, true);
    expect(outcome.finished).toHaveLength(2);
    expect(winnerOf(game)).toBe('draw');
  });

  it('ends the moment one car crosses, rather than making the loser drive alone', () => {
    const game = started();
    game.p1.distance = RACE_LENGTH - 1;
    game.p2.distance = LAP_LENGTH;
    step(game, STEP, true, true);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('p1');
    expect(game.p2.finished).toBe(-1);
  });

  it('finishes even if neither player ever touches the control', () => {
    // The structural guarantee, and it contains no clock: the crawl carries both cars round
    // whatever anybody does.
    const game = started();
    let steps = 0;
    for (; steps < 60 * 400 && game.phase !== 'over'; steps += 1) step(game, STEP, false, false);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('draw');
    // At the crawl the whole race takes about seventy-five seconds.
    expect(game.elapsed).toBeGreaterThan(RACE_LENGTH / MAX_SPEED);
    expect(game.elapsed).toBeLessThan(RACE_LENGTH / CRAWL + 5);
  });

  it('stops simulating once it is decided', () => {
    const game = started();
    game.phase = 'over';
    game.winner = 'p1';
    const distance = game.p1.distance;
    step(game, STEP, true, true);
    expect(game.p1.distance).toBe(distance);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the two lanes are one track', () => {
  it('gives both cars the identical race from the identical input', () => {
    // The lanes on screen are a drawing device; the simulation is one distance. A real slot
    // track needs crossovers to equalise its lanes, and a track that is one number long
    // does not.
    const game = started();
    const script = new Rng(31);
    for (let i = 0; i < 60 * 40 && game.phase !== 'over'; i += 1) {
      const throttle = script.float() < 0.6;
      step(game, STEP, throttle, throttle);
      expect(game.p2.distance).toBe(game.p1.distance);
      expect(game.p2.speed).toBe(game.p1.speed);
      expect(game.p2.spills).toBe(game.p1.spills);
    }
    expect(winnerOf(game)).toBe('draw');
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('draws the same number of values whatever it decides', () => {
    // Two bots share one Rng: a seat whose draw count depends on its decision shifts the
    // other seat's stream, which is a seat bias made of arithmetic.
    for (const tier of TIERS) {
      const game = started();
      const state = createBotState();
      const rng = new Rng(3);
      for (let i = 0; i < 400 && game.phase !== 'over'; i += 1) {
        const counter = new Rng(i + 1);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        state.cooldown = 0;
        botThrottle(game, 'p1', tier, state, STEP, counted);
        expect(draws, `${tier} step ${String(i)}`).toBe(BOT_DRAWS_PER_DECISION);
        step(game, STEP, true, true);
        void rng;
      }
    }
  });

  it('spends nothing on a step it is not looking', () => {
    const game = started();
    const state = createBotState();
    state.cooldown = 10;
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return 0.5;
      },
    } as unknown as Rng;
    botThrottle(game, 'p1', 'hard', state, STEP, counted);
    expect(draws).toBe(0);
  });

  it('always asks for power while it is off the slot', () => {
    // There is nothing to decide when the car is not moving, and a bot that let go while
    // stationary would rejoin slower than it had to.
    const game = started();
    game.p1.off = 1;
    const state = createBotState();
    expect(botThrottle(game, 'p1', 'hard', state, STEP, new Rng(1))).toBe(true);
  });

  it('lets go before a corner it could not otherwise make', () => {
    const game = started();
    const state = createBotState();
    const rng = new Rng(5);
    // Wind it up to full speed on the opening straight.
    game.p1.speed = MAX_SPEED;
    let released = false;
    for (let i = 0; i < 600 && !released; i += 1) {
      released = !botThrottle(game, 'p1', 'hard', state, STEP, rng);
      step(game, STEP, true, false);
    }
    expect(released, 'it never lifted, flat out into a corner').toBe(true);
  });

  it('knows how fast it can shed speed, and the game agrees', () => {
    // The bot's braking sum uses DRAG. If the two disagreed it would be racing a different
    // car from the one on the track.
    const game = started();
    game.p1.speed = 500;
    const before = game.p1.speed;
    step(game, STEP, false, false);
    expect(before - game.p1.speed).toBeCloseTo(DRAG * STEP, 6);
  });

  it('spills less and races faster as the tier goes up', () => {
    const results = TIERS.map((tier) => soloRace(tier));
    const [easy, normal, hard] = results as [
      { time: number; spills: number },
      { time: number; spills: number },
      { time: number; spills: number },
    ];
    expect(
      normal.time,
      `easy ${easy.time.toFixed(1)}s normal ${normal.time.toFixed(1)}s`,
    ).toBeLessThan(easy.time);
    expect(
      hard.time,
      `normal ${normal.time.toFixed(1)}s hard ${hard.time.toFixed(1)}s`,
    ).toBeLessThan(normal.time);
    expect(normal.spills).toBeLessThan(easy.spills);
  });

  it('is balanced against itself', () => {
    // 120 seeds rather than 60: a race here is decided by a handful of spills, so sixty is
    // inside the noise — the first sixty seeds gave `easy` a 66% split that a hundred and
    // twenty put at 53%. A wider band would have hidden that rather than answered it.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 120);
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

  it('is ordered by accuracy rather than by bravery', () => {
    // A spill costs 1.9 s and a race is about eighteen, so running nearer the limit is only
    // better if it does not cost a fall. The first tiers had `hard` the bravest and it lost.
    expect(BOT_PROFILES.hard.resolution).toBeLessThan(BOT_PROFILES.normal.resolution);
    expect(BOT_PROFILES.hard.lookahead).toBeGreaterThan(BOT_PROFILES.normal.lookahead);
    expect(BOT_PROFILES.hard.reaction).toBeLessThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.easy.margin).toBeGreaterThan(1);
  });
});

/** One tier racing alone: how long it takes and how often it falls off. */
function soloRace(tier: BotDifficulty): { time: number; spills: number } {
  let time = 0;
  let spills = 0;
  const runs = 10;
  for (let seed = 0; seed < runs; seed += 1) {
    const game = started();
    const rng = new Rng(900 + seed);
    const state = createBotState();
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      const throttle = botThrottle(game, 'p1', tier, state, STEP, rng);
      step(game, STEP, throttle, true);
    }
    time += game.p1.finished >= 0 ? game.p1.finished : game.elapsed;
    spills += game.p1.spills;
  }
  return { time: time / runs, spills: spills / runs };
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const game = started();
    const rng = new Rng(match);
    const states = { p1: createBotState(), p2: createBotState() };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      const p1 = botThrottle(game, 'p1', tiers.p1, states.p1, STEP, rng);
      const p2 = botThrottle(game, 'p2', tiers.p2, states.p2, STEP, rng);
      step(game, STEP, p1, p2);
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
      const game = started();
      const script = new Rng(4242);
      for (let i = 0; i < 60 * 200 && game.phase !== 'over'; i += 1) {
        step(game, STEP, script.float() < 0.7, script.float() < 0.5);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('races the same track every lap, which is why a lap is worth learning', () => {
    // Nothing about the circuit is generated, so the corner that caught you last lap is the
    // corner that is coming again.
    for (let lap = 0; lap < LAPS; lap += 1) {
      for (let along = 0; along < LAP_LENGTH; along += 97) {
        expect(safeSpeedAt(along + LAP_LENGTH * lap)).toBe(safeSpeedAt(along));
      }
    }
  });

  it('reports the same car for the same seat', () => {
    const game = started();
    expect(carOf(game, 'p1')).toBe(game.p1);
    expect(carOf(game, 'p2')).toBe(game.p2);
  });
});
