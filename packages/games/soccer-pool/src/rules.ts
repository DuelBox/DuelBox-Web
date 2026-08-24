import type { SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Soccer Pool, as pure rules.
 *
 * A pool table wearing a football shirt. One ball sits on the cloth and each seat has three
 * discs guarding its own net. You take turns; on your turn you strike **the ball itself**,
 * from wherever the last player left it, and try to put it through the far goal. Miss and
 * your opponent strikes the same ball from where it stopped, aiming the other way — so a
 * weak shot that leaves the ball in your own half is a present.
 *
 * The observed rule is one sentence ("Take turns to hit the ball and score"), so almost
 * everything below is ours; SPEC.md marks which.
 *
 * No rendering, no timing, no DOM — the bot, the tests and the balance harness all reuse
 * this module.
 */

/** The logical box, which the manifest also declares. Never pixels (CLAUDE.md rule 8). */
export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;

/** The playing surface inside the boards. The bands above and below carry the status line. */
export const PITCH_LEFT = 40;
export const PITCH_RIGHT = 660;
export const PITCH_TOP = 110;
export const PITCH_BOTTOM = 890;
export const PITCH_WIDTH = PITCH_RIGHT - PITCH_LEFT;
export const PITCH_HEIGHT = PITCH_BOTTOM - PITCH_TOP;
export const CENTRE_X = (PITCH_LEFT + PITCH_RIGHT) / 2;
export const CENTRE_Y = (PITCH_TOP + PITCH_BOTTOM) / 2;

export const BALL_RADIUS = 15;
export const DISC_RADIUS = 24;

/** The goal mouth, centred on each end line. Wide enough that a good line goes in. */
export const GOAL_HALF_WIDTH = 78;
export const GOAL_LEFT = CENTRE_X - GOAL_HALF_WIDTH;
export const GOAL_RIGHT = CENTRE_X + GOAL_HALF_WIDTH;
/** How far the net stands behind the line. Presentation only; nothing simulates in it. */
export const GOAL_DEPTH = 40;

/** Speed of a full-power strike, in logical units per second. */
export const STRIKE_MAX_SPEED = 1450;
/**
 * Rolling resistance, as the fraction of speed surviving one **second**.
 *
 * A per-second power rather than a per-step multiplier, so 60 Hz and 120 Hz agree
 * (CLAUDE.md rule 8). Grass is slower than cloth, so this is heavier than Pool's.
 */
export const ROLL_DRAG = 0.22;
/**
 * How fast speed bleeds off, as the exponent behind {@link ROLL_DRAG}.
 *
 * A ball struck at speed `v` rolls exactly `(v - STOP_SPEED) / DRAG_RATE` before it stops.
 * That is the analytic integral of the decay rather than an approximation of it, and
 * {@link step} moves the ball by that integral rather than by `v · dt`, so the total roll
 * is the same number at 60, 120 and 240 Hz. See {@link reachOf}.
 */
export const DRAG_RATE = -Math.log(ROLL_DRAG);
/**
 * Below this a disc is stopped outright, so the pitch settles instead of creeping.
 *
 * It is a real part of the distance law rather than a fudge on the end of one: a ball
 * covers `(v - STOP_SPEED) / DRAG_RATE` and then stops dead on the stop line, and
 * {@link reachOf} and {@link powerFor} are exact inverses through that same constant.
 */
export const STOP_SPEED = 14;
/** How much of the impact survives a board. */
export const WALL_BOUNCE = 0.72;
/** How much survives a disc-on-disc hit. */
export const DISC_BOUNCE = 0.94;

/**
 * The longest a shot can possibly still be moving, in seconds.
 *
 * A provable bound, not a hope, and the reason the turn order can rest on "the pitch
 * settles". Three facts give it:
 *
 * 1. The fastest anything can be moving at kick-off is {@link STRIKE_MAX_SPEED}.
 * 2. Nothing on the pitch adds energy. A board keeps {@link WALL_BOUNCE} of one component;
 *    a disc-on-disc contact mixes the two normal components as `(1-e)a + eb` and its
 *    mirror, whose squares sum to `s²/2 + (1-2e)²d²/2` against the original `s²/2 + d²/2`
 *    — smaller for every `e` in (0, 1). The separating push moves discs without touching
 *    a velocity. So `Σv²` never rises, and no single disc ever exceeds `√(Σv²)`.
 * 3. Every disc's speed is multiplied by `ROLL_DRAG^dt` each step and zeroed at
 *    {@link STOP_SPEED}, so `v_max(t) ≤ STRIKE_MAX_SPEED · ROLL_DRAG^t`.
 *
 * Set `v_max(t) = STOP_SPEED` and the answer is `ln(1450/14) / DRAG_RATE`, about 3.06 s.
 * `rules.test.ts` measures it over thousands of struck shots as well as deriving it.
 */
export const SETTLE_BOUND_SECONDS = Math.log(STRIKE_MAX_SPEED / STOP_SPEED) / DRAG_RATE;

/** Goals needed to win outright. */
export const GOAL_TARGET = 3;
/**
 * Shots in a match, both seats together.
 *
 * The hard guarantee that a match ends. `roundSeconds` ends nothing — it prints "about
 * 2 min" on a catalogue card — so a game with no shot limit and a defensive pair of bots
 * would run for ever, which is precisely what `termination.test.ts` exists to catch. Nine
 * shots each is a match; when they are gone the higher score wins and a level score is an
 * honest draw.
 */
export const MAX_SHOTS = 18;

export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: GOAL_TARGET };

export type DiscKind = 'ball' | 'p1' | 'p2';

export interface Disc {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly kind: DiscKind;
  /** Where this disc stands at a kick-off. The ball's post is the centre spot. */
  readonly postX: number;
  readonly postY: number;
}

export type Phase = 'aiming' | 'rolling' | 'over';

export interface Match {
  /** Index 0 is always the ball; the rest are the two sets of three. */
  readonly discs: Disc[];
  seat: SeatId;
  phase: Phase;
  p1: number;
  p2: number;
  winner: SeatId | 'draw' | null;
  /** Shots taken by both seats together, including shots the clock ran out on. */
  shots: number;
  /** Who scored on the shot just settled, for the status line. */
  lastGoal: SeatId | null;
  /** Whether the last turn ended with the shot clock rather than with a strike. */
  fumbled: boolean;
}

/**
 * The kick-off layout.
 *
 * Exactly rotationally symmetric about the centre spot: every p1 post maps onto a p2 post
 * under the same half turn the board itself makes when the turn changes. Neither seat can
 * be handed the easier side, and `rules.test.ts` asserts the symmetry rather than trusting
 * these numbers to stay paired.
 *
 * A keeper **on its own line** and two outfielders further up. The keeper is the whole
 * defence: standing in the mouth it covers the middle of the goal from every approach at
 * once, so a wide angle is no easier than a straight one and the two open windows either
 * side of it are what a shot has to find. The outfielders sit off the line of the goal
 * entirely — they are what a ball takes a deflection off on the way.
 */
const LAYOUT: readonly (readonly [number, number, DiscKind])[] = Object.freeze([
  [CENTRE_X, CENTRE_Y, 'ball'],
  [CENTRE_X, PITCH_BOTTOM - 26, 'p1'],
  [CENTRE_X - 120, PITCH_BOTTOM - 200, 'p1'],
  [CENTRE_X + 120, PITCH_BOTTOM - 200, 'p1'],
  [CENTRE_X, PITCH_TOP + 26, 'p2'],
  [CENTRE_X + 120, PITCH_TOP + 200, 'p2'],
  [CENTRE_X - 120, PITCH_TOP + 200, 'p2'],
]);

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function createMatch(): Match {
  const discs: Disc[] = [];
  for (const [x, y, kind] of LAYOUT) {
    discs.push({ x, y, vx: 0, vy: 0, kind, postX: x, postY: y });
  }
  return {
    discs,
    seat: 'p1',
    phase: 'aiming',
    p1: 0,
    p2: 0,
    winner: null,
    shots: 0,
    lastGoal: null,
    fumbled: false,
  };
}

/**
 * Send the six discs back to their posts, and nudge the ball clear if one lands on it.
 *
 * Run when **every** shot settles, not only after a goal, and that is the rule the whole
 * balance of the game rests on. Left where they were knocked, the discs accumulate: a seat
 * that gets a shot away scatters the defence guarding the goal it is shooting at, which
 * makes its *next* shot easier, which is a feedback loop that hands the match to whoever
 * gets the first chance. Measured, `hard` against itself, sixty matches: 9–50 to p2, with
 * p1 converting 0% of its shots and p2 over half of theirs.
 *
 * Players trotting back into position between shots is also what the thing being modelled
 * looks like.
 */
export function restorePosts(match: Match): void {
  const ball = ballOf(match);
  for (const disc of match.discs) {
    if (disc === ball) continue;
    disc.x = disc.postX;
    disc.y = disc.postY;
    disc.vx = 0;
    disc.vy = 0;
    const dx = ball.x - disc.x;
    const dy = ball.y - disc.y;
    const gap = Math.hypot(dx, dy);
    const minimum = BALL_RADIUS + DISC_RADIUS + 1;
    if (gap >= minimum) continue;
    // A ball resting exactly on a post is pushed straight up the pitch rather than
    // dividing by zero, and never outside the boards.
    const nx = gap === 0 ? 0 : dx / gap;
    const ny = gap === 0 ? -1 : dy / gap;
    ball.x = clamp(disc.x + nx * minimum, PITCH_LEFT + BALL_RADIUS, PITCH_RIGHT - BALL_RADIUS);
    ball.y = clamp(disc.y + ny * minimum, PITCH_TOP + BALL_RADIUS, PITCH_BOTTOM - BALL_RADIUS);
  }
}

/** Everything on its post and the ball on the centre spot: the opening of a match. */
export function kickOff(match: Match): void {
  const ball = ballOf(match);
  ball.x = CENTRE_X;
  ball.y = CENTRE_Y;
  ball.vx = 0;
  ball.vy = 0;
  restorePosts(match);
}

/**
 * Put the ball back on the centre spot after a goal.
 *
 * The conceding seat restarts, as football does, and the centre spot is the one place on
 * the pitch neither seat owns. With the defence back on its posts as well (see
 * {@link restorePosts}) a restart is the same shot for whoever takes it.
 */
export function centreBall(match: Match): void {
  const ball = ballOf(match);
  ball.x = CENTRE_X;
  ball.y = CENTRE_Y;
  ball.vx = 0;
  ball.vy = 0;
}

export function resetMatch(match: Match): void {
  kickOff(match);
  match.seat = 'p1';
  match.phase = 'aiming';
  match.p1 = 0;
  match.p2 = 0;
  match.winner = null;
  match.shots = 0;
  match.lastGoal = null;
  match.fumbled = false;
}

export function ballOf(match: Match): Disc {
  return match.discs[0] as Disc;
}

/** The goal a seat is shooting at. p1 attacks the top of the board, p2 the bottom. */
export function attackingGoalY(seat: SeatId): number {
  return seat === 'p1' ? PITCH_TOP : PITCH_BOTTOM;
}

/** The goal a seat is defending — the one its own three discs stand in front of. */
export function defendingGoalY(seat: SeatId): number {
  return attackingGoalY(otherOf(seat));
}

export function shotsLeft(match: Match): number {
  const left = MAX_SHOTS - match.shots;
  return left > 0 ? left : 0;
}

/**
 * The outcome of the match, or null while it is still running.
 *
 * Delegated to the SDK helper rather than compared by hand, so "first to three" means the
 * same here as everywhere else and a level score when the shots run out is a defined draw
 * rather than an accident of which seat the code happened to test first.
 */
export function winnerOf(match: Match): SeatId | 'draw' | null {
  return resolve(
    WIN_CONDITION,
    { p1: match.p1, p2: match.p2 },
    { timeExpired: match.shots >= MAX_SHOTS },
  );
}

/** Strike the ball. Angle in radians, power 0..1. False when the shot is refused. */
export function strike(match: Match, angle: number, power: number): boolean {
  if (match.phase !== 'aiming') return false;
  const clamped = clamp(power, 0, 1);
  if (clamped <= 0) return false;
  const ball = ballOf(match);
  ball.vx = Math.cos(angle) * STRIKE_MAX_SPEED * clamped;
  ball.vy = Math.sin(angle) * STRIKE_MAX_SPEED * clamped;
  match.phase = 'rolling';
  match.lastGoal = null;
  match.fumbled = false;
  match.shots += 1;
  return true;
}

export function atRest(match: Match): boolean {
  for (const disc of match.discs) {
    if (disc.vx !== 0 || disc.vy !== 0) return false;
  }
  return true;
}

export interface StepResult {
  /** The seat that scored on this step, or null. */
  readonly goal: SeatId | null;
  /** True on the step everything comes to rest, or the step the ball goes in. */
  readonly settled: boolean;
}

/**
 * Reused rather than allocated.
 *
 * `step` runs on the fixed timestep and CLAUDE.md rule 5 forbids allocating there, so the
 * result is one module-level record rewritten in place. A caller that wants a value to
 * outlive the step copies the field out — the same contract the engine's `InputState` has.
 */
const stepResult = { goal: null as SeatId | null, settled: false };

/**
 * One fixed step of the pitch.
 *
 * Order is deliberate and matches Pool's, for the same reason: move, then boards, then
 * disc-on-disc. Resolving contacts before the boards let a disc be pushed through a board
 * and left outside the pitch for a frame.
 *
 * **The travel is the analytic integral of the decay, not `v · dt`.** Both are the same
 * model of grass; only one of them agrees with itself at two different step rates. Under
 * `v(t) = v₀ · ROLL_DRAG^t` a disc covers `(v_before - v_after) / DRAG_RATE` in a step, and
 * those terms telescope: a free roll totals `(v₀ - STOP_SPEED) / DRAG_RATE` however finely
 * it is sliced. Forward Euler instead overshoots by `dt · DRAG_RATE / 2`, about 1.3% at
 * 60 Hz and 0.6% at 120 Hz, which makes the same shot a different shot on a 120 Hz phone
 * and puts the bot's own distance arithmetic permanently 1.3% out. Mini Golf reached the
 * same place from constant deceleration; this is that lesson applied to the model this
 * game already had, and `rules.test.ts` rolls one shot at four step rates to prove it.
 */
export function step(match: Match, fixedDeltaSeconds: number): StepResult {
  stepResult.goal = null;
  stepResult.settled = true;
  if (match.phase !== 'rolling') return stepResult;

  const keep = Math.pow(ROLL_DRAG, fixedDeltaSeconds);
  for (const disc of match.discs) {
    const speed = Math.sqrt(disc.vx * disc.vx + disc.vy * disc.vy);
    if (speed === 0) continue;
    if (speed <= STOP_SPEED) {
      disc.vx = 0;
      disc.vy = 0;
      continue;
    }
    const ux = disc.vx / speed;
    const uy = disc.vy / speed;
    const next = speed * keep;
    if (next <= STOP_SPEED) {
      // The step it runs out on. Coast the exact distance left to the stop line and stop
      // dead there, so where a shot finishes does not depend on which step crossed it.
      const travel = (speed - STOP_SPEED) / DRAG_RATE;
      disc.x += ux * travel;
      disc.y += uy * travel;
      disc.vx = 0;
      disc.vy = 0;
      continue;
    }
    const travel = (speed - next) / DRAG_RATE;
    disc.x += ux * travel;
    disc.y += uy * travel;
    disc.vx = ux * next;
    disc.vy = uy * next;
  }

  const goal = boundaries(match);
  resolveContacts(match);

  stepResult.goal = goal;
  stepResult.settled = goal !== null || atRest(match);
  return stepResult;
}

export function radiusOf(kind: DiscKind): number {
  return kind === 'ball' ? BALL_RADIUS : DISC_RADIUS;
}

/** Whether the ball, at this x, is lined up to pass between the posts rather than hit one. */
export function insideMouth(x: number): boolean {
  return Math.abs(x - CENTRE_X) <= GOAL_HALF_WIDTH - BALL_RADIUS;
}

/**
 * The boards, and the two gaps in them.
 *
 * Only the ball passes through a goal mouth; the six discs bounce off the end line
 * everywhere, posts included. That is not quite football, and it is the right trade: a
 * disc parked inside the net would be unreachable by either player for the rest of the
 * match.
 */
function boundaries(match: Match): SeatId | null {
  let goal: SeatId | null = null;
  for (const disc of match.discs) {
    const radius = radiusOf(disc.kind);
    const left = PITCH_LEFT + radius;
    const right = PITCH_RIGHT - radius;
    if (disc.x < left) {
      disc.x = left;
      disc.vx = Math.abs(disc.vx) * WALL_BOUNCE;
    } else if (disc.x > right) {
      disc.x = right;
      disc.vx = -Math.abs(disc.vx) * WALL_BOUNCE;
    }

    if (disc.kind === 'ball' && insideMouth(disc.x)) {
      if (disc.y <= PITCH_TOP) {
        goal = 'p1';
        disc.y = PITCH_TOP - GOAL_DEPTH / 2;
        disc.vx = 0;
        disc.vy = 0;
      } else if (disc.y >= PITCH_BOTTOM) {
        goal = 'p2';
        disc.y = PITCH_BOTTOM + GOAL_DEPTH / 2;
        disc.vx = 0;
        disc.vy = 0;
      }
      continue;
    }

    const top = PITCH_TOP + radius;
    const bottom = PITCH_BOTTOM - radius;
    if (disc.y < top) {
      disc.y = top;
      disc.vy = Math.abs(disc.vy) * WALL_BOUNCE;
    } else if (disc.y > bottom) {
      disc.y = bottom;
      disc.vy = -Math.abs(disc.vy) * WALL_BOUNCE;
    }
  }
  return goal;
}

/**
 * Equal-mass elastic contact along the line of centres, plus a positional push.
 *
 * The push is what stops a pair caught overlapping from swapping velocities every frame and
 * buzzing in place, and a pair that is already separating is left alone — striking it again
 * on the following step pulls it back together and quietly adds energy. Both lessons are
 * Pool's, inherited rather than rediscovered.
 */
function resolveContacts(match: Match): void {
  const discs = match.discs;
  for (let i = 0; i < discs.length; i += 1) {
    const a = discs[i];
    if (a === undefined) continue;
    const ra = radiusOf(a.kind);
    for (let j = i + 1; j < discs.length; j += 1) {
      const b = discs[j];
      if (b === undefined) continue;
      const minimum = ra + radiusOf(b.kind);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq >= minimum * minimum || distanceSq === 0) continue;

      const distance = Math.sqrt(distanceSq);
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = (minimum - distance) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;

      const along = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (along > 0) continue;
      const impulse = along * DISC_BOUNCE;
      a.vx += impulse * nx;
      a.vy += impulse * ny;
      b.vx -= impulse * nx;
      b.vy -= impulse * ny;
    }
  }
}

export interface ShotOutcome {
  /** Who strikes next. */
  readonly next: SeatId;
  /** Set once the match is decided; a level score with no shots left is a draw. */
  readonly winner: SeatId | 'draw' | null;
  /** The seat that scored, or null. */
  readonly scored: SeatId | null;
}

/**
 * Settle a finished shot.
 *
 * A goal is credited to whoever attacks that end, which is what makes putting it through
 * your own net a gift rather than a special case. The conceding seat restarts from the
 * centre spot, exactly as football does, and that is the whole anti-runaway rule: a seat
 * three goals up has also handed over three kick-offs.
 *
 * Allocates one small record per **shot**, not per frame.
 */
export function settleShot(match: Match, goal: SeatId | null): ShotOutcome {
  if (goal !== null) {
    if (goal === 'p1') match.p1 += 1;
    else match.p2 += 1;
    match.lastGoal = goal;
    centreBall(match);
    restorePosts(match);
    return { next: otherOf(goal), winner: winnerOf(match), scored: goal };
  }
  match.lastGoal = null;
  restorePosts(match);
  return { next: otherOf(match.seat), winner: winnerOf(match), scored: null };
}

/**
 * End a turn nobody played.
 *
 * The shot clock. A seat that never strikes still spends one of the eighteen, so a player
 * who puts the phone down cannot freeze a match they are winning, and two absent humans
 * still reach a result.
 */
export function fumbleShot(match: Match): ShotOutcome {
  match.shots += 1;
  match.fumbled = true;
  match.lastGoal = null;
  return { next: otherOf(match.seat), winner: winnerOf(match), scored: null };
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Half-width of the aim error, in radians, drawn once per shot. */
  readonly spread: number;
  /**
   * Ceiling on how hard it hits, and therefore how far out it dares shoot from.
   *
   * The pitch is 780 units long and `powerFor(780)` is 0.83, so `easy` cannot shoot the
   * length of it at all and has to work the ball upfield instead — which is what a weak
   * player does. `hard` can, from anywhere.
   */
  readonly power: number;
  /** How many lines across the goal mouth it looks at before choosing. */
  readonly aimPoints: number;
  /** How long it takes to play, in seconds. A weaker player is also a slower one. */
  readonly thinkSeconds: number;
}

/**
 * The ladder, and the measurement that kept it.
 *
 * Mini Golf deleted a fourth lever — whether a tier planned round an obstacle at all —
 * because it made a cliff rather than a ladder. The obvious reading of that lesson here is
 * that `power` is the same kind of lever and should go too, so it was tried: uncapping all
 * three tiers and re-running the sweep, 60 matches a pairing. It cut the draw rate at
 * `easy` against itself from 67% to 42% — and it flattened the ladder from 97% / 100% /
 * 87% to 69% / 83% / 69%, which is three tiers that are barely three tiers.
 *
 * That is the opposite trade to Mini Golf's, and the difference is what the lever *is*.
 * Understanding the shape of a hole is not a difficulty setting; how far out you will shoot
 * from is one, and it is one every football player has an opinion about. It is also not a
 * cliff: every tier plans the same way, reads the same mouth, and plays from every position
 * — the weakest one simply passes the ball upfield from range instead of shooting, which is
 * a shot selection rather than a blindness. `bot.test.ts` holds the shipped ladder.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { spread: 0.4, power: 0.6, aimPoints: 5, thinkSeconds: 1 },
  normal: { spread: 0.2, power: 0.76, aimPoints: 9, thinkSeconds: 0.7 },
  hard: { spread: 0.1, power: 0.9, aimPoints: 17, thinkSeconds: 0.45 },
});

export interface Aim {
  readonly angle: number;
  readonly power: number;
}

/** How many directions the safety sweep looks at when no shot on goal is open. */
export const SAFETY_DIRECTIONS = 16;
/** How far ahead the safety sweep bothers to look, in logical units. */
export const SAFETY_REACH = 520;
/** How much harder than "just arrives" the bot strikes, so the ball gets there with pace. */
const OVERHIT = 1.45;

/**
 * Distance from the ball along `angle` until something is in the way, capped at `limit`.
 *
 * Analytic ray-to-circle rather than marching: exact, allocation-free, and the same answer
 * at every frame rate. This is the one thing the bot "sees" that a person does not compute
 * explicitly — but it is only the geometry already drawn on the screen, which is what
 * CLAUDE.md rule 6 asks.
 */
export function clearance(match: Match, angle: number, limit: number): number {
  const ball = ballOf(match);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const reach = BALL_RADIUS + DISC_RADIUS;
  const reachSq = reach * reach;
  let nearest = limit;
  for (const disc of match.discs) {
    if (disc.kind === 'ball') continue;
    const ox = disc.x - ball.x;
    const oy = disc.y - ball.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const perpSq = ox * ox + oy * oy - along * along;
    if (perpSq >= reachSq) continue;
    const hit = along - Math.sqrt(reachSq - perpSq);
    if (hit < nearest) nearest = hit > 0 ? hit : 0;
  }
  return nearest;
}

/**
 * Where the bot strikes.
 *
 * It looks at a handful of lines across the far goal mouth, keeps the ones nothing is
 * standing in, and otherwise plays the safety that carries the ball furthest up the pitch —
 * which is what a person does when the goal is covered. Everything it reads is on the
 * screen: disc positions, the mouth, the boards.
 *
 * The tiers differ in how many lines they consider, how steady the hand is, and how long
 * they take. None of them is given anything a player is not.
 */
export function botAim(match: Match, difficulty: BotDifficulty, roll: number): Aim {
  const profile = BOT_PROFILES[difficulty];
  const ball = ballOf(match);
  const seat = match.seat;
  const goalY = attackingGoalY(seat);

  let bestAngle = Math.atan2(goalY - ball.y, CENTRE_X - ball.x);
  let bestScore = -Infinity;
  let bestDistance = SAFETY_REACH;

  // How far this tier can roll the ball at all. A shot that cannot arrive is not a shot,
  // and without this the bot cheerfully replays the same unreachable line all match.
  const maxReach = reachOf(profile.power);

  // Sample the mouth, keep the longest unbroken run of lines nothing is standing in, and
  // aim at the middle of it. Sampling **outwards from the seat's own left** rather than
  // always from low x is what keeps the two seats exact mirrors of one another: a tie
  // between two equally wide gaps has to break the same way seen from either chair.
  const samples = profile.aimPoints;
  const half = GOAL_HALF_WIDTH - BALL_RADIUS;
  const direction = seat === 'p1' ? 1 : -1;
  let runStart = -1;
  let bestStart = -1;
  let bestEnd = -1;
  let bestRun = 0;
  for (let i = 0; i < samples; i += 1) {
    const targetX = mouthPoint(i, samples, half, direction);
    const angle = Math.atan2(goalY - ball.y, targetX - ball.x);
    const need = Math.hypot(targetX - ball.x, goalY - ball.y);
    if (need <= maxReach && clearance(match, angle, need) >= need) {
      if (runStart < 0) runStart = i;
      const run = i - runStart + 1;
      if (run > bestRun) {
        bestRun = run;
        bestStart = runStart;
        bestEnd = i;
      }
    } else {
      runStart = -1;
    }
  }
  if (bestRun > 0) {
    const targetX = mouthPoint((bestStart + bestEnd) / 2, samples, half, direction);
    bestAngle = Math.atan2(goalY - ball.y, targetX - ball.x);
    bestDistance = Math.hypot(targetX - ball.x, goalY - ball.y);
    bestScore = 400;
  }

  // Nothing on goal: play the ball as far up the pitch as it will run. The sweep starts
  // half a turn apart for the two seats so that, like the mouth scan, it is the same set
  // of directions in the same order from either chair.
  const gx = CENTRE_X - ball.x;
  const gy = goalY - ball.y;
  const toGoal = Math.hypot(gx, gy);
  const ux = toGoal === 0 ? 0 : gx / toGoal;
  const uy = toGoal === 0 ? 0 : gy / toGoal;
  const base = seat === 'p1' ? -Math.PI : 0;
  for (let i = 0; i < SAFETY_DIRECTIONS; i += 1) {
    const angle = base + (i / SAFETY_DIRECTIONS) * Math.PI * 2;
    const open = clearance(match, angle, SAFETY_REACH);
    const upfield = Math.cos(angle) * ux + Math.sin(angle) * uy;
    const score = open * 0.08 + upfield * 40;
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
      bestDistance = open;
    }
  }

  // Hit it as hard as the shot needs and no harder, with a little over so it arrives with
  // pace rather than dying on the line. A ball smashed at everything rebounds off the far
  // boards and comes back to the opponent, which is how the first bot lost matches.
  const power = clamp(powerFor(bestDistance * OVERHIT), 0.3, profile.power);
  // One error for the whole shot, drawn from the seeded stream. A per-step error would
  // average away and every tier would play the same.
  return { angle: bestAngle + (roll * 2 - 1) * profile.spread, power };
}

/** The x of sample `index` across the usable mouth, walked in the seat's own direction. */
function mouthPoint(index: number, samples: number, half: number, direction: number): number {
  const t = samples === 1 ? 0.5 : index / (samples - 1);
  return CENTRE_X + direction * (t * 2 - 1) * half;
}

/**
 * How far a ball struck at `power` rolls before it stops, on clear grass.
 *
 * Exact rather than indicative: {@link step} integrates the decay analytically, so this is
 * the distance the simulation actually produces, to floating point. `rules.test.ts` strikes
 * eleven powers and compares.
 */
export function reachOf(power: number): number {
  const reach = (STRIKE_MAX_SPEED * power - STOP_SPEED) / DRAG_RATE;
  return reach > 0 ? reach : 0;
}

/**
 * The power that rolls a ball exactly `distance`. The inverse of {@link reachOf}.
 *
 * The pair is what makes weight learnable — a player who found the right strength for a
 * length of pitch can repeat it, because the law is straight-line linear in power rather
 * than something that has to be felt out. It is also all the bot knows about how hard to
 * hit anything; no tier is given a better one.
 */
export function powerFor(distance: number): number {
  return (distance * DRAG_RATE + STOP_SPEED) / STRIKE_MAX_SPEED;
}
