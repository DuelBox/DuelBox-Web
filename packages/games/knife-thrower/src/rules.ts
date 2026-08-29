import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Knife Thrower, as pure rules.
 *
 * A log turns in the middle of the board. Take it in turns to throw; a knife that finds
 * bare wood sticks and scores, and a knife that meets one already there splinters and
 * clears the whole log. First to twenty.
 *
 * The thing that makes it a game rather than a reflex test is that **every knife you land
 * makes the log harder for the person after you, and then harder for you again**. The
 * board fills with the consequences of both players' success, which is the same shape as
 * Snake Clash and reached from the opposite direction: there the hazard is your own body,
 * here it is the two of you jointly running out of wood.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit and every angle is
 * radians.
 */

export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;

/** The log sits at the centre, so a half-turn of the board leaves it exactly where it was. */
export const CENTRE_X = BOARD_WIDTH / 2;
export const CENTRE_Y = BOARD_HEIGHT / 2;
export const LOG_RADIUS = 150;

/** Where a knife is released from, on the near edge — also symmetric under a half-turn. */
export const THROW_Y = BOARD_HEIGHT - 110;

export const KNIFE_LENGTH = 92;
export const KNIFE_SPEED = 1500;

/**
 * The angle at which a knife always arrives, measured from the log's centre.
 *
 * It flies straight up the middle, so it meets the log at the bottom of the circle every
 * time — π/2 in screen coordinates, where y grows downward. **What varies is not where the
 * knife lands but where the log has turned to**, which is the whole game: you are not
 * aiming, you are choosing a moment.
 */
export const IMPACT_ANGLE = Math.PI / 2;

/**
 * How much clear wood a knife needs either side of it.
 *
 * Two knives closer than this splinter. Expressed as an angle rather than an arc length
 * because the log is one size; as a distance at the surface it is about 47 units, a little
 * over half a blade's width, so knives can sit visibly close without touching.
 */
export const KNIFE_CLEARANCE = 0.315;

/**
 * How many knives the log carries before the oldest is pushed out.
 *
 * `2π / KNIFE_CLEARANCE` is nineteen, and a log packed to the last gap would be decided by
 * arithmetic rather than by throwing. Twelve leaves real gaps and a genuinely tight
 * endgame.
 *
 * **A rolling window rather than a board that clears, and this is what makes the game
 * fair.** The first version emptied the log when it filled and paid the thrower a bonus,
 * which sounds symmetric and is not: knives arrive one a throw, so one seat always throws
 * at an even count and the other always at an odd one — a whole knife fuller, every single
 * time. Measured over forty `normal`-against-`normal` matches, p1 landed 67% of its throws
 * and p2 landed 53%, and p1 won 34 to 6. The bonus for filling the log had the same
 * problem pointing the other way: at `hard`, where almost nothing splintered to break the
 * parity, p2 collected every bonus and won 27 to 7.
 *
 * Holding the count steady removes the parity entirely: after the first dozen throws both
 * seats face a log with twelve knives in it and differ only in where the gaps happen to be.
 */
export const MAX_KNIVES = 8;

/** The log's turn rate with an empty log, in radians a second. */
export const BASE_SPIN = 1.15;
/** Added to the turn rate for each knife already in the log. */
export const SPIN_PER_KNIFE = 0.14;

export const TARGET_POINTS = 20;

/**
 * Throws in a match, both seats together, after which it is called on points.
 *
 * A structural limit rather than a clock: a player who splinters every knife would
 * otherwise never score and never lose, and no amount of waiting would change it.
 *
 * Ninety is forty-five each. Sixty was the first guess and left the target out of reach:
 * a splinter costs a point as well as scoring none, so a `normal` player nets about six
 * points in ten throws, and thirty throws stopped short of twenty. A quarter of matches
 * ended level and undecided. At forty-five the target is reached with rounds to spare,
 * which is what the equal-turns rule needs to have something to break the tie with.
 */
export const MAX_THROWS = 90;

/** Seconds the result of a throw is held before the board turns to the other player. */
export const SETTLE_SECONDS = 0.55;

export type Phase = 'aiming' | 'flying' | 'settling' | 'over';

export interface Knife {
  /** Angle relative to the log, so it turns with the wood it is stuck in. */
  angle: number;
  /** Who threw it, or null for the blunt old blades the log arrives carrying. */
  readonly seat: SeatId | null;
}

export type ThrowOutcome = 'stuck' | 'splintered';

/**
 * What a splintered throw costs the thrower.
 *
 * A splinter has to be bad *for the person who made it* and for nobody else. The first
 * version stripped the log bare, which sounds like a punishment and is the opposite: the
 * next player then threw at an empty log and could not miss. Two `easy` bots produced a
 * 24-6 split to p1 purely from it, because p1 throws first and every splinter of p2's
 * handed p1 a free point.
 *
 * Now the knife it hit is knocked out — the log reopens a little, for both of them
 * equally — and the thrower alone pays, a point off, floored at nothing. **[ours]**
 */
export const SPLINTER_PENALTY = 1;

export interface Game {
  /** Knives currently in the log, in the order they landed. */
  readonly knives: Knife[];
  /** The log's own rotation. */
  spin: number;
  /** Radians a second, signed. */
  spinRate: number;
  /** Distance of the flying knife from the log's centre; meaningless unless flying. */
  flightDistance: number;
  phase: Phase;
  active: SeatId;
  p1Points: number;
  p2Points: number;
  throws: number;
  /** Throws each seat has made, so a match can only end on a completed round. */
  p1Throws: number;
  p2Throws: number;
  /** Seconds left of the settle pause. */
  settle: number;
  /** What the last throw did, for the renderer and the tests. */
  lastOutcome: ThrowOutcome | null;
  winner: SeatId | 'draw' | null;
}

export function createGame(): Game {
  return {
    knives: [],
    spin: 0,
    spinRate: BASE_SPIN,
    flightDistance: 0,
    phase: 'aiming',
    active: 'p1',
    p1Points: 0,
    p2Points: 0,
    throws: 0,
    p1Throws: 0,
    p2Throws: 0,
    settle: 0,
    lastOutcome: null,
    winner: null,
  };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function pointsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Points : game.p2Points;
}

/** How fast the log turns with `count` knives in it. Direction is carried separately. */
export function spinRateFor(count: number): number {
  return BASE_SPIN + count * SPIN_PER_KNIFE;
}

/**
 * Set up the opening log: a fresh direction, and a full window of blunt old blades.
 *
 * The direction is seeded and flips about half the time, so a player cannot learn one
 * rhythm and ride it for a whole match. Nothing during a match empties the log — see
 * {@link MAX_KNIVES}.
 *
 * **The log does not start bare, and that is the fix for a bias that ran away with the
 * match.** A bare log is a free point, and only p1 ever got one: p1 landed it, p2 then
 * threw at a board with a knife in it, splintered more often, and every splinter knocked
 * a knife out and handed p1 an easier board still. The loop compounded — measured over
 * forty `normal`-against-`normal` matches, p1 won 36 to 4 and landed 67% of its throws to
 * p2's 47%. With random players, throwing at uniformly chosen moments, the same rules gave
 * 28 to 31: **the game was fair and the opening was not.**
 *
 * Starting at the steady state removes the free throw and the fill phase together. The old
 * blades belong to nobody, are drawn in weathered steel, and score for nobody when they
 * are knocked out. **[ours]**
 */
export function dressLog(game: Game, rng: Rng): void {
  game.knives.length = 0;
  game.spin = 0;

  // Rejection sampling with a bounded attempt count. A log this full cannot always fit
  // another blade, and an unbounded search for a gap that is not there would spin.
  for (let placed = 0; placed < MAX_KNIVES; placed += 1) {
    let found = false;
    for (let attempt = 0; attempt < 120 && !found; attempt += 1) {
      const angle = (rng.float() * 2 - 1) * Math.PI;
      if (clearanceAt(game, angle) < KNIFE_CLEARANCE) continue;
      game.knives.push({ angle, seat: null });
      found = true;
    }
    if (!found) break;
  }

  game.spinRate = spinRateFor(game.knives.length) * (rng.float() < 0.5 ? -1 : 1);
}

/**
 * The opener is the shell's `context.openingSeat`, never a literal `p1`: the SDK
 * alternates it across the rounds of a best-of so first-mover advantage washes out
 * (#2466), and a game that assumed seat one would leave that rotation reaching nothing.
 * The default exists only so the rules tests can name a concrete side.
 */
export function resetGame(game: Game, rng: Rng, opener: SeatId = 'p1'): void {
  game.p1Points = 0;
  game.p2Points = 0;
  game.throws = 0;
  game.p1Throws = 0;
  game.p2Throws = 0;
  game.phase = 'aiming';
  game.active = opener;
  game.settle = 0;
  game.lastOutcome = null;
  game.winner = null;
  game.flightDistance = 0;
  dressLog(game, rng);
}

/** Shortest signed distance between two angles, in (−π, π]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Where a knife landing now would sit on the log, in the log's own frame. */
export function landingAngle(game: Readonly<Game>): number {
  return IMPACT_ANGLE - game.spin;
}

/** How much clear wood there is either side of `angle`, in radians. π when the log is bare. */
export function clearanceAt(game: Readonly<Game>, angle: number): number {
  let nearest = Math.PI;
  for (const knife of game.knives) {
    const gap = Math.abs(angleDelta(angle, knife.angle));
    if (gap < nearest) nearest = gap;
  }
  return nearest;
}

/** Whether a knife landing now would find bare wood. */
export function wouldStick(game: Readonly<Game>): boolean {
  return clearanceAt(game, landingAngle(game)) >= KNIFE_CLEARANCE;
}

/**
 * Begin a throw. Only the seat whose turn it is may, and only while the log is waiting.
 *
 * Returns whether the knife actually left the hand, so a caller need not re-derive the
 * phase to know if it counted.
 */
export function throwKnife(game: Game, seat: SeatId): boolean {
  if (game.phase !== 'aiming' || seat !== game.active) return false;
  game.phase = 'flying';
  game.flightDistance = THROW_Y - CENTRE_Y;
  game.throws += 1;
  if (seat === 'p1') game.p1Throws += 1;
  else game.p2Throws += 1;
  return true;
}

/** How long a knife thrown now will be in the air. Used by the bot, and by nothing else. */
export const FLIGHT_SECONDS = (THROW_Y - CENTRE_Y - LOG_RADIUS) / KNIFE_SPEED;

export interface StepResult {
  /** Set on the step a knife arrived. */
  readonly outcome: ThrowOutcome | null;
  /** Set on the step the turn passed to the other seat. */
  readonly handedOver: boolean;
}

const result: { outcome: ThrowOutcome | null; handedOver: boolean } = {
  outcome: null,
  handedOver: false,
};

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  result.outcome = null;
  result.handedOver = false;
  if (game.phase === 'over') return result;

  game.spin += game.spinRate * fixedDeltaSeconds;
  // Kept in (−π, π] so a long match cannot drift into the range where a float stops
  // being able to tell two angles apart.
  if (game.spin > Math.PI) game.spin -= Math.PI * 2;
  else if (game.spin <= -Math.PI) game.spin += Math.PI * 2;

  if (game.phase === 'settling') {
    game.settle -= fixedDeltaSeconds;
    if (game.settle <= 0) {
      handOver(game);
      result.handedOver = true;
    }
    return result;
  }

  if (game.phase !== 'flying') return result;

  game.flightDistance -= KNIFE_SPEED * fixedDeltaSeconds;
  if (game.flightDistance > LOG_RADIUS) return result;

  result.outcome = land(game);
  return result;
}

function land(game: Game): ThrowOutcome {
  const thrower = game.active;
  const angle = landingAngle(game);
  const outcome: ThrowOutcome =
    clearanceAt(game, angle) >= KNIFE_CLEARANCE ? 'stuck' : 'splintered';

  if (outcome === 'splintered') {
    // The knife it hit is knocked out, and the thrower alone pays for it. The log
    // reopening is symmetric — it helps whoever throws next, and over a match that is
    // both of them — where stripping it bare was a gift to the seat that did not miss.
    knockOutNearest(game, angle);
    award(game, thrower, -SPLINTER_PENALTY);
    game.spinRate = Math.sign(game.spinRate) * spinRateFor(game.knives.length);
    game.lastOutcome = 'splintered';
  } else {
    game.knives.push({ angle, seat: thrower });
    // The oldest knife is pushed out to make room, so the log holds a constant number and
    // neither seat is systematically throwing at the fuller board.
    if (game.knives.length > MAX_KNIVES) game.knives.shift();
    award(game, thrower, 1);
    game.spinRate = Math.sign(game.spinRate) * spinRateFor(game.knives.length);
    game.lastOutcome = 'stuck';
  }

  game.phase = 'settling';
  game.settle = SETTLE_SECONDS;
  return game.lastOutcome;
}

/** Remove the knife nearest `angle`. Never called on a bare log — a bare log cannot splinter. */
function knockOutNearest(game: Game, angle: number): void {
  let nearest = -1;
  let best = Infinity;
  for (let i = 0; i < game.knives.length; i += 1) {
    const gap = Math.abs(angleDelta(angle, game.knives[i]!.angle));
    if (gap < best) {
      best = gap;
      nearest = i;
    }
  }
  if (nearest >= 0) game.knives.splice(nearest, 1);
}

/** Points never go below zero: a splinter can cost a lead, never put a player in debt. */
function award(game: Game, seat: SeatId, points: number): void {
  if (seat === 'p1') game.p1Points = Math.max(0, game.p1Points + points);
  else game.p2Points = Math.max(0, game.p2Points + points);
}

/**
 * Pass the log to the other seat, and decide whether the match is over.
 *
 * **A match only ends on a completed round**, meaning both seats have thrown the same
 * number of times. Ending the instant somebody reaches the target hands the match to
 * whoever throws first whenever both players are good: two `hard` bots each landed
 * essentially every knife, and p1 simply arrived at twenty one throw sooner — 40 to 0
 * over forty matches, with the points 20.0 to 19.0. Equal turns is the same answer darts
 * and cricket reach, for the same reason.
 *
 * Level at the target is not a finish either: the pair throw again, and again, until one
 * of them is ahead at the end of a round or the throws run out.
 */
function handOver(game: Game): void {
  game.active = otherOf(game.active);
  game.phase = 'aiming';

  if (game.p1Throws !== game.p2Throws) return;
  const ahead = game.p1Points !== game.p2Points;
  const reached = game.p1Points >= TARGET_POINTS || game.p2Points >= TARGET_POINTS;
  if ((reached && ahead) || game.throws >= MAX_THROWS) finish(game);
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
  /**
   * How much clear wood it insists on before it will throw, as a multiple of the
   * clearance a knife actually needs. Below one it is willing to take a gap that will
   * splinter; above one it waits for room to spare.
   */
  readonly demanded: number;
  /** Seconds of timing error, applied as a lead or lag on the moment it commits. */
  readonly jitter: number;
  /** Chance a throw is released a whole beat late regardless, as a plain blunder. */
  readonly blunder: number;
}

/**
 * Three tiers, all of them throwing the same knife at the same log.
 *
 * The only things that differ are how much room a tier insists on and how accurately it
 * hits the moment it chose — never the knife, the spin, or anything a player cannot see
 * (rule 6). `easy` will throw into a gap too small to hold a knife, which is exactly the
 * mistake a person makes here.
 *
 * **`hard` blunders too, and it has to.** With a blunder rate of nothing it landed every
 * single knife, and so did the identical bot in the other seat: forty-five throws each,
 * forty-five points each, and a draw — thirteen matches in forty ended 45–45 because a
 * flawless player cannot be separated from another one. Six throws in a hundred going
 * badly is enough for a round to tell them apart, and it is a great deal more like playing
 * against somebody who is very good than against somebody who is perfect.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { demanded: 0.8, jitter: 0.115, blunder: 0.2 },
  normal: { demanded: 1.1, jitter: 0.055, blunder: 0.09 },
  hard: { demanded: 1.8, jitter: 0.016, blunder: 0.045 },
});

export interface BotState {
  /** Seconds of lead or lag committed to for the current turn. */
  offset: number;
  /** Whether `offset` has been drawn yet this turn. */
  ready: boolean;
  /** Seconds spent waiting for a gap on this turn. */
  waited: number;
}

export function createBotState(): BotState {
  return { offset: 0, ready: false, waited: 0 };
}

export function resetBotState(state: BotState): void {
  state.offset = 0;
  state.ready = false;
  state.waited = 0;
}

/**
 * How long a bot holds out for the gap it wants before it starts settling for less.
 *
 * **Without this the game deadlocks.** `hard` insists on 2.1× the clearance a knife needs,
 * and a log with eight knives in it may simply not have that anywhere — so it waits, the
 * turn never ends, and the match hangs. Measured before the fix: `hard` against `easy`
 * finished none of twenty matches. It is not caught by `termination.test.ts` either,
 * which plays two `easy` bots precisely because the weakest play is the likeliest to
 * wedge, and here it is the strongest.
 *
 * Its demand decays linearly to nothing over this long, so a bot always throws eventually
 * and a patient tier is patient rather than paralysed. Three seconds is a little over one
 * turn of a bare log, so a tier that wants room usually gets a real chance at it first.
 */
export const BOT_PATIENCE_SECONDS = 3;

/**
 * Where the landing angle will be `seconds` from now.
 *
 * A person watching a turning log does this by eye. The bot does it by arithmetic, which
 * is the same information arriving more reliably — the tiers are what put the unreliability
 * back.
 */
export function landingAngleIn(game: Readonly<Game>, seconds: number): number {
  return IMPACT_ANGLE - (game.spin + game.spinRate * seconds);
}

/**
 * Whether the bot lets go this step.
 *
 * It draws one timing error per turn rather than one per step, so it commits to a moment
 * the way a person does instead of re-rolling sixty times a second until one comes up
 * lucky — which would make every tier equally good.
 */
export function botThrows(
  game: Readonly<Game>,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (game.phase !== 'aiming') {
    state.ready = false;
    state.waited = 0;
    return false;
  }
  const profile = BOT_PROFILES[difficulty];
  if (!state.ready) {
    state.ready = true;
    state.waited = 0;
    state.offset = (rng.float() * 2 - 1) * profile.jitter;
    if (rng.float() < profile.blunder) state.offset += profile.jitter * 4;
  }
  state.waited += fixedDeltaSeconds;

  // Where the knife would land if released now, and where it would land a step later.
  const lead = FLIGHT_SECONDS + state.offset;
  const now = clearanceAt(game, landingAngleIn(game, lead));
  const next = clearanceAt(game, landingAngleIn(game, lead + fixedDeltaSeconds));

  // The demand relaxes as it waits, reaching nothing after `BOT_PATIENCE_SECONDS`.
  const patience = Math.max(0, 1 - state.waited / BOT_PATIENCE_SECONDS);
  if (now < KNIFE_CLEARANCE * profile.demanded * patience) return false;

  /*
   * And it releases on the way *out* of a gap rather than on the way in.
   *
   * Without this the first version was strictly worse the better the tier: a bot that
   * insisted on more room simply waited longer, and then — with its demand decayed away —
   * let go at whatever moment it happened to be looking at. Measured, `normal` landed 53.5%
   * of its throws against `easy`'s 54.3%, which is a difficulty setting pointing backwards.
   *
   * Clearance rises to a maximum at the middle of a gap and falls away either side, so
   * "no wider than it was a step ago" is the middle of the gap, arrived at without
   * searching. It is also what a person does: you throw as the space comes round, not as
   * soon as one is visible.
   */
  return next <= now;
}
