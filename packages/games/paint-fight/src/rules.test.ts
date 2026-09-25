import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_PROFILES,
  CELLS,
  CELL_SIZE,
  FAN_SPREAD,
  COLUMNS,
  START_MARKS,
  START_SPREAD,
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
import type { BotDifficulty, Game, Roller } from './rules.js';
import type { SeatId } from '@duelbox/engine';

/** Every tier, because a seat advantage can change sign between them. */
const DIFFICULTIES: BotDifficulty[] = ['easy', 'normal', 'hard'];

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

  it('starts the two rollers on marks that are half-turn images of each other', () => {
    // The same pair of positions under a half-turn of the board, so neither seat has an
    // edge and neither is aimed at the other, whichever roll each one draws.
    const game = createGame();
    expect(game.p1.x).toBeLessThan(BOARD_WIDTH / 2);
    expect(game.p2.x).toBeGreaterThan(BOARD_WIDTH / 2);
    expect(BOARD_WIDTH - game.p2.x).toBeCloseTo(game.p1.x, 6);
    expect(BOARD_HEIGHT - game.p2.y).toBeCloseTo(game.p1.y, 6);
  });

  it('seats the opening seat on the first mark, whichever seat that is', () => {
    // The whole of the seat symmetry rests on this: the marks and the streams go to roles,
    // and nothing else in the rules can tell one seat from the other.
    const opened = createGame();
    resetGame(opened, 'p2', 0.25, 0.75);
    expect(opened.p2.x).toBe(START_MARKS[0].x);
    expect(opened.p1.x).toBe(START_MARKS[1].x);
    expect(opened.p2.heading).toBe(START_MARKS[0].heading + (0.25 - 0.5) * START_SPREAD);
    expect(opened.p1.heading).toBe(START_MARKS[1].heading + (0.75 - 0.5) * START_SPREAD);
  });

  it('draws an opening heading from the roll rather than repeating one', () => {
    const low = createGame();
    resetGame(low, 'p1', 0, 0);
    const high = createGame();
    resetGame(high, 'p1', 0.999, 0.999);
    expect(high.p1.heading - low.p1.heading).toBeCloseTo(0.999 * START_SPREAD, 6);
  });

  it('starts over on reset', () => {
    const game = createGame();
    paintAt(game, 'p1', 400, 400);
    game.elapsed = 20;
    game.phase = 'over';
    resetGame(game, 'p1', 0.5, 0.5);
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
  it('steers within full lock', () => {
    for (const difficulty of DIFFICULTIES) {
      const game = createGame();
      const amount = botSteer(game, 'p1', difficulty, new Rng(1));
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

  it('out-paints a weaker tier', () => {
    // Head to head is the only honest measure here: a roller alone on the board is not
    // playing this game, and the hardest tier spends much of its effort denying the other
    // player rather than maximising its own count.
    const play = (a: BotDifficulty, b: BotDifficulty, seed: number): number => {
      const game = createGame();
      const rngA = new Rng(seed);
      const rngB = new Rng(seed + 1);
      resetGame(game, 'p1', rngA.float(), rngB.float());
      for (let i = 0; i < 60 * ROUND_SECONDS && game.phase === 'playing'; i += 1) {
        steer(game.p1, botSteer(game, 'p1', a, rngA), STEP);
        steer(game.p2, botSteer(game, 'p2', b, rngB), STEP);
        step(game, STEP);
      }
      return (countOwned(game, 'p1') - countOwned(game, 'p2')) / CELLS;
    };
    /**
     * The mean share of the board a beats b by, over four seeded rounds.
     *
     * Four rather than one, because a round is no longer a fixed script — the opening
     * heading and the bot's tie-breaks come from the seed — so one round is a sample of
     * one. Four is as many as the `hard` search can be asked for inside the suite's
     * thirty-second timeout.
     */
    const sweep = (a: BotDifficulty, b: BotDifficulty): number => {
      let total = 0;
      for (let seed = 1; seed <= 4; seed += 1) total += play(a, b, seed * 977);
      return total / 4;
    };
    expect(sweep('hard', 'easy'), 'hard out-paints easy').toBeGreaterThan(0.15);
    expect(sweep('hard', 'normal'), 'and normal').toBeGreaterThan(0.15);
    expect(sweep('normal', 'easy'), 'normal out-paints easy').toBeGreaterThan(0.15);
    // There was a fourth line here — `Math.abs(play('hard', 'hard')) < 0.1`, "and neither
    // seat has an edge" — and it could not have failed however lopsided the game was: two
    // identical deterministic bots on a board that was its own half-turn image played out
    // as exact mirrors and tied to the cell, so it measured exactly 0 every time. The claim
    // it was making is now proved rather than sampled, in `describe('the mirror')` below
    // and in game.test.ts, and a sample of four rounds would be a worse guard than either.
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

/**
 * The mirror test: nothing in this file may be able to tell the two seats apart.
 *
 * A win-rate ladder cannot see the defect this catches. This game measured a **flat draw,
 * every match, on `normal` and `hard`** — 245-245 to the cell over two thousand matches —
 * and that was read as proof of symmetry when it was the opposite: the board starts as its
 * own half-turn image, the bot used no randomness at all, and so both rollers played the
 * identical round rotated 180 degrees and the counts could not do anything *but* tie. The
 * one asymmetry underneath, `step` painting p1's disc before p2's and handing every cell
 * the two rollers crossed together to whoever went second, was invisible for exactly the
 * same reason: the overlap was symmetric too. Two bugs, each hiding the other, behind a
 * number that looked like a proof.
 *
 * So this asserts the property directly rather than sampling the outcome, in the two forms
 * that are checkable to the bit:
 *
 * - **Relabel.** Exchange the two seats' labels — every cell's owner, both rollers — and
 *   every function here must produce the exchange of what it produced. Nothing is rotated,
 *   nothing is reflected, so there is no floating-point slack to hide in and every
 *   assertion below is exact.
 * - **Half-turn.** Turn the board through 180 degrees as well. Coordinates are drawn on a
 *   quarter-unit grid, where `BOARD_WIDTH - x` is exact in a double, so this is exact too.
 */
describe('the mirror', () => {
  /** Positions are drawn on this grid, so that a half-turn of the board loses no bits. */
  const GRID = 4;

  function copyRoller(target: Roller, source: Readonly<Roller>): void {
    target.x = source.x;
    target.y = source.y;
    target.heading = source.heading;
    target.painted = source.painted;
  }

  /** The same position with the two seats' labels exchanged, and nothing else touched. */
  function relabel(game: Readonly<Game>): Game {
    const other = createGame();
    for (let cell = 0; cell < CELLS; cell += 1) {
      const owner = game.cells[cell] ?? null;
      other.cells[cell] = owner === null ? null : otherOf(owner);
    }
    copyRoller(other.p1, game.p2);
    copyRoller(other.p2, game.p1);
    other.phase = game.phase;
    other.elapsed = game.elapsed;
    other.winner =
      game.winner === null || game.winner === 'draw' ? game.winner : otherOf(game.winner);
    return other;
  }

  /** The board turned through 180 degrees, seats exchanged with it. */
  function halfTurn(game: Readonly<Game>): Game {
    const other = relabel(game);
    const cells = other.cells.slice();
    for (let cell = 0; cell < CELLS; cell += 1) {
      other.cells[cell] = cells[cellAt(COLUMNS - 1 - columnOf(cell), ROWS - 1 - rowOf(cell))]!;
    }
    for (const roller of [other.p1, other.p2]) {
      roller.x = BOARD_WIDTH - roller.x;
      roller.y = BOARD_HEIGHT - roller.y;
      roller.heading += Math.PI;
    }
    return other;
  }

  /** Everything a comparison needs, as one string, so a failure prints the difference. */
  function fingerprint(game: Readonly<Game>): string {
    const rollers = [game.p1, game.p2]
      .map((r) => `${String(r.x)},${String(r.y)},${String(r.painted)}`)
      .join('|');
    return `${game.cells.map((owner) => owner ?? '.').join('')} ${rollers} ${game.phase} ${String(game.winner)}`;
  }

  /**
   * A board nobody designed: every cell independently bare, mine or theirs, and two rollers
   * dropped anywhere on it.
   *
   * Half the time the second roller is put **on top of** the first, because the cells two
   * discs cover at once are the only ones whose owner the paint order could ever decide,
   * and two rollers landing within 112 units of each other by chance is a one-in-twenty-five
   * event. A random sweep that never sets up the case cannot test it.
   */
  function randomBoard(rng: Rng): Game {
    const game = createGame();
    for (let cell = 0; cell < CELLS; cell += 1) {
      const roll = rng.int(0, 3);
      game.cells[cell] = roll === 0 ? null : roll === 1 ? 'p1' : 'p2';
    }
    game.p1.x = rng.int(0, BOARD_WIDTH * GRID + 1) / GRID;
    game.p1.y = rng.int(0, BOARD_HEIGHT * GRID + 1) / GRID;
    if (rng.bool()) {
      const near = ROLLER_RADIUS * 2 * GRID;
      game.p2.x = game.p1.x + rng.int(-near, near + 1) / GRID;
      game.p2.y = game.p1.y + rng.int(-near, near + 1) / GRID;
    } else {
      game.p2.x = rng.int(0, BOARD_WIDTH * GRID + 1) / GRID;
      game.p2.y = rng.int(0, BOARD_HEIGHT * GRID + 1) / GRID;
    }
    for (const roller of [game.p1, game.p2]) {
      roller.heading = (rng.int(0, 4096) / 4096) * Math.PI * 2;
    }
    return game;
  }

  it('steps a relabelled board into the relabelling of the step', () => {
    // The one that catches the paint order. `step` used to walk ['p1', 'p2'] and paint in
    // that order, so every cell both discs covered went to p2 — and relabelling the seats
    // hands it to p2 again, which is the other roller. Exact, not close: no rotation here.
    const rng = new Rng(20260829);
    for (let trial = 0; trial < 400; trial += 1) {
      const board = randomBoard(rng);
      const mirrored = relabel(board);
      step(board, STEP);
      step(mirrored, STEP);
      expect(fingerprint(relabel(board)), `trial ${String(trial)}`).toBe(fingerprint(mirrored));
    }
  });

  it('paints the half-turn of a disc into the half-turn of the board', () => {
    const rng = new Rng(31337);
    for (let trial = 0; trial < 400; trial += 1) {
      const board = randomBoard(rng);
      const mirrored = halfTurn(board);
      const { p1, p2 } = board;
      expect(paintAt(board, 'p1', p1.x, p1.y, p2.x, p2.y)).toBe(
        paintAt(
          mirrored,
          'p2',
          BOARD_WIDTH - p1.x,
          BOARD_HEIGHT - p1.y,
          BOARD_WIDTH - p2.x,
          BOARD_HEIGHT - p2.y,
        ),
      );
      expect(halfTurn(board).cells, `trial ${String(trial)}`).toEqual(mirrored.cells);
    }
  });

  it('scores a heading the same from either seat', () => {
    const rng = new Rng(4242);
    for (let trial = 0; trial < 200; trial += 1) {
      const board = randomBoard(rng);
      const mirrored = relabel(board);
      for (const profile of Object.values(BOT_PROFILES)) {
        const heading = board.p1.heading;
        expect(scoreHeading(mirrored, 'p2', heading, profile)).toBe(
          scoreHeading(board, 'p1', heading, profile),
        );
      }
    }
  });

  it('takes the same decision from either seat, on every bot decision', () => {
    // Every tier, both seats, hundreds of boards — and the same stream position on both
    // sides, because the tie-break is the one thing in the bot that reads a generator.
    const rng = new Rng(90210);
    for (let trial = 0; trial < 200; trial += 1) {
      const board = randomBoard(rng);
      const mirrored = relabel(board);
      for (const difficulty of DIFFICULTIES) {
        const seed = rng.int(0, 1_000_000);
        expect(botSteer(mirrored, 'p2', difficulty, new Rng(seed))).toBe(
          botSteer(board, 'p1', difficulty, new Rng(seed)),
        );
      }
    }
  });

  it('calls the whistle the same way from either seat', () => {
    const rng = new Rng(5150);
    for (let trial = 0; trial < 200; trial += 1) {
      const board = randomBoard(rng);
      const mirrored = relabel(board);
      callTime(board);
      callTime(mirrored);
      const expected =
        board.winner === 'draw' || board.winner === null ? board.winner : otherOf(board.winner);
      expect(mirrored.winner).toBe(expected);
    }
  });

  it('plays a whole round the same way with the seats exchanged', () => {
    // The end-to-end version: forty-five simulated seconds, both bots searching, and the
    // final board must be the exact relabelling. This is the assertion the old flat draw
    // was pretending to be.
    const trace = (first: SeatId, seed: number): string => {
      const board = createGame();
      const one = new Rng(seed);
      const two = new Rng(seed + 1);
      resetGame(board, first, one.float(), two.float());
      const rngFor = (seat: SeatId): Rng => (seat === first ? one : two);
      while (board.phase === 'playing') {
        for (const seat of ['p1', 'p2'] as SeatId[]) {
          steer(rollerOf(board, seat), botSteer(board, seat, 'normal', rngFor(seat)), STEP);
        }
        step(board, STEP);
      }
      return fingerprint(first === 'p1' ? board : relabel(board));
    };
    for (let seed = 1; seed <= 4; seed += 1) {
      expect(trace('p2', seed * 7919), `seed ${String(seed)}`).toBe(trace('p1', seed * 7919));
    }
  });
});
