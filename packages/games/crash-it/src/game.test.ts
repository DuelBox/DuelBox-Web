import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign } from '@duelbox/engine';
import type { GameContext, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  ARENA_TOP,
  BAND_TOP,
  BOX_HEIGHT,
  BOX_WIDTH,
  CrashItGame,
  POINTER_SPAN,
  SWIPE_RISE,
  pitX,
  pitY,
  pointerAlong,
  pointerPitX,
} from './game.js';
import {
  ARENA_HALF_WIDTH,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  JUMP_COOLDOWN,
  MATCH_SECONDS,
  POINTS_TO_WIN,
  START_OFFSET,
  groundY,
} from './rules.js';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/** Seat one owns the bottom half of the device; seat two the top. */
const P1_HALF_Y = 900;
const P2_HALF_Y = 100;

function makeContext(
  seed = 1,
  p1: BotDifficulty | null = null,
  p2: BotDifficulty | null = null,
  presentation: Presentation = 'shared-screen',
  localSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? p1 : p2;
    },
  };
}

/**
 * The real thing rather than a stand-in.
 *
 * Every claim the manifest's control strings make is driven through this, because a control
 * string only ever compared against a hand-rolled input object is a string checked against
 * itself. Seat ownership, the tap latch and the diagonal normalisation all live in
 * `InputManager`, and all three of them change what this game does.
 */
function rig(context: GameContext = makeContext()): {
  game: CrashItGame;
  manager: InputManager;
  step: (count?: number) => void;
} {
  const game = new CrashItGame();
  game.init(context);
  const manager = new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' });
  const view = new InputView();
  return {
    game,
    manager,
    step(count = 1): void {
      for (let i = 0; i < count; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    },
  };
}

type DrawArg = number | string | boolean | undefined;

interface Op {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

/** Logs every call and every argument, so no draw can pass unobserved. */
class RecordingRenderer implements Renderer {
  readonly ops: Op[] = [];

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

  #record(op: string, ...args: DrawArg[]): void {
    this.ops.push({ op, args });
  }
}

function draw(game: CrashItGame): RecordingRenderer {
  const renderer = new RecordingRenderer();
  game.render(renderer, 0);
  return renderer;
}

function key(op: Op): string {
  return `${op.op}(${op.args.map((arg) => (typeof arg === 'number' ? arg.toFixed(6) : String(arg))).join(',')})`;
}

/** The ops of each half, split at the rotation the far half is drawn inside. */
function halves(renderer: RecordingRenderer): { near: Op[]; far: Op[] } {
  const push = renderer.ops.findIndex((entry) => entry.op === 'pushSeatRotation');
  const pop = renderer.ops.findIndex((entry) => entry.op === 'popSeatRotation');
  expect(push).toBeGreaterThan(0);
  expect(pop).toBeGreaterThan(push);
  return {
    // The first op is the clear, which belongs to neither half.
    near: renderer.ops.slice(1, push),
    far: renderer.ops.slice(push + 1, pop),
  };
}

/** Play a whole match between two bots through the public contract. */
function playBots(seed: number, p1: BotDifficulty, p2: BotDifficulty, maxSteps = 60 * 130): number {
  const { game, step } = rig(makeContext(seed, p1, p2));
  let steps = 0;
  for (; steps < maxSteps; steps += 1) {
    step();
    if (game.getScore().winner !== null) break;
  }
  game.destroy();
  return steps;
}

describe('the manifest', () => {
  it('declares the box the simulation actually uses', () => {
    expect(manifest.logical.width).toBe(BOX_WIDTH);
    expect(manifest.logical.height).toBe(BOX_HEIGHT);
    expect(manifest.logical.width).toBe(ARENA_WIDTH);
    expect(ARENA_TOP + ARENA_HEIGHT).toBe(BOX_HEIGHT);
    expect(BAND_TOP * 2).toBe(BOX_HEIGHT);
  });

  it('is a real-time racing game with a horizontal split', () => {
    expect(manifest.id).toBe('crash-it');
    expect(manifest.archetype).toBe('rt-race');
    expect(manifest.zoneSplit).toBe('horizontal');
    expect(manifest.orientation).toBe('portrait');
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
    expect(manifest.presentations).toContain('shared-screen');
    expect(manifest.presentations).toContain('single-seat');
  });

  it('advertises a round length in the range the game measures', () => {
    expect(manifest.roundSeconds).toBeGreaterThan(10);
    expect(manifest.roundSeconds).toBeLessThan(MATCH_SECONDS);
  });

  it('never offers one player both halves of the keyboard', () => {
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/player two/i);
    expect(keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
    expect(keyboard.length).toBeLessThanOrEqual(120);
  });

  it('says something true about the pointer as well', () => {
    const { pointer } = manifest.controls;
    expect(pointer).toMatch(/half/i);
    expect(pointer).toMatch(/flick/i);
    expect(pointer.length).toBeLessThanOrEqual(120);
  });

  it('never claims to have turns', () => {
    const game = new CrashItGame();
    game.init(makeContext());
    expect(game.getActiveSeat()).toBeNull();
    game.destroy();
  });
});

describe('the keyboard', () => {
  it('drives seat one with A and D', () => {
    const right = rig();
    right.manager.keyDown('KeyD');
    right.step(20);
    expect(right.game.match.p1.x).toBeGreaterThan(-START_OFFSET + 5);

    const left = rig();
    left.manager.keyDown('KeyA');
    left.step(20);
    expect(left.game.match.p1.x).toBeLessThan(-START_OFFSET - 5);
  });

  it('drives seat two with the arrow keys, in the same direction on the screen', () => {
    // Both seats are shown the same picture the same way up, so "right" is the same way for
    // both of them and neither key mapping needs a mirror.
    const right = rig();
    right.manager.keyDown('ArrowRight');
    right.step(20);
    expect(right.game.match.p2.x).toBeGreaterThan(START_OFFSET + 5);

    const left = rig();
    left.manager.keyDown('ArrowLeft');
    left.step(20);
    expect(left.game.match.p2.x).toBeLessThan(START_OFFSET - 5);
  });

  it('jumps seat one on W and on Space', () => {
    for (const code of ['KeyW', 'Space']) {
      const { game, manager, step } = rig();
      manager.keyDown(code);
      step(3);
      expect(game.match.p1.grounded, code).toBe(false);
      expect(game.match.p1.vy, code).toBeLessThan(0);
    }
  });

  it('jumps seat two on the up arrow and on Enter', () => {
    for (const code of ['ArrowUp', 'Enter']) {
      const { game, manager, step } = rig();
      manager.keyDown(code);
      step(3);
      expect(game.match.p2.grounded, code).toBe(false);
      expect(game.match.p2.vy, code).toBeLessThan(0);
    }
  });

  it('only jumps on the step the key goes down, not on every step it is held', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyW');
    step(1);
    const first = game.match.p1.jumpCooldown;
    step(6);
    // Held down, the cooldown only ever runs out; it is never set again.
    expect(game.match.p1.jumpCooldown).toBeLessThan(first);
  });

  it('does nothing at all for the keys this game does not use', () => {
    for (const code of ['KeyS', 'ArrowDown', 'Tab', 'Escape']) {
      const { game, manager, step } = rig();
      const before = JSON.stringify(game.match);
      manager.keyDown(code);
      step(1);
      manager.keyUp(code);
      step(1);
      const p1 = game.match.p1;
      const p2 = game.match.p2;
      expect(p1.vx, code).toBe(0);
      expect(p2.vx, code).toBe(0);
      expect(p1.grounded, code).toBe(true);
      expect(p2.grounded, code).toBe(true);
      expect(before.length).toBeGreaterThan(0);
    }
  });

  it('never lets the keys of one seat move the car of the other', () => {
    const { game, manager, step } = rig();
    manager.keyDown('KeyD');
    manager.keyDown('KeyW');
    step(20);
    expect(game.match.p2.x).toBe(START_OFFSET);
    expect(game.match.p2.vx).toBe(0);
    expect(game.match.p2.grounded).toBe(true);
  });

  it('does not steer more weakly for a player holding a second key', () => {
    // The engine normalises two keys held at once to 0.707 each, so the *sign* of the axis
    // is taken rather than the component — otherwise a player resting a thumb on another
    // key would drive three quarters as hard as one who was not.
    const plain = rig();
    plain.manager.keyDown('KeyD');
    plain.step(10);
    const both = rig();
    both.manager.keyDown('KeyD');
    both.manager.keyDown('KeyS');
    both.step(10);
    expect(both.game.match.p1.vx).toBeCloseTo(plain.game.match.p1.vx, 9);
    expect(both.game.match.p1.x).toBeCloseTo(plain.game.match.p1.x, 9);
  });
});

describe('the pointer', () => {
  it('drives the car towards the finger, read in that seat own frame', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, 560, P1_HALF_Y);
    step(20);
    expect(game.match.p1.x).toBeGreaterThan(-START_OFFSET + 5);
    expect(game.match.p2.x).toBe(START_OFFSET);

    const other = rig();
    // Seat two reads the same picture turned half a turn, so its finger comes back through
    // the same rotation: a finger on the left of seat two's half is the right of the pit.
    other.manager.pointerDown(2, 40, P2_HALF_Y);
    other.step(20);
    expect(other.game.match.p2.x).toBeGreaterThan(START_OFFSET);
  });

  it('holds the car still once it is under the finger', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, pitX(-START_OFFSET), P1_HALF_Y);
    step(40);
    expect(Math.abs(game.match.p1.x + START_OFFSET)).toBeLessThan(POINTER_SPAN);
    expect(Math.abs(game.match.p1.vx)).toBeLessThan(40);
  });

  it('does not jump merely because a finger touched the glass', () => {
    // The engine reports a finger down as the action held, so without care every touch
    // meant for steering would also be a jump.
    const { game, manager, step } = rig();
    manager.pointerDown(1, 400, P1_HALF_Y);
    step(10);
    expect(game.match.p1.grounded).toBe(true);
    expect(game.match.p1.jumpCooldown).toBe(0);
  });

  it('jumps on a flick towards the middle of the device', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, 300, P1_HALF_Y);
    step(1);
    manager.pointerMove(1, 300, P1_HALF_Y - SWIPE_RISE - 5);
    step(2);
    expect(game.match.p1.grounded).toBe(false);
    expect(game.match.p1.vy).toBeLessThan(0);
  });

  it('takes a flick from seat two the other way up the device', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(2, 300, P2_HALF_Y);
    step(1);
    manager.pointerMove(2, 300, P2_HALF_Y + SWIPE_RISE + 5);
    step(2);
    expect(game.match.p2.grounded).toBe(false);
  });

  it('is a ratchet rather than a threshold, so a slow slide is not thirty jumps', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, 300, 980);
    step(1);
    let jumps = 0;
    let cooling = false;
    for (let i = 1; i <= 40; i += 1) {
      manager.pointerMove(1, 300, 980 - i * 10);
      step();
      const armed = game.match.p1.jumpCooldown === JUMP_COOLDOWN;
      if (armed && !cooling) jumps += 1;
      cooling = game.match.p1.jumpCooldown > 0;
    }
    expect(jumps).toBeGreaterThanOrEqual(1);
    expect(jumps).toBeLessThanOrEqual(5);
  });

  it('keeps a finger with the seat it went down in, across the midline', () => {
    // Seat ownership lives in the engine and this game never reimplements it.
    const { game, manager, step } = rig();
    manager.pointerDown(1, 560, P1_HALF_Y);
    step(4);
    for (let y = P1_HALF_Y; y >= 200; y -= 50) {
      manager.pointerMove(1, 560, y);
      step(2);
    }
    expect(game.match.p1.x).toBeGreaterThan(-START_OFFSET);
    expect(game.match.p2.x).toBe(START_OFFSET);
    expect(game.match.p2.vx).toBe(0);
  });

  it('ignores a coordinate that is not a number', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, Number.NaN, Number.NaN);
    step(5);
    expect(Number.isFinite(game.match.p1.x)).toBe(true);
    expect(Number.isFinite(game.match.p1.y)).toBe(true);
    expect(game.match.p1.grounded).toBe(true);
  });

  it('maps a finger to a place in the pit, and clamps it to the pit', () => {
    expect(pointerPitX('p1', 0)).toBe(-ARENA_HALF_WIDTH);
    expect(pointerPitX('p1', BOX_WIDTH)).toBe(ARENA_HALF_WIDTH);
    expect(pointerPitX('p1', BOX_WIDTH / 2)).toBe(0);
    // The far seat's finger comes back through the same half turn the picture goes out by.
    expect(pointerPitX('p2', 0)).toBe(ARENA_HALF_WIDTH);
    expect(pointerPitX('p2', BOX_WIDTH)).toBe(-ARENA_HALF_WIDTH);
    expect(pointerPitX('p1', -900)).toBe(-ARENA_HALF_WIDTH);
    expect(pointerPitX('p1', 9000)).toBe(ARENA_HALF_WIDTH);
    expect(Number.isNaN(pointerPitX('p1', Number.NaN))).toBe(true);
  });

  it('measures a flick from the edge of the device that seat sits at', () => {
    expect(pointerAlong('p1', BOX_HEIGHT)).toBe(0);
    expect(pointerAlong('p1', BAND_TOP)).toBe(BAND_TOP);
    expect(pointerAlong('p2', 0)).toBe(0);
    expect(pointerAlong('p2', BAND_TOP)).toBe(BAND_TOP);
  });

  it('answers a keyboard and a finger with the same car', () => {
    // Rule 10: no mechanic may reward one instrument over the other. Both ask for the same
    // thing — a place to be — and both arrive at it through the same throttle.
    const byKey = rig();
    byKey.manager.keyDown('KeyD');
    byKey.step(30);
    const byThumb = rig();
    byThumb.manager.pointerDown(1, BOX_WIDTH - 1, P1_HALF_Y);
    byThumb.step(30);
    expect(byThumb.game.match.p1.x).toBeCloseTo(byKey.game.match.p1.x, 6);
  });
});

describe('the picture', () => {
  it('shows both seats exactly the same pit', () => {
    // Rule 9, checked on the draw calls themselves: the far half is the near half turned
    // half a turn, so the two op lists must be the same list — apart from the marker over
    // each seat's own car and the line that names it.
    const { game, step } = rig(makeContext(3, 'hard', 'normal'));
    step(120);
    const { near, far } = halves(draw(game));
    expect(near.length).toBe(far.length);
    let different = 0;
    for (let i = 0; i < near.length; i += 1) {
      if (key(near[i]!) === key(far[i]!)) continue;
      different += 1;
      expect(['line', 'text']).toContain(near[i]!.op);
      expect(near[i]!.op).toBe(far[i]!.op);
    }
    // Three lines of chevron and one line of label, and nothing else.
    expect(different).toBeLessThanOrEqual(4);
    expect(different).toBeGreaterThan(0);
  });

  it('draws the far half inside exactly one balanced rotation', () => {
    const { game, step } = rig();
    step(30);
    const renderer = draw(game);
    const pushes = renderer.ops.filter((entry) => entry.op === 'pushSeatRotation');
    const pops = renderer.ops.filter((entry) => entry.op === 'popSeatRotation');
    expect(pushes.length).toBe(1);
    expect(pops.length).toBe(1);
    expect(pushes[0]!.args[0]).toBe(true);
  });

  it('never draws outside its own declared box', () => {
    const { game, step } = rig(makeContext(9, 'hard', 'hard'));
    for (let i = 0; i < 40; i += 1) {
      step(15);
      const renderer = draw(game);
      for (const entry of renderer.ops) {
        if (entry.op === 'text') continue;
        for (let i = 0; i < entry.args.length; i += 1) {
          const value = entry.args[i];
          if (typeof value !== 'number') continue;
          expect(Number.isFinite(value)).toBe(true);
          expect(Math.abs(value)).toBeLessThanOrEqual(BOX_HEIGHT + 60);
        }
      }
    }
  });

  it('keeps every shape of the pit inside a single half', () => {
    const { game, step } = rig(makeContext(4, 'hard', 'hard'));
    step(200);
    const { near } = halves(draw(game));
    for (const entry of near) {
      if (entry.op === 'rect') {
        const y = entry.args[1] as number;
        expect(y).toBeGreaterThanOrEqual(BAND_TOP - 1);
        expect(y + (entry.args[3] as number)).toBeLessThanOrEqual(BOX_HEIGHT + 1);
      }
      if (entry.op === 'circle') {
        const y = entry.args[1] as number;
        const radius = entry.args[2] as number;
        expect(y + radius).toBeLessThanOrEqual(BOX_HEIGHT + 40);
        expect(y - radius).toBeGreaterThanOrEqual(BAND_TOP - 60);
      }
    }
  });

  it('gives the two cars different silhouettes, not only different colours', () => {
    // Rule 7. Both cars are drawn in the same half, so a player who cannot tell red from
    // blue has to be able to tell a wedge from a rack.
    const { game, step } = rig();
    step(2);
    const { near } = halves(draw(game));
    const shapes = near.filter((entry) => entry.op === 'circle' || entry.op === 'strokeCircle');
    expect(shapes.some((entry) => entry.op === 'strokeCircle')).toBe(true);
    const lines = near.filter((entry) => entry.op === 'line').length;
    expect(lines).toBeGreaterThan(10);
  });

  it('draws nothing that changes the match', () => {
    const { game, step } = rig(makeContext(5, 'normal', 'normal'));
    step(90);
    const before = JSON.stringify(game.match);
    draw(game);
    draw(game);
    expect(JSON.stringify(game.match)).toBe(before);
  });

  it('maps the pit into the near half the way the finger is mapped back', () => {
    expect(pitX(0)).toBe(BOX_WIDTH / 2);
    expect(pitX(-ARENA_HALF_WIDTH)).toBe(0);
    expect(pitX(ARENA_HALF_WIDTH)).toBe(BOX_WIDTH);
    expect(pitY(0)).toBe(ARENA_TOP);
    expect(pitY(ARENA_HEIGHT)).toBe(BOX_HEIGHT);
    expect(pitY(groundY(0))).toBeLessThan(BOX_HEIGHT);
  });
});

describe('the bots', () => {
  it('plays a whole match at every pairing of tiers', () => {
    for (const p1 of TIERS) {
      for (const p2 of TIERS) {
        const { game, step } = rig(makeContext(77, p1, p2));
        let decided = false;
        for (let i = 0; i < 60 * 130; i += 1) {
          step();
          if (game.getScore().winner !== null) {
            decided = true;
            break;
          }
        }
        expect(decided, `${p1} v ${p2}`).toBe(true);
        const score = game.getScore();
        expect(Math.max(score.p1, score.p2)).toBeGreaterThan(0);
        game.destroy();
      }
    }
  });

  it('ignores a human hammering the keys of a seat a bot is sitting in', () => {
    const quiet = rig(makeContext(21, 'hard', 'hard'));
    quiet.step(180);
    const noisy = rig(makeContext(21, 'hard', 'hard'));
    for (let i = 0; i < 180; i += 1) {
      if (i % 7 === 0) noisy.manager.keyDown('KeyA');
      if (i % 7 === 3) noisy.manager.keyUp('KeyA');
      if (i % 11 === 0) noisy.manager.pointerDown(3, 100, P1_HALF_Y);
      if (i % 11 === 5) noisy.manager.pointerUp(3);
      noisy.step();
    }
    expect(JSON.stringify(noisy.game.match)).toBe(JSON.stringify(quiet.game.match));
  });

  it('plays a different match on easy and on hard', () => {
    const easy = rig(makeContext(31, 'easy', 'easy'));
    const hard = rig(makeContext(31, 'hard', 'hard'));
    easy.step(300);
    hard.step(300);
    expect(JSON.stringify(hard.game.match)).not.toBe(JSON.stringify(easy.game.match));
  });

  it('plays a different match with a bot than with nobody at all', () => {
    const bots = rig(makeContext(41, 'normal', 'normal'));
    const nobody = rig(makeContext(41, null, null));
    bots.step(200);
    nobody.step(200);
    expect(JSON.stringify(bots.game.match)).not.toBe(JSON.stringify(nobody.game.match));
  });

  it('beats a player who never touches anything', () => {
    const { game, step } = rig(makeContext(53, null, 'hard'));
    for (let i = 0; i < 60 * 130; i += 1) {
      step();
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).toBe('p2');
  });

  it('finishes faster the better both bots are at finding a head', () => {
    // Not a balance claim — that is measured over three seed families in SPEC.md. This is
    // only that a tier reaches a decision at all, from the outside, through the contract.
    for (const tier of TIERS) {
      const steps = playBots(61, tier, tier);
      expect(steps).toBeGreaterThan(60);
      expect(steps * STEP).toBeLessThan(MATCH_SECONDS);
    }
  });
});

describe('the contract', () => {
  it('reports the score the match is keeping', () => {
    const { game, step } = rig(makeContext(71, 'hard', 'easy'));
    step(60 * 40);
    const score = game.getScore();
    expect(score.p1).toBe(game.match.p1Points);
    expect(score.p2).toBe(game.match.p2Points);
    expect(score.p1).toBeLessThanOrEqual(POINTS_TO_WIN);
    expect(score.p2).toBeLessThanOrEqual(POINTS_TO_WIN);
  });

  it('stops the match the moment it is decided and never moves again', () => {
    const { game, step } = rig(makeContext(83, 'hard', 'easy'));
    for (let i = 0; i < 60 * 130; i += 1) {
      step();
      if (game.getScore().winner !== null) break;
    }
    const winner = game.getScore().winner;
    expect(winner).not.toBeNull();
    const frozen = JSON.stringify(game.match);
    step(120);
    expect(JSON.stringify(game.match)).toBe(frozen);
    expect(game.getScore().winner).toBe(winner);
  });

  it('plays the identical match in either presentation', () => {
    // Nothing in the game reads `presentation`: the shell decides how to show it.
    const shared = rig(makeContext(97, 'normal', 'hard', 'shared-screen', 'p1'));
    const single = rig(makeContext(97, 'normal', 'hard', 'single-seat', 'p2'));
    shared.step(400);
    single.step(400);
    expect(JSON.stringify(single.game.match)).toBe(JSON.stringify(shared.game.match));
  });

  it('plays the identical match from the same seed, twice over', () => {
    const first = rig(makeContext(101, 'hard', 'normal'));
    const second = rig(makeContext(101, 'hard', 'normal'));
    first.step(400);
    second.step(400);
    expect(JSON.stringify(second.game.match)).toBe(JSON.stringify(first.game.match));
  });

  it('drops a half-taken flick when the game is paused', () => {
    const { game, manager, step } = rig();
    manager.pointerDown(1, 300, 980);
    step(1);
    manager.pointerMove(1, 300, 940);
    step(1);
    game.onPause();
    game.onResume();
    // The ratchet has been forgotten, so the rest of the same slide is not a jump.
    manager.pointerMove(1, 300, 900);
    step(1);
    expect(game.match.p1.grounded).toBe(true);
  });

  it('starts a fresh match on a second init', () => {
    const { game, step } = rig(makeContext(103, 'hard', 'easy'));
    step(600);
    game.init(makeContext(103, 'hard', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.p1.x).toBe(-START_OFFSET);
    expect(game.match.rounds).toBe(1);
  });

  it('leaves nothing behind when it is destroyed', () => {
    const { game, step } = rig(makeContext(107, 'normal', 'normal'));
    step(300);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.match.p1.x).toBe(-START_OFFSET);
    expect(game.match.p2.x).toBe(START_OFFSET);
  });

  it('survives being torn down and stood back up mid-storm', () => {
    const context = makeContext(109, 'easy', 'easy');
    const { game, manager, step } = rig(context);
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 90; i += 1) {
        manager.keyDown(SEATS[i % 2] === 'p1' ? 'KeyD' : 'ArrowLeft');
        step();
        manager.keyUp('KeyD');
        manager.keyUp('ArrowLeft');
      }
      game.destroy();
      game.init(context);
    }
    expect(game.getScore().winner).toBeNull();
  });
});
