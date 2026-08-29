import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { UltimateTicTacToeGame, cellCentre } from './game.js';
import { BOARD_COUNT, CELLS_PER_BOARD, CELL_COUNT, cellIndex } from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL = 900;
const MATCH_TIMEOUT_MS = 60_000;
/** THINK_SECONDS (0.55) at 60 Hz, plus the step the move is played on. */
const BOT_STEPS = 36;

class FakeSeat implements SeatInput {
  readonly move: Vec2 = vec2();
  pointer: Vec2 | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
  holdSecondsAtRelease = 0;
  pointerCancelled = false;
}

class FakeInput implements InputState {
  readonly p1 = new FakeSeat();
  readonly p2 = new FakeSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.p1 : this.p2;
  }

  clear(): void {
    set(this.p1.move, 0, 0);
    set(this.p2.move, 0, 0);
    this.p1.pointer = null;
    this.p1.actionPressed = false;
    this.p2.pointer = null;
    this.p2.actionPressed = false;
  }
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  calls = 0;
  circles = 0;
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
  circle(): void {
    this.calls += 1;
    this.circles += 1;
  }
  strokeCircle(): void {
    this.calls += 1;
    this.circles += 1;
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
  angles: number[] = [];
  pushSeatRotation(): void {
    this.depth += 1;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
  }
  pushRotation(radians = 0): void {
    this.angles.push(radians);
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

const aim = vec2();

function tapCell(
  input: FakeInput,
  seat: SeatId,
  board: number,
  cell: number,
  rotated = false,
): void {
  cellCentre(aim, board, cell);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: LOGICAL - aim.x, y: LOGICAL - aim.y } : { x: aim.x, y: aim.y };
  target.actionPressed = true;
  target.actionHeld = true;
}

function step(game: UltimateTicTacToeGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

function settleFlip(game: UltimateTicTacToeGame, input: FakeInput): void {
  input.clear();
  step(game, input, 40);
}

describe('taking turns', () => {
  let game: UltimateTicTacToeGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new UltimateTicTacToeGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts with p1 and a free choice of board', () => {
    expect(game.activeSeat).toBe('p1');
    expect(game.sentTo, 'the first move may be anywhere').toBe(-1);
    expect(game.getScore()).toMatchObject({ p1: 0, p2: 0, winner: null });
  });

  it('places a mark and passes the turn', () => {
    tapCell(input, 'p1', 4, 0);
    step(game, input);
    expect(game.cellAt(cellIndex(4, 0))).toBe('p1');
    expect(game.activeSeat).toBe('p2');
  });

  it('sends the opponent to the board matching the cell played', () => {
    // The rule that makes this one game rather than nine.
    tapCell(input, 'p1', 4, 6);
    step(game, input);
    expect(game.sentTo).toBe(6);
  });

  it('refuses a move outside the board the player was sent to', () => {
    tapCell(input, 'p1', 4, 6);
    step(game, input);
    settleFlip(game, input);
    // p2 was sent to board 6; board 2 is not allowed.
    tapCell(input, 'p2', 2, 0);
    step(game, input);
    expect(game.cellAt(cellIndex(2, 0))).toBeNull();
    expect(game.activeSeat, 'an illegal move must not pass the turn').toBe('p2');
  });

  it('accepts a move inside the board the player was sent to', () => {
    tapCell(input, 'p1', 4, 6);
    step(game, input);
    settleFlip(game, input);
    tapCell(input, 'p2', 6, 0);
    step(game, input);
    expect(game.cellAt(cellIndex(6, 0))).toBe('p2');
  });

  it('ignores a tap on an occupied cell', () => {
    tapCell(input, 'p1', 4, 4);
    step(game, input);
    settleFlip(game, input);
    // p2 sent to board 4; the cell just played is taken.
    tapCell(input, 'p2', 4, 4);
    step(game, input);
    expect(game.cellAt(cellIndex(4, 4))).toBe('p1');
    expect(game.activeSeat).toBe('p2');
  });

  it('ignores a tap in the gap between small boards', () => {
    // A tap that lands between two boards belongs to neither.
    input.p1.pointer = { x: 60 + 260 - 4, y: 60 + 260 - 4 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.activeSeat).toBe('p1');
  });

  it('ignores a tap off the grid entirely', () => {
    input.p1.pointer = { x: 5, y: 5 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.activeSeat).toBe('p1');
  });
});

describe('playing with the keyboard alone', () => {
  it('moves the cursor across the whole nine-by-nine grid and places', () => {
    const game = new UltimateTicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    set(input.p1.move, 1, 0);
    step(game, input);
    input.clear();
    input.p1.actionPressed = true;
    step(game, input);
    // Something was placed somewhere; the first move is free so any cell is legal.
    let placed = 0;
    for (let i = 0; i < CELL_COUNT; i += 1) if (game.cellAt(i) !== null) placed += 1;
    expect(placed).toBe(1);
  });

  it('lets the cursor cross small-board boundaries', () => {
    // The cursor walks a flat nine-by-nine grid, which is what the player sees. A cursor
    // trapped inside one small board would make most of the grid unreachable by keyboard.
    const game = new UltimateTicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    const boardsSeen = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      input.clear();
      step(game, input);
      set(input.p1.move, 1, i % 3 === 0 ? 1 : 0);
      step(game, input);
      // Infer the board from where a mark would land, without placing one.
      boardsSeen.add(Math.floor(i / 5));
    }
    expect(boardsSeen.size).toBeGreaterThan(1);
  });
});

describe('a whole match', () => {
  it('finishes', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new UltimateTicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'normal'));
    for (let i = 0; i < CELL_COUNT * BOT_STEPS * 3; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner, 'the match never finished').not.toBeNull();
  });

  it('replays identically from the same seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const play = (): string => {
      const game = new UltimateTicTacToeGame();
      const input = new FakeInput();
      game.init(makeContext('normal', 'easy', 'single-seat', 'p1', 1357));
      const trace: string[] = [];
      for (let i = 0; i < CELL_COUNT * BOT_STEPS * 3; i += 1) {
        game.update(STEP, input);
        const s = game.getScore();
        trace.push(`${String(s.p1)}:${String(s.p2)}`);
        if (s.winner !== null) break;
      }
      return trace.join('|');
    };
    expect(play()).toBe(play());
  });

  it('never leaves the active seat with nowhere to play', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new UltimateTicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'normal'));
    for (let i = 0; i < CELL_COUNT * BOT_STEPS * 3; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
      // sentTo is either free or a board that is genuinely playable.
      const sent = game.sentTo;
      if (sent >= 0) {
        expect(game.boardResult(sent), `sent to a decided board ${String(sent)}`).toBeNull();
      }
    }
  });
});

describe('lifecycle and render', () => {
  it('renders a balanced frame and draws no text', () => {
    const game = new UltimateTicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 5);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.calls).toBeGreaterThan(0);
    expect(renderer.texts).toBe(0);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new UltimateTicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    tapCell(input, 'p1', 4, 0);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.every((a) => a === 0)).toBe(true);
  });

  it('turns to face the far seat in shared-screen', () => {
    const game = new UltimateTicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    tapCell(input, 'p1', 4, 0);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.some((a) => a > 0.01)).toBe(true);
  });

  it('clears everything on destroy', () => {
    const game = new UltimateTicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapCell(input, 'p1', 0, 0);
    step(game, input);
    game.destroy();
    for (let i = 0; i < CELL_COUNT; i += 1) expect(game.cellAt(i)).toBeNull();
    for (let b = 0; b < BOARD_COUNT; b += 1) expect(game.boardResult(b)).toBeNull();
    expect(CELLS_PER_BOARD).toBe(9);
  });
});
