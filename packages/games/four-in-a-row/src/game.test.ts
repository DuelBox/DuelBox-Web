import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { DropFourGame, HOVER_Y, columnAt, columnCentreX } from './game.js';
import { CELL_COUNT, COLUMNS, ROWS } from './rules.js';
import type { BotDifficulty, Cell } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL = 900;

/** DROP_SECONDS (0.25) at 60 Hz: the steps a disc spends falling. */
const DROP_STEPS = 15;
/** THINK_SECONDS (0.5) at 60 Hz, before the step the bot plays on. */
const THINK_STEPS = 30;
/** SETTLE_SECONDS (1) at 60 Hz: the pause between rounds. */
const SETTLE_STEPS = 60;

class FakeSeat implements SeatInput {
  readonly move: Vec2 = vec2();
  pointer: Vec2 | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
  holdSecondsAtRelease = 0;

  reset(): void {
    this.move.x = 0;
    this.move.y = 0;
    this.pointer = null;
    this.actionPressed = false;
    this.actionHeld = false;
    this.actionReleased = false;
    this.holdSeconds = 0;
  }
}

class FakeInput implements InputState {
  readonly p1 = new FakeSeat();
  readonly p2 = new FakeSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.p1 : this.p2;
  }

  of(seat: SeatId): FakeSeat {
    return seat === 'p1' ? this.p1 : this.p2;
  }

  clear(): void {
    this.p1.reset();
    this.p2.reset();
  }
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  calls = 0;
  circles = 0;
  rings = 0;
  lines = 0;
  texts = 0;

  clear(): void {
    this.calls += 1;
  }
  rect(): void {
    this.calls += 1;
  }
  strokeRect(): void {
    this.calls += 1;
  }
  circle(x: number, y: number, radius: number): void {
    this.calls += 1;
    this.circles += 1;
    expect(Number.isFinite(x + y + radius)).toBe(true);
  }
  strokeCircle(x: number, y: number, radius: number): void {
    this.calls += 1;
    this.rings += 1;
    expect(Number.isFinite(x + y + radius)).toBe(true);
  }
  line(): void {
    this.calls += 1;
    this.lines += 1;
  }
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.calls += 1;
    this.texts += 1;
    expect(value.length).toBeGreaterThan(0);
    expect(Number.isFinite(x + y + sizePx)).toBe(true);
    expect(colour.length).toBeGreaterThan(0);
    expect(align === undefined || align.length > 0).toBe(true);
  }
  pushSeatRotation(): void {
    this.depth += 1;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
  }
  pushRotation(): void {
    this.pushSeatRotation();
  }
  popSeatRotation(): void {
    this.depth -= 1;
  }
}

function makeContext(
  p1Bot: BotDifficulty | null,
  p2Bot: BotDifficulty | null,
  presentation: Presentation = 'single-seat',
  localSeat: SeatId = 'p1',
  seed = 1234,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat: 'p1',
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1Bot : p2Bot),
  };
}

function step(game: DropFourGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** Index of a cell, written out so the tests assert the convention rather than share it. */
function at(row: number, col: number): number {
  return row * 7 + col;
}

/** Presses over a column without letting go, which is what raises the waiting disc. */
function press(input: FakeInput, seat: SeatId, column: number, rotated = false): void {
  const target = input.of(seat);
  const x = columnCentreX(column);
  target.pointer = rotated ? { x: LOGICAL - x, y: LOGICAL - HOVER_Y } : { x, y: HOVER_Y };
  target.actionPressed = true;
  target.actionHeld = true;
}

/** Lets go, which is what commits the drop. */
function release(input: FakeInput, seat: SeatId): void {
  const target = input.of(seat);
  target.reset();
  target.actionReleased = true;
}

/** A whole gesture by the active seat, followed by the steps the disc spends falling. */
function dropInto(game: DropFourGame, input: FakeInput, column: number, rotated = false): void {
  const seat = game.activeSeat;
  input.clear();
  press(input, seat, column, rotated);
  step(game, input);
  input.clear();
  release(input, seat);
  step(game, input);
  input.clear();
  step(game, input, DROP_STEPS);
}

function boardOf(game: DropFourGame): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < CELL_COUNT; i += 1) cells.push(game.cellAt(i));
  return cells;
}

function discCount(game: DropFourGame): number {
  let count = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (game.cellAt(i) !== null) count += 1;
  }
  return count;
}

/** Fills the board without ever completing a line. See rules.test.ts for why it draws. */
const DRAWN_ORDER: readonly number[] = [
  0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 4, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 6, 6,
  6, 6, 6, 6, 5, 5, 5, 5, 5,
];

/** p1 takes the bottom row from the left while p2 stacks the right-hand column. */
const P1_ROUND_WIN: readonly number[] = [0, 6, 1, 6, 2, 6, 3];

describe('columnAt', () => {
  it('maps a point to the column under it, whatever its height', () => {
    for (let col = 0; col < COLUMNS; col += 1) {
      expect(columnAt(columnCentreX(col))).toBe(col);
    }
  });

  it('misses the board sideways', () => {
    expect(columnAt(0)).toBe(-1);
    expect(columnAt(LOGICAL)).toBe(-1);
  });
});

describe('DropFourGame turns', () => {
  let game: DropFourGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new DropFourGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts with p1 on an empty board', () => {
    expect(game.activeSeat).toBe('p1');
    expect(discCount(game)).toBe(0);
    expect(game.hoverColumn).toBe(3);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('drops into the column the pointer names and passes the turn', () => {
    dropInto(game, input, 5);
    expect(game.cellAt(at(ROWS - 1, 5))).toBe('p1');
    expect(discCount(game)).toBe(1);
    expect(game.activeSeat).toBe('p2');

    dropInto(game, input, 1);
    expect(game.cellAt(at(ROWS - 1, 1))).toBe('p2');
    expect(game.activeSeat).toBe('p1');
  });

  it('stacks each disc on top of the last', () => {
    for (let i = 0; i < ROWS; i += 1) {
      dropInto(game, input, 2);
      expect(game.cellAt(at(ROWS - 1 - i, 2))).not.toBeNull();
      expect(discCount(game)).toBe(i + 1);
    }
  });

  it('shows the disc hovering before it is let go of', () => {
    press(input, 'p1', 6);
    step(game, input, 4);
    expect(game.hoverColumn).toBe(6);
    expect(discCount(game)).toBe(0);
    expect(game.activeSeat).toBe('p1');

    // Sliding along the board moves the waiting disc rather than dropping anything.
    press(input, 'p1', 4);
    step(game, input);
    expect(game.hoverColumn).toBe(4);
    expect(discCount(game)).toBe(0);

    input.clear();
    release(input, 'p1');
    step(game, input);
    expect(game.cellAt(at(ROWS - 1, 4))).toBe('p1');
  });

  it('ignores the inactive seat entirely', () => {
    press(input, 'p2', 0);
    step(game, input);
    input.clear();
    release(input, 'p2');
    step(game, input);
    expect(discCount(game)).toBe(0);
    expect(game.activeSeat).toBe('p1');

    // Both seats acting at once still only lets the active one through.
    input.clear();
    press(input, 'p1', 1);
    press(input, 'p2', 5);
    step(game, input);
    input.clear();
    release(input, 'p1');
    release(input, 'p2');
    step(game, input);
    expect(game.cellAt(at(ROWS - 1, 1))).toBe('p1');
    expect(discCount(game)).toBe(1);
  });

  it('drops nothing for a gesture that never touches a column', () => {
    input.p1.pointer = { x: 12, y: 40 };
    input.p1.actionPressed = true;
    input.p1.actionHeld = true;
    step(game, input, 3);
    input.clear();
    release(input, 'p1');
    step(game, input);
    expect(discCount(game)).toBe(0);
    expect(game.activeSeat).toBe('p1');
  });

  it('refuses a drop into a full column and keeps the turn', () => {
    for (let i = 0; i < ROWS; i += 1) dropInto(game, input, 0);
    expect(discCount(game)).toBe(ROWS);
    expect(game.activeSeat).toBe('p1');

    dropInto(game, input, 0);
    expect(discCount(game)).toBe(ROWS);
    expect(game.activeSeat).toBe('p1');
    expect(game.cellAt(at(0, 0))).toBe('p2');
  });

  it('steers with the movement axes and drops on the action key', () => {
    input.p1.move.x = 1;
    step(game, input);
    expect(game.hoverColumn).toBe(4);

    // A held axis nudges once, not once per step.
    step(game, input, 10);
    expect(game.hoverColumn).toBe(4);

    input.clear();
    step(game, input);
    input.p1.move.x = -1;
    step(game, input);
    expect(game.hoverColumn).toBe(3);

    input.clear();
    input.p1.actionPressed = true;
    input.p1.actionHeld = true;
    step(game, input);
    expect(game.cellAt(at(ROWS - 1, 3))).toBe('p1');
    expect(game.activeSeat).toBe('p2');
  });

  it('keeps the waiting disc on the board when the axes are held to the edge', () => {
    for (let i = 0; i < COLUMNS * 2; i += 1) {
      input.clear();
      input.p1.move.x = -1;
      step(game, input);
      input.clear();
      step(game, input);
    }
    expect(game.hoverColumn).toBe(0);
  });
});

/**
 * Run out the seat flip with nothing pressed.
 *
 * The board turns to face whoever has the move and refuses input while it is part-way
 * round — what sits under a finger is moving, so a tap would name something the player
 * did not mean. A test that acts the instant the turn changes is aiming at a board
 * nobody could have seen.
 */
function settleFlip(game: DropFourGame, input: FakeInput): void {
  input.clear();
  step(game, input, 40);
}

describe('shared-screen rotation', () => {
  it('reads the far seat gesture in the frame it was drawn in', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));

    // p1 is local, so its own view is upright.
    dropInto(game, input, 1, false);
    expect(game.cellAt(at(ROWS - 1, 1))).toBe('p1');

    // p2 sits opposite: the board is turned half a turn for its turn, so the device
    // point diagonally opposite column 5 is the one that must land in column 5.
    settleFlip(game, input);
    dropInto(game, input, 5, true);
    expect(game.cellAt(at(ROWS - 1, 5))).toBe('p2');
  });

  it('never rotates in single-seat presentation', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    dropInto(game, input, 1, false);
    dropInto(game, input, 5, false);
    expect(game.cellAt(at(ROWS - 1, 5))).toBe('p2');
  });
});

describe('bot seats', () => {
  it('waits a fixed number of steps before dropping', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext(null, 'normal'));

    dropInto(game, input, 3);
    expect(game.activeSeat).toBe('p2');

    step(game, input, THINK_STEPS);
    expect(discCount(game)).toBe(1);
    step(game, input);
    expect(discCount(game)).toBe(2);
    expect(game.activeSeat).toBe('p1');
  });

  it('does not let a human play for a bot seat', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext(null, 'normal'));

    dropInto(game, input, 3);
    press(input, 'p2', 0);
    step(game, input);
    input.clear();
    release(input, 'p2');
    step(game, input, THINK_STEPS - 4);
    expect(discCount(game)).toBe(1);
  });

  it('replays identically from the same seed', () => {
    const first = new DropFourGame();
    const second = new DropFourGame();
    const input = new FakeInput();
    first.init(makeContext('easy', 'normal', 'single-seat', 'p1', 4242));
    second.init(makeContext('easy', 'normal', 'single-seat', 'p1', 4242));
    for (let i = 0; i < 900; i += 1) {
      first.update(STEP, input);
      second.update(STEP, input);
      expect(boardOf(second)).toEqual(boardOf(first));
    }
    expect(second.getScore()).toEqual(first.getScore());
    expect(second.activeSeat).toBe(first.activeSeat);
  });

  it('reaches a decided match', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'normal', 'single-seat', 'p1', 55));
    step(game, input, 12000);
    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(score.p1 + score.p2).toBeLessThanOrEqual(3);
  });
});

describe('determinism', () => {
  it('gives the same final state for the same seed and the same input trace', () => {
    const trace: readonly number[] = [3, 3, 4, 2, 4, 4, 2, 5, 1, 0, 6, 2, 5, 1];
    const first = new DropFourGame();
    const second = new DropFourGame();
    const firstInput = new FakeInput();
    const secondInput = new FakeInput();
    first.init(makeContext(null, null, 'shared-screen', 'p1', 909));
    second.init(makeContext(null, null, 'shared-screen', 'p1', 909));

    for (const column of trace) {
      dropInto(first, firstInput, column);
      dropInto(second, secondInput, column);
    }

    expect(boardOf(second)).toEqual(boardOf(first));
    expect(second.activeSeat).toBe(first.activeSeat);
    expect(second.hoverColumn).toBe(first.hoverColumn);
    expect(second.getScore()).toEqual(first.getScore());
  });
});

describe('rounds and the match', () => {
  let game: DropFourGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new DropFourGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('awards a round for four in a row and starts the next one', () => {
    for (const column of P1_ROUND_WIN) dropInto(game, input, column);

    expect(game.roundOutcome).toBe('p1');
    expect(game.getScore().p1).toBe(1);
    expect(game.getScore().winner).toBeNull();

    step(game, input, SETTLE_STEPS);
    expect(discCount(game)).toBe(0);
    expect(game.roundOutcome).toBeNull();
    // The starting seat alternates, so the first move is not always p1's advantage.
    expect(game.activeSeat).toBe('p2');
  });

  it('awards a round to p2 when p2 makes the line', () => {
    // p1 stacks its own column while p2 lays the bottom row from the right.
    for (const column of [0, 6, 0, 5, 0, 4, 1, 3]) dropInto(game, input, column);
    expect(game.roundOutcome).toBe('p2');
    expect(game.getScore()).toEqual({ p1: 0, p2: 1, winner: null });
  });

  it('ends the match on the second round win and then stands still', () => {
    for (const column of P1_ROUND_WIN) dropInto(game, input, column);
    step(game, input, SETTLE_STEPS);

    // p2 opens round two, so p1 needs one more disc than the seat that started.
    for (const column of [6, 0, 6, 1, 6, 2, 5, 3]) dropInto(game, input, column);

    expect(game.roundOutcome).toBe('p1');
    const score = game.getScore();
    expect(score.winner).toBe('p1');
    expect(score.p1).toBe(2);
    expect(score.p2).toBe(0);

    const settled = boardOf(game);
    step(game, input, 500);
    expect(boardOf(game)).toEqual(settled);
    expect(game.getScore()).toEqual({ p1: 2, p2: 0, winner: 'p1' });
  });

  it('draws the match when three full boards produce no line', () => {
    for (let round = 0; round < 3; round += 1) {
      for (const column of DRAWN_ORDER) dropInto(game, input, column);
      expect(game.roundOutcome).toBe('draw');
      expect(discCount(game)).toBe(CELL_COUNT);
      step(game, input, SETTLE_STEPS);
    }
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: 'draw' });
  });
});

describe('lifecycle and render', () => {
  it('pause and resume leave the position alone', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    dropInto(game, input, 2);

    const before = boardOf(game);
    game.onPause();
    game.onResume();
    expect(boardOf(game)).toEqual(before);
    expect(game.activeSeat).toBe('p2');
  });

  it('does not commit a gesture the pause interrupted', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    press(input, 'p1', 6);
    step(game, input);
    game.onPause();
    game.onResume();
    input.clear();
    release(input, 'p1');
    step(game, input);
    expect(discCount(game)).toBe(0);
    expect(game.activeSeat).toBe('p1');
  });

  it('destroy clears the position and the tally', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (const column of [0, 6, 1, 6, 2, 6, 3]) dropInto(game, input, column);
    expect(game.getScore().p1).toBe(1);

    game.destroy();
    expect(discCount(game)).toBe(0);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.roundOutcome).toBeNull();
  });

  it('renders a balanced frame and never mutates the position', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    const renderer = new RecordingRenderer();
    game.init(makeContext(null, null));
    dropInto(game, input, 3);
    dropInto(game, input, 4);

    const before = boardOf(game);
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.circles).toBeGreaterThan(0);
    expect(renderer.rings).toBeGreaterThan(0);
    // No text on the board: the score and the turn belong to the shell's HUD, and a
    // game that draws its own gives the player two scoreboards to reconcile.
    expect(renderer.texts).toBe(0);
    expect(boardOf(game)).toEqual(before);
    expect(game.activeSeat).toBe('p1');
  });

  it('interpolates the falling disc without touching the simulation', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    press(input, 'p1', 3);
    step(game, input);
    input.clear();
    release(input, 'p1');
    step(game, input);

    // The disc is already in the board; only the picture is still catching up.
    expect(game.cellAt(at(ROWS - 1, 3))).toBe('p1');
    const before = boardOf(game);
    for (const alpha of [0, 0.25, 0.5, 0.99]) {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      expect(renderer.depth).toBe(0);
      expect(renderer.calls).toBeGreaterThan(0);
    }
    expect(boardOf(game)).toEqual(before);
  });

  it('highlights the winning line once the last disc has landed', () => {
    const game = new DropFourGame();
    const input = new FakeInput();
    const open = new RecordingRenderer();
    const won = new RecordingRenderer();
    game.init(makeContext(null, null));

    game.render(open, 0);
    for (const column of P1_ROUND_WIN) dropInto(game, input, column);
    game.render(won, 0);

    // Four highlight rings on top of everything the open board already drew.
    expect(won.rings).toBeGreaterThanOrEqual(open.rings + 4);
    expect(won.depth).toBe(0);
  });
});
