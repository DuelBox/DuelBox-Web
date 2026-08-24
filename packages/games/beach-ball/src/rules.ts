import {
  commit,
  createJudgement,
  misjudgement,
  resetJudgement,
  resolve,
  shouldDecide,
} from '@duelbox/game-sdk';
import type { Judgement, Outcome, WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Beach Ball, as pure rules.
 *
 * A sand court seen from above, a net across the middle, one player each side, and a ball
 * with a **height**. Run around your own half; whatever you can reach, you return. Let the
 * ball land on your sand and the other player scores. First to three.
 *
 * The height is the whole design. A `horizontal` split puts the two seats at the top and
 * the bottom of the device, so a side-on game with gravity down the screen would pull the
 * ball toward one of them — the seat at the bottom would be playing a different game from
 * the seat at the top. Here gravity acts on `z`, a third axis that belongs to neither seat,
 * and the court is point-symmetric about the net: every `y` below is paired with a
 * `forwardOf`, so mirroring the state top to bottom produces the mirrored result.
 *
 * `rules.test.ts` asserts that, and asserts it in two strengths, because the two are not the
 * same. Every *decision* — who served, who touched, who scored, the score, the result —
 * mirrors exactly. Every *measurement* mirrors to a hundredth of a unit, and cannot do
 * better: the court is measured from a corner, so p2's half is spaced twice as finely in
 * double precision as p1's and `COURT_HEIGHT - y` is not an involution. That is the
 * representation leaning, not the rules; see `MIRROR_TOLERANCE` in the tests.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit and `z` is one too.
 */

export const COURT_WIDTH = 600;
export const COURT_HEIGHT = 1000;

/** The net runs across the middle. Each half is exactly as deep as the other. */
export const NET_Y = COURT_HEIGHT / 2;
/** How high the net stands, in the same units as everything else. */
export const NET_HEIGHT = 100;
/** How much of its pace a ball keeps when it clips the net. */
export const NET_BOUNCE = 0.3;

export const BALL_RADIUS = 16;
export const PLAYER_RADIUS = 38;
/** How far from a player's middle the ball may be and still be playable. */
export const REACH = PLAYER_RADIUS + BALL_RADIUS;
/** The highest a standing player can reach. Above this the ball simply goes over them. */
export const REACH_HEIGHT = 118;

/** Downward acceleration on `z`. Deliberately gentle: a beach ball floats. */
export const GRAVITY = 700;

/** Units a second a player runs. Both seats have exactly the same one. */
export const PLAYER_SPEED = 320;

export const TARGET_POINTS = 3;

/**
 * The backstop that ends a match nothing else ends.
 *
 * `roundSeconds` in the manifest is read by the catalogue card and ends nothing — see the
 * note at the top of `apps/web/src/data/termination.test.ts`. Three points arrive well
 * inside a minute at every tier — 500 measured matches of `easy` against `easy` peaked at
 * 33.7 s and 500 of `hard` against `hard` at 41.3 s — so this is never reached in practice.
 * It is here because "never reached in practice" is not a guarantee.
 */
export const MATCH_SECONDS = 180;

/** How long the ball hangs above the server, so both players can look up. */
export const SERVE_SECONDS = 1.1;
/** The pause after a point, before the next serve. */
export const POINT_SECONDS = 0.9;
/** How high above the server the ball is tossed. */
export const SERVE_HEIGHT = 96;

/**
 * How long a struck ball spends in the air, by the number of touches already played.
 *
 * **This is the rule that ends a rally, and it is the only one that needs to be.** A return
 * is aimed at a point rather than reflected, so a player who reaches the ball can always
 * put it somewhere legal — nothing about placement alone would ever end a point. What ends
 * it is that every touch buys less time than the last: the arc flattens, and a flatter arc
 * both clears the net by less and gives the far player less of the flight to cross the sand
 * in. Eventually one of those two runs out, and one of them always does.
 *
 * Measured over seven hundred bot matches: rallies run three to nine touches, and around the
 * seventh is where the arc stops clearing the net from the back of the court. A player who
 * has come forward survives longer than one hitting from the back line, which is the whole
 * reason to come forward.
 */
export const BASE_FLIGHT = 1.05;
export const FLIGHT_STEP = 0.08;
export const MIN_FLIGHT = 0.34;

/**
 * The hard cap on a rally, in touches.
 *
 * Belt and braces on top of the shrinking flight time: past this the ball is dead and no
 * player may touch it, so it lands and the point is decided. It exists because a rally that
 * cannot end is the classic way a volley game hangs, and a guarantee that depends on tuning
 * is not a guarantee. Nothing has ever reached it — the longest rally measured is nine.
 */
export const MAX_RALLY_TOUCHES = 14;

export function flightTimeFor(touches: number): number {
  const time = BASE_FLIGHT - touches * FLIGHT_STEP;
  return time < MIN_FLIGHT ? MIN_FLIGHT : time;
}

/**
 * How much more flight a ball met at full stretch buys than one dug off the sand.
 *
 * Getting under the ball is what a beach player is actually trying to do, and it is the
 * reason a rally is about *arriving* rather than merely reaching. It is also what keeps the
 * rally from being pure arithmetic: without it the flight time depends only on the touch
 * count, so the arc fails to clear the net on the same touch of every rally and the seat
 * whose turn it happens to be loses every point neither player misses. Two equal bots then
 * traded points strictly by who served, and the opening coin flip decided the match. **[ours]**
 *
 * Multiplied into the rally's remaining flight rather than added to it, which matters: added,
 * a player who kept meeting the ball high could out-run the decay for ever and the rally had
 * no end but the hard cap. Multiplied, meeting it high buys a proportion of a shrinking
 * number, so it stretches a rally without ever saving one.
 */
export const LIFT_GAIN = 0.4;

/** The flight a touch buys: what the rally has left, stretched by how high it was met. */
export function flightFor(touches: number, height: number): number {
  const lift = height <= 0 ? 0 : height >= REACH_HEIGHT ? 1 : height / REACH_HEIGHT;
  return flightTimeFor(touches) * (1 + LIFT_GAIN * lift);
}

/** How far from the sidelines and the back line a return may be aimed. */
export const TARGET_MARGIN = 40;
/** The closest to the net a return may be aimed, so a dink still has to cross. */
export const NET_CLEAR = 70;
/** How far off centre the widest return lands. */
export const PLACE_WIDTH = 260;
/** How deep an untouched-by-placement return lands, measured from the net. */
export const PLACE_MID_DEPTH = 250;
/** How much depth the contact point and the run add or take away. */
export const PLACE_DEPTH = 190;
/** The deepest a return may be aimed, measured from the net. */
export const PLACE_MAX_DEPTH = NET_Y - TARGET_MARGIN;

/**
 * How much of a running player's own motion goes into the shot.
 *
 * Well below one, so where you meet the ball matters more than how fast you arrived —
 * running at it adds to a shot you were already going to play rather than substituting for
 * standing in the right place. At 0.55 it was the other way round and it inverted the bot
 * tiers: a bot that reacted slowly arrived late and was therefore *still running* when it
 * played the ball, which placed the return better than a bot that had got there early and
 * stopped. The slowest tier beat the quickest.
 */
export const MOVE_TRANSFER = 0.3;

export interface Player {
  x: number;
  y: number;
  /** What it actually managed to move last step, per second. This is what aims a shot. */
  vx: number;
  vy: number;
}

export interface Ball {
  x: number;
  y: number;
  /** Height above the sand. Zero is the sand; the ball is dead there. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export type Phase = 'serving' | 'rally' | 'point' | 'over';

export interface Score {
  p1: number;
  p2: number;
}

export interface Match {
  readonly p1: Player;
  readonly p2: Player;
  readonly ball: Ball;
  readonly score: Score;
  phase: Phase;
  /** Seconds left of the serve hang or the post-point pause. */
  timer: number;
  /** Who serves next, which is whoever just lost the point. */
  server: SeatId;
  /** Who last touched the ball. Nobody may touch it twice running. */
  lastToucher: SeatId;
  /** Touches played in the current rally, the serve counting as the first. */
  touches: number;
  /** Who took the last point, for the renderer. */
  scorer: SeatId | null;
  /** Where the last touch was aimed, for the landing marker both players read. */
  aimX: number;
  aimY: number;
  /** Seconds the match has run, so it can be called. */
  elapsed: number;
  winner: Outcome;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Which way is "toward the other player": p1 defends the bottom, so p1 attacks upward. */
export function forwardOf(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

export function playerOf(match: Readonly<Match>, seat: SeatId): Readonly<Player> {
  return seat === 'p1' ? match.p1 : match.p2;
}

export interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const P1_HALF: Bounds = Object.freeze({
  minX: PLAYER_RADIUS,
  maxX: COURT_WIDTH - PLAYER_RADIUS,
  minY: NET_Y + PLAYER_RADIUS,
  maxY: COURT_HEIGHT - PLAYER_RADIUS,
});

const P2_HALF: Bounds = Object.freeze({
  minX: PLAYER_RADIUS,
  maxX: COURT_WIDTH - PLAYER_RADIUS,
  minY: PLAYER_RADIUS,
  maxY: NET_Y - PLAYER_RADIUS,
});

/**
 * The patch of sand a seat may stand on. The two are exact mirrors about the net, so
 * neither seat has a step more room than the other.
 */
export function halfOf(seat: SeatId): Bounds {
  return seat === 'p1' ? P1_HALF : P2_HALF;
}

/** Which half a point of the court belongs to. The net line itself counts as p1's. */
export function sideOf(y: number): SeatId {
  return y >= NET_Y ? 'p1' : 'p2';
}

/** How far behind the net a player waits between shots. */
export const READY_DEPTH = 210;
/** How far behind the net a server stands. */
export const SERVE_DEPTH = 380;
/** How far off centre a serve may be nudged, and how much deeper or shorter. */
export const SERVE_SPREAD_X = 150;
export const SERVE_SPREAD_Y = 90;

/** Where a seat waits between shots. Mirrors exactly about the net. */
export function readyY(seat: SeatId): number {
  return NET_Y - forwardOf(seat) * READY_DEPTH;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function createMatch(rng: Rng): Match {
  const match: Match = {
    p1: { x: COURT_WIDTH / 2, y: readyY('p1'), vx: 0, vy: 0 },
    p2: { x: COURT_WIDTH / 2, y: readyY('p2'), vx: 0, vy: 0 },
    ball: { x: COURT_WIDTH / 2, y: NET_Y, z: SERVE_HEIGHT, vx: 0, vy: 0, vz: 0 },
    score: { p1: 0, p2: 0 },
    phase: 'serving',
    timer: SERVE_SECONDS,
    server: 'p1',
    lastToucher: 'p1',
    touches: 0,
    scorer: null,
    aimX: COURT_WIDTH / 2,
    aimY: NET_Y,
    elapsed: 0,
    winner: null,
  };
  resetMatch(match, rng);
  return match;
}

export function resetMatch(match: Match, rng: Rng): void {
  match.score.p1 = 0;
  match.score.p2 = 0;
  match.scorer = null;
  match.elapsed = 0;
  match.winner = null;
  // A coin flip rather than "p1 always". Serving is a small advantage — the server plays
  // one shot nobody is contesting — and handing it to the same seat every match is exactly
  // the kind of seat bias that only ever shows up in aggregate.
  match.server = rng.bool() ? 'p1' : 'p2';
  serve(match, rng);
}

/**
 * Put both players on their marks and toss the ball above the server.
 *
 * The serve is **timed, not triggered**. Waiting for a player to press something is how a
 * match stops progressing when nobody presses anything, and the termination guard drives
 * every game with two bots and no human input at all.
 */
export function serve(match: Match, rng: Rng): void {
  const server = match.server;
  const receiver = otherOf(server);
  const forward = forwardOf(server);

  const serverPlayer = server === 'p1' ? match.p1 : match.p2;
  const receiverPlayer = receiver === 'p1' ? match.p1 : match.p2;
  serverPlayer.x = COURT_WIDTH / 2;
  serverPlayer.y = NET_Y - forward * SERVE_DEPTH;
  serverPlayer.vx = 0;
  serverPlayer.vy = 0;
  receiverPlayer.x = COURT_WIDTH / 2;
  receiverPlayer.y = readyY(receiver);
  receiverPlayer.vx = 0;
  receiverPlayer.vy = 0;

  const ball = match.ball;
  ball.x = serverPlayer.x;
  ball.y = serverPlayer.y;
  ball.z = SERVE_HEIGHT;

  // Aimed rather than reflected, exactly as a return is, so a serve always crosses the net
  // and always lands in. A serve that could fault would hand the receiver free points, and
  // a serve that could not be varied would make every point open the same way.
  const aimX = clamp(
    COURT_WIDTH / 2 + (rng.float() - 0.5) * 2 * SERVE_SPREAD_X,
    TARGET_MARGIN,
    COURT_WIDTH - TARGET_MARGIN,
  );
  const aimY = NET_Y + forward * (PLACE_MID_DEPTH + (rng.float() - 0.5) * 2 * SERVE_SPREAD_Y);
  aimAt(match, aimX, aimY, flightFor(0, SERVE_HEIGHT));

  match.touches = 1;
  match.lastToucher = server;
  match.phase = 'serving';
  match.timer = SERVE_SECONDS;
}

/**
 * Point the ball at a spot on the sand and give it the arc that lands there.
 *
 * The vertical speed is solved from the flight time rather than chosen, which is what makes
 * the shrinking flight time bite: a shorter flight means a flatter arc, and a flat enough
 * arc does not clear the net. Meeting the ball high enough with a short flight solves for a
 * *negative* vertical speed, which is a spike — hit down over the net rather than up over it.
 */
function aimAt(match: Match, aimX: number, aimY: number, flight: number): void {
  const ball = match.ball;
  if (ball.z < 0) ball.z = 0;
  ball.vx = (aimX - ball.x) / flight;
  ball.vy = (aimY - ball.y) / flight;
  // z(flight) = z + vz*flight - G*flight²/2 = 0
  ball.vz = (GRAVITY * flight * flight) / 2 / flight - ball.z / flight;
  match.aimX = aimX;
  match.aimY = aimY;
}

/**
 * Run a player, no faster than {@link PLAYER_SPEED}, and never off their own half.
 *
 * `dx`/`dy` is an intent, not a position: a thumb and a key both come in through here at
 * the same speed limit, so neither instrument can arrive anywhere sooner than the other.
 * The velocity written back is what the player *managed*, which is why running into a wall
 * puts nothing on the shot.
 */
export function movePlayer(
  match: Match,
  seat: SeatId,
  dx: number,
  dy: number,
  fixedDeltaSeconds: number,
): void {
  const player = seat === 'p1' ? match.p1 : match.p2;
  const bounds = halfOf(seat);
  let ix = dx;
  let iy = dy;
  const magnitude = Math.hypot(ix, iy);
  // Capped rather than normalised: a half-pressed intent stays half, but two axes at once
  // must not out-run one.
  if (magnitude > 1) {
    ix /= magnitude;
    iy /= magnitude;
  }
  const nextX = clamp(player.x + ix * PLAYER_SPEED * fixedDeltaSeconds, bounds.minX, bounds.maxX);
  const nextY = clamp(player.y + iy * PLAYER_SPEED * fixedDeltaSeconds, bounds.minY, bounds.maxY);
  player.vx = fixedDeltaSeconds > 0 ? (nextX - player.x) / fixedDeltaSeconds : 0;
  player.vy = fixedDeltaSeconds > 0 ? (nextY - player.y) / fixedDeltaSeconds : 0;
  player.x = nextX;
  player.y = nextY;
}

/**
 * Whether `seat` may play the ball where it currently is.
 *
 * Four conditions, and each of them is load-bearing:
 *
 * - **It is on your side of the net.** A player's half stops short of the net but their
 *   reach does not, so without this a player standing on their own line could pick a ball
 *   out of the air over the other person's sand.
 * - **You did not touch it last.** One touch a side, as in the real game. This is also what
 *   makes the classic volley hang impossible: a ball with no pace left cannot rest on a
 *   player and be struck again every step, because that player is not allowed to touch it.
 * - **It is within reach, and low enough to reach.** Both are the whole skill.
 * - **The rally has touches left.** See {@link MAX_RALLY_TOUCHES}.
 */
export function canPlay(match: Readonly<Match>, seat: SeatId): boolean {
  const ball = match.ball;
  if (match.touches >= MAX_RALLY_TOUCHES) return false;
  if (match.lastToucher === seat) return false;
  if (ball.z > REACH_HEIGHT) return false;
  if (sideOf(ball.y) !== seat) return false;
  const player = seat === 'p1' ? match.p1 : match.p2;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  return dx * dx + dy * dy <= REACH * REACH;
}

/** Which seat, if either, is playing the ball this step. */
export function contactSeat(match: Readonly<Match>): SeatId | null {
  if (canPlay(match, 'p1')) return 'p1';
  if (canPlay(match, 'p2')) return 'p2';
  return null;
}

/**
 * Return the ball.
 *
 * Where on you it was met decides where it goes — sideways from the edge of your reach,
 * deep when you meet it in front of you, short when it gets behind you — and your own run
 * adds to both. That is the entire control scheme: there is no aim button, because standing
 * in the right place *is* the aim, and it is the one thing a thumb and a key express
 * identically.
 */
export function play(match: Match, seat: SeatId): void {
  const ball = match.ball;
  const player = seat === 'p1' ? match.p1 : match.p2;
  const forward = forwardOf(seat);

  const lateral = clamp(
    (ball.x - player.x) / REACH + clamp(player.vx / PLAYER_SPEED, -1, 1) * MOVE_TRANSFER,
    -1,
    1,
  );
  const depth = clamp(
    (forward * (ball.y - player.y)) / REACH +
      clamp((forward * player.vy) / PLAYER_SPEED, -1, 1) * MOVE_TRANSFER,
    -1,
    1,
  );

  const aimX = clamp(
    COURT_WIDTH / 2 + lateral * PLACE_WIDTH,
    TARGET_MARGIN,
    COURT_WIDTH - TARGET_MARGIN,
  );
  const away = clamp(PLACE_MID_DEPTH + depth * PLACE_DEPTH, NET_CLEAR, PLACE_MAX_DEPTH);
  const aimY = NET_Y + forward * away;

  const flight = flightFor(match.touches, ball.z);
  aimAt(match, aimX, aimY, flight);
  match.touches += 1;
  match.lastToucher = seat;
}

export interface StepResult {
  /** The seat that took a point this step, or null. */
  scored: SeatId | null;
  /** The seat that returned the ball this step, or null. */
  touched: SeatId | null;
  /** True when the ball found the net this step. */
  netted: boolean;
}

/** Rewritten in place each step rather than allocated. Read it before the next call. */
const result: StepResult = { scored: null, touched: null, netted: false };

const CONDITION: WinCondition = { kind: 'first-to', target: TARGET_POINTS };
/** Held rather than built per step, so settling the match allocates nothing. */
const RESOLVE_OPTIONS = { timeExpired: false };

/** Ask the shared helper whether the match is decided, and say so. */
function settle(match: Match): boolean {
  RESOLVE_OPTIONS.timeExpired = match.elapsed >= MATCH_SECONDS;
  match.winner = resolve(CONDITION, match.score, RESOLVE_OPTIONS);
  if (match.winner === null) return false;
  match.phase = 'over';
  return true;
}

function award(match: Match, seat: SeatId): void {
  if (seat === 'p1') match.score.p1 += 1;
  else match.score.p2 += 1;
  match.scorer = seat;
  // The seat that conceded serves next, which keeps a one-sided match from running away.
  match.server = otherOf(seat);
  match.phase = 'point';
  match.timer = POINT_SECONDS;
  settle(match);
}

/**
 * Advance one fixed step.
 *
 * The order is fixed and it matters: gravity, flight, the net, then contact, then the sand.
 * Contact is tested before the sand so a ball dug on the very step it would have landed is
 * dug rather than lost, which is what a player watching it would expect.
 */
export function step(match: Match, fixedDeltaSeconds: number, rng: Rng): StepResult {
  result.scored = null;
  result.touched = null;
  result.netted = false;
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;
  if (settle(match)) return result;

  if (match.phase === 'point') {
    match.timer -= fixedDeltaSeconds;
    if (match.timer <= 0) serve(match, rng);
    return result;
  }
  if (match.phase === 'serving') {
    match.timer -= fixedDeltaSeconds;
    // The toss hangs still and then goes; the velocity was decided when it was tossed, so
    // the release is not a second decision made somewhere else.
    if (match.timer <= 0) match.phase = 'rally';
    return result;
  }

  const ball = match.ball;
  const prevY = ball.y;
  const prevZ = ball.z;
  // The exact integral of a constant acceleration rather than one Euler step of it. Both are
  // stable, but only this one puts the ball in the same place at 60 Hz and at 120 Hz: a
  // half-step of `vz` accumulates, and the spec template asks for the analytic form for
  // exactly this reason. x and y have no acceleration at all, so they are already exact.
  ball.x += ball.vx * fixedDeltaSeconds;
  ball.y += ball.vy * fixedDeltaSeconds;
  ball.z += ball.vz * fixedDeltaSeconds - (GRAVITY * fixedDeltaSeconds * fixedDeltaSeconds) / 2;
  ball.vz -= GRAVITY * fixedDeltaSeconds;

  if (clipNet(ball, prevY, prevZ)) result.netted = true;

  const striker = contactSeat(match);
  if (striker !== null) {
    play(match, striker);
    result.touched = striker;
    return result;
  }

  if (ball.z <= 0) {
    ball.z = 0;
    // Whoever's sand it landed on concedes.
    const scorer = otherOf(sideOf(ball.y));
    award(match, scorer);
    result.scored = scorer;
    return result;
  }

  if (
    ball.x < -BALL_RADIUS ||
    ball.x > COURT_WIDTH + BALL_RADIUS ||
    ball.y < -BALL_RADIUS ||
    ball.y > COURT_HEIGHT + BALL_RADIUS
  ) {
    // Only a ball deflected off the net can get here: a struck ball is aimed at a spot
    // inside the court. Whoever last touched it put it out.
    const scorer = otherOf(match.lastToucher);
    award(match, scorer);
    result.scored = scorer;
  }
  return result;
}

/**
 * The net.
 *
 * Tested on the crossing rather than at the step boundary — the ball can cover twenty units
 * in a step and the net is thinner than that, so a step-boundary test would let a fast flat
 * ball through it. The height at the crossing is interpolated from the step's endpoints,
 * which is exact for the horizontal axes and near enough on the parabola.
 *
 * A ball that clips the net comes back on the side it came from, and the player who put it
 * there may not touch it again — so it lands on their own sand and they lose the point.
 * That is the main way a rally ends, and it is deliberate.
 */
function clipNet(ball: Ball, prevY: number, prevZ: number): boolean {
  const before = prevY - NET_Y;
  const after = ball.y - NET_Y;
  if (before * after >= 0) return false;
  const fraction = (NET_Y - prevY) / (ball.y - prevY);
  const heightAtNet = prevZ + (ball.z - prevZ) * fraction;
  if (heightAtNet > NET_HEIGHT + BALL_RADIUS) return false;

  const side = before > 0 ? 1 : -1;
  ball.y = NET_Y + side * (BALL_RADIUS + 1);
  ball.vy = side * Math.abs(ball.vy) * NET_BOUNCE;
  ball.vx *= NET_BOUNCE;
  return true;
}

export function winnerOf(match: Readonly<Match>): Outcome {
  return match.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks. It keeps running where it last decided to until this expires,
   * exactly as a person who has committed to a spot does.
   *
   * No tier is quicker than a person: simple visual reaction is about 0.25 s and even the
   * hard tier is only quick within that range rather than past it.
   */
  readonly reaction: number;
  /** How far off the true landing spot it judges the ball, in logical units. */
  readonly error: number;
  /**
   * How high up the ball's descent it is willing to go and meet it, as a fraction of reach.
   *
   * The difference between attacking a ball and waiting for one. At one it runs at the
   * earliest point of the descent it could possibly get to and plays the ball at full
   * stretch, which floats the return and buys the rally another shot. At a fifth it stands
   * where the ball is going to land and plays it off its ankles, which goes back flat and
   * low and is the shot that finds the net.
   *
   * It is not a physical advantage: both tiers run at the same speed and reach the same
   * distance. It is only whether the bot has decided to go and get the ball.
   */
  readonly anticipation: number;
}

/**
 * The three tiers, as reaction, judgement and willingness to go and get the ball.
 *
 * None of them runs faster, reaches further, or reads anything off the state a player cannot
 * see on the same screen (CLAUDE.md rule 6). They differ in how long they take to read a new
 * shot, how well they judge where it is going, and how far up its descent they are prepared
 * to meet it — which is how people differ at this game.
 *
 * **The three numbers are closer together than they look, and deliberately.** A shot either
 * clears the net or it does not, so this game turns on a threshold and a small difference in
 * where a player meets the ball decides points. Every wider set measured produced a ladder of
 * straight hundreds, which is not a difficulty setting, it is a wall.
 *
 * Measured over 200 matches a pairing, seats swapped every other match: **hard beats normal
 * 75%, hard beats easy 100%, normal beats easy 100%**, with no seat bias in any tier against
 * itself — p1 takes 48.5%, 45.0% and 53.0% of 200 on easy, normal and hard. Every one of the
 * 1200 matches was decided; none was drawn and none ran out of clock. `SPEC.md` records the
 * method, and re-measuring is `node` over `dist/rules.js` rather than anything ceremonial.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.3, error: 80, anticipation: 0.55 },
  normal: { reaction: 0.2, error: 45, anticipation: 0.74 },
  hard: { reaction: 0.15, error: 36, anticipation: 0.8 },
});

/** How close is close enough; without it a bot jitters either side of its spot for ever. */
export const BOT_DEADZONE = 5;
/** How far ahead the prediction is allowed to run, in seconds. */
export const PREDICT_HORIZON = 2.4;
/** The prediction walks the ball at this rate whatever the simulation is running at. */
const PREDICT_STEP = 1 / 60;

export interface Interception {
  x: number;
  y: number;
  /** Seconds from now until the ball is there. */
  time: number;
  /** The height it would be met at. Zero means it was only caught off the sand. */
  height: number;
  /** False when no point on the flight can be got to in time — it is going to miss. */
  reachable: boolean;
}

/**
 * The earliest point on the ball's flight this player could actually get to.
 *
 * Walked forward with the same arithmetic the simulation uses — gravity, the net — rather
 * than extrapolated in a straight line, because a straight line is *worse* the further ahead
 * it looks: a ball that clips the net comes back, and a bot that had not noticed stands on
 * the wrong side of the court waiting for it.
 *
 * **Earliest, not final.** Aiming at where the ball will land is the obvious thing and it is
 * the thing that makes a bot worse the quicker it is: a player waiting on the landing spot
 * meets the ball at ankle height, and a ball met at ankle height goes back flat and low. So
 * this asks a different question — how soon can I be under it? — and answers with the first
 * point on the descent the player can reach. A quick, well-judged bot intercepts near the
 * top of its reach and returns a floated ball; a slow or badly-placed one catches up with it
 * near the sand and returns a flat one that struggles over the net. That is the whole
 * difficulty gradient, and it is made of nothing but being on time.
 *
 * None of it is information a person lacks. Everybody watching a ball in the air judges
 * where it is going and whether they can get there, and the court draws the marker on the
 * sand for both players. Writes into `out` and allocates nothing.
 */
export function predictIntercept(
  out: Interception,
  ball: Readonly<Ball>,
  seat: SeatId,
  fromX: number,
  fromY: number,
  speed: number,
  meetHeight: number,
  maxSeconds: number,
): Interception {
  let x = ball.x;
  let y = ball.y;
  let z = ball.z;
  let vx = ball.vx;
  let vy = ball.vy;
  let vz = ball.vz;
  let time = 0;
  out.reachable = false;
  const steps = Math.round(maxSeconds / PREDICT_STEP);
  for (let i = 0; i < steps; i += 1) {
    const prevY = y;
    const prevZ = z;
    x += vx * PREDICT_STEP;
    y += vy * PREDICT_STEP;
    z += vz * PREDICT_STEP - (GRAVITY * PREDICT_STEP * PREDICT_STEP) / 2;
    vz -= GRAVITY * PREDICT_STEP;
    time += PREDICT_STEP;

    const before = prevY - NET_Y;
    const after = y - NET_Y;
    if (before * after < 0) {
      const fraction = (NET_Y - prevY) / (y - prevY);
      const heightAtNet = prevZ + (z - prevZ) * fraction;
      if (heightAtNet <= NET_HEIGHT + BALL_RADIUS) {
        const side = before > 0 ? 1 : -1;
        y = NET_Y + side * (BALL_RADIUS + 1);
        vy = side * Math.abs(vy) * NET_BOUNCE;
        vx *= NET_BOUNCE;
      }
    }
    if (z <= 0) break;

    if (z <= meetHeight && sideOf(y) === seat) {
      const gapX = x - fromX;
      const gapY = y - fromY;
      // The reach counts toward getting there: you do not have to stand on the ball, only
      // near enough to play it. Half of it, so there is something left over for the error.
      if (Math.hypot(gapX, gapY) <= speed * time + REACH / 2) {
        out.x = x;
        out.y = y;
        out.time = time;
        out.height = z;
        out.reachable = true;
        return out;
      }
    }
  }
  // Nothing on the flight was reachable, so it runs at where the ball finishes and hopes.
  out.x = x;
  out.y = y;
  out.time = time;
  out.height = z > 0 ? z : 0;
  return out;
}

/**
 * What a bot carries between steps.
 *
 * The misjudgement is drawn **once per shot** and held. Re-rolling it every step is the
 * mistake `@duelbox/game-sdk`'s `bot-judgement` module exists to prevent: a fresh random
 * error sixty times a second averages to zero, so the bot stands on exactly the right spot
 * however large its supposed inaccuracy and every tier plays the same. A person misjudges
 * a ball once, as it leaves the other player's hands, and then runs to the wrong place.
 */
export interface BotState {
  readonly look: Judgement;
  aimX: number;
  aimY: number;
  biasX: number;
  biasY: number;
  /** The touch its current judgement is about, so a new shot is judged afresh. */
  shot: number;
}

export function createBotState(): BotState {
  return {
    look: createJudgement(),
    aimX: COURT_WIDTH / 2,
    aimY: NET_Y,
    biasX: 0,
    biasY: 0,
    shot: -1,
  };
}

export function resetBotState(state: BotState): void {
  resetJudgement(state.look);
  state.aimX = COURT_WIDTH / 2;
  state.aimY = NET_Y;
  state.biasX = 0;
  state.biasY = 0;
  state.shot = -1;
}

/** Where the bot is running, as a direction. Rewritten in place by {@link botIntent}. */
export interface Intent {
  dx: number;
  dy: number;
}

/** One prediction buffer for every bot, because the call is synchronous and short-lived. */
const prediction: Interception = { x: 0, y: 0, time: 0, height: 0, reachable: false };

/**
 * Decide where this bot wants to stand and run there.
 *
 * `rollX` and `rollY` are seeded values in [0, 1). The caller draws exactly two per seat per
 * step whether or not they are used, so the two seats consume the stream at the same rate
 * and a bot-against-bot match cannot be decided by one seat's draws shifting the other's.
 */
export function botIntent(
  out: Intent,
  match: Readonly<Match>,
  state: BotState,
  seat: SeatId,
  profile: BotProfile,
  fixedDeltaSeconds: number,
  rollX: number,
  rollY: number,
): Intent {
  if (state.shot !== match.touches) {
    state.shot = match.touches;
    state.biasX = misjudgement(rollX, profile.error);
    state.biasY = misjudgement(rollY, profile.error);
    // **Not** an invalidation, which would have it read the new shot on the very step it was
    // struck. A new shot starts the reaction clock instead: for that long it keeps running
    // where it was already going, and only then does it look at the new ball. That
    // distinction is the whole reason a reaction time does anything here — with an immediate
    // re-look, sweeping reaction from 0.40 s to 0.08 s moved the win rate by nothing at all,
    // because a ball in flight is ballistic and looking at it twice tells you no more than
    // looking at it once.
    commit(state.look, 0, profile.reaction);
  }

  if (shouldDecide(state.look, fixedDeltaSeconds)) {
    commit(state.look, 0, profile.reaction);
    chooseSpot(state, match, seat, profile);
  }

  const player = seat === 'p1' ? match.p1 : match.p2;
  const gapX = state.aimX - player.x;
  const gapY = state.aimY - player.y;
  const distance = Math.hypot(gapX, gapY);
  if (distance <= BOT_DEADZONE) {
    out.dx = 0;
    out.dy = 0;
  } else {
    out.dx = gapX / distance;
    out.dy = gapY / distance;
  }
  return out;
}

function chooseSpot(
  state: BotState,
  match: Readonly<Match>,
  seat: SeatId,
  profile: BotProfile,
): void {
  const bounds = halfOf(seat);
  if (match.phase !== 'rally' || match.lastToucher === seat) {
    // Nothing to answer — it has just played the ball, or the point has not started. Back
    // to the middle of its own half, which is what a person does.
    state.aimX = COURT_WIDTH / 2;
    state.aimY = readyY(seat);
    return;
  }

  const player = seat === 'p1' ? match.p1 : match.p2;
  predictIntercept(
    prediction,
    match.ball,
    seat,
    player.x,
    player.y,
    PLAYER_SPEED,
    REACH_HEIGHT * profile.anticipation,
    PREDICT_HORIZON,
  );

  // A ball that is not coming here is not its problem — it finishes on the other side of
  // the net, or it clipped the net and dropped back. Either way, back to the middle.
  if (!prediction.reachable && sideOf(prediction.y) !== seat) {
    state.aimX = COURT_WIDTH / 2;
    state.aimY = readyY(seat);
    return;
  }

  state.aimX = clamp(prediction.x + state.biasX, bounds.minX, bounds.maxX);
  state.aimY = clamp(prediction.y + state.biasY, bounds.minY, bounds.maxY);
}
