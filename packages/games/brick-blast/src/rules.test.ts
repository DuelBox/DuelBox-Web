import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { Aabb, SeatId } from '@duelbox/engine';
import type { Ball, BotDifficulty } from './rules.js';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  BRICK_COLUMNS,
  BRICK_COUNT,
  BRICK_HEIGHT,
  BRICK_INNER_HP,
  BRICK_ROWS,
  COURT,
  MAX_BALL_SPEED,
  MAX_DEFLECTION,
  MIN_VERTICAL_FRACTION,
  PADDLE_GAIN,
  PADDLE_HALF_HEIGHT,
  PADDLE_HALF_WIDTH,
  PADDLE_INSET,
  PADDLE_SPEED,
  REGROW_HP,
  REGROW_STEPS,
  SERVE_SPEED,
  STEP_SECONDS,
  accelerate,
  ballOut,
  botTargetX,
  brickBounds,
  brickCentreX,
  brickCentreY,
  brickColumn,
  brickHp,
  brickIndex,
  brickRegrow,
  brickRow,
  clamp,
  collideBallBricks,
  collideBallPaddle,
  createBall,
  createPaddle,
  createWall,
  damageBrick,
  enforceVertical,
  foldIntoBand,
  initialHp,
  launchServe,
  movePaddle,
  paddleY,
  placeServe,
  resetWall,
  serveSpotX,
  serveSpotY,
  standingBricks,
  stepBall,
  stepWall,
} from './rules.js';

const STEP = STEP_SECONDS;

function ball(x: number, y: number, vx: number, vy: number): Ball {
  return { x, y, vx, vy };
}

function speed(body: Ball): number {
  return Math.hypot(body.vx, body.vy);
}

function bounds(index: number): Aabb {
  return brickBounds(index, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
}

/** A pair of balls served, so tests can start from a live rally rather than from rest. */
function servedPair(angle = 0): [Ball, Ball] {
  const pair: [Ball, Ball] = [createBall(), createBall()];
  placeServe(pair);
  launchServe(pair, angle);
  return pair;
}

describe('the court', () => {
  it('is portrait, so two people can share a phone held upright', () => {
    expect(COURT.height).toBeGreaterThan(COURT.width);
  });

  it('puts each paddle the same distance off its own baseline', () => {
    expect(paddleY('p2')).toBe(PADDLE_INSET);
    expect(COURT.height - paddleY('p1')).toBe(PADDLE_INSET);
  });

  it('is its own picture upside down: every brick has a partner through the centre', () => {
    for (let i = 0; i < BRICK_COUNT; i += 1) {
      const partner = brickIndex(BRICK_COLUMNS - 1 - brickColumn(i), BRICK_ROWS - 1 - brickRow(i));
      expect(brickCentreX(brickColumn(i)) + brickCentreX(brickColumn(partner))).toBeCloseTo(
        COURT.width,
        9,
      );
      expect(brickCentreY(brickRow(i)) + brickCentreY(brickRow(partner))).toBeCloseTo(
        COURT.height,
        9,
      );
    }
  });

  it('gives the two seats the same wall to shoot at', () => {
    // Rule 9 in miniature: neither seat may face the tougher face of the wall.
    for (let row = 0; row < BRICK_ROWS; row += 1) {
      expect(initialHp(row)).toBe(initialHp(BRICK_ROWS - 1 - row));
    }
  });

  it('doubles the rows either side of the halfway line and no others', () => {
    const doubled = [];
    for (let row = 0; row < BRICK_ROWS; row += 1) {
      if (initialHp(row) === BRICK_INNER_HP) doubled.push(row);
    }
    expect(doubled).toEqual([1, 2]);
  });

  it('keeps every brick inside the court with a clear margin either side', () => {
    for (let i = 0; i < BRICK_COUNT; i += 1) {
      const box = bounds(i);
      expect(box.minX).toBeGreaterThan(BALL_RADIUS);
      expect(box.maxX).toBeLessThan(COURT.width - BALL_RADIUS);
      expect(box.maxY - box.minY).toBeCloseTo(BRICK_HEIGHT, 9);
    }
  });

  it('leaves both paddles clear of the wall', () => {
    let lowest = 0;
    let highest = COURT.height;
    for (let i = 0; i < BRICK_COUNT; i += 1) {
      const box = bounds(i);
      lowest = Math.max(lowest, box.maxY);
      highest = Math.min(highest, box.minY);
    }
    expect(lowest).toBeLessThan(paddleY('p1') - PADDLE_HALF_HEIGHT - BALL_RADIUS * 4);
    expect(highest).toBeGreaterThan(paddleY('p2') + PADDLE_HALF_HEIGHT + BALL_RADIUS * 4);
  });

  it('never lets a bricked column overlap its neighbour', () => {
    for (let row = 0; row < BRICK_ROWS; row += 1) {
      for (let column = 1; column < BRICK_COLUMNS; column += 1) {
        const left = bounds(brickIndex(column - 1, row));
        const right = bounds(brickIndex(column, row));
        expect(right.minX).toBeGreaterThan(left.maxX);
      }
    }
  });
});

describe('the wall', () => {
  it('stands every brick when it is built', () => {
    const wall = createWall();
    expect(standingBricks(wall)).toBe(BRICK_COUNT);
    for (let i = 0; i < BRICK_COUNT; i += 1) {
      expect(brickHp(wall, i)).toBe(initialHp(brickRow(i)));
      expect(brickRegrow(wall, i)).toBe(0);
    }
  });

  it('takes one hit point off a doubled brick and leaves it standing', () => {
    const wall = createWall();
    const index = brickIndex(3, 1);
    expect(brickHp(wall, index)).toBe(BRICK_INNER_HP);
    damageBrick(wall, index);
    expect(brickHp(wall, index)).toBe(BRICK_INNER_HP - 1);
    expect(brickRegrow(wall, index)).toBe(0);
  });

  it('turns a brick to rubble on its last hit point and starts its timer', () => {
    const wall = createWall();
    const index = brickIndex(0, 0);
    damageBrick(wall, index);
    expect(brickHp(wall, index)).toBe(0);
    expect(brickRegrow(wall, index)).toBe(REGROW_STEPS);
    expect(standingBricks(wall)).toBe(BRICK_COUNT - 1);
  });

  it('counts rubble down one step at a time and stands it back up', () => {
    const wall = createWall();
    const index = brickIndex(2, 0);
    damageBrick(wall, index);
    for (let i = 0; i < REGROW_STEPS - 1; i += 1) {
      stepWall(wall);
      expect(brickHp(wall, index)).toBe(0);
    }
    expect(brickRegrow(wall, index)).toBe(1);
    stepWall(wall);
    expect(brickHp(wall, index)).toBe(REGROW_HP);
    expect(brickRegrow(wall, index)).toBe(0);
  });

  it('brings a doubled brick back thin, so a hole you punched stays easier', () => {
    const wall = createWall();
    const index = brickIndex(4, 1);
    damageBrick(wall, index);
    damageBrick(wall, index);
    for (let i = 0; i < REGROW_STEPS; i += 1) stepWall(wall);
    expect(brickHp(wall, index)).toBe(REGROW_HP);
    expect(REGROW_HP).toBeLessThan(BRICK_INNER_HP);
  });

  it('leaves standing bricks alone', () => {
    const wall = createWall();
    for (let i = 0; i < REGROW_STEPS * 2; i += 1) stepWall(wall);
    expect(standingBricks(wall)).toBe(BRICK_COUNT);
  });

  it('stands the whole wall back up on a reset', () => {
    const wall = createWall();
    for (let i = 0; i < BRICK_COUNT; i += 1) {
      damageBrick(wall, i);
      damageBrick(wall, i);
    }
    expect(standingBricks(wall)).toBe(0);
    resetWall(wall);
    expect(standingBricks(wall)).toBe(BRICK_COUNT);
    for (let i = 0; i < BRICK_COUNT; i += 1) expect(brickRegrow(wall, i)).toBe(0);
  });

  it('answers 0 for a brick that does not exist rather than undefined', () => {
    const wall = createWall();
    expect(brickHp(wall, BRICK_COUNT + 5)).toBe(0);
    expect(brickRegrow(wall, -1)).toBe(0);
  });
});

describe('a ball in flight', () => {
  it('carries no drag: a step changes where it is, never how fast', () => {
    const moving = ball(300, 500, 210, -330);
    const before = speed(moving);
    stepBall(moving, STEP);
    expect(speed(moving)).toBeCloseTo(before, 9);
  });

  it('is frame-rate independent: two half steps equal one whole step', () => {
    const fine = ball(300, 500, 400, -260);
    stepBall(fine, STEP);
    stepBall(fine, STEP);

    const coarse = ball(300, 500, 400, -260);
    stepBall(coarse, STEP * 2);

    expect(fine.x).toBeCloseTo(coarse.x, 9);
    expect(fine.y).toBeCloseTo(coarse.y, 9);
    expect(fine.vx).toBeCloseTo(coarse.vx, 9);
    expect(fine.vy).toBeCloseTo(coarse.vy, 9);
  });

  it('agrees across a whole second however it is chopped up', () => {
    const fine = ball(320, 500, 90, 120);
    for (let i = 0; i < 240; i += 1) stepBall(fine, 1 / 240);
    const coarse = ball(320, 500, 90, 120);
    for (let i = 0; i < 60; i += 1) stepBall(coarse, 1 / 60);

    expect(fine.x).toBeCloseTo(coarse.x, 8);
    expect(fine.y).toBeCloseTo(coarse.y, 8);
  });

  it('bounces off the left rail without losing speed', () => {
    const moving = ball(BALL_RADIUS + 1, 500, -600, 40);
    stepBall(moving, STEP);
    expect(moving.x).toBeCloseTo(BALL_RADIUS, 9);
    expect(moving.vx).toBe(600);
    expect(moving.vy).toBe(40);
  });

  it('bounces off the right rail', () => {
    const moving = ball(COURT.width - BALL_RADIUS - 1, 500, 600, -40);
    stepBall(moving, STEP);
    expect(moving.x).toBeCloseTo(COURT.width - BALL_RADIUS, 9);
    expect(moving.vx).toBe(-600);
  });

  it('never leaves the court sideways, however hard it is hit', () => {
    const moving = ball(320, 500, 4000, 200);
    for (let i = 0; i < 600; i += 1) {
      stepBall(moving, STEP);
      expect(moving.x).toBeGreaterThanOrEqual(BALL_RADIUS);
      expect(moving.x).toBeLessThanOrEqual(COURT.width - BALL_RADIUS);
    }
  });

  it('holds the speed ceiling, so nothing can pass through a paddle between two steps', () => {
    const moving = ball(320, 500, 3000, 3000);
    stepBall(moving, STEP);
    expect(speed(moving)).toBeCloseTo(MAX_BALL_SPEED, 6);
    expect(MAX_BALL_SPEED * STEP).toBeLessThan(BALL_RADIUS + PADDLE_HALF_HEIGHT);
  });

  it('leaves a ball at rest at rest', () => {
    const still = ball(200, 400, 0, 0);
    stepBall(still, STEP);
    expect(still).toEqual({ x: 200, y: 400, vx: 0, vy: 0 });
  });
});

describe('a ball leaving the court', () => {
  it('belongs to nobody while it is still inside', () => {
    expect(ballOut(ball(320, 500, 0, 0))).toBe('none');
    expect(ballOut(ball(320, COURT.height, 0, 0))).toBe('none');
    expect(ballOut(ball(320, 0, 0, 0))).toBe('none');
  });

  it('gives p2 the point when it passes p1 baseline', () => {
    expect(ballOut(ball(320, COURT.height + BALL_RADIUS + 0.5, 0, 400))).toBe('p2');
  });

  it('gives p1 the point when it passes p2 baseline', () => {
    expect(ballOut(ball(320, -BALL_RADIUS - 0.5, 0, -400))).toBe('p1');
  });

  it('waits for the whole ball to clear, so a ball on the line is still live', () => {
    expect(ballOut(ball(320, COURT.height + BALL_RADIUS, 0, 400))).toBe('none');
    expect(ballOut(ball(320, -BALL_RADIUS, 0, -400))).toBe('none');
  });
});

describe('a paddle', () => {
  it('sends an arriving ball back up the court, faster than it came', () => {
    const arriving = ball(320, paddleY('p1') - PADDLE_HALF_HEIGHT - BALL_RADIUS + 2, 0, 500);
    expect(collideBallPaddle(arriving, 320, 'p1')).toBe(true);
    expect(arriving.vy).toBeLessThan(0);
    expect(speed(arriving)).toBeCloseTo(500 * PADDLE_GAIN, 6);
  });

  it('does the same for the far seat, mirrored', () => {
    const arriving = ball(320, paddleY('p2') + PADDLE_HALF_HEIGHT + BALL_RADIUS - 2, 0, -500);
    expect(collideBallPaddle(arriving, 320, 'p2')).toBe(true);
    expect(arriving.vy).toBeGreaterThan(0);
    expect(speed(arriving)).toBeCloseTo(500 * PADDLE_GAIN, 6);
  });

  it('sends a ball struck dead centre straight back', () => {
    const arriving = ball(320, paddleY('p1') - PADDLE_HALF_HEIGHT - BALL_RADIUS + 2, 0, 500);
    collideBallPaddle(arriving, 320, 'p1');
    expect(arriving.vx).toBeCloseTo(0, 9);
  });

  it('steers a ball the way it was struck', () => {
    const left = ball(320 - PADDLE_HALF_WIDTH + 6, paddleY('p1') - PADDLE_HALF_HEIGHT - 6, 0, 500);
    collideBallPaddle(left, 320, 'p1');
    expect(left.vx).toBeLessThan(0);

    const right = ball(320 + PADDLE_HALF_WIDTH - 6, paddleY('p1') - PADDLE_HALF_HEIGHT - 6, 0, 500);
    collideBallPaddle(right, 320, 'p1');
    expect(right.vx).toBeGreaterThan(0);
  });

  it('never angles a ball further than the deflection ceiling', () => {
    for (let offset = -PADDLE_HALF_WIDTH; offset <= PADDLE_HALF_WIDTH; offset += 4) {
      const struck = ball(320 + offset, paddleY('p1') - PADDLE_HALF_HEIGHT - 6, 0, 600);
      collideBallPaddle(struck, 320, 'p1');
      const angle = Math.atan2(struck.vx, -struck.vy);
      expect(Math.abs(angle)).toBeLessThanOrEqual(MAX_DEFLECTION + 1e-9);
      expect(struck.vy).toBeLessThan(0);
    }
  });

  it('keeps a return well clear of sideways, so no rally can stall', () => {
    for (let offset = -PADDLE_HALF_WIDTH; offset <= PADDLE_HALF_WIDTH; offset += 4) {
      const struck = ball(320 + offset, paddleY('p1') - PADDLE_HALF_HEIGHT - 6, 0, 600);
      collideBallPaddle(struck, 320, 'p1');
      expect(Math.abs(struck.vy)).toBeGreaterThan(speed(struck) * MIN_VERTICAL_FRACTION);
    }
  });

  it('respects the speed ceiling however long the rally runs', () => {
    const struck = ball(320, paddleY('p1') - PADDLE_HALF_HEIGHT - 6, 0, MAX_BALL_SPEED);
    collideBallPaddle(struck, 320, 'p1');
    expect(speed(struck)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);
  });

  it('gives a barely-moving ball a real return rather than a limp one', () => {
    const dribble = ball(320, paddleY('p1') - PADDLE_HALF_HEIGHT - 6, 0, 1);
    collideBallPaddle(dribble, 320, 'p1');
    expect(speed(dribble)).toBeGreaterThanOrEqual(SERVE_SPEED);
  });

  it('does not return a ball that is already travelling away', () => {
    const leaving = ball(320, paddleY('p1') - PADDLE_HALF_HEIGHT - 4, 0, -300);
    expect(collideBallPaddle(leaving, 320, 'p1')).toBe(false);
    expect(leaving.vy).toBe(-300);
  });

  it('still pushes a ball clear of a paddle chasing it', () => {
    const trapped = ball(320, paddleY('p1'), 0, -300);
    collideBallPaddle(trapped, 320, 'p1');
    expect(trapped.y).toBeLessThanOrEqual(paddleY('p1') - PADDLE_HALF_HEIGHT - BALL_RADIUS + 1e-9);
  });

  it('ignores a ball nowhere near it', () => {
    const past = ball(60, paddleY('p1') - 4, 0, 500);
    expect(collideBallPaddle(past, 500, 'p1')).toBe(false);
    expect(past).toEqual({ x: 60, y: paddleY('p1') - 4, vx: 0, vy: 500 });
  });

  it('never leaves a ball inside itself', () => {
    const struck = ball(330, paddleY('p1') - 2, 40, 500);
    collideBallPaddle(struck, 320, 'p1');
    const gap = Math.abs(struck.y - paddleY('p1'));
    expect(gap).toBeGreaterThanOrEqual(PADDLE_HALF_HEIGHT - 1e-9);
  });

  it('treats the two seats identically: a mirrored strike gives a mirrored answer', () => {
    const near = ball(320 + 25, paddleY('p1') - PADDLE_HALF_HEIGHT - 6, 70, 500);
    const far = ball(320 - 25, paddleY('p2') + PADDLE_HALF_HEIGHT + 6, -70, -500);
    expect(collideBallPaddle(near, 320 + 10, 'p1')).toBe(true);
    expect(collideBallPaddle(far, 320 - 10, 'p2')).toBe(true);

    expect(near.x + far.x).toBeCloseTo(COURT.width, 9);
    expect(near.y + far.y).toBeCloseTo(COURT.height, 9);
    expect(near.vx + far.vx).toBeCloseTo(0, 9);
    expect(near.vy + far.vy).toBeCloseTo(0, 9);
  });
});

describe('a brick', () => {
  function ballOnBrick(index: number, vx: number, vy: number, dy: number): Ball {
    const box = bounds(index);
    const centreX = (box.minX + box.maxX) / 2;
    return ball(centreX, box.minY + dy, vx, vy);
  }

  it('breaks and bounces the ball back the way it came', () => {
    const wall = createWall();
    const index = brickIndex(1, 0);
    const moving = ballOnBrick(index, 0, 400, -BALL_RADIUS + 4);
    expect(collideBallBricks(moving, wall)).toBe(index);
    expect(moving.vy).toBeLessThan(0);
    expect(brickHp(wall, index)).toBe(0);
  });

  it('bounces the ball off its underside too', () => {
    const wall = createWall();
    const index = brickIndex(1, BRICK_ROWS - 1);
    const box = bounds(index);
    const moving = ball((box.minX + box.maxX) / 2, box.maxY + BALL_RADIUS - 4, 0, -400);
    expect(collideBallBricks(moving, wall)).toBe(index);
    expect(moving.vy).toBeGreaterThan(0);
  });

  it('survives the first hit when it is one of the doubled rows', () => {
    // Through the hole in the outer row first: the rows sit closer together than a ball is
    // wide, so a ball can only reach the second row once the first has gone.
    const wall = createWall();
    damageBrick(wall, brickIndex(3, 0));
    const index = brickIndex(3, 1);
    const moving = ballOnBrick(index, 0, 400, -BALL_RADIUS + 4);
    expect(collideBallBricks(moving, wall)).toBe(index);
    expect(brickHp(wall, index)).toBe(BRICK_INNER_HP - 1);
    expect(moving.vy).toBeLessThan(0);
  });

  it('is packed tightly enough that no ball can slip between two rows', () => {
    const wall = createWall();
    const upper = bounds(brickIndex(2, 0));
    const lower = bounds(brickIndex(2, 1));
    expect(lower.minY - upper.maxY).toBeLessThan(BALL_RADIUS * 2);
    const between = ball((upper.minX + upper.maxX) / 2, (upper.maxY + lower.minY) / 2, 400, 0);
    expect(collideBallBricks(between, wall)).toBeGreaterThanOrEqual(0);
  });

  it('speeds the ball up a little, under the ceiling', () => {
    const wall = createWall();
    const index = brickIndex(5, 0);
    const moving = ballOnBrick(index, 0, MAX_BALL_SPEED, -BALL_RADIUS + 4);
    collideBallBricks(moving, wall);
    expect(speed(moving)).toBeLessThanOrEqual(MAX_BALL_SPEED + 1e-9);

    const gentle = ballOnBrick(brickIndex(6, 0), 0, 300, -BALL_RADIUS + 4);
    collideBallBricks(gentle, createWall());
    expect(speed(gentle)).toBeGreaterThan(300);
  });

  it('breaks at most one brick a step, even in the seam between two', () => {
    const wall = createWall();
    const left = bounds(brickIndex(2, 0));
    const right = bounds(brickIndex(3, 0));
    const moving = ball((left.maxX + right.minX) / 2, left.minY - BALL_RADIUS + 5, 0, 400);
    const hit = collideBallBricks(moving, wall);
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(standingBricks(wall)).toBe(BRICK_COUNT - 1);
  });

  it('reports nothing when the ball is clear of the wall', () => {
    const wall = createWall();
    const moving = ball(320, COURT.height - 100, 0, 400);
    expect(collideBallBricks(moving, wall)).toBe(-1);
    expect(standingBricks(wall)).toBe(BRICK_COUNT);
  });

  it('passes straight through the hole where a brick used to be', () => {
    const wall = createWall();
    const index = brickIndex(4, 0);
    damageBrick(wall, index);
    damageBrick(wall, index);
    const moving = ballOnBrick(index, 0, 400, -BALL_RADIUS + 4);
    expect(collideBallBricks(moving, wall)).toBe(-1);
    expect(moving.vy).toBe(400);
  });

  it('never leaves the ball inside a standing brick', () => {
    const wall = createWall();
    const index = brickIndex(2, 1);
    const box = bounds(index);
    const moving = ball((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0, 400);
    collideBallBricks(moving, wall);
    const inside =
      moving.x > box.minX - BALL_RADIUS &&
      moving.x < box.maxX + BALL_RADIUS &&
      moving.y > box.minY - BALL_RADIUS &&
      moving.y < box.maxY + BALL_RADIUS;
    // Either it was pushed clear of the brick, or the brick it was inside is now rubble.
    expect(!inside || brickHp(wall, index) === 0).toBe(true);
  });
});

describe('the vertical floor', () => {
  it('turns a ball skimming sideways back towards a baseline', () => {
    const skimming = ball(320, 500, 400, 0);
    enforceVertical(skimming);
    expect(Math.abs(skimming.vy)).toBeCloseTo(400 * MIN_VERTICAL_FRACTION, 6);
    expect(speed(skimming)).toBeCloseTo(400, 6);
  });

  it('keeps whichever way the ball was already drifting', () => {
    const up = ball(320, 500, 400, -1);
    enforceVertical(up);
    expect(up.vy).toBeLessThan(0);

    const down = ball(320, 500, 400, 1);
    enforceVertical(down);
    expect(down.vy).toBeGreaterThan(0);
  });

  it('sends a dead-level ball to the baseline it is already nearer', () => {
    const low = ball(320, COURT.height - 100, 400, 0);
    enforceVertical(low);
    expect(low.vy).toBeGreaterThan(0);

    const high = ball(320, 100, 400, 0);
    enforceVertical(high);
    expect(high.vy).toBeLessThan(0);
  });

  it('leaves a normally angled ball exactly alone', () => {
    const angled = ball(320, 500, 300, -300);
    enforceVertical(angled);
    expect(angled.vx).toBe(300);
    expect(angled.vy).toBe(-300);
  });

  it('has nothing to say about a ball that is not moving', () => {
    const still = ball(320, 500, 0, 0);
    enforceVertical(still);
    expect(still.vx).toBe(0);
    expect(still.vy).toBe(0);
  });

  it('keeps the sideways direction it was given', () => {
    const leftward = ball(320, 500, -400, 0);
    enforceVertical(leftward);
    expect(leftward.vx).toBeLessThan(0);
  });
});

describe('the serve', () => {
  it('parks both balls on mirrored spots, at rest', () => {
    const pair: [Ball, Ball] = [createBall(), createBall()];
    placeServe(pair);
    expect(pair[0].x + pair[1].x).toBeCloseTo(COURT.width, 9);
    expect(pair[0].y + pair[1].y).toBeCloseTo(COURT.height, 9);
    expect(speed(pair[0])).toBe(0);
    expect(speed(pair[1])).toBe(0);
  });

  it('gives each seat a ball of its own, one at each end', () => {
    expect(serveSpotY(0)).toBeGreaterThan(COURT.height / 2);
    expect(serveSpotY(1)).toBeLessThan(COURT.height / 2);
    expect(serveSpotX(0) + serveSpotX(1)).toBeCloseTo(COURT.width, 9);
  });

  it('launches the pair as exact opposites, whatever the angle', () => {
    for (const angle of [-0.22, -0.05, 0, 0.11, 0.22]) {
      const pair = servedPair(angle);
      expect(pair[0].vx + pair[1].vx).toBe(0);
      expect(pair[0].vy + pair[1].vy).toBe(0);
      expect(speed(pair[0])).toBeCloseTo(SERVE_SPEED, 9);
      expect(speed(pair[1])).toBeCloseTo(SERVE_SPEED, 9);
    }
  });

  it('sends each ball at the seat it was parked in front of', () => {
    const pair = servedPair(0.1);
    expect(pair[0].vy).toBeGreaterThan(0);
    expect(pair[1].vy).toBeLessThan(0);
  });

  it('parks the balls clear of the wall', () => {
    const pair = servedPair();
    for (let i = 0; i < BRICK_COUNT; i += 1) {
      const box = bounds(i);
      for (const spot of pair) {
        const overlap =
          spot.x > box.minX - BALL_RADIUS &&
          spot.x < box.maxX + BALL_RADIUS &&
          spot.y > box.minY - BALL_RADIUS &&
          spot.y < box.maxY + BALL_RADIUS;
        expect(overlap).toBe(false);
      }
    }
  });

  it('parks them clear of both paddles as well', () => {
    const pair = servedPair();
    for (const seat of ['p1', 'p2'] as const) {
      for (const spot of pair) {
        expect(Math.abs(spot.y - paddleY(seat))).toBeGreaterThan(PADDLE_HALF_HEIGHT + BALL_RADIUS);
      }
    }
  });
});

describe('moving a paddle', () => {
  it('travels towards the target at the ceiling and no faster', () => {
    const paddle = createPaddle();
    const from = paddle.x;
    movePaddle(paddle, COURT.width, PADDLE_SPEED, STEP);
    expect(paddle.x - from).toBeCloseTo(PADDLE_SPEED * STEP, 9);
  });

  it('settles on a target it can reach without overshooting', () => {
    const paddle = createPaddle();
    movePaddle(paddle, paddle.x + 1, PADDLE_SPEED, STEP);
    expect(paddle.x).toBeCloseTo(COURT.width / 2 + 1, 9);
  });

  it('is the same in both directions', () => {
    const left = createPaddle();
    const right = createPaddle();
    movePaddle(left, 0, PADDLE_SPEED, STEP);
    movePaddle(right, COURT.width, PADDLE_SPEED, STEP);
    expect(COURT.width / 2 - left.x).toBeCloseTo(right.x - COURT.width / 2, 9);
  });

  it('never leaves the court, however far outside the target is', () => {
    const paddle = createPaddle();
    for (let i = 0; i < 200; i += 1) movePaddle(paddle, -5000, PADDLE_SPEED, STEP);
    expect(paddle.x).toBe(PADDLE_HALF_WIDTH);
    for (let i = 0; i < 400; i += 1) movePaddle(paddle, 5000, PADDLE_SPEED, STEP);
    expect(paddle.x).toBe(COURT.width - PADDLE_HALF_WIDTH);
  });

  it('does not move at all on a zero-length step', () => {
    const paddle = createPaddle();
    movePaddle(paddle, 0, PADDLE_SPEED, 0);
    expect(paddle.x).toBe(COURT.width / 2);
  });

  it('caps a slower driver at its own speed rather than the courts', () => {
    const paddle = createPaddle();
    const from = paddle.x;
    movePaddle(paddle, COURT.width, BOT_PROFILES.easy.topSpeed, STEP);
    expect(paddle.x - from).toBeCloseTo(BOT_PROFILES.easy.topSpeed * STEP, 9);
  });
});

describe('the bot', () => {
  function aimAt(
    balls: readonly Ball[],
    seat: SeatId,
    difficulty: BotDifficulty,
    seed = 7,
  ): number {
    return botTargetX(balls, seat, difficulty, new Rng(seed));
  }

  it('goes to meet the ball coming at it', () => {
    const incoming = ball(200, 700, 0, 400);
    const aim = aimAt([incoming], 'p1', 'hard');
    expect(Math.abs(aim - 200)).toBeLessThanOrEqual(BOT_PROFILES.hard.aimError);
  });

  it('reads the angle rather than the ball current column', () => {
    const incoming = ball(200, 700, 300, 400);
    const aim = aimAt([incoming], 'p1', 'hard');
    expect(aim).toBeGreaterThan(200);
  });

  it('folds a prediction that would run off the side of the court', () => {
    const incoming = ball(600, 700, 900, 300);
    const aim = aimAt([incoming], 'p1', 'hard');
    expect(aim).toBeGreaterThanOrEqual(PADDLE_HALF_WIDTH);
    expect(aim).toBeLessThanOrEqual(COURT.width - PADDLE_HALF_WIDTH);
  });

  it('drifts back to the middle when nothing is coming at it', () => {
    const away = ball(120, 700, 0, -400);
    const aim = aimAt([away], 'p1', 'hard');
    expect(Math.abs(aim - COURT.width / 2)).toBeLessThanOrEqual(BOT_PROFILES.hard.aimError);
  });

  it('takes the ball that will reach it first', () => {
    const soon = ball(150, 800, 0, 400);
    const later = ball(500, 300, 0, 100);
    const aim = aimAt([soon, later], 'p1', 'hard');
    expect(Math.abs(aim - 150)).toBeLessThan(Math.abs(aim - 500));
  });

  it('ignores the ball that is running away from it', () => {
    const away = ball(150, 800, 0, -400);
    const coming = ball(500, 300, 0, 300);
    const aim = aimAt([coming, away], 'p1', 'hard');
    expect(Math.abs(aim - 500)).toBeLessThan(Math.abs(aim - 150));
  });

  it('never asks for a place its paddle could not sit', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 500; i += 1) {
      const wild = ball(rng.float() * COURT.width, rng.float() * COURT.height, 900, 700);
      const aim = botTargetX([wild], 'p1', 'easy', rng);
      expect(aim).toBeGreaterThanOrEqual(PADDLE_HALF_WIDTH);
      expect(aim).toBeLessThanOrEqual(COURT.width - PADDLE_HALF_WIDTH);
    }
  });

  it('acts on where the ball was, never on where it will be', () => {
    // The lag is applied by rewinding the ball, so a laggier tier aims further behind it.
    const incoming = ball(320, 700, 400, 400);
    const late = aimAt([incoming], 'p1', 'easy', 1);
    const quick = aimAt([incoming], 'p1', 'hard', 1);
    expect(late).toBeLessThan(quick);
  });

  it('aims closer the harder it is', () => {
    const rng = new Rng(11);
    const error = { easy: 0, normal: 0, hard: 0 };
    for (let i = 0; i < 400; i += 1) {
      const incoming = ball(320, 700, 0, 400);
      for (const tier of ['easy', 'normal', 'hard'] as const) {
        error[tier] += Math.abs(botTargetX([incoming], 'p1', tier, rng) - 320);
      }
    }
    expect(error.hard).toBeLessThan(error.normal);
    expect(error.normal).toBeLessThan(error.easy);
  });

  it('gives the three tiers three different answers from one position', () => {
    const incoming = ball(240, 700, 120, 400);
    const easy = aimAt([incoming], 'p1', 'easy', 5);
    const normal = aimAt([incoming], 'p1', 'normal', 5);
    const hard = aimAt([incoming], 'p1', 'hard', 5);
    expect(new Set([easy, normal, hard]).size).toBe(3);
  });

  it('answers the same way twice from the same seed', () => {
    const incoming = ball(240, 700, 120, 400);
    expect(aimAt([incoming], 'p1', 'normal', 99)).toBe(aimAt([incoming], 'p1', 'normal', 99));
  });

  it('draws from the stream every step, so two seats never share a number', () => {
    const rng = new Rng(4);
    const idle = ball(320, 500, 0, -400);
    const first = botTargetX([idle], 'p1', 'easy', rng);
    const second = botTargetX([idle], 'p1', 'easy', rng);
    expect(first).not.toBe(second);
  });

  it('treats the two seats alike: a mirrored ball gives a mirrored aim', () => {
    const near = ball(200, 700, 140, 400);
    const far = ball(COURT.width - 200, COURT.height - 700, -140, -400);
    const aimNear = aimAt([near], 'p1', 'normal', 21);
    const aimFar = aimAt([far], 'p2', 'normal', 21);
    // The noise is drawn from the same place in the stream and added, not mirrored, so the
    // two aims mirror each other to within twice one tier's error and no further.
    expect(Math.abs(aimNear - (COURT.width - aimFar))).toBeLessThanOrEqual(
      BOT_PROFILES.normal.aimError * 2,
    );
  });

  it('is never given a faster paddle than a person has', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      expect(BOT_PROFILES[tier].topSpeed).toBeLessThanOrEqual(PADDLE_SPEED);
    }
  });

  it('orders its tiers by reaction, error and speed together', () => {
    expect(BOT_PROFILES.easy.reactionSeconds).toBeGreaterThan(BOT_PROFILES.normal.reactionSeconds);
    expect(BOT_PROFILES.normal.reactionSeconds).toBeGreaterThan(BOT_PROFILES.hard.reactionSeconds);
    expect(BOT_PROFILES.easy.aimError).toBeGreaterThan(BOT_PROFILES.normal.aimError);
    expect(BOT_PROFILES.normal.aimError).toBeGreaterThan(BOT_PROFILES.hard.aimError);
    expect(BOT_PROFILES.easy.topSpeed).toBeLessThan(BOT_PROFILES.normal.topSpeed);
    expect(BOT_PROFILES.normal.topSpeed).toBeLessThan(BOT_PROFILES.hard.topSpeed);
  });
});

describe('the small helpers', () => {
  it('clamps into the band', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('folds a line back and forth between two rails', () => {
    expect(foldIntoBand(5, 0, 10)).toBe(5);
    expect(foldIntoBand(12, 0, 10)).toBe(8);
    expect(foldIntoBand(-3, 0, 10)).toBe(3);
    expect(foldIntoBand(23, 0, 10)).toBe(3);
    expect(foldIntoBand(7, 5, 5)).toBe(5);
  });

  it('accelerates a ball without turning it', () => {
    const moving = ball(0, 0, 300, -400);
    accelerate(moving, 2);
    expect(speed(moving)).toBeCloseTo(1000, 6);
    expect(moving.vx / moving.vy).toBeCloseTo(300 / -400, 9);
  });

  it('has nothing to accelerate on a ball at rest', () => {
    const still = ball(0, 0, 0, 0);
    accelerate(still, 2);
    expect(still.vx).toBe(0);
  });

  it('names the brick at a column and row, and reads it back', () => {
    const index = brickIndex(5, 2);
    expect(brickColumn(index)).toBe(5);
    expect(brickRow(index)).toBe(2);
  });
});
