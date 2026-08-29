import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BAR_BOTTOM,
  BAR_TOP,
  BOARD,
  BackgammonGame,
  CHECKER_RADIUS,
  COLUMNS,
  DIE_SIZE,
  POINT_LENGTH,
  STACK_SHOWN,
  TOP_BASE,
  anchorX,
  anchorY,
  barX,
  pointBaseY,
  pointX,
  stackY,
  trayX,
  trayY,
} from './game.js';
import {
  BAR,
  BEAR_OFF,
  CHECKERS,
  POINTS,
  boardIndex,
  moveDie,
  moveFrom,
  ownAt,
  pipsGained,
} from './rules.js';
import type { BotDifficulty, Position } from './rules.js';

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

  press(seat: SeatId): void {
    this.#of(seat).actionPressed = true;
    this.#of(seat).actionHeld = true;
  }

  release(seat: SeatId): void {
    this.#of(seat).actionPressed = false;
    this.#of(seat).actionHeld = false;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  lift(seat: SeatId): void {
    this.#of(seat).pointer = null;
  }

  steer(seat: SeatId, x: number, y = 0): void {
    this.#of(seat).move.x = x;
    this.#of(seat).move.y = y;
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

interface Spec {
  readonly p1?: readonly (readonly [number, number])[];
  readonly p2?: readonly (readonly [number, number])[];
  readonly dice?: readonly number[];
  readonly off?: readonly [number, number];
  readonly bar?: readonly [number, number];
  readonly seat?: SeatId;
}

/** Put a live game into a stated position, the way a test wants to talk about one. */
function setUp(game: BackgammonGame, spec: Spec): Position {
  const position = game.position;
  position.points.fill(0);
  for (const [travel, count] of spec.p1 ?? []) {
    position.points[boardIndex('p1', travel)] = count;
  }
  for (const [travel, count] of spec.p2 ?? []) {
    position.points[boardIndex('p2', travel)] = -count;
  }
  position.barP1 = spec.bar?.[0] ?? 0;
  position.barP2 = spec.bar?.[1] ?? 0;
  position.offP1 = spec.off?.[0] ?? 0;
  position.offP2 = spec.off?.[1] ?? 0;
  position.seat = spec.seat ?? 'p1';
  position.dice.length = 0;
  for (const die of spec.dice ?? []) position.dice.push(die);
  position.phase = position.dice.length > 0 ? 'moving' : 'rolling';
  return position;
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

  count(op: string): number {
    return this.calls.filter((call) => call.op === op).length;
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

describe('the geometry', () => {
  it('puts every point inside the board', () => {
    for (let index = 0; index < POINTS; index += 1) {
      expect(pointX(index)).toBeGreaterThan(0);
      expect(pointX(index)).toBeLessThan(BOARD);
      expect(pointBaseY(index)).toBeGreaterThan(0);
      expect(pointBaseY(index)).toBeLessThan(BOARD);
    }
  });

  it('is unchanged by the half turn', () => {
    // The one property the whole layout was chosen for: point i sits exactly where point
    // 23 − i sits once the board has turned, so both seats read their own position the same.
    for (let index = 0; index < POINTS; index += 1) {
      const opposite = POINTS - 1 - index;
      expect(pointX(index) + pointX(opposite), `x of ${String(index)}`).toBeCloseTo(BOARD, 6);
      expect(pointBaseY(index) + pointBaseY(opposite), `y of ${String(index)}`).toBe(BOARD);
      for (let slot = 0; slot < STACK_SHOWN; slot += 1) {
        expect(stackY(index, slot) + stackY(opposite, slot)).toBe(BOARD);
      }
    }
  });

  it('keeps each seat tray and bar spot opposite the other', () => {
    expect(trayX('p1') + trayX('p2')).toBeCloseTo(BOARD, 6);
    expect(trayY('p1') + trayY('p2')).toBe(BOARD);
    expect(barX('p1') + barX('p2')).toBe(BOARD);
    expect(barX('p1')).toBeGreaterThan(BOARD / 2);
  });

  it('stacks checkers along the point and stops at five', () => {
    const first = stackY(0, 0);
    const fifth = stackY(0, STACK_SHOWN - 1);
    expect(fifth, 'the top row stacks downward').toBeGreaterThan(first);
    expect(fifth - TOP_BASE, 'and stays on the point').toBeLessThan(POINT_LENGTH);
    expect(stackY(0, 40), 'a deeper stack piles onto the last slot').toBe(fifth);
    expect(stackY(COLUMNS, 1), 'the bottom row stacks upward').toBeLessThan(stackY(COLUMNS, 0));
  });

  it('anchors a move on the point it starts from, the bar and the tray', () => {
    expect(anchorX('p1', 6)).toBe(pointX(boardIndex('p1', 6)));
    expect(anchorX('p1', BAR)).toBe(barX('p1'));
    expect(anchorY('p1', BAR)).toBe(BOARD / 2);
    expect(anchorX('p1', BEAR_OFF)).toBe(trayX('p1'));
    expect(anchorY('p2', BEAR_OFF)).toBe(trayY('p2'));
  });

  it('keeps the middle strip clear of both rows of points', () => {
    expect(BAR_TOP).toBeLessThan(BOARD / 2);
    expect(BAR_BOTTOM).toBeGreaterThan(BOARD / 2);
    expect(BAR_TOP + BAR_BOTTOM, 'and centred, like everything else').toBe(BOARD);
    for (let index = 0; index < POINTS; index += 1) {
      const tip = stackY(index, STACK_SHOWN - 1);
      expect(tip > BAR_TOP && tip < BAR_BOTTOM, `point ${String(index)} runs into the bar`).toBe(
        false,
      );
    }
  });
});

describe('taking a turn', () => {
  it('rolls on the action key', () => {
    const game = new BackgammonGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('moving');
    expect(game.position.dice.length).toBeGreaterThanOrEqual(2);
  });

  it('does not roll again while the key is held', () => {
    const game = new BackgammonGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    input.press('p1');
    game.update(STEP, input);
    const rolled = game.position.rolled.join(',');
    input.release('p1');
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.rolled.join(','), 'the same throw').toBe(rolled);
  });

  it('plays the move a finger lands on', () => {
    const game = new BackgammonGame();
    game.init(makeContext(5));
    setUp(game, {
      p1: [
        [4, 1],
        [15, 1],
      ],
      dice: [3],
    });
    const input = new ScriptedInput();
    input.point('p1', anchorX('p1', 15), anchorY('p1', 15));
    input.press('p1');
    game.update(STEP, input);
    expect(ownAt(game.position, 'p1', 18), 'the one under the finger moved').toBe(1);
    expect(ownAt(game.position, 'p1', 4), 'and the other did not').toBe(1);
  });

  it('picks the die by where the finger lands', () => {
    // Both moves start on the same point, so the landing point is what a tap can say.
    const near = (): BackgammonGame => {
      const game = new BackgammonGame();
      game.init(makeContext(7));
      setUp(game, { p1: [[4, 1]], dice: [5, 2] });
      return game;
    };

    const short = near();
    const shortInput = new ScriptedInput();
    shortInput.point('p1', anchorX('p1', 6), anchorY('p1', 6));
    shortInput.press('p1');
    short.update(STEP, shortInput);
    expect(ownAt(short.position, 'p1', 6), 'tapped near, played the two').toBe(1);

    const long = near();
    const longInput = new ScriptedInput();
    longInput.point('p1', anchorX('p1', 9), anchorY('p1', 9));
    longInput.press('p1');
    long.update(STEP, longInput);
    expect(ownAt(long.position, 'p1', 9), 'tapped far, played the five').toBe(1);
  });

  it('steps through the moves on the keyboard and plays the one it stops on', () => {
    const game = new BackgammonGame();
    game.init(makeContext(11));
    setUp(game, {
      p1: [
        [4, 1],
        [9, 1],
      ],
      dice: [5, 2],
    });
    const input = new ScriptedInput();
    // The move list is the seat's legal moves for the step being taken, recomputed at the
    // top of every `update`. A test that writes a position straight into the game has to
    // let a step run before reading it back, exactly as the rendering tests below do.
    game.update(STEP, input);
    expect(game.moveCount, 'two points, two dice').toBe(4);
    expect(moveFrom(game.selectedMove), 'the first move is selected to begin with').toBe(4);

    input.steer('p1', 1);
    game.update(STEP, input);
    expect(moveDie(game.selectedMove), 'one step along is the same point, the other die').toBe(5);

    input.press('p1');
    game.update(STEP, input);
    expect(ownAt(game.position, 'p1', 9), 'and that is the move it played').toBe(2);
  });

  it('never lets the seat that is not to move touch the board', () => {
    const game = new BackgammonGame();
    game.init(makeContext(13));
    setUp(game, { p1: [[4, 1]], dice: [3] });
    const input = new ScriptedInput();
    input.point('p2', anchorX('p1', 4), anchorY('p1', 4));
    input.press('p2');
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(ownAt(game.position, 'p1', 4), 'nothing moved').toBe(1);
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('holds a dead roll on screen before passing the turn', () => {
    // Being shut out on the bar is the commonest way a turn has nothing in it, and a turn
    // that silently bounces back looks like the game ignored someone.
    const game = new BackgammonGame();
    game.init(makeContext(17));
    const shut: (readonly [number, number])[] = [];
    for (let travel = 0; travel < 6; travel += 1) shut.push([POINTS - 1 - travel, 2]);
    setUp(game, { p1: [[10, 1]], p2: shut, bar: [1, 0], dice: [6, 3] });
    const input = new ScriptedInput();

    game.update(STEP, input);
    expect(game.getActiveSeat(), 'still your turn a frame later').toBe('p1');
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.getActiveSeat(), 'and a third of a second on').toBe('p1');
    for (let i = 0; i < 40; i += 1) game.update(STEP, input);
    expect(game.getActiveSeat(), 'then it changes hands').toBe('p2');
  });

  it('passes a turn whose second die has nothing left to do', () => {
    // The other way into a turn with no move in it, and the one a human reaches on their
    // own: the roll had a move, it was played, and what is left of the roll does not. The
    // pass is checked against the position rather than against the throw for exactly this
    // — a game that only looks for a dead roll leaves a human sitting on a live board with
    // a die they cannot use, no move to make and no way to hand the turn over.
    const game = new BackgammonGame();
    game.init(makeContext(151));
    const wall: (readonly [number, number])[] = [];
    // Closes every point of p1's home board except the twenty-third, which the six reaches.
    for (const travel of [0, 2, 3, 4, 5, 6]) wall.push([travel, 2]);
    setUp(game, { p1: [[16, 1]], p2: wall, dice: [6, 1] });
    const input = new ScriptedInput();

    game.update(STEP, input);
    expect(game.moveCount, 'only the six goes anywhere').toBe(1);
    input.press('p1');
    game.update(STEP, input);
    expect(ownAt(game.position, 'p1', 22), 'and it is played').toBe(1);
    expect([...game.position.dice], 'leaving the one in hand').toEqual([1]);
    expect(game.getActiveSeat(), 'still p1, holding a die that does nothing').toBe('p1');

    input.release('p1');
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.getActiveSeat(), 'so the rest of the turn passes').toBe('p2');
    expect(game.position.phase, 'and the next seat gets a fresh throw').toBe('rolling');
  });

  it('never plays for a human seat', () => {
    const game = new BackgammonGame();
    game.init(makeContext(19, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.phase, 'a silent human throws nothing').toBe('rolling');
    expect(game.getActiveSeat()).toBe('p1');
  });
});

describe('a keyboard and a thumb play the same game', () => {
  /** One seeded script, spelled twice: as key presses, and as a finger on the same beat. */
  function drive(instrument: 'keyboard' | 'pointer', seed: number): number {
    const game = new BackgammonGame();
    game.init(makeContext(seed, null, 'normal'));
    const input = new ScriptedInput();
    const rng = new Rng(seed);
    let progress = 0;
    let last = '';
    for (let step = 0; step < 60 * 120; step += 1) {
      const engaged = step % 24 < 4;
      if (instrument === 'keyboard') {
        input.lift('p1');
        input.steer('p1', step % 24 < 12 ? 1 : -1, 0);
      } else {
        const travel = rng.int(0, POINTS);
        input.point('p1', anchorX('p1', travel), anchorY('p1', travel));
      }
      if (engaged) input.press('p1');
      else input.release('p1');
      game.update(STEP, input);
      const score = game.getScore();
      const shown = `${String(score.p1)}:${String(score.p2)}`;
      if (shown !== last) {
        if (last !== '') progress += 1;
        last = shown;
      }
      if (score.winner !== null) break;
    }
    game.destroy();
    return progress;
  }

  it('moves the game on the keyboard', () => {
    expect(drive('keyboard', 101)).toBeGreaterThan(10);
  });

  it('moves the game on a thumb', () => {
    expect(drive('pointer', 101)).toBeGreaterThan(10);
  });

  it('moves it about as much either way', () => {
    // Not identical — an absolute finger and a held key are different instruments — but
    // neither may be an order of magnitude better at simply playing the game.
    const byKey = drive('keyboard', 211);
    const byThumb = drive('pointer', 211);
    expect(byKey).toBeGreaterThan(byThumb / 4);
    expect(byThumb).toBeGreaterThan(byKey / 4);
  });
});

describe('the match', () => {
  it('starts level with no winner', () => {
    const game = new BackgammonGame();
    game.init(makeContext(23));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('reports how far each seat has come', () => {
    const game = new BackgammonGame();
    game.init(makeContext(29));
    setUp(game, { p1: [[4, 1]], dice: [3] });
    const before = game.getScore().p1;
    const input = new ScriptedInput();
    input.point('p1', anchorX('p1', 4), anchorY('p1', 4));
    input.press('p1');
    game.update(STEP, input);
    expect(game.getScore().p1, 'three pips further along').toBe(before + 3);
    expect(game.getScore().p1).toBe(pipsGained(game.position, 'p1'));
  });

  it('plays a whole bot match to a winner', () => {
    const game = new BackgammonGame();
    game.init(makeContext(31, 'hard', 'easy'));
    const input = new ScriptedInput();
    let steps = 0;
    for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
    expect(steps, 'and well inside ten simulated minutes').toBeLessThan(60 * 400);
  });

  it('reaches a decision with two easy bots, which is the weakest pairing', () => {
    // The local mirror of the catalogue-wide termination guard: the weakest play is the
    // most likely to reach a position nothing resolves.
    const game = new BackgammonGame();
    game.init(makeContext(37, 'easy', 'easy'));
    const input = new ScriptedInput();
    let steps = 0;
    for (; steps < 60 * 600 && game.getScore().winner === null; steps += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner, 'two easy bots never finished').not.toBeNull();
  });

  it('stops changing once it is decided', () => {
    const game = new BackgammonGame();
    game.init(makeContext(41, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new BackgammonGame();
      game.init(makeContext(43, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, input);
        if (i % 120 === 0) {
          const score = game.getScore();
          out.push(`${String(score.p1)}:${String(score.p2)}`);
        }
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('steps the identical match at sixty and at a hundred and twenty', () => {
    // Rule 8: the delays are counted in steps taken from the rate, so the same simulated
    // second holds the same position however often the loop ticks.
    //
    // Sampled on the step that *completes* a whole simulated second — `(i + 1) % rate` and
    // not `i % rate`. The latter reads the two runs at 1/60 s and 1/120 s past the second,
    // which are different instants, and a move that falls between them is a difference in
    // when the trace was read rather than in what the match did.
    const sample = (rate: number): string => {
      const game = new BackgammonGame();
      game.init(makeContext(47, 'hard', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < rate * 90; i += 1) {
        game.update(1 / rate, input);
        if ((i + 1) % rate === 0) {
          const score = game.getScore();
          out.push(`${String(score.p1)}:${String(score.p2)}:${game.getActiveSeat()}`);
        }
      }
      return out.join('|');
    };
    expect(sample(120)).toBe(sample(60));
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new BackgammonGame();
    game.init(makeContext(53, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 60; i += 1) game.update(STEP, input);
    game.init(makeContext(53, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.moveCount).toBe(0);
  });

  it('survives a pause and a resume in the middle of a turn', () => {
    const game = new BackgammonGame();
    game.init(makeContext(59, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.getScore());
    game.onPause();
    game.onResume();
    expect(JSON.stringify(game.getScore())).toBe(before);
  });
});

describe('rendering', () => {
  it('draws the board, both sets of checkers and the dice', () => {
    const game = new BackgammonGame();
    game.init(makeContext(61));
    setUp(game, { p1: [[4, 2]], p2: [[9, 3]], dice: [5, 2] });
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.count('rect'), 'seven slices a point, plus the frame').toBeGreaterThan(
      POINTS * 7,
    );
    expect(renderer.count('circle'), 'five checkers and the die pips').toBeGreaterThan(5);
    expect(renderer.ops).toContain('clear');
  });

  it('tells the two seats apart without the colour', () => {
    const game = new BackgammonGame();
    game.init(makeContext(67));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const rings = renderer.calls.filter(
      (call) =>
        call.op === 'strokeCircle' && call.args[3] === 4 && call.args[4] === SEAT_PALETTE.p1.deep,
    ).length;
    const bars = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === SEAT_PALETTE.p2.deep,
    ).length;
    expect(rings, 'a ring inside every checker of seat one').toBeGreaterThan(8);
    expect(bars, 'and a bar across every checker of seat two').toBeGreaterThan(8);
    expect(rings).toBe(bars);
  });

  it('shows the move a press would play, and nothing when there is none', () => {
    const game = new BackgammonGame();
    game.init(makeContext(71));
    setUp(game, { p1: [[4, 1]], dice: [3] });
    game.update(STEP, new ScriptedInput());
    const withMove = new RecordingRenderer();
    game.render(withMove, 0);
    expect(withMove.count('line'), 'source to destination').toBe(1);

    setUp(game, { p1: [[4, 1]], p2: [[POINTS - 1 - 7, 2]], dice: [3] });
    game.update(STEP, new ScriptedInput());
    const shutOut = new RecordingRenderer();
    game.render(shutOut, 0);
    expect(shutOut.count('line'), 'nothing to point at').toBe(0);
  });

  it('marks the points a checker may leave this turn', () => {
    const game = new BackgammonGame();
    game.init(makeContext(73));
    setUp(game, {
      p1: [
        [4, 1],
        [9, 1],
      ],
      dice: [5, 2],
    });
    game.update(STEP, new ScriptedInput());
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const dots = renderer.calls.filter((call) => call.op === 'circle' && call.args[2] === 5).length;
    expect(dots, 'one under each of the two points, not one per die').toBe(2);
  });

  it('shows the dice as pips', () => {
    const game = new BackgammonGame();
    game.init(makeContext(79));
    setUp(game, { p1: [[4, 1]], dice: [5] });
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const half = DIE_SIZE / 2;
    const pips = renderer.calls.filter(
      (call) =>
        call.op === 'circle' &&
        typeof call.args[0] === 'number' &&
        typeof call.args[1] === 'number' &&
        Math.abs(call.args[0] - BOARD / 2) <= half &&
        Math.abs(call.args[1] - BOARD / 2) <= half &&
        typeof call.args[2] === 'number' &&
        call.args[2] < 8,
    ).length;
    expect(pips, 'five of them').toBe(5);
  });

  it('turns the board to face whoever is to move', () => {
    const game = new BackgammonGame();
    game.init(makeContext(83));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops).toContain('pushRotation');
    expect(renderer.ops).toContain('popSeatRotation');
  });

  it('draws nothing outside the logical box', () => {
    const game = new BackgammonGame();
    game.init(makeContext(89, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 3600; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-CHECKER_RADIUS * 2);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(BOARD + CHECKER_RADIUS);
      }
    }
  });

  it('draws a full tray once a seat starts bearing off', () => {
    const game = new BackgammonGame();
    game.init(makeContext(97));
    setUp(game, { p1: [[20, 1]], off: [CHECKERS - 1, 0], dice: [4] });
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const trayBars = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === SEAT_PALETTE.p1.base,
    ).length;
    expect(trayBars, 'fourteen borne off').toBe(CHECKERS - 1);
    expect(renderer.args).toContain(`${String(CHECKERS - 1)}/${String(CHECKERS)}`);
  });

  it('does not mutate the position', () => {
    const game = new BackgammonGame();
    game.init(makeContext(101, 'normal', 'normal'));
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
    expect(manifest.id).toBe('backgammon');
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.zoneSplit, 'one board both players reach across').toBe('shared-board');
    expect(manifest.logical.width).toBe(BOARD);
    expect(manifest.logical.height).toBe(BOARD);
  });

  it('names each seat its own half of the keyboard, and the halves the engine binds', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toContain('W A S D');
    expect(keyboard).toContain(DEFAULT_BINDINGS.p1.action === 'Space' ? 'Space' : 'unknown');
    expect(keyboard).toContain('arrows');
    expect(keyboard).toContain(DEFAULT_BINDINGS.p2.action === 'Enter' ? 'Enter' : 'unknown');
    expect(keyboard, 'never offered as one player choosing a half').not.toMatch(
      /\bor\b[^,:]*arrow/i,
    );
  });

  it('describes the pointer the code actually implements', () => {
    // Both halves of the sentence are behaviour with a test above it: the tap chooses the
    // point, and where it lands within that point chooses the die.
    expect(manifest.controls.pointer).toContain('tap the point you want to move from');
    expect(manifest.controls.pointer).toContain('landing point');
  });

  it('offers both a friend and a bot', () => {
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
    expect(manifest.presentations).toContain('shared-screen');
    expect(manifest.presentations).toContain('single-seat');
  });

  it('reports whose turn it is, which is what makes it a turn game to the shell', () => {
    const game = new BackgammonGame();
    game.init(makeContext(103));
    expect(typeof game.getActiveSeat).toBe('function');
    expect(game.getActiveSeat()).toBe('p1');
  });
});

describe('the single-seat presentation', () => {
  it('never turns the board when one seat owns the whole device', () => {
    const game = new BackgammonGame();
    game.init({ ...makeContext(107, null, 'normal'), presentation: 'single-seat' });
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const rotation = renderer.calls.find((call) => call.op === 'pushRotation');
    expect(rotation?.args[0], 'upright, whoever is to move').toBe(0);
  });

  it('plays the same rules for the far seat as the near one', () => {
    const game = new BackgammonGame();
    game.init({ ...makeContext(109, 'normal', null), localSeat: 'p2' });
    const input = new ScriptedInput();
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    expect(game.getScore().p1, 'the bot in seat one has been playing').toBeGreaterThan(0);
    expect(game.getScore().p2, 'and the silent human in seat two has not').toBe(0);
  });
});
