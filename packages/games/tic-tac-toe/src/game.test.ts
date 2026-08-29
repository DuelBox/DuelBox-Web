import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { TicTacToeGame, cellCentre } from './game.js';
import { CELL_COUNT } from './rules.js';
import type { BotDifficulty, Cell } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL = 900;
/** THINK_SECONDS (0.45) at 60 Hz, plus the step the move is played on. */
const BOT_STEPS = 28;

class FakeSeat implements SeatInput {
  readonly move: Vec2 = vec2();
  pointer: Vec2 | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
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

/** Presses the active-action on a seat, aimed at the centre of a cell as drawn. */
function tapCell(input: FakeInput, seat: SeatId, cell: number, rotated = false): void {
  cellCentre(aim, cell);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: LOGICAL - aim.x, y: LOGICAL - aim.y } : { x: aim.x, y: aim.y };
  target.actionPressed = true;
  target.actionHeld = true;
}

function boardOf(game: TicTacToeGame): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < CELL_COUNT; i += 1) cells.push(game.cellAt(i));
  return cells;
}

function markCount(game: TicTacToeGame): number {
  let count = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (game.cellAt(i) !== null) count += 1;
  }
  return count;
}

function step(game: TicTacToeGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/**
 * Run out the seat flip with no input pressed.
 *
 * The board turns to face whoever has the move, and refuses taps while it is part-way
 * round — the cell under a finger is moving, so a tap would name one the player did not
 * mean. A test that taps the instant the turn changes is testing a board nobody could
 * have aimed at.
 */
function settleFlip(game: TicTacToeGame, input: FakeInput): void {
  input.clear();
  step(game, input, 40);
}

describe('TicTacToeGame turns', () => {
  let game: TicTacToeGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new TicTacToeGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts with p1 on an empty board', () => {
    expect(game.activeSeat).toBe('p1');
    expect(markCount(game)).toBe(0);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('alternates the turn after each accepted mark', () => {
    tapCell(input, 'p1', 0);
    step(game, input);
    expect(game.cellAt(0)).toBe('p1');
    expect(game.activeSeat).toBe('p2');

    input.clear();
    tapCell(input, 'p2', 4);
    step(game, input);
    expect(game.cellAt(4)).toBe('p2');
    expect(game.activeSeat).toBe('p1');

    input.clear();
    tapCell(input, 'p1', 8);
    step(game, input);
    expect(game.cellAt(8)).toBe('p1');
    expect(game.activeSeat).toBe('p2');
  });

  it('ignores the inactive seat entirely', () => {
    tapCell(input, 'p2', 4);
    step(game, input);
    expect(game.cellAt(4)).toBeNull();
    expect(markCount(game)).toBe(0);
    expect(game.activeSeat).toBe('p1');

    // Both seats pressing at once still only lets the active one through.
    input.clear();
    tapCell(input, 'p1', 0);
    tapCell(input, 'p2', 1);
    step(game, input);
    expect(game.cellAt(0)).toBe('p1');
    expect(game.cellAt(1)).toBeNull();
  });

  it('ignores a tap on a taken cell and keeps the turn', () => {
    tapCell(input, 'p1', 0);
    step(game, input);
    input.clear();
    tapCell(input, 'p2', 0);
    step(game, input);
    expect(game.cellAt(0)).toBe('p1');
    expect(game.activeSeat).toBe('p2');
  });

  it('ignores a tap outside the board', () => {
    input.p1.pointer = { x: 20, y: 20 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(markCount(game)).toBe(0);
    expect(game.activeSeat).toBe('p1');
  });

  it('places at the keyboard cursor when a press arrives with no pointer', () => {
    // This used to place nothing, which is what made the game unplayable on a keyboard:
    // a tap names a square directly, so a press without one had nowhere to go. Only a
    // key can raise a press with no pointer — a tap always carries its position — so a
    // press with none is a keyboard press, and it belongs at the cursor.
    input.p1.actionPressed = true;
    step(game, input);
    expect(markCount(game)).toBe(1);
    // The cursor starts in the middle of the board.
    expect(game.cellAt(4)).toBe('p1');
  });

  it('ignores a pointer with no press', () => {
    input.clear();
    cellCentre(aim, 4);
    input.p1.pointer = { x: aim.x, y: aim.y };
    input.p1.actionHeld = true;
    step(game, input);
    expect(markCount(game)).toBe(0);
  });

  it('a held action places one mark, not one per step', () => {
    tapCell(input, 'p1', 4);
    tapCell(input, 'p2', 0);
    step(game, input, 6);
    expect(markCount(game)).toBe(2);
    expect(game.cellAt(4)).toBe('p1');
    expect(game.cellAt(0)).toBe('p2');
    expect(game.activeSeat).toBe('p1');
  });
});

describe('shared-screen rotation', () => {
  it('reads the far seat tap in the rotated frame it was drawn in', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));

    // p1 is local, so its own view is upright.
    tapCell(input, 'p1', 0, false);
    step(game, input);
    expect(game.cellAt(0)).toBe('p1');

    // p2 sits opposite: the board is turned half a turn for its turn, so the device
    // point diagonally opposite cell 8 is the one that must land on cell 8.
    settleFlip(game, input);
    tapCell(input, 'p2', 8, true);
    step(game, input);
    expect(game.cellAt(8)).toBe('p2');
  });

  it('never rotates in single-seat presentation', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    tapCell(input, 'p1', 0);
    step(game, input);
    input.clear();
    tapCell(input, 'p2', 8, false);
    step(game, input);
    expect(game.cellAt(8)).toBe('p2');
  });
});

describe('bot seats', () => {
  it('waits a fixed number of steps before playing', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, 'hard'));

    tapCell(input, 'p1', 4);
    step(game, input);
    input.clear();
    expect(game.activeSeat).toBe('p2');

    step(game, input, BOT_STEPS - 1);
    expect(markCount(game)).toBe(1);
    step(game, input);
    expect(markCount(game)).toBe(2);
    expect(game.activeSeat).toBe('p1');
  });

  it('does not let a human play for a bot seat', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, 'hard'));

    tapCell(input, 'p1', 0);
    step(game, input);
    input.clear();
    tapCell(input, 'p1', 1);
    tapCell(input, 'p2', 2);
    step(game, input, BOT_STEPS - 1);
    expect(markCount(game)).toBe(1);
  });

  it('replays identically from the same seed', () => {
    const first = new TicTacToeGame();
    const second = new TicTacToeGame();
    const input = new FakeInput();
    first.init(makeContext('easy', 'normal', 'single-seat', 'p1', 4242));
    second.init(makeContext('easy', 'normal', 'single-seat', 'p1', 4242));
    for (let i = 0; i < 400; i += 1) {
      first.update(STEP, input);
      second.update(STEP, input);
      expect(boardOf(second)).toEqual(boardOf(first));
    }
    expect(first.getScore()).toEqual(second.getScore());
  });
});

describe('match scoring', () => {
  it('reaches a decided score with two perfect bots', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    step(game, input, 3000);

    const score = game.getScore();
    // Perfect play draws every round, so the match is settled on the round limit.
    expect(score.winner).toBe('draw');
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
  });

  it('reaches a decided score with mismatched bots', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext('easy', 'hard', 'single-seat', 'p1', 777));
    step(game, input, 3000);

    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(score.p1 + score.p2).toBeLessThanOrEqual(5);
  });

  it('stops stepping once the match is decided', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    step(game, input, 3000);
    const settled = boardOf(game);
    const score = game.getScore();

    step(game, input, 600);
    expect(boardOf(game)).toEqual(settled);
    expect(game.getScore()).toEqual(score);
  });

  it('awards a round and starts the next one', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    // p1 takes the top row while p2 answers on the middle one.
    const script: readonly (readonly [SeatId, number])[] = [
      ['p1', 0],
      ['p2', 3],
      ['p1', 1],
      ['p2', 4],
      ['p1', 2],
    ];
    for (const entry of script) {
      input.clear();
      tapCell(input, entry[0], entry[1]);
      step(game, input);
    }
    input.clear();

    expect(game.roundOutcome).toBe('p1');
    expect(game.getScore().p1).toBe(1);
    expect(game.getScore().winner).toBeNull();

    // The settle pause runs on simulation steps, then the board clears for round two.
    step(game, input, 54);
    expect(markCount(game)).toBe(0);
    expect(game.roundOutcome).toBeNull();
    // The starting seat alternates so the first-move advantage does not sit with p1.
    expect(game.activeSeat).toBe('p2');
  });
});

describe('lifecycle and render', () => {
  it('pause and resume leave the position alone', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapCell(input, 'p1', 4);
    step(game, input);
    input.clear();

    const before = boardOf(game);
    game.onPause();
    game.onResume();
    expect(boardOf(game)).toEqual(before);
    expect(game.activeSeat).toBe('p2');
  });

  it('destroy clears the position and the tally', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));
    step(game, input, 3000);
    game.destroy();
    expect(markCount(game)).toBe(0);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('renders a balanced frame and never mutates the position', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    const renderer = new RecordingRenderer();
    game.init(makeContext(null, null));
    tapCell(input, 'p1', 0);
    step(game, input);
    input.clear();
    tapCell(input, 'p2', 4);
    step(game, input);
    input.clear();

    const before = boardOf(game);
    game.render(renderer);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.calls).toBeGreaterThan(0);
    // No text on the board: the score and the turn belong to the shell's HUD, and a
    // game that draws its own gives the player two scoreboards to reconcile.
    expect(renderer.texts).toBe(0);
    expect(boardOf(game)).toEqual(before);
    expect(game.activeSeat).toBe('p1');
  });

  it('strikes the winning line once a round is won', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    const before = new RecordingRenderer();
    const after = new RecordingRenderer();
    game.init(makeContext(null, null));

    game.render(before);
    const script: readonly (readonly [SeatId, number])[] = [
      ['p1', 0],
      ['p2', 3],
      ['p1', 1],
      ['p2', 4],
      ['p1', 2],
    ];
    for (const entry of script) {
      input.clear();
      tapCell(input, entry[0], entry[1]);
      step(game, input);
    }
    game.render(after);

    // Grid lines, both crosses, and one more line for the strike through the top row.
    expect(after.lines).toBeGreaterThan(before.lines);
    expect(after.circles).toBeGreaterThan(before.circles);
    expect(after.depth).toBe(0);
  });
});

describe('the board turning to face the player with the move', () => {
  const HALF_TURN = Math.PI;

  it('sweeps through part-way angles rather than snapping', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));

    tapCell(input, 'p1', 0, false);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer);
    }

    const partway = renderer.angles.filter((a) => a > 0.001 && a < HALF_TURN - 0.001);
    expect(partway.length).toBeGreaterThan(5);
    // And it arrives, rather than resting at an angle nobody can read.
    expect(renderer.angles[renderer.angles.length - 1]).toBeCloseTo(HALF_TURN, 6);
  });

  it('refuses a tap while the board is part-way round', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));

    tapCell(input, 'p1', 0, false);
    step(game, input);

    // p2 taps immediately, while the board is still turning towards them.
    input.clear();
    tapCell(input, 'p2', 8, true);
    step(game, input);
    expect(game.cellAt(8)).toBeNull();

    // Once it has arrived, the same tap lands.
    settleFlip(game, input);
    tapCell(input, 'p2', 8, true);
    step(game, input);
    expect(game.cellAt(8)).toBe('p2');
  });

  it('never accepts a tap unless the board is square on', () => {
    // The criterion in full: input is never mapped through a part-way orientation.
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    tapCell(input, 'p1', 0, false);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      const before = boardOf(game);
      // A tap is pressed on every single step of the turn.
      tapCell(input, 'p2', 4, true);
      game.update(STEP, input);
      game.render(renderer);
      const angle = renderer.angles[renderer.angles.length - 1] ?? 0;
      const squareOn = Math.abs(angle) < 1e-9 || Math.abs(angle - HALF_TURN) < 1e-9;
      const changed = boardOf(game).some((cell, index) => cell !== before[index]);
      if (changed) expect(squareOn, `board changed at angle ${String(angle)}`).toBe(true);
      input.clear();
    }
  });

  it('does not turn at all in single-seat presentation', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    tapCell(input, 'p1', 0, false);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer);
    }
    expect(renderer.angles.every((a) => a === 0)).toBe(true);
  });

  it('steps identically for the same deltas, whatever the frame rate delivered them in', () => {
    const play = (steps: number, dt: number): number => {
      const game = new TicTacToeGame();
      const input = new FakeInput();
      game.init(makeContext(null, null, 'shared-screen', 'p1'));
      tapCell(input, 'p1', 0, false);
      game.update(dt, input);
      input.clear();
      const renderer = new RecordingRenderer();
      for (let i = 0; i < steps; i += 1) {
        game.update(dt, input);
        game.render(renderer);
      }
      return renderer.angles[renderer.angles.length - 1] ?? 0;
    };
    // Same total simulated time, delivered in different-sized steps.
    expect(play(20, 1 / 60)).toBeCloseTo(play(40, 1 / 120), 6);
  });
});

describe('playing with the keyboard alone', () => {
  it('moves a cursor with the direction keys and places with the action', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));

    // From the middle, left then up reaches the top-left corner.
    set(input.p1.move, -1, 0);
    step(game, input);
    set(input.p1.move, 0, 0);
    step(game, input);
    set(input.p1.move, 0, -1);
    step(game, input);
    set(input.p1.move, 0, 0);
    input.p1.actionPressed = true;
    step(game, input);

    expect(game.cellAt(0)).toBe('p1');
  });

  it('is enough to play a whole match with no pointer at all', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));

    // Nine presses with no pointer ever set: the board must fill up.
    for (let i = 0; i < 40 && markCount(game) < 9; i += 1) {
      input.clear();
      set(input.p1.move, -1, -1);
      set(input.p2.move, -1, -1);
      step(game, input);
      input.clear();
      input.p1.actionPressed = true;
      input.p2.actionPressed = true;
      step(game, input);
      input.clear();
      set(input.p1.move, 1, 0);
      set(input.p2.move, 1, 0);
      step(game, input);
    }
    expect(markCount(game)).toBeGreaterThan(0);
  });

  it('leaves the cursor where a tap went, so switching to keys carries on from there', () => {
    const game = new TicTacToeGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));

    tapCell(input, 'p1', 0);
    step(game, input);
    expect(game.cellAt(0)).toBe('p1');

    // p2 now uses keys: one step right from cell 0 is cell 1.
    input.clear();
    set(input.p2.move, 1, 0);
    step(game, input);
    set(input.p2.move, 0, 0);
    input.p2.actionPressed = true;
    step(game, input);
    expect(game.cellAt(1)).toBe('p2');
  });
});
