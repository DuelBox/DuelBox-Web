import type { Rng } from './rng.js';

/**
 * Sound, and the one gesture that is allowed to start it.
 *
 * Every browser refuses to play audio until the person has interacted with the page.
 * Handled badly that costs the whole first match: the countdown, the first goal and the
 * result all land in silence, and a player reads silence as a broken game rather than as
 * a policy. Handled well it costs nothing at all, because the interaction the policy is
 * waiting for is one the player was always going to make — they came here to tap a game
 * and then tap Start.
 *
 * So there is no "enable sound" panel here, and there must never be one. Unlocking is a
 * side effect of the first pointerdown, touchend, keydown or click anywhere in the shell;
 * the listeners are passive, they never call preventDefault, they remove themselves the
 * instant they have done their job, and nothing on screen ever mentions any of it.
 *
 * **iOS Safari needs more than a resume, and needs it twice.** See {@link AudioSystem.unlock}
 * and {@link AudioSystem.observeVisibility} — the two departures from the simple story are
 * a silent buffer started *synchronously inside the gesture handler*, and a re-resume when
 * the tab comes back, because iOS suspends the context again whenever the tab is
 * backgrounded and moves it to `'interrupted'` for a phone call or Siri.
 *
 * Nothing in this module touches `window`, `document` or `AudioContext` at import time.
 * The site is a static export: this file is evaluated during the build, in Node, where
 * none of those exist. Every browser object is reached lazily and through an injectable
 * seam, which is also what lets the tests run with no DOM at all.
 */

/**
 * The gestures that actually satisfy an autoplay policy, in the order they tend to fire.
 *
 * `pointerdown` covers mouse, pen and touch on everything current and fires at the start
 * of the gesture rather than the end. `touchend` is kept because iOS has historically been
 * the strictest about *which* touch event counts and the cheapest insurance is to accept
 * both ends of the same tap — whichever arrives first unlocks, the other is already gone.
 * `keydown` is the keyboard player, who must not be the one who gets a silent match.
 * `click` is the backstop for anything synthetic: a button reached by assistive technology
 * or by the Enter key still produces a click, and that is a real user gesture too.
 */
export const GESTURE_EVENTS: readonly string[] = Object.freeze([
  'pointerdown',
  'touchend',
  'keydown',
  'click',
]);

/** The event iOS uses to tell us the context has been taken away and may be taken back. */
const VISIBILITY_EVENT = 'visibilitychange';

/** Passive, so no listener of ours can ever delay a scroll. Capture, so a handler that
 * stops propagation on its own subtree cannot hide the gesture from us. Once, so a
 * listener that somehow escapes the explicit removal still cannot fire twice. */
const LISTEN_OPTIONS: AudioListenerOptions = Object.freeze({
  capture: true,
  passive: true,
  once: true,
});

/** Capture alone: removeEventListener only matches a listener registered with the same
 * capture flag, so removal and the visibility listener share one frozen object. */
const CAPTURE_OPTIONS: AudioListenerOptions = Object.freeze({ capture: true });

/** Concurrent sounds. Beyond this a match is noise, and each voice costs a live node. */
const DEFAULT_MAX_VOICES = 12;

/** Sounds one simulation step may ask for. A step that wants more than this is a bug. */
const DEFAULT_QUEUE_CAPACITY = 32;

/** Default spread for {@link AudioSystem.playVaried}, in cents: a fifth of a semitone. */
const DEFAULT_CENTS = 40;

const CENTS_PER_OCTAVE = 1200;

/**
 * The states an implementation may report.
 *
 * `'interrupted'` is iOS-only and is not in the specification: Safari moves a context
 * there when a phone call, an alarm or Siri takes the audio session away. It behaves like
 * `'suspended'` for our purposes — the point of naming it is that code which compares
 * against `'suspended'` alone silently does nothing on the one platform that needs it most.
 */
export type AudioState = 'suspended' | 'running' | 'closed' | 'interrupted';

/** The one property of an `AudioParam` this module writes. */
export interface AudioParamLike {
  value: number;
}

/** Declared structurally, exactly as the renderer declares its canvas context, so a test
 * can pass a recording fake and a real node still satisfies it without a cast. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

/** Only the duration is read — it is how a voice knows when its slot is free again. */
export interface AudioBufferLike {
  readonly duration: number;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  readonly playbackRate: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly state: AudioState;
  /** The context's own clock, in seconds. Used only to retire voices, never by a game. */
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  /**
   * Returns undefined on old WebKit, which predates the promise form. Callers must not
   * assume there is anything to attach a rejection handler to.
   */
  resume(): Promise<void> | undefined;
  close(): Promise<void> | undefined;
  createGain(): GainNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  /** Detaches `encoded`; the caller must not reuse the buffer afterwards. */
  decodeAudioData(encoded: ArrayBuffer): Promise<AudioBufferLike>;
}

/** Nothing here reads the event, so it is typed as the unknown it is treated as. */
export type AudioEventListener = (event: unknown) => void;

export interface AudioListenerOptions {
  capture?: boolean;
  passive?: boolean;
  once?: boolean;
}

/**
 * Where gestures are watched for. The shell passes `document` (the default) because that
 * is the only node that sees every tap in the page and the only one that fires
 * `visibilitychange`; anything narrower is a test seam or an embedded surface.
 */
export interface AudioTarget {
  /** Present on `document`; absent on a plain element, where visibility is not a concept. */
  readonly hidden?: boolean;
  addEventListener(
    type: string,
    listener: AudioEventListener,
    options?: AudioListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    listener: AudioEventListener,
    options?: AudioListenerOptions | boolean,
  ): void;
}

export interface AudioSystemOptions {
  /**
   * Creates the context. Defaults to the browser's. Injected rather than constructed so
   * the tests can run in Node, where there is no Web Audio at all, and so that nothing
   * about this module has to know what a browser is.
   */
  readonly createContext?: () => AudioContextLike;
  /** Where gesture and visibility listeners attach. Defaults to `document`; `null` means
   * there is no host to listen on, which is not an error — it is a server render. */
  readonly target?: AudioTarget | null;
  /** Concurrent voices. The pool is fixed at this size and never grows. */
  readonly maxVoices?: number;
  /** Sounds one step may queue before the surplus is dropped rather than the queue grown. */
  readonly queueCapacity?: number;
  /** Master level in [0, 1]. Out-of-range values are clamped, never thrown — this ends up
   * behind a slider, and a slider must not be able to crash a match. */
  readonly masterGain?: number;
  readonly muted?: boolean;
}

interface AudioContextConstructorLike {
  new (): AudioContextLike;
}

/**
 * The browser's own context, or a clear error if this runtime has none.
 *
 * `webkitAudioContext` is still the only constructor on older iOS, and older iOS is
 * exactly the population this issue is about, so the prefix is checked rather than
 * assumed away.
 */
export function browserAudioContext(): AudioContextLike {
  const scope = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructorLike;
  };
  const Constructor: AudioContextConstructorLike | undefined =
    typeof scope.AudioContext === 'undefined' ? scope.webkitAudioContext : scope.AudioContext;
  if (Constructor === undefined) {
    throw new Error('browserAudioContext requires AudioContext; none is available in this runtime');
  }
  return new Constructor();
}

/** `document`, if this runtime has one. It does not during a static export build. */
function browserTarget(): AudioTarget | undefined {
  const scope = globalThis;
  if (typeof scope.document === 'undefined') return undefined;
  return scope.document;
}

function clampGain(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, received ${String(value)}`);
  }
}

/**
 * Owns the audio context, the unlock, and a small named-sound surface.
 *
 * One instance per tab, created by the shell and handed to games through the SDK. A game
 * only ever calls {@link AudioSystem.play}; everything about policy, state and device
 * lives here, which is the same division as every other shell concern (CLAUDE.md: a
 * bespoke version of any of this inside a game package is a bug).
 */
export class AudioSystem {
  readonly #newContext: () => AudioContextLike;
  readonly #target: AudioTarget | undefined;

  /** Registered sounds. `#index` maps a name to a slot in the two parallel arrays, so the
   * per-step path can carry an integer and never a string. */
  readonly #index = new Map<string, number>();
  readonly #buffers: AudioBufferLike[] = [];
  readonly #baseGains: number[] = [];

  /**
   * The pending queue: three preallocated arrays and a count, written by `play()` and
   * drained by `flush()`. This is the whole reason a sound can be triggered from inside a
   * fixed step without allocating (CLAUDE.md rule 5) — see {@link AudioSystem.play}.
   */
  readonly #queueSound: Int32Array;
  readonly #queueGain: Float64Array;
  readonly #queueRate: Float64Array;
  #pendingCount = 0;

  /** Voice pool. A slot is idle once the context clock passes its `#voiceFreeAt`. The gain
   * nodes are created on first use and then reused for the life of the tab. */
  readonly #voiceGains: (GainNodeLike | undefined)[];
  readonly #voiceFreeAt: Float64Array;

  #context: AudioContextLike | undefined = undefined;
  #master: GainNodeLike | undefined = undefined;
  /** The one-sample buffer used to prime iOS. Created once, started many times — a source
   * node is single-use by specification, the buffer behind it is not. */
  #silence: AudioBufferLike | undefined = undefined;

  #masterGain: number;
  #muted: boolean;
  #unlocked = false;
  #armed = false;
  #watchingVisibility = false;
  /** Set when the factory throws, so a runtime with no Web Audio is asked exactly once. */
  #unavailable = false;
  #disposed = false;

  constructor(options?: AudioSystemOptions) {
    const maxVoices = options?.maxVoices ?? DEFAULT_MAX_VOICES;
    const queueCapacity = options?.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
    assertPositiveInteger(maxVoices, 'maxVoices');
    assertPositiveInteger(queueCapacity, 'queueCapacity');

    this.#newContext = options?.createContext ?? browserAudioContext;
    // `undefined` means "work it out from the runtime"; `null` means "there is no host".
    const target = options?.target;
    this.#target = target === undefined ? browserTarget() : (target ?? undefined);

    this.#queueSound = new Int32Array(queueCapacity);
    this.#queueGain = new Float64Array(queueCapacity);
    this.#queueRate = new Float64Array(queueCapacity);
    this.#voiceGains = new Array<GainNodeLike | undefined>(maxVoices).fill(undefined);
    this.#voiceFreeAt = new Float64Array(maxVoices);

    this.#masterGain = clampGain(options?.masterGain ?? 1);
    this.#muted = options?.muted ?? false;
  }

  /** True once a gesture has been seen and acted on. Never shown to a player. */
  get unlocked(): boolean {
    return this.#unlocked;
  }

  /** True while the gesture listeners are attached and waiting. */
  get armed(): boolean {
    return this.#armed;
  }

  /** True when the context exists and is actually running, which is the only state in
   * which a `flush()` will produce sound. */
  get running(): boolean {
    return this.#context !== undefined && this.#context.state === 'running';
  }

  /** What the context reports, or `'closed'` before one exists. */
  get state(): AudioState {
    return this.#context?.state ?? 'closed';
  }

  get muted(): boolean {
    return this.#muted;
  }

  /** The level a mute is hiding, so unmuting restores what the player chose. */
  get masterGain(): number {
    return this.#masterGain;
  }

  /** Sounds queued by `play()` and not yet flushed. */
  get pending(): number {
    return this.#pendingCount;
  }

  /**
   * Arm the unlock. Idempotent, cheap, and safe to call from a layout effect on every
   * route: a second call with listeners already attached, or after the context is already
   * running, does nothing.
   *
   * No context is created here. Creating one before the gesture is what makes browsers
   * hand back a suspended context in the first place, so the context is built inside the
   * handler, where the page has the credit to start it running.
   *
   * Returns false when there is nothing to listen on — a server render, or a host that
   * passed `target: null`. That is not an error and never throws.
   */
  unlock(): boolean {
    if (this.#disposed || this.#unavailable) return false;
    const target = this.#target;
    if (target === undefined) return false;
    this.observeVisibility();
    if (this.#armed) return true;
    // Already sorted. The shell calls this from an effect that re-runs on every route
    // change, and re-arming there would cost a set of listeners and a silent buffer per
    // navigation. Note this is deliberately `running` and not `unlocked`: a context iOS
    // has interrupted is unlocked and still needs the next tap.
    if (this.#unlocked && this.running) return true;
    this.#armed = true;
    for (const type of GESTURE_EVENTS) {
      target.addEventListener(type, this.#onGesture, LISTEN_OPTIONS);
    }
    return true;
  }

  /**
   * Watch for the tab coming back.
   *
   * iOS does not leave a context running when it is not on screen: backgrounding the tab
   * suspends it, and a phone call or Siri moves it to `'interrupted'`. Neither fires
   * anything the audio API tells us about, and neither is followed by a fresh user
   * gesture — the player returns to a match already in progress and simply expects it to
   * make noise. So the return itself is the trigger: resume, and if the resume does not
   * take, quietly re-arm the gesture listeners so the very next tap fixes it. Still no
   * prompt, ever.
   *
   * Called for you by {@link AudioSystem.unlock}; separate because it is worth naming.
   */
  observeVisibility(): void {
    if (this.#disposed || this.#watchingVisibility) return;
    const target = this.#target;
    if (target === undefined) return;
    this.#watchingVisibility = true;
    target.addEventListener(VISIBILITY_EVENT, this.#onVisibilityChange, CAPTURE_OPTIONS);
  }

  /**
   * The context, created on first use. Returns undefined in a runtime that has no Web
   * Audio, which is a thing to route around rather than a thing to crash on.
   */
  context(): AudioContextLike | undefined {
    if (this.#context !== undefined) return this.#context;
    if (this.#disposed || this.#unavailable) return undefined;
    let context: AudioContextLike;
    try {
      context = this.#newContext();
    } catch {
      // One failure means this runtime has none; asking again every frame would be silly.
      this.#unavailable = true;
      return undefined;
    }
    const master = context.createGain();
    master.gain.value = this.#muted ? 0 : this.#masterGain;
    master.connect(context.destination);
    this.#context = context;
    this.#master = master;
    return context;
  }

  /** Register a decoded buffer under a name. Re-registering a name keeps its slot, so a
   * hot reload cannot invalidate an index a game is already holding. */
  register(name: string, buffer: AudioBufferLike, gain = 1): void {
    if (name.length === 0) {
      throw new RangeError('register: name must not be empty');
    }
    const existing = this.#index.get(name);
    if (existing !== undefined) {
      this.#buffers[existing] = buffer;
      this.#baseGains[existing] = clampGain(gain);
      return;
    }
    const slot = this.#buffers.length;
    this.#buffers.push(buffer);
    this.#baseGains.push(clampGain(gain));
    this.#index.set(name, slot);
  }

  /**
   * Decode encoded bytes and register the result. Decoding works on a suspended context,
   * so this can run while the shell is still waiting for its first gesture — which is the
   * point: by the time the player taps Start, the sounds are already in memory.
   *
   * Resolves false if this runtime has no audio at all. Rejects if the bytes will not
   * decode, which is a build problem and should be loud.
   */
  async load(name: string, encoded: ArrayBuffer, gain = 1): Promise<boolean> {
    const context = this.context();
    if (context === undefined) return false;
    const buffer = await context.decodeAudioData(encoded);
    this.register(name, buffer, gain);
    return true;
  }

  has(name: string): boolean {
    return this.#index.has(name);
  }

  /** Master level, clamped to [0, 1]. Applied immediately, remembered through a mute. */
  setMasterGain(value: number): void {
    this.#masterGain = clampGain(value);
    this.#applyMasterGain();
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    this.#applyMasterGain();
  }

  /** Returns the new state, so a button can render from the return value. */
  toggleMuted(): boolean {
    this.setMuted(!this.#muted);
    return this.#muted;
  }

  /**
   * Ask for a sound. Safe to call from inside a fixed step, because it allocates nothing.
   *
   * The whole method is: one `Map.get` on a string key, three writes into typed arrays
   * allocated in the constructor, and an integer increment. No object literal, no closure,
   * no varargs, no string building — which is why the options are positional numbers with
   * primitive defaults rather than an options bag, since an options bag would allocate at
   * every call site inside `update()`.
   *
   * The graph work — which does allocate, because `AudioBufferSourceNode` is single-use by
   * specification and a fresh one is unavoidable per sound — is deferred to
   * {@link AudioSystem.flush}, which the host calls once a frame, outside the simulation.
   * The gain node each source runs through is *not* recreated: those come from a fixed
   * pool (CLAUDE.md rule 5, and issue #166's pooled source graph).
   *
   * Returns false if the name is unknown or the queue is full.
   */
  play(name: string, gain = 1, rate = 1): boolean {
    const slot = this.#index.get(name);
    if (slot === undefined) return false;
    const count = this.#pendingCount;
    // Full: drop the sound rather than grow the queue. A step that wants 33 sounds has a
    // bug, and a queue that grows to fit it turns that bug into a memory leak.
    if (count >= this.#queueSound.length) return false;
    this.#queueSound[count] = slot;
    this.#queueGain[count] = gain;
    this.#queueRate[count] = rate;
    this.#pendingCount = count + 1;
    return true;
  }

  /**
   * As {@link AudioSystem.play}, with the pitch nudged by up to `cents` either way so that
   * a sound fired forty times in a match does not sound like forty copies of one recording.
   *
   * The randomness is a seeded {@link Rng} because it must be (CLAUDE.md rule 4), and two
   * details keep it honest:
   *
   * - Hand it a generator dedicated to presentation, not the one the simulation draws
   *   from. Sound must never be able to move the gameplay stream.
   * - The draw happens before anything can return early, so a muted device, a locked
   *   context and a device playing at full volume all advance the generator identically.
   *   Anything else and two devices in a cross-device match would diverge over audio.
   */
  playVaried(name: string, rng: Rng, cents = DEFAULT_CENTS, gain = 1): boolean {
    const offset = (rng.float() * 2 - 1) * cents;
    return this.play(name, gain, 2 ** (offset / CENTS_PER_OCTAVE));
  }

  /**
   * Turn everything queued since the last call into sound. Called once per frame by the
   * host, from the render callback — never from inside a simulation step.
   *
   * The queue is emptied whether or not it can be played. Sounds asked for while the tab
   * was hidden must not all fire at once when it comes back.
   */
  flush(): void {
    const pending = this.#pendingCount;
    this.#pendingCount = 0;
    if (pending === 0) return;
    const context = this.#context;
    const master = this.#master;
    if (context === undefined || master === undefined) return;
    if (this.#muted || context.state !== 'running') return;

    const now = context.currentTime;
    for (let i = 0; i < pending; i += 1) {
      const slot = this.#queueSound[i]!; // written by play(), always in range
      const buffer = this.#buffers[slot];
      if (buffer === undefined) continue;
      const rate = this.#queueRate[i]!;
      const gain = this.#queueGain[i]! * (this.#baseGains[slot] ?? 1);
      const voice = this.#takeVoice(now);
      const voiceGain = this.#voiceGain(context, master, voice);
      voiceGain.gain.value = gain;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(voiceGain);
      source.start();
      this.#voiceFreeAt[voice] = now + buffer.duration / (rate > 0 ? rate : 1);
    }
  }

  /** Detach every listener and close the context. For a hot reload or a test. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disarm();
    const target = this.#target;
    if (target !== undefined && this.#watchingVisibility) {
      target.removeEventListener(VISIBILITY_EVENT, this.#onVisibilityChange, CAPTURE_OPTIONS);
      this.#watchingVisibility = false;
    }
    this.#pendingCount = 0;
    const context = this.#context;
    this.#context = undefined;
    this.#master = undefined;
    this.#silence = undefined;
    if (context !== undefined) {
      try {
        const closing = context.close();
        if (closing !== undefined) void closing.catch(() => undefined);
      } catch {
        // A context closed twice throws on some engines. Disposing must not.
      }
    }
  }

  /**
   * The gesture handler. Everything it does that matters is synchronous, because the
   * permission it is spending expires when this function returns.
   */
  readonly #onGesture = (): void => {
    this.#disarm();
    const context = this.context();
    if (context === undefined) {
      // No Web Audio here at all. Count it as unlocked so we stop listening for good.
      this.#unlocked = true;
      return;
    }
    // Order matters. The silent buffer goes first because it is the part that must happen
    // inside this task; resume() only hands back a promise, and whether it settles before
    // or after this function returns is not ours to decide.
    this.#primeSilently(context);
    this.#resume(context);
    this.#unlocked = true;
  };

  readonly #onVisibilityChange = (): void => {
    const target = this.#target;
    if (target === undefined) return;
    if (target.hidden === true) return;
    const context = this.#context;
    if (context === undefined) return;
    if (context.state === 'running' || context.state === 'closed') return;
    // Back on screen and not running: iOS suspended or interrupted us. Try to take it back
    // without any help from the player...
    this.#resume(context);
    // ...and if it does not take — the resume settles later, and on a genuine interruption
    // it can reject outright — re-arm, so the next tap anywhere puts the sound back. The
    // listener that fires will prime a fresh silent buffer inside that gesture, which is
    // what an interrupted iOS context actually needs.
    if (!this.#armed && !this.#disposed) {
      this.#armed = true;
      for (const type of GESTURE_EVENTS) {
        target.addEventListener(type, this.#onGesture, LISTEN_OPTIONS);
      }
    }
  };

  /**
   * Start one sample of silence, synchronously, inside the gesture.
   *
   * This is the iOS-specific half of the unlock and it is not decoration. Safari treats
   * audio actually reaching the destination during a gesture task as the thing that grants
   * permission; a bare `resume()` can leave the context reporting `'running'` while every
   * later sound is dropped, which is worse than being obviously silent because it looks
   * fixed. One frame at the context's own rate is the smallest thing that counts as
   * playback, and it is inaudible.
   *
   * It runs on every browser rather than behind a device check, because a check would be
   * a branch on the device (CLAUDE.md rule 10) and the cost elsewhere is one silent sample.
   */
  #primeSilently(context: AudioContextLike): void {
    try {
      let silence = this.#silence;
      if (silence === undefined) {
        silence = context.createBuffer(1, 1, context.sampleRate);
        this.#silence = silence;
      }
      const source = context.createBufferSource();
      source.buffer = silence;
      // Straight to the destination, deliberately: this must be heard by the policy even
      // when the master gain is muted.
      source.connect(context.destination);
      source.start();
    } catch {
      // Priming is best-effort. A handler that throws would take the player's tap with it.
    }
  }

  #resume(context: AudioContextLike): void {
    if (context.state === 'running' || context.state === 'closed') return;
    try {
      const resuming = context.resume();
      // A resume() that rejects is not something we can act on, but an unhandled rejection
      // would surface in the console as if the shell had a bug.
      if (resuming !== undefined) void resuming.catch(() => undefined);
    } catch {
      // Old WebKit throws synchronously where the specification says reject.
    }
  }

  #disarm(): void {
    if (!this.#armed) return;
    this.#armed = false;
    const target = this.#target;
    if (target === undefined) return;
    // Every one of them, not just the one that fired: a tap that unlocked through
    // pointerdown must not leave a keydown listener behind to fire again later.
    for (const type of GESTURE_EVENTS) {
      target.removeEventListener(type, this.#onGesture, CAPTURE_OPTIONS);
    }
  }

  #applyMasterGain(): void {
    const master = this.#master;
    if (master === undefined) return;
    master.gain.value = this.#muted ? 0 : this.#masterGain;
  }

  /** An idle slot, or the busiest one's nearest neighbour: the voice ending soonest is the
   * one whose loss is least noticed. Allocation-free, called from flush(). */
  #takeVoice(now: number): number {
    let stolen = 0;
    let earliest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.#voiceFreeAt.length; i += 1) {
      const freeAt = this.#voiceFreeAt[i]!; // i < length
      if (freeAt <= now) return i;
      if (freeAt < earliest) {
        earliest = freeAt;
        stolen = i;
      }
    }
    return stolen;
  }

  /** The pooled gain for a slot, built on first use and then reused for the tab's life. */
  #voiceGain(context: AudioContextLike, master: GainNodeLike, slot: number): GainNodeLike {
    const existing = this.#voiceGains[slot];
    if (existing !== undefined) return existing;
    const gain = context.createGain();
    gain.connect(master);
    this.#voiceGains[slot] = gain;
    return gain;
  }
}
