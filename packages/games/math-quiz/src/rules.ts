import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Math Duel, as pure rules.
 *
 * One sum, shown to both players at the same instant, with four answers arranged in a
 * diamond. Be first with the right one and you score; give a wrong one and your opponent
 * scores. Fifteen sums, most points wins.
 *
 * **This is the only genuinely symmetric game in the catalogue, and it is symmetric by
 * construction rather than by tuning.** Both seats see the identical question on the
 * identical step and neither can act before the other; there is no board that fills, no
 * turn order, and no shared resource one of them touches first. Every other game here
 * needed a measurement to find out whether it was fair. This one cannot be unfair.
 *
 * No rendering, no timing, no DOM.
 */

/** Answers per question, and the four directions they map onto. */
export const ANSWER_COUNT = 4;

/** Where the four answers sit, and therefore which key names which. */
export const ANSWER_DIRECTIONS = ['up', 'left', 'down', 'right'] as const;
export type AnswerDirection = (typeof ANSWER_DIRECTIONS)[number];

export const QUESTIONS = 15;

/**
 * Seconds a question stays up before it is abandoned.
 *
 * Nothing else would end a question neither player answers, and a match is fifteen of
 * them: without this a single unanswered sum is a match that never finishes. It is also
 * what makes the round length honest — fifteen questions at eight seconds is the worst
 * case, and a played match is nearer a third of that.
 */
export const QUESTION_SECONDS = 8;

/** Seconds the answer is shown before the next question. */
export const REVEAL_SECONDS = 1.1;

export type Phase = 'asking' | 'revealing' | 'over';

export type Operation = '+' | '-' | '×';

export interface Question {
  readonly left: number;
  readonly right: number;
  readonly operation: Operation;
  /** The four answers, in {@link ANSWER_DIRECTIONS} order. */
  readonly answers: number[];
  /** Index into `answers` of the true one. */
  correct: number;
}

export interface Game {
  readonly question: Question;
  /** Which answer each seat has committed to this question, or −1. */
  p1Answer: number;
  p2Answer: number;
  p1Points: number;
  p2Points: number;
  /** Questions asked so far, including the one on screen. */
  asked: number;
  phase: Phase;
  /** Seconds left on the question, or on the reveal. */
  timer: number;
  winner: SeatId | 'draw' | null;
}

function emptyQuestion(): Question {
  return { left: 0, right: 0, operation: '+', answers: [0, 0, 0, 0], correct: 0 };
}

export function createGame(): Game {
  return {
    question: emptyQuestion(),
    p1Answer: -1,
    p2Answer: -1,
    p1Points: 0,
    p2Points: 0,
    asked: 0,
    phase: 'asking',
    timer: QUESTION_SECONDS,
    winner: null,
  };
}

export function answerOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Answer : game.p2Answer;
}

export function pointsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Points : game.p2Points;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * How hard the sums get.
 *
 * They grow with the question number rather than with either player's score, so both
 * players always face the same difficulty — a ramp keyed to the leader would be a
 * handicap, and one keyed to the trailer would be a reward for being behind.
 */
export function operandCeiling(asked: number): number {
  return 9 + asked * 2;
}

/**
 * Build the next question.
 *
 * The wrong answers are near misses, not noise: a distractor thirty away from the truth is
 * discarded by a glance, and the question would be a reading test rather than an
 * arithmetic one.
 */
export function nextQuestion(game: Game, rng: Rng): void {
  const question = game.question as {
    left: number;
    right: number;
    operation: Operation;
    answers: number[];
    correct: number;
  };
  const ceiling = operandCeiling(game.asked);

  const roll = rng.float();
  const operation: Operation = roll < 0.45 ? '+' : roll < 0.85 ? '-' : '×';

  let left: number;
  let right: number;
  if (operation === '×') {
    // Kept small: a two-digit multiplication is a different game, and a slower one.
    left = 2 + Math.floor(rng.float() * 9);
    right = 2 + Math.floor(rng.float() * 9);
  } else {
    left = 1 + Math.floor(rng.float() * ceiling);
    right = 1 + Math.floor(rng.float() * ceiling);
    // Subtraction never goes below zero. Negative answers are a different skill and one
    // that half the audience for this has not met yet.
    if (operation === '-' && right > left) {
      const swap = left;
      left = right;
      right = swap;
    }
  }

  question.left = left;
  question.right = right;
  question.operation = operation;

  const truth = apply(left, right, operation);
  const answers = question.answers;
  answers[0] = truth;
  let filled = 1;
  for (let attempt = 0; attempt < 60 && filled < ANSWER_COUNT; attempt += 1) {
    const offset = 1 + Math.floor(rng.float() * 9);
    const candidate = rng.float() < 0.5 ? truth + offset : truth - offset;
    if (candidate < 0) continue;
    let clash = false;
    for (let i = 0; i < filled; i += 1) if (answers[i] === candidate) clash = true;
    if (clash) continue;
    answers[filled] = candidate;
    filled += 1;
  }
  // A bounded search can come up short on a tiny truth; fill the rest by walking upward,
  // which cannot collide and cannot loop.
  for (let value = truth + 1; filled < ANSWER_COUNT; value += 1) {
    let clash = false;
    for (let i = 0; i < filled; i += 1) if (answers[i] === value) clash = true;
    if (clash) continue;
    answers[filled] = value;
    filled += 1;
  }

  // Shuffle, and remember where the truth ended up.
  question.correct = 0;
  for (let i = ANSWER_COUNT - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.float() * (i + 1));
    const a = answers[i] as number;
    answers[i] = answers[j] as number;
    answers[j] = a;
    if (question.correct === i) question.correct = j;
    else if (question.correct === j) question.correct = i;
  }

  game.p1Answer = -1;
  game.p2Answer = -1;
  game.asked += 1;
  game.phase = 'asking';
  game.timer = QUESTION_SECONDS;
}

export function apply(left: number, right: number, operation: Operation): number {
  if (operation === '+') return left + right;
  if (operation === '-') return left - right;
  return left * right;
}

export function truthOf(game: Readonly<Game>): number {
  return game.question.answers[game.question.correct] as number;
}

export function resetGame(game: Game, rng: Rng): void {
  game.p1Points = 0;
  game.p2Points = 0;
  game.asked = 0;
  game.winner = null;
  nextQuestion(game, rng);
}

export interface StepResult {
  /** Seats that scored this step. */
  readonly scored: readonly SeatId[];
  /** True on the step a question was resolved. */
  readonly resolved: boolean;
}

const scoredScratch: SeatId[] = [];
const result: { scored: SeatId[]; resolved: boolean } = { scored: scoredScratch, resolved: false };

/**
 * Commit a seat to an answer.
 *
 * Recorded rather than resolved, so two players who answer on the same step are treated
 * as having answered together. Resolving the moment a key arrived would hand the point to
 * whichever seat the loop happened to read first — a coin toss decided by iteration order,
 * which is precisely the bug rule 9 and `resolveSimultaneous` exist to prevent.
 */
export function answer(game: Game, seat: SeatId, index: number): boolean {
  if (game.phase !== 'asking') return false;
  if (index < 0 || index >= ANSWER_COUNT) return false;
  if (answerOf(game, seat) !== -1) return false;
  if (seat === 'p1') game.p1Answer = index;
  else game.p2Answer = index;
  return true;
}

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  scoredScratch.length = 0;
  result.resolved = false;
  if (game.phase === 'over') return result;

  game.timer -= fixedDeltaSeconds;

  if (game.phase === 'revealing') {
    if (game.timer <= 0) {
      if (game.asked >= QUESTIONS) finish(game);
      else nextQuestion(game, rng);
    }
    return result;
  }

  const bothAnswered = game.p1Answer !== -1 && game.p2Answer !== -1;
  const someoneRight =
    game.p1Answer === game.question.correct || game.p2Answer === game.question.correct;
  if (!bothAnswered && !someoneRight && game.timer > 0) return result;

  // Both seats are scored together, from the state as it stands, so the order they are
  // read in cannot decide anything.
  for (const seat of SEATS) {
    const given = answerOf(game, seat);
    if (given === -1) continue;
    if (given === game.question.correct) {
      award(game, seat, 1);
      scoredScratch.push(seat);
    } else {
      // A wrong answer is a point to the other player, which is what makes guessing
      // expensive: four answers, so a guess is right one time in four and wrong three.
      award(game, otherOf(seat), 1);
      scoredScratch.push(otherOf(seat));
    }
  }

  result.resolved = true;
  game.phase = 'revealing';
  game.timer = REVEAL_SECONDS;
  return result;
}

const SEATS: readonly SeatId[] = ['p1', 'p2'];

function award(game: Game, seat: SeatId, points: number): void {
  if (seat === 'p1') game.p1Points += points;
  else game.p2Points += points;
}

function finish(game: Game): void {
  game.phase = 'over';
  game.winner =
    game.p1Points === game.p2Points ? 'draw' : game.p1Points > game.p2Points ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds it takes to read a sum before it can answer at all. */
  readonly readSeconds: number;
  /** Extra seconds per unit of the answer's size, so a bigger sum takes longer. */
  readonly perUnit: number;
  /** How often it commits to a wrong answer. */
  readonly mistakes: number;
}

/**
 * Three tiers, expressed as how long a sum takes them and how often they get it wrong.
 *
 * Never as a peek at the answer: every tier picks its answer from the four on screen, and
 * a mistaken one is a near miss from the same list a person would be choosing between.
 * The `perUnit` term is what makes the difficulty ramp bite the bot as well as the player
 * — a tier is not a constant reaction time but a rate of working.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { readSeconds: 1.9, perUnit: 0.035, mistakes: 0.3 },
  normal: { readSeconds: 1.15, perUnit: 0.018, mistakes: 0.13 },
  hard: { readSeconds: 0.62, perUnit: 0.008, mistakes: 0.04 },
});

export interface BotState {
  /** Seconds until it answers, or −1 when it has not looked at this question yet. */
  countdown: number;
  /** The answer it will give. */
  choice: number;
}

export function createBotState(): BotState {
  return { countdown: -1, choice: 0 };
}

export function resetBotState(state: BotState): void {
  state.countdown = -1;
  state.choice = 0;
}

/**
 * Drive a bot for one step. Returns the answer index it commits to now, or −1.
 *
 * It decides *what* it will answer and *when* the moment it first sees the question, and
 * then does not change its mind. Re-rolling every step would let a slow tier stumble onto
 * the right answer by repetition, which is a bot that gets better the longer it thinks and
 * therefore no difficulty setting at all.
 */
export function botAnswer(
  game: Readonly<Game>,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): number {
  if (game.phase !== 'asking') {
    state.countdown = -1;
    return -1;
  }

  if (state.countdown < 0) {
    const profile = BOT_PROFILES[difficulty];
    const size = Math.abs(truthOf(game));
    state.countdown = profile.readSeconds + size * profile.perUnit;
    if (rng.float() < profile.mistakes) {
      // A near miss from the four on the screen, never a fifth answer nobody offered.
      let wrong = Math.floor(rng.float() * (ANSWER_COUNT - 1));
      if (wrong >= game.question.correct) wrong += 1;
      state.choice = wrong;
    } else {
      state.choice = game.question.correct;
    }
    return -1;
  }

  state.countdown -= fixedDeltaSeconds;
  if (state.countdown > 0) return -1;
  state.countdown = Number.POSITIVE_INFINITY;
  return state.choice;
}
