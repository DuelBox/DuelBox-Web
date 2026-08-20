import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOT_PROFILES,
  GROWTH_PER_PELLET,
  HEAD_RADIUS,
  NECK_SEGMENTS,
  PELLETS,
  PELLET_RADIUS,
  PELLET_TARGET,
  ROUND_SECONDS,
  SEGMENT_SPACING,
  SPEED,
  START_SEGMENTS,
  TURN_RATE,
  WALL,
  botSteer,
  callStalemate,
  createGame,
  freeSpot,
  headOf,
  hitsBody,
  hitsWall,
  normaliseAngle,
  otherOf,
  pathIsClear,
  resetGame,
  seedPellets,
  snakeOf,
  steer,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

/** An arena with no pellets, so a test can watch one thing at a time. */
function bare(): Game {
  const game = createGame();
  game.pellets.length = 0;
  return game;
}

describe('the arena', () => {
  it('starts two snakes facing each other', () => {
    const game = createGame();
    expect(game.p1.body.length).toBe(START_SEGMENTS);
    expect(game.p2.body.length).toBe(START_SEGMENTS);
    expect(headOf(game.p1).x).toBeLessThan(headOf(game.p2).x);
    expect(Math.abs(normaliseAngle(game.p1.heading - game.p2.heading))).toBeCloseTo(Math.PI, 5);
  });

  it('lays each snake out behind its head', () => {
    const game = createGame();
    const head = headOf(game.p1);
    const tail = game.p1.body[START_SEGMENTS - 1];
    if (tail === undefined) throw new Error('no tail');
    expect(tail.x, 'p1 faces right, so its tail is to the left').toBeLessThan(head.x);
  });

  it('puts both snakes inside the walls', () => {
    const game = createGame();
    for (const snake of [game.p1, game.p2]) {
      for (const point of snake.body) {
        expect(hitsWall(point.x, point.y), 'every segment is on the arena').toBe(false);
      }
    }
  });

  it('scatters pellets clear of both snakes', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const game = createGame();
      seedPellets(game, new Rng(seed));
      expect(game.pellets.length).toBe(PELLETS);
      for (const pellet of game.pellets) {
        expect(hitsWall(pellet.x, pellet.y), `seed ${String(seed)}: on the arena`).toBe(false);
        for (const snake of [game.p1, game.p2]) {
          for (const point of snake.body) {
            expect(
              Math.hypot(point.x - pellet.x, point.y - pellet.y),
              `seed ${String(seed)}: clear of a snake`,
            ).toBeGreaterThanOrEqual(PELLET_RADIUS + HEAD_RADIUS - 1e-9);
          }
        }
      }
    }
  });

  it('always finds a spot, even when the arena is crowded', () => {
    // Rejection sampling that never succeeds would stall the round rather than error.
    const game = createGame();
    for (let i = 0; i < 4000; i += 1) {
      game.p1.body.push({ x: WALL + 30 + (i % 800), y: WALL + 30 + ((i * 7) % 800) });
    }
    const spot = freeSpot(game, new Rng(3));
    expect(Number.isFinite(spot.x)).toBe(true);
    expect(Number.isFinite(spot.y)).toBe(true);
  });

  it('starts over on reset', () => {
    const game = createGame();
    game.p1.alive = false;
    game.phase = 'over';
    game.p1.eaten = 4;
    resetGame(game, new Rng(5));
    expect(game.phase).toBe('playing');
    expect(game.p1.alive).toBe(true);
    expect(game.p1.eaten).toBe(0);
    expect(game.p1.body.length).toBe(START_SEGMENTS);
    expect(game.pellets.length).toBe(PELLETS);
  });
});

describe('moving', () => {
  it('carries a snake forward', () => {
    const game = bare();
    const before = headOf(game.p1).x;
    for (let i = 0; i < 30; i += 1) step(game, STEP, new Rng(1));
    expect(headOf(game.p1).x, 'half a second of travel').toBeGreaterThan(before);
  });

  it('turns at a rate rather than snapping to a heading', () => {
    // You cannot spin on the spot and you cannot reverse, which is what makes the arena
    // filling up matter.
    const game = bare();
    const before = game.p1.heading;
    steer(game.p1, 1, STEP);
    expect(game.p1.heading - before).toBeCloseTo(TURN_RATE * STEP, 6);
  });

  it('clamps a steer beyond full lock', () => {
    const game = bare();
    const before = game.p1.heading;
    steer(game.p1, 40, STEP);
    expect(game.p1.heading - before).toBeCloseTo(TURN_RATE * STEP, 6);
  });

  it('will not steer a dead snake', () => {
    const game = bare();
    game.p1.alive = false;
    const before = game.p1.heading;
    steer(game.p1, 1, STEP);
    expect(game.p1.heading).toBe(before);
  });

  it('records a segment every fixed distance, not every frame', () => {
    // Otherwise the body's length in segments would depend on the frame rate.
    const game = bare();
    const before = game.p1.body.length;
    step(game, STEP, new Rng(1));
    expect(game.p1.body.length, 'one frame is shorter than a segment').toBe(before);
    for (let i = 0; i < 20; i += 1) step(game, STEP, new Rng(1));
    expect(game.p1.body.length).toBeGreaterThanOrEqual(before);
  });

  it('keeps the body trimmed to the length it has earned', () => {
    // The tail has to be dropped as the head advances, or the snake grows for ever just by
    // moving and the arena fills with a trail nobody earned.
    const game = bare();
    game.p1.length = START_SEGMENTS;
    for (let i = 0; i < 600 && game.p1.alive; i += 1) step(game, STEP, new Rng(1));
    expect(game.p1.body.length, 'exactly what it is entitled to').toBe(START_SEGMENTS);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = createGame();
      const rng = new Rng(17);
      seedPellets(game, rng);
      const out: string[] = [];
      for (let i = 0; i < 600; i += 1) {
        steer(game.p1, Math.sin(i / 40), STEP);
        steer(game.p2, Math.cos(i / 30), STEP);
        step(game, STEP, rng);
        if (i % 60 === 0) out.push(headOf(game.p1).x.toFixed(6));
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });
});

describe('dying', () => {
  it('dies on a wall', () => {
    const game = bare();
    const head = headOf(game.p1);
    head.x = ARENA_WIDTH - WALL - HEAD_RADIUS - 2;
    for (let i = 0; i < 20 && game.p1.alive; i += 1) step(game, STEP, new Rng(1));
    expect(game.p1.alive).toBe(false);
    expect(winnerOf(game), 'the survivor takes it').toBe('p2');
  });

  it('dies on the other snake', () => {
    const game = bare();
    // Put p1's head right on top of p2's body.
    const target = game.p2.body[4];
    if (target === undefined) throw new Error('no fixture');
    const head = headOf(game.p1);
    head.x = target.x;
    head.y = target.y;
    step(game, STEP, new Rng(1));
    expect(game.p1.alive).toBe(false);
  });

  it('dies on its own body', () => {
    const game = bare();
    const head = headOf(game.p1);
    const own = game.p1.body[NECK_SEGMENTS + 3];
    if (own === undefined) throw new Error('no fixture');
    head.x = own.x;
    head.y = own.y;
    step(game, STEP, new Rng(1));
    expect(game.p1.alive).toBe(false);
  });

  it('does not die on its own neck, which every turn would touch', () => {
    const game = bare();
    // Full lock for a full second: a tight circle that passes close to its own neck.
    for (let i = 0; i < 60; i += 1) {
      steer(game.p1, 1, STEP);
      step(game, STEP, new Rng(1));
    }
    expect(game.p1.alive, 'a hard turn is not suicide').toBe(true);
  });

  it('kills both on a head-on collision, which is a draw', () => {
    // Both snakes move before either is tested, so iteration order never decides a death.
    const game = bare();
    const a = headOf(game.p1);
    const b = headOf(game.p2);
    b.x = a.x + 4;
    b.y = a.y;
    step(game, STEP, new Rng(1));
    expect(game.p1.alive).toBe(false);
    expect(game.p2.alive).toBe(false);
    expect(winnerOf(game)).toBe('draw');
  });

  it('stops simulating once it is over', () => {
    const game = bare();
    game.phase = 'over';
    const before = headOf(game.p1).x;
    step(game, STEP, new Rng(1));
    expect(headOf(game.p1).x).toBe(before);
  });

  it('knows what is outside the walls', () => {
    expect(hitsWall(ARENA_WIDTH / 2, ARENA_HEIGHT / 2)).toBe(false);
    expect(hitsWall(WALL, ARENA_HEIGHT / 2), 'the wall itself is out').toBe(true);
    expect(hitsWall(ARENA_WIDTH / 2, -5)).toBe(true);
  });

  it('knows what is inside a body', () => {
    const game = bare();
    const point = game.p2.body[3];
    if (point === undefined) throw new Error('no fixture');
    expect(hitsBody(game.p2, point.x, point.y, 0)).toBe(true);
    expect(hitsBody(game.p2, point.x + 400, point.y, 0)).toBe(false);
  });
});

describe('eating', () => {
  it('grows the snake and scores', () => {
    const game = bare();
    const head = headOf(game.p1);
    game.pellets.push({ x: head.x + 6, y: head.y });
    const before = game.p1.length;
    const result = step(game, STEP, new Rng(1));
    expect(result.ate).toContain('p1');
    expect(game.p1.length).toBe(before + GROWTH_PER_PELLET);
    expect(game.p1.eaten).toBe(1);
  });

  it('puts a fresh pellet out rather than leaving a gap', () => {
    const game = bare();
    const head = headOf(game.p1);
    game.pellets.push({ x: head.x + 6, y: head.y });
    step(game, STEP, new Rng(1));
    expect(game.pellets.length, 'the count never drops').toBe(1);
  });

  it('eats before it dies, so the last pellet still counts', () => {
    // Dying on the frame you ate reads as the game taking it away.
    const game = bare();
    const head = headOf(game.p1);
    head.x = ARENA_WIDTH - WALL - HEAD_RADIUS - 1;
    game.pellets.push({ x: head.x, y: head.y });
    const result = step(game, STEP, new Rng(1));
    expect(result.ate, 'it got the pellet').toContain('p1');
    expect(game.p1.alive, 'and then it hit the wall').toBe(false);
    expect(game.p1.eaten).toBe(1);
  });

  it('is not eaten by a dead snake', () => {
    const game = bare();
    game.p1.alive = false;
    const head = headOf(game.p1);
    game.pellets.push({ x: head.x, y: head.y });
    step(game, STEP, new Rng(1));
    expect(game.p1.eaten).toBe(0);
  });
});

describe('the pellet target', () => {
  it('wins the round outright', () => {
    // Without a target, eating is pure downside — longer body, tighter arena, no reward.
    const game = bare();
    game.p1.eaten = PELLET_TARGET - 1;
    const head = headOf(game.p1);
    game.pellets.push({ x: head.x + 6, y: head.y });
    step(game, STEP, new Rng(1));
    expect(game.p1.eaten).toBe(PELLET_TARGET);
    expect(winnerOf(game), 'reaching the target wins').toBe('p1');
    expect(game.phase).toBe('over');
  });

  it('does not win from beyond the grave', () => {
    // Eating the last pellet and hitting a wall in the same step is a death, not a win.
    const game = bare();
    game.p1.eaten = PELLET_TARGET - 1;
    const head = headOf(game.p1);
    head.x = ARENA_WIDTH - WALL - HEAD_RADIUS - 1;
    game.pellets.push({ x: head.x, y: head.y });
    step(game, STEP, new Rng(1));
    expect(game.p1.eaten, 'the pellet counted').toBe(PELLET_TARGET);
    expect(game.p1.alive).toBe(false);
    expect(winnerOf(game), 'but the wall came first').toBe('p2');
  });

  it('is not reached before it is reached', () => {
    const game = bare();
    game.p1.eaten = PELLET_TARGET - 2;
    const head = headOf(game.p1);
    game.pellets.push({ x: head.x + 6, y: head.y });
    step(game, STEP, new Rng(1));
    expect(winnerOf(game)).toBeNull();
  });
});

describe('a round nobody wins', () => {
  it('is called on pellets eaten', () => {
    // Two cautious snakes circling their own halves will never meet, and nothing else
    // would end such a round: `roundSeconds` is read only by the catalogue card.
    const game = bare();
    game.p1.eaten = 3;
    game.p2.eaten = 1;
    callStalemate(game);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw when the two are level', () => {
    const game = bare();
    callStalemate(game);
    expect(winnerOf(game)).toBe('draw');
  });

  it('does not overrule a round already decided', () => {
    const game = bare();
    game.phase = 'over';
    game.winner = 'p2';
    callStalemate(game);
    expect(winnerOf(game)).toBe('p2');
  });

  it('has a length worth calling', () => {
    expect(ROUND_SECONDS).toBeGreaterThan(30);
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('steers within full lock', () => {
    for (const difficulty of DIFFICULTIES) {
      const game = createGame();
      seedPellets(game, new Rng(3));
      const amount = botSteer(game, 'p1', difficulty);
      expect(amount).toBeGreaterThanOrEqual(-1);
      expect(amount).toBeLessThanOrEqual(1);
    }
  });

  it('does not steer a dead snake', () => {
    const game = createGame();
    game.p1.alive = false;
    expect(botSteer(game, 'p1', 'hard')).toBe(0);
  });

  it('turns away from a wall it is running at', () => {
    const game = bare();
    const head = headOf(game.p1);
    head.x = ARENA_WIDTH - WALL - 60;
    head.y = ARENA_HEIGHT / 2;
    game.p1.heading = 0; // straight at the wall
    expect(Math.abs(botSteer(game, 'p1', 'hard')), 'it turns').toBeGreaterThan(0.1);
  });

  it('knows whether a path is clear', () => {
    const game = bare();
    const head = headOf(game.p1);
    head.x = ARENA_WIDTH / 2;
    head.y = ARENA_HEIGHT / 2;
    expect(pathIsClear(game, 'p1', -Math.PI / 2, 0.4), 'up the middle').toBe(true);
    head.x = ARENA_WIDTH - WALL - 30;
    expect(pathIsClear(game, 'p1', 0, 0.5), 'into the wall').toBe(false);
  });

  it('turns hard rather than giving up when nothing is safe', () => {
    // A snake that walks calmly into a wall looks broken rather than beaten.
    const game = bare();
    const head = headOf(game.p1);
    head.x = WALL + HEAD_RADIUS + 1;
    head.y = WALL + HEAD_RADIUS + 1;
    game.p1.heading = Math.PI * 1.25; // into the corner
    expect(Math.abs(botSteer(game, 'p1', 'hard'))).toBe(1);
  });

  it('steers wider the harder it is', () => {
    expect(BOT_PROFILES.hard.fanSize).toBeGreaterThan(BOT_PROFILES.normal.fanSize);
    expect(BOT_PROFILES.normal.fanSize).toBeGreaterThan(BOT_PROFILES.easy.fanSize);
    expect(BOT_PROFILES.hard.lookahead).toBeGreaterThan(BOT_PROFILES.easy.lookahead);
  });

  it('has every tier chasing food, so they play the same game', () => {
    // An earlier draft had the weakest tier ignore pellets, which made it play a different
    // game rather than the same game worse. With no pellet target it was also a *better*
    // one: it beat the tier that chased food 40 to 17, by circling an empty half of the
    // arena while the other two grew and crashed.
    const game = bare();
    const head = headOf(game.p1);
    // A pellet dead ahead and nothing in the way: every tier should hold its line.
    game.pellets.push({ x: head.x + 200, y: head.y });
    for (const difficulty of DIFFICULTIES) {
      expect(
        Math.abs(botSteer(game, 'p1', difficulty)),
        `${difficulty} holds its line`,
      ).toBeLessThan(0.35);
    }
    // Move it off to one side and every tier should turn toward it.
    game.pellets[0] = { x: head.x + 200, y: head.y - 200 };
    for (const difficulty of DIFFICULTIES) {
      expect(botSteer(game, 'p1', difficulty), `${difficulty} turns toward it`).toBeLessThan(-0.1);
    }
  });

  it('wins more often the harder it is', () => {
    // Head to head rather than survival time: every tier now chases pellets, so the
    // question is which one gets more of them without dying, not which one hides longest.
    const play = (a: BotDifficulty, b: BotDifficulty): number => {
      let aWins = 0;
      const rounds = 24;
      for (let seed = 0; seed < rounds; seed += 1) {
        const game = createGame();
        const rng = new Rng(seed * 7919 + 3);
        seedPellets(game, rng);
        for (let i = 0; i < 60 * ROUND_SECONDS && game.phase === 'playing'; i += 1) {
          steer(game.p1, botSteer(game, 'p1', a), STEP);
          steer(game.p2, botSteer(game, 'p2', b), STEP);
          step(game, STEP, rng);
        }
        if (game.phase === 'playing') callStalemate(game);
        if (game.winner === 'p1') aWins += 1;
      }
      return aWins / rounds;
    };

    const hardOverEasy = play('hard', 'easy');
    const normalOverEasy = play('normal', 'easy');
    expect(hardOverEasy, `hard took ${hardOverEasy.toFixed(2)} against easy`).toBeGreaterThan(0.5);
    expect(normalOverEasy, `normal took ${normalOverEasy.toFixed(2)}`).toBeGreaterThan(0.5);
    expect(hardOverEasy).toBeGreaterThanOrEqual(normalOverEasy);
  }, 60_000);

  it('avoids where the other snake is going, not only where it is', () => {
    // The whole difference between a bot that plays and one that does not. Testing only
    // the opponent's current body meant two snakes approaching each other both saw a clear
    // path into the empty space between them: 103 of 109 deaths were head-on collisions.
    const game = bare();
    const mine = headOf(game.p1);
    mine.x = ARENA_WIDTH / 2 - 150;
    mine.y = ARENA_HEIGHT / 2;
    game.p1.heading = 0;

    const theirs = headOf(game.p2);
    theirs.x = ARENA_WIDTH / 2 + 150;
    theirs.y = ARENA_HEIGHT / 2;
    game.p2.heading = Math.PI; // straight at us
    // Their body trails away behind them, so nothing is between us right now.
    for (let i = 1; i < game.p2.body.length; i += 1) {
      const point = game.p2.body[i];
      if (point !== undefined) {
        point.x = theirs.x + i * SEGMENT_SPACING;
        point.y = theirs.y;
      }
    }

    expect(
      pathIsClear(game, 'p1', 0, 1.2),
      'the space between us is empty now and will not be',
    ).toBe(false);
  });
});

describe('angles', () => {
  it('normalises into a half-turn either side', () => {
    expect(normaliseAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normaliseAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI, 6);
    expect(normaliseAngle(0.4)).toBeCloseTo(0.4, 6);
  });
});

describe('seats', () => {
  it('has two', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(snakeOf(createGame(), 'p2').body.length).toBe(START_SEGMENTS);
    expect(SEGMENT_SPACING).toBeGreaterThan(0);
    expect(SPEED).toBeGreaterThan(0);
  });
});
