import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLOCK_REACH,
  BOT_DRAWS_PER_LOOK,
  BOT_LOOKAHEAD,
  BOT_PROFILES,
  CALM_CELLS,
  CEILING,
  CELL_LENGTH,
  CLEAR,
  COURSE_CELLS,
  COURSE_HEIGHT,
  COURSE_WIDTH,
  COMMIT_SECONDS,
  CROSS_SECONDS,
  FLIP,
  FLIP_COOLDOWN,
  FLOOR,
  HAZARD_MAX,
  HAZARD_START,
  HOLD,
  RACE_CELLS,
  RACE_DISTANCE,
  RISE,
  ROUND_SECONDS,
  SPEED_FAST,
  SPEED_SLOW,
  STREAK_FULL,
  STUMBLE_SECONDS,
  SWITCH_GAP,
  VISIBLE_CELLS,
  blockAt,
  botAsk,
  callOnTime,
  caughtBy,
  cellOf,
  cellsOf,
  clearMatch,
  createBotState,
  createMatch,
  fillCourse,
  hazardChanceAt,
  opposite,
  otherOf,
  readAhead,
  resetBotState,
  resetMatch,
  runSpeed,
  runnerOf,
  stepMatch,
  stepRunner,
  winnerOf,
} from './rules.js';
import type { Ask, BotDifficulty, Match, Surface } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

function started(seed = 1): { match: Match; rng: Rng } {
  const match = createMatch();
  const rng = new Rng(seed);
  resetMatch(match, rng);
  return { match, rng };
}

/**
 * A purely reactive player: hold the surface the nearest block in sight asks for, and
 * start the crossing only once the block being cleared is behind you.
 *
 * The weakest play that still reads the lane, and the yardstick the course is measured
 * against — see 'a course is always runnable' below.
 */
function reactive(match: Readonly<Match>, seat: SeatId): Surface {
  return readAhead(match, seat, VISIBLE_CELLS);
}

/** Run a whole course with both runners pinned to one speed, and count the falls. */
function fallsAtStreak(seed: number, streak: number): number {
  const match = createMatch();
  resetMatch(match, new Rng(seed));
  for (let i = 0; i < 60 * 300 && match.phase !== 'over'; i += 1) {
    match.p1.streak = streak;
    match.p2.streak = streak;
    stepMatch(match, STEP, reactive(match, 'p1'), reactive(match, 'p2'));
  }
  return match.p1.falls + match.p2.falls;
}

/** Step until `seat` is next caught, or give up. Returns the steps it took. */
function stepsUntilCaught(match: Match, seat: SeatId, ask: Ask, limit = 3600): number {
  for (let i = 0; i < limit; i += 1) {
    const outcome = stepMatch(match, STEP, seat === 'p1' ? ask : HOLD, seat === 'p2' ? ask : HOLD);
    if ((seat === 'p1' ? outcome.p1 : outcome.p2) === 'caught') return i;
  }
  return -1;
}

describe('the course', () => {
  it('starts with two runners on the line and nobody ahead', () => {
    const { match } = started();
    expect(match.p1.distance).toBe(0);
    expect(match.p2.distance).toBe(0);
    expect(match.p1.height).toBe(0);
    expect(match.p1.pull).toBe(FLOOR);
    expect(match.phase).toBe('running');
    expect(match.elapsed).toBe(0);
    expect(winnerOf(match)).toBeNull();
  });

  it('declares the box it is drawn into, so the manifest cannot drift from it', () => {
    expect(COURSE_WIDTH).toBeGreaterThan(0);
    expect(COURSE_HEIGHT).toBeGreaterThan(COURSE_WIDTH);
  });

  it('hands both seats the identical course', () => {
    // The structural fairness the whole game rests on, and the strongest form of it: the
    // two lanes are not similar in difficulty, they are one array read twice.
    const { match } = started(4242);
    expect(match.p1.cell).toBe(match.p2.cell);
    for (let cell = 0; cell < COURSE_CELLS; cell += 1) {
      match.p1.cell = cell;
      match.p2.cell = cell;
      expect(readAhead(match, 'p1', VISIBLE_CELLS)).toBe(readAhead(match, 'p2', VISIBLE_CELLS));
    }
  });

  it('names the other seat, the other surface and the right runner', () => {
    const { match } = started();
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
    expect(opposite(FLOOR)).toBe(CEILING);
    expect(opposite(CEILING)).toBe(FLOOR);
    expect(runnerOf(match, 'p1')).toBe(match.p1);
    expect(runnerOf(match, 'p2')).toBe(match.p2);
  });

  it('opens clear, so nobody is caught before they have looked at it', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { match } = started(seed);
      for (let i = 0; i < CALM_CELLS; i += 1) expect(blockAt(match.course, i)).toBe(CLEAR);
    }
  });

  it('never puts a block on both surfaces of one cell', () => {
    // Not a rule that has to be enforced so much as one the representation makes
    // impossible — a cell holds one value. Asserted because the collision bands overlap,
    // so a cell that managed to carry both would have no way through it at all.
    const { match } = started(99);
    for (let i = 0; i < COURSE_CELLS; i += 1) {
      expect([CLEAR, FLOOR, CEILING]).toContain(blockAt(match.course, i));
    }
  });

  it('leaves room to cross between blocks on opposite surfaces', () => {
    // The generation invariant the runnability of the whole course rests on.
    for (let seed = 0; seed < 60; seed += 1) {
      const { match } = started(seed);
      let lastIndex = -1;
      let lastSurface = CLEAR;
      for (let i = 0; i < COURSE_CELLS; i += 1) {
        const block = blockAt(match.course, i);
        if (block === CLEAR) continue;
        if (lastSurface !== CLEAR && block !== lastSurface) {
          expect(i - lastIndex, `seed ${String(seed)} at cell ${String(i)}`).toBeGreaterThan(
            SWITCH_GAP,
          );
        }
        lastIndex = i;
        lastSurface = block;
      }
    }
  });

  it('runs far enough that nobody can read off the end of it', () => {
    expect(COURSE_CELLS).toBeGreaterThan(RACE_CELLS + VISIBLE_CELLS);
    expect(blockAt(new Int8Array(4), 99)).toBe(CLEAR);
    expect(blockAt(new Int8Array(4), -1)).toBe(CLEAR);
  });

  it('thickens as the race goes on, and stops at its ceiling', () => {
    expect(hazardChanceAt(0)).toBeCloseTo(HAZARD_START, 6);
    expect(hazardChanceAt(10)).toBeGreaterThan(hazardChanceAt(0));
    expect(hazardChanceAt(10_000)).toBe(HAZARD_MAX);
  });

  it('actually produces more blocks near the finish than near the line', () => {
    // The ramp is a claim about the generated course, not just about the function, so it
    // is measured over enough courses for the difference not to be one seed's luck.
    let early = 0;
    let late = 0;
    const course = new Int8Array(COURSE_CELLS);
    for (let seed = 0; seed < 40; seed += 1) {
      fillCourse(course, new Rng(seed));
      for (let i = CALM_CELLS; i < 24; i += 1) if (course[i] !== CLEAR) early += 1;
      for (let i = COURSE_CELLS - 20; i < COURSE_CELLS; i += 1) if (course[i] !== CLEAR) late += 1;
    }
    expect(late).toBeGreaterThan(early * 1.4);
  });

  it('is the same course for the same seed and a different one otherwise', () => {
    const a = new Int8Array(COURSE_CELLS);
    const b = new Int8Array(COURSE_CELLS);
    const c = new Int8Array(COURSE_CELLS);
    fillCourse(a, new Rng(7));
    fillCourse(b, new Rng(7));
    fillCourse(c, new Rng(8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('spends the same number of draws on a cell whatever comes out of it', () => {
    const counter = new Rng(11);
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return counter.float();
      },
    } as unknown as Rng;
    fillCourse(new Int8Array(COURSE_CELLS), counted);
    expect(draws).toBe(COURSE_CELLS * 2);
  });

  it('puts a point on the course in the cell it belongs to', () => {
    expect(cellOf(0)).toBe(0);
    expect(cellOf(CELL_LENGTH - 0.001)).toBe(0);
    expect(cellOf(CELL_LENGTH)).toBe(1);
    expect(cellOf(RACE_DISTANCE)).toBe(RACE_CELLS);
  });
});

describe('gravity', () => {
  it('carries the runner across in the time the constant says', () => {
    // {@link CROSS_SECONDS} is the number the whole course generator is sized against, so
    // it has to agree with what the simulation actually does — analytically and after the
    // fixed step has had its say.
    const { match } = started();
    let steps = 0;
    for (; steps < 600; steps += 1) {
      stepMatch(match, STEP, CEILING, HOLD);
      if (match.p1.height > BLOCK_REACH) break;
    }
    // Within two frames of the analytic figure; the fixed step's integration is very
    // slightly ahead of it, which is a fact about arithmetic rather than about the rules.
    expect(Math.abs(steps * STEP - CROSS_SECONDS)).toBeLessThan(2 * STEP);
  });

  it('costs the same in both directions', () => {
    // A course that was cheaper to cross one way than the other would make which surface
    // you happened to be standing on an advantage.
    const up = started(2);
    let rising = 0;
    for (; rising < 600 && up.match.p1.height <= BLOCK_REACH; rising += 1) {
      stepMatch(up.match, STEP, CEILING, HOLD);
    }
    const down = started(2);
    down.match.p1.height = RISE;
    down.match.p1.pull = CEILING;
    let falling = 0;
    for (; falling < 600 && down.match.p1.height >= RISE - BLOCK_REACH; falling += 1) {
      stepMatch(down.match, STEP, FLOOR, HOLD);
    }
    expect(rising).toBe(falling);
  });

  it('rests on the surface it is pulled to rather than passing through it', () => {
    const { match } = started();
    for (let i = 0; i < 120; i += 1) stepMatch(match, STEP, CEILING, HOLD);
    expect(match.p1.height).toBe(RISE);
    expect(match.p1.rise).toBe(0);
    for (let i = 0; i < 120; i += 1) stepMatch(match, STEP, FLOOR, HOLD);
    expect(match.p1.height).toBe(0);
    expect(match.p1.rise).toBe(0);
  });

  it('leaves no height that is safe from both surfaces', () => {
    // Hovering in the middle is what flipping as fast as the cadence allows produces, and
    // it has to be a bad idea rather than an exploit. The two bands overlap, so there is
    // no gap between them to sit in.
    expect(BLOCK_REACH * 2).toBeGreaterThan(RISE);
    for (let height = 0; height <= RISE; height += 4) {
      expect(caughtBy(FLOOR, height) || caughtBy(CEILING, height)).toBe(true);
    }
    expect(caughtBy(CLEAR, 0)).toBe(false);
    expect(caughtBy(CLEAR, RISE)).toBe(false);
  });

  it('is only caught by a block on the surface it is on', () => {
    expect(caughtBy(FLOOR, 0)).toBe(true);
    expect(caughtBy(FLOOR, RISE)).toBe(false);
    expect(caughtBy(CEILING, RISE)).toBe(true);
    expect(caughtBy(CEILING, 0)).toBe(false);
  });
});

describe('the cadence', () => {
  it('cannot be rushed, however often a flip is asked for', () => {
    // The input-parity rule, as an assertion. A player mashing a key and a player holding
    // one flip the identical number of times, because the lockout is the only thing that
    // releases a flip.
    const { match } = started();
    let flips = 0;
    for (let i = 0; i < 60; i += 1) {
      if (stepMatch(match, STEP, FLIP, HOLD).p1 === 'flipped') flips += 1;
    }
    expect(flips).toBeLessThanOrEqual(Math.ceil(1 / FLIP_COOLDOWN) + 1);
    expect(flips).toBeGreaterThan(1);
  });

  it('costs nothing to ask early', () => {
    // Asking on every step through a whole lockout must not delay, cancel or double the
    // flip that follows — a player leaning on a key is not making a mistake.
    const eager = started(3);
    const patient = started(3);
    for (let i = 0; i < 40; i += 1) stepMatch(eager.match, STEP, CEILING, HOLD);
    for (let i = 0; i < 40; i += 1) {
      stepMatch(patient.match, STEP, i === 0 ? CEILING : HOLD, HOLD);
    }
    expect(patient.match.p1.height).toBeCloseTo(eager.match.p1.height, 9);
  });

  it('answers an absolute ask that is already true with nothing at all', () => {
    const { match } = started();
    expect(stepMatch(match, STEP, FLOOR, HOLD).p1).toBe('idle');
    expect(match.p1.flipDelay).toBe(0);
  });

  it('reads a toggle against the pull the runner has now', () => {
    const { match } = started();
    expect(match.p1.pull).toBe(FLOOR);
    expect(stepMatch(match, STEP, FLIP, HOLD).p1).toBe('flipped');
    expect(match.p1.pull).toBe(CEILING);
  });
});

describe('being caught', () => {
  it('costs a second on the ground, the rhythm, and nothing else', () => {
    const { match } = started();
    match.course[CALM_CELLS] = FLOOR;
    match.p1.streak = STREAK_FULL;
    const caught = stepsUntilCaught(match, 'p1', HOLD);
    expect(caught).toBeGreaterThan(0);
    expect(match.p1.down).toBeCloseTo(STUMBLE_SECONDS, 9);
    expect(match.p1.streak).toBe(0);
    expect(match.p1.falls).toBe(1);
    expect(runSpeed(match.p1.streak)).toBe(SPEED_SLOW);
  });

  it('stops the runner dead until it is up again', () => {
    const { match } = started();
    match.course[CALM_CELLS] = FLOOR;
    expect(stepsUntilCaught(match, 'p1', HOLD)).toBeGreaterThan(0);
    const held = match.p1.distance;
    for (let i = 0; i < 30; i += 1) stepMatch(match, STEP, HOLD, HOLD);
    expect(match.p1.distance).toBe(held);
  });

  it('gets up on the surface its cell leaves open, without anybody pressing anything', () => {
    // Otherwise the runner comes round facing the same block from the same side and clips
    // it again, which is not a harder game, it is a stuck one.
    const { match } = started();
    match.course[CALM_CELLS] = FLOOR;
    expect(stepsUntilCaught(match, 'p1', HOLD)).toBeGreaterThan(0);
    for (let i = 0; i < 120 && match.p1.down > 0; i += 1) stepMatch(match, STEP, HOLD, HOLD);
    expect(match.p1.down).toBe(0);
    expect(match.p1.pull).toBe(CEILING);
    expect(match.p1.height).toBe(RISE);
    // And it is out of that cell without being caught by it a second time.
    for (let i = 0; i < 120; i += 1) stepMatch(match, STEP, HOLD, HOLD);
    expect(match.p1.falls).toBe(1);
  });

  it('counts each seat separately', () => {
    const { match } = started();
    match.course[CALM_CELLS] = FLOOR;
    for (let i = 0; i < 240; i += 1) stepMatch(match, STEP, HOLD, CEILING);
    expect(match.p1.falls).toBe(1);
    expect(match.p2.falls).toBe(0);
  });
});

describe('speed', () => {
  it('starts at a walk, ends at a sprint, and never overshoots either end', () => {
    expect(runSpeed(0)).toBe(SPEED_SLOW);
    expect(runSpeed(STREAK_FULL)).toBeCloseTo(SPEED_FAST, 9);
    expect(runSpeed(STREAK_FULL * 10)).toBeCloseTo(SPEED_FAST, 9);
    for (let streak = 1; streak <= STREAK_FULL; streak += 1) {
      expect(runSpeed(streak)).toBeGreaterThan(runSpeed(streak - 1));
    }
  });

  it('climbs a cell at a time on a clean run', () => {
    const { match } = started();
    for (let i = 0; i < 240; i += 1) stepMatch(match, STEP, reactive(match, 'p1'), HOLD);
    expect(match.p1.streak).toBeGreaterThan(4);
    expect(runSpeed(match.p1.streak)).toBeGreaterThan(SPEED_SLOW);
  });
});

describe('a course is always runnable', () => {
  /**
   * The claim, in two halves.
   *
   * A purely reactive player — one who waits until the block being cleared is behind them
   * before starting the crossing — clears every course at the bottom of the ramp, because
   * a cell lasts longer than a crossing takes down there. That is the guarantee a player
   * who has just picked the game up needs, and it is measured over a hundred courses.
   *
   * Higher up the ramp a cell arrives in less time than a crossing takes and the reactive
   * player runs out of room. What is left is a *window*: the crossing may be begun while
   * the runner is still over the block it is clearing, as long as it does not drop past
   * that block's reach before the block is behind it. The window is
   * `gap + COMMIT_SECONDS - CROSS_SECONDS` wide and it is open at every speed the ramp
   * reaches — 0.29 s at a walk, 0.096 s flat out, about six frames of it.
   *
   * So the ramp does not walk a runner towards something impossible. It walks them
   * towards something that has to be committed to *early*, which is a skill rather than a
   * wall, and where each player stops being able to do it in time is what separates them.
   */
  it('can be read purely reactively at the bottom of the ramp', () => {
    const safeSpeed = CELL_LENGTH / CROSS_SECONDS;
    expect(runSpeed(4)).toBeLessThan(safeSpeed);
    let falls = 0;
    for (let seed = 0; seed < 100; seed += 1) falls += fallsAtStreak(seed, 4);
    expect(falls).toBe(0);
  });

  it('leaves a window to commit to a crossing at every speed the ramp reaches', () => {
    const gap = (SWITCH_GAP * CELL_LENGTH) / SPEED_FAST;
    expect(gap + COMMIT_SECONDS - CROSS_SECONDS).toBeGreaterThan(4 * STEP);
    const walk = (SWITCH_GAP * CELL_LENGTH) / SPEED_SLOW;
    expect(walk + COMMIT_SECONDS - CROSS_SECONDS).toBeGreaterThan(
      gap + COMMIT_SECONDS - CROSS_SECONDS,
    );
  });

  it('does run out of room for a reactive player higher up', () => {
    // The other half of the claim, and the reason the ramp ends a race: a player who
    // waits for the block to be behind them is caught at speed, whatever they do.
    let falls = 0;
    for (let seed = 0; seed < 20; seed += 1) falls += fallsAtStreak(seed, STREAK_FULL);
    expect(falls).toBeGreaterThan(20);
  });
});

describe('winning', () => {
  it('is first to the finish line', () => {
    const { match } = started();
    match.p2.distance = RACE_DISTANCE - 1;
    stepMatch(match, STEP, HOLD, HOLD);
    expect(match.p2.distance).toBe(RACE_DISTANCE);
    expect(match.phase).toBe('over');
    expect(winnerOf(match)).toBe('p2');
    expect(cellsOf(match, 'p2')).toBe(RACE_CELLS);
  });

  it('is a draw when both cross on the same step', () => {
    const { match } = started();
    match.p1.distance = RACE_DISTANCE - 1;
    match.p2.distance = RACE_DISTANCE - 1;
    stepMatch(match, STEP, HOLD, HOLD);
    expect(winnerOf(match)).toBe('draw');
  });

  it('is called on distance when the clock runs out, and level is a draw', () => {
    const level = createMatch();
    resetMatch(level, new Rng(1));
    callOnTime(level);
    expect(winnerOf(level)).toBe('draw');

    const ahead = createMatch();
    resetMatch(ahead, new Rng(1));
    // A stride apart rather than a cell apart: the scoreboard rounds down, and calling on
    // the rounded number would turn a race that was decided into a dead heat.
    ahead.p1.distance = 400.5;
    ahead.p2.distance = 400;
    callOnTime(ahead);
    expect(winnerOf(ahead)).toBe('p1');
    expect(cellsOf(ahead, 'p1')).toBe(cellsOf(ahead, 'p2'));
  });

  it('leaves an already-decided race alone when the clock expires', () => {
    const { match } = started();
    match.phase = 'over';
    match.winner = 'p2';
    callOnTime(match);
    expect(winnerOf(match)).toBe('p2');
  });

  it('stops simulating once it is decided', () => {
    const { match } = started();
    match.phase = 'over';
    match.winner = 'p1';
    const distance = match.p1.distance;
    const elapsed = match.elapsed;
    expect(stepMatch(match, STEP, CEILING, FLOOR)).toEqual({ p1: 'idle', p2: 'idle' });
    expect(match.p1.distance).toBe(distance);
    expect(match.elapsed).toBe(elapsed);
  });

  it('freezes a runner that is already home while the other is still coming', () => {
    const { match } = started();
    match.p1.distance = RACE_DISTANCE;
    expect(stepRunner(match, 'p1', CEILING, STEP)).toBe('idle');
    expect(match.p1.distance).toBe(RACE_DISTANCE);
  });

  it('reports the step through one object rather than allocating per step (rule 5)', () => {
    const { match } = started();
    expect(stepMatch(match, STEP, HOLD, HOLD)).toBe(stepMatch(match, STEP, HOLD, HOLD));
  });
});

describe('termination', () => {
  it('finishes a race nobody is playing', () => {
    // The one case that could run for ever in a game where nothing moves on its own — and
    // here it cannot, because a runner goes forward whether or not anybody says anything.
    // Two absent players clip every floor block and dead-heat over the line.
    const { match } = started(3);
    let steps = 0;
    for (; steps < 60 * (ROUND_SECONDS + 5) && match.phase !== 'over'; steps += 1) {
      stepMatch(match, STEP, HOLD, HOLD);
    }
    expect(match.phase).toBe('over');
    expect(winnerOf(match)).toBe('draw');
    expect(match.p1.falls).toBeGreaterThan(0);
    expect(match.elapsed).toBeLessThan(ROUND_SECONDS);
  });

  it('finishes every bot pairing a long way inside the clock', () => {
    for (const tier of TIERS) {
      const elapsed = playMatch(tier, tier, 1000 + tier.length);
      expect(elapsed, `${tier} against itself`).toBeLessThan(ROUND_SECONDS * 0.5);
    }
  });
});

describe('the bot', () => {
  it('only ever asks for a surface', () => {
    for (const tier of TIERS) {
      const { match, rng } = started();
      const state = createBotState();
      for (let i = 0; i < 3000; i += 1) {
        const ask = botAsk(match, 'p2', tier, state, STEP, rng);
        // Never a toggle and never silence: a bot holds an absolute ask the way a resting
        // finger does, and the cadence is what turns that into flips.
        expect(Math.abs(ask)).toBe(1);
        stepMatch(match, STEP, HOLD, ask);
        if (match.phase === 'over') resetMatch(match, rng);
      }
    }
  });

  it('spends the same number of draws on every look, whatever it decides', () => {
    // The Fruit Duel bug, guarded where it would come back. A seat whose draw count
    // depends on what it decided shifts the other seat's stream, and that is a seat bias.
    for (const tier of TIERS) {
      for (let seed = 0; seed < 40; seed += 1) {
        const { match } = started(seed);
        match.p1.cell = seed;
        const counter = new Rng(seed);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        botAsk(match, 'p1', tier, createBotState(), STEP, counted);
        expect(draws, `${tier} seed ${String(seed)}`).toBe(BOT_DRAWS_PER_LOOK);
      }
    }
  });

  it('spends nothing at all on a step it does not look', () => {
    const { match } = started();
    const state = createBotState();
    const counter = new Rng(5);
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return counter.float();
      },
    } as unknown as Rng;
    botAsk(match, 'p1', 'easy', state, STEP, counted);
    const afterFirst = draws;
    botAsk(match, 'p1', 'easy', state, STEP, counted);
    expect(draws).toBe(afterFirst);
  });

  it('holds its answer inside its reaction delay rather than re-reading every step', () => {
    const { match, rng } = started(31);
    const state = createBotState();
    const first = botAsk(match, 'p1', 'easy', state, STEP, rng);
    // Move the course under it. A bot that re-read every step would answer the new one.
    match.course[match.p1.cell + 1] = first === FLOOR ? FLOOR : CEILING;
    expect(botAsk(match, 'p1', 'easy', state, STEP, rng)).toBe(first);
  });

  it('reads less of the lane than a person can see (rule 6)', () => {
    expect(BOT_LOOKAHEAD).toBeLessThan(VISIBLE_CELLS);
    // And nothing beyond that depth can change its answer, with the near cells fixed.
    const { match } = started(77);
    for (let i = 0; i <= BOT_LOOKAHEAD; i += 1) match.course[match.p1.cell + i] = CLEAR;
    const quiet = readAhead(match, 'p1', BOT_LOOKAHEAD);
    match.course[match.p1.cell + BOT_LOOKAHEAD + 1] = FLOOR;
    expect(readAhead(match, 'p1', BOT_LOOKAHEAD)).toBe(quiet);
    expect(readAhead(match, 'p1', VISIBLE_CELLS)).toBe(CEILING);
  });

  it('stays where it is when the lane ahead is clear', () => {
    const { match } = started();
    for (let i = 0; i <= VISIBLE_CELLS; i += 1) match.course[i] = CLEAR;
    match.p1.pull = CEILING;
    expect(readAhead(match, 'p1', VISIBLE_CELLS)).toBe(CEILING);
  });

  it('describes each tier only as reaction, waver and blunder', () => {
    for (const tier of TIERS) {
      expect(Object.keys(BOT_PROFILES[tier]).sort()).toEqual(['blunder', 'reaction', 'waver']);
    }
    // Strictly ordered on every knob, which is what makes the tiers a ladder rather than
    // three tunings that happen to differ.
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
    expect(BOT_PROFILES.easy.waver).toBeGreaterThan(BOT_PROFILES.hard.waver);
  });

  it('beats the tier below it, from either seat', () => {
    // Measured rather than asserted, and from both seats: an ordering that only holds for
    // whoever happens to be p1 is not an ordering, it is a seat advantage.
    for (const [weak, strong] of [
      ['easy', 'normal'],
      ['normal', 'hard'],
      ['easy', 'hard'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP2 = playSeries(weak, strong, 40);
      const asP1 = playSeries(strong, weak, 40);
      expect(asP2.p2, `${strong} as p2 against ${weak}`).toBeGreaterThanOrEqual(30);
      expect(asP1.p1, `${strong} as p1 against ${weak}`).toBeGreaterThanOrEqual(30);
    }
  });

  it('is balanced against itself, at every tier', () => {
    // 40-60% of the decided matches. p1 is stepped first every step and draws from the
    // generator first, so an imbalance here would be a real advantage to one seat.
    for (const tier of TIERS) {
      const played = playSeries(tier, tier, 150);
      const decided = played.p1 + played.p2;
      expect(decided, `${tier} drew too often`).toBeGreaterThan(120);
      expect(played.p1 / decided, `${tier} from p1`).toBeGreaterThan(0.4);
      expect(played.p1 / decided, `${tier} from p1`).toBeLessThan(0.6);
    }
  });

  it('falls less often the better it is', () => {
    // The tiers have to differ in the thing the game is about, not only in who wins.
    const falls = TIERS.map((tier) => playSeries(tier, tier, 30).falls);
    expect(falls[0]).toBeGreaterThan(falls[1]!);
    expect(falls[1]).toBeGreaterThan(falls[2]!);
  });
});

interface Series {
  p1: number;
  p2: number;
  draws: number;
  falls: number;
}

/** Play one bot-against-bot race and return the simulated seconds it took. */
function playMatch(p1Tier: BotDifficulty, p2Tier: BotDifficulty, seed: number): number {
  const match = createMatch();
  const rng = new Rng(seed);
  resetMatch(match, rng);
  const p1Bot = createBotState();
  const p2Bot = createBotState();
  for (let i = 0; i < 60 * (ROUND_SECONDS + 2) && match.phase !== 'over'; i += 1) {
    const a = botAsk(match, 'p1', p1Tier, p1Bot, STEP, rng);
    const b = botAsk(match, 'p2', p2Tier, p2Bot, STEP, rng);
    stepMatch(match, STEP, a, b);
  }
  return match.elapsed;
}

/** Play a run of seeded bot races and count who won. */
function playSeries(p1Tier: BotDifficulty, p2Tier: BotDifficulty, matches: number): Series {
  const tally: Series = { p1: 0, p2: 0, draws: 0, falls: 0 };
  const match = createMatch();
  const p1Bot = createBotState();
  const p2Bot = createBotState();
  for (let m = 0; m < matches; m += 1) {
    const rng = new Rng(5000 + m);
    resetMatch(match, rng);
    resetBotState(p1Bot);
    resetBotState(p2Bot);
    for (let i = 0; i < 60 * (ROUND_SECONDS + 2) && match.phase !== 'over'; i += 1) {
      const a = botAsk(match, 'p1', p1Tier, p1Bot, STEP, rng);
      const b = botAsk(match, 'p2', p2Tier, p2Bot, STEP, rng);
      stepMatch(match, STEP, a, b);
    }
    if (match.winner === 'p1') tally.p1 += 1;
    else if (match.winner === 'p2') tally.p2 += 1;
    else tally.draws += 1;
    tally.falls += match.p1.falls + match.p2.falls;
  }
  return tally;
}

describe('determinism', () => {
  it('replays a fixed trace to the identical final state', () => {
    const play = (): Match => {
      const match = createMatch();
      const rng = new Rng(20260823);
      resetMatch(match, rng);
      const script = new Rng(1234);
      for (let i = 0; i < 4000 && match.phase !== 'over'; i += 1) {
        const a: Ask = script.float() < 0.5 ? FLOOR : CEILING;
        const b: Ask = script.float() < 0.3 ? FLIP : HOLD;
        stepMatch(match, STEP, a, b);
      }
      return match;
    };
    expect(play()).toEqual(play());
  });

  it('two different seeds do not produce the same race', () => {
    // Guards the replay above from passing vacuously.
    const play = (seed: number): Match => {
      const match = createMatch();
      const rng = new Rng(seed);
      resetMatch(match, rng);
      const bot = createBotState();
      for (let i = 0; i < 3000 && match.phase !== 'over'; i += 1) {
        stepMatch(match, STEP, FLOOR, botAsk(match, 'p2', 'normal', bot, STEP, rng));
      }
      return match;
    };
    expect(play(1)).not.toEqual(play(999));
  });

  it('gives a rematch on the same objects a clean start', () => {
    const { match, rng } = started();
    for (let i = 0; i < 600; i += 1) stepMatch(match, STEP, HOLD, FLIP);
    expect(match.p1.distance).toBeGreaterThan(0);
    resetMatch(match, rng);
    for (const seat of SEATS) {
      const runner = runnerOf(match, seat);
      expect(runner.distance).toBe(0);
      expect(runner.falls).toBe(0);
      expect(runner.streak).toBe(0);
      expect(runner.down).toBe(0);
      expect(runner.pull).toBe(FLOOR);
    }
    expect(match.elapsed).toBe(0);
    expect(match.phase).toBe('running');
  });

  it('clears a match without spending a draw on a course nobody will run', () => {
    const { match, rng } = started();
    const before = rng.save();
    clearMatch(match);
    expect(rng.save()).toEqual(before);
    expect(match.phase).toBe('running');
  });
});
