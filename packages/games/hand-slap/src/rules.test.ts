import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  DODGE_COOLDOWN_SECONDS,
  REACTION_JITTER_SECONDS,
  DODGE_SECONDS,
  MAX_READY_SECONDS,
  MIN_READY_SECONDS,
  SETTLE_SECONDS,
  SWING_SECONDS,
  TARGET_POINTS,
  botAction,
  createBotState,
  createState,
  defenderOf,
  dodge,
  handsAway,
  jitteredReaction,
  otherOf,
  readyDelay,
  resetBotState,
  resetState,
  step,
  swing,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Outcome, Phase, State } from './rules.js';

const STEP = 1 / 60;

/** Runs the wait out so the round is live. */
function goLive(state: State, rng = new Rng(1)): void {
  for (let i = 0; i < 60 * 10 && state.phase !== 'live'; i += 1) step(state, STEP, rng);
}

function advance(state: State, seconds: number, rng = new Rng(1)): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) step(state, STEP, rng);
}

describe('the round', () => {
  it('starts waiting, not live', () => {
    const state = createState();
    expect(state.phase, 'nothing counts until the hands settle').toBe('ready');
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
  });

  it('goes live after the wait', () => {
    const state = createState();
    goLive(state);
    expect(state.phase).toBe('live');
  });

  it('waits a seeded, varying time', () => {
    // A fixed wait would be learnable, and the whole game is a bluff.
    const rng = new Rng(9);
    const delays = [readyDelay(rng), readyDelay(rng), readyDelay(rng), readyDelay(rng)];
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(MIN_READY_SECONDS);
      expect(delay).toBeLessThanOrEqual(MAX_READY_SECONDS);
    }
    expect(new Set(delays).size, 'the wait is not always the same').toBeGreaterThan(1);
  });

  it('swaps the attacker every round', () => {
    // Neither player attacks twice running, so whatever advantage attacking carries is
    // shared exactly rather than settled by who happened to go first.
    const state = createState();
    const first = state.attacker;
    goLive(state);
    swing(state);
    advance(state, SWING_SECONDS + SETTLE_SECONDS + 0.1);
    expect(state.attacker, 'the seats change over').toBe(otherOf(first));
    expect(state.round).toBe(1);
  });

  it('names the defender as the other seat', () => {
    const state = createState();
    expect(defenderOf(state)).toBe(otherOf(state.attacker));
  });

  it('resets in place', () => {
    const state = createState();
    goLive(state);
    swing(state);
    advance(state, SWING_SECONDS + 0.1);
    resetState(state);
    expect(state.phase).toBe('ready');
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(state.attacker).toBe('p1');
    expect(state.round).toBe(0);
  });
});

describe('swinging', () => {
  it('is refused before the round is live', () => {
    // A refusal must be distinguishable from a swing that simply missed.
    const state = createState();
    expect(swing(state), 'swinging during the wait is refused').toBe(false);
    expect(state.phase).toBe('ready');
  });

  it('is accepted once live, and takes time to land', () => {
    const state = createState();
    goLive(state);
    expect(swing(state)).toBe(true);
    expect(state.phase).toBe('swinging');
    advance(state, SWING_SECONDS - 0.05);
    expect(state.phase, 'still in the air').toBe('swinging');
  });

  it('is refused while another swing is in the air', () => {
    const state = createState();
    goLive(state);
    swing(state);
    expect(swing(state)).toBe(false);
  });

  it('scores for the attacker when it connects', () => {
    const state = createState();
    goLive(state);
    const attacker = state.attacker;
    swing(state);
    advance(state, SWING_SECONDS + 0.02);
    expect(state.outcome).toBe('hit');
    expect(state.scorer).toBe(attacker);
    expect(attacker === 'p1' ? state.p1 : state.p2).toBe(1);
  });

  it('scores for the defender when the hands have gone', () => {
    const state = createState();
    goLive(state);
    const attacker = state.attacker;
    const defender = defenderOf(state);
    swing(state);
    expect(dodge(state), 'a dodge with a swing in the air is accepted').toBe(true);
    expect(handsAway(state)).toBe(true);
    advance(state, SWING_SECONDS + 0.02);
    expect(state.outcome).toBe('dodged');
    expect(state.scorer).toBe(defender);
    expect(attacker === 'p1' ? state.p1 : state.p2).toBe(0);
  });

  it('connects when the dodge has already worn off', () => {
    // Dodging too early is its own mistake: the hands come back before the slap lands.
    const state = createState();
    state.phase = 'swinging';
    state.timer = SWING_SECONDS;
    state.dodgeRemaining = 0.05;
    advance(state, SWING_SECONDS + 0.02);
    expect(state.outcome, 'the hands were back in time to be hit').toBe('hit');
  });
});

describe('dodging', () => {
  it('is refused before the round is live', () => {
    const state = createState();
    expect(dodge(state)).toBe(false);
  });

  it('costs a point when there is nothing to dodge', () => {
    // The rule that makes this a mind game rather than a reaction test: a defender who
    // hammers the button bleeds points.
    const state = createState();
    goLive(state);
    const attacker = state.attacker;
    expect(dodge(state)).toBe(true);
    expect(state.outcome).toBe('flinch');
    expect(state.scorer).toBe(attacker);
    expect(attacker === 'p1' ? state.p1 : state.p2).toBe(1);
  });

  it('is refused while the hands are already away', () => {
    const state = createState();
    goLive(state);
    swing(state);
    dodge(state);
    expect(dodge(state), 'a second dodge does nothing').toBe(false);
  });

  // These two watch the dodge timers on their own, with a swing held in the air rather
  // than allowed to land. The dodge window is deliberately longer than the swing's flight
  // — a dodge made in time must beat the slap — so in a real round the point is always
  // settled first, and settling clears both timers. Stepping a real round here measured
  // nothing at all, which is how the first version of these two tests failed.
  it('holds the hands away for its whole window', () => {
    const state = createState();
    goLive(state);
    swing(state);
    state.timer = 100;
    dodge(state);
    advance(state, DODGE_SECONDS - 0.02);
    expect(handsAway(state)).toBe(true);
    advance(state, 0.04);
    expect(handsAway(state), 'and then the hands come back').toBe(false);
  });

  it('cannot be repeated until the cooldown has run', () => {
    const state = createState();
    goLive(state);
    swing(state);
    state.timer = 100;
    dodge(state);
    advance(state, DODGE_SECONDS + 0.01);
    expect(handsAway(state), 'the hands are back').toBe(false);
    expect(state.dodgeCooldown, 'but the cooldown is still running').toBeGreaterThan(0);
    expect(dodge(state), 'so a second dodge is refused').toBe(false);

    advance(state, DODGE_COOLDOWN_SECONDS);
    expect(state.dodgeCooldown).toBe(0);
    expect(dodge(state), 'and allowed once it has run').toBe(true);
  });

  it('outlasts the swing it was made against', () => {
    // The balance the two tests above depend on, stated directly: dodging in time wins.
    expect(DODGE_SECONDS).toBeGreaterThan(SWING_SECONDS);
  });

  it('is refused while a point is settling', () => {
    const state = createState();
    goLive(state);
    swing(state);
    advance(state, SWING_SECONDS + 0.02);
    expect(state.phase).toBe('settling');
    expect(dodge(state)).toBe(false);
    expect(swing(state)).toBe(false);
  });
});

describe('winning', () => {
  it('is undecided at the start', () => {
    expect(winnerOf(createState())).toBeNull();
  });

  it('needs the target', () => {
    const state = createState();
    state.p1 = TARGET_POINTS - 1;
    expect(winnerOf(state)).toBeNull();
    state.p1 = TARGET_POINTS;
    expect(winnerOf(state)).toBe('p1');
  });

  it('is a draw only if both somehow arrive level', () => {
    const state = createState();
    state.p1 = TARGET_POINTS;
    state.p2 = TARGET_POINTS;
    expect(winnerOf(state)).toBe('draw');
  });
});

describe('the bot', () => {
  it('does nothing while the round is waiting', () => {
    const state = createState();
    const bot = createBotState();
    expect(botAction(state, bot, BOT_PROFILES.hard, 'p2', STEP, 0)).toBe('none');
  });

  it('cannot react faster than a person, on its luckiest swing', () => {
    // Rule 6: a bot never gets speed a human cannot have. A simple visual reaction is
    // about 0.25s, so the hard tier sits at the quick end of human rather than past it.
    //
    // What the rule constrains is the **fastest the bot can ever be**, not its average —
    // and since #2504 the reaction is a distribution, so the average is no longer the
    // fastest. Asserting the tier's middle would let a wide jitter smuggle a superhuman
    // bot in under a perfectly human-looking number.
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const quickest = BOT_PROFILES[tier].reaction - REACTION_JITTER_SECONDS;
      expect(quickest, tier).toBeGreaterThanOrEqual(0.2);
      // And the roll that produces it really is the floor: `roll` is in [0, 1).
      expect(jitteredReaction(BOT_PROFILES[tier], 0), tier).toBeCloseTo(quickest, 9);
      expect(jitteredReaction(BOT_PROFILES[tier], 1), tier).toBeCloseTo(
        BOT_PROFILES[tier].reaction + REACTION_JITTER_SECONDS,
        9,
      );
      expect(jitteredReaction(BOT_PROFILES[tier], 0.5), tier).toBeCloseTo(
        BOT_PROFILES[tier].reaction,
        9,
      );
    }
  });

  it('straddles the swing at every tier, so no tier is a verdict', () => {
    // Defect #2504, pinned. Whether a dodge beats a swing is the bot's reaction against
    // SWING_SECONDS, and while `reaction` was a bare constant that comparison had **one
    // answer for the whole match**: easy sat above the swing and was hit every round,
    // normal and hard sat below it and were never hit at all. Two equal bots did not play,
    // they alternated a decided role. A win-rate ladder cannot see this — it reported a
    // clean monotone result the whole time.
    //
    // The fix is that every tier's reaction distribution must contain the swing, so every
    // tier is a hit *rate*. This is the assertion that says so.
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const profile = BOT_PROFILES[tier];
      expect(
        profile.reaction - REACTION_JITTER_SECONDS,
        `${tier} is never quick enough`,
      ).toBeLessThan(SWING_SECONDS);
      expect(
        profile.reaction + REACTION_JITTER_SECONDS,
        `${tier} is always quick enough`,
      ).toBeGreaterThan(SWING_SECONDS);
    }
  });

  it('will not dodge a swing it has not watched long enough', () => {
    const state = createState();
    goLive(state);
    swing(state);
    const bot = createBotState();
    const profile = BOT_PROFILES.hard;
    // Roll 0 is the quickest reaction this tier can draw, so this is the earliest the bot
    // could possibly move — and it still has to watch the swing for all of it.
    const quickest = jitteredReaction(profile, 0);
    // One step in: the swing is barely visible.
    expect(botAction(state, bot, profile, defenderOf(state), STEP, 0)).toBe('none');
    expect(bot.reaction, 'the reaction was drawn on the first sight of the swing').toBeCloseTo(
      quickest,
      9,
    );
    // Watched for less than that: still nothing.
    for (let i = 0; i * STEP < quickest - STEP * 2; i += 1) {
      expect(botAction(state, bot, profile, defenderOf(state), STEP, 0)).toBe('none');
    }
  });

  it('draws one reaction per swing rather than one per step', () => {
    // Re-rolling every step would make the reaction a per-step lottery that a long swing
    // always eventually wins, which is a different bug wearing the same fix.
    const state = createState();
    goLive(state);
    swing(state);
    const bot = createBotState();
    const profile = BOT_PROFILES.easy;
    // The first sight of the swing draws a slow reaction; every later step offers a fast
    // one and must be ignored.
    expect(botAction(state, bot, profile, defenderOf(state), STEP, 1)).toBe('none');
    const drawn = bot.reaction;
    expect(drawn).toBeCloseTo(profile.reaction + REACTION_JITTER_SECONDS, 9);
    for (let i = 0; i * STEP < drawn - STEP * 2; i += 1) {
      expect(botAction(state, bot, profile, defenderOf(state), STEP, 0), 'the roll is spent').toBe(
        'none',
      );
      expect(bot.reaction).toBeCloseTo(drawn, 9);
    }
  });

  it('dodges once it has watched the swing for the reaction it drew', () => {
    const state = createState();
    goLive(state);
    swing(state);
    const bot = createBotState();
    const profile = BOT_PROFILES.hard;
    let dodged = false;
    for (let i = 0; i < 60 && !dodged; i += 1) {
      dodged = botAction(state, bot, profile, defenderOf(state), STEP, 0) === 'dodge';
    }
    expect(dodged).toBe(true);
    expect(bot.watched).toBeGreaterThanOrEqual(bot.reaction);
  });

  it('forgets a swing it was watching once the round ends', () => {
    const state = createState();
    goLive(state);
    swing(state);
    const bot = createBotState();
    botAction(state, bot, BOT_PROFILES.normal, defenderOf(state), STEP, 0);
    expect(bot.watched).toBeGreaterThan(0);
    advance(state, SWING_SECONDS + 0.02);
    botAction(state, bot, BOT_PROFILES.normal, defenderOf(state), STEP, 0);
    expect(bot.watched, 'a settled round clears the watch').toBe(0);
  });

  it('swings at a rate that does not change with the step rate', () => {
    // Expressed per second and converted per step, so a 30Hz sim plays the same game.
    const state = createState();
    goLive(state);
    const bot = createBotState();
    const profile = BOT_PROFILES.normal;
    const fine = profile.swingRate * (1 / 120);
    const coarse = profile.swingRate * (1 / 30);
    expect(botAction(state, bot, profile, state.attacker, 1 / 120, fine * 0.99)).toBe('swing');
    expect(botAction(state, bot, profile, state.attacker, 1 / 120, fine * 1.01)).toBe('none');
    expect(botAction(state, bot, profile, state.attacker, 1 / 30, coarse * 0.99)).toBe('swing');
  });

  it('clears its watch and its drawn reaction on reset', () => {
    const bot = createBotState();
    bot.watched = 0.5;
    bot.reaction = 0.5;
    resetBotState(bot);
    expect(bot.watched).toBe(0);
    expect(bot.reaction).toBe(0);
  });

  it('declares its tiers in a sensible order', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.flinchRate).toBeGreaterThan(BOT_PROFILES.hard.flinchRate);
  });

  it('turns every tier into a hit rate rather than a verdict', () => {
    // Defect #2504's actual numbers, measured rather than asserted from the arithmetic.
    // One swing at a time, the same roll sequence handed to all three tiers, so the only
    // thing that differs between the columns is the tier.
    //
    // Before the fix these read 0.0%, 100.0%, 100.0% — a verdict per tier, and the reason
    // two equal bots at `easy` or `hard` never actually played. A tier that returns to 0%
    // or 100%, or that becomes indistinguishable from its neighbour, is the bug again.
    const SWINGS = 20000;
    const share: Record<BotDifficulty, number> = { easy: 0, normal: 0, hard: 0 };
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const rng = new Rng(20260829);
      // `step` only draws while a point settles, which this loop never reaches.
      const unused = new Rng(1);
      let dodged = 0;
      for (let i = 0; i < SWINGS; i += 1) {
        const state = createState();
        goLive(state);
        swing(state);
        const bot = createBotState();
        // One roll per swing is all the bot draws, so handing it the same number every
        // step changes nothing and keeps the three tiers on the identical sequence.
        const roll = rng.float();
        while (state.phase === 'swinging') {
          const action = botAction(state, bot, BOT_PROFILES[tier], defenderOf(state), STEP, roll);
          if (action === 'dodge') dodge(state);
          step(state, STEP, unused);
        }
        if (state.outcome === 'dodged') dodged += 1;
      }
      share[tier] = dodged / SWINGS;
    }

    // The design rates are `(0.35 - reaction + 0.10) / 0.20`: 15%, 40% and 65%. Twenty
    // thousand swings puts one standard error at a third of a point, so one point of slack
    // is a sampling allowance rather than a shrug — a tier that drifts further has moved.
    // Two thousand was tried first and this seed happened to run 2.1 points hot at
    // `normal`, which is under two sigma there and would have been a tolerance chosen to
    // fit the sample rather than the design.
    // Recorded in SPEC.md alongside what they were before the fix: 0%, 100%, 100%.
    const design: Record<BotDifficulty, number> = { easy: 0.15, normal: 0.4, hard: 0.65 };
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      const where = `${tier} dodged ${(share[tier] * 100).toFixed(1)}% of swings`;
      expect(share[tier], where).toBeGreaterThan(design[tier] - 0.01);
      expect(share[tier], where).toBeLessThan(design[tier] + 0.01);
      // Every one of them is a rate, not a verdict.
      expect(share[tier], where).toBeGreaterThan(0);
      expect(share[tier], where).toBeLessThan(1);
    }
    // And clearly ordered: a tier its neighbour cannot be told apart from is a failed fix
    // just as surely as a tier that decides every round.
    expect(share.normal - share.easy, 'easy and normal are too close').toBeGreaterThan(0.2);
    expect(share.hard - share.normal, 'normal and hard are too close').toBeGreaterThan(0.2);
  });

  it('beats the weaker tier over a series', () => {
    // Measured rather than assumed: the tiers must differ in strength, not only in label.
    const play = (p1: BotDifficulty, p2: BotDifficulty, seed: number): SeatId | 'draw' | null => {
      const state = createState();
      const rng = new Rng(seed);
      const botP1 = createBotState();
      const botP2 = createBotState();
      for (let i = 0; i < 60 * 600 && winnerOf(state) === null; i += 1) {
        for (const seat of ['p1', 'p2'] as SeatId[]) {
          const bot = seat === 'p1' ? botP1 : botP2;
          const action = botAction(
            state,
            bot,
            BOT_PROFILES[seat === 'p1' ? p1 : p2],
            seat,
            STEP,
            rng.float(),
          );
          if (action === 'swing' && seat === state.attacker) swing(state);
          else if (action === 'dodge' && seat === defenderOf(state)) dodge(state);
        }
        step(state, STEP, rng);
      }
      return winnerOf(state);
    };
    let hardWins = 0;
    const games = 10;
    for (let i = 0; i < games; i += 1) {
      const hardIsP1 = i % 2 === 0;
      const winner = play(hardIsP1 ? 'hard' : 'easy', hardIsP1 ? 'easy' : 'hard', 300 + i);
      if (winner === (hardIsP1 ? 'p1' : 'p2')) hardWins += 1;
    }
    expect(hardWins, `hard won ${String(hardWins)} of ${String(games)}`).toBeGreaterThan(games / 2);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed', () => {
    const trace = (): string => {
      const state = createState();
      const rng = new Rng(77);
      const bot = createBotState();
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        const action = botAction(
          state,
          bot,
          BOT_PROFILES.normal,
          state.attacker,
          STEP,
          rng.float(),
        );
        if (action === 'swing') swing(state);
        step(state, STEP, rng);
        out.push(`${state.phase[0] ?? '?'}${String(state.p1)}${String(state.p2)}`);
      }
      return out.join('');
    };
    expect(trace()).toBe(trace());
  });

  it('is driven by the fixed delta rather than the wall clock', () => {
    const coarse = createState();
    const fine = createState();
    // The same total simulated time in different-sized steps reaches the same phase.
    for (let i = 0; i < 30; i += 1) step(coarse, 1 / 30, new Rng(5));
    for (let i = 0; i < 60; i += 1) step(fine, 1 / 60, new Rng(5));
    expect(coarse.phase).toBe(fine.phase);
  });

  it('uses only the seeded generator for its waits', () => {
    // Two states driven by equal seeds must agree exactly; `Math.random` would diverge.
    const a = createState();
    const b = createState();
    for (let i = 0; i < 60 * 30; i += 1) {
      step(a, STEP, new Rng(11 + (i % 3)));
      step(b, STEP, new Rng(11 + (i % 3)));
    }
    expect(a.timer).toBeCloseTo(b.timer, 9);
    expect(a.round).toBe(b.round);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The half-turn                                                                         */
/* ------------------------------------------------------------------------------------ */

const PHASES: readonly Phase[] = ['ready', 'live', 'swinging', 'settling'];
const OUTCOMES: readonly Outcome[] = [null, 'hit', 'dodged', 'flinch'];

/**
 * The board seen from the other chair: every seat swapped, nothing else touched.
 *
 * Hand Slap has no geometry to reflect - the whole state is roles, timers and scores - so
 * the half-turn is exactly "relabel p1 as p2". Anything that survives a win-rate ladder
 * but not this is a real seat bias, and a ladder cannot tell one from a small sample.
 */
function mirrorInto(from: Readonly<State>, to: State): void {
  to.phase = from.phase;
  to.attacker = otherOf(from.attacker);
  to.timer = from.timer;
  to.dodgeCooldown = from.dodgeCooldown;
  to.dodgeRemaining = from.dodgeRemaining;
  to.outcome = from.outcome;
  to.scorer = from.scorer === null ? null : otherOf(from.scorer);
  to.p1 = from.p2;
  to.p2 = from.p1;
  to.round = from.round;
}

/**
 * Everything a step can touch, to six places.
 *
 * `toFixed` is used rather than a numeric compare on purpose: it prints `-0` differently
 * from `0`, and a signed zero arriving from one seat and not the other is one of the ways
 * a mirrored board has been caught parting company in this repository.
 */
function describeState(state: Readonly<State>): string {
  const six = (value: number): string =>
    Number.isFinite(value) ? value.toFixed(6) : String(value);
  return [
    state.phase,
    state.attacker,
    six(state.timer),
    six(state.dodgeCooldown),
    six(state.dodgeRemaining),
    String(state.outcome),
    String(state.scorer),
    String(state.p1),
    String(state.p2),
    String(state.round),
  ].join('/');
}

/**
 * An arbitrary but legal board.
 *
 * Every duration is a whole number of fixed steps, so `timer -= dt` lands **exactly** on
 * zero rather than near it. The thresholds this game turns on - a timer expiring, a dodge
 * wearing off, a cooldown clearing - are all reached by construction here rather than by
 * coincidence, which is the only way a mirror test can see them.
 */
function scramble(state: State, rng: Rng): void {
  const phase = PHASES[rng.int(0, PHASES.length)] as Phase;
  state.phase = phase;
  state.attacker = rng.bool(0.5) ? 'p1' : 'p2';
  // A live round has no deadline, exactly as `step` sets it.
  state.timer = phase === 'live' ? Number.POSITIVE_INFINITY : rng.int(0, 40) * STEP;
  state.dodgeCooldown = rng.int(0, 40) * STEP;
  state.dodgeRemaining = rng.int(0, 30) * STEP;
  state.outcome = OUTCOMES[rng.int(0, OUTCOMES.length)] as Outcome;
  state.scorer = rng.bool(0.3) ? null : rng.bool(0.5) ? 'p1' : 'p2';
  state.p1 = rng.int(0, TARGET_POINTS);
  state.p2 = rng.int(0, TARGET_POINTS);
  state.round = rng.int(0, 12);
}

describe('the half-turn', () => {
  it('steps a mirrored board to the mirror of the stepped board', () => {
    const rng = new Rng(20260829);
    const state = createState();
    const other = createState();
    const expected = createState();
    for (let trial = 0; trial < 600; trial += 1) {
      scramble(state, rng);
      mirrorInto(state, other);
      // The same seeded stream on both sides: the seat order must not change which
      // number a round's wait is drawn from.
      const seed = trial * 131 + 7;
      step(state, STEP, new Rng(seed));
      step(other, STEP, new Rng(seed));
      mirrorInto(state, expected);
      expect(describeState(other), `trial ${String(trial)}`).toBe(describeState(expected));
    }
  });

  it('accepts a mirrored swing and a mirrored dodge identically', () => {
    const rng = new Rng(4242);
    const state = createState();
    const other = createState();
    const expected = createState();
    for (let trial = 0; trial < 600; trial += 1) {
      scramble(state, rng);
      mirrorInto(state, other);
      const swung = swing(state);
      expect(swing(other), `swing, trial ${String(trial)}`).toBe(swung);
      mirrorInto(state, expected);
      expect(describeState(other), `swing, trial ${String(trial)}`).toBe(describeState(expected));

      scramble(state, rng);
      mirrorInto(state, other);
      const dodged = dodge(state);
      expect(dodge(other), `dodge, trial ${String(trial)}`).toBe(dodged);
      mirrorInto(state, expected);
      expect(describeState(other), `dodge, trial ${String(trial)}`).toBe(describeState(expected));
    }
  });

  it('makes a bot decide the mirrored thing on a mirrored board', () => {
    const rng = new Rng(31337);
    const state = createState();
    const other = createState();
    for (const tier of Object.keys(BOT_PROFILES) as BotDifficulty[]) {
      for (let trial = 0; trial < 400; trial += 1) {
        scramble(state, rng);
        mirrorInto(state, other);
        // The same roll to both, because the whole point is that the roll is handed out
        // by role rather than by seat.
        const roll = rng.float();
        const watched = rng.int(0, 40) * STEP;
        for (const seat of ['p1', 'p2'] as SeatId[]) {
          const here = createBotState();
          const there = createBotState();
          here.watched = watched;
          there.watched = watched;
          const mine = botAction(state, here, BOT_PROFILES[tier], seat, STEP, roll);
          const theirs = botAction(other, there, BOT_PROFILES[tier], otherOf(seat), STEP, roll);
          expect(theirs, `${tier} trial ${String(trial)} ${seat}`).toBe(mine);
          expect(there.watched, `${tier} trial ${String(trial)} ${seat} watch`).toBe(here.watched);
          // The jitter too: a reaction drawn from the roll must be the same number in both
          // chairs, or the seeded stream has become seat-dependent again.
          expect(there.reaction, `${tier} trial ${String(trial)} ${seat} reaction`).toBe(
            here.reaction,
          );
        }
      }
    }
  });

  it('plays a whole match to the mirrored result when the other seat opens', () => {
    // End to end, and the assertion a win-rate ladder can never make: not "seat one won
    // about half", but "this exact match, opened from the other chair, is this exact
    // match with the names swapped".
    for (const tier of Object.keys(BOT_PROFILES) as BotDifficulty[]) {
      for (let s = 0; s < 40; s += 1) {
        const seed = 1000003 + s * 7919;
        const forward = playRules(seed, 'p1', tier);
        const backward = playRules(seed, 'p2', tier);
        const where = `${tier} seed ${String(seed)}`;
        expect(backward.winner, where).toBe(
          forward.winner === 'p1' ? 'p2' : forward.winner === 'p2' ? 'p1' : forward.winner,
        );
        expect(backward.p1, where).toBe(forward.p2);
        expect(backward.p2, where).toBe(forward.p1);
        expect(backward.steps, where).toBe(forward.steps);
      }
    }
  });
});

interface Played {
  readonly winner: SeatId | 'draw' | null;
  readonly p1: number;
  readonly p2: number;
  readonly steps: number;
}

/**
 * Two bots of one tier, driven straight from the rules with the rolls handed out **by
 * role**: the attacker draws first, then the defender.
 *
 * Drawing by seat instead - p1 always first - is what made a seed and its mirror two
 * different matches, and it is invisible to every other test in this file.
 */
function playRules(seed: number, opener: SeatId, tier: BotDifficulty): Played {
  const state = createState(opener);
  const rng = new Rng(seed);
  const bots = { p1: createBotState(), p2: createBotState() };
  const profile = BOT_PROFILES[tier];
  for (let i = 0; i < 60 * 600; i += 1) {
    for (const seat of [state.attacker, defenderOf(state)]) {
      const action = botAction(state, bots[seat], profile, seat, STEP, rng.float());
      if (action === 'swing' && seat === state.attacker) swing(state);
      else if (action === 'dodge' && seat === defenderOf(state)) dodge(state);
    }
    step(state, STEP, rng);
    const winner = winnerOf(state);
    if (winner !== null) return { winner, p1: state.p1, p2: state.p2, steps: i + 1 };
  }
  return { winner: null, p1: state.p1, p2: state.p2, steps: 60 * 600 };
}
