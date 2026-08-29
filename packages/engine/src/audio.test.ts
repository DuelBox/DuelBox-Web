import { describe, expect, it } from 'vitest';
import { AudioSystem, GESTURE_EVENTS } from './audio.js';
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioEventListener,
  AudioListenerOptions,
  AudioNodeLike,
  AudioParamLike,
  AudioState,
  AudioTarget,
  GainNodeLike,
} from './audio.js';
import { Rng } from './rng.js';

/**
 * Everything here runs in Node, where there is no `AudioContext`, no `document` and no
 * gesture to make — which is the point. The module has to be importable and constructible
 * in exactly that runtime, because that is the runtime the static export is built in.
 */

class FakeParam implements AudioParamLike {
  value = 1;
}

class FakeNode implements AudioNodeLike {
  connectedTo: AudioNodeLike | undefined = undefined;

  connect(destination: AudioNodeLike): unknown {
    this.connectedTo = destination;
    return destination;
  }

  disconnect(): void {
    this.connectedTo = undefined;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam();
}

class FakeBuffer implements AudioBufferLike {
  constructor(readonly duration: number) {}
}

class FakeSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  readonly playbackRate = new FakeParam();
  starts = 0;
  readonly #log: string[];

  constructor(log: string[]) {
    super();
    this.#log = log;
  }

  start(): void {
    this.starts += 1;
    this.#log.push('start');
  }

  stop(): void {
    this.#log.push('stop');
  }
}

/**
 * A recording context. `log` is the ordered trace the unlock tests read: it is the only
 * way to prove that the silent buffer was started inside the gesture's own task rather
 * than off the back of a promise.
 */
class FakeContext implements AudioContextLike {
  state: AudioState = 'suspended';
  currentTime = 0;
  sampleRate = 48_000;
  readonly destination = new FakeNode();
  readonly log: string[] = [];
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  resumeCalls = 0;
  closeCalls = 0;
  readonly #settling: Promise<void>[] = [];

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.log.push('resume');
    // A real resume() settles after the handler has returned; the state does not flip
    // inside the gesture, so neither does this one.
    const settled = Promise.resolve().then(() => {
      if (this.state !== 'closed') this.state = 'running';
      this.log.push('resume:settled');
    });
    this.#settling.push(settled);
    return settled;
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  createGain(): GainNodeLike {
    this.log.push('createGain');
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    this.log.push('createBufferSource');
    const source = new FakeSource(this.log);
    this.sources.push(source);
    return source;
  }

  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike {
    this.log.push(`createBuffer:${String(channels)}x${String(length)}@${String(sampleRate)}`);
    return new FakeBuffer(length / sampleRate);
  }

  decodeAudioData(encoded: ArrayBuffer): Promise<AudioBufferLike> {
    return Promise.resolve(new FakeBuffer(encoded.byteLength / 1000));
  }

  /** Let every outstanding resume() settle, as the browser would a tick later. */
  async settle(): Promise<void> {
    await Promise.all(this.#settling);
  }
}

interface Registration {
  readonly type: string;
  readonly listener: AudioEventListener;
  readonly capture: boolean;
  readonly passive: boolean;
  readonly once: boolean;
}

function captureOf(options: AudioListenerOptions | boolean | undefined): boolean {
  if (typeof options === 'boolean') return options;
  return options?.capture === true;
}

/** What a real gesture event offers a handler that wants to interfere with it. */
interface FakeEvent {
  prevented: number;
  stopped: number;
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * A listener registry standing in for `document`.
 *
 * It honours `once` exactly as a real target does, so that "removes every listener" is
 * something the module has to do rather than something the fake quietly does for it: the
 * three listeners that never fired are still live unless they are explicitly removed.
 */
class FakeTarget implements AudioTarget {
  hidden = false;
  readonly added: string[] = [];
  readonly removed: string[] = [];
  #live: Registration[] = [];

  addEventListener(
    type: string,
    listener: AudioEventListener,
    options?: AudioListenerOptions | boolean,
  ): void {
    this.added.push(type);
    const once = typeof options === 'boolean' ? false : options?.once === true;
    const passive = typeof options === 'boolean' ? false : options?.passive === true;
    this.#live.push({ type, listener, capture: captureOf(options), passive, once });
  }

  removeEventListener(
    type: string,
    listener: AudioEventListener,
    options?: AudioListenerOptions | boolean,
  ): void {
    this.removed.push(type);
    const capture = captureOf(options);
    this.#live = this.#live.filter(
      (entry) => !(entry.type === type && entry.listener === listener && entry.capture === capture),
    );
  }

  dispatch(type: string): FakeEvent {
    const event: FakeEvent = {
      prevented: 0,
      stopped: 0,
      preventDefault(): void {
        this.prevented += 1;
      },
      stopPropagation(): void {
        this.stopped += 1;
      },
    };
    const firing = this.#live.filter((entry) => entry.type === type);
    for (const entry of firing) {
      if (entry.once) this.#live = this.#live.filter((live) => live !== entry);
      entry.listener(event);
    }
    return event;
  }

  get liveTypes(): string[] {
    return this.#live.map((entry) => entry.type);
  }

  /**
   * Whether every gesture listener took the capture phase and promised not to block.
   * Capture so a subtree that stops propagation cannot hide the tap from us; passive so
   * no listener of ours can ever delay a scroll.
   */
  get gesturesAreCapturePassive(): boolean {
    return this.#live
      .filter((entry) => entry.type !== 'visibilitychange')
      .every((entry) => entry.capture && entry.passive);
  }
}

interface Harness {
  readonly audio: AudioSystem;
  readonly context: FakeContext;
  readonly target: FakeTarget;
}

function setup(options?: {
  muted?: boolean;
  masterGain?: number;
  maxVoices?: number;
  queueCapacity?: number;
}): Harness {
  const context = new FakeContext();
  const target = new FakeTarget();
  const audio = new AudioSystem({
    createContext: () => context,
    target,
    muted: options?.muted ?? false,
    masterGain: options?.masterGain ?? 1,
    maxVoices: options?.maxVoices ?? 12,
    queueCapacity: options?.queueCapacity ?? 32,
  });
  return { audio, context, target };
}

/** A gesture, and the tick afterwards in which the browser's resume settles. */
async function unlockWith(harness: Harness, type = 'pointerdown'): Promise<void> {
  harness.audio.unlock();
  harness.target.dispatch(type);
  await harness.context.settle();
}

describe('AudioSystem construction', () => {
  it('touches no browser object at import time or on construction', () => {
    // This file has already been imported, in a runtime with no DOM whatsoever. If the
    // module reached for one at the top level, nothing below would ever have run.
    expect(typeof globalThis.document).toBe('undefined');

    let created = 0;
    const audio = new AudioSystem({
      createContext: () => {
        created += 1;
        return new FakeContext();
      },
      target: new FakeTarget(),
    });

    expect(created).toBe(0);
    expect(audio.state).toBe('closed');
    expect(audio.unlocked).toBe(false);
  });

  it('creates no context when arming, only when the gesture arrives', () => {
    let created = 0;
    const context = new FakeContext();
    const target = new FakeTarget();
    const audio = new AudioSystem({
      createContext: () => {
        created += 1;
        return context;
      },
      target,
    });

    audio.unlock();
    // A context built before the gesture is handed back suspended, which is the whole
    // problem. It is built inside the handler, where the page has the credit to run it.
    expect(created).toBe(0);

    target.dispatch('pointerdown');
    expect(created).toBe(1);
  });

  it('rejects a pool or queue that cannot hold anything', () => {
    expect(() => new AudioSystem({ maxVoices: 0, target: null })).toThrow(RangeError);
    expect(() => new AudioSystem({ queueCapacity: 1.5, target: null })).toThrow(RangeError);
  });
});

describe('arming the unlock', () => {
  it('listens for every gesture that satisfies the autoplay policy', () => {
    const { audio, target } = setup();
    expect(audio.unlock()).toBe(true);

    for (const type of GESTURE_EVENTS) {
      expect(target.added).toContain(type);
    }
    expect(target.added.filter((type) => GESTURE_EVENTS.includes(type))).toEqual([
      ...GESTURE_EVENTS,
    ]);
    expect(GESTURE_EVENTS).toEqual(['pointerdown', 'touchend', 'keydown', 'click']);
    expect(audio.armed).toBe(true);
  });

  it('also watches for the tab coming back', () => {
    const { audio, target } = setup();
    audio.unlock();
    expect(target.added).toContain('visibilitychange');
  });

  it('registers every gesture listener in the capture phase, passively', () => {
    const { audio, target } = setup();
    audio.unlock();
    expect(target.gesturesAreCapturePassive).toBe(true);
  });

  it('is idempotent', () => {
    const { audio, target } = setup();
    audio.unlock();
    const afterFirst = target.added.length;
    audio.unlock();
    audio.unlock();
    expect(target.added.length).toBe(afterFirst);
  });

  it('costs nothing when a running context is unlocked again', async () => {
    // The shell arms this from an effect that re-runs on every route change.
    const harness = await withUnlock();
    const addedBefore = harness.target.added.length;
    const sourcesBefore = harness.context.sources.length;

    expect(harness.audio.unlock()).toBe(true);
    harness.target.dispatch('pointerdown');

    expect(harness.target.added.length).toBe(addedBefore);
    expect(harness.context.sources.length).toBe(sourcesBefore);
    expect(harness.context.resumeCalls).toBe(1);
  });

  it('re-arms after an interruption, because unlocked does not mean running', async () => {
    const { audio, target, context } = await withUnlock();
    context.state = 'interrupted';
    expect(audio.unlock()).toBe(true);
    expect(audio.armed).toBe(true);

    target.dispatch('touchend');
    expect(context.resumeCalls).toBe(2);
  });

  it('never interferes with the gesture it is listening to', () => {
    // The unlock is a side effect of an interaction the player was already having. It must
    // be undetectable: no preventDefault, no stopPropagation, and nothing on screen. The
    // tap that unlocks audio is also the tap that presses Start, and it still presses Start.
    const { audio, target } = setup();
    audio.unlock();
    const event = target.dispatch('pointerdown');
    expect(event.prevented).toBe(0);
    expect(event.stopped).toBe(0);
  });
});

describe('the first gesture', () => {
  it('resumes exactly once and removes every listener it attached', () => {
    const { audio, target, context } = setup();
    audio.unlock();

    target.dispatch('pointerdown');

    expect(context.resumeCalls).toBe(1);
    for (const type of GESTURE_EVENTS) {
      expect(target.removed).toContain(type);
    }
    // The three that never fired are gone too, not just the one that did.
    expect(target.liveTypes).toEqual(['visibilitychange']);
    expect(audio.unlocked).toBe(true);
    expect(audio.armed).toBe(false);
  });

  it('does nothing at all on a second gesture', () => {
    const { audio, target, context } = setup();
    audio.unlock();
    target.dispatch('pointerdown');
    const afterFirst = context.log.length;

    target.dispatch('keydown');
    target.dispatch('click');
    target.dispatch('touchend');

    expect(context.resumeCalls).toBe(1);
    expect(context.log.length).toBe(afterFirst);
  });

  it('unlocks from a key, so a keyboard player is not the one left in silence', () => {
    const { audio, target, context } = setup();
    audio.unlock();
    target.dispatch('keydown');
    expect(context.resumeCalls).toBe(1);
    expect(audio.unlocked).toBe(true);
  });

  it('survives a runtime with no Web Audio and stops listening for good', () => {
    const target = new FakeTarget();
    const audio = new AudioSystem({
      createContext: () => {
        throw new Error('no AudioContext in this runtime');
      },
      target,
    });
    audio.unlock();

    expect(() => {
      target.dispatch('pointerdown');
    }).not.toThrow();
    expect(audio.armed).toBe(false);
    expect(audio.running).toBe(false);
  });
});

describe('the iOS path', () => {
  it('starts a silent buffer synchronously inside the handler, before resume', async () => {
    const { audio, target, context } = setup();
    audio.unlock();

    target.dispatch('pointerdown');

    // Read with no await in between: everything in this list happened inside the gesture's
    // own task. Safari grants permission for audio that actually reaches the destination
    // during the gesture, and a start() issued from a resume().then() is far too late.
    expect(context.log).toEqual([
      'createGain',
      'createBuffer:1x1@48000',
      'createBufferSource',
      'start',
      'resume',
    ]);
    expect(context.log.indexOf('start')).toBeLessThan(context.log.indexOf('resume'));
    expect(context.log).not.toContain('resume:settled');

    const primer = context.sources[0]!;
    expect(primer.starts).toBe(1);
    // Straight to the destination, so a muted master cannot hide it from the policy.
    expect(primer.connectedTo).toBe(context.destination);
    expect(primer.buffer?.duration).toBe(1 / 48_000);

    await context.settle();
    expect(context.log[context.log.length - 1]).toBe('resume:settled');
    expect(audio.running).toBe(true);
  });

  it('re-resumes when the tab comes back from being backgrounded', async () => {
    const harness = await withUnlock();
    const { audio, target, context } = harness;
    expect(audio.running).toBe(true);

    // iOS suspends the context the moment the tab is not on screen.
    context.state = 'suspended';
    target.hidden = true;
    target.dispatch('visibilitychange');
    expect(context.resumeCalls).toBe(1); // still hidden: nothing worth doing

    target.hidden = false;
    target.dispatch('visibilitychange');
    expect(context.resumeCalls).toBe(2);

    await context.settle();
    expect(audio.running).toBe(true);
  });

  it('recovers from the interrupted state a call or Siri leaves behind', async () => {
    const { audio, target, context } = await withUnlock();

    // 'interrupted' is Safari's own state and is not in the specification. Code that only
    // compares against 'suspended' does nothing here, which is how a match goes silent
    // after a phone call and never comes back.
    context.state = 'interrupted';
    target.dispatch('visibilitychange');

    expect(context.resumeCalls).toBe(2);
    // Belt and braces: if that resume does not take, the next tap anywhere will fix it —
    // and it will prime a fresh silent buffer inside that gesture, which is what an
    // interrupted context actually needs. Still no prompt.
    expect(audio.armed).toBe(true);

    const sourcesBefore = context.sources.length;
    context.state = 'interrupted';
    target.dispatch('touchend');
    expect(context.sources.length).toBe(sourcesBefore + 1);
    expect(context.resumeCalls).toBe(3);
  });

  it('leaves a healthy context alone when the tab comes back', async () => {
    const { target, context } = await withUnlock();
    target.dispatch('visibilitychange');
    expect(context.resumeCalls).toBe(1);
  });
});

describe('a runtime with no document', () => {
  it('arms nothing and throws nothing', () => {
    // No target option at all: the module falls back to `document`, and there is none.
    const audio = new AudioSystem({ createContext: () => new FakeContext() });
    expect(() => audio.unlock()).not.toThrow();
    expect(audio.unlock()).toBe(false);
    expect(audio.armed).toBe(false);
    expect(audio.unlocked).toBe(false);
    expect(() => {
      audio.observeVisibility();
      audio.dispose();
    }).not.toThrow();
  });

  it('treats an explicit null host the same way', () => {
    const audio = new AudioSystem({ createContext: () => new FakeContext(), target: null });
    expect(audio.unlock()).toBe(false);
  });
});

describe('the sound surface', () => {
  it('plays a registered sound through a pooled voice', async () => {
    const { audio, context } = await withUnlock();
    audio.register('goal', new FakeBuffer(0.4));

    expect(audio.play('goal')).toBe(true);
    audio.flush();

    const source = context.sources[context.sources.length - 1]!;
    expect(source.buffer?.duration).toBe(0.4);
    expect(source.starts).toBe(1);
    expect(source.connectedTo).toBe(context.gains[context.gains.length - 1]);
  });

  it('refuses an unknown name without queueing anything', async () => {
    const { audio } = await withUnlock();
    expect(audio.play('nothing-registered')).toBe(false);
    expect(audio.pending).toBe(0);
  });

  it('re-registering a name replaces the buffer and keeps the slot', async () => {
    const { audio, context } = await withUnlock();
    audio.register('tick', new FakeBuffer(0.1));
    audio.register('tick', new FakeBuffer(0.2));
    audio.play('tick');
    audio.flush();
    expect(context.sources[context.sources.length - 1]!.buffer?.duration).toBe(0.2);
  });

  it('decodes and registers encoded bytes', async () => {
    const { audio } = await withUnlock();
    expect(audio.has('theme')).toBe(false);
    await audio.load('theme', new ArrayBuffer(500));
    expect(audio.has('theme')).toBe(true);
  });

  it('carries the master gain and the mute on one node', async () => {
    const { audio, context } = await withUnlock();
    const master = context.gains[0]!;

    expect(master.gain.value).toBe(1);
    audio.setMasterGain(0.5);
    expect(master.gain.value).toBe(0.5);

    audio.setMuted(true);
    expect(master.gain.value).toBe(0);
    // The level the player chose survives the mute.
    expect(audio.masterGain).toBe(0.5);
    expect(audio.toggleMuted()).toBe(false);
    expect(master.gain.value).toBe(0.5);

    audio.setMasterGain(9);
    expect(audio.masterGain).toBe(1);
    audio.setMasterGain(Number.NaN);
    expect(audio.masterGain).toBe(0);
  });

  it('drops what it cannot play rather than banking it', async () => {
    const { audio, context } = await withUnlock();
    audio.register('tick', new FakeBuffer(0.05));
    audio.setMuted(true);

    for (let i = 0; i < 5; i += 1) audio.play('tick');
    const before = context.sources.length;
    audio.flush();

    // A muted match must not accumulate five seconds of sound and fire it all on unmute.
    expect(context.sources.length).toBe(before);
    expect(audio.pending).toBe(0);
  });

  it('plays nothing while the context is not running', () => {
    const { audio, context } = setup();
    audio.unlock();
    audio.context();
    audio.register('tick', new FakeBuffer(0.05));
    audio.play('tick');
    const before = context.sources.length;
    audio.flush();
    expect(context.sources.length).toBe(before);
  });
});

describe('play allocation discipline', () => {
  it('allocates nothing per call: no node, no growth, no options object', async () => {
    const { audio, context } = await withUnlock();
    audio.register('tick', new FakeBuffer(0.05));
    const logBefore = context.log.length;

    // A thousand calls, as a step under load might make. The signature is positional
    // numbers precisely so that none of these call sites can allocate an options bag.
    for (let i = 0; i < 1000; i += 1) audio.play('tick', 0.8, 1.2);

    // Nothing whatsoever touched the graph: play() writes integers into arrays that were
    // allocated in the constructor, and the graph work waits for flush().
    expect(context.log.length).toBe(logBefore);
    // The queue is a fixed buffer. Surplus is dropped, never grown into.
    expect(audio.pending).toBe(32);
    expect(audio.play('tick')).toBe(false);
  });

  it('reuses the voice pool instead of building a gain node per sound', async () => {
    const { audio, context } = await withUnlock();
    audio.register('tick', new FakeBuffer(0.05));

    for (let i = 0; i < 32; i += 1) audio.play('tick');
    audio.flush();
    // One master plus one gain per pooled voice, and not one more.
    expect(context.gains.length).toBe(1 + 12);

    const gainsAfterFirst = context.gains.length;
    context.currentTime = 10;
    for (let i = 0; i < 32; i += 1) audio.play('tick');
    audio.flush();

    expect(context.gains.length).toBe(gainsAfterFirst);
    // Sources are the one unavoidable allocation: an AudioBufferSourceNode is single-use
    // by specification. They are created in flush(), which the host calls outside the step.
    expect(context.sources.length).toBe(1 + 32 + 32);
  });

  it('empties the queue on flush even when nothing could play', async () => {
    const { audio } = await withUnlock();
    audio.register('tick', new FakeBuffer(0.05));
    for (let i = 0; i < 4; i += 1) audio.play('tick');
    expect(audio.pending).toBe(4);
    audio.flush();
    expect(audio.pending).toBe(0);
  });
});

describe('playVaried', () => {
  it('takes its pitch from the seeded generator, never from the wall', async () => {
    const first = await withUnlock();
    const second = await withUnlock();
    first.audio.register('tick', new FakeBuffer(0.05));
    second.audio.register('tick', new FakeBuffer(0.05));

    const firstRng = new Rng(1234);
    const secondRng = new Rng(1234);
    for (let i = 0; i < 8; i += 1) {
      first.audio.playVaried('tick', firstRng);
      second.audio.playVaried('tick', secondRng);
    }
    first.audio.flush();
    second.audio.flush();

    const rates = (harness: Harness): number[] =>
      harness.context.sources.slice(1).map((source) => source.playbackRate.value);
    expect(rates(first)).toEqual(rates(second));
    for (const rate of rates(first)) {
      expect(rate).toBeGreaterThanOrEqual(2 ** (-40 / 1200));
      expect(rate).toBeLessThanOrEqual(2 ** (40 / 1200));
    }
    // Varied, not constant: a sound fired eight times must not be eight identical copies.
    expect(new Set(rates(first)).size).toBeGreaterThan(1);
  });

  it('draws once per call whatever the device is doing', async () => {
    // The draw must not depend on mute, on the unlock, or on whether the name is even
    // registered. If it did, two devices in a cross-device match would fall out of step
    // over audio — which is exactly the class of bug rule 4 exists to prevent.
    const loud = await withUnlock();
    loud.audio.register('tick', new FakeBuffer(0.05));
    const muted = setup({ muted: true }); // never unlocked, nothing registered

    const loudRng = new Rng(99);
    const mutedRng = new Rng(99);
    for (let i = 0; i < 16; i += 1) {
      loud.audio.playVaried('tick', loudRng);
      expect(muted.audio.playVaried('tick', mutedRng)).toBe(false);
    }

    expect(mutedRng.save()).toEqual(loudRng.save());
  });
});

describe('dispose', () => {
  it('lets go of every listener and closes the context', async () => {
    const { audio, target, context } = setup();
    audio.unlock();
    audio.context();

    audio.dispose();

    expect(target.liveTypes).toEqual([]);
    expect(context.closeCalls).toBe(1);
    expect(audio.unlock()).toBe(false);
    await context.settle();
  });

  it('is safe to call twice', () => {
    const { audio, context } = setup();
    audio.unlock();
    audio.context();
    audio.dispose();
    audio.dispose();
    expect(context.closeCalls).toBe(1);
  });
});

/** An armed system that has seen its gesture and whose resume has settled. */
async function withUnlock(): Promise<Harness> {
  const harness = setup();
  await unlockWith(harness);
  return harness;
}
