import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  AIR_SECONDS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_PLAN,
  BOT_PLAN_LEAD,
  BOT_PROFILES,
  BULL_VALUE,
  CHOICE_SEPARATIONS,
  CLEAN_SECONDS,
  DANGER_HALF,
  DANGER_SECONDS,
  GOAT_VALUE,
  LANE_HEIGHT,
  LANE_WIDTH,
  MAX_HAZARDS,
  PINCER_SEPARATIONS,
  PRESS_WINDOW,
  RECOVER_SECONDS,
  RUNNER_HALF,
  RUNNER_X,
  STAGGER_SECONDS,
  WAVES,
  botCanSee,
  botPress,
  canJump,
  courseSeconds,
  createBotState,
  createGame,
  decideAt,
  enterLead,
  halfLength,
  hazardX,
  jumpHeight,
  nextUncovered,
  plannedPress,
  resetBotState,
  resetGame,
  resetRunner,
  runnerOf,
  step,
  toBoardX,
  toBoardY,
  valueOf,
  visibleLead,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game, Hazard, Runner } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function fresh(seed: number): Game {
  const game = createGame();
  resetGame(game, new Rng(seed));
  return game;
}

/** Advance `seconds` with nobody pressing anything. */
function idle(game: Game, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) step(game, STEP, false, false);
}

/* ------------------------------------------------------------------------------------ */
/* The lane, and the two things drawn from it                                            */
/* ------------------------------------------------------------------------------------ */

describe('the lane', () => {
  it('is exactly half the board, and two of them fill it', () => {
    expect(LANE_WIDTH).toBe(BOARD_WIDTH);
    expect(LANE_HEIGHT * 2).toBe(BOARD_HEIGHT);
    expect(RUNNER_X).toBe(LANE_WIDTH / 2);
  });

  it('maps seat two onto seat one turned half a turn, on a grid of points', () => {
    // The one property the whole seat argument rests on. Asserted on a grid rather than
    // trusted, because a tie-break or a threshold written in board coordinates is the
    // defect the half-turn tests exist to catch (Snowball Throw, Maze Paint).
    for (let x = 0; x <= LANE_WIDTH; x += 25) {
      for (let y = 0; y <= LANE_HEIGHT; y += 25) {
        expect(toBoardX('p2', x)).toBeCloseTo(BOARD_WIDTH - toBoardX('p1', x), 12);
        expect(toBoardY('p2', y)).toBeCloseTo(BOARD_HEIGHT - toBoardY('p1', y), 12);
      }
    }
  });

  it('keeps both lanes inside the board and off each other', () => {
    for (const seat of ['p1', 'p2'] as const) {
      for (let y = 0; y <= LANE_HEIGHT; y += 10) {
        const by = toBoardY(seat, y);
        expect(by).toBeGreaterThanOrEqual(0);
        expect(by).toBeLessThanOrEqual(BOARD_HEIGHT);
      }
    }
    // The centre line is the only point the two lanes share.
    expect(toBoardY('p1', LANE_HEIGHT)).toBe(toBoardY('p2', LANE_HEIGHT));
  });

  it('draws a beast exactly as long as it is dangerous', () => {
    // The picture is the referee. A beast overlaps the runner's footprint for precisely the
    // interval the rule calls dangerous, which is what makes "it looks like it got me" and
    // "it got me" the same statement.
    for (const speed of [240, 300, 380]) {
      const hazard: Hazard = { arrival: 5, speed, dir: 1, beast: 'bull' };
      const half = halfLength(hazard);
      for (let t = 4; t < 6; t += 1 / 240) {
        const gap = Math.abs(hazardX(hazard, t) - RUNNER_X);
        const overlapping = gap <= half + RUNNER_HALF + 1e-9;
        const dangerous = Math.abs(t - hazard.arrival) <= DANGER_HALF + 1e-9;
        expect(overlapping, `speed ${String(speed)} at ${t.toFixed(4)}`).toBe(dangerous);
      }
    }
  });

  it('runs a beast the same way whichever side it enters from', () => {
    const right: Hazard = { arrival: 5, speed: 300, dir: 1, beast: 'goat' };
    const left: Hazard = { arrival: 5, speed: 300, dir: -1, beast: 'goat' };
    for (let t = 3; t < 7; t += 0.05) {
      expect(hazardX(right, t) - RUNNER_X).toBeCloseTo(RUNNER_X - hazardX(left, t), 12);
    }
  });

  it('lifts a jump off the ground and puts it back, and nowhere else', () => {
    const runner: Runner = createGame().p1;
    resetRunner(runner);
    runner.jumping = true;
    runner.jumpStart = 10;
    expect(jumpHeight(runner, 10)).toBe(0);
    expect(jumpHeight(runner, 10 + AIR_SECONDS)).toBeCloseTo(0, 9);
    expect(jumpHeight(runner, 10 + AIR_SECONDS / 2)).toBeGreaterThan(0);
    runner.jumping = false;
    expect(jumpHeight(runner, 10 + AIR_SECONDS / 2)).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The press window, measured rather than asserted                                       */
/* ------------------------------------------------------------------------------------ */

/**
 * Every press moment, in whole frames, that clears one lone beast.
 *
 * Scanned rather than derived. `PRESS_WINDOW` is the geometric width; what a player
 * actually has is that width sampled on the fixed step, and Cup Pong's first geometry is
 * the reason this file measures the sampled thing: a window whose floor is the frame rate
 * cannot be made into a difficulty ladder by any amount of bot tuning.
 */
function clearingFrames(arrival: number, speed = 300): number[] {
  const frames: number[] = [];
  for (let k = -60; k <= 0; k += 1) {
    const game = board({ arrival, speed });
    play(game, [arrival + k * STEP]);
    if (game.p1.cleared === 1) frames.push(k);
  }
  return frames;
}

describe('the press window', () => {
  it('is one contiguous run of frames, and never fewer than eight of them', () => {
    // Eight frames is the floor Cup Pong and Target Practice both settled on: below it the
    // three bot tiers collapse into three spellings of "nearly perfect".
    for (const arrival of [3, 3.0083, 3.0167, 4.271]) {
      const frames = clearingFrames(arrival);
      expect(frames.length, `arrival ${String(arrival)}`).toBeGreaterThanOrEqual(8);
      for (let i = 1; i < frames.length; i += 1) {
        expect(frames[i]).toBe((frames[i - 1] as number) + 1);
      }
    }
  });

  it('is the geometric window rounded onto the fixed step, and that is twenty frames', () => {
    // Twenty rather than eighteen because the interval is closed at both ends and a press
    // decided on one step lands at the start of the next — which is true of a person and of
    // a bot in exactly the same way, since `game.ts` reads both at the same point in the
    // step. Neither instrument and neither kind of player gains a frame from it.
    const frames = clearingFrames(3);
    expect(frames.length).toBeGreaterThanOrEqual(Math.floor(PRESS_WINDOW * 60));
    expect(frames.length).toBeLessThanOrEqual(Math.round(PRESS_WINDOW * 60) + 2);
    // Latest possible press: the runner's toes leave as the beast's nose arrives.
    expect((frames.at(-1) as number) * STEP).toBeLessThanOrEqual(-DANGER_HALF + 1e-9);
    // Earliest: it lands as the tail goes past.
    expect((frames[0] as number) * STEP).toBeGreaterThanOrEqual(
      DANGER_HALF - AIR_SECONDS - 2 * STEP - 1e-9,
    );
  });

  it('does not change when the course speeds up, which is the whole design', () => {
    // `DANGER_SECONDS` is fixed *in time* and the drawn beast is derived from it, so a
    // course that ramps by half again is harder to read and exactly as forgiving to time.
    // Sweeping the speed knob alone in the harness moved a `normal` bot's score by 0.00
    // points across 240 to 560 units a second — see SPEC.md.
    const slow = clearingFrames(3, 240);
    const fast = clearingFrames(3, 560);
    expect(fast).toEqual(slow);
  });

  it('never lets a beast slip between two steps', () => {
    // The danger interval is twenty-four frames wide, so a runner on the ground is sampled
    // inside it many times over and cannot be missed by the sampling.
    expect(DANGER_SECONDS / STEP).toBeGreaterThanOrEqual(8);
    const game = fresh(4242);
    idle(game, courseSeconds(game) + 1);
    expect(game.p1.hits).toBe(game.count);
    expect(game.p1.cleared).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The course                                                                            */
/* ------------------------------------------------------------------------------------ */

/** Every wave, as the pair of indices it occupies and the gap inside it. */
function waves(game: Readonly<Game>): { first: number; apart: number }[] {
  const out: { first: number; apart: number }[] = [];
  let i = 0;
  while (i < game.count) {
    const a = game.hazards[i] as Hazard;
    const b = i + 1 < game.count ? (game.hazards[i + 1] as Hazard) : null;
    const apart = b === null ? Infinity : b.arrival - a.arrival;
    if (apart < DANGER_SECONDS + RECOVER_SECONDS) {
      out.push({ first: i, apart });
      i += 2;
    } else {
      out.push({ first: i, apart: Infinity });
      i += 1;
    }
  }
  return out;
}

/** How far a measured separation is from the nearest one the generator can draw. */
function nearest(values: readonly number[], measured: number): number {
  return Math.min(...values.map((v) => Math.abs(v - measured)));
}

describe('the course', () => {
  it('is laid out once, with a fixed number of waves and room for all of them', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const game = fresh(seed * 7919 + 13);
      expect(waves(game)).toHaveLength(WAVES);
      expect(game.count).toBeLessThanOrEqual(MAX_HAZARDS);
      expect(game.count).toBeGreaterThanOrEqual(WAVES);
    }
  });

  it('puts every beast after the one before it', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const game = fresh(seed * 104729 + 3);
      for (let i = 1; i < game.count; i += 1) {
        const a = game.hazards[i - 1] as Hazard;
        const b = game.hazards[i] as Hazard;
        expect(b.arrival).toBeGreaterThanOrEqual(a.arrival);
      }
    }
  });

  it('totals exactly what a flawless run would take', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const game = fresh(seed * 40503 + 7);
      let sum = 0;
      for (let i = 0; i < game.count; i += 1) sum += valueOf((game.hazards[i] as Hazard).beast);
      expect(game.total).toBe(sum);
    }
  });

  it('generates only pairs that are a pincer or a choice, never something in between', () => {
    // A pincer is two beasts one jump takes; a choice is two beasts no single jump takes and
    // no two jumps take either. Anything strictly between the two would be a pair whose right
    // answer depends on arithmetic no player can do in the time available.
    const seen = { pincer: 0, choice: 0, single: 0 };
    for (let seed = 0; seed < 400; seed += 1) {
      const game = fresh(seed * 15485863 + 11);
      for (const wave of waves(game)) {
        if (wave.apart === Infinity) {
          seen.single += 1;
        } else if (wave.apart <= PRESS_WINDOW + 1e-9) {
          seen.pincer += 1;
          expect(nearest(PINCER_SEPARATIONS, wave.apart)).toBeLessThan(1e-9);
        } else {
          seen.choice += 1;
          expect(nearest(CHOICE_SEPARATIONS, wave.apart)).toBeLessThan(1e-9);
          expect(wave.apart).toBeGreaterThan(PRESS_WINDOW);
          expect(wave.apart).toBeLessThan(DANGER_SECONDS + RECOVER_SECONDS);
        }
      }
    }
    expect(seen.pincer).toBeGreaterThan(100);
    expect(seen.choice).toBeGreaterThan(100);
    expect(seen.single).toBeGreaterThan(100);
  });

  it('makes every choice a bull against a goat, so there is always a right answer', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const game = fresh(seed * 2654435761 + 5);
      for (const wave of waves(game)) {
        if (wave.apart === Infinity || wave.apart <= PRESS_WINDOW) continue;
        const a = game.hazards[wave.first] as Hazard;
        const b = game.hazards[wave.first + 1] as Hazard;
        expect(new Set([a.beast, b.beast])).toEqual(new Set(['bull', 'goat']));
      }
    }
  });

  it('leaves at least eight frames to save the second half of any choice', () => {
    // The stagger from the beast you gave up must be over in time to jump for the one you
    // kept, or a choice is not a choice. Measured for every separation the course can draw.
    for (const apart of CHOICE_SEPARATIONS) {
      const freeAt = -DANGER_HALF + STAGGER_SECONDS;
      const latest = apart - DANGER_HALF;
      const earliest = Math.max(freeAt, apart + DANGER_HALF - AIR_SECONDS);
      expect((latest - earliest) / STEP, `separation ${String(apart)}`).toBeGreaterThanOrEqual(8);
    }
  });

  it('never gives a wave less warning than one and three quarter seconds', () => {
    // The whole cross-device fairness argument. SPEC.md states it as a budget in seconds and
    // argues it against `docs/input-parity.md`'s 8 ms measurement tolerance.
    let least = Infinity;
    for (let seed = 0; seed < 300; seed += 1) {
      const game = fresh(seed * 31337 + 19);
      for (let i = 0; i < game.count; i += 1) {
        least = Math.min(least, visibleLead(game.hazards[i] as Hazard));
      }
    }
    expect(least).toBeGreaterThan(1.75);
    // And the beast is in the lane, not merely announced, for most of a second of that.
    for (const speed of [240, 380]) {
      expect(enterLead({ arrival: 0, speed, dir: 1, beast: 'bull' })).toBeGreaterThan(0.9);
    }
  });

  it('is emptied by a null generator, and an empty course is already over', () => {
    const game = fresh(77);
    resetGame(game, null);
    expect(game.count).toBe(0);
    expect(game.total).toBe(0);
    expect(game.winner).toBe('draw');
    expect(courseSeconds(game)).toBe(0);
    // And stepping it does nothing at all, which is what makes destroy inert.
    const before = describeGame(game);
    for (let i = 0; i < 120; i += 1) step(game, STEP, true, true);
    expect(describeGame(game)).toBe(before);
  });

  it('lays out the same course twice from the same seed and different ones otherwise', () => {
    const a = fresh(2024);
    const b = fresh(2024);
    const c = fresh(2025);
    const shape = (g: Game): string =>
      g.hazards
        .slice(0, g.count)
        .map((h) => `${h.arrival.toFixed(6)}/${h.speed.toFixed(4)}/${String(h.dir)}/${h.beast}`)
        .join(' ');
    expect(shape(a)).toBe(shape(b));
    expect(shape(a)).not.toBe(shape(c));
  });
});

/* ------------------------------------------------------------------------------------ */
/* Jumping, being bowled over, and what a beast is worth                                 */
/* ------------------------------------------------------------------------------------ */

/** A board holding exactly the beasts described, and nothing else. */
function board(
  ...beasts: { arrival: number; beast?: 'bull' | 'goat'; dir?: number; speed?: number }[]
): Game {
  const game = createGame();
  resetGame(game, new Rng(1));
  game.count = 0;
  game.total = 0;
  game.clock = 0;
  game.winner = null;
  resetRunner(game.p1);
  resetRunner(game.p2);
  for (const spec of beasts) {
    const hazard = game.hazards[game.count] as Hazard;
    hazard.arrival = spec.arrival;
    hazard.speed = spec.speed ?? 300;
    hazard.dir = spec.dir ?? 1;
    hazard.beast = spec.beast ?? 'goat';
    game.count += 1;
    game.total += valueOf(hazard.beast);
  }
  return game;
}

/** Run a board to its end, pressing at each of the listed moments. */
function play(game: Game, presses: readonly number[]): void {
  const pending = [...presses];
  while (game.winner === null && game.clock < 60) {
    const want = pending.length > 0 && game.clock >= (pending[0] as number);
    const press = want && canJump(game.p1);
    if (press) pending.shift();
    step(game, STEP, press, false);
  }
}

describe('a jump', () => {
  it('clears a beast pressed for at the right moment and misses it otherwise', () => {
    const centred = 5 - AIR_SECONDS / 2;
    for (const [offset, cleared] of [
      [0, 1],
      [-0.14, 1],
      [0.13, 1],
      [-0.4, 0],
      [0.4, 0],
    ] as const) {
      const game = board({ arrival: 5 });
      play(game, [centred + offset]);
      expect(game.p1.cleared, `offset ${String(offset)}`).toBe(cleared);
      expect(game.p1.hits).toBe(1 - cleared);
    }
  });

  it('pays what the beast is worth, and a bull is worth two goats', () => {
    expect(BULL_VALUE).toBe(2 * GOAT_VALUE);
    for (const beast of ['bull', 'goat'] as const) {
      const game = board({ arrival: 5, beast });
      play(game, [5 - AIR_SECONDS / 2]);
      expect(game.p1.points).toBe(valueOf(beast));
    }
  });

  it('counts a clear as clean only when the beast passes near the top of the jump', () => {
    // The clean band is measured rather than asserted, for the same reason the press window
    // is: what a player has is the band sampled on the fixed step. It has to be narrower
    // than the press window or it would separate nobody, and wide enough to be reachable.
    const perfect = 5 - AIR_SECONDS / 2;
    const clean: number[] = [];
    const cleared: number[] = [];
    for (let k = -40; k <= 10; k += 1) {
      const game = board({ arrival: 5 });
      play(game, [perfect + k * STEP]);
      if (game.p1.cleared === 1) cleared.push(k);
      if (game.p1.clean === 1) clean.push(k);
    }
    expect(clean.length).toBeGreaterThanOrEqual(6);
    expect(clean.length).toBeLessThan(cleared.length);
    expect(clean.length * STEP).toBeLessThanOrEqual(2 * CLEAN_SECONDS + 2 * STEP);
    // And it sits inside the press window rather than off one end of it.
    expect(clean[0]).toBeGreaterThan(cleared[0] as number);
    expect(clean.at(-1)).toBeLessThan(cleared.at(-1) as number);
  });

  it('cannot be started again until the runner has its feet back under it', () => {
    const game = board({ arrival: 30 });
    step(game, STEP, true, false);
    expect(game.p1.jumping).toBe(true);
    expect(canJump(game.p1)).toBe(false);
    idle(game, AIR_SECONDS);
    expect(game.p1.jumping).toBe(false);
    expect(canJump(game.p1)).toBe(false);
    idle(game, RECOVER_SECONDS + STEP);
    expect(canJump(game.p1)).toBe(true);
    expect(game.p1.jumps).toBe(1);
  });

  it('is refused while the runner is on the floor, and the floor is short', () => {
    // A second beast far down the course, so the match is still running to be watched: a
    // one-beast board ends the moment that beast settles and every later step is a no-op.
    const game = board({ arrival: 5 }, { arrival: 20 });
    idle(game, 4.9);
    expect(game.p1.hits).toBe(1);
    expect(game.p1.stagger).toBeGreaterThan(0);
    expect(canJump(game.p1)).toBe(false);
    idle(game, STAGGER_SECONDS);
    expect(game.p1.stagger).toBe(0);
    expect(canJump(game.p1)).toBe(true);
  });

  it('leaves a runner already on the floor there rather than pinning it down again', () => {
    // A dense wave must not turn one mistake into a run of them: the stagger is set, never
    // extended, so the second beast of a pincer costs a point and not another fifth of a
    // second on the ground. Watched at every step, because it is the step the second beast
    // lands on that would show a reset.
    const game = board({ arrival: 5 }, { arrival: 5.1, dir: -1 });
    let peak = 0;
    let hitsWhenPeaked = 0;
    while (game.winner === null && game.clock < 8) {
      step(game, STEP, false, false);
      if (game.p1.stagger > peak) {
        peak = game.p1.stagger;
        hitsWhenPeaked = game.p1.hits;
      }
    }
    expect(game.p1.hits).toBe(2);
    expect(peak).toBeLessThanOrEqual(STAGGER_SECONDS);
    // The floor was reached on the first knock and never re-set by the second.
    expect(hitsWhenPeaked).toBe(1);
  });
});

describe('a wave of two', () => {
  it('is taken whole by one jump when the two are inside the press window', () => {
    for (const apart of PINCER_SEPARATIONS) {
      const game = board({ arrival: 5 }, { arrival: 5 + apart, dir: -1 });
      play(game, [5 + apart / 2 - AIR_SECONDS / 2]);
      expect(game.p1.cleared, `separation ${String(apart)}`).toBe(2);
      expect(game.p1.hits).toBe(0);
    }
  });

  it('cannot be taken whole by any press at all when it is a choice', () => {
    // Exhaustive over every frame a press could land on, which is what makes "exactly one of
    // the two is savable" a property of the game rather than a claim about it.
    for (const apart of CHOICE_SEPARATIONS) {
      let best = 0;
      for (let k = -90; k <= 30; k += 1) {
        const game = board({ arrival: 5, beast: 'bull' }, { arrival: 5 + apart, dir: -1 });
        play(game, [5 + k * STEP]);
        best = Math.max(best, game.p1.cleared);
      }
      expect(best, `separation ${String(apart)}`).toBe(1);
    }
  });

  it('lets a player keep either half of a choice, so the choice is real', () => {
    for (const apart of CHOICE_SEPARATIONS) {
      const first = board({ arrival: 5, beast: 'bull' }, { arrival: 5 + apart, dir: -1 });
      play(first, [5 - AIR_SECONDS / 2]);
      expect(first.p1.points, `keep the first, ${String(apart)}`).toBe(BULL_VALUE);

      const second = board({ arrival: 5 }, { arrival: 5 + apart, beast: 'bull', dir: -1 });
      play(second, [5 + apart - AIR_SECONDS / 2]);
      expect(second.p1.points, `keep the second, ${String(apart)}`).toBe(BULL_VALUE);
    }
  });

  it('is settled in the order the beasts arrive, one cursor and no rewinding', () => {
    const game = board({ arrival: 5 }, { arrival: 5.4, dir: -1 }, { arrival: 8 });
    let last = 0;
    while (game.winner === null && game.clock < 20) {
      step(game, STEP, false, false);
      expect(game.p1.cursor).toBeGreaterThanOrEqual(last);
      last = game.p1.cursor;
    }
    expect(game.p1.cursor).toBe(3);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Termination and the result                                                            */
/* ------------------------------------------------------------------------------------ */

describe('the end of a match', () => {
  it('arrives whatever anybody does, with no frame cap in this loop', () => {
    // Deliberately uncapped. A course that could fail to finish would hang the suite rather
    // than pass quietly, which is the only way this assertion means anything. This is the
    // property `apps/web/src/data/termination.test.ts` checks through the shell; a survival
    // game is the classic way to fail it, and this is not one — the herd is finite and its
    // last beast arrives at a time fixed before the first step.
    for (const [seed, a, b] of [
      [11, false, false],
      [12, true, true],
      [13, true, false],
    ] as const) {
      const game = fresh(seed);
      const last = (game.hazards[game.count - 1] as Hazard).arrival;
      let steps = 0;
      while (game.winner === null) {
        step(game, STEP, a, b);
        steps += 1;
      }
      expect(game.clock).toBeGreaterThanOrEqual(last - DANGER_HALF);
      expect(game.clock).toBeLessThanOrEqual(courseSeconds(game) + STEP);
      expect(steps * STEP).toBeLessThan(60);
    }
  });

  it('is within a fifth of a second of the same length however well it is played', () => {
    // Not exactly the same, and the difference is the honest one: the last beast settles as
    // it arrives if it bowls you over and as it leaves if you clear it, which is
    // `DANGER_SECONDS` apart. Nothing a player does can make the match longer than that.
    const lengths: number[] = [];
    for (const [a, b] of [
      [false, false],
      [true, true],
      [true, false],
    ] as const) {
      const game = fresh(909);
      while (game.winner === null) step(game, STEP, a, b);
      lengths.push(game.clock);
    }
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(DANGER_SECONDS + STEP);
  });

  it('is won by more points, tied on more clean clears, and drawn on both', () => {
    const game = fresh(5);
    idle(game, courseSeconds(game) + 1);
    expect(winnerOf(game)).toBe('draw');

    game.p1.points = 3;
    expect(winnerOf(game)).toBe('p1');
    game.p2.points = 5;
    expect(winnerOf(game)).toBe('p2');
    game.p1.points = 5;
    expect(winnerOf(game)).toBe('draw');
    game.p2.clean = 1;
    expect(winnerOf(game)).toBe('p2');
    game.p1.clean = 2;
    expect(winnerOf(game)).toBe('p1');
  });

  it('is still running while either runner has a beast left to settle', () => {
    const game = fresh(6);
    idle(game, courseSeconds(game) - 1);
    expect(winnerOf(game)).toBeNull();
    game.p1.cursor = game.count;
    expect(winnerOf(game)).toBeNull();
    game.p2.cursor = game.count;
    expect(winnerOf(game)).not.toBeNull();
  });

  it('stops moving once it is over', () => {
    const game = fresh(7);
    while (game.winner === null) step(game, STEP, true, true);
    const after = describeGame(game);
    for (let i = 0; i < 200; i += 1) step(game, STEP, true, true);
    expect(describeGame(game)).toBe(after);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The half-turn                                                                         */
/* ------------------------------------------------------------------------------------ */

/**
 * The board with the two seats exchanged.
 *
 * In this game the mirror is not a coordinate transform at all — the course belongs to
 * neither seat and there is no seat geometry in `rules.ts` — so the mirror of a board is
 * the board with its two runners swapped. That is exactly what makes the property strong
 * rather than weak: if any rule ever *did* read which seat it was holding, swapping the
 * runners would stop being an exact symmetry and this file would say so.
 *
 * Written because it has found real defects in three of the last eight games, each of the
 * same family: a threshold that a state variable lands on exactly by construction rather
 * than by coincidence, reached by the two seats from opposite ends.
 */
function copyRunner(from: Readonly<Runner>, to: Runner): void {
  to.jumping = from.jumping;
  to.jumpStart = from.jumpStart;
  to.recover = from.recover;
  to.stagger = from.stagger;
  to.cursor = from.cursor;
  to.points = from.points;
  to.cleared = from.cleared;
  to.clean = from.clean;
  to.hits = from.hits;
  to.jumps = from.jumps;
  to.flash = from.flash;
  to.spark = from.spark;
}

function mirrorInto(from: Readonly<Game>, to: Game): void {
  to.clock = from.clock;
  to.count = from.count;
  to.total = from.total;
  to.winner = from.winner === 'p1' ? 'p2' : from.winner === 'p2' ? 'p1' : from.winner;
  for (let i = 0; i < from.count; i += 1) {
    const a = from.hazards[i] as Hazard;
    const b = to.hazards[i] as Hazard;
    b.arrival = a.arrival;
    b.speed = a.speed;
    b.dir = a.dir;
    b.beast = a.beast;
  }
  copyRunner(from.p2, to.p1);
  copyRunner(from.p1, to.p2);
}

/** Everything a step can touch, to twelve decimals. Order is meaningful and compared. */
function describeGame(game: Readonly<Game>): string {
  const twelve = (v: number): string => v.toFixed(12);
  const runner = (r: Readonly<Runner>): string =>
    [
      String(r.jumping),
      twelve(r.jumpStart),
      twelve(r.recover),
      twelve(r.stagger),
      String(r.cursor),
      String(r.points),
      String(r.cleared),
      String(r.clean),
      String(r.hits),
      String(r.jumps),
      twelve(r.flash),
      twelve(r.spark),
    ].join('/');
  const herd = game.hazards
    .slice(0, game.count)
    .map((h) => `${twelve(h.arrival)},${twelve(h.speed)},${String(h.dir)},${h.beast}`)
    .join(' ');
  return [runner(game.p1), runner(game.p2), twelve(game.clock), String(game.winner), herd].join(
    '#',
  );
}

/** An arbitrary but reachable board: any state a runner could be in mid-course. */
function scramble(game: Game, rng: Rng): void {
  const last = courseSeconds(game);
  // On the frame lattice a clock actually visits, so that the exact ties this test exists
  // to catch are everyday events rather than measure-zero ones.
  game.clock = rng.int(0, Math.round(last / STEP)) * STEP;
  for (const seat of ['p1', 'p2'] as const) {
    const runner = runnerOf(game, seat);
    resetRunner(runner);
    // A cursor consistent with the clock, so `settle` has real work to do from here.
    let cursor = 0;
    while (
      cursor < game.count &&
      (game.hazards[cursor] as Hazard).arrival + DANGER_HALF < game.clock
    ) {
      cursor += 1;
    }
    runner.cursor = Math.max(0, cursor - rng.int(0, 2));
    const roll = rng.float();
    if (roll < 0.4) {
      runner.jumping = true;
      // Whole frames back, which is where a jump start always lands.
      runner.jumpStart = game.clock - rng.int(0, Math.round(AIR_SECONDS / STEP)) * STEP;
    } else if (roll < 0.6) {
      runner.stagger = rng.int(1, Math.round(STAGGER_SECONDS / STEP) + 1) * STEP;
    } else if (roll < 0.75) {
      runner.recover = rng.int(1, Math.round(RECOVER_SECONDS / STEP) + 1) * STEP;
    }
    runner.points = rng.int(0, 20);
    runner.cleared = rng.int(0, 15);
    runner.clean = rng.int(0, runner.cleared + 1);
    runner.hits = rng.int(0, 15);
    runner.jumps = rng.int(0, 25);
    runner.flash = rng.int(0, 8) * STEP;
    runner.spark = rng.int(0, 8) * STEP;
  }
}

describe('the half-turn', () => {
  it('steps a swapped board to the swap of the stepped board', () => {
    const rng = new Rng(20260829);
    const game = createGame();
    const other = createGame();
    const expected = createGame();
    for (let trial = 0; trial < 600; trial += 1) {
      resetGame(game, new Rng(trial * 131 + 7));
      scramble(game, rng);
      mirrorInto(game, other);
      const a = rng.bool(0.35);
      const b = rng.bool(0.35);
      step(game, STEP, a, b);
      step(other, STEP, b, a);
      mirrorInto(game, expected);
      expect(describeGame(other), `trial ${String(trial)}`).toBe(describeGame(expected));
    }
  });

  it('makes a bot want the same thing from either seat on a swapped board', () => {
    const rng = new Rng(31337);
    const game = createGame();
    const other = createGame();
    for (const tier of TIERS) {
      for (let trial = 0; trial < 300; trial += 1) {
        resetGame(game, new Rng(trial * 197 + 3));
        scramble(game, rng);
        mirrorInto(game, other);
        const here = createBotState();
        const there = createBotState();
        const seed = rng.int(1, 1 << 30);
        expect(
          botPress(game, 'p1', tier, here, new Rng(seed)),
          `${tier} trial ${String(trial)}`,
        ).toBe(botPress(other, 'p2', tier, there, new Rng(seed)));
        expect(here.target).toBe(there.target);
        expect(here.at).toBe(there.at);
        expect(here.skip).toBe(there.skip);
      }
    }
  });

  it('gives the two runners a bit-identical answer to the same presses', () => {
    // The knife edge the family lives on: both runners settle against the same arrival
    // times, so a threshold either of them lands on exactly must be landed on by both.
    for (let seed = 0; seed < 40; seed += 1) {
      const game = fresh(seed * 613 + 5);
      let n = 0;
      while (game.winner === null) {
        const press = n % 37 === 0;
        step(game, STEP, press, press);
        n += 1;
        expect(describeRunner(game.p1)).toBe(describeRunner(game.p2));
      }
    }
  });

  it('plays a whole swapped match to the swapped result, over hundreds of courses', () => {
    // End to end rather than argued. Seat one's share of decided matches is 50.00% by
    // construction because of this: exchange the two bots' generators and the match is its
    // own mirror, so any seed set closed under that exchange is exactly balanced.
    let flipped = 0;
    let mismatched = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 100; seed += 1) {
        const forward = playBots(seed * 3571 + 1, tier, tier, false);
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

function describeRunner(runner: Readonly<Runner>): string {
  return [
    String(runner.jumping),
    runner.jumpStart.toFixed(12),
    String(runner.cursor),
    String(runner.points),
    String(runner.clean),
    String(runner.hits),
  ].join('/');
}

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

interface Outcome {
  winner: SeatId | 'draw' | null;
  p1: number;
  p2: number;
  clean1: number;
  clean2: number;
  seconds: number;
}

/**
 * A whole bot-versus-bot match, with a generator per seat exactly as `game.ts` derives them.
 *
 * `swap` exchanges the two generators, which is the mirror operation for a match: the same
 * course, the same two hands, the other way round.
 */
function playBots(seed: number, p1: BotDifficulty, p2: BotDifficulty, swap: boolean): Outcome {
  const source = new Rng(seed);
  const game = createGame();
  const course = new Rng(source.next() | 0);
  const first = new Rng(source.next() | 0);
  const second = new Rng(source.next() | 0);
  const rng = swap ? { p1: second, p2: first } : { p1: first, p2: second };
  const state = { p1: createBotState(), p2: createBotState() };
  resetGame(game, course);
  const tier = { p1, p2 };
  while (game.winner === null) {
    const a = botPress(game, 'p1', tier.p1, state.p1, rng.p1);
    const b = botPress(game, 'p2', tier.p2, state.p2, rng.p2);
    step(game, STEP, a, b);
  }
  return {
    winner: game.winner,
    p1: game.p1.points,
    p2: game.p2.points,
    clean1: game.p1.clean,
    clean2: game.p2.clean,
    seconds: game.clock,
  };
}

describe('the bot', () => {
  it('never plans for a beast it cannot see, with room to spare', () => {
    // Rule 6 made structural: `decideAt` takes the *later* of a fixed lead and the moment
    // the beast comes over the horizon, so no value of BOT_PLAN_LEAD can make it cheat. The
    // margin is measured here rather than asserted, because a course change could eat it.
    let margin = Infinity;
    for (let seed = 0; seed < 200; seed += 1) {
      const game = fresh(seed * 9973 + 1);
      for (let i = 0; i < game.count; i += 1) {
        const hazard = game.hazards[i] as Hazard;
        game.clock = decideAt(hazard);
        expect(botCanSee(game, hazard)).toBe(true);
        margin = Math.min(margin, visibleLead(hazard) - BOT_PLAN_LEAD);
        // And the partner it might look at is on screen too, or the choice branch would be
        // reading the future rather than the board.
        if (i + 1 < game.count) {
          const partner = game.hazards[i + 1] as Hazard;
          const apart = partner.arrival - hazard.arrival;
          if (apart <= BOT_PROFILES.hard.planHorizon) {
            expect(botCanSee(game, partner)).toBe(true);
            margin = Math.min(margin, visibleLead(partner) - BOT_PLAN_LEAD - apart);
          }
        }
      }
    }
    expect(margin).toBeGreaterThan(0.25);
  });

  it('draws exactly three values per plan, or none at all, and never a fourth', () => {
    // A conditional draw count makes one seat's play a function of which tier is sitting
    // opposite: Cup Pong measured that shape and Star Catcher paid 1.4 points of win rate
    // for it. Counted exactly, by snapshotting the generator either side of every step.
    for (const tier of TIERS) {
      const game = fresh(4242);
      const state = createBotState();
      const rng = new Rng(99);
      const probe = new Rng(99);
      let plans = 0;
      while (game.winner === null) {
        const before = rng.save();
        const press = botPress(game, 'p1', tier, state, rng);
        const after = rng.save();
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          probe.restore(before);
          for (let i = 0; i < BOT_DRAWS_PER_PLAN; i += 1) probe.float();
          expect(probe.save(), `${tier} at ${game.clock.toFixed(3)}`).toEqual(after);
          plans += 1;
        }
        step(game, STEP, press, false);
      }
      expect(plans, tier).toBeGreaterThan(15);
    }
  });

  it('counts down to a moment rather than waiting for the world to look right', () => {
    // Cup Pong's SPEC records why: a bot that waits for a position can wait for ever, and
    // two easy seats found exactly that on the second seed of its first harness run.
    const game = board({ arrival: 6 });
    const state = createBotState();
    const rng = new Rng(3);
    let pressed = -1;
    while (game.winner === null && game.clock < 20) {
      const press = botPress(game, 'p1', 'hard', state, rng);
      if (press && pressed < 0) pressed = game.clock;
      step(game, STEP, press, false);
    }
    expect(pressed).toBeGreaterThan(0);
    expect(state.at).toBeGreaterThan(0);
    expect(pressed).toBeGreaterThanOrEqual(state.at - STEP);
  });

  it('presses the moment its feet are free when the moment has already gone by', () => {
    // A real way for a person to be late, rather than a way for a bot to cheat.
    const game = board({ arrival: 5 });
    game.p1.stagger = 0.3;
    const state = createBotState();
    state.target = 0;
    state.at = 0;
    state.skip = false;
    game.clock = 4.5;
    expect(botPress(game, 'p1', 'hard', state, new Rng(1))).toBe(false);
    game.p1.stagger = 0;
    expect(botPress(game, 'p1', 'hard', state, new Rng(1))).toBe(true);
  });

  it('keeps its plan while the beast it gave up runs it over', () => {
    // The point of a plan: a tier that deliberately abandons the near half of a choice must
    // not replan the moment that beast settles, or the choice was never made.
    const apart = CHOICE_SEPARATIONS[2] as number;
    const game = board({ arrival: 6 }, { arrival: 6 + apart, beast: 'bull', dir: -1 });
    game.clock = decideAt(game.hazards[0] as Hazard);
    const plan = plannedPress(game, 0, BOT_PROFILES.hard);
    expect(plan.target).toBe(1);
    expect(plan.at).toBeCloseTo(6 + apart - AIR_SECONDS / 2, 12);
  });

  it('takes the first of a choice when it will not look far enough ahead', () => {
    const apart = CHOICE_SEPARATIONS[2] as number;
    const game = board({ arrival: 6 }, { arrival: 6 + apart, beast: 'bull', dir: -1 });
    game.clock = decideAt(game.hazards[0] as Hazard);
    const plan = plannedPress(game, 0, BOT_PROFILES.easy);
    expect(plan.target).toBe(0);
    expect(plan.at).toBeCloseTo(6 - AIR_SECONDS / 2, 12);
  });

  it('aims a pincer at the first of the pair, which is measurably the better moment', () => {
    // Not the midpoint of the two, which is the obvious answer and the wrong one: being
    // early costs one beast and being late costs both, so the optimum sits early of the
    // midpoint, within a frame of the plain centred press. SPEC.md has the table.
    for (const apart of PINCER_SEPARATIONS) {
      const game = board({ arrival: 6 }, { arrival: 6 + apart, dir: -1 });
      game.clock = decideAt(game.hazards[0] as Hazard);
      for (const tier of TIERS) {
        const plan = plannedPress(game, 0, BOT_PROFILES[tier]);
        expect(plan.target).toBe(0);
        expect(plan.at).toBeCloseTo(6 - AIR_SECONDS / 2, 12);
      }
    }
  });

  it('takes the first of two beasts far enough apart for two jumps, and no later than it can', () => {
    // Inert against the shipped course, which never puts two waves inside half a second of
    // each other. Kept because it is the correct rule, and covered here so that a course
    // which did tighten would not be relying on untested code.
    const apart = DANGER_SECONDS + RECOVER_SECONDS + 0.02;
    const game = board({ arrival: 6 }, { arrival: 6 + apart, dir: -1 });
    game.clock = decideAt(game.hazards[0] as Hazard);
    const profile = { ...BOT_PROFILES.hard, planHorizon: apart + 0.1 };
    const plan = plannedPress(game, 0, profile);
    expect(plan.target).toBe(0);
    const latest = 6 + apart - DANGER_HALF - AIR_SECONDS - RECOVER_SECONDS;
    expect(plan.at).toBeLessThanOrEqual(latest + 1e-12);
    expect(plan.at).toBeGreaterThanOrEqual(6 + DANGER_HALF - AIR_SECONDS - 1e-12);
    // And there is genuinely time for the second jump afterwards.
    expect(latest + AIR_SECONDS + RECOVER_SECONDS).toBeLessThanOrEqual(
      6 + apart - DANGER_HALF + 1e-12,
    );
  });

  it('plans for the next beast while still in the air for this one', () => {
    const game = board({ arrival: 5 }, { arrival: 7 });
    game.p1.jumping = true;
    game.p1.jumpStart = 5 - AIR_SECONDS / 2;
    game.clock = 5;
    expect(nextUncovered(game, game.p1)).toBe(1);
    game.p1.jumpStart = 5;
    expect(nextUncovered(game, game.p1)).toBe(0);
  });

  it('has three tiers whose press error is wider than the window at every rung', () => {
    // Rule 6 by construction: no tier picks a moment more finely than a person could. The
    // narrowest tier is still wider end to end than the window it is aiming at.
    let previous = Infinity;
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(profile.pressError * 2).toBeGreaterThan(PRESS_WINDOW);
      expect(profile.pressError).toBeLessThan(previous);
      previous = profile.pressError;
    }
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
    expect(BOT_PROFILES.easy.planHorizon).toBeLessThan(BOT_PROFILES.hard.planHorizon);
  });

  it('is a ladder: each tier beats the one below it from either seat', () => {
    const rate = (a: BotDifficulty, b: BotDifficulty): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        const forward = playBots(seed * 7919 + 1, a, b, false);
        if (forward.winner !== 'draw') decided += 1;
        if (forward.winner === 'p1') wins += 1;
        const back = playBots(seed * 7919 + 1, b, a, false);
        if (back.winner !== 'draw') decided += 1;
        if (back.winner === 'p2') wins += 1;
      }
      return wins / decided;
    };
    expect(rate('hard', 'normal')).toBeGreaterThan(0.8);
    expect(rate('normal', 'easy')).toBeGreaterThan(0.75);
    expect(rate('hard', 'easy')).toBeGreaterThan(0.95);
  });

  it('takes more of the herd the better the tier, and the best of them never takes it all', () => {
    // A duel whose scoring saturates is a duel nobody can lose (Sudoku, Solitaire, Blocks).
    // One runner against one course, so nothing an opponent does can move the number.
    const share = (tier: BotDifficulty): number => {
      let points = 0;
      let total = 0;
      for (let seed = 0; seed < 150; seed += 1) {
        const source = new Rng(seed * 40503 + 17);
        const game = createGame();
        resetGame(game, new Rng(source.next() | 0));
        const rng = new Rng(source.next() | 0);
        const state = createBotState();
        while (game.winner === null) {
          const press = botPress(game, 'p1', tier, state, rng);
          step(game, STEP, press, false);
        }
        points += game.p1.points;
        total += game.total;
      }
      return points / total;
    };
    const easy = share('easy');
    const normal = share('normal');
    const hard = share('hard');
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
    expect(easy).toBeGreaterThan(0.25);
    expect(hard).toBeLessThan(0.9);
  });

  it('is reset to no plan at all, so a fresh match cannot inherit one', () => {
    const state = createBotState();
    state.target = 4;
    state.at = 9;
    state.skip = true;
    resetBotState(state);
    expect(state).toEqual(createBotState());
  });
});
