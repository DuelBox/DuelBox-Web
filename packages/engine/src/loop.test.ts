import { describe, expect, it } from 'vitest';
import { FixedLoop, RunLoop, browserClock, browserGamepadSource } from './loop.js';
import type { Clock, LoopCallbacks } from './loop.js';

class Recorder implements LoopCallbacks {
  updates = 0;
  renders = 0;
  lastFixedDelta = Number.NaN;
  lastAlpha = Number.NaN;
  readonly alphas: number[] = [];

  update(fixedDeltaSeconds: number): void {
    this.updates += 1;
    this.lastFixedDelta = fixedDeltaSeconds;
  }

  render(alpha: number): void {
    this.renders += 1;
    this.lastAlpha = alpha;
    this.alphas.push(alpha);
  }
}

/** Hand-rolled clock: no real time, one pending callback at a time (as rAF behaves). */
class FakeClock implements Clock {
  scheduleCalls = 0;
  cancelCalls = 0;
  #timeMs = 0;
  #nextHandle = 1;
  #pendingHandle = 0;
  #pending: ((timeMs: number) => void) | undefined = undefined;

  now(): number {
    return this.#timeMs;
  }

  schedule(callback: (timeMs: number) => void): number {
    this.scheduleCalls += 1;
    this.#pending = callback;
    this.#pendingHandle = this.#nextHandle;
    this.#nextHandle += 1;
    return this.#pendingHandle;
  }

  cancel(handle: number): void {
    this.cancelCalls += 1;
    if (handle === this.#pendingHandle) {
      this.#pending = undefined;
      this.#pendingHandle = 0;
    }
  }

  get hasPending(): boolean {
    return this.#pending !== undefined;
  }

  /** Move fake time forward and deliver the pending frame, if one is scheduled. */
  tick(deltaMs: number): void {
    this.#timeMs += deltaMs;
    const callback = this.#pending;
    this.#pending = undefined;
    this.#pendingHandle = 0;
    if (callback !== undefined) callback(this.#timeMs);
  }
}

describe('FixedLoop construction', () => {
  it('defaults to 60 steps per second', () => {
    const loop = new FixedLoop(new Recorder());
    expect(loop.stepSeconds).toBe(1 / 60);
    expect(loop.totalSteps).toBe(0);
  });

  it('honours a custom step rate', () => {
    const loop = new FixedLoop(new Recorder(), { stepsPerSecond: 120 });
    expect(loop.stepSeconds).toBe(1 / 120);
  });

  it('rejects step rates that are not positive finite numbers', () => {
    const callbacks = new Recorder();
    expect(() => new FixedLoop(callbacks, { stepsPerSecond: 0 })).toThrow(RangeError);
    expect(() => new FixedLoop(callbacks, { stepsPerSecond: -60 })).toThrow(RangeError);
    expect(() => new FixedLoop(callbacks, { stepsPerSecond: Number.NaN })).toThrow(RangeError);
    expect(() => new FixedLoop(callbacks, { stepsPerSecond: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });

  it('rejects step caps that are not positive finite numbers', () => {
    const callbacks = new Recorder();
    expect(() => new FixedLoop(callbacks, { maxStepsPerFrame: 0 })).toThrow(RangeError);
    expect(() => new FixedLoop(callbacks, { maxStepsPerFrame: -1 })).toThrow(RangeError);
    expect(() => new FixedLoop(callbacks, { maxStepsPerFrame: Number.NaN })).toThrow(RangeError);
    expect(() => new FixedLoop(callbacks, { maxStepsPerFrame: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
  });
});

describe('FixedLoop.advance stepping', () => {
  it('runs exactly one update for one step of delta', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder);

    loop.advance(1 / 60);

    expect(recorder.updates).toBe(1);
    expect(recorder.renders).toBe(1);
    expect(recorder.lastFixedDelta).toBe(loop.stepSeconds);
  });

  it('runs two updates for two steps of delta', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder);

    loop.advance(2 / 60);

    expect(recorder.updates).toBe(2);
    expect(recorder.renders).toBe(1);
  });

  it('runs no update below one step and accumulates the remainder across calls', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder);
    const fifth = loop.stepSeconds * 0.4;

    loop.advance(fifth);
    expect(recorder.updates).toBe(0);
    loop.advance(fifth);
    expect(recorder.updates).toBe(0);

    loop.advance(fifth);
    expect(recorder.updates).toBe(1);
    expect(recorder.renders).toBe(3);
    expect(recorder.lastAlpha).toBeCloseTo(0.2, 10);
  });

  it('always passes the fixed step to update(), never the frame delta', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder, { stepsPerSecond: 50 });

    loop.advance(0.037);

    expect(recorder.updates).toBe(1);
    expect(recorder.lastFixedDelta).toBe(0.02);
  });

  it('counts totalSteps across many frames and reset() clears state', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder);

    loop.advance(loop.stepSeconds * 3);
    loop.advance(loop.stepSeconds * 2);
    loop.advance(loop.stepSeconds * 0.5);
    expect(loop.totalSteps).toBe(5);
    expect(recorder.lastAlpha).toBeCloseTo(0.5, 10);

    loop.reset();
    expect(loop.totalSteps).toBe(0);

    // The carried 0.5 step must be gone: half a step now owes no update.
    loop.advance(loop.stepSeconds * 0.5);
    expect(loop.totalSteps).toBe(0);
    expect(recorder.lastAlpha).toBeCloseTo(0.5, 10);
  });
});

describe('FixedLoop.advance alpha', () => {
  it('is 0 immediately after an exact step boundary and rises towards 1 between steps', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder);

    loop.advance(loop.stepSeconds);
    expect(recorder.lastAlpha).toBe(0);

    loop.advance(loop.stepSeconds * 0.25);
    expect(recorder.lastAlpha).toBeCloseTo(0.25, 10);

    loop.advance(loop.stepSeconds * 0.5);
    expect(recorder.lastAlpha).toBeCloseTo(0.75, 10);

    // Crossing the next boundary drops alpha back down rather than reaching 1.
    loop.advance(loop.stepSeconds * 0.5);
    expect(recorder.lastAlpha).toBeCloseTo(0.25, 10);
    expect(loop.totalSteps).toBe(2);
  });

  it('stays within [0, 1) for every kind of frame delta', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder);
    const deltas = [
      0,
      1e-9,
      loop.stepSeconds * 0.999,
      loop.stepSeconds,
      loop.stepSeconds * 1.5,
      loop.stepSeconds * 4.75,
      0.25,
      10,
      1e9,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];

    for (const delta of deltas) {
      loop.advance(delta);
    }

    expect(recorder.alphas).toHaveLength(deltas.length);
    for (const alpha of recorder.alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });
});

describe('FixedLoop.advance bad deltas', () => {
  it('treats negative, NaN and Infinity deltas as zero', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder);

    loop.advance(-5);
    loop.advance(Number.NaN);
    loop.advance(Number.POSITIVE_INFINITY);
    loop.advance(Number.NEGATIVE_INFINITY);

    expect(recorder.updates).toBe(0);
    expect(recorder.renders).toBe(4);
    expect(recorder.lastAlpha).toBe(0);
  });

  it('leaves carried time untouched when a bad delta arrives', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder);

    loop.advance(loop.stepSeconds * 0.5);
    loop.advance(Number.NaN);
    expect(recorder.lastAlpha).toBeCloseTo(0.5, 10);
    expect(recorder.updates).toBe(0);

    loop.advance(loop.stepSeconds * 0.5);
    expect(recorder.updates).toBe(1);
  });
});

describe('FixedLoop.advance spiral-of-death guard', () => {
  it('caps updates in one frame at maxStepsPerFrame', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder, { maxStepsPerFrame: 5 });

    loop.advance(100);

    expect(recorder.updates).toBe(5);
    expect(recorder.renders).toBe(1);
    expect(loop.totalSteps).toBe(5);
    expect(recorder.lastAlpha).toBeGreaterThanOrEqual(0);
    expect(recorder.lastAlpha).toBeLessThan(1);
  });

  it('discards the unprocessed remainder so the next frame owes nothing extra', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder, { maxStepsPerFrame: 5 });

    loop.advance(100);
    expect(recorder.updates).toBe(5);

    // A zero-length frame after the hitch: no debt survived the cap.
    loop.advance(0);
    expect(recorder.updates).toBe(5);

    // And a normal frame owes exactly its own single step.
    loop.advance(loop.stepSeconds);
    expect(recorder.updates).toBe(6);

    loop.advance(loop.stepSeconds);
    expect(recorder.updates).toBe(7);
    expect(loop.totalSteps).toBe(7);
  });

  it('honours a custom cap', () => {
    const recorder = new Recorder();
    const loop = new FixedLoop(recorder, { maxStepsPerFrame: 2 });

    loop.advance(1);
    expect(recorder.updates).toBe(2);

    loop.advance(1);
    expect(recorder.updates).toBe(4);
  });
});

describe('RunLoop', () => {
  it('start/stop toggles running and is safe to repeat', () => {
    const clock = new FakeClock();
    const runner = new RunLoop(new FixedLoop(new Recorder()), clock);

    expect(runner.running).toBe(false);

    runner.stop();
    expect(runner.running).toBe(false);
    expect(clock.cancelCalls).toBe(0);

    runner.start();
    runner.start();
    expect(runner.running).toBe(true);
    expect(clock.scheduleCalls).toBe(1);

    runner.stop();
    runner.stop();
    expect(runner.running).toBe(false);
    expect(clock.cancelCalls).toBe(1);
    expect(clock.hasPending).toBe(false);
  });

  it('drives updates as the fake clock steps forward', () => {
    const recorder = new Recorder();
    const clock = new FakeClock();
    const runner = new RunLoop(new FixedLoop(recorder), clock);

    runner.start();

    // 17 ms per frame at a 16.667 ms step: ten frames are worth 10.2 steps.
    for (let frame = 0; frame < 10; frame += 1) {
      clock.tick(17);
    }

    expect(recorder.renders).toBe(10);
    expect(recorder.updates).toBe(10);
    expect(clock.hasPending).toBe(true);
  });

  it('renders without stepping when a frame is shorter than one step', () => {
    const recorder = new Recorder();
    const clock = new FakeClock();
    const runner = new RunLoop(new FixedLoop(recorder), clock);

    runner.start();
    clock.tick(10);

    expect(recorder.renders).toBe(1);
    expect(recorder.updates).toBe(0);
  });

  it('clamps a ten-second gap to 0.25 s of simulation rather than fast-forwarding', () => {
    const recorder = new Recorder();
    const clock = new FakeClock();
    // Cap raised well above the clamp so the 0.25 s ceiling is what binds here.
    const loop = new FixedLoop(recorder, { stepsPerSecond: 50, maxStepsPerFrame: 64 });
    const runner = new RunLoop(loop, clock);

    runner.start();
    clock.tick(10_000);

    expect(recorder.updates).toBe(12); // 0.25 s / 0.02 s, not 10 s / 0.02 s = 500
    expect(recorder.renders).toBe(1);
  });

  it('applies the step cap as well as the frame clamp on a long gap', () => {
    const recorder = new Recorder();
    const clock = new FakeClock();
    const runner = new RunLoop(new FixedLoop(recorder), clock);

    runner.start();
    clock.tick(10_000);

    expect(recorder.updates).toBe(5); // not 600
  });

  it('does not schedule another frame when a callback stops it', () => {
    const clock = new FakeClock();
    let updates = 0;
    const callbacks: LoopCallbacks = {
      update(): void {
        updates += 1;
        runner.stop();
      },
      render(): void {
        // presentation is irrelevant to this test
      },
    };
    const runner = new RunLoop(new FixedLoop(callbacks), clock);

    runner.start();
    clock.tick(100);

    expect(updates).toBe(1);
    expect(runner.running).toBe(false);
    expect(clock.hasPending).toBe(false);
  });

  it('ignores a stale frame delivered after stop()', () => {
    const recorder = new Recorder();
    const clock = new FakeClock();
    const runner = new RunLoop(new FixedLoop(recorder), clock);

    runner.start();
    clock.tick(20);
    expect(recorder.renders).toBe(1);

    runner.stop();
    clock.tick(1000);

    expect(recorder.renders).toBe(1);
  });
});

/**
 * Assist-mode speed (#179): the multiplier scales how much wall-clock time reaches the fixed
 * loop, and nothing about the simulation step itself.
 *
 * The property that makes this a legitimate assist rather than a different match is that the
 * step size never moves — every `update` is the identical `stepSeconds` it always was, so
 * the seeded RNG and the step order a game runs are byte-for-byte what they were at full
 * speed, just delivered over more wall-clock seconds. These check exactly that: the step
 * size is invariant, half speed runs half the steps for the same real time, render keeps
 * pace with frames rather than steps, and reaching a given step count is deterministic at
 * any speed.
 */
describe('RunLoop assist-mode time scaling', () => {
  it('defaults to full speed', () => {
    const runner = new RunLoop(new FixedLoop(new Recorder()), new FakeClock());
    expect(runner.timeScale).toBe(1);
  });

  it('runs half the steps at half speed over the same wall-clock time', () => {
    function run(scale: number): Recorder {
      const recorder = new Recorder();
      const clock = new FakeClock();
      const runner = new RunLoop(new FixedLoop(recorder), clock);
      runner.setTimeScale(scale);
      runner.start();
      // 30 frames of 16 ms of real time each.
      for (let i = 0; i < 30; i += 1) clock.tick(16);
      return recorder;
    }
    const full = run(1);
    const half = run(0.5);
    // Renders track frames in both, because rendering is never scaled.
    expect(full.renders).toBe(30);
    expect(half.renders).toBe(30);
    // Steps: 480 ms / 16.667 ≈ 28 at full speed; 240 ms / 16.667 ≈ 14 at half. The half run
    // is within one step of exactly half the full run's steps.
    expect(Math.abs(half.updates - full.updates / 2)).toBeLessThanOrEqual(1);
  });

  it('never changes the step size the simulation is handed, at any speed', () => {
    const deltas: number[] = [];
    const loop = new FixedLoop(
      {
        update(dt) {
          deltas.push(dt);
        },
        render() {
          /* not under test here */
        },
      },
      { stepsPerSecond: 60 },
    );
    const clock = new FakeClock();
    const runner = new RunLoop(loop, clock);
    runner.setTimeScale(0.25);
    runner.start();
    for (let i = 0; i < 40; i += 1) clock.tick(16);
    expect(deltas.length).toBeGreaterThan(0);
    // Every step is exactly one step of simulation time, quarter speed or not.
    for (const dt of deltas) expect(dt).toBeCloseTo(1 / 60, 12);
  });

  it('reaches a given step count deterministically regardless of speed', () => {
    // The same sequence of steps, only spread over more wall-clock time. Reaching 20 steps
    // at quarter speed takes four times the real time it takes at full speed, and produces
    // the identical run of step deltas.
    function stepsFor(scale: number, msPerFrame: number): number[] {
      const deltas: number[] = [];
      const loop = new FixedLoop(
        {
          update(dt: number) {
            deltas.push(dt);
          },
          render() {
            /* counted elsewhere */
          },
        },
        { stepsPerSecond: 60 },
      );
      const clock = new FakeClock();
      const runner = new RunLoop(loop, clock);
      runner.setTimeScale(scale);
      runner.start();
      while (deltas.length < 20) clock.tick(msPerFrame);
      return deltas.slice(0, 20);
    }
    expect(stepsFor(0.25, 16)).toEqual(stepsFor(1, 16));
  });

  it('ignores a scale that is not a positive finite number', () => {
    const runner = new RunLoop(new FixedLoop(new Recorder()), new FakeClock());
    runner.setTimeScale(0.5);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      runner.setTimeScale(bad);
      expect(runner.timeScale).toBe(0.5);
    }
  });

  it('can change speed mid-run without losing the steps already taken', () => {
    const recorder = new Recorder();
    const clock = new FakeClock();
    const runner = new RunLoop(new FixedLoop(recorder), clock);
    runner.start();
    for (let i = 0; i < 10; i += 1) clock.tick(16);
    const before = recorder.updates;
    runner.setTimeScale(0.5);
    for (let i = 0; i < 10; i += 1) clock.tick(16);
    // Steps kept accumulating from where they were, just more slowly after the change.
    expect(recorder.updates).toBeGreaterThan(before);
  });
});

describe('browserClock', () => {
  it('reports a clear error when requestAnimationFrame is unavailable', () => {
    const scope = globalThis as unknown as { requestAnimationFrame?: unknown };
    const original = scope.requestAnimationFrame;
    delete scope.requestAnimationFrame;
    try {
      expect(() => browserClock()).toThrow(/requestAnimationFrame/);
    } finally {
      if (original !== undefined) scope.requestAnimationFrame = original;
    }
  });
});

describe('browserGamepadSource', () => {
  /** A stand-in for `navigator.getGamepads`, returning a fresh array each call as the real one does. */
  function fakeNavigator(pads: () => (null | Record<string, unknown>)[]) {
    return { getGamepads: () => pads() };
  }

  function withNavigator<T>(nav: unknown, body: () => T): T {
    const scope = globalThis as { navigator?: unknown };
    const had = Object.prototype.hasOwnProperty.call(scope, 'navigator');
    const previous = scope.navigator;
    Object.defineProperty(scope, 'navigator', { value: nav, configurable: true, writable: true });
    try {
      return body();
    } finally {
      if (had)
        Object.defineProperty(scope, 'navigator', {
          value: previous,
          configurable: true,
          writable: true,
        });
      else delete scope.navigator;
    }
  }

  it('answers with nothing where the API is absent, rather than throwing', () => {
    const read = withNavigator(undefined, () => browserGamepadSource());
    expect(read()).toEqual([]);
  });

  it('presents the plain snapshot shape the manager consumes', () => {
    const nav = fakeNavigator(() => [
      null,
      {
        index: 1,
        id: 'Pad',
        connected: true,
        axes: [0.5, -0.25],
        buttons: [{ pressed: true }, { pressed: false }],
      },
    ]);
    const read = withNavigator(nav, () => browserGamepadSource());
    const pads = read();
    expect(pads[0]).toBeNull();
    expect(pads[1]).toEqual({
      index: 1,
      id: 'Pad',
      connected: true,
      axes: [0.5, -0.25],
      buttons: [true, false],
    });
  });

  it('reuses its snapshots and arrays across polls, so the step path allocates none of them (rule 5)', () => {
    // The platform's own array is fresh every call and outside the rule; everything this
    // adapter owns must not be. Identity across two polls is the whole assertion.
    let pressed = false;
    const nav = fakeNavigator(() => [
      { index: 0, id: 'Pad', connected: true, axes: [0.1, 0.2], buttons: [{ pressed }] },
    ]);
    const read = withNavigator(nav, () => browserGamepadSource());
    const first = read();
    const firstPad = first[0];
    const firstAxes = firstPad?.axes;
    const firstButtons = firstPad?.buttons;
    pressed = true;
    const second = read();
    expect(second).toBe(first);
    expect(second[0]).toBe(firstPad);
    expect(second[0]?.axes).toBe(firstAxes);
    expect(second[0]?.buttons).toBe(firstButtons);
    // And it is a *fresh reading*, not a stale one — reuse must not mean remembering.
    expect(second[0]?.buttons[0]).toBe(true);
  });

  it('forgets a pad that unplugs and shrinks to the slots the browser reports', () => {
    let pads: (null | Record<string, unknown>)[] = [
      { index: 0, id: 'A', connected: true, axes: [0, 0], buttons: [] },
      { index: 1, id: 'B', connected: true, axes: [0, 0], buttons: [] },
    ];
    const read = withNavigator(
      fakeNavigator(() => pads),
      () => browserGamepadSource(),
    );
    expect(read()).toHaveLength(2);
    pads = [null, { index: 1, id: 'B', connected: true, axes: [0, 0], buttons: [] }];
    const next = read();
    expect(next).toHaveLength(2);
    expect(next[0]).toBeNull();
    expect(next[1]?.id).toBe('B');
    pads = [];
    expect(read()).toHaveLength(0);
  });
});
