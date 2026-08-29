import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BLAST,
  BOT_DRAWS_PER_ROCKET,
  BOT_PROFILES,
  CARRIAGE_MAX_X,
  CARRIAGE_MIN_X,
  CELLS,
  CENTRE,
  COL_ORIGIN,
  COL_SPACING,
  CORE,
  FUSE,
  GROUND,
  LANTERNS,
  MAX_RANGE,
  MIN_RANGE,
  OPENING,
  RELOAD,
  ROCKETS,
  ROCKET_FLYING,
  ROCKET_FREE,
  ROCKET_SLOTS_PER_SEAT,
  ROWS,
  ROW_ORIGIN,
  ROW_SPACING,
  SWEEP_RATE,
  baseYOf,
  botHold,
  createBotState,
  createGround,
  forwardOf,
  landingYOf,
  lanternsOf,
  launcherOf,
  otherOf,
  planShot,
  resetBotState,
  resetGround,
  scoreOf,
  setHold,
  step,
  timeToColumn,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Ground, Lantern } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

interface Report {
  readonly winner: SeatId | 'draw' | null;
  readonly p1: number;
  readonly p2: number;
  readonly p1Clean: number;
  readonly p2Clean: number;
  readonly seconds: number;
  readonly steps: number;
  readonly ground: Ground;
}

/**
 * Play a whole match between two bots, exactly the way `game.ts` does.
 *
 * **No step ceiling, on purpose.** A game that failed to terminate should hang this suite and
 * be found, rather than fall out of a capped loop and report a null winner that some later
 * assertion turns into a confusing failure.
 */
function botMatch(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  options?: { readonly reversed?: boolean; readonly opener?: SeatId },
): Report {
  const source = new Rng(seed);
  const worldRng = new Rng(source.next() | 0);
  const botRng: Record<SeatId, Rng> = {
    p1: new Rng(source.next() | 0),
    p2: new Rng(source.next() | 0),
  };
  const ground = createGround();
  resetGround(ground, worldRng, options?.opener ?? 'p1');
  const states = { p1: createBotState(), p2: createBotState() };
  const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
  const order: readonly SeatId[] = options?.reversed === true ? ['p2', 'p1'] : SEATS;

  let steps = 0;
  while (winnerOf(ground) === null) {
    for (const seat of order) {
      setHold(ground, seat, botHold(ground, seat, tiers[seat], states[seat], botRng[seat], STEP));
    }
    step(ground, STEP);
    steps += 1;
  }
  return {
    winner: winnerOf(ground),
    p1: scoreOf(ground, 'p1'),
    p2: scoreOf(ground, 'p2'),
    p1Clean: ground.p1.clean,
    p2Clean: ground.p2.clean,
    seconds: steps * STEP,
    steps,
    ground,
  };
}

/** Play with both seats' controls driven by a fixed script rather than by a bot. */
function scriptedMatch(hold: (seat: SeatId, step: number) => boolean): Report {
  const ground = createGround();
  resetGround(ground, new Rng(4242));
  let steps = 0;
  while (winnerOf(ground) === null) {
    for (const seat of SEATS) setHold(ground, seat, hold(seat, steps));
    step(ground, STEP);
    steps += 1;
  }
  return {
    winner: winnerOf(ground),
    p1: scoreOf(ground, 'p1'),
    p2: scoreOf(ground, 'p2'),
    p1Clean: ground.p1.clean,
    p2Clean: ground.p2.clean,
    seconds: steps * STEP,
    steps,
    ground,
  };
}

function freshGround(seed = 4242): Ground {
  const ground = createGround();
  resetGround(ground, new Rng(seed));
  return ground;
}

/** Run past the opening freeze so the carts are rolling and a press means something. */
function open(ground: Ground): void {
  const steps = Math.ceil(OPENING / STEP) + 1;
  for (let i = 0; i < steps; i += 1) step(ground, STEP);
}

describe('the ground', () => {
  it('is the same picture upside down', () => {
    // Rule 9 and the archetype's camera rule both come down to this: there is no camera, the
    // whole ground is on screen for both seats at all times, and the two halves are one shape
    // half-turned. Anything else would give one seat an easier festival.
    for (let seed = 1; seed <= 40; seed += 1) {
      const ground = freshGround(seed);
      const p1 = lanternsOf(ground, 'p1');
      const p2 = lanternsOf(ground, 'p2');
      expect(p1.length).toBe(LANTERNS);
      expect(p2.length).toBe(LANTERNS);
      for (let i = 0; i < LANTERNS; i += 1) {
        const near = p1[i] as Lantern;
        const far = p2[i] as Lantern;
        expect(near.x).toBe(GROUND - far.x);
        expect(near.y).toBe(GROUND - far.y);
      }
    }
  });

  it('gives the opening seat the low end of the rail, and the mirror to the other', () => {
    // A real-time game has no opener, and the contract lets one ignore `context.openingSeat`.
    // It is read anyway: the two arrangements are exact mirrors, so it changes the match
    // without changing who is favoured, which is what a balance harness playing each seed from
    // both openers needs in order to separate a seat effect from a seed effect.
    const first = createGround();
    resetGround(first, new Rng(31), 'p1');
    const second = createGround();
    resetGround(second, new Rng(31), 'p2');
    expect(first.p1.x).toBe(CARRIAGE_MIN_X);
    expect(second.p2.x).toBe(CARRIAGE_MIN_X);
    expect(first.p1.x).toBe(second.p2.x);
    expect(first.p2.x).toBe(second.p1.x);
    expect(first.p1.right).toBe(second.p2.right);
  });

  it('plays a different match from each opener, and favours neither seat', () => {
    let swung = 0;
    let p1 = 0;
    let decided = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const first = botMatch(seed * 7919, 'normal', 'normal', { opener: 'p1' });
      const second = botMatch(seed * 7919, 'normal', 'normal', { opener: 'p2' });
      if (first.winner !== second.winner) swung += 1;
      for (const report of [first, second]) {
        if (report.winner === 'p1') p1 += 1;
        if (report.winner !== 'draw') decided += 1;
      }
    }
    // It has to move the match, or reading the opening seat is a comment rather than a rule.
    expect(swung).toBeGreaterThan(0);
    expect(p1 / decided).toBeGreaterThan(0.38);
    expect(p1 / decided).toBeLessThan(0.62);
  });

  it('starts both carts at mirrored ends of identical rails', () => {
    const ground = freshGround();
    expect(ground.p1.x).toBe(GROUND - ground.p2.x);
    expect(ground.p1.right).toBe(!ground.p2.right);
    expect(baseYOf('p1')).toBe(GROUND - baseYOf('p2'));
    expect(ground.p1.rockets).toBe(ground.p2.rockets);
    expect(ground.p1.range).toBe(ground.p2.range);
  });

  it('keeps the two carts mirrored for the whole match when neither is touched', () => {
    // The carts only ever stop for a press, so two untouched carts stay mirror images — which
    // is what makes "neither seat's cart is nearer a column than the other's" true at every
    // moment rather than only at the start.
    const ground = freshGround();
    for (let i = 0; i < 60 * 20; i += 1) {
      setHold(ground, 'p1', false);
      setHold(ground, 'p2', false);
      step(ground, STEP);
      expect(ground.p1.x).toBeCloseTo(GROUND - ground.p2.x, 9);
    }
  });

  it('deals only onto the lattice, and never twice onto one cell', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const ground = freshGround(seed);
      const seen = new Set<string>();
      for (const lantern of lanternsOf(ground, 'p2')) {
        const column = (lantern.x - COL_ORIGIN) / COL_SPACING;
        const row = (lantern.y - ROW_ORIGIN) / ROW_SPACING;
        expect(Number.isInteger(column)).toBe(true);
        expect(Number.isInteger(row)).toBe(true);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(ROWS);
        seen.add(`${String(column)}:${String(row)}`);
      }
      expect(seen.size).toBe(LANTERNS);
    }
  });

  it('never lets one burst reach two lanterns', () => {
    // BLAST is under half the lattice spacing, so a rocket takes at most one lantern and the
    // score is arithmetic rather than a chain reaction. Asserted rather than left in a comment,
    // because it is a relation between three constants that a later edit could break silently.
    expect(BLAST * 2).toBeLessThan(Math.min(COL_SPACING, ROW_SPACING));
    const ground = freshGround(7);
    const all = [...lanternsOf(ground, 'p1'), ...lanternsOf(ground, 'p2')];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i] as Lantern;
        const b = all[j] as Lantern;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(BLAST * 2);
      }
    }
  });

  it('puts the bottom of the distance gauge on your own front row and the top on nothing', () => {
    // The danger band, as three numbers rather than as prose. A rocket at the bottom of the
    // gauge comes down inside the blast of your own nearest row; one at the top comes down
    // clear of the enemy's furthest.
    const ownFrontRow = GROUND - ROW_ORIGIN - (ROWS - 1) * ROW_SPACING;
    const enemyFarRow = ROW_ORIGIN;
    expect(Math.abs(landingYOf('p1', MIN_RANGE) - ownFrontRow)).toBeLessThan(BLAST);
    expect(Math.abs(landingYOf('p1', MAX_RANGE) - enemyFarRow)).toBeGreaterThan(BLAST);
    // And the same for the other seat, which is the half-turn again.
    expect(landingYOf('p2', MIN_RANGE)).toBe(GROUND - landingYOf('p1', MIN_RANGE));
    expect(landingYOf('p2', MAX_RANGE)).toBe(GROUND - landingYOf('p1', MAX_RANGE));
  });

  it('draws its lattice from a fixed number of values, whatever it deals', () => {
    // The deal is the first thing the world's generator is asked for and it always costs the
    // same, so what a pair is dealt is a function of the seed and of nothing else.
    for (const seed of [1, 2, 99]) {
      const rng = new Rng(seed);
      const ground = createGround();
      resetGround(ground, rng);
      const after = rng.save();
      const control = new Rng(seed);
      for (let i = 0; i < CELLS - 1; i += 1) control.float();
      expect(control.save()).toEqual(after);
    }
  });
});

describe('the control', () => {
  it('is refused while the ground is still being read', () => {
    const ground = freshGround();
    setHold(ground, 'p1', true);
    step(ground, STEP);
    expect(ground.phase).toBe('opening');
    expect(ground.p1.aiming).toBe(false);
    expect(ground.p1.x).toBe(CARRIAGE_MIN_X);
  });

  it('does not hand a player already holding a free press when the freeze lifts', () => {
    // The edge is tracked through the freeze, so somebody resting a thumb on the glass during
    // the countdown has to lift it before the cart will stop for them.
    const ground = freshGround();
    for (let i = 0; i < Math.ceil(OPENING / STEP) + 4; i += 1) {
      setHold(ground, 'p1', true);
      step(ground, STEP);
    }
    expect(ground.phase).toBe('firing');
    expect(ground.p1.aiming).toBe(false);
    expect(ground.p1.x).toBeGreaterThan(CARRIAGE_MIN_X);
  });

  it('stops the cart on a press and runs the sight out from there', () => {
    const ground = freshGround();
    open(ground);
    setHold(ground, 'p1', true);
    step(ground, STEP);
    const kept = ground.p1.x;
    expect(ground.p1.aiming).toBe(true);
    expect(ground.p1.range).toBeGreaterThan(MIN_RANGE);
    for (let i = 0; i < 20; i += 1) {
      setHold(ground, 'p1', true);
      step(ground, STEP);
    }
    expect(ground.p1.x).toBe(kept);
    expect(ground.p1.range).toBeGreaterThan(MIN_RANGE + SWEEP_RATE * STEP * 15);
  });

  it('fires where the sight was when the control was let go', () => {
    const ground = freshGround();
    open(ground);
    setHold(ground, 'p1', true);
    step(ground, STEP);
    for (let i = 0; i < 25; i += 1) {
      setHold(ground, 'p1', true);
      step(ground, STEP);
    }
    const column = ground.p1.x;
    const range = ground.p1.range;
    setHold(ground, 'p1', false);
    step(ground, STEP);
    const rocket = ground.rockets[0];
    expect(rocket).toBeDefined();
    expect(rocket?.state).toBe(ROCKET_FLYING);
    expect(rocket?.x).toBe(column);
    expect(rocket?.toY).toBe(landingYOf('p1', range));
    expect(ground.p1.rockets).toBe(ROCKETS - 1);
  });

  it('needs a fresh press for every rocket, so a held thumb never aims', () => {
    // A player who never lets go gets the fuse's shot and nothing else. Without this, holding
    // the control through a reload would lock the next column the instant it loaded, which is
    // a free perfect press nobody made.
    const report = scriptedMatch(() => true);
    expect(report.ground.p1.rockets).toBe(0);
    expect(report.ground.p2.rockets).toBe(0);
    expect(report.seconds).toBeCloseTo(OPENING + ROCKETS * (FUSE + RELOAD) + MIN_RANGE / 900, 1);
  });

  it('fires by itself when the fuse runs out, at the bottom of the gauge', () => {
    const ground = freshGround();
    open(ground);
    for (let i = 0; i < Math.ceil(FUSE / STEP) + 2; i += 1) {
      setHold(ground, 'p1', false);
      setHold(ground, 'p2', false);
      step(ground, STEP);
    }
    expect(ground.p1.rockets).toBe(ROCKETS - 1);
    const rocket = ground.rockets[0];
    expect(rocket?.toY).toBe(landingYOf('p1', MIN_RANGE));
  });

  it('reloads before the next rocket is on the fuse', () => {
    const ground = freshGround();
    open(ground);
    setHold(ground, 'p1', true);
    step(ground, STEP);
    setHold(ground, 'p1', false);
    step(ground, STEP);
    expect(ground.p1.loaded).toBe(false);
    expect(ground.p1.reload).toBeGreaterThan(0);
    for (let i = 0; i < Math.ceil(RELOAD / STEP) + 1; i += 1) {
      setHold(ground, 'p1', false);
      step(ground, STEP);
    }
    expect(ground.p1.loaded).toBe(true);
    expect(ground.p1.fuse).toBeGreaterThan(FUSE - STEP * 2);
  });

  it('rolls the cart through the reload, so it cannot be parked', () => {
    const ground = freshGround();
    open(ground);
    setHold(ground, 'p1', true);
    step(ground, STEP);
    const parked = ground.p1.x;
    setHold(ground, 'p1', false);
    step(ground, STEP);
    for (let i = 0; i < Math.ceil(RELOAD / STEP); i += 1) {
      setHold(ground, 'p1', false);
      step(ground, STEP);
    }
    expect(Math.abs(ground.p1.x - parked)).toBeGreaterThan(SWEEP_RATE * RELOAD * 0.5);
  });

  it("gives each seat its own control and none of the other seat's", () => {
    const ground = freshGround();
    open(ground);
    setHold(ground, 'p1', true);
    setHold(ground, 'p2', false);
    step(ground, STEP);
    expect(ground.p1.aiming).toBe(true);
    expect(ground.p2.aiming).toBe(false);
  });
});

describe('a burst', () => {
  it('puts out every standing lantern inside the blast and nothing outside it', () => {
    const ground = freshGround();
    const target = lanternsOf(ground, 'p2')[0] as Lantern;
    open(ground);
    // Drive the cart onto the target's column and the sight onto its distance by hand.
    const wanted = forwardOf('p1', target.y);
    while (Math.abs(ground.p1.x - target.x) > SWEEP_RATE * STEP) {
      setHold(ground, 'p1', false);
      setHold(ground, 'p2', false);
      step(ground, STEP);
    }
    setHold(ground, 'p1', true);
    step(ground, STEP);
    while (ground.p1.range < wanted - SWEEP_RATE * STEP) {
      setHold(ground, 'p1', true);
      step(ground, STEP);
    }
    setHold(ground, 'p1', false);
    step(ground, STEP);
    for (let i = 0; i < 120 && target.standing; i += 1) {
      setHold(ground, 'p1', false);
      setHold(ground, 'p2', false);
      step(ground, STEP);
    }
    expect(target.standing).toBe(false);
    expect(scoreOf(ground, 'p1')).toBe(1);
    expect(ground.p1.clean).toBe(1);
    // Nothing else went with it: the blast cannot reach a second lantern.
    expect(scoreOf(ground, 'p2')).toBe(0);
    for (const lantern of lanternsOf(ground, 'p2')) {
      if (lantern === target) continue;
      expect(lantern.standing).toBe(true);
    }
  });

  it('scores for the other seat when it takes one of your own', () => {
    // The whole of the danger band, in one assertion: a lantern that goes out is a point for
    // whoever does not own it, whatever fired the rocket.
    const ground = freshGround();
    const own = lanternsOf(ground, 'p1');
    const front = own.reduce(
      (best, lantern) => (lantern.y < best.y ? lantern : best),
      own[0] as Lantern,
    );
    open(ground);
    while (Math.abs(ground.p1.x - front.x) > SWEEP_RATE * STEP) {
      setHold(ground, 'p1', false);
      setHold(ground, 'p2', false);
      step(ground, STEP);
    }
    const wanted = forwardOf('p1', front.y);
    setHold(ground, 'p1', true);
    step(ground, STEP);
    while (ground.p1.range < wanted - SWEEP_RATE * STEP) {
      setHold(ground, 'p1', true);
      step(ground, STEP);
    }
    setHold(ground, 'p1', false);
    step(ground, STEP);
    for (let i = 0; i < 120 && front.standing; i += 1) {
      setHold(ground, 'p1', false);
      setHold(ground, 'p2', false);
      step(ground, STEP);
    }
    expect(wanted).toBeGreaterThanOrEqual(MIN_RANGE);
    expect(front.standing).toBe(false);
    expect(scoreOf(ground, 'p2')).toBe(1);
    expect(scoreOf(ground, 'p1')).toBe(0);
    // A rocket dropped on your own lanterns is not a clean burst on theirs.
    expect(ground.p1.clean).toBe(0);
  });

  it('counts as clean only when it comes down on the paper', () => {
    expect(CORE).toBeLessThan(BLAST);
    for (const tier of TIERS) {
      const report = botMatch(31, tier, tier);
      expect(report.p1Clean).toBeLessThanOrEqual(report.ground.p1.rockets + ROCKETS);
      expect(report.p1Clean).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the match', () => {
  it('ends, with two easy bots and no step ceiling at all', () => {
    // The pairing the platform's own termination guard uses, run here without a cap so that a
    // game that could not finish would hang rather than pass quietly.
    for (let seed = 1; seed <= 30; seed += 1) {
      const report = botMatch(seed * 7919, 'easy', 'easy');
      expect(report.winner).not.toBeNull();
      expect(report.seconds).toBeLessThan(60);
    }
  });

  it('ends even when nobody ever touches the device', () => {
    const report = scriptedMatch(() => false);
    expect(report.winner).not.toBeNull();
    // Fourteen fuses and fourteen reloads, plus the opening freeze and the last flight. This
    // is the whole termination argument, as a number.
    expect(report.seconds).toBeCloseTo(OPENING + ROCKETS * (FUSE + RELOAD) + MIN_RANGE / 900, 1);
    expect(report.seconds).toBeLessThan(60);
  });

  it('gives both seats exactly the same number of rockets, whatever happens', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const report = botMatch(seed * 104729, tier, 'easy');
        expect(report.ground.p1.rockets).toBe(0);
        expect(report.ground.p2.rockets).toBe(0);
      }
    }
  });

  it('never runs out of rocket slots', () => {
    for (const tier of TIERS) {
      const source = new Rng(2026);
      const worldRng = new Rng(source.next() | 0);
      const botRng: Record<SeatId, Rng> = {
        p1: new Rng(source.next() | 0),
        p2: new Rng(source.next() | 0),
      };
      const ground = createGround();
      resetGround(ground, worldRng);
      const states = { p1: createBotState(), p2: createBotState() };
      let high = 0;
      while (winnerOf(ground) === null) {
        for (const seat of SEATS) {
          setHold(ground, seat, botHold(ground, seat, tier, states[seat], botRng[seat], STEP));
        }
        step(ground, STEP);
        for (const base of [0, ROCKET_SLOTS_PER_SEAT]) {
          let live = 0;
          for (let i = base; i < base + ROCKET_SLOTS_PER_SEAT; i += 1) {
            if (ground.rockets[i]?.state !== ROCKET_FREE) live += 1;
          }
          high = Math.max(high, live);
        }
      }
      expect(high).toBeLessThan(ROCKET_SLOTS_PER_SEAT);
    }
  });

  it('is not decided while a rocket is still in the air', () => {
    // The real-time form of a completed round. Checked by construction: on every step of every
    // match, a winner and a rocket in flight never coexist.
    const source = new Rng(77);
    const worldRng = new Rng(source.next() | 0);
    const botRng: Record<SeatId, Rng> = {
      p1: new Rng(source.next() | 0),
      p2: new Rng(source.next() | 0),
    };
    const ground = createGround();
    resetGround(ground, worldRng);
    const states = { p1: createBotState(), p2: createBotState() };
    let sawFlight = false;
    while (winnerOf(ground) === null) {
      for (const seat of SEATS) {
        setHold(ground, seat, botHold(ground, seat, 'hard', states[seat], botRng[seat], STEP));
      }
      step(ground, STEP);
      let flying = false;
      for (const rocket of ground.rockets) if (rocket.state === ROCKET_FLYING) flying = true;
      if (flying) sawFlight = true;
      if (winnerOf(ground) !== null) expect(flying).toBe(false);
    }
    expect(sawFlight).toBe(true);
  });

  it('reaches a win, a loss and a draw', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed += 1)
      seen.add(String(botMatch(seed * 7919, 'easy', 'easy').winner));
    expect(seen.has('p1')).toBe(true);
    expect(seen.has('p2')).toBe(true);
    expect(seen.has('draw')).toBe(true);
    expect(seen.has('null')).toBe(false);
  });

  it('breaks a level score on clean bursts, and only then calls it a draw', () => {
    let tiebroken = 0;
    let drawn = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const report = botMatch(seed * 7919, 'normal', 'normal');
      if (report.p1 !== report.p2) {
        expect(report.winner).toBe(report.p1 > report.p2 ? 'p1' : 'p2');
        continue;
      }
      if (report.p1Clean !== report.p2Clean) {
        expect(report.winner).toBe(report.p1Clean > report.p2Clean ? 'p1' : 'p2');
        tiebroken += 1;
        continue;
      }
      expect(report.winner).toBe('draw');
      drawn += 1;
    }
    // A tiebreak that never separates anybody is not a tiebreak: it decides more matches than
    // it leaves drawn.
    expect(tiebroken).toBeGreaterThan(drawn);
  });

  it('reports a score that only ever counts up, and never past the field', () => {
    const source = new Rng(5);
    const worldRng = new Rng(source.next() | 0);
    const botRng: Record<SeatId, Rng> = {
      p1: new Rng(source.next() | 0),
      p2: new Rng(source.next() | 0),
    };
    const ground = createGround();
    resetGround(ground, worldRng);
    const states = { p1: createBotState(), p2: createBotState() };
    let lastP1 = 0;
    let lastP2 = 0;
    while (winnerOf(ground) === null) {
      for (const seat of SEATS) {
        setHold(ground, seat, botHold(ground, seat, 'hard', states[seat], botRng[seat], STEP));
      }
      step(ground, STEP);
      const p1 = scoreOf(ground, 'p1');
      const p2 = scoreOf(ground, 'p2');
      expect(p1).toBeGreaterThanOrEqual(lastP1);
      expect(p2).toBeGreaterThanOrEqual(lastP2);
      expect(p1).toBeLessThanOrEqual(LANTERNS);
      expect(p2).toBeLessThanOrEqual(LANTERNS);
      lastP1 = p1;
      lastP2 = p2;
    }
  });
});

describe('determinism', () => {
  const snapshot = (report: Report): string => JSON.stringify(report.ground);

  it('plays the identical match from the identical seed', () => {
    for (const tier of TIERS) {
      expect(snapshot(botMatch(9091, tier, tier))).toBe(snapshot(botMatch(9091, tier, tier)));
    }
  });

  it('holds the whole state in something that survives a round trip through JSON', () => {
    const report = botMatch(9091, 'normal', 'hard');
    const revived = JSON.parse(JSON.stringify(report.ground)) as Ground;
    expect(revived).toEqual(report.ground);
  });

  it('does not care which seat is polled first', () => {
    // A stream each is what makes this structural rather than incidental: with one shared
    // stream the seat polled first would take the earlier value every time.
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const forward = botMatch(seed * 7919, tier, tier);
        const reversed = botMatch(seed * 7919, tier, tier, { reversed: true });
        expect(snapshot(reversed)).toBe(snapshot(forward));
      }
    }
  });

  it('plays a seat the same way whoever is sitting opposite', () => {
    // Seat two's rockets must be a function of seat two's own stream and of the ground, not of
    // how well its opponent happens to be playing. Compared on the shots it took rather than
    // on the score, since the score depends on the opponent by definition.
    const shots = (tier: BotDifficulty): string => {
      const report = botMatch(555, tier, 'normal');
      return report.ground.rockets
        .slice(ROCKET_SLOTS_PER_SEAT)
        .map((rocket) => `${rocket.x.toFixed(4)}:${rocket.toY.toFixed(4)}`)
        .join('|');
    };
    expect(shots('easy')).toBe(shots('hard'));
  });
});

describe('the bot', () => {
  it('draws exactly the same number of values for every rocket', () => {
    for (const tier of TIERS) {
      const ground = freshGround();
      const state = createBotState();
      const rng = new Rng(1234);
      const before = rng.save();
      planShot(ground, 'p1', tier, state, rng);
      const after = rng.save();
      const control = new Rng(1234);
      control.restore(before);
      for (let i = 0; i < BOT_DRAWS_PER_ROCKET; i += 1) control.float();
      expect(control.save()).toEqual(after);
    }
  });

  it('draws the same count whether or not it fumbles', () => {
    // The fumble costs one roll whether it happens or not, so the number of values a rocket
    // costs cannot depend on what the bot decided.
    const counts = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const ground = freshGround(seed + 1);
      const state = createBotState();
      const rng = new Rng(seed);
      planShot(ground, 'p1', 'easy', state, rng);
      counts.add(JSON.stringify(rng.save()));
      const control = new Rng(seed);
      for (let i = 0; i < BOT_DRAWS_PER_ROCKET; i += 1) control.float();
      expect(JSON.stringify(rng.save())).toBe(JSON.stringify(control.save()));
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it('chooses mirrored shots for the two seats from the same generator', () => {
    // Ranking in the firing seat's own frame is what makes this true. Ranked by board y and
    // board x the two seats would pick lanterns that are not each other's mirror, and would
    // then face different problems from the same ground.
    for (let seed = 1; seed <= 30; seed += 1) {
      const ground = freshGround(seed);
      const p1 = createBotState();
      const p2 = createBotState();
      planShot(ground, 'p1', 'hard', p1, new Rng(77));
      planShot(ground, 'p2', 'hard', p2, new Rng(77));
      expect(p1.wantX).toBeCloseTo(GROUND - p2.wantX, 9);
      expect(p1.wantRange).toBeCloseTo(p2.wantRange, 9);
      expect(p1.columnOffset).toBeCloseTo(p2.columnOffset, 12);
      expect(p1.rangeOffset).toBeCloseTo(p2.rangeOffset, 12);
    }
  });

  it('takes the nearest enemy lantern, in its own frame', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const ground = freshGround(seed);
      for (const seat of SEATS) {
        const state = createBotState();
        planShot(ground, seat, 'hard', state, new Rng(3));
        let best = Infinity;
        for (const lantern of lanternsOf(ground, otherOf(seat))) {
          best = Math.min(best, forwardOf(seat, lantern.y));
        }
        expect(state.wantRange).toBeCloseTo(best, 9);
      }
    }
  });

  it('counts down to a moment rather than watching for a position', () => {
    // A bot that waited for the cart to reach a column would hang: the error is added in
    // whichever direction the cart is rolling, so an error larger than the rail is out of
    // reach both ways. `timeToColumn` is finite for every column and every direction.
    const ground = freshGround();
    for (const right of [true, false]) {
      ground.p1.right = right;
      for (let x = CARRIAGE_MIN_X; x <= CARRIAGE_MAX_X; x += 10) {
        ground.p1.x = x;
        for (let target = CARRIAGE_MIN_X; target <= CARRIAGE_MAX_X; target += 10) {
          const seconds = timeToColumn(ground.p1, target);
          expect(Number.isFinite(seconds)).toBe(true);
          expect(seconds).toBeGreaterThanOrEqual(0);
          expect(seconds).toBeLessThanOrEqual(
            ((CARRIAGE_MAX_X - CARRIAGE_MIN_X) * 2) / SWEEP_RATE + 1e-9,
          );
        }
      }
    }
  });

  it('lands on the lantern it chose when it makes no mistake', () => {
    // The countdown and the simulation have to agree about which step a press lands on. If
    // they were a step apart the bot would be systematically off by SWEEP_RATE / 60 = 11
    // units, which is inside the blast and would never fail a balance test — only this.
    const ground = freshGround(19);
    const state = createBotState();
    const rng = new Rng(1);
    open(ground);
    const perfect: BotDifficulty = 'hard';
    const profile = BOT_PROFILES[perfect];
    expect(profile.timing).toBeGreaterThan(0);
    // Plan by hand and clear the error, so what is left is the timing machinery alone.
    planShot(ground, 'p1', perfect, state, rng);
    state.columnTimer -= state.columnOffset;
    state.columnOffset = 0;
    state.rangeOffset = 0;
    const wantX = state.wantX;
    const wantRange = state.wantRange;
    let fired = false;
    for (let i = 0; i < 60 * 10 && !fired; i += 1) {
      const hold = botHold(ground, 'p1', perfect, state, rng, STEP);
      setHold(ground, 'p1', hold);
      setHold(ground, 'p2', false);
      const before = ground.p1.rockets;
      step(ground, STEP);
      fired = ground.p1.rockets < before;
    }
    expect(fired).toBe(true);
    const rocket = ground.rockets[0];
    expect(Math.abs((rocket?.x ?? 0) - wantX)).toBeLessThanOrEqual(SWEEP_RATE * STEP);
    expect(Math.abs(forwardOf('p1', rocket?.toY ?? 0) - wantRange)).toBeLessThanOrEqual(
      SWEEP_RATE * STEP,
    );
  });

  it('never holds its control while nothing is loaded', () => {
    const ground = freshGround();
    const state = createBotState();
    const rng = new Rng(8);
    for (let i = 0; i < 60 * 40; i += 1) {
      const hold = botHold(ground, 'p1', 'normal', state, rng, STEP);
      if (!ground.p1.loaded) expect(hold).toBe(false);
      setHold(ground, 'p1', hold);
      setHold(ground, 'p2', false);
      step(ground, STEP);
      if (winnerOf(ground) !== null) break;
    }
  });

  it('is ordered by strength, measured in both seat orders', () => {
    // The numbers in SPEC.md come from 2000 seeds a pairing; this is the same measurement at a
    // size a test suite can afford, and it only has to see the order.
    const share = (a: BotDifficulty, b: BotDifficulty, seeds: number): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 1; seed <= seeds; seed += 1) {
        const forward = botMatch(seed * 7919, a, b);
        if (forward.winner === 'p1') wins += 1;
        if (forward.winner !== 'draw') decided += 1;
        const reversed = botMatch(seed * 7919, b, a);
        if (reversed.winner === 'p2') wins += 1;
        if (reversed.winner !== 'draw') decided += 1;
      }
      return wins / decided;
    };
    expect(share('normal', 'easy', 40)).toBeGreaterThan(0.65);
    expect(share('hard', 'normal', 40)).toBeGreaterThan(0.75);
    expect(share('hard', 'easy', 40)).toBeGreaterThan(0.9);
  });

  it('is level with itself, in both seat orders', () => {
    for (const tier of TIERS) {
      let p1 = 0;
      let decided = 0;
      for (let seed = 1; seed <= 120; seed += 1) {
        const report = botMatch(seed * 7919, tier, tier);
        if (report.winner === 'p1') p1 += 1;
        if (report.winner !== 'draw') decided += 1;
      }
      const share = p1 / decided;
      expect(share, `${tier} seat-one share`).toBeGreaterThan(0.38);
      expect(share, `${tier} seat-one share`).toBeLessThan(0.62);
    }
  });

  it('separates the tiers by how much of the field they take', () => {
    const taken = (tier: BotDifficulty): number => {
      let total = 0;
      for (let seed = 1; seed <= 40; seed += 1) total += botMatch(seed * 7919, tier, tier).p1;
      return total / 40;
    };
    const easy = taken('easy');
    const normal = taken('normal');
    const hard = taken('hard');
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(normal);
  });

  it('reads nothing a player cannot see', () => {
    // Rule 6, as a property of the profile rather than as a comment: a tier is two numbers,
    // both of them seconds of human error, and neither of them is a speed, a reach or a fact
    // about the ground.
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(Object.keys(profile).sort()).toEqual(['blunder', 'timing']);
      // Several frames wide at every tier: no tier can stop a cart more finely than a person.
      expect(profile.timing).toBeGreaterThan(STEP * 4);
      expect(profile.blunder).toBeGreaterThanOrEqual(0);
      expect(profile.blunder).toBeLessThan(1);
    }
    expect(BOT_PROFILES.easy.timing).toBeGreaterThan(BOT_PROFILES.normal.timing);
    expect(BOT_PROFILES.normal.timing).toBeGreaterThan(BOT_PROFILES.hard.timing);
  });
});

describe('a fresh match', () => {
  it('puts everything back, including the lanterns and both stocks', () => {
    const ground = freshGround();
    const rng = new Rng(4242);
    const state = createBotState();
    for (let i = 0; i < 60 * 10; i += 1) {
      setHold(ground, 'p1', botHold(ground, 'p1', 'hard', state, rng, STEP));
      step(ground, STEP);
    }
    expect(ground.p1.rockets).toBeLessThan(ROCKETS);

    resetGround(ground, new Rng(4242));
    resetBotState(state);
    expect(ground.phase).toBe('opening');
    expect(ground.hold).toBe(OPENING);
    expect(ground.winner).toBeNull();
    expect(ground.p1.rockets).toBe(ROCKETS);
    expect(ground.p2.rockets).toBe(ROCKETS);
    expect(scoreOf(ground, 'p1')).toBe(0);
    expect(scoreOf(ground, 'p2')).toBe(0);
    expect(launcherOf(ground, 'p1').clean).toBe(0);
    for (const seat of SEATS) {
      for (const lantern of lanternsOf(ground, seat)) {
        expect(lantern.standing).toBe(true);
        expect(lantern.doomed).toBe(false);
      }
    }
    for (const rocket of ground.rockets) expect(rocket.state).toBe(ROCKET_FREE);
    expect(state.stage).toBe('plan');
  });

  it('deals the same ground from the same seed and a different one otherwise', () => {
    const a = JSON.stringify(freshGround(11).p2Lanterns);
    const b = JSON.stringify(freshGround(11).p2Lanterns);
    const c = JSON.stringify(freshGround(12).p2Lanterns);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('the numbers the whole game rests on', () => {
  it('keeps the blast worth a human amount of press error', () => {
    // BLAST / SWEEP_RATE is where the difficulty ladder lives, and it has to be in the range a
    // person's timing error actually occupies. Below about 0.04 s every tier is "nearly
    // perfect"; above about 0.12 s every tier hits everything.
    const seconds = BLAST / SWEEP_RATE;
    expect(seconds).toBeGreaterThan(0.04);
    expect(seconds).toBeLessThan(0.12);
  });

  it('keeps both gauges readable at the same rate', () => {
    const rail = (CARRIAGE_MAX_X - CARRIAGE_MIN_X) / SWEEP_RATE;
    const gauge = (MAX_RANGE - MIN_RANGE) / SWEEP_RATE;
    expect(rail).toBeGreaterThan(0.5);
    expect(rail).toBeLessThan(1.5);
    expect(gauge).toBeGreaterThan(0.4);
    expect(gauge).toBeLessThan(1.2);
    // The fuse has to outlast one full rail round trip and one gauge crossing, or a player who
    // wants a particular column can never also choose a distance.
    expect(FUSE).toBeGreaterThan(rail * 2 + gauge);
  });

  it('reaches every column a lantern can be dealt on', () => {
    expect(CARRIAGE_MIN_X).toBeLessThanOrEqual(COL_ORIGIN);
    expect(CARRIAGE_MAX_X).toBeGreaterThanOrEqual(COL_ORIGIN + (7 - 1) * COL_SPACING);
    expect(CENTRE).toBe(GROUND / 2);
  });
});
