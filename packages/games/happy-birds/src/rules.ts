import type { Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Happy Birds, as pure rules.
 *
 * A strip of sky each, a bird apiece, and one button. Tap and the bird beats its wings;
 * let go and it falls; hold the button down and it tucks its wings and *dives*. Walls of
 * spikes come across the sky with one gap in them, and the gap is the only way through —
 * touch a tooth anywhere and you are down. The seat still flying when the other one goes
 * down takes the **flight**, and three flights take the match.
 *
 * Four decisions shape everything below, and each is argued where it lives:
 *
 *  - **A touch is fatal, not expensive** ({@link safeAt}). That single choice is what
 *    separates this from every "thread the gap and score" game: nothing accumulates, so a
 *    flight is not a total but a *duration*, and the loser of a flight is simply whoever
 *    ran out of sky first. It is also what makes "survive three times" the whole rule.
 *  - **There is one run of walls, not two** ({@link releaseWall}). Both seats read the
 *    same array of walls at the same instant, and the gap depends only on how many walls
 *    the *flight* has cleared, so the two skies are not similar on average — they are the
 *    same object. Seat fairness is then not a property to be tested for, it is a property
 *    there is no room for a bug in.
 *  - **The wall closes as the flight goes on** ({@link gapFor}, {@link wallSpeedFor}).
 *    Gap and pace are functions of walls cleared, so a flight gets harder whoever is
 *    flying it and no pair of players can hold one open indefinitely. This is the
 *    termination guarantee; {@link FLIGHT_LIMIT} is a backstop under it, not the mechanism.
 *  - **The tuck is the second control on one button** ({@link fly}). A tap is an edge and
 *    a hold is a level, which is the one pair of gestures a thumb and a key express
 *    identically — so a dive costs nothing in cross-family fairness while giving the
 *    player a way *down* that gravity alone is too slow for.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit measured in
 * **sky-local** coordinates — `height` up from your own ground, `lead` how far a wall
 * still has to come — so both seats hold literally the same numbers and the half turn
 * that separates them lives only in {@link worldXOf} and {@link worldYOf}, which nothing
 * but the renderer calls.
 */

export const FIELD_WIDTH = 600;
export const FIELD_HEIGHT = 1000;

/**
 * How deep one seat's strip of sky is.
 *
 * Two of these plus the horizon band make the field, so the layout is symmetric under a
 * half turn: each player's ground is the edge of the device nearest them.
 */
export const SKY_HEIGHT = 470;
/** The band between the two skies. It belongs to neither, and carries the flight budget. */
export const HORIZON = FIELD_HEIGHT - SKY_HEIGHT * 2;

/** Where along its sky a bird sits. The world comes to it; it never moves sideways. */
export const BIRD_X = 140;
export const BIRD_RADIUS = 14;

/* ------------------------------------------------------------------ *
 * Flight
 * ------------------------------------------------------------------ */

/**
 * Units a second squared, pulling toward your own ground.
 *
 * With {@link FLAP_SPEED} one wing-beat is worth {@link FLAP_RISE} — 74 units, a sixth of
 * the sky — and takes 0.34 s to reach the top of its arc. That ratio is what makes a gap
 * something you steer onto over about a second rather than something you snap to.
 */
export const GRAVITY = 1250;

/** A beat *sets* the climb rate rather than adding to it, so beats never stack. */
export const FLAP_SPEED = 430;

/**
 * Seconds a wing needs before it can beat again. 5.3 beats a second, for everybody.
 *
 * **This is what makes a keyboard and a thumb worth the same here**, and it is the only
 * reason this game does not have to declare `sameInputClassOnly`. A one-button game with
 * no cadence limit is decided by how fast you can press, and a key repeats faster than a
 * screen can be tapped: with the beat set by the press alone a masher pressing on every
 * step holds {@link FLAP_SPEED} outright at 430 u/s while a six-a-second tapper averages
 * 326, a quarter more climb for nothing but the peripheral in the player's hand.
 * Recharging the wing caps everyone at the same 5.3 beats a second and 311 u/s, a rate a
 * thumb reaches comfortably, so the ceiling belongs to the bird rather than to the hand.
 *
 * The press is **buffered rather than dropped** for the reason Flappy Jump documents at
 * its own recharge: ignoring a press that lands mid-recharge puts an aliasing beat between
 * the player's rhythm and the wing's, and a tapper whose rhythm happens to fall badly then
 * climbs *slower* than one with no cap at all. Holding the press until the wing is ready
 * makes the cap mean what it says. `game.test.ts` drives a masher and a tapper through the
 * real input stack and demands they climb the identical distance. **[ours]**
 */
export const FLAP_RECHARGE = 0.19;

/** Terminal velocity in an ordinary fall, so a drop from the top is quick but readable. */
export const MAX_FALL = 560;

/**
 * Pull and terminal speed while the button is *held* — the tuck.
 *
 * One button, two things it can say: a tap beats a wing, a hold folds the wings and turns
 * a fall into a dive. It exists because the walls close from *both* surfaces, so a bird
 * that is too high has as much of a problem as one that is too low, and ordinary gravity
 * is too slow to fix it inside the second a wall gives you. Holding while climbing kills
 * the climb, which is what makes a tuck a commitment rather than a free extra. **[ours]**
 */
export const TUCK_PULL = 2600;
export const TUCK_FALL = 900;

/** What one wing-beat is worth in altitude. Quoted by the bot and by the tests. */
export const FLAP_RISE = (FLAP_SPEED * FLAP_SPEED) / (2 * GRAVITY);

/* ------------------------------------------------------------------ *
 * The walls
 * ------------------------------------------------------------------ */

/** How fast the first wall of a flight travels. */
export const WALL_SPEED = 250;
/** Units a second added to the pace for every wall the flight has already cleared. */
export const WALL_SPEED_STEP = 7;
/** The fastest the walls ever come, reached after 25 of them. */
export const WALL_SPEED_MAX = 420;

/** Distance between one wall and the next, so the one after is always in sight. */
export const WALL_SPACING = 330;
/** Where a wall enters, beyond the far edge of the sky. */
export const SPAWN_LEAD = 520;
/** Where a wall is retired, well behind the bird and off the near edge. */
export const DESPAWN_LEAD = -200;
/** Slots. The travel span over the spacing is under three, so four is never short. */
export const WALL_POOL = 4;
/** How thick a wall is across the sky, teeth included. */
export const WALL_THICKNESS = 26;

/**
 * How near a wall has to be before it can touch the bird.
 *
 * Half the wall plus the bird, so the danger lasts the whole passage rather than being a
 * plane the bird is tested against once. At the fastest pace a wall moves seven units in a
 * step against a 54-unit overlap, so the passage is sampled at least seven times and there
 * is nothing to tunnel through.
 */
export const TOOTH_REACH = WALL_THICKNESS / 2 + BIRD_RADIUS;

/** How far the teeth stand off the body of a bank. Drawn, and quoted by the renderer. */
export const TOOTH_LENGTH = 16;

/** The gap the first wall of a flight offers. */
export const GAP_START = 190;
/** Units of gap lost for every wall the flight has cleared. */
export const GAP_SHRINK = 7;
/** The tightest a wall ever gets, however long the flight has run. */
export const GAP_MIN = 108;

/**
 * The band a gap centre is drawn from.
 *
 * Held far enough from both surfaces that a gap at its widest still sits wholly inside the
 * sky, so no wall is ever secretly sealed on one side.
 */
export const CENTRE_MIN = 115;
export const CENTRE_MAX = SKY_HEIGHT - CENTRE_MIN;
/**
 * The most one wall's centre may differ from the last.
 *
 * A free draw over the band reads as noise; a limited step reads as a *path*, which is a
 * thing a player can plan against. The tightest pace still leaves 0.79 s between walls and
 * a climbing bird covers 245 units in that, so this is never a demand the bird cannot
 * meet — the limit is there for legibility, not for reachability.
 */
export const CENTRE_STEP = 130;

/* ------------------------------------------------------------------ *
 * The match
 * ------------------------------------------------------------------ */

/** Flights to take the match. The observed rule: survive three times to win. */
export const FLIGHTS_TO_WIN = 3;

/**
 * How many flights the whole match is worth.
 *
 * The budget is what guarantees a decision. Flights can be drawn — both birds can go down
 * inside the same step, and a flight that somehow outlasts {@link FLIGHT_LIMIT} is called
 * level — so "first to three" on its own is not a promise that anybody ever reaches three.
 * Nine bounds the match at nine flights whatever happens in them, and the tie-break below
 * settles what the flights could not.
 */
export const MAX_FLIGHTS = 9;

/** Seconds the birds hover before gravity is switched on, so both players can look up. */
export const READY_SECONDS = 1.2;
/** Seconds a downed bird stays on screen before the next flight is dealt. */
export const SETTLE_SECONDS = 0.9;

/**
 * The longest a single flight may run.
 *
 * Nothing reaches it: the gap is at its minimum after twelve walls and the pace at its
 * maximum after twenty-five, so a flight is a race between two players and an arithmetic
 * progression that always wins. It is here because a pacing constant is one edit away from
 * not winning, and a game whose only guarantee lives in its tuning has no guarantee.
 */
export const FLIGHT_LIMIT = 25;

/**
 * The match is called after this long whatever else has happened.
 *
 * The flight budget already bounds a match at nine flights of at most 27 s each. This is
 * the outermost backstop, because `roundSeconds` in the manifest ends nothing — the
 * catalogue card is its only reader. See the note at the top of `termination.test.ts`.
 */
export const MATCH_SECONDS = 300;

/**
 * How much of the first wall's approach has already happened when a flight begins.
 *
 * Tuned rather than chosen. At zero the first wall is released on the opening step and
 * arrives 0.88 s after gravity does, which is not enough to climb to it from the middle of
 * the sky — the first gap would be decided by where its centre happened to fall. Holding
 * the first release back until the hover is nearly over gives every flight the same clear
 * second to read the opening wall in.
 */
export const OPENING_SLACK = 150;

/** First to {@link FLIGHTS_TO_WIN} flights. Never a comparison written out by hand. */
export const FLIGHT_CONDITION: WinCondition = { kind: 'first-to', target: FLIGHTS_TO_WIN };

/**
 * The tie-break, resolved by the same helper on a different tally.
 *
 * Flights alone can end level — every flight of a match can be drawn — and "level on
 * flights" has to mean something. It cannot mean "who survived longer", because a flight
 * ends the instant either bird goes down and both have therefore flown exactly as long. So
 * what is banked instead is **clearance**: every wall a bird threads adds however much room
 * it had to spare, so the seat that flew nearer the middle of the gaps has more of it. It
 * says something true — two players level on flights are not equal if one of them was
 * scraping every tooth — and being continuous it almost never ties again. **[ours]**
 */
export const CLEARANCE_CONDITION: WinCondition = { kind: 'highest-when-time-expires' };

export type Phase = 'ready' | 'flying' | 'settle' | 'over';

/** What a player asked for this step. `tuck` is a held button, `flap` a fresh press. */
export type Intent = 'idle' | 'flap' | 'tuck';

/** Who went down to end a flight, or null while one is still being flown. */
export type Downed = SeatId | 'both' | null;

export interface Wall {
  /** False when this pool slot is unused. */
  live: boolean;
  /** Distance still to travel before it reaches the birds. Negative once past. */
  lead: number;
  /** Height of the middle of the gap, above the ground. */
  centre: number;
  /** Set on the step this wall's middle went by, so it can only be banked once. */
  passed: boolean;
}

export interface Bird {
  /** Height above this seat's own ground. */
  height: number;
  /** Units a second, positive away from the ground. */
  velocity: number;
  /** Seconds until the wing can beat again. */
  recharge: number;
  /**
   * A press that arrived while the wing was still recharging, waiting to be spent.
   *
   * See {@link FLAP_RECHARGE}: dropping such a press is what a first pass does, and it
   * puts an aliasing beat between the player's rhythm and the wing's.
   */
  buffered: boolean;
  /** True once this bird has touched a tooth, for the rest of the flight. */
  down: boolean;
  /** Walls threaded in the flight being flown now. */
  threaded: number;
  /** The best that has ever been, across the match. The HUD's one bragging right. */
  bestThreaded: number;
  /** Flights won. This is the score. */
  flights: number;
  /** Room to spare, banked wall by wall across the whole match. The tie-break. */
  clearance: number;
}

export interface Match {
  readonly p1: Bird;
  readonly p2: Bird;
  /**
   * The walls, once. Both seats fly through this same array at the same instant, which is
   * what makes the two skies identical by construction rather than by tuning.
   */
  readonly walls: Wall[];
  /** Distance the sky has scrolled since the last wall entered. */
  sinceSpawn: number;
  /** Walls this flight has cleared. Sets the pace and the gap for both seats alike. */
  cleared: number;
  /** The last centre drawn, so the next one is a readable step from it. */
  lastCentre: number;
  phase: Phase;
  /** Counts down the opening hover. */
  readyDelay: number;
  /** Counts down the pause after a bird goes down. */
  settleDelay: number;
  /** Who went down to end the flight just shown, for the renderer. */
  downed: Downed;
  /** Flights begun and finished, out of {@link MAX_FLIGHTS}. */
  flightsPlayed: number;
  /** Seconds the current flight has been flying, for {@link FLIGHT_LIMIT}. */
  flightSeconds: number;
  /** Seconds the match has run, for {@link MATCH_SECONDS}. */
  elapsed: number;
  winner: SeatId | 'draw' | null;
}

function createWall(): Wall {
  return { live: false, lead: 0, centre: 0, passed: false };
}

function createBird(): Bird {
  return {
    height: SKY_HEIGHT / 2,
    velocity: 0,
    recharge: 0,
    buffered: false,
    down: false,
    threaded: 0,
    bestThreaded: 0,
    flights: 0,
    clearance: 0,
  };
}

export function createMatch(): Match {
  const walls: Wall[] = [];
  for (let i = 0; i < WALL_POOL; i += 1) walls.push(createWall());
  return {
    p1: createBird(),
    p2: createBird(),
    walls,
    sinceSpawn: WALL_SPACING - OPENING_SLACK,
    cleared: 0,
    lastCentre: SKY_HEIGHT / 2,
    phase: 'ready',
    readyDelay: READY_SECONDS,
    settleDelay: 0,
    downed: null,
    flightsPlayed: 0,
    flightSeconds: 0,
    elapsed: 0,
    winner: null,
  };
}

/** Put one bird back in the middle of its sky. Score and clearance survive a flight. */
function resetBird(bird: Bird): void {
  bird.height = SKY_HEIGHT / 2;
  bird.velocity = 0;
  bird.recharge = 0;
  bird.buffered = false;
  bird.down = false;
  bird.threaded = 0;
}

/** Deal a fresh flight: new sky, same match. */
export function startFlight(match: Match): void {
  resetBird(match.p1);
  resetBird(match.p2);
  for (let i = 0; i < match.walls.length; i += 1) {
    const wall = match.walls[i]!;
    wall.live = false;
    wall.lead = 0;
    wall.centre = 0;
    wall.passed = false;
  }
  match.sinceSpawn = WALL_SPACING - OPENING_SLACK;
  match.cleared = 0;
  match.lastCentre = SKY_HEIGHT / 2;
  match.phase = 'ready';
  match.readyDelay = READY_SECONDS;
  match.settleDelay = 0;
  match.downed = null;
  match.flightSeconds = 0;
}

export function resetMatch(match: Match): void {
  startFlight(match);
  match.p1.bestThreaded = 0;
  match.p2.bestThreaded = 0;
  match.p1.flights = 0;
  match.p2.flights = 0;
  match.p1.clearance = 0;
  match.p2.clearance = 0;
  match.flightsPlayed = 0;
  match.elapsed = 0;
  match.winner = null;
}

export function birdOf(match: Match, seat: SeatId): Bird {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function flightsOf(match: Readonly<Match>, seat: SeatId): number {
  return seat === 'p1' ? match.p1.flights : match.p2.flights;
}

/* ------------------------------------------------------------------ *
 * Sky-local space to world space.
 *
 * The only place the two skies stop being the same thing. p1 owns the bottom of the field
 * with its ground along the bottom edge; p2 owns the top with its ground along the top,
 * which is a half turn of p1's sky about the centre of the field — exactly the transform
 * the shell already applies to the far seat's view. Both readings of the device are
 * therefore upright, and `rules.test.ts` asserts the point symmetry rather than trusting
 * the arithmetic here.
 * ------------------------------------------------------------------ */

/** Where a point `lead` ahead of the bird falls across the field. */
export function worldXOf(seat: SeatId, lead: number): number {
  return seat === 'p1' ? BIRD_X + lead : FIELD_WIDTH - BIRD_X - lead;
}

/** Where a sky-local height falls down the field. */
export function worldYOf(seat: SeatId, height: number): number {
  return seat === 'p1' ? FIELD_HEIGHT - height : height;
}

/* ------------------------------------------------------------------ *
 * The sky
 * ------------------------------------------------------------------ */

/** How wide the gap is once `cleared` walls have gone by. Shared by both seats. */
export function gapFor(cleared: number): number {
  const gap = GAP_START - cleared * GAP_SHRINK;
  return gap < GAP_MIN ? GAP_MIN : gap;
}

/** How fast the walls come once `cleared` of them have gone by. Shared by both seats. */
export function wallSpeedFor(cleared: number): number {
  const speed = WALL_SPEED + cleared * WALL_SPEED_STEP;
  return speed > WALL_SPEED_MAX ? WALL_SPEED_MAX : speed;
}

/**
 * Draw the next wall's gap centre.
 *
 * Held inside the band and within one {@link CENTRE_STEP} of the last, so a flight reads
 * as a path through the sky rather than as a run of unrelated holes.
 */
export function nextCentre(lastCentre: number, rng: Rng): number {
  const low = Math.max(CENTRE_MIN, lastCentre - CENTRE_STEP);
  const high = Math.min(CENTRE_MAX, lastCentre + CENTRE_STEP);
  return low + rng.float() * (high - low);
}

/** Put a wall into the first free slot. Returns false when the pool is full. */
function releaseWall(match: Match, centre: number): boolean {
  for (let i = 0; i < match.walls.length; i += 1) {
    const wall = match.walls[i]!;
    if (wall.live) continue;
    wall.live = true;
    wall.lead = SPAWN_LEAD;
    wall.centre = centre;
    wall.passed = false;
    return true;
  }
  return false;
}

/** Carry every live wall `distance` closer. */
function driftWalls(match: Match, distance: number): void {
  for (let i = 0; i < match.walls.length; i += 1) {
    const wall = match.walls[i]!;
    if (wall.live) wall.lead -= distance;
  }
}

/**
 * The nearest wall the birds still have to answer, or null when the sky is clear.
 *
 * Returns the pooled object rather than a copy, so calling it every step for the renderer
 * and for both bots allocates nothing.
 */
export function nextWall(match: Readonly<Match>): Wall | null {
  let best: Wall | null = null;
  for (let i = 0; i < match.walls.length; i += 1) {
    const wall = match.walls[i]!;
    if (!wall.live || wall.lead < -TOOTH_REACH) continue;
    if (best === null || wall.lead < best.lead) best = wall;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * The bird
 * ------------------------------------------------------------------ */

/**
 * Apply one step of intent and gravity to a bird.
 *
 * A beat only lands when the wing has recharged, which is the same for a person and for a
 * bot — that is what keeps rule 6 honest here. A tuck is a stronger pull *and* a higher
 * terminal speed, so it bites at once rather than only after a second of falling, and it
 * applies while climbing too: folding your wings at the top of a beat throws the beat away.
 */
export function fly(bird: Bird, intent: Intent, fixedDeltaSeconds: number): void {
  if (bird.recharge > 0) bird.recharge -= fixedDeltaSeconds;

  // A press that cannot be spent yet is **held**, not dropped. See FLAP_RECHARGE.
  if (intent === 'flap') bird.buffered = true;
  if (bird.buffered && bird.recharge <= 0) {
    bird.velocity = FLAP_SPEED;
    bird.recharge = FLAP_RECHARGE;
    bird.buffered = false;
  }

  const tucked = intent === 'tuck';
  const pull = tucked ? TUCK_PULL : GRAVITY;
  const cap = tucked ? TUCK_FALL : MAX_FALL;
  bird.velocity -= pull * fixedDeltaSeconds;
  if (bird.velocity < -cap) bird.velocity = -cap;

  bird.height += bird.velocity * fixedDeltaSeconds;

  // The ground and the ceiling stop the bird dead rather than bouncing it. Neither is
  // lethal — the teeth are the only thing that is — but neither gives anything back
  // either, so being pinned against one is a position to get out of.
  //
  // Bounded by the bird's *edge* rather than its centre, so it sits on the ground instead
  // of sinking half into it. That is a rendering complaint with a simulation cause: a
  // centre allowed to reach zero puts half the bird off the device, and the far seat's is
  // the half that disappears.
  if (bird.height < BIRD_RADIUS) {
    bird.height = BIRD_RADIUS;
    bird.velocity = 0;
  } else if (bird.height > SKY_HEIGHT - BIRD_RADIUS) {
    bird.height = SKY_HEIGHT - BIRD_RADIUS;
    bird.velocity = 0;
  }
}

/**
 * Whether a bird at `height` is clear of a wall whose gap is `gap` wide about `centre`.
 *
 * Both banks run all the way to their own surface, so the gap is the only way past and
 * there is no going round. The teeth are drawn tip to tip across the bank, and the tip
 * line is the boundary — a bird is never allowed to slip *between* two teeth, which would
 * be a hole the player can see and the rules cannot.
 */
export function safeAt(height: number, centre: number, gap: number): boolean {
  return Math.abs(height - centre) <= gap / 2 - BIRD_RADIUS;
}

/**
 * How much room a bird at `height` had to spare going through. Zero if it had none.
 *
 * This is what {@link CLEARANCE_CONDITION} banks, and it is deliberately the *clean*
 * window — gap, less the bird — so a value of zero means "touched a tooth" rather than
 * "was exactly on the tip".
 */
export function clearanceAt(height: number, centre: number, gap: number): number {
  const room = gap / 2 - BIRD_RADIUS - Math.abs(height - centre);
  return room > 0 ? room : 0;
}

/* ------------------------------------------------------------------ *
 * The match
 * ------------------------------------------------------------------ */

/** Scratch tallies, so calling {@link decide} every step allocates nothing. */
const flightTally = { p1: 0, p2: 0 };
const clearanceTally = { p1: 0, p2: 0 };

/**
 * Call the match, or return null while it is still being played.
 *
 * Flights first, through the shared `first-to` helper so "first to three" means here what
 * it means everywhere else. Only when the budget is spent *and* the flights are level does
 * the clearance tally get a say, and only then can it be a draw.
 */
export function decide(match: Readonly<Match>): Outcome {
  const spent = match.flightsPlayed >= MAX_FLIGHTS || match.elapsed >= MATCH_SECONDS;
  flightTally.p1 = match.p1.flights;
  flightTally.p2 = match.p2.flights;
  const outcome = resolve(FLIGHT_CONDITION, flightTally, { timeExpired: spent });
  // null (still running) and a decided seat both pass straight through; only a level
  // finish reaches the tie-break.
  if (outcome !== 'draw') return outcome;
  clearanceTally.p1 = match.p1.clearance;
  clearanceTally.p2 = match.p2.clearance;
  return resolve(CLEARANCE_CONDITION, clearanceTally, { timeExpired: true });
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

/**
 * Close the flight being flown and hand it to whoever is still up.
 *
 * Both birds can go down inside one step — they fly the same walls, so it is not even
 * unlikely — and that flight belongs to nobody. It still costs a flight from the budget,
 * because a flight nobody wins is exactly the case the budget exists to bound.
 */
function endFlight(match: Match, p1Hit: boolean, p2Hit: boolean): void {
  match.p1.down = p1Hit;
  match.p2.down = p2Hit;
  if (p1Hit && !p2Hit) match.p2.flights += 1;
  else if (p2Hit && !p1Hit) match.p1.flights += 1;
  match.downed = p1Hit && p2Hit ? 'both' : p1Hit ? 'p1' : 'p2';
  if (match.p1.threaded > match.p1.bestThreaded) match.p1.bestThreaded = match.p1.threaded;
  if (match.p2.threaded > match.p2.bestThreaded) match.p2.bestThreaded = match.p2.threaded;
  match.flightsPlayed += 1;

  const outcome = decide(match);
  if (outcome !== null) {
    match.winner = outcome;
    match.phase = 'over';
    return;
  }
  match.phase = 'settle';
  match.settleDelay = SETTLE_SECONDS;
}

export interface StepResult {
  /** Who went down on this step, or null. */
  readonly downed: Downed;
  /** True on the step a wall's middle went by both birds. */
  readonly threaded: boolean;
  /** True on the step a new wall entered the sky. */
  readonly released: boolean;
}

/** Rewritten in place every step; a caller keeping it must copy the fields out. */
const result: { downed: Downed; threaded: boolean; released: boolean } = {
  downed: null,
  threaded: false,
  released: false,
};

/**
 * One fixed step of the whole match.
 *
 * The order is the design: the sky is advanced once for both seats, then both birds are
 * flown, then both are tested against the same walls, then the wall is banked for both.
 * Neither bird can read or touch the other at any point, so there is no order-of-play
 * advantage available to either seat — a property that needs no test because there is no
 * shared object for one to have.
 */
export function step(
  match: Match,
  p1Intent: Intent,
  p2Intent: Intent,
  fixedDeltaSeconds: number,
  rng: Rng,
): StepResult {
  result.downed = null;
  result.threaded = false;
  result.released = false;
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;
  if (match.elapsed >= MATCH_SECONDS) {
    const called = decide(match);
    match.winner = called === null ? 'draw' : called;
    match.phase = 'over';
    return result;
  }

  if (match.phase === 'settle') {
    match.settleDelay -= fixedDeltaSeconds;
    if (match.settleDelay <= 0) startFlight(match);
    return result;
  }

  // Pace and gap are read once, before anything moves, so a wall is threaded on the terms
  // it arrived on rather than on the terms the step it arrived in left behind.
  const speed = wallSpeedFor(match.cleared);
  const gap = gapFor(match.cleared);

  match.sinceSpawn += speed * fixedDeltaSeconds;
  if (match.sinceSpawn >= WALL_SPACING) {
    match.sinceSpawn -= WALL_SPACING;
    const centre = nextCentre(match.lastCentre, rng);
    match.lastCentre = centre;
    // One draw, one wall, both seats. This line is the whole of seat fairness here.
    releaseWall(match, centre);
    result.released = true;
  }

  if (match.phase === 'ready') {
    match.readyDelay -= fixedDeltaSeconds;
    // The walls come during the hover too, so the first one is read before gravity
    // arrives rather than arriving with it.
    driftWalls(match, speed * fixedDeltaSeconds);
    if (match.readyDelay <= 0) match.phase = 'flying';
    return result;
  }

  match.flightSeconds += fixedDeltaSeconds;
  fly(match.p1, p1Intent, fixedDeltaSeconds);
  fly(match.p2, p2Intent, fixedDeltaSeconds);
  driftWalls(match, speed * fixedDeltaSeconds);

  let p1Hit = false;
  let p2Hit = false;
  for (let i = 0; i < match.walls.length; i += 1) {
    const wall = match.walls[i]!;
    if (!wall.live) continue;
    if (wall.lead > TOOTH_REACH || wall.lead < -TOOTH_REACH) continue;
    if (!safeAt(match.p1.height, wall.centre, gap)) p1Hit = true;
    if (!safeAt(match.p2.height, wall.centre, gap)) p2Hit = true;
  }

  if (p1Hit || p2Hit) {
    endFlight(match, p1Hit, p2Hit);
    result.downed = match.downed;
    return result;
  }

  for (let i = 0; i < match.walls.length; i += 1) {
    const wall = match.walls[i]!;
    if (!wall.live) continue;
    if (!wall.passed && wall.lead <= 0) {
      wall.passed = true;
      match.cleared += 1;
      match.p1.threaded += 1;
      match.p2.threaded += 1;
      match.p1.clearance += clearanceAt(match.p1.height, wall.centre, gap);
      match.p2.clearance += clearanceAt(match.p2.height, wall.centre, gap);
      result.threaded = true;
    }
    if (wall.lead < DESPAWN_LEAD) wall.live = false;
  }

  // A flight neither player can lose is one the budget has to take back.
  if (match.flightSeconds >= FLIGHT_LIMIT) {
    endFlight(match, true, true);
    result.downed = match.downed;
  }

  return result;
}

/* ------------------------------------------------------------------ *
 * The bot
 * ------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between decisions. It flies on the posture it last settled on until this
   * expires, exactly as a person who glanced away would — and because a beat is a
   * decision, it is also a ceiling on how often the bot can beat a wing at all.
   */
  readonly reaction: number;
  /** How far off the middle of the gap it aims, in logical units. */
  readonly error: number;
  /**
   * How often it loses the wall altogether, **in blunders a second**.
   *
   * A rate rather than a chance per look, and the difference matters: the bot looks once
   * per {@link BotProfile.reaction}, so a fixed per-look chance would have the sharpest
   * tier blundering five times as often as the slowest for the same number, and two of the
   * three knobs would be pulling against each other. Multiplying by the reaction makes the
   * number mean what it says.
   */
  readonly blunder: number;
}

/**
 * How long a blunder lasts.
 *
 * A duration rather than a coin flip resolved every step. A bot that re-decides fourteen
 * times a second and freezes for one of those has not blundered, it has jittered, and its
 * next decision undoes it before it has cost anything. Held this long it drops 72 units
 * out of a hover — most of a wing-beat, and nearly the whole 80-unit window the tightest
 * wall leaves open — so a blunder is reliably a wall.
 */
export const BLUNDER_SECONDS = 0.34;

/**
 * How far either side of its aim the bot lets its height wander before correcting.
 *
 * It has to be **half a wing-beat, and symmetric about the aim**. A beat *sets* the climb
 * rate, so it is worth {@link FLAP_RISE} of altitude to whoever makes it and a bot that
 * beats whenever it drops below its aim flies a sawtooth 74 units deep sitting entirely
 * *above* the target — the same trap Flappy Jump documents at its own band. Looking more
 * often does not shrink that sawtooth, so a sharper tier would be no more accurate than a
 * slow one, merely more consistently too high. Correcting at half a beat below the aim
 * centres the sawtooth on the aim instead, which leaves reaction delay — how far past the
 * band it drifts before it notices — as the only thing separating the tiers.
 */
export const BOT_BAND = FLAP_RISE / 2;

/**
 * The three tiers, expressed only as reaction, aim error and blunder rate.
 *
 * None of them gets a stronger wing, a faster recharge, a wider gap, or a look at anything
 * a player cannot see — rule 6. All three fly through {@link fly} with the same constants
 * and all three run the same policy: hold the height of the next gap, beat when you sag
 * below it, tuck when you float above it. `hard` is better because it looks fourteen times
 * a second and aims true; `easy` is worse because it looks under four times a second —
 * which is also all the faster it can beat a wing, and that is exactly how a beginner
 * plays a tapping game.
 *
 * Measured over two hundred seeded matches a pairing and recorded in SPEC.md: `easy` takes
 * 2.5% off `normal` and nothing at all off `hard`, `normal` takes 11% off `hard`, and every
 * same-tier pairing lands between 46% and 53%. `rules.test.ts` holds the ladder to a
 * shorter run of the same measurement on every commit.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.26, error: 48, blunder: 0.42 },
  normal: { reaction: 0.12, error: 22, blunder: 0.26 },
  hard: { reaction: 0.07, error: 9, blunder: 0.16 },
});

export interface BotState {
  /** Seconds until the next look. */
  look: number;
  /** The height it is currently flying toward. */
  aim: number;
  /**
   * The posture it settled on at that look and flies on until the next one.
   *
   * Only ever `idle` or `tuck`. A beat is a one-shot decision and is deliberately *not*
   * held: holding it would let the slowest tier beat its wing at the recharge rate rather
   * than at its own reaction rate, and the reaction delay would stop being a handicap.
   */
  hold: Intent;
  /** Seconds of blunder left, during which it does nothing at all. */
  frozen: number;
}

export function createBotState(): BotState {
  return { look: 0, aim: SKY_HEIGHT / 2, hold: 'idle', frozen: 0 };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.aim = SKY_HEIGHT / 2;
  state.hold = 'idle';
  state.frozen = 0;
}

/**
 * What a bot wants to do this step.
 *
 * Returns an {@link Intent}, so a bot's decision goes through exactly the same
 * {@link fly} a player's does — including the recharge, which is why the hardest tier
 * cannot out-tap a human however short its reaction gets.
 *
 * Everything it reads is on the screen: the height of its own bird, whether its own wing
 * is back, and where the middle of the next gap is. It cannot see the wall after next any
 * sooner than a player can, and it never reads the other seat at all.
 */
export function botIntent(
  match: Readonly<Match>,
  seat: SeatId,
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

  const wall = nextWall(match);
  // Nothing to answer: hold the middle of the sky, which is where a player waits.
  state.aim = wall === null ? SKY_HEIGHT / 2 : wall.centre + (rng.float() * 2 - 1) * profile.error;

  const bird = seat === 'p1' ? match.p1 : match.p2;
  if (bird.height < state.aim - BOT_BAND) {
    // It wants to climb and the wing is not back yet. Waiting is the only honest answer:
    // queueing the press would spend the buffer on a beat it never chose, and whether your
    // own wing is ready is something a player can see.
    state.hold = 'idle';
    return bird.recharge > 0 ? 'idle' : 'flap';
  }
  if (bird.height > state.aim + BOT_BAND) {
    state.hold = 'tuck';
    return 'tuck';
  }
  state.hold = 'idle';
  return 'idle';
}
