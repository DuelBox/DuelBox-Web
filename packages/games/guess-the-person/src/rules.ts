import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';

/**
 * Guess Who, as pure rules. No rendering, no timing, no DOM.
 *
 * Two people sit at one device with a cast of thirty characters laid out between
 * them. Each seat is hunting one of them — the one the *other* seat is holding — and
 * narrows it down by asking yes/no questions about a single attribute value. Name it
 * before the other seat names theirs.
 *
 * ## The hidden information never has to be hidden
 *
 * The reference genre has each player pick a character in secret. On one shared screen
 * that is impossible: whichever way a player enters a choice, the person sitting opposite
 * is looking at the same glass. There is no pass-and-play blackout here to hide behind.
 *
 * So **the deal chooses, and neither secret is ever drawn**. Two characters are taken from
 * the seeded generator at the start of the match and live in `targetP1` / `targetP2`;
 * nobody types them, nobody sees them, and the simulation answers every question from them
 * truthfully. Nobody has to be trusted to answer honestly and nobody has to look away.
 *
 * What makes that sound rather than merely convenient is that **everything else is public
 * and can sit on the screen at once**. Seat one's board is its knowledge about the
 * character seat one is hunting; seat two's board is its knowledge about the character
 * *seat two* is hunting. The two boards are about different characters, so seat two
 * reading seat one's board learns only about the character seat two is not looking for.
 * Neither board leaks. That is why both fit on one grid, two pips to a tile, with nothing
 * to conceal — see `game.ts`.
 *
 * ## Termination is a potential function
 *
 * `liveCount` is the potential. A question is legal only when it splits the seat's live
 * set — some live candidate answers yes and some answers no — so an accepted question
 * strictly lowers it. Naming a character that is not the target strikes it out, which
 * lowers it by one. Naming the target ends that seat's search. The target is never struck
 * out, because every answer is truthful, so a seat at `liveCount === 1` is holding the
 * target and every question is illegal: it must name, and it must be right.
 *
 * Thirty down to one is at most twenty-nine actions, plus the naming turn: **no seat can
 * take more than thirty turns and no match can run past thirty rounds**, whatever anybody
 * does. Nothing here reads a clock.
 */

/**
 * How many values each attribute takes: **five outlines, three cores, two feet**.
 *
 * The unequal arities are the single most load-bearing number in this file, and they were
 * chosen by measurement rather than by taste. A cast of three attributes of three values
 * each — twenty-seven characters, nine questions — is a perfect hypercube, and on a
 * perfect hypercube *every legal question is exactly as good as every other one*: from the
 * whole cast each splits it nine against eighteen, and from any set reached by answering
 * one, each remaining question splits it three against six. Question choice is then not a
 * skill, it is a formality, and the bot's question knob measured dead flat across its
 * whole range — 51.6% down to 50.0% from perfect play to random play.
 *
 * Five, three and two makes the first question a real decision: the two-valued question
 * halves the cast, the three-valued one takes ten against twenty, and the five-valued one
 * six against twenty-four. That difference persists all the way down, and it is what a
 * person recognises from the reference genre — "nearly all of them have hats, so that is a
 * poor question to ask".
 *
 * Their product is the cast and their sum is the question set, and both have to land on
 * the board: 5 × 3 × 2 = 30 characters is three rows of ten, and 5 + 3 + 2 = 10 questions
 * is one more row of ten. The lattice is a rectangle with no holes in it, which is why a
 * keyboard plays this game with one `GridCursor` and no bespoke navigation.
 */
export const ARITY: readonly number[] = Object.freeze([5, 3, 2]);
export const ATTRIBUTES = ARITY.length;

function arity(attribute: number): number {
  return ARITY[attribute] ?? 1;
}

function scanUpTo(attribute: number, combine: (a: number, b: number) => number, seed: number) {
  let value = seed;
  for (let index = 0; index < attribute; index += 1) value = combine(value, arity(index));
  return value;
}

/** The whole cast: every combination of the three attributes, exactly once each. */
export const CAST = scanUpTo(ATTRIBUTES, (a, b) => a * b, 1);

/** One question per attribute value: "is it this one?" */
export const QUESTIONS = scanUpTo(ATTRIBUTES, (a, b) => a + b, 0);

/** The board lattice: three rows of cast, then one row of question chips. */
export const COLUMNS = 10;
export const CAST_ROWS = CAST / COLUMNS;
export const ROWS = CAST_ROWS + 1;
export const SLOTS = COLUMNS * ROWS;

/** Every character live, as a bit set. The whole cast fits in thirty bits. */
export const ALL_LIVE = (1 << CAST) - 1;

/**
 * The value a character carries for one attribute.
 *
 * A character *is* its digits in mixed radix, which is what makes the cast exactly
 * orthogonal: every attribute is independent of the other two, every combination exists
 * exactly once, and what a question is worth can be worked out rather than guessed at.
 */
export function valueOf(character: number, attribute: number): number {
  const stride = scanUpTo(attribute, (a, b) => a * b, 1);
  return Math.floor(character / stride) % arity(attribute);
}

/** The question that asks "is your character's `attribute` equal to `value`?" */
export function questionOf(attribute: number, value: number): number {
  return scanUpTo(attribute, (a, b) => a + b, 0) + value;
}

export function attributeOfQuestion(question: number): number {
  let left = question;
  for (let attribute = 0; attribute < ATTRIBUTES; attribute += 1) {
    if (left < arity(attribute)) return attribute;
    left -= arity(attribute);
  }
  return ATTRIBUTES - 1;
}

export function valueOfQuestion(question: number): number {
  const attribute = attributeOfQuestion(question);
  return question - scanUpTo(attribute, (a, b) => a + b, 0);
}

function buildMasks(): readonly number[] {
  const masks = new Array<number>(QUESTIONS).fill(0);
  for (let character = 0; character < CAST; character += 1) {
    for (let attribute = 0; attribute < ATTRIBUTES; attribute += 1) {
      const question = questionOf(attribute, valueOf(character, attribute));
      masks[question] = (masks[question] ?? 0) | (1 << character);
    }
  }
  return masks;
}

/** Which characters answer yes to each question. Ten bit sets, of six, ten or fifteen. */
const VALUE_MASK = buildMasks();

export function questionMask(question: number): number {
  return VALUE_MASK[question] ?? 0;
}

/** Population count of a 32-bit word. Used everywhere a candidate count is needed. */
export function countBits(bits: number): number {
  let value = bits - ((bits >> 1) & 0x55555555);
  value = (value & 0x33333333) + ((value >> 2) & 0x33333333);
  value = (value + (value >> 4)) & 0x0f0f0f0f;
  return Math.imul(value, 0x01010101) >> 24;
}

/** The `n`th set bit of `bits`, counting from the low end, or -1. */
export function nthSetBit(bits: number, n: number): number {
  let left = n;
  for (let index = 0; index < 32; index += 1) {
    if ((bits & (1 << index)) === 0) continue;
    if (left === 0) return index;
    left -= 1;
  }
  return -1;
}

/**
 * One seat's knowledge about the character it is hunting.
 *
 * A bit set rather than an array of booleans, because every operation the game needs —
 * eliminate, count, pick — is one word of arithmetic, so nothing on the per-step path
 * allocates and the "strictly fewer candidates" argument is a bit-count rather than a
 * loop somebody has to trust.
 */
export interface Board {
  /** Characters still consistent with every answer received. */
  live: number;
  liveCount: number;
}

export type LastKind = 'none' | 'ask' | 'name';

/**
 * How many deals a match is, and how many win it.
 *
 * **Three, and it is the difference between a coin toss and a ladder.** One deal is about
 * five rounds long and the number of questions a seat needs is dominated by which
 * character it was dealt: over a single deal the hardest tier takes only 66.7% off the
 * weakest, because a good player and a poor one are separated by roughly one question
 * against a deal-to-deal spread of three. Best of three moves that to 74.9% and takes the
 * draw rate at equal skill from 11.6% to 3.4%, for about 45 seconds of play. The numbers
 * for one, three and five deals are in SPEC.md.
 */
export const DEALS = 3;
export const DEALS_TO_WIN = 2;

export interface Match {
  /** Tile index to character. A seeded arrangement of the whole cast, redealt each deal. */
  readonly tiles: number[];
  /** The character seat one is hunting. Never drawn, never entered by anybody. */
  targetP1: number;
  /** The character seat two is hunting. */
  targetP2: number;
  readonly p1: Board;
  readonly p2: Board;
  /** Which seat opened deal one. Straight from `GameContext.openingSeat`. */
  setOpener: SeatId;
  /** Which seat opens every round of the deal in progress. Alternates between deals. */
  opener: SeatId;
  /** Whose turn it is. */
  seat: SeatId;
  /** 0 while the opener is to move this round, 1 while the other seat is. */
  half: number;
  /** One-based, and bounded by CAST. */
  round: number;
  /** Which deal is being played, from zero. */
  deal: number;
  dealsWonP1: number;
  dealsWonP2: number;
  /** Effort summed over every deal finished so far — the tie-break on level deals. */
  totalEffortP1: number;
  totalEffortP2: number;
  /** The round a seat named its target correctly, or -1. */
  solvedRoundP1: number;
  solvedRoundP2: number;
  /**
   * How many candidates that seat has weighed: the sum of its live count at the start of
   * every turn it has taken. Lower means it narrowed faster.
   */
  effortP1: number;
  effortP2: number;
  /** True once the deal in progress is finished. */
  over: boolean;
  /** True once the match is finished: somebody holds two deals, or three have been played. */
  setOver: boolean;
  /** The last action taken, for the renderer and for the reveal. */
  lastKind: LastKind;
  lastSeat: SeatId;
  lastQuestion: number;
  lastCharacter: number;
  /** Yes/no for a question; hit/miss for a name. */
  lastAnswer: boolean;
}

function createBoard(): Board {
  return { live: ALL_LIVE, liveCount: CAST };
}

export function createMatch(rng: Rng, opener: SeatId): Match {
  const match: Match = {
    tiles: new Array<number>(CAST).fill(0),
    targetP1: 0,
    targetP2: 0,
    p1: createBoard(),
    p2: createBoard(),
    setOpener: opener,
    opener,
    seat: opener,
    half: 0,
    round: 1,
    deal: 0,
    dealsWonP1: 0,
    dealsWonP2: 0,
    totalEffortP1: 0,
    totalEffortP2: 0,
    solvedRoundP1: -1,
    solvedRoundP2: -1,
    effortP1: 0,
    effortP2: 0,
    over: false,
    setOver: false,
    lastKind: 'none',
    lastSeat: opener,
    lastQuestion: -1,
    lastCharacter: -1,
    lastAnswer: false,
  };
  resetMatch(match, rng, opener);
  return match;
}

/** Start a fresh match at its first deal. `openingSeat` comes from the shell. */
export function resetMatch(match: Match, rng: Rng, openingSeat: SeatId): void {
  match.setOpener = openingSeat;
  match.deal = 0;
  match.dealsWonP1 = 0;
  match.dealsWonP2 = 0;
  match.totalEffortP1 = 0;
  match.totalEffortP2 = 0;
  match.setOver = false;
  deal(match, rng, openingSeat);
}

/** Which seat opens deal `index`. The opener alternates, and is worth nothing either way. */
export function openerOfDeal(setOpener: SeatId, index: number): SeatId {
  return index % 2 === 0 ? setOpener : otherSeat(setOpener);
}

/** Move on to the next deal. Only legal once the current one is finished. */
export function dealAgain(match: Match, rng: Rng): void {
  if (!match.over || match.setOver) return;
  match.deal += 1;
  deal(match, rng, openerOfDeal(match.setOpener, match.deal));
}

/**
 * Lay out one deal.
 *
 * **Every draw is keyed to a role, never to a seat.** The arrangement of the cast comes
 * first and belongs to the table; then one target for whoever opens and one for whoever
 * answers. Swap the opening seat and the identical seed produces the identical match with
 * the two seats exchanged — which is what makes seat one's share exactly a half rather
 * than approximately one, and is asserted board by board in the tests.
 */
function deal(match: Match, rng: Rng, opener: SeatId): void {
  for (let index = 0; index < CAST; index += 1) match.tiles[index] = index;
  rng.shuffle(match.tiles);

  const openerTarget = rng.int(0, CAST);
  const answererTarget = rng.int(0, CAST);
  if (opener === 'p1') {
    match.targetP1 = openerTarget;
    match.targetP2 = answererTarget;
  } else {
    match.targetP2 = openerTarget;
    match.targetP1 = answererTarget;
  }

  match.p1.live = ALL_LIVE;
  match.p1.liveCount = CAST;
  match.p2.live = ALL_LIVE;
  match.p2.liveCount = CAST;
  match.opener = opener;
  match.seat = opener;
  match.half = 0;
  match.round = 1;
  match.solvedRoundP1 = -1;
  match.solvedRoundP2 = -1;
  match.effortP1 = 0;
  match.effortP2 = 0;
  match.over = false;
  match.lastKind = 'none';
  match.lastSeat = opener;
  match.lastQuestion = -1;
  match.lastCharacter = -1;
  match.lastAnswer = false;
}

export function boardOf(match: Match, seat: SeatId): Board {
  return seat === 'p1' ? match.p1 : match.p2;
}

/** The character this seat is hunting. Only the simulation ever reads it. */
export function targetOf(match: Match, seat: SeatId): number {
  return seat === 'p1' ? match.targetP1 : match.targetP2;
}

export function characterAt(match: Match, tile: number): number {
  return match.tiles[tile] ?? 0;
}

export function tileOf(match: Match, character: number): number {
  return match.tiles.indexOf(character);
}

export function isLive(board: Readonly<Board>, character: number): boolean {
  return (board.live & (1 << character)) !== 0;
}

export function ruledOut(board: Readonly<Board>): number {
  return CAST - board.liveCount;
}

/**
 * Whether a question would actually divide this seat's remaining candidates.
 *
 * The whole termination argument rests on this one predicate: a question that every live
 * candidate answers the same way teaches nothing, costs a turn, and would let two seats
 * sit there asking it at each other for ever. It is refused rather than counted, exactly
 * as an out-of-range answer is refused in Sudoku, so the interface cannot be used to throw
 * a turn away by fumbling either.
 */
export function splitsQuestion(board: Readonly<Board>, question: number): boolean {
  const yes = countBits(board.live & questionMask(question));
  return yes > 0 && yes < board.liveCount;
}

/** Every question that still splits this board, as a nine-bit set. */
export function legalQuestions(board: Readonly<Board>): number {
  let legal = 0;
  for (let question = 0; question < QUESTIONS; question += 1) {
    if (splitsQuestion(board, question)) legal |= 1 << question;
  }
  return legal;
}

/**
 * End the turn, and the round with it.
 *
 * **A match ends only on a completed round.** Naming correctly does not stop the game
 * where it stands: the other seat still gets the turn it is owed, and may name correctly
 * too. That is what makes the opening seat worth nothing here — both seats always take
 * the same number of turns — and it is measured against the alternative in SPEC.md.
 */
export function endTurn(match: Match): void {
  if (match.half === 0) {
    match.half = 1;
    match.seat = otherSeat(match.seat);
    return;
  }
  match.half = 0;
  match.seat = match.opener;
  match.round += 1;
  if (match.solvedRoundP1 < 0 && match.solvedRoundP2 < 0) return;

  match.over = true;
  const winner = dealWinner(match);
  if (winner === 'p1') match.dealsWonP1 += 1;
  else if (winner === 'p2') match.dealsWonP2 += 1;
  match.totalEffortP1 += match.effortP1;
  match.totalEffortP2 += match.effortP2;
  match.setOver =
    match.dealsWonP1 >= DEALS_TO_WIN || match.dealsWonP2 >= DEALS_TO_WIN || match.deal + 1 >= DEALS;
}

/** Ask the question. Returns false, changing nothing, when it does not split. */
export function playQuestion(match: Match, question: number): boolean {
  if (match.over) return false;
  if (!Number.isInteger(question) || question < 0 || question >= QUESTIONS) return false;
  const seat = match.seat;
  const board = boardOf(match, seat);
  if (!splitsQuestion(board, question)) return false;

  spend(match, seat, board.liveCount);
  const mask = questionMask(question);
  const answer = (mask & (1 << targetOf(match, seat))) !== 0;
  board.live = (answer ? board.live & mask : board.live & ~mask) & ALL_LIVE;
  board.liveCount = countBits(board.live);

  match.lastKind = 'ask';
  match.lastSeat = seat;
  match.lastQuestion = question;
  match.lastAnswer = answer;
  endTurn(match);
  return true;
}

/** Name a character. Returns false, changing nothing, when it has already been struck out. */
export function playName(match: Match, character: number): boolean {
  if (match.over) return false;
  if (!Number.isInteger(character) || character < 0 || character >= CAST) return false;
  const seat = match.seat;
  const board = boardOf(match, seat);
  if (!isLive(board, character)) return false;

  const correct = character === targetOf(match, seat);
  match.lastKind = 'name';
  match.lastSeat = seat;
  match.lastCharacter = character;
  match.lastAnswer = correct;

  spend(match, seat, board.liveCount);
  if (correct) {
    if (seat === 'p1') match.solvedRoundP1 = match.round;
    else match.solvedRoundP2 = match.round;
  } else {
    board.live &= ~(1 << character);
    board.liveCount -= 1;
  }
  endTurn(match);
  return true;
}

/**
 * The most a seat's effort can come to.
 *
 * Its live count at the start of each of its turns is strictly decreasing and starts at
 * `CAST`, so the worst case is the triangular number — which is also the proof that
 * `standing` below can never go negative.
 */
export const MAX_EFFORT = (CAST * (CAST + 1)) / 2;

/**
 * How a seat stands when the match ends: nought if it never named its character, and
 * otherwise higher the fewer candidates it had to weigh on the way there.
 *
 * Both halves matter. A seat that solved always beats one that did not. Two seats that
 * both solved always did so in the **same round** — the completed-round rule guarantees
 * it, since neither seat can take a turn the other does not — so rounds cannot separate
 * them and something else has to.
 *
 * That something is **effort**: the number of candidates the seat still had in front of it
 * at the start of each of its turns, added up. It falls when a question is chosen well and
 * when a gamble comes off, and it rises when a name misses. Two seats that finish together
 * are separated by which of them narrowed faster, which is the whole of the skill this
 * game asks for.
 *
 * It is a function of each seat's own private history and of nothing on the board, so it
 * settles a mirrored position rather than mirroring with it — the failure Maze Paint and
 * Sudoku both hit with a tie-break written in board coordinates.
 */
export function standing(match: Match, seat: SeatId): number {
  const round = seat === 'p1' ? match.solvedRoundP1 : match.solvedRoundP2;
  if (round < 0) return 0;
  return 1 + MAX_EFFORT - effortOf(match, seat);
}

export function effortOf(match: Match, seat: SeatId): number {
  return seat === 'p1' ? match.effortP1 : match.effortP2;
}

function spend(match: Match, seat: SeatId, candidates: number): void {
  if (seat === 'p1') match.effortP1 += candidates;
  else match.effortP2 += candidates;
}

/** Who took the deal in progress, or null while it is still running. */
export function dealWinner(match: Match): SeatId | 'draw' | null {
  return resolve(
    { kind: 'highest-when-time-expires' },
    { p1: standing(match, 'p1'), p2: standing(match, 'p2') },
    { timeExpired: match.over },
  );
}

export function dealsWon(match: Match, seat: SeatId): number {
  return seat === 'p1' ? match.dealsWonP1 : match.dealsWonP2;
}

/** The most effort a whole match can cost one seat. */
const MAX_SET_EFFORT = MAX_EFFORT * DEALS;

/**
 * A seat's standing over the whole match: **deals won, with total effort underneath**.
 *
 * One number rather than two comparisons, so the match is settled by the SDK's `resolve`
 * exactly as a deal is, and a level match is a draw rather than something this file
 * decides for itself. Deals are the high digits and effort the low ones, which is the same
 * ordering written arithmetically: two deals always beats one, and only two seats level on
 * deals ever have their effort looked at.
 */
export function setStanding(match: Match, seat: SeatId): number {
  const effort = seat === 'p1' ? match.totalEffortP1 : match.totalEffortP2;
  return dealsWon(match, seat) * (MAX_SET_EFFORT + 1) + (MAX_SET_EFFORT - effort);
}

/** Who won the match, or null while it is still running. */
export function winnerOf(match: Match): SeatId | 'draw' | null {
  return resolve(
    { kind: 'highest-when-time-expires' },
    { p1: setStanding(match, 'p1'), p2: setStanding(match, 'p2') },
    { timeExpired: match.setOver },
  );
}

/* ------------------------------------------------------------------------ the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Chance of asking a legal question at random rather than the best one. */
  readonly blunder: number;
  /** Names rather than asks once this many candidates or fewer are left. */
  readonly gambleAt: number;
}

/**
 * The two things the tiers differ in, and the third that was written, swept and deleted.
 *
 * `blunder` is question quality: a beginner asks whatever question comes to hand and a
 * good player asks the one that narrows the board *most*, which on this cast means
 * preferring the fifteen-against-fifteen split to the six-against-twenty-four one.
 * `gambleAt` is nerve: when to stop asking and name. Both were swept alone over their
 * whole range against a fixed reference and both tables are in SPEC.md, including the
 * fact that `gambleAt` has its optimum in the middle rather than at an end.
 *
 * The deleted one was `chase`: a bump to `gambleAt` applied while the rival's board was no
 * wider than this seat's own — a player who can see they are behind and presses. It swept
 * monotone and looked like a third axis, and it is not one. Naming at five when behind and
 * three when ahead measured 62.6% against a fixed reference; naming at five always
 * measured 63.1%, and at two-when-ahead-five-when-behind 62.5%. **Conditioning the gamble
 * on the other seat is worth nothing over the flat threshold it implies**, so it was a
 * second spelling of `gambleAt` and it went — and with it the bot's last reason to look at
 * the other seat at all.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { blunder: 1, gambleAt: 1 },
  normal: { blunder: 0.45, gambleAt: 3 },
  hard: { blunder: 0, gambleAt: 6 },
});

export interface Action {
  kind: 'ask' | 'name';
  /** The question to ask, or -1. */
  question: number;
  /** The character to name, or -1. */
  character: number;
}

export function createAction(): Action {
  return { kind: 'ask', question: -1, character: -1 };
}

/**
 * What a bot does on its turn.
 *
 * **It is handed one board and nothing else, and that is the whole of rule 6 here.**
 * `board` is this seat's own live set — exactly the pips a person reads off the grid.
 * Neither target is a parameter and neither is the other seat's board, so no amount of
 * scrambling the hidden state can change what comes back; a test does exactly that and
 * asserts the identical move.
 *
 * That the other seat is not a parameter either is a *measurement* rather than a
 * principle — see {@link BOT_PROFILES} for the knob that read it and what happened to it.
 *
 * Allocates nothing: candidates are bit sets in local words.
 */
export function chooseAction(
  out: Action,
  board: Readonly<Board>,
  rng: Rng,
  difficulty: BotDifficulty,
): void {
  chooseWithProfile(out, board, rng, BOT_PROFILES[difficulty]);
}

/**
 * The same choice against an arbitrary profile.
 *
 * Separate from {@link chooseAction} so that the knob sweeps in SPEC.md move one number at
 * a time against the shipped code, rather than against a copy of it that can drift.
 */
export function chooseWithProfile(
  out: Action,
  board: Readonly<Board>,
  rng: Rng,
  profile: BotProfile,
): void {
  // Drawn first and unconditionally, so the roll cannot depend on the branch it decides.
  const roll = rng.float();
  const legal = legalQuestions(board);

  if (legal === 0 || board.liveCount <= profile.gambleAt) {
    out.kind = 'name';
    out.question = -1;
    out.character = nthSetBit(board.live, board.liveCount <= 1 ? 0 : rng.int(0, board.liveCount));
    return;
  }

  let pool = legal;
  if (roll >= profile.blunder) {
    // The question whose worse branch is smallest — the ordinary minimax a careful player
    // does in their head, over nine questions and at most twenty-seven candidates.
    let best = CAST + 1;
    let tied = 0;
    for (let question = 0; question < QUESTIONS; question += 1) {
      if ((legal & (1 << question)) === 0) continue;
      const yes = countBits(board.live & questionMask(question));
      const worst = Math.max(yes, board.liveCount - yes);
      if (worst < best) {
        best = worst;
        tied = 1 << question;
      } else if (worst === best) {
        tied |= 1 << question;
      }
    }
    pool = tied;
  }

  const count = countBits(pool);
  out.kind = 'ask';
  out.character = -1;
  out.question = nthSetBit(pool, count <= 1 ? 0 : rng.int(0, count));
}

/** Play a bot's chosen action. Returns false when the action was refused. */
export function applyAction(match: Match, action: Readonly<Action>): boolean {
  return action.kind === 'name'
    ? playName(match, action.character)
    : playQuestion(match, action.question);
}
