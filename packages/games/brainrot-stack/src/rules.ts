import type { Rng, SeatId } from '@duelbox/engine';
import { misjudgement, resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Wobble Stack, as pure rules.
 *
 * A plinth each. A brainrot hangs over your plinth from a rail of fifteen notches; you
 * shunt it left and right a notch at a time and tap to let it go. It drops onto whatever
 * is already there. **If a brainrot ever leaves your plinth — because it missed the tower
 * on the way down, or because the tower it landed on went over — you have lost.**
 *
 * Two things wobble, and between them they are the whole game.
 *
 * 1. **The brainrot wobbles on the rail, because you shunted it.** Every hop the carrier
 *    makes drags the thing hanging off it, and it swings. Nothing seeded and nothing
 *    hidden: a brainrot nobody touches hangs dead still, and a brainrot walked the length
 *    of the rail is swinging twenty units either way. So the cost of moving is that you
 *    then have to wait for it to settle, against a hover clock that is running.
 * 2. **The tower wobbles, because of where its weight is.** A stack of brainrots is one
 *    springy column: it has a rest lean set by where its weight falls, it rings about that
 *    rest lean when something lands on it, and its top is carried sideways in proportion
 *    to how high it is. A tall tower amplifies a small imbalance — see
 *    {@link swayScaleAt} — which is why the tower that was comfortable at five brainrots
 *    is on the edge at twenty with the same offset.
 *
 * Both are the *same* damped oscillator, advanced by the *same* {@link advanceWobble},
 * which evaluates the closed form over a step rather than integrating towards it. That is
 * what makes 60 Hz and 240 Hz step the identical match, and what lets the bot predict
 * where a brainrot will land by running the simulation's own code on scratch scalars
 * rather than by an analytic shortcut that would agree with it only to a few decimals
 * (#2465).
 *
 * **What the player controls is a notch and a moment.** A notch is one of fifteen
 * integers, and a moment is a press with a timestamp. Both are things a thumb, a
 * trackpad and a keyboard can name identically — see `SPEC.md`, which is where the
 * catalogue row's "drag left and right" went.
 *
 * Everything here is in **plinth-local** coordinates: `x` is signed distance from your own
 * plinth's centre line, height is measured up from your own plinth's top surface. Both
 * plinths hold literally the same numbers; the half turn that separates them lives in
 * {@link worldXOf} and {@link worldYOf}, which only the renderer calls.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit; nothing is in pixels.
 */

/* ------------------------------------------------------------------ *
 * The field
 * ------------------------------------------------------------------ */

export const FIELD_WIDTH = 600;
export const FIELD_HEIGHT = 1000;

/**
 * How tall one seat's half is.
 *
 * Two of these plus the gutter make the field, so the layout is a point reflection about
 * the centre of the box: each player's plinth stands on the edge nearest them and the
 * strip that belongs to neither is in the middle.
 */
export const YARD_HEIGHT = 470;
/** The band between the two yards, which belongs to neither seat. */
export const GUTTER = FIELD_HEIGHT - YARD_HEIGHT * 2;

/** How far above a seat's own edge of the field its plinth's top surface sits. */
export const PLINTH_DEPTH = 70;

/**
 * Half the width of the plinth.
 *
 * The tower stands while its weight is over this strip, so it is the number the whole
 * game is measured against.
 */
export const PLINTH_HALF = 78;

/* ------------------------------------------------------------------ *
 * The notch rail
 * ------------------------------------------------------------------ */

/**
 * How far apart two adjacent notches are.
 *
 * **Half of the answer to "drag left and right".** A drag is a continuous quantity and a
 * key is not, so binding the drop position to the drag directly hands a thumb a placement
 * no keyboard can name. The carrier instead occupies one of `2 × SLOT_LIMIT + 1` notches
 * and nothing between: a finger names the notch nearest it, a key names the next notch
 * along, and both go through {@link SLOT_SECONDS}. The other half of the answer is the
 * moment you tap, which is a press with a timestamp and identical on every instrument.
 */
export const SLOT_PITCH = 22;

/**
 * How many notches either side of the centre line.
 *
 * Deliberately well past the edge of the plinth: **the losing move has to be reachable**,
 * or "the first player to drop a brainrot off the platform loses" is a rule about nothing.
 * Notch 4 already overhangs the plinth and notch 7 is 154 units out, past it by half a
 * plinth again.
 */
export const SLOT_LIMIT = 7;

/**
 * Seconds the carrier takes to hop one notch.
 *
 * **One rate for both instruments**, and with {@link SLOT_PITCH} the whole of this game's
 * input-parity answer: a finger names a notch and the carrier hops towards it at this
 * rate, a held key hops it at this rate, and neither can jump.
 */
export const SLOT_SECONDS = 0.085;

/** How far the carrier hangs above the top of the tower. Also how far a brainrot falls. */
export const CARRY_GAP = 96;

/* ------------------------------------------------------------------ *
 * The brainrots
 * ------------------------------------------------------------------ */

/** One kind of brainrot. Symmetric about its own centre, so there is nothing to rotate. */
export interface Kind {
  readonly name: string;
  /** Half its width. It stands on this strip, and the next one stands on the same strip. */
  readonly half: number;
  /** How tall it is, so the tower has a height. */
  readonly tall: number;
  /** How heavy it is, relative to a blob at 1. */
  readonly mass: number;
}

/**
 * The six brainrots, ordered from the easiest thing to stack to the worst. **[ours]**
 *
 * The order is load-bearing: {@link dealWindowHigh} slides its draw window up this list as
 * the tower grows, so a match opens with blobs and ends with teeth. Two properties do the
 * work and both are visible on the screen:
 *
 * - **They get narrower.** A blob on a blob gives 60 units of slack either way; a tooth on
 *   a tooth gives 14, which is under one notch, so late in a match one or two of the
 *   fifteen notches are legal at all and the swing has to be dead when you let go.
 * - **They get heavier for their width.** A wafer is 13 across and twice a blob's mass, so
 *   a wafer put down off centre moves the tower's weight much further than a blob does.
 *
 * Nothing here is asymmetric and nothing rotates: a brainrot is drawn about its own centre
 * line, so there is no facing to get wrong, and the catalogue row's "tap to rotate" is
 * deliberately not built (`SPEC.md` says why).
 */
export const KINDS: readonly Kind[] = [
  { name: 'blob', half: 33, tall: 26, mass: 1.0 },
  { name: 'pillow', half: 27, tall: 32, mass: 1.3 },
  { name: 'cog', half: 22, tall: 28, mass: 1.7 },
  { name: 'noodle', half: 17, tall: 42, mass: 1.0 },
  { name: 'wafer', half: 13, tall: 20, mass: 2.1 },
  { name: 'tooth', half: 10, tall: 46, mass: 1.5 },
];

export const KIND_COUNT = KINDS.length;

/**
 * The narrowest strip of contact a brainrot can stand on at all.
 *
 * Below this it has a corner on the edge rather than a footing, and it goes over the side.
 * Without it the arithmetic would happily balance a tooth on a contact a thousandth of a
 * unit wide, which is a rounding error rather than a game. **[ours]**
 *
 * It is bounded from above by {@link SLOT_PITCH}: the narrowest pair of brainrots must
 * still leave a window at least one notch wide, or a placement would be impossible rather
 * than hard. `rules.test.ts` asserts that for every pair in {@link KINDS}.
 */
export const MIN_CONTACT = 6;

/* ------------------------------------------------------------------ *
 * The two oscillators
 * ------------------------------------------------------------------ */

/**
 * One damped oscillator: a value, its rate, and the value it is heading back towards.
 *
 * Two of these per yard — the brainrot's swing on the rail and the tower's lean — and one
 * more in module scope that the bot predicts on. The bot's copy is the point: it runs the
 * simulation's own {@link advanceWobble} rather than a closed form of its own, so its idea
 * of where a brainrot will land is bit-identical to where the simulation puts it (#2465).
 */
export interface Wobble {
  value: number;
  rate: number;
  /** What it settles to. Zero for the swing; the tower's rest lean for the lean. */
  rest: number;
  /** The lowest and highest value reached *inside* the step just advanced. */
  low: number;
  high: number;
}

export function createWobble(): Wobble {
  return { value: 0, rate: 0, rest: 0, low: 0, high: 0 };
}

export function resetWobble(wobble: Wobble): void {
  wobble.value = 0;
  wobble.rate = 0;
  wobble.rest = 0;
  wobble.low = 0;
  wobble.high = 0;
}

/** The tower's natural frequency in radians a second, and its damping ratio. */
export const LEAN_OMEGA = 5.2;
export const LEAN_ZETA = 0.16;

/**
 * The hanging brainrot's, which is faster and lighter.
 *
 * A 0.9 s swing against a hover clock between 2.3 s and 0.85 s: long enough that you can
 * watch one go by and pick the crossing, short enough that a hurried player gets two or
 * three chances rather than one.
 */
export const SWING_OMEGA = 7.0;
export const SWING_ZETA = 0.12;

/**
 * How hard one hop of the carrier drags the brainrot hanging off it, in units a second.
 *
 * One hop leaves it swinging about four units either way, which is nothing; seven hops
 * inside two thirds of a swing period mostly add, which is about twenty and is most of a
 * notch. That asymmetry is the whole cost of moving: crossing the rail is free in time and
 * expensive in swing, and the swing has to be paid off before you let go.
 */
export const SHOVE = 26;

/** Derived once per oscillator: the decay rate, the damped frequency, and half a ring. */
interface Solution {
  readonly sigma: number;
  readonly omegaD: number;
  readonly omegaSq: number;
  readonly halfRing: number;
}

function solutionFor(omega: number, zeta: number): Solution {
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  return {
    sigma: zeta * omega,
    omegaD,
    omegaSq: omega * omega,
    halfRing: Math.PI / omegaD,
  };
}

export const LEAN = solutionFor(LEAN_OMEGA, LEAN_ZETA);
export const SWING = solutionFor(SWING_OMEGA, SWING_ZETA);

/**
 * How many units of weight offset buy one radian of rest lean, at this centre-of-mass
 * height.
 *
 * The rest lean is `com / swayScaleAt(comHeight)` and the weight then sits at
 * `com + comHeight × rest`, so the amplification of a given imbalance grows **quadratically**
 * with the height of the tower. That is the difficulty ramp, and it comes out of the
 * physics rather than out of a per-index table: two brainrots high, 5 units of offset put
 * the weight 9 units off centre; twenty high, the same 5 units put it 158 off and the
 * plinth is 78. **[ours]** — a real column's stiffness falls off with height and this is
 * the one-parameter caricature of that.
 */
export function swayScaleAt(comHeight: number): number {
  return SWAY_BASE / (1 + comHeight / SWAY_KNEE);
}

export const SWAY_BASE = 45;
export const SWAY_KNEE = 120;

/**
 * How hard a landing thumps the tower, in radians a second per radian of rest lean.
 *
 * A brainrot landing off the centre line does two things: it moves the rest lean, which
 * displaces the oscillator because the tower's actual lean cannot change instantly, and it
 * thumps the column, which is this. The thump is scaled by the landing brainrot's share of
 * the total mass, so an early brainrot rings the tower hard and a late one barely moves it
 * — by then the rest-lean jump is doing the work.
 */
export const IMPACT = 2.1;

/* ------------------------------------------------------------------ *
 * Pacing
 * ------------------------------------------------------------------ */

/** Both plinths sit empty for this long before the first brainrot arrives. */
export const OPENING_SECONDS = 0.8;
/** How long a brainrot takes to fall, whatever it was dropped from. */
export const FALL_SECONDS = 0.26;
/** The pause between a landing and the next brainrot arriving. */
export const RELOAD_SECONDS = 0.22;

/** The hover clock at the first brainrot, how fast it shortens, and its floor. */
export const HOVER_MAX = 2.3;
export const HOVER_FALL = 0.07;
export const HOVER_MIN = 0.85;

/** How many brainrots a seat is dealt before its plinth is declared safe. */
export const PIECE_CAP = 22;

/**
 * The backstop, in simulated seconds.
 *
 * `roundSeconds` on the manifest ends nothing — it is catalogue copy — so the clock that
 * does end a match lives here. Nothing reaches it; see the arithmetic bound in `SPEC.md`.
 */
export const ROUND_SECONDS = 90;

/** How long a finished tower is given to stop ringing before it is called safe. */
export const SETTLE_MAX_SECONDS = 6;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export type Stance = 'opening' | 'hover' | 'falling' | 'reload' | 'settling' | 'done';
export type Loss = 'none' | 'missed' | 'toppled';
export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** One brainrot on the tower. `x` is where its centre line sits, `base` its underside. */
export interface Placed {
  kind: number;
  x: number;
  base: number;
}

export interface Yard {
  readonly seat: SeatId;

  /* the tower */
  readonly pieces: Placed[];
  count: number;
  /** Total height of the tower, so the next brainrot knows where the top is. */
  top: number;
  mass: number;
  /** The mass-weighted mean `x`, and the mass-weighted mean centre height. */
  com: number;
  comHeight: number;
  /** The tower's lean, in radians. Positive leans towards positive `x`. */
  readonly lean: Wobble;

  /* the carrier */
  /** The brainrot's offset from its notch, in units, because you shunted it. */
  readonly swing: Wobble;
  /** How many brainrots this seat has been dealt, including the one on the rail. */
  dealt: number;
  stance: Stance;
  /** Which notch the carrier is on. Always an integer in [-SLOT_LIMIT, SLOT_LIMIT]. */
  slot: number;
  /** Seconds until the carrier may hop again. */
  cool: number;
  hover: number;
  fall: number;
  reload: number;
  settle: number;
  /** Where the falling brainrot left the rail. It falls straight down from there. */
  dropX: number;

  /* the verdict */
  out: boolean;
  loss: Loss;
  /** The narrowest margin this tower has ever had. The tie-break, and the balance bar. */
  worst: number;
  /** Seconds a landing is flashed for, and where it landed. Drawn only. */
  flash: number;
  flashX: number;
}

export interface Match {
  readonly p1: Yard;
  readonly p2: Yard;
  elapsed: number;
  /** The shared deal, filled in index order so both seats are set identical problems. */
  readonly dealKind: number[];
  readonly dealSlot: number[];
  dealtUpTo: number;
}

/** What one seat is asking for this step. Rewritten in place; never allocated per step. */
export interface Intent {
  /** True when a finger is naming a notch outright. */
  aimActive: boolean;
  /** The notch a finger is naming. Meaningless unless `aimActive`. */
  aimSlot: number;
  /** A key's direction, in [-1, 1]. Only read when no finger is down. */
  nudge: number;
  /** Let the brainrot go, now. */
  drop: boolean;
}

export function createIntent(): Intent {
  return { aimActive: false, aimSlot: 0, nudge: 0, drop: false };
}

export function clearIntent(intent: Intent): void {
  intent.aimActive = false;
  intent.aimSlot = 0;
  intent.nudge = 0;
  intent.drop = false;
}

function createYard(seat: SeatId): Yard {
  const pieces: Placed[] = [];
  for (let i = 0; i < PIECE_CAP; i += 1) pieces.push({ kind: 0, x: 0, base: 0 });
  return {
    seat,
    pieces,
    count: 0,
    top: 0,
    mass: 0,
    com: 0,
    comHeight: 0,
    lean: createWobble(),
    swing: createWobble(),
    dealt: 0,
    stance: 'opening',
    slot: 0,
    cool: 0,
    hover: 0,
    fall: 0,
    reload: OPENING_SECONDS,
    settle: 0,
    dropX: 0,
    out: false,
    loss: 'none',
    worst: PLINTH_HALF,
    flash: 0,
    flashX: 0,
  };
}

export function resetYard(yard: Yard): void {
  for (let i = 0; i < PIECE_CAP; i += 1) {
    const piece = yard.pieces[i];
    if (piece === undefined) continue;
    piece.kind = 0;
    piece.x = 0;
    piece.base = 0;
  }
  yard.count = 0;
  yard.top = 0;
  yard.mass = 0;
  yard.com = 0;
  yard.comHeight = 0;
  resetWobble(yard.lean);
  resetWobble(yard.swing);
  yard.dealt = 0;
  yard.stance = 'opening';
  yard.slot = 0;
  yard.cool = 0;
  yard.hover = 0;
  yard.fall = 0;
  yard.reload = OPENING_SECONDS;
  yard.settle = 0;
  yard.dropX = 0;
  yard.out = false;
  yard.loss = 'none';
  yard.worst = PLINTH_HALF;
  yard.flash = 0;
  yard.flashX = 0;
}

export function createMatch(): Match {
  const dealKind: number[] = [];
  const dealSlot: number[] = [];
  for (let i = 0; i < PIECE_CAP; i += 1) {
    dealKind.push(0);
    dealSlot.push(0);
  }
  return {
    p1: createYard('p1'),
    p2: createYard('p2'),
    elapsed: 0,
    dealKind,
    dealSlot,
    dealtUpTo: 0,
  };
}

export function resetMatch(match: Match): void {
  resetYard(match.p1);
  resetYard(match.p2);
  match.elapsed = 0;
  for (let i = 0; i < PIECE_CAP; i += 1) {
    match.dealKind[i] = 0;
    match.dealSlot[i] = 0;
  }
  match.dealtUpTo = 0;
}

export function yardOf(match: Match, seat: SeatId): Yard {
  return seat === 'p1' ? match.p1 : match.p2;
}

/* ------------------------------------------------------------------ *
 * Coordinates
 * ------------------------------------------------------------------ */

/** Where a plinth-local offset falls across the field. */
export function worldXOf(seat: SeatId, x: number): number {
  return seat === 'p1' ? FIELD_WIDTH / 2 + x : FIELD_WIDTH / 2 - x;
}

/** Where a plinth-local height falls down the field. */
export function worldYOf(seat: SeatId, height: number): number {
  return seat === 'p1' ? FIELD_HEIGHT - PLINTH_DEPTH - height : PLINTH_DEPTH + height;
}

/**
 * A point on the device, read back as this seat's own offset.
 *
 * The far player is reading the device the other way up, so their own left is the device's
 * right. That half turn lives here and nowhere else, and it is applied to input exactly as
 * {@link worldXOf} applies it to output.
 */
export function xOfWorld(seat: SeatId, worldX: number): number {
  return seat === 'p1' ? worldX - FIELD_WIDTH / 2 : FIELD_WIDTH / 2 - worldX;
}

/**
 * The notch nearest a plinth-local offset.
 *
 * Rounded on the magnitude and then signed, rather than `Math.round(x / SLOT_PITCH)`,
 * because `Math.round` breaks its ties upwards: it sends 0.5 to 1 and -0.5 to -0, so the
 * two seats would disagree about a finger exactly between two notches. The engine
 * quantises every pointer onto a 3-unit lattice and 11 is a multiple of 3, so that tie is
 * an everyday event here rather than a measure-zero one.
 */
export function slotOfX(x: number): number {
  const raw = x < 0 ? -Math.round(-x / SLOT_PITCH) : Math.round(x / SLOT_PITCH);
  if (raw > SLOT_LIMIT) return SLOT_LIMIT;
  if (raw < -SLOT_LIMIT) return -SLOT_LIMIT;
  return raw;
}

/* ------------------------------------------------------------------ *
 * The deal
 * ------------------------------------------------------------------ */

/** The highest kind index the deal will offer at this brainrot index. */
export function dealWindowHigh(index: number): number {
  const raw = 1 + Math.floor((index * (KIND_COUNT - 1)) / (PIECE_CAP - 1));
  return raw < KIND_COUNT - 1 ? raw : KIND_COUNT - 1;
}

/** The lowest kind index the deal will offer at this brainrot index. */
export function dealWindowLow(index: number): number {
  const low = dealWindowHigh(index) - 2;
  return low > 0 ? low : 0;
}

/**
 * How far out a brainrot may be delivered at this index, in notches.
 *
 * Never nearer than notch two, which is what makes an untouched brainrot a losing move
 * from the fourth one on: notch two is 44 units out, past the edge of anything narrower
 * than a blob.
 */
export function deliveryReachAt(index: number): number {
  const raw = 2 + Math.floor(index / 4);
  return raw < SLOT_LIMIT ? raw : SLOT_LIMIT;
}

/** How long the carrier holds the `index`-th brainrot before letting go itself. */
export function hoverSecondsAt(index: number): number {
  const raw = HOVER_MAX - index * HOVER_FALL;
  return raw > HOVER_MIN ? raw : HOVER_MIN;
}

/**
 * Fill the shared deal up to and including `index`.
 *
 * Drawn **by index**, never by seat, so what either player does cannot change which
 * brainrots either of them is given: the nth brainrot of the match is the same kind
 * arriving on the same notch for both seats. Two people are therefore set the identical
 * run of problems rather than merely balanced on average.
 */
function ensureDealt(match: Match, index: number, rng: Rng): void {
  while (match.dealtUpTo <= index && match.dealtUpTo < PIECE_CAP) {
    const i = match.dealtUpTo;
    match.dealKind[i] = rng.int(dealWindowLow(i), dealWindowHigh(i) + 1);
    const magnitude = rng.int(2, deliveryReachAt(i) + 1);
    match.dealSlot[i] = rng.bool() ? magnitude : -magnitude;
    match.dealtUpTo = i + 1;
  }
}

/* ------------------------------------------------------------------ *
 * Statics
 * ------------------------------------------------------------------ */

/** Half the width of whatever the `index`-th brainrot has to land on. */
export function supportHalfAt(yard: Readonly<Yard>, index: number): number {
  if (index <= 0) return PLINTH_HALF;
  const under = yard.pieces[index - 1];
  return under === undefined ? PLINTH_HALF : (KINDS[under.kind]?.half ?? PLINTH_HALF);
}

/** Where the centre of whatever the `index`-th brainrot has to land on sits. */
export function supportCentreAt(yard: Readonly<Yard>, index: number): number {
  if (index <= 0) return 0;
  return yard.pieces[index - 1]?.x ?? 0;
}

/**
 * How far either side of its support a brainrot of this kind may land and still stand.
 *
 * The contact is the overlap of two intervals, so it is `half + supportHalf - |gap|`, and
 * the brainrot stands while that is at least {@link MIN_CONTACT}. There is one comparison
 * in this game rather than two that could disagree.
 */
export function landingSlackFor(kind: number, supportHalf: number): number {
  return (KINDS[kind]?.half ?? 0) + supportHalf - MIN_CONTACT;
}

/** Where the tower's weight sits across the plinth, at the given lean. */
export function weightAt(yard: Readonly<Yard>, lean: number): number {
  return yard.com + yard.comHeight * lean;
}

/** How much plinth the tower has left, at the given lean. Negative means it has gone. */
export function marginAt(yard: Readonly<Yard>, lean: number): number {
  return PLINTH_HALF - Math.abs(weightAt(yard, lean));
}

/** The worst margin reached anywhere inside the step just advanced. */
function marginOverStep(yard: Readonly<Yard>): number {
  const a = marginAt(yard, yard.lean.low);
  const b = marginAt(yard, yard.lean.high);
  return a < b ? a : b;
}

/**
 * How far the tower has carried a point at this height sideways.
 *
 * A leaning column carries every point on it sideways in proportion to how high that point
 * is, and a brainrot in free fall does not lean with it — so this is exactly the gap
 * between where a brainrot left the rail and where it arrives.
 */
export function driftAt(yard: Readonly<Yard>, height: number): number {
  return yard.lean.value * height;
}

/**
 * The amplitude a ring still has left.
 *
 * `value(t) - rest = e^(-sigma t) R cos(omega_d t - phase)`, so `R` bounds every value the
 * oscillator will ever reach from here — which is what makes {@link certainlySafe} an
 * exact statement about the future rather than a threshold somebody guessed.
 */
export function ringAmplitude(wobble: Readonly<Wobble>, solution: Solution): number {
  const u = wobble.value - wobble.rest;
  const w = (wobble.rate + solution.sigma * u) / solution.omegaD;
  return Math.sqrt(u * u + w * w);
}

/**
 * Whether this tower can no longer topple, whatever happens next.
 *
 * The ring decays monotonically in envelope, so the worst lean the tower will ever see
 * again is `rest ± R`. If both of those are inside the plinth the tower is safe for ever,
 * and the settle can stop. Analytic, so it does not depend on the step rate — "stop when
 * the wobble looks small" would make 60 Hz and 240 Hz disagree about whether a marginal
 * tower survived.
 */
export function certainlySafe(yard: Readonly<Yard>): boolean {
  if (yard.count === 0) return true;
  const radius = ringAmplitude(yard.lean, LEAN);
  return marginAt(yard, yard.lean.rest + radius) > 0 && marginAt(yard, yard.lean.rest - radius) > 0;
}

/* ------------------------------------------------------------------ *
 * The integrator
 * ------------------------------------------------------------------ */

/**
 * Advance one oscillator by one step, exactly.
 *
 * Both oscillators are `u'' + 2 zeta omega u' + omega^2 u = 0` in `u = value - rest`, which
 * has a closed form; this evaluates it rather than stepping towards it. Both are the same
 * model of a springy thing, and only one of them agrees with itself at two different step
 * rates: forward Euler on an oscillator gains energy in proportion to the step, so the same
 * tower would ring visibly longer on a 60 Hz phone than on a 240 Hz one, and the bot's own
 * arithmetic about where a brainrot will land would be permanently out by the same amount.
 * `rules.test.ts` runs one kick at 60, 90, 120 and 240 Hz, requires the four to agree to
 * 1e-12, and runs Euler alongside to show the contrast.
 *
 * It also reports the **extremes of the value inside the step**, not just its value at the
 * end. That is what makes the topple test step-rate independent: a fast ring can cross the
 * plinth edge and come back between two 60 Hz samples, and a game that only looked at
 * sample boundaries would decide a match differently on a faster device. There is at most
 * one stationary point in a step — they are half a ring apart, and the shorter ring here is
 * 0.45 s — so the three candidates below are the whole story.
 *
 * Mutates in place and allocates nothing.
 */
export function advanceWobble(wobble: Wobble, solution: Solution, fixedDeltaSeconds: number): void {
  const u = wobble.value - wobble.rest;
  const v = wobble.rate;
  const decay = Math.exp(-solution.sigma * fixedDeltaSeconds);
  const cosine = Math.cos(solution.omegaD * fixedDeltaSeconds);
  const sine = Math.sin(solution.omegaD * fixedDeltaSeconds);
  const rise = (v + solution.sigma * u) / solution.omegaD;
  const fall = (solution.omegaSq * u + solution.sigma * v) / solution.omegaD;

  const uEnd = decay * (u * cosine + rise * sine);
  const vEnd = decay * (v * cosine - fall * sine);

  let low = u < uEnd ? u : uEnd;
  let high = u < uEnd ? uEnd : u;

  // The one interior stationary point, if it falls inside this step. The rate vanishes
  // where `tan(omega_d t) = v / fall`, and both of those negate together under the half
  // turn — so the pair is canonicalised to the half-plane `fall >= 0` before `atan2` sees
  // it. Without that, one seat's arctangent lands in the second quadrant and the other's
  // in the fourth, the `+= halfRing` puts them back on the same root by a different
  // arithmetic route, and the two disagree in the last two bits. The mirror test found
  // exactly that, and nothing else in the suite could see it.
  let numerator = v;
  let denominator = fall;
  if (denominator < 0 || (denominator === 0 && numerator < 0)) {
    numerator = -numerator;
    denominator = -denominator;
  }
  let turn = Math.atan2(numerator, denominator) / solution.omegaD;
  if (turn <= 0) turn += solution.halfRing;
  if (turn < fixedDeltaSeconds) {
    const uTurn =
      Math.exp(-solution.sigma * turn) *
      (u * Math.cos(solution.omegaD * turn) + rise * Math.sin(solution.omegaD * turn));
    if (uTurn < low) low = uTurn;
    if (uTurn > high) high = uTurn;
  }

  wobble.value = wobble.rest + uEnd;
  wobble.rate = vEnd;
  wobble.low = wobble.rest + low;
  wobble.high = wobble.rest + high;
}

/**
 * How many steps a brainrot spends in the air at this step rate.
 *
 * Counted by running the simulation's own countdown rather than by `ceil`, so the bot's
 * prediction and the simulation cannot round the boundary differently. Cached, because the
 * step rate does not change inside a match.
 */
let fallStepsDelta = 0;
let fallStepsCount = 0;
export function fallStepsFor(fixedDeltaSeconds: number): number {
  if (fixedDeltaSeconds === fallStepsDelta) return fallStepsCount;
  let remaining = FALL_SECONDS;
  let steps = 0;
  while (remaining > 0 && steps < 100000) {
    remaining -= fixedDeltaSeconds;
    steps += 1;
  }
  fallStepsDelta = fixedDeltaSeconds;
  fallStepsCount = steps;
  return steps;
}

/**
 * How many advances of the lean separate a bot's look from the landing it is predicting.
 *
 * The shell reads a seat's intent and *then* steps the match, so the step the drop is
 * registered on advances both oscillators once before the fall even starts. One, plus the
 * fall. The swing needs only the one, because a brainrot that has left the rail is in free
 * fall and stops swinging. `rules.test.ts` asserts both against the simulation with `toBe`.
 */
export function predictStepsFor(fixedDeltaSeconds: number): number {
  return 1 + fallStepsFor(fixedDeltaSeconds);
}

/* ------------------------------------------------------------------ *
 * The tower
 * ------------------------------------------------------------------ */

/** Recompute the aggregates a tower's statics depend on. O(n), on landings only. */
function retally(yard: Yard): void {
  let mass = 0;
  let moment = 0;
  let heightMoment = 0;
  let top = 0;
  for (let i = 0; i < yard.count; i += 1) {
    const piece = yard.pieces[i];
    if (piece === undefined) continue;
    const kind = KINDS[piece.kind];
    if (kind === undefined) continue;
    mass += kind.mass;
    moment += kind.mass * piece.x;
    heightMoment += kind.mass * (piece.base + kind.tall / 2);
    const above = piece.base + kind.tall;
    if (above > top) top = above;
  }
  yard.mass = mass;
  yard.com = mass > 0 ? moment / mass : 0;
  yard.comHeight = mass > 0 ? heightMoment / mass : 0;
  yard.top = top;
  yard.lean.rest = mass > 0 ? yard.com / swayScaleAt(yard.comHeight) : 0;
}

/**
 * Land the falling brainrot, and say whether it stayed on.
 *
 * The lean and its rate carry straight through a landing — a column cannot change shape
 * instantly — but the *rest* lean jumps, because the weight moved. That jump is what sets
 * the tower ringing, and it is the whole of the late game: an early brainrot is a fifth of
 * the tower's mass and thumps it, a late one is a twentieth and merely moves where it
 * wants to stand.
 */
function land(yard: Yard): boolean {
  const index = yard.count;
  const kindIndex = yard.pieces[index]?.kind ?? 0;
  const kind = KINDS[kindIndex];
  if (kind === undefined) return false;

  const x = yard.dropX - driftAt(yard, yard.top);
  yard.flash = 0.5;
  yard.flashX = x;

  const slack = landingSlackFor(kindIndex, supportHalfAt(yard, index));
  if (Math.abs(x - supportCentreAt(yard, index)) > slack) {
    // Not enough of it is over anything: it slides off and goes over the side.
    return false;
  }

  const piece = yard.pieces[index];
  if (piece === undefined) return false;
  piece.x = x;
  piece.base = yard.top;
  yard.count = index + 1;

  retally(yard);
  const share = yard.mass > 0 ? kind.mass / yard.mass : 1;
  yard.lean.rate += IMPACT * share * (x / swayScaleAt(yard.comHeight));
  return true;
}

/* ------------------------------------------------------------------ *
 * The step
 * ------------------------------------------------------------------ */

export interface StepResult {
  /** A seat that lost its tower on this step, or null. */
  readonly fell: SeatId | null;
}

/** Reused rather than allocated: rule 5 forbids allocating on the fixed step. */
const stepResult: { fell: SeatId | null } = { fell: null };

/** Put the next brainrot on the rail, dead still. */
function deal(match: Match, yard: Yard, rng: Rng): void {
  const index = yard.dealt;
  if (index >= PIECE_CAP) {
    yard.stance = 'settling';
    yard.settle = SETTLE_MAX_SECONDS;
    return;
  }
  ensureDealt(match, index, rng);
  const piece = yard.pieces[index];
  if (piece !== undefined) piece.kind = match.dealKind[index] ?? 0;
  yard.slot = match.dealSlot[index] ?? 0;
  yard.cool = 0;
  yard.hover = hoverSecondsAt(index);
  yard.dealt = index + 1;
  yard.stance = 'hover';
  resetWobble(yard.swing);
}

/**
 * Hop the carrier at most one notch, and drag the brainrot after it.
 *
 * A finger names a notch outright and the carrier hops towards it; a key names a direction
 * and the carrier hops that way. Both go through the same cooldown, so neither instrument
 * can place a brainrot faster than the other, and the finger is the more specific
 * instruction so it wins while it is down. Either way the hop shoves the thing hanging
 * off the carrier, which is what {@link SHOVE} is.
 */
function shunt(yard: Yard, intent: Readonly<Intent>, fixedDeltaSeconds: number): void {
  if (yard.cool > 0) {
    yard.cool -= fixedDeltaSeconds;
    if (yard.cool > 0) return;
  }
  let direction = 0;
  if (intent.aimActive) {
    if (intent.aimSlot > yard.slot) direction = 1;
    else if (intent.aimSlot < yard.slot) direction = -1;
  } else if (intent.nudge > 0.35) direction = 1;
  else if (intent.nudge < -0.35) direction = -1;
  if (direction === 0) return;
  const next = yard.slot + direction;
  if (next > SLOT_LIMIT || next < -SLOT_LIMIT) return;
  yard.slot = next;
  yard.swing.rate -= SHOVE * direction;
  // Assigned rather than accumulated: a carrier that stood still for a second must not be
  // able to bank a second's worth of notches and cross the rail in one step.
  yard.cool = SLOT_SECONDS;
}

/**
 * One fixed step of one yard.
 *
 * Both oscillators advance first and unconditionally, so the tower keeps ringing through a
 * reload, through the opening pause and through the settle after the last brainrot. The
 * topple is judged on the worst lean *inside* the step rather than on the lean at its end.
 *
 * The drop is read **before** the hop, so a tap lets the brainrot go from exactly where the
 * last frame drew it.
 */
function stepYard(
  match: Match,
  yard: Yard,
  intent: Readonly<Intent>,
  fixedDeltaSeconds: number,
  rng: Rng,
): boolean {
  if (yard.out || yard.stance === 'done') return false;

  advanceWobble(yard.lean, LEAN, fixedDeltaSeconds);
  advanceWobble(yard.swing, SWING, fixedDeltaSeconds);
  if (yard.flash > 0) yard.flash -= fixedDeltaSeconds;

  if (yard.count > 0) {
    const margin = marginOverStep(yard);
    if (margin < yard.worst) yard.worst = margin;
    if (margin < 0) {
      yard.out = true;
      yard.loss = 'toppled';
      yard.stance = 'done';
      return true;
    }
  }

  switch (yard.stance) {
    case 'opening': {
      yard.reload -= fixedDeltaSeconds;
      if (yard.reload <= 0) deal(match, yard, rng);
      break;
    }
    case 'hover': {
      yard.hover -= fixedDeltaSeconds;
      if (intent.drop || yard.hover <= 0) {
        yard.dropX = yard.slot * SLOT_PITCH + yard.swing.value;
        yard.stance = 'falling';
        yard.fall = FALL_SECONDS;
      } else {
        shunt(yard, intent, fixedDeltaSeconds);
      }
      break;
    }
    case 'falling': {
      yard.fall -= fixedDeltaSeconds;
      if (yard.fall <= 0) {
        if (!land(yard)) {
          yard.out = true;
          yard.loss = 'missed';
          yard.stance = 'done';
          return true;
        }
        if (yard.dealt >= PIECE_CAP) {
          yard.stance = 'settling';
          yard.settle = SETTLE_MAX_SECONDS;
        } else {
          yard.stance = 'reload';
          yard.reload = RELOAD_SECONDS;
        }
      }
      break;
    }
    case 'reload': {
      yard.reload -= fixedDeltaSeconds;
      if (yard.reload <= 0) deal(match, yard, rng);
      break;
    }
    case 'settling': {
      yard.settle -= fixedDeltaSeconds;
      if (certainlySafe(yard) || yard.settle <= 0) yard.stance = 'done';
      break;
    }
  }
  return false;
}

/** One fixed step of the match. Both yards advance; neither can read the other. */
export function step(
  match: Match,
  p1: Readonly<Intent>,
  p2: Readonly<Intent>,
  fixedDeltaSeconds: number,
  rng: Rng,
): StepResult {
  stepResult.fell = null;
  match.elapsed += fixedDeltaSeconds;
  const fellP1 = stepYard(match, match.p1, p1, fixedDeltaSeconds, rng);
  const fellP2 = stepYard(match, match.p2, p2, fixedDeltaSeconds, rng);
  // Both can go on the same step. `winnerOf` hands that to the shared helper, which calls
  // it a draw; naming one here would be this game picking a seat.
  if (fellP1 && !fellP2) stepResult.fell = 'p1';
  else if (fellP2 && !fellP1) stepResult.fell = 'p2';
  return stepResult;
}

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * Last one standing, resolved by the shared helper.
 *
 * The observed rule is a *losing* condition rather than a scoring one, and this is the
 * helper for that. Nothing here writes a comparison by hand, so two towers that go in the
 * same step are a draw because `resolve` says so and not because this file picked a seat.
 */
export const CONDITION: WinCondition = { kind: 'last-standing' };

/** Both reused rather than allocated: `winnerOf` runs every step. */
const eliminated: SeatId[] = [];
const tally = { p1: 0, p2: 0 };

export function tallyOf(match: Readonly<Match>): Readonly<{ p1: number; p2: number }> {
  tally.p1 = match.p1.count;
  tally.p2 = match.p2.count;
  return tally;
}

/** Whether a seat has nothing left to play. */
export function finished(yard: Readonly<Yard>): boolean {
  return yard.out || yard.stance === 'done';
}

/**
 * Whose match it is, or null while it is still running.
 *
 * A seat is finished when its tower has gone or when it has stacked its whole budget and
 * stopped ringing. When both are finished the tally decides, and because both seats were
 * dealt the identical brainrots two survivors finish level by construction — so the tie
 * falls through to {@link breakTie}.
 */
export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  eliminated.length = 0;
  if (match.p1.out) eliminated.push('p1');
  if (match.p2.out) eliminated.push('p2');
  const outcome = resolve(CONDITION, tallyOf(match), {
    timeExpired: (finished(match.p1) && finished(match.p2)) || match.elapsed >= ROUND_SECONDS,
    eliminated,
  });
  if (outcome !== 'draw') return outcome;
  return breakTie(match);
}

/**
 * Level on brainrots: whose tower stood more honestly. **[ours]**
 *
 * The margin at the tower's worst moment, higher wins. It is a *magnitude* — how much
 * plinth was left, never which way the tower leaned — so it is the same number under the
 * half turn that separates the two seats, which a tie-break written in board coordinates
 * would not be. It is also the number the balance bar has been showing all match, so it is
 * something both players watched happen rather than a hidden second scoreboard.
 *
 * Two towers that went in the same step are a genuine draw: neither has a margin left.
 */
export function breakTie(match: Readonly<Match>): SeatId | 'draw' {
  if (match.p1.out && match.p2.out) return 'draw';
  if (match.p1.worst > match.p2.worst) return 'p1';
  if (match.p2.worst > match.p1.worst) return 'p2';
  return 'draw';
}

/* ------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------ */

export interface BotTuning {
  /** Seconds between looks. It may only act on a step it looks. */
  readonly reaction: number;
  /** How far out its reading of the landing point is, in units, held for one brainrot. */
  readonly aimError: number;
  /** Chance a second of freezing for {@link BLUNDER_SECONDS}. */
  readonly blunders: number;
  /**
   * How far off square it will accept before it lets go, in units.
   *
   * The timing knob, and the only one that reads the swing: the brainrot's offset from
   * its notch is crossing zero every 0.45 s, so a bot that insists on landing within three
   * units has to catch a crossing and one that will take fourteen never waits.
   */
  readonly tolerance: number;
  /** How much it cares about leaving the next brainrot a centred tower. */
  readonly centring: number;
}

export const BLUNDER_SECONDS = 0.5;

/**
 * The three tiers.
 *
 * Every number here was swept alone across its whole range against a fixed `normal`
 * opponent, and the sweeps are in `SPEC.md`. Two of the five came out of that sweep as
 * **not difficulty knobs**, and they are the same in all three tiers rather than deleted,
 * because both are still doing structural work:
 *
 * - `reaction` measured 55.0% down to 47.5% across a twelvefold range, which is inside the
 *   noise of 160 matches. It stays because it is what confines a tap to a step the bot has
 *   just looked on, which is what keeps its prediction of the landing exact (#2465) — but
 *   it is not what makes one tier better than another, and pretending otherwise would be a
 *   knob nobody had checked the sign of.
 * - `centring` measured 51.2 / 48.8 / 56.9 / 50.6 / 43.8 across its range: a peak in the
 *   middle rather than a slope, so it is a fact about the game rather than about the
 *   player. Keeping the tower's top near the middle is right for everybody.
 *
 * What is left is three: how far out it reads the landing, how often it freezes, and how
 * square it insists on being before it lets go. All three are monotone across their whole
 * range.
 */
export const TUNING: Readonly<Record<BotDifficulty, BotTuning>> = {
  easy: { reaction: 0.16, aimError: 15, blunders: 0.45, tolerance: 26, centring: 0.45 },
  normal: { reaction: 0.16, aimError: 7, blunders: 0.24, tolerance: 9, centring: 0.45 },
  hard: { reaction: 0.16, aimError: 3, blunders: 0.09, tolerance: 3, centring: 0.45 },
};

export interface BotState {
  /** Seconds until it may look again. */
  wait: number;
  /** Seconds left of a blunder. */
  frozen: number;
  /** The notch it is walking towards. */
  target: number;
  /** Its misreading of the landing point, drawn once a brainrot and held to the drop. */
  bias: number;
  /** Which brainrot the bias was drawn for, so it is drawn once rather than every step. */
  biasFor: number;
  decided: boolean;
}

export function createBotState(): BotState {
  return { wait: 0, frozen: 0, target: 0, bias: 0, biasFor: -1, decided: false };
}

export function resetBotState(state: BotState): void {
  state.wait = 0;
  state.frozen = 0;
  state.target = 0;
  state.bias = 0;
  state.biasFor = -1;
  state.decided = false;
}

/**
 * The bot's scratch oscillator.
 *
 * Module scope rather than per-call, because rule 5 forbids allocating on the fixed step.
 */
const scratch: Wobble = createWobble();

/**
 * Where a brainrot let go on this step would leave the rail, and where the tower's top
 * will be when it arrives.
 *
 * Both are computed by running the simulation's own {@link advanceWobble} on scratch
 * scalars for exactly the number of steps the simulation will run — one for the swing,
 * because a released brainrot is in free fall and stops swinging, and
 * {@link predictStepsFor} for the lean. `rules.test.ts` asserts both with `toBe`.
 */
export function predictSwing(yard: Readonly<Yard>, fixedDeltaSeconds: number): number {
  scratch.value = yard.swing.value;
  scratch.rate = yard.swing.rate;
  scratch.rest = yard.swing.rest;
  advanceWobble(scratch, SWING, fixedDeltaSeconds);
  return scratch.value;
}

export function predictLean(yard: Readonly<Yard>, fixedDeltaSeconds: number): number {
  scratch.value = yard.lean.value;
  scratch.rate = yard.lean.rate;
  scratch.rest = yard.lean.rest;
  const steps = predictStepsFor(fixedDeltaSeconds);
  for (let i = 0; i < steps; i += 1) advanceWobble(scratch, LEAN, fixedDeltaSeconds);
  return scratch.value;
}

/**
 * What one notch is worth, given where a brainrot let go now would land.
 *
 * Positive is better. Everything it reads is drawn: the tower, the notch rail, the strip
 * the next brainrot must land on, the swinging brainrot itself, the tower's lean and the
 * balance bar. Nothing it reads is hidden, and it is handed one yard rather than the match.
 */
function scoreLanding(yard: Readonly<Yard>, x: number, centring: number): number {
  const index = yard.count;
  const kindIndex = yard.pieces[index]?.kind ?? 0;
  const kind = KINDS[kindIndex];
  if (kind === undefined) return -1e9;
  const overhang =
    Math.abs(x - supportCentreAt(yard, index)) -
    landingSlackFor(kindIndex, supportHalfAt(yard, index));
  // A notch that misses is not merely bad, it loses the match on the spot.
  if (overhang > 0) return -1e6 - overhang;

  const mass = yard.mass + kind.mass;
  const com = (yard.com * yard.mass + kind.mass * x) / mass;
  const comHeight = (yard.comHeight * yard.mass + kind.mass * (yard.top + kind.tall / 2)) / mass;
  const rest = com / swayScaleAt(comHeight);
  // Where the weight will sit once the tower has settled, plus the swing the ring it is
  // already carrying will add. The second term is why patience buys anything: a ring
  // decays by 57% a second, so a bot that waits for a calm tower gets a better number for
  // free and one that drops into a swinging tower does not.
  const settled = Math.abs(com + comHeight * rest) + comHeight * ringAmplitude(yard.lean, LEAN);
  return PLINTH_HALF - settled - centring * Math.abs(x);
}

/**
 * Which way this yard is already committed, as -1, +1 or 0.
 *
 * Read in the order the state settles: how the tower is moving, then how it leans, then
 * where its weight is, then which way the brainrot is swinging, then which side of the
 * rail the carrier is on. Every one of those negates under the half turn, which is what
 * makes the tie-break below mirror-covariant. It is 0 only for a perfectly still, empty,
 * centred yard with the carrier exactly on the middle notch — a position the deal cannot
 * produce, because a brainrot is never delivered nearer than notch two.
 */
function orientationOf(yard: Readonly<Yard>): number {
  if (yard.lean.rate !== 0) return yard.lean.rate > 0 ? 1 : -1;
  if (yard.lean.value !== 0) return yard.lean.value > 0 ? 1 : -1;
  if (yard.com !== 0) return yard.com > 0 ? 1 : -1;
  if (yard.swing.rate !== 0) return yard.swing.rate > 0 ? 1 : -1;
  if (yard.swing.value !== 0) return yard.swing.value > 0 ? 1 : -1;
  if (yard.slot !== 0) return yard.slot > 0 ? 1 : -1;
  return 0;
}

/** Whether `slot` beats `bestSlot`: strictly better, then nearer, then more central. */
function better(
  yard: Readonly<Yard>,
  orient: number,
  slot: number,
  score: number,
  bestSlot: number,
  bestScore: number,
): boolean {
  if (score !== bestScore) return score > bestScore;
  const reach = Math.abs(slot - yard.slot);
  const bestReach = Math.abs(bestSlot - yard.slot);
  if (reach !== bestReach) return reach < bestReach;
  if (Math.abs(slot) !== Math.abs(bestSlot)) return Math.abs(slot) < Math.abs(bestSlot);
  if (orient !== 0) return slot * orient > bestSlot * orient;
  return slot > bestSlot;
}

/**
 * Ask a bot what it wants this step.
 *
 * It reads **one yard and no match**, so there is nothing in scope for it to peek at, and
 * it hops the carrier through the same {@link shunt} every player uses at the same rate. It
 * only acts on a step it looks — which is what keeps its prediction exact, because the
 * prediction and the tap happen on the same step.
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
  const tuning = TUNING[difficulty];
  if (yard.stance !== 'hover') {
    state.decided = false;
    state.wait = 0;
    return;
  }

  // One misreading a brainrot, held to the drop. A fresh error every step averages to
  // zero and every tier plays the same — the bug `misjudgement` exists to prevent.
  if (state.biasFor !== yard.dealt) {
    state.bias = misjudgement(rng.float(), tuning.aimError);
    state.biasFor = yard.dealt;
    state.decided = false;
    state.wait = 0;
  }

  if (state.frozen > 0) {
    state.frozen -= fixedDeltaSeconds;
    return;
  }

  let looking = !state.decided;
  if (!looking) {
    state.wait -= fixedDeltaSeconds;
    if (state.wait <= 0) {
      state.wait = 0;
      looking = true;
    }
  }

  if (looking) {
    if (rng.float() < tuning.blunders * tuning.reaction) {
      state.frozen = BLUNDER_SECONDS;
      state.wait = tuning.reaction;
      return;
    }

    // Where a brainrot let go now would land, misread by `bias` units — the one quantity
    // this bot is deliberately wrong about.
    const offset =
      predictSwing(yard, fixedDeltaSeconds) - predictLean(yard, fixedDeltaSeconds) * yard.top;
    const seen = offset + state.bias;

    let bestSlot = yard.slot;
    let bestScore = -Infinity;
    const orient = orientationOf(yard);
    for (let slot = -SLOT_LIMIT; slot <= SLOT_LIMIT; slot += 1) {
      const score = scoreLanding(yard, slot * SLOT_PITCH + seen, tuning.centring);
      if (bestScore === -Infinity || better(yard, orient, slot, score, bestSlot, bestScore)) {
        bestSlot = slot;
        bestScore = score;
      }
    }
    state.target = bestSlot;
    state.decided = true;
    state.wait = tuning.reaction;

    // Let go only from the notch it chose, and only once the swing has brought the
    // brainrot close enough to square — or when the carrier is about to let go by itself,
    // which is not a choice at all.
    const off = Math.abs(bestSlot * SLOT_PITCH + seen - supportCentreAt(yard, yard.count));
    const forced = yard.hover <= tuning.reaction + fixedDeltaSeconds;
    if (yard.slot === bestSlot && (forced || off <= tuning.tolerance)) out.drop = true;
  }

  out.aimActive = true;
  out.aimSlot = state.target;
}
