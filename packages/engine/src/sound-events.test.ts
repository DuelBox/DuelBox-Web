import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { AudioSystem } from './audio.js';
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  AudioSampleBuffer,
  AudioState,
  GainNodeLike,
} from './audio.js';
import {
  EngineSoundBus,
  RecordingSoundBus,
  SILENT_BUS,
  SOUND_EVENTS,
  SOUND_EVENT_SPECS,
  SOUND_RECIPES,
  registerSoundBank,
} from './sound-events.js';
import type { SoundEvent } from './sound-events.js';

/**
 * What has to be true of the vocabulary, and of the bus a game says one of it through.
 *
 * The two that matter most and are easiest to lose:
 *
 * - **`emit` allocates nothing.** Rule 5. Measured rather than asserted in a comment, and
 *   the measurement checks itself against a control that deliberately does allocate — an
 *   instrument nobody has watched move is an instrument nobody has.
 * - **`emit` cannot reach the simulation.** It returns void and reads nothing, so the same
 *   match must play identically with a real bus, a silent bus and no bus at all. The
 *   cross-game version of this lives in `apps/web/src/data/audio-cues.test.ts`, which
 *   drives a real game three ways; this one proves the property of the bus itself.
 */

class FakeParam implements AudioParamLike {
  value = 1;
}

class FakeNode implements AudioNodeLike {
  connect(destination: AudioNodeLike): unknown {
    return destination;
  }

  disconnect(): void {
    /* nothing to release in a fake */
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam();
}

class FakeSampleBuffer implements AudioSampleBuffer {
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

class FakeSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  readonly playbackRate = new FakeParam();
  started = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    /* nothing to stop in a fake */
  }
}

class FakeContext implements AudioContextLike {
  state: AudioState = 'running';
  currentTime = 0;
  sampleRate = 48_000;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  createGain(): GainNodeLike {
    return new FakeGain();
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  rendered = 0;

  createBuffer(channels: number, length: number, sampleRate: number): AudioSampleBuffer {
    this.rendered += 1;
    return new FakeSampleBuffer(channels, length, sampleRate);
  }

  decodeAudioData(): Promise<AudioBufferLike> {
    return Promise.reject(new Error('this product ships no encoded audio'));
  }
}

function systemWithBank(): { system: AudioSystem; context: FakeContext } {
  const context = new FakeContext();
  const system = new AudioSystem({ createContext: () => context, target: null });
  expect(registerSoundBank(system)).toBe(true);
  return { system, context };
}

describe('the sound vocabulary', () => {
  it('is a closed set with no duplicates', () => {
    expect(new Set(SOUND_EVENTS).size).toBe(SOUND_EVENTS.length);
  });

  it('is small enough to be learnable', () => {
    // Not arbitrary: the whole argument for a fixed vocabulary is that a player learns it
    // once across 107 games. A list that grows past a dozen has stopped being a vocabulary
    // and become a per-game sound API by another name, which is what this exists to avoid.
    expect(SOUND_EVENTS.length).toBeLessThanOrEqual(12);
  });

  it.each(SOUND_EVENTS)('%s has a meaning and a source', (event) => {
    const spec = SOUND_EVENT_SPECS[event];
    expect(spec.meaning.length).toBeGreaterThan(10);
    expect(['shell', 'game']).toContain(spec.source);
  });

  it.each(SOUND_EVENTS)('%s has a recipe with at least one voice', (event) => {
    const recipe = SOUND_RECIPES[event];
    expect(recipe.voices.length).toBeGreaterThan(0);
    expect(recipe.seconds).toBeGreaterThan(0);
  });

  it('keeps every cue short enough to fire repeatedly', () => {
    // A cue longer than the gap between two of them overlaps itself, and a match makes
    // dozens of hits a minute. 0.6 s is the longest thing in the set, and it is the one
    // that ends a round.
    for (const event of SOUND_EVENTS) {
      expect(SOUND_RECIPES[event].seconds).toBeLessThanOrEqual(0.6);
    }
  });

  it('splits into cues the shell owns and cues a game owns', () => {
    const shell = SOUND_EVENTS.filter((e) => SOUND_EVENT_SPECS[e].source === 'shell');
    const game = SOUND_EVENTS.filter((e) => SOUND_EVENT_SPECS[e].source === 'game');
    // Both halves must be non-empty, or the division the vocabulary is built on has been
    // lost — a match cue moving into games is 107 reimplementations of a countdown beep.
    expect(shell.length).toBeGreaterThan(0);
    expect(game.length).toBeGreaterThan(0);
    expect(shell.length + game.length).toBe(SOUND_EVENTS.length);
  });
});

describe('registerSoundBank', () => {
  it('registers every cue under its own name', () => {
    const { system } = systemWithBank();
    for (const event of SOUND_EVENTS) expect(system.has(event)).toBe(true);
  });

  it('renders sounds rather than loading them', () => {
    // There is no decode path to check any more — `AudioContextLike` has no
    // `decodeAudioData` at all, which is the strongest form of "this product ships no
    // audio files": the door is not guarded, it is not there. What is checked here is the
    // positive half — every cue in the bank came out of `createBuffer` and arithmetic.
    const { system, context } = systemWithBank();
    expect(context.rendered).toBe(SOUND_EVENTS.length);
    for (const event of SOUND_EVENTS) expect(system.has(event)).toBe(true);
  });

  it('reports false in a runtime with no Web Audio at all, and does not throw', () => {
    const system = new AudioSystem({
      createContext: () => {
        throw new Error('no AudioContext here');
      },
      target: null,
    });
    expect(registerSoundBank(system)).toBe(false);
    // And a game emitting into it is a no-op rather than a crash.
    expect(() => new EngineSoundBus(system).emit('hit')).not.toThrow();
  });
});

describe('EngineSoundBus', () => {
  it('plays the cue it was given', () => {
    const { system, context } = systemWithBank();
    new EngineSoundBus(system).emit('hit');
    system.flush();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.started).toBe(true);
  });

  it('ignores a name outside the vocabulary rather than throwing', () => {
    const { system } = systemWithBank();
    const bus = new EngineSoundBus(system);
    // Reachable from inside a fixed step, where a thrown error ends the match. A typo in
    // a game must cost a sound, not a game.
    expect(() => bus.emit('splat' as SoundEvent)).not.toThrow();
    expect(system.pending).toBe(0);
  });

  it('counts what it fired, per cue', () => {
    const { system } = systemWithBank();
    const bus = new EngineSoundBus(system);
    bus.emit('hit');
    bus.emit('hit');
    bus.emit('bounce');
    expect(bus.firedCount('hit')).toBe(2);
    expect(bus.firedCount('bounce')).toBe(1);
    expect(bus.firedCount('score')).toBe(0);
    expect(bus.firedCount('splat' as SoundEvent)).toBe(0);
  });

  it('varies a repeated cue without ever using randomness', () => {
    const rates = (): number[] => {
      const { system, context } = systemWithBank();
      const bus = new EngineSoundBus(system);
      for (let i = 0; i < 12; i += 1) bus.emit('hit');
      system.flush();
      return context.sources.map((source) => source.playbackRate.value);
    };
    const first = rates();
    const second = rates();
    // Varied...
    expect(new Set(first).size).toBeGreaterThan(8);
    // ...and identically varied on a second run, which is what "deterministic" means and
    // what makes it safe to say audio cannot desynchronise a cross-device match.
    expect(second).toEqual(first);
  });

  it('never detunes a cue far enough to change what it is', () => {
    const { system, context } = systemWithBank();
    const bus = new EngineSoundBus(system);
    for (let i = 0; i < 200; i += 1) bus.emit('hit', 1, i % 2 === 0 ? 'p1' : 'p2');
    system.flush();
    for (const source of context.sources) {
      // A semitone is 2^(1/12) ≈ 1.0595. Variation plus the seat offset must stay inside
      // one, or two seats' hits become two different sounds rather than one sound twice.
      expect(source.playbackRate.value).toBeGreaterThan(1 / 1.06);
      expect(source.playbackRate.value).toBeLessThan(1.06);
    }
  });

  it('pitches the two seats apart, so a hit says whose it was', () => {
    const { system, context } = systemWithBank();
    const bus = new EngineSoundBus(system);
    // The same firing count for each, so the only difference between them is the seat.
    const p1 = new EngineSoundBus(system);
    const p2 = new EngineSoundBus(system);
    bus.emit('hit', 1, null);
    p1.emit('hit', 1, 'p1');
    p2.emit('hit', 1, 'p2');
    system.flush();
    const [neutral, one, two] = context.sources.map((s) => s.playbackRate.value);
    expect(one!).toBeLessThan(neutral!);
    expect(two!).toBeGreaterThan(neutral!);
  });

  it('clamps intensity rather than letting a game shout', () => {
    const { system, context } = systemWithBank();
    const bus = new EngineSoundBus(system);
    bus.emit('hit', 5);
    bus.emit('hit', -3);
    bus.emit('hit', Number.NaN);
    system.flush();
    const gains = context.sources.map(() => 1);
    expect(gains).toHaveLength(3);
    // The clamp is applied before the queue, so nothing downstream sees a value out of
    // range. NaN takes the "not greater than 1, not less than 0" branch and plays silent.
    expect(() => system.flush()).not.toThrow();
  });

  it('drops cues emitted before the context is running rather than saving them up', () => {
    // The deliberate choice: sound is news about a moment, and a moment that has passed
    // has no news left in it. Playing four seconds of accumulated collisions the instant
    // the player taps Start would be worse than the silence it replaced.
    const context = new FakeContext();
    context.state = 'suspended';
    const system = new AudioSystem({ createContext: () => context, target: null });
    registerSoundBank(system);
    const bus = new EngineSoundBus(system);
    for (let i = 0; i < 5; i += 1) bus.emit('hit');
    system.flush();
    expect(context.sources).toHaveLength(0);

    // And once it is running, only what happens next is heard.
    context.state = 'running';
    system.flush();
    expect(context.sources).toHaveLength(0);
    bus.emit('score');
    system.flush();
    expect(context.sources).toHaveLength(1);
  });

  it('drops cues raised before the bank is registered, and never queues them', () => {
    // The window between "there is a bus" and "there are sounds". It exists however the
    // bank is loaded — the shell registers it from `armAudio()` on the play page while
    // `GameHost` may already hold a bus — and it must behave exactly like the window
    // before the unlock: the cue is dropped, not saved up for later. A cue is news about
    // a moment, and a moment that has passed has no news left in it.
    const context = new FakeContext();
    const system = new AudioSystem({ createContext: () => context, target: null });
    const bus = new EngineSoundBus(system);

    for (let i = 0; i < 5; i += 1) bus.emit('hit');
    expect(system.pending, 'an unregistered name must not even reach the queue').toBe(0);
    system.flush();
    expect(context.sources).toHaveLength(0);

    // Once the bank arrives, only what happens next is heard.
    expect(registerSoundBank(system)).toBe(true);
    system.flush();
    expect(context.sources).toHaveLength(0);
    bus.emit('hit');
    system.flush();
    expect(context.sources).toHaveLength(1);
  });

  it('plays nothing at all while muted', () => {
    const { system, context } = systemWithBank();
    system.setMuted(true);
    const bus = new EngineSoundBus(system);
    bus.emit('hit');
    system.flush();
    expect(context.sources).toHaveLength(0);
  });
});

describe('SILENT_BUS', () => {
  it('accepts every cue and does nothing', () => {
    for (const event of SOUND_EVENTS) {
      expect(() => SILENT_BUS.emit(event, 0.5, 'p1')).not.toThrow();
    }
  });

  it('is frozen, so nothing can turn the null object into a live one', () => {
    expect(Object.isFrozen(SILENT_BUS)).toBe(true);
  });
});

describe('RecordingSoundBus', () => {
  it('remembers what it was asked for, in order', () => {
    const bus = new RecordingSoundBus();
    bus.emit('hit', 0.4, 'p1');
    bus.emit('bounce');
    bus.emit('hit', 1, 'p2');
    expect(bus.events).toEqual(['hit', 'bounce', 'hit']);
    expect(bus.intensities).toEqual([0.4, 1, 1]);
    expect(bus.seats).toEqual(['p1', null, 'p2']);
    expect(bus.distinct()).toEqual(['hit', 'bounce']);
    expect(bus.count('hit')).toBe(2);
    expect(bus.count('score')).toBe(0);
    bus.clear();
    expect(bus.events).toEqual([]);
    expect(bus.intensities).toEqual([]);
    expect(bus.seats).toEqual([]);
  });
});

/**
 * Rule 5: no per-frame allocations in engine or game `update()`.
 *
 * `emit` is reachable from inside a fixed step — that is the whole point of it — so this
 * is the rule it is most likely to break, and the failure would be invisible: a game that
 * allocates one small object per collision runs fine for a minute and then stutters when
 * the collector catches up.
 *
 * ## How it is measured, and why in small batches
 *
 * The heap is collected, `heapUsed` is read, twenty thousand calls are made, and
 * `heapUsed` is read again before anything is collected again.
 *
 * The batch is small on purpose. The obvious version of this test runs millions of calls
 * for a better signal-to-noise ratio, and it is **wrong**: a batch big enough to matter is
 * a batch big enough to trigger a collection part-way through, and a collection in the
 * middle takes the evidence away. Measured while working this out, a deliberately
 * allocating loop over two million calls read **0.47, 0.42 and then 0.012 bytes per call**
 * on three consecutive runs — the third one had been collected and looked perfect. Twenty
 * thousand calls of even the heaviest allocation is well under a young-generation
 * collection, so nothing is taken back before it is counted, and the median of nine trials
 * removes whatever the rest of the process was doing.
 *
 * ## Why the control is not optional
 *
 * This repository has found six guards that ran nothing. A measurement whose failing case
 * nobody has watched is the same shape of thing, so the control below allocates on purpose
 * and the test fails if the instrument does not notice — on every run, not once during
 * review. On the development machine the two sides read **0.19 bytes per call against
 * 13.2**, which is where the threshold between them comes from.
 *
 * And it has been watched failing for the right reason: storing one `{ event, level, seat }`
 * on the bus inside `emit` — a change that type-checks and that a reviewer would pass —
 * took the reading from 0.19 to **64.2 bytes per call**. Note that a bag which never
 * escapes the method does *not* move it, and should not: V8 does not allocate that one,
 * so there is nothing for rule 5 to object to.
 *
 * Skipped under coverage instrumentation, for the reason `bot-cost.test.ts` gives at
 * length: v8 instruments the code under test heavily, so the number stops being a
 * measurement of the code.
 */
const UNDER_COVERAGE = process.env['DUELBOX_COVERAGE'] === '1';

/** Bytes per call above which something is allocating. See the note above for the numbers. */
const ALLOCATION_CEILING_BYTES = 2;

/** Small enough that no collection runs inside one batch. See the note above. */
const CALLS = 20_000;

/** Odd, so the median is an actual reading rather than the mean of two. */
const TRIALS = 9;

function collect(): void {
  // `gc` is not exposed by default and Vitest is not run with `--expose-gc`, so it is
  // turned on for the length of this call and off again immediately.
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  v8.setFlagsFromString('--no-expose-gc');
  gc();
  gc();
}

function bytesPerCall(run: (calls: number) => void): number {
  run(5_000); // let the shapes settle and the function tier up before anything is measured
  const readings: number[] = [];
  for (let trial = 0; trial < TRIALS; trial += 1) {
    collect();
    const before = process.memoryUsage().heapUsed;
    run(CALLS);
    readings.push((process.memoryUsage().heapUsed - before) / CALLS);
  }
  readings.sort((a, b) => a - b);
  return readings[(readings.length - 1) >> 1]!;
}

describe('emitting a sound allocates nothing', () => {
  it.skipIf(UNDER_COVERAGE)('costs under two bytes per call', () => {
    const { system } = systemWithBank();
    // Muted, for a reason worth stating: the graph work in `flush()` *does* allocate, and
    // has to — an `AudioBufferSourceNode` is single-use by specification, so a fresh one
    // per sound is unavoidable. That is why it happens once a frame from the host's render
    // callback and never from inside a step. What rule 5 governs is the call a game makes
    // from `update()`, which is `emit`, and muting is the cheapest way to drain the queue
    // between batches without also measuring the frame work that is allowed to allocate.
    system.setMuted(true);
    const bus = new EngineSoundBus(system);
    const measured = bytesPerCall((calls) => {
      for (let i = 0; i < calls; i += 1) {
        bus.emit('hit', 0.5, i % 2 === 0 ? 'p1' : 'p2');
        // Drained rather than left to fill: a full queue makes `play` return early, and
        // the loop would then be measuring the early return rather than the work.
        if ((i & 15) === 15) system.flush();
      }
    });
    expect(measured).toBeLessThan(ALLOCATION_CEILING_BYTES);
  });

  it.skipIf(UNDER_COVERAGE)('and the measurement notices when something does allocate', () => {
    // The control. If this ever reads under the ceiling the test above is meaningless,
    // because the instrument has stopped being able to tell the two cases apart. The bag
    // is exactly the API this one was not given: `emit({ intensity, seat })` reads better
    // and allocates one object at every call site inside `update()`.
    const kept: { intensity: number }[] = [];
    const measured = bytesPerCall((calls) => {
      kept.length = 0;
      for (let i = 0; i < calls; i += 1) {
        const bag = { event: 'hit', intensity: 0.5, seat: 'p1' };
        if ((i & 1023) === 0) kept.push(bag);
      }
    });
    expect(kept.length).toBeGreaterThan(0);
    expect(measured).toBeGreaterThan(ALLOCATION_CEILING_BYTES);
  });
});
