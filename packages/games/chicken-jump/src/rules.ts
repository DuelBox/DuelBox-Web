import type { Rng, SeatId } from '@duelbox/engine';
import { misjudgement, resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Chicken Jump, as pure rules.
 *
 * A perch at each end of the device. Above your perch a block swings back and forth on a
 * rope; press once and two things happen at the same instant — your chicken hops, and the
 * block is cut loose. The block slides on, slowing, and comes to rest somewhere. If it has
 * come to rest **on the pole** by the time the chicken lands, the chicken has somewhere to
 * stand and the block is stacked; if it settled **in the middle** of the pole it is worth
 * double. If it is still sliding when the chicken comes down, the chicken lands on a moving
 * block, stumbles, and the block is lost.
 *
 * **The whole game is the release instant**, and the reason that is interesting is that the
 * block is a pendulum. Where a block will *stop* is not where it is — it is where it is plus
 * however far it still slides, which grows with the square of its speed. At the outer end of
 * a swing the block is slow and stops almost where it hangs, far from the pole. Crossing the
 * middle it is at its quickest, and it overshoots the pole by more than the swing is wide —
 * and it is also travelling too fast to settle before the chicken is down. Exactly one
 * instant on each inward swing lands it on the pole, and it is neither of the two obvious
 * ones. See {@link stopPointOf}.
 *
 * **The two perches are the point.** Nothing is shared and nothing alternates — no board to
 * contest, no turn order, no first mover. Each seat has its own perch, its own pole, its own
 * budget of blocks and its own swinging block. The blocks come out of one seeded stream and
 * are handed out **by index**, so the nth block of the match is the same block for both
 * seats: the same amplitude, from the same side. The two seats are therefore not merely
 * balanced on average, they are set the identical run of problems — at their own pace, since
 * each seat spends its own blocks when it chooses to.
 *
 * Everything below is expressed in **perch-local** coordinates: `across` is signed distance
 * from your own pole, `height` is measured up from your own floor. Both perches hold
 * literally the same numbers, and the half turn that separates them lives in
 * {@link worldXOf} and {@link worldYOf}, which only the renderer calls. That is what makes
 * "the two perches are identical" checkable by equality rather than by mirror arithmetic
 * that could itself be wrong.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit.
 */

export const FIELD_WIDTH = 680;
export const FIELD_HEIGHT = 1000;

/**
 * How tall one seat's half is.
 *
 * Two of these plus the fence make the field, so the layout is symmetric under a half turn:
 * each player's floor is the edge nearest them and the shared band is in the middle.
 */
export const LANE_HEIGHT = 470;
/** The band between the two perches, which belongs to neither. */
export const FENCE = FIELD_HEIGHT - LANE_HEIGHT * 2;

/** Perch-local x of the pole, and of the chicken standing on it. Always zero: it is the origin. */
export const POLE = 0;

/* ------------------------------------------------------------------ *
 * The swing
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;

/**
 * Radians a second the block swings at. A period of 1.87 s.
 *
 * Fixed across every block and both seats, because it is the *tempo* of the game: a player
 * learns one rhythm and then reads each block's amplitude against it. Varying it as well
 * would make each block a fresh problem rather than a variation on a known one.
 */
export const SWING_RATE = 3.36;

/** The narrowest and widest swing a block is drawn with. */
export const SWING_MIN = 106;
export const SWING_MAX = 126;

/**
 * How hard a cut-loose block is slowed, in units a second squared.
 *
 * With {@link SWING_RATE} and the amplitudes above this is what puts the landing point of a
 * mid-swing block *past* the pole and the landing point of an outer-swing block short of it,
 * which is what makes there be a right instant at all. Slower and every release overshoots;
 * faster and the block simply stops where it was cut, which is a game about pressing at the
 * bottom of the swing and nothing more.
 */
export const DECEL = 428;

/**
 * How long the chicken is off the perch, in seconds.
 *
 * Fixed rather than chosen by the player, and that is deliberate: a hop whose length the
 * player controlled would let a greedy release be bought back with a bigger jump, and the
 * "before the chicken lands" half of the rule would stop meaning anything. It is the clock
 * every release is measured against.
 */
export const HANG_SECONDS = 0.76;

/** How high the hop goes at its apex. Drawn, never simulated — see {@link hopHeight}. */
export const HOP_APEX = 150;

/* ------------------------------------------------------------------ *
 * The pole
 * ------------------------------------------------------------------ */

/** How far off the pole a block may settle and still catch, before anything is scored. */
export const LAND_START = 88;
/** Units of catch lost per point **you** have scored. */
export const LAND_SHRINK = 2.4;
/** The tightest the pole ever gets, however far ahead you are. */
export const LAND_MIN = 46;

/**
 * The middle of the pole, as a fraction of the catch.
 *
 * The block is drawn exactly {@link landOf} wide either side of its own centre, so a block
 * catches precisely when the pole is under it. The middle band is the central 45% of that,
 * which at nil points is a window of 0.09 s to release inside — tight enough to be an
 * achievement and wide enough to be repeatable.
 */
export const PERFECT_FRACTION = 0.45;

/**
 * How far off the pole a block may settle and still catch, for a seat on `points`.
 *
 * **The rule that keeps a lead from running away, and the reason the last point is the hard
 * one.** The blocks themselves are shared and identical; what differs between the two
 * perches is only how much of the pole is left to catch them, and that depends on nothing
 * but your own score. So it is a handicap you inflict on yourself by succeeding, symmetric
 * by construction, and it needs no knowledge of the opponent at all — which matters, because
 * a rubber band that read the *other* seat's score would make one player's game depend on
 * the other's, and this game has no shared state by design.
 *
 * What it buys is that **the last point is the hardest**, expressed as time rather than as
 * distance. The block sweeps its stopping point across the pole at a speed set by the swing,
 * so a narrower band is a shorter instant to release inside: measured over the whole inward
 * swing, the middle is open for 107 ms at nil points and 72 ms at twelve on the narrowest
 * block, and 82 ms falling to 55 ms on the widest. `rules.test.ts` measures both ends.
 *
 * It does **not** put the last points out of reach — a release exactly on the crossing scores
 * the middle at any score, and a test plays a run of perfect blocks to prove it. Two players
 * who both play perfectly therefore do draw on points, and the tie-break below is what
 * separates them, which is the honest answer: they were equal. **[ours]**
 */
export function landOf(points: number): number {
  const band = LAND_START - points * LAND_SHRINK;
  return band < LAND_MIN ? LAND_MIN : band;
}

/** How far off the pole still counts as the middle, for a seat on `points`. */
export function perfectOf(points: number): number {
  return landOf(points) * PERFECT_FRACTION;
}

/* ------------------------------------------------------------------ *
 * Pacing
 * ------------------------------------------------------------------ */

/**
 * How long a block hangs there before it is cut down and lost.
 *
 * **This is the termination guarantee**, and it is what a stacking game needs that a
 * scrolling one does not: nothing here arrives on its own, so a match between two players
 * who never press must still end. Three seconds is a swing and a half, which offers three
 * separate right instants — a player who misses one has not lost the block, only the tempo.
 */
export const HESITATE_SECONDS = 3;

/** Seconds between one block settling and the next being hung up. */
export const REST_SECONDS = 0.45;

/** Seconds a stumble costs, on top of the rest. A moving block is the expensive mistake. */
export const STUMBLE_SECONDS = 0.75;

/** How long both chickens stand and look at an empty rope before the first block. */
export const READY_SECONDS = 1.2;

/**
 * How many blocks each seat is given for the whole match.
 *
 * Sixteen apiece, spent by pressing or by hesitating. The dearest a block can be made to
 * cost is the whole hesitation clock, then a hop, then the longest rest there is — a player
 * who holds every block to the brink and then leaves it sliding — so a match ends after at
 * most `1.2 + 16 × (3 + 0.76 + 0.75) = 73.4 s` however either player plays, including not at
 * all, which costs `1.2 + 16 × (3 + 0.45) = 56.4 s`. {@link ROUND_SECONDS} below is a second,
 * looser backstop against a future change to the pacing, not the mechanism.
 * `rules.test.ts` asserts both the arithmetic and the driven worst case.
 */
export const MAX_BLOCKS = 16;

/** First seat to this many points takes the match outright. */
export const TARGET_POINTS = 13;

/** A block settled in the middle of the pole. */
export const PERFECT_POINTS = 2;
/** A block that caught the pole anywhere. */
export const LANDED_POINTS = 1;

/**
 * The match is called after this long whatever else has happened.
 *
 * The block budget already bounds a match at 73.4 s, so nothing reaches this today. It is
 * here because `roundSeconds` in the manifest ends nothing — the catalogue card is its only
 * reader — and a game whose only guarantee lives in its pacing constants is one change away
 * from running for ever. See the note at the top of `termination.test.ts`.
 */
export const ROUND_SECONDS = 90;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export type Phase = 'playing' | 'over';

/** What one seat is doing. Each is left only by its own clock running out, or by a press. */
export type Stance = 'waiting' | 'airborne' | 'resting' | 'stumbling' | 'done';

/** How one block ended. Exactly one of these per block per seat. */
export type Landing = 'none' | 'perfect' | 'landed' | 'missed' | 'slipped' | 'lost';

export interface Block {
  /** False when this seat has no block on the rope. */
  live: boolean;
  /** True once a hop cut it loose and it is sliding free. */
  free: boolean;
  /** Swing amplitude, in units either side of the pole. */
  amp: number;
  /** Radians around the swing. Only meaningful while it still hangs. */
  phase: number;
  /** Where it was cut loose, and how fast. Only meaningful once free. */
  x0: number;
  v0: number;
  /** Seconds it has been sliding. Capped at the hop, because that is when it is judged. */
  slide: number;
}

export interface Perch {
  stance: Stance;
  /** Seconds this block has hung there, counting up to {@link HESITATE_SECONDS}. */
  wait: number;
  /** Seconds the chicken has been off the perch, counting up to {@link HANG_SECONDS}. */
  air: number;
  /** Seconds left of a rest or a stumble, counting down. */
  rest: number;
  /** Blocks hung up so far, out of {@link MAX_BLOCKS}. */
  used: number;
  readonly block: Block;
  points: number;
  /** Blocks settled in the middle. The first tie-break, and worth double. */
  perfects: number;
  /** Blocks that caught the pole off centre. */
  landed: number;
  /** Blocks that settled clear of the pole and fell. */
  missed: number;
  /** Blocks still sliding when the chicken came down. The second tie-break. */
  slips: number;
  /** Blocks nobody ever released. */
  losses: number;
  /** What the last block did, and how long ago, so the renderer can flash it. */
  last: Landing;
  since: number;
}

export interface Match {
  readonly p1: Perch;
  readonly p2: Perch;
  /**
   * Which side each block starts its swing from, and how wide it swings.
   *
   * Indexed by block number and drawn once, so seat one's fourth block and seat two's
   * fourth block are the same block. Preallocated: nothing here allocates per step.
   */
  readonly sides: number[];
  readonly amps: number[];
  /** How many entries of the two arrays above have been drawn. */
  drawn: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
  /** Seconds the match has run, for the backstop. */
  elapsed: number;
}

function createBlock(): Block {
  return { live: false, free: false, amp: SWING_MIN, phase: 0, x0: 0, v0: 0, slide: 0 };
}

function createPerch(): Perch {
  return {
    stance: 'resting',
    wait: 0,
    air: 0,
    rest: READY_SECONDS,
    used: 0,
    block: createBlock(),
    points: 0,
    perfects: 0,
    landed: 0,
    missed: 0,
    slips: 0,
    losses: 0,
    last: 'none',
    since: 0,
  };
}

export function createMatch(): Match {
  const sides: number[] = [];
  const amps: number[] = [];
  for (let i = 0; i < MAX_BLOCKS; i += 1) {
    sides.push(1);
    amps.push(SWING_MIN);
  }
  return {
    p1: createPerch(),
    p2: createPerch(),
    sides,
    amps,
    drawn: 0,
    phase: 'playing',
    winner: null,
    elapsed: 0,
  };
}

function resetPerch(perch: Perch): void {
  perch.stance = 'resting';
  perch.wait = 0;
  perch.air = 0;
  perch.rest = READY_SECONDS;
  perch.used = 0;
  perch.block.live = false;
  perch.block.free = false;
  perch.block.amp = SWING_MIN;
  perch.block.phase = 0;
  perch.block.x0 = 0;
  perch.block.v0 = 0;
  perch.block.slide = 0;
  perch.points = 0;
  perch.perfects = 0;
  perch.landed = 0;
  perch.missed = 0;
  perch.slips = 0;
  perch.losses = 0;
  perch.last = 'none';
  perch.since = 0;
}

export function resetMatch(match: Match): void {
  resetPerch(match.p1);
  resetPerch(match.p2);
  // The two arrays are cleared as well as `drawn`, so a reset match is indistinguishable
  // from a fresh one rather than merely behaving like one. Nothing reads a stale entry —
  // `ensureDrawn` overwrites by index before anybody looks — but a rematch that carried the
  // previous match's blocks in memory is exactly the kind of thing a later change trips
  // over, and this is a reset rather than a step, so it costs nothing that matters.
  for (let i = 0; i < MAX_BLOCKS; i += 1) {
    match.sides[i] = 1;
    match.amps[i] = SWING_MIN;
  }
  match.drawn = 0;
  match.phase = 'playing';
  match.winner = null;
  match.elapsed = 0;
}

export function perchOf(match: Match, seat: SeatId): Perch {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function pointsOf(match: Readonly<Match>, seat: SeatId): number {
  return seat === 'p1' ? match.p1.points : match.p2.points;
}

/** Blocks resting on this seat's pole. Drawn, never scored — the points already counted them. */
export function stackedOf(perch: Readonly<Perch>): number {
  return perch.perfects + perch.landed;
}

/** Blocks this seat has left, including the one on the rope. */
export function remainingOf(perch: Readonly<Perch>): number {
  return MAX_BLOCKS - perch.used;
}

/* ------------------------------------------------------------------ *
 * Perch-local space to world space.
 *
 * The only place the two perches stop being the same thing. p1 owns the bottom of the
 * field with its floor at the bottom edge; p2 owns the top with its floor at the top edge,
 * which is a half turn of p1's half about the centre of the field — exactly the transform
 * the shell already applies to the far seat's view. Both readings of the device are
 * therefore upright, and `rules.test.ts` asserts the point symmetry rather than trusting
 * the arithmetic here.
 * ------------------------------------------------------------------ */

/** Where a perch-local offset from the pole falls across the field. */
export function worldXOf(seat: SeatId, across: number): number {
  return seat === 'p1' ? FIELD_WIDTH / 2 + across : FIELD_WIDTH / 2 - across;
}

/** Where a perch-local height falls down the field. */
export function worldYOf(seat: SeatId, height: number): number {
  return seat === 'p1' ? FIELD_HEIGHT - height : height;
}

/* ------------------------------------------------------------------ *
 * The block
 * ------------------------------------------------------------------ */

/**
 * Where the block is right now, in units either side of the pole.
 *
 * Analytic on both sides of the release rather than integrated, so the answer does not
 * depend on the step size at all: a hanging block is `amp · sin(phase)`, and a cut-loose one
 * is exact constant-deceleration motion evaluated at the time it has been sliding. The
 * second half is what lets the landing be judged at the *instant* the chicken comes down
 * rather than at the end of whichever step contains it.
 */
export function blockX(block: Readonly<Block>): number {
  if (!block.free) return block.amp * Math.sin(block.phase);
  const speed = Math.abs(block.v0);
  const stopAt = speed / DECEL;
  const t = block.slide < stopAt ? block.slide : stopAt;
  const travelled = speed * t - (DECEL * t * t) / 2;
  return block.v0 < 0 ? block.x0 - travelled : block.x0 + travelled;
}

/** How fast the block is moving right now, signed. Zero once a free block has settled. */
export function blockVel(block: Readonly<Block>): number {
  if (!block.free) return block.amp * SWING_RATE * Math.cos(block.phase);
  const left = Math.abs(block.v0) - DECEL * block.slide;
  if (left <= 0) return 0;
  return block.v0 < 0 ? -left : left;
}

/**
 * Where the block would come to rest if it were cut loose this instant.
 *
 * **The one number the whole game turns on**, and the one the renderer draws as a shadow on
 * the pole so that nothing the bot reads is hidden from a player (CLAUDE.md rule 6).
 *
 * `x + v|v| / 2a` is the position plus the sliding distance, signed by the direction of
 * travel. Because the sliding distance goes as the *square* of the speed and the speed of a
 * pendulum is largest exactly where its position is smallest, the two terms are at odds:
 * at the outer end of a swing this is the block's own hanging position, far from the pole;
 * crossing the middle it is more than a swing's width past the pole on the far side. It
 * passes through zero exactly once on each inward swing, and that instant — around 84 units
 * out and still moving at 268 units a second — is the one to release on.
 */
export function stopPointOf(block: Readonly<Block>): number {
  const x = blockX(block);
  const v = blockVel(block);
  return x + (v * Math.abs(v)) / (2 * DECEL);
}

/** How long a block cut loose this instant would take to come to rest. */
export function settleSeconds(block: Readonly<Block>): number {
  return Math.abs(blockVel(block)) / DECEL;
}

/** How long the block took to settle after the release it actually got. */
export function releaseSettle(block: Readonly<Block>): number {
  return Math.abs(block.v0) / DECEL;
}

/**
 * Height of the hop above the perch, `air` seconds in.
 *
 * A parabola through zero at both ends, so the chicken leaves and arrives on the perch and
 * is at {@link HOP_APEX} halfway. Drawn rather than simulated: the hop is a fixed clock and
 * nothing about the match depends on where the chicken is mid-air, so giving it a velocity
 * would be state that could only ever disagree with the clock.
 */
export function hopHeight(airSeconds: number): number {
  const t = airSeconds / HANG_SECONDS;
  if (t <= 0 || t >= 1) return 0;
  return 4 * HOP_APEX * t * (1 - t);
}

/* ------------------------------------------------------------------ *
 * One seat's block
 * ------------------------------------------------------------------ */

/** Draw the next block's side and width, once, into the shared arrays. */
function ensureDrawn(match: Match, index: number, rng: Rng): void {
  while (match.drawn <= index && match.drawn < MAX_BLOCKS) {
    // One draw, both seats: this is what makes the two perches structurally equal, and it
    // is why the rng is consumed by the *match* and never by a perch.
    match.sides[match.drawn] = rng.bool() ? 1 : -1;
    match.amps[match.drawn] = SWING_MIN + rng.float() * (SWING_MAX - SWING_MIN);
    match.drawn += 1;
  }
}

/** Hang a block up for this seat. Starts at rest at one end of its swing. */
function hang(match: Match, perch: Perch, rng: Rng): void {
  const index = perch.used;
  ensureDrawn(match, index, rng);
  const block = perch.block;
  block.live = true;
  block.free = false;
  block.amp = match.amps[index] ?? SWING_MIN;
  // A quarter turn is the top of the swing, where the block is momentarily still — so a
  // block always arrives hanging rather than already flying past the pole.
  block.phase = (match.sides[index] ?? 1) > 0 ? QUARTER : QUARTER * 3;
  block.x0 = 0;
  block.v0 = 0;
  block.slide = 0;
  perch.used += 1;
  perch.stance = 'waiting';
  perch.wait = 0;
  perch.air = 0;
}

/** Cut the block loose and put the chicken in the air. */
function hop(perch: Perch): void {
  const block = perch.block;
  block.x0 = blockX(block);
  block.v0 = blockVel(block);
  block.free = true;
  block.slide = 0;
  perch.stance = 'airborne';
  perch.air = 0;
}

/**
 * How a block resolves against a chicken coming down on it.
 *
 * Three outcomes and the first is the interesting one. **Still sliding** — the block needed
 * longer than the hop to settle — and the chicken lands on something moving: a stumble,
 * worth nothing, and the block goes with it. Otherwise it has stopped, and the only question
 * is where: within the middle band it is worth double, anywhere else on the pole it is worth
 * one, and clear of the pole it falls.
 *
 * Deliberately *not* graded by how close a miss was. A block that settles one unit off the
 * end of the pole falls exactly as a block that settles a hundred units off does, because
 * the pole either catches it or it does not — and a near miss that scored something would
 * make the middle band a formality rather than the thing the game is about.
 */
export function judge(stop: number, settle: number, points: number): Landing {
  if (settle > HANG_SECONDS) return 'slipped';
  const off = Math.abs(stop);
  if (off > landOf(points)) return 'missed';
  return off <= perfectOf(points) ? 'perfect' : 'landed';
}

/** Bank a landing and start the clock on the next block. */
function settle(perch: Perch, landing: Landing): Landing {
  perch.last = landing;
  perch.since = 0;
  perch.block.live = false;
  if (landing === 'perfect') {
    perch.points += PERFECT_POINTS;
    perch.perfects += 1;
  } else if (landing === 'landed') {
    perch.points += LANDED_POINTS;
    perch.landed += 1;
  } else if (landing === 'missed') {
    perch.missed += 1;
  } else if (landing === 'slipped') {
    perch.slips += 1;
  } else {
    perch.losses += 1;
  }
  perch.stance = landing === 'slipped' ? 'stumbling' : 'resting';
  perch.rest = landing === 'slipped' ? STUMBLE_SECONDS : REST_SECONDS;
  return landing;
}

/**
 * Advance one seat by one step and report what its block did.
 *
 * The block's position is analytic, so a landing is judged on the block's exact state at
 * `HANG_SECONDS` however the step happens to fall. At the crossing the stopping point sweeps
 * 13 to 17 units in a 60 Hz step, against a middle band that has narrowed to 27 by the end of
 * a match, so judging on the step boundary instead would decide half the close ones by where
 * the frame happened to land.
 */
export function stepPerch(
  match: Match,
  perch: Perch,
  jump: boolean,
  fixedDeltaSeconds: number,
  rng: Rng,
): Landing {
  perch.since += fixedDeltaSeconds;

  if (perch.stance === 'done') return 'none';

  if (perch.stance === 'resting' || perch.stance === 'stumbling') {
    perch.rest -= fixedDeltaSeconds;
    if (perch.rest > 0) return 'none';
    perch.rest = 0;
    if (perch.used >= MAX_BLOCKS) {
      perch.stance = 'done';
      return 'none';
    }
    hang(match, perch, rng);
    return 'none';
  }

  if (perch.stance === 'waiting') {
    perch.wait += fixedDeltaSeconds;
    // The press is answered **before** the swing moves on, so a release lands on the block
    // that was there when the button went down rather than on the one a frame later. Input
    // for this step was sampled from the frame the player was looking at, so answering it
    // against the next frame's block would charge everybody a sixtieth of a second of lead
    // they had no way to know about — 14 units of stopping point at the crossing, which is
    // most of the middle band by the end of a match.
    if (jump) {
      hop(perch);
      return 'none';
    }
    perch.block.phase += SWING_RATE * fixedDeltaSeconds;
    if (perch.block.phase >= TAU) perch.block.phase -= TAU;
    // A block nobody ever released is cut down and counts against the budget, which is what
    // makes a match between two people who never press end rather than hang.
    if (perch.wait >= HESITATE_SECONDS) return settle(perch, 'lost');
    return 'none';
  }

  perch.air += fixedDeltaSeconds;
  // Capped, so the block is frozen at exactly the state it was in when the chicken landed
  // even if the step overshoots. Everything past the hop is the renderer's business.
  perch.block.slide = perch.air < HANG_SECONDS ? perch.air : HANG_SECONDS;
  if (perch.air < HANG_SECONDS) return 'none';
  return settle(perch, judge(stopPointOf(perch.block), releaseSettle(perch.block), perch.points));
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
 * First to {@link TARGET_POINTS}, and the highest score when the blocks run out.
 *
 * Both halves come out of the SDK's `resolve` rather than being compared here, so "first to
 * sixteen" means in this game exactly what it means in every other one, and the case where
 * both seats cross on the same block is not left to whichever seat the code happened to
 * check first.
 */
const CONDITION: WinCondition = { kind: 'first-to', target: TARGET_POINTS };

/** Scratch for `resolve`, so calling it every step allocates nothing. */
const tally = { p1: 0, p2: 0 };
const options = { timeExpired: false };

export function spent(match: Readonly<Match>): boolean {
  return match.p1.stance === 'done' && match.p2.stance === 'done';
}

/**
 * Separate two seats that `resolve` called level.
 *
 * More middles first: two players on the same points are not equal if one of them got there
 * by settling blocks in the middle of the pole and the other by scraping the ends of it.
 * Then fewer stumbles, because a block lost by leaving it sliding is the mistake this game
 * is about. Only a pair level on all three is a draw.
 *
 * The tie-breaks exist because the two seats are set identical blocks, so two evenly matched
 * players finish level far more often than they would in a game where they took turns — and
 * both of them say something true rather than merely picking a seat.
 */
export function breakTie(match: Readonly<Match>): SeatId | 'draw' {
  if (match.p1.perfects !== match.p2.perfects) {
    return match.p1.perfects > match.p2.perfects ? 'p1' : 'p2';
  }
  if (match.p1.slips !== match.p2.slips) {
    return match.p1.slips < match.p2.slips ? 'p1' : 'p2';
  }
  return 'draw';
}

/** Call the match if it is over. Safe to call every step; does nothing until it is. */
export function decide(match: Match): void {
  if (match.phase === 'over') return;
  tally.p1 = match.p1.points;
  tally.p2 = match.p2.points;
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
 * The two perches are stepped with their own player's press and neither can read or touch
 * the other, which is the property the whole design rests on: there is no order-of-play
 * advantage to be had because there is no shared object. The one thing they share is the
 * stream the blocks are drawn from, and that is consumed **by block index** rather than by
 * time, so it hands the two seats the same blocks whatever pace they play at.
 */
export function step(
  match: Match,
  p1Jump: boolean,
  p2Jump: boolean,
  fixedDeltaSeconds: number,
  rng: Rng,
): StepResult {
  result.p1 = 'none';
  result.p2 = 'none';
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;
  result.p1 = stepPerch(match, match.p1, p1Jump, fixedDeltaSeconds, rng);
  result.p2 = stepPerch(match, match.p2, p2Jump, fixedDeltaSeconds, rng);
  decide(match);
  return result;
}

/* ------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks. It cannot press between two of them, so this is both how long it
   * takes to notice the moment and how finely it can place a release inside one.
   */
  readonly reaction: number;
  /**
   * How far off it reads the stopping point, in logical units.
   *
   * Drawn **once per block and held**, never per step. A fresh error sixty times a second
   * averages to zero and every tier plays the same — the bug the SDK's `misjudgement`
   * exists to prevent, and which three games in this repository shipped before it did.
   */
  readonly error: number;
  /** How often it loses the block altogether, in blunders a second. */
  readonly blunder: number;
  /**
   * Seconds of "still sliding" it is willing to risk when it releases.
   *
   * Not information: every tier can see the block's speed, and the stopping shadow the
   * renderer draws is the same shadow the bot reads. This is how well it *judges* that
   * speed against its own hop, which is the first thing a beginner at this game gets wrong
   * and the last thing they stop getting wrong.
   */
  readonly haste: number;
}

/**
 * The three tiers, expressed only as reaction, aim error, blunder rate and haste.
 *
 * None of them gets a longer hop, a wider pole, a slower swing, a shorter stumble, or a look
 * at anything a player cannot see (CLAUDE.md rule 6). All three run the identical policy in
 * {@link botJump} and press through the identical {@link step}. `hard` is better because it
 * looks twenty times a second and reads the shadow nearly true; `easy` is worse because it
 * looks three times a second, which is also all the finer it can place a release, and
 * because it misreads the shadow by more than the whole pole is wide.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.3, error: 96, blunder: 0.42, haste: 0.12 },
  normal: { reaction: 0.125, error: 52, blunder: 0.28, haste: 0.025 },
  hard: { reaction: 0.08, error: 40, blunder: 0.2, haste: 0 },
});

/**
 * How long a blunder lasts.
 *
 * A duration rather than a coin flip resolved every step: a bot that re-decides twenty times
 * a second and hesitates for one of those has not blundered, it has jittered, and the next
 * look undoes it before it has cost anything. Held this long it misses the instant it was
 * lining up and has to wait most of a swing for the next one.
 */
export const BLUNDER_SECONDS = 0.45;

/**
 * How much of the hesitation clock the bot spends holding out for the middle.
 *
 * Not a difficulty knob — every tier uses it, because it is a fact about the game rather
 * than about the player: a block is worth two in the middle and one anywhere on the pole,
 * and nothing at all once the rope is cut. Holding out for the middle for the first swing
 * and a half and then taking whatever catches is what the scoring makes correct.
 */
export const BOT_PATIENCE = 0.55;

/**
 * How much a look interval is allowed to wander, as a fraction either side of the tier's
 * reaction time.
 *
 * **Not a flourish: without it the tiers do not order at all.** A bot that looks on a
 * perfectly regular tick, at a block that always starts its swing from the same place, lands
 * every one of its looks on the same swing phases for the whole match — so the offset
 * between its looks and the instant it wants is a *fixed* error rather than a spread, and it
 * never averages out over any number of blocks. Measured with the aim error switched off
 * entirely, arrival error swung between 7 and 33 units as the reaction time was stepped from
 * 0.04 s to 0.3 s, in no order whatever, and swamped the aim error at every tier: sweeping
 * the error from 0 to 40 units moved arrival by 0.9 units. Two of the three knobs did
 * nothing and the middle tier came out strongest.
 *
 * Letting the interval wander over the seeded stream breaks the lock, and it is also simply
 * true — nobody glances at anything on a metronome.
 */
export const LOOK_JITTER = 0.35;

/** How much of the pole the bot will settle for once it has stopped holding out. */
export const BOT_SETTLE = 0.95;

export interface BotState {
  /** Seconds until the next look. */
  look: number;
  /** How far off it is reading the shadow on this block. Drawn once, held to the release. */
  bias: number;
  /** Whether {@link BotState.bias} belongs to the block currently on the rope. */
  armed: boolean;
  /** Seconds of blunder left, during which it does nothing at all. */
  frozen: number;
  /** The shadow it read at its previous look, so it can tell which way the shadow is going. */
  previous: number;
  /** False until a first look has been taken on this block. */
  sampled: boolean;
}

export function createBotState(): BotState {
  return { look: 0, bias: 0, armed: false, frozen: 0, previous: 0, sampled: false };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.bias = 0;
  state.armed = false;
  state.frozen = 0;
  state.previous = 0;
  state.sampled = false;
}

/**
 * Whether the bot presses this step.
 *
 * The policy in one sentence: **read the shadow, and release on the look where waiting
 * another look would put it further from the pole than it is now.**
 *
 * That last clause is the part that took measuring. The obvious version releases at the
 * first look where the shadow is inside the band it will accept — and because the shadow
 * sweeps in from one side, that puts every release on the *entering* edge of the band. The
 * tiers then differ in how far in they get before they commit rather than in how accurate
 * they are, `hard` lands consistently 20 units to one side, and the whole thing measures
 * reaction time twice instead of measuring reaction and aim once each. Comparing this look
 * with where the next one would be centres the release on the pole, so the only thing left
 * separating the tiers is the spread — which is exactly what reaction and error govern.
 *
 * Nothing here reads a value a player cannot see: the shadow is drawn on the pole, the
 * block's speed is the block's speed, and how many points the bot has is on the scoreboard.
 */
export function botJump(
  perch: Readonly<Perch>,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): boolean {
  const profile = BOT_PROFILES[difficulty];

  if (perch.stance !== 'waiting') {
    // Between blocks there is nothing to aim at, so the held misjudgement is dropped and a
    // fresh one is drawn for the next block. A bias carried across blocks would be one
    // long-lived error rather than a series of independent ones.
    state.armed = false;
    state.sampled = false;
    if (state.frozen > 0) state.frozen -= fixedDeltaSeconds;
    return false;
  }

  if (!state.armed) {
    state.bias = misjudgement(rng.float(), profile.error);
    state.armed = true;
    state.sampled = false;
    state.look = 0;
  }

  if (state.frozen > 0) {
    state.frozen -= fixedDeltaSeconds;
    return false;
  }

  state.look -= fixedDeltaSeconds;
  if (state.look > 0) return false;
  // Reset outright rather than left negative, so a long step cannot bank credit towards the
  // next look and let a slow bot look twice in quick succession. See {@link LOOK_JITTER} for
  // why the interval wanders instead of ticking.
  state.look = profile.reaction * (1 + (rng.float() * 2 - 1) * LOOK_JITTER);

  if (profile.blunder > 0 && rng.bool(profile.blunder * profile.reaction)) {
    state.frozen = BLUNDER_SECONDS;
    return false;
  }

  const block = perch.block;
  const shadow = stopPointOf(block) + state.bias;
  const previous = state.previous;
  const sampled = state.sampled;
  state.previous = shadow;
  state.sampled = true;
  // A first look establishes which way the shadow is moving and nothing else, exactly as a
  // person glancing up cannot act on a single glance.
  if (!sampled) return false;

  // Too fast to settle before the chicken is down. Every tier can see this; `haste` is how
  // much of it each tier is willing to talk itself out of.
  if (settleSeconds(block) > HANG_SECONDS + profile.haste) return false;

  const accept =
    perch.wait < HESITATE_SECONDS * BOT_PATIENCE
      ? perfectOf(perch.points)
      : landOf(perch.points) * BOT_SETTLE;
  if (Math.abs(shadow) > accept) return false;

  // Where the shadow would be at the next look, extrapolated from the last two.
  const next = shadow + (shadow - previous);
  return Math.abs(next) >= Math.abs(shadow);
}
