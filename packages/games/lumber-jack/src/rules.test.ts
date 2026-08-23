import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  BRANCH_CEILING,
  BRANCH_FLOOR,
  CALM_SEGMENTS,
  CLEAR,
  LEFT,
  RIGHT,
  ROUND_SECONDS,
  STREAK_FULL,
  STUN_SECONDS,
  SWING_FAST,
  SWING_SLOW,
  TARGET_LOGS,
  TRUNK_LENGTH,
  VISIBLE_SEGMENTS,
  YARD_HEIGHT,
  YARD_WIDTH,
  botSide,
  branchChanceAt,
  callOnTime,
  chop,
  createBotState,
  createMatch,
  fillTrunk,
  logsOf,
  otherOf,
  resetBotState,
  resetMatch,
  safeSide,
  segmentAt,
  stepMatch,
  stepWoodsman,
  swingSeconds,
  winnerOf,
  woodsmanOf,
} from './rules.js';
import type { BotDifficulty, Lean, Match, Side } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];

function started(seed = 1): { match: Match; rng: Rng } {
  const match = createMatch();
  const rng = new Rng(seed);
  resetMatch(match, rng);
  return { match, rng };
}

/** Step until `seat` gets its next swing away, and say what happened. */
function swingOnce(match: Match, seat: SeatId, side: Side): 'felled' | 'clouted' {
  for (let i = 0; i < 600; i += 1) {
    const outcome = stepMatch(
      match,
      STEP,
      seat === 'p1' ? side : CLEAR,
      seat === 'p2' ? side : CLEAR,
    );
    const swung = seat === 'p1' ? outcome.p1 : outcome.p2;
    if (swung !== 'idle') return swung;
  }
  throw new Error('the axe never fell');
}

/** Play a seat perfectly for `logs` swings, always standing where the tree is not. */
function fellCleanly(match: Match, seat: SeatId, logs: number): void {
  for (let i = 0; i < logs; i += 1) {
    const outcome = swingOnce(match, seat, safeSide(match, seat));
    expect(outcome).toBe('felled');
  }
}

describe('the yard', () => {
  it('starts with two untouched trees and nobody ahead', () => {
    const { match } = started();
    expect(match.p1.cut).toBe(0);
    expect(match.p2.cut).toBe(0);
    expect(match.p1.streak).toBe(0);
    expect(match.phase).toBe('felling');
    expect(match.elapsed).toBe(0);
    expect(winnerOf(match)).toBeNull();
  });

  it('declares the box it is drawn into, so the manifest cannot drift from it', () => {
    expect(YARD_WIDTH).toBeGreaterThan(0);
    expect(YARD_HEIGHT).toBeGreaterThan(YARD_WIDTH);
  });

  it('hands both seats the identical trunk', () => {
    // The structural fairness the whole game rests on. Two independently generated trees
    // would be fair on average, and a party game is played once.
    const { match } = started(4242);
    expect(match.p1.cut).toBe(match.p2.cut);
    for (let i = 0; i < 30; i += 1) {
      expect(safeSide(match, 'p1')).toBe(safeSide(match, 'p2'));
      fellCleanly(match, 'p1', 1);
      fellCleanly(match, 'p2', 1);
    }
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('hands back the right woodsman for a seat', () => {
    const { match } = started();
    expect(woodsmanOf(match, 'p1')).toBe(match.p1);
    expect(woodsmanOf(match, 'p2')).toBe(match.p2);
  });
});

describe('the trunk', () => {
  it('opens clear, so nobody is clouted before they have looked at it', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { match } = started(seed);
      for (let i = 0; i < CALM_SEGMENTS; i += 1) {
        expect(segmentAt(match.trunk, i)).toBe(CLEAR);
      }
    }
  });

  it('never branches a segment both ways', () => {
    const { match } = started(99);
    for (let i = 0; i < TRUNK_LENGTH; i += 1) {
      expect([CLEAR, LEFT, RIGHT]).toContain(segmentAt(match.trunk, i));
    }
  });

  it('runs far enough that nobody can read off the end of it', () => {
    // The furthest index anybody asks for: a seat one swing from the target, looking as
    // far up its own tree as the screen shows.
    expect(TRUNK_LENGTH).toBeGreaterThan(TARGET_LOGS + VISIBLE_SEGMENTS);
    expect(segmentAt(new Int8Array(4), 99)).toBe(CLEAR);
  });

  it('thickens as the tree goes up, and stops at its ceiling', () => {
    expect(branchChanceAt(0)).toBeCloseTo(BRANCH_FLOOR, 6);
    expect(branchChanceAt(10)).toBeGreaterThan(branchChanceAt(0));
    expect(branchChanceAt(10_000)).toBe(BRANCH_CEILING);
  });

  it('actually produces more branches near the top than near the foot', () => {
    // The ramp is a claim about the generated tree, not just about the function, so it is
    // measured over enough trees for the difference not to be one seed's luck.
    let low = 0;
    let high = 0;
    const trunk = new Int8Array(TRUNK_LENGTH);
    for (let seed = 0; seed < 40; seed += 1) {
      fillTrunk(trunk, new Rng(seed));
      for (let i = CALM_SEGMENTS; i < 20; i += 1) if (trunk[i] !== CLEAR) low += 1;
      for (let i = TRUNK_LENGTH - 20; i < TRUNK_LENGTH; i += 1) if (trunk[i] !== CLEAR) high += 1;
    }
    expect(high).toBeGreaterThan(low * 1.5);
  });

  it('is the same tree for the same seed and a different one otherwise', () => {
    const a = new Int8Array(TRUNK_LENGTH);
    const b = new Int8Array(TRUNK_LENGTH);
    const c = new Int8Array(TRUNK_LENGTH);
    fillTrunk(a, new Rng(7));
    fillTrunk(b, new Rng(7));
    fillTrunk(c, new Rng(8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('the cadence', () => {
  it('starts slow, ends fast, and never overshoots either end', () => {
    expect(swingSeconds(0)).toBe(SWING_SLOW);
    expect(swingSeconds(STREAK_FULL)).toBeCloseTo(SWING_FAST, 9);
    expect(swingSeconds(STREAK_FULL * 10)).toBeCloseTo(SWING_FAST, 9);
    for (let streak = 1; streak <= STREAK_FULL; streak += 1) {
      expect(swingSeconds(streak)).toBeLessThan(swingSeconds(streak - 1));
    }
  });

  it('cannot be rushed, however often a side is asked for', () => {
    // The input-parity rule, as an assertion. A player mashing a key and a player holding
    // one get the identical number of logs, because the cooldown is the only thing that
    // releases a swing.
    const { match } = started();
    let felled = 0;
    for (let i = 0; i < 60; i += 1) {
      if (stepMatch(match, STEP, RIGHT, CLEAR).p1 !== 'idle') felled += 1;
    }
    // One second at the opening cadence is two swings and change, never sixty.
    expect(felled).toBeLessThanOrEqual(Math.ceil(1 / SWING_SLOW) + 1);
    expect(felled).toBeGreaterThan(0);
  });

  it('quickens as a clean run goes on', () => {
    const { match } = started(11);
    const first = match.p1.span;
    fellCleanly(match, 'p1', STREAK_FULL);
    expect(match.p1.streak).toBe(STREAK_FULL);
    expect(match.p1.span).toBeLessThan(first);
    expect(match.p1.span).toBeCloseTo(SWING_FAST, 9);
  });

  it('costs nothing to ask early', () => {
    // Asking on every step for a whole cooldown must not delay, cancel or double the
    // swing that follows — a player leaning on a key is not making a mistake.
    const patient = started(3);
    const eager = started(3);
    for (let i = 0; i < 40; i += 1) stepMatch(eager.match, STEP, RIGHT, CLEAR);
    let steps = 0;
    while (patient.match.p1.cut === 0 && steps < 200) {
      stepMatch(patient.match, STEP, patient.match.p1.cooldown > STEP ? CLEAR : RIGHT, CLEAR);
      steps += 1;
    }
    expect(patient.match.p1.cut).toBe(eager.match.p1.cut);
  });
});

describe('chopping', () => {
  it('takes a log off and moves the woodsman to the side he swung from', () => {
    const { match } = started();
    expect(chop(match, 'p1', LEFT)).toBe(false);
    expect(match.p1.cut).toBe(1);
    expect(match.p1.side).toBe(LEFT);
    expect(logsOf(match, 'p1')).toBe(1);
    expect(logsOf(match, 'p2')).toBe(0);
  });

  it('is clouted by the branch that drops onto it, and only by that one', () => {
    const { match } = started();
    match.trunk[1] = RIGHT;
    expect(chop(match, 'p1', RIGHT)).toBe(true);
    expect(match.p1.clouts).toBe(1);
    expect(match.p1.stunned).toBe(true);
    expect(match.p1.cooldown).toBe(STUN_SECONDS);
    expect(match.p1.streak).toBe(0);
  });

  it('lets you swing from the side a branch is already on, because you cut it off', () => {
    // The rule that keeps the game to one thing to remember: the log being chopped goes,
    // branch and all. Only the segment that *drops* can catch you.
    const { match } = started();
    match.trunk[0] = LEFT;
    match.trunk[1] = RIGHT;
    expect(chop(match, 'p1', LEFT)).toBe(false);
    expect(match.p1.streak).toBe(1);
  });

  it('leaves a standing woodsman never under the branch at his own shoulder', () => {
    // A rendering invariant as much as a rule: whatever is at level zero is on the other
    // side, or there is nothing there.
    const { match } = started(21);
    for (let i = 0; i < 40; i += 1) {
      fellCleanly(match, 'p1', 1);
      const shoulder = segmentAt(match.trunk, match.p1.cut);
      expect(shoulder === CLEAR || shoulder !== match.p1.side).toBe(true);
    }
  });

  it('counts each seat separately', () => {
    const { match } = started();
    chop(match, 'p1', LEFT);
    chop(match, 'p1', LEFT);
    chop(match, 'p2', RIGHT);
    expect(match.p1.cut).toBe(2);
    expect(match.p2.cut).toBe(1);
  });

  it('stops the axe once a seat has its sixty logs', () => {
    const { match } = started();
    match.p1.cut = TARGET_LOGS;
    match.p1.cooldown = 0;
    expect(stepWoodsman(match, 'p1', RIGHT, STEP)).toBe('idle');
    expect(match.p1.cut).toBe(TARGET_LOGS);
  });
});

describe('being clouted', () => {
  it('costs a second and a half, and the rhythm as well', () => {
    const { match } = started(5);
    fellCleanly(match, 'p1', STREAK_FULL);
    const quick = match.p1.span;
    match.trunk[match.p1.cut + 1] = match.p1.side;
    expect(swingOnce(match, 'p1', match.p1.side)).toBe('clouted');
    expect(match.p1.cooldown).toBe(STUN_SECONDS);
    expect(match.p1.streak).toBe(0);
    // The larger of the two costs: the next swing is back at the opening cadence.
    expect(match.p1.span).toBeGreaterThan(quick);
    expect(STUN_SECONDS).toBeGreaterThan(SWING_SLOW);
  });

  it('gets back up on its own, without anybody pressing anything', () => {
    const { match } = started(5);
    match.trunk[1] = RIGHT;
    expect(swingOnce(match, 'p1', RIGHT)).toBe('clouted');
    for (let i = 0; i < 120 && match.p1.stunned; i += 1) stepMatch(match, STEP, CLEAR, CLEAR);
    expect(match.p1.stunned).toBe(false);
    expect(match.p1.cooldown).toBe(0);
  });
});

describe('winning', () => {
  it('is first to sixty logs', () => {
    const { match } = started();
    match.p2.cut = TARGET_LOGS - 1;
    match.p2.cooldown = 0;
    match.trunk[TARGET_LOGS] = CLEAR;
    stepMatch(match, STEP, CLEAR, match.trunk[TARGET_LOGS] === LEFT ? RIGHT : LEFT);
    expect(match.p2.cut).toBe(TARGET_LOGS);
    expect(match.phase).toBe('over');
    expect(winnerOf(match)).toBe('p2');
  });

  it('is a draw when both fell their last log on the same step', () => {
    const { match } = started();
    match.p1.cut = TARGET_LOGS - 1;
    match.p2.cut = TARGET_LOGS - 1;
    match.p1.cooldown = 0;
    match.p2.cooldown = 0;
    match.trunk[TARGET_LOGS] = CLEAR;
    stepMatch(match, STEP, LEFT, LEFT);
    expect(winnerOf(match)).toBe('draw');
  });

  it('is called on logs when the round clock runs out, and level is a draw', () => {
    const level = createMatch();
    resetMatch(level, new Rng(1));
    callOnTime(level);
    expect(winnerOf(level)).toBe('draw');

    const ahead = createMatch();
    resetMatch(ahead, new Rng(1));
    ahead.p1.cut = 12;
    ahead.p2.cut = 11;
    callOnTime(ahead);
    expect(winnerOf(ahead)).toBe('p1');
  });

  it('leaves an already-decided match alone when the clock expires', () => {
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
    const before = match.p1.cut;
    const elapsed = match.elapsed;
    expect(stepMatch(match, STEP, LEFT, RIGHT)).toEqual({ p1: 'idle', p2: 'idle' });
    expect(match.p1.cut).toBe(before);
    expect(match.elapsed).toBe(elapsed);
  });

  it('reports the step through one object rather than allocating per step (rule 5)', () => {
    const { match } = started();
    expect(stepMatch(match, STEP, CLEAR, CLEAR)).toBe(stepMatch(match, STEP, CLEAR, CLEAR));
  });
});

describe('termination', () => {
  it('ends a match nobody is playing, on the clock', () => {
    // Nothing in this simulation moves on its own, so two absent players is the one case
    // that could run for ever. The property `termination.test.ts` checks across the
    // catalogue, checked here where a failure names the rule rather than a registry entry.
    const { match } = started();
    let steps = 0;
    for (; steps < 60 * (ROUND_SECONDS + 5) && match.phase !== 'over'; steps += 1) {
      stepMatch(match, STEP, CLEAR, CLEAR);
    }
    expect(match.phase).toBe('over');
    expect(winnerOf(match)).toBe('draw');
    expect(match.elapsed).toBeGreaterThanOrEqual(ROUND_SECONDS);
  });

  it('ends every bot pairing a long way inside the clock', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const elapsed = playMatch(tier, tier, 1000 + tier.length);
      expect(elapsed, `${tier} against itself`).toBeLessThan(ROUND_SECONDS * 0.6);
    }
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('only ever asks for a side', () => {
    for (const tier of TIERS) {
      const { match, rng } = started();
      const state = createBotState();
      for (let i = 0; i < 4000; i += 1) {
        const side = botSide(match, 'p2', tier, state, STEP, rng);
        // Never CLEAR: a bot holds a side down the way a resting finger does, and it is
        // the cadence rather than the bot that decides when that becomes a swing.
        expect(Math.abs(side)).toBe(1);
        stepMatch(match, STEP, CLEAR, side);
        if (match.phase === 'over') resetMatch(match, rng);
      }
    }
  });

  it('holds its answer inside its reaction delay rather than re-reading every step', () => {
    const { match, rng } = started(31);
    const state = createBotState();
    const first = botSide(match, 'p1', 'easy', state, STEP, rng);
    // Move the tree under it. A bot that re-read every step would answer the new one.
    match.trunk[match.p1.cut + 1] = first;
    expect(botSide(match, 'p1', 'easy', state, STEP, rng)).toBe(first);
  });

  it('reads the segment a player reads, and nothing further up the tree', () => {
    // Rule 6, as an assertion about what the bot can possibly know: with the arriving
    // segment fixed, whatever is above it cannot change the answer.
    const { match, rng } = started(77);
    const state = createBotState();
    match.trunk[match.p1.cut + 1] = LEFT;
    for (let i = 2; i < VISIBLE_SEGMENTS; i += 1) match.trunk[match.p1.cut + i] = LEFT;
    resetBotState(state);
    const chosen = botSide(match, 'p1', 'hard', state, STEP, rng);
    expect(chosen).toBe(safeSide(match, 'p1'));
    expect(safeSide(match, 'p1')).toBe(RIGHT);
  });

  it('stands still when the tree above it is clear', () => {
    const { match } = started();
    match.trunk[1] = CLEAR;
    match.p1.side = LEFT;
    expect(safeSide(match, 'p1')).toBe(LEFT);
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
      expect(asP2.p2, `${strong} as p2 against ${weak}`).toBeGreaterThanOrEqual(34);
      expect(asP1.p1, `${strong} as p1 against ${weak}`).toBeGreaterThanOrEqual(34);
    }
  });

  it('is balanced against itself, at every tier', () => {
    // 40-60% at equal difficulty. p1 is stepped first every step and draws from the
    // generator first, so an imbalance here would be a real advantage to one seat.
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const played = playSeries(tier, tier, 150);
      const decided = played.p1 + played.p2;
      expect(decided, `${tier} drew too often`).toBeGreaterThan(120);
      expect(played.p2 / decided, `${tier} from p2`).toBeGreaterThan(0.4);
      expect(played.p2 / decided, `${tier} from p2`).toBeLessThan(0.6);
    }
  });
});

interface Series {
  p1: number;
  p2: number;
  draws: number;
}

/** Play one bot-against-bot match and return the simulated seconds it took. */
function playMatch(p1Tier: BotDifficulty, p2Tier: BotDifficulty, seed: number): number {
  const match = createMatch();
  const rng = new Rng(seed);
  resetMatch(match, rng);
  const p1Bot = createBotState();
  const p2Bot = createBotState();
  for (let i = 0; i < 60 * (ROUND_SECONDS + 2) && match.phase !== 'over'; i += 1) {
    const a = botSide(match, 'p1', p1Tier, p1Bot, STEP, rng);
    const b = botSide(match, 'p2', p2Tier, p2Bot, STEP, rng);
    stepMatch(match, STEP, a, b);
  }
  return match.elapsed;
}

/** Play a run of seeded bot matches and count who won. */
function playSeries(p1Tier: BotDifficulty, p2Tier: BotDifficulty, matches: number): Series {
  const tally: Series = { p1: 0, p2: 0, draws: 0 };
  const match = createMatch();
  const p1Bot = createBotState();
  const p2Bot = createBotState();
  for (let m = 0; m < matches; m += 1) {
    const rng = new Rng(5000 + m);
    resetMatch(match, rng);
    resetBotState(p1Bot);
    resetBotState(p2Bot);
    for (let i = 0; i < 60 * (ROUND_SECONDS + 2) && match.phase !== 'over'; i += 1) {
      const a = botSide(match, 'p1', p1Tier, p1Bot, STEP, rng);
      const b = botSide(match, 'p2', p2Tier, p2Bot, STEP, rng);
      stepMatch(match, STEP, a, b);
    }
    if (match.winner === 'p1') tally.p1 += 1;
    else if (match.winner === 'p2') tally.p2 += 1;
    else tally.draws += 1;
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
      for (let i = 0; i < 6000 && match.phase !== 'over'; i += 1) {
        const a: Lean = script.float() < 0.5 ? LEFT : RIGHT;
        const b: Lean = script.float() < 0.3 ? LEFT : RIGHT;
        stepMatch(match, STEP, a, b);
      }
      return match;
    };
    expect(play()).toEqual(play());
  });

  it('two different seeds do not produce the same match', () => {
    // Guards the replay above from passing vacuously.
    const play = (seed: number): Match => {
      const match = createMatch();
      const rng = new Rng(seed);
      resetMatch(match, rng);
      const bot = createBotState();
      for (let i = 0; i < 3000 && match.phase !== 'over'; i += 1) {
        stepMatch(match, STEP, RIGHT, botSide(match, 'p2', 'normal', bot, STEP, rng));
      }
      return match;
    };
    expect(play(1)).not.toEqual(play(999));
  });

  it('gives a rematch on the same objects a clean start', () => {
    const { match, rng } = started();
    for (let i = 0; i < 600; i += 1) stepMatch(match, STEP, LEFT, RIGHT);
    expect(match.p1.cut).toBeGreaterThan(0);
    resetMatch(match, rng);
    for (const seat of SEATS) {
      const woodsman = woodsmanOf(match, seat);
      expect(woodsman.cut).toBe(0);
      expect(woodsman.clouts).toBe(0);
      expect(woodsman.streak).toBe(0);
      expect(woodsman.stunned).toBe(false);
    }
    expect(match.elapsed).toBe(0);
    expect(match.phase).toBe('felling');
  });
});
