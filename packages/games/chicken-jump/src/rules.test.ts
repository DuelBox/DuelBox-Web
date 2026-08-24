import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLUNDER_SECONDS,
  BOT_PATIENCE,
  BOT_PROFILES,
  BOT_SETTLE,
  DECEL,
  FENCE,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  HANG_SECONDS,
  HESITATE_SECONDS,
  HOP_APEX,
  LANDED_POINTS,
  LAND_MIN,
  LAND_SHRINK,
  LAND_START,
  LANE_HEIGHT,
  MAX_BLOCKS,
  PERFECT_FRACTION,
  PERFECT_POINTS,
  POLE,
  READY_SECONDS,
  REST_SECONDS,
  ROUND_SECONDS,
  STUMBLE_SECONDS,
  SWING_MAX,
  SWING_MIN,
  SWING_RATE,
  TARGET_POINTS,
  blockVel,
  blockX,
  botJump,
  breakTie,
  createBotState,
  createMatch,
  decide,
  hopHeight,
  judge,
  landOf,
  otherOf,
  perchOf,
  perfectOf,
  pointsOf,
  releaseSettle,
  remainingOf,
  resetBotState,
  resetMatch,
  settleSeconds,
  spent,
  stackedOf,
  step,
  stepPerch,
  stopPointOf,
  winnerOf,
  worldXOf,
  worldYOf,
} from './rules.js';
import type { Block, BotDifficulty, Landing, Match, Perch } from './rules.js';

const STEP = 1 / 60;
const TAU = Math.PI * 2;
/** Ten simulated minutes: what `apps/web/src/data/termination.test.ts` allows. */
const GUARD_STEPS = 60 * 600;

function started(seed = 20260824): { match: Match; rng: Rng } {
  const match = createMatch();
  resetMatch(match);
  return { match, rng: new Rng(seed) };
}

/** A bare block, for the arithmetic that has no perch in it. */
function block(amp: number, phase: number): Block {
  return { live: true, free: false, amp, phase, x0: 0, v0: 0, slide: 0 };
}

/** Step the match until this seat has a block on the rope. Bounded, never a spin. */
function toWaiting(match: Match, perch: Perch, rng: Rng): void {
  for (let i = 0; i < 600 && perch.stance !== 'waiting'; i += 1) {
    step(match, false, false, STEP, rng);
  }
  expect(perch.stance).toBe('waiting');
}

/** Put a known block on this seat s rope, replacing whatever the stream dealt. */
function arm(perch: Perch, amp: number, phase: number): void {
  perch.block.amp = amp;
  perch.block.phase = phase;
  perch.wait = 0;
}

/**
 * The phase on the inward swing whose stopping point is closest to `target`.
 *
 * Searched rather than solved: the relation is `amp·sinθ − (amp·ω·cosθ)²/2a`, which has no
 * pleasant inverse, and a test that re-derived it would be asserting its own algebra.
 */
function phaseFor(amp: number, target: number): number {
  const probe = block(amp, 0);
  let best = Math.PI / 2;
  let bestGap = Infinity;
  for (let i = 0; i <= 4000; i += 1) {
    probe.phase = Math.PI / 2 + (Math.PI / 2) * (i / 4000);
    const gap = Math.abs(stopPointOf(probe) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = probe.phase;
    }
  }
  return best;
}

/** How much of one inward swing would come to rest inside `band` of the pole, in seconds. */
function windowSeconds(amp: number, band: number): number {
  const probe = block(amp, 0);
  const fine = 1 / 8000;
  let inside = 0;
  for (let t = 0; t < Math.PI / SWING_RATE; t += fine) {
    probe.phase = Math.PI / 2 + SWING_RATE * t;
    if (settleSeconds(probe) > HANG_SECONDS) continue;
    if (Math.abs(stopPointOf(probe)) <= band) inside += 1;
  }
  return inside * fine;
}

/** Run a whole match on two press scripts. Bounded by the guard s own ten minutes. */
function play(
  seed: number,
  p1: (perch: Readonly<Perch>) => boolean,
  p2: (perch: Readonly<Perch>) => boolean,
): { match: Match; steps: number } {
  const { match, rng } = started(seed);
  let steps = 0;
  for (; steps < GUARD_STEPS && match.winner === null; steps += 1) {
    step(match, p1(match.p1), p2(match.p2), STEP, rng);
  }
  return { match, steps };
}

/** Press once the block has hung there this long. A whole player in one number. */
function patience(seconds: number): (perch: Readonly<Perch>) => boolean {
  return (perch) =>
    perch.stance === 'waiting' && perch.wait >= seconds && perch.wait < seconds + STEP;
}

/**
 * A player who releases the first time the shadow is within `band` of their own pole.
 *
 * Reads nothing a person on the same screen cannot: the shadow is drawn on the pole and the
 * block s speed is the block s speed. Two of these with different bands are two genuinely
 * different players, which is what the mirror tests need.
 */
function aiming(band: (perch: Readonly<Perch>) => number): (perch: Readonly<Perch>) => boolean {
  return (perch) =>
    perch.stance === 'waiting' &&
    settleSeconds(perch.block) <= HANG_SECONDS &&
    Math.abs(stopPointOf(perch.block)) <= band(perch);
}

/** Holds out for the middle of the pole every time. */
const sharp = aiming((perch) => perfectOf(perch.points));
/** Takes the first block that would catch the pole at all. */
const loose = aiming((perch) => landOf(perch.points));

const never = (): boolean => false;

/** A whole bot-against-bot match, driven through the rules alone. */
function botMatch(
  p1: BotDifficulty,
  p2: BotDifficulty,
  seed: number,
): { match: Match; steps: number } {
  const { match, rng } = started(seed);
  const a = createBotState();
  const b = createBotState();
  let steps = 0;
  for (; steps < GUARD_STEPS && match.winner === null; steps += 1) {
    const ja = botJump(match.p1, p1, a, STEP, rng);
    const jb = botJump(match.p2, p2, b, STEP, rng);
    step(match, ja, jb, STEP, rng);
  }
  return { match, steps };
}

/** Head-to-head counts over `seeds` seeded matches. */
function ladder(
  p1: BotDifficulty,
  p2: BotDifficulty,
  seeds: number,
): { p1: number; p2: number; drawn: number; open: number; longest: number } {
  let a = 0;
  let b = 0;
  let drawn = 0;
  let open = 0;
  let longest = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const { match, steps } = botMatch(p1, p2, seed * 61 + 1);
    longest = Math.max(longest, steps);
    if (match.winner === 'p1') a += 1;
    else if (match.winner === 'p2') b += 1;
    else if (match.winner === 'draw') drawn += 1;
    else open += 1;
  }
  return { p1: a, p2: b, drawn, open, longest };
}

/* ------------------------------------------------------------------ */

describe('the field', () => {
  it('is two whole perches and a fence, with nothing left over', () => {
    expect(LANE_HEIGHT * 2 + FENCE).toBe(FIELD_HEIGHT);
    expect(FENCE).toBeGreaterThan(0);
  });

  it('maps the two perches onto exact half turns of one another', () => {
    for (const across of [-SWING_MAX, -37, POLE, 84, SWING_MAX]) {
      expect(worldXOf('p2', across)).toBeCloseTo(FIELD_WIDTH - worldXOf('p1', across), 9);
    }
    for (const height of [0, 44, LANE_HEIGHT / 2, LANE_HEIGHT]) {
      expect(worldYOf('p2', height)).toBeCloseTo(FIELD_HEIGHT - worldYOf('p1', height), 9);
    }
  });

  it('puts both poles on the centre line, because the pole is the origin', () => {
    expect(POLE).toBe(0);
    expect(worldXOf('p1', POLE)).toBe(FIELD_WIDTH / 2);
    expect(worldXOf('p2', POLE)).toBe(FIELD_WIDTH / 2);
  });

  it('lays each seat s floor along the edge nearest that seat', () => {
    expect(worldYOf('p1', 0)).toBe(FIELD_HEIGHT);
    expect(worldYOf('p2', 0)).toBe(0);
  });

  it('keeps each seat wholly inside its own half of the device', () => {
    expect(worldYOf('p1', LANE_HEIGHT)).toBeGreaterThan(FIELD_HEIGHT / 2);
    expect(worldYOf('p2', LANE_HEIGHT)).toBeLessThan(FIELD_HEIGHT / 2);
  });

  it('leaves the widest swing room on both sides of the pole', () => {
    expect(worldXOf('p1', SWING_MAX)).toBeLessThan(FIELD_WIDTH);
    expect(worldXOf('p1', -SWING_MAX)).toBeGreaterThan(0);
    expect(worldXOf('p2', SWING_MAX)).toBeGreaterThan(0);
    expect(worldXOf('p2', -SWING_MAX)).toBeLessThan(FIELD_WIDTH);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });

  it('hands back the perch the seat asked for', () => {
    const { match } = started();
    expect(perchOf(match, 'p1')).toBe(match.p1);
    expect(perchOf(match, 'p2')).toBe(match.p2);
  });
});

describe('the pole', () => {
  it('starts at its full width and narrows by a fixed amount a point', () => {
    expect(landOf(0)).toBe(LAND_START);
    expect(landOf(1)).toBeCloseTo(LAND_START - LAND_SHRINK, 9);
    expect(landOf(5)).toBeCloseTo(LAND_START - 5 * LAND_SHRINK, 9);
  });

  it('never narrows below its floor, however far ahead a seat gets', () => {
    for (const points of [20, 60, 400]) expect(landOf(points)).toBe(LAND_MIN);
  });

  it('never widens', () => {
    for (let points = 1; points <= 40; points += 1) {
      expect(landOf(points)).toBeLessThanOrEqual(landOf(points - 1));
    }
  });

  it('keeps the floor as a backstop rather than as the mechanism', () => {
    // The most points a seat can hold when a block is judged is one perfect short of the
    // target, so the floor is never reached inside a legal match. It is there so a future
    // change to the target cannot make the pole vanish.
    expect(landOf(TARGET_POINTS + PERFECT_POINTS)).toBeGreaterThan(LAND_MIN);
  });

  it('calls the middle a fixed fraction of whatever is left', () => {
    for (const points of [0, 4, 11, 40]) {
      expect(perfectOf(points)).toBeCloseTo(landOf(points) * PERFECT_FRACTION, 9);
    }
  });

  it('keeps the middle strictly inside the catch', () => {
    for (const points of [0, 6, 12]) {
      expect(perfectOf(points)).toBeGreaterThan(0);
      expect(perfectOf(points)).toBeLessThan(landOf(points));
    }
  });

  it('is always narrower than the narrowest swing, so hanging still never catches', () => {
    // The reason there is a game: a block left on the rope is never over the pole, so
    // waiting is not a strategy at any score.
    expect(landOf(0)).toBeLessThan(SWING_MIN);
  });
});

describe('the swing', () => {
  it('hangs every block at the far end of its swing, momentarily still', () => {
    const { match, rng } = started(7);
    for (let i = 0; i < 12; i += 1) {
      toWaiting(match, match.p1, rng);
      expect(Math.abs(blockX(match.p1.block))).toBeCloseTo(match.p1.block.amp, 9);
      expect(blockVel(match.p1.block)).toBeCloseTo(0, 9);
      // Spend it, so the next one is dealt.
      for (let j = 0; j < 400 && match.p1.stance === 'waiting'; j += 1) {
        step(match, false, false, STEP, rng);
      }
    }
  });

  it('draws every amplitude inside the declared band', () => {
    const { match, rng } = started(99);
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      step(match, false, false, STEP, rng);
    }
    expect(match.drawn).toBe(MAX_BLOCKS);
    for (const amp of match.amps) {
      expect(amp).toBeGreaterThanOrEqual(SWING_MIN);
      expect(amp).toBeLessThanOrEqual(SWING_MAX);
    }
    for (const side of match.sides) expect(Math.abs(side)).toBe(1);
  });

  it('deals blocks from both sides over a match', () => {
    const { match, rng } = started(4242);
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      step(match, false, false, STEP, rng);
    }
    expect(match.sides.some((side) => side > 0)).toBe(true);
    expect(match.sides.some((side) => side < 0)).toBe(true);
  });

  it('is a pendulum, exactly', () => {
    for (const phase of [0, 0.4, 1.1, Math.PI, 5.9]) {
      const hanging = block(113, phase);
      expect(blockX(hanging)).toBeCloseTo(113 * Math.sin(phase), 9);
      expect(blockVel(hanging)).toBeCloseTo(113 * SWING_RATE * Math.cos(phase), 9);
    }
  });

  it('never leaves its own amplitude while it hangs', () => {
    const hanging = block(SWING_MAX, 0);
    for (let i = 0; i < 1000; i += 1) {
      hanging.phase = (TAU * i) / 1000;
      expect(Math.abs(blockX(hanging))).toBeLessThanOrEqual(SWING_MAX + 1e-9);
    }
  });

  it('comes back to where it started after one period', () => {
    const period = TAU / SWING_RATE;
    const a = block(120, 0.3);
    const b = block(120, 0.3 + SWING_RATE * period);
    expect(blockX(b)).toBeCloseTo(blockX(a), 9);
    expect(blockVel(b)).toBeCloseTo(blockVel(a), 9);
  });

  it('wraps its phase rather than letting it grow without bound', () => {
    const { match, rng } = started(11);
    toWaiting(match, match.p1, rng);
    for (let i = 0; i < 170; i += 1) {
      step(match, false, false, STEP, rng);
      expect(match.p1.block.phase).toBeLessThan(TAU);
      expect(match.p1.block.phase).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('where a block would stop', () => {
  it('is the block itself at the ends of the swing, where it is still', () => {
    const outer = block(118, Math.PI / 2);
    expect(stopPointOf(outer)).toBeCloseTo(118, 9);
    const far = block(118, (Math.PI * 3) / 2);
    expect(stopPointOf(far)).toBeCloseTo(-118, 9);
  });

  it('overshoots the pole by more than a swing width at the crossing', () => {
    // Where the block is at its quickest, and the reason pressing at the bottom is wrong.
    const crossing = block(SWING_MIN, Math.PI);
    expect(blockX(crossing)).toBeCloseTo(0, 9);
    expect(Math.abs(stopPointOf(crossing))).toBeGreaterThan(SWING_MIN);
  });

  it('is also moving far too fast to settle at the crossing', () => {
    const crossing = block(SWING_MIN, Math.PI);
    expect(settleSeconds(crossing)).toBeGreaterThan(HANG_SECONDS);
  });

  it('passes through the pole exactly once on an inward swing', () => {
    for (const amp of [SWING_MIN, 116, SWING_MAX]) {
      const probe = block(amp, 0);
      let crossings = 0;
      let previous = 0;
      for (let i = 0; i <= 3000; i += 1) {
        probe.phase = Math.PI / 2 + (Math.PI / 2) * (i / 3000);
        const stop = stopPointOf(probe);
        if (i > 0 && Math.sign(stop) !== Math.sign(previous)) crossings += 1;
        previous = stop;
      }
      expect(crossings, `amplitude ${amp}`).toBe(1);
    }
  });

  it('crosses at neither of the two instants a player would guess', () => {
    for (const amp of [SWING_MIN, SWING_MAX]) {
      const probe = block(amp, phaseFor(amp, 0));
      expect(Math.abs(stopPointOf(probe))).toBeLessThan(1);
      // Not at the end of the swing, where the block is still...
      expect(Math.abs(blockX(probe))).toBeLessThan(amp * 0.95);
      expect(Math.abs(blockX(probe))).toBeGreaterThan(amp * 0.55);
      // ...and not at the bottom, where it is quickest.
      expect(Math.abs(blockVel(probe))).toBeLessThan(amp * SWING_RATE * 0.85);
    }
  });

  it('leaves the right instant reachable in time, for the widest swing as for the narrowest', () => {
    // The tuning claim the whole game rests on. If the crossing needed longer than the hop,
    // no release on that block could ever score.
    for (const amp of [SWING_MIN, 116, SWING_MAX]) {
      const probe = block(amp, phaseFor(amp, 0));
      expect(settleSeconds(probe), `amplitude ${amp}`).toBeLessThan(HANG_SECONDS);
    }
  });

  it('leaves a middle window wide enough to aim at', () => {
    // Measured rather than asserted from the constants: how many milliseconds of the swing
    // put the block in the middle band at nil points. 107 ms on the narrowest block, 82 on
    // the widest.
    for (const amp of [SWING_MIN, SWING_MAX]) {
      const seconds = windowSeconds(amp, perfectOf(0));
      expect(seconds, `amplitude ${amp}`).toBeGreaterThan(0.06);
      expect(seconds, `amplitude ${amp}`).toBeLessThan(0.2);
    }
  });

  it('leaves a catch window wider than the middle one, at both amplitudes', () => {
    for (const amp of [SWING_MIN, SWING_MAX]) {
      expect(windowSeconds(amp, landOf(0))).toBeGreaterThan(windowSeconds(amp, perfectOf(0)));
    }
  });

  it('tightens that window as a seat pulls ahead, without ever closing it', () => {
    // What the narrowing pole actually buys, expressed as time rather than distance: the
    // last point is the hardest because there is less of the swing to release inside.
    for (const amp of [SWING_MIN, SWING_MAX]) {
      const level = windowSeconds(amp, perfectOf(0));
      const ahead = windowSeconds(amp, perfectOf(TARGET_POINTS - 1));
      expect(ahead, `amplitude ${amp}`).toBeLessThan(level * 0.8);
      expect(ahead, `amplitude ${amp}`).toBeGreaterThan(0.03);
    }
  });

  it('reports the settle time as the speed over the deceleration', () => {
    const probe = block(120, 1.0);
    expect(settleSeconds(probe)).toBeCloseTo(Math.abs(blockVel(probe)) / DECEL, 9);
  });

  it('is still at the ends of the swing, so a block cut there needs no time at all', () => {
    expect(settleSeconds(block(120, Math.PI / 2))).toBeCloseTo(0, 9);
  });
});

describe('a block cut loose', () => {
  it('slides under exact constant deceleration', () => {
    const free: Block = { live: true, free: true, amp: 110, phase: 0, x0: 20, v0: -240, slide: 0 };
    for (const t of [0, 0.1, 0.3, 0.5]) {
      free.slide = t;
      expect(blockX(free)).toBeCloseTo(20 - (240 * t - (DECEL * t * t) / 2), 9);
      expect(blockVel(free)).toBeCloseTo(-(240 - DECEL * t), 9);
    }
  });

  it('stops, and never moves again', () => {
    const free: Block = { live: true, free: true, amp: 110, phase: 0, x0: 20, v0: -240, slide: 0 };
    const stopAt = 240 / DECEL;
    free.slide = stopAt;
    const resting = blockX(free);
    for (const t of [stopAt + 0.01, stopAt + 1, stopAt + 100]) {
      free.slide = t;
      expect(blockX(free)).toBeCloseTo(resting, 9);
      expect(blockVel(free)).toBe(0);
    }
  });

  it('comes to rest exactly where the shadow said it would', () => {
    const hanging = block(114, 2.1);
    const predicted = stopPointOf(hanging);
    const free: Block = {
      live: true,
      free: true,
      amp: 114,
      phase: 2.1,
      x0: blockX(hanging),
      v0: blockVel(hanging),
      slide: 10,
    };
    expect(blockX(free)).toBeCloseTo(predicted, 9);
  });

  it('reports the settle time of the release it actually got', () => {
    const free: Block = { live: true, free: true, amp: 110, phase: 0, x0: 0, v0: 300, slide: 0.2 };
    expect(releaseSettle(free)).toBeCloseTo(300 / DECEL, 9);
  });
});

describe('the hop', () => {
  it('leaves and arrives on the perch', () => {
    expect(hopHeight(0)).toBe(0);
    expect(hopHeight(HANG_SECONDS)).toBe(0);
  });

  it('reaches its apex halfway through', () => {
    expect(hopHeight(HANG_SECONDS / 2)).toBeCloseTo(HOP_APEX, 9);
  });

  it('is symmetric about the apex, and never below the perch', () => {
    for (let i = 0; i <= 40; i += 1) {
      const t = (HANG_SECONDS * i) / 40;
      expect(hopHeight(t)).toBeGreaterThanOrEqual(0);
      expect(hopHeight(t)).toBeCloseTo(hopHeight(HANG_SECONDS - t), 9);
    }
  });

  it('is drawn rather than simulated, so nothing outside the hop reads it', () => {
    expect(hopHeight(-1)).toBe(0);
    expect(hopHeight(HANG_SECONDS + 1)).toBe(0);
  });
});

describe('judging a landing', () => {
  it('calls a block still sliding a stumble, wherever it was going to stop', () => {
    expect(judge(0, HANG_SECONDS + 0.01, 0)).toBe('slipped');
    expect(judge(500, HANG_SECONDS + 0.01, 0)).toBe('slipped');
  });

  it('calls the middle of the pole double', () => {
    expect(judge(0, 0.2, 0)).toBe('perfect');
    expect(judge(-10, 0.2, 0)).toBe('perfect');
  });

  it('calls the rest of the pole one', () => {
    expect(judge(60, 0.2, 0)).toBe('landed');
    expect(judge(-60, 0.2, 0)).toBe('landed');
  });

  it('calls anything clear of the pole a miss', () => {
    expect(judge(120, 0.2, 0)).toBe('missed');
    expect(judge(-120, 0.2, 0)).toBe('missed');
  });

  it('catches a block resting exactly on the end of the pole', () => {
    expect(judge(landOf(0), 0.2, 0)).toBe('landed');
    expect(judge(-landOf(0), 0.2, 0)).toBe('landed');
  });

  it('drops one a hair past the end', () => {
    expect(judge(landOf(0) + 1e-9, 0.2, 0)).toBe('missed');
  });

  it('counts a block resting exactly on the edge of the middle as the middle', () => {
    expect(judge(perfectOf(0), 0.2, 0)).toBe('perfect');
    expect(judge(-perfectOf(0), 0.2, 0)).toBe('perfect');
  });

  it('counts one a hair outside it as merely landed', () => {
    expect(judge(perfectOf(0) + 1e-9, 0.2, 0)).toBe('landed');
  });

  it('lets a block that settles on the very last instant of the hop count', () => {
    expect(judge(0, HANG_SECONDS, 0)).toBe('perfect');
  });

  it('stumbles on one that needed a hair longer', () => {
    expect(judge(0, HANG_SECONDS + 1e-9, 0)).toBe('slipped');
  });

  it('is blind to which side of the pole a block landed', () => {
    for (const off of [0, 12, 39, 55, 87, 200]) {
      expect(judge(off, 0.2, 3)).toBe(judge(-off, 0.2, 3));
    }
  });

  it('pays a near miss exactly what it pays a wild one', () => {
    expect(judge(landOf(0) + 0.01, 0.2, 0)).toBe(judge(4000, 0.2, 0));
  });

  it('narrows the pole under the seat that is ahead, and nobody else', () => {
    // The same block, judged against two different scores. This is the whole rubber band.
    expect(judge(30, 0.2, 0)).toBe('perfect');
    expect(judge(30, 0.2, 12)).toBe('landed');
    expect(judge(60, 0.2, 0)).toBe('landed');
    expect(judge(60, 0.2, 12)).toBe('missed');
    // And it is the seat s own score that narrows it: nothing here reads the opponent.
    expect(judge(30, 0.2, 0)).toBe('perfect');
  });
});

describe('one seat, one block', () => {
  it('stands and looks at an empty rope before the first block', () => {
    const { match, rng } = started();
    expect(match.p1.stance).toBe('resting');
    expect(match.p1.rest).toBe(READY_SECONDS);
    expect(match.p1.block.live).toBe(false);
    let steps = 0;
    for (; steps < 600 && match.p1.stance !== 'waiting'; steps += 1) {
      step(match, true, true, STEP, rng);
    }
    expect(steps / 60).toBeGreaterThanOrEqual(READY_SECONDS - STEP);
    expect(steps / 60).toBeLessThanOrEqual(READY_SECONDS + STEP);
  });

  it('spends one of the budget to hang a block', () => {
    const { match, rng } = started();
    expect(match.p1.used).toBe(0);
    toWaiting(match, match.p1, rng);
    expect(match.p1.used).toBe(1);
    expect(remainingOf(match.p1)).toBe(MAX_BLOCKS - 1);
    expect(match.p1.block.live).toBe(true);
  });

  it('cuts the block loose and hops in the same instant', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    const before = blockX(match.p1.block);
    step(match, true, false, STEP, rng);
    expect(match.p1.stance).toBe('airborne');
    expect(match.p1.block.free).toBe(true);
    expect(match.p1.air).toBe(0);
    expect(match.p1.block.x0).toBeCloseTo(before, 9);
  });

  it('cuts the block that was on the screen, not the one a frame later', () => {
    // The press is answered before the swing moves on. Answering it a step later would
    // charge every player a sixtieth of a second of lead they could not see.
    const { match, rng } = started(3);
    toWaiting(match, match.p1, rng);
    arm(match.p1, 114, 2.0);
    const shown = blockX(match.p1.block);
    const shownVelocity = blockVel(match.p1.block);
    step(match, true, false, STEP, rng);
    expect(match.p1.block.x0).toBeCloseTo(shown, 9);
    expect(match.p1.block.v0).toBeCloseTo(shownVelocity, 9);
  });

  it('keeps the chicken off the perch for exactly one hop', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    step(match, true, false, STEP, rng);
    let air = 0;
    for (; air < 400 && match.p1.stance === 'airborne'; air += 1) {
      step(match, false, false, STEP, rng);
    }
    expect(air).toBe(Math.ceil(HANG_SECONDS / STEP));
    expect(match.p1.air).toBeGreaterThanOrEqual(HANG_SECONDS);
    expect(match.p1.air - STEP).toBeLessThan(HANG_SECONDS);
  });

  it('freezes the block at the instant the chicken came down', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    step(match, true, false, STEP, rng);
    for (let i = 0; i < 400 && match.p1.stance === 'airborne'; i += 1) {
      step(match, false, false, STEP, rng);
    }
    expect(match.p1.block.slide).toBe(HANG_SECONDS);
  });

  it('ignores a second press while the chicken is in the air', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    step(match, true, false, STEP, rng);
    const cut = { x0: match.p1.block.x0, v0: match.p1.block.v0 };
    let air = 0;
    for (; air < 400 && match.p1.stance === 'airborne'; air += 1) {
      step(match, true, false, STEP, rng);
    }
    expect(air).toBe(Math.ceil(HANG_SECONDS / STEP));
    expect(match.p1.block.x0).toBe(cut.x0);
    expect(match.p1.block.v0).toBe(cut.v0);
  });

  it('ignores a press while the chicken is between blocks', () => {
    const { match, rng } = started();
    const used = match.p1.used;
    for (let i = 0; i < 20; i += 1) step(match, true, false, STEP, rng);
    expect(match.p1.stance).toBe('resting');
    expect(match.p1.used).toBe(used);
  });

  it('cuts down a block nobody ever released, and charges it to the budget', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    let waited = 0;
    for (; waited < 400 && match.p1.stance === 'waiting'; waited += 1) {
      step(match, false, false, STEP, rng);
    }
    expect(waited / 60).toBeGreaterThanOrEqual(HESITATE_SECONDS - STEP);
    expect(waited / 60).toBeLessThanOrEqual(HESITATE_SECONDS + STEP);
    expect(match.p1.last).toBe('lost');
    expect(match.p1.losses).toBe(1);
    expect(match.p1.points).toBe(0);
    expect(match.p1.used).toBe(1);
  });

  it('offers more than one right instant before it gives up on a block', () => {
    // Three seconds is a swing and a half, so missing one crossing costs tempo rather than
    // the block.
    expect(HESITATE_SECONDS).toBeGreaterThan(TAU / SWING_RATE);
  });

  it('banks two for the middle and one for the rest of the pole', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    arm(match.p1, 114, phaseFor(114, 0));
    for (let i = 0; i < 400 && match.p1.last === 'none'; i += 1) {
      step(match, match.p1.stance === 'waiting', false, STEP, rng);
    }
    expect(match.p1.last).toBe('perfect');
    expect(match.p1.points).toBe(PERFECT_POINTS);
    expect(match.p1.perfects).toBe(1);

    toWaiting(match, match.p1, rng);
    arm(match.p1, 114, phaseFor(114, (perfectOf(match.p1.points) + landOf(match.p1.points)) / 2));
    for (let i = 0; i < 400 && match.p1.last === 'perfect'; i += 1) {
      step(match, match.p1.stance === 'waiting', false, STEP, rng);
    }
    expect(match.p1.last).toBe('landed');
    expect(match.p1.points).toBe(PERFECT_POINTS + LANDED_POINTS);
    expect(match.p1.landed).toBe(1);
  });

  it('banks nothing for a miss', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    arm(match.p1, SWING_MAX, Math.PI / 2);
    for (let i = 0; i < 400 && match.p1.last === 'none'; i += 1) {
      step(match, match.p1.stance === 'waiting', false, STEP, rng);
    }
    expect(match.p1.last).toBe('missed');
    expect(match.p1.missed).toBe(1);
    expect(match.p1.points).toBe(0);
  });

  it('banks nothing for a block that was still sliding', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    arm(match.p1, SWING_MAX, Math.PI);
    for (let i = 0; i < 400 && match.p1.last === 'none'; i += 1) {
      step(match, match.p1.stance === 'waiting', false, STEP, rng);
    }
    expect(match.p1.last).toBe('slipped');
    expect(match.p1.slips).toBe(1);
    expect(match.p1.points).toBe(0);
  });

  it('makes a stumble cost longer than anything else', () => {
    expect(STUMBLE_SECONDS).toBeGreaterThan(REST_SECONDS);
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    arm(match.p1, SWING_MAX, Math.PI);
    for (let i = 0; i < 400 && match.p1.stance !== 'stumbling'; i += 1) {
      step(match, match.p1.stance === 'waiting', false, STEP, rng);
    }
    expect(match.p1.stance).toBe('stumbling');
    expect(match.p1.rest).toBe(STUMBLE_SECONDS);
  });

  it('rests the same short beat after every other outcome', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    arm(match.p1, SWING_MAX, Math.PI / 2);
    for (let i = 0; i < 400 && match.p1.stance !== 'resting'; i += 1) {
      step(match, match.p1.stance === 'waiting', false, STEP, rng);
    }
    expect(match.p1.rest).toBe(REST_SECONDS);
  });

  it('files every block it deals under exactly one heading', () => {
    const { match, rng } = started(555);
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      step(match, i % 37 === 0, i % 53 === 0, STEP, rng);
    }
    for (const perch of [match.p1, match.p2]) {
      const filed = perch.perfects + perch.landed + perch.missed + perch.slips + perch.losses;
      // Every block dealt is filed, bar the one still on the rope when the match was called.
      expect(filed).toBe(perch.used - (perch.block.live ? 1 : 0));
      expect(perch.points).toBe(perch.perfects * PERFECT_POINTS + perch.landed * LANDED_POINTS);
    }
  });

  it('counts the tower as what is standing on the pole', () => {
    const { match, rng } = started(808);
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      step(match, i % 41 === 0, false, STEP, rng);
    }
    expect(stackedOf(match.p1)).toBe(match.p1.perfects + match.p1.landed);
    expect(stackedOf(match.p1)).toBeLessThanOrEqual(match.p1.used);
  });

  it('reports the last landing and how long ago, for the renderer to flash', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    arm(match.p1, SWING_MAX, Math.PI / 2);
    for (let i = 0; i < 400 && match.p1.last === 'none'; i += 1) {
      step(match, match.p1.stance === 'waiting', false, STEP, rng);
    }
    expect(match.p1.since).toBe(0);
    step(match, false, false, STEP, rng);
    expect(match.p1.since).toBeCloseTo(STEP, 9);
  });

  it('stops when its budget is spent, and stays stopped', () => {
    const { match, rng } = started();
    for (let i = 0; i < GUARD_STEPS && match.p1.stance !== 'done'; i += 1) {
      step(match, false, false, STEP, rng);
    }
    expect(match.p1.stance).toBe('done');
    expect(match.p1.used).toBe(MAX_BLOCKS);
    expect(remainingOf(match.p1)).toBe(0);
  });

  it('ignores every press once it is done', () => {
    const { match, rng } = started();
    for (let i = 0; i < GUARD_STEPS && match.p1.stance !== 'done'; i += 1) {
      step(match, false, false, STEP, rng);
    }
    const frozen = { ...match.p1 };
    for (let i = 0; i < 300; i += 1) {
      expect(stepPerch(match, match.p1, true, STEP, rng)).toBe('none');
    }
    expect({ ...match.p1, since: frozen.since }).toEqual(frozen);
  });
});

describe('scoring and the win condition', () => {
  it('starts level with nobody having won', () => {
    const { match } = started();
    expect(match.p1.points).toBe(0);
    expect(match.p2.points).toBe(0);
    expect(pointsOf(match, 'p1')).toBe(0);
    expect(pointsOf(match, 'p2')).toBe(0);
    expect(winnerOf(match)).toBeNull();
    expect(match.phase).toBe('playing');
  });

  it('is undecided while both seats are short of the target', () => {
    const { match } = started();
    match.p1.points = TARGET_POINTS - 1;
    match.p2.points = TARGET_POINTS - 2;
    decide(match);
    expect(winnerOf(match)).toBeNull();
  });

  it('goes to the first seat to reach the target', () => {
    const { match } = started();
    match.p1.points = TARGET_POINTS;
    decide(match);
    expect(winnerOf(match)).toBe('p1');
  });

  it('goes to the other seat just as readily', () => {
    const { match } = started();
    match.p2.points = TARGET_POINTS + 1;
    decide(match);
    expect(winnerOf(match)).toBe('p2');
  });

  it('gives a pair that crossed together on different scores to the higher', () => {
    const { match } = started();
    match.p1.points = TARGET_POINTS;
    match.p2.points = TARGET_POINTS + 1;
    decide(match);
    expect(winnerOf(match)).toBe('p2');
  });

  it('sends a pair that crossed together on the same score to the tie-break', () => {
    // Not to whichever seat the code happened to check first: the shared helper says draw,
    // and the tie-break is what separates them.
    const { match } = started();
    match.p1.points = TARGET_POINTS;
    match.p2.points = TARGET_POINTS;
    match.p1.perfects = 6;
    match.p2.perfects = 5;
    decide(match);
    expect(winnerOf(match)).toBe('p1');
  });

  it('settles a spent budget on points', () => {
    const { match } = started();
    match.p1.stance = 'done';
    match.p2.stance = 'done';
    match.p1.points = 4;
    match.p2.points = 3;
    expect(spent(match)).toBe(true);
    decide(match);
    expect(winnerOf(match)).toBe('p1');
  });

  it('does not call a match while one seat still has blocks', () => {
    const { match } = started();
    match.p1.stance = 'done';
    match.p1.points = 4;
    expect(spent(match)).toBe(false);
    decide(match);
    expect(winnerOf(match)).toBeNull();
  });

  it('separates a level pair on middles first', () => {
    const { match } = started();
    match.p1.points = 6;
    match.p2.points = 6;
    match.p1.perfects = 3;
    match.p2.perfects = 2;
    expect(breakTie(match)).toBe('p1');
    match.p1.perfects = 1;
    expect(breakTie(match)).toBe('p2');
  });

  it('then on stumbles, and the fewer the better', () => {
    const { match } = started();
    match.p1.points = 6;
    match.p2.points = 6;
    match.p1.perfects = 3;
    match.p2.perfects = 3;
    match.p1.slips = 1;
    match.p2.slips = 4;
    expect(breakTie(match)).toBe('p1');
    match.p1.slips = 9;
    expect(breakTie(match)).toBe('p2');
  });

  it('calls a pair level on all three an honest draw', () => {
    const { match } = started();
    match.p1.points = 6;
    match.p2.points = 6;
    match.p1.perfects = 3;
    match.p2.perfects = 3;
    match.p1.slips = 2;
    match.p2.slips = 2;
    expect(breakTie(match)).toBe('draw');
  });

  it('lets a player who finds the middle every time win outright', () => {
    // The claim the narrowing pole must not break: a release exactly on the crossing scores
    // the middle at any score, so a perfect run is still a perfect run at twelve points.
    const { match, steps } = play(61, sharp, loose);
    expect(match.winner).toBe('p1');
    expect(match.p1.perfects).toBe(match.p1.used);
    expect(match.p1.points).toBeGreaterThanOrEqual(TARGET_POINTS);
    expect(match.p1.used).toBe(Math.ceil(TARGET_POINTS / PERFECT_POINTS));
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('pays a player who takes whatever catches half as much a block', () => {
    const { match } = play(61, sharp, loose);
    expect(match.p2.landed).toBeGreaterThan(0);
    expect(match.p2.perfects).toBe(0);
    expect(match.p2.points).toBe(match.p2.landed * LANDED_POINTS);
  });

  it('never revisits a decision', () => {
    const { match } = started();
    match.p1.points = TARGET_POINTS;
    decide(match);
    expect(winnerOf(match)).toBe('p1');
    match.p2.points = TARGET_POINTS + 40;
    decide(match);
    expect(winnerOf(match)).toBe('p1');
  });

  it('stops simulating the moment it is decided', () => {
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    match.p1.points = TARGET_POINTS;
    step(match, false, false, STEP, rng);
    expect(match.phase).toBe('over');
    const frozen = JSON.stringify(match);
    for (let i = 0; i < 200; i += 1) step(match, true, true, STEP, rng);
    expect(JSON.stringify(match)).toBe(frozen);
  });

  it('reports nothing happening once it is over', () => {
    const { match, rng } = started();
    match.p1.points = TARGET_POINTS;
    decide(match);
    const result = step(match, true, true, STEP, rng);
    expect(result.p1).toBe('none');
    expect(result.p2).toBe('none');
  });
});

describe('termination', () => {
  it('bounds itself by arithmetic rather than by tuning', () => {
    // A block costs at most the whole hesitation clock, then a hop, then the longest rest
    // there is. Nothing a player can do makes a block cost more than that, so the budget
    // bounds the match — and the backstop sits above the bound rather than under it.
    const worstBlock = HESITATE_SECONDS + HANG_SECONDS + STUMBLE_SECONDS;
    const worstMatch = READY_SECONDS + MAX_BLOCKS * worstBlock;
    expect(worstMatch).toBeLessThan(ROUND_SECONDS);
    expect(ROUND_SECONDS).toBeLessThan(GUARD_STEPS / 60);
  });

  it('never lets one block cost more than that worst case', () => {
    // Driven rather than reasoned: hold the block to the brink of the clock, then release
    // it at the bottom of the swing, which is the one release that always stumbles.
    const { match, rng } = started();
    toWaiting(match, match.p1, rng);
    arm(match.p1, SWING_MAX, Math.PI / 2);
    match.p1.wait = HESITATE_SECONDS - STEP;
    match.p1.block.phase = Math.PI;
    let steps = 0;
    for (; steps < 600 && match.p1.used === 1; steps += 1) {
      step(match, match.p1.stance === 'waiting', false, STEP, rng);
    }
    expect(match.p1.slips).toBe(1);
    // The step budget from the brink: one hop and one stumble, plus the step that pressed.
    const cost = (steps + (HESITATE_SECONDS - STEP) * 60) / 60;
    expect(cost).toBeLessThanOrEqual(HESITATE_SECONDS + HANG_SECONDS + STUMBLE_SECONDS + 3 * STEP);
  });

  it('ends a match nobody plays at all', () => {
    const { match, steps } = play(1, never, never);
    expect(match.winner).toBe('draw');
    expect(match.p1.used).toBe(MAX_BLOCKS);
    expect(match.p2.used).toBe(MAX_BLOCKS);
    expect(match.p1.losses).toBe(MAX_BLOCKS);
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('ends a match both players mash from the first frame', () => {
    // Every block is cut at the end of its swing, where it is still and clear of the pole,
    // so mashing scores exactly nothing and the budget still runs out.
    const always = (perch: Readonly<Perch>): boolean => perch.stance === 'waiting';
    const { match, steps } = play(2, always, always);
    expect(match.winner).not.toBeNull();
    expect(match.p1.points).toBe(0);
    expect(match.p2.points).toBe(0);
    expect(match.p1.missed).toBe(MAX_BLOCKS);
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('ends a match both players hold to the brink of every block', () => {
    const brink = patience(HESITATE_SECONDS - 2 * STEP);
    const { match, steps } = play(3, brink, brink);
    expect(match.winner).not.toBeNull();
    expect(steps / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('ends a match two of the weakest bots play, on every seed', () => {
    const run = ladder('easy', 'easy', 24);
    expect(run.open).toBe(0);
    expect(run.longest / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('ends a match two of the strongest bots play, on every seed', () => {
    const run = ladder('hard', 'hard', 24);
    expect(run.open).toBe(0);
    expect(run.longest / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('ends a mismatched pairing, on every seed', () => {
    const run = ladder('hard', 'easy', 24);
    expect(run.open).toBe(0);
    expect(run.longest / 60).toBeLessThan(ROUND_SECONDS);
  });

  it('calls a match that somehow outlasts the clock', () => {
    // Nothing reaches this today; it is here because a game whose only guarantee lives in
    // its pacing constants is one change away from running for ever.
    const { match, rng } = started();
    match.elapsed = ROUND_SECONDS;
    step(match, false, false, STEP, rng);
    expect(match.phase).toBe('over');
    expect(match.winner).not.toBeNull();
  });

  it('advertises a round length in the same neighbourhood as a real one', () => {
    const { match } = play(5, sharp, loose);
    expect(match.elapsed).toBeGreaterThan(5);
    expect(match.elapsed).toBeLessThan(ROUND_SECONDS);
  });
});

describe('the two seats', () => {
  it('are handed the same block by index, whatever pace they play at', () => {
    // Seat one spends its blocks fast and seat two slowly, so they are never on the same
    // index at the same time — and still get the identical run of blocks.
    const seen: Record<SeatId, string[]> = { p1: [], p2: [] };
    const { match, rng } = started(31337);
    const fast = (perch: Readonly<Perch>): boolean => perch.stance === 'waiting';
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const perch = perchOf(match, seat);
        if (perch.stance === 'waiting' && perch.wait === 0) {
          seen[seat].push(`${perch.used}:${perch.block.amp.toFixed(9)}:${perch.block.phase}`);
        }
      }
      step(match, fast(match.p1), patience(2.4)(match.p2), STEP, rng);
    }
    expect(seen.p1.length).toBeGreaterThan(8);
    expect(seen.p2).toEqual(seen.p1);
  });

  it('play the identical perch when they play the identical way', () => {
    const { match } = play(77, sharp, sharp);
    expect({ ...match.p1, block: { ...match.p1.block } }).toEqual({
      ...match.p2,
      block: { ...match.p2.block },
    });
    expect(match.winner).toBe('draw');
  });

  it('swap their result exactly when their two scripts are swapped', () => {
    // The mirror, over a run of seeds rather than one: put the two players on the other
    // side of the device and every number comes out the other way round.
    const a = sharp;
    const b = loose;
    for (let seed = 1; seed <= 16; seed += 1) {
      const straight = play(seed * 61, a, b).match;
      const swapped = play(seed * 61, b, a).match;
      expect(swapped.p1.points, `seed ${seed}`).toBe(straight.p2.points);
      expect(swapped.p2.points, `seed ${seed}`).toBe(straight.p1.points);
      expect(swapped.p1.perfects).toBe(straight.p2.perfects);
      expect(swapped.p2.perfects).toBe(straight.p1.perfects);
      expect(swapped.p1.slips).toBe(straight.p2.slips);
      expect(swapped.p2.slips).toBe(straight.p1.slips);
      expect(swapped.p1.used).toBe(straight.p2.used);
      const mirrored = straight.winner === 'draw' ? 'draw' : otherOf(straight.winner as SeatId);
      expect(swapped.winner, `seed ${seed}`).toBe(mirrored);
    }
  });

  it('are mirroring two players who really do differ, not two copies of one', () => {
    // Without this the mirror above would pass on two identical scripts, which proves
    // nothing at all.
    const a = sharp;
    const b = loose;
    let separated = 0;
    for (let seed = 1; seed <= 16; seed += 1) {
      const match = play(seed * 61, a, b).match;
      expect(match.winner).not.toBeNull();
      if (match.p1.points !== match.p2.points) separated += 1;
    }
    expect(separated).toBeGreaterThan(8);
  });

  it('cannot reach into each other', () => {
    const { match, rng } = started(9);
    toWaiting(match, match.p2, rng);
    const before = { ...match.p2, block: { ...match.p2.block } };
    for (let i = 0; i < 40; i += 1) stepPerch(match, match.p1, i % 5 === 0, STEP, rng);
    expect({ ...match.p2, block: { ...match.p2.block } }).toEqual(before);
  });

  it('cannot change the blocks the other seat is given', () => {
    const amps = (jump: (perch: Readonly<Perch>) => boolean): string => {
      const { match, rng } = started(2024);
      for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
        step(match, jump(match.p1), false, STEP, rng);
      }
      return match.amps.map((amp) => amp.toFixed(9)).join(',');
    };
    expect(amps(never)).toBe(amps((perch) => perch.stance === 'waiting'));
  });
});

describe('determinism', () => {
  it('plays the identical match from the same seed', () => {
    const trace = (): string => {
      const { match, rng } = started(5150);
      const seen: number[] = [];
      for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
        step(match, i % 29 === 0, i % 43 === 0, STEP, rng);
        if (i % 5 === 0) {
          seen.push(blockX(match.p1.block), blockX(match.p2.block), match.p1.points);
        }
      }
      return seen.map((value) => value.toFixed(9)).join(',');
    };
    expect(trace()).toBe(trace());
  });

  it('deals different blocks from a different seed', () => {
    const amps = (seed: number): string => {
      const { match, rng } = started(seed);
      for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
        step(match, false, false, STEP, rng);
      }
      return match.amps.map((amp) => amp.toFixed(9)).join(',');
    };
    expect(amps(1)).not.toBe(amps(2));
  });

  it('judges a release the same at 60 Hz as at 120 Hz', () => {
    // The reason the block is analytic and the slide is capped: the landing is judged on
    // the block s exact state at the hop, however the steps happen to fall.
    const landing = (delta: number): Landing => {
      const { match, rng } = started(606);
      for (let i = 0; i < 6000 && match.p1.stance !== 'waiting'; i += 1) {
        step(match, false, false, delta, rng);
      }
      arm(match.p1, 118, phaseFor(118, 24));
      for (let i = 0; i < 6000 && match.p1.last === 'none'; i += 1) {
        step(match, match.p1.stance === 'waiting', false, delta, rng);
      }
      return match.p1.last;
    };
    expect(landing(1 / 120)).toBe(landing(1 / 60));
  });

  it('resets to a state indistinguishable from a fresh match', () => {
    const { match, rng } = started(404);
    for (let i = 0; i < 900; i += 1) step(match, i % 31 === 0, i % 17 === 0, STEP, rng);
    resetMatch(match);
    expect(match).toEqual(createMatch());
  });

  it('allocates nothing per step', () => {
    // The block arrays are drawn once for the whole match, and the step result is one
    // record rewritten in place. Both are checked because both are the classic offender.
    const { match, rng } = started();
    expect(match.sides).toHaveLength(MAX_BLOCKS);
    expect(match.amps).toHaveLength(MAX_BLOCKS);
    const first = step(match, false, false, STEP, rng);
    const second = step(match, false, false, STEP, rng);
    expect(first).toBe(second);
  });

  it('draws each block from the stream exactly once', () => {
    const { match, rng } = started(6);
    for (let i = 0; i < GUARD_STEPS && match.winner === null; i += 1) {
      step(match, i % 23 === 0, i % 19 === 0, STEP, rng);
      expect(match.drawn).toBeLessThanOrEqual(MAX_BLOCKS);
    }
    expect(match.drawn).toBe(Math.max(match.p1.used, match.p2.used));
  });
});

describe('the bot', () => {
  it('orders its four knobs the same way across the three tiers', () => {
    const { easy, normal, hard } = BOT_PROFILES;
    expect(easy.reaction).toBeGreaterThan(normal.reaction);
    expect(normal.reaction).toBeGreaterThan(hard.reaction);
    expect(easy.error).toBeGreaterThan(normal.error);
    expect(normal.error).toBeGreaterThan(hard.error);
    expect(easy.blunder).toBeGreaterThan(normal.blunder);
    expect(normal.blunder).toBeGreaterThan(hard.blunder);
    expect(easy.haste).toBeGreaterThan(normal.haste);
    expect(normal.haste).toBeGreaterThan(hard.haste);
  });

  it('gets no wider pole, no longer hop and no slower swing at any tier', () => {
    // Every tier is a set of four numbers about the player, and nothing about the game.
    for (const profile of Object.values(BOT_PROFILES)) {
      expect(Object.keys(profile).sort()).toEqual(['blunder', 'error', 'haste', 'reaction']);
    }
  });

  it('starts and resets to the same state, so a rematch is a fresh bot', () => {
    const fresh = createBotState();
    const used = createBotState();
    used.look = 0.4;
    used.bias = 12;
    used.armed = true;
    used.frozen = 0.2;
    used.previous = 30;
    used.sampled = true;
    resetBotState(used);
    expect(used).toEqual(fresh);
  });

  it('never presses when there is nothing on the rope', () => {
    const { match, rng } = started();
    const state = createBotState();
    for (let i = 0; i < 60 && match.p1.stance !== 'waiting'; i += 1) {
      expect(botJump(match.p1, 'hard', state, STEP, rng)).toBe(false);
      step(match, false, false, STEP, rng);
    }
  });

  it('never presses on its first look at a block', () => {
    // A person glancing up cannot act on a single glance: one look establishes which way
    // the shadow is going and nothing else.
    const { match, rng } = started(12);
    toWaiting(match, match.p1, rng);
    const state = createBotState();
    expect(botJump(match.p1, 'hard', state, STEP, rng)).toBe(false);
    expect(state.sampled).toBe(true);
  });

  it('draws one misjudgement a block and holds it to the release', () => {
    const { match, rng } = started(13);
    toWaiting(match, match.p1, rng);
    const state = createBotState();
    botJump(match.p1, 'easy', state, STEP, rng);
    const bias = state.bias;
    expect(state.armed).toBe(true);
    for (let i = 0; i < 30 && match.p1.stance === 'waiting'; i += 1) {
      botJump(match.p1, 'easy', state, STEP, rng);
      expect(state.bias).toBe(bias);
      step(match, false, false, STEP, rng);
    }
  });

  it('drops the misjudgement between blocks rather than carrying it', () => {
    const { match, rng } = started(14);
    toWaiting(match, match.p1, rng);
    const state = createBotState();
    botJump(match.p1, 'easy', state, STEP, rng);
    expect(state.armed).toBe(true);
    match.p1.stance = 'resting';
    botJump(match.p1, 'easy', state, STEP, rng);
    expect(state.armed).toBe(false);
    expect(state.sampled).toBe(false);
  });

  it('freezes for a whole blunder rather than jittering for one step', () => {
    const { match, rng } = started(15);
    toWaiting(match, match.p1, rng);
    const state = createBotState();
    state.armed = true;
    state.sampled = true;
    state.frozen = BLUNDER_SECONDS;
    const steps = Math.floor(BLUNDER_SECONDS / STEP) - 2;
    for (let i = 0; i < steps; i += 1) {
      expect(botJump(match.p1, 'hard', state, STEP, rng)).toBe(false);
    }
    expect(state.frozen).toBeGreaterThan(0);
  });

  it('costs a blunder most of a swing, so it is a missed instant rather than a flinch', () => {
    expect(BLUNDER_SECONDS).toBeGreaterThan(TAU / SWING_RATE / 5);
  });

  it('holds out for the middle early and settles for the pole late', () => {
    // The same shadow, at two points on the hesitation clock. Early it is not good enough;
    // late it is, because a block is worth one on the pole and nothing on the floor.
    const presses = (wait: number): number => {
      const { match, rng } = started(16);
      toWaiting(match, match.p1, rng);
      const state = createBotState();
      state.armed = true;
      state.bias = 0;
      arm(match.p1, 114, phaseFor(114, (perfectOf(0) + landOf(0)) / 2));
      let pressed = 0;
      for (let i = 0; i < 90; i += 1) {
        match.p1.wait = wait;
        if (botJump(match.p1, 'hard', state, STEP, rng)) pressed += 1;
      }
      return pressed;
    };
    expect(presses(HESITATE_SECONDS * BOT_PATIENCE * 0.5)).toBe(0);
    expect(presses(HESITATE_SECONDS * BOT_PATIENCE + 0.1)).toBeGreaterThan(0);
  });

  it('will not settle for the very ends of the pole even when it is out of patience', () => {
    const { match, rng } = started(17);
    toWaiting(match, match.p1, rng);
    const state = createBotState();
    state.armed = true;
    state.bias = 0;
    arm(match.p1, 114, phaseFor(114, (landOf(0) * (BOT_SETTLE + 1)) / 2 + landOf(0) / 2));
    let pressed = 0;
    for (let i = 0; i < 90; i += 1) {
      match.p1.wait = HESITATE_SECONDS * 0.9;
      if (botJump(match.p1, 'hard', state, STEP, rng)) pressed += 1;
    }
    expect(pressed).toBe(0);
  });

  it('never cuts a block it can see is moving too fast to settle', () => {
    // Rule 6 the other way round: every tier can see the speed, and `haste` is only how
    // much of it each is willing to talk itself out of. The sharpest tier talks itself out
    // of none, so over a run of matches it never once stumbles.
    for (let seed = 1; seed <= 8; seed += 1) {
      const { match } = botMatch('hard', 'hard', seed * 7919);
      expect(match.p1.slips, `seed ${seed}`).toBe(0);
      expect(match.p2.slips, `seed ${seed}`).toBe(0);
    }
  });

  it('reads only its own perch, and cannot be handed the other one', () => {
    // Structural rather than statistical: `botJump` is given one perch and no match, so
    // there is nothing in scope for it to peek at.
    const { match, rng } = started(18);
    toWaiting(match, match.p1, rng);
    const before = { ...match.p2, block: { ...match.p2.block } };
    const state = createBotState();
    for (let i = 0; i < 120; i += 1) botJump(match.p1, 'hard', state, STEP, rng);
    expect({ ...match.p2, block: { ...match.p2.block } }).toEqual(before);
  });

  it('plays a measurably different block at each tier', () => {
    const profile = (tier: BotDifficulty): { perfect: number; scored: number } => {
      let perfects = 0;
      let blocks = 0;
      let points = 0;
      let matches = 0;
      for (let seed = 1; seed <= 20; seed += 1) {
        const { match } = botMatch(tier, tier, seed * 61 + 1);
        perfects += match.p1.perfects;
        blocks += match.p1.used;
        points += match.p1.points;
        matches += 1;
      }
      return { perfect: perfects / blocks, scored: points / matches };
    };
    const easy = profile('easy');
    const normal = profile('normal');
    const hard = profile('hard');
    expect(easy.perfect).toBeLessThan(normal.perfect);
    expect(normal.perfect).toBeLessThan(hard.perfect);
    expect(easy.scored).toBeLessThan(normal.scored);
    expect(normal.scored).toBeLessThan(hard.scored);
  });

  it('beats a weaker tier over a run of seeded matches', () => {
    // The ladder, measured rather than asserted from the profile numbers. SPEC.md records
    // the same figures at four hundred seeds a pairing.
    const hardOverEasy = ladder('hard', 'easy', 24);
    expect(hardOverEasy.p1).toBeGreaterThan(hardOverEasy.p2);
    expect(hardOverEasy.open).toBe(0);

    const normalOverEasy = ladder('normal', 'easy', 24);
    expect(normalOverEasy.p1).toBeGreaterThan(normalOverEasy.p2);

    const hardOverNormal = ladder('hard', 'normal', 24);
    expect(hardOverNormal.p1).toBeGreaterThan(hardOverNormal.p2);
  });

  it('is beaten just as soundly from the other seat', () => {
    const easyUnderHard = ladder('easy', 'hard', 24);
    expect(easyUnderHard.p2).toBeGreaterThan(easyUnderHard.p1);
    expect(easyUnderHard.open).toBe(0);
  });

  it('is even against itself, from either seat', () => {
    const level = ladder('normal', 'normal', 40);
    expect(level.open).toBe(0);
    expect(Math.abs(level.p1 - level.p2)).toBeLessThanOrEqual(16);
  });
});
