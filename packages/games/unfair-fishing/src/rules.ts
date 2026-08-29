import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Unfair Fishing, as pure rules.
 *
 * One pond, two boats moored at opposite ends of it, and a race to twenty-five fish. A rod
 * is worked with exactly two presses: one throws the bait, and one rewinds the reel. The
 * second press is also the strike — a fish is on the hook if it is beside the bait at the
 * instant the reel starts, and not otherwise.
 *
 * No rendering, no timing, no DOM — the bot, the balance harness and the tests all reuse
 * this module.
 *
 * ## The five decisions this file exists to record
 *
 * **Every position is an offset from the middle of the board, and that is a correctness
 * decision rather than a style one.** The half-turn that swaps the two seats is then an
 * exact negation of every stored number, so a mirrored board steps to the exact mirror of
 * the stepped board — bit for bit, not to nine decimals. Written in board coordinates
 * instead, `1000 - (940 - out)` and `60 + out` differ in the last bits, both seats
 * accumulate toward the same thresholds from opposite ends, and the two disagree about a
 * catch that lands on one. That is the family of defect Snowball Throw and Frozen Beaks
 * each shipped and each had to bisect for; see `rules.test.ts`, "the half-turn".
 *
 * **A cast and a reel are two moments, never a drag.** `docs/input-parity.md` is
 * unambiguous that a pointer position or a pointer velocity is a quantity a thumb can name
 * and a key cannot, and Shuriken is filed as a cross-device fairness bug (#2478) for
 * binding to one. The whole input surface of this simulation is {@link Command}, which
 * carries a single boolean edge. A press means the same thing on a phone, a trackpad and a
 * keyboard, and this game asks for nothing else.
 *
 * **The bait's flight is the analytic integral of its own decay, and the reel is the
 * analytic integral of its own drag.** Both are #2465's shape, and both telescope: a cast
 * covers exactly `(CAST_SPEED - STOP_SPEED) / CAST_RATE` and a reel covers exactly
 * `REEL_SPEED · t - (v_after - v_before) / REEL_RATE`, however finely the step is sliced.
 * `rules.test.ts` flies and reels the same rod at 60, 90, 120 and 240 Hz and requires the
 * same position to nine decimals, and the bot plans with {@link flightTime}, which is the
 * exact inverse of what {@link step} produces rather than an approximation of it.
 *
 * **The pond is one body of water and both rods reach across it.** Neither seat owns a
 * lane of fish; the deepest row a rod can reach is the row directly under the *other*
 * boat, so a fish either player was waiting on can be taken by the other. That is the only
 * "unfairness" this game ships, it is held in equal measure by both seats, and SPEC.md
 * records why the name's other reading was refused.
 *
 * **The pond is laid out as nine mirrored pairs.** Every fish has a twin at the exact
 * negation of its position swimming the exact opposite way, so the water is invariant
 * under the half-turn from the first frame. Seat one's share at equal skill is then a
 * property of the board rather than a number to be sampled and hoped over.
 */

/* ------------------------------------------------------------------------------------ */
/* The board                                                                             */
/* ------------------------------------------------------------------------------------ */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** The point the half-turn turns about. Every stored coordinate is an offset from it. */
export const CENTRE_X = BOARD_WIDTH / 2;
export const CENTRE_Y = BOARD_HEIGHT / 2;

/** How far a fish may swim either side of the middle before it leaves at the far bank. */
export const POND_HALF = 270;

/** How far a boat sits from the middle of the board, along its own seat's axis. */
export const BOAT_OUT = 440;

/**
 * How far a rod's lane sits from the middle of the board, across.
 *
 * Multiplied by the seat's axis sign, so seat one fishes the column at `-30` and seat two
 * the column at `+30` — an exact pair under the half-turn, and sixty units apart against a
 * widest catch of thirty-six. That gap is chosen, not inherited: it leaves a strip twelve
 * units wide down the middle of the pond where **a fish is inside both hooks at once**, so
 * the contest for one fish is a position that happens rather than a branch nobody can
 * reach. Wider and {@link settleClaims} would be dead code; narrower and the two baits
 * would sit on top of each other on the screen.
 */
export const LANE_OFFSET = -30;

/**
 * The six lanes fish swim along, as offsets from the middle, and which way each one runs.
 *
 * Symmetric about the middle in pairs — `-300/+300`, `-180/+180`, `-60/+60` — with the
 * direction flipped between the members of a pair, which is exactly what the half-turn
 * does to a row. A player reads that as "the current alternates"; the reason it has to is
 * that a row and its image are the same row seen from the other chair.
 */
export const ROW_OFFSETS: readonly number[] = Object.freeze([-300, -180, -60, 60, 180, 300]);
export const ROW_DIRS: readonly number[] = Object.freeze([1, -1, 1, -1, 1, -1]);

/**
 * The furthest a bait can be thrown: from a boat to the far row, which is the row directly
 * under the opponent's own boat.
 *
 * `BOAT_OUT - (-300) = 740`, so a rod at full stretch is fishing the water its opponent
 * has the shortest cast to. That reach is the whole of the interaction in this game and
 * both seats have exactly it.
 */
export const MAX_REACH = BOAT_OUT + 300;

/* ------------------------------------------------------------------------------------ */
/* The cast                                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * The fraction of a bait's speed that survives one second of flight, and the exponent
 * behind it.
 *
 * A per-second power rather than a per-step multiplier, so 60 Hz and 240 Hz agree
 * (CLAUDE.md rule 8). A bait thrown at `v` travels exactly `(v - STOP_SPEED) / CAST_RATE`
 * — the analytic integral of the decay, not an approximation of it.
 */
export const CAST_DRAG = 0.33;
export const CAST_RATE = -Math.log(CAST_DRAG);

/** Below this the bait has landed. It coasts the exact distance left and stops there. */
export const CAST_STOP_SPEED = 260;

/**
 * How hard a bait is thrown. One value: every cast in this game is the same cast.
 *
 * Derived from the reach rather than chosen, so that a bait left alone comes to rest
 * exactly on the far row and the resting position is a fishable spot rather than a number
 * that happens to be near one. There is deliberately no power meter: a meter's optimum
 * sits at the top of its own range, so every player releases at a boundary and a
 * thirty-millisecond latency difference is a distance. Here the *whole* range of reaches
 * is served by one throw, and which of them a player takes is settled by the second press.
 */
export const CAST_SPEED = CAST_STOP_SPEED + MAX_REACH * CAST_RATE;

/* ------------------------------------------------------------------------------------ */
/* The reel                                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * The winch, as a terminal speed and the rate it is approached at.
 *
 * A drag integrator rather than a constant wind: `v(t) = REEL_SPEED · (1 - REEL_DRAG^t)`
 * from a standing start, and the distance covered in a step is
 * `REEL_SPEED · dt - (v_after - v_before) / REEL_RATE`, whose terms telescope exactly the
 * way the cast's do. A reel therefore takes the same time from the same distance at every
 * step rate, which is what makes a long cast a real cost rather than a rounding error.
 */
export const REEL_DRAG = 0.02;
export const REEL_RATE = -Math.log(REEL_DRAG);
export const REEL_SPEED = 760;

/* ------------------------------------------------------------------------------------ */
/* The fish                                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * Two kinds, told apart by shape and not by colour (CLAUDE.md rule 7).
 *
 * A `drifter` is slow and broad and is drawn as a body with a forked tail; a `dart` is
 * quick and slim and is drawn as a chevron. The difference is the size of the moment a
 * player has to hit, and it is legible without colour at a glance, which `greyscale.test.ts`
 * checks for the seat-owned marks and a person checks for these.
 */
export type FishKind = 'drifter' | 'dart';

export const DRIFTER_RADIUS = 14;
export const DART_RADIUS = 9;

/** The speed bands. Wider fish are slower, so the two kinds trade size against pace. */
export const DRIFTER_SPEED_LOW = 78;
export const DRIFTER_SPEED_HIGH = 104;
export const DART_SPEED_LOW = 128;
export const DART_SPEED_HIGH = 168;

/** How near the bait a fish must be, at the instant of the strike, to end up on the hook. */
export const HOOK_RADIUS = 22;

/** Fish in each of the six rows. Three, so nine mirrored pairs fill the pond. */
export const FISH_PER_ROW = 3;

/** Seconds between a fish being landed and a replacement entering at the bank. */
export const RESPAWN_SECONDS = 1.1;

/** A fish that is on somebody's hook. Not counting down, not in the water, not catchable. */
export const HELD = -1;

/* ------------------------------------------------------------------------------------ */
/* The match                                                                             */
/* ------------------------------------------------------------------------------------ */

/** The race, straight off the catalogue row. */
export const TARGET_FISH = 25;

/**
 * The clock, in seconds, and the only reason this game is guaranteed to end.
 *
 * `roundSeconds` ends nothing — it is text on a catalogue card — so the clock lives here
 * and a test asserts the manifest advertises the same number. Every measured pairing
 * reaches twenty-five well inside it; the whistle is the backstop for the ones that do
 * not, and it is what `termination.test.ts` ultimately rests on.
 */
export const MATCH_SECONDS = 180;

export const WIN_CONDITION: WinCondition = Object.freeze({
  kind: 'first-to',
  target: TARGET_FISH,
});

export const SEATS: readonly SeatId[] = Object.freeze(['p1', 'p2']);

/* ------------------------------------------------------------------------------------ */
/* State                                                                                 */
/* ------------------------------------------------------------------------------------ */

export interface Fish {
  active: boolean;
  /** Across the board, as an offset from the middle. The half-turn negates it. */
  cx: number;
  /** Along the board, as an offset from the middle. Constant: a fish never changes row. */
  cy: number;
  /** Which way along `cx` it swims: +1 or -1. */
  dir: number;
  speed: number;
  kind: FishKind;
  /** Seconds until it re-enters, or {@link HELD} while it is on a hook. */
  delay: number;
}

export type RodPhase = 'ready' | 'flying' | 'resting' | 'reeling';

export interface Rod {
  phase: RodPhase;
  /**
   * How far the bait is from its own boat.
   *
   * Seat-relative and never signed by the seat, so both rods accumulate the identical
   * number from the identical presses and the two seats can never straddle a threshold.
   */
  out: number;
  /** `out` at the start of the step, for render interpolation. */
  prevOut: number;
  /** Speed of the bait: outward while flying, inward while reeling, else zero. */
  speed: number;
  /** The fish on the hook, as an index into {@link Game.fish}, or -1 for an empty line. */
  loaded: number;
  /** Fish landed. The score. */
  caught: number;
  /** Casts thrown, and strikes that closed on nothing. The whistle's tie-break. */
  casts: number;
  empties: number;
  /** Seconds of afterglow on the last landing. Drawn, never read by the simulation. */
  flash: number;
}

export interface Game {
  readonly p1: Rod;
  readonly p2: Rod;
  readonly fish: Fish[];
  /** Seconds left. Counts down; the whistle is the structural end. */
  clock: number;
  winner: SeatId | 'draw' | null;
}

/**
 * What one seat is asking for this step. The whole input surface of the simulation.
 *
 * One boolean edge, which is the same event on every instrument there is. What the press
 * *means* is read from the rod: a rod at rest throws, a rod with a bait in the water
 * strikes and rewinds, and a rod already rewinding ignores it.
 */
export interface Command {
  press: boolean;
}

export function createCommand(): Command {
  return { press: false };
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function rodOf(game: Readonly<Game>, seat: SeatId): Rod {
  return seat === 'p1' ? game.p1 : game.p2;
}

/**
 * Which way a seat's own axis points along the board.
 *
 * Seat one sits at the bottom of the device, seat two at the top and reads it upside down.
 * Every seat-relative quantity in this file is multiplied by this and by nothing else,
 * which is what makes the whole file covariant under the half-turn.
 */
export function seatAxisSign(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

/** The column a seat's bait travels down, as an offset from the middle of the board. */
export function laneOf(seat: SeatId): number {
  return seatAxisSign(seat) * LANE_OFFSET;
}

/** Where a rod's bait is along the board, as an offset from the middle. */
export function baitCyOf(rod: Readonly<Rod>, seat: SeatId): number {
  return seatAxisSign(seat) * (BOAT_OUT - rod.out);
}

/** How far a seat would have to throw to reach the row a fish swims in. */
export function rowOutOf(seat: SeatId, fish: Readonly<Fish>): number {
  return BOAT_OUT - seatAxisSign(seat) * fish.cy;
}

export function radiusOf(kind: FishKind): number {
  return kind === 'drifter' ? DRIFTER_RADIUS : DART_RADIUS;
}

/** How near a bait a fish of this kind has to be for the strike to find it. */
export function catchRadiusOf(kind: FishKind): number {
  return HOOK_RADIUS + radiusOf(kind);
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/* ------------------------------------------------------------------------------------ */
/* The flight law, shared by the simulation and the bot                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * How fast a bait is still travelling once it has covered `out`.
 *
 * Linear in distance, which is what an exponential decay in *time* looks like when it is
 * read against distance: `v = v0 - out · CAST_RATE`. Exact, so the bot plans against the
 * board the game actually steps rather than an approximation of it.
 */
export function flightSpeedAt(out: number): number {
  const speed = CAST_SPEED - out * CAST_RATE;
  return speed < CAST_STOP_SPEED ? CAST_STOP_SPEED : speed;
}

/**
 * How long a bait takes to cover `out`, from the throw.
 *
 * The inverse of {@link flightSpeedAt} through the same decay, and the exact time
 * {@link step} produces at any step rate. This is the whole of what the bot knows about
 * its own tackle, and a player watching a bait sail out is reading the same curve.
 */
export function flightTime(out: number): number {
  const speed = CAST_SPEED - out * CAST_RATE;
  if (speed <= CAST_STOP_SPEED) return Math.log(CAST_SPEED / CAST_STOP_SPEED) / CAST_RATE;
  return Math.log(CAST_SPEED / speed) / CAST_RATE;
}

/** Seconds a bait spends in the air on a cast nobody strikes. */
export const FLIGHT_SECONDS = flightTime(MAX_REACH);

/**
 * How far a bait has travelled `t` seconds after the throw. The inverse of
 * {@link flightTime}, and flat at {@link MAX_REACH} once the bait has landed.
 */
export function flightOutAt(t: number): number {
  if (t >= FLIGHT_SECONDS) return MAX_REACH;
  return (CAST_SPEED - CAST_SPEED * Math.pow(CAST_DRAG, t)) / CAST_RATE;
}

/**
 * Where a fish will be across the pond in `t` seconds, allowing for one turn at the bank.
 *
 * The bot's own arithmetic rather than the simulation's — {@link stepFish} re-enters a
 * fish exactly at the bank rather than a lap behind, so this is a *prediction* and is
 * allowed to differ from the event by the fraction of a step the crossing fell in. What it
 * is not allowed to be is one-sided: negating the position, the direction and the bank
 * negates the answer exactly, which is what keeps a bot playing the same game from both
 * chairs.
 */
export function fishCxAt(fish: Readonly<Fish>, t: number): number {
  const span = POND_HALF + POND_HALF;
  let cx = fish.cx + fish.dir * fish.speed * t;
  if (cx > POND_HALF) cx -= span;
  else if (cx < -POND_HALF) cx += span;
  return cx;
}

/**
 * How long a fish is from reaching a seat's lane, going the way it is going.
 *
 * A fish that has already passed comes round again — it leaves at one bank and enters at
 * the other — so the answer is never negative and never further away than one length of
 * the pond. Covariant under the half-turn by inspection: negating the lane, the position
 * and the direction leaves the quotient bit-identical.
 */
export function laneTime(seat: SeatId, fish: Readonly<Fish>): number {
  const velocity = fish.dir * fish.speed;
  const lap = (POND_HALF + POND_HALF) / fish.speed;
  const t = (laneOf(seat) - fish.cx) / velocity;
  return t < 0 ? t + lap : t;
}

/* ------------------------------------------------------------------------------------ */
/* Building and resetting                                                                */
/* ------------------------------------------------------------------------------------ */

function makeRod(): Rod {
  return {
    phase: 'ready',
    out: 0,
    prevOut: 0,
    speed: 0,
    loaded: -1,
    caught: 0,
    casts: 0,
    empties: 0,
    flash: 0,
  };
}

function resetRod(rod: Rod): void {
  rod.phase = 'ready';
  rod.out = 0;
  rod.prevOut = 0;
  rod.speed = 0;
  rod.loaded = -1;
  rod.caught = 0;
  rod.casts = 0;
  rod.empties = 0;
  rod.flash = 0;
}

/**
 * A number in [0, 1) for the `k`th draw of the layout.
 *
 * Two modes through one function. With a generator it is a seeded draw; without one it is
 * a golden-ratio low-discrepancy sequence, which spreads as evenly as a random one and
 * lets {@link createGame} hand back a real, playable pond before anybody has a seed —
 * tests and the balance harness both want that.
 */
function layoutDraw(rng: Rng | null, k: number): number {
  if (rng !== null) return rng.float();
  const x = (k + 1) * 0.6180339887498949;
  return x - Math.floor(x);
}

/**
 * Stock the pond: nine fish in the three rows on one side of the middle, and their nine
 * exact images on the other.
 *
 * Fish `2k` is drawn and fish `2k + 1` is its twin, at the negation of its position,
 * swimming the opposite way at the same speed. The pond is therefore invariant under the
 * half-turn on the first frame of every match, whatever the seed, and neither seat is ever
 * handed the easier water. It stops being invariant the moment somebody catches something,
 * which is the game.
 */
function layout(game: Game, rng: Rng | null): void {
  let draw = 0;
  const span = (POND_HALF + POND_HALF) / FISH_PER_ROW;
  for (let row = 0; row < 3; row += 1) {
    const cy = ROW_OFFSETS[row] as number;
    const dir = ROW_DIRS[row] as number;
    for (let slot = 0; slot < FISH_PER_ROW; slot += 1) {
      const kindRoll = layoutDraw(rng, draw);
      draw += 1;
      const speedRoll = layoutDraw(rng, draw);
      draw += 1;
      const placeRoll = layoutDraw(rng, draw);
      draw += 1;

      const kind: FishKind = kindRoll < 0.5 ? 'drifter' : 'dart';
      const low = kind === 'drifter' ? DRIFTER_SPEED_LOW : DART_SPEED_LOW;
      const high = kind === 'drifter' ? DRIFTER_SPEED_HIGH : DART_SPEED_HIGH;
      // Spread one to a slot with jitter inside it, so the gap between two fish in a row
      // is guaranteed by arithmetic rather than by a loop that might not converge.
      const cx = -POND_HALF + (slot + 0.15 + placeRoll * 0.7) * span;

      const index = (row * FISH_PER_ROW + slot) * 2;
      const fish = game.fish[index] as Fish;
      fish.active = true;
      fish.delay = 0;
      fish.cx = cx;
      fish.cy = cy;
      fish.dir = dir;
      fish.speed = low + speedRoll * (high - low);
      fish.kind = kind;

      const twin = game.fish[index + 1] as Fish;
      twin.active = true;
      twin.delay = 0;
      twin.cx = -cx;
      twin.cy = -cy;
      twin.dir = -dir;
      twin.speed = fish.speed;
      twin.kind = kind;
    }
  }
}

export function createGame(): Game {
  const fish: Fish[] = [];
  for (let i = 0; i < 6 * FISH_PER_ROW; i += 1) {
    fish.push({ active: false, cx: 0, cy: 0, dir: 1, speed: 0, kind: 'drifter', delay: 0 });
  }
  const game: Game = {
    p1: makeRod(),
    p2: makeRod(),
    fish,
    clock: MATCH_SECONDS,
    winner: null,
  };
  resetGame(game, null);
  return game;
}

/**
 * Start a fresh match. `rng` is the match seed; pass null for the fixed opening pond
 * {@link createGame} builds.
 */
export function resetGame(game: Game, rng: Rng | null): void {
  game.clock = MATCH_SECONDS;
  game.winner = null;
  resetRod(game.p1);
  resetRod(game.p2);
  layout(game, rng);
}

/* ------------------------------------------------------------------------------------ */
/* Stepping                                                                              */
/* ------------------------------------------------------------------------------------ */

/* Scratch. Written at module load and rewritten in place, so a step allocates nothing. */
const claimIndex = { p1: -1, p2: -1 };
const claimDistSq = { p1: 0, p2: 0 };
const striking = { p1: false, p2: false };
const tally = { p1: 0, p2: 0 };

/**
 * Which fish this seat's strike would close on, and how far away it was.
 *
 * Nearest wins, and **an exact tie takes neither**: two fish the same distance from one
 * hook foul the line. That is not a nicety — the alternative is a tie-break, and a
 * tie-break has to be written in *something*. Written in board coordinates it is not
 * covariant under the half-turn and so decides a mirrored position the same way twice
 * instead of the opposite way, which is the defect Maze Paint and Snowball Throw each
 * shipped. Refusing the catch is the only answer that is the same answer from both chairs.
 */
function findClaim(game: Readonly<Game>, seat: SeatId): void {
  const rod = rodOf(game, seat);
  const laneCx = laneOf(seat);
  const baitCy = baitCyOf(rod, seat);
  let best = -1;
  let bestSq = 0;
  let tied = false;
  for (let i = 0; i < game.fish.length; i += 1) {
    const fish = game.fish[i] as Fish;
    if (!fish.active) continue;
    const dx = fish.cx - laneCx;
    const dy = fish.cy - baitCy;
    const distSq = dx * dx + dy * dy;
    const reach = catchRadiusOf(fish.kind);
    if (distSq > reach * reach) continue;
    if (best < 0 || distSq < bestSq) {
      best = i;
      bestSq = distSq;
      tied = false;
    } else if (distSq === bestSq) {
      tied = true;
    }
  }
  claimIndex[seat] = tied ? -1 : best;
  claimDistSq[seat] = bestSq;
}

/**
 * Hand out the fish both strikes closed on.
 *
 * Both claims are computed against the same pond before either is settled, so the answer
 * does not depend on which seat the loop reached first — which is the same argument as the
 * tie-break above, one level up. When both hooks close on one fish the nearer takes it,
 * and an exact tie there breaks both lines and leaves the fish in the water.
 */
function settleClaims(game: Game): void {
  let p1Fish = claimIndex.p1;
  let p2Fish = claimIndex.p2;
  if (p1Fish >= 0 && p1Fish === p2Fish) {
    if (claimDistSq.p1 < claimDistSq.p2) p2Fish = -1;
    else if (claimDistSq.p2 < claimDistSq.p1) p1Fish = -1;
    else {
      p1Fish = -1;
      p2Fish = -1;
    }
  }
  for (let i = 0; i < SEATS.length; i += 1) {
    const seat = SEATS[i] as SeatId;
    if (!striking[seat]) continue;
    const rod = rodOf(game, seat);
    const index = seat === 'p1' ? p1Fish : p2Fish;
    if (index >= 0) {
      const fish = game.fish[index] as Fish;
      fish.active = false;
      fish.delay = HELD;
      rod.loaded = index;
    } else {
      rod.loaded = -1;
      rod.empties += 1;
    }
    rod.phase = 'reeling';
    rod.speed = 0;
  }
}

/**
 * One step of a bait in flight, integrated analytically.
 *
 * **The travel is the integral of the decay, not `v · dt`.** Under `v(t) = v₀ · CAST_DRAG^t`
 * a bait covers `(v_before - v_after) / CAST_RATE` in a step, and those terms telescope: a
 * whole cast totals `(v₀ - CAST_STOP_SPEED) / CAST_RATE` however finely it is sliced.
 * Forward Euler instead overshoots by `dt · CAST_RATE / 2` — 0.63% at 60 Hz and 0.31% at
 * 120 Hz — which makes the same cast a different cast on a 120 Hz phone and puts
 * {@link flightTime}, which the bot consults on every decision, permanently out. That is
 * the defect commit b4af006 found in five games.
 *
 * The last step of a cast lands the bait on {@link MAX_REACH} exactly rather than on the
 * decay's own last fraction, so the resting spot is the same spot at every step rate and
 * sits precisely on the far row.
 */
function stepFlight(rod: Rod, dt: number): void {
  const speed = rod.speed;
  const next = speed * Math.pow(CAST_DRAG, dt);
  if (next <= CAST_STOP_SPEED) {
    rod.out = MAX_REACH;
    rod.speed = 0;
    rod.phase = 'resting';
    return;
  }
  rod.out += (speed - next) / CAST_RATE;
  rod.speed = next;
}

/**
 * One step of the winch, integrated analytically.
 *
 * `v(t) = REEL_SPEED - (REEL_SPEED - v₀) · REEL_DRAG^t`, whose integral over a step is
 * `REEL_SPEED · dt - (v_after - v_before) / REEL_RATE`. Those terms telescope the same way
 * the cast's do, so a line comes home in the same time from the same distance whatever the
 * step rate. Returns true once the bait is home.
 */
function stepReel(rod: Rod, dt: number): boolean {
  const before = rod.speed;
  const after = REEL_SPEED - (REEL_SPEED - before) * Math.pow(REEL_DRAG, dt);
  const travel = REEL_SPEED * dt - (after - before) / REEL_RATE;
  if (travel >= rod.out) {
    rod.out = 0;
    rod.speed = 0;
    return true;
  }
  rod.out -= travel;
  rod.speed = after;
  return false;
}

/** Read a seat's press, and record what it would strike. Nothing is settled here. */
function intend(game: Game, seat: SeatId, command: Readonly<Command>, dt: number): void {
  const rod = rodOf(game, seat);
  rod.prevOut = rod.out;
  if (rod.flash > 0) rod.flash = Math.max(0, rod.flash - dt);
  striking[seat] = false;
  claimIndex[seat] = -1;
  claimDistSq[seat] = 0;
  if (!command.press) return;

  if (rod.phase === 'ready') {
    rod.phase = 'flying';
    rod.out = 0;
    rod.speed = CAST_SPEED;
    rod.casts += 1;
    return;
  }
  if (rod.phase === 'flying' || rod.phase === 'resting') {
    striking[seat] = true;
    findClaim(game, seat);
  }
}

/** Move a rod on: out on a cast, home on a reel, and land whatever came with it. */
function driveRod(game: Game, seat: SeatId, dt: number): void {
  const rod = rodOf(game, seat);
  if (rod.phase === 'flying') {
    stepFlight(rod, dt);
    return;
  }
  if (rod.phase !== 'reeling') return;
  if (!stepReel(rod, dt)) return;
  rod.phase = 'ready';
  if (rod.loaded >= 0) {
    const fish = game.fish[rod.loaded] as Fish;
    fish.delay = RESPAWN_SECONDS;
    rod.loaded = -1;
    rod.caught += 1;
    rod.flash = 0.6;
  }
}

/** Swim every fish, and bring the ones that are between lives back in at the bank. */
function stepFish(game: Game, dt: number): void {
  for (let i = 0; i < game.fish.length; i += 1) {
    const fish = game.fish[i] as Fish;
    if (!fish.active) {
      if (fish.delay === HELD) continue;
      fish.delay -= dt;
      if (fish.delay > 0) continue;
      fish.active = true;
      fish.delay = 0;
      fish.cx = -fish.dir * POND_HALF;
      continue;
    }
    fish.cx += fish.dir * fish.speed * dt;
    // Out at one bank, in at the other, at the same speed. The pond's population is a
    // constant, so neither seat can be starved of chances by the other's luck.
    if (fish.dir > 0) {
      if (fish.cx > POND_HALF) fish.cx = -POND_HALF;
    } else if (fish.cx < -POND_HALF) {
      fish.cx = POND_HALF;
    }
  }
}

/**
 * Who has won, or null while the match is still on.
 *
 * Twenty-five goes through the SDK's `first-to`, which is the shared spelling of the
 * catalogue row and is also what makes two rods landing their twenty-fifth in the same
 * step a draw rather than a win for whichever seat the loop reached first.
 *
 * The whistle is settled here rather than by passing `timeExpired`, because this game has
 * a tie-break the helper has no way to know about: level on fish, the rod that struck at
 * nothing **fewer** times takes it. A score is one of twenty-six values and two players of
 * the same standard sit on the same one often. Both halves of that rule are per-seat
 * counters rather than anything read off the board, so it settles a mirrored match the
 * opposite way round, which is the whole requirement.
 */
function judge(game: Game): void {
  tally.p1 = game.p1.caught;
  tally.p2 = game.p2.caught;
  const decided = resolve(WIN_CONDITION, tally);
  if (decided !== null) {
    game.winner = decided;
    return;
  }
  if (game.clock > 0) return;
  if (tally.p1 !== tally.p2) {
    game.winner = tally.p1 > tally.p2 ? 'p1' : 'p2';
    return;
  }
  const e1 = game.p1.empties;
  const e2 = game.p2.empties;
  if (e1 !== e2) {
    game.winner = e1 < e2 ? 'p1' : 'p2';
    return;
  }
  game.winner = 'draw';
}

/**
 * One fixed step. Deterministic, and allocates nothing.
 *
 * Presses are read against the pond as it stood at the top of the step and settled before
 * anything moves, so what a player struck at is what they were looking at, and the two
 * seats are answered simultaneously rather than in loop order.
 */
export function step(
  game: Game,
  dt: number,
  p1Command: Readonly<Command>,
  p2Command: Readonly<Command>,
): void {
  if (game.winner !== null) return;

  intend(game, 'p1', p1Command, dt);
  intend(game, 'p2', p2Command, dt);
  settleClaims(game);
  driveRod(game, 'p1', dt);
  driveRod(game, 'p2', dt);
  stepFish(game, dt);

  game.clock = Math.max(0, game.clock - dt);
  judge(game);
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/**
 * Forget a press that the shell's pause swallowed.
 *
 * `InputManager.clear()` drops every key and pointer, so a finger still on the glass when
 * the match resumes arrives as a fresh `actionPressed` — a cast nobody asked for. The
 * engine cannot yet tell a resumed hold from a new one (`docs/input-idiom.md`, missing
 * primitive 1), so `game.ts` swallows one press per seat on the way out of a pause and
 * this is the rules-side reset it pairs with: a rod mid-cast is left exactly as it was.
 */
export function settleRod(game: Game, seat: SeatId): void {
  const rod = rodOf(game, seat);
  rod.prevOut = rod.out;
}

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * Three knobs, and each of them is a different thing a person is better or worse at.
 *
 * Nothing here is information a player does not have. Every fish's position, speed and
 * heading is drawn, the bait's own flight is drawn, and the decay law behind it is the
 * curve a player watches on every cast. What a weaker tier is denied is attention and
 * timing, never sight. Each knob was swept alone across its whole range against an
 * untouched `normal`; the numbers are in SPEC.md.
 */
export interface BotProfile {
  /**
   * Seconds between decisions. Between them the bot holds the plan it made, so a slower
   * tier throws at a fish that has moved on and strikes on a stale prediction.
   */
  readonly think: number;
  /** Seconds of error on the throw. One draw a decision, uniform and signed. */
  readonly cast: number;
  /** Seconds of error on the strike. One draw a decision, uniform and signed. */
  readonly snap: number;
}

/**
 * The three tiers.
 *
 * Every one of these is a strong knob on its own, so the shipped spread is deliberately
 * narrow: three strong knobs pulled apart by intuition compound into a ladder nobody can
 * climb. SPEC.md carries the sweeps and the measured win rates.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ think: 0.28, cast: 0.16, snap: 0.082 }),
  normal: Object.freeze({ think: 0.22, cast: 0.11, snap: 0.062 }),
  hard: Object.freeze({ think: 0.17, cast: 0.075, snap: 0.046 }),
});

/** How much the gap between decisions wanders, as a fraction. One draw. */
export const REACTION_WANDER = 0.25;

/**
 * How long a bot will hold a loaded rod before it throws anyway, and how long past the end
 * of a cast it will leave a bait soaking before it rewinds anyway.
 *
 * Not difficulty knobs — every tier uses them, and they are the termination guarantee
 * rather than a handicap. A bot that waits for a perfect interception waits for ever on a
 * pond that never offers one; Cup Pong's needle bot swept for ever on the second seed it
 * was given. Past these the rod acts on the best it can see, which always makes progress,
 * because an empty line still comes home and can be thrown again. Together with the flight
 * and the reel they bound a cycle at about six seconds, which is what makes twenty-five
 * fish reachable inside {@link MATCH_SECONDS} for the weakest pairing.
 */
export const CAST_LIMIT = 1.5;
export const STRIKE_LIMIT = FLIGHT_SECONDS + 0.7;

/**
 * How long a bot will keep a bait in water it can see nothing catchable in.
 *
 * Counted on its own rather than folded into the deadline above, because a deadline that
 * every look re-derives is a deadline that never arrives — the same trap the errors fell
 * into, one level up. This one accumulates while the pond stays hopeless and resets the
 * moment it does not, so it cannot be postponed by looking again.
 */
export const ABORT_SECONDS = 0.4;

/** How far ahead a bot will wait for an interception rather than throwing at once. */
export const BOT_LOOKAHEAD = 1.4;

/** Values a bot draws per decision. Always this many, always before any branch. */
export const BOT_DRAWS_PER_DECISION = 3;

export interface BotState {
  /** Seconds to the next look at the pond. */
  cooldown: number;
  /** The rod phase this state was last brought up to date against. */
  phase: RodPhase;
  /** The fish this cycle is for, as an index into {@link Game.fish}, or -1. */
  target: number;
  /** Seconds until the throw it has planned. Infinity when it has no plan. */
  castIn: number;
  /** Seconds until the strike it has planned. Infinity when it has no plan. */
  snapIn: number;
  /** Seconds this rod has been in its current phase. Forces an act past the limits above. */
  idle: number;
  /** Seconds the bot has been looking at a cast it can do nothing with. */
  blank: number;
  /**
   * This cycle's two judgements, in seconds. Signed, drawn once, and held.
   *
   * **Once per cycle, not once per decision**, and that is a measurement rather than a
   * preference. Redrawn every decision they made `think` run *backwards* — 10.0% won at
   * 0.08 s against 90.8% at 0.60 s, monotone the wrong way over the whole range. A press
   * fires when its countdown reaches zero, so resampling the error `1/think` times a
   * second fires on the *minimum* of that many draws: the faster a bot looked, the earlier
   * it struck, by roughly the full width of its own error. A knob that is really measuring
   * how often another knob is resampled is not a knob. Drawn once at the first look of a
   * cycle, `think` measures forwards and the two errors measure what they are named after.
   */
  castError: number;
  snapError: number;
  /** Whether this cycle's judgements have been drawn yet. */
  armed: boolean;
}

export function createBotState(): BotState {
  return {
    cooldown: 0,
    phase: 'ready',
    target: -1,
    castIn: Infinity,
    snapIn: Infinity,
    idle: 0,
    blank: 0,
    castError: 0,
    snapError: 0,
    armed: false,
  };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.phase = 'ready';
  state.target = -1;
  state.castIn = Infinity;
  state.snapIn = Infinity;
  state.idle = 0;
  state.blank = 0;
  state.castError = 0;
  state.snapError = 0;
  state.armed = false;
}

/**
 * When to strike, given a bait heading for `rowOut` and a fish heading for the lane.
 *
 * The bait crosses the row at `tRow` and the fish crosses the lane at `tLane`, and the two
 * gaps close along axes at right angles to each other — so the moment the pair is closest
 * is the point between them weighted by the square of each one's speed. That is the exact
 * minimiser for two straight lines and a good enough one for a bait that is still slowing,
 * which is why the bait's speed is read *at the row* rather than where it is now.
 *
 * A resting bait has no speed at all, so the answer collapses to "strike as the fish
 * crosses the lane", which is exactly what a person does.
 */
function strikeTime(tRow: number, tLane: number, baitSpeed: number, fishSpeed: number): number {
  const wb = baitSpeed * baitSpeed;
  const wf = fishSpeed * fishSpeed;
  const total = wb + wf;
  if (total <= 0) return tLane;
  return (wb * tRow + wf * tLane) / total;
}

/**
 * Choose the fish this cycle is for, and when to throw at it.
 *
 * The bait takes `flightTime(rowOut)` to reach a fish's row and the fish takes `laneTime`
 * to reach this seat's column, so the throw wants holding for the difference between them.
 * Candidates are ranked by **how long the whole cycle would take** — the hold, the flight
 * and the wind back — rather than by the hold alone, which is what keeps a bot from
 * parking on the far row every time and is where most of its rate comes from. A fish that
 * would arrive before a bait could is ranked by how badly it misses instead, so a pond
 * with nothing lined up still produces the least bad throw rather than no throw.
 *
 * Every branch is covariant under the half-turn: the lane, the rows and the fish are all
 * offsets from the middle of the board multiplied by the seat's own sign, and the only
 * comparisons are between candidate fish rather than against a board coordinate.
 */
export function planCast(game: Readonly<Game>, seat: SeatId, state: BotState): void {
  let best = -1;
  let bestWait = 0;
  let bestScore = Infinity;
  for (let i = 0; i < game.fish.length; i += 1) {
    const fish = game.fish[i] as Fish;
    if (!fish.active) continue;
    const rowOut = rowOutOf(seat, fish);
    if (rowOut < 0 || rowOut > MAX_REACH) continue;
    const tRow = flightTime(rowOut);
    const wait = laneTime(seat, fish) - tRow;
    if (wait > BOT_LOOKAHEAD) continue;
    // A miss costs four times what the same length of waiting does, so holding the rod is
    // preferred to throwing at something already gone without ever being free. The cycle
    // term is what keeps a bot off the far row: a catch that takes three seconds to wind
    // back is worth less than one that takes half of that, and rate is the whole game.
    const cycle = tRow + rowOut / REEL_SPEED;
    const score = (wait >= 0 ? wait : -wait * 4) + cycle;
    if (score < bestScore) {
      bestScore = score;
      bestWait = wait;
      best = i;
    }
  }
  state.target = best;
  state.castIn = best < 0 ? Infinity : bestWait + state.castError;
}

/* The one candidate {@link measureStrike} last looked at. Rewritten, never allocated. */
const strike = { when: 0, miss: 0 };

/**
 * When a bait on this cast would be nearest a given fish, and how far off it would still
 * be, in logical units. A negative miss is a catch.
 *
 * The bait crosses the fish's row at `remaining` and the fish crosses the seat's column at
 * its own `laneTime`, and the two gaps close along axes at right angles — so the moment
 * the pair is nearest is the point between the two weighted by the square of each one's
 * speed, which is the exact minimiser for two straight lines and a good enough one for a
 * bait that is still slowing. A bait that has landed, or one heading for the row it lands
 * on, is standing still by the time the fish arrives, so the answer there is simply the
 * fish's own crossing.
 *
 * Nothing read here is hidden from a player: the fish, its heading, the bait and the
 * curve the bait flies are all on the board.
 */
function measureStrike(
  game: Readonly<Game>,
  seat: SeatId,
  index: number,
  fromOut: number,
): boolean {
  const fish = game.fish[index] as Fish;
  if (!fish.active) return false;
  const rowOut = rowOutOf(seat, fish);
  if (rowOut < fromOut) return false;
  const now = flightTime(fromOut);
  const remaining = flightTime(rowOut) - now;
  const tLane = laneTime(seat, fish);
  const when =
    rowOut >= MAX_REACH
      ? Math.max(remaining, tLane)
      : strikeTime(remaining, tLane, flightSpeedAt(rowOut), fish.speed);
  if (when < 0 || when > BOT_LOOKAHEAD + FLIGHT_SECONDS) return false;
  const baitOut = fromOut >= MAX_REACH ? MAX_REACH : flightOutAt(now + when);
  const dx = fishCxAt(fish, when) - laneOf(seat);
  const dy = fish.cy - seatAxisSign(seat) * (BOAT_OUT - baitOut);
  strike.when = when;
  strike.miss = Math.sqrt(dx * dx + dy * dy) - catchRadiusOf(fish.kind);
  return true;
}

/**
 * Work out what is still catchable on this cast, and when to strike at it.
 *
 * A bait travelling out passes each row once and can never come back to one, so the
 * candidates are exactly the rows still ahead of it — which for a bait that has already
 * landed is the far row alone, and that is what makes soaking a real, and deliberately
 * slow, option rather than a special case.
 *
 * Called once, when the throw goes out, and again only when the plan it made has gone
 * stale — see {@link botStep}. **A plan is committed to, never re-derived on a timer**, and
 * that is a measurement rather than a preference: {@link laneTime} steps by a whole lap of
 * the pond the instant a fish crosses the column, so a bot that re-derived its countdown
 * every look fell off that cliff and never pressed, and `think` measured 12.5% at its
 * fastest setting against 58% at its slowest. Committing is also simply what a person
 * does — you pick your fish and you wait for it.
 */
export function planStrike(
  game: Readonly<Game>,
  seat: SeatId,
  state: BotState,
  fromOut: number,
): void {
  let best = -1;
  let bestMiss = Infinity;
  let bestWhen = 0;
  for (let i = 0; i < game.fish.length; i += 1) {
    if (!measureStrike(game, seat, i, fromOut)) continue;
    if (strike.miss < bestMiss) {
      bestMiss = strike.miss;
      bestWhen = strike.when;
      best = i;
    }
  }
  if (best < 0 || bestMiss > 0) {
    // Nothing this cast can still reach. {@link ABORT_SECONDS} winds the line in and the
    // rod tries again, which is why an idle cycle costs time rather than stalling.
    state.snapIn = Infinity;
    return;
  }
  state.target = best;
  state.snapIn = bestWhen + state.snapError;
}

/**
 * Decide whether to press this step. Allocation-free; writes into `out`.
 *
 * The bot presses through the identical single boolean a person does, so it cannot do
 * anything with a rod that a player could not have done, and the difference between the
 * tiers is entirely how well the moment was chosen.
 */
export function botStep(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
  rng: Rng,
  dt: number,
  out: Command,
): void {
  out.press = false;
  const rod = rodOf(game, seat);
  if (rod.phase !== state.phase) {
    state.phase = rod.phase;
    state.idle = 0;
    if (rod.phase === 'ready') {
      state.target = -1;
      // A landed rod is a new cycle, so the next look draws a fresh pair of judgements.
      state.armed = false;
    }
    state.castIn = Infinity;
    state.blank = 0;
    if (rod.phase !== 'flying') state.snapIn = Infinity;
  }
  state.idle += dt;

  state.cooldown -= dt;
  if (state.cooldown <= 0) {
    // All three drawn up front, unconditionally, so the count can never depend on the pond.
    const jitter = rng.float();
    const castRoll = rng.float();
    const snapRoll = rng.float();
    state.cooldown = profile.think * (1 + (jitter * 2 - 1) * REACTION_WANDER);
    if (!state.armed) {
      state.armed = true;
      state.castError = (castRoll * 2 - 1) * profile.cast;
      state.snapError = (snapRoll * 2 - 1) * profile.snap;
    }
    // A plan is re-derived only when it has gone stale: the rod has nothing planned at
    // all, or the fish it was for has left the water — usually because the other seat
    // took it, which is the one thing in this game a rod cannot see coming.
    const held = state.target;
    const gone = held < 0 || !(game.fish[held] as Fish).active;
    if (rod.phase === 'ready') {
      if (gone || !Number.isFinite(state.castIn)) planCast(game, seat, state);
    } else if (rod.phase !== 'reeling') {
      if (gone || !Number.isFinite(state.snapIn)) planStrike(game, seat, state, rod.out);
    }
  }

  if (rod.phase === 'reeling') return;

  if (rod.phase === 'ready') {
    state.castIn -= dt;
    if (state.castIn <= 0 || state.idle >= CAST_LIMIT) {
      out.press = true;
      // The throw is going out now, so the strike is planned now too rather than at the
      // next look — at `think` seconds a look, a shallow row would otherwise be crossed
      // and gone before the bot had considered it.
      planStrike(game, seat, state, 0);
    }
    return;
  }

  state.blank = Number.isFinite(state.snapIn) ? 0 : state.blank + dt;
  state.snapIn -= dt;
  if (state.snapIn <= 0 || state.blank >= ABORT_SECONDS || state.idle >= STRIKE_LIMIT) {
    out.press = true;
    state.snapIn = Infinity;
  }
}

export function botCommand(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  dt: number,
  out: Command,
): void {
  botStep(game, seat, BOT_PROFILES[difficulty], state, rng, dt, out);
}
