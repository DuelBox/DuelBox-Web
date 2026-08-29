import type { SeatId } from '@duelbox/engine';
import type { Rng } from '@duelbox/engine';

/**
 * Hammer Hit, as pure rules.
 *
 * A fairground striker at each end of the board. A needle sweeps across a dial and one
 * press swings the hammer: the nearer the needle was to the mark, the harder the puck is
 * driven up the tower, and the band it reaches is the score. Take it in turns; the higher
 * total wins.
 *
 * ## Three decisions carry the whole game
 *
 * **The press is the only input, and that is why this game was chosen.** A sweeping needle
 * stopped by a button is the one aiming idiom where a key and a thumb are *identical
 * instruments* — both are a single binary event with a timestamp, and neither can be aimed
 * more finely than the other. The fairness question that haunts every dragged or pointed
 * aim in this catalogue cannot arise here, so nothing in this file reads a pointer
 * position, a drag, or a second dial.
 *
 * **Waiting winds the hammer up.** The needle does not sweep once — it crosses the mark
 * once per traverse, and every time it turns round at an end the hammer winds one notch
 * further and the needle comes back faster. A later notch multiplies the hit and narrows
 * the moment. That is the whole decision, made with the same one button: *this* crossing
 * or the next one. Which notch is right depends on how accurately you can stop a needle,
 * and — because both totals are on the board — on whether you are ahead. **[ours]**
 *
 * **The needle does not move while the board is turning.** Every turn opens with a short
 * ready pause, longer than the half-turn the shell makes, so nobody's wind-up is running
 * while they cannot reach it. It is in the *rules* rather than in the renderer because a
 * bot must be refused the same moment a person is — rule 6 — and because a game that
 * gated its simulation on the flip would step two different matches in the two
 * presentations. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;
export const CENTRE_X = BOARD_WIDTH / 2;
export const CENTRE_Y = BOARD_HEIGHT / 2;

/**
 * Two strikers, placed so that the board is its own mirror through its centre.
 *
 * Every position here is `centre ± offset`, so the half-turn the board makes when the turn
 * changes carries p1's base onto p2's, p1's tower onto p2's, and p1's dial onto p2's. The
 * flip therefore moves nothing that matters, and neither seat ever reads a board the other
 * has not read — which is the whole reason a turn game may share one board at all.
 */
export const BASE_X_OFFSET = 135;
export const BASE_Y_OFFSET = 400;
/** Room between a seat's dial and the foot of its tower. */
export const TOWER_GAP = 120;
/** How far the puck can climb, from the foot of a tower to the bell. */
export const TOWER_LENGTH = 600;

/** Bands up the tower. The band the puck reaches is the score for that swing. */
export const BANDS = 10;

/** The needle sweeps between these, in radians either side of the mark. */
export const SWEEP = 1.05;

/**
 * What each notch of wind-up multiplies the hit by.
 *
 * Deliberately **not** a straight line: the steps shorten towards the top, so each further
 * notch pays less for the accuracy it costs and the best notch to stand on falls a step at
 * a time as the hand gets shakier. {@link chooseWind} is where that arithmetic is done, and
 * SPEC.md has the measured band of accuracy each notch is the answer to.
 */
export const WIND_FACTORS: readonly number[] = Object.freeze([1, 1.3, 1.55, 1.74, 2.0]);

/** Notches of wind-up in a turn. Reaching the end of the last one is a slip: no swing. */
export const MAX_WINDS = WIND_FACTORS.length;

export const NEEDLE_RATE_BASE = 1.95;
/** Every notch of wind-up brings the needle back this much faster. */
export const NEEDLE_RATE_GROWTH = 1.36;

/** Radians a second the needle travels, one entry per notch of wind-up. */
export const NEEDLE_RATES: readonly number[] = Object.freeze(
  WIND_FACTORS.map((_, wind) => NEEDLE_RATE_BASE * NEEDLE_RATE_GROWTH ** wind),
);

/**
 * The strength that puts the puck on the bell.
 *
 * Below the top notch's multiplier and above every other one, so a dead-centre hit rings
 * the bell only from the **last** notch and falls one band short from the notch below it.
 *
 * That is what stops the top of the ladder being a rung nobody would stand on, and it is
 * also why the ladder's best notch is skill-indexed rather than interior: a hand steady
 * enough to collect the ceiling belongs at the top, and a shakier one does not. Trying to
 * make the top notch a pure gamble for everybody is not possible while the bell lives
 * there — see SPEC.md.
 */
export const FULL_CLIMB = 1.78;

/** Rounds — a swing each — that must be played before a lead can end the match. */
export const MIN_ROUNDS = 4;
/**
 * Rounds in a match, after which it is called on totals.
 *
 * A structural cap: two players who never score would otherwise swing for ever, and no
 * clock would change that. Both numbers are even because the lead alternates, so a match
 * can only end with each seat having swung first exactly as often.
 */
export const MAX_ROUNDS = 8;

/**
 * Seconds a turn waits before the needle starts.
 *
 * Longer than {@link FLIP_SECONDS} on purpose. The shell turns the board half a circle to
 * face whoever is swinging and refuses a person's press for the whole of it; without this
 * pause the wind-up would be running through a window only a bot could press in.
 */
export const READY_SECONDS = 0.45;
/** The half-turn the board makes, which the game hands to its own `SeatFlip`. */
export const FLIP_SECONDS = 0.36;

/** Seconds the puck is held at its height before the board turns. */
export const SETTLE_SECONDS = 0.7;

/** Pull on the puck. Only sets how long the climb takes to watch; the score is decided
 * at the moment of the strike, never by where the stepped flight happened to stop. */
export const PUCK_GRAVITY = 2600;

export type Phase = 'ready' | 'winding' | 'striking' | 'settling' | 'over';

export interface Game {
  phase: Phase;
  active: SeatId;
  /**
   * Who swings first in round one. The shell's `context.openingSeat`, never a literal
   * `p1` — the SDK alternates it across the rounds of a best-of (#2466), and a game that
   * always opened with seat one would leave that rotation reaching nothing.
   */
  opener: SeatId;
  /** Seconds left of the ready pause. */
  ready: number;
  /** Where the needle is, in radians either side of the mark. */
  needle: number;
  /** Which way it is travelling. */
  needleRising: boolean;
  /** Notches of wind-up taken this turn, in 0..MAX_WINDS. */
  wind: number;
  /** How far up the tower the puck has climbed, in logical units. */
  puck: number;
  puckSpeed: number;
  puckTarget: number;
  /** Bands the last swing scored, whether it rang the bell, and whether it was a slip. */
  lastBands: number;
  lastBell: boolean;
  lastSlipped: boolean;
  p1Score: number;
  p2Score: number;
  /** Swings taken, so a match can only end on a completed round. */
  p1Swings: number;
  p2Swings: number;
  /** The round being played, counted from one. */
  rounds: number;
  settle: number;
  winner: SeatId | 'draw' | null;
}

export function createGame(): Game {
  const game: Game = {
    phase: 'ready',
    active: 'p1',
    opener: 'p1',
    ready: READY_SECONDS,
    needle: -SWEEP,
    needleRising: true,
    wind: 0,
    puck: 0,
    puckSpeed: 0,
    puckTarget: 0,
    lastBands: 0,
    lastBell: false,
    lastSlipped: false,
    p1Score: 0,
    p2Score: 0,
    p1Swings: 0,
    p2Swings: 0,
    rounds: 1,
    settle: 0,
    winner: null,
  };
  return game;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function scoreOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Score : game.p2Score;
}

/** Which way a seat's own half of the board lies: p1 below the centre, p2 above it. */
export function seatSign(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

export function baseXOf(seat: SeatId): number {
  return CENTRE_X - seatSign(seat) * BASE_X_OFFSET;
}

export function baseYOf(seat: SeatId): number {
  return CENTRE_Y + seatSign(seat) * BASE_Y_OFFSET;
}

/** Where a seat's tower starts. The puck climbs from here towards the far end. */
export function towerFootYOf(seat: SeatId): number {
  return baseYOf(seat) - seatSign(seat) * TOWER_GAP;
}

export function towerTopYOf(seat: SeatId): number {
  return towerFootYOf(seat) - seatSign(seat) * TOWER_LENGTH;
}

/**
 * Who swings first in a round.
 *
 * It alternates, and that is not decoration. Whoever swings second in a round has seen
 * what they have to beat, and in a game whose only decision is how far to push a gamble
 * that is worth something. Alternating hands each seat the informed swing exactly as
 * often; the match ending only on an even round keeps it that way to the last. **[ours]**
 */
export function leaderOf(round: number, opener: SeatId = 'p1'): SeatId {
  return round % 2 === 1 ? opener : otherOf(opener);
}

export function windFactor(wind: number): number {
  return WIND_FACTORS[Math.min(wind, MAX_WINDS - 1)] ?? 1;
}

export function needleRate(wind: number): number {
  return NEEDLE_RATES[Math.min(wind, MAX_WINDS - 1)] ?? NEEDLE_RATE_BASE;
}

/** How hard a hit landing at `needle` radians from the mark strikes, in 0..1. */
export function powerAt(needle: number): number {
  return Math.max(0, 1 - Math.abs(needle) / SWEEP);
}

/** The share of the tower a hit of this power at this notch drives the puck up, in 0..1. */
export function climbFor(power: number, wind: number): number {
  return Math.min(1, (power * windFactor(wind)) / FULL_CLIMB);
}

/** The band such a hit lands in, in 0..BANDS. `BANDS` is the bell. */
export function bandsFor(power: number, wind: number): number {
  return Math.min(BANDS, Math.floor(climbFor(power, wind) * BANDS));
}

export function resetGame(game: Game, opener: SeatId = 'p1'): void {
  game.opener = opener;
  game.p1Score = 0;
  game.p2Score = 0;
  game.p1Swings = 0;
  game.p2Swings = 0;
  game.rounds = 1;
  game.active = leaderOf(1, opener);
  game.winner = null;
  game.lastBands = 0;
  game.lastBell = false;
  game.lastSlipped = false;
  beginTurn(game);
}

function beginTurn(game: Game): void {
  game.phase = 'ready';
  game.ready = READY_SECONDS;
  game.needle = -SWEEP;
  game.needleRising = true;
  game.wind = 0;
  game.puck = 0;
  game.puckSpeed = 0;
  game.puckTarget = 0;
  game.settle = 0;
}

/**
 * Accept a press from the seat whose turn it is.
 *
 * One press per turn, and it ends the turn. Refused during the ready pause, which is what
 * makes the board's half-turn cost nobody a notch of wind-up. Returns whether the press
 * did anything, so a caller need not re-derive the phase.
 */
export function press(game: Game, seat: SeatId): boolean {
  if (seat !== game.active) return false;
  if (game.phase !== 'winding') return false;
  strike(game, false);
  return true;
}

/**
 * Swing the hammer and send the puck up the tower.
 *
 * The score is settled here, from the needle and the notch alone. The flight that follows
 * is only how long the answer takes to arrive — a stepped climb that stopped a unit short
 * of its apex must never cost a band.
 */
function strike(game: Game, slipped: boolean): void {
  const power = slipped ? 0 : powerAt(game.needle);
  const climb = climbFor(power, game.wind);
  game.lastSlipped = slipped;
  game.lastBell = !slipped && power * windFactor(game.wind) >= FULL_CLIMB;
  game.lastBands = bandsFor(power, game.wind);
  if (game.active === 'p1') {
    game.p1Score += game.lastBands;
    game.p1Swings += 1;
  } else {
    game.p2Score += game.lastBands;
    game.p2Swings += 1;
  }
  game.puckTarget = climb * TOWER_LENGTH;
  game.puck = 0;
  game.puckSpeed = Math.sqrt(2 * PUCK_GRAVITY * game.puckTarget);
  if (game.puckTarget > 0) {
    game.phase = 'striking';
  } else {
    game.phase = 'settling';
    game.settle = SETTLE_SECONDS;
  }
}

export interface StepResult {
  /** True on the step the needle ran out of wind-up unstruck. That is a swing, worth none. */
  readonly slipped: boolean;
  /** True on the step the turn passed. */
  readonly handedOver: boolean;
}

const result = { slipped: false, handedOver: false };

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  result.slipped = false;
  result.handedOver = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'ready') {
    game.ready -= fixedDeltaSeconds;
    if (game.ready <= 0) {
      game.ready = 0;
      game.phase = 'winding';
    }
    return result;
  }

  if (game.phase === 'winding') {
    result.slipped = sweep(game, fixedDeltaSeconds);
    return result;
  }

  if (game.phase === 'striking') {
    game.puck += game.puckSpeed * fixedDeltaSeconds;
    game.puckSpeed -= PUCK_GRAVITY * fixedDeltaSeconds;
    if (game.puck >= game.puckTarget || game.puckSpeed <= 0) {
      game.puck = game.puckTarget;
      game.puckSpeed = 0;
      game.phase = 'settling';
      game.settle = SETTLE_SECONDS;
    }
    return result;
  }

  game.settle -= fixedDeltaSeconds;
  if (game.settle <= 0) {
    handOver(game);
    result.handedOver = true;
  }
  return result;
}

/**
 * Move the needle, and wind the hammer a notch every time it turns round.
 *
 * The mark sits in the middle of the sweep, so exactly one crossing is offered per notch.
 * Running out of notches is a slip — the swing is spent and scores nothing, which is what
 * stops a player who never presses from stopping the match.
 */
function sweep(game: Game, fixedDeltaSeconds: number): boolean {
  const travel = needleRate(game.wind) * fixedDeltaSeconds;
  game.needle += (game.needleRising ? 1 : -1) * travel;
  if (game.needle >= SWEEP) {
    game.needle = SWEEP;
    game.needleRising = false;
    return windOn(game);
  }
  if (game.needle <= -SWEEP) {
    game.needle = -SWEEP;
    game.needleRising = true;
    return windOn(game);
  }
  return false;
}

/** Wind the hammer a notch, and report whether that was one notch too many. */
function windOn(game: Game): boolean {
  game.wind += 1;
  if (game.wind < MAX_WINDS) return false;
  strike(game, true);
  return true;
}

/**
 * Pass the hammer, and decide whether the match is over.
 *
 * **A match ends only on a completed round** — both seats having swung the same number of
 * times — and only if one of them is then ahead. Ending the instant somebody led would
 * hand the match to whoever swung first whenever both players were good, which is the trap
 * Knife Thrower fell into and the answer darts and cricket reach. Level is not a finish:
 * they swing again.
 *
 * The round count must also be **even**, because the lead alternates and an odd number of
 * rounds would leave one seat with an extra informed swing. See {@link leaderOf}.
 */
function handOver(game: Game): void {
  if (game.p1Swings !== game.p2Swings) {
    game.active = otherOf(game.active);
    beginTurn(game);
    return;
  }

  game.rounds += 1;
  game.active = leaderOf(game.rounds, game.opener);
  beginTurn(game);

  const played = game.rounds - 1;
  const ahead = game.p1Score !== game.p2Score;
  if ((played >= MIN_ROUNDS && played % 2 === 0 && ahead) || game.rounds > MAX_ROUNDS) {
    finish(game);
  }
}

function finish(game: Game): void {
  game.phase = 'over';
  game.winner = game.p1Score === game.p2Score ? 'draw' : game.p1Score > game.p2Score ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far off the moment it meant to press it lands, in seconds. */
  readonly timing: number;
  /** How often it presses at an outright wrong moment. */
  readonly blunder: number;
}

/**
 * Three tiers, expressed only as how accurately a tier hits the moment it meant to.
 *
 * That is the whole of the skill this game asks for, so it is the whole of what the tiers
 * differ in. None of them can stop the needle anywhere a person could not, and none of
 * them sees anything that is not drawn on the board — the needle, the notches, and the two
 * totals. The notch each tier chooses is *derived* from its own accuracy by
 * {@link chooseWind}, which is arithmetic any player could do about themselves, rather
 * than a table handed down per tier.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.14, blunder: 0.1 },
  normal: { timing: 0.1, blunder: 0.05 },
  hard: { timing: 0.05, blunder: 0.02 },
});

/** How far behind a bot has to be before it stops playing the averages and gambles. */
export const GAMBLE_DEFICIT = 8;

/**
 * How far off the mark a tier lands on average, in seconds.
 *
 * Its ordinary scatter is uniform over ±`timing`, whose mean magnitude is half of it; a
 * blunder throws the press six times as far, and often enough that ignoring it would have
 * `easy` planning its turns as though it were `normal`. Adding the two magnitudes
 * over-states the total slightly, which errs towards caution — the right direction for a
 * number whose only use is deciding how long to push a gamble.
 */
export function expectedError(profile: BotProfile): number {
  return profile.timing / 2 + profile.blunder * 3 * profile.timing;
}

/**
 * The notch a player who lands `meanError` seconds off the mark should wait for.
 *
 * That error is `rate × meanError` radians at a notch, so the faster notches turn the same
 * hand into a worse hit. Expected strength at a notch is its multiplier times the accuracy
 * that survives it, and the best notch is simply the largest of those five numbers — which
 * moves *down* the ladder as the hand gets shakier. That is the whole reason the ladder is
 * a decision rather than a formality, and it is why the tiers are not handed a notch each:
 * they work theirs out from what they know about themselves, exactly as a player does.
 *
 * Being far enough behind overrides it. The last notch is the only one that can reach the
 * bell and the widest by far in what it might return, so a player who cannot win on
 * averages belongs on it however steady their hand.
 */
export function chooseWind(meanError: number, deficit: number): number {
  if (deficit >= GAMBLE_DEFICIT) return MAX_WINDS - 1;
  let best = 0;
  let bestValue = -Infinity;
  for (let wind = 0; wind < MAX_WINDS; wind += 1) {
    const value = windFactor(wind) * Math.max(0, 1 - (meanError * needleRate(wind)) / SWEEP);
    if (value > bestValue) {
      bestValue = value;
      best = wind;
    }
  }
  return best;
}

export interface BotState {
  /** The notch it means to strike on. */
  wantWind: number;
  /** Seconds of timing error committed to for this swing. */
  offset: number;
  /** Whether the plan has been made for this turn. */
  planned: boolean;
}

export function createBotState(): BotState {
  return { wantWind: 0, offset: 0, planned: false };
}

export function resetBotState(state: BotState): void {
  state.wantWind = 0;
  state.offset = 0;
  state.planned = false;
}

/**
 * Values a bot draws per swing. Always exactly this many.
 *
 * Both bots share the game's single `Rng`; a seat whose draw count depended on what it
 * chose would shift the other seat's stream, which is a seat bias made of arithmetic.
 * Fruit Duel was caught by exactly that. `chooseWind` therefore draws nothing at all.
 */
export const BOT_DRAWS_PER_SWING = 3;

/** Decide the swing, once, at the start of a turn. */
export function planSwing(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const timingRoll = rng.float();
  const blunderRoll = rng.float();
  const blunderSize = rng.float();

  const deficit = scoreOf(game, otherOf(seat)) - scoreOf(game, seat);
  state.wantWind = chooseWind(expectedError(profile), deficit);
  state.offset = (timingRoll * 2 - 1) * profile.timing;
  if (blunderRoll < profile.blunder) state.offset += (blunderSize * 2 - 1) * profile.timing * 6;
  state.planned = true;
}

/**
 * Whether the bot presses this step.
 *
 * It waits for the notch it wants and then presses as the needle passes the mark, offset
 * by the timing error it committed to. The error is in *seconds*, which is what a person's
 * error is; converting it to radians here with the notch's own rate is what makes a faster
 * needle genuinely harder for every tier rather than only for the loose ones.
 *
 * The wanted angle is clamped into the sweep so that a blundered press still lands
 * somewhere on this traverse. Without the clamp a bad enough error would name an angle the
 * needle never reaches, the bot would sail past its notch in silence, and the difference
 * between a bad swing and no swing at all would be an accident of arithmetic.
 */
export function botPresses(
  game: Readonly<Game>,
  state: Readonly<BotState>,
  fixedDeltaSeconds: number,
): boolean {
  if (game.phase !== 'winding') return false;
  if (game.wind < state.wantWind) return false;
  const rate = needleRate(game.wind);
  const drift = state.offset * rate * (game.needleRising ? 1 : -1);
  const wanted = Math.min(SWEEP, Math.max(-SWEEP, drift));
  return crossed(game.needle, wanted, rate * fixedDeltaSeconds, game.needleRising);
}

/** Whether a needle at `at`, moving `rising`, has reached `wanted` this step. */
function crossed(at: number, wanted: number, travel: number, rising: boolean): boolean {
  if (rising) return at >= wanted - travel;
  return at <= wanted + travel;
}
