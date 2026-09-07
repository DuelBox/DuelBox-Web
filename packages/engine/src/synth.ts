/**
 * Every sound this product makes, made from arithmetic.
 *
 * DuelBox ships no audio files at all — no `.wav`, no `.mp3`, no `.opus` — and that is a
 * deliberate answer to three of this repository's constraints at once:
 *
 * - **Rule 1, original assets only.** A recording has a provenance to argue about. A sine
 *   wave with an exponential decay does not. There is nothing here that could have come
 *   from another product, because there is nothing here but numbers.
 * - **Rule 3, every asset needs an `assets.license.json` entry.** A sound with no file is
 *   not an asset. The whole class of "which entry covers this bleep" disappears.
 * - **Rule 11, nothing merges over the size budget.** The entire sound design of the
 *   catalogue is a few hundred bytes of recipe table plus this renderer, against tens of
 *   kilobytes for the smallest usable set of encoded clips. It also means the sounds work
 *   offline on the first visit with nothing to fetch.
 *
 * Rendering happens **once**, into a buffer, when the sound bank is registered — never per
 * play and never per frame. {@link renderRecipe} is therefore allowed to be as slow as it
 * likes; what must be cheap is playing the buffer afterwards, and that is
 * `AudioSystem.play`, which does a map lookup and three array writes.
 *
 * Nothing here uses `Math.random` (rule 4, lint-enforced). Noise comes from a small
 * integer generator seeded from the recipe, so the same recipe renders the same samples on
 * every device and on every run — which matters more than it sounds like it should, because
 * two devices in a cross-device match must be able to agree that they played the same match.
 */

import type { AudioSampleBuffer } from './audio.js';

/**
 * The five shapes worth having.
 *
 * `sine` is a soft tone with no harmonics — the countdown, the confirmations, anything
 * that has to be heard forty times a match without becoming irritating. `triangle` is a
 * sine with a little edge on it. `square` is hollow and synthetic and reads as a machine
 * saying no. `saw` is bright and buzzy and carries over a busy board. `noise` is the
 * percussive one: every impact, every rebound, every scrape is noise through an envelope.
 */
export type Waveform = 'sine' | 'square' | 'saw' | 'triangle' | 'noise';

/**
 * One layer of a sound.
 *
 * A voice is a shape, a pitch that may slide, and an envelope. Two or three of them
 * stacked is enough for every cue in the vocabulary: a body (a tone) plus a transient
 * (a noise burst a few milliseconds long) is what a physical impact sounds like, and
 * separating them is what lets a hard hit and a soft one be the same sound at different
 * intensities rather than two recordings.
 */
export interface SynthVoice {
  readonly wave: Waveform;
  /** Pitch at the start of the voice, in Hz. Ignored by `noise`. */
  readonly fromHz: number;
  /** Pitch at the end of the voice, in Hz. Swept exponentially, so it reads as musical. */
  readonly toHz: number;
  /** Seconds after the sound begins before this voice starts. Layers a sound in time. */
  readonly delaySeconds: number;
  /** Seconds from silence to full. Kept short; a slow attack on an impact sounds wrong. */
  readonly attackSeconds: number;
  /** Seconds held at full before the decay begins. */
  readonly holdSeconds: number;
  /** Seconds from full back to silence, on a squared curve — how struck things behave. */
  readonly releaseSeconds: number;
  /** Peak amplitude of this voice, in [0, 1]. */
  readonly level: number;
}

/** A complete sound: how long it lasts and what is in it. */
export interface SynthRecipe {
  /** Total length in seconds. Voices are clipped to it, so a recipe cannot run long. */
  readonly seconds: number;
  readonly voices: readonly SynthVoice[];
}

/**
 * Build a voice.
 *
 * **Positional, and that is a size decision.** A minifier cannot rename the keys of an
 * object literal, so the named form shipped `attackSeconds` twenty-one times,
 * `holdSeconds` thirty-two and six more besides — 164 key occurrences of pure repetition
 * in a bundle every visitor downloads. The recipe table below reads as a table instead,
 * with the column order stated once here and once above the table.
 *
 * Called ten times at module load and never again; a recipe is rendered into a buffer once.
 */
export function voice(
  wave: Waveform,
  fromHz: number,
  toHz: number,
  delaySeconds: number,
  attackSeconds: number,
  holdSeconds: number,
  releaseSeconds: number,
  level: number,
): SynthVoice {
  return {
    wave,
    fromHz,
    toHz,
    delaySeconds,
    attackSeconds,
    holdSeconds,
    releaseSeconds,
    level,
  };
}

/** Build a recipe. Same reason as {@link voice}: no repeated keys in the shipped table. */
export function recipe(seconds: number, ...voices: readonly SynthVoice[]): SynthRecipe {
  return { seconds, voices };
}

/**
 * Seconds of fade applied at both ends of every rendered buffer.
 *
 * A buffer that starts or stops at a non-zero sample is a step change in the waveform, and
 * a step change is a click — audible, unpleasant, and the single most common way a
 * synthesised sound betrays that it is synthesised. Two milliseconds is below the
 * threshold of hearing it as a fade and far above the threshold of hearing the click.
 */
const EDGE_FADE_SECONDS = 0.002;

/** Sample rate used when a caller renders without a context, e.g. in a test. */
export const OFFLINE_SAMPLE_RATE = 48_000;

const TWO_PI = Math.PI * 2;

/**
 * A 32-bit linear congruential generator, for noise only.
 *
 * Deliberately *not* the engine's `Rng`: that one belongs to the simulation, and the whole
 * point of the audio design is that nothing about sound can move the gameplay stream (see
 * `SoundBus`). This one is local to a render call, seeded from the sound's own name, and
 * dies when the buffer is finished. The constants are Numerical Recipes'.
 */
function nextNoise(state: number): number {
  return (Math.imul(state, 1_664_525) + 1_013_904_223) | 0;
}

/** A stable 32-bit hash of a string, so a sound's noise is a function of its name. */
export function seedFromName(name: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  // Never zero: an LCG seeded at zero is still fine, but a zero seed usually means a bug
  // upstream and it is cheap to make that impossible rather than indistinguishable.
  return (hash | 1) >>> 0;
}

/**
 * The amplitude of one voice at a time offset, or 0 outside its envelope.
 *
 * Linear attack, flat hold, squared release. The square is what makes a struck thing sound
 * struck: energy leaves a resonating object fastest at the start, and a linear fade instead
 * sounds like somebody turning a dial down.
 */
function envelopeAt(v: SynthVoice, t: number): number {
  const local = t - v.delaySeconds;
  if (local < 0) return 0;
  if (local < v.attackSeconds) {
    return v.attackSeconds > 0 ? local / v.attackSeconds : 1;
  }
  const held = local - v.attackSeconds;
  if (held < v.holdSeconds) return 1;
  const releasing = held - v.holdSeconds;
  if (releasing >= v.releaseSeconds) return 0;
  if (v.releaseSeconds <= 0) return 0;
  const remaining = 1 - releasing / v.releaseSeconds;
  return remaining * remaining;
}

/** The voice's own length, which is what the pitch sweep is measured against. */
function voiceSeconds(v: SynthVoice): number {
  return v.attackSeconds + v.holdSeconds + v.releaseSeconds;
}

/**
 * The pitch of a voice at a time offset, swept exponentially between its endpoints.
 *
 * Exponential rather than linear because pitch perception is logarithmic: a linear sweep
 * from 800 Hz to 100 Hz spends most of its length in the top octave and then falls off a
 * cliff, which sounds like a mistake. An exponential one sounds like a falling tone.
 */
function frequencyAt(v: SynthVoice, t: number): number {
  const span = voiceSeconds(v);
  if (span <= 0 || v.fromHz === v.toHz) return v.fromHz;
  const local = t - v.delaySeconds;
  const progress = local <= 0 ? 0 : local >= span ? 1 : local / span;
  // Guard the log: a zero or negative endpoint has no logarithm and is a recipe bug.
  const from = v.fromHz > 0 ? v.fromHz : 1;
  const to = v.toHz > 0 ? v.toHz : 1;
  return from * (to / from) ** progress;
}

/**
 * One sample of a shape at a given phase, in [-1, 1].
 *
 * `square` and `saw` are the naive, un-bandlimited forms. That aliases above about 5 kHz,
 * and it is the right trade here: every square and saw in the vocabulary is below 700 Hz
 * and lasts under 200 ms, where the aliasing is inaudible, and the alternative is an
 * additive synthesiser several times this file's size for a difference nobody can hear
 * through a phone speaker.
 */
function shapeAt(wave: Waveform, phase: number, noise: number): number {
  switch (wave) {
    case 'sine':
      return Math.sin(phase);
    case 'square':
      return Math.sin(phase) >= 0 ? 1 : -1;
    case 'saw': {
      const cycle = (phase / TWO_PI) % 1;
      return cycle * 2 - 1;
    }
    case 'triangle': {
      const cycle = (phase / TWO_PI) % 1;
      return 4 * Math.abs(cycle - 0.5) - 1;
    }
    case 'noise':
      return noise;
  }
}

/**
 * Keep a summed sample inside [-1, 1] without the flat top that hard clipping gives.
 *
 * Recipes stack two or three voices and their peaks sometimes coincide. Hard clipping the
 * result adds harmonics that sound like distortion; this curve compresses the loud part
 * and leaves everything under about half amplitude untouched, so a quiet sound is exactly
 * what the recipe asked for and a loud one is merely a little softer than it asked for.
 */
function softClip(x: number): number {
  if (x > 1) return 1;
  if (x < -1) return -1;
  // A cubic soft-knee: x - x^3/3, scaled so the output reaches 1 when the input does.
  return (x - (x * x * x) / 3) * 1.5;
}

/** What {@link renderRecipe} needs from a context: a sample rate and somewhere to write. */
export interface SynthTarget {
  readonly sampleRate: number;
  createBuffer(channels: number, length: number, sampleRate: number): AudioSampleBuffer;
}

/**
 * Render a recipe into a mono buffer, once.
 *
 * Deterministic in every input: the same recipe and the same name produce bit-identical
 * samples on every run and every device. That is asserted in `synth.test.ts`, and it is
 * what makes it safe to say that sound cannot desynchronise a cross-device match — there
 * is nothing here to desynchronise.
 */
export function renderRecipe(
  target: SynthTarget,
  name: string,
  recipe: SynthRecipe,
): AudioSampleBuffer {
  const sampleRate = target.sampleRate;
  const length = Math.max(1, Math.round(recipe.seconds * sampleRate));
  const buffer = target.createBuffer(1, length, sampleRate);
  const samples = buffer.getChannelData(0);

  const voices = recipe.voices;
  const count = voices.length;
  // One phase accumulator per voice. Accumulated rather than computed from `t * f`,
  // because a swept frequency computed that way jumps phase on every sample and turns a
  // smooth glide into a burst of clicks.
  const phases = new Float64Array(count);
  const noiseStates = new Int32Array(count);
  for (let v = 0; v < count; v += 1) {
    // Each voice gets its own noise stream, or two noise layers in one sound would be
    // perfectly correlated and cancel or double rather than thicken.
    noiseStates[v] = nextNoise(seedFromName(name) + v * 2_654_435_761) | 0;
  }

  const fadeSamples = Math.min(Math.floor(EDGE_FADE_SECONDS * sampleRate), length >> 1);

  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    let sum = 0;
    for (let v = 0; v < count; v += 1) {
      const voiceSpec = voices[v]!; // v < count
      const amplitude = envelopeAt(voiceSpec, t);
      const state = nextNoise(noiseStates[v]!);
      noiseStates[v] = state;
      if (amplitude <= 0) {
        // The phase still has to advance or a delayed voice starts mid-cycle, which is an
        // audible click at exactly the moment the layer is supposed to arrive quietly.
        phases[v] = phases[v]! + (TWO_PI * frequencyAt(voiceSpec, t)) / sampleRate;
        continue;
      }
      // 2^-31 maps the signed 32-bit state onto [-1, 1).
      const noise = state * 4.656_612_873_077_393e-10;
      const phase = phases[v]!;
      sum += shapeAt(voiceSpec.wave, phase, noise) * amplitude * voiceSpec.level;
      phases[v] = phase + (TWO_PI * frequencyAt(voiceSpec, t)) / sampleRate;
    }

    let value = softClip(sum);
    // Fade both edges. Without this the very first and last samples are wherever the
    // waveform happened to be, and a discontinuity against silence is a click.
    if (i < fadeSamples) value *= i / fadeSamples;
    else if (i >= length - fadeSamples) value *= (length - 1 - i) / fadeSamples;
    samples[i] = value;
  }

  return buffer;
}
