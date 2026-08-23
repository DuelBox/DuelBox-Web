import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Flappy Jump, as pure rules.
 *
 * One lane at each end of the device: each seat has its own jumper, its own floor along
 * the edge nearest them, and its own run of hoops drifting toward it. Tap to beat a wing
 * and rise; hold to glide; let go and gravity takes you back down; thread the hoop as it
 * arrives and that is a basket. First to ten.
 *
 * **The two lanes are the point.** Nothing is shared and nothing alternates — no ball to
 * contest, no turn order, no first mover. The hoops come out of one seeded stream and are
 * pushed into *both* lanes at the same step with the same gap centre, so the two seats are
 * not merely balanced on average, they are handed the identical run of obstacles at the
 * identical moment. Seat fairness is therefore structural rather than tuned, and
 * `rules.test.ts` proves it by playing the same taps into both seats and demanding the two
 * lanes come out byte-identical.
 *
 * Everything below is expressed in **lane-local** coordinates: `height` is measured up
 * from your own floor, `lead` is how far ahead of your jumper a hoop still is. Both lanes
 * therefore hold literally the same numbers, and the sign flips that turn one lane upside
 * down live in {@link worldYOf} and {@link worldXOf}, which only the renderer calls. That
 * is what makes "the two lanes are identical" checkable by equality rather than by
 * mirror arithmetic that could itself be wrong.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit.
 */

export const FIELD_WIDTH = 640;
export const FIELD_HEIGHT = 1000;

/**
 * How tall one seat's lane is.
 *
 * Two of these plus the divider make the field, so the layout is symmetric under a half
 * turn: each player's floor is the edge nearest them and the shared band is in the middle.
 */
export const LANE_HEIGHT = 470;
/** The band between the two lanes, which belongs to neither and carries the hoop budget. */
export const DIVIDER = FIELD_HEIGHT - LANE_HEIGHT * 2;

/** Where along its lane a jumper sits. The world scrolls past it; it never moves sideways. */
export const JUMPER_X = 150;

export const JUMPER_RADIUS = 15;

/**
 * Units a second squared, pulling toward your own floor.
 *
 * With {@link FLAP_SPEED} this puts one wing-beat at 82 units of climb and 0.35 s to the
 * top of the arc — about a sixth of a lane, which is the ratio that makes a hoop something
 * you steer toward over a second rather than something you snap onto.
 */
export const GRAVITY = 1350;

/** A wing-beat *sets* the climb rate rather than adding to it, so beats never stack. */
export const FLAP_SPEED = 470;

/**
 * Seconds a wing needs before it can beat again. Presses inside it do nothing.
 *
 * **This is what makes the game fair between a thumb and a keyboard**, and it is the only
 * reason this game does not have to declare `sameInputClassOnly` the way Road Dodge does.
 * A one-button game is decided by how fast you can press, and a key can be pressed faster
 * than a screen can be tapped. With the beat set by the press alone, a masher pressing on
 * every step climbs at 447 u/s while a six-a-second tapper manages 346 — 29% more, for
 * nothing but the instrument in your hand. Recharging the wing caps *everybody* at 5.45
 * beats a second and 335 u/s, a rate a thumb reaches comfortably, so the ceiling belongs
 * to the bird and not to the keyboard.
 *
 * **The press has to be buffered rather than dropped**, and that was not obvious. Ignoring
 * a press that arrives mid-recharge puts an aliasing beat between the player's rhythm and
 * the wing's: a tapper at six a second lands every other tap inside the recharge, loses it,
 * and climbs at **234 u/s** — worse than the version with no cap at all, and worse in a way
 * that depends on a rhythm nobody can feel. Holding the press until the wing is ready makes
 * the cap what it claims to be: everyone tapping at 5.45 a second or faster gets 335 u/s
 * and nobody gets more. `game.test.ts` drives a masher and a tapper through the real input
 * stack and asserts they climb the identical distance. **[ours]**
 */
export const FLAP_RECHARGE = 0.18;

/**
 * Fall speed while the button is *held* rather than tapped.
 *
 * One button, two controls: a tap beats a wing, a hold spreads them and turns a plummet
 * into a slow descent. It is what makes arriving at a hoop a matter of steering rather
 * than of luck, and it is expressible identically by a held key and a resting thumb, so it
 * costs nothing in cross-family fairness. Holding while rising does nothing at all — the
 * glide only ever caps a fall. **[ours]**
 */
export const GLIDE_FALL = 150;
/** Terminal velocity in a free fall, so a drop from the top is quick but not instant. */
export const MAX_FALL = 720;

/** How fast the hoops travel down a lane. Constant: the difficulty is in the gap, not the pace. */
export const HOOP_SPEED = 290;
/** Distance between one hoop and the next, so a player can always see the one after. */
export const HOOP_SPACING = 440;
/** Where a hoop enters, just beyond the far edge of the lane. */
export const SPAWN_LEAD = 530;
/** Where a hoop is retired, well past the jumper and off the near edge. */
export const DESPAWN_LEAD = -220;
/** Slots per lane. The travel span over the spacing is under three, so four never fills. */
export const HOOP_POOL = 4;

/** The gap a hoop offers before you have scored anything. */
export const GAP_START = 144;
/** Units of gap lost per basket **you** have scored. */
export const GAP_SHRINK = 6;
/** The tightest a hoop ever gets, however far ahead you are. */
export const GAP_MIN = 90;

/**
 * How wide the gap is for a seat that has scored `baskets`.
 *
 * **The rule that keeps a lead from running away, and the reason the tenth basket is the
 * hard one.** The hoops themselves are shared and identical; what differs between the two
 * lanes is only how much of each hoop is open, and that depends on nothing but your own
 * score. So it is a handicap you inflict on yourself by succeeding, symmetric by
 * construction, and it needs no knowledge of the opponent at all — which matters, because
 * a rubber band that reads the *other* seat's score would make one player's play depend on
 * the other's, and this game has no shared state by design.
 *
 * **It is also what stops two good players drawing.** The two lanes are handed identical
 * hoops at identical moments, so two evenly matched players are correlated in a way they
 * would not be in a game where they took turns — and a `hard` bot on a fixed gap threads
 * 93% of its hoops and reaches ten in 11.7 of them, which two of them do at the same
 * instant remarkably often. Measured over 200 matches a side:
 *
 * | | fixed gap | narrowing gap |
 * |---|---|---|
 * | `hard` hoops threaded | 93% | 85% |
 * | Hoops to reach ten | 11.7 | 12.7 |
 * | `hard` v `hard` drawn | 37.5% | 13% |
 *
 * The narrowing is what puts the last two baskets out of reach of a perfect run, and a
 * match with one mistake in it has something to separate the two players by. **[ours]**
 */
export function gapFor(baskets: number): number {
  const gap = GAP_START - baskets * GAP_SHRINK;
  return gap < GAP_MIN ? GAP_MIN : gap;
}

/**
 * How far the rim runs beyond the edge of the gap.
 *
 * Long enough that going round a hoop takes real commitment, short enough that it is
 * possible at all when the gap sits near the middle of the lane. A rim that reaches the
 * floor or the ceiling is simply sealed on that side, and a low hoop is therefore one you
 * must go *through*.
 */
export const POST_LENGTH = 74;
export const POST_THICKNESS = 12;

/** The band the gap centre is drawn from, so a hoop always leaves a way past on one side. */
export const CENTRE_MIN = 110;
export const CENTRE_MAX = 360;
/**
 * The most one hoop's centre may differ from the last.
 *
 * A free draw over the band gives a sequence that reads as noise; a limited step gives a
 * *path*, which is a thing a player can plan against. 1.52 s at the top climb rate covers
 * 528 units, so 150 is never a demand the jumper cannot meet — the limit is there for
 * legibility, not for reachability.
 */
export const CENTRE_STEP = 150;

/** How hard a rim knocks you back toward your floor. */
export const RIM_KNOCK = 260;
/** Seconds a rim strike costs you, during which the wing will not beat. */
export const STUN_SECONDS = 0.32;

export const TARGET_BASKETS = 10;

/**
 * How many hoops the whole match is worth.
 *
 * **This is the termination guarantee, and it is structural rather than clockwork.** Hoops
 * enter at a fixed spacing and travel at a fixed speed whatever either player does, so the
 * field is exhausted after exactly this many of them — about 63 seconds of play — and the
 * match is then called on baskets. A match in which neither player ever scores still ends,
 * because ending does not depend on scoring. `ROUND_SECONDS` below is a second, looser
 * backstop against a future change to the pacing, not the mechanism.
 */
export const MAX_HOOPS = 40;

/** How long the jumper hovers before gravity is switched on, so both players can look up. */
export const READY_SECONDS = 1.4;

/**
 * How much of the first hoop's approach has already happened when the match begins.
 *
 * Tuned rather than chosen. At zero the first hoop is released on the opening step and
 * arrives 0.43 s after gravity does, which is not enough time to climb to it from the
 * middle of the lane — the opening basket was decided by where the first centre happened
 * to fall. Holding the first release back until the hover is most of the way through gives
 * every match the same second of clear air to read the first hoop in.
 */
export const OPENING_SLACK = 160;

/**
 * The match is called after this long whatever else has happened.
 *
 * The hoop budget already bounds a match at roughly 62 s, so nothing reaches this today.
 * It is here because `roundSeconds` in the manifest ends nothing — the catalogue card is
 * its only reader — and a game whose only guarantee lives in its pacing constants is one
 * change away from running for ever. See the note at the top of `termination.test.ts`.
 */
export const ROUND_SECONDS = 90;

export type Phase = 'ready' | 'flying' | 'over';

/** What a player asked for this step. `glide` is a held button, `flap` a fresh press. */
export type Intent = 'idle' | 'flap' | 'glide';

/** How one hoop resolved against one jumper. Exactly one of these per hoop per lane. */
export type LaneEvent = 'none' | 'basket' | 'rim' | 'miss';

export interface Hoop {
  /** False when this pool slot is unused. */
  live: boolean;
  /** Distance still to travel before it reaches the jumper. Negative once past. */
  lead: number;
  /** Height of the middle of the gap, above the lane floor. Shared by both lanes. */
  centre: number;
  /** Set the step this hoop passed the jumper, so it can only ever score once. */
  resolved: boolean;
}

export interface Lane {
  /** Height above this seat's own floor. */
  height: number;
  /** Units a second, positive away from the floor. */
  velocity: number;
  /** Seconds until the wing can beat again. */
  recharge: number;
  /**
   * A press that arrived while the wing was still recharging, waiting to be spent.
   *
   * See {@link FLAP_RECHARGE}: dropping such a press outright is what a first pass does,
   * and it puts a nasty aliasing beat between the player's tapping rate and the recharge.
   */
  buffered: boolean;
  /** Seconds of rim stun left, during which a press does nothing. */
  stun: number;
  readonly hoops: Hoop[];
  baskets: number;
  /** Hoops struck on the rim. The tie-break, and the reason a near miss is worse. */
  rims: number;
  /** Hoops gone by above or below the rim entirely. */
  misses: number;
  /** Baskets in a row right now. Reset by anything that is not a basket. */
  streak: number;
  /** The longest run of baskets this seat has put together. The last tie-break. */
  bestStreak: number;
}

export interface Match {
  readonly p1: Lane;
  readonly p2: Lane;
  /** Distance the field has scrolled since the last hoop entered. */
  sinceSpawn: number;
  /** Hoops released so far, out of {@link MAX_HOOPS}. */
  hoopsEntered: number;
  /** The last centre drawn, so the next one is a readable step from it. */
  lastCentre: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
  /** Counts down the opening hover. */
  readyDelay: number;
  /** Seconds the match has run, for the backstop. */
  elapsed: number;
}

function createHoop(): Hoop {
  return { live: false, lead: 0, centre: 0, resolved: false };
}

function createLane(): Lane {
  const hoops: Hoop[] = [];
  for (let i = 0; i < HOOP_POOL; i += 1) hoops.push(createHoop());
  return {
    height: LANE_HEIGHT / 2,
    velocity: 0,
    recharge: 0,
    buffered: false,
    stun: 0,
    hoops,
    baskets: 0,
    rims: 0,
    misses: 0,
    streak: 0,
    bestStreak: 0,
  };
}

export function createMatch(): Match {
  return {
    p1: createLane(),
    p2: createLane(),
    sinceSpawn: HOOP_SPACING - OPENING_SLACK,
    hoopsEntered: 0,
    lastCentre: LANE_HEIGHT / 2,
    phase: 'ready',
    winner: null,
    readyDelay: READY_SECONDS,
    elapsed: 0,
  };
}

function resetLane(lane: Lane): void {
  lane.height = LANE_HEIGHT / 2;
  lane.velocity = 0;
  lane.recharge = 0;
  lane.buffered = false;
  lane.stun = 0;
  for (const hoop of lane.hoops) {
    hoop.live = false;
    hoop.lead = 0;
    hoop.centre = 0;
    hoop.resolved = false;
  }
  lane.baskets = 0;
  lane.rims = 0;
  lane.misses = 0;
  lane.streak = 0;
  lane.bestStreak = 0;
}

export function resetMatch(match: Match): void {
  resetLane(match.p1);
  resetLane(match.p2);
  match.sinceSpawn = HOOP_SPACING - OPENING_SLACK;
  match.hoopsEntered = 0;
  match.lastCentre = LANE_HEIGHT / 2;
  match.phase = 'ready';
  match.winner = null;
  match.readyDelay = READY_SECONDS;
  match.elapsed = 0;
}

export function laneOf(match: Match, seat: SeatId): Lane {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function basketsOf(match: Readonly<Match>, seat: SeatId): number {
  return seat === 'p1' ? match.p1.baskets : match.p2.baskets;
}

/** How wide this lane's hoops are right now. Drawn as well as simulated. */
export function gapOf(lane: Readonly<Lane>): number {
  return gapFor(lane.baskets);
}

/* ------------------------------------------------------------------ *
 * Lane-local space to world space.
 *
 * The only place the two lanes stop being the same thing. p1 owns the bottom of the
 * field with its floor at the bottom edge; p2 owns the top with its floor at the top
 * edge, which is a half turn of p1's lane about the centre of the field — exactly the
 * transform the shell already applies to the far seat's view. Both readings of the
 * device are therefore upright, and `rules.test.ts` asserts the point symmetry rather
 * than trusting the arithmetic here.
 * ------------------------------------------------------------------ */

/** Where a point `lead` ahead of the jumper falls across the field. */
export function worldXOf(seat: SeatId, lead: number): number {
  return seat === 'p1' ? JUMPER_X + lead : FIELD_WIDTH - JUMPER_X - lead;
}

/** Where a lane-local height falls down the field. */
export function worldYOf(seat: SeatId, height: number): number {
  return seat === 'p1' ? FIELD_HEIGHT - height : height;
}

/* ------------------------------------------------------------------ *
 * The field
 * ------------------------------------------------------------------ */

/**
 * Draw the next hoop's gap centre.
 *
 * Held inside the band and inside one {@link CENTRE_STEP} of the last, so the run of
 * hoops reads as a path rather than as noise. Drawn once and pushed into both lanes.
 */
export function nextCentre(lastCentre: number, rng: Rng): number {
  const low = Math.max(CENTRE_MIN, lastCentre - CENTRE_STEP);
  const high = Math.min(CENTRE_MAX, lastCentre + CENTRE_STEP);
  return low + rng.float() * (high - low);
}

/** Put a hoop into the first free slot of a lane. Returns false when the pool is full. */
function release(lane: Lane, centre: number): boolean {
  for (const hoop of lane.hoops) {
    if (hoop.live) continue;
    hoop.live = true;
    hoop.lead = SPAWN_LEAD;
    hoop.centre = centre;
    hoop.resolved = false;
    return true;
  }
  return false;
}

/** Carry every live hoop `distance` closer, without flying the jumper. */
function driftHoops(lane: Lane, distance: number): void {
  for (const hoop of lane.hoops) {
    if (hoop.live) hoop.lead -= distance;
  }
}

/**
 * The nearest hoop still ahead of the jumper and still unresolved, or null.
 *
 * Returns a pool object rather than a copy, so calling it every step allocates nothing.
 */
export function nextHoop(lane: Readonly<Lane>): Hoop | null {
  let best: Hoop | null = null;
  for (const hoop of lane.hoops) {
    if (!hoop.live || hoop.resolved || hoop.lead < 0) continue;
    if (best === null || hoop.lead < best.lead) best = hoop;
  }
  return best;
}

/** True once every hoop the match will ever release has been resolved or passed. */
export function fieldSpent(match: Readonly<Match>): boolean {
  if (match.hoopsEntered < MAX_HOOPS) return false;
  for (const hoop of match.p1.hoops) {
    if (hoop.live && !hoop.resolved) return false;
  }
  for (const hoop of match.p2.hoops) {
    if (hoop.live && !hoop.resolved) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * The jumper
 * ------------------------------------------------------------------ */

/**
 * Apply one step of intent and gravity to a jumper.
 *
 * A flap only lands when the wing has recharged and the jumper is not stunned; both are
 * the same for a person and for a bot, which is what keeps rule 6 honest here. A glide
 * caps the fall rather than cancelling it, so holding the button still costs height.
 */
export function fly(lane: Lane, intent: Intent, fixedDeltaSeconds: number): void {
  if (lane.recharge > 0) lane.recharge -= fixedDeltaSeconds;
  if (lane.stun > 0) lane.stun -= fixedDeltaSeconds;

  // A press that cannot be spent yet is **held**, not dropped. See FLAP_RECHARGE.
  if (intent === 'flap') lane.buffered = true;
  const stunned = lane.stun > 0;
  if (lane.buffered && !stunned && lane.recharge <= 0) {
    lane.velocity = FLAP_SPEED;
    lane.recharge = FLAP_RECHARGE;
    lane.buffered = false;
  }

  lane.velocity -= GRAVITY * fixedDeltaSeconds;

  const floor = intent === 'glide' && !stunned ? -GLIDE_FALL : -MAX_FALL;
  if (lane.velocity < floor) lane.velocity = floor;

  lane.height += lane.velocity * fixedDeltaSeconds;

  // The floor and the ceiling stop the jumper dead rather than bouncing it. A bounce
  // would hand a player altitude they did not earn, and the ceiling is the divider the
  // two lanes share — a jumper springing off it would read as touching the opponent.
  //
  // Bounded by the jumper's *edge* rather than its centre, so it rests on the floor
  // instead of sinking half into it. That is a rendering complaint with a simulation
  // cause: a centre allowed to reach zero puts half the jumper off the device, and the
  // far seat's is the half that disappears.
  if (lane.height < JUMPER_RADIUS) {
    lane.height = JUMPER_RADIUS;
    lane.velocity = 0;
  } else if (lane.height > LANE_HEIGHT - JUMPER_RADIUS) {
    lane.height = LANE_HEIGHT - JUMPER_RADIUS;
    lane.velocity = 0;
  }
}

/**
 * How a hoop resolves against a jumper at `height`.
 *
 * Three outcomes, and the middle one is the interesting one. Through the gap is a basket.
 * Clear of the rim altogether — over the top of the upper post or under the bottom of the
 * lower one — is a plain miss that costs nothing but the hoop. Anything between the two is
 * a **rim strike**, which knocks the jumper down and stuns it.
 *
 * So going *round* a hoop is a legitimate choice with an honest price, and cutting it fine
 * is worse than not trying at all. That asymmetry is what stops the game being a pure
 * coin-flip for a weak player: a bad approach can be abandoned. **[ours]**
 *
 * A post that reaches the floor or the ceiling seals that side: `centre` is drawn from a
 * band that guarantees at least one side is open, never both.
 */
export function resolveHoop(height: number, centre: number, gap: number): LaneEvent {
  const half = gap / 2;
  const offset = height - centre;
  if (Math.abs(offset) <= half - JUMPER_RADIUS) return 'basket';
  if (offset > 0) {
    const postTop = centre + half + POST_LENGTH;
    return height - JUMPER_RADIUS >= postTop ? 'miss' : 'rim';
  }
  const postBottom = centre - half - POST_LENGTH;
  return height + JUMPER_RADIUS <= postBottom ? 'miss' : 'rim';
}

/**
 * Advance one lane by one step and report what happened to it.
 *
 * The hoop is resolved at the **moment** it passes the jumper rather than at the end of
 * the step it passes in. At the top fall speed a jumper covers 12 units in a step against
 * a clean window that narrows to 35, so sampling on the step boundary would decide a third
 * of the close ones by where the frame happened to land. The crossing fraction is exact
 * arithmetic on the fixed delta, so it stays identical on every device.
 *
 * At most one hoop can resolve in a step: they are 440 units apart and the field scrolls
 * under five units a step.
 */
export function stepLane(lane: Lane, intent: Intent, fixedDeltaSeconds: number): LaneEvent {
  const before = lane.height;
  fly(lane, intent, fixedDeltaSeconds);

  const scroll = HOOP_SPEED * fixedDeltaSeconds;
  const gap = gapOf(lane);
  let event: LaneEvent = 'none';

  for (const hoop of lane.hoops) {
    if (!hoop.live) continue;
    const wasAhead = hoop.lead > 0;
    hoop.lead -= scroll;

    if (wasAhead && hoop.lead <= 0 && !hoop.resolved) {
      hoop.resolved = true;
      // Where the jumper was at the instant the hoop's plane went by.
      const fraction = scroll > 0 ? (hoop.lead + scroll) / scroll : 1;
      const at = before + (lane.height - before) * fraction;
      event = resolveHoop(at, hoop.centre, gap);
      if (event === 'basket') {
        lane.baskets += 1;
        lane.streak += 1;
        if (lane.streak > lane.bestStreak) lane.bestStreak = lane.streak;
      } else {
        lane.streak = 0;
        if (event === 'rim') {
          lane.rims += 1;
          lane.velocity = -RIM_KNOCK;
          lane.stun = STUN_SECONDS;
        } else lane.misses += 1;
      }
    }

    if (hoop.lead < DESPAWN_LEAD) hoop.live = false;
  }

  return event;
}

/* ------------------------------------------------------------------ *
 * The match
 * ------------------------------------------------------------------ */

export interface StepResult {
  readonly p1: LaneEvent;
  readonly p2: LaneEvent;
  /** True on the step a new hoop entered both lanes. */
  readonly released: boolean;
}

/** Rewritten in place every step; a caller keeping it must copy the fields out. */
const result: { p1: LaneEvent; p2: LaneEvent; released: boolean } = {
  p1: 'none',
  p2: 'none',
  released: false,
};

/**
 * Call the match on what has been scored.
 *
 * Baskets first; level on baskets, the cleaner run wins — fewer rims struck. Only a pair
 * level on both draws. The tie-break exists because the two lanes are fed the identical
 * hoops at the identical moment, so two evenly matched players reach ten on the same hoop
 * far more often than they would in a game where they took turns. Both extra keys were
 * added because the drawn share was measured and was not acceptable: two `hard` bots drew
 * **25%** of their matches on baskets and rims alone, and **11%** once the longest run was
 * added behind them. Both also say something true — two players on ten baskets are not
 * equal if one of them bounced off five rims getting there, and two who bounced off the
 * same number are not equal if one put nine baskets together in a row. **[ours]**
 */
export function decide(match: Match): void {
  if (match.phase === 'over') return;
  match.phase = 'over';
  if (match.p1.baskets !== match.p2.baskets) {
    match.winner = match.p1.baskets > match.p2.baskets ? 'p1' : 'p2';
    return;
  }
  if (match.p1.rims !== match.p2.rims) {
    match.winner = match.p1.rims < match.p2.rims ? 'p1' : 'p2';
    return;
  }
  if (match.p1.bestStreak !== match.p2.bestStreak) {
    match.winner = match.p1.bestStreak > match.p2.bestStreak ? 'p1' : 'p2';
    return;
  }
  match.winner = 'draw';
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

/**
 * One fixed step of the whole match.
 *
 * The field is advanced first so a hoop released this step enters both lanes before
 * either is stepped, and the two lanes are then stepped with their own player's intent.
 * Neither lane can read or touch the other, which is the property the whole design rests
 * on: there is no order-of-play advantage to be had because there is no shared object.
 */
export function step(
  match: Match,
  p1Intent: Intent,
  p2Intent: Intent,
  fixedDeltaSeconds: number,
  rng: Rng,
): StepResult {
  result.p1 = 'none';
  result.p2 = 'none';
  result.released = false;
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;

  // Hoops travel during the opening hover too, so the first one is readable before
  // gravity arrives rather than arriving with it.
  if (match.hoopsEntered < MAX_HOOPS) {
    match.sinceSpawn += HOOP_SPEED * fixedDeltaSeconds;
    if (match.sinceSpawn >= HOOP_SPACING) {
      match.sinceSpawn -= HOOP_SPACING;
      const centre = nextCentre(match.lastCentre, rng);
      match.lastCentre = centre;
      // One draw, both lanes. This single line is what makes the two seats structurally
      // equal, and it is why the rng is consumed by the *field* and never by a lane.
      release(match.p1, centre);
      release(match.p2, centre);
      match.hoopsEntered += 1;
      result.released = true;
    }
  }

  if (match.phase === 'ready') {
    match.readyDelay -= fixedDeltaSeconds;
    // The hoops still move during the hover, so the first one is read before gravity
    // arrives rather than arriving with it.
    const drift = HOOP_SPEED * fixedDeltaSeconds;
    driftHoops(match.p1, drift);
    driftHoops(match.p2, drift);
    if (match.readyDelay <= 0) match.phase = 'flying';
    return result;
  }

  result.p1 = stepLane(match.p1, p1Intent, fixedDeltaSeconds);
  result.p2 = stepLane(match.p2, p2Intent, fixedDeltaSeconds);

  if (match.p1.baskets >= TARGET_BASKETS || match.p2.baskets >= TARGET_BASKETS) {
    decide(match);
  } else if (fieldSpent(match) || match.elapsed >= ROUND_SECONDS) {
    decide(match);
  }

  return result;
}

/* ------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between decisions. It flies on what it last looked at until this expires,
   * exactly as a person who glanced away would — and because a beat is a decision, it is
   * also a ceiling on how often the bot can beat a wing.
   */
  readonly reaction: number;
  /** How far off the middle of the gap it aims, in logical units. */
  readonly error: number;
  /**
   * How often it loses the hoop altogether, **in blunders a second**.
   *
   * A rate rather than a chance-per-look, which is how it started and was quietly wrong:
   * the bot looks once per {@link BotProfile.reaction}, so a fixed per-look chance means
   * the sharp tier blunders four times as often as the slow one for the same number. Two
   * of the three knobs were then pulling in opposite directions and the middle tier came
   * out strongest. Multiplying by the reaction here makes the number mean what it says.
   */
  readonly blunder: number;
}

/**
 * How long a blunder lasts.
 *
 * It has to be a duration rather than a coin flip resolved every step. A bot that
 * re-decides fourteen times a second and freezes for one of those has not blundered, it
 * has jittered, and the next decision undoes it before it has cost anything. Held for
 * this long it drops the jumper 141 units out of a glide — more than the widest clean
 * window the game ever offers, so a blunder is reliably a hoop.
 */
export const BLUNDER_SECONDS = 0.36;

/**
 * How far ahead the bot plans when no hoop is in view yet, in seconds.
 *
 * Not a difficulty knob — every tier uses it. It is roughly the gap between two hoops, so
 * a bot with nothing to aim at holds the altitude it would want if one were coming.
 */
export const BOT_HORIZON = 1.2;

/** What one wing-beat is worth in altitude, which is the coarsest move the bot has. */
export const BOT_BEAT = (FLAP_SPEED * FLAP_SPEED) / (2 * GRAVITY);

/**
 * How far either side of its aim the bot lets its glide slope sit before correcting.
 *
 * It has to be **symmetric about the aim**, and getting that wrong is the second thing
 * that inverted the tiers. The first version beat a wing whenever the slope fell below the
 * aim and trimmed only when it rose twelve units above it — so every correction was
 * upward, every beat overshot by most of a {@link BOT_BEAT}, and the band the bot actually
 * flew sat entirely above its target. Measured, `hard` arrived a mean **62 units high**
 * with a spread of 43, so it was the most *consistent* tier and the least accurate one.
 * Centring the band on the aim leaves the spread — which is what reaction delay governs —
 * as the only thing separating the tiers, which is what the tiers are supposed to be.
 */
export const BOT_BAND = BOT_BEAT * 0.5;

/**
 * The three tiers, expressed only as reaction, aim error and blunder rate.
 *
 * None of them gets a stronger wing, a faster recharge, a wider gap, a shorter stun, or a
 * look at anything a player cannot see — rule 6. Every tier flies through {@link fly} with
 * the same constants and all three run the same policy: climb until a glide would land you
 * on the hoop, then glide. `hard` is better because it looks fourteen times a second and
 * aims true; `easy` is worse because it looks three times a second — which is also all the
 * faster it can beat a wing, and that is exactly how a beginner plays a tapping game.
 *
 * See {@link glideLanding} for why reaction delay converts into landing error at a fixed
 * 150 units a second, which is what makes these three numbers order the tiers at all.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.3, error: 66, blunder: 0.6 },
  normal: { reaction: 0.15, error: 30, blunder: 0.32 },
  hard: { reaction: 0.07, error: 9, blunder: 0.2 },
});

export interface BotState {
  /** Seconds until the next look. */
  look: number;
  /** The height it is currently flying toward. */
  aim: number;
  /**
   * The posture it settled on at that look and flies on until the next one.
   *
   * Only ever `idle` or `glide`. A beat is a one-shot decision and is *not* held: holding
   * it would let the slowest tier beat its wing at the recharge rate rather than at its
   * own reaction rate, and the reaction delay would stop being a handicap at all.
   */
  hold: Intent;
  /** Seconds of blunder left, during which it does nothing at all. */
  frozen: number;
}

export function createBotState(): BotState {
  return { look: 0, aim: LANE_HEIGHT / 2, hold: 'idle', frozen: 0 };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.aim = LANE_HEIGHT / 2;
  state.hold = 'idle';
  state.frozen = 0;
}

/**
 * Where a glide from here would put the jumper `seconds` from now.
 *
 * **The whole bot is this one line, and it took three tries to find it.** The first
 * controller hovered: beat a wing whenever the projected height fell below the middle of
 * the gap. Measured, that inverted the tiers outright — `hard` finished 40 hoops with 0.1
 * baskets and 38 rim strikes while `easy` finished with 9.8. The reason is that a beat
 * *sets* the climb rate, so every beat is worth 82 units of altitude whoever makes it, and
 * a hover is therefore a sawtooth 82 units deep sitting entirely above its own target.
 * Looking more often does not shrink the sawtooth, so `hard` was not more accurate than
 * `easy`, only more consistently 40 units too high.
 *
 * A glide slope has no sawtooth. `height - GLIDE_FALL * seconds` is **invariant while
 * gliding** — the jumper loses exactly the height the shrinking clock gives back — so a
 * jumper that climbs until this quantity reaches the gap centre and then glides arrives on
 * the gap centre, and the only error left is how long it waited before looking. That turns
 * reaction delay into landing error at 150 units a second, so the arrival error goes from
 * a standard deviation of 29 units for `hard` through 61 for `normal` to 105 for `easy`,
 * against a clean window that narrows from 57 to 30. The tiers order themselves.
 *
 * It is also, as it happens, how a person plays this: get up early, then feather down onto
 * the hoop. Nothing here reads a value a player cannot see. **[ours]**
 */
export function glideLanding(lane: Readonly<Lane>, seconds: number): number {
  return lane.height - GLIDE_FALL * seconds;
}

/** Seconds until the next hoop reaches the jumper, or the planning horizon when none is. */
export function secondsToHoop(lane: Readonly<Lane>): number {
  const hoop = nextHoop(lane);
  return hoop === null ? BOT_HORIZON : hoop.lead / HOOP_SPEED;
}

/**
 * What a bot wants to do this step.
 *
 * Returns an {@link Intent}, so a bot's decision goes through exactly the same
 * {@link fly} a player's does — including the recharge, which is why the hardest tier
 * cannot out-flap a human however short its reaction gets, and the stun, which is why a
 * rim strike costs a bot exactly what it costs a person.
 */
export function botIntent(
  lane: Readonly<Lane>,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): Intent {
  const profile = BOT_PROFILES[difficulty];
  if (state.frozen > 0) state.frozen -= fixedDeltaSeconds;
  state.look -= fixedDeltaSeconds;
  // Between looks it flies on the posture it last settled on. A decision it cannot revise
  // is what a reaction delay *is*.
  if (state.look > 0) return state.hold;
  state.look = profile.reaction;
  if (state.frozen > 0) {
    state.hold = 'idle';
    return 'idle';
  }

  if (profile.blunder > 0 && rng.bool(profile.blunder * profile.reaction)) {
    state.frozen = BLUNDER_SECONDS;
    state.hold = 'idle';
    return 'idle';
  }

  const hoop = nextHoop(lane);
  // Nothing to answer: hold the middle of the lane, which is where a player waits.
  state.aim = hoop === null ? LANE_HEIGHT / 2 : hoop.centre + (rng.float() * 2 - 1) * profile.error;
  const seconds = hoop === null ? BOT_HORIZON : hoop.lead / HOOP_SPEED;
  const landing = glideLanding(lane, seconds);

  if (landing < state.aim - BOT_BAND) {
    if (lane.recharge > 0) {
      // It wants to climb and the wing is not back yet. Gliding holds the height it has
      // instead of throwing more away, and the press is *not* queued — a bot that mashed
      // through the recharge would spend the buffer on beats it never chose, which is
      // exactly what happened when the buffer was added and it cost `hard` thirteen points
      // of accuracy. Whether your own wing is ready is something a player can see.
      state.hold = 'glide';
      return 'glide';
    }
    // The posture afterwards is a free fall, so the next look decides again rather than
    // the beat becoming a hover.
    state.hold = 'idle';
    return 'flap';
  }
  if (landing > state.aim + BOT_BAND) {
    // Too high: stop gliding and let gravity take the surplus off.
    state.hold = 'idle';
    return 'idle';
  }
  state.hold = 'glide';
  return 'glide';
}
