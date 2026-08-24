import type { Rng, SeatId } from '@duelbox/engine';
import { misjudgement, resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';

/**
 * Rat Race, as pure rules.
 *
 * Two rats run the same burrow. Holding the button runs, letting go brakes, and a cat's paw
 * slams down across the rails on a rhythm of its own — a rat caught under one is flattened,
 * knocked back and loses a second. Cheese lies along the way, on one rail or another, and it
 * is only picked up by a rat that runs over it. First to {@link TARGET_CHEESE} pieces wins;
 * if the clock runs out first, the fuller belly does.
 *
 * ## The burrow is one number long, and both rats run the same one **[ours]**
 *
 * A rat is a **distance and a speed**. Everything in the burrow — every paw, every crumb of
 * cheese — is a fixed course position drawn once from the match seed, and each seat carries
 * its own progress along it. Three things fall out of that and each of them would otherwise
 * have been work:
 *
 * - **It is exactly fair.** Neither seat can be dealt a kinder burrow than the other, because
 *   there is only one burrow. The two bands on screen are a drawing device.
 * - **The paws are shared.** A paw's rhythm is a function of the race clock, which both seats
 *   share, so both players watch the same paw fall at the same instant and neither is waiting
 *   on a private timer.
 * - **It is trivially deterministic.** The course is built once from the seeded generator and
 *   never touched again; a step integrates two numbers per rat and reads a modulo.
 *
 * No rendering, no timing, no DOM.
 */

/** Rails across the burrow. Three: enough that dodging a paw is a choice between two ways. */
export const RAILS = 3;

/**
 * How far up and down the burrow a rat can see, in course units.
 *
 * These are not decoration: the band draws exactly this window, so they are also the limit on
 * what a bot may read (CLAUDE.md rule 6). A bot whose lookahead exceeded {@link VIEW_AHEAD}
 * would be planning around a paw its opponent cannot see yet.
 */
export const VIEW_AHEAD = 820;
export const VIEW_BACK = 130;

/** Top speed, and how hard a rat accelerates and brakes. Units a second, and per second². */
export const RUN_SPEED = 285;
export const ACCEL = 640;
export const BRAKE = 980;

/**
 * Seconds to slide one rail.
 *
 * Sideways movement costs time, which is what makes "go round it" a decision rather than a
 * reflex: crossing two rails takes a third of a second, and a paw's open window is about a
 * second. Nothing in this game is instant except letting go.
 */
export const RAIL_SECONDS = 0.16;

/** Half a rat's width, in rails. Caught between two rails it clips both. */
export const RAT_HALF_RAIL = 0.34;

/** How near a piece of cheese must be, along the burrow and across it, to be picked up. */
export const CHEESE_REACH = 26;
export const CHEESE_RAIL_REACH = 0.45;

/** Pieces of cheese that win the race. */
export const TARGET_CHEESE = 16;

/** Half the length of the stretch a paw covers when it lands. */
export const PAW_REACH = 62;
/** Seconds a paw stays down, out of its own cycle. */
export const PAW_DOWN_SECONDS = 0.72;
/** Seconds of raised paw before it falls. Render draws the warning; the rules only time it. */
export const PAW_WARN_SECONDS = 0.32;
/** A paw's cycle, drawn per paw so the burrow has a rhythm rather than a metronome. */
export const PAW_PERIOD_MIN = 1.8;
export const PAW_PERIOD_MAX = 2.9;

/**
 * How wide a paw is, and why a third of them close the burrow completely.
 *
 * The first version had every paw cover one rail or two, so there was always a free rail and
 * the whole game came out in the steering: measured over 360 bot matches, a paw landed on a
 * rat **0.3 times a race**, every tier played the same, and the throttle — the one control the
 * observed rule names — did nothing at all.
 *
 * A paw across all three rails is what puts "press to run" back in the middle of the game. It
 * cannot be dodged, only *timed*: brake, watch the rhythm, and go the moment it lifts. It is
 * never unfair, because a rat can see one {@link VIEW_AHEAD} up the burrow and stops in under
 * fifty units, so there is always room to wait — waiting simply costs the race.
 */
export const PAW_GATE_CHANCE = 0.3;
export const PAW_PAIR_CHANCE = 0.34;

/** What being caught costs: a second and a bit flattened, and ground given back. */
export const STUN_SECONDS = 1.3;
export const KNOCKBACK = 150;

/** The clock. Every match ends here even if nobody ever presses anything. */
export const RACE_SECONDS = 75;

/**
 * How long the burrow is.
 *
 * Longer than any rat can possibly run inside the clock — `RACE_SECONDS * RUN_SPEED` is
 * 21,375 — so the end of the course is unreachable and no wrapping rule is needed. A test
 * pins the inequality rather than trusting the arithmetic to stay true.
 */
export const COURSE_LENGTH = 25_000;

/** Where the first paw and the first cheese sit, and how far apart the rest are drawn. */
const FIRST_PAW = 620;
/**
 * The closest two paws may be.
 *
 * Load-bearing twice over. It is wider than two paw bands plus a knockback, so a rat swatted
 * by one paw can never be thrown into another that is already down — a chain of swats would
 * be a countdown rather than a game. And it is wider than a rat's braking distance several
 * times over, so between any two paws there is always somewhere to stand and wait.
 */
const PAW_GAP_MIN = 430;
const PAW_GAP_MAX = 780;
const FIRST_CHEESE = 170;
const CHEESE_GAP_MIN = 185;
const CHEESE_GAP_MAX = 330;

/** A paw, and the rhythm it keeps. `rail` is the first of `span` rails it covers. */
export interface Paw {
  readonly position: number;
  readonly rail: number;
  readonly span: number;
  readonly period: number;
  /** Seconds added to the race clock before the cycle is read, so paws are not in step. */
  readonly phase: number;
}

/** One piece of cheese, on one rail. */
export interface Cheese {
  readonly position: number;
  readonly rail: number;
}

/** The burrow. Built once per match and read every step; the arrays are reused on reset. */
export interface Course {
  readonly paws: Paw[];
  readonly cheese: Cheese[];
}

export function createCourse(): Course {
  return { paws: [], cheese: [] };
}

/** How many rails a paw covers, from one seeded roll in [0, 1). */
export function pawSpan(roll: number): number {
  if (roll < PAW_GATE_CHANCE) return RAILS;
  if (roll < PAW_GATE_CHANCE + PAW_PAIR_CHANCE) return 2;
  return 1;
}

/**
 * Lay out a burrow from the seeded generator, in place.
 *
 * Both arrays come out sorted by position, which every scan in this module relies on: a rat
 * keeps an index into each and walks it forward as it runs, so a step never searches.
 */
export function buildCourse(course: Course, rng: Rng): void {
  course.paws.length = 0;
  course.cheese.length = 0;

  for (let position = FIRST_PAW; position < COURSE_LENGTH;) {
    const span = pawSpan(rng.float());
    // A single draw whatever the span, so the stream position never depends on the shape.
    const rail = rng.int(0, RAILS - span + 1);
    const period = PAW_PERIOD_MIN + rng.float() * (PAW_PERIOD_MAX - PAW_PERIOD_MIN);
    const phase = rng.float() * period;
    course.paws.push({ position, rail, span, period, phase });
    position += PAW_GAP_MIN + rng.float() * (PAW_GAP_MAX - PAW_GAP_MIN);
  }

  for (let position = FIRST_CHEESE; position < COURSE_LENGTH;) {
    course.cheese.push({ position, rail: rng.int(0, RAILS) });
    position += CHEESE_GAP_MIN + rng.float() * (CHEESE_GAP_MAX - CHEESE_GAP_MIN);
  }
}

/** Where a paw is in its cycle, in seconds from the moment it last came down. */
export function pawCycle(paw: Readonly<Paw>, seconds: number): number {
  const cycle = (seconds + paw.phase) % paw.period;
  return cycle < 0 ? cycle + paw.period : cycle;
}

/** Whether the paw is on the ground right now. */
export function pawIsDown(paw: Readonly<Paw>, seconds: number): boolean {
  return pawCycle(paw, seconds) < PAW_DOWN_SECONDS;
}

/** Seconds until this paw next lands. Zero while it is already down. */
export function secondsUntilPawFalls(paw: Readonly<Paw>, seconds: number): number {
  const cycle = pawCycle(paw, seconds);
  return cycle < PAW_DOWN_SECONDS ? 0 : paw.period - cycle;
}

/**
 * Whether the paw is down at any moment between two times.
 *
 * The one question worth asking about a paw, and the one both a player and a bot actually
 * ask: *will it be down while I am under it?* A rat crosses a paw's band in under half a
 * second, so this is a short interval against a cycle of two or three — cheap, exact, and it
 * needs no simulation of the future.
 */
export function pawDownDuring(paw: Readonly<Paw>, from: number, to: number): boolean {
  const end = to < from ? from : to;
  if (end - from >= paw.period) return true;
  const start = pawCycle(paw, from);
  if (start < PAW_DOWN_SECONDS) return true;
  // The next down window opens exactly at the cycle boundary, so reaching it is enough.
  return start + (end - from) >= paw.period;
}

/** Whether a paw covers the rail a rat's centre is on, allowing for how wide a rat is. */
export function pawHitsRail(paw: Readonly<Paw>, rail: number): boolean {
  const low = paw.rail - 0.5;
  const high = paw.rail + paw.span - 0.5;
  return rail + RAT_HALF_RAIL > low && rail - RAT_HALF_RAIL < high;
}

export function clampRail(rail: number): number {
  if (rail < 0) return 0;
  if (rail > RAILS - 1) return RAILS - 1;
  return rail;
}

/** How far a rat travels before it can stop, from a speed. */
export function stoppingDistance(speed: number): number {
  return (speed * speed) / (2 * BRAKE);
}

/** One rat. Everything about a seat's run lives here; nothing about who is driving it. */
export interface Rat {
  /** How far along the burrow, in course units. */
  distance: number;
  speed: number;
  /** Where it actually is across the rails — fractional while sliding. */
  rail: number;
  /** The rail it is sliding towards, always a whole rail. */
  railTarget: number;
  /** Seconds left flattened. Zero when it is running. */
  stun: number;
  /** Cheese carried, which is the score. */
  cheese: number;
  /** Times a paw has landed on it, for the HUD. */
  swats: number;
  /** First cheese and first paw still inside this rat's window. Walked, never searched. */
  cheeseHead: number;
  pawHead: number;
}

export function createRat(): Rat {
  return {
    distance: 0,
    speed: 0,
    rail: 1,
    railTarget: 1,
    stun: 0,
    cheese: 0,
    swats: 0,
    cheeseHead: 0,
    pawHead: 0,
  };
}

export function resetRat(rat: Rat): void {
  rat.distance = 0;
  rat.speed = 0;
  rat.rail = 1;
  rat.railTarget = 1;
  rat.stun = 0;
  rat.cheese = 0;
  rat.swats = 0;
  rat.cheeseHead = 0;
  rat.pawHead = 0;
}

export interface Race {
  readonly course: Course;
  readonly p1: Rat;
  readonly p2: Rat;
  /** Which pieces each rat has already carried off. One flag per cheese, per seat. */
  readonly p1Taken: boolean[];
  readonly p2Taken: boolean[];
  elapsed: number;
  winner: Outcome;
  over: boolean;
}

export function createRace(): Race {
  return {
    course: createCourse(),
    p1: createRat(),
    p2: createRat(),
    p1Taken: [],
    p2Taken: [],
    elapsed: 0,
    winner: null,
    over: false,
  };
}

/** A fresh burrow and two rats at the start of it. Reuses every array it can. */
export function resetRace(race: Race, rng: Rng): void {
  buildCourse(race.course, rng);
  resetRat(race.p1);
  resetRat(race.p2);
  race.p1Taken.length = race.course.cheese.length;
  race.p2Taken.length = race.course.cheese.length;
  race.p1Taken.fill(false);
  race.p2Taken.fill(false);
  race.elapsed = 0;
  race.winner = null;
  race.over = false;
}

export function ratOf(race: Readonly<Race>, seat: SeatId): Rat {
  return seat === 'p1' ? race.p1 : race.p2;
}

export function takenBy(race: Readonly<Race>, seat: SeatId): boolean[] {
  return seat === 'p1' ? race.p1Taken : race.p2Taken;
}

/** First to a full load of cheese. The clock settles anything still level at the end. */
export const WIN_CONDITION: WinCondition = { kind: 'first-to', target: TARGET_CHEESE };

/**
 * Scratch for {@link winnerOf}, which runs every step.
 *
 * The SDK's `resolve` takes a tally and an options record, and building either of them per
 * step would be a per-frame allocation in the middle of `update` (CLAUDE.md rule 5). The
 * empty `eliminated` list is passed for the same reason: `resolve` would otherwise default
 * it to a fresh array sixty times a second.
 */
const NOBODY: readonly SeatId[] = Object.freeze([]);
const tallyScratch = { p1: 0, p2: 0 };
const optionsScratch = { timeExpired: false, eliminated: NOBODY };

/** Who has won, or null while the race is live. */
export function winnerOf(race: Readonly<Race>): Outcome {
  tallyScratch.p1 = race.p1.cheese;
  tallyScratch.p2 = race.p2.cheese;
  optionsScratch.timeExpired = race.elapsed >= RACE_SECONDS;
  return resolve(WIN_CONDITION, tallyScratch, optionsScratch);
}

/** What happened on one step, for the renderer's flashes. Reused, never rebuilt. */
export interface StepReport {
  readonly swatted: SeatId[];
  readonly grabbed: SeatId[];
}

const swattedScratch: SeatId[] = [];
const grabbedScratch: SeatId[] = [];
const reportScratch: StepReport = { swatted: swattedScratch, grabbed: grabbedScratch };

/**
 * Advance the race by one fixed step.
 *
 * Both rats are stepped from the same state before either is judged, so two rats reaching a
 * full load on the same step is the dead heat it actually is rather than a win for whichever
 * seat this function happened to read first.
 */
export function step(
  race: Race,
  fixedDeltaSeconds: number,
  p1Running: boolean,
  p1Rail: number,
  p2Running: boolean,
  p2Rail: number,
): StepReport {
  swattedScratch.length = 0;
  grabbedScratch.length = 0;
  if (race.over) return reportScratch;

  race.elapsed += fixedDeltaSeconds;
  stepRat(race, 'p1', fixedDeltaSeconds, p1Running, p1Rail);
  stepRat(race, 'p2', fixedDeltaSeconds, p2Running, p2Rail);

  race.winner = winnerOf(race);
  if (race.winner !== null) race.over = true;
  return reportScratch;
}

function stepRat(
  race: Race,
  seat: SeatId,
  fixedDeltaSeconds: number,
  running: boolean,
  railWanted: number,
): void {
  const rat = ratOf(race, seat);

  if (rat.stun > 0) {
    // Flattened: no throttle, no steering, no ground gained. It is the whole cost.
    rat.stun -= fixedDeltaSeconds;
    if (rat.stun < 0) rat.stun = 0;
    rat.speed = 0;
  } else {
    rat.railTarget = clampRail(Math.round(railWanted));
    const travel = fixedDeltaSeconds / RAIL_SECONDS;
    const gap = rat.railTarget - rat.rail;
    if (Math.abs(gap) <= travel) rat.rail = rat.railTarget;
    else rat.rail += Math.sign(gap) * travel;

    rat.speed += (running ? ACCEL : -BRAKE) * fixedDeltaSeconds;
    if (rat.speed > RUN_SPEED) rat.speed = RUN_SPEED;
    if (rat.speed < 0) rat.speed = 0;
    rat.distance += rat.speed * fixedDeltaSeconds;
  }

  syncHeads(race.course, rat);
  collect(race, seat, rat);
  if (rat.stun <= 0) checkPaws(race, seat, rat);
}

/**
 * Walk both window indices to wherever the rat now is.
 *
 * Forwards as it runs and backwards when a paw throws it back, which is why these are two
 * loops rather than one: a knockback of {@link KNOCKBACK} units can put a piece of cheese
 * back inside the window, and an index that only ever advanced would step straight past it.
 */
function syncHeads(course: Readonly<Course>, rat: Rat): void {
  const from = rat.distance - VIEW_BACK;
  const cheese = course.cheese;
  let head = rat.cheeseHead;
  while (head < cheese.length && (cheese[head]?.position ?? Number.POSITIVE_INFINITY) < from) {
    head += 1;
  }
  while (head > 0 && (cheese[head - 1]?.position ?? Number.NEGATIVE_INFINITY) >= from) {
    head -= 1;
  }
  rat.cheeseHead = head;

  const paws = course.paws;
  let pawHead = rat.pawHead;
  while (pawHead < paws.length && (paws[pawHead]?.position ?? Number.POSITIVE_INFINITY) < from) {
    pawHead += 1;
  }
  while (pawHead > 0 && (paws[pawHead - 1]?.position ?? Number.NEGATIVE_INFINITY) >= from) {
    pawHead -= 1;
  }
  rat.pawHead = pawHead;
}

function collect(race: Race, seat: SeatId, rat: Rat): void {
  const cheese = race.course.cheese;
  const taken = takenBy(race, seat);
  for (let i = rat.cheeseHead; i < cheese.length; i += 1) {
    const piece = cheese[i];
    if (piece === undefined) break;
    if (piece.position > rat.distance + CHEESE_REACH) break;
    if (taken[i] === true) continue;
    if (piece.position < rat.distance - CHEESE_REACH) continue;
    if (Math.abs(rat.rail - piece.rail) > CHEESE_RAIL_REACH) continue;
    taken[i] = true;
    rat.cheese += 1;
    grabbedScratch.push(seat);
  }
}

function checkPaws(race: Race, seat: SeatId, rat: Rat): void {
  const paws = race.course.paws;
  for (let i = rat.pawHead; i < paws.length; i += 1) {
    const paw = paws[i];
    if (paw === undefined) break;
    if (paw.position - PAW_REACH > rat.distance) break;
    if (paw.position + PAW_REACH < rat.distance) continue;
    if (!pawIsDown(paw, race.elapsed)) continue;
    if (!pawHitsRail(paw, rat.rail)) continue;
    swat(rat);
    swattedScratch.push(seat);
    return;
  }
}

/**
 * What a paw does to a rat.
 *
 * The knockback is what makes a swat survivable rather than a loop: it is longer than a paw
 * band, so the rat always comes to rest outside the paw that hit it, and {@link PAW_GAP_MIN}
 * keeps it from landing inside the one behind.
 */
export function swat(rat: Rat): void {
  rat.stun = STUN_SECONDS;
  rat.speed = 0;
  rat.swats += 1;
  rat.distance -= KNOCKBACK;
  if (rat.distance < 0) rat.distance = 0;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Seconds between decisions. Between them it acts on what it last decided. */
  readonly reaction: number;
  /**
   * Seconds of clearance it insists on before running under a paw.
   *
   * Signed, and the easy tier's is **negative** on purpose: it does not merely react slowly,
   * it believes it has more time than it has, which is exactly how a person plays this before
   * they have learned a paw's rhythm. That is also why the tiers grade — a bot that is only
   * slower still waits for a genuinely safe gap and never gets hit.
   */
  readonly caution: number;
  /** How far up the burrow it plans, in course units. Never past {@link VIEW_AHEAD}. */
  readonly lookahead: number;
  /** Chance, per decision, that it bothers to weave for cheese rather than run straight. */
  readonly greed: number;
  /**
   * How much of its own run-up it accounts for, from 0 to 1.
   *
   * A rat standing at the edge of a closed paw needs about a fifth of a second longer to cross
   * than a rat already at full pelt, because it has to get going first. A bot at 0 does not
   * know that and dashes on a gap that was never wide enough; a bot at 1 works it out exactly.
   * **This is the lever that separates the top two tiers**, and it had to be invented: with
   * caution alone, `hard` avoided four swats a race that `normal` took and still finished no
   * sooner, because the extra caution cost it at every gate exactly what the swats cost
   * `normal`. Being careful is not the same as being right about the arithmetic.
   */
  readonly windup: number;
  /**
   * How far its read of a paw's rhythm can be out, in seconds.
   *
   * Drawn once per decision and **held** until the next one. A fresh error every step would
   * average to zero sixty times a second and every tier would play the same — the mistake
   * `@duelbox/game-sdk`'s bot-judgement notes were written about.
   */
  readonly slip: number;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.4, caution: -0.14, windup: 0, lookahead: 380, greed: 0.2, slip: 0.3 },
  normal: { reaction: 0.2, caution: 0.04, windup: 0.55, lookahead: 600, greed: 0.6, slip: 0.14 },
  hard: { reaction: 0.09, caution: 0.08, windup: 1, lookahead: 800, greed: 0.9, slip: 0.05 },
});

/** What a bot carries between decisions: the decision itself, and the error it made. */
export interface BotState {
  cooldown: number;
  running: boolean;
  rail: number;
  slip: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, running: true, rail: 1, slip: 0 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.running = true;
  state.rail = 1;
  state.slip = 0;
}

/**
 * Values a bot draws per decision, always exactly this many.
 *
 * All three are drawn before anything is decided. A seat whose draw count depended on what it
 * chose would shift its own stream by how it played, and a replay would not be a replay.
 */
export const BOT_DRAWS_PER_DECISION = 3;

/**
 * How much a bot's reaction wanders, as a fraction of it.
 *
 * **Without this two equal bots dead-heat.** Both rats run one burrow from one start, so two
 * bots of the same tier take the same cheese at the same instant and cross the line on the
 * same step: measured before this existed, `hard` against `hard` drew thirty of forty matches.
 * A wander in *when it looks* is the smallest thing that separates them and the most honest —
 * it is what separates two people of the same ability — and it costs no tier any pace.
 */
export const REACTION_WANDER = 0.18;

/** Slowest speed a bot plans a rail change against, so a stopped rat still plans. */
const PLAN_SPEED_FLOOR = 40;
/** Slack on a rail change, in seconds, so a change that only just fits is still tried. */
const RAIL_GRACE = 0.03;
/** Units of margin a bot leaves itself when braking, standing in for its own reaction. */
const BRAKE_MARGIN = 22;
/** What a clear rail is worth against a piece of cheese and against the cost of reaching it. */
const SCORE_CLEAR = 100;
const SCORE_CHEESE = 30;
const SCORE_REACH = 10;

/**
 * How long a rat takes to cover a distance from its current speed, run-up included.
 *
 * Exact rather than sampled: it accelerates at {@link ACCEL} until it reaches
 * {@link RUN_SPEED} and holds it, so the answer is a quadratic and then a division.
 */
export function travelSeconds(distance: number, speed: number): number {
  if (distance <= 0) return 0;
  const toTop = Math.max(0, (RUN_SPEED - speed) / ACCEL);
  const ramp = speed * toTop + 0.5 * ACCEL * toTop * toTop;
  if (distance <= ramp) {
    return (Math.sqrt(speed * speed + 2 * ACCEL * distance) - speed) / ACCEL;
  }
  return toTop + (distance - ramp) / RUN_SPEED;
}

/** A bot's own estimate of that, from a tier that accounts for `windup` of its run-up. */
function estimateSeconds(distance: number, speed: number, windup: number): number {
  if (distance <= 0) return 0;
  const flat = distance / RUN_SPEED;
  return flat + (travelSeconds(distance, speed) - flat) * windup;
}

/**
 * Whether a rat could run this paw's stretch without it landing on them.
 *
 * The whole of the game's judgement in three lines: work out when this rat would enter and
 * leave the paw's band, and ask whether the paw is down at any point in between. `caution`
 * widens the window it demands at both ends; `windup` decides whether it remembers that a
 * standing start is slower than a running one.
 */
export function canPass(
  paw: Readonly<Paw>,
  rat: Readonly<Rat>,
  seconds: number,
  caution: number,
  windup: number,
): boolean {
  const enter = estimateSeconds(paw.position - PAW_REACH - rat.distance, rat.speed, windup);
  const leave = estimateSeconds(paw.position + PAW_REACH - rat.distance, rat.speed, windup);
  return !pawDownDuring(paw, seconds + enter - caution, seconds + leave + caution);
}

/** The nearest paw a rat has not yet run clear of, within `lookahead`, or null. */
export function nextPaw(
  course: Readonly<Course>,
  rat: Readonly<Rat>,
  lookahead: number,
): Paw | null {
  const paws = course.paws;
  for (let i = rat.pawHead; i < paws.length; i += 1) {
    const paw = paws[i];
    if (paw === undefined) break;
    if (paw.position - PAW_REACH > rat.distance + lookahead) break;
    if (paw.position + PAW_REACH <= rat.distance) continue;
    return paw;
  }
  return null;
}

/**
 * The nearest paw ahead that would land on a rat running this rail, or null when the rail is
 * clear as far as this bot looks.
 */
export function blockingPaw(
  course: Readonly<Course>,
  rat: Readonly<Rat>,
  rail: number,
  seconds: number,
  profile: BotProfile,
): Paw | null {
  const lookahead = profile.lookahead;
  const paws = course.paws;
  for (let i = rat.pawHead; i < paws.length; i += 1) {
    const paw = paws[i];
    if (paw === undefined) break;
    if (paw.position - PAW_REACH > rat.distance + lookahead) break;
    if (paw.position + PAW_REACH <= rat.distance) continue;
    if (!pawHitsRail(paw, rail)) continue;
    if (canPass(paw, rat, seconds, profile.caution, profile.windup)) continue;
    return paw;
  }
  return null;
}

/**
 * What a rail's cheese is worth to a rat, within `lookahead`.
 *
 * Two things it is deliberately not. It is not a *count*: counting had the hard tier, which
 * looks furthest, chase a rail with two crumbs at the far end of its window and skip the one
 * under its nose — it covered 5,537 units to collect twelve pieces where the shorter-sighted
 * `normal` needed 4,743, so seeing further made it measurably worse. Nearness squared fixes
 * the ordering: what is close counts, what is distant barely does, and a longer look becomes
 * a tie-break rather than a distraction.
 *
 * And it does not count what the rat cannot reach. A crumb twenty units ahead on the far rail
 * is not cheese, it is a rail change that arrives too late.
 */
export function cheeseValue(
  race: Readonly<Race>,
  seat: SeatId,
  rail: number,
  lookahead: number,
): number {
  const rat = ratOf(race, seat);
  const cheese = race.course.cheese;
  const taken = takenBy(race, seat);
  const reach = Math.abs(rail - rat.rail) * RAIL_SECONDS;
  let value = 0;
  for (let i = rat.cheeseHead; i < cheese.length; i += 1) {
    const piece = cheese[i];
    if (piece === undefined) break;
    const gap = piece.position - rat.distance;
    if (gap > lookahead) break;
    if (taken[i] === true) continue;
    if (gap < -CHEESE_REACH) continue;
    if (piece.rail !== rail) continue;
    if (gap / RUN_SPEED + RAIL_GRACE < reach) continue;
    const nearness = 1 - Math.max(0, gap) / lookahead;
    value += nearness * nearness;
  }
  return value;
}

/**
 * Decide, at most once every `reaction` seconds, whether to run and which rail to run on.
 *
 * It reads its own rat, the paws and the cheese inside its lookahead, and the race clock —
 * every one of them drawn on the screen its opponent is looking at, and none of them further
 * up the burrow than {@link VIEW_AHEAD}. That is CLAUDE.md rule 6 in full: the hard tier is
 * better because it looks more often, judges a rhythm more accurately and is willing to wait,
 * not because it can see round a corner.
 */
export function botDecide(
  race: Readonly<Race>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): void {
  state.cooldown -= fixedDeltaSeconds;
  if (state.cooldown > 0) return;
  // Every draw happens before any branch. See BOT_DRAWS_PER_DECISION.
  const slipRoll = rng.float();
  const greedRoll = rng.float();
  const wanderRoll = rng.float();
  state.cooldown = profile.reaction * (1 + misjudgement(wanderRoll, REACTION_WANDER));
  state.slip = misjudgement(slipRoll, profile.slip);

  const rat = ratOf(race, seat);
  if (rat.stun > 0) {
    // Flattened. It will be up in a moment and it means to keep running when it is.
    state.running = true;
    return;
  }

  const clock = race.elapsed + state.slip;
  const lead = nextPaw(race.course, rat, profile.lookahead);
  const planSpeed = Math.max(rat.speed, PLAN_SPEED_FLOOR);
  const entryTime =
    lead === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (lead.position - PAW_REACH - rat.distance) / planSpeed);
  const wantsCheese = greedRoll < profile.greed;

  let best = rat.railTarget;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let rail = 0; rail < RAILS; rail += 1) {
    const reach = Math.abs(rail - rat.rail) * RAIL_SECONDS;
    const arrives = reach <= entryTime + RAIL_GRACE;
    const clear = arrives && blockingPaw(race.course, rat, rail, clock, profile) === null;
    let score = clear ? SCORE_CLEAR : 0;
    if (wantsCheese) score += cheeseValue(race, seat, rail, profile.lookahead) * SCORE_CHEESE;
    score -= reach * SCORE_REACH;
    // A hair for staying put, so a tie does not become a twitch between two equal rails.
    if (rail === rat.railTarget) score += 1;
    if (score <= bestScore) continue;
    bestScore = score;
    best = rail;
  }
  state.rail = best;

  const paw = blockingPaw(race.course, rat, best, clock, profile);
  if (paw === null) {
    state.running = true;
    return;
  }
  const entry = paw.position - PAW_REACH;
  // Already under it: the way out is forwards, and standing still is the one certain way to
  // be hit. A bot that braked here would sit under the paw waiting for it.
  if (rat.distance >= entry) {
    state.running = true;
    return;
  }
  // Otherwise run until the last moment it could still stop short of the band.
  state.running = rat.distance + stoppingDistance(rat.speed) + BRAKE_MARGIN < entry;
}
