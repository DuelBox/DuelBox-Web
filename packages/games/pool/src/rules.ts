import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Pool, as pure rules.
 *
 * A cue ball, seven balls a side and a black. Strike the cue ball; pot one of yours and you
 * shoot again. Clear your seven, then pot the black to win. Pot the black early, or pot it
 * off a foul, and you lose.
 *
 * This is the first game here with **many bodies colliding with each other**. Air Hockey
 * has one puck and Mini Soccer has one ball; here fifteen circles resolve against each
 * other and six pockets, every frame, and the whole thing has to replay identically from a
 * seed. That constraint drives most of what follows.
 *
 * No rendering, no timing, no DOM.
 */

export const TABLE_WIDTH = 1000;
export const TABLE_HEIGHT = 560;
/** The cushion, measured in from the table edge. */
export const CUSHION = 34;
export const BALL_RADIUS = 15;
export const POCKET_RADIUS = 26;

export const CUE_MAX_SPEED = 1500;
/** Per second, applied as a power. */
export const ROLL_DRAG = 0.22;
/** Below this a ball is stopped, so a table settles instead of creeping for ever. */
export const STOP_SPEED = 12;
export const CUSHION_BOUNCE = 0.86;
/** How much of the impact survives a ball-on-ball hit. */
export const BALL_BOUNCE = 0.96;

export const BALLS_PER_SIDE = 7;

export type BallKind = 'cue' | 'p1' | 'p2' | 'black';

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly kind: BallKind;
  /** Potted balls leave the table but keep their slot, so indices never shift. */
  potted: boolean;
}

export type Phase = 'aiming' | 'rolling' | 'over';

export interface Game {
  readonly balls: Ball[];
  seat: SeatId;
  phase: Phase;
  /** Set once someone has won; the seat that did. */
  winner: SeatId | 'draw' | null;
  /** Whether the shot in progress has potted one of the shooter's own balls. */
  pottedOwn: boolean;
  /** Whether the shot in progress has fouled. */
  fouled: boolean;
  /**
   * Consecutive shots that have potted nothing.
   *
   * Pool can reach a position neither player can clear, and nothing else here would ever
   * end such a frame: `roundSeconds` is only used to print "about 5 min" on a catalogue
   * card, so an unwinnable position is an unwinnable *match*. Two bots on `easy` proved it
   * — forty frames, none of them finished, over a thousand shots each.
   */
  dryShots: number;
}

/**
 * Consecutive shots potting nothing before the frame is called.
 *
 * Twenty, which is ten each. A frame in which neither player has potted in ten visits is
 * over in any real sense, and this is a real tournament rule rather than an invention.
 */
export const STALEMATE_SHOTS = 20;

/** The six pockets, as centres. */
export const POCKETS: readonly (readonly [number, number])[] = Object.freeze([
  [CUSHION, CUSHION],
  [TABLE_WIDTH / 2, CUSHION - 6],
  [TABLE_WIDTH - CUSHION, CUSHION],
  [CUSHION, TABLE_HEIGHT - CUSHION],
  [TABLE_WIDTH / 2, TABLE_HEIGHT - CUSHION + 6],
  [TABLE_WIDTH - CUSHION, TABLE_HEIGHT - CUSHION],
]);

function ball(x: number, y: number, kind: BallKind): Ball {
  return { x, y, vx: 0, vy: 0, kind, potted: false };
}

/**
 * The opening layout.
 *
 * A triangle of the fourteen colours and the black, with the black in the middle as the
 * game demands, and the cue ball on the baulk line. Fixed rather than random: an opening
 * both players know is part of the game, and a random rack would make the first shot a
 * lottery.
 */
export function createGame(): Game {
  const balls: Ball[] = [ball(TABLE_WIDTH * 0.26, TABLE_HEIGHT / 2, 'cue')];
  const apexX = TABLE_WIDTH * 0.66;
  const spacing = BALL_RADIUS * 2 + 1;
  // Alternating colours down the rack, with the black at the centre of the third row.
  const order: BallKind[] = [
    'p1',
    'p2',
    'p1',
    'p2',
    'black',
    'p1',
    'p1',
    'p2',
    'p1',
    'p2',
    'p2',
    'p1',
    'p2',
    'p1',
    'p2',
  ];
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let slot = 0; slot <= row; slot += 1) {
      const kind = order[index] ?? 'p1';
      index += 1;
      balls.push(
        ball(apexX + row * spacing * 0.87, TABLE_HEIGHT / 2 + (slot - row / 2) * spacing, kind),
      );
    }
  }
  return {
    balls,
    seat: 'p1',
    phase: 'aiming',
    winner: null,
    pottedOwn: false,
    fouled: false,
    dryShots: 0,
  };
}

export function resetGame(game: Game): void {
  const fresh = createGame();
  game.balls.length = 0;
  for (const b of fresh.balls) game.balls.push(b);
  game.seat = 'p1';
  game.phase = 'aiming';
  game.winner = null;
  game.pottedOwn = false;
  game.fouled = false;
  game.dryShots = 0;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function cueBall(game: Game): Ball {
  return game.balls[0] as Ball;
}

/** How many of a seat's own balls are still on the table. */
export function remaining(game: Game, seat: SeatId): number {
  let count = 0;
  for (const b of game.balls) {
    if (b.kind === seat && !b.potted) count += 1;
  }
  return count;
}

/** Whether a seat has cleared their colours and is on the black. */
export function onBlack(game: Game, seat: SeatId): boolean {
  return remaining(game, seat) === 0;
}

export function blackBall(game: Game): Ball | undefined {
  return game.balls.find((b) => b.kind === 'black');
}

/** Strike the cue ball. Angle in radians, power 0..1. */
export function strike(game: Game, angle: number, power: number): boolean {
  if (game.phase !== 'aiming') return false;
  const cue = cueBall(game);
  if (cue.potted) return false;
  const clamped = Math.max(0, Math.min(1, power));
  if (clamped <= 0) return false;
  cue.vx = Math.cos(angle) * CUE_MAX_SPEED * clamped;
  cue.vy = Math.sin(angle) * CUE_MAX_SPEED * clamped;
  game.phase = 'rolling';
  game.pottedOwn = false;
  game.fouled = false;
  return true;
}

export function tableIsStill(game: Game): boolean {
  for (const b of game.balls) {
    if (b.potted) continue;
    if (b.vx !== 0 || b.vy !== 0) return false;
  }
  return true;
}

function pocketed(x: number, y: number): boolean {
  for (const [px, py] of POCKETS) {
    const dx = x - px;
    const dy = y - py;
    if (dx * dx + dy * dy <= POCKET_RADIUS * POCKET_RADIUS) return true;
  }
  return false;
}

export interface StepResult {
  /** Balls potted this step, as indices. */
  readonly potted: readonly number[];
  /** True on the step the table comes to rest. */
  readonly settled: boolean;
}

const pottedScratch: number[] = [];

/**
 * One fixed step of the table.
 *
 * Order matters and is deliberate: move, then cushions, then ball-on-ball, then pockets.
 * Resolving pockets before collisions let a ball be potted and then struck by another in
 * the same step, which put a potted ball back on the table.
 */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  pottedScratch.length = 0;
  if (game.phase !== 'rolling') return { potted: pottedScratch, settled: true };

  const keep = Math.pow(ROLL_DRAG, fixedDeltaSeconds);

  for (const b of game.balls) {
    if (b.potted) continue;
    b.x += b.vx * fixedDeltaSeconds;
    b.y += b.vy * fixedDeltaSeconds;
    b.vx *= keep;
    b.vy *= keep;
    if (Math.hypot(b.vx, b.vy) < STOP_SPEED) {
      b.vx = 0;
      b.vy = 0;
    }
    bounceOffCushions(b);
  }

  resolveContacts(game);

  for (let i = 0; i < game.balls.length; i += 1) {
    const b = game.balls[i];
    if (b === undefined || b.potted) continue;
    if (!pocketed(b.x, b.y)) continue;
    b.potted = true;
    b.vx = 0;
    b.vy = 0;
    pottedScratch.push(i);
  }

  return { potted: pottedScratch, settled: tableIsStill(game) };
}

function bounceOffCushions(b: Ball): void {
  const left = CUSHION + BALL_RADIUS;
  const right = TABLE_WIDTH - CUSHION - BALL_RADIUS;
  const top = CUSHION + BALL_RADIUS;
  const bottom = TABLE_HEIGHT - CUSHION - BALL_RADIUS;
  if (b.x < left) {
    b.x = left;
    b.vx = Math.abs(b.vx) * CUSHION_BOUNCE;
  } else if (b.x > right) {
    b.x = right;
    b.vx = -Math.abs(b.vx) * CUSHION_BOUNCE;
  }
  if (b.y < top) {
    b.y = top;
    b.vy = Math.abs(b.vy) * CUSHION_BOUNCE;
  } else if (b.y > bottom) {
    b.y = bottom;
    b.vy = -Math.abs(b.vy) * CUSHION_BOUNCE;
  }
}

/**
 * Equal-mass elastic collision along the line of centres, plus a positional push so two
 * balls never sit inside one another.
 *
 * Without the push, a pair caught overlapping swaps velocities every frame and buzzes in
 * place instead of separating — which is what happened before it was added.
 */
function resolveContacts(game: Game): void {
  const balls = game.balls;
  const minimum = BALL_RADIUS * 2;
  for (let i = 0; i < balls.length; i += 1) {
    const a = balls[i];
    if (a === undefined || a.potted) continue;
    for (let j = i + 1; j < balls.length; j += 1) {
      const b = balls[j];
      if (b === undefined || b.potted) continue;
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

      // Only the component along the line of centres is exchanged; the tangential part of
      // each velocity is untouched, which is what makes a cut shot behave.
      const along = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (along > 0) continue; // already separating
      const impulse = along * BALL_BOUNCE;
      a.vx += impulse * nx;
      a.vy += impulse * ny;
      b.vx -= impulse * nx;
      b.vy -= impulse * ny;
    }
  }
}

/** Put the cue ball back on the baulk line after it has been potted. */
export function replaceCue(game: Game): void {
  const cue = cueBall(game);
  cue.potted = false;
  cue.vx = 0;
  cue.vy = 0;
  cue.x = TABLE_WIDTH * 0.26;
  cue.y = TABLE_HEIGHT / 2;
  // Nudge clear of anything sitting on the spot.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let clear = true;
    for (const b of game.balls) {
      if (b === cue || b.potted) continue;
      if (Math.hypot(b.x - cue.x, b.y - cue.y) < BALL_RADIUS * 2 + 1) {
        clear = false;
        break;
      }
    }
    if (clear) return;
    cue.x -= BALL_RADIUS;
    if (cue.x < CUSHION + BALL_RADIUS) cue.x = CUSHION + BALL_RADIUS;
  }
}

export interface ShotOutcome {
  /** Who shoots next. */
  readonly next: SeatId;
  /** Set when the match is decided. A stalemate can end it level. */
  readonly winner: SeatId | 'draw' | null;
  readonly fouled: boolean;
}

/**
 * Work out what a finished shot means.
 *
 * The rules kept: potting your own colour buys another shot; potting the cue ball is a
 * foul and passes the turn; potting the black before clearing your colours loses the game;
 * potting the black on a foul loses it too.
 */
export function settleShot(game: Game, potted: readonly number[]): ShotOutcome {
  const seat = game.seat;
  let pottedOwn = false;
  let pottedCue = false;
  let pottedBlack = false;

  for (const index of potted) {
    const b = game.balls[index];
    if (b === undefined) continue;
    if (b.kind === 'cue') pottedCue = true;
    else if (b.kind === 'black') pottedBlack = true;
    else if (b.kind === seat) pottedOwn = true;
  }

  const clearedBefore = onBlackBefore(game, seat, potted);

  if (pottedBlack) {
    // Winning needs the black potted after your colours are gone, and without a foul.
    const won = clearedBefore && !pottedCue;
    return { next: seat, winner: won ? seat : otherOf(seat), fouled: pottedCue };
  }

  game.dryShots = potted.length === 0 ? game.dryShots + 1 : 0;
  if (game.dryShots >= STALEMATE_SHOTS) {
    // Nobody has potted in ten visits each. Decide it on what is down, and call it a draw
    // when that is level — a frame that cannot end is worse than one that ends flat.
    const mine = BALLS_PER_SIDE - remaining(game, seat);
    const theirs = BALLS_PER_SIDE - remaining(game, otherOf(seat));
    if (mine === theirs) return { next: seat, winner: 'draw', fouled: pottedCue };
    return { next: seat, winner: mine > theirs ? seat : otherOf(seat), fouled: pottedCue };
  }

  if (pottedCue) {
    replaceCue(game);
    return { next: otherOf(seat), winner: null, fouled: true };
  }

  return { next: pottedOwn ? seat : otherOf(seat), winner: null, fouled: false };
}

/**
 * Whether the shooter had already cleared their colours *before* this shot.
 *
 * Checked from the state after the shot minus what this shot potted, because a player who
 * clears their last colour and the black in one stroke has not legally won — they were not
 * on the black when they struck.
 */
function onBlackBefore(game: Game, seat: SeatId, potted: readonly number[]): boolean {
  let left = remaining(game, seat);
  for (const index of potted) {
    const b = game.balls[index];
    if (b !== undefined && b.kind === seat) left += 1;
  }
  return left === 0;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const BOT_PROFILES: Readonly<
  Record<
    BotDifficulty,
    { readonly spread: number; readonly power: number; readonly picksBest: boolean }
  >
> = Object.freeze({
  easy: { spread: 0.13, power: 0.55, picksBest: true },
  normal: { spread: 0.06, power: 0.7, picksBest: true },
  hard: { spread: 0.018, power: 0.8, picksBest: true },
});

export interface Aim {
  readonly angle: number;
  readonly power: number;
}

/**
 * Where the bot aims.
 *
 * It picks one of its own balls and aims the cue ball at the point that would send it
 * toward the nearest pocket — the ghost-ball line every player is taught. The tiers differ
 * only in how accurately they hit that line and whether they choose the easiest target,
 * never in what they can see.
 */
export function botAim(game: Game, difficulty: BotDifficulty, roll: number): Aim {
  const profile = BOT_PROFILES[difficulty];
  const cue = cueBall(game);
  const seat = game.seat;
  const targetKind: BallKind = onBlack(game, seat) ? 'black' : seat;

  let bestAngle = 0;
  let bestScore = -Infinity;
  let found = false;
  let bestPlayable = false;

  for (const b of game.balls) {
    if (b.potted || b.kind !== targetKind) continue;
    for (const [px, py] of POCKETS) {
      // The ghost ball: where the cue must be at contact to send this ball at the pocket.
      const toPocket = Math.atan2(py - b.y, px - b.x);
      const ghostX = b.x - Math.cos(toPocket) * BALL_RADIUS * 2;
      const ghostY = b.y - Math.sin(toPocket) * BALL_RADIUS * 2;
      const angle = Math.atan2(ghostY - cue.y, ghostX - cue.x);

      // Prefer a short cue travel and a small cut. Both are what makes a shot easy, and
      // both are things a player can see.
      const cueTravel = Math.hypot(ghostX - cue.x, ghostY - cue.y);
      const cut = Math.abs(normaliseAngle(toPocket - angle));
      let score = -cueTravel * 0.01 - cut * 60;

      // A shot through another ball is not a shot, and neither is one whose contact point
      // is buried in a cushion. Without these the bot cheerfully replays an impossible
      // stroke for ever: forty `hard` frames, thirty of which never ended.
      const impossible = !onTable(ghostX, ghostY) || blocked(game, cue, b, ghostX, ghostY);
      if (impossible) score -= 1000;

      if (!found || score > bestScore) {
        found = true;
        bestScore = score;
        bestAngle = angle;
        bestPlayable = !impossible;
      }
    }
  }

  // Nothing can be potted from here. Play a safety: hit the nearest of your own balls,
  // which moves the table, avoids a foul, and may open something up. Firing the least bad
  // impossible line instead is how a frame grinds to a halt.
  if (found && !bestPlayable) {
    let nearest = Infinity;
    for (const b of game.balls) {
      if (b.potted || b.kind !== targetKind) continue;
      if (blocked(game, cue, b, b.x, b.y)) continue;
      const distance = Math.hypot(b.x - cue.x, b.y - cue.y);
      if (distance < nearest) {
        nearest = distance;
        bestAngle = Math.atan2(b.y - cue.y, b.x - cue.x);
      }
    }
  }

  if (!found) {
    // Nothing of ours left to aim at, which should not happen — hit the cue ball up-table
    // rather than doing nothing.
    return { angle: 0, power: profile.power };
  }

  // A single error drawn once for the shot, not per step: a per-step error averages away.
  return { angle: bestAngle + (roll * 2 - 1) * profile.spread, power: profile.power };
}

/** Whether a point is far enough inside the cushions for a ball to sit there. */
export function onTable(x: number, y: number): boolean {
  return (
    x >= CUSHION + BALL_RADIUS &&
    x <= TABLE_WIDTH - CUSHION - BALL_RADIUS &&
    y >= CUSHION + BALL_RADIUS &&
    y <= TABLE_HEIGHT - CUSHION - BALL_RADIUS
  );
}

/**
 * Whether anything stands between the cue ball and where it has to be at contact.
 *
 * A segment-to-centre distance, ignoring the cue ball itself and the ball being struck.
 */
export function blocked(
  game: Game,
  cue: Ball,
  target: Ball,
  ghostX: number,
  ghostY: number,
): boolean {
  const dx = ghostX - cue.x;
  const dy = ghostY - cue.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return false;
  for (const b of game.balls) {
    if (b === cue || b === target || b.potted) continue;
    let t = ((b.x - cue.x) * dx + (b.y - cue.y) * dy) / lengthSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const nx = cue.x + dx * t;
    const ny = cue.y + dy * t;
    if (Math.hypot(b.x - nx, b.y - ny) < BALL_RADIUS * 2) return true;
  }
  return false;
}

export function normaliseAngle(radians: number): number {
  let a = radians;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Unused by the game, but the bot's error needs a seeded source in tests. */
export function rollFor(rng: Rng): number {
  return rng.float();
}
