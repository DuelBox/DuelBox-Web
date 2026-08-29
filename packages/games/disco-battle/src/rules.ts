import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Disco Battle, as pure rules.
 *
 * One track of notes runs at both players at once. A note reaches your platform; press as it
 * lands. Dead centre is worth three, near enough is worth one, a note nobody answers costs a
 * point and so does a press that answers nothing. The track is a fixed length and the higher
 * score at the end of it wins.
 *
 * ## Four decisions carry the whole game
 *
 * **A press is one binary event, so this is the most instrument-neutral archetype there is.**
 * Cup Pong had to give up the reference's swipe to keep a thumb and a key equivalent, and
 * Target Practice spends two presses against two gauges. A rhythm game asks for neither: the
 * entire control surface is `actionPressed`, one bit per seat per step, and `game.ts` reads
 * nothing else — not the pointer position, not the move vector, not the hold. There is no
 * continuous quantity anywhere in this game for one instrument to be finer at than another,
 * so `sameInputClassOnly` is false without a caveat and a test asserts the manifest says so.
 * **[ours, in the sense that the row named no control scheme and this one cost nothing]**
 *
 * **Both seats get the identical track, and that is what makes the duel fair.** `arrivals` is
 * one array, generated once, read by both seats. There is no per-seat stream to drift apart
 * and no board coordinate to mirror wrongly: the two seats differ only in what they pressed.
 * Seat symmetry is therefore not a measurement here, it is an involution — swap the two
 * seats' presses and the two scores swap exactly, which `rules.test.ts` asserts over hundreds
 * of random tracks and press sequences rather than inferring from a win rate. **[ours]**
 *
 * **Nothing in this file is a length.** A note is an arrival *time*; a window is a tolerance
 * in *seconds*; the referee compares two clocks. `game.ts` multiplies by the approach speed
 * to draw the lane, and that is the only place a unit of board appears. Rule 8 is not merely
 * obeyed, it is inexpressible — and it is what makes the bot's countdown and the referee's
 * window the *same arithmetic* rather than two roads to nearly the same answer (issue #2465).
 *
 * **The windows are wide enough to be a ladder, and they are drawn at their true size.** The
 * fixed step is 60 Hz, so a tolerance under about 16 ms is unhittable and a tolerance
 * measured in frames is measured in the wrong unit. Target Practice's whole difficulty ladder
 * once collapsed into three spellings of "nearly perfect" inside four frames of each other,
 * because the floor of its window was the frame rate. Here the perfect window is 9 frames
 * across and the good window is 21.6, and `game.ts` draws both bands at
 * `window x APPROACH_SPEED` — so the tolerance a player is being asked for is a shape on the
 * board rather than a number in a spec. **There is no audio in this product yet** (#168–#170),
 * so every cue this game gives is visual by necessity as well as by the definition of done.
 *
 * No rendering, no timing, no DOM.
 */

/* ------------------------------------------------------------------ the track */

/**
 * The smallest division of the beat, in seconds, and the three gaps a note may sit at.
 *
 * 0.25 s is a quaver at 120 beats a minute. Gaps of two, three and four slots are
 * 0.5, 0.75 and 1.0 seconds, and **the shortest of them is what makes the referee
 * unambiguous**: two good windows are `2 x GOOD_SECONDS` = 0.36 s wide together, so no press
 * can ever be inside the window of two different notes at once. That is asserted rather than
 * assumed, because the alternative is a tie-break between two notes — and a tie-break is
 * exactly the thing Maze Paint and Frozen Beaks were caught getting wrong.
 */
export const SLOT_SECONDS = 0.25;
export const GAP_MENU: readonly number[] = Object.freeze([2, 3, 4]);
/** How many gaps of each length the track holds. The multiset is fixed; only the order moves. */
export const GAPS_PER_LENGTH = 16;
export const NOTE_COUNT = GAP_MENU.length * GAPS_PER_LENGTH + 1;
/** Slots from the first note to the last. Fixed, because the gap multiset is fixed. */
export const TRACK_SLOTS = GAPS_PER_LENGTH * (2 + 3 + 4);
export const TRACK_SECONDS = TRACK_SLOTS * SLOT_SECONDS;

/**
 * When the first note lands, and how long the last one is given to be answered.
 *
 * The lead-in is longer than {@link APPROACH_SECONDS} on purpose: the board is empty for half
 * a second before the first note appears, so a player looking down at a fresh track sees it
 * arrive rather than finding it already halfway there.
 */
export const LEAD_SECONDS = 2.5;
export const TAIL_SECONDS = 1.5;

/**
 * The whole match, in seconds. **Exact, for every seed.**
 *
 * The track is a fixed multiset of gaps that is *shuffled* rather than drawn, so its total
 * length cannot vary — 48 gaps summing to 144 slots whatever order they come in. That is what
 * makes termination structural: nothing a player or a bot can do adds a note or a second, and
 * `roundSeconds` in the manifest is this number rather than a hope. `roundSeconds` ends
 * nothing; the clock in this file does.
 */
export const MATCH_SECONDS = LEAD_SECONDS + TRACK_SECONDS + TAIL_SECONDS;

/**
 * How long a note is visible before it lands.
 *
 * This is the only quantity in the game a player reads as a *distance*, and it is read off a
 * lane whose length is fixed: a note travels the lane at a constant speed, so the gap between
 * a note and the platform is a linear picture of the seconds left. Two seconds is what a
 * person needs to see a note, place the beat, and commit.
 *
 * It also bounds the bot. A tier commits to a moment when a note appears, and the largest
 * error any tier can commit to is `timing x FUMBLE_SCALE` = 0.92 s at `easy`, comfortably
 * inside this — so a bot's countdown is always positive when it is set. A test asserts that
 * for every tier, because a countdown that starts already expired is the shape of a bot that
 * mashes rather than one that is merely late.
 */
export const APPROACH_SECONDS = 2;

/* ------------------------------------------------------------------ the windows */

/**
 * How far either side of the beat a press still counts, in seconds.
 *
 * **Neither boundary can land on a frame.** The clock advances in sixtieths and every arrival
 * is `2.5 + k x 0.25`, so a press is at `n/60` and `|press - arrival| = 0.075` would need
 * `n = 154.5 + 15k` and `= 0.18` would need `n = 160.8 + 15k`. Neither is ever an integer.
 * That is deliberate: the failure Frozen Beaks and Snowball Throw were bisected down to is a
 * threshold a state variable lands on *exactly by construction*, where two seats accumulating
 * from opposite ends straddle it in the last bits. Here the two seats read one clock, and the
 * boundaries are unreachable anyway. A test checks both properties.
 *
 * In frames: the perfect window is 9 across and the good window 21.6. Target Practice asserts
 * eight as its floor and this file asserts the same.
 */
export const PERFECT_SECONDS = 0.075;
export const GOOD_SECONDS = 0.18;

/* ------------------------------------------------------------------ the score */

export const PERFECT_POINTS = 3;
export const GOOD_POINTS = 1;
/** A note whose window closes with nobody having answered it. */
export const MISS_PENALTY = 1;
/** A press with no unanswered note inside the good window. "Each mistake will lower your score." */
export const WILD_PENALTY = 1;

/** Seconds the platform holds the mark left by the last judgement. Presentation reads it. */
export const FLASH_SECONDS = 0.22;

export type Judgement = 'none' | 'perfect' | 'good' | 'missed';
/** What the platform is showing: the four judgements plus a press that answered nothing. */
export type Verdict = 'none' | 'perfect' | 'good' | 'missed' | 'wild';

export interface Side {
  score: number;
  perfect: number;
  good: number;
  missed: number;
  /** Presses that answered nothing. Not a note outcome, so it is not in `judged`. */
  wild: number;
  /** How the last thing this seat did was judged, and how long that mark has left. */
  verdict: Verdict;
  flash: number;
  /**
   * Signed seconds by which the last judged press missed the beat. Early is negative.
   *
   * Presentation only — nothing in the rules reads it. It is what lets `game.ts` show a
   * player *which way* they were wrong without a word of text or a note of sound.
   */
  lastOffset: number;
}

export interface State {
  /**
   * When each note lands, in seconds from the start of the match.
   *
   * **One array, both seats.** Not two arrays that happen to agree: the seats cannot be handed
   * different music even by accident, and `balance-aggregate.test.ts`'s 45-55% band has
   * nothing to catch here because there is no per-seat generation to get wrong.
   */
  readonly arrivals: number[];
  /** How each seat answered each note. Indexed alike; the arrays never change length. */
  readonly p1Judged: Judgement[];
  readonly p2Judged: Judgement[];
  /** Scratch for the shuffle in {@link layOutTrack}. Held here so a reset allocates nothing. */
  readonly gaps: number[];
  readonly p1: Side;
  readonly p2: Side;
  /**
   * The first note whose good window has not yet closed.
   *
   * Shared, because a window closes on the clock rather than on anything a seat did. Every
   * note below it is resolved for *both* seats, which is what lets `game.ts` draw a seat's
   * recent form straight out of `judged` with no second history to keep in step.
   */
  cursor: number;
  clock: number;
  winner: SeatId | 'draw' | null;
}

function makeSide(): Side {
  return {
    score: 0,
    perfect: 0,
    good: 0,
    missed: 0,
    wild: 0,
    verdict: 'none',
    flash: 0,
    lastOffset: 0,
  };
}

export function createState(): State {
  const arrivals = new Array<number>(NOTE_COUNT).fill(0);
  const p1Judged = new Array<Judgement>(NOTE_COUNT).fill('none');
  const p2Judged = new Array<Judgement>(NOTE_COUNT).fill('none');
  const gaps = new Array<number>(NOTE_COUNT - 1).fill(0);
  const state: State = {
    arrivals,
    p1Judged,
    p2Judged,
    gaps,
    p1: makeSide(),
    p2: makeSide(),
    cursor: 0,
    clock: 0,
    winner: null,
  };
  layOutTrack(state, new Rng(1));
  return state;
}

/**
 * Fill in the track: a fixed multiset of gaps, shuffled.
 *
 * Shuffled rather than drawn, and that is the whole termination argument. Drawing 48 gaps
 * from {2, 3, 4} would give a track anywhere between 24 and 48 seconds and a `roundSeconds`
 * that was an average rather than a fact. Fixing the multiset and permuting it gives a track
 * whose *rhythm* is different every match and whose *length* is 36.0 seconds every match.
 */
export function layOutTrack(state: State, rng: Rng): void {
  const gaps = state.gaps;
  let at = 0;
  for (let g = 0; g < GAP_MENU.length; g += 1) {
    const length = GAP_MENU[g] as number;
    for (let k = 0; k < GAPS_PER_LENGTH; k += 1) {
      gaps[at] = length;
      at += 1;
    }
  }
  rng.shuffle(gaps);
  let slot = 0;
  state.arrivals[0] = LEAD_SECONDS;
  for (let n = 1; n < NOTE_COUNT; n += 1) {
    slot += gaps[n - 1] as number;
    state.arrivals[n] = LEAD_SECONDS + slot * SLOT_SECONDS;
  }
}

function resetSide(side: Side): void {
  side.score = 0;
  side.perfect = 0;
  side.good = 0;
  side.missed = 0;
  side.wild = 0;
  side.verdict = 'none';
  side.flash = 0;
  side.lastOffset = 0;
}

export function resetState(state: State, rng: Rng): void {
  layOutTrack(state, rng);
  for (let i = 0; i < NOTE_COUNT; i += 1) {
    state.p1Judged[i] = 'none';
    state.p2Judged[i] = 'none';
  }
  resetSide(state.p1);
  resetSide(state.p2);
  state.cursor = 0;
  state.clock = 0;
  state.winner = null;
}

export function sideOf(state: Readonly<State>, seat: SeatId): Readonly<Side> {
  return seat === 'p1' ? state.p1 : state.p2;
}

export function judgedBy(state: Readonly<State>, seat: SeatId): readonly Judgement[] {
  return seat === 'p1' ? state.p1Judged : state.p2Judged;
}

/** Mistakes a seat has made: notes it let go, plus presses that answered nothing. */
export function mistakesBy(state: Readonly<State>, seat: SeatId): number {
  const side = sideOf(state, seat);
  return side.missed + side.wild;
}

/**
 * Where a note is on its way in, as a fraction of the lane: 0 at the platform, 1 at the top.
 *
 * A fraction rather than a length, so this file still contains no unit of board.
 * Deliberately **not** clamped below zero — a note that has gone past the platform keeps
 * counting down so `game.ts` can draw it leaving. Above one it is not yet in sight.
 */
export function approachOf(state: Readonly<State>, note: number): number {
  return ((state.arrivals[note] as number) - state.clock) / APPROACH_SECONDS;
}

/**
 * How much of the track is still to come, as a fraction of the whole match.
 *
 * A fraction, for the same reason {@link approachOf} is one, and the only clock either player
 * is shown. The shell knows nothing about this match's length — `roundSeconds` is a label on
 * a catalogue card — so the game draws its own, once, in a place both seats are exactly as
 * near to.
 */
export function remainingOf(state: Readonly<State>): number {
  const left = (MATCH_SECONDS - state.clock) / MATCH_SECONDS;
  if (left < 0) return 0;
  return left > 1 ? 1 : left;
}

/**
 * The lowest note index worth drawing. Never negative, and never behind a closed window.
 *
 * The cursor is the first note whose window is still open, so note `cursor - 1` closed at
 * most a step ago and note `cursor - 2` closed a whole gap before that — which at the
 * shortest gap the menu allows is 0.5 s, further past the platform than anything is drawn.
 * Two is therefore not a guess: it is the smallest number that cannot clip a note still on
 * screen.
 */
export function firstDrawable(state: Readonly<State>): number {
  const first = state.cursor - 2;
  return first > 0 ? first : 0;
}

/* ------------------------------------------------------------------ the referee */

export interface StepResult {
  /** Set on the step a seat's press or a closing window produced a judgement. */
  readonly p1Verdict: Verdict;
  readonly p2Verdict: Verdict;
  /** True on the step the match ended. */
  readonly finished: boolean;
}

const result = {
  p1Verdict: 'none' as Verdict,
  p2Verdict: 'none' as Verdict,
  finished: false,
};

/** Highest score when the track runs out. The tie-breaks below are ours; this is the SDK's. */
const WIN_CONDITION: WinCondition = Object.freeze({ kind: 'highest-when-time-expires' as const });

/**
 * Judge one press, at the clock it landed on.
 *
 * The note it answers is the nearest unanswered one, and **there is never more than one
 * candidate**: the shortest gap on the track is 0.5 s and the good window is 0.18 s either
 * side, so two windows cannot overlap. Written as a nearest-search anyway, because a search
 * that can only ever find one thing is cheaper to prove correct than a rule that assumes it —
 * and `rules.test.ts` asserts the assumption separately, over every gap the menu allows.
 *
 * A press that finds nothing is *wild*: it costs a point on its own account. That is the
 * second half of "each mistake will lower your score", and it is the whole of what stops a
 * player mashing — a masher answers every note and pays for the two thousand presses in
 * between.
 */
function judgePress(state: State, seat: SeatId): Verdict {
  const judged = seat === 'p1' ? state.p1Judged : state.p2Judged;
  const side = seat === 'p1' ? state.p1 : state.p2;
  const clock = state.clock;

  let best = -1;
  let bestGap = GOOD_SECONDS;
  for (let i = state.cursor; i < NOTE_COUNT; i += 1) {
    const arrival = state.arrivals[i] as number;
    if (arrival - clock > GOOD_SECONDS) break;
    if (judged[i] !== 'none') continue;
    const gap = Math.abs(arrival - clock);
    if (gap <= bestGap) {
      bestGap = gap;
      best = i;
    }
  }

  if (best < 0) {
    side.wild += 1;
    side.score -= WILD_PENALTY;
    side.lastOffset = 0;
    return 'wild';
  }

  const perfect = bestGap <= PERFECT_SECONDS;
  judged[best] = perfect ? 'perfect' : 'good';
  side.lastOffset = clock - (state.arrivals[best] as number);
  if (perfect) {
    side.perfect += 1;
    side.score += PERFECT_POINTS;
    return 'perfect';
  }
  side.good += 1;
  side.score += GOOD_POINTS;
  return 'good';
}

/**
 * Close every window the clock has run past, and charge both seats for what they let go.
 *
 * Run *after* the presses of the same step, and it makes no difference which order they go in:
 * a press is accepted while `|press - arrival| <= GOOD_SECONDS` and a window closes once
 * `clock > arrival + GOOD_SECONDS`, so the two predicates cannot both be true on one step.
 * They are the same boundary read from opposite sides, which is the property that lets this
 * function be a plain sweep instead of a per-seat scan.
 */
function closeWindows(state: State): void {
  while (state.cursor < NOTE_COUNT) {
    const arrival = state.arrivals[state.cursor] as number;
    if (state.clock <= arrival + GOOD_SECONDS) break;
    if (state.p1Judged[state.cursor] === 'none') {
      state.p1Judged[state.cursor] = 'missed';
      state.p1.missed += 1;
      state.p1.score -= MISS_PENALTY;
      state.p1.verdict = 'missed';
      state.p1.flash = FLASH_SECONDS;
    }
    if (state.p2Judged[state.cursor] === 'none') {
      state.p2Judged[state.cursor] = 'missed';
      state.p2.missed += 1;
      state.p2.score -= MISS_PENALTY;
      state.p2.verdict = 'missed';
      state.p2.flash = FLASH_SECONDS;
    }
    state.cursor += 1;
  }
}

/**
 * One fixed step. `pressP1` and `pressP2` are the whole of the input this game has.
 *
 * The two seats are handled by the same two calls in the same order with no shared state
 * between them — `judgePress` touches only its own seat's arrays, and neither call moves the
 * cursor — so swapping the two press bits swaps the two scores exactly. That is the game's
 * symmetry proof, and `rules.test.ts` asserts it board by board rather than measuring a win
 * rate and hoping.
 *
 * **A press is judged against the clock the step began with, and the clock advances after.**
 * That ordering is the whole of issue #2465 in this game. A tier commits to a moment as
 * `arrival - clock + offset` and counts it down one delta a step, so it presses on the frame
 * nearest `arrival + offset`; the referee has to be reading the same clock on that frame, or
 * every bot press in the catalogue is a systematic sixtieth of a second late — a fifth of the
 * perfect window, charged to one player and not to the person sitting opposite. A test fires
 * on the exact frame `driveBot` chooses and asserts `lastOffset` is the offset the tier drew,
 * to within half a step.
 *
 * Windows close *after* the advance, against the new clock, so the cursor a press is judged
 * against is always the one that was right at that press's own moment.
 */
export function step(
  state: State,
  fixedDeltaSeconds: number,
  pressP1: boolean,
  pressP2: boolean,
): StepResult {
  result.p1Verdict = 'none';
  result.p2Verdict = 'none';
  result.finished = false;
  if (state.winner !== null) return result;

  if (pressP1) {
    const verdict = judgePress(state, 'p1');
    state.p1.verdict = verdict;
    state.p1.flash = FLASH_SECONDS;
    result.p1Verdict = verdict;
  }
  if (pressP2) {
    const verdict = judgePress(state, 'p2');
    state.p2.verdict = verdict;
    state.p2.flash = FLASH_SECONDS;
    result.p2Verdict = verdict;
  }

  state.clock += fixedDeltaSeconds;

  const p1Missed = state.p1.missed;
  const p2Missed = state.p2.missed;
  closeWindows(state);
  if (state.p1.missed !== p1Missed) result.p1Verdict = 'missed';
  if (state.p2.missed !== p2Missed) result.p2Verdict = 'missed';

  if (state.p1.flash > 0) state.p1.flash -= fixedDeltaSeconds;
  if (state.p2.flash > 0) state.p2.flash -= fixedDeltaSeconds;

  if (state.clock >= MATCH_SECONDS) {
    finish(state);
    result.finished = true;
  }
  return result;
}

/**
 * Score first, then dead-centre hits, then mistakes.
 *
 * The first comparison is the SDK's `highest-when-time-expires` rather than a hand-written
 * one, so "highest at the end" means here what it means everywhere else. The two tie-breaks
 * are ours, and they exist because the score is a small integer that two players of the same
 * standard land on together more often than is comfortable — measured at 4.6% of `normal`
 * matches on the score alone, 1.5% with perfects added and 1.1% with mistakes after that.
 *
 * **Neither tie-break is a function of the board.** That is the trap Maze Paint and Sudoku
 * were dug out of: on a symmetric position a covariant rule returns a mirrored answer and so
 * decides nothing. There is no board here to be a function of — a note's arrival is shared by
 * both seats — and the two tie-breaks count what each *player* did, which is the only thing in
 * the game that differs between them.
 */
function finish(state: State): void {
  const outcome = resolve(
    WIN_CONDITION,
    { p1: state.p1.score, p2: state.p2.score },
    { timeExpired: true },
  );
  if (outcome !== 'draw' && outcome !== null) {
    state.winner = outcome;
    return;
  }
  if (state.p1.perfect !== state.p2.perfect) {
    state.winner = state.p1.perfect > state.p2.perfect ? 'p1' : 'p2';
    return;
  }
  const p1Mistakes = state.p1.missed + state.p1.wild;
  const p2Mistakes = state.p2.missed + state.p2.wild;
  if (p1Mistakes !== p2Mistakes) {
    state.winner = p1Mistakes < p2Mistakes ? 'p1' : 'p2';
    return;
  }
  state.winner = 'draw';
}

export function winnerOf(state: Readonly<State>): SeatId | 'draw' | null {
  return state.winner;
}

/* ------------------------------------------------------------------ the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far off the beat it presses, in seconds: the half-range of a triangular error. */
  readonly timing: number;
  /** How often a note is fumbled outright, its error multiplied by {@link FUMBLE_SCALE}. */
  readonly fumble: number;
  /** How often it double-taps a note, throwing away a point on a press that answers nothing. */
  readonly stray: number;
}

/**
 * Three tiers, expressed only as how accurately a tier hits the moment it meant to.
 *
 * That is the whole of the skill a rhythm game asks for, so it is the whole of what the tiers
 * differ in. Every number is in seconds of human error and every one of them is several
 * frames wide, so rule 6 holds by construction — none of these can find a beat more finely
 * than a person can, and none of them is told anything a player cannot see. A tier commits to
 * a moment when the note *appears on the lane*, which is exactly when a player can first see
 * it.
 *
 * `easy` at four tenths of a second sounds generous until you remember there is no sound: a
 * beginner reading a beat off a moving shape, with nothing to hear, is that far out often.
 *
 * **The three are closer together than they look, and that was deliberate.** The first set —
 * 0.46, 0.32, 0.22 — read as a fine ladder on its own scores and was a cliff as a duel:
 * `hard` took 99.4% off `normal` and 100.0% off `easy` over 1600 matches, so two of the three
 * tiers were unplayable rather than merely harder. Narrowing the ends to 0.40 and 0.25 costs
 * nothing in separation (the score ladder is still 29.5 / 57.8 / 83.0 of a possible 147) and
 * buys a `normal` player a real 5% against `hard`. The measured ladder is in SPEC.md, and all
 * three knobs were swept alone across their whole range and are monotone.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.4, fumble: 0.1, stray: 0.14 },
  normal: { timing: 0.31, fumble: 0.05, stray: 0.07 },
  hard: { timing: 0.25, fumble: 0.02, stray: 0.02 },
});

/** How much larger a fumbled note's error is than the tier's ordinary one. */
export const FUMBLE_SCALE = 2;

/**
 * How long after its real press a stray double-tap lands, in seconds.
 *
 * Larger than {@link GOOD_SECONDS}, so a double-tap can never rescue the note it follows, and
 * not a whole number of slots, so it does not systematically land on the next beat either.
 */
export const STRAY_GAP_SECONDS = 0.34;

/** Values a tier draws per note. Always exactly this many, drawn before anything branches. */
export const BOT_DRAWS_PER_NOTE = 4;

export interface BotState {
  /** The next note this tier has not yet committed to. Only ever increases. */
  next: number;
  /** Seconds until the press it has committed to, or -1 when nothing is committed. */
  timer: number;
  /** Whether the note it is counting down to will be double-tapped. */
  stray: boolean;
  /** Seconds until that double-tap, counted from the press it follows. -1 when there is none. */
  strayTimer: number;
}

export function createBotState(): BotState {
  return { next: 0, timer: -1, stray: false, strayTimer: -1 };
}

export function resetBotState(state: BotState): void {
  state.next = 0;
  state.timer = -1;
  state.stray = false;
  state.strayTimer = -1;
}

/**
 * One generator per seat, drawn from the match's own before anything else touches it.
 *
 * Unlike a turn game, both seats here draw on **every** note and draw the same number of
 * values, so a single shared stream would interleave them perfectly and would not couple them
 * either. It is still two streams, for the reason Snowball Throw gives: the moment anything
 * makes one seat's draw count depend on what it or its opponent did, a shared stream turns
 * seat two's play into a function of the tier sitting opposite it. Two streams cost one line
 * and remove the question.
 */
export function createBotRngs(source: Rng): { p1: Rng; p2: Rng } {
  return { p1: new Rng(source.next() | 0), p2: new Rng(source.next() | 0) };
}

/**
 * Commit to a moment for the next note, the instant that note comes into sight.
 *
 * **It counts down to a moment; it does not watch for a position.** Cup Pong's bot deadlocked
 * on the second seed the first harness ever ran because it waited for a needle to reach a
 * value it had put out of reach. A countdown cannot fail to expire. It is also the more
 * honest model of a person: you commit to a beat, and being late enough that the note has
 * gone is a real way to miss.
 *
 * Exactly {@link BOT_DRAWS_PER_NOTE} values, drawn unconditionally before anything branches,
 * so a fumbled note and a clean one cost the same randomness and neither seat's stream can be
 * pulled out of step by what happened on the board.
 */
export function planNote(
  state: Readonly<State>,
  difficulty: BotDifficulty,
  bot: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const rollA = rng.float();
  const rollB = rng.float();
  const fumbleRoll = rng.float();
  const strayRoll = rng.float();

  // Two draws summed: the error is triangular rather than flat, so most presses land near the
  // beat and a bad one is rare. Flat, a tier either fits inside the window or it does not,
  // with nothing in between, and three tiers have almost nowhere to stand between them.
  let offset = (rollA + rollB - 1) * profile.timing;
  if (fumbleRoll < profile.fumble) offset *= FUMBLE_SCALE;

  // Floored at zero rather than left negative. A tier held up by its own last press can be
  // asked for a moment that has already gone; pressing on the next step is a person
  // scrambling to catch up, and it is bounded — one note a step until it is level again.
  // Leaving the countdown negative would instead skip the note silently, which is a second
  // behaviour nothing in the tiers asked for.
  const wanted = (state.arrivals[bot.next] as number) - state.clock + offset;
  bot.timer = wanted > 0 ? wanted : 0;
  bot.stray = strayRoll < profile.stray;
  bot.next += 1;
}

/**
 * Run a tier for one step, and return whether it pressed.
 *
 * One entry point rather than a plan call and a press call, because the two have to agree
 * about what has been committed to and a caller that got the order wrong would look like a
 * tuning problem rather than a bug.
 *
 * A tier holds **one committed press at a time**. If it is still counting down to a note when
 * the next one appears, it plans that one only after pressing — which is what a person late on
 * a beat does, and it is why a fumble costs more than the note it landed on. It cannot run
 * away: `next` only increases and both timers only decrease.
 */
export function driveBot(
  state: Readonly<State>,
  difficulty: BotDifficulty,
  bot: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (
    bot.timer < 0 &&
    bot.strayTimer < 0 &&
    bot.next < NOTE_COUNT &&
    approachOf(state, bot.next) <= 1
  ) {
    planNote(state, difficulty, bot, rng);
  }

  if (bot.timer >= 0) {
    if (bot.timer > fixedDeltaSeconds / 2) {
      // Floored at zero rather than left to run negative, and this is not tidiness.
      // `-1` is this field's *idle* sentinel, so a countdown that overshot into
      // (-delta/2, 0) read as idle on the very next step: the committed press vanished
      // and the tier planned the following note instead. It cost about half of every
      // tier's presses — `hard` was letting 25.8 of 49 notes go while making only 1.7
      // wild presses, which is the signature of a bot that is not pressing rather than
      // one that is pressing badly. The clamp cannot move which frame a press lands on:
      // it only ever applies on the step whose remainder is already inside half a delta,
      // and that step is the one the fire branch below takes.
      const left = bot.timer - fixedDeltaSeconds;
      bot.timer = left > 0 ? left : 0;
      return false;
    }
    bot.timer = -1;
    // The double-tap is timed from the press it follows rather than from the beat, so a
    // tier that was late is late twice over — which is what a nervous second tap looks like.
    bot.strayTimer = bot.stray ? STRAY_GAP_SECONDS : -1;
    bot.stray = false;
    return true;
  }

  if (bot.strayTimer >= 0) {
    if (bot.strayTimer > fixedDeltaSeconds / 2) {
      // The same floor, for the same reason. Both countdowns share one sentinel.
      const left = bot.strayTimer - fixedDeltaSeconds;
      bot.strayTimer = left > 0 ? left : 0;
      return false;
    }
    bot.strayTimer = -1;
    return true;
  }

  return false;
}
