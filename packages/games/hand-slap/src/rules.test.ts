import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_PROFILES,
  DODGE_COOLDOWN_SECONDS,
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
  otherOf,
  readyDelay,
  resetBotState,
  resetState,
  step,
  swing,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, State } from './rules.js';

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

  it('cannot react faster than a person', () => {
    // Rule 6: a bot never gets speed a human cannot have. A simple visual reaction is
    // about 0.25s, so the hard tier sits at the quick end of human rather than past it.
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      expect(BOT_PROFILES[tier].reaction, tier).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('will not dodge a swing it has not watched long enough', () => {
    const state = createState();
    goLive(state);
    swing(state);
    const bot = createBotState();
    const profile = BOT_PROFILES.hard;
    // One step in: the swing is barely visible.
    expect(botAction(state, bot, profile, defenderOf(state), STEP, 0)).toBe('none');
    // Watched for less than its reaction time: still nothing.
    for (let i = 0; i * STEP < profile.reaction - STEP * 2; i += 1) {
      expect(botAction(state, bot, profile, defenderOf(state), STEP, 0)).toBe('none');
    }
  });

  it('dodges once it has watched the swing for its reaction time', () => {
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
    expect(bot.watched).toBeGreaterThanOrEqual(profile.reaction);
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

  it('clears its watch on reset', () => {
    const bot = createBotState();
    bot.watched = 0.5;
    resetBotState(bot);
    expect(bot.watched).toBe(0);
  });

  it('declares its tiers in a sensible order', () => {
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.flinchRate).toBeGreaterThan(BOT_PROFILES.hard.flinchRate);
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
