import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  ARENA,
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  CRATES,
  CRATE_ARMOUR,
  CRATE_HALF,
  FIRE_CONE,
  GRACE_SECONDS,
  LIVES,
  LOAD_FULL,
  LOAD_MIN,
  PADS,
  RECOIL,
  SHELLS,
  SHELL_FAST,
  SHELL_LIFE,
  SHELL_RADIUS,
  SHELL_SLOTS,
  SHELL_SLOW,
  SHIELD,
  TANK_RADIUS,
  angleDelta,
  botIntent,
  createBotState,
  createGame,
  loadToReach,
  mirrorX,
  mirrorY,
  otherOf,
  padHeadingOf,
  padXOf,
  padYOf,
  reachFor,
  resetGame,
  setIntent,
  shellSpeedFor,
  step,
  tankOf,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, BotState, Game, Intent } from './rules.js';

const STEP = 1 / 60;
const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];
const SEATS: SeatId[] = ['p1', 'p2'];

function started(seed = 1): Game {
  const game = createGame();
  resetGame(game, new Rng(seed));
  return game;
}

/** Run past the grace period so the guns start loading. */
function toFighting(game: Game, rng: Rng): void {
  for (let i = 0; i < 600 && game.phase === 'grace'; i += 1) step(game, STEP, rng);
}

/** One whole match between two tiers, driven exactly as `TanksGame.update` drives it. */
function playMatch(
  p1Tier: BotDifficulty | null,
  p2Tier: BotDifficulty | null,
  seed: number,
  order: readonly SeatId[] = SEATS,
): { game: Game; frames: number; pads: string[]; peak: number } {
  const seeds = new Rng(seed);
  const world = new Rng(seeds.next() | 0);
  const bots: Record<SeatId, Rng> = {
    p1: new Rng(seeds.next() | 0),
    p2: new Rng(seeds.next() | 0),
  };
  const game = createGame();
  resetGame(game, world);
  const states: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
  const tiers: Record<SeatId, BotDifficulty | null> = { p1: p1Tier, p2: p2Tier };
  const out: Intent = { turn: 0, throttle: 0 };
  const pads: string[] = [];
  let frames = 0;
  let peak = 0;
  // No frame cap. Termination is structural, and this is where that is claimed.
  while (game.winner === null) {
    for (const seat of order) {
      const tier = tiers[seat];
      if (tier === null) {
        setIntent(game, seat, 0, 0);
        continue;
      }
      botIntent(game, seat, tier, states[seat], bots[seat], STEP, out);
      setIntent(game, seat, out.turn, out.throttle);
    }
    const outcome = step(game, STEP, world);
    for (const seat of outcome.struck) {
      const tank = tankOf(game, seat);
      pads.push(`${seat}@${tank.x.toFixed(0)},${tank.y.toFixed(0)}`);
    }
    let alive = 0;
    for (const shell of game.shells) if (shell.active) alive += 1;
    if (alive > peak) peak = alive;
    frames += 1;
  }
  return { game, frames, pads, peak };
}

function series(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
  base = 11,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let i = 0; i < matches; i += 1) {
    const { game } = playMatch(p1Tier, p2Tier, base + i * 7919);
    wins[game.winner ?? 'draw'] += 1;
  }
  return wins;
}

describe('the yard', () => {
  it('is point-symmetric, crate for crate, from every seed', () => {
    // Measured rather than trusted: for every crate there must be another whose position is
    // this one turned half a turn about the centre, with the same armour. This is the whole
    // of "neither start is better" in a game where both seats share one arena.
    for (let seed = 0; seed < 200; seed += 1) {
      const game = started(seed);
      for (const crate of game.crates) {
        const twin = game.crates.find(
          (other) =>
            Math.abs(other.x - mirrorX(crate.x)) < 1e-9 &&
            Math.abs(other.y - mirrorY(crate.y)) < 1e-9 &&
            other.armour === crate.armour,
        );
        expect(
          twin,
          `seed ${String(seed)}: crate at ${crate.x},${crate.y} has no mirror`,
        ).toBeDefined();
      }
      expect(game.crates.length).toBe(CRATES);
    }
  });

  it('opens both tanks on mirrored pads, facing each other', () => {
    const game = started(5);
    expect(game.p1.x).toBeCloseTo(mirrorX(game.p2.x), 9);
    expect(game.p1.y).toBeCloseTo(mirrorY(game.p2.y), 9);
    expect(Math.abs(angleDelta(game.p1.heading + Math.PI, game.p2.heading))).toBeCloseTo(0, 9);
    for (let pad = 0; pad < PADS; pad += 1) {
      expect(padXOf('p2', pad)).toBeCloseTo(mirrorX(padXOf('p1', pad)), 9);
      expect(padYOf('p2', pad)).toBeCloseTo(mirrorY(padYOf('p1', pad)), 9);
    }
    expect(padHeadingOf('p1')).not.toBe(padHeadingOf('p2'));
  });

  it('never deals a crate on top of a pad', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const game = started(seed);
      for (const crate of game.crates) {
        for (const seat of SEATS) {
          for (let pad = 0; pad < PADS; pad += 1) {
            const gap = Math.max(
              Math.abs(crate.x - padXOf(seat, pad)),
              Math.abs(crate.y - padYOf(seat, pad)),
            );
            expect(gap).toBeGreaterThan(CRATE_HALF + TANK_RADIUS);
          }
        }
      }
    }
  });

  it('draws the same number of values to deal, whatever it deals', () => {
    // A variable count here could not hurt — the deal is over before anything else touches
    // the stream — but a variable count is the shape of bug this repo keeps finding, so it
    // is not written even where it would be harmless.
    let expected = -1;
    for (let seed = 0; seed < 40; seed += 1) {
      const counter = new Rng(seed);
      let draws = 0;
      const counted = {
        float: () => {
          draws += 1;
          return counter.float();
        },
      } as unknown as Rng;
      resetGame(createGame(), counted);
      if (expected < 0) expected = draws;
      expect(draws, `seed ${String(seed)}`).toBe(expected);
    }
    expect(expected).toBeGreaterThan(0);
  });
});

describe('the tank', () => {
  it('never turns faster than its own rate, whatever it is asked for', () => {
    const game = started(2);
    const rng = new Rng(2);
    toFighting(game, rng);
    let worst = 0;
    for (let i = 0; i < 600; i += 1) {
      // Ask for the largest turn the interface can express, every step.
      setIntent(game, 'p1', 99, 99);
      const before = game.p1.heading;
      step(game, STEP, rng);
      worst = Math.max(worst, Math.abs(angleDelta(before, game.p1.heading)));
    }
    expect(worst).toBeLessThanOrEqual(2.4 * STEP + 1e-9);
  });

  it('stays inside the yard and out of a crate', () => {
    const game = started(3);
    const rng = new Rng(3);
    toFighting(game, rng);
    for (let i = 0; i < 60 * 40 && game.phase === 'fighting'; i += 1) {
      setIntent(game, 'p1', i % 97 < 40 ? 1 : 0, 1);
      setIntent(game, 'p2', i % 53 < 20 ? -1 : 0, 1);
      step(game, STEP, rng);
      for (const seat of SEATS) {
        const tank = tankOf(game, seat);
        expect(tank.x).toBeGreaterThanOrEqual(TANK_RADIUS - 1e-6);
        expect(tank.x).toBeLessThanOrEqual(ARENA - TANK_RADIUS + 1e-6);
        expect(tank.y).toBeGreaterThanOrEqual(TANK_RADIUS - 1e-6);
        expect(tank.y).toBeLessThanOrEqual(ARENA - TANK_RADIUS + 1e-6);
        for (const crate of game.crates) {
          if (crate.armour <= 0) continue;
          const insideX = Math.abs(tank.x - crate.x) < CRATE_HALF + TANK_RADIUS - 0.5;
          const insideY = Math.abs(tank.y - crate.y) < CRATE_HALF + TANK_RADIUS - 0.5;
          expect(insideX && insideY, `tank inside a crate at step ${String(i)}`).toBe(false);
        }
      }
    }
  });

  it('gives up speed while it is swinging, and reads only the hull to decide', () => {
    // Speed is a function of the turn actually applied, never of the order that asked for
    // it: a thumb and a key put the hull at the same rate and so pay the same.
    const straight = started(4);
    const turning = started(4);
    const rng = new Rng(4);
    toFighting(straight, rng);
    toFighting(turning, new Rng(4));
    setIntent(straight, 'p1', 0, 1);
    setIntent(turning, 'p1', 1, 1);
    const from = { x: straight.p1.x, y: straight.p1.y };
    for (let i = 0; i < 6; i += 1) {
      step(straight, STEP, new Rng(9));
      step(turning, STEP, new Rng(9));
    }
    const fast = Math.hypot(straight.p1.x - from.x, straight.p1.y - from.y);
    const slow = Math.hypot(turning.p1.x - from.x, turning.p1.y - from.y);
    expect(slow).toBeLessThan(fast);
  });

  it('reverses more slowly than it drives, so backing away is answerable', () => {
    const game = started(6);
    const rng = new Rng(6);
    toFighting(game, rng);
    const start = { x: game.p1.x, y: game.p1.y };
    setIntent(game, 'p1', 0, 1);
    for (let i = 0; i < 30; i += 1) step(game, STEP, rng);
    const forward = Math.hypot(game.p1.x - start.x, game.p1.y - start.y);

    const back = started(6);
    toFighting(back, new Rng(6));
    setIntent(back, 'p1', 0, -1);
    for (let i = 0; i < 30; i += 1) step(back, STEP, new Rng(6));
    const reverse = Math.hypot(back.p1.x - start.x, back.p1.y - start.y);
    expect(reverse).toBeLessThan(forward);
  });
});

describe('the gun', () => {
  it('fires on the step the controls are let go of, and not before', () => {
    const game = started(7);
    const rng = new Rng(7);
    toFighting(game, rng);
    setIntent(game, 'p1', 1, 0);
    let fired = 0;
    for (let i = 0; i < 12; i += 1) fired += step(game, STEP, rng).fired.length;
    expect(fired, 'a held order must not fire').toBe(0);
    // Still under the shortest hold that fires: letting go now does nothing.
    setIntent(game, 'p1', 0, 0);
    expect(step(game, STEP, rng).fired.length).toBe(0);

    setIntent(game, 'p1', 1, 0);
    for (let i = 0; i < Math.ceil(LOAD_MIN / STEP) + 2; i += 1) step(game, STEP, rng);
    setIntent(game, 'p1', 0, 0);
    expect(step(game, STEP, rng).fired).toContain('p1');
  });

  it('goes off by itself when it is full, whatever anybody is doing', () => {
    // This is the termination guarantee, stated as a property rather than as arithmetic.
    const game = started(8);
    const rng = new Rng(8);
    toFighting(game, rng);
    let fired = 0;
    const steps = Math.ceil((LOAD_FULL + RECOIL + 0.1) / STEP);
    for (let i = 0; i < steps; i += 1) {
      setIntent(game, 'p1', 1, 1);
      fired += step(game, STEP, rng).fired.filter((seat) => seat === 'p1').length;
    }
    expect(fired).toBeGreaterThanOrEqual(1);
  });

  it('cannot be made to fire faster by letting go and grabbing again', () => {
    // Rule 10's other half: a mashed control must not beat a held one. The floor is
    // RECOIL + LOAD_MIN for everybody, key and thumb alike.
    const mash = started(9);
    const rng = new Rng(9);
    toFighting(mash, rng);
    const seconds = 12;
    let shots = 0;
    for (let i = 0; i < seconds * 60; i += 1) {
      setIntent(mash, 'p1', i % 2 === 0 ? 1 : 0, 0);
      shots += step(mash, STEP, rng).fired.filter((seat) => seat === 'p1').length;
    }
    expect(shots).toBeLessThanOrEqual(Math.ceil(seconds / (RECOIL + LOAD_MIN)) + 1);
  });

  it('is locked out for the recoil, so no order lands during it', () => {
    const game = started(10);
    const rng = new Rng(10);
    toFighting(game, rng);
    setIntent(game, 'p1', 1, 0);
    for (let i = 0; i < Math.ceil(LOAD_FULL / STEP) + 2; i += 1) step(game, STEP, rng);
    expect(game.p1.recoil).toBeGreaterThan(0);
    const where = { x: game.p1.x, y: game.p1.y, heading: game.p1.heading };
    setIntent(game, 'p1', 1, 1);
    step(game, STEP, rng);
    expect(game.p1.x).toBe(where.x);
    expect(game.p1.y).toBe(where.y);
    expect(game.p1.heading).toBe(where.heading);
  });

  it('turns a longer hold into a faster shell and a longer reach', () => {
    expect(shellSpeedFor(LOAD_MIN)).toBeCloseTo(SHELL_SLOW, 6);
    expect(shellSpeedFor(LOAD_FULL)).toBeCloseTo(SHELL_FAST, 6);
    expect(reachFor(LOAD_FULL)).toBeGreaterThan(reachFor(LOAD_MIN));
    // Nobody can shoot the length of the yard, which is what stops the opening being a
    // long-range exchange between the two pads.
    expect(reachFor(LOAD_FULL)).toBeLessThan(ARENA);
    expect(loadToReach(reachFor(LOAD_FULL))).toBeCloseTo(LOAD_FULL, 4);
    expect(loadToReach(ARENA * 2)).toBe(Infinity);
  });

  it('never runs the shell pool out', () => {
    // The arithmetic ceiling is six; the measured high-water mark across the balance runs is
    // three. Asserted rather than left as a comment, because the overflow branch spends a
    // shell without producing one and the termination argument would still hold but the
    // game would silently lose shots.
    for (let seed = 0; seed < 25; seed += 1) {
      const { peak } = playMatch('hard', 'hard', 900 + seed);
      expect(peak).toBeLessThan(SHELL_SLOTS);
    }
  });
});

describe('shells', () => {
  /**
   * Load the gun and let go. Returns whether the release step itself struck a seat — the
   * shell moves on the step it is fired, so at close range the whole exchange is over
   * before the caller's loop gets a look at it.
   */
  function fireInto(game: Game, rng: Rng, seat: SeatId): SeatId[] {
    setIntent(game, seat, 0, 1);
    for (let i = 0; i < Math.ceil(LOAD_MIN / STEP) + 2; i += 1) step(game, STEP, rng);
    setIntent(game, seat, 0, 0);
    return [...step(game, STEP, rng).struck];
  }

  it('knocks a crate down and stops there', () => {
    const game = started(11);
    const rng = new Rng(11);
    toFighting(game, rng);
    const crate = game.crates[0]!;
    game.p1.x = crate.x;
    game.p1.y = crate.y + CRATE_HALF + TANK_RADIUS + 60;
    game.p1.heading = -Math.PI / 2;
    game.p2.x = 40;
    game.p2.y = 40;
    fireInto(game, rng, 'p1');
    for (let i = 0; i < 60 && crate.armour === CRATE_ARMOUR; i += 1) step(game, STEP, rng);
    expect(crate.armour).toBe(CRATE_ARMOUR - 1);
    expect(game.shells.every((shell) => !shell.active)).toBe(true);
  });

  it('takes a life off the other tank and sends it back to a pad', () => {
    const game = started(12);
    const rng = new Rng(12);
    toFighting(game, rng);
    game.p1.x = 450;
    game.p1.y = 500;
    game.p1.heading = -Math.PI / 2;
    game.p2.x = 450;
    game.p2.y = 380;
    game.p2.shield = 0;
    for (const crate of game.crates) crate.armour = 0;
    let struck = fireInto(game, rng, 'p1').includes('p2');
    for (let i = 0; i < 120 && !struck; i += 1)
      struck = step(game, STEP, rng).struck.includes('p2');
    expect(struck).toBe(true);
    expect(game.p2.lives).toBe(LIVES - 1);
    expect(game.p2.shield).toBeCloseTo(SHIELD, 6);
    const onAPad = Array.from({ length: PADS }, (_, pad) => pad).some(
      (pad) => Math.abs(game.p2.x - padXOf('p2', pad)) < 1e-6,
    );
    expect(onAPad).toBe(true);
  });

  it('passes straight through a tank that has just come back', () => {
    const game = started(13);
    const rng = new Rng(13);
    toFighting(game, rng);
    game.p1.x = 450;
    game.p1.y = 500;
    game.p1.heading = -Math.PI / 2;
    game.p2.x = 450;
    game.p2.y = 380;
    game.p2.shield = SHIELD;
    for (const crate of game.crates) crate.armour = 0;
    fireInto(game, rng, 'p1');
    for (let i = 0; i < 30; i += 1) step(game, STEP, rng);
    expect(game.p2.lives).toBe(LIVES);
  });

  it('never touches the tank that fired it', () => {
    const game = started(14);
    const rng = new Rng(14);
    toFighting(game, rng);
    for (const crate of game.crates) crate.armour = 0;
    for (let i = 0; i < 60 * 30 && game.phase === 'fighting'; i += 1) {
      setIntent(game, 'p1', 1, i % 40 < 20 ? 1 : -1);
      setIntent(game, 'p2', 0, 0);
      step(game, STEP, rng);
    }
    // p2 never fires and p1 is the only source of shells, so any life p1 lost came from its
    // own gun.
    expect(game.p1.lives).toBe(LIVES);
  });

  it('dies at the wall rather than bouncing', () => {
    const game = started(15);
    const rng = new Rng(15);
    toFighting(game, rng);
    for (const crate of game.crates) crate.armour = 0;
    const shell = game.shells[0]!;
    shell.active = true;
    shell.owner = 0;
    shell.x = ARENA - 20;
    shell.y = 400;
    shell.vx = SHELL_FAST;
    shell.vy = 0;
    shell.life = SHELL_LIFE;
    for (let i = 0; i < 30; i += 1) step(game, STEP, rng);
    expect(shell.active).toBe(false);
    expect(shell.x).toBeLessThan(ARENA + SHELL_RADIUS * 4);
  });
});

describe('the match', () => {
  it('opens with a moment of calm', () => {
    const game = started(16);
    const rng = new Rng(16);
    expect(game.phase).toBe('grace');
    let elapsed = 0;
    for (let i = 0; i < 600 && game.phase === 'grace'; i += 1) {
      step(game, STEP, rng);
      elapsed += STEP;
    }
    expect(elapsed).toBeCloseTo(GRACE_SECONDS, 1);
  });

  it('ends on its own from every seed, with no frame cap doing the work', () => {
    // `playMatch` has no cap in it at all. Termination is structural: every gun spends a
    // shell at least every RECOIL + LOAD_FULL seconds whatever anybody does, and the supply
    // is finite.
    for (let seed = 0; seed < 60; seed += 1) {
      const { game, frames } = playMatch('easy', 'hard', seed);
      expect(winnerOf(game)).not.toBeNull();
      expect(frames).toBeGreaterThan(0);
    }
  });

  it('ends even when neither tank is ever touched', () => {
    // The case a bot-driven test cannot reach. Both guns cook off on their own until the
    // racks are empty, and the match is then decided on lives.
    const { game, frames } = playMatch(null, null, 21);
    expect(winnerOf(game)).toBe('draw');
    expect(game.p1.shells).toBe(0);
    expect(game.p2.shells).toBe(0);
    expect(frames * STEP).toBeLessThan(SHELLS * (RECOIL + LOAD_FULL) + 5);
  });

  it('is won by taking the last life', () => {
    const game = started(17);
    const rng = new Rng(17);
    toFighting(game, rng);
    game.p2.lives = 1;
    game.p2.shield = 0;
    game.p1.x = 450;
    game.p1.y = 500;
    game.p1.heading = -Math.PI / 2;
    game.p2.x = 450;
    game.p2.y = 380;
    for (const crate of game.crates) crate.armour = 0;
    setIntent(game, 'p1', 0, 1);
    for (let i = 0; i < Math.ceil(LOAD_MIN / STEP) + 2; i += 1) step(game, STEP, rng);
    setIntent(game, 'p1', 0, 0);
    for (let i = 0; i < 120 && game.winner === null; i += 1) step(game, STEP, rng);
    expect(winnerOf(game)).toBe('p1');
  });

  it('stops simulating once it is decided', () => {
    const game = started(18);
    const rng = new Rng(18);
    game.phase = 'over';
    game.winner = 'p1';
    const before = JSON.stringify(game.p1);
    setIntent(game, 'p1', 1, 1);
    step(game, STEP, rng);
    expect(JSON.stringify(game.p1)).toBe(before);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the order', () => {
  it('accepts nothing finer than a sign, whatever it is handed', () => {
    // The one funnel both input families go through. A drag four hundred units long and a
    // key held down arrive as the same 1, so neither instrument can express more than the
    // other — which is what makes the parity test in `game.test.ts` an equality.
    const game = started(19);
    for (const [turn, throttle] of [
      [400, -0.001],
      [1, -1],
      [0.0001, 900],
    ] as const) {
      setIntent(game, 'p1', turn, throttle);
      expect(Math.abs(game.p1Intent.turn)).toBeLessThanOrEqual(1);
      expect(Math.abs(game.p1Intent.throttle)).toBeLessThanOrEqual(1);
      expect(Number.isInteger(game.p1Intent.turn)).toBe(true);
      expect(Number.isInteger(game.p1Intent.throttle)).toBe(true);
    }
  });
});

describe('the bot', () => {
  const out: Intent = { turn: 0, throttle: 0 };

  it('draws the same number of values whatever it sees', () => {
    for (const tier of TIERS) {
      const game = started(20);
      const rng = new Rng(20);
      toFighting(game, rng);
      const state = createBotState();
      for (let i = 0; i < 400 && game.phase === 'fighting'; i += 1) {
        const counter = new Rng(i + 1);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        state.cooldown = 0;
        botIntent(game, 'p1', tier, state, counted, STEP, out);
        expect(draws, `${tier} step ${String(i)}`).toBe(BOT_DRAWS_PER_DECISION);
        setIntent(game, 'p1', out.turn, out.throttle);
        setIntent(game, 'p2', 1, 1);
        step(game, STEP, rng);
      }
    }
  });

  it('spends nothing on a step it is not deciding', () => {
    const game = started(21);
    const state = createBotState();
    state.cooldown = 10;
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return 0.5;
      },
    } as unknown as Rng;
    botIntent(game, 'p1', 'hard', state, counted, STEP, out);
    expect(draws).toBe(0);
  });

  it('gives an order no richer than a person can', () => {
    // Rule 6, stated at the interface: a bot writes the same pair of signs a thumb does and
    // it goes through the same `setIntent`, so no tier turns faster, rolls faster or fires
    // sooner than a person.
    for (const tier of TIERS) {
      const game = started(22);
      const rng = new Rng(22);
      const state = createBotState();
      for (let i = 0; i < 60 * 30 && game.winner === null; i += 1) {
        botIntent(game, 'p1', tier, state, rng, STEP, out);
        expect([-1, 0, 1]).toContain(out.turn);
        expect([-1, 0, 1]).toContain(out.throttle);
        setIntent(game, 'p1', out.turn, out.throttle);
        setIntent(game, 'p2', 0, 1);
        step(game, STEP, rng);
      }
    }
  });

  it('cannot see anything a person watching the board cannot', () => {
    /*
     * Rule 6, proved rather than asserted: rewrite everything about the world a bot has no
     * business reading and check its decision does not move. The only two things it takes
     * from the other tank are where it is and which way it is moving, and both are drawn.
     *
     * Crates are rewritten wholesale because after `screen` was deleted the bot does not
     * read the yard at all — it drives into a crate exactly as a person who was not looking
     * would.
     */
    for (const tier of TIERS) {
      const game = started(23);
      const rng = new Rng(23);
      toFighting(game, rng);
      for (let i = 0; i < 400; i += 1) {
        setIntent(game, 'p1', 1, 1);
        setIntent(game, 'p2', -1, 1);
        step(game, STEP, rng);
        if (i % 17 !== 0) continue;

        const state = createBotState();
        botIntent(game, 'p1', tier, state, new Rng(99), STEP, out);
        const honest = `${out.turn}:${out.throttle}`;

        const foe = game.p2;
        const kept = { ...foe };
        foe.load = LOAD_FULL - foe.load;
        foe.recoil = RECOIL - foe.recoil;
        foe.shield = SHIELD;
        foe.shells = 0;
        foe.lives = 1;
        foe.ordered = !foe.ordered;
        game.elapsed += 123;
        const crates = game.crates.map((crate) => ({ ...crate }));
        for (const crate of game.crates) {
          crate.x = ARENA - crate.x;
          crate.y = ARENA - crate.y;
          crate.armour = crate.armour > 0 ? CRATE_ARMOUR + 1 - crate.armour : 0;
        }
        const shells = game.shells.map((shell) => ({ ...shell }));
        for (const shell of game.shells) shell.life = SHELL_LIFE - shell.life;

        const blind = createBotState();
        botIntent(game, 'p1', tier, blind, new Rng(99), STEP, out);
        expect(`${out.turn}:${out.throttle}`, `${tier} step ${String(i)}`).toBe(honest);

        Object.assign(foe, kept);
        game.elapsed -= 123;
        game.crates.forEach((crate, index) => Object.assign(crate, crates[index]));
        game.shells.forEach((shell, index) => Object.assign(shell, shells[index]));
      }
    }
  });

  it('keeps every tier a step apart on all three axes, in the right direction', () => {
    // Each of these was swept alone with the other two flattened; the isolated ladders are
    // in SPEC.md. A knob that did not move the result the right way was deleted rather than
    // left in reading like an axis — two were, and one measured backwards.
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
    expect(BOT_PROFILES.easy.aim).toBeGreaterThan(BOT_PROFILES.normal.aim);
    expect(BOT_PROFILES.normal.aim).toBeGreaterThan(BOT_PROFILES.hard.aim);
    // Backwards from what it looked like: the tier that hangs back is the strong one, and a
    // beginner is a beginner because they drive at the other tank.
    expect(BOT_PROFILES.easy.range).toBeLessThan(BOT_PROFILES.normal.range);
    expect(BOT_PROFILES.normal.range).toBeLessThan(BOT_PROFILES.hard.range);
  });

  it("keeps every tier's aim above the cone it already fires inside", () => {
    // Below the fire gate's own tolerance the wander is invisible: 0, 0.02, 0.04 and 0.06
    // all measured 6.0 to 6.6 seconds a life, and the knob would read in the source as the
    // main difficulty axis while doing nothing. It is Star Catcher's `aim` bug, and this is
    // the assertion that keeps it out.
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].aim, `${tier} aims inside the fire cone`).toBeGreaterThan(
        FIRE_CONE,
      );
    }
  });

  it('keeps every tier inside the reach of a fully charged shell', () => {
    // A tier holding further off than a shell carries could never hit anything, which is a
    // knob that reads as caution and is really a disability.
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].range).toBeLessThan(reachFor(LOAD_FULL));
    }
  });

  it('deals the same yard whoever is playing in it', () => {
    /*
     * The world has a generator of its own, so what is dealt is a function of the seed and
     * nothing else. On a stream shared with the bots it would not be: the tiers make
     * different numbers of decisions, draw different numbers of floats, and every respawn
     * pad after the first would land on a different value.
     *
     * Compared over the events both matches played: a sharper tier finishes sooner and so
     * stops respawning earlier, which is a difference in the match and not in the yard.
     */
    const crates = (tier: BotDifficulty): string =>
      playMatch(tier, tier, 4242)
        .game.crates.map((crate) => `${crate.x},${crate.y}`)
        .sort()
        .join('|');
    const trace = (tier: BotDifficulty): string[] => playMatch(tier, tier, 4242).pads;

    expect(crates('easy')).toBe(crates('hard'));
    const slow = trace('easy');
    const quick = trace('hard');
    const shared = Math.min(slow.length, quick.length);
    expect(shared).toBeGreaterThan(2);
    // The pad each destruction returns a tank to is the world's, not the bots'. Compared as
    // the sequence of pad *indices*, which is what the world actually deals.
    const padIndex = (mark: string): number => {
      const seat = mark.slice(0, 2) as SeatId;
      const x = Number(mark.slice(3).split(',')[0]);
      for (let pad = 0; pad < PADS; pad += 1) {
        if (Math.abs(padXOf(seat, pad) - x) < 1e-6) return pad;
      }
      return -1;
    };
    expect(slow.slice(0, shared).map(padIndex)).toEqual(quick.slice(0, shared).map(padIndex));
  });

  it('cannot tell which seat was asked first', () => {
    // A stream each. Sharing one and drawing a constant number of values per decision still
    // hands the earlier value to whichever seat is polled first; with a stream each the poll
    // order is not observable at all, and the reversed run is bit-identical.
    for (const tier of TIERS) {
      for (let seed = 0; seed < 12; seed += 1) {
        const forwards = playMatch(tier, tier, 300 + seed, ['p1', 'p2']);
        const backwards = playMatch(tier, tier, 300 + seed, ['p2', 'p1']);
        expect(backwards.frames).toBe(forwards.frames);
        expect(JSON.stringify(backwards.game)).toBe(JSON.stringify(forwards.game));
      }
    }
  });

  it('stays an exact mirror of itself when both seats are dealt the same stream', () => {
    /*
     * The strongest seat-fairness statement available, and it is structural rather than
     * statistical: give both seats the *same* bot stream and the two tanks must remain exact
     * mirror images through the centre of the yard for the whole match, and the match must
     * be a draw. Anything in `step` that could tell the seats apart shows up here as a
     * divergence, where a win-rate measurement would need thousands of matches to see it.
     */
    for (const tier of TIERS) {
      for (let seed = 0; seed < 6; seed += 1) {
        const seeds = new Rng(4000 + seed * 13);
        const world = new Rng(seeds.next() | 0);
        const shared = seeds.next() | 0;
        const bots: Record<SeatId, Rng> = { p1: new Rng(shared), p2: new Rng(shared) };
        const game = createGame();
        resetGame(game, world);
        const states: Record<SeatId, BotState> = { p1: createBotState(), p2: createBotState() };
        const intent: Intent = { turn: 0, throttle: 0 };
        let worst = 0;
        while (game.winner === null) {
          for (const seat of SEATS) {
            botIntent(game, seat, tier, states[seat], bots[seat], STEP, intent);
            setIntent(game, seat, intent.turn, intent.throttle);
          }
          step(game, STEP, world);
          worst = Math.max(
            worst,
            Math.abs(game.p1.x - mirrorX(game.p2.x)),
            Math.abs(game.p1.y - mirrorY(game.p2.y)),
          );
        }
        expect(worst, `${tier} seed ${String(seed)} departed from the mirror`).toBeLessThan(1e-6);
        expect(winnerOf(game)).toBe('draw');
      }
    }
  });

  it('splits evenly against itself', () => {
    /*
     * Six hundred seeds a tier here; the figures in SPEC.md are 4000 a tier over three
     * independent seed bases, because a shared arena is where a small asymmetry compounds
     * and 400 is not enough to see it — the brief for this game names a case where 400 read
     * 56 per cent on something that was really 51.
     */
    for (const tier of TIERS) {
      const wins = series(tier, tier, 600);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(560);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.45,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.55);
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = series(strong, weak, 150, 5001);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 1.5);
      const asP2 = series(weak, strong, 150, 5001);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 1.5);
    }
  });
});

describe('determinism', () => {
  it('replays a fixed script to the identical final state', () => {
    const play = (): string => {
      const game = started(20260823);
      const rng = new Rng(20260823);
      const script = new Rng(77);
      for (let i = 0; i < 60 * 200 && game.winner === null; i += 1) {
        setIntent(
          game,
          'p1',
          Math.round(script.float() * 2 - 1),
          Math.round(script.float() * 2 - 1),
        );
        setIntent(
          game,
          'p2',
          Math.round(script.float() * 2 - 1),
          Math.round(script.float() * 2 - 1),
        );
        step(game, STEP, rng);
      }
      return JSON.stringify(game);
    };
    expect(play()).toBe(play());
  });

  it('deals a different yard from a different seed', () => {
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      layouts.add(
        started(seed)
          .crates.map((crate) => `${crate.x},${crate.y}`)
          .sort()
          .join('|'),
      );
    }
    expect(layouts.size).toBeGreaterThan(20);
  });

  it('ends level when both seats are given the same orders', () => {
    // The plainest statement of the shared arena: two tanks driven identically, from
    // mirrored pads, cannot separate.
    const game = started(31);
    const rng = new Rng(31);
    const script = new Rng(13);
    for (let i = 0; i < 60 * 200 && game.winner === null; i += 1) {
      const turn = Math.round(script.float() * 2 - 1);
      const throttle = Math.round(script.float() * 2 - 1);
      setIntent(game, 'p1', turn, throttle);
      setIntent(game, 'p2', turn, throttle);
      step(game, STEP, rng);
      expect(game.p1.x).toBeCloseTo(mirrorX(game.p2.x), 6);
      expect(game.p1.y).toBeCloseTo(mirrorY(game.p2.y), 6);
    }
    expect(winnerOf(game)).toBe('draw');
  });
});
