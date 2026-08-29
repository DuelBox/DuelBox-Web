import { describe, it, expect } from 'vitest';
import {
  PointerOwnership,
  SEATS,
  otherSeat,
  seatForPoint,
  seatView,
  toScreen,
  toWorld,
  seatRotated,
} from './seat.js';
import type { LogicalSize, SeatId } from './seat.js';

const SIZE: LogicalSize = { width: 800, height: 600 };

function vec(): { x: number; y: number } {
  return { x: 0, y: 0 };
}

describe('seats', () => {
  it('lists both seats', () => {
    expect(SEATS).toEqual(['p1', 'p2']);
  });

  it('otherSeat swaps', () => {
    expect(otherSeat('p1')).toBe('p2');
    expect(otherSeat('p2')).toBe('p1');
    for (const seat of SEATS) {
      expect(otherSeat(otherSeat(seat))).toBe(seat);
    }
  });
});

describe('seatView', () => {
  it('never rotates in single-seat presentation', () => {
    for (const local of SEATS) {
      for (const seat of SEATS) {
        expect(seatView(seat, 'single-seat', local)).toEqual({ seat, rotated: false });
      }
    }
  });

  it('rotates only the seat that is not at the bottom in shared-screen', () => {
    expect(seatView('p1', 'shared-screen', 'p1')).toEqual({ seat: 'p1', rotated: false });
    expect(seatView('p2', 'shared-screen', 'p1')).toEqual({ seat: 'p2', rotated: true });
    expect(seatView('p1', 'shared-screen', 'p2')).toEqual({ seat: 'p1', rotated: true });
    expect(seatView('p2', 'shared-screen', 'p2')).toEqual({ seat: 'p2', rotated: false });
  });
});

describe('coordinate mapping', () => {
  const points: readonly (readonly [number, number])[] = [
    [0, 0],
    [800, 0],
    [0, 600],
    [800, 600],
    [400, 300],
    [123, 456],
    [1, 599],
    [-40, 640],
  ];

  it('is the identity when not rotated', () => {
    const out = vec();
    for (const [x, y] of points) {
      toWorld(out, x, y, SIZE, false);
      expect(out.x).toBe(x);
      expect(out.y).toBe(y);
      toScreen(out, x, y, SIZE, false);
      expect(out.x).toBe(x);
      expect(out.y).toBe(y);
    }
  });

  it('maps the centre to itself when rotated', () => {
    const out = vec();
    toWorld(out, SIZE.width / 2, SIZE.height / 2, SIZE, true);
    expect(out.x).toBe(400);
    expect(out.y).toBe(300);
  });

  it('maps corners to opposite corners when rotated', () => {
    const out = vec();
    toWorld(out, 0, 0, SIZE, true);
    expect(out.x).toBe(800);
    expect(out.y).toBe(600);
    toWorld(out, 800, 600, SIZE, true);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    toWorld(out, 800, 0, SIZE, true);
    expect(out.x).toBe(0);
    expect(out.y).toBe(600);
    toWorld(out, 0, 600, SIZE, true);
    expect(out.x).toBe(800);
    expect(out.y).toBe(0);
  });

  it('toWorld and toScreen are exact inverses, rotated and not', () => {
    const world = vec();
    const screen = vec();
    for (const rotated of [false, true]) {
      for (const [x, y] of points) {
        toWorld(world, x, y, SIZE, rotated);
        toScreen(screen, world.x, world.y, SIZE, rotated);
        expect(screen.x).toBe(x);
        expect(screen.y).toBe(y);
      }
    }
  });

  it('writes into the out vector without allocating', () => {
    const out = Object.seal(vec());
    for (const rotated of [false, true]) {
      expect(toWorld(out, 10, 20, SIZE, rotated)).toBe(out);
      expect(toScreen(out, 10, 20, SIZE, rotated)).toBe(out);
      expect(Object.keys(out)).toEqual(['x', 'y']);
    }
    // A sealed target also proves neither function returns a fresh object in its place.
    expect(Object.isSealed(out)).toBe(true);
  });
});

describe('seatForPoint', () => {
  it('gives the lower half to the bottom seat under a horizontal split', () => {
    expect(seatForPoint(400, 599, SIZE, 'horizontal', 'p1')).toBe('p1');
    expect(seatForPoint(400, 1, SIZE, 'horizontal', 'p1')).toBe('p2');
    expect(seatForPoint(0, 600, SIZE, 'horizontal', 'p1')).toBe('p1');
    expect(seatForPoint(800, 0, SIZE, 'horizontal', 'p1')).toBe('p2');
  });

  it('gives the left half to the bottom seat under a vertical split', () => {
    expect(seatForPoint(1, 300, SIZE, 'vertical', 'p1')).toBe('p1');
    expect(seatForPoint(799, 300, SIZE, 'vertical', 'p1')).toBe('p2');
    expect(seatForPoint(0, 0, SIZE, 'vertical', 'p1')).toBe('p1');
    expect(seatForPoint(800, 600, SIZE, 'vertical', 'p1')).toBe('p2');
  });

  it('awards a point exactly on the divider to the bottom seat', () => {
    expect(seatForPoint(400, 300, SIZE, 'horizontal', 'p1')).toBe('p1');
    expect(seatForPoint(400, 300, SIZE, 'horizontal', 'p2')).toBe('p2');
    expect(seatForPoint(400, 300, SIZE, 'vertical', 'p1')).toBe('p1');
    expect(seatForPoint(400, 300, SIZE, 'vertical', 'p2')).toBe('p2');
  });

  it('follows the bottom seat when p2 sits at the bottom', () => {
    expect(seatForPoint(400, 599, SIZE, 'horizontal', 'p2')).toBe('p2');
    expect(seatForPoint(400, 1, SIZE, 'horizontal', 'p2')).toBe('p1');
    expect(seatForPoint(1, 300, SIZE, 'vertical', 'p2')).toBe('p2');
    expect(seatForPoint(799, 300, SIZE, 'vertical', 'p2')).toBe('p1');
  });

  it('never leaves a point unowned along the divider', () => {
    for (let x = 0; x <= 800; x += 50) {
      const seat = seatForPoint(x, SIZE.height / 2, SIZE, 'horizontal', 'p1');
      expect(seat).toBe('p1');
    }
  });
});

describe('PointerOwnership', () => {
  it('keeps the starting seat after the pointer crosses the divider', () => {
    const owners = new PointerOwnership();
    const startSeat = seatForPoint(400, 590, SIZE, 'horizontal', 'p1');
    owners.claim(7, startSeat);

    // The finger drags into the far seat's zone; ownership must not follow it.
    const crossedSeat = seatForPoint(400, 10, SIZE, 'horizontal', 'p1');
    expect(crossedSeat).toBe('p2');
    expect(owners.seatOf(7)).toBe('p1');
    expect(owners.claim(7, crossedSeat)).toBe('p1');
    expect(owners.seatOf(7)).toBe('p1');
    expect(owners.activeCount).toBe(1);
  });

  it('returns the recorded seat from claim and does not steal on re-claim', () => {
    const owners = new PointerOwnership();
    expect(owners.claim(1, 'p2')).toBe('p2');
    expect(owners.claim(1, 'p1')).toBe('p2');
    expect(owners.claim(1, 'p1')).toBe('p2');
    expect(owners.seatOf(1)).toBe('p2');
  });

  it('reports no seat for an unknown pointer', () => {
    const owners = new PointerOwnership();
    expect(owners.seatOf(99)).toBeUndefined();
    expect(owners.activeCount).toBe(0);
  });

  it('frees an id on release, and the id may then be claimed by the other seat', () => {
    const owners = new PointerOwnership();
    owners.claim(3, 'p1');
    owners.release(3);
    expect(owners.seatOf(3)).toBeUndefined();
    expect(owners.activeCount).toBe(0);
    expect(owners.claim(3, 'p2')).toBe('p2');
    expect(owners.seatOf(3)).toBe('p2');
  });

  it('ignores releasing an id it never held', () => {
    const owners = new PointerOwnership();
    owners.claim(1, 'p1');
    owners.release(2);
    expect(owners.activeCount).toBe(1);
    expect(owners.seatOf(1)).toBe('p1');
  });

  it('tracks ten concurrent pointers independently', () => {
    const owners = new PointerOwnership();
    for (let id = 0; id < 10; id += 1) {
      const seat: SeatId = id % 2 === 0 ? 'p1' : 'p2';
      owners.claim(id, seat);
    }
    expect(owners.activeCount).toBe(10);
    for (let id = 0; id < 10; id += 1) {
      expect(owners.seatOf(id)).toBe(id % 2 === 0 ? 'p1' : 'p2');
    }

    owners.release(4);
    expect(owners.activeCount).toBe(9);
    expect(owners.seatOf(4)).toBeUndefined();
    expect(owners.seatOf(5)).toBe('p2');
    expect(owners.seatOf(6)).toBe('p1');
  });

  it('clears everything on releaseAll', () => {
    const owners = new PointerOwnership();
    for (let id = 0; id < 10; id += 1) {
      owners.claim(id, 'p1');
    }
    owners.releaseAll();
    expect(owners.activeCount).toBe(0);
    for (let id = 0; id < 10; id += 1) {
      expect(owners.seatOf(id)).toBeUndefined();
    }
    expect(owners.claim(0, 'p2')).toBe('p2');
  });
});

describe('seatRotated', () => {
  /**
   * The same answer as `seatView().rotated`, as a primitive.
   *
   * This exists because every one of the thirty-one call sites in the catalogue wanted only
   * the boolean and asked for it from `update()` — once per fixed step, per game — while
   * `seatView` returns a fresh object. That is rule 5, and nothing was catching it; the
   * doc comment on `seatView` even asserted it was "called on presentation changes, not per
   * frame", which was true when it was written and false by the thirty-first game.
   */
  it('agrees with seatView for every seat and presentation', () => {
    for (const seat of ['p1', 'p2'] as const) {
      for (const localSeat of ['p1', 'p2'] as const) {
        for (const presentation of ['shared-screen', 'single-seat'] as const) {
          expect(seatRotated(seat, presentation, localSeat)).toBe(
            seatView(seat, presentation, localSeat).rotated,
          );
        }
      }
    }
  });

  it('never rotates in single-seat, where the local player owns the whole viewport', () => {
    for (const seat of ['p1', 'p2'] as const) {
      for (const localSeat of ['p1', 'p2'] as const) {
        expect(seatRotated(seat, 'single-seat', localSeat)).toBe(false);
      }
    }
  });

  it('rotates exactly the seat that is not the local one, in shared-screen', () => {
    expect(seatRotated('p2', 'shared-screen', 'p1')).toBe(true);
    expect(seatRotated('p1', 'shared-screen', 'p1')).toBe(false);
    expect(seatRotated('p1', 'shared-screen', 'p2')).toBe(true);
    expect(seatRotated('p2', 'shared-screen', 'p2')).toBe(false);
  });
});
