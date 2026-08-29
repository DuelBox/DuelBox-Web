import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import { manifest } from './manifest.js';
import {
  AIM_PERIOD,
  AIM_RATE,
  BALL_HALF_X,
  BALL_HALF_Y,
  BALL_RADIUS,
  BOT_PROFILES,
  DRAG_RATE,
  HOME_Y,
  HOOP_HALF,
  HOOP_Y,
  INITIAL_AIM,
  LOOK_SECONDS,
  MATCH_SECONDS,
  MAX_SPEED,
  POST_RADIUS,
  POST_X,
  PRESS_BOUND_SECONDS,
  REGROUP_SECONDS,
  STOP_SPEED,
  START_DELAY,
  TARGET_POINTS,
  THRUST_COOLDOWN,
  THRUST_SPEED,
  WATER_DRAG,
  botPlan,
  botStep,
  botStepWith,
  coastDistance,
  createBotState,
  createState,
  crossedHoop,
  reachOf,
  resetBotState,
  resetState,
  secondsLeft,
  shotValue,
  shove,
  speedAfter,
  step,
} from './rules.js';
import type { Ball, BotDifficulty, State } from './rules.js';

const STEP = 1 / 60;

/* ------------------------------------------------------------------ utilities */

function placeBall(ball: Ball, x: number, y: number, vx: number, vy: number): void {
  ball.x = x;
  ball.y = y;
  ball.vx = vx;
  ball.vy = vy;
  ball.prevX = x;
  ball.prevY = y;
  ball.cooldown = 0;
}

/** A ball parked out of the way, so a test can watch one ball on its own. */
function park(ball: Ball): void {
  placeBall(ball, 0, HOME_Y, 0, 0);
  ball.cooldown = 1e9;
}

function snapshot(ball: Readonly<Ball>): readonly number[] {
  return [ball.x, ball.y, ball.vx, ball.vy, ball.aim, ball.cooldown, ball.prevX, ball.prevY];
}

/** Bit-for-bit, including the sign of zero. "Nearly the same" diverges by the hundredth step. */
function identical(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
}

interface Match {
  readonly winner: State['winner'];
  readonly p1: number;
  readonly p2: number;
  readonly seconds: number;
  readonly steps: number;
  readonly worstGap: number;
  readonly presses: number;
}

/** Play a whole bot match, exactly the way `game.ts` wires one up. */
function playMatch(
  tierP1: BotDifficulty,
  tierP2: BotDifficulty,
  seed: number,
  opening: 'p1' | 'p2' = 'p1',
  limitSteps = 60 * 900,
): Match {
  const state = createState();
  const botP1 = createBotState();
  const botP2 = createBotState();
  const master = new Rng(seed);
  const first = master.next() | 0;
  const second = master.next() | 0;
  // Exactly what `game.ts` does: the stream goes to the seat that opens, not to seat one.
  const rngP1 = new Rng(opening === 'p1' ? first : second);
  const rngP2 = new Rng(opening === 'p1' ? second : first);
  let steps = 0;
  let gapP1 = 0;
  let gapP2 = 0;
  let worstGap = 0;
  let presses = 0;
  while (state.winner === null && steps < limitSteps) {
    gapP1 += STEP;
    gapP2 += STEP;
    const p1 = botStep(state.p1Ball, tierP1, botP1, rngP1, STEP);
    const p2 = botStep(state.p2Ball, tierP2, botP2, rngP2, STEP);
    if (p1) {
      worstGap = Math.max(worstGap, gapP1);
      gapP1 = 0;
      presses += 1;
    }
    if (p2) {
      worstGap = Math.max(worstGap, gapP2);
      gapP2 = 0;
      presses += 1;
    }
    step(state, STEP, p1, p2);
    steps += 1;
  }
  return {
    winner: state.winner,
    p1: state.p1,
    p2: state.p2,
    seconds: state.clock,
    steps,
    worstGap,
    presses,
  };
}

/* -------------------------------------------------------------------- the tank */

describe('the tank', () => {
  it('starts level, with both balls on the same spot in their own frames', () => {
    const state = createState();
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(state.winner).toBeNull();
    expect(snapshot(state.p1Ball)).toEqual(snapshot(state.p2Ball));
    expect(state.p1Ball.y).toBe(HOME_Y);
    expect(state.p1Ball.aim).toBe(INITIAL_AIM);
    expect(state.p1Ball.cooldown).toBe(START_DELAY);
  });

  it('leaves clear water between the widest scoring ball and the nearest post', () => {
    // The threshold family that costs whole afternoons: a state variable that lands on a
    // threshold *by construction* rather than by coincidence. If a ball whose centre is on
    // the edge of the mouth were exactly touching the post, "scored" and "hit the post"
    // would be one event decided in the last bits of a float.
    const scoringRim = HOOP_HALF + BALL_RADIUS;
    const postRim = POST_X - POST_RADIUS;
    expect(postRim - scoringRim).toBeGreaterThanOrEqual(8);
  });

  it('has a pocket deep enough to hold a ball that has gone through', () => {
    expect(BALL_HALF_Y - HOOP_Y).toBeGreaterThan(BALL_RADIUS * 2);
  });

  it('starts each ball on the playing side of the other seat’s mouth', () => {
    // Otherwise a ball would sit in the opponent's scoring pocket from the first frame.
    expect(HOME_Y).toBeLessThan(HOOP_Y);
  });

  it('keeps every ball inside the water, however hard it is shoved', () => {
    const state = createState();
    park(state.p2Ball);
    const rng = new Rng(5);
    for (let trial = 0; trial < 200; trial += 1) {
      const heading = rng.float() * Math.PI * 2;
      placeBall(
        state.p1Ball,
        (rng.float() * 2 - 1) * BALL_HALF_X,
        (rng.float() * 2 - 1) * BALL_HALF_Y,
        Math.cos(heading) * MAX_SPEED,
        Math.sin(heading) * MAX_SPEED,
      );
      for (let i = 0; i < 240; i += 1) {
        park(state.p2Ball);
        step(state, STEP, false, false);
        expect(Math.abs(state.p1Ball.x)).toBeLessThanOrEqual(BALL_HALF_X + 1e-9);
        expect(Math.abs(state.p1Ball.y)).toBeLessThanOrEqual(BALL_HALF_Y + 1e-9);
      }
    }
  });

  it('never lets a ball exceed the speed limit', () => {
    const ball = createState().p1Ball;
    placeBall(ball, 0, 0, 0, 0);
    for (let i = 0; i < 40; i += 1) {
      ball.aim = 0;
      shove(ball);
      expect(Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy)).toBeLessThanOrEqual(
        MAX_SPEED + 1e-9,
      );
    }
  });
});

/* ------------------------------------------------------- the water, issue #2465 */

describe('the water is integrated analytically', () => {
  /** Swim one ball straight down a clear lane, clear of both mouths and all four posts. */
  function swim(speed: number, seconds: number, hz: number): number {
    const state = createState();
    park(state.p2Ball);
    placeBall(state.p1Ball, 200, -450, 0, speed);
    state.p1Ball.cooldown = 1e9;
    const steps = Math.round(seconds * hz);
    for (let i = 0; i < steps; i += 1) {
      park(state.p2Ball);
      state.p1Ball.cooldown = 1e9;
      step(state, 1 / hz, false, false);
    }
    return state.p1Ball.y;
  }

  const SPEEDS = [550, 500, 400, 300, 200, 120, 60, 30, 20, 15, 13];

  it('puts the ball in the same place at 60, 90, 120 and 240 Hz', () => {
    for (const speed of SPEEDS) {
      const baseline = swim(speed, 1.2, 60);
      for (const hz of [90, 120, 240]) {
        // Nine decimal places. Forward Euler would be out by dt·rate/2 — 0.50% at 60 Hz
        // against 0.12% at 240 Hz, which is 3.4 units on a 680-unit shot.
        expect(swim(speed, 1.2, hz)).toBeCloseTo(baseline, 9);
      }
    }
  });

  it('swims exactly reachOf(v) before it stops, at every step rate', () => {
    for (const speed of SPEEDS) {
      for (const hz of [60, 90, 120, 240]) {
        expect(swim(speed, 14, hz) + 450).toBeCloseTo(reachOf(speed), 9);
      }
    }
  });

  it('agrees with the closed forms the bot uses', () => {
    for (const speed of SPEEDS) {
      for (const seconds of [0.1, 0.4, 1, 2.5]) {
        const travelled = swim(speed, seconds, 60) + 450;
        expect(travelled).toBeCloseTo(coastDistance(speed, seconds), 9);
      }
    }
  });

  it('reports the decayed speed the bot predicts', () => {
    for (const speed of SPEEDS) {
      expect(speedAfter(speed, 1)).toBeCloseTo(
        speed * WATER_DRAG > STOP_SPEED ? speed * WATER_DRAG : 0,
        12,
      );
    }
  });

  it('would disagree with itself if it stepped by v · dt', () => {
    // The measurement behind the doc comment, so the number in it cannot go stale. Euler
    // integrating the same decay overshoots by dt·rate/2 per step.
    const euler = (speed: number, hz: number): number => {
      let v = speed;
      let travelled = 0;
      const keep = Math.pow(WATER_DRAG, 1 / hz);
      while (v > STOP_SPEED) {
        travelled += v / hz;
        v *= keep;
      }
      return travelled;
    };
    const exact = reachOf(400);
    expect((euler(400, 60) - exact) / exact).toBeCloseTo(DRAG_RATE / 60 / 2, 3);
    expect((euler(400, 240) - exact) / exact).toBeCloseTo(DRAG_RATE / 240 / 2, 3);
  });
});

/* ------------------------------------------------------------------- the basket */

describe('a goal', () => {
  function crossing(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const ball = createState().p1Ball;
    ball.prevX = fromX;
    ball.prevY = fromY;
    ball.x = toX;
    ball.y = toY;
    return crossedHoop(ball);
  }

  it('counts a ball that leaves through the mouth', () => {
    expect(crossing(0, -HOOP_Y + 5, 0, -HOOP_Y - 5)).toBe(true);
    expect(crossing(HOOP_HALF - 1, -HOOP_Y + 40, HOOP_HALF - 1, -HOOP_Y - 40)).toBe(true);
  });

  it('does not count a ball that goes past the outside of a post', () => {
    expect(crossing(HOOP_HALF + 20, -HOOP_Y + 5, HOOP_HALF + 20, -HOOP_Y - 5)).toBe(false);
  });

  it('does not count a ball coming back in from the pocket', () => {
    expect(crossing(0, -HOOP_Y - 5, 0, -HOOP_Y + 5)).toBe(false);
  });

  it('catches a ball that clears the whole mouth inside one step', () => {
    // The reason the test is a segment crossing and not a point test. Even at four times
    // the speed limit and a 60 Hz step, a ball cannot pass through unnoticed.
    expect(crossing(0, -HOOP_Y + 30, 0, -HOOP_Y - 300)).toBe(true);
  });

  it('is scored, and puts the ball back on its own spot', () => {
    const state = createState();
    park(state.p2Ball);
    placeBall(state.p1Ball, 0, -HOOP_Y + 4, 0, -300);
    step(state, STEP, false, false);
    expect(state.p1).toBe(1);
    expect(state.p1Scored).toBe(true);
    expect(state.p1Ball.y).toBe(HOME_Y);
    expect(state.p1Ball.vx).toBe(0);
    expect(state.p1Ball.vy).toBe(0);
    expect(state.p1Ball.cooldown).toBe(REGROUP_SECONDS);
    expect(state.p1Ball.aim).toBe(INITIAL_AIM);
  });

  it('is what the match is first to fifteen of', () => {
    const state = createState();
    park(state.p2Ball);
    for (let goal = 0; goal < TARGET_POINTS; goal += 1) {
      expect(state.winner).toBeNull();
      placeBall(state.p1Ball, 0, -HOOP_Y + 4, 0, -300);
      step(state, STEP, false, false);
    }
    expect(state.p1).toBe(TARGET_POINTS);
    expect(state.winner).toBe('p1');
  });
});

/* --------------------------------------------------------------------- the press */

describe('the press', () => {
  it('adds speed rather than setting it', () => {
    const ball = createState().p1Ball;
    placeBall(ball, 0, 0, 0, 0);
    ball.aim = 0;
    shove(ball);
    expect(ball.vx).toBeCloseTo(THRUST_SPEED, 9);
    shove(ball);
    expect(ball.vx).toBeCloseTo(THRUST_SPEED * 2, 9);
  });

  it('is refused while the ball is still cooling', () => {
    const state = createState();
    park(state.p2Ball);
    placeBall(state.p1Ball, 0, 0, 0, 0);
    state.p1Ball.aim = 0;
    step(state, STEP, true, false);
    const afterFirst = state.p1Ball.vx;
    expect(afterFirst).toBeGreaterThan(0);
    // Every step for the whole of the cooldown, and not one of them lands.
    for (let i = 0; i < Math.floor(THRUST_COOLDOWN / STEP) - 1; i += 1) {
      const before = Math.sqrt(state.p1Ball.vx ** 2 + state.p1Ball.vy ** 2);
      park(state.p2Ball);
      step(state, STEP, true, false);
      const after = Math.sqrt(state.p1Ball.vx ** 2 + state.p1Ball.vy ** 2);
      expect(after).toBeLessThan(before + 1e-9);
    }
  });

  it('is self-defeating when it is mashed', () => {
    // The design claim in THRUST_COOLDOWN's comment, measured rather than asserted: a player
    // pressing as fast as the game will take it spreads their shoves evenly round the circle.
    const mashed = createState();
    park(mashed.p2Ball);
    const aimed = createState();
    park(aimed.p2Ball);
    for (let i = 0; i < 60 * 30; i += 1) {
      park(mashed.p2Ball);
      park(aimed.p2Ball);
      step(mashed, STEP, true, false);
      // The same number of presses, but only when the pointer faces the basket.
      const facing = Math.sin(aimed.p1Ball.aim) < -0.985;
      step(aimed, STEP, facing, false);
    }
    expect(mashed.p1).toBe(0);
    expect(aimed.p1).toBeGreaterThanOrEqual(3);
  });

  it('turns the pointer at a steady rate and never reverses it', () => {
    const state = createState();
    park(state.p2Ball);
    let previous = state.p1Ball.aim;
    let wraps = 0;
    for (let i = 0; i < 60 * 10; i += 1) {
      park(state.p2Ball);
      step(state, STEP, false, false);
      const delta = state.p1Ball.aim - previous;
      if (delta < 0) {
        wraps += 1;
        expect(delta).toBeCloseTo(AIM_RATE * STEP - Math.PI * 2, 9);
      } else {
        expect(delta).toBeCloseTo(AIM_RATE * STEP, 9);
      }
      previous = state.p1Ball.aim;
    }
    expect(wraps).toBe(Math.floor(10 / AIM_PERIOD));
  });
});

/* ------------------------------------------------------- the board is its own mirror */

describe('the board is its own mirror', () => {
  /**
   * The test that finds what nothing else can, and the reason it is written the way it is.
   *
   * Every ball is held in its **own seat's frame**, and the tank, the mouths and the four
   * posts are all unchanged by the half-turn — so mirroring a board is simply *swapping the
   * two balls' own-frame states*, with no arithmetic at all. Step both, and the results must
   * be the mirror of each other bit for bit.
   *
   * A third of the boards put the two balls on top of one another, because the one place in
   * the whole simulation that has to leave a seat's own frame is the contact between them.
   */
  function mirrorTrial(seed: number, trials: number): { diverged: number; contacts: number } {
    const rng = new Rng(seed);
    let diverged = 0;
    let contacts = 0;
    for (let trial = 0; trial < trials; trial += 1) {
      const near = trial % 3 === 0;
      const spread = near ? 40 : 1;
      const draw = (): Ball => {
        const x = (rng.float() * 2 - 1) * (near ? spread : BALL_HALF_X);
        const y = (rng.float() * 2 - 1) * (near ? spread : BALL_HALF_Y);
        const heading = rng.float() * Math.PI * 2;
        const speed = rng.float() * MAX_SPEED;
        return {
          x,
          y,
          vx: Math.cos(heading) * speed,
          vy: Math.sin(heading) * speed,
          aim: rng.float() * Math.PI * 2,
          cooldown: rng.bool() ? 0 : rng.float() * 0.3,
          prevX: x,
          prevY: y,
        };
      };
      const one = draw();
      const two = draw();
      const pressOne = rng.bool(0.35);
      const pressTwo = rng.bool(0.35);

      const board = createState();
      Object.assign(board.p1Ball, one);
      Object.assign(board.p2Ball, two);
      const mirrored = createState();
      Object.assign(mirrored.p1Ball, two);
      Object.assign(mirrored.p2Ball, one);

      const dx = -two.x - one.x;
      const dy = -two.y - one.y;
      if (dx * dx + dy * dy < (BALL_RADIUS * 2) ** 2) contacts += 1;

      step(board, STEP, pressOne, pressTwo);
      step(mirrored, STEP, pressTwo, pressOne);

      const ok =
        identical(snapshot(board.p1Ball), snapshot(mirrored.p2Ball)) &&
        identical(snapshot(board.p2Ball), snapshot(mirrored.p1Ball)) &&
        board.p1 === mirrored.p2 &&
        board.p2 === mirrored.p1;
      if (!ok) diverged += 1;
    }
    return { diverged, contacts };
  }

  it('steps a mirrored board to the mirrored result, bit for bit', () => {
    const { diverged, contacts } = mirrorTrial(4242, 1200);
    expect(contacts, 'the trials never put the two balls in contact').toBeGreaterThan(100);
    expect(diverged).toBe(0);
  });

  it('reads the same shot value for either seat', () => {
    // The bot takes a *ball*, never a seat: there is no seat-dependent branch in it to get
    // the wrong way round. This asserts the property that fact is supposed to buy.
    const rng = new Rng(99);
    for (let trial = 0; trial < 300; trial += 1) {
      const heading = rng.float() * Math.PI * 2;
      const speed = rng.float() * MAX_SPEED;
      const seed: Ball = {
        x: (rng.float() * 2 - 1) * BALL_HALF_X,
        y: (rng.float() * 2 - 1) * BALL_HALF_Y,
        vx: Math.cos(heading) * speed,
        vy: Math.sin(heading) * speed,
        aim: rng.float() * Math.PI * 2,
        cooldown: 0,
        prevX: 0,
        prevY: 0,
      };
      const board = createState();
      Object.assign(board.p1Ball, seed);
      const mirrored = createState();
      Object.assign(mirrored.p2Ball, seed);
      for (const delay of [0, 0.3, 1.1, 2.2]) {
        expect(Object.is(shotValue(board.p1Ball, delay), shotValue(mirrored.p2Ball, delay))).toBe(
          true,
        );
      }
    }
  });

  it('plays the exact mirror of a match when the two bot streams change hands', () => {
    // What `game.ts` does with `openingSeat`, and what makes seat one's share 50.0% by
    // construction rather than 49.7% by sampling. Asserted seed by seed.
    let p1Wins = 0;
    let decided = 0;
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 12; seed += 1) {
        const a = playMatch(tier, tier, 14000 + seed, 'p1');
        const b = playMatch(tier, tier, 14000 + seed, 'p2');
        expect(a.p1).toBe(b.p2);
        expect(a.p2).toBe(b.p1);
        expect(a.steps).toBe(b.steps);
        expect(a.winner === 'p1' ? 'p2' : a.winner === 'p2' ? 'p1' : a.winner).toBe(b.winner);
        for (const match of [a, b]) {
          if (match.winner === 'p1') {
            p1Wins += 1;
            decided += 1;
          } else if (match.winner === 'p2') decided += 1;
        }
      }
    }
    expect(decided).toBeGreaterThan(60);
    expect(p1Wins / decided).toBe(0.5);
  });
});

/* ------------------------------------------------------------------ determinism */

describe('determinism', () => {
  it('replays a match exactly from the same seed', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const a = playMatch(tier, tier, 777);
      const b = playMatch(tier, tier, 777);
      expect(a).toEqual(b);
    }
  });

  it('plays a different match from a different seed', () => {
    const a = playMatch('normal', 'normal', 1);
    const b = playMatch('normal', 'normal', 2);
    expect(a).not.toEqual(b);
  });

  it('is unaffected by the order the two seats are polled in', () => {
    // Each seat draws from its own generator, so nothing about seat one's play can depend on
    // how much randomness seat two has consumed.
    for (let seed = 0; seed < 8; seed += 1) {
      const forwards = createState();
      const backwards = createState();
      const botsA = [createBotState(), createBotState()];
      const botsB = [createBotState(), createBotState()];
      const master = new Rng(2200 + seed);
      const first = master.next() | 0;
      const second = master.next() | 0;
      const rngsA = [new Rng(first), new Rng(second)];
      const rngsB = [new Rng(first), new Rng(second)];
      for (let i = 0; i < 60 * 30; i += 1) {
        const a1 = botStep(forwards.p1Ball, 'normal', botsA[0]!, rngsA[0]!, STEP);
        const a2 = botStep(forwards.p2Ball, 'normal', botsA[1]!, rngsA[1]!, STEP);
        const b2 = botStep(backwards.p2Ball, 'normal', botsB[1]!, rngsB[1]!, STEP);
        const b1 = botStep(backwards.p1Ball, 'normal', botsB[0]!, rngsB[0]!, STEP);
        step(forwards, STEP, a1, a2);
        step(backwards, STEP, b1, b2);
      }
      expect(snapshot(forwards.p1Ball)).toEqual(snapshot(backwards.p1Ball));
      expect(snapshot(forwards.p2Ball)).toEqual(snapshot(backwards.p2Ball));
      expect([forwards.p1, forwards.p2]).toEqual([backwards.p1, backwards.p2]);
    }
  });

  it('resets everything a match touched', () => {
    const state = createState();
    const fresh = createState();
    const bot = createBotState();
    const rng = new Rng(3);
    for (let i = 0; i < 600; i += 1) {
      const press = botStep(state.p1Ball, 'hard', bot, rng, STEP);
      step(state, STEP, press, false);
    }
    resetState(state);
    resetBotState(bot);
    expect(snapshot(state.p1Ball)).toEqual(snapshot(fresh.p1Ball));
    expect(snapshot(state.p2Ball)).toEqual(snapshot(fresh.p2Ball));
    expect([state.p1, state.p2, state.clock, state.winner]).toEqual([0, 0, 0, null]);
    expect(bot).toEqual(createBotState());
  });
});

/* ----------------------------------------------------------------- termination */

describe('the match always ends', () => {
  it('ends on the clock when neither seat ever presses', () => {
    const state = createState();
    let steps = 0;
    while (state.winner === null) {
      step(state, STEP, false, false);
      steps += 1;
      expect(steps, 'a match with no input ran past its own clock').toBeLessThan(
        Math.ceil(MATCH_SECONDS / STEP) + 4,
      );
    }
    expect(state.winner).toBe('draw');
    expect(state.clock).toBeGreaterThanOrEqual(MATCH_SECONDS);
    expect(secondsLeft(state)).toBe(0);
  });

  it('finishes inside ten simulated minutes with two easy bots', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const match = playMatch('easy', 'easy', 6000 + seed);
      expect(match.winner).not.toBeNull();
      expect(match.seconds).toBeLessThanOrEqual(MATCH_SECONDS + STEP);
      expect(match.seconds).toBeLessThan(600);
    }
  });

  it('does not need the clock to end a bot match', () => {
    // "First to fifteen" is only a real win condition if the weakest pair can get there.
    let onClock = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const match = playMatch('easy', 'easy', 6100 + seed);
      if (match.p1 < TARGET_POINTS && match.p2 < TARGET_POINTS) onClock += 1;
    }
    expect(onClock).toBe(0);
  });

  it('advertises the clock it actually runs', () => {
    expect(manifest.roundSeconds).toBe(MATCH_SECONDS);
  });

  it('stops simulating once it is decided', () => {
    const state = createState();
    state.p1 = TARGET_POINTS;
    step(state, STEP, false, false);
    expect(state.winner).toBe('p1');
    const frozen = snapshot(state.p1Ball);
    for (let i = 0; i < 60; i += 1) step(state, STEP, true, true);
    expect(snapshot(state.p1Ball)).toEqual(frozen);
  });
});

/* ------------------------------------------------------------------------ bots */

describe('the bot', () => {
  it('draws exactly two values a look, whatever the water looks like', () => {
    const rng = new Rng(11);
    const probe = new Rng(11);
    const bot = createBotState();
    const state = createState();
    let drawn = 0;
    for (let look = 0; look < 40; look += 1) {
      placeBall(
        state.p1Ball,
        (probe.float() * 2 - 1) * BALL_HALF_X,
        (probe.float() * 2 - 1) * BALL_HALF_Y,
        probe.float() * MAX_SPEED,
        probe.float() * MAX_SPEED,
      );
      state.p1Ball.aim = probe.float() * Math.PI * 2;
      bot.armed = false;
      const before = drawn;
      const reference = new Rng(11);
      for (let i = 0; i < drawn; i += 1) reference.float();
      botPlan(state.p1Ball, BOT_PROFILES.normal, bot, rng);
      drawn += 2;
      expect(drawn - before).toBe(2);
      // The stream really is where two draws would leave it.
      const echo = new Rng(11);
      for (let i = 0; i < drawn; i += 1) echo.float();
      expect(rng.float()).toBe(echo.float());
      drawn += 1;
    }
  });

  it('presses inside its own bound, over a long match', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 6; seed += 1) {
        const match = playMatch(tier, tier, 12000 + seed);
        expect(match.presses).toBeGreaterThan(100);
        expect(match.worstGap).toBeLessThanOrEqual(PRESS_BOUND_SECONDS);
      }
    }
  });

  it('never reaches for anything a person cannot see', () => {
    // `shotValue` is handed one ball and a delay. It cannot read the other ball, the other
    // bot's plans, or the clock, because none of them are in scope — which is the only kind
    // of guarantee about rule 6 worth having. This asserts the shape that makes it true.
    expect(shotValue.length).toBe(2);
    expect(botPlan.length).toBe(4);
  });

  it('is a monotone ladder on press error, all else equal', () => {
    const solo = (pressError: number): number => {
      let total = 0;
      for (let seed = 0; seed < 6; seed += 1) {
        const state = createState();
        const bot = createBotState();
        const rng = new Rng(31337 + seed);
        let steps = 0;
        while (state.p1 < 6 && steps < 60 * 400) {
          const press = botStepWith(
            state.p1Ball,
            { pressError, aimSamples: BOT_PROFILES.hard.aimSamples },
            bot,
            rng,
            STEP,
          );
          state.p2Ball.cooldown = 1e9;
          state.clock = 0;
          step(state, STEP, press, false);
          steps += 1;
        }
        total += steps * STEP;
      }
      return total / 6;
    };
    // Only across the stretch the three tiers are drawn from; SPEC.md carries the whole
    // sweep, including the flat piece below 0.12 where the mouth swallows the error.
    const slow = solo(0.45);
    const middle = solo(0.2);
    const fast = solo(0.06);
    expect(fast).toBeLessThan(middle);
    expect(middle).toBeLessThan(slow);
  });

  it('is a monotone ladder on how many moments it weighs up', () => {
    const solo = (aimSamples: number): number => {
      let total = 0;
      for (let seed = 0; seed < 6; seed += 1) {
        const state = createState();
        const bot = createBotState();
        const rng = new Rng(555 + seed);
        let steps = 0;
        while (state.p1 < 6 && steps < 60 * 400) {
          const press = botStepWith(
            state.p1Ball,
            { pressError: BOT_PROFILES.hard.pressError, aimSamples },
            bot,
            rng,
            STEP,
          );
          state.p2Ball.cooldown = 1e9;
          state.clock = 0;
          step(state, STEP, press, false);
          steps += 1;
        }
        total += steps * STEP;
      }
      return total / 6;
    };
    expect(solo(14)).toBeLessThan(solo(5));
    expect(solo(5)).toBeLessThan(solo(2));
  });

  it('beats the tier below it, from both seats', () => {
    const duel = (
      subject: BotDifficulty,
      foil: BotDifficulty,
      subjectSeat: 'p1' | 'p2',
    ): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 0; seed < 24; seed += 1) {
        const match =
          subjectSeat === 'p1'
            ? playMatch(subject, foil, 7000 + seed)
            : playMatch(foil, subject, 7000 + seed);
        if (match.winner === subjectSeat) wins += 1;
        if (match.winner === 'p1' || match.winner === 'p2') decided += 1;
      }
      return decided === 0 ? 0 : wins / decided;
    };
    for (const [subject, foil] of [
      ['hard', 'normal'],
      ['normal', 'easy'],
      ['hard', 'easy'],
    ] as const) {
      for (const seat of ['p1', 'p2'] as const) {
        expect(duel(subject, foil, seat), `${subject} v ${foil} from ${seat}`).toBeGreaterThan(0.6);
      }
    }
  });

  it('has three tiers whose knobs both point the same way', () => {
    expect(BOT_PROFILES.easy.pressError).toBeGreaterThan(BOT_PROFILES.normal.pressError);
    expect(BOT_PROFILES.normal.pressError).toBeGreaterThan(BOT_PROFILES.hard.pressError);
    expect(BOT_PROFILES.easy.aimSamples).toBeLessThan(BOT_PROFILES.normal.aimSamples);
    expect(BOT_PROFILES.normal.aimSamples).toBeLessThan(BOT_PROFILES.hard.aimSamples);
    // Every tier looks at the water on the same schedule; see LOOK_SECONDS for the sweep
    // that took this off the ladder.
    expect(LOOK_SECONDS).toBeGreaterThan(0);
  });
});
