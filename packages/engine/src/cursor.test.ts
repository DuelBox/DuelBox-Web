import { describe, expect, it } from 'vitest';
import { GridCursor } from './cursor.js';
import { toScreen, toWorld } from './seat.js';
import { vec2 } from './vec2.js';

const STEP = 1 / 60;

/** Holds a direction for a number of steps, returning how many times it moved. */
function hold(cursor: GridCursor, x: number, y: number, steps: number, rotated = false): number {
  let moves = 0;
  for (let i = 0; i < steps; i += 1) {
    if (cursor.step(x, y, STEP, rotated)) moves += 1;
  }
  return moves;
}

describe('where it starts', () => {
  it('starts in the middle of the grid by default', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    expect(cursor.index).toBe(4);
    expect(cursor.column).toBe(1);
    expect(cursor.row).toBe(1);
  });

  it('starts where it is told', () => {
    expect(new GridCursor({ columns: 7, rows: 6, startIndex: 0 }).index).toBe(0);
  });

  it('rejects a grid or a start that makes no sense', () => {
    expect(() => new GridCursor({ columns: 0, rows: 3 })).toThrow(RangeError);
    expect(() => new GridCursor({ columns: 3, rows: 2.5 })).toThrow(RangeError);
    expect(() => new GridCursor({ columns: 3, rows: 3, startIndex: 9 })).toThrow(RangeError);
    expect(() => new GridCursor({ columns: 3, rows: 3, startIndex: -1 })).toThrow(RangeError);
  });
});

describe('staying out of the way until it is wanted', () => {
  it('is invisible until a direction is pressed', () => {
    // A player who has only ever tapped must never see a highlight they did not summon.
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    expect(cursor.visible).toBe(false);
    cursor.step(0, 0, STEP);
    expect(cursor.visible).toBe(false);
  });

  it('appears the moment one is', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    cursor.step(1, 0, STEP);
    expect(cursor.visible).toBe(true);
  });

  it('stays visible once summoned, even when the key is let go', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    cursor.step(1, 0, STEP);
    cursor.step(0, 0, STEP);
    expect(cursor.visible).toBe(true);
  });

  it('goes away again on reset', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    cursor.step(1, 0, STEP);
    cursor.reset();
    expect(cursor.visible).toBe(false);
    expect(cursor.index).toBe(4);
  });

  it('can be moved by a pointer without becoming visible', () => {
    // A tap should put the cursor where the finger went, so that switching to keys
    // continues from there — but it must not raise a highlight on a touch device.
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    cursor.moveTo(0);
    expect(cursor.index).toBe(0);
    expect(cursor.visible).toBe(false);
  });
});

describe('moving', () => {
  it('moves one cell on a fresh press, not a run of them', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    expect(cursor.step(1, 0, STEP)).toBe(true);
    expect(cursor.index).toBe(5);
    // Same direction still held, well inside the repeat delay.
    expect(hold(cursor, 1, 0, 10)).toBe(0);
    expect(cursor.index).toBe(5);
  });

  it('repeats when the direction is held, the way a text cursor does', () => {
    const cursor = new GridCursor({ columns: 9, rows: 1, startIndex: 0, wrap: false });
    const moves = hold(cursor, 1, 0, 120);
    expect(moves).toBeGreaterThan(1);
    expect(cursor.index).toBeGreaterThan(1);
  });

  it('treats a direction below the dead zone as nothing at all', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    expect(cursor.step(0.3, 0, STEP)).toBe(false);
    expect(cursor.visible).toBe(false);
  });

  it('quantises, so a thumbstick and a key move the same distance', () => {
    const gentle = new GridCursor({ columns: 3, rows: 3 });
    const firm = new GridCursor({ columns: 3, rows: 3 });
    gentle.step(0.7, 0, STEP);
    firm.step(1, 0, STEP);
    expect(gentle.index).toBe(firm.index);
  });

  it('stops at the edge rather than running off it', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3, startIndex: 2 });
    hold(cursor, 1, 0, 200);
    expect(cursor.column).toBe(2);
    expect(cursor.row).toBe(0);
  });

  it('wraps when asked to', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3, startIndex: 2, wrap: true });
    cursor.step(1, 0, STEP);
    expect(cursor.column).toBe(0);
  });

  it('moves diagonally in one step', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    cursor.step(1, 1, STEP);
    expect(cursor.index).toBe(8);
  });

  it('never leaves the grid, whatever is thrown at it', () => {
    const cursor = new GridCursor({ columns: 4, rows: 5 });
    const directions = [1, -1, 0];
    for (let i = 0; i < 400; i += 1) {
      const x = directions[i % 3] ?? 0;
      const y = directions[(i * 7) % 3] ?? 0;
      cursor.step(x, y, STEP, i % 2 === 0);
      expect(cursor.index).toBeGreaterThanOrEqual(0);
      expect(cursor.index).toBeLessThan(20);
    }
  });
});

describe('the far seat, reading the board upside down', () => {
  it('moves the cursor the way that player sees it', () => {
    // The far seat presses "right"; the board's right is their left.
    const upright = new GridCursor({ columns: 3, rows: 3 });
    const rotated = new GridCursor({ columns: 3, rows: 3 });
    upright.step(1, 0, STEP, false);
    rotated.step(1, 0, STEP, true);
    expect(upright.column).toBe(2);
    expect(rotated.column).toBe(0);
  });

  it('inverts both axes, not just one', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    cursor.step(0, 1, STEP, true);
    expect(cursor.row).toBe(0);
  });

  it('is its own inverse: two rotated moves land where two upright ones would not', () => {
    const cursor = new GridCursor({ columns: 5, rows: 5, startIndex: 12 });
    cursor.step(1, 1, STEP, true);
    expect(cursor.column).toBe(1);
    expect(cursor.row).toBe(1);
  });

  /**
   * The meaning of `rotated`, pinned (#2521).
   *
   * A key is absolute in device space and a pointer is a device-space point; both reach a
   * rotated board through the same half turn. So a press "down the device" and a tap one
   * cell down the device from the cursor must name the same cell, whether or not the board
   * is drawn rotated. If the cursor ever inverted for a reason `toWorld` did not, this is
   * the test that would say so — the earlier ones only assert that inversion happens.
   */
  it.each([false, true])(
    'agrees with toWorld about a device-down press (rotated: %s)',
    (rotated) => {
      const columns = 3;
      const rows = 3;
      const size = { width: 3, height: 3 };
      const cursor = new GridCursor({ columns, rows, startIndex: 4 });

      // The cell the cursor sits on, at its centre, in device space: the board is drawn
      // through the same rotation the cursor is told about.
      const before = toScreen(vec2(), cursor.column + 0.5, cursor.row + 0.5, size, rotated);
      // One cell down the device from there, taken back into board coordinates.
      const tapped = toWorld(vec2(), before.x, before.y + 1, size, rotated);
      const expectedRow = Math.floor(tapped.y);
      const expectedColumn = Math.floor(tapped.x);

      cursor.step(0, 1, STEP, rotated);
      expect(cursor.row).toBe(expectedRow);
      expect(cursor.column).toBe(expectedColumn);
    },
  );
});

describe('determinism', () => {
  it('is driven by the fixed delta, not the wall clock', () => {
    const a = new GridCursor({ columns: 9, rows: 1, startIndex: 0 });
    const b = new GridCursor({ columns: 9, rows: 1, startIndex: 0 });
    hold(a, 1, 0, 120);
    hold(b, 1, 0, 120);
    expect(a.index).toBe(b.index);
  });

  it('rejects a negative step', () => {
    const cursor = new GridCursor({ columns: 3, rows: 3 });
    expect(() => cursor.step(1, 0, -1)).toThrow(RangeError);
  });
});
