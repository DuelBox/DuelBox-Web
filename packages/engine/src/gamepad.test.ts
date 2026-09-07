import { describe, expect, it } from 'vitest';
import { GamepadManager } from './gamepad.js';
import type { GamepadSnapshot } from './gamepad.js';
import { InputManager } from './input.js';

function pad(
  index: number,
  opts: { axes?: number[]; buttons?: boolean[]; id?: string; connected?: boolean } = {},
): GamepadSnapshot {
  return {
    index,
    id: opts.id ?? `pad-${index}`,
    connected: opts.connected ?? true,
    axes: opts.axes ?? [0, 0],
    buttons: opts.buttons ?? [false],
  };
}

/** A source whose returned array can be swapped between polls, like the browser's. */
function source(initial: (GamepadSnapshot | null)[]) {
  let pads = initial;
  const fn = () => pads;
  return {
    fn,
    set(next: (GamepadSnapshot | null)[]) {
      pads = next;
    },
  };
}

describe('GamepadManager seat assignment (#130)', () => {
  it('seats two pads by connection order and silently on the first poll', () => {
    const src = source([pad(0), pad(1)]);
    const gm = new GamepadManager(src.fn);
    gm.poll();
    expect(gm.seatOf(0)).toBe('p1');
    expect(gm.seatOf(1)).toBe('p2');
    // Pads already present at match start are the initial assignment, not a hot-plug: no prompt.
    expect(gm.events).toHaveLength(0);
  });

  it('drives two seats independently', () => {
    const src = source([
      pad(0, { axes: [1, 0], buttons: [true] }),
      pad(1, { axes: [0, -1], buttons: [false] }),
    ]);
    const gm = new GamepadManager(src.fn);
    gm.poll();
    const p1 = gm.reading('p1');
    const p2 = gm.reading('p2');
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    expect(p1?.moveX).toBeCloseTo(1, 6);
    expect(p1?.action).toBe(true);
    expect(p2?.moveY).toBeCloseTo(-1, 6);
    expect(p2?.action).toBe(false);
  });

  it('raises a connect event and seats a hot-plugged pad after the first poll', () => {
    const src = source([pad(0)]);
    const gm = new GamepadManager(src.fn);
    gm.poll(); // seat pad 0 to p1, silently
    src.set([pad(0), pad(1, { id: 'freshly-plugged' })]);
    gm.poll();
    expect(gm.seatOf(1)).toBe('p2');
    expect(gm.events).toHaveLength(1);
    expect(gm.events[0]).toMatchObject({ kind: 'connected', seat: 'p2', gamepadIndex: 1 });
  });

  it('frees the seat and raises a disconnect event on unplug', () => {
    const src = source([pad(0), pad(1)]);
    const gm = new GamepadManager(src.fn);
    gm.poll();
    gm.clearEvents();
    src.set([pad(1)]); // pad 0 gone
    gm.poll();
    expect(gm.seatOf(0)).toBeNull();
    expect(gm.padOf('p1')).toBeNull();
    expect(gm.reading('p1')).toBeNull();
    expect(gm.events).toHaveLength(1);
    expect(gm.events[0]).toMatchObject({ kind: 'disconnected', seat: 'p1', gamepadIndex: 0 });
  });

  it('reassigns a seat by hand, displacing the pad that held it', () => {
    const src = source([pad(0), pad(1)]);
    const gm = new GamepadManager(src.fn);
    gm.poll();
    gm.clearEvents();
    // Give p2 the pad that was driving p1; p1 is left with none.
    gm.reassign('p2', 0);
    expect(gm.seatOf(0)).toBe('p2');
    expect(gm.padOf('p1')).toBeNull();
    expect(gm.events[0]).toMatchObject({ kind: 'reassigned', seat: 'p2', gamepadIndex: 0 });
  });

  it('clears the event buffer on request', () => {
    const src = source([pad(0)]);
    const gm = new GamepadManager(src.fn);
    gm.poll();
    src.set([pad(0), pad(1)]);
    gm.poll();
    expect(gm.events.length).toBeGreaterThan(0);
    gm.clearEvents();
    expect(gm.events).toHaveLength(0);
  });
});

describe('GamepadManager deadzone and normalisation', () => {
  it('reads a sub-deadzone displacement as zero', () => {
    const src = source([pad(0, { axes: [0.1, 0.1] })]);
    const gm = new GamepadManager(src.fn, { deadzone: 0.15 });
    gm.poll();
    expect(gm.reading('p1')?.moveX).toBe(0);
    expect(gm.reading('p1')?.moveY).toBe(0);
  });

  it('rescales the range past the deadzone so a full tilt is still full', () => {
    const src = source([pad(0, { axes: [1, 0] })]);
    const gm = new GamepadManager(src.fn, { deadzone: 0.15 });
    gm.poll();
    expect(gm.reading('p1')?.moveX).toBeCloseTo(1, 6);
  });

  it('scales a half tilt to a fraction, not to a half', () => {
    const src = source([pad(0, { axes: [0.5, 0] })]);
    const gm = new GamepadManager(src.fn, { deadzone: 0.15 });
    gm.poll();
    // (0.5 - 0.15) / (1 - 0.15) = 0.41176...
    expect(gm.reading('p1')?.moveX).toBeCloseTo(0.4117647, 5);
  });

  it('reads a configurable action button', () => {
    const src = source([pad(0, { axes: [0, 0], buttons: [false, false, true] })]);
    const gm = new GamepadManager(src.fn, { actionButtons: [2] });
    gm.poll();
    expect(gm.reading('p1')?.action).toBe(true);
  });
});

describe('gamepad drives a seat through InputManager (#130 end to end)', () => {
  const logical = { width: 400, height: 400 };

  it('feeds a seat move and action that a game reads exactly like a key', () => {
    const manager = new InputManager(logical);
    manager.setSeatAnalog('p1', 1, 0, true);
    const state = manager.beginStep(1 / 60);
    const seat = state.seat('p1');
    expect(seat.moveX).toBeCloseTo(1, 6);
    expect(seat.actionHeld).toBe(true);
    expect(seat.actionPressed).toBe(true);
  });

  it('combines a pad and the keys of the same seat and clamps to unit length', () => {
    const manager = new InputManager(logical);
    manager.keyDown('KeyD'); // p1 right
    manager.setSeatAnalog('p1', 1, 0, false);
    const seat = manager.beginStep(1 / 60).seat('p1');
    // 1 (key) + 1 (analog) = 2, clamped to unit length.
    expect(seat.moveX).toBeCloseTo(1, 6);
  });

  it('accumulates a held gamepad button into holdSeconds across steps', () => {
    const manager = new InputManager(logical);
    manager.setSeatAnalog('p1', 0, 0, true);
    manager.beginStep(1 / 60); // press step: holdSeconds 0
    manager.setSeatAnalog('p1', 0, 0, true);
    const seat = manager.beginStep(1 / 60).seat('p1');
    expect(seat.actionHeld).toBe(true);
    expect(seat.holdSeconds).toBeCloseTo(1 / 60, 6);
  });

  it('leaves a seat with no pad reading exactly as before when analog is zero', () => {
    const manager = new InputManager(logical);
    const seat = manager.beginStep(1 / 60).seat('p2');
    expect(seat.moveX).toBe(0);
    expect(seat.moveY).toBe(0);
    expect(seat.actionHeld).toBe(false);
  });
});
