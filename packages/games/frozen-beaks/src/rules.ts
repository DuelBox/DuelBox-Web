import { createContact, envelopeFor, sweptCircleCircle } from '@duelbox/engine';
import type { Circle, Contact, Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Frozen Beaks, as pure rules.
 *
 * Two birds on two ice floes, one at each end of the device. Walking is slow and
 * steerable; stop walking and the bird launches into a slide it cannot steer. Fish are
 * picked up by touching them, holes in the ice swallow anything that crosses their rim,
 * and the first bird to thirty fish wins.
 *
 * No rendering, no timing, no DOM — the bot, the balance harness and the tests all reuse
 * this module.
 *
 * ## The four decisions this file exists to record
 *
 * **A heading is one of nine values, and nothing here is continuous.** The catalogue row
 * says "move your finger to walk", which is a *position*, and `docs/input-parity.md` is
 * unambiguous that an absolute position is a quantity a thumb can name and a key cannot.
 * So the simulation is handed a {@link Command} carrying a direction drawn from the same
 * nine values a keyboard produces — eight compass points and a standstill — and the walk
 * runs at one {@link WALK_SPEED} whichever instrument named it. See SPEC.md.
 *
 * **The wind-up is counted in steps and spent in three discrete tiers.** `charge`
 * accumulates the fixed delta while the bird is walking and is read only through
 * {@link tierFor}, whose plateaus are 0.45 s and 0.55 s wide. A player releases
 * comfortably inside the tier they want, so thirty milliseconds of input latency changes
 * nothing about the slide that leaves.
 *
 * **The slide is the analytic integral of its own decay, not `v · dt`.** A bot that
 * reasons about where a slide ends has to reason about the world the simulation actually
 * steps. See {@link stepSlide} and {@link REACH}, and commit b4af006 for the five games
 * that had these two disagree.
 *
 * **The two floes are half-turn images of one another.** Every hole and every fish spawn
 * is generated once, in seat one's frame, and mirrored through `(x, y) → (600 − x,
 * 1000 − y)` for seat two. Neither player ever has an easier course than the other, and
 * `rules.test.ts` plays hundreds of mirrored boards against each other to prove that no
 * decision anywhere in this file is written in board coordinates.
 */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** The line the two floes are reflected through, and where the divider is drawn. */
export const CENTRE_Y = BOARD_HEIGHT / 2;

/* ------------------------------------------------------------------------------------ */
/* The ice                                                                               */
/* ------------------------------------------------------------------------------------ */

/**
 * Where seat one's floe sits. Seat two's is its half-turn image, so the pair is
 * symmetric about `(300, 500)` and neither player reads a board the other cannot.
 */
export const FLOE_INSET = 20;
export const FLOE_LEFT = FLOE_INSET;
export const FLOE_RIGHT = BOARD_WIDTH - FLOE_INSET;
/** Seat one's floe: from its own shore up to a gap either side of the centre line. */
export const FLOE_NEAR = BOARD_HEIGHT - FLOE_INSET;
export const FLOE_FAR = CENTRE_Y + FLOE_INSET;

export const BIRD_RADIUS = 22;
export const FISH_RADIUS = 12;

/**
 * How wide a hole is, and what "falling in" means.
 *
 * The bird falls when its **centre** crosses the rim, so a beak hanging over the edge is
 * survivable and the drawn circle is exactly the shape the rule uses. Expressed that way
 * rather than as an overlap because a player has to be able to look at a hole and know
 * where the edge of safety is.
 */
export const HOLE_RADIUS = 40;

/** A fish is taken when the bird touches it. Swept, so a fast slide cannot pass through. */
export const PICKUP_RADIUS = BIRD_RADIUS + FISH_RADIUS;

/** How far a bird's centre may travel, per seat. Half-turn images of each other. */
export function minX(): number {
  return FLOE_LEFT + BIRD_RADIUS;
}
export function maxX(): number {
  return FLOE_RIGHT - BIRD_RADIUS;
}
export function minY(seat: SeatId): number {
  return seat === 'p1' ? FLOE_FAR + BIRD_RADIUS : BOARD_HEIGHT - FLOE_NEAR + BIRD_RADIUS;
}
export function maxY(seat: SeatId): number {
  return seat === 'p1' ? FLOE_NEAR - BIRD_RADIUS : BOARD_HEIGHT - FLOE_FAR - BIRD_RADIUS;
}

/**
 * Where a bird starts, and where it climbs back out after a dunk: the middle of its own
 * near shore. Always dry, always the same distance from everything, and the same move
 * for both seats under the half-turn.
 */
export function homeX(): number {
  return BOARD_WIDTH / 2;
}
export function homeY(seat: SeatId): number {
  return seat === 'p1' ? FLOE_NEAR - 50 : BOARD_HEIGHT - (FLOE_NEAR - 50);
}

/* ------------------------------------------------------------------------------------ */
/* Walking, sliding, and falling in                                                      */
/* ------------------------------------------------------------------------------------ */

/**
 * How fast a bird walks, and the number the fairness argument rests on.
 *
 * One precision envelope in this box is `min(600, 1000) / 200 = 3` units, so a bird walks
 * exactly one envelope in 25 ms. The largest quantity two input families can disagree
 * about is *when* a player let go, and a thirty-millisecond latency difference therefore
 * moves the launch point by about one envelope — the resolution the engine already
 * declares nobody may aim finer than. See SPEC.md, "Fairness across input families".
 */
export const WALK_SPEED = 120;

/**
 * How far a finger must sit from the bird before it means "walk".
 *
 * Four precision envelopes, per `docs/input-idiom.md` rule 2, rather than a
 * twenty-third hand-picked constant. Inside it the answer is a standstill — which in
 * this game is also the release, so resting a finger on your own bird slides it exactly
 * as lifting does.
 */
export const MOVE_DEADZONE = 4 * envelopeFor({ width: BOARD_WIDTH, height: BOARD_HEIGHT });

/**
 * The three sizes of slide.
 *
 * Discrete, and that is the fairness decision this game turns on. A continuous power
 * meter has its optimum at the top of the meter, so every player releases at a boundary
 * and every millisecond of latency is a distance; three tiers with half-second plateaus
 * pay nothing for releasing near a boundary.
 *
 * Bigger is longer **and more committed**: a tier-two slide asks for 432 units of clear
 * ice in a floe 560 by 460, which is most of a diagonal, and once it is away the bird
 * cannot steer out of anything. `windUp` is seconds of walking, which is itself a
 * commitment — the wind-up walks you somewhere.
 */
export interface Tier {
  /** Seconds of walking before this slide is available. */
  readonly windUp: number;
  /** Units a second at the moment of release. */
  readonly launch: number;
}

export const TIERS: readonly Tier[] = Object.freeze([
  Object.freeze({ windUp: 0.3, launch: 460 }),
  Object.freeze({ windUp: 0.75, launch: 760 }),
  Object.freeze({ windUp: 1.3, launch: 1040 }),
]);

/**
 * The fraction of a slide's speed that survives one second on the ice.
 *
 * Paired with {@link GLIDE_RATE}, which is the exponent behind it. A slide launched at
 * `v` covers exactly `(v - STOP_SPEED) / GLIDE_RATE` before it stops — the analytic
 * integral of the decay, not an approximation of it.
 */
export const GLIDE = 0.1;
export const GLIDE_RATE = -Math.log(GLIDE);

/** Below this the bird has stopped. A slide coasts the exact distance left and stands up. */
export const STOP_SPEED = 45;

/**
 * How far each tier of slide travels on clear ice.
 *
 * Exact rather than indicative: {@link stepSlide} integrates the decay analytically, so
 * this is the distance the simulation actually produces at any step rate, and the bot
 * plans with it. `rules.test.ts` slides the same launch at 60, 90, 120 and 240 Hz and
 * requires the same stopping point to nine decimals.
 */
export const REACH: readonly number[] = Object.freeze(
  TIERS.map((tier) => (tier.launch - STOP_SPEED) / GLIDE_RATE),
);

/** Seconds in the water after a dunk. */
export const DUNK_SECONDS = 1.6;

/** Fish that wriggle free when a bird goes in. Never below nothing. */
export const DUNK_COST = 2;

/** Fish on the ice at once, per seat. */
export const FISH_ON_ICE = 6;

/** Seconds between a fish being taken and its replacement surfacing. */
export const RESPAWN_SECONDS = 0.9;

/** Holes on a floe. Placed on a jittered grid, so the count and the spacing are fixed. */
export const HOLE_COUNT = 5;

/** How many spawn points the cycle holds. A match uses forty-odd of them. */
export const SPAWN_SPOTS = 64;

/** How far a fish spawns from the nearest hole, so every fish can be reached dry. */
export const FISH_CLEAR = 90;

/** The race. */
export const TARGET_FISH = 30;

/**
 * The clock, in seconds, and the only reason this game is guaranteed to end.
 *
 * `roundSeconds` ends nothing — it is text on a catalogue card — so the clock lives here,
 * and a test asserts the manifest advertises the same number. Almost every pairing gets
 * to thirty fish first; the whistle is the backstop for the ones that do not.
 */
export const MATCH_SECONDS = 90;

export const WIN_CONDITION: WinCondition = Object.freeze({
  kind: 'first-to',
  target: TARGET_FISH,
});

/* ------------------------------------------------------------------------------------ */
/* State                                                                                 */
/* ------------------------------------------------------------------------------------ */

export type Phase = 'walk' | 'slide' | 'dunk';

export interface Bird {
  x: number;
  y: number;
  /** Position at the start of the step, for render interpolation. */
  prevX: number;
  prevY: number;
  phase: Phase;
  /**
   * The heading walked on the **previous** step, which is the one a release launches
   * along.
   *
   * `docs/input-idiom.md` lists this as fact 2 of three every game rediscovers: the
   * pointer is already null on the step that reports the lift, so a heading read on the
   * release step is a standstill for a finger and a direction for a key — the same
   * gesture, two different slides. Carrying the previous step's heading makes the two
   * identical by construction, and a test drives both instruments and compares the slide
   * that leaves.
   */
  lastDirX: number;
  lastDirY: number;
  /** Seconds walked since the last stop. Counted, never derived. See {@link tierFor}. */
  charge: number;
  /** Slide speed. Zero unless the phase is `slide`. */
  speed: number;
  /** Unit heading of the slide in progress. */
  slideX: number;
  slideY: number;
  /** Seconds left in the water. */
  dunk: number;
  /** Where the splash is, so the drawing can show it. Simulation-visible, never read. */
  dunkX: number;
  dunkY: number;
  caught: number;
  dunks: number;
  /** Slides launched. The cadence the fairness argument is measured against. */
  slides: number;
  /** Seconds since the last dunk, purely so the drawing can flash. */
  flash: number;
}

export interface Fish {
  active: boolean;
  x: number;
  y: number;
  /** Seconds until this one surfaces again. */
  delay: number;
}

export interface Hole {
  x: number;
  y: number;
}

export interface Spot {
  x: number;
  y: number;
}

export interface Floe {
  readonly bird: Bird;
  readonly holes: Hole[];
  readonly fish: Fish[];
  /** How far through {@link Game.spots} this seat has eaten. */
  cursor: number;
}

export interface Game {
  readonly p1: Floe;
  readonly p2: Floe;
  /**
   * The spawn cycle, in seat one's frame.
   *
   * One list, read by both seats through their own half-turn and at their own pace, so
   * the two players walk identical courses without ever competing for the same fish.
   */
  readonly spots: Spot[];
  /** Seconds left. Counts down; the whistle is the only structural end. */
  clock: number;
  winner: SeatId | 'draw' | null;
}

/** What one seat is asking for this step. The whole input surface of the simulation. */
export interface Command {
  /** A unit heading, or (0, 0) for a standstill — which is also the release. */
  dirX: number;
  dirY: number;
}

export function createCommand(): Command {
  return { dirX: 0, dirY: 0 };
}

export const SEATS: readonly SeatId[] = Object.freeze(['p1', 'p2']);

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function floeOf(game: Readonly<Game>, seat: SeatId): Floe {
  return seat === 'p1' ? game.p1 : game.p2;
}

/**
 * Which way a seat's own axes point along the board.
 *
 * Seat two sits at the top of the device and reads it upside down, so its own "forward"
 * is the device's down. Every seat-relative quantity in this file — the bot's eight
 * headings and their tie-break order — is written in the seat's frame and multiplied by
 * this, which is what makes the whole file covariant under the half-turn.
 */
export function seatAxisSign(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** The largest slide packed by `charge` seconds of walking, or −1 when there is none. */
export function tierFor(charge: number): number {
  for (let i = TIERS.length - 1; i >= 0; i -= 1) {
    if (charge >= (TIERS[i] as Tier).windUp) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------------------------ */
/* The layout                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * The six cells a hole may sit in, and how far it may wander inside one.
 *
 * A jittered grid rather than rejection sampling, so the separation between two holes is
 * guaranteed by arithmetic instead of by a loop that might not converge: the cells are
 * 130 apart across and 150 apart along, the jitter is ±22 and ±28, so no two holes are
 * ever closer than 86 units — more than the 80 at which two would merge.
 *
 * Five of the six cells carry a hole, and which one is left empty is the only structural
 * variety a match has.
 */
const HOLE_CELL_X: readonly number[] = Object.freeze([170, 300, 430]);
const HOLE_CELL_Y: readonly number[] = Object.freeze([650, 800]);
const HOLE_JITTER_X = 22;
const HOLE_JITTER_Y = 28;

/** Where a fish may spawn, in seat one's frame. */
const SPOT_MIN_X = 60;
const SPOT_MAX_X = BOARD_WIDTH - SPOT_MIN_X;
const SPOT_MIN_Y = CENTRE_Y + 45;
const SPOT_MAX_Y = BOARD_HEIGHT - 45;

/** How many placements a spawn point tries before it settles for the best it saw. */
const SPOT_ATTEMPTS = 40;

/**
 * A number in [0, 1) for the `k`th draw of the layout.
 *
 * Two modes through one function. With a generator it is a seeded draw; without one it
 * is a golden-ratio low-discrepancy sequence, which spreads as evenly as a random one
 * and lets {@link createGame} hand back a real, playable board before anybody has a seed
 * — tests and the balance harness both want that.
 */
function layoutDraw(rng: Rng | null, k: number): number {
  if (rng !== null) return rng.float();
  const x = (k + 1) * 0.6180339887498949;
  return x - Math.floor(x);
}

/**
 * Lay out one match: five holes on a jittered grid, then a cycle of fish spawn points
 * clear of every one of them.
 *
 * Generated once, in seat one's frame. Seat two reads the same list through the
 * half-turn, so the two courses are identical and neither seat can draw the easier one.
 */
function layout(game: Game, rng: Rng | null): void {
  let draw = 0;
  const skip = Math.floor(layoutDraw(rng, draw) * 6);
  draw += 1;

  let placed = 0;
  for (let cell = 0; cell < 6; cell += 1) {
    if (cell === skip) continue;
    const cx = HOLE_CELL_X[cell % 3] as number;
    const cy = HOLE_CELL_Y[Math.floor(cell / 3)] as number;
    const jx = (layoutDraw(rng, draw) * 2 - 1) * HOLE_JITTER_X;
    draw += 1;
    const jy = (layoutDraw(rng, draw) * 2 - 1) * HOLE_JITTER_Y;
    draw += 1;
    const hole = game.p1.holes[placed] as Hole;
    hole.x = cx + jx;
    hole.y = cy + jy;
    const mirrored = game.p2.holes[placed] as Hole;
    mirrored.x = BOARD_WIDTH - hole.x;
    mirrored.y = BOARD_HEIGHT - hole.y;
    placed += 1;
  }

  for (let k = 0; k < SPAWN_SPOTS; k += 1) {
    let bestX = 0;
    let bestY = 0;
    let bestClear = -1;
    for (let attempt = 0; attempt < SPOT_ATTEMPTS; attempt += 1) {
      const x = SPOT_MIN_X + layoutDraw(rng, draw) * (SPOT_MAX_X - SPOT_MIN_X);
      draw += 1;
      const y = SPOT_MIN_Y + layoutDraw(rng, draw) * (SPOT_MAX_Y - SPOT_MIN_Y);
      draw += 1;
      let nearest = Infinity;
      for (let i = 0; i < game.p1.holes.length; i += 1) {
        const hole = game.p1.holes[i] as Hole;
        const gap = Math.hypot(x - hole.x, y - hole.y);
        if (gap < nearest) nearest = gap;
      }
      if (nearest > bestClear) {
        bestClear = nearest;
        bestX = x;
        bestY = y;
      }
      // Far enough from every hole that a bird can stand beside the fish and stay dry.
      if (nearest >= FISH_CLEAR) break;
    }
    const spot = game.spots[k] as Spot;
    spot.x = bestX;
    spot.y = bestY;
  }
}

function spotFor(game: Readonly<Game>, index: number): Spot {
  return game.spots[index % SPAWN_SPOTS] as Spot;
}

/** Move a fish onto the next point of the cycle, in this seat's own frame. */
function surface(game: Game, seat: SeatId, fish: Fish): void {
  const floe = floeOf(game, seat);
  const spot = spotFor(game, floe.cursor);
  floe.cursor = (floe.cursor + 1) % SPAWN_SPOTS;
  fish.x = seat === 'p1' ? spot.x : BOARD_WIDTH - spot.x;
  fish.y = seat === 'p1' ? spot.y : BOARD_HEIGHT - spot.y;
  fish.active = true;
  fish.delay = 0;
}

/* ------------------------------------------------------------------------------------ */
/* Building and resetting                                                                */
/* ------------------------------------------------------------------------------------ */

function makeBird(seat: SeatId): Bird {
  return {
    x: homeX(),
    y: homeY(seat),
    prevX: homeX(),
    prevY: homeY(seat),
    phase: 'walk',
    lastDirX: 0,
    lastDirY: 0,
    charge: 0,
    speed: 0,
    slideX: 0,
    slideY: 0,
    dunk: 0,
    dunkX: homeX(),
    dunkY: homeY(seat),
    caught: 0,
    dunks: 0,
    slides: 0,
    flash: 0,
  };
}

function makeFloe(seat: SeatId): Floe {
  const holes: Hole[] = [];
  for (let i = 0; i < HOLE_COUNT; i += 1) holes.push({ x: 0, y: 0 });
  const fish: Fish[] = [];
  for (let i = 0; i < FISH_ON_ICE; i += 1) fish.push({ active: false, x: 0, y: 0, delay: 0 });
  return { bird: makeBird(seat), holes, fish, cursor: 0 };
}

export function createGame(): Game {
  const spots: Spot[] = [];
  for (let i = 0; i < SPAWN_SPOTS; i += 1) spots.push({ x: 0, y: 0 });
  const game: Game = {
    p1: makeFloe('p1'),
    p2: makeFloe('p2'),
    spots,
    clock: MATCH_SECONDS,
    winner: null,
  };
  resetGame(game, null);
  return game;
}

function resetBird(bird: Bird, seat: SeatId): void {
  bird.x = homeX();
  bird.y = homeY(seat);
  bird.prevX = bird.x;
  bird.prevY = bird.y;
  bird.phase = 'walk';
  bird.lastDirX = 0;
  bird.lastDirY = 0;
  bird.charge = 0;
  bird.speed = 0;
  bird.slideX = 0;
  bird.slideY = 0;
  bird.dunk = 0;
  bird.dunkX = bird.x;
  bird.dunkY = bird.y;
  bird.caught = 0;
  bird.dunks = 0;
  bird.slides = 0;
  bird.flash = 0;
}

/**
 * Start a fresh match. `rng` is the match seed; pass null for the fixed opening board
 * {@link createGame} builds.
 */
export function resetGame(game: Game, rng: Rng | null): void {
  game.clock = MATCH_SECONDS;
  game.winner = null;
  resetBird(game.p1.bird, 'p1');
  resetBird(game.p2.bird, 'p2');
  game.p1.cursor = 0;
  game.p2.cursor = 0;
  layout(game, rng);
  for (const seat of SEATS) {
    const floe = floeOf(game, seat);
    for (let i = 0; i < floe.fish.length; i += 1) {
      const fish = floe.fish[i] as Fish;
      fish.active = false;
      fish.delay = 0;
      surface(game, seat, fish);
    }
  }
}

/**
 * Plant a bird's feet: forget the wind-up without launching a slide.
 *
 * The shell's pause calls `InputManager.clear()`, which drops every key and pointer and
 * so delivers a standstill on the first step back — which in this game is a release. The
 * engine cannot yet tell a cancelled gesture from a deliberate one
 * (`docs/input-idiom.md`, missing primitive 1), so the game spends its wind-up rather
 * than sliding on the way out of the pause menu. A test covers both directions.
 */
export function plantFeet(game: Game, seat: SeatId): void {
  const bird = floeOf(game, seat).bird;
  if (bird.phase !== 'walk') return;
  bird.charge = 0;
  bird.lastDirX = 0;
  bird.lastDirY = 0;
}

/* ------------------------------------------------------------------------------------ */
/* Stepping                                                                              */
/* ------------------------------------------------------------------------------------ */

/* Scratch shapes. Allocated once at module load and reused, so a step allocates nothing. */
const contact: Contact = createContact();
const mover: Circle = { x: 0, y: 0, radius: 0 };
const target: Circle = { x: 0, y: 0, radius: 0 };
const tally = { p1: 0, p2: 0 };

/**
 * Move a bird by `(dx, dy)`, taking whatever it crosses on the way.
 *
 * Swept, never sampled. A tier-two slide covers 17 units in a 60 Hz step and a hole rim
 * is a line with no thickness, so a static test at the two ends of a step would let a
 * bird skate straight over one. `sweptCircleCircle` solves the whole step for both the
 * fish and the holes, and the earliest of them wins: a fish sitting on the near lip of a
 * hole is eaten on the way in.
 *
 * Returns true when the bird went in.
 */
function advance(game: Game, seat: SeatId, dx: number, dy: number): boolean {
  const floe = floeOf(game, seat);
  const bird = floe.bird;

  let hole = -1;
  let holeTime = Infinity;
  mover.x = bird.x;
  mover.y = bird.y;
  mover.radius = 0;
  target.radius = HOLE_RADIUS;
  for (let i = 0; i < floe.holes.length; i += 1) {
    const pit = floe.holes[i] as Hole;
    target.x = pit.x;
    target.y = pit.y;
    if (!sweptCircleCircle(contact, mover, dx, dy, target)) continue;
    if (contact.depth < holeTime) {
      holeTime = contact.depth;
      hole = i;
    }
  }

  mover.radius = BIRD_RADIUS;
  target.radius = FISH_RADIUS;
  for (let i = 0; i < floe.fish.length; i += 1) {
    const fish = floe.fish[i] as Fish;
    if (!fish.active) continue;
    target.x = fish.x;
    target.y = fish.y;
    if (!sweptCircleCircle(contact, mover, dx, dy, target)) continue;
    if (contact.depth > holeTime) continue;
    fish.active = false;
    fish.delay = RESPAWN_SECONDS;
    bird.caught += 1;
  }

  if (hole >= 0) {
    const pit = floe.holes[hole] as Hole;
    bird.x += dx * holeTime;
    bird.y += dy * holeTime;
    bird.phase = 'dunk';
    bird.dunk = DUNK_SECONDS;
    bird.dunkX = pit.x;
    bird.dunkY = pit.y;
    bird.speed = 0;
    bird.charge = 0;
    bird.lastDirX = 0;
    bird.lastDirY = 0;
    bird.dunks += 1;
    bird.caught = Math.max(0, bird.caught - DUNK_COST);
    bird.flash = 1;
    return true;
  }

  bird.x += dx;
  bird.y += dy;
  return false;
}

/**
 * One step of a slide, integrated analytically.
 *
 * **The travel is the integral of the decay, not `v · dt`.** Under `v(t) = v₀ · GLIDE^t`
 * a bird covers `(v_before - v_after) / GLIDE_RATE` in a step, and those terms telescope:
 * a whole slide totals `(v₀ - STOP_SPEED) / GLIDE_RATE` however finely it is sliced.
 * Forward Euler instead overshoots by `dt · GLIDE_RATE / 2` — measured 3.97% at 30 Hz,
 * 2.02% at 60 Hz and 1.05% at 120 Hz — which makes the same slide a different slide on a
 * 120 Hz phone, and puts {@link REACH}, which the bot consults on every release decision,
 * permanently 2% out. That is the defect commit b4af006 found in five games, and no amount
 * of tier tuning reaches a systematic bias.
 *
 * The last step coasts the exact distance left to the stop line and stands the bird up
 * there, so where a slide finishes does not depend on which step crossed it.
 */
function stepSlide(bird: Bird, dt: number): number {
  const speed = bird.speed;
  if (speed <= STOP_SPEED) {
    bird.speed = 0;
    return 0;
  }
  const next = speed * Math.pow(GLIDE, dt);
  if (next <= STOP_SPEED) {
    bird.speed = 0;
    return (speed - STOP_SPEED) / GLIDE_RATE;
  }
  bird.speed = next;
  return (speed - next) / GLIDE_RATE;
}

/**
 * Walk a bird, or slide it, or fish it out of the water.
 *
 * The three phases are exclusive and a slide reads no input at all: "release it to slide
 * on the ice" is a commitment or it is nothing. What that buys is that both instruments
 * spend a slide doing exactly the same thing — waiting — so neither is asked for
 * anything the other cannot give.
 */
function driveSeat(game: Game, seat: SeatId, command: Readonly<Command>, dt: number): void {
  const floe = floeOf(game, seat);
  const bird = floe.bird;
  bird.prevX = bird.x;
  bird.prevY = bird.y;
  if (bird.flash > 0) bird.flash = Math.max(0, bird.flash - dt);

  if (bird.phase === 'dunk') {
    bird.dunk -= dt;
    if (bird.dunk <= 0) {
      bird.dunk = 0;
      bird.phase = 'walk';
      bird.x = homeX();
      bird.y = homeY(seat);
      bird.prevX = bird.x;
      bird.prevY = bird.y;
    }
    return;
  }

  if (bird.phase === 'slide') {
    const travel = stepSlide(bird, dt);
    const wantX = bird.x + bird.slideX * travel;
    const wantY = bird.y + bird.slideY * travel;
    const endX = clamp(wantX, minX(), maxX());
    const endY = clamp(wantY, minY(seat), maxY(seat));
    const stopped = endX !== wantX || endY !== wantY;
    const wet = advance(game, seat, endX - bird.x, endY - bird.y);
    if (wet) return;
    // The rim is packed snow: a slide into it stops dead rather than bouncing, which
    // keeps a long slide a commitment rather than a lottery.
    if (stopped || bird.speed === 0) {
      bird.speed = 0;
      bird.phase = 'walk';
      bird.charge = 0;
    }
    return;
  }

  const moving = command.dirX !== 0 || command.dirY !== 0;
  if (!moving) {
    const tier = tierFor(bird.charge);
    if (tier >= 0 && (bird.lastDirX !== 0 || bird.lastDirY !== 0)) {
      bird.phase = 'slide';
      bird.speed = (TIERS[tier] as Tier).launch;
      bird.slideX = bird.lastDirX;
      bird.slideY = bird.lastDirY;
      bird.slides += 1;
    }
    bird.charge = 0;
    return;
  }

  bird.lastDirX = command.dirX;
  bird.lastDirY = command.dirY;
  bird.charge += dt;
  const stride = WALK_SPEED * dt;
  const endX = clamp(bird.x + command.dirX * stride, minX(), maxX());
  const endY = clamp(bird.y + command.dirY * stride, minY(seat), maxY(seat));
  advance(game, seat, endX - bird.x, endY - bird.y);
}

function stepFish(game: Game, seat: SeatId, dt: number): void {
  const floe = floeOf(game, seat);
  for (let i = 0; i < floe.fish.length; i += 1) {
    const fish = floe.fish[i] as Fish;
    if (fish.active) continue;
    fish.delay -= dt;
    if (fish.delay <= 0) surface(game, seat, fish);
  }
}

/**
 * Who has won, or null while the match is still on.
 *
 * Thirty fish goes through the SDK's `first-to`, which is the shared spelling of the
 * observed rule and is also what makes two birds crossing thirty in the same step a draw
 * rather than a win for whichever seat the loop reached first — both floes are stepped
 * before either score is read.
 *
 * The whistle is settled here rather than by passing `timeExpired`, because this game
 * has a tiebreak the helper has no way to know about: level on fish, the bird that fell
 * in **fewer** times takes it. A score is one of thirty-one values and two players of the
 * same standard sit on the same one often.
 */
function judge(game: Game): void {
  tally.p1 = game.p1.bird.caught;
  tally.p2 = game.p2.bird.caught;
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
  const d1 = game.p1.bird.dunks;
  const d2 = game.p2.bird.dunks;
  if (d1 !== d2) {
    game.winner = d1 < d2 ? 'p1' : 'p2';
    return;
  }
  game.winner = 'draw';
}

/** One fixed step. Deterministic, and allocates nothing. */
export function step(
  game: Game,
  dt: number,
  p1Command: Readonly<Command>,
  p2Command: Readonly<Command>,
): void {
  if (game.winner !== null) return;

  driveSeat(game, 'p1', p1Command, dt);
  driveSeat(game, 'p2', p2Command, dt);
  stepFish(game, 'p1', dt);
  stepFish(game, 'p2', dt);

  game.clock = Math.max(0, game.clock - dt);
  judge(game);
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/* ------------------------------------------------------------------------------------ */
/* Geometry the bot and the tests share                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * The eight headings, in the **seat's own frame**, and the order is the tie-break.
 *
 * Written seat-relative and multiplied by {@link seatAxisSign} rather than chosen in
 * board coordinates, for the reason Snowball Throw's `dodgeSide` records: a preference
 * expressed in board coordinates is not covariant under the half-turn, so two mirrored
 * boards break an exact tie the same way instead of the opposite way, and one seat
 * quietly plays a better game. Index 0 is "toward the middle of the device", which is
 * the same move for both players.
 *
 * A human's heading lands on exactly these nine vectors too — the pointer and the keys
 * both produce a per-axis sign, and a diagonal is normalised through the same
 * `Math.SQRT1_2` — so a bot cannot steer anywhere a player could not.
 */
const D = Math.SQRT1_2;
export const HEADINGS: readonly { readonly x: number; readonly y: number }[] = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: D, y: -D }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: D, y: D }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -D, y: D }),
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: -D, y: -D }),
]);

/** How far a bird may travel along `(dx, dy)` before its centre leaves the floe. */
export function rimAlong(seat: SeatId, x: number, y: number, dx: number, dy: number): number {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (maxX() - x) / dx);
  else if (dx < 0) t = Math.min(t, (minX() - x) / dx);
  if (dy > 0) t = Math.min(t, (maxY(seat) - y) / dy);
  else if (dy < 0) t = Math.min(t, (minY(seat) - y) / dy);
  return t < 0 ? 0 : t;
}

/**
 * How far along `(dx, dy)` before the bird's centre crosses a hole's rim, or Infinity.
 *
 * Analytic ray-to-circle rather than marching: exact, allocation-free, and the same
 * answer the swept test in {@link advance} produces, which is the point — a bot that
 * planned with a different arithmetic from the one the game steps would be aiming at a
 * different board.
 */
export function holeAlong(
  floe: Readonly<Floe>,
  x: number,
  y: number,
  dx: number,
  dy: number,
): number {
  let best = Infinity;
  for (let i = 0; i < floe.holes.length; i += 1) {
    const pit = floe.holes[i] as Hole;
    const ox = pit.x - x;
    const oy = pit.y - y;
    const c = ox * ox + oy * oy - HOLE_RADIUS * HOLE_RADIUS;
    if (c <= 0) return 0;
    const b = ox * dx + oy * dy;
    if (b <= 0) continue;
    const disc = b * b - c;
    if (disc < 0) continue;
    const hit = b - Math.sqrt(disc);
    if (hit < best) best = hit;
  }
  return best;
}

/** How many fish sit within reach of the line from `(x, y)` along `(dx, dy)`, up to `span`. */
export function fishAlong(
  floe: Readonly<Floe>,
  x: number,
  y: number,
  dx: number,
  dy: number,
  span: number,
): number {
  let n = 0;
  for (let i = 0; i < floe.fish.length; i += 1) {
    const fish = floe.fish[i] as Fish;
    if (!fish.active) continue;
    const ox = fish.x - x;
    const oy = fish.y - y;
    const along = ox * dx + oy * dy;
    if (along < 0 || along > span) continue;
    const perp = Math.abs(ox * dy - oy * dx);
    if (perp <= PICKUP_RADIUS) n += 1;
  }
  return n;
}

/** The distance from `(x, y)` to the nearest fish on this floe, or Infinity. */
export function nearestFish(floe: Readonly<Floe>, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < floe.fish.length; i += 1) {
    const fish = floe.fish[i] as Fish;
    if (!fish.active) continue;
    const gap = Math.hypot(fish.x - x, fish.y - y);
    if (gap < best) best = gap;
  }
  return best;
}

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * Three knobs, and each of them is a different thing a person is better or worse at.
 *
 * Nothing here is information a player does not have. Every fish, every hole and the
 * bird's own wind-up are on the board and drawn — the wind-up as three pips over the
 * bird's head, precisely so that reading an opponent's commitment is a skill and not a
 * privilege. What a weaker tier is denied is attention, care and patience, never sight,
 * and every heading it picks is one of the nine a player has.
 */
export interface BotProfile {
  /**
   * Seconds between decisions. Between them it holds the heading it chose — which is why
   * a slower tier walks further on a stale plan and falls in more often.
   *
   * Monotone across its useful range: 77.8, 74.6, 74.5, 66.5, 59.8, 43.0 and 21.0 per
   * cent won against an untouched `normal` at 0.10, 0.14, 0.18, 0.26, 0.38, 0.55 and 0.80
   * seconds, 1000 seeds a row — the 0.14/0.18 pair inverted by 0.1 of a point, which is
   * well inside the 1.4-point standard error of the sample.
   */
  readonly think: number;
  /**
   * How often a decision comes out as nothing at all: it looks up and sees no change.
   *
   * A blunder rate rather than an aim error, and that is a measurement rather than a
   * preference: a blunder is not a direction, so it cannot double as a tactic the way
   * Snowball Throw's aim error and Cup Pong's `wander` both did. Monotone by construction
   * and monotone when measured — 74.1, 74.3, 74.5, 68.3, 63.1, 44.0 and 9.9 per cent won
   * against an untouched `normal` at 0, 0.03, 0.07, 0.15, 0.28, 0.5 and 0.75. It is flat
   * below about 0.07, so `hard` sits at the top of a plateau and the tier separation on
   * this knob comes from `normal` and `easy`.
   */
  readonly blunder: number;
  /**
   * Seconds past the tier it was holding out for that it will wait for a good line.
   *
   * The strongest knob and also the termination guarantee — see {@link wantsRelease}.
   * Strictly monotone and saturating: 35.7, 46.9, 56.9, 65.7, 74.5, 86.1 and 93.9 per cent
   * at 0, 0.1, 0.25, 0.45, 0.6, 1.0 and 2.0 seconds. A bot that lets go the instant it has
   * anything is much the weakest, because a slide with nothing on it is a slide spent.
   */
  readonly patience: number;
}

/**
 * The three tiers, and they are deliberately close together.
 *
 * Every one of these is a strong knob on its own — `think` runs from 78% to 21% across its
 * useful range, `blunder` from 74% to 10% and `patience` from 36% to 94% — and three strong
 * knobs pulled apart by intuition compound into a ladder nobody can climb. The shipped
 * spread buys 93.1 / 79.6 / 76.1 per cent for the stronger tier of each pairing, pooled over
 * both seat orders. SPEC.md carries every sweep.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ think: 0.38, blunder: 0.28, patience: 0.15 }),
  normal: Object.freeze({ think: 0.26, blunder: 0.17, patience: 0.32 }),
  hard: Object.freeze({ think: 0.18, blunder: 0.07, patience: 0.6 }),
});

/** How much the gap between decisions wanders, as a fraction. One draw. */
export const REACTION_WANDER = 0.25;

/**
 * How far ahead a bot insists on clear ice before it is willing to walk somewhere.
 *
 * Not a difficulty knob — every tier uses it, and it is the shape of the game rather
 * than a handicap. Below this a direction is refused outright however many fish sit on
 * it, so no tier ever *walks* knowingly into a hole; the difference between the tiers is
 * what they do with a slide, which is where the game is.
 */
export const WALK_PROBE = 46;

/** Values a bot draws per decision. Always this many, always before any branch. */
export const BOT_DRAWS_PER_DECISION = 3;

export interface BotState {
  cooldown: number;
  /** The heading it is walking, in board coordinates. */
  wantX: number;
  wantY: number;
  /** Whether this cycle's look saw anything. */
  blundering: boolean;
  /** The smallest slide it is prepared to spend this cycle. */
  capTier: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, wantX: 0, wantY: 0, blundering: false, capTier: 0 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.wantX = 0;
  state.wantY = 0;
  state.blundering = false;
  state.capTier = 0;
}

/**
 * Which of the eight headings to walk, and it is the whole of the bot's plan.
 *
 * A heading is walked *and then slid* along, so one choice settles both: the score is
 * the fish a walk of one thinking-interval followed by a slide of the tier it is holding
 * out for would sweep up, with the distance to the nearest fish as the tie-break so that
 * an empty line still points somewhere useful.
 *
 * Every branch is covariant under the half-turn: the headings are seat-relative, the
 * only comparisons are between headings rather than against a board coordinate, and an
 * exact tie keeps the lowest **seat-relative** index.
 */
export function chooseHeading(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
): void {
  const floe = floeOf(game, seat);
  const bird = floe.bird;
  const sign = seatAxisSign(seat);
  const reach = REACH[state.capTier] as number;
  const walkAhead = WALK_SPEED * profile.think;

  // **Planned from the shore while the bird is in the water, and this is not a nicety.**
  //
  // A dunked bird's position is the point at which its centre crossed a rim, so
  // `|bird - hole|` is *exactly* HOLE_RADIUS in exact arithmetic and HOLE_RADIUS ± a few
  // ulps in floating point. `holeAlong`'s inside-test is a hard threshold there, and the
  // two seats accumulate that impact point by adding displacements from opposite ends of
  // the board — so two mirror-image birds land on opposite sides of it, one reading every
  // heading as blocked and the other reading five of eight as clear. Measured: **24 of 60
  // mirrored `hard` matches diverged**, every one of them at a dunk.
  //
  // Planning from where the bird will climb out removes the knife edge outright rather
  // than nudging it, and it is also simply the better decision — the heading it wants is
  // the heading from the shore, not from the bottom of a hole. Afterwards: 0 of 60.
  const fromX = bird.phase === 'dunk' ? homeX() : bird.x;
  const fromY = bird.phase === 'dunk' ? homeY(seat) : bird.y;

  // Infinity when every fish is between spawns, which a single wide slide can produce.
  // The tie-break then contributes nothing rather than NaN, and the fish count decides.
  const here = nearestFish(floe, fromX, fromY);
  const empty = !Number.isFinite(here);

  let bestScore = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < HEADINGS.length; i += 1) {
    const heading = HEADINGS[i] as { readonly x: number; readonly y: number };
    const dx = heading.x * sign;
    const dy = heading.y * sign;
    const rim = rimAlong(seat, fromX, fromY, dx, dy);
    const pit = holeAlong(floe, fromX, fromY, dx, dy);
    const room = rim < pit ? rim : pit;
    let score: number;
    if (room < WALK_PROBE) {
      // Nowhere to walk. Ranked by how much room there is, so a bird in a corner still
      // picks the least bad way out rather than the first one it happens to test.
      score = room - 10000;
    } else {
      const span = Math.min(room, walkAhead + reach);
      const probe = nearestFish(floe, fromX + dx * WALK_PROBE, fromY + dy * WALK_PROBE);
      score = fishAlong(floe, fromX, fromY, dx, dy, span) * 400 + (empty ? 0 : here - probe);
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  const chosen = HEADINGS[bestIndex] as { readonly x: number; readonly y: number };
  state.wantX = chosen.x * sign;
  state.wantY = chosen.y * sign;
}

/**
 * Whether to let go this step.
 *
 * It counts **down to a moment it cannot miss** as well as watching for one. Waiting for
 * a line that never comes is how a real-time bot deadlocks — Cup Pong's needle bot swept
 * for ever on the second seed it was given — so `patience` past the tier it wanted forces
 * the release whatever the ice looks like. A forced release into a hole is a dunk, and a
 * dunk puts the bird back on its own shore, so the countdown cannot trap it either.
 *
 * The slide is planned along `lastDir`, which is the heading the launch will actually
 * use, never along the heading the bot has just decided to take next.
 */
export function wantsRelease(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: Readonly<BotState>,
): boolean {
  const floe = floeOf(game, seat);
  const bird = floe.bird;
  if (bird.phase !== 'walk') return false;
  const tier = tierFor(bird.charge);
  if (tier < 0) return false;
  const forced = bird.charge >= (TIERS[state.capTier] as Tier).windUp + profile.patience;
  if (state.blundering) return forced;
  if (tier < state.capTier) return forced;
  const dx = bird.lastDirX;
  const dy = bird.lastDirY;
  if (dx === 0 && dy === 0) return forced;

  const reach = REACH[tier] as number;
  // Never slide into water on purpose: the hole is what this game is about, and this is
  // the shape of the game rather than a handicap — a fourth knob that padded this
  // clearance per tier measured **completely flat**, 65 to 67 per cent won at every value
  // from −20 to +90 units, and was deleted. What separates the tiers on dunks is not a
  // dial at all: it is `think` and `blunder` leaving a bird walking on a stale heading.
  if (reach > holeAlong(floe, bird.x, bird.y, dx, dy)) return forced;
  const span = Math.min(reach, rimAlong(seat, bird.x, bird.y, dx, dy));
  if (fishAlong(floe, bird.x, bird.y, dx, dy, span) > 0) return true;
  return forced;
}

/**
 * Decide where to walk and whether to let go. Allocation-free; writes into `out`.
 *
 * A bot steers through the same nine headings and the same {@link WALK_SPEED} a person
 * gets, so it cannot walk anywhere a player could not have walked, and it releases
 * through the same standstill.
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
  state.cooldown -= dt;
  if (state.cooldown <= 0) {
    // All three drawn up front, unconditionally, so the count can never depend on the ice.
    const jitter = rng.float();
    const blunderRoll = rng.float();
    const tierRoll = rng.float();
    state.cooldown = profile.think * (1 + (jitter * 2 - 1) * REACTION_WANDER);
    state.blundering = blunderRoll < profile.blunder;
    state.capTier = Math.min(TIERS.length - 1, Math.floor(tierRoll * TIERS.length));
    if (!state.blundering) chooseHeading(game, seat, profile, state);
  }

  if (wantsRelease(game, seat, profile, state)) {
    out.dirX = 0;
    out.dirY = 0;
    return;
  }
  out.dirX = state.wantX;
  out.dirY = state.wantY;
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
