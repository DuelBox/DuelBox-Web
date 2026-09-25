import { describe, expect, it } from 'vitest';
import { LatencyMeter } from './latency.js';

describe('LatencyMeter (#133)', () => {
  it('measures the gap from an event to the step that consumes it', () => {
    const meter = new LatencyMeter();
    meter.markEvent('keyboard', 100);
    meter.consume(108); // the step ran 8ms after the keydown
    const stats = meter.stats('keyboard');
    expect(stats.samples).toBe(1);
    expect(stats.lastMs).toBe(8);
    expect(stats.meanMs).toBe(8);
    expect(stats.minMs).toBe(8);
    expect(stats.maxMs).toBe(8);
  });

  it('keeps families separate', () => {
    const meter = new LatencyMeter();
    meter.markEvent('keyboard', 100);
    meter.markEvent('pointer', 104);
    meter.consume(110);
    expect(meter.stats('keyboard').lastMs).toBe(10);
    expect(meter.stats('pointer').lastMs).toBe(6);
    expect(meter.stats('gamepad').samples).toBe(0);
  });

  it('attributes the worst case when several events land in one window', () => {
    const meter = new LatencyMeter();
    meter.markEvent('keyboard', 100);
    meter.markEvent('keyboard', 105); // later; the earliest still governs
    meter.markEvent('keyboard', 103);
    meter.consume(110);
    expect(meter.stats('keyboard').samples).toBe(1);
    expect(meter.stats('keyboard').lastMs).toBe(10); // measured from the earliest, 100
  });

  it('accumulates a mean, min and max across samples', () => {
    const meter = new LatencyMeter();
    meter.markEvent('pointer', 0);
    meter.consume(4); // 4ms
    meter.markEvent('pointer', 100);
    meter.consume(112); // 12ms
    meter.markEvent('pointer', 200);
    meter.consume(208); // 8ms
    const stats = meter.stats('pointer');
    expect(stats.samples).toBe(3);
    expect(stats.minMs).toBe(4);
    expect(stats.maxMs).toBe(12);
    expect(stats.meanMs).toBeCloseTo((4 + 12 + 8) / 3, 6);
    expect(stats.lastMs).toBe(8);
  });

  it('does not record a sample for a step that consumed no event', () => {
    const meter = new LatencyMeter();
    meter.consume(50);
    expect(meter.stats('keyboard').samples).toBe(0);
    expect(meter.hasPending).toBe(false);
  });

  it('floors a negative measurement at zero rather than recording it', () => {
    const meter = new LatencyMeter();
    meter.markEvent('gamepad', 200);
    meter.consume(190); // step time before the event: a clock quirk
    expect(meter.stats('gamepad').lastMs).toBe(0);
  });

  it('reports a pending event until the next step consumes it', () => {
    const meter = new LatencyMeter();
    meter.markEvent('keyboard', 10);
    expect(meter.hasPending).toBe(true);
    meter.consume(20);
    expect(meter.hasPending).toBe(false);
  });

  it('forgets everything on reset', () => {
    const meter = new LatencyMeter();
    meter.markEvent('keyboard', 0);
    meter.consume(5);
    meter.reset();
    expect(meter.stats('keyboard').samples).toBe(0);
    expect(meter.hasPending).toBe(false);
  });
});
