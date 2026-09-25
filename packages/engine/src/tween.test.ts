import { describe, expect, it } from 'vitest';
import { SeatFlip } from './flip.js';
import {
  MOTION,
  REDUCED_MOTION_SECONDS,
  cubicBezier,
  motionDuration,
  standardEase,
} from './motion.js';
import {
  easeInCubic,
  easeInOutCubic,
  easeInOutQuad,
  easeInQuad,
  easeOutBack,
  easeOutCubic,
  easeOutQuad,
  linear,
  smootherstep,
  smoothstep,
  Tween,
} from './tween.js';
import type { Easing } from './tween.js';

const STEP = 1 / 60;

/** Every curve that is meant to be monotone and land on both ends. `easeOutBack` is not. */
const MONOTONE: readonly (readonly [string, Easing])[] = [
  ['linear', linear],
  ['smoothstep', smoothstep],
  ['smootherstep', smootherstep],
  ['easeInQuad', easeInQuad],
  ['easeOutQuad', easeOutQuad],
  ['easeInOutQuad', easeInOutQuad],
  ['easeInCubic', easeInCubic],
  ['easeOutCubic', easeOutCubic],
  ['easeInOutCubic', easeInOutCubic],
  ['standardEase', standardEase],
];

/** Steps until settled, collecting the value seen after each step. */
function run(tween: Tween, steps = 240): number[] {
  const values: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    tween.step(STEP);
    values.push(tween.value);
    if (tween.settled) break;
  }
  return values;
}

describe('the curves at their ends', () => {
  it('every curve, including the one that overshoots, is exactly 0 at 0 and 1 at 1', () => {
    // Exactly, not approximately. A curve that answers 0.9999999999 at 1 leaves a tween
    // resting a hair off its destination, and a board that never quite squares up is a bug
    // a player sees and nobody can name.
    for (const [name, ease] of [...MONOTONE, ['easeOutBack', easeOutBack] as const]) {
      expect(ease(0), `${name} at 0`).toBe(0);
      expect(ease(1), `${name} at 1`).toBe(1);
    }
  });

  it('each curve sits where its shape says at the midpoint', () => {
    expect(linear(0.5)).toBe(0.5);
    // Symmetric curves are exactly half way at half way; that is what makes them symmetric.
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smootherstep(0.5)).toBe(0.5);
    expect(easeInOutQuad(0.5)).toBe(0.5);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    // The one-sided ones are behind or ahead by exactly their power.
    expect(easeInQuad(0.5)).toBe(0.25);
    expect(easeOutQuad(0.5)).toBe(0.75);
    expect(easeInCubic(0.5)).toBe(0.125);
    expect(easeOutCubic(0.5)).toBe(0.875);
  });

  it('never runs backwards between the ends', () => {
    for (const [name, ease] of MONOTONE) {
      let previous = ease(0);
      for (let i = 1; i <= 100; i += 1) {
        const value = ease(i / 100);
        expect(value, `${name} at ${String(i / 100)}`).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('leaves the unit interval only where it says it does', () => {
    for (const [name, ease] of MONOTONE) {
      for (let i = 0; i <= 100; i += 1) {
        const value = ease(i / 100);
        expect(value, `${name} at ${String(i / 100)}`).toBeGreaterThanOrEqual(0);
        expect(value, `${name} at ${String(i / 100)}`).toBeLessThanOrEqual(1);
      }
    }
    // easeOutBack is the exception the type deliberately allows: it runs past the
    // destination and settles back onto it, which is why Tween does not clamp its output.
    let peak = 0;
    for (let i = 0; i <= 100; i += 1) peak = Math.max(peak, easeOutBack(i / 100));
    expect(peak).toBeGreaterThan(1);
    expect(easeOutBack(1)).toBe(1);
  });

  it('starts and stops dead only where it is meant to', () => {
    // The property smootherstep exists for: it leaves the start slower than smoothstep and
    // arrives slower, so a half-turn has no kick at either end.
    expect(smootherstep(0.05)).toBeLessThan(smoothstep(0.05));
    expect(smootherstep(0.95)).toBeGreaterThan(smoothstep(0.95));
    // Linear has a corner at both ends, which is the whole difference.
    expect(linear(0.05)).toBeGreaterThan(smoothstep(0.05));
  });
});

describe('a run from one value to another', () => {
  it('arrives exactly on the destination and stops there', () => {
    const tween = new Tween({ durationSeconds: 0.5 });
    tween.restart(10, 40);
    expect(tween.running).toBe(true);
    const values = run(tween);
    expect(tween.settled).toBe(true);
    expect(tween.value).toBe(40);
    expect(tween.to).toBe(40);
    expect(values[0]).toBeGreaterThan(10);
    // And stays there when stepped on.
    for (let i = 0; i < 10; i += 1) tween.step(STEP);
    expect(tween.value).toBe(40);
  });

  it('takes the duration it was built with', () => {
    const tween = new Tween({ durationSeconds: 0.5 });
    tween.restart(0, 1);
    let steps = 0;
    while (tween.running && steps < 1000) {
      tween.step(STEP);
      steps += 1;
    }
    expect(steps * STEP).toBeCloseTo(0.5, 1);
  });

  it('reports linear progress, not eased progress', () => {
    const tween = new Tween({ durationSeconds: 1, easing: easeInCubic });
    tween.restart(0, 1);
    tween.step(0.5);
    expect(tween.progress).toBeCloseTo(0.5, 12);
    expect(tween.value).toBeCloseTo(0.125, 12);
  });

  it('settles on the spot at a zero duration, and when it is already there', () => {
    const instant = new Tween({ durationSeconds: 0 });
    instant.restart(0, 5);
    expect(instant.settled).toBe(true);
    expect(instant.value).toBe(5);

    const nowhere = new Tween();
    nowhere.restart(3, 3);
    expect(nowhere.settled).toBe(true);
    expect(nowhere.value).toBe(3);
  });

  it('ignores a retarget at the destination it already holds', () => {
    // The mistake this exists to prevent: retarget() called every step from update() would
    // otherwise restart the run sixty times a second and pin the value to its first sample.
    const tween = new Tween({ durationSeconds: 0.5 });
    tween.restart(0, 1);
    for (let i = 0; i < 5; i += 1) {
      tween.retarget(1);
      tween.step(STEP);
    }
    expect(tween.progress).toBeCloseTo(5 * STEP * 2, 10);
    expect(tween.value).toBeGreaterThan(0);
  });

  it('re-aims from where it is, never from where it started', () => {
    const tween = new Tween({ durationSeconds: 0.5, easing: linear });
    tween.restart(0, 10);
    tween.step(0.25);
    const halfway = tween.value;
    expect(halfway).toBeCloseTo(5, 10);
    tween.retarget(0);
    expect(tween.from).toBeCloseTo(5, 10);
    expect(tween.to).toBe(0);
    run(tween);
    expect(tween.value).toBe(0);
  });

  it('snaps out of a running tween with no step in between', () => {
    const tween = new Tween({ durationSeconds: 0.5 });
    tween.restart(0, 10);
    tween.step(STEP);
    tween.snap(2);
    expect(tween.settled).toBe(true);
    expect(tween.value).toBe(2);
    expect(tween.from).toBe(2);
  });

  it('cancels mid-flight onto the value it was reading, and stays there', () => {
    // #113's acceptance line, and the whole of what "a consistent state" can mean here:
    // every field agrees on the number the tween was showing when it was stopped, and the
    // steps that follow move nothing.
    const tween = new Tween({ durationSeconds: 0.5, easing: linear });
    tween.restart(0, 10);
    tween.step(0.25);
    const caught = tween.value;
    expect(caught).toBeCloseTo(5, 10);

    tween.cancel();
    expect(tween.settled).toBe(true);
    expect(tween.running).toBe(false);
    expect(tween.value).toBe(caught);
    expect(tween.from).toBe(caught);
    expect(tween.to).toBe(caught);
    expect(tween.progress).toBe(1);

    // Safe to go on stepping it: a cancelled tween is one a game may keep in its update
    // loop without branching on whether it cancelled it.
    for (let i = 0; i < 60; i += 1) tween.step(STEP);
    expect(tween.value).toBe(caught);

    // And it is not a dead object: the next event restarts it from where it stands.
    tween.retarget(0);
    expect(tween.from).toBe(caught);
    expect(tween.running).toBe(true);
    run(tween);
    expect(tween.value).toBe(0);
  });

  it('cancels a settled tween without moving it, and cancels twice safely', () => {
    const tween = new Tween({ durationSeconds: 0.5, value: 3 });
    tween.cancel();
    expect(tween.value).toBe(3);
    tween.restart(3, 9);
    tween.step(0.5);
    expect(tween.settled).toBe(true);
    tween.cancel();
    tween.cancel();
    expect(tween.value).toBe(9);
    expect(tween.to).toBe(9);
  });

  it('rejects the values that would make a run meaningless', () => {
    expect(() => new Tween({ durationSeconds: -1 })).toThrow(RangeError);
    expect(() => new Tween({ value: Number.NaN })).toThrow(RangeError);
    const tween = new Tween();
    expect(() => {
      tween.restart(0, Number.POSITIVE_INFINITY);
    }).toThrow(RangeError);
    expect(() => {
      tween.step(-STEP);
    }).toThrow(RangeError);
  });
});

describe('determinism', () => {
  it('two tweens given the same steps read the same values', () => {
    const a = new Tween({ durationSeconds: 0.4, easing: smootherstep });
    const b = new Tween({ durationSeconds: 0.4, easing: smootherstep });
    a.restart(-3, 7.5);
    b.restart(-3, 7.5);
    expect(run(a)).toEqual(run(b));
  });

  it('does not read a clock: the same total time in different step sizes agrees', () => {
    const coarse = new Tween({ durationSeconds: 1 });
    coarse.restart(0, 100);
    coarse.step(0.5);

    const fine = new Tween({ durationSeconds: 1 });
    fine.restart(0, 100);
    for (let i = 0; i < 50; i += 1) fine.step(0.01);

    expect(fine.value).toBeCloseTo(coarse.value, 10);
  });

  it('cannot be told about the device while it is stepping', () => {
    // The invariant the whole design rests on, asserted rather than described. `step` takes
    // one argument and there is no setter for the preference, so nothing a device asked for
    // can change how many steps a value takes to arrive — which is rule 8, and with it every
    // replay and lockstep trace.
    expect(Tween.prototype.step.length).toBe(1);
    expect('setReducedMotion' in Tween.prototype).toBe(false);
    expect('reducedMotion' in Tween.prototype).toBe(false);

    const full = new Tween({ durationSeconds: 0.4 });
    const reduced = new Tween({ durationSeconds: 0.4 });
    full.restart(0, 1);
    reduced.restart(0, 1);
    let fullSteps = 0;
    let reducedSteps = 0;
    while (full.running) {
      full.step(STEP);
      fullSteps += 1;
    }
    while (reduced.running) {
      // The only difference between the two: this one is read the way a device with the
      // preference set reads it. It must not change when it settles.
      reduced.valueFor({ reducedMotion: true });
      reduced.step(STEP);
      reducedSteps += 1;
    }
    expect(reducedSteps).toBe(fullSteps);
  });
});

describe('reduced motion', () => {
  it('hands back the destination from the first step of a run', () => {
    const tween = new Tween({ durationSeconds: 0.5 });
    tween.restart(0, 12);
    const reduced = { reducedMotion: true };
    expect(tween.valueFor(reduced)).toBe(12);
    tween.step(STEP);
    expect(tween.valueFor(reduced)).toBe(12);
    expect(tween.value).toBeLessThan(12);
    expect(tween.value).toBeGreaterThan(0);
  });

  it('sweeps for a device that has not asked, and for one that cannot be asked', () => {
    // The negative control, and the absent case. A test double that has never heard of the
    // preference is an object with no such field, and it must read as full motion rather
    // than as a cut — which is what makes the member optional on Renderer safe.
    const tween = new Tween({ durationSeconds: 0.5 });
    tween.restart(0, 12);
    tween.step(STEP);
    expect(tween.valueFor({ reducedMotion: false })).toBe(tween.value);
    expect(tween.valueFor({})).toBe(tween.value);
    expect(tween.valueFor({})).toBeLessThan(12);
  });

  it('follows the preference changing under it, in both directions', () => {
    // A game is handed its context once and cannot be told again, which is why this is read
    // per frame from something live rather than captured. Reading it twice with different
    // answers must give two different pictures of the same tween.
    const tween = new Tween({ durationSeconds: 0.5 });
    tween.restart(0, 12);
    tween.step(0.1);
    expect(tween.valueFor({ reducedMotion: true })).toBe(12);
    expect(tween.valueFor({ reducedMotion: false })).toBeLessThan(12);
    expect(tween.valueFor({ reducedMotion: true })).toBe(12);
  });
});

describe('SeatFlip is expressible in this', () => {
  it('reproduces the half turn angle for angle, step for step', () => {
    // The claim that justifies calling this a generalisation rather than a second way of
    // doing the same thing. If the library could not express the one tween this engine
    // already had, it would be the wrong library.
    const flip = new SeatFlip();
    const tween = new Tween({ durationSeconds: 0.36, easing: smootherstep });
    flip.retarget(true);
    tween.restart(0, Math.PI);

    const flipAngles: number[] = [];
    const tweenValues: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      flip.step(STEP);
      tween.step(STEP);
      flipAngles.push(flip.angle);
      tweenValues.push(tween.value);
    }
    expect(tweenValues).toEqual(flipAngles);
  });

  it('is not adopted there, and the reason is in flip.ts', () => {
    // Written down so the next reader does not helpfully finish the job. A flip's duration
    // is a simulation value: forty-two of the forty-five games that own one gate `update()`
    // on `acceptsInput`, which is false for exactly as long as the flip runs. Rewriting that
    // class in terms of this one buys nothing a player can see and puts the step on which
    // input reopens in forty-two games behind a refactor. The two agreeing exactly, as the
    // test above shows they do, is the whole of what was wanted.
    const flip = new SeatFlip();
    expect('valueFor' in flip).toBe(false);
  });
});

describe('allocation discipline', () => {
  it('calls the very easing it was handed, never a wrapper built round it', () => {
    // Rule 5 on the hot path. A library that closed over `from` and `to` would build one
    // closure per run at best and one per step at worst; this one calls the function
    // pointer it was given, so a tween in flight allocates nothing at all.
    let calls = 0;
    const counted: Easing = (t) => {
      calls += 1;
      return t;
    };
    const tween = new Tween({ durationSeconds: 0.5, easing: counted });
    tween.restart(0, 1);
    tween.step(STEP);
    const before = calls;
    expect(tween.value).toBeGreaterThan(0);
    expect(calls).toBe(before + 1);
  });

  it('takes positional numbers everywhere an options bag could have gone', () => {
    // The same guard `AudioSystem.play` carries: an options object on a per-event call site
    // allocates at every event, and the only way to be sure none can appear is for the
    // signature not to have room for one. The constructor is the one place a bag is read,
    // and it runs once.
    expect(Tween.prototype.restart.length).toBe(2);
    expect(Tween.prototype.retarget.length).toBe(1);
    expect(Tween.prototype.snap.length).toBe(1);
    expect(Tween.prototype.step.length).toBe(1);
  });

  it('lets nothing but numbers across its boundary', () => {
    // Everything a caller can read is a primitive, so nothing built inside a step can be
    // retained by the caller — which is what makes "allocates nothing per step" checkable at
    // all here. A heap measurement was tried first and is not a guard: three million
    // iterations of a deliberately allocating loop measured a *smaller* heapUsed delta than
    // the same loop without the allocation, because the scavenger had already taken it and
    // escape analysis had removed some of it outright. A test that cannot fail on purpose is
    // not a test, so this one asserts the shape instead of the symptom.
    const tween = new Tween({ durationSeconds: 0.5 });
    tween.restart(0, 1);
    tween.step(STEP);
    expect(typeof tween.value).toBe('number');
    expect(typeof tween.valueFor({ reducedMotion: false })).toBe('number');
    expect(typeof tween.progress).toBe('number');
    expect(typeof tween.from).toBe('number');
    expect(typeof tween.to).toBe('number');
    expect(typeof tween.running).toBe('boolean');
    expect(typeof tween.settled).toBe('boolean');
    expect(tween.step(STEP)).toBeUndefined();
  });
});

describe('the motion signature, shared with the stylesheet (#72)', () => {
  it("runs for the product's standard duration when a tween states none", () => {
    // The tie between the two motion layers, at the one place a game can get it for free.
    // `--db-duration` and this are the same number, and `apps/web/src/styles/tokens.test.ts`
    // is what fails when they stop being.
    expect(new Tween().durationSeconds).toBe(MOTION.durationSeconds);
    expect(MOTION.durationSeconds).toBe(0.2);

    const tween = new Tween();
    tween.restart(0, 1);
    // 0.2 s is twelve steps at sixty — thirteen in floating point. Twelve accumulated
    // sixtieths come to 0.19999999999999998, one ULP short, and `step` compares the sum
    // against the duration rather than counting steps, so the run lasts one step longer than
    // the arithmetic says. Written out because it is the kind of off-by-one that gets
    // "fixed" by widening a comparison, which would end runs early on every duration.
    for (let i = 0; i < 12; i += 1) tween.step(STEP);
    expect(tween.settled).toBe(false);
    tween.step(STEP);
    expect(tween.settled).toBe(true);
  });

  it('states three durations and one curve, and lets none of them be rewritten', () => {
    expect(MOTION.durationFastSeconds).toBe(0.12);
    expect(MOTION.durationSlowSeconds).toBe(0.38);
    expect(MOTION.ease).toEqual([0.2, 0.8, 0.2, 1]);
    expect(Object.isFrozen(MOTION)).toBe(true);
    expect(Object.isFrozen(MOTION.ease)).toBe(true);
  });

  it('eases on the same four control points CSS is given', () => {
    for (let t = 0; t <= 1; t += 1 / 32) {
      expect(standardEase(t), `standardEase(${String(t)})`).toBe(
        cubicBezier(t, MOTION.ease[0], MOTION.ease[1], MOTION.ease[2], MOTION.ease[3]),
      );
    }
  });

  it('solves a bezier the way a browser does, checked against a symmetric one', () => {
    // `cubic-bezier(0.42, 0, 0.58, 1)` is CSS `ease-in-out`, whose control points are
    // symmetric about (0.5, 0.5) — so it is exactly a half at a half whatever the solver
    // does internally, and it is the one value here that is known independently of this
    // implementation. A solver that read `y(t)` instead of inverting `x` would pass this and
    // fail the asymmetric curve above, which is why both are here.
    expect(cubicBezier(0.5, 0.42, 0, 0.58, 1)).toBeCloseTo(0.5, 12);
    // The identity curve: control points on the diagonal are `linear`.
    for (let t = 0; t <= 1; t += 1 / 16) {
      expect(cubicBezier(t, 1 / 3, 1 / 3, 2 / 3, 2 / 3), `linear at ${String(t)}`).toBeCloseTo(
        t,
        9,
      );
    }
  });

  it('clamps outside [0, 1], where there is no progress to invert', () => {
    // The one curve here that does clamp its input, and the reason is in its docstring:
    // outside the range there is no `u` to solve for. `Tween` clamps before it calls.
    expect(standardEase(-1)).toBe(0);
    expect(standardEase(2)).toBe(1);
  });

  it('collapses a duration for reduced motion the way the cascade does', () => {
    expect(motionDuration(MOTION.durationSlowSeconds, false)).toBe(MOTION.durationSlowSeconds);
    expect(motionDuration(MOTION.durationSlowSeconds)).toBe(MOTION.durationSlowSeconds);
    expect(motionDuration(MOTION.durationSlowSeconds, true)).toBe(REDUCED_MOTION_SECONDS);
    // 1ms, the same number `tokens.css` collapses to, and not zero: see its docstring.
    expect(REDUCED_MOTION_SECONDS).toBe(0.001);
    expect(REDUCED_MOTION_SECONDS).toBeGreaterThan(0);
  });

  it('still answers reduced motion at draw time, which is the safe end', () => {
    // `motionDuration` is for a duration one device owns. Anything two devices step reaches
    // the preference through `valueFor`, which changes the picture and not the run — the
    // distinction `tween.ts` and `flip.ts` both set out, restated here because a table of
    // durations beside a reduced-motion helper is an invitation to shorten the wrong one.
    const tween = new Tween({ durationSeconds: MOTION.durationSeconds, easing: standardEase });
    tween.restart(0, 1);
    tween.step(STEP);
    expect(tween.valueFor({ reducedMotion: true })).toBe(1);
    expect(tween.valueFor({ reducedMotion: false })).toBeLessThan(1);
    expect(tween.durationSeconds).toBe(MOTION.durationSeconds);
  });
});
