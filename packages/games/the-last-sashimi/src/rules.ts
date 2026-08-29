import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';

/**
 * The Last Sashimi, as pure rules.
 *
 * A conveyor runs a closed loop past two counters. Plates ride it — a long slice of sashimi
 * worth one, a rice ball worth three — and each player sits at one end with a pair of
 * chopsticks. One press closes the chopsticks on whatever is passing. Catch a plate and it
 * comes off the belt; close on bare belt and it costs a point. Chewing takes a moment, and a
 * rice ball takes longer than a slice, so what a turn is really spending is time. First to
 * fifteen.
 *
 * ## Four decisions carry the whole game
 *
 * **A bite is one bare press, and a turn is as many of them as you dare.** Cup Pong aims with
 * two presses against two moving gauges; Target Practice with one distance and one moment. A
 * third game built from a gauge and a press would be the same game a third time. Here there is
 * no gauge at all: every press is a bare timestamped event, and what varies between turns is
 * *how many* of them a player spends. That is the most instrument-neutral thing this catalogue
 * has shipped — a phone, a trackpad and a keyboard cannot even express a difference — and it
 * is why the manifest can promise one build for every device without a caveat. **[ours]**
 *
 * **The belt is a clock, not a place.** Nothing in this file is measured in board units. A
 * plate's position is `wrapSlots(index - grabSlot + beltAt(clock))` in *slots*, and every
 * tolerance is stated in *seconds*, because what a player is judging is a moment. The ring, the
 * lanes and the plates are drawn by `game.ts` from those two numbers and exist nowhere else.
 * Two things fall out of it: the simulation cannot express a pixel even by accident (rule 8),
 * and the bot's closed-form arrival and the referee's reach test are the *same arithmetic*
 * rather than two roads to nearly the same answer — which is what five games in this repo were
 * wrong about (issue #2465, commit b4af006). Nothing is integrated anywhere: `beltAt` is a
 * function of the clock, evaluated fresh, so a plate asked about a moment answers the same
 * however much play happened in between. **[ours]**
 *
 * **The ready pause lives here, not in the shell.** The shell turns the board to face whoever
 * is eating and refuses a person's input for the 0.36 s that takes. A bot does not go through
 * the shell. This game is the worst case of the three: a plate passes the chopsticks every
 * {@link DISH_SECONDS} and the belt is inside somebody's reach 40% of the time, so 0.36 s of
 * unearned belt is 0.14 s of free grabbing — with an instantaneous bite, that is a free plate
 * in roughly two turns out of five, every turn, for ever. `READY_SECONDS` freezes the
 * chopsticks for longer than the flip, in the simulation, where a person and a bot are the same
 * thing. It cannot live in `game.ts`: `seatView` reports no rotation at all in single-seat play,
 * so a freeze keyed off the flip would step one match on a shared phone and a different one on
 * two phones playing remotely. **[ours]**
 *
 * **One belt, laid out symmetrically, shared by both.** The two counters sit exactly half a lap
 * apart and the menu is mirrored about that half lap, so at every instant the two seats face
 * the bit-identical belt — the game is one shape under the half-turn, and the arithmetic proves
 * it rather than approximating it (see `wrapSlots`). What is *not* symmetric is what has
 * already been eaten: a plate taken off the belt is missing when it comes round to the other
 * counter, and comes back {@link EMPTY_LAPS} of a lap later. That is the whole of "eat all
 * before your opponent" — the supply is one supply, and taking from it denies. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

/** The logical box. The only two numbers in this file that are lengths, and neither is used. */
export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;

/**
 * Plates on the belt, and the half lap between the two counters.
 *
 * Even, and mirrored about `HALF_SLOTS`: slot `i` and slot `i + HALF_SLOTS` always carry the
 * same kind of plate. That is what makes the two seats' problems identical rather than merely
 * similar, and it is asserted by a test over every slot at every clock.
 */
export const SLOT_COUNT = 14;
export const HALF_SLOTS = SLOT_COUNT / 2;

/** Seconds between one plate passing the chopsticks and the next. The belt's whole speed. */
export const DISH_SECONDS = 0.6;

/** One full circuit. A plate a seat lets go comes back to it this much later. */
export const LAP_SECONDS = SLOT_COUNT * DISH_SECONDS;

export type Dish = 'sashimi' | 'onigiri';

/** The observed rule: sashimi is worth one, onigiri three, and a mistake costs one. */
export const SASHIMI_POINTS = 1;
export const ONIGIRI_POINTS = 3;
export const MISTAKE_POINTS = 1;

/**
 * How far either side of dead centre the chopsticks still close on a plate, in seconds.
 *
 * A plate's own half-length plus the reach of the sticks. Stated in seconds because that is
 * what a player is actually spending: `game.ts` multiplies by the belt's speed to draw it, and
 * a test asserts the drawn plate is the plate the referee judges.
 *
 * These three numbers decide the whole difficulty ladder, and they were chosen from two
 * arithmetics rather than by eye.
 *
 * **The lattice.** A press only ever lands on a whole frame, so a bite's offset from dead
 * centre falls on a grid a sixtieth of a second apart. A sashimi window is 0.270 s — 16 frames
 * — and an onigiri window 0.164 s, just under 10. Cup Pong's first geometry ran a needle whose
 * grid was coarser than its cup, and two neighbouring mouth radii gave the identical hit rate
 * to three figures; a test here asserts both windows are at least eight frames across.
 *
 * **Mashing has to lose.** With the sticks closing on nothing costing a point, the expected
 * value of a *random* press is `P(sashimi) + 3 P(onigiri) - P(nothing)`, and the plate sizes
 * are what set it. At these three numbers the belt is inside somebody's reach 40% of the time
 * and a random press is worth **-0.045 points**, so a player who simply presses as fast as the
 * chewing allows loses ground. Widen the plates by a fifth and it turns positive, and the game
 * becomes a button-masher. A test drives a seat that presses on every frame and asserts it
 * finishes behind a seat that does not.
 */
export const CHOPSTICK_REACH = 0.033;
export const SASHIMI_HALF = 0.102;
export const ONIGIRI_HALF = 0.049;

/**
 * Dead centre: a plate taken cleanly rather than nicked off the edge.
 *
 * Not part of the score. It settles a match the score has left level, which happens because
 * points come in ones and threes and mistakes take them back one at a time, so two players of
 * the same standard land on the same total often enough to matter. See `finish` for the
 * measured difference it makes.
 */
export const CLEAN_SHARE = 0.55;

/**
 * How long the chopsticks are busy after a press, in seconds.
 *
 * **This is the game's own axis, and the reason it is not Target Practice with a belt.** There,
 * a high-scoring target costs precision at the moment you take it. Here a rice ball costs
 * precision *and* it costs the rest of your turn: 1.25 s of chewing out of a 2.2 s turn is
 * more than half of what you had, and while it lasts two plates go by. So the question a player
 * is
 * really answering is not "can I hit this?" but "is this worth the turn?", and the answer moves
 * with how much turn is left. The bot prices exactly that — see `chooseQuarry`, which ranks by
 * points per second of turn spent rather than by points.
 *
 * A missed grab chews too, and that is what bounds a masher: presses cannot come closer
 * together than {@link FUMBLE_CHEW}.
 */
export const SASHIMI_CHEW = 0.45;
export const ONIGIRI_CHEW = 1.25;
export const FUMBLE_CHEW = 0.8;

/**
 * How long the chopsticks are frozen at the start of a turn.
 *
 * **Longer than the shell's 0.36 s seat flip, deliberately.** See the note at the top of the
 * file: a bite is instantaneous and the belt is in reach 40% of the time, so a third of a
 * second of unearned belt is a free plate every second or third turn.
 */
export const READY_SECONDS = 0.5;

/**
 * How long a turn lasts once the chopsticks are live.
 *
 * Not decoration: nothing else forces a press, so without it a turn never ends. 2.2 s is three
 * and two thirds plates — enough that a turn is a run of two or three presses rather than one,
 * few enough that a rice ball's 1.25 s chew is more than half of it.
 *
 * **It is also the number the whole game's fairness turned out to hang on, for a reason nothing
 * about a turn suggests.** A turn takes `READY_SECONDS + TURN_SECONDS + SETTLE_SECONDS` and the
 * belt takes {@link LAP_SECONDS} to come round, so if the second divides the first the two seats
 * see the *same phases of the belt for ever* — a resonance, and a resonance on a shared belt is
 * a systematic advantage to whoever meets it first. Swept alone at `hard`, over 2000 matches
 * from each opening seat, with everything else as shipped:
 *
 * | turn | turn period | lap / period | opener's share of decided |
 * |---|---|---|---|
 * | 1.5 | 2.40 | 3.500 | 50.5% |
 * | 1.7 | 2.60 | 3.231 | 51.8% |
 * | 1.8 | 2.70 | 3.111 | 53.5% |
 * | **1.9** | **2.80** | **3.000** | **54.9%** |
 * | 2.0 | 2.90 | 2.897 | 53.4% |
 * | 2.1 | 3.00 | 2.800 | 51.8% |
 * | **2.2 (shipped)** | **3.10** | **2.710** | **50.8%** |
 * | 2.5 | 3.40 | 2.471 | 50.1% |
 *
 * A clean peak on the integer, five points high, falling away on both sides. Nothing else in
 * the file changes across those rows. A test asserts the ratio stays clear of every small
 * rational, because the obvious tidy-up — rounding the turn to a number a person would choose —
 * lands on 1.9 and puts it straight back.
 */
export const TURN_SECONDS = 2.2;

/** Seconds the last bite is held on the board before it turns. */
export const SETTLE_SECONDS = 0.4;

/** How long one seat holds the chopsticks for, end to end. */
export const TURN_PERIOD_SECONDS = READY_SECONDS + TURN_SECONDS + SETTLE_SECONDS;

/**
 * The ceiling on presses in one turn.
 *
 * Insurance rather than a rule anybody meets: the chews already cap a turn at six presses
 * (2.6 s over a 0.45 s minimum), so this can only ever fire at the same place they do. It is
 * here because the bot's per-turn randomness is drawn up front and has to be a fixed size, and
 * because a per-turn bound is one of the three things that make this match's length structural.
 */
export const MAX_BITES_PER_TURN = 6;

/** The observed rule: first to fifteen. */
export const TARGET_POINTS = 15;

/**
 * Rounds in a course, and the reason a course exists at all.
 *
 * The lead alternates, so over an *even* number of rounds each seat has led exactly as often as
 * the other and over an odd number the opener has led once more. On a belt nobody shares that
 * is worth nothing — Cup Pong measured its two lead orders as bit-identical. Here leading means
 * picking from a belt the other seat has not thinned since it last came round, so the extra lead
 * is worth real points, and a match that can stop after an odd round hands it out at random.
 *
 * So the match is judged only at the end of a **course of two rounds**. It costs one line and up
 * to one extra round, and it is worth 4.6 points of the opener's win rate at `hard` with a 2.6 s
 * turn (56.4% down to 51.8%, 1500 matches each) — measured, not assumed. At the shipped 2.2 s
 * turn most of that bias has already gone to the resonance note above, and the course rule takes
 * the remainder: 52.1% to 50.4%.
 */
export const ROUNDS_PER_COURSE = 2;

/**
 * The ceiling on rounds, and the termination guarantee.
 *
 * `first-to-N` on its own does not terminate, and here it is worse than usual: **a mistake
 * takes a point back**, so two players sitting on fourteen who both keep closing on bare belt
 * play for ever, and no amount of skill makes that impossible. `roundSeconds` ends nothing — it
 * is text on a catalogue card. This is the structural end: at most this many rounds of one turn
 * each, fed to the SDK's win-condition helper as `timeExpired`, so the higher score takes it.
 *
 * Thirty-four rather than eighteen because a cap has to clear the longest matches the *weakest*
 * pairing produces rather than the average one. Two `easy` bots take 10.3 rounds on average, and
 * over 6000 matches with no cap at all the longest ran to 32; 2.4% went past eighteen. At
 * thirty-four it fires about once in six thousand `easy` matches and never at the other tiers,
 * so it is insurance, and the tests exercise it directly rather than waiting for it.
 *
 * A multiple of {@link ROUNDS_PER_COURSE}, necessarily: a cap that fell on an odd round would be
 * a round the course rule refuses to judge. A test asserts it.
 *
 * Both seats always take the same number of turns, so no ceiling can favour either of them, and
 * a turn cannot last longer than {@link TURN_PERIOD_SECONDS}, so the whole match is bounded
 * above by `MAX_ROUNDS * 2 * TURN_PERIOD_SECONDS` — 211 seconds — whatever anybody does.
 */
export const MAX_ROUNDS = 34;

/**
 * How much of a lap a plate is missing for once it has been eaten.
 *
 * Three quarters, and the two boundaries are what pick it. The counters are half a lap apart,
 * so anything over a half means the plate you took is **missing when it reaches your
 * opponent** — that is the denial the catalogue row is describing. Anything under a whole lap
 * means it is back by the time it returns to you, so the belt cannot thin out over a match and
 * the endgame cannot decay into two people grabbing at bare belt. Three quarters is the middle
 * of that window rather than either edge of it, so no float comparison sits on a boundary.
 *
 * It is symmetric between the seats by construction: the rule is stated in laps travelled, and
 * a lap is a lap from either counter.
 */
export const EMPTY_LAPS = 0.75;
export const EMPTY_SECONDS = EMPTY_LAPS * LAP_SECONDS;

/** Rice balls in each mirrored half of the belt. Four on the belt, against ten slices. */
export const ONIGIRI_PER_HALF = 2;

export type Phase = 'ready' | 'live' | 'settling' | 'over';

/** What the last press did. `none` means no press has happened this turn yet. */
export type Outcome = 'clean' | 'edge' | 'fumble' | 'none';

export interface Slot {
  /** Position on the belt, in plates. Fixed for the life of the match. */
  readonly index: number;
  /** What is on the plate. Mirrored: slot `i` and slot `i + HALF_SLOTS` always agree. */
  kind: Dish;
  /** Clock before which this slot is bare, because somebody ate it. */
  emptyUntil: number;
}

export interface Game {
  /** One belt, read from two counters half a lap apart. */
  readonly slots: readonly Slot[];
  /**
   * Where the belt started, in plates. One draw at the start of a match, so two matches on the
   * same seed open on the same belt and two on different seeds do not.
   */
  beltPhase: number;
  /** Seconds of match played. Every plate's position is a function of this and nothing else. */
  clock: number;
  phase: Phase;
  active: SeatId;
  /** Which seat led round one. Comes from the shell, and is not always `p1`. */
  opener: SeatId;
  /** Seconds left in the ready freeze or the settle, whichever phase is running. */
  hold: number;
  /** Seconds left of the turn. */
  turnLeft: number;
  /** Seconds until the chopsticks are free again. */
  chew: number;
  /** Presses made this turn, hit or miss. */
  bites: number;
  lastOutcome: Outcome;
  lastPoints: number;
  /** Which slot the last press closed on, or -1. Presentation reads it; rules do not. */
  lastSlot: number;
  /** How far the last press was from dead centre, in seconds. Presentation only. */
  lastOffset: number;
  round: number;
  /** Turns taken in the current round, so a match can only end on a completed one. */
  turnsThisRound: number;
  p1Turns: number;
  p2Turns: number;
  p1Points: number;
  p2Points: number;
  /** Plates taken, and how many of those came off clean. The tiebreak. */
  p1Taken: number;
  p2Taken: number;
  p1Clean: number;
  p2Clean: number;
  p1Fumbles: number;
  p2Fumbles: number;
  winner: SeatId | 'draw' | null;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * Which slot of the belt each seat's chopsticks sit over. Exactly half the belt apart.
 */
export function grabSlotOf(seat: SeatId): number {
  return seat === 'p1' ? 0 : HALF_SLOTS;
}

/**
 * How many whole plates ahead of a seat's chopsticks a slot started, in `[0, SLOT_COUNT)`.
 *
 * **Reduced to a whole number before anything else touches it, and that is the single line
 * that makes the mirror symmetry exact rather than accurate to a few bits.** Seat two asking
 * about slot `j` and seat one asking about its mirror partner `(j + HALF_SLOTS) % SLOT_COUNT`
 * must reach the identical float, and the obvious spelling does not: `(j - 7) + belt` and
 * `(j + 7) + belt` differ by fourteen in exact arithmetic but round differently, so the two
 * seats' answers can straddle a comparison in their last bits. Reducing here, in integers,
 * means both seats hand `wrapSlots` the *same* summand and the two are bit-identical.
 *
 * Snowball Throw measured seat one at 64.3% and bisecting found two defects of exactly this
 * family — a tie-break written in board coordinates and a threshold on a knife edge — neither
 * of which any ordinary unit test or win-rate ladder could see. Both are ruled out here by the
 * shape of the arithmetic, and a test drives every slot from both seats and requires `toBe`
 * rather than `toBeCloseTo`.
 */
export function slotLeadOf(index: number, seat: SeatId): number {
  return (index - grabSlotOf(seat) + SLOT_COUNT) % SLOT_COUNT;
}

/** How much of the belt has gone past, in plates. Pure: nothing here accumulates. */
export function beltAt(game: Readonly<Game>): number {
  return game.beltPhase + game.clock / DISH_SECONDS;
}

/** The same, for a moment that is not now — which is what lets the bot solve for one. */
export function beltAtClock(game: Readonly<Game>, clock: number): number {
  return game.beltPhase + clock / DISH_SECONDS;
}

/** Wrap a signed distance in plates into the half lap either side of a counter. */
function wrapSlots(value: number): number {
  const raw = value - Math.floor(value / SLOT_COUNT) * SLOT_COUNT;
  return raw >= HALF_SLOTS ? raw - SLOT_COUNT : raw;
}

/**
 * Where a slot is relative to a seat's chopsticks, in seconds.
 *
 * Negative means it has not arrived yet; positive means it has gone past. This one expression
 * is the whole of the game's geometry, and both the referee and the bot call it.
 */
export function offsetSecondsAt(
  game: Readonly<Game>,
  index: number,
  seat: SeatId,
  clock: number,
): number {
  return wrapSlots(slotLeadOf(index, seat) + beltAtClock(game, clock)) * DISH_SECONDS;
}

export function offsetSeconds(game: Readonly<Game>, index: number, seat: SeatId): number {
  return offsetSecondsAt(game, index, seat, game.clock);
}

/**
 * The next moment at or after `after` when a slot is dead centre over a seat's chopsticks.
 *
 * The exact inverse of `offsetSecondsAt`, in closed form: solve
 * `index - grabSlot + beltPhase + clock / DISH_SECONDS = k * SLOT_COUNT` for the smallest whole
 * `k` that puts the answer late enough. The bot commits to *this number*, and the referee
 * judges the press against `offsetSecondsAt` at the frame the press lands on — so the only
 * thing between them is the frame lattice a person is on too. A test fires at exactly this
 * clock and asserts the offset is zero to within 1e-9.
 *
 * The float guard at the end is the same one Target Practice needs: noise at the boundary can
 * land a whole period early, and one step forward fixes it and cannot loop.
 */
export function nextArrival(
  game: Readonly<Game>,
  index: number,
  seat: SeatId,
  after: number,
): number {
  const lead = slotLeadOf(index, seat) + game.beltPhase;
  const k = Math.ceil((after / DISH_SECONDS + lead) / SLOT_COUNT);
  let clock = (k * SLOT_COUNT - lead) * DISH_SECONDS;
  if (clock < after) clock += LAP_SECONDS;
  return clock;
}

export function pointsOf(kind: Dish): number {
  return kind === 'onigiri' ? ONIGIRI_POINTS : SASHIMI_POINTS;
}

/** A plate's own half-length, in seconds of belt. What `game.ts` draws. */
export function halfOf(kind: Dish): number {
  return kind === 'onigiri' ? ONIGIRI_HALF : SASHIMI_HALF;
}

/** Half the window a press has to land in: the plate, plus the reach of the sticks. */
export function reachOf(kind: Dish): number {
  return halfOf(kind) + CHOPSTICK_REACH;
}

export function chewOf(kind: Dish): number {
  return kind === 'onigiri' ? ONIGIRI_CHEW : SASHIMI_CHEW;
}

/** True when a slot has a plate on it at a given moment. */
export function isPresentAt(slot: Readonly<Slot>, clock: number): boolean {
  return clock >= slot.emptyUntil;
}

export function pointsBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Points : game.p2Points;
}

export function cleanBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Clean : game.p2Clean;
}

export function takenBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Taken : game.p2Taken;
}

export function fumblesBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Fumbles : game.p2Fumbles;
}

function buildSlots(): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) slots.push({ index: i, kind: 'sashimi', emptyUntil: 0 });
  return slots;
}

export function createGame(): Game {
  return {
    slots: buildSlots(),
    beltPhase: 0,
    clock: 0,
    phase: 'ready',
    active: 'p1',
    opener: 'p1',
    hold: READY_SECONDS,
    turnLeft: TURN_SECONDS,
    chew: 0,
    bites: 0,
    lastOutcome: 'none',
    lastPoints: 0,
    lastSlot: -1,
    lastOffset: 0,
    round: 1,
    turnsThisRound: 0,
    p1Turns: 0,
    p2Turns: 0,
    p1Points: 0,
    p2Points: 0,
    p1Taken: 0,
    p2Taken: 0,
    p1Clean: 0,
    p2Clean: 0,
    p1Fumbles: 0,
    p2Fumbles: 0,
    winner: null,
  };
}

/**
 * Who opens a round.
 *
 * Alternates from whoever the shell gave the match to. It matters more here than in a game
 * whose two halves never touch: the belt is shared, so leading a round means picking from a
 * belt nobody has taken from since it last came round. The shell alternates `openingSeat`
 * across the rounds of a best-of for the same reason (issue #2466), and a game that assumed
 * `p1` would quietly undo that.
 */
export function leadOf(opener: SeatId, round: number): SeatId {
  return round % 2 === 1 ? opener : otherOf(opener);
}

/** Scratch for the menu shuffle. Module level, so a reset allocates nothing. */
const menuScratch: Dish[] = new Array<Dish>(HALF_SLOTS).fill('sashimi');

/**
 * Start a fresh match: lay the belt, and hand it to whoever the shell says opens.
 *
 * The menu is dealt into **half** the belt and then mirrored, so slot `i` and slot
 * `i + HALF_SLOTS` always carry the same kind. That is the property the whole fairness argument
 * rests on: the two counters are half a lap apart, so a mirrored menu means the two seats see
 * the identical belt at every instant, and the only thing that can ever differ between them is
 * what has already been eaten. A test asserts it over every slot at a hundred clocks.
 *
 * The shuffle and the belt phase come from the match's own generator, before the bots' streams
 * are touched, so two matches on one seed are one match.
 */
export function resetGame(game: Game, opener: SeatId, rng: Rng): void {
  for (let i = 0; i < HALF_SLOTS; i += 1) {
    menuScratch[i] = i < ONIGIRI_PER_HALF ? 'onigiri' : 'sashimi';
  }
  rng.shuffle(menuScratch);
  for (let i = 0; i < HALF_SLOTS; i += 1) {
    const kind = menuScratch[i] as Dish;
    (game.slots[i] as Slot).kind = kind;
    (game.slots[i + HALF_SLOTS] as Slot).kind = kind;
  }
  for (const slot of game.slots) slot.emptyUntil = 0;
  game.beltPhase = rng.float() * SLOT_COUNT;
  game.clock = 0;
  game.round = 1;
  game.turnsThisRound = 0;
  game.p1Turns = 0;
  game.p2Turns = 0;
  game.p1Points = 0;
  game.p2Points = 0;
  game.p1Taken = 0;
  game.p2Taken = 0;
  game.p1Clean = 0;
  game.p2Clean = 0;
  game.p1Fumbles = 0;
  game.p2Fumbles = 0;
  game.winner = null;
  game.opener = opener;
  game.active = leadOf(opener, 1);
  beginTurn(game);
}

function beginTurn(game: Game): void {
  game.phase = 'ready';
  game.hold = READY_SECONDS;
  game.turnLeft = TURN_SECONDS;
  game.chew = 0;
  game.bites = 0;
  game.lastOutcome = 'none';
  game.lastPoints = 0;
  game.lastSlot = -1;
  game.lastOffset = 0;
}

/**
 * The slot a press would close on, or -1 for bare belt.
 *
 * The nearest plate inside its own window. Windows never overlap — the plates are
 * {@link DISH_SECONDS} apart and the widest is 0.270 s across — so at most one can qualify and
 * no ambiguity is possible; the nearest is taken anyway, so that stays true if the belt is ever
 * loaded differently.
 */
export function slotUnderChopsticks(game: Readonly<Game>, seat: SeatId): number {
  let best = -1;
  let bestOffset = Infinity;
  for (let i = 0; i < game.slots.length; i += 1) {
    const slot = game.slots[i] as Slot;
    if (!isPresentAt(slot, game.clock)) continue;
    const offset = Math.abs(offsetSeconds(game, i, seat));
    if (offset <= reachOf(slot.kind) && offset < bestOffset) {
      bestOffset = offset;
      best = i;
    }
  }
  return best;
}

/**
 * Close the chopsticks for the seat whose turn it is.
 *
 * Returns whether the press did anything, so a caller need not re-derive the phase. Refused
 * during the ready freeze, while chewing, once the turn's presses are spent, and from the seat
 * that is not eating.
 */
export function bite(game: Game, seat: SeatId): boolean {
  if (seat !== game.active) return false;
  if (game.phase !== 'live') return false;
  if (game.chew > 0) return false;
  if (game.bites >= MAX_BITES_PER_TURN) return false;

  game.bites += 1;
  const index = slotUnderChopsticks(game, seat);
  if (index < 0) {
    // The mistake the observed rule names: the sticks close on bare belt.
    game.lastSlot = -1;
    game.lastOffset = 0;
    game.lastOutcome = 'fumble';
    game.lastPoints = -MISTAKE_POINTS;
    game.chew = FUMBLE_CHEW;
    if (seat === 'p1') {
      game.p1Points -= MISTAKE_POINTS;
      game.p1Fumbles += 1;
    } else {
      game.p2Points -= MISTAKE_POINTS;
      game.p2Fumbles += 1;
    }
    return true;
  }

  const slot = game.slots[index] as Slot;
  const offset = offsetSeconds(game, index, seat);
  const clean = Math.abs(offset) <= reachOf(slot.kind) * CLEAN_SHARE;
  const points = pointsOf(slot.kind);
  // Off the belt, and missing when it reaches the other counter. It comes back three quarters
  // of a lap later, which is after the opponent has passed it and before this seat sees it
  // again — the whole of the denial, in one assignment.
  slot.emptyUntil = game.clock + EMPTY_SECONDS;
  game.lastSlot = index;
  game.lastOffset = offset;
  game.lastOutcome = clean ? 'clean' : 'edge';
  game.lastPoints = points;
  game.chew = chewOf(slot.kind);
  if (seat === 'p1') {
    game.p1Points += points;
    game.p1Taken += 1;
    if (clean) game.p1Clean += 1;
  } else {
    game.p2Points += points;
    game.p2Taken += 1;
    if (clean) game.p2Clean += 1;
  }
  return true;
}

export interface StepResult {
  /** True on the step the turn ended. */
  readonly turnEnded: boolean;
  /** True on the step the turn passed to the other seat. */
  readonly handedOver: boolean;
}

const result = { turnEnded: false, handedOver: false };

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  result.turnEnded = false;
  result.handedOver = false;
  if (game.phase === 'over') return result;

  // The belt runs through every phase of every turn, including the freeze, the settle and the
  // board's half-turn: it belongs to the restaurant, not to whoever is holding the chopsticks.
  game.clock += fixedDeltaSeconds;

  if (game.phase === 'ready') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) game.phase = 'live';
    return result;
  }

  if (game.phase === 'live') {
    if (game.chew > 0) {
      game.chew -= fixedDeltaSeconds;
      if (game.chew < 0) game.chew = 0;
    }
    game.turnLeft -= fixedDeltaSeconds;
    if (game.turnLeft <= 0 || game.bites >= MAX_BITES_PER_TURN) {
      game.turnLeft = 0;
      if (game.active === 'p1') game.p1Turns += 1;
      else game.p2Turns += 1;
      game.phase = 'settling';
      game.hold = SETTLE_SECONDS;
      result.turnEnded = true;
    }
    return result;
  }

  game.hold -= fixedDeltaSeconds;
  if (game.hold <= 0) {
    handOver(game);
    result.handedOver = true;
  }
  return result;
}

/**
 * Pass the chopsticks, and decide whether the match is over.
 *
 * **A match ends only on a completed round**, and only at the end of a two-round course.
 * Reaching fifteen does not end it on the spot: the other seat still gets the turn it is owed,
 * and may reach fifteen too. Ending on the point would hand the match to whoever happened to be
 * leading that round — the trap every first-to-N game in this repo has had to be dug out of —
 * and here it would also make the round cap asymmetric, because the seat eating second would be
 * the only one whose last turn could be cancelled.
 */
function handOver(game: Game): void {
  game.turnsThisRound += 1;
  if (game.turnsThisRound < 2) {
    game.active = otherOf(game.active);
    beginTurn(game);
    return;
  }
  game.turnsThisRound = 0;
  // ...and only on a completed *course*, so both seats have led the same number of times. See
  // ROUNDS_PER_COURSE for what that is worth, which is more than it looks.
  if (game.round % ROUNDS_PER_COURSE === 0) finish(game);
  if (game.winner !== null) return;
  game.round += 1;
  game.active = leadOf(game.opener, game.round);
  beginTurn(game);
}

/**
 * The win condition, through the SDK's shared helper.
 *
 * `first-to` with the round cap fed in as `timeExpired`, which is exactly what the helper's
 * fall-through is for. Both seats crossing fifteen in the same round with the same total is a
 * draw, and the helper says so rather than handing it to whichever seat the code happened to
 * test first.
 *
 * The clean-plate tiebreak runs **only on what the helper calls a draw**. It is the score's
 * fine resolution, and it is worth having for the reason the exemplars give: a clean take and
 * one nicked off the edge are visibly different things on the belt, and counting them apart
 * costs a player nothing to understand.
 *
 * Deliberately a tiebreak and not points: a player who reaches fifteen first has won whatever
 * the other one's chopsticks looked like, because that is what the observed rule says the game
 * is.
 */
function finish(game: Game): void {
  const decided = resolve(
    { kind: 'first-to', target: TARGET_POINTS },
    { p1: game.p1Points, p2: game.p2Points },
    { timeExpired: game.round >= MAX_ROUNDS },
  );
  if (decided === null) return;
  game.phase = 'over';
  if (decided !== 'draw') {
    game.winner = decided;
    return;
  }
  if (game.p1Clean !== game.p2Clean) game.winner = game.p1Clean > game.p2Clean ? 'p1' : 'p2';
  else game.winner = 'draw';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far off the moment it meant to press it actually presses, in seconds. */
  readonly timing: number;
  /** How often a press is an outright fumble. */
  readonly blunder: number;
}

/**
 * Three tiers, expressed only as how accurately a tier hits the moment it meant to.
 *
 * A bite is a bare press against a clock and nothing else, so that is the whole of the skill
 * this game asks for and the whole of what the tiers differ in. The numbers are seconds of
 * human error: about a third of a second, a fifth, a sixth. Every one of them is at least nine
 * frames wide, so rule 6 holds by construction — none of these can pick a moment more finely
 * than a person can.
 *
 * They are looser than Cup Pong's (0.11–0.20) and Target Practice's (0.145–0.24) because the
 * windows here are tighter: a sashimi forgives 0.135 s either side and a rice ball 0.082, so a
 * tier at 0.16 s is already missing one plate in forty and one rice ball in four. A ladder is
 * only a ladder relative to the tolerance it is measured against.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.3, blunder: 0.15 },
  normal: { timing: 0.22, blunder: 0.08 },
  hard: { timing: 0.16, blunder: 0.02 },
});

/** How much larger a fumbled press's error is than the tier's ordinary one. */
export const BLUNDER_SCALE = 6;

/**
 * A tier's own estimate of whether it would land a press inside a tolerance.
 *
 * The error is two draws summed, so it is triangular on [-h, h] and this is its exact
 * distribution function. The bot is choosing between plates rather than predicting its own
 * score, so an estimate is the honest description of what this is.
 */
export function landChance(halfWidth: number, tolerance: number): number {
  if (tolerance >= halfWidth) return 1;
  const shortfall = 1 - tolerance / halfWidth;
  return 1 - shortfall * shortfall;
}

/**
 * What a plate is worth to a tier, in points, before the time it costs.
 *
 * Points if it lands, a point off if it does not. The mistake is what makes a marginal plate
 * genuinely not worth reaching for, and it is why the bot ever passes one up.
 */
export function expectedPointsOf(kind: Dish, difficulty: BotDifficulty): number {
  const chance = landChance(BOT_PROFILES[difficulty].timing, reachOf(kind));
  return pointsOf(kind) * chance - (1 - chance) * MISTAKE_POINTS;
}

export type BotStage = 'idle' | 'committed';

/** Values a bot draws per press it may make: two for the error, two for the fumble. */
export const BOT_ROLLS_PER_BITE = 4;

/**
 * Values a bot draws per turn. Always exactly this many, drawn before anything branches —
 * including before it knows whether there is anything on the belt worth reaching for.
 *
 * The other half of the guarantee in `createBotRngs`. A draw count that depended on what the
 * bot decided would make one seat's stream a function of the other's play, and here the two
 * seats already share a belt, so the one coupling that *can* be removed is worth removing.
 */
export const BOT_DRAWS_PER_TURN = MAX_BITES_PER_TURN * BOT_ROLLS_PER_BITE;

export interface BotState {
  /** This turn's press errors, drawn in one go at the first live step. */
  readonly rolls: Float64Array;
  drawn: boolean;
  /** Presses planned so far this turn, which is the index into `rolls`. */
  used: number;
  /** The slot it committed to, or -1. */
  quarry: number;
  /** Seconds left before the press it has already committed to. */
  timer: number;
  stage: BotStage;
  /** Set once it has decided there is nothing left this turn worth reaching for. */
  finished: boolean;
}

export function createBotState(): BotState {
  return {
    rolls: new Float64Array(BOT_DRAWS_PER_TURN),
    drawn: false,
    used: 0,
    quarry: -1,
    timer: 0,
    stage: 'idle',
    finished: false,
  };
}

export function resetBotState(state: BotState): void {
  state.rolls.fill(0);
  state.drawn = false;
  state.used = 0;
  state.quarry = -1;
  state.timer = 0;
  state.stage = 'idle';
  state.finished = false;
}

/**
 * One generator per seat, both drawn from the match's own before anything else touches it.
 *
 * With `BOT_DRAWS_PER_TURN` constant, this fixes what a seat's *hands* do: seat two commits to
 * the identical sequence of press errors whatever tier is sitting opposite it.
 *
 * It does **not** make seat two's eating independent of its opponent, and no arrangement of
 * generators could — the belt is one belt, and what the other seat took off it is missing when
 * it comes round. That coupling is the game. It is symmetric, it is visible on the board (the
 * bare plate is drawn), and the balance table in SPEC.md is where it is measured rather than
 * assumed.
 */
export function createBotRngs(source: Rng): { p1: Rng; p2: Rng } {
  return { p1: new Rng(source.next() | 0), p2: new Rng(source.next() | 0) };
}

/**
 * Pick what to reach for: points per second of turn spent.
 *
 * **Not points.** A rice ball is worth three and forgives less, so on points alone every tier
 * takes every rice ball it can see and the slices are scenery — which is the failure Target
 * Practice found from the other side, where the radii had to be fitted to put a crossing
 * between two tiers. Here the crossing is not in the precision at all: a rice ball costs 1.25 s
 * of chewing out of a 2.2 s turn, so taking one a second in is taking the rest of the *turn*, and a
 * slice arriving now can be worth more than a rice ball arriving in a second. Dividing by the
 * time a plate costs — the wait for it, plus as much of its chew as the turn has left to give —
 * prices exactly that, and it is a quantity a person reads off the belt: how long until it gets
 * here, and how much turn will be left afterwards.
 *
 * Everything it reads is on the board: where the plates are, what is on them, which slots are
 * bare, and how long its own turn has left. Plus one thing about itself, which is how steady
 * its hands are. A person has both. Nothing is searched — fourteen slots, O(1) each.
 *
 * A plate whose expected points are not positive is passed over rather than priced, because
 * reaching for it is worse than doing nothing at all.
 */
export function chooseQuarry(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  fromClock: number,
  turnEndClock: number,
): number {
  let best = -1;
  let bestValue = 0;
  let bestArrival = Infinity;
  for (let i = 0; i < game.slots.length; i += 1) {
    const slot = game.slots[i] as Slot;
    const arrival = nextArrival(game, i, seat, fromClock);
    if (arrival > turnEndClock) continue;
    if (!isPresentAt(slot, arrival)) continue;
    const expected = expectedPointsOf(slot.kind, difficulty);
    if (expected <= 0) continue;
    // As much of the chew as the turn can still be charged for: a plate taken on the last
    // moment of a turn costs nothing afterwards, because there is no afterwards.
    const chewCost = Math.min(chewOf(slot.kind), turnEndClock - arrival);
    const timeCost = arrival - fromClock + chewCost;
    const value = expected / (timeCost > 1e-6 ? timeCost : 1e-6);
    // Ties go to the plate that arrives soonest, which is the one leaving the most turn behind
    // it. The belt is mirrored, so ties are an everyday event rather than measure zero.
    if (
      value > bestValue + 1e-9 ||
      (Math.abs(value - bestValue) <= 1e-9 && arrival < bestArrival)
    ) {
      bestValue = value;
      bestArrival = arrival;
      best = i;
    }
  }
  return best;
}

/**
 * Run a bot for one step: draw its hands for the turn, then plan and press, as often as the
 * chewing lets it.
 *
 * **It counts down to a moment; it does not watch for a position.** Watching for a position is
 * the obvious way to write this and it hangs — a wanted offset the belt never lands exactly on
 * is a wait that never ends. A countdown cannot fail to expire, and it is the more honest model
 * anyway: a person commits to a moment, and pressing after the plate has gone past is a real way
 * to miss. Both exemplars found the same thing; Cup Pong found it as an actual deadlock on seed
 * two of its first harness run.
 *
 * It re-plans **only when its chopsticks come free**, never mid-countdown. A bot that revised a
 * committed press every step would be reacting faster than a person can change their mind, and
 * it would also never settle.
 */
export function driveBot(
  game: Game,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (game.active !== seat) return false;

  if (game.phase !== 'live') {
    // The turn is over, or has not started. Anything left standing from the last one — a
    // countdown that outran the deadline, most of all — goes now, so the next turn plans afresh.
    if (state.drawn) resetBotState(state);
    return false;
  }

  if (!state.drawn) {
    for (let i = 0; i < state.rolls.length; i += 1) state.rolls[i] = rng.float();
    state.drawn = true;
  }

  if (state.stage === 'committed') {
    if (state.timer > fixedDeltaSeconds / 2) {
      state.timer -= fixedDeltaSeconds;
      return false;
    }
    state.stage = 'idle';
    state.quarry = -1;
    state.timer = 0;
    return bite(game, seat);
  }

  if (state.finished) return false;
  if (game.chew > 0) return false;
  if (state.used >= MAX_BITES_PER_TURN || game.bites >= MAX_BITES_PER_TURN) {
    state.finished = true;
    return false;
  }

  const profile = BOT_PROFILES[difficulty];
  const base = state.used * BOT_ROLLS_PER_BITE;
  // Two draws summed: the press error is triangular rather than flat, so most presses land near
  // the mark and a bad one is rare. Flat, a tier either fits inside the window or it does not,
  // with nothing in between, and three tiers have nowhere to stand.
  let offset =
    ((state.rolls[base] as number) + (state.rolls[base + 1] as number) - 1) * profile.timing;
  const blunderRoll = state.rolls[base + 2] as number;
  const blunderSize = state.rolls[base + 3] as number;
  if (blunderRoll < profile.blunder) {
    offset += (blunderSize * 2 - 1) * profile.timing * BLUNDER_SCALE;
  }
  state.used += 1;

  const turnEndClock = game.clock + game.turnLeft;
  const quarry = chooseQuarry(game, seat, difficulty, game.clock, turnEndClock);
  if (quarry < 0) {
    state.finished = true;
    return false;
  }

  state.quarry = quarry;
  state.timer = nextArrival(game, quarry, seat, game.clock) - game.clock + offset;
  state.stage = 'committed';
  if (state.timer > fixedDeltaSeconds / 2) {
    state.timer -= fixedDeltaSeconds;
    return false;
  }
  // The error ran the moment back past now: a press that came too early, which is a real way to
  // close the sticks on nothing.
  state.stage = 'idle';
  state.quarry = -1;
  state.timer = 0;
  return bite(game, seat);
}
