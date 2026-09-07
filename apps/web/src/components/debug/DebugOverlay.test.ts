import { describe, expect, it } from 'vitest';
import { formatDebugReading, type DebugReading } from './DebugOverlay';

/**
 * The arithmetic, which is the only part of the overlay that can be wrong invisibly.
 *
 * Everything else about it is obvious on sight — the box is in the corner or it is not, the
 * pointer row says what your finger is doing or it does not. A frame rate is different: a
 * plausible number and a correct one look exactly alike, and the whole reason somebody opens
 * this thing is to trust the number over their own impression of the frame rate.
 *
 * The DOM half is not tested here. The unit suite runs in Node with no DOM by house rule,
 * and the half worth guarding is the half that does sums.
 */

function reading(over: Partial<DebugReading> = {}): DebugReading {
  return {
    at: 0,
    frames: 0,
    steps: 0,
    stepMs: 1000 / 60,
    running: true,
    seats: [],
    ...over,
  };
}

describe('the read-out', () => {
  it('has no rate to report from a single reading', () => {
    // Blank rather than zero, because "0 fps" is a thing this overlay has to be able to say
    // truthfully when the loop has stopped, and it must not also be what it says at startup.
    const [rates] = formatDebugReading(reading(), null);
    expect(rates).toContain('fps --');
    expect(rates).toContain('-- actual');
  });

  it('turns two readings into a frame rate', () => {
    const first = reading({ at: 1000, frames: 100 });
    const second = reading({ at: 1250, frames: 115 });
    // Fifteen frames in a quarter of a second is sixty a second.
    expect(formatDebugReading(second, first)[0]).toContain('fps 60.0');
  });

  it('measures the wall time a simulation step is actually taking', () => {
    // Fifteen steps in 250ms is the loop keeping up with a 60Hz fixed step; the two numbers
    // agreeing is the thing a reader is checking for.
    const first = reading({ at: 1000, steps: 600 });
    const second = reading({ at: 1250, steps: 615 });
    expect(formatDebugReading(second, first)[0]).toContain('16.67ms actual');
  });

  it('shows the measured step running long when the loop falls behind', () => {
    // Ten steps where fifteen were owed: `FixedLoop` caps the steps it will run in one frame
    // and drops the remainder, so simulation time falls behind wall time. That is the
    // symptom somebody opens this overlay to see, so it has to survive the arithmetic.
    const first = reading({ at: 1000, steps: 600 });
    const second = reading({ at: 1250, steps: 610 });
    expect(formatDebugReading(second, first)[0]).toContain('25.00ms actual');
  });

  it('reports no rate when the counters go backwards', () => {
    // A rebuilt host restarts both counters. A negative window is not a slow frame, and
    // reporting one as a rate would put a large negative number on screen mid-match.
    const first = reading({ at: 2000, frames: 500, steps: 500 });
    const second = reading({ at: 1000, frames: 0, steps: 0 });
    expect(formatDebugReading(second, first)[0]).toContain('fps --');
  });

  it('says when the loop is not running at all', () => {
    expect(formatDebugReading(reading({ running: false }), null)[1]).toContain('loop stopped');
    expect(formatDebugReading(reading({ steps: 42 }), null)[1]).toContain('steps 42');
  });

  it('adds a latency row per measured family and omits an unmeasured one (#133)', () => {
    const lines = formatDebugReading(
      reading({
        latency: [
          { family: 'keyboard', samples: 30, meanMs: 8.2, lastMs: 9, maxMs: 14 },
          { family: 'pointer', samples: 12, meanMs: 11.5, lastMs: 10, maxMs: 20 },
          // Never pressed: no sample, so no row — "0.00ms" would read as "instant".
          { family: 'gamepad', samples: 0, meanMs: 0, lastMs: 0, maxMs: 0 },
        ],
      }),
      null,
    );
    expect(lines).toHaveLength(4); // fps, steps, (no seats), keyboard, pointer
    expect(lines[2]).toBe('lat keyboard 8.20ms mean  9.00 last  14.00 max  n=30');
    expect(lines[3]).toBe('lat pointer  11.50ms mean  10.00 last  20.00 max  n=12');
    expect(lines.some((l) => l.includes('gamepad'))).toBe(false);
  });

  it('adds no latency rows when no meter is attached', () => {
    const lines = formatDebugReading(reading(), null);
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.startsWith('lat'))).toBe(false);
  });

  it('gives each seat a row saying what it is pressing', () => {
    const lines = formatDebugReading(
      reading({
        seats: [
          {
            seat: 'p1',
            moveX: -1,
            moveY: 0,
            actionHeld: true,
            holdSeconds: 0.4,
            pointer: null,
            pointerCount: 0,
          },
          {
            seat: 'p2',
            moveX: 0,
            moveY: 0,
            actionHeld: false,
            holdSeconds: 0,
            pointer: { x: 312.4, y: 480.6 },
            pointerCount: 3,
          },
        ],
      }),
      null,
    );
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe('p1 move -1.00,+0.00  action held 0.40s pointer none');
    // The finger count appears only above one, and the position is in logical units — the
    // overlay must never be the one place in the product that reports pixels (rule 8).
    expect(lines[3]).toBe('p2 move +0.00,+0.00  action up         pointer 312,481 x3');
  });
});
