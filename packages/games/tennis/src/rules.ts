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
 * Tennis, as pure rules.
 *
 * A court seen from above, a net across the middle, one player each side, and a ball with a
 * **height**. Run around your own half. **Press to jump**, and the ball is struck wherever
 * it meets your racket: dead through the middle of the strings it goes away very fast, off
 * the frame it loops. One bounce a side; miss it twice and the point is theirs.
 *
 * The observed rule is one sentence — *click to jump with the player and hit the ball; if
 * you hit it with the center of the tennis racket, the ball will go really fast* — and the
 * two halves of it are the two halves of this file. {@link jump} is the click.
 * {@link contactSweetness} is the centre of the racket, and it is what {@link flightFor}
 * turns into pace.
 *
 * **Height is the axis that belongs to neither seat.** A `horizontal` split puts the two
 * people at the top and the bottom of the device, so a side-on game with gravity down the
 * screen would pull the ball toward one of them and the bottom seat would be playing a
 * different game from the top one. Gravity here acts on `z`, and the court is
 * point-symmetric about the net: every `y` below is paired with a `forwardOf`, so mirroring
 * the state top to bottom produces the mirrored result. `rules.test.ts` asserts that in two
 * strengths — decisions to the bit, measurements to a documented tolerance — and the note on
 * `MIRROR_TOLERANCE` there says why the second cannot be zero.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit and `z` is one too.
 */

/* ------------------------------------------------------------------ the court */

export const COURT_WIDTH = 600;
export const COURT_HEIGHT = 1000;

/** The net runs across the middle, so each half is exactly as deep as the other. */
export const NET_Y = COURT_HEIGHT / 2;

/**
 * How high the net stands, on the same `z` axis as everything else.
 *
 * Scaled from the real game and then nudged. A tennis court is 23.77 m long and the net is
 * 0.91 m at the centre, so a half of 500 units puts a true-to-life net at **38**; 44 is that
 * with a little added, because this net is also a *drawn* band on a court seen from above and
 * a player has to be able to read it as an obstacle. It is the number {@link clearingFlight}
 * inverts, so it sets how much pace a shot from the back of the court can carry and still go
 * over — see `SPEC.md`, which multiplies that out. **[ours]**
 */
export const NET_HEIGHT = 44;

/** How much of its pace a ball keeps when it clips the net and drops back. */
export const NET_BOUNCE = 0.28;

export const BALL_RADIUS = 14;

/** The height a ball has to be passing the net at to get over it, middle of the ball. */
export const NET_CLEARANCE = NET_HEIGHT + BALL_RADIUS;

/** Drawn radius of a player, and the margin that keeps them inside their own half. */
export const PLAYER_RADIUS = 34;

/**
 * How high a standing player's racket hangs, measured to the middle of the strings.
 *
 * A player is about 1.8 m; at the scale above that is 76 units, and a racket held at the ready
 * sits about there. It is also the number that decides which balls are playable standing: the
 * strings cover `z` from `76 − 52 = 24` to `76 + 52 = 128`, so a ball rolling along the ground
 * is not playable and a ball above head height is not either — you jump for the second and you
 * were too late for the first.
 */
export const RACKET_HEIGHT = 76;

/**
 * The radius of the strings themselves.
 *
 * Small on purpose, and it was the lever that fixed the rallies. With a 50-unit head, `hard`
 * against `hard` reached the 16-touch cap on two thirds of its points: the strings covered so
 * much of the `z` axis that no ball ever arrived at a height a standing player could not deal
 * with, so the jump bought nothing and nobody ever missed. At 38 the strings span 104 units of
 * height, a ball dropping out of a rally regularly arrives above them, and the button in the
 * observed rule is the answer.
 */
export const RACKET_RADIUS = 38;

/**
 * How far from the middle of the strings the ball may be and still be struck.
 *
 * The racket plus the ball, because a ball touching the outside of the frame is still a
 * contact. This is the denominator of {@link contactSweetness} and therefore the scale the
 * whole "centre of the racket" rule is measured on.
 */
export const REACH = RACKET_RADIUS + BALL_RADIUS;

/**
 * Downward acceleration on the ball.
 *
 * **Not** Beach Ball's 700, and not a number that could be borrowed from it. A beach ball
 * floats and a tennis ball does not, and this one is load-bearing twice over: it decides how
 * fast the ball falls through the band the strings cover, and it appears in the denominator of
 * {@link clearingFlight}, so it also decides how much pace a shot can carry and still clear the
 * net. Swept from 620 to 1300 against the measured rally length: below about 1100 the ball
 * hangs long enough that a well-placed bot is always under it, `hard` against `hard` never
 * missed, and 68% of points ran into the 16-touch cap. At 1300 that is 0.3%.
 */
export const BALL_GRAVITY = 1300;

/* ------------------------------------------------------------------ the player */

/** Units a second a player runs. Identical for both seats and both input families. */
export const PLAYER_SPEED = 320;

/**
 * The jump: the click in the observed rule, and the only action button this game has.
 *
 * Chosen from the two numbers a player actually feels — how high and how long — rather than
 * from an acceleration nobody can see. `JUMP_SPEED²/2·JUMP_GRAVITY` is **77.0** units of lift,
 * which brings the middle of the strings from 76 up to 153 and so covers the whole band a ball
 * dropping out of a rally arrives in; `2·JUMP_SPEED/JUMP_GRAVITY` is **0.717 s** in the air,
 * long enough to be a commitment and short enough to be a reflex.
 */
export const JUMP_SPEED = 430;
export const JUMP_GRAVITY = 1200;

/** Peak of a jump, in units. Derived, not chosen — see {@link JUMP_SPEED}. */
export const JUMP_APEX = (JUMP_SPEED * JUMP_SPEED) / (2 * JUMP_GRAVITY);
/** Seconds from leaving the ground to the top of the jump. */
export const JUMP_RISE = JUMP_SPEED / JUMP_GRAVITY;
/** Seconds in the air, start to finish. */
export const JUMP_HANG = 2 * JUMP_RISE;

/**
 * How long after landing before a player may jump again.
 *
 * Small, because the real cost of jumping is already paid in the rules rather than in a
 * cooldown: while you are up the strings are up too, so every low ball is out of reach, and
 * the median ball is met at 57 to 73 units — below where the strings hang standing. This
 * exists so that pressing the button over and over is not a way to spend a whole point in the
 * air. It is counted in seconds and resolved to the exact instant of landing, so it is the
 * same cooldown at 60 Hz and at 120 Hz.
 */
export const LAND_RECOVERY = 0.14;

/* ------------------------------------------------------------------ the ball off the court */

/** How much of its upward pace the ball keeps off the surface. */
export const BOUNCE_Z = 0.85;
/** How much of its forward pace the ball keeps off the surface. */
export const BOUNCE_DRAG = 0.55;

/**
 * A ceiling on how fast the ball may leave the surface, in units a second.
 *
 * A smash struck downward from the top of a jump arrives at the court very fast, and unclamped
 * it leaves again fast enough to spend a second and a half in the air and to be drawn halfway
 * up a phone. The clamp keeps the picture honest, and it is also what closes the termination
 * arithmetic: it bounds the gap between two touches at `2·420/1300 = 0.646 s`, which bounds a
 * rally, which bounds a point, which bounds a match. `SPEC.md` multiplies that chain out.
 * **[ours]**
 *
 * Nothing is ever *decided* on this value — it changes how long the ball hangs, never who
 * won anything — so clamping it cannot make two numbers equal and then judge on them.
 */
export const BOUNCE_MAX_RISE = 420;

/** Bounce resolutions allowed inside one step. Two ends the point, so three is slack. */
const MAX_BOUNCES_PER_STEP = 3;

/* ------------------------------------------------------------------ pace */

/**
 * How fast a ball leaves the strings, in units a second, before anything else is applied.
 *
 * **Pace rather than flight time, and that distinction is the observed rule.** The first
 * version of this file chose how long the ball would spend in the air and let the speed fall
 * out of that. The trouble is that a shot placed wide has further to travel, so a limp ball to
 * the corner and a fierce one down the middle came out at the same units a second: measured
 * over 40 seeded matches at every tier, a dead-centre contact left the strings at 757 units a
 * second and a frame contact at 730 — a **4% difference for the mechanic the whole game is
 * named after**.
 *
 * Choosing the pace and deriving the flight from the distance makes "really fast" a fact about
 * the ball rather than about the target. It also puts the risk in the right place: a fast ball
 * spends less time in the air, so it is hit *up* less, so it clears the net by less — which is
 * exactly the trade {@link netClearanceOf} describes.
 */
export const BASE_PACE = 620;

/**
 * How much more pace the middle of the strings gives than the frame.
 *
 * **This is the observed rule, as a number.** Dead centre earns 1.95× the pace of the frame
 * before {@link clearingFlight} takes its cut. What actually reaches the ball is less than
 * that, and the honest figure is the measured one: reconstructed from sampled state over 600
 * seeded bot matches, a centred contact leaves the strings at **1172–1187** units a second and
 * a frame contact at **810–872**, so the ball really does go **1.34× to 1.47×** faster. Wider
 * than 0.95 and a centred contact is unreturnable whatever anybody does, which is not a game;
 * narrower and "really fast" is a claim the ball does not back up. `SPEC.md` has the method,
 * and it never reads `lastSweet` to get there.
 */
export const PACE_GAIN = 0.95;

/**
 * How much more pace every touch of a rally adds, and the ceiling on that.
 *
 * A rally here ends because somebody hits a ball the other could not get to, so it does not
 * strictly need to escalate. This is the insurance: two players who both keep catching the
 * frame trade loopy balls neither can miss, and without it that has no end but the hard cap.
 * Small, and capped at half again by the eighth touch, so it tightens a long rally without
 * deciding a short one — measured, the mean rally is 1.9 to 3.0 strokes and the escalation is
 * at its ceiling in well under 1% of them.
 */
export const RALLY_PACE = 0.06;
export const RALLY_PACE_MAX = 0.5;

/**
 * Floor and ceiling on how long a struck ball is in the air.
 *
 * The floor keeps a very short shot from crossing the court inside three frames, where nothing
 * — a racket, the net test, a person's eye — samples finely enough to see it. The ceiling keeps
 * a limp frame shot from hanging for ever. Neither is ever *decided* on: they change how long
 * the ball is in the air, never who won anything, so clamping here cannot make two numbers
 * equal and then judge between them. The ceiling is also the first term in the termination
 * arithmetic in `SPEC.md`.
 */
export const MIN_FLIGHT = 0.2;
export const MAX_FLIGHT = 1.6;

/**
 * The hard cap on a rally, in touches.
 *
 * Belt and braces on top of the escalation above: past this the ball is dead, nobody may touch
 * it, so it lands, bounces twice and the point resolves. It is here because a rally that cannot
 * end is the classic way a racket game hangs, and a guarantee that depends on tuning is not a
 * guarantee. Measured over 3244 points of bot play it was reached twice — 0.06% — and the
 * longest rally seen was 15 strokes.
 */
export const MAX_RALLY_TOUCHES = 16;

/** The pace a contact of this quality buys, this far into the rally. */
export function paceFor(touches: number, sweetness: number): number {
  const sweet = sweetness < 0 ? 0 : sweetness > 1 ? 1 : sweetness;
  let rally = touches * RALLY_PACE;
  if (rally > RALLY_PACE_MAX) rally = RALLY_PACE_MAX;
  return BASE_PACE * (1 + PACE_GAIN * sweet) * (1 + rally);
}

/** How long that pace takes to cover a shot of this length, floored and capped. */
export function flightFor(touches: number, sweetness: number, distance: number): number {
  const flight = distance / paceFor(touches, sweetness);
  return flight < MIN_FLIGHT ? MIN_FLIGHT : flight > MAX_FLIGHT ? MAX_FLIGHT : flight;
}

/* ------------------------------------------------------------------ placement */

/** How far from the sidelines and the back line a shot may be aimed. */
export const TARGET_MARGIN = 45;
/** The closest to the net a shot may be aimed, so even a drop shot has to cross. */
export const NET_CLEAR = 120;
/**
 * How far off centre the widest shot lands.
 *
 * Set against what a player can actually cover, which is `PLAYER_SPEED × flight + REACH`. A
 * typical struck ball is in the air about 0.7 s, so a runner starting from the middle covers
 * `320 × 0.7 + 52 = 276` units — and a fierce one is in the air 0.5 s, which is 212. 215 sits
 * between the two, so it is the *pace* that decides whether a corner is reachable rather than
 * the placement on its own. Above 255 it would be outside the court in any case.
 */
export const PLACE_WIDTH = 215;
/** How deep an unplaced shot lands, measured from the net. */
export const PLACE_MID_DEPTH = 280;
/** How much depth the contact point and the run add or take away. */
export const PLACE_DEPTH = 150;
/** The deepest a shot may be aimed, measured from the net. */
export const PLACE_MAX_DEPTH = 400;

/**
 * How much of a running player's own motion goes into the shot.
 *
 * Re-derived rather than inherited. Beach Ball records that at 0.55 this term inverted its
 * bot ladder — a slow bot arrived late, was therefore still running when it played the ball,
 * and placed better than a bot that had got there early and stopped. The same trap is here,
 * and it is worse here, because arriving early is also how you get the strings onto the
 * middle of the ball. 0.28 was measured against the ladder in `SPEC.md`: running adds to a
 * shot you were going to play anyway and never substitutes for standing in the right place.
 */
export const MOVE_TRANSFER = 0.28;

/**
 * How far out on the strings a contact has to be to place the ball at the widest angle.
 *
 * A fraction of {@link REACH}, and it exists to **partly uncouple pace from placement**.
 * Both come from the same offset — how far from the middle decides the pace, which way from
 * the middle decides the direction — and at 1 that coupling is total: the only way to hit
 * into the corner is to catch the ball on the frame, which is by construction the slowest
 * shot there is. Two evenly matched bots then trade balls that are either fast and central or
 * wide and limp, and every one of them is reachable: at 1, `hard` against `hard` averaged 7.2
 * strokes a point and ran into the 16-touch cap on **21%** of them.
 *
 * Below 1, a contact part-way out on the strings already commands the full angle while still
 * carrying most of its pace, so a fast ball into the corner exists and a rally can be ended by
 * playing one. At 0.7 the same pairing averages 3.0 strokes and reaches the cap on 0.3%.
 */
export const AIM_SPAN = 0.7;

/**
 * How far behind the net a player waits between shots.
 *
 * Shots land between {@link NET_CLEAR} (120) and {@link PLACE_MAX_DEPTH} (400) from the net,
 * so 260 is the middle of the band a player has to cover and no nearer either end.
 */
export const READY_DEPTH = 260;
/** How far behind the net a server stands. */
export const SERVE_DEPTH = 400;

/* ------------------------------------------------------------------ the clock */

export const TARGET_POINTS = 4;

/**
 * The backstop that ends a match nothing else ends.
 *
 * `roundSeconds` in the manifest is read by the catalogue card and ends nothing — see the
 * note at the top of `apps/web/src/data/termination.test.ts`. Four points arrive well inside
 * this at every tier (measured in `SPEC.md`), so it is never reached in practice. It is here
 * because "never reached in practice" is not a guarantee.
 */
export const MATCH_SECONDS = 150;

/** How long the toss hangs above the server, so both players can look up. */
export const SERVE_SECONDS = 0.9;
/** The pause after a point, before the next serve. */
export const POINT_SECONDS = 0.8;
/** How high above the server the ball is struck from on the serve. */
export const SERVE_HEIGHT = 130;
/** How cleanly a serve is struck. Fixed, so a serve is never a lottery. */
export const SERVE_SWEET = 0.55;
/** How far off centre and how much deeper or shorter a serve may be nudged. */
export const SERVE_SPREAD_X = 130;
export const SERVE_SPREAD_Y = 80;

/* ------------------------------------------------------------------ state */

export interface Player {
  x: number;
  y: number;
  /** Height of the feet above the court. Zero on the ground. */
  z: number;
  /** What it actually managed to move last step, per second. This is what aims a shot. */
  vx: number;
  vy: number;
  /** Vertical speed of the jump. */
  vz: number;
  /** Seconds left before this player may jump again. */
  recovery: number;
}

export interface Ball {
  x: number;
  y: number;
  /** Height above the court. Zero is the surface. */
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
  /** Seconds left of the toss or of the pause after a point. */
  timer: number;
  /** Who serves next, which is whoever just lost the point. */
  server: SeatId;
  /** Who last struck the ball. Nobody may strike it twice running. */
  lastToucher: SeatId;
  /** Touches played in the current rally, the serve counting as the first. */
  touches: number;
  /** Bounces since the last touch. Two ends the point. */
  bounces: number;
  /** How cleanly the last shot was struck, 0 off the frame to 1 dead centre. */
  lastSweet: number;
  /** Who took the last point, for the renderer. */
  scorer: SeatId | null;
  /** Where the last shot was aimed, for the landing marker both players read. */
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
 * The patch of court a seat may stand on. Exact mirrors about the net, so neither seat has
 * a step more room than the other.
 */
export function halfOf(seat: SeatId): Bounds {
  return seat === 'p1' ? P1_HALF : P2_HALF;
}

/** Which half a point of the court belongs to. The net line itself counts as p1's. */
export function sideOf(y: number): SeatId {
  return y >= NET_Y ? 'p1' : 'p2';
}

/** Where a seat waits between shots. Mirrors exactly about the net. */
export function readyY(seat: SeatId): number {
  return NET_Y - forwardOf(seat) * READY_DEPTH;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * How high a shot passes over the net, given where it was struck from and where it is going.
 *
 * With `z(t) = z + v·t − G·t²/2` solved so the ball is on the court at `t = flight`, the
 * height at the net comes out in closed form:
 *
 * ```
 * φ = distance to the net / distance to the target
 * height at the net = (1 − φ)·(z + G·flight²·φ/2)
 * ```
 *
 * Which is the whole game in one line. Two terms, and a player trades them against each
 * other every shot: **how high you met the ball**, and **how long you gave it**. Hitting the
 * middle of the strings shortens the flight, so the second term collapses and the first has
 * to carry it — which means getting up to the ball. From the back of the court a full-pace
 * drive needs the strings around 118 units up and they hang at 76, so it needs a jump. From
 * the front it does not, which is the reason to come forward.
 *
 * Exported because `rules.test.ts` checks the shots the simulation actually produces against
 * it rather than against a remembered number, and `SPEC.md` multiplies it out.
 */
export function netClearanceOf(
  height: number,
  netDistance: number,
  targetDistance: number,
  flight: number,
): number {
  if (targetDistance <= 0) return height;
  const phi = netDistance / targetDistance;
  return (1 - phi) * (height + (BALL_GRAVITY * flight * flight * phi) / 2);
}

/**
 * Margin over the top of the net that a shot is aimed to leave itself.
 *
 * A few units, so that the arc the solver produces clears in double precision as well as in
 * algebra. Nothing is decided on it.
 */
export const NET_MARGIN = 8;

/**
 * The shortest flight this shot can be given and still go over the net.
 *
 * **This is the correction that made the difficulty ladder point the right way up.** Pace and
 * flight are two ends of the same stick: a fiercer contact means a shorter flight, a shorter
 * flight means a flatter arc, and a flat enough arc finds the net. Left alone that makes
 * striking the ball *well* a mistake — measured over 40 seeded matches, the `hard` tier put
 * 21% of its shots into the net against `normal`'s 11%, and lost the series 31–69 while
 * out-striking its opponent on every other number. A game whose headline verb is punished is
 * the same failure as one whose headline verb never happens.
 *
 * So a shot is given the pace the strings earned it, **or** the slowest arc that clears,
 * whichever is slower. Inverting {@link netClearanceOf} for the flight time:
 *
 * ```
 * f² = 2·((clearance / (1 − φ)) − z) / (G·φ)
 * ```
 *
 * The pace a player can actually use is therefore set by *where and how high* they met the
 * ball, which is the observed rule's own second clause: from the back of the court a standing
 * contact is throttled and the same contact at the top of a jump is not. What is left over —
 * a ball met below the top of the net and a stride from it — genuinely cannot be lifted over,
 * and that is the one way a shot still finds the net.
 */
export function clearingFlight(
  height: number,
  netDistance: number,
  targetDistance: number,
): number {
  const clearance = NET_CLEARANCE + NET_MARGIN;
  if (netDistance <= 0) return height >= clearance ? 0 : MAX_FLIGHT;
  if (targetDistance <= netDistance) return MAX_FLIGHT;
  const phi = netDistance / targetDistance;
  const need = clearance / (1 - phi) - height;
  if (need <= 0) return 0;
  return Math.sqrt((2 * need) / (BALL_GRAVITY * phi));
}

/**
 * The flight a shot actually gets: what the strings earned, floored by what the net demands.
 */
export function shotFlight(
  touches: number,
  sweetness: number,
  height: number,
  netDistance: number,
  targetDistance: number,
  distance: number,
): number {
  let flight = flightFor(touches, sweetness, distance);
  const clearing = clearingFlight(height, netDistance, targetDistance);
  if (flight < clearing) flight = clearing;
  return flight > MAX_FLIGHT ? MAX_FLIGHT : flight;
}

export function createMatch(rng: Rng): Match {
  const match: Match = {
    p1: { x: COURT_WIDTH / 2, y: readyY('p1'), z: 0, vx: 0, vy: 0, vz: 0, recovery: 0 },
    p2: { x: COURT_WIDTH / 2, y: readyY('p2'), z: 0, vx: 0, vy: 0, vz: 0, recovery: 0 },
    ball: { x: COURT_WIDTH / 2, y: NET_Y, z: SERVE_HEIGHT, vx: 0, vy: 0, vz: 0 },
    score: { p1: 0, p2: 0 },
    phase: 'serving',
    timer: SERVE_SECONDS,
    server: 'p1',
    lastToucher: 'p1',
    touches: 0,
    bounces: 0,
    lastSweet: 0,
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
  match.lastSweet = 0;
  // A coin flip rather than "p1 always". Serving is a small advantage — the server plays one
  // shot nobody is contesting — and handing it to the same seat every match is exactly the
  // kind of seat bias that only ever shows up in aggregate.
  match.server = rng.bool() ? 'p1' : 'p2';
  serve(match, rng);
}

function resetPlayer(player: Player, x: number, y: number): void {
  player.x = x;
  player.y = y;
  player.z = 0;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.recovery = 0;
}

/**
 * Put both players on their marks and strike the serve.
 *
 * The serve is **timed, not triggered**. Waiting for somebody to press something is how a
 * match stops progressing when nobody presses anything, and the termination guard drives
 * every game with two bots and no human input at all.
 *
 * It cannot fault: it is aimed like any other shot, from a fixed height and a fixed quality
 * of contact, so it always crosses and always lands in. A serve that could fault would hand
 * the receiver free points, and one that could not vary would open every point identically —
 * hence the seeded nudge, and nothing more than a nudge.
 */
export function serve(match: Match, rng: Rng): void {
  const server = match.server;
  const receiver = otherOf(server);
  const forward = forwardOf(server);

  const serverPlayer = server === 'p1' ? match.p1 : match.p2;
  const receiverPlayer = receiver === 'p1' ? match.p1 : match.p2;
  resetPlayer(serverPlayer, COURT_WIDTH / 2, NET_Y - forward * SERVE_DEPTH);
  resetPlayer(receiverPlayer, COURT_WIDTH / 2, readyY(receiver));

  const ball = match.ball;
  ball.x = serverPlayer.x;
  ball.y = serverPlayer.y;
  ball.z = SERVE_HEIGHT;

  const aimX = clamp(
    COURT_WIDTH / 2 + (rng.float() - 0.5) * 2 * SERVE_SPREAD_X,
    TARGET_MARGIN,
    COURT_WIDTH - TARGET_MARGIN,
  );
  const aimY = NET_Y + forward * (PLACE_MID_DEPTH + (rng.float() - 0.5) * 2 * SERVE_SPREAD_Y);
  const span = Math.hypot(aimX - ball.x, aimY - ball.y);
  aimAt(
    match,
    aimX,
    aimY,
    shotFlight(0, SERVE_SWEET, ball.z, Math.abs(NET_Y - ball.y), Math.abs(aimY - ball.y), span),
  );

  match.touches = 1;
  match.bounces = 0;
  match.lastToucher = server;
  match.lastSweet = SERVE_SWEET;
  match.phase = 'serving';
  match.timer = SERVE_SECONDS;
}

/**
 * Point the ball at a spot on the court and give it the arc that lands there.
 *
 * The vertical speed is solved from the flight time rather than chosen, which is what makes
 * the middle of the racket dangerous in both directions: a shorter flight is a flatter arc,
 * and a flat enough arc does not clear the net. Struck high enough with a short enough
 * flight it solves *negative*, which is a smash — hit down over the net rather than up over
 * it, and the only shot in the game that can be both flat and safe.
 */
function aimAt(match: Match, aimX: number, aimY: number, flight: number): void {
  const ball = match.ball;
  if (ball.z < 0) ball.z = 0;
  ball.vx = (aimX - ball.x) / flight;
  ball.vy = (aimY - ball.y) / flight;
  // z(flight) = z + vz*flight - G*flight²/2 = 0
  ball.vz = (BALL_GRAVITY * flight) / 2 - ball.z / flight;
  match.aimX = aimX;
  match.aimY = aimY;
}

/**
 * Run a player, no faster than {@link PLAYER_SPEED}, and never off their own half.
 *
 * `dx`/`dy` is an intent, not a position: a thumb and a key both come in through here at the
 * same speed limit, so neither instrument can arrive anywhere sooner than the other. The
 * velocity written back is what the player *managed*, which is why running into a wall puts
 * nothing on the shot. Airborne is the same speed as grounded — a jump costs you the low
 * balls, which is a far heavier price than a movement penalty and needs no second rule.
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

/** Whether this seat could leave the ground right now. */
export function canJump(match: Readonly<Match>, seat: SeatId): boolean {
  const player = seat === 'p1' ? match.p1 : match.p2;
  return player.z <= 0 && player.recovery <= 0;
}

/**
 * The click. Leaves the ground, if the ground is where this player currently is.
 *
 * Returns whether it took, so a caller can show the refusal rather than swallow it. Holding
 * the button does nothing extra: `actionPressed` is one step wide in the engine, and this
 * refuses anybody already in the air.
 */
export function jump(match: Match, seat: SeatId): boolean {
  if (!canJump(match, seat)) return false;
  const player = seat === 'p1' ? match.p1 : match.p2;
  player.vz = JUMP_SPEED;
  return true;
}

/**
 * Advance one player's jump, and their landing cooldown.
 *
 * The landing is solved to the exact instant inside the step rather than snapped to the step
 * boundary, so the cooldown a player is left with is the same at 60 Hz and at 120 Hz. The
 * rise itself uses the analytic integral of a constant acceleration, not one Euler step of
 * it, for the same reason.
 */
export function stepPlayer(player: Player, fixedDeltaSeconds: number): void {
  const dt = fixedDeltaSeconds;
  if (player.z > 0 || player.vz > 0) {
    const next = player.z + player.vz * dt - (JUMP_GRAVITY * dt * dt) / 2;
    if (next > 0) {
      player.z = next;
      player.vz -= JUMP_GRAVITY * dt;
      if (player.recovery > 0) player.recovery = 0;
      return;
    }
    const under = player.vz * player.vz + 2 * JUMP_GRAVITY * player.z;
    const landed = (player.vz + Math.sqrt(under > 0 ? under : 0)) / JUMP_GRAVITY;
    const airborne = landed < 0 ? 0 : landed > dt ? dt : landed;
    player.z = 0;
    player.vz = 0;
    player.recovery = LAND_RECOVERY - (dt - airborne);
    if (player.recovery < 0) player.recovery = 0;
    return;
  }
  if (player.recovery > 0) {
    player.recovery -= dt;
    if (player.recovery < 0) player.recovery = 0;
  }
}

/* ------------------------------------------------------------------ contact */

/**
 * How near the middle of the strings a ball is, 0 off the frame and 1 dead centre.
 *
 * **The observed rule, measured.** The strings are a ball of {@link REACH} centred on
 * `(x, y, z + RACKET_HEIGHT)`, so jumping does not extend your reach — it *moves* it, and a
 * ball dropping out of the sky that would have caught the bottom of the frame standing meets
 * the middle of the strings at the top of a jump. That is the whole reason to press the
 * button, and it is why the two clauses of the observed rule are one mechanic rather than two.
 */
export function sweetnessOf(distance: number): number {
  const sweet = 1 - distance / REACH;
  return sweet < 0 ? 0 : sweet > 1 ? 1 : sweet;
}

/** How near the middle of the strings the ball is *right now*. */
export function contactSweetness(ball: Readonly<Ball>, player: Readonly<Player>): number {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dz = ball.z - (player.z + RACKET_HEIGHT);
  return sweetnessOf(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

/** Where and how well the ball met the strings. Rewritten in place, never allocated. */
export interface Contact {
  /** Where on the court the ball met the strings. */
  x: number;
  y: number;
  z: number;
  /** Offset from the middle of the strings at that instant. */
  offX: number;
  offY: number;
  offZ: number;
  /** How far from the middle of the strings, in units. */
  distance: number;
  /** Where in the step it happened, 0 at the start and 1 at the end. */
  when: number;
}

export function createContactRecord(): Contact {
  return { x: 0, y: 0, z: 0, offX: 0, offY: 0, offZ: 0, distance: 0, when: 0 };
}

/**
 * The nearest the ball's path came to the middle of the strings during one step.
 *
 * **This is the single most important function in the game, and the first version of it was
 * wrong in a way that quietly deleted the headline rule.** Testing "is the ball inside the
 * strings?" once a step strikes the ball on the step it *arrives*, which is the step it is at
 * the very edge of them — so across 40 measured matches not one contact in 4769 was anywhere
 * near the middle and "hit it in the centre and it goes really fast" described something that
 * could not happen. All nine global guards passed the whole time, because a match still ended
 * and still scored.
 *
 * A racket does not work like that. The ball crosses the strings, and how well it was struck
 * is how close to the middle it passed — which is a property of the *path*, not of any one
 * sample of it. So both the ball and the racket are advanced, the ball's position relative to
 * the strings is taken before and after, and the closest point on the segment between them is
 * the contact. Sampling noise disappears with it: a ball crossing at 50 units a step used to
 * be judged wherever the sixtieth of a second happened to fall.
 *
 * `when` is where in the step the nearest point fell. At exactly 1 the ball is still closing
 * and the swing has not happened yet — the caller waits a step, which is what lets a player
 * line the middle of the strings up on a ball that is still coming.
 */
export function closestApproach(
  out: Contact,
  r0x: number,
  r0y: number,
  r0z: number,
  r1x: number,
  r1y: number,
  r1z: number,
): Contact {
  const dx = r1x - r0x;
  const dy = r1y - r0y;
  const dz = r1z - r0z;
  const den = dx * dx + dy * dy + dz * dz;
  let t: number;
  if (den <= 1e-12) {
    // The ball is holding station on the strings — a player running exactly with it. There is
    // no approach to find, so the swing is now.
    t = 0;
  } else {
    t = -(r0x * dx + r0y * dy + r0z * dz) / den;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  out.offX = r0x + dx * t;
  out.offY = r0y + dy * t;
  out.offZ = r0z + dz * t;
  out.distance = Math.sqrt(out.offX * out.offX + out.offY * out.offY + out.offZ * out.offZ);
  out.when = t;
  return out;
}

/**
 * Whether `seat` is allowed to strike the ball at all, before any geometry is looked at.
 *
 * - **It is on your side of the net.** A player's half stops short of the net but their racket
 *   does not, so without this a player on their own line could pick a ball out of the air over
 *   the other person's court.
 * - **You did not strike it last.** One touch a side. It is also what makes the classic
 *   racket-game hang impossible: a ball with no pace left cannot rest against a player and be
 *   struck again every step, because that player may not touch it.
 * - **The rally has touches left.** See {@link MAX_RALLY_TOUCHES}.
 */
export function eligibleSeat(match: Readonly<Match>): SeatId | null {
  if (match.touches >= MAX_RALLY_TOUCHES) return null;
  const seat = sideOf(match.ball.y);
  if (match.lastToucher === seat) return null;
  return seat;
}

/** Eligible, and the ball inside the strings this instant. */
export function canPlay(match: Readonly<Match>, seat: SeatId): boolean {
  if (eligibleSeat(match) !== seat) return false;
  const ball = match.ball;
  const player = seat === 'p1' ? match.p1 : match.p2;
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dz = ball.z - (player.z + RACKET_HEIGHT);
  return dx * dx + dy * dy + dz * dz <= REACH * REACH;
}

/** Which seat, if either, has the ball inside its strings this instant. */
export function contactSeat(match: Readonly<Match>): SeatId | null {
  if (canPlay(match, 'p1')) return 'p1';
  if (canPlay(match, 'p2')) return 'p2';
  return null;
}

/** The contact the ball and the strings make right now, with no sweep. For tests and setup. */
export function instantContact(out: Contact, match: Readonly<Match>, seat: SeatId): Contact {
  const ball = match.ball;
  const player = seat === 'p1' ? match.p1 : match.p2;
  out.offX = ball.x - player.x;
  out.offY = ball.y - player.y;
  out.offZ = ball.z - (player.z + RACKET_HEIGHT);
  out.distance = Math.sqrt(out.offX * out.offX + out.offY * out.offY + out.offZ * out.offZ);
  out.x = ball.x;
  out.y = ball.y;
  out.z = ball.z;
  out.when = 1;
  return out;
}

/**
 * Strike the ball.
 *
 * **Where on the strings it was met decides both things at once.** How far from the middle
 * decides the pace, which is the observed rule. Which *way* from the middle decides the
 * placement — met on your left it goes left, met in front of you it goes deep, met behind you
 * it drops short — and your own run adds to the placement at {@link MOVE_TRANSFER}.
 *
 * The two are the same measurement read two ways, and that is the trade the game is made of:
 * a shot reached at full stretch is by construction struck off the frame and arrives slowly,
 * and a shot struck dead centre by construction goes back down the middle unless you were
 * moving when you hit it. There is no aim button and no power button; standing in the right
 * place is both.
 */
export function play(match: Match, seat: SeatId, contact: Readonly<Contact>): void {
  const ball = match.ball;
  const player = seat === 'p1' ? match.p1 : match.p2;
  const forward = forwardOf(seat);

  const sweet = sweetnessOf(contact.distance);

  const lateral = clamp(
    contact.offX / (REACH * AIM_SPAN) + clamp(player.vx / PLAYER_SPEED, -1, 1) * MOVE_TRANSFER,
    -1,
    1,
  );
  const depth = clamp(
    (forward * contact.offY) / (REACH * AIM_SPAN) +
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

  // The ball leaves from where it actually met the strings, not from wherever the step
  // boundary left it. Without this a shot is launched from up to fifty units past its own
  // contact point and the arc that clears the net is computed from the wrong place.
  ball.x = contact.x;
  ball.y = contact.y;
  ball.z = contact.z;

  const span = Math.hypot(aimX - ball.x, aimY - ball.y);
  const flight = shotFlight(
    match.touches,
    sweet,
    ball.z,
    Math.abs(NET_Y - ball.y),
    Math.abs(aimY - ball.y),
    span,
  );
  aimAt(match, aimX, aimY, flight);
  match.touches += 1;
  match.bounces = 0;
  match.lastToucher = seat;
  match.lastSweet = sweet;
}

/* ------------------------------------------------------------------ the step */

export interface StepResult {
  /** The seat that took a point this step, or null. */
  scored: SeatId | null;
  /** The seat that struck the ball this step, or null. */
  touched: SeatId | null;
  /** How cleanly it was struck, when it was. */
  sweetness: number;
  /** True when the ball found the net this step. */
  netted: boolean;
  /** How many times the ball came off the court this step. */
  bounced: number;
}

/** Rewritten in place each step rather than allocated. Read it before the next call. */
const result: StepResult = {
  scored: null,
  touched: null,
  sweetness: 0,
  netted: false,
  bounced: 0,
};

/** The step's contact, rewritten in place. */
const strike: Contact = createContactRecord();

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
  // The seat that lost the point serves next, which keeps a one-sided match from running
  // away from the player who is already behind. **[ours]**
  match.server = otherOf(seat);
  match.phase = 'point';
  match.timer = POINT_SECONDS;
  settle(match);
}

/**
 * Move the ball for one step, resolving every bounce at the exact instant it happens.
 *
 * The bounce is why this is not two lines. Snapping the ball to the surface at the step
 * boundary and reversing it there loses a fraction of a step of rise, and loses a *different*
 * fraction at 120 Hz than at 60 — so the same rally would play out differently on two devices,
 * which rule 8 forbids. Solving `z + v·τ − G·τ²/2 = 0` puts the bounce where it belongs and
 * the rest of the step runs on from there.
 *
 * Returns how many bounces happened. Bounded by {@link MAX_BOUNCES_PER_STEP}, which is slack
 * on top of the two that end a point, and there is no unbounded loop anywhere in it.
 */
function advanceBall(ball: Ball, fixedDeltaSeconds: number): number {
  let remaining = fixedDeltaSeconds;
  let bounces = 0;
  if (ball.z <= 0 && ball.vz <= 0) {
    // A ball at rest. It cannot arise while a point is live — two bounces end one — but a
    // resting ball must not be mistaken for one bouncing infinitely often.
    ball.x += ball.vx * remaining;
    ball.y += ball.vy * remaining;
    ball.z = 0;
    return 0;
  }
  for (let i = 0; i < MAX_BOUNCES_PER_STEP; i += 1) {
    const next = ball.z + ball.vz * remaining - (BALL_GRAVITY * remaining * remaining) / 2;
    if (next > 0) {
      // z is concave, so two endpoints above the court mean the whole step was above it.
      ball.x += ball.vx * remaining;
      ball.y += ball.vy * remaining;
      ball.z = next;
      ball.vz -= BALL_GRAVITY * remaining;
      return bounces;
    }
    const under = ball.vz * ball.vz + 2 * BALL_GRAVITY * ball.z;
    const landing = (ball.vz + Math.sqrt(under > 0 ? under : 0)) / BALL_GRAVITY;
    const flown = landing < 0 ? 0 : landing > remaining ? remaining : landing;
    ball.x += ball.vx * flown;
    ball.y += ball.vy * flown;
    ball.z = 0;
    const impact = ball.vz - BALL_GRAVITY * flown;
    let rise = -impact * BOUNCE_Z;
    if (rise < 0) rise = 0;
    if (rise > BOUNCE_MAX_RISE) rise = BOUNCE_MAX_RISE;
    ball.vz = rise;
    ball.vx *= BOUNCE_DRAG;
    ball.vy *= BOUNCE_DRAG;
    bounces += 1;
    remaining -= flown;
    if (remaining <= 0 || bounces >= 2) return bounces;
  }
  // Out of resolutions inside one step: whatever is left has no bounce in it.
  ball.z = 0;
  ball.vz = 0;
  return bounces;
}

/**
 * The net.
 *
 * Tested on the **crossing** rather than at the step boundary: a struck ball can cover fifty
 * units in a step and the net is thinner than that, so a step-boundary test would let a fast
 * flat ball straight through it. The height at the crossing is solved on the same parabola the
 * ball is actually flying, so the answer is exact rather than a chord under it — a chord is
 * always *below* a concave arc and would fail balls that in fact cleared.
 *
 * A ball that clips the net drops back on the side it came from, and the player who put it
 * there may not touch it again — so it bounces twice on their own court and they lose the
 * point. That is the second commonest way a point ends here, after simply not getting there.
 */
function clipNet(
  ball: Ball,
  prevY: number,
  prevZ: number,
  prevVz: number,
  bounced: number,
  fixedDeltaSeconds: number,
): boolean {
  // Asked as "did the ball change sides?", using the same half-open convention `sideOf` uses,
  // rather than as a sign product. A sign product answers *no* whenever either endpoint is
  // exactly on the net line, and a ball that lands on `y = 500` at a step boundary then walks
  // straight through the net on the following step however low it is. That is measure-zero and
  // it turned up on the third seed a test tried.
  const from = sideOf(prevY);
  if (from === sideOf(ball.y)) return false;
  const fraction = (NET_Y - prevY) / (ball.y - prevY);
  let heightAtNet: number;
  if (bounced === 0) {
    // Exact: y is linear in t through a step with no bounce in it, so the fraction along y is
    // the fraction along the step, and the height there is the parabola at that instant.
    const t = fraction * fixedDeltaSeconds;
    heightAtNet = prevZ + prevVz * t - (BALL_GRAVITY * t * t) / 2;
  } else {
    // A bounce and a net crossing inside one step cannot happen — a shot is aimed at least
    // NET_CLEAR (120) from the net and the fastest ball covers about 53 units in a step — but
    // if those numbers ever move, fall back on the chord rather than on a parabola that is no
    // longer the path the ball took.
    heightAtNet = prevZ + (ball.z - prevZ) * fraction;
  }
  if (heightAtNet > NET_CLEARANCE) return false;

  const side = from === 'p1' ? 1 : -1;
  ball.y = NET_Y + side * (BALL_RADIUS + 1);
  ball.vy = side * Math.abs(ball.vy) * NET_BOUNCE;
  ball.vx *= NET_BOUNCE;
  return true;
}

/**
 * Advance one fixed step.
 *
 * The order is fixed and it matters: the jumps, then the clock, then the ball, then the net,
 * then the bounce, then the swing, then the court's edges. The swing is tested *after* the
 * bounce because two bounces is the point over in tennis and a racket arriving on the same
 * step cannot un-lose it; it is tested *before* the edges so a ball reached at the very limit
 * is played rather than lost.
 */
export function step(match: Match, fixedDeltaSeconds: number, rng: Rng): StepResult {
  result.scored = null;
  result.touched = null;
  result.sweetness = 0;
  result.netted = false;
  result.bounced = 0;
  if (match.phase === 'over') return result;

  // Where the strings were before this step's running, reconstructed from the velocity
  // `movePlayer` recorded, so the sweep below has both ends of the racket's own path.
  const dt = fixedDeltaSeconds;
  const p1x0 = match.p1.x - match.p1.vx * dt;
  const p1y0 = match.p1.y - match.p1.vy * dt;
  const p1z0 = match.p1.z + RACKET_HEIGHT;
  const p2x0 = match.p2.x - match.p2.vx * dt;
  const p2y0 = match.p2.y - match.p2.vy * dt;
  const p2z0 = match.p2.z + RACKET_HEIGHT;

  stepPlayer(match.p1, dt);
  stepPlayer(match.p2, dt);

  match.elapsed += dt;
  if (settle(match)) return result;

  if (match.phase === 'point') {
    match.timer -= dt;
    if (match.timer <= 0) serve(match, rng);
    return result;
  }
  if (match.phase === 'serving') {
    match.timer -= dt;
    // The toss hangs still and then goes; its velocity was decided when it was struck, so the
    // release is not a second decision made somewhere else.
    if (match.timer <= 0) match.phase = 'rally';
    return result;
  }

  const ball = match.ball;
  const b0x = ball.x;
  const b0y = ball.y;
  const b0z = ball.z;
  const prevVz = ball.vz;
  const bounced = advanceBall(ball, dt);
  result.bounced = bounced;
  match.bounces += bounced;

  if (clipNet(ball, b0y, b0z, prevVz, bounced, dt)) result.netted = true;

  if (match.bounces >= 2) {
    // Twice on the same court without a racket on it. Whoever's court it died on concedes,
    // which covers both ways that happens: a ball nobody reached, and a ball somebody put into
    // their own half of the net.
    const scorer = otherOf(sideOf(ball.y));
    award(match, scorer);
    result.scored = scorer;
    return result;
  }

  const striker = eligibleSeat(match);
  if (striker !== null) {
    const player = striker === 'p1' ? match.p1 : match.p2;
    const c0x = striker === 'p1' ? p1x0 : p2x0;
    const c0y = striker === 'p1' ? p1y0 : p2y0;
    const c0z = striker === 'p1' ? p1z0 : p2z0;
    const c1x = player.x;
    const c1y = player.y;
    const c1z = player.z + RACKET_HEIGHT;
    const r1x = ball.x - c1x;
    const r1y = ball.y - c1y;
    const r1z = ball.z - c1z;
    let swung = false;
    if (bounced > 0) {
      // The ball's path through this step is a V rather than a line, so the sweep would be
      // measuring a segment it never flew. Fall back on where it actually ended up: a
      // half-volley off the surface is struck at the step boundary, and off the frame.
      strike.offX = r1x;
      strike.offY = r1y;
      strike.offZ = r1z;
      strike.distance = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
      strike.when = 1;
      swung = strike.distance <= REACH;
    } else {
      closestApproach(strike, b0x - c0x, b0y - c0y, b0z - c0z, r1x, r1y, r1z);
      // `when === 1` means the ball is still closing on the middle of the strings. Waiting a
      // step is what gives a player the chance to line it up; swinging now would strike every
      // ball on the frame it entered on, which is the bug at the top of `closestApproach`.
      swung = strike.distance <= REACH && strike.when < 1;
    }
    if (swung) {
      const t = strike.when;
      strike.x = c0x + (c1x - c0x) * t + strike.offX;
      strike.y = c0y + (c1y - c0y) * t + strike.offY;
      strike.z = c0z + (c1z - c0z) * t + strike.offZ;
      play(match, striker, strike);
      result.touched = striker;
      result.sweetness = match.lastSweet;
      return result;
    }
  }

  if (
    ball.x < -BALL_RADIUS ||
    ball.x > COURT_WIDTH + BALL_RADIUS ||
    ball.y < -BALL_RADIUS ||
    ball.y > COURT_HEIGHT + BALL_RADIUS
  ) {
    // Only a ball that has already bounced, or one deflected off the net, can get here: a
    // struck ball is aimed at a spot well inside the court. Whoever's side it left over is the
    // player who failed to deal with it.
    const scorer = otherOf(sideOf(ball.y));
    award(match, scorer);
    result.scored = scorer;
  }
  return result;
}

export function winnerOf(match: Readonly<Match>): Outcome {
  return match.winner;
}

/* ------------------------------------------------------------------ the bot */

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
  /** How far off the true interception it judges the ball, in logical units. */
  readonly error: number;
  /**
   * The highest the ball may be for this tier to go and take it, in units.
   *
   * The difference between attacking a ball and waiting for one, and it is **not** a physical
   * advantage: every tier runs at {@link PLAYER_SPEED}, reaches {@link REACH} and jumps
   * {@link JUMP_APEX} exactly. A high ceiling means taking it early — up near the top of its
   * arc, which is nearer the net and high enough that a jump puts the middle of the strings on
   * it, so the return is fast and clears without being throttled. A low one means letting the
   * ball come down first, which means playing it from the back of the court off a contact the
   * strings can only reach at their edge. See {@link netClearanceOf} and
   * {@link clearingFlight}; most of the ladder is those two.
   */
  readonly meetCeiling: number;
  /**
   * How many seconds too early this tier leaves the ground.
   *
   * A jump is a fixed parabola, so being at the right height when the ball arrives is a
   * question of *when* you left — {@link takeoffFor} solves it exactly, and a bot with zero
   * here would put the middle of the strings on the ball every time. The tiers differ by how
   * far ahead of that instant they go, which is the same thing a person gets wrong: leave too
   * early and you are already coming down, and the ball catches the top of the frame.
   *
   * This is the second half of the observed rule turned into a difficulty lever, and it is
   * not information or physics — every tier jumps exactly {@link JUMP_APEX}.
   */
  readonly jumpEarly: number;
}

/**
 * When to leave the ground to be `height` up, on the way up, at a given moment.
 *
 * Solves `JUMP_SPEED·t − JUMP_GRAVITY·t²/2 = height` for the smaller root, which is the rising
 * one. Above {@link JUMP_APEX} there is no answer, so it gives the time to the apex — the best
 * anybody can do about a ball that high.
 */
export function takeoffFor(height: number): number {
  if (height <= 0) return 0;
  if (height >= JUMP_APEX) return JUMP_RISE;
  const under = JUMP_SPEED * JUMP_SPEED - 2 * JUMP_GRAVITY * height;
  return (JUMP_SPEED - Math.sqrt(under > 0 ? under : 0)) / JUMP_GRAVITY;
}

/**
 * The three tiers, as reaction, judgement, willingness to attack, and jump timing.
 *
 * None of them runs faster, reaches further, jumps higher, or reads anything a person cannot
 * see on the same screen (CLAUDE.md rule 6). They differ in how long they take to read a new
 * shot, how well they judge where it is going, how early they are prepared to take it, and
 * how well they time the leap.
 *
 * Measured over **200 matches a pairing**, seats swapped every other match: **normal beats
 * easy 74%, hard beats easy 96.5%, hard beats normal 78%**. All 600 were decided; none drawn,
 * none out of clock. Same tier against itself over three independent seed families of 200,
 * p1 takes 46.5% to 51.0% — no seat bias in any of the nine readings. `SPEC.md` records the
 * method, and re-measuring is a `node` script over `dist/rules.js` rather than anything
 * ceremonial.
 *
 * `hard` against `easy` is close to saturated at 96.5% and that is said rather than hidden:
 * three tiers over a four-point match cannot separate the ends of the ladder more gently
 * without collapsing the middle of it, and the middle — 74% and 78% — is where the setting
 * earns its keep.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.28, error: 36, meetCeiling: 100, jumpEarly: 0.14 },
  normal: { reaction: 0.23, error: 29, meetCeiling: 116, jumpEarly: 0.1 },
  hard: { reaction: 0.19, error: 23, meetCeiling: 132, jumpEarly: 0.06 },
});

/** How close is close enough; without it a bot jitters either side of its spot for ever. */
export const BOT_DEADZONE = 5;
/** How far ahead the prediction is allowed to run, in seconds. */
export const PREDICT_HORIZON = 2.6;
/** The prediction walks the ball at this rate whatever the simulation is running at. */
const PREDICT_STEP = 1 / 60;
/** The lowest ball a player on the ground can get the strings under. */
export const MEET_FLOOR = RACKET_HEIGHT - REACH;
/** Above this much lift, going and getting the ball is worth leaving the ground for. */
export const JUMP_TRIGGER = 16;

export interface Interception {
  x: number;
  y: number;
  /** Seconds from now until the ball is there. */
  time: number;
  /** The height it would be met at. */
  height: number;
  /** False when no point on the flight can be got to in time — it is going to miss. */
  reachable: boolean;
}

/** Scratch ball for the prediction, so a look allocates nothing. */
const shadow: Ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

/**
 * The earliest point on the ball's flight this player could actually get the strings to.
 *
 * Walked forward with **the same functions the simulation uses** — {@link advanceBall} and
 * the net — rather than extrapolated in a straight line. That is not tidiness: a ball here
 * bounces, and a straight-line prediction is not merely imprecise about a bounce, it is
 * wrong about which side of the court the ball ends up on. It is also self-maintaining. If
 * the bounce changes, the bot's idea of the bounce changes with it.
 *
 * **Earliest, not final.** Aiming at where the ball will land is the obvious thing and it is
 * the thing that makes a bot worse the quicker it is: a player waiting on the landing spot
 * meets the ball off its ankles, and a ball met off the ankles goes back slowly. So this asks
 * a different question — how soon can I be under it? — and answers with the first point on
 * the flight that this tier is willing to take and can reach.
 *
 * None of it is information a person lacks. Everybody watching a ball in the air judges where
 * it is going and whether they can get there, and the court draws the landing marker for both
 * players. Writes into `out` and allocates nothing.
 */
export function predictIntercept(
  out: Interception,
  ball: Readonly<Ball>,
  seat: SeatId,
  fromX: number,
  fromY: number,
  speed: number,
  meetCeiling: number,
  bouncesLeft: number,
  maxSeconds: number,
): Interception {
  shadow.x = ball.x;
  shadow.y = ball.y;
  shadow.z = ball.z;
  shadow.vx = ball.vx;
  shadow.vy = ball.vy;
  shadow.vz = ball.vz;
  out.reachable = false;
  let time = 0;
  let left = bouncesLeft;
  const steps = Math.round(maxSeconds / PREDICT_STEP);
  for (let i = 0; i < steps; i += 1) {
    const prevY = shadow.y;
    const prevZ = shadow.z;
    const prevVz = shadow.vz;
    const bounced = advanceBall(shadow, PREDICT_STEP);
    clipNet(shadow, prevY, prevZ, prevVz, bounced, PREDICT_STEP);
    time += PREDICT_STEP;
    left -= bounced;
    // Past this the ball is dead wherever it is, so there is nothing left to run to.
    if (left <= 0) break;
    if (
      shadow.x < -BALL_RADIUS ||
      shadow.x > COURT_WIDTH + BALL_RADIUS ||
      shadow.y < -BALL_RADIUS ||
      shadow.y > COURT_HEIGHT + BALL_RADIUS
    ) {
      break;
    }

    if (sideOf(shadow.y) === seat && shadow.z <= meetCeiling && shadow.z >= MEET_FLOOR) {
      const gapX = shadow.x - fromX;
      const gapY = shadow.y - fromY;
      // The strings count toward getting there: you do not have to stand on the ball, only
      // near enough to swing at it. Half the reach rather than all of it, because the other
      // half is spent on the height — a ball met well above or below the middle of the
      // strings is reachable across much less ground than one met level with them.
      if (Math.hypot(gapX, gapY) <= speed * time + REACH / 2) {
        out.x = shadow.x;
        out.y = shadow.y;
        out.time = time;
        out.height = shadow.z;
        out.reachable = true;
        return out;
      }
    }
  }
  // Nothing on the flight was reachable, so it runs at where the ball finishes and hopes.
  out.x = shadow.x;
  out.y = shadow.y;
  out.time = time;
  out.height = shadow.z > 0 ? shadow.z : 0;
  return out;
}

/**
 * What a bot carries between steps.
 *
 * The misjudgement is drawn **once per shot** and held. Re-rolling it every step is the
 * mistake `@duelbox/game-sdk`'s `bot-judgement` module exists to prevent: a fresh random
 * error sixty times a second averages to zero, so the bot stands on exactly the right spot
 * however large its supposed inaccuracy and every tier plays the same. A person misjudges a
 * ball once, as it leaves the other racket, and then runs to the wrong place.
 */
export interface BotState {
  readonly look: Judgement;
  aimX: number;
  aimY: number;
  biasX: number;
  biasY: number;
  /** Seconds until the ball reaches the spot it has decided on. Counted down every step. */
  meetTime: number;
  /** How much lift it needs under it to meet the ball through the middle of the strings. */
  meetLift: number;
  /** True once it has committed its leap for this shot, so it leaps once and not twice. */
  leapt: boolean;
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
    meetTime: 0,
    meetLift: 0,
    leapt: false,
    shot: -1,
  };
}

export function resetBotState(state: BotState): void {
  resetJudgement(state.look);
  state.aimX = COURT_WIDTH / 2;
  state.aimY = NET_Y;
  state.biasX = 0;
  state.biasY = 0;
  state.meetTime = 0;
  state.meetLift = 0;
  state.leapt = false;
  state.shot = -1;
}

/** Where the bot is running and whether it is leaving the ground. Rewritten in place. */
export interface Intent {
  dx: number;
  dy: number;
  jump: boolean;
}

/** One prediction buffer for every bot, because the call is synchronous and short-lived. */
const prediction: Interception = { x: 0, y: 0, time: 0, height: 0, reachable: false };

/**
 * Decide where this bot wants to stand, run there, and leave the ground if the ball is
 * coming down higher than the strings hang.
 *
 * `rollX` and `rollY` are seeded values in [0, 1). The caller draws exactly two per seat per
 * step whether or not they are used, so the two seats consume the stream at the same rate and
 * a bot-against-bot match cannot be decided by one seat's draws shifting the other's.
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
  out.jump = false;
  if (state.shot !== match.touches) {
    state.shot = match.touches;
    state.biasX = misjudgement(rollX, profile.error);
    state.biasY = misjudgement(rollY, profile.error);
    state.leapt = false;
    // **Not** an invalidation, which would have it read the new shot on the very step it was
    // struck. A new shot starts the reaction clock instead: for that long it keeps running
    // where it was already going, and only then does it look at the new ball.
    commit(state.look, 0, profile.reaction);
  }

  if (shouldDecide(state.look, fixedDeltaSeconds)) {
    commit(state.look, 0, profile.reaction);
    chooseSpot(state, match, seat, profile);
  } else if (state.meetTime > 0) {
    state.meetTime -= fixedDeltaSeconds;
    if (state.meetTime < 0) state.meetTime = 0;
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

  // The leap. One per shot, and only when the ball is coming down high enough that standing
  // still would catch it off the frame. `takeoffFor` is the instant that would put the middle
  // of the strings on it; the tier's own lateness is added to that and nowhere else.
  if (
    !state.leapt &&
    state.meetLift > JUMP_TRIGGER &&
    state.meetTime > 0 &&
    state.meetTime <= takeoffFor(state.meetLift) + profile.jumpEarly &&
    canJump(match, seat)
  ) {
    out.jump = true;
    state.leapt = true;
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
    // Nothing to answer — it has just played the ball, or the point has not started. Back to
    // the middle of its own half, which is what a person does.
    state.aimX = COURT_WIDTH / 2;
    state.aimY = readyY(seat);
    state.meetTime = 0;
    state.meetLift = 0;
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
    profile.meetCeiling,
    2 - match.bounces,
    PREDICT_HORIZON,
  );

  // A ball that is not coming here is not its problem — it finishes on the other side of the
  // net, or it clipped the net and dropped back. Either way, back to the middle.
  if (!prediction.reachable && sideOf(prediction.y) !== seat) {
    state.aimX = COURT_WIDTH / 2;
    state.aimY = readyY(seat);
    state.meetTime = 0;
    state.meetLift = 0;
    return;
  }

  state.aimX = clamp(prediction.x + state.biasX, bounds.minX, bounds.maxX);
  state.aimY = clamp(prediction.y + state.biasY, bounds.minY, bounds.maxY);
  state.meetTime = prediction.time;
  // How much lift it would take to put the middle of the strings on the ball. Above the apex
  // of a jump there is nothing to be done about it, so it is capped there rather than
  // pretending; the bot leaps anyway and catches what it can off the top of the frame.
  const lift = prediction.height - RACKET_HEIGHT;
  state.meetLift = lift > JUMP_APEX ? JUMP_APEX : lift;
}
