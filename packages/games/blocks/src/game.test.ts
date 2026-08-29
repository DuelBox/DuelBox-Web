import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import {
  BOARD_EXTENT,
  BOARD_X,
  BOARD_Y,
  BlocksGame,
  CELL_EXTENT,
  SLOT_COUNT,
  TRAY_Y,
  slotCentre,
  slotIndexAt,
  traySlotOfCursor,
} from './game.js';
import {
  CELL_COUNT,
  EMPTY,
  MARK_P1,
  MARK_P2,
  PIECES,
  PIECES_PER_MATCH,
  SIZE,
  TRAY_SIZE,
  fitsAt,
  topLeftFor,
} from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const WIDTH = manifest.logical.width;
const HEIGHT = manifest.logical.height;
/** READY_SECONDS (0.5) at 60 Hz. Nothing a person does before this counts. */
const READY_STEPS = 30;
/** READY plus BOT_THINK (0.35), plus the step the move is played on. */
const BOT_TURN_STEPS = 53;

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

interface Mark {
  readonly kind: string;
  readonly colour: string;
  readonly size: number;
  readonly points: readonly number[];
}

class RecordingRenderer implements Renderer {
  readonly marks: Mark[] = [];
  depth = 0;
  texts = 0;
  angles: number[] = [];

  #push(kind: string, colour: string, size: number, points: readonly number[]): void {
    this.marks.push({ kind, colour, size, points });
  }

  clear(colour: string): void {
    this.#push('clear', colour, 0, []);
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push('rect', colour, Math.round(width), [x, y, x + width, y + height]);
  }
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    _w: number,
    colour: string,
  ): void {
    this.#push('strokeRect', colour, Math.round(width), [x, y, x + width, y + height]);
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push('circle', colour, Math.round(radius), [
      x - radius,
      y - radius,
      x + radius,
      y + radius,
    ]);
  }
  strokeCircle(x: number, y: number, radius: number, _w: number, colour: string): void {
    this.#push('strokeCircle', colour, Math.round(radius), [
      x - radius,
      y - radius,
      x + radius,
      y + radius,
    ]);
  }
  line(x1: number, y1: number, x2: number, y2: number, _w: number, colour: string): void {
    this.#push('line', colour, 0, [x1, y1, x2, y2]);
  }
  text(value: string, x: number, y: number, size: number, colour: string, align?: TextAlign): void {
    this.texts += 1;
    void value;
    void align;
    this.#push('text', colour, size, [x, y]);
  }
  pushSeatRotation(): void {
    this.depth += 1;
  }
  pushRotation(radians: number): void {
    this.angles.push(radians);
    this.depth += 1;
  }
  popSeatRotation(): void {
    this.depth -= 1;
  }
}

function makeContext(options?: {
  p1?: BotDifficulty | null;
  p2?: BotDifficulty | null;
  presentation?: Presentation;
  localSeat?: SeatId;
  openingSeat?: SeatId;
  seed?: number;
}): GameContext {
  return {
    manifest,
    rng: new Rng(options?.seed ?? 4321),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: options?.openingSeat ?? 'p1',
    botDifficulty: (seat: SeatId) =>
      seat === 'p1' ? (options?.p1 ?? null) : (options?.p2 ?? null),
  };
}

function step(game: BlocksGame, input: InputState, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

const aim = vec2();

function tap(input: FakeInput, seat: SeatId, slot: number, rotated: boolean): void {
  slotCentre(aim, slot);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: WIDTH - aim.x, y: HEIGHT - aim.y } : { x: aim.x, y: aim.y };
  target.actionPressed = true;
  target.actionHeld = true;
}

/* ------------------------------------------------------------------ the contract */

describe('the contract', () => {
  it('reports a score, no winner while it is running, and whose turn it is', () => {
    const game = new BlocksGame();
    game.init(makeContext());
    const score = game.getScore();
    expect(score).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('opens with the seat the shell nominated, not with p1', () => {
    for (const openingSeat of ['p1', 'p2'] as const) {
      const game = new BlocksGame();
      game.init(makeContext({ openingSeat }));
      expect(game.getActiveSeat()).toBe(openingSeat);
      game.destroy();
    }
  });

  it('releases the board on destroy, and survives being destroyed twice', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    step(game, new FakeInput(), BOT_TURN_STEPS * 3);
    expect([...game.state.board].some((mark) => mark !== EMPTY)).toBe(true);
    game.destroy();
    expect([...game.state.board].every((mark) => mark === EMPTY)).toBe(true);
    expect(game.selectedSlot).toBe(-1);
    game.destroy();
  });

  it('re-initialises cleanly, so a rematch is a fresh match', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    step(game, new FakeInput(), BOT_TURN_STEPS * 4);
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.state.placed).toBe(0);
    expect([...game.state.board].every((mark) => mark === EMPTY)).toBe(true);
    game.destroy();
  });
});

/* --------------------------------------------------------------------- rendering */

describe('rendering', () => {
  it('does not mutate the simulation, at any alpha', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'hard', p2: 'hard' }));
    step(game, new FakeInput(), BOT_TURN_STEPS * 5);
    const before = {
      board: [...game.state.board],
      tray: [...game.state.tray],
      p1: game.state.p1,
      p2: game.state.p2,
      placed: game.state.placed,
      active: game.state.active,
      cursor: game.cursorIndex,
      selected: game.selectedSlot,
    };
    const renderer = new RecordingRenderer();
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.999]) game.render(renderer, alpha);
    expect({
      board: [...game.state.board],
      tray: [...game.state.tray],
      p1: game.state.p1,
      p2: game.state.p2,
      placed: game.state.placed,
      active: game.state.active,
      cursor: game.cursorIndex,
      selected: game.selectedSlot,
    }).toEqual(before);
    game.destroy();
  });

  it('draws no text at all, and balances every rotation it pushes', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    const renderer = new RecordingRenderer();
    const input = new FakeInput();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
      expect(renderer.depth).toBe(0);
    }
    expect(renderer.texts).toBe(0);
    game.destroy();
  });

  it('keeps every mark inside the box the manifest declares', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    const renderer = new RecordingRenderer();
    const input = new FakeInput();
    // A keyboard player, so the cursor and the ghost are drawn too.
    set(input.p1.move, 1, 1);
    for (let i = 0; i < 600; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.marks.length).toBeGreaterThan(1000);
    for (const mark of renderer.marks) {
      for (let i = 0; i < mark.points.length; i += 2) {
        expect(mark.points[i]).toBeGreaterThanOrEqual(0);
        expect(mark.points[i]).toBeLessThanOrEqual(WIDTH);
        expect(mark.points[i + 1]).toBeGreaterThanOrEqual(0);
        expect(mark.points[i + 1]).toBeLessThanOrEqual(HEIGHT);
      }
    }
    game.destroy();
  });

  /**
   * Rule 7, in this package's own terms. Both seats' blocks sit mixed together on one
   * shared board, which is the case the rule was written about, so the check is that the
   * two seats are drawn from *different primitives* rather than the same one twice.
   */
  it('tells the two seats apart by shape, not only by colour', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    const input = new FakeInput();
    const seatOf = new Map<string, SeatId>();
    for (const seat of ['p1', 'p2'] as const) {
      const palette = SEAT_PALETTE[seat];
      for (const colour of [palette.base, palette.deep, palette.tint, palette.soft]) {
        seatOf.set(colour, seat);
      }
    }

    let compared = 0;
    for (let i = 0; i < 2400; i += 1) {
      game.update(STEP, input);
      if (i % 30 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      const glyphs: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
      for (const mark of renderer.marks) {
        const seat = seatOf.get(mark.colour);
        if (seat === undefined) continue;
        glyphs[seat].add(`${mark.kind}@${String(mark.size)}`);
      }
      if (glyphs.p1.size === 0 || glyphs.p2.size === 0) continue;
      compared += 1;
      // Neither seat's set of shapes may be a subset of the other's, or the only thing
      // separating them would be the colour.
      const onlyP1 = [...glyphs.p1].filter((glyph) => !glyphs.p2.has(glyph));
      const onlyP2 = [...glyphs.p2].filter((glyph) => !glyphs.p1.has(glyph));
      expect(
        onlyP1.length,
        `seat one drew nothing seat two does not: ${[...glyphs.p1].join()}`,
      ).toBeGreaterThan(0);
      expect(
        onlyP2.length,
        `seat two drew nothing seat one does not: ${[...glyphs.p2].join()}`,
      ).toBeGreaterThan(0);
    }
    expect(compared, 'both seats were never on screen together').toBeGreaterThan(20);
    game.destroy();
  });
});

/* ---------------------------------------------------------------------- geometry */

describe('the ten-row lattice', () => {
  it('maps every slot to a point and back to itself', () => {
    expect(SLOT_COUNT).toBe(CELL_COUNT + TRAY_SIZE);
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      slotCentre(aim, slot);
      expect(slotIndexAt(aim.x, aim.y)).toBe(slot);
    }
  });

  it('answers -1 off the board and off the tray', () => {
    expect(slotIndexAt(-1, BOARD_Y)).toBe(-1);
    expect(slotIndexAt(BOARD_X + BOARD_EXTENT + 1, BOARD_Y)).toBe(-1);
    expect(slotIndexAt(BOARD_X, BOARD_Y - 1)).toBe(-1);
    expect(slotIndexAt(BOARD_X, BOARD_Y + BOARD_EXTENT + 5)).toBe(-1);
    expect(slotIndexAt(BOARD_X, TRAY_Y - 1)).toBe(-1);
  });

  it('gives each tray shape three whole columns of the cursor grid', () => {
    for (let column = 0; column < SIZE; column += 1) {
      expect(traySlotOfCursor(CELL_COUNT + column)).toBe(Math.floor(column / 3));
    }
  });

  it('puts the board and the tray where the manifest says there is room', () => {
    expect(BOARD_X + BOARD_EXTENT).toBeLessThanOrEqual(WIDTH);
    expect(TRAY_Y).toBeGreaterThan(BOARD_Y + BOARD_EXTENT);
    expect(CELL_EXTENT * SIZE).toBe(BOARD_EXTENT);
  });
});

/* ------------------------------------------------------------------------ input */

describe('taking a turn', () => {
  it('refuses everything through the ready freeze, then accepts', () => {
    const game = new BlocksGame();
    game.init(makeContext());
    const input = new FakeInput();
    const piece = game.state.tray[game.selectedSlot] ?? -1;
    expect(piece).toBeGreaterThanOrEqual(0);
    const target = 4 * SIZE + 4;

    // Everything the player does before the board has settled is dropped.
    for (let i = 0; i < READY_STEPS - 1; i += 1) {
      tap(input, 'p1', target, false);
      game.update(STEP, input);
      input.clear();
    }
    expect(game.state.placed).toBe(0);

    tap(input, 'p1', target, false);
    step(game, input, 2);
    expect(game.state.placed).toBe(1);
    game.destroy();
  });

  it('places the same shape from a key press and from a tap', () => {
    const target = 4 * SIZE + 4;

    const byTap = new BlocksGame();
    byTap.init(makeContext());
    const tapInput = new FakeInput();
    step(byTap, tapInput, READY_STEPS);
    tap(tapInput, 'p1', target, false);
    step(byTap, tapInput, 1);
    tapInput.clear();

    const byKey = new BlocksGame();
    byKey.init(makeContext());
    const keyInput = new FakeInput();
    step(byKey, keyInput, READY_STEPS);
    // The cursor starts on square 40, which is the middle: nudge it there deliberately
    // anyway so the two instruments are being asked for the same square.
    set(keyInput.p1.move, 0, 1);
    step(byKey, keyInput, 1);
    set(keyInput.p1.move, 0, -1);
    step(byKey, keyInput, 1);
    set(keyInput.p1.move, 0, 0);
    keyInput.p1.actionPressed = true;
    step(byKey, keyInput, 1);

    expect([...byKey.state.board]).toEqual([...byTap.state.board]);
    expect(byKey.state.placed).toBe(1);
    byTap.destroy();
    byKey.destroy();
  });

  it('lets a tap on the tray choose a shape without spending the turn', () => {
    const game = new BlocksGame();
    game.init(makeContext());
    const input = new FakeInput();
    step(game, input, READY_STEPS);
    for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
      tap(input, 'p1', CELL_COUNT + slot, false);
      step(game, input, 1);
      input.clear();
      expect(game.selectedSlot).toBe(slot);
      expect(game.state.placed).toBe(0);
    }
    game.destroy();
  });

  it('ignores a square the chosen shape cannot go on', () => {
    const game = new BlocksGame();
    game.init(makeContext());
    const input = new FakeInput();
    step(game, input, READY_STEPS);
    // Choose the widest shape in the tray and aim it at the left edge, where it cannot fit.
    let widest = 0;
    for (let slot = 1; slot < TRAY_SIZE; slot += 1) {
      const here = PIECES[game.state.tray[slot] ?? 0]?.width ?? 0;
      if (here > (PIECES[game.state.tray[widest] ?? 0]?.width ?? 0)) widest = slot;
    }
    tap(input, 'p1', CELL_COUNT + widest, false);
    step(game, input, 1);
    input.clear();
    const piece = game.state.tray[widest] ?? -1;
    if ((PIECES[piece]?.width ?? 1) > 1) {
      tap(input, 'p1', 4 * SIZE, false);
      step(game, input, 1);
      input.clear();
      expect(game.state.placed).toBe(0);
    }
    game.destroy();
  });

  it('starts every turn on a shape that has somewhere to go', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    const input = new FakeInput();
    for (let i = 0; i < 1800; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
      const slot = game.selectedSlot;
      if (slot < 0) continue;
      const piece = game.state.tray[slot] ?? -1;
      if (piece < 0) continue;
      let fits = false;
      for (let cell = 0; cell < CELL_COUNT && !fits; cell += 1) {
        const topLeft = topLeftFor(piece, cell);
        if (topLeft >= 0 && fitsAt(game.state.board, piece, topLeft)) fits = true;
      }
      // The only way a selection can have nowhere to go is if nothing in the tray does,
      // and then the match is over.
      if (!fits) expect(game.getScore().winner).not.toBeNull();
    }
    game.destroy();
  });
});

/* ------------------------------------------------------------------ the two arms */

describe('both presentations step the identical match', () => {
  function trace(presentation: Presentation, localSeat: SeatId): string[] {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'hard', p2: 'normal', presentation, localSeat, seed: 6161 }));
    const input = new FakeInput();
    const seen: string[] = [];
    for (let i = 0; i < 3600; i += 1) {
      game.update(STEP, input);
      const score = game.getScore();
      seen.push(
        `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${game.getActiveSeat()}`,
      );
      if (score.winner !== null) break;
    }
    game.destroy();
    return seen;
  }

  it('gives the same trace on a shared phone and on two phones playing remotely', () => {
    const shared = trace('shared-screen', 'p1');
    expect(trace('single-seat', 'p1')).toEqual(shared);
    expect(trace('single-seat', 'p2')).toEqual(shared);
    expect(trace('shared-screen', 'p2')).toEqual(shared);
    expect(shared.length).toBeGreaterThan(100);
  }, 30_000);
});

/* -------------------------------------------------------------------- the match */

describe('a bot match', () => {
  function run(tier: BotDifficulty, openingSeat: SeatId, seed: number) {
    const game = new BlocksGame();
    game.init(makeContext({ p1: tier, p2: tier, openingSeat, seed }));
    const input = new FakeInput();
    let steps = 0;
    // The cross-game guard allows ten minutes of simulated play; this asserts far less.
    while (game.getScore().winner === null) {
      game.update(STEP, input);
      steps += 1;
      expect(steps).toBeLessThan(60 * 600);
    }
    const score = game.getScore();
    game.destroy();
    return { steps, score };
  }

  it('finishes well inside the ten minutes the cross-game guard allows', () => {
    let worst = 0;
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 4; seed += 1) {
        const { steps, score } = run(tier, seed % 2 === 0 ? 'p1' : 'p2', 200 + seed);
        expect(score.winner).not.toBeNull();
        worst = Math.max(worst, steps);
      }
    }
    // Measured at about 49 simulated seconds for the longest tier; two minutes is a wide
    // band around that and still a fifth of the guard's ceiling.
    expect(worst / 60).toBeLessThan(120);
  }, 60_000);

  /**
   * The balance proof, driven through the real `Game` rather than through the rules.
   *
   * `init` derives one generator for the seat that opens and one for the seat that
   * answers, in that order, so the same seed played from each opening seat is the same
   * match with the two labels exchanged. A paired sample therefore cannot lean either way,
   * which is why the seat-one share in SPEC.md is exactly 50.0%.
   */
  it('plays the mirror-image match when the opening seat is swapped', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 5; seed += 1) {
        const a = run(tier, 'p1', 900 + seed);
        const b = run(tier, 'p2', 900 + seed);
        expect(b.score.p1).toBe(a.score.p2);
        expect(b.score.p2).toBe(a.score.p1);
        expect(b.steps).toBe(a.steps);
        const swap = (winner: SeatId | 'draw' | null): SeatId | 'draw' | null =>
          winner === 'p1' ? 'p2' : winner === 'p2' ? 'p1' : winner;
        expect(b.score.winner).toBe(swap(a.score.winner));
      }
    }
  }, 60_000);

  it('never places more shapes than the box holds', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'hard', p2: 'hard' }));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 300; i += 1) {
      game.update(STEP, input);
      expect(game.state.placed).toBeLessThanOrEqual(PIECES_PER_MATCH);
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).not.toBeNull();
    game.destroy();
  }, 30_000);

  it('never leaves a completed unit standing on the board', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 120; i += 1) {
      game.update(STEP, input);
      if (game.revealing) continue;
      for (let row = 0; row < SIZE; row += 1) {
        let full = true;
        for (let column = 0; column < SIZE; column += 1) {
          if ((game.state.board[row * SIZE + column] ?? EMPTY) === EMPTY) full = false;
        }
        expect(full).toBe(false);
      }
      if (game.getScore().winner !== null) break;
    }
    game.destroy();
  }, 30_000);

  it('marks every block with the seat that placed it', () => {
    const game = new BlocksGame();
    game.init(makeContext({ p1: 'normal', p2: 'normal' }));
    const input = new FakeInput();
    step(game, input, 60 * 20);
    let p1Blocks = 0;
    let p2Blocks = 0;
    for (const mark of game.state.board) {
      if (mark === MARK_P1) p1Blocks += 1;
      else if (mark === MARK_P2) p2Blocks += 1;
    }
    expect(p1Blocks).toBeGreaterThan(0);
    expect(p2Blocks).toBeGreaterThan(0);
    game.destroy();
  });
});
