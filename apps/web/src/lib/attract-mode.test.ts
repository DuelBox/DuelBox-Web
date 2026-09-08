import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_EVENTS,
  FRAME_DIVISOR,
  IDLE_MS,
  LOW_BATTERY_LEVEL,
  createIdleTimer,
  isLowBattery,
  nextAttractSeed,
  shouldAttract,
} from './attract-mode';

const quiet = {
  saveData: false,
  reducedData: false,
  reducedMotion: false,
  hidden: false,
  battery: null,
};

describe('when the catalogue may play itself', () => {
  it('may, when nothing has asked it not to', () => {
    expect(shouldAttract(quiet)).toBe(true);
  });

  it('never when the person asked for less data, either way they can ask', () => {
    expect(shouldAttract({ ...quiet, saveData: true })).toBe(false);
    expect(shouldAttract({ ...quiet, reducedData: true })).toBe(false);
  });

  it('never under reduced motion, because a match nobody asked for is motion nobody asked for', () => {
    expect(shouldAttract({ ...quiet, reducedMotion: true })).toBe(false);
  });

  it('never in a tab nobody is looking at', () => {
    expect(shouldAttract({ ...quiet, hidden: true })).toBe(false);
  });

  it('never on a low battery that is not charging', () => {
    expect(shouldAttract({ ...quiet, battery: { level: 0.1, charging: false } })).toBe(false);
    expect(
      shouldAttract({ ...quiet, battery: { level: LOW_BATTERY_LEVEL, charging: false } }),
    ).toBe(false);
  });

  it('may on a low battery that is charging, and on any battery above the floor', () => {
    expect(shouldAttract({ ...quiet, battery: { level: 0.1, charging: true } })).toBe(true);
    expect(shouldAttract({ ...quiet, battery: { level: 0.21, charging: false } })).toBe(true);
  });

  it('reads no battery API as "not low", which is what WebKit is', () => {
    expect(isLowBattery(null)).toBe(false);
  });
});

describe('the idle wait', () => {
  /** A hand-driven clock: `fire()` runs whatever is due; `cancel` forgets it. */
  function fakeClock() {
    const pending = new Map<number, () => void>();
    let next = 1;
    return {
      schedule: (callback: () => void) => {
        const handle = next;
        next += 1;
        pending.set(handle, callback);
        return handle;
      },
      cancel: (handle: unknown) => {
        pending.delete(handle as number);
      },
      fire: () => {
        for (const [handle, callback] of [...pending]) {
          pending.delete(handle);
          callback();
        }
      },
      live: () => pending.size,
    };
  }

  it('fires once after the wait, and not before it is touched', () => {
    const clock = fakeClock();
    let fired = 0;
    const timer = createIdleTimer(IDLE_MS, () => (fired += 1), clock);
    expect(clock.live()).toBe(0);
    timer.touch();
    expect(clock.live()).toBe(1);
    clock.fire();
    expect(fired).toBe(1);
    expect(clock.live()).toBe(0);
  });

  it('keeps one handle live however many times it is touched', () => {
    // A burst of pointer events is a burst of touches; it must not become a pile of timers
    // that all fire together when the burst ends.
    const clock = fakeClock();
    let fired = 0;
    const timer = createIdleTimer(IDLE_MS, () => (fired += 1), clock);
    for (let i = 0; i < 50; i += 1) timer.touch();
    expect(clock.live()).toBe(1);
    clock.fire();
    expect(fired).toBe(1);
  });

  it('cancels, and stays cancelled until the next touch', () => {
    const clock = fakeClock();
    let fired = 0;
    const timer = createIdleTimer(IDLE_MS, () => (fired += 1), clock);
    timer.touch();
    timer.cancel();
    clock.fire();
    expect(fired).toBe(0);
    timer.touch();
    clock.fire();
    expect(fired).toBe(1);
  });

  it('waits the number the issue names', () => {
    expect(IDLE_MS).toBe(20_000);
  });
});

describe('the rest of the rule', () => {
  it('listens for every way a person announces themselves', () => {
    for (const name of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart']) {
      expect(ACTIVITY_EVENTS).toContain(name);
    }
  });

  it('draws every other frame, which halves a 60 Hz display to 30', () => {
    expect(FRAME_DIVISOR).toBe(2);
  });

  it('moves the seed forward deterministically between rounds', () => {
    expect(nextAttractSeed(1)).toBe(2);
    expect(nextAttractSeed(nextAttractSeed(7))).toBe(9);
  });
});
