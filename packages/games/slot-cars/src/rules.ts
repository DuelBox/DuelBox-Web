import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Slot Cars, as pure rules.
 *
 * Hold the throttle and the car goes faster. Let go and it slows. Carry too much speed into
 * a bend and it leaves the slot, and you lose two seconds getting it back. Three laps.
 *
 * ## The track is one dimensional, and that is the whole design **[ours]**
 *
 * A slot car cannot steer. It has exactly one control — power — and exactly one state that
 * matters: how fast it is going and where it is round the lap. So the simulation is a
 * **distance and a speed**, and the shape of the circuit is a curvature profile read off by
 * arc length. The two-dimensional track exists only in the renderer, which integrates the
 * same profile once at load to get a polyline.
 *
 * Three things fall out of that, and each of them would have been work otherwise:
 *
 * - **It is exactly fair.** Both cars run the identical profile from the identical start.
 *   The two lanes on screen are a *drawing device* — they are offset sideways so you can
 *   tell the cars apart, and the offset touches no distance. A real slot track needs
 *   crossovers to equalise its lanes; a track that is one number long does not.
 * - **It is trivially deterministic.** There is no physics to integrate but `v` and `s`,
 *   and no collision to resolve at all.
 * - **The skill is legible.** The safe speed at any point is a number the player can be
 *   shown, so "too fast for this bend" is a fact rather than a feeling.
 *
 * No rendering, no timing, no DOM.
 */

/** One piece of circuit: how long it runs and how hard it turns. */
export interface Segment {
  readonly length: number;
  /** Signed. Zero is a straight; larger magnitude is a tighter bend. */
  readonly curvature: number;
}

/**
 * The circuit, built rather than written down.
 *
 * It is a rounded rectangle with **four different corner radii**, which is the smallest
 * shape that gives a lap a rhythm worth learning rather than one corner repeated. Building
 * it from the box and the radii means it closes *by construction* — each straight is what is
 * left of a side once its two corners have taken their bite, and four 90° turns are exactly
 * one full circle.
 *
 * The first version was a list of hand-written segments and it did not close: the signed
 * turn came to 3π rather than 2π, so the track drawn from it would have spiralled. That is
 * the kind of mistake a constant cannot tell you about and a construction cannot make.
 */
const TRACK_WIDTH = 520;
const TRACK_HEIGHT = 760;
/** Corner radii, clockwise from the top-right. All different, on purpose. */
const CORNERS = [55, 170, 90, 130] as const;

function buildTrack(): Segment[] {
  const [topRight, bottomRight, bottomLeft, topLeft] = CORNERS;
  const straights = [
    TRACK_WIDTH - topLeft - topRight,
    TRACK_HEIGHT - topRight - bottomRight,
    TRACK_WIDTH - bottomRight - bottomLeft,
    TRACK_HEIGHT - bottomLeft - topLeft,
  ];
  const segments: Segment[] = [];
  for (let i = 0; i < 4; i += 1) {
    const radius = CORNERS[i] as number;
    segments.push({ length: straights[i] as number, curvature: 0 });
    segments.push({ length: (Math.PI / 2) * radius, curvature: 1 / radius });
  }
  return segments;
}

export const TRACK: readonly Segment[] = Object.freeze(buildTrack());

export const LAP_LENGTH = TRACK.reduce((total, segment) => total + segment.length, 0);
export const LAPS = 3;
export const RACE_LENGTH = LAP_LENGTH * LAPS;

/**
 * How much grip the slot has: a bend of radius `r` may be taken at `sqrt(GRIP · r)`.
 *
 * The one number that decides what the game feels like, and the first value was out by a
 * factor of sixteen — every corner came out safe at over 1,200 units a second against a
 * motor that tops out at 620, so **no bend on the track could be taken too fast** and the
 * only control in the game did nothing. At 2,040 the four corners are safe at 335, 589,
 * 428 and 515: the tight one is the corner that catches people out, the wide one is nearly
 * free, and the two in between are the ones worth learning.
 */
export const GRIP = 2_040;

/** Units a second the throttle adds. */
export const THROTTLE = 175;
/** Units a second lost while coasting. */
export const DRAG = 130;

/**
 * The speed the motor holds even with the throttle off.
 *
 * **This is what makes the race end.** A slot car is fed by the rail; it does not stop
 * because you stopped asking. Without a floor, a player who never touches the control never
 * finishes and no clock in the rules would change that — with one, a race between two
 * absent players still ends, in about eighty seconds, and the termination argument needs no
 * wall clock at all.
 */
export const CRAWL = 95;
export const MAX_SPEED = 620;

/** Seconds lost when a car leaves the slot. */
export const OFF_SECONDS = 1.9;
/** The speed it rejoins at. */
export const REJOIN_SPEED = 90;

export type Phase = 'racing' | 'over';

export interface Car {
  /** Distance travelled since the start of the race. */
  distance: number;
  speed: number;
  /** Seconds left off the slot; zero when running. */
  off: number;
  /** Times it has left the slot, for the HUD. */
  spills: number;
  /** Set once it crosses the line, in seconds. */
  finished: number;
}

export interface Game {
  readonly p1: Car;
  readonly p2: Car;
  phase: Phase;
  elapsed: number;
  winner: SeatId | 'draw' | null;
}

function makeCar(): Car {
  return { distance: 0, speed: CRAWL, off: 0, spills: 0, finished: -1 };
}

export function createGame(): Game {
  return { p1: makeCar(), p2: makeCar(), phase: 'racing', elapsed: 0, winner: null };
}

export function carOf(game: Readonly<Game>, seat: SeatId): Car {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function resetGame(game: Game): void {
  for (const car of [game.p1, game.p2]) {
    car.distance = 0;
    car.speed = CRAWL;
    car.off = 0;
    car.spills = 0;
    car.finished = -1;
  }
  game.phase = 'racing';
  game.elapsed = 0;
  game.winner = null;
}

/** Curvature at a distance round the lap. Wraps, so it works for any race distance. */
export function curvatureAt(distance: number): number {
  let along = distance % LAP_LENGTH;
  if (along < 0) along += LAP_LENGTH;
  for (const segment of TRACK) {
    if (along < segment.length) return segment.curvature;
    along -= segment.length;
  }
  // Unreachable while the lengths sum to LAP_LENGTH; the last segment is the honest answer.
  return (TRACK[TRACK.length - 1] as Segment).curvature;
}

/**
 * The fastest a car may go here without leaving the slot.
 *
 * `Infinity` on a straight, which is correct rather than convenient: nothing about a
 * straight limits speed, and `MAX_SPEED` is the motor's limit, not the track's.
 */
export function safeSpeedAt(distance: number): number {
  const curvature = Math.abs(curvatureAt(distance));
  if (curvature < 1e-9) return Infinity;
  return Math.sqrt(GRIP / curvature);
}

/** How far ahead the next place the car would be too fast is, or Infinity. */
export function distanceToDanger(distance: number, speed: number, limit = LAP_LENGTH): number {
  const stepSize = 10;
  for (let ahead = 0; ahead < limit; ahead += stepSize) {
    if (safeSpeedAt(distance + ahead) < speed) return ahead;
  }
  return Infinity;
}

export interface StepResult {
  /** Seats that left the slot this step. */
  readonly spilled: readonly SeatId[];
  /** Seats that crossed the line this step. */
  readonly finished: readonly SeatId[];
}

const spilledScratch: SeatId[] = [];
const finishedScratch: SeatId[] = [];
const result = { spilled: spilledScratch, finished: finishedScratch };
const SEATS: readonly SeatId[] = ['p1', 'p2'];

/**
 * One fixed step.
 *
 * `throttle` says whether each seat is asking for power right now. Both cars are advanced
 * from the same state before either finish is recorded, so two cars crossing on the same
 * step is a genuine dead heat rather than whichever was read first.
 */
export function step(
  game: Game,
  fixedDeltaSeconds: number,
  p1Throttle: boolean,
  p2Throttle: boolean,
): StepResult {
  spilledScratch.length = 0;
  finishedScratch.length = 0;
  if (game.phase === 'over') return result;

  game.elapsed += fixedDeltaSeconds;

  for (const seat of SEATS) {
    const car = carOf(game, seat);
    if (car.finished >= 0) continue;
    const throttle = seat === 'p1' ? p1Throttle : p2Throttle;

    if (car.off > 0) {
      car.off -= fixedDeltaSeconds;
      if (car.off <= 0) {
        car.off = 0;
        car.speed = REJOIN_SPEED;
      }
      continue;
    }

    car.speed += (throttle ? THROTTLE : -DRAG) * fixedDeltaSeconds;
    if (car.speed > MAX_SPEED) car.speed = MAX_SPEED;
    if (car.speed < CRAWL) car.speed = CRAWL;

    car.distance += car.speed * fixedDeltaSeconds;

    if (car.speed > safeSpeedAt(car.distance)) {
      car.off = OFF_SECONDS;
      car.speed = 0;
      car.spills += 1;
      spilledScratch.push(seat);
    }
  }

  for (const seat of SEATS) {
    const car = carOf(game, seat);
    if (car.finished >= 0 || car.distance < RACE_LENGTH) continue;
    car.finished = game.elapsed;
    finishedScratch.push(seat);
  }

  if (game.p1.finished >= 0 || game.p2.finished >= 0) settle(game);
  return result;
}

/**
 * Decide the race once anybody has finished.
 *
 * The moment one car crosses, the other's position is already known — it is behind, and
 * nothing it does afterwards can change the order. So the race is called there rather than
 * making the loser drive a lap alone.
 */
function settle(game: Game): void {
  const p1 = game.p1.finished;
  const p2 = game.p2.finished;
  game.phase = 'over';
  if (p1 >= 0 && p2 >= 0) game.winner = p1 === p2 ? 'draw' : p1 < p2 ? 'p1' : 'p2';
  else game.winner = p1 >= 0 ? 'p1' : 'p2';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/** Which lap a car is on, from one. */
export function lapOf(car: Readonly<Car>): number {
  return Math.min(LAPS, Math.floor(car.distance / LAP_LENGTH) + 1);
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How much of the safe speed it aims for. Below one it drives inside the limit; above
   * one it will spill.
   */
  readonly margin: number;
  /** How far ahead it reads the track, in seconds of travel. */
  readonly lookahead: number;
  /** Seconds between decisions; between them it holds what it chose. */
  readonly reaction: number;
  /** How finely it samples the track ahead, in units. Smaller is a more careful read. */
  readonly resolution: number;
}

/**
 * Three tiers, expressed only as how far ahead a tier reads and how close to the limit it
 * is willing to run.
 *
 * None of them gets a faster motor, more grip, or knowledge of a corner it cannot see — the
 * track is fixed and visible to everybody, which is what makes this an unusually honest
 * place to put rule 6. `easy` aims *over* the safe speed, which is exactly how a person
 * drives this before they have learned the lap.
 *
 * **A spill costs 1.9 seconds and a race is about thirty**, so the tiers are not ordered by
 * how fast they corner but by how nearly they can run at the limit *without* falling off.
 * The first set had `hard` at a margin of 0.99 against `normal`'s 0.95, and `hard` lost —
 * it spilled six times a race to `normal`'s five, and six spills is eleven seconds. Being
 * braver is not being better here; being braver *and accurate* is, which is why `hard`'s
 * advantage is a finer resolution and a longer look rather than a bigger number.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { margin: 1.1, lookahead: 0.5, reaction: 0.26, resolution: 26 },
  normal: { margin: 0.82, lookahead: 1.1, reaction: 0.12, resolution: 12 },
  hard: { margin: 0.93, lookahead: 1.9, reaction: 0.05, resolution: 5 },
});

export interface BotState {
  cooldown: number;
  throttle: boolean;
}

export function createBotState(): BotState {
  return { cooldown: 0, throttle: true };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.throttle = true;
}

/**
 * How much a bot's reaction wanders, as a fraction of it.
 *
 * **Without this two equal bots dead-heat every single race.** The track is the same every
 * lap, both cars start together, and a bot with no randomness in it is a pure function of
 * the state — so two of the same tier brake on the same step, corner at the same speed, and
 * cross the line at the identical thousandth of a second. Measured before this existed:
 * twenty races of every equal pairing, twenty draws.
 *
 * A wander in *when it looks* is the smallest thing that separates them, and it is also the
 * most honest — it is exactly what distinguishes two people of the same ability. Ten per
 * cent of a reaction is milliseconds, and it costs no tier any measurable pace.
 */
export const REACTION_WANDER = 0.1;

/**
 * Values a bot draws per decision. Always exactly this many.
 *
 * The two bots share the game's single `Rng`, so a seat whose draw count depended on what
 * it decided would shift the other seat's stream — a seat bias made of arithmetic, of the
 * kind Fruit Duel was caught by.
 */
export const BOT_DRAWS_PER_DECISION = 1;

/**
 * Whether the bot is asking for power this step.
 *
 * It looks along the track for the slowest corner inside its lookahead and asks whether it
 * could still shed enough speed by the time it arrives. That is the same sum a person does
 * by eye, with `DRAG` standing in for "how fast I know it slows".
 */
export function botThrottle(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): boolean {
  const car = carOf(game, seat);
  const profile = BOT_PROFILES[difficulty];

  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown > 0) return state.throttle;
  // Drawn before any branch on what it decides, so the count is constant. See
  // BOT_DRAWS_PER_DECISION.
  const wander = (rng.float() * 2 - 1) * REACTION_WANDER;
  state.cooldown = profile.reaction * (1 + wander);

  if (car.off > 0) {
    state.throttle = true;
    return true;
  }

  const horizon = Math.max(60, car.speed * profile.lookahead);
  const stepSize = profile.resolution;
  let wanted = true;
  for (let ahead = 0; ahead <= horizon; ahead += stepSize) {
    const limit = safeSpeedAt(car.distance + ahead) * profile.margin;
    if (!Number.isFinite(limit)) continue;
    // Could it still be slow enough by the time it got there, coasting the whole way?
    // v² = u² − 2·a·s, with `a` the drag it knows it has.
    const reachable = Math.sqrt(Math.max(0, car.speed * car.speed - 2 * DRAG * ahead));
    if (reachable > limit) {
      wanted = false;
      break;
    }
  }

  state.throttle = wanted;
  return wanted;
}

/**
 * The circuit closes on itself.
 *
 * Asserted here rather than only in a test so that the constant carries its own proof: a
 * profile whose signed turn is not a full circle would draw a track with a gap in it, and
 * the gap would only be visible on screen.
 */
export const TRACK_TURN = TRACK.reduce(
  (total, segment) => total + segment.curvature * segment.length,
  0,
);
