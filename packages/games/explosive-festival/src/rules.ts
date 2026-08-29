import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Explosive Festival, as pure rules.
 *
 * One festival ground with a row of paper lanterns dealt into each half of it. Each seat has
 * a firework cart that rolls along its own edge and a rocket whose fuse is already lit. Press
 * and the cart stops, keeping the **column** the rocket will go up; a sight then runs out from
 * the cart along that column, and letting go keeps the **distance** and fires. A rocket bursts
 * where it comes down and puts out any lantern inside the blast — including one of your own.
 * Put out all seven of theirs and the festival is yours.
 *
 * ## Four decisions carry the whole game
 *
 * **The control is a press with no position at all.** Not a point, not a drag: press, then
 * let go. The shell splits the pointer surface into two zones, so a thumb only ever starts
 * in its own half — and an absolute pointer would therefore leave the far half of a shared
 * arena unreachable for one seat, which four games in this archetype currently ship. A press
 * has no coordinates for a zone to withhold, so both seats can express every shot on the
 * board from inside their own half. It is also the same binary event with a timestamp on a
 * key, a trackpad and a thumb, so no instrument can aim finer than another. **[ours]**
 *
 * **The fuse is the termination guarantee.** A rocket leaves the tube when you let go, *or*
 * when its fuse burns out, whichever comes first — so a seat that is never touched still
 * spends a rocket every `RELOAD + FUSE` seconds, and `ROCKETS` of them is a finite quantity
 * that only ever decreases. Nothing about how the match is played can add one. A match where
 * neither player ever presses ends in `ROCKETS * (RELOAD + FUSE)` seconds plus a flight; see
 * {@link ROCKETS}. **[ours]**
 *
 * **A short rocket lands on your own lanterns.** The distance sight starts at
 * {@link MIN_RANGE}, which comes down 30 units from your own front row — inside the blast —
 * and the top of your own row's window sits ten units of gauge below the bottom of the
 * enemy's near row. Undershoot their front rank and you take out your own. That is what makes
 * the release a two-sided decision rather than a hit-or-miss one, and it is why the deepest
 * enemy lantern is the safest thing to shoot at: overshooting it lands on bare ground.
 * **[ours]**
 *
 * **Both carts always empty, and nothing is decided while a rocket is still in the air.** Two
 * halves of one rule, and together they are the real-time form of a turn game's completed
 * round: a seat is owed every rocket it has left and every landing it has coming. It is nearly
 * inert at the shipped field size and severe at a smaller one, which is stated with its
 * measurements at {@link WIN_CONDITION} rather than claimed. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

/** The ground is square, so the same box works in either orientation. */
export const GROUND = 800;
export const CENTRE = GROUND / 2;

/**
 * Both carts run along a rail this far inside their own edge, and both rails span the same
 * columns, so the ground is one shape under the half-turn: rotate it and it is the same
 * festival with the seats swapped.
 */
export const BASE_INSET = 40;
export const P1_BASE_Y = GROUND - BASE_INSET;
export const P2_BASE_Y = BASE_INSET;

export const CARRIAGE_MIN_X = 90;
export const CARRIAGE_MAX_X = GROUND - CARRIAGE_MIN_X;

/**
 * How fast the cart rolls and how fast the sight runs out — one rate for both.
 *
 * One number rather than two because it makes the error a *circle*: a press that is late by
 * `t` seconds misses the column by `SWEEP_RATE * t`, and a release that is late by `t` misses
 * the distance by exactly the same, so the two halves of a shot cost the same and neither is
 * the one worth practising. It also fixes the whole difficulty ladder in one place — see
 * {@link BLAST}.
 *
 * Chosen from readability at the other end: the distance gauge is 400 units wide, which at
 * this rate is 0.61 s to cross, and the cart's rail is 620 units, 0.94 s. Cup Pong's two
 * needles cross in 0.65 s and that is a proven speed for a person to read.
 */
export const SWEEP_RATE = 660;

/**
 * The two ends of the distance gauge, measured out from the firing seat's own rail.
 *
 * Fitted to the lantern lattice rather than to the board, and the fit is the game:
 *
 * | landing row | distance window that reaches it |
 * |---|---|
 * | your own front row (y 450 from seat one) | 265 – 355 — **the danger** |
 * | their near row (y 350) | 365 – 455 |
 * | their middle row (y 250) | 465 – 555 |
 * | their far row (y 150) | 565 – 655 |
 *
 * `MIN_RANGE` is 280 rather than 365 deliberately: it puts the bottom fifth of the gauge on
 * your own front rank, ten units of gauge below the enemy's nearest. `MAX_RANGE` is 680, which
 * lands 70 units past their far row — outside the blast, so topping the gauge out is a clean
 * miss and never a lucky hit.
 */
export const MIN_RANGE = 280;
export const MAX_RANGE = 680;

/**
 * The blast, and where the difficulty ladder lives.
 *
 * The quantity that decides everything is **how many seconds of press error the blast is
 * worth**: `BLAST / SWEEP_RATE`. At 45 over 660 that is 0.068 s, which is deliberately the
 * same figure Cup Pong arrived at for its mouth — a ladder measured there at 0.11, 0.15 and
 * 0.20 seconds of human error, which is where a person's timing actually is. Getting this
 * number wrong is not recoverable by tuning the bots: too small and every tier is "nearly
 * perfect", too large and every tier hits everything.
 *
 * Swept alone, with everything else as shipped — hit rate is `hard` at a full field, and the
 * draw rate is `hard` against itself over 500 seeds:
 *
 * | blast | `easy` hits | `hard` hits | `hard` over `normal` | `hard` v `hard` drawn |
 * |---|---|---|---|---|
 * | 25 | 14.0% | 36.3% | 86.3% | 11.2% |
 * | 35 | 22.7% | 53.0% | 87.9% | 5.8% |
 * | **45 (shipped)** | **33.8%** | **73.0%** | **89.0%** | **5.6%** |
 * | 55 | 46.8% | 88.1% | 87.6% | 9.6% |
 * | 70 | 61.5% | 97.2% | 80.4% | 15.6% |
 * | 90 | 76.1% | 99.1% | 78.1% | 21.6% |
 *
 * The draw rate is the number to read: it is worst at both ends and flat between 35 and 45.
 * Too small and everybody misses everything, too large and everybody hits everything, and
 * either way two players of the same standard finish level. The band that separates people is
 * narrow and 45 sits in the middle of it.
 *
 * **It is under half the lattice spacing, and that is a rule rather than an accident.** At 45
 * against 100 no point on the ground is within the blast of two lanterns, so a rocket takes
 * at most one and the score is exact arithmetic rather than a chain reaction. Raising it past
 * 50 would make doubles geometrically possible — and, measured at this sweep rate, still
 * unhittable: catching two lanterns 100 apart with a 55-unit blast needs the burst inside a
 * lens 46 units wide, which is 0.07 s of timing on *both* presses at once. The sweep above
 * says the same thing from the balance side: everything at and above 55 is worse.
 */
export const BLAST = 45;

/**
 * The lattice the lanterns are dealt onto: seven columns, three rows a half, 100 apart.
 *
 * A lattice rather than free positions so that point symmetry is exact rather than nearly
 * exact — cell `i` in the upper half mirrors to `(GROUND - x, GROUND - y)`, which is integer
 * arithmetic, where mirroring a float and comparing is not.
 */
export const COLS = 7;
export const ROWS = 3;
export const CELLS = COLS * ROWS;
export const COL_ORIGIN = 100;
export const COL_SPACING = 100;
export const ROW_ORIGIN = 150;
export const ROW_SPACING = 100;

/**
 * Lanterns a seat starts with, and the number that fills the score.
 *
 * **Nine against fourteen rockets is what keeps the score off its own ceiling.** Both seats
 * fire every rocket, so a tier's score is close to its in-match hit rate times fourteen —
 * `hard` hits 50.5% of its shots, which is seven — and if the field is smaller than that the
 * score simply saturates and two good players end level. Measured at 700 seeds a cell,
 * `hard` against itself:
 *
 * | lanterns \ rockets | 12 | 14 | 16 |
 * |---|---|---|---|
 * | 8 | 6.30 of 8, 9.4% drawn | 7.05 of 8, **8.6% drawn** | 7.60 of 8, 10.3% drawn |
 * | **9** | 6.45 of 9, 8.1% | **7.26 of 9, 6.1% drawn** | 8.04 of 9, 7.9% |
 * | 10 | 6.61 of 10, 7.9% | 7.44 of 10, 6.9% | 8.28 of 10, 7.6% |
 * | 11 | 6.78 of 11, 6.7% | 7.61 of 11, 6.3% | 8.45 of 11, 5.9% |
 *
 * At eight, `hard` empties the field in 56% of matches and draws nearly one in ten. Past ten
 * the draw rate stops improving and emptying the field — the thing the game is nominally
 * about — stops happening at all. Nine leaves it at 18% of `hard` pairs and 2% of `normal`
 * ones (2000 seeds), which is the right shape for a thing that should feel like a good night's work.
 */
export const LANTERNS = 9;

/**
 * The lantern's own radius — and, because they are the same number, the score's fine
 * resolution.
 *
 * A burst whose centre comes down **inside the paper** rather than merely within the blast is
 * a *clean* one, and clean bursts are the tiebreak. One constant for both so the rule needs no
 * explaining and no extra ring drawn on the ground: the rocket either landed on the lantern or
 * it landed near it, and a player can see which.
 *
 * The tiebreak is not decoration, it is the score's resolution. Lanterns out is a number
 * between nought and seven, and two players of the same standard land on the same one of those
 * eight values often — see SPEC.md for what it is worth in draws. 26 against a 45-unit blast
 * puts a bit under half of everything that goes in on the paper, so it separates people
 * regularly enough to be worth having.
 *
 * **The first version of this tiebreak was the observed rule read literally** — count the
 * rockets that landed on the opponent's half at all — and it was measured at 96 to 100 per
 * cent of every shot fired at all three tiers. A tiebreak that everybody saturates separates
 * nobody.
 */
export const LANTERN_RADIUS = 26;
export const CORE = LANTERN_RADIUS;

/**
 * Rockets a seat is given for the whole match, and the reason the match must end.
 *
 * Termination is structural: `rockets` never rises, and it falls at least once every
 * `RELOAD + FUSE` = 3.95 seconds whether or not anybody touches the device, because a fuse
 * that burns out fires the rocket by itself. So the longest match anybody can play is
 * `ROCKETS * (RELOAD + FUSE)` = 55.3 s of simulated time, plus the {@link OPENING} freeze and
 * one flight for the sky to clear — **56.20 seconds, measured**, against the ten minutes
 * `apps/web/src/data/termination.test.ts` allows. No clock is involved, no frame cap is doing
 * the work, and `rules.test.ts` plays a match with **no step ceiling at all** so that a
 * failure to terminate would hang the suite rather than pass quietly. A pair who never touch
 * the device and a pair who hold their controls down from the first frame and never let go
 * both finish in exactly 56.20 s, which is the same number from both directions. The longest
 * match two bots have played in 1200 runs is 31.83 s.
 */
export const ROCKETS = 14;

/**
 * How long a lit fuse lasts, and what it is *not*.
 *
 * It is the termination guarantee and a pressure a person feels; it is **not** a balance knob,
 * and the measurement says so plainly. Swept alone at 2.2, 2.8, 3.5, 5 and 8 seconds, `hard`
 * cooks off **0.0% of its rockets at every one of them** and the ladder does not move by a
 * tenth of a point — because a bot's decision is instantaneous and its longest possible wait
 * is a cart round trip plus a sight crossing, 2.4 s. Only at 1.6 s does it bite, and then it
 * bites everything: 40.8% cooked off and `hard` over `normal` collapsing from 89.0% to 70.0%.
 *
 * So it is set for the person rather than for the bot: 3.5 s is one full cart round trip
 * (1.88 s), one full sight crossing (0.61 s) and about a second left over to decide with. A
 * bot never needs the last second; somebody reading a fresh field does.
 */
export const FUSE = 3.5;
export const RELOAD = 0.45;

/**
 * Seconds at the start of a match with everything parked.
 *
 * The lanterns are dealt fresh from the match seed, so both players need a moment to see
 * where they are, and a bot must get exactly the same moment and no more. It is in the rules
 * for the reason Cup Pong's is: the shell's countdown does not call `update` at all, but a
 * freeze written in `game.ts` would still be a rule living outside the simulation.
 *
 * The carts park at opposite ends of their rails — seat one at the low end rolling up, seat
 * two at the mirrored end rolling down — so the two are mirror images of each other for the
 * whole match, and neither seat's cart is ever nearer a column than the other's.
 */
export const OPENING = 0.6;

export const ROCKET_SPEED = 900;
export const ROCKET_RADIUS = 9;
/** How long a burst is held on the ground after it has been judged. Presentation only. */
export const BURST_SECONDS = 0.35;

/**
 * Rocket slots, **a fixed half of the pool to each seat**.
 *
 * Disjoint halves rather than a shared free list, so which seat is stepped first cannot
 * change which slot a rocket lands in. That is not cosmetic: `rules.test.ts` asserts the two
 * seats can be stepped in either order for a bit-identical match, and a shared list would
 * make that assertion false for a reason that has nothing to do with the game.
 *
 * A seat cannot fire faster than one rocket per `RELOAD` = 0.45 s, and a rocket lives at most
 * `MAX_RANGE / ROCKET_SPEED + BURST_SECONDS` = 1.11 s, so three of a seat's own can overlap by
 * arithmetic; measured over 1200 bot matches the high-water mark is two. Six is either of
 * those with room to spare, and a test asserts the pool is never exhausted rather than leaving
 * the arithmetic in a comment.
 */
export const ROCKET_SLOTS_PER_SEAT = 6;
export const ROCKET_SLOTS = ROCKET_SLOTS_PER_SEAT * 2;

export const ROCKET_FREE = 0;
export const ROCKET_FLYING = 1;
export const ROCKET_BURSTING = 2;

/**
 * The win condition, declared through the SDK's helper rather than spelled out here.
 *
 * **Both seats always fire every one of their rockets**, and the match is decided on the
 * lanterns that are out when the last of them has burst. Clearing the other's field does not
 * end it on the spot — it only means the score cannot go higher.
 *
 * It was built the other way first, `first-to` on the lantern count, and it is worth being
 * exact about what moving away from that did, because the answer is *nothing at all at the
 * shipped size*. Over 1500 seeds a pairing the two endings agree to a tenth of a point on
 * every tier and to one match on the draw counts — at nine lanterns a field is cleared in 16%
 * of `hard` matches and almost always on the last rocket or two, so the two rules are the same
 * rule nearly every time.
 *
 * What the completed-stock rule buys is a property rather than a number: **under `first-to`
 * the two seats can stop with unequal stocks**, and the seat that aimed faster is simply given
 * more shots. Measured over 700 matches a tier, the loser's unfired rockets:
 *
 * | lanterns | easy | normal | hard |
 * |---|---|---|---|
 * | 7 | 0.08 mean, 4% of matches uneven | 0.38, 16% | **2.02 mean, 51% uneven, 6 at worst** |
 * | 8 | 0.02, 0% | 0.12, 5% | 0.70, 28% |
 * | **9 (shipped)** | 0.00, 0% | 0.02, 1% | 0.14, 8% |
 *
 * It is nearly inert at nine and severe at seven, which is the shape of every guard worth
 * keeping: it costs one branch, it is what keeps the property true if the field is ever made
 * smaller, and it turns "both seats fire exactly fourteen rockets" into something a test can
 * assert — which is also what makes the termination argument exact rather than bounded.
 */
export const WIN_CONDITION: WinCondition = { kind: 'highest-when-time-expires' };

export type Phase = 'opening' | 'firing' | 'over';

export interface Lantern {
  x: number;
  y: number;
  standing: boolean;
  /**
   * Caught by a burst this step, but not yet taken off the ground.
   *
   * Every burst of a step marks against the same standing set and they are applied together,
   * so two rockets landing on the same step cannot see each other's damage and the order they
   * are processed in is not observable.
   */
  doomed: boolean;
}

export interface Launcher {
  /** Where the cart is on its rail. */
  x: number;
  right: boolean;
  /** A rocket is in the tube with its fuse burning. */
  loaded: boolean;
  /** The press has been taken: the cart is stopped and the sight is running. */
  aiming: boolean;
  /** How far out the sight is, in units from this seat's own rail. */
  range: number;
  rangeRising: boolean;
  /** Seconds left on the loaded rocket's fuse. */
  fuse: number;
  /** Seconds of reload left. Zero whenever a rocket is loaded. */
  reload: number;
  /** Rockets left for the match, the loaded one included. */
  rockets: number;
  /** Whether the control was held on the previous step. Both edges come from this. */
  held: boolean;
  /** What the caller is asking for this step. Written only through {@link setHold}. */
  want: boolean;
  /** Bursts this seat landed on the paper of an enemy lantern rather than merely near it. */
  clean: number;
  /** Lanterns of *this* seat that have been put out — which is the other seat's score. */
  down: number;
}

export interface Rocket {
  state: number;
  /** 0 for seat one, 1 for seat two. Only used to attribute a scorch. */
  owner: number;
  x: number;
  fromY: number;
  toY: number;
  flight: number;
  flightTime: number;
  burst: number;
}

export interface Ground {
  readonly p1Lanterns: Lantern[];
  readonly p2Lanterns: Lantern[];
  readonly rockets: Rocket[];
  readonly p1: Launcher;
  readonly p2: Launcher;
  phase: Phase;
  /** Seconds left of the opening freeze. */
  hold: number;
  elapsed: number;
  winner: SeatId | 'draw' | null;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** Seat one fires up the ground, seat two down it. */
export function firingSign(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

export function baseYOf(seat: SeatId): number {
  return seat === 'p1' ? P1_BASE_Y : P2_BASE_Y;
}

/** Where a rocket fired at `range` comes down, for this seat. */
export function landingYOf(seat: SeatId, range: number): number {
  return baseYOf(seat) + firingSign(seat) * range;
}

/**
 * How far into the ground a point is, measured from this seat's own rail.
 *
 * The exact inverse of {@link landingYOf}, so the distance that lands a rocket on a point is
 * arithmetic rather than a search — and every number in it is on the ground in front of a
 * player.
 */
export function forwardOf(seat: SeatId, y: number): number {
  return (y - baseYOf(seat)) * firingSign(seat);
}

/** Sideways offset in the firing seat's own frame, so the two seats rank a row alike. */
export function lateralOf(seat: SeatId, x: number): number {
  return (x - CENTRE) * (seat === 'p1' ? 1 : -1);
}

/** How far out the centre line is. A burst past this is a scorch on the other seat's ground. */
export const FORWARD_TO_LINE = P1_BASE_Y - CENTRE;

export function cellX(index: number): number {
  return COL_ORIGIN + (index % COLS) * COL_SPACING;
}

export function cellY(index: number): number {
  return ROW_ORIGIN + Math.floor(index / COLS) * ROW_SPACING;
}

export function mirror(value: number): number {
  return GROUND - value;
}

export function launcherOf(ground: Readonly<Ground>, seat: SeatId): Launcher {
  return seat === 'p1' ? ground.p1 : ground.p2;
}

export function lanternsOf(ground: Readonly<Ground>, seat: SeatId): Lantern[] {
  return seat === 'p1' ? ground.p1Lanterns : ground.p2Lanterns;
}

export function winnerOf(ground: Readonly<Ground>): SeatId | 'draw' | null {
  return ground.winner;
}

/** Lanterns of the other seat this one has put out. The number the shell shows. */
export function scoreOf(ground: Readonly<Ground>, seat: SeatId): number {
  return launcherOf(ground, otherOf(seat)).down;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function makeLantern(): Lantern {
  return { x: 0, y: 0, standing: false, doomed: false };
}

function makeLauncher(seat: SeatId): Launcher {
  return {
    x: seat === 'p1' ? CARRIAGE_MIN_X : CARRIAGE_MAX_X,
    right: seat === 'p1',
    loaded: true,
    aiming: false,
    range: MIN_RANGE,
    rangeRising: true,
    fuse: FUSE,
    reload: 0,
    rockets: ROCKETS,
    held: false,
    want: false,
    clean: 0,
    down: 0,
  };
}

export function createGround(): Ground {
  const p1Lanterns: Lantern[] = [];
  const p2Lanterns: Lantern[] = [];
  for (let i = 0; i < LANTERNS; i += 1) {
    p1Lanterns.push(makeLantern());
    p2Lanterns.push(makeLantern());
  }
  const rockets: Rocket[] = [];
  for (let i = 0; i < ROCKET_SLOTS; i += 1) {
    rockets.push({
      state: ROCKET_FREE,
      owner: 0,
      x: 0,
      fromY: 0,
      toY: 0,
      flight: 0,
      flightTime: 1,
      burst: 0,
    });
  }
  return {
    p1Lanterns,
    p2Lanterns,
    rockets,
    p1: makeLauncher('p1'),
    p2: makeLauncher('p2'),
    phase: 'opening',
    hold: OPENING,
    elapsed: 0,
    winner: null,
  };
}

/**
 * The deal: seven of the twenty-one upper cells, each with its partner through the centre.
 *
 * Exactly `CELLS - 1` draws, always, and they are the first thing the world's generator is
 * asked for — so what a pair is dealt is a function of the match seed and of nothing that
 * happens afterwards. A plain float shuffle rather than `Rng.int`, whose rejection sampling
 * draws a variable number of values: nothing here depends on the count, but a variable count
 * is the shape of bug this repository keeps finding, so it is not written even where it is
 * harmless.
 */
const dealOrder: number[] = [];
for (let i = 0; i < CELLS; i += 1) dealOrder.push(i);

function dealLanterns(ground: Ground, rng: Rng): void {
  for (let i = 0; i < CELLS; i += 1) dealOrder[i] = i;
  for (let i = CELLS - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.float() * (i + 1));
    const held = dealOrder[i] as number;
    dealOrder[i] = dealOrder[j] as number;
    dealOrder[j] = held;
  }
  for (let i = 0; i < LANTERNS; i += 1) {
    const cell = dealOrder[i] as number;
    const x = cellX(cell);
    const y = cellY(cell);
    place(ground.p2Lanterns[i] as Lantern, x, y);
    place(ground.p1Lanterns[i] as Lantern, mirror(x), mirror(y));
  }
}

function place(lantern: Lantern, x: number, y: number): void {
  lantern.x = x;
  lantern.y = y;
  lantern.standing = true;
  lantern.doomed = false;
}

/**
 * Put a cart back on its rail, at the end the opening seat decides.
 *
 * The opening seat's cart takes the low end of the rail and rolls up it; the other takes the
 * high end and rolls down. **The two arrangements are exact mirror images**, so which seat gets
 * which cannot favour either of them — every column is reached by one cart exactly as often as
 * by the other, and the lantern deal is point-symmetric under the same half-turn.
 *
 * That is precisely why it is the safe thing to hang `context.openingSeat` on. A real-time
 * game has no opener and the contract says it may ignore the value; ignoring it means the
 * shell's alternation across the rounds of a best-of reaches nothing, and a balance harness
 * that plays each seed from both openers gets the identical match twice and cannot separate a
 * seat effect from a seed effect. Reading it here costs one comparison, changes the match, and
 * provably changes nothing about who is favoured.
 */
function resetLauncher(launcher: Launcher, seat: SeatId, opener: SeatId): void {
  const low = seat === opener;
  launcher.x = low ? CARRIAGE_MIN_X : CARRIAGE_MAX_X;
  launcher.right = low;
  launcher.loaded = true;
  launcher.aiming = false;
  launcher.range = MIN_RANGE;
  launcher.rangeRising = true;
  launcher.fuse = FUSE;
  launcher.reload = 0;
  launcher.rockets = ROCKETS;
  launcher.held = false;
  launcher.want = false;
  launcher.clean = 0;
  launcher.down = 0;
}

export function resetGround(ground: Ground, rng: Rng, opener: SeatId = 'p1'): void {
  dealLanterns(ground, rng);
  for (let i = 0; i < ground.rockets.length; i += 1) {
    (ground.rockets[i] as Rocket).state = ROCKET_FREE;
  }
  resetLauncher(ground.p1, 'p1', opener);
  resetLauncher(ground.p2, 'p2', opener);
  ground.phase = 'opening';
  ground.hold = OPENING;
  ground.elapsed = 0;
  ground.winner = null;
}

/**
 * The one door input comes through: is this seat holding its control, or not?
 *
 * One boolean, because that is all the game asks anybody for. A key down and a thumb on the
 * glass are the same value here, which is what makes the parity test in `game.test.ts` an
 * equality rather than a tolerance: there is no gesture either instrument can make that the
 * other cannot, and no order finer than "holding" and "not holding".
 */
export function setHold(ground: Ground, seat: SeatId, held: boolean): void {
  launcherOf(ground, seat).want = held;
}

export interface StepResult {
  /** True on a step a rocket left a tube. */
  fired: boolean;
  /** True on a step a rocket came down. */
  burst: boolean;
  /** True on a step a lantern was put out. */
  knocked: boolean;
}

const result: StepResult = { fired: false, burst: false, knocked: false };

/** Progress of a rocket through its flight, in [0, 1]. Presentation reads it; rules do not. */
export function flightProgress(rocket: Readonly<Rocket>): number {
  if (rocket.state !== ROCKET_FLYING) return 0;
  return clamp(rocket.flight / rocket.flightTime, 0, 1);
}

/** One fixed step. Holds are written by the caller first, through {@link setHold}. */
export function step(ground: Ground, dt: number): StepResult {
  result.fired = false;
  result.burst = false;
  result.knocked = false;
  if (ground.phase === 'over') return result;

  if (ground.phase === 'opening') {
    ground.hold -= dt;
    // The edge is still tracked through the freeze, so a player already holding when it
    // lifts does not get a free press on the first live step.
    ground.p1.held = ground.p1.want;
    ground.p2.held = ground.p2.want;
    if (ground.hold <= 0) ground.phase = 'firing';
    return result;
  }

  ground.elapsed += dt;
  if (stepLauncher(ground, 'p1', dt)) result.fired = true;
  if (stepLauncher(ground, 'p2', dt)) result.fired = true;
  stepRockets(ground, dt);
  judge(ground);
  return result;
}

/**
 * Roll one cart, run its sight, and work out whether its rocket goes this step.
 *
 * Order matters and is stated here once. **The edges are taken before anything moves**, so
 * the column a press keeps is the one that was under the cart when the press happened rather
 * than one step further on — which is also what lets a bot commit to a *moment* and land on
 * the column it planned. The sight then takes its first step on the same step the press was
 * taken, which is the step a bot's release clock has to account for; see {@link botHold}.
 *
 * **The cart rolls whenever the sight is not running**, the reload included. Without that a
 * player could park it on a column they liked by letting a rocket cook off, and come back to
 * a free perfect press; with it the cart has crossed a third of its rail by the time the next
 * rocket is loaded.
 */
function stepLauncher(ground: Ground, seat: SeatId, dt: number): boolean {
  const launcher = launcherOf(ground, seat);
  const pressed = launcher.want && !launcher.held;
  const released = !launcher.want && launcher.held;
  launcher.held = launcher.want;

  let fired = false;
  if (launcher.loaded) {
    launcher.fuse -= dt;
    if (pressed && !launcher.aiming) {
      launcher.aiming = true;
    } else if (released && launcher.aiming) {
      fire(ground, seat);
      fired = true;
    }
  } else if (launcher.rockets > 0) {
    launcher.reload -= dt;
    if (launcher.reload <= 0) {
      launcher.reload = 0;
      launcher.loaded = true;
      launcher.aiming = false;
      launcher.range = MIN_RANGE;
      launcher.rangeRising = true;
      launcher.fuse = FUSE;
    }
  }

  if (launcher.aiming) {
    const travel = (launcher.rangeRising ? 1 : -1) * SWEEP_RATE * dt;
    launcher.range = clamp(launcher.range + travel, MIN_RANGE, MAX_RANGE);
    if (launcher.range >= MAX_RANGE) launcher.rangeRising = false;
    else if (launcher.range <= MIN_RANGE) launcher.rangeRising = true;
  } else {
    const travel = (launcher.right ? 1 : -1) * SWEEP_RATE * dt;
    launcher.x = clamp(launcher.x + travel, CARRIAGE_MIN_X, CARRIAGE_MAX_X);
    if (launcher.x >= CARRIAGE_MAX_X) launcher.right = false;
    else if (launcher.x <= CARRIAGE_MIN_X) launcher.right = true;
  }

  // The fuse, which is the whole termination argument: a rocket nobody fires fires itself,
  // at whatever the sight is showing — which, if nobody has pressed at all, is the bottom of
  // the gauge and lands on this seat's own front row.
  if (!fired && launcher.loaded && launcher.fuse <= 0) {
    fire(ground, seat);
    fired = true;
  }
  return fired;
}

function fire(ground: Ground, seat: SeatId): void {
  const launcher = launcherOf(ground, seat);
  const range = launcher.range;
  launcher.loaded = false;
  launcher.aiming = false;
  launcher.fuse = 0;
  launcher.reload = RELOAD;
  // Spent whether or not there is a slot for it. The pool cannot actually fill — see
  // ROCKET_SLOTS_PER_SEAT — but "a shot always costs a rocket" is what the termination
  // argument rests on, and it must not have an exception hiding in it.
  launcher.rockets -= 1;

  const base = seat === 'p1' ? 0 : ROCKET_SLOTS_PER_SEAT;
  let slot = -1;
  for (let i = 0; i < ROCKET_SLOTS_PER_SEAT; i += 1) {
    if ((ground.rockets[base + i] as Rocket).state === ROCKET_FREE) {
      slot = base + i;
      break;
    }
  }
  if (slot < 0) return;

  const rocket = ground.rockets[slot] as Rocket;
  rocket.state = ROCKET_FLYING;
  rocket.owner = seat === 'p1' ? 0 : 1;
  rocket.x = launcher.x;
  rocket.fromY = baseYOf(seat);
  rocket.toY = landingYOf(seat, range);
  rocket.flight = 0;
  rocket.flightTime = range / ROCKET_SPEED;
  rocket.burst = 0;
}

function stepRockets(ground: Ground, dt: number): void {
  let doomed = false;
  for (let i = 0; i < ground.rockets.length; i += 1) {
    const rocket = ground.rockets[i] as Rocket;
    if (rocket.state === ROCKET_FREE) continue;
    if (rocket.state === ROCKET_BURSTING) {
      rocket.burst -= dt;
      if (rocket.burst <= 0) rocket.state = ROCKET_FREE;
      continue;
    }
    rocket.flight += dt;
    if (rocket.flight < rocket.flightTime) continue;

    rocket.state = ROCKET_BURSTING;
    rocket.burst = BURST_SECONDS;
    result.burst = true;
    const seat: SeatId = rocket.owner === 0 ? 'p1' : 'p2';
    // Judged against the standing set as it was before any of this step's bursts, so two
    // rockets landing together see the same ground and the order they are read in does not
    // matter.
    if (onPaper(lanternsOf(ground, otherOf(seat)), rocket.x, rocket.toY)) {
      launcherOf(ground, seat).clean += 1;
    }
    if (markBlast(ground.p1Lanterns, rocket.x, rocket.toY)) doomed = true;
    if (markBlast(ground.p2Lanterns, rocket.x, rocket.toY)) doomed = true;
  }
  if (doomed) applyDoom(ground);
}

/**
 * Mark every standing lantern the burst covers.
 *
 * It does not care whose lanterns these are: a rocket that comes down short takes out its own
 * side's, and the point goes to whoever owns the lantern's *opposite* seat. Attribution by
 * owner rather than by who fired is what makes the whole thing order-free — there is never a
 * question of who gets the credit for a lantern two rockets reached on the same step.
 */
function markBlast(lanterns: readonly Lantern[], x: number, y: number): boolean {
  let any = false;
  for (let i = 0; i < lanterns.length; i += 1) {
    const lantern = lanterns[i] as Lantern;
    if (!lantern.standing) continue;
    if (Math.hypot(lantern.x - x, lantern.y - y) > BLAST) continue;
    lantern.doomed = true;
    any = true;
  }
  return any;
}

/** Whether a burst came down on the paper of a standing lantern, not merely within reach. */
function onPaper(lanterns: readonly Lantern[], x: number, y: number): boolean {
  for (let i = 0; i < lanterns.length; i += 1) {
    const lantern = lanterns[i] as Lantern;
    if (!lantern.standing) continue;
    if (Math.hypot(lantern.x - x, lantern.y - y) <= CORE) return true;
  }
  return false;
}

function applyDoom(ground: Ground): void {
  result.knocked = true;
  extinguish(ground.p1Lanterns, ground.p1);
  extinguish(ground.p2Lanterns, ground.p2);
}

function extinguish(lanterns: readonly Lantern[], owner: Launcher): void {
  for (let i = 0; i < lanterns.length; i += 1) {
    const lantern = lanterns[i] as Lantern;
    if (!lantern.doomed) continue;
    lantern.doomed = false;
    lantern.standing = false;
    owner.down += 1;
  }
}

const tally: { p1: number; p2: number } = { p1: 0, p2: 0 };
const judgeOptions: { timeExpired: boolean } = { timeExpired: false };

/**
 * Decide the match, or leave it running.
 *
 * **Nothing is decided while a rocket is still in the air.** This is the real-time form of a
 * turn game's completed round, and it is load-bearing for the same reason: without it a seat
 * whose winning shot is halfway up the ground loses the match to an opponent's rocket that
 * happened to be fired later and land sooner. With it, both landings are judged on the same
 * step and the helper calls that a draw.
 *
 * The score handed to the helper is lanterns *of the other seat* that are out, so a rocket a
 * player drops on their own front row scores for their opponent — which is the whole of the
 * risk in the bottom of the distance gauge, expressed once.
 */
function judge(ground: Ground): void {
  for (let i = 0; i < ground.rockets.length; i += 1) {
    if ((ground.rockets[i] as Rocket).state === ROCKET_FLYING) return;
  }
  tally.p1 = ground.p2.down;
  tally.p2 = ground.p1.down;
  // Both stocks spent and the sky clear: nobody can put out another lantern, so the festival
  // is decided on the lanterns that are already out. It is the only ending there is, and it is
  // where the termination argument lands whether the players hit everything or nothing.
  judgeOptions.timeExpired = ground.p1.rockets <= 0 && ground.p2.rockets <= 0;
  const outcome = resolve(WIN_CONDITION, tally, judgeOptions);
  if (outcome === null) return;
  ground.phase = 'over';
  // The helper owns the win condition; the tiebreak below only splits a result it has already
  // called level, and it is a finer reading of the same thing the score counts: who came down
  // on the paper rather than near it.
  ground.winner = outcome === 'draw' ? splitLevel(ground) : outcome;
}

function splitLevel(ground: Readonly<Ground>): SeatId | 'draw' {
  if (ground.p1.clean !== ground.p2.clean) return ground.p1.clean > ground.p2.clean ? 'p1' : 'p2';
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
 * That is the whole of the skill this game asks for — there is nothing to steer, nothing to
 * dodge and nothing to point at — so it is the whole of what the tiers differ in. The numbers
 * are seconds of human error rather than anything abstract, and every one of them is several
 * frames wide, so rule 6 holds by construction: none of these can stop a cart or a sight more
 * finely than a person can.
 *
 * **Two axes, one strong and one small, and the measurement is written down rather than
 * dressed up.** With the other knob flattened to `normal`'s value for all three tiers so the
 * tiers differ in one number and nothing else, over 800 seeds in each seat order:
 *
 * | | normal over easy | hard over normal |
 * |---|---|---|
 * | both (shipped) | 78.1% | 88.7% |
 * | timing alone | 76.1% | 86.9% |
 * | blunder alone | 54.7% | 53.6% |
 *
 * The timing is very nearly the whole ladder. The blunder rate is monotone over its entire
 * range — swept alone against an untouched `normal` it reads 89.8, 88.7, 87.8, 85.6, 78.3,
 * 62.5 and 28.8 per cent at 0, 0.02, 0.06, 0.12, 0.25, 0.45 and 0.8 — but the shipped spread
 * of 0.16 against 0.02 is only worth about four points of it, so alone it barely orders the
 * tiers. Widening it to 0.30 against 0 makes it a real axis (61.6% and 55.8% alone) at the
 * cost of a steeper overall ladder and a `easy` seat that visibly throws rockets away, so it
 * was left where it is.
 *
 * It is kept at that size for one reason worth stating: without it every tier misses in
 * exactly the same shape, only by different amounts, and a weak player who never does anything
 * *wild* is not a weak player anybody recognises.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.22, blunder: 0.16 },
  normal: { timing: 0.15, blunder: 0.08 },
  hard: { timing: 0.1, blunder: 0.02 },
});

/** How much larger a fumbled moment's error is than the tier's ordinary one. */
export const BLUNDER_SCALE = 6;

/**
 * Values a bot draws per rocket. Always exactly this many, drawn before anything branches.
 *
 * A seat whose draw count depended on what it saw would shift the other seat's stream, which
 * is a seat bias made of arithmetic rather than of gameplay. Each seat also has a generator of
 * its own; see `ExplosiveFestivalGame`. Both are asserted by tests.
 */
export const BOT_DRAWS_PER_ROCKET = 6;

/**
 * Where a bot is in a rocket's life.
 *
 * `spent` is not decoration: without it, the step a bot lets go leaves it at `plan` with a
 * rocket still nominally loaded, and a single extra call before the fire lands would draw six
 * more values for a rocket that already has a plan — the variable draw count above, arrived at
 * from the other direction.
 */
export type BotStage = 'plan' | 'column' | 'range' | 'spent';

export interface BotState {
  stage: BotStage;
  /**
   * The column it wants, in ground units, and the distance it wants, in units out from its
   * own rail.
   *
   * Two fields and not one, because they are quantities in different places on the ground and
   * a single `want` shared between press and release is exactly how a sight ends up stopped at
   * a column's number. `stage` is the other half of that guard, and each is cleared the moment
   * it has been used.
   */
  wantX: number;
  wantRange: number;
  /** Seconds of error committed to for each moment, drawn separately: two decisions. */
  columnOffset: number;
  rangeOffset: number;
  columnTimer: number;
  rangeTimer: number;
  hold: boolean;
}

export function createBotState(): BotState {
  return {
    stage: 'plan',
    wantX: 0,
    wantRange: 0,
    columnOffset: 0,
    rangeOffset: 0,
    columnTimer: 0,
    rangeTimer: 0,
    hold: false,
  };
}

export function resetBotState(state: BotState): void {
  state.stage = 'plan';
  state.wantX = 0;
  state.wantRange = 0;
  state.columnOffset = 0;
  state.rangeOffset = 0;
  state.columnTimer = 0;
  state.rangeTimer = 0;
  state.hold = false;
}

/**
 * Seconds until the cart next rolls onto `target`, given where it is and which way it is going.
 *
 * Closed form, and the reason the bot cannot deadlock: it commits to a *moment* rather than
 * watching for a position. Watching for a position is the obvious way to write this and it
 * hangs — the error is added in whichever direction the cart is currently rolling, so an error
 * larger than the rail is out of reach both ways, because the cart turns round at the end and
 * the wanted value turns round with it. A countdown cannot fail to expire.
 */
export function timeToColumn(launcher: Readonly<Launcher>, target: number): number {
  const want = clamp(target, CARRIAGE_MIN_X, CARRIAGE_MAX_X);
  if (launcher.right) {
    if (want >= launcher.x) return (want - launcher.x) / SWEEP_RATE;
    return (CARRIAGE_MAX_X - launcher.x + (CARRIAGE_MAX_X - want)) / SWEEP_RATE;
  }
  if (want <= launcher.x) return (launcher.x - want) / SWEEP_RATE;
  return (launcher.x - CARRIAGE_MIN_X + (want - CARRIAGE_MIN_X)) / SWEEP_RATE;
}

/**
 * Choose the shot, once, when a fresh rocket is loaded.
 *
 * **It takes the nearest enemy lantern still standing, and which of the two obvious rules is
 * right depends on the tier.** Clearing from the back looks correct: overshooting the far row
 * lands on bare ground, while undershooting the near row lands on your own front rank, so the
 * deep target is the one whose misses are cheapest. Played head to head at the same tier over
 * 800 seeds in each seat order, nearest-first takes **45.9% of decided matches at `easy`,
 * 61.5% at `normal` and 75.0% at `hard`** — a sign change across the ladder.
 *
 * The two effects it is trading are both on the ground and both measurable. Aiming at the
 * near lantern puts the **rest of the enemy field on the far side of the error**, so a shot
 * that goes long often finds something anyway: in-match, nearest-first wastes 48.0% of its
 * rockets at `hard` against deepest-first's 54.7%. Aiming short of it puts the shot on your
 * own front rank, and that is the price: 4.5% of `easy` shots against 0.6%, seven times as
 * many. An accurate player rarely pays it and a poor one pays it constantly, which is why the
 * comparison changes sign — and it is the clearest evidence available that the danger band in
 * {@link MIN_RANGE} is a real decision rather than scenery.
 *
 * **Both terms are in the firing seat's own frame.** Ranking by board `y` and breaking ties on
 * board `x` sorts the two seats' mirrored lanterns into *different* orders, because the ground
 * is point-symmetric between them — and the two ends of a row are the same shot mirrored but
 * not the same shot from the cart's point of view: one is reached a third of the way along the
 * rail and the other two thirds. A test drives both seats from a fixed generator and asserts
 * they choose mirrored columns and identical distances.
 */
export function planShot(
  ground: Readonly<Ground>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const columnRollA = rng.float();
  const columnRollB = rng.float();
  const rangeRollA = rng.float();
  const rangeRollB = rng.float();
  const blunderRoll = rng.float();
  const blunderSize = rng.float();

  const targets = lanternsOf(ground, otherOf(seat));
  let bestForward = Infinity;
  let bestLateral = Infinity;
  // Nothing standing is reachable in the window between a clearing shot and the sky emptying.
  // The far end of the gauge is bare ground, which is the harmless place to send a rocket.
  let wantX = CENTRE;
  let wantRange = MAX_RANGE;
  for (let i = 0; i < targets.length; i += 1) {
    const lantern = targets[i] as Lantern;
    if (!lantern.standing) continue;
    const forward = forwardOf(seat, lantern.y);
    const lateral = lateralOf(seat, lantern.x);
    const nearer = forward < bestForward - 1e-9;
    const level = Math.abs(forward - bestForward) <= 1e-9 && lateral < bestLateral;
    if (!nearer && !level) continue;
    bestForward = forward;
    bestLateral = lateral;
    wantX = lantern.x;
    wantRange = forward;
  }

  state.wantX = clamp(wantX, CARRIAGE_MIN_X, CARRIAGE_MAX_X);
  state.wantRange = clamp(wantRange, MIN_RANGE, MAX_RANGE);
  // Two draws a moment, summed: the error is triangular rather than flat, so most presses land
  // near the mark and a bad one is rare. Flat, a ladder has almost nowhere to stand — a flat
  // error either fits inside the blast or it does not, with nothing in between. Measured at
  // 3000 shots a point, per cent of rockets landing on a lantern:
  //
  //   press error   0.05   0.08   0.11   0.15   0.22   0.40
  //   triangular    99.9   88.2   68.4   51.8   36.7   24.2
  //   flat          97.7   60.8   39.6   30.1   24.1   15.7
  //
  // The three shipped tiers sit at 0.10, 0.15 and 0.22 with room either side of them on the
  // triangular curve; on the flat one they would be crammed into the twenty points between
  // 45 and 24 per cent. It is also the better picture of a person — mostly close,
  // occasionally nowhere near.
  state.columnOffset = (columnRollA + columnRollB - 1) * profile.timing;
  state.rangeOffset = (rangeRollA + rangeRollB - 1) * profile.timing;
  if (blunderRoll < profile.blunder) {
    // One roll decides both which moment is fumbled and by how much — the low bit picks the
    // moment, the rest the size — so a fumble costs the same one draw as no fumble at all.
    const slip = (((blunderSize * 2) % 1) * 2 - 1) * profile.timing * BLUNDER_SCALE;
    if (blunderSize < 0.5) state.columnOffset += slip;
    else state.rangeOffset += slip;
  }
  state.columnTimer = timeToColumn(launcherOf(ground, seat), state.wantX) + state.columnOffset;
  state.stage = 'column';
}

/**
 * Run a bot for one step and return whether it is holding its control.
 *
 * One entry point rather than a plan call and a press call, because the two have to agree
 * about the stage and a caller that got the order wrong would look like a tuning problem
 * rather than a bug. The output is the same single boolean a person's key or thumb produces
 * and it goes through {@link setHold} exactly as theirs does — so no bot stops a cart sooner,
 * runs a sight faster or fires more often than a person can (rule 6). Firing is not a separate
 * output: a bot fires by letting go, which is the only way anybody fires.
 */
export function botHold(
  ground: Readonly<Ground>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  dt: number,
): boolean {
  const launcher = launcherOf(ground, seat);
  if (ground.phase !== 'firing' || !launcher.loaded) {
    // Nothing in the tube: let go, so the next rocket starts from a fresh press rather than
    // from a thumb that never left the glass. A reload is long enough for either instrument
    // to lift and come back, which is what keeps the two the same here.
    if (!launcher.loaded) state.stage = 'plan';
    state.hold = false;
    return false;
  }

  if (state.stage === 'plan') planShot(ground, seat, difficulty, state, rng);

  if (state.stage === 'column') {
    if (state.columnTimer > dt / 2) {
      state.columnTimer -= dt;
      state.hold = false;
      return false;
    }
    // The sight takes its first step on the same step this press is taken, so its clock
    // starts one step ahead of the cart's.
    state.rangeTimer = (state.wantRange - MIN_RANGE) / SWEEP_RATE + state.rangeOffset - dt;
    // Cleared on the press. `wantX` is a column in ground units and `rangeTimer` above divides
    // a distance by a rate; leaving the column's answer standing in a field the release reads
    // is how a sight ends up stopped at a cart's number.
    state.wantX = 0;
    state.columnOffset = 0;
    state.columnTimer = 0;
    state.stage = 'range';
    state.hold = true;
    return true;
  }

  if (state.stage === 'range') {
    if (state.rangeTimer > dt / 2) {
      state.rangeTimer -= dt;
      state.hold = true;
      return true;
    }
    state.wantRange = 0;
    state.rangeOffset = 0;
    state.rangeTimer = 0;
    state.stage = 'spent';
    state.hold = false;
    return false;
  }

  // Spent: the rocket is on its way or about to be. Nothing is asked of the cart until the
  // next one is loaded, which is what `!launcher.loaded` above turns back into `plan`.
  state.hold = false;
  return false;
}
