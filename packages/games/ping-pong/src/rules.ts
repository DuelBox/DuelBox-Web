import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Ping Pong, as pure rules.
 *
 * A table seen from above, a racket at each end, and a ball that never stops. Slide your
 * racket along your own baseline; the ball bounces off the side walls and off whatever
 * racket reaches it. Miss and the other player scores. First to seven.
 *
 * The idea the whole game turns on is **spin**: the ball does not simply mirror off a
 * racket, it takes the racket's own sideways motion with it. A still racket returns the
 * ball the way it came; a racket sweeping left as it strikes sends the ball left. That is
 * the difference between a game about being in the right place and a game about *arriving*
 * there, and it is the one thing a finger can express that a key cannot.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit.
 */

export const TABLE_WIDTH = 640;
export const TABLE_HEIGHT = 960;

/** The rails the ball bounces off. The playing surface is inside them. */
export const RAIL = 18;

export const BALL_RADIUS = 15;

/**
 * How wide a racket is at the start of a point — and only at the start.
 *
 * It narrows on every return; see {@link racketHalfWidth}.
 */
export const RACKET_HALF_WIDTH = 58;
export const RACKET_HALF_HEIGHT = 11;

/** The narrowest a racket ever gets, however long the rally runs. */
export const RACKET_MIN_HALF_WIDTH = 9;
/** Units of half-width lost per return that seat has made this point. */
export const RACKET_SHRINK_PER_HIT = 9;

/**
 * How wide a racket is after `hits` returns in the current point.
 *
 * **This is the rule that ends a point, and it exists because nothing else did.**
 *
 * The first draft relied on the ball speeding up: a rally accelerates, and eventually
 * the ball outruns a racket that has a speed limit. Measured, that is simply false for
 * a ball hit straight back, which lands where the receiver already is however fast it
 * travels. Two `hard` bots rallied **165 times on average** and half their matches ran
 * out the clock at four points apiece.
 *
 * A racket that narrows makes the *target* shrink rather than the time, so a straight
 * ball is no longer a safe ball, and the corners open up: the reachable band is fixed at
 * the full-width racket's, so a narrowed racket can no longer cover the rail. Six of your
 * own returns takes it from 58 to 9, at which point a point is decided in a shot or two.
 * Measured over sixty bot matches a side, that took the average `hard`-against-`hard`
 * rally from 165 returns to 21, and the share of matches that ran out the clock without
 * anybody reaching seven points from a half to one in thirty.
 *
 * It also does something the speed-up never did — it makes a long rally *tense* rather
 * than merely long, and it resets at every serve, so the pressure is per point. **[ours]**
 *
 * Counted **per seat**, not per rally. Counting the rally's total returns looked simpler
 * and was quietly unfair: the two seats hit on alternate counts, so the receiver had the
 * wider racket on every single one of their shots. p1 receives the opening serve and won
 * 13 of 24 against an identical opponent because of it.
 */
export function racketHalfWidth(hits: number): number {
  const width = RACKET_HALF_WIDTH - hits * RACKET_SHRINK_PER_HIT;
  return width < RACKET_MIN_HALF_WIDTH ? RACKET_MIN_HALF_WIDTH : width;
}
/** How far a racket's centre line sits from its own end of the table. */
export const RACKET_INSET = 74;

export const P1_RACKET_Y = TABLE_HEIGHT - RACKET_INSET;
export const P2_RACKET_Y = RACKET_INSET;

/**
 * Units a second a racket may travel.
 *
 * Both rackets have the same ceiling, and it is what makes a wide ball a decision rather
 * than a formality: at the opening speed a racket crosses the table in about as long as
 * the ball takes to arrive, so a corner is reachable if you start moving at once. It is
 * *not* what ends a point — see {@link racketHalfWidth} for the rule that does.
 */
export const RACKET_SPEED = 560;

/** The ball's vertical speed at serve. */
export const SERVE_SPEED = 520;
/**
 * Multiplied into the speed on every return.
 *
 * It takes reaction time away rather than ending the point on its own; the narrowing
 * racket does that. The two together are what make the tenth shot of a rally hard in two
 * different ways at once.
 */
export const RALLY_SPEEDUP = 1.06;
export const MAX_BALL_SPEED = 1900;

/**
 * How much of the racket's own sideways motion the ball takes on.
 *
 * This is the spin. At zero the game is symmetric and dull — every return retraces the
 * incoming angle — and at one a racket at full sweep sends the ball out sideways along
 * the rails, where it bounces for a second and a half before reaching anybody. Just over
 * a third puts a full sweep at roughly forty-five degrees, which is a shot rather than
 * an accident. **[ours]**
 */
export const SPIN_TRANSFER = 0.36;

/**
 * How much the contact point across the racket bends the return.
 *
 * The edges of the racket angle the ball outwards, so where you meet it is a second,
 * slower control that a keyboard can also reach. Without it the only way to change the
 * ball's direction would be to sweep, and a player on keys could never aim at all.
 */
export const EDGE_BEND = 240;

/** The steepest a return may ever be, so the ball cannot end up running the rails. */
export const MAX_ANGLE_RATIO = 1.5;

/** How long the ball hangs at the middle before a serve, so both players can look up. */
export const SERVE_SECONDS = 1.0;

export const TARGET_POINTS = 7;

/**
 * The round is called after this long.
 *
 * Nothing else here would end a match between two players who never miss. `roundSeconds`
 * in the manifest is read only by the catalogue card and ends nothing, so the guarantee
 * has to live in the rules — see the note at the top of `termination.test.ts`.
 */
export const ROUND_SECONDS = 150;

export type Phase = 'serving' | 'rally' | 'over';

export interface Racket {
  /** Centre of the racket along its baseline. */
  x: number;
  /** Units a second it moved on the last step, which is what puts spin on the ball. */
  velocity: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Game {
  readonly p1: Racket;
  readonly p2: Racket;
  readonly ball: Ball;
  p1Points: number;
  p2Points: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
  /** Counts down the serve hang; zero once the ball is live. */
  serveDelay: number;
  /** Which end the next serve travels toward. */
  serveToward: SeatId;
  /** Returns in the current point, for the HUD and for the speed-up. */
  rallyHits: number;
  /** Returns p1 has made this point, which is what narrows p1's racket. */
  p1Hits: number;
  /** Returns p2 has made this point. */
  p2Hits: number;
  /** Seconds the match has run, so it can be called. */
  elapsed: number;
}

export function createGame(): Game {
  return {
    p1: { x: TABLE_WIDTH / 2, velocity: 0 },
    p2: { x: TABLE_WIDTH / 2, velocity: 0 },
    ball: { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2, vx: 0, vy: 0 },
    p1Points: 0,
    p2Points: 0,
    phase: 'serving',
    winner: null,
    serveDelay: SERVE_SECONDS,
    serveToward: 'p1',
    rallyHits: 0,
    p1Hits: 0,
    p2Hits: 0,
    elapsed: 0,
  };
}

export function racketOf(game: Game, seat: SeatId): Racket {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function pointsOf(game: Game, seat: SeatId): number {
  return seat === 'p1' ? game.p1Points : game.p2Points;
}

export function racketYOf(seat: SeatId): number {
  return seat === 'p1' ? P1_RACKET_Y : P2_RACKET_Y;
}

/** How many returns a seat has made in the current point. */
export function hitsOf(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Hits : game.p2Hits;
}

/** How wide a seat's racket is right now. */
export function reachOf(game: Readonly<Game>, seat: SeatId): number {
  return racketHalfWidth(hitsOf(game, seat));
}

/**
 * The furthest left and right a racket centre may sit.
 *
 * Fixed at the full-width racket's limit rather than tracking the current width, so the
 * band a player can patrol never changes under them mid-rally — and so a narrowed racket
 * genuinely cannot cover the corner any more, which is what makes the shrink bite.
 */
export const RACKET_MIN_X = RAIL + RACKET_HALF_WIDTH;
export const RACKET_MAX_X = TABLE_WIDTH - RAIL - RACKET_HALF_WIDTH;

export function clampRacket(x: number): number {
  return x < RACKET_MIN_X ? RACKET_MIN_X : x > RACKET_MAX_X ? RACKET_MAX_X : x;
}

/**
 * Move a racket toward `wantedX`, no faster than {@link RACKET_SPEED}.
 *
 * Rate-limited rather than teleporting to the finger, and that is not a detail. A racket
 * that snaps to wherever a thumb lands would make every ball returnable however fast it
 * came, and the rally speed-up — the only thing that ends a point — would do nothing.
 * The limit also gives the racket a **velocity**, which is what the spin is made of.
 */
export function driveRacket(racket: Racket, wantedX: number, fixedDeltaSeconds: number): void {
  const target = clampRacket(wantedX);
  const reach = RACKET_SPEED * fixedDeltaSeconds;
  const delta = target - racket.x;
  const moved = delta > reach ? reach : delta < -reach ? -reach : delta;
  racket.x += moved;
  racket.velocity = fixedDeltaSeconds > 0 ? moved / fixedDeltaSeconds : 0;
}

/** Put the ball back at the middle and hand the serve to `toward`'s opponent. */
export function serveTo(game: Game, toward: SeatId): void {
  game.ball.x = TABLE_WIDTH / 2;
  game.ball.y = TABLE_HEIGHT / 2;
  game.ball.vx = 0;
  game.ball.vy = 0;
  game.phase = 'serving';
  game.serveDelay = SERVE_SECONDS;
  game.serveToward = toward;
  game.rallyHits = 0;
  game.p1Hits = 0;
  game.p2Hits = 0;
}

/**
 * Launch the waiting ball.
 *
 * The sideways component is seeded, and small: a serve straight down the middle every
 * time would make the opening of every point identical, and a wide one would decide it
 * before either player moved.
 */
export function launch(game: Game, rng: Rng): void {
  const spread = (rng.float() * 2 - 1) * 0.32;
  game.ball.vx = SERVE_SPEED * spread;
  game.ball.vy = game.serveToward === 'p1' ? SERVE_SPEED : -SERVE_SPEED;
  game.phase = 'rally';
}

export function resetGame(game: Game): void {
  game.p1.x = TABLE_WIDTH / 2;
  game.p1.velocity = 0;
  game.p2.x = TABLE_WIDTH / 2;
  game.p2.velocity = 0;
  game.p1Points = 0;
  game.p2Points = 0;
  game.phase = 'serving';
  game.winner = null;
  game.elapsed = 0;
  serveTo(game, 'p1');
}

export interface StepResult {
  /** The seat that scored this step, or null. */
  readonly scored: SeatId | null;
  /** The seat whose racket returned the ball this step, or null. */
  readonly returned: SeatId | null;
  /** True when the ball met a side rail this step. */
  readonly railed: boolean;
}

const result: { scored: SeatId | null; returned: SeatId | null; railed: boolean } = {
  scored: null,
  returned: null,
  railed: false,
};

/**
 * One fixed step of the ball.
 *
 * Rackets are moved by the caller before this runs, so their velocity is this step's and
 * the spin a player puts on the ball is the sweep they are making as it arrives.
 */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  result.scored = null;
  result.returned = null;
  result.railed = false;
  if (game.phase === 'over') return result;

  game.elapsed += fixedDeltaSeconds;

  if (game.phase === 'serving') {
    game.serveDelay -= fixedDeltaSeconds;
    if (game.serveDelay <= 0) launch(game, rng);
    return result;
  }

  const ball = game.ball;
  ball.x += ball.vx * fixedDeltaSeconds;
  ball.y += ball.vy * fixedDeltaSeconds;

  // The side rails. Reflected about the rail rather than merely negated, so a ball that
  // arrives deep in a fast step comes out where it should instead of sticking to the wall
  // and flipping every step.
  const minX = RAIL + BALL_RADIUS;
  const maxX = TABLE_WIDTH - RAIL - BALL_RADIUS;
  if (ball.x < minX) {
    ball.x = minX + (minX - ball.x);
    ball.vx = -ball.vx;
    result.railed = true;
  } else if (ball.x > maxX) {
    ball.x = maxX - (ball.x - maxX);
    ball.vx = -ball.vx;
    result.railed = true;
  }

  const struck = strike(game);
  if (struck !== null) {
    result.returned = struck;
    game.rallyHits += 1;
    if (struck === 'p1') game.p1Hits += 1;
    else game.p2Hits += 1;
    return result;
  }

  // Past a baseline with nobody having touched it: the other end scores.
  if (ball.y > TABLE_HEIGHT + BALL_RADIUS) {
    award(game, 'p2');
    result.scored = 'p2';
  } else if (ball.y < -BALL_RADIUS) {
    award(game, 'p1');
    result.scored = 'p1';
  }

  return result;
}

/**
 * Test both rackets against the ball and return it if one is there.
 *
 * A racket only ever returns a ball travelling **toward** it. Without that a ball leaving
 * a racket is caught again on the next step, sticks to it, and the point never ends.
 */
function strike(game: Game): SeatId | null {
  const ball = game.ball;
  for (const seat of SEATS) {
    const towardThisEnd = seat === 'p1' ? ball.vy > 0 : ball.vy < 0;
    if (!towardThisEnd) continue;

    const racket = racketOf(game, seat);
    const racketY = racketYOf(seat);
    if (Math.abs(ball.y - racketY) > RACKET_HALF_HEIGHT + BALL_RADIUS) continue;

    const reach = reachOf(game, seat) + BALL_RADIUS;
    const offset = ball.x - racket.x;
    if (Math.abs(offset) > reach) continue;

    returnBall(game, seat, offset, reach);
    return seat;
  }
  return null;
}

/** Both seats, as a constant array rather than one allocated per step. */
const SEATS: readonly SeatId[] = ['p1', 'p2'];

function returnBall(game: Game, seat: SeatId, offset: number, reach: number): void {
  const ball = game.ball;
  const racket = racketOf(game, seat);
  const speed = Math.min(MAX_BALL_SPEED, Math.hypot(ball.vx, ball.vy) * RALLY_SPEEDUP);

  // Where on the racket it landed bends the return, and the racket's own sweep adds to it.
  const bend = (offset / reach) * EDGE_BEND;
  let vx = ball.vx + bend + racket.velocity * SPIN_TRANSFER;

  // Away from this racket, whichever way it was going.
  let vy = seat === 'p1' ? -Math.abs(ball.vy) : Math.abs(ball.vy);

  // Re-normalise to the rallied speed, then hold the angle inside the envelope so no
  // return can end up running the rails for a second and a half.
  const magnitude = Math.hypot(vx, vy) || 1;
  vx = (vx / magnitude) * speed;
  vy = (vy / magnitude) * speed;

  const limit = Math.abs(vy) * MAX_ANGLE_RATIO;
  if (Math.abs(vx) > limit) {
    vx = vx < 0 ? -limit : limit;
    const rescale = speed / (Math.hypot(vx, vy) || 1);
    vx *= rescale;
    vy *= rescale;
  }

  ball.vx = vx;
  ball.vy = vy;

  // Lift it clear of the racket so the next step cannot catch it again on the way out.
  ball.y = racketYOf(seat) + (seat === 'p1' ? -1 : 1) * (RACKET_HALF_HEIGHT + BALL_RADIUS + 1);
}

function award(game: Game, seat: SeatId): void {
  if (seat === 'p1') game.p1Points += 1;
  else game.p2Points += 1;

  if (game.p1Points >= TARGET_POINTS || game.p2Points >= TARGET_POINTS) {
    game.phase = 'over';
    game.winner = game.p1Points > game.p2Points ? 'p1' : 'p2';
    return;
  }
  // The player who conceded receives, which is the only arrangement that does not hand
  // the same seat two openings in a row after a lucky bounce.
  serveTo(game, otherOf(seat));
}

/** Call the match on points. Used when the round clock runs out. */
export function callOnTime(game: Game): void {
  if (game.phase === 'over') return;
  game.phase = 'over';
  game.winner =
    game.p1Points === game.p2Points ? 'draw' : game.p1Points > game.p2Points ? 'p1' : 'p2';
}

export function winnerOf(game: Game): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds before the bot notices a change of direction. It plays the ball it last
   * looked at until this expires, exactly as a person who glanced away would.
   */
  readonly reaction: number;
  /** How far off the true landing point it aims, in logical units. */
  readonly error: number;
  /** How much of the racket's reach it is willing to use to add spin. */
  readonly aggression: number;
}

/**
 * The three tiers, expressed only as reaction, error and ambition.
 *
 * None of them gets a faster racket, a longer racket, or a look at anything a player
 * cannot see — rule 6. `hard` is better because it predicts the rails and sweeps into the
 * ball; `easy` is worse because it aims at where the ball is now rather than where it is
 * going, which is precisely how a beginner plays this.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.34, error: 96, aggression: 0 },
  normal: { reaction: 0.16, error: 42, aggression: 0.45 },
  hard: { reaction: 0.06, error: 12, aggression: 0.85 },
});

export interface BotState {
  /** Time left before it looks at the ball again. */
  cooldown: number;
  /** Where it is currently driving its racket. */
  aim: number;
  /** The error it committed to on the last look, so it does not jitter every step. */
  bias: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, aim: TABLE_WIDTH / 2, bias: 0 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.aim = TABLE_WIDTH / 2;
  state.bias = 0;
}

/**
 * Where the ball will cross `targetY`, accounting for the side rails.
 *
 * Folded rather than stepped: reflecting the straight-line landing point back into the
 * table repeatedly is exact, costs nothing per step, and — unlike walking the ball
 * forward — cannot disagree with the simulation about where a rail is.
 */
export function predictCrossing(ball: Readonly<Ball>, targetY: number): number {
  if (ball.vy === 0) return ball.x;
  const travel = (targetY - ball.y) / ball.vy;
  if (travel <= 0) return ball.x;

  const minX = RAIL + BALL_RADIUS;
  const maxX = TABLE_WIDTH - RAIL - BALL_RADIUS;
  const span = maxX - minX;
  if (span <= 0) return ball.x;

  const raw = ball.x + ball.vx * travel - minX;
  const period = span * 2;
  let folded = raw % period;
  if (folded < 0) folded += period;
  if (folded > span) folded = period - folded;
  return minX + folded;
}

/**
 * Drive a bot's racket for one step.
 *
 * Returns the x it wants; the caller feeds that to {@link driveRacket}, so a bot is
 * subject to exactly the same speed limit as a person.
 */
export function botAim(
  game: Game,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): number {
  const profile = BOT_PROFILES[difficulty];
  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown > 0) return state.aim;
  state.cooldown = profile.reaction;

  const ball = game.ball;
  const incoming = seat === 'p1' ? ball.vy > 0 : ball.vy < 0;

  if (game.phase !== 'rally' || !incoming) {
    // Nothing to answer: drift back to the middle, which is what a player does.
    state.aim = TABLE_WIDTH / 2;
    state.bias = 0;
    return state.aim;
  }

  const crossing = predictCrossing(ball, racketYOf(seat));
  state.bias = (rng.float() * 2 - 1) * profile.error;

  // The ambition: meet the ball off-centre on purpose, so the return is angled rather
  // than merely returned. `easy` has none of this and simply blocks.
  const away = crossing < TABLE_WIDTH / 2 ? 1 : -1;
  // Off the *current* width, not the full one: leaning by half a racket it no longer has
  // would be a bot that misses more the longer it rallies, which is not a difficulty.
  const lean = away * profile.aggression * reachOf(game, seat) * 0.7;

  state.aim = clampRacket(crossing + state.bias + lean);
  return state.aim;
}
