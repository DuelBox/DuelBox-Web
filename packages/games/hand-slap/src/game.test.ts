import { describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { HALF_HEIGHT, HandSlapGame, halfTop } from './game.js';
import { SETTLE_SECONDS, SWING_SECONDS, TARGET_POINTS, defenderOf } from './rules.js';
import type { BotDifficulty } from './rules.js';

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

const ARG_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  clear: 1,
  rect: 5,
  strokeRect: 6,
  circle: 4,
  strokeCircle: 5,
  line: 6,
  text: 6,
  pushSeatRotation: 1,
  pushRotation: 1,
  popSeatRotation: 0,
});

/** Every text call, with the y it was drawn at. */
function texts(renderer: RecordingRenderer): { value: string; y: number }[] {
  const out: { value: string; y: number }[] = [];
  let cursor = 0;
  for (const op of renderer.ops) {
    if (op === 'text') {
      const value = renderer.args[cursor];
      const y = renderer.args[cursor + 2];
      if (typeof value === 'string' && typeof y === 'number') out.push({ value, y });
    }
    cursor += ARG_COUNTS[op] ?? 0;
  }
  return out;
}

/** Steps until the round is live. */
function goLive(game: HandSlapGame, input: ScriptedInput): void {
  for (let i = 0; i < 60 * 10 && game.state.phase !== 'live'; i += 1) game.update(STEP, input);
}

/** One clean press: down for a step, then up for a step. */
function tap(game: HandSlapGame, input: ScriptedInput, seat: SeatId): void {
  input.press(seat);
  game.update(STEP, input);
  input.release(seat);
  game.update(STEP, input);
}

describe('the halves', () => {
  it('gives each seat exactly half the box', () => {
    expect(HALF_HEIGHT * 2).toBe(manifest.logical.height);
    expect(halfTop('p2')).toBe(0);
    expect(halfTop('p1')).toBe(HALF_HEIGHT);
  });
});

describe('one press, one action', () => {
  it('swings when the attacker presses', () => {
    const game = new HandSlapGame();
    game.init(makeContext(3));
    const input = new ScriptedInput();
    goLive(game, input);
    const attacker = game.state.attacker;
    tap(game, input, attacker);
    expect(game.state.phase, 'the swing is in the air').toBe('swinging');
  });

  it('does not swing again while the button is held', () => {
    // Holding the button must not be the dominant strategy: the game is about choosing a
    // moment, and a held button that swung every step would remove the choice entirely.
    const game = new HandSlapGame();
    game.init(makeContext(5));
    const input = new ScriptedInput();
    goLive(game, input);
    const attacker = game.state.attacker;

    input.press(attacker);
    for (let i = 0; i < 240; i += 1) game.update(STEP, input);
    // One swing landed and the point settled; nothing further happened on the hold.
    const scored = game.state.p1 + game.state.p2;
    expect(scored, 'a held button is one action').toBe(1);
  });

  it('dodges when the defender presses with a swing in the air', () => {
    const game = new HandSlapGame();
    game.init(makeContext(7));
    const input = new ScriptedInput();
    goLive(game, input);
    const attacker = game.state.attacker;
    const defender = defenderOf(game.state);
    tap(game, input, attacker);
    tap(game, input, defender);
    for (let i = 0; i < Math.round(SWING_SECONDS / STEP) + 4; i += 1) game.update(STEP, input);
    expect(game.state.outcome).toBe('dodged');
    expect(game.state.scorer).toBe(defender);
  });

  it('costs the defender a point for pressing at nothing', () => {
    const game = new HandSlapGame();
    game.init(makeContext(9));
    const input = new ScriptedInput();
    goLive(game, input);
    const attacker = game.state.attacker;
    tap(game, input, defenderOf(game.state));
    expect(game.state.outcome).toBe('flinch');
    expect(game.state.scorer).toBe(attacker);
  });

  it('ignores presses before the round is live', () => {
    const game = new HandSlapGame();
    game.init(makeContext(11));
    const input = new ScriptedInput();
    game.update(STEP, input);
    expect(game.state.phase).toBe('ready');
    tap(game, input, game.state.attacker);
    tap(game, input, defenderOf(game.state));
    expect(game.state.p1 + game.state.p2, 'nothing counts during the wait').toBe(0);
  });

  it('does not swing for a button still held across a pause', () => {
    // Otherwise a paused player comes back having swung at nothing and given away a point.
    const game = new HandSlapGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    goLive(game, input);
    const attacker = game.state.attacker;

    input.press(attacker);
    game.onPause();
    game.onResume();
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.state.phase, 'the still-down button did nothing').toBe('live');

    input.release(attacker);
    game.update(STEP, input);
    tap(game, input, attacker);
    expect(game.state.phase, 'and a genuine press still works').toBe('swinging');
  });
});

describe('the match', () => {
  it('reports the score, and no winner while it is live', () => {
    const game = new HandSlapGame();
    game.init(makeContext(15));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('ends at the target', () => {
    const game = new HandSlapGame();
    game.init(makeContext(17, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const score = game.getScore();
    expect(score.winner, 'somebody reaches the target').not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBeGreaterThanOrEqual(TARGET_POINTS);
  });

  it('stops simulating once decided', () => {
    const game = new HandSlapGame();
    game.init(makeContext(19, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 900 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const frozen = `${String(game.getScore().p1)}:${String(game.getScore().p2)}`;
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(`${String(game.getScore().p1)}:${String(game.getScore().p2)}`).toBe(frozen);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new HandSlapGame();
      game.init(makeContext(21, 'normal', 'easy'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 90; i += 1) {
        game.update(STEP, input);
        out.push(`${game.state.phase[0] ?? '?'}${String(game.state.p1)}${String(game.state.p2)}`);
      }
      return out.join('');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new HandSlapGame();
    game.init(makeContext(23, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120; i += 1) game.update(STEP, input);
    expect(game.state.p1 + game.state.p2).toBeGreaterThan(0);

    game.init(makeContext(23, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.state.phase).toBe('ready');
    expect(game.state.attacker).toBe('p1');
  });

  it('clears on destroy', () => {
    const game = new HandSlapGame();
    game.init(makeContext(25, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    game.update(STEP, input);
    expect(game.getScore().p1).toBe(0);
  });
});

describe('the bot', () => {
  it('never presses the human button', () => {
    // Stated as "a silent human never scores" first, which was simply wrong about the
    // game: a defender's flinch awards the point to the attacker, so a human who does
    // nothing while attacking still collects points from a jumpy opponent. That is the
    // design working — punishing a defender who presses at nothing — not a leak. What
    // must never happen is the bot *acting for* the human seat.
    const game = new HandSlapGame();
    game.init(makeContext(31, null, 'hard'));
    const input = new ScriptedInput();
    let humanSwungWhileAttacking = false;
    for (let i = 0; i < 60 * 120 && game.getScore().winner === null; i += 1) {
      const attackerWasHuman = game.state.attacker === 'p1';
      const before = game.state.phase;
      game.update(STEP, input);
      if (attackerWasHuman && before === 'live' && game.state.phase === 'swinging') {
        humanSwungWhileAttacking = true;
      }
    }
    expect(humanSwungWhileAttacking, 'the human seat never swung on its own').toBe(false);
  });

  it('lets a silent attacker profit from a jumpy defender', () => {
    // The other half of the same behaviour, made explicit rather than left as a surprise.
    const game = new HandSlapGame();
    game.init(makeContext(33, null, 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 240 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().p1, 'the easy tier flinches, and flinches cost points').toBeGreaterThan(
      0,
    );
  });
});

describe('rendering', () => {
  it('draws both halves and the divider', () => {
    const game = new HandSlapGame();
    game.init(makeContext(41));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops[0]).toBe('clear');
    expect(renderer.args).toContain(SEAT_PALETTE.p1.base);
    expect(renderer.args).toContain(SEAT_PALETTE.p2.base);
  });

  it('tells each seat its role in words, not only in colour', () => {
    // Rule 7: a player who cannot tell whether they are slapping or dodging is not
    // playing the game at all, so the role is spelled out for both seats.
    const game = new HandSlapGame();
    game.init(makeContext(43));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const labels = texts(renderer).map((entry) => entry.value);
    expect(labels).toContain('SLAP');
    expect(labels).toContain('DODGE');
  });

  it('keeps each seat label inside its own half once the rotation is applied', () => {
    // The bug this pins: `pushSeatRotation` turns the whole logical box about its centre,
    // not about one half, so a label drawn at the far seat's own coordinates lands in the
    // *near* seat's half. The y is mirrored through the centre first to undo that.
    const game = new HandSlapGame();
    game.init(makeContext(45));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);

    const height = manifest.logical.height;
    let rotated = false;
    let cursor = 0;
    const placed: { value: string; y: number }[] = [];
    for (const op of renderer.ops) {
      if (op === 'pushSeatRotation') rotated = renderer.args[cursor] === true;
      if (op === 'popSeatRotation') rotated = false;
      if (op === 'text') {
        const value = renderer.args[cursor];
        const y = renderer.args[cursor + 2];
        if (typeof value === 'string' && typeof y === 'number') {
          // Where it actually lands on screen once the rotation is applied.
          placed.push({ value, y: rotated ? height - y : y });
        }
      }
      cursor += ARG_COUNTS[op] ?? 0;
    }

    expect(placed.length, 'both seats are labelled').toBeGreaterThanOrEqual(4);
    // p1 owns the bottom half, p2 the top. The local seat is p1, so p2's is the rotated
    // copy — and it must still land above the divider.
    for (const entry of placed) {
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeLessThanOrEqual(height);
    }
    const top = placed.filter((entry) => entry.y < HALF_HEIGHT).length;
    const bottom = placed.filter((entry) => entry.y >= HALF_HEIGHT).length;
    expect(top, 'the far seat is labelled in its own half').toBeGreaterThan(0);
    expect(bottom, 'and so is the near one').toBeGreaterThan(0);
  });

  it('keeps the labels clear of the arm and the hands', () => {
    // The first layout drew the attacker's label straight through its own fist. Half a
    // seat is 500 deep and everything has to fit: hands near the divider, the arm cocked
    // behind them, the labels out at the seat's own edge.
    const game = new HandSlapGame();
    game.init(makeContext(55));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);

    let cursor = 0;
    const fists: { y: number; r: number }[] = [];
    const labels: number[] = [];
    for (const op of renderer.ops) {
      if (op === 'circle') {
        // circle records x, y, radius, colour — so y is at +1 and the radius at +2.
        const y = renderer.args[cursor + 1];
        const r = renderer.args[cursor + 2];
        if (typeof y === 'number' && typeof r === 'number') fists.push({ y, r });
      }
      if (op === 'text') {
        const y = renderer.args[cursor + 2];
        if (typeof y === 'number') labels.push(y);
      }
      cursor += ARG_COUNTS[op] ?? 0;
    }

    expect(fists.length, 'p1 draws round hands or a round fist').toBeGreaterThan(0);
    expect(labels.length).toBeGreaterThanOrEqual(4);
    for (const label of labels) {
      for (const fist of fists) {
        const gap = Math.abs(label - fist.y) - fist.r;
        expect(gap, `a label at ${String(Math.round(label))} overlaps a circle`).toBeGreaterThan(0);
      }
    }
  });

  it('moves the arm through the swing rather than blinking it', () => {
    const game = new HandSlapGame();
    game.init(makeContext(47));
    const input = new ScriptedInput();
    goLive(game, input);
    tap(game, input, game.state.attacker);

    const armY = (): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      let cursor = 0;
      for (const op of renderer.ops) {
        if (op === 'line') {
          const width = renderer.args[cursor + 4];
          if (width === 26) return renderer.args[cursor + 3] as number;
        }
        cursor += ARG_COUNTS[op] ?? 0;
      }
      return Number.NaN;
    };
    const early = armY();
    for (let i = 0; i < 8; i += 1) game.update(STEP, input);
    const later = armY();
    expect(Number.isFinite(early)).toBe(true);
    expect(later, 'the arm has travelled').not.toBe(early);
  });

  it('says what happened when a point settles', () => {
    const game = new HandSlapGame();
    game.init(makeContext(49));
    const input = new ScriptedInput();
    goLive(game, input);
    tap(game, input, game.state.attacker);
    for (let i = 0; i < Math.round(SWING_SECONDS / STEP) + 4; i += 1) game.update(STEP, input);
    expect(game.state.phase).toBe('settling');
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const labels = texts(renderer).map((entry) => entry.value);
    expect(labels.some((label) => label === 'hit' || label === 'ouch')).toBe(true);
    expect(SETTLE_SECONDS).toBeGreaterThan(0);
  });

  it('draws nothing outside the logical play area', () => {
    const game = new HandSlapGame();
    game.init(makeContext(51, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 900; i += 1) game.update(STEP, input);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    for (const value of renderer.args) {
      if (typeof value !== 'number') continue;
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-60);
      expect(value).toBeLessThanOrEqual(manifest.logical.height + 60);
    }
  });

  it('does not mutate the simulation', () => {
    const game = new HandSlapGame();
    game.init(makeContext(53, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    const before = `${game.state.phase}${String(game.state.p1)}${String(game.state.p2)}`;
    game.render(new RecordingRenderer(), 0);
    game.render(new RecordingRenderer(), 0);
    expect(`${game.state.phase}${String(game.state.p1)}${String(game.state.p2)}`).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('hand-slap');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.zoneSplit).toBe('horizontal');
  });

  it('is fair across input families', () => {
    // One button pressed at a moment of your choosing: no aiming, no tracking, no rapid
    // repeat. The bluff decides it rather than raw speed, so no family has an edge.
    expect(manifest.sameInputClassOnly).toBe(false);
  });
});
