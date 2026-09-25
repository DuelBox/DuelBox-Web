import { describe, expect, it, vi } from 'vitest';
import { errorMessage, guard } from './guard.js';

describe('guard', () => {
  it('runs the callback and reports success when it does not throw', () => {
    const onError = vi.fn();
    let ran = false;
    const ok = guard(() => {
      ran = true;
    }, onError);
    expect(ran).toBe(true);
    expect(ok).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('catches a throw, reports it once, and returns false', () => {
    const onError = vi.fn();
    const boom = new Error('game update blew up');
    const ok = guard(() => {
      throw boom;
    }, onError);
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('stops a loop: a guarded step that throws returns the false the host acts on', () => {
    // The host steps only while the previous guard returned true. Model that: a game that
    // throws on its third step must be stepped exactly three times, not forever.
    let steps = 0;
    const onError = vi.fn();
    let running = true;
    for (let frame = 0; frame < 10 && running; frame += 1) {
      running = guard(() => {
        steps += 1;
        if (steps === 3) throw new Error('crash');
      }, onError);
    }
    expect(steps).toBe(3);
    expect(running).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('errorMessage', () => {
  it('uses an Error message when there is one', () => {
    expect(errorMessage(new Error('specific'))).toBe('specific');
  });

  it('uses a thrown string', () => {
    expect(errorMessage('nope')).toBe('nope');
  });

  it('falls back for a thrown object or an empty message', () => {
    expect(errorMessage({})).toBe('The game hit an unexpected error.');
    expect(errorMessage(new Error(''))).toBe('The game hit an unexpected error.');
    expect(errorMessage(undefined)).toBe('The game hit an unexpected error.');
  });
});
