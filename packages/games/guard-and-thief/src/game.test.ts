import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId, TextAlign } from '@duelbox/engine';
import type { Game, GameContext, MatchScore, Renderer } from '@duelbox/game-sdk';
import { GuardandThiefGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_Y,
  DRAG_DEADZONE,
  DRAG_LEASH,
  MATCH_SECONDS,
  RUNNER_RADIUS,
  atHome,
  homeX,
  homeY,
} from './rules.js';

const STEP = 1 / 60;

function context(
  seed = 20260829,
  difficulty: 'easy' | 'normal' | 'hard' | null = null,
  openingSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat,
    botDifficulty: () => difficulty,
  };
}

/** A real `InputManager`, because a hand-built input record is how Sea Battle shipped dead code. */
function inputs(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

class RecordingRenderer implements Renderer {
  readonly calls: Call[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  get numbers(): number[] {
    return this.calls.flatMap((call) =>
      call.args.filter((value): value is number => typeof value === 'number'),
    );
  }

  #push(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
  }

  clear(colour: string): void {
    this.#push('clear', colour);
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push('rect', x, y, width, height, colour);
  }
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#push('strokeRect', x, y, width, height, lineWidth, colour);
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push('circle', x, y, radius, colour);
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#push('strokeCircle', x, y, radius, lineWidth, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#push('line', x1, y1, x2, y2, lineWidth, colour);
  }
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.#push('text', value, x, y, sizePx, colour, align);
  }
  pushSeatRotation(rotated: boolean): void {
    this.#push('pushSeatRotation', rotated);
  }
  pushRotation(radians: number): void {
    this.#push('pushRotation', radians);
  }
  popSeatRotation(): void {
    this.#push('popSeatRotation');
  }
}

/* ------------------------------------------------------------------------------------ */
/* The contract                                                                          */
/* ------------------------------------------------------------------------------------ */

describe('the contract', () => {
  it('never claims to have turns', () => {
    // `apps/web/src/data/turn-seat.test.ts` enforces this: a real-time game that reported
    // an active seat would switch the shell into shared-board mode and take one seat's
    // pointer zone away.
    const game: Game = new GuardandThiefGame();
    expect(Object.prototype.hasOwnProperty.call(GuardandThiefGame.prototype, 'getActiveSeat')).toBe(
      false,
    );
    expect(game.getActiveSeat?.() ?? null).toBeNull();
  });

  it('reports a score the shell can read at every moment of a match', () => {
    const game = new GuardandThiefGame();
    game.init(context(1, 'normal'));
    const { manager, view } = inputs();
    let last: MatchScore = game.getScore();
    for (let i = 0; i < 4000; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      last = game.getScore();
      expect(Number.isInteger(last.p1)).toBe(true);
      expect(Number.isInteger(last.p2)).toBe(true);
      expect(last.p1).toBeGreaterThanOrEqual(0);
      expect(last.p2).toBeGreaterThanOrEqual(0);
      if (last.winner !== null) break;
    }
    expect(last.winner).not.toBeNull();
    game.destroy();
  });

  it('starts a fresh match from init, with no leakage between matches', () => {
    const game = new GuardandThiefGame();
    game.init(context(2, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 1500; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);
    game.init(context(2, 'hard'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.field.clock).toBe(MATCH_SECONDS);
    expect(game.field.p1.runner.x).toBe(homeX());
    expect(game.field.p1.runner.y).toBe(homeY('p1'));
    game.destroy();
  });

  it('plays the identical match after a rematch on the same seed', () => {
    const trace = (): string => {
      const game = new GuardandThiefGame();
      game.init(context(3, 'normal'));
      const { manager, view } = inputs();
      const out: number[] = [];
      for (let i = 0; i < 1500; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        out.push(game.getScore().p1, game.getScore().p2);
      }
      game.destroy();
      return out.join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('plays the exact mirror of the same match when the opening seat changes', () => {
    // The one use a real-time game has for `context.openingSeat`: it names which of the two
    // bot generators each seat is handed. A best-of therefore gives each seat each stream,
    // and the pair of matches the balance harness plays from one seed is one match and its
    // mirror rather than the same match twice — which is why seat one's share of that sweep
    // is 50.0% by construction. See `apps/web/src/data/balance-aggregate.test.ts`.
    const play = (opener: SeatId): MatchScore => {
      const game = new GuardandThiefGame();
      game.init(context(4, 'normal', opener));
      const { manager, view } = inputs();
      while (game.getScore().winner === null) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      const score = game.getScore();
      game.destroy();
      return score;
    };
    const first = play('p1');
    const second = play('p2');
    expect(second.p1).toBe(first.p2);
    expect(second.p2).toBe(first.p1);
    expect(second.winner).toBe(
      first.winner === 'p1' ? 'p2' : first.winner === 'p2' ? 'p1' : first.winner,
    );
  });

  it('releases its state on destroy', () => {
    const game = new GuardandThiefGame();
    game.init(context(5, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 900; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.field.p1.runner.carry).toBe(0);
    expect(game.field.p2.runner.catches).toBe(0);
    expect(game.field.clock).toBe(MATCH_SECONDS);
  });

  it('plays the identical match in both presentations', () => {
    // `docs/presentation.md`: rules, scoring and simulation are byte-identical across the
    // two, and only placement, rotation and control mapping change. Nothing in this package
    // reads `presentation` at all, which is why.
    const play = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new GuardandThiefGame();
      game.init({ ...context(6, 'normal'), presentation, localSeat });
      const { manager, view } = inputs();
      const out: number[] = [];
      for (let i = 0; i < 1500; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        out.push(game.getScore().p1, game.getScore().p2);
      }
      game.destroy();
      return out.join(',');
    };
    expect(play('single-seat', 'p2')).toBe(play('shared-screen', 'p1'));
  });
});

/* ------------------------------------------------------------------------------------ */
/* Input                                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * Run seat one to the right for `steps` driving steps, on one instrument or the other.
 *
 * This is the test the fairness argument stands on: a key and a finger asking for the same
 * heading must produce the same runner, to the last bit.
 */
function runRight(spell: 'keyboard' | 'pointer', steps: number): { x: number; y: number } {
  const game = new GuardandThiefGame();
  game.init(context(11));
  const { manager, view } = inputs();
  const runner = game.field.p1.runner;
  if (spell === 'keyboard') {
    manager.keyDown('KeyD');
  } else {
    // An anchored drag costs exactly one step to plant the anchor, and this is it. After
    // that the two instruments are the same object. Sixteen milliseconds once per press,
    // against a game with no committing gesture in it at all.
    manager.pointerDown(0, homeX(), homeY('p1'));
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.pointerMove(0, homeX() + DRAG_LEASH + DRAG_DEADZONE + 30, homeY('p1'));
  }
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
  const out = { x: runner.x, y: runner.y };
  game.destroy();
  return out;
}

describe('the two instruments', () => {
  it('produce the identical runner from the identical intent', () => {
    for (const steps of [10, 40, 90]) {
      expect(runRight('pointer', steps), `after ${String(steps)} steps`).toEqual(
        runRight('keyboard', steps),
      );
    }
  });

  it('stand still inside the deadzone, so a resting thumb is not a held key', () => {
    const game = new GuardandThiefGame();
    game.init(context(12));
    const { manager, view } = inputs();
    const runner = game.field.p1.runner;
    manager.pointerDown(0, homeX(), homeY('p1'));
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    const x = runner.x;
    // Inside four precision envelopes of where the press landed: no heading.
    manager.pointerMove(0, homeX() + DRAG_DEADZONE - 3, homeY('p1'));
    for (let i = 0; i < 20; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(runner.x).toBe(x);
    // Past it: a heading.
    manager.pointerMove(0, homeX() + DRAG_DEADZONE + 6, homeY('p1'));
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(runner.x).toBeGreaterThan(x);
    game.destroy();
  });

  it('reverse within a leash and a deadzone of glass, however far the drag has gone', () => {
    // The anchor is leashed rather than fixed, which is what keeps a trackpad's re-clutch
    // cheap: a reversal costs 36 units of travel and not the length of the whole drag.
    const game = new GuardandThiefGame();
    game.init(context(13));
    const { manager, view } = inputs();
    const runner = game.field.p1.runner;
    manager.pointerDown(0, 100, homeY('p1'));
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.pointerMove(0, 460, homeY('p1'));
    for (let i = 0; i < 20; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const far = runner.x;
    expect(far).toBeGreaterThan(homeX());
    // Back by leash + deadzone and a lattice step, and the runner turns round.
    manager.pointerMove(0, 460 - (DRAG_LEASH + DRAG_DEADZONE) - 3, homeY('p1'));
    for (let i = 0; i < 5; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(runner.x).toBeLessThan(far);
    game.destroy();
  });

  it('mirrors the far seat’s keys and does not mirror the far seat’s drag', () => {
    // A key is a *label* and a drag is a physical displacement. Seat two's own up arrow
    // means its own up, which is the device's down; a drag away from seat two is already
    // the device's down, because the far player's hand is rotated by exactly the same
    // half-turn their eyes are. So one is negated and the other is not, and both end up
    // meaning the same thing.
    const byKey = (): number => {
      const game = new GuardandThiefGame();
      game.init(context(14));
      const { manager, view } = inputs();
      const runner = game.field.p2.runner;
      const start = runner.y;
      manager.keyDown('ArrowUp');
      for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const moved = runner.y - start;
      game.destroy();
      return moved;
    };
    const byDrag = (): number => {
      const game = new GuardandThiefGame();
      game.init(context(14));
      const { manager, view } = inputs();
      const runner = game.field.p2.runner;
      const start = runner.y;
      manager.pointerDown(1, homeX(), 150);
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      // Away from seat two, which sits at the top of the device: down the board.
      manager.pointerMove(1, homeX(), 150 + DRAG_LEASH + DRAG_DEADZONE + 30);
      for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const moved = runner.y - start;
      game.destroy();
      return moved;
    };
    // Seat two's own "up" and a drag away from seat two both run it down the board, toward
    // the door — the opposite board direction from what seat one's W key produces.
    expect(byKey()).toBeGreaterThan(0);
    expect(byDrag()).toBeGreaterThan(0);
  });

  it('gives a seat only its own half to start a gesture in', () => {
    // The engine owns this rule; the test is here because the pointer idiom depends on it.
    // A press in seat one's band belongs to seat one however far it is then dragged, which
    // is exactly why the binding here is a drag and not an absolute point: a runner leaves
    // its own band and a press cannot follow it.
    const game = new GuardandThiefGame();
    game.init(context(15));
    const { manager, view } = inputs();
    const before = game.field.p2.runner.y;
    manager.pointerDown(0, homeX(), homeY('p1'));
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.pointerMove(0, homeX(), 100);
    for (let i = 0; i < 150; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.field.p2.runner.y).toBe(before);
    // And seat one's own runner has been dragged clean across the door, which is the move
    // an absolute binding could not express.
    expect(atHome('p1', game.field.p1.runner.y)).toBe(false);
    game.destroy();
  });

  it('never reads the action, so neither instrument pays for holding it', () => {
    // `actionHeld` is `keys.action || pointerDown`, so a finger on the glass *is* the
    // action and a keyboard player can run without pressing anything. Holding Space
    // changes nothing at all here, which is what makes that asymmetry harmless.
    const withAction = (): string => {
      const game = new GuardandThiefGame();
      game.init(context(16));
      const { manager, view } = inputs();
      manager.keyDown('Space');
      manager.keyDown('KeyW');
      for (let i = 0; i < 80; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const out = `${game.field.p1.runner.x},${game.field.p1.runner.y}`;
      game.destroy();
      return out;
    };
    const without = (): string => {
      const game = new GuardandThiefGame();
      game.init(context(16));
      const { manager, view } = inputs();
      manager.keyDown('KeyW');
      for (let i = 0; i < 80; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const out = `${game.field.p1.runner.x},${game.field.p1.runner.y}`;
      game.destroy();
      return out;
    };
    expect(withAction()).toBe(without());
  });

  it('stops rather than committing anything when a gesture is cancelled', () => {
    // `docs/input-idiom.md` names `pointerCancelled` as a missing primitive, and every
    // drag-and-release game in the catalogue pays for it by firing a shot nobody meant.
    // This game has no committing gesture, so the worst a cancel can do is stop you — and
    // `onPause`/`onResume` drop the anchor so the next press re-anchors under the finger.
    for (const path of ['pause', 'resume'] as const) {
      const game = new GuardandThiefGame();
      game.init(context(17));
      const { manager, view } = inputs();
      const runner = game.field.p1.runner;
      manager.pointerDown(0, homeX(), homeY('p1'));
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      manager.pointerMove(0, homeX() + 200, homeY('p1'));
      for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const at = runner.x;
      game.onPause();
      manager.clear();
      if (path === 'resume') game.onResume();
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      expect(runner.x, path).toBe(at);
      expect(runner.carry, path).toBe(0);
      game.destroy();
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* Rendering                                                                             */
/* ------------------------------------------------------------------------------------ */

function playFrames(seed: number, steps: number): GuardandThiefGame {
  const game = new GuardandThiefGame();
  game.init(context(seed, 'normal'));
  const { manager, view } = inputs();
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
  return game;
}

/** Which seat a draw call belongs to, by exact palette string. */
function seatOf(call: Call): SeatId | null {
  const colour = call.args[call.args.length - 1];
  for (const seat of ['p1', 'p2'] as const) {
    const palette = SEAT_PALETTE[seat];
    if (
      colour === palette.base ||
      colour === palette.deep ||
      colour === palette.tint ||
      colour === palette.soft
    ) {
      return seat;
    }
  }
  return null;
}

function verticalSpan(call: Call): [number, number] | null {
  const n = call.args.filter((v): v is number => typeof v === 'number');
  const y = n[1] as number;
  switch (call.op) {
    case 'rect':
      return [y, y + (n[3] as number)];
    case 'strokeRect':
      return [y - (n[4] as number) / 2, y + (n[3] as number) + (n[4] as number) / 2];
    case 'circle':
      return [y - (n[2] as number), y + (n[2] as number)];
    case 'strokeCircle': {
      const reach = (n[2] as number) + (n[3] as number) / 2;
      return [y - reach, y + reach];
    }
    default:
      return null;
  }
}

describe('rendering', () => {
  it('never mutates the simulation, at any alpha', () => {
    const game = playFrames(21, 900);
    const before = JSON.stringify(game.field);
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) game.render(new RecordingRenderer(), alpha);
    expect(JSON.stringify(game.field)).toBe(before);
    game.destroy();
  });

  it('interpolates a running runner by the render alpha', () => {
    const game = playFrames(22, 400);
    const runner = game.field.p1.runner;
    runner.prevX = 200;
    runner.x = 260;
    runner.prevY = 800;
    runner.y = 800;
    const xAt = (alpha: number): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      const call = renderer.calls.find(
        (c) =>
          c.op === 'circle' && c.args[2] === RUNNER_RADIUS && c.args[3] === SEAT_PALETTE.p1.base,
      );
      return call === undefined ? Number.NaN : (call.args[0] as number);
    };
    expect(xAt(0)).toBeCloseTo(200, 6);
    expect(xAt(0.5)).toBeCloseTo(230, 6);
    expect(xAt(1)).toBeCloseTo(260, 6);
    game.destroy();
  });

  it('draws no text at all', () => {
    // The shell owns the scoreboard, and a game with no glyphs in it is a game that reads
    // the same in every language and in greyscale.
    const game = playFrames(23, 2000);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops).not.toContain('text');
    game.destroy();
  });

  it('keeps every drawn coordinate inside the declared box', () => {
    const game = new GuardandThiefGame();
    game.init(context(24, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 3600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 19 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0.5);
      for (const value of renderer.numbers) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(-2);
        expect(value).toBeLessThanOrEqual(Math.max(BOARD_WIDTH, BOARD_HEIGHT) + 2);
      }
    }
    game.destroy();
  });

  it('lets nothing but a runner cross the door in a seat’s own colour', () => {
    // Rule 9 is about *field of view*, and both players see the whole board, so this is not
    // the "nothing in the other half" assertion a split-field game makes — a runner's whole
    // job here is to cross. What must not cross is the furniture: the walls, the doorways
    // and the tallies stay on their owner's side, so the geography reads the same from
    // either end of the device.
    const game = new GuardandThiefGame();
    game.init(context(25, 'hard'));
    const { manager, view } = inputs();
    let crossings = 0;
    for (let i = 0; i < 3600; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        const seat = seatOf(call);
        if (seat === null) continue;
        const span = verticalSpan(call);
        if (span === null) continue;
        const strays = seat === 'p1' ? span[0] <= CENTRE_Y : span[1] >= CENTRE_Y;
        if (!strays) continue;
        crossings += 1;
        const height = span[1] - span[0];
        expect(height, `${call.op} ${String(call.args)}`).toBeLessThanOrEqual(
          RUNNER_RADIUS * 2 + 1,
        );
      }
    }
    // And it does happen, or the assertion above is guarding nothing.
    expect(crossings).toBeGreaterThan(0);
    game.destroy();
  });
});

/* ------------------------------------------------------------------------------------ */
/* Rule 7                                                                                */
/* ------------------------------------------------------------------------------------ */

/**
 * A local copy of `apps/web/src/data/greyscale.test.ts`'s question, so this package fails
 * on its own before the shared guard does.
 *
 * The two seat colours sit at 1.03:1 under deuteranopia
 * (`packages/engine/src/palette-vision.test.ts`), so for those players the shape is not a
 * layer over colour — it is the only signal there is.
 */
function seatGlyphs(game: GuardandThiefGame, alpha: number): Record<SeatId, Set<string>> {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  const out: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
  const unit = Math.min(BOARD_WIDTH, BOARD_HEIGHT) / 160;
  const q = (v: number): string => String(Math.round(Math.abs(v) / unit));
  for (const call of renderer.calls) {
    const seat = seatOf(call);
    if (seat === null) continue;
    const n = call.args.filter((v): v is number => typeof v === 'number');
    if (call.op === 'circle') out[seat].add(`circ|${q(n[2] as number)}`);
    else if (call.op === 'strokeCircle') out[seat].add(`scirc|${q(n[2] as number)}`);
    else if (call.op === 'rect') {
      // Anything covering a quarter of the board is field, not a player-owned element.
      const area = (n[2] as number) * (n[3] as number);
      if (area <= BOARD_WIDTH * BOARD_HEIGHT * 0.25) {
        out[seat].add(`rect|${q(n[2] as number)}|${q(n[3] as number)}`);
      }
    } else if (call.op === 'strokeRect') {
      out[seat].add(`srect|${q(n[2] as number)}|${q(n[3] as number)}`);
    }
  }
  return out;
}

describe('rule 7', () => {
  it('tells the two seats apart by shape, not only by colour', () => {
    const game = playFrames(31, 1500);
    const glyphs = seatGlyphs(game, 0);
    expect(glyphs.p1.size).toBeGreaterThan(0);
    expect(glyphs.p2.size).toBeGreaterThan(0);
    const onlyP1 = [...glyphs.p1].filter((g) => !glyphs.p2.has(g));
    const onlyP2 = [...glyphs.p2].filter((g) => !glyphs.p1.has(g));
    expect(onlyP1.length, `p1 ${[...glyphs.p1].join(' ')}`).toBeGreaterThan(0);
    expect(onlyP2.length, `p2 ${[...glyphs.p2].join(' ')}`).toBeGreaterThan(0);
    // Specifically: the near seat is round and the far seat is square, everywhere.
    expect([...glyphs.p1].some((g) => g.startsWith('circ|'))).toBe(true);
    expect([...glyphs.p1].some((g) => g.startsWith('scirc|'))).toBe(true);
    expect([...glyphs.p2].some((g) => g.startsWith('rect|'))).toBe(true);
    expect([...glyphs.p2].some((g) => g.startsWith('srect|'))).toBe(true);
    expect([...glyphs.p2].some((g) => g.startsWith('circ|'))).toBe(false);
    game.destroy();
  });

  it('keeps both seats on screen together, so the question can be asked at all', () => {
    const game = new GuardandThiefGame();
    game.init(context(32, 'hard'));
    const { manager, view } = inputs();
    let shared = 0;
    for (let i = 0; i < 1800; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 12 !== 0) continue;
      const glyphs = seatGlyphs(game, 0);
      if (glyphs.p1.size > 0 && glyphs.p2.size > 0) shared += 1;
    }
    expect(shared).toBe(150);
    game.destroy();
  });

  it('marks the two roles with something other than a colour', () => {
    // A guard wears a ring at exactly the radius it catches at; a thief does not. The mark
    // is ink rather than seat colour on purpose, so it survives the seat comparison above
    // and reads on either runner.
    const game = new GuardandThiefGame();
    game.init(context(33));
    const guardMarks = (): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      return renderer.calls.filter(
        (c) =>
          (c.op === 'strokeCircle' && c.args[2] === RUNNER_RADIUS * 2) ||
          (c.op === 'strokeRect' && c.args[2] === RUNNER_RADIUS * 4),
      ).length;
    };
    expect(guardMarks()).toBe(2);
    game.field.p1.runner.home = false;
    expect(guardMarks()).toBe(1);
    game.field.p2.runner.home = false;
    expect(guardMarks()).toBe(0);
    game.destroy();
  });
});
