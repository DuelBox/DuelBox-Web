import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, envelopeFor } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign } from '@duelbox/engine';
import type { Game, GameContext, MatchScore, Renderer } from '@duelbox/game-sdk';
import { PiranhaRushGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_Y,
  HEADINGS,
  MOVE_DEADZONE,
  SEATS,
  SWIM_RADIUS,
  SWIM_SPEED,
  lagoonOf,
  seatAxisSign,
  toBoardX,
  toBoardY,
} from './rules.js';
import type { Game as Field } from './rules.js';

const STEP = 1 / 60;
const ENVELOPE = envelopeFor(manifest.logical);

function context(
  seed = 20260829,
  difficulty: 'easy' | 'normal' | 'hard' | null = null,
  overrides: Partial<GameContext> = {},
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => difficulty,
    ...overrides,
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

/** Which seat a draw call belongs to, by exact palette string, or null for neutral ink. */
function seatOf(call: Call): SeatId | null {
  const colour = call.args[call.args.length - 1];
  for (const seat of SEATS) {
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

/** Every y a call paints at, so a mark can be placed in one half of the device or the other. */
function verticalSpan(call: Call): readonly [number, number] {
  const a = call.args as readonly number[];
  switch (call.op) {
    case 'rect':
      return [a[1] as number, (a[1] as number) + (a[3] as number)];
    case 'strokeRect':
      return [
        (a[1] as number) - (a[4] as number),
        (a[1] as number) + (a[3] as number) + (a[4] as number),
      ];
    case 'circle':
      return [(a[1] as number) - (a[2] as number), (a[1] as number) + (a[2] as number)];
    case 'strokeCircle':
      return [
        (a[1] as number) - (a[2] as number) - (a[3] as number),
        (a[1] as number) + (a[2] as number) + (a[3] as number),
      ];
    case 'line':
      return [Math.min(a[1] as number, a[3] as number), Math.max(a[1] as number, a[3] as number)];
    default:
      return [CENTRE_Y, CENTRE_Y];
  }
}

/* ------------------------------------------------------------------------------------ */
/* The contract                                                                          */
/* ------------------------------------------------------------------------------------ */

describe('the contract', () => {
  it('never claims to have turns, and never reads the opening seat', () => {
    // `apps/web/src/data/turn-seat.test.ts` enforces the first half: a real-time game that
    // reported an active seat would switch the shell into shared-board mode and take one
    // seat's pointer zone away. The SDK contract grants the second half outright — both
    // swimmers start at the same point of the same lagoon, so there is nothing for an
    // opener to name and inventing one would manufacture a first-mover advantage.
    const game: Game = new PiranhaRushGame();
    expect(Object.prototype.hasOwnProperty.call(PiranhaRushGame.prototype, 'getActiveSeat')).toBe(
      false,
    );
    expect(game.getActiveSeat?.() ?? null).toBeNull();

    const play = (openingSeat: SeatId): string => {
      const one = new PiranhaRushGame();
      one.init(context(5, 'normal', { openingSeat }));
      const { manager, view } = inputs();
      const trace: number[] = [];
      for (let i = 0; i < 900; i += 1) {
        one.update(STEP, view.sync(manager.beginStep(STEP)));
        trace.push(one.getScore().p1, one.getScore().p2);
      }
      one.destroy();
      return trace.join(',');
    };
    expect(play('p2')).toBe(play('p1'));
  });

  it('reports a score the shell can read at every moment of a match', () => {
    const game = new PiranhaRushGame();
    game.init(context(1, 'normal'));
    const { manager, view } = inputs();
    const seen: MatchScore[] = [];
    for (let i = 0; i < 3000; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      seen.push(score);
      expect(Number.isInteger(score.p1)).toBe(true);
      expect(Number.isInteger(score.p2)).toBe(true);
      expect(score.p1).toBeGreaterThanOrEqual(0);
      expect(score.p2).toBeGreaterThanOrEqual(0);
      if (score.winner !== null) break;
    }
    expect(seen[seen.length - 1]?.winner).not.toBeNull();
    // A score only ever goes up: there is no way to lose distance you have already swum.
    for (let i = 1; i < seen.length; i += 1) {
      expect((seen[i] as MatchScore).p1).toBeGreaterThanOrEqual((seen[i - 1] as MatchScore).p1);
      expect((seen[i] as MatchScore).p2).toBeGreaterThanOrEqual((seen[i - 1] as MatchScore).p2);
    }
    game.destroy();
  });

  it('puts a fresh match back on the board when it is destroyed', () => {
    const game = new PiranhaRushGame();
    game.init(context(2, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.field.elapsed).toBeGreaterThan(0);
    game.destroy();
    expect(game.field.elapsed).toBe(0);
    expect(game.field.winner).toBeNull();
    expect(game.field.p1.swimmer.distance).toBe(0);
    expect(game.field.p2.swimmer.alive).toBe(true);
  });

  it('wires the difficulty through: three tiers, three different matches', () => {
    const play = (tier: 'easy' | 'normal' | 'hard'): string => {
      const game = new PiranhaRushGame();
      game.init(context(3, tier));
      const { manager, view } = inputs();
      const out: number[] = [];
      for (let i = 0; i < 900; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        out.push(game.getScore().p1, game.getScore().p2);
      }
      game.destroy();
      return out.join(',');
    };
    const easy = play('easy');
    const normal = play('normal');
    const hard = play('hard');
    expect(easy).not.toBe(normal);
    expect(normal).not.toBe(hard);
  });

  it('plays the identical match in both presentations', () => {
    // `docs/presentation.md`: rules, scoring and simulation are byte-identical across the
    // two, and only placement, rotation and control mapping change. Nothing in this
    // package reads `presentation` at all, which is why.
    const play = (presentation: Presentation, localSeat: SeatId): string => {
      const game = new PiranhaRushGame();
      game.init(context(11, 'normal', { presentation, localSeat }));
      const { manager, view } = inputs();
      const out: number[] = [];
      for (let i = 0; i < 1200; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        out.push(game.getScore().p1, game.getScore().p2);
      }
      game.destroy();
      return out.join(',');
    };
    expect(play('single-seat', 'p2')).toBe(play('shared-screen', 'p1'));
    expect(play('single-seat', 'p1')).toBe(play('shared-screen', 'p1'));
  });
});

/* ------------------------------------------------------------------------------------ */
/* The two instruments                                                                   */
/* ------------------------------------------------------------------------------------ */

/** Which of a seat's keys names a device direction. Both seats have the same four slots. */
const KEYS: Readonly<
  Record<SeatId, { x: readonly [string, string]; y: readonly [string, string] }>
> = {
  p1: { x: ['KeyA', 'KeyD'], y: ['KeyW', 'KeyS'] },
  p2: { x: ['ArrowLeft', 'ArrowRight'], y: ['ArrowUp', 'ArrowDown'] },
};

/**
 * Walk one seat along one lagoon-local heading through one instrument, and report the path.
 *
 * The whole fairness argument, executed. A key names a direction and a finger names a
 * point, and both are reduced to the sign of a gap on each axis — so if the two
 * instruments and the two seats do not produce the identical path, one of the four can
 * reach somewhere the others cannot.
 */
function walk(
  seat: SeatId,
  dx: number,
  dy: number,
  instrument: 'keys' | 'finger',
  steps = 24,
): string {
  const game = new PiranhaRushGame();
  game.init(context(31));
  const { manager, view } = inputs();
  const field = game.field as Field;
  // The reef and the shoal are identical in every arm, so they need not be removed — but
  // removing them makes a failure a fact about the input mapping rather than about a
  // coral head that happened to be in the way of one heading.
  for (let i = 0; i < field.corals.length; i += 1) {
    field.corals[i]!.x = -100_000;
    field.corals[i]!.y = -100_000;
  }
  for (const s of SEATS) {
    for (const piranha of lagoonOf(field, s).piranhas) {
      piranha.x = -100_000;
      piranha.y = -100_000;
    }
  }

  const path: string[] = [];
  const swimmer = lagoonOf(field, seat).swimmer;
  for (let i = 0; i < steps; i += 1) {
    if (instrument === 'keys') {
      if (dx > 0) manager.keyDown(KEYS[seat].x[1]);
      else if (dx < 0) manager.keyDown(KEYS[seat].x[0]);
      if (dy > 0) manager.keyDown(KEYS[seat].y[1]);
      else if (dy < 0) manager.keyDown(KEYS[seat].y[0]);
    } else {
      // A point on the glass, a hundred units away in the direction the seat means. The
      // half-turn is applied here and only here, because a finger names a device point.
      const axis = seatAxisSign(seat);
      manager.pointerDown(
        0,
        toBoardX(seat, swimmer.x) + dx * 100 * axis,
        toBoardY(seat, swimmer.y) + dy * 100 * axis,
      );
    }
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    path.push(`${swimmer.x.toFixed(9)},${swimmer.y.toFixed(9)},${swimmer.distance.toFixed(9)}`);
  }
  game.destroy();
  return path.join(' ');
}

describe('the two instruments', () => {
  it('drive the identical walk from either seat, keys or finger', () => {
    // Four arms of the same intent: two instruments times two seats. All four must agree,
    // which is the strongest form of `docs/input-parity.md`'s claim available to a game.
    for (let i = 0; i < HEADINGS.length; i += 1) {
      const heading = HEADINGS[i] as { x: number; y: number };
      const dx = Math.sign(heading.x);
      const dy = Math.sign(heading.y);
      const reference = walk('p1', dx, dy, 'keys');
      expect(walk('p1', dx, dy, 'finger'), `p1 finger ${String(i)}`).toBe(reference);
      expect(walk('p2', dx, dy, 'keys'), `p2 keys ${String(i)}`).toBe(reference);
      expect(walk('p2', dx, dy, 'finger'), `p2 finger ${String(i)}`).toBe(reference);
    }
  });

  it('gives the keyboard no per-seat sign, and the pointer exactly one', () => {
    // The consequence of simulating in the lagoon's own frame, stated as a test because it
    // is the one thing about this package that is easy to get backwards. A seat two player
    // pressing the right arrow means *their* right, which is the device's left — and the
    // two flips cancel, so the raw move vector is already a lagoon-local heading.
    const game = new PiranhaRushGame();
    game.init(context(32));
    const { manager, view } = inputs();
    const field = game.field as Field;
    const swimmer = field.p2.swimmer;
    const startBoardX = toBoardX('p2', swimmer.x);
    manager.keyDown('ArrowRight');
    for (let i = 0; i < 20; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    // Local x went up, which for seat two is *leftwards* on the device — their own right.
    expect(swimmer.x).toBeGreaterThan(280);
    expect(toBoardX('p2', swimmer.x)).toBeLessThan(startBoardX);
    game.destroy();
  });

  it('reduces a finger to the sign of a gap and never to a position', () => {
    // Two fingers a hundred units apart in the same direction produce the identical swim,
    // so no amount of pointing precision buys anybody anything a key cannot spell.
    const near = (): string => walkTo(160);
    const far = (): string => walkTo(260);
    function walkTo(reach: number): string {
      const game = new PiranhaRushGame();
      game.init(context(33));
      const { manager, view } = inputs();
      const swimmer = (game.field as Field).p1.swimmer;
      const out: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        manager.pointerDown(0, toBoardX('p1', swimmer.x) + reach, toBoardY('p1', swimmer.y));
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        out.push(swimmer.x.toFixed(9));
      }
      game.destroy();
      return out.join(' ');
    }
    expect(near()).toBe(far());
  });

  it('treats the deadzone edge the same way from both seats, to the last bit', () => {
    // The Frozen Beaks defect family, aimed at the one place this package could still hold
    // it: the deadzone comparison is `<=` against a threshold a quantised pointer can land
    // on *exactly*, and the two seats reach that threshold from opposite ends of the board.
    //
    // 12 units is four precision envelopes, so a finger can be placed exactly on it: the
    // swimmer starts at board x 300 for both seats, and 312 and 288 are its mirror images
    // and both on the lattice.
    const at = (seat: SeatId, boardX: number): number => {
      const game = new PiranhaRushGame();
      game.init(context(34));
      const { manager, view } = inputs();
      const swimmer = lagoonOf(game.field, seat).swimmer;
      const before = swimmer.x;
      manager.pointerDown(0, boardX, toBoardY(seat, swimmer.y));
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const moved = swimmer.x - before;
      game.destroy();
      return moved;
    };
    expect(toBoardX('p1', 280)).toBe(300);
    expect(toBoardX('p2', 280)).toBe(300);
    expect(MOVE_DEADZONE).toBe(4 * ENVELOPE);
    // Exactly on the edge: a standstill, from both seats.
    expect(at('p1', 300 + MOVE_DEADZONE)).toBe(0);
    expect(at('p2', 300 - MOVE_DEADZONE)).toBe(0);
    // One precision envelope past it: a swim, from both seats, of the same size.
    const one = at('p1', 300 + MOVE_DEADZONE + ENVELOPE);
    const two = at('p2', 300 - MOVE_DEADZONE - ENVELOPE);
    expect(one).toBe(SWIM_SPEED * STEP);
    expect(two).toBe(one);
  });

  it('lets a finger resting on your own swimmer mean tread water', () => {
    const game = new PiranhaRushGame();
    game.init(context(35));
    const { manager, view } = inputs();
    const swimmer = (game.field as Field).p1.swimmer;
    for (let i = 0; i < 20; i += 1) {
      manager.pointerDown(0, toBoardX('p1', swimmer.x), toBoardY('p1', swimmer.y));
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(swimmer.distance).toBe(0);
    game.destroy();
  });

  it('gives a seat only its own half to start a gesture in', () => {
    // The engine owns this rule; the test is here because the two lagoons depend on it.
    const game = new PiranhaRushGame();
    game.init(context(36));
    const { manager, view } = inputs();
    const field = game.field as Field;
    const before = field.p2.swimmer.distance;
    for (let i = 0; i < 40; i += 1) {
      manager.pointerDown(0, 300, toBoardY('p1', field.p1.swimmer.y) + 100);
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(field.p2.swimmer.distance).toBe(before);
    expect(field.p1.swimmer.distance).toBeGreaterThan(0);
    game.destroy();
  });

  it('never reads the action, so holding Space or Enter changes nothing', () => {
    // `actionHeld` is `keys.action || pointerDown`, so a finger on the glass *is* the
    // action and a key player can hold a direction without one. Any rule bound to the
    // action costs one instrument something the other gets free; this game has no rule
    // bound to it at all.
    const run = (withAction: boolean): string => {
      const game = new PiranhaRushGame();
      game.init(context(37));
      const { manager, view } = inputs();
      if (withAction) {
        manager.keyDown('Space');
        manager.keyDown('Enter');
      }
      manager.keyDown('KeyD');
      manager.keyDown('ArrowRight');
      const out: number[] = [];
      for (let i = 0; i < 200; i += 1) {
        game.update(STEP, view.sync(manager.beginStep(STEP)));
        out.push(game.field.p1.swimmer.distance, game.field.p2.swimmer.distance);
      }
      game.destroy();
      return out.join(',');
    };
    expect(run(true)).toBe(run(false));
  });

  it('does not carry a stale heading through the pause menu', () => {
    for (const path of ['pause', 'resume'] as const) {
      const game = new PiranhaRushGame();
      game.init(context(38));
      const { manager, view } = inputs();
      manager.keyDown('KeyD');
      for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const held = game.field.p1.swimmer.distance;
      expect(held).toBeGreaterThan(0);
      game.onPause();
      manager.clear();
      if (path === 'resume') game.onResume();
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      expect(game.field.p1.swimmer.distance, path).toBe(held);
      game.destroy();
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* Rendering                                                                             */
/* ------------------------------------------------------------------------------------ */

function played(steps: number, tier: 'easy' | 'normal' | 'hard' = 'normal'): PiranhaRushGame {
  const game = new PiranhaRushGame();
  game.init(context(41, tier));
  const { manager, view } = inputs();
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
  return game;
}

describe('rendering', () => {
  it('adds nothing to the simulation, at any alpha', () => {
    const game = played(600);
    const before = JSON.stringify(game.field);
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.999]) {
      for (let i = 0; i < 8; i += 1) game.render(new RecordingRenderer(), alpha);
    }
    expect(JSON.stringify(game.field)).toBe(before);
    game.destroy();
  });

  it('interpolates a swimmer by the alpha it is handed', () => {
    const game = new PiranhaRushGame();
    game.init(context(42));
    const { manager, view } = inputs();
    manager.keyDown('KeyD');
    for (let i = 0; i < 40; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const swimmer = game.field.p1.swimmer;
    const bodyAt = (alpha: number): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      const body = renderer.calls.find(
        (call) => call.op === 'circle' && call.args[3] === SEAT_PALETTE.p1.base,
      );
      return body?.args[0] as number;
    };
    expect(bodyAt(0)).toBeCloseTo(toBoardX('p1', swimmer.prevX), 9);
    expect(bodyAt(1)).toBeCloseTo(toBoardX('p1', swimmer.x), 9);
    expect(bodyAt(0.5)).toBeCloseTo(toBoardX('p1', (swimmer.prevX + swimmer.x) / 2), 9);
    game.destroy();
  });

  it('draws no text at all, so nothing on the board needs reading', () => {
    const game = played(900);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0.5);
    expect(renderer.ops).not.toContain('text');
    game.destroy();
  });

  it('keeps every mark inside the declared logical box', () => {
    const game = new PiranhaRushGame();
    game.init(context(43, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 1500; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 25 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0.5);
      for (const value of renderer.numbers) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(-BOARD_WIDTH);
        expect(value).toBeLessThanOrEqual(BOARD_HEIGHT + BOARD_WIDTH);
      }
    }
    game.destroy();
  });

  it('never paints one seat’s colour in the other seat’s half', () => {
    // Rule 9 in a picture: each player's lagoon is a full-width band and nothing they own
    // strays over the middle, so neither of them can see more of the other's water than
    // the other can.
    const game = new PiranhaRushGame();
    game.init(context(44, 'normal'));
    const { manager, view } = inputs();
    for (let i = 0; i < 1500; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 20 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0.5);
      for (const call of renderer.calls) {
        const seat = seatOf(call);
        if (seat === null) continue;
        const [top, bottom] = verticalSpan(call);
        if (seat === 'p1') expect(top, `${call.op} at step ${String(i)}`).toBeGreaterThan(CENTRE_Y);
        else expect(bottom, `${call.op} at step ${String(i)}`).toBeLessThan(CENTRE_Y);
      }
    }
    game.destroy();
  });

  it('tells the two seats apart by shape, not only by colour', () => {
    // A local copy of the question `apps/web/src/data/greyscale.test.ts` asks, so this
    // package fails on its own before the shared guard does. The two seat colours sit at
    // 1.03:1 under deuteranopia (`packages/engine/src/palette-vision.test.ts`), so for
    // those players the shape is the only signal there is.
    const game = played(700, 'normal');
    const primitives: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
    for (let i = 0; i < 6; i += 1) {
      const renderer = new RecordingRenderer();
      game.render(renderer, i / 6);
      for (const call of renderer.calls) {
        const seat = seatOf(call);
        if (seat !== null) primitives[seat].add(call.op);
      }
    }
    // Seat one is round everywhere and seat two is square everywhere.
    expect([...primitives.p1].sort()).toContain('circle');
    expect([...primitives.p1]).not.toContain('strokeRect');
    expect([...primitives.p2]).toContain('strokeRect');
    expect([...primitives.p2]).not.toContain('circle');
    expect([...primitives.p2]).not.toContain('strokeCircle');
    game.destroy();
  });

  it('gives the far seat two shore stripes and the near seat one', () => {
    // A fixed multiplicity, so it reads as a pattern rather than as a score — the second
    // piece of evidence `greyscale.test.ts` looks for, and the one that survives a seat
    // being taken.
    const game = played(400);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const stripes = (seat: SeatId): number =>
      renderer.calls.filter(
        (call) => call.op === 'rect' && call.args[4] === SEAT_PALETTE[seat].tint,
      ).length;
    expect(stripes('p1')).toBe(1);
    expect(stripes('p2')).toBe(2);
    game.destroy();
  });

  it('draws a piranha, a coral head and a swimmer as three different things', () => {
    // Rule 7 read as a requirement about the pieces rather than only about the two seats:
    // the three kinds of object on the board at once are a wedge of lines, a spoked burst
    // and a filled body, and none of them is a plain disc of another's size.
    const game = played(300);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const lines = renderer.calls.filter((call) => call.op === 'line');
    // Four piranhas a lagoon, three strokes each, two lagoons — plus the divider, the
    // gauge notches and the two swimmers' noses.
    expect(lines.length).toBeGreaterThanOrEqual(4 * 3 * 2 + 6 * 6 * 2);
    // Exactly one body each, and each is its own seat's primitive at its own size — the
    // milestone markers on the tallies are the same primitives at a different size, which
    // is why this counts by radius rather than by colour alone.
    const round = renderer.calls.filter(
      (call) => call.op === 'circle' && call.args[2] === SWIM_RADIUS && seatOf(call) === 'p1',
    );
    const square = renderer.calls.filter(
      (call) => call.op === 'rect' && call.args[2] === SWIM_RADIUS * 2 && seatOf(call) === 'p2',
    );
    expect(round).toHaveLength(1);
    expect(square).toHaveLength(1);
    game.destroy();
  });

  it('shows both players the same shoal gauge, unchanged by the half-turn', () => {
    const game = played(600);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const notches = renderer.calls.filter(
      (call) => call.op === 'line' && call.args[0] === 3 && call.args[2] === 16,
    );
    expect(notches).toHaveLength(2);
    const above = notches[0]?.args[1] as number;
    const below = notches[1]?.args[1] as number;
    // Symmetric about the centre line: literally the same object from either side.
    expect(CENTRE_Y - above).toBeCloseTo(below - CENTRE_Y, 9);
    game.destroy();
  });
});
