import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BAND_FAR,
  BAND_NEAR,
  BLAST,
  BOARD,
  BOT_DRAWS_PER_SHOT,
  BOT_PROFILES,
  BURST_SECONDS,
  CENTRE,
  CHARGE_ACCEL,
  CHARGE_SECONDS,
  CHARGE_SPEED,
  DEPTH,
  LANES,
  LANE_ORIGIN,
  LANE_SPACING,
  MARCH_SPEED,
  OPENING,
  RAIL,
  RANGE_MAX,
  RANGE_MIN,
  RELOAD,
  SHOT_BURST,
  SHOT_FLYING,
  SHOT_FREE,
  SHOT_SLOTS,
  SHOT_SPEED,
  SOLDIERS,
  SPAWN_INTERVAL,
  TRAVERSE_RATE,
  WALL_INSET,
  boardX,
  boardY,
  botHold,
  createBotState,
  createSiege,
  doomed,
  holdForRange,
  holdToSmash,
  laneU,
  otherOf,
  planShot,
  rangeAfter,
  resetSiege,
  scoreOf,
  setHold,
  sideOf,
  step,
  timeToLane,
  valueOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Shot, Side, Siege, Soldier, Turret } from './rules.js';

const STEP = 1 / 60;
const SEATS: readonly SeatId[] = ['p1', 'p2'];
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];
const RATES: readonly number[] = [60, 90, 120, 240];

/** How much of the distance to a soldier survives its walk during the shot's flight. */
const K = SHOT_SPEED / (SHOT_SPEED + MARCH_SPEED);

interface Report {
  readonly winner: SeatId | 'draw' | null;
  readonly p1: number;
  readonly p2: number;
  readonly seconds: number;
  readonly steps: number;
  readonly siege: Siege;
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
  options?: {
    readonly reversed?: boolean;
    readonly opener?: SeatId;
    readonly swapStreams?: boolean;
    readonly dt?: number;
  },
): Report {
  const source = new Rng(seed);
  const worldRng = new Rng(source.next() | 0);
  const first = new Rng(source.next() | 0);
  const second = new Rng(source.next() | 0);
  const botRng: Record<SeatId, Rng> =
    options?.swapStreams === true ? { p1: second, p2: first } : { p1: first, p2: second };
  const siege = createSiege();
  resetSiege(siege, worldRng, options?.opener ?? 'p1');
  const states = { p1: createBotState(), p2: createBotState() };
  const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
  const order: readonly SeatId[] = options?.reversed === true ? ['p2', 'p1'] : SEATS;
  const dt = options?.dt ?? STEP;

  let steps = 0;
  while (winnerOf(siege) === null) {
    for (const seat of order) {
      setHold(siege, seat, botHold(siege, seat, tiers[seat], states[seat], botRng[seat], dt));
    }
    step(siege, dt);
    steps += 1;
  }
  return {
    winner: winnerOf(siege),
    p1: scoreOf(siege, 'p1'),
    p2: scoreOf(siege, 'p2'),
    seconds: steps * dt,
    steps,
    siege,
  };
}

/** Play with both seats' controls driven by a fixed script rather than by a bot. */
function scriptedMatch(hold: (seat: SeatId, step: number) => boolean, dt = STEP): Report {
  const siege = createSiege();
  resetSiege(siege, new Rng(4242));
  let steps = 0;
  while (winnerOf(siege) === null) {
    for (const seat of SEATS) setHold(siege, seat, hold(seat, steps));
    step(siege, dt);
    steps += 1;
  }
  return {
    winner: winnerOf(siege),
    p1: scoreOf(siege, 'p1'),
    p2: scoreOf(siege, 'p2'),
    seconds: steps * dt,
    steps,
    siege,
  };
}

function freshSiege(seed = 4242, opener: SeatId = 'p1'): Siege {
  const siege = createSiege();
  resetSiege(siege, new Rng(seed), opener);
  return siege;
}

/** Run past the opening freeze so the guns are traversing and a press means something. */
function openUp(siege: Siege, dt = STEP): void {
  const steps = Math.ceil(OPENING / dt) + 1;
  for (let i = 0; i < steps; i += 1) step(siege, dt);
}

function liveOf(side: Readonly<Side>): readonly Soldier[] {
  return side.soldiers.filter((soldier) => soldier.alive);
}

function inUse(side: Readonly<Side>): number {
  return side.shots.filter((shot) => shot.state !== SHOT_FREE).length;
}

/**
 * A bench with one soldier on it and nothing else, for measuring a single shot exactly.
 *
 * The whole wave is marked released so nothing new arrives, and every other soldier is dead —
 * but one is left alive so the match cannot be judged over while the shot is measured.
 */
function bench(distance: number, lane: number): Siege {
  const siege = freshSiege(1);
  siege.phase = 'firing';
  siege.hold = 0;
  siege.released = SOLDIERS;
  for (const seat of SEATS) {
    const side = sideOf(siege, seat);
    for (const soldier of side.soldiers) {
      soldier.alive = false;
      soldier.d = 0;
      soldier.lane = 0;
    }
    const turret = side.turret;
    turret.u = laneU(lane);
    turret.rising = true;
    turret.loaded = true;
    turret.aiming = false;
    turret.range = RANGE_MIN;
    turret.charge = CHARGE_SPEED;
    turret.reload = 0;
    turret.held = false;
    turret.want = false;
  }
  const target = sideOf(siege, 'p1').soldiers[0] as Soldier;
  target.alive = true;
  target.lane = lane;
  target.d = distance;
  return siege;
}

/**
 * Press, hold for `steps` steps, let go, and report where the burst was judged.
 *
 * `exact` is the soldier's distance at the instant the shot came down, recomposed from the
 * public state the way {@link step} does it: the position at the end of the landing step, plus
 * the walk it should not have taken because the shot arrived part-way through that step.
 */
function fireAfter(
  distance: number,
  lane: number,
  steps: number,
  dt: number,
): { readonly range: number; readonly exact: number; readonly smashed: number } {
  const siege = bench(distance, lane);
  const side = sideOf(siege, 'p1');
  const shot = side.shots[0] as Shot;
  const target = side.soldiers[0] as Soldier;
  let landing: { range: number; exact: number } | null = null;
  for (let i = 0; i < 5000 && landing === null; i += 1) {
    setHold(siege, 'p1', i <= steps);
    const flying = shot.state === SHOT_FLYING;
    step(siege, dt);
    if (flying && shot.state === SHOT_BURST) {
      landing = {
        range: shot.range,
        exact: target.d + MARCH_SPEED * (shot.flight - shot.flightTime),
      };
    }
  }
  expect(landing, 'the shot never came down').not.toBeNull();
  return { range: landing!.range, exact: landing!.exact, smashed: side.smashed };
}

// ---------------------------------------------------------------------------------------
// Mirroring. A seat's whole world is `(lane, d)` and `(u, range)` in its own frame, so the
// half-turn of a position is the *same numbers on the other side*. Mirroring a Siege is
// therefore an exact swap with no arithmetic in it at all, which is the property being
// tested: anything that read a board coordinate would need arithmetic here and would not
// survive the swap in the last bits.
// ---------------------------------------------------------------------------------------

function copySoldier(from: Readonly<Soldier>, to: Soldier): void {
  to.alive = from.alive;
  to.lane = from.lane;
  to.d = from.d;
}

function copyTurret(from: Readonly<Turret>, to: Turret): void {
  to.u = from.u;
  to.rising = from.rising;
  to.loaded = from.loaded;
  to.aiming = from.aiming;
  to.range = from.range;
  to.charge = from.charge;
  to.reload = from.reload;
  to.held = from.held;
  to.want = from.want;
}

function copyShot(from: Readonly<Shot>, to: Shot): void {
  to.state = from.state;
  to.u = from.u;
  to.range = from.range;
  to.flight = from.flight;
  to.flightTime = from.flightTime;
  to.burst = from.burst;
  to.hit = from.hit;
}

function copySide(from: Readonly<Side>, to: Side): void {
  for (let i = 0; i < from.soldiers.length; i += 1) {
    copySoldier(from.soldiers[i] as Soldier, to.soldiers[i] as Soldier);
  }
  for (let i = 0; i < from.shots.length; i += 1) {
    copyShot(from.shots[i] as Shot, to.shots[i] as Shot);
  }
  copyTurret(from.turret, to.turret);
  to.ground = from.ground;
  to.smashed = from.smashed;
  to.through = from.through;
}

/** `to` becomes the half-turn image of `from`: seat one's world handed to seat two. */
function mirrorInto(from: Readonly<Siege>, to: Siege): void {
  copySide(from.p1, to.p2);
  copySide(from.p2, to.p1);
  for (let i = 0; i < from.wave.length; i += 1) to.wave[i] = from.wave[i] as number;
  to.released = from.released;
  to.phase = from.phase;
  to.hold = from.hold;
  to.elapsed = from.elapsed;
  to.winner = from.winner === 'p1' ? 'p2' : from.winner === 'p2' ? 'p1' : from.winner;
}

function describeSiege(siege: Readonly<Siege>): string {
  return JSON.stringify(siege);
}

/** Put a siege into an arbitrary but legal-looking position, for the mirror sweep. */
function scramble(siege: Siege, rng: Rng): void {
  siege.phase = 'firing';
  siege.hold = 0;
  siege.elapsed = rng.float() * 26;
  siege.released = Math.floor(rng.float() * (SOLDIERS + 1));
  siege.winner = null;
  for (const seat of SEATS) {
    const side = sideOf(siege, seat);
    for (let i = 0; i < side.soldiers.length; i += 1) {
      const soldier = side.soldiers[i] as Soldier;
      soldier.alive = i < siege.released && rng.float() < 0.7;
      soldier.lane = Math.floor(rng.float() * LANES);
      soldier.d = rng.float() * DEPTH;
    }
    const turret = side.turret;
    turret.u = rng.float() * RAIL;
    turret.rising = rng.float() < 0.5;
    turret.loaded = rng.float() < 0.7;
    turret.aiming = turret.loaded && rng.float() < 0.5;
    turret.range = RANGE_MIN + rng.float() * (RANGE_MAX - RANGE_MIN);
    turret.charge = CHARGE_SPEED + rng.float() * CHARGE_ACCEL;
    turret.reload = turret.loaded ? 0 : rng.float() * RELOAD;
    turret.held = rng.float() < 0.5;
    turret.want = turret.held;
    for (let i = 0; i < side.shots.length; i += 1) {
      const shot = side.shots[i] as Shot;
      const roll = rng.float();
      shot.state = roll < 0.6 ? SHOT_FREE : roll < 0.85 ? SHOT_FLYING : SHOT_BURST;
      shot.u = rng.float() * RAIL;
      shot.range = RANGE_MIN + rng.float() * (RANGE_MAX - RANGE_MIN);
      shot.flightTime = shot.range / SHOT_SPEED;
      shot.flight = rng.float() * shot.flightTime;
      shot.burst = rng.float() * BURST_SECONDS;
      shot.hit = false;
    }
    side.ground = Math.floor(rng.float() * 30);
    side.smashed = Math.floor(rng.float() * SOLDIERS);
    side.through = Math.floor(rng.float() * SOLDIERS);
  }
}

// =======================================================================================

describe('the board', () => {
  it('is square, and the two fields meet on the centre line without overlapping', () => {
    expect(WALL_INSET + DEPTH).toBe(CENTRE);
    expect(boardY('p1', 0)).toBe(BOARD - WALL_INSET);
    expect(boardY('p2', 0)).toBe(WALL_INSET);
    expect(boardY('p1', DEPTH)).toBe(CENTRE);
    expect(boardY('p2', DEPTH)).toBe(CENTRE);
  });

  it('maps one seat onto the other by an exact half-turn, in integers', () => {
    // Rule 9 in the only form that can be checked: neither seat sees more of the play area
    // than the other because the two halves are the *same* half turned over. Exactness matters
    // — `toBe`, not `toBeCloseTo` — because a rounding here is a knife edge the two seats can
    // land on opposite sides of, which is precisely how Snowball Throw lost its seat balance.
    for (let u = 0; u <= RAIL; u += 1) {
      expect(boardX('p2', u)).toBe(BOARD - boardX('p1', u));
    }
    for (let d = 0; d <= DEPTH; d += 1) {
      expect(boardY('p2', d)).toBe(BOARD - boardY('p1', d));
    }
  });

  it('puts both seats’ roads on the same columns of the board', () => {
    const p1 = new Set<number>();
    const p2 = new Set<number>();
    for (let lane = 0; lane < LANES; lane += 1) {
      p1.add(boardX('p1', laneU(lane)));
      p2.add(boardX('p2', laneU(lane)));
    }
    expect([...p1].sort((a, b) => a - b)).toEqual([...p2].sort((a, b) => a - b));
  });

  it('keeps every road on the rail, symmetric about its middle', () => {
    expect(laneU(0)).toBe(LANE_ORIGIN);
    expect(laneU(LANES - 1)).toBe(RAIL - LANE_ORIGIN);
    for (let lane = 0; lane < LANES; lane += 1) {
      expect(laneU(lane) + laneU(LANES - 1 - lane)).toBe(RAIL);
    }
  });
});

describe('the numbers the whole game rests on', () => {
  it('tops the charge out at the far edge of the field in exactly one second', () => {
    expect(RANGE_MAX).toBe(DEPTH);
    expect(rangeAfter(CHARGE_SECONDS)).toBeCloseTo(RANGE_MAX, 12);
    expect(rangeAfter(0)).toBe(RANGE_MIN);
  });

  it('makes the error a circle at maximum range, and only there', () => {
    // A press late by t misses the road by TRAVERSE_RATE·t; a release late by t misses the
    // distance by the charge's rate. The two are equal at the top of the charge and nowhere
    // else, so the deepest shot is the one where both halves cost the same.
    expect(CHARGE_SPEED + CHARGE_ACCEL * CHARGE_SECONDS).toBe(TRAVERSE_RATE);
    expect(CHARGE_SPEED).toBeLessThan(TRAVERSE_RATE);
  });

  it('makes holdForRange the exact inverse of rangeAfter', () => {
    for (let t = 0; t <= CHARGE_SECONDS; t += 1 / 512) {
      expect(holdForRange(rangeAfter(t))).toBeCloseTo(t, 12);
    }
  });

  it('lays the wave on a lattice in both directions, so one shot takes one soldier', () => {
    expect(MARCH_SPEED * SPAWN_INTERVAL).toBe(LANE_SPACING);
    // Two soldiers a road apart are LANE_SPACING apart; two on one road are MARCH_SPEED ·
    // SPAWN_INTERVAL apart. Both must exceed twice the blast or a shot could take two.
    expect(2 * BLAST).toBeLessThan(LANE_SPACING);
    expect(2 * BLAST).toBeLessThan(MARCH_SPEED * SPAWN_INTERVAL);
  });

  it('keeps both band edges off the step lattice at every rate the shell uses', () => {
    // A soldier's distance after n marches is DEPTH − MARCH_SPEED · n · dt, so it lands on a
    // band edge exactly when R · (DEPTH − BAND) / MARCH_SPEED is a whole number.
    for (const band of [BAND_NEAR, BAND_FAR]) {
      for (const rate of RATES) {
        const n = (rate * (DEPTH - band)) / MARCH_SPEED;
        expect(Number.isInteger(n), `${String(band)} is on the lattice at ${String(rate)} Hz`).toBe(
          false,
        );
      }
    }
  });

  it('scores three deep, two in the middle and one close in', () => {
    expect(valueOf(DEPTH)).toBe(3);
    expect(valueOf(BAND_FAR)).toBe(3);
    expect(valueOf(BAND_FAR - 1)).toBe(2);
    expect(valueOf(BAND_NEAR)).toBe(2);
    expect(valueOf(BAND_NEAR - 1)).toBe(1);
    expect(valueOf(1)).toBe(1);
  });

  it('leaves every soldier on the field reachable, and nothing beyond it', () => {
    // A freshly released soldier can be taken with a hold inside the charge, and a soldier at
    // the minimum range cannot be taken at all — which is the rule the catalogue row names.
    expect(holdToSmash(DEPTH, STEP)).toBeGreaterThan(0);
    expect(holdToSmash(DEPTH, STEP)).toBeLessThan(CHARGE_SECONDS);
    expect(holdToSmash(RANGE_MIN, STEP) >= 0).toBe(false);
    expect(holdToSmash(1, STEP) >= 0).toBe(false);
  });
});

describe('the charge, at four step sizes', () => {
  it('integrates to its own closed form, bit for bit', () => {
    // Issue #2465, and the reason `stepTurret` writes `range += v·dt + ½a·dt²` *before*
    // `v += a·dt`. Written the other way round a step lands a whole `a·dt²` rather than half of
    // one, the shortfall accumulates across the hold, and the closed form the bot plans with
    // stops describing the game the simulation is playing — a bias that moves with the frame
    // rate, so rule 8 broken as well as rule 6.
    for (const rate of RATES) {
      const dt = 1 / rate;
      for (const seconds of [0.1, 0.25, 0.5, 0.75, 1]) {
        const n = Math.round(seconds * rate);
        const siege = bench(300, 2);
        const turret = sideOf(siege, 'p1').turret;
        for (let i = 0; i <= n; i += 1) {
          setHold(siege, 'p1', true);
          step(siege, dt);
        }
        expect(turret.range, `${String(seconds)} s of charge at ${String(rate)} Hz`).toBeCloseTo(
          rangeAfter(n * dt),
          11,
        );
      }
    }
  });

  it('lands a planned shot on the soldier it was planned for, at every rate', () => {
    // The end-to-end form of the same claim, and the strongest one available: `holdToSmash` is
    // solved analytically while the charge, the march and the flight are all integrated
    // numerically, and the two have to agree or every tier is aiming at a board the game is not
    // playing. Worst miss measured across these cases is 2.6e-12 units against a 40-unit blast.
    let worst = 0;
    for (const rate of RATES) {
      const dt = 1 / rate;
      for (const seconds of [0.1, 0.3, 0.5, 0.7]) {
        const n = Math.round(seconds * rate);
        const hold = n * dt;
        const range = rangeAfter(hold);
        const distance = range / K + MARCH_SPEED * hold + MARCH_SPEED * dt;
        expect(distance).toBeLessThanOrEqual(DEPTH);

        // The bot's closed form, read forwards: this distance wants exactly this hold.
        expect(holdToSmash(distance, dt), `holdToSmash at ${String(rate)} Hz`).toBeCloseTo(
          hold,
          12,
        );

        const landed = fireAfter(distance, 2, n, dt);
        const miss = Math.abs(landed.range - landed.exact);
        worst = Math.max(worst, miss);
        expect(miss, `miss at ${String(rate)} Hz after ${String(seconds)} s`).toBeLessThan(1e-9);
        expect(landed.smashed, `smashed at ${String(rate)} Hz`).toBe(1);
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('never judges a soldier sitting exactly on a band edge', () => {
    // The family of bug named in the second lessons list: a threshold a state variable lands on
    // by construction rather than by coincidence. Walked rather than argued.
    for (const rate of RATES) {
      const dt = 1 / rate;
      const siege = freshSiege(77);
      let seen = 0;
      for (let i = 0; i < rate * 40 && winnerOf(siege) === null; i += 1) {
        step(siege, dt);
        for (const seat of SEATS) {
          for (const soldier of sideOf(siege, seat).soldiers) {
            if (!soldier.alive) continue;
            seen += 1;
            expect(soldier.d).not.toBe(BAND_NEAR);
            expect(soldier.d).not.toBe(BAND_FAR);
          }
        }
      }
      expect(seen, `nothing walked at ${String(rate)} Hz`).toBeGreaterThan(1000);
    }
  });
});

describe('the control', () => {
  it('is refused while the field is still being read', () => {
    const siege = freshSiege();
    setHold(siege, 'p1', true);
    step(siege, STEP);
    expect(siege.p1.turret.aiming).toBe(false);
    expect(siege.phase).toBe('opening');
  });

  it('does not hand a player already holding a free press when the freeze lifts', () => {
    const siege = freshSiege();
    for (let i = 0; i < Math.ceil(OPENING / STEP) + 4; i += 1) {
      setHold(siege, 'p1', true);
      step(siege, STEP);
    }
    expect(siege.phase).toBe('firing');
    expect(siege.p1.turret.aiming).toBe(false);
    // And the gun has been traversing all the while, so a held thumb has not parked it.
    expect(siege.p1.turret.u).toBeGreaterThan(0);
  });

  it('stops the gun on a press and runs the charge out from there', () => {
    const siege = freshSiege();
    openUp(siege);
    setHold(siege, 'p1', true);
    step(siege, STEP);
    const kept = siege.p1.turret.u;
    expect(siege.p1.turret.aiming).toBe(true);
    expect(siege.p1.turret.range).toBe(RANGE_MIN);

    for (let i = 0; i < 20; i += 1) {
      setHold(siege, 'p1', true);
      step(siege, STEP);
    }
    expect(siege.p1.turret.u).toBe(kept);
    expect(siege.p1.turret.range).toBeCloseTo(rangeAfter(20 * STEP), 11);
  });

  it('fires where the charge was when the control was let go', () => {
    const siege = freshSiege();
    openUp(siege);
    setHold(siege, 'p1', true);
    step(siege, STEP);
    const kept = siege.p1.turret.u;
    for (let i = 0; i < 12; i += 1) {
      setHold(siege, 'p1', true);
      step(siege, STEP);
    }
    const wanted = siege.p1.turret.range;
    setHold(siege, 'p1', false);
    step(siege, STEP);
    const shot = siege.p1.shots[0] as Shot;
    expect(shot.state).toBe(SHOT_FLYING);
    expect(shot.u).toBe(kept);
    expect(shot.range).toBe(wanted);
    expect(siege.p1.turret.loaded).toBe(false);
  });

  it('fires at the bottom of the charge when the tap is over inside two steps', () => {
    const siege = freshSiege();
    openUp(siege);
    setHold(siege, 'p1', true);
    step(siege, STEP);
    setHold(siege, 'p1', false);
    step(siege, STEP);
    expect((siege.p1.shots[0] as Shot).range).toBe(RANGE_MIN);
  });

  it('lets go by itself at the top of the charge, so holding is not a way to wait', () => {
    const siege = freshSiege();
    openUp(siege);
    let fired = -1;
    for (let i = 0; i < 200 && fired < 0; i += 1) {
      setHold(siege, 'p1', true);
      step(siege, STEP);
      if (!siege.p1.turret.loaded) fired = i;
    }
    expect(fired).toBeGreaterThan(0);
    expect((siege.p1.shots[0] as Shot).range).toBe(RANGE_MAX);
    expect(fired * STEP).toBeLessThan(CHARGE_SECONDS + 2 * STEP);
  });

  it('needs a fresh press for every shot, so a held thumb never aims twice', () => {
    const siege = freshSiege();
    openUp(siege);
    let fired = 0;
    let loaded = true;
    for (let i = 0; i < 60 * 12; i += 1) {
      setHold(siege, 'p1', true);
      step(siege, STEP);
      if (loaded && !siege.p1.turret.loaded) fired += 1;
      loaded = siege.p1.turret.loaded;
    }
    // Twelve seconds of an unbroken hold: every shot is the charge topping out by itself, at
    // one per CHARGE_SECONDS + RELOAD, and never a chosen distance.
    expect(fired).toBeLessThanOrEqual(Math.ceil(12 / (CHARGE_SECONDS + RELOAD)));
    for (const shot of siege.p1.shots) {
      if (shot.state !== SHOT_FREE) expect(shot.range).toBe(RANGE_MAX);
    }
  });

  it('traverses the gun through the reload, so it cannot be parked on a road', () => {
    const siege = freshSiege();
    openUp(siege);
    setHold(siege, 'p1', true);
    step(siege, STEP);
    setHold(siege, 'p1', false);
    step(siege, STEP);
    const parked = siege.p1.turret.u;
    expect(siege.p1.turret.loaded).toBe(false);
    for (let i = 0; i < 10; i += 1) {
      setHold(siege, 'p1', false);
      step(siege, STEP);
    }
    expect(siege.p1.turret.u).not.toBe(parked);
  });

  it('gives each seat its own control and none of the other seat’s', () => {
    const siege = freshSiege();
    openUp(siege);
    setHold(siege, 'p2', true);
    step(siege, STEP);
    expect(siege.p1.turret.aiming).toBe(false);
    expect(siege.p2.turret.aiming).toBe(true);
  });
});

describe('a burst', () => {
  it('smashes a soldier inside the blast and leaves one outside it', () => {
    for (const [offset, taken] of [
      [0, true],
      [BLAST - 1, true],
      [BLAST + 1, false],
      [-(BLAST - 1), true],
      [-(BLAST + 1), false],
    ] as const) {
      const rate = 60;
      const dt = 1 / rate;
      const n = Math.round(0.4 * rate);
      const hold = n * dt;
      const range = rangeAfter(hold);
      const wanted = range / K + MARCH_SPEED * hold + MARCH_SPEED * dt;
      // Offsetting the soldier's start moves where it is when the shot arrives by the same
      // amount, because everything between the two is linear in the start distance.
      const landed = fireAfter(wanted + offset, 2, n, dt);
      expect(landed.smashed === 1, `offset ${String(offset)}`).toBe(taken);
      expect(Math.abs(landed.exact - (range + offset))).toBeLessThan(1e-9);
    }
  });

  it('never reaches two soldiers, over whole matches', () => {
    // Asserted rather than left to the lattice arithmetic, because "one soldier a shot" is what
    // makes the score exact rather than a chain reaction.
    let closest = Infinity;
    for (let seed = 0; seed < 40; seed += 1) {
      const report = botMatch(seed * 31 + 5, 'hard', 'hard', { opener: seed % 2 ? 'p2' : 'p1' });
      void report;
    }
    for (let seed = 0; seed < 40; seed += 1) {
      const siege = freshSiege(seed * 31 + 5, seed % 2 ? 'p2' : 'p1');
      const states = { p1: createBotState(), p2: createBotState() };
      const rngs: Record<SeatId, Rng> = { p1: new Rng(seed * 7 + 1), p2: new Rng(seed * 7 + 2) };
      while (winnerOf(siege) === null) {
        for (const seat of SEATS) {
          setHold(siege, seat, botHold(siege, seat, 'hard', states[seat], rngs[seat], STEP));
        }
        step(siege, STEP);
        for (const seat of SEATS) {
          const live = liveOf(sideOf(siege, seat));
          for (let i = 0; i < live.length; i += 1) {
            for (let j = i + 1; j < live.length; j += 1) {
              const a = live[i] as Soldier;
              const b = live[j] as Soldier;
              closest = Math.min(closest, Math.hypot(laneU(a.lane) - laneU(b.lane), a.d - b.d));
            }
          }
        }
      }
    }
    expect(closest).toBeGreaterThan(2 * BLAST);
  });

  it('never runs a seat out of shot slots', () => {
    // Two of a seat's own can overlap and a third cannot: the earliest a third could leave the
    // gun is RELOAD · 2 + a tap after the first, and the first is gone by then. Fuzzed rather
    // than argued — every hold pattern a thumb could produce, at fifty flip rates.
    let worst = 0;
    for (let seed = 0; seed < 120; seed += 1) {
      const rng = new Rng(seed);
      const siege = freshSiege(9);
      const flip = 0.02 + (seed % 50) * 0.02;
      const want: Record<SeatId, boolean> = { p1: false, p2: false };
      while (winnerOf(siege) === null) {
        for (const seat of SEATS) {
          if (rng.float() < flip) want[seat] = !want[seat];
          setHold(siege, seat, want[seat]);
        }
        step(siege, STEP);
        for (const seat of SEATS) worst = Math.max(worst, inUse(sideOf(siege, seat)));
      }
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(SHOT_SLOTS);
  });
});

describe('the match', () => {
  it('ends, with two easy bots and no step ceiling at all', () => {
    const report = botMatch(20260829, 'easy', 'easy');
    expect(report.winner).not.toBeNull();
    expect(report.seconds).toBeLessThan(34);
  });

  it('ends in the same time whether or not anybody plays', () => {
    // The army is the clock. Nothing a player does can add a soldier, delay one, or hold one on
    // the field, so the longest match is arithmetic rather than a bound, and it is the same
    // arithmetic for a match nobody touches and a match played perfectly.
    const bound = OPENING + (SOLDIERS - 1) * SPAWN_INTERVAL + DEPTH / MARCH_SPEED;
    expect(bound).toBeCloseTo(33.8, 9);
    const idle = scriptedMatch(() => false);
    const held = scriptedMatch(() => true);
    expect(idle.seconds).toBeCloseTo(bound, 1);
    expect(held.seconds).toBeCloseTo(bound, 1);
    expect(idle.steps).toBe(held.steps);
    // And nobody scores a point without touching the device, so the untouched match is a draw.
    expect(idle.p1).toBe(0);
    expect(idle.p2).toBe(0);
    expect(idle.winner).toBe('draw');
  });

  it('ends inside the same bound at every step size', () => {
    for (const rate of RATES) {
      const idle = scriptedMatch(() => false, 1 / rate);
      expect(idle.seconds, `${String(rate)} Hz`).toBeGreaterThan(33.7);
      expect(idle.seconds, `${String(rate)} Hz`).toBeLessThan(33.9);
    }
  });

  it('spends the whole army, however it is played', () => {
    for (const report of [
      scriptedMatch(() => false),
      scriptedMatch(() => true),
      scriptedMatch((_seat, i) => i % 7 < 3),
      botMatch(11, 'hard', 'easy'),
    ]) {
      for (const seat of SEATS) {
        const side = sideOf(report.siege, seat);
        expect(side.smashed + side.through).toBe(SOLDIERS);
        expect(liveOf(side)).toHaveLength(0);
      }
      expect(report.siege.released).toBe(SOLDIERS);
    }
  });

  it('is not decided while a soldier is still walking', () => {
    // The real-time form of Cup Pong's completed round: a seat is owed every soldier still on
    // its own field, so the match cannot end on the step the *other* field happens to empty.
    const siege = freshSiege(31337);
    const states = { p1: createBotState(), p2: createBotState() };
    const rngs: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
    for (let i = 0; i < 60 * 60; i += 1) {
      for (const seat of SEATS) {
        setHold(siege, seat, botHold(siege, seat, 'hard', states[seat], rngs[seat], STEP));
      }
      step(siege, STEP);
      if (winnerOf(siege) === null) continue;
      expect(liveOf(siege.p1)).toHaveLength(0);
      expect(liveOf(siege.p2)).toHaveLength(0);
      break;
    }
    expect(winnerOf(siege)).not.toBeNull();
  });

  it('reaches a win, a loss and a draw', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 120; seed += 1) {
      seen.add(String(botMatch(seed * 7919 + 11, 'normal', 'normal').winner));
    }
    expect([...seen].sort()).toEqual(['draw', 'p1', 'p2']);
  });

  it('breaks a level score on soldiers through the gate, and only then calls it a draw', () => {
    let level = 0;
    let split = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const report = botMatch(seed * 7919 + 11, 'normal', 'normal');
      if (report.p1 !== report.p2) {
        expect(report.winner).toBe(report.p1 > report.p2 ? 'p1' : 'p2');
        continue;
      }
      level += 1;
      const { p1, p2 } = report.siege;
      if (p1.through === p2.through) {
        expect(report.winner).toBe('draw');
      } else {
        split += 1;
        expect(report.winner).toBe(p1.through < p2.through ? 'p1' : 'p2');
      }
    }
    expect(level).toBeGreaterThan(10);
    expect(split).toBeGreaterThan(level / 4);
  });

  it('reports a score that only ever counts up, and never past the army’s worth', () => {
    const siege = freshSiege(505);
    const states = { p1: createBotState(), p2: createBotState() };
    const rngs: Record<SeatId, Rng> = { p1: new Rng(3), p2: new Rng(4) };
    let last = { p1: 0, p2: 0 };
    while (winnerOf(siege) === null) {
      for (const seat of SEATS) {
        setHold(siege, seat, botHold(siege, seat, 'hard', states[seat], rngs[seat], STEP));
      }
      step(siege, STEP);
      for (const seat of SEATS) {
        const now = scoreOf(siege, seat);
        expect(now).toBeGreaterThanOrEqual(last[seat]);
        expect(now).toBeLessThanOrEqual(SOLDIERS * 3);
        last = { ...last, [seat]: now };
      }
    }
  });

  it('starts both guns at the same end of their own rails, and lets the opener pick which', () => {
    const first = freshSiege(8080, 'p1');
    const second = freshSiege(8080, 'p2');
    expect([first.p1.turret.u, first.p2.turret.u]).toEqual([0, 0]);
    expect([first.p1.turret.rising, first.p2.turret.rising]).toEqual([true, true]);
    expect([second.p1.turret.u, second.p2.turret.u]).toEqual([RAIL, RAIL]);
    expect([second.p1.turret.rising, second.p2.turret.rising]).toEqual([false, false]);
    // Identical in their own frames means half-turn images on the board — opposite ends of it,
    // travelling in opposite directions — under either opener.
    for (const siege of [first, second]) {
      expect(boardX('p2', siege.p2.turret.u)).toBe(BOARD - boardX('p1', siege.p1.turret.u));
    }
  });

  it('plays a different match from each opener', () => {
    // Worth checking, because a game that ignored the opening seat would hand the balance
    // harness the identical match twice and it could not separate a seat effect from a seed one.
    let different = 0;
    for (let seed = 0; seed < 60; seed += 1) {
      const a = botMatch(seed * 7919 + 11, 'normal', 'normal', { opener: 'p1' });
      const b = botMatch(seed * 7919 + 11, 'normal', 'normal', { opener: 'p2' });
      if (a.p1 !== b.p1 || a.p2 !== b.p2) different += 1;
    }
    expect(different).toBeGreaterThan(30);
  });
});

describe('mirror symmetry', () => {
  it('steps a mirrored siege to the mirror of the stepped siege', () => {
    // The test the second lessons list asks for first rather than last. Take a position, mirror
    // it, mirror the inputs, step both, and require the results to be mirror images — over
    // hundreds of random positions. Nothing else in this file can see a rule written in board
    // coordinates or a threshold the two seats straddle.
    const rng = new Rng(20260829);
    const siege = createSiege();
    const other = createSiege();
    const expected = createSiege();
    for (let trial = 0; trial < 400; trial += 1) {
      resetSiege(siege, new Rng(trial * 131 + 7));
      scramble(siege, rng);
      mirrorInto(siege, other);
      const a = rng.float() < 0.5;
      const b = rng.float() < 0.5;
      setHold(siege, 'p1', a);
      setHold(siege, 'p2', b);
      setHold(other, 'p1', b);
      setHold(other, 'p2', a);
      step(siege, STEP);
      step(other, STEP);
      mirrorInto(siege, expected);
      expect(describeSiege(other), `trial ${String(trial)}`).toBe(describeSiege(expected));
    }
  });

  it('makes a bot want the mirrored thing on a mirrored siege', () => {
    const rng = new Rng(31337);
    const siege = createSiege();
    const other = createSiege();
    for (const tier of TIERS) {
      for (let trial = 0; trial < 200; trial += 1) {
        resetSiege(siege, new Rng(trial * 197 + 3));
        scramble(siege, rng);
        mirrorInto(siege, other);
        const here = createBotState();
        const there = createBotState();
        const a = new Rng(trial + 1);
        const b = new Rng(trial + 1);
        const planned = planShot(siege, 'p1', tier, here, a, STEP);
        expect(planShot(other, 'p2', tier, there, b, STEP), `${tier} trial ${String(trial)}`).toBe(
          planned,
        );
        expect(here.target).toBe(there.target);
        expect(here.laneOffset).toBe(there.laneOffset);
        expect(here.rangeOffset).toBe(there.rangeOffset);
        expect(here.laneTimer).toBe(there.laneTimer);
      }
    }
  });

  it('plays a whole mirrored match to the exact mirrored result', () => {
    // End to end, and this is the fairness *proof* rather than a measurement: swap the two
    // seats' bot streams and the whole match reflects, under either opener. The two seats hold
    // bit-identical positions in their own frames and face one shared army, so seat one takes
    // exactly half of these by construction rather than to within a sampling error.
    let flipped = 0;
    let mismatched = 0;
    let decided = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 60; seed += 1) {
        const opener: SeatId = seed % 2 === 0 ? 'p1' : 'p2';
        const forward = botMatch(seed * 3571 + 1, tier, tier, { opener });
        const backward = botMatch(seed * 3571 + 1, tier, tier, { opener, swapStreams: true });
        const wanted = forward.winner === 'p1' ? 'p2' : forward.winner === 'p2' ? 'p1' : 'draw';
        if (backward.winner !== wanted) flipped += 1;
        if (backward.p1 !== forward.p2 || backward.p2 !== forward.p1) mismatched += 1;
        if (forward.winner !== 'draw') decided += 1;
      }
    }
    expect(flipped).toBe(0);
    expect(mismatched).toBe(0);
    expect(decided).toBeGreaterThan(100);
  });
});

describe('determinism', () => {
  const trace = (report: Report): string =>
    `${String(report.winner)}:${String(report.p1)}:${String(report.p2)}:${String(report.steps)}`;

  it('plays the identical match from the identical seed', () => {
    expect(trace(botMatch(99, 'hard', 'normal'))).toBe(trace(botMatch(99, 'hard', 'normal')));
  });

  it('holds the whole state in something that survives a round trip through JSON', () => {
    const report = botMatch(99, 'hard', 'normal');
    const text = describeSiege(report.siege);
    expect(describeSiege(JSON.parse(text) as Siege)).toBe(text);
  });

  it('does not care which seat is polled first', () => {
    // Disjoint shot slots and a generator per seat, so the poll order is not observable. A
    // shared pool or a shared stream would make this false for a reason nothing to do with the
    // game, which is exactly why neither is used.
    for (const tier of TIERS) {
      for (let seed = 0; seed < 25; seed += 1) {
        const forward = botMatch(seed * 613 + 5, tier, tier);
        const reversed = botMatch(seed * 613 + 5, tier, tier, { reversed: true });
        expect(describeSiege(reversed.siege), `${tier} seed ${String(seed)}`).toBe(
          describeSiege(forward.siege),
        );
      }
    }
  });

  it('plays a seat the same way whoever is sitting opposite', () => {
    // Each seat's stream is its own, so a bot's own shots do not depend on the tier facing it.
    const shotsOf = (opponent: BotDifficulty): string => {
      const report = botMatch(4242, 'normal', opponent);
      return JSON.stringify(report.siege.p1);
    };
    expect(shotsOf('easy')).toBe(shotsOf('hard'));
  });

  it('deals the same wave from the same seed and a different one otherwise', () => {
    expect(freshSiege(7).wave).toEqual(freshSiege(7).wave);
    expect(freshSiege(7).wave).not.toEqual(freshSiege(8).wave);
  });

  it('deals the wave from a fixed number of draws, whatever it deals', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const counted = new Rng(seed);
      const plain = new Rng(seed);
      const siege = createSiege();
      resetSiege(siege, counted);
      for (let i = 0; i < SOLDIERS; i += 1) plain.float();
      expect(counted.next()).toBe(plain.next());
      expect(siege.wave).toHaveLength(SOLDIERS);
      for (const lane of siege.wave) {
        expect(Number.isInteger(lane)).toBe(true);
        expect(lane).toBeGreaterThanOrEqual(0);
        expect(lane).toBeLessThan(LANES);
      }
    }
  });

  it('hands both seats the same army', () => {
    const siege = freshSiege(2024);
    for (let i = 0; i < 60 * 30 && winnerOf(siege) === null; i += 1) step(siege, STEP);
    for (let i = 0; i < SOLDIERS; i += 1) {
      expect((siege.p1.soldiers[i] as Soldier).lane).toBe((siege.p2.soldiers[i] as Soldier).lane);
    }
  });
});

describe('a fresh match', () => {
  it('puts everything back', () => {
    const siege = freshSiege(606);
    const states = { p1: createBotState(), p2: createBotState() };
    const rngs: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
    for (let i = 0; i < 60 * 12; i += 1) {
      for (const seat of SEATS) {
        setHold(siege, seat, botHold(siege, seat, 'hard', states[seat], rngs[seat], STEP));
      }
      step(siege, STEP);
    }
    expect(scoreOf(siege, 'p1') + scoreOf(siege, 'p2')).toBeGreaterThan(0);

    resetSiege(siege, new Rng(606), 'p1');
    for (const seat of SEATS) {
      const side = sideOf(siege, seat);
      expect(side.ground).toBe(0);
      expect(side.smashed).toBe(0);
      expect(side.through).toBe(0);
      expect(liveOf(side)).toHaveLength(0);
      expect(inUse(side)).toBe(0);
      expect(side.turret.loaded).toBe(true);
      expect(side.turret.range).toBe(RANGE_MIN);
    }
    expect(siege.phase).toBe('opening');
    expect(siege.released).toBe(0);
    expect(siege.elapsed).toBe(0);
    expect(winnerOf(siege)).toBeNull();
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the bot', () => {
  it('reads nothing a player cannot see', () => {
    // Rule 6, asserted on the shape of a tier rather than argued in prose: two numbers, both
    // seconds of human error. Nothing in a profile can be a speed, a reach, or a fact about the
    // field a player cannot read off the screen.
    for (const tier of TIERS) {
      const profile = BOT_PROFILES[tier];
      expect(Object.keys(profile).sort()).toEqual(['blunder', 'timing']);
      expect(profile.timing).toBeGreaterThan(4 * STEP);
      expect(profile.timing).toBeLessThan(0.5);
      expect(profile.blunder).toBeGreaterThanOrEqual(0);
      expect(profile.blunder).toBeLessThan(1);
    }
    expect(BOT_PROFILES.easy.timing).toBeGreaterThan(BOT_PROFILES.normal.timing);
    expect(BOT_PROFILES.normal.timing).toBeGreaterThan(BOT_PROFILES.hard.timing);
    expect(BOT_PROFILES.easy.blunder).toBeGreaterThan(BOT_PROFILES.normal.blunder);
    expect(BOT_PROFILES.normal.blunder).toBeGreaterThan(BOT_PROFILES.hard.blunder);
  });

  it('draws exactly the same number of values for every shot', () => {
    for (const tier of TIERS) {
      const siege = freshSiege(1234);
      openUp(siege);
      for (let i = 0; i < 60 * 6; i += 1) step(siege, STEP);
      const counted = new Rng(77);
      const plain = new Rng(77);
      const state = createBotState();
      let shots = 0;
      for (let i = 0; i < 200; i += 1) {
        if (planShot(siege, 'p1', tier, state, counted, STEP)) shots += 1;
        state.stage = 'plan';
      }
      expect(shots).toBeGreaterThan(0);
      for (let i = 0; i < shots * BOT_DRAWS_PER_SHOT; i += 1) plain.float();
      expect(counted.next()).toBe(plain.next());
    }
  });

  it('draws the same count whether or not it fumbles', () => {
    // The fumble is decided from values that are drawn before anything branches, so a shot that
    // goes wrong costs the generator exactly what a shot that does not costs it.
    const siege = freshSiege(1234);
    openUp(siege);
    for (let i = 0; i < 60 * 6; i += 1) step(siege, STEP);
    const never = new Rng(500);
    const always = new Rng(500);
    const a = createBotState();
    const b = createBotState();
    expect(planShot(siege, 'p1', 'hard', a, never, STEP)).toBe(true);
    expect(planShot(siege, 'p1', 'easy', b, always, STEP)).toBe(true);
    expect(never.next()).toBe(always.next());
  });

  it('counts down to a moment rather than watching for a position', () => {
    // Watching for a position is the obvious way to write this and it hangs: the error is added
    // in whichever direction the gun happens to be travelling, so an error larger than the rail
    // is out of reach both ways. A countdown cannot fail to expire.
    const turret: Turret = {
      u: 0,
      rising: true,
      loaded: true,
      aiming: false,
      range: RANGE_MIN,
      charge: CHARGE_SPEED,
      reload: 0,
      held: false,
      want: false,
    };
    const roundTrip = (2 * RAIL) / TRAVERSE_RATE;
    for (let u = 0; u <= RAIL; u += 5) {
      for (const rising of [true, false]) {
        turret.u = u;
        turret.rising = rising;
        for (let lane = 0; lane < LANES; lane += 1) {
          const wait = timeToLane(turret, lane);
          expect(Number.isFinite(wait)).toBe(true);
          expect(wait).toBeGreaterThanOrEqual(0);
          expect(wait).toBeLessThanOrEqual(roundTrip + 1e-9);
        }
      }
    }
  });

  it('arrives on the road it counted down to, inside the step it is quantised to', () => {
    // A press can only land on a step, so the best anybody — bot or person — can do is arrive
    // within half a step of the road: TRAVERSE_RATE · dt / 2 = 3.75 units at 60 Hz, against a
    // 40-unit blast. That is the floor the whole game's precision sits on and it is the same
    // floor for a thumb, a trackpad and a key, which is the point of a control with no position.
    const slack = (TRAVERSE_RATE * STEP) / 2 + 1e-9;
    expect(slack).toBeLessThan(BLAST / 10);
    for (let lane = 0; lane < LANES; lane += 1) {
      const siege = freshSiege(2468);
      openUp(siege);
      const turret = siege.p1.turret;
      const steps = Math.round(timeToLane(turret, lane) / STEP);
      for (let i = 0; i < steps; i += 1) {
        setHold(siege, 'p1', false);
        step(siege, STEP);
      }
      expect(Math.abs(turret.u - laneU(lane)), `lane ${String(lane)}`).toBeLessThanOrEqual(slack);
    }
  });

  it('lands on the soldier it chose when it makes no mistake', () => {
    // The tier's error is zero here, so any miss is the closed form disagreeing with the
    // simulation rather than a bot playing badly. This is issue #2465 in its live form.
    const siege = freshSiege(1357);
    const state = createBotState();
    const rng = new Rng(24);
    const exact = { timing: 0, blunder: 0 };
    let shots = 0;
    let hits = 0;
    let loaded = true;
    for (let i = 0; i < 60 * 34 && winnerOf(siege) === null; i += 1) {
      // Drive the bot by hand with a perfect profile: plan through `planShot`, then zero the
      // two offsets it drew, so the moments it acts on are the ones it meant.
      const before = sideOf(siege, 'p1').smashed;
      const hold = botHold(siege, 'p1', 'hard', state, rng, STEP);
      state.laneOffset = exact.timing;
      state.rangeOffset = exact.blunder;
      setHold(siege, 'p1', hold);
      step(siege, STEP);
      if (loaded && !siege.p1.turret.loaded) shots += 1;
      loaded = siege.p1.turret.loaded;
      if (sideOf(siege, 'p1').smashed > before) hits += 1;
    }
    expect(shots).toBeGreaterThan(8);
    // Not every shot can hit — a target can walk out of reach or be taken by an earlier shot
    // between the plan and the press — but a bot whose arithmetic agreed with the simulation
    // only approximately would miss most of them.
    expect(hits / shots).toBeGreaterThan(0.85);
  });

  it('never presses when there is nothing it could reach', () => {
    const siege = freshSiege(4321);
    openUp(siege);
    // Kill the whole wave: nothing on the field, nothing worth a shot.
    siege.released = SOLDIERS;
    for (const soldier of siege.p1.soldiers) soldier.alive = false;
    const state = createBotState();
    const rng = new Rng(9);
    for (let i = 0; i < 200; i += 1) {
      expect(botHold(siege, 'p1', 'hard', state, rng, STEP)).toBe(false);
    }
    expect(siege.p1.turret.loaded).toBe(true);
  });

  it('never holds its control while nothing is loaded', () => {
    const siege = freshSiege(1111);
    const state = createBotState();
    const rng = new Rng(12);
    while (winnerOf(siege) === null) {
      const hold = botHold(siege, 'p1', 'normal', state, rng, STEP);
      if (!siege.p1.turret.loaded) expect(hold).toBe(false);
      setHold(siege, 'p1', hold);
      step(siege, STEP);
    }
  });

  it('does not spend a second shot on a soldier its first is already about to take', () => {
    const siege = bench(300, 2);
    const side = sideOf(siege, 'p1');
    const soldier = side.soldiers[0] as Soldier;
    const shot = side.shots[0] as Shot;
    expect(doomed(side, soldier)).toBe(false);
    shot.state = SHOT_FLYING;
    shot.u = laneU(soldier.lane);
    shot.flightTime = 0.2;
    shot.flight = 0;
    shot.range = soldier.d - MARCH_SPEED * 0.2;
    expect(doomed(side, soldier)).toBe(true);
    shot.range = soldier.d - MARCH_SPEED * 0.2 + BLAST + 1;
    expect(doomed(side, soldier)).toBe(false);
  });

  it('takes the farthest soldier it can reach, in its own frame', () => {
    const siege = bench(0, 0);
    const side = sideOf(siege, 'p1');
    side.turret.u = laneU(2);
    side.turret.rising = true;
    const near = side.soldiers[0] as Soldier;
    const far = side.soldiers[1] as Soldier;
    near.alive = true;
    near.lane = 2;
    near.d = 200;
    far.alive = true;
    far.lane = 2;
    far.d = 320;
    const state = createBotState();
    expect(planShot(siege, 'p1', 'hard', state, new Rng(5), STEP)).toBe(true);
    expect(state.target).toBe(1);
  });

  it('is ordered by strength, measured in both seat orders', () => {
    // Both directions asserted rather than the average of the two, which is the habit
    // `sling-puck` established and the one issue #2489 exists because `snakes-ladders` lacked.
    const duel = (strong: BotDifficulty, weak: BotDifficulty): readonly [number, number] => {
      const share = (order: 'forward' | 'reversed'): number => {
        let strongWins = 0;
        let decided = 0;
        for (let seed = 0; seed < 60; seed += 1) {
          const report =
            order === 'forward'
              ? botMatch(seed * 7919 + 11, strong, weak)
              : botMatch(seed * 7919 + 11, weak, strong);
          const seat: SeatId = order === 'forward' ? 'p1' : 'p2';
          if (report.winner === 'draw') continue;
          decided += 1;
          if (report.winner === seat) strongWins += 1;
        }
        return strongWins / decided;
      };
      return [share('forward'), share('reversed')];
    };
    for (const [strong, weak] of [
      ['normal', 'easy'],
      ['hard', 'normal'],
      ['hard', 'easy'],
    ] as const) {
      const [forward, reversed] = duel(strong, weak);
      expect(forward, `${strong} over ${weak} as p1`).toBeGreaterThan(0.7);
      expect(reversed, `${strong} over ${weak} as p2`).toBeGreaterThan(0.7);
      expect(Math.abs(forward - reversed)).toBeLessThan(0.15);
    }
  });

  it('separates the tiers by how much ground they hold', () => {
    const ground = (tier: BotDifficulty): number => {
      let total = 0;
      for (let seed = 0; seed < 60; seed += 1) {
        const report = botMatch(seed * 7919 + 11, tier, tier);
        total += report.p1 + report.p2;
      }
      return total / 120;
    };
    const easy = ground('easy');
    const normal = ground('normal');
    const hard = ground('hard');
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
    // And the best of the three is nowhere near the ceiling, so the score does not saturate.
    expect(hard).toBeLessThan(SOLDIERS * 3 * 0.8);
  });

  it('is level with itself, in both seat orders', () => {
    // The sampled companion to the mirror proof above, which is the assertion that actually
    // carries the claim. This one exists to catch a *sampling* difference the proof cannot see:
    // the proof mirrors the bot streams as well as the opener, and the shell does not — it
    // alternates the opener alone across the rounds of a best-of. So each seed is played from
    // both openers with the streams left where they are, which is the harness
    // `balance-aggregate.test.ts` runs.
    //
    // The band is 42-58% and the sample is about 970 decided matches a tier, whose standard
    // error is 1.6 points — so this rejects a lean of about five standard errors and nothing
    // finer, and it says so rather than claiming 45-55. Measured over 4000 matches a tier the
    // shares are 50.3 / 49.7 / 49.9%.
    for (const tier of TIERS) {
      let seatOne = 0;
      let decided = 0;
      for (let seed = 0; seed < 500; seed += 1) {
        for (const opener of SEATS) {
          const report = botMatch(Math.imul(seed + 1, 2654435761) | 0, tier, tier, { opener });
          if (report.winner === 'draw') continue;
          decided += 1;
          if (report.winner === 'p1') seatOne += 1;
        }
      }
      const share = seatOne / decided;
      expect(decided).toBeGreaterThan(800);
      expect(share, `${tier}: seat one took ${(100 * share).toFixed(1)}%`).toBeGreaterThan(0.42);
      expect(share, `${tier}: seat one took ${(100 * share).toFixed(1)}%`).toBeLessThan(0.58);
    }
  });
});
