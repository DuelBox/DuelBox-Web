import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { BAR_HEIGHT, BAR_TOP, BAR_WIDTH, BAR_X, HotPotatoGame } from './game.js';
import { FUSE_SECONDS, START_BAND, TARGET_ROUNDS } from './rules.js';
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
  pointerCancelled: boolean;
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
    pointerCancelled: false,
  };
}

class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = true;
    target.actionHeld = true;
  }

  release(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = false;
    target.actionHeld = false;
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

function fixture(game: HotPotatoGame): Position {
  return game.position;
}

/** Puts the marker on the band so the next press is bound to land. */
function aim(game: HotPotatoGame): void {
  fixture(game).marker = game.position.bandCentre;
}

describe('throwing', () => {
  it('throws when the holder presses on the band', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    aim(game);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.phase).toBe('flying');
  });

  it('shows a miss rather than silently ignoring it', () => {
    // A player who cannot tell a miss from a refusal will think the game ignored them.
    const game = new HotPotatoGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    fixture(game).marker = (game.position.bandCentre + 0.4) % 1;
    input.press('p1');
    game.update(STEP, input);
    expect(game.missing('p1'), 'the miss is on screen').toBe(true);
    expect(game.position.phase).toBe('holding');
  });

  it('ignores the seat that is not holding it', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    aim(game);
    input.press('p2');
    game.update(STEP, input);
    expect(game.position.phase, 'p2 cannot throw p1 potato').toBe('holding');
    expect(game.missing('p2'), 'and it is a refusal, not a miss').toBe(false);
  });

  it('throws once per press, not once per step', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    aim(game);
    input.press('p1');
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    // One throw happened; the held button never threw again on the way back.
    expect(game.position.throws, 'a held button is one throw').toBe(1);
  });

  it('does not throw for a button still held across a pause', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    aim(game);
    input.press('p1');
    game.onPause();
    game.onResume();
    game.update(STEP, input);
    expect(game.position.phase, 'the still-down button did nothing').toBe('holding');

    input.release('p1');
    game.update(STEP, input);
    aim(game);
    input.press('p1');
    game.update(STEP, input);
    expect(game.position.phase, 'and a genuine press throws').toBe('flying');
  });
});

describe('the match', () => {
  it('reports rounds won as the score', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(21));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('plays a whole bot match to a result', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(23, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(TARGET_ROUNDS);
  });

  it('stops simulating once decided', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(25, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 400 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = `${String(game.getScore().p1)}:${String(game.getScore().p2)}`;
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new HotPotatoGame();
      game.init(makeContext(27, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 90; i += 1) {
        game.update(STEP, input);
        if (i % 30 === 0)
          out.push(`${game.position.holder}${String(Math.round(game.position.fuse))}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(29, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    game.init(makeContext(29, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.fuse).toBe(FUSE_SECONDS);
    expect(game.position.band).toBe(START_BAND);
  });

  it('clears on destroy', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(31, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

describe('the bot', () => {
  it('never throws for the human seat', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(41, null, 'hard'));
    const input = new ScriptedInput();
    // p1 is human and holds the potato, pressing nothing: it must never leave their hands
    // before the fuse runs out.
    for (let i = 0; i < 60 * 5; i += 1) game.update(STEP, input);
    expect(game.position.holder, 'a silent human keeps holding it').toBe('p1');
    expect(game.position.throws).toBe(0);
  });
});

describe('rendering', () => {
  it('draws the bar, the band, the marker and the potato', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(51));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.ops.filter((op) => op === 'rect').length).toBeGreaterThan(2);
  });

  it('shows the fuse as a length, not only as a colour', () => {
    // Colour alone would tell a colour-blind player nothing about how long they have.
    const game = new HotPotatoGame();
    game.init(makeContext(53));
    const input = new ScriptedInput();
    const widthOfFuse = (): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      let cursor = 0;
      let widest = 0;
      for (const op of renderer.ops) {
        if (op === 'rect') {
          const y = renderer.args[cursor + 1];
          const w = renderer.args[cursor + 2];
          if (typeof y === 'number' && typeof w === 'number' && y < 100)
            widest = Math.max(widest, w);
        }
        cursor +=
          op === 'clear'
            ? 1
            : op === 'rect'
              ? 5
              : op === 'strokeRect'
                ? 6
                : op === 'circle'
                  ? 4
                  : op === 'strokeCircle'
                    ? 5
                    : op === 'line'
                      ? 6
                      : 1;
      }
      return widest;
    };
    const full = widthOfFuse();
    for (let i = 0; i < 60 * 5; i += 1) game.update(STEP, input);
    expect(widthOfFuse(), 'the fuse is visibly shorter').toBeLessThan(full);
  });

  it('marks a miss with a cross, so it is a shape and not a flicker', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(55));
    const input = new ScriptedInput();
    const before = new RecordingRenderer();
    game.render(before, 0);
    const linesBefore = before.ops.filter((op) => op === 'line').length;

    fixture(game).marker = (game.position.bandCentre + 0.4) % 1;
    input.press('p1');
    game.update(STEP, input);
    const after = new RecordingRenderer();
    game.render(after, 0);
    expect(after.ops.filter((op) => op === 'line').length).toBeGreaterThan(linesBefore);
  });

  it('never rotates: one bar, read the same way by both players', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(57));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(0);
    expect(renderer.ops.filter((op) => op === 'pushSeatRotation').length).toBe(0);
  });

  it('keeps the bar inside the logical play area', () => {
    expect(BAR_X).toBeGreaterThan(0);
    expect(BAR_X + BAR_WIDTH).toBeLessThanOrEqual(manifest.logical.width);
    expect(BAR_TOP + BAR_HEIGHT).toBeLessThanOrEqual(manifest.logical.height);
  });

  it('draws nothing outside the logical play area', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(59, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-120);
      expect(value).toBeLessThan(manifest.logical.height + 120);
    }
  });

  it('does not mutate the simulation', () => {
    const game = new HotPotatoGame();
    game.init(makeContext(61, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = `${game.position.holder}${String(game.position.fuse)}`;
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(`${game.position.holder}${String(game.position.fuse)}`).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('hot-potato');
    expect(manifest.archetype).toBe('rt-split');
  });

  it('is fair across input families', () => {
    // One button pressed at a moment of your choosing: no aiming, no tracking.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
