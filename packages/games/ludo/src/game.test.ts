import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  BOARD,
  DIE_SIZE,
  DIE_X,
  DIE_Y,
  LudoGame,
  squareCentre,
  startCentre,
  tokenCentre,
} from './game.js';
import { AT_START, HOME, RELEASE_ROLL, TOKENS, TRACK, leadOf, loopSquare } from './rules.js';
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

  press(seat: SeatId): void {
    this.#of(seat).actionPressed = true;
  }

  release(seat: SeatId): void {
    this.#of(seat).actionPressed = false;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  steer(seat: SeatId, x: number): void {
    this.#of(seat).move.x = x;
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

describe('the geometry', () => {
  it('puts every square of the loop on the board', () => {
    for (let square = 0; square < TRACK; square += 1) {
      const centre = squareCentre(square);
      expect(centre.x).toBeGreaterThan(0);
      expect(centre.x).toBeLessThan(BOARD);
      expect(centre.y).toBeGreaterThan(0);
      expect(centre.y).toBeLessThan(BOARD);
    }
  });

  it('spaces the squares evenly round the ring', () => {
    // A ring rather than a cross: every square is the same distance from the middle, so no
    // square is harder to reach with a thumb than another.
    const first = squareCentre(0);
    const gap = Math.hypot(squareCentre(1).x - first.x, squareCentre(1).y - first.y);
    for (let square = 1; square < TRACK; square += 1) {
      const a = squareCentre(square);
      const b = squareCentre((square + 1) % TRACK);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(gap, 3);
    }
  });

  it('keeps the two seats start areas apart, and clear of the die', () => {
    // Either side of the die inside the ring. A row along the top and bottom collided with
    // the status line and put untappable tokens where a thumb rests.
    for (let token = 0; token < TOKENS; token += 1) {
      const one = startCentre('p1', token);
      const two = startCentre('p2', token);
      expect(Math.abs(one.x - two.x), 'well apart').toBeGreaterThan(300);
      for (const centre of [one, two]) {
        const overDie =
          centre.x > DIE_X - 24 &&
          centre.x < DIE_X + DIE_SIZE + 24 &&
          centre.y > DIE_Y - 24 &&
          centre.y < DIE_Y + DIE_SIZE + 24;
        expect(overDie, 'not on top of the die').toBe(false);
      }
    }
  });

  it('walks a home token in toward the middle', () => {
    const first = tokenCentre('p1', TRACK, 0);
    const last = tokenCentre('p1', HOME - 1, 0);
    const middle = { x: BOARD / 2, y: BOARD / 2 };
    expect(Math.hypot(last.x - middle.x, last.y - middle.y)).toBeLessThan(
      Math.hypot(first.x - middle.x, first.y - middle.y),
    );
  });

  it('draws a token at the start away from the loop', () => {
    const start = tokenCentre('p1', AT_START, 0);
    for (let square = 0; square < TRACK; square += 1) {
      const centre = squareCentre(square);
      expect(Math.hypot(centre.x - start.x, centre.y - start.y)).toBeGreaterThan(20);
    }
  });
});

describe('taking a turn', () => {
  it('rolls on the action key', () => {
    const game = new LudoGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.die).toBeGreaterThan(0);
    expect(game.position.phase).toBe('choosing');
  });

  it('moves the token a finger lands on', () => {
    const game = new LudoGame();
    game.init(makeContext(5));
    game.position.p1[1] = 4;
    game.position.die = 3;
    game.position.phase = 'choosing';
    const input = new ScriptedInput();
    const centre = tokenCentre('p1', 4, 1);
    input.point('p1', centre.x, centre.y);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.p1[1]).toBe(7);
  });

  it('ignores a tap on empty board', () => {
    const game = new LudoGame();
    game.init(makeContext(7));
    game.position.p1[0] = 4;
    game.position.die = 3;
    game.position.phase = 'choosing';
    const input = new ScriptedInput();
    input.point('p1', 10, 10);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.p1[0], 'nothing moved').toBe(4);
  });

  it('holds a dead roll on screen before passing the turn', () => {
    // A turn that silently bounces back looks like the game ignored someone.
    const game = new LudoGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    game.position.die = 3; // nothing can move: all three are at the start
    game.position.phase = 'choosing';
    game.update(STEP, input);
    expect(game.position.seat, 'still your turn a frame later').toBe('p1');
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.seat, 'and half a second on').toBe('p1');
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(game.position.seat, 'then it changes hands').toBe('p2');
  });
});

describe('the match', () => {
  it('starts with both tokens at the gate', () => {
    const game = new LudoGame();
    game.init(makeContext(13));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('reports how far each leading token has come', () => {
    const game = new LudoGame();
    game.init(makeContext(17));
    game.position.p1[2] = 19;
    expect(game.getScore().p1).toBe(19);
    expect(leadOf(game.position, 'p1')).toBe(19);
  });

  it('plays a whole bot match to a winner', () => {
    const game = new LudoGame();
    game.init(makeContext(19, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('stops changing once it is decided', () => {
    const game = new LudoGame();
    game.init(makeContext(23, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = JSON.stringify(game.getScore());
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new LudoGame();
      game.init(makeContext(29, 'normal', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 200; i += 1) {
        game.update(STEP, input);
        if (i % 120 === 0) out.push(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init and clears on destroy', () => {
    const game = new LudoGame();
    game.init(makeContext(31, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400; i += 1) game.update(STEP, input);
    game.init(makeContext(31, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('never plays for a human seat', () => {
    const game = new LudoGame();
    game.init(makeContext(37, null, 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.die, 'a silent human rolls nothing').toBe(0);
    expect(game.position.seat).toBe('p1');
  });
});

describe('rendering', () => {
  it('draws the whole loop, both home columns and every token', () => {
    const game = new LudoGame();
    game.init(makeContext(41));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const discs = renderer.calls.filter((call) => call.op === 'circle').length;
    expect(discs, 'thirty-two squares and six tokens at least').toBeGreaterThanOrEqual(TRACK + 6);
  });

  it('marks each seat entry square in its own colour', () => {
    // Where you join the loop is the one thing a new player has to be shown.
    const game = new LudoGame();
    game.init(makeContext(43));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const entry = squareCentre(loopSquare('p1', 0));
    const marked = renderer.calls.some(
      (call) =>
        call.op === 'circle' && call.args[0] === entry.x && call.args[3] === SEAT_PALETTE.p1.deep,
    );
    expect(marked).toBe(true);
  });

  it('draws the die as pips once it is rolled', () => {
    const game = new LudoGame();
    game.init(makeContext(47));
    const before = new RecordingRenderer();
    game.render(before);
    expect(before.args, 'a prompt while there is nothing to show').toContain('Roll');

    game.position.die = 5;
    const after = new RecordingRenderer();
    game.render(after);
    const pips = after.calls.filter(
      (call) =>
        call.op === 'circle' &&
        typeof call.args[0] === 'number' &&
        call.args[0] >= DIE_X &&
        call.args[0] <= DIE_X + DIE_SIZE &&
        typeof call.args[1] === 'number' &&
        call.args[1] >= DIE_Y &&
        call.args[1] <= DIE_Y + DIE_SIZE &&
        call.args[3] === '#191426',
    ).length;
    expect(pips, 'five pips').toBe(5);
  });

  it('rings the tokens that can take this roll', () => {
    // Otherwise a player is left tapping a token that cannot move and told nothing.
    const game = new LudoGame();
    game.init(makeContext(53));
    game.position.die = 3;
    game.position.phase = 'choosing';

    // Counted by the playable ring specifically — a stroke of width 4 in the *text*
    // colour. Counting all strokes was equal either way by coincidence, because making a
    // token playable swaps its hollow outline for a fill plus a ring; and counting width 4
    // alone caught the seat markers, which share it.
    const playableRings = (renderer: RecordingRenderer): number =>
      renderer.calls.filter(
        (call) => call.op === 'strokeCircle' && call.args[3] === 4 && call.args[4] === '#ece7f6',
      ).length;

    const none = new RecordingRenderer();
    game.render(none);
    expect(playableRings(none), 'a three moves nothing off the start').toBe(0);

    game.position.p1[0] = 4;
    const one = new RecordingRenderer();
    game.render(one);
    expect(playableRings(one), 'and now exactly one token is ringed').toBe(1);
  });

  it('tells the two seats apart without the colour', () => {
    const game = new LudoGame();
    game.init(makeContext(59));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    const rings = renderer.calls.filter(
      (call) => call.op === 'strokeCircle' && call.args[4] === SEAT_PALETTE.p1.deep,
    ).length;
    const bars = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[4] === SEAT_PALETTE.p2.deep,
    ).length;
    expect(rings, 'three rings for seat one').toBeGreaterThanOrEqual(TOKENS);
    expect(bars, 'three bars for seat two').toBeGreaterThanOrEqual(TOKENS);
  });

  it('turns the board to face whoever is playing', () => {
    const game = new LudoGame();
    game.init(makeContext(61));
    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.ops).toContain('pushRotation');
  });

  it('draws nothing outside the logical box', () => {
    const game = new LudoGame();
    game.init(makeContext(67, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 2400; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer);
    for (const call of renderer.calls) {
      if (call.op === 'text') continue;
      for (const value of call.args) {
        if (typeof value !== 'number') continue;
        expect(Number.isFinite(value)).toBe(true);
        expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-60);
        expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(BOARD + 60);
      }
    }
  });

  it('does not mutate the position', () => {
    const game = new LudoGame();
    game.init(makeContext(71, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.position);
    game.render(new RecordingRenderer());
    game.render(new RecordingRenderer());
    expect(JSON.stringify(game.position)).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('ludo');
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.logical.width).toBe(BOARD);
  });

  it('needs a six to start, which the release roll names', () => {
    expect(RELEASE_ROLL).toBe(6);
  });
});
