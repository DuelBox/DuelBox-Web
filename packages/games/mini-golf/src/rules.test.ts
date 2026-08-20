import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BALL_RADIUS,
  BOT_PROFILES,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  HOLE_CAPTURE_SPEED,
  HOLE_RADIUS,
  LEAD_TO_WIN,
  MAX_HOLES,
  PUTT_MAX_SPEED,
  STROKE_LIMIT,
  TEE_X,
  TEE_Y,
  WALL,
  type BotDifficulty,
  type Game,
  botAim,
  createGame,
  holesOf,
  isDone,
  layOutHole,
  lineIsClear,
  powerForDistance,
  putt,
  resetGame,
  settlePutt,
  step,
  strokesOf,
  teeUp,
  winnerOf,
} from './rules';

const DT = 1 / 60;

function fresh(seed = 7): { game: Game; rng: Rng } {
  const rng = new Rng(seed);
  const game = createGame();
  resetGame(game, rng);
  return { game, rng };
}

/** Roll the ball until it stops or drops. Returns the steps taken. */
function rollOut(game: Game, limit = 2000): number {
  let steps = 0;
  while (steps < limit) {
    const result = step(game, DT);
    steps += 1;
    if (result.settled) return steps;
  }
  return steps;
}

describe('a fresh match', () => {
  it('starts with p1 to putt, nothing scored', () => {
    const { game } = fresh();
    expect(game.seat).toBe('p1');
    expect(game.phase).toBe('aiming');
    expect(game.holesP1).toBe(0);
    expect(game.holesP2).toBe(0);
    expect(game.winner).toBeNull();
  });

  it('tees the ball at the tee', () => {
    const { game } = fresh();
    expect(game.ball.x).toBe(TEE_X);
    expect(game.ball.y).toBe(TEE_Y);
    expect(game.ball.vx).toBe(0);
    expect(game.ball.vy).toBe(0);
  });

  it('lays the hole inside the walls', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const { game } = fresh(seed);
      expect(game.hole.x).toBeGreaterThan(WALL);
      expect(game.hole.x).toBeLessThan(COURSE_WIDTH - WALL);
      expect(game.hole.y).toBeGreaterThan(WALL);
      expect(game.hole.y).toBeLessThan(COURSE_HEIGHT - WALL);
    }
  });

  it('never lays the hole in the near half, where there would be no putt to make', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const { game } = fresh(seed);
      expect(game.hole.y).toBeLessThan(COURSE_HEIGHT * 0.5);
    }
  });

  it('never puts a block on the tee or the hole', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const { game } = fresh(seed);
      for (const block of game.blocks) {
        const onHole =
          game.hole.x > block.x - HOLE_RADIUS * 2 &&
          game.hole.x < block.x + block.w + HOLE_RADIUS * 2 &&
          game.hole.y > block.y - HOLE_RADIUS * 2 &&
          game.hole.y < block.y + block.h + HOLE_RADIUS * 2;
        expect(onHole, `seed ${seed} buried the hole`).toBe(false);
        const onTee =
          TEE_X > block.x - BALL_RADIUS * 4 &&
          TEE_X < block.x + block.w + BALL_RADIUS * 4 &&
          TEE_Y > block.y - BALL_RADIUS * 4 &&
          TEE_Y < block.y + block.h + BALL_RADIUS * 4;
        expect(onTee, `seed ${seed} buried the tee`).toBe(false);
      }
    }
  });

  it('lays the same course for the same seed and a different one for another', () => {
    const a = fresh(11).game;
    const b = fresh(11).game;
    const c = fresh(12).game;
    expect(b.hole).toEqual(a.hole);
    expect(b.blocks).toEqual(a.blocks);
    expect(c.hole).not.toEqual(a.hole);
  });
});

describe('putting', () => {
  it('sends the ball off and counts a stroke', () => {
    const { game } = fresh();
    expect(putt(game, -Math.PI / 2, 0.5)).toBe(true);
    expect(game.phase).toBe('rolling');
    expect(game.strokesP1).toBe(1);
    expect(game.ball.vy).toBeLessThan(0);
  });

  it('refuses a putt while the ball is rolling, so one stroke cannot become two', () => {
    const { game } = fresh();
    putt(game, -Math.PI / 2, 0.5);
    expect(putt(game, 0, 1)).toBe(false);
    expect(game.strokesP1).toBe(1);
  });

  it('refuses a putt with no power at all', () => {
    const { game } = fresh();
    expect(putt(game, 0, 0)).toBe(false);
    expect(game.strokesP1).toBe(0);
    expect(game.phase).toBe('aiming');
  });

  it('clamps power above one rather than letting it fly', () => {
    const { game } = fresh();
    putt(game, 0, 4);
    expect(Math.hypot(game.ball.vx, game.ball.vy)).toBeCloseTo(PUTT_MAX_SPEED, 3);
  });

  it('counts the stroke against whoever is putting', () => {
    const { game } = fresh();
    game.seat = 'p2';
    putt(game, 0, 0.4);
    expect(game.strokesP1).toBe(0);
    expect(game.strokesP2).toBe(1);
  });
});

describe('the roll', () => {
  it('always comes to rest', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const { game, rng } = fresh(seed);
      putt(game, rng.float() * Math.PI * 2, 0.4 + rng.float() * 0.6);
      const steps = rollOut(game);
      expect(steps, `seed ${seed} never settled`).toBeLessThan(2000);
    }
  });

  it('never leaves the walls', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const game = createGame();
      const rng = new Rng(seed);
      resetGame(game, rng);
      game.blocks.length = 0;
      putt(game, rng.float() * Math.PI * 2, 1);
      for (let i = 0; i < 900; i += 1) {
        step(game, DT);
        expect(game.ball.x).toBeGreaterThanOrEqual(WALL + BALL_RADIUS - 0.001);
        expect(game.ball.x).toBeLessThanOrEqual(COURSE_WIDTH - WALL - BALL_RADIUS + 0.001);
        expect(game.ball.y).toBeGreaterThanOrEqual(WALL + BALL_RADIUS - 0.001);
        expect(game.ball.y).toBeLessThanOrEqual(COURSE_HEIGHT - WALL - BALL_RADIUS + 0.001);
      }
    }
  });

  it('loses speed off a wall rather than gaining it', () => {
    const game = createGame();
    game.blocks.length = 0;
    game.hole.x = -999;
    game.ball.x = COURSE_WIDTH / 2;
    game.ball.y = COURSE_HEIGHT / 2;
    game.phase = 'rolling';
    game.ball.vx = 900;
    game.ball.vy = 0;
    let before = 900;
    for (let i = 0; i < 200; i += 1) {
      step(game, DT);
      const now = Math.abs(game.ball.vx);
      expect(now).toBeLessThanOrEqual(before + 0.001);
      before = now;
    }
  });

  it('never leaves a block', () => {
    const game = createGame();
    game.hole.x = -999;
    game.blocks.length = 0;
    game.blocks.push({ x: 200, y: 400, w: 300, h: 60 });
    for (let seed = 0; seed < 40; seed += 1) {
      const rng = new Rng(seed);
      teeUp(game);
      game.phase = 'rolling';
      const angle = -Math.PI / 2 + (rng.float() - 0.5) * 1.2;
      game.ball.vx = Math.cos(angle) * PUTT_MAX_SPEED;
      game.ball.vy = Math.sin(angle) * PUTT_MAX_SPEED;
      for (let i = 0; i < 700; i += 1) {
        step(game, DT);
        const inside =
          game.ball.x > 200 - BALL_RADIUS + 0.01 &&
          game.ball.x < 500 + BALL_RADIUS - 0.01 &&
          game.ball.y > 400 - BALL_RADIUS + 0.01 &&
          game.ball.y < 460 + BALL_RADIUS - 0.01;
        expect(inside, `seed ${seed} step ${i} went through the block`).toBe(false);
      }
    }
  });

  it('reports settled only once the ball is actually still', () => {
    const { game } = fresh();
    putt(game, -Math.PI / 2, 0.7);
    let settled = false;
    for (let i = 0; i < 2000 && !settled; i += 1) {
      const result = step(game, DT);
      if (result.settled) {
        settled = true;
        expect(game.ball.vx === 0 || game.ball.sunk).toBe(true);
      } else {
        expect(Math.hypot(game.ball.vx, game.ball.vy)).toBeGreaterThan(0);
      }
    }
    expect(settled).toBe(true);
  });
});

describe('the hole', () => {
  it('takes a slow ball', () => {
    const game = createGame();
    game.blocks.length = 0;
    game.hole.x = 350;
    game.hole.y = 300;
    game.ball.x = 350;
    game.ball.y = 340;
    game.ball.vx = 0;
    game.ball.vy = -HOLE_CAPTURE_SPEED * 0.4;
    game.phase = 'rolling';
    let sunk = false;
    for (let i = 0; i < 200 && !sunk; i += 1) sunk = step(game, DT).sunk;
    expect(sunk).toBe(true);
    expect(game.ball.x).toBe(350);
    expect(game.ball.y).toBe(300);
  });

  it('rattles a fast one straight over', () => {
    const game = createGame();
    game.blocks.length = 0;
    game.hole.x = 350;
    game.hole.y = 300;
    game.ball.x = 350;
    game.ball.y = 900;
    game.ball.vx = 0;
    game.ball.vy = -PUTT_MAX_SPEED;
    game.phase = 'rolling';
    let sunkEarly = false;
    for (let i = 0; i < 12; i += 1) {
      if (step(game, DT).sunk) sunkEarly = true;
      if (game.ball.y < 200) break;
    }
    expect(sunkEarly, 'a full-power putt dropped straight in').toBe(false);
  });

  it('is a real decision: the same line drops at low power and rattles at high', () => {
    function tryPower(speed: number): boolean {
      const game = createGame();
      game.blocks.length = 0;
      game.hole.x = 350;
      game.hole.y = 300;
      game.ball.x = 350;
      game.ball.y = 800;
      game.ball.vx = 0;
      game.ball.vy = -speed;
      game.phase = 'rolling';
      for (let i = 0; i < 600; i += 1) {
        const result = step(game, DT);
        if (result.sunk) return true;
        if (result.settled) return false;
      }
      return false;
    }
    // Enough to reach, not enough to skate over.
    expect(tryPower(PUTT_MAX_SPEED * powerForDistance(500))).toBe(true);
    expect(tryPower(PUTT_MAX_SPEED)).toBe(false);
  });

  it('stops the ball dead when it drops', () => {
    const game = createGame();
    game.blocks.length = 0;
    game.hole.x = 350;
    game.hole.y = 300;
    game.ball.x = 350;
    game.ball.y = 320;
    game.ball.vy = -100;
    game.phase = 'rolling';
    for (let i = 0; i < 60 && !game.ball.sunk; i += 1) step(game, DT);
    expect(game.ball.sunk).toBe(true);
    expect(game.ball.vx).toBe(0);
    expect(game.ball.vy).toBe(0);
  });
});

describe('taking turns', () => {
  it('lets a seat keep putting until it is done', () => {
    const { game, rng } = fresh();
    putt(game, Math.PI / 2, 0.05);
    rollOut(game);
    const outcome = settlePutt(game, rng);
    expect(outcome.next).toBe('p1');
    expect(game.seat).toBe('p1');
    expect(game.phase).toBe('aiming');
  });

  it('does not re-tee the ball between a seat own strokes', () => {
    const { game, rng } = fresh();
    putt(game, Math.PI, 0.4);
    rollOut(game);
    const x = game.ball.x;
    settlePutt(game, rng);
    expect(game.ball.x).toBe(x);
  });

  it('hands over and re-tees once a seat sinks it', () => {
    const { game, rng } = fresh();
    game.ball.sunk = true;
    game.phase = 'rolling';
    const outcome = settlePutt(game, rng);
    expect(outcome.next).toBe('p2');
    expect(game.seat).toBe('p2');
    expect(game.ball.sunk).toBe(false);
    expect(game.ball.x).toBe(TEE_X);
    expect(game.ball.y).toBe(TEE_Y);
  });

  it('concedes a hole at the stroke limit rather than letting it run for ever', () => {
    const { game, rng } = fresh();
    game.strokesP1 = STROKE_LIMIT;
    game.phase = 'rolling';
    settlePutt(game, rng);
    expect(isDone(game, 'p1')).toBe(true);
    expect(game.seat).toBe('p2');
  });

  it('gives the hole to whoever took fewer strokes', () => {
    const { game, rng } = fresh();
    game.doneP1 = true;
    game.strokesP1 = 2;
    game.seat = 'p2';
    game.strokesP2 = 4;
    game.ball.sunk = true;
    game.phase = 'rolling';
    const outcome = settlePutt(game, rng);
    expect(outcome.holeWinner).toBe('p1');
    expect(outcome.holeOver).toBe(true);
    expect(game.holesP1).toBe(1);
    expect(game.holesP2).toBe(0);
  });

  it('halves a hole taken in the same number', () => {
    const { game, rng } = fresh();
    game.doneP1 = true;
    game.strokesP1 = 3;
    game.seat = 'p2';
    game.strokesP2 = 3;
    game.ball.sunk = true;
    game.phase = 'rolling';
    const outcome = settlePutt(game, rng);
    expect(outcome.holeWinner).toBe('draw');
    expect(game.holesP1).toBe(0);
    expect(game.holesP2).toBe(0);
  });

  it('lets the player who lost the hole tee off first on the next', () => {
    const { game, rng } = fresh();
    game.doneP1 = true;
    game.strokesP1 = 2;
    game.seat = 'p2';
    game.strokesP2 = 5;
    game.ball.sunk = true;
    game.phase = 'rolling';
    settlePutt(game, rng);
    expect(game.seat).toBe('p2');
  });

  it('clears the strokes and lays a new course for the next hole', () => {
    const { game, rng } = fresh();
    const first = { ...game.hole };
    game.doneP1 = true;
    game.strokesP1 = 2;
    game.seat = 'p2';
    game.strokesP2 = 5;
    game.ball.sunk = true;
    game.phase = 'rolling';
    settlePutt(game, rng);
    expect(game.strokesP1).toBe(0);
    expect(game.strokesP2).toBe(0);
    expect(isDone(game, 'p1')).toBe(false);
    expect(isDone(game, 'p2')).toBe(false);
    expect(game.hole).not.toEqual(first);
  });

  it('both players play the identical hole, which is the whole comparison', () => {
    const { game, rng } = fresh();
    const hole = { ...game.hole };
    const blocks = game.blocks.map((b) => ({ ...b }));
    game.ball.sunk = true;
    game.phase = 'rolling';
    settlePutt(game, rng);
    expect(game.seat).toBe('p2');
    expect(game.hole).toEqual(hole);
    expect(game.blocks).toEqual(blocks);
  });
});

describe('the win condition', () => {
  it('is not met at one hole clear, which is what makes it a lead', () => {
    const game = createGame();
    game.holesP1 = 1;
    game.holeNumber = 1;
    expect(winnerOf(game)).toBeNull();
  });

  it('is met at two clear', () => {
    const game = createGame();
    game.holesP1 = LEAD_TO_WIN;
    game.holeNumber = LEAD_TO_WIN;
    expect(winnerOf(game)).toBe('p1');
  });

  it('is met at two clear from behind as well', () => {
    const game = createGame();
    game.holesP1 = 3;
    game.holesP2 = 5;
    game.holeNumber = 8;
    expect(winnerOf(game)).toBe('p2');
  });

  it('is not met by a big score with a small lead', () => {
    const game = createGame();
    game.holesP1 = 4;
    game.holesP2 = 3;
    game.holeNumber = 7;
    expect(winnerOf(game)).toBeNull();
  });

  it('ends the match at the hole cap, because a lead alone has no bound', () => {
    const game = createGame();
    game.holesP1 = 4;
    game.holesP2 = 3;
    game.holeNumber = MAX_HOLES;
    expect(winnerOf(game)).toBe('p1');
  });

  it('calls a draw at the cap with the scores level', () => {
    const game = createGame();
    game.holesP1 = 3;
    game.holesP2 = 3;
    game.holeNumber = MAX_HOLES;
    expect(winnerOf(game)).toBe('draw');
  });

  it('freezes the game once it is won', () => {
    const { game, rng } = fresh();
    game.holesP1 = 1;
    game.doneP1 = true;
    game.strokesP1 = 2;
    game.seat = 'p2';
    game.strokesP2 = 5;
    game.ball.sunk = true;
    game.phase = 'rolling';
    const outcome = settlePutt(game, rng);
    expect(outcome.winner).toBe('p1');
    expect(game.phase).toBe('over');
    expect(putt(game, 0, 1)).toBe(false);
  });
});

describe('sight lines', () => {
  it('sees a clear line when nothing is between', () => {
    const game = createGame();
    game.blocks.length = 0;
    expect(lineIsClear(game, 350, 100)).toBe(true);
  });

  it('sees a block straight ahead', () => {
    const game = createGame();
    game.blocks.length = 0;
    game.blocks.push({ x: TEE_X - 100, y: 400, w: 200, h: 50 });
    expect(lineIsClear(game, TEE_X, 100)).toBe(false);
  });

  it('sees past a block that is off the line', () => {
    const game = createGame();
    game.blocks.length = 0;
    game.blocks.push({ x: 20, y: 400, w: 80, h: 50 });
    expect(lineIsClear(game, TEE_X, 100)).toBe(true);
  });
});

describe('power for a distance', () => {
  it('lands the ball near where it was asked to', () => {
    for (const distance of [150, 300, 500, 700]) {
      const game = createGame();
      game.blocks.length = 0;
      game.hole.x = -999;
      game.ball.x = COURSE_WIDTH / 2;
      game.ball.y = COURSE_HEIGHT - 60;
      const from = game.ball.y;
      game.phase = 'rolling';
      const power = powerForDistance(distance);
      game.ball.vy = -PUTT_MAX_SPEED * power;
      rollOut(game);
      const travelled = from - game.ball.y;
      expect(Math.abs(travelled - distance), `asked ${distance}, got ${travelled}`).toBeLessThan(
        distance * 0.25 + 30,
      );
    }
  });

  it('asks for more power the further the target', () => {
    expect(powerForDistance(600)).toBeGreaterThan(powerForDistance(200));
  });

  it('never asks for more than full or less than a nudge', () => {
    expect(powerForDistance(99999)).toBe(1);
    expect(powerForDistance(0)).toBeGreaterThanOrEqual(0.05);
  });
});

describe('the bot', () => {
  it('aims at the hole down a clear line', () => {
    const game = createGame();
    game.blocks.length = 0;
    game.hole.x = TEE_X + 200;
    game.hole.y = 200;
    const aim = botAim(game, 'hard', 0.5, 0.5);
    const want = Math.atan2(game.hole.y - TEE_Y, game.hole.x - TEE_X);
    expect(aim.angle).toBeCloseTo(want, 5);
  });

  it('aims off the hole when a block is in the way, if it is a tier that looks', () => {
    const game = createGame();
    game.hole.x = TEE_X;
    game.hole.y = 200;
    game.blocks.length = 0;
    game.blocks.push({ x: TEE_X - 120, y: 500, w: 240, h: 60 });
    const straight = Math.atan2(game.hole.y - TEE_Y, game.hole.x - TEE_X);
    const aim = botAim(game, 'hard', 0.5, 0.5);
    expect(Math.abs(aim.angle - straight)).toBeGreaterThan(0.05);
  });

  it('does not look for a way round on easy, which is what makes it easy', () => {
    const game = createGame();
    game.hole.x = TEE_X;
    game.hole.y = 200;
    game.blocks.length = 0;
    game.blocks.push({ x: TEE_X - 120, y: 500, w: 240, h: 60 });
    const straight = Math.atan2(game.hole.y - TEE_Y, game.hole.x - TEE_X);
    const aim = botAim(game, 'easy', 0.5, 0.5);
    expect(aim.angle).toBeCloseTo(straight, 5);
  });

  it('spreads wider on easy than on hard', () => {
    expect(BOT_PROFILES.easy.spread).toBeGreaterThan(BOT_PROFILES.normal.spread);
    expect(BOT_PROFILES.normal.spread).toBeGreaterThan(BOT_PROFILES.hard.spread);
  });

  it('uses its roll: a different roll gives a different aim', () => {
    const game = createGame();
    game.blocks.length = 0;
    game.hole.x = TEE_X;
    game.hole.y = 200;
    const low = botAim(game, 'easy', 0, 0.5);
    const high = botAim(game, 'easy', 1, 0.5);
    expect(low.angle).not.toBeCloseTo(high.angle, 3);
    expect(Math.abs(high.angle - low.angle)).toBeCloseTo(BOT_PROFILES.easy.spread * 2, 4);
  });

  it('keeps its power inside the legal range whatever the roll', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const rng = new Rng(seed);
      const game = createGame();
      resetGame(game, rng);
      for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
        const aim = botAim(game, tier, rng.float(), rng.float());
        expect(aim.power).toBeGreaterThanOrEqual(0.05);
        expect(aim.power).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('the tiers actually differ', () => {
  /** Strokes a tier needs to hole out, averaged over many holes. */
  function strokesToHole(tier: BotDifficulty, holes: number): number {
    let total = 0;
    for (let seed = 0; seed < holes; seed += 1) {
      const rng = new Rng(seed * 977 + 13);
      const game = createGame();
      resetGame(game, rng);
      while (!game.ball.sunk && strokesOf(game, 'p1') < STROKE_LIMIT) {
        const aim = botAim(game, tier, rng.float(), rng.float());
        putt(game, aim.angle, aim.power);
        rollOut(game);
        if (!game.ball.sunk) game.phase = 'aiming';
      }
      total += strokesOf(game, 'p1');
    }
    return total / holes;
  }

  it('takes fewer strokes the better the tier', () => {
    const easy = strokesToHole('easy', 120);
    const normal = strokesToHole('normal', 120);
    const hard = strokesToHole('hard', 120);
    expect(hard, `easy ${easy}, normal ${normal}, hard ${hard}`).toBeLessThan(normal);
    expect(normal, `easy ${easy}, normal ${normal}, hard ${hard}`).toBeLessThan(easy);
  });

  it('holes out rather than running out of strokes, even on easy', () => {
    expect(strokesToHole('easy', 120)).toBeLessThan(STROKE_LIMIT);
  });
});
