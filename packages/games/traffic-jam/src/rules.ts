import { circleAabb, circleCircle, createContact } from '@duelbox/engine';
import type { Aabb, Circle, Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Traffic Jam, as pure rules.
 *
 * A crossroads standing in open water, a car each, and lorries running the two roads. A
 * car never stops: the one thing a seat says to it is *which way to point*, and it drives
 * there. Shoulder the other car off the tarmac and the water takes it; drive off yourself
 * and it takes you instead. Three in the water wins.
 *
 * Five decisions shape everything below, and each is argued where it lives:
 *
 *  - **One shared island, not two lanes** ({@link onRoad}). The whole point of the game is
 *    that the two cars can touch, so unlike the other `rt-race` games there is no per-seat
 *    window at all: both seats read the identical board, which is what makes rule 9 true by
 *    construction rather than by matching two pictures up.
 *  - **A car is a disc that always moves** ({@link stepCar}). Steering is a *rate*, so a
 *    finger, a key and a bot all turn the car at exactly {@link TURN_RATE} and none of them
 *    can point it somewhere sooner than another. Nothing can hold still, which is half the
 *    pressure of the game and most of the termination argument.
 *  - **Traffic arrives in 180°-symmetric pairs** ({@link spawnTraffic}). Every lorry has a
 *    twin on the opposite side of the same road, mirrored through the junction. So the
 *    hazard field is *identical for both seats at every instant* — not similar, not fair on
 *    average, the same board rotated onto itself.
 *  - **The flood closes the island in** ({@link floodedArena}). The road shrinks over
 *    {@link FLOOD_SECONDS} until it is smaller than a car, which is what turns "somebody
 *    ends up in the water" from a hope into arithmetic. See {@link FLOOD_SECONDS}.
 *  - **A splash always scores for the other seat** ({@link stepMatch}), whatever put the car
 *    in. Blame is tracked ({@link Blame}) for the picture and for the balance harness, but
 *    never for the scoreboard: a rule that had to decide whether a lorry counted would need
 *    to decide who nudged whom into the lorry's path, and that question has no clean answer.
 *
 * No rendering, no timing, no DOM. Every length is a logical unit, every duration is in
 * simulated seconds, and the origin is the middle of the junction — the renderer is the only
 * thing that knows where that lands on a device.
 */

/**
 * The logical box the island is drawn into. Declared here so the manifest cannot drift.
 *
 * The simulation itself works in *junction-centred* coordinates: the origin is the middle of
 * the crossroads and +y runs towards the near seat's edge of the device. That is what makes
 * the seat-symmetry argument a one-liner — the whole board is invariant under (x, y) →
 * (−x, −y) — and it is why nothing below ever mentions 600 or 1000 again.
 */
export const ARENA_WIDTH = 600;
export const ARENA_HEIGHT = 1000;

/**
 * The car's collision radius.
 *
 * A disc rather than a box, for the same reason Sumo Push uses one: the losing line is
 * "where is its middle", which is the one point of a car a player can judge exactly, and an
 * impulse between two discs needs no angular term to be believable. The drawn body is a
 * little longer than the disc and a little narrower — a bonnet and wings — which is a
 * picture decision; the rule is the disc.
 */
export const CAR_RADIUS = 30;

/**
 * The island at rest: two carriageways crossing at the origin.
 *
 * `ARM_X` and `ARM_Y` are the half-lengths of the side road and the main road, and `BAR` is
 * the half-width both of them share. The two arms differ because the box is portrait and a
 * square island would waste four hundred units of it; the shape is still exactly symmetric
 * under a half turn, which is the only symmetry the seats need.
 *
 * `BAR` is 120 — four car widths across — because a road two cars wide has no room to be
 * shouldered off in, and a road six wide is a field rather than a road.
 */
export const ARM_X = 268;
export const ARM_Y = 462;
export const BAR = 120;

/**
 * What the island shrinks to, and how long it takes.
 *
 * **This is the whole termination guarantee, and it is geometric rather than hopeful.** At
 * full flood every point still on the road is within `hypot(MIN_ARM, MIN_BAR)` = 25.46 units
 * of the junction, which is less than {@link CAR_RADIUS}. Two cars that are not overlapping
 * stand at least `2 * CAR_RADIUS` apart, so at least one of them is at least `CAR_RADIUS`
 * from the origin — and that one is off the road. {@link stepMatch} resolves the car-to-car
 * overlap immediately before it tests for a splash, so the two facts meet: **once the flood
 * is full, every single step puts somebody in the water.**
 *
 * Twenty seconds because that is roughly three passes down the main road at
 * {@link CRUISE_SPEED}: long enough that the opening exchange is fought on a real road,
 * short enough that a pair of cars circling each other are on a lane and a half by the time
 * they have thought about it.
 */
export const MIN_ARM = 18;
export const MIN_BAR = 18;
export const FLOOD_SECONDS = 20;

/** The island as it stands this step. Rewritten in place from the flood; never allocated. */
export interface Arena {
  /** Half-length of the side road, running east–west. */
  armX: number;
  /** Half-length of the main road, running north–south. */
  armY: number;
  /** Half-width of both carriageways. */
  bar: number;
}

export function createArena(): Arena {
  return { armX: ARM_X, armY: ARM_Y, bar: BAR };
}

/** Straight-line interpolation from the road at rest to the road at full flood. */
export function floodedArena(arena: Arena, flood: number): void {
  const t = flood < 0 ? 0 : flood > 1 ? 1 : flood;
  arena.armX = ARM_X + (MIN_ARM - ARM_X) * t;
  arena.armY = ARM_Y + (MIN_ARM - ARM_Y) * t;
  arena.bar = BAR + (MIN_BAR - BAR) * t;
}

/**
 * Whether a point is still on tarmac.
 *
 * The union of the two carriageways, and the only definition of dry land in the game. A
 * point exactly on the kerb counts as on the road, so the losing test below is a strict
 * inequality and a car resting against the kerb is not repeatedly drowned and revived.
 */
export function onRoad(arena: Readonly<Arena>, x: number, y: number): boolean {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  return (ax <= arena.armX && ay <= arena.bar) || (ax <= arena.bar && ay <= arena.armY);
}

/**
 * How far a point is from the water, in units. Negative once it is over the water.
 *
 * The distance to the nearest kerb along an axis rather than the true Euclidean distance to
 * the boundary — which differs only at the four inside corners of the junction, and is what
 * a driver actually reads off the road ahead of them. Both the bot and the tests judge
 * safety with this and nothing else.
 */
export function marginOf(arena: Readonly<Arena>, x: number, y: number): number {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const side = Math.min(arena.armX - ax, arena.bar - ay);
  const main = Math.min(arena.bar - ax, arena.armY - ay);
  return side > main ? side : main;
}

/**
 * Which way to drive to put more road under the car, written into `outSafety`.
 *
 * Whichever carriageway the point is safest on decides it, and then whichever of that
 * carriageway's two constraints is the tighter: hard against a kerb, the answer is straight
 * across the road; near the end of an arm, the answer is back towards the junction. Always a
 * unit vector, and never zero — a point dead in the middle of the junction falls to the tie
 * break and is told to head east along the side road, because from there every direction is
 * equally safe and the answer only has to be *an* answer. `rules.test.ts` pins it, so the
 * tie break cannot drift into returning nothing.
 */
export interface Direction {
  x: number;
  y: number;
}

export function createDirection(): Direction {
  return { x: 0, y: 0 };
}

export function towardSafety(
  out: Direction,
  arena: Readonly<Arena>,
  x: number,
  y: number,
): Direction {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const side = Math.min(arena.armX - ax, arena.bar - ay);
  const main = Math.min(arena.bar - ax, arena.armY - ay);
  // The carriageway with more room to give is the one worth heading for.
  const onSide = side > main;
  const acrossRoom = onSide ? arena.bar - ay : arena.bar - ax;
  const alongRoom = onSide ? arena.armX - ax : arena.armY - ay;
  if (acrossRoom <= alongRoom) {
    // The kerb is the tighter of the two, so cross the road towards its centre line.
    if (onSide) {
      out.x = 0;
      out.y = y > 0 ? -1 : 1;
    } else {
      out.x = x > 0 ? -1 : 1;
      out.y = 0;
    }
    return out;
  }
  // The end of the arm is the tighter, so head back down it towards the junction.
  if (onSide) {
    out.x = x > 0 ? -1 : 1;
    out.y = 0;
  } else {
    out.x = 0;
    out.y = y > 0 ? -1 : 1;
  }
  return out;
}

/**
 * The car's engine, in three numbers.
 *
 * `DRIVE_ACCELERATION / GRIP_FORWARD` is the speed a car settles at with its foot down,
 * which is the only speed anything in this game ever cruises at, so it is named rather than
 * left to be worked out. Both grips are decay **rates** in 1/s, not per-step multipliers:
 * velocity follows `e^(-grip * dt)` and position uses the matching analytic integral, so a
 * second of driving covers the same ground whether it arrived as sixty steps or a hundred
 * and twenty.
 *
 * `GRIP_LATERAL` is the number the whole game is balanced on. A car shoved sideways at
 * `v` slides `v / GRIP_LATERAL` before the tyres have taken it all back, so 2.4 means a
 * clean hit at cruising speed carries the victim 125 units across the road — a little more
 * than the 120 that separates the centre line from the kerb. A shove from the middle of the
 * road is survivable and a shove taken in the outside lane is not, which is exactly the
 * skill the game is asking for.
 */
export const DRIVE_ACCELERATION = 900;
export const GRIP_FORWARD = 3;
export const GRIP_LATERAL = 2.4;
export const CRUISE_SPEED = DRIVE_ACCELERATION / GRIP_FORWARD;

/**
 * How fast a car swings its nose round, in radians a second.
 *
 * The single number that makes this game fair across input families. A finger names a
 * direction by where it has dragged to, a key names one by which key it is, and a bot names
 * one outright — and all three turn the car at exactly this rate. There is nothing to
 * repeat, so there is nothing a keyboard can repeat faster.
 *
 * 3.4 rad/s at {@link CRUISE_SPEED} is a turning circle of 88 units, so a U-turn needs 176
 * of the 240 a carriageway gives you. Turning round on the spot is possible at rest, tight
 * on a full-width road, and impossible once the flood has taken a third of it.
 */
export const TURN_RATE = 3.4;

/**
 * Ceiling on the speed a step may START with.
 *
 * One step must never carry a car further than the distance at which it would have hit
 * something, or a hard shove passes straight through the other car between two discrete
 * tests. At 900 units/s a step at the simulation rate covers 15 units against a contact
 * distance of 60, so there are four steps of margin. The drive's own terminal speed is
 * {@link CRUISE_SPEED}, well under the cap, so a step can never restore speed the cap has
 * just trimmed — only a collision can put a car up here at all.
 */
export const MAX_SPEED = 900;

/**
 * Perfectly elastic between two cars: equal masses swap the part of their velocity along
 * the line of contact.
 *
 * Anything less makes the game quieter without making it more real — a car is not a
 * billiard ball either way — and the whole mechanic is the transfer, so it is not damped.
 */
export const RAM_RESTITUTION = 1;

/**
 * A lorry gives back much less than it takes.
 *
 * A lorry is not pushed by anything, so its restitution is the whole of what a car gets out
 * of the exchange, and it is deliberately low: being hit by traffic should shove a car off
 * its line rather than fire it across the island. A broadside from a lorry at
 * {@link LORRY_SPEED} still lands the car 130 units sideways, which is a kerb's worth.
 */
export const LORRY_RESTITUTION = 0.2;

/**
 * What counts as a hit worth blaming, and how long the blame stands.
 *
 * A car brushing past another at walking pace has not rammed anybody; a car that took 90
 * units/s of closing speed has been hit, and the next second and a half of its life is
 * fairly attributed to whoever hit it. Used for the picture and by the balance harness that
 * counts how often the headline verb actually happens — never by the scoreboard.
 */
export const BLAME_SPEED = 90;
export const BLAME_SECONDS = 1.6;

/** Where each car starts on its own arm, and the seeded spread across the road. */
export const START_ALONG = 330;
export const START_SPREAD = 46;

/**
 * The lorries.
 *
 * 44 units across against a 240-unit road, so two of them abreast leave 152 to share out
 * between up to three gaps — and where those gaps fall is the draw. Roughly two spawns in
 * five leave no gap a car can fit through at all, and the answer then is the other
 * carriageway, or the junction, or taking the hit on purpose to put your rival in the water.
 * That is the puzzle the game is named after.
 */
export const LORRY_HALF_LENGTH = 58;
export const LORRY_HALF_WIDTH = 22;
export const LORRY_SPEED = 240;

/** Slots in the pool: three pairs. Fixed and preallocated, so a spawn never allocates. */
export const TRAFFIC_SLOTS = 6;

/** The innermost lane a lorry may take, so a pair on one road never overlaps its twin. */
export const LANE_MIN = LORRY_HALF_WIDTH + 8;

/** Seconds between spawns, and how much of that is drawn. */
export const SPAWN_FIRST = 1.6;
export const SPAWN_BASE = 2.9;
export const SPAWN_JITTER = 2.2;

/**
 * The road stops taking traffic once the flood has narrowed it to this.
 *
 * Below it the two lanes a pair needs no longer fit, and a lorry on a road narrower than
 * itself is a wall rather than a hazard. Lorries already running are seen out; nothing new
 * joins.
 */
export const TRAFFIC_MIN_BAR = 70;

/** Floats spent on every spawn tick, whatever it goes on to do. See {@link spawnTraffic}. */
export const TRAFFIC_DRAWS_PER_SPAWN = 3;

/** Splashes that win the match, and the steps the board is held after each one. */
export const SPLASH_TARGET = 3;
export const SETTLE_STEPS = 72;

/**
 * The match is called on splashes after this long.
 *
 * A backstop behind the flood, not the mechanism. The arithmetic that matters is the other
 * way round: a bout cannot outlive {@link FLOOD_SECONDS}, a score is awarded at the end of
 * every bout, and {@link SPLASH_TARGET} of 3 is reached in at most five bouts (2–2 and then
 * one more). Five bouts is 5 × 20 s of driving and 4 × 72 steps of settling — **104.8 s at
 * the simulation rate** — so 110 s is above the worst case the rules can produce rather than
 * a number that truncates a legitimate match. `roundSeconds` in the manifest ends nothing
 * at all; it prints a number on the catalogue card. See the note atop `termination.test.ts`.
 */
export const ROUND_SECONDS = 110;

/** What put a car in the water. Never read by the scoreboard; see the module note. */
export type Blame = 'rival' | 'traffic' | 'solo';

export interface Car {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radians; 0 points along +x. The car drives this way whatever its velocity is doing. */
  heading: number;
  /** Read by {@link circleCircle}; constant, but the engine's Circle wants it on the object. */
  radius: number;
  /** True from the step it left the road until the next bout starts. */
  inWater: boolean;
  /** 0 while driving, climbing to 1 across the settle, for the sinking picture. */
  sink: number;
  /** Times this car has gone in, across the whole match. */
  splashes: number;
  /** Who is answerable for the state this car is in, while {@link blameFor} lasts. */
  blame: Blame;
  blameFor: number;
}

export function createCar(): Car {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    heading: 0,
    radius: CAR_RADIUS,
    inWater: false,
    sink: 0,
    splashes: 0,
    blame: 'solo',
    blameFor: 0,
  };
}

/**
 * One lorry, held in polar-ish road coordinates rather than as a position.
 *
 * `along` is how far down its own carriageway it is and `lateral` which lane it is in, which
 * is what makes the twinning in {@link spawnTraffic} a negation of two numbers rather than a
 * rotation matrix — and therefore what makes the 180° symmetry exact instead of nearly.
 */
export interface Lorry {
  active: boolean;
  /** 0 runs east–west along the side road, 1 north–south along the main road. */
  axis: 0 | 1;
  along: number;
  lateral: number;
  /** Signed: which way down the carriageway it is travelling, at {@link LORRY_SPEED}. */
  speed: number;
}

export function createLorry(): Lorry {
  return { active: false, axis: 1, along: 0, lateral: 0, speed: 0 };
}

export function lorryX(lorry: Readonly<Lorry>): number {
  return lorry.axis === 0 ? lorry.along : lorry.lateral;
}

export function lorryY(lorry: Readonly<Lorry>): number {
  return lorry.axis === 0 ? lorry.lateral : lorry.along;
}

export function lorryVX(lorry: Readonly<Lorry>): number {
  return lorry.axis === 0 ? lorry.speed : 0;
}

export function lorryVY(lorry: Readonly<Lorry>): number {
  return lorry.axis === 0 ? 0 : lorry.speed;
}

/** Half-extents of a lorry's box on the world axes. */
export function lorryHalfX(lorry: Readonly<Lorry>): number {
  return lorry.axis === 0 ? LORRY_HALF_LENGTH : LORRY_HALF_WIDTH;
}

export function lorryHalfY(lorry: Readonly<Lorry>): number {
  return lorry.axis === 0 ? LORRY_HALF_WIDTH : LORRY_HALF_LENGTH;
}

export type Phase = 'driving' | 'settling' | 'over';

export interface Match {
  readonly arena: Arena;
  readonly p1: Car;
  readonly p2: Car;
  /** Fixed-length pool. Slots are reused; nothing here is ever allocated mid-match. */
  readonly traffic: Lorry[];
  /** 0 at the start of a bout, 1 once the island is smaller than a car. */
  flood: number;
  /** Seconds until the next pair of lorries is drawn for. */
  spawnIn: number;
  /** Simulated seconds the whole match has run, so it can be called. */
  elapsed: number;
  /** Steps left of the pause after a splash, or 0 while a bout is being driven. */
  settle: number;
  /** What the flood stood at when the settle began, so the water recedes smoothly. */
  settleFrom: number;
  /** Bouts finished, for the harness. */
  bouts: number;
  /** Times this seat has put the *other* car in the water. This is the score. */
  p1Score: number;
  p2Score: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
}

export function createMatch(): Match {
  const traffic: Lorry[] = [];
  for (let i = 0; i < TRAFFIC_SLOTS; i += 1) traffic.push(createLorry());
  return {
    arena: createArena(),
    p1: createCar(),
    p2: createCar(),
    traffic,
    flood: 0,
    spawnIn: SPAWN_FIRST,
    elapsed: 0,
    settle: 0,
    settleFrom: 0,
    bouts: 0,
    p1Score: 0,
    p2Score: 0,
    phase: 'driving',
    winner: null,
  };
}

export function carOf(match: Readonly<Match>, seat: SeatId): Car {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function scoreOf(match: Readonly<Match>, seat: SeatId): number {
  return seat === 'p1' ? match.p1Score : match.p2Score;
}

/** Clear every lorry out of the pool. Cheap, and the only way a bout starts empty. */
export function clearTraffic(traffic: Lorry[]): void {
  for (let i = 0; i < traffic.length; i += 1) {
    const lorry = traffic[i];
    if (lorry === undefined) continue;
    lorry.active = false;
  }
}

/**
 * Put both cars back on their arms and empty the roads.
 *
 * **One draw, spent on a lateral offset both cars share through the half turn.** p1 starts
 * `spread` to one side of the main road's centre line and p2 exactly `spread` to the other,
 * so whatever the draw does it does to both of them: neither seat can be handed the inside
 * line. Without the offset every bout would open with a dead-straight head-on, which is the
 * one exchange in this game that has no answer.
 */
export function placeCars(match: Match, rng: Rng): void {
  const spread = (rng.float() * 2 - 1) * START_SPREAD;
  const p1 = match.p1;
  // +y is the near seat's edge of the device, so p1 starts down the main road from the
  // junction and points back up it.
  p1.x = spread;
  p1.y = START_ALONG;
  p1.vx = 0;
  p1.vy = 0;
  p1.heading = -Math.PI / 2;
  p1.inWater = false;
  p1.sink = 0;
  p1.blame = 'solo';
  p1.blameFor = 0;
  const p2 = match.p2;
  p2.x = -spread;
  p2.y = -START_ALONG;
  p2.vx = 0;
  p2.vy = 0;
  p2.heading = Math.PI / 2;
  p2.inWater = false;
  p2.sink = 0;
  p2.blame = 'solo';
  p2.blameFor = 0;
}

/** Start a fresh bout: cars on their marks, roads empty, water back out to the kerbs. */
export function beginBout(match: Match, rng: Rng): void {
  match.flood = 0;
  floodedArena(match.arena, 0);
  match.spawnIn = SPAWN_FIRST;
  match.settle = 0;
  match.settleFrom = 0;
  match.phase = 'driving';
  clearTraffic(match.traffic);
  placeCars(match, rng);
}

/**
 * Put the match back to nothing, leaving the generator alone.
 *
 * Separate from {@link resetMatch} because tearing a match down is not the same as starting
 * one: `destroy` has to leave nothing behind, but placing the cars on the way out would
 * spend a draw from the host's generator after the match it belongs to has finished.
 */
export function clearMatch(match: Match): void {
  match.flood = 0;
  floodedArena(match.arena, 0);
  match.spawnIn = SPAWN_FIRST;
  match.elapsed = 0;
  match.settle = 0;
  match.settleFrom = 0;
  match.bouts = 0;
  match.p1Score = 0;
  match.p2Score = 0;
  match.phase = 'driving';
  match.winner = null;
  clearTraffic(match.traffic);
  const p1 = match.p1;
  const p2 = match.p2;
  p1.splashes = 0;
  p2.splashes = 0;
  p1.x = 0;
  p1.y = 0;
  p1.vx = 0;
  p1.vy = 0;
  p1.heading = -Math.PI / 2;
  p1.inWater = false;
  p1.sink = 0;
  p1.blame = 'solo';
  p1.blameFor = 0;
  p2.x = 0;
  p2.y = 0;
  p2.vx = 0;
  p2.vy = 0;
  p2.heading = Math.PI / 2;
  p2.inWater = false;
  p2.sink = 0;
  p2.blame = 'solo';
  p2.blameFor = 0;
}

/** A fresh match on the marks. The only place a match spends a draw before it is driven. */
export function resetMatch(match: Match, rng: Rng): void {
  clearMatch(match);
  beginBout(match, rng);
}

/** Fold an angle into (−π, π]. */
export function wrapAngle(radians: number): number {
  const turn = Math.PI * 2;
  let folded = radians % turn;
  if (folded > Math.PI) folded -= turn;
  else if (folded <= -Math.PI) folded += turn;
  return folded;
}

/**
 * Turn `heading` towards the direction `(wantX, wantY)` names, by at most `most` radians.
 *
 * Every source of steering in the game goes through this — a finger, a key and a bot — so
 * none of them can point a car somewhere faster than another. A direction of no length at
 * all, or one containing a number that is not a number, means *hold this line*: the pointer
 * positions a browser produces are not always numbers a game would choose, and a car with
 * nobody asking anything of it should keep driving rather than snap to zero radians.
 */
export function turnToward(heading: number, wantX: number, wantY: number, most: number): number {
  if (!Number.isFinite(wantX) || !Number.isFinite(wantY)) return heading;
  if (wantX === 0 && wantY === 0) return heading;
  const delta = wrapAngle(Math.atan2(wantY, wantX) - heading);
  if (delta > most) return wrapAngle(heading + most);
  if (delta < -most) return wrapAngle(heading - most);
  return wrapAngle(heading + delta);
}

/**
 * Drive one car for a step.
 *
 * The heading is settled first and then held for the whole step, so the translation below is
 * integrated in a frame that does not move: forward speed relaxes towards
 * {@link CRUISE_SPEED} and sideways speed decays to nothing, both with their exact analytic
 * integrals rather than by forward Euler. A second of driving therefore covers the same
 * ground at any step size — `rules.test.ts` asserts that to twelve places for a car that is
 * not turning, which is every straight, every slide and the whole of every collision.
 *
 * While a car *is* turning, sixty steps and a hundred and twenty differ by where the frame
 * was during the step — the residual any rotating body has. The heading is therefore taken
 * at the **middle** of the step rather than at its start, which makes the scheme second
 * order and the residual small enough to name: a car put through a standing U-turn lands the
 * two rates **0.0097 units** apart, on a body 60 units across, and ten seconds of weaving
 * lands them 0.0078 apart. Taking the heading at the start of the step instead — the
 * obvious way to write it — measures 2.58 on the same U-turn, which is two hundred and
 * sixty times worse for one extra call. The shell's loop steps at a fixed 60 Hz on every
 * device regardless, so this is a robustness property rather than a live one.
 */
export function stepCar(car: Car, wantX: number, wantY: number, fixedDeltaSeconds: number): void {
  // Half the turn, then the translation, then the other half: the frame the step is
  // integrated in is the one the car was in half-way through it rather than at its start,
  // which is what makes the scheme second order in the step size. Two half-turns compose
  // to exactly the whole turn, clamping included, so the heading itself is unaffected.
  const most = (TURN_RATE * fixedDeltaSeconds) / 2;
  const midway = turnToward(car.heading, wantX, wantY, most);
  car.heading = turnToward(midway, wantX, wantY, most);

  let vx = car.vx;
  let vy = car.vy;
  const speedSq = vx * vx + vy * vy;
  if (speedSq > MAX_SPEED * MAX_SPEED) {
    const trim = MAX_SPEED / Math.sqrt(speedSq);
    vx *= trim;
    vy *= trim;
  }

  const cos = Math.cos(midway);
  const sin = Math.sin(midway);
  const forward = vx * cos + vy * sin;
  const lateral = -vx * sin + vy * cos;

  // Forward: v' = DRIVE_ACCELERATION − GRIP_FORWARD · v, solved over the whole step.
  const decayF = Math.exp(-GRIP_FORWARD * fixedDeltaSeconds);
  const travelF = (1 - decayF) / GRIP_FORWARD;
  const alongStep = CRUISE_SPEED * fixedDeltaSeconds + (forward - CRUISE_SPEED) * travelF;
  const forwardNext = CRUISE_SPEED + (forward - CRUISE_SPEED) * decayF;

  // Sideways: v' = −GRIP_LATERAL · v. The tyres take a slide back; nothing drives it.
  const decayL = Math.exp(-GRIP_LATERAL * fixedDeltaSeconds);
  const acrossStep = (lateral * (1 - decayL)) / GRIP_LATERAL;
  const lateralNext = lateral * decayL;

  car.x += alongStep * cos - acrossStep * sin;
  car.y += alongStep * sin + acrossStep * cos;
  car.vx = forwardNext * cos - lateralNext * sin;
  car.vy = forwardNext * sin + lateralNext * cos;
}

/** Let the blame for a knock lapse. A car nobody has touched for a while is on its own. */
export function ageBlame(car: Car, fixedDeltaSeconds: number): void {
  if (car.blameFor <= 0) return;
  car.blameFor -= fixedDeltaSeconds;
  if (car.blameFor > 0) return;
  car.blameFor = 0;
  car.blame = 'solo';
}

/** Scratch, held at module scope so a step allocates nothing (rule 5). */
const contact = createContact();
const lorryBox: Aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const carDisc: Circle = { x: 0, y: 0, radius: CAR_RADIUS };

/**
 * Resolve the two cars against each other, and report whether it was a proper hit.
 *
 * The overlap is undone before the impulse and shared evenly, so a pair that arrives
 * overlapping never ends the step still overlapping and grinding — which is also the fact
 * the flood's termination guarantee leans on. The impulse is proportional to the closing
 * speed, which is what makes a charge shove harder than a lean, and with equal masses and
 * {@link RAM_RESTITUTION} of 1 it is exactly the swap of the two cars' velocity along the
 * line between them.
 *
 * Blame goes on **both** cars, not on the one that came off worse. Two cars that met at 200
 * units/s of closing speed both have the other to thank for where they end up, and deciding
 * which of them was the aggressor would need an intent the simulation does not have — while
 * blaming only the slower one would quietly hand the seat that reversed into a fight a
 * different rule from the seat that drove into it.
 */
export function collideCars(a: Car, b: Car): boolean {
  if (!circleCircle(contact, a, b)) return false;

  const nx = contact.normalX;
  const ny = contact.normalY;
  const half = contact.depth / 2;
  if (half > 0) {
    a.x += nx * half;
    a.y += ny * half;
    b.x -= nx * half;
    b.y -= ny * half;
  }

  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  // Already separating: an impulse here would pull them back together.
  if (closing >= 0) return false;

  const impulse = (-(1 + RAM_RESTITUTION) * closing) / 2;
  a.vx += impulse * nx;
  a.vy += impulse * ny;
  b.vx -= impulse * nx;
  b.vy -= impulse * ny;

  if (-closing < BLAME_SPEED) return false;
  a.blame = 'rival';
  a.blameFor = BLAME_SECONDS;
  b.blame = 'rival';
  b.blameFor = BLAME_SECONDS;
  return true;
}

/**
 * Resolve one car against one lorry, and report whether it was a proper hit.
 *
 * A lorry has no mass in the equation: it is not moved, not slowed and not turned, which is
 * the whole of what makes it traffic rather than a third player. What the car receives is
 * the closing speed *relative to the lorry*, so being caught by a moving lorry is very
 * different from driving into a parked one — and a car running alongside one at the same
 * speed is not hit at all.
 */
export function collideLorry(car: Car, lorry: Readonly<Lorry>): boolean {
  if (!lorry.active) return false;
  const hx = lorryHalfX(lorry);
  const hy = lorryHalfY(lorry);
  const lx = lorryX(lorry);
  const ly = lorryY(lorry);
  lorryBox.minX = lx - hx;
  lorryBox.maxX = lx + hx;
  lorryBox.minY = ly - hy;
  lorryBox.maxY = ly + hy;
  carDisc.x = car.x;
  carDisc.y = car.y;
  carDisc.radius = car.radius;
  if (!circleAabb(contact, carDisc, lorryBox)) return false;

  const nx = contact.normalX;
  const ny = contact.normalY;
  car.x += nx * contact.depth;
  car.y += ny * contact.depth;

  const closing = (car.vx - lorryVX(lorry)) * nx + (car.vy - lorryVY(lorry)) * ny;
  if (closing >= 0) return false;

  const impulse = -(1 + LORRY_RESTITUTION) * closing;
  car.vx += impulse * nx;
  car.vy += impulse * ny;

  if (-closing < BLAME_SPEED) return false;
  car.blame = 'traffic';
  car.blameFor = BLAME_SECONDS;
  return true;
}

/**
 * Draw for the next pair of lorries.
 *
 * **Three floats every time the timer fires, whatever comes of them.** A tick that drew only
 * when it had somewhere to put a lorry would make the length of the random stream depend on
 * how full the pool happened to be, and a stream that depends on the state of the board is a
 * stream two otherwise identical matches can fall out of step on. Racing Cars learned the
 * same lesson from Fruit Duel, which handed p1 thirty wins in forty from exactly this.
 *
 * The pair itself is the fairness argument. One lorry enters at the far end of a carriageway
 * and its twin at the near end of the same one, in the opposite lane, driving the other way
 * — which is precisely the first lorry rotated half a turn about the junction. So the whole
 * board, cars included, is invariant under that rotation at every instant of every bout:
 * whatever traffic one seat is facing, the other is facing the same traffic from the other
 * end. That is stronger than two seats drawing from one sequence, because there is only one
 * board and it is its own mirror.
 */
export function spawnTraffic(match: Match, rng: Rng): boolean {
  const road = rng.float();
  const lane = rng.float();
  const wait = rng.float();
  match.spawnIn = SPAWN_BASE + wait * SPAWN_JITTER;

  const arena = match.arena;
  if (arena.bar < TRAFFIC_MIN_BAR) return false;

  const traffic = match.traffic;
  let first = -1;
  let second = -1;
  for (let i = 0; i < traffic.length; i += 1) {
    const slot = traffic[i];
    if (slot === undefined || slot.active) continue;
    if (first < 0) first = i;
    else {
      second = i;
      break;
    }
  }
  if (second < 0) return false;
  const near = traffic[first];
  const far = traffic[second];
  if (near === undefined || far === undefined) return false;

  const axis: 0 | 1 = road < 0.5 ? 1 : 0;
  const arm = axis === 1 ? arena.armY : arena.armX;
  const laneMax = arena.bar - LORRY_HALF_WIDTH;
  const lateral = LANE_MIN + lane * (laneMax - LANE_MIN);
  const entry = arm + LORRY_HALF_LENGTH;

  near.active = true;
  near.axis = axis;
  near.along = entry;
  near.lateral = lateral;
  near.speed = -LORRY_SPEED;

  far.active = true;
  far.axis = axis;
  far.along = -entry;
  far.lateral = -lateral;
  far.speed = LORRY_SPEED;
  return true;
}

/**
 * Run the traffic for a step: spawn if the timer is out, roll everything on, retire what has
 * left the island.
 *
 * A lorry retires at the far end of its own carriageway, and also the moment the flood has
 * narrowed the road out from under its lane. The second case is what keeps the picture
 * honest as the water closes in — traffic thins out and then stops, which is what a driver
 * needs to know before the last of the road goes.
 */
export function stepTraffic(match: Match, fixedDeltaSeconds: number, rng: Rng): void {
  match.spawnIn -= fixedDeltaSeconds;
  if (match.spawnIn <= 0) spawnTraffic(match, rng);

  const arena = match.arena;
  const traffic = match.traffic;
  for (let i = 0; i < traffic.length; i += 1) {
    const lorry = traffic[i];
    if (lorry === undefined || !lorry.active) continue;
    lorry.along += lorry.speed * fixedDeltaSeconds;
    const arm = lorry.axis === 1 ? arena.armY : arena.armX;
    const reach = arm + LORRY_HALF_LENGTH + 4;
    const drowned = Math.abs(lorry.lateral) + LORRY_HALF_WIDTH > arena.bar;
    if (Math.abs(lorry.along) > reach || drowned) lorry.active = false;
  }
}

/**
 * The match, as the SDK spells it: first to three in the water, and the clock settles it
 * otherwise.
 *
 * Held at module scope and rewritten rather than built per call, so judging a step costs no
 * garbage. `resolve` is the shared helper every game decides with, so "first to three",
 * "both got there on the same step" and "level when the clock ran out" all mean exactly what
 * they mean everywhere else in the catalogue.
 */
const CONDITION: WinCondition = { kind: 'first-to', target: SPLASH_TARGET };
const tally = { p1: 0, p2: 0 };
const judgeOptions = { timeExpired: false };

export function judge(match: Readonly<Match>): SeatId | 'draw' | null {
  tally.p1 = match.p1Score;
  tally.p2 = match.p2Score;
  judgeOptions.timeExpired = match.elapsed >= ROUND_SECONDS;
  return resolve(CONDITION, tally, judgeOptions);
}

export interface StepReport {
  /** True on the one step a car left the road. */
  readonly p1Splashed: boolean;
  readonly p2Splashed: boolean;
  /** True on a step the two cars hit each other above {@link BLAME_SPEED}. */
  readonly rammed: boolean;
  /** True on a step a lorry hit a car above {@link BLAME_SPEED}. */
  readonly bumped: boolean;
  /** True on the step a bout ended, whichever way. */
  readonly boutOver: boolean;
}

const report = {
  p1Splashed: false,
  p2Splashed: false,
  rammed: false,
  bumped: false,
  boutOver: false,
};

/**
 * One fixed step of the whole match.
 *
 * The order is the argument. The flood advances first so the entire step agrees about where
 * the water is; traffic then runs; both cars are driven; each car is resolved against every
 * lorry; **the two cars are resolved against each other last**; and only then is the road
 * tested. That last pairing is what the termination guarantee needs — see
 * {@link FLOOD_SECONDS} — because a car pushed by a lorry after the cars had been separated
 * could be back inside its rival, and then "the two are at least a diameter apart" would no
 * longer be true when it is being relied on.
 *
 * Both cars are driven before either is judged, so a step in which both go in is the double
 * it actually is rather than a point for whichever seat the loop happened to run first.
 */
export function stepMatch(
  match: Match,
  fixedDeltaSeconds: number,
  p1WantX: number,
  p1WantY: number,
  p2WantX: number,
  p2WantY: number,
  rng: Rng,
): StepReport {
  report.p1Splashed = false;
  report.p2Splashed = false;
  report.rammed = false;
  report.bumped = false;
  report.boutOver = false;
  if (match.phase === 'over') return report;

  match.elapsed += fixedDeltaSeconds;

  if (match.phase === 'settling') {
    match.settle -= 1;
    // A weighted blend rather than from − rate · t, so the last step of the countdown lands
    // on a dry island exactly, whatever the flood had reached.
    const left = match.settle / SETTLE_STEPS;
    match.flood = match.settleFrom * left;
    floodedArena(match.arena, match.flood);
    const sunk = 1 - left;
    if (match.p1.inWater) match.p1.sink = sunk;
    if (match.p2.inWater) match.p2.sink = sunk;
    if (match.settle <= 0) beginBout(match, rng);
    return finish(match);
  }

  match.flood += fixedDeltaSeconds / FLOOD_SECONDS;
  if (match.flood > 1) match.flood = 1;
  floodedArena(match.arena, match.flood);

  stepTraffic(match, fixedDeltaSeconds, rng);

  ageBlame(match.p1, fixedDeltaSeconds);
  ageBlame(match.p2, fixedDeltaSeconds);
  stepCar(match.p1, p1WantX, p1WantY, fixedDeltaSeconds);
  stepCar(match.p2, p2WantX, p2WantY, fixedDeltaSeconds);

  const traffic = match.traffic;
  for (let i = 0; i < traffic.length; i += 1) {
    const lorry = traffic[i];
    if (lorry === undefined || !lorry.active) continue;
    if (collideLorry(match.p1, lorry)) report.bumped = true;
    if (collideLorry(match.p2, lorry)) report.bumped = true;
  }
  if (collideCars(match.p1, match.p2)) report.rammed = true;

  const arena = match.arena;
  const outP1 = !onRoad(arena, match.p1.x, match.p1.y);
  const outP2 = !onRoad(arena, match.p2.x, match.p2.y);
  if (!outP1 && !outP2) return finish(match);

  report.p1Splashed = outP1;
  report.p2Splashed = outP2;
  report.boutOver = true;
  match.bouts += 1;
  if (outP1) {
    match.p1.inWater = true;
    match.p1.splashes += 1;
    match.p2Score += 1;
  }
  if (outP2) {
    match.p2.inWater = true;
    match.p2.splashes += 1;
    match.p1Score += 1;
  }
  const outcome = judge(match);
  if (outcome !== null) {
    match.phase = 'over';
    match.winner = outcome;
    return report;
  }
  // The board is held where it stands, so the last thing a player sees of a bout is how it
  // was lost rather than a tidied-up junction.
  match.phase = 'settling';
  match.settle = SETTLE_STEPS;
  match.settleFrom = match.flood;
  return report;
}

/** The clock, checked on every step that did not already end the match. */
function finish(match: Match): StepReport {
  if (match.elapsed < ROUND_SECONDS) return report;
  const outcome = judge(match);
  if (outcome === null) return report;
  match.phase = 'over';
  match.winner = outcome;
  return report;
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks at the junction, and the seconds of stale information it acts on.
   * One number doing both jobs, because they are the same fact: a driver whose eyes were
   * last on the road that long ago both decided then and is still acting on then.
   */
  readonly reaction: number;
  /** Magnitude of the random extra on that delay, so a bot is never metronomic. */
  readonly waver: number;
  /** Radians of noise on the direction it settles on. */
  readonly error: number;
}

/**
 * The three tiers, expressed only as reaction delay, waver and steering error.
 *
 * No tier drives faster, turns harder, sees further or reads anything the seat opposite
 * cannot (rule 6). What separates them is how long they are still holding the last look's
 * answer when the junction has moved on, and how wide of the mark that answer was.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.34, waver: 0.3, error: 0.55 },
  normal: { reaction: 0.2, waver: 0.2, error: 0.32 },
  hard: { reaction: 0.05, waver: 0.05, error: 0.07 },
});

/**
 * How far ahead of itself a bot judges the road, in seconds of its own travel.
 *
 * Identical for all three tiers, deliberately: it is not a handicap but the shape of the
 * judgement every driver makes, and a tier that could see further would be reading something
 * off the board a person cannot. At {@link CRUISE_SPEED} it is 180 units of road, which is
 * about two car lengths — exactly the distance at which a person starts turning.
 */
export const BOT_LOOKAHEAD_SECONDS = 0.6;

/** Margin below which a bot stops thinking about its rival and starts thinking about kerbs. */
export const BOT_SAFE_MARGIN = 58;

/**
 * How much nearer the water than itself the rival has to be before a bot presses a charge
 * home from its own edge. Without the margin a bot on the brink charges a rival a hair
 * further out and takes a double splash, which scores for both seats.
 */
export const BOT_CHARGE_MARGIN = 18;

/** A lorry inside this range bends a bot's line, in proportion to how close it is. */
export const BOT_LORRY_RANGE = 175;
export const BOT_LORRY_WEIGHT = 1.4;

/** Floats a bot spends on every look, whatever it goes on to decide. */
export const BOT_DRAWS_PER_LOOK = 2;

export interface BotState {
  /** Seconds until it looks at the junction again. */
  look: number;
  /** The direction it settled on at the last look, which it holds until the next one. */
  wantX: number;
  wantY: number;
}

export function createBotState(): BotState {
  return { look: 0, wantX: 0, wantY: 0 };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.wantX = 0;
  state.wantY = 0;
}

/** Scratch for the bot, at module scope so a look allocates nothing. */
const safety = createDirection();
const rivalSafety = createDirection();

/**
 * Where a bot points its car this step.
 *
 * It reads three things, all of them on the screen in front of both players: the island as
 * it stands, the lorries, and where the rival was {@link BotProfile.reaction} seconds ago.
 * It has no lookahead into the generator, no knowledge of what the other seat is asking for,
 * and no way to turn faster than {@link TURN_RATE}, because there is no such way.
 *
 * The decision is three lines in order of urgency:
 *
 *  1. **Am I about to be in the water?** Judged from where the car will be in
 *     {@link BOT_LOOKAHEAD_SECONDS}, not from where it is — which is what a person means by
 *     looking ahead, and the only way a car doing 300 units/s can act on a kerb 58 units
 *     away. If so, drive for the middle of the road, unless the rival is even further gone.
 *  2. **Otherwise, get outside them.** It aims not *at* the rival but at the point a car's
 *     width to the rival's safe side, so that arriving means being between them and the
 *     middle of the road with the water beyond them. That is the whole tactic of the game
 *     stated in one vector, and it is the reason a bot match produces rammings at all rather
 *     than two cars nudging each other in the junction.
 *  3. **Is there a lorry in the way?** Bend away from the nearest one within
 *     {@link BOT_LORRY_RANGE}, harder the closer it is.
 *
 * **Both draws are taken on every look, used or not**, for the same reason the traffic's
 * three are.
 */
export function botAim(
  out: Direction,
  match: Readonly<Match>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): Direction {
  state.look -= fixedDeltaSeconds;
  if (state.look > 0) {
    out.x = state.wantX;
    out.y = state.wantY;
    return out;
  }

  const profile = BOT_PROFILES[difficulty];
  const wobble = rng.float();
  const pause = rng.float();
  state.look = profile.reaction + pause * profile.waver;

  const arena = match.arena;
  const self = seat === 'p1' ? match.p1 : match.p2;
  const rival = seat === 'p1' ? match.p2 : match.p1;
  const lag = profile.reaction;
  const rivalX = rival.x - rival.vx * lag;
  const rivalY = rival.y - rival.vy * lag;

  const aheadX = self.x + self.vx * BOT_LOOKAHEAD_SECONDS;
  const aheadY = self.y + self.vy * BOT_LOOKAHEAD_SECONDS;
  const ownMargin = marginOf(arena, aheadX, aheadY);
  const rivalMargin = marginOf(arena, rivalX, rivalY);

  let aimX: number;
  let aimY: number;
  if (ownMargin < BOT_SAFE_MARGIN && rivalMargin > ownMargin - BOT_CHARGE_MARGIN) {
    towardSafety(safety, arena, aheadX, aheadY);
    aimX = safety.x;
    aimY = safety.y;
  } else {
    // The rival's own way out, negated: the side of them the water is on.
    towardSafety(rivalSafety, arena, rivalX, rivalY);
    const targetX = rivalX - rivalSafety.x * CAR_RADIUS;
    const targetY = rivalY - rivalSafety.y * CAR_RADIUS;
    aimX = targetX - self.x;
    aimY = targetY - self.y;
  }

  let nearest = -1;
  let nearestDistSq = BOT_LORRY_RANGE * BOT_LORRY_RANGE;
  const traffic = match.traffic;
  for (let i = 0; i < traffic.length; i += 1) {
    const lorry = traffic[i];
    if (lorry === undefined || !lorry.active) continue;
    const dx = self.x - lorryX(lorry);
    const dy = self.y - lorryY(lorry);
    const distSq = dx * dx + dy * dy;
    if (distSq >= nearestDistSq) continue;
    nearestDistSq = distSq;
    nearest = i;
  }
  if (nearest >= 0) {
    const lorry = traffic[nearest];
    if (lorry !== undefined) {
      const dx = self.x - lorryX(lorry);
      const dy = self.y - lorryY(lorry);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        const push = (1 - dist / BOT_LORRY_RANGE) * BOT_LORRY_WEIGHT;
        const length = Math.sqrt(aimX * aimX + aimY * aimY);
        if (length > 0) {
          aimX /= length;
          aimY /= length;
        }
        aimX += (dx / dist) * push;
        aimY += (dy / dist) * push;
      }
    }
  }

  const length = Math.sqrt(aimX * aimX + aimY * aimY);
  if (length === 0) {
    // Nothing to say — hold the line, which is what a driver looking at nothing does.
    state.wantX = 0;
    state.wantY = 0;
    out.x = 0;
    out.y = 0;
    return out;
  }
  const spin = (wobble * 2 - 1) * profile.error;
  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  const unitX = aimX / length;
  const unitY = aimY / length;
  state.wantX = unitX * cos - unitY * sin;
  state.wantY = unitX * sin + unitY * cos;
  out.x = state.wantX;
  out.y = state.wantY;
  return out;
}
