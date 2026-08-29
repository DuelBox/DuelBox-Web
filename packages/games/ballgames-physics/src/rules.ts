import { createContact, sweptCircleCircle } from '@duelbox/engine';
import type { Circle, Rng, SeatId } from '@duelbox/engine';

/**
 * Ball Games, as pure rules.
 *
 * One pitch, two goals, one player each, and a ball with **height**. Every distance is a
 * logical unit, every duration a second; nothing here knows what a pixel is.
 *
 * ## Why the simulation is written about the centre of the pitch
 *
 * Every coordinate below is measured from the centre spot: `x` runs from
 * `-PITCH_HALF_W` to `+PITCH_HALF_W`, `y` from `-PITCH_HALF_H` to `+PITCH_HALF_H`, and
 * `z` is height above the turf. The renderer adds {@link CENTRE_X}/{@link CENTRE_Y} to
 * put that into the manifest's logical box and nothing else ever does.
 *
 * That is not a stylistic choice, it is the seat-fairness mechanism. The half-turn that
 * swaps the two seats is then **exact negation**, and negation is exact in IEEE-754 for
 * every double there is. Written in box coordinates the same half-turn is `x ↦ W - x`,
 * which is *not* exact: two seats accumulating from opposite ends of the board end up
 * disagreeing in the last bits, straddle a threshold, and the game leans. That is the
 * defect Snowball Throw shipped and Frozen Beaks shipped, and writing the pitch about
 * its own centre makes it unrepresentable rather than merely absent. `rules.test.ts`
 * asserts it board-by-board: mirror a position, mirror the inputs, step both, and the
 * two states are bit-identical after negation.
 *
 * ## The ball is integrated exactly, not stepped
 *
 * {@link advanceBall} is an **event-driven closed-form integrator**. Between events the
 * ball's motion has an exact solution — horizontal speed decays exponentially, height is
 * a parabola — and the events (landing, a rail, a post, the stop line, the goal line) are
 * solved for their exact times rather than discovered at a step boundary. So
 * `advanceBall(ball, 1.5)` in one call and ninety calls of `1/60` reach the same place,
 * and 60, 90, 120 and 240 Hz agree to eleven decimal places.
 *
 * That is what makes the bot honest. Issue #2465 is the case where a bot reasons
 * analytically about a quantity the simulation integrates numerically and the two
 * disagree: the bot then aims at a game nobody is playing, and no amount of tuning its
 * error reaches the bias. Here the bot does not have its own arithmetic at all — it
 * predicts by calling {@link advanceBall} on a scratch ball, one call, whatever horizon
 * its tier allows. The prediction and the simulation are the same function, so they
 * cannot drift apart. `rules.test.ts` asserts they agree to 1e-9 anyway, because "the
 * same function" is a claim about today's source and the test is a claim about for ever.
 */

export const LOGICAL_WIDTH = 600;
export const LOGICAL_HEIGHT = 1000;
/** Where the centre spot sits in the manifest's logical box. Render-only. */
export const CENTRE_X = LOGICAL_WIDTH / 2;
export const CENTRE_Y = LOGICAL_HEIGHT / 2;

export const PITCH_HALF_W = 268;
export const PITCH_HALF_H = 452;

export const BALL_RADIUS = 13;
export const PLAYER_RADIUS = 33;

/** The rails, as the limit on the ball's *centre*. */
export const RAIL_X = PITCH_HALF_W - BALL_RADIUS;
export const RAIL_Y = PITCH_HALF_H - BALL_RADIUS;

/** Half the goal mouth, measured to the centre of each post. */
export const GOAL_HALF_W = 100;
export const POST_RADIUS = 7;
/**
 * The highest the ball's centre may be crossing the line and still count.
 *
 * The frame is closed above it: a ball that arrives over the bar rebounds off the
 * netting rather than leaving play, which is why the ball is *always* inside the pitch
 * and why there is no out-of-play rule to write, no throw-in, and no restart to get
 * wrong. A header peaks at {@link HEAD_LOFT}²/2g = 83.3 units, comfortably over this, so
 * heading it from six yards puts it into the net-roof and heading it from distance drops
 * it under the bar. That gap is the whole reason a header is a decision.
 */
export const GOAL_CEILING = 74;
/** How far the net stands behind the line. Presentation only; nothing simulates in it. */
export const GOAL_DEPTH = 30;

/** Downward acceleration on the ball's height. */
export const GRAVITY = 1500;
/**
 * Fraction of horizontal speed a ball keeps per **second** in flight, and rolling.
 *
 * Per-second powers rather than per-step multipliers, so 60 Hz and 240 Hz agree — rule 8.
 * The two rates are what make height mean something: a lofted ball carries, a ground ball
 * is eaten by the turf, so hoofing it and passing it along the floor are different
 * decisions rather than the same decision at different angles.
 */
export const AIR_KEEP = 0.7;
export const ROLL_KEEP = 0.22;
export const AIR_RATE = -Math.log(AIR_KEEP);
export const ROLL_RATE = -Math.log(ROLL_KEEP);
/**
 * Below this a rolling ball stops dead, and it is part of the distance law rather than a
 * fudge on the end of one: a ball rolling at `v` covers exactly `(v - STOP_SPEED) /
 * ROLL_RATE` and then stops, at every step rate, because {@link advanceBall} solves for
 * the moment it reaches this speed instead of noticing afterwards.
 */
export const STOP_SPEED = 10;
/** How much of its downward speed the ball keeps off the turf. */
export const TURF_BOUNCE = 0.5;
/** A bounce slower than this is not a bounce: the ball is planted and starts rolling. */
export const LAND_SPEED = 70;
/** How bouncy the rails, the frame and the posts are. */
export const RAIL_BOUNCE = 0.6;
export const MAX_BALL_SPEED = 1000;

/**
 * The three contact surfaces — the mechanic the catalogue row is asking for. `[ours]`
 *
 * "Shoot and score with every part of your body" says the body has parts and they are not
 * interchangeable. The part that meets the ball is decided by **how high the ball is**,
 * which is a quantity both players can see, both players can create, and neither player
 * can fake:
 *
 * | ball centre | surface | what it does |
 * |---|---|---|
 * | `z ≤ FOOT_TOP` | foot | the shot: fastest, flattest, takes most of your run |
 * | up to `CHEST_TOP` | chest | the trap: kills the pace *and* the height, ball drops dead at your feet |
 * | up to `HEAD_TOP` | head | the header: slower than a shot but lofted over everything in front |
 * | above `HEAD_TOP` | — | nothing. The ball flies over you and you cannot touch it |
 *
 * Three surfaces that deflect differently, and a fourth outcome that is the reason the
 * other three are a choice: a ball you cannot reach is what makes lofting one worth doing.
 */
export const FOOT_TOP = 28;
export const CHEST_TOP = 64;
export const HEAD_TOP = 98;

export const FOOT_SPEED = 760;
export const FOOT_LOFT = 150;
export const FOOT_TRANSFER = 0.55;

export const CHEST_DAMP = 0.3;
export const CHEST_MIN_SPEED = 105;
export const CHEST_TRANSFER = 0.3;

export const HEAD_SPEED = 540;
export const HEAD_LOFT = 500;
export const HEAD_TRANSFER = 0.4;

/**
 * Seconds a player cannot touch the ball again for.
 *
 * Without it a player standing on the ball strikes it sixty times a second and the pitch
 * becomes a pinball table — the failure Crabby Volley paid for and wrote down. The
 * separation push below is the other half of the same fix.
 */
export const CONTACT_COOLDOWN = 0.2;
/** How far clear a struck ball is placed, so a contact cannot immediately re-trigger. */
export const SEPARATION = 0.01;

export const PLAYER_SPEED = 375;

/** Goals needed to win outright. */
export const GOAL_TARGET = 5;
/**
 * The clock, which is the hard guarantee that a match ends.
 *
 * `roundSeconds` ends nothing — it prints "about 3 min" on a catalogue card — so a
 * first-to-five between two bots that cannot finish would run for ever, which is exactly
 * what `termination.test.ts` exists to catch. Level after ninety seconds and the match
 * goes to golden goal for {@link EXTRA_SECONDS}; level after that is an honest draw. The
 * worst case is 90 + 60 seconds of play plus 2.4 seconds of restart for each of at most
 * nine goals, well inside the ten simulated minutes the guard allows.
 */
export const MATCH_SECONDS = 90;
export const EXTRA_SECONDS = 60;
export const KICKOFF_SECONDS = 1;
export const CELEBRATE_SECONDS = 1.4;
/** How fast the ball is nudged off the centre spot, and where the players stand. */
export const KICKOFF_SPEED = 120;
export const HOME_Y = 170;

const TAU = Math.PI * 2;

export type Surface = 'foot' | 'chest' | 'head';
export type Phase = 'kickoff' | 'playing' | 'celebrating' | 'over';

export interface Ball {
  x: number;
  y: number;
  /** Height above the turf. Never negative. */
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds until this player may touch the ball again. */
  cooldown: number;
}

export interface Match {
  readonly p1: Player;
  readonly p2: Player;
  readonly ball: Ball;
  phase: Phase;
  /** Seconds left of the current period. */
  clock: number;
  /** Seconds left of a kick-off pause or a goal celebration. */
  hold: number;
  /** True once the match has gone to golden goal. */
  extra: boolean;
  /** Who scored last, for the renderer. */
  scorer: SeatId | null;
  /** The last surface to strike the ball, and who struck it, for the renderer. */
  lastSurface: Surface | null;
  lastToucher: SeatId | null;
  /** Seconds left of the contact flash. Presentation only. */
  flash: number;
  readonly score: { p1: number; p2: number };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/**
 * Which way a seat shoots: `p1` attacks `-y`, `p2` attacks `+y`.
 *
 * The two goals are exact half-turn images of each other, so this sign is the only place
 * in the file that knows a seat from its opposite, and it flips under the mirror.
 */
export function attackSign(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

/** The `y` of the line a seat defends. */
export function goalLineOf(seat: SeatId): number {
  return -attackSign(seat) * PITCH_HALF_H;
}

interface Post {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** The seat whose goal this post belongs to. */
  readonly seat: SeatId;
}

/**
 * The four posts, as circles standing on the two goal lines.
 *
 * A post is the one genuinely thin obstacle on this pitch: seven units of radius against
 * a ball that covers seventeen in a step at full pace, so a static overlap test misses it
 * outright about as often as it catches it. {@link advanceBall} resolves them with the
 * engine's `sweptCircleCircle`, and converts the returned fraction *along the
 * displacement* back into an exact time through the same drag law it moves by — so a post
 * is hit at the moment it is hit, not at whichever step boundary noticed.
 *
 * The rails and the goal line are **not** done this way, and deliberately. They are
 * axis-aligned planes, and the drag law inverts in closed form, so their crossing times
 * are exact. A swept test would be an approximation replacing an exact answer.
 */
const POSTS: readonly Post[] = Object.freeze([
  Object.freeze({ x: -GOAL_HALF_W, y: PITCH_HALF_H, radius: POST_RADIUS, seat: 'p1' }),
  Object.freeze({ x: GOAL_HALF_W, y: PITCH_HALF_H, radius: POST_RADIUS, seat: 'p1' }),
  Object.freeze({ x: -GOAL_HALF_W, y: -PITCH_HALF_H, radius: POST_RADIUS, seat: 'p2' }),
  Object.freeze({ x: GOAL_HALF_W, y: -PITCH_HALF_H, radius: POST_RADIUS, seat: 'p2' }),
]);

/**
 * Scratch records. Rule 5 forbids allocating in a step, so everything the integrator and
 * the bot need is a module-level object rewritten in place.
 */
const contact = createContact();
const sweptBall: Circle = { x: 0, y: 0, radius: BALL_RADIUS };
const sweptPost: Circle = { x: 0, y: 0, radius: POST_RADIUS };
const scratchBall: Ball = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function createMatch(rng: Rng): Match {
  const match: Match = {
    p1: { x: 0, y: HOME_Y, vx: 0, vy: 0, cooldown: 0 },
    p2: { x: 0, y: -HOME_Y, vx: 0, vy: 0, cooldown: 0 },
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
    phase: 'kickoff',
    clock: MATCH_SECONDS,
    hold: KICKOFF_SECONDS,
    extra: false,
    scorer: null,
    lastSurface: null,
    lastToucher: null,
    flash: 0,
    score: { p1: 0, p2: 0 },
  };
  resetMatch(match, rng);
  return match;
}

export function resetMatch(match: Match, rng: Rng): void {
  match.score.p1 = 0;
  match.score.p2 = 0;
  match.clock = MATCH_SECONDS;
  match.extra = false;
  match.scorer = null;
  match.lastSurface = null;
  match.lastToucher = null;
  match.flash = 0;
  kickOff(match, rng);
}

/**
 * Everything back on its mark, and the ball nudged off the spot.
 *
 * The nudge is a **uniform angle** rather than a push toward one end, so a kick-off
 * favours neither seat and the opening is not a fixed opening. It rolls about seventy
 * units and stops; both players are the same distance from it, which is what a kick-off
 * is.
 */
export function kickOff(match: Match, rng: Rng): void {
  match.p1.x = 0;
  match.p1.y = HOME_Y;
  match.p2.x = 0;
  match.p2.y = -HOME_Y;
  match.p1.vx = 0;
  match.p1.vy = 0;
  match.p2.vx = 0;
  match.p2.vy = 0;
  match.p1.cooldown = 0;
  match.p2.cooldown = 0;

  const angle = rng.float() * TAU;
  const ball = match.ball;
  ball.x = 0;
  ball.y = 0;
  ball.z = 0;
  ball.vx = Math.cos(angle) * KICKOFF_SPEED;
  ball.vy = Math.sin(angle) * KICKOFF_SPEED;
  ball.vz = 0;

  match.phase = 'kickoff';
  match.hold = KICKOFF_SECONDS;
}

/**
 * The smallest positive time at which a ball at height `z` rising at `vz` reaches the
 * turf, under constant gravity.
 *
 * `z + vz·t - g·t²/2 = 0` has one non-negative root for `z ≥ 0`, and this is it written
 * so that it does not cancel catastrophically for the small-`z` case that happens on
 * every bounce.
 */
export function landingTime(z: number, vz: number): number {
  const disc = vz * vz + 2 * GRAVITY * z;
  if (disc <= 0) return 0;
  return (vz + Math.sqrt(disc)) / GRAVITY;
}

/**
 * Invert the drag law: the time at which the travel factor reaches `f`, or `Infinity`.
 *
 * Both components decay by the same factor, so the ball's horizontal path within one arc
 * is a **straight line** and its whole geometry is carried by one scalar,
 * `f(t) = (1 - e^(-rate·t)) / rate`, with `x(t) = x₀ + vx·f(t)`. That is what makes every
 * flat obstacle here solvable in closed form: the `f` at which the ball reaches a plane is
 * a division, and this turns it back into a time.
 *
 * `f` is bounded above by `1/rate` however long you wait, so "does the ball reach the far
 * rail" is a question whose answer can be *no*. This returns `Infinity` for that rather
 * than a root that does not exist.
 */
function timeAtTravel(f: number, rate: number): number {
  const shrunk = 1 - rate * f;
  if (shrunk <= 0) return Infinity;
  return -Math.log(shrunk) / rate;
}

const EVENT_NONE = 0;
const EVENT_LAND = 1;
const EVENT_RAIL_X = 2;
const EVENT_RAIL_Y = 3;
const EVENT_STOP = 4;
const EVENT_POST = 5;

/**
 * Advance the ball by `seconds`, exactly, and report the seat that conceded if it went in.
 *
 * The whole flight is a sequence of closed-form arcs joined at events whose times are
 * solved rather than sampled, so the answer does not depend on how the caller sliced the
 * time. That property is asserted three ways in `rules.test.ts`: at four step rates, in
 * one call against ninety, and against the bot's prediction.
 *
 * What it does **not** know about is the two players, and that is deliberate: the bot
 * predicts with this function, and a bot that could see where its opponent was going to
 * be would be reading a mind rather than a ball (rule 6).
 */
export function advanceBall(ball: Ball, seconds: number): SeatId | null {
  let remaining = seconds;

  // Each pass resolves at most one event. A launch of `vz` bounces at most
  // log(LAND_SPEED/vz)/log(TURF_BOUNCE) times before it is planted — five from the
  // fastest header there is — and rails and posts turn the ball away rather than into
  // another one, so the loop is bounded by physics rather than by this constant. The
  // guard is here for the pathology that is not bounded by physics, and it is measured
  // rather than assumed: over 720 ladder matches and 20,000 random launches at the speed
  // cap the worst pass count is **7**. It was 24 — the guard binding, and eating a whole
  // step of motion — until the post resolver stopped disagreeing with the post detector;
  // see {@link separateFromPost}.
  for (let guard = 0; guard < 24 && remaining > 0; guard += 1) {
    const flying = ball.z > 0 || ball.vz !== 0;
    const rate = flying ? AIR_RATE : ROLL_RATE;
    const speed = Math.hypot(ball.vx, ball.vy);

    // A rolling ball under the stop line is finished, and so is this step.
    if (!flying && speed <= STOP_SPEED) {
      ball.vx = 0;
      ball.vy = 0;
      return null;
    }

    let time = remaining;
    let event = EVENT_NONE;
    let railSign = 0;
    let struck: Post | null = null;

    if (!flying) {
      const stop = Math.log(speed / STOP_SPEED) / rate;
      if (stop < time) {
        time = stop;
        event = EVENT_STOP;
      }
    } else {
      const land = landingTime(ball.z, ball.vz);
      if (land < time) {
        time = land;
        event = EVENT_LAND;
      }
    }

    if (ball.vx !== 0) {
      const sign = ball.vx > 0 ? 1 : -1;
      const hit = timeAtTravel((sign * RAIL_X - ball.x) / ball.vx, rate);
      if (hit < time) {
        time = hit;
        event = EVENT_RAIL_X;
        railSign = sign;
      }
    }
    if (ball.vy !== 0) {
      const sign = ball.vy > 0 ? 1 : -1;
      const hit = timeAtTravel((sign * RAIL_Y - ball.y) / ball.vy, rate);
      if (hit < time) {
        time = hit;
        event = EVENT_RAIL_Y;
        railSign = sign;
      }
    }

    // Posts, once the tentative arc for this pass is known. The swept test answers "how
    // far along this displacement", which the drag law turns back into an exact time.
    let keep = Math.exp(-rate * time);
    let travel = (1 - keep) / rate;
    if (ball.z < GOAL_CEILING && Math.abs(ball.y) > PITCH_HALF_H - 140) {
      const dx = ball.vx * travel;
      const dy = ball.vy * travel;
      sweptBall.x = ball.x;
      sweptBall.y = ball.y;
      let nearest = 1;
      for (let i = 0; i < POSTS.length; i += 1) {
        const post = POSTS[i]!;
        sweptPost.x = post.x;
        sweptPost.y = post.y;
        if (!sweptCircleCircle(contact, sweptBall, dx, dy, sweptPost)) continue;
        if (contact.depth < nearest) {
          nearest = contact.depth;
          struck = post;
        }
      }
      if (struck !== null) {
        const hit = timeAtTravel(travel * nearest, rate);
        if (hit < time) {
          time = hit;
          event = EVENT_POST;
          keep = Math.exp(-rate * time);
          travel = (1 - keep) / rate;
        } else {
          struck = null;
        }
      }
    }

    ball.x += ball.vx * travel;
    ball.y += ball.vy * travel;
    ball.vx *= keep;
    ball.vy *= keep;
    if (flying) {
      // Position first, then velocity — the exact integral of a constant acceleration,
      // and the ordering cannon-duel had to learn. Written the other way round the step
      // lands a whole `a·dt²` instead of half of one, and the shortfall accumulates all
      // the way down the pitch.
      ball.z += ball.vz * time - 0.5 * GRAVITY * time * time;
      ball.vz -= GRAVITY * time;
      if (ball.z < 0) ball.z = 0;
    }
    remaining -= time;

    if (event === EVENT_STOP) {
      ball.vx = 0;
      ball.vy = 0;
      return null;
    }
    if (event === EVENT_LAND) {
      ball.z = 0;
      const up = -ball.vz * TURF_BOUNCE;
      ball.vz = up < LAND_SPEED ? 0 : up;
      continue;
    }
    if (event === EVENT_RAIL_X) {
      ball.x = railSign * RAIL_X;
      ball.vx = -ball.vx * RAIL_BOUNCE;
      continue;
    }
    if (event === EVENT_RAIL_Y) {
      if (Math.abs(ball.x) <= GOAL_HALF_W && ball.z <= GOAL_CEILING) {
        ball.y = railSign * RAIL_Y;
        // The seat defending this line is the one that conceded.
        return railSign > 0 ? 'p1' : 'p2';
      }
      ball.y = railSign * RAIL_Y;
      ball.vy = -ball.vy * RAIL_BOUNCE;
      continue;
    }
    if (event === EVENT_POST && struck !== null) {
      separateFromPost(ball, struck);
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Bounce the ball off the post it just reached, and place it clear of it.
 *
 * **The post is the one the swept test named, not "whichever one overlaps".** Written the
 * second way this stalled: a ball whose centre sits a last-bit *outside* the touching
 * distance is still reported as an impact at time zero by the swept test — the quadratic's
 * constant term is a hair positive and its first root is 1e-18 — while an overlap test on
 * the same two circles says they are not touching. So the loop resolved an event that its
 * resolver then declined to resolve, nothing moved, `remaining` never fell, and the whole
 * of that step's motion was eaten by the iteration guard. Measured over 200 ladder matches
 * before the fix: the guard bound at its full 24 passes. After it, over 720 ladder matches
 * and 20,000 random launches at the speed cap, the worst pass count is **7**.
 *
 * Repositioning to exactly {@link SEPARATION} clear and reflecting anything still moving
 * inwards guarantees the next pass finds no impact, which is what makes the loop finite for
 * a reason rather than by a constant.
 */
function separateFromPost(ball: Ball, post: Post): void {
  const dx = ball.x - post.x;
  const dy = ball.y - post.y;
  const reach = POST_RADIUS + BALL_RADIUS;
  const dist = Math.hypot(dx, dy);
  const nx = dist === 0 ? 1 : dx / dist;
  const ny = dist === 0 ? 0 : dy / dist;
  ball.x = post.x + nx * (reach + SEPARATION);
  ball.y = post.y + ny * (reach + SEPARATION);
  const along = ball.vx * nx + ball.vy * ny;
  if (along < 0) {
    ball.vx -= (1 + RAIL_BOUNCE) * along * nx;
    ball.vy -= (1 + RAIL_BOUNCE) * along * ny;
  }
}

/**
 * Drive a player. `dx`/`dy` are a direction; a diagonal is normalised so it is not faster.
 *
 * Velocity is recorded as well as position because every surface takes some of it: running
 * onto a ball has to be different from standing in front of one, or the approach carries
 * no skill.
 */
export function drive(match: Match, seat: SeatId, dx: number, dy: number, dt: number): void {
  const player = seat === 'p1' ? match.p1 : match.p2;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    player.vx = 0;
    player.vy = 0;
    return;
  }
  player.vx = (dx / length) * PLAYER_SPEED;
  player.vy = (dy / length) * PLAYER_SPEED;
  const limitX = PITCH_HALF_W - PLAYER_RADIUS;
  const limitY = PITCH_HALF_H - PLAYER_RADIUS;
  player.x = clamp(player.x + player.vx * dt, -limitX, limitX);
  player.y = clamp(player.y + player.vy * dt, -limitY, limitY);
}

/** Which surface meets a ball at this height, or null when it flies over. */
export function surfaceAt(z: number): Surface | null {
  if (z <= FOOT_TOP) return 'foot';
  if (z <= CHEST_TOP) return 'chest';
  if (z <= HEAD_TOP) return 'head';
  return null;
}

function capSpeed(ball: Ball): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed <= MAX_BALL_SPEED) return;
  const scale = MAX_BALL_SPEED / speed;
  ball.vx *= scale;
  ball.vy *= scale;
}

/**
 * Strike the ball with one surface of one player.
 *
 * Direction is the line between the two centres in every case — where you meet the ball
 * decides where it goes, which is what makes standing in the right place worth anything.
 * What the surface changes is the *speed*, the *loft*, and how much of your run it takes:
 *
 * - **foot** — the shot. Fast, barely off the ground, and it takes more than half your run.
 * - **chest** — the trap. It keeps under a third of what the ball arrived with, sets a
 *   floor so the ball still comes off you, and kills the height outright: the ball drops
 *   to your feet, where your foot is waiting. Trap-then-shoot is the rally of this game.
 * - **head** — the pass over the top. Slower than a shot, but launched at a loft that
 *   carries it clean over a player standing in the way, because a player cannot reach
 *   above {@link HEAD_TOP}.
 */
export function strike(ball: Ball, player: Readonly<Player>, surface: Surface): void {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dist = Math.hypot(dx, dy);
  const nx = dist === 0 ? 0 : dx / dist;
  const ny = dist === 0 ? -1 : dy / dist;

  if (surface === 'foot') {
    ball.vx = nx * FOOT_SPEED + player.vx * FOOT_TRANSFER;
    ball.vy = ny * FOOT_SPEED + player.vy * FOOT_TRANSFER;
    ball.vz = FOOT_LOFT;
  } else if (surface === 'chest') {
    const incoming = Math.hypot(ball.vx, ball.vy);
    const speed = Math.max(CHEST_MIN_SPEED, incoming * CHEST_DAMP);
    ball.vx = nx * speed + player.vx * CHEST_TRANSFER;
    ball.vy = ny * speed + player.vy * CHEST_TRANSFER;
    ball.vz = 0;
  } else {
    ball.vx = nx * HEAD_SPEED + player.vx * HEAD_TRANSFER;
    ball.vy = ny * HEAD_SPEED + player.vy * HEAD_TRANSFER;
    ball.vz = HEAD_LOFT;
  }
  capSpeed(ball);

  // Placed clear along the same line, so the next step is not another contact.
  const reach = PLAYER_RADIUS + BALL_RADIUS + SEPARATION;
  ball.x = player.x + nx * reach;
  ball.y = player.y + ny * reach;
}

/**
 * The fraction of this step's chord at which a player reaches the ball, or `Infinity`.
 *
 * Swept rather than tested at the end of the step: the ball and a player close on each
 * other at up to 1375 units a second, and a contact found only where the step happened to
 * finish is a contact that sometimes is not found at all. The engine's `sweptCircleCircle`
 * is given the ball's motion **relative to the player's**, which is what makes it correct
 * for two moving bodies rather than one.
 */
function contactTime(
  player: Readonly<Player>,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  dt: number,
): number {
  if (player.cooldown > 0) return Infinity;
  // Where the player started this step. `drive` has already moved them, so their own
  // displacement is the thing that is known and their start is derived from it — never
  // the other way round, or the two would not cancel.
  const movedX = player.vx * dt;
  const movedY = player.vy * dt;
  sweptBall.x = fromX;
  sweptBall.y = fromY;
  sweptPost.x = player.x - movedX;
  sweptPost.y = player.y - movedY;
  sweptPost.radius = PLAYER_RADIUS;
  const dx = toX - fromX - movedX;
  const dy = toY - fromY - movedY;
  const hit = sweptCircleCircle(contact, sweptBall, dx, dy, sweptPost);
  sweptPost.radius = POST_RADIUS;
  return hit ? contact.depth : Infinity;
}

export type StepResult = 'playing' | 'goal' | 'over';

/**
 * Advance one fixed step: the clock, then the ball, then the bodies.
 *
 * The ball's own flight is resolved first and exactly, and the bodies afterwards on the
 * step's chord. That asymmetry is real and worth stating: a body is driven by input that
 * only exists at step boundaries, so there is no exact time at which a player was
 * anywhere, and pretending otherwise would be arithmetic about a fiction. The ball has no
 * such excuse, which is why it gets none.
 */
export function step(match: Match, dt: number, rng: Rng): StepResult {
  if (match.phase === 'over') return 'over';

  if (match.flash > 0) match.flash -= dt;
  if (match.p1.cooldown > 0) match.p1.cooldown -= dt;
  if (match.p2.cooldown > 0) match.p2.cooldown -= dt;

  if (match.phase === 'kickoff' || match.phase === 'celebrating') {
    match.hold -= dt;
    if (match.hold <= 0) {
      if (match.phase === 'celebrating') kickOff(match, rng);
      else match.phase = 'playing';
    }
    return 'playing';
  }

  match.clock -= dt;
  if (match.clock <= 0) {
    match.clock = 0;
    if (match.score.p1 !== match.score.p2 || match.extra) {
      match.phase = 'over';
      return 'over';
    }
    // Level at the whistle: golden goal, once.
    match.extra = true;
    match.clock = EXTRA_SECONDS;
  }

  const ball = match.ball;
  const fromX = ball.x;
  const fromY = ball.y;
  const fromZ = ball.z;
  const conceded = advanceBall(ball, dt);
  if (conceded !== null) return award(match, otherOf(conceded));

  const t1 = contactTime(match.p1, fromX, fromY, ball.x, ball.y, dt);
  const t2 = contactTime(match.p2, fromX, fromY, ball.x, ball.y, dt);

  // A dead heat is a fifty-fifty: both players commit, neither comes away with it, and the
  // ball runs on. It is the one resolution that is *covariant* — any rule that named a
  // seat would answer the mirror position the same way and so decide it for the same seat
  // both times, which is precisely the bias the mirror test exists to find.
  if (t1 !== Infinity && t1 === t2) {
    match.p1.cooldown = CONTACT_COOLDOWN;
    match.p2.cooldown = CONTACT_COOLDOWN;
    return 'playing';
  }

  const seat: SeatId | null = t1 < t2 ? 'p1' : t2 < t1 ? 'p2' : null;
  if (seat !== null) {
    const time = seat === 'p1' ? t1 : t2;
    const player = seat === 'p1' ? match.p1 : match.p2;
    const heightAt = fromZ + (ball.z - fromZ) * time;
    const surface = surfaceAt(heightAt);
    if (surface !== null) {
      ball.x = fromX + (ball.x - fromX) * time;
      ball.y = fromY + (ball.y - fromY) * time;
      ball.z = heightAt;
      strike(ball, player, surface);
      player.cooldown = CONTACT_COOLDOWN;
      match.lastSurface = surface;
      match.lastToucher = seat;
      match.flash = 0.3;
    }
  }

  // A push-out at a post or a body can put the ball a hair outside; the pitch is the
  // pitch. Nothing else can move it out, which is why there is no out-of-play rule.
  ball.x = clamp(ball.x, -RAIL_X, RAIL_X);
  ball.y = clamp(ball.y, -RAIL_Y, RAIL_Y);
  if (ball.z < 0) ball.z = 0;
  return 'playing';
}

function award(match: Match, scorer: SeatId): StepResult {
  if (scorer === 'p1') match.score.p1 += 1;
  else match.score.p2 += 1;
  match.scorer = scorer;
  match.flash = 0;
  match.lastSurface = null;
  match.lastToucher = null;
  if (match.score[scorer] >= GOAL_TARGET || match.extra) {
    match.phase = 'over';
    return 'over';
  }
  match.phase = 'celebrating';
  match.hold = CELEBRATE_SECONDS;
  return 'goal';
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  if (match.phase !== 'over') return null;
  if (match.score.p1 === match.score.p2) return 'draw';
  return match.score.p1 > match.score.p2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds between decisions. */
  readonly reaction: number;
  /**
   * The furthest ahead this tier can solve an interception, in seconds.
   *
   * **A fixed horizon was tried first and measured backwards**, which is Crabby Volley's
   * finding arriving again from the other direction. Running the ball forward by a flat
   * `lookahead` and standing where it would then be put the bot where the ball had
   * *already gone*: swept alone against a fixed `normal` opponent, 0 s won 23.8%, 0.28 s
   * won 50.0%, and 0.45, 0.7 and 1.0 s won 13.8%, 11.3% and **3.8%**. The tier that could
   * see furthest was the worst tier in the game, and the `hard` profile built on it lost
   * to `normal` 51-9.
   *
   * So the bot solves the interception instead: three passes of "run the ball forward by
   * the time it would take me to get there, then re-time it". A person meeting a through
   * ball does exactly that, and being able to do it further ahead is now *monotonically*
   * better rather than a way to run past the ball.
   */
  readonly horizon: number;
  /**
   * How far behind the ball it tries to stand, in logical units.
   *
   * Running straight at the ball sends it away along the line between the two centres,
   * which points at your own goal about as often as at theirs. Getting behind it first is
   * the difference between a clearance and an own goal, and zero is what a novice does.
   */
  readonly approach: number;
  /** How far off its heading it commits, in radians. */
  readonly wobble: number;
}

/**
 * Measured, not guessed. Every lever was swept **alone** against a fixed `normal`
 * opponent, 240 matches a cell from both seat orders. The tables are in SPEC.md; what
 * they say about each lever is this:
 *
 * - **`reaction` is the whole game.** 86.3% at 0.08 s down to 16.7% at 0.45 s, monotone
 *   across the range, and by a distance the widest swing of the four.
 * - **`approach` is the second.** 10.0% at 0, 50.0% at 40, 62.5% at 70, and then it stops
 *   paying: 60.0% at 90. Standing behind the ball is most of what a good player does here,
 *   and standing *too far* behind it is arriving late.
 * - **`horizon` earns its whole keep below 0.6 s** — 15.8%, 34.2%, 47.9%, 50.0% at 0, 0.2,
 *   0.35, 0.6 — and is flat above it: 52.1, 50.8, 52.5 at 1.0, 1.6, 2.4, all inside the
 *   3.2-point standard error of the cell. So it is what separates `easy` from `normal` and
 *   contributes nothing to the step from `normal` to `hard`, which is worth knowing and is
 *   not a reason to delete a lever that moves 34 points over the part of its range the
 *   tiers actually use.
 * - **`wobble` is monotone but shallow at the sharp end**: 54.6, 52.9, 50.0, 40.0, 21.7 at
 *   0, 0.1, 0.3, 0.55, 0.8. Four points across the whole bottom half against twenty-eight
 *   across the top half.
 *
 * A fifth lever is **gone rather than tuned**: a fixed look-ahead measured backwards, and
 * the whole story is under {@link BotProfile.horizon}.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.32, horizon: 0.2, approach: 22, wobble: 0.55 },
  normal: { reaction: 0.22, horizon: 0.6, approach: 40, wobble: 0.3 },
  hard: { reaction: 0.12, horizon: 1.6, approach: 70, wobble: 0.1 },
});

export interface BotState {
  headingX: number;
  headingY: number;
  sinceDecision: number;
}

export function createBotState(): BotState {
  return { headingX: 0, headingY: 0, sinceDecision: 0 };
}

export function resetBotState(bot: BotState): void {
  bot.headingX = 0;
  bot.headingY = 0;
  bot.sinceDecision = 0;
}

/**
 * Where the bot runs.
 *
 * It predicts the ball by handing a copy of it to {@link advanceBall} for however many
 * seconds its tier can look ahead — **one call, not a loop of sixty**, because the
 * integrator is exact for any duration. Then it aims for the spot `approach` units behind
 * that point on the line to the goal it is attacking, so that its own contact sends the
 * ball forward rather than wherever it happened to arrive from.
 *
 * It sees the ball, the posts and its own position. It does not see the other player at
 * all, and it has no arithmetic the simulation does not also use.
 *
 * ## The wobble is a rotation, never an angle added to `atan2`
 *
 * `atan2(-dy, -dx)` is `atan2(dy, dx) ± π` in real arithmetic and *not* in floating point,
 * so a heading built by adding an error to an arctangent differs between a position and
 * its mirror image in the last bits — and a bot whose heading differs in the last bits
 * takes a different branch a few seconds later. Rotating the unit vector by the error
 * instead is exactly negation-covariant, because every term is a product of the same two
 * cosines with a negated component. This is the same family of defect as Snowball Throw's
 * knife-edge threshold, found here by the mirror test before it could ship.
 */
export function botHeading(
  out: { x: number; y: number },
  match: Readonly<Match>,
  bot: BotState,
  seat: SeatId,
  profile: BotProfile,
  dt: number,
  roll: number,
): { x: number; y: number } {
  bot.sinceDecision -= dt;
  if (bot.sinceDecision <= 0) {
    bot.sinceDecision = profile.reaction;
    const me = seat === 'p1' ? match.p1 : match.p2;
    const ball = match.ball;

    // Solve the interception: how long until I could be where the ball will be by then.
    // Three passes, because the map is a contraction — the ball slows as it runs, so a
    // later meeting point is never much further away — and three is where the answer stops
    // moving by more than a player's width.
    let when = 0;
    for (let pass = 0; pass < 4; pass += 1) {
      scratchBall.x = ball.x;
      scratchBall.y = ball.y;
      scratchBall.z = ball.z;
      scratchBall.vx = ball.vx;
      scratchBall.vy = ball.vy;
      scratchBall.vz = ball.vz;
      advanceBall(scratchBall, when);
      if (pass === 3) break;
      const away = Math.hypot(scratchBall.x - me.x, scratchBall.y - me.y);
      when = clamp(away / PLAYER_SPEED, 0, profile.horizon);
    }

    // The spot to stand on: `approach` units the near side of the ball, on the line from
    // the ball to the mouth of the goal this seat is attacking.
    const goalY = -goalLineOf(seat);
    const toGoalX = -scratchBall.x;
    const toGoalY = goalY - scratchBall.y;
    const span = Math.hypot(toGoalX, toGoalY);
    const unitX = span === 0 ? 0 : toGoalX / span;
    const unitY = span === 0 ? attackSign(seat) : toGoalY / span;
    const standX = scratchBall.x - unitX * profile.approach;
    const standY = scratchBall.y - unitY * profile.approach;

    let dx = standX - me.x;
    let dy = standY - me.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      dx = 0;
      dy = attackSign(seat);
    } else {
      dx /= length;
      dy /= length;
    }

    const error = (roll - 0.5) * 2 * profile.wobble;
    const cos = Math.cos(error);
    const sin = Math.sin(error);
    bot.headingX = dx * cos - dy * sin;
    bot.headingY = dx * sin + dy * cos;
  }
  out.x = bot.headingX;
  out.y = bot.headingY;
  return out;
}
