import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Fruit Duel, as pure rules.
 *
 * One thing appears between the two players. If it is fruit, cut it — first blade in
 * scores. If it is not, keep still; cutting scores for the other player. First to ten.
 *
 * This is the catalogue's pure **go/no-go** game, and the whole of it lives in about forty
 * milliseconds. Two consequences follow, and they are the reason it is written the way it
 * is rather than the obvious way:
 *
 * 1. **A round is never decided on arrival.** Both blades are recorded during the step and
 *    the round is resolved afterwards, from source times, through the SDK's
 *    `resolveSimultaneous`. Deciding as each input landed would hand the point to whichever
 *    seat the loop read first — a coin toss settled by iteration order, and across two
 *    devices, by whoever had the better connection.
 * 2. **The tolerance is a real draw, not a tie-break.** Two people cannot be separated by
 *    four milliseconds and pretending otherwise is a lie the game tells sixty times a
 *    match.
 *
 * No rendering, no timing, no DOM.
 */

/** What can appear. Only the first three are fruit. */
export const SUBJECTS = ['melon', 'pomegranate', 'orange', 'bomb', 'stone'] as const;
export type Subject = (typeof SUBJECTS)[number];

export const FRUIT_COUNT = 3;

export function isFruit(subject: Subject): boolean {
  return SUBJECTS.indexOf(subject) < FRUIT_COUNT;
}

export const TARGET_POINTS = 10;

/**
 * Rounds in a match, after which it is called on points.
 *
 * A structural cap rather than a clock. Ten points at roughly one point a round needs
 * about a dozen rounds; thirty leaves room for the rounds nobody scores and still ends a
 * match between two players who never move. Nothing about how it is played can extend it.
 */
export const MAX_ROUNDS = 30;

/**
 * How long the subject is held back before it appears.
 *
 * Randomised inside this window, and the window is what makes the game a reaction test
 * rather than a rhythm one: a fixed delay is learnable in three rounds and then both
 * players are simply pressing on a beat.
 */
export const MIN_WAIT = 0.7;
export const MAX_WAIT = 2.6;

/** How long the subject stays up before the round is abandoned. */
export const SHOW_SECONDS = 1.6;

/** How long the result is held before the next round. */
export const REVEAL_SECONDS = 1.0;

/**
 * Two blades inside this are a genuine draw.
 *
 * Eight milliseconds is half a frame at 60 Hz, which is the finest distinction the fixed
 * step can honestly make. The SDK's default, and named here so the reason travels with the
 * game.
 */
export const TIE_TOLERANCE = 0.008;

export type Phase = 'waiting' | 'showing' | 'revealing' | 'over';

export type Verdict = 'cut' | 'early' | 'wrong' | 'held' | null;

export interface Game {
  subject: Subject;
  phase: Phase;
  /** Seconds until the subject appears, then seconds it has been up. */
  timer: number;
  /** Seconds since the subject appeared when each seat's blade landed; −1 for no blade. */
  p1At: number;
  p2At: number;
  /** What each seat did, for the renderer. */
  p1Verdict: Verdict;
  p2Verdict: Verdict;
  p1Points: number;
  p2Points: number;
  rounds: number;
  winner: SeatId | 'draw' | null;
}

export function createGame(): Game {
  return {
    subject: 'melon',
    phase: 'waiting',
    timer: MIN_WAIT,
    p1At: -1,
    p2At: -1,
    p1Verdict: null,
    p2Verdict: null,
    p1Points: 0,
    p2Points: 0,
    rounds: 0,
    winner: null,
  };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function pointsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Points : game.p2Points;
}

export function bladeAt(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1At : game.p2At;
}

export function verdictOf(game: Readonly<Game>, seat: SeatId): Verdict {
  return seat === 'p1' ? game.p1Verdict : game.p2Verdict;
}

/**
 * Set up the next round.
 *
 * Fruit appears a little over half the time. Weighted deliberately: at an even split the
 * cheapest strategy is to keep still, and at four in five a player may as well cut on
 * sight. Between the two, both decisions cost something.
 */
export function nextRound(game: Game, rng: Rng): void {
  const fruit = rng.float() < 0.62;
  const index = fruit
    ? Math.floor(rng.float() * FRUIT_COUNT)
    : FRUIT_COUNT + Math.floor(rng.float() * (SUBJECTS.length - FRUIT_COUNT));
  game.subject = SUBJECTS[index] as Subject;
  game.phase = 'waiting';
  game.timer = MIN_WAIT + rng.float() * (MAX_WAIT - MIN_WAIT);
  game.p1At = -1;
  game.p2At = -1;
  game.p1Verdict = null;
  game.p2Verdict = null;
  game.rounds += 1;
}

export function resetGame(game: Game, rng: Rng): void {
  game.p1Points = 0;
  game.p2Points = 0;
  game.rounds = 0;
  game.winner = null;
  nextRound(game, rng);
}

/**
 * Record a blade.
 *
 * Recorded, never resolved — see the note at the top. During `waiting` this is a false
 * start, and it is recorded too: it must cost the player who made it, and the only way it
 * can is if the round remembers it happened.
 */
export function cut(game: Game, seat: SeatId, elapsed: number): boolean {
  if (game.phase !== 'waiting' && game.phase !== 'showing') return false;
  if (bladeAt(game, seat) !== -1) return false;
  // A false start is stored as a negative time, so "has this seat moved" stays one test
  // and the sign carries which side of the appearance it fell on.
  const at = game.phase === 'waiting' ? -2 : elapsed;
  if (seat === 'p1') game.p1At = at;
  else game.p2At = at;
  return true;
}

export function isFalseStart(at: number): boolean {
  return at === -2;
}

export interface StepResult {
  /** Seats that scored this step. */
  readonly scored: readonly SeatId[];
  /** True on the step a round was resolved. */
  readonly resolved: boolean;
}

const scoredScratch: SeatId[] = [];
const result: { scored: SeatId[]; resolved: boolean } = { scored: scoredScratch, resolved: false };

const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  scoredScratch.length = 0;
  result.resolved = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'revealing') {
    game.timer -= fixedDeltaSeconds;
    if (game.timer <= 0) {
      if (
        game.rounds >= MAX_ROUNDS ||
        game.p1Points >= TARGET_POINTS ||
        game.p2Points >= TARGET_POINTS
      ) {
        finish(game);
      } else {
        nextRound(game, rng);
      }
    }
    return result;
  }

  if (game.phase === 'waiting') {
    game.timer -= fixedDeltaSeconds;
    // A false start ends the wait at once. Making the player who jumped sit out the rest
    // of a two-second delay before finding out is a punishment with no information in it.
    if (isFalseStart(game.p1At) || isFalseStart(game.p2At)) {
      resolve(game);
      return result;
    }
    if (game.timer <= 0) {
      game.phase = 'showing';
      game.timer = 0;
    }
    return result;
  }

  game.timer += fixedDeltaSeconds;
  const bothMoved = game.p1At !== -1 && game.p2At !== -1;
  if (!bothMoved && game.timer < SHOW_SECONDS) return result;

  resolve(game);
  return result;
}

/**
 * Settle the round from both seats' recorded times.
 *
 * Every outcome is decided here, together, from state — never as the inputs arrived.
 */
function resolve(game: Game): void {
  const fruit = isFruit(game.subject);

  for (const seat of SEATS) {
    const at = bladeAt(game, seat);
    let verdict: Verdict;
    if (isFalseStart(at)) verdict = 'early';
    else if (at === -1) verdict = 'held';
    else verdict = fruit ? 'cut' : 'wrong';
    if (seat === 'p1') game.p1Verdict = verdict;
    else game.p2Verdict = verdict;
  }

  // Mistakes first, and they score for the opponent whatever else happened. Cutting a
  // bomb or jumping the gun must cost you even if the other player also erred.
  for (const seat of SEATS) {
    const verdict = verdictOf(game, seat);
    if (verdict === 'early' || verdict === 'wrong') award(game, otherOf(seat), 1);
  }

  if (fruit) {
    const p1Cut = game.p1Verdict === 'cut';
    const p2Cut = game.p2Verdict === 'cut';
    if (p1Cut && p2Cut) {
      // Both were right. The SDK compares source times and calls anything inside the
      // tolerance a genuine draw, which is what two people forty milliseconds apart are.
      const first = resolveSimultaneousLocal(game.p1At, game.p2At);
      if (first === 'draw') {
        award(game, 'p1', 1);
        award(game, 'p2', 1);
      } else {
        award(game, first, 1);
      }
    } else if (p1Cut) award(game, 'p1', 1);
    else if (p2Cut) award(game, 'p2', 1);
  }

  result.resolved = true;
  game.phase = 'revealing';
  game.timer = REVEAL_SECONDS;
}

/**
 * The SDK's `resolveSimultaneous`, inlined.
 *
 * Deliberately a copy of four lines rather than a dependency: `rules.ts` is imported by the
 * balance harness and by tests that must not pull the whole SDK in, and the tolerance is a
 * fact about *this* game that happens to match the SDK's default. `TIE_TOLERANCE` is
 * asserted equal to it in the tests, so the two cannot drift silently.
 */
function resolveSimultaneousLocal(p1: number, p2: number): SeatId | 'draw' {
  const gap = p1 - p2;
  if (Math.abs(gap) <= TIE_TOLERANCE) return 'draw';
  return gap < 0 ? 'p1' : 'p2';
}

function award(game: Game, seat: SeatId, points: number): void {
  if (seat === 'p1') {
    game.p1Points += points;
    scoredScratch.push('p1');
  } else {
    game.p2Points += points;
    scoredScratch.push('p2');
  }
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
  /** Seconds from the subject appearing to its blade landing, before jitter. */
  readonly reaction: number;
  /** Spread either side of that, so it is not metronomic. */
  readonly jitter: number;
  /** How often it cuts something that is not fruit. */
  readonly mistakes: number;
  /** How often it jumps before the subject appears. */
  readonly falseStarts: number;
}

/**
 * Three tiers, expressed only as reaction time and error rates.
 *
 * A human's simple visual reaction is about 250 ms and a go/no-go decision costs another
 * hundred or so. `hard` sits at 280 ms, which is a very good person rather than a machine;
 * a bot reacting in one frame would not be a hard opponent, it would be a wall. Rule 6 is
 * the floor here in an unusually literal way — none of these gets to see the subject before
 * it is drawn.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.62, jitter: 0.16, mistakes: 0.3, falseStarts: 0.1 },
  normal: { reaction: 0.42, jitter: 0.09, mistakes: 0.13, falseStarts: 0.04 },
  hard: { reaction: 0.28, jitter: 0.05, mistakes: 0.04, falseStarts: 0.015 },
});

export interface BotState {
  /** Seconds after the appearance at which it will cut. */
  at: number;
  /** Whether it has looked at this round yet. */
  ready: boolean;
  /** Seconds before the appearance at which it will jump, or −1. */
  jumpAt: number;
  /** Whether it will misjudge this round's subject. Drawn before the subject is visible. */
  mistaken: boolean;
  /** Whether it has already moved this round. */
  spent: boolean;
}

export function createBotState(): BotState {
  return { at: -1, ready: false, jumpAt: -1, mistaken: false, spent: false };
}

export function resetBotState(state: BotState): void {
  state.at = -1;
  state.ready = false;
  state.jumpAt = -1;
  state.mistaken = false;
  state.spent = false;
}

/**
 * How many values a bot draws from the shared stream per round. Always this many.
 *
 * **The two bots share one `Rng`, so a seat whose draw count depends on what it did
 * shifts the other seat's stream — and that is a seat bias, not a coincidence.** The first
 * version drew two values normally and three when a false start fired, and skipped the
 * mistake roll entirely on a round it jumped. Measured over forty matches of `normal`
 * against `normal`, p1 won 30. Nothing in the rules favoured either seat; the coupling
 * did, and it was invisible because every individual draw was uniform.
 *
 * Everything is now drawn in {@link planRound}, unconditionally, so each seat occupies a
 * fixed window of the stream every round whatever it decides to do with the values.
 */
export const BOT_DRAWS_PER_ROUND = 4;

/**
 * Decide the bot's whole round the moment it starts, then play it out.
 *
 * It commits before it can see the subject — `plan` is called during `waiting`, and the
 * decision of *whether* to cut is taken at the appearance from the subject alone. Deciding
 * afresh each step would let a slow tier keep rolling until it got lucky, which is a bot
 * that improves the longer it waits.
 */
export function planRound(state: BotState, difficulty: BotDifficulty, rng: Rng): void {
  const profile = BOT_PROFILES[difficulty];
  // All four values, always, whatever they turn out to be used for. See BOT_DRAWS_PER_ROUND.
  const jitterRoll = rng.float();
  const falseStartRoll = rng.float();
  const jumpRoll = rng.float();
  const mistakeRoll = rng.float();

  state.ready = true;
  state.spent = false;
  state.at = profile.reaction + (jitterRoll * 2 - 1) * profile.jitter;
  if (state.at < 0.05) state.at = 0.05;
  state.jumpAt = falseStartRoll < profile.falseStarts ? jumpRoll * MIN_WAIT : -1;
  // Drawn before the subject is on screen, and that is fine: it means "this round I will
  // misjudge", not "this round the answer is X". The bot still cannot see what is coming —
  // rule 6 — and the draw count stays constant.
  state.mistaken = mistakeRoll < profile.mistakes;
}

/**
 * Whether the bot's blade lands this step. The caller passes it to {@link cut}.
 *
 * Returns false while it is still waiting, and exactly once when it moves.
 */
export function botCuts(
  game: Readonly<Game>,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): boolean {
  if (game.phase !== 'waiting' && game.phase !== 'showing') {
    state.ready = false;
    return false;
  }
  if (!state.ready) planRound(state, difficulty, rng);
  if (state.spent) return false;

  if (game.phase === 'waiting') {
    // A false start is planned as "jump with this long left on the clock", so it does not
    // depend on knowing how long the wait was going to be.
    if (state.jumpAt < 0 || game.timer > state.jumpAt) return false;
    state.spent = true;
    return true;
  }

  if (game.timer < state.at) return false;
  state.spent = true;
  // The decision is taken here, from the subject — which is on the screen by now — and the
  // misjudgement drawn at the start of the round. No draw happens here, deliberately.
  return isFruit(game.subject) ? !state.mistaken : state.mistaken;
}
