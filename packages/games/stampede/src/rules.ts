import { resolve } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Stampede, as pure rules.
 *
 * A lane each. Beasts charge across it from the left or from the right; the runner stands
 * in the middle of its own lane and never moves. One press puts it in the air, and a beast
 * that passes underneath a runner in the air costs nothing. A beast that reaches a runner
 * standing on the ground bowls it over.
 *
 * No rendering, no timing, no DOM. The bot, the balance harness and the tests all reuse
 * this module.
 *
 * ## The five decisions this file exists to record
 *
 * **The simulation is written in seconds, not in lane units.** A hazard is an `arrival`
 * time and a `speed`; where it is drawn is `RUNNER_X + dir · (clock − arrival) · speed`,
 * evaluated fresh whenever anybody asks. Nothing is integrated, so there is no numeric
 * position for the bot's analytic reasoning to disagree with — the referee and the bot ask
 * the identical arithmetic the identical question (issue #2465, commit b4af006, five games).
 *
 * **A beast is dangerous for {@link DANGER_SECONDS}, whatever its speed.** The overlap of a
 * beast with the runner's column is fixed *in time*, and the beast's drawn length is derived
 * from it — a fast beast is drawn longer. That is what keeps the press window
 * {@link PRESS_WINDOW} constant across a course whose speed ramps by half again, so speeding
 * the course up makes it harder to *read* and never harder to *time*. See SPEC.md.
 *
 * **Both seats face one course.** {@link Game.hazards} is a single list and both runners
 * resolve against it with the same function. There is no per-seat geometry in this file at
 * all — {@link toBoardX} and {@link toBoardY} exist for `game.ts` to draw with and are read
 * by no rule — so seat symmetry is a property of the type rather than a number somebody
 * measured. `rules.test.ts` swaps the two runners and requires a bit-identical swap back.
 *
 * **A press is the whole vocabulary.** There is no position, no direction and no duration
 * anywhere in the input. `docs/input-parity.md` names a bare timestamped press as the one
 * thing a thumb, a trackpad and a key spell identically, and it is the only thing this game
 * reads.
 *
 * **The course is finite and its length is fixed before the first step.** {@link WAVES}
 * waves, generated once, resolved by the clock. Nothing a player does can add a beast or
 * hold one back, so the match ends whether or not anybody presses anything.
 */

/* ------------------------------------------------------------------------------------ */
/* The lane                                                                              */
/* ------------------------------------------------------------------------------------ */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/** One lane per seat, stacked. Each is the full width of the board and half its height. */
export const LANE_WIDTH = BOARD_WIDTH;
export const LANE_HEIGHT = BOARD_HEIGHT / 2;

/**
 * Lane-local coordinates.
 *
 * `x` runs across the lane from 0 to {@link LANE_WIDTH}; `y` runs *inward* from the seat's
 * own outer edge of the device toward the centre line. Both seats read the identical
 * numbers, which is the whole point: a beast entering at `x = 0` enters on the left for
 * whoever is reading that lane, whichever way up the device is being held.
 */
export const RUNNER_X = LANE_WIDTH / 2;

/** Half the runner's footprint along the lane. Only the danger geometry uses it. */
export const RUNNER_HALF = 18;

/** Drawn size of a runner. Never read by a rule. */
export const RUNNER_RADIUS = 30;

/** Where the ground line sits, measured inward from the seat's own edge. */
export const GROUND_Y = 150;

/** Apex of a jump, for drawing. The rules know a jump only as a length of time. */
export const JUMP_HEIGHT = 210;

/**
 * Lane-local to board coordinates.
 *
 * Seat two's lane is seat one's turned half a turn about the middle of the board, so
 * `toBoard(p2, x, y)` is exactly `(BOARD_WIDTH − bx, BOARD_HEIGHT − by)` of
 * `toBoard(p1, x, y)`. A test asserts that on a grid of points rather than trusting it.
 *
 * **No rule in this file calls either of these.** They are here because lane geometry is
 * simulation vocabulary and `game.ts` should not invent a second copy of it; a tie-break or
 * a threshold written in board coordinates is the exact defect the half-turn tests exist to
 * catch (Snowball Throw, Maze Paint).
 */
export function toBoardX(seat: SeatId, laneX: number): number {
  return seat === 'p1' ? laneX : BOARD_WIDTH - laneX;
}

export function toBoardY(seat: SeatId, laneY: number): number {
  return seat === 'p1' ? BOARD_HEIGHT - laneY : laneY;
}

/* ------------------------------------------------------------------------------------ */
/* Jumping, and what a beast is worth                                                    */
/* ------------------------------------------------------------------------------------ */

/**
 * How long a runner stays off the ground. The one number the whole game is measured in.
 */
export const AIR_SECONDS = 0.7;

/**
 * How long a beast overlaps the runner's column, whatever its speed.
 *
 * Constant *in time* by construction: {@link halfLength} derives the drawn beast from this
 * and its speed rather than the other way round. A course that speeds up therefore gives a
 * player less time to look and exactly as much time to press.
 */
export const DANGER_SECONDS = 0.4;
export const DANGER_HALF = DANGER_SECONDS / 2;

/**
 * The press window: how much slack a press has and still clear a lone beast.
 *
 * A jump covers a beast when the beast's whole danger interval sits inside the jump, so the
 * press may land anywhere in `AIR − DANGER` = 0.30 s — **eighteen frames wide, nine either
 * side of perfect**. That number is the reason the three bot tiers are a ladder rather than
 * three spellings of "nearly perfect": Cup Pong's first geometry left 0.046–0.062 s, all of
 * it inside four frames, and no bot tuning fixes a window whose floor is the frame rate.
 * A test asserts it stays at or above eight frames.
 */
export const PRESS_WINDOW = AIR_SECONDS - DANGER_SECONDS;

/** How long the runner needs its feet under it again before it can jump. */
export const RECOVER_SECONDS = 0.12;

/**
 * How long a bowled-over runner is on the floor.
 *
 * Deliberately short. A long one would turn every mistake into a run of them and make the
 * choice below unwinnable: the pair the course calls a `choice` is two beasts close enough
 * that one jump cannot cover both and far enough apart that two jumps cannot either, so
 * whichever you save you are knocked down by the other — and you must be up in time to jump
 * for the second one. 0.18 s leaves at least 0.16 s of press window on the tighter of the
 * two, which is nine frames. A test asserts it for every separation the course generates.
 */
export const STAGGER_SECONDS = 0.18;

/**
 * How near the top of a jump a beast has to pass for the clear to count as clean.
 *
 * The score's fine resolution and nothing else — it is the tie-break, never a point. Set so
 * that a bit over half of what is cleared is cleared clean, which is what makes it able to
 * separate two players level on points (measured per tier in SPEC.md).
 */
export const CLEAN_SECONDS = 0.075;

/** Render-only decays, kept in the simulation so both seats' pictures are stepped alike. */
export const FLASH_SECONDS = 0.35;
export const SPARK_SECONDS = 0.25;

/**
 * The two beasts, which differ in what they are worth and in nothing else.
 *
 * Same speed, same danger window, same press window. That is deliberate: when a pair forces
 * a choice, the choice is about *value* and never about timing, so it is a decision a player
 * makes by looking rather than a second reflex test. Rule 7 gives them different shapes as
 * well as different colours — a bull is taller and carries two horns, a goat one.
 */
export type Beast = 'bull' | 'goat';

export const BULL_VALUE = 2;
export const GOAT_VALUE = 1;

export function valueOf(beast: Beast): number {
  return beast === 'bull' ? BULL_VALUE : GOAT_VALUE;
}

/* ------------------------------------------------------------------------------------ */
/* The course                                                                            */
/* ------------------------------------------------------------------------------------ */

export const WAVES = 20;
/** Capacity, so a course is never allocated mid-match. Two beasts is the widest wave. */
export const MAX_HAZARDS = WAVES * 2;

/** Quiet before the first beast, so the shell's countdown is not the first thing you dodge. */
export const LEAD_IN = 2.2;

export const SPEED_START = 240;
export const SPEED_END = 380;

/** Time from the last beast of one wave to the first of the next. Ramps down. */
export const GAP_START = 2.3;
export const GAP_END = 1;

/**
 * A pincer: two beasts, one from each side, close enough that a single jump clears both.
 *
 * Every value is at or under {@link PRESS_WINDOW}, so one jump always suffices; what it
 * costs is the slack, which falls to `PRESS_WINDOW − separation`. 0.17 s at the widest is
 * still ten frames.
 */
export const PINCER_SEPARATIONS: readonly number[] = Object.freeze([0, 0.07, 0.13]);

/**
 * A choice: two beasts you cannot both clear, so you take the one worth more.
 *
 * Every value is strictly above `PRESS_WINDOW` (0.30, so one jump cannot cover both) and
 * strictly below `DANGER_SECONDS + RECOVER_SECONDS` (0.52, so a second jump cannot be got
 * off in time either). Exactly one of the two is savable, and which one is worth more is
 * drawn fresh — the pair is always one bull and one goat, in either order.
 */
export const CHOICE_SEPARATIONS: readonly number[] = Object.freeze([0.34, 0.4, 0.46]);

/** Share of waves that are a pincer, and a choice, from the first wave to the last. */
export const PINCER_SHARE_START = 0.1;
export const PINCER_SHARE_END = 0.3;
export const CHOICE_SHARE_START = 0.12;
export const CHOICE_SHARE_END = 0.45;

/** How often a beast that is not part of a choice is the one worth two. */
export const BULL_SHARE = 0.4;

/**
 * How long before a beast reaches the lane its dust is visible at the edge.
 *
 * The whole fairness argument for a reaction game rests on this plus the run across the
 * lane; SPEC.md states the total as a budget in seconds and argues it against the
 * measurement tolerance `docs/input-parity.md` sets. Short version: the smallest budget any
 * beast in the course allows is 1.79 s, and the largest difference two devices can have
 * about *when* a press happened is well under a tenth of that.
 */
export const WARN_SECONDS = 0.85;

export interface Hazard {
  /** Clock time at which the beast's centre reaches the runner's column. */
  arrival: number;
  /** Lane units a second. */
  speed: number;
  /** `+1` enters from the left and runs right; `−1` enters from the right. */
  dir: number;
  beast: Beast;
}

function createHazard(): Hazard {
  return { arrival: 0, speed: SPEED_START, dir: 1, beast: 'goat' };
}

/** Half the drawn beast, derived so that the drawn overlap *is* the danger window. */
export function halfLength(hazard: Readonly<Hazard>): number {
  return DANGER_HALF * hazard.speed - RUNNER_HALF;
}

/** Seconds before arrival at which the beast crosses into the lane. */
export function enterLead(hazard: Readonly<Hazard>): number {
  return (RUNNER_X + halfLength(hazard)) / hazard.speed;
}

/** Seconds before arrival at which there is something on screen to see. */
export function visibleLead(hazard: Readonly<Hazard>): number {
  return enterLead(hazard) + WARN_SECONDS;
}

/** Lane-local x of a beast's centre at a moment. Evaluated, never integrated. */
export function hazardX(hazard: Readonly<Hazard>, clock: number): number {
  return RUNNER_X + hazard.dir * (clock - hazard.arrival) * hazard.speed;
}

/* ------------------------------------------------------------------------------------ */
/* The runners                                                                           */
/* ------------------------------------------------------------------------------------ */

export interface Runner {
  jumping: boolean;
  /** Clock time of the press that launched the current jump. */
  jumpStart: number;
  recover: number;
  stagger: number;
  /** Index of the first hazard this runner has not yet settled with. */
  cursor: number;
  points: number;
  cleared: number;
  clean: number;
  hits: number;
  jumps: number;
  flash: number;
  spark: number;
}

function createRunner(): Runner {
  return {
    jumping: false,
    jumpStart: -AIR_SECONDS,
    recover: 0,
    stagger: 0,
    cursor: 0,
    points: 0,
    cleared: 0,
    clean: 0,
    hits: 0,
    jumps: 0,
    flash: 0,
    spark: 0,
  };
}

export function resetRunner(runner: Runner): void {
  runner.jumping = false;
  runner.jumpStart = -AIR_SECONDS;
  runner.recover = 0;
  runner.stagger = 0;
  runner.cursor = 0;
  runner.points = 0;
  runner.cleared = 0;
  runner.clean = 0;
  runner.hits = 0;
  runner.jumps = 0;
  runner.flash = 0;
  runner.spark = 0;
}

/** Whether a press right now would put this runner in the air. */
export function canJump(runner: Readonly<Runner>): boolean {
  return !runner.jumping && runner.recover <= 0 && runner.stagger <= 0;
}

/** How high off the ground, in lane units. Drawing only; the rules know only the clock. */
export function jumpHeight(runner: Readonly<Runner>, clock: number): number {
  if (!runner.jumping) return 0;
  const phase = (clock - runner.jumpStart) / AIR_SECONDS;
  if (phase <= 0 || phase >= 1) return 0;
  return JUMP_HEIGHT * 4 * phase * (1 - phase);
}

export interface Game {
  clock: number;
  /** How many of {@link Game.hazards} this course actually uses. */
  count: number;
  readonly hazards: Hazard[];
  /** Points a flawless run would take. Drawing only. */
  total: number;
  readonly p1: Runner;
  readonly p2: Runner;
  winner: SeatId | 'draw' | null;
}

export function createGame(): Game {
  const hazards: Hazard[] = [];
  for (let i = 0; i < MAX_HAZARDS; i += 1) hazards.push(createHazard());
  return {
    clock: 0,
    count: 0,
    hazards,
    total: 0,
    p1: createRunner(),
    p2: createRunner(),
    winner: null,
  };
}

export function runnerOf(game: Readonly<Game>, seat: SeatId): Runner {
  return seat === 'p1' ? game.p1 : game.p2;
}

function put(game: Game, arrival: number, speed: number, dir: number, beast: Beast): void {
  const hazard = game.hazards[game.count] as Hazard;
  hazard.arrival = arrival;
  hazard.speed = speed;
  hazard.dir = dir;
  hazard.beast = beast;
  game.count += 1;
  game.total += valueOf(beast);
}

/**
 * Lay out a whole stampede, once, before the first step.
 *
 * `rng` of `null` empties the course — the destroy path. An empty course is over before it
 * begins rather than never: {@link winnerOf} settles it as a draw, so no reachable state
 * can fail to terminate.
 *
 * The wave anchor advances from the **last** beast of a wave rather than from its first, so
 * the gap between waves is never eaten by a wave's own spread. An earlier version advanced
 * from the anchor and left 0.54 s between a choice's second beast and the next wave, which
 * is a second, accidental choice nobody designed.
 */
export function resetGame(game: Game, rng: Rng | null): void {
  game.clock = 0;
  game.winner = null;
  game.count = 0;
  game.total = 0;
  resetRunner(game.p1);
  resetRunner(game.p2);
  if (rng === null) return;

  let at = LEAD_IN;
  for (let wave = 0; wave < WAVES; wave += 1) {
    const along = WAVES === 1 ? 0 : wave / (WAVES - 1);
    const speed = SPEED_START + (SPEED_END - SPEED_START) * along;
    const choiceShare = CHOICE_SHARE_START + (CHOICE_SHARE_END - CHOICE_SHARE_START) * along;
    const pincerShare = PINCER_SHARE_START + (PINCER_SHARE_END - PINCER_SHARE_START) * along;
    const kind = rng.float();
    const dir = rng.bool() ? 1 : -1;
    let last = at;
    if (kind < choiceShare) {
      const separation = CHOICE_SEPARATIONS[rng.int(0, CHOICE_SEPARATIONS.length)] as number;
      const bullFirst = rng.bool();
      const secondDir = rng.bool() ? 1 : -1;
      put(game, at, speed, dir, bullFirst ? 'bull' : 'goat');
      put(game, at + separation, speed, secondDir, bullFirst ? 'goat' : 'bull');
      last = at + separation;
    } else if (kind < choiceShare + pincerShare) {
      const separation = PINCER_SEPARATIONS[rng.int(0, PINCER_SEPARATIONS.length)] as number;
      // Opposite sides always: a pincer is two beasts meeting on top of you, and two beasts
      // this close on the *same* side would be drawn overlapping each other.
      put(game, at, speed, dir, rng.bool(BULL_SHARE) ? 'bull' : 'goat');
      put(game, at + separation, speed, -dir, rng.bool(BULL_SHARE) ? 'bull' : 'goat');
      last = at + separation;
    } else {
      put(game, at, speed, dir, rng.bool(BULL_SHARE) ? 'bull' : 'goat');
    }
    at = last + GAP_START + (GAP_END - GAP_START) * along;
  }
}

/** When the last beast of the course is done with. Drawing and tests only. */
export function courseSeconds(game: Readonly<Game>): number {
  if (game.count === 0) return 0;
  return (game.hazards[game.count - 1] as Hazard).arrival + DANGER_HALF;
}

/* ------------------------------------------------------------------------------------ */
/* The step                                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * One fixed step for both runners.
 *
 * `pressP1` and `pressP2` are the whole of the input: one bit each, true on the step a
 * press landed. The two runners are advanced by the same function against the same course
 * and the same clock, in that order — and because nothing in {@link advance} or
 * {@link settle} reads which seat it is holding, swapping the two runners and the two bits
 * swaps the result exactly. `rules.test.ts` asserts it over five hundred scrambled boards.
 */
export function step(game: Game, dt: number, pressP1: boolean, pressP2: boolean): void {
  if (game.winner !== null) return;
  game.clock += dt;
  advance(game, game.p1, pressP1, dt);
  advance(game, game.p2, pressP2, dt);
  game.winner = winnerOf(game);
}

function advance(game: Game, runner: Runner, press: boolean, dt: number): void {
  if (runner.stagger > 0) runner.stagger = Math.max(0, runner.stagger - dt);
  if (runner.recover > 0) runner.recover = Math.max(0, runner.recover - dt);
  if (runner.flash > 0) runner.flash = Math.max(0, runner.flash - dt);
  if (runner.spark > 0) runner.spark = Math.max(0, runner.spark - dt);

  if (runner.jumping && game.clock - runner.jumpStart >= AIR_SECONDS) {
    runner.jumping = false;
    runner.recover = RECOVER_SECONDS;
  }
  if (press && canJump(runner)) {
    runner.jumping = true;
    runner.jumpStart = game.clock;
    runner.jumps += 1;
  }
  settle(game, runner);
}

/**
 * Settle every beast this runner has reached, in the order they arrive.
 *
 * A beast is cleared when its whole danger window has gone by without the runner ever
 * having been on the ground during it, and it strikes on the first step it finds the runner
 * on the ground. Both are decided by sampling the window at the fixed step, so the press
 * window is really a lattice — `DANGER_SECONDS` is twenty-four frames wide, so no beast can
 * pass between two steps, and a test asserts that.
 *
 * Window starts and window ends are both non-decreasing in the index, so settling in index
 * order settles them in the order they happen, and one cursor is enough. A runner already
 * on the floor is not knocked down again — the stagger is set, never extended, which is what
 * stops a dense wave pinning somebody there.
 */
function settle(game: Game, runner: Runner): void {
  const clock = game.clock;
  while (runner.cursor < game.count) {
    const hazard = game.hazards[runner.cursor] as Hazard;
    if (clock < hazard.arrival - DANGER_HALF) return;
    if (clock >= hazard.arrival + DANGER_HALF) {
      runner.cleared += 1;
      runner.points += valueOf(hazard.beast);
      const apex = runner.jumpStart + AIR_SECONDS / 2;
      if (Math.abs(hazard.arrival - apex) <= CLEAN_SECONDS) runner.clean += 1;
      runner.spark = SPARK_SECONDS;
      runner.cursor += 1;
      continue;
    }
    if (runner.jumping) return;
    runner.hits += 1;
    if (runner.stagger <= 0) runner.stagger = STAGGER_SECONDS;
    runner.flash = FLASH_SECONDS;
    runner.cursor += 1;
  }
}

/**
 * More points wins; level on points, more clean clears; level on both, a draw.
 *
 * The clean count is a tie-break and never a point, because a player who dodged more of the
 * herd has beaten one who dodged less however prettily. It is there for resolution: two
 * players of the same standard land on the same points total often enough to matter, and
 * SPEC.md has the measured draw rates with it and without.
 */
export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  if (game.p1.cursor < game.count || game.p2.cursor < game.count) return null;
  const byPoints = resolve(
    { kind: 'highest-when-time-expires' },
    { p1: game.p1.points, p2: game.p2.points },
    { timeExpired: true },
  );
  if (byPoints !== 'draw') return byPoints;
  return resolve(
    { kind: 'highest-when-time-expires' },
    { p1: game.p1.clean, p2: game.p2.clean },
    { timeExpired: true },
  );
}

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /** Triangular, `±this` at the extremes. The whole of how well a tier keeps a moment. */
  readonly pressError: number;
  /** How far past the beast it is planning for it will look for a second one. */
  readonly planHorizon: number;
  /** Chance a plan is abandoned outright. A person who simply did not see one. */
  readonly blunder: number;
}

/**
 * Three tiers, and every number in them was swept alone before it was shipped (SPEC.md).
 *
 * `pressError` is loose by the standards of the aiming games — Cup Pong's hardest tier is
 * 0.11 s — and it should be: those games stop a needle against a gauge, and this one asks a
 * player to watch both edges of a lane at once and pick a moment out of the air with nothing
 * to read it against. Every tier is at least twenty-eight frames wide end to end, so no tier
 * picks a moment more finely than a person can, which is rule 6 by construction.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ pressError: 0.56, planHorizon: 0.2, blunder: 0.16 }),
  normal: Object.freeze({ pressError: 0.38, planHorizon: 0.42, blunder: 0.07 }),
  hard: Object.freeze({ pressError: 0.24, planHorizon: 0.6, blunder: 0.02 }),
});

/** Values drawn per plan. Always this many, always before anything branches. */
export const BOT_DRAWS_PER_PLAN = 3;

export interface BotState {
  /** Hazard index this plan is for, or −1 for no plan. */
  target: number;
  /** Clock time it means to press. */
  at: number;
  /** This plan is a blunder: it presses nothing at all. */
  skip: boolean;
}

export function createBotState(): BotState {
  return { target: -1, at: 0, skip: false };
}

export function resetBotState(state: BotState): void {
  state.target = -1;
  state.at = 0;
  state.skip = false;
}

/** Whether there is anything on screen for this beast yet. Rule 6: nothing else is read. */
export function botCanSee(game: Readonly<Game>, hazard: Readonly<Hazard>): boolean {
  return game.clock >= hazard.arrival - visibleLead(hazard);
}

/**
 * The first beast this runner still has to do something about.
 *
 * Beasts before the cursor are settled. Of the rest, one already inside the jump the runner
 * is in the middle of needs no further plan, so it is skipped — which is what lets the bot
 * plan the *next* one while still in the air, exactly as a player would.
 */
export function nextUncovered(game: Readonly<Game>, runner: Readonly<Runner>): number {
  const airEnd = runner.jumpStart + AIR_SECONDS;
  for (let i = runner.cursor; i < game.count; i += 1) {
    const hazard = game.hazards[i] as Hazard;
    if (
      runner.jumping &&
      runner.jumpStart <= hazard.arrival - DANGER_HALF &&
      airEnd >= hazard.arrival + DANGER_HALF
    ) {
      continue;
    }
    return i;
  }
  return -1;
}

/**
 * Where a tier means to press for the beast at `index`, ignoring its own shaky hands.
 *
 * Three cases and they are the whole of the game's decision content:
 *
 * - **Two close enough for one jump** — centre the jump on the pair rather than on either.
 * - **Two far enough apart for two jumps** — take the first, but never so late that the
 *   second becomes unreachable. With the shipped course this branch never binds, because the
 *   gap between waves never falls under a second; it is here because it is the correct rule
 *   and a tightened course would need it, and SPEC.md says plainly that it is inert today.
 * - **Two that are neither** — a `choice`. Exactly one can be saved, so save the one worth
 *   more, and take the knock from the other. A tier that will not look this far ahead always
 *   saves the first one it sees, which is the right beast only half the time.
 *
 * Written entirely in arrival times and values. There is no lane coordinate anywhere in it,
 * and no seat: the same board hands the same answer to whichever runner asks.
 */
export function plannedPress(
  game: Readonly<Game>,
  index: number,
  profile: BotProfile,
): { at: number; target: number } {
  const hazard = game.hazards[index] as Hazard;
  const centred = hazard.arrival - AIR_SECONDS / 2;
  const next = index + 1;
  if (next >= game.count) return { at: centred, target: index };

  const partner = game.hazards[next] as Hazard;
  const apart = partner.arrival - hazard.arrival;
  if (apart > profile.planHorizon || !botCanSee(game, partner)) {
    return { at: centred, target: index };
  }
  if (apart <= PRESS_WINDOW) {
    return { at: (hazard.arrival + partner.arrival) / 2 - AIR_SECONDS / 2, target: index };
  }
  if (apart >= DANGER_SECONDS + RECOVER_SECONDS) {
    const latest = partner.arrival - DANGER_HALF - AIR_SECONDS - RECOVER_SECONDS;
    const earliest = hazard.arrival + DANGER_HALF - AIR_SECONDS;
    return { at: Math.max(earliest, Math.min(centred, latest)), target: index };
  }
  if (valueOf(partner.beast) > valueOf(hazard.beast)) {
    return { at: partner.arrival - AIR_SECONDS / 2, target: next };
  }
  return { at: centred, target: index };
}

/**
 * Whether this bot presses on this step.
 *
 * It **commits to a moment and counts down to it**; it never watches for a position. Cup
 * Pong's SPEC records why that distinction is worth a paragraph: a bot that waits for the
 * world to look right can wait for ever, and two `easy` seats found exactly that on the
 * second seed of its first harness run. A countdown cannot fail to expire, and if the moment
 * has already gone by the time the runner's feet are free it presses at once — which is a
 * real way for a person to be late rather than a way for a bot to cheat.
 *
 * It replans only when the beast it was planning for has been settled or covered, so it
 * draws {@link BOT_DRAWS_PER_PLAN} values per beast it means to jump for and never once a
 * step. A tier that deliberately gives up the earlier beast of a `choice` keeps its plan
 * while that beast runs it over, which is the point of the plan.
 */
export function botPress(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
): boolean {
  const profile = BOT_PROFILES[difficulty];
  const runner = runnerOf(game, seat);
  const next = nextUncovered(game, runner);
  if (next < 0) {
    state.target = -1;
    return false;
  }
  if (state.target < next) {
    if (!botCanSee(game, game.hazards[next] as Hazard)) {
      state.target = -1;
      return false;
    }
    // Three draws, unconditionally, before anything is decided: two make the triangular
    // press error and the third the blunder. A conditional draw count makes one seat's play
    // a function of which tier is sitting opposite (Cup Pong measured that shape, Star
    // Catcher paid 1.4 points of win rate for it).
    const half = profile.pressError / 2;
    const wobble = (rng.float() - 0.5) * profile.pressError + (rng.float() - 0.5) * half * 2;
    const skip = rng.float() < profile.blunder;
    const plan = plannedPress(game, next, profile);
    state.target = plan.target;
    state.at = plan.at + wobble;
    state.skip = skip;
  }
  if (state.skip) return false;
  if (game.clock < state.at) return false;
  return canJump(runner);
}
