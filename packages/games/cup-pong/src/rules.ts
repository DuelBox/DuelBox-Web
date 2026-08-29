import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';

/**
 * Cup Pong, as pure rules.
 *
 * A table seen from above, a rack of six cups at each end, and one ball. A needle sweeps
 * across the table and a press keeps the line; a marker then runs out along that line and a
 * second press throws. Land in one of the opponent's cups and it comes off the table. Clear
 * all six of theirs and the match is yours.
 *
 * ## Three decisions carry the whole game
 *
 * **Aiming is two presses, never a drag.** A drag hands a thumb a continuous quantity a key
 * cannot match, and rule 10 forbids a game that plays differently on two instruments. A
 * press is one binary event with a timestamp on every device there is. The first press keeps
 * the line, the second keeps the distance along it — polar coordinates, one dial each.
 *
 * **The ready pause lives here, not in the shell.** The shell turns the board to face
 * whoever is throwing and refuses human input for the 0.36 s that takes. A bot does not go
 * through the shell, so it would get that third of a second of free needle. `READY_SECONDS`
 * freezes the needle for longer than the flip for *both* of them, in the simulation, where
 * the two are the same. It cannot be done in `game.ts` instead: `seatView` reports no
 * rotation at all in single-seat play, so the same match would step differently on a phone
 * playing remotely and on a phone passed across a table. **[ours]**
 *
 * **A match ends only on a completed round**, the lead alternates, and the round count is
 * odd. The first of those three is the one carrying the weight, and it is worth being exact
 * about which: measured over 2000 matches a tier, alternating the lead and fixing it at seat
 * one give **bit-identical results**, because the two racks never touch and a seat's throws
 * depend on nothing but its own. Remove the completed-round rule instead — end the match the
 * instant a rack is cleared — and with a fixed lead seat one takes 52.8% of decided `hard`
 * matches, 2.45 standard deviations out; over an even eight rounds it goes the other way,
 * 47.6% and 2.06 out, because the seat throwing second in the last round is the one whose
 * final throw can be cancelled. The alternation and the odd count are kept anyway: they cost
 * one line, they are what keeps this true if anything shared is ever added to the table, and
 * an odd count is what gives the first throw of a match and the last to different people,
 * which is what somebody sitting at the table actually notices. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;
export const CENTRE_X = BOARD_WIDTH / 2;
export const CENTRE_Y = BOARD_HEIGHT / 2;

/** Both throw lines sit this far from the centre, so the two ends are one shape mirrored. */
export const THROW_OFFSET = 430;
export const P1_THROW_Y = CENTRE_Y + THROW_OFFSET;
export const P2_THROW_Y = CENTRE_Y - THROW_OFFSET;

/**
 * The cup, and the ball that has to fit inside it.
 *
 * `MOUTH_RADIUS` — not `CUP_RADIUS` — is what a throw is judged against, because a ball whose
 * centre sits on the rim does not go in. It is also, with the needle speeds below, the number
 * that decides where the whole difficulty ladder lives, and getting it wrong is not
 * recoverable by tuning the bots.
 *
 * The quantity that matters is **how many seconds of press error the mouth is worth**:
 * `MOUTH_RADIUS / (needle rate x throw distance)`. The first version of this game had a
 * radius-10 mouth under a needle covering 400 units of table a second, which put that figure
 * at about 0.025 s — so the three tiers came out at 0.046, 0.053 and 0.062 seconds of error,
 * a 1.35x window, all of it within four frames of perfect. That is not a ladder, it is three
 * spellings of "nearly perfect", and no amount of bot tuning fixes it because the bottom of
 * the window is the frame rate.
 *
 * A *smaller ball in the same cup* is what moved it. A rack's width and its cups' mouths
 * scale together with `CUP_RADIUS`, so making the cups bigger changes nothing at all; making
 * the mouth bigger inside them changes everything. At 9 against 26 the ladder sits at 0.11,
 * 0.15 and 0.20 seconds, which is where a person's timing error actually is.
 */
export const CUP_RADIUS = 26;
export const BALL_RADIUS = 9;
export const MOUTH_RADIUS = CUP_RADIUS - BALL_RADIUS;
/**
 * Dead centre: a clean drop rather than one that goes in off the rim.
 *
 * Set so that a bit over half of everything that goes in goes in clean — 54% at `easy`, 62%
 * at `hard`. This is the score's fine resolution, and a tiebreak that almost never separates
 * anybody is not one. See `finish` for what it is worth in draws.
 */
export const SWISH_RADIUS = 12;

/** Row spacing of a triangular rack: cups in adjacent rows touch. */
export const ROW_GAP = 45;
/** Distance from the centre line to the apex cup, which points at the thrower. */
export const RACK_APEX_OFFSET = 200;
export const CUPS_PER_RACK = 6;

/**
 * Rounds in a match, and the termination guarantee.
 *
 * A plain counter, not a clock: each round is one throw each, so a match is eighteen throws
 * whatever happens in them, and two players who never hit anything still finish. **Odd on
 * purpose** — see the note at the top.
 */
export const ROUNDS = 9;

/**
 * The aim needle: how far it sweeps either side of straight down the table, and how fast.
 *
 * The sweep is set from the rack rather than from the board — the far corner cup sits at
 * 0.072 rad and a throw may miss its middle by a mouth and still count — so 0.12 covers the
 * whole rack with about a fifth to spare. A sweep much wider is a gauge whose ends are not a
 * decision.
 *
 * The rate is a lattice, and that is the part worth watching: a needle can only be stopped on
 * a whole frame, so a throw's landing point can only fall on a grid, here 4.3 units apart —
 * eight steps across a 17-unit mouth, which is fine. The first version ran at 1.0 rad/s where
 * one frame was 11 units and the grid was coarser than the cup, so whether a throw went in was
 * decided by where the lattice happened to fall: two neighbouring mouth radii, 8 and 9, gave
 * the identical hit rate to three figures.
 */
export const AIM_SWEEP = 0.12;
export const AIM_RATE = 0.37;

/**
 * How far a throw carries, between the ends of the second needle.
 *
 * Fitted to the rack the same way: the near cup is 630 away and the far corner 722, so a gauge
 * of 590 to 760 spends about three quarters of its travel on distances that could hit
 * something. The rate is chosen so that both needles take about two thirds of a second to
 * cross, which makes the two presses the same size of decision.
 */
export const MIN_RANGE = 590;
export const MAX_RANGE = 760;
export const STRENGTH_RATE = 1.54;

/** Units a second the ball crosses the table at, which is all that sets the flight's length. */
export const BALL_SPEED = 950;

/**
 * How long both needles are frozen at the start of a turn.
 *
 * **Longer than the shell's 0.36 s seat flip, deliberately**, and the margin is not
 * decoration. The needle starts at one end of its sweep and travels 0.37 rad a second, so
 * 0.36 s of it is 0.133 rad — more than half the gauge. A person who could not press until
 * the table had finished turning would find every angle from the left limit to just past the
 * middle already gone on the first pass, which is the whole left half of the rack, and would
 * wait most of a second more for the needle to come back. A bot, which does not go through
 * the shell, would have had all of it.
 */
export const READY_SECONDS = 0.5;

/** Seconds the landing is held on the table before the board turns. */
export const SETTLE_SECONDS = 0.55;

export type Phase = 'ready' | 'aiming' | 'throwing' | 'flying' | 'settling' | 'over';

export type Outcome = 'swish' | 'rattle' | 'miss';

export interface Cup {
  readonly x: number;
  readonly y: number;
  standing: boolean;
}

export interface Ball {
  x: number;
  y: number;
}

export interface Game {
  /** Each seat's own rack — the cups the *other* seat is throwing at. */
  readonly p1Rack: readonly Cup[];
  readonly p2Rack: readonly Cup[];
  readonly ball: Ball;
  phase: Phase;
  active: SeatId;
  /**
   * Who opens round one. The shell's `context.openingSeat`, never a literal `p1` — the SDK
   * alternates it across the rounds of a best-of (#2466), and a game that always opened
   * with seat one would leave that rotation reaching nothing.
   */
  opener: SeatId;
  /** Seconds left in the ready freeze or the settle, whichever phase is running. */
  hold: number;
  /** Where the aim needle is, in radians either side of straight down the table. */
  aim: number;
  aimRising: boolean;
  /** Where the range needle is, in 0..1 of the gauge. */
  strength: number;
  strengthRising: boolean;
  /** The line kept by the first press, once `phase` is past `aiming`. */
  lockedAim: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  flight: number;
  flightTime: number;
  round: number;
  /** Throws taken in the current round, so a match can only end on a completed one. */
  thrownThisRound: number;
  p1Throws: number;
  p2Throws: number;
  /** Cups each seat has taken off the *other* seat's rack. */
  p1Made: number;
  p2Made: number;
  /** How many of those went in clean. The tiebreak, and the reason precision pays. */
  p1Clean: number;
  p2Clean: number;
  lastOutcome: Outcome;
  winner: SeatId | 'draw' | null;
}

/** Which way a seat throws: p1 up the table, p2 down it. */
export function firingSign(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function throwYOf(seat: SeatId): number {
  return seat === 'p1' ? P1_THROW_Y : P2_THROW_Y;
}

/**
 * A six-cup triangle with its apex toward the thrower.
 *
 * Built from the centre line outward so the two racks are one shape under the half-turn the
 * board makes: every cup in p1's rack has a partner in p2's at exactly the rotated point,
 * which is what lets both seats face the same throw.
 */
function layOutRack(seat: SeatId): Cup[] {
  const away = -firingSign(seat);
  const apexY = CENTRE_Y + away * RACK_APEX_OFFSET;
  const cups: Cup[] = [];
  for (let row = 0; row < 3; row += 1) {
    const y = apexY + away * ROW_GAP * row;
    for (let i = 0; i <= row; i += 1) {
      cups.push({ x: CENTRE_X + (i - row / 2) * CUP_RADIUS * 2, y, standing: true });
    }
  }
  return cups;
}

export function createGame(): Game {
  return {
    p1Rack: layOutRack('p1'),
    p2Rack: layOutRack('p2'),
    ball: { x: CENTRE_X, y: P1_THROW_Y },
    phase: 'ready',
    active: 'p1',
    opener: 'p1',
    hold: READY_SECONDS,
    aim: -AIM_SWEEP,
    aimRising: true,
    strength: 0,
    strengthRising: true,
    lockedAim: 0,
    fromX: CENTRE_X,
    fromY: P1_THROW_Y,
    toX: CENTRE_X,
    toY: P1_THROW_Y,
    flight: 0,
    flightTime: 1,
    round: 1,
    thrownThisRound: 0,
    p1Throws: 0,
    p2Throws: 0,
    p1Made: 0,
    p2Made: 0,
    p1Clean: 0,
    p2Clean: 0,
    lastOutcome: 'miss',
    winner: null,
  };
}

/** The rack belonging to a seat: the cups the other seat is shooting at. */
export function rackOf(game: Readonly<Game>, seat: SeatId): readonly Cup[] {
  return seat === 'p1' ? game.p1Rack : game.p2Rack;
}

export function madeBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Made : game.p2Made;
}

export function cleanBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Clean : game.p2Clean;
}

/** Who opens a round. Alternates, so neither seat always throws into a fresh rack first. */
export function leadOf(round: number, opener: SeatId = 'p1'): SeatId {
  return round % 2 === 1 ? opener : otherOf(opener);
}

export function resetGame(game: Game, opener: SeatId = 'p1'): void {
  game.opener = opener;
  for (const cup of game.p1Rack) cup.standing = true;
  for (const cup of game.p2Rack) cup.standing = true;
  game.round = 1;
  game.thrownThisRound = 0;
  game.p1Throws = 0;
  game.p2Throws = 0;
  game.p1Made = 0;
  game.p2Made = 0;
  game.p1Clean = 0;
  game.p2Clean = 0;
  game.lastOutcome = 'miss';
  game.winner = null;
  game.active = leadOf(1, opener);
  beginTurn(game);
}

/**
 * Start a turn, with both needles parked and neither moving.
 *
 * The aim needle parks at one end of its sweep rather than in the middle: parked at zero it
 * would already be pointing at the apex cup on the step the freeze lifts, and an instant
 * press would be a free perfect line.
 */
function beginTurn(game: Game): void {
  game.phase = 'ready';
  game.hold = READY_SECONDS;
  game.aim = -AIM_SWEEP;
  game.aimRising = true;
  game.strength = 0;
  game.strengthRising = true;
  game.lockedAim = 0;
  game.ball.x = CENTRE_X;
  game.ball.y = throwYOf(game.active);
}

/**
 * Accept a press from the seat whose turn it is.
 *
 * The first keeps the line, the second keeps the distance and throws. Returns whether the
 * press did anything, so a caller need not re-derive the phase.
 */
export function press(game: Game, seat: SeatId): boolean {
  if (seat !== game.active) return false;
  if (game.phase === 'aiming') {
    game.lockedAim = game.aim;
    game.phase = 'throwing';
    return true;
  }
  if (game.phase === 'throwing') {
    launch(game);
    return true;
  }
  return false;
}

/**
 * Where a throw at `angle` and `strength` comes down.
 *
 * The angle is measured from straight down the table and the sign of the lateral term is
 * flipped with the seat, so **the same pair of numbers is the same throw for both players**
 * — the board is mirrored, and so is the geometry. Writes into `out` rather than returning
 * a point, because the bot calls it once per cup per decision.
 */
export function landingOf(out: Ball, seat: SeatId, angle: number, strength: number): Ball {
  const sign = firingSign(seat);
  const range = MIN_RANGE + strength * (MAX_RANGE - MIN_RANGE);
  out.x = CENTRE_X - Math.sin(angle) * range * sign;
  out.y = throwYOf(seat) + Math.cos(angle) * range * sign;
  return out;
}

/**
 * The exact inverse: the line and the distance that would land a throw on a point.
 *
 * Closed form, so the bot never searches a grid — and every number in it is on the table in
 * front of a player. Returns the angle; the distance goes into `out.x` as a gauge fraction,
 * clamped to what the needle can actually reach.
 */
export function aimAt(out: Ball, seat: SeatId, targetX: number, targetY: number): number {
  const sign = firingSign(seat);
  const lateral = (targetX - CENTRE_X) * -sign;
  const forward = (targetY - throwYOf(seat)) * sign;
  const range = Math.hypot(lateral, forward);
  out.x = clamp((range - MIN_RANGE) / (MAX_RANGE - MIN_RANGE), 0, 1);
  out.y = range;
  return clamp(Math.atan2(lateral, forward), -AIM_SWEEP, AIM_SWEEP);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function launch(game: Game): void {
  const seat = game.active;
  const range = MIN_RANGE + game.strength * (MAX_RANGE - MIN_RANGE);
  game.fromX = CENTRE_X;
  game.fromY = throwYOf(seat);
  landingOf(game.ball, seat, game.lockedAim, game.strength);
  game.toX = game.ball.x;
  game.toY = game.ball.y;
  game.ball.x = game.fromX;
  game.ball.y = game.fromY;
  game.flight = 0;
  game.flightTime = range / BALL_SPEED;
  game.phase = 'flying';
  if (seat === 'p1') game.p1Throws += 1;
  else game.p2Throws += 1;
}

export interface StepResult {
  /** Set on the step the ball came down. */
  readonly landed: boolean;
  readonly outcome: Outcome;
  /** True on the step the turn passed. */
  readonly handedOver: boolean;
}

const result = { landed: false, outcome: 'miss' as Outcome, handedOver: false };

/** How far through its flight the ball is, in [0, 1]. Presentation reads this; rules do not. */
export function flightProgress(game: Readonly<Game>): number {
  if (game.phase !== 'flying') return 0;
  return clamp(game.flight / game.flightTime, 0, 1);
}

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  result.landed = false;
  result.outcome = 'miss';
  result.handedOver = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'ready') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) game.phase = 'aiming';
    return result;
  }
  if (game.phase === 'aiming') {
    const travel = (game.aimRising ? 1 : -1) * AIM_RATE * fixedDeltaSeconds;
    game.aim = clamp(game.aim + travel, -AIM_SWEEP, AIM_SWEEP);
    if (game.aim >= AIM_SWEEP) game.aimRising = false;
    else if (game.aim <= -AIM_SWEEP) game.aimRising = true;
    return result;
  }
  if (game.phase === 'throwing') {
    const travel = (game.strengthRising ? 1 : -1) * STRENGTH_RATE * fixedDeltaSeconds;
    game.strength = clamp(game.strength + travel, 0, 1);
    if (game.strength >= 1) game.strengthRising = false;
    else if (game.strength <= 0) game.strengthRising = true;
    return result;
  }
  if (game.phase === 'flying') {
    game.flight += fixedDeltaSeconds;
    const travelled = clamp(game.flight / game.flightTime, 0, 1);
    game.ball.x = game.fromX + (game.toX - game.fromX) * travelled;
    game.ball.y = game.fromY + (game.toY - game.fromY) * travelled;
    if (travelled < 1) return result;
    resolveLanding(game);
    game.phase = 'settling';
    game.hold = SETTLE_SECONDS;
    result.landed = true;
    result.outcome = game.lastOutcome;
    return result;
  }

  game.hold -= fixedDeltaSeconds;
  if (game.hold <= 0) {
    handOver(game);
    result.handedOver = true;
  }
  return result;
}

/**
 * Judge the landing against the rack it came down in.
 *
 * Cups in a rack touch, so at most one can hold a point inside its mouth; the nearest is
 * therefore the only candidate and no ambiguity is possible.
 */
function resolveLanding(game: Game): void {
  const rack = rackOf(game, otherOf(game.active));
  let nearest: Cup | null = null;
  let best = Infinity;
  for (const cup of rack) {
    if (!cup.standing) continue;
    const distance = Math.hypot(cup.x - game.ball.x, cup.y - game.ball.y);
    if (distance < best) {
      best = distance;
      nearest = cup;
    }
  }
  if (nearest === null || best > MOUTH_RADIUS) {
    game.lastOutcome = 'miss';
    return;
  }
  nearest.standing = false;
  const clean = best <= SWISH_RADIUS;
  game.lastOutcome = clean ? 'swish' : 'rattle';
  if (game.active === 'p1') {
    game.p1Made += 1;
    if (clean) game.p1Clean += 1;
  } else {
    game.p2Made += 1;
    if (clean) game.p2Clean += 1;
  }
}

/**
 * Pass the ball, and decide whether the match is over.
 *
 * **A match ends only on a completed round.** Clearing the rack does not end it on the spot:
 * the other seat still gets the throw it is owed, and may clear their own. Ending on the
 * make would hand the win to whoever happened to be leading that round, which is the trap
 * every first-to-N game in this repo has had to be dug out of.
 */
function handOver(game: Game): void {
  game.thrownThisRound += 1;
  if (game.thrownThisRound < 2) {
    game.active = otherOf(game.active);
    beginTurn(game);
    return;
  }
  game.thrownThisRound = 0;
  const cleared = game.p1Made >= CUPS_PER_RACK || game.p2Made >= CUPS_PER_RACK;
  if (cleared || game.round >= ROUNDS) {
    finish(game);
    return;
  }
  game.round += 1;
  game.active = leadOf(game.round, game.opener);
  beginTurn(game);
}

/**
 * Cups first, clean throws second.
 *
 * The second term is not decoration, it is the score's resolution. Cups taken is a number
 * between nought and six, and two players of the same standard land on the same one of those
 * seven values often: on cups alone, 2000 matches a tier drew **22.9% at `easy`, 18.9% at
 * `normal`, 15.3% at `hard`**. A clean drop and one that goes in off the rim are visibly
 * different things on the table, and counting them apart costs a player nothing to
 * understand — with the tiebreak the same 6000 matches draw **9.1%, 5.8% and 4.5%**.
 *
 * Deliberately a tiebreak and not points. A player who clears the rack has won whatever the
 * other one's throws looked like, because that is what the game says it is.
 */
function finish(game: Game): void {
  game.phase = 'over';
  if (game.p1Made !== game.p2Made) game.winner = game.p1Made > game.p2Made ? 'p1' : 'p2';
  else if (game.p1Clean !== game.p2Clean) game.winner = game.p1Clean > game.p2Clean ? 'p1' : 'p2';
  else game.winner = 'draw';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** How far off the moment it meant to press it actually presses, in seconds. */
  readonly timing: number;
  /** How often one of the two presses is an outright fumble. */
  readonly blunder: number;
}

/**
 * Three tiers, expressed only as how accurately a tier hits the moment it meant to.
 *
 * That is the whole of the skill this game asks for, so it is the whole of what the tiers
 * differ in, and the numbers are seconds of human error rather than anything abstract: a
 * fifth of a second, a seventh, a ninth. Every one of them is several frames wide, so rule 6
 * holds by construction — none of these can stop a needle more finely than a person can.
 *
 * **A third knob was written, swept and deleted.** `wander` moved the bot's aim point off the
 * middle of the cup by a fixed number of units. Swept alone at `hard` it was monotone —
 * 50.2%, 48.7%, 44.9%, 32.6%, 18.6% of throws made at 0, 5, 10, 20 and 40 units — but the
 * whole of its useful travel is above the mouth radius, and the values that made a good
 * three-tier ladder were 4 to 8 units, which is inside it and does nothing. Rather than
 * inflate it into a second, redundant spelling of `timing`, it went.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.2, blunder: 0.15 },
  normal: { timing: 0.15, blunder: 0.08 },
  hard: { timing: 0.11, blunder: 0.02 },
});

/** How much larger a fumbled press's error is than the tier's ordinary one. */
export const BLUNDER_SCALE = 6;

export type BotStage = 'plan' | 'line' | 'range';

export interface BotState {
  /**
   * The line it wants, in radians, and the distance it wants, as a fraction of the gauge.
   *
   * Two fields and not one, because the two are quantities in different units and a single
   * `want` shared between the presses is exactly how the range needle came to be stopped at
   * the line's answer — 0.07 radians read as 0.07 of the range gauge is a throw that lands
   * 550 units short of every cup on the table. `stage` is the other half of that guard.
   */
  wantAim: number;
  wantStrength: number;
  /** Seconds of error committed to for each press, drawn separately: two presses, two hands. */
  aimOffset: number;
  strengthOffset: number;
  /** Seconds of sweep left before the press it has already committed to. */
  lineTimer: number;
  rangeTimer: number;
  stage: BotStage;
}

export function createBotState(): BotState {
  return {
    wantAim: 0,
    wantStrength: 0,
    aimOffset: 0,
    strengthOffset: 0,
    lineTimer: 0,
    rangeTimer: 0,
    stage: 'plan',
  };
}

export function resetBotState(state: BotState): void {
  state.wantAim = 0;
  state.wantStrength = 0;
  state.aimOffset = 0;
  state.strengthOffset = 0;
  state.lineTimer = 0;
  state.rangeTimer = 0;
  state.stage = 'plan';
}

/**
 * One generator per seat, both drawn from the match's own before anything else touches it.
 *
 * **This one is insurance, and the measurement says so — which is worth writing down rather
 * than dressing up.** Run on a single shared stream instead, 2000 matches a tier came out at
 * 50.5%, 50.0% and 49.6% to seat one, which is no bias at all. It is unbiased for a reason
 * that is true of this game and of nothing in general: only the seat whose turn it is draws
 * anything, turns strictly alternate, and a turn costs exactly `BOT_DRAWS_PER_THROW` values —
 * so the two seats sit on fixed, disjoint residues of one stream and never trade places.
 * Every one of those three facts is a thing a later change could quietly break.
 *
 * Break one and the coupling is immediate and large. With the fumble's size drawn only when
 * there is a fumble — a draw count that depends on what the bot chose — and one shared
 * stream, **seat two threw the identical shots against an `easy` opponent and against a
 * `hard` one in only 148 matches out of 500**, mean matching prefix 57.5%: its play had
 * become a function of how its opponent was playing. With a generator each and the same
 * variable draw count, 500 out of 500.
 */
export function createBotRngs(source: Rng): { p1: Rng; p2: Rng } {
  return { p1: new Rng(source.next() | 0), p2: new Rng(source.next() | 0) };
}

/**
 * Values a bot draws per throw. Always exactly this many, drawn before anything branches.
 *
 * The other half of the guarantee in `createBotRngs`, and each half is on its own sufficient:
 * with the draw count made conditional, a generator per seat still kept the two seats
 * independent in 500 matches out of 500. Keeping both means neither has to be the one that
 * holds.
 */
export const BOT_DRAWS_PER_THROW = 6;

const scratch: Ball = { x: 0, y: 0 };

/**
 * Choose the throw, once, at the start of a turn.
 *
 * It takes the nearest cup still standing. Nearest rather than any other rule because lateral
 * error grows with distance — a line off by one needle-frame misses by `range x dtheta` — so
 * the near cup is genuinely the easy one, and that is a fact a player reads off the table
 * rather than one the bot is told.
 *
 * **Both terms are in the thrower's own frame, and that is not tidiness.** Ranking cups by
 * how far down the table they sit, and taking the first of a tie, sorted them by *board* x —
 * which is not the same order for the two seats, because the table turns between them. The
 * two ends of the back row are the same throw mirrored, but they are not the same throw from
 * the needle's point of view: one is reached a third of a second into the sweep and the other
 * two thirds, so a fumble large enough to run the press back past the start of the sweep gets
 * truncated for one seat and not the other. Ranking by range and breaking ties on the
 * thrower's own lateral coordinate is invariant under the half-turn, so the two seats choose
 * mirrored cups and face mirrored problems.
 */
export function planThrow(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const aimRollA = rng.float();
  const aimRollB = rng.float();
  const strengthRollA = rng.float();
  const strengthRollB = rng.float();
  const blunderRoll = rng.float();
  const blunderSize = rng.float();

  const rack = rackOf(game, otherOf(seat));
  const sign = firingSign(seat);
  let targetX = CENTRE_X;
  let targetY = CENTRE_Y;
  let bestRange = Infinity;
  let bestLateral = Infinity;
  for (const cup of rack) {
    if (!cup.standing) continue;
    const lateral = (cup.x - CENTRE_X) * -sign;
    const forward = (cup.y - throwYOf(seat)) * sign;
    const range = Math.hypot(lateral, forward);
    const nearer = range < bestRange - 1e-9;
    const level = Math.abs(range - bestRange) <= 1e-9 && lateral < bestLateral;
    if (nearer || level) {
      bestRange = range;
      bestLateral = lateral;
      targetX = cup.x;
      targetY = cup.y;
    }
  }

  state.wantAim = aimAt(scratch, seat, targetX, targetY);
  state.wantStrength = scratch.x;
  // Two draws a needle, summed: the press error is triangular rather than flat, so most
  // presses land near the mark and a bad one is rare. Flat, the ladder has almost nowhere to
  // stand — a flat error either fits inside the mouth or it does not, with nothing in
  // between, and on this table 0.05 s made 96% of throws while 0.11 s made 28%. Peaked, the
  // same span runs 0.05 s at 98%, 0.11 s at 61%, 0.20 s at 29% and 0.40 s at 14%: the three
  // shipped tiers fit inside it with room either side. It is also the better picture of a
  // person — mostly close, occasionally nowhere near.
  state.aimOffset = (aimRollA + aimRollB - 1) * profile.timing;
  state.strengthOffset = (strengthRollA + strengthRollB - 1) * profile.timing;
  if (blunderRoll < profile.blunder) {
    // One roll decides both which press is fumbled and by how much — the low bit picks the
    // needle, the rest the size — so a fumble costs the same one draw as no fumble at all.
    const slip = (((blunderSize * 2) % 1) * 2 - 1) * profile.timing * BLUNDER_SCALE;
    if (blunderSize < 0.5) state.aimOffset += slip;
    else state.strengthOffset += slip;
  }
  // Both needles start from a known end of their own gauge, so the moment a needle will be
  // at a wanted value is arithmetic rather than a search — and committing to a *moment*
  // rather than to a position is what stops the bot deadlocking. See `driveBot`.
  state.lineTimer = (state.wantAim + AIM_SWEEP) / AIM_RATE + state.aimOffset;
  state.stage = 'line';
}

/**
 * Run a bot for one step: plan if it has not, then press when the moment it chose arrives.
 *
 * **It counts down to a moment; it does not watch for a position.** Watching for a position
 * is the obvious way to write this and it hangs: the error is added in whichever direction
 * the needle is currently going, so an error larger than the gauge is out of reach *both*
 * ways — the needle turns round at the end of its sweep and the wanted value turns round
 * with it, and the two never meet. Two `easy` seats went into that on seed 2 of the very
 * first harness run and would have swept for ever. A countdown cannot fail to expire, and it
 * is also the more honest model: a person commits to a moment, and pressing late enough that
 * the needle has turned round is a real way to miss.
 *
 * One entry point rather than a plan call and a press call, because the two have to agree
 * about the stage and a caller that got the order wrong would look like a tuning problem
 * rather than a bug.
 */
export function driveBot(
  game: Game,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  fixedDeltaSeconds: number,
): boolean {
  if (game.active !== seat) return false;

  if (game.phase === 'aiming' && state.stage === 'plan') {
    planThrow(game, seat, difficulty, state, rng);
  }

  if (game.phase === 'aiming' && state.stage === 'line') {
    if (state.lineTimer > fixedDeltaSeconds / 2) {
      state.lineTimer -= fixedDeltaSeconds;
      return false;
    }
    // The range needle takes its first step in the same step this press is taken, so its
    // clock starts one step ahead of the line's.
    state.rangeTimer =
      state.wantStrength / STRENGTH_RATE + state.strengthOffset - fixedDeltaSeconds;
    // Cleared on the press. `wantAim` is radians and `rangeTimer` above divides a gauge
    // fraction by a gauge rate; leaving the line's answer standing in a field the range
    // press reads is how the second needle ends up stopped at the first one's number.
    state.wantAim = 0;
    state.aimOffset = 0;
    state.lineTimer = 0;
    state.stage = 'range';
    return press(game, seat);
  }

  if (game.phase === 'throwing' && state.stage === 'range') {
    if (state.rangeTimer > fixedDeltaSeconds / 2) {
      state.rangeTimer -= fixedDeltaSeconds;
      return false;
    }
    state.wantStrength = 0;
    state.strengthOffset = 0;
    state.rangeTimer = 0;
    state.stage = 'plan';
    return press(game, seat);
  }

  return false;
}
