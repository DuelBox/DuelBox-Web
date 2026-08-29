import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_SECONDS,
  CARRY_GAP,
  FALL_SECONDS,
  HOVER_MAX,
  HOVER_MIN,
  IMPACT,
  KINDS,
  KIND_COUNT,
  LEAN,
  LEAN_OMEGA,
  LEAN_ZETA,
  MIN_CONTACT,
  OPENING_SECONDS,
  PIECE_CAP,
  PLINTH_HALF,
  RELOAD_SECONDS,
  ROUND_SECONDS,
  SETTLE_MAX_SECONDS,
  SLOT_LIMIT,
  SLOT_PITCH,
  SLOT_SECONDS,
  SWAY_BASE,
  SWAY_KNEE,
  SWING,
  advanceWobble,
  botIntent,
  breakTie,
  certainlySafe,
  clearIntent,
  createBotState,
  createIntent,
  createMatch,
  createWobble,
  dealWindowHigh,
  dealWindowLow,
  deliveryReachAt,
  driftAt,
  fallStepsFor,
  finished,
  hoverSecondsAt,
  landingSlackFor,
  marginAt,
  predictLean,
  predictStepsFor,
  predictSwing,
  resetMatch,
  ringAmplitude,
  slotOfX,
  step,
  supportHalfAt,
  swayScaleAt,
  weightAt,
  winnerOf,
  worldXOf,
  worldYOf,
  xOfWorld,
  yardOf,
} from './rules.js';
import type { BotDifficulty, BotState, Intent, Match, Wobble, Yard } from './rules.js';

const STEP = 1 / 60;

/* ------------------------------------------------------------------ helpers */

function idle(): Intent {
  return createIntent();
}

/**
 * A yard's stance, read through a call so the checker cannot narrow it.
 *
 * `while (yard.stance === 'falling')` after an `if (yard.stance === 'hover')` is a lint
 * error, because the checker believes a value it watched being compared cannot change —
 * and here it does, because `step` changed it.
 */
function stanceOf(yard: Readonly<Yard>): string {
  return yard.stance;
}

/** A match whose whole deal is written down, so a mirrored copy can be written down too. */
function fixedDeal(match: Match, seed: number, sign = 1): void {
  const rng = new Rng(seed);
  for (let i = 0; i < PIECE_CAP; i += 1) {
    match.dealKind[i] = rng.int(dealWindowLow(i), dealWindowHigh(i) + 1);
    const magnitude = rng.int(2, deliveryReachAt(i) + 1);
    match.dealSlot[i] = (rng.bool() ? magnitude : -magnitude) * sign;
  }
  match.dealtUpTo = PIECE_CAP;
}

/** Negative zero is the same number as zero here; `Object.is` disagrees. */
function flat(value: number): number {
  return value === 0 ? 0 : value;
}

/** Everything about a yard that the simulation decides, flattened. */
function snapshot(yard: Readonly<Yard>): (number | string | boolean)[] {
  const raw: (number | string | boolean)[] = [
    yard.count,
    yard.top,
    yard.mass,
    yard.com,
    yard.comHeight,
    yard.lean.value,
    yard.lean.rate,
    yard.lean.rest,
    yard.lean.low,
    yard.lean.high,
    yard.swing.value,
    yard.swing.rate,
    yard.swing.rest,
    yard.swing.low,
    yard.swing.high,
    yard.dealt,
    yard.stance,
    yard.slot,
    yard.cool,
    yard.hover,
    yard.fall,
    yard.reload,
    yard.settle,
    yard.dropX,
    yard.out,
    yard.loss,
    yard.worst,
    yard.flashX,
  ];
  for (let i = 0; i < yard.count; i += 1) {
    const piece = yard.pieces[i];
    raw.push(piece?.kind ?? -1, piece?.x ?? 0, piece?.base ?? 0);
  }
  return raw.map((value) => (typeof value === 'number' ? flat(value) : value));
}

/**
 * The same yard seen from the other side of the device.
 *
 * Every signed quantity negates; the two ends of an interval swap as well as negate; every
 * magnitude, clock and count is untouched. Anything this function gets wrong shows up as a
 * failure rather than as a false pass, because the mirrored run is a real run.
 */
function mirrorSnapshot(shot: (number | string | boolean)[]): (number | string | boolean)[] {
  const out = shot.slice();
  const negate = [3, 5, 6, 7, 10, 11, 12, 17, 23, 27];
  for (const i of negate) out[i] = flat(-(out[i] as number));
  // low and high are the two ends of an interval: negating swaps them.
  out[8] = flat(-(shot[9] as number));
  out[9] = flat(-(shot[8] as number));
  out[13] = flat(-(shot[14] as number));
  out[14] = flat(-(shot[13] as number));
  for (let i = 28; i < out.length; i += 3) out[i + 1] = flat(-(shot[i + 1] as number));
  return out;
}

/** Write `src` into `dst` as its mirror image, so the bot can be asked about both. */
function mirrorYardInto(dst: Yard, src: Readonly<Yard>): void {
  dst.count = src.count;
  dst.top = src.top;
  dst.mass = src.mass;
  dst.com = -src.com;
  dst.comHeight = src.comHeight;
  dst.lean.value = -src.lean.value;
  dst.lean.rate = -src.lean.rate;
  dst.lean.rest = -src.lean.rest;
  dst.lean.low = -src.lean.high;
  dst.lean.high = -src.lean.low;
  dst.swing.value = -src.swing.value;
  dst.swing.rate = -src.swing.rate;
  dst.swing.rest = -src.swing.rest;
  dst.swing.low = -src.swing.high;
  dst.swing.high = -src.swing.low;
  dst.dealt = src.dealt;
  dst.stance = src.stance;
  dst.slot = -src.slot;
  dst.cool = src.cool;
  dst.hover = src.hover;
  dst.fall = src.fall;
  dst.reload = src.reload;
  dst.settle = src.settle;
  dst.dropX = -src.dropX;
  dst.out = src.out;
  dst.loss = src.loss;
  dst.worst = src.worst;
  dst.flash = src.flash;
  dst.flashX = -src.flashX;
  for (let i = 0; i < PIECE_CAP; i += 1) {
    const to = dst.pieces[i]!;
    const from = src.pieces[i]!;
    to.kind = from.kind;
    to.x = -from.x;
    to.base = from.base;
  }
}

interface Script {
  aim(seat: SeatId, tick: number): number;
  drop(seat: SeatId, tick: number): boolean;
}

function seededScript(seed: number): Script {
  const rolls: number[] = [];
  const rng = new Rng(seed);
  for (let i = 0; i < 20000; i += 1) rolls.push(rng.float());
  const at = (i: number): number => rolls[i % rolls.length] ?? 0;
  return {
    aim: (seat, tick) => {
      const roll = at(tick * 7 + (seat === 'p1' ? 0 : 3));
      return Math.round((roll * 2 - 1) * SLOT_LIMIT);
    },
    drop: (seat, tick) => at(tick * 11 + (seat === 'p1' ? 1 : 5)) < 0.02,
  };
}

/** Play a match through a deal that is written down, so it can be mirrored exactly. */
function playScripted(
  seed: number,
  script: Script,
  sign: number,
  steps: number,
  onStep?: (match: Match, tick: number) => void,
): Match {
  const match = createMatch();
  fixedDeal(match, seed, sign);
  const rng = new Rng(1);
  const p1 = createIntent();
  const p2 = createIntent();
  for (let tick = 0; tick < steps; tick += 1) {
    for (const [seat, intent] of [
      ['p1', p1],
      ['p2', p2],
    ] as const) {
      clearIntent(intent);
      intent.aimActive = true;
      intent.aimSlot = script.aim(seat, tick) * sign;
      intent.drop = script.drop(seat, tick);
    }
    step(match, p1, p2, STEP, rng);
    onStep?.(match, tick);
    if (winnerOf(match) !== null) break;
  }
  return match;
}

function playBots(
  seed: number,
  p1: BotDifficulty,
  p2: BotDifficulty,
  delta = STEP,
): { match: Match; steps: number; winner: SeatId | 'draw' | null } {
  const match = createMatch();
  const rng = new Rng(seed);
  const bots: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
  const intents: Record<SeatId, Intent> = { p1: createIntent(), p2: createIntent() };
  const tiers: Record<SeatId, BotDifficulty> = { p1, p2 };
  let winner: SeatId | 'draw' | null = null;
  let steps = 0;
  const limit = Math.round(600 / delta);
  for (; steps < limit; steps += 1) {
    for (const seat of ['p1', 'p2'] as const) {
      botIntent(yardOf(match, seat), tiers[seat], bots[seat], delta, rng, intents[seat]);
    }
    step(match, intents.p1, intents.p2, delta, rng);
    winner = winnerOf(match);
    if (winner !== null) break;
  }
  return { match, steps, winner };
}

/* ------------------------------------------------------------------ the board */

describe('the board', () => {
  it('is a point reflection about the centre of the field', () => {
    for (const x of [-154, -22, 0, 37.5, 154]) {
      expect(worldXOf('p1', x) + worldXOf('p2', x)).toBeCloseTo(600, 12);
      expect(xOfWorld('p1', worldXOf('p1', x))).toBeCloseTo(x, 12);
      expect(xOfWorld('p2', worldXOf('p2', x))).toBeCloseTo(x, 12);
    }
    for (const h of [0, 74, 300]) {
      expect(worldYOf('p1', h) + worldYOf('p2', h)).toBeCloseTo(1000, 12);
    }
  });

  it('reads a finger exactly between two notches the same way on both sides', () => {
    // Math.round breaks ties upwards, which is not covariant under the half turn. The
    // engine quantises pointers onto a 3-unit lattice and 11 is a multiple of 3, so this
    // is an everyday tie rather than a measure-zero one.
    for (let slot = 0; slot < SLOT_LIMIT; slot += 1) {
      const between = slot * SLOT_PITCH + SLOT_PITCH / 2;
      expect(slotOfX(-between)).toBe(-slotOfX(between));
    }
  });

  it('keeps the whole rail on the field, brainrot included', () => {
    const widest = Math.max(...KINDS.map((kind) => kind.half));
    expect(SLOT_LIMIT * SLOT_PITCH + widest).toBeLessThan(300);
  });

  it('puts the losing move within reach of every notch', () => {
    // Notch 4 already overhangs the plinth: "drop one off the platform" has to be a move
    // somebody can make, or the rule is about nothing.
    expect(4 * SLOT_PITCH).toBeGreaterThan(PLINTH_HALF);
    expect(2 * SLOT_PITCH).toBeLessThan(PLINTH_HALF);
  });

  it('always leaves at least one legal notch, for every pair of brainrots', () => {
    // The window a brainrot may land in is 2 * (half + supportHalf - MIN_CONTACT) wide. If
    // that were ever narrower than one notch, a placement would be impossible rather than
    // hard, and the game would decide matches by arithmetic nobody could see.
    for (let upper = 0; upper < KIND_COUNT; upper += 1) {
      for (let lower = 0; lower < KIND_COUNT; lower += 1) {
        const window = 2 * landingSlackFor(upper, KINDS[lower]?.half ?? 0);
        expect(
          window,
          `${KINDS[upper]?.name ?? '?'} on ${KINDS[lower]?.name ?? '?'}`,
        ).toBeGreaterThanOrEqual(SLOT_PITCH);
      }
    }
  });

  it('always gives the carrier time to walk in from wherever it was delivered', () => {
    for (let i = 0; i < PIECE_CAP; i += 1) {
      const reach = deliveryReachAt(i);
      // The hover clock must always cover the walk in from wherever the carrier was
      // delivered, or a placement would be impossible rather than hard. The margin
      // narrows from 2.13 s to 0.25 s, which is the difficulty ramp as time.
      expect(hoverSecondsAt(i)).toBeGreaterThan(reach * SLOT_SECONDS);
      // And it is never delivered where doing nothing is safe.
      expect(reach).toBeGreaterThanOrEqual(2);
    }
    expect(hoverSecondsAt(0)).toBe(HOVER_MAX);
    expect(hoverSecondsAt(PIECE_CAP - 1)).toBe(HOVER_MIN);
  });

  it('deals brainrots that get worse as the tower grows', () => {
    expect(dealWindowHigh(0)).toBe(1);
    expect(dealWindowHigh(PIECE_CAP - 1)).toBe(KIND_COUNT - 1);
    for (let i = 1; i < PIECE_CAP; i += 1) {
      expect(dealWindowHigh(i)).toBeGreaterThanOrEqual(dealWindowHigh(i - 1));
      expect(dealWindowLow(i)).toBeGreaterThanOrEqual(dealWindowLow(i - 1));
    }
    for (let i = 1; i < KIND_COUNT; i += 1) {
      expect(KINDS[i]!.half).toBeLessThan(KINDS[i - 1]!.half);
    }
  });

  it('amplifies an imbalance faster the taller the tower gets', () => {
    // The whole difficulty ramp, and it is arithmetic rather than a table: five units of
    // offset are worth 9 units of weight two brainrots up and 158 twenty brainrots up.
    const weightFor = (offset: number, height: number): number =>
      Math.abs(offset + height * (offset / swayScaleAt(height)));
    expect(weightFor(5, 30)).toBeLessThan(PLINTH_HALF);
    expect(weightFor(5, 350)).toBeGreaterThan(PLINTH_HALF);
    let previous = 0;
    for (const height of [10, 40, 120, 250, 400]) {
      const seen = weightFor(1, height);
      expect(seen).toBeGreaterThan(previous);
      previous = seen;
    }
    expect(swayScaleAt(0)).toBe(SWAY_BASE);
    expect(swayScaleAt(SWAY_KNEE)).toBe(SWAY_BASE / 2);
  });
});

/* ------------------------------------------------------------------ the integrator */

describe('the wobble', () => {
  const kick = (): Wobble => {
    const wobble = createWobble();
    wobble.value = 0.11;
    wobble.rate = -0.9;
    wobble.rest = 0.03;
    return wobble;
  };

  function runFor(seconds: number, delta: number): Wobble {
    const wobble = kick();
    const steps = Math.round(seconds / delta);
    for (let i = 0; i < steps; i += 1) advanceWobble(wobble, LEAN, delta);
    return wobble;
  }

  it('reaches the same state at 60, 90, 120 and 240 Hz', () => {
    const rates = [60, 90, 120, 240];
    const results = rates.map((rate) => runFor(1, 1 / rate));
    const base = results[0]!;
    for (let i = 1; i < results.length; i += 1) {
      expect(Math.abs(results[i]!.value - base.value)).toBeLessThan(1e-12);
      expect(Math.abs(results[i]!.rate - base.rate)).toBeLessThan(1e-12);
    }
    // And against the closed form written out here, from the physics rather than from the
    // implementation, so this is not the integrator checked against itself.
    const sigma = LEAN_ZETA * LEAN_OMEGA;
    const omegaD = LEAN_OMEGA * Math.sqrt(1 - LEAN_ZETA * LEAN_ZETA);
    const u0 = 0.11 - 0.03;
    const v0 = -0.9;
    const closed =
      0.03 +
      Math.exp(-sigma) * (u0 * Math.cos(omegaD) + ((v0 + sigma * u0) / omegaD) * Math.sin(omegaD));
    expect(Math.abs(base.value - closed)).toBeLessThan(1e-12);
  });

  it('is nine decimal places tighter than forward Euler is at one step rate', () => {
    // The comparison the choice rests on. Euler on an oscillator gains energy in
    // proportion to the step, so the same tower rings visibly longer on a slow device.
    const euler = (delta: number): number => {
      let value = 0.11;
      let rate = -0.9;
      const steps = Math.round(1 / delta);
      const omegaSq = LEAN_OMEGA * LEAN_OMEGA;
      for (let i = 0; i < steps; i += 1) {
        const accel = -omegaSq * (value - 0.03) - 2 * LEAN_ZETA * LEAN_OMEGA * rate;
        value += rate * delta;
        rate += accel * delta;
      }
      return value;
    };
    const spread = Math.abs(euler(1 / 60) - euler(1 / 240));
    const ours = Math.abs(runFor(1, 1 / 60).value - runFor(1, 1 / 240).value);
    expect(spread).toBeGreaterThan(1e-3);
    expect(ours).toBeLessThan(1e-12);
    expect(spread / Math.max(ours, Number.MIN_VALUE)).toBeGreaterThan(1e9);
  });

  it('reports the extremes inside a step, so a topple cannot be missed between samples', () => {
    // The peak of the ring is what decides a topple, and at 60 Hz the peak usually falls
    // between two samples. Comparing the peak found this way across four step rates is
    // the check that a marginal tower survives or falls the same way on every device.
    const peakAt = (delta: number): number => {
      const wobble = kick();
      let peak = 0;
      const steps = Math.round(1 / delta);
      for (let i = 0; i < steps; i += 1) {
        advanceWobble(wobble, LEAN, delta);
        peak = Math.max(peak, Math.abs(wobble.low), Math.abs(wobble.high));
      }
      return peak;
    };
    const peaks = [60, 90, 120, 240].map((rate) => peakAt(1 / rate));
    for (const peak of peaks) expect(Math.abs(peak - peaks[0]!)).toBeLessThan(1e-9);
    // And it really is finding something the end-of-step samples miss.
    const sampled = ((): number => {
      const wobble = kick();
      let peak = 0;
      for (let i = 0; i < 60; i += 1) {
        advanceWobble(wobble, LEAN, STEP);
        peak = Math.max(peak, Math.abs(wobble.value));
      }
      return peak;
    })();
    expect(peaks[0]!).toBeGreaterThan(sampled);
  });

  it('bounds every lean it will ever reach again', () => {
    const wobble = kick();
    const radius = ringAmplitude(wobble, LEAN);
    let worst = 0;
    for (let i = 0; i < 60 * 8; i += 1) {
      advanceWobble(wobble, LEAN, STEP);
      worst = Math.max(worst, Math.abs(wobble.high - 0.03), Math.abs(wobble.low - 0.03));
    }
    expect(worst).toBeLessThanOrEqual(radius + 1e-12);
    expect(worst).toBeGreaterThan(radius * 0.5);
  });

  it('decides a marginal tower the same way at every step rate', () => {
    // One tower, one kick, poised so the ring crosses the plinth edge by a hair. Four step
    // rates, and all four must agree that it went.
    const verdicts = [60, 90, 120, 240].map((rate) => {
      const delta = 1 / rate;
      const match = createMatch();
      const yard = match.p1;
      yard.count = 1;
      yard.pieces[0]!.kind = 0;
      yard.pieces[0]!.x = 5.5;
      yard.pieces[0]!.base = 0;
      yard.top = 400;
      yard.mass = 1;
      yard.com = 5.5;
      yard.comHeight = 200;
      yard.lean.rest = 5.5 / swayScaleAt(200);
      // Poised so the first peak of the ring clears the plinth edge by a third of a unit,
      // and so that peak falls between two 60 Hz samples.
      yard.lean.value = yard.lean.rest;
      yard.lean.rate = 0.3;
      yard.stance = 'settling';
      yard.settle = SETTLE_MAX_SECONDS;
      const rng = new Rng(1);
      for (let i = 0; i < Math.round(4 / delta) && !finished(yard); i += 1) {
        step(match, idle(), idle(), delta, rng);
      }
      return yard.loss;
    });
    expect(new Set(verdicts).size).toBe(1);
    expect(verdicts[0]).toBe('toppled');
  });
});

/* ------------------------------------------------------------------ the bot's arithmetic */

describe("the bot's prediction", () => {
  it('is bit-identical to what the simulation does, at every step rate', () => {
    // Issue #2465: a bot reasoning analytically about a quantity the simulation integrates
    // is a bot playing a different game. This one does not reason analytically — it runs
    // the simulation's own `advanceWobble` on scratch scalars for exactly the number of
    // steps the simulation will run — so the two agree exactly rather than closely.
    for (const rate of [60, 90, 120, 240]) {
      const delta = 1 / rate;
      const match = createMatch();
      fixedDeal(match, 4242);
      const rng = new Rng(9);
      const yard = match.p1;
      const intent = createIntent();
      let checked = 0;
      for (let i = 0; i < 4000 && checked < 6; i += 1) {
        if (yard.stance === 'hover' && yard.hover < hoverSecondsAt(yard.dealt - 1) - 0.4) {
          const swing = predictSwing(yard, delta);
          const lean = predictLean(yard, delta);
          const dropX = yard.slot * SLOT_PITCH + swing;
          const landed = dropX - lean * yard.top;
          clearIntent(intent);
          intent.drop = true;
          step(match, intent, idle(), delta, rng);
          expect(yard.dropX).toBe(dropX);
          while (stanceOf(yard) === 'falling') step(match, idle(), idle(), delta, rng);
          expect(yard.lean.value).toBe(lean);
          if (!yard.out) {
            expect(yard.pieces[yard.count - 1]!.x).toBe(landed);
            checked += 1;
          } else break;
        } else {
          clearIntent(intent);
          intent.aimActive = true;
          intent.aimSlot = 0;
          step(match, intent, idle(), delta, rng);
        }
      }
      expect(checked, `at ${rate} Hz`).toBeGreaterThanOrEqual(3);
    }
  });

  it('counts the fall the same way the simulation does', () => {
    for (const rate of [60, 90, 120, 240]) {
      const delta = 1 / rate;
      let remaining = FALL_SECONDS;
      let steps = 0;
      while (remaining > 0) {
        remaining -= delta;
        steps += 1;
      }
      expect(fallStepsFor(delta)).toBe(steps);
      expect(predictStepsFor(delta)).toBe(steps + 1);
    }
  });
});

/* ------------------------------------------------------------------ the mirror */

describe('mirror symmetry', () => {
  /**
   * The test that finds what nothing else can.
   *
   * Take a match, mirror the deal, mirror the inputs, run both, and require the results to
   * be mirror images — over hundreds of seeds, on every step. Snowball Throw and Frozen
   * Beaks each shipped a defect only this could see, and both were of the same family: a
   * threshold a state variable lands on *exactly*, from opposite ends, in the last bits.
   */
  it('holds over 300 scripted matches, step by step', () => {
    let compared = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      const script = seededScript(9001 + seed * 13);
      const straight: (number | string | boolean)[][] = [];
      playScripted(seed * 977 + 5, script, 1, 2400, (match) => {
        straight.push(snapshot(match.p1), snapshot(match.p2));
      });
      let tick = 0;
      playScripted(seed * 977 + 5, script, -1, 2400, (match) => {
        const wantP1 = straight[tick * 2];
        const wantP2 = straight[tick * 2 + 1];
        if (wantP1 === undefined || wantP2 === undefined) return;
        expect(snapshot(match.p1), `seed ${seed} tick ${tick} p1`).toEqual(mirrorSnapshot(wantP1));
        expect(snapshot(match.p2), `seed ${seed} tick ${tick} p2`).toEqual(mirrorSnapshot(wantP2));
        compared += 1;
        tick += 1;
      });
    }
    expect(compared).toBeGreaterThan(40000);
  });

  it('holds on every bot decision, over a thousand real positions', () => {
    // The bot's misjudgement is an input like the board is, so mirroring the board means
    // negating it: a bot that misread the landing point by +9 units reads its mirror image
    // by -9. Anything else would be a bot that leans one way on a symmetric position.
    //
    // The positions come from real bot matches rather than from a script, because a
    // scripted hand leaves the tower near the middle and the answer is then notch zero,
    // which is its own mirror image and proves nothing.
    let compared = 0;
    let offCentre = 0;
    const mirror = createMatch();
    for (let seed = 0; seed < 40 && compared < 1200; seed += 1) {
      const match = createMatch();
      const rng = new Rng(seed * 613 + 3);
      const bots: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
      const intents: Record<SeatId, Intent> = { p1: createIntent(), p2: createIntent() };
      const tier: BotDifficulty = seed % 3 === 0 ? 'easy' : seed % 3 === 1 ? 'normal' : 'hard';
      // Seat two is driven by a hand that deliberately marches its tower sideways, so the
      // sample is not all upright towers whose answer is the middle notch — that answer is
      // its own mirror image and would pass this test without testing anything.
      const march = ((seed % 5) - 2) * (seed % 2 === 0 ? 1 : -1);
      for (let tick = 0; tick < 60 * 60 && compared < 1200; tick += 1) {
        botIntent(match.p1, tier, bots.p1, STEP, rng, intents.p1);
        clearIntent(intents.p2);
        intents.p2.aimActive = true;
        intents.p2.aimSlot = march;
        intents.p2.drop = match.p2.slot === march && match.p2.hover < 1.4;
        step(match, intents.p1, intents.p2, STEP, rng);
        if (winnerOf(match) !== null) break;
        const straight = match.p2;
        // Sampled thinly and only once the tower is up, so the sample spreads over forty
        // matches rather than sitting inside the first two brainrots of the first one.
        if (straight.stance !== 'hover' || straight.count < 3 || tick % 5 !== 0) continue;
        mirrorYardInto(mirror.p1, straight);
        expect(snapshot(mirror.p1)).toEqual(mirrorSnapshot(snapshot(straight)));
        for (const asked of ['easy', 'normal', 'hard'] as const) {
          for (const bias of [-11, 0, 6]) {
            const stateA = createBotState();
            const stateB = createBotState();
            stateA.bias = bias;
            stateB.bias = -bias;
            stateA.biasFor = straight.dealt;
            stateB.biasFor = mirror.p1.dealt;
            const outA = createIntent();
            const outB = createIntent();
            // Seed 2024's first draw is 0.739, which is above every tier's blunder
            // chance. Seed 77's is 0.0055, which is below all three — so every call
            // blundered, every answer was the middle notch, and this test passed
            // without asking the bot a single question. `offCentre` below is what
            // catches that, and it caught it.
            botIntent(straight, asked, stateA, STEP, new Rng(2024), outA);
            botIntent(mirror.p1, asked, stateB, STEP, new Rng(2024), outB);
            expect(outB.aimSlot, `seed ${seed} tick ${tick} ${asked}`).toBe(flat(-outA.aimSlot));
            expect(outB.drop).toBe(outA.drop);
            if (outA.aimSlot !== 0) offCentre += 1;
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(1200);
    // A middle-notch answer is its own mirror image, so it would pass trivially. Most of
    // the sample must be somewhere else.
    expect(offCentre).toBeGreaterThan(compared * 0.3);
  });

  it('settles a level match on a magnitude, so the half turn cannot decide it', () => {
    // A tie-break written in board coordinates returns a mirror answer on a mirror board
    // and so decides nothing. `worst` is how much plinth was left, never which way the
    // tower leaned.
    const match = createMatch();
    match.p1.worst = 21.5;
    match.p2.worst = 21.5;
    expect(breakTie(match)).toBe('draw');
    match.p1.worst = 21.5;
    match.p2.worst = 21.4;
    expect(breakTie(match)).toBe('p1');
    match.p1.out = true;
    match.p2.out = true;
    expect(breakTie(match)).toBe('draw');
  });
});

/* ------------------------------------------------------------------ determinism */

describe('determinism', () => {
  it('plays the identical match twice from one seed', () => {
    const a = playBots(20260829, 'normal', 'hard');
    const b = playBots(20260829, 'normal', 'hard');
    expect(snapshot(b.match.p1)).toEqual(snapshot(a.match.p1));
    expect(snapshot(b.match.p2)).toEqual(snapshot(a.match.p2));
    expect(b.steps).toBe(a.steps);
    expect(b.winner).toBe(a.winner);
  });

  it('deals both seats the identical run of brainrots, whatever either of them does', () => {
    // Drawn by index rather than by seat, so what one player does cannot change which
    // brainrots the other is given. One seat is played fast and the other slowly.
    const match = createMatch();
    const rng = new Rng(4321);
    const fast = createIntent();
    const slow = createIntent();
    const seenP1: number[] = [];
    const seenP2: number[] = [];
    for (let tick = 0; tick < 6000; tick += 1) {
      // Both walk to the middle notch; one lets go three times as often as the other.
      clearIntent(fast);
      fast.aimActive = true;
      fast.aimSlot = 0;
      fast.drop = tick % 45 === 0;
      clearIntent(slow);
      slow.aimActive = true;
      slow.aimSlot = 0;
      slow.drop = tick % 130 === 0;
      step(match, fast, slow, STEP, rng);
      if (match.p1.stance === 'hover' && seenP1.length < match.p1.dealt) {
        seenP1.push(match.p1.pieces[match.p1.dealt - 1]!.kind);
      }
      if (match.p2.stance === 'hover' && seenP2.length < match.p2.dealt) {
        seenP2.push(match.p2.pieces[match.p2.dealt - 1]!.kind);
      }
      if (winnerOf(match) !== null) break;
    }
    const shared = Math.min(seenP1.length, seenP2.length);
    expect(shared).toBeGreaterThan(2);
    expect(seenP1.slice(0, shared)).toEqual(seenP2.slice(0, shared));
  });

  it('leaves a reset match indistinguishable from a fresh one', () => {
    const { match } = playBots(31, 'hard', 'easy');
    resetMatch(match);
    expect(match).toEqual(createMatch());
  });

  it('never touches the other seat', () => {
    // The deal is shared and drawn lazily, so a match where p1 races ahead draws it
    // sooner. What must be identical is p2's own play once the deal is written down.
    const busy = createIntent();
    const scripted = createMatch();
    fixedDeal(scripted, 5);
    const other = createMatch();
    fixedDeal(other, 5);
    const rngA = new Rng(2);
    const rngB = new Rng(2);
    for (let tick = 0; tick < 900; tick += 1) {
      clearIntent(busy);
      busy.aimActive = true;
      busy.aimSlot = tick % 2 === 0 ? SLOT_LIMIT : -SLOT_LIMIT;
      busy.drop = tick % 37 === 0;
      step(scripted, busy, idle(), STEP, rngA);
      step(other, idle(), idle(), STEP, rngB);
      expect(snapshot(scripted.p2)).toEqual(snapshot(other.p2));
    }
  });

  it('allocates nothing per step', () => {
    const { match } = playBots(88, 'normal', 'normal');
    const before = match.p1.pieces.slice();
    const rng = new Rng(1);
    const result = step(match, idle(), idle(), STEP, rng);
    expect(step(match, idle(), idle(), STEP, rng)).toBe(result);
    expect(match.p1.pieces.length).toBe(PIECE_CAP);
    for (let i = 0; i < PIECE_CAP; i += 1) expect(match.p1.pieces[i]).toBe(before[i]);
  });
});

/* ------------------------------------------------------------------ termination */

describe('termination', () => {
  it('is bounded by arithmetic, not by hope', () => {
    let hover = 0;
    for (let i = 0; i < PIECE_CAP; i += 1) hover += hoverSecondsAt(i);
    const bound =
      OPENING_SECONDS +
      hover +
      PIECE_CAP * (FALL_SECONDS + RELOAD_SECONDS) +
      SETTLE_MAX_SECONDS +
      // Three steps of slack per clock, because each is checked after it is advanced.
      3 * STEP * (PIECE_CAP * 3 + 2);
    expect(bound).toBeLessThan(ROUND_SECONDS);
    expect(bound).toBeLessThan(600);
    expect(Math.round(bound * 10) / 10).toBeLessThan(60);
  });

  it('ends a match nobody plays', () => {
    // The case a stacking game has to earn: the carrier delivers at least two notches out
    // and lets go by itself, so a brainrot nobody touches eventually misses the tower.
    let worst = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const match = createMatch();
      const rng = new Rng(seed * 31 + 7);
      let steps = 0;
      for (; steps < 60 * 200; steps += 1) {
        step(match, idle(), idle(), STEP, rng);
        if (winnerOf(match) !== null) break;
      }
      expect(winnerOf(match), `seed ${seed}`).not.toBeNull();
      worst = Math.max(worst, steps * STEP);
    }
    expect(worst).toBeLessThan(60);
  });

  it('ends a match somebody mashes', () => {
    const match = createMatch();
    const rng = new Rng(11);
    const mash = createIntent();
    let steps = 0;
    for (; steps < 60 * 200; steps += 1) {
      clearIntent(mash);
      mash.drop = steps % 2 === 0;
      step(match, mash, mash, STEP, rng);
      if (winnerOf(match) !== null) break;
    }
    expect(winnerOf(match)).not.toBeNull();
    expect(steps * STEP).toBeLessThan(60);
  });

  it('ends a match two easy bots play, every time', () => {
    let worst = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const { winner, steps } = playBots(seed * 4099 + 13, 'easy', 'easy');
      expect(winner, `seed ${seed}`).not.toBeNull();
      worst = Math.max(worst, steps * STEP);
    }
    expect(worst).toBeLessThan(60);
  });

  it('ends a match two hard bots play, every time', () => {
    let worst = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const { winner, steps } = playBots(seed * 7919 + 5, 'hard', 'hard');
      expect(winner, `seed ${seed}`).not.toBeNull();
      worst = Math.max(worst, steps * STEP);
    }
    expect(worst).toBeLessThan(60);
  });

  it('has a backstop under the whole thing', () => {
    const match = createMatch();
    match.elapsed = ROUND_SECONDS;
    match.p1.count = 4;
    match.p2.count = 2;
    expect(winnerOf(match)).toBe('p1');
  });
});

/* ------------------------------------------------------------------ the mechanic */

describe('the mechanic, measured', () => {
  /**
   * Spin War shipped with its headline verb impossible — no top was ever pushed out of
   * the bowl across 400 bot matches — and every global guard passed the whole time,
   * because a match still ended and still named a winner. So this is measured, and it is
   * measured without reading a counter that could be wrong in the same way the rule is.
   */
  it('builds towers and knocks them over, across every tier pairing', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    let matches = 0;
    let dealt = 0;
    let standing = 0;
    let fell = 0;
    let toppled = 0;
    let missed = 0;
    let peak = 0;
    for (const a of tiers) {
      for (const b of tiers) {
        for (let seed = 0; seed < 12; seed += 1) {
          const { match, winner } = playBots(seed * 4099 + 7, a, b);
          expect(winner).not.toBeNull();
          matches += 1;
          for (const seat of ['p1', 'p2'] as const) {
            const yard = yardOf(match, seat);
            dealt += yard.dealt;
            standing += yard.count;
            if (yard.loss !== 'none') fell += 1;
            if (yard.loss === 'toppled') toppled += 1;
            if (yard.loss === 'missed') missed += 1;
            peak = Math.max(peak, yard.count);
          }
        }
      }
    }
    expect(matches).toBe(108);
    expect(standing / matches).toBeGreaterThan(10);
    expect(dealt).toBeGreaterThan(standing);
    // Both halves of the rule are reachable and both happen constantly.
    expect(fell).toBeGreaterThan(matches * 0.4);
    expect(toppled).toBeGreaterThan(2);
    expect(missed).toBeGreaterThan(5);
    expect(peak).toBe(PIECE_CAP);
  });

  it('makes shunting cost something, which is the whole game', () => {
    // Crossing the rail is free in time and expensive in swing: the brainrot has to be
    // paid off before it can be let go. A brainrot nobody touches hangs dead still.
    const still = createMatch();
    const rngA = new Rng(3);
    while (still.p1.stance !== 'hover') step(still, idle(), idle(), STEP, rngA);
    for (let i = 0; i < 30; i += 1) step(still, idle(), idle(), STEP, rngA);
    expect(Math.abs(still.p1.swing.value)).toBe(0);

    const walked = createMatch();
    const rngB = new Rng(3);
    const cross = createIntent();
    while (walked.p1.stance !== 'hover') step(walked, idle(), idle(), STEP, rngB);
    let widest = 0;
    for (let i = 0; i < 40; i += 1) {
      clearIntent(cross);
      cross.aimActive = true;
      cross.aimSlot = -SLOT_LIMIT;
      step(walked, cross, idle(), STEP, rngB);
      widest = Math.max(widest, Math.abs(walked.p1.swing.value));
    }
    expect(widest).toBeGreaterThan(SLOT_PITCH / 3);
    // And it dies away, so waiting is a real option rather than a lost cause.
    const after = Math.abs(walked.p1.swing.value);
    for (let i = 0; i < 90; i += 1) step(walked, idle(), idle(), STEP, rngB);
    expect(Math.abs(walked.p1.swing.value)).toBeLessThan(after);
  });

  it('never lets a tower stand with its weight off the plinth', () => {
    // The statics, restated from the physical claim rather than reused from `rules.ts`,
    // and checked at every step of a long run of matches.
    let steps = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const match = createMatch();
      const rng = new Rng(seed * 977 + 3);
      const bots = { p1: createBotState(), p2: createBotState() };
      const intents = { p1: createIntent(), p2: createIntent() };
      for (let tick = 0; tick < 60 * 90; tick += 1) {
        for (const seat of ['p1', 'p2'] as const) {
          botIntent(yardOf(match, seat), 'normal', bots[seat], STEP, rng, intents[seat]);
        }
        step(match, intents.p1, intents.p2, STEP, rng);
        for (const seat of ['p1', 'p2'] as const) {
          const yard = yardOf(match, seat);
          if (yard.out || yard.count === 0) continue;
          let mass = 0;
          let moment = 0;
          let heights = 0;
          for (let i = 0; i < yard.count; i += 1) {
            const piece = yard.pieces[i]!;
            const kind = KINDS[piece.kind]!;
            mass += kind.mass;
            moment += kind.mass * piece.x;
            heights += kind.mass * (piece.base + kind.tall / 2);
          }
          const com = moment / mass;
          const comHeight = heights / mass;
          expect(Math.abs(com - yard.com)).toBeLessThan(1e-9);
          expect(Math.abs(comHeight - yard.comHeight)).toBeLessThan(1e-9);
          expect(Math.abs(com + comHeight * yard.lean.value)).toBeLessThanOrEqual(
            PLINTH_HALF + 1e-9,
          );
          steps += 1;
        }
        if (winnerOf(match) !== null) break;
      }
    }
    expect(steps).toBeGreaterThan(5000);
  });

  it('reports a margin that is a magnitude and never grows', () => {
    const { match } = playBots(1717, 'normal', 'easy');
    for (const seat of ['p1', 'p2'] as const) {
      const yard = yardOf(match, seat);
      expect(yard.worst).toBeLessThanOrEqual(PLINTH_HALF);
      if (yard.count > 0 && !yard.out) {
        expect(yard.worst).toBeLessThanOrEqual(marginAt(yard, yard.lean.value) + 1e-9);
      }
    }
  });

  it('draws every number the bot reads', () => {
    // Rule 6, as an inventory rather than a promise. Each of these is a pure function of
    // the yard, and `game.ts` puts every one of them on the screen.
    const { match } = playBots(99, 'hard', 'hard');
    const yard = match.p1;
    expect(typeof driftAt(yard, yard.top)).toBe('number');
    expect(typeof weightAt(yard, yard.lean.value)).toBe('number');
    expect(typeof supportHalfAt(yard, yard.count)).toBe('number');
    expect(typeof marginAt(yard, yard.lean.value)).toBe('number');
    expect(certainlySafe(yard) || yard.out).toBe(true);
  });
});

/* ------------------------------------------------------------------ the ladder */

describe('the bot ladder', () => {
  function share(a: BotDifficulty, b: BotDifficulty, seeds: number): number {
    let wins = 0;
    let decided = 0;
    for (let i = 0; i < seeds; i += 1) {
      const { winner } = playBots(3 + 977 * i, a, b);
      if (winner === 'p1') {
        wins += 1;
        decided += 1;
      } else if (winner === 'p2') decided += 1;
    }
    return decided === 0 ? 0.5 : wins / decided;
  }

  it('is monotone, and reads the same from either seat', () => {
    expect(share('hard', 'easy', 60)).toBeGreaterThan(0.72);
    expect(share('easy', 'hard', 60)).toBeLessThan(0.28);
    expect(share('hard', 'normal', 60)).toBeGreaterThan(0.58);
    expect(share('normal', 'easy', 60)).toBeGreaterThan(0.58);
  });

  it('keeps seat one inside the 45-55% band at equal skill', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const seen = share(tier, tier, 120);
      expect(seen, `${tier} seat one at ${(seen * 100).toFixed(1)}%`).toBeGreaterThan(0.42);
      expect(seen, `${tier} seat one at ${(seen * 100).toFixed(1)}%`).toBeLessThan(0.58);
    }
  });

  it('holds its misjudgement for a whole brainrot rather than redrawing it', () => {
    // A fresh error sixty times a second averages to zero and every tier plays the same.
    const match = createMatch();
    const rng = new Rng(6);
    const state = createBotState();
    const out = createIntent();
    while (match.p1.stance !== 'hover') step(match, idle(), idle(), STEP, rng);
    botIntent(match.p1, 'easy', state, STEP, rng, out);
    const first = state.bias;
    const forPiece = state.biasFor;
    for (let i = 0; i < 40; i += 1) {
      botIntent(match.p1, 'easy', state, STEP, rng, out);
      step(match, out, idle(), STEP, rng);
      if (stanceOf(match.p1) !== 'hover') break;
      expect(state.bias).toBe(first);
    }
    while (match.p1.dealt === forPiece) step(match, idle(), idle(), STEP, rng);
    if (!match.p1.out) {
      botIntent(match.p1, 'easy', state, STEP, rng, out);
      expect(state.biasFor).not.toBe(forPiece);
    }
  });

  it('never lets a bot read the match, only its own yard', () => {
    const match = createMatch();
    const rng = new Rng(8);
    for (let i = 0; i < 200; i += 1) step(match, idle(), idle(), STEP, rng);
    const before = snapshot(match.p2);
    const state = createBotState();
    const out = createIntent();
    for (let i = 0; i < 200; i += 1) botIntent(match.p1, 'hard', state, STEP, rng, out);
    expect(snapshot(match.p2)).toEqual(before);
  });

  it('blunders for a duration rather than for a frame', () => {
    expect(BLUNDER_SECONDS).toBeGreaterThan(SLOT_SECONDS * 4);
    expect(IMPACT).toBeGreaterThan(0);
    expect(CARRY_GAP).toBeGreaterThan(0);
    expect(MIN_CONTACT).toBeLessThan(SLOT_PITCH);
    expect(SWING.omegaD).toBeGreaterThan(LEAN.omegaD);
  });
});
