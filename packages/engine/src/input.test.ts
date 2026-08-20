import { describe, it, expect } from 'vitest';
import { DEFAULT_BINDINGS, InputManager, InputState } from './input.js';
import type { KeyBinding, SeatInputState } from './input.js';
import { SEATS } from './seat.js';
import { envelopeFor } from './input.js';
import type { LogicalSize, SeatId } from './seat.js';

const SIZE: LogicalSize = { width: 800, height: 600 };

/**
 * Where a coordinate lands once the precision envelope has rounded it.
 *
 * Pointer positions are quantised onto a shared lattice so no input family can aim finer
 * than another — see `PRECISION_ENVELOPE`. These tests are about *tracking* a pointer, not
 * about the lattice, so they say what they mean rather than hard-coding the rounded
 * numbers: `onLattice(400)` reads as "wherever 400 ends up", which is the point.
 */
const onLattice = (value: number): number =>
  Math.round(value / envelopeFor(SIZE)) * envelopeFor(SIZE);
const DT = 1 / 60;

/** Under the default horizontal split with p1 at the bottom, p1 owns y >= 300. */
const P1_ZONE_Y = 500;
const P2_ZONE_Y = 100;

const IJKL: KeyBinding = {
  up: 'KeyI',
  down: 'KeyK',
  left: 'KeyJ',
  right: 'KeyL',
  action: 'ShiftLeft',
};

const NUMPAD: KeyBinding = {
  up: 'Numpad8',
  down: 'Numpad2',
  left: 'Numpad4',
  right: 'Numpad6',
  action: 'Numpad0',
};

function expectNeutral(state: Readonly<SeatInputState>): void {
  expect(state.moveX).toBe(0);
  expect(state.moveY).toBe(0);
  expect(state.pointerX).toBe(0);
  expect(state.pointerY).toBe(0);
  expect(state.pointerActive).toBe(false);
  expect(state.actionPressed).toBe(false);
  expect(state.actionHeld).toBe(false);
  expect(state.actionReleased).toBe(false);
  expect(state.holdSeconds).toBe(0);
}

describe('DEFAULT_BINDINGS', () => {
  it('puts the two halves of one keyboard on the two seats', () => {
    expect(DEFAULT_BINDINGS.p1).toEqual({
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      action: 'Space',
    });
    expect(DEFAULT_BINDINGS.p2).toEqual({
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      action: 'Enter',
    });
  });

  it('shares no key between the seats, so both halves work at once', () => {
    const p1Codes = new Set(Object.values(DEFAULT_BINDINGS.p1));
    expect(p1Codes.size).toBe(5);
    for (const code of Object.values(DEFAULT_BINDINGS.p2)) {
      expect(p1Codes.has(code)).toBe(false);
    }
  });
});

describe('InputState', () => {
  it('starts both seats neutral and hands back the same record every time', () => {
    const state = new InputState();
    for (const seat of SEATS) {
      const record = state.seat(seat);
      expectNeutral(record);
      expect(state.seat(seat)).toBe(record);
    }
    expect(state.seat('p1')).not.toBe(state.seat('p2'));
  });
});

describe('InputManager keyboard', () => {
  it('registers both seats simultaneously, direction and action in the same step', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('KeyD');
    manager.keyDown('Space');
    manager.keyDown('ArrowLeft');
    manager.keyDown('Enter');

    const state = manager.beginStep(DT);
    const p1 = state.seat('p1');
    const p2 = state.seat('p2');

    expect(p1.moveX).toBe(1);
    expect(p1.moveY).toBe(0);
    expect(p1.actionPressed).toBe(true);
    expect(p1.actionHeld).toBe(true);

    expect(p2.moveX).toBe(-1);
    expect(p2.moveY).toBe(0);
    expect(p2.actionPressed).toBe(true);
    expect(p2.actionHeld).toBe(true);
  });

  it('drives each seat from its own half without touching the other seat', () => {
    const manager = new InputManager(SIZE);

    manager.keyDown('KeyW');
    let state = manager.beginStep(DT);
    expect(state.seat('p1').moveY).toBe(-1);
    expect(state.seat('p2').moveY).toBe(0);
    manager.keyUp('KeyW');

    manager.keyDown('ArrowDown');
    state = manager.beginStep(DT);
    expect(state.seat('p2').moveY).toBe(1);
    expect(state.seat('p1').moveY).toBe(0);
    manager.keyUp('ArrowDown');

    manager.keyDown('KeyA');
    manager.keyDown('ArrowRight');
    state = manager.beginStep(DT);
    expect(state.seat('p1').moveX).toBe(-1);
    expect(state.seat('p2').moveX).toBe(1);
  });

  it('ignores an unbound key code entirely', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('KeyZ');
    manager.keyUp('KeyZ');
    const state = manager.beginStep(DT);
    expectNeutral(state.seat('p1'));
    expectNeutral(state.seat('p2'));
  });

  it('does not double-fire an auto-repeated keyDown', () => {
    const manager = new InputManager(SIZE);
    for (let i = 0; i < 8; i += 1) {
      manager.keyDown('Space');
      manager.keyDown('KeyD');
    }

    let p1 = manager.beginStep(DT).seat('p1');
    expect(p1.actionPressed).toBe(true);
    expect(p1.actionHeld).toBe(true);
    // Repeats must not stack into a faster-than-unit axis either.
    expect(p1.moveX).toBe(1);

    for (let i = 0; i < 8; i += 1) {
      manager.keyDown('Space');
      manager.keyDown('KeyD');
    }
    p1 = manager.beginStep(DT).seat('p1');
    expect(p1.actionPressed).toBe(false);
    expect(p1.actionHeld).toBe(true);
    expect(p1.moveX).toBe(1);

    // However many repeats arrived, one key-up releases the key.
    manager.keyUp('Space');
    manager.keyUp('KeyD');
    p1 = manager.beginStep(DT).seat('p1');
    expect(p1.actionHeld).toBe(false);
    expect(p1.actionReleased).toBe(true);
    expect(p1.moveX).toBe(0);
  });

  it('raises actionPressed for exactly one step while the key stays down', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('Space');

    expect(manager.beginStep(DT).seat('p1').actionPressed).toBe(true);
    for (let step = 0; step < 5; step += 1) {
      const p1 = manager.beginStep(DT).seat('p1');
      expect(p1.actionPressed).toBe(false);
      expect(p1.actionHeld).toBe(true);
      expect(p1.actionReleased).toBe(false);
    }
  });

  it('raises actionReleased for exactly one step after the key comes up', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('Enter');
    manager.beginStep(DT);
    manager.beginStep(DT);

    manager.keyUp('Enter');
    let p2 = manager.beginStep(DT).seat('p2');
    expect(p2.actionReleased).toBe(true);
    expect(p2.actionHeld).toBe(false);
    expect(p2.actionPressed).toBe(false);

    for (let step = 0; step < 4; step += 1) {
      p2 = manager.beginStep(DT).seat('p2');
      expect(p2.actionReleased).toBe(false);
      expect(p2.actionHeld).toBe(false);
    }
  });

  it('accumulates holdSeconds across steps and resets it on release', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('Space');

    expect(manager.beginStep(DT).seat('p1').holdSeconds).toBe(0);
    expect(manager.beginStep(DT).seat('p1').holdSeconds).toBeCloseTo(DT, 12);
    expect(manager.beginStep(DT).seat('p1').holdSeconds).toBeCloseTo(2 * DT, 12);

    manager.keyUp('Space');
    const released = manager.beginStep(DT).seat('p1');
    expect(released.actionReleased).toBe(true);
    expect(released.holdSeconds).toBe(0);
    expect(manager.beginStep(DT).seat('p1').holdSeconds).toBe(0);

    // A second hold starts its own count.
    manager.keyDown('Space');
    expect(manager.beginStep(DT).seat('p1').holdSeconds).toBe(0);
    expect(manager.beginStep(DT).seat('p1').holdSeconds).toBeCloseTo(DT, 12);
  });

  it('counts the holds of the two seats independently', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('Space');
    manager.beginStep(DT);
    manager.beginStep(DT);
    manager.beginStep(DT);

    manager.keyDown('Enter');
    const state = manager.beginStep(DT);
    expect(state.seat('p1').holdSeconds).toBeCloseTo(3 * DT, 12);
    expect(state.seat('p1').actionPressed).toBe(false);
    expect(state.seat('p2').holdSeconds).toBe(0);
    expect(state.seat('p2').actionPressed).toBe(true);
  });

  it('treats a non-finite or negative step as zero elapsed time', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('Space');
    manager.beginStep(DT);
    expect(manager.beginStep(Number.NaN).seat('p1').holdSeconds).toBe(0);
    expect(manager.beginStep(-1).seat('p1').holdSeconds).toBe(0);
    expect(manager.beginStep(DT).seat('p1').holdSeconds).toBeCloseTo(DT, 12);
  });
});

describe('InputManager movement vector', () => {
  it('normalises a diagonal so it is no faster than a straight line', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('KeyW');
    manager.keyDown('KeyD');

    const p1 = manager.beginStep(DT).seat('p1');
    expect(Math.hypot(p1.moveX, p1.moveY)).toBeCloseTo(1, 12);
    expect(p1.moveX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(p1.moveY).toBeCloseTo(-Math.SQRT1_2, 12);
  });

  it('keeps every diagonal of both seats at unit length', () => {
    const diagonals: readonly (readonly [SeatId, string, string])[] = [
      ['p1', 'KeyA', 'KeyW'],
      ['p1', 'KeyA', 'KeyS'],
      ['p1', 'KeyD', 'KeyW'],
      ['p1', 'KeyD', 'KeyS'],
      ['p2', 'ArrowLeft', 'ArrowUp'],
      ['p2', 'ArrowLeft', 'ArrowDown'],
      ['p2', 'ArrowRight', 'ArrowUp'],
      ['p2', 'ArrowRight', 'ArrowDown'],
    ];

    for (const [seat, across, along] of diagonals) {
      const manager = new InputManager(SIZE);
      manager.keyDown(across);
      manager.keyDown(along);
      const state = manager.beginStep(DT).seat(seat);
      expect(Math.hypot(state.moveX, state.moveY)).toBeCloseTo(1, 12);
      expect(Math.abs(state.moveX)).toBeCloseTo(Math.SQRT1_2, 12);
      expect(Math.abs(state.moveY)).toBeCloseTo(Math.SQRT1_2, 12);
    }
  });

  it('leaves a single axis at exactly one', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('KeyS');
    expect(manager.beginStep(DT).seat('p1').moveY).toBe(1);
    manager.keyUp('KeyS');
    manager.keyDown('KeyA');
    expect(manager.beginStep(DT).seat('p1').moveX).toBe(-1);
  });

  it('cancels opposite keys held together', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('KeyA');
    manager.keyDown('KeyD');
    manager.keyDown('ArrowUp');
    manager.keyDown('ArrowDown');

    const state = manager.beginStep(DT);
    expect(state.seat('p1').moveX).toBe(0);
    expect(state.seat('p1').moveY).toBe(0);
    expect(state.seat('p2').moveX).toBe(0);
    expect(state.seat('p2').moveY).toBe(0);
  });
});

describe('InputManager pointers', () => {
  it('gives a pointer to the zone it went down in and feeds position and action', () => {
    const manager = new InputManager(SIZE);
    manager.pointerDown(1, 120, P1_ZONE_Y);

    const state = manager.beginStep(DT);
    const p1 = state.seat('p1');
    expect(p1.pointerActive).toBe(true);
    expect(p1.pointerX).toBe(onLattice(120));
    expect(p1.pointerY).toBe(onLattice(P1_ZONE_Y));
    expect(p1.actionPressed).toBe(true);
    expect(p1.actionHeld).toBe(true);
    expect(state.seat('p2').pointerActive).toBe(false);
    expect(state.seat('p2').actionHeld).toBe(false);
  });

  it('keeps the starting seat after the pointer crosses the divider', () => {
    const manager = new InputManager(SIZE);
    manager.pointerDown(7, 400, 590);
    manager.pointerMove(7, 400, 320);
    manager.pointerMove(7, 400, 10);

    let state = manager.beginStep(DT);
    expect(state.seat('p1').pointerActive).toBe(true);
    expect(state.seat('p1').pointerX).toBe(onLattice(400));
    expect(state.seat('p1').pointerY).toBe(onLattice(10));
    expect(state.seat('p2').pointerActive).toBe(false);
    expect(state.seat('p2').pointerX).toBe(onLattice(0));
    expect(state.seat('p2').pointerY).toBe(onLattice(0));

    // A new pointer going down over there still belongs to that zone's owner.
    manager.pointerDown(8, 400, 10);
    state = manager.beginStep(DT);
    expect(state.seat('p2').pointerActive).toBe(true);
    expect(state.seat('p2').pointerY).toBe(onLattice(10));
    expect(state.seat('p1').pointerY).toBe(onLattice(10));

    manager.pointerUp(7);
    state = manager.beginStep(DT);
    expect(state.seat('p1').pointerActive).toBe(false);
    expect(state.seat('p1').actionReleased).toBe(true);
    expect(state.seat('p2').pointerActive).toBe(true);
  });

  it('drives the two seats independently from two pointers in different zones', () => {
    const manager = new InputManager(SIZE);
    manager.pointerDown(1, 100, P1_ZONE_Y);
    manager.pointerDown(2, 700, P2_ZONE_Y);

    let state = manager.beginStep(DT);
    expect(state.seat('p1').pointerX).toBe(onLattice(100));
    expect(state.seat('p1').pointerY).toBe(onLattice(P1_ZONE_Y));
    expect(state.seat('p1').pointerActive).toBe(true);
    expect(state.seat('p2').pointerX).toBe(onLattice(700));
    expect(state.seat('p2').pointerY).toBe(onLattice(P2_ZONE_Y));
    expect(state.seat('p2').pointerActive).toBe(true);

    manager.pointerMove(1, 150, 550);
    state = manager.beginStep(DT);
    expect(state.seat('p1').pointerX).toBe(onLattice(150));
    expect(state.seat('p2').pointerX).toBe(onLattice(700));

    manager.pointerUp(1);
    state = manager.beginStep(DT);
    expect(state.seat('p1').pointerActive).toBe(false);
    expect(state.seat('p1').actionReleased).toBe(true);
    expect(state.seat('p2').pointerActive).toBe(true);
    expect(state.seat('p2').actionHeld).toBe(true);
    expect(state.seat('p2').actionReleased).toBe(false);
  });

  it('tracks ten concurrent pointers and drops a seat only when its last one lifts', () => {
    const manager = new InputManager(SIZE);
    for (let id = 0; id < 10; id += 1) {
      manager.pointerDown(id, 40 * id + 10, id % 2 === 0 ? P1_ZONE_Y : P2_ZONE_Y);
    }

    let state = manager.beginStep(DT);
    expect(state.seat('p1').pointerActive).toBe(true);
    expect(state.seat('p2').pointerActive).toBe(true);
    // The most recent event for a seat owns its position: ids 8 and 9 went down last.
    expect(state.seat('p1').pointerX).toBe(onLattice(40 * 8 + 10));
    expect(state.seat('p1').pointerY).toBe(onLattice(P1_ZONE_Y));
    expect(state.seat('p2').pointerX).toBe(onLattice(40 * 9 + 10));
    expect(state.seat('p2').pointerY).toBe(onLattice(P2_ZONE_Y));

    // Nine lifted: p1 has none left, p2 still holds id 9.
    for (let id = 0; id < 9; id += 1) {
      manager.pointerUp(id);
    }
    state = manager.beginStep(DT);
    expect(state.seat('p1').pointerActive).toBe(false);
    expect(state.seat('p1').actionReleased).toBe(true);
    expect(state.seat('p2').pointerActive).toBe(true);
    expect(state.seat('p2').actionHeld).toBe(true);

    manager.pointerUp(9);
    state = manager.beginStep(DT);
    expect(state.seat('p2').pointerActive).toBe(false);
    expect(state.seat('p2').actionReleased).toBe(true);
  });

  it('ignores a move or an up for a pointer that never went down', () => {
    const manager = new InputManager(SIZE);
    manager.pointerMove(42, 100, P1_ZONE_Y);
    manager.pointerUp(42);

    const state = manager.beginStep(DT);
    expectNeutral(state.seat('p1'));
    expectNeutral(state.seat('p2'));
  });

  it('does not double-count a repeated pointerDown for a live id', () => {
    const manager = new InputManager(SIZE);
    manager.pointerDown(3, 100, P1_ZONE_Y);
    manager.pointerDown(3, 140, P1_ZONE_Y);

    let state = manager.beginStep(DT);
    expect(state.seat('p1').pointerActive).toBe(true);
    expect(state.seat('p1').pointerX).toBe(onLattice(140));

    manager.pointerUp(3);
    state = manager.beginStep(DT);
    expect(state.seat('p1').pointerActive).toBe(false);
  });

  it('lets either a key or a pointer raise the same seat action', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('Space');
    manager.pointerDown(1, 100, P1_ZONE_Y);
    let p1 = manager.beginStep(DT).seat('p1');
    expect(p1.actionPressed).toBe(true);

    // Dropping one source while the other still holds must not read as a release.
    manager.keyUp('Space');
    p1 = manager.beginStep(DT).seat('p1');
    expect(p1.actionHeld).toBe(true);
    expect(p1.actionReleased).toBe(false);

    manager.pointerUp(1);
    p1 = manager.beginStep(DT).seat('p1');
    expect(p1.actionHeld).toBe(false);
    expect(p1.actionReleased).toBe(true);
  });

  it('lets the pointer own position while the keys own movement', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('KeyD');
    manager.pointerDown(1, 250, 480);
    manager.pointerMove(1, 260, 470);

    const p1 = manager.beginStep(DT).seat('p1');
    expect(p1.moveX).toBe(1);
    expect(p1.pointerX).toBe(onLattice(260));
    expect(p1.pointerY).toBe(onLattice(470));
  });

  it('honours a vertical split with p2 at the bottom', () => {
    const manager = new InputManager(SIZE, { split: 'vertical', bottomSeat: 'p2' });
    manager.pointerDown(1, 100, 300);
    manager.pointerDown(2, 700, 300);

    const state = manager.beginStep(DT);
    expect(state.seat('p2').pointerActive).toBe(true);
    expect(state.seat('p2').pointerX).toBe(onLattice(100));
    expect(state.seat('p1').pointerActive).toBe(true);
    expect(state.seat('p1').pointerX).toBe(onLattice(700));
  });
});

describe('InputManager setBinding', () => {
  it('rejects a binding that collides with the other seat, naming the key', () => {
    const manager = new InputManager(SIZE);
    expect(() =>
      manager.setBinding('p1', {
        up: 'ArrowUp',
        down: 'KeyS',
        left: 'KeyA',
        right: 'KeyD',
        action: 'Space',
      }),
    ).toThrow(/ArrowUp/);

    expect(() =>
      manager.setBinding('p1', {
        up: 'KeyI',
        down: 'KeyK',
        left: 'KeyJ',
        right: 'KeyL',
        action: 'Enter',
      }),
    ).toThrow(/Enter/);
  });

  it('leaves the manager untouched when a binding is rejected', () => {
    const manager = new InputManager(SIZE);
    expect(() =>
      manager.setBinding('p2', {
        up: 'KeyW',
        down: 'ArrowDown',
        left: 'ArrowLeft',
        right: 'ArrowRight',
        action: 'Enter',
      }),
    ).toThrow(/KeyW/);

    manager.keyDown('KeyW');
    manager.keyDown('ArrowUp');
    const state = manager.beginStep(DT);
    expect(state.seat('p1').moveY).toBe(-1);
    expect(state.seat('p2').moveY).toBe(-1);
  });

  it('rejects a binding that uses one key for two of its own slots', () => {
    const manager = new InputManager(SIZE);
    expect(() =>
      manager.setBinding('p1', {
        up: 'KeyI',
        down: 'KeyI',
        left: 'KeyJ',
        right: 'KeyL',
        action: 'ShiftLeft',
      }),
    ).toThrow(/KeyI/);
  });

  it('rejects colliding bindings at construction', () => {
    expect(
      () =>
        new InputManager(SIZE, {
          bindings: {
            p1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', action: 'Space' },
            p2: {
              up: 'ArrowUp',
              down: 'ArrowDown',
              left: 'ArrowLeft',
              right: 'KeyD',
              action: 'Enter',
            },
          },
        }),
    ).toThrow(/KeyD/);
  });

  it('applies a valid rebind, drops keys held under the old one, and frees the codes', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('KeyW');
    manager.setBinding('p1', IJKL);

    let state = manager.beginStep(DT);
    expect(state.seat('p1').moveY).toBe(0);

    manager.keyDown('KeyW');
    state = manager.beginStep(DT);
    expect(state.seat('p1').moveY).toBe(0);

    manager.keyDown('KeyI');
    manager.keyDown('ShiftLeft');
    state = manager.beginStep(DT);
    expect(state.seat('p1').moveY).toBe(-1);
    expect(state.seat('p1').actionPressed).toBe(true);

    // p1 no longer uses KeyW, so p2 may now take it.
    manager.setBinding('p2', {
      up: 'KeyW',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      action: 'Enter',
    });
    manager.keyDown('KeyW');
    state = manager.beginStep(DT);
    expect(state.seat('p2').moveY).toBe(-1);
    expect(state.seat('p1').moveY).toBe(-1);
  });

  it('accepts custom bindings supplied to the constructor', () => {
    const manager = new InputManager(SIZE, { bindings: { p1: IJKL, p2: NUMPAD } });
    manager.keyDown('KeyL');
    manager.keyDown('Numpad4');
    manager.keyDown('KeyW');

    const state = manager.beginStep(DT);
    expect(state.seat('p1').moveX).toBe(1);
    expect(state.seat('p1').moveY).toBe(0);
    expect(state.seat('p2').moveX).toBe(-1);
  });

  it('copies the bindings it is given, so later edits cannot desynchronise it', () => {
    const mutable: KeyBinding = { ...IJKL };
    const manager = new InputManager(SIZE, { bindings: { p1: mutable, p2: NUMPAD } });
    mutable.up = 'KeyW';

    manager.keyDown('KeyW');
    manager.keyDown('KeyI');
    const state = manager.beginStep(DT);
    expect(state.seat('p1').moveY).toBe(-1);
  });
});

describe('InputManager clear', () => {
  it('releases every key and pointer without firing a phantom edge', () => {
    const manager = new InputManager(SIZE);
    manager.keyDown('KeyD');
    manager.keyDown('Space');
    manager.pointerDown(1, 200, P1_ZONE_Y);
    manager.keyDown('ArrowUp');
    manager.keyDown('Enter');
    manager.pointerDown(2, 200, P2_ZONE_Y);
    manager.beginStep(DT);
    manager.beginStep(DT);
    expect(manager.state.seat('p1').holdSeconds).toBeCloseTo(DT, 12);

    manager.clear();
    expectNeutral(manager.state.seat('p1'));
    expectNeutral(manager.state.seat('p2'));

    const state = manager.beginStep(DT);
    expectNeutral(state.seat('p1'));
    expectNeutral(state.seat('p2'));

    // The released pointers are forgotten: their later events own no seat.
    manager.pointerMove(1, 700, P1_ZONE_Y);
    manager.pointerUp(2);
    expectNeutral(manager.beginStep(DT).seat('p1'));

    // Fresh input still works afterwards.
    manager.keyDown('KeyD');
    manager.pointerDown(3, 300, P2_ZONE_Y);
    const resumed = manager.beginStep(DT);
    expect(resumed.seat('p1').moveX).toBe(1);
    expect(resumed.seat('p1').actionHeld).toBe(false);
    expect(resumed.seat('p2').pointerActive).toBe(true);
    expect(resumed.seat('p2').actionPressed).toBe(true);
  });
});

describe('InputManager allocation discipline', () => {
  it('returns the same state and seat records every step', () => {
    const manager = new InputManager(SIZE);
    const state = manager.beginStep(DT);
    expect(state).toBe(manager.state);

    const p1 = state.seat('p1');
    const p2 = state.seat('p2');
    for (let step = 0; step < 4; step += 1) {
      manager.keyDown('KeyD');
      manager.pointerDown(step, 100, P2_ZONE_Y);
      const next = manager.beginStep(DT);
      expect(next).toBe(state);
      expect(next.seat('p1')).toBe(p1);
      expect(next.seat('p2')).toBe(p2);
    }
    expect(p1.moveX).toBe(1);
    expect(p2.pointerActive).toBe(true);
  });
});

describe('a tap that begins and ends between two steps', () => {
  const STEP = 1 / 60;
  const SIZE = { width: 600, height: 1000 };

  function manager(): InputManager {
    return new InputManager(SIZE, { split: 'horizontal', bottomSeat: 'p1' });
  }

  it('is still a press', () => {
    // The primary gesture on a touchscreen: finger down and up inside one frame. Sampling
    // "is a pointer down now" at step time misses it entirely — the finger is already gone.
    const input = manager();
    input.pointerDown(1, 300, 800);
    input.pointerUp(1);
    const state = input.beginStep(STEP);
    expect(state.seat('p1').actionPressed).toBe(true);
  });

  it('reports its release in the same step, not a phantom hold', () => {
    const input = manager();
    input.pointerDown(1, 300, 800);
    input.pointerUp(1);
    const state = input.beginStep(STEP);
    expect(state.seat('p1').actionHeld).toBe(false);
    expect(state.seat('p1').actionReleased).toBe(true);
    expect(state.seat('p1').holdSeconds).toBe(0);
  });

  it('does not repeat on the following step', () => {
    const input = manager();
    input.pointerDown(1, 300, 800);
    input.pointerUp(1);
    input.beginStep(STEP);
    const next = input.beginStep(STEP);
    expect(next.seat('p1').actionPressed).toBe(false);
    expect(next.seat('p1').actionReleased).toBe(false);
  });

  it('goes to the seat whose zone it landed in', () => {
    const input = manager();
    // Top half belongs to p2 when p1 sits at the bottom.
    input.pointerDown(1, 300, 100);
    input.pointerUp(1);
    const state = input.beginStep(STEP);
    expect(state.seat('p2').actionPressed).toBe(true);
    expect(state.seat('p1').actionPressed).toBe(false);
  });

  it('counts two quick taps as two presses, not one', () => {
    const input = manager();
    input.pointerDown(1, 300, 800);
    input.pointerUp(1);
    expect(input.beginStep(STEP).seat('p1').actionPressed).toBe(true);
    input.pointerDown(2, 300, 800);
    input.pointerUp(2);
    expect(input.beginStep(STEP).seat('p1').actionPressed).toBe(true);
  });

  it('keeps the position the tap landed at, so it can be aimed', () => {
    const input = manager();
    input.pointerDown(1, 321, 654);
    input.pointerUp(1);
    const state = input.beginStep(STEP);
    expect(state.seat('p1').pointerX).toBe(onLattice(321));
    expect(state.seat('p1').pointerY).toBe(onLattice(654));
  });

  it('does the same for a key tapped between steps', () => {
    const input = manager();
    input.keyDown(DEFAULT_BINDINGS.p1.action);
    input.keyUp(DEFAULT_BINDINGS.p1.action);
    expect(input.beginStep(STEP).seat('p1').actionPressed).toBe(true);
  });

  it('still reports a held press exactly once', () => {
    const input = manager();
    input.pointerDown(1, 300, 800);
    expect(input.beginStep(STEP).seat('p1').actionPressed).toBe(true);
    expect(input.beginStep(STEP).seat('p1').actionPressed).toBe(false);
    expect(input.beginStep(STEP).seat('p1').actionHeld).toBe(true);
    input.pointerUp(1);
    const released = input.beginStep(STEP);
    expect(released.seat('p1').actionReleased).toBe(true);
    expect(released.seat('p1').actionHeld).toBe(false);
  });

  it('is cleared by clear(), like everything else', () => {
    const input = manager();
    input.pointerDown(1, 300, 800);
    input.pointerUp(1);
    input.clear();
    expect(input.beginStep(STEP).seat('p1').actionPressed).toBe(false);
  });
});

describe('a tap keeps its coordinates', () => {
  const STEP = 1 / 60;
  const SIZE = { width: 600, height: 1000 };
  /** This block has its own logical box, so it needs its own lattice. */
  const here = (value: number): number => Math.round(value / envelopeFor(SIZE)) * envelopeFor(SIZE);

  it('reports the pointer as active on the step the press is reported', () => {
    // A press with no position cannot be aimed, so a game told "actionPressed" and
    // handed a null pointer simply drops the tap.
    const input = new InputManager(SIZE, { split: 'horizontal', bottomSeat: 'p1' });
    input.pointerDown(1, 250, 900);
    input.pointerUp(1);
    const seat = input.beginStep(STEP).seat('p1');
    expect(seat.actionPressed).toBe(true);
    expect(seat.pointerActive).toBe(true);
    expect(seat.pointerX).toBe(here(250));
    expect(seat.pointerY).toBe(here(900));
  });

  it('stops reporting it on the following step', () => {
    const input = new InputManager(SIZE, { split: 'horizontal', bottomSeat: 'p1' });
    input.pointerDown(1, 250, 900);
    input.pointerUp(1);
    input.beginStep(STEP);
    expect(input.beginStep(STEP).seat('p1').pointerActive).toBe(false);
  });

  it('does not conjure a pointer from a keyboard press', () => {
    // The action latch is raised by keys too; the pointer latch must not be.
    const input = new InputManager(SIZE, { split: 'horizontal', bottomSeat: 'p1' });
    input.keyDown(DEFAULT_BINDINGS.p1.action);
    input.keyUp(DEFAULT_BINDINGS.p1.action);
    const seat = input.beginStep(STEP).seat('p1');
    expect(seat.actionPressed).toBe(true);
    expect(seat.pointerActive).toBe(false);
  });

  it('does not treat a latched tap as a held action', () => {
    const input = new InputManager(SIZE, { split: 'horizontal', bottomSeat: 'p1' });
    input.pointerDown(1, 250, 900);
    input.pointerUp(1);
    expect(input.beginStep(STEP).seat('p1').actionHeld).toBe(false);
  });
});

describe('which keys the game claims', () => {
  const SIZE = { width: 600, height: 1000 };

  it('claims every key bound to either seat', () => {
    const input = new InputManager(SIZE, { split: 'horizontal', bottomSeat: 'p1' });
    for (const seat of ['p1', 'p2'] as const) {
      const binding = DEFAULT_BINDINGS[seat];
      for (const code of [binding.up, binding.down, binding.left, binding.right, binding.action]) {
        expect(input.isBound(code), `${code} drives ${seat}`).toBe(true);
      }
    }
  });

  it('claims nothing else', () => {
    const input = new InputManager(SIZE, { split: 'horizontal', bottomSeat: 'p1' });
    // Escape above all: it is the way out of a match and must always reach the shell.
    for (const code of ['Escape', 'Tab', 'KeyQ', 'F5', 'BracketLeft']) {
      expect(input.isBound(code), `${code} is not a game control`).toBe(false);
    }
  });

  it('follows custom bindings rather than the defaults', () => {
    const input = new InputManager(SIZE, {
      split: 'horizontal',
      bottomSeat: 'p1',
      bindings: {
        p1: { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', action: 'KeyU' },
        p2: DEFAULT_BINDINGS.p2,
      },
    });
    expect(input.isBound('KeyI')).toBe(true);
    expect(input.isBound('KeyW')).toBe(false);
  });
});

describe('the precision envelope', () => {
  /**
   * A mouse resolves a device pixel; a thumb covers dozens of them. Left alone, a
   * cross-device match is decided by which instrument the players happened to be holding.
   *
   * The fix removes *excess* precision rather than inventing any: every pointer position
   * is rounded onto a shared lattice. It cannot make a thumb steadier — that is a property
   * of hands — but it stops a mouse aiming between the points the game asks anyone for.
   */
  const size: LogicalSize = { width: 900, height: 900 };
  const step = envelopeFor(size);

  it('is a fraction of the play area, not a count of pixels', () => {
    // The whole point is that it means the same thing on a phone and on a desktop, so it
    // cannot be expressed in device pixels (rule 8).
    expect(envelopeFor({ width: 900, height: 900 })).toBe(4.5);
    expect(envelopeFor({ width: 600, height: 1000 })).toBe(3);
    expect(envelopeFor({ width: 1800, height: 1800 })).toBe(9);
  });

  it('takes the shorter side, so a long box is not quantised by its length', () => {
    expect(envelopeFor({ width: 2000, height: 500 })).toBe(
      envelopeFor({ width: 500, height: 500 }),
    );
  });

  it('rounds a pointer onto the lattice', () => {
    const manager = new InputManager(size, { split: 'horizontal', bottomSeat: 'p1' });
    manager.pointerDown(1, 451, 700);
    const state = manager.beginStep(1 / 60);
    expect(state.seat('p1').pointerX % step, 'on a lattice point').toBe(0);
    expect(state.seat('p1').pointerY % step).toBe(0);
  });

  it('gives two aims inside one envelope the same answer', () => {
    // The property that matters: a mouse cannot express a distinction a thumb cannot.
    const a = new InputManager(size, { split: 'horizontal', bottomSeat: 'p1' });
    const b = new InputManager(size, { split: 'horizontal', bottomSeat: 'p1' });
    a.pointerDown(1, 450, 700);
    b.pointerDown(1, 450 + step * 0.4, 700);
    expect(b.beginStep(1 / 60).seat('p1').pointerX).toBe(a.beginStep(1 / 60).seat('p1').pointerX);
  });

  it('still tells two aims a whole envelope apart from each other', () => {
    // And it must not flatten the game: a deliberate move of one lattice step lands.
    const a = new InputManager(size, { split: 'horizontal', bottomSeat: 'p1' });
    const b = new InputManager(size, { split: 'horizontal', bottomSeat: 'p1' });
    a.pointerDown(1, 450, 700);
    b.pointerDown(1, 450 + step, 700);
    expect(b.beginStep(1 / 60).seat('p1').pointerX).not.toBe(
      a.beginStep(1 / 60).seat('p1').pointerX,
    );
  });

  it('quantises a drag as well as a press', () => {
    const manager = new InputManager(size, { split: 'horizontal', bottomSeat: 'p1' });
    manager.pointerDown(1, 450, 700);
    manager.pointerMove(1, 451.3, 703.7);
    const state = manager.beginStep(1 / 60);
    expect(state.seat('p1').pointerX % step).toBe(0);
    expect(state.seat('p1').pointerY % step).toBe(0);
  });

  it('is fine enough that nobody can feel it', () => {
    // A twentieth of a bubble, a tenth of a checkers square: below the size of anything a
    // game asks a player to hit.
    expect(envelopeFor({ width: 900, height: 900 })).toBeLessThan(6);
  });
});

describe('a direction key tapped between two steps', () => {
  const STEP = 1 / 60;
  const SIZE = { width: 600, height: 1000 };

  function manager(): InputManager {
    return new InputManager(SIZE, { split: 'horizontal', bottomSeat: 'p1' });
  }

  /**
   * The action key has been latched since the beginning, with a comment explaining that
   * sampling "is it down now" loses a tap whose press and release land inside one frame.
   * Movement was never given the same treatment, so a quick tap of a direction key was
   * dropped outright and the cursor did not move — in every keyboard-driven grid game in
   * the collection. A human tap usually spans several frames and got away with it; a slow
   * frame, or any automated harness, did not. Shut the Box is where it finally showed.
   */
  it('still moves, exactly as a tapped action key still presses', () => {
    const input = manager();
    input.keyDown('KeyD');
    input.keyUp('KeyD');
    expect(input.beginStep(STEP).seat('p1').moveX, 'the tap was not dropped').toBe(1);
  });

  it('is one step of movement and not a phantom hold', () => {
    const input = manager();
    input.keyDown('KeyD');
    input.keyUp('KeyD');
    expect(input.beginStep(STEP).seat('p1').moveX).toBe(1);
    expect(input.beginStep(STEP).seat('p1').moveX, 'and it is over').toBe(0);
  });

  it('leaves a held key behaving exactly as before', () => {
    const input = manager();
    input.keyDown('KeyD');
    expect(input.beginStep(STEP).seat('p1').moveX).toBe(1);
    expect(input.beginStep(STEP).seat('p1').moveX, 'still held').toBe(1);
    input.keyUp('KeyD');
    expect(input.beginStep(STEP).seat('p1').moveX, 'released').toBe(0);
  });

  it('keeps each seat to its own keys', () => {
    const input = manager();
    input.keyDown('ArrowRight');
    input.keyUp('ArrowRight');
    const state = input.beginStep(STEP);
    expect(state.seat('p2').moveX, 'the arrow key is seat two').toBe(1);
    expect(state.seat('p1').moveX, 'and did not move seat one').toBe(0);
  });

  it('cancels an unconsumed tap when focus is lost', () => {
    // Otherwise a key tapped on the way out of the tab fires when the player comes back.
    const input = manager();
    input.keyDown('KeyD');
    input.keyUp('KeyD');
    input.clear();
    expect(input.beginStep(STEP).seat('p1').moveX).toBe(0);
  });

  it('two opposite taps in one frame cancel, as holding both would', () => {
    const input = manager();
    input.keyDown('KeyA');
    input.keyUp('KeyA');
    input.keyDown('KeyD');
    input.keyUp('KeyD');
    expect(input.beginStep(STEP).seat('p1').moveX).toBe(0);
  });
});
