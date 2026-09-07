import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { KingOfTheYardGame } from './game.js';
import {
  LOOSE_SECONDS,
  PLAYER_RADIUS,
  TARGET_SECONDS,
  WALL,
  YARD_HEIGHT,
  YARD_WIDTH,
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

  run(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.move.x = x;
    target.move.y = y;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  idle(seat: SeatId): void {
    const target = this.#of(seat);
    target.move.x = 0;
    target.move.y = 0;
    target.pointer = null;
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

function fixture(game: KingOfTheYardGame): Position {
  return game.position;
}

describe('running', () => {
  it('moves a player with the keys', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    const before = game.position.p1.x;
    input.run('p1', 1, 0);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeGreaterThan(before);
  });

  it('runs toward a finger', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    const before = game.position.p1.y;
    input.point('p1', game.position.p1.x, YARD_HEIGHT - WALL);
    for (let i = 0; i < 30; i += 1) game.update(STEP, input);
    expect(game.position.p1.y).toBeGreaterThan(before);
  });

  it('keeps both players inside the walls', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    input.run('p1', -1, -1);
    input.run('p2', 1, 1);
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x).toBeGreaterThanOrEqual(WALL + PLAYER_RADIUS - 1e-6);
    expect(game.position.p2.x).toBeLessThanOrEqual(YARD_WIDTH - WALL - PLAYER_RADIUS + 1e-6);
  });
});

describe('the match', () => {
  it('reports banked whole seconds as the score', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(11));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    fixture(game).worn.p1 = 3.7;
    expect(game.getScore().p1, 'whole seconds, so the number is readable').toBe(3);
  });

  it('plays a whole bot match to a result', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(13, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 300 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBeGreaterThanOrEqual(TARGET_SECONDS - 1);
  });

  it('stops simulating once decided', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(15, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 300 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = `${String(game.getScore().p1)}:${String(game.getScore().p2)}`;
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new KingOfTheYardGame();
      game.init(makeContext(17, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        game.update(STEP, input);
        if (i % 30 === 0)
          out.push(`${String(Math.round(game.position.p1.x))}${game.position.wearer ?? '-'}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(19, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    game.init(makeContext(19, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.wearer).toBeNull();
  });

  it('clears on destroy', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(21, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('flashes when the crown changes hands', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(23));
    const input = new ScriptedInput();
    for (let i = 0; i < Math.ceil(LOOSE_SECONDS / STEP) + 2; i += 1) game.update(STEP, input);
    const position = fixture(game);
    position.p1.x = position.crown.x;
    position.p1.y = position.crown.y;
    game.update(STEP, input);
    expect(game.position.wearer).toBe('p1');
    expect(game.flashing, 'a steal is announced, not left to be noticed').toBe(true);
  });
});

describe('the bot', () => {
  it('never moves the human player', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(31, null, 'hard'));
    const input = new ScriptedInput();
    const start = { x: game.position.p1.x, y: game.position.p1.y };
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.position.p1.x, 'a silent human stands still').toBe(start.x);
    expect(game.position.p1.y).toBe(start.y);
  });

  it('takes the crown from a human who never moves', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(33, null, 'hard'));
    const input = new ScriptedInput();
    let taken = false;
    for (let i = 0; i < 60 * 30 && !taken; i += 1) {
      game.update(STEP, input);
      if (game.position.wearer === 'p2') taken = true;
    }
    expect(taken).toBe(true);
  });
});

describe('seat symmetry', () => {
  /**
   * Steer the human seat straight at the crown, recording what it was told each step.
   *
   * The property below is about the *chase*, so the test has to get the game into one: while
   * the bot seat is the one wearing the crown its target is a corner, which is a discrete
   * choice and immune to a ten-unit difference in where its opponent is standing. The first
   * version of this test ran with the bot wearing the crown and passed against the very bug
   * it was written for.
   */
  function driveToCrown(
    game: KingOfTheYardGame,
    input: ScriptedInput,
    steps: number,
  ): { readonly x: number; readonly y: number }[] {
    const script: { x: number; y: number }[] = [];
    for (let i = 0; i < steps; i += 1) {
      const crown = game.position.crown;
      const me = game.position.p1;
      const dx = game.position.wearer === 'p1' ? 0 : crown.x - me.x;
      const dy = game.position.wearer === 'p1' ? 1 : crown.y - me.y;
      script.push({ x: dx, y: dy });
      input.run('p1', dx, dy);
      game.update(STEP, input);
    }
    return script;
  }

  it('resolves the two seats simultaneously, so neither sees the other move first', () => {
    // The seat-balance bug this game was recorded for, as a property rather than a win rate.
    //
    // A chase is nothing but "where is the other player", so the order the two seats are
    // resolved in *is* the fairness. This used to be heading-p1, move-p1, heading-p2,
    // move-p2, which handed seat two half a step of extra freshness on every step of every
    // match — information a person at the glass does not have, so a rule 6 violation as well
    // as an unfair one. Putting it back measures 39.7% for seat one over a thousand seeds
    // against 50.3% with it fixed, and it is invisible from `rules.test.ts`, whose own
    // helper always read both headings before moving either player.
    //
    // Stated without reference to any of that: a human seat's input on step N may not reach
    // the bot seat's position until step N + 1.
    const reference = new KingOfTheYardGame();
    const referenceInput = new ScriptedInput();
    reference.init(makeContext(29, null, 'hard'));
    // One pass, recorded whole, so the replays below are exact. Long enough to reach a chase
    // and hold one: the steal cooldown is 0.85 s and a `hard` bot decides every 0.12 s.
    const script = driveToCrown(reference, referenceInput, 60 * 10);
    let opening = -1;
    for (let i = 0; i < script.length; i += 1) {
      // The step at which the human seat took the crown is the first step whose recorded
      // input is the post-crown one — see `driveToCrown`.
      const told = script[i];
      if (told !== undefined && told.x === 0 && told.y === 1) {
        opening = i;
        break;
      }
    }
    expect(
      opening,
      'the human seat never got the crown, so there is no chase to test',
    ).toBeGreaterThan(0);
    const window = 40;

    let sawAnEffect = false;
    let exercised = 0;
    for (let at = opening; at < opening + window; at += 1) {
      const inputA = new ScriptedInput();
      const inputB = new ScriptedInput();
      const a = new KingOfTheYardGame();
      const b = new KingOfTheYardGame();
      a.init(makeContext(29, null, 'hard'));
      b.init(makeContext(29, null, 'hard'));
      for (let step = 0; step < at; step += 1) {
        const told = script[step] ?? { x: 1, y: 0 };
        inputA.run('p1', told.x, told.y);
        inputB.run('p1', told.x, told.y);
        a.update(STEP, inputA);
        b.update(STEP, inputB);
      }
      expect(a.position.p1.x, `step ${String(at)} did not start level`).toBe(b.position.p1.x);
      expect(a.position.p2.x, `step ${String(at)} did not start level`).toBe(b.position.p2.x);
      // Only the steps where the bot is actually chasing say anything: while it is the one
      // wearing the crown its target is a corner, and a corner does not move when its
      // opponent shifts ten units.
      if (a.position.wearer !== 'p1') continue;
      exercised += 1;

      // One step, two different human inputs.
      inputA.run('p1', 1, 0);
      inputB.run('p1', -1, 0);
      a.update(STEP, inputA);
      b.update(STEP, inputB);

      expect(a.position.p1.x, `step ${String(at)}: the input reached nobody`).not.toBe(
        b.position.p1.x,
      );
      expect(
        a.position.p2.x,
        `step ${String(at)}: the bot seat moved differently on the same step the human seat ` +
          `changed its mind, so it read a position the human had already moved to`,
      ).toBe(b.position.p2.x);
      expect(a.position.p2.y, `step ${String(at)}`).toBe(b.position.p2.y);

      // And the channel does exist, later — otherwise the assertion above is asserting that
      // a bot ignores its opponent entirely, which would pass for the wrong reason.
      for (let more = 0; more < 60 && !sawAnEffect; more += 1) {
        a.update(STEP, inputA);
        b.update(STEP, inputB);
        if (a.position.p2.x !== b.position.p2.x || a.position.p2.y !== b.position.p2.y) {
          sawAnEffect = true;
        }
      }
    }
    expect(exercised, 'no step of the window had the bot chasing').toBeGreaterThan(10);
    expect(
      sawAnEffect,
      'the bot seat never reacted to the human seat at all, so the test above proves nothing',
    ).toBe(true);
  });

  it('gives the two seats their own generators', () => {
    // Both bots used to draw their wobble from one stream in seat order, so seat one took
    // the earlier value of every pair — the same sharing that measured 1.4 points of win
    // rate in Star Catcher. Here the two seats decide on the *same* step rather than
    // alternately, so it would be a standing bias rather than an occasional one.
    //
    // What is observable from outside is that the seats are not shifted copies of each
    // other: different seeds must produce genuinely different matches.
    const results = new Set<string>();
    for (let seed = 0; seed < 12; seed += 1) {
      const game = new KingOfTheYardGame();
      game.init(makeContext(seed * 977 + 3, 'normal', 'normal'));
      let steps = 0;
      while (game.getScore().winner === null && steps < 60 * 600) {
        game.update(STEP, new ScriptedInput());
        steps += 1;
      }
      const score = game.getScore();
      results.add(`${String(score.winner)}:${String(steps)}`);
    }
    expect(results.size).toBeGreaterThan(6);
  });
});

describe('rendering', () => {
  it('draws the yard, both players and the crown', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(41));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
    expect(renderer.args, 'the crown has its own colour').toContain('#ffd54a');
  });

  it('rings the wearer, so who has it is a shape and not a number', () => {
    // Who has the crown is the only thing either player needs to know at a glance, and in
    // a chase there is no time to read a number.
    const game = new KingOfTheYardGame();
    game.init(makeContext(43));
    const loose = new RecordingRenderer();
    game.render(loose, 0);
    const before = loose.ops.filter((op) => op === 'strokeCircle').length;

    fixture(game).wearer = 'p1';
    const worn = new RecordingRenderer();
    game.render(worn, 0);
    expect(worn.ops.filter((op) => op === 'strokeCircle').length).toBeGreaterThan(before);
  });

  it('tells the two players apart by shape', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(45));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    let cursor = 0;
    let p1Circles = 0;
    let p2Rects = 0;
    for (const op of renderer.ops) {
      if (op === 'circle' && renderer.args[cursor + 3] === SEAT_PALETTE.p1.base) p1Circles += 1;
      if (op === 'rect' && renderer.args[cursor + 4] === SEAT_PALETTE.p2.base) p2Rects += 1;
      cursor +=
        op === 'clear'
          ? 1
          : op === 'circle'
            ? 4
            : op === 'strokeCircle'
              ? 5
              : op === 'rect'
                ? 5
                : op === 'strokeRect'
                  ? 6
                  : op === 'line'
                    ? 6
                    : op === 'text'
                      ? 6
                      : 1;
    }
    expect(p1Circles, 'p1 is a disc').toBeGreaterThan(0);
    expect(p2Rects, 'p2 is a square').toBeGreaterThan(0);
  });

  it('never rotates: one open yard, read the same way by both', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(47));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops.filter((op) => op === 'pushRotation').length).toBe(0);
  });

  it('draws nothing outside the logical play area', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(49, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(-120);
      expect(value).toBeLessThan(manifest.logical.width + 120);
    }
  });

  it('does not mutate the simulation', () => {
    const game = new KingOfTheYardGame();
    game.init(makeContext(51, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = `${String(game.position.p1.x)}:${game.position.wearer ?? '-'}`;
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(`${String(game.position.p1.x)}:${game.position.wearer ?? '-'}`).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('king-of-the-yard');
    expect(manifest.archetype).toBe('rt-arena');
  });

  it('is fair across input families', () => {
    // rt-arena: docs/input-parity.md rules it fair. Movement is rate-based, with no
    // absolute aiming for a thumb to be better at.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
