import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { CornholeGame } from './game.js';
import {
  BAGS_PER_ROUND,
  BOARD_BOTTOM,
  BOARD_LEFT,
  FLIGHT_SECONDS,
  HOLE_X,
  HOLE_Y,
  ROUNDS,
  TARGET_SCORE,
  THROW_X,
  THROW_Y,
} from './rules.js';
import type { BotDifficulty, Game as Position } from './rules.js';

const STEP = 1 / 60;

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

  down(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = true;
    target.actionHeld = true;
    target.actionReleased = false;
  }

  dragTo(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
    target.actionPressed = false;
    target.actionHeld = true;
    target.actionReleased = false;
  }

  /** The finger lifting: the pointer is gone on this step, as the engine reports it. */
  lift(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = true;
  }

  hold(seat: SeatId, seconds: number): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionHeld = true;
    target.actionPressed = false;
    target.actionReleased = false;
    target.holdSeconds = seconds;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionHeld = false;
    target.actionPressed = false;
    target.actionReleased = true;
  }

  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
  }

  idle(seat: SeatId): void {
    const target = this.#of(seat);
    target.pointer = null;
    target.actionPressed = false;
    target.actionHeld = false;
    target.actionReleased = false;
    target.holdSeconds = 0;
    target.move.x = 0;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  presentation: 'shared-screen' | 'single-seat' = 'shared-screen',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

type DrawArg = number | string | boolean | undefined;

class RecordingRenderer implements Renderer {
  readonly ops: string[] = [];
  readonly args: DrawArg[] = [];

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#record('rect', x, y, width, height, colour);
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
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#record('circle', x, y, radius, colour);
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#record('strokeCircle', x, y, radius, lineWidth, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lineWidth, colour);
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
    this.ops.push(op);
    for (const value of values) this.args.push(value);
  }
}

function fixture(game: CornholeGame): Position {
  return game.position;
}

function settle(game: CornholeGame, input: ScriptedInput, steps = 40): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, input);
}

/** A pull-back throw: press, drag back, lift. */
function throwWith(
  game: CornholeGame,
  input: ScriptedInput,
  seat: SeatId,
  dx: number,
  dy: number,
): void {
  input.down(seat, THROW_X, THROW_Y - 200);
  game.update(STEP, input);
  input.dragTo(seat, THROW_X + dx, THROW_Y - 200 + dy);
  game.update(STEP, input);
  input.lift(seat);
  game.update(STEP, input);
  input.idle(seat);
}

describe('aiming with a finger', () => {
  it('shows nothing until the controls are touched', () => {
    const game = new CornholeGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    settle(game, input);
    expect(game.aim.ready, 'an untouched aim is not an aim').toBe(false);
  });

  it('takes sideways for aim and pulling back for power', () => {
    const game = new CornholeGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    settle(game, input);

    input.down('p1', THROW_X, THROW_Y - 200);
    game.update(STEP, input);
    input.dragTo('p1', THROW_X + 130, THROW_Y - 200 + 130);
    game.update(STEP, input);

    expect(game.aim.angle, 'dragged right, aiming right').toBeGreaterThan(0);
    expect(game.aim.power, 'pulled back, power built').toBeGreaterThan(0);
    expect(game.aim.ready).toBe(true);
  });

  it('throws on the lift, when the pointer is already gone', () => {
    const game = new CornholeGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    settle(game, input);
    throwWith(game, input, 'p1', 0, 160);
    expect(game.position.bags.length, 'a bag was thrown').toBe(1);
    expect(game.position.left.p1).toBe(BAGS_PER_ROUND - 1);
  });

  it('does not throw on a lift with no power behind it', () => {
    // A tap that never pulled back is not a throw, and sending one would waste a bag.
    const game = new CornholeGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    settle(game, input);
    input.down('p1', THROW_X, THROW_Y - 200);
    game.update(STEP, input);
    input.lift('p1');
    game.update(STEP, input);
    expect(game.position.bags.length).toBe(0);
    expect(game.position.left.p1).toBe(BAGS_PER_ROUND);
  });

  it('clears the aim after a throw, so the next one starts fresh', () => {
    const game = new CornholeGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    settle(game, input);
    throwWith(game, input, 'p1', 120, 200);
    expect(game.aim.ready).toBe(false);
    expect(game.aim.power).toBe(0);
  });

  it('accepts nothing while the field is turning', () => {
    const game = new CornholeGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    settle(game, input);
    throwWith(game, input, 'p1', 0, 160);
    for (let i = 0; i < Math.ceil(FLIGHT_SECONDS / STEP) + 2; i += 1) game.update(STEP, input);
    expect(game.position.toThrow).toBe('p2');

    input.down('p2', THROW_X, THROW_Y - 200);
    game.update(STEP, input);
    expect(game.aim.ready, 'a touch during the flip is ignored').toBe(false);
  });

  it('drops a half-pulled aim when the game pauses', () => {
    const game = new CornholeGame();
    game.init(makeContext(15));
    const input = new ScriptedInput();
    settle(game, input);
    input.down('p1', THROW_X, THROW_Y - 200);
    game.update(STEP, input);
    input.dragTo('p1', THROW_X, THROW_Y - 100);
    game.update(STEP, input);
    expect(game.aim.ready).toBe(true);
    game.onPause();
    expect(game.aim.ready, 'an aim nobody still means').toBe(false);
  });
});

describe('aiming with a keyboard', () => {
  it('steers the aim and builds power on a hold', () => {
    const game = new CornholeGame();
    game.init(makeContext(21));
    const input = new ScriptedInput();
    settle(game, input);

    input.steer('p1', 1);
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.aim.angle, 'steered right').toBeGreaterThan(0);

    input.steer('p1', 0);
    input.hold('p1', 0.6);
    game.update(STEP, input);
    expect(game.aim.power, 'the hold built power').toBeGreaterThan(0);

    input.release('p1');
    game.update(STEP, input);
    expect(game.position.bags.length, 'and the release threw').toBe(1);
  });

  it('reaches full power on a long enough hold, and no further', () => {
    const game = new CornholeGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    settle(game, input);
    input.hold('p1', 99);
    game.update(STEP, input);
    expect(game.aim.power).toBe(1);
  });
});

describe('the match', () => {
  it('reports the score and no winner while rounds remain', () => {
    const game = new CornholeGame();
    game.init(makeContext(31));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('names the seat to throw', () => {
    const game = new CornholeGame();
    game.init(makeContext(33));
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('settles a round and starts the next', () => {
    const game = new CornholeGame();
    game.init(makeContext(35));
    const input = new ScriptedInput();
    settle(game, input);
    const position = fixture(game);
    position.left.p1 = 0;
    position.left.p2 = 0;
    position.bags.push({ seat: 'p1', x: HOLE_X, y: BOARD_BOTTOM - 40, holed: false });
    position.phase = 'round-over';

    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    expect(game.position.round, 'the round advanced').toBe(1);
    expect(game.position.bags.length, 'and the board was cleared').toBe(0);
    expect(game.getScore().p1, 'one bag on the board, uncontested').toBe(1);
  });

  it('plays a whole bot match to a result', () => {
    const game = new CornholeGame();
    game.init(makeContext(37, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 600 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new CornholeGame();
      game.init(makeContext(39, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 120; i += 1) {
        game.update(STEP, input);
        if (i % 40 === 0) {
          out.push(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`);
        }
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new CornholeGame();
    game.init(makeContext(41, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    game.init(makeContext(41, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.round).toBe(0);
    expect(game.position.bags.length).toBe(0);
  });

  it('clears on destroy', () => {
    const game = new CornholeGame();
    game.init(makeContext(43, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

describe('the bot', () => {
  it('never throws for the human seat', () => {
    const game = new CornholeGame();
    game.init(makeContext(51, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    expect(game.position.left.p1, 'a silent human throws nothing').toBe(BAGS_PER_ROUND);
    expect(game.position.toThrow).toBe('p1');
  });

  it('thinks for a beat rather than throwing instantly', () => {
    const game = new CornholeGame();
    game.init(makeContext(53, 'normal', null));
    const input = new ScriptedInput();
    game.update(STEP, input);
    expect(game.position.bags.length).toBe(0);
    for (let i = 0; i < 100; i += 1) game.update(STEP, input);
    expect(game.position.bags.length).toBe(1);
  });
});

describe('rendering', () => {
  it('draws the board and the hole', () => {
    const game = new CornholeGame();
    game.init(makeContext(61));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(1);
    expect(renderer.ops.filter((op) => op === 'popSeatRotation').length).toBe(1);
    expect(renderer.args).toContain('#0d1410');
  });

  it('tells the two seats bags apart by shape', () => {
    // Working out whose bags are where *is* the scoring, so it may not rest on colour.
    const game = new CornholeGame();
    game.init(makeContext(63));
    const position = fixture(game);
    position.bags.push({ seat: 'p1', x: BOARD_LEFT + 60, y: BOARD_BOTTOM - 60, holed: false });
    const withRound = new RecordingRenderer();
    game.render(withRound, 0);
    const circles = withRound.ops.filter((op) => op === 'circle').length;

    position.bags.length = 0;
    position.bags.push({ seat: 'p2', x: BOARD_LEFT + 60, y: BOARD_BOTTOM - 60, holed: false });
    const withSquare = new RecordingRenderer();
    game.render(withSquare, 0);
    expect(withSquare.ops.filter((op) => op === 'circle').length).toBeLessThan(circles);
    expect(withSquare.args).toContain(SEAT_PALETTE.p2.base);
  });

  it('shows the aim only once it has been touched', () => {
    const game = new CornholeGame();
    game.init(makeContext(65));
    const input = new ScriptedInput();
    settle(game, input);
    const before = new RecordingRenderer();
    game.render(before, 0);
    const linesBefore = before.ops.filter((op) => op === 'line').length;

    input.down('p1', THROW_X, THROW_Y - 200);
    game.update(STEP, input);
    input.dragTo('p1', THROW_X + 60, THROW_Y - 80);
    game.update(STEP, input);
    const after = new RecordingRenderer();
    game.render(after, 0);
    expect(after.ops.filter((op) => op === 'line').length).toBeGreaterThan(linesBefore);
  });

  it('shows power as a count of ticks, not only as a length', () => {
    // Length alone is hard to judge, and a player choosing power needs to be able to
    // repeat a throw they liked.
    const game = new CornholeGame();
    game.init(makeContext(67));
    const input = new ScriptedInput();
    settle(game, input);
    input.hold('p1', 0.2);
    game.update(STEP, input);
    const light = new RecordingRenderer();
    game.render(light, 0);

    input.hold('p1', 1.1);
    game.update(STEP, input);
    const heavy = new RecordingRenderer();
    game.render(heavy, 0);
    expect(
      heavy.ops.filter((op) => op === 'rect').length,
      'more power draws more ticks',
    ).toBeGreaterThan(light.ops.filter((op) => op === 'rect').length);
  });

  it('moves the bag through its flight', () => {
    const game = new CornholeGame();
    game.init(makeContext(69));
    const input = new ScriptedInput();
    settle(game, input);
    throwWith(game, input, 'p1', 0, 160);
    expect(game.position.phase).toBe('flying');

    const early = new RecordingRenderer();
    game.render(early, 0);
    for (let i = 0; i < 12; i += 1) game.update(STEP, input);
    const later = new RecordingRenderer();
    game.render(later, 0);
    expect(later.args.join(','), 'the bag has travelled').not.toBe(early.args.join(','));
  });

  it('draws nothing outside the logical play area', () => {
    const game = new CornholeGame();
    game.init(makeContext(71, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-200);
      expect(value).toBeLessThan(manifest.logical.width + 200);
    }
  });

  it('does not mutate the position', () => {
    const game = new CornholeGame();
    game.init(makeContext(73, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = game.position.bags.map((b) => `${b.seat}${String(Math.round(b.x))}`).join('');
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0.5);
    expect(game.position.bags.map((b) => `${b.seat}${String(Math.round(b.x))}`).join('')).toBe(
      before,
    );
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('cornhole');
    expect(manifest.archetype).toBe('turn-aim');
  });

  it('says what a round and a match are worth', () => {
    expect(ROUNDS).toBeGreaterThan(1);
    expect(TARGET_SCORE).toBeGreaterThan(0);
    expect(HOLE_Y).toBeLessThan(THROW_Y);
  });
});
