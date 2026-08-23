import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Racing Cars, as pure rules.
 *
 * A car each on one track, and one thing to say to it: how far across the road to be. The
 * car drives itself and winds up to full speed on a clean run; barriers stand across the
 * road with a gap in them, and the only way past one is to be in the gap when it arrives.
 * Clip one and the car spins, crawls for most of a second and starts winding up again
 * from nothing. First over the line wins.
 *
 * Four decisions shape everything below, and each is argued where it lives:
 *
 *  - **One track, read by both seats** ({@link fillTrack}). Both cars run the same
 *    generated sequence of gates rather than two draws from it, so the two lanes are
 *    identical in difficulty by construction rather than on average. Structural fairness,
 *    not tuned fairness.
 *  - **Steering is a rate, never a jump** ({@link STEER_SPEED}). A finger, a key and a bot
 *    all express the same thing — *where across the road to be* — and all of them get the
 *    car there at exactly {@link STEER_SPEED}. That is what makes the game fair across
 *    input families rather than won by whoever's instrument repeats fastest.
 *  - **Speed climbs on a clean run and is lost in a crash** ({@link speedOf}). It is the
 *    genre's own instruction — finish first — and it is what decides a race between two
 *    players who can both read a gate.
 *  - **The race ends twice over** ({@link stepMatch}). A finish line nobody can fail to
 *    reach, because a car always moves forward; and a clock behind it that calls the race
 *    on distance if anything ever goes wrong enough that they do not.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit and every duration is
 * in simulated seconds.
 */

/** The logical box the two lanes are drawn into. Declared here so the manifest cannot drift. */
export const COURSE_WIDTH = 600;
export const COURSE_HEIGHT = 1000;

/**
 * Half the width of the road, measured from its centre line.
 *
 * The one lateral measurement the simulation has. Every other across-the-road number below
 * is derived from it, and the renderer scales nothing: a car sitting at `across = 260` is
 * against the right kerb in the picture too.
 */
export const ROAD_HALF_WIDTH = 260;

/** The car's half-width, which is what has to fit through a gap. */
export const CAR_HALF_WIDTH = 30;

/** How far off the centre line a car may get before the kerb stops it. */
export const ACROSS_LIMIT = ROAD_HALF_WIDTH - CAR_HALF_WIDTH;

/**
 * Positions across the road a gap may be centred on.
 *
 * Five, and not a continuum: a gap that can be anywhere is a gap a player has to measure,
 * and what this game asks is *which way, and how soon* rather than how precisely. Five
 * slots spaced {@link SLOT_PITCH} apart put the outermost gap fully on the road with room
 * for the widest gate, so no gate is ever half over the kerb.
 */
export const SLOTS = 5;
export const MIDDLE_SLOT = 2;
export const SLOT_PITCH = 82;

/** Where across the road a slot sits. Slot 0 is the far left, slot 4 the far right. */
export function slotAcross(slot: number): number {
  return (slot - MIDDLE_SLOT) * SLOT_PITCH;
}

/** Half-widths of the two kinds of gap. A narrow one is the same choice made finer. */
export const GATE_WIDE = 96;
export const GATE_NARROW = 62;

/**
 * How long one cell of track is, and how long the barrier standing in it is.
 *
 * {@link HIT_ALONG} — the span in which a car and a barrier can touch — is deliberately
 * shorter than half a cell, so the whole of a collision happens inside the barrier's own
 * cell. That is what lets the collision test look at one cell rather than sweeping a
 * range, and it is checked by a test rather than left as a comment.
 */
export const CELL_LENGTH = 300;
export const BARRIER_HALF_LENGTH = 60;
export const CAR_HALF_LENGTH = 80;
export const HIT_ALONG = CAR_HALF_LENGTH + BARRIER_HALF_LENGTH;

/** Cells to the finish line, and the distance that comes to. */
export const RACE_CELLS = 64;
export const RACE_DISTANCE = RACE_CELLS * CELL_LENGTH;

/** The first cells are always clear, so nobody meets a barrier before they have looked. */
export const CALM_CELLS = 2;

/**
 * How much road a driver can see in front of their own car, in track units.
 *
 * Fixed by the drawing — a seat's half of the box is a window on the track and this is how
 * much of it fits — and named here because the bot is held below it (rule 6): a bot reads
 * {@link BOT_LOOKAHEAD} units of road where a person reads this many. Both seats' windows
 * are this deep, so neither ever sees more of what is coming than the other (rule 9).
 */
export const VISIBLE_AHEAD = 900;

/** Cells of track that fit in the window, rounded up. The renderer walks this many. */
export const VISIBLE_CELLS = Math.ceil(VISIBLE_AHEAD / CELL_LENGTH);

/**
 * Cells generated.
 *
 * A driver reads {@link VISIBLE_AHEAD} beyond their own car and the race stops the instant
 * somebody reaches {@link RACE_DISTANCE}, so this is the furthest cell anybody can ask
 * for, plus two for comfort.
 */
export const TRACK_CELLS = RACE_CELLS + VISIBLE_CELLS + 2;

/** Units a second at a standing start, at the top of the wind-up, and while spinning. */
export const SPEED_SLOW = 320;
export const SPEED_FAST = 640;
export const SPEED_SPIN = 130;

/** Seconds of clean driving to reach full speed from a standing start. */
export const BOOST_SECONDS = 9;

/** Seconds a car spins after clipping a barrier. Steering does nothing for the duration. */
export const SPIN_SECONDS = 0.85;

/**
 * How fast a car crosses the road, in units a second.
 *
 * The single number that makes this game fair across input families. A finger names a
 * point, a key names a direction and a bot names a point, and all three arrive at the same
 * rate — so no instrument steers sooner, further or finer than another, and what is left
 * to be good at is *which gap, and how early*, which every instrument expresses equally
 * well. **[ours]**
 */
export const STEER_SPEED = 460;

/**
 * How close to the asked-for point counts as arrived, in units.
 *
 * Steering eases off inside this band rather than stopping dead, so a car settles on a
 * line instead of hunting either side of it — and so a bot and a resting finger produce
 * the same smooth approach rather than a per-step twitch.
 */
export const STEER_SNAP = 24;

/**
 * The race is called on distance after this long.
 *
 * A second guarantee behind the finish line. A car always moves forward — even a spinning
 * one crawls at {@link SPEED_SPIN} — so sixty-four cells ends a race between two cars that
 * are driving, and they always are. This exists for the case where something has gone
 * wrong enough that they do not, and it is well above the slowest measured pairing: over
 * three thousand six hundred seeded bot races the longest was 59 s, and a race in which
 * both drivers hold a kerb and clip nearly every gate on the track still comes home.
 * `roundSeconds` in the manifest ends nothing at all — it prints a number on the catalogue
 * card — so the guarantee has to live here. See the note at the top of
 * `termination.test.ts`.
 */
export const ROUND_SECONDS = 110;

/** Where the ramp below changes gear, in cells. */
export const RAMP_EARLY = 16;
export const RAMP_LATE = 34;

/**
 * How many slots a gate may move from the one before it, at `index` cells in.
 *
 * Half the difficulty curve, and the half that decides whether a gate can be threaded at
 * all. One slot early on is a nudge; three late on is most of the road, and at full speed
 * it has to be begun before the gate is legible rather than after.
 */
export function reachAt(index: number): number {
  if (index < RAMP_EARLY) return 1;
  if (index < RAMP_LATE) return 2;
  return 3;
}

/**
 * Clear cells left after a barrier before the next one may stand, at `index` cells in.
 *
 * The other half of the curve. Together with {@link reachAt} it is what keeps every track
 * runnable and makes it steadily less comfortable: the reach grows while the room to use
 * it shrinks, so a gate goes from something to react to into something to commit to.
 */
export function spacingAt(index: number): number {
  if (index < RAMP_EARLY) return 3;
  if (index < RAMP_LATE) return 2;
  return 1;
}

/** How likely a gate at `index` is the narrow kind, ramping across the whole race. */
export function narrowChanceAt(index: number): number {
  const along = index / RACE_CELLS;
  const clamped = along < 0 ? 0 : along > 1 ? 1 : along;
  return clamped * 0.55;
}

/** A cell with nothing in it. Any other value is a gate; see {@link gateSlot}. */
export const CLEAR = 0;

/** Pack a gate into one cell value: which slot it opens at, and whether it is narrow. */
export function gateValue(slot: number, narrow: boolean): number {
  return 1 + slot + (narrow ? SLOTS : 0);
}

/** Which slot a gate opens at. Only meaningful for a value other than {@link CLEAR}. */
export function gateSlot(gate: number): number {
  return (gate - 1) % SLOTS;
}

export function gateNarrow(gate: number): boolean {
  return gate > SLOTS;
}

/** Half the width of a gate's opening. */
export function gateHalf(gate: number): number {
  return gateNarrow(gate) ? GATE_NARROW : GATE_WIDE;
}

/** What stands in the cell at `index`, or {@link CLEAR} off either end of the track. */
export function gateAt(track: Readonly<Int8Array>, index: number): number {
  return track[index] ?? CLEAR;
}

/** Which cell a point on the track falls in. */
export function cellOf(distance: number): number {
  return Math.floor(distance / CELL_LENGTH);
}

/** The middle of a cell's barrier, in track units. */
export function barrierAlong(index: number): number {
  return index * CELL_LENGTH + CELL_LENGTH / 2;
}

/**
 * Fill a track from the seeded generator.
 *
 * **One track, read by both seats.** Two independently generated roads would be fair only
 * on average, and a race is run once: a driver who drew four gates across the road while
 * their opponent drew a straight has lost to the seed rather than to the other player.
 * Handing both seats the identical sequence deletes the question outright — the two lanes
 * are not similar in difficulty, they are the same gates in the same order — and it is
 * what makes this a race rather than two solo drives shown side by side.
 *
 * Two draws per barrier, always, whether or not the second changes anything. Drawing the
 * width only when the ramp has opened it works — the stream is deterministic either way —
 * but it couples the sequence of slots to the sequence of widths, so a tuning change to
 * {@link narrowChanceAt} would silently rearrange every track in the game.
 *
 * The last cell before the line is left clear, so nobody is caught out by a barrier they
 * could not see past the finish.
 */
export function fillTrack(track: Int8Array, rng: Rng): void {
  track.fill(CLEAR);
  let slot = MIDDLE_SLOT;
  let index = CALM_CELLS;
  while (index < RACE_CELLS - 1) {
    const aim = rng.float();
    const width = rng.float();
    const reach = reachAt(index);
    const low = Math.max(0, slot - reach);
    const high = Math.min(SLOTS - 1, slot + reach);
    const picked = low + Math.floor(aim * (high - low + 1));
    const chosen = picked > high ? high : picked;
    track[index] = gateValue(chosen, width < narrowChanceAt(index));
    slot = chosen;
    index += spacingAt(index) + 1;
  }
}

/**
 * Whether the barrier in `index` catches a car at `distance` sitting `across` the road.
 *
 * The whole collision rule, in one place. A barrier spans the road from kerb to kerb apart
 * from its gap, so *where along* the cell the car is only decides whether they are
 * touching at all; whether it is a crash is entirely about how far across the road the car
 * is. The gap is narrowed by {@link CAR_HALF_WIDTH} on each side, because a car is not a
 * point and clipping the edge of a gap is clipping the barrier.
 */
export function caughtBy(
  track: Readonly<Int8Array>,
  index: number,
  distance: number,
  across: number,
): boolean {
  const gate = gateAt(track, index);
  if (gate === CLEAR) return false;
  if (Math.abs(distance - barrierAlong(index)) >= HIT_ALONG) return false;
  const room = gateHalf(gate) - CAR_HALF_WIDTH;
  return Math.abs(across - slotAcross(gateSlot(gate))) > room;
}

export interface Car {
  /** How far along the track it has driven. This, in cells, is the score. */
  distance: number;
  /** How far across the road from the centre line, positive towards the driver's right. */
  across: number;
  /** How far up the wind-up it is, 0 to 1. Lost outright in a crash. */
  boost: number;
  /** Seconds left of a spin; zero while driving. */
  spin: number;
  /**
   * The cell of the barrier that last caught it, or -1.
   *
   * A spinning car keeps rolling forward and is still inside the barrier it just hit for
   * most of a second, so without this it would be caught by the same barrier on every one
   * of the next fifty steps and never leave it — a race that cannot end. It is not a
   * general invulnerability: any *other* barrier still catches it.
   */
  hitCell: number;
  /** Barriers clipped, for the picture and for the balance harness. */
  crashes: number;
}

export function createCar(): Car {
  return { distance: 0, across: 0, boost: 0, spin: 0, hitCell: -1, crashes: 0 };
}

export function resetCar(car: Car): void {
  car.distance = 0;
  car.across = 0;
  car.boost = 0;
  car.spin = 0;
  car.hitCell = -1;
  car.crashes = 0;
}

/**
 * How fast a car is travelling now.
 *
 * **This is the rule that decides the race, and it exists because a fixed speed does
 * not.** At a fixed speed the only thing separating two drivers is how many barriers they
 * clipped — both read the same gates — and a spin is a very coarse unit to decide a race
 * in. A wind-up costs a crash twice over: the second of crawling, and the nine seconds of
 * climbing back to speed, which is much the larger of the two. That is what turns one
 * mistake into a decided race.
 */
export function speedOf(car: Readonly<Car>): number {
  if (car.spin > 0) return SPEED_SPIN;
  return SPEED_SLOW + (SPEED_FAST - SPEED_SLOW) * car.boost;
}

/** How many whole cells a car has driven. This is what the scoreboard shows. */
export function postsOf(car: Readonly<Car>): number {
  const posts = cellOf(car.distance);
  return posts > RACE_CELLS ? RACE_CELLS : posts;
}

/** What one car did this step. */
export type Stride = 'idle' | 'driving' | 'spinning' | 'crashed' | 'home';

/**
 * Which way to steer to get from `across` to `target`, as a number in [-1, 1].
 *
 * Full lock until the last {@link STEER_SNAP} units, then proportionally less. Every
 * source of steering in the game goes through this — a finger, a bot, and the keys by way
 * of their own sign — so none of them can steer harder than another.
 */
export function steerFor(across: number, target: number): number {
  const delta = target - across;
  if (delta > STEER_SNAP) return 1;
  if (delta < -STEER_SNAP) return -1;
  return delta / STEER_SNAP;
}

function clampSteer(steer: number): number {
  if (!Number.isFinite(steer)) return 0;
  return steer > 1 ? 1 : steer < -1 ? -1 : steer;
}

/**
 * Drive one car for a step.
 *
 * `steer` is what that seat is asking for, in [-1, 1]; anything outside is clamped and a
 * value that is not a number at all reads as no steering, because the pointer positions a
 * browser produces are not always numbers a game would choose.
 *
 * A spinning car steers not at all and still moves forward. Both halves matter: the first
 * is what a crash costs, and the second is what guarantees the race ends.
 */
export function stepCar(
  track: Readonly<Int8Array>,
  car: Car,
  steer: number,
  fixedDeltaSeconds: number,
): Stride {
  if (car.distance >= RACE_DISTANCE) return 'idle';

  let travel: number;
  if (car.spin > 0) {
    car.spin -= fixedDeltaSeconds;
    // Snapped rather than carried over, so a recovery lands on a step boundary exactly and
    // the bar a renderer draws never runs past its own end.
    if (car.spin < 0) car.spin = 0;
    travel = SPEED_SPIN * fixedDeltaSeconds;
  } else {
    car.across += clampSteer(steer) * STEER_SPEED * fixedDeltaSeconds;
    if (car.across > ACROSS_LIMIT) car.across = ACROSS_LIMIT;
    else if (car.across < -ACROSS_LIMIT) car.across = -ACROSS_LIMIT;
    const before = car.boost;
    car.boost += fixedDeltaSeconds / BOOST_SECONDS;
    if (car.boost > 1) car.boost = 1;
    // The *mean* speed over the step, not the speed at either end of it. The wind-up is a
    // straight line in time, so its midpoint is the exact average — which makes the
    // distance covered in a second of racing the same number whether that second arrived
    // as sixty steps or as a hundred and twenty. Taking the speed at one end instead is a
    // rectangle rule, and it makes the game a measurable fraction faster on one refresh
    // rate than on another.
    travel =
      (SPEED_SLOW + (SPEED_FAST - SPEED_SLOW) * ((before + car.boost) / 2)) * fixedDeltaSeconds;
  }

  car.distance += travel;
  if (car.distance >= RACE_DISTANCE) {
    car.distance = RACE_DISTANCE;
    return 'home';
  }

  const cell = cellOf(car.distance);
  if (cell !== car.hitCell && caughtBy(track, cell, car.distance, car.across)) {
    car.hitCell = cell;
    car.crashes += 1;
    car.spin = SPIN_SECONDS;
    car.boost = 0;
    return 'crashed';
  }

  return car.spin > 0 ? 'spinning' : 'driving';
}

export type Phase = 'racing' | 'over';

export interface Match {
  /** The one track both seats drive. Allocated once; refilled on reset. */
  readonly track: Int8Array;
  readonly p1: Car;
  readonly p2: Car;
  /** Simulated seconds the race has run, so it can be called. */
  elapsed: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
}

export function createMatch(): Match {
  return {
    track: new Int8Array(TRACK_CELLS),
    p1: createCar(),
    p2: createCar(),
    elapsed: 0,
    phase: 'racing',
    winner: null,
  };
}

/**
 * Put both cars back on the line, leaving the track as it is.
 *
 * Separate from {@link resetMatch} because tearing a match down is not the same as
 * starting one: `destroy` has to leave nothing behind, but generating a fresh track on the
 * way out would spend draws from the host's generator after the match they belong to has
 * finished.
 */
export function clearMatch(match: Match): void {
  resetCar(match.p1);
  resetCar(match.p2);
  match.elapsed = 0;
  match.phase = 'racing';
  match.winner = null;
}

/** Start a fresh race on a newly generated track. The only place the track is written. */
export function resetMatch(match: Match, rng: Rng): void {
  fillTrack(match.track, rng);
  clearMatch(match);
}

export function carOf(match: Readonly<Match>, seat: SeatId): Car {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export interface StepResult {
  readonly p1: Stride;
  readonly p2: Stride;
}

/** Rewritten in place rather than allocated, so a step costs no garbage (rule 5). */
const result: { p1: Stride; p2: Stride } = { p1: 'idle', p2: 'idle' };

/**
 * The race, as the SDK spells it: first to the line, and the clock settles it otherwise.
 *
 * Held at module scope and rewritten rather than built per call, for the same reason the
 * step result is. `resolve` is the shared helper every game decides with, so "first past
 * the post" and "level is a draw" mean the same thing here as everywhere else.
 */
const FINISH_LINE: WinCondition = { kind: 'first-to', target: RACE_DISTANCE };
const winTally = { p1: 0, p2: 0 };
const winOptions = { timeExpired: false };

/**
 * Who has won, or null while the race is live.
 *
 * Resolved on **distance** rather than on the cell count the scoreboard prints: the count
 * is the distance rounded down, so deciding on it would turn a race that reached the clock
 * a car's length apart into a dead heat. A distance is what actually separates them.
 */
export function judge(match: Readonly<Match>): SeatId | 'draw' | null {
  winTally.p1 = match.p1.distance;
  winTally.p2 = match.p2.distance;
  winOptions.timeExpired = match.elapsed >= ROUND_SECONDS;
  return resolve(FINISH_LINE, winTally, winOptions);
}

/**
 * One fixed step of the whole race.
 *
 * Both cars are driven before either is judged, so a step in which both cross the line is
 * the dead heat it actually is rather than a win for whichever seat the loop happened to
 * run first.
 *
 * The race is only put to {@link judge} on a step that could have decided it — a car
 * home, or the clock out. Asking on every step would be the same answer and one throwaway
 * object a step, and a step in this game allocates nothing at all.
 */
export function stepMatch(
  match: Match,
  fixedDeltaSeconds: number,
  p1Steer: number,
  p2Steer: number,
): StepResult {
  result.p1 = 'idle';
  result.p2 = 'idle';
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;
  result.p1 = stepCar(match.track, match.p1, p1Steer, fixedDeltaSeconds);
  result.p2 = stepCar(match.track, match.p2, p2Steer, fixedDeltaSeconds);

  if (result.p1 === 'home' || result.p2 === 'home' || match.elapsed >= ROUND_SECONDS) {
    const outcome = judge(match);
    if (outcome !== null) {
      match.phase = 'over';
      match.winner = outcome;
    }
  }
  return result;
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks at the road. Between them it holds the line it last chose,
   * exactly as a driver whose eyes are still on the last gate would.
   */
  readonly reaction: number;
  /** Magnitude of the random extra added to that delay, so it is never metronomic. */
  readonly waver: number;
  /** Chance a look comes out a slot wide of the gap — it read the barrier, not the way through. */
  readonly blunder: number;
}

/**
 * How far up the road a bot reads.
 *
 * Below {@link VISIBLE_AHEAD}, and that is rule 6 made arithmetic: the bot is the worse
 * informed of the two drivers at every moment of the race. It is also what makes the
 * wind-up bite on a bot exactly as it does on a person: at a standing start this much road
 * is nearly two seconds of warning against a gate change that takes half of one, and at
 * full speed it is under a second. Every tier therefore climbs until the track outruns its
 * reading and starts clipping there — which is the same wall a person hits, at a different
 * speed.
 */
export const BOT_LOOKAHEAD = 620;

/**
 * The three tiers, expressed only as reaction delay, waver and blunder rate.
 *
 * No tier gets a faster car, a longer look up the road, quicker steering or anything else
 * a player cannot have (rule 6). What separates them is how often they are still holding
 * the last gate's answer when the next one arrives, and how often the answer is wrong.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.5, waver: 0.3, blunder: 0.3 },
  normal: { reaction: 0.26, waver: 0.14, blunder: 0.12 },
  hard: { reaction: 0.11, waver: 0.05, blunder: 0.015 },
});

/**
 * Floats a bot spends on every look, whatever it goes on to decide.
 *
 * Asserted by a test that counts them. See {@link botAim} for why a variable count is a
 * seat bias rather than a detail.
 */
export const BOT_DRAWS_PER_LOOK = 3;

export interface BotState {
  /** Seconds until it looks at the road again. */
  look: number;
  /** The line it settled on at the last look, which it holds until the next one. */
  want: number;
}

export function createBotState(): BotState {
  return { look: 0, want: 0 };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.want = 0;
}

/**
 * Where across the road a driver should be, reading `lookahead` units of their own road.
 *
 * The nearest barrier inside that window decides it; a clear stretch means the middle of
 * the road, which is the best place to wait because it is never more than two slots from
 * any gate. This is exactly what a player reads off their own half, and passing the depth
 * in is what keeps the bot honest — it calls this with {@link BOT_LOOKAHEAD}, which is
 * less than the {@link VISIBLE_AHEAD} a person can see (rule 6).
 *
 * The cell the car is *in* counts, so a driver already inside a barrier is told to hold
 * the gap rather than to relax. The barrier it has just been caught by does not, because
 * that one can no longer touch it and a car steering for a gap it is already past is a car
 * pointing the wrong way for the next one.
 */
export function readLine(match: Readonly<Match>, seat: SeatId, lookahead: number): number {
  const car = seat === 'p1' ? match.p1 : match.p2;
  const from = cellOf(car.distance);
  const to = cellOf(car.distance + lookahead);
  for (let cell = from; cell <= to; cell += 1) {
    if (cell === car.hitCell) continue;
    const gate = gateAt(match.track, cell);
    if (gate !== CLEAR) return slotAcross(gateSlot(gate));
  }
  return 0;
}

/**
 * Where a bot is steering for this step.
 *
 * A point across the road, never a direction: a bot names a line the way a finger resting
 * on the glass does, and {@link steerFor} is what turns that into steering. It has no way
 * to cross the road sooner than a person because there is no such way.
 *
 * **All three draws are taken on every look whether or not they are used.** A seat whose
 * draw count depends on what it decided shifts the other seat's stream, and that is a seat
 * bias rather than a coincidence — Fruit Duel gave p1 thirty wins in forty from exactly
 * that, in a game with no seat asymmetry anywhere in its rules. Three floats a look,
 * unconditionally, and `rules.test.ts` counts them.
 */
export function botAim(
  match: Readonly<Match>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): number {
  state.look -= fixedDeltaSeconds;
  if (state.look > 0) return state.want;

  const profile = BOT_PROFILES[difficulty];
  const waver = rng.float();
  const slip = rng.float();
  const side = rng.float();
  state.look = profile.reaction + waver * profile.waver;

  const line = readLine(match, seat, BOT_LOOKAHEAD);
  // A blunder is a slot's worth of misread — the barrier beside the gap rather than the
  // gap. Steering the car somewhere random would be a different game; being one lane out
  // is what a driver who glanced too late actually does.
  state.want = slip < profile.blunder ? line + (side < 0.5 ? -SLOT_PITCH : SLOT_PITCH) : line;
  return state.want;
}
