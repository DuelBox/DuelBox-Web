import type { Rng } from './rng.js';

/**
 * Every sound this product may play, who is allowed to raise it, and what it tells a
 * player (#168).
 *
 * ## Why a vocabulary comes before a sound pack
 *
 * A sound is a name long before it is a file. {@link AudioSystem.play} takes a string, and
 * a string with no agreed list behind it is coined at each call site: a hundred and eight
 * game packages would arrive at `hit`, `bat`, `thwack` and `contact` for one meaning, and
 * the recordings of #169 would then have to be commissioned per game rather than per
 * meaning. Naming the meanings first is what lets one recording serve every game that
 * means the same thing by it, and it is what makes "does this cue have a visual
 * counterpart" (#180) a question with one answer per entry instead of one answer per game.
 *
 * ## The split that matters
 *
 * CLAUDE.md: "Countdown, HUD, pause, result, rematch ... all come from the SDK. A bespoke
 * version of any of those inside a game package is a bug." That is as true of how those
 * moments sound as of how they look, so every entry names its owner and the two owners get
 * types of their own — see {@link GameSoundBus}. A game raising the shell's countdown is
 * not a different sound, it is the same defect as a game drawing its own pause menu, and
 * it should be a compile error rather than something a reviewer notices.
 *
 * ## Nothing in here plays anything yet
 *
 * No sound file exists in this repository (#169, #170) and no game emits a cue. This
 * module is the agreement the recordings and the emitters will both be written against.
 * `play()` returns false for a name nothing has registered, so the shell can raise its
 * cues today, hear silence, and be raising real ones the day a library lands — which is
 * the point of wiring the names ahead of the files rather than after them.
 *
 * ## Every cue owes a visual counterpart
 *
 * Rule 7 says colour is never the only signal; #180 says the same of sound, and for a
 * stronger reason — a phone is muted by default, an autoplay policy silences the first
 * match until somebody taps, and a deaf player hears none of it ever. So a cue is only
 * half of a piece of feedback: the other half is drawn, and
 * `apps/web/src/lib/sound-visuals.ts` records which drawn thing, per entry, and fails when
 * an entry has none.
 */

/** Who may raise a cue. The distinction is CLAUDE.md's, applied to sound. */
export type SoundOwner = 'shell' | 'game';

/** What one entry in the vocabulary has to say about itself. */
export interface SoundEventSpec {
  readonly owner: SoundOwner;
  /** The moment it fires, said precisely enough that two implementers pick the same one. */
  readonly when: string;
  /**
   * What the player is being told. Two entries that would answer this the same way are one
   * entry with two names, and the second is the one a sound pack ends up missing.
   */
  readonly means: string;
}

/**
 * The vocabulary. Fourteen cues, six of them the shell's and eight a game's.
 *
 * Deliberately short. Every name here has to be worth a recording, a visual counterpart and
 * a place in every game's QA pass, and a vocabulary that lists every noise a designer might
 * one day want is a vocabulary nobody can finish implementing.
 */
export const SOUND_EVENTS = {
  countdown: {
    owner: 'shell',
    when: 'Each whole second of the pre-round count-in, while the match machine is counting down.',
    means: 'The board is about to become live, and this is how long both seats have to get ready.',
  },
  start: {
    owner: 'shell',
    when: 'The count-in reaches zero and the simulation takes its first step of the round.',
    means: 'Act now. Anything either seat did before this did not reach the board.',
  },
  // There is deliberately no `resume`. `reduce()` answers a resume by replaying the
  // count-in rather than dropping straight back into play, so coming back from a pause
  // already raises `countdown` and then `start`; a cue of its own would be a second sound
  // for a moment that is not a second moment.
  pause: {
    owner: 'shell',
    when: 'The match stops on purpose: the pause button, Escape, or the window going away.',
    means: 'The board is frozen, and nothing either seat does now reaches it.',
  },
  // One neutral cue for the end of a round rather than a win and a loss. Both people are
  // sitting at one device and hear the same speaker, so a cue that congratulates one of
  // them is a cue that gloats at the other; which seat took the round is on the panel, in
  // the pips, and in the announcement. The end of the *match* is different — see below.
  'round-over': {
    owner: 'shell',
    when: 'A round is settled with rounds still to play.',
    means: 'That round is over and the match is not.',
  },
  'match-win': {
    owner: 'shell',
    when: 'The match settles with a winner.',
    means: 'It is finished, and somebody took it.',
  },
  // Split from `match-win` for the reason `lib/haptics.ts` already gives a draw the short
  // tap rather than the win pattern: the phone is lying between two people who both just
  // failed to win, and celebrating at them is the wrong note.
  'match-draw': {
    owner: 'shell',
    when: 'The match settles level.',
    means: 'It is finished and nobody took it.',
  },

  launch: {
    owner: 'game',
    when: "Something is sent on its way by a player's command: a serve, a delivery, a shot, a throw.",
    means: 'That input was taken, and the thing it aimed is now beyond taking back.',
  },
  hit: {
    owner: 'game',
    when: 'Two things meet because a player made them meet, at the moment of contact.',
    means: 'The timing connected.',
  },
  // Cricket learned this one the hard way and its `#updateFlight` still carries the note: a
  // ball pitching raised a `bounce` and nothing on screen marked where, because height is
  // drawn as radius and a pitched ball is only a ball that got briefly smaller. A cue whose
  // contact point is not drawn stays silent until it is drawn, rather than becoming the one
  // thing in the match a player can only hear.
  bounce: {
    owner: 'game',
    when: 'Something rebounds off the world rather than off a player: a wall, the floor, a rail.',
    means: 'The path changed, and it changed here.',
  },
  // A game's, though the shell draws the number. The shell only knows that a tally moved;
  // the game knows whether that was a boundary, a goal or a matched pair, and the sound of
  // scoring is one of the few things that is genuinely characteristic of a game rather than
  // of the match flow around it. There is no shell `score` cue, so nothing can double up.
  score: {
    owner: 'game',
    when: "The emitting seat's tally goes up.",
    means: 'That counted, and the number beside your name has moved.',
  },
  fault: {
    owner: 'game',
    when: 'A player loses something to the rules: a miss, a wicket, a foul, a life.',
    means: 'That cost you, and the game has moved on without you.',
  },
  select: {
    owner: 'game',
    when: 'A player picks up, or moves onto, a legal choice in a turn-based game.',
    means: 'This is the thing you have hold of.',
  },
  place: {
    owner: 'game',
    when: "A player's move is accepted and the board changes.",
    means: 'The move is played and the position in front of you is new.',
  },
  reject: {
    owner: 'game',
    when: 'A player asks for something the rules will not accept.',
    means: 'Nothing happened. The board is exactly as it was.',
  },
} as const satisfies Record<string, SoundEventSpec>;

/** Every name in the vocabulary. */
export type SoundEvent = keyof typeof SOUND_EVENTS;

/** The names one owner holds, derived from the table so the two can never drift apart. */
type OwnedBy<O extends SoundOwner> = {
  [K in SoundEvent]: (typeof SOUND_EVENTS)[K]['owner'] extends O ? K : never;
}[SoundEvent];

/**
 * The cues the shell raises from the match machine. A game emitting one of these is the
 * bug this split exists to make impossible.
 */
export type ShellSoundEvent = OwnedBy<'shell'>;

/** The cues a game raises from its own simulation. */
export type GameSoundEvent = OwnedBy<'game'>;

/**
 * What the vocabulary says about a name, or undefined if it says nothing.
 *
 * Takes a plain string on purpose: its callers are the guards, which read names out of
 * source files and out of a bundle, where a name is exactly as likely to be a typo as to be
 * a cue.
 */
export function soundEventSpec(name: string): SoundEventSpec | undefined {
  // Asked before indexing, because an object literal inherits from `Object.prototype`: the
  // plain index answered `soundEventSpec('toString')` with a function, and a guard asking
  // "is this string a declared cue" would have been told yes. Found by the test below,
  // which was written expecting it to pass.
  if (!Object.hasOwn(SOUND_EVENTS, name)) return undefined;
  return (SOUND_EVENTS as Readonly<Record<string, SoundEventSpec>>)[name];
}

/**
 * The audio surface a game is handed: {@link AudioSystem}, narrowed to the cues a game owns.
 *
 * This is the cheap half of "a game cannot raise a shell cue". `AudioSystem.play` takes a
 * string, because it is also what registers and plays whatever a sound pack contains; a
 * game never sees that. It sees this, and `bus.play('countdown')` does not compile.
 *
 * `AudioSystem` satisfies it structurally, exactly as the renderer's canvas context does,
 * so nothing has to be wrapped or adapted when {@link GameContext} finally carries one —
 * and `sound-events.test.ts` holds the compiler to that.
 */
export interface GameSoundBus {
  play(event: GameSoundEvent, gain?: number, rate?: number): boolean;
  playVaried(event: GameSoundEvent, rng: Rng, cents?: number, gain?: number): boolean;
}
