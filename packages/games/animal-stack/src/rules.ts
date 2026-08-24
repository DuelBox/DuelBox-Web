import type { Rng, SeatId } from '@duelbox/engine';
import { misjudgement, resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Animal Stack, as pure rules.
 *
 * A platform each. A crane swings an animal in over your platform, off to one side; you walk
 * it left and right, turn it round if it is facing the wrong way, and let go. It drops onto
 * whatever is already there. **If anything comes off the platform, you have lost** — that is
 * the whole win condition, and everything else in this file exists to make it reachable.
 *
 * **Whether a tower stands is not a fudge factor, it is the schoolroom statics.** A stack of
 * rigid bodies stands exactly when, at every join, the centre of mass of everything above
 * that join lies inside the patch the two bodies actually touch on. So the file computes two
 * things and nothing else: where each animal's feet overlap the back of the animal beneath,
 * and where the weight above each join falls. See {@link marginOf}.
 *
 * That gives the game its shape without a single arbitrary rule:
 *
 * - An animal is not a box. Its **back** — the flat the next animal stands on — is offset
 *   from its feet, so stacking one animal squarely on the next walks the tower sideways.
 *   Turning the animal round mirrors that offset, which is what the turn is *for*.
 * - Its **weight** is offset from its feet too, so a tall leaning animal is a liability
 *   however neatly you place it.
 * - The animals get more awkward as the tower grows — a tortoise first, a flamingo last —
 *   so the tower gets harder to keep honest exactly as it gets taller.
 *
 * **The two platforms are the point.** Nothing is shared, nothing alternates, and there is no
 * first mover: each seat has its own platform, its own crane and its own budget. The animals
 * come out of one seeded stream and are handed out **by index**, so the nth animal of the
 * match is the same animal, facing the same way, arriving at the same offset, for both seats.
 * The two seats are set the identical run of problems, at their own pace.
 *
 * The observed rule says "take turns", and this does not: `rt-split` games must not model
 * turns (a turn model would take one seat's pointer zone away for half the match), and two
 * platforms is the honest reading of "first player to drop an animal off the platform loses"
 * for a game where both people are holding the device at once. **[ours]**
 *
 * Everything below is in **platform-local** coordinates: `across` is signed distance from
 * your own platform's centre line, `height` is measured up from your own platform's top
 * surface. Both platforms hold literally the same numbers, and the half turn that separates
 * them lives in {@link worldXOf} and {@link worldYOf}, which only the renderer calls.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit; nothing is in pixels.
 */

export const FIELD_WIDTH = 600;
export const FIELD_HEIGHT = 1000;

/**
 * How tall one seat's half is.
 *
 * Two of these plus the gutter make the field, so the layout is symmetric under a half turn:
 * each player's platform stands on the edge nearest them and the strip that belongs to
 * neither is in the middle.
 */
export const YARD_HEIGHT = 470;
/** The band between the two yards, which belongs to neither seat. */
export const GUTTER = FIELD_HEIGHT - YARD_HEIGHT * 2;

/**
 * How far above a seat's own edge of the field its platform's top surface sits.
 *
 * Deep enough to draw a plinth a player reads as a *platform* with a drop either side of it,
 * which is what the rule is about — an animal has to be able to visibly go over the edge.
 */
export const PLINTH_HEIGHT = 74;

/* ------------------------------------------------------------------ *
 * The platform
 * ------------------------------------------------------------------ */

/**
 * Half the width of the platform, in units either side of its centre line.
 *
 * Twice the widest animal's feet would be 92, so this is exactly "one tortoise wide either
 * side of centre": the first animal of a match can be put down anywhere on the platform and
 * still have its whole footprint supported, and the platform stops being the binding
 * constraint the moment a second animal is on it.
 */
export const PLATFORM_HALF = 92;

/**
 * The narrowest strip of contact an animal can stand on at all.
 *
 * Below this it has a toe on the edge rather than a foothold, and it goes over. Without it
 * the statics would happily balance an animal on a contact one thousandth of a unit wide as
 * long as its weight fell inside — which is arithmetic rather than a game. Six units is
 * about a quarter of the narrowest back in the game. **[ours]**
 */
export const MIN_CONTACT = 6;

/**
 * How far either way the crane can carry an animal.
 *
 * Deliberately well past the edge of the platform: **the losing move has to be reachable**,
 * or "first player to drop an animal off the platform loses" is a rule about nothing. At full
 * reach the widest animal still ends 234 units from the centre line, inside the 300 the field
 * allows, so nothing is ever carried off the side of the screen.
 */
export const CARRY_REACH = 176;

/**
 * How fast an animal walks sideways, in units a second.
 *
 * **One speed for both instruments**, and that is the whole of this game's input-parity
 * answer: a finger names a point and the animal walks to it at this speed, a held key walks
 * it at this speed, and neither can teleport. Crossing the full reach takes 1.41 s against a
 * crane clock that starts at 4 s and ends at 2.05 s, so there is always time to cross and
 * never much of it to spare.
 */
export const SLIDE_SPEED = 250;

/** How high above the top of the tower the crane holds an animal. Also how far it falls. */
export const CARRY_GAP = 90;

/* ------------------------------------------------------------------ *
 * The animals
 * ------------------------------------------------------------------ */

/**
 * One kind of animal, in its own frame, facing right.
 *
 * `across` on a placed animal is the centre of its **feet**. Everything else is measured
 * from there, and turning the animal round mirrors the two signed numbers.
 */
export interface Species {
  readonly name: string;
  /** Half the width of its feet: the strip it stands on. */
  readonly baseHalf: number;
  /** How tall it is, so the tower has a height. */
  readonly bodyHeight: number;
  /** How heavy it is, relative to a tortoise at 1.2. */
  readonly mass: number;
  /** Where its weight falls relative to its feet. Signed; mirrored by a turn. */
  readonly lean: number;
  /** Where the middle of its back falls relative to its feet. Signed; mirrored by a turn. */
  readonly topOffset: number;
  /** Half the width of its back: the strip the next animal can stand on. */
  readonly topHalf: number;
}

/**
 * The six animals, ordered from the easiest thing to stack to the worst. **[ours]**
 *
 * The order is load-bearing: {@link dealAt} slides its draw window up this list as the tower
 * grows, so a match opens with tortoises and ends with flamingos. That is the whole
 * difficulty ramp, and it is why late animals fall and early ones do not.
 *
 * Every one obeys `|lean| < baseHalf` — an animal whose weight fell outside its own feet
 * could not stand on the bare platform, which would be a broken animal rather than a hard
 * one. The tightest is the goat at 10 against 26.
 */
const TORTOISE: Species = {
  name: 'tortoise',
  baseHalf: 46,
  bodyHeight: 30,
  mass: 1.2,
  lean: 0,
  topOffset: 0,
  topHalf: 40,
};
const PIG: Species = {
  name: 'pig',
  baseHalf: 38,
  bodyHeight: 36,
  mass: 1.5,
  lean: 6,
  topOffset: -8,
  topHalf: 32,
};
const SHEEP: Species = {
  name: 'sheep',
  baseHalf: 32,
  bodyHeight: 40,
  mass: 1.1,
  lean: -8,
  topOffset: 9,
  topHalf: 26,
};
const GOAT: Species = {
  name: 'goat',
  baseHalf: 26,
  bodyHeight: 46,
  mass: 0.9,
  lean: 10,
  topOffset: -11,
  topHalf: 21,
};
const GIRAFFE: Species = {
  name: 'giraffe',
  baseHalf: 20,
  bodyHeight: 58,
  mass: 1.1,
  lean: -9,
  topOffset: 13,
  topHalf: 14,
};
const FLAMINGO: Species = {
  name: 'flamingo',
  baseHalf: 15,
  bodyHeight: 50,
  mass: 0.6,
  lean: 7,
  topOffset: -13,
  topHalf: 10,
};

export const SPECIES: readonly Species[] = Object.freeze([
  TORTOISE,
  PIG,
  SHEEP,
  GOAT,
  GIRAFFE,
  FLAMINGO,
]);

/** The species at an index. Out of range gives a tortoise, which no draw ever produces. */
export function speciesAt(index: number): Species {
  return SPECIES[index] ?? TORTOISE;
}

/* ------------------------------------------------------------------ *
 * Pacing
 * ------------------------------------------------------------------ */

/** How many animals each seat is given for the whole match. */
export const MAX_ANIMALS = 18;

/** How long both cranes hang over an empty platform before the first animal. */
export const READY_SECONDS = 1;

/** How long the crane holds the first animal before letting go by itself. */
export const CARRY_START = 4;
/** How much of that each further animal loses: the crane has further to reach. */
export const CARRY_STEP = 0.16;
/** The least time the crane ever gives, however tall the tower. */
export const CARRY_MIN = 1.8;

/** How long an animal is in the air after the crane lets go. */
export const FALL_SECONDS = 0.34;

/** Seconds between one animal settling and the next being swung in. */
export const REST_SECONDS = 0.3;

/**
 * How long the crane holds the `index`-th animal before dropping it on its own.
 *
 * **This is the termination guarantee.** A stacking game has nothing that arrives by itself —
 * no wall approaching, no ball in play — so a match between two people who never touch the
 * screen must still end, and it does: every animal a seat is dealt is spent, by dropping it
 * or by waiting. See the arithmetic on {@link MAX_ANIMALS} in SPEC.md.
 */
export function carrySecondsFor(index: number): number {
  const seconds = CARRY_START - index * CARRY_STEP;
  return seconds < CARRY_MIN ? CARRY_MIN : seconds;
}

/** The least far off centre the crane ever delivers an animal. */
export const START_NEAR = 62;
/** The furthest off centre it ever does, on the last animal of a match. */
export const START_FAR = 150;

/**
 * How far off centre the crane delivers the `index`-th animal, at most.
 *
 * It widens, and it starts wider than half a platform: an animal nobody touches is dropped
 * where the crane left it, and by the fourth animal that is already over the edge. **A player
 * who does nothing must lose**, or the whole game is optional.
 */
export function startReachFor(index: number): number {
  return START_NEAR + ((START_FAR - START_NEAR) * index) / (MAX_ANIMALS - 1);
}

/**
 * The match is called after this long whatever else has happened.
 *
 * The animal budget already bounds a match at 52.3 s, so nothing reaches this today. It is
 * here because `roundSeconds` in the manifest ends nothing — the catalogue card is its only
 * reader — and a game whose only guarantee lives in its pacing constants is one change away
 * from running for ever. See the note at the top of `termination.test.ts`.
 */
export const ROUND_SECONDS = 80;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export type Phase = 'playing' | 'over';

/** What one seat is doing. */
export type Stance = 'carrying' | 'dropping' | 'settling' | 'fallen' | 'safe';

/** What one animal did. Exactly one of these per animal per seat. */
export type Landing = 'none' | 'stacked' | 'fell';

/** An animal standing on the tower. */
export interface Placed {
  /** Index into {@link SPECIES}. */
  species: number;
  /** +1 or -1. Mirrors {@link Species.lean} and {@link Species.topOffset}. */
  facing: number;
  /** Where the centre of its feet sits, in units either side of the platform's centre. */
  across: number;
  /** How high its feet are above the platform's top surface. */
  base: number;
}

/** The animal on the crane. Same three numbers, before it is put anywhere. */
export interface Held {
  species: number;
  facing: number;
  across: number;
}

export interface Yard {
  stance: Stance;
  /** Seconds left of the opening pause or of the rest between animals, counting down. */
  rest: number;
  /** Seconds the crane has held this animal, counting up to {@link Yard.limit}. */
  carry: number;
  /** How long the crane will hold this animal before letting go on its own. */
  limit: number;
  /** Seconds the animal has been falling, counting up to {@link FALL_SECONDS}. */
  fall: number;
  /** Animals swung in so far, out of {@link MAX_ANIMALS}. */
  dealt: number;
  /** Animals standing on the platform. This is the seat's score. */
  count: number;
  /** Height of the top of the tower above the platform. */
  top: number;
  readonly held: Held;
  /** Preallocated to {@link MAX_ANIMALS}; `count` says how much of it is live. */
  readonly stack: Placed[];
  /** Which join gave way, or -1 if none ever has. */
  broke: number;
  /** How many animals came down with it. Never zero once anything has fallen. */
  toppled: number;
  /** What the last animal did, and how long ago, so the renderer can flash it. */
  last: Landing;
  since: number;
}

export interface Match {
  readonly p1: Yard;
  readonly p2: Yard;
  /**
   * The animals of the match, drawn once and handed to both seats by index.
   *
   * Preallocated and drawn into: nothing here allocates per step, and because the draw is
   * consumed by animal *number* rather than by time, what one seat does cannot change what
   * the other is dealt.
   */
  readonly species: number[];
  readonly facings: number[];
  readonly starts: number[];
  /** How many entries of the three arrays above have been drawn. */
  drawn: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
  /** Seconds the match has run, for the backstop. */
  elapsed: number;
}

function createPlaced(): Placed {
  return { species: 0, facing: 1, across: 0, base: 0 };
}

function createYard(): Yard {
  const stack: Placed[] = [];
  for (let i = 0; i < MAX_ANIMALS; i += 1) stack.push(createPlaced());
  return {
    stance: 'settling',
    rest: READY_SECONDS,
    carry: 0,
    limit: carrySecondsFor(0),
    fall: 0,
    dealt: 0,
    count: 0,
    top: 0,
    held: { species: 0, facing: 1, across: 0 },
    stack,
    broke: -1,
    toppled: 0,
    last: 'none',
    since: 0,
  };
}

export function createMatch(): Match {
  const species: number[] = [];
  const facings: number[] = [];
  const starts: number[] = [];
  for (let i = 0; i < MAX_ANIMALS; i += 1) {
    species.push(0);
    facings.push(1);
    starts.push(0);
  }
  return {
    p1: createYard(),
    p2: createYard(),
    species,
    facings,
    starts,
    drawn: 0,
    phase: 'playing',
    winner: null,
    elapsed: 0,
  };
}

function resetYard(yard: Yard): void {
  yard.stance = 'settling';
  yard.rest = READY_SECONDS;
  yard.carry = 0;
  yard.limit = carrySecondsFor(0);
  yard.fall = 0;
  yard.dealt = 0;
  yard.count = 0;
  yard.top = 0;
  yard.held.species = 0;
  yard.held.facing = 1;
  yard.held.across = 0;
  for (let i = 0; i < MAX_ANIMALS; i += 1) {
    const placed = yard.stack[i];
    if (placed === undefined) continue;
    placed.species = 0;
    placed.facing = 1;
    placed.across = 0;
    placed.base = 0;
  }
  yard.broke = -1;
  yard.toppled = 0;
  yard.last = 'none';
  yard.since = 0;
}

export function resetMatch(match: Match): void {
  resetYard(match.p1);
  resetYard(match.p2);
  // The three deal arrays are cleared as well as `drawn`, so a reset match is
  // indistinguishable from a fresh one rather than merely behaving like one. Nothing reads a
  // stale entry — `ensureDrawn` overwrites by index before anybody looks — but a rematch
  // carrying the last match's animals in memory is exactly what a later change trips over.
  for (let i = 0; i < MAX_ANIMALS; i += 1) {
    match.species[i] = 0;
    match.facings[i] = 1;
    match.starts[i] = 0;
  }
  match.drawn = 0;
  match.phase = 'playing';
  match.winner = null;
  match.elapsed = 0;
}

export function yardOf(match: Match, seat: SeatId): Yard {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Never undefined for `index` in [0, count); out of range gives an empty tortoise. */
const NOWHERE: Readonly<Placed> = Object.freeze({ species: 0, facing: 1, across: 0, base: 0 });

export function placedAt(yard: Readonly<Yard>, index: number): Readonly<Placed> {
  return yard.stack[index] ?? NOWHERE;
}

/* ------------------------------------------------------------------ *
 * Platform-local space to world space.
 *
 * The only place the two yards stop being the same thing. p1 owns the bottom of the field
 * with its platform on the bottom edge; p2 owns the top with its platform on the top edge,
 * which is a half turn of p1's half about the centre of the field — exactly the transform
 * the shell applies to the far seat's view. Both readings of the device are therefore
 * upright, and `rules.test.ts` asserts the point symmetry rather than trusting the
 * arithmetic here.
 * ------------------------------------------------------------------ */

/** Where a platform-local offset from the centre line falls across the field. */
export function worldXOf(seat: SeatId, across: number): number {
  return seat === 'p1' ? FIELD_WIDTH / 2 + across : FIELD_WIDTH / 2 - across;
}

/** Where a platform-local height falls down the field. */
export function worldYOf(seat: SeatId, height: number): number {
  return seat === 'p1' ? FIELD_HEIGHT - PLINTH_HEIGHT - height : PLINTH_HEIGHT + height;
}

/**
 * A point on the device, read back as an offset from this seat's centre line.
 *
 * The inverse of {@link worldXOf}, and the only thing that turns a finger into a position.
 * A finger in the far seat's half reads as the far seat's own left and right, because the
 * far player is reading the device the other way up — the same half turn, applied to input.
 */
export function acrossOfWorld(seat: SeatId, worldX: number): number {
  return seat === 'p1' ? worldX - FIELD_WIDTH / 2 : FIELD_WIDTH / 2 - worldX;
}

/* ------------------------------------------------------------------ *
 * Statics
 * ------------------------------------------------------------------ */

/** Where the middle of a placed animal's back sits. */
export function backCentreOf(placed: Readonly<Placed>): number {
  return placed.across + placed.facing * speciesAt(placed.species).topOffset;
}

/** Where a placed animal's weight falls. */
export function weightCentreOf(placed: Readonly<Placed>): number {
  return placed.across + placed.facing * speciesAt(placed.species).lean;
}

/** The left edge of the strip the `index`-th animal is standing on. */
export function supportLoAt(yard: Readonly<Yard>, index: number): number {
  if (index <= 0) return -PLATFORM_HALF;
  const under = placedAt(yard, index - 1);
  return backCentreOf(under) - speciesAt(under.species).topHalf;
}

/** The right edge of the strip the `index`-th animal is standing on. */
export function supportHiAt(yard: Readonly<Yard>, index: number): number {
  if (index <= 0) return PLATFORM_HALF;
  const under = placedAt(yard, index - 1);
  return backCentreOf(under) + speciesAt(under.species).topHalf;
}

/**
 * How much slack one join has, in logical units. Negative means it gives way.
 *
 * **The one piece of physics in the game.** The two bodies touch on the overlap of the upper
 * one's feet with the lower one's back; the join holds exactly when the weight of everything
 * above it falls inside that overlap, and the margin is how far it is from the nearer edge.
 * A contact narrower than {@link MIN_CONTACT} is not a foothold at all, and reports how far
 * short it fell so that a bot comparing two bad placements can still tell them apart.
 *
 * `stands` is precisely `margin >= 0`, so there is one comparison in the game and not two
 * that could disagree. A weight landing exactly on the edge of the contact stands — the
 * decision is made on the bit, and `rules.test.ts` drives both sides of it.
 */
export function marginOf(
  baseLo: number,
  baseHi: number,
  supportLo: number,
  supportHi: number,
  weight: number,
): number {
  const lo = baseLo > supportLo ? baseLo : supportLo;
  const hi = baseHi < supportHi ? baseHi : supportHi;
  const width = hi - lo;
  if (width < MIN_CONTACT) return width - MIN_CONTACT;
  const left = weight - lo;
  const right = hi - weight;
  return left < right ? left : right;
}

/**
 * The result of the last {@link scanTower}, held in module scope so a scan allocates nothing.
 *
 * Read them through {@link towerMargin}, {@link trialMargin} and {@link breakJointOf} rather
 * than directly; they are rewritten by every scan.
 */
let scanWorst = 0;
let scanBreak = -1;
let scanTight = -1;

/**
 * Walk every join of a tower from the top down, accumulating the load above each.
 *
 * Top down, and that is the rule rather than an implementation detail: **a tower breaks at
 * the highest join that gives way, and everything above that join goes.** An animal that
 * lands with a toe on the edge slides off on its own and leaves the tower standing; a tower
 * whose base is overloaded is scanned all the way down to the base and loses the lot. The
 * two are the same rule, which is why there is no separate "it slid off" case anywhere.
 *
 * It is also self-consistent: every prefix of the stack was checked when it was built, so
 * whatever is left after a break was standing before the drop and is standing after it.
 */
function scanTower(yard: Readonly<Yard>, useTrial: boolean, across: number, facing: number): void {
  let mass = 0;
  let moment = 0;
  let worst = Number.POSITIVE_INFINITY;
  let broke = -1;
  let tight = -1;

  if (useTrial) {
    const species = speciesAt(yard.held.species);
    mass = species.mass;
    moment = species.mass * (across + facing * species.lean);
    const margin = marginOf(
      across - species.baseHalf,
      across + species.baseHalf,
      supportLoAt(yard, yard.count),
      supportHiAt(yard, yard.count),
      moment / mass,
    );
    if (margin < worst) {
      worst = margin;
      tight = yard.count;
    }
    if (margin < 0) broke = yard.count;
  }

  for (let k = yard.count - 1; k >= 0; k -= 1) {
    const placed = placedAt(yard, k);
    const species = speciesAt(placed.species);
    mass += species.mass;
    moment += species.mass * weightCentreOf(placed);
    const margin = marginOf(
      placed.across - species.baseHalf,
      placed.across + species.baseHalf,
      supportLoAt(yard, k),
      supportHiAt(yard, k),
      moment / mass,
    );
    if (margin < worst) {
      worst = margin;
      tight = k;
    }
    if (margin < 0 && broke < 0) broke = k;
  }

  scanWorst = worst === Number.POSITIVE_INFINITY ? 0 : worst;
  scanBreak = broke;
  scanTight = tight;
}

/**
 * How much slack the tower's tightest join has, as it stands. Zero for an empty platform.
 *
 * Drawn as the balance bar, and it is also the tie-break: two towers that both survived the
 * whole budget are separated by which of them is standing more honestly.
 */
export function towerMargin(yard: Readonly<Yard>): number {
  scanTower(yard, false, 0, 1);
  return scanWorst;
}

/**
 * What the tower's tightest join would have if the held animal were let go right now.
 *
 * Non-negative exactly when the drop would stand. This is what the bot maximises, and it is
 * arithmetic over things the renderer draws — the animals, their feet, their backs and the
 * platform — rather than a number the game knows and the player does not. See SPEC.md.
 */
export function trialMargin(yard: Readonly<Yard>, across: number, facing: number): number {
  scanTower(yard, true, across, facing);
  return scanWorst;
}

/** The highest join of the tower as it stands that gives way, or -1 if none does. */
export function breakJointOf(yard: Readonly<Yard>): number {
  scanTower(yard, false, 0, 1);
  return scanBreak;
}

/**
 * Which join of the tower as it stands has the least slack, or -1 for an empty platform.
 *
 * The renderer marks it, because "where this tower is going to break" is the one thing a
 * player needs and cannot read off a picture of six animals at a glance.
 */
export function tightestJointOf(yard: Readonly<Yard>): number {
  scanTower(yard, false, 0, 1);
  return scanTight;
}

/**
 * Where the weight of everything from `index` upward falls, in platform-local units.
 *
 * Returns the platform's centre line for an index past the top of the tower, so a caller
 * drawing a marker for an empty tower has somewhere to put it.
 */
export function weightAboveOf(yard: Readonly<Yard>, index: number): number {
  let mass = 0;
  let moment = 0;
  for (let k = yard.count - 1; k >= index; k -= 1) {
    const placed = placedAt(yard, k);
    const species = speciesAt(placed.species);
    mass += species.mass;
    moment += species.mass * weightCentreOf(placed);
  }
  return mass > 0 ? moment / mass : 0;
}

/** Whether letting the held animal go right now would leave everything standing. */
export function wouldStand(yard: Readonly<Yard>, across: number, facing: number): boolean {
  return trialMargin(yard, across, facing) >= 0;
}

/* ------------------------------------------------------------------ *
 * One seat's animal
 * ------------------------------------------------------------------ */

/** What a player — or a bot — is asking of the crane this step. */
export interface Intent {
  /**
   * Which way the animal is being walked by a key: the sign is used, never the magnitude,
   * so two keys at once cannot out-run one.
   */
  slide: number;
  /** Whether {@link Intent.aim} means anything this step. */
  aimActive: boolean;
  /** A point to walk the animal towards, in platform-local units. Rate limited like a key. */
  aim: number;
  turn: boolean;
  drop: boolean;
}

export function createIntent(): Intent {
  return { slide: 0, aimActive: false, aim: 0, turn: false, drop: false };
}

export function clearIntent(intent: Intent): void {
  intent.slide = 0;
  intent.aimActive = false;
  intent.aim = 0;
  intent.turn = false;
  intent.drop = false;
}

/** Draw the next animals' kind, facing and delivery offset, once, into the shared arrays. */
function ensureDrawn(match: Match, index: number, rng: Rng): void {
  while (match.drawn <= index && match.drawn < MAX_ANIMALS) {
    const i = match.drawn;
    // The draw window slides up the species list as the tower grows: a match opens with
    // tortoises and pigs and ends with giraffes and flamingos. Three draws an animal,
    // always in this order, so the stream is a pure function of the animal's number.
    const last = SPECIES.length - 1;
    const spanTop = 1 + Math.floor((i * (last + 1)) / (MAX_ANIMALS - 1));
    const top = spanTop < last ? spanTop : last;
    const bottom = top - 2 > 0 ? top - 2 : 0;
    match.species[i] = rng.int(bottom, top + 1);
    match.facings[i] = rng.bool() ? 1 : -1;
    const reach = startReachFor(i);
    // At least 40% of the way out, so "the crane happened to stop over the middle" is not a
    // thing that happens to a player who did nothing.
    const out = (0.4 + 0.6 * rng.float()) * reach;
    match.starts[i] = rng.bool() ? out : -out;
    match.drawn += 1;
  }
}

/** Swing the next animal in for this seat. */
function bring(match: Match, yard: Yard, rng: Rng): void {
  const index = yard.dealt;
  ensureDrawn(match, index, rng);
  const held = yard.held;
  held.species = match.species[index] ?? 0;
  held.facing = match.facings[index] ?? 1;
  held.across = match.starts[index] ?? 0;
  yard.dealt = index + 1;
  yard.stance = 'carrying';
  yard.carry = 0;
  yard.limit = carrySecondsFor(index);
  yard.fall = 0;
}

/** Walk the held animal, at one speed whatever asked for it. */
function walk(yard: Yard, intent: Readonly<Intent>, fixedDeltaSeconds: number): void {
  const held = yard.held;
  const reach = SLIDE_SPEED * fixedDeltaSeconds;
  if (intent.aimActive) {
    const gap = intent.aim - held.across;
    // Rate limited, so a finger that jumps across the yard does not teleport the animal
    // after it. A pointer that names a point inside one step's reach lands exactly on it,
    // which is the one place either instrument gets an exact answer.
    if (gap > reach) held.across += reach;
    else if (gap < -reach) held.across -= reach;
    else held.across = intent.aim;
  } else if (intent.slide !== 0) {
    held.across += intent.slide > 0 ? reach : -reach;
  }
  if (held.across > CARRY_REACH) held.across = CARRY_REACH;
  else if (held.across < -CARRY_REACH) held.across = -CARRY_REACH;
}

/** The crane lets go. Everything after this is the fall. */
function release(yard: Yard): void {
  yard.stance = 'dropping';
  yard.fall = 0;
}

/** Put the animal down, and see what the tower makes of it. */
function land(yard: Yard): Landing {
  const index = yard.count;
  const placed = yard.stack[index];
  const held = yard.held;
  if (placed === undefined) {
    // Unreachable: the stack is preallocated to MAX_ANIMALS and `dealt` never passes it.
    yard.stance = 'safe';
    return 'none';
  }
  placed.species = held.species;
  placed.facing = held.facing;
  placed.across = held.across;
  placed.base = yard.top;
  yard.count = index + 1;
  yard.top += speciesAt(placed.species).bodyHeight;

  const broke = breakJointOf(yard);
  yard.since = 0;
  if (broke < 0) {
    yard.last = 'stacked';
    yard.stance = 'settling';
    yard.rest = REST_SECONDS;
    return 'stacked';
  }

  yard.last = 'fell';
  yard.broke = broke;
  yard.toppled = yard.count - broke;
  yard.count = broke;
  // The tower is what is left standing, so the height has to be re-added rather than
  // decremented: the animals that went took their own heights with them.
  let top = 0;
  for (let k = 0; k < yard.count; k += 1) top += speciesAt(placedAt(yard, k).species).bodyHeight;
  yard.top = top;
  yard.stance = 'fallen';
  return 'fell';
}

/**
 * Advance one seat by one step and report what its animal did.
 *
 * The player's drop is answered **after** the animal has been walked and **before** the crane
 * clock advances, which is the only order that does what a player means: you drag, you let
 * go, and the animal falls from where your finger left it rather than from a step further on.
 */
export function stepYard(
  match: Match,
  yard: Yard,
  intent: Readonly<Intent>,
  fixedDeltaSeconds: number,
  rng: Rng,
): Landing {
  yard.since += fixedDeltaSeconds;
  if (yard.stance === 'fallen' || yard.stance === 'safe') return 'none';

  if (yard.stance === 'settling') {
    yard.rest -= fixedDeltaSeconds;
    if (yard.rest > 0) return 'none';
    yard.rest = 0;
    if (yard.dealt >= MAX_ANIMALS) {
      yard.stance = 'safe';
      return 'none';
    }
    bring(match, yard, rng);
    return 'none';
  }

  if (yard.stance === 'dropping') {
    yard.fall += fixedDeltaSeconds;
    if (yard.fall < FALL_SECONDS) return 'none';
    yard.fall = FALL_SECONDS;
    return land(yard);
  }

  if (intent.turn) yard.held.facing = -yard.held.facing;
  walk(yard, intent, fixedDeltaSeconds);
  if (intent.drop) {
    release(yard);
    return 'none';
  }
  yard.carry += fixedDeltaSeconds;
  // The crane will not hold it for ever, and that is what makes a match nobody plays end.
  if (yard.carry >= yard.limit) release(yard);
  return 'none';
}

/* ------------------------------------------------------------------ *
 * The match
 * ------------------------------------------------------------------ */

export interface StepResult {
  readonly p1: Landing;
  readonly p2: Landing;
}

/** Rewritten in place every step; a caller keeping it must copy the fields out. */
const result: { p1: Landing; p2: Landing } = { p1: 'none', p2: 'none' };

/**
 * Last one still standing, and the taller tower when both run out of animals.
 *
 * The observed rule is a losing condition rather than a scoring one — "first player to drop
 * an animal off the platform loses" — so it is `last-standing` rather than a race to a
 * number, and the SDK's `resolve` owns both halves. Two towers that go in the same step are
 * a draw because the helper says so, not because this file picked a seat.
 */
const CONDITION: WinCondition = { kind: 'last-standing' };

/** Scratch for `resolve`, so calling it every step allocates nothing. */
const tally = { p1: 0, p2: 0 };
const NOBODY_OUT: readonly SeatId[] = Object.freeze([]);
const P1_OUT: readonly SeatId[] = Object.freeze(['p1'] as SeatId[]);
const P2_OUT: readonly SeatId[] = Object.freeze(['p2'] as SeatId[]);
const BOTH_OUT: readonly SeatId[] = Object.freeze(['p1', 'p2'] as SeatId[]);
const options: { timeExpired: boolean; eliminated: readonly SeatId[] } = {
  timeExpired: false,
  eliminated: NOBODY_OUT,
};

export function fallenOf(yard: Readonly<Yard>): boolean {
  return yard.stance === 'fallen';
}

/** A seat with no animals left to place, whether it ran out or came down. */
function done(yard: Readonly<Yard>): boolean {
  return yard.stance === 'safe' || yard.stance === 'fallen';
}

/** Both seats have spent every animal they were given, one way or the other. */
export function spent(match: Readonly<Match>): boolean {
  return done(match.p1) && done(match.p2);
}

/**
 * Separate two seats that `resolve` called level. **[ours]**
 *
 * Two seats are dealt the identical animals, so two players who both survive the budget
 * finish on the same count by construction — "level on animals" has to mean something, and
 * the honest thing it means here is **whose tower is standing more honestly**. The margin at
 * the tightest join is the same number the balance bar has been showing all match, so the
 * tie-break is something both players watched happen rather than a hidden second scoreboard.
 *
 * Two towers that both came down in the same step are a genuine draw: they were level, and
 * neither has a margin left to compare.
 */
export function breakTie(match: Readonly<Match>): SeatId | 'draw' {
  const p1Out = fallenOf(match.p1);
  const p2Out = fallenOf(match.p2);
  if (p1Out || p2Out) return 'draw';
  const a = towerMargin(match.p1);
  const b = towerMargin(match.p2);
  if (a > b) return 'p1';
  if (b > a) return 'p2';
  return 'draw';
}

/** Call the match if it is over. Safe to call every step; does nothing until it is. */
export function decide(match: Match): void {
  if (match.phase === 'over') return;
  tally.p1 = match.p1.count;
  tally.p2 = match.p2.count;
  const p1Out = fallenOf(match.p1);
  const p2Out = fallenOf(match.p2);
  options.eliminated = p1Out ? (p2Out ? BOTH_OUT : P1_OUT) : p2Out ? P2_OUT : NOBODY_OUT;
  options.timeExpired = spent(match) || match.elapsed >= ROUND_SECONDS;
  const outcome = resolve(CONDITION, tally, options);
  if (outcome === null) return;
  match.phase = 'over';
  match.winner = outcome === 'draw' ? breakTie(match) : outcome;
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

/**
 * One fixed step of the whole match.
 *
 * The two yards are stepped with their own player's intent and neither can read or touch the
 * other, which is the property the whole design rests on: there is no order-of-play advantage
 * to be had because there is no shared object. The one thing they share is the stream the
 * animals are drawn from, and that is consumed **by animal number** rather than by time, so
 * it hands the two seats the same animals whatever pace they play at.
 */
export function step(
  match: Match,
  p1Intent: Readonly<Intent>,
  p2Intent: Readonly<Intent>,
  fixedDeltaSeconds: number,
  rng: Rng,
): StepResult {
  result.p1 = 'none';
  result.p2 = 'none';
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;
  result.p1 = stepYard(match, match.p1, p1Intent, fixedDeltaSeconds, rng);
  result.p2 = stepYard(match, match.p2, p2Intent, fixedDeltaSeconds, rng);
  decide(match);
  return result;
}

/* ------------------------------------------------------------------ *
 * The grip: one gesture, spelled the same by a key and by a thumb
 * ------------------------------------------------------------------ */

export const GRIP_NONE = 0;
export const GRIP_TURN = 1;
export const GRIP_DROP = 2;

/**
 * How long a press has to last before letting go means "drop" rather than "turn".
 *
 * **0.19 s sits between eleven steps (0.1833 s) and twelve (0.2 s) at 60 Hz, deliberately not
 * on a step boundary.** A threshold on a boundary is decided by whether thirty additions of a
 * sixtieth land a hair above or below it — which is exactly how a 0.5 s freeze in another
 * game here took 31 frames — and this one decides whether an animal is turned or dropped.
 */
export const TAP_SECONDS = 0.19;

/** How long the current press has lasted. One per seat. */
export interface Grip {
  held: boolean;
  seconds: number;
}

export function createGrip(): Grip {
  return { held: false, seconds: 0 };
}

export function resetGrip(grip: Grip): void {
  grip.held = false;
  grip.seconds = 0;
}

/**
 * Turn one press-and-release into a turn or a drop.
 *
 * **One rule, and both instruments spell it the same way**: a tap turns the animal round, a
 * press held past {@link TAP_SECONDS} and then released drops it. A thumb taps the glass or
 * drags and lifts; a keyboard taps its action key or holds it and lets go. Neither has a
 * gesture the other cannot make, and there is no mode to switch between them.
 *
 * A press and a release that land inside the same step are a tap, which is most taps on a
 * touchscreen — the engine latches both, and this reads them in that order.
 */
export function gripStep(
  grip: Grip,
  pressed: boolean,
  held: boolean,
  released: boolean,
  fixedDeltaSeconds: number,
): number {
  if (pressed) {
    grip.held = true;
    grip.seconds = 0;
  } else if (grip.held && (held || released)) {
    // The release step counts too, so a press held for n steps measures n steps rather than
    // n minus one — the off-by-one that would put the boundary a whole frame out.
    grip.seconds += fixedDeltaSeconds;
  }
  if (!released || !grip.held) return GRIP_NONE;
  const long = grip.seconds >= TAP_SECONDS;
  grip.held = false;
  grip.seconds = 0;
  return long ? GRIP_DROP : GRIP_TURN;
}

/* ------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks. It cannot change its mind between two of them, so this is both
   * how long it takes to notice something and how quickly it can answer a new tower.
   */
  readonly reaction: number;
  /**
   * How far off it reads the place it is aiming for, in logical units.
   *
   * Drawn **once per animal and held** to the drop, never per step. A fresh error sixty
   * times a second averages to zero and every tier plays the same — the bug the SDK's
   * `misjudgement` exists to prevent, and which three games in this repository shipped
   * before it did.
   */
  readonly error: number;
  /** How often it loses the animal altogether, in blunders a second. */
  readonly blunder: number;
  /**
   * How many placements it weighs up before choosing one.
   *
   * Deliberation rather than information: every tier can see the same tower, the same feet
   * and the same backs, and a beginner simply does not consider as many ways to put the
   * animal down. It sets how finely the search can land, not what it is allowed to know.
   */
  readonly tries: number;
  /** How close to where it meant to be it will settle for before letting go. */
  readonly tolerance: number;
}

/**
 * The three tiers, expressed only as reaction, aim error, blunder rate, deliberation and
 * how fussy each is about arriving.
 *
 * None of them gets a wider platform, a heavier animal, a faster crane, a longer clock, or a
 * look at anything a player cannot see (CLAUDE.md rule 6). All three run the identical policy
 * in {@link botIntent} and act through the identical {@link stepYard}.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.3, error: 17, blunder: 0.4, tries: 7, tolerance: 14 },
  normal: { reaction: 0.14, error: 9, blunder: 0.22, tries: 15, tolerance: 6 },
  hard: { reaction: 0.07, error: 4, blunder: 0.1, tries: 27, tolerance: 2 },
});

/**
 * How long a blunder lasts.
 *
 * A duration rather than a coin flip resolved every step: a bot that re-decides fourteen
 * times a second and hesitates for one of those has not blundered, it has jittered, and the
 * next look undoes it before it has cost anything. Held this long it loses most of a second
 * off a crane clock that is under two by the end of a match.
 */
export const BLUNDER_SECONDS = 0.5;

/**
 * How much a look interval is allowed to wander, either side of the tier's reaction time.
 *
 * Not a flourish: a bot looking on a perfectly regular tick lands every look on the same
 * offsets from the animal's arrival for the whole match, so the gap between where it looks
 * and where it wants to be is a fixed error rather than a spread and never averages out.
 * Inherited from Chicken Jump, where the effect was measured; re-checked here by sweeping
 * the jitter to zero, which flattened the ladder (SPEC.md).
 */
export const LOOK_JITTER = 0.35;

/**
 * How much the bot dislikes leaving the next animal a back that is off centre, per unit.
 *
 * Not a difficulty knob — every tier uses it, because it is a fact about the game rather
 * than about the player: the join that eventually gives way is nearly always the one at the
 * bottom, and what puts weight out there is the tower walking sideways one back at a time.
 * At 0.35 a bot will give up a unit of margin to pull the next back three units straighter.
 */
export const DRIFT_WEIGHT = 0.35;

/** How far either side of the support the search looks. Wider than any animal's feet. */
export const SEARCH_SPAN = 74;

export interface BotState {
  /** Seconds until the next look. */
  look: number;
  /** How far off it is reading the yard on this animal. Drawn once, held to the drop. */
  bias: number;
  /** Whether {@link BotState.bias} belongs to the animal currently on the crane. */
  armed: boolean;
  /** Seconds of blunder left, during which it does nothing at all. */
  frozen: number;
  /** Where it has decided to put the animal, and which way round. */
  target: number;
  facing: number;
  /** False until a first look has been taken on this animal. */
  chosen: boolean;
}

export function createBotState(): BotState {
  return { look: 0, bias: 0, armed: false, frozen: 0, target: 0, facing: 1, chosen: false };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.bias = 0;
  state.armed = false;
  state.frozen = 0;
  state.target = 0;
  state.facing = 1;
  state.chosen = false;
}

/**
 * Where the bot has decided to put the animal, written into `state`.
 *
 * It weighs `tries` positions either side of the strip it has to land on, both ways round,
 * and keeps the one whose tower would have the most slack — less a penalty for leaving the
 * next animal a back that is off centre. Nothing here reads the other seat, the animals still
 * to come, or any quantity the renderer does not draw.
 */
function choose(yard: Readonly<Yard>, profile: BotProfile, state: BotState): void {
  const centre = (supportLoAt(yard, yard.count) + supportHiAt(yard, yard.count)) / 2;
  const species = speciesAt(yard.held.species);
  const tries = profile.tries;
  const stepSize = (SEARCH_SPAN * 2) / (tries - 1);
  let bestValue = Number.NEGATIVE_INFINITY;
  let bestAcross = centre;
  let bestFacing = yard.held.facing;
  for (let i = 0; i < tries; i += 1) {
    let across = centre - SEARCH_SPAN + stepSize * i;
    if (across > CARRY_REACH) across = CARRY_REACH;
    else if (across < -CARRY_REACH) across = -CARRY_REACH;
    for (let f = -1; f <= 1; f += 2) {
      const margin = trialMargin(yard, across, f);
      const back = across + f * species.topOffset;
      const value = margin - DRIFT_WEIGHT * (back < 0 ? -back : back);
      if (value > bestValue) {
        bestValue = value;
        bestAcross = across;
        bestFacing = f;
      }
    }
  }
  state.target = bestAcross + state.bias;
  state.facing = bestFacing;
  state.chosen = true;
}

/**
 * What the bot is asking of the crane this step, written into `out`.
 *
 * Handed **one yard and no match**, so there is nothing in scope for it to peek at. It walks
 * the animal through the same {@link walk} every player uses, at the same speed, and turns it
 * before it starts walking rather than doing both at once — a thumb has to come off the glass
 * to tap, so a bot that turned mid-drag would be using a gesture no player has.
 */
export function botIntent(
  yard: Readonly<Yard>,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
  out: Intent,
): void {
  clearIntent(out);
  const profile = BOT_PROFILES[difficulty];

  if (yard.stance !== 'carrying') {
    // Between animals there is nothing to aim at, so the held misjudgement is dropped and a
    // fresh one drawn for the next animal. A bias carried across animals would be one
    // long-lived error rather than a series of independent ones.
    state.armed = false;
    state.chosen = false;
    if (state.frozen > 0) state.frozen -= fixedDeltaSeconds;
    return;
  }

  if (!state.armed) {
    state.bias = misjudgement(rng.float(), profile.error);
    state.armed = true;
    state.chosen = false;
    state.look = 0;
  }

  if (state.frozen > 0) {
    state.frozen -= fixedDeltaSeconds;
    return;
  }

  state.look -= fixedDeltaSeconds;
  if (state.look <= 0) {
    // Reset outright rather than left negative, so a long step cannot bank credit towards the
    // next look and let a slow bot look twice in quick succession.
    state.look = profile.reaction * (1 + (rng.float() * 2 - 1) * LOOK_JITTER);
    if (profile.blunder > 0 && rng.bool(profile.blunder * profile.reaction)) {
      state.frozen = BLUNDER_SECONDS;
      return;
    }
    choose(yard, profile, state);
  }

  if (!state.chosen) return;

  if (yard.held.facing !== state.facing) {
    out.turn = true;
    return;
  }

  out.aimActive = true;
  out.aim = state.target;
  const gap = Math.abs(yard.held.across - state.target);
  // Let go when it is where it meant to be — or when the crane is about to let go anyway,
  // since an animal dropped a moment early beats one the crane drops from wherever.
  const rush = yard.carry >= yard.limit - profile.reaction * 2;
  if (gap <= profile.tolerance || rush) out.drop = true;
}
