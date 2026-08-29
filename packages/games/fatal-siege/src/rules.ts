import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Fatal Siege, as pure rules.
 *
 * Two walls, back to back, and the same army marching on both of them. Soldiers come up five
 * roads toward your wall and never stop. A gun traverses along the wall; **press** and it
 * stops, keeping the road — **hold** and the shot charges out farther, and letting go sends
 * it. A soldier caught by the blast is smashed, and what it is worth is **how far out it
 * was**: three deep, two in the middle, one close in. Anything that gets inside the last
 * ninety units is out of reach and walks through the gate for nothing.
 *
 * ## Four decisions carry the whole game
 *
 * **The control is a press and a release, with no position at all.** Not a point, not a drag.
 * The shell splits the pointer surface into two zones, so a thumb only ever starts in its own
 * half; an absolute pointer therefore leaves part of a shared arena unreachable for one seat,
 * which four games in this archetype ship. A press has no coordinates for a zone to withhold,
 * and it is the same binary event with a timestamp on a key, a trackpad and a thumb, so no
 * instrument can aim finer than another. Explosive Festival argued this first and this game
 * follows it deliberately rather than inventing a second answer. **[ours]**
 *
 * **The charge is an accelerating integrator, and that is the whole difficulty curve.**
 * `range += v·dt + ½a·dt²` then `v += a·dt` — in that order, which for a constant `a` is the
 * exact integral rather than an approximation of one (issue #2465, and cannon-duel's flight
 * carries the same term for the same reason). The charge leaves the wall at
 * {@link CHARGE_SPEED} and gains {@link CHARGE_ACCEL}, so a tenth of a second of slop is
 * worth 9 units at the near edge and 45 at the far one. **The shot that scores most is the
 * shot that is hardest to place**, and that is arithmetic rather than a tuned table.
 * **[ours]**
 *
 * **The army is the clock.** {@link SOLDIERS} soldiers are released on a fixed cadence and
 * march at a fixed speed, so every one of them leaves the field — smashed or through the gate
 * — within a time that does not depend on anything anybody does. A match where neither player
 * ever touches the device takes exactly as long as one where both play perfectly. See
 * {@link SOLDIERS} for the arithmetic. **[ours]**
 *
 * **Both walls face the same army.** The wave is dealt once and handed to both seats in their
 * own frames, and both guns start at the same end of their own rails, so the two seats hold
 * bit-identical positions in their own frames and therefore exact half-turn images of each
 * other on the board — at the first step and at every step after it. What that buys is a
 * *proof* rather than a measurement: swap the two seats' bot streams and the whole match
 * reflects, 0 of 1500 matches failing to flip and 0 scoring differently. Nothing about this
 * game favours a chair, and that is checked match by match rather than inferred from a win
 * rate. The sampled companion figure, from the harness the shell actually produces — each seed
 * played from both openers with the streams left alone — is 50.5 / 49.6 / 50.5% to seat one
 * over 4000 matches a tier, each to within 0.8 of a point.
 *
 * It buys a second thing worth naming, because it explains the shape of every ladder number in
 * SPEC.md: sharing the wave removes the *seed* variance from a comparison between two seats.
 * Two tiers are not being asked to beat different armies, so a difference of a few points of
 * ground is almost never reversed by luck, and the head-to-head rates come out steeper than in
 * a game where each seat draws its own board. **[ours]**
 *
 * ## Everything here is in a seat's own frame
 *
 * No board coordinate appears in this file. A soldier is `(lane, d)` — which road it is on
 * and how far it still has to walk — and a shot is `(u, range)`, both measured from the
 * firing seat's own wall. `game.ts` turns those into board coordinates to draw them and
 * nowhere else.
 *
 * That is deliberate, and it is what makes the mirror property hold in the last bits rather
 * than to within a tolerance. A tie-break or a threshold written in board coordinates is not
 * covariant under the half-turn — it decides a mirrored position differently for the two
 * seats, which is exactly the defect Snowball Throw and Maze Paint were bisected down to. If
 * there are no board coordinates there is nothing to write it in.
 *
 * No rendering, no timing, no DOM.
 */

/** The board is square, so the same box works in either orientation. */
export const BOARD = 800;
export const CENTRE = BOARD / 2;

/**
 * How far inside its own edge each wall stands, and how deep the field in front of it is.
 *
 * `WALL_INSET + DEPTH` is exactly {@link CENTRE}, so the two fields meet on the centre line
 * and neither overlaps the other. Under the half-turn about the board's centre one wall maps
 * onto the other and one field onto the other, so neither seat can ever see more of the play
 * area than the other — rule 9, by construction rather than by camera work, because there is
 * no camera.
 */
export const WALL_INSET = 40;
export const DEPTH = CENTRE - WALL_INSET;

export const WALL_P1_Y = BOARD - WALL_INSET;
export const WALL_P2_Y = WALL_INSET;

/**
 * The roads, and the rail the gun traverses along.
 *
 * Five roads a hundred apart on a rail four hundred and eighty wide, so the whole set is
 * symmetric about the middle of the rail and maps onto itself when the board is turned over.
 * Lane index is in the firing seat's own frame — lane 0 is the leftmost road *as that seat
 * sees it* — which is what makes the two seats' waves the same array of numbers rather than
 * two arrays that have to be kept in step.
 */
export const LANES = 5;
export const LANE_SPACING = 100;
export const LANE_ORIGIN = 40;
export const RAIL = LANE_ORIGIN * 2 + (LANES - 1) * LANE_SPACING;

/** Where the rail sits on the board. Both seats' rails cover the same columns. */
export const RAIL_X0 = (BOARD - RAIL) / 2;
export const RAIL_X1 = RAIL_X0 + RAIL;

/**
 * How fast the gun traverses, and why it is exactly the charge's terminal rate.
 *
 * A press is late by `t` seconds and misses the road by `TRAVERSE_RATE · t`; a release is
 * late by `t` and misses the distance by `dRange/dt · t`, which is {@link CHARGE_SPEED} at
 * the near edge and `CHARGE_SPEED + CHARGE_ACCEL · CHARGE_SECONDS` = 450 at the far one. So
 * the two halves of a shot cost the same *only at maximum range*, and by design: the deepest
 * shot is the one where the error is a circle, and every shallower shot is more forgiving in
 * range than in road. A player who cannot yet hold the far band still has somewhere to stand.
 *
 * 480 units of rail at 450 units a second is 1.07 s a crossing, next to Cup Pong's 0.65 s
 * needle and Explosive Festival's 0.94 s cart. It is the slowest of the three because this
 * game asks for a second decision immediately afterwards.
 */
export const TRAVERSE_RATE = 450;

/**
 * The charge: where a shot starts, where it ends, and the two numbers that get it there.
 *
 * `RANGE_MIN` is what a tap fires — hold nothing at all and the shot lands ninety units out.
 * `RANGE_MAX` is the far edge of the field, so topping the charge out reaches the line
 * soldiers are released on and nothing beyond it.
 *
 * The three constants are not independent and the file would lie if it pretended they were.
 * With `v₀ = 90` and `a = 360`:
 *
 * - the charge covers `RANGE_MAX − RANGE_MIN = 270` units in `v₀t + ½at² = 270` at
 *   **t = 1.000 s exactly**, which is {@link CHARGE_SECONDS};
 * - its rate at that moment is `v₀ + a·t = 450`, which is {@link TRAVERSE_RATE} exactly.
 *
 * Both are asserted in `rules.test.ts` rather than left as a comment, because the second one
 * is the sentence above about the error being a circle, and the first is the bound on how
 * long a shot can be held.
 */
export const RANGE_MIN = 90;
export const RANGE_MAX = DEPTH;
export const CHARGE_SPEED = 90;
export const CHARGE_ACCEL = 360;
/** How long the charge takes to run from {@link RANGE_MIN} to {@link RANGE_MAX}. */
export const CHARGE_SECONDS = 1;

/**
 * The blast, in the firing seat's own frame — half a road's width, and never two soldiers.
 *
 * Forty against a hundred-unit road spacing means no point on the field is within the blast
 * of two soldiers *in different roads*; forty against `MARCH_SPEED · SPAWN_INTERVAL` = 100
 * means the same for two soldiers on the *same* road, because they are released on a fixed
 * cadence at a fixed speed and their separation therefore never changes. So a shot smashes at
 * most one soldier, the score is exact arithmetic rather than a chain reaction, and
 * `rules.test.ts` walks a whole match asserting the closest pair of live soldiers is never
 * within `2 · BLAST` of each other.
 *
 * In seconds of slop — which is the currency both halves of a shot are actually paid in — it
 * is `BLAST / TRAVERSE_RATE` = 0.089 s on the road, and on the distance it runs from 0.089 s
 * at the far edge to 0.444 s at the near one. Cup Pong measured a person's timing error at
 * 0.11 to 0.20 s and Explosive Festival shipped its tiers at 0.10 to 0.22; this game's are
 * 0.115 to 0.20. So the far band sits just under the window a person plays in and the near
 * band comfortably above it — which is the whole reason a deep shot is worth three and a near
 * one worth one, and it is a consequence of the geometry rather than a table anybody tuned.
 */
export const BLAST = 40;

/**
 * How fast a shot flies, and why it is not instant.
 *
 * A soldier moves {@link MARCH_SPEED} units a second and the longest flight is
 * `RANGE_MAX / SHOT_SPEED` = 0.514 s, so a full-distance shot has to be led by 25.7 units —
 * most of a blast radius. Leading the target is the part of this game Explosive Festival does
 * not have, and it is also the part that makes the bot's closed form worth getting exactly
 * right: a bot that aimed where a soldier *is* rather than where it *will be* would miss
 * every deep shot by more than half a blast, systematically, in a way no amount of tuning its
 * timing error could reach.
 */
export const SHOT_SPEED = 700;
export const SHOT_RADIUS = 8;
/** How long a burst is held on the field after it has been judged. Presentation only. */
export const BURST_SECONDS = 0.3;

/**
 * How fast soldiers walk, and how often another one is released.
 *
 * `MARCH_SPEED · SPAWN_INTERVAL` = 100 = {@link LANE_SPACING}, which is not a coincidence:
 * it makes the wave a lattice in *both* directions, so the "one soldier a shot" property
 * above holds along a road as well as across the roads, and it makes a soldier's distance a
 * simple function of when it was released.
 *
 * A soldier is on the field for `DEPTH / MARCH_SPEED` = 7.2 s and is engageable for the first
 * 5.25 s of that — see {@link RANGE_MIN}. A full shot cycle is a reload, a wait for the
 * traverse and a charge, which is between 0.45 and 2.5 s, so a seat gets one good look at
 * each soldier and occasionally two. Releasing them every 2 s against that is deliberately
 * a little faster than anybody can answer: **the game is over-subscribed on purpose**, which
 * is what turns "shoot the deep one or the near one" into a decision instead of a preference.
 */
export const MARCH_SPEED = 50;
export const SPAWN_INTERVAL = 2;

/**
 * The size of the army, and the whole termination argument.
 *
 * `SOLDIERS` is fixed, the release cadence is fixed, and a soldier leaves the field either
 * because it was smashed or because it reached the gate — nothing anybody does can add one,
 * delay one, or hold one on the field. So the longest possible match is
 *
 *     OPENING + (SOLDIERS − 1) · SPAWN_INTERVAL + DEPTH / MARCH_SPEED
 *     = 0.6 + 26 + 7.2 = **33.8 seconds**
 *
 * and that is not a bound, it is the *exact* length of a match nobody plays: every soldier
 * walks the full field and the last one arrives at 33.8 s. Playing well only makes it
 * shorter. `apps/web/src/data/termination.test.ts` allows ten minutes.
 *
 * This is Explosive Festival's guarantee with the finite quantity moved from the player's
 * side of the field to the world's. There it was a stock of rockets spent by a fuse whether
 * or not anybody pressed; here it is a stock of soldiers spent by their own legs, which is
 * stronger in one specific way — the fuse bound still depended on how a player fired, and
 * this one does not depend on the players at all. `roundSeconds` ends nothing and is not
 * consulted anywhere in this file.
 *
 * Fourteen is a score question rather than a termination one; see {@link WIN_CONDITION}.
 */
export const SOLDIERS = 14;

/** Seconds at the start with everything parked, so both players can read the first road. */
export const OPENING = 0.6;

/** Reload between shots. Long enough that a tap is a real choice and not a stutter. */
export const RELOAD = 0.45;

/**
 * The two band edges, and the score they carve out of the field.
 *
 * A smashed soldier is worth 3 beyond `BAND_FAR`, 2 between the two, and 1 inside
 * `BAND_NEAR`. One that reaches the gate is worth nothing. That is the catalogue row read
 * literally — *don't let them get close, smash them first* — turned into a number, and it is
 * the answer to the failure Sudoku and Blocks shipped: **a count of soldiers smashed
 * saturates and a measure of ground held does not.** A seat that smashes everything close in
 * scores 14; a seat that smashes half of them at the far edge scores 21.
 *
 * The edges are deliberately **off the step lattice**, and the arithmetic is worth writing
 * down rather than asserting. A soldier's distance after `n` marches is
 * `DEPTH − MARCH_SPEED · n · dt`, so at a rate of `R` steps a second it lands exactly on a
 * band edge when `R · (DEPTH − BAND) / MARCH_SPEED` is a whole number. `DEPTH − BAND` is 186
 * and 96 here, neither divisible by 5, and `gcd` with `MARCH_SPEED` = 50 leaves a factor of
 * 25 to find — so a soldier sits on an edge only at a rate that is a multiple of **25 Hz**,
 * and 60, 90, 120 and 240 are not. The round-looking 175 and 265 this file first carried both
 * failed that: 185 and 95 *are* multiples of 5, and a soldier reached them dead on step 222
 * and step 114 of every 60 Hz match.
 *
 * "A threshold a state variable lands on exactly by construction, rather than by coincidence"
 * is the family of bug that cost Frozen Beaks 24 diverging matches and Snowball Throw its 64%
 * seat, and it is cheaper to step around it than to argue it is harmless. Here it would in
 * fact have been harmless — both seats compute `d` by the identical arithmetic in their own
 * frames, so they land on the same side of any edge in the same bit — but that argument holds
 * only for as long as nobody writes a second thing that reads a band, and the constants cost
 * nothing.
 *
 * `rules.test.ts` walks whole matches at all four rates and asserts no soldier is ever judged
 * sitting on an edge.
 */
export const BAND_NEAR = 174;
export const BAND_FAR = 264;

/**
 * Shot slots, a fixed set to each seat.
 *
 * Disjoint sets rather than a shared pool, so which seat is stepped first cannot change which
 * slot a shot lands in — `rules.test.ts` asserts the two seats can be stepped in either order
 * for a bit-identical match, and a shared pool would make that false for a reason that has
 * nothing to do with the game.
 *
 * A seat cannot fire faster than one shot per `RELOAD` = 0.45 s and a shot lives at most
 * `RANGE_MAX / SHOT_SPEED + BURST_SECONDS` = 0.81 s, so exactly two of a seat's own can
 * overlap and a third cannot: the earliest a third could leave the gun is 0.93 s after the
 * first, and the first is gone by 0.81 s. Measured over 4000 randomised hold patterns the
 * worst concurrent load is **2 of 4** — and under bot play it is 1, because no tier taps. Four
 * is that with room to spare, and a test asserts the set is never exhausted rather than
 * leaving the arithmetic in a comment.
 */
export const SHOT_SLOTS = 4;

export const SHOT_FREE = 0;
export const SHOT_FLYING = 1;
export const SHOT_BURST = 2;

/**
 * The win condition, declared through the SDK's helper rather than spelled out here.
 *
 * **Ground held** — the banded value of every soldier a seat smashed. The match is decided
 * when the army is spent and both fields are empty, which is the only ending there is.
 *
 * Fourteen soldiers at up to three apiece is a score with forty-three distinct values in it,
 * and that is the number the size of the army was chosen for. The failure to avoid is the one
 * Sudoku shipped and Blocks shipped again: a score two players of the same standard land on
 * the same value of. Measured over 2000 matches a tier, level-on-ground before the tie-break
 * happens in 6.9% of `easy` pairings, 7.8% of `normal` and 8.7% of `hard`; the tie-break below
 * splits 44%, 62% and 49% of those, leaving 3.9 / 3.0 / 4.4% genuine draws.
 *
 * The score does not saturate, which is the other half of that failure and the reason it is
 * ground held rather than soldiers smashed. At `hard` a seat smashes 12.5 of the 14 — a count
 * two good players would land level on constantly — but takes only 27.3 of the 42 points of
 * ground available, because the deep shot it is choosing is the one it is least likely to
 * place. Scoring the same matches on soldiers smashed instead would put two `hard` seats level
 * far more often, which is Sudoku's failure with the numbers changed.
 *
 * Nothing is decided while a soldier is still walking. That is the real-time form of Cup
 * Pong's completed round: a seat is owed every soldier still on its field, so the match
 * cannot end on the step the *other* seat's field happens to empty first.
 */
export const WIN_CONDITION: WinCondition = { kind: 'highest-when-time-expires' };

export type Phase = 'opening' | 'firing' | 'over';

export interface Soldier {
  /** On the field: released, not yet smashed, not yet through the gate. */
  alive: boolean;
  /** Which road, 0 to `LANES - 1`, in this seat's own frame. */
  lane: number;
  /** How far from this seat's own wall, in this seat's own frame. Only ever decreases. */
  d: number;
}

export interface Turret {
  /** Where the gun is on its rail, in this seat's own frame. */
  u: number;
  /** Traversing toward a larger `u`. */
  rising: boolean;
  /** A shot is ready. False through the reload. */
  loaded: boolean;
  /** The press has been taken: the gun is stopped and the charge is running. */
  aiming: boolean;
  /** How far out the charge has reached, in units from this seat's own wall. */
  range: number;
  /** The charge's speed. The `v` of the integrator; see {@link stepTurret}. */
  charge: number;
  /** Seconds of reload left. Zero whenever a shot is loaded. */
  reload: number;
  /** Whether the control was held on the previous step. Both edges come from this. */
  held: boolean;
  /** What the caller is asking for this step. Written only through {@link setHold}. */
  want: boolean;
}

export interface Shot {
  state: number;
  /** Where along the rail it was fired from, in the firing seat's own frame. */
  u: number;
  /** Where it comes down, in units from the firing seat's own wall. */
  range: number;
  flight: number;
  flightTime: number;
  burst: number;
  /** Whether the burst smashed a soldier. Presentation reads it; the score does not. */
  hit: boolean;
}

export interface Side {
  readonly soldiers: Soldier[];
  readonly turret: Turret;
  readonly shots: Shot[];
  /** Ground held: the banded value of every soldier this seat smashed. This is the score. */
  ground: number;
  /** How many it smashed at all, whatever they were worth. The tie-break. */
  smashed: number;
  /** How many walked through the gate. `smashed + through` is the army, once it is spent. */
  through: number;
}

export interface Siege {
  readonly p1: Side;
  readonly p2: Side;
  /**
   * Which road each soldier of the wave walks up, in the seat's own frame.
   *
   * One array for both seats. The wave is the same army seen from two sides, so seat one's
   * third soldier and seat two's third soldier are on the same numbered road in their own
   * frames — which puts them at half-turn images of each other on the board.
   */
  readonly wave: number[];
  /** How many of the wave have been released. Only ever rises, and only to `SOLDIERS`. */
  released: number;
  phase: Phase;
  /** Seconds left of the opening freeze. */
  hold: number;
  /** Seconds of live play. Shared, so both fields release on the identical step. */
  elapsed: number;
  winner: SeatId | 'draw' | null;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function sideOf(siege: Readonly<Siege>, seat: SeatId): Side {
  return seat === 'p1' ? siege.p1 : siege.p2;
}

/** Where a road sits on the rail, in the firing seat's own frame. */
export function laneU(lane: number): number {
  return LANE_ORIGIN + lane * LANE_SPACING;
}

/** Board `x` of a lateral rail position. The only place a seat's frame becomes the board. */
export function boardX(seat: SeatId, u: number): number {
  return seat === 'p1' ? RAIL_X0 + u : RAIL_X1 - u;
}

/** Board `y` of a forward distance. Seat one's field runs up the board, seat two's down. */
export function boardY(seat: SeatId, d: number): number {
  return seat === 'p1' ? WALL_P1_Y - d : WALL_P2_Y + d;
}

/** What a soldier smashed at this distance is worth. Three deep, two mid, one close in. */
export function valueOf(d: number): number {
  if (d >= BAND_FAR) return 3;
  if (d >= BAND_NEAR) return 2;
  return 1;
}

/** Ground held by a seat: the number the shell shows. */
export function scoreOf(siege: Readonly<Siege>, seat: SeatId): number {
  return sideOf(siege, seat).ground;
}

export function winnerOf(siege: Readonly<Siege>): SeatId | 'draw' | null {
  return siege.winner;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Where the charge has reached after `t` seconds of holding — the closed form.
 *
 * The simulation does not call this: it integrates. They agree to the last bit anyway, and
 * that is the point of writing the step the way {@link stepTurret} writes it. See
 * {@link holdForRange}, which is this read backwards, and `rules.test.ts`, which asserts
 * the two agree at 60, 90, 120 and 240 Hz.
 */
export function rangeAfter(t: number): number {
  return RANGE_MIN + CHARGE_SPEED * t + 0.5 * CHARGE_ACCEL * t * t;
}

/** How long to hold for a given range. The exact inverse of {@link rangeAfter}. */
export function holdForRange(range: number): number {
  const disc = CHARGE_SPEED * CHARGE_SPEED + 2 * CHARGE_ACCEL * (range - RANGE_MIN);
  if (disc <= 0) return 0;
  return (Math.sqrt(disc) - CHARGE_SPEED) / CHARGE_ACCEL;
}

function makeSoldier(): Soldier {
  return { alive: false, lane: 0, d: 0 };
}

function makeTurret(): Turret {
  return {
    u: 0,
    rising: true,
    loaded: true,
    aiming: false,
    range: RANGE_MIN,
    charge: CHARGE_SPEED,
    reload: 0,
    held: false,
    want: false,
  };
}

function makeShot(): Shot {
  return { state: SHOT_FREE, u: 0, range: 0, flight: 0, flightTime: 1, burst: 0, hit: false };
}

function makeSide(): Side {
  const soldiers: Soldier[] = [];
  for (let i = 0; i < SOLDIERS; i += 1) soldiers.push(makeSoldier());
  const shots: Shot[] = [];
  for (let i = 0; i < SHOT_SLOTS; i += 1) shots.push(makeShot());
  return { soldiers, turret: makeTurret(), shots, ground: 0, smashed: 0, through: 0 };
}

export function createSiege(): Siege {
  const wave: number[] = [];
  for (let i = 0; i < SOLDIERS; i += 1) wave.push(0);
  return {
    p1: makeSide(),
    p2: makeSide(),
    wave,
    released: 0,
    phase: 'opening',
    hold: OPENING,
    elapsed: 0,
    winner: null,
  };
}

/**
 * Put a gun back on its rail, at the end the opening seat decides.
 *
 * **Both guns take the same end of their own rails, and which end is what the opening seat
 * decides.** In each seat's own frame the two are then bit-identical, which through `boardX` —
 * an exact half-turn — puts them at opposite ends of the board moving in opposite directions,
 * and keeps them exact half-turn images of each other at every step of every match. So the
 * whole picture is its own half-turn, guns included, and `game.test.ts` asserts that mark by
 * mark rather than taking it on trust.
 *
 * The first version of this file gave the opener the low end and the *other seat* the high end
 * of its own rail, on the reasoning that the two arrangements are mirror images of one another.
 * They are — but mirroring a seat's position *within its own rail* and then mapping to the
 * board composes to a translation rather than to the half-turn, and it put the two guns on the
 * same column of the board, moving in the same direction, for the whole match. Nothing about
 * that was unfair; it simply was not the picture the file claimed to draw, and the render
 * mirror test in `game.test.ts` found it on the first run.
 *
 * Reading `context.openingSeat` at all is optional — a real-time game has no opener and the
 * contract says so. Ignoring it means the shell's alternation across the rounds of a best-of
 * reaches nothing, and a balance harness that plays each seed from both openers gets the
 * identical match twice and cannot tell a seat effect from a seed effect. Reading it here costs
 * one comparison, gives the two openers genuinely different matches, and provably favours
 * neither seat: both guns are moved together, so the position is symmetric either way.
 */
function resetTurret(turret: Turret, seat: SeatId, opener: SeatId): void {
  void seat;
  const low = opener === 'p1';
  turret.u = low ? 0 : RAIL;
  turret.rising = low;
  turret.loaded = true;
  turret.aiming = false;
  turret.range = RANGE_MIN;
  turret.charge = CHARGE_SPEED;
  turret.reload = 0;
  turret.held = false;
  turret.want = false;
}

function resetSide(side: Side, seat: SeatId, opener: SeatId): void {
  for (let i = 0; i < side.soldiers.length; i += 1) {
    const soldier = side.soldiers[i] as Soldier;
    soldier.alive = false;
    soldier.lane = 0;
    soldier.d = 0;
  }
  for (let i = 0; i < side.shots.length; i += 1) {
    (side.shots[i] as Shot).state = SHOT_FREE;
  }
  resetTurret(side.turret, seat, opener);
  side.ground = 0;
  side.smashed = 0;
  side.through = 0;
}

/**
 * Deal the wave: one road for each soldier, from the world's generator and nothing else.
 *
 * Exactly `SOLDIERS` draws, always, and they are the first thing the world's generator is
 * asked for — so which roads a pair is besieged on is a function of the match seed and of
 * nothing that happens afterwards. A plain float rather than `Rng.int`, whose rejection
 * sampling draws a variable number of values: nothing here depends on the count, but a
 * variable count is the shape of bug this repository keeps finding.
 */
function dealWave(siege: Siege, rng: Rng): void {
  for (let i = 0; i < SOLDIERS; i += 1) {
    siege.wave[i] = Math.floor(rng.float() * LANES);
  }
}

export function resetSiege(siege: Siege, rng: Rng, opener: SeatId = 'p1'): void {
  dealWave(siege, rng);
  resetSide(siege.p1, 'p1', opener);
  resetSide(siege.p2, 'p2', opener);
  siege.released = 0;
  siege.phase = 'opening';
  siege.hold = OPENING;
  siege.elapsed = 0;
  siege.winner = null;
}

/**
 * The one door input comes through: is this seat holding its control, or not?
 *
 * One boolean, because that is all the game asks anybody for. A key down and a thumb on the
 * glass are the same value here, which is what makes the parity test in `game.test.ts` an
 * equality rather than a tolerance: there is no gesture either instrument can make that the
 * other cannot, and no order finer than "holding" and "not holding".
 */
export function setHold(siege: Siege, seat: SeatId, held: boolean): void {
  sideOf(siege, seat).turret.want = held;
}

export interface StepResult {
  /** True on a step a shot left a gun. */
  fired: boolean;
  /** True on a step a shot came down. */
  landed: boolean;
  /** True on a step a soldier was smashed. */
  smashed: boolean;
  /** True on a step a soldier walked through a gate. */
  breached: boolean;
}

const result: StepResult = { fired: false, landed: false, smashed: false, breached: false };

/** One fixed step. Holds are written by the caller first, through {@link setHold}. */
export function step(siege: Siege, dt: number): StepResult {
  result.fired = false;
  result.landed = false;
  result.smashed = false;
  result.breached = false;
  if (siege.phase === 'over') return result;

  if (siege.phase === 'opening') {
    siege.hold -= dt;
    // The edge is still tracked through the freeze, so a player already holding when it lifts
    // does not get a free press on the first live step.
    siege.p1.turret.held = siege.p1.turret.want;
    siege.p2.turret.held = siege.p2.turret.want;
    if (siege.hold <= 0) siege.phase = 'firing';
    return result;
  }

  siege.elapsed += dt;
  release(siege);
  march(siege.p1, dt);
  march(siege.p2, dt);
  if (stepTurret(siege.p1, dt)) result.fired = true;
  if (stepTurret(siege.p2, dt)) result.fired = true;
  stepShots(siege.p1, dt);
  stepShots(siege.p2, dt);
  judge(siege);
  return result;
}

/**
 * Release whatever the cadence is due, to both sides at once.
 *
 * Driven off `siege.elapsed`, which is one number for the whole match rather than one a side,
 * so the two fields cannot drift apart by a step however the two seats are polled. A `while`
 * rather than an `if` so a large `dt` releases everything it should — the step-size invariance
 * test steps this at 240 Hz and would otherwise be measuring a different wave.
 */
function release(siege: Siege): void {
  while (siege.released < SOLDIERS && siege.elapsed >= siege.released * SPAWN_INTERVAL) {
    const lane = siege.wave[siege.released] as number;
    spawn(siege.p1.soldiers[siege.released] as Soldier, lane);
    spawn(siege.p2.soldiers[siege.released] as Soldier, lane);
    siege.released += 1;
  }
}

function spawn(soldier: Soldier, lane: number): void {
  soldier.alive = true;
  soldier.lane = lane;
  soldier.d = DEPTH;
}

/** Walk every live soldier one step closer, and take the ones that reach the gate. */
function march(side: Side, dt: number): void {
  const travel = MARCH_SPEED * dt;
  for (let i = 0; i < side.soldiers.length; i += 1) {
    const soldier = side.soldiers[i] as Soldier;
    if (!soldier.alive) continue;
    soldier.d -= travel;
    if (soldier.d > 0) continue;
    soldier.alive = false;
    side.through += 1;
    result.breached = true;
  }
}

/**
 * Traverse one gun, run its charge, and work out whether its shot goes this step.
 *
 * Order matters and is stated here once.
 *
 * **The edges are taken before anything moves**, so the road a press keeps is the one the gun
 * was on when the press happened rather than one step further along — which is also what lets
 * a bot commit to a *moment* and land on the road it planned.
 *
 * **The charge does not advance on the step the press is taken.** So a release `n` steps after
 * a press fires at exactly `rangeAfter(n · dt)`, with no off-by-one correction anywhere and
 * none needed in the bot. A test asserts that identity for every `n` from 0 to the top of the
 * charge.
 *
 * **The integral carries its `½a·dt²` term, and is written before the velocity update.** This
 * is issue #2465, which cannot be restated too plainly: written as `v += a·dt` and then
 * `range += v·dt`, a step lands a whole `a·dt²` rather than half of one, the shortfall
 * accumulates across the hold, and the closed form the bot plans with stops describing the
 * game the simulation is playing. Written this way, and only this way, the two agree exactly
 * for a constant acceleration — it is the exact integral rather than an improvement on an
 * approximation of one. Measured before the term was there, a full-length hold came out
 * **2.94 units short** of `rangeAfter(1.0)` at 60 Hz and 0.73 at 120 Hz, which is a bias that
 * moves with the frame rate: rule 8 broken as well as rule 6.
 *
 * **The gun traverses whenever the charge is not running**, the reload included. Without that
 * a player could park it on a road they liked by letting a shot go, and come back to a free
 * perfect press.
 */
function stepTurret(side: Side, dt: number): boolean {
  const turret = side.turret;
  const pressed = turret.want && !turret.held;
  const released = !turret.want && turret.held;
  turret.held = turret.want;

  let fired = false;
  if (turret.loaded) {
    if (pressed && !turret.aiming) {
      turret.aiming = true;
      turret.range = RANGE_MIN;
      turret.charge = CHARGE_SPEED;
      // Deliberately no charge on this step: see the note above.
      return false;
    }
    if (released && turret.aiming) {
      fire(side);
      fired = true;
    }
  } else {
    turret.reload -= dt;
    if (turret.reload <= 0) {
      turret.reload = 0;
      turret.loaded = true;
      turret.aiming = false;
      turret.range = RANGE_MIN;
      turret.charge = CHARGE_SPEED;
    }
  }

  if (!fired && turret.aiming) {
    // The exact integral of a constant acceleration, in the order that makes it exact.
    turret.range += turret.charge * dt + 0.5 * CHARGE_ACCEL * dt * dt;
    turret.charge += CHARGE_ACCEL * dt;
    if (turret.range >= RANGE_MAX) {
      // The charge has nowhere left to go, so the shot goes. Holding is not a way to wait:
      // a gun cannot be kept loaded past a second, which is one more reason nothing about
      // how this is played can lengthen a match.
      turret.range = RANGE_MAX;
      fire(side);
      fired = true;
    }
  } else if (!turret.aiming) {
    const travel = (turret.rising ? 1 : -1) * TRAVERSE_RATE * dt;
    turret.u = clamp(turret.u + travel, 0, RAIL);
    if (turret.u >= RAIL) turret.rising = false;
    else if (turret.u <= 0) turret.rising = true;
  }
  return fired;
}

function fire(side: Side): void {
  const turret = side.turret;
  const range = turret.range;
  turret.loaded = false;
  turret.aiming = false;
  turret.reload = RELOAD;

  let slot = -1;
  for (let i = 0; i < side.shots.length; i += 1) {
    if ((side.shots[i] as Shot).state === SHOT_FREE) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return;

  const shot = side.shots[slot] as Shot;
  shot.state = SHOT_FLYING;
  shot.u = turret.u;
  shot.range = range;
  shot.flight = 0;
  shot.flightTime = range / SHOT_SPEED;
  shot.burst = 0;
  shot.hit = false;
}

/**
 * Fly every shot, and judge the ones that come down.
 *
 * **A landing is resolved at the exact moment it happens, not at the step boundary it is
 * noticed on.** A shot lands part-way through a step; by the time the step ends the soldiers
 * have walked `MARCH_SPEED · overshoot` too far, so that much is added back before the blast
 * is measured. It costs one multiply and it is what makes the hit test independent of the
 * step size — without it a soldier's judged position moves by up to `MARCH_SPEED · dt`, which
 * is 0.83 units at 60 Hz and 0.21 at 240, and the whole step-size invariance claim would have
 * to be qualified. With it there is nothing to qualify.
 */
function stepShots(side: Side, dt: number): void {
  for (let i = 0; i < side.shots.length; i += 1) {
    const shot = side.shots[i] as Shot;
    if (shot.state === SHOT_FREE) continue;
    if (shot.state === SHOT_BURST) {
      shot.burst -= dt;
      if (shot.burst <= 0) shot.state = SHOT_FREE;
      continue;
    }
    shot.flight += dt;
    if (shot.flight < shot.flightTime) continue;

    shot.state = SHOT_BURST;
    shot.burst = BURST_SECONDS;
    result.landed = true;
    const overshoot = shot.flight - shot.flightTime;
    const drift = MARCH_SPEED * overshoot;
    for (let j = 0; j < side.soldiers.length; j += 1) {
      const soldier = side.soldiers[j] as Soldier;
      if (!soldier.alive) continue;
      const exact = soldier.d + drift;
      const du = shot.u - laneU(soldier.lane);
      const dd = shot.range - exact;
      if (du * du + dd * dd > BLAST * BLAST) continue;
      soldier.alive = false;
      side.ground += valueOf(exact);
      side.smashed += 1;
      shot.hit = true;
      result.smashed = true;
      // No shot can reach two soldiers — the wave is a lattice a hundred units apart in both
      // directions and the blast is forty. `rules.test.ts` asserts the separation over a whole
      // match rather than trusting the arithmetic, and breaking here keeps the score exact
      // even if that ever stopped being true.
      break;
    }
  }
}

const tally: { p1: number; p2: number } = { p1: 0, p2: 0 };
const judgeOptions: { timeExpired: boolean } = { timeExpired: false };

/**
 * Decide the match, or leave it running.
 *
 * The army is spent and both fields are empty: nobody can hold another foot of ground, so the
 * siege is decided on the ground already held. It is the only ending there is, and it is where
 * the termination argument lands whether the two seats smashed everything or nothing.
 *
 * **Nothing is decided while a soldier is still walking**, on either side. That is the
 * real-time form of Cup Pong's completed round — a seat is owed every soldier still on its own
 * field — and without it the match would end on the step the *other* seat's field emptied,
 * cancelling shots a seat had already fired.
 */
function judge(siege: Siege): void {
  if (siege.released < SOLDIERS) return;
  if (anyAlive(siege.p1) || anyAlive(siege.p2)) return;
  tally.p1 = siege.p1.ground;
  tally.p2 = siege.p2.ground;
  judgeOptions.timeExpired = true;
  const outcome = resolve(WIN_CONDITION, tally, judgeOptions);
  if (outcome === null) return;
  siege.phase = 'over';
  siege.winner = outcome === 'draw' ? splitLevel(siege) : outcome;
}

function anyAlive(side: Readonly<Side>): boolean {
  for (let i = 0; i < side.soldiers.length; i += 1) {
    if ((side.soldiers[i] as Soldier).alive) return true;
  }
  return false;
}

/**
 * Level on ground held: the seat that let fewer through the gate takes it.
 *
 * A different quantity rather than a finer reading of the same one — a seat can reach fourteen
 * points by smashing five deep or by smashing fourteen close in, and the second of those kept
 * more soldiers off its wall. It is also the one thing the catalogue row asks for that the
 * band score does not already count.
 *
 * It is **not** a function of the board, which matters more here than it looks. On a position
 * that is its own mirror a covariant tie-break returns a mirror answer and therefore decides
 * nothing; Maze Paint and Sudoku both hit that wall. Soldiers-through is counted in each
 * seat's own frame from each seat's own field, so the two seats can differ on it even when
 * every other number in the match is identical.
 */
function splitLevel(siege: Readonly<Siege>): SeatId | 'draw' {
  if (siege.p1.through !== siege.p2.through) {
    return siege.p1.through < siege.p2.through ? 'p1' : 'p2';
  }
  return 'draw';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far off the moment it meant to act it actually acts, in seconds. */
  readonly timing: number;
  /** How often one of the two moments is an outright fumble. */
  readonly blunder: number;
}

/**
 * Three tiers, expressed only as how accurately a tier hits the moment it meant to.
 *
 * That is the whole of the skill this game asks for: there is nothing to steer, nothing to
 * dodge and nothing to point at, only a press and a release. The numbers are seconds of human
 * error rather than anything abstract, and every one of them is several frames wide, so rule 6
 * holds by construction — no tier can stop a gun or let a charge go more finely than a person
 * can, and a test asserts a profile has no third field, so nothing in a tier can be a speed, a
 * reach, or a fact about the field a player cannot see.
 *
 * The measured ladder, and what each knob is worth on its own, is in SPEC.md.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.2, blunder: 0.16 },
  normal: { timing: 0.15, blunder: 0.08 },
  hard: { timing: 0.115, blunder: 0.02 },
});

/** How much larger a fumbled moment's error is than the tier's ordinary one. */
export const BLUNDER_SCALE = 6;

/**
 * Values a bot draws per shot. Always exactly this many, and only when a shot is committed.
 *
 * A plan that finds nothing to shoot at draws nothing at all, so a seat's stream position is a
 * function of its own shots and of nothing else. Each seat also has a generator of its own, so
 * the order the two are polled in is not observable either; both are asserted by tests.
 */
export const BOT_DRAWS_PER_SHOT = 6;

export type BotStage = 'plan' | 'lane' | 'charge' | 'spent';

export interface BotState {
  stage: BotStage;
  /** Which soldier of its own field this shot is for. `-1` when there is nothing to shoot. */
  target: number;
  /** Seconds of error committed to for each moment, drawn separately: two decisions. */
  laneOffset: number;
  rangeOffset: number;
  laneTimer: number;
  rangeTimer: number;
  hold: boolean;
}

export function createBotState(): BotState {
  return {
    stage: 'plan',
    target: -1,
    laneOffset: 0,
    rangeOffset: 0,
    laneTimer: 0,
    rangeTimer: 0,
    hold: false,
  };
}

export function resetBotState(state: BotState): void {
  state.stage = 'plan';
  state.target = -1;
  state.laneOffset = 0;
  state.rangeOffset = 0;
  state.laneTimer = 0;
  state.rangeTimer = 0;
  state.hold = false;
}

/**
 * Seconds until the gun next traverses onto `lane`, given where it is and which way it is
 * going.
 *
 * Closed form, and the reason the bot cannot deadlock: it commits to a *moment* rather than
 * watching for a position. Watching for a position is the obvious way to write this and it
 * hangs — the error is added in whichever direction the gun is currently travelling, so an
 * error larger than the rail is out of reach both ways, because the gun turns round at the end
 * and the wanted value turns round with it. A countdown cannot fail to expire. A test walks
 * every position and direction on the rail against every road and asserts the answer is finite
 * and no longer than one round trip.
 */
export function timeToLane(turret: Readonly<Turret>, lane: number): number {
  const want = clamp(laneU(lane), 0, RAIL);
  if (turret.rising) {
    if (want >= turret.u) return (want - turret.u) / TRAVERSE_RATE;
    return (RAIL - turret.u + (RAIL - want)) / TRAVERSE_RATE;
  }
  if (want <= turret.u) return (turret.u - want) / TRAVERSE_RATE;
  return (turret.u + want) / TRAVERSE_RATE;
}

/**
 * How long to hold to smash a soldier that is `d` away at the moment of the press.
 *
 * **This is the closed form of a quantity the simulation integrates, and the two agree
 * exactly.** That sentence is the whole of issue #2465. Three things move at once — the
 * charge accelerates, the soldier walks in, and the shot takes time to fly — and the answer
 * falls out as one quadratic rather than a search:
 *
 * Let `k = SHOT_SPEED / (SHOT_SPEED + MARCH_SPEED)`. A shot fired at range `r` is in the air
 * for `r / SHOT_SPEED`, in which the soldier walks `MARCH_SPEED · r / SHOT_SPEED`, so the
 * distance the soldier is at when the shot arrives is `r` exactly when
 *
 *     r = k · (distance at the moment of firing)
 *
 * The soldier walks for the hold as well, and for the one extra step between the bot's
 * decision and the fire — the release edge is taken after that step's march — so its distance
 * at the fire is `d − MARCH_SPEED · (t + dt)`. Substituting `rangeAfter(t)` for `r`:
 *
 *     ½·a·t² + (v₀ + k·MARCH_SPEED)·t + (RANGE_MIN − k·(d − MARCH_SPEED·dt)) = 0
 *
 * and the smaller non-negative root is the hold. `NaN` when there is no real root, which is a
 * soldier already inside the minimum range: `k · d < RANGE_MIN` means even a tap overshoots
 * it, and there is nothing to be done about a soldier that close. That is not an edge case
 * being swept up, it is the rule the catalogue row is named after.
 *
 * The `dt` argument is the fixed step, which the bot is entitled to know because the
 * simulation runs on it and a person's press lands on it too. Nothing else in here is a fact a
 * player cannot read off the field.
 */
export function holdToSmash(d: number, dt: number): number {
  const k = SHOT_SPEED / (SHOT_SPEED + MARCH_SPEED);
  const reach = k * (d - MARCH_SPEED * dt);
  const b = CHARGE_SPEED + k * MARCH_SPEED;
  const c = RANGE_MIN - reach;
  const disc = b * b - 2 * CHARGE_ACCEL * c;
  if (disc < 0) return Number.NaN;
  return (Math.sqrt(disc) - b) / CHARGE_ACCEL;
}

/**
 * Whether one of this seat's shots already in the air is going to smash this soldier.
 *
 * A person watching their own shot arc toward a soldier does not fire a second one at it, and
 * this is that and nothing more — it reads only this seat's own shots and this seat's own
 * field, both of which are drawn on the screen in front of them. Without it the bot spends
 * about one shot in eight on a soldier its previous shot is already about to take, because the
 * reload is shorter than a long flight.
 */
export function doomed(side: Readonly<Side>, soldier: Readonly<Soldier>): boolean {
  const laneAt = laneU(soldier.lane);
  for (let i = 0; i < side.shots.length; i += 1) {
    const shot = side.shots[i] as Shot;
    if (shot.state !== SHOT_FLYING) continue;
    const left = shot.flightTime - shot.flight;
    const exact = soldier.d - MARCH_SPEED * left;
    const du = shot.u - laneAt;
    const dd = shot.range - exact;
    if (du * du + dd * dd <= BLAST * BLAST) return true;
  }
  return false;
}

/**
 * Choose the shot, once, when a fresh one is loaded. Returns false when there is nothing
 * worth pressing for.
 *
 * **It takes the soldier that is farthest out among those it can still reach, and the first
 * version of this file took the nearest.** Nearest-first is the rule the catalogue row appears
 * to ask for — *don't let them get close* — and it is the rule Explosive Festival measured its
 * way into, so it was written first and then played head to head against deepest-first at the
 * same tier, 400 seeds in each seat order and each opener, everything else identical:
 *
 * | | deepest-first's share of decided |
 * |---|---|
 * | easy | 54.3% |
 * | normal | 58.5% |
 * | hard | 57.5% |
 *
 * Deepest-first wins at every tier, so it ships. The reason it wins is worth stating because
 * it is the whole economics of the game: **a deep shot is worth three points and a missed deep
 * shot is not a wasted one.** The soldier keeps walking, the gun comes round again, and it can
 * be taken later for two or for one. A near shot is worth one point and missing it costs the
 * soldier entirely — it walks through the gate. Deepest-first is therefore taking the three
 * whenever it can and keeping the ones and twos as a second chance; nearest-first takes the
 * one and throws the three away, which is the same trade Explosive Festival found and the
 * opposite answer, because its short shots landed on its *own* lanterns and these do not.
 *
 * The measured shape of a match says the same thing from the other side: deepest-first smashes
 * fewer soldiers (12.5 against 13.7 at `hard`) and holds more ground (27.3 against 25.9) — and
 * at `easy` it lets seven soldiers a match through the gate where nearest-first lets four
 * through, which is the visible price it is paying for the points.
 *
 * A target is skipped when a shot of this seat's own is already going to take it, and when it
 * is inside the minimum range at the moment the gun would be on its road: `holdToSmash`
 * returns `NaN` for the second and a hold past `CHARGE_SECONDS` is not a shot that exists.
 *
 * **Everything here is in the firing seat's own frame** — a road index and a distance — so the
 * two seats rank an identical wave identically. Ranking on a board coordinate would sort the
 * two seats' mirrored fields into different orders, which is the defect Explosive Festival
 * found in its own target rule and Maze Paint found in a tie-break.
 */
export function planShot(
  siege: Readonly<Siege>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  dt: number,
): boolean {
  const side = sideOf(siege, seat);
  const turret = side.turret;

  // Farthest reachable soldier wins. The comparison is strict, so on the vanishingly rare tie
  // the earlier index takes it — and because both seats hold the identical array of soldiers
  // in their own frames, both seats break that tie the same way, which a board-coordinate rule
  // could not do (Maze Paint, and Snowball Throw before it).
  let target = -1;
  let bestD = -Infinity;
  for (let i = 0; i < side.soldiers.length; i += 1) {
    const soldier = side.soldiers[i] as Soldier;
    if (!soldier.alive) continue;
    if (doomed(side, soldier)) continue;
    // Where it will be when the gun is on its road, which is the moment the press happens.
    const wait = timeToLane(turret, soldier.lane);
    const at = soldier.d - MARCH_SPEED * wait;
    if (at <= 0) continue;
    const hold = holdToSmash(at, dt);
    if (!(hold >= 0) || hold > CHARGE_SECONDS) continue;
    if (at <= bestD) continue;
    bestD = at;
    target = i;
  }
  if (target < 0) return false;

  // Six values, always, and only now that a shot is committed. Two draws a moment, summed, so
  // the error is triangular rather than flat: mostly close, occasionally nowhere near, which
  // is both the better picture of a person and the shape that leaves a ladder somewhere to
  // stand. A flat error either fits inside the blast or it does not, with very little in
  // between, and the three tiers end up crammed into a few points of hit rate.
  const profile = BOT_PROFILES[difficulty];
  const laneRollA = rng.float();
  const laneRollB = rng.float();
  const rangeRollA = rng.float();
  const rangeRollB = rng.float();
  const blunderRoll = rng.float();
  const blunderSize = rng.float();

  state.target = target;
  state.laneOffset = (laneRollA + laneRollB - 1) * profile.timing;
  state.rangeOffset = (rangeRollA + rangeRollB - 1) * profile.timing;
  if (blunderRoll < profile.blunder) {
    // One roll decides both which moment is fumbled and by how much — the low bit picks the
    // moment, the rest the size — so a fumble costs the same one draw as no fumble at all.
    const slip = (((blunderSize * 2) % 1) * 2 - 1) * profile.timing * BLUNDER_SCALE;
    if (blunderSize < 0.5) state.laneOffset += slip;
    else state.rangeOffset += slip;
  }
  const soldier = side.soldiers[target] as Soldier;
  state.laneTimer = timeToLane(turret, soldier.lane) + state.laneOffset;
  state.stage = 'lane';
  return true;
}

/**
 * Run a bot for one step and return whether it is holding its control.
 *
 * One entry point rather than a plan call and a press call, because the two have to agree
 * about the stage and a caller that got the order wrong would look like a tuning problem
 * rather than a bug. The output is the same single boolean a person's key or thumb produces
 * and it goes through {@link setHold} exactly as theirs does — so no bot stops a gun sooner,
 * charges faster or fires more often than a person can. Firing is not a separate output: a bot
 * fires by letting go, which is the only way anybody fires.
 *
 * **The hold is worked out at the press, not at the plan.** A person presses, then looks at
 * the field and the gauge and decides when to let go, and the second decision is made with a
 * second of newer information than the first. Committing both at plan time would also make an
 * error on the press moment silently poison the release, which is a coupling nobody would
 * design on purpose. The two timing errors are still drawn together, at the plan, so a shot
 * costs exactly {@link BOT_DRAWS_PER_SHOT} values however it turns out.
 */
export function botHold(
  siege: Readonly<Siege>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  dt: number,
): boolean {
  const side = sideOf(siege, seat);
  const turret = side.turret;
  if (siege.phase !== 'firing' || !turret.loaded) {
    // Nothing in the gun: let go, so the next shot starts from a fresh press rather than from
    // a thumb that never left the glass. A reload is long enough for either instrument to lift
    // and come back, which is what keeps the two the same here.
    if (!turret.loaded) state.stage = 'plan';
    state.hold = false;
    return false;
  }

  if (state.stage === 'plan' && !planShot(siege, seat, difficulty, state, rng, dt)) {
    // Nothing reachable on the field. Do not press: a shot spent on empty ground is a shot not
    // available for the soldier released two seconds from now, and the reload is the scarce
    // thing in this game.
    state.hold = false;
    return false;
  }

  if (state.stage === 'lane') {
    if (state.laneTimer > dt / 2) {
      state.laneTimer -= dt;
      state.hold = false;
      return false;
    }
    const soldier: Soldier | undefined = side.soldiers[state.target];
    // The target may have walked through the gate, been taken by a shot fired before this one
    // was planned, or walked inside the minimum range while the gun was traversing to it —
    // `holdToSmash` answers `NaN` for the third. There is a press committed either way, so the
    // shot goes at the bottom of the charge, which is a person's answer too and a poor one.
    //
    // Written as a test for `>= 0` rather than through `clamp`, because `clamp` passes `NaN`
    // straight through: both of its comparisons are false. The old spelling happened to behave
    // the same way — a `NaN` timer never exceeds `dt / 2`, so the release came on the next step
    // — but it got there by arithmetic nobody should have to reconstruct, and it silently threw
    // away the tier's timing error on exactly the shots where the bot is already in trouble.
    const wanted = soldier !== undefined && soldier.alive ? holdToSmash(soldier.d, dt) : Number.NaN;
    const hold = wanted >= 0 ? (wanted > CHARGE_SECONDS ? CHARGE_SECONDS : wanted) : 0;
    state.rangeTimer = hold + state.rangeOffset;
    // Cleared on the press. `laneTimer` counts a traverse and `rangeTimer` counts a charge;
    // leaving the first standing in a field the release reads is how a charge ends up let go
    // at a road's number.
    state.laneOffset = 0;
    state.laneTimer = 0;
    state.stage = 'charge';
    state.hold = true;
    return true;
  }

  if (state.stage === 'charge') {
    if (state.rangeTimer > dt / 2) {
      state.rangeTimer -= dt;
      state.hold = true;
      return true;
    }
    state.rangeOffset = 0;
    state.rangeTimer = 0;
    state.target = -1;
    state.stage = 'spent';
    state.hold = false;
    return false;
  }

  // Spent: the shot is on its way or about to be. Nothing is asked of the gun until the next
  // one is loaded, which is what `!turret.loaded` above turns back into `plan`.
  state.hold = false;
  return false;
}
