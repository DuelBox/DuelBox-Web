import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ALARM_SECONDS,
  BOT_PROFILES,
  MATCH_SECONDS,
  MAX_CASING_SECONDS,
  MIN_CASING_SECONDS,
  MOVE_SECONDS,
  OPEN_SECONDS,
  RAIL_LEFT,
  SETTLE_SECONDS,
  SLOT_COUNT,
  SLOT_WIDTH,
  START_SLOT,
  TARGET_POINTS,
  botIntent,
  canAct,
  casingDelay,
  clampSlot,
  commit,
  createBotIntent,
  createBotState,
  createState,
  handOf,
  isLocked,
  nudge,
  otherOf,
  reach,
  resetBotState,
  resetState,
  slotCentreX,
  slotForX,
  step,
  timeExpired,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, State } from './rules.js';

const STEP = 1 / 60;

function advance(state: State, seconds: number, rng = new Rng(1)): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) step(state, STEP, rng);
}

/** Runs the dark phase out so the diamond is showing. */
function toOpen(state: State, rng = new Rng(1)): void {
  for (let i = 0; i < 60 * 20 && state.phase !== 'open'; i += 1) step(state, STEP, rng);
}

/** Steps until the hand has settled where it is aiming, or gives up. */
function settleHand(state: State, seat: SeatId, rng = new Rng(1)): number {
  const hand = handOf(state, seat);
  let steps = 0;
  while (steps < 600 && hand.slot !== hand.want) {
    step(state, STEP, rng);
    steps += 1;
  }
  return steps;
}

/** A slot that is not the one the diamond is on. */
function wrongSlot(state: State): number {
  return state.diamond === 0 ? 1 : 0;
}

describe('the rail', () => {
  it('centres five pedestals in the logical box', () => {
    // 60 + 5 x 96 + 60 = 600, so the rail is symmetric about the middle and neither seat
    // is nearer to one end than the other.
    expect(SLOT_COUNT).toBe(5);
    expect(RAIL_LEFT + SLOT_COUNT * SLOT_WIDTH + RAIL_LEFT).toBe(600);
  });

  it('starts both hands on the middle pedestal', () => {
    expect(START_SLOT).toBe((SLOT_COUNT - 1) / 2);
    const state = createState();
    expect(state.p1Hand.slot).toBe(START_SLOT);
    expect(state.p2Hand.slot).toBe(START_SLOT);
  });

  it('round-trips every pedestal through its centre', () => {
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      expect(slotForX(slotCentreX(slot))).toBe(slot);
    }
  });

  it('gives the ends to a thumb that lands off the rail', () => {
    // The storm in input-fuzz puts pointers well outside the box, and a person's thumb
    // finds the bezel often enough that "nothing" would be the wrong answer.
    expect(slotForX(-4000)).toBe(0);
    expect(slotForX(4000)).toBe(SLOT_COUNT - 1);
    expect(slotForX(0)).toBe(0);
    expect(slotForX(600)).toBe(SLOT_COUNT - 1);
  });

  it('answers the middle pedestal for a coordinate that is not a number', () => {
    expect(slotForX(Number.NaN)).toBe(START_SLOT);
    expect(clampSlot(Number.POSITIVE_INFINITY)).toBe(SLOT_COUNT - 1);
    expect(clampSlot(Number.NaN)).toBe(START_SLOT);
  });

  it('clamps and rounds a slot', () => {
    expect(clampSlot(-3)).toBe(0);
    expect(clampSlot(99)).toBe(SLOT_COUNT - 1);
    expect(clampSlot(2.4)).toBe(2);
    expect(slotCentreX(-5)).toBe(slotCentreX(0));
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the round', () => {
  it('starts in the dark with no diamond anywhere', () => {
    const state = createState();
    expect(state.phase).toBe('casing');
    expect(state.diamond).toBe(-1);
    expect(state.p1).toBe(0);
    expect(state.p2).toBe(0);
    expect(state.round).toBe(0);
  });

  it('never shows a diamond while the case is shut', () => {
    // The reveal draws the pedestal at the moment the lights come up and not a step
    // earlier, so there is no hidden number for a bot to read early.
    const state = createState();
    const rng = new Rng(4);
    for (let i = 0; i < 60 * 20 && state.phase === 'casing'; i += 1) {
      expect(state.diamond).toBe(-1);
      step(state, STEP, rng);
    }
    expect(state.phase).toBe('open');
  });

  it('puts the diamond on a real pedestal when the lights come up', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = createState();
      toOpen(state, new Rng(seed));
      expect(state.diamond).toBeGreaterThanOrEqual(0);
      expect(state.diamond).toBeLessThan(SLOT_COUNT);
    }
  });

  it('waits a seeded, varying time in the dark', () => {
    const rng = new Rng(9);
    const delays = [casingDelay(rng), casingDelay(rng), casingDelay(rng), casingDelay(rng)];
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(MIN_CASING_SECONDS);
      expect(delay).toBeLessThanOrEqual(MAX_CASING_SECONDS);
    }
    expect(new Set(delays).size, 'a fixed wait would be learnable').toBeGreaterThan(1);
  });

  it('seeds the first dark phase too when it is given a generator', () => {
    const plain = createState();
    const seeded = createState(new Rng(77));
    expect(plain.timer).toBe(MIN_CASING_SECONDS);
    expect(seeded.timer).toBeGreaterThanOrEqual(MIN_CASING_SECONDS);
    expect(seeded.timer).toBeLessThanOrEqual(MAX_CASING_SECONDS);
  });

  it('shuts the case on nobody after the open phase', () => {
    const state = createState();
    toOpen(state, new Rng(3));
    advance(state, OPEN_SECONDS + 0.1, new Rng(3));
    expect(state.phase).toBe('settling');
    expect(state.outcome).toBe('bust');
    expect(state.scorer).toBeNull();
    expect(state.p1 + state.p2).toBe(0);
  });

  it('starts the next round after settling, and counts it', () => {
    const state = createState();
    const rng = new Rng(3);
    toOpen(state, rng);
    advance(state, OPEN_SECONDS + SETTLE_SECONDS + 0.2, rng);
    expect(state.phase).toBe('casing');
    expect(state.diamond).toBe(-1);
    expect(state.round).toBe(1);
  });

  it('leaves each hand where the last round left it', () => {
    // Pre-positioning costs nothing and buys nothing, because the diamond is drawn fresh
    // every reveal. That is the gamble rather than an oversight.
    const state = createState();
    const rng = new Rng(3);
    reach(state, 'p1', 4);
    settleHand(state, 'p1', rng);
    expect(state.p1Hand.slot).toBe(4);
    toOpen(state, rng);
    advance(state, OPEN_SECONDS + SETTLE_SECONDS + 0.2, rng);
    expect(state.phase).toBe('casing');
    expect(state.p1Hand.slot, 'the hand stayed where it was').toBe(4);
    expect(state.p1Hand.want).toBe(4);
  });

  it('resets in place', () => {
    const state = createState();
    const rng = new Rng(3);
    reach(state, 'p1', 0);
    toOpen(state, rng);
    advance(state, 2, rng);
    resetState(state);
    expect(state.phase).toBe('casing');
    expect(state.diamond).toBe(-1);
    expect(state.clock).toBe(0);
    expect(state.round).toBe(0);
    expect(state.p1Hand.slot).toBe(START_SLOT);
    expect(state.p2Hand.slot).toBe(START_SLOT);
    expect(state.p1Hand.armed).toBe(false);
  });
});

describe('moving a hand', () => {
  it('walks one pedestal at a time towards the aim', () => {
    const state = createState();
    reach(state, 'p1', 4);
    expect(state.p1Hand.want).toBe(4);
    expect(state.p1Hand.slot, 'a reach is not a teleport').toBe(START_SLOT);
    step(state, STEP, new Rng(1));
    expect(state.p1Hand.slot).toBe(START_SLOT + 1);
  });

  it('takes one MOVE_SECONDS per pedestal', () => {
    const state = createState();
    reach(state, 'p1', 0);
    const steps = settleHand(state, 'p1');
    // Two pedestals from the middle: the first move is immediate, the second waits.
    expect(steps * STEP).toBeGreaterThan(MOVE_SECONDS * 0.9);
    expect(steps * STEP).toBeLessThan(MOVE_SECONDS * 2);
  });

  it('answers a held key exactly as fast as a named pedestal', () => {
    // The whole of control parity, in one assertion. A pointer names the far pedestal in
    // one gesture; a key walks there. The *hand* must arrive on the same step either way,
    // or one instrument is simply better and no amount of tuning fixes it.
    const byPointer = createState();
    reach(byPointer, 'p1', SLOT_COUNT - 1);
    let pointerSteps = 0;
    while (byPointer.p1Hand.slot !== SLOT_COUNT - 1 && pointerSteps < 600) {
      step(byPointer, STEP, new Rng(1));
      pointerSteps += 1;
    }

    const byKey = createState();
    let keySteps = 0;
    while (byKey.p1Hand.slot !== SLOT_COUNT - 1 && keySteps < 600) {
      nudge(byKey, 'p1', 1);
      step(byKey, STEP, new Rng(1));
      keySteps += 1;
    }

    expect(pointerSteps).toBeGreaterThan(0);
    expect(keySteps, 'a held key and a thumb cross the rail together').toBe(pointerSteps);
  });

  it('will not let a held key run the aim ahead of the hand', () => {
    const state = createState();
    nudge(state, 'p1', 1);
    expect(state.p1Hand.want).toBe(START_SLOT + 1);
    expect(nudge(state, 'p1', 1), 'the hand has not caught up yet').toBe(false);
    expect(state.p1Hand.want).toBe(START_SLOT + 1);
  });

  it('refuses a nudge with no direction in it', () => {
    const state = createState();
    expect(nudge(state, 'p1', 0)).toBe(false);
    expect(nudge(state, 'p1', Number.NaN)).toBe(false);
    expect(state.p1Hand.want).toBe(START_SLOT);
  });

  it('cannot be nudged off either end of the rail', () => {
    const state = createState();
    reach(state, 'p1', 0);
    settleHand(state, 'p1');
    expect(nudge(state, 'p1', -1)).toBe(false);
    expect(state.p1Hand.want).toBe(0);
    reach(state, 'p1', SLOT_COUNT - 1);
    settleHand(state, 'p1');
    expect(nudge(state, 'p1', 1)).toBe(false);
    expect(state.p1Hand.want).toBe(SLOT_COUNT - 1);
  });

  it('clamps a reach that names a pedestal off the rail', () => {
    const state = createState();
    reach(state, 'p1', 99);
    expect(state.p1Hand.want).toBe(SLOT_COUNT - 1);
    reach(state, 'p1', -99);
    expect(state.p1Hand.want).toBe(0);
  });

  it('refuses a reach that changes nothing', () => {
    const state = createState();
    expect(reach(state, 'p1', START_SLOT)).toBe(false);
    expect(reach(state, 'p1', 1)).toBe(true);
  });

  it('crosses the rail in the same time at 60 Hz and at 120 Hz', () => {
    const cross = (delta: number): number => {
      const state = createState();
      reach(state, 'p1', SLOT_COUNT - 1);
      let elapsed = 0;
      while (state.p1Hand.slot !== SLOT_COUNT - 1 && elapsed < 5) {
        step(state, delta, new Rng(1));
        elapsed += delta;
      }
      return elapsed;
    };
    // The move timer carries its remainder rather than resetting, so the pace of a hand
    // is a rate rather than a multiple of whatever the step happens to be.
    expect(Math.abs(cross(1 / 60) - cross(1 / 120))).toBeLessThan(1 / 60);
  });

  it('moves neither hand while the board is settling', () => {
    const state = createState();
    const rng = new Rng(3);
    toOpen(state, rng);
    advance(state, OPEN_SECONDS + 0.1, rng);
    expect(state.phase).toBe('settling');
    expect(reach(state, 'p1', 0)).toBe(false);
    expect(nudge(state, 'p2', 1)).toBe(false);
    expect(canAct(state, 'p1')).toBe(false);
  });
});

describe('grabbing', () => {
  it('is committed, not resolved, at the moment of the press', () => {
    const state = createState();
    toOpen(state, new Rng(6));
    reach(state, 'p1', wrongSlot(state));
    expect(commit(state, 'p1')).toBe(true);
    expect(state.p1Hand.armed).toBe(true);
    expect(state.p1Hand.lock, 'nothing has happened yet').toBe(0);
  });

  it('refuses a second commit while one is already armed', () => {
    const state = createState();
    expect(commit(state, 'p1')).toBe(true);
    expect(commit(state, 'p1')).toBe(false);
  });

  it('scores when the hand closes on the diamond', () => {
    const state = createState();
    const rng = new Rng(6);
    toOpen(state, rng);
    reach(state, 'p1', state.diamond);
    commit(state, 'p1');
    settleHand(state, 'p1', rng);
    step(state, STEP, rng);
    expect(state.p1).toBe(1);
    expect(state.p2).toBe(0);
    expect(state.scorer).toBe('p1');
    expect(state.outcome).toBe('steal');
    expect(state.phase).toBe('settling');
  });

  it('trips the alarm when the hand closes on the wrong pedestal', () => {
    const state = createState();
    const rng = new Rng(6);
    toOpen(state, rng);
    reach(state, 'p1', wrongSlot(state));
    commit(state, 'p1');
    settleHand(state, 'p1', rng);
    step(state, STEP, rng);
    expect(state.p1).toBe(0);
    expect(isLocked(state.p1Hand)).toBe(true);
    expect(state.p1Hand.armed, 'the grab is spent').toBe(false);
    expect(state.phase, 'the round carries on for the other thief').toBe('open');
  });

  it('freezes a caught hand outright', () => {
    const state = createState();
    const rng = new Rng(6);
    toOpen(state, rng);
    reach(state, 'p1', wrongSlot(state));
    commit(state, 'p1');
    settleHand(state, 'p1', rng);
    step(state, STEP, rng);
    const caught = state.p1Hand.slot;
    expect(reach(state, 'p1', SLOT_COUNT - 1), 'a caught hand takes no orders').toBe(false);
    expect(commit(state, 'p1')).toBe(false);
    advance(state, 0.3, rng);
    expect(state.p1Hand.slot).toBe(caught);
  });

  it('lets the alarm go after its own time', () => {
    const state = createState();
    const rng = new Rng(6);
    toOpen(state, rng);
    reach(state, 'p1', wrongSlot(state));
    commit(state, 'p1');
    settleHand(state, 'p1', rng);
    step(state, STEP, rng);
    expect(isLocked(state.p1Hand)).toBe(true);
    advance(state, ALARM_SECONDS + 0.05, rng);
    expect(isLocked(state.p1Hand)).toBe(false);
    expect(canAct(state, 'p1')).toBe(true);
  });

  it('does not resolve a grab that is still travelling', () => {
    const state = createState();
    const rng = new Rng(6);
    toOpen(state, rng);
    reach(state, 'p1', state.diamond === 4 ? 0 : 4);
    commit(state, 'p1');
    step(state, STEP, rng);
    expect(state.p1Hand.slot).not.toBe(state.p1Hand.want);
    expect(state.p1 + state.p2, 'nothing has closed yet').toBe(0);
    expect(isLocked(state.p1Hand)).toBe(false);
  });

  it('fires a grab armed in the dark on the very step the lights come up', () => {
    // The gamble. Whether it pays depends only on where the diamond lands, so the test
    // asserts the pair of outcomes rather than picking a seed that flatters one of them.
    let scored = 0;
    let caught = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      const state = createState();
      const rng = new Rng(seed);
      commit(state, 'p1');
      for (let i = 0; i < 60 * 20 && state.phase === 'casing'; i += 1) step(state, STEP, rng);
      expect(state.p1Hand.armed, 'the gamble was spent at the reveal').toBe(false);
      if (state.diamond === START_SLOT) {
        expect(state.p1).toBe(1);
        scored += 1;
      } else {
        expect(isLocked(state.p1Hand)).toBe(true);
        caught += 1;
      }
    }
    expect(scored, 'a blind commit sometimes lands').toBeGreaterThan(0);
    expect(caught, 'and mostly does not').toBeGreaterThan(scored);
  });

  it('shares the round when both hands close on the diamond together', () => {
    // A step is 16.7 ms, inside the tolerance `resolveSimultaneous` calls a genuine draw,
    // so the round is shared rather than handed to whichever seat is checked first.
    const state = createState();
    const rng = new Rng(6);
    toOpen(state, rng);
    reach(state, 'p1', state.diamond);
    reach(state, 'p2', state.diamond);
    commit(state, 'p1');
    commit(state, 'p2');
    for (let i = 0; i < 120 && state.phase === 'open'; i += 1) step(state, STEP, rng);
    expect(state.scorer).toBe('both');
    expect(state.p1).toBe(1);
    expect(state.p2).toBe(1);
  });

  it('refuses a commit while the board is settling', () => {
    const state = createState();
    const rng = new Rng(3);
    toOpen(state, rng);
    advance(state, OPEN_SECONDS + 0.1, rng);
    expect(state.phase).toBe('settling');
    expect(commit(state, 'p1')).toBe(false);
  });

  it('clears both hands for the next round', () => {
    const state = createState();
    const rng = new Rng(6);
    toOpen(state, rng);
    reach(state, 'p1', wrongSlot(state));
    commit(state, 'p1');
    settleHand(state, 'p1', rng);
    step(state, STEP, rng);
    expect(isLocked(state.p1Hand)).toBe(true);
    advance(state, OPEN_SECONDS + SETTLE_SECONDS + 0.2, rng);
    expect(state.phase).toBe('casing');
    expect(isLocked(state.p1Hand), 'the alarm does not follow you into the next round').toBe(false);
    expect(state.p1Hand.armed).toBe(false);
  });
});

describe('the two seats', () => {
  it('gives the same rules to both of them', () => {
    // Mirrored: the identical script played from the other seat must produce the mirrored
    // match, point for point, or one seat is playing a different game.
    const playAs = (seat: SeatId): string => {
      const state = createState();
      const rng = new Rng(31);
      const out: string[] = [];
      for (let i = 0; i < 60 * 60; i += 1) {
        if (state.phase === 'open' && canAct(state, seat)) {
          reach(state, seat, state.diamond);
          commit(state, seat);
        }
        step(state, STEP, rng);
        out.push(`${String(state.p1)}:${String(state.p2)}`);
      }
      return out.join('|');
    };
    const asP1 = playAs('p1');
    const asP2 = playAs('p2');
    const mirrored = asP2
      .split('|')
      .map((entry) => entry.split(':').reverse().join(':'))
      .join('|');
    expect(asP1).toBe(mirrored);
  });

  it('moves one seat without touching the other', () => {
    const state = createState();
    reach(state, 'p1', 0);
    expect(handOf(state, 'p1').want).toBe(0);
    expect(handOf(state, 'p2').want, 'the far hand did not move').toBe(START_SLOT);
  });
});

describe('the win condition', () => {
  it('has no winner while the match is running', () => {
    expect(winnerOf(createState())).toBeNull();
  });

  it('is decided by the first seat to the target', () => {
    const state = createState();
    state.p1 = TARGET_POINTS;
    expect(winnerOf(state)).toBe('p1');
    state.p1 = 0;
    state.p2 = TARGET_POINTS;
    expect(winnerOf(state)).toBe('p2');
  });

  it('calls a shared crossing a draw', () => {
    // Both seats can cross in the same step, because a shared round scores for both.
    const state = createState();
    state.p1 = TARGET_POINTS;
    state.p2 = TARGET_POINTS;
    expect(winnerOf(state)).toBe('draw');
  });

  it('settles on the higher score when the backstop clock runs out', () => {
    const state = createState();
    state.clock = MATCH_SECONDS;
    state.p1 = 2;
    state.p2 = 1;
    expect(timeExpired(state)).toBe(true);
    expect(winnerOf(state)).toBe('p1');
  });

  it('draws a level match on the backstop clock', () => {
    const state = createState();
    state.clock = MATCH_SECONDS + 1;
    expect(winnerOf(state)).toBe('draw');
  });

  it('leaves the clock alone until it has actually run', () => {
    const state = createState();
    state.clock = MATCH_SECONDS - 0.01;
    state.p1 = 1;
    expect(timeExpired(state)).toBe(false);
    expect(winnerOf(state)).toBeNull();
  });

  it('counts the clock in fixed steps', () => {
    const state = createState();
    advance(state, 3);
    expect(state.clock).toBeCloseTo(3, 6);
  });
});

describe('the bot', () => {
  const intent = createBotIntent();

  it('does nothing at all while the board is settling', () => {
    const state = createState();
    const rng = new Rng(3);
    toOpen(state, rng);
    advance(state, OPEN_SECONDS + 0.1, rng);
    const bot = createBotState();
    bot.watched = 9;
    bot.decided = true;
    botIntent(state, bot, BOT_PROFILES.hard, 'p1', STEP, rng, intent);
    expect(intent.aim).toBe(-1);
    expect(intent.commit).toBe(false);
    expect(bot.watched).toBe(0);
    expect(bot.decided).toBe(false);
  });

  it('waits out its own reaction before reaching for anything', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const state = createState();
      const rng = new Rng(12);
      toOpen(state, rng);
      const bot = createBotState();
      let waited = 0;
      let committed = false;
      for (let i = 0; i < 600 && !committed; i += 1) {
        botIntent(state, bot, BOT_PROFILES[tier], 'p1', STEP, rng, intent);
        waited += STEP;
        committed = intent.commit;
      }
      expect(committed, `${tier} eventually reaches`).toBe(true);
      expect(waited, `${tier} never beats its own reaction`).toBeGreaterThanOrEqual(
        BOT_PROFILES[tier].reaction,
      );
    }
  });

  it('never reacts faster than a person can', () => {
    // A simple visual reaction is about 0.25 s. Rule 6: a bot gets no speed a human
    // cannot have, and in a race that is the rule most easily broken by accident.
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      expect(BOT_PROFILES[tier].reaction).toBeGreaterThanOrEqual(0.25);
    }
  });

  it('orders its three tiers', () => {
    const { easy, normal, hard } = BOT_PROFILES;
    expect(easy.reaction).toBeGreaterThan(normal.reaction);
    expect(normal.reaction).toBeGreaterThan(hard.reaction);
    expect(easy.slipChance).toBeGreaterThan(normal.slipChance);
    expect(normal.slipChance).toBeGreaterThan(hard.slipChance);
    expect(easy.gambleRate).toBeGreaterThan(normal.gambleRate);
    expect(normal.gambleRate).toBeGreaterThan(hard.gambleRate);
    expect(easy.driftRate).toBeGreaterThan(hard.driftRate);
  });

  it('reaches sooner on hard than on easy', () => {
    const meanWait = (tier: BotDifficulty): number => {
      let total = 0;
      let runs = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const state = createState();
        const rng = new Rng(seed * 17);
        toOpen(state, rng);
        const bot = createBotState();
        for (let i = 0; i < 600; i += 1) {
          botIntent(state, bot, BOT_PROFILES[tier], 'p1', STEP, rng, intent);
          if (intent.commit) {
            total += i * STEP;
            runs += 1;
            break;
          }
        }
      }
      return total / runs;
    };
    expect(meanWait('hard')).toBeLessThan(meanWait('easy'));
  });

  it('gambles in the dark far more often on easy than on hard', () => {
    const gambles = (tier: BotDifficulty): number => {
      let count = 0;
      for (let seed = 1; seed <= 40; seed += 1) {
        const state = createState();
        const rng = new Rng(seed * 23);
        const bot = createBotState();
        for (let i = 0; i < 60 && state.phase === 'casing'; i += 1) {
          botIntent(state, bot, BOT_PROFILES[tier], 'p1', STEP, rng, intent);
          if (intent.commit) count += 1;
          if (intent.aim >= 0) reach(state, 'p1', intent.aim);
          if (intent.commit) commit(state, 'p1');
          step(state, STEP, rng);
        }
      }
      return count;
    };
    expect(gambles('easy')).toBeGreaterThan(gambles('hard'));
  });

  it('slips onto a neighbouring pedestal, never off the rail', () => {
    const state = createState();
    const rng = new Rng(19);
    toOpen(state, rng);
    const bot = createBotState();
    for (let i = 0; i < 400; i += 1) {
      botIntent(state, bot, BOT_PROFILES.easy, 'p1', STEP, rng, intent);
      if (intent.aim >= 0) {
        expect(intent.aim).toBeGreaterThanOrEqual(0);
        expect(intent.aim).toBeLessThan(SLOT_COUNT);
      }
    }
  });

  it('has nothing to read while the case is shut', () => {
    // The information argument, made mechanical: during the dark phase there is no
    // diamond in the state at all, so the bot cannot be reading one.
    const state = createState();
    const rng = new Rng(21);
    const bot = createBotState();
    for (let i = 0; i < 60 * 5 && state.phase === 'casing'; i += 1) {
      botIntent(state, bot, BOT_PROFILES.hard, 'p1', STEP, rng, intent);
      expect(state.diamond).toBe(-1);
      step(state, STEP, rng);
    }
  });

  it('stops thinking while the alarm holds its hand', () => {
    const state = createState();
    const rng = new Rng(6);
    toOpen(state, rng);
    reach(state, 'p1', wrongSlot(state));
    commit(state, 'p1');
    settleHand(state, 'p1', rng);
    step(state, STEP, rng);
    expect(isLocked(state.p1Hand)).toBe(true);
    const bot = createBotState();
    bot.decided = true;
    botIntent(state, bot, BOT_PROFILES.hard, 'p1', STEP, rng, intent);
    expect(intent.commit).toBe(false);
    expect(bot.decided).toBe(false);
  });

  it('resets its whole memory', () => {
    const bot = createBotState();
    bot.watched = 3;
    bot.delay = 0.4;
    bot.decided = true;
    resetBotState(bot);
    expect(bot).toEqual({ watched: 0, delay: -1, decided: false });
  });
});

describe('determinism', () => {
  it('deals the same diamonds from the same seed', () => {
    const deal = (seed: number): string => {
      const state = createState();
      const rng = new Rng(seed);
      const out: number[] = [];
      let seen = -1;
      for (let i = 0; i < 60 * 60; i += 1) {
        step(state, STEP, rng);
        if (state.phase === 'open' && state.diamond !== seen) {
          seen = state.diamond;
          out.push(seen);
        }
        if (state.phase === 'casing') seen = -1;
      }
      return out.join(',');
    };
    expect(deal(404)).toBe(deal(404));
    expect(deal(404)).not.toBe(deal(405));
    expect(deal(404).length).toBeGreaterThan(0);
  });

  it('replays a whole scripted match identically', () => {
    const trace = (): string => {
      const state = createState();
      const rng = new Rng(88);
      const out: string[] = [];
      for (let i = 0; i < 60 * 90; i += 1) {
        if (state.phase === 'open' && canAct(state, 'p2')) {
          reach(state, 'p2', state.diamond);
          commit(state, 'p2');
        }
        step(state, STEP, rng);
        out.push(`${state.phase[0] ?? '?'}${String(state.p1Hand.slot)}${String(state.p2)}`);
      }
      return out.join('');
    };
    expect(trace()).toBe(trace());
  });
});
