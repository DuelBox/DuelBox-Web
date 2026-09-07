import { describe, expect, it } from 'vitest';
import { OFFLINE_SAMPLE_RATE, renderRecipe, seedFromName, voice } from './synth.js';
import type { AudioSampleBuffer } from './audio.js';
import type { SynthRecipe, SynthTarget, Waveform } from './synth.js';

/**
 * The renderer is the whole reason this product ships no audio files, so what is checked
 * here is not "does it make a noise" — nothing in Node can hear it — but the four
 * properties that make synthesised sound safe to ship:
 *
 * 1. It is **deterministic**, sample for sample, so two devices in a cross-device match
 *    cannot end up with different sounds and no future test can be flaky.
 * 2. It stays **inside [-1, 1]**, so stacking three voices cannot clip the output.
 * 3. It **starts and ends at silence**, so a buffer cannot click.
 * 4. It uses **no `Math.random`**, which lint enforces, and no ambient state, which this
 *    file enforces by rendering the same recipe from two separate targets.
 */

class OfflineBuffer implements AudioSampleBuffer {
  readonly #channels: Float32Array[];

  constructor(
    channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.#channels = Array.from({ length: channels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.#channels[channel];
    if (data === undefined) throw new RangeError(`no channel ${String(channel)}`);
    return data;
  }
}

class OfflineTarget implements SynthTarget {
  constructor(readonly sampleRate: number = OFFLINE_SAMPLE_RATE) {}

  createBuffer(channels: number, length: number, sampleRate: number): AudioSampleBuffer {
    return new OfflineBuffer(channels, length, sampleRate);
  }
}

function tone(wave: Waveform, level = 0.6): SynthRecipe {
  return {
    seconds: 0.1,
    voices: [voice(wave, 440, 440, 0, 0.005, 0.02, 0.05, level)],
  };
}

const WAVES: readonly Waveform[] = ['sine', 'square', 'saw', 'triangle', 'noise'];

describe('renderRecipe', () => {
  it('renders a mono buffer of the requested length', () => {
    const buffer = renderRecipe(new OfflineTarget(), 'hit', tone('sine'));
    expect(buffer.length).toBe(Math.round(0.1 * OFFLINE_SAMPLE_RATE));
    expect(buffer.sampleRate).toBe(OFFLINE_SAMPLE_RATE);
    expect(buffer.duration).toBeCloseTo(0.1, 5);
  });

  it.each(WAVES)('renders %s to bit-identical samples every time', (wave) => {
    // Two separate targets, so nothing carried between the renders can explain the match:
    // if the generator kept state anywhere outside the call, these would diverge.
    const first = renderRecipe(new OfflineTarget(), 'hit', tone(wave)).getChannelData(0);
    const second = renderRecipe(new OfflineTarget(), 'hit', tone(wave)).getChannelData(0);
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it('gives two names different noise', () => {
    const a = renderRecipe(new OfflineTarget(), 'hit', tone('noise')).getChannelData(0);
    const b = renderRecipe(new OfflineTarget(), 'bounce', tone('noise')).getChannelData(0);
    expect(Array.from(b)).not.toEqual(Array.from(a));
  });

  it.each(WAVES)('keeps %s inside [-1, 1]', (wave) => {
    const samples = renderRecipe(new OfflineTarget(), 'hit', tone(wave, 1)).getChannelData(0);
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(-1);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });

  it('keeps three stacked voices at full level inside [-1, 1]', () => {
    // The clipping case the soft knee exists for: three loud voices whose peaks coincide.
    const stacked: SynthRecipe = {
      seconds: 0.1,
      voices: [tone('saw', 1), tone('square', 1), tone('sine', 1)].flatMap((r) => r.voices),
    };
    const samples = renderRecipe(new OfflineTarget(), 'win', stacked).getChannelData(0);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('starts and ends at silence, so a buffer cannot click', () => {
    // A square wave is the worst case: without the edge fade its first sample is 1.
    const samples = renderRecipe(new OfflineTarget(), 'fault', tone('square', 1)).getChannelData(0);
    expect(samples[0]).toBe(0);
    expect(samples[samples.length - 1]).toBe(0);
  });

  it('renders silence for a recipe with no voices', () => {
    const samples = renderRecipe(new OfflineTarget(), 'quiet', {
      seconds: 0.05,
      voices: [],
    }).getChannelData(0);
    for (const sample of samples) expect(sample).toBe(0);
  });

  it('holds a delayed voice silent until its delay has passed', () => {
    const delayed: SynthRecipe = {
      seconds: 0.2,
      voices: [voice('sine', 440, 440, 0.1, 0.002, 0.02, 0.05, 0.8)],
    };
    const samples = renderRecipe(new OfflineTarget(), 'win', delayed).getChannelData(0);
    const beforeDelay = samples.subarray(0, Math.floor(0.09 * OFFLINE_SAMPLE_RATE));
    for (const sample of beforeDelay) expect(sample).toBe(0);
    let after = 0;
    for (const sample of samples.subarray(Math.floor(0.1 * OFFLINE_SAMPLE_RATE))) {
      after = Math.max(after, Math.abs(sample));
    }
    expect(after).toBeGreaterThan(0.1);
  });

  it('sweeps pitch without a discontinuity', () => {
    // A swept voice whose phase was recomputed from `t * f` each sample rather than
    // accumulated would show sample-to-sample jumps far larger than one cycle's worth.
    const swept: SynthRecipe = {
      seconds: 0.2,
      voices: [voice('sine', 200, 1600, 0, 0.01, 0.05, 0.13, 0.8)],
    };
    const samples = renderRecipe(new OfflineTarget(), 'launch', swept).getChannelData(0);
    let biggestStep = 0;
    for (let i = 1; i < samples.length; i += 1) {
      biggestStep = Math.max(biggestStep, Math.abs(samples[i]! - samples[i - 1]!));
    }
    // 1600 Hz at 48 kHz is 30 samples per cycle, so no honest step exceeds about 0.21.
    expect(biggestStep).toBeLessThan(0.3);
  });

  it('renders at whatever rate the context runs at', () => {
    const buffer = renderRecipe(new OfflineTarget(44_100), 'hit', tone('sine'));
    expect(buffer.sampleRate).toBe(44_100);
    expect(buffer.length).toBe(Math.round(0.1 * 44_100));
  });

  it('never renders an empty buffer, however short the recipe', () => {
    const buffer = renderRecipe(new OfflineTarget(), 'hit', { seconds: 0, voices: [] });
    expect(buffer.length).toBe(1);
  });

  it('survives a recipe with a nonsensical pitch rather than producing NaN', () => {
    // A zero endpoint has no logarithm. A recipe should not be able to poison the buffer.
    const samples = renderRecipe(new OfflineTarget(), 'hit', {
      seconds: 0.05,
      voices: [voice('sine', 0, 440, 0, 0.005, 0.01, 0.02, 0.5)],
    }).getChannelData(0);
    for (const sample of samples) expect(Number.isFinite(sample)).toBe(true);
  });

  it('treats a zero-length envelope as silence rather than dividing by zero', () => {
    const samples = renderRecipe(new OfflineTarget(), 'hit', {
      seconds: 0.05,
      voices: [voice('sine', 440, 440, 0, 0, 0, 0, 0.5)],
    }).getChannelData(0);
    for (const sample of samples) expect(Number.isFinite(sample)).toBe(true);
  });
});

describe('seedFromName', () => {
  it('is stable for a name', () => {
    expect(seedFromName('hit')).toBe(seedFromName('hit'));
  });

  it('separates names', () => {
    expect(seedFromName('hit')).not.toBe(seedFromName('bounce'));
  });

  it('is never zero, so a zero seed always means a bug upstream', () => {
    for (const name of ['', 'a', 'hit', 'bounce', 'countdown', '\0\0\0\0']) {
      expect(seedFromName(name)).not.toBe(0);
    }
  });
});
