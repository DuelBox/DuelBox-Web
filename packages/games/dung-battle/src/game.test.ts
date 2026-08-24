import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId, TextAlign } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { BOARD, DungBattleGame, POINTER_DEADZONE } from './game.js';
import { manifest } from './manifest.js';
import gameModule from './index.js';
import {
  ARENA_HALF,
  BASE_RADIUS,
  BEETLE_BUG_TOUCH,
  BEETLE_RADIUS,
  BEETLE_SPEED,
  KICKOFF_SECONDS,
  LADYBUG_COUNT,
  MATCH_SECONDS,
  TARGET_DELIVERIES,
  deliveryIn,
  stepsFor,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
/** The clock is the only bound on a match: 60 seconds at the fixed step, plus the step it ends on. */
const CEILING = MATCH_SECONDS * 60 + 1;
const OPENING = stepsFor(KICKOFF_SECONDS, STEP);

function context(
  seed = 1,
  p1: BotDifficulty | null = null,
  p2: BotDifficulty | null = null,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1 : p2),
  };
}

/** The real input manager, wired the way the host wires it for this archetype. */
function surface(): { input: InputManager; view: InputView } {
  return {
    // GameHost: a game whose getActiveSeat() is null keeps the zoned split, and
    // `shared-board` is not `vertical`, so the surface is split horizontally.
    input: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

function started(seed = 1, p1: BotDifficulty | null = null, p2: BotDifficulty | null = null) {
  const game = new DungBattleGame();
  game.init(context(seed, p1, p2));
  const { input, view } = surface();
  for (let i = 0; i < OPENING; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
  if (p1 === null && p2 === null) clearBugs(game);
  return { game, input, view };
}

/**
 * Park every ladybug in a far corner.
 *
 * The control tests are about controls. Left where they are, the bugs circle the ball and
 * flip whichever beetle a test is steering, and an assertion about a key becomes an
 * assertion about a hazard — which is how "stops the moment the key comes up" first failed:
 * the beetle had stopped and then been skidded backwards by a bug.
 */
function clearBugs(game: DungBattleGame): void {
  for (const bug of game.pit.bugs) {
    bug.x = -(ARENA_HALF - 30);
    bug.y = -(ARENA_HALF - 30);
    bug.hx = -1;
    bug.hy = -1;
  }
}

function run(game: DungBattleGame, input: InputManager, view: InputView, steps: number): void {
  for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
}

/** Logical board coordinates for a point in the simulation's own frame. */
function board(x: number, y: number): [number, number] {
  return [x + ARENA_HALF, y + ARENA_HALF];
}

interface DrawCall {
  readonly op: string;
  readonly args: readonly (number | string | boolean | undefined)[];
}

class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

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

  #record(op: string, ...args: (number | string | boolean | undefined)[]): void {
    this.calls.push({ op, args });
  }

  of(op: string): DrawCall[] {
    return this.calls.filter((call) => call.op === op);
  }
}

function draw(game: DungBattleGame, alpha = 0): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  return renderer;
}

describe('the manifest', () => {
  it('describes the game the code implements', () => {
    expect(manifest.id).toBe('dung-battle');
    expect(manifest.archetype).toBe('rt-arena');
    expect(manifest.category).toBe('Arena');
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.modes).toEqual(['friend', 'bot']);
    expect(manifest.presentations).toEqual(['shared-screen', 'single-seat']);
  });

  it('declares the box the simulation actually uses', () => {
    expect(manifest.logical.width).toBe(ARENA_HALF * 2);
    expect(manifest.logical.height).toBe(ARENA_HALF * 2);
    expect(BOARD).toBe(ARENA_HALF * 2);
  });

  it('advertises the clock the match really ends on', () => {
    expect(manifest.roundSeconds).toBe(MATCH_SECONDS);
  });

  it('promises both input families something', () => {
    expect(manifest.controls.keyboard.length).toBeGreaterThan(3);
    expect(manifest.controls.pointer.length).toBeGreaterThan(3);
    expect(manifest.controls.keyboard.length).toBeLessThanOrEqual(120);
    expect(manifest.controls.pointer.length).toBeLessThanOrEqual(120);
  });

  it('names both keyboard halves and says which seat each belongs to', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/W A S D/);
    expect(keyboard).toMatch(/arrow/i);
    expect(keyboard).toMatch(/near|far/i);
    // The guard in apps/web fails a manifest offering both halves as one player's choice.
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });

  it('is what the module exports', () => {
    expect(gameModule.manifest).toBe(manifest);
    expect(gameModule.create()).toBeInstanceOf(DungBattleGame);
  });
});

describe('the keyboard, driven through the real InputManager', () => {
  it('runs the near beetle on W A S D', () => {
    const { game, input, view } = started();
    const from = game.pit.p1.y;
    input.keyDown('KeyW');
    run(game, input, view, 10);
    expect(game.pit.p1.y).toBeLessThan(from);
    expect(game.pit.p1.y).toBeCloseTo(from - BEETLE_SPEED * STEP * 10, 6);
  });

  it('runs it the other way on S, and sideways on A and D', () => {
    const { game, input, view } = started();
    input.keyDown('KeyS');
    run(game, input, view, 5);
    expect(game.pit.p1.y).toBeGreaterThan(ARENA_HALF - BEETLE_RADIUS - 200);
    input.keyUp('KeyS');
    const across = game.pit.p1.x;
    input.keyDown('KeyD');
    run(game, input, view, 5);
    expect(game.pit.p1.x).toBeGreaterThan(across);
    input.keyUp('KeyD');
    input.keyDown('KeyA');
    run(game, input, view, 10);
    expect(game.pit.p1.x).toBeLessThan(across);
  });

  it('runs the far beetle on the arrow keys', () => {
    const { game, input, view } = started();
    const from = game.pit.p2.y;
    input.keyDown('ArrowDown');
    run(game, input, view, 10);
    expect(game.pit.p2.y).toBeGreaterThan(from);
  });

  it('never lets one seat’s keys move the other seat', () => {
    const { game, input, view } = started();
    const wasP1 = `${game.pit.p1.x},${game.pit.p1.y}`;
    input.keyDown('ArrowUp');
    input.keyDown('ArrowLeft');
    run(game, input, view, 20);
    expect(`${game.pit.p1.x},${game.pit.p1.y}`).toBe(wasP1);
    expect(game.pit.p2.y).toBeLessThan(-250 + 1);
  });

  it('runs both beetles at once, because there are no turns', () => {
    const { game, input, view } = started();
    input.keyDown('KeyA');
    input.keyDown('ArrowRight');
    run(game, input, view, 10);
    expect(game.pit.p1.x).toBeLessThan(0);
    expect(game.pit.p2.x).toBeGreaterThan(0);
  });

  it('promises no action key, and is not moved by one', () => {
    const { game, input, view } = started();
    const before = `${game.pit.p1.x},${game.pit.p1.y},${game.pit.p2.x},${game.pit.p2.y}`;
    input.keyDown('Space');
    input.keyDown('Enter');
    run(game, input, view, 30);
    expect(`${game.pit.p1.x},${game.pit.p1.y},${game.pit.p2.x},${game.pit.p2.y}`).toBe(before);
    expect(manifest.controls.keyboard).not.toMatch(/space|enter/i);
    expect(manifest.controls.pointer).not.toMatch(/tap|press/i);
  });

  it('does not let a diagonal outrun a straight run', () => {
    const straight = started(2);
    const diagonal = started(2);
    straight.input.keyDown('KeyD');
    diagonal.input.keyDown('KeyD');
    diagonal.input.keyDown('KeyW');
    run(straight.game, straight.input, straight.view, 20);
    run(diagonal.game, diagonal.input, diagonal.view, 20);
    const straightGone = Math.hypot(straight.game.pit.p1.x, straight.game.pit.p1.y - 250);
    const diagonalGone = Math.hypot(diagonal.game.pit.p1.x, diagonal.game.pit.p1.y - 250);
    expect(diagonalGone).toBeCloseTo(straightGone, 6);
  });

  it('stops the moment the key comes up', () => {
    const { game, input, view } = started();
    input.keyDown('KeyD');
    run(game, input, view, 10);
    input.keyUp('KeyD');
    const parked = game.pit.p1.x;
    expect(parked).toBeCloseTo(BEETLE_SPEED * STEP * 10, 6);
    run(game, input, view, 30);
    expect(game.pit.p1.x).toBe(parked);
  });
});

describe('the pointer, driven through the real InputManager', () => {
  it('runs a beetle towards the finger', () => {
    const { game, input, view } = started();
    const beetle = game.pit.p1;
    // Directly to the right of the near beetle, in the near seat's own half.
    const [x, y] = board(beetle.x + 150, beetle.y);
    input.pointerDown(1, x, y);
    run(game, input, view, 10);
    expect(game.pit.p1.x).toBeGreaterThan(0);
    // Not to the last decimal: every pointer position is quantised onto the engine's
    // shared precision lattice (one two-hundredth of the box, so 4 units here), which is
    // what stops a mouse aiming finer than a thumb.
    expect(Math.abs(game.pit.p1.y - 250)).toBeLessThan(BOARD / 200);
  });

  it('is the same instrument as the key: a finger to the right equals D', () => {
    const byKey = started(3);
    const byThumb = started(3);
    byKey.input.keyDown('KeyD');
    const [x, y] = board(byThumb.game.pit.p1.x + 200, byThumb.game.pit.p1.y);
    byThumb.input.pointerDown(1, x, y);
    run(byKey.game, byKey.input, byKey.view, 6);
    run(byThumb.game, byThumb.input, byThumb.view, 6);
    // Within the precision lattice, which is the only thing that separates them.
    expect(byThumb.game.pit.p1.x).toBeCloseTo(byKey.game.pit.p1.x, 1);
  });

  it('keeps its seat when the drag crosses the middle of the device', () => {
    const { game, input, view } = started();
    // Down in the near seat's half...
    input.pointerDown(1, ARENA_HALF, BOARD - 40);
    run(game, input, view, 2);
    const wasP2 = `${game.pit.p2.x},${game.pit.p2.y}`;
    // ...and dragged well into the far seat's half. The near beetle follows it there.
    input.pointerMove(1, ARENA_HALF, 40);
    run(game, input, view, 70);
    expect(game.pit.p1.y).toBeLessThan(0);
    expect(`${game.pit.p2.x},${game.pit.p2.y}`).toBe(wasP2);
  });

  it('gives the far seat its own half of the surface', () => {
    const { game, input, view } = started();
    const wasP1 = `${game.pit.p1.x},${game.pit.p1.y}`;
    input.pointerDown(2, ARENA_HALF + 100, 40);
    run(game, input, view, 10);
    expect(game.pit.p2.x).toBeGreaterThan(0);
    expect(`${game.pit.p1.x},${game.pit.p1.y}`).toBe(wasP1);
  });

  it('answers two fingers at once, one a seat', () => {
    const { game, input, view } = started();
    input.pointerDown(1, ARENA_HALF - 150, BOARD - 40);
    input.pointerDown(2, ARENA_HALF + 150, 40);
    run(game, input, view, 12);
    expect(game.pit.p1.x).toBeLessThan(0);
    expect(game.pit.p2.x).toBeGreaterThan(0);
  });

  it('rests when the finger is on the beetle itself', () => {
    const { game, input, view } = started();
    const [x, y] = board(game.pit.p1.x, game.pit.p1.y);
    input.pointerDown(1, x + POINTER_DEADZONE / 3, y);
    const parked = `${game.pit.p1.x},${game.pit.p1.y}`;
    run(game, input, view, 20);
    expect(`${game.pit.p1.x},${game.pit.p1.y}`).toBe(parked);
  });

  it('cannot outrun the beetle by flicking the finger across the pit', () => {
    const { game, input, view } = started();
    input.pointerDown(1, 10, BOARD - 10);
    run(game, input, view, 1);
    const afterOne = Math.hypot(game.pit.p1.x - 0, game.pit.p1.y - 250);
    expect(afterOne).toBeLessThanOrEqual(BEETLE_SPEED * STEP + 1e-9);
  });

  it('goes back to the keys the moment the finger lifts', () => {
    const { game, input, view } = started();
    input.pointerDown(1, ARENA_HALF - 200, BOARD - 40);
    run(game, input, view, 5);
    input.pointerUp(1);
    input.keyDown('KeyD');
    const from = game.pit.p1.x;
    run(game, input, view, 10);
    expect(game.pit.p1.x).toBeGreaterThan(from);
  });
});

describe('the Game contract', () => {
  it('reports no active seat, because a real-time game has no turns', () => {
    const game = new DungBattleGame();
    game.init(context());
    expect(game.getActiveSeat()).toBeNull();
  });

  it('starts level with no winner', () => {
    const game = new DungBattleGame();
    game.init(context());
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('plays the same match twice from the same seed', () => {
    const a = played(11, 'normal', 'normal', 900);
    const b = played(11, 'normal', 'normal', 900);
    expect(a).toBe(b);
  });

  it('plays a different match from a different seed', () => {
    expect(played(11, 'normal', 'normal', 900)).not.toBe(played(12, 'normal', 'normal', 900));
  });

  it('is fully reset by a second init', () => {
    const game = new DungBattleGame();
    game.init(context(5, 'hard', 'hard'));
    const { input, view } = surface();
    for (let i = 0; i < 1200; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    game.init(context(5, 'hard', 'hard'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.pit.clock).toBe(MATCH_SECONDS);
    expect(game.pit.ball.x).toBe(0);
  });

  it('stops simulating once it has a winner', () => {
    const { game, input, view } = started(13, 'hard', 'easy');
    let steps = 0;
    while (game.getScore().winner === null && steps < CEILING) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      steps += 1;
    }
    const frozen = JSON.stringify(game.pit);
    run(game, input, view, 120);
    expect(JSON.stringify(game.pit)).toBe(frozen);
  });

  it('survives destroy, and can be stood back up', () => {
    const game = new DungBattleGame();
    game.init(context(7, 'easy', 'easy'));
    const { input, view } = surface();
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    game.destroy();
    game.init(context(7, 'easy', 'easy'));
    for (let i = 0; i < 300; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.getScore().winner).toBeNull();
  });

  it('pauses and resumes without moving anything', () => {
    const { game, input, view } = started(8, 'normal', 'normal');
    run(game, input, view, 200);
    const before = JSON.stringify(game.pit);
    game.onPause();
    game.onResume();
    expect(JSON.stringify(game.pit)).toBe(before);
  });

  it('is drivable through the SDK’s own Game type', () => {
    // The alpha argument is part of the contract, and a concrete class that dropped it
    // would fail the repo-wide typecheck rather than this test — so it is passed here.
    const game: Game = new DungBattleGame();
    game.init(context());
    const { input, view } = surface();
    game.update(STEP, view.sync(input.beginStep(STEP)));
    game.render(new RecordingRenderer(), 0.5);
    expect(game.getScore().winner).toBeNull();
    game.destroy();
  });
});

/** A whole match reduced to a string, for the determinism comparisons. */
function played(
  seed: number,
  p1: BotDifficulty | null,
  p2: BotDifficulty | null,
  steps: number,
): string {
  const game = new DungBattleGame();
  game.init(context(seed, p1, p2));
  const { input, view } = surface();
  const marks: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    game.update(STEP, view.sync(input.beginStep(STEP)));
    if (i % 30 === 0) {
      const score = game.getScore();
      marks.push(
        `${game.pit.ball.x.toFixed(6)},${game.pit.ball.y.toFixed(6)},` +
          `${game.pit.p1.x.toFixed(6)},${game.pit.p2.y.toFixed(6)},${score.p1}:${score.p2}`,
      );
    }
  }
  return marks.join('|');
}

describe('the bots', () => {
  it('play differently on easy and on hard', () => {
    expect(played(21, 'hard', 'hard', 900)).not.toBe(played(21, 'easy', 'easy', 900));
  });

  it('play a different match from two absent players', () => {
    expect(played(21, 'normal', 'normal', 900)).not.toBe(played(21, null, null, 900));
  });

  it('drive only the seat they are given', () => {
    const game = new DungBattleGame();
    game.init(context(22, null, 'hard'));
    const { input, view } = surface();
    let p1Moved = false;
    let p2Moved = false;
    for (let i = 0; i < 300; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      // Sampled every step rather than at the end: a beetle is put back on its mark after
      // every delivery, so the last frame of a match says nothing about whether it played.
      if (game.pit.p1.x !== 0 || game.pit.p1.y !== 250) p1Moved = true;
      if (game.pit.p2.x !== 0 || game.pit.p2.y !== -250) p2Moved = true;
    }
    // Seat one is a human who never touched the screen.
    expect(p1Moved).toBe(false);
    expect(p2Moved).toBe(true);
  });

  it('deal the same pit whatever tiers are playing in it', () => {
    // The pit has its own stream. If the bugs came out of the same one the bots draw from,
    // the arrangement would depend on how many decisions each tier happened to make.
    const layout = (p1: BotDifficulty | null, p2: BotDifficulty | null): string => {
      const game = new DungBattleGame();
      game.init(context(23, p1, p2));
      return game.pit.bugs.map((bug) => `${bug.x},${bug.y},${bug.hx},${bug.hy}`).join('|');
    };
    expect(layout('easy', 'easy')).toBe(layout('hard', 'hard'));
    expect(layout('easy', 'easy')).toBe(layout(null, null));
    expect(layout('easy', 'easy')).not.toBe('');
  });

  it('take one stream each, so neither is watching the other’s draws', () => {
    // A bot on seat two plays the identical match whether or not seat one has a bot in it
    // would be false — they interact. What must hold is that seat two's *stream* is its
    // own: the pit is dealt from a third stream and neither bot consumes it.
    const alone = new DungBattleGame();
    alone.init(context(24, null, 'hard'));
    const together = new DungBattleGame();
    together.init(context(24, 'hard', 'hard'));
    expect(alone.pit.bugs[0]!.x).toBe(together.pit.bugs[0]!.x);
  });

  it('finish a match inside the clock, at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const game = new DungBattleGame();
      game.init(context(25, tier, tier));
      const { input, view } = surface();
      let steps = 0;
      while (game.getScore().winner === null && steps < CEILING + 60) {
        game.update(STEP, view.sync(input.beginStep(STEP)));
        steps += 1;
      }
      expect(game.getScore().winner).not.toBeNull();
      expect(steps).toBeLessThanOrEqual(CEILING);
    }
  });
});

describe('the ball reaches a base, watched from outside', () => {
  /**
   * The headline verb, through the whole `Game` contract and counted from the ball's own
   * position rather than from `getScore`. Both are recorded, and they must agree: a counter
   * that says a delivery happened where the ball never went is the failure this is for.
   */
  function watch(seed: number, tier: BotDifficulty): { seen: number; scored: number } {
    const game = new DungBattleGame();
    game.init(context(seed, tier, tier));
    const { input, view } = surface();
    let seen = 0;
    let inside: SeatId | null = null;
    let steps = 0;
    while (game.getScore().winner === null && steps < CEILING) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      steps += 1;
      const now = deliveryIn(game.pit.ball);
      if (now !== null && inside === null) seen += 1;
      inside = now;
    }
    const score = game.getScore();
    return { seen, scored: score.p1 + score.p2 };
  }

  it('happens, several times a match, at every tier', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      let total = 0;
      for (let seed = 1; seed <= 12; seed += 1) {
        const { seen, scored } = watch(seed * 977, tier);
        expect(seen).toBe(scored);
        total += seen;
      }
      expect(total / 12).toBeGreaterThan(2.5);
    }
  });

  it('is what decides most matches, rather than the clock', () => {
    let onTarget = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = new DungBattleGame();
      game.init(context(seed * 313, 'normal', 'normal'));
      const { input, view } = surface();
      let steps = 0;
      while (game.getScore().winner === null && steps < CEILING) {
        game.update(STEP, view.sync(input.beginStep(STEP)));
        steps += 1;
      }
      const score = game.getScore();
      if (score.p1 === TARGET_DELIVERIES || score.p2 === TARGET_DELIVERIES) onTarget += 1;
    }
    expect(onTarget).toBeGreaterThan(12);
  });
});

/**
 * Where a player should be steering to shove the ball home, in simulation coordinates.
 *
 * The same two jobs the bot does, written out here so that a test can play the game through
 * the published controls rather than through the bot.
 */
function wants(game: DungBattleGame, seat: SeatId): [number, number] {
  const beetle = seat === 'p1' ? game.pit.p1 : game.pit.p2;
  const baseY = seat === 'p1' ? ARENA_HALF : -ARENA_HALF;
  const ball = game.pit.ball;
  let outX = ball.x;
  let outY = ball.y - baseY;
  const outLength = Math.hypot(outX, outY) || 1;
  outX /= outLength;
  outY /= outLength;
  const sideX = beetle.x - ball.x;
  const sideY = beetle.y - ball.y;
  const sideLength = Math.hypot(sideX, sideY) || 1;
  const sx = sideX / sideLength;
  const sy = sideY / sideLength;
  if (sx * outX + sy * outY >= 0.6) {
    // Behind it: drive through the ball towards home.
    return [ball.x - outX * 45, ball.y - outY * 45];
  }
  // Not behind it: walk round the ball, aiming at a point on the circle a step nearer the
  // shoulder — straight at the shoulder would mean straight through the ball.
  const swing = Math.min(Math.acos(Math.max(-1, Math.min(1, sx * outX + sy * outY))), 0.9);
  const turn = sx * outY - sy * outX < 0 ? -swing : swing;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return [ball.x + (sx * cos - sy * sin) * 81, ball.y + (sx * sin + sy * cos) * 81];
}

describe('a person can do the thing the game is named after', () => {
  /**
   * Not a bot: this drives the published controls, through the real InputManager, and
   * requires a delivery out of them. The manifest promises a player can shove the ball into
   * their own base with these keys and with this finger, and a promise nobody has driven is
   * how four manifests came to be wrong in one night.
   */
  it('shoves the ball into its own base with the keys alone', () => {
    const { game, input, view } = started(51);
    const held = new Set<string>();
    const press = (code: string, want: boolean): void => {
      if (want && !held.has(code)) {
        input.keyDown(code);
        held.add(code);
      } else if (!want && held.has(code)) {
        input.keyUp(code);
        held.delete(code);
      }
    };
    for (let i = 0; i < 60 * 45 && game.getScore().p1 === 0; i += 1) {
      clearBugs(game);
      const [x, y] = wants(game, 'p1');
      const dx = x - game.pit.p1.x;
      const dy = y - game.pit.p1.y;
      press('KeyD', dx > 4);
      press('KeyA', dx < -4);
      press('KeyS', dy > 4);
      press('KeyW', dy < -4);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    expect(game.getScore().p1).toBe(1);
    expect(game.getScore().p2).toBe(0);
  });

  it('shoves it home with one finger, which never leaves its own half to start', () => {
    const { game, input, view } = started(52);
    // The one press that establishes ownership happens in the near seat's own half; from
    // there the finger goes wherever the beetle needs to be steered.
    input.pointerDown(1, ARENA_HALF, BOARD - 30);
    for (let i = 0; i < 60 * 45 && game.getScore().p1 === 0; i += 1) {
      clearBugs(game);
      const [x, y] = wants(game, 'p1');
      const [bx, by] = board(x, y);
      input.pointerMove(1, bx, by);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    expect(game.getScore().p1).toBe(1);
  });

  it('cannot do it by holding still, whatever else is pressed', () => {
    const { game, input, view } = started(53);
    input.keyDown('Space');
    input.keyDown('Enter');
    for (let i = 0; i < 60 * 20; i += 1) {
      clearBugs(game);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });
});

describe('the picture', () => {
  it('draws every seat’s mark inside the box it declared', () => {
    const { game, input, view } = started(31, 'normal', 'normal');
    run(game, input, view, 240);
    const renderer = draw(game);
    expect(renderer.calls.length).toBeGreaterThan(20);
    for (const call of renderer.calls) {
      for (const arg of call.args) {
        if (typeof arg !== 'number') continue;
        // Generous, as the base discs sit on the wall and hang over it by design.
        expect(Math.abs(arg)).toBeLessThanOrEqual(BOARD * 1.5);
      }
    }
  });

  it('says nothing in words, so it needs no translating', () => {
    const { game } = started(32, 'easy', 'easy');
    expect(draw(game).of('text')).toHaveLength(0);
  });

  it('never rotates: an arena reads the same way up from either end', () => {
    const { game } = started(33);
    const renderer = draw(game);
    expect(renderer.of('pushSeatRotation')).toHaveLength(0);
    expect(renderer.of('pushRotation')).toHaveLength(0);
  });

  it('draws each base rim at exactly the radius the rule tests', () => {
    const { game } = started(34);
    const rims = draw(game)
      .of('strokeCircle')
      .filter((call) => call.args[2] === BASE_RADIUS);
    expect(rims).toHaveLength(2);
    const centres = rims.map((call) => `${String(call.args[0])},${String(call.args[1])}`).sort();
    expect(centres).toEqual([`${ARENA_HALF},0`, `${ARENA_HALF},${BOARD}`]);
  });

  it('draws a danger ring round every ladybug, at the distance that flips a beetle', () => {
    const { game } = started(35);
    const rings = draw(game)
      .of('strokeCircle')
      .filter((call) => call.args[2] === BEETLE_BUG_TOUCH);
    expect(rings).toHaveLength(LADYBUG_COUNT);
  });

  it('draws the rings after every bug, so no bug can hide another’s', () => {
    const { game } = started(36);
    const calls = draw(game).calls;
    const lastBody = calls.reduce(
      (last, call, index) => (call.op === 'circle' && call.args[3] === '#d24a3d' ? index : last),
      -1,
    );
    const firstRing = calls.findIndex(
      (call) => call.op === 'strokeCircle' && call.args[2] === BEETLE_BUG_TOUCH,
    );
    expect(lastBody).toBeGreaterThan(-1);
    expect(firstRing).toBeGreaterThan(lastBody);
  });

  it('tells the two beetles apart by a count of stripes, not by colour', () => {
    const { game } = started(37);
    const renderer = draw(game);
    for (const seat of ['p1', 'p2'] as const) {
      const beetle = seat === 'p1' ? game.pit.p1 : game.pit.p2;
      const [cx, cy] = board(beetle.x, beetle.y);
      const stripes = renderer
        .of('line')
        .filter((call) => call.args[5] === SEAT_PALETTE[seat].deep)
        .filter(
          (call) =>
            Math.hypot(Number(call.args[0]) - cx, Number(call.args[1]) - cy) < BEETLE_RADIUS + 2,
        );
      expect(stripes, `${seat} stripes`).toHaveLength(seat === 'p1' ? 1 : 2);
    }
  });

  it('marks each base with its seat’s own shape as well as its colour', () => {
    const { game } = started(38);
    const renderer = draw(game);
    // p1's mark is a disc at the middle of its base; p2's is a square.
    const discs = renderer
      .of('circle')
      .filter((call) => call.args[3] === SEAT_PALETTE.p1.base && call.args[2] === 16);
    const squares = renderer
      .of('rect')
      .filter((call) => call.args[4] === SEAT_PALETTE.p2.base && call.args[2] === 30);
    expect(discs).toHaveLength(1);
    expect(squares).toHaveLength(1);
  });

  it('shows a pip for every delivery still to be made', () => {
    const { game } = started(39);
    const renderer = draw(game);
    const pips = renderer
      .of('circle')
      .filter((call) => call.args[2] === 15)
      .concat(renderer.of('rect').filter((call) => call.args[2] === 28));
    expect(pips).toHaveLength(TARGET_DELIVERIES * 2);
  });

  it('draws a beetle on its back as a different shape, not a different shade', () => {
    const { game } = started(40);
    const belly = (): number =>
      draw(game)
        .of('circle')
        .filter((call) => call.args[2] === BEETLE_RADIUS && call.args[3] === '#e8dcc6').length;
    const legs = (): number =>
      draw(game)
        .of('line')
        .filter((call) => call.args[5] === '#191009').length;
    expect(belly()).toBe(0);
    const shortLegs = legs();
    game.pit.p1.stun = 30;
    expect(belly()).toBe(1);
    // The legs stick further out, so the silhouette changes too.
    const flippedRenderer = draw(game);
    const longest = flippedRenderer
      .of('line')
      .filter((call) => call.args[5] === '#191009')
      .map((call) =>
        Math.hypot(
          Number(call.args[2]) - Number(call.args[0]),
          Number(call.args[3]) - Number(call.args[1]),
        ),
      );
    expect(legs()).toBe(shortLegs);
    expect(shortLegs).toBe(12);
    expect(Math.max(...longest)).toBeGreaterThan(20);
  });

  it('interpolates between steps rather than jumping', () => {
    const { game, input, view } = started(41);
    input.keyDown('KeyD');
    run(game, input, view, 20);
    const beetleAt = (alpha: number): number => {
      const call = draw(game, alpha)
        .of('circle')
        .find((one) => one.args[2] === BEETLE_RADIUS && one.args[3] === SEAT_PALETTE.p1.base);
      return Number(call?.args[0]);
    };
    game.update(STEP, view.sync(input.beginStep(STEP)));
    const back = beetleAt(0);
    const front = beetleAt(1);
    expect(front).toBeGreaterThan(back);
    expect(beetleAt(0.5)).toBeCloseTo((back + front) / 2, 9);
    expect(front - back).toBeCloseTo(BEETLE_SPEED * STEP, 6);
  });

  it('does not move the match on', () => {
    const { game, input, view } = started(42, 'hard', 'hard');
    run(game, input, view, 120);
    const before = JSON.stringify(game.pit);
    for (let i = 0; i < 10; i += 1) draw(game, i / 10);
    expect(JSON.stringify(game.pit)).toBe(before);
  });

  it('can be drawn before the first update', () => {
    const game = new DungBattleGame();
    game.init(context(43));
    expect(() => draw(game)).not.toThrow();
    expect(draw(game).calls.length).toBeGreaterThan(10);
  });

  it('can be drawn without an init at all', () => {
    // The shell renders a loaded game before the match starts; a game that threw here
    // would take the page down before anybody pressed anything.
    const game = new DungBattleGame();
    expect(() => draw(game)).not.toThrow();
  });
});
