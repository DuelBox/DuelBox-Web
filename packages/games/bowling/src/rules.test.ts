import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  FALL_DISTANCE,
  FOUL_LINE_Y,
  FRAMES,
  GUTTER,
  LANE_WIDTH,
  PINS,
  PIN_DRAG_RATE,
  PIN_SPOTS,
  ROLL_DRAG_RATE,
  STOP_SPEED,
  THROW_SPEED,
  botAim,
  bowl,
  createGame,
  frameStarts,
  isStrike,
  laneIsStill,
  otherOf,
  recordBall,
  resetGame,
  resetRack,
  rollsOf,
  scoreOf,
  standingCount,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function settle(game: Game, maxSteps = 60 * 20): void {
  for (let i = 0; i < maxSteps; i += 1) {
    if (step(game, STEP).settled) return;
  }
}

/** Knocks `count` pins over directly, for testing the bookkeeping without bowling. */
function flatten(game: Game, count: number): void {
  let left = count;
  for (const pin of game.pins) {
    if (left === 0) break;
    if (pin.down) continue;
    pin.down = true;
    left -= 1;
  }
}

describe('scoring', () => {
  // The intricate part: a frame's value is not known when it is bowled.
  it('adds an open frame up', () => {
    expect(scoreOf([3, 4])).toBe(7);
  });

  it('gives a spare ten plus the next ball', () => {
    expect(scoreOf([7, 3, 5, 2])).toBe(10 + 5 + 5 + 2);
  });

  it('gives a strike ten plus the next two balls', () => {
    expect(scoreOf([10, 4, 3])).toBe(10 + 4 + 3 + 4 + 3);
  });

  it('lets one strike feed the next', () => {
    expect(scoreOf([10, 10, 4, 2])).toBe(10 + 10 + 4 + (10 + 4 + 2) + (4 + 2));
  });

  it('scores four strikes with the bonus balls that follow', () => {
    // 10, 10, 10, 10 then two bonus balls of 10 each: 30 + 30 + 30 + 30.
    expect(scoreOf([10, 10, 10, 10, 10, 10])).toBe(120);
  });

  it('scores a gutter game as nothing', () => {
    expect(scoreOf([0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
  });

  it('scores what is known so far from an unfinished list', () => {
    expect(scoreOf([10]), 'the bonus balls have not been bowled').toBe(10);
    expect(scoreOf([4])).toBe(4);
    expect(scoreOf([])).toBe(0);
  });

  it('stops at the frame count', () => {
    // Rolls beyond four frames are bonus balls, not frames of their own.
    expect(scoreOf([1, 1, 1, 1, 1, 1, 1, 1, 9, 9])).toBe(8);
  });

  it('knows a strike when it sees one', () => {
    expect(isStrike([10, 4], 0)).toBe(true);
    expect(isStrike([9, 1], 0)).toBe(false);
  });

  it('finds where each frame starts, so a scoreboard can show them', () => {
    const out: number[] = [];
    // Strike, then an open frame, then a spare, then nothing yet.
    expect(frameStarts(out, [10, 3, 4, 7, 3])).toEqual([0, 1, 3, -1]);
  });
});

describe('the rack', () => {
  it('sets ten pins', () => {
    const game = createGame();
    expect(game.pins.length).toBe(PINS);
    expect(PIN_SPOTS.length).toBe(PINS);
    expect(standingCount(game)).toBe(PINS);
  });

  it('sets them without overlapping', () => {
    const game = createGame();
    for (let i = 0; i < game.pins.length; i += 1) {
      for (let j = i + 1; j < game.pins.length; j += 1) {
        const a = game.pins[i];
        const b = game.pins[j];
        if (a === undefined || b === undefined) continue;
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(FALL_DISTANCE);
      }
    }
  });

  it('sets them all inside the lane, clear of the gutters', () => {
    for (const [x] of PIN_SPOTS) {
      expect(x).toBeGreaterThan(GUTTER);
      expect(x).toBeLessThan(LANE_WIDTH - GUTTER);
    }
  });

  it('leaves the survivors standing for a second ball', () => {
    const game = createGame();
    flatten(game, 4);
    const standing = game.pins.map((pin) => !pin.down);
    resetRack(game, standing);
    expect(standingCount(game), 'six left').toBe(6);
  });

  it('sets a full rack when nothing is passed', () => {
    const game = createGame();
    flatten(game, 4);
    resetRack(game);
    expect(standingCount(game)).toBe(PINS);
  });
});

describe('bowling a ball', () => {
  it('sends the ball up the lane', () => {
    const game = createGame();
    expect(bowl(game, 0, 1)).toBe(true);
    expect(game.ball.vy, 'up the lane is negative y').toBeLessThan(0);
    expect(game.phase).toBe('rolling');
  });

  it('refuses a second ball while one is rolling', () => {
    const game = createGame();
    bowl(game, 0, 1);
    expect(bowl(game, 0, 1)).toBe(false);
  });

  it('refuses a ball with no power', () => {
    const game = createGame();
    expect(bowl(game, 0, 0)).toBe(false);
    expect(game.phase).toBe('aiming');
  });

  it('remembers how many were standing when it left the hand', () => {
    const game = createGame();
    flatten(game, 3);
    bowl(game, 0, 1);
    expect(game.standingBefore).toBe(7);
  });

  it('knocks pins down when it reaches them', () => {
    const game = createGame();
    bowl(game, 0, 1);
    settle(game);
    expect(standingCount(game), 'a ball down the middle takes some').toBeLessThan(PINS);
  });

  it('comes to rest rather than rolling for ever', () => {
    const game = createGame();
    bowl(game, 0.05, 1);
    settle(game);
    expect(laneIsStill(game)).toBe(true);
  });

  it('takes nothing from a gutter ball', () => {
    // A ball in the channel runs past the pins and hits nothing, which is the whole point
    // of a gutter and the thing a beginner needs the game to model honestly.
    const game = createGame();
    const ball = game.ball;
    ball.x = GUTTER - BALL_RADIUS;
    bowl(game, 0, 1);
    settle(game);
    expect(standingCount(game)).toBe(PINS);
  });

  it('takes nothing from a gutter ball even when it is steered at the pins', () => {
    // The first version of this rolled straight up the channel, which hits nothing whether
    // or not the gutter rule exists. Aim it *at* the rack from inside the gutter: only the
    // rule keeps the pins standing.
    const game = createGame();
    game.ball.x = GUTTER - BALL_RADIUS;
    bowl(game, 0.35, 1);
    settle(game);
    expect(standingCount(game), 'a ball in the channel reaches nothing').toBe(PINS);
  });

  it('drops into the pit rather than sailing on above the lane', () => {
    // A ball still carrying speed past the deck takes about eight seconds to crawl to a
    // halt, and the pins are not counted until the lane is still — so every ball was
    // followed by a long dead wait. The unit tests never saw it; a browser did at once.
    const game = createGame();
    for (const pin of game.pins) pin.swept = true;
    bowl(game, 0, 1);
    let steps = 0;
    for (; steps < 60 * 30; steps += 1) {
      if (step(game, STEP).settled) break;
    }
    expect(steps / 60, 'the lane is still within a couple of seconds').toBeLessThan(2);
  });

  it('replays identically from the same ball', () => {
    const trace = (): string => {
      const game = createGame();
      bowl(game, 0.04, 0.9);
      settle(game);
      return game.pins
        .map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${String(p.down)}`)
        .join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('rolls the same distance whatever the step size', () => {
    // Rule 8: the drag has to be a per-second decay rather than a per-step multiply.
    //
    // Measured on a bare lane rather than on the pins. Ten pins bouncing off each other is
    // chaotic — a difference of a millionth in the first contact ends with a different pin
    // count — so comparing racks across step sizes would be testing the weather. The
    // engine's timestep is fixed for every device anyway; what this guards is the shape of
    // the drag, and the seeded replay above guards the rest.
    //
    // **To nine decimals, not to one per cent.** This assertion used to allow a whole per
    // cent of the lane and passed on code that was 0.44% long at 60 Hz and 0.11% at 240 —
    // it named the right property and then set a band wide enough to hide the thing it was
    // watching for. A per-second decay integrated by `v · dt` cannot agree across step
    // sizes; integrated by `(v_before - v_after) / rate` it agrees to floating point,
    // because the terms telescope. The tolerance is what turned a real defect into a
    // passing test, so the tolerance is what had to go.
    //
    // Bowled at 0.3 rather than the 0.4 this used to use, and that matters. At 0.4 the ball
    // runs 1147 units up an 880-unit lane, so it never comes to rest at all — it sails off
    // the deck and is zeroed by the pit rule, which is a discrete boundary test and so
    // lands wherever the step happened to put it. The old figure was measuring the pit, not
    // the roll, and only the one per cent band let it look like the roll. 0.3 stops the
    // ball on the lane with 26 units to spare.
    const restingY = (dt: number): number => {
      const game = createGame();
      for (const pin of game.pins) pin.swept = true;
      bowl(game, 0, 0.3);
      for (let i = 0; i < Math.round(20 / dt); i += 1) {
        if (step(game, dt).settled) break;
      }
      return game.ball.y;
    };
    const reference = restingY(1 / 60);
    for (const hz of [90, 120, 240]) {
      expect(restingY(1 / hz), `${hz} Hz agrees with 60 Hz`).toBeCloseTo(reference, 9);
    }
  });

  it('rolls exactly the distance the closed-form law predicts', () => {
    // The defect issue #2465 is about, in the form that bites: the velocity decay was
    // already step-size exact, but the *position* was a rectangle rule under a falling
    // curve, so the lane disagreed with its own distance law by `dt · rate / 2` — 0.43% a
    // step for the ball and 2.10% for a pin, whose drag is five times heavier.
    //
    // No tier of this game's bot reads the law: it aims at the centroid of what is standing
    // and bowls at a flat power per tier, so nothing here was ever handicapped by the gap
    // the way Soccer Pool's bot was. This test is what stops that changing quietly — anyone
    // who later teaches the bot how far a ball runs gets a law that is true.
    // Powers that stop the ball short of the pit; past the deck it is zeroed on purpose and
    // there is no free roll left to measure.
    for (const power of [0.15, 0.2, 0.25, 0.3]) {
      const game = createGame();
      for (const pin of game.pins) pin.swept = true;
      bowl(game, 0, power);
      const start = game.ball.y;
      for (let i = 0; i < 60 * 20; i += 1) if (step(game, STEP).settled) break;
      const speed = THROW_SPEED * power;
      expect(
        start - game.ball.y,
        `a ball at power ${power} runs (v - STOP_SPEED) / rate`,
      ).toBeCloseTo((speed - STOP_SPEED) / ROLL_DRAG_RATE, 9);
    }
  });

  it('runs a pin exactly the distance the closed-form law predicts', () => {
    // The pins carry the heavier drag and so carried the larger error: 2.10% a step.
    for (const speed of [200, 400, 700]) {
      const game = createGame();
      for (const pin of game.pins) pin.swept = true;
      const pin = game.pins[0];
      if (pin === undefined) throw new Error('no fixture');
      pin.swept = false;
      pin.x = LANE_WIDTH / 2;
      pin.y = 500;
      pin.vy = speed;
      game.phase = 'rolling';
      const start = pin.y;
      for (let i = 0; i < 60 * 20; i += 1) {
        step(game, STEP);
        if (pin.vy === 0) break;
      }
      expect(pin.y - start, `a pin at ${speed} runs (v - STOP_SPEED) / rate`).toBeCloseTo(
        (speed - STOP_SPEED) / PIN_DRAG_RATE,
        9,
      );
    }
  });

  it('stops a body below the crawl speed', () => {
    const game = createGame();
    game.phase = 'rolling';
    const ball = game.ball;
    ball.vy = -STOP_SPEED * 0.5;
    step(game, STEP);
    expect(ball.vy).toBe(0);
  });

  it('counts a pin as down once it is knocked clear of its spot', () => {
    const game = createGame();
    game.phase = 'rolling';
    const pin = game.pins[0];
    if (pin === undefined) throw new Error('no fixture');
    pin.vx = 900;
    for (let i = 0; i < 20; i += 1) step(game, STEP);
    expect(pin.down).toBe(true);
  });
});

describe('frames and turns', () => {
  function bowlKnocking(game: Game, count: number): ReturnType<typeof recordBall> {
    game.standingBefore = standingCount(game);
    flatten(game, count);
    return recordBall(game);
  }

  it('ends a frame on a strike and hands over', () => {
    const game = createGame();
    const result = bowlKnocking(game, PINS);
    expect(result.frameOver).toBe(true);
    expect(game.seat).toBe('p2');
    expect(game.frameP1).toBe(1);
  });

  it('gives a second ball after an open first', () => {
    const game = createGame();
    const result = bowlKnocking(game, 6);
    expect(result.frameOver).toBe(false);
    expect(game.seat, 'still your frame').toBe('p1');
    expect(standingCount(game), 'the four you missed are still up').toBe(4);
  });

  it('ends the frame after a second ball, struck or not', () => {
    const game = createGame();
    bowlKnocking(game, 6);
    const second = bowlKnocking(game, 4);
    expect(second.frameOver).toBe(true);
    expect(rollsOf(game, 'p1')).toEqual([6, 4]);
  });

  it('gives a third ball in the last frame after a strike', () => {
    const game = createGame();
    game.frameP1 = FRAMES - 1;
    const first = bowlKnocking(game, PINS);
    expect(first.frameOver, 'the last frame earns the extra balls').toBe(false);
    const second = bowlKnocking(game, PINS);
    expect(second.frameOver).toBe(false);
    const third = bowlKnocking(game, PINS);
    expect(third.frameOver).toBe(true);
  });

  it('gives a third ball in the last frame after a spare', () => {
    const game = createGame();
    game.frameP1 = FRAMES - 1;
    bowlKnocking(game, 7);
    const second = bowlKnocking(game, 3);
    expect(second.frameOver, 'a spare earns one more').toBe(false);
  });

  it('does not give a third ball in the last frame after an open', () => {
    const game = createGame();
    game.frameP1 = FRAMES - 1;
    bowlKnocking(game, 7);
    const second = bowlKnocking(game, 2);
    expect(second.frameOver).toBe(true);
  });

  it('sets a fresh rack when a second ball clears the deck', () => {
    const game = createGame();
    game.frameP1 = FRAMES - 1;
    bowlKnocking(game, 7);
    bowlKnocking(game, 3);
    expect(standingCount(game), 'a spare in the last frame re-racks').toBe(PINS);
  });

  it('ends the match once both have bowled every frame', () => {
    // Bowl until each frame reports itself over: a strike in the last frame earns two more
    // balls, so a fixed one-ball-a-frame loop stops a frame short and the match never ends.
    const game = createGame();
    for (let i = 0; i < 40 && game.phase !== 'over'; i += 1) {
      bowlKnocking(game, PINS);
    }
    expect(game.phase).toBe('over');
    expect(game.frameP1).toBe(FRAMES);
    expect(game.frameP2).toBe(FRAMES);
  });

  it('is not over while one seat has a frame left', () => {
    const game = createGame();
    game.frameP1 = FRAMES;
    game.frameP2 = FRAMES - 1;
    game.seat = 'p2';
    bowlKnocking(game, 3);
    expect(game.phase).not.toBe('over');
  });
});

describe('the match', () => {
  it('has no winner while it is live', () => {
    expect(winnerOf(createGame())).toBeNull();
  });

  it('gives it to the higher score', () => {
    const game = createGame();
    game.phase = 'over';
    game.rollsP1.push(10, 10, 10, 10, 10, 10);
    game.rollsP2.push(0, 0, 0, 0, 0, 0, 0, 0);
    expect(winnerOf(game)).toBe('p1');
  });

  it('calls equal scores a draw', () => {
    const game = createGame();
    game.phase = 'over';
    game.rollsP1.push(4, 4);
    game.rollsP2.push(3, 5);
    expect(winnerOf(game)).toBe('draw');
  });

  it('starts over on reset', () => {
    const game = createGame();
    game.rollsP1.push(10);
    game.frameP1 = 3;
    resetGame(game);
    expect(game.rollsP1.length).toBe(0);
    expect(game.frameP1).toBe(0);
    expect(game.seat).toBe('p1');
    expect(standingCount(game)).toBe(PINS);
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('aims up the lane with usable power', () => {
    for (const difficulty of DIFFICULTIES) {
      const game = createGame();
      const aim = botAim(game, difficulty, 0.5);
      expect(Number.isFinite(aim.angle)).toBe(true);
      expect(Math.abs(aim.angle), 'roughly straight at a full rack').toBeLessThan(0.2);
      expect(aim.power).toBeGreaterThan(0);
    }
  });

  it('aims at what is left rather than at the middle', () => {
    // Only the right-hand pins standing: the ball has to go right.
    const game = createGame();
    for (const pin of game.pins) {
      if (pin.homeX <= LANE_WIDTH / 2) pin.down = true;
    }
    const aim = botAim(game, 'hard', 0.5);
    expect(aim.angle, 'leaning right').toBeGreaterThan(0.02);
  });

  it('aims at the pocket rather than the head pin', () => {
    // A ball that hits the one pin dead centre leaves a split, which is why every bowler
    // is taught to come in between the one and the three. Aiming at the centroid made the
    // most accurate tier the *worst* — 8.9 pins a ball against a weaker tier's 9.9.
    const game = createGame();
    const aim = botAim(game, 'hard', 0.5);
    expect(aim.angle, 'off the middle, toward the pocket').toBeGreaterThan(0.005);
  });

  it('aims straight at what is left once the rack is broken', () => {
    // The pocket only exists at a full rack; after that you aim at the pins themselves.
    const game = createGame();
    const head = game.pins[0];
    if (head === undefined) throw new Error('no fixture');
    head.down = true;
    head.swept = true;
    const aim = botAim(game, 'hard', 0.5);
    expect(Math.abs(aim.angle)).toBeLessThan(0.05);
  });

  it('carries through the rack often enough to strike', () => {
    // A pin that has been hit is sliding, and in bowling that is what takes out the pins
    // behind it. Measured over 300 balls: 50.7% strikes with fallen pins removed from the
    // physics, 61.3% with them carrying. The threshold sits between the two, so taking the
    // carry away fails this rather than merely making the game a little worse.
    const rng = new Rng(101);
    let strikes = 0;
    const balls = 300;
    for (let i = 0; i < balls; i += 1) {
      const game = createGame();
      const aim = botAim(game, 'hard', rng.float());
      bowl(game, aim.angle, aim.power);
      settle(game);
      if (standingCount(game) === 0) strikes += 1;
    }
    expect(strikes / balls, 'the best tier clears the rack regularly').toBeGreaterThan(0.55);
  });

  it('is steadier the harder it is', () => {
    expect(BOT_PROFILES.easy.spread).toBeGreaterThan(BOT_PROFILES.normal.spread);
    expect(BOT_PROFILES.normal.spread).toBeGreaterThan(BOT_PROFILES.hard.spread);
  });

  it('draws its error once for the ball, not per step', () => {
    const game = createGame();
    expect(botAim(game, 'easy', 0.1).angle).not.toBe(botAim(game, 'easy', 0.9).angle);
    expect(botAim(game, 'easy', 0.4).angle).toBe(botAim(game, 'easy', 0.4).angle);
  });

  it('does nothing strange when the rack is empty', () => {
    const game = createGame();
    for (const pin of game.pins) pin.down = true;
    const aim = botAim(game, 'hard', 0.5);
    expect(Number.isFinite(aim.angle)).toBe(true);
  });

  it('knocks more pins down the harder it is', () => {
    const averageFor = (difficulty: BotDifficulty): number => {
      let total = 0;
      const balls = 120;
      const rng = new Rng(31);
      for (let i = 0; i < balls; i += 1) {
        const game = createGame();
        const aim = botAim(game, difficulty, rng.float());
        bowl(game, aim.angle, aim.power);
        settle(game);
        total += PINS - standingCount(game);
      }
      return total / balls;
    };
    const easy = averageFor('easy');
    const normal = averageFor('normal');
    const hard = averageFor('hard');
    expect(normal, `normal ${String(normal)} beats easy ${String(easy)}`).toBeGreaterThan(easy);
    expect(hard, `hard ${String(hard)} beats normal ${String(normal)}`).toBeGreaterThan(normal);
  });
});

describe('seats', () => {
  it('has two', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('starts the ball on the foul line', () => {
    const game = createGame();
    expect(game.ball.y).toBe(FOUL_LINE_Y);
  });
});
