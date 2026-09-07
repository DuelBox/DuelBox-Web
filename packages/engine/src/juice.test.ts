import { describe, expect, it } from 'vitest';
import {
  applyShake,
  Flash,
  HitStop,
  Impact,
  MAX_HOLD_SECONDS,
  releaseShake,
  Shake,
} from './juice.js';
import { Canvas2DRenderer } from './renderer.js';
import type { Canvas2DLike, Renderer } from './renderer.js';
import type { LogicalSize } from './seat.js';

const STEP = 1 / 60;
const LOGICAL: LogicalSize = { width: 800, height: 600 };

type CallArg = number | string | boolean | undefined;

interface RecordedCall {
  readonly op: string;
  readonly args: readonly CallArg[];
}

/**
 * A Canvas2DLike that logs the calls this file needs to reason about, with no DOM anywhere.
 *
 * `renderer.test.ts` has a richer one that also tracks the composed matrix; this is
 * deliberately its own rather than shared, because the two files ask different questions of
 * it and a fake that answers both is a fake nobody dares change.
 */
class RecordingContext implements Canvas2DLike {
  readonly calls: RecordedCall[] = [];

  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  font = '10px sans-serif';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  #depth = 0;

  /** Outstanding save() calls, so an unbalanced frame fails here rather than three tests on. */
  get depth(): number {
    return this.#depth;
  }

  save(): void {
    this.#depth += 1;
    this.#record('save');
  }
  restore(): void {
    if (this.#depth === 0) throw new Error('fake: restore without a matching save');
    this.#depth -= 1;
    this.#record('restore');
  }
  translate(x: number, y: number): void {
    this.#record('translate', x, y);
  }
  rotate(angle: number): void {
    this.#record('rotate', angle);
  }
  scale(x: number, y: number): void {
    this.#record('scale', x, y);
  }
  beginPath(): void {
    this.#record('beginPath');
  }
  closePath(): void {
    this.#record('closePath');
  }
  moveTo(x: number, y: number): void {
    this.#record('moveTo', x, y);
  }
  lineTo(x: number, y: number): void {
    this.#record('lineTo', x, y);
  }
  arc(x: number, y: number, radius: number, start: number, end: number): void {
    this.#record('arc', x, y, radius, start, end);
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.#record('rect', x, y, width, height);
  }
  fill(): void {
    this.#record('fill');
  }
  stroke(): void {
    this.#record('stroke', this.lineWidth);
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.#record('fillRect', x, y, width, height);
  }
  fillText(text: string, x: number, y: number): void {
    this.#record('fillText', text, x, y);
  }
  measureText(text: string): { readonly width: number } {
    return { width: text.length * 7 };
  }
  clearRect(x: number, y: number, width: number, height: number): void {
    this.#record('clearRect', x, y, width, height);
  }
  clip(): void {
    this.#record('clip');
  }

  #record(op: string, ...args: CallArg[]): void {
    this.calls.push({ op, args });
  }
}

function setup(): { fake: RecordingContext; renderer: Canvas2DRenderer } {
  const fake = new RecordingContext();
  return { fake, renderer: new Canvas2DRenderer(fake, LOGICAL) };
}

/** Every argument list recorded for `op`, in order. */
function argsOf(fake: RecordingContext, op: string): readonly (readonly CallArg[])[] {
  return fake.calls.filter((call) => call.op === op).map((call) => call.args);
}

describe('Shake', () => {
  it('starts at rest, moves, and comes back to rest exactly when it said it would', () => {
    const shake = new Shake();
    expect(shake.active).toBe(false);
    expect(shake.offsetX).toBe(0);
    expect(shake.intensity).toBe(0);

    shake.kick(20, 0.2);
    expect(shake.active).toBe(true);
    expect(shake.intensity).toBe(1);

    let steps = 0;
    let peak = 0;
    while (shake.active && steps < 1000) {
      shake.step(STEP);
      peak = Math.max(peak, Math.abs(shake.offsetX), Math.abs(shake.offsetY));
      steps += 1;
    }
    expect(steps * STEP).toBeCloseTo(0.2, 1);
    expect(shake.offsetX).toBe(0);
    expect(shake.offsetY).toBe(0);
    expect(shake.intensity).toBe(0);
    // It moved, and it never moved further than it was asked to.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(20);
  });

  it('dies away rather than holding its amplitude to the end', () => {
    const shake = new Shake();
    shake.kick(20, 0.4);
    shake.step(0.1);
    const early = shake.intensity;
    shake.step(0.2);
    const late = shake.intensity;
    expect(early).toBeLessThan(1);
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThan(0);
  });

  it('lets the strongest kick win instead of adding them up', () => {
    // Three hits in a rally are three reasons to shake, not three shakes to perform.
    const single = new Shake();
    const battered = new Shake();
    single.kick(20, 0.2);
    battered.kick(20, 0.2);
    for (let i = 0; i < 4; i += 1) battered.kick(5, 0.2);
    single.step(STEP);
    battered.step(STEP);
    expect(battered.offsetX).toBe(single.offsetX);
    expect(battered.intensity).toBe(single.intensity);
  });

  it('lets a smaller kick land once the big one has decayed past it', () => {
    const shake = new Shake();
    shake.kick(20, 0.4);
    shake.step(0.35);
    expect(shake.intensity * 20).toBeLessThan(5);
    shake.kick(5, 0.2);
    expect(shake.intensity).toBe(1);
  });

  it('produces the same offsets for the same steps, with no randomness anywhere', () => {
    const a = new Shake();
    const b = new Shake();
    a.kick(12, 0.3);
    b.kick(12, 0.3);
    const seen: number[] = [];
    const also: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      a.step(STEP);
      b.step(STEP);
      seen.push(a.offsetX, a.offsetY);
      also.push(b.offsetX, b.offsetY);
    }
    expect(also).toEqual(seen);
  });

  it('is never told what the device asked for', () => {
    // The same guard flip.test.ts carries, for the same reason: a switch on this class could
    // only be adopted game by game, and it would be deaf to a preference changed mid-match.
    // The displacement is unconditional here and dropped by the renderer.
    const shake = new Shake();
    expect('setReducedMotion' in shake).toBe(false);
    expect(Shake.prototype.step.length).toBe(1);
    expect(Shake.prototype.kick.length).toBe(2);
  });

  it('rejects a negative magnitude, duration or step', () => {
    const shake = new Shake();
    expect(() => {
      shake.kick(-1, 0.2);
    }).toThrow(RangeError);
    expect(() => {
      shake.kick(1, -0.2);
    }).toThrow(RangeError);
    expect(() => {
      shake.step(-STEP);
    }).toThrow(RangeError);
  });
});

describe('Flash', () => {
  it('pulses down from full and ends on nothing', () => {
    const flash = new Flash();
    flash.raise(0.2);
    expect(flash.intensity).toBe(1);
    let previous = flash.intensity;
    let steps = 0;
    while (flash.active && steps < 1000) {
      flash.step(STEP);
      expect(flash.intensity).toBeLessThanOrEqual(previous);
      previous = flash.intensity;
      steps += 1;
    }
    expect(steps * STEP).toBeCloseTo(0.2, 1);
    expect(flash.intensity).toBe(0);
  });

  it('holds a steady level for exactly the window the pulse would have filled', () => {
    // The non-motion substitute, and the property that makes it a substitute rather than a
    // second effect: same steps, same span, no ramp for a player to be shown.
    const pulse = new Flash();
    const steady = new Flash();
    pulse.raise(0.2);
    steady.raise(0.2);
    const levels: number[] = [];
    while (pulse.active) {
      levels.push(steady.steady);
      expect(steady.active).toBe(pulse.active);
      pulse.step(STEP);
      steady.step(STEP);
    }
    expect(steady.active).toBe(false);
    expect(steady.steady).toBe(0);
    expect(levels.length).toBeGreaterThan(5);
    // Constant throughout, and never nothing while the flash is running.
    expect(new Set(levels).size).toBe(1);
    expect(levels[0]).toBeGreaterThan(0);
  });

  it('gives the pulse or the steady mark according to what was asked for', () => {
    const flash = new Flash();
    flash.raise(0.2);
    flash.step(0.15);
    expect(flash.levelFor({ reducedMotion: false })).toBe(flash.intensity);
    expect(flash.levelFor({})).toBe(flash.intensity);
    expect(flash.levelFor({ reducedMotion: true })).toBe(flash.steady);
    // Late in the window the two genuinely differ, so this is not the same number twice.
    expect(flash.levelFor({ reducedMotion: true })).not.toBe(
      flash.levelFor({ reducedMotion: false }),
    );
  });

  it('re-lights on a longer raise and ignores a shorter one', () => {
    const flash = new Flash();
    flash.raise(0.3);
    flash.step(0.2);
    const faded = flash.intensity;
    flash.raise(0.05);
    expect(flash.intensity).toBe(faded);
    flash.raise(0.3);
    expect(flash.intensity).toBe(1);
  });
});

describe('HitStop', () => {
  it('holds the picture for three steps at sixty hertz and then lets go', () => {
    const stop = new HitStop();
    expect(stop.holding).toBe(false);
    stop.hold(0.05);
    // Read in the order a match reads it: the loop steps, then the frame is drawn.
    const held: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      stop.step(STEP);
      held.push(stop.holding);
    }
    expect(held).toEqual([true, true, true, false, false, false]);
    expect(stop.remainingSeconds).toBe(0);
  });

  it('caps a hold however long it is asked for', () => {
    // The cap is the honest cost of freezing only the picture: the world does not wait, so
    // every held second arrives at once when the hold ends. Beyond this it stops reading as
    // an impact and starts reading as a dropped frame.
    const stop = new HitStop();
    stop.hold(10);
    expect(stop.remainingSeconds).toBe(MAX_HOLD_SECONDS);
  });

  it('extends a running hold and never shortens one', () => {
    const stop = new HitStop();
    stop.hold(0.1);
    stop.hold(0.02);
    expect(stop.remainingSeconds).toBeCloseTo(0.1, 12);
  });

  it('declines to hold at all under reduced motion', () => {
    // Not merely reduced: declined. The catch-up on release is exactly the sudden movement
    // the preference is asking not to be shown, so there is no gentler version to offer.
    const stop = new HitStop();
    stop.hold(0.05);
    expect(stop.holding).toBe(true);
    expect(stop.holdingFor({ reducedMotion: true })).toBe(false);
    expect(stop.holdingFor({ reducedMotion: false })).toBe(true);
    expect(stop.holdingFor({})).toBe(true);
  });

  it('counts down identically whichever answer it is read with', () => {
    const asked = new HitStop();
    const not = new HitStop();
    asked.hold(0.1);
    not.hold(0.1);
    for (let i = 0; i < 6; i += 1) {
      asked.holdingFor({ reducedMotion: true });
      asked.step(STEP);
      not.step(STEP);
    }
    expect(asked.remainingSeconds).toBe(not.remainingSeconds);
  });
});

describe('Impact', () => {
  it('raises all three on one strike, so the motion is never the only channel', () => {
    const impact = new Impact();
    impact.strike(20, 0.25);
    expect(impact.shake.active).toBe(true);
    expect(impact.flash.active).toBe(true);
    expect(impact.hitStop.holding).toBe(true);
    expect(impact.active).toBe(true);
  });

  it('hands back the same three objects every time it is read', () => {
    // The allocation guard the input system and the lockstep session both carry: a composite
    // that built its parts on demand would allocate three objects per frame.
    const impact = new Impact();
    const shake = impact.shake;
    const flash = impact.flash;
    const stop = impact.hitStop;
    for (let i = 0; i < 10; i += 1) {
      impact.strike(5, 0.1);
      impact.step(STEP);
      expect(impact.shake).toBe(shake);
      expect(impact.flash).toBe(flash);
      expect(impact.hitStop).toBe(stop);
    }
  });

  it('steps all three from one call and clears all three from one call', () => {
    const impact = new Impact();
    impact.strike(20, 0.25);
    for (let i = 0; i < 4; i += 1) impact.step(STEP);
    expect(impact.shake.intensity).toBeLessThan(1);
    expect(impact.flash.intensity).toBeLessThan(1);
    impact.clear();
    expect(impact.active).toBe(false);
    expect(impact.shake.offsetX).toBe(0);
    expect(impact.flash.intensity).toBe(0);
    expect(impact.hitStop.holding).toBe(false);
  });
});

describe('the renderer is where a shake meets the preference', () => {
  it('shifts the world by the offset it is handed', () => {
    const { fake, renderer } = setup();
    renderer.pushShake(4, -7);
    expect(argsOf(fake, 'translate')).toEqual([[4, -7]]);
    renderer.popShake();
    expect(fake.depth).toBe(0);
  });

  it('drops the displacement under reduced motion and still balances the stack', () => {
    const { fake, renderer } = setup();
    renderer.setReducedMotion(true);
    renderer.pushShake(4, -7);
    expect(argsOf(fake, 'translate')).toEqual([]);
    expect(fake.depth).toBe(1);
    renderer.popShake();
    expect(fake.depth).toBe(0);
  });

  it('can be switched back off again, mid-match, in both directions', () => {
    // The reason the switch is here and not on Shake: a game is handed its context once, and
    // this is the one thing in the drawing path that hears the preference change.
    const { fake, renderer } = setup();
    renderer.setReducedMotion(true);
    renderer.pushShake(4, -7);
    renderer.popShake();
    renderer.setReducedMotion(false);
    renderer.pushShake(4, -7);
    renderer.popShake();
    expect(argsOf(fake, 'translate')).toEqual([[4, -7]]);
    expect(renderer.reducedMotion).toBe(false);
  });

  it('reports the live preference to whatever is reading levels', () => {
    const { renderer } = setup();
    expect(renderer.reducedMotion).toBe(false);
    renderer.setReducedMotion(true);
    expect(renderer.reducedMotion).toBe(true);
  });

  it('skips the translate for a shake that is at rest', () => {
    const { fake, renderer } = setup();
    renderer.pushShake(0, 0);
    expect(argsOf(fake, 'translate')).toEqual([]);
    renderer.popShake();
  });

  it('rejects an offset that is not a finite number', () => {
    const { renderer } = setup();
    expect(() => {
      renderer.pushShake(Number.NaN, 0);
    }).toThrow(RangeError);
    expect(() => {
      renderer.pushShake(0, Number.POSITIVE_INFINITY);
    }).toThrow(RangeError);
  });

  it('is unwound by endFrame if a game leaks one, and says which pair leaked', () => {
    // The noun matters more than it looks. Leaking a shake is easy in the shape this module
    // recommends — read `HitStop` at the top of `render()` and return, having already
    // applied the shake — and the message used to say `pushSeatRotation`, which sends the
    // author to the seat-flip code. That code is balanced, so the search starts wrong.
    const { fake, renderer } = setup();
    renderer.beginFrame();
    renderer.pushShake(3, 3);
    expect(() => {
      renderer.endFrame();
    }).toThrow(/1 unbalanced pushShake call\(s\)/);
    expect(fake.depth).toBe(0);

    renderer.beginFrame();
    renderer.pushShake(3, 3);
    expect(() => {
      renderer.endFrame();
    }).not.toThrow(/pushSeatRotation/);
    expect(fake.depth).toBe(0);
  });

  it('counts a shake apart from a seat rotation, and names both when both leak', () => {
    // `seatRotationDepth` is what a debug overlay reads to ask which seat the world is
    // turned for, so a shake must not appear in it.
    const { fake, renderer } = setup();
    renderer.pushShake(4, -7);
    expect(renderer.seatRotationDepth).toBe(0);
    expect(renderer.shakeDepth).toBe(1);
    renderer.popShake();
    expect(renderer.shakeDepth).toBe(0);

    renderer.beginFrame();
    renderer.pushSeatRotation(true);
    renderer.pushShake(1, 1);
    expect(() => {
      renderer.endFrame();
    }).toThrow('endFrame with 1 unbalanced pushSeatRotation call(s) and 1 unbalanced pushShake');
    expect(fake.depth).toBe(0);
  });

  it('answers a release with no shake by naming the call that was missing', () => {
    // It used to delegate to `popSeatRotation`, so a `releaseShake` with no `applyShake` was
    // answered by a sentence naming two methods the game had never called.
    const { fake, renderer } = setup();
    expect(() => {
      renderer.popShake();
    }).toThrow('popShake called without a matching pushShake');
    expect(fake.calls).toEqual([]);

    // The pairs are independent: a rotation open is not a shake to release.
    renderer.pushSeatRotation(true);
    expect(() => {
      renderer.popShake();
    }).toThrow(/pushShake/);
    renderer.popSeatRotation();
    expect(fake.depth).toBe(0);
  });

  it('no-ops through applyShake on a renderer that has never heard of a shake', () => {
    // Every game's test double implements Renderer by hand, which is why the pair is
    // optional there. Both helpers must no-op together, or a double would leave the stack
    // one deep on every frame.
    const calls: string[] = [];
    const bare: Renderer = {
      clear: () => calls.push('clear'),
      rect: () => calls.push('rect'),
      strokeRect: () => calls.push('strokeRect'),
      circle: () => calls.push('circle'),
      strokeCircle: () => calls.push('strokeCircle'),
      line: () => calls.push('line'),
      text: () => calls.push('text'),
      pushSeatRotation: () => calls.push('pushSeatRotation'),
      pushRotation: () => calls.push('pushRotation'),
      popSeatRotation: () => calls.push('popSeatRotation'),
    };
    const shake = new Shake();
    shake.kick(20, 0.2);
    shake.step(STEP);
    applyShake(bare, shake);
    releaseShake(bare);
    expect(calls).toEqual([]);
  });
});

/**
 * The demonstration, and the only place in this batch where the primitives are drawn.
 *
 * It is a harness rather than a game on purpose. Adopting these in a game package would put
 * bytes on that game's chunk to prove something a fake canvas proves exactly as well, and the
 * question worth answering here is not "does a game compile against this" but "does a player
 * with motion switched off still get told they were hit". Everything a game would write is
 * below, in the six lines of `render`.
 */
const BACKGROUND = '#101014';
const WORLD = '#e8e8ef';
const MARK = '#ff5f5f';
/** Rim thickness at full level, in logical units. Never pixels: rule 8. */
const RIM = 12;

class ImpactBoard {
  readonly impact = new Impact();

  /** What a game writes in `update()`: one call, on the fixed step, with nothing else in it. */
  update(fixedDeltaSeconds: number): void {
    this.impact.step(fixedDeltaSeconds);
  }

  /** And what it writes in `render()`. The renderer is the only thing consulted about motion. */
  render(renderer: Renderer): void {
    if (this.impact.hitStop.holdingFor(renderer)) return;
    renderer.clear(BACKGROUND);
    applyShake(renderer, this.impact.shake);
    renderer.rect(200, 150, 400, 300, WORLD);
    releaseShake(renderer);
    const level = this.impact.flash.levelFor(renderer);
    if (level > 0) renderer.strokeRect(0, 0, 800, 600, RIM * level, MARK);
  }
}

/** Plays `steps` frames of a strike and returns what reached the context on each. */
function playStrike(reducedMotion: boolean, steps: number): readonly RecordingContext[] {
  const board = new ImpactBoard();
  const frames: RecordingContext[] = [];
  board.impact.strike(20, 0.25);
  for (let i = 0; i < steps; i += 1) {
    board.update(STEP);
    const { fake, renderer } = setup();
    renderer.setReducedMotion(reducedMotion);
    board.render(renderer);
    frames.push(fake);
  }
  return frames;
}

describe('a hit, drawn both ways', () => {
  it('moves the world when motion is allowed', () => {
    const frames = playStrike(false, 12);
    const moved = frames.filter((frame) => argsOf(frame, 'translate').length > 0);
    expect(moved.length).toBeGreaterThan(5);
  });

  it('never moves the world when it is not, and still says the hit happened', () => {
    // The point of the pair. The shake is gone and the mark is not: the rim is stroked on
    // every frame of the window, so the player who cannot be shown the shake is told anyway.
    const frames = playStrike(true, 12);
    for (const frame of frames) {
      expect(argsOf(frame, 'translate')).toEqual([]);
      expect(argsOf(frame, 'stroke').length).toBe(1);
      expect(frame.depth).toBe(0);
    }
  });

  it('holds that mark steady rather than pulsing it', () => {
    const widths = playStrike(true, 12).map((frame) => argsOf(frame, 'stroke')[0]?.[0]);
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeGreaterThan(0);
  });

  it('pulses it when motion is allowed, which is how we know the two differ', () => {
    // The negative control. Without it this block would pass just as well against a
    // substitute that was the same drawing under a different name.
    const widths = playStrike(false, 12)
      .map((frame) => argsOf(frame, 'stroke')[0]?.[0])
      .filter((width): width is number => typeof width === 'number');
    expect(widths.length).toBeGreaterThan(5);
    expect(new Set(widths).size).toBeGreaterThan(5);
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeLessThanOrEqual(widths[i - 1]!);
    }
  });

  it('freezes the picture for three steps with motion and for none without', () => {
    // Hit-stop, and the whole of what it means here: the game draws nothing, so the canvas
    // keeps the frame it already has. The simulation is not consulted and does not stop.
    const withMotion = playStrike(false, 6).map((frame) => frame.calls.length);
    const without = playStrike(true, 6).map((frame) => frame.calls.length);
    expect(withMotion.slice(0, 3)).toEqual([0, 0, 0]);
    expect(withMotion[3]).toBeGreaterThan(0);
    for (const count of without) expect(count).toBeGreaterThan(0);
  });
});
