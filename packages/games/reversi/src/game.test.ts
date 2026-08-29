import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { ReversiGame, cellCentre } from './game.js';
import { CELL_COUNT, indexOf, tallyOf } from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL = 900;
/** THINK_SECONDS (0.5) at 60 Hz, plus the step the move is played on. */
const BOT_STEPS = 32;

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

function tapCell(input: FakeInput, seat: SeatId, index: number, rotated = false): void {
  cellCentre(aim, index);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: LOGICAL - aim.x, y: LOGICAL - aim.y } : { x: aim.x, y: aim.y };
  target.actionPressed = true;
  target.actionHeld = true;
}

function step(game: ReversiGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** Runs the seat flip out with nothing pressed, so a tap lands on a settled board. */
function settleFlip(game: ReversiGame, input: FakeInput): void {
  input.clear();
  step(game, input, 40);
}

function boardOf(game: ReversiGame): (SeatId | null)[] {
  const cells: (SeatId | null)[] = [];
  for (let i = 0; i < CELL_COUNT; i += 1) cells.push(game.cellAt(i));
  return cells;
}

describe('taking turns', () => {
  let game: ReversiGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ReversiGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts with p1 and the four opening pieces', () => {
    expect(game.activeSeat).toBe('p1');
    expect(game.cellAt(indexOf(3, 3))).toBe('p2');
    expect(game.cellAt(indexOf(3, 4))).toBe('p1');
    expect(game.getScore()).toMatchObject({ p1: 2, p2: 2, winner: null });
  });

  it('plays a legal move and flips what it flanks', () => {
    tapCell(input, 'p1', indexOf(3, 2));
    step(game, input);
    expect(game.cellAt(indexOf(3, 2))).toBe('p1');
    expect(game.cellAt(indexOf(3, 3)), 'the flanked piece must flip').toBe('p1');
    expect(game.activeSeat).toBe('p2');
  });

  it('ignores a tap on a square that flanks nothing', () => {
    const before = boardOf(game);
    tapCell(input, 'p1', indexOf(0, 0));
    step(game, input);
    expect(boardOf(game)).toEqual(before);
    expect(game.activeSeat, 'an illegal move must not pass the turn').toBe('p1');
  });

  it('ignores a tap on an occupied square', () => {
    tapCell(input, 'p1', indexOf(3, 3));
    step(game, input);
    expect(game.activeSeat).toBe('p1');
  });

  it('ignores a tap off the board entirely', () => {
    input.p1.pointer = { x: 5, y: 5 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.activeSeat).toBe('p1');
  });

  it('always passes the turn on a legal move, unlike Dots and Boxes', () => {
    // A Reversi move never grants another turn however many pieces it flips.
    tapCell(input, 'p1', indexOf(3, 2));
    step(game, input);
    expect(game.activeSeat).toBe('p2');
  });
});

describe('playing with the keyboard alone', () => {
  it('moves a cursor and places with the action, with no pointer at all', () => {
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    // The cursor starts at index 27 — (3,3) — so one step up reaches (3,2), a legal
    // opening move for p1.
    set(input.p1.move, 0, -1);
    step(game, input);
    input.clear();
    input.p1.actionPressed = true;
    step(game, input);

    expect(game.cellAt(indexOf(3, 2))).toBe('p1');
  });

  it('keeps the cursor on the board however it is driven', () => {
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (let i = 0; i < 120; i += 1) {
      input.clear();
      step(game, input);
      set(input.p1.move, i % 3 === 0 ? 1 : -1, i % 2 === 0 ? 1 : -1);
      step(game, input);
      expect(game.cursorIndex).toBeGreaterThanOrEqual(0);
      expect(game.cursorIndex).toBeLessThan(CELL_COUNT);
    }
  });
});

describe('passing', () => {
  it('hands the turn over when a seat has no legal move, without ending the game', () => {
    // Driven through a real match rather than a hand-built board: passes arise naturally
    // in Reversi and a fixture risks testing a position that cannot occur.
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));

    let sawBothSeats = false;
    let seen: SeatId = game.activeSeat;
    for (let i = 0; i < CELL_COUNT * BOT_STEPS * 2; i += 1) {
      game.update(STEP, input);
      if (game.activeSeat !== seen) {
        seen = game.activeSeat;
        sawBothSeats = true;
      }
      if (game.getScore().winner !== null) break;
    }
    expect(sawBothSeats).toBe(true);
    expect(game.getScore().winner, 'the match never finished').not.toBeNull();
  });
});

describe('a whole match', () => {
  // Whole matches driven a step at a time are slow by construction; see rules.test.ts.
  const MATCH_TIMEOUT_MS = 60_000;

  it('finishes and every piece belongs to someone', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'normal'));

    for (let i = 0; i < CELL_COUNT * BOT_STEPS * 2; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }

    const score = game.getScore();
    expect(score.winner, 'the match never finished').not.toBeNull();
    const occupied = boardOf(game).filter((cell) => cell !== null).length;
    expect(score.p1 + score.p2).toBe(occupied);
    expect(occupied).toBeGreaterThan(4);
  });

  it('replays identically from the same seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const play = (): string => {
      const game = new ReversiGame();
      const input = new FakeInput();
      game.init(makeContext('hard', 'easy', 'single-seat', 'p1', 31337));
      const trace: string[] = [];
      for (let i = 0; i < CELL_COUNT * BOT_STEPS * 2; i += 1) {
        game.update(STEP, input);
        const s = game.getScore();
        trace.push(`${String(s.p1)}:${String(s.p2)}`);
        if (s.winner !== null) break;
      }
      return trace.join('|');
    };
    expect(play()).toBe(play());
  });

  it('agrees with the rules module about the score', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'normal'));
    for (let i = 0; i < CELL_COUNT * BOT_STEPS * 2; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const cells = boardOf(game);
    const expected = tallyOf(cells);
    expect(game.getScore()).toMatchObject({ p1: expected.p1, p2: expected.p2 });
  });
});

describe('lifecycle and render', () => {
  it('renders a balanced frame and draws no text', () => {
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 5);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.circles).toBeGreaterThan(0);
    // The score and the turn belong to the shell's HUD.
    expect(renderer.texts).toBe(0);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    tapCell(input, 'p1', indexOf(3, 2));
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
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    tapCell(input, 'p1', indexOf(3, 2));
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.some((a) => a > 0.01)).toBe(true);
    expect(renderer.angles[renderer.angles.length - 1]).toBeCloseTo(Math.PI, 5);
  });

  it('reads the far seat tap in the rotated frame it was drawn in', () => {
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));

    tapCell(input, 'p1', indexOf(3, 2));
    step(game, input);
    expect(game.cellAt(indexOf(3, 2))).toBe('p1');

    // p2 sits opposite: the board is turned, so the device point diagonally opposite is
    // the one that must land on the square.
    settleFlip(game, input);
    tapCell(input, 'p2', indexOf(2, 2), true);
    step(game, input);
    expect(game.cellAt(indexOf(2, 2))).toBe('p2');
  });

  it('restores the opening position on destroy', () => {
    const game = new ReversiGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapCell(input, 'p1', indexOf(3, 2));
    step(game, input);
    game.destroy();
    expect(game.getScore()).toMatchObject({ p1: 2, p2: 2 });
  });
});
