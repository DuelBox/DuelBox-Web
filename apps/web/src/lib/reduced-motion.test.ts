import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, watchReducedMotion } from './reduced-motion';

/**
 * The unit suite runs in Node with no DOM, which is the same shape as the machine that
 * renders the static export — so "there is no `matchMedia` here" is not a contrivance for
 * the test, it is one of the three runtimes this module actually has to survive.
 *
 * `useReducedMotion` itself is not exercised here: there is no renderer in this
 * environment to mount a hook into. Its whole body is `prefersReducedMotion` plus
 * `watchReducedMotion`, both covered below, and `e2e/reduced-motion.spec.ts` is what
 * proves the preference reaches a real browser.
 */

type Listener = (event: { matches: boolean }) => void;

/** A media query that can be flipped, and that records who is listening to it. */
function fakeQuery(matches: boolean) {
  const listeners = new Set<Listener>();
  return {
    query: {
      get matches() {
        return matches;
      },
      addEventListener(_type: 'change', listener: Listener) {
        listeners.add(listener);
      },
      removeEventListener(_type: 'change', listener: Listener) {
        listeners.delete(listener);
      },
    },
    get listenerCount() {
      return listeners.size;
    },
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');

function install(value: unknown): void {
  Object.defineProperty(globalThis, 'matchMedia', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (original === undefined) delete (globalThis as { matchMedia?: unknown }).matchMedia;
  else Object.defineProperty(globalThis, 'matchMedia', original);
});

describe('reading the preference', () => {
  it('says no on a runtime that cannot be asked', () => {
    // Node during the static export, and this suite. The false is the honest answer: the
    // build machine has no preference, and guessing one would bake it into the HTML.
    expect(globalThis.matchMedia).toBeUndefined();
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reports what the device says, both ways', () => {
    install(() => fakeQuery(true).query);
    expect(prefersReducedMotion()).toBe(true);
    install(() => fakeQuery(false).query);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('asks the query the CSS asks', () => {
    // The stylesheet's reduced-motion block and this module have to be answering the same
    // question, or the canvas and the cascade disagree about the same player.
    const seen: string[] = [];
    install((query: string) => {
      seen.push(query);
      return fakeQuery(true).query;
    });
    prefersReducedMotion();
    expect(seen).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  it('says no rather than throwing when the engine rejects the query', () => {
    install(() => {
      throw new Error('unsupported media feature');
    });
    expect(prefersReducedMotion()).toBe(false);
  });

  it('says no when the engine returns nothing at all', () => {
    install(() => undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('watching the preference', () => {
  it('delivers a change without a reload', () => {
    // The point of the subscription: somebody who turns the setting on mid-match is
    // respected there and then.
    const fake = fakeQuery(false);
    install(() => fake.query);
    const seen: boolean[] = [];
    const stop = watchReducedMotion((reduced) => seen.push(reduced));

    fake.set(true);
    fake.set(false);

    expect(seen).toEqual([true, false]);
    stop();
  });

  it('does not fire on subscribe, because the caller has just read the value', () => {
    const fake = fakeQuery(true);
    install(() => fake.query);
    const onChange = vi.fn();
    const stop = watchReducedMotion(onChange);
    expect(onChange).not.toHaveBeenCalled();
    stop();
  });

  it('removes its listener when it is stopped', () => {
    const fake = fakeQuery(false);
    install(() => fake.query);
    const seen: boolean[] = [];
    const stop = watchReducedMotion((reduced) => seen.push(reduced));
    expect(fake.listenerCount).toBe(1);

    stop();

    expect(fake.listenerCount).toBe(0);
    fake.set(true);
    expect(seen).toEqual([]);
  });

  it('hands back a working unsubscribe on a runtime with no matchMedia', () => {
    // Every caller unsubscribes in a cleanup, and a cleanup that throws takes the rest of
    // the unmount with it — so the no-op has to be a real function, not undefined.
    const stop = watchReducedMotion(() => undefined);
    expect(() => {
      stop();
    }).not.toThrow();
  });

  it('survives a media query that cannot be subscribed to', () => {
    // Safari before 14: the query is there, the subscription is not. The device gets the
    // value it had at load rather than an exception on the way to the board.
    install(() => ({ matches: true }));
    expect(prefersReducedMotion()).toBe(true);
    const stop = watchReducedMotion(() => undefined);
    expect(() => {
      stop();
    }).not.toThrow();
  });
});
