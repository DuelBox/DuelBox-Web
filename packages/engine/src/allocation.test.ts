import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { AudioSystem } from './audio.js';
import type { AudioBufferLike, AudioContextLike } from './audio.js';
import {
  aabbAabb,
  aabbObb,
  aabbSegment,
  circleAabb,
  circleCircle,
  circleObb,
  circleSegment,
  closestPointOnSegment,
  createContact,
  obbObb,
  obbSegment,
  pointInAabb,
  pointInCircle,
  segmentSegment,
  sweptCircleAabb,
  sweptCircleCircle,
  sweptCircleSegment,
} from './collision.js';
import type { Aabb, Circle, Obb, Segment } from './collision.js';
import { GridCursor } from './cursor.js';
import { SeatFlip } from './flip.js';
import { InputManager } from './input.js';
import { InputView } from './input-view.js';
import { Impact } from './juice.js';
import { LockstepSession } from './lockstep.js';
import type { MatchConfig } from './lockstep.js';
import { FixedLoop } from './loop.js';
import { Canvas2DRenderer } from './renderer.js';
import type { Canvas2DLike } from './renderer.js';
import { Rng } from './rng.js';
import { seatForPoint, seatRotated, toScreen, toWorld } from './seat.js';
import type { LogicalSize } from './seat.js';
import { loopbackPair } from './transport.js';
import { Tween } from './tween.js';
import {
  add,
  addScaled,
  copy,
  cross,
  distanceSq,
  dot,
  lerp,
  negate,
  normalise,
  perp,
  reflect,
  rotate,
  scale,
  set,
  sub,
  vec2,
  Vec2Pool,
} from './vec2.js';
import type { Vec2 } from './vec2.js';
import { logicalToViewport, fitViewport, viewportToLogical } from './viewport.js';
import type { Viewport } from './viewport.js';

/**
 * CLAUDE.md rule 5, measured (#122).
 *
 * "No per-frame allocations in engine or game `update()`" had been believed since the rule
 * was written and had never once been measured. It was not true. This file is the
 * measurement, and it is the deliverable: what it found and fixed is recorded beside each
 * repair, in `collision.ts`'s `SCALARS` and `NEAR_CIRCLE`, `input.ts`'s `#stepDelta` and
 * `lockstep.ts`'s `#checks`. Between them they were costing a game up to 125 bytes for one
 * box-against-segment test, 94 for the sweep that stops a fast body tunnelling through a
 * wall, and 16 every step for reading the controls.
 *
 * ## What actually allocates, and why nothing in the source said so
 *
 * Every one of the three was invisible to a reader, because none of them is written down
 * anywhere. **A floating-point number that crosses a call the optimiser has declined to
 * inline cannot travel as a raw double.** It has to be materialised on the heap first, as a
 * sixteen-byte number object, and then collected. Source that allocates nothing therefore
 * still allocates, and the amount depends on which calls the optimiser chose to inline —
 * which depends on how big the *calling* function is, not only on the callee.
 *
 * That last clause is the part worth carrying away, because it decides what this file can
 * honestly guard, and the boundary falls in an awkward place:
 *
 * - **What the engine allocates inside itself is the engine's, and it is now zero.** Every
 *   case below holds one entry point there. All four defects this file found were of this
 *   kind — a value the engine created and handed to one of its own helpers — and every
 *   one was fixable without touching a signature any game can see.
 * - **What a caller pays to hand the engine a number is the caller's, and no callee can
 *   remove it.** `tween.retarget(x)` costs sixteen bytes when `x` is a fraction the game
 *   just worked out and nothing when it is a small integer, and the difference is entirely
 *   in what the *call site* had to materialise. So every closure below hands the engine only
 *   shapes, flags, small integers and single constants: what is measured is then the
 *   engine's own work and nothing else. `sees what a caller pays to hand over a number`
 *   measures the excluded term so that it is written down rather than quietly left out.
 * - **A game's `update()` cannot be held at zero from here.** A large `update()` is its own
 *   compilation unit with its own inlining budget, and once that is spent every engine call
 *   it makes with a floating-point argument starts paying again. Measured while writing
 *   this: a plausible two-puck `update()` — input, a few collision tests, juice, an RNG draw
 *   — costs 64 bytes a step even though every engine call inside it is free on its own. So
 *   the second half of rule 5 is not covered by anything here, or anywhere: no game in this
 *   repository measures itself. Saying so is the point. A guard that quietly implied
 *   otherwise would be the eleventh entry in CLAUDE.md's list rather than a repair of one.
 *
 * ## The one cost that is the engine's shape rather than its code
 *
 * `LoopCallbacks` hands `update` a `fixedDeltaSeconds` and `render` an `alpha`, both
 * floating-point, every frame. A game whose callbacks are small enough to be inlined into
 * `advance` pays nothing for either, which is why `FixedLoop.advance` below reads zero — its
 * callbacks are three lines. A real game's `update` is nowhere near small enough, and then
 * both numbers have to be materialised to cross: measured on V8 26 with callbacks
 * deliberately past any inlining budget, **37 bytes a frame** with one such pair and **48**
 * with another. At 60 Hz that is two to three kilobytes a second, and it is the floor for
 * every game in this collection.
 *
 * It is not asserted here, and the two numbers above are why: the exact figure belongs to
 * the callback body as much as to the loop, so a ceiling on it would be a measurement of
 * whatever fixture this file happened to write. It is also not fixable from inside this
 * package — removing it means changing the contract so a game reads `loop.stepSeconds` and
 * an alpha rather than being handed them, which is 108 `Game` implementations and the SDK
 * between them. It is recorded rather than guarded, and recorded rather than left out.
 *
 * ## Why this measures what it claims to
 *
 * A benchmark that reports "no allocations" without being able to see one is worse than
 * nothing, so the first block below is the harness measuring four things it already knows
 * the answers to: an object per call, a single boxed double per call — the exact sixteen
 * bytes every defect this file found was made of — a closure that allocates nothing at all,
 * and the call-site cost the rest of the file deliberately holds out of its numbers. If the
 * harness ever stops seeing the ones it is supposed to see, those tests fail loudly rather
 * than the rest of the file passing vacuously.
 *
 * Three things had to be right before any number here meant anything, and each of them was
 * got wrong first:
 *
 * 1. **The measured closure must not return a value.** A closure ending in `=> tween.value`
 *    boxes that double on the way out, and the harness then reports the engine allocating
 *    sixteen bytes that the harness itself allocated. Every closure below writes into
 *    `SINK` and returns nothing.
 * 2. **The batch must be small enough that no scavenge fires inside it.** Young-generation
 *    garbage is collected without `used_heap_size` ever rising, so a batch large enough to
 *    trigger a collection reports a fraction of what it allocated: an early draft measured
 *    a known 40-byte allocation as 9 bytes at 200,000 iterations and as 40 at 10,000.
 * 3. **The closure must be warm.** Interpreted code allocates differently from optimised
 *    code, and it is the optimised code that runs in a match.
 *
 * ## The ceiling, and why it is not zero
 *
 * {@link ALLOCATION_FREE} is eight bytes a call rather than zero, for a reason that is
 * arithmetic rather than caution. `getHeapStatistics()` costs a few hundred bytes of its
 * own per sample, which at {@link ITERATIONS} iterations is a floor of about 0.06 bytes a
 * call — and the smallest thing this file exists to catch is one sixteen-byte number. Eight
 * is two hundred times the noise and half the smallest real defect, so it cannot be reached
 * by measurement error and cannot be passed by a single allocation. Asserting exact zero
 * would fail on the harness's own overhead; asserting sixteen would let one boxed double
 * through.
 */

/** Iterations per sample. Small enough that a scavenge never fires inside the window. */
const ITERATIONS = 10_000;

/** Samples per case; the median is reported, so one disturbed batch cannot decide a case. */
const SAMPLES = 9;

/** Iterations run before measuring, so what is measured is the optimised code. */
const WARMUP = 50_000;

/** Bytes per call at or above which a case is allocating. See the note above. */
const ALLOCATION_FREE = 8;

/** Set `DUELBOX_ALLOC_REPORT=1` to print every measured number rather than only failures. */
const REPORTING = process.env['DUELBOX_ALLOC_REPORT'] === '1';

/**
 * A collector, without needing the process to have been started with `--expose-gc`.
 *
 * Vitest hands its workers no extra node options and `vitest.config.ts` is shared with the
 * rest of the repository, so asking for a flag there would change how every other suite is
 * run for the sake of this one file. Turning the flag on for long enough to take a reference
 * to `gc` keeps the cost local. The new context is created once, at module load.
 */
function acquireCollector(): () => void {
  setFlagsFromString('--expose-gc');
  try {
    const collect: unknown = runInNewContext('gc');
    if (typeof collect !== 'function') {
      throw new TypeError('expected --expose-gc to define gc()');
    }
    return collect as () => void;
  } finally {
    setFlagsFromString('--no-expose-gc');
  }
}

const collect = acquireCollector();

/** Somewhere for a measured closure to put a number without returning it. See note 1. */
const SINK = new Float64Array(8);
/** The same for a boolean, so a predicate's result cannot be boxed on the way out either. */
const FLAGS = new Uint8Array(8);

/**
 * Bytes allocated per call of `run`, as the median of {@link SAMPLES} batches.
 *
 * The median rather than the minimum: a scavenge inside a window makes that window read low,
 * so the minimum is the sample most likely to be hiding something. It is also not the
 * maximum, which is the sample most likely to have caught an unrelated hiccup.
 */
function bytesPerCall(run: (i: number) => void): number {
  for (let i = 0; i < WARMUP; i += 1) run(i);
  const samples = new Float64Array(SAMPLES);
  for (let s = 0; s < SAMPLES; s += 1) {
    collect();
    collect();
    const before = getHeapStatistics().used_heap_size;
    for (let i = 0; i < ITERATIONS; i += 1) run(i);
    const after = getHeapStatistics().used_heap_size;
    samples[s] = (after - before) / ITERATIONS;
  }
  samples.sort();
  return samples[(SAMPLES - 1) >> 1]!; // invariant: SAMPLES is a positive odd number
}

/**
 * How many times a case may be measured before it is believed to allocate.
 *
 * One attempt is not enough, and the reason is not noise in the arithmetic — it is that
 * this file measures *optimised* code and cannot insist on being optimised. `WARMUP` asks
 * V8 to promote the closure, and promotion happens on a background thread; when the whole
 * suite runs, nine other workers are competing for the cores that thread needs, and a case
 * can still be running its unoptimised form when the samples are taken. Unoptimised code
 * really does allocate, so the measurement is right and the *condition* is wrong.
 *
 * Measured: `sweptCircleSegment` reads 0.000 B/call in isolation on three runs out of
 * three, and 51.366 under the full parallel suite on this ten-core machine. The other
 * forty-three cases were clean in both regimes, so a single ceiling could not tell the two
 * apart.
 *
 * A real allocation is reproducible and a starved thread is not, so the case is measured
 * again — with a fresh warm-up, which is the thing that was short — and the best attempt
 * decides. A genuinely allocating path returns about 16 bytes on every attempt and still
 * fails; the deliberate-allocation control below proves that, and it is why the retry is
 * not a way of wishing a failure away.
 */
const ATTEMPTS = 3;

/** Measure one case and hold it under the ceiling, naming the number when it fails. */
function expectAllocationFree(name: string, run: (i: number) => void): void {
  let bytes = bytesPerCall(run);
  for (let attempt = 1; attempt < ATTEMPTS && bytes >= ALLOCATION_FREE; attempt += 1) {
    bytes = Math.min(bytes, bytesPerCall(run));
  }
  if (REPORTING) {
    console.warn(`${name.padEnd(46)} ${bytes.toFixed(3).padStart(9)} B/call`);
  }
  expect(
    bytes,
    `${name} allocated ${bytes.toFixed(3)} bytes per call; the ceiling is ${String(ALLOCATION_FREE)}. ` +
      'A number near 16 is one boxed double: something on this path is handing a ' +
      'floating-point value to a call the optimiser will not inline.',
  ).toBeLessThan(ALLOCATION_FREE);
}

const LOGICAL: LogicalSize = { width: 900, height: 1600 };

describe('the harness can see an allocation', () => {
  it('has a collector', () => {
    expect(typeof collect).toBe('function');
  });

  it('sees an object allocated on every call', () => {
    const held: { value: Vec2 | null } = { value: null };
    const bytes = bytesPerCall((i) => {
      held.value = { x: i, y: i };
    });
    expect(held.value).not.toBeNull();
    // A two-field object measured 40 bytes while this was written. Asserting 24 leaves room
    // for a runtime that lays one out more tightly and still fails if the harness goes blind.
    expect(bytes).toBeGreaterThan(24);
  });

  it('sees a single boxed double on every call', () => {
    // The exact defect this file exists to catch, and every defect it has found is made of
    // it: one floating-point value materialised on the heap, sixteen bytes of it.
    //
    // A `Map` value forces one with no help from the optimiser. A map slot holds a tagged
    // value and nothing else, so a double put in one has to be boxed on the way in — which
    // is the same thing that happens to an argument crossing a call that was not inlined,
    // without this control having to guess what the optimiser will inline. The first draft
    // of it did guess, with a captured `let`, and read 0.07 bytes: the closure was small
    // enough that the variable never reached a context slot, so the control quietly proved
    // nothing while every test below it passed.
    const held = new Map<number, number>([[1, 0]]);
    const bytes = bytesPerCall((i) => {
      held.set(1, i * 0.5 + 0.25);
    });
    expect(held.get(1)).toBeGreaterThan(0);
    // 16 bytes when this was written. If it ever drops below the ceiling the harness has
    // gone blind to the only defect it has ever found, and that must fail rather than let
    // everything below pass vacuously.
    expect(bytes).toBeGreaterThanOrEqual(ALLOCATION_FREE * 1.5);
  });

  it('reads near zero for a closure that allocates nothing', () => {
    const bytes = bytesPerCall((i) => {
      SINK[0] = i * 0.5;
    });
    // The floor is `getHeapStatistics()` itself, about 0.06 bytes a call at this batch size.
    expect(bytes).toBeLessThan(1);
  });

  it('sees what a caller pays to hand over a number', () => {
    // The term every case below deliberately excludes, measured here so that excluding it is
    // a stated decision rather than a silence.
    //
    // The same method, the same tween, twice: once given a fraction the caller worked out,
    // once given a small integer. The fraction has to be materialised on the heap to cross
    // the call; the integer travels in the pointer itself and costs nothing. Neither number
    // is `retarget`'s to avoid — a callee cannot reach back and change how it was called —
    // so measuring `retarget` with a fraction would report the harness's own arithmetic as
    // an engine defect, which is exactly what the first draft of this file did.
    const eased = new Tween({ durationSeconds: 0.4 });
    const stepped = new Tween({ durationSeconds: 0.4 });
    const fractional = bytesPerCall((i) => {
      eased.retarget((i % 64) / 8);
    });
    const integral = bytesPerCall((i) => {
      stepped.retarget(i % 64);
    });
    // 14 and 0.06 when this was written.
    expect(fractional).toBeGreaterThanOrEqual(ALLOCATION_FREE * 1.5);
    expect(integral).toBeLessThan(ALLOCATION_FREE);
  });
});

describe('the fixed loop allocates nothing per frame', () => {
  it('advances with no callbacks of its own', () => {
    const loop = new FixedLoop({
      update() {
        FLAGS[0] = 1;
      },
      render(alpha: number) {
        SINK[0] = alpha;
      },
    });
    expectAllocationFree('FixedLoop.advance', () => {
      loop.advance(1 / 60);
    });
  });

  it('advances through a hitch that discards carried time', () => {
    const loop = new FixedLoop({
      update() {
        FLAGS[0] = 1;
      },
      render(alpha: number) {
        SINK[0] = alpha;
      },
    });
    expectAllocationFree('FixedLoop.advance over budget', () => {
      loop.advance(0.5);
    });
  });
});

describe('input sampling allocates nothing per step', () => {
  it('samples two idle seats', () => {
    const input = new InputManager(LOGICAL);
    expectAllocationFree('InputManager.beginStep idle', () => {
      input.beginStep(1 / 60);
    });
  });

  it('samples a seat holding a key and a pointer', () => {
    const input = new InputManager(LOGICAL);
    input.keyDown('KeyW');
    input.keyDown('KeyD');
    input.pointerDown(1, 100, 1200);
    input.keyDown('ArrowUp');
    input.pointerDown(2, 400, 200);
    expectAllocationFree('InputManager.beginStep held', () => {
      input.beginStep(1 / 60);
    });
  });

  it('tracks a dragging pointer', () => {
    const input = new InputManager(LOGICAL);
    input.pointerDown(1, 100, 1200);
    expectAllocationFree('InputManager pointerMove + beginStep', (i) => {
      input.pointerMove(1, 100 + (i % 64), 1200 - (i % 32));
      input.beginStep(1 / 60);
    });
  });

  it('presents the state as the view games read', () => {
    const input = new InputManager(LOGICAL);
    input.pointerDown(1, 100, 1200);
    const state = input.beginStep(1 / 60);
    const view = new InputView();
    expectAllocationFree('InputView.sync', () => {
      view.sync(state);
      const seat = view.seat('p1');
      SINK[0] = seat.move.x;
      SINK[1] = seat.pointer === null ? 0 : seat.pointer.y;
      FLAGS[0] = seat.actionHeld ? 1 : 0;
    });
  });
});

describe('vector maths allocates nothing', () => {
  const a = vec2(3.5, -1.25);
  const b = vec2(-0.5, 2.75);
  const out = vec2();
  const unit = vec2(0, 1);
  const pool = new Vec2Pool(8);

  it('writes into caller-owned vectors', () => {
    expectAllocationFree('vec2 write-into-out', (i) => {
      set(out, i * 0.5, i * 0.25);
      copy(out, a);
      add(out, a, b);
      sub(out, a, b);
      scale(out, out, 0.5);
      addScaled(out, a, b, 0.125);
      negate(out, out);
      normalise(out, out);
      perp(out, out);
      lerp(out, a, b, 0.5);
      rotate(out, out, 0.01);
      reflect(out, out, unit);
      SINK[0] = dot(a, b) + cross(a, b) + distanceSq(a, b);
    });
  });

  it('borrows and returns pooled scratch', () => {
    expectAllocationFree('Vec2Pool take/release', () => {
      pool.reset();
      const p = pool.take();
      const q = pool.take();
      add(p, a, b);
      sub(q, a, b);
      SINK[0] = p.x + q.y;
      pool.release(2);
    });
  });
});

describe('collision tests allocate nothing', () => {
  const contact = createContact();
  const circleA: Circle = { x: 1.5, y: 2.5, radius: 3 };
  const circleB: Circle = { x: 2.25, y: 2, radius: 1.5 };
  const boxA: Aabb = { minX: -5.5, minY: -5.25, maxX: 5.5, maxY: 5.25 };
  const boxB: Aabb = { minX: 0.5, minY: 0.5, maxX: 8.5, maxY: 8.5 };
  const obbA: Obb = { x: 0.25, y: -0.5, halfWidth: 2.5, halfHeight: 1.25, rotation: 0.3 };
  const obbB: Obb = { x: 1.5, y: 1.25, halfWidth: 1.5, halfHeight: 3.25, rotation: 1.1 };
  const segA: Segment = { x1: -4.5, y1: -4.25, x2: 4.5, y2: 4.25 };
  const segB: Segment = { x1: -4.5, y1: 4.25, x2: 4.5, y2: -4.25 };
  const point = vec2();

  /**
   * Every test in the module, each in its own closure with one call in it.
   *
   * One per closure on purpose. Six of these in one closure would measure the closure's
   * inlining budget rather than the engine, which is the trap the header describes — and it
   * is how `obbObb`'s 64 bytes were nearly written off as noise before they were isolated.
   */
  const cases: readonly (readonly [string, (i: number) => void])[] = [
    [
      'circleCircle',
      (i) => {
        circleA.x = (i % 128) / 8 - 8;
        FLAGS[0] = circleCircle(contact, circleA, circleB) ? 1 : 0;
      },
    ],
    [
      'circleAabb',
      (i) => {
        circleA.x = (i % 128) / 8 - 8;
        FLAGS[0] = circleAabb(contact, circleA, boxA) ? 1 : 0;
      },
    ],
    [
      'circleObb',
      (i) => {
        circleA.x = (i % 128) / 8 - 8;
        FLAGS[0] = circleObb(contact, circleA, obbA) ? 1 : 0;
      },
    ],
    [
      'circleSegment',
      (i) => {
        circleA.x = (i % 128) / 8 - 8;
        FLAGS[0] = circleSegment(contact, circleA, segA) ? 1 : 0;
      },
    ],
    [
      'aabbAabb',
      (i) => {
        boxA.minX = (i % 128) / 8 - 12;
        FLAGS[0] = aabbAabb(contact, boxA, boxB) ? 1 : 0;
      },
    ],
    [
      'aabbObb',
      (i) => {
        boxA.minX = (i % 128) / 8 - 12;
        FLAGS[0] = aabbObb(contact, boxA, obbB) ? 1 : 0;
      },
    ],
    [
      'obbObb',
      (i) => {
        obbA.rotation = (i % 128) / 64;
        FLAGS[0] = obbObb(contact, obbA, obbB) ? 1 : 0;
      },
    ],
    [
      'aabbSegment',
      (i) => {
        boxA.minX = (i % 128) / 8 - 12;
        FLAGS[0] = aabbSegment(contact, boxA, segA) ? 1 : 0;
      },
    ],
    [
      'obbSegment',
      (i) => {
        obbA.rotation = (i % 128) / 64;
        FLAGS[0] = obbSegment(contact, obbA, segA) ? 1 : 0;
      },
    ],
    [
      'segmentSegment',
      (i) => {
        segA.x1 = (i % 128) / 8 - 8;
        FLAGS[0] = segmentSegment(contact, segA, segB) ? 1 : 0;
      },
    ],
    [
      'sweptCircleCircle',
      (i) => {
        circleA.x = (i % 128) / 8 - 8;
        FLAGS[0] = sweptCircleCircle(contact, circleA, 0.5, 0.25, circleB) ? 1 : 0;
      },
    ],
    [
      'sweptCircleAabb',
      (i) => {
        circleA.x = (i % 128) / 8 - 8;
        FLAGS[0] = sweptCircleAabb(contact, circleA, 0.5, 0.25, boxA) ? 1 : 0;
      },
    ],
    [
      'sweptCircleSegment',
      (i) => {
        circleA.x = (i % 128) / 8 - 8;
        FLAGS[0] = sweptCircleSegment(contact, circleA, 0.5, 0.25, segA) ? 1 : 0;
      },
    ],
    [
      'closestPointOnSegment and the point tests',
      (i) => {
        closestPointOnSegment(point, (i % 128) / 8 - 8, 1.5, segA);
        FLAGS[0] = pointInAabb(point.x, point.y, boxA) ? 1 : 0;
        FLAGS[1] = pointInCircle(point.x, point.y, circleB) ? 1 : 0;
      },
    ],
  ];

  for (const [name, run] of cases) {
    it(name, () => {
      expectAllocationFree(`collision ${name}`, run);
    });
  }
});

describe('the per-step primitives allocate nothing', () => {
  it('steps and reads a tween', () => {
    const tween = new Tween({ durationSeconds: 0.4 });
    tween.restart(0, 1);
    expectAllocationFree('Tween.step', () => {
      tween.step(1 / 60);
      SINK[0] = tween.value;
    });
  });

  it('retargets a tween every step', () => {
    // A small integer target, so that what is measured is `retarget`'s own work: it re-reads
    // the eased value, restarts the run and re-derives `running`, all of which is the
    // engine's. The sixteen bytes a *fractional* target costs are spent by the caller before
    // `retarget` is entered at all, and `sees what a caller pays to hand over a number`
    // above is where that is measured and attributed.
    const tween = new Tween({ durationSeconds: 0.4 });
    expectAllocationFree('Tween.retarget', (i) => {
      tween.retarget(i % 64);
    });
  });

  it('steps and reads a seat flip', () => {
    const flip = new SeatFlip();
    expectAllocationFree('SeatFlip.step', (i) => {
      if (i % 64 === 0) flip.retarget(i % 128 === 0);
      flip.step(1 / 60);
      SINK[0] = flip.angle;
      SINK[1] = flip.progress;
      FLAGS[0] = flip.acceptsInput ? 1 : 0;
    });
  });

  it('steps and reads a running impact', () => {
    const impact = new Impact();
    impact.strike(0.02, 1e9);
    const motion = { reducedMotion: false };
    expectAllocationFree('Impact.step running', () => {
      impact.step(1 / 60);
      SINK[0] = impact.shake.offsetX;
      SINK[1] = impact.shake.offsetY;
      SINK[2] = impact.shake.intensity;
      SINK[3] = impact.flash.levelFor(motion);
      FLAGS[0] = impact.hitStop.holdingFor(motion) ? 1 : 0;
    });
  });

  it('raises an impact on every call', () => {
    // A strike is an event rather than a frame, but a rally raises one most frames, so it is
    // held to the same ceiling as anything else on the step path.
    const impact = new Impact();
    expectAllocationFree('Impact.strike', () => {
      impact.strike(0.02, 0.2);
      impact.step(1 / 60);
    });
  });

  it('steps a grid cursor', () => {
    const cursor = new GridCursor({ columns: 8, rows: 8 });
    expectAllocationFree('GridCursor.step', (i) => {
      cursor.step(i % 7 === 0 ? 1 : 0, i % 11 === 0 ? -1 : 0, 1 / 60, i % 2 === 0);
      SINK[0] = cursor.index;
    });
  });

  it('draws a float from the seeded generator', () => {
    const rng = new Rng(20260907);
    expectAllocationFree('Rng.float', () => {
      SINK[0] = rng.float();
    });
  });

  it('draws an integer', () => {
    const rng = new Rng(20260907);
    expectAllocationFree('Rng.int', () => {
      SINK[0] = rng.int(0, 1000);
    });
  });

  it('draws a boolean', () => {
    // Its own case rather than sharing one with `int` and `pick`. The three together measured
    // 8 bytes a call while each measured nothing alone, which is the caller's budget running
    // out inside the measuring closure and not one of the three allocating — the same effect
    // the header describes, seen from the harness's side. One entry point per case is what
    // keeps a number here attributable to the thing it names.
    const rng = new Rng(20260907);
    expectAllocationFree('Rng.bool', () => {
      FLAGS[0] = rng.bool(0.5) ? 1 : 0;
    });
  });

  it('picks an element', () => {
    const rng = new Rng(20260907);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expectAllocationFree('Rng.pick', () => {
      SINK[0] = rng.pick(items);
    });
  });

  it('shuffles in place', () => {
    const rng = new Rng(20260907);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expectAllocationFree('Rng.shuffle', () => {
      rng.shuffle(items);
    });
  });
});

describe('seat and viewport mapping allocates nothing', () => {
  const out = vec2();
  const view: Viewport = fitViewport(LOGICAL, 1200, 1800);

  it('maps a pointer into a seat frame', () => {
    expectAllocationFree('seatRotated + toWorld/toScreen', (i) => {
      const rotated = seatRotated('p2', 'shared-screen', 'p1');
      toWorld(out, i % 900, i % 1600, LOGICAL, rotated);
      toScreen(out, out.x, out.y, LOGICAL, rotated);
      FLAGS[0] = seatForPoint(out.x, out.y, LOGICAL, 'horizontal', 'p1') === 'p1' ? 1 : 0;
    });
  });

  it('maps between the screen and the logical box', () => {
    expectAllocationFree('viewportToLogical/logicalToViewport', (i) => {
      viewportToLogical(out, i % 1200, i % 1800, view);
      logicalToViewport(out, out.x, out.y, view);
    });
  });
});

/** Records nothing and measures nothing; a renderer needs a context and this is the cheapest. */
class NullContext implements Canvas2DLike {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  lineWidth = 1;
  font = '';
  textAlign: CanvasTextAlign = 'left';
  textBaseline: CanvasTextBaseline = 'alphabetic';

  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  rect(): void {}
  fill(): void {}
  stroke(): void {}
  fillRect(): void {}
  fillText(): void {}
  measureText(): { readonly width: number } {
    return WIDTH;
  }
  clearRect(): void {}
  clip(): void {}
}

/** Returned by every `measureText`, so the fake context allocates nothing of its own. */
const WIDTH = Object.freeze({ width: 7 });

describe('drawing allocates nothing per frame', () => {
  const renderer = new Canvas2DRenderer(new NullContext(), LOGICAL);
  renderer.setViewport(fitViewport(LOGICAL, 1200, 1800));

  it('opens, draws each shape and closes a frame', () => {
    expectAllocationFree('Canvas2DRenderer.rect/circle/line', (i) => {
      renderer.beginFrame();
      renderer.clear('#101014');
      renderer.rect(10, 20, 30 + (i % 8), 40, '#ff5a4e');
      renderer.strokeRect(10, 20, 30, 40, 2, '#21b0e8');
      renderer.circle(450, 800 + (i % 8), 24, '#ff5a4e');
      renderer.strokeCircle(450, 800, 24, 2, '#21b0e8');
      renderer.line(0, 0, 900 - (i % 8), 1600, 3, '#ffffff');
      renderer.endFrame();
    });
  });

  it('turns the board for the far seat', () => {
    expectAllocationFree('Canvas2DRenderer.pushSeatRotation', (i) => {
      renderer.beginFrame();
      renderer.pushSeatRotation(i % 2 === 0);
      renderer.popSeatRotation();
      renderer.endFrame();
    });
  });

  it('turns the board part of the way through a flip', () => {
    // One off-axis angle, held constant: the branch under test is the tuck-in scale, which
    // depends on the angle being off a resting one and not on which off-axis angle it is.
    // Sweeping the angle would hand the renderer a fresh fraction every call and measure the
    // closure's own materialisation of it rather than anything `pushRotation` does.
    expectAllocationFree('Canvas2DRenderer.pushRotation', () => {
      renderer.beginFrame();
      renderer.pushRotation(Math.PI / 3);
      renderer.popSeatRotation();
      renderer.endFrame();
    });
  });

  it('shakes the play area', () => {
    expectAllocationFree('Canvas2DRenderer.pushShake', () => {
      renderer.beginFrame();
      renderer.pushShake(0.5, -0.25);
      renderer.popShake();
      renderer.endFrame();
    });
  });

  it('draws text at a size it has already seen', () => {
    // A size the font cache has not seen builds one string and keeps it. An animated size
    // would defeat the cache, which is what `Canvas2DRenderer.#fonts` says in as many words;
    // this holds the case the HUD actually draws.
    expectAllocationFree('Canvas2DRenderer.text', (i) => {
      renderer.beginFrame();
      renderer.text(i % 2 === 0 ? '11' : '12', 450, 60, 40, '#ffffff', 'centre');
      renderer.endFrame();
    });
  });
});

/** A decoded buffer, without a Web Audio implementation anywhere near it. */
const BUFFER: AudioBufferLike = Object.freeze({
  duration: 0.2,
  sampleRate: 48_000,
  length: 9_600,
  numberOfChannels: 1,
});

describe('asking for a sound allocates nothing per step', () => {
  const audio = new AudioSystem({
    target: null,
    createContext: (): AudioContextLike => {
      throw new Error('this runtime has no Web Audio, which is what is being measured');
    },
  });
  audio.register('hit', BUFFER, 0.8);

  it('queues a cue from inside a step and drains it in the frame', () => {
    expectAllocationFree('AudioSystem.play + flush', (i) => {
      FLAGS[0] = audio.play('hit', 0.9, 1) ? 1 : 0;
      if (i % 4 === 3) audio.flush();
    });
  });

  it('queues a pitch-varied cue', () => {
    const rng = new Rng(7);
    expectAllocationFree('AudioSystem.playVaried', () => {
      FLAGS[0] = audio.playVaried('hit', rng) ? 1 : 0;
      audio.flush();
    });
  });
});

const MATCH: MatchConfig = {
  game: 'allocation-probe',
  seed: 20260907,
  logical: LOGICAL,
  stepsPerSecond: 60,
  inputDelaySteps: 4,
};

describe('a lockstep session allocates nothing per step', () => {
  it('passes a local match straight through', () => {
    const session = new LockstepSession(new InputManager(LOGICAL), {
      localSeat: 'p1',
      config: MATCH,
    });
    expectAllocationFree('LockstepSession.beginStep local', () => {
      FLAGS[0] = session.beginStep(1 / 60) === null ? 0 : 1;
    });
  });

  it('runs two devices against each other, checksums and all', () => {
    const [here, there] = loopbackPair();
    // Well past anything a batch can reach: a stall limit hit mid-measurement would end the
    // match and the rest of the samples would be measuring a session that had stopped.
    const stallLimitSteps = 100_000_000;
    const p1 = new LockstepSession(new InputManager(LOGICAL), {
      localSeat: 'p1',
      config: MATCH,
      transport: here,
      stallLimitSteps,
    });
    const p2 = new LockstepSession(new InputManager(LOGICAL), {
      localSeat: 'p2',
      config: MATCH,
      transport: there,
      stallLimitSteps,
    });
    expectAllocationFree('LockstepSession.beginStep remote pair', (i) => {
      p1.mix(i);
      p2.mix(i);
      FLAGS[0] = p1.beginStep(1 / 60) === null ? 0 : 1;
      FLAGS[1] = p2.beginStep(1 / 60) === null ? 0 : 1;
    });
    // The pair has to still be playing, or the numbers above are a measurement of two
    // sessions returning null.
    expect(p1.status).toBe('running');
    expect(p2.status).toBe('running');
    expect(p1.step).toBeGreaterThan(WARMUP);
  });
});
