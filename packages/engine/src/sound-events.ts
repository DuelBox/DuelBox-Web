/**
 * The whole vocabulary of sound in DuelBox, and the bus a game says one of them through.
 *
 * ## Why a closed set of names
 *
 * A game says *what happened*. The engine decides what that sounds like. That is the same
 * division CLAUDE.md draws everywhere else — "games supply a simulation and a win
 * condition; countdown, HUD, pause, result, rematch and seat rotation all come from the
 * SDK" — and it buys three things that letting games specify waveforms would not:
 *
 * 1. **107 games sound like one product.** A hit is the same hit in Air Hockey and in
 *    Pinball, so a player who has learned what a fault sounds like has learned it once.
 * 2. **Issue #180 stays satisfiable.** "Every audio-only cue needs a visual indicator" is
 *    only checkable against a finite list of cues. An open vocabulary makes it a promise
 *    nothing can enforce, which is the exact failure this repository keeps finding.
 * 3. **The size budget.** Ten recipes, rendered once, shared by every game.
 *
 * ## Why these ten
 *
 * They are what is left after asking, of every game in the catalogue, "what did the player
 * just learn?" — not "what object moved?". Five belong to the match and are emitted by the
 * shell, so no game ever reimplements a countdown beep. Five belong to the game and split
 * along the one line that actually matters to a player: **did I cause this, or did the
 * world?** A puck struck by a mallet and a puck rebounding off a rail are different events
 * to the person holding the mallet, and giving them one name would make the game less
 * legible, not simpler.
 *
 * ## What is deliberately not here
 *
 * No music, no ambience, no per-game sounds, no way to pass a frequency. A game that
 * believes it needs a sound outside this list should say so on the issue: either the list
 * is missing a *category* (and gains one name, for everybody) or the game is asking to
 * sound different for its own sake, which is how a product ends up with 107 sound designs.
 */

import type { AudioSystem } from './audio.js';
import type { SeatId } from './seat.js';
import { recipe, renderRecipe, voice, type SynthRecipe } from './synth.js';

/**
 * Every sound the product can make. Adding to this list is a product decision, and the
 * guard in `apps/web/src/data/audio-cues.test.ts` will fail until the new entry has a
 * named visual counterpart backed by real code.
 */
export const SOUND_EVENTS = [
  'countdown',
  'start',
  'pause',
  'win',
  'hit',
  'bounce',
  'launch',
  'score',
  'fault',
  'select',
] as const;

export type SoundEvent = (typeof SOUND_EVENTS)[number];

/** Who is expected to emit a cue. Games never emit match cues and vice versa. */
export type SoundEventSource = 'shell' | 'game';

export interface SoundEventSpec {
  /** What the player has just learned. One sentence, in the player's terms. */
  readonly meaning: string;
  readonly source: SoundEventSource;
}

/**
 * What each name means, written down so that two games cannot quietly disagree about it.
 *
 * This is the contract a game reads before choosing a name, and the text the #180 guard
 * quotes when it fails.
 *
 * `/*#__PURE__*\/` is load-bearing rather than decorative. This table is documentation:
 * it is read by the guards and by whoever wires the next game, and by nothing that ships.
 * But `Object.freeze` is a call, so a bundler cannot prove the statement is safe to drop
 * and keeps it — which put six hundred bytes of English prose into a chunk every visitor
 * downloads. The annotation is how you say "dropping this is safe" to webpack, Rollup and
 * esbuild alike. Same for {@link SILENT_BUS} below.
 */
export const SOUND_EVENT_SPECS: Readonly<Record<SoundEvent, SoundEventSpec>> =
  /*#__PURE__*/ Object.freeze({
    countdown: { source: 'shell', meaning: 'One second of the pre-round count has passed.' },
    start: { source: 'shell', meaning: 'The count has finished and the board is now live.' },
    pause: { source: 'shell', meaning: 'The match has stopped on purpose.' },
    win: { source: 'shell', meaning: 'A round or the match has been decided.' },
    hit: { source: 'game', meaning: 'A player struck something: a paddle, a bat, a fist.' },
    bounce: { source: 'game', meaning: 'Something rebounded off the world. Nobody chose it.' },
    launch: { source: 'game', meaning: 'Something was released into play: a serve, a throw.' },
    score: { source: 'game', meaning: 'The tally changed.' },
    fault: { source: 'game', meaning: 'An attempt failed or was illegal: a miss, an early tap.' },
    select: { source: 'game', meaning: 'A discrete choice was committed: a piece placed.' },
  });

/**
 * How a game asks for a sound.
 *
 * **Every parameter is a primitive and there is no options bag**, because a game emits
 * from inside `update()` and rule 5 forbids allocating there. An `{ intensity: 0.8 }`
 * literal at a call site allocates on every collision; three positional numbers do not.
 *
 * A game must work when this is absent — `context.audio` is optional and is `undefined` in
 * every headless test and every balance run. `context.audio?.emit(...)` is the whole
 * calling convention, and optional chaining allocates nothing either.
 */
export interface SoundBus {
  /**
   * @param event     one of {@link SOUND_EVENTS}. Unknown names are ignored, not thrown:
   *                  a typo must not be able to end a match.
   * @param intensity 0 to 1, how hard. Clamped. Maps to loudness, and for impacts also to
   *                  a little brightness, so a tap and a slam are the same sound.
   * @param seat      whose action this was, or null for the world's. The two seats are
   *                  pitched apart, which is rule 7 ("colour is never the only signal")
   *                  applied to the one channel that has no colour.
   */
  emit(event: SoundEvent, intensity?: number, seat?: SeatId | null): void;
}

/**
 * A bus that does nothing, for anywhere there is no audio at all.
 *
 * Handed out rather than left as `undefined` where a non-optional bus is convenient. It is
 * a frozen singleton, so using it costs no allocation either.
 */
export const SILENT_BUS: SoundBus = /*#__PURE__*/ Object.freeze({
  emit(): void {
    /* Sound is presentation. Nothing that reads state may live here. */
  },
});

/** Cents the two seats are pitched apart, so p1 and p2 are told apart by ear. */
const SEAT_CENTS = 38;

/** Widest deliberate detune applied to a repeated cue, in cents. A fifth of a semitone. */
const VARIATION_CENTS = 45;

const CENTS_PER_OCTAVE = 1200;

/**
 * The recipes. One per name; rendered once when the bank is registered, never per play.
 *
 * The design brief for all ten: short (nothing over 600 ms), quiet, and distinguishable
 * from each other on a phone speaker in a room with two people talking over it.
 */
/**
 * The recipes. One per name; rendered once when the bank is registered, never per play.
 *
 * The design brief for all ten: short (nothing over 600 ms), quiet, and distinguishable
 * from each other on a phone speaker in a room with two people talking over it.
 *
 * Read the voices as a table. Each row is
 *
 * ```
 * voice(wave, fromHz, toHz, delay, attack, hold, release, level)
 * ```
 *
 * with every duration in seconds and `level` a peak amplitude in [0, 1]. Positional
 * rather than named because object-literal keys survive minification: see {@link voice}.
 */
export const SOUND_RECIPES: Readonly<Record<SoundEvent, SynthRecipe>> = {
  // A soft, flat blip. Deliberately unremarkable: it happens three times before every
  // round and an interesting sound heard six hundred times is an irritating one.
  countdown: recipe(0.16, voice('sine', 660, 660, 0, 0.005, 0.03, 0.1, 0.5)),

  // The same blip rising an octave and held: the count resolving rather than continuing,
  // with a thin harmonic arriving late. "Go" is the one moment that should feel like a
  // door opening.
  start: recipe(
    0.34,
    voice('sine', 660, 990, 0, 0.006, 0.05, 0.2, 0.55),
    voice('triangle', 1320, 1320, 0.05, 0.005, 0.02, 0.16, 0.2),
  ),

  // A falling tone: the shape every interface has used for "stopped" for forty years,
  // and the one place borrowing a convention is right — a convention is not an asset.
  pause: recipe(0.3, voice('sine', 520, 300, 0, 0.008, 0.02, 0.22, 0.42)),

  // The only sound allowed to last half a second, because it is the one that ends
  // something: a triad arriving a note at a time.
  win: recipe(
    0.6,
    voice('sine', 523, 523, 0, 0.008, 0.04, 0.3, 0.34),
    voice('sine', 659, 659, 0.08, 0.008, 0.04, 0.3, 0.32),
    voice('sine', 784, 784, 0.16, 0.008, 0.06, 0.36, 0.3),
  ),

  // A struck thing: a noise transient of a few milliseconds over a short falling tone.
  // The transient is what the ear reads as "solid"; the tone is what gives it a size.
  hit: recipe(
    0.12,
    voice('noise', 0, 0, 0, 0.001, 0.002, 0.03, 0.5),
    voice('triangle', 420, 180, 0, 0.002, 0.01, 0.08, 0.45),
  ),

  // The same event minus the player: shorter, higher, thinner, and with no noise layer,
  // so a rail is instantly not a mallet even when the two happen a frame apart.
  bounce: recipe(0.08, voice('sine', 900, 620, 0, 0.001, 0.004, 0.05, 0.3)),

  // Something leaving: a rising saw, brief, with a breath of noise underneath it.
  launch: recipe(
    0.18,
    voice('saw', 220, 620, 0, 0.004, 0.01, 0.11, 0.3),
    voice('noise', 0, 0, 0, 0.01, 0, 0.09, 0.16),
  ),

  // Two rising notes. Related to `win` and shorter than it, because a point is a small
  // version of the same news and should sound like one.
  score: recipe(
    0.34,
    voice('sine', 587, 587, 0, 0.006, 0.03, 0.14, 0.4),
    voice('sine', 880, 880, 0.09, 0.006, 0.04, 0.2, 0.36),
  ),

  // A low square falling: hollow, synthetic, unmistakably a refusal, and short enough
  // that a player who mistimes ten taps in a row is not punished ten times over.
  fault: recipe(0.22, voice('square', 220, 130, 0, 0.004, 0.02, 0.16, 0.26)),

  // The quietest thing in the set. It fires on every tap of a turn-based game, so it has
  // to be closer to a keyboard's click than to a notification.
  select: recipe(0.09, voice('sine', 1200, 1100, 0, 0.001, 0.004, 0.055, 0.22)),
};

/**
 * Render every recipe into the system's context and register it under its own name.
 *
 * Called once by the shell, as soon as there is a context to render into. Returns false in
 * a runtime with no Web Audio at all, which is a thing to route around rather than crash
 * on: `emit` on a bank that was never registered is a lookup miss and a no-op.
 *
 * Decoding is not involved and neither is the network. Ten buffers of a few hundred
 * milliseconds each is under a hundred thousand samples in total — a couple of
 * milliseconds of arithmetic, done once, off the hot path.
 */
export function registerSoundBank(system: AudioSystem): boolean {
  const context = system.context();
  if (context === undefined) return false;
  for (const event of SOUND_EVENTS) {
    system.register(event, renderRecipe(context, event, SOUND_RECIPES[event]), 1);
  }
  return true;
}

/**
 * The bus the shell hands to a game.
 *
 * ## Why the variation is not random
 *
 * A cue fired forty times in a match sounds like forty copies of one recording unless the
 * pitch moves a little. Rule 4 forbids `Math.random`, and a seeded `Rng` would work — but
 * it would be a *second* stream that both devices in a cross-device match would have to
 * agree about, seeded and advanced in lockstep, for a benefit measured in cents of pitch.
 *
 * So the variation is not random at all. It is a hash of *how many times this cue has
 * already fired*, which every device knows without being told, and which makes the whole
 * question of whether audio can desynchronise a match answerable with "there is nothing to
 * desynchronise". The counter is per-cue and lives in an `Int32Array` sized at construction.
 *
 * ## Why nothing here can affect the simulation
 *
 * `emit` returns `void`, reads no state, and writes only to its own counters and to the
 * audio system's preallocated queue. A game cannot observe whether a sound played, whether
 * the context is running, or whether the player is muted — so the same match steps
 * identically with sound on, with sound off, and in Node with no `AudioContext` at all.
 * That is asserted in `sound-events.test.ts` rather than left as a comment.
 */
export class EngineSoundBus implements SoundBus {
  readonly #system: AudioSystem;
  /** One counter per cue, so `hit` and `bounce` vary independently. */
  readonly #fired: Int32Array;

  constructor(system: AudioSystem) {
    this.#system = system;
    this.#fired = new Int32Array(SOUND_EVENTS.length);
  }

  /** How many times a cue has been asked for. Presentation only; for tests and the HUD. */
  firedCount(event: SoundEvent): number {
    const index = SOUND_EVENTS.indexOf(event);
    return index < 0 ? 0 : this.#fired[index]!;
  }

  emit(event: SoundEvent, intensity = 1, seat: SeatId | null = null): void {
    // `indexOf` over ten interned strings, rather than the `Map` this used to build at
    // module load. Both are allocation-free and the map was marginally faster, but a
    // pointer comparison against at most ten strings a few times a second is not a cost
    // anybody can measure, and the map was thirty-odd bytes in a chunk every visitor
    // downloads. The shell budget is the tighter constraint of the two.
    const index = SOUND_EVENTS.indexOf(event);
    // A name that is not in the vocabulary. Silently ignored rather than thrown: this is
    // reachable from inside a fixed step, and a thrown error there ends the match.
    if (index < 0) return;

    const n = this.#fired[index]!;
    this.#fired[index] = n + 1;

    // Knuth's multiplicative hash of the firing count, taken as a fraction of a turn.
    // Deterministic, allocation-free, and uncorrelated enough between successive n that
    // two hits in a row never land on the same detune.
    const hashed = Math.imul(n + 1, 2_654_435_761) >>> 0;
    const unit = (hashed >>> 8) / 0x100_0000;
    const seatCents = seat === null ? 0 : seat === 'p1' ? -SEAT_CENTS : SEAT_CENTS;
    const cents = (unit * 2 - 1) * VARIATION_CENTS + seatCents;

    const level = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
    this.#system.play(event, level, 2 ** (cents / CENTS_PER_OCTAVE));
  }
}

/**
 * A bus that remembers what it was asked for and plays nothing.
 *
 * This is the seam the #180 guard drives a game through: play a match, ask the recorder
 * what cues came out, and require a declared visual counterpart for every one of them. It
 * is also how a game's own tests assert that a hit makes a hit sound.
 *
 * **Test and guard use only.** It grows three arrays, which is exactly the allocation
 * inside `update()` that rule 5 forbids, and it is deliberately not exported to the shell.
 */
export class RecordingSoundBus implements SoundBus {
  readonly events: SoundEvent[] = [];
  readonly intensities: number[] = [];
  readonly seats: (SeatId | null)[] = [];

  emit(event: SoundEvent, intensity = 1, seat: SeatId | null = null): void {
    this.events.push(event);
    this.intensities.push(intensity);
    this.seats.push(seat);
  }

  /** The distinct cues seen, in first-seen order. */
  distinct(): SoundEvent[] {
    const seen: SoundEvent[] = [];
    for (const event of this.events) {
      if (!seen.includes(event)) seen.push(event);
    }
    return seen;
  }

  count(event: SoundEvent): number {
    let total = 0;
    for (const seen of this.events) {
      if (seen === event) total += 1;
    }
    return total;
  }

  clear(): void {
    this.events.length = 0;
    this.intensities.length = 0;
    this.seats.length = 0;
  }
}
