import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { PinballDuelGame, GOAL_TARGET, IDLE_STEPS, MATCH_SECONDS, SERVE_STEPS } from './game.js';
import { manifest } from './manifest.js';
import type { BotDifficulty, FlipperSide } from './rules.js';
import {
  CENTRE_X,
  GOAL_HALF_WIDTH,
  MAX_BALL_SPEED,
  TABLE,
  otherSide,
  seatSide,
  serveSpotX,
  serveSpotY,
} from './rules.js';

/**
 * Pinball Duel as the shell drives it.
 *
 * The load-bearing test in this file is `goals actually happen`. Twenty games were built the
 * same night as this one and one of them shipped with its headline verb impossible: across
 * four hundred bot matches the thing its own rule text describes never once occurred, and all
 * nine global guards passed the whole time, because a match still ended and still reported a
 * winner. The guards check that a game **terminates**, not that it **plays**. So the goal
 * count here is reconstructed from sampled ball positions rather than read off the score:
 * a counter can be wrong in exactly the same way the rule is.
 */

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const SIDES: readonly FlipperSide[] = ['left', 'right'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
/** One more step than a whole match, so a run that does not finish is a failure not a hang. */
const MATCH_STEPS = Math.ceil(MATCH_SECONDS / STEP) + 120;

function contextFor(
  seed: number,
  difficulty: (seat: SeatId) => BotDifficulty | null,
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    // Pinball has no opener — it is real-time and both flippers are live from the first
    // step — but the context carries one for every game, so it is supplied rather than
    // left undefined. The seat-mirroring tests below vary `localSeat`, not this.
    openingSeat: 'p1',
    botDifficulty: difficulty,
  };
}

function bots(tier: BotDifficulty | ((seat: SeatId) => BotDifficulty)) {
  return typeof tier === 'function' ? tier : (): BotDifficulty => tier;
}

function idleInput(): { input: InputManager; view: InputView } {
  return {
    input: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

/** Every method a renderer has, counting calls and remembering the numbers it was given. */
function recorder(): { renderer: Renderer; calls: () => number; numbers: () => number[] } {
  let calls = 0;
  const numbers: number[] = [];
  const record = (...args: unknown[]): void => {
    calls += 1;
    for (const arg of args) if (typeof arg === 'number') numbers.push(arg);
  };
  const renderer: Renderer = {
    clear: () => {
      calls += 1;
    },
    rect: record,
    strokeRect: record,
    circle: record,
    strokeCircle: record,
    line: record,
    text: record,
    pushSeatRotation: () => undefined,
    pushRotation: () => undefined,
    popSeatRotation: () => undefined,
  };
  return { renderer, calls: () => calls, numbers: () => numbers };
}

interface Report {
  readonly winner: SeatId | 'draw' | null;
  readonly p1: number;
  readonly p2: number;
  readonly steps: number;
  /** Goals counted from the ball's own path, never from the score. */
  readonly seenGoals: number;
  readonly seenP1: number;
  readonly seenP2: number;
  readonly stallResets: number;
  readonly longestRallySteps: number;
  readonly maxSpeed: number;
}

/**
 * Play one whole bot match and reconstruct what happened from the ball.
 *
 * A goal is detected from the ball coming to a **dead stop**. The speed floor means a ball
 * in play is never slower than MIN_BALL_SPEED, so a velocity of exactly zero can only be a
 * ball parked on a serve spot — and where it was on the step before says whether it had just
 * gone out through a mouth and whose. Nothing here reads `getScore` to decide that a goal
 * happened.
 *
 * The first version of this detector looked for a large jump in position instead, and
 * over-counted: a flipper sweeping into a ball can push it more than a step of travel, so
 * "moved a long way" and "was put back" are not the same event. Two goals a match were
 * invented that way, which is exactly the sort of error a reconstruction is supposed to catch
 * rather than commit.
 */
function playMatch(
  seed: number,
  p1Tier: BotDifficulty | null,
  p2Tier: BotDifficulty | null,
): Report {
  const game = new PinballDuelGame();
  game.init(contextFor(seed, (seat) => (seat === 'p1' ? p1Tier : p2Tier)));
  const { input, view } = idleInput();
  let previousX = game.ball.x;
  let previousY = game.ball.y;
  let wasParked = true;
  let seenP1 = 0;
  let seenP2 = 0;
  let lastGoalStep = 0;
  let longestRallySteps = 0;
  let maxSpeed = 0;
  let steps = 0;
  let winner: SeatId | 'draw' | null = null;

  try {
    for (steps = 0; steps < MATCH_STEPS; steps += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      const ball = game.ball;
      maxSpeed = Math.max(maxSpeed, Math.hypot(ball.vx, ball.vy));
      const parked = ball.vx === 0 && ball.vy === 0;
      if (parked && !wasParked) {
        const throughMouth = Math.abs(previousX - CENTRE_X) < GOAL_HALF_WIDTH;
        const past = previousY > TABLE.height - 40 ? 'p2' : previousY < 40 ? 'p1' : null;
        if (throughMouth && past !== null) {
          if (past === 'p1') seenP1 += 1;
          else seenP2 += 1;
          longestRallySteps = Math.max(longestRallySteps, steps - lastGoalStep);
          lastGoalStep = steps;
        }
      }
      wasParked = parked;
      previousX = ball.x;
      previousY = ball.y;
      const score = game.getScore();
      if (score.winner !== null) {
        winner = score.winner;
        steps += 1;
        break;
      }
    }
    const score = game.getScore();
    return {
      winner,
      p1: score.p1,
      p2: score.p2,
      steps,
      seenGoals: seenP1 + seenP2,
      seenP1,
      seenP2,
      stallResets: game.stallResets,
      longestRallySteps,
      maxSpeed,
    };
  } finally {
    game.destroy();
  }
}

describe('the manifest', () => {
  it('declares the box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(TABLE.width);
    expect(manifest.logical.height).toBe(TABLE.height);
  });

  it('declares the split the host really gives a real-time game', () => {
    // GameHost only ever hands an `rt-*` game a horizontal or a vertical split; a manifest
    // saying `shared-board` would describe a surface the shell never builds.
    expect(manifest.archetype).toBe('rt-arena');
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.orientation).toBe('portrait');
  });

  it('offers both a friend and a bot, and both presentations', () => {
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
    expect(manifest.presentations).toContain('shared-screen');
    expect(manifest.presentations).toContain('single-seat');
  });

  it('has something to say to both input families', () => {
    expect(manifest.controls.keyboard.length).toBeGreaterThan(3);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
  });

  it('never offers the two keyboard halves as one player choice', () => {
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
    expect(manifest.controls.keyboard).toMatch(/player one|player two|seat|left|right|near|far/i);
    expect(manifest.controls.keyboard).toMatch(/a and d/i);
  });
});

describe('a fresh match', () => {
  it('starts level, with no winner and nothing served yet', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(1, () => null));
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
    expect(game.serveCountdown).toBe(SERVE_STEPS);
    expect(game.clock).toBe(MATCH_SECONDS);
    expect(game.stallResets).toBe(0);
    game.destroy();
  });

  it('parks the ball on the serve spot for the end it is aimed at', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const game = new PinballDuelGame();
      game.init(contextFor(seed, () => null));
      expect(game.ball.x).toBe(serveSpotX(game.serveTarget));
      expect(game.ball.y).toBe(serveSpotY(game.serveTarget));
      expect(game.ball.vx).toBe(0);
      expect(game.ball.vy).toBe(0);
      game.destroy();
    }
  });

  it('aims its first serve at either end depending on the seed', () => {
    const targets = new Set<SeatId>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const game = new PinballDuelGame();
      game.init(contextFor(seed * 977, () => null));
      targets.add(game.serveTarget);
      game.destroy();
    }
    expect(targets.size, 'the first serve must not always go the same way').toBe(2);
  });

  it('aims each serve at the other end from the last one', () => {
    // Alternating rather than "the conceding seat serves": the ball is a turn at attacking as
    // much as a thing to defend, so this is the only division of it that cannot accumulate.
    const game = new PinballDuelGame();
    game.init(contextFor(4242, bots('easy')));
    const { input, view } = idleInput();
    let served = game.serveTarget;
    let seenGoals = 0;
    let last = 0;
    for (let i = 0; i < MATCH_STEPS && seenGoals < 3; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      const total = game.getScore().p1 + game.getScore().p2;
      if (total === last) continue;
      last = total;
      seenGoals += 1;
      expect(game.serveTarget, `serve ${String(seenGoals)}`).toBe(served === 'p1' ? 'p2' : 'p1');
      served = game.serveTarget;
    }
    expect(seenGoals).toBe(3);
    game.destroy();
  });

  it('rests both flippers of both seats', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(1, () => null));
    for (const seat of SEATS) for (const side of SIDES) expect(game.phase(seat, side)).toBe(0);
    game.destroy();
  });

  it('holds the ball still until the countdown runs out, then launches it', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(99, () => null));
    const { input, view } = idleInput();
    for (let i = 0; i < SERVE_STEPS - 1; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      expect(game.ball.vx).toBe(0);
      expect(game.ball.vy).toBe(0);
    }
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.serveCountdown).toBe(0);
    expect(Math.hypot(game.ball.vx, game.ball.vy)).toBeGreaterThan(0);
    game.destroy();
  });

  it('starts a second match from the same state as the first', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(7, bots('normal')));
    const { input, view } = idleInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    game.init(contextFor(7, bots('normal')));
    expect(game.getScore().p1).toBe(0);
    expect(game.getScore().p2).toBe(0);
    expect(game.clock).toBe(MATCH_SECONDS);
    expect(game.serveCountdown).toBe(SERVE_STEPS);
    expect(game.stallResets).toBe(0);
    game.destroy();
  });
});

describe('the clock', () => {
  it('runs down on every step, serve countdowns included', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(3, () => null));
    const { input, view } = idleInput();
    for (let i = 1; i <= 30; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      expect(game.clock).toBeCloseTo(MATCH_SECONDS - i * STEP, 9);
    }
    expect(game.serveCountdown).toBeGreaterThan(0);
    game.destroy();
  });

  it('ends the match level as a draw when it runs out', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(11, bots('hard')));
    const { input, view } = idleInput();
    game.update(STEP, view.sync(input.beginStep(STEP)));
    game.clock = STEP / 2;
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.clock).toBe(0);
    const score = game.getScore();
    expect(score.winner).toBe(score.p1 === score.p2 ? 'draw' : score.p1 > score.p2 ? 'p1' : 'p2');
    game.destroy();
  });

  it('stops simulating once a winner is known', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(13, bots('hard')));
    const { input, view } = idleInput();
    game.update(STEP, view.sync(input.beginStep(STEP)));
    game.clock = 0;
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.getScore().winner).not.toBeNull();
    const frozen = { x: game.ball.x, y: game.ball.y, clock: game.clock };
    for (let i = 0; i < 60; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.ball.x).toBe(frozen.x);
    expect(game.ball.y).toBe(frozen.y);
    expect(game.clock).toBe(frozen.clock);
    game.destroy();
  });

  it('never runs past the ceiling the termination guard allows', () => {
    // Multiplied out rather than assumed: the clock is decremented every step whatever else
    // happens, so the longest possible match is exactly MATCH_SECONDS of simulated time.
    expect(MATCH_SECONDS).toBeLessThan(600);
    expect(Math.ceil(MATCH_SECONDS / STEP)).toBeLessThan(60 * 600);
  });
});

describe('goals actually happen', () => {
  it('scores through a reconstructed ball path in every seeded bot match', () => {
    let total = 0;
    let stalls = 0;
    let longest = 0;
    const seeds = 12;
    for (let seed = 1; seed <= seeds; seed += 1) {
      const report = playMatch(seed * 1009, 'normal', 'normal');
      expect(
        report.seenGoals,
        `seed ${String(seed * 1009)} played a whole match without a single goal`,
      ).toBeGreaterThan(0);
      total += report.seenGoals;
      stalls += report.stallResets;
      longest = Math.max(longest, report.longestRallySteps);
    }
    // Measured: about eight goals a match, one every seven seconds or so.
    expect(total / seeds).toBeGreaterThan(4);
    expect(stalls, 'the stalemate rule should never fire in a healthy match').toBe(0);
    expect(longest, 'no rally should approach the whole match').toBeLessThan(60 * 60);
  });

  it('agrees with its own scoreboard, goal for goal', () => {
    // The reconstruction and the counter are two independent stories about the same match.
    // Spin War is the reason this is checked rather than assumed.
    for (let seed = 1; seed <= 8; seed += 1) {
      const report = playMatch(seed * 613, 'normal', 'easy');
      expect(report.seenGoals, `seed ${String(seed * 613)}`).toBe(report.p1 + report.p2);
      expect(report.seenP1).toBe(report.p1);
      expect(report.seenP2).toBe(report.p2);
    }
  });

  it('lets both ends be scored in, across a spread of seeds', () => {
    let p1 = 0;
    let p2 = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const report = playMatch(seed * 331, 'normal', 'normal');
      p1 += report.seenP1;
      p2 += report.seenP2;
    }
    expect(p1, 'p1 never scored at all').toBeGreaterThan(0);
    expect(p2, 'p2 never scored at all').toBeGreaterThan(0);
  });

  it('scores at every tier, so no tier is a wall the game cannot get past', () => {
    for (const tier of TIERS) {
      const report = playMatch(20260824, tier, tier);
      expect(report.seenGoals, tier).toBeGreaterThan(0);
    }
  });

  it('keeps the ball inside its own speed ceiling all match', () => {
    const report = playMatch(4242, 'hard', 'hard');
    expect(report.maxSpeed).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-6);
  });
});

describe('a match always ends', () => {
  it('reaches a decision at every pairing of tiers', () => {
    for (const p1Tier of TIERS) {
      for (const p2Tier of TIERS) {
        const report = playMatch(20260824, p1Tier, p2Tier);
        expect(report.winner, `${p1Tier} vs ${p2Tier}`).not.toBeNull();
        expect(report.steps).toBeLessThan(MATCH_STEPS);
      }
    }
  });

  it('ends with two absent humans, who concede rather than play', () => {
    const report = playMatch(5, null, null);
    expect(report.winner).not.toBeNull();
  });

  it('never reports a winner who has not either reached the target or led at the whistle', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const report = playMatch(seed * 71, 'easy', 'hard');
      const { winner, p1, p2 } = report;
      expect(winner).not.toBeNull();
      if (winner === 'p1') expect(p1).toBeGreaterThan(p2);
      else if (winner === 'p2') expect(p2).toBeGreaterThan(p1);
      else expect(p1).toBe(p2);
      if (p1 >= GOAL_TARGET || p2 >= GOAL_TARGET) expect(winner).not.toBe('draw');
    }
  });

  it('never lets a score run past the target it stops at', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const report = playMatch(seed * 149, 'normal', 'easy');
      expect(Math.max(report.p1, report.p2)).toBeLessThanOrEqual(GOAL_TARGET);
    }
  });

  it('leaves the stalemate rule as a backstop rather than a mechanic', () => {
    // Measured over 1080 bot matches it fires 15 times, about one match in seventy, and
    // never more than once in a match. `hard` against `hard` is the pairing that produces
    // the long rallies, so it is the one worth checking.
    expect(IDLE_STEPS).toBeGreaterThan(60 * 3);
    let stalls = 0;
    for (let seed = 1; seed <= 10; seed += 1)
      stalls += playMatch(seed * 887, 'hard', 'hard').stallResets;
    expect(stalls, 'the sharpest pairing is the one long rallies come from').toBeLessThanOrEqual(1);
  });
});

describe('determinism', () => {
  it('plays the identical match twice from one seed', () => {
    const first = playMatch(31337, 'hard', 'normal');
    const second = playMatch(31337, 'hard', 'normal');
    expect(second).toEqual(first);
  });

  it('plays a different match from a different seed', () => {
    const a = playMatch(31337, 'normal', 'normal');
    const b = playMatch(31338, 'normal', 'normal');
    expect(b).not.toEqual(a);
  });

  it('is unaffected by how often anybody renders', () => {
    // `render` must not mutate anything, or a device that drops frames would play a
    // different match from one that does not.
    const play = (renderEvery: number): string => {
      const game = new PinballDuelGame();
      game.init(contextFor(555, bots('normal')));
      const { input, view } = idleInput();
      const { renderer } = recorder();
      for (let i = 0; i < 900; i += 1) {
        game.update(STEP, view.sync(input.beginStep(STEP)));
        if (renderEvery > 0 && i % renderEvery === 0) game.render(renderer, (i % 7) / 7);
      }
      const out = `${String(game.ball.x)}:${String(game.ball.y)}:${String(game.getScore().p1)}`;
      game.destroy();
      return out;
    };
    expect(play(1)).toBe(play(0));
    expect(play(3)).toBe(play(0));
  });

  it('is unaffected by a pause and a resume', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(606, bots('normal')));
    const other = new PinballDuelGame();
    other.init(contextFor(606, bots('normal')));
    const a = idleInput();
    const b = idleInput();
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, a.view.sync(a.input.beginStep(STEP)));
      other.update(STEP, b.view.sync(b.input.beginStep(STEP)));
      if (i % 50 === 0) {
        other.onPause();
        other.onResume();
      }
    }
    expect(other.ball).toEqual(game.ball);
    expect(other.getScore()).toEqual(game.getScore());
    game.destroy();
    other.destroy();
  });
});

describe('the controls, driven through the real InputManager', () => {
  interface Rig {
    readonly game: PinballDuelGame;
    readonly input: InputManager;
    readonly view: InputView;
    step(times?: number): void;
    raised(seat: SeatId, side: FlipperSide): boolean;
  }

  /**
   * Two people at the device and no bots, so nothing but the input moves a flipper.
   *
   * The presentation is a parameter because it is what decides whether a seat is reading the
   * table upside down, which is now half of what these tests are about. Left alone it is the
   * shared screen with p1 at the bottom, so p2 is the seat reading it the other way up.
   */
  function rig(presentation: Presentation = 'shared-screen', localSeat: SeatId = 'p1'): Rig {
    const game = new PinballDuelGame();
    game.init(contextFor(2024, () => null, presentation, localSeat));
    const { input, view } = idleInput();
    return {
      game,
      input,
      view,
      step(times = 8) {
        for (let i = 0; i < times; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
      },
      raised(seat, side) {
        return game.phase(seat, side) > 0;
      },
    };
  }

  it('gives the near seat A for the left flipper and D for the right', () => {
    const left = rig();
    left.input.keyDown('KeyA');
    left.step();
    expect(left.raised('p1', 'left')).toBe(true);
    expect(left.raised('p1', 'right')).toBe(false);
    left.game.destroy();

    const right = rig();
    right.input.keyDown('KeyD');
    right.step();
    expect(right.raised('p1', 'right')).toBe(true);
    expect(right.raised('p1', 'left')).toBe(false);
    right.game.destroy();
  });

  it('gives the far seat the arrows on its own axis, not the screen axis', () => {
    // Issue #2476. The table never turns, so the far seat is reading it upside down and the
    // flipper under its left hand is the one drawn on the *right* of the screen. Reading the
    // arrows in screen space handed that player the other flipper on every press.
    const left = rig();
    left.input.keyDown('ArrowLeft');
    left.step();
    expect(left.raised('p2', 'right')).toBe(true);
    expect(left.raised('p2', 'left')).toBe(false);
    left.game.destroy();

    const right = rig();
    right.input.keyDown('ArrowRight');
    right.step();
    expect(right.raised('p2', 'left')).toBe(true);
    expect(right.raised('p2', 'right')).toBe(false);
    right.game.destroy();
  });

  it('reads both seats in screen space when neither is reading the table upside down', () => {
    // Single-seat play: the local player owns the whole viewport and nobody is upside down,
    // so `seatView` reports no rotation and p2's arrows read exactly as p1's A and D do. The
    // mirror belongs to the seat's view, never to the seat's name.
    const left = rig('single-seat', 'p2');
    left.input.keyDown('ArrowLeft');
    left.step();
    expect(left.raised('p2', 'left')).toBe(true);
    expect(left.raised('p2', 'right')).toBe(false);
    left.game.destroy();

    const right = rig('single-seat', 'p2');
    right.input.keyDown('ArrowRight');
    right.step();
    expect(right.raised('p2', 'right')).toBe(true);
    expect(right.raised('p2', 'left')).toBe(false);
    right.game.destroy();
  });

  /**
   * The symmetry the two seats owe each other, driven through the real InputManager.
   *
   * `rules.test.ts` proves the property on the pure function; this proves the game is wired
   * to it — that `PinballDuelGame` asks `seatView` which of its two seats is upside down and
   * hands the answer to `wantsFlipper`, rather than reading both seats in screen space. An
   * example at one seat could never have caught that, which is why the far seat's arrows were
   * reversed for the whole of this game's life with sixty tests passing over them.
   */
  it('answers the same gesture at both seats with the same hand, both instruments', () => {
    const KEYS: Record<SeatId, Record<FlipperSide, string>> = {
      p1: { left: 'KeyA', right: 'KeyD' },
      p2: { left: 'ArrowLeft', right: 'ArrowRight' },
    };
    for (const seat of SEATS) {
      // p1 sits at the bottom of the shared screen, so p2 is the seat reading it upside down.
      const rotated = seat === 'p2';
      for (const hand of SIDES) {
        // The screen side that hand is on. `seatSide` maps both ways, being a half turn.
        const screen = seatSide(hand, rotated);

        const keyed = rig();
        keyed.input.keyDown(KEYS[seat][hand]);
        keyed.step();
        expect(keyed.raised(seat, screen), `${seat} keyed its ${hand}`).toBe(true);
        expect(keyed.raised(seat, otherSide(screen))).toBe(false);
        keyed.game.destroy();

        // The same gesture with a finger: 80 units into that seat's own end, on the same
        // hand, which is a different corner of the glass for each of them.
        const seatX = hand === 'left' ? 80 : TABLE.width - 80;
        const touched = rig();
        touched.input.pointerDown(
          0,
          rotated ? TABLE.width - seatX : seatX,
          rotated ? 60 : TABLE.height - 60,
        );
        touched.step();
        expect(touched.raised(seat, screen), `${seat} touched its ${hand}`).toBe(true);
        expect(touched.raised(seat, otherSide(screen))).toBe(false);
        touched.game.destroy();
      }
    }
  });

  it('never lets one seat key the other seat flippers', () => {
    const near = rig();
    near.input.keyDown('KeyA');
    near.input.keyDown('KeyD');
    near.step();
    expect(near.raised('p2', 'left')).toBe(false);
    expect(near.raised('p2', 'right')).toBe(false);
    near.game.destroy();

    const far = rig();
    far.input.keyDown('ArrowLeft');
    far.input.keyDown('ArrowRight');
    far.step();
    expect(far.raised('p1', 'left')).toBe(false);
    expect(far.raised('p1', 'right')).toBe(false);
    far.game.destroy();
  });

  it('does nothing at all with the keys the manifest does not offer', () => {
    for (const code of ['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'KeyQ']) {
      const subject = rig();
      subject.input.keyDown(code);
      subject.step();
      for (const seat of SEATS) {
        for (const side of SIDES) {
          expect(subject.raised(seat, side), `${code} moved ${seat} ${side}`).toBe(false);
        }
      }
      subject.game.destroy();
    }
  });

  it('holds a flipper up while the key is held and lets it fall when it is let go', () => {
    const subject = rig();
    subject.input.keyDown('KeyD');
    subject.step(20);
    expect(subject.game.phase('p1', 'right')).toBe(1);
    subject.input.keyUp('KeyD');
    subject.step(20);
    expect(subject.game.phase('p1', 'right')).toBe(0);
    subject.game.destroy();
  });

  it('raises neither flipper when both of a seat keys are held', () => {
    // The engine sums the two directions into one axis, so A and D together are zero. It is
    // the same limit a thumb has — one seat reports one pointer position — so neither
    // instrument can hold two flippers up and neither is favoured.
    const subject = rig();
    subject.input.keyDown('KeyA');
    subject.input.keyDown('KeyD');
    subject.step();
    expect(subject.raised('p1', 'left')).toBe(false);
    expect(subject.raised('p1', 'right')).toBe(false);
    subject.game.destroy();
  });

  it('gives a finger in the near half the flipper on the side it landed', () => {
    const left = rig();
    left.input.pointerDown(0, 80, TABLE.height - 60);
    left.step();
    expect(left.raised('p1', 'left')).toBe(true);
    expect(left.raised('p1', 'right')).toBe(false);
    left.game.destroy();

    const right = rig();
    right.input.pointerDown(0, TABLE.width - 80, TABLE.height - 60);
    right.step();
    expect(right.raised('p1', 'right')).toBe(true);
    expect(right.raised('p1', 'left')).toBe(false);
    right.game.destroy();
  });

  it('gives a finger in the far half the flipper it landed on, mirror and all', () => {
    // The pointer needed no change and must not be given one: a finger is a place, and a
    // place mirrors along with the flipper it is reaching for, so the far seat touching the
    // left of the glass raises the flipper drawn on the left of the glass — which is the one
    // under its own right hand, exactly as it looks from that chair.
    const left = rig();
    left.input.pointerDown(0, 80, 60);
    left.step();
    expect(left.raised('p2', 'left')).toBe(true);
    expect(left.raised('p1', 'left')).toBe(false);
    left.game.destroy();

    const right = rig();
    right.input.pointerDown(0, TABLE.width - 80, 60);
    right.step();
    expect(right.raised('p2', 'right')).toBe(true);
    expect(right.raised('p1', 'right')).toBe(false);
    right.game.destroy();
  });

  it('keeps a finger with the seat it went down in, right across the midline', () => {
    // The engine owns this and the game never asks where a pointer is, only which seat it
    // arrived on. A drag from one end to the other must not change hands mid-gesture.
    const subject = rig();
    subject.input.pointerDown(0, 80, TABLE.height - 60);
    subject.step(4);
    subject.input.pointerMove(0, 80, 40);
    subject.step(4);
    expect(subject.raised('p1', 'left')).toBe(true);
    expect(subject.raised('p2', 'left')).toBe(false);
    subject.game.destroy();
  });

  it('keeps a thumb on the bezel with its own seat', () => {
    const subject = rig();
    subject.input.pointerDown(0, -40, TABLE.height - 20);
    subject.step();
    expect(subject.raised('p1', 'left')).toBe(true);
    subject.game.destroy();
  });

  it('lets a key and a finger raise both of one seat flippers together', () => {
    // The two sources are OR-ed rather than switched between, so there is no mode — and the
    // one way to hold both is to use both instruments at once.
    const subject = rig();
    subject.input.keyDown('KeyA');
    subject.input.pointerDown(0, TABLE.width - 60, TABLE.height - 60);
    subject.step();
    expect(subject.raised('p1', 'left')).toBe(true);
    expect(subject.raised('p1', 'right')).toBe(true);
    subject.game.destroy();
  });

  it('lets go of everything when the host clears input', () => {
    const subject = rig();
    subject.input.keyDown('KeyA');
    subject.step(20);
    expect(subject.game.phase('p1', 'left')).toBe(1);
    subject.input.clear();
    subject.step(20);
    expect(subject.game.phase('p1', 'left')).toBe(0);
    subject.game.destroy();
  });

  it('is enough on its own to move the score, on either instrument', () => {
    // Rule 10 in the small: a person with only a keyboard and a person with only a thumb are
    // both playing this game, not watching it.
    const byKey = (): number => {
      const subject = rig();
      for (let i = 0; i < 2400; i += 1) {
        if (i % 37 === 0) subject.input.keyDown(i % 74 === 0 ? 'KeyA' : 'KeyD');
        if (i % 37 === 18) {
          subject.input.keyUp('KeyA');
          subject.input.keyUp('KeyD');
        }
        subject.step(1);
      }
      const moved = subject.game.getScore().p1 + subject.game.getScore().p2;
      subject.game.destroy();
      return moved;
    };
    const byThumb = (): number => {
      const subject = rig();
      for (let i = 0; i < 2400; i += 1) {
        if (i % 37 === 0) {
          subject.input.pointerDown(0, i % 74 === 0 ? 80 : TABLE.width - 80, TABLE.height - 60);
        }
        if (i % 37 === 18) subject.input.pointerUp(0);
        subject.step(1);
      }
      const moved = subject.game.getScore().p1 + subject.game.getScore().p2;
      subject.game.destroy();
      return moved;
    };
    expect(byKey(), 'the keyboard never reached the game').toBeGreaterThan(0);
    expect(byThumb(), 'the pointer never reached the game').toBeGreaterThan(0);
  });
});

describe('the bot', () => {
  function trace(seed: number, tier: BotDifficulty | null): string {
    const game = new PinballDuelGame();
    game.init(contextFor(seed, tier === null ? () => null : bots(tier)));
    const { input, view } = idleInput();
    const marks: string[] = [];
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (i % 30 === 0) marks.push(`${game.ball.x.toFixed(3)},${game.ball.y.toFixed(3)}`);
    }
    game.destroy();
    return marks.join('|');
  }

  it('plays a visibly different match on every tier', () => {
    const easy = trace(4004, 'easy');
    const normal = trace(4004, 'normal');
    const hard = trace(4004, 'hard');
    expect(normal).not.toBe(easy);
    expect(hard).not.toBe(easy);
    expect(hard).not.toBe(normal);
  });

  it('plays a different match from two absent humans', () => {
    expect(trace(4004, 'normal')).not.toBe(trace(4004, null));
  });

  it('has no turns to report, because this is a real-time game', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(1, () => null));
    const asGame: Game = game;
    expect(typeof asGame.getActiveSeat).toBe('undefined');
    game.destroy();
  });

  /** Wins for `a` over `b`, played both ways round on the same seeds. */
  function duel(a: BotDifficulty, b: BotDifficulty, seeds: number, family: number): number {
    let wins = 0;
    let decided = 0;
    for (let i = 1; i <= seeds; i += 1) {
      for (const swapped of [false, true]) {
        const report = playMatch(i * family, swapped ? b : a, swapped ? a : b);
        if (report.winner === null || report.winner === 'draw') continue;
        decided += 1;
        const winnerTier = report.winner === 'p1' ? (swapped ? b : a) : swapped ? a : b;
        if (winnerTier === a) wins += 1;
      }
    }
    expect(decided, `${a} vs ${b} decided nothing`).toBeGreaterThan(seeds);
    return wins / decided;
  }

  it('measurably beats the tier below it, in both seat orders', () => {
    // The ladder proper lives in SPEC.md, measured over three seed families and 180 matches a
    // pairing. This is the same measurement at a size a test suite can afford.
    expect(duel('normal', 'easy', 8, 101)).toBeGreaterThan(0.55);
    expect(duel('hard', 'normal', 8, 101)).toBeGreaterThan(0.6);
    expect(duel('hard', 'easy', 8, 101)).toBeGreaterThan(0.7);
  });

  it('concedes fewer goals the sharper it is, reconstructed from the ball', () => {
    const conceded = (tier: BotDifficulty): number => {
      let goals = 0;
      for (let seed = 1; seed <= 5; seed += 1) {
        // The same opponent every time, so the only thing that changes is the defence.
        const report = playMatch(seed * 269, tier, 'normal');
        goals += report.seenP2;
      }
      return goals;
    };
    const easy = conceded('easy');
    const hard = conceded('hard');
    expect(hard, `easy conceded ${String(easy)}, hard ${String(hard)}`).toBeLessThan(easy);
  });
});

describe('seat fairness', () => {
  it('gives the same tier the same result whichever end it sits at', () => {
    // A weak statement on purpose: a per-seat win rate needs hundreds of matches to resolve
    // and SPEC.md carries that measurement over 3600. What a suite can afford to assert is
    // that the strong tier is strong at **both** ends, which is what a seat bias would break.
    let hardAsP1 = 0;
    let hardAsP2 = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      if (playMatch(seed * 401, 'hard', 'easy').winner === 'p1') hardAsP1 += 1;
      if (playMatch(seed * 401, 'easy', 'hard').winner === 'p2') hardAsP2 += 1;
    }
    expect(hardAsP1).toBeGreaterThanOrEqual(6);
    expect(hardAsP2).toBeGreaterThanOrEqual(6);
  });

  it('scores at both ends over a spread of seeds at every tier', () => {
    for (const tier of TIERS) {
      let p1 = 0;
      let p2 = 0;
      for (let seed = 1; seed <= 6; seed += 1) {
        const report = playMatch(seed * 5051, tier, tier);
        p1 += report.seenP1;
        p2 += report.seenP2;
      }
      expect(p1, `${tier}: p1 never scored`).toBeGreaterThan(0);
      expect(p2, `${tier}: p2 never scored`).toBeGreaterThan(0);
    }
  });
});

describe('rendering', () => {
  it('draws the table, both mouths, four flippers, five bumpers and a ball', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(1, () => null));
    const { renderer, calls } = recorder();
    game.render(renderer, 0);
    expect(calls()).toBeGreaterThan(30);
    game.destroy();
  });

  it('changes nothing about the match', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(808, bots('normal')));
    const { input, view } = idleInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    const before = { ...game.ball, clock: game.clock, ...game.getScore() };
    const { renderer } = recorder();
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.999]) game.render(renderer, alpha);
    expect({ ...game.ball, clock: game.clock, ...game.getScore() }).toEqual(before);
    game.destroy();
  });

  it('keeps every number it draws inside the box it declared', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(909, bots('hard')));
    const { input, view } = idleInput();
    const limit = Math.max(TABLE.width, TABLE.height) * 2;
    let worst = 0;
    for (let i = 0; i < 300; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      const frame = recorder();
      game.render(frame.renderer, (i % 5) / 5);
      for (const value of frame.numbers()) {
        expect(Number.isFinite(value)).toBe(true);
        worst = Math.max(worst, Math.abs(value));
      }
    }
    expect(worst).toBeLessThanOrEqual(limit);
    game.destroy();
  });

  it('interpolates between the two ends of a step and stops there', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(1, () => null));
    const { input, view } = idleInput();
    const { renderer } = recorder();
    for (let i = 0; i < 200; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    const at = (alpha: number): number => {
      const local = recorder();
      game.render(local.renderer, alpha);
      return local.numbers().length;
    };
    expect(at(0)).toBe(at(1));
    game.render(renderer, 0.5);
    game.destroy();
  });

  it('draws a resting table and a played one alike, without throwing', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(4, bots('easy')));
    const { input, view } = idleInput();
    const { renderer } = recorder();
    for (let i = 0; i < MATCH_STEPS; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (i % 11 === 0) game.render(renderer, 0.4);
      if (game.getScore().winner !== null) break;
    }
    game.render(renderer, 0);
    game.destroy();
  });
});

describe('the shell contract', () => {
  it('hands back the same score object every time, and it is the tally', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(1, bots('normal')));
    expect(game.getScore()).toBe(game.getScore());
    game.destroy();
  });

  it('goes quiet once it has been destroyed', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(1, bots('hard')));
    const { input, view } = idleInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    const frozen = { ...game.ball };
    game.destroy();
    for (let i = 0; i < 120; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.ball).toEqual(frozen);
  });

  it('survives update being called before init', () => {
    const game = new PinballDuelGame();
    const { input, view } = idleInput();
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.getScore().winner).toBeNull();
    game.destroy();
  });

  it('settles the ball on a pause so a resumed frame is not a smear', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(77, bots('normal')));
    const { input, view } = idleInput();
    for (let i = 0; i < 400; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    const before = { ...game.ball };
    game.onPause();
    game.onResume();
    expect(game.ball).toEqual(before);
    game.destroy();
  });

  it('holds the ball where it is while it is paused, because the host stops stepping', () => {
    const game = new PinballDuelGame();
    game.init(contextFor(78, bots('normal')));
    const { input, view } = idleInput();
    for (let i = 0; i < 200; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    game.onPause();
    const paused = { ...game.ball, clock: game.clock };
    game.onResume();
    expect({ ...game.ball, clock: game.clock }).toEqual(paused);
    game.destroy();
  });
});
