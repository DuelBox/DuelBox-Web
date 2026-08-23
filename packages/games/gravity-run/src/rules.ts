import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Gravity Run, as pure rules.
 *
 * A lane each, a runner apiece, and one thing to say to it: which way is down. The runner
 * goes forward on its own and gets faster the longer it goes clean; blocks stand on the
 * floor and hang from the ceiling, and the only way past one is to be on the other
 * surface when it arrives. Clip one and you are flat on your face for nearly a second and
 * back to walking pace. First runner home wins.
 *
 * Four decisions shape everything below, and each is argued where it lives:
 *
 *  - **One course, read by both seats** ({@link fillCourse}). The two lanes are the same
 *    generated sequence rather than two draws from it, so they are identical in
 *    difficulty by construction rather than on average. Structural fairness, not tuned
 *    fairness.
 *  - **Gravity is real** ({@link stepRunner}). A flip does not teleport the runner across
 *    the lane; it reverses an acceleration and the runner falls. Crossing costs
 *    {@link CROSS_SECONDS}, which is what makes a flip a commitment rather than a button.
 *  - **A flip has a cadence** ({@link FLIP_COOLDOWN}). No instrument can flip faster than
 *    any other, so a mashed key, a held key and a thumb are worth exactly the same.
 *  - **Speed climbs with a clean run and resets when you are caught**
 *    ({@link runSpeed}). It is the genre's own instruction — run fast — and it is what
 *    decides a race between two players who can both read a lane.
 *
 * No rendering, no timing, no DOM. Every distance is a logical unit and every duration is
 * in simulated seconds.
 */

/** The logical box the two lanes are drawn into. Declared here so the manifest cannot drift. */
export const COURSE_WIDTH = 600;
export const COURSE_HEIGHT = 1000;

/**
 * Which surface gravity is pulling the runner towards.
 *
 * `FLOOR` is the edge of the lane nearest the player sitting at it, whichever seat that
 * is — the two lanes are point-symmetric, so both players' "down" is towards themselves.
 */
export const FLOOR = 1;
export const CEILING = -1;
export type Surface = typeof FLOOR | typeof CEILING;

/** A cell with nothing in it, and the value a block-carrying cell holds otherwise. */
export const CLEAR = 0;
/** A cell carries a block standing on the floor, hanging from the ceiling, or neither. */
export type Block = typeof CLEAR | Surface;

/**
 * What one seat is asking of its runner this step.
 *
 * Two shapes, because the two input families are best at different things.
 * {@link FLOOR} and {@link CEILING} are an **absolute** ask — "be on that one" — which is
 * what a finger and the up/down keys give. {@link FLIP} is a toggle, which is what the
 * action key gives and what the genre's own instruction says. {@link HOLD} is silence.
 */
export const HOLD = 0;
export const FLIP = 2;
export type Ask = typeof HOLD | typeof FLIP | Surface;

/**
 * How far the runner's centre travels between resting on the floor and resting on the
 * ceiling.
 *
 * The one vertical measurement the simulation has. The renderer adds
 * {@link RUNNER_RADIUS} either side of it to get the corridor it draws, and nothing else
 * about the picture reaches this file.
 */
export const RISE = 352;

/**
 * The runner's half-height.
 *
 * Cosmetic in the sense that no collision reads it — the whole body is accounted for by
 * {@link BLOCK_REACH}, which is measured against the runner's *centre*. It lives here
 * anyway so the drawing and the collision cannot drift apart: a renderer that chose its
 * own radius would draw a runner clipping blocks it passed and sailing through blocks it
 * hit.
 */
export const RUNNER_RADIUS = 24;

/**
 * Downward acceleration, in units a second a second.
 *
 * Chosen from the time it produces rather than from a feel: a rest-to-rest crossing takes
 * `sqrt(2 · RISE / GRAVITY)` = 0.34 s, and the part of it that matters —
 * {@link CROSS_SECONDS} — takes 0.26 s. Everything about how far ahead a player has to
 * read follows from those two numbers and the speed they are travelling at.
 */
export const GRAVITY = 6000;

/**
 * How far into the lane a block reaches, measured against the runner's centre.
 *
 * A floor block catches a runner whose centre is below this; a ceiling block catches one
 * whose centre is above `RISE - BLOCK_REACH`. At 210 of a 352-unit rise the two bands
 * **overlap by 68 units in the middle of the lane**, which is the point: there is no
 * height that is safe from both, so hovering in the middle — which is what flipping as
 * fast as the cadence allows produces — is not a way to avoid anything. It is also why a
 * cell never carries a block on both surfaces: that cell would have no way through, and a
 * rule a player cannot play around is not a rule, it is a coin toss.
 */
export const BLOCK_REACH = 210;

/**
 * Seconds before the surface a runner has just left can no longer reach it.
 *
 * The **late** bound on a crossing, and not the same thing as landing: a runner that
 * leaves the ceiling is clear of ceiling blocks as soon as its centre has fallen
 * {@link BLOCK_REACH}, long before it arrives at the floor. The fall needed is
 * `BLOCK_REACH` in either direction, so the two crossings cost exactly the same and which
 * surface you happen to be on is never an advantage.
 */
export const CROSS_SECONDS = Math.sqrt((2 * BLOCK_REACH) / GRAVITY);

/**
 * Seconds before the surface a runner is heading for can start to reach it.
 *
 * The **early** bound. A crossing begun too soon is caught by the block it was still
 * clearing, so a runner threading a switch has a window rather than a moment, and the
 * width of that window is what {@link SWITCH_GAP} exists to keep positive.
 */
export const COMMIT_SECONDS = Math.sqrt((2 * (RISE - BLOCK_REACH)) / GRAVITY);

/** How long a flip is locked out after the last one. See the note on input parity below. */
export const FLIP_COOLDOWN = 0.16;

/** How long a cell of course is. Blocks fill a whole cell, so this is also a block's width. */
export const CELL_LENGTH = 80;

/** Cells to the finish line. */
export const RACE_CELLS = 90;
export const RACE_DISTANCE = RACE_CELLS * CELL_LENGTH;

/**
 * Cells of course a player can see in front of their runner.
 *
 * Fixed by the drawing — the lane is a window on the course and this is how much of it
 * fits — and named here because the bot is held below it (rule 6): a bot reads
 * {@link BOT_LOOKAHEAD} cells where a person reads five.
 */
export const VISIBLE_CELLS = 5;

/** The first cells are always clear, so nobody is caught before they have looked. */
export const CALM_CELLS = 4;

/** How often a cell carries a block at the start of the course, and at the end. */
export const HAZARD_START = 0.28;
export const HAZARD_MAX = 0.7;
/** Added per cell, so the course thickens as the race runs. */
export const HAZARD_RAMP = 0.006;

/**
 * Clear cells the generator leaves between two blocks on opposite surfaces.
 *
 * Without it a course could ask for a crossing there was no room to make. With it every
 * switch has a **window**: a runner may begin the crossing while still over the block it
 * is clearing, and must only be out of that block's reach as it leaves the cell and clear
 * of the next block's reach as it arrives. The window is
 * `gap + COMMIT_SECONDS - CROSS_SECONDS` wide — 0.29 s at a walk and 0.096 s flat out,
 * about six frames of it — so it is open at every speed the ramp reaches.
 *
 * One clear cell is therefore enough, and `rules.test.ts` measures both halves of the
 * claim: a purely reactive player, one who waits for a block to be behind them before
 * moving, clears a hundred seeded courses at the bottom of the ramp and is caught
 * repeatedly at the top of it. What the ramp walks a runner towards is not an impossible
 * course; it is one that has to be committed to early.
 */
export const SWITCH_GAP = 1;

/**
 * Cells generated.
 *
 * A player reads {@link VISIBLE_CELLS} beyond their own position and the race stops the
 * instant somebody reaches {@link RACE_CELLS}, so this is the furthest index anybody can
 * ask for, plus two for comfort.
 */
export const COURSE_CELLS = RACE_CELLS + VISIBLE_CELLS + 2;

/** Units a second at a standing start, and at the top of the ramp. */
export const SPEED_SLOW = 240;
export const SPEED_FAST = 560;
/** Clean cells in a row before the runner is at full speed. */
export const STREAK_FULL = 22;

/** Seconds flat on the ground after clipping a block. */
export const STUMBLE_SECONDS = 0.9;

/**
 * The race is called on distance after this long.
 *
 * A second guarantee behind the first. Ninety cells ends a race between two runners that
 * are moving, and they always are — a runner goes forward on its own, so unlike
 * Lumberjack there is no such thing as a match nobody advances. This exists for the case
 * where something has gone wrong enough that they do not, and it is deliberately far
 * above the slowest measured pairing (two `easy` bots, 34 s). `roundSeconds` in the
 * manifest ends nothing at all — it prints a number on the catalogue card — so the
 * guarantee has to live here. See the note at the top of `termination.test.ts`.
 */
export const ROUND_SECONDS = 120;

/**
 * How likely the cell at `index` is to carry a block.
 *
 * Half the difficulty curve. At the start of the course a little over a quarter of cells
 * are blocked and the rest are a free run; by the seventieth it is at its ceiling and
 * almost every cell asks something. The speed ramp shortens the reading time over the
 * same stretch, so a clean run gets harder in two unrelated ways at once: less time to
 * read, and more to read.
 */
export function hazardChanceAt(index: number): number {
  const chance = HAZARD_START + index * HAZARD_RAMP;
  return chance > HAZARD_MAX ? HAZARD_MAX : chance;
}

/**
 * Fill a course from the seeded generator.
 *
 * **One course, read by both seats.** Two independently generated lanes would be fair
 * only on average, and a race is run once: a player who drew four switches in a row while
 * their opponent drew a clear straight has lost to the seed rather than to the other
 * player. Handing both seats the identical sequence deletes the question outright — the
 * two lanes are not similar in difficulty, they are the same cells in the same order —
 * and it is what makes this a race rather than two solo runs shown side by side.
 *
 * Two draws per cell, always, whether or not the first produces a block. Drawing the
 * surface only when it is needed works — the stream is deterministic either way — but it
 * couples the sequence of surfaces to the sequence of densities, so a tuning change to
 * the ramp would silently rearrange every course in the game.
 *
 * A block that would land on the opposite surface too soon after the last one is placed
 * on the **same** surface instead, rather than dropped: dropping it would thin the course
 * out exactly where it is meant to be thickest. See {@link SWITCH_GAP}.
 */
export function fillCourse(course: Int8Array, rng: Rng): void {
  let lastSurface: Surface = FLOOR;
  let lastIndex = -COURSE_CELLS;
  for (let index = 0; index < course.length; index += 1) {
    const roll = rng.float();
    const pick = rng.float();
    if (index < CALM_CELLS || roll >= hazardChanceAt(index)) {
      course[index] = CLEAR;
      continue;
    }
    let surface: Surface = pick < 0.5 ? FLOOR : CEILING;
    if (surface !== lastSurface && index - lastIndex <= SWITCH_GAP) surface = lastSurface;
    course[index] = surface;
    lastSurface = surface;
    lastIndex = index;
  }
}

/** What is in the cell at `index`, or {@link CLEAR} past the end of the course. */
export function blockAt(course: Int8Array, index: number): number {
  return course[index] ?? CLEAR;
}

/** Which cell a point on the course falls in. */
export function cellOf(distance: number): number {
  return Math.floor(distance / CELL_LENGTH);
}

/**
 * How fast a runner is going after `streak` clean cells.
 *
 * **This is the rule that decides the race, and it exists because a fixed speed does
 * not.** At a fixed speed the only thing that separates two runners is how many blocks
 * they clipped — both lanes are the same cells, and 0.9 s a fall times an integer is a
 * very coarse way to decide a race. Measured over 150 seeded races a pairing with the
 * ramp pinned flat:
 *
 * | flat speed | `hard` v `hard` drawn | `normal` v `normal` drawn |
 * |---|---|---|
 * | 240 (walk) | 25 of 150 | 19 of 150 |
 * | 400 (mid) | 36 of 150 | 33 of 150 |
 * | 560 (sprint) | 37 of 150 | 26 of 150 |
 * | **the ramp** | **2 of 150** | **0 of 150** |
 *
 * A ramp fixes it from both ends. Going well shortens the time you have to read what is
 * coming, so a clean run walks itself into a mistake; and because being caught puts the
 * runner back to walking pace, one clipped block costs the 0.9 s on the ground *and* the
 * twenty-two cells it takes to wind back up. The second cost is much the larger, and it
 * is what turns one mistake into a decided race.
 *
 * Ramped on the streak rather than on the distance covered, which was the other candidate
 * and is quietly worse: a distance ramp is identical for both seats at every moment, so
 * it changes when the race ends and never who wins it.
 *
 * What the top of the ramp costs is *earliness*. Below 302 units a second a cell lasts
 * longer than a crossing takes, so a player who simply waits until the block is behind
 * them makes it — that is the first four cells of the ramp, and a hundred seeded courses
 * are measured to confirm it. Above that the crossing has to be begun while the runner is
 * still over the block it is clearing, inside a window that closes from a third of a
 * second to about six frames at full speed. Nothing becomes impossible; everything
 * becomes early. Where each runner stops managing it is what separates them, and every
 * one of them — bot and person — finds that speed somewhere.
 */
export function runSpeed(streak: number): number {
  const along = streak >= STREAK_FULL ? 1 : streak / STREAK_FULL;
  return SPEED_SLOW + (SPEED_FAST - SPEED_SLOW) * along;
}

export interface Runner {
  /** How far along the course it has run. This, in cells, is the score. */
  distance: number;
  /** The cell it is in. Kept rather than recomputed so a crossing can be noticed. */
  cell: number;
  /** Its centre's height above the floor: 0 resting on the floor, {@link RISE} on the ceiling. */
  height: number;
  /** Vertical speed, positive towards the ceiling. */
  rise: number;
  /** Which surface gravity is pulling it towards. */
  pull: Surface;
  /** Seconds until it may flip again. */
  flipDelay: number;
  /** Clean cells in a row, which is what sets the speed. */
  streak: number;
  /** Seconds left on the ground; zero while running. */
  down: number;
  /** Blocks clipped, for the HUD and for the balance harness. */
  falls: number;
}

export function createRunner(): Runner {
  return {
    distance: 0,
    cell: 0,
    height: 0,
    rise: 0,
    pull: FLOOR,
    flipDelay: 0,
    streak: 0,
    down: 0,
    falls: 0,
  };
}

export function resetRunner(runner: Runner): void {
  runner.distance = 0;
  runner.cell = 0;
  runner.height = 0;
  runner.rise = 0;
  runner.pull = FLOOR;
  runner.flipDelay = 0;
  runner.streak = 0;
  runner.down = 0;
  runner.falls = 0;
}

export type Phase = 'running' | 'over';

export interface Match {
  /** The one course both seats are running. Allocated once; refilled on reset. */
  readonly course: Int8Array;
  readonly p1: Runner;
  readonly p2: Runner;
  /** Simulated seconds the race has run, so it can be called. */
  elapsed: number;
  phase: Phase;
  winner: SeatId | 'draw' | null;
}

export function createMatch(): Match {
  return {
    course: new Int8Array(COURSE_CELLS),
    p1: createRunner(),
    p2: createRunner(),
    elapsed: 0,
    phase: 'running',
    winner: null,
  };
}

/**
 * Put both runners back on the line, leaving the course as it is.
 *
 * Separate from {@link resetMatch} because tearing a match down is not the same as
 * starting one: `destroy` has to leave nothing behind, but generating a fresh course on
 * the way out would spend draws from the host's generator after the match they belong to
 * has finished.
 */
export function clearMatch(match: Match): void {
  resetRunner(match.p1);
  resetRunner(match.p2);
  match.elapsed = 0;
  match.phase = 'running';
  match.winner = null;
}

/** Start a fresh race on a newly generated course. The only place the course is written. */
export function resetMatch(match: Match, rng: Rng): void {
  fillCourse(match.course, rng);
  clearMatch(match);
}

export function runnerOf(match: Match, seat: SeatId): Runner {
  return seat === 'p1' ? match.p1 : match.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

/** How many whole cells a seat has cleared. This is what the scoreboard shows. */
export function cellsOf(match: Readonly<Match>, seat: SeatId): number {
  const runner = seat === 'p1' ? match.p1 : match.p2;
  return runner.cell > RACE_CELLS ? RACE_CELLS : runner.cell;
}

/** The other surface. */
export function opposite(surface: Surface): Surface {
  return surface === FLOOR ? CEILING : FLOOR;
}

/**
 * Whether a block at `block` catches a runner whose centre is at `height`.
 *
 * The whole collision rule, in one line, and the reason there is nothing else to it: a
 * block fills its cell from wall to wall along the course, so *where* in the cell the
 * runner is cannot matter — only how high.
 */
export function caughtBy(block: number, height: number): boolean {
  if (block === FLOOR) return height < BLOCK_REACH;
  if (block === CEILING) return height > RISE - BLOCK_REACH;
  return false;
}

/**
 * The surface a runner should be pulled towards, reading `lookahead` cells of its own lane.
 *
 * The first block within reach decides it; a clear stretch means stay where you are. This
 * is exactly what a player reads off their own lane, and passing the depth in is what
 * keeps the bot honest — it calls this with {@link BOT_LOOKAHEAD}, which is less than the
 * {@link VISIBLE_CELLS} a person can see (rule 6).
 *
 * The cell the runner is *in* counts, so a runner already past the leading edge of a block
 * is told to stay clear of it rather than to relax.
 */
export function readAhead(match: Readonly<Match>, seat: SeatId, lookahead: number): Surface {
  const runner = seat === 'p1' ? match.p1 : match.p2;
  for (let ahead = 0; ahead <= lookahead; ahead += 1) {
    const block = blockAt(match.course, runner.cell + ahead);
    if (block !== CLEAR) return block === FLOOR ? CEILING : FLOOR;
  }
  return runner.pull;
}

/** What one seat's runner did this step. */
export type Stride = 'idle' | 'flipped' | 'caught' | 'home';

export interface StepResult {
  readonly p1: Stride;
  readonly p2: Stride;
}

/** Rewritten in place rather than allocated, so a step costs no garbage (rule 5). */
const result: { p1: Stride; p2: Stride } = { p1: 'idle', p2: 'idle' };

/**
 * Pick a fallen runner up on the surface that its cell leaves open.
 *
 * Being caught costs time and rhythm and nothing else: the runner is not pushed back and
 * does not have to fight its way out. Without this it would come round facing the same
 * block from the same side and clip it again, which is not a harder game, it is a stuck
 * one.
 */
function recover(match: Match, runner: Runner): void {
  const safe = blockAt(match.course, runner.cell) === FLOOR ? CEILING : FLOOR;
  runner.pull = safe;
  runner.height = safe === FLOOR ? 0 : RISE;
  runner.rise = 0;
  runner.flipDelay = 0;
}

/**
 * Run one seat's runner for a step.
 *
 * `ask` is what that seat is asking for, or {@link HOLD} for nothing. Asking early is
 * free and does nothing at all — {@link FLIP_COOLDOWN} is the only thing that releases a
 * flip — so a caller may ask on every step without changing the rate.
 *
 * **That is what makes this game fair across input families.** The genre's instruction is
 * "tap to change gravity", and a game where taps move a runner is won by whoever's
 * instrument repeats fastest — a keyboard, always, by a margin no shared viewport or
 * precision envelope closes. Road Dodge met the same wall and answered it by declaring
 * `sameInputClassOnly`, which is the honest answer for a game whose whole interaction is
 * rapid discrete input. This one does not need to: a mashed key, a held key and a thumb
 * resting on the glass all flip at exactly {@link FLIP_COOLDOWN}, and mashing past that
 * buys nothing. What is left to be good at is *when* and *which way*, which every
 * instrument expresses equally well. **[ours]**
 */
export function stepRunner(
  match: Match,
  seat: SeatId,
  ask: Ask,
  fixedDeltaSeconds: number,
): Stride {
  const runner = seat === 'p1' ? match.p1 : match.p2;
  if (runner.distance >= RACE_DISTANCE) return 'idle';

  if (runner.down > 0) {
    runner.down -= fixedDeltaSeconds;
    if (runner.down > 0) return 'idle';
    // Snapped rather than carried over, so a recovery lands on a step boundary exactly
    // and the bar a renderer draws never runs past its own end.
    runner.down = 0;
    recover(match, runner);
    return 'idle';
  }

  if (runner.flipDelay > 0) {
    runner.flipDelay -= fixedDeltaSeconds;
    if (runner.flipDelay < 0) runner.flipDelay = 0;
  }

  // A toggle is resolved against the pull the runner has *now*, so two seats asking the
  // same way from opposite surfaces are asking for opposite things — which is what a
  // toggle means.
  const wanted: number = ask === FLIP ? -runner.pull : ask;
  let flipped = false;
  if (wanted !== HOLD && wanted !== runner.pull && runner.flipDelay <= 0) {
    runner.pull = wanted === FLOOR ? FLOOR : CEILING;
    runner.flipDelay = FLIP_COOLDOWN;
    flipped = true;
  }

  // Gravity. Semi-implicit: the acceleration lands before the position moves, so a flip
  // is felt on the step it is made rather than the one after.
  runner.rise += (runner.pull === CEILING ? GRAVITY : -GRAVITY) * fixedDeltaSeconds;
  runner.height += runner.rise * fixedDeltaSeconds;
  if (runner.height <= 0) {
    runner.height = 0;
    runner.rise = 0;
  } else if (runner.height >= RISE) {
    runner.height = RISE;
    runner.rise = 0;
  }

  runner.distance += runSpeed(runner.streak) * fixedDeltaSeconds;
  if (runner.distance >= RACE_DISTANCE) {
    runner.distance = RACE_DISTANCE;
    runner.cell = RACE_CELLS;
    return 'home';
  }

  const cell = cellOf(runner.distance);
  if (cell !== runner.cell) {
    runner.cell = cell;
    runner.streak += 1;
  }

  if (caughtBy(blockAt(match.course, cell), runner.height)) {
    runner.streak = 0;
    runner.falls += 1;
    runner.down = STUMBLE_SECONDS;
    runner.rise = 0;
    return 'caught';
  }

  return flipped ? 'flipped' : 'idle';
}

/**
 * One fixed step of the whole race.
 *
 * Both runners are stepped before either is judged, so a step in which both cross the
 * line is the dead heat it actually is rather than a win for whichever seat the loop
 * happened to run first.
 */
export function stepMatch(
  match: Match,
  fixedDeltaSeconds: number,
  p1Ask: Ask,
  p2Ask: Ask,
): StepResult {
  result.p1 = 'idle';
  result.p2 = 'idle';
  if (match.phase === 'over') return result;

  match.elapsed += fixedDeltaSeconds;
  result.p1 = stepRunner(match, 'p1', p1Ask, fixedDeltaSeconds);
  result.p2 = stepRunner(match, 'p2', p2Ask, fixedDeltaSeconds);

  const p1Home = match.p1.distance >= RACE_DISTANCE;
  const p2Home = match.p2.distance >= RACE_DISTANCE;
  if (p1Home || p2Home) {
    match.phase = 'over';
    match.winner = p1Home && p2Home ? 'draw' : p1Home ? 'p1' : 'p2';
  } else if (match.elapsed >= ROUND_SECONDS) {
    callOnTime(match);
  }
  return result;
}

/**
 * Call the race on distance.
 *
 * On distance rather than on the cell count the scoreboard prints: the count is the
 * distance rounded down, so calling on it would turn a race that reached the clock a
 * stride apart into a dead heat. Reached from {@link stepMatch} when the round clock
 * expires, rather than left to the host to remember, so a game class that forgot to look
 * at the clock still could not produce a race that never ends.
 */
export function callOnTime(match: Match): void {
  if (match.phase === 'over') return;
  match.phase = 'over';
  match.winner =
    match.p1.distance === match.p2.distance
      ? 'draw'
      : match.p1.distance > match.p2.distance
        ? 'p1'
        : 'p2';
}

export function winnerOf(match: Readonly<Match>): SeatId | 'draw' | null {
  return match.winner;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between looks at the lane. Between them it holds whatever surface it last
   * chose, exactly as a player whose eyes are still on the last block would.
   */
  readonly reaction: number;
  /** Magnitude of the random extra added to that delay, so it is never metronomic. */
  readonly waver: number;
  /** Chance a look comes out the wrong way round — it read the block on the wrong surface. */
  readonly blunder: number;
}

/**
 * How many cells ahead a bot reads.
 *
 * Below {@link VISIBLE_CELLS}, and that is rule 6 made arithmetic: the bot is the worse
 * informed of the two players at every moment of the race. It is also what makes the
 * speed ramp bite on a bot exactly as it does on a person — at the top of the ramp three
 * cells arrive in less time than a crossing takes, so every tier climbs until the course
 * outruns its reading and falls off there.
 */
export const BOT_LOOKAHEAD = 3;

/**
 * The three tiers, expressed only as reaction delay, waver and blunder rate.
 *
 * No tier gets a faster runner, a longer look down the lane, a shorter flip cadence or
 * anything else a player cannot have (rule 6). What separates them is how often they are
 * still holding the last block's answer when the next one arrives.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.4, waver: 0.24, blunder: 0.14 },
  normal: { reaction: 0.22, waver: 0.11, blunder: 0.05 },
  hard: { reaction: 0.11, waver: 0.05, blunder: 0.015 },
});

/**
 * Floats a bot spends on every look, whatever it goes on to decide.
 *
 * Asserted by a test that counts them. See {@link botAsk} for why a variable count is a
 * seat bias rather than a detail.
 */
export const BOT_DRAWS_PER_LOOK = 2;

export interface BotState {
  /** Seconds until it looks at the lane again. */
  look: number;
  /** The surface it settled on at the last look, which it holds until the next one. */
  want: Surface;
}

export function createBotState(): BotState {
  return { look: 0, want: FLOOR };
}

export function resetBotState(state: BotState): void {
  state.look = 0;
  state.want = FLOOR;
}

/**
 * Which surface a bot is asking for this step.
 *
 * Always a surface, never a toggle: a bot holds an absolute ask the way a finger resting
 * on the glass does, and {@link FLIP_COOLDOWN} is what turns that into flips. It has no
 * way to flip sooner than a person because there is no such way.
 *
 * **Both draws are taken on every look whether or not they are used.** A seat whose draw
 * count depends on what it decided shifts the other seat's stream, and that is a seat
 * bias rather than a coincidence — Fruit Duel gave p1 thirty wins in forty from exactly
 * that, in a game with no seat asymmetry anywhere in its rules. Two floats a look,
 * unconditionally, and `rules.test.ts` counts them.
 */
export function botAsk(
  match: Readonly<Match>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  fixedDeltaSeconds: number,
  rng: Rng,
): Surface {
  state.look -= fixedDeltaSeconds;
  if (state.look > 0) return state.want;

  const profile = BOT_PROFILES[difficulty];
  const waver = rng.float();
  const slip = rng.float();
  state.look = profile.reaction + waver * profile.waver;

  const read = readAhead(match, seat, BOT_LOOKAHEAD);
  state.want = slip < profile.blunder ? opposite(read) : read;
  return state.want;
}
