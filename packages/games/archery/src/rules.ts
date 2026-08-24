import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Archery, as pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and the balance harness all drive
 * this module, so anything that touches a canvas belongs in game.ts.
 *
 * Three things are worth keeping apart, because they are tested in completely different
 * ways: **where an arrow lands** (a sum of aim, sway, wind and hand error, which is one
 * line of arithmetic), **what that is worth** (fixed ring geometry, exhaustively
 * testable without simulating a shot) and **who shoots when** (an ordering over shot
 * indices, which is pure counting).
 */

// ---------------------------------------------------------------------------
// The target
// ---------------------------------------------------------------------------

/** Rings from the centre outwards, worth ten down to one. */
export const RING_COUNT = 10;

export interface Landing {
  /** 1 is the innermost ring and 10 the outermost. 0 means the arrow missed the boss. */
  readonly ring: number;
  /** What the arrow is worth: ten for the innermost ring, down to one, zero for a miss. */
  readonly score: number;
  /** The innermost ring. Worth ten like any gold, and it is what breaks a tie. */
  readonly gold: boolean;
}

/**
 * One frozen record per ring, built once.
 *
 * Scoring is called on the step an arrow lands rather than every frame, so an allocation
 * there would be harmless — but a table is also the clearest statement of the mapping,
 * and it means a caller can never be handed a Landing it is able to mutate.
 */
const LANDINGS: readonly Landing[] = Object.freeze(
  Array.from({ length: RING_COUNT + 1 }, (_unused, ring) =>
    Object.freeze({ ring, score: ring === 0 ? 0 : RING_COUNT + 1 - ring, gold: ring === 1 }),
  ),
);

const MISS: Landing = LANDINGS[0] ?? { ring: 0, score: 0, gold: false };

/**
 * Score an arrow at `(x, y)` from the centre of the target, in units of its radius.
 *
 * Pure geometry, so every ring and both sides of every boundary are tested directly
 * rather than by shooting at them.
 */
export function scoreAt(x: number, y: number): Landing {
  const distance = Math.hypot(x, y);
  // Written as a failed `<=` rather than as `>`, so a NaN scores a miss rather than
  // falling through into `Math.ceil(NaN)` and indexing the table with it.
  if (!(distance <= 1)) return MISS;
  // The nudge is what makes a boundary belong to the ring inside it even when the
  // arithmetic cannot say so exactly: 0.7 * 10 is 7.000000000000001 in binary floating
  // point, which without it would score the line between the sevens and the sixes as a
  // six. A billionth of a radius is far below anything a player or a device can express.
  const ring = Math.max(1, Math.ceil(distance * RING_COUNT - 1e-9));
  return LANDINGS[ring] ?? MISS;
}

// ---------------------------------------------------------------------------
// The wind
// ---------------------------------------------------------------------------

/**
 * A breeze across the field, each component in [-1, 1].
 *
 * `x` is the cross-wind, which is the one a player has to fight; `y` is the weaker
 * head-or-tail wind that lifts an arrow or drops it short.
 */
export interface Wind {
  x: number;
  y: number;
}

/** How far a full cross-wind carries an arrow, in target radii. Four and a half rings. */
export const WIND_DRIFT_X = 0.46;
/** The along-range component is deliberately weaker: it reads as a nudge, not a shove. */
export const WIND_DRIFT_Y = 0.24;
/** The vertical component never blows at full strength. */
export const WIND_Y_LIMIT = 0.45;

export function createWind(): Wind {
  return { x: 0, y: 0 };
}

/** Rolls one arrow's weather from the seeded stream. Writes in place; allocates nothing. */
export function rollWind(out: Wind, rng: Rng): void {
  out.x = rng.float() * 2 - 1;
  out.y = (rng.float() * 2 - 1) * WIND_Y_LIMIT;
}

/** The 0–9 number shown on the flag, so the wind is readable rather than merely felt. */
export function windStrength(wind: Wind): number {
  return Math.round(Math.abs(wind.x) * 9);
}

// ---------------------------------------------------------------------------
// Drawing the bow
// ---------------------------------------------------------------------------

/** Seconds to come to full draw. Loose before this and the arrow falls short. */
export const DRAW_SECONDS = 0.4;
/** How far short a completely undrawn arrow lands, in target radii. Well off the boss. */
export const UNDERDRAW_DROP = 1.35;
/** The most a held draw ever wanders, in target radii. Three rings. */
export const SWAY_MAX = 0.3;
/** Seconds for the sway to reach 63% of its limit. */
export const SWAY_TAU = 0.55;
/** The sway is wider than it is tall, as a real bow arm is. */
export const SWAY_Y_SCALE = 0.65;

/** How far the bow is drawn, 0 to 1. */
export function drawProgress(seconds: number): number {
  if (!(seconds > 0)) return 0;
  return seconds >= DRAW_SECONDS ? 1 : seconds / DRAW_SECONDS;
}

/** How far short of the aim an under-drawn arrow lands, in target radii. */
export function underdrawDrop(seconds: number): number {
  return (1 - drawProgress(seconds)) * UNDERDRAW_DROP;
}

/**
 * How wide the bow arm is wandering after `seconds` of holding.
 *
 * Zero until full draw and then rising towards {@link SWAY_MAX}, so the perfect shot is
 * loosed the moment the bow comes back and dithering costs points. Expressed as a closed
 * form of elapsed time rather than as a per-step multiplier, so a 60 Hz device and a
 * 120 Hz one sway by exactly the same amount at the same instant.
 */
export function swayAmplitude(seconds: number): number {
  const held = seconds - DRAW_SECONDS;
  if (!(held > 0)) return 0;
  return SWAY_MAX * (1 - Math.exp(-held / SWAY_TAU));
}

/** One shot's wobble: its phases and rates are drawn fresh, so it cannot be memorised. */
export interface Sway {
  phaseX: number;
  phaseY: number;
  rateX: number;
  rateY: number;
}

export function createSway(): Sway {
  return { phaseX: 0, phaseY: 0, rateX: 0, rateY: 0 };
}

/**
 * Roll the wobble for one shot.
 *
 * Rates are in radians per second and sit near two thirds of a turn a second, which is
 * slow enough to read on screen and fast enough that waiting for the reticle to cross
 * the gold is a decision rather than a formality.
 */
export function rollSway(out: Sway, rng: Rng): void {
  const turn = Math.PI * 2;
  out.phaseX = rng.float() * turn;
  out.phaseY = rng.float() * turn;
  out.rateX = turn * (0.55 + rng.float() * 0.4);
  out.rateY = turn * (0.4 + rng.float() * 0.35);
}

/** Where the bow is pointing relative to the aim, after `seconds` of holding. */
export function swayAt(out: { x: number; y: number }, sway: Sway, seconds: number): void {
  const amplitude = swayAmplitude(seconds);
  out.x = amplitude * Math.cos(sway.rateX * seconds + sway.phaseX);
  out.y = amplitude * SWAY_Y_SCALE * Math.sin(sway.rateY * seconds + sway.phaseY);
}

// ---------------------------------------------------------------------------
// The shot
// ---------------------------------------------------------------------------

/**
 * Everything that decides where one arrow goes.
 *
 * Held as a record rather than nine arguments so the game can fill a preallocated one
 * every shot, and so a test can state a shot as data.
 */
export interface Shot {
  /** Where the archer was pointing, in target radii from the centre. */
  aimX: number;
  aimY: number;
  /** The bow arm's wander at the instant of release. */
  swayX: number;
  swayY: number;
  /** The wind on the field, in the same units {@link rollWind} produces. */
  windX: number;
  windY: number;
  /** How long the bow was drawn for. Short of {@link DRAW_SECONDS} the arrow falls. */
  drawSeconds: number;
  /** A bot's hand error. Zero for a person, who gets exactly the shot they loosed. */
  scatterX: number;
  scatterY: number;
}

export function createShot(): Shot {
  return {
    aimX: 0,
    aimY: 0,
    swayX: 0,
    swayY: 0,
    windX: 0,
    windY: 0,
    drawSeconds: 0,
    scatterX: 0,
    scatterY: 0,
  };
}

/**
 * Where an arrow lands, in target radii from the centre.
 *
 * The whole flight model, deliberately: an arrow leaves the string on the line the bow
 * was pointing along and the wind carries it while it travels, so the landing is the
 * aim plus every error that acted on it. Nothing here integrates, so a phone and a
 * laptop land the same arrow.
 */
export function resolveShot(out: { x: number; y: number }, shot: Shot): void {
  out.x = shot.aimX + shot.swayX + shot.windX * WIND_DRIFT_X + shot.scatterX;
  out.y =
    shot.aimY +
    shot.swayY +
    shot.windY * WIND_DRIFT_Y +
    shot.scatterY +
    underdrawDrop(shot.drawSeconds);
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

/** Three rounds, as the observed rules say. */
export const ROUNDS = 3;
/** Four arrows an end. Even, so the two seats lead exactly as often as each other. */
export const ARROWS_PER_ROUND = 4;
export const ARROWS_PER_SEAT = ROUNDS * ARROWS_PER_ROUND;
/** Both seats shoot every arrow, so a match is this many shots and then it is over. */
export const SHOTS_PER_MATCH = ARROWS_PER_SEAT * 2;

export interface SeatState {
  points: number;
  /** Arrows in the innermost ring. The tie-break, and nothing else. */
  golds: number;
  arrows: number;
  /** Points per round, for the scorecard. Length {@link ROUNDS}. */
  readonly roundPoints: number[];
}

export function createSeatState(): SeatState {
  return { points: 0, golds: 0, arrows: 0, roundPoints: new Array<number>(ROUNDS).fill(0) };
}

export function resetSeatState(state: SeatState): void {
  state.points = 0;
  state.golds = 0;
  state.arrows = 0;
  state.roundPoints.fill(0);
}

/** Add one scored arrow to a seat's card. */
export function recordArrow(state: SeatState, round: number, landing: Landing): void {
  state.points += landing.score;
  state.arrows += 1;
  if (landing.gold) state.golds += 1;
  if (round < 0 || round >= ROUNDS) return;
  state.roundPoints[round] = (state.roundPoints[round] ?? 0) + landing.score;
}

/** Which arrow of the match a shot index belongs to. Both seats shoot every arrow. */
export function arrowFor(shotIndex: number): number {
  return Math.floor(shotIndex / 2);
}

export function roundFor(shotIndex: number): number {
  return Math.floor(arrowFor(shotIndex) / ARROWS_PER_ROUND);
}

/** Which arrow of the current round a shot index belongs to, counting from zero. */
export function arrowInRoundFor(shotIndex: number): number {
  return arrowFor(shotIndex) % ARROWS_PER_ROUND;
}

/**
 * Who shoots first at each arrow.
 *
 * It alternates, because the second archer to shoot has watched an arrow fly through
 * exactly the wind they are about to shoot into. That is a small advantage and it is a
 * real one, so neither seat is allowed to hold it twice running. With an even number of
 * arrows in the match each seat leads exactly half of them.
 */
export function leaderFor(arrowIndex: number): SeatId {
  return arrowIndex % 2 === 0 ? 'p1' : 'p2';
}

/** Whose shot this is. */
export function shooterFor(shotIndex: number): SeatId {
  const leader = leaderFor(arrowFor(shotIndex));
  return shotIndex % 2 === 0 ? leader : otherSeat(leader);
}

/**
 * Highest total after three rounds, with the count of golds breaking a tie.
 *
 * Both comparisons go through the SDK's resolver rather than being written out here:
 * "highest when the match ends" means the same thing in every game in the catalogue,
 * and a draw is a defined outcome rather than an oversight. A tie on points *and* on
 * golds really is a draw, and the shell knows what to do with one.
 */
const HIGHEST: WinCondition = { kind: 'highest-when-time-expires' };

export function winnerOf(p1: SeatState, p2: SeatState, complete: boolean): Outcome {
  const onPoints = resolve(HIGHEST, { p1: p1.points, p2: p2.points }, { timeExpired: complete });
  if (onPoints !== 'draw') return onPoints;
  return resolve(HIGHEST, { p1: p1.golds, p2: p2.golds }, { timeExpired: true });
}

// ---------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * How much of the wind it actually allows for, 0 to 1.
   *
   * The flag is on screen for everybody; a weak archer simply misreads it. It is the skill
   * the game is *about*, but measurement says it is not the knob carrying the ladder —
   * see the sweep in SPEC.md. Reading the wind is only worth points to a hand steady
   * enough to use them: at `hard`'s spread, taking `windRead` from 0 to 0.95 is worth 1.47
   * points an arrow, and at `easy`'s spread the same move is worth 0.28.
   */
  readonly windRead: number;
  /**
   * How far its hand strays from where it aimed, as a standard deviation in radii.
   *
   * The knob that actually separates the tiers: on its own it carries 2.87 of the 4.46
   * points an arrow between `easy` and `hard`, against 0.28 for the wind and 0.21 for the
   * dithering. Recorded rather than tuned away — the other two are what make a tier read
   * as an archer of that standard rather than as the same archer with a shakier hand.
   */
  readonly spread: number;
  /** Seconds it dithers at full draw before loosing, while the bow arm wanders. */
  readonly dwell: number;
  /** Spread on that dither, so it never looses on the same frame twice. */
  readonly dwellSpread: number;
}

/**
 * Three tiers, all of them things a person does badly.
 *
 * A weak archer misreads the flag, holds the bow too long, and has an unsteady hand;
 * a strong one reads the wind, looses the moment the bow comes back, and holds a line.
 * None of the three knobs hands the bot anything a human on the same screen cannot see
 * (CLAUDE.md rule 6) — the wind is drawn on the flag, the sway is drawn on the reticle,
 * and the rings are the same rings.
 *
 * Measured over 400 matches a tier, in `rules.test.ts` and recorded in SPEC.md.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ windRead: 0.18, spread: 0.42, dwell: 0.95, dwellSpread: 0.4 }),
  normal: Object.freeze({ windRead: 0.65, spread: 0.21, dwell: 0.45, dwellSpread: 0.22 }),
  hard: Object.freeze({ windRead: 0.95, spread: 0.09, dwell: 0.16, dwellSpread: 0.08 }),
});

/**
 * A standard normal draw, by Box-Muller from the seeded stream.
 *
 * `float()` can return zero and `log(0)` is `-Infinity`, which would place an arrow at
 * NaN and score it a miss for ever after, so the draw is nudged into `(0, 1]`. A uniform
 * box would also make every bot miss look mechanical, clustering at the corners of a
 * square rather than scattering round the point it aimed at.
 */
export function gaussian(rng: Rng): number {
  const u1 = Math.max(Number.EPSILON, rng.float());
  const u2 = rng.float();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Scatter a shot around its aim, as a genuine two-dimensional normal. */
export function scatter(out: { x: number; y: number }, spread: number, rng: Rng): void {
  const u1 = Math.max(Number.EPSILON, rng.float());
  const u2 = rng.float();
  const magnitude = Math.sqrt(-2 * Math.log(u1)) * spread;
  const angle = 2 * Math.PI * u2;
  out.x = magnitude * Math.cos(angle);
  out.y = magnitude * Math.sin(angle);
}

/**
 * Where the bot points the bow: into the wind, by as much of it as this tier can read.
 *
 * It aims at the centre and offsets against the drift, which is exactly what a person
 * does with the same flag in front of them. It does not correct for its own sway,
 * because it cannot see the future — it simply tries to loose before the sway matters.
 */
export function botAim(out: { x: number; y: number }, wind: Wind, profile: BotProfile): void {
  out.x = -wind.x * WIND_DRIFT_X * profile.windRead;
  out.y = -wind.y * WIND_DRIFT_Y * profile.windRead;
}

/** How long this tier holds at full draw before it looses. Never negative. */
export function botDwellSeconds(profile: BotProfile, rng: Rng): number {
  const dwell = profile.dwell + gaussian(rng) * profile.dwellSpread;
  return dwell > 0 ? dwell : 0;
}
