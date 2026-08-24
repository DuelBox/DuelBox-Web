import { misjudgement, resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';
import type { SeatId } from '@duelbox/engine';

/**
 * Mini Golf, as pure rules.
 *
 * Nine holes on one green. Both players putt at the same hole, alternating strokes, and
 * whoever holes out in fewer strokes takes the point. Two points clear wins the match.
 *
 * Two things drove the shape of this file:
 *
 * 1. **The ball has to stop, and quickly.** Bowling shipped with a ball that sailed on for
 *    eight seconds after every delivery. So the felt is modelled as a *constant
 *    deceleration* rather than as an exponential decay: a decay only approaches zero and
 *    needs a crawl threshold to cut it off, while a constant one reaches zero at a time
 *    that can be written down — `PUTT_MAX_SPEED / GREEN_FRICTION`, 2.22 seconds, whatever
 *    the ball does in between. Bounces only ever remove energy, so that is a real bound
 *    rather than a hope.
 * 2. **"Win by two" can run for ever.** Pool and Air Hockey both shipped unable to finish.
 *    Every level of this game is therefore capped: a stroke settles in bounded time, a hole
 *    ends after {@link MAX_STROKES} strokes each whether or not anybody has holed out, and
 *    the round ends after {@link HOLES} holes with the lead — then the fewer strokes —
 *    taking it. See `SPEC.md`.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit, never a pixel.
 */

/** The green. The band above holds the hole card and the one below the scoreboard. */
export const GREEN_LEFT = 40;
export const GREEN_TOP = 90;
export const GREEN_RIGHT = 660;
export const GREEN_BOTTOM = 880;

export const BALL_RADIUS = 11;
export const CUP_RADIUS = 21;

/**
 * How fast a ball may be moving and still drop.
 *
 * A putt hit too hard rattles the rim and runs on, which is a real rule of the game and the
 * reason power is a skill rather than a slider to hold at maximum. At this speed a ball can
 * stop at most `CAPTURE_SPEED² / (2 · GREEN_FRICTION)` — 84 units — past the cup and still
 * fall in, so a bot aiming to die 40 units past it is safe and one aiming 105 past it is
 * gambling. That difference is one of the three tiers.
 */
export const CAPTURE_SPEED = 250;

export const PUTT_MAX_SPEED = 820;

/**
 * Deceleration of a rolling ball, in units per second per second.
 *
 * Constant, not proportional: see the note at the top. It also gives the bot — and a player
 * — an exact relation between power and distance, `d = v² / 2a`, which is what makes a
 * putt learnable instead of a guess.
 */
export const GREEN_FRICTION = 370;
/** Sand is four times the drag, so a ball crossing it needs to be hit through it. */
export const SAND_FRICTION = 1500;

/** How much speed survives a wall. Enough to bank a putt, little enough to punish one. */
export const WALL_BOUNCE = 0.7;

/** The furthest a putt can travel on clean felt: `v² / 2a`, about 908 units. */
export const MAX_ROLL_DISTANCE = (PUTT_MAX_SPEED * PUTT_MAX_SPEED) / (2 * GREEN_FRICTION);

/**
 * A belt-and-braces cap on a single stroke.
 *
 * The friction model already stops every ball inside 2.22 seconds and a test proves it, so
 * this never fires in play. It is here because "the ball must actually settle" is the one
 * property the whole turn order rests on, and a guard that costs one addition a step is
 * cheaper than a match that hangs.
 */
export const MAX_ROLL_SECONDS = 4;

/** Anything softer than this is a nudge, not a stroke, and is refused. */
export const MIN_POWER = 0.02;

/** Strokes a player gets at a hole before they pick up. The hole's own cap. */
export const MAX_STROKES = 6;
/** What a pick-up is worth: worse than any completed hole, so holing out always beats it. */
export const PICKED_UP_SCORE = MAX_STROKES + 1;

/** Holes in a round. The match cap — see `settleHole`. */
export const HOLES = 9;

/** Two clear, exactly as the observed rule says. Resolved by the SDK helper, never by hand. */
export const WIN_CONDITION: WinCondition = { kind: 'lead-by', margin: 2 };

/**
 * The narrowest wall on the course.
 *
 * A ball moves at most `PUTT_MAX_SPEED / 60` — 13.7 units — in a step, and passing through
 * a wall undetected would need more than its thickness plus a ball diameter, 72 units. Five
 * times the margin, and a test holds the course to it so a new hole cannot quietly
 * introduce a wall a fast putt tunnels through.
 */
export const MIN_WALL_THICKNESS = 50;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Hole {
  /** What a good player takes. Shown on the card; it decides nothing. */
  readonly par: number;
  readonly tee: readonly [number, number];
  readonly cup: readonly [number, number];
  /** Solid blocks a ball bounces off. */
  readonly walls: readonly Rect[];
  /** Slow ground. A ball crossing it needs to be hit harder. */
  readonly sand: readonly Rect[];
  /** A ball that reaches water goes back where it was played from, and costs a stroke. */
  readonly water: readonly Rect[];
}

function rect(x: number, y: number, w: number, h: number): Rect {
  return Object.freeze({ x, y, w, h });
}

const NOTHING: readonly Rect[] = Object.freeze([]);

/**
 * The course. Nine holes, fixed rather than generated.
 *
 * A random course would make every match a different game and rob both players of the one
 * thing that makes a shared hole fair — that they are playing the *same* hole, and the
 * second player can watch what the first one learned. Difficulty climbs: an open putt, then
 * blocks to go round, a gate to thread, a dogleg, sand, water, a zigzag, and an island cup
 * with only one way in.
 */
export const COURSE: readonly Hole[] = Object.freeze([
  {
    par: 2,
    tee: [350, 800],
    cup: [350, 220],
    walls: NOTHING,
    sand: NOTHING,
    water: NOTHING,
  },
  {
    par: 3,
    tee: [350, 810],
    cup: [350, 200],
    walls: Object.freeze([rect(250, 440, 200, 60)]),
    sand: NOTHING,
    water: NOTHING,
  },
  {
    par: 4,
    tee: [350, 810],
    cup: [350, 190],
    walls: Object.freeze([rect(40, 600, 300, 50), rect(360, 400, 300, 50)]),
    sand: NOTHING,
    water: NOTHING,
  },
  {
    par: 2,
    tee: [350, 820],
    cup: [350, 180],
    walls: Object.freeze([rect(40, 480, 270, 50), rect(390, 480, 270, 50)]),
    sand: NOTHING,
    water: NOTHING,
  },
  {
    par: 3,
    tee: [170, 810],
    cup: [540, 200],
    walls: Object.freeze([rect(250, 300, 60, 400)]),
    sand: NOTHING,
    water: NOTHING,
  },
  {
    par: 3,
    tee: [350, 820],
    cup: [350, 200],
    walls: NOTHING,
    sand: Object.freeze([rect(230, 400, 240, 180)]),
    water: NOTHING,
  },
  {
    par: 3,
    tee: [200, 810],
    cup: [500, 210],
    walls: Object.freeze([rect(470, 640, 190, 50)]),
    sand: NOTHING,
    water: Object.freeze([rect(40, 400, 320, 240)]),
  },
  {
    par: 3,
    tee: [110, 820],
    cup: [600, 200],
    walls: Object.freeze([rect(230, 280, 60, 400), rect(430, 480, 60, 400)]),
    sand: NOTHING,
    water: NOTHING,
  },
  {
    par: 2,
    tee: [350, 830],
    cup: [350, 260],
    walls: Object.freeze([
      rect(200, 150, 90, 300),
      rect(410, 150, 90, 300),
      rect(200, 150, 300, 60),
    ]),
    sand: Object.freeze([rect(270, 520, 160, 90)]),
    water: NOTHING,
  },
]);

export function holeAt(index: number): Hole {
  const clamped = index < 0 ? 0 : index >= COURSE.length ? COURSE.length - 1 : index;
  const hole = COURSE[clamped];
  if (hole === undefined) throw new RangeError(`no hole at index ${String(index)}`);
  return hole;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Where this stroke was played from, so a ball in the water can be brought back. */
  fromX: number;
  fromY: number;
  /** Strokes taken at the current hole, penalties included. */
  strokes: number;
  holed: boolean;
  /** Out of strokes at this hole. Scores {@link PICKED_UP_SCORE}. */
  pickedUp: boolean;
}

export type Phase = 'aiming' | 'rolling' | 'hole-over' | 'over';

export interface Game {
  readonly p1: Ball;
  readonly p2: Ball;
  /** Who putts next. A turn game has to answer this. */
  seat: SeatId;
  phase: Phase;
  /** 0-based index into {@link COURSE}. */
  hole: number;
  /** Holes won — the points the observed rule counts. */
  readonly points: { p1: number; p2: number };
  /** Strokes round the whole course, which breaks a tie at the end of the round. */
  readonly totalStrokes: { p1: number; p2: number };
  winner: SeatId | 'draw' | null;
  /** Who took the hole just finished, or that it was halved. Null before the first. */
  lastHole: SeatId | 'halved' | null;
  /** The stroke in progress dropped. Read by `settleStroke`, then cleared. */
  lastSunk: boolean;
  /** The stroke in progress found water. */
  lastSplashed: boolean;
  /** Seconds the stroke in progress has been rolling, for the safety cap. */
  rollSeconds: number;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function ballOf(game: Game, seat: SeatId): Ball {
  return seat === 'p1' ? game.p1 : game.p2;
}

function ball(): Ball {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fromX: 0,
    fromY: 0,
    strokes: 0,
    holed: false,
    pickedUp: false,
  };
}

export function createGame(): Game {
  const game: Game = {
    p1: ball(),
    p2: ball(),
    seat: 'p1',
    phase: 'aiming',
    hole: 0,
    points: { p1: 0, p2: 0 },
    totalStrokes: { p1: 0, p2: 0 },
    winner: null,
    lastHole: null,
    lastSunk: false,
    lastSplashed: false,
    rollSeconds: 0,
  };
  placeForHole(game);
  return game;
}

export function resetGame(game: Game): void {
  game.hole = 0;
  game.points.p1 = 0;
  game.points.p2 = 0;
  game.totalStrokes.p1 = 0;
  game.totalStrokes.p2 = 0;
  game.winner = null;
  game.lastHole = null;
  placeForHole(game);
}

/**
 * Put both balls on the tee of the current hole.
 *
 * The seats alternate who plays first, hole by hole. Nothing in this game rewards playing
 * first — the two balls never touch, because a ball at rest in another's line is marked and
 * lifted, exactly as it is on a real green — so this is fairness by construction rather
 * than a rule anybody has to remember.
 */
export function placeForHole(game: Game): void {
  const hole = holeAt(game.hole);
  placeOnTee(game.p1, hole);
  placeOnTee(game.p2, hole);
  game.seat = game.hole % 2 === 0 ? 'p1' : 'p2';
  game.phase = 'aiming';
  game.lastSunk = false;
  game.lastSplashed = false;
  game.rollSeconds = 0;
}

function placeOnTee(side: Ball, hole: Hole): void {
  side.x = hole.tee[0];
  side.y = hole.tee[1];
  side.vx = 0;
  side.vy = 0;
  side.fromX = side.x;
  side.fromY = side.y;
  side.strokes = 0;
  side.holed = false;
  side.pickedUp = false;
}

/** Whether a seat still has a ball to play at this hole. */
export function stillPlaying(game: Game, seat: SeatId): boolean {
  const side = ballOf(game, seat);
  return !side.holed && !side.pickedUp;
}

/** What a seat took at the current hole. A pick-up is worse than any completed hole. */
export function holeScoreOf(game: Game, seat: SeatId): number {
  const side = ballOf(game, seat);
  return side.holed ? side.strokes : PICKED_UP_SCORE;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function pointInRect(x: number, y: number, box: Rect): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

export function inAny(boxes: readonly Rect[], x: number, y: number): boolean {
  for (const box of boxes) {
    if (pointInRect(x, y, box)) return true;
  }
  return false;
}

/**
 * Strike the ball. Angle in radians, power in [0, 1].
 *
 * Returns false rather than throwing on anything it will not accept — the wrong seat, a
 * ball already holed, a power too small to be a stroke, a non-finite angle out of a storm
 * of junk input — so a refusal is never mistaken for a stroke that went nowhere.
 */
export function putt(game: Game, seat: SeatId, angle: number, power: number): boolean {
  if (game.phase !== 'aiming') return false;
  if (game.seat !== seat) return false;
  if (!Number.isFinite(angle)) return false;
  const side = ballOf(game, seat);
  if (side.holed || side.pickedUp) return false;
  const clamped = clamp(power, 0, 1);
  // Written as a negated comparison so a NaN power is refused rather than let through.
  if (!(clamped > MIN_POWER)) return false;

  const speed = PUTT_MAX_SPEED * clamped;
  side.fromX = side.x;
  side.fromY = side.y;
  side.vx = Math.cos(angle) * speed;
  side.vy = Math.sin(angle) * speed;
  side.strokes += 1;
  game.phase = 'rolling';
  game.rollSeconds = 0;
  game.lastSunk = false;
  game.lastSplashed = false;
  return true;
}

export interface StepResult {
  /** True on the step the ball comes to rest, drops, or is fished out of the water. */
  readonly settled: boolean;
  readonly sunk: boolean;
  readonly splashed: boolean;
}

interface MutableStepResult {
  settled: boolean;
  sunk: boolean;
  splashed: boolean;
}

/** Reused, so a step allocates nothing. Read before the next call, never held. */
const stepScratch: MutableStepResult = { settled: true, sunk: false, splashed: false };

/**
 * One fixed step of the ball in play.
 *
 * The travel over a step is the exact integral of a constant deceleration, `(v - ½at)·t`,
 * rather than `v·t` — which is what makes the total roll come out the same at 60, 90 and
 * 120 Hz instead of drifting by a per-step rounding. A test steps the same putt at four
 * rates and compares where it stopped.
 */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  stepScratch.settled = true;
  stepScratch.sunk = false;
  stepScratch.splashed = false;
  if (game.phase !== 'rolling') return stepScratch;

  const side = ballOf(game, game.seat);
  const hole = holeAt(game.hole);
  game.rollSeconds += fixedDeltaSeconds;

  const speed = Math.hypot(side.vx, side.vy);
  if (speed > 0) {
    const ux = side.vx / speed;
    const uy = side.vy / speed;
    const decel = inAny(hole.sand, side.x, side.y) ? SAND_FRICTION : GREEN_FRICTION;
    let travel: number;
    let left: number;
    if (speed <= decel * fixedDeltaSeconds) {
      // It runs out inside this step: the exact remaining distance, then a dead stop.
      travel = (speed * speed) / (2 * decel);
      left = 0;
    } else {
      travel = (speed - 0.5 * decel * fixedDeltaSeconds) * fixedDeltaSeconds;
      left = speed - decel * fixedDeltaSeconds;
    }
    side.x += ux * travel;
    side.y += uy * travel;
    // Written as an exact zero rather than `ux * 0`, which is a negative zero for half the
    // directions on the green and reads as one in every test and trace that ever prints it.
    side.vx = left === 0 ? 0 : ux * left;
    side.vy = left === 0 ? 0 : uy * left;
  }

  bounceOffEdges(side);
  for (const wall of hole.walls) bounceOffWall(side, wall);

  if (inAny(hole.water, side.x, side.y)) {
    side.x = side.fromX;
    side.y = side.fromY;
    side.vx = 0;
    side.vy = 0;
    stepScratch.splashed = true;
    game.lastSplashed = true;
    return stepScratch;
  }

  if (cupCaptures(hole, side)) {
    side.x = hole.cup[0];
    side.y = hole.cup[1];
    side.vx = 0;
    side.vy = 0;
    side.holed = true;
    stepScratch.sunk = true;
    game.lastSunk = true;
    return stepScratch;
  }

  const stopped = side.vx === 0 && side.vy === 0;
  stepScratch.settled = stopped || game.rollSeconds >= MAX_ROLL_SECONDS;
  if (stepScratch.settled && !stopped) {
    side.vx = 0;
    side.vy = 0;
  }
  return stepScratch;
}

/**
 * Whether the ball drops.
 *
 * Over the cup **and** slow enough. A ball travelling faster than {@link CAPTURE_SPEED}
 * rides the rim and runs on, which is why a putt hit flat out at the hole is a bad putt.
 */
export function cupCaptures(hole: Hole, side: Ball): boolean {
  const dx = side.x - hole.cup[0];
  const dy = side.y - hole.cup[1];
  if (dx * dx + dy * dy > CUP_RADIUS * CUP_RADIUS) return false;
  return Math.hypot(side.vx, side.vy) <= CAPTURE_SPEED;
}

function bounceOffEdges(side: Ball): void {
  const left = GREEN_LEFT + BALL_RADIUS;
  const right = GREEN_RIGHT - BALL_RADIUS;
  const top = GREEN_TOP + BALL_RADIUS;
  const bottom = GREEN_BOTTOM - BALL_RADIUS;
  if (side.x < left) {
    side.x = left;
    side.vx = Math.abs(side.vx) * WALL_BOUNCE;
  } else if (side.x > right) {
    side.x = right;
    side.vx = -Math.abs(side.vx) * WALL_BOUNCE;
  }
  if (side.y < top) {
    side.y = top;
    side.vy = Math.abs(side.vy) * WALL_BOUNCE;
  } else if (side.y > bottom) {
    side.y = bottom;
    side.vy = -Math.abs(side.vy) * WALL_BOUNCE;
  }
}

/**
 * The ball against one block.
 *
 * Nearest point on the box, then push clear and reflect along that normal. The second half
 * — a centre that has ended up *inside* a box — cannot happen at these speeds, but a ball
 * that ever did get in would otherwise be pushed nowhere and buzz there for ever, and a
 * hole nobody can finish is exactly the failure this game is meant to avoid.
 */
function bounceOffWall(side: Ball, wall: Rect): void {
  const nearestX = clamp(side.x, wall.x, wall.x + wall.w);
  const nearestY = clamp(side.y, wall.y, wall.y + wall.h);
  const dx = side.x - nearestX;
  const dy = side.y - nearestY;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq > BALL_RADIUS * BALL_RADIUS) return;

  if (distanceSq > 1e-9) {
    const distance = Math.sqrt(distanceSq);
    const nx = dx / distance;
    const ny = dy / distance;
    side.x = nearestX + nx * BALL_RADIUS;
    side.y = nearestY + ny * BALL_RADIUS;
    reflect(side, nx, ny);
    return;
  }

  const toLeft = side.x - wall.x;
  const toRight = wall.x + wall.w - side.x;
  const toTop = side.y - wall.y;
  const toBottom = wall.y + wall.h - side.y;
  const shallowest = Math.min(toLeft, toRight, toTop, toBottom);
  if (shallowest === toLeft) {
    side.x = wall.x - BALL_RADIUS;
    reflect(side, -1, 0);
  } else if (shallowest === toRight) {
    side.x = wall.x + wall.w + BALL_RADIUS;
    reflect(side, 1, 0);
  } else if (shallowest === toTop) {
    side.y = wall.y - BALL_RADIUS;
    reflect(side, 0, -1);
  } else {
    side.y = wall.y + wall.h + BALL_RADIUS;
    reflect(side, 0, 1);
  }
}

function reflect(side: Ball, nx: number, ny: number): void {
  const along = side.vx * nx + side.vy * ny;
  // Already travelling away from the face: reflecting again would suck it back in.
  if (along >= 0) return;
  const impulse = (1 + WALL_BOUNCE) * along;
  side.vx -= impulse * nx;
  side.vy -= impulse * ny;
}

export interface StrokeOutcome {
  /** Who plays the next stroke. Meaningless when `holeOver`. */
  readonly next: SeatId;
  readonly holeOver: boolean;
}

const strokeScratch: { next: SeatId; holeOver: boolean } = { next: 'p1', holeOver: false };

/**
 * Book-keep the stroke that has just come to rest, and hand over.
 *
 * The water penalty is added here rather than in `step`, so a ball can only be charged once
 * however many steps it spends in the hazard.
 */
export function settleStroke(game: Game): StrokeOutcome {
  const seat = game.seat;
  const side = ballOf(game, seat);
  if (game.lastSplashed) side.strokes += 1;
  if (!side.holed && side.strokes >= MAX_STROKES) side.pickedUp = true;
  game.lastSplashed = false;

  const other = otherOf(seat);
  if (stillPlaying(game, other)) {
    game.seat = other;
    game.phase = 'aiming';
    strokeScratch.next = other;
    strokeScratch.holeOver = false;
    return strokeScratch;
  }
  if (stillPlaying(game, seat)) {
    game.phase = 'aiming';
    strokeScratch.next = seat;
    strokeScratch.holeOver = false;
    return strokeScratch;
  }
  game.phase = 'hole-over';
  strokeScratch.next = seat;
  strokeScratch.holeOver = true;
  return strokeScratch;
}

/**
 * Score the hole just finished and move the round on.
 *
 * This is where the match is capped. The lead-by-two is asked of the SDK's `resolve` so
 * that "two clear" means here what it means everywhere else; the ninth hole is where the
 * round simply stops, and the leader — failing that the player round in fewer strokes —
 * takes it. Without the cap two evenly matched players halve holes for ever, which is the
 * exact shape that has now broken Pool and Air Hockey.
 */
export function settleHole(game: Game): void {
  const p1 = holeScoreOf(game, 'p1');
  const p2 = holeScoreOf(game, 'p2');
  game.totalStrokes.p1 += p1;
  game.totalStrokes.p2 += p2;
  if (p1 < p2) {
    game.points.p1 += 1;
    game.lastHole = 'p1';
  } else if (p2 < p1) {
    game.points.p2 += 1;
    game.lastHole = 'p2';
  } else {
    game.lastHole = 'halved';
  }

  game.hole += 1;

  const clear = resolve(WIN_CONDITION, game.points);
  if (clear !== null) {
    game.winner = clear;
    game.phase = 'over';
    return;
  }
  if (game.hole >= HOLES) {
    game.winner = settleTheRound(game);
    game.phase = 'over';
    return;
  }
  placeForHole(game);
}

/**
 * Who takes a round that ran out of holes.
 *
 * The lead decides it — `resolve` again, told the clock has expired, so a one-point lead
 * that never became two still wins. A round level on points goes to the player who took
 * fewer strokes to get round, which is what golf has always meant by the better round; only
 * a course played in the identical number of strokes is a draw, and it is a rare one.
 */
export function settleTheRound(game: Game): Outcome {
  const byPoints = resolve(WIN_CONDITION, game.points, { timeExpired: true });
  if (byPoints !== null && byPoints !== 'draw') return byPoints;
  if (game.totalStrokes.p1 === game.totalStrokes.p2) return 'draw';
  return game.totalStrokes.p1 < game.totalStrokes.p2 ? 'p1' : 'p2';
}

export function winnerOf(game: Game): Outcome {
  return game.winner;
}

/**
 * Whether anything solid stands between two points.
 *
 * Water counts: a ball that has to be fished out is as blocked as one that cannot get past
 * a wall. The boxes are grown by a ball radius, so a line that shaves a corner is treated
 * as the miss it would be.
 */
export function pathBlocked(hole: Hole, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const wall of hole.walls) {
    if (segmentHitsRect(x0, y0, x1, y1, wall, BALL_RADIUS)) return true;
  }
  for (const pond of hole.water) {
    if (segmentHitsRect(x0, y0, x1, y1, pond, BALL_RADIUS)) return true;
  }
  return false;
}

/** The slab test, clipped to the segment. `margin` grows the box on every side. */
export function segmentHitsRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  box: Rect,
  margin: number,
): boolean {
  const minX = box.x - margin;
  const maxX = box.x + box.w + margin;
  const minY = box.y - margin;
  const maxY = box.y + box.h + margin;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let enter = 0;
  let leave = 1;

  if (dx === 0) {
    if (x0 < minX || x0 > maxX) return false;
  } else {
    const a = (minX - x0) / dx;
    const b = (maxX - x0) / dx;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }

  if (dy === 0) {
    if (y0 < minY || y0 > maxY) return false;
  } else {
    const a = (minY - y0) / dy;
    const b = (maxY - y0) / dy;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter > leave) return false;
  }

  return enter <= leave;
}

/**
 * How much of a line lies in sand, in logical units.
 *
 * Used to work out how much harder a putt has to be struck to cross it: sand costs
 * `SAND_FRICTION / GREEN_FRICTION` times as much reach per unit, so a length of sand is
 * worth that many units of ordinary green.
 */
export function sandCrossing(hole: Hole, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const span = Math.hypot(dx, dy);
  if (span === 0) return 0;
  let total = 0;
  for (const patch of hole.sand) {
    total += overlapOf(x0, y0, dx, dy, patch) * span;
  }
  return total;
}

/** The fraction of a segment inside a box, in [0, 1]. Zero when it misses. */
function overlapOf(x0: number, y0: number, dx: number, dy: number, box: Rect): number {
  let enter = 0;
  let leave = 1;
  if (dx === 0) {
    if (x0 < box.x || x0 > box.x + box.w) return 0;
  } else {
    const a = (box.x - x0) / dx;
    const b = (box.x + box.w - x0) / dx;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  if (dy === 0) {
    if (y0 < box.y || y0 > box.y + box.h) return 0;
  } else {
    const a = (box.y - y0) / dy;
    const b = (box.y + box.h - y0) / dy;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  return leave > enter ? leave - enter : 0;
}

/** The power that would leave a ball dead after `distance` units of clean green. */
export function powerForDistance(distance: number): number {
  const wanted = distance < 0 ? 0 : distance;
  return Math.sqrt(2 * GREEN_FRICTION * wanted) / PUTT_MAX_SPEED;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far its line strays, in radians, drawn once for the stroke. */
  readonly angleSpread: number;
  /** How far its weight strays, as a fraction of the power it meant to hit. */
  readonly powerSpread: number;
  /** How far past the cup it tries to leave the ball. Over 84 units it will not drop. */
  readonly overshoot: number;
}

/**
 * Three tiers, measured rather than chosen. See `SPEC.md` for the full table.
 *
 * Over 240 seeded matches a pairing: **hard beats easy 92%, normal beats easy 79%, hard
 * beats normal 74%**, and each tier is level against itself. They differ in three things a
 * person differs in — how straight the line is, how well the weight is judged, and whether
 * the player thinks about what is in the way — and in nothing else. Every tier sees the
 * same green a player sees.
 *
 * The trap Cup Pong fell into was a ladder whose tiers were three spellings of the same
 * thing because the error floor was the frame rate. Nothing here is timed: the error is an
 * angle and a weight, drawn once per stroke, so the floor is zero and the spreads are free
 * to be as far apart as the measurement wants them.
 *
 * `overshoot` is the third lever and it is the one that reads as skill. A ball can be at
 * most 84 units past the cup and still fall in, so `easy` is deliberately over that line: it
 * charges the hole and lips out, which is what a bad putter does.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { angleSpread: 0.13, powerSpread: 0.24, overshoot: 100 },
  normal: { angleSpread: 0.1, powerSpread: 0.2, overshoot: 88 },
  hard: { angleSpread: 0.078, powerSpread: 0.16, overshoot: 72 },
});

/** How far a corner is played wide of the block, so a bounce is not needed to get round. */
export const CORNER_CLEARANCE = BALL_RADIUS + 22;
/** How far past a corner a planned putt is struck, so it does not stop level with it. */
export const CORNER_RUN_ON = 260;

export interface Aim {
  angle: number;
  power: number;
}

const waypoint = { x: 0, y: 0, found: false };

/**
 * Where the bot putts, written into `out` so a stroke allocates nothing.
 *
 * It reads the ball, the cup and the blocks — all of it drawn on the screen in front of a
 * person, per rule 6 — and does what a player does: if it can see the cup it hits at the
 * cup with the weight to die just past it, and if it cannot it plays wide of the corner
 * that opens the cup up. The two rolls are its line and its weight, drawn **once for the
 * stroke**: an error redrawn every step averages to zero and every tier plays the same,
 * which is the single most repeated bug in this repository.
 */
export function botAim(
  out: Aim,
  game: Game,
  profile: BotProfile,
  angleRoll: number,
  powerRoll: number,
): Aim {
  const side = ballOf(game, game.seat);
  const hole = holeAt(game.hole);
  const cupX = hole.cup[0];
  const cupY = hole.cup[1];

  let targetX = cupX;
  let targetY = cupY;
  let extra = profile.overshoot;

  if (pathBlocked(hole, side.x, side.y, cupX, cupY)) {
    findWaypoint(hole, side.x, side.y, cupX, cupY);
    if (waypoint.found) {
      targetX = waypoint.x;
      targetY = waypoint.y;
      extra = CORNER_RUN_ON;
    }
  }

  // Sand costs several units of reach for every unit crossed, and a player learns that by
  // leaving one short exactly once.
  const drag = SAND_FRICTION / GREEN_FRICTION - 1;
  const want =
    Math.hypot(targetX - side.x, targetY - side.y) +
    extra +
    sandCrossing(hole, side.x, side.y, targetX, targetY) * drag;

  const power = powerForDistance(want) * (1 + misjudgement(powerRoll, profile.powerSpread));
  out.angle =
    Math.atan2(targetY - side.y, targetX - side.x) + misjudgement(angleRoll, profile.angleSpread);
  out.power = clamp(power, MIN_POWER * 2, 1);
  return out;
}

/**
 * The corner to play for when the cup is hidden.
 *
 * Every corner of every block, held wide by {@link CORNER_CLEARANCE}, is a candidate. The
 * cheap ones are the ones the ball can actually reach and that leave a clean line at the
 * cup — the second is worth a large discount, because a corner that opens the hole is worth
 * a longer putt to get to. Written into a module-level scratch, so this allocates nothing.
 */
function findWaypoint(hole: Hole, fromX: number, fromY: number, cupX: number, cupY: number): void {
  waypoint.found = false;
  let best = Infinity;
  for (const wall of hole.walls) {
    for (let corner = 0; corner < 4; corner += 1) {
      const left = corner === 0 || corner === 3;
      const x = left ? wall.x - CORNER_CLEARANCE : wall.x + wall.w + CORNER_CLEARANCE;
      const y = corner < 2 ? wall.y - CORNER_CLEARANCE : wall.y + wall.h + CORNER_CLEARANCE;
      if (x < GREEN_LEFT + BALL_RADIUS || x > GREEN_RIGHT - BALL_RADIUS) continue;
      if (y < GREEN_TOP + BALL_RADIUS || y > GREEN_BOTTOM - BALL_RADIUS) continue;
      if (insideSomething(hole, x, y)) continue;
      const reach = Math.hypot(x - fromX, y - fromY);
      // A corner underfoot is not a putt; playing at it would waste the stroke.
      if (reach < 40) continue;
      if (pathBlocked(hole, fromX, fromY, x, y)) continue;
      const score =
        reach + Math.hypot(cupX - x, cupY - y) - (pathBlocked(hole, x, y, cupX, cupY) ? 0 : 800);
      if (score >= best) continue;
      best = score;
      waypoint.x = x;
      waypoint.y = y;
      waypoint.found = true;
    }
  }
}

function insideSomething(hole: Hole, x: number, y: number): boolean {
  for (const wall of hole.walls) {
    if (
      x >= wall.x - BALL_RADIUS &&
      x <= wall.x + wall.w + BALL_RADIUS &&
      y >= wall.y - BALL_RADIUS &&
      y <= wall.y + wall.h + BALL_RADIUS
    ) {
      return true;
    }
  }
  return inAny(hole.water, x, y);
}
