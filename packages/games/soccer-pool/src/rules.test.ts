import { describe, expect, it } from 'vitest';
import { resolve } from '@duelbox/game-sdk';
import type { SeatId } from '@duelbox/engine';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  CENTRE_X,
  CENTRE_Y,
  DISC_RADIUS,
  DRAG_RATE,
  GOAL_HALF_WIDTH,
  GOAL_TARGET,
  MAX_SHOTS,
  PITCH_BOTTOM,
  PITCH_HEIGHT,
  PITCH_LEFT,
  PITCH_RIGHT,
  PITCH_TOP,
  ROLL_DRAG,
  SAFETY_REACH,
  SETTLE_BOUND_SECONDS,
  STOP_SPEED,
  STRIKE_MAX_SPEED,
  WALL_BOUNCE,
  WIN_CONDITION,
  atRest,
  attackingGoalY,
  ballOf,
  botAim,
  centreBall,
  clearance,
  createMatch,
  defendingGoalY,
  fumbleShot,
  insideMouth,
  kickOff,
  otherOf,
  powerFor,
  radiusOf,
  reachOf,
  resetMatch,
  restorePosts,
  settleShot,
  shotsLeft,
  step,
  strike,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Disc, Match, ShotOutcome } from './rules.js';

const STEP = 1 / 60;
/** Comfortably past the 3.06 s settling bound, so no loop here can spin. */
const SETTLE_CAP = 60 * 10;

/** Roll the pitch until it settles. Returns the seat that scored, and how many steps it took. */
function settle(match: Match, cap = SETTLE_CAP): { goal: SeatId | null; steps: number } {
  for (let i = 1; i <= cap; i += 1) {
    const result = step(match, STEP);
    if (result.settled) return { goal: result.goal, steps: i };
  }
  throw new Error('the pitch never settled — see SETTLE_BOUND_SECONDS');
}

/** The ball alone on the grass, for a test that wants to state its own geometry. */
function emptyPitch(): Match {
  const match = createMatch();
  match.discs.length = 1;
  return match;
}

/** Put the ball somewhere and let it go, with nothing else on the pitch. */
function freeRoll(angle: number, power: number, fromX = CENTRE_X, fromY = CENTRE_Y): Match {
  const match = emptyPitch();
  const ball = ballOf(match);
  ball.x = fromX;
  ball.y = fromY;
  strike(match, angle, power);
  return match;
}

function speedOf(disc: Disc): number {
  return Math.hypot(disc.vx, disc.vy);
}

/** Total kinetic energy, up to the shared mass. Never rises; see SETTLE_BOUND_SECONDS. */
function energy(match: Match): number {
  let total = 0;
  for (const disc of match.discs) total += disc.vx * disc.vx + disc.vy * disc.vy;
  return total;
}

/** Apply a settled shot the way `SoccerPoolGame` does, so a rules test can play a match. */
function apply(match: Match, outcome: ShotOutcome): void {
  if (outcome.winner !== null) {
    match.winner = outcome.winner;
    match.phase = 'over';
    return;
  }
  match.seat = outcome.next;
  match.phase = 'aiming';
}

/**
 * The same pitch seen from the other chair.
 *
 * A half turn about the centre spot, which is exactly the rotation the board makes when
 * the turn changes: every position and velocity is negated through the centre, the two
 * sets of discs change hands, and the score changes hands with them. Nothing about the
 * game may notice.
 */
function mirrorOf(match: Match): Match {
  const out = createMatch();
  const place = (to: number, from: number): void => {
    const target = out.discs[to]!;
    const source = match.discs[from]!;
    target.x = 2 * CENTRE_X - source.x;
    target.y = 2 * CENTRE_Y - source.y;
    target.vx = -source.vx;
    target.vy = -source.vy;
  };
  place(0, 0);
  for (let i = 1; i <= 3; i += 1) {
    place(i, i + 3);
    place(i + 3, i);
  }
  out.seat = otherOf(match.seat);
  out.phase = match.phase;
  out.p1 = match.p2;
  out.p2 = match.p1;
  out.shots = match.shots;
  return out;
}

/** How far apart two angles are, ignoring whole turns. */
function angleGap(a: number, b: number): number {
  let gap = (a - b) % (Math.PI * 2);
  if (gap > Math.PI) gap -= Math.PI * 2;
  if (gap < -Math.PI) gap += Math.PI * 2;
  return Math.abs(gap);
}

/** Where a line from the ball at `angle` meets the goal line at `lineY`. */
function crossingX(fromX: number, fromY: number, angle: number, lineY: number): number {
  const dy = Math.sin(angle);
  const dx = Math.cos(angle);
  return fromX + (dx * (lineY - fromY)) / dy;
}

const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

describe('the pitch', () => {
  it('is a box of logical units, never pixels', () => {
    expect(PITCH_RIGHT - PITCH_LEFT).toBe(620);
    expect(PITCH_HEIGHT).toBe(780);
    expect(Number.isInteger(CENTRE_X)).toBe(true);
    expect(Number.isInteger(CENTRE_Y)).toBe(true);
  });

  it('centres the two goals on the same line as the centre spot', () => {
    expect(CENTRE_X).toBe((PITCH_LEFT + PITCH_RIGHT) / 2);
    expect(CENTRE_Y).toBe((PITCH_TOP + PITCH_BOTTOM) / 2);
  });

  it('has a mouth wider than the ball and narrower than the pitch', () => {
    expect(GOAL_HALF_WIDTH * 2).toBeGreaterThan(BALL_RADIUS * 4);
    expect(GOAL_HALF_WIDTH * 2).toBeLessThan(PITCH_RIGHT - PITCH_LEFT);
  });

  it('leaves a ball more room to pass a keeper than the ball is wide', () => {
    // The keeper stands in the middle of the mouth, so what a shot has to find is the gap
    // between it and a post. A mouth that did not leave one would be unbeatable.
    const window = GOAL_HALF_WIDTH - BALL_RADIUS - (DISC_RADIUS + BALL_RADIUS);
    expect(window).toBeGreaterThan(BALL_RADIUS);
  });

  it('lets a full-power shot outrun the pitch', () => {
    // Otherwise there are squares of grass from which no shot on goal exists at all.
    expect(reachOf(1)).toBeGreaterThan(PITCH_HEIGHT);
  });

  it('gives each seat the goal at the far end', () => {
    expect(attackingGoalY('p1')).toBe(PITCH_TOP);
    expect(attackingGoalY('p2')).toBe(PITCH_BOTTOM);
    expect(defendingGoalY('p1')).toBe(PITCH_BOTTOM);
    expect(defendingGoalY('p2')).toBe(PITCH_TOP);
  });

  it('makes the two seats opposites', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
    expect(otherOf(otherOf('p1'))).toBe('p1');
  });

  it('gives the ball and the discs their own radii', () => {
    expect(radiusOf('ball')).toBe(BALL_RADIUS);
    expect(radiusOf('p1')).toBe(DISC_RADIUS);
    expect(radiusOf('p2')).toBe(DISC_RADIUS);
  });
});

describe('the kick-off', () => {
  it('is one ball and three discs a side', () => {
    const match = createMatch();
    expect(match.discs.length).toBe(7);
    expect(match.discs.filter((disc) => disc.kind === 'p1').length).toBe(3);
    expect(match.discs.filter((disc) => disc.kind === 'p2').length).toBe(3);
    expect(ballOf(match).kind).toBe('ball');
  });

  it('puts the ball on the centre spot', () => {
    const ball = ballOf(createMatch());
    expect(ball.x).toBe(CENTRE_X);
    expect(ball.y).toBe(CENTRE_Y);
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
  });

  it('puts every disc inside the boards', () => {
    for (const disc of createMatch().discs) {
      const radius = radiusOf(disc.kind);
      expect(disc.x).toBeGreaterThanOrEqual(PITCH_LEFT + radius);
      expect(disc.x).toBeLessThanOrEqual(PITCH_RIGHT - radius);
      expect(disc.y).toBeGreaterThanOrEqual(PITCH_TOP + radius);
      expect(disc.y).toBeLessThanOrEqual(PITCH_BOTTOM - radius);
    }
  });

  it('overlaps nothing with anything', () => {
    const discs = createMatch().discs;
    for (let i = 0; i < discs.length; i += 1) {
      for (let j = i + 1; j < discs.length; j += 1) {
        const a = discs[i]!;
        const b = discs[j]!;
        expect(
          Math.hypot(b.x - a.x, b.y - a.y),
          `discs ${String(i)} and ${String(j)} overlap`,
        ).toBeGreaterThan(radiusOf(a.kind) + radiusOf(b.kind));
      }
    }
  });

  it('stands a keeper in each mouth', () => {
    const match = createMatch();
    for (const seat of ['p1', 'p2'] as const) {
      const line = defendingGoalY(seat);
      const keeper = match.discs.find(
        (disc) => disc.kind === seat && Math.abs(disc.y - line) < DISC_RADIUS * 2,
      );
      expect(keeper, `${seat} has no keeper`).toBeDefined();
      expect(insideMouth(keeper!.x)).toBe(true);
    }
  });

  it('is exactly the same layout every match', () => {
    const shape = (match: Match): string =>
      match.discs.map((disc) => `${disc.kind}@${String(disc.x)},${String(disc.y)}`).join('|');
    expect(shape(createMatch())).toBe(shape(createMatch()));
  });

  it('is a half turn of itself, so neither seat has the easier side', () => {
    const match = createMatch();
    for (let i = 1; i <= 3; i += 1) {
      const mine = match.discs[i]!;
      const theirs = match.discs[i + 3]!;
      expect(mine.kind).toBe('p1');
      expect(theirs.kind).toBe('p2');
      expect(2 * CENTRE_X - mine.x).toBeCloseTo(theirs.x, 12);
      expect(2 * CENTRE_Y - mine.y).toBeCloseTo(theirs.y, 12);
    }
  });

  it('gives every post a home to go back to', () => {
    for (const disc of createMatch().discs) {
      expect(disc.postX).toBe(disc.x);
      expect(disc.postY).toBe(disc.y);
    }
  });

  it('starts level, aiming, with seat one to play', () => {
    const match = createMatch();
    expect(match.p1).toBe(0);
    expect(match.p2).toBe(0);
    expect(match.seat).toBe('p1');
    expect(match.phase).toBe('aiming');
    expect(match.shots).toBe(0);
    expect(match.winner).toBeNull();
    expect(match.lastGoal).toBeNull();
    expect(match.fumbled).toBe(false);
    expect(winnerOf(match)).toBeNull();
  });
});

describe('striking the ball', () => {
  it('sends it off along the angle given', () => {
    const match = createMatch();
    expect(strike(match, 0, 1)).toBe(true);
    const ball = ballOf(match);
    expect(ball.vx).toBeCloseTo(STRIKE_MAX_SPEED, 6);
    expect(ball.vy).toBeCloseTo(0, 6);
    expect(match.phase).toBe('rolling');
  });

  it('scales the speed straight with the power', () => {
    for (const power of [0.1, 0.25, 0.5, 0.75, 1]) {
      const match = createMatch();
      strike(match, Math.PI / 3, power);
      expect(speedOf(ballOf(match))).toBeCloseTo(STRIKE_MAX_SPEED * power, 6);
    }
  });

  it('moves only the ball', () => {
    const match = createMatch();
    strike(match, 1.2, 1);
    for (const disc of match.discs.slice(1)) {
      expect(disc.vx).toBe(0);
      expect(disc.vy).toBe(0);
    }
  });

  it('spends one of the shots in the match', () => {
    const match = createMatch();
    strike(match, 0, 1);
    expect(match.shots).toBe(1);
    expect(shotsLeft(match)).toBe(MAX_SHOTS - 1);
  });

  it('refuses a second strike while the ball is rolling', () => {
    const match = createMatch();
    strike(match, 0, 1);
    expect(strike(match, 1, 1)).toBe(false);
    expect(match.shots, 'and does not spend a shot on the refusal').toBe(1);
  });

  it('refuses a shot with no power behind it', () => {
    const match = createMatch();
    expect(strike(match, 0, 0)).toBe(false);
    expect(match.phase).toBe('aiming');
    expect(match.shots).toBe(0);
  });

  it('refuses a negative power rather than shooting backwards', () => {
    const match = createMatch();
    expect(strike(match, 0, -1)).toBe(false);
    expect(ballOf(match).vx).toBe(0);
  });

  it('clamps a power above one', () => {
    const match = createMatch();
    strike(match, 0.4, 40);
    expect(speedOf(ballOf(match))).toBeCloseTo(STRIKE_MAX_SPEED, 6);
  });

  it('refuses once the match is over', () => {
    const match = createMatch();
    match.phase = 'over';
    expect(strike(match, 0, 1)).toBe(false);
  });

  it('clears the verdict of the shot before it', () => {
    const match = createMatch();
    match.lastGoal = 'p2';
    match.fumbled = true;
    strike(match, 0, 1);
    expect(match.lastGoal).toBeNull();
    expect(match.fumbled).toBe(false);
  });
});

describe('the grass', () => {
  it('brings the ball to rest rather than rolling for ever', () => {
    const match = freeRoll(0.3, 1, PITCH_LEFT + 60, PITCH_TOP + 60);
    settle(match);
    expect(atRest(match)).toBe(true);
  });

  it('stops it dead rather than leaving it creeping', () => {
    const match = freeRoll(0.3, 1, PITCH_LEFT + 60, PITCH_TOP + 60);
    settle(match);
    const ball = ballOf(match);
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
  });

  it('rolls a struck ball exactly as far as reachOf says', () => {
    // The bot's whole sense of weight is this one function, so it must be the distance the
    // simulation really produces rather than an estimate of it.
    for (const power of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5]) {
      const match = freeRoll(0, power, PITCH_LEFT + BALL_RADIUS, CENTRE_Y);
      settle(match);
      const travelled = ballOf(match).x - (PITCH_LEFT + BALL_RADIUS);
      expect(travelled, `power ${String(power)}`).toBeCloseTo(reachOf(power), 6);
    }
  });

  it('rolls the same distance at 60, 90, 120 and 240 Hz', () => {
    // The property Mini Golf went to constant deceleration for, reached here by integrating
    // the decay this game already had. Forward Euler would drift by 1.3% between the first
    // rate and the last, which is a different shot on a 120 Hz phone.
    const where: number[] = [];
    for (const hz of [60, 90, 120, 240]) {
      const match = freeRoll(0, 0.5, PITCH_LEFT + BALL_RADIUS, CENTRE_Y);
      const ball = ballOf(match);
      for (let i = 0; i < hz * 10; i += 1) {
        if (step(match, 1 / hz).settled) break;
      }
      where.push(ball.x);
    }
    for (const x of where) expect(x).toBeCloseTo(where[0]!, 9);
  });

  it('takes all but ROLL_DRAG of the speed off every second', () => {
    const match = freeRoll(0, 1, PITCH_LEFT + BALL_RADIUS, CENTRE_Y);
    const ball = ballOf(match);
    // Straight up the long axis of an empty pitch, so no board is reached in one second.
    ball.x = CENTRE_X;
    ball.y = PITCH_BOTTOM - BALL_RADIUS;
    ball.vx = 0;
    ball.vy = -STRIKE_MAX_SPEED * 0.4;
    for (let i = 0; i < 60; i += 1) step(match, STEP);
    expect(speedOf(ball)).toBeCloseTo(STRIKE_MAX_SPEED * 0.4 * ROLL_DRAG, 6);
  });

  it('never moves a disc already under the stop speed', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    match.phase = 'rolling';
    ball.vx = STOP_SPEED - 1;
    ball.vy = 0;
    const before = ball.x;
    step(match, STEP);
    expect(ball.x).toBe(before);
    expect(ball.vx).toBe(0);
  });

  it('reports through one reused record rather than allocating a step', () => {
    // CLAUDE.md rule 5. A caller that wants a value to outlive the step copies the field
    // out — the same contract the engine's InputState has.
    const match = freeRoll(0, 1, PITCH_LEFT + BALL_RADIUS, CENTRE_Y);
    expect(step(match, STEP)).toBe(step(match, STEP));
  });

  it('does nothing at all while a seat is still aiming', () => {
    const match = createMatch();
    const ball = ballOf(match);
    ball.vx = 500;
    const result = step(match, STEP);
    expect(result.settled).toBe(true);
    expect(result.goal).toBeNull();
    expect(ball.x).toBe(CENTRE_X);
  });

  it('settles every shot inside the bound the constants prove', () => {
    let worst = 0;
    for (let i = 0; i < 240; i += 1) {
      const match = createMatch();
      const ball = ballOf(match);
      ball.x = PITCH_LEFT + 40 + ((i * 137) % (PITCH_RIGHT - PITCH_LEFT - 80));
      ball.y = PITCH_TOP + 40 + ((i * 211) % (PITCH_BOTTOM - PITCH_TOP - 80));
      strike(match, (i / 240) * Math.PI * 2, 1);
      const seconds = settle(match).steps / 60;
      if (seconds > worst) worst = seconds;
    }
    expect(worst, 'the worst shot in 240').toBeLessThanOrEqual(SETTLE_BOUND_SECONDS + STEP);
  });

  it('proves that bound from the constants rather than from the measurement', () => {
    expect(SETTLE_BOUND_SECONDS).toBeCloseTo(
      Math.log(STRIKE_MAX_SPEED / STOP_SPEED) / DRAG_RATE,
      12,
    );
    expect(SETTLE_BOUND_SECONDS).toBeLessThan(3.1);
    expect(Math.pow(ROLL_DRAG, SETTLE_BOUND_SECONDS) * STRIKE_MAX_SPEED).toBeCloseTo(STOP_SPEED, 6);
  });

  it('never adds energy to the pitch, whatever hits what', () => {
    for (let i = 0; i < 40; i += 1) {
      const match = createMatch();
      const ball = ballOf(match);
      ball.x = PITCH_LEFT + 40 + ((i * 173) % (PITCH_RIGHT - PITCH_LEFT - 80));
      ball.y = PITCH_TOP + 40 + ((i * 97) % (PITCH_BOTTOM - PITCH_TOP - 80));
      strike(match, (i / 40) * Math.PI * 2, 1);
      let previous = energy(match);
      for (let n = 0; n < SETTLE_CAP; n += 1) {
        const result = step(match, STEP);
        const now = energy(match);
        expect(now, `step ${String(n)} of shot ${String(i)}`).toBeLessThanOrEqual(
          previous * (1 + 1e-9) + 1e-9,
        );
        previous = now;
        if (result.settled) break;
      }
    }
  });

  it('keeps every disc inside the boards through a hard break', () => {
    for (const angle of [0, 0.7, 1.9, 3.3, 4.6, 5.9]) {
      const match = createMatch();
      strike(match, angle, 1);
      for (let n = 0; n < SETTLE_CAP; n += 1) {
        const result = step(match, STEP);
        for (const disc of match.discs) {
          if (disc.kind === 'ball' && result.goal !== null) continue;
          const radius = radiusOf(disc.kind);
          expect(disc.x).toBeGreaterThanOrEqual(PITCH_LEFT + radius - 1e-9);
          expect(disc.x).toBeLessThanOrEqual(PITCH_RIGHT - radius + 1e-9);
          if (disc.kind !== 'ball') {
            expect(disc.y).toBeGreaterThanOrEqual(PITCH_TOP + radius - 1e-9);
            expect(disc.y).toBeLessThanOrEqual(PITCH_BOTTOM - radius + 1e-9);
          }
        }
        if (result.settled) break;
      }
    }
  });
});

describe('the boards', () => {
  it('sends a ball back off the left board', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = PITCH_LEFT + BALL_RADIUS + 1;
    ball.y = CENTRE_Y;
    strike(match, Math.PI, 0.6);
    step(match, STEP);
    expect(ball.vx).toBeGreaterThan(0);
    expect(ball.x).toBeGreaterThanOrEqual(PITCH_LEFT + BALL_RADIUS);
  });

  it('sends a ball back off the right board', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = PITCH_RIGHT - BALL_RADIUS - 1;
    ball.y = CENTRE_Y;
    strike(match, 0, 0.6);
    step(match, STEP);
    expect(ball.vx).toBeLessThan(0);
    expect(ball.x).toBeLessThanOrEqual(PITCH_RIGHT - BALL_RADIUS);
  });

  it('sends a ball back off an end board outside the mouth', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = PITCH_LEFT + 60;
    ball.y = PITCH_TOP + BALL_RADIUS + 1;
    expect(insideMouth(ball.x), 'the test is aiming outside the mouth').toBe(false);
    strike(match, -Math.PI / 2, 0.6);
    step(match, STEP);
    expect(ball.vy).toBeGreaterThan(0);
  });

  it('keeps only WALL_BOUNCE of the pace it arrived with', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = PITCH_RIGHT - BALL_RADIUS - 1;
    ball.y = CENTRE_Y;
    match.phase = 'rolling';
    ball.vx = 600;
    ball.vy = 0;
    const decayed = 600 * Math.pow(ROLL_DRAG, STEP);
    step(match, STEP);
    expect(Math.abs(ball.vx)).toBeCloseTo(decayed * WALL_BOUNCE, 6);
  });

  it('bounces a defender off an end line even in the mouth, so no disc is ever lost in the net', () => {
    const match = createMatch();
    const keeper = match.discs[1]!;
    expect(insideMouth(keeper.x)).toBe(true);
    match.phase = 'rolling';
    keeper.y = PITCH_BOTTOM - DISC_RADIUS - 1;
    keeper.vy = 900;
    step(match, STEP);
    expect(keeper.vy).toBeLessThan(0);
    expect(keeper.y).toBeLessThanOrEqual(PITCH_BOTTOM - DISC_RADIUS);
  });

  it('lets a ball that stops on a board stay against it', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = PITCH_LEFT + 60;
    ball.y = CENTRE_Y;
    strike(match, Math.PI, 1);
    settle(match);
    expect(ball.x).toBeGreaterThanOrEqual(PITCH_LEFT + BALL_RADIUS);
    expect(ball.x).toBeLessThanOrEqual(PITCH_RIGHT - BALL_RADIUS);
  });
});

describe('the goal mouth', () => {
  it('is symmetric about the centre of the pitch', () => {
    for (const offset of [0, 20, 40, 62, 63, 64, 100]) {
      expect(insideMouth(CENTRE_X + offset)).toBe(insideMouth(CENTRE_X - offset));
    }
  });

  it('takes a ball whose whole width is between the posts', () => {
    expect(insideMouth(CENTRE_X)).toBe(true);
    expect(insideMouth(CENTRE_X + GOAL_HALF_WIDTH - BALL_RADIUS)).toBe(true);
  });

  it('refuses a ball that would clip a post', () => {
    expect(insideMouth(CENTRE_X + GOAL_HALF_WIDTH - BALL_RADIUS + 0.001)).toBe(false);
    expect(insideMouth(CENTRE_X - GOAL_HALF_WIDTH)).toBe(false);
  });

  it('gives seat one the top goal', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = PITCH_TOP + 40;
    strike(match, -Math.PI / 2, 0.6);
    expect(settle(match).goal).toBe('p1');
  });

  it('gives seat two the bottom goal', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = PITCH_BOTTOM - 40;
    strike(match, Math.PI / 2, 0.6);
    expect(settle(match).goal).toBe('p2');
  });

  it('stops the ball dead the moment it crosses the line', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = PITCH_TOP + 40;
    strike(match, -Math.PI / 2, 1);
    settle(match);
    expect(ball.vx).toBe(0);
    expect(ball.vy).toBe(0);
  });

  it('ends the shot on the step it goes in, however fast the ball still is', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = PITCH_TOP + 40;
    strike(match, -Math.PI / 2, 1);
    const result = settle(match);
    expect(result.goal).toBe('p1');
    expect(result.steps, 'at full power the line is a couple of steps away').toBeLessThan(10);
  });

  it('bounces a ball aimed a whisker wide of the post', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = CENTRE_X + GOAL_HALF_WIDTH - BALL_RADIUS + 2;
    ball.y = PITCH_TOP + 40;
    strike(match, -Math.PI / 2, 0.6);
    const result = settle(match);
    expect(result.goal).toBeNull();
    expect(ball.y).toBeGreaterThan(PITCH_TOP);
  });
});

describe('discs meeting', () => {
  it('passes the pace on through a head-on contact', () => {
    const match = createMatch();
    match.discs.length = 2;
    const ball = ballOf(match);
    const target = match.discs[1]!;
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    target.x = CENTRE_X;
    target.y = CENTRE_Y - (BALL_RADIUS + DISC_RADIUS) - 4;
    strike(match, -Math.PI / 2, 0.5);
    for (let i = 0; i < 20; i += 1) step(match, STEP);
    expect(target.vy, 'the disc was pushed on').toBeLessThan(0);
    expect(speedOf(ball), 'and the ball gave up most of its pace').toBeLessThan(
      STRIKE_MAX_SPEED * 0.5,
    );
  });

  it('turns a glancing contact sideways', () => {
    const match = createMatch();
    match.discs.length = 2;
    const ball = ballOf(match);
    const target = match.discs[1]!;
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    target.x = CENTRE_X + 26;
    target.y = CENTRE_Y - (BALL_RADIUS + DISC_RADIUS) - 4;
    strike(match, -Math.PI / 2, 0.5);
    for (let i = 0; i < 20; i += 1) step(match, STEP);
    expect(Math.abs(ball.vx)).toBeGreaterThan(1);
    expect(Math.abs(target.vx)).toBeGreaterThan(1);
  });

  it('pushes an overlapping pair apart', () => {
    const match = createMatch();
    match.discs.length = 2;
    const ball = ballOf(match);
    const target = match.discs[1]!;
    match.phase = 'rolling';
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    target.x = CENTRE_X + 10;
    target.y = CENTRE_Y;
    ball.vx = 1;
    step(match, STEP);
    expect(Math.hypot(target.x - ball.x, target.y - ball.y)).toBeCloseTo(
      BALL_RADIUS + DISC_RADIUS,
      6,
    );
  });

  it('leaves a pair that is already separating alone', () => {
    // Striking a separating pair again pulls it back together and quietly adds energy —
    // Pool's lesson, inherited rather than rediscovered.
    const match = createMatch();
    match.discs.length = 2;
    const ball = ballOf(match);
    const target = match.discs[1]!;
    match.phase = 'rolling';
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    target.x = CENTRE_X + 25;
    target.y = CENTRE_Y;
    ball.vx = -300;
    target.vx = 300;
    const before = energy(match);
    step(match, STEP);
    // Only the grass took anything: no impulse was exchanged, so the energy is exactly the
    // pair decayed by one step. Striking a separating pair again would have added some.
    expect(energy(match)).toBeCloseTo(before * Math.pow(ROLL_DRAG, 2 * STEP), 6);
    expect(ball.vx).toBeLessThan(0);
    expect(target.vx).toBeGreaterThan(0);
    expect(
      Math.hypot(target.x - ball.x, target.y - ball.y),
      'and they were still pushed clear of one another',
    ).toBeGreaterThanOrEqual(BALL_RADIUS + DISC_RADIUS - 1e-9);
  });

  it('never lets a contact add speed to the pair', () => {
    for (let i = 0; i < 24; i += 1) {
      const match = createMatch();
      match.discs.length = 3;
      const ball = ballOf(match);
      ball.x = CENTRE_X;
      ball.y = CENTRE_Y;
      match.discs[1]!.x = CENTRE_X + 30;
      match.discs[1]!.y = CENTRE_Y - 50;
      match.discs[2]!.x = CENTRE_X - 30;
      match.discs[2]!.y = CENTRE_Y - 50;
      strike(match, -Math.PI / 2 + (i / 24) * 0.6 - 0.3, 1);
      let previous = energy(match);
      for (let n = 0; n < SETTLE_CAP; n += 1) {
        const result = step(match, STEP);
        const now = energy(match);
        expect(now).toBeLessThanOrEqual(previous * (1 + 1e-9) + 1e-9);
        previous = now;
        if (result.settled) break;
      }
    }
  });

  it('moves a defender standing still when the ball reaches it', () => {
    const match = createMatch();
    // An outfielder rather than a keeper, so no goal can end the shot before the contact.
    const defender = match.discs[5]!;
    const ball = ballOf(match);
    ball.x = defender.x;
    ball.y = defender.y + 160;
    strike(match, -Math.PI / 2, 0.6);
    settle(match);
    expect(Math.hypot(defender.x - defender.postX, defender.y - defender.postY)).toBeGreaterThan(1);
  });
});

describe('scoring', () => {
  it('credits the seat that attacks that end', () => {
    const match = createMatch();
    match.seat = 'p1';
    const outcome = settleShot(match, 'p1');
    expect(match.p1).toBe(1);
    expect(match.p2).toBe(0);
    expect(outcome.scored).toBe('p1');
  });

  it('credits an own goal to the other seat, with no special case for it', () => {
    const match = createMatch();
    match.seat = 'p1';
    // p1 attacks the top, so the ball through the bottom mouth is p2's goal whoever hit it.
    const outcome = settleShot(match, 'p2');
    expect(match.p2).toBe(1);
    expect(outcome.scored).toBe('p2');
    expect(outcome.next, 'and the conceding seat restarts, which here is the striker').toBe('p1');
  });

  it('hands the restart to whoever conceded', () => {
    const match = createMatch();
    match.seat = 'p1';
    expect(settleShot(match, 'p1').next).toBe('p2');
  });

  it('puts the ball back on the centre spot after a goal', () => {
    const match = createMatch();
    const ball = ballOf(match);
    ball.x = PITCH_LEFT + 30;
    ball.y = PITCH_TOP - 20;
    settleShot(match, 'p1');
    expect(ball.x).toBe(CENTRE_X);
    expect(ball.y).toBe(CENTRE_Y);
    expect(ball.vx).toBe(0);
  });

  it('records the goal for the status line', () => {
    const match = createMatch();
    settleShot(match, 'p2');
    expect(match.lastGoal).toBe('p2');
  });

  it('leaves the ball where it stopped after a miss', () => {
    const match = createMatch();
    const ball = ballOf(match);
    ball.x = PITCH_LEFT + 90;
    ball.y = PITCH_TOP + 130;
    settleShot(match, null);
    expect(ball.x).toBe(PITCH_LEFT + 90);
    expect(ball.y).toBe(PITCH_TOP + 130);
    expect(match.lastGoal).toBeNull();
  });

  it('passes the turn on a miss', () => {
    const match = createMatch();
    match.seat = 'p2';
    expect(settleShot(match, null).next).toBe('p1');
  });

  it('alternates the turn all the way through a match of misses', () => {
    const match = createMatch();
    const seen: SeatId[] = [];
    for (let i = 0; i < MAX_SHOTS; i += 1) {
      if (match.phase === 'over') break;
      seen.push(match.seat);
      strike(match, 0, 0.05);
      settle(match);
      apply(match, settleShot(match, null));
    }
    expect(seen.length).toBe(MAX_SHOTS);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBe(otherOf(seen[i - 1]!));
  });

  it('gives both seats the same number of shots', () => {
    const match = createMatch();
    let p1Shots = 0;
    let p2Shots = 0;
    for (let i = 0; i < MAX_SHOTS; i += 1) {
      if (match.seat === 'p1') p1Shots += 1;
      else p2Shots += 1;
      strike(match, 0, 0.05);
      settle(match);
      apply(match, settleShot(match, null));
      if (match.phase === 'over') break;
    }
    expect(p1Shots).toBe(MAX_SHOTS / 2);
    expect(p2Shots).toBe(MAX_SHOTS / 2);
  });
});

describe('the defence going back to its posts', () => {
  it('sends every disc home after every shot, goal or not', () => {
    const match = createMatch();
    for (const disc of match.discs.slice(1)) {
      disc.x += 70;
      disc.y -= 40;
      disc.vx = 200;
    }
    restorePosts(match);
    for (const disc of match.discs.slice(1)) {
      expect(disc.x).toBe(disc.postX);
      expect(disc.y).toBe(disc.postY);
      expect(disc.vx).toBe(0);
      expect(disc.vy).toBe(0);
    }
  });

  it('leaves the ball alone when nothing is standing on it', () => {
    const match = createMatch();
    const ball = ballOf(match);
    ball.x = PITCH_LEFT + 100;
    ball.y = CENTRE_Y - 50;
    restorePosts(match);
    expect(ball.x).toBe(PITCH_LEFT + 100);
    expect(ball.y).toBe(CENTRE_Y - 50);
  });

  it('nudges the ball clear of a post it was resting on', () => {
    const match = createMatch();
    const ball = ballOf(match);
    const keeper = match.discs[1]!;
    ball.x = keeper.postX + 4;
    ball.y = keeper.postY;
    restorePosts(match);
    expect(Math.hypot(ball.x - keeper.postX, ball.y - keeper.postY)).toBeGreaterThanOrEqual(
      BALL_RADIUS + DISC_RADIUS,
    );
  });

  it('pushes a ball resting exactly on a post up the pitch rather than dividing by zero', () => {
    const match = createMatch();
    const ball = ballOf(match);
    const keeper = match.discs[1]!;
    ball.x = keeper.postX;
    ball.y = keeper.postY;
    restorePosts(match);
    expect(Number.isFinite(ball.x)).toBe(true);
    expect(Number.isFinite(ball.y)).toBe(true);
    expect(ball.y).toBeLessThan(keeper.postY);
  });

  it('never puts the ball outside the boards to make room', () => {
    const match = createMatch();
    const ball = ballOf(match);
    const corner = match.discs[2]!;
    ball.x = corner.postX;
    ball.y = corner.postY;
    restorePosts(match);
    expect(ball.x).toBeGreaterThanOrEqual(PITCH_LEFT + BALL_RADIUS);
    expect(ball.x).toBeLessThanOrEqual(PITCH_RIGHT - BALL_RADIUS);
    expect(ball.y).toBeGreaterThanOrEqual(PITCH_TOP + BALL_RADIUS);
    expect(ball.y).toBeLessThanOrEqual(PITCH_BOTTOM - BALL_RADIUS);
  });

  it('runs on a miss as well as on a goal, which is what keeps the match level', () => {
    const match = createMatch();
    match.discs[1]!.x += 200;
    settleShot(match, null);
    expect(match.discs[1]!.x).toBe(match.discs[1]!.postX);
  });

  it('is what kickOff and centreBall are built from', () => {
    const match = createMatch();
    const ball = ballOf(match);
    ball.x = PITCH_LEFT + 20;
    ball.y = PITCH_TOP + 20;
    match.discs[3]!.x = CENTRE_X;
    centreBall(match);
    expect(ball.x).toBe(CENTRE_X);
    expect(match.discs[3]!.x, 'centreBall moves only the ball').toBe(CENTRE_X);
    kickOff(match);
    expect(match.discs[3]!.x).toBe(match.discs[3]!.postX);
  });
});

describe('the shot clock', () => {
  it('spends a shot on a turn nobody played', () => {
    const match = createMatch();
    fumbleShot(match);
    expect(match.shots).toBe(1);
    expect(match.fumbled).toBe(true);
  });

  it('passes the turn', () => {
    const match = createMatch();
    match.seat = 'p2';
    expect(fumbleShot(match).next).toBe('p1');
  });

  it('scores nothing', () => {
    const match = createMatch();
    const outcome = fumbleShot(match);
    expect(outcome.scored).toBeNull();
    expect(match.p1).toBe(0);
    expect(match.p2).toBe(0);
    expect(match.lastGoal).toBeNull();
  });

  it('still reaches a result when nobody ever plays', () => {
    const match = createMatch();
    let outcome: ShotOutcome | null = null;
    for (let i = 0; i < MAX_SHOTS; i += 1) {
      outcome = fumbleShot(match);
      if (outcome.winner !== null) break;
      match.seat = outcome.next;
    }
    expect(match.shots).toBe(MAX_SHOTS);
    expect(outcome?.winner).toBe('draw');
  });
});

describe('the win condition', () => {
  it('is the shared first-to helper, not a comparison written here', () => {
    expect(WIN_CONDITION).toEqual({ kind: 'first-to', target: GOAL_TARGET });
    for (const [p1, p2, shots] of [
      [0, 0, 0],
      [2, 2, 4],
      [3, 1, 6],
      [1, 3, 6],
      [2, 1, MAX_SHOTS],
      [2, 2, MAX_SHOTS],
    ] as const) {
      const match = createMatch();
      match.p1 = p1;
      match.p2 = p2;
      match.shots = shots;
      expect(winnerOf(match)).toBe(
        resolve(WIN_CONDITION, { p1, p2 }, { timeExpired: shots >= MAX_SHOTS }),
      );
    }
  });

  it('gives nobody the match at nil-nil', () => {
    expect(winnerOf(createMatch())).toBeNull();
  });

  it('gives nobody the match one goal short', () => {
    const match = createMatch();
    match.p1 = GOAL_TARGET - 1;
    match.p2 = GOAL_TARGET - 1;
    expect(winnerOf(match)).toBeNull();
  });

  it('gives it to seat one on exactly the target', () => {
    const match = createMatch();
    match.p1 = GOAL_TARGET;
    match.p2 = GOAL_TARGET - 1;
    expect(winnerOf(match)).toBe('p1');
  });

  it('gives it to seat two on exactly the target', () => {
    const match = createMatch();
    match.p2 = GOAL_TARGET;
    expect(winnerOf(match)).toBe('p2');
  });

  it('is decided on the goal that reaches the target, not the shot after it', () => {
    const match = createMatch();
    match.p1 = GOAL_TARGET - 1;
    expect(winnerOf(match)).toBeNull();
    const outcome = settleShot(match, 'p1');
    expect(outcome.winner).toBe('p1');
  });

  it('does not wait for the shots to run out once somebody is there', () => {
    const match = createMatch();
    match.p1 = GOAL_TARGET;
    match.shots = 2;
    expect(winnerOf(match)).toBe('p1');
    expect(shotsLeft(match)).toBeGreaterThan(0);
  });

  it('gives the match to the higher score when the shots run out', () => {
    const match = createMatch();
    match.p1 = 1;
    match.p2 = 2;
    match.shots = MAX_SHOTS;
    expect(winnerOf(match)).toBe('p2');
  });

  it('calls a level score at full time an honest draw', () => {
    for (const level of [0, 1, 2]) {
      const match = createMatch();
      match.p1 = level;
      match.p2 = level;
      match.shots = MAX_SHOTS;
      expect(winnerOf(match)).toBe('draw');
    }
  });

  it('is still undecided on the last shot before full time', () => {
    const match = createMatch();
    match.p1 = 1;
    match.p2 = 1;
    match.shots = MAX_SHOTS - 1;
    expect(winnerOf(match)).toBeNull();
    expect(shotsLeft(match)).toBe(1);
  });

  it('never counts the shots left below zero', () => {
    const match = createMatch();
    match.shots = MAX_SHOTS + 5;
    expect(shotsLeft(match)).toBe(0);
  });

  it('starts a fresh match over', () => {
    const match = createMatch();
    match.p1 = 2;
    match.p2 = 1;
    match.shots = 9;
    match.seat = 'p2';
    match.phase = 'over';
    match.winner = 'p1';
    match.lastGoal = 'p1';
    match.fumbled = true;
    ballOf(match).x = PITCH_LEFT + 20;
    match.discs[2]!.y = CENTRE_Y;
    resetMatch(match);
    expect(match.p1).toBe(0);
    expect(match.p2).toBe(0);
    expect(match.shots).toBe(0);
    expect(match.seat).toBe('p1');
    expect(match.phase).toBe('aiming');
    expect(match.winner).toBeNull();
    expect(match.lastGoal).toBeNull();
    expect(match.fumbled).toBe(false);
    expect(ballOf(match).x).toBe(CENTRE_X);
    expect(match.discs[2]!.y).toBe(match.discs[2]!.postY);
  });
});

describe('a match always ends', () => {
  it('runs out of shots however badly it is played', () => {
    const match = createMatch();
    let outcome: ShotOutcome | null = null;
    for (let i = 0; i < MAX_SHOTS + 4; i += 1) {
      if (match.phase === 'over') break;
      // The weakest legal shot there is, from wherever the ball ended up.
      strike(match, 0, 0.001);
      settle(match);
      outcome = settleShot(match, null);
      apply(match, outcome);
    }
    expect(match.shots).toBeLessThanOrEqual(MAX_SHOTS);
    expect(outcome?.winner).toBe('draw');
    expect(match.phase).toBe('over');
  });

  it('never spends more shots than the match has', () => {
    const match = createMatch();
    for (let i = 0; i < MAX_SHOTS * 2; i += 1) {
      if (match.phase === 'over') break;
      strike(match, i, 0.4);
      const goal = settle(match).goal;
      apply(match, settleShot(match, goal));
    }
    expect(match.shots).toBeLessThanOrEqual(MAX_SHOTS);
  });

  it('bounds the whole match by the settling bound and the shot count', () => {
    // Both halves of the guarantee in one place: a shot cannot roll longer than the bound,
    // and there cannot be more than MAX_SHOTS of them.
    const worst = MAX_SHOTS * SETTLE_BOUND_SECONDS;
    expect(worst).toBeLessThan(60);
  });
});

describe('the two chairs', () => {
  it('mirrors a whole shot, so neither seat is playing a different game', () => {
    for (const angle of [-Math.PI / 2, -1.2, -1.9, -0.6]) {
      const match = createMatch();
      const mirror = mirrorOf(match);
      strike(match, angle, 0.75);
      strike(mirror, angle + Math.PI, 0.75);
      for (let n = 0; n < SETTLE_CAP; n += 1) {
        const here = step(match, STEP);
        const there = step(mirror, STEP);
        expect(there.settled).toBe(here.settled);
        expect(there.goal).toBe(here.goal === null ? null : otherOf(here.goal));
        for (let i = 1; i <= 3; i += 1) {
          expect(mirror.discs[i + 3]!.x).toBeCloseTo(2 * CENTRE_X - match.discs[i]!.x, 8);
          expect(mirror.discs[i + 3]!.y).toBeCloseTo(2 * CENTRE_Y - match.discs[i]!.y, 8);
        }
        expect(ballOf(mirror).x).toBeCloseTo(2 * CENTRE_X - ballOf(match).x, 8);
        expect(ballOf(mirror).y).toBeCloseTo(2 * CENTRE_Y - ballOf(match).y, 8);
        if (here.settled) break;
      }
    }
  });

  it('mirrors the goal the shot went in', () => {
    const match = emptyPitch();
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = PITCH_TOP + 60;
    strike(match, -Math.PI / 2, 0.7);
    const here = settle(match).goal;

    const mirror = emptyPitch();
    const other = ballOf(mirror);
    other.x = CENTRE_X;
    other.y = PITCH_BOTTOM - 60;
    strike(mirror, Math.PI / 2, 0.7);
    expect(settle(mirror).goal).toBe(otherOf(here!));
  });

  it('mirrors what the bot decides, exactly, at every tier', () => {
    for (const tier of TIERS) {
      for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
        const match = createMatch();
        ballOf(match).x = CENTRE_X - 90;
        ballOf(match).y = CENTRE_Y + 40;
        const mirror = mirrorOf(match);
        const here = botAim(match, tier, roll);
        const there = botAim(mirror, tier, roll);
        expect(
          angleGap(there.angle, here.angle + Math.PI),
          `${tier} at roll ${String(roll)}`,
        ).toBeLessThan(1e-12);
        expect(there.power).toBeCloseTo(here.power, 12);
      }
    }
  });

  it('mirrors the bot from a hundred positions on the grass', () => {
    for (let i = 0; i < 100; i += 1) {
      const match = createMatch();
      const ball = ballOf(match);
      ball.x = PITCH_LEFT + 40 + ((i * 137) % (PITCH_RIGHT - PITCH_LEFT - 80));
      ball.y = PITCH_TOP + 40 + ((i * 211) % (PITCH_BOTTOM - PITCH_TOP - 80));
      restorePosts(match);
      const mirror = mirrorOf(match);
      const here = botAim(match, 'hard', 0.5);
      const there = botAim(mirror, 'hard', 0.5);
      expect(angleGap(there.angle, here.angle + Math.PI), `position ${String(i)}`).toBeLessThan(
        1e-9,
      );
      expect(there.power).toBeCloseTo(here.power, 9);
    }
  });

  it('mirrors the kick-off itself', () => {
    const match = createMatch();
    const mirror = mirrorOf(match);
    expect(mirror.seat).toBe('p2');
    expect(ballOf(mirror).x).toBeCloseTo(CENTRE_X, 12);
    expect(ballOf(mirror).y).toBeCloseTo(CENTRE_Y, 12);
    // Every p1 post is a p2 post seen from the other chair.
    for (let i = 1; i <= 3; i += 1) {
      expect(mirror.discs[i]!.x).toBeCloseTo(2 * CENTRE_X - match.discs[i + 3]!.x, 12);
      expect(mirror.discs[i]!.y).toBeCloseTo(2 * CENTRE_Y - match.discs[i + 3]!.y, 12);
    }
  });
});

describe('what the bot can see', () => {
  it('measures an exact distance to a disc dead ahead', () => {
    const match = createMatch();
    match.discs.length = 2;
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    match.discs[1]!.x = CENTRE_X + 300;
    match.discs[1]!.y = CENTRE_Y;
    expect(clearance(match, 0, 1000)).toBeCloseTo(300 - (BALL_RADIUS + DISC_RADIUS), 9);
  });

  it('ignores a disc behind the ball', () => {
    const match = createMatch();
    match.discs.length = 2;
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    match.discs[1]!.x = CENTRE_X - 300;
    match.discs[1]!.y = CENTRE_Y;
    expect(clearance(match, 0, 1000)).toBe(1000);
  });

  it('ignores a disc the ball would pass wide of', () => {
    const match = createMatch();
    match.discs.length = 2;
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    match.discs[1]!.x = CENTRE_X + 300;
    match.discs[1]!.y = CENTRE_Y + BALL_RADIUS + DISC_RADIUS + 1;
    expect(clearance(match, 0, 1000)).toBe(1000);
  });

  it('never looks further than it was asked to', () => {
    const match = emptyPitch();
    expect(clearance(match, 0, SAFETY_REACH)).toBe(SAFETY_REACH);
  });

  it('never returns a negative distance for a disc already touching', () => {
    const match = createMatch();
    match.discs.length = 2;
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    match.discs[1]!.x = CENTRE_X + 5;
    match.discs[1]!.y = CENTRE_Y;
    expect(clearance(match, 0, 1000)).toBeGreaterThanOrEqual(0);
  });

  it('reads the same pitch a player is looking at and nothing else', () => {
    // The only inputs are disc positions and the mouth, both of which are drawn. Moving a
    // disc must change the answer; nothing else in the match may.
    const match = createMatch();
    const before = clearance(match, -Math.PI / 2, SAFETY_REACH);
    match.p1 = 2;
    match.shots = 11;
    expect(clearance(match, -Math.PI / 2, SAFETY_REACH)).toBe(before);
    match.discs[4]!.x = ballOf(match).x;
    match.discs[4]!.y = ballOf(match).y - 100;
    expect(clearance(match, -Math.PI / 2, SAFETY_REACH)).not.toBe(before);
  });
});

describe('the bot', () => {
  it('never produces a shot the rules would refuse', () => {
    for (const tier of TIERS) {
      for (let i = 0; i < 60; i += 1) {
        const match = createMatch();
        const ball = ballOf(match);
        ball.x = PITCH_LEFT + 30 + ((i * 137) % (PITCH_RIGHT - PITCH_LEFT - 60));
        ball.y = PITCH_TOP + 30 + ((i * 211) % (PITCH_BOTTOM - PITCH_TOP - 60));
        match.seat = i % 2 === 0 ? 'p1' : 'p2';
        const aim = botAim(match, tier, (i % 17) / 17);
        expect(Number.isFinite(aim.angle), `${tier} angle`).toBe(true);
        expect(aim.power).toBeGreaterThanOrEqual(0.3);
        expect(aim.power).toBeLessThanOrEqual(BOT_PROFILES[tier].power);
        expect(strike(match, aim.angle, aim.power)).toBe(true);
      }
    }
  });

  it('is told nothing by the scoreboard', () => {
    // Rule 6: it may read what is drawn on the pitch and nothing else. A bot that played
    // differently at 2-2 than at 0-0 would be reading the state of the match, which is
    // information, not skill.
    const match = createMatch();
    ballOf(match).x = CENTRE_X - 70;
    ballOf(match).y = CENTRE_Y - 120;
    const before = botAim(match, 'hard', 0.4);
    match.p1 = 2;
    match.p2 = 2;
    match.shots = MAX_SHOTS - 1;
    match.lastGoal = 'p2';
    match.fumbled = true;
    const after = botAim(match, 'hard', 0.4);
    expect(after.angle).toBe(before.angle);
    expect(after.power).toBe(before.power);
  });

  it('decides the same way twice from the same pitch and the same roll', () => {
    const match = createMatch();
    const first = botAim(match, 'normal', 0.31);
    const second = botAim(match, 'normal', 0.31);
    expect(second.angle).toBe(first.angle);
    expect(second.power).toBe(first.power);
  });

  it('leaves the pitch exactly as it found it', () => {
    const match = createMatch();
    const before = match.discs.map((disc) => `${String(disc.x)},${String(disc.y)}`).join('|');
    botAim(match, 'hard', 0.7);
    expect(match.discs.map((disc) => `${String(disc.x)},${String(disc.y)}`).join('|')).toBe(before);
  });

  it('shoots through the mouth when nothing is in the way', () => {
    for (const tier of TIERS) {
      for (const offset of [-140, -60, 0, 60, 140]) {
        const match = emptyPitch();
        match.seat = 'p1';
        const ball = ballOf(match);
        ball.x = CENTRE_X + offset;
        ball.y = PITCH_TOP + 260;
        const aim = botAim(match, tier, 0.5);
        expect(insideMouth(crossingX(ball.x, ball.y, aim.angle, PITCH_TOP)), `${tier}`).toBe(true);
      }
    }
  });

  it('threads the ball past a keeper standing in the middle of the mouth', () => {
    const match = createMatch();
    match.discs.length = 2;
    // Only the keeper left, on its own line in the middle of the mouth.
    match.discs[1]!.x = CENTRE_X;
    match.discs[1]!.y = PITCH_TOP + 26;
    const ball = ballOf(match);
    match.seat = 'p1';
    ball.x = CENTRE_X - 40;
    ball.y = PITCH_TOP + 300;
    const aim = botAim(match, 'hard', 0.5);
    const at = crossingX(ball.x, ball.y, aim.angle, PITCH_TOP);
    expect(insideMouth(at), 'still on target').toBe(true);
    expect(
      clearance(match, aim.angle, Math.hypot(at - ball.x, PITCH_TOP - ball.y)),
      'and it does not run into the keeper on the way',
    ).toBeGreaterThanOrEqual(Math.hypot(at - ball.x, PITCH_TOP - ball.y));
  });

  it('shoots at the far goal for whichever seat is to play', () => {
    for (const seat of ['p1', 'p2'] as const) {
      const match = emptyPitch();
      match.seat = seat;
      const ball = ballOf(match);
      ball.x = CENTRE_X - 40;
      ball.y = CENTRE_Y;
      const aim = botAim(match, 'hard', 0.5);
      const line = attackingGoalY(seat);
      expect(insideMouth(crossingX(ball.x, ball.y, aim.angle, line)), seat).toBe(true);
    }
  });

  it('aims the other way for the other seat, from the same spot', () => {
    const one = createMatch();
    one.seat = 'p1';
    ballOf(one).x = CENTRE_X - 60;
    const two = createMatch();
    two.seat = 'p2';
    ballOf(two).x = CENTRE_X - 60;
    expect(Math.sin(botAim(one, 'hard', 0.5).angle)).toBeLessThan(0);
    expect(Math.sin(botAim(two, 'hard', 0.5).angle)).toBeGreaterThan(0);
  });

  it('plays a safety rather than a blocked shot when the goal is walled off', () => {
    const match = createMatch();
    match.seat = 'p1';
    const ball = ballOf(match);
    ball.x = CENTRE_X;
    ball.y = CENTRE_Y;
    // Three defenders in a row across the mouth: nothing on goal at all.
    match.discs[4]!.x = CENTRE_X;
    match.discs[4]!.y = PITCH_TOP + 40;
    match.discs[5]!.x = CENTRE_X - 46;
    match.discs[5]!.y = PITCH_TOP + 40;
    match.discs[6]!.x = CENTRE_X + 46;
    match.discs[6]!.y = PITCH_TOP + 40;
    const blocked = botAim(match, 'hard', 0.5);
    const straight = Math.atan2(PITCH_TOP - ball.y, 0);
    expect(angleGap(blocked.angle, straight)).toBeGreaterThan(0.01);
  });

  it('holds one error for the whole shot rather than drawing a fresh one', () => {
    // A per-step error averages to zero and every tier plays the same. The roll is the only
    // way the aim can move, so two different rolls must give two different lines.
    const match = createMatch();
    const low = botAim(match, 'easy', 0.05);
    const high = botAim(match, 'easy', 0.95);
    expect(angleGap(low.angle, high.angle)).toBeGreaterThan(0.1);
  });

  it('keeps the error inside the spread the tier declares', () => {
    for (const tier of TIERS) {
      const match = createMatch();
      const middle = botAim(match, tier, 0.5).angle;
      for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
        const aim = botAim(match, tier, roll);
        expect(angleGap(aim.angle, middle), `${tier} at ${String(roll)}`).toBeLessThanOrEqual(
          BOT_PROFILES[tier].spread + 1e-9,
        );
      }
    }
  });

  it('draws the error evenly either side of the line it chose', () => {
    const match = createMatch();
    const middle = botAim(match, 'normal', 0.5).angle;
    const low = botAim(match, 'normal', 0).angle;
    const high = botAim(match, 'normal', 1).angle;
    expect(middle - low).toBeCloseTo(high - middle, 9);
  });

  it('has a ladder of tiers that differ in every lever it has', () => {
    for (let i = 1; i < TIERS.length; i += 1) {
      const weaker = BOT_PROFILES[TIERS[i - 1]!];
      const stronger = BOT_PROFILES[TIERS[i]!];
      expect(stronger.spread, 'a steadier hand').toBeLessThan(weaker.spread);
      expect(stronger.aimPoints, 'more lines considered').toBeGreaterThan(weaker.aimPoints);
      expect(stronger.thinkSeconds, 'and quicker to play').toBeLessThan(weaker.thinkSeconds);
      expect(stronger.power, 'and it dares to hit it harder').toBeGreaterThan(weaker.power);
    }
  });

  it('never hits harder than the tier dares', () => {
    for (const tier of TIERS) {
      for (let i = 0; i < 40; i += 1) {
        const match = createMatch();
        ballOf(match).x = PITCH_LEFT + 30 + ((i * 149) % (PITCH_RIGHT - PITCH_LEFT - 60));
        ballOf(match).y = PITCH_TOP + 30 + ((i * 89) % (PITCH_BOTTOM - PITCH_TOP - 60));
        expect(botAim(match, tier, 0.5).power).toBeLessThanOrEqual(BOT_PROFILES[tier].power);
      }
    }
  });
});

describe('weight', () => {
  it('is a straight line from power to distance', () => {
    // The same extra squeeze on the shot buys the same extra distance wherever on the dial
    // it is applied, which is what makes a shot repeatable by a player who liked the last
    // one. Under a constant-deceleration model it would buy four times as much at the top
    // of the dial as at the bottom.
    const step = 0.2;
    const first = reachOf(0.2 + step) - reachOf(0.2);
    for (const from of [0.4, 0.6, 0.8]) {
      expect(reachOf(from + step) - reachOf(from), `from ${String(from)}`).toBeCloseTo(first, 6);
    }
    expect(first).toBeCloseTo((STRIKE_MAX_SPEED * step) / DRAG_RATE, 6);
  });

  it('inverts exactly', () => {
    for (const distance of [50, 120, 300, 600, 900]) {
      expect(reachOf(powerFor(distance))).toBeCloseTo(distance, 6);
    }
    for (const power of [0.1, 0.35, 0.6, 0.9, 1]) {
      expect(powerFor(reachOf(power))).toBeCloseTo(power, 9);
    }
  });

  it('never claims a reach for a shot too soft to move the ball', () => {
    expect(reachOf(0)).toBe(0);
    expect(reachOf(STOP_SPEED / STRIKE_MAX_SPEED / 2)).toBe(0);
  });

  it('needs most of the power available to cross the pitch', () => {
    // The tier ladder rests on this: the weakest bot cannot shoot the length of the pitch
    // and has to work the ball upfield instead, which is what a weak player does.
    const acrossThePitch = powerFor(PITCH_HEIGHT);
    expect(acrossThePitch).toBeGreaterThan(BOT_PROFILES.easy.power);
    expect(acrossThePitch).toBeLessThan(BOT_PROFILES.hard.power);
  });
});
