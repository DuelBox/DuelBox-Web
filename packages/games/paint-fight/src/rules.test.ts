import { describe, expect, it } from 'vitest';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_PROFILES,
  CELLS,
  CELL_SIZE,
  FAN_SPREAD,
  COLUMNS,
  LOOKAHEAD_SECONDS,
  ROLLER_RADIUS,
  ROUND_SECONDS,
  ROWS,
  SPEED,
  TURN_RATE,
  botSteer,
  callTime,
  cellAt,
  columnOf,
  countBare,
  fanOffset,
  countOwned,
  createGame,
  inBounds,
  otherOf,
  paintAt,
  resetGame,
  rollerOf,
  rowOf,
  scoreHeading,
  steer,
  step,
  winnerOf,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

describe('the board', () => {
  it('starts bare', () => {
    const game = createGame();
    expect(countBare(game)).toBe(CELLS);
    expect(countOwned(game, 'p1')).toBe(0);
    expect(countOwned(game, 'p2')).toBe(0);
  });

  it('converts between cells and coordinates', () => {
    for (let cell = 0; cell < CELLS; cell += 1) {
      expect(cellAt(columnOf(cell), rowOf(cell))).toBe(cell);
    }
  });

  it('knows what is off the board', () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(COLUMNS - 1, ROWS - 1)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(0, ROWS)).toBe(false);
  });

  it('starts the two rollers in opposite corners, facing away', () => {
    // The same position under a half-turn of the board, so neither seat has an edge and
    // neither is aimed at the other.
    const game = createGame();
    expect(game.p1.x).toBeLessThan(BOARD_WIDTH / 2);
    expect(game.p2.x).toBeGreaterThan(BOARD_WIDTH / 2);
    expect(BOARD_WIDTH - game.p2.x).toBeCloseTo(game.p1.x, 6);
    expect(BOARD_HEIGHT - game.p2.y).toBeCloseTo(game.p1.y, 6);
  });

  it('starts over on reset', () => {
    const game = createGame();
    paintAt(game, 'p1', 400, 400);
    game.elapsed = 20;
    game.phase = 'over';
    resetGame(game);
    expect(countBare(game)).toBe(CELLS);
    expect(game.elapsed).toBe(0);
    expect(game.phase).toBe('playing');
    expect(winnerOf(game)).toBeNull();
  });
});

describe('painting', () => {
  it('paints a disc, not a single cell', () => {
    // A roller is a wide thing. Painting only the cell under its centre leaves a one-cell
    // trail that no amount of driving fills in.
    const game = createGame();
    const painted = paintAt(game, 'p1', BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
    expect(painted, 'more than one cell').toBeGreaterThan(1);
    expect(countOwned(game, 'p1')).toBe(painted);
  });

  it('paints a disc rather than a square', () => {
    const game = createGame();
    paintAt(game, 'p1', BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
    const reach = Math.ceil(ROLLER_RADIUS / CELL_SIZE);
    const square = (reach * 2 + 1) ** 2;
    expect(countOwned(game, 'p1'), 'the corners of the square are left bare').toBeLessThan(square);
  });

  it('takes a cell off the other player', () => {
    const game = createGame();
    paintAt(game, 'p2', BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
    const theirs = countOwned(game, 'p2');
    expect(theirs).toBeGreaterThan(0);
    paintAt(game, 'p1', BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
    expect(countOwned(game, 'p2'), 'all of it changed hands').toBe(0);
    expect(countOwned(game, 'p1')).toBe(theirs);
  });

  it('reports nothing when it repaints its own', () => {
    const game = createGame();
    paintAt(game, 'p1', BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
    expect(paintAt(game, 'p1', BOARD_WIDTH / 2, BOARD_HEIGHT / 2)).toBe(0);
  });

  it('paints nothing off the board', () => {
    const game = createGame();
    paintAt(game, 'p1', -500, -500);
    expect(countOwned(game, 'p1')).toBe(0);
  });

  it('paints a partial disc at a corner rather than throwing', () => {
    const game = createGame();
    const painted = paintAt(game, 'p1', 0, 0);
    expect(painted).toBeGreaterThan(0);
    expect(countOwned(game, 'p1')).toBe(painted);
  });
});

describe('rolling', () => {
  it('carries a roller forward', () => {
    const game = createGame();
    const before = game.p1.x;
    for (let i = 0; i < 20; i += 1) step(game, STEP);
    expect(game.p1.x).toBeGreaterThan(before);
  });

  it('turns at a rate rather than snapping', () => {
    const game = createGame();
    const before = game.p1.heading;
    steer(game.p1, 1, STEP);
    expect(game.p1.heading - before).toBeCloseTo(TURN_RATE * STEP, 6);
  });

  it('clamps a steer beyond full lock', () => {
    const game = createGame();
    const before = game.p1.heading;
    steer(game.p1, 50, STEP);
    expect(game.p1.heading - before).toBeCloseTo(TURN_RATE * STEP, 6);
  });

  it('lays a trail as it goes', () => {
    const game = createGame();
    for (let i = 0; i < 60; i += 1) step(game, STEP);
    expect(countOwned(game, 'p1'), 'a second of driving covers ground').toBeGreaterThan(25);
  });

  it('bounces off a wall rather than stopping', () => {
    // A roller that stops is a roller that paints one cell for ever, and a player who has
    // run into a wall would have nothing to do but turn around.
    const game = createGame();
    game.p1.x = BOARD_WIDTH - 20;
    game.p1.heading = 0; // straight at the wall
    for (let i = 0; i < 30; i += 1) step(game, STEP);
    expect(Math.cos(game.p1.heading), 'it is heading back').toBeLessThan(0);
    expect(game.p1.x).toBeLessThanOrEqual(BOARD_WIDTH);
  });

  it('keeps both rollers on the board', () => {
    const game = createGame();
    for (let i = 0; i < 60 * 30; i += 1) {
      steer(game.p1, Math.sin(i / 17), STEP);
      steer(game.p2, Math.cos(i / 23), STEP);
      step(game, STEP);
      for (const roller of [game.p1, game.p2]) {
        expect(roller.x).toBeGreaterThanOrEqual(0);
        expect(roller.x).toBeLessThanOrEqual(BOARD_WIDTH);
        expect(roller.y).toBeGreaterThanOrEqual(0);
        expect(roller.y).toBeLessThanOrEqual(BOARD_HEIGHT);
      }
      if (game.phase === 'over') break;
    }
  });

  it('replays identically from the same steering', () => {
    const trace = (): string => {
      const game = createGame();
      for (let i = 0; i < 600; i += 1) {
        steer(game.p1, Math.sin(i / 13), STEP);
        steer(game.p2, Math.cos(i / 11), STEP);
        step(game, STEP);
      }
      return `${String(countOwned(game, 'p1'))}:${String(countOwned(game, 'p2'))}:${game.p1.x.toFixed(6)}`;
    };
    expect(trace()).toBe(trace());
  });

  it('does nothing once the round is over', () => {
    const game = createGame();
    game.phase = 'over';
    const before = game.p1.x;
    step(game, STEP);
    expect(game.p1.x).toBe(before);
  });
});

describe('the score', () => {
  it('is walked, not accumulated', () => {
    // Painting over the other player changes two counts at once and a cell can change
    // hands many times, so a running total is a bookkeeping bug waiting to happen.
    const game = createGame();
    paintAt(game, 'p1', 200, 200);
    paintAt(game, 'p2', 200, 200);
    paintAt(game, 'p1', 200, 200);
    expect(countOwned(game, 'p1') + countOwned(game, 'p2') + countBare(game)).toBe(CELLS);
    expect(countOwned(game, 'p2')).toBe(0);
  });

  it('always adds up to the whole board', () => {
    const game = createGame();
    for (let i = 0; i < 600; i += 1) {
      steer(game.p1, Math.sin(i / 9), STEP);
      steer(game.p2, Math.cos(i / 7), STEP);
      step(game, STEP);
      expect(countOwned(game, 'p1') + countOwned(game, 'p2') + countBare(game)).toBe(CELLS);
      if (game.phase === 'over') break;
    }
  });

  it('is reported on each roller for the HUD', () => {
    const game = createGame();
    for (let i = 0; i < 120; i += 1) step(game, STEP);
    expect(game.p1.painted).toBe(countOwned(game, 'p1'));
    expect(game.p2.painted).toBe(countOwned(game, 'p2'));
  });
});

describe('the whistle', () => {
  it('ends the round at time', () => {
    const game = createGame();
    game.elapsed = ROUND_SECONDS - STEP;
    step(game, STEP);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).not.toBeNull();
  });

  it('gives it to whoever painted more', () => {
    const game = createGame();
    paintAt(game, 'p1', 200, 200);
    callTime(game);
    expect(winnerOf(game)).toBe('p1');
  });

  it('calls a level board a draw', () => {
    const game = createGame();
    callTime(game);
    expect(winnerOf(game), 'nothing painted either side').toBe('draw');
  });

  it('does not overrule a round already called', () => {
    const game = createGame();
    game.phase = 'over';
    game.winner = 'p2';
    callTime(game);
    expect(winnerOf(game)).toBe('p2');
  });

  it('always ends, whatever the two players do', () => {
    // The clock is the only way this game ends: nobody can be eliminated.
    const game = createGame();
    for (let i = 0; i < 60 * (ROUND_SECONDS + 10) && game.phase === 'playing'; i += 1) {
      step(game, STEP);
    }
    expect(game.phase).toBe('over');
  });
});

describe('the bot', () => {
  const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('steers within full lock', () => {
    for (const difficulty of DIFFICULTIES) {
      const game = createGame();
      const amount = botSteer(game, 'p1', difficulty);
      expect(amount).toBeGreaterThanOrEqual(-1);
      expect(amount).toBeLessThanOrEqual(1);
    }
  });

  it('prefers a heading over fresh board to one over its own colour', () => {
    const game = createGame();
    const roller = rollerOf(game, 'p1');
    roller.x = BOARD_WIDTH / 2;
    roller.y = BOARD_HEIGHT / 2;
    // Paint everything to the right of the roller.
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (columnOf(cell) > COLUMNS / 2) game.cells[cell] = 'p1';
    }
    const profile = BOT_PROFILES.normal;
    expect(scoreHeading(game, 'p1', Math.PI, profile), 'left, over bare board').toBeGreaterThan(
      scoreHeading(game, 'p1', 0, profile),
    );
  });

  it('counts the other player colour double, on the tier that understands it', () => {
    // Taking a cell off the other player swings the gap by two, not one — which is why a
    // good player chases rather than colouring in the corners.
    const game = createGame();
    const roller = rollerOf(game, 'p1');
    roller.x = BOARD_WIDTH / 2;
    roller.y = BOARD_HEIGHT / 2;
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (columnOf(cell) > COLUMNS / 2) game.cells[cell] = 'p2';
    }
    const bare = scoreHeading(game, 'p1', Math.PI, BOT_PROFILES.hard);
    const theirs = scoreHeading(game, 'p1', 0, BOT_PROFILES.hard);
    expect(theirs, 'the hard tier chases').toBeGreaterThan(bare);

    const plainBare = scoreHeading(game, 'p1', Math.PI, BOT_PROFILES.normal);
    const plainTheirs = scoreHeading(game, 'p1', 0, BOT_PROFILES.normal);
    expect(plainTheirs, 'and a plainer one does not').toBeCloseTo(plainBare, 5);
  });

  it('considers more headings the harder it is, which is the axis that orders', () => {
    // Swept against a nine-wide fan: three is 53 points worse, five is 13 worse, fifteen
    // is 2 better and twenty-one is 10 better. Monotonic, unlike the lookahead.
    expect(BOT_PROFILES.hard.fanSize).toBeGreaterThan(BOT_PROFILES.normal.fanSize);
    expect(BOT_PROFILES.normal.fanSize).toBeGreaterThan(BOT_PROFILES.easy.fanSize);
    expect(BOT_PROFILES.easy.stealsBack).toBe(false);
  });

  it('does not count a cell twice in one sweep', () => {
    // The samples along a path overlap heavily, and counting the overlap would make a
    // slow, tight turn look like the most valuable move on the board.
    const game = createGame();
    const roller = rollerOf(game, 'p1');
    roller.x = BOARD_WIDTH / 2;
    roller.y = BOARD_HEIGHT / 2;
    expect(scoreHeading(game, 'p1', 0, BOT_PROFILES.hard)).toBeLessThanOrEqual(CELLS);
  });

  it('shares one lookahead, because that parameter has an optimum', () => {
    // Swept head to head: 0.25 s is 18 points worse than 0.5 s and 1.4 s is 20 points
    // worse. Too short and it cannot see round a corner; too long and it commits to a
    // direction that is good far away and bad right now. Using it as the difficulty axis
    // made the hardest tier the *worst* one, losing 37-58 to the weakest.
    expect(BOT_PROFILES.easy.lookahead).toBe(LOOKAHEAD_SECONDS);
    expect(BOT_PROFILES.normal.lookahead).toBe(LOOKAHEAD_SECONDS);
    expect(BOT_PROFILES.hard.lookahead).toBe(LOOKAHEAD_SECONDS);
  });

  it('out-paints a weaker tier, and ties with itself', () => {
    // Head to head is the only honest measure here: a roller alone on the board is not
    // playing this game, and the hardest tier spends much of its effort denying the other
    // player rather than maximising its own count.
    const play = (a: BotDifficulty, b: BotDifficulty): number => {
      const game = createGame();
      for (let i = 0; i < 60 * ROUND_SECONDS && game.phase === 'playing'; i += 1) {
        steer(game.p1, botSteer(game, 'p1', a), STEP);
        steer(game.p2, botSteer(game, 'p2', b), STEP);
        step(game, STEP);
      }
      return (countOwned(game, 'p1') - countOwned(game, 'p2')) / CELLS;
    };
    expect(play('hard', 'easy'), 'hard out-paints easy').toBeGreaterThan(0.15);
    expect(play('hard', 'normal'), 'and normal').toBeGreaterThan(0.15);
    expect(play('normal', 'easy'), 'normal out-paints easy').toBeGreaterThan(0.15);
    expect(Math.abs(play('hard', 'hard')), 'and neither seat has an edge').toBeLessThan(0.1);
  });

  it('spaces its fan densely near straight ahead', () => {
    // Spaced **evenly**, a fan's finest step is several times what one decision can turn,
    // so every option but "straight" clamps to full lock and the roller can only spin.
    // With a long lookahead that was catastrophic: two of the hardest tier covered 14% of
    // the board each in a full round.
    const half = (BOT_PROFILES.hard.fanSize - 1) / 2;
    const finest = fanOffset(1, half, 1);
    const evenFinest = FAN_SPREAD / half;
    expect(finest, 'far finer than an even fan would offer').toBeLessThan(evenFinest / 3);

    // Fine enough that one decision can actually take it, rather than clamping.
    expect(finest, 'inside what a single decision turns').toBeLessThan(TURN_RATE / 60);

    // And still reaching the edges, or it could not turn hard when it needs to.
    expect(fanOffset(half, half, 1)).toBeCloseTo(FAN_SPREAD, 6);
  });

  it('never estimates more than a heading would really gain', () => {
    // The samples along a path overlap heavily. Counting the overlap would make a slow,
    // tight turn look like the most valuable move on the board, and a bot that believes
    // its own inflated numbers drives in circles.
    const game = createGame();
    const roller = rollerOf(game, 'p1');
    roller.x = BOARD_WIDTH / 2;
    roller.y = BOARD_HEIGHT / 2;
    roller.heading = 0;
    const estimate = scoreHeading(game, 'p1', 0, BOT_PROFILES.hard);

    // Drive that exact path and count what it actually paints.
    const real = createGame();
    const driven = rollerOf(real, 'p1');
    driven.x = roller.x;
    driven.y = roller.y;
    driven.heading = 0;
    const seconds = BOT_PROFILES.hard.lookahead;
    let actually = 0;
    for (let i = 1; i <= 7; i += 1) {
      const distance = SPEED * seconds * (i / 7);
      actually += paintAt(real, 'p1', roller.x + distance, roller.y);
    }
    expect(
      estimate,
      `estimated ${String(estimate)} against ${String(actually)} really painted`,
    ).toBe(actually);
  });
});

describe('seats', () => {
  it('has two', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(rollerOf(createGame(), 'p2').heading).toBeCloseTo(Math.PI, 6);
    expect(SPEED).toBeGreaterThan(0);
  });
});
