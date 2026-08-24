import { circleCircle, createContact, set } from '@duelbox/engine';
import type { Rng, Vec2 } from '@duelbox/engine';

/**
 * Spin War, as pure rules: two spinning tops, the bowl they are launched into, and the
 * five moves a step is made of.
 *
 * No rendering, no wall clock, no DOM. The game, the bot and the balance harness all drive
 * this same file, so what the harness measures is what the player feels.
 *
 * Every length is a logical unit and every speed a logical unit per second. The bowl is a
 * dish in the middle of the square play area and belongs to neither seat, which is the
 * shared-board split the manifest declares.
 *
 * The thing that makes this a *spin* war rather than a shoving match is that spin is a
 * spendable resource. It is the whole economy of the game:
 *
 * - it decides how hard a top can drive, so a drained top cannot chase;
 * - it decides who wins a clash, so the fuller top launches the emptier one;
 * - it runs out, so a round always ends whether or not either player does anything.
 *
 * Nothing in this file ever *adds* spin. That is not a detail — it is the termination
 * guarantee. Spin falls by at least {@link IDLE_WEAR} every second of a live round, so a
 * round cannot last longer than {@link SPIN_FULL} / {@link IDLE_WEAR} seconds no matter how
 * cautiously the two seats play, and the only place spin is restored is the reset between
 * rounds.
 */

export interface Spinner {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Must be positive and finite: it divides the collision impulse. */
  mass: number;
  /**
   * Remaining spin. Starts at {@link SPIN_FULL} and only ever falls.
   *
   * It is allowed to pass zero rather than being clamped there, and that is not sloppiness
   * — it is what lets two tops that empty inside the same sixtieth of a second be told
   * apart. Clamped, both landed on exactly 0 and every close round was a tie; unclamped,
   * the one that crossed by less is the one still standing. Everything that reads it as a
   * fraction clamps at the point of use.
   */
  spin: number;
}

export interface Bowl {
  centreX: number;
  centreY: number;
  /** The crest of the lip. A top whose centre passes this has left the bowl. */
  radius: number;
  /** Slope of the dish, as a spring constant in 1/s². See {@link BOWL_SPRING}. */
  spring: number;
  /** Floor friction on the tops' travel, as a decay rate in 1/s. */
  drag: number;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export const BOWL_CENTRE_X = 400;
export const BOWL_CENTRE_Y = 400;

/**
 * The crest of the lip, and the losing line.
 *
 * A top is out once its CENTRE passes it, not once its rim does, exactly as in Sumo Push
 * and for the same reason: leaning out over the lip is then a legal and useful move, and
 * the losing line is the one point of a disc a player can judge exactly.
 */
export const BOWL_RADIUS = 285;

/**
 * The dish, as a spring.
 *
 * A bowl's floor pulls a top back towards the middle harder the further out it has slid,
 * and "harder in proportion to how far out" is a linear spring — which in Cartesian
 * coordinates separates into one independent oscillator per axis and can therefore be
 * integrated exactly. That is the whole reason the bowl is a paraboloid rather than a cone:
 * a cone's constant-magnitude inward pull is not linear in position and would have to be
 * sampled once per step, which makes the answer depend on the step size.
 *
 * 1.3 /s² gives an undriven top a damped period of about 5.75 s, so a top knocked across the
 * dish takes a second and a half to reach the far side and swings back through the middle
 * rather than parking where it landed. It is deliberately a SHALLOW dish. A steeper one held
 * both tops in the middle so firmly that no shove could carry either of them anywhere near
 * the lip, and a push-out game in which nobody can be pushed out is not the game.
 */
export const BOWL_SPRING = 1.3;

/**
 * Floor friction as a decay RATE in 1/s, not a per-step multiplier.
 *
 * At 0.65 against a spring of 1.3 the dish is lightly damped, with a damping ratio of 0.285.
 * That is the number the feel of the game hangs on twice over. A top driven flat out from the
 * middle overshoots its steady point by 39% and peaks at 207 units against a crest at
 * {@link BOWL_RADIUS} — comfortably inside, so holding a direction can never throw a player
 * out on its own. And a top that is SHOVED keeps most of what it was given: 476 units per
 * second launched from the middle is enough to carry a top over the crest, which is a speed
 * no drive can reach but a clash can. Every push-out in the game lives in that gap between
 * the two.
 */
export const BOWL_DRAG = 0.65;

export const SPINNER_RADIUS = 44;
export const SPINNER_MASS = 1;

/** Full spin, and the scale every spin-proportional constant here is expressed against. */
export const SPIN_FULL = 100;

/**
 * Floor under the pair's combined spin when a clash asks who is ahead, in spin.
 *
 * The relative gap is what decides a throw, and a ratio has to be told what to do when its
 * denominator goes to nothing. A fifth of one gauge, so the last moments of a round — where
 * both gauges are a hair from zero and the difference between them is arithmetic rather than
 * play — are judged on an absolute scale instead of an exploding relative one.
 */
export const SPIN_SHARE_FLOOR = 20;

/**
 * Drive strength in logical units per second squared, identical for both seats.
 *
 * 230 against a spring of {@link BOWL_SPRING} puts a top's steady point 177 units out —
 * well inside the bowl, and 207 even counting the overshoot on the way. A player cannot
 * drive themselves over the crest by holding one direction; being thrown out is something
 * the opponent does to you, which is what the observed rule says the game is.
 */
export const DRIVE_ACCELERATION = 230;

/**
 * Share of the drive an empty top still has, in [0, 1].
 *
 * Not zero, because a top that cannot move at all is a player with nothing to do for the
 * seconds before it topples. At 0.35 a drained top can still get about — slowly, and never
 * fast enough to arrive at a clash with any weight behind it.
 */
export const DRIVE_FLOOR = 0.35;

/**
 * Ceiling on speed, applied to the velocity a step STARTS with.
 *
 * One step at the simulation rate must move a top less than the pair's contact distance, or
 * a hard clash would pass straight through the opponent between two discrete tests. 900
 * units per second is 15 units in a 60 Hz step against a contact distance of 88.
 */
export const MAX_SPEED = 900;

/**
 * Spin lost per second by simply spinning. The floor under every round's length.
 *
 * Deliberately the SMALLEST of the three wear terms, so that what a player chooses to do
 * costs more than merely being on the dish. It is also the termination guarantee: at 3 a
 * round cannot outlast {@link SPIN_FULL} / 3 seconds — thirty-three — however cautiously
 * both seats play, and a match cannot outlast seven of those.
 */
export const IDLE_WEAR = 3;

/**
 * Extra spin per second while driving at full stick. Chasing costs; coasting does not.
 *
 * More than four times the idle rate, and that ratio IS the game's economy: a player who
 * holds the stick down empties in a little over six seconds, and one who never touches it at
 * all lasts thirty-three. Spin buys the bite, so the patient player wins the exchange that
 * decides the round — as long as they are not caught standing still when it comes, which is
 * the other half of the game and the reason patience is not simply free.
 */
export const DRIVE_WEAR = 13;

/**
 * Extra spin per second at the crest, falling away as the square of the distance in.
 *
 * The outer wall of a dish is steeper than its floor, so a top pressed against it grinds.
 * In play this is what makes the middle worth holding: the player who owns the centre is
 * spending less than the player circling the rim, and wins the clash that follows. At the
 * crest it is more than four times the idle rate, so a top that has been worked out to the
 * lip is already losing the spin war as well as the ground.
 */
export const RIM_WEAR = 14;

/** The speed change the clash toll is quoted against. */
export const CLASH_REFERENCE_SPEED = 400;

/**
 * Spin a top loses for absorbing {@link CLASH_REFERENCE_SPEED} of a clash.
 *
 * Charged per top, on the speed change that top actually took, rather than as one shared
 * bill split evenly. That is the mechanism the whole match turns on, so it is worth being
 * plain about why: a bill split evenly can never open a spin gap between two tops that are
 * playing identically, and without a gap there is no bite, and without a bite nobody is ever
 * pushed out of the bowl. Charged on what each top absorbed, ANY asymmetry — a clash met
 * off-centre, a shove taken while already sliding, the bite itself — costs the top that was
 * thrown harder more than the one that threw it. The gap that opens buys a bigger bite,
 * which opens it further, and a fight that starts even ends with one top on the lip.
 *
 * The energy for a throw comes out of the thrown top's own gyroscope, which is why this is
 * the physical account of it rather than a scoring gimmick.
 */
export const CLASH_WEAR = 5;

/** How many reference-speed clashes' worth of wear one contact may charge one top. */
const CLASH_WEAR_CAP = 2;

/**
 * How much of the speed a pair met at comes back out of the contact as separation.
 *
 * Below one, so a clash is partly inelastic: some of the meeting is absorbed rather than
 * returned, which is what the clash toll charges for. It is folded into the separation
 * target below rather than applied as a bounce of its own, so that ramming somebody and the
 * two tops' own rim speeds ADD instead of one overriding the other. That is what makes a
 * charge worth making: arriving fast is most of how a top is thrown out of the bowl, and it
 * is a thing both a person and a bot can aim for.
 */
const RESTITUTION = 0.3;

/**
 * The bite: how fast the fuller top throws the emptier one off, at a full spin gap.
 *
 * A SPEED the contact drives towards, not a shove added on top of whatever the pair are
 * already doing. That distinction is the whole of it, and getting it wrong is what made the
 * first build unplayable: a shove applied on every overlapping step is applied sixty times a
 * second for as long as the two stay touching, so it is a force of sixty times its own size
 * that also changes if the step rate ever does. Written as a target the contact stops
 * pushing the moment the pair are already parting that fast, which is what an impulse
 * between two solid things does, and it means the same at any step rate.
 *
 * This is the one place momentum is not conserved, and deliberately. A top is a gyroscope
 * standing on a dish, not a free body — the floor takes the difference — and "the top with
 * more spin left wins the exchange" is the rule the whole game is named after. With the gap
 * driving it, two equally-charged tops get a purely symmetric clash and nothing else.
 *
 * The gap it multiplies is a SHARE of what the two tops have left between them rather than
 * a fraction of a full gauge, so the same number governs the first exchange of a round and
 * the last. Against a bowl a top leaves at 476 units per second from the middle, 4800 puts
 * the throw just out of reach of two tops within a tenth of each other and well within reach
 * of two a fifth apart — which is the line the whole game is balanced on. Below it rounds
 * are decided on the gauge; above it, over the lip.
 */
const BITE_SPEED = 4800;

/** Share of the bite the fuller top feels as recoil, at a full gap. It gives ground, but far less. */
const BITE_RECOIL = 0.2;

/**
 * The most one contact may throw a pair apart at, in units per second.
 *
 * A ceiling rather than a tuning knob: past a certain gap the throw is already decisive, and
 * without one a full gauge against an empty one asked for a separation several times
 * {@link MAX_SPEED}, which the cap then trimmed on the next step anyway — a number that
 * existed only to be thrown away, and that moved a top far enough in the step before the
 * trim to be worth not having.
 */
const THROW_CEILING = 1200;

/**
 * How fast two full-spin tops shoot apart on touching at all, spin gap or no spin gap.
 *
 * Two tops that meet do not rest against each other — their rims are travelling and they
 * bounce. Without this the pair simply locks: the dish pulls both towards the middle, each
 * player drives into the other, and the contact sits there at exactly the touching distance
 * for the whole round. Every round ended on the gauge, no top was ever pushed out of the
 * bowl, and the clash wear that is supposed to open a spin gap never charged anything
 * because a locked pair has no closing speed to charge for.
 *
 * With it a fight is a sequence of clashes instead of one long lean, which is what makes the
 * rest of the model work: the pair part, the dish brings them back together at speed, and
 * the meeting costs the emptier top more than the fuller one. It falls away with the two
 * gauges, so late in a round two tired tops push each other around far less.
 */
const KICK_SPEED = 300;

/**
 * The scrape: how fast a full-spin rim is travelling at the point of contact.
 *
 * Both tops turn the same way, so where they touch their surfaces are moving in opposite
 * directions and friction throws each one along its own side of the contact. That is what
 * stops a clash from being a straight billiard-ball bounce: tops glance off each other and
 * orbit, which is what a pair of spinning tops actually does.
 *
 * Like the bite it is a speed the contact drives towards rather than a kick repeated every
 * step, and for a reason the first build demonstrated: repeated, it wound the pair up into a
 * clinch whirling at the speed cap that nothing could separate, so every round ended on the
 * gauge and no top was ever pushed out of the bowl at all. Rubbing surfaces stop dragging on
 * each other once they are no longer slipping, and this stops there too.
 */
const SCRAPE_SPEED = 150;

/** Fraction of the bowl's radius past which a bot starts pulling back towards the middle. */
const CHARGE_EDGE = 0.78;

/**
 * How much nearer the crest than itself the opponent has to be before a bot abandons its
 * own footing. Without the margin a bot on the brink would charge an opponent a hair
 * further out and take a double loss, which scores for both seats.
 */
const CHARGE_MARGIN = 0.12;

/** How far off the opponent has to be before a bot is willing to stop pushing at all. */
const COAST_CLEARANCE = 190;

/**
 * How far ahead a bot looks before letting go of the stick, in seconds.
 *
 * Distance alone is not clearance. Measured on the gap as it stands, a bot rested whenever
 * the opponent was a third of the bowl away — including when they were a third of the bowl
 * away and closing at five hundred units a second, which is a third of a second's warning.
 * It was thrown out of the bowl in every single match it played, because a top standing
 * still is the easiest thing in the game to hit: the whole of a charge's speed goes into
 * whoever is not moving. Judged on where the gap will be half a second from now, resting is
 * something a bot only does when it is genuinely alone, which is what resting is for.
 */
const COAST_HORIZON = 0.5;

interface BotProfile {
  /** Seconds of stale information the bot acts on. */
  readonly reactionSeconds: number;
  /** Radians of noise on the steering direction. */
  readonly steerError: number;
  /** Fraction of the bowl's radius past which it turns back towards the middle. */
  readonly safeEdge: number;
  /** Spin lead it wants before committing to a charge. Negative means it charges anyway. */
  readonly chargeMargin: number;
  /**
   * How near the middle it lets go of the stick.
   *
   * Spin is spent by driving, so a player who stops pushing once they hold the centre
   * arrives at the next clash with more spin than one who never lets go. It is ordinary
   * play, available to anybody holding the device, and it is most of what separates the
   * tiers here: `easy` never rests, `hard` rests inside a wide circle.
   */
  readonly coastRadius: number;
}

/**
 * Difficulty is reaction delay, steering noise and judgement — never information. Every bot
 * reads the same two tops, the same two spin gauges and the same bowl the player reads, and
 * drives with the identical acceleration, drag and speed cap.
 *
 * The three differ on when they commit as much as on how well they aim, because in this
 * economy those are the same question: `easy` charges unless it is a quarter of a gauge
 * behind and never once lets go of the stick, so it arrives at the round's last exchange
 * with nothing left; `hard` waits for a quarter of a gauge in HAND, and rests whenever it
 * holds the middle and the other top is far enough off to be no threat within half a second.
 *
 * Measured over a hundred matches a pairing, both seatings, by `measure.test.ts`:
 * hard beats easy 100, hard beats normal 100, normal beats easy 100, and each tier against
 * itself lands inside a coin toss (28/22, 24/26, 22/28 over fifty). The ladder is steeper
 * than most in this repository and that is honest rather than tuned: patience is worth a
 * great deal here, and a bot that never rests cannot win an exchange late in a round.
 */
export const BOT_PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    reactionSeconds: 0.3,
    steerError: 0.42,
    safeEdge: 0.88,
    chargeMargin: -25,
    coastRadius: 0,
  },
  normal: {
    reactionSeconds: 0.15,
    steerError: 0.2,
    safeEdge: 0.68,
    chargeMargin: -8,
    coastRadius: 80,
  },
  hard: {
    reactionSeconds: 0.05,
    steerError: 0.07,
    safeEdge: 0.5,
    chargeMargin: 25,
    coastRadius: 230,
  },
};

/**
 * The analytic step of a damped harmonic oscillator, as a 2×2 matrix.
 *
 * The bowl, the floor friction and a held direction together make one linear ODE per axis,
 * and its solution over a step is *linear* in the position and velocity the step starts
 * with. So the whole step is four numbers that depend only on the spring, the drag and the
 * step length — all three constant — and applying them is four multiplies per axis.
 *
 * Solving it rather than integrating it is what makes the simulation step-size independent:
 * two steps of `h` and one step of `2h` land on the same numbers, so a 144 Hz laptop plays
 * the identical match to a 60 Hz phone. An Euler or Verlet step does not have that property
 * and a bowl is exactly where it would show, because a spring is the case those schemes get
 * wrong first.
 */
export interface SpringStep {
  /** Position contributed by the starting position. */
  pp: number;
  /** Position contributed by the starting velocity. */
  pv: number;
  /** Velocity contributed by the starting position. */
  vp: number;
  /** Velocity contributed by the starting velocity. */
  vv: number;
}

/** Allocates, so setup only. */
export function createSpringStep(): SpringStep {
  return { pp: 1, pv: 0, vp: 0, vv: 1 };
}

/**
 * Discriminant window inside which the oscillator is treated as critically damped.
 *
 * Both the underdamped and the overdamped forms divide by the square root of the
 * discriminant, and both tend to the critical form as it approaches zero. Near the boundary
 * the division is catastrophic rather than merely imprecise, so the limit is used instead.
 */
const CRITICAL_EPSILON = 1e-9;

/**
 * Write the step matrix for `spring`, `drag` and `dt` into `out`.
 *
 * All four damping regimes are covered even though the bowl only ever uses one, because a
 * solver that is only correct for today's constants is a trap for whoever retunes them: an
 * overdamped bowl would silently produce nonsense rather than a slower bowl.
 *
 * @throws RangeError if `dt` is negative or not finite.
 */
export function solveSpring(out: SpringStep, spring: number, drag: number, dt: number): SpringStep {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new RangeError(`solveSpring: dt must be a non-negative finite number, got ${String(dt)}`);
  }

  if (spring <= 0) {
    // No dish at all: a free body under linear drag, which is Sumo Push's integrator.
    const decay = Math.exp(-drag * dt);
    out.pp = 1;
    out.pv = drag > 0 ? (1 - decay) / drag : dt;
    out.vp = 0;
    out.vv = decay;
    return out;
  }

  const discriminant = drag * drag - 4 * spring;
  if (discriminant < -CRITICAL_EPSILON) {
    const damped = Math.sqrt(-discriminant) / 2;
    const decay = Math.exp((-drag * dt) / 2);
    const cos = Math.cos(damped * dt);
    const sin = Math.sin(damped * dt);
    out.pp = decay * (cos + ((drag / 2) * sin) / damped);
    out.pv = (decay * sin) / damped;
    out.vp = (-decay * spring * sin) / damped;
    out.vv = decay * (cos - ((drag / 2) * sin) / damped);
    return out;
  }

  if (discriminant > CRITICAL_EPSILON) {
    const spread = Math.sqrt(discriminant);
    const fast = (-drag + spread) / 2;
    const slow = (-drag - spread) / 2;
    const fastTerm = Math.exp(fast * dt);
    const slowTerm = Math.exp(slow * dt);
    out.pp = (fast * slowTerm - slow * fastTerm) / spread;
    out.pv = (fastTerm - slowTerm) / spread;
    out.vp = (-spring * (fastTerm - slowTerm)) / spread;
    out.vv = (fast * fastTerm - slow * slowTerm) / spread;
    return out;
  }

  const decay = Math.exp((-drag * dt) / 2);
  out.pp = decay * (1 + (drag * dt) / 2);
  out.pv = decay * dt;
  out.vp = -decay * spring * dt;
  out.vv = decay * (1 - (drag * dt) / 2);
  return out;
}

/** Scratch contact for {@link collideSpinners}. Module scope so a step allocates nothing. */
const contact = createContact();

/** Allocates, so setup only. */
export function createSpinner(x: number, y: number): Spinner {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    radius: SPINNER_RADIUS,
    mass: SPINNER_MASS,
    spin: SPIN_FULL,
  };
}

/** Allocates, so setup only. */
export function createBowl(): Bowl {
  return {
    centreX: BOWL_CENTRE_X,
    centreY: BOWL_CENTRE_Y,
    radius: BOWL_RADIUS,
    spring: BOWL_SPRING,
    drag: BOWL_DRAG,
  };
}

/** Distance of a top's centre from the middle of the bowl. */
export function radiusOf(s: Readonly<Spinner>, bowl: Readonly<Bowl>): number {
  const dx = s.x - bowl.centreX;
  const dy = s.y - bowl.centreY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Share of the drive a top can put down, in [{@link DRIVE_FLOOR}, 1].
 *
 * A top that has spun down has less to push against and drives correspondingly weakly, so
 * losing the spin war costs control before it costs the round. Clamped rather than trusted:
 * a spin outside its range would otherwise turn into a drive outside the shared envelope.
 */
export function driveShare(spin: number): number {
  let ratio = spin / SPIN_FULL;
  if (!(ratio > 0)) ratio = 0;
  else if (ratio > 1) ratio = 1;
  return DRIVE_FLOOR + (1 - DRIVE_FLOOR) * ratio;
}

/**
 * Advance one top by the step `solution` describes, driven towards `(inputX, inputY)`.
 *
 * The input is a direction, not a speed: anything longer than the unit circle is rescaled,
 * so a diagonal push is no faster than a straight one, while a stick held gently stays
 * gentle. A constant drive over the step simply moves the oscillator's rest point, which is
 * why the whole thing stays one exactly-solvable ODE.
 */
export function stepSpinner(
  s: Spinner,
  inputX: number,
  inputY: number,
  bowl: Readonly<Bowl>,
  solution: Readonly<SpringStep>,
): void {
  let vx = s.vx;
  let vy = s.vy;
  const speedSq = vx * vx + vy * vy;
  if (speedSq > MAX_SPEED * MAX_SPEED) {
    const trim = MAX_SPEED / Math.sqrt(speedSq);
    vx *= trim;
    vy *= trim;
  }

  let dirX = inputX;
  let dirY = inputY;
  const lenSq = dirX * dirX + dirY * dirY;
  if (lenSq > 1) {
    const inv = 1 / Math.sqrt(lenSq);
    dirX *= inv;
    dirY *= inv;
  }

  // A constant force displaces the rest point by force / spring and changes nothing else.
  const reach = (DRIVE_ACCELERATION * driveShare(s.spin)) / bowl.spring;
  const restX = bowl.centreX + dirX * reach;
  const restY = bowl.centreY + dirY * reach;

  const offsetX = s.x - restX;
  const offsetY = s.y - restY;
  s.x = restX + offsetX * solution.pp + vx * solution.pv;
  s.y = restY + offsetY * solution.pp + vy * solution.pv;
  s.vx = offsetX * solution.vp + vx * solution.vv;
  s.vy = offsetY * solution.vp + vy * solution.vv;
}

/**
 * Spend the spin this step costs, and report what is left.
 *
 * `driveAmount` is the length of the direction the seat asked for, clamped to one, so a
 * player who lets go of the stick pays only the idle rate. Spin is never added here — see
 * the note at the top of this file for why that matters — and is deliberately not floored
 * at zero; see {@link Spinner.spin}.
 */
export function wearSpin(
  s: Spinner,
  driveAmount: number,
  bowl: Readonly<Bowl>,
  dt: number,
): number {
  let effort = driveAmount;
  if (!(effort > 0)) effort = 0;
  else if (effort > 1) effort = 1;

  const edge = radiusOf(s, bowl) / bowl.radius;
  const grind = edge > 1 ? 1 : edge * edge;
  const rate = IDLE_WEAR + DRIVE_WEAR * effort + RIM_WEAR * grind;

  s.spin -= rate * dt;
  return s.spin;
}

/**
 * Resolve one top-against-top contact and report whether it happened, for the sound and
 * juice layer.
 *
 * Three impulses land here and they do different jobs. The elastic exchange separates the
 * pair. The **bite** is the spin war itself: the fuller top launches the emptier one and
 * gives only {@link BITE_RECOIL} of that ground back. The **scrape** throws both sideways,
 * each along its own side of the contact, which is what makes two tops orbit rather than
 * bounce.
 *
 * Every one of them is written so that mirroring the whole board and swapping the arguments
 * produces the mirrored result exactly — the bite reads the sign of the spin gap rather
 * than which argument came first, which is the form that stays symmetric.
 */
export function collideSpinners(a: Spinner, b: Spinner): boolean {
  if (!circleCircle(contact, a, b)) return false;

  // Points from a out of b: moving a along it separates the pair.
  const nx = contact.normalX;
  const ny = contact.normalY;
  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const invSum = invA + invB;

  const depth = contact.depth;
  if (depth > 0) {
    const shareA = (invA / invSum) * depth;
    const shareB = depth - shareA;
    a.x += nx * shareA;
    a.y += ny * shareA;
    b.x -= nx * shareB;
    b.y -= ny * shareB;
  }

  // Held so the toll below can be charged on the speed change each top actually took.
  const wasAX = a.vx;
  const wasAY = a.vy;
  const wasBX = b.vx;
  const wasBY = b.vy;

  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  const met = closing < 0 ? -closing : 0;

  // What the two of them have left, and how it is divided. The gap is measured against the
  // pair's OWN total rather than against a full gauge, so it means the same thing at the end
  // of a round as at the start: ten turns of daylight is nothing while both tops are near
  // full and decisive when both are nearly spent, which is what a spin war is. The shove
  // that finishes a round lands when the loser has nothing left to answer with.
  const total = a.spin + b.spin;
  let between = total;
  if (!(between > SPIN_SHARE_FLOOR)) between = SPIN_SHARE_FLOOR;
  let gap = (a.spin - b.spin) / between;
  if (gap > 1) gap = 1;
  else if (gap < -1) gap = -1;
  const lead = gap >= 0 ? gap : -gap;

  /** How much turn there is between the two of them, in [0, 1]: the size of the exchange. */
  let rub = total / (2 * SPIN_FULL);
  if (!(rub > 0)) rub = 0;
  else if (rub > 1) rub = 1;

  // Whichever top has more spin left keeps its ground; the other one is thrown. The shares
  // BLEND rather than switch: level, both are 1 and the pair parts evenly, and only real
  // daylight starts holding the fuller top's ground for it. Switching outright made the very
  // smallest gap — a millionth of a turn — throw the pair as lopsidedly as an empty top
  // against a full one, which is not a spin war, it is a coin toss.
  //
  // The blend bends rather than running straight, because both tops leave a clash heading
  // OUTWARDS: unless the fuller one gives up much less ground than the emptier one, the
  // exchange that throws the loser over the lip throws the winner over it too, and a round
  // that pays both seats two points is a stalemate with extra steps. It bends as
  // 1 - (1 - lead)² rather than as a square root, which was tried first and has an infinite
  // slope at zero: the root turned a difference of one part in ten thousand million million
  // — arithmetic, not play — into a hundred-millionth of a bias, and compounded over a round
  // that was enough that a match nobody played stopped ending level.
  const bias = 1 - (1 - lead) * (1 - lead);
  const hold = 1 - (1 - BITE_RECOIL) * bias;
  const shareA = gap >= 0 ? hold : 1;
  const shareB = gap >= 0 ? 1 : hold;

  // The speed the contact throws the pair apart at: their own rims, the spin war between
  // them, and whatever they met at. A pair already parting faster than this is left alone —
  // the contact throws tops apart, it never pulls them together, and it never doubles up on
  // a bounce that has already happened.
  let thrown = KICK_SPEED * rub + BITE_SPEED * lead + RESTITUTION * met;
  if (thrown > THROW_CEILING) thrown = THROW_CEILING;
  if (closing < thrown) {
    const j = (thrown - closing) / (invA * shareA + invB * shareB);
    a.vx += j * invA * shareA * nx;
    a.vy += j * invA * shareA * ny;
    b.vx -= j * invB * shareB * nx;
    b.vy -= j * invB * shareB * ny;
  }

  // Perpendicular to the contact. Both rims are moving the same way about their own
  // centres, so at the touching point they move opposite ways and each is thrown along it.
  const tangentX = -ny;
  const tangentY = nx;
  // The two rims are slipping past each other at twice the surface speed, one each way, and
  // friction pulls the pair towards moving with them. Once they are, it has nothing left to
  // pull on.
  const slip = (a.vx - b.vx) * tangentX + (a.vy - b.vy) * tangentY;
  const rubbing = -2 * SCRAPE_SPEED * rub;
  if (slip > rubbing) {
    const j = (slip - rubbing) / invSum;
    a.vx -= j * invA * tangentX;
    a.vy -= j * invA * tangentY;
    b.vx += j * invB * tangentX;
    b.vy += j * invB * tangentY;
  }

  // Grinding costs both tops, and costs whichever one the exchange threw harder more. See
  // {@link CLASH_WEAR}: this is what turns a small spin lead into a bigger one, and what
  // stops two evenly matched tops from locking together for the whole round.
  a.spin -= clashToll(a.vx - wasAX, a.vy - wasAY);
  b.spin -= clashToll(b.vx - wasBX, b.vy - wasBY);
  return true;
}

/** What one top pays for absorbing a speed change of `(dvx, dvy)` in a clash. */
function clashToll(dvx: number, dvy: number): number {
  let toll = Math.sqrt(dvx * dvx + dvy * dvy) / CLASH_REFERENCE_SPEED;
  if (toll > CLASH_WEAR_CAP) toll = CLASH_WEAR_CAP;
  return CLASH_WEAR * toll;
}

/**
 * Out once the top's CENTRE has left the bowl, not once its rim has.
 *
 * A centre lying exactly on the crest is still in: one rule, no epsilon.
 */
export function isOut(s: Readonly<Spinner>, bowl: Readonly<Bowl>): boolean {
  const dx = s.x - bowl.centreX;
  const dy = s.y - bowl.centreY;
  return dx * dx + dy * dy > bowl.radius * bowl.radius;
}

/** Toppled: the top has run out of spin and has fallen over where it stands. */
export function isToppled(s: Readonly<Spinner>): boolean {
  return s.spin <= 0;
}

/** Points that win a match — the four the observed rule names. */
export const POINTS_TO_WIN = 4;

/**
 * A top shoved over the lip is worth two, a top left standing when the other runs down is
 * worth one.
 *
 * The observed rule leads with "push your opponent out of the bowl", so the push is what
 * the scoring rewards: two clean throws win a match, while out-lasting an opponent four
 * times over is the slow road to the same four points. **[ours]**
 */
export const RING_OUT_POINTS = 2;
export const TOPPLE_POINTS = 1;

/**
 * How far apart two run-down gauges have to be for one of them to have won, in spin.
 *
 * A millionth of a turn: far below anything a player could see on an eight-tick gauge, far
 * below one step of the idle wear, and far above the arithmetic.
 *
 * It exists because "the top with more spin left is standing" has no answer at all for two
 * tops that ran down together, and a match nobody plays is exactly that case: the two start
 * identical, the bowl is symmetric about its middle, and every rule treats the seats alike,
 * so both gauges empty in the same step. They do not empty on the same *number* — the two
 * seats' coordinates are mirror images about 400 rather than about zero, so the arithmetic
 * differs in the last bit or two — and a bare comparison hands the round to whichever side
 * of the bowl the rounding fell on. Ten femto-turns is not a spin war. It is a tie, and the
 * whole reason this game has a draw is so it can say so.
 */
export const SPIN_TIE_EPSILON = 1e-6;

/** What a round paid each seat. Reused between rounds so scoring allocates nothing. */
export interface RoundPoints {
  p1: number;
  p2: number;
}

/** Allocates, so setup only. */
export function createRoundPoints(): RoundPoints {
  return { p1: 0, p2: 0 };
}

/**
 * Award the round into `out`, and report whether it ended at all.
 *
 * Two rules, in order. **Over the lip** ends it outright and pays
 * {@link RING_OUT_POINTS}; both tops leaving in the same step pays both, because a
 * genuinely simultaneous throw is a shared round rather than a win for whichever seat the
 * code happened to test first.
 *
 * **Running down** ends it too, but it is settled by comparison rather than by threshold:
 * the moment either gauge reaches zero the round goes to whichever top has more spin left.
 * Written as a threshold — "the top at zero loses" — a round in which both gauges emptied
 * inside the same sixtieth of a second paid both seats, and since the two tops start
 * identical that turned out to be a third of all rounds between two bots, so a third of
 * matches ended 4-4.
 *
 * The comparison is made to {@link SPIN_TIE_EPSILON} rather than exactly, because two tops
 * that were never touched DO run down together and the last bit of the arithmetic is not a
 * spin war. A shared round is what two untouched tops in a symmetric bowl actually produce,
 * and saying so is the difference between a draw and a coin toss.
 */
export function scoreRound(
  out: RoundPoints,
  p1: Readonly<Spinner>,
  p2: Readonly<Spinner>,
  bowl: Readonly<Bowl>,
): boolean {
  out.p1 = 0;
  out.p2 = 0;

  const outP1 = isOut(p1, bowl);
  const outP2 = isOut(p2, bowl);
  if (outP1 || outP2) {
    if (outP2) out.p1 = RING_OUT_POINTS;
    if (outP1) out.p2 = RING_OUT_POINTS;
    return true;
  }

  if (!isToppled(p1) && !isToppled(p2)) return false;

  const between = p1.spin - p2.spin;
  if (between > SPIN_TIE_EPSILON) out.p1 = TOPPLE_POINTS;
  else if (-between > SPIN_TIE_EPSILON) out.p2 = TOPPLE_POINTS;
  else {
    out.p1 = TOPPLE_POINTS;
    out.p2 = TOPPLE_POINTS;
  }
  return true;
}

/**
 * The direction a bot wants to drive, written into `out` as a unit vector or zero.
 *
 * The bot reads the opponent's position and velocity, both spin gauges and the bowl, and
 * nothing else — every one of them is drawn on the screen the player is looking at. Its
 * difficulty lives in how stale that reading is, how much noise it puts on its steering,
 * how early it turns back from the crest, how big a spin lead it wants before it commits,
 * and how readily it stops pushing to save spin. The vector it returns is the same length a
 * player's held stick produces, so it never moves faster than a person could.
 */
export function botInput(
  out: Vec2,
  self: Readonly<Spinner>,
  other: Readonly<Spinner>,
  bowl: Readonly<Bowl>,
  difficulty: BotDifficulty,
  rng: Rng,
): Vec2 {
  const profile = BOT_PROFILES[difficulty];

  // Acting on where the opponent WAS is strictly less information than the player opposite
  // has, never more.
  const lag = profile.reactionSeconds;
  const targetX = other.x - other.vx * lag;
  const targetY = other.y - other.vy * lag;

  const selfX = self.x - bowl.centreX;
  const selfY = self.y - bowl.centreY;
  const selfDist = Math.sqrt(selfX * selfX + selfY * selfY);
  const otherX = targetX - bowl.centreX;
  const otherY = targetY - bowl.centreY;
  const otherDist = Math.sqrt(otherX * otherX + otherY * otherY);
  const selfEdge = selfDist / bowl.radius;
  const otherEdge = otherDist / bowl.radius;

  const reachX = targetX - self.x;
  const reachY = targetY - self.y;
  const reach = Math.sqrt(reachX * reachX + reachY * reachY);

  const lead = self.spin - other.spin;
  // Charge when the spin ledger says the clash is worth taking, or when the opponent is
  // already close enough to the crest that one shove finishes it.
  const finisher = otherEdge > CHARGE_EDGE && otherEdge - selfEdge > CHARGE_MARGIN;
  const attack = finisher || lead >= profile.chargeMargin;

  let aimX = 0;
  let aimY = 0;
  if (attack && reach > 0) {
    aimX = reachX / reach;
    aimY = reachY / reach;
  } else {
    // Behind on spin: give ground rather than trade. Backing straight off walks into the
    // rim, where the grind is worst, so the retreat is a blend — away from the opponent
    // near the middle, and increasingly straight back towards the middle further out.
    //
    // Written as "steer at the centre" it was worse than useless: two bots that both aim
    // at the middle park on top of each other and clash every step, and a bot given enough
    // steering noise to miss the middle beat a precise one by simply not being there.
    let pull = selfEdge / profile.safeEdge;
    if (pull > 1) pull = 1;
    const awayX = reach > 0 ? -reachX / reach : 0;
    const awayY = reach > 0 ? -reachY / reach : 0;
    const inwardX = selfDist > 0 ? -selfX / selfDist : 0;
    const inwardY = selfDist > 0 ? -selfY / selfDist : 0;
    aimX = awayX * (1 - pull) + inwardX * pull;
    aimY = awayY * (1 - pull) + inwardY * pull;
  }

  let retreat = (selfEdge - profile.safeEdge) / (1 - profile.safeEdge);
  if (retreat < 0) retreat = 0;
  else if (retreat > 1) retreat = 1;
  // A bot still finishes the push when the opponent is the one about to go out: that trade
  // is exactly what wins a round.
  if (finisher) retreat = 0;
  if (retreat > 0 && selfDist > 0) {
    const inwardX = -selfX / selfDist;
    const inwardY = -selfY / selfDist;
    aimX = aimX * (1 - retreat) + inwardX * retreat;
    aimY = aimY * (1 - retreat) + inwardY * retreat;
  }

  // One draw on every path, whatever the branches above chose, so a replay of the same
  // bout stays in step with the generator.
  const wobble = (rng.float() * 2 - 1) * profile.steerError;

  // Pushing while nothing is happening burns spin for nothing. Letting go while the
  // opponent is nowhere near and the middle is already held is the patient play, and it is
  // part of what separates a hard bot from an easy one. The clearance matters: coasting
  // with an opponent bearing down is not patience, it is standing still to be hit — so the
  // gap is judged {@link COAST_HORIZON} ahead rather than as it stands.
  const approach =
    reach > 0 ? ((self.vx - other.vx) * reachX + (self.vy - other.vy) * reachY) / reach : 0;
  const room = reach - (approach > 0 ? approach : 0) * COAST_HORIZON;
  if (!attack && room > COAST_CLEARANCE && selfDist <= profile.coastRadius) {
    return set(out, 0, 0);
  }

  const cos = Math.cos(wobble);
  const sin = Math.sin(wobble);
  const steerX = aimX * cos - aimY * sin;
  const steerY = aimX * sin + aimY * cos;

  const steer = Math.sqrt(steerX * steerX + steerY * steerY);
  if (steer === 0) return set(out, 0, 0);
  return set(out, steerX / steer, steerY / steer);
}
