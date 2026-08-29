import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { TennisGame } from './game.js';
import {
  COURT_HEIGHT,
  COURT_WIDTH,
  JUMP_APEX,
  JUMP_SPEED,
  LAND_RECOVERY,
  MATCH_SECONDS,
  NET_Y,
  PLAYER_SPEED,
  RACKET_HEIGHT,
  TARGET_POINTS,
  halfOf,
  readyY,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

/* --------------------------------------------------------- a hand-written input state */

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

  steer(seat: SeatId, x: number, y: number): void {
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

  lift(seat: SeatId): void {
    this.#of(seat).pointer = null;
  }

  press(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = true;
    target.actionHeld = true;
  }

  hold(seat: SeatId): void {
    const target = this.#of(seat);
    target.actionPressed = false;
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

/** The real engine input path, wired exactly as the host wires it for an `rt-split` game. */
function realInput(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(
      { width: manifest.logical.width, height: manifest.logical.height },
      { split: 'horizontal', bottomSeat: 'p1' },
    ),
    view: new InputView(),
  };
}

type DrawArg = number | string | boolean | undefined;

/** Every draw call, in order, with its arguments flattened alongside. */
class RecordingRenderer implements Renderer {
  readonly ops: string[] = [];
  readonly args: DrawArg[] = [];
  readonly calls: { op: string; values: DrawArg[] }[] = [];

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
    this.calls.push({ op, values });
  }
}

function drawnOnce(game: TennisGame, alpha = 0): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, alpha);
  return renderer;
}

/* --------------------------------------------------------------------------- controls */

describe('the controls', () => {
  it('runs a player with the movement keys', () => {
    const game = new TennisGame();
    game.init(makeContext(1));
    const startX = game.match.p1.x;
    const startY = game.match.p1.y;
    const input = new ScriptedInput();
    input.steer('p1', 1, 0);
    game.update(STEP, input);
    expect(game.match.p1.x).toBeGreaterThan(startX);
    input.steer('p1', 0, 1);
    game.update(STEP, input);
    expect(game.match.p1.y).toBeGreaterThan(startY);
  });

  it('gives each seat its own half of the keyboard, through the real InputManager', () => {
    // The manifest promises "W A S D runs the near player ... arrow keys ... for the far one".
    // Driven, not read: every clause below goes through the engine that the host uses.
    const game = new TennisGame();
    game.init(makeContext(2));
    const { manager, view } = realInput();
    const p1Start = game.match.p1.x;
    const p2Start = game.match.p2.x;

    manager.keyDown('KeyD');
    manager.keyDown('ArrowLeft');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.x).toBeGreaterThan(p1Start);
    expect(game.match.p2.x).toBeLessThan(p2Start);
  });

  it('never lets one seat keys move the other player', () => {
    const game = new TennisGame();
    game.init(makeContext(3));
    const { manager, view } = realInput();
    const p2X = game.match.p2.x;
    const p2Y = game.match.p2.y;
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']) manager.keyDown(code);
    for (let i = 0; i < 20; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p2.x).toBe(p2X);
    expect(game.match.p2.y).toBe(p2Y);
    expect(game.match.p2.z).toBe(0);
  });

  it('jumps on Space for the near seat and Enter for the far one', () => {
    const game = new TennisGame();
    game.init(makeContext(4));
    const { manager, view } = realInput();
    manager.keyDown('Space');
    manager.keyDown('Enter');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.z).toBeGreaterThan(0);
    expect(game.match.p2.z).toBeGreaterThan(0);
  });

  it('gives one jump for a held key, not one a frame', () => {
    const game = new TennisGame();
    game.init(makeContext(5));
    const { manager, view } = realInput();
    manager.keyDown('Space');
    let peak = 0;
    let landings = 0;
    let wasUp = false;
    for (let i = 0; i < 200; i += 1) {
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const z = game.match.p1.z;
      if (z > peak) peak = z;
      if (wasUp && z === 0) landings += 1;
      wasUp = z > 0;
    }
    expect(peak).toBeLessThanOrEqual(JUMP_APEX + 1e-9);
    expect(landings).toBe(1);
  });

  it('jumps again on a fresh press after the key comes back up', () => {
    const game = new TennisGame();
    game.init(makeContext(6));
    const { manager, view } = realInput();
    manager.keyDown('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    for (let i = 0; i < 90; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.z).toBe(0);
    manager.keyUp('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.keyDown('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.z).toBeGreaterThan(0);
  });

  it('runs toward a finger in your own half, and jumps on the press', () => {
    // The manifest promises "Touch your own half to run there, and every fresh press is a jump
    // for a high ball". Both halves of that sentence, through the engine.
    const game = new TennisGame();
    game.init(makeContext(7));
    const { manager, view } = realInput();
    const startX = game.match.p1.x;
    manager.pointerDown(1, startX + 200, 900);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.x).toBeGreaterThan(startX);
    expect(game.match.p1.z).toBeGreaterThan(0);
  });

  it('gives the top half of the screen to the far seat', () => {
    const game = new TennisGame();
    game.init(makeContext(8));
    const { manager, view } = realInput();
    const p1X = game.match.p1.x;
    const p2X = game.match.p2.x;
    manager.pointerDown(2, 100, 120);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p2.x).toBeLessThan(p2X);
    expect(game.match.p1.x).toBe(p1X);
  });

  it('keeps a drag with the seat it started in, across the midline', () => {
    // The engine owns this rule — `PointerOwnership` — and the game must not reimplement it.
    const game = new TennisGame();
    game.init(makeContext(9));
    const { manager, view } = realInput();
    const p2Start = game.match.p2.x;
    manager.pointerDown(3, 500, 900);
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.pointerMove(3, 100, 100);
    for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    // The finger is now deep in p2's half, and it is still driving p1.
    expect(game.match.p2.x).toBe(p2Start);
    expect(game.match.p1.x).toBeLessThan(500);
  });

  it('will not let a finger drag a player across the net', () => {
    const game = new TennisGame();
    game.init(makeContext(10));
    const { manager, view } = realInput();
    manager.pointerDown(4, 300, 990);
    manager.pointerMove(4, 300, 10);
    for (let i = 0; i < 240; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.match.p1.y).toBeGreaterThanOrEqual(halfOf('p1').minY);
  });

  it('answers a finger and a key at the same speed', () => {
    const byKey = new TennisGame();
    byKey.init(makeContext(11));
    const keyed = realInput();
    keyed.manager.keyDown('KeyD');

    const byThumb = new TennisGame();
    byThumb.init(makeContext(11));
    const pointed = realInput();
    pointed.manager.pointerDown(5, COURT_WIDTH - 10, 900);

    for (let i = 0; i < 20; i += 1) {
      byKey.update(STEP, keyed.view.sync(keyed.manager.beginStep(STEP)));
      byThumb.update(STEP, pointed.view.sync(pointed.manager.beginStep(STEP)));
    }
    expect(byThumb.match.p1.x).toBeCloseTo(byKey.match.p1.x, 6);
  });

  it('stands still for a finger already on the player', () => {
    const game = new TennisGame();
    game.init(makeContext(12));
    const input = new ScriptedInput();
    input.point('p1', game.match.p1.x, game.match.p1.y);
    game.update(STEP, input);
    expect(game.match.p1.vx).toBe(0);
    expect(game.match.p1.vy).toBe(0);
  });

  it('stops when the finger lifts and no key is down', () => {
    const game = new TennisGame();
    game.init(makeContext(13));
    const input = new ScriptedInput();
    input.point('p1', 100, 900);
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    const x = game.match.p1.x;
    input.lift('p1');
    for (let i = 0; i < 10; i += 1) game.update(STEP, input);
    expect(game.match.p1.x).toBe(x);
  });

  it('never moves anybody faster than the declared speed', () => {
    const game = new TennisGame();
    game.init(makeContext(14));
    const input = new ScriptedInput();
    input.steer('p1', 1, 1);
    input.point('p1', 0, 0);
    for (let i = 0; i < 60; i += 1) {
      const before = { x: game.match.p1.x, y: game.match.p1.y };
      game.update(STEP, input);
      const moved = Math.hypot(game.match.p1.x - before.x, game.match.p1.y - before.y);
      expect(moved).toBeLessThanOrEqual(PLAYER_SPEED * STEP + 1e-9);
    }
  });
});

describe('pause and resume', () => {
  it('forgets the motion a player had when it stopped', () => {
    const game = new TennisGame();
    game.init(makeContext(15));
    const input = new ScriptedInput();
    input.steer('p1', 1, 0);
    game.update(STEP, input);
    expect(game.match.p1.vx).not.toBe(0);
    game.onPause();
    expect(game.match.p1.vx).toBe(0);
    game.onResume();
    expect(game.match.p1.vx).toBe(0);
    expect(game.match.p2.vx).toBe(0);
  });

  it('does not smear the ball across the court on the frame it comes back', () => {
    const game = new TennisGame();
    game.init(makeContext(16));
    const input = new ScriptedInput();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    game.onPause();
    game.onResume();
    const first = drawnOnce(game, 0);
    const last = drawnOnce(game, 0.999);
    expect(first.args).toEqual(last.args);
  });
});

describe('the match', () => {
  it('starts level with no winner', () => {
    const game = new TennisGame();
    game.init(makeContext(17));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('plays a whole bot match to a result', () => {
    const game = new TennisGame();
    game.init(makeContext(18, 'normal', 'hard'));
    const input = new ScriptedInput();
    let steps = 0;
    for (; steps < 60 * 200; steps += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(TARGET_POINTS);
    expect(steps).toBeLessThan(60 * 200);
  });

  it('scores even when neither seat touches a control', () => {
    // The serve is on a timer, not a trigger. A game that needs a press to progress does not
    // progress when nobody presses — which is exactly how the termination guard drives it.
    const game = new TennisGame();
    game.init(makeContext(19, 'easy', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('finishes even with two humans who never touch anything', () => {
    // Not the same claim as the bot test above: here nothing is driving either seat at all.
    // The serve is on a timer, so the match plays itself out — 300 seeded runs of this all
    // decided, the worst in 23.9 s, and the seat that served first took 65% of them, which is
    // a serve advantage rather than a seat one: p1 took exactly 50%.
    for (let seed = 0; seed < 6; seed += 1) {
      const game = new TennisGame();
      game.init(makeContext(500 + seed));
      const input = new ScriptedInput();
      let steps = 0;
      for (; steps < 60 * 200 && game.getScore().winner === null; steps += 1) {
        game.update(STEP, input);
      }
      expect(game.getScore().winner, `seed ${String(seed)}`).not.toBeNull();
      expect(game.match.elapsed).toBeLessThan(60);
    }
  });

  it('stops simulating once it is decided', () => {
    const game = new TennisGame();
    game.init(makeContext(20, 'hard', 'easy'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    const settled = drawnOnce(game).args;
    for (let i = 0; i < 60; i += 1) game.update(STEP, input);
    expect(drawnOnce(game).args).toEqual(settled);
  });

  it('is called on the clock even if nobody reaches four', () => {
    const game = new TennisGame();
    game.init(makeContext(21, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * (MATCH_SECONDS + 5) && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.getScore().winner).not.toBeNull();
    expect(game.match.elapsed).toBeLessThanOrEqual(MATCH_SECONDS + 1);
  });

  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const game = new TennisGame();
      game.init(makeContext(4242, 'hard', 'normal'));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 30; i += 1) {
        input.steer('p1', i % 40 < 20 ? 1 : -1, 0);
        if (i % 37 === 0) input.press('p1');
        else input.release('p1');
        game.update(STEP, input);
        if (i % 30 === 0) out.push(drawnOnce(game).args.join(','));
      }
      return out.join('#');
    };
    expect(trace()).toBe(trace());
  });

  it('starts fresh on init', () => {
    const game = new TennisGame();
    game.init(makeContext(22, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 30; i += 1) game.update(STEP, input);
    game.init(makeContext(22, 'hard', 'hard'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.elapsed).toBe(0);
    expect(game.match.p1.z).toBe(0);
  });

  it('clears on destroy', () => {
    const game = new TennisGame();
    game.init(makeContext(23, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 40; i += 1) game.update(STEP, input);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.elapsed).toBe(0);
  });

  it('keeps the ball on the court, always', () => {
    const game = new TennisGame();
    game.init(makeContext(24, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 120 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
      expect(game.match.ball.z).toBeGreaterThanOrEqual(0);
      expect(Math.abs(game.match.ball.x - COURT_WIDTH / 2)).toBeLessThan(COURT_WIDTH);
      expect(Math.abs(game.match.ball.y - COURT_HEIGHT / 2)).toBeLessThan(COURT_HEIGHT);
    }
  });

  it('hands back the same score object rather than a fresh one each step', () => {
    const game = new TennisGame();
    game.init(makeContext(25));
    const first = game.getScore();
    game.update(STEP, new ScriptedInput());
    expect(game.getScore()).toBe(first);
  });

  it('has no turn to report, being real-time', () => {
    const game = new TennisGame();
    game.init(makeContext(26));
    expect(typeof (game as Game).getActiveSeat).toBe('undefined');
  });
});

describe('the bot', () => {
  it('never moves the human player', () => {
    const game = new TennisGame();
    game.init(makeContext(27, null, 'hard'));
    const input = new ScriptedInput();
    const x = game.match.p1.x;
    const y = game.match.p1.y;
    let moved = false;
    for (let i = 0; i < 60 * 8; i += 1) {
      game.update(STEP, input);
      if (game.match.phase === 'serving' || game.match.phase === 'point') continue;
      if (game.match.p1.x !== x || game.match.p1.y !== y) moved = true;
    }
    expect(moved).toBe(false);
    expect(game.match.p1.z).toBe(0);
  });

  it('moves its own player, and gets it off the ground', () => {
    const game = new TennisGame();
    game.init(makeContext(28, null, 'hard'));
    const input = new ScriptedInput();
    let moved = false;
    let leapt = false;
    for (let i = 0; i < 60 * 60 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
      if (game.match.p2.vx !== 0 || game.match.p2.vy !== 0) moved = true;
      if (game.match.p2.z > 0) leapt = true;
    }
    expect(moved).toBe(true);
    expect(leapt).toBe(true);
  });

  it('plays a different match on easy than on hard from the same seed', () => {
    const trace = (tier: BotDifficulty): string => {
      const game = new TennisGame();
      game.init(makeContext(29, tier, tier));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        if (i % 15 === 0) out.push(drawnOnce(game).args.join(','));
      }
      return out.join('#');
    };
    expect(trace('easy')).not.toBe(trace('hard'));
  });

  it('plays a different match with a bot than with nobody', () => {
    const trace = (tier: BotDifficulty | null): string => {
      const game = new TennisGame();
      game.init(makeContext(30, tier, tier));
      const input = new ScriptedInput();
      const out: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        game.update(STEP, input);
        if (i % 15 === 0) out.push(drawnOnce(game).args.join(','));
      }
      return out.join('#');
    };
    expect(trace('normal')).not.toBe(trace(null));
  });

  it('beats a seat nobody is playing', () => {
    let wins = 0;
    for (let seed = 0; seed < 8; seed += 1) {
      const game = new TennisGame();
      game.init(makeContext(400 + seed, null, 'hard'));
      const input = new ScriptedInput();
      for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
        game.update(STEP, input);
      }
      if (game.getScore().winner === 'p2') wins += 1;
    }
    expect(wins).toBe(8);
  });
});

describe('rendering', () => {
  it('draws the court, the net, both players, their rackets and the ball', () => {
    const game = new TennisGame();
    game.init(makeContext(31));
    const drawn = drawnOnce(game);
    expect(drawn.ops[0]).toBe('clear');
    expect(drawn.ops.filter((op) => op === 'circle').length).toBeGreaterThan(2);
    expect(drawn.ops.filter((op) => op === 'strokeCircle').length).toBeGreaterThan(3);
    expect(drawn.ops.filter((op) => op === 'line').length).toBeGreaterThan(6);
  });

  it('never rotates: a court split across the middle reads the same for both', () => {
    const game = new TennisGame();
    game.init(makeContext(32));
    const drawn = drawnOnce(game);
    expect(drawn.ops).not.toContain('pushSeatRotation');
    expect(drawn.ops).not.toContain('pushRotation');
    expect(drawn.ops).not.toContain('popSeatRotation');
  });

  it('tells the two players apart by shape as well as colour', () => {
    // Rule 7. p1 is a disc with a ring; p2 is a square with two. In greyscale the silhouette
    // and the ring count still separate them, and in a fast game the silhouette is what a
    // player actually tracks.
    const game = new TennisGame();
    game.init(makeContext(33));
    const drawn = drawnOnce(game);
    const p1Fill = drawn.calls.filter(
      (call) => call.op === 'circle' && call.values.includes(SEAT_PALETTE.p1.base),
    );
    const p2Fill = drawn.calls.filter(
      (call) => call.op === 'rect' && call.values.includes(SEAT_PALETTE.p2.base),
    );
    expect(p1Fill.length).toBe(1);
    expect(p2Fill.length).toBe(1);
    expect(drawn.calls.filter((call) => call.op === 'strokeRect').length).toBeGreaterThanOrEqual(3);
  });

  it('gives each half the same markings, so neither seat reads a different court', () => {
    const game = new TennisGame();
    game.init(makeContext(34));
    const drawn = drawnOnce(game);
    // Court markings only: lines that run the full width of the court between the margins.
    const horizontals = drawn.calls
      .filter(
        (call) =>
          call.op === 'line' &&
          call.values[0] === 24 &&
          call.values[2] === COURT_WIDTH - 24 &&
          call.values[1] === call.values[3],
      )
      .map((call) => call.values[1] as number);
    const markings = horizontals.filter((y) => Math.abs(y - NET_Y) > 20);
    for (const y of markings) expect(markings).toContain(COURT_HEIGHT - y);
    expect(markings.length).toBe(4);
  });

  it('draws the ball bigger the higher it is, with its shadow sliding out', () => {
    const low = new TennisGame();
    low.init(makeContext(35));
    low.match.ball.z = 0;
    // alpha of one: draw the state as it is now rather than the one the last step left.
    const lowDrawn = drawnOnce(low, 1);

    const high = new TennisGame();
    high.init(makeContext(35));
    high.match.ball.z = 180;
    const highDrawn = drawnOnce(high, 1);

    const ballOf = (drawn: RecordingRenderer): { radius: number; shadowX: number } => {
      const circles = drawn.calls.filter((call) => call.op === 'circle');
      const last = circles[circles.length - 1]!;
      const shadow = circles[circles.length - 2]!;
      return { radius: last.values[2] as number, shadowX: shadow.values[0] as number };
    };
    expect(ballOf(highDrawn).radius).toBeGreaterThan(ballOf(lowDrawn).radius);
    expect(ballOf(highDrawn).shadowX).toBeGreaterThan(ballOf(lowDrawn).shadowX);
  });

  it('throws every shadow along the shared axis, so neither seat reads height better', () => {
    // Rule 9. Slanting a shadow along y would put it nearer one seat and hand that player a
    // fractionally better read on the height.
    const game = new TennisGame();
    game.init(makeContext(36));
    game.match.ball.z = 150;
    game.match.p1.z = 60;
    const drawn = drawnOnce(game, 1);
    const circles = drawn.calls.filter((call) => call.op === 'circle');
    const ball = circles[circles.length - 1]!;
    const ballShadow = circles[circles.length - 2]!;
    expect(ballShadow.values[1]).toBe(ball.values[1]);
    expect(ballShadow.values[0]).not.toBe(ball.values[0]);
  });

  it('shows a jump by lifting the strings off the player', () => {
    // The button in the observed rule has to be legible from directly above, or a player
    // cannot tell whether they are about to meet the ball in the middle of the racket.
    const grounded = new TennisGame();
    grounded.init(makeContext(37));
    const groundedRings = drawnOnce(grounded, 1)
      .calls.filter((call) => call.op === 'strokeCircle')
      .map((call) => call.values[0] as number);

    const airborne = new TennisGame();
    airborne.init(makeContext(37));
    airborne.match.p1.z = JUMP_APEX;
    const airborneRings = drawnOnce(airborne, 1)
      .calls.filter((call) => call.op === 'strokeCircle')
      .map((call) => call.values[0] as number);

    expect(Math.max(...airborneRings)).toBeGreaterThan(Math.max(...groundedRings));
    expect(RACKET_HEIGHT).toBeGreaterThan(0);
  });

  it('interpolates between steps rather than jumping', () => {
    const game = new TennisGame();
    game.init(makeContext(38, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    const early = drawnOnce(game, 0).args.join(',');
    const late = drawnOnce(game, 0.9).args.join(',');
    expect(early).not.toBe(late);
  });

  it('draws nothing far outside the logical play area', () => {
    const game = new TennisGame();
    game.init(makeContext(39, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 40 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
      if (i % 20 !== 0) continue;
      for (const value of drawnOnce(game).args) {
        if (typeof value !== 'number') continue;
        expect(Math.abs(value)).toBeLessThanOrEqual(COURT_HEIGHT * 1.5);
      }
    }
  });

  it('does not mutate the simulation', () => {
    const game = new TennisGame();
    game.init(makeContext(40, 'hard', 'hard'));
    const input = new ScriptedInput();
    for (let i = 0; i < 120; i += 1) game.update(STEP, input);
    const before = JSON.stringify(game.match);
    drawnOnce(game, 0.5);
    drawnOnce(game, 0.1);
    expect(JSON.stringify(game.match)).toBe(before);
  });
});

describe('the manifest', () => {
  it('declares what it is', () => {
    expect(manifest.id).toBe('tennis');
    expect(manifest.archetype).toBe('rt-split');
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
  });

  it('declares the logical box the simulation actually runs in', () => {
    expect(manifest.logical.width).toBe(COURT_WIDTH);
    expect(manifest.logical.height).toBe(COURT_HEIGHT);
  });

  it('tells the truth about the keyboard', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/W A S D/);
    expect(keyboard).toMatch(/arrow/i);
    expect(keyboard).toMatch(/space/i);
    expect(keyboard).toMatch(/enter/i);
    expect(keyboard).toMatch(/jump/i);
    // It names which half belongs to which player, which `controls.test.ts` also insists on.
    expect(keyboard).toMatch(/near/i);
    expect(keyboard).toMatch(/far/i);
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
  });

  it('tells the truth about the pointer', () => {
    const { pointer } = manifest.controls;
    expect(pointer).toMatch(/own half/i);
    expect(pointer).toMatch(/run/i);
    expect(pointer).toMatch(/press/i);
    expect(pointer).toMatch(/jump/i);
    // And it promises nothing else: there is no swing, no aim, no charge.
    expect(pointer).not.toMatch(/swipe|flick|drag to aim|hold/i);
  });

  it('is fair across input families', () => {
    expect(manifest.sameInputClassOnly).toBe(false);
  });

  it('advertises a round length the match can actually reach', () => {
    const game = new TennisGame();
    game.init(makeContext(41, 'normal', 'normal'));
    const input = new ScriptedInput();
    for (let i = 0; i < 60 * 200 && game.getScore().winner === null; i += 1) {
      game.update(STEP, input);
    }
    expect(game.match.elapsed).toBeLessThan(manifest.roundSeconds * 1.5);
    expect(manifest.roundSeconds).toBeLessThan(MATCH_SECONDS);
  });
});

describe('the whole game through the engine input path', () => {
  it('survives a storm of presses, drags and lifts without leaving the court', () => {
    const game = new TennisGame();
    game.init(makeContext(42, null, 'normal'));
    const { manager, view } = realInput();
    const rng = new Rng(99);
    for (let i = 0; i < 60 * 90 && game.getScore().winner === null; i += 1) {
      if (i % 7 === 0)
        manager.pointerDown(i % 4, rng.float() * COURT_WIDTH, rng.float() * COURT_HEIGHT);
      if (i % 11 === 0) manager.pointerUp(i % 4);
      if (i % 5 === 0) manager.keyDown('Space');
      if (i % 9 === 0) manager.keyUp('Space');
      if (i % 13 === 0) manager.keyDown('KeyA');
      if (i % 17 === 0) manager.keyUp('KeyA');
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      expect(game.match.p1.y).toBeGreaterThanOrEqual(halfOf('p1').minY);
      expect(game.match.p1.y).toBeLessThanOrEqual(halfOf('p1').maxY);
      expect(game.match.p1.z).toBeGreaterThanOrEqual(0);
      expect(game.match.p1.z).toBeLessThanOrEqual(JUMP_APEX + 1e-9);
      expect(game.match.p1.recovery).toBeLessThanOrEqual(LAND_RECOVERY + 1e-9);
    }
    expect(JUMP_SPEED).toBeGreaterThan(0);
    expect(readyY('p1')).toBeGreaterThan(NET_Y);
  });
});
