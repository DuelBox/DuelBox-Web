import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';

/**
 * Target Practice, as pure rules.
 *
 * A shooting range seen from above. Two belts cross the lane in front of you, carrying
 * targets that slide across and come round again. A marker runs up and down the lane: press
 * once to keep the distance, press again to shoot. The shot takes time to get there, so the
 * second press is a *lead*, not a poke. Big targets score one, small ones score two, and the
 * first to ten wins.
 *
 * ## Four decisions carry the whole game
 *
 * **One press is a distance and the other is a moment.** The observed rule already describes
 * two taps rather than a drag, which is the fair idiom to begin with — a press is one binary
 * event with a timestamp on a phone, a trackpad and a keyboard alike. What is ours is the
 * *second* dial: Cup Pong's two presses are both spatial needles, and a second spatial needle
 * here would have been the same game twice. Here the shot always lands on the lane's centre
 * line, so the only way to put it on a target is to fire early enough that the target arrives
 * as the shot does. Timing is the aim. **[ours]**
 *
 * **The gallery is a function of the clock, never an integrated position.** A target's lateral
 * position is `wrap(phase + speed x clock)` evaluated fresh every time it is asked for, and a
 * shot's outcome is judged at `impactClock = fireClock + range / SHOT_SPEED` — a number
 * computed once, in closed form, at the moment of firing. Nothing about a target's position
 * accumulates. That is what lets the bot solve for a crossing analytically and get *the same
 * answer the simulation will get*, which five games in this repo were wrong about (b4af006).
 * Had the flight been counted out in frames instead, the arrival would have been up to a
 * sixtieth of a second late — 3.3 units of belt, a fifth of everything a small target
 * forgives, and always in the same direction — and the bot would have been aiming at a game
 * slightly different from the one being played. **[ours]**
 *
 * **The ready pause lives here, not in the shell.** The shell turns the board to face whoever
 * is shooting and refuses a person's input for the 0.36 s that takes. A bot does not go
 * through the shell. Worse than in Cup Pong: the range marker reaches the near belt 0.375 s
 * after it starts moving, so a person who had to wait out the flip would have **15
 * milliseconds** — one frame — to catch the near belt on its first pass, and a bot would have
 * had the lot. `READY_SECONDS` freezes the marker for longer than the flip, in the simulation,
 * where a person and a bot are the same thing. It cannot live in `game.ts`: `seatView` reports
 * no rotation at all in single-seat play, so a freeze keyed off the flip would step one match
 * on a shared phone and a different one on two phones playing remotely. **[ours]**
 *
 * **Both seats shoot at the same gallery from opposite ends.** Every belt, every target and
 * every speed is stated in the *shooter's own frame* — lateral across the lane, forward down
 * it — so the two galleries are one shape under the half-turn the board makes, and at any
 * instant the two seats face the bit-identical problem. Nothing a shot does changes the
 * gallery, so that stays true for the whole match rather than only at the start. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

export const BOARD_WIDTH = 700;
export const BOARD_HEIGHT = 1000;
export const CENTRE_X = BOARD_WIDTH / 2;
export const CENTRE_Y = BOARD_HEIGHT / 2;

/** Both muzzles sit this far from the centre line, so the two lanes are one shape mirrored. */
export const MUZZLE_OFFSET = 440;
export const P1_MUZZLE_Y = CENTRE_Y + MUZZLE_OFFSET;
export const P2_MUZZLE_Y = CENTRE_Y - MUZZLE_OFFSET;

/**
 * How far across the lane a belt runs before it comes round again.
 *
 * A target leaves behind one upright and returns from behind the other, which is what a
 * fairground belt does. The span is set so that a big target at the seam still sits inside the
 * board: `TRACK_HALF + BIG_RADIUS` is 334 against a half-width of 350.
 */
export const TRACK_HALF = 300;
export const TRACK_SPAN = TRACK_HALF * 2;

/**
 * The two belts, in the shooter's own frame: how far down the lane, how fast across, and how
 * many targets ride each.
 *
 * **They run at the same speed, in opposite directions**, and that is a decision rather than
 * an oversight. Distance is not available as a difficulty axis here — the board turns, so a
 * belt that were near for one seat would be far for the other — and a difference in *speed*
 * would have made one belt strictly the better shot at every tier, which is what a first pass
 * at 190 and 240 did: the bot took the slower belt in 100% of its turns and half the gallery
 * was scenery. Equal speeds leave the two belts worth the same and different anyway, because
 * the far one is 0.39 s away against 0.26 and therefore wants half as much lead again.
 *
 * Four targets each rather than three and four. With three, only one of them was small, so the
 * class a `hard` bot wants came round every 3 s against a 3 s turn — and a third of its plans
 * were rejected as unreachable, which read as the bot preferring a belt it was merely settling
 * for.
 */
export const BELT_FORWARD: readonly number[] = [230, 350];
export const BELT_SPEED: readonly number[] = [200, -200];
export const BELT_TARGETS: readonly number[] = [4, 4];

/**
 * The two sizes, and what they are worth. The observed rule says small targets score double.
 *
 * The radii are what decides whether that trade is worth taking, and they were chosen from the
 * arithmetic rather than by eye. A hit needs the marker inside `radius + PELLET_RADIUS` of the
 * belt *and* the target inside the same distance of the lane's centre line, so what each size
 * is worth is a pair of numbers in **seconds of press error**:
 * `(radius + PELLET_RADIUS) / RANGE_UNITS_PER_SECOND` and
 * `(radius + PELLET_RADIUS) / beltSpeed`. At 34 and 13 those come out as
 *
 * | | range press | fire press |
 * |---|---|---|
 * | big | 0.158 s | 0.190 s |
 * | small | 0.071 s | 0.085 s |
 *
 * — so a small target is a bit over twice the precision for exactly twice the points, and
 * which side of that trade is worth taking depends on how steady the hand is. That is where
 * the difficulty ladder actually lives: `chooseQuarry` values a target at its points times the
 * chance this tier's own hands would land it, and the two curves cross at about **0.165 s** of
 * press error. `easy` and `normal` sit above it and shoot the big ones; `hard` sits below and
 * shoots the small ones. Neither was told to.
 *
 * The crossing is what the radii were fitted to. At 16 against 34 it sat at 0.245 s, above
 * every tier worth shipping, so all three tiers wanted the small targets and the choice did
 * nothing; at 13 it sits between `normal` and `hard`, which is a ladder with the rung in it.
 */
export const BIG_RADIUS = 34;
export const SMALL_RADIUS = 13;
export const BIG_POINTS = 1;
export const SMALL_POINTS = 2;
/** The shot has a size, so what has to fit is `radius + this`, never the radius alone. */
export const PELLET_RADIUS = 4;

/**
 * Dead centre: a clean hit rather than one that caught the edge.
 *
 * Not part of the score. It settles a match the score has left level, which happens because
 * points come in ones and twos and two players of the same standard reach the same small
 * number often — 9% to 15% of matches, depending on the tier. See `finish` for what it is
 * worth in draws.
 *
 * 0.7 of the radius, so a bit over half of what is hit is hit clean: 56% at `easy`, 61% at
 * `normal`, 37% at `hard`, which shoots at targets less than half the size. A tiebreak that
 * almost never separates anybody is not one.
 */
export const CLEAN_SHARE = 0.7;

/**
 * The range gauge: how far up the lane the marker can be stopped, and how fast it travels.
 *
 * Fitted to the belts rather than to the board — 140 to 440 puts the near belt at 0.30 of the
 * gauge and the far one at 0.70, so both ends of the travel are a real decision and neither
 * belt sits in a corner of it. The far end stops exactly on the centre line, so the two lanes
 * meet and never overlap. The 44 units of clear lane between the two belts is the width of the
 * gap a badly kept distance falls into: 0.18 s of press error, which is more than a tier's own.
 *
 * The rate is a lattice, and it is the number to watch: a marker can only be stopped on a whole
 * frame, so a shot's distance can only fall on a grid, here 4 units apart — eight and a half
 * steps across a small target's hit window and nineteen across a big one. Cup Pong's first
 * version ran a needle so fast that its grid was coarser than its cup, and whether a throw went
 * in was decided by where the lattice happened to fall.
 */
export const RANGE_MIN = 140;
export const RANGE_MAX = 440;
export const RANGE_SPAN = RANGE_MAX - RANGE_MIN;
/** Fractions of the gauge a second. One crossing takes 1.25 s. */
export const RANGE_RATE = 0.8;
/** What the gauge is worth in lane units a second — the number the tolerances are built on. */
export const RANGE_UNITS_PER_SECOND = RANGE_RATE * RANGE_SPAN;

/**
 * How fast the shot travels, which is the whole of the lead a player has to give.
 *
 * At 900 the near belt is 0.256 s away and the far one 0.389 s, so a target has moved 51 and 78
 * units by the time the shot arrives — one and a half big targets, or three small ones, and a
 * different amount for each belt. Fast enough to be a lead rather than a guess; slow enough
 * that pressing when the target is already on the line is a miss, which is the mistake the game
 * is built to punish.
 */
export const SHOT_SPEED = 900;

/**
 * How long the marker is frozen at the start of a turn.
 *
 * **Longer than the shell's 0.36 s seat flip, deliberately.** The marker starts at the near
 * end of the gauge and covers 0.8 of it a second, so it reaches the near belt 0.375 s after it
 * starts moving. A person who could not press until the board had finished turning would have
 * fifteen milliseconds — nine tenths of one frame — to take the near belt on the first pass,
 * and would then wait 1.75 s for the marker to come back. A bot, which does not go through the shell,
 * would have had all 0.375 s of it.
 */
export const READY_SECONDS = 0.5;

/**
 * How long a turn lasts once the marker is live.
 *
 * Not decoration: without it a turn never ends, because nothing forces either press. It is also
 * what makes the match's length bounded rather than merely likely — see `MAX_ROUNDS`. Set from
 * the worst honest plan: the far belt is reached 0.875 s into the sweep and a target of a given
 * size comes round every 1.5 s, so any shot is away inside 2.4 s, and 3.0 leaves room for a
 * hand that is late without leaving room to dither. Between 3% and 8% of turns run out anyway,
 * which is a fumble large enough to have cost the shot rather than merely spoiled it.
 */
export const TURN_SECONDS = 3;

/** Seconds the shot is held on the board before it turns. */
export const SETTLE_SECONDS = 0.45;

/**
 * How much of a turn a bot leaves itself when it picks a shot.
 *
 * The worst plan is the far belt with its wanted size just gone — 0.875 s to reach the belt and
 * up to 1.5 s for the next one round, so 2.375 s of the 3.0 available. Rejecting anything past
 * 2.5 s therefore turns the far belt down when its next arrival is more than 1.625 s away,
 * which is a real constraint at the margin rather than pure insurance, and the alternative is
 * committing to a moment past the deadline and forfeiting the turn having decided nothing.
 */
export const PLAN_MARGIN = 0.5;

/** The observed rule: first to ten. */
export const TARGET_POINTS = 10;

/**
 * The ceiling on rounds, and the termination guarantee.
 *
 * `first-to-N` on its own does not terminate — two players who never hit anything play for
 * ever — and `roundSeconds` ends nothing, it is text on a catalogue card. Twenty-two rounds of
 * one shot each is the structural end: reach ten and win, or hold the higher score after
 * twenty-two and win, or draw. Both seats always take the same number of shots, so no ceiling
 * can favour either of them.
 *
 * Twenty-two rather than eighteen because it has to clear the longest matches the weakest
 * pairing produces rather than the average one: two `easy` bots take 13.9 rounds on average but
 * ran to 21 over 1500 seeds, and 2.4% of them past 18. It bites in about one `easy` match in
 * two thousand and never at the other tiers, and
 * a turn cannot last longer than `READY_SECONDS + TURN_SECONDS + SETTLE_SECONDS`, so the whole
 * match is bounded above by about three minutes of simulated play whatever anybody does.
 */
export const MAX_ROUNDS = 22;

export type Phase = 'ready' | 'aiming' | 'laying' | 'flying' | 'settling' | 'over';

export type Outcome = 'clean' | 'edge' | 'miss' | 'timeout';

export interface Target {
  /** 0 for the near belt, 1 for the far one — in the shooter's frame, for both seats. */
  readonly belt: number;
  /** Distance down the lane from the muzzle. */
  readonly forward: number;
  /** Lateral units a second, signed: the two belts run opposite ways. */
  readonly speed: number;
  readonly radius: number;
  readonly points: number;
  /** Lateral offset at clock zero, in [0, TRACK_SPAN). Drawn once, at the start of a match. */
  phase: number;
}

export interface Game {
  /**
   * One gallery, read by both seats in their own frames.
   *
   * Not two: nothing a shot does changes a target, so the two seats' galleries are the same
   * shape under the half-turn at every instant, and holding one copy is what makes that
   * impossible to break by accident.
   */
  readonly targets: readonly Target[];
  /** Seconds of match played. Every target position is a function of this and nothing else. */
  clock: number;
  phase: Phase;
  active: SeatId;
  /** Which seat led round one. Comes from the shell, and is not always `p1`. */
  opener: SeatId;
  /** Seconds left in the ready freeze or the settle, whichever phase is running. */
  hold: number;
  /** Seconds left of the turn's own deadline. Runs while aiming and while laying. */
  turnLeft: number;
  /** Where the range marker is, in 0..1 of the gauge. */
  marker: number;
  markerRising: boolean;
  /** The distance kept by the first press, once `phase` is past `aiming`. */
  keptRange: number;
  flight: number;
  flightTime: number;
  /** When the shot arrives, in clock seconds. Closed form, fixed at the moment of firing. */
  impactClock: number;
  /** Index into `targets` of what was struck, or -1. Presentation reads it; rules do not. */
  hitIndex: number;
  /** Where the struck target was when the shot arrived, so the mark is drawn on it. */
  hitLateral: number;
  lastOutcome: Outcome;
  lastPoints: number;
  round: number;
  /** Shots taken in the current round, so a match can only end on a completed one. */
  turnsThisRound: number;
  p1Turns: number;
  p2Turns: number;
  p1Points: number;
  p2Points: number;
  /** Targets struck, and how many of those were struck clean. The tiebreak. */
  p1Hits: number;
  p2Hits: number;
  p1Clean: number;
  p2Clean: number;
  winner: SeatId | 'draw' | null;
}

/** Which way a seat shoots: p1 up the board, p2 down it. */
export function firingSign(seat: SeatId): number {
  return seat === 'p1' ? -1 : 1;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function muzzleYOf(seat: SeatId): number {
  return seat === 'p1' ? P1_MUZZLE_Y : P2_MUZZLE_Y;
}

/**
 * A point in the shooter's frame, in board coordinates.
 *
 * The one place the two frames are reconciled, and the reason every other number in this file
 * can be stated once. `lateral` is across the lane with the shooter's own right positive, and
 * `forward` is down it, away from the shooter.
 */
export function boardXOf(seat: SeatId, lateral: number): number {
  return CENTRE_X - lateral * firingSign(seat);
}

export function boardYOf(seat: SeatId, forward: number): number {
  return muzzleYOf(seat) + forward * firingSign(seat);
}

/** Where a target sits across its belt at a given moment. Pure: nothing here accumulates. */
export function lateralAt(target: Readonly<Target>, clock: number): number {
  const raw = target.phase + target.speed * clock;
  return raw - Math.floor(raw / TRACK_SPAN) * TRACK_SPAN - TRACK_HALF;
}

/**
 * The next moment at or after `after` when a target crosses the lane's centre line.
 *
 * The exact inverse of `lateralAt`, which is what lets the bot solve for a lead rather than
 * watch for one — and, more importantly, get the answer the simulation will get. Works for
 * either direction of travel: a negative speed simply runs the same lattice backwards.
 */
export function nextCrossing(target: Readonly<Target>, after: number): number {
  const period = TRACK_SPAN / Math.abs(target.speed);
  const base = (TRACK_HALF - target.phase) / target.speed;
  let time = base + Math.ceil((after - base) / period) * period;
  // Float noise at the boundary can land a whole period early; one step forward fixes it and
  // cannot loop, because `period` is a positive constant.
  if (time < after) time += period;
  return time;
}

/** Where the marker's gauge fraction puts the shot, in lane units. */
export function rangeOf(marker: number): number {
  return RANGE_MIN + marker * RANGE_SPAN;
}

/** The gauge fraction that would put the shot at a distance. The inverse of `rangeOf`. */
export function gaugeOf(range: number): number {
  return clamp((range - RANGE_MIN) / RANGE_SPAN, 0, 1);
}

/** How far a shot to `range` has to travel before it arrives. */
export function flightTimeOf(range: number): number {
  return range / SHOT_SPEED;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * The gallery: big and small alternating along each belt, evenly spaced.
 *
 * Evenly spaced on its own belt, so a target of a given size reaches the lane's centre line
 * every 1.5 s and the wait for one is bounded. What keeps the whole gallery from being a
 * metronome is that the two belts run **opposite ways from independently drawn phases**: the
 * near belt's arrivals and the far belt's drift through each other and never lock, and the
 * marker takes half a second longer to reach the far belt, so the same pair of arrivals is a
 * different decision depending which belt it is on.
 */
function layOutGallery(): Target[] {
  const targets: Target[] = [];
  for (let belt = 0; belt < BELT_FORWARD.length; belt += 1) {
    const count = BELT_TARGETS[belt] as number;
    for (let i = 0; i < count; i += 1) {
      const small = i % 2 === 1;
      targets.push({
        belt,
        forward: BELT_FORWARD[belt] as number,
        speed: BELT_SPEED[belt] as number,
        radius: small ? SMALL_RADIUS : BIG_RADIUS,
        points: small ? SMALL_POINTS : BIG_POINTS,
        phase: (i * TRACK_SPAN) / count,
      });
    }
  }
  return targets;
}

export function createGame(): Game {
  return {
    targets: layOutGallery(),
    clock: 0,
    phase: 'ready',
    active: 'p1',
    opener: 'p1',
    hold: READY_SECONDS,
    turnLeft: TURN_SECONDS,
    marker: 0,
    markerRising: true,
    keptRange: RANGE_MIN,
    flight: 0,
    flightTime: 1,
    impactClock: 0,
    hitIndex: -1,
    hitLateral: 0,
    lastOutcome: 'timeout',
    lastPoints: 0,
    round: 1,
    turnsThisRound: 0,
    p1Turns: 0,
    p2Turns: 0,
    p1Points: 0,
    p2Points: 0,
    p1Hits: 0,
    p2Hits: 0,
    p1Clean: 0,
    p2Clean: 0,
    winner: null,
  };
}

export function pointsBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Points : game.p2Points;
}

export function cleanBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Clean : game.p2Clean;
}

export function hitsBy(game: Readonly<Game>, seat: SeatId): number {
  return seat === 'p1' ? game.p1Hits : game.p2Hits;
}

/**
 * Who opens a round.
 *
 * Alternates from whoever the shell gave the match to, so neither seat always shoots first
 * into a gallery the other has not seen yet. The shell alternates `openingSeat` across the
 * rounds of a best-of for the same reason (issue #2466), and a game that assumed `p1` would
 * quietly undo that.
 */
export function leadOf(opener: SeatId, round: number): SeatId {
  return round % 2 === 1 ? opener : otherOf(opener);
}

/**
 * Start a fresh match.
 *
 * The gallery's two belts are given a random phase — one draw each, from the match's own
 * generator — so two matches on the same seed are the same match and two on different seeds
 * open on a different gallery. The phases are the only randomness in the simulation; both
 * seats read the same gallery, so it cannot favour either of them.
 */
export function resetGame(game: Game, opener: SeatId, rng: Rng): void {
  let index = 0;
  for (let belt = 0; belt < BELT_FORWARD.length; belt += 1) {
    const count = BELT_TARGETS[belt] as number;
    const offset = rng.float() * TRACK_SPAN;
    for (let i = 0; i < count; i += 1) {
      (game.targets[index] as Target).phase = (offset + (i * TRACK_SPAN) / count) % TRACK_SPAN;
      index += 1;
    }
  }
  game.clock = 0;
  game.round = 1;
  game.turnsThisRound = 0;
  game.p1Turns = 0;
  game.p2Turns = 0;
  game.p1Points = 0;
  game.p2Points = 0;
  game.p1Hits = 0;
  game.p2Hits = 0;
  game.p1Clean = 0;
  game.p2Clean = 0;
  game.hitIndex = -1;
  game.hitLateral = 0;
  game.lastOutcome = 'timeout';
  game.lastPoints = 0;
  game.winner = null;
  game.opener = opener;
  game.active = leadOf(opener, 1);
  beginTurn(game);
}

/**
 * Start a turn, with the marker parked at the near end of the gauge and not moving.
 *
 * Parked at the near end rather than in the middle for the reason Cup Pong parks its needle
 * at a limit: parked on a belt, an instant press would be a free perfect distance.
 */
function beginTurn(game: Game): void {
  game.phase = 'ready';
  game.hold = READY_SECONDS;
  game.turnLeft = TURN_SECONDS;
  game.marker = 0;
  game.markerRising = true;
  game.keptRange = RANGE_MIN;
  game.flight = 0;
  game.hitIndex = -1;
}

/**
 * Accept a press from the seat whose turn it is.
 *
 * The first keeps the distance, the second shoots. Returns whether the press did anything, so
 * a caller need not re-derive the phase.
 */
export function press(game: Game, seat: SeatId): boolean {
  if (seat !== game.active) return false;
  if (game.phase === 'aiming') {
    game.keptRange = rangeOf(game.marker);
    game.phase = 'laying';
    return true;
  }
  if (game.phase === 'laying') {
    fire(game);
    return true;
  }
  return false;
}

function fire(game: Game): void {
  game.flightTime = flightTimeOf(game.keptRange);
  // The whole of the shot, decided here in closed form: the moment it arrives is a number,
  // not a count of frames. Judged against the gallery at exactly that moment in `land`.
  game.impactClock = game.clock + game.flightTime;
  game.flight = 0;
  game.phase = 'flying';
  if (game.active === 'p1') game.p1Turns += 1;
  else game.p2Turns += 1;
}

export interface StepResult {
  /** Set on the step the shot arrived, or the turn ran out with no shot at all. */
  readonly resolved: boolean;
  readonly outcome: Outcome;
  /** True on the step the turn passed. */
  readonly handedOver: boolean;
}

const result = { resolved: false, outcome: 'miss' as Outcome, handedOver: false };

/** How far through its flight the shot is, in [0, 1]. Presentation reads this; rules do not. */
export function flightProgress(game: Readonly<Game>): number {
  if (game.phase !== 'flying') return 0;
  return clamp(game.flight / game.flightTime, 0, 1);
}

/** One fixed step. */
export function step(game: Game, fixedDeltaSeconds: number): StepResult {
  result.resolved = false;
  result.outcome = 'miss';
  result.handedOver = false;
  if (game.phase === 'over') return result;

  // The gallery runs through every phase of every turn, including the freeze and the flip:
  // the belts belong to the range, not to whoever is holding the gun.
  game.clock += fixedDeltaSeconds;

  if (game.phase === 'ready') {
    game.hold -= fixedDeltaSeconds;
    if (game.hold <= 0) game.phase = 'aiming';
    return result;
  }

  if (game.phase === 'aiming' || game.phase === 'laying') {
    game.turnLeft -= fixedDeltaSeconds;
    if (game.phase === 'aiming') {
      const travel = (game.markerRising ? 1 : -1) * RANGE_RATE * fixedDeltaSeconds;
      game.marker = clamp(game.marker + travel, 0, 1);
      if (game.marker >= 1) game.markerRising = false;
      else if (game.marker <= 0) game.markerRising = true;
    }
    if (game.turnLeft <= 0) {
      // The deadline expired with a press still owed. No shot, no points, and the turn is
      // spent — which is what makes a match's length structural rather than hopeful.
      game.hitIndex = -1;
      game.lastOutcome = 'timeout';
      game.lastPoints = 0;
      if (game.active === 'p1') game.p1Turns += 1;
      else game.p2Turns += 1;
      game.phase = 'settling';
      game.hold = SETTLE_SECONDS;
      result.resolved = true;
      result.outcome = 'timeout';
    }
    return result;
  }

  if (game.phase === 'flying') {
    game.flight += fixedDeltaSeconds;
    if (game.flight < game.flightTime) return result;
    land(game);
    game.phase = 'settling';
    game.hold = SETTLE_SECONDS;
    result.resolved = true;
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
 * Judge the shot against the gallery at the moment it arrives.
 *
 * `impactClock` and not the current clock, and that difference is the whole point. The flight
 * is animated over whole frames, so the step it finishes on is up to a sixtieth of a second
 * late; judging there would put the far belt four units past where the bot solved for, which
 * is a quarter of a small target and a systematic bias against the very shots the game asks
 * for. The arrival is a closed-form number, and both the bot and the referee use it.
 *
 * The two dials meet in one Euclidean distance: how far the marker was left from the belt, and
 * how far the target was from the lane's centre line when the shot got there. Belts are 120
 * apart and targets never overlap on a belt, so at most one can be within reach and no
 * ambiguity is possible; the nearest is taken anyway, so that stays true if the gallery ever
 * grows.
 */
function land(game: Game): void {
  const targets = game.targets;
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestLateral = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i] as Target;
    const across = lateralAt(target, game.impactClock);
    const along = target.forward - game.keptRange;
    const distance = Math.hypot(across, along);
    if (distance <= target.radius + PELLET_RADIUS && distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestLateral = across;
    }
  }

  game.hitIndex = bestIndex;
  game.hitLateral = bestLateral;
  if (bestIndex < 0) {
    game.lastOutcome = 'miss';
    game.lastPoints = 0;
    return;
  }

  const target = targets[bestIndex] as Target;
  const clean = bestDistance <= target.radius * CLEAN_SHARE;
  game.lastOutcome = clean ? 'clean' : 'edge';
  game.lastPoints = target.points;
  if (game.active === 'p1') {
    game.p1Points += target.points;
    game.p1Hits += 1;
    if (clean) game.p1Clean += 1;
  } else {
    game.p2Points += target.points;
    game.p2Hits += 1;
    if (clean) game.p2Clean += 1;
  }
}

/**
 * Pass the gun, and decide whether the match is over.
 *
 * **A match ends only on a completed round.** Reaching ten does not end it on the spot: the
 * other seat still gets the shot it is owed, and may reach ten too. Ending on the point would
 * hand the match to whoever happened to be leading that round — the trap every first-to-N game
 * in this repo has had to be dug out of — and here it would also make the round cap
 * asymmetric, because the seat shooting second would be the only one whose last shot could be
 * cancelled.
 */
function handOver(game: Game): void {
  game.turnsThisRound += 1;
  if (game.turnsThisRound < 2) {
    game.active = otherOf(game.active);
    beginTurn(game);
    return;
  }
  game.turnsThisRound = 0;
  finish(game);
  if (game.winner !== null) return;
  game.round += 1;
  game.active = leadOf(game.opener, game.round);
  beginTurn(game);
}

/**
 * The win condition, through the SDK's shared helper.
 *
 * `first-to` with the round cap fed in as `timeExpired`, which is exactly what the helper's
 * fall-through is for: reach ten and win, and if nobody has after twenty rounds the higher
 * score takes it. Both seats crossing ten in the same round with the same total is a draw, and
 * the helper says so rather than handing it to whichever seat the code happened to test first.
 *
 * The clean-hit tiebreak runs **only on what the helper calls a draw**, and it is not
 * decoration — it is the score's fine resolution. Points come in ones and twos, so two players
 * of the same standard land on the same total often: over 2000 matches a tier the helper alone
 * drew 10.6%, 15.1% and 9.2%; breaking those on clean hits takes it to 1.9%, 3.5% and 2.0%. A
 * clean hit and one that caught the edge are visibly different things on the board, and
 * counting them apart costs a player nothing to understand.
 *
 * Deliberately a tiebreak and not points. A player who reaches ten first has won whatever the
 * other one's shooting looked like, because that is what the observed rule says the game is.
 */
function finish(game: Game): void {
  const decided = resolve(
    { kind: 'first-to', target: TARGET_POINTS },
    { p1: game.p1Points, p2: game.p2Points },
    { timeExpired: game.round >= MAX_ROUNDS },
  );
  if (decided === null) return;
  game.phase = 'over';
  if (decided !== 'draw') {
    game.winner = decided;
    return;
  }
  if (game.p1Clean !== game.p2Clean) game.winner = game.p1Clean > game.p2Clean ? 'p1' : 'p2';
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
 * That is the whole of the skill this game asks for — both dials are a press against a clock —
 * so it is the whole of what the tiers differ in, and the numbers are seconds of human error
 * rather than anything abstract: about a quarter of a second, a fifth, a seventh. Every one of
 * them is several frames wide, so rule 6 holds by construction: none of these can stop a marker
 * or pick a moment more finely than a person can.
 *
 * They also decide, without being told to, **what each tier shoots at**. `chooseQuarry` values
 * a target at its points times the chance this tier's own hands would land it, and the crossing
 * point of the two curves sits at 0.165 s — between `normal` and `hard`. So `easy` and `normal`
 * take the big targets and `hard` takes the small ones, which is a player's decision made from
 * what is on the board and how steady their own hand is, and it is the reason the observed
 * rule's double-scoring targets are worth building at all.
 *
 * Measured over 500 matches a side, that choice costs `hard` about thirteen points of win rate
 * against `normal` — a `hard` bot made to take the big targets instead wins 92.9% and 93.2%
 * from the two seats against the shipped 81.0% and 76.0%, while scoring *fewer* points a turn
 * (0.96 against 1.00). A race to a fixed score rewards consistency over expectation and the
 * value rule prices only expectation. It is kept anyway, and not out of sentiment: a
 * variance-aware rule takes the big targets at every tier, and then no bot in the game ever
 * shoots at a small one.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { timing: 0.24, blunder: 0.15 },
  normal: { timing: 0.21, blunder: 0.08 },
  hard: { timing: 0.145, blunder: 0.02 },
});

/** How much larger a fumbled press's error is than the tier's ordinary one. */
export const BLUNDER_SCALE = 6;

/**
 * A tier's own estimate of whether it would land a press inside a tolerance.
 *
 * The error is two draws summed, so it is triangular on [-h, h] and this is its exact
 * distribution function. Deliberately a *rectangle* over the two presses rather than the
 * ellipse the hit test really is: the bot is choosing between shots, not predicting its own
 * score, and the rectangle preserves the ordering while costing two multiplications. Calling
 * it a judgement rather than a probability is the honest description.
 */
export function pressWithin(halfWidth: number, tolerance: number): number {
  if (tolerance >= halfWidth) return 1;
  const shortfall = 1 - tolerance / halfWidth;
  return 1 - shortfall * shortfall;
}

/** Seconds of range-press error a target forgives. */
export function rangeToleranceOf(target: Readonly<Target>): number {
  return (target.radius + PELLET_RADIUS) / RANGE_UNITS_PER_SECOND;
}

/** Seconds of fire-press error a target forgives. */
export function fireToleranceOf(target: Readonly<Target>): number {
  return (target.radius + PELLET_RADIUS) / Math.abs(target.speed);
}

export type BotStage = 'plan' | 'range' | 'fire';

export interface BotState {
  /** Index into `targets` of the one it decided to shoot at, or -1 before it has decided. */
  quarry: number;
  /** The gauge fraction it wants to keep. A fraction, and never a number of seconds. */
  wantGauge: number;
  /** Seconds of error committed to for each press, drawn separately: two presses, two hands. */
  rangeOffset: number;
  fireOffset: number;
  /** Seconds left before the press it has already committed to. */
  rangeTimer: number;
  fireTimer: number;
  stage: BotStage;
}

export function createBotState(): BotState {
  return {
    quarry: -1,
    wantGauge: 0,
    rangeOffset: 0,
    fireOffset: 0,
    rangeTimer: 0,
    fireTimer: 0,
    stage: 'plan',
  };
}

export function resetBotState(state: BotState): void {
  state.quarry = -1;
  state.wantGauge = 0;
  state.rangeOffset = 0;
  state.fireOffset = 0;
  state.rangeTimer = 0;
  state.fireTimer = 0;
  state.stage = 'plan';
}

/**
 * One generator per seat, both drawn from the match's own before anything else touches it.
 *
 * With `BOT_DRAWS_PER_TURN` constant, this fixes what a seat's *hands* do: seat two commits to
 * the identical sequence of press errors whatever tier is sitting opposite it, which is the
 * property a shared stream loses the moment a turn's draw count comes to depend on what the bot
 * decided.
 *
 * It does **not** make seat two's shooting independent of its opponent, and no arrangement of
 * generators could: the gallery is one gallery on one clock, so an opponent who takes longer
 * over their turns hands the next seat a different phase of the belts. Over 500 matches, seat
 * two took a bit-identical set of shots against an `easy` opponent and against a `hard` one in
 * **0 of them**. That coupling is symmetric, it is visible on the board — the belts are running
 * where both players can see them — and it produces no measurable seat bias: 51.2%, 49.5% and
 * 50.9% of decided matches to seat one over 2000 seeds a tier. Being clear about which of the
 * two properties this guard buys is the point of writing it down.
 */
export function createBotRngs(source: Rng): { p1: Rng; p2: Rng } {
  return { p1: new Rng(source.next() | 0), p2: new Rng(source.next() | 0) };
}

/**
 * Values a bot draws per turn. Always exactly this many, drawn before anything branches.
 *
 * The other half of the guarantee in `createBotRngs`. A draw count that depended on what the
 * bot decided would make one seat's stream a function of the other's play.
 */
export const BOT_DRAWS_PER_TURN = 6;

/**
 * Pick what to shoot at: points times the chance this tier's own hands would land it.
 *
 * Everything it reads is on the board — where the targets are, how big they are, how fast
 * their belt runs — plus one thing about itself, which is how steady its hands are. A person
 * has both. Nothing here knows where a target will be that a player watching the belt could
 * not work out, and nothing is searched: seven targets, O(1) each.
 *
 * Feasibility is part of the choice and not an afterthought. A turn is three seconds, the
 * marker takes 0.875 s to reach the far belt, and a target of a given size comes round every
 * 1.5 s, so a shot that cannot be away in time has to be passed over for one that can —
 * otherwise the bot commits to a moment past the deadline and forfeits the turn having decided
 * nothing at all.
 *
 * Ties go to the shot that gets away soonest, and that tie is not a rare case: the two belts
 * are worth exactly the same, so which one a bot takes is decided entirely by which has a
 * target coming. The near belt is reached half a second earlier, so it takes about three
 * turns in four, and the far belt the rest.
 */
export function chooseQuarry(
  game: Readonly<Game>,
  difficulty: BotDifficulty,
  fromClock: number,
): number {
  const profile = BOT_PROFILES[difficulty];
  let best = -1;
  let bestValue = -1;
  let bestFire = Infinity;
  for (let i = 0; i < game.targets.length; i += 1) {
    const target = game.targets[i] as Target;
    const markerAt = gaugeOf(target.forward) / RANGE_RATE;
    const flight = flightTimeOf(target.forward);
    // Earliest crossing the shot could still be in the air for, which is what makes this a
    // lead rather than a poke: the press comes `flight` seconds before the target arrives.
    const arrival = nextCrossing(target, fromClock + markerAt + flight);
    const fireAt = arrival - flight - fromClock;
    if (fireAt > TURN_SECONDS - PLAN_MARGIN) continue;
    const value =
      target.points *
      pressWithin(profile.timing, rangeToleranceOf(target)) *
      pressWithin(profile.timing, fireToleranceOf(target));
    // Ties go to the shot that gets away soonest, which is the one with the most room left
    // for a late hand.
    if (value > bestValue + 1e-9 || (Math.abs(value - bestValue) <= 1e-9 && fireAt < bestFire)) {
      bestValue = value;
      bestFire = fireAt;
      best = i;
    }
  }
  return best;
}

/**
 * Choose the shot, once, at the start of a turn.
 *
 * Six values, always, drawn before anything branches — including before it knows whether it
 * will find a target at all.
 */
export function planShot(
  game: Readonly<Game>,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): void {
  const profile = BOT_PROFILES[difficulty];
  const rangeRollA = rng.float();
  const rangeRollB = rng.float();
  const fireRollA = rng.float();
  const fireRollB = rng.float();
  const blunderRoll = rng.float();
  const blunderSize = rng.float();

  // Two draws a press, summed: the error is triangular rather than flat, so most presses land
  // near the mark and a bad one is rare. Flat, a tier either fits inside the tolerance or it
  // does not, with nothing in between, and three tiers have nowhere to stand.
  state.rangeOffset = (rangeRollA + rangeRollB - 1) * profile.timing;
  state.fireOffset = (fireRollA + fireRollB - 1) * profile.timing;
  if (blunderRoll < profile.blunder) {
    // One roll decides both which press is fumbled and by how much — the low bit picks the
    // press, the rest the size — so a fumble costs the same one draw as no fumble at all.
    const slip = (((blunderSize * 2) % 1) * 2 - 1) * profile.timing * BLUNDER_SCALE;
    if (blunderSize < 0.5) state.rangeOffset += slip;
    else state.fireOffset += slip;
  }

  const quarry = chooseQuarry(game, difficulty, game.clock);
  state.quarry = quarry;
  const target = quarry < 0 ? null : (game.targets[quarry] as Target);
  state.wantGauge = target === null ? 0 : gaugeOf(target.forward);
  // The marker starts parked at the near end and rises, so the moment it is at a wanted
  // fraction is arithmetic rather than a search — and committing to a *moment* rather than to
  // a position is what stops the bot deadlocking. See `driveBot`.
  state.rangeTimer = state.wantGauge / RANGE_RATE + state.rangeOffset;
  state.stage = 'range';
}

/**
 * Run a bot for one step: plan if it has not, then press when the moment it chose arrives.
 *
 * **It counts down to a moment; it does not watch for a position.** Watching for a position is
 * the obvious way to write this and it hangs: the error is added in whichever direction the
 * marker is going, so an error larger than the gauge is out of reach *both* ways — the marker
 * turns round at the end of its travel and the wanted value turns round with it, and the two
 * never meet. A countdown cannot fail to expire, and it is the more honest model anyway: a
 * person commits to a moment, and pressing after the marker has turned round is a real way to
 * miss.
 *
 * The fire press is computed **at the range press, from the distance actually kept** — not
 * from the one it wanted. The lead is `range / SHOT_SPEED`, so a marker stopped short needs a
 * shorter lead, and a player can see exactly where the marker stopped. Using the wanted
 * distance instead would tie the two errors together and quietly halve the ladder.
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
    planShot(game, difficulty, state, rng);
  }

  if (game.phase === 'aiming' && state.stage === 'range') {
    if (state.rangeTimer > fixedDeltaSeconds / 2) {
      state.rangeTimer -= fixedDeltaSeconds;
      return false;
    }
    const pressed = press(game, seat);
    const quarry = state.quarry;
    if (quarry >= 0) {
      const target = game.targets[quarry] as Target;
      const flight = flightTimeOf(game.keptRange);
      const arrival = nextCrossing(target, game.clock + flight);
      // Minus one step: the fire countdown does not run on the step this press is taken, but
      // the clock does, so its clock starts one step ahead of the range press's. Without it
      // every shot in the game leaves a frame late — four units of far belt, a quarter of a
      // small target, and always in the same direction.
      state.fireTimer = arrival - flight - game.clock + state.fireOffset - fixedDeltaSeconds;
    } else {
      state.fireTimer = TURN_SECONDS * 2;
    }
    // Cleared on the press. `wantGauge` is a fraction of the range gauge and `fireTimer` is a
    // number of seconds; leaving one standing in a field the other press reads is how a shot
    // ends up fired at a gauge fraction's worth of seconds.
    state.wantGauge = 0;
    state.rangeOffset = 0;
    state.rangeTimer = 0;
    state.stage = 'fire';
    return pressed;
  }

  if (game.phase === 'laying' && state.stage === 'fire') {
    if (state.fireTimer > fixedDeltaSeconds / 2) {
      state.fireTimer -= fixedDeltaSeconds;
      return false;
    }
    state.quarry = -1;
    state.fireOffset = 0;
    state.fireTimer = 0;
    state.stage = 'plan';
    return press(game, seat);
  }

  // The turn ended without both presses — a fumble large enough to run past the deadline.
  // Reset the stage so the next turn plans afresh rather than firing on a stale countdown.
  if (game.phase !== 'aiming' && game.phase !== 'laying' && state.stage !== 'plan') {
    resetBotState(state);
  }
  return false;
}
