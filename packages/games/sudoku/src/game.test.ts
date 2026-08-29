import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { SudokuGame, slotCentre, slotIndexAt } from './game.js';
import { CELL_COUNT, SIZE, UNIT_COUNT, candidateMask, isAllowed, isOver } from './rules.js';
import type { BotDifficulty, MatchState } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL_WIDTH = manifest.logical.width;
const LOGICAL_HEIGHT = manifest.logical.height;
/** READY_SECONDS at 60 Hz, with a frame in hand. */
const READY_STEPS = 32;
/** Ready plus BOT_THINK_SECONDS plus the step the answer lands on. */
const BOT_TURN_STEPS = 54;
/** A whole match: 54 answers at about 85 steps each, plus the settle. */
const MATCH_STEPS = 6000;
const MATCH_TIMEOUT_MS = 60_000;

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
    for (const seat of [this.p1, this.p2]) {
      set(seat.move, 0, 0);
      seat.pointer = null;
      seat.actionPressed = false;
      seat.actionHeld = false;
    }
  }
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  calls = 0;
  texts = 0;
  circles = 0;
  angles: number[] = [];
  readonly numbers: number[] = [];

  /** Every drawn number, and a colour that must actually be a colour. */
  #note(colour: string, ...values: number[]): void {
    this.calls += 1;
    expect(colour.length, 'every draw needs a colour').toBeGreaterThan(0);
    for (const value of values) this.numbers.push(value);
  }

  clear(colour: string): void {
    this.#note(colour);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#note(colour, x, y, width, height);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#note(colour, x, y, width, height, lineWidth);
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.circles += 1;
    this.#note(colour, x, y, radius);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.circles += 1;
    this.#note(colour, x, y, radius, lineWidth);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#note(colour, x1, y1, x2, y2, lineWidth);
  }

  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.texts += 1;
    this.#note(colour, x, y, sizePx);
    expect(value.length).toBeGreaterThan(0);
    expect(Number.isFinite(x + y + sizePx)).toBe(true);
    expect(align === undefined || align.length > 0).toBe(true);
  }

  pushSeatRotation(rotated: boolean): void {
    this.angles.push(rotated ? Math.PI : 0);
    this.depth += 1;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
  }

  pushRotation(radians: number): void {
    this.angles.push(radians);
    this.depth += 1;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
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
  seed = 4242,
  openingSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat,
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1Bot : p2Bot),
  };
}

function step(game: SudokuGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

const aim = vec2();

function tapSlot(input: FakeInput, seat: SeatId, slot: number, rotated = false): void {
  slotCentre(aim, slot);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated
    ? { x: LOGICAL_WIDTH - aim.x, y: LOGICAL_HEIGHT - aim.y }
    : { x: aim.x, y: aim.y };
  target.actionPressed = true;
  target.actionHeld = true;
}

/** One tap, then a clean frame, so `actionPressed` is the edge it is meant to be. */
function tap(
  game: SudokuGame,
  input: FakeInput,
  seat: SeatId,
  slot: number,
  rotated = false,
): void {
  input.clear();
  tapSlot(input, seat, slot, rotated);
  step(game, input);
  input.clear();
  step(game, input);
}

function firstAllowed(state: MatchState): number {
  for (let index = 0; index < CELL_COUNT; index += 1) if (isAllowed(state, index)) return index;
  return -1;
}

/** The pad key for the lowest digit the chosen square may hold. */
function firstLegalKey(state: MatchState, cell: number): number {
  const mask = candidateMask(state.cells, cell);
  for (let digit = 1; digit <= SIZE; digit += 1) {
    if ((mask & (1 << (digit - 1))) !== 0) return CELL_COUNT + digit - 1;
  }
  return -1;
}

describe('the geometry the input and the renderer share', () => {
  it('round-trips every slot through its centre', () => {
    const point = vec2();
    for (let slot = 0; slot < CELL_COUNT + SIZE; slot += 1) {
      slotCentre(point, slot);
      expect(slotIndexAt(point.x, point.y), `slot ${String(slot)}`).toBe(slot);
    }
  });

  it('answers -1 off the grid and in the gap between grid and pad', () => {
    expect(slotIndexAt(-5, 500)).toBe(-1);
    expect(slotIndexAt(500, 5)).toBe(-1);
    expect(slotIndexAt(500, 862)).toBe(-1); // the gap
    expect(slotIndexAt(500, 995)).toBe(-1); // below the pad
    expect(slotIndexAt(890, 500)).toBe(-1);
  });

  it('keeps everything it draws inside the declared box', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 200; i += 1) {
      step(game, input);
      game.render(renderer, 0);
    }
    const limit = Math.max(LOGICAL_WIDTH, LOGICAL_HEIGHT);
    for (const value of renderer.numbers) {
      expect(Math.abs(value)).toBeLessThanOrEqual(limit + 40);
    }
  });
});

describe('taking turns', () => {
  let game: SudokuGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new SudokuGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, READY_STEPS);
  });

  it('opens with the seat the shell nominated, not always p1', () => {
    for (const opener of ['p1', 'p2'] as SeatId[]) {
      const fresh = new SudokuGame();
      fresh.init(makeContext(null, null, 'single-seat', 'p1', 4242, opener));
      expect(fresh.getActiveSeat()).toBe(opener);
    }
  });

  it('takes nothing at all during the ready freeze', () => {
    const fresh = new SudokuGame();
    const clean = new FakeInput();
    fresh.init(makeContext(null, null));
    const cell = firstAllowed(fresh.state);
    tap(fresh, clean, 'p1', cell);
    expect(fresh.selected, 'the freeze must swallow the tap').toBe(-1);
  });

  it('chooses a square, then answers it with a digit', () => {
    const cell = firstAllowed(game.state);
    const before = game.state.blanks;
    tap(game, input, 'p1', cell);
    expect(game.selected).toBe(cell);
    expect(game.state.blanks, 'choosing a square spends nothing').toBe(before);
    expect(game.getActiveSeat(), 'and does not pass the turn').toBe('p1');

    tap(game, input, 'p1', firstLegalKey(game.state, cell));
    expect(game.state.blanks).toBe(before - 1);
    expect(game.state.cells[cell]).not.toBe(0);
    expect(game.getActiveSeat()).toBe('p2');
  });

  it('lets a square be un-chosen by choosing another', () => {
    const first = firstAllowed(game.state);
    let second = -1;
    for (let index = first + 1; index < CELL_COUNT; index += 1) {
      if (isAllowed(game.state, index)) second = index;
    }
    expect(second).toBeGreaterThan(0);
    tap(game, input, 'p1', first);
    expect(game.selected).toBe(first);
    tap(game, input, 'p1', second);
    expect(game.selected).toBe(second);
    expect(game.state.blanks, 'neither choice spent the turn').toBeGreaterThan(0);
  });

  it('ignores a square outside this turn and one already filled', () => {
    const state = game.state;
    let filled = -1;
    let outside = -1;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      if ((state.cells[index] as number) !== 0) filled = index;
      else if (!isAllowed(state, index)) outside = index;
    }
    tap(game, input, 'p1', filled);
    expect(game.selected).toBe(-1);
    if (outside >= 0) {
      tap(game, input, 'p1', outside);
      expect(game.selected).toBe(-1);
    }
  });

  it('refuses a digit already standing in the row, column or box', () => {
    const cell = firstAllowed(game.state);
    tap(game, input, 'p1', cell);
    const mask = candidateMask(game.state.cells, cell);
    let illegalKey = -1;
    for (let digit = 1; digit <= SIZE; digit += 1) {
      if ((mask & (1 << (digit - 1))) === 0) illegalKey = CELL_COUNT + digit - 1;
    }
    expect(illegalKey).toBeGreaterThan(0);
    const before = game.state.blanks;
    tap(game, input, 'p1', illegalKey);
    expect(game.state.blanks, 'a refused digit must not spend the turn').toBe(before);
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('ignores a digit pressed with no square chosen', () => {
    const before = game.state.blanks;
    tap(game, input, 'p1', CELL_COUNT);
    expect(game.state.blanks).toBe(before);
  });

  it('ignores a tap that lands on neither the grid nor the pad', () => {
    input.clear();
    input.p1.pointer = { x: 5, y: 870 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.selected).toBe(-1);
  });
});

describe('playing with the keyboard alone', () => {
  /** Walks the cursor to a slot with directions only, releasing between presses. */
  function cursorTo(game: SudokuGame, input: FakeInput, slot: number): void {
    for (let guard = 0; guard < 200 && game.cursorIndex !== slot; guard += 1) {
      const from = game.cursorIndex;
      const dx = Math.sign((slot % SIZE) - (from % SIZE));
      const dy = Math.sign(Math.floor(slot / SIZE) - Math.floor(from / SIZE));
      input.clear();
      step(game, input);
      set(input.p1.move, dx, dy);
      step(game, input);
    }
    input.clear();
    step(game, input);
  }

  function press(game: SudokuGame, input: FakeInput): void {
    input.clear();
    input.p1.actionPressed = true;
    input.p1.actionHeld = true;
    step(game, input);
    input.clear();
    step(game, input);
  }

  it('reaches a square and a digit with no pointer at all', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, READY_STEPS);

    const cell = firstAllowed(game.state);
    cursorTo(game, input, cell);
    expect(game.cursorIndex).toBe(cell);
    press(game, input);
    expect(game.selected).toBe(cell);

    const key = firstLegalKey(game.state, cell);
    const before = game.state.blanks;
    cursorTo(game, input, key);
    press(game, input);
    expect(game.state.blanks, 'the keyboard could not answer a square').toBe(before - 1);
  });

  it('keeps the cursor inside the grid and the pad however it is driven', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (let i = 0; i < 240; i += 1) {
      input.clear();
      step(game, input);
      set(input.p1.move, i % 3 === 0 ? 1 : -1, i % 2 === 0 ? 1 : -1);
      step(game, input);
      expect(game.cursorIndex).toBeGreaterThanOrEqual(0);
      expect(game.cursorIndex).toBeLessThan(CELL_COUNT + SIZE);
    }
  });
});

describe('the turn clock', () => {
  it('gives the square away when it runs out, and the match moves on', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    const before = game.state.blanks;
    // Ready, then the whole twenty seconds, with nobody touching anything.
    step(game, input, 30 + 60 * 20 + 2);
    expect(game.state.blanks).toBe(before - 1);
    expect(game.getActiveSeat()).toBe('p2');
    expect(game.state.lastDigit, 'a forfeit answers with no digit').toBe(0);
  });

  it('runs down for a person and is not drawn against a bot', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, READY_STEPS);
    const early = game.secondsLeft;
    step(game, input, 120);
    expect(game.secondsLeft).toBeLessThan(early);
    expect(early).toBeLessThanOrEqual(20);
  });

  it('never fires while a bot is thinking, because a bot answers first', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('easy', 'easy'));
    step(game, input, BOT_TURN_STEPS + 2);
    expect(game.state.blanks).toBeLessThan(54);
  });
});

describe('two seats on one device', () => {
  it('reads the far seat tap in the frame the board was drawn in', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    step(game, input, READY_STEPS);

    const first = firstAllowed(game.state);
    tap(game, input, 'p1', first);
    tap(game, input, 'p1', firstLegalKey(game.state, first));
    expect(game.getActiveSeat()).toBe('p2');

    // The board turns for p2, so the device point diagonally opposite is the one that
    // must land on the square. Run past the reveal and the ready freeze first.
    input.clear();
    step(game, input, 110);
    const cell = firstAllowed(game.state);
    tap(game, input, 'p2', cell, true);
    expect(game.selected).toBe(cell);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('easy', 'easy', 'single-seat', 'p1'));
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 200; i += 1) {
      step(game, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.every((angle) => angle === 0)).toBe(true);
  });

  it('turns to face the seat that is to move in shared-screen', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('easy', 'easy', 'shared-screen', 'p1'));
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 200; i += 1) {
      step(game, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.some((angle) => angle > 0.01)).toBe(true);
  });

  it('steps the identical match in both presentations', { timeout: MATCH_TIMEOUT_MS }, () => {
    // The one thing a seat flip must not do is change the simulation. The ready freeze
    // and the turn clock are both counted in the rules rather than off the flip, and
    // this is what checks that they still are.
    const trace = (presentation: Presentation): string => {
      const game = new SudokuGame();
      const input = new FakeInput();
      game.init(makeContext('hard', 'normal', presentation, 'p1', 777));
      const seen: string[] = [];
      for (let i = 0; i < MATCH_STEPS; i += 1) {
        step(game, input);
        const score = game.getScore();
        seen.push(`${String(score.p1)}:${String(score.p2)}:${String(game.getActiveSeat())}`);
        if (score.winner !== null) break;
      }
      return seen.join('|');
    };
    expect(trace('shared-screen')).toBe(trace('single-seat'));
  });
});

describe('a whole match', () => {
  it('finishes, and the score is the units', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'easy'));
    for (let i = 0; i < MATCH_STEPS; i += 1) {
      step(game, input);
      if (game.getScore().winner !== null) break;
    }
    const score = game.getScore();
    expect(score.winner, 'the match never finished').not.toBeNull();
    expect(score.winner).not.toBe('draw');
    expect(isOver(game.state)).toBe(true);
    expect(score.p1 + score.p2).toBe(UNIT_COUNT);
  });

  it('finishes inside ten minutes with the weakest pair', { timeout: MATCH_TIMEOUT_MS }, () => {
    // The pairing the cross-game termination guard uses. Kept here as well so a change
    // that slowed the turn down fails in this package first.
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('easy', 'easy'));
    let steps = -1;
    for (let i = 0; i < 60 * 600; i += 1) {
      step(game, input);
      if (game.getScore().winner !== null) {
        steps = i;
        break;
      }
    }
    expect(steps).toBeGreaterThan(0);
    expect(steps / 60, 'seconds of simulated play').toBeLessThan(180);
  });

  it('replays identically from the same seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const play = (): string => {
      const game = new SudokuGame();
      const input = new FakeInput();
      game.init(makeContext('normal', 'hard', 'single-seat', 'p1', 31337));
      const seen: string[] = [];
      for (let i = 0; i < MATCH_STEPS; i += 1) {
        step(game, input);
        const score = game.getScore();
        seen.push(`${String(score.p1)}:${String(score.p2)}`);
        if (score.winner !== null) break;
      }
      return seen.join('|');
    };
    expect(play()).toBe(play());
  });

  it('plays a different match on a different seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const play = (seed: number): string => {
      const game = new SudokuGame();
      const input = new FakeInput();
      game.init(makeContext('normal', 'normal', 'single-seat', 'p1', seed));
      for (let i = 0; i < MATCH_STEPS; i += 1) {
        step(game, input);
        if (game.getScore().winner !== null) break;
      }
      return game.state.cells.join(',');
    };
    expect(play(1)).not.toBe(play(2));
  });
});

describe('lifecycle and render', () => {
  it('renders a balanced frame with digits on it', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 40);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.calls).toBeGreaterThan(80);
    // Sudoku is digits; unlike the games that draw no text at all, this one has to.
    expect(renderer.texts).toBeGreaterThan(0);
    expect(renderer.circles, 'the unit marks are shapes, not colours').toBeGreaterThan(0);
  });

  it('does not touch the simulation while drawing', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    step(game, input, 120);
    const before = JSON.stringify(game.state);
    const renderer = new RecordingRenderer();
    for (const alpha of [0, 0.25, 0.5, 0.99]) game.render(renderer, alpha);
    expect(JSON.stringify(game.state)).toBe(before);
    expect(game.getScore()).toEqual(game.getScore());
  });

  it('survives pause and resume without moving', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'normal'));
    step(game, input, 100);
    const before = JSON.stringify(game.state);
    game.onPause();
    game.onResume();
    expect(JSON.stringify(game.state)).toBe(before);
  });

  it('starts a fresh match on a second init, with nothing left over', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext('easy', 'easy'));
    step(game, input, 400);
    expect(game.state.blanks).toBeLessThan(54);

    game.init(makeContext('easy', 'easy', 'single-seat', 'p1', 999));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.selected).toBe(-1);
    expect(game.state.squaresP1).toBe(0);
    expect(game.state.squaresP2).toBe(0);
  });

  it('releases the chosen square on destroy', () => {
    const game = new SudokuGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, READY_STEPS);
    tap(game, input, 'p1', firstAllowed(game.state));
    expect(game.selected).toBeGreaterThanOrEqual(0);
    game.destroy();
    expect(game.selected).toBe(-1);
  });

  it('reports an active seat, because the shell decides turn-based from it', () => {
    const game = new SudokuGame();
    game.init(makeContext(null, null));
    expect(typeof game.getActiveSeat).toBe('function');
    expect(game.getActiveSeat()).toBe('p1');
  });
});
