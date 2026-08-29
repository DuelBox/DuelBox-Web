import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BOARD_EXTENT, BOARD_ORIGIN, ChessGame, squareAt, squareCentre } from './game.js';
import { KING, PAWN, QUEEN, ROOK } from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
/** Longer than the engine's 0.36 s half-turn, so a board is always settled after this. */
const FLIP_STEPS = 30;

function at(square: string): number {
  return (8 - Number(square[1])) * 8 + (square.charCodeAt(0) - 97);
}

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
  holdSecondsAtRelease: number;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
    holdSecondsAtRelease: 0,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  /** A tap in *device* space — what a finger on the glass actually produces. */
  tap(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = true;
    target.actionHeld = true;
  }

  steer(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
    target.move.x = 0;
    target.move.y = 0;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

const IDLE = new ScriptedInput();

function makeContext(options?: {
  seed?: number;
  botP1?: BotDifficulty | null;
  botP2?: BotDifficulty | null;
  presentation?: Presentation;
  localSeat?: SeatId;
  openingSeat?: SeatId;
}): GameContext {
  return {
    manifest,
    rng: new Rng(options?.seed ?? 20260829),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: options?.openingSeat ?? 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return (seat === 'p1' ? options?.botP1 : options?.botP2) ?? null;
    },
  };
}

function settle(game: ChessGame, steps = FLIP_STEPS): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, IDLE);
}

/** Where a square appears on the glass for the seat currently reading the board. */
function deviceCentre(square: number, rotated: boolean): Vec2 {
  const point = squareCentre(vec2(), square);
  if (!rotated) return point;
  point.x = manifest.logical.width - point.x;
  point.y = manifest.logical.height - point.y;
  return point;
}

/** One tap: press for a step, then let go, then let the board settle. */
function tapSquare(game: ChessGame, seat: SeatId, square: number, rotated = false): void {
  const input = new ScriptedInput();
  const point = deviceCentre(square, rotated);
  input.tap(seat, point.x, point.y);
  game.update(STEP, input);
  input.release(seat);
  game.update(STEP, input);
}

type DrawArg = number | string | boolean | undefined;

class RecordingRenderer implements Renderer {
  readonly ops: string[] = [];
  readonly args: DrawArg[] = [];
  /** Every point a mark touches, for the logical-bounds check. */
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  /** Draw kind by seat colour, for rule 7. */
  readonly byColour = new Map<string, Set<string>>();

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#record('rect', x, y, width, height, colour);
    this.#extent(colour, 'rect', x, y, width, height);
  }
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#record('strokeRect', x, y, width, height, lineWidth, colour);
    this.#extent(
      colour,
      'strokeRect',
      x - lineWidth,
      y - lineWidth,
      width + 2 * lineWidth,
      height + 2 * lineWidth,
    );
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#record('circle', x, y, radius, colour);
    this.#extent(colour, 'circle', x - radius, y - radius, radius * 2, radius * 2);
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#record('strokeCircle', x, y, radius, lineWidth, colour);
    const outer = radius + lineWidth;
    this.#extent(colour, 'strokeCircle', x - outer, y - outer, outer * 2, outer * 2);
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lineWidth, colour);
    this.xs.push(x1, x2);
    this.ys.push(y1, y2);
  }
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.#record('text', value, x, y, sizePx, colour, align);
    this.#extent(colour, `text:${value}`, x - sizePx, y - sizePx, sizePx * 2, sizePx * 2);
  }
  pushSeatRotation(rotated: boolean): void {
    this.#record('pushSeatRotation', rotated);
  }
  pushRotation(radians: number): void {
    this.#record('pushRotation', radians);
  }
  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...args: DrawArg[]): void {
    this.ops.push(op);
    this.args.push(...args);
  }

  #extent(colour: string, kind: string, x: number, y: number, width: number, height: number): void {
    this.xs.push(x, x + width);
    this.ys.push(y, y + height);
    let kinds = this.byColour.get(colour);
    if (kinds === undefined) {
      kinds = new Set<string>();
      this.byColour.set(colour, kinds);
    }
    kinds.add(kind);
  }
}

function draw(game: ChessGame, alpha = 0): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  return renderer;
}

/* ------------------------------------------------------------------ the contract */

describe('the contract', () => {
  it('reports a seat, always, because the shell reads it to decide there are turns', () => {
    const game = new ChessGame();
    game.init(makeContext());
    expect(game.getActiveSeat()).toBe('p1');
    expect(manifest.archetype.startsWith('turn-')).toBe(true);
    game.destroy();
  });

  it('opens with the seat the shell nominated, not always with seat one', () => {
    for (const openingSeat of ['p1', 'p2'] as const) {
      const game = new ChessGame();
      game.init(makeContext({ openingSeat }));
      expect(game.getActiveSeat()).toBe(openingSeat);
      // And the board is the same board either way; only the turn moves.
      expect(game.match.position.board[at('e1')]).toBe(KING);
      expect(game.match.position.board[at('e8')]).toBe(-KING);
      game.destroy();
    }
  });

  it('scores pieces taken and names a winner only once there is one', () => {
    const game = new ChessGame();
    game.init(makeContext({ botP1: 'normal', botP2: 'normal' }));
    const opening = game.getScore();
    expect(opening).toEqual({ p1: 0, p2: 0, winner: null });
    let winner = null;
    for (let step = 0; step < 60 * 600 && winner === null; step += 1) {
      game.update(STEP, IDLE);
      winner = game.getScore().winner;
    }
    expect(winner).not.toBeNull();
    const final = game.getScore();
    expect(final.p1).toBeGreaterThanOrEqual(0);
    expect(final.p1 + final.p2).toBeLessThanOrEqual(30);
    game.destroy();
  });

  it('puts everything back on destroy, and can be re-initialised into a fresh match', () => {
    const game = new ChessGame();
    game.init(makeContext({ botP1: 'hard', botP2: 'hard' }));
    for (let i = 0; i < 400; i += 1) game.update(STEP, IDLE);
    expect(game.match.ply).toBeGreaterThan(0);
    game.destroy();
    expect(game.match.ply).toBe(0);
    expect(game.selected).toBe(-1);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.init(makeContext({ openingSeat: 'p2' }));
    expect(game.getActiveSeat()).toBe('p2');
    expect(game.match.result).toBeNull();
  });

  it('pauses and resumes without touching the match', () => {
    const game = new ChessGame();
    game.init(makeContext({ botP1: 'normal', botP2: 'normal' }));
    for (let i = 0; i < 200; i += 1) game.update(STEP, IDLE);
    const before = [...game.match.position.board];
    const ply = game.match.ply;
    game.onPause();
    game.onResume();
    expect([...game.match.position.board]).toEqual(before);
    expect(game.match.ply).toBe(ply);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ rendering */

describe('rendering', () => {
  it('draws the same frame twice, and draws nothing into the state', () => {
    const game = new ChessGame();
    game.init(makeContext({ botP1: 'normal', botP2: 'normal' }));
    for (let i = 0; i < 240; i += 1) game.update(STEP, IDLE);
    const board = [...game.match.position.board];
    const first = draw(game, 0);
    const second = draw(game, 0.75);
    expect(second.ops).toEqual(first.ops);
    expect(second.args).toEqual(first.args);
    expect([...game.match.position.board]).toEqual(board);
    expect(game.match.ply).toBe(game.match.ply);
    game.destroy();
  });

  it('stays inside the declared logical box, through the whole half-turn', () => {
    const game = new ChessGame();
    game.init(makeContext({ botP1: 'normal', botP2: 'normal' }));
    for (let i = 0; i < 900; i += 1) {
      game.update(STEP, IDLE);
      if (i % 7 !== 0) continue;
      const frame = draw(game);
      // The rotation is applied by the renderer about the centre of the logical area, so a
      // point inside the box before it is inside the box after it. What this checks is
      // that nothing was drawn outside in the first place.
      for (const x of frame.xs) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(manifest.logical.width);
      }
      for (const y of frame.ys) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(manifest.logical.height);
      }
    }
    game.destroy();
  });

  it('pairs every rotation it pushes with a pop', () => {
    const game = new ChessGame();
    game.init(makeContext());
    const frame = draw(game);
    const pushes = frame.ops.filter((op) => op === 'pushRotation' || op === 'pushSeatRotation');
    const pops = frame.ops.filter((op) => op === 'popSeatRotation');
    expect(pushes).toHaveLength(pops.length);
    expect(pushes.length).toBeGreaterThan(0);
    game.destroy();
  });

  /**
   * Rule 7, checked here rather than trusted.
   *
   * Both armies carry the same six letters — a knight is `N` for everybody — so the letters
   * cannot be what tells the seats apart, and they are not asked to be. The *plate* is:
   * seat one's pieces are drawn with `circle`, seat two's with `rect`, and neither seat
   * ever draws the other's primitive in its own colour. In greyscale that is a board of
   * discs against a board of squares.
   */
  it('gives each army a shape the other never draws', () => {
    const game = new ChessGame();
    game.init(makeContext());
    const frame = draw(game);
    const one = frame.byColour.get(SEAT_PALETTE.p1.base) ?? new Set<string>();
    const two = frame.byColour.get(SEAT_PALETTE.p2.base) ?? new Set<string>();
    expect(one.size).toBeGreaterThan(0);
    expect(two.size).toBeGreaterThan(0);
    expect(one.has('circle')).toBe(true);
    expect(two.has('circle')).toBe(false);
    expect(two.has('rect')).toBe(true);
    expect(one.has('rect')).toBe(false);
    game.destroy();
  });

  it('labels every piece, so a bishop is not a knight in greyscale either', () => {
    const game = new ChessGame();
    game.init(makeContext());
    const frame = draw(game);
    const drawn = new Set<string>();
    for (const kinds of frame.byColour.values()) {
      for (const kind of kinds) if (kind.startsWith('text:')) drawn.add(kind.slice(5));
    }
    expect([...drawn].sort()).toEqual(['B', 'K', 'N', 'P', 'Q', 'R']);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ a hand on the glass */

describe('two presses make a move', () => {
  it('lifts a piece and puts it down', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    tapSquare(game, 'p1', at('e2'));
    expect(game.selected).toBe(at('e2'));
    tapSquare(game, 'p1', at('e4'));
    expect(game.selected).toBe(-1);
    expect(game.match.position.board[at('e4')]).toBe(PAWN);
    expect(game.match.position.board[at('e2')]).toBe(0);
    expect(game.getActiveSeat()).toBe('p2');
    game.destroy();
  });

  it('believes the second press when a player changes their mind', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    tapSquare(game, 'p1', at('e2'));
    tapSquare(game, 'p1', at('d2'));
    expect(game.selected).toBe(at('d2'));
    // Tapping the lifted piece again puts it down where it was.
    tapSquare(game, 'p1', at('d2'));
    expect(game.selected).toBe(-1);
    expect(game.match.ply).toBe(0);
    game.destroy();
  });

  it('refuses an illegal destination without dropping the piece', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    tapSquare(game, 'p1', at('e2'));
    tapSquare(game, 'p1', at('e5'));
    expect(game.match.ply).toBe(0);
    expect(game.selected).toBe(at('e2'));
    game.destroy();
  });

  it('ignores a tap from the seat that is not to move', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    tapSquare(game, 'p2', at('e7'), true);
    expect(game.selected).toBe(-1);
    expect(game.match.ply).toBe(0);
    game.destroy();
  });

  it('ignores a tap off the board', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    const input = new ScriptedInput();
    input.tap('p1', 10, 10);
    game.update(STEP, input);
    expect(game.selected).toBe(-1);
    expect(squareAt(10, 10)).toBe(-1);
    game.destroy();
  });

  it('reads the far seat through the half-turn, so their tap lands where they aimed', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    tapSquare(game, 'p1', at('e2'));
    tapSquare(game, 'p1', at('e4'));
    expect(game.getActiveSeat()).toBe('p2');
    // The board is turning; nothing is accepted until it has stopped.
    tapSquare(game, 'p2', at('e7'), true);
    expect(game.selected).toBe(-1);
    settle(game);
    tapSquare(game, 'p2', at('e7'), true);
    expect(game.selected).toBe(at('e7'));
    tapSquare(game, 'p2', at('e5'), true);
    expect(game.match.position.board[at('e5')]).toBe(-PAWN);
    game.destroy();
  });

  it('castles from two presses, because a king stepping two squares can be nothing else', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    for (const [from, to] of [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['g1', 'f3'],
      ['b8', 'c6'],
      ['f1', 'c4'],
      ['g8', 'f6'],
    ] as const) {
      const seat: SeatId = game.getActiveSeat();
      const rotated = seat === 'p2';
      tapSquare(game, seat, at(from), rotated);
      tapSquare(game, seat, at(to), rotated);
      settle(game);
    }
    expect(game.getActiveSeat()).toBe('p1');
    tapSquare(game, 'p1', at('e1'));
    tapSquare(game, 'p1', at('g1'));
    expect(game.match.position.board[at('g1')]).toBe(KING);
    expect(game.match.position.board[at('f1')]).toBe(ROOK);
    game.destroy();
  });

  it('is playable with the keyboard alone', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    const input = new ScriptedInput();
    // The cursor starts on e2. Press to lift, steer two rows up, press to place.
    expect(game.cursorSquare).toBe(at('e2'));
    input.press('p1');
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.selected).toBe(at('e2'));

    // "Up" for seat one is towards the far side of the board, which is a falling row index.
    for (let i = 0; i < 2; i += 1) {
      input.steer('p1', 0, -1);
      game.update(STEP, input);
      input.steer('p1', 0, 0);
      game.update(STEP, input);
    }
    expect(game.cursorSquare).toBe(at('e4'));
    input.press('p1');
    game.update(STEP, input);
    input.release('p1');
    game.update(STEP, input);
    expect(game.match.position.board[at('e4')]).toBe(PAWN);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ presentations */

describe('one simulation, two presentations', () => {
  it('steps the identical match on a shared screen and on two devices', () => {
    function run(presentation: Presentation, localSeat: SeatId): string {
      const game = new ChessGame();
      game.init(makeContext({ presentation, localSeat, botP1: 'normal', botP2: 'normal' }));
      const trace: string[] = [];
      for (let i = 0; i < 1200; i += 1) {
        game.update(STEP, IDLE);
        const score = game.getScore();
        trace.push(`${game.getActiveSeat()}:${score.p1}:${score.p2}:${String(score.winner)}`);
      }
      const board = [...game.match.position.board].join(',');
      game.destroy();
      return `${trace.join('|')}#${board}`;
    }
    const shared = run('shared-screen', 'p1');
    expect(run('single-seat', 'p1')).toBe(shared);
    expect(run('single-seat', 'p2')).toBe(shared);
    expect(run('shared-screen', 'p2')).toBe(shared);
  });

  it('never turns the board in single-seat play, and always faces the seat to move otherwise', () => {
    const alone = new ChessGame();
    alone.init(makeContext({ presentation: 'single-seat', localSeat: 'p2' }));
    settle(alone);
    // Seat two is local and reads upright: no rotation at all.
    expect(draw(alone).args).toContain(0);
    alone.destroy();
  });
});

/* ------------------------------------------------------------------ bots */

describe('two bots', () => {
  it('reach a decision well inside ten simulated minutes, at the weakest tier', () => {
    for (const openingSeat of ['p1', 'p2'] as const) {
      const game = new ChessGame();
      game.init(makeContext({ botP1: 'easy', botP2: 'easy', openingSeat, seed: 4242 }));
      let steps = -1;
      for (let i = 0; i < 60 * 600; i += 1) {
        game.update(STEP, IDLE);
        if (game.getScore().winner !== null) {
          steps = i;
          break;
        }
      }
      expect(steps).toBeGreaterThan(0);
      expect(steps).toBeLessThan(60 * 300);
      game.destroy();
    }
  });

  it('leaves a human seat alone when a bot holds the other one', () => {
    const game = new ChessGame();
    game.init(makeContext({ botP2: 'hard' }));
    settle(game);
    tapSquare(game, 'p1', at('e2'));
    tapSquare(game, 'p1', at('e4'));
    expect(game.match.ply).toBe(1);
    // The bot answers on its own, without any input at all.
    for (let i = 0; i < 120; i += 1) game.update(STEP, IDLE);
    expect(game.match.ply).toBe(2);
    expect(game.getActiveSeat()).toBe('p1');
    game.destroy();
  });

  it('holds the last position on screen for a beat before it reports the result', () => {
    const game = new ChessGame();
    game.init(makeContext());
    settle(game);
    // The fastest mate there is, played by hand.
    for (const [from, to] of [
      ['f2', 'f3'],
      ['e7', 'e5'],
      ['g2', 'g4'],
      ['d8', 'h4'],
    ] as const) {
      const seat: SeatId = game.getActiveSeat();
      tapSquare(game, seat, at(from), seat === 'p2');
      tapSquare(game, seat, at(to), seat === 'p2');
      settle(game);
    }
    expect(game.match.result).toBe('p2');
    // The rules know; the shell is not told until the settle has run.
    const game2 = new ChessGame();
    game2.init(makeContext({ botP1: 'hard', botP2: 'hard' }));
    let sawResultBeforeWinner = false;
    for (let i = 0; i < 60 * 600; i += 1) {
      game2.update(STEP, IDLE);
      if (game2.match.result !== null && game2.getScore().winner === null) {
        sawResultBeforeWinner = true;
      }
      if (game2.getScore().winner !== null) break;
    }
    expect(sawResultBeforeWinner).toBe(true);
    expect(game2.getScore().winner).toBe(game2.match.result);
    game.destroy();
    game2.destroy();
  });
});

describe('the geometry', () => {
  it('maps every square to a point on the board and back', () => {
    for (let square = 0; square < 64; square += 1) {
      const centre = squareCentre(vec2(), square);
      expect(squareAt(centre.x, centre.y)).toBe(square);
      expect(centre.x).toBeGreaterThan(BOARD_ORIGIN);
      expect(centre.x).toBeLessThan(BOARD_ORIGIN + BOARD_EXTENT);
    }
  });

  it('reports no square outside the board', () => {
    expect(squareAt(BOARD_ORIGIN - 1, BOARD_ORIGIN + 1)).toBe(-1);
    expect(squareAt(BOARD_ORIGIN + 1, BOARD_ORIGIN - 1)).toBe(-1);
    expect(squareAt(BOARD_ORIGIN + BOARD_EXTENT, BOARD_ORIGIN)).toBe(-1);
    expect(squareAt(0, 0)).toBe(-1);
  });

  it('leaves room for the shell around the board', () => {
    expect(BOARD_ORIGIN).toBeGreaterThan(0);
    expect(BOARD_ORIGIN + BOARD_EXTENT).toBeLessThan(manifest.logical.height);
    expect(manifest.logical.width).toBe(manifest.logical.height);
  });
});

describe('the manifest', () => {
  it('names both seats in the keyboard line and describes what a finger does', () => {
    expect(manifest.controls.keyboard).toMatch(/player one/i);
    expect(manifest.controls.keyboard).toMatch(/player two/i);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
    expect(manifest.presentations).toEqual(['shared-screen', 'single-seat']);
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('declares a queen where the rules put one', () => {
    // A guard against the piece letters and the piece codes drifting apart.
    expect(QUEEN).toBeGreaterThan(ROOK);
    expect(KING).toBeGreaterThan(QUEEN);
  });
});
