import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_X,
  BOARD_W,
  CAST_Y,
  CELL_H,
  CELL_W,
  CHIP_H,
  CHIP_Y,
  GuessWhoGame,
  slotAt,
  slotHeight,
  slotX,
  slotY,
} from './game.js';
import {
  CAST,
  CAST_ROWS,
  COLUMNS,
  DEALS,
  QUESTIONS,
  boardOf,
  characterAt,
  isLive,
  legalQuestions,
  targetOf,
  tileOf,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const LOGICAL = manifest.logical;

interface Drawn {
  readonly kind: string;
  readonly colour: string;
  readonly numbers: readonly number[];
}

/** A renderer that writes down every mark, so a test can read what a frame contains. */
function recorder(): { renderer: Renderer; marks: Drawn[] } {
  const marks: Drawn[] = [];
  const push = (kind: string, colour: string, ...numbers: number[]): void => {
    marks.push({ kind, colour, numbers });
  };
  const renderer: Renderer = {
    clear: (colour) => push('clear', colour),
    rect: (x, y, w, h, c) => push('rect', c, x, y, w, h),
    strokeRect: (x, y, w, h, lw, c) => push('srect', c, x, y, w, h, lw),
    circle: (x, y, r, c) => push('circ', c, x, y, r),
    strokeCircle: (x, y, r, lw, c) => push('scirc', c, x, y, r, lw),
    line: (x1, y1, x2, y2, lw, c) => push('line', c, x1, y1, x2, y2, lw),
    text: (value, x, y, size, c) => push(`text:${value}`, c, x, y, size),
    pushSeatRotation: () => undefined,
    pushRotation: () => undefined,
    popSeatRotation: () => undefined,
  };
  return { renderer, marks };
}

function contextFor(options?: {
  seed?: number;
  presentation?: Presentation;
  localSeat?: SeatId;
  openingSeat?: SeatId;
  difficulty?: (seat: SeatId) => BotDifficulty | null;
}): GameContext {
  return {
    manifest,
    rng: new Rng(options?.seed ?? 20260829),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: options?.openingSeat ?? 'p1',
    botDifficulty: options?.difficulty ?? ((): null => null),
  };
}

function inputFor(): { input: InputManager; view: InputView } {
  return {
    input: new InputManager(LOGICAL, { split: 'shared', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

/** Step a game with nobody touching the device. */
function idle(game: Game, steps: number, bundle = inputFor()): void {
  for (let i = 0; i < steps; i += 1) {
    game.update(STEP, bundle.view.sync(bundle.input.beginStep(STEP)));
  }
}

/** Step until the active seat may act again: past any reveal, and past the board flip. */
function ready(game: GuessWhoGame, bundle: ReturnType<typeof inputFor>): void {
  idle(game, 130, bundle);
}

function fresh(options?: Parameters<typeof contextFor>[0]): {
  game: GuessWhoGame;
  bundle: ReturnType<typeof inputFor>;
} {
  const game = new GuessWhoGame();
  game.init(contextFor(options));
  const bundle = inputFor();
  return { game, bundle };
}

/** Tap the middle of a slot, in board coordinates, as the seat that owns the board. */
function tap(game: GuessWhoGame, bundle: ReturnType<typeof inputFor>, slot: number): void {
  bundle.input.setBoardSeat(game.getActiveSeat());
  bundle.input.pointerDown(1, slotX(slot) + CELL_W / 2, slotY(slot) + slotHeight(slot) / 2);
  game.update(STEP, bundle.view.sync(bundle.input.beginStep(STEP)));
  bundle.input.pointerUp(1);
  game.update(STEP, bundle.view.sync(bundle.input.beginStep(STEP)));
}

/* ------------------------------------------------------------------ contract */

describe('the game contract', () => {
  it('starts level, with no winner and the opening seat to move', () => {
    for (const opening of ['p1', 'p2'] as SeatId[]) {
      const { game } = fresh({ openingSeat: opening });
      expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
      expect(game.getActiveSeat()).toBe(opening);
    }
  });

  it('scores in deals won, never above the best of three', () => {
    const { game, bundle } = fresh({ difficulty: () => 'normal' });
    for (let i = 0; i < 60 * 200; i += 1) {
      idle(game, 1, bundle);
      const score = game.getScore();
      expect(Number.isInteger(score.p1)).toBe(true);
      expect(score.p1).toBeGreaterThanOrEqual(0);
      expect(score.p2).toBeGreaterThanOrEqual(0);
      expect(score.p1 + score.p2).toBeLessThanOrEqual(DEALS);
      if (score.winner !== null) return;
    }
    expect.fail('two normal bots did not finish a match');
  });

  it('reports the seat to move on every step, so the shell can turn the board', () => {
    const { game, bundle } = fresh({ difficulty: () => 'easy' });
    const seen = new Set<SeatId>();
    for (let i = 0; i < 60 * 120; i += 1) {
      idle(game, 1, bundle);
      seen.add(game.getActiveSeat());
      if (game.getScore().winner !== null) break;
    }
    expect([...seen].sort()).toEqual(['p1', 'p2']);
  });

  it('survives pause and resume without changing anything', () => {
    const { game, bundle } = fresh({ difficulty: () => 'hard' });
    idle(game, 400, bundle);
    const before = JSON.stringify(game.match);
    game.onPause();
    game.onResume();
    expect(JSON.stringify(game.match)).toBe(before);
  });

  it('puts everything back on destroy, and can be stood straight back up', () => {
    const { game, bundle } = fresh({ difficulty: () => 'normal' });
    idle(game, 2000, bundle);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.setOver).toBe(false);
    expect(game.match.deal).toBe(0);
    expect(game.match.p1.liveCount).toBe(CAST);

    game.init(contextFor({ seed: 5, difficulty: () => 'normal' }));
    idle(game, 60, bundle);
    expect(game.getScore().winner).toBeNull();
  });
});

/* -------------------------------------------------------------------- render */

describe('rendering', () => {
  it('never mutates the simulation', () => {
    const { game, bundle } = fresh({ difficulty: () => 'normal' });
    idle(game, 500, bundle);
    const before = JSON.stringify(game.match);
    const { renderer } = recorder();
    for (let i = 0; i < 40; i += 1) game.render(renderer, i / 40);
    expect(JSON.stringify(game.match)).toBe(before);
  });

  it('draws the same frame at every alpha, because nothing here interpolates', () => {
    const { game, bundle } = fresh({ difficulty: () => 'normal' });
    idle(game, 300, bundle);
    const a = recorder();
    const b = recorder();
    game.render(a.renderer, 0);
    game.render(b.renderer, 0.99);
    expect(b.marks).toEqual(a.marks);
  });

  it('keeps every mark inside the declared logical box', () => {
    const { game, bundle } = fresh({ difficulty: () => 'hard' });
    const { renderer, marks } = recorder();
    for (let frame = 0; frame < 120; frame += 1) {
      idle(game, 9, bundle);
      game.render(renderer, 0);
    }
    expect(marks.length).toBeGreaterThan(1000);
    for (const mark of marks) {
      if (mark.kind === 'clear') continue;
      for (const value of mark.numbers) {
        expect(Math.abs(value)).toBeLessThanOrEqual(Math.max(LOGICAL.width, LOGICAL.height));
      }
    }
  });

  it('never writes a word, so nothing on the board needs reading', () => {
    const { game, bundle } = fresh({ difficulty: () => 'easy' });
    const { renderer, marks } = recorder();
    for (let frame = 0; frame < 600; frame += 1) {
      idle(game, 6, bundle);
      game.render(renderer, 0);
      if (game.getScore().winner !== null) break;
    }
    expect(marks.some((mark) => mark.kind.startsWith('text:'))).toBe(false);
  });

  it('draws the whole cast and the whole question row on every frame', () => {
    const { game } = fresh();
    const { renderer, marks } = recorder();
    game.render(renderer, 0);
    // One plate per slot, cast and chips alike.
    const plates = marks.filter(
      (mark) => mark.kind === 'rect' && (mark.colour === '#ffffff' || mark.colour === '#dfe4ee'),
    );
    expect(plates.length).toBe(CAST + QUESTIONS);
  });
});

/* --------------------------------------------------------------------- rule 7 */

describe('rule 7: the two seats never rely on their colour', () => {
  /**
   * Marks a seat owns, which is not the same as marks in its colour.
   *
   * The board frame takes the colour of whoever is to move and covers most of the play
   * area, so it is field rather than a piece — `greyscale.test.ts` drops anything over a
   * quarter of the board for exactly that reason, and so does this.
   */
  const FIELD = 0.25 * LOGICAL.width * LOGICAL.height;

  function seatMarks(marks: readonly Drawn[], seat: SeatId): Drawn[] {
    const palette = SEAT_PALETTE[seat];
    const colours = new Set([palette.base, palette.deep, palette.tint, palette.soft]);
    return marks.filter((mark) => colours.has(mark.colour) && boxOf(mark) <= FIELD);
  }

  function boxOf(mark: Drawn): number {
    if (mark.kind === 'circ' || mark.kind === 'scirc') {
      const radius = mark.numbers[2] ?? 0;
      return 4 * radius * radius;
    }
    return Math.abs(mark.numbers[2] ?? 0) * Math.abs(mark.numbers[3] ?? 0);
  }

  it('puts both seats on screen together, in every frame of every match', () => {
    for (const difficulty of ['easy', 'hard'] as BotDifficulty[]) {
      const { game, bundle } = fresh({ difficulty: () => difficulty });
      const { renderer, marks } = recorder();
      for (let frame = 0; frame < 300; frame += 1) {
        idle(game, 6, bundle);
        marks.length = 0;
        game.render(renderer, 0);
        expect(seatMarks(marks, 'p1').length).toBeGreaterThan(0);
        expect(seatMarks(marks, 'p2').length).toBeGreaterThan(0);
      }
    }
  });

  it('draws seat one round and seat two square, and never the other way about', () => {
    // The whole of rule 7 here, and it is checked on primitives rather than on colours:
    // every mark seat one owns is a disc or a ring, every mark seat two owns is a square
    // or a frame. A player who cannot separate the two hues still reads the board.
    const { game, bundle } = fresh({ difficulty: () => 'normal' });
    const { renderer, marks } = recorder();
    for (let frame = 0; frame < 200; frame += 1) {
      idle(game, 9, bundle);
      marks.length = 0;
      game.render(renderer, 0);
      for (const mark of seatMarks(marks, 'p1')) {
        expect(['circ', 'scirc'], JSON.stringify(mark)).toContain(mark.kind);
      }
      for (const mark of seatMarks(marks, 'p2')) {
        expect(['rect', 'srect'], JSON.stringify(mark)).toContain(mark.kind);
      }
    }
  });

  it('tells a candidate still standing from one struck off by shape, not tone', () => {
    const { game } = fresh();
    const board = game.match.p1;
    const struck = characterAt(game.match, 0);
    board.live &= ~(1 << struck);
    board.liveCount -= 1;

    const { renderer, marks } = recorder();
    game.render(renderer, 0);
    const p1 = marks.filter((mark) => mark.colour === SEAT_PALETTE.p1.base);
    // Twenty-nine solid discs and one wire ring: the count moves with the board and the
    // shape says which is which.
    expect(p1.filter((mark) => mark.kind === 'circ').length).toBe(CAST - 1);
    expect(p1.filter((mark) => mark.kind === 'scirc').length).toBe(1);
  });

  it('gives the board frame to whoever is to move, and it is field rather than a piece', () => {
    const { game } = fresh({ openingSeat: 'p2' });
    const { renderer, marks } = recorder();
    game.render(renderer, 0);
    const frame = marks.find((mark) => mark.kind === 'srect' && mark.numbers[2]! > BOARD_W);
    expect(frame?.colour).toBe(SEAT_PALETTE.p2.base);
    // Bigger than a quarter of the play area, so a harness reading draw calls treats it
    // as background rather than as a player-owned element.
    const area = frame!.numbers[2]! * frame!.numbers[3]!;
    expect(area).toBeGreaterThan(0.25 * LOGICAL.width * LOGICAL.height);
  });
});

/* ------------------------------------------------------------------- lattice */

describe('the lattice', () => {
  it('maps every slot to a point and back again', () => {
    for (let slot = 0; slot < CAST + QUESTIONS; slot += 1) {
      const x = slotX(slot) + CELL_W / 2;
      const y = slotY(slot) + slotHeight(slot) / 2;
      expect(slotAt(x, y)).toBe(slot);
    }
  });

  it('fits the whole board inside the logical box', () => {
    expect(BOARD_X).toBeGreaterThanOrEqual(0);
    expect(BOARD_X + BOARD_W).toBeLessThanOrEqual(LOGICAL.width);
    expect(CAST_Y + CELL_H * CAST_ROWS).toBeLessThan(CHIP_Y);
    expect(CHIP_Y + CHIP_H).toBeLessThanOrEqual(LOGICAL.height);
    expect(CELL_W * COLUMNS).toBe(BOARD_W);
  });

  it('refuses a point off the board', () => {
    expect(slotAt(-1, CAST_Y + 10)).toBe(-1);
    expect(slotAt(LOGICAL.width + 1, CAST_Y + 10)).toBe(-1);
    expect(slotAt(BOARD_X + 1, 0)).toBe(-1);
    expect(slotAt(BOARD_X + 1, CHIP_Y - 2)).toBe(-1);
    expect(slotAt(BOARD_X + 1, CHIP_Y + CHIP_H + 2)).toBe(-1);
  });
});

/* --------------------------------------------------------------------- input */

describe('a person playing', () => {
  it('names the character on the tile it taps', () => {
    const { game, bundle } = fresh();
    ready(game, bundle);
    const seat = game.getActiveSeat();
    const target = targetOf(game.match, seat);
    tap(game, bundle, tileOf(game.match, target));
    expect(game.match.lastKind).toBe('name');
    expect(game.match.lastCharacter).toBe(target);
    expect(game.match.lastAnswer).toBe(true);
  });

  it('asks the question on the chip it taps', () => {
    const { game, bundle } = fresh();
    ready(game, bundle);
    const seat = game.getActiveSeat();
    const before = boardOf(game.match, seat).liveCount;
    tap(game, bundle, CAST + 0);
    expect(game.match.lastKind).toBe('ask');
    expect(game.match.lastQuestion).toBe(0);
    expect(boardOf(game.match, seat).liveCount).toBeLessThan(before);
  });

  it('ignores a tap on a character it has already struck off', () => {
    const { game, bundle } = fresh();
    ready(game, bundle);
    const seat = game.getActiveSeat();
    const board = boardOf(game.match, seat);
    const dead = characterAt(game.match, 0) === targetOf(game.match, seat) ? 1 : 0;
    board.live &= ~(1 << characterAt(game.match, dead));
    board.liveCount -= 1;
    tap(game, bundle, dead);
    expect(game.match.lastKind).toBe('none');
    expect(game.getActiveSeat()).toBe(seat);
  });

  it('drives the same board with a keyboard', () => {
    const { game, bundle } = fresh();
    ready(game, bundle);
    const seat = game.getActiveSeat();
    const before = boardOf(game.match, seat).liveCount;
    bundle.input.setBoardSeat(seat);
    // Walk down to the question row, then press.
    for (let i = 0; i < 6; i += 1) {
      bundle.input.keyDown('KeyS');
      idle(game, 30, bundle);
      bundle.input.keyUp('KeyS');
      idle(game, 2, bundle);
    }
    bundle.input.keyDown('Space');
    idle(game, 2, bundle);
    bundle.input.keyUp('Space');
    idle(game, 2, bundle);
    expect(game.match.lastKind).not.toBe('none');
    if (game.match.lastKind === 'ask') {
      expect(boardOf(game.match, seat).liveCount).toBeLessThan(before);
    }
  });

  it('reads the far seat taps through the half-turn, so both seats reach the whole board', () => {
    // Seat two sits opposite: its board is drawn a half turn round, so the point it
    // touches is the point the board shows it, not the point in device space.
    const { game, bundle } = fresh({ openingSeat: 'p2', localSeat: 'p1' });
    ready(game, bundle);
    expect(game.getActiveSeat()).toBe('p2');
    const slot = CAST + 0;
    const worldX = slotX(slot) + CELL_W / 2;
    const worldY = slotY(slot) + CHIP_H / 2;
    bundle.input.setBoardSeat('p2');
    bundle.input.pointerDown(1, LOGICAL.width - worldX, LOGICAL.height - worldY);
    idle(game, 1, bundle);
    bundle.input.pointerUp(1);
    idle(game, 1, bundle);
    expect(game.match.lastKind).toBe('ask');
    expect(game.match.lastQuestion).toBe(0);
  });

  it('refuses a press while the board is still turning', () => {
    const { game, bundle } = fresh({ openingSeat: 'p1', localSeat: 'p1' });
    ready(game, bundle);
    // Ask something, which passes the turn and starts the half-turn to seat two.
    const firstLegal = firstLegalQuestion(game, game.getActiveSeat());
    tap(game, bundle, CAST + firstLegal);
    expect(game.getActiveSeat()).toBe('p2');
    const kindBefore = game.match.lastKind;
    const questionBefore = game.match.lastQuestion;
    // A press landing three frames later, mid-flip and mid-reveal, must do nothing.
    idle(game, 3, bundle);
    tap(game, bundle, CAST + 1);
    expect(game.match.lastKind).toBe(kindBefore);
    expect(game.match.lastQuestion).toBe(questionBefore);
  });
});

/* -------------------------------------------------------------- presentations */

describe('the two presentations step the identical match', () => {
  function trace(presentation: Presentation, localSeat: SeatId, seed: number): string[] {
    const game = new GuessWhoGame();
    game.init(contextFor({ seed, presentation, localSeat, difficulty: () => 'hard' }));
    const bundle = inputFor();
    const seen: string[] = [];
    for (let step = 0; step < 60 * 200; step += 1) {
      idle(game, 1, bundle);
      const score = game.getScore();
      seen.push(
        `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${game.getActiveSeat()}:` +
          `${String(game.match.p1.live)}:${String(game.match.p2.live)}`,
      );
      if (score.winner !== null) break;
    }
    game.destroy();
    return seen;
  }

  it('agrees step for step, from both local seats', () => {
    for (const seed of [1, 2, 3]) {
      const shared = trace('shared-screen', 'p1', seed);
      expect(shared.length).toBeGreaterThan(600);
      expect(trace('single-seat', 'p1', seed)).toEqual(shared);
      expect(trace('single-seat', 'p2', seed)).toEqual(shared);
      expect(trace('shared-screen', 'p2', seed)).toEqual(shared);
    }
  });
});

/* ------------------------------------------------------------------ the bots */

describe('two bots', () => {
  function play(
    seed: number,
    p1: BotDifficulty,
    p2: BotDifficulty,
    openingSeat: SeatId = 'p1',
  ): { steps: number; winner: SeatId | 'draw' | null } {
    const game = new GuessWhoGame();
    game.init(contextFor({ seed, openingSeat, difficulty: (seat) => (seat === 'p1' ? p1 : p2) }));
    const bundle = inputFor();
    for (let step = 0; step < 60 * 600; step += 1) {
      idle(game, 1, bundle);
      const winner = game.getScore().winner;
      if (winner !== null) {
        game.destroy();
        return { steps: step, winner };
      }
    }
    game.destroy();
    return { steps: -1, winner: null };
  }

  it('finish a match well inside ten simulated minutes, on every tier', () => {
    let worst = 0;
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      for (let seed = 0; seed < 12; seed += 1) {
        const played = play(seed * 977 + 3, tier, tier, seed % 2 === 0 ? 'p1' : 'p2');
        expect(played.winner, `${tier} seed ${String(seed)}`).not.toBeNull();
        worst = Math.max(worst, played.steps);
      }
    }
    // Ten minutes is 36000 steps. The weakest pairing is nowhere near it.
    expect(worst).toBeLessThan(60 * 180);
  });

  it('play differently on easy and on hard', () => {
    const easy = play(4242, 'easy', 'easy');
    const hard = play(4242, 'hard', 'hard');
    expect(hard.steps).not.toBe(easy.steps);
  });

  it('play a different match with nobody at the device', () => {
    const game = new GuessWhoGame();
    game.init(contextFor({ seed: 99, difficulty: () => null }));
    const bundle = inputFor();
    idle(game, 60 * 30, bundle);
    // Nobody is a bot and nobody is touching the screen, so the deal has not moved.
    expect(game.match.lastKind).toBe('none');
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

function firstLegalQuestion(game: GuessWhoGame, seat: SeatId): number {
  const legal = legalQuestions(boardOf(game.match, seat));
  for (let question = 0; question < QUESTIONS; question += 1) {
    if ((legal & (1 << question)) !== 0) return question;
  }
  return 0;
}

void isLive;
