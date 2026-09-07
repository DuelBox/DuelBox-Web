import { describe, expect, it, vi } from 'vitest';
import { InputMethodTracker } from './input-method';

describe('InputMethodTracker (#2424)', () => {
  it('starts on a neutral default and follows the first real input', () => {
    const t = new InputMethodTracker();
    expect(t.current).toBe('pointer');
    t.note('keyboard');
    expect(t.current).toBe('keyboard');
  });

  it('honours a configured initial method', () => {
    expect(new InputMethodTracker({ initial: 'keyboard' }).current).toBe('keyboard');
  });

  it('follows the most recently used instrument', () => {
    const t = new InputMethodTracker();
    t.note('keyboard');
    t.note('pointer');
    t.note('keyboard');
    expect(t.current).toBe('keyboard');
  });

  it('notifies subscribers only on an actual change, so a hybrid device does not flicker', () => {
    const t = new InputMethodTracker({ initial: 'pointer' });
    const seen: string[] = [];
    t.subscribe((m) => seen.push(m));
    // A run of the same method must notify once, not once per event.
    expect(t.note('keyboard')).toBe(true);
    expect(t.note('keyboard')).toBe(false);
    expect(t.note('keyboard')).toBe(false);
    expect(t.note('pointer')).toBe(true);
    expect(seen).toEqual(['keyboard', 'pointer']);
  });

  it('stops notifying after unsubscribe', () => {
    const t = new InputMethodTracker();
    const listener = vi.fn();
    const off = t.subscribe(listener);
    t.note('keyboard');
    off();
    t.note('pointer');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('attaches to a target and switches on keydown and pointerdown only', () => {
    // A minimal event target that records handlers and can fire them.
    const handlers = new Map<string, EventListener>();
    const target = {
      addEventListener: (type: string, handler: EventListenerOrEventListenerObject) => {
        handlers.set(type, handler as EventListener);
      },
      removeEventListener: (type: string) => {
        handlers.delete(type);
      },
    } as unknown as EventTarget;

    const t = new InputMethodTracker({ initial: 'pointer' });
    const detach = t.attach(target);
    expect(handlers.has('keydown')).toBe(true);
    expect(handlers.has('pointerdown')).toBe(true);
    // No listener for pointermove: a drifting mouse must not switch the prompt.
    expect(handlers.has('pointermove')).toBe(false);

    handlers.get('keydown')?.(new Event('keydown'));
    expect(t.current).toBe('keyboard');
    handlers.get('pointerdown')?.(new Event('pointerdown'));
    expect(t.current).toBe('pointer');

    detach();
    expect(handlers.size).toBe(0);
  });
});
