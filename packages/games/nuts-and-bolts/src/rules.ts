import { Rng, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { SearchBudget, deepen, resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Nuts and Bolts, as pure rules.
 *
 * No rendering, no timing, no DOM: the game, the bot and the balance harness all read the
 * rack through these functions, so there is exactly one definition of what a legal move is
 * and of who has won.
 *
 * ## The puzzle
 *
 * A rack of bolts. Each bolt carries a stack of nuts and only the outermost nut of a stack
 * can be taken off. A nut may only be put on a bolt that is bare or whose outermost nut is
 * the same kind. Get every nut of a kind onto one bolt and that bolt is finished.
 *
 * ## What makes it two-player
 *
 * **Half the nuts are yours and half are mine, from the deal, and a bolt whose nuts are all
 * one kind pays whoever owns the nuts standing in it.** One rack, alternating turns, and a
 * score that is the best such line-up you ever had.
 *
 * Sorting is a solitaire and its natural score — did you solve it — saturates: two good
 * players both finish, so a duel on "who solved it" is a duel nobody can lose. Owned nuts move
 * the contest onto territory, which does not saturate, because the rack is one puzzle the two
 * of you are solving for different reasons.
 *
 * Three properties of that rule are doing the work, and every one of them was arrived at by
 * measuring the version without it. The numbers are in SPEC.md.
 *
 * 1. **It is read off the rack, not paid out at a moment either player can refuse to reach.**
 *    A first version paid when a bolt was *finished*, and two `hard` bots finished 0.5 bolts a
 *    match against `easy`'s 3.2: completing a bolt your opponent has more of pays them more
 *    than you, so neither ever did it and a quarter of matches ended nil-nil.
 * 2. **A mark is on the nut, not on the mover.** A version where the mover took the mark had
 *    two `hard` bots pushing one nut back and forth for a whole match — 26 moves between them
 *    and one nut each ever touched — because putting a nut on a pile leaves it on top, where
 *    the other seat can take it and the mark with it. Building was a gift, so nobody built.
 * 3. **It is a high-water mark.** Anything on top of a pile can be lifted off, so a score read
 *    from the *final* rack would go to whoever moved last. Banking makes taking a nut off a
 *    pile a denial of the opponent's future rather than a theft of their past.
 *
 * **A finished bolt locks.** Nothing goes in or out of it again, so the nuts standing in it
 * are permanently in their owners' count. That is what finishing a bolt is worth, and it is
 * half of the termination argument as well.
 */

/* -------------------------------------------------------------------------- */
/* The rack                                                                     */
/* -------------------------------------------------------------------------- */

/** Kinds of nut. Five, and every kind has exactly {@link BOLT_CAPACITY} nuts. */
export const KINDS = 5;

/** Nuts a bolt holds. */
export const BOLT_CAPACITY = 4;

/**
 * Bolts on the rack: one per kind, plus two spare.
 *
 * Two spare is the smallest number that keeps the puzzle from locking up constantly and the
 * largest that keeps the search cheap — every extra bolt is another destination for every
 * movable nut, so branching grows with it. A rack of six kinds on eight bolts was measured and
 * plays much the same; it costs 2.6k search nodes against 1.9k and needs a sixth silhouette
 * for the nuts, and neither buys anything.
 */
export const BOLT_COUNT = 7;

export const SLOT_COUNT = BOLT_COUNT * BOLT_CAPACITY;
export const NUT_COUNT = KINDS * BOLT_CAPACITY;
/** Nuts each seat owns, and therefore the largest score either of them can reach. */
export const NUTS_PER_SEAT = NUT_COUNT / 2;

/** A slot with no nut in it. Kinds are 0..KINDS-1. */
export const EMPTY = -1;

/** Marks. A nut nobody has moved since the deal is {@link UNMARKED} and scores for nobody. */
export const UNMARKED = 0;
export const MARK_P1 = 1;
export const MARK_P2 = 2;

/** Moves are packed as `from * BOLT_COUNT + to`, so the whole move space is this wide. */
export const MOVE_COUNT = BOLT_COUNT * BOLT_COUNT;
export const NO_MOVE = -1;

/**
 * Moves each seat gets. The match ends when both budgets are spent, and nothing that happens
 * on the rack can add one — which is the whole of this game's termination argument.
 * `roundSeconds` ends nothing anywhere in this repository.
 *
 * **Seven, and it is short on purpose.** Both seats own ten nuts, so a rack sorted to the last
 * nut is ten-all and a draw whatever either of them did — the budget is what makes the match a
 * race for the rack rather than a joint tidy-up. Measured at 800 seeds a tier, with everything
 * else as shipped: seven moves draws 10.8 / 13.6 / 14.5% of matches at the three tiers, nine
 * draws 16.9 / 21.8 / 22.7%, and thirteen draws 41 / 48 / 31%.
 */
export const MOVES_PER_SEAT = 7;

/**
 * Moves in a turn — and the number that decides how much of the rack gets sorted.
 *
 * **Two, because unburying a nut and placing one are two different acts.** The nut you want is
 * usually under somebody else's, so a turn of one move is a turn in which you can lift the lid
 * or place a nut but never both, and the opponent gets to answer in between. Measured at 400
 * seeds a tier, everything else as shipped:
 *
 * | | bolts finished | nuts sorted | draws |
 * |---|---|---|---|
 * | one move a turn | 0.94 | 5.2 of 10 | 10.3% |
 * | **two (shipped)** | **2.20** | **7.5 of 10** | 13.8% |
 *
 * At `hard`; `normal` moves the same way and `easy` barely moves at all, because a tier that
 * blunders on more than half its moves was never executing a two-move plan. Three and a half
 * points of draw rate buys a rack that is twice as sorted at the end, which is the game the
 * catalogue row describes.
 *
 * It was **not** what the first version of this game needed it for, and that is worth
 * recording because it is the sort of thing a later change inherits blindly. Under a scoring
 * rule where the mover took the mark, strict alternation gave the *opening* seat 76 to 78% of
 * the decided matches and pairing the turns was the cure. With the shipped rule — the marks
 * are dealt and never move — the opener sits at 44 to 51% either way, so the pairing is
 * carried for the reason above and for no other.
 *
 * The opening turn is a single move and {@link MOVES_PER_SEAT} is odd, so the closing one is
 * too: the order runs A · BB · AA · … · BB · A, which is the same sequence read backwards with
 * the chairs swapped. An even budget would give one seat a double turn more than the other,
 * which is a seat bias made of arithmetic.
 */
export const MOVES_PER_TURN = 2;

/**
 * Seconds a seat has to play its move before the turn is forfeited.
 *
 * In the rules, not in the shell, and it is the reason a match with nobody at the device
 * still ends: a forfeited move spends the budget exactly as a played one does, so it drains
 * whether or not anybody is playing. Two absent players finish in
 * `2 * MOVES_PER_SEAT * TURN_SECONDS` = 168 simulated seconds, inside the ten-minute guard in
 * `apps/web/src/data/termination.test.ts`.
 *
 * Twelve seconds is long for a choice between seven bolts made with one press, and it has to
 * be, because it is also what a player gets when they are working out which pile to break.
 */
export const TURN_SECONDS = 12;

/**
 * The live rack and the state that decides a match.
 *
 * Flat and mutable on purpose: a match is stepped inside a fixed timestep that may not
 * allocate, and the balance harness plays thousands of them.
 */
export interface Match {
  /** Slot `bolt * BOLT_CAPACITY + level` holds a kind in 0..KINDS-1, or {@link EMPTY}. */
  readonly slots: number[];
  /**
   * Who owns the nut in each slot: {@link UNMARKED}, {@link MARK_P1}, {@link MARK_P2}.
   *
   * A nut belongs to the **first** seat that ever moves it, and the mark travels with the nut
   * from then on. It is never transferred, and that is the single most load-bearing rule in
   * this game — see the note on {@link applyMove}.
   */
  readonly marks: number[];
  /** Nuts on each bolt. Derived from `slots`, kept alongside so a move is O(1). */
  readonly height: number[];
  /** A bolt that is full and all one kind. Nothing goes in or out of it again. */
  readonly locked: boolean[];
  active: SeatId;
  /** Moves left in the active seat's turn. */
  turnMoves: number;
  p1Moves: number;
  p2Moves: number;
  /** The best {@link liveMarks} either seat has ever held. Only ever climbs. */
  p1Score: number;
  p2Score: number;
  lockedCount: number;
  winner: SeatId | 'draw' | null;
  /** The last move played, for the renderer. -1 when nothing has moved yet. */
  movedFrom: number;
  movedTo: number;
  movedKind: number;
  /** The level the moved nut landed on, so the renderer can fly it there. */
  movedLevel: number;
}

export function createMatch(): Match {
  return {
    slots: new Array<number>(SLOT_COUNT).fill(EMPTY),
    marks: new Array<number>(SLOT_COUNT).fill(UNMARKED),
    height: new Array<number>(BOLT_COUNT).fill(0),
    locked: new Array<boolean>(BOLT_COUNT).fill(false),
    active: 'p1',
    turnMoves: 1,
    p1Moves: MOVES_PER_SEAT,
    p2Moves: MOVES_PER_SEAT,
    p1Score: 0,
    p2Score: 0,
    lockedCount: 0,
    winner: null,
    movedFrom: -1,
    movedTo: -1,
    movedKind: EMPTY,
    movedLevel: -1,
  };
}

/** Reads through `noUncheckedIndexedAccess`; an out-of-range slot reads as empty. */
function slotAt(slots: readonly number[], index: number): number {
  return slots[index] ?? EMPTY;
}

function heightAt(height: readonly number[], bolt: number): number {
  return height[bolt] ?? 0;
}

/** The mark a seat leaves on a nut it moves. */
export function markOf(seat: SeatId): number {
  return seat === 'p1' ? MARK_P1 : MARK_P2;
}

export function moveOf(from: number, to: number): number {
  return from * BOLT_COUNT + to;
}

export function fromOf(move: number): number {
  return Math.floor(move / BOLT_COUNT);
}

export function toOf(move: number): number {
  return move % BOLT_COUNT;
}

/** Kind of the outermost nut on a bolt, or {@link EMPTY} when the bolt is bare. */
export function topKindIn(
  slots: readonly number[],
  height: readonly number[],
  bolt: number,
): number {
  const count = heightAt(height, bolt);
  if (count <= 0) return EMPTY;
  return slotAt(slots, bolt * BOLT_CAPACITY + count - 1);
}

export function topKind(match: Readonly<Match>, bolt: number): number {
  return topKindIn(match.slots, match.height, bolt);
}

/**
 * Nuts of one kind stacked together before the pile counts for anybody.
 *
 * Two, because one nut dropped on a bare bolt is not a line-up — it is the cheapest move on
 * the rack and there is nearly always a bare bolt to drop onto, so a floor of one would pay
 * every move that had nowhere better to go. Two is the smallest number that is a *match*
 * between nuts, which is what the game is about.
 */
export const SORTED_MIN = 2;

/** True when every nut on the bolt is the same kind. A bare bolt is not pure, it is bare. */
export function isPureIn(
  slots: readonly number[],
  height: readonly number[],
  bolt: number,
): boolean {
  const count = heightAt(height, bolt);
  if (count <= 0) return false;
  const base = bolt * BOLT_CAPACITY;
  const kind = slotAt(slots, base);
  for (let level = 1; level < count; level += 1) {
    if (slotAt(slots, base + level) !== kind) return false;
  }
  return true;
}

/** A pile that is all one kind and tall enough to count. A locked bolt is always one. */
export function isSortedIn(
  slots: readonly number[],
  height: readonly number[],
  bolt: number,
): boolean {
  return heightAt(height, bolt) >= SORTED_MIN && isPureIn(slots, height, bolt);
}

/**
 * Whether a nut may travel from one bolt to another.
 *
 * The observed rule, and nothing added to it: the source must have a nut to give, the
 * destination must have room, and the destination must be bare or be showing the same kind.
 * A locked bolt is out of the game in both directions — it is already full, so the only extra
 * clause needed is the one that stops it being a source.
 */
export function legalIn(
  slots: readonly number[],
  height: readonly number[],
  locked: readonly boolean[],
  from: number,
  to: number,
): boolean {
  if (from === to) return false;
  if (from < 0 || from >= BOLT_COUNT || to < 0 || to >= BOLT_COUNT) return false;
  if (locked[from] === true || locked[to] === true) return false;
  if (heightAt(height, from) <= 0) return false;
  const room = heightAt(height, to);
  if (room >= BOLT_CAPACITY) return false;
  if (room === 0) return true;
  return topKindIn(slots, height, to) === topKindIn(slots, height, from);
}

/**
 * Every legal move in a position, written into `out` from `offset`, and how many there are.
 *
 * Moves that finish a bolt come first. That is move ordering for the search — the best move
 * examined first is what makes an alpha-beta window prune anything at all — and it costs the
 * game nothing, because a caller that only wants to know whether a move is legal asks
 * {@link isLegalMove} instead.
 *
 * `canonical` offers only the lowest-numbered bare bolt as a destination. Two bare bolts are
 * the same bolt as far as the rules are concerned, so a search that tried both would double
 * its own work to reach two identical positions. It is off for the game itself, where a
 * player may put a nut on whichever bare bolt they like.
 */
/**
 * Scratch for {@link movesInto}. Filled at the top of every call and read only inside it, so
 * generating moves at a search node allocates nothing and never scans a bolt twice.
 */
const genTop = new Array<number>(BOLT_COUNT).fill(EMPTY);
const genTall = new Array<number>(BOLT_COUNT).fill(0);
const genPure = new Array<boolean>(BOLT_COUNT).fill(false);

export function movesInto(
  slots: readonly number[],
  height: readonly number[],
  locked: readonly boolean[],
  out: number[],
  offset: number,
  canonical: boolean,
): number {
  let firstBare = -1;
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
    const tall = heightAt(height, bolt);
    genTall[bolt] = tall;
    genTop[bolt] = tall > 0 ? slotAt(slots, bolt * BOLT_CAPACITY + tall - 1) : EMPTY;
    genPure[bolt] = isPureIn(slots, height, bolt);
    if (canonical && firstBare < 0 && tall === 0 && locked[bolt] !== true) firstBare = bolt;
  }

  let count = 0;
  // Two passes so that a move which finishes a bolt is always offered before one that does
  // not. The predicate is the same in both; only the order differs.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let from = 0; from < BOLT_COUNT; from += 1) {
      if (locked[from] === true) continue;
      if ((genTall[from] ?? 0) <= 0) continue;
      const kind = genTop[from] ?? EMPTY;
      for (let to = 0; to < BOLT_COUNT; to += 1) {
        if (to === from || locked[to] === true) continue;
        const tallTo = genTall[to] ?? 0;
        if (tallTo >= BOLT_CAPACITY) continue;
        if (tallTo > 0 && genTop[to] !== kind) continue;
        if (canonical && tallTo === 0 && to !== firstBare) continue;
        const finishes = tallTo === BOLT_CAPACITY - 1 && genPure[to] === true;
        if (finishes !== (pass === 0)) continue;
        out[offset + count] = moveOf(from, to);
        count += 1;
      }
    }
  }
  return count;
}

export function legalMovesInto(match: Readonly<Match>, out: number[], offset: number): number {
  return movesInto(match.slots, match.height, match.locked, out, offset, false);
}

export function isLegalMove(match: Readonly<Match>, move: number): boolean {
  if (match.winner !== null) return false;
  if (move < 0 || move >= MOVE_COUNT) return false;
  return legalIn(match.slots, match.height, match.locked, fromOf(move), toOf(move));
}

function anyLegalIn(
  slots: readonly number[],
  height: readonly number[],
  locked: readonly boolean[],
): boolean {
  for (let from = 0; from < BOLT_COUNT; from += 1) {
    for (let to = 0; to < BOLT_COUNT; to += 1) {
      if (legalIn(slots, height, locked, from, to)) return true;
    }
  }
  return false;
}

export function hasAnyLegalMove(match: Readonly<Match>): boolean {
  return anyLegalIn(match.slots, match.height, match.locked);
}

/** Marked nuts on a bolt, for one seat. */
export function marksOn(match: Readonly<Match>, bolt: number, seat: SeatId): number {
  const mark = markOf(seat);
  const base = bolt * BOLT_CAPACITY;
  let count = 0;
  for (let level = 0; level < heightAt(match.height, bolt); level += 1) {
    if (match.marks[base + level] === mark) count += 1;
  }
  return count;
}

/**
 * A seat's marks standing on a sorted pile, right now — the quantity the whole game is about.
 *
 * Read off the rack rather than paid out at a moment, so no player can refuse to let the
 * other one score. What it counts is exactly what a person looking at the rack sees: your own
 * nuts, in a pile of their own kind.
 */
export function liveMarks(match: Readonly<Match>, seat: SeatId): number {
  const mark = markOf(seat);
  let count = 0;
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
    if (!isSortedIn(match.slots, match.height, bolt)) continue;
    const base = bolt * BOLT_CAPACITY;
    for (let level = 0; level < heightAt(match.height, bolt); level += 1) {
      if (match.marks[base + level] === mark) count += 1;
    }
  }
  return count;
}

/**
 * The same marks, each counted as deep as the pile it stands in.
 *
 * The score's finest resolution, and the last thing a match is decided on. Two seats level on
 * what they banked and level on what they still hold are separated by *where* they hold it: a
 * nut in a finished bolt is worth four and a nut in a pair is worth two, so the seat with its
 * marks in the taller piles takes the rack. It matters because the first two levels are counts
 * out of twenty and two players of the same standard land on the same one of those values very
 * often — measured, with and without, in SPEC.md.
 */
export function depthMarks(match: Readonly<Match>, seat: SeatId): number {
  const mark = markOf(seat);
  let total = 0;
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
    if (!isSortedIn(match.slots, match.height, bolt)) continue;
    const base = bolt * BOLT_CAPACITY;
    const tall = heightAt(match.height, bolt);
    for (let level = 0; level < tall; level += 1) {
      if (match.marks[base + level] === mark) total += tall;
    }
  }
  return total;
}

/**
 * Take both banks up to what the rack shows now.
 *
 * **The score is a high-water mark rather than a reading of the final rack.** The outermost
 * nut of a pile can be lifted and re-marked by the other seat, so scoring the final position
 * measures who moved most recently rather than who played best — and it turns the closing
 * moves of every match into a tug-of-war over one nut. Banking makes dismantling a pile a
 * denial of the opponent's *future* rather than a theft of their past, which is a move worth
 * playing without being the only move worth playing.
 */
export function bank(match: Match): void {
  const p1 = liveMarks(match, 'p1');
  const p2 = liveMarks(match, 'p2');
  if (p1 > match.p1Score) match.p1Score = p1;
  if (p2 > match.p2Score) match.p2Score = p2;
}

/**
 * Whether the match has run out of things to do.
 *
 * Three ways, and every one of them is reached in measurement: every kind finished, both move
 * budgets spent, or a rack in which no nut can legally move at all. The third is the one a
 * sorting puzzle can genuinely produce — every bolt with room showing a kind nothing on top
 * of another bolt matches — and it is why "both budgets spent" alone would not do.
 */
export function isOver(match: Readonly<Match>): boolean {
  if (match.lockedCount >= KINDS) return true;
  if (match.p1Moves <= 0 && match.p2Moves <= 0) return true;
  return !hasAnyLegalMove(match);
}

const CONDITION: WinCondition = { kind: 'highest-when-time-expires' };
/** Reused so judging a position allocates nothing; a match is judged after every move. */
const tally = { p1: 0, p2: 0 };
const timeExpired = { timeExpired: true };

/** Decide the match, or null while it is still running. */
export function judge(match: Readonly<Match>): SeatId | 'draw' | null {
  if (!isOver(match)) return null;
  tally.p1 = match.p1Score;
  tally.p2 = match.p2Score;
  const outcome = resolve(CONDITION, tally, timeExpired);
  if (outcome !== 'draw') return outcome;
  // Level on the best either seat ever had, the rack goes to whoever is still holding more of
  // it when the moves run out. That is the score's fine resolution, and it is what leaves a
  // player who is level on the banked count something to play for.
  const p1 = liveMarks(match, 'p1');
  const p2 = liveMarks(match, 'p2');
  if (p1 !== p2) return p1 > p2 ? 'p1' : 'p2';
  const d1 = depthMarks(match, 'p1');
  const d2 = depthMarks(match, 'p2');
  if (d1 === d2) return 'draw';
  return d1 > d2 ? 'p1' : 'p2';
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

/** Moves `seat` has left. */
export function movesLeft(match: Readonly<Match>, seat: SeatId): number {
  return seat === 'p1' ? match.p1Moves : match.p2Moves;
}

function turnLengthFor(remaining: number): number {
  return remaining < MOVES_PER_TURN ? remaining : MOVES_PER_TURN;
}

/** Hand the turn on once the active seat's turn is used up. */
function advanceTurn(match: Match): void {
  if (match.turnMoves > 0 && movesLeft(match, match.active) > 0) return;
  const next = otherSeat(match.active);
  // A seat with nothing left cannot be handed the turn; the other one plays out its budget.
  const taker = movesLeft(match, next) > 0 ? next : match.active;
  match.active = taker;
  match.turnMoves = turnLengthFor(movesLeft(match, taker));
}

function spendMove(match: Match): void {
  if (match.active === 'p1') match.p1Moves -= 1;
  else match.p2Moves -= 1;
  match.turnMoves -= 1;
}

/**
 * Play a move. Returns false and changes nothing when the position does not allow it, so a
 * caller may offer any tap or key at all.
 */
export function applyMove(match: Match, move: number): boolean {
  if (!isLegalMove(match, move)) return false;
  const from = fromOf(move);
  const to = toOf(move);

  const fromIndex = from * BOLT_CAPACITY + heightAt(match.height, from) - 1;
  const kind = slotAt(match.slots, fromIndex);
  const mark = match.marks[fromIndex] ?? UNMARKED;
  match.slots[fromIndex] = EMPTY;
  match.marks[fromIndex] = UNMARKED;
  match.height[from] = heightAt(match.height, from) - 1;

  const level = heightAt(match.height, to);
  const toIndex = to * BOLT_CAPACITY + level;
  match.slots[toIndex] = kind;
  // The mark belongs to the nut and travels with it. Nothing anywhere in this file writes a
  // mark except the deal.
  match.marks[toIndex] = mark;
  match.height[to] = level + 1;

  match.movedFrom = from;
  match.movedTo = to;
  match.movedKind = kind;
  match.movedLevel = level;

  spendMove(match);

  // A bolt holding every nut of its kind is finished, and finishing locks it: nothing goes in
  // or out again, so the marks standing in it are in their owners' live count for the rest of
  // the match and can never be lifted off. That is what finishing a bolt is worth.
  if (match.height[to] === BOLT_CAPACITY && isPureIn(match.slots, match.height, to)) {
    match.locked[to] = true;
    match.lockedCount += 1;
  }

  bank(match);
  match.winner = judge(match);
  if (match.winner === null) advanceTurn(match);
  return true;
}

/**
 * Spend the active seat's move without moving a nut.
 *
 * What the turn clock does when it runs out, and what a seat facing a rack with no legal move
 * on it does. A turn that cost nothing would leave two people who have put the phone down in
 * a tournament match that never ends.
 */
export function forfeitMove(match: Match): boolean {
  if (match.winner !== null) return false;
  if (movesLeft(match, match.active) <= 0) return false;
  match.movedFrom = -1;
  match.movedTo = -1;
  match.movedKind = EMPTY;
  match.movedLevel = -1;
  spendMove(match);
  match.winner = judge(match);
  if (match.winner === null) advanceTurn(match);
  return true;
}

/* -------------------------------------------------------------------------- */
/* The deal, and why it is not a shuffle                                        */
/* -------------------------------------------------------------------------- */

/**
 * Legal moves played backwards from the finished rack.
 *
 * Long enough that no kind is left sitting where it started, short enough that the two seats
 * can make real progress inside their budgets. Measured; the numbers are in SPEC.md.
 */
export const DEAL_WALK = 26;

/**
 * Walks to try before settling for the best one seen.
 *
 * Bounded because this runs in `init` on whatever seed the shell hands over, and an unbounded
 * search for a good rack is a hang waiting for an unlucky seed.
 */
export const DEAL_ATTEMPTS = 60;

/**
 * Sorted piles a dealt rack may hold: **none**. Every bolt is bare, holds one nut, or holds two
 * or more kinds.
 *
 * Every point in this game is earned, and this is what makes that true. A rack dealt with two
 * nuts of a kind already stacked would credit whoever happens to own them the moment the first
 * move banks, and both seats would open with a score neither of them played for. Requiring the
 * rack to start as a mess also makes it look like the puzzle it is. Over 20,000 seeds the walk
 * has always found one inside {@link DEAL_ATTEMPTS}.
 */
export const SORTED_PILES_ALLOWED = 0;

const walkSlots = new Array<number>(SLOT_COUNT).fill(EMPTY);
const walkHeight = new Array<number>(BOLT_COUNT).fill(0);
const bestSlots = new Array<number>(SLOT_COUNT).fill(EMPTY);
const bestHeight = new Array<number>(BOLT_COUNT).fill(0);
const noLocks = new Array<boolean>(BOLT_COUNT).fill(false);
/** Candidate reverse moves, packed the same way a forward move is. */
const walkMoves = new Array<number>(MOVE_COUNT).fill(0);

/** The finished rack: kind `k` fills bolt `k`, and the spare bolts are bare. */
export function finishedInto(slots: number[], height: number[]): void {
  for (let index = 0; index < SLOT_COUNT; index += 1) slots[index] = EMPTY;
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) height[bolt] = 0;
  for (let kind = 0; kind < KINDS; kind += 1) {
    for (let level = 0; level < BOLT_CAPACITY; level += 1) {
      slots[kind * BOLT_CAPACITY + level] = kind;
    }
    height[kind] = BOLT_CAPACITY;
  }
}

/**
 * Every move that could have produced this rack, written into `out`.
 *
 * This is the whole solvability argument, so it is worth being exact about what it computes.
 * A *forward* move takes the outermost nut off `A` and puts it on `B`. Read backwards from a
 * rack `S`, that means the nut is now outermost on `B`: lift it off `B` and put it back on
 * `A`. For the forward move to have been legal in the rack that results, two things must
 * hold, and they are the two conditions below:
 *
 * - **`B` must be bare or still showing the same kind once the nut is lifted.** That is the
 *   "only onto the same colour" rule, read backwards.
 * - **Putting the nut back on `A` must not finish `A`.** A finished bolt is locked, so a
 *   forward move *out of* one is not legal, and a reverse step that created one would build a
 *   position the match itself could never have reached.
 *
 * A move packed here is `A * BOLT_COUNT + B` — the bolt the nut goes back to, then the bolt
 * it is lifted from — so it reads in the same order as the forward move it inverts.
 */
export function reverseMovesInto(
  slots: readonly number[],
  height: readonly number[],
  out: number[],
): number {
  let count = 0;
  for (let lift = 0; lift < BOLT_COUNT; lift += 1) {
    const tall = heightAt(height, lift);
    if (tall <= 0) continue;
    const base = lift * BOLT_CAPACITY;
    const kind = slotAt(slots, base + tall - 1);
    // The forward move landed on `lift`, so what is underneath must be the same kind or
    // nothing at all.
    if (tall > 1 && slotAt(slots, base + tall - 2) !== kind) continue;
    for (let back = 0; back < BOLT_COUNT; back += 1) {
      if (back === lift) continue;
      const room = heightAt(height, back);
      if (room >= BOLT_CAPACITY) continue;
      // Would putting it back finish `back`? Then the forward move would have to come out of
      // a locked bolt, which the match forbids.
      if (
        room === BOLT_CAPACITY - 1 &&
        isPureIn(slots, height, back) &&
        slotAt(slots, back * BOLT_CAPACITY) === kind
      ) {
        continue;
      }
      out[count] = moveOf(back, lift);
      count += 1;
    }
  }
  return count;
}

/**
 * How far a candidate rack is from acceptable: the piles already all one kind, plus a penalty
 * that rules out a rack with nothing legal to do on it. **Lower is better and zero is
 * accepted**; the walk keeps the best it saw. See {@link SORTED_PILES_ALLOWED}.
 */
function faultsOf(slots: readonly number[], height: readonly number[]): number {
  let faults = anyLegalIn(slots, height, noLocks) ? 0 : BOLT_COUNT + 1;
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
    if (isSortedIn(slots, height, bolt)) faults += 1;
  }
  return faults;
}

/**
 * Deal a rack by **playing legal moves backwards from the finished one**.
 *
 * This is not a stylistic choice. A sorting puzzle dealt by scattering nuts at random is
 * unsolvable a good share of the time — four nuts of one kind buried under four different
 * lids is a rack nothing can take apart — and it fails silently, because an unsolvable rack
 * looks exactly like a hard one. Walking backwards can only ever land somewhere the forward
 * rules can walk out of, because the walk itself is the way out.
 *
 * The walk never immediately retraces its own step, for the same reason a person shuffling
 * cards does not put one back where it came from: a walk that may undo itself spends much of
 * its length standing still.
 *
 * The rack this returns has **no seat in it at all** — no marks, no orientation, no goal that
 * belongs to one player. Both seats face the identical position, so unlike a game with two
 * goals there is nothing here to balance between them, and no rejection sampling is needed
 * for fairness. The acceptance test is only about the puzzle being a puzzle.
 */
export function dealInto(slots: number[], height: number[], rng: Rng): void {
  let bestFaults = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < DEAL_ATTEMPTS; attempt += 1) {
    finishedInto(walkSlots, walkHeight);
    let lastMove = NO_MOVE;
    for (let step = 0; step < DEAL_WALK; step += 1) {
      const count = reverseMovesInto(walkSlots, walkHeight, walkMoves);
      if (count === 0) break;
      const index = rng.int(0, count);
      let move = walkMoves[index] ?? NO_MOVE;
      // Retracing is `moveOf(a, b)` after `moveOf(b, a)`: the nut goes straight back. The
      // next candidate is taken rather than a second draw, so a walk costs exactly one value
      // a step whatever it lands on.
      if (lastMove !== NO_MOVE && move === moveOf(toOf(lastMove), fromOf(lastMove))) {
        move = walkMoves[(index + 1) % count] ?? move;
      }
      const back = fromOf(move);
      const lift = toOf(move);
      const tall = heightAt(walkHeight, lift);
      const kind = slotAt(walkSlots, lift * BOLT_CAPACITY + tall - 1);
      walkSlots[lift * BOLT_CAPACITY + tall - 1] = EMPTY;
      walkHeight[lift] = tall - 1;
      const room = heightAt(walkHeight, back);
      walkSlots[back * BOLT_CAPACITY + room] = kind;
      walkHeight[back] = room + 1;
      lastMove = move;
    }

    const faults = faultsOf(walkSlots, walkHeight);
    if (faults < bestFaults) {
      bestFaults = faults;
      for (let index = 0; index < SLOT_COUNT; index += 1) {
        bestSlots[index] = slotAt(walkSlots, index);
      }
      for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
        bestHeight[bolt] = heightAt(walkHeight, bolt);
      }
    }
    if (bestFaults <= SORTED_PILES_ALLOWED) break;
  }

  for (let index = 0; index < SLOT_COUNT; index += 1) slots[index] = slotAt(bestSlots, index);
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) height[bolt] = heightAt(bestHeight, bolt);
}

/**
 * How many nuts of each kind belong to seat one; seat two owns the rest.
 *
 * The list is its own reverse, so swapping the seats and reversing the kinds gives the same
 * table back: neither seat is dealt an easier hand than the other, whatever the rack looks
 * like. Two kinds are mostly yours, two are mostly the other seat's, and the middle one is
 * split — which is what stops the rack being a puzzle you are both solving for the same
 * reason. Every kind you finish pays whoever owns the nuts in it, so the middle kind pays you
 * both and the other four are worth fighting over.
 */
export const KIND_SHARE: readonly number[] = Object.freeze([3, 3, 2, 1, 1]);

const ownSlots = new Array<number>(BOLT_CAPACITY).fill(0);

/**
 * Give every nut an owner.
 *
 * Ten each, by construction. *Which* nuts of a kind a seat gets is drawn from the match seed,
 * because a nut at the bottom of a mixed pile is worth less than one on top and a fixed rule
 * would hand the same side of that to the same seat every match. A seeded coin then swaps the
 * two seats outright, which makes the whole distribution of hands invariant under swapping the
 * chairs rather than merely equal on the totals.
 */
export function dealMarksInto(
  slots: readonly number[],
  height: readonly number[],
  marks: number[],
  rng: Rng,
): void {
  for (let index = 0; index < SLOT_COUNT; index += 1) marks[index] = UNMARKED;
  for (let kind = 0; kind < KINDS; kind += 1) {
    let found = 0;
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
      for (let level = 0; level < heightAt(height, bolt); level += 1) {
        const index = bolt * BOLT_CAPACITY + level;
        if (slotAt(slots, index) === kind) {
          ownSlots[found] = index;
          found += 1;
        }
      }
    }
    rng.shuffle(ownSlots);
    const mine = KIND_SHARE[kind] ?? 0;
    for (let i = 0; i < found; i += 1) {
      marks[ownSlots[i] ?? 0] = i < mine ? MARK_P1 : MARK_P2;
    }
  }
  if (rng.bool()) {
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const mark = marks[index];
      if (mark === MARK_P1) marks[index] = MARK_P2;
      else if (mark === MARK_P2) marks[index] = MARK_P1;
    }
  }
}

/**
 * Deal a fresh match.
 *
 * `openingSeat` comes from the shell, which alternates it across the rounds of a best-of so
 * that first-mover advantage washes out. A game that assumed `p1` would hand the opener's
 * edge to the same person every round.
 */
export function resetMatch(match: Match, rng: Rng, openingSeat: SeatId): void {
  dealInto(match.slots, match.height, rng);
  dealMarksInto(match.slots, match.height, match.marks, rng);
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) match.locked[bolt] = false;
  match.active = openingSeat;
  match.turnMoves = 1;
  match.p1Moves = MOVES_PER_SEAT;
  match.p2Moves = MOVES_PER_SEAT;
  match.p1Score = 0;
  match.p2Score = 0;
  match.lockedCount = 0;
  match.movedFrom = -1;
  match.movedTo = -1;
  match.movedKind = EMPTY;
  match.movedLevel = -1;
  match.winner = judge(match);
}

/* -------------------------------------------------------------------------- */
/* The bot                                                                      */
/* -------------------------------------------------------------------------- */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * How many moves ahead each tier looks.
 *
 * Difficulty is only ever how far the bot sees and how often it throws the position away. No
 * tier reads anything a player sitting at the rack cannot read, none gets an extra move, and
 * none of them knows how the rack was dealt — the evaluation below is the win condition and
 * nothing else, and a player can count every term in it.
 *
 * Swept alone against an untouched `normal`, 300 seeds in each seat order, everything else as
 * shipped. Strictly monotone over its whole range:
 *
 * | `hard` depth | 1 | 2 | 3 | 4 | **5** | 6 |
 * |---|---|---|---|---|---|---|
 * | wins vs `normal` | 40.2% | 57.8% | 69.5% | 73.7% | **76.4%** | 79.6% |
 *
 * Six is a further three points and spends the whole node budget, so it is the first depth
 * whose answer depends on the ceiling rather than on the position. Five is the last one that
 * always completes.
 */
export const SEARCH_DEPTH: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 1,
  normal: 2,
  hard: 5,
});

/**
 * How often a tier abandons its search and plays a uniformly random legal move.
 *
 * Swept alone, same method. Monotone over its whole range, and the reason `easy` needs one at
 * all: at depth one with no blunders it still takes 40% off `normal`, which is not a bottom
 * rung.
 *
 * | `easy` blunder | 0 | 0.15 | 0.3 | 0.45 | **0.55** | 0.8 |
 * |---|---|---|---|---|---|---|
 * | `normal` wins | 59.8% | 64.8% | 70.3% | 73.2% | **74.8%** | 84.2% |
 */
export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.55,
  normal: 0.12,
  hard: 0,
});

/**
 * Values a bot draws from its generator per move, whatever it decides to do.
 *
 * Constant on purpose. Both draws happen before anything branches, so the generator advances
 * by the same amount whether the bot blunders or searches — a conditional draw count is how
 * one seat's play quietly becomes a function of how its opponent happens to be playing.
 */
export const BOT_DRAWS_PER_MOVE = 2;

/**
 * The node ceiling, above the SDK's 1,500 default.
 *
 * A rack has a far wider branching factor than a board of squares: seven bolts each offering
 * up to six destinations. With bare bolts folded together and finishing moves examined first
 * it settles at about eight moves a position, which puts a full depth-five sweep an order of
 * magnitude past the default. 12,000 is chosen so the budget is a **guard rather than a
 * limiter**: over 4,800 measured matches the worst single sweep spent 8,692 nodes, so every
 * tier always reaches its declared depth, and the ceiling exists to stop a later depth
 * increase silently costing a frame. It is deterministic rather than a clock, so a phone and a
 * laptop spend the same budget and return the same move. Worst measured `botMove`: 4.0 ms
 * against a 16.7 ms frame.
 */
export const SEARCH_NODES = 12000;

/**
 * The evaluation is the win condition and nothing else.
 *
 * Banked marks first, live marks next, depth last — exactly the order {@link judge} compares
 * them in. The weights are chosen only so that no amount of a lower term can outweigh one unit
 * of the one above it: at most twenty nuts can be live at once, so 20 x 192 = 3840 cannot reach
 * one banked nut at 4096, and depth tops out at 80 against one live nut at 192. Nothing else is
 * in the evaluation, so the bot is playing for the thing the match is decided on rather than
 * for a proxy somebody tuned.
 */
export const BANK_WEIGHT = 4096;
export const LIVE_WEIGHT = 192;
export const DEPTH_WEIGHT = 1;

const searchSlots = new Array<number>(SLOT_COUNT).fill(EMPTY);
const searchMarks = new Array<number>(SLOT_COUNT).fill(UNMARKED);
const searchHeight = new Array<number>(BOLT_COUNT).fill(0);
const searchLocked = new Array<boolean>(BOLT_COUNT).fill(false);
let searchP1Score = 0;
let searchP2Score = 0;
/** Filled by {@link measureRack}; read by the evaluation without walking the rack twice. */
let measuredP1Live = 0;
let measuredP2Live = 0;
let measuredP1Depth = 0;
let measuredP2Depth = 0;
let searchP1Moves = 0;
let searchP2Moves = 0;
let searchTurnMoves = 1;
let searchLockedCount = 0;
let searchSeat: SeatId = 'p1';

/** One slot per possible move per ply, so generating moves at a node allocates nothing. */
const MAX_DEPTH = 6;
const moveStack = new Array<number>((MAX_DEPTH + 2) * MOVE_COUNT).fill(0);
/** What a move changed that cannot be recomputed on the way back up, one entry a ply. */
const undoMark = new Array<number>(MAX_DEPTH + 2).fill(UNMARKED);
const undoLocked = new Array<boolean>(MAX_DEPTH + 2).fill(false);
const undoP1Bank = new Array<number>(MAX_DEPTH + 2).fill(0);
const undoP2Bank = new Array<number>(MAX_DEPTH + 2).fill(0);
/** Scratch for the blunder draw. */
const blunderMoves = new Array<number>(MOVE_COUNT).fill(0);

const WIN_SCORE = 1_000_000;
const SCORE_FLOOR = -(WIN_SCORE + 1);

/** Both seats' live and depth counts on the search rack, in one walk. */
function measureRack(): void {
  let p1 = 0;
  let p2 = 0;
  let d1 = 0;
  let d2 = 0;
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
    const tall = heightAt(searchHeight, bolt);
    if (tall < SORTED_MIN) continue;
    if (!isPureIn(searchSlots, searchHeight, bolt)) continue;
    const base = bolt * BOLT_CAPACITY;
    for (let level = 0; level < tall; level += 1) {
      const mark = searchMarks[base + level];
      if (mark === MARK_P1) {
        p1 += 1;
        d1 += tall;
      } else if (mark === MARK_P2) {
        p2 += 1;
        d2 += tall;
      }
    }
  }
  measuredP1Live = p1;
  measuredP2Live = p2;
  measuredP1Depth = d1;
  measuredP2Depth = d2;
}

/**
 * The evaluation, from seat one's point of view.
 *
 * Exactly antisymmetric — `staticScore('p1') === -staticScore('p2')` — which is what lets the
 * search be a plain negamax with no side-to-move corrections anywhere in it.
 */
function staticScore(seat: SeatId): number {
  const forP1 =
    BANK_WEIGHT * (searchP1Score - searchP2Score) +
    LIVE_WEIGHT * (measuredP1Live - measuredP2Live) +
    DEPTH_WEIGHT * (measuredP1Depth - measuredP2Depth);
  return seat === 'p1' ? forP1 : -forP1;
}

function searchMovesLeft(seat: SeatId): number {
  return seat === 'p1' ? searchP1Moves : searchP2Moves;
}

function spendSearchMove(seat: SeatId, delta: number): void {
  if (seat === 'p1') searchP1Moves += delta;
  else searchP2Moves += delta;
}

/**
 * Who moves next once `toMove` has just moved.
 *
 * The same seat continues while its turn has moves left, so a multi-move turn is searched as
 * one plan rather than as two halves handed to different players.
 */
function advanceSearchTurn(toMove: SeatId): SeatId {
  if (searchTurnMoves > 0 && searchMovesLeft(toMove) > 0) return toMove;
  const next = otherSeat(toMove);
  const taker = searchMovesLeft(next) > 0 ? next : toMove;
  searchTurnMoves = turnLengthFor(searchMovesLeft(taker));
  return taker;
}

/**
 * The two O(1) ways a searched position is finished.
 *
 * The third — a rack with no legal move on it — is deliberately not tested here: the move
 * generator runs immediately below and a count of zero is answered with the same static
 * score, so asking twice would double the cost of every interior node to learn nothing.
 */
function searchOver(): boolean {
  if (searchLockedCount >= KINDS) return true;
  return searchP1Moves <= 0 && searchP2Moves <= 0;
}

/**
 * Negamax with an alpha-beta window, scored from the point of view of `toMove`.
 *
 * The window only ever prunes branches whose value cannot change the choice made above them,
 * so the answer is the one an exhaustive search of the same depth gives.
 */
function search(
  toMove: SeatId,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  budget: SearchBudget,
): number {
  // Charged on every node, leaves included: leaves are the overwhelming majority of the work,
  // and charging only internal nodes puts the ceiling above the thing it limits.
  const funded = budget.spend();
  if (searchOver()) return staticScore(toMove);
  if (!funded || depth <= 0) return staticScore(toMove);

  const base = ply * MOVE_COUNT;
  const count = movesInto(searchSlots, searchHeight, searchLocked, moveStack, base, true);
  if (count === 0) return staticScore(toMove);

  let best = SCORE_FLOOR;
  let lower = alpha;
  for (let i = 0; i < count; i += 1) {
    const move = moveStack[base + i] ?? NO_MOVE;
    doSearchMove(move, ply);
    spendSearchMove(toMove, -1);
    searchTurnMoves -= 1;
    const heldTurn = searchTurnMoves;
    const next = advanceSearchTurn(toMove);
    const score =
      next === toMove
        ? search(toMove, depth - 1, lower, beta, ply + 1, budget)
        : -search(next, depth - 1, -beta, -lower, ply + 1, budget);
    searchTurnMoves = heldTurn + 1;
    spendSearchMove(toMove, 1);
    undoSearchMove(move, ply);

    if (score > best) best = score;
    if (best > lower) lower = best;
    if (lower >= beta) break;
  }
  return best;
}

/**
 * Play a move on the search rack, remembering at `ply` everything the way back up will need.
 *
 * Mirrors {@link applyMove} exactly: carry the mark, lock, bank. A search that banked
 * differently from the match would be playing a different game from the one it is scored on.
 */
function doSearchMove(move: number, ply: number): void {
  const from = fromOf(move);
  const to = toOf(move);
  const fromIndex = from * BOLT_CAPACITY + heightAt(searchHeight, from) - 1;
  const kind = slotAt(searchSlots, fromIndex);
  undoMark[ply] = searchMarks[fromIndex] ?? UNMARKED;
  undoP1Bank[ply] = searchP1Score;
  undoP2Bank[ply] = searchP2Score;
  searchSlots[fromIndex] = EMPTY;
  searchMarks[fromIndex] = UNMARKED;
  searchHeight[from] = heightAt(searchHeight, from) - 1;

  const level = heightAt(searchHeight, to);
  const toIndex = to * BOLT_CAPACITY + level;
  searchSlots[toIndex] = kind;
  searchMarks[toIndex] = undoMark[ply] ?? UNMARKED;
  searchHeight[to] = level + 1;

  const locking = level + 1 === BOLT_CAPACITY && isPureIn(searchSlots, searchHeight, to);
  undoLocked[ply] = locking;
  if (locking) {
    searchLocked[to] = true;
    searchLockedCount += 1;
  }

  measureRack();
  if (measuredP1Live > searchP1Score) searchP1Score = measuredP1Live;
  if (measuredP2Live > searchP2Score) searchP2Score = measuredP2Live;
}

function undoSearchMove(move: number, ply: number): void {
  const from = fromOf(move);
  const to = toOf(move);
  if (undoLocked[ply] === true) {
    searchLocked[to] = false;
    searchLockedCount -= 1;
  }
  searchP1Score = undoP1Bank[ply] ?? 0;
  searchP2Score = undoP2Bank[ply] ?? 0;

  const level = heightAt(searchHeight, to) - 1;
  const toIndex = to * BOLT_CAPACITY + level;
  const kind = slotAt(searchSlots, toIndex);
  searchSlots[toIndex] = EMPTY;
  searchMarks[toIndex] = UNMARKED;
  searchHeight[to] = level;

  const back = heightAt(searchHeight, from);
  searchSlots[from * BOLT_CAPACITY + back] = kind;
  searchMarks[from * BOLT_CAPACITY + back] = undoMark[ply] ?? UNMARKED;
  searchHeight[from] = back + 1;
}

/**
 * The budget and the sweep are module-level so that a bot's move costs no allocation at all,
 * not even the closure `deepen` is handed.
 */
const searchBudget = new SearchBudget(SEARCH_NODES);

/** One full sweep at a fixed depth, or null when the budget ran out part-way through. */
const sweep = (depth: number): number | null => {
  const count = movesInto(searchSlots, searchHeight, searchLocked, moveStack, 0, true);
  const rootTurn = searchTurnMoves;
  let bestMove = NO_MOVE;
  let bestScore = SCORE_FLOOR;

  for (let i = 0; i < count; i += 1) {
    const move = moveStack[i] ?? NO_MOVE;
    doSearchMove(move, 0);
    spendSearchMove(searchSeat, -1);
    searchTurnMoves -= 1;
    const next = advanceSearchTurn(searchSeat);
    const score =
      next === searchSeat
        ? search(searchSeat, depth - 1, bestScore, Infinity, 1, searchBudget)
        : -search(next, depth - 1, -Infinity, -bestScore, 1, searchBudget);
    searchTurnMoves = rootTurn;
    spendSearchMove(searchSeat, 1);
    undoSearchMove(move, 0);

    if (searchBudget.exhausted) return null;
    if (bestMove === NO_MOVE || score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
};

/** Nodes the last {@link botMove} spent. For the cost tests and for SPEC.md. */
export function lastSearchNodes(): number {
  return searchBudget.spent;
}

/**
 * The move `match.active` should play, or {@link NO_MOVE} on a rack with nothing legal on it.
 *
 * With the tier's blunder chance a uniformly random legal move is played instead of the
 * searched one; otherwise the position is searched to the tier's depth under a deterministic
 * node budget, so the same rack costs the same on a phone and on a laptop and returns the
 * same move. Ties break towards the lowest packed move, so the same rack and the same
 * generator state always give the same answer.
 */
export function botMove(match: Readonly<Match>, rng: Rng, difficulty: BotDifficulty): number {
  const count = legalMovesInto(match, blunderMoves, 0);
  // Both draws happen here, unconditionally and before anything branches.
  const blunder = rng.bool(BLUNDER_CHANCE[difficulty]);
  const ordinal = rng.int(0, count > 0 ? count : 1);
  searchBudget.reset();
  if (count === 0) return NO_MOVE;
  if (blunder) return blunderMoves[ordinal] ?? NO_MOVE;

  for (let index = 0; index < SLOT_COUNT; index += 1) {
    searchSlots[index] = slotAt(match.slots, index);
    searchMarks[index] = match.marks[index] ?? UNMARKED;
  }
  for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
    searchHeight[bolt] = heightAt(match.height, bolt);
    searchLocked[bolt] = match.locked[bolt] === true;
  }
  searchP1Score = match.p1Score;
  searchP2Score = match.p2Score;
  searchP1Moves = match.p1Moves;
  searchP2Moves = match.p2Moves;
  searchTurnMoves = match.turnMoves;
  searchLockedCount = match.lockedCount;
  searchSeat = match.active;

  const depth = Math.min(SEARCH_DEPTH[difficulty], MAX_DEPTH);
  const found = deepen(searchBudget, depth, sweep);
  return found >= 0 ? found : (blunderMoves[0] ?? NO_MOVE);
}

/**
 * A generator per seat, derived once from the match seed.
 *
 * A shared stream is unbiased in a strict-alternation turn game *as long as* every turn costs
 * the same number of draws — and that is a property a later change breaks silently. Two
 * streams make the independence structural: seat two plays the identical moves against `easy`
 * and against `hard`, which is asserted in the tests.
 */
export function createBotRngs(rng: Rng): Readonly<Record<SeatId, Rng>> {
  return { p1: new Rng(rng.next() | 0), p2: new Rng(rng.next() | 0) };
}
