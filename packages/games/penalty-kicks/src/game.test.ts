import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD_WIDTH,
  GOAL_H,
  GOAL_W,
  GOAL_X,
  GOAL_Y,
  PenaltyKicksGame,
  cellAtPoint,
  cellRect,
  selectorRect,
} from './game.js';
import { CELLS, ROWS, TARGET, cellAt, keeperOf } from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  tap(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = false;
    target.pointer = null;
  }

  press(seat: SeatId): void {
    this.#of(seat).actionPressed = true;
  }

  move(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  get args(): DrawArg[] {
    return this.calls.flatMap((call) => [...call.args]);
  }

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.#record('rect', x, y, w, h, colour);
  }
  strokeRect(x: number, y: number, w: number, h: number, lw: number, colour: string): void {
    this.#record('strokeRect', x, y, w, h, lw, colour);
  }
  circle(x: number, y: number, r: number, colour: string): void {
    this.#record('circle', x, y, r, colour);
  }
  strokeCircle(x: number, y: number, r: number, lw: number, colour: string): void {
    this.#record('strokeCircle', x, y, r, lw, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lw: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lw, colour);
  }
  text(v: string, x: number, y: number, size: number, colour: string, align?: TextAlign): void {
    this.#record('text', v, x, y, size, colour, align);
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

  #record(op: string, ...values: DrawArg[]): void {
    this.calls.push({ op, args: values });
  }
}

function centreOf(cell: number): [number, number] {
  const rect = cellRect(cell);
  return [rect.x + rect.w / 2, rect.y + rect.h / 2];
}

/** The centre of a cell on a seat's own selector, which is what a finger taps. */
function pickOf(seat: SeatId, cell: number): [number, number] {
  const rect = selectorRect(seat, cell);
  return [rect.x + rect.w / 2, rect.y + rect.h / 2];
}

describe('the goal geometry', () => {
  it('maps a point in a cell to that cell', () => {
    for (let cell = 0; cell < CELLS; cell += 1) {
      const [x, y] = centreOf(cell);
      expect(cellAtPoint(x, y)).toBe(cell);
    }
  });

  it('maps a point outside the goal to nothing', () => {
    expect(cellAtPoint(GOAL_X - 20, GOAL_Y + 10)).toBe(-1);
    expect(cellAtPoint(GOAL_X + 10, GOAL_Y - 20)).toBe(-1);
    expect(cellAtPoint(GOAL_X + GOAL_W + 5, GOAL_Y + 10)).toBe(-1);
    expect(cellAtPoint(GOAL_X + 10, GOAL_Y + GOAL_H + 5)).toBe(-1);
  });

  it('tiles the whole goal mouth', () => {
    for (let cell = 0; cell < CELLS; cell += 1) {
      const rect = cellRect(cell);
      expect(rect.x).toBeGreaterThanOrEqual(GOAL_X);
      expect(rect.x + rect.w).toBeLessThanOrEqual(GOAL_X + GOAL_W + 1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(GOAL_Y);
      expect(rect.y + rect.h).toBeLessThanOrEqual(GOAL_Y + GOAL_H + 1e-6);
    }
  });
});

describe('both players choose at once', () => {
  it('takes a kick and a dive in the same step', () => {
    // The whole game: one seat is placing a ball and the other is choosing where to throw
    // themselves, and neither may wait for the other.
    const game = new PenaltyKicksGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const [kx, ky] = pickOf('p1', cellAt(0, ROWS - 1));
    const [dx, dy] = pickOf('p2', cellAt(2, ROWS - 1));
    input.tap('p1', kx, ky);
    input.tap('p2', dx, dy);
    game.update(STEP, input);
    expect(game.position.shot).toBe(cellAt(0, ROWS - 1));
    expect(game.position.dive).toBe(cellAt(2, ROWS - 1));
  });

  it('lets one seat commit while the other is still deciding', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    const [kx, ky] = pickOf('p1', 4);
    input.tap('p1', kx, ky);
    game.update(STEP, input);
    expect(game.position.shot).toBe(4);
    expect(game.position.dive, 'the keeper has not chosen').toBe(-1);
  });

  it('ignores a tap outside a seat own selector', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    input.tap('p1', 10, 10);
    game.update(STEP, input);
    expect(game.position.shot).toBe(-1);
  });

  it('does not let a seat pick from the shared goal', () => {
    // The goal shows the reveal and nothing else; a choice made there would be a choice
    // made where the opponent is looking.
    const game = new PenaltyKicksGame();
    game.init(makeContext(103));
    const input = new ScriptedInput();
    const [gx, gy] = centreOf(cellAt(0, 0));
    input.tap('p1', gx, gy);
    game.update(STEP, input);
    expect(game.position.shot).toBe(-1);
  });

  it('has no active seat, so the shell keeps both zones', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(11));
    expect(game.getActiveSeat()).toBeNull();
  });

  it('takes a choice from the keyboard cursor', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.shot).toBe(game.cursorFor('p1'));
  });

  it('moves each seat cursor with its own keys', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(17));
    const input = new ScriptedInput();
    const beforeP1 = game.cursorFor('p1');
    const beforeP2 = game.cursorFor('p2');
    // The two start on **different** cells on purpose, so this compares each against its
    // own starting point rather than against the other's.
    expect(beforeP1).not.toBe(beforeP2);

    input.move('p1', 1, 0);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.cursorFor('p1')).not.toBe(beforeP1);
    expect(game.cursorFor('p2'), 'a silent seat does not move').toBe(beforeP2);
  });
});

describe('the reveal', () => {
  function bothCommit(
    game: PenaltyKicksGame,
    input: ScriptedInput,
    shot: number,
    dived: number,
  ): void {
    const [kx, ky] = pickOf('p1', shot);
    const [dx, dy] = pickOf('p2', dived);
    input.tap('p1', kx, ky);
    input.tap('p2', dx, dy);
    game.update(STEP, input);
    input.release('p1');
    input.release('p2');
  }

  it('holds both choices on screen before resolving', () => {
    // Both chose blind, and seeing what the other did is the entire payoff of the round.
    const game = new PenaltyKicksGame();
    game.init(makeContext(19));
    const input = new ScriptedInput();
    bothCommit(game, input, cellAt(0, ROWS - 1), cellAt(2, ROWS - 1));
    game.update(STEP, input);
    expect(game.position.round, 'not resolved a frame later').toBe(0);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.round, 'nor half a second on').toBe(0);
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    expect(game.position.round, 'and then it resolves').toBe(1);
  });

  it('swaps the kicker afterwards', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    expect(game.position.kicker).toBe('p1');
    bothCommit(game, input, cellAt(1, ROWS - 1), cellAt(1, ROWS - 1));
    for (let i = 0; i < 150; i += 1) game.update(STEP, input);
    expect(game.position.kicker).toBe('p2');
    expect(keeperOf(game.position)).toBe('p1');
  });
});

describe('hidden choices', () => {
  /**
   * Two people share a screen, so a choice drawn anywhere is a choice the opponent can
   * read — and reading it would end the game, because a keeper who sees the shot always
   * saves it.
   */
  it('never draws a choice that has been committed', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(29));
    const input = new ScriptedInput();
    const chosen = cellAt(0, 0);
    const [x, y] = pickOf('p1', chosen);

    const before = new RecordingRenderer();
    game.render(before, 0);
    const markers = (renderer: RecordingRenderer): number =>
      renderer.calls.filter(
        (call) => call.op === 'strokeRect' && call.args[5] === SEAT_PALETTE.p1.base,
      ).length;
    expect(markers(before), 'the cursor is on screen while choosing').toBe(1);

    input.tap('p1', x, y);
    game.update(STEP, input);
    input.release('p1');
    expect(game.position.shot, 'and the choice was taken').toBe(chosen);

    const after = new RecordingRenderer();
    game.render(after, 0);
    expect(markers(after), 'and gone the moment it is committed').toBe(0);
  });

  it('shows a seat its own cursor until it commits', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(31));
    const before = new RecordingRenderer();
    game.render(before, 0);
    const cursors = before.calls.filter(
      (call) => call.op === 'strokeRect' && call.args[5] === SEAT_PALETTE.p1.base,
    ).length;
    expect(cursors, 'the kicker can see where they are aiming').toBeGreaterThan(0);
  });

  it('shows both choices once the round resolves', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(37));
    const input = new ScriptedInput();
    const [kx, ky] = pickOf('p1', cellAt(0, ROWS - 1));
    const [dx, dy] = pickOf('p2', cellAt(2, ROWS - 1));
    input.tap('p1', kx, ky);
    input.tap('p2', dx, dy);
    game.update(STEP, input);
    input.release('p1');
    input.release('p2');
    game.update(STEP, input);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    // A ball is drawn, which only happens on the reveal.
    expect(renderer.args, 'the ball appears').toContain('#f7f9f4');
  });
});

describe('the bots learn from what they see', () => {
  /**
   * Each bot remembers what the **other** seat did. That is the only thing it knows a
   * human could not know equally well — a person watching the same keeper dive left four
   * times running learns exactly the same thing, so it is a skill rather than extra
   * information (rule 6).
   */
  /** Plays a whole match with p1 always choosing the same square, and returns its goals. */
  function alwaysKicks(
    keeper: BotDifficulty,
    cell: number,
    seed: number,
  ): {
    faced: number;
    scored: number;
  } {
    const game = new PenaltyKicksGame();
    game.init(makeContext(seed, null, keeper));
    const input = new ScriptedInput();
    const [x, y] = pickOf('p1', cell);

    let faced = 0;
    let scored = 0;
    let round = game.position.round;
    let scoreBefore = game.getScore().p1;
    let kickerBefore = game.position.kicker;

    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      // p1 is human in **both** roles, so it has to choose every round or the match
      // deadlocks — the first version of this only tapped on its own kicks and stalled
      // after one round. It always taps the same square, which is the point.
      const owes = game.position.kicker === 'p1' ? game.position.shot < 0 : game.position.dive < 0;
      if (owes) input.tap('p1', x, y);
      else input.release('p1');
      game.update(STEP, input);

      if (game.position.round !== round) {
        if (kickerBefore === 'p1') {
          faced += 1;
          if (game.getScore().p1 > scoreBefore) scored += 1;
        }
        round = game.position.round;
        scoreBefore = game.getScore().p1;
        kickerBefore = game.position.kicker;
      }
    }
    return { faced, scored };
  }

  /** The mirror: p1 is human and always dives the same square; returns the bot's goals. */
  function alwaysDives(
    kicker: BotDifficulty,
    cell: number,
    seed: number,
  ): {
    faced: number;
    conceded: number;
  } {
    const game = new PenaltyKicksGame();
    game.init(makeContext(seed, null, kicker));
    const input = new ScriptedInput();
    const [x, y] = pickOf('p1', cell);

    let faced = 0;
    let conceded = 0;
    let round = game.position.round;
    let theirScore = game.getScore().p2;
    let kickerBefore = game.position.kicker;

    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      const owes = game.position.kicker === 'p1' ? game.position.shot < 0 : game.position.dive < 0;
      if (owes) input.tap('p1', x, y);
      else input.release('p1');
      game.update(STEP, input);

      if (game.position.round !== round) {
        if (kickerBefore === 'p2') {
          faced += 1;
          if (game.getScore().p2 > theirScore) conceded += 1;
        }
        round = game.position.round;
        theirScore = game.getScore().p2;
        kickerBefore = game.position.kicker;
      }
    }
    return { faced, conceded };
  }

  it('a reading kicker avoids a keeper who always dives the same way', () => {
    // The mirror of the test below, and it needs its own: the two halves of the memory
    // are wired separately in `#finishRound`, so deleting either one has to fail
    // something. The keeper test alone left the kicker's half untested.
    const cell = cellAt(0, ROWS - 1);
    let readingIn = 0;
    let readingFaced = 0;
    let plainIn = 0;
    let plainFaced = 0;

    // Forty matches, not a dozen: the bot faces only about seven kicks in a match, so a
    // small sample cannot see a difference the rules tests measure at 7-21 points.
    for (let seed = 0; seed < 40; seed += 1) {
      const reading = alwaysDives('hard', cell, 211 + seed);
      const plain = alwaysDives('normal', cell, 211 + seed);
      readingIn += reading.conceded;
      readingFaced += reading.faced;
      plainIn += plain.conceded;
      plainFaced += plain.faced;
    }

    expect(readingFaced, 'the bot took some kicks').toBeGreaterThan(20);
    const readingRate = readingIn / readingFaced;
    const plainRate = plainIn / plainFaced;
    expect(
      readingRate,
      `reading kicker scored ${(readingRate * 100).toFixed(0)}%, plain one ${(plainRate * 100).toFixed(0)}%`,
    ).toBeGreaterThan(plainRate);
  });

  it('a reading keeper punishes a repeated kick that a plain one does not', () => {
    // Aimed at the **top** corner: the one the keeper's prior covers least, because it is
    // the least valuable place to kick. A favourite the prior already guards is saved
    // whether or not anything is remembered — which is exactly what the first version of
    // this test chose, and it passed with the memory wiring deleted.
    const cell = cellAt(0, 0);
    let readingLetIn = 0;
    let readingFaced = 0;
    let plainLetIn = 0;
    let plainFaced = 0;

    for (let seed = 0; seed < 12; seed += 1) {
      const reading = alwaysKicks('hard', cell, 101 + seed);
      const plain = alwaysKicks('normal', cell, 101 + seed);
      readingLetIn += reading.scored;
      readingFaced += reading.faced;
      plainLetIn += plain.scored;
      plainFaced += plain.faced;
    }

    expect(readingFaced, 'the human took some kicks').toBeGreaterThan(20);
    const readingRate = readingLetIn / readingFaced;
    const plainRate = plainLetIn / plainFaced;
    expect(
      readingRate,
      `reading keeper let in ${(readingRate * 100).toFixed(0)}%, plain one ${(plainRate * 100).toFixed(0)}%`,
    ).toBeLessThan(plainRate);
  });
});

describe('the match', () => {
  it('starts goalless', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(41));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('plays a whole bot match to a winner', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(43, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('stops changing once it is decided', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(47, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new PenaltyKicksGame();
      game.init(makeContext(53, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, input);
        if (i % 120 === 0) out.push(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(59, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200; i += 1) game.update(STEP, input);
    game.init(makeContext(59, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.kicker).toBe('p1');
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never chooses for a human seat', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(61, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    expect(game.position.shot, 'a silent human takes no kick').toBe(-1);
  });
});

describe('rendering', () => {
  it('draws the goal, its cells and the spot', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(67));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.calls.filter((call) => call.op === 'line').length, 'the net').toBeGreaterThan(
      2,
    );
    expect(renderer.ops).toContain('strokeRect');
  });

  it('shows how wild each cell is, so the trade-off is not a secret', () => {
    // Choosing a corner is a judgement, and a player who cannot see the risk is guessing
    // rather than judging. The ticks are on each seat's own selector, not on the shared
    // goal — the goal shows the reveal and nothing else.
    const game = new PenaltyKicksGame();
    game.init(makeContext(71));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const ticks = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[2] === 5 && call.args[3] === 5,
    ).length;
    expect(ticks, 'the risky cells are marked, on both selectors').toBeGreaterThan(8);
  });

  it('says who is kicking, in that seat colour and shape', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(73));
    const p1 = new RecordingRenderer();
    game.render(p1, 0);
    expect(p1.args).toContain(SEAT_PALETTE.p1.base);

    game.position.kicker = 'p2';
    const p2 = new RecordingRenderer();
    game.render(p2, 0);
    expect(p2.args).toContain(SEAT_PALETTE.p2.base);
  });

  it('shows the score and the target', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(79));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.args).toContain(`0 — 0   first to ${String(TARGET)}`);
  });

  it('never rotates', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(83));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops).not.toContain('pushRotation');
  });

  it('draws nothing outside the logical box', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(89, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 2400; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-60);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(1060);
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new PenaltyKicksGame();
    game.init(makeContext(97, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(JSON.stringify(game.position)).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('penalty-kicks');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.logical.width).toBe(BOARD_WIDTH);
  });
});
