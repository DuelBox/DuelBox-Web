import { describe, expect, it } from 'vitest';
import { GamepadManager, type GamepadSnapshot, type InputFamily } from '@duelbox/engine';
import { InputLatency } from './InputLatency';

function harness(initiallyHeld = false) {
  let now = 100;
  const meter = new InputLatency(() => now);
  const pads: GamepadSnapshot[] = [
    { index: 0, id: 'A', connected: true, axes: [0, 0], buttons: [initiallyHeld, false] },
    { index: 1, id: 'B', connected: true, axes: [0, 0], buttons: [false, false] },
    { index: 2, id: 'unassigned', connected: true, axes: [0, 0], buttons: [false] },
  ];
  const native = pads.map((pad) => ({ ...pad, timestamp: 90 })) as unknown as Gamepad[];
  const gamepads = new GamepadManager(() => pads);
  const step = (at: number, live = true) => {
    now = at;
    meter.captureGamepads(native);
    gamepads.poll();
    meter.step(gamepads, live);
  };
  const change = (index: number, timestamp: number, axes = [0, 0], buttons = [false, false]) => {
    const pad = pads[index];
    if (pad === undefined) throw new Error('missing fixture');
    pads[index] = { ...pad, axes, buttons };
    native[index] = { ...native[index], timestamp } as Gamepad;
  };
  const stats = (family: InputFamily) => {
    const result = meter.readings().find((reading) => reading.family === family);
    if (result === undefined) throw new Error('missing family');
    return result;
  };
  step(100);
  return { meter, gamepads, change, step, stats };
}

describe('host input latency', () => {
  it('does not time a held controller that predates attaching the meter', () => {
    const h = harness(true);
    h.step(200);
    expect(h.stats('gamepad').samples).toBe(0);
    h.change(0, 205, [0, 0], [false, false]);
    h.step(210);
    expect(h.stats('gamepad')).toMatchObject({ samples: 1, lastMs: 5 });
  });
  it('records source event time only when a step consumes it, with separate families', () => {
    const h = harness();
    h.meter.key('KeyD', true, 85);
    h.meter.pointer(1, 'down', 92);
    expect(h.stats('keyboard').samples).toBe(0);
    h.step(110);
    expect(h.stats('keyboard')).toMatchObject({ samples: 1, lastMs: 25 });
    expect(h.stats('pointer')).toMatchObject({ samples: 1, lastMs: 18 });
    expect(h.stats('gamepad').samples).toBe(0);
    h.step(130);
    expect(h.stats('keyboard').samples).toBe(1);
  });

  it('measures the earliest event in a burst and ignores key repeats and pointer hover', () => {
    const h = harness();
    h.meter.key('KeyD', true, 80);
    h.meter.key('KeyS', true, 95);
    h.meter.pointer(1, 'move', 90);
    h.meter.pointer(1, 'up', 95);
    h.step(110);
    expect(h.stats('keyboard').lastMs).toBe(30);
    expect(h.stats('pointer').samples).toBe(0);
    h.meter.key('KeyD', true, 110);
    h.step(120);
    expect(h.stats('keyboard').samples).toBe(1);
    h.meter.key('KeyD', false, 115);
    h.step(125);
    expect(h.stats('keyboard')).toMatchObject({ samples: 2, lastMs: 10 });
  });

  it('includes pointer drag and release only for a tracked pointer', () => {
    const h = harness();
    h.meter.pointer(1, 'down', 95);
    h.step(110);
    h.meter.pointer(1, 'move', 105);
    h.step(120);
    h.meter.pointer(1, 'up', 115);
    h.step(130);
    h.meter.pointer(1, 'move', 125);
    h.step(140);
    expect(h.stats('pointer')).toMatchObject({ samples: 3, lastMs: 15 });
  });

  it.each([0, -1, NaN, Infinity, 101, 1_700_000_000_000])(
    'omits unavailable DOM timestamp %s instead of manufacturing a zero',
    (timestamp) => {
      const h = harness();
      h.meter.key('KeyD', true, timestamp);
      h.meter.pointer(1, 'down', timestamp);
      h.step(110);
      expect(h.stats('keyboard').samples).toBe(0);
      expect(h.stats('pointer').samples).toBe(0);
    },
  );

  it('measures a changed assigned pad from its sample timestamp, only once', () => {
    const h = harness();
    h.change(0, 104, [1, 0]);
    h.step(112);
    expect(h.stats('gamepad')).toMatchObject({ samples: 1, lastMs: 8 });
    h.step(125);
    h.change(0, 130, [1, 0]); // platform refreshes an unchanged held stick
    h.step(135);
    expect(h.stats('gamepad').samples).toBe(1);
  });

  it('ignores unassigned pads, unmapped buttons and sub-envelope stick changes', () => {
    const h = harness();
    h.change(2, 105, [1, 0], [true]);
    h.change(0, 106, [0.05, 0], [false, true]);
    h.step(110);
    expect(h.stats('gamepad').samples).toBe(0);
    h.change(0, 115, [0.5, 0]);
    h.step(120);
    h.change(0, 125, [0.5001, 0]);
    h.step(130);
    expect(h.stats('gamepad').samples).toBe(1);
  });

  it.each([0, NaN, Infinity, 200, 1_700_000_000_000])(
    'recovers after unavailable gamepad timestamp %s and ignores stale samples',
    (timestamp) => {
      const h = harness();
      h.change(0, timestamp, [1, 0]);
      h.step(110);
      expect(h.stats('gamepad').samples).toBe(0);
      h.change(0, 115, [0, 1]);
      h.step(120);
      expect(h.stats('gamepad')).toMatchObject({ samples: 1, lastMs: 5 });
      h.change(0, 105, [-1, 0]);
      h.step(130);
      h.change(0, 115, [1, 0]);
      h.step(140);
      expect(h.stats('gamepad').samples).toBe(1);
    },
  );

  it('primes an attached/reassigned/just-resumed pad without timing its old held sample', () => {
    const h = harness();
    h.change(0, 105, [1, 0]);
    h.step(110);
    h.gamepads.reassign('p2', 0);
    h.step(120);
    h.meter.clear();
    h.step(1000);
    expect(h.stats('gamepad').samples).toBe(1);
    h.change(0, 1005, [0, 1]);
    h.step(1010);
    expect(h.stats('gamepad')).toMatchObject({ samples: 2, lastMs: 5 });
  });

  it('discards pending input on pause/clear and primes countdown pad changes', () => {
    const h = harness();
    h.meter.key('KeyD', true, 95);
    h.step(110);
    h.meter.key('KeyS', true, 105);
    h.meter.pointer(1, 'down', 106);
    h.meter.clear();
    h.step(1000);
    expect(h.stats('keyboard').samples).toBe(1);
    expect(h.stats('pointer').samples).toBe(0);
    h.change(0, 1005, [1, 0]);
    h.step(1010, false);
    h.step(1020);
    expect(h.stats('gamepad').samples).toBe(0);
    h.meter.key('KeyD', true, 1015);
    h.step(1030);
    expect(h.stats('keyboard')).toMatchObject({ samples: 2, lastMs: 15 });
  });
});
