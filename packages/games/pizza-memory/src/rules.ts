import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Pizza Memory as pure rules: two counters, one ticket book, and a bell on each counter.
 *
 * A ticket is a short sequence of toppings. It is dealt onto the pizza one topping at a
 * time, held for a moment, and then taken away; the player rebuilds it from the ingredient
 * rail in front of them and rings the bell to send it out. Ring it right and the order is
 * served. Ring it with the wrong pizza — or with an unfinished one — and it is spoiled.
 *
 * No rendering, no wall clock, no DOM. The game, both bots and the balance harness drive
 * this one file, so there is exactly one definition of what "the same pizza" means.
 *
 * Four structural choices carry most of the design, and each is argued in SPEC.md:
 *
 * 1. **The two counters never touch.** There is no shared object in this file at all — no
 *    contested ball, no shared board, no tie-break that has to settle a mirror position.
 *    Everything a seat owns lives in its own {@link Counter}, so swapping the seats swaps
 *    the match exactly, and seat one's share at equal skill is 50.0% by construction rather
 *    than by sampling. `rules.test.ts` asserts that board by board.
 * 2. **The ticket book is addressed, not consumed.** {@link ticketTopping} is a *stateless*
 *    seeded draw of (book, ticket, slot), so both seats read the identical ticket `k`
 *    without sharing a generator position. A shared `Rng` would have coupled them: whoever
 *    finished a ticket first would take the next values, and the two seats' orders would
 *    then depend on how fast the *other* one was working.
 * 3. **The hand is rate-limited, and the rail is measured in stations rather than in board
 *    units.** A thumb that lands on the far end of the rail and a held key move the hand at
 *    the identical speed, so neither instrument can reach an ingredient faster (rule 10);
 *    and because the rail coordinate is seat-local, both seats run the identical arithmetic
 *    instead of mirror-image arithmetic, which is the failure family lesson 8 names.
 * 4. **The bot remembers a ticket; it does not look one up.** {@link BotState.recall} is the
 *    bot's whole view of an order once the reveal is over, written during the reveal and
 *    never afterwards. Difficulty is how much of the order it fixes and how faithfully —
 *    see {@link BOT_PROFILES}, and the scramble test in `rules.test.ts` that proves it.
 */

/* ------------------------------------------------------------------ the counter */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** How many kinds of topping the rail carries. Everything below is in logical units. */
export const KIND_COUNT = 5;

/** The bell is the last station on the rail, so one axis and one button drive the whole game. */
export const BELL_STATION = KIND_COUNT;

/** Five ingredients and a bell. */
export const STATION_COUNT = KIND_COUNT + 1;

/** The most slots a pizza ever has, and therefore the size of every per-slot buffer. */
export const SLOT_MAX = 6;
/** The shortest ticket, and the one every match opens with. */
export const SLOT_MIN = 3;
/**
 * Tickets a seat gets through before its pizza grows by one slot.
 *
 * The ramp is what stops the contest saturating. A three-topping order is a ticket a good
 * memory gets right nine times in ten, so a match made only of those is decided by tempo and
 * luck; by the sixth ticket the order is six long and even `hard` is losing one in five. Each
 * counter ramps on **its own** ticket count, so the cook who is ahead is the one being asked
 * the harder questions — the race tightens by itself rather than running away.
 */
export const TICKETS_PER_SLOT = 2;

/**
 * Where the rail sits, in board units, for seat one. Seat two's rail is the half-turn image.
 *
 * Six stations 96 apart from x = 60 to x = 540. Both numbers are exact in binary and the
 * engine quantises every pointer onto a 3-unit lattice, so {@link stationFromBoardX} gives
 * the two seats bit-identical answers for mirrored touches rather than nearly-identical ones.
 */
export const RAIL_MARGIN = 60;
export const RAIL_PITCH = 96;

/** How fast the hand slides along the rail, in stations a second. */
export const HAND_SPEED = 5;

/** Seconds between one topping of the order appearing and the next. */
export const REVEAL_PER_ITEM_SECONDS = 0.42;
/** Seconds the complete order stays on the pizza before it is taken away. */
export const REVEAL_HOLD_SECONDS = 0.55;
/** Seconds the verdict sits on the counter before the next ticket is dealt. */
export const SERVE_SECONDS = 0.7;

/**
 * The match clock, **ours**, and one of the two things that guarantee this game can end.
 *
 * `manifest.roundSeconds` ends nothing anywhere in this repository — it is the text on a
 * catalogue card. The other guarantee is structural: a ticket can only be closed by the
 * bell, and every bot rings it, so no seat can sit on a ticket for ever. Between them a
 * match is over in at most {@link MATCH_SECONDS} of simulated play whatever either seat does.
 */
export const MATCH_SECONDS = 75;

/** Orders served that ends the match on the spot. Measured, not guessed — see SPEC.md. */
export const TARGET_SERVED = 8;

export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: TARGET_SERVED };

/**
 * Scratch for {@link resolve}'s options.
 *
 * Hoisted because the match is judged on every step, and an object literal there would be a
 * fresh allocation sixty times a second — which is what rule 5 forbids.
 */
const resolveOptions = { timeExpired: false };

export const PHASE_WATCH = 0;
export const PHASE_BUILD = 1;
export const PHASE_SERVE = 2;

/** Nothing placed here yet. */
export const EMPTY_SLOT = -1;

/* ------------------------------------------------------------------ the ticket book */

/** How many slots the seat's `ticket`-th pizza has. Grows, so nothing saturates. */
export function ticketLength(ticket: number): number {
  const grown = SLOT_MIN + Math.floor(ticket / TICKETS_PER_SLOT);
  return grown > SLOT_MAX ? SLOT_MAX : grown;
}

/**
 * Which topping the book puts in slot `slot` of ticket `ticket`.
 *
 * **Addressed rather than sequential, and that is the point.** Both seats must be handed the
 * identical ticket `k` — the seat band catches a game where they are not — but they reach
 * ticket `k` at different moments, so a shared generator would deal each seat whatever was
 * next when it happened to ask. Coupling the two seats' orders to each other's pace is the
 * one thing that could make this game unfair, so the draw is a pure function of where in the
 * book you are looking instead of a position in a stream.
 *
 * The mixing is splitmix32's finaliser, the same avalanche `Rng` uses to seed itself, so
 * neighbouring tickets and neighbouring slots are unrelated. `rules.test.ts` measures the
 * distribution over the kinds and the correlation between adjacent slots.
 */
export function ticketTopping(book: number, ticket: number, slot: number): number {
  let z = (book ^ Math.imul(ticket + 1, 0x9e3779b9) ^ Math.imul(slot + 1, 0x85ebca6b)) | 0;
  z = (z ^ (z >>> 16)) | 0;
  z = Math.imul(z, 0x21f0aaad);
  z = (z ^ (z >>> 15)) | 0;
  z = Math.imul(z, 0x735a2d97);
  z = (z ^ (z >>> 15)) | 0;
  return (z >>> 0) % KIND_COUNT;
}

/* ------------------------------------------------------------------ the geometry */

/** Where station `station` sits along a seat's rail, in board units. */
export function railX(seat: SeatId, station: number): number {
  const local = RAIL_MARGIN + RAIL_PITCH * station;
  return seat === 'p1' ? local : BOARD_WIDTH - local;
}

/**
 * The rail coordinate a touch at board `x` names, for that seat.
 *
 * Seat two's counter is the half-turn image of seat one's, so a mirrored touch produces the
 * identical station: `BOARD_WIDTH - x` and then `BOARD_WIDTH - RAIL_MARGIN - …` cancel
 * exactly on the pointer lattice. Not clamped — {@link steerHand} does that, once.
 */
export function stationFromBoardX(seat: SeatId, x: number): number {
  const local = seat === 'p1' ? x : BOARD_WIDTH - x;
  return (local - RAIL_MARGIN) / RAIL_PITCH;
}

/* ------------------------------------------------------------------ the state */

export interface Counter {
  /** Which ticket of the book this counter is on. Advances whether or not it was served. */
  ticket: number;
  /** {@link PHASE_WATCH}, {@link PHASE_BUILD} or {@link PHASE_SERVE}. */
  phase: number;
  /** Seconds since this phase began. */
  phaseSeconds: number;
  /** The order, as the book wrote it. Only read while it is on screen, and by the judge. */
  readonly order: Int8Array;
  /** How many slots this ticket has. */
  length: number;
  /** What the player has put on the pizza so far; {@link EMPTY_SLOT} past `placedCount`. */
  readonly placed: Int8Array;
  placedCount: number;
  /** Where the hand stands on the rail, in stations. Never snaps: see {@link HAND_SPEED}. */
  hand: number;
  /** Where the hand is being steered. */
  handTarget: number;
  /** Orders served. This is the score. */
  served: number;
  /** Orders sent out wrong. The tie-break when the clock runs out level. */
  spoiled: number;
  /** 1 after a served ticket, -1 after a spoiled one, 0 before the first. Feedback only. */
  lastVerdict: number;
}

export interface State {
  readonly p1Counter: Counter;
  readonly p2Counter: Counter;
  /** Scores, named so the state is a `Tally` the SDK can judge directly. */
  p1: number;
  p2: number;
  /** Seconds of play. The only clock in the game. */
  clock: number;
  winner: Outcome;
  /** Which ticket book this match is playing out of. Both seats read the same one. */
  book: number;
}

function createCounter(): Counter {
  return {
    ticket: 0,
    phase: PHASE_WATCH,
    phaseSeconds: 0,
    order: new Int8Array(SLOT_MAX).fill(EMPTY_SLOT),
    length: SLOT_MIN,
    placed: new Int8Array(SLOT_MAX).fill(EMPTY_SLOT),
    placedCount: 0,
    hand: 0,
    handTarget: 0,
    served: 0,
    spoiled: 0,
    lastVerdict: 0,
  };
}

/** A fresh state. Allocates, so call it from init() and never from a step. */
export function createState(): State {
  return {
    p1Counter: createCounter(),
    p2Counter: createCounter(),
    p1: 0,
    p2: 0,
    clock: 0,
    winner: null,
    book: 0,
  };
}

export function counterOf(state: Readonly<State>, seat: SeatId): Counter {
  return seat === 'p1' ? state.p1Counter : state.p2Counter;
}

/** Deal the counter's current ticket and start its reveal. Allocation-free. */
export function dealTicket(counter: Counter, book: number): void {
  counter.length = ticketLength(counter.ticket);
  for (let slot = 0; slot < SLOT_MAX; slot += 1) {
    counter.order[slot] =
      slot < counter.length ? ticketTopping(book, counter.ticket, slot) : EMPTY_SLOT;
    counter.placed[slot] = EMPTY_SLOT;
  }
  counter.placedCount = 0;
  counter.phase = PHASE_WATCH;
  counter.phaseSeconds = 0;
}

function resetCounter(counter: Counter, book: number): void {
  counter.ticket = 0;
  counter.served = 0;
  counter.spoiled = 0;
  counter.lastVerdict = 0;
  counter.hand = 0;
  counter.handTarget = 0;
  dealTicket(counter, book);
}

/**
 * Lay both counters out for a fresh match.
 *
 * Exactly one value is drawn from `rng`, and it is the ticket book — so the same seed deals
 * the same orders however the seats are filled, and neither seat's play can change what the
 * other is asked for.
 */
export function resetState(state: State, rng: Rng): void {
  state.book = rng.next() | 0;
  state.p1 = 0;
  state.p2 = 0;
  state.clock = 0;
  state.winner = null;
  resetCounter(state.p1Counter, state.book);
  resetCounter(state.p2Counter, state.book);
}

/* ------------------------------------------------------------------ the reveal */

/** How long this ticket's reveal lasts, start to finish. */
export function watchSeconds(length: number): number {
  return length * REVEAL_PER_ITEM_SECONDS + REVEAL_HOLD_SECONDS;
}

/**
 * How many toppings of the order are on the pizza right now.
 *
 * They arrive one at a time and stay, so the last one is on screen for
 * {@link REVEAL_HOLD_SECONDS} and the first one for the whole reveal — which is what makes
 * the *end* of an order harder to hold than the beginning, for a person and for a bot alike.
 */
export function revealedCount(counter: Readonly<Counter>): number {
  if (counter.phase !== PHASE_WATCH) return 0;
  const shown = Math.floor(counter.phaseSeconds / REVEAL_PER_ITEM_SECONDS);
  if (shown < 0) return 0;
  return shown > counter.length ? counter.length : shown;
}

/* ------------------------------------------------------------------ the hand */

/**
 * Steer the hand toward a rail coordinate. A rate, never a set.
 *
 * A thumb that lands on the bell and a key held toward it move the hand at the identical
 * speed, so the pointer cannot reach an ingredient the keyboard cannot (rule 10). The
 * movement itself happens in {@link stepCounter}, so the order the two seats are steered in
 * cannot matter.
 */
export function steerHand(counter: Counter, target: number): void {
  let wanted = target;
  if (!(wanted >= 0)) wanted = 0;
  if (wanted > STATION_COUNT - 1) wanted = STATION_COUNT - 1;
  counter.handTarget = wanted;
}

/**
 * Which station the hand is on, for a commit.
 *
 * The nearest one. Both seats compute this from a *seat-local* rail coordinate produced by
 * the identical arithmetic, so the half-way point between two stations is not a knife edge
 * the two seats fall off in opposite directions — which is the defect family that cost
 * Snowball Throw and Frozen Beaks a seat bias each.
 */
export function stationOf(counter: Readonly<Counter>): number {
  const station = Math.round(counter.hand);
  if (station < 0) return 0;
  return station > STATION_COUNT - 1 ? STATION_COUNT - 1 : station;
}

/* ------------------------------------------------------------------ the ticket */

/** Is the pizza as the ticket asked for it? Length as well as contents. */
export function orderMatches(counter: Readonly<Counter>): boolean {
  if (counter.placedCount !== counter.length) return false;
  for (let slot = 0; slot < counter.length; slot += 1) {
    if (counter.placed[slot] !== counter.order[slot]) return false;
  }
  return true;
}

/** Send the pizza out. Right or wrong, the ticket is closed and the next one is coming. */
function ringBell(counter: Counter): void {
  if (orderMatches(counter)) {
    counter.served += 1;
    counter.lastVerdict = 1;
  } else {
    counter.spoiled += 1;
    counter.lastVerdict = -1;
  }
  counter.phase = PHASE_SERVE;
  counter.phaseSeconds = 0;
}

/**
 * Commit whatever the hand is on.
 *
 * Ignored outside {@link PHASE_BUILD}: the order is still on the pizza during the reveal, so
 * a player who could place while looking at it would not be playing a memory game at all.
 * The hand may still be *steered* then, and pre-positioning during the reveal is real skill
 * that costs a person nothing to learn.
 *
 * A pizza that is already full takes no more toppings. The only way to close a ticket is the
 * bell, which is what makes ringing it an act rather than a formality.
 */
export function commit(counter: Counter): boolean {
  if (counter.phase !== PHASE_BUILD) return false;
  const station = stationOf(counter);
  if (station === BELL_STATION) {
    ringBell(counter);
    return true;
  }
  if (counter.placedCount >= counter.length) return false;
  counter.placed[counter.placedCount] = station;
  counter.placedCount += 1;
  return true;
}

/* ------------------------------------------------------------------ the step */

/** Advance one counter by one fixed step: the hand, then the phase clock. */
export function stepCounter(counter: Counter, fixedDeltaSeconds: number, book: number): void {
  const gap = counter.handTarget - counter.hand;
  const reach = HAND_SPEED * fixedDeltaSeconds;
  if (gap > reach) counter.hand += reach;
  else if (gap < -reach) counter.hand -= reach;
  else counter.hand = counter.handTarget;

  counter.phaseSeconds += fixedDeltaSeconds;
  if (counter.phase === PHASE_WATCH) {
    if (counter.phaseSeconds >= watchSeconds(counter.length)) {
      counter.phase = PHASE_BUILD;
      counter.phaseSeconds = 0;
    }
    return;
  }
  if (counter.phase === PHASE_SERVE && counter.phaseSeconds >= SERVE_SECONDS) {
    counter.ticket += 1;
    dealTicket(counter, book);
  }
}

/** How far through the pizza in front of it a counter is. Zero unless it is building one. */
export function benchCount(counter: Readonly<Counter>): number {
  return counter.phase === PHASE_BUILD ? counter.placedCount : 0;
}

/**
 * Who has won, or null while the match is still running.
 *
 * `first-to` on orders served, with the clock as the backstop, and then two tie-breaks that
 * exist because the score's resolution is coarse: orders served is a number between nought
 * and eight, and two cooks of the same standard land on the same one of those often.
 *
 * | | level on served | after spoiled | after the bench |
 * |---|---|---|---|
 * | easy v easy | 19.5% | 14.0% | **7.5%** |
 * | normal v normal | 16.7% | 10.7% | **3.7%** |
 * | hard v hard | 9.7% | 8.2% | **3.3%** |
 *
 * 1500 seeds a tier. **Spoiled fewer** comes first: two cooks who got four orders out are not
 * equal if one of them burned eight pizzas doing it. **Further through the pizza on the
 * bench** comes second, and it is the reason it pays to keep working right up to the whistle
 * rather than standing still on a lead you might be sharing.
 *
 * Both keys are quantities a seat owns outright, so unlike a rule written in board
 * coordinates they still separate a mirrored position (lesson 11): the mirror image of "seat
 * one spoiled fewer" is "seat two spoiled fewer", which is an answer.
 */
export function judgeMatch(state: Readonly<State>, clock: number): Outcome {
  resolveOptions.timeExpired = clock >= MATCH_SECONDS;
  const outcome = resolve(WIN_CONDITION, state, resolveOptions);
  if (outcome !== 'draw') return outcome;
  const p1Spoiled = state.p1Counter.spoiled;
  const p2Spoiled = state.p2Counter.spoiled;
  if (p1Spoiled < p2Spoiled) return 'p1';
  if (p2Spoiled < p1Spoiled) return 'p2';
  const p1Bench = benchCount(state.p1Counter);
  const p2Bench = benchCount(state.p2Counter);
  if (p1Bench > p2Bench) return 'p1';
  if (p2Bench > p1Bench) return 'p2';
  return 'draw';
}

/** One fixed step of the whole kitchen. */
export function step(state: State, fixedDeltaSeconds: number): void {
  if (state.winner !== null) return;
  stepCounter(state.p1Counter, fixedDeltaSeconds, state.book);
  stepCounter(state.p2Counter, fixedDeltaSeconds, state.book);
  state.p1 = state.p1Counter.served;
  state.p2 = state.p2Counter.served;
  state.clock += fixedDeltaSeconds;
  state.winner = judgeMatch(state, state.clock);
}

export function winnerOf(state: Readonly<State>): Outcome {
  return state.winner;
}

/** Seconds of play left, for the bar down the side margins. Never negative. */
export function secondsLeft(state: Readonly<State>): number {
  const left = MATCH_SECONDS - state.clock;
  return left < 0 ? 0 : left;
}

/* ------------------------------------------------------------------ the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Chance of fixing a topping in mind at all, drawn afresh as each one appears.
   *
   * This is "how much it remembers". A topping it fails to fix is *gone* — the bot has no
   * record of it and has to guess when it gets there, at one in {@link KIND_COUNT}.
   */
  readonly graspChance: number;
  /**
   * Chance that a topping it did fix is fixed as the wrong one.
   *
   * This is "how accurately". Strictly worse for the bot than not remembering at all, which
   * is the point: a confident wrong answer never comes good, and a blank might.
   */
  readonly slipChance: number;
  /**
   * Chance that a topping is remembered in the wrong place — swapped with the one before it.
   *
   * The game asks for the order and not just the ingredients, so remembering *which* and
   * remembering *where* are two different skills and get two different knobs.
   */
  readonly swapChance: number;
  /**
   * Seconds it hesitates at a station before committing. Its tempo, and nothing else.
   *
   * The weakest of the four by a distance — 87.5% down to 60.4% over a fifty-fold range,
   * against 2.3% to 97.8% for {@link graspChance} — and kept because it is monotone over that
   * whole range and because a tier that remembered better *and* worked at the same speed
   * would not feel like a better cook. The sweep is in SPEC.md.
   */
  readonly reactSeconds: number;
}

/**
 * Three tiers. Every number was swept alone and is monotone across its whole range — the
 * sweeps, and the knob that was written and deleted, are in SPEC.md.
 *
 * No tier is given the ticket after the reveal has ended, the opponent's counter, or the
 * book (rule 6). Everything a bot uses was on its own pizza while a person could have been
 * looking at it.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { graspChance: 0.84, slipChance: 0.11, swapChance: 0.1, reactSeconds: 0.24 },
  normal: { graspChance: 0.9, slipChance: 0.07, swapChance: 0.06, reactSeconds: 0.17 },
  hard: { graspChance: 0.94, slipChance: 0.035, swapChance: 0.03, reactSeconds: 0.12 },
});

/** What the bot never encoded, and will have to guess. */
export const FORGOTTEN = -1;

export interface BotState {
  /**
   * What the bot believes this ticket said.
   *
   * **Its entire view of the order once the reveal is over.** Written only by
   * {@link botWatch}, which runs only during {@link PHASE_WATCH}; read only by
   * {@link botDecide}. {@link FORGOTTEN} means it never fixed that slot at all.
   */
  readonly recall: Int8Array;
  /** How many toppings of this reveal it has already seen appear. */
  seen: number;
  /** Which ticket `recall` belongs to, so a new one wipes it. */
  ticket: number;
  /** Counts down to the next commit. */
  waitSeconds: number;
}

export function createBotState(): BotState {
  return {
    recall: new Int8Array(SLOT_MAX).fill(FORGOTTEN),
    seen: 0,
    ticket: -1,
    waitSeconds: 0,
  };
}

export function resetBotState(bot: BotState): void {
  bot.recall.fill(FORGOTTEN);
  bot.seen = 0;
  bot.ticket = -1;
  bot.waitSeconds = 0;
}

/**
 * Watch the order go down, one topping at a time.
 *
 * **The only place a bot ever reads {@link Counter.order}, and it runs only while the order
 * is on the pizza where a person could be reading it too.** Each topping is encoded once, as
 * it appears, and then the bot is on its own memory for the rest of the ticket.
 *
 * Exactly four values are drawn per topping, unconditionally and before anything branches,
 * so a bot occupies a fixed window of its own stream per topping whatever it decides.
 */
export function botWatch(
  counter: Readonly<Counter>,
  bot: BotState,
  profile: BotProfile,
  rng: Rng,
): void {
  if (bot.ticket !== counter.ticket) {
    bot.recall.fill(FORGOTTEN);
    bot.seen = 0;
    bot.ticket = counter.ticket;
  }
  const shown = revealedCount(counter);
  while (bot.seen < shown) {
    const slot = bot.seen;
    const grasped = rng.bool(profile.graspChance);
    const slipped = rng.bool(profile.slipChance);
    const wrongBy = rng.int(1, KIND_COUNT);
    const swapped = rng.bool(profile.swapChance);
    const truth = counter.order[slot] ?? EMPTY_SLOT;
    if (!grasped || truth === EMPTY_SLOT) bot.recall[slot] = FORGOTTEN;
    else bot.recall[slot] = slipped ? (truth + wrongBy) % KIND_COUNT : truth;
    // Remembering the right toppings in the wrong order is its own kind of mistake, so it
    // is its own knob: the pair changes places in the bot's memory and nowhere else.
    if (swapped && slot > 0) {
      const held = bot.recall[slot - 1] ?? FORGOTTEN;
      bot.recall[slot - 1] = bot.recall[slot] ?? FORGOTTEN;
      bot.recall[slot] = held;
    }
    bot.seen += 1;
  }
}

/**
 * Which station the bot wants next, from memory alone.
 *
 * Reads {@link BotState.recall} and the count of what it has already placed — never
 * {@link Counter.order}. A slot it never fixed is guessed **once** and the guess written
 * back, so asking twice gives the same answer and a bot cannot re-roll its way to the truth.
 * `rules.test.ts` scrambles the hidden order between two calls and asserts the answer does
 * not move.
 */
export function botDecide(counter: Readonly<Counter>, bot: BotState, rng: Rng): number {
  if (counter.placedCount >= counter.length) return BELL_STATION;
  const slot = counter.placedCount;
  const remembered = bot.recall[slot] ?? FORGOTTEN;
  if (remembered !== FORGOTTEN) return remembered;
  const guess = rng.int(0, KIND_COUNT);
  bot.recall[slot] = guess;
  return guess;
}

/**
 * Drive one bot for one step, and report the station it commits, or -1 for nothing.
 *
 * It steers, it waits out its tier's hesitation, and it commits only once the hand has
 * genuinely arrived — `hand === want` exactly, because {@link stepCounter} lands the hand on
 * its target rather than approaching it, so there is no epsilon and no threshold to straddle.
 */
export function botStep(
  counter: Counter,
  bot: BotState,
  difficulty: BotDifficulty,
  rng: Rng,
  fixedDeltaSeconds: number,
): number {
  const profile = BOT_PROFILES[difficulty];

  if (counter.phase === PHASE_WATCH) {
    botWatch(counter, bot, profile, rng);
    // Pre-position on the first topping it has fixed, exactly as a person would. Never on a
    // slot it has not seen yet: that would force a guess before it had the chance to look.
    if (bot.seen > 0) {
      const first = bot.recall[0] ?? FORGOTTEN;
      if (first !== FORGOTTEN) steerHand(counter, first);
    }
    bot.waitSeconds = profile.reactSeconds;
    return -1;
  }

  if (counter.phase !== PHASE_BUILD) {
    bot.waitSeconds = profile.reactSeconds;
    return -1;
  }

  const want = botDecide(counter, bot, rng);
  steerHand(counter, want);
  if (counter.hand !== want) return -1;
  bot.waitSeconds -= fixedDeltaSeconds;
  if (bot.waitSeconds > 0) return -1;
  bot.waitSeconds = profile.reactSeconds;
  return want;
}
