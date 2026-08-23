import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { Bout, BotDifficulty, Drive, Wind, Wrestler } from './rules.js';
import {
  BODY_LENGTH,
  BODY_RADIUS,
  BOT_PROFILES,
  GRAVITY,
  GUSTS_PER_ROUND,
  JUMP_SPEED,
  LEAN_TORQUE,
  MAT_FRICTION,
  ROPE_HALF,
  SPRING,
  START_X,
  TIP_ANGLE,
  WIND_MAX,
  botDrive,
  createBotState,
  createBout,
  createDrive,
  createWind,
  createWrestler,
  drawWindSchedule,
  hasFallen,
  headHeight,
  integrateTilt,
  judgeRound,
  readWind,
  resetBout,
  resolveContact,
  settle,
  stepBout,
  stepWrestler,
  wrapAngle,
  wrestlerOf,
} from './rules.js';

const STEP = 1 / 60;
const GUST_STEPS = 270;
const TELEGRAPH_STEPS = 72;

/** Adding a positive zero is exact for every finite value and folds -0 onto 0. */
function plain(value: number): number {
  return value + 0;
}

/** Bit-for-bit, with -0 and 0 treated as the one number they are on a mat. */
function same(actual: number, expected: number, what: string): void {
  expect(plain(actual), what).toBe(plain(expected));
}

function stand(x = 0, angle = 0): Wrestler {
  const w = createWrestler(x);
  w.angle = angle;
  return w;
}

function mirrorOf(w: Readonly<Wrestler>): Wrestler {
  return {
    x: plain(-w.x),
    y: w.y,
    vx: plain(-w.vx),
    vy: w.vy,
    angle: plain(-w.angle),
    spin: plain(-w.spin),
    stance: w.stance,
    topple: plain(-w.topple),
    jumpCooldown: w.jumpCooldown,
    wobble: w.wobble,
  };
}

function expectMirrored(actual: Readonly<Wrestler>, source: Readonly<Wrestler>, tag: string): void {
  same(actual.x, -source.x, `${tag} x`);
  same(actual.vx, -source.vx, `${tag} vx`);
  same(actual.angle, -source.angle, `${tag} angle`);
  same(actual.spin, -source.spin, `${tag} spin`);
  same(actual.y, source.y, `${tag} y`);
  same(actual.vy, source.vy, `${tag} vy`);
  same(actual.wobble, source.wobble, `${tag} wobble`);
  expect(actual.stance, `${tag} stance`).toBe(source.stance);
}

function drive(lean: number, jump = false): Drive {
  return { lean, jump };
}

function still(): Drive {
  return { lean: 0, jump: false };
}

function calm(): Wind {
  return createWind();
}

/** One step of a lone wrestler, contact and settling included. */
function advance(w: Wrestler, lean: number, jump: boolean, wind: number, dt = STEP): void {
  stepWrestler(w, lean, jump, wind, dt);
  settle(w, dt);
}

function schedule(seed: number, round = 0): number[] {
  const out = new Array<number>(GUSTS_PER_ROUND).fill(0);
  drawWindSchedule(out, round, new Rng(seed));
  return out;
}

describe('the fall predicate', () => {
  it('measures the head against the mat and nothing else', () => {
    expect(headHeight(stand(0, 0))).toBeCloseTo(BODY_LENGTH, 9);
    expect(hasFallen(stand(0, 0))).toBe(false);
  });

  it('holds a wrestler up until its head passes the floor line', () => {
    const nearly = stand(0, Math.PI / 2 - 0.02);
    const past = stand(0, Math.PI / 2 + 0.02);

    expect(hasFallen(nearly)).toBe(false);
    expect(hasFallen(past)).toBe(true);
  });

  it('reads the same on either side, so no seat falls sooner', () => {
    const right = stand(0, 1.4);
    const left = stand(0, -1.4);

    expect(headHeight(right)).toBe(headHeight(left));
    expect(hasFallen(right)).toBe(hasFallen(left));
  });

  it('calls a wrestler lying on the mat fallen, whatever else it is doing', () => {
    // The pose a body-physics game gets stuck in: down, but not obviously "out". Here it
    // is simply fallen, because a head below the floor line is a head on the floor.
    const flat = stand(0, 2);
    flat.spin = -4;

    expect(hasFallen(flat)).toBe(true);
  });

  it('trips a head-first landing before the feet ever arrive', () => {
    const diving = stand(0, Math.PI);
    diving.y = BODY_LENGTH - 1;

    expect(hasFallen(diving)).toBe(true);
  });

  it('leaves a wrestler upside down but high in the air still standing', () => {
    const flipping = stand(0, Math.PI);
    flipping.y = BODY_LENGTH + 40;

    expect(hasFallen(flipping)).toBe(false);
  });
});

describe('wrapAngle', () => {
  it('leaves an angle inside one turn alone', () => {
    expect(wrapAngle(1.2)).toBe(1.2);
    expect(wrapAngle(-1.2)).toBe(-1.2);
  });

  it('folds a completed flip back onto upright', () => {
    expect(wrapAngle(Math.PI * 2)).toBeCloseTo(0, 12);
    expect(wrapAngle(Math.PI * 2 + 0.3)).toBeCloseTo(0.3, 12);
    expect(wrapAngle(-Math.PI * 2 - 0.3)).toBeCloseTo(-0.3, 12);
  });

  it('never changes what the fall predicate sees', () => {
    for (const angle of [0.4, 3.9, -3.9, 7.5, -7.5, 12.6]) {
      expect(Math.cos(wrapAngle(angle))).toBeCloseTo(Math.cos(angle), 12);
    }
  });
});

describe('integrateTilt', () => {
  it('brings an undriven lean back towards upright', () => {
    const w = stand(0, 0.5);
    integrateTilt(w, 0, 0.25);

    expect(w.angle).toBeLessThan(0.5);
    expect(w.angle).toBeGreaterThan(0);
    expect(w.spin).toBeLessThan(0);
  });

  it('leaves a wrestler already upright and still exactly where it was', () => {
    const w = stand(0, 0);
    integrateTilt(w, 0, STEP);

    expect(w.angle).toBe(0);
    expect(w.spin).toBe(0);
  });

  it('settles a held lean at torque over spring', () => {
    const w = stand(0, 0);
    for (let i = 0; i < 600; i += 1) integrateTilt(w, LEAN_TORQUE, STEP);

    expect(w.angle).toBeCloseTo(LEAN_TORQUE / SPRING, 5);
    expect(w.spin).toBeCloseTo(0, 4);
  });

  it('is frame-rate independent: two half steps equal one whole step', () => {
    const fine = stand(0, 0.3);
    fine.spin = 1.4;
    integrateTilt(fine, 2, STEP);
    integrateTilt(fine, 2, STEP);

    const coarse = stand(0, 0.3);
    coarse.spin = 1.4;
    integrateTilt(coarse, 2, STEP * 2);

    expect(fine.angle).toBeCloseTo(coarse.angle, 12);
    expect(fine.spin).toBeCloseTo(coarse.spin, 12);
  });

  it('agrees across a whole second however it is chopped up', () => {
    const fine = stand(0, -0.6);
    fine.spin = 2.2;
    for (let i = 0; i < 240; i += 1) integrateTilt(fine, 1.5, 1 / 240);
    const coarse = stand(0, -0.6);
    coarse.spin = 2.2;
    for (let i = 0; i < 60; i += 1) integrateTilt(coarse, 1.5, 1 / 60);

    expect(fine.angle).toBeCloseTo(coarse.angle, 10);
    expect(fine.spin).toBeCloseTo(coarse.spin, 10);
  });

  it('mirrors exactly under a mirrored torque', () => {
    const w = stand(0, 0.44);
    w.spin = -1.7;
    const m = mirrorOf(w);
    integrateTilt(w, 3.1, STEP);
    integrateTilt(m, -3.1, STEP);

    same(m.angle, -w.angle, 'angle');
    same(m.spin, -w.spin, 'spin');
  });
});

describe('a wrestler on the mat', () => {
  it('slides the way it leans', () => {
    const w = stand(0);
    for (let i = 0; i < 30; i += 1) advance(w, 1, false, 0);

    expect(w.x).toBeGreaterThan(0);
    expect(w.vx).toBeGreaterThan(0);
    expect(w.angle).toBeGreaterThan(0);
  });

  it('slides the other way for the other lean, by the same amount', () => {
    const right = stand(0);
    const left = stand(0);
    for (let i = 0; i < 30; i += 1) {
      advance(right, 1, false, 0);
      advance(left, -1, false, 0);
    }

    same(left.x, -right.x, 'x');
    same(left.angle, -right.angle, 'angle');
  });

  it('loses a coasting slide to friction, exponentially', () => {
    const w = stand(0);
    w.vx = 200;
    advance(w, 0, false, 0, 1);

    expect(w.vx).toBeCloseTo(200 * Math.exp(-MAT_FRICTION), 9);
    expect(w.x).toBeCloseTo((200 * (1 - Math.exp(-MAT_FRICTION))) / MAT_FRICTION, 9);
  });

  it('slides identically at 60 Hz and at 120 Hz', () => {
    const fine = stand(0);
    fine.vx = 140;
    stepWrestler(fine, 0.5, false, 120, STEP);
    stepWrestler(fine, 0.5, false, 120, STEP);

    const coarse = stand(0);
    coarse.vx = 140;
    stepWrestler(coarse, 0.5, false, 120, STEP * 2);

    expect(fine.x).toBeCloseTo(coarse.x, 10);
    expect(fine.vx).toBeCloseTo(coarse.vx, 10);
    expect(fine.angle).toBeCloseTo(coarse.angle, 10);
  });

  it('cannot be tipped over by the controls alone, into the worst gust there is', () => {
    // The one property that makes leaning a move rather than a suicide: holding a key
    // into the strongest wind the seed can draw must never reach the tipping point.
    const w = stand(0);
    for (let i = 0; i < 1800; i += 1) {
      advance(w, 1, false, WIND_MAX);
      expect(w.stance).not.toBe('toppling');
      expect(hasFallen(w)).toBe(false);
    }
    expect(Math.abs(w.angle)).toBeLessThan(TIP_ANGLE);
  });

  it('cannot be tipped over by a lean that keeps changing its mind either', () => {
    const w = stand(0);
    for (let i = 0; i < 1800; i += 1) {
      const lean = Math.floor(i / 24) % 2 === 0 ? 1 : -1;
      const wind = Math.floor(i / 91) % 2 === 0 ? WIND_MAX : -WIND_MAX;
      advance(w, lean, false, wind);
      expect(w.stance).not.toBe('fallen');
    }
  });

  it('feels far less of the wind than a wrestler in the air does', () => {
    const planted = stand(0);
    const flying = stand(0);
    flying.stance = 'airborne';
    flying.y = 200;
    for (let i = 0; i < 30; i += 1) {
      stepWrestler(planted, 0, false, WIND_MAX, STEP);
      stepWrestler(flying, 0, false, WIND_MAX, STEP);
    }

    expect(flying.x).toBeGreaterThan(planted.x * 3);
  });

  it('banks lean towards the steadiness tie-break, and nothing while airborne', () => {
    const planted = stand(0, 0.4);
    settle(planted, STEP);
    expect(planted.wobble).toBeCloseTo(0.4 * STEP, 12);

    const flying = stand(0, 0.4);
    flying.stance = 'airborne';
    flying.y = 100;
    settle(flying, STEP);
    expect(flying.wobble).toBe(0);
  });

  it('is held inside the ropes on both sides, and given some of its speed back', () => {
    const right = stand(ROPE_HALF - 1);
    right.vx = 900;
    advance(right, 0, false, 0);
    const left = stand(-(ROPE_HALF - 1));
    left.vx = -900;
    advance(left, 0, false, 0);

    expect(right.x).toBe(ROPE_HALF);
    expect(right.vx).toBeLessThan(0);
    same(left.x, -right.x, 'rope x');
    same(left.vx, -right.vx, 'rope vx');
  });
});

describe('leaping', () => {
  it('leaves the mat and comes back down', () => {
    const w = stand(0);
    advance(w, 0, true, 0);
    expect(w.stance).toBe('airborne');
    expect(w.y).toBeGreaterThan(0);

    let steps = 1;
    while (w.stance === 'airborne' && steps < 400) {
      advance(w, 0, false, 0);
      steps += 1;
    }

    expect(w.stance).toBe('grounded');
    expect(w.y).toBe(0);
    // Airtime is 2 v / g, which at these constants is about three quarters of a second.
    expect(steps / 60).toBeCloseTo((2 * JUMP_SPEED) / GRAVITY, 1);
  });

  it('answers the ask on the very step it is made', () => {
    const w = stand(0);
    stepWrestler(w, 0, true, 0, STEP);

    expect(w.stance).toBe('airborne');
    expect(w.y).toBeGreaterThan(0);
  });

  it('is one leap however long the ask is held', () => {
    const w = stand(0);
    let launches = 0;
    let wasGrounded = true;
    for (let i = 0; i < 300; i += 1) {
      advance(w, 0, true, 0);
      if (wasGrounded && w.stance === 'airborne') launches += 1;
      wasGrounded = w.stance === 'grounded';
    }

    // Three quarters of a second in the air plus the cooldown: five seconds is at most
    // five leaps, and certainly not three hundred.
    expect(launches).toBeGreaterThan(2);
    expect(launches).toBeLessThan(6);
  });

  it('is aimed by the lean it is made with', () => {
    const right = stand(0);
    const left = stand(0);
    const straight = stand(0);
    for (let i = 0; i < 46; i += 1) {
      advance(right, 1, i === 0, 0);
      advance(left, -1, i === 0, 0);
      advance(straight, 0, i === 0, 0);
    }

    expect(right.x).toBeGreaterThan(straight.x);
    expect(left.x).toBeLessThan(straight.x);
    same(left.x, -right.x, 'aimed leap');
  });

  it('is carried downwind, and the same distance whichever way the wind blows', () => {
    const withWind = stand(0);
    const against = stand(0);
    const calmAir = stand(0);
    for (let i = 0; i < 46; i += 1) {
      advance(withWind, 0, i === 0, WIND_MAX);
      advance(against, 0, i === 0, -WIND_MAX);
      advance(calmAir, 0, i === 0, 0);
    }

    expect(withWind.x).toBeGreaterThan(calmAir.x);
    expect(against.x).toBeLessThan(calmAir.x);
    same(against.x, -withWind.x, 'wind drift');
  });

  it('flies identically at 60 Hz and at 120 Hz', () => {
    const fine = stand(0);
    fine.stance = 'airborne';
    fine.y = 90;
    fine.vy = 200;
    fine.vx = 60;
    fine.spin = 1.1;
    stepWrestler(fine, 0, false, 200, STEP);
    stepWrestler(fine, 0, false, 200, STEP);

    const coarse = stand(0);
    coarse.stance = 'airborne';
    coarse.y = 90;
    coarse.vy = 200;
    coarse.vx = 60;
    coarse.spin = 1.1;
    stepWrestler(coarse, 0, false, 200, STEP * 2);

    expect(fine.x).toBeCloseTo(coarse.x, 10);
    expect(fine.y).toBeCloseTo(coarse.y, 10);
    expect(fine.vx).toBeCloseTo(coarse.vx, 10);
    expect(fine.vy).toBeCloseTo(coarse.vy, 10);
    expect(fine.angle).toBeCloseTo(coarse.angle, 12);
  });

  it('lands toppling when it comes in too steep to stick', () => {
    const w = stand(0);
    w.stance = 'airborne';
    w.y = 3;
    w.vy = -400;
    w.angle = 1.2;
    advance(w, 0, false, 0);

    expect(w.stance).toBe('toppling');
  });

  it('lands on its feet when it comes in upright', () => {
    const w = stand(0);
    w.stance = 'airborne';
    w.y = 3;
    w.vy = -400;
    w.angle = 0.1;
    advance(w, 0, false, 0);

    expect(w.stance).toBe('grounded');
    expect(w.y).toBe(0);
  });

  it('cannot be leapt again the instant it lands', () => {
    const w = stand(0);
    w.stance = 'airborne';
    w.y = 3;
    w.vy = -400;
    advance(w, 0, false, 0);
    expect(w.stance).toBe('grounded');

    advance(w, 0, true, 0);
    expect(w.stance).toBe('grounded');
  });
});

describe('toppling', () => {
  it('starts the moment a standing wrestler passes the tipping point', () => {
    const w = stand(0, TIP_ANGLE - 0.01);
    settle(w, STEP);
    expect(w.stance).toBe('grounded');

    w.angle = TIP_ANGLE + 0.01;
    settle(w, STEP);
    expect(w.stance).toBe('toppling');
    expect(w.topple).toBe(1);
  });

  it('starts on either side, and records which', () => {
    const w = stand(0, -(TIP_ANGLE + 0.01));
    settle(w, STEP);

    expect(w.stance).toBe('toppling');
    expect(w.topple).toBe(-1);
  });

  it('ignores every lean it is given: past the point of no return there is no saving it', () => {
    const saved = stand(0, TIP_ANGLE + 0.01);
    settle(saved, STEP);
    const ignored = stand(0, TIP_ANGLE + 0.01);
    settle(ignored, STEP);
    for (let i = 0; i < 6; i += 1) {
      advance(saved, -1, true, 0);
      advance(ignored, 0, false, 0);
    }

    same(saved.angle, ignored.angle, 'topple angle');
  });

  it('always reaches the mat, from every spin it can be entered with', () => {
    for (const spin of [-8, -4, -1, 0, 1, 4, 8]) {
      const w = stand(0, TIP_ANGLE + 0.01);
      w.spin = spin;
      // Entered through settle's own tipping-point test rather than by writing the stance
      // in by hand, so what the loop below watches is a stance the rules set.
      settle(w, STEP);
      expect(w.stance, `spin ${String(spin)}`).toBe('toppling');
      expect(w.topple, `spin ${String(spin)}`).toBe(1);

      let steps = 0;
      while (w.stance !== 'fallen' && steps < 600) {
        advance(w, 0, false, 0);
        steps += 1;
      }

      expect(w.stance, `spin ${String(spin)}`).toBe('fallen');
      // The stance and the fall predicate are the same fact, and a round ending on one
      // while the other still reads upright is the bug this pins down.
      expect(hasFallen(w), `spin ${String(spin)}`).toBe(true);
      // A third of a second from a standing start; a second is generous even for a body
      // entering the topple spinning the wrong way at eight radians a second.
      expect(steps, `spin ${String(spin)}`).toBeLessThan(120);
    }
  });

  it('goes down against the strongest wind holding it up', () => {
    const w = stand(0, TIP_ANGLE + 0.01);
    settle(w, STEP);
    expect(w.stance).toBe('toppling');

    let steps = 0;
    while (w.stance !== 'fallen' && steps < 600) {
      // The gust blows the way the body is falling from, so its torque fights the topple.
      advance(w, 0, false, -WIND_MAX);
      steps += 1;
    }

    expect(w.stance).toBe('fallen');
    // TOPPLE_TORQUE is what bounds a round, so the strongest gust the seed can draw may
    // slow the fall but must not come near lifting the body back over the tipping point.
    expect(steps).toBeLessThan(120);
  });

  it('stays fallen once it is down', () => {
    const w = stand(0, 2);
    settle(w, STEP);
    expect(w.stance).toBe('fallen');

    const before = w.x;
    advance(w, 1, true, WIND_MAX);
    expect(w.stance).toBe('fallen');
    expect(w.x).toBe(before);
  });
});

describe('resolveContact', () => {
  it('reports a miss without touching either wrestler', () => {
    const a = stand(-200);
    a.vx = 50;
    const b = stand(200);

    expect(resolveContact(a, b)).toBe(false);
    expect(a.x).toBe(-200);
    expect(a.vx).toBe(50);
    expect(b.x).toBe(200);
  });

  it('separates a pair that has ended up overlapping', () => {
    const a = stand(-20);
    const b = stand(20);

    expect(resolveContact(a, b)).toBe(true);
    expect(b.x - a.x).toBeCloseTo(BODY_RADIUS * 2, 9);
  });

  it('shares the separation evenly, so neither seat is pushed further', () => {
    const a = stand(-20);
    const b = stand(20);
    resolveContact(a, b);

    same(a.x, -b.x, 'separation');
  });

  it('swaps momentum between two wrestlers running into each other', () => {
    const a = stand(-30);
    a.vx = 300;
    const b = stand(30);
    b.vx = -300;
    resolveContact(a, b);

    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
    same(a.vx, -b.vx, 'impulse');
  });

  it('never drags a pair that is already separating back together', () => {
    const a = stand(-30);
    a.vx = -300;
    const b = stand(30);
    b.vx = 300;
    const before = a.vx;
    resolveContact(a, b);

    expect(a.vx).toBe(before);
  });

  it('turns a high shove into spin and a low one into travel', () => {
    const high = stand(0, 0);
    const highFoe = stand(BODY_RADIUS * 2 - 6, 0);
    highFoe.y = BODY_LENGTH;
    highFoe.vx = -500;
    resolveContact(high, highFoe);

    const low = stand(0, 0);
    const lowFoe = stand(BODY_RADIUS * 2 - 6, 0);
    lowFoe.vx = -500;
    resolveContact(low, lowFoe);

    expect(Math.abs(high.spin)).toBeGreaterThan(Math.abs(low.spin));
    expect(Math.abs(low.vx)).toBeGreaterThan(Math.abs(high.vx));
  });

  it('refuses to shove a wrestler that is already down', () => {
    const a = stand(-20);
    const b = stand(20);
    b.stance = 'fallen';

    expect(resolveContact(a, b)).toBe(false);
    expect(a.x).toBe(-20);
  });

  it('parts a pair standing exactly on top of each other', () => {
    const a = stand(-1);
    const b = stand(1);

    expect(resolveContact(a, b)).toBe(true);
    expect(a.x).toBeLessThan(b.x);
  });

  it('mirrors exactly', () => {
    const a = stand(-30, 0.3);
    a.vx = 240;
    a.spin = 1.2;
    const b = stand(24, -0.4);
    b.vx = -180;
    b.spin = -0.7;
    const ma = mirrorOf(a);
    const mb = mirrorOf(b);

    resolveContact(a, b);
    resolveContact(ma, mb);

    expectMirrored(ma, a, 'contact a');
    expectMirrored(mb, b, 'contact b');
  });
});

describe('the wind', () => {
  it('is reproducible from the seed', () => {
    expect(schedule(4711)).toEqual(schedule(4711));
  });

  it('differs between seeds, so two matches do not share a forecast', () => {
    expect(schedule(4711)).not.toEqual(schedule(4712));
  });

  it('never exceeds the strongest gust the game admits to', () => {
    for (const seed of [1, 2, 3, 99, 20260824]) {
      for (const gust of schedule(seed)) {
        expect(Math.abs(gust)).toBeLessThanOrEqual(WIND_MAX);
      }
    }
  });

  it('alternates direction gust by gust, so a round is not one long push', () => {
    const gusts = schedule(20260824);
    for (let i = 0; i + 1 < gusts.length; i += 1) {
      const a = gusts[i] ?? 0;
      const b = gusts[i + 1] ?? 0;
      expect(a * b, `gusts ${String(i)} and ${String(i + 1)}`).toBeLessThanOrEqual(0);
    }
  });

  it('starts a round blowing the way the round before did not', () => {
    for (const seed of [7, 8, 9]) {
      expect(schedule(seed, 0)[0] ?? 0).toBeGreaterThanOrEqual(0);
      expect(schedule(seed, 1)[0] ?? 0).toBeLessThanOrEqual(0);
      expect(schedule(seed, 2)[0] ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws exactly one number a gust, so the stream stays in step', () => {
    const rng = new Rng(31);
    const out = new Array<number>(GUSTS_PER_ROUND).fill(0);
    drawWindSchedule(out, 0, rng);
    const after = rng.float();

    const check = new Rng(31);
    for (let i = 0; i < GUSTS_PER_ROUND; i += 1) check.float();
    expect(after).toBe(check.float());
  });
});

describe('readWind', () => {
  const gusts = schedule(20260824);

  it('reports the gust blowing now', () => {
    const wind = calm();
    readWind(wind, gusts, 0, GUST_STEPS, TELEGRAPH_STEPS);
    expect(wind.strength).toBe(gusts[0]);

    readWind(wind, gusts, GUST_STEPS, GUST_STEPS, TELEGRAPH_STEPS);
    expect(wind.strength).toBe(gusts[1]);
  });

  it('says nothing about the next gust until its arrow is due', () => {
    const wind = calm();
    readWind(wind, gusts, 0, GUST_STEPS, TELEGRAPH_STEPS);

    expect(wind.upcoming).toBe(0);
    expect(wind.warning).toBe(0);
  });

  it('announces the next gust exactly one telegraph before it arrives', () => {
    const wind = calm();
    readWind(wind, gusts, GUST_STEPS - TELEGRAPH_STEPS - 1, GUST_STEPS, TELEGRAPH_STEPS);
    expect(wind.warning).toBe(0);

    readWind(wind, gusts, GUST_STEPS - TELEGRAPH_STEPS, GUST_STEPS, TELEGRAPH_STEPS);
    expect(wind.upcoming).toBe(gusts[1]);
    expect(wind.warning).toBeGreaterThan(0);
    expect(wind.warning).toBeLessThanOrEqual(1);
  });

  it('runs its warning down as the gust closes in', () => {
    const wind = calm();
    readWind(wind, gusts, GUST_STEPS - TELEGRAPH_STEPS, GUST_STEPS, TELEGRAPH_STEPS);
    const early = wind.warning;
    readWind(wind, gusts, GUST_STEPS - 4, GUST_STEPS, TELEGRAPH_STEPS);

    expect(wind.warning).toBeLessThan(early);
    expect(wind.warning).toBeGreaterThan(0);
  });

  it('never announces a gust past the end of the round', () => {
    const wind = calm();
    const last = GUSTS_PER_ROUND * GUST_STEPS - 1;
    readWind(wind, gusts, last, GUST_STEPS, TELEGRAPH_STEPS);

    expect(wind.strength).toBe(gusts[GUSTS_PER_ROUND - 1]);
    expect(wind.upcoming).toBe(0);
    expect(wind.warning).toBe(0);
  });

  it('holds the last gust for a round that outlives its forecast', () => {
    const wind = calm();
    readWind(wind, gusts, GUSTS_PER_ROUND * GUST_STEPS + 500, GUST_STEPS, TELEGRAPH_STEPS);

    expect(wind.strength).toBe(gusts[GUSTS_PER_ROUND - 1]);
  });
});

describe('judgeRound', () => {
  function bout(): Bout {
    const b = createBout();
    resetBout(b);
    return b;
  }

  it('leaves a round running while both are on their feet', () => {
    expect(judgeRound(bout(), false)).toBe('live');
  });

  it('gives the round to the seat still standing', () => {
    const b = bout();
    b.p2.stance = 'fallen';
    expect(judgeRound(b, false)).toBe('p1');

    const other = bout();
    other.p1.stance = 'fallen';
    expect(judgeRound(other, false)).toBe('p2');
  });

  it('scores a double knock-down for both, rather than for whoever was tested first', () => {
    const b = bout();
    b.p1.stance = 'fallen';
    b.p2.stance = 'fallen';

    expect(judgeRound(b, true)).toBe('both');
    expect(judgeRound(b, false)).toBe('both');
  });

  it('gives a round that runs out of clock to the steadier wrestler', () => {
    const b = bout();
    b.p1.wobble = 2;
    b.p2.wobble = 5;
    expect(judgeRound(b, true)).toBe('p1');

    b.p1.wobble = 5;
    b.p2.wobble = 2;
    expect(judgeRound(b, true)).toBe('p2');
  });

  it('scores nothing at all when the clock runs out on a dead-level pair', () => {
    const b = bout();
    b.p1.wobble = 3;
    b.p2.wobble = 3;

    expect(judgeRound(b, true)).toBe('nobody');
  });

  it('lets a fall beat the clock', () => {
    const b = bout();
    b.p1.wobble = 0;
    b.p2.wobble = 9;
    b.p1.stance = 'fallen';

    expect(judgeRound(b, true)).toBe('p2');
  });
});

describe('seat symmetry', () => {
  it('stands the two seats up as exact mirrors of each other', () => {
    const b = createBout();
    resetBout(b);

    expect(b.p1.x).toBe(-START_X);
    expect(b.p2.x).toBe(START_X);
    expectMirrored(b.p2, b.p1, 'start');
  });

  it('steps a mirrored wrestler to the mirror of the step', () => {
    const w = stand(-120, 0.22);
    w.vx = 90;
    w.spin = -0.8;
    const m = mirrorOf(w);
    for (let i = 0; i < 240; i += 1) {
      advance(w, 0.6, i % 40 === 0, 160);
      advance(m, -0.6, i % 40 === 0, -160);
      expectMirrored(m, w, `step ${String(i)}`);
    }
  });

  /**
   * The test that catches a seat-one advantage inside a single bout.
   *
   * The bout starts perfectly mirrored and both seats are given mirrored intent, so the
   * two bodies must stay exact mirrors for a whole rally — collision included, which is
   * where a handedness bug would live. Compared bit for bit rather than to a tolerance,
   * because a tolerance is exactly what hides a small advantage.
   *
   * **Deliberately in still air.** The wind is one horizontal force on the whole mat, so
   * it pushes both wrestlers the *same* way rather than mirrored ways, and a bout in a
   * gust is not a mirror of itself. That the wind is even-handed is a different claim,
   * checked separately below and again by mirroring the world around it.
   */
  it('keeps a mirrored bout mirrored, collisions and all, for a whole rally', () => {
    const b = createBout();
    resetBout(b);
    const p1 = drive(0, false);
    const p2 = drive(0, false);

    for (let i = 0; i < 1400; i += 1) {
      // Mirrored intent: p1 pushes towards p2 exactly as p2 pushes towards p1.
      p1.lean = Math.sin(i / 37);
      p2.lean = -p1.lean;
      p1.jump = i % 55 === 0;
      p2.jump = p1.jump;
      stepBout(b, p1, p2, 0, STEP);
      expectMirrored(b.p2, b.p1, `rally step ${String(i)}`);
      if (b.p1.stance === 'fallen') break;
    }
  });

  it('blows the wind on both seats at once, by the same amount and the same way', () => {
    const b = createBout();
    resetBout(b);
    const idle = still();
    const gap = b.p2.x - b.p1.x;

    for (let i = 0; i < 60 * 30; i += 1) {
      // Gusts that turn round every second, so the pair stays clear of the ropes and the
      // only thing being measured is the wind rather than a rebound off one.
      stepBout(b, idle, idle, i % 120 < 60 ? WIND_MAX : -WIND_MAX, STEP);
      // Both are carried together: the gust moves the pair, never one of them. The gap
      // is compared to nine places rather than bit for bit only because the two feet sit
      // at different magnitudes and the same addition rounds differently there — a
      // property of doubles, not of the wind.
      expect(b.p2.x - b.p1.x, `gap at ${String(i)}`).toBeCloseTo(gap, 9);
      // The lean, which is what the tie-break is scored on, is identical outright.
      same(b.p2.angle, b.p1.angle, `lean at ${String(i)}`);
      same(b.p2.wobble, b.p1.wobble, `wobble at ${String(i)}`);
    }
  });

  /**
   * The seat-swap test: play a bout, then play it with the two seats exchanged and the
   * whole world — the wind included — mirrored, and require the outcomes to match bit for
   * bit with the seats read the other way round.
   *
   * This is the one that would fail if anything anywhere resolved a tie by seat order, or
   * if the collision solver read its first argument differently from its second.
   */
  it('gives the identical bout to whichever seat is on whichever side', () => {
    const straight = createBout();
    straight.p1.x = -90;
    straight.p1.angle = 0.18;
    straight.p1.spin = 0.4;
    straight.p2.x = 120;
    straight.p2.angle = -0.25;
    straight.p2.vx = -40;

    // The same two wrestlers, in the other two seats, on the other side of the mat.
    const swapped = createBout();
    Object.assign(swapped.p1, mirrorOf(straight.p2));
    Object.assign(swapped.p2, mirrorOf(straight.p1));

    const a1 = drive(0.65);
    const a2 = drive(-0.35);
    const b1 = drive(0.35);
    const b2 = drive(-0.65);

    for (let i = 0; i < 1200; i += 1) {
      a1.jump = i % 57 === 0;
      a2.jump = i % 41 === 0;
      b1.jump = a2.jump;
      b2.jump = a1.jump;
      stepBout(straight, a1, a2, 240, STEP);
      stepBout(swapped, b1, b2, -240, STEP);
      expectMirrored(swapped.p1, straight.p2, `swapped seat one at ${String(i)}`);
      expectMirrored(swapped.p2, straight.p1, `swapped seat two at ${String(i)}`);
      if (judgeRound(straight, false) !== 'live') break;
    }

    const outcome = judgeRound(straight, false);
    const swappedOutcome = judgeRound(swapped, false);
    expect(swappedOutcome).toBe(outcome === 'p1' ? 'p2' : outcome === 'p2' ? 'p1' : outcome);
  });

  it('brings a mirrored bout down on the same step or not at all', () => {
    const b = createBout();
    resetBout(b);
    const p1 = drive(1, false);
    const p2 = drive(-1, false);

    let fell = 0;
    for (let i = 0; i < 1800; i += 1) {
      p1.jump = i % 48 === 0;
      p2.jump = p1.jump;
      stepBout(b, p1, p2, 0, STEP);
      if (judgeRound(b, false) !== 'live') {
        fell = i;
        break;
      }
    }

    expect(judgeRound(b, false)).toBe(fell === 0 ? 'live' : 'both');
  });

  it('mirrors a whole bout when the world is mirrored around it', () => {
    const straight = createBout();
    resetBout(straight);
    straight.p1.x = -80;
    straight.p2.x = 130;
    straight.p2.angle = 0.2;

    const flipped = createBout();
    flipped.p1.x = 80;
    flipped.p2.x = -130;
    flipped.p2.angle = -0.2;

    const a1 = drive(0.7);
    const a2 = drive(-0.2);
    const b1 = drive(-0.7);
    const b2 = drive(0.2);

    for (let i = 0; i < 900; i += 1) {
      a1.jump = i % 61 === 0;
      a2.jump = i % 43 === 0;
      b1.jump = a1.jump;
      b2.jump = a2.jump;
      stepBout(straight, a1, a2, 220, STEP);
      stepBout(flipped, b1, b2, -220, STEP);
      expectMirrored(flipped.p1, straight.p1, `flipped p1 at ${String(i)}`);
      expectMirrored(flipped.p2, straight.p2, `flipped p2 at ${String(i)}`);
      if (straight.p1.stance === 'fallen' || straight.p2.stance === 'fallen') break;
    }
  });
});

describe('the bot', () => {
  const tiers: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

  function ask(
    difficulty: BotDifficulty,
    self: Wrestler,
    other: Wrestler,
    wind: Wind,
    roll = 0.5,
    steps = 1,
  ): Drive {
    const bot = createBotState();
    const out = createDrive();
    for (let i = 0; i < steps; i += 1)
      botDrive(out, bot, self, other, wind, difficulty, STEP, roll);
    return out;
  }

  it('gets quicker and steadier with every tier, and never the other way about', () => {
    expect(BOT_PROFILES.easy.lag).toBeGreaterThan(BOT_PROFILES.normal.lag);
    expect(BOT_PROFILES.normal.lag).toBeGreaterThan(BOT_PROFILES.hard.lag);
    expect(BOT_PROFILES.easy.leanError).toBeGreaterThan(BOT_PROFILES.normal.leanError);
    expect(BOT_PROFILES.normal.leanError).toBeGreaterThan(BOT_PROFILES.hard.leanError);
  });

  it('has exactly two levers, because every other one was measured and was not skill', () => {
    // Anything else — how hard it corrects, how early it breaks off, how far it commits
    // a leap from — is style, and varying it by tier inverted the ladder. See the note in
    // rules.ts above BOT_PROFILES.
    for (const tier of tiers) {
      expect(Object.keys(BOT_PROFILES[tier]).sort(), tier).toEqual(['lag', 'leanError']);
    }
  });

  it('is never handed anything a hand cannot also ask for', () => {
    for (const tier of tiers) {
      const out = ask(tier, stand(-100), stand(120), calm(), 0);
      expect(Math.abs(out.lean), tier).toBeLessThanOrEqual(1);
    }
  });

  it('closes on the opponent when it is comfortable', () => {
    const out = ask('hard', stand(-200), stand(120), calm());
    expect(out.lean).toBeGreaterThan(0);

    const other = ask('hard', stand(200), stand(-120), calm());
    expect(other.lean).toBeLessThan(0);
  });

  it('saves its balance before it thinks about the opponent', () => {
    const falling = stand(-200, 0.9);
    const out = ask('hard', falling, stand(120), calm());

    // Leaning towards the opponent is +x; it leans the other way instead, and does not
    // leave the mat while it is doing it.
    expect(out.lean).toBeLessThan(0);
    expect(out.jump).toBe(false);
  });

  it('leaps only once it is near enough, and only from the mat', () => {
    const far = ask('normal', stand(-330), stand(120), calm());
    expect(far.jump).toBe(false);

    const near = ask('normal', stand(0), stand(120), calm());
    expect(near.jump).toBe(true);

    const flying = stand(0);
    flying.stance = 'airborne';
    flying.y = 60;
    expect(ask('normal', flying, stand(120), calm()).jump).toBe(false);
  });

  it('holds the misjudgement it committed to between decisions', () => {
    const bot = createBotState();
    const out = createDrive();
    const self = stand(-200);
    const other = stand(120);
    botDrive(out, bot, self, other, calm(), 'easy', STEP, 0.1);
    const committed = out.lean;

    // A wildly different roll on the very next step changes nothing: the mistake is held
    // until the bot next looks. Re-drawing it every step would average it to zero and
    // make all three tiers the same bot.
    botDrive(out, bot, self, other, calm(), 'easy', STEP, 0.95);

    expect(out.lean).toBe(committed);
  });

  it('aims at where the opponent was, further back the easier it is', () => {
    // The whole of the lag lever: a bot is late about the OPPONENT, which is the half of
    // the picture a person has to watch. It is never late about its own balance, because
    // a person is not.
    const self = stand(0);
    const running = stand(150);
    running.vx = -400;

    const easy = ask('easy', self, running, calm());
    const normal = ask('normal', self, running, calm());
    const hard = ask('hard', self, running, calm());

    // Reading the mat as it was is strictly less than the person opposite has: it can
    // only ever put the opponent where they no longer are.
    expect(easy.jump).toBe(false);
    expect(hard.jump).toBe(true);
    expect(normal.lean).toBeGreaterThanOrEqual(hard.lean);
  });

  it('cannot act on a gust before its arrow is on the screen', () => {
    const self = stand(-40);
    const other = stand(120);
    const hidden: Wind = { strength: 0, upcoming: -WIND_MAX, warning: 0 };
    const nothing: Wind = { strength: 0, upcoming: 0, warning: 0 };
    const shown: Wind = { strength: 0, upcoming: -WIND_MAX, warning: 1 };

    expect(ask('hard', self, other, hidden).jump).toBe(ask('hard', self, other, nothing).jump);
    expect(ask('hard', self, other, shown).jump).not.toBe(ask('hard', self, other, nothing).jump);
  });

  it('allows for the wind before it leaps, on every tier alike', () => {
    // Reading the wind is the game's whole subject, so it is not a difficulty setting:
    // every tier works out where a leap would come down and refuses one the wind would
    // carry past the opponent.
    for (const tier of tiers) {
      const self = stand(-40);
      const other = stand(120);
      const calmLeap = ask(tier, self, other, calm(), 0.5);
      const blownLeap = ask(
        tier,
        self,
        other,
        { strength: -WIND_MAX, upcoming: 0, warning: 0 },
        0.5,
      );

      expect(calmLeap.jump, tier).toBe(true);
      expect(blownLeap.jump, tier).toBe(false);
    }
  });

  it('mirrors exactly, so no tier plays better from one side', () => {
    for (const tier of tiers) {
      const self = stand(-140, 0.35);
      self.spin = 0.9;
      const other = stand(90, -0.2);
      const wind: Wind = { strength: 210, upcoming: -180, warning: 0.4 };
      const mirrorWind: Wind = { strength: -210, upcoming: 180, warning: 0.4 };
      // A roll of a half is no misjudgement at all, which is what leaves the decision
      // itself on the table to be compared.
      const straight = ask(tier, self, other, wind, 0.5);
      const flipped = ask(tier, mirrorOf(self), mirrorOf(other), mirrorWind, 0.5);

      same(flipped.lean, -straight.lean, `${tier} lean`);
      expect(flipped.jump, `${tier} jump`).toBe(straight.jump);
    }
  });

  it('wrestles rather than standing off: every tier knocks somebody down', () => {
    for (const tier of tiers) {
      let falls = 0;
      for (const seed of [11, 22, 33, 44, 55]) {
        const b = createBout();
        resetBout(b);
        const botP1 = createBotState();
        const botP2 = createBotState();
        const d1 = createDrive();
        const d2 = createDrive();
        const rng = new Rng(seed);
        for (let i = 0; i < 60 * 40 && judgeRound(b, false) === 'live'; i += 1) {
          botDrive(d1, botP1, b.p1, b.p2, calm(), tier, STEP, rng.float());
          botDrive(d2, botP2, b.p2, b.p1, calm(), tier, STEP, rng.float());
          stepBout(b, d1, d2, 0, STEP);
        }
        if (judgeRound(b, false) !== 'live') falls += 1;
      }

      // Not all five, because a round that runs out of clock is a legitimate way for one
      // to end — but a tier that never puts anybody down is not playing the game.
      expect(falls, tier).toBeGreaterThan(0);
    }
  });
});

describe('wrestlerOf', () => {
  it('hands back the seat that was asked for', () => {
    const b = createBout();
    expect(wrestlerOf(b, 'p1')).toBe(b.p1);
    expect(wrestlerOf(b, 'p2')).toBe(b.p2);
  });
});

describe('a bout with nobody driving it', () => {
  it('leaves two motionless wrestlers standing, so the clock has to settle it', () => {
    const b = createBout();
    resetBout(b);
    const idle = still();
    for (let i = 0; i < 60 * 60; i += 1) stepBout(b, idle, idle, 0, STEP);

    expect(b.p1.stance).toBe('grounded');
    expect(b.p2.stance).toBe('grounded');
    expect(judgeRound(b, false)).toBe('live');
    expect(judgeRound(b, true)).toBe('nobody');
  });

  it('holds two motionless wrestlers exactly level however hard the wind blows', () => {
    const b = createBout();
    resetBout(b);
    const idle = still();
    const gusts = schedule(555);
    for (let i = 0; i < 60 * 40; i += 1) {
      stepBout(b, idle, idle, gusts[Math.floor(i / GUST_STEPS) % GUSTS_PER_ROUND] ?? 0, STEP);
    }

    // Both feel the same wind at the same moment, so neither is worn down faster than the
    // other and the tie-break stays a tie.
    expect(b.p1.wobble).toBe(b.p2.wobble);
    expect(judgeRound(b, true)).toBe('nobody');
  });
});
