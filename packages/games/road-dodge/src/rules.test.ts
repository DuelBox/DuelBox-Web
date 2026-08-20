import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BASE_SPEED,
  BOT_PROFILES,
  CAR_Y,
  HIT_BAND,
  LANES,
  MAX_SPEED,
  MIN_SPAWN_INTERVAL,
  OBSTACLE_POOL,
  RAMP_SECONDS,
  TRACK_LENGTH,
  botSteer,
  createBotState,
  resetBotState,
  createSeatState,
  laneIsClear,
  resetSeatState,
  spawn,
  spawnIntervalAt,
  spawnLane,
  speedAt,
  steer,
  stepSeat,
  winnerOf,
} from './rules.js';
import type { SeatState } from './rules.js';

const STEP = 1 / 60;

/** Clears the pool so a test can place obstacles precisely. */
function emptyPool(state: SeatState): void {
  for (const obstacle of state.obstacles) obstacle.lane = -1;
  // Far enough away that no spawn interferes with the test.
  state.spawnIn = 999;
}

describe('the road', () => {
  it('has three lanes and a pool that cannot grow', () => {
    expect(LANES).toBe(3);
    expect(createSeatState().obstacles.length).toBe(OBSTACLE_POOL);
  });

  it('starts in the middle lane, uncrashed and unscored', () => {
    const state = createSeatState();
    expect(state.lane).toBe(1);
    expect(state.position).toBe(1);
    expect(state.crashed).toBe(false);
    expect(state.passed).toBe(0);
  });

  it('resets in place', () => {
    const state = createSeatState();
    const pool = state.obstacles;
    state.crashed = true;
    state.passed = 9;
    resetSeatState(state);
    expect(state.obstacles, 'the pool is reused, not rebuilt').toBe(pool);
    expect(state.crashed).toBe(false);
    expect(state.passed).toBe(0);
  });
});

describe('steering', () => {
  it('moves one lane at a time', () => {
    const state = createSeatState();
    expect(steer(state, 1)).toBe(2);
    expect(steer(state, -1)).toBe(1);
  });

  it('stops at the edges of the road', () => {
    const state = createSeatState();
    steer(state, -1);
    expect(steer(state, -1), 'cannot leave the road').toBe(0);
    steer(state, 1);
    steer(state, 1);
    expect(steer(state, 1)).toBe(LANES - 1);
  });

  it('does nothing on zero', () => {
    const state = createSeatState();
    expect(steer(state, 0)).toBe(1);
  });

  it('is refused once crashed', () => {
    const state = createSeatState();
    state.crashed = true;
    expect(steer(state, 1)).toBe(1);
  });

  it('takes time to cross, which is what makes a late dodge fail', () => {
    const state = createSeatState();
    emptyPool(state);
    steer(state, 1);
    // One step is not enough to arrive.
    stepSeat(state, STEP, new Rng(1));
    expect(state.position).toBeGreaterThan(1);
    expect(state.position).toBeLessThan(2);
    for (let i = 0; i < 20; i += 1) stepSeat(state, STEP, new Rng(1));
    expect(state.position, 'it does arrive').toBe(2);
  });
});

describe('the ramp', () => {
  it('starts slow and reaches the maximum', () => {
    expect(speedAt(0)).toBe(BASE_SPEED);
    expect(speedAt(RAMP_SECONDS)).toBe(MAX_SPEED);
    expect(speedAt(RAMP_SECONDS * 3), 'never past the maximum').toBe(MAX_SPEED);
  });

  it('tightens the spawn interval to its floor and no further', () => {
    expect(spawnIntervalAt(0)).toBeGreaterThan(spawnIntervalAt(RAMP_SECONDS / 2));
    expect(spawnIntervalAt(RAMP_SECONDS)).toBeCloseTo(MIN_SPAWN_INTERVAL, 6);
    expect(spawnIntervalAt(RAMP_SECONDS * 5)).toBeCloseTo(MIN_SPAWN_INTERVAL, 6);
  });

  it('never goes backwards', () => {
    let previous = 0;
    for (let t = 0; t <= RAMP_SECONDS * 2; t += 1) {
      const speed = speedAt(t);
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
  });
});

describe('crashing', () => {
  it("happens when an obstacle reaches the car in the car's lane", () => {
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 1);
    const obstacle = state.obstacles[0];
    expect(obstacle).toBeDefined();
    if (!obstacle) return;
    obstacle.y = CAR_Y - 1;
    expect(stepSeat(state, STEP, new Rng(1))).toBe('crashed');
    expect(state.crashed).toBe(true);
  });

  it('does not happen in another lane', () => {
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 0);
    const obstacle = state.obstacles[0];
    if (!obstacle) return;
    obstacle.y = CAR_Y - 1;
    expect(stepSeat(state, STEP, new Rng(1))).toBe('racing');
    expect(state.crashed).toBe(false);
  });

  it('lets a car halfway between lanes thread a gap', () => {
    // Position is fractional mid-change, so a car between two lanes is in neither. That
    // is what makes a late dodge possible rather than a coin flip.
    const state = createSeatState();
    emptyPool(state);
    state.position = 1.5;
    state.lane = 2;
    spawn(state, 1);
    const obstacle = state.obstacles[0];
    if (!obstacle) return;
    obstacle.y = CAR_Y;
    expect(stepSeat(state, STEP, new Rng(1))).toBe('racing');
  });

  it('reports the crash on exactly one step', () => {
    // The caller decides what a crash means; repeating it every step would make that
    // impossible.
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 1);
    const obstacle = state.obstacles[0];
    if (!obstacle) return;
    obstacle.y = CAR_Y - 1;
    expect(stepSeat(state, STEP, new Rng(1))).toBe('crashed');
    expect(stepSeat(state, STEP, new Rng(1)), 'not again').toBe('racing');
  });

  it('stops the score once crashed', () => {
    const state = createSeatState();
    emptyPool(state);
    state.crashed = true;
    spawn(state, 1);
    const before = state.passed;
    for (let i = 0; i < 200; i += 1) stepSeat(state, STEP, new Rng(1));
    expect(state.passed).toBe(before);
  });
});

describe('scoring', () => {
  it('counts an obstacle once it is past the car', () => {
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 0);
    const obstacle = state.obstacles[0];
    if (!obstacle) return;
    obstacle.y = CAR_Y + HIT_BAND - 1;
    expect(state.passed).toBe(0);
    for (let i = 0; i < 30; i += 1) stepSeat(state, STEP, new Rng(1));
    expect(state.passed).toBe(1);
  });

  it('counts each obstacle exactly once', () => {
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 0);
    for (let i = 0; i < 400; i += 1) stepSeat(state, STEP, new Rng(1));
    // The pool slot is freed past the end of the track; it must not score again.
    expect(state.passed).toBeLessThanOrEqual(OBSTACLE_POOL);
  });
});

describe('spawning', () => {
  it('never fills the last free lane while the road is busy', () => {
    // A game that can kill you regardless of what you do is not a game, it is a countdown.
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 0);
    spawn(state, 2);
    const a = state.obstacles[0];
    const b = state.obstacles[1];
    if (!a || !b) return;
    a.y = 10;
    b.y = 20;
    const rng = new Rng(5);
    for (let i = 0; i < 50; i += 1) {
      expect(spawnLane(state, rng), 'must leave lane 1 open').toBe(1);
    }
  });

  it('picks any lane when every lane is already busy', () => {
    const state = createSeatState();
    emptyPool(state);
    for (let lane = 0; lane < LANES; lane += 1) {
      spawn(state, lane);
    }
    for (const obstacle of state.obstacles) {
      if (obstacle.lane >= 0) obstacle.y = 10;
    }
    const lane = spawnLane(state, new Rng(2));
    expect(lane).toBeGreaterThanOrEqual(0);
    expect(lane).toBeLessThan(LANES);
  });

  it('reports a full pool rather than overwriting', () => {
    const state = createSeatState();
    emptyPool(state);
    for (let i = 0; i < OBSTACLE_POOL; i += 1) expect(spawn(state, 0)).toBe(true);
    expect(spawn(state, 0), 'the pool cannot grow').toBe(false);
  });

  it('frees a slot once an obstacle leaves the track', () => {
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 0);
    const obstacle = state.obstacles[0];
    if (!obstacle) return;
    obstacle.y = TRACK_LENGTH - 1;
    stepSeat(state, STEP, new Rng(1));
    expect(obstacle.lane, 'the slot is returned to the pool').toBe(-1);
  });
});

describe('the winner', () => {
  it('is nobody while both are racing', () => {
    expect(winnerOf(createSeatState(), createSeatState())).toBeNull();
  });

  it('is the seat still going', () => {
    const p1 = createSeatState();
    const p2 = createSeatState();
    p1.crashed = true;
    expect(winnerOf(p1, p2)).toBe('p2');
  });

  it('is a draw when both crash on the same step', () => {
    // Possible because both seats are stepped in the same frame; resolving it by whichever
    // was checked first would be an arbitrary tie-break.
    const p1 = createSeatState();
    const p2 = createSeatState();
    p1.crashed = true;
    p2.crashed = true;
    expect(winnerOf(p1, p2)).toBe('draw');
  });
});

describe('the bot', () => {
  it('steers only within the road', () => {
    const state = createSeatState();
    const rng = new Rng(3);
    for (let i = 0; i < 500; i += 1) {
      const direction = botSteer(
        state,
        createBotState(),
        BOT_PROFILES.hard,
        STEP,
        rng.float(),
        rng.float(),
      );
      expect([-1, 0, 1]).toContain(direction);
      steer(state, direction);
      expect(state.lane).toBeGreaterThanOrEqual(0);
      expect(state.lane).toBeLessThan(LANES);
      stepSeat(state, STEP, rng);
      if (state.crashed) resetSeatState(state);
    }
  });

  it('does nothing when the road ahead is clear', () => {
    const state = createSeatState();
    emptyPool(state);
    expect(botSteer(state, createBotState(), BOT_PROFILES.hard, STEP, 0.5, 0.5)).toBe(0);
  });

  it('dodges an obstacle in its own lane', () => {
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 1);
    const obstacle = state.obstacles[0];
    if (!obstacle) return;
    obstacle.y = CAR_Y - 40;
    expect(
      botSteer(state, createBotState(), BOT_PROFILES.hard, STEP, 0.5, 0.5),
      'it must move',
    ).not.toBe(0);
  });

  it('does not steer into another obstacle', () => {
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 1);
    spawn(state, 2);
    const a = state.obstacles[0];
    const b = state.obstacles[1];
    if (!a || !b) return;
    a.y = CAR_Y - 40;
    b.y = CAR_Y - 30;
    const direction = botSteer(state, createBotState(), BOT_PROFILES.hard, STEP, 0.5, 0.5);
    // Lane 2 is occupied, so the only safe move is left.
    expect(direction).toBeLessThanOrEqual(0);
  });

  it('cannot see an obstacle before it spawns', () => {
    // Trivial to break here, and it would make the hard tier feel like cheating.
    const state = createSeatState();
    emptyPool(state);
    expect(botSteer(state, createBotState(), BOT_PROFILES.hard, STEP, 0.5, 0.5)).toBe(0);
    spawn(state, 1);
    const obstacle = state.obstacles[0];
    if (!obstacle) return;
    obstacle.y = 0;
    // Still far away: no reaction yet at this distance.
    expect(botSteer(state, createBotState(), BOT_PROFILES.hard, STEP, 0.5, 0.5)).toBe(0);
  });

  it('knows which lanes are clear', () => {
    const state = createSeatState();
    emptyPool(state);
    spawn(state, 0);
    const obstacle = state.obstacles[0];
    if (!obstacle) return;
    obstacle.y = CAR_Y;
    expect(laneIsClear(state, 0)).toBe(false);
    expect(laneIsClear(state, 1)).toBe(true);
  });

  it('survives longer on the hard tier than the easy one', () => {
    // The tiers must differ in strength rather than only in label.
    const survive = (difficulty: 'easy' | 'hard'): number => {
      let total = 0;
      const runs = 12;
      for (let run = 0; run < runs; run += 1) {
        const state = createSeatState();
        const bot = createBotState();
        const rng = new Rng(400 + run);
        let steps = 0;
        while (!state.crashed && steps < 60 * 90) {
          steer(
            state,
            botSteer(state, bot, BOT_PROFILES[difficulty], STEP, rng.float(), rng.float()),
          );
          stepSeat(state, STEP, rng);
          steps += 1;
        }
        total += steps;
      }
      return total / runs;
    };
    const hard = survive('hard');
    const easy = survive('easy');
    expect(hard, `hard ${hard.toFixed(0)} steps vs easy ${easy.toFixed(0)}`).toBeGreaterThan(easy);
  });

  it('sees further and errs less as the difficulty rises', () => {
    // The direction of this comparison is the whole point: my first version expressed
    // difficulty as seconds of hesitation and subtracted `speed * seconds` from the car,
    // which made the *slower* bot look further ahead — the easy tier survived twenty
    // times longer than the hard one.
    expect(BOT_PROFILES.hard.lookahead).toBeGreaterThan(BOT_PROFILES.normal.lookahead);
    expect(BOT_PROFILES.normal.lookahead).toBeGreaterThan(BOT_PROFILES.easy.lookahead);
    expect(BOT_PROFILES.easy.mistake).toBeGreaterThan(BOT_PROFILES.hard.mistake);
    expect(BOT_PROFILES.hard.mistake).toBe(0);
    expect(BOT_PROFILES.hard.hesitation, 'the hard tier never freezes').toBe(0);
    expect(BOT_PROFILES.easy.recentre, 'only the better tiers wait in the middle').toBe(0);
    expect(BOT_PROFILES.hard.recentre).toBe(1);
  });

  it('heads for the lane that stays clear, not merely the one clear right now', () => {
    // Removing the pathing left every other test green, so this pins it directly.
    //
    // The car is in the middle with an obstacle bearing down on it. Both edges are empty
    // *at this instant*, so a bot that only looks at the next lane will happily take
    // either — but lane 0 has an obstacle further up inside the look-ahead window, so
    // turning there only buys a moment. Lane 2 is the one that stays clear.
    const state = createSeatState();
    const bot = createBotState();
    emptyPool(state);
    const middle = Math.floor(LANES / 2);
    state.lane = middle;
    state.position = middle;

    spawn(state, middle);
    const threat = state.obstacles[0];
    spawn(state, 0);
    const later = state.obstacles[1];
    if (!threat || !later) throw new Error('the fixture needs two obstacles');
    threat.y = CAR_Y - 90;
    later.y = CAR_Y - 240;

    expect(laneIsClear(state, 0), 'lane 0 is clear right now').toBe(true);
    expect(laneIsClear(state, 0, 300), 'but not over the look-ahead window').toBe(false);
    expect(laneIsClear(state, 2, 300), 'lane 2 is the one that stays clear').toBe(true);

    const profile = { lookahead: 300, mistake: 0, hesitation: 0, recentre: 0 };
    // choiceRoll 0 would pick the first adjacent option, which is the left one — so a
    // right turn here can only have come from choosing the lane that stays clear.
    expect(botSteer(state, bot, profile, STEP, 0.9, 0)).toBe(1);
  });

  it('holds a hesitation across steps rather than re-deciding it', () => {
    // The bug this pins: `botSteer` runs on all sixty steps a second, so a mistake that
    // lasted one step was re-decided 16ms later and cost nothing at all — sweeping the
    // rate from 0 to 0.5 moved survival by 0.00s. A hesitation has to persist to exist.
    const state = createSeatState();
    const bot = createBotState();
    emptyPool(state);
    spawn(state, state.lane);
    const obstacle = state.obstacles[0];
    if (!obstacle) throw new Error('the fixture needs an obstacle');
    obstacle.y = CAR_Y - 120;

    const profile = { lookahead: 300, mistake: 1, hesitation: 0.25, recentre: 0 };
    expect(botSteer(state, bot, profile, STEP, 0.0, 0.5), 'a certain mistake freezes').toBe(0);
    expect(bot.frozen, 'and the freeze is remembered').toBeCloseTo(0.25, 5);

    // Now it would steer if asked afresh — but it is frozen, so it does not.
    const willing = { ...profile, mistake: 0 };
    expect(botSteer(state, bot, willing, STEP, 0.9, 0.5), 'still frozen').toBe(0);
    expect(bot.frozen).toBeLessThan(0.25);

    for (let i = 0; i < 60; i += 1) botSteer(state, bot, willing, STEP, 0.9, 0.5);
    expect(bot.frozen, 'the freeze runs out').toBe(0);
    expect(botSteer(state, bot, willing, STEP, 0.9, 0.5), 'and then it dodges').not.toBe(0);
  });

  it('clears its hesitation on reset', () => {
    const bot = createBotState();
    bot.frozen = 0.3;
    resetBotState(bot);
    expect(bot.frozen).toBe(0);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed', () => {
    const run = (): string => {
      const state = createSeatState();
      const bot = createBotState();
      const rng = new Rng(2024);
      const trace: string[] = [];
      for (let i = 0; i < 2000 && !state.crashed; i += 1) {
        steer(state, botSteer(state, bot, BOT_PROFILES.normal, STEP, rng.float(), rng.float()));
        stepSeat(state, STEP, rng);
        trace.push(`${String(state.lane)}:${String(state.passed)}`);
      }
      return trace.join('|');
    };
    expect(run()).toBe(run());
  });

  it('is driven by the fixed delta rather than the wall clock', () => {
    // The same total simulated time in different-sized steps must agree.
    const coarse = createSeatState();
    emptyPool(coarse);
    const fine = createSeatState();
    emptyPool(fine);
    for (let i = 0; i < 30; i += 1) stepSeat(coarse, 1 / 30, new Rng(1));
    for (let i = 0; i < 60; i += 1) stepSeat(fine, 1 / 60, new Rng(1));
    expect(coarse.elapsed).toBeCloseTo(fine.elapsed, 6);
  });
});
