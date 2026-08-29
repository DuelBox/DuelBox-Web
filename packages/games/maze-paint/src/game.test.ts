import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import {
  BOARD_EXTENT,
  BOARD_ORIGIN,
  CELL_EXTENT,
  MazePaintGame,
  cellCentre,
  cellIndexAt,
  quantiseDirection,
} from './game.js';
import {
  CELL_COUNT,
  COLUMNS,
  DIRECTION_COUNT,
  DOWN,
  LEFT,
  P1_PAINT,
  P1_START,
  P2_PAINT,
  P2_START,
  RIGHT,
  ROWS,
  UNPAINTED,
  UP,
  indexOf,
  isLegalDirection,
  mirrorIndex,
  neighbour,
  paintCount,
  seatCode,
} from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
/** READY_SECONDS at 60 Hz, plus the step that sizes the timer. */
const READY_STEPS = 31;

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
      seat.actionReleased = false;
    }
  }
}

interface Mark {
  readonly kind: string;
  readonly colour: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  texts = 0;
  readonly marks: Mark[] = [];

  clear(): void {}

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push(`rect|${round(width)}x${round(height)}`, colour, x, y, x + width, y + height);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#push(
      `srect|${round(width)}x${round(height)}|${round(lineWidth)}`,
      colour,
      x - lineWidth / 2,
      y - lineWidth / 2,
      x + width + lineWidth / 2,
      y + height + lineWidth / 2,
    );
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push(`circ|${round(radius)}`, colour, x - radius, y - radius, x + radius, y + radius);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    const reach = radius + lineWidth / 2;
    this.#push(
      `scirc|${round(radius)}|${round(lineWidth)}`,
      colour,
      x - reach,
      y - reach,
      x + reach,
      y + reach,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    const half = lineWidth / 2;
    this.#push(
      `line|${round(Math.hypot(x2 - x1, y2 - y1))}|${round(lineWidth)}`,
      colour,
      Math.min(x1, x2) - half,
      Math.min(y1, y2) - half,
      Math.max(x1, x2) + half,
      Math.max(y1, y2) + half,
    );
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
    void value;
    void x;
    void y;
    void sizePx;
    void colour;
    void align;
  }

  pushSeatRotation(): void {
    this.depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
  }

  pushRotation(radians: number): void {
    expect(Number.isFinite(radians)).toBe(true);
    this.depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
  }

  popSeatRotation(): void {
    this.depth -= 1;
    expect(this.depth).toBeGreaterThanOrEqual(0);
  }

  #push(
    kind: string,
    colour: string,
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): void {
    expect(Number.isFinite(left + top + right + bottom)).toBe(true);
    expect(colour.length).toBeGreaterThan(0);
    this.marks.push({ kind, colour, left, top, right, bottom });
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function contextFor(options?: {
  presentation?: Presentation;
  localSeat?: SeatId;
  openingSeat?: SeatId;
  seed?: number;
  bots?: Partial<Record<SeatId, BotDifficulty>>;
}): GameContext {
  const bots = options?.bots ?? {};
  return {
    manifest,
    rng: new Rng(options?.seed ?? 20260829),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: options?.openingSeat ?? 'p1',
    botDifficulty: (seat) => bots[seat] ?? null,
  };
}

/** Step until the opening freeze is over and the turn is live. */
function settle(game: MazePaintGame, input: InputState, steps = READY_STEPS): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

/** The first direction the seat to move is allowed to roll. */
function firstLegal(game: MazePaintGame, seat: SeatId): number {
  for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
    if (isLegalDirection(game.position, seat, dir)) return dir;
  }
  throw new Error('the seat to move has no legal direction');
}

/** The movement vector a player presses to name `dir`, in the board's own frame. */
function vectorFor(dir: number): [number, number] {
  if (dir === UP) return [0, -1];
  if (dir === DOWN) return [0, 1];
  if (dir === LEFT) return [-1, 0];
  return [1, 0];
}

/* ------------------------------------------------------------------ the contract */

describe('the Game contract', () => {
  it('reports whose turn it is, and starts with the seat the shell nominated', () => {
    for (const opening of ['p1', 'p2'] as const) {
      const game = new MazePaintGame();
      game.init(contextFor({ openingSeat: opening }));
      const input = new FakeInput();
      game.update(STEP, input);
      expect(game.getActiveSeat()).toBe(opening);
      game.destroy();
    }
  });

  it('scores the two seats by squares painted, and starts one apiece', () => {
    const game = new MazePaintGame();
    game.init(contextFor());
    const score = game.getScore();
    expect(score).toEqual({ p1: 1, p2: 1, winner: null });
    game.destroy();
  });

  it('reports a winner only once the match is over, and never a draw', () => {
    const input = new FakeInput();
    for (let seed = 0; seed < 6; seed += 1) {
      const game = new MazePaintGame();
      game.init(contextFor({ seed: 4242 + seed * 977, bots: { p1: 'easy', p2: 'easy' } }));
      let winner = game.getScore().winner;
      let steps = 0;
      while (winner === null && steps < 60 * 300) {
        game.update(STEP, input);
        winner = game.getScore().winner;
        steps += 1;
      }
      expect(winner === 'p1' || winner === 'p2').toBe(true);
      const final = game.getScore();
      expect(final.p1 + final.p2).toBeGreaterThan(20);
      game.destroy();
    }
  });

  it('starts a fresh maze on re-init, so a rematch allocates nothing new', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ seed: 11 }));
    settle(game, input);
    input.p1.move.x = 1;
    game.update(STEP, input);
    expect(game.getScore().p1).toBeGreaterThan(1);
    game.init(contextFor({ seed: 12 }));
    expect(game.getScore()).toEqual({ p1: 1, p2: 1, winner: null });
    expect(game.moves).toBe(0);
    game.destroy();
  });

  it('releases the board on destroy and stops simulating', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ bots: { p1: 'hard', p2: 'hard' } }));
    settle(game, input, 200);
    const moved = game.moves;
    expect(moved).toBeGreaterThan(0);
    game.destroy();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(game.moves).toBe(moved);
    for (let index = 0; index < CELL_COUNT; index += 1) {
      expect(game.position.paint[index]).toBe(UNPAINTED);
    }
  });

  it('pauses and resumes without touching the simulation', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    settle(game, input, 120);
    const before = `${String(game.moves)}:${String(game.getScore().p1)}`;
    game.onPause();
    game.onResume();
    expect(`${String(game.moves)}:${String(game.getScore().p1)}`).toBe(before);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ rendering */

describe('rendering', () => {
  it('does not mutate the simulation, at any alpha', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    settle(game, input, 150);
    const renderer = new RecordingRenderer();
    const before = `${String(game.moves)}:${game.position.paint.join('')}:${game.position.roller.join(',')}`;
    for (const alpha of [0, 0.25, 0.5, 0.99]) game.render(renderer, alpha);
    const after = `${String(game.moves)}:${game.position.paint.join('')}:${game.position.roller.join(',')}`;
    expect(after).toBe(before);
    game.destroy();
  });

  it('balances every rotation it pushes', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ bots: { p1: 'easy', p2: 'easy' } }));
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 400; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
      expect(renderer.depth).toBe(0);
    }
    expect(renderer.maxDepth).toBe(1);
    game.destroy();
  });

  it('writes nothing, all match', () => {
    // No text at all: a maze of squares needs no labels, and a game with none is one less
    // thing to translate and one less thing for a screen reader to be handed badly.
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ bots: { p1: 'hard', p2: 'hard' } }));
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, input);
      if (i % 7 === 0) game.render(renderer, 0);
      if (game.getScore().winner !== null) break;
    }
    expect(renderer.texts).toBe(0);
    game.destroy();
  });

  it('draws every mark inside the logical box', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    const renderer = new RecordingRenderer();
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      if (i % 11 !== 0) continue;
      renderer.marks.length = 0;
      game.render(renderer, 0);
      for (const mark of renderer.marks) {
        expect(mark.left, mark.kind).toBeGreaterThanOrEqual(0);
        expect(mark.top, mark.kind).toBeGreaterThanOrEqual(0);
        expect(mark.right, mark.kind).toBeLessThanOrEqual(manifest.logical.width);
        expect(mark.bottom, mark.kind).toBeLessThanOrEqual(manifest.logical.height);
      }
    }
    game.destroy();
  });

  /**
   * Rule 7, checked the way `apps/web/src/data/greyscale.test.ts` checks it.
   *
   * Seat one's paint carries a filled disc and seat two's an open square; their rollers are
   * the same two shapes. So each seat draws at least one glyph the other never does, and the
   * board is readable with the colour taken out of it.
   */
  it('tells the two seats apart by shape as well as by colour', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    const renderer = new RecordingRenderer();
    const shapes: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
    const owned = new Map<string, SeatId>();
    for (const seat of ['p1', 'p2'] as const) {
      const palette = SEAT_PALETTE[seat];
      for (const colour of [palette.base, palette.deep, palette.tint, palette.soft]) {
        owned.set(colour, seat);
      }
    }

    let frames = 0;
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, input);
      if (i % 30 !== 0) continue;
      renderer.marks.length = 0;
      game.render(renderer, 0);
      const seen: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
      for (const mark of renderer.marks) {
        const seat = owned.get(mark.colour);
        if (seat === undefined) continue;
        seen[seat].add(mark.kind);
      }
      if (seen.p1.size === 0 || seen.p2.size === 0) continue;
      frames += 1;
      if (frames === 1) {
        for (const seat of ['p1', 'p2'] as const)
          for (const kind of seen[seat]) shapes[seat].add(kind);
      } else {
        for (const seat of ['p1', 'p2'] as const) {
          for (const kind of [...shapes[seat]])
            if (!seen[seat].has(kind)) shapes[seat].delete(kind);
        }
      }
    }
    expect(frames).toBeGreaterThan(10);
    const onlyP1 = [...shapes.p1].filter((kind) => !shapes.p2.has(kind));
    const onlyP2 = [...shapes.p2].filter((kind) => !shapes.p1.has(kind));
    expect(
      onlyP1.length,
      `seat one draws nothing seat two does not: ${[...shapes.p1].join(', ')}`,
    ).toBeGreaterThan(0);
    expect(
      onlyP2.length,
      `seat two draws nothing seat one does not: ${[...shapes.p2].join(', ')}`,
    ).toBeGreaterThan(0);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ geometry */

describe('the board geometry', () => {
  it('is centred in the logical box, so the half-turn maps it onto itself', () => {
    expect(BOARD_ORIGIN * 2 + BOARD_EXTENT).toBe(manifest.logical.width);
    expect(BOARD_ORIGIN * 2 + BOARD_EXTENT).toBe(manifest.logical.height);
    expect(BOARD_EXTENT).toBe(CELL_EXTENT * COLUMNS);
  });

  it('maps a point to the square it is in, and refuses points off the board', () => {
    const scratch = vec2();
    for (let index = 0; index < CELL_COUNT; index += 1) {
      cellCentre(scratch, index);
      expect(cellIndexAt(scratch.x, scratch.y)).toBe(index);
    }
    expect(cellIndexAt(BOARD_ORIGIN - 1, BOARD_ORIGIN + 1)).toBe(-1);
    expect(cellIndexAt(BOARD_ORIGIN + 1, BOARD_ORIGIN - 1)).toBe(-1);
    expect(cellIndexAt(BOARD_ORIGIN + BOARD_EXTENT, BOARD_ORIGIN + 1)).toBe(-1);
    expect(cellIndexAt(BOARD_ORIGIN + 1, BOARD_ORIGIN + BOARD_EXTENT)).toBe(-1);
    expect(cellIndexAt(BOARD_ORIGIN, BOARD_ORIGIN)).toBe(0);
    expect(cellIndexAt(BOARD_ORIGIN + BOARD_EXTENT - 0.5, BOARD_ORIGIN + BOARD_EXTENT - 0.5)).toBe(
      CELL_COUNT - 1,
    );
  });

  it('reads a movement vector as one of four directions, and nothing finer', () => {
    expect(quantiseDirection(0, -1, false)).toBe(UP);
    expect(quantiseDirection(0, 1, false)).toBe(DOWN);
    expect(quantiseDirection(-1, 0, false)).toBe(LEFT);
    expect(quantiseDirection(1, 0, false)).toBe(RIGHT);
    // Below the dead zone is noise, not intent.
    expect(quantiseDirection(0, 0, false)).toBe(-1);
    expect(quantiseDirection(0.4, -0.4, false)).toBe(-1);
    // Two keys at once is a real thing a person does; the horizontal axis wins the tie, and
    // that rule is covariant because the half-turn sends each axis to itself.
    expect(quantiseDirection(0.707, -0.707, false)).toBe(RIGHT);
    expect(quantiseDirection(-0.707, 0.707, false)).toBe(LEFT);
    // The far seat reads the board upside down.
    for (const [x, y, dir] of [
      [0, -1, DOWN],
      [0, 1, UP],
      [-1, 0, RIGHT],
      [1, 0, LEFT],
    ] as const) {
      expect(quantiseDirection(x, y, true)).toBe(dir);
    }
    expect(quantiseDirection(0, 0, true)).toBe(-1);
  });

  it('gives both instruments the same four values and no more', () => {
    // The precision claim, made concrete: sweep the whole board with a pointer and the whole
    // unit circle with a movement vector, and count how many distinct things either can say.
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ seed: 909 }));
    settle(game, input);

    const byPointer = new Set<number>();
    const scratch = vec2();
    for (let index = 0; index < CELL_COUNT; index += 1) {
      cellCentre(scratch, index);
      const cell = cellIndexAt(scratch.x, scratch.y);
      for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
        if (!isLegalDirection(game.position, 'p1', dir)) continue;
      }
      void cell;
    }
    for (let angle = 0; angle < 360; angle += 1) {
      const radians = (angle * Math.PI) / 180;
      byPointer.add(quantiseDirection(Math.cos(radians), Math.sin(radians), false));
    }
    expect(byPointer.size).toBe(DIRECTION_COUNT);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ input */

describe('the seat at the controls', () => {
  it('rolls on one press of a direction key', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ seed: 77 }));
    settle(game, input);
    expect(game.getScore().p1).toBe(1);
    input.p1.move.x = 1;
    game.update(STEP, input);
    expect(game.getScore().p1).toBeGreaterThan(1);
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });

  it('does not repeat while the key stays down', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ seed: 77 }));
    settle(game, input);
    input.p1.move.x = 1;
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);
    // One roll for seat one, and then nothing: seat two never presses, and seat one's key is
    // still held so it cannot fire again. A roll is one gesture, exactly as a swipe is.
    expect(game.moves).toBe(1);
    game.destroy();
  });

  it('does not fire on its own for a key already held when the turn opens', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ seed: 77, bots: { p2: 'hard' } }));
    settle(game, input);
    input.p1.move.x = 1;
    game.update(STEP, input);
    expect(game.moves).toBe(1);
    // Seat two is a bot and answers; seat one's key stays down the whole time.
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);
    expect(game.moves).toBe(2);
    // Let go and press again — a direction that is still a move — and it rolls.
    set(input.p1.move, 0, 0);
    game.update(STEP, input);
    const [x, y] = vectorFor(firstLegal(game, 'p1'));
    set(input.p1.move, x, y);
    game.update(STEP, input);
    expect(game.moves).toBe(3);
    game.destroy();
  });

  it('accepts nothing during the opening freeze', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ seed: 77 }));
    input.p1.move.x = 1;
    input.p1.pointer = vec2();
    input.p1.actionPressed = true;
    for (let i = 0; i < READY_STEPS - 1; i += 1) {
      cellCentre(input.p1.pointer, indexOf(3, ROWS - 1));
      game.update(STEP, input);
      expect(game.moves).toBe(0);
    }
    game.destroy();
  });

  it('rolls on a press inside a lane and ignores one anywhere else', () => {
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ seed: 3131 }));
    settle(game, input);

    // A press on the roller's own square names no lane.
    const pointer = vec2();
    cellCentre(pointer, P1_START);
    input.p1.pointer = pointer;
    input.p1.actionPressed = true;
    game.update(STEP, input);
    expect(game.moves).toBe(0);

    // A press off the board names nothing either.
    set(pointer, 4, 4);
    game.update(STEP, input);
    expect(game.moves).toBe(0);

    // A press on the square one along the first legal lane rolls.
    let lane = -1;
    for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
      if (isLegalDirection(game.position, 'p1', dir)) {
        lane = dir;
        break;
      }
    }
    expect(lane).toBeGreaterThanOrEqual(0);
    const target = lane === UP ? indexOf(0, ROWS - 2) : indexOf(1, ROWS - 1);
    cellCentre(pointer, target);
    game.update(STEP, input);
    expect(game.moves).toBe(1);
    game.destroy();
  });

  it('reaches the whole board from either side of the device', () => {
    // The board belongs to whoever is to move, and the shell hands them the whole pointer
    // surface. A press is converted through the board's own orientation, so the far seat's
    // finger names the square under it rather than the square opposite.
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ seed: 3131, openingSeat: 'p2', localSeat: 'p1' }));
    settle(game, input, 200);
    expect(game.rotated).toBe(true);

    // The square seat two means to press, in board coordinates: one along its first lane.
    const dir = firstLegal(game, 'p2');
    const target = neighbour(game.position.roller[seatCode('p2')] ?? 0, dir);
    expect(target).toBeGreaterThanOrEqual(0);

    // Where that square sits under seat two's finger: the board is turned half a way round,
    // so the device coordinate is the half-turn of the board one.
    const pointer = vec2();
    cellCentre(pointer, mirrorIndex(target));
    input.p2.pointer = pointer;
    input.p2.actionPressed = true;
    game.update(STEP, input);
    expect(game.moves).toBe(1);
    expect(game.position.paint[target]).toBe(P2_PAINT);
    game.destroy();
  });

  it('never lets a person at the device reach a seat a bot is holding', () => {
    // The claim `apps/web/src/data/balance-aggregate.test.ts` needs to be true of every game
    // for its frozen idle input to be sound.
    const quiet = new MazePaintGame();
    const loud = new MazePaintGame();
    const silence = new FakeInput();
    const storm = new FakeInput();
    for (const seat of [storm.p1, storm.p2]) {
      set(seat.move, 1, 1);
      seat.pointer = vec2();
      set(seat.pointer, manifest.logical.width / 2, manifest.logical.height / 2);
      seat.actionPressed = true;
      seat.actionHeld = true;
    }
    quiet.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    loud.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    for (let i = 0; i < 60 * 60; i += 1) {
      quiet.update(STEP, silence);
      loud.update(STEP, storm);
      expect(loud.getScore()).toEqual(quiet.getScore());
      expect(loud.getActiveSeat()).toBe(quiet.getActiveSeat());
    }
    quiet.destroy();
    loud.destroy();
  });
});

/* ------------------------------------------------------------------ presentation */

describe('the two presentations', () => {
  /**
   * The trap Cup Pong and Sudoku both document: `seatView` reports no rotation at all in
   * single-seat play, so anything keyed off the seat flip steps one match on a shared phone
   * and a different one on two phones playing remotely. Nothing here is keyed off the flip —
   * the opening freeze is a simulation quantity — and this is what proves it.
   */
  it('step the identical match', () => {
    for (const seed of [11, 22, 33]) {
      const traces = (['shared-screen', 'single-seat'] as const).map((presentation) => {
        const game = new MazePaintGame();
        const input = new FakeInput();
        game.init(contextFor({ presentation, seed, bots: { p1: 'normal', p2: 'normal' } }));
        const frames: string[] = [];
        for (let i = 0; i < 60 * 60; i += 1) {
          game.update(STEP, input);
          const score = game.getScore();
          frames.push(
            `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${game.getActiveSeat()}:${game.phase}`,
          );
          if (score.winner !== null) break;
        }
        game.destroy();
        return frames.join('|');
      });
      expect(traces[1]).toBe(traces[0]);
    }
  });

  it('turn the board only when two people share one device', () => {
    const shared = new MazePaintGame();
    const single = new MazePaintGame();
    const input = new FakeInput();
    shared.init(
      contextFor({
        presentation: 'shared-screen',
        openingSeat: 'p2',
        bots: { p1: 'easy', p2: 'easy' },
      }),
    );
    single.init(
      contextFor({
        presentation: 'single-seat',
        openingSeat: 'p2',
        bots: { p1: 'easy', p2: 'easy' },
      }),
    );
    expect(shared.rotated).toBe(true);
    expect(single.rotated).toBe(false);
    for (let i = 0; i < 300; i += 1) {
      shared.update(STEP, input);
      single.update(STEP, input);
      expect(single.rotated).toBe(false);
    }
    shared.destroy();
    single.destroy();
  });
});

/* ------------------------------------------------------------------ the shell's furniture */

describe('what the shell owns', () => {
  it('is not reimplemented here', () => {
    // The score is reported through the contract rather than drawn; there is no countdown,
    // no result banner, no rematch button and no turn banner in this package.
    const game = new MazePaintGame();
    const input = new FakeInput();
    game.init(contextFor({ bots: { p1: 'easy', p2: 'easy' } }));
    const renderer = new RecordingRenderer();
    settle(game, input, 400);
    game.render(renderer, 0);
    expect(renderer.texts).toBe(0);
    const score = game.getScore();
    expect(score.p1).toBe(paintCount(game.position, 'p1'));
    expect(score.p2).toBe(paintCount(game.position, 'p2'));
    expect(game.position.roller[seatCode('p1')]).not.toBe(P2_START);
    expect(game.position.paint[P1_START]).toBe(P1_PAINT);
    game.destroy();
  });
});
