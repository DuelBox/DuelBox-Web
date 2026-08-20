import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Snake Clash, as pure rules.
 *
 * Two snakes share one arena. Steer; you cannot stop and you cannot reverse. Run into a
 * wall, into yourself, or into the other snake and you die — and eating a pellet makes you
 * longer, so **the arena fills up with the consequences of your own success**.
 *
 * That last part is what makes it a game rather than a race. This is the first game here
 * with a **body that grows into a hazard**: every other obstacle in this collection is
 * placed by the game, and these are placed by the players, one segment at a time.
 *
 * Continuous rather than gridded. A grid makes the two snakes take turns in effect —
 * everything happens on cell boundaries — and turns steering into typing. Continuous
 * movement with a turn *rate* keeps a thumb meaningful. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

export const ARENA_WIDTH = 900;
export const ARENA_HEIGHT = 900;
export const WALL = 20;

export const HEAD_RADIUS = 13;
/** How far apart the recorded points of a trail are. */
export const SEGMENT_SPACING = 11;
export const START_SEGMENTS = 14;
/** Segments added by one pellet. */
export const GROWTH_PER_PELLET = 7;

/**
 * Units a second.
 *
 * Swept. At 210 a round lasted 7.7 seconds and the snakes ate 2.4 pellets between
 * crashes; at 130 a round lasts about 20 seconds and they eat 5.2. Slower is not
 * more sluggish here — it is the difference between a game with decisions in it and
 * two snakes meeting in the middle before anything has happened.
 */
export const SPEED = 130;
/** Radians a second at full steer. */
export const TURN_RATE = 3.4;

export const PELLET_RADIUS = 14;
/** How many pellets are on the arena at once. */
export const PELLETS = 3;

/**
 * Pellets that win the round outright.
 *
 * Without a target, eating is **pure downside**: it makes you longer, which makes the
 * arena tighter for you, and gains nothing but a tie-break nobody reaches. The bot tiers
 * proved it — the tier that ignored food beat the tier that chased it, 40 to 17, by simply
 * circling an empty half of the arena while the other two grew and crashed.
 *
 * A target makes eating the way you win rather than a way you lose. **[ours]**
 */
export const PELLET_TARGET = 10;

/**
 * How many segments behind the head are ignored for self-collision.
 *
 * Without it a snake dies the instant it turns hard, because its own neck is inside its
 * head. Six segments is just past the tightest circle the turn rate can draw.
 */
export const NECK_SEGMENTS = 6;

export interface Point {
  x: number;
  y: number;
}

export interface Snake {
  /** The trail, head first. Never shrinks below `length`. */
  readonly body: Point[];
  /** Segments the snake is entitled to; the body is trimmed to it. */
  length: number;
  heading: number;
  alive: boolean;
  /** Pellets eaten, which is the score. */
  eaten: number;
  /** Distance travelled since the last point was recorded. */
  sinceSegment: number;
}

export type Phase = 'playing' | 'over';

export interface Game {
  readonly p1: Snake;
  readonly p2: Snake;
  readonly pellets: Point[];
  phase: Phase;
  winner: SeatId | 'draw' | null;
  /** Seconds the round has run, so a stalemate can be called. */
  elapsed: number;
}

/** A snake laid out as a straight line behind its head. */
function makeSnake(x: number, y: number, heading: number): Snake {
  const body: Point[] = [];
  for (let i = 0; i < START_SEGMENTS; i += 1) {
    body.push({
      x: x - Math.cos(heading) * i * SEGMENT_SPACING,
      y: y - Math.sin(heading) * i * SEGMENT_SPACING,
    });
  }
  return { body, length: START_SEGMENTS, heading, alive: true, eaten: 0, sinceSegment: 0 };
}

export function createGame(): Game {
  return {
    // Diagonally opposite, each heading along its own edge — the same position for both
    // under a half-turn of the arena, so it is fair, and neither is aimed at the other.
    //
    // The first opening tried was face to face across the middle, which is fair in exactly
    // the same way and turned out to be unplayable: the snakes met head-on in about three
    // seconds and **half of all rounds were draws before anyone had eaten anything**. A
    // fair opening is not the same as a good one.
    p1: makeSnake(ARENA_WIDTH * 0.25, ARENA_HEIGHT * 0.25, 0),
    p2: makeSnake(ARENA_WIDTH * 0.75, ARENA_HEIGHT * 0.75, Math.PI),
    pellets: [],
    phase: 'playing',
    winner: null,
    elapsed: 0,
  };
}

export function snakeOf(game: Game, seat: SeatId): Snake {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function headOf(snake: Snake): Point {
  return snake.body[0] as Point;
}

/** Scatter the pellets. Deterministic from the seeded rng. */
export function seedPellets(game: Game, rng: Rng): void {
  game.pellets.length = 0;
  for (let i = 0; i < PELLETS; i += 1) game.pellets.push(freeSpot(game, rng));
}

/**
 * A spot no snake is sitting on.
 *
 * Rejection sampling with a bounded attempt count and a fallback, because a nearly-full
 * arena could otherwise spin: a pellet that never appears would stall the round.
 */
export function freeSpot(game: Game, rng: Rng): Point {
  const low = WALL + PELLET_RADIUS * 2;
  const highX = ARENA_WIDTH - low;
  const highY = ARENA_HEIGHT - low;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = low + rng.float() * (highX - low);
    const y = low + rng.float() * (highY - low);
    if (clearOfSnakes(game, x, y, PELLET_RADIUS + HEAD_RADIUS)) return { x, y };
  }
  return { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 };
}

function clearOfSnakes(game: Game, x: number, y: number, room: number): boolean {
  for (const snake of [game.p1, game.p2]) {
    for (const point of snake.body) {
      if (Math.hypot(point.x - x, point.y - y) < room) return false;
    }
  }
  return true;
}

export function resetGame(game: Game, rng: Rng): void {
  const fresh = createGame();
  copySnake(game.p1, fresh.p1);
  copySnake(game.p2, fresh.p2);
  game.phase = 'playing';
  game.winner = null;
  game.elapsed = 0;
  seedPellets(game, rng);
}

function copySnake(target: Snake, source: Snake): void {
  target.body.length = 0;
  for (const point of source.body) target.body.push({ x: point.x, y: point.y });
  target.length = source.length;
  target.heading = source.heading;
  target.alive = source.alive;
  target.eaten = source.eaten;
  target.sinceSegment = source.sinceSegment;
}

/**
 * Steer a snake. `steer` is −1..1; anything else is clamped.
 *
 * A rate rather than a heading: you cannot spin on the spot and you cannot reverse, which
 * is what makes the arena filling up matter.
 */
export function steer(snake: Snake, amount: number, fixedDeltaSeconds: number): void {
  if (!snake.alive) return;
  const clamped = amount < -1 ? -1 : amount > 1 ? 1 : amount;
  snake.heading += clamped * TURN_RATE * fixedDeltaSeconds;
}

/** Whether a point is outside the walls. */
export function hitsWall(x: number, y: number): boolean {
  return (
    x < WALL + HEAD_RADIUS ||
    x > ARENA_WIDTH - WALL - HEAD_RADIUS ||
    y < WALL + HEAD_RADIUS ||
    y > ARENA_HEIGHT - WALL - HEAD_RADIUS
  );
}

/**
 * Whether a head at (x, y) is inside a body.
 *
 * `skip` ignores the first few segments, which is only ever used for a snake's own body:
 * without it a hard turn kills you on your own neck.
 */
export function hitsBody(snake: Snake, x: number, y: number, skip: number): boolean {
  const body = snake.body;
  for (let i = skip; i < body.length; i += 1) {
    const point = body[i];
    if (point === undefined) continue;
    if (Math.hypot(point.x - x, point.y - y) < HEAD_RADIUS * 1.6) return true;
  }
  return false;
}

export interface StepResult {
  /** Seats that died this step. Both can, which is a draw. */
  readonly died: readonly SeatId[];
  /** Seats that ate this step. */
  readonly ate: readonly SeatId[];
}

const diedScratch: SeatId[] = [];
const ateScratch: SeatId[] = [];

/**
 * One fixed step.
 *
 * Both snakes move before either is tested, so a head-on collision kills both rather than
 * whichever happened to be checked first. Order of iteration must never decide a death.
 */
export function step(game: Game, fixedDeltaSeconds: number, rng: Rng): StepResult {
  diedScratch.length = 0;
  ateScratch.length = 0;
  if (game.phase !== 'playing') return { died: diedScratch, ate: ateScratch };

  game.elapsed += fixedDeltaSeconds;

  for (const seat of ['p1', 'p2'] as SeatId[]) {
    const snake = snakeOf(game, seat);
    if (!snake.alive) continue;
    advance(snake, fixedDeltaSeconds);
  }

  for (const seat of ['p1', 'p2'] as SeatId[]) {
    const snake = snakeOf(game, seat);
    if (!snake.alive) continue;
    const head = headOf(snake);

    // Eat first: a pellet under a wall is still a pellet, and dying on the frame you ate
    // reads as the game taking it away.
    for (let i = 0; i < game.pellets.length; i += 1) {
      const pellet = game.pellets[i];
      if (pellet === undefined) continue;
      if (Math.hypot(pellet.x - head.x, pellet.y - head.y) > PELLET_RADIUS + HEAD_RADIUS) continue;
      snake.length += GROWTH_PER_PELLET;
      snake.eaten += 1;
      ateScratch.push(seat);
      game.pellets[i] = freeSpot(game, rng);
      break;
    }

    if (
      hitsWall(head.x, head.y) ||
      hitsBody(snake, head.x, head.y, NECK_SEGMENTS) ||
      hitsBody(snakeOf(game, otherOf(seat)), head.x, head.y, 0)
    ) {
      diedScratch.push(seat);
    }
  }

  for (const seat of diedScratch) snakeOf(game, seat).alive = false;

  if (!game.p1.alive || !game.p2.alive) {
    game.phase = 'over';
    game.winner = game.p1.alive ? 'p1' : game.p2.alive ? 'p2' : 'draw';
    return { died: diedScratch, ate: ateScratch };
  }

  // Reaching the target wins outright. Checked after the deaths, so a snake that eats its
  // tenth pellet and hits a wall in the same step does not win from beyond the grave.
  for (const seat of ['p1', 'p2'] as SeatId[]) {
    if (snakeOf(game, seat).eaten < PELLET_TARGET) continue;
    game.phase = 'over';
    game.winner = seat;
    break;
  }

  return { died: diedScratch, ate: ateScratch };
}

function advance(snake: Snake, fixedDeltaSeconds: number): void {
  const head = headOf(snake);
  const step = SPEED * fixedDeltaSeconds;
  const x = head.x + Math.cos(snake.heading) * step;
  const y = head.y + Math.sin(snake.heading) * step;

  snake.sinceSegment += step;
  if (snake.sinceSegment >= SEGMENT_SPACING) {
    snake.sinceSegment -= SEGMENT_SPACING;
    snake.body.unshift({ x, y });
    while (snake.body.length > snake.length) snake.body.pop();
  } else {
    head.x = x;
    head.y = y;
  }
}

/**
 * The round is called after this long with neither snake dead.
 *
 * Two cautious snakes circling their own halves will never meet, and nothing else here
 * would end such a round — `roundSeconds` is validated by the manifest schema and read
 * only by the catalogue card. Decided on pellets eaten, drawn if level.
 */
export const ROUND_SECONDS = 90;

export function callStalemate(game: Game): void {
  if (game.phase !== 'playing') return;
  game.phase = 'over';
  game.winner =
    game.p1.eaten === game.p2.eaten ? 'draw' : game.p1.eaten > game.p2.eaten ? 'p1' : 'p2';
}

export function winnerOf(game: Game): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far ahead it looks when testing whether a heading is safe, in seconds. */
  readonly lookahead: number;
  /** How wide a fan of headings it considers. More is finer steering. */
  readonly fanSize: number;
}

/**
 * Every tier chases pellets; they differ only in how well they stay alive while doing it.
 *
 * An earlier draft had the weakest tier ignore food entirely, which made it play a
 * different game rather than the same game worse — and, with no pellet target, a *better*
 * one.
 */

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { lookahead: 0.45, fanSize: 5 },
  normal: { lookahead: 0.9, fanSize: 7 },
  hard: { lookahead: 1.5, fanSize: 11 },
});

/**
 * How far the snake turns in one decision, at full lock.
 *
 * `botSteer` returns an amount, and the caller applies it for one fixed step. Dividing the
 * offset it wants by this is what makes the steering **proportional**: a small correction
 * gets a small amount rather than full lock.
 *
 * The first version divided by a constant a tenth this size, so every offset the fan could
 * produce clamped to ±1. The bot could only ever turn as hard as possible, which is why it
 * circled the arena and ate almost nothing — 1.2 pellets in a 65-second round.
 */
const TURN_PER_DECISION = TURN_RATE / 60;

/**
 * Whether a snake could travel `seconds` along `heading` without hitting anything.
 *
 * Sampled rather than swept: a snake is a chain of discs and the arena is not convex, so
 * an exact answer is not cheaper than walking the line and asking.
 */
export function pathIsClear(game: Game, seat: SeatId, heading: number, seconds: number): boolean {
  const snake = snakeOf(game, seat);
  const head = headOf(snake);
  const other = snakeOf(game, otherOf(seat));
  const otherHead = headOf(other);
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    const elapsed = seconds * (i / steps);
    const distance = SPEED * elapsed;
    const x = head.x + Math.cos(heading) * distance;
    const y = head.y + Math.sin(heading) * distance;
    if (hitsWall(x, y)) return false;
    if (hitsBody(snake, x, y, NECK_SEGMENTS)) return false;
    if (hitsBody(other, x, y, 0)) return false;

    // And where the other snake will *be*, not only where it is.
    //
    // This is the whole difference between a bot that plays and one that does not. Testing
    // only the opponent's current body meant two snakes approaching each other both saw a
    // clear path into the empty space between them, drove into it, and met: **103 of 109
    // deaths were head-on collisions.** Assuming it holds its heading is crude — it might
    // turn — but being wrong about a threat is far cheaper than not seeing one.
    if (other.alive) {
      const theirX = otherHead.x + Math.cos(other.heading) * distance;
      const theirY = otherHead.y + Math.sin(other.heading) * distance;
      if (Math.hypot(theirX - x, theirY - y) < HEAD_RADIUS * 2.4) return false;
    }
  }
  return true;
}

/**
 * Where the bot steers, as a −1..1 amount.
 *
 * It fans out headings either side of the one it is on, keeps the safe ones, and among
 * those prefers the one pointing nearest a pellet. Every tier sees the arena a human sees,
 * per rule 6 — the tiers differ in how far ahead they look and how finely they steer.
 */
export function botSteer(game: Game, seat: SeatId, difficulty: BotDifficulty): number {
  const profile = BOT_PROFILES[difficulty];
  const snake = snakeOf(game, seat);
  if (!snake.alive) return 0;
  const head = headOf(snake);

  const spread = Math.PI * 0.75;
  let best = 0;
  // `-Infinity` doubles as "nothing safe was found", which saves carrying a flag the
  // compiler cannot narrow through the closure below.
  let bestScore = -Infinity;

  const consider = (offset: number): void => {
    if (Math.abs(offset) > spread) return;
    if (!pathIsClear(game, seat, snake.heading + offset, profile.lookahead)) return;

    // Going straight is preferred, faintly, so a tie does not jitter.
    let score = -Math.abs(offset) * 0.4;
    {
      let nearest = Infinity;
      for (const pellet of game.pellets) {
        const towards = Math.atan2(pellet.y - head.y, pellet.x - head.x);
        const turn = Math.abs(normaliseAngle(towards - snake.heading - offset));
        const distance = Math.hypot(pellet.x - head.x, pellet.y - head.y);
        const cost = turn * 260 + distance;
        if (cost < nearest) nearest = cost;
      }
      if (Number.isFinite(nearest)) score -= nearest * 0.004;
    }

    if (score > bestScore) {
      bestScore = score;
      best = offset;
    }
  };

  // The fan, from straight ahead outwards: 0, +1, −1, +2, −2 … across the spread.
  for (let i = 0; i < profile.fanSize; i += 1) {
    const rank = Math.ceil(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    consider((rank / Math.max(1, (profile.fanSize - 1) / 2)) * spread * side);
  }

  // And the exact heading to each pellet, which the fan cannot name.
  //
  // A fan of eleven across ±135° has its finest step at 27°, so a bot steering only by fan
  // slots can aim *near* a pellet and never at one. Offering the real bearing is what lets
  // it actually arrive.
  for (const pellet of game.pellets) {
    consider(normaliseAngle(Math.atan2(pellet.y - head.y, pellet.x - head.x) - snake.heading));
  }

  // Nothing ahead is safe: turn as hard as it can and hope. A snake that gives up and
  // walks calmly into a wall looks broken rather than beaten.
  if (bestScore === -Infinity) return 1;

  const amount = best / TURN_PER_DECISION;
  return amount < -1 ? -1 : amount > 1 ? 1 : amount;
}

export function normaliseAngle(radians: number): number {
  let a = radians;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
