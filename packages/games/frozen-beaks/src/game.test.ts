import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId, TextAlign } from '@duelbox/engine';
import type { Game, GameContext, MatchScore, Renderer } from '@duelbox/game-sdk';
import { FrozenBeaksGame } from './game.js';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  DUNK_SECONDS,
  MATCH_SECONDS,
  MOVE_DEADZONE,
  TARGET_FISH,
  TIERS,
  homeX,
  homeY,
  maxX,
} from './rules.js';
import type { Tier } from './rules.js';

const STEP = 1 / 60;

function context(
  seed = 20260829,
  difficulty: 'easy' | 'normal' | 'hard' | null = null,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
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

  get args(): unknown[] {
    return this.calls.flatMap((call) => [...call.args]);
  }

  get numbers(): number[] {
    return this.args.filter((value): value is number => typeof value === 'number');
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
    // pointer zone away. The SDK contract says a real-time game may ignore
    // `openingSeat` too, and this one does — both floes are identical and there is
    // nothing for an opener to name.
    const game: Game = new FrozenBeaksGame();
    expect(Object.prototype.hasOwnProperty.call(FrozenBeaksGame.prototype, 'getActiveSeat')).toBe(
      false,
    );
    expect(game.getActiveSeat?.() ?? null).toBeNull();
  });

  it('reports a score the shell can read at every moment of a match', () => {
    const game = new FrozenBeaksGame();
    game.init(context(1, 'normal'));
    const { manager, view } = inputs();
    const seen: MatchScore[] = [];
    for (let i = 0; i < 4000; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      seen.push(score);
      expect(Number.isInteger(score.p1)).toBe(true);
      expect(Number.isInteger(score.p2)).toBe(true);
      expect(score.p1).toBeGreaterThanOrEqual(0);
      expect(score.p2).toBeGreaterThanOrEqual(0);
      if (score.winner !== null) break;
    }
    const last = seen[seen.length - 1] as MatchScore;
    expect(last.winner).not.toBeNull();
    expect(Math.max(last.p1, last.p2)).toBeLessThanOrEqual(TARGET_FISH);
    game.destroy();
  });

  it('starts a fresh match from init, with no leakage between matches', () => {
    const game = new FrozenBeaksGame();
    game.init(context(2, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 1200; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);
    game.init(context(2, 'hard'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.field.clock).toBe(MATCH_SECONDS);
    expect(game.field.p1.bird.x).toBe(homeX());
    expect(game.field.p1.bird.y).toBe(homeY('p1'));
    game.destroy();
  });

  it('plays the identical match after a rematch on the same seed', () => {
    const trace = (): string => {
      const game = new FrozenBeaksGame();
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

  it('releases its state on destroy', () => {
    const game = new FrozenBeaksGame();
    game.init(context(4, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 900; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.field.p1.bird.phase).toBe('walk');
    expect(game.field.p2.bird.dunks).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Input                                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * The same intent through both instruments, driven through a real `InputManager`.
 *
 * This is the test the fairness argument stands on: a key and a finger asking for the
 * same walk must launch the same slide — same tier, same heading, same launch point.
 */
function walkThenRelease(
  spell: 'keyboard' | 'pointer',
  steps: number,
): { x: number; y: number; speed: number; slideX: number; slideY: number } {
  const game = new FrozenBeaksGame();
  game.init(context(5));
  const { manager, view } = inputs();
  const bird = game.field.p1.bird;
  for (let i = 0; i < steps; i += 1) {
    if (spell === 'keyboard') {
      manager.keyDown('KeyD');
    } else {
      // The far rim of this seat's own floe, level with the bird and far enough that the
      // walk never arrives, so the per-axis signs stay (+1, 0) — the same one of nine
      // headings the key names.
      manager.pointerDown(0, maxX(), homeY('p1'));
    }
    game.update(STEP, view.sync(manager.beginStep(STEP)));
  }
  if (spell === 'keyboard') manager.keyUp('KeyD');
  else manager.pointerUp(0);
  game.update(STEP, view.sync(manager.beginStep(STEP)));
  const result = {
    x: bird.x,
    y: bird.y,
    speed: bird.speed,
    slideX: bird.slideX,
    slideY: bird.slideY,
  };
  game.destroy();
  return result;
}

describe('the two instruments', () => {
  it('launch the identical slide from the identical walk', () => {
    for (const steps of [20, 50, 90]) {
      const keys = walkThenRelease('keyboard', steps);
      const finger = walkThenRelease('pointer', steps);
      expect(finger, `after ${String(steps)} steps`).toEqual(keys);
    }
  });

  it('spend the same wind-up: neither pays for holding the action', () => {
    // `actionHeld` is `keys.action || pointerDown`, so a finger on the glass *is* the
    // action and a keyboard player can walk without pressing anything. This game never
    // reads the action at all, so that asymmetry has nothing to bite on — and holding
    // Space or Enter changes nothing.
    const withAction = (): number => {
      const game = new FrozenBeaksGame();
      game.init(context(6));
      const { manager, view } = inputs();
      manager.keyDown('Space');
      manager.keyDown('KeyW');
      for (let i = 0; i < 80; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const charge = game.field.p1.bird.charge;
      game.destroy();
      return charge;
    };
    const without = (): number => {
      const game = new FrozenBeaksGame();
      game.init(context(6));
      const { manager, view } = inputs();
      manager.keyDown('KeyW');
      for (let i = 0; i < 80; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
      const charge = game.field.p1.bird.charge;
      game.destroy();
      return charge;
    };
    expect(withAction()).toBe(without());
  });

  it('release when a finger comes to rest on the bird, exactly as a lift does', () => {
    const game = new FrozenBeaksGame();
    game.init(context(7));
    const { manager, view } = inputs();
    const bird = game.field.p1.bird;
    for (let i = 0; i < 60; i += 1) {
      manager.pointerDown(0, homeX() + 180, homeY('p1'));
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(bird.phase).toBe('walk');
    // Inside the deadzone: the answer is a standstill, and a standstill is the release.
    manager.pointerMove(0, bird.x + MOVE_DEADZONE / 2, bird.y);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(bird.phase).toBe('slide');
    expect(bird.slideX).toBe(1);
    game.destroy();
  });

  it('mirrors the far seat’s keys and not the far seat’s finger', () => {
    const game = new FrozenBeaksGame();
    game.init(context(8));
    const { manager, view } = inputs();
    const bird = game.field.p2.bird;
    const startX = bird.x;
    // Seat two reads the device upside down, so its own right arrow is the device's left.
    manager.keyDown('ArrowRight');
    for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(bird.x).toBeLessThan(startX);
    manager.keyUp('ArrowRight');

    // A finger is not mirrored: a point on the glass is that point from either side.
    const game2 = new FrozenBeaksGame();
    game2.init(context(8));
    const second = inputs();
    const bird2 = game2.field.p2.bird;
    const start2 = bird2.x;
    for (let i = 0; i < 30; i += 1) {
      second.manager.pointerDown(1, homeX() + 180, homeY('p2'));
      game2.update(STEP, second.view.sync(second.manager.beginStep(STEP)));
    }
    expect(bird2.x).toBeGreaterThan(start2);
    game.destroy();
    game2.destroy();
  });

  it('gives a seat only its own half to start a gesture in', () => {
    // The engine owns this rule; the test is here because the floes depend on it. A press
    // in seat one's band belongs to seat one, and seat two's bird does not move.
    const game = new FrozenBeaksGame();
    game.init(context(9));
    const { manager, view } = inputs();
    const p2 = game.field.p2.bird;
    const before = p2.x;
    for (let i = 0; i < 40; i += 1) {
      manager.pointerDown(0, homeX() + 180, homeY('p1'));
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
    expect(p2.x).toBe(before);
    expect(game.field.p1.bird.x).toBeGreaterThan(before);
    game.destroy();
  });

  it('does not slide on the way out of the pause menu', () => {
    // `InputManager.clear()` drops every key and pointer, which arrives as a standstill —
    // and a standstill here is a release. `docs/input-idiom.md` names `pointerCancelled`
    // as the missing primitive; until it exists the game plants its own feet.
    for (const path of ['pause', 'resume'] as const) {
      const game = new FrozenBeaksGame();
      game.init(context(10));
      const { manager, view } = inputs();
      const bird = game.field.p1.bird;
      for (let i = 0; i < 60; i += 1) {
        manager.pointerDown(0, homeX() + 180, homeY('p1'));
        game.update(STEP, view.sync(manager.beginStep(STEP)));
      }
      expect(bird.charge).toBeGreaterThan((TIERS[0] as Tier).windUp);
      game.onPause();
      manager.clear();
      if (path === 'resume') game.onResume();
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      expect(bird.phase, path).toBe('walk');
      expect(bird.slides, path).toBe(0);
      game.destroy();
    }
  });

  it('plays the identical match in both presentations', () => {
    // `docs/presentation.md`: rules, scoring and simulation are byte-identical across the
    // two, and only placement, rotation and control mapping change. Nothing in this
    // package reads `presentation` at all, which is why.
    const play = (presentation: 'shared-screen' | 'single-seat', localSeat: SeatId): string => {
      const game = new FrozenBeaksGame();
      game.init({ ...context(11, 'normal'), presentation, localSeat });
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
  });
});

/* ------------------------------------------------------------------------------------ */
/* Rendering                                                                             */
/* ------------------------------------------------------------------------------------ */

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

/** The top and bottom a primitive actually covers, which is not `args[1]`. */
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
    case 'line': {
      const half = (n[4] as number) / 2;
      return [Math.min(y, n[3] as number) - half, Math.max(y, n[3] as number) + half];
    }
    default:
      return null;
  }
}

function playFrames(seed: number, steps: number): FrozenBeaksGame {
  const game = new FrozenBeaksGame();
  game.init(context(seed, 'normal'));
  const { manager, view } = inputs();
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
  return game;
}

describe('rendering', () => {
  it('never mutates the simulation, at any alpha', () => {
    const game = playFrames(21, 900);
    const before = JSON.stringify(game.field);
    for (const alpha of [0, 0.25, 0.5, 0.75, 1]) game.render(new RecordingRenderer(), alpha);
    expect(JSON.stringify(game.field)).toBe(before);
    game.destroy();
  });

  it('interpolates a walking bird by the render alpha', () => {
    const game = playFrames(22, 400);
    const bird = game.field.p1.bird;
    // Force a known displacement so the interpolation has something to show.
    bird.prevX = 200;
    bird.x = 260;
    bird.prevY = 800;
    bird.y = 800;
    const xsAt = (alpha: number): number => {
      const renderer = new RecordingRenderer();
      game.render(renderer, alpha);
      const call = renderer.calls.find(
        (c) => c.op === 'circle' && c.args[3] === SEAT_PALETTE.p1.base,
      );
      return call === undefined ? Number.NaN : (call.args[0] as number);
    };
    expect(xsAt(0)).toBeCloseTo(200, 6);
    expect(xsAt(0.5)).toBeCloseTo(230, 6);
    expect(xsAt(1)).toBeCloseTo(260, 6);
    game.destroy();
  });

  it('draws no text at all', () => {
    // The shell owns the scoreboard, and a game with no glyphs in it is a game that reads
    // the same in every language and in greyscale.
    const game = playFrames(23, 1800);
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.ops).not.toContain('text');
    game.destroy();
  });

  it('keeps every drawn coordinate inside the declared box', () => {
    const game = new FrozenBeaksGame();
    game.init(context(24, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 2400; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 7 !== 0) continue;
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

  it('never draws one seat’s marks in the other seat’s half', () => {
    // Rule 9 in a picture: each player's own floe is a full-width band and nothing a
    // player owns strays over the middle, so neither of them is reading the other's ice.
    const game = new FrozenBeaksGame();
    game.init(context(25, 'hard'));
    const { manager, view } = inputs();
    for (let i = 0; i < 2400; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 11 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        const seat = seatOf(call);
        if (seat === null) continue;
        const span = verticalSpan(call);
        if (span === null) continue;
        if (seat === 'p1') expect(span[0], `${call.op} ${String(call.args)}`).toBeGreaterThan(500);
        else expect(span[1], `${call.op} ${String(call.args)}`).toBeLessThan(500);
      }
    }
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
function seatGlyphs(game: FrozenBeaksGame, alpha: number): Record<SeatId, Set<string>> {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  const out: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
  const unit = Math.min(BOARD_WIDTH, BOARD_HEIGHT) / 160;
  const q = (v: number): string => String(Math.round(Math.abs(v) / unit));
  for (const call of renderer.calls) {
    const colour = call.args[call.args.length - 1];
    let seat: SeatId | null = null;
    for (const candidate of ['p1', 'p2'] as const) {
      const palette = SEAT_PALETTE[candidate];
      if (
        colour === palette.base ||
        colour === palette.deep ||
        colour === palette.tint ||
        colour === palette.soft
      ) {
        seat = candidate;
      }
    }
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
    expect([...glyphs.p2].some((g) => g.startsWith('rect|'))).toBe(true);
    game.destroy();
  });

  it('keeps both seats on screen together, so the question can be asked at all', () => {
    const game = new FrozenBeaksGame();
    game.init(context(32, 'hard'));
    const { manager, view } = inputs();
    let shared = 0;
    for (let i = 0; i < 1800; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (i % 12 !== 0) continue;
      const glyphs = seatGlyphs(game, 0);
      if (glyphs.p1.size > 0 && glyphs.p2.size > 0) shared += 1;
    }
    expect(shared).toBeGreaterThan(140);
    game.destroy();
  });

  it('keeps a seat’s shape on screen even while its bird is in the water', () => {
    const game = new FrozenBeaksGame();
    game.init(context(33));
    const bird = game.field.p1.bird;
    bird.phase = 'dunk';
    bird.dunk = DUNK_SECONDS;
    const glyphs = seatGlyphs(game, 0);
    expect([...glyphs.p1].some((g) => g.startsWith('scirc|'))).toBe(true);
    game.destroy();
  });
});
