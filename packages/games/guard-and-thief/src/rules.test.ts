import { describe, expect, it } from 'vitest';
import { Rng, envelopeFor } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { manifest } from './manifest.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  CATCH_RADIUS,
  CENTRE_Y,
  COINS_LOOSE,
  COIN_RADIUS,
  COIN_SEPARATION,
  DRAG_DEADZONE,
  DRAG_LEASH,
  FLASH_SECONDS,
  GUARD_SPEED,
  HEADINGS,
  LOOKAHEAD,
  MATCH_SECONDS,
  PICKUP_RADIUS,
  PURSUIT_SLACK,
  RESPAWN_SECONDS,
  RUNNER_RADIUS,
  SEATS,
  SPAWN_SPOTS,
  THIEF_SPEED,
  VAULT_FAR,
  VAULT_INSET_X,
  VAULT_NEAR,
  atHome,
  botStep,
  canCatch,
  chooseHeading,
  clamp,
  createBotState,
  createCommand,
  createGame,
  homeX,
  homeY,
  maxX,
  maxY,
  minX,
  minY,
  otherOf,
  ownDepth,
  raidedVault,
  resetBotState,
  resetGame,
  runnerOf,
  seatAxisSign,
  sideOf,
  step,
  winnerOf,
} from './rules.js';
import type {
  BotDifficulty,
  BotProfile,
  BotState,
  Coin,
  Command,
  Game,
  Runner,
  Side,
  Spot,
} from './rules.js';

const STEP = 1 / 60;

function fresh(seed: number): Game {
  const game = createGame();
  resetGame(game, new Rng(seed));
  return game;
}

function still(): Command {
  return { dirX: 0, dirY: 0 };
}

function run(x: number, y: number): Command {
  if (x !== 0 && y !== 0) return { dirX: x * Math.SQRT1_2, dirY: y * Math.SQRT1_2 };
  return { dirX: x, dirY: y };
}

/** Clear every coin off both floors, so a test can place exactly what it means to test. */
function clearVaults(game: Game): void {
  for (let i = 0; i < SEATS.length; i += 1) {
    const vault = sideOf(game, SEATS[i] as SeatId).vault;
    for (let c = 0; c < vault.length; c += 1) {
      const coin = vault[c] as Coin;
      coin.active = false;
      coin.delay = MATCH_SECONDS * 2;
    }
  }
}

function place(runner: Runner, x: number, y: number, seat: SeatId): void {
  runner.x = x;
  runner.y = y;
  runner.prevX = x;
  runner.prevY = y;
  runner.home = atHome(seat, y);
}

/* ------------------------------------------------------------------------------------ */
/* The board                                                                             */
/* ------------------------------------------------------------------------------------ */

describe('the board', () => {
  it('is its own half-turn image', () => {
    expect(homeX()).toBe(BOARD_WIDTH - homeX());
    expect(homeY('p1')).toBe(BOARD_HEIGHT - homeY('p2'));
    expect(minX()).toBe(BOARD_WIDTH - maxX());
    expect(minY()).toBe(BOARD_HEIGHT - maxY());
    expect(CENTRE_Y).toBe(BOARD_HEIGHT / 2);
    expect(seatAxisSign('p1')).toBe(-seatAxisSign('p2'));
  });

  it('puts both starting runners on their own floor at mirror-image points', () => {
    const game = fresh(1);
    expect(atHome('p1', game.p1.runner.y)).toBe(true);
    expect(atHome('p2', game.p2.runner.y)).toBe(true);
    expect(game.p1.runner.x).toBe(BOARD_WIDTH - game.p2.runner.x);
    expect(game.p1.runner.y).toBe(BOARD_HEIGHT - game.p2.runner.y);
  });

  it('reads the two roles from one quantity that the half-turn leaves alone', () => {
    // The whole fairness argument in one assertion. `ownDepth` is written in the seat's own
    // frame, so a point and its mirror image give the same number for the two seats — which
    // is why they can never disagree about who is the guard, including on the door itself.
    for (let i = 0; i <= 1000; i += 1) {
      const y = i;
      expect(ownDepth('p2', BOARD_HEIGHT - y)).toBeCloseTo(ownDepth('p1', y), 9);
    }
    expect(ownDepth('p1', CENTRE_Y)).toBe(0);
    expect(ownDepth('p2', CENTRE_Y)).toBe(-0);
    // On the door exactly, neither seat is home, and both agree about it.
    expect(atHome('p1', CENTRE_Y)).toBe(false);
    expect(atHome('p2', CENTRE_Y)).toBe(false);
  });
});

describe('the restock cycle', () => {
  it('sets out the same floor in both vaults, mirrored, whatever the seed', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const game = fresh(seed * 977 + 13);
      for (let i = 0; i < COINS_LOOSE; i += 1) {
        const a = game.p1.vault[i] as Coin;
        const b = game.p2.vault[i] as Coin;
        expect(b.active).toBe(a.active);
        expect(b.x).toBeCloseTo(BOARD_WIDTH - a.x, 9);
        expect(b.y).toBeCloseTo(BOARD_HEIGHT - a.y, 9);
      }
    }
  });

  it('keeps every coin inside its own vault and clear of the door', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const game = fresh(seed * 613 + 5);
      for (let i = 0; i < SPAWN_SPOTS; i += 1) {
        const spot = game.spots[i] as Spot;
        expect(spot.x).toBeGreaterThanOrEqual(VAULT_INSET_X);
        expect(spot.x).toBeLessThanOrEqual(BOARD_WIDTH - VAULT_INSET_X);
        expect(spot.y).toBeGreaterThanOrEqual(CENTRE_Y + VAULT_NEAR);
        expect(spot.y).toBeLessThanOrEqual(CENTRE_Y + VAULT_FAR);
      }
    }
  });

  it('never sets two coins out on top of one another', () => {
    // The cycle keeps each place clear of the last COINS_LOOSE, so the five that are out
    // together are spread by arithmetic rather than by a loop that might not converge.
    let worst = Infinity;
    for (let seed = 0; seed < 120; seed += 1) {
      const game = fresh(seed * 761 + 3);
      for (let i = COINS_LOOSE; i < SPAWN_SPOTS; i += 1) {
        const here = game.spots[i] as Spot;
        for (let back = 1; back <= COINS_LOOSE; back += 1) {
          const other = game.spots[i - back] as Spot;
          worst = Math.min(worst, Math.hypot(here.x - other.x, here.y - other.y));
        }
      }
    }
    // Bounded at ten attempts and settling for the best it saw, so this is a measurement
    // rather than a guarantee — but two coins never merge, which needs 2 * COIN_RADIUS.
    expect(worst).toBeGreaterThan(COIN_RADIUS * 2);
    expect(worst).toBeGreaterThan(COIN_SEPARATION * 0.35);
  });

  it('sets a taken coin out again after the delay and never before it', () => {
    const game = fresh(7);
    const coin = game.p2.vault[0] as Coin;
    coin.active = false;
    coin.delay = RESPAWN_SECONDS;
    const before = game.p2.cursor;
    let waited = -1;
    for (let i = 1; i <= Math.ceil(RESPAWN_SECONDS * 60) + 2; i += 1) {
      step(game, STEP, still(), still());
      if (waited < 0 && game.p2.vault[0]?.active === true) waited = i;
    }
    expect(waited).toBeGreaterThanOrEqual(RESPAWN_SECONDS * 60);
    expect(waited).toBeLessThanOrEqual(RESPAWN_SECONDS * 60 + 2);
    expect(game.p2.cursor).toBe((before + 1) % SPAWN_SPOTS);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The two roles                                                                         */
/* ------------------------------------------------------------------------------------ */

describe('the two roles', () => {
  it('runs a guard faster than a thief, and the rule is the floor rather than the seat', () => {
    expect(GUARD_SPEED).toBeGreaterThan(THIEF_SPEED);
    for (const seat of SEATS) {
      const game = fresh(11);
      clearVaults(game);
      const me = runnerOf(game, seat);
      const sign = seatAxisSign(seat);
      place(me, homeX(), CENTRE_Y + sign * 200, seat);
      step(game, STEP, seat === 'p1' ? run(1, 0) : still(), seat === 'p2' ? run(1, 0) : still());
      expect(Math.abs(me.x - homeX())).toBeCloseTo(GUARD_SPEED * STEP, 9);

      place(me, homeX(), CENTRE_Y - sign * 200, seat);
      step(game, STEP, seat === 'p1' ? run(1, 0) : still(), seat === 'p2' ? run(1, 0) : still());
      expect(Math.abs(me.x - homeX())).toBeCloseTo(THIEF_SPEED * STEP, 9);
    }
  });

  it('lets a thief lift a coin and refuses a guard the same coin', () => {
    for (const seat of SEATS) {
      const foe = otherOf(seat);
      const game = fresh(13);
      clearVaults(game);
      const coin = raidedVault(game, seat)[0] as Coin;
      const sign = seatAxisSign(foe);
      coin.active = true;
      coin.x = homeX();
      coin.y = CENTRE_Y + sign * 200;

      // The owner of that floor is standing on the coin and may not touch it.
      const owner = runnerOf(game, foe);
      place(owner, coin.x, coin.y, foe);
      step(game, STEP, still(), still());
      expect(owner.carry).toBe(0);
      expect(coin.active).toBe(true);

      // The visitor takes it.
      place(owner, homeX(), homeY(foe), foe);
      const thief = runnerOf(game, seat);
      place(thief, coin.x, coin.y, seat);
      step(game, STEP, still(), still());
      expect(thief.carry).toBe(1);
      expect(coin.active).toBe(false);
    }
  });

  it('banks what a thief is carrying the moment it comes back through its own door', () => {
    for (const seat of SEATS) {
      const game = fresh(17);
      clearVaults(game);
      const me = runnerOf(game, seat);
      const sign = seatAxisSign(seat);
      place(me, homeX(), CENTRE_Y - sign * 2, seat);
      me.carry = 3;
      expect(me.home).toBe(false);
      // Toward home is `sign` on the y axis for either seat: p1's own floor is the larger
      // y and p2's is the smaller, which is the whole content of `seatAxisSign`.
      step(game, STEP, run(0, sign), run(0, sign));
      expect(me.home).toBe(true);
      expect(me.bank).toBe(3);
      expect(me.carry).toBe(0);
      // And banking is a transition, not a state: standing at home banks nothing more.
      me.carry = 2;
      step(game, STEP, still(), still());
      expect(me.bank).toBe(3);
      expect(me.carry).toBe(2);
    }
  });

  it('counts a raid on the way out and not on the way back', () => {
    const game = fresh(19);
    clearVaults(game);
    const me = game.p1.runner;
    place(me, homeX(), CENTRE_Y + 2, 'p1');
    expect(me.raids).toBe(0);
    step(game, STEP, run(0, -1), still());
    expect(me.raids).toBe(1);
    step(game, STEP, run(0, 1), still());
    expect(me.raids).toBe(1);
  });

  it('cannot disagree with itself about which side a coin was lifted on', () => {
    // The pickup is gated on the side the runner *ends* the step on. That is exact rather
    // than approximate only because no coin lies within VAULT_NEAR of the door and no
    // runner covers more than GUARD_SPEED * dt in a step — so the two questions cannot
    // differ at any step rate the loop will ever be run at. This is that margin.
    const slowestPlausibleStepRate = 10;
    expect(VAULT_NEAR).toBeGreaterThan(
      GUARD_SPEED / slowestPlausibleStepRate + RUNNER_RADIUS + COIN_RADIUS,
    );
  });
});

/* ------------------------------------------------------------------------------------ */
/* The catch                                                                             */
/* ------------------------------------------------------------------------------------ */

/** Put the two runners at `(x, y)` and one step apart, and see what the step decides. */
function meeting(y1: number, y2: number): Game {
  const game = fresh(23);
  clearVaults(game);
  place(game.p1.runner, homeX(), y1, 'p1');
  place(game.p2.runner, homeX(), y2, 'p2');
  return game;
}

describe('the catch', () => {
  it('is taken by whichever runner is standing on its own floor', () => {
    for (const seat of SEATS) {
      const thiefSeat = otherOf(seat);
      const sign = seatAxisSign(seat);
      const y = CENTRE_Y + sign * 200;
      const game = seat === 'p1' ? meeting(y, y) : meeting(y, y);
      const guard = runnerOf(game, seat);
      const thief = runnerOf(game, thiefSeat);
      thief.carry = 4;
      step(game, STEP, still(), still());
      expect(guard.bank).toBe(4);
      expect(guard.catches).toBe(1);
      expect(thief.carry).toBe(0);
      expect(thief.losses).toBe(1);
      expect(thief.x).toBe(homeX());
      expect(thief.y).toBe(homeY(thiefSeat));
      expect(thief.home).toBe(true);
      expect(guard.flash).toBeGreaterThan(0);
    }
  });

  it('does nothing when the two meet across the door', () => {
    // Both home: neither is trespassing. Both away: there is no guard present. Both are the
    // same statement — `aHome === bHome` — which is what makes it symmetric.
    const bothHome = meeting(CENTRE_Y + 15, CENTRE_Y - 15);
    bothHome.p1.runner.carry = 3;
    bothHome.p2.runner.carry = 3;
    step(bothHome, STEP, still(), still());
    expect(bothHome.p1.runner.catches + bothHome.p2.runner.catches).toBe(0);
    expect(bothHome.p1.runner.carry).toBe(3);

    const bothAway = meeting(CENTRE_Y - 15, CENTRE_Y + 15);
    bothAway.p1.runner.carry = 3;
    bothAway.p2.runner.carry = 3;
    step(bothAway, STEP, still(), still());
    expect(bothAway.p1.runner.catches + bothAway.p2.runner.catches).toBe(0);
    expect(bothAway.p1.runner.carry).toBe(3);
  });

  it('does nothing when the two are standing on the door itself', () => {
    const game = meeting(CENTRE_Y, CENTRE_Y);
    game.p1.runner.carry = 2;
    game.p2.runner.carry = 2;
    step(game, STEP, still(), still());
    expect(game.p1.runner.catches + game.p2.runner.catches).toBe(0);
  });

  it('takes nothing off a thief with empty hands, and still costs it the trip', () => {
    const game = meeting(CENTRE_Y + 200, CENTRE_Y + 200);
    step(game, STEP, still(), still());
    expect(game.p1.runner.bank).toBe(0);
    expect(game.p1.runner.catches).toBe(1);
    expect(game.p2.runner.y).toBe(homeY('p2'));
  });

  it('never repeats on the next step, because the thief is put out at the far end', () => {
    const game = meeting(CENTRE_Y + 200, CENTRE_Y + 200);
    for (let i = 0; i < 40; i += 1) step(game, STEP, still(), still());
    expect(game.p1.runner.catches).toBe(1);
  });

  it('cannot be tunnelled through at any step rate, and here is the arithmetic', () => {
    // Two runners closing head-on cover GUARD_SPEED + THIEF_SPEED between them. Passing
    // *through* a catch needs the pair to start more than CATCH_RADIUS apart and end more
    // than CATCH_RADIUS apart on the far side, which needs a step longer than twice the
    // radius — 8 Hz here, four times slower than anything the loop is run at.
    const eightHz = (GUARD_SPEED + THIEF_SPEED) / 8;
    expect(eightHz).toBeLessThan(CATCH_RADIUS * 2);
  });

  it('is settled at the moment of contact, not at the end of the step', () => {
    // Which is what the sweep is actually for here, and it is observable: a thief that is
    // caught *and then crosses its own door inside the same step* is caught. Sampling the
    // two ends of the step instead would find both runners at home and let it go.
    const game = fresh(29);
    clearVaults(game);
    const guard = game.p1.runner;
    const thief = game.p2.runner;
    place(guard, homeX(), CENTRE_Y + 45, 'p1');
    place(thief, homeX(), CENTRE_Y + 8, 'p2');
    thief.carry = 5;
    const slow = 1 / 8;
    step(game, slow, run(0, -1), run(0, -1));
    // The thief did end the step on its own floor, which is what a sampled test would see.
    expect(atHome('p2', CENTRE_Y + 8 - THIEF_SPEED * slow)).toBe(true);
    expect(guard.catches).toBe(1);
    expect(guard.bank).toBe(5);
    expect(thief.y).toBe(homeY('p2'));
  });

  it('draws its reach at the radius the rule uses', () => {
    expect(CATCH_RADIUS).toBe(RUNNER_RADIUS * 2);
    expect(PICKUP_RADIUS).toBe(RUNNER_RADIUS + COIN_RADIUS);
  });
});

/* ------------------------------------------------------------------------------------ */
/* Determinism                                                                           */
/* ------------------------------------------------------------------------------------ */

function playBots(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  swapStreams = false,
): { winner: SeatId | 'draw' | null; p1: number; p2: number; steps: number } {
  const game = createGame();
  resetGame(game, new Rng(seed));
  const s1 = createBotState();
  const s2 = createBotState();
  const a = new Rng((seed * 2654435761) | 0);
  const b = new Rng((seed * 40503 + 11) | 0);
  const r1 = swapStreams ? b : a;
  const r2 = swapStreams ? a : b;
  const c1 = createCommand();
  const c2 = createCommand();
  let steps = 0;
  while (game.winner === null && steps < 60 * 600) {
    botStep(game, 'p1', BOT_PROFILES[p1Tier], s1, r1, STEP, c1);
    botStep(game, 'p2', BOT_PROFILES[p2Tier], s2, r2, STEP, c2);
    step(game, STEP, c1, c2);
    steps += 1;
  }
  return { winner: game.winner, p1: game.p1.runner.bank, p2: game.p2.runner.bank, steps };
}

describe('determinism', () => {
  it('plays the identical match from the identical seed', () => {
    expect(playBots(4242, 'normal', 'hard')).toEqual(playBots(4242, 'normal', 'hard'));
  });

  it('survives a round trip through JSON, which is what a replay would do', () => {
    const game = fresh(99);
    const c = run(1, -1);
    for (let i = 0; i < 200; i += 1) step(game, STEP, c, c);
    const copy = JSON.parse(JSON.stringify(game)) as Game;
    expect(copy).toEqual(game);
    for (let i = 0; i < 300; i += 1) {
      step(game, STEP, c, c);
      step(copy, STEP, c, c);
    }
    expect(copy).toEqual(game);
  });

  it('draws the same number of values per decision whatever the board looks like', () => {
    // The count can never depend on the position, so two bots on the same tier stay in step
    // with their own generators however differently their matches go.
    const profile = BOT_PROFILES.hard;
    const out = createCommand();
    for (const seed of [1, 2, 3]) {
      const game = fresh(seed);
      const state = createBotState();
      const rng = new Rng(7);
      const shadow = new Rng(7);
      let decisions = 0;
      for (let i = 0; i < 600; i += 1) {
        const cooldown = state.cooldown;
        botStep(game, 'p1', profile, state, rng, STEP, out);
        if (cooldown - STEP <= 0) decisions += 1;
        step(game, STEP, out, still());
      }
      for (let i = 0; i < decisions * BOT_DRAWS_PER_DECISION; i += 1) shadow.float();
      // Both generators are now the same number of draws in, whatever the board did.
      expect(rng.float()).toBe(shadow.float());
      expect(decisions).toBeGreaterThan(10);
    }
  });
});

/* ------------------------------------------------------------------------------------ */
/* Half-turn covariance                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * The board turned over, with the seats changing places.
 *
 * This is the test Snowball Throw's SPEC records as the most valuable in its package: two
 * defects, each worth double figures of win rate to seat one, that no other test in the
 * repository could see. A game that is wrong in exactly the same way for both seats is
 * still self-consistent, so nothing but this finds them.
 */
function mirrorRunner(from: Readonly<Runner>, to: Runner): void {
  to.x = BOARD_WIDTH - from.x;
  to.y = BOARD_HEIGHT - from.y;
  to.prevX = BOARD_WIDTH - from.prevX;
  to.prevY = BOARD_HEIGHT - from.prevY;
  to.faceX = -from.faceX;
  to.faceY = -from.faceY;
  to.carry = from.carry;
  to.bank = from.bank;
  to.catches = from.catches;
  to.losses = from.losses;
  to.raids = from.raids;
  to.home = from.home;
  to.flash = from.flash;
}

function mirrorSide(from: Readonly<Side>, to: Side): void {
  to.cursor = from.cursor;
  mirrorRunner(from.runner, to.runner);
  for (let i = 0; i < from.vault.length; i += 1) {
    const a = from.vault[i] as Coin;
    const b = to.vault[i] as Coin;
    b.active = a.active;
    b.delay = a.delay;
    b.x = BOARD_WIDTH - a.x;
    b.y = BOARD_HEIGHT - a.y;
  }
}

function mirrorInto(from: Readonly<Game>, to: Game): void {
  to.clock = from.clock;
  to.winner = from.winner === 'p1' ? 'p2' : from.winner === 'p2' ? 'p1' : from.winner;
  // The restock cycle is written in seat one's frame and read by each vault through its own
  // half-turn, so turning the board over leaves the list itself alone.
  for (let i = 0; i < from.spots.length; i += 1) {
    const a = from.spots[i] as Spot;
    const b = to.spots[i] as Spot;
    b.x = a.x;
    b.y = a.y;
  }
  mirrorSide(from.p2, to.p1);
  mirrorSide(from.p1, to.p2);
}

/** Everything a step can touch, to six decimals. Slot order is meaningful and compared. */
function describeGame(game: Readonly<Game>): string {
  const six = (v: number): string => v.toFixed(6);
  const runner = (r: Readonly<Runner>): string =>
    [
      six(r.x),
      six(r.y),
      six(r.prevX),
      six(r.prevY),
      six(r.faceX),
      six(r.faceY),
      String(r.carry),
      String(r.bank),
      String(r.catches),
      String(r.losses),
      String(r.raids),
      String(r.home),
      six(r.flash),
    ].join('/');
  const side = (s: Readonly<Side>): string =>
    [
      runner(s.runner),
      String(s.cursor),
      s.vault.map((c) => `${String(c.active)}:${six(c.x)},${six(c.y)},${six(c.delay)}`).join(' '),
    ].join('|');
  return [side(game.p1), side(game.p2), six(game.clock), String(game.winner)].join('#');
}

/**
 * An arbitrary but legal board: any state the game could ever hold.
 *
 * Runners are scrambled onto a lattice **that includes the door exactly**, because
 * `y === CENTRE_Y` is the one threshold in this game that a state variable can land on by
 * construction rather than by coincidence, and it is the family Frozen Beaks' hole rim and
 * Snowball Throw's ball age both belong to. It has to be an everyday event in the sample
 * rather than a measure-zero one.
 */
function scramble(game: Game, rng: Rng): void {
  game.clock = 1 + rng.float() * (MATCH_SECONDS - 1);
  for (let i = 0; i < SEATS.length; i += 1) {
    const seat = SEATS[i] as SeatId;
    const side = sideOf(game, seat);
    const runner = side.runner;
    const sign = seatAxisSign(seat);
    runner.x = clamp(homeX() + rng.int(-130, 131) * 2, minX(), maxX());
    // Two units either side of the door and every 20 units away from it, so both the
    // knife edge and ordinary positions are covered.
    const depth = rng.int(-23, 24) * 20;
    runner.y = clamp(CENTRE_Y + sign * depth, minY(), maxY());
    runner.prevX = runner.x;
    runner.prevY = runner.y;
    const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
    runner.faceX = heading.x * sign;
    runner.faceY = heading.y * sign;
    runner.carry = rng.int(0, 8);
    runner.bank = rng.int(0, 40);
    runner.catches = rng.int(0, 9);
    runner.losses = rng.int(0, 9);
    runner.raids = rng.int(0, 20);
    runner.home = atHome(seat, runner.y);
    runner.flash = rng.int(0, 16) * 0.05;
    side.cursor = rng.int(0, SPAWN_SPOTS);
    for (let c = 0; c < side.vault.length; c += 1) {
      const coin = side.vault[c] as Coin;
      coin.active = rng.bool(0.8);
      coin.delay = coin.active ? 0 : rng.int(0, 20) * 0.05;
      coin.x = VAULT_INSET_X + rng.int(0, 47) * 10;
      coin.y = CENTRE_Y + sign * (VAULT_NEAR + rng.int(0, 29) * 10);
      if (seat === 'p2') coin.x = BOARD_WIDTH - coin.x;
    }
  }
}

function randomHeading(rng: Rng, seat: SeatId): Command {
  if (rng.bool(0.15)) return still();
  const heading = HEADINGS[rng.int(0, HEADINGS.length)] as { x: number; y: number };
  const sign = seatAxisSign(seat);
  return { dirX: heading.x * sign, dirY: heading.y * sign };
}

describe('the half-turn', () => {
  it('steps a mirrored board to the mirror of the stepped board', () => {
    const rng = new Rng(20260829);
    const game = createGame();
    const other = createGame();
    const expected = createGame();
    for (let trial = 0; trial < 500; trial += 1) {
      resetGame(game, new Rng(trial * 131 + 7));
      scramble(game, rng);
      mirrorInto(game, other);
      const a = randomHeading(rng, 'p1');
      const b = randomHeading(rng, 'p2');
      step(game, STEP, a, b);
      step(other, STEP, { dirX: -b.dirX, dirY: -b.dirY }, { dirX: -a.dirX, dirY: -a.dirY });
      mirrorInto(game, expected);
      expect(describeGame(other), `trial ${String(trial)}`).toBe(describeGame(expected));
    }
  });

  it('makes a bot want the mirrored thing on a mirrored board', () => {
    const rng = new Rng(31337);
    const game = createGame();
    const other = createGame();
    const tiers = Object.keys(BOT_PROFILES) as BotDifficulty[];
    for (const tier of tiers) {
      const profile = BOT_PROFILES[tier];
      for (let trial = 0; trial < 400; trial += 1) {
        resetGame(game, new Rng(trial * 197 + 3));
        scramble(game, rng);
        mirrorInto(game, other);
        const here = createBotState();
        const there = createBotState();
        const chasing = rng.bool(0.4);
        here.chasing = chasing;
        there.chasing = chasing;

        expect(canCatch(game, 'p1', PURSUIT_SLACK), `${tier} ${String(trial)}`).toBe(
          canCatch(other, 'p2', PURSUIT_SLACK),
        );
        chooseHeading(game, 'p1', profile, here);
        chooseHeading(other, 'p2', profile, there);
        expect(here.wantX, `${tier} trial ${String(trial)} x`).toBeCloseTo(-there.wantX, 12);
        expect(here.wantY, `${tier} trial ${String(trial)} y`).toBeCloseTo(-there.wantY, 12);
        expect(here.coin, `${tier} trial ${String(trial)} coin`).toBe(there.coin);
        expect(here.chasing, `${tier} trial ${String(trial)} chasing`).toBe(there.chasing);
      }
    }
  });

  it('gives two mirror-image runners a bit-identical crossing of the door', () => {
    // The knife edge: `home` is compared against a threshold the two seats approach from
    // opposite ends of the board. It is counted from a quantity written in the seat's own
    // frame, never derived from a board coordinate, so both land on the same side of it.
    const game = fresh(8080);
    clearVaults(game);
    place(game.p1.runner, 120, maxY(), 'p1');
    place(game.p2.runner, BOARD_WIDTH - 120, minY(), 'p2');
    for (let i = 0; i < 600; i += 1) {
      step(game, STEP, run(0, -1), run(0, 1));
      expect(game.p1.runner.home).toBe(game.p2.runner.home);
      expect(ownDepth('p1', game.p1.runner.y)).toBeCloseTo(ownDepth('p2', game.p2.runner.y), 9);
    }
  });

  it('plays a whole mirrored match to the mirrored result', () => {
    // End to end rather than argued, which is what finally separated "the game is
    // asymmetric" from "the sample is small" in Snowball Throw. Every match is played
    // against its own mirror — the two seats' generators exchanged — and the two results
    // compared.
    let flipped = 0;
    let mismatched = 0;
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const tier of tiers) {
      for (let seed = 0; seed < 40; seed += 1) {
        const forward = playBots(seed * 3571 + 1, tier, tier, false);
        const backward = playBots(seed * 3571 + 1, tier, tier, true);
        const expectedWinner =
          forward.winner === 'p1' ? 'p2' : forward.winner === 'p2' ? 'p1' : forward.winner;
        if (backward.winner !== expectedWinner) flipped += 1;
        if (backward.p1 !== forward.p2 || backward.p2 !== forward.p1) mismatched += 1;
      }
    }
    // A runner's position still accumulates from opposite ends of the board and always
    // will, so a match can in principle part company on the last bits of some comparison.
    // Measured over 120 mirrored matches at three tiers: none did.
    expect(flipped).toBe(0);
    expect(mismatched).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The end of a match                                                                    */
/* ------------------------------------------------------------------------------------ */

describe('the end of a match', () => {
  it('advertises the clock it actually runs', () => {
    // `roundSeconds` ends nothing — it is text on a catalogue card — so these two are only
    // equal because somebody keeps them equal.
    expect(manifest.roundSeconds).toBe(MATCH_SECONDS);
  });

  it('ends on the whistle and on nothing else, with no step cap at all', () => {
    // Deliberately unbounded. A match that could not finish would hang the suite rather
    // than pass quietly, which is the only way this assertion means anything.
    const game = fresh(4001);
    let steps = 0;
    while (winnerOf(game) === null) {
      step(game, STEP, still(), still());
      steps += 1;
    }
    // 3600 steps of a sixtieth, plus at most one: a sixtieth is not exactly representable
    // and the clock is counted down rather than up, so the residue is a few times 1e-14.
    expect(steps).toBeGreaterThanOrEqual(Math.floor(MATCH_SECONDS / STEP));
    expect(steps).toBeLessThanOrEqual(Math.ceil(MATCH_SECONDS / STEP) + 1);
    expect(winnerOf(game)).toBe('draw');
  });

  it('ends after the same simulated time at any step rate', () => {
    for (const hz of [30, 60, 120, 240]) {
      const game = fresh(4002);
      let elapsed = 0;
      while (winnerOf(game) === null) {
        step(game, 1 / hz, still(), still());
        elapsed += 1 / hz;
      }
      expect(elapsed).toBeGreaterThanOrEqual(MATCH_SECONDS);
      expect(elapsed).toBeLessThan(MATCH_SECONDS + 2 / hz);
    }
  });

  it('is won by whoever banked more, and carried loot never counts', () => {
    const game = fresh(4003);
    game.clock = STEP / 2;
    game.p1.runner.bank = 9;
    game.p1.runner.carry = 0;
    game.p2.runner.bank = 8;
    game.p2.runner.carry = 40;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('p1');
  });

  it('is settled on catches when the two are level on coins', () => {
    const game = fresh(4004);
    game.clock = STEP / 2;
    game.p1.runner.bank = 12;
    game.p2.runner.bank = 12;
    game.p2.runner.catches = 3;
    game.p1.runner.catches = 1;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('p2');
  });

  it('is an honest draw when the two are level on both', () => {
    const game = fresh(4005);
    game.clock = STEP / 2;
    game.p1.runner.bank = 12;
    game.p2.runner.bank = 12;
    game.p1.runner.catches = 2;
    game.p2.runner.catches = 2;
    step(game, STEP, still(), still());
    expect(winnerOf(game)).toBe('draw');
  });

  it('stops stepping once it has been decided', () => {
    const game = fresh(4006);
    game.clock = 0;
    step(game, STEP, still(), still());
    const settled = describeGame(game);
    for (let i = 0; i < 50; i += 1) step(game, STEP, run(1, 0), run(1, 0));
    expect(describeGame(game)).toBe(settled);
  });
});

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

describe('the bot', () => {
  it('steers only where a person could steer', () => {
    const allowed = new Set<string>(['0,0']);
    for (const heading of HEADINGS) {
      allowed.add(`${heading.x.toFixed(12)},${heading.y.toFixed(12)}`);
      allowed.add(`${(-heading.x).toFixed(12)},${(-heading.y).toFixed(12)}`);
    }
    const out = createCommand();
    const tiers = Object.keys(BOT_PROFILES) as BotDifficulty[];
    for (const tier of tiers) {
      for (const seat of SEATS) {
        const game = fresh(51);
        const state = createBotState();
        const rng = new Rng(9);
        for (let i = 0; i < 1200; i += 1) {
          botStep(game, seat, BOT_PROFILES[tier], state, rng, STEP, out);
          const key =
            out.dirX === 0 && out.dirY === 0
              ? '0,0'
              : `${out.dirX.toFixed(12)},${out.dirY.toFixed(12)}`;
          expect(allowed.has(key), `${tier} ${seat} produced ${key}`).toBe(true);
          step(game, STEP, seat === 'p1' ? out : still(), seat === 'p2' ? out : still());
        }
      }
    }
  });

  it('never sees anything a player cannot', () => {
    // Everything the bot reads is drawn: both runners, every loose coin, and how much each
    // runner is carrying. This asserts the shape of that claim — `chooseHeading` is handed
    // a `Readonly<Game>` and writes nothing into it.
    const game = fresh(53);
    const before = JSON.stringify(game);
    const state = createBotState();
    chooseHeading(game, 'p1', BOT_PROFILES.hard, state);
    expect(JSON.stringify(game)).toBe(before);
  });

  it('climbs its own ladder from both seat orders', () => {
    // A cheap version of the table in SPEC.md, which was taken at 400 seeds a row. What
    // this catches is an inversion, not a drift.
    const rate = (strong: BotDifficulty, weak: BotDifficulty): number => {
      let wins = 0;
      let decided = 0;
      for (let seed = 0; seed < 30; seed += 1) {
        const asP1 = playBots(seed * 7919 + 1, strong, weak);
        if (asP1.winner === 'p1') wins += 1;
        if (asP1.winner !== 'draw' && asP1.winner !== null) decided += 1;
        const asP2 = playBots(seed * 7919 + 1, weak, strong);
        if (asP2.winner === 'p2') wins += 1;
        if (asP2.winner !== 'draw' && asP2.winner !== null) decided += 1;
      }
      return wins / decided;
    };
    const hardOverNormal = rate('hard', 'normal');
    const normalOverEasy = rate('normal', 'easy');
    const hardOverEasy = rate('hard', 'easy');
    expect(hardOverNormal).toBeGreaterThan(0.55);
    expect(normalOverEasy).toBeGreaterThan(0.55);
    expect(hardOverEasy).toBeGreaterThan(hardOverNormal);
    expect(hardOverEasy).toBeGreaterThan(normalOverEasy);
  });

  it('splits equal tiers exactly down the middle, board by board', () => {
    // Not a measurement: exchanging the two seats' generators plays the exact mirror of
    // the same match, so the pair decides both seats once. Seat one's share of a paired
    // sample is 50.0% by construction, and this asserts it seed by seed rather than in
    // aggregate — an aggregate 50% can hide two errors that cancel.
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const tier of tiers) {
      let seatOne = 0;
      let decided = 0;
      for (let seed = 0; seed < 40; seed += 1) {
        const a = playBots(seed * 104729 + 3, tier, tier, false);
        const b = playBots(seed * 104729 + 3, tier, tier, true);
        expect(b.p1, `${tier} seed ${String(seed)}`).toBe(a.p2);
        expect(b.p2, `${tier} seed ${String(seed)}`).toBe(a.p1);
        for (const match of [a, b]) {
          if (match.winner === 'p1') {
            seatOne += 1;
            decided += 1;
          } else if (match.winner === 'p2') decided += 1;
        }
      }
      expect(seatOne * 2, tier).toBe(decided);
    }
  });

  it('finishes a match between two easy bots, which is the pairing that breaks games', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const result = playBots(seed * 8191 + 5, 'easy', 'easy');
      expect(result.winner).not.toBeNull();
      expect(result.steps).toBeLessThanOrEqual(Math.ceil(MATCH_SECONDS / STEP) + 1);
    }
  });

  it('actually plays the game rather than standing at its own door', () => {
    // A guard that never raids scores nothing and a thief that never comes home scores
    // nothing, so both halves of the loop have to be happening.
    const game = createGame();
    resetGame(game, new Rng(6001));
    const s1 = createBotState();
    const s2 = createBotState();
    const c1 = createCommand();
    const c2 = createCommand();
    const r1 = new Rng(11);
    const r2 = new Rng(12);
    while (game.winner === null) {
      botStep(game, 'p1', BOT_PROFILES.normal, s1, r1, STEP, c1);
      botStep(game, 'p2', BOT_PROFILES.normal, s2, r2, STEP, c2);
      step(game, STEP, c1, c2);
    }
    for (const seat of SEATS) {
      const runner = runnerOf(game, seat);
      expect(runner.raids, seat).toBeGreaterThan(3);
      expect(runner.bank, seat).toBeGreaterThan(5);
    }
    expect(game.p1.runner.catches + game.p2.runner.catches).toBeGreaterThan(0);
  });

  it('holds its heading between decisions, which is what `think` costs', () => {
    const slow: BotProfile = { ...BOT_PROFILES.easy, think: 1 };
    const state: BotState = createBotState();
    const game = fresh(57);
    const out = createCommand();
    const rng = new Rng(3);
    botStep(game, 'p1', slow, state, rng, STEP, out);
    const first = `${out.dirX},${out.dirY}`;
    for (let i = 0; i < 30; i += 1) {
      botStep(game, 'p1', slow, state, rng, STEP, out);
      expect(`${out.dirX},${out.dirY}`).toBe(first);
    }
  });

  it('probes a fixed distance ahead, so `think` measures staleness and nothing else', () => {
    // The confound that made `think` sweep backwards: a probe of `speed * think` gave a
    // slow bot a longer look than a fast one. It is a constant now, and this is the fact.
    expect(LOOKAHEAD).toBeGreaterThan(0);
    const state = createBotState();
    const game = fresh(59);
    clearVaults(game);
    const coin = raidedVault(game, 'p1')[0] as Coin;
    coin.active = true;
    coin.x = 100;
    coin.y = CENTRE_Y - 200;
    place(game.p1.runner, homeX(), CENTRE_Y - 200, 'p1');
    const fast: BotProfile = { ...BOT_PROFILES.hard, think: 0.05 };
    const slow: BotProfile = { ...BOT_PROFILES.hard, think: 0.9 };
    const a = createBotState();
    const b = createBotState();
    chooseHeading(game, 'p1', fast, a);
    chooseHeading(game, 'p1', slow, b);
    expect(a.wantX).toBe(b.wantX);
    expect(a.wantY).toBe(b.wantY);
    expect(state.coin).toBe(-1);
  });

  it('is reset to nothing by resetBotState', () => {
    const state = createBotState();
    state.cooldown = 3;
    state.wantX = 1;
    state.chasing = true;
    state.coin = 4;
    resetBotState(state);
    expect(state).toEqual(createBotState());
  });
});

/* ------------------------------------------------------------------------------------ */
/* Input parity, as facts rather than prose                                              */
/* ------------------------------------------------------------------------------------ */

describe('the input vocabulary', () => {
  it('offers nine headings and nothing between them', () => {
    expect(HEADINGS).toHaveLength(8);
    for (const heading of HEADINGS) {
      expect(Math.hypot(heading.x, heading.y)).toBeCloseTo(1, 12);
      for (const component of [heading.x, heading.y]) {
        expect([0, 1, -1, Math.SQRT1_2, -Math.SQRT1_2]).toContain(component);
      }
    }
  });

  it('sizes the drag deadzone and leash in precision envelopes', () => {
    // `docs/input-idiom.md` rule 2: deadzones are multiples of the envelope, not bare
    // numbers, so they mean the same thing in a 600-unit box and a 1080-unit one.
    const envelope = envelopeFor({ width: BOARD_WIDTH, height: BOARD_HEIGHT });
    expect(DRAG_DEADZONE).toBe(4 * envelope);
    expect(DRAG_LEASH).toBe(2 * DRAG_DEADZONE);
    // A reversal costs leash plus deadzone of glass, well under the third of the short
    // side beyond which a trackpad has to re-clutch.
    expect(DRAG_LEASH + DRAG_DEADZONE).toBeLessThan(BOARD_WIDTH / 3);
  });

  it('keeps a step small against every radius the rules test', () => {
    // What the fairness argument rests on: the largest quantity two input families can
    // disagree about is *when* a heading changed, and a runner covers under five units in
    // a 60 Hz step against a 40-unit catch radius and a 31-unit pickup.
    const stride = GUARD_SPEED * STEP;
    expect(stride).toBeLessThan(CATCH_RADIUS / 8);
    expect(stride).toBeLessThan(PICKUP_RADIUS / 6);
    // Thirty milliseconds of latency, in precision envelopes.
    const envelope = envelopeFor({ width: BOARD_WIDTH, height: BOARD_HEIGHT });
    expect((GUARD_SPEED * 0.03) / envelope).toBeLessThan(3);
  });

  it('never asks anybody to press anything', () => {
    // There is no action verb at all, so `actionHeld` — which is `keys.action ||
    // pointerDown`, and therefore free for a keyboard and unavoidable for a finger —
    // has nothing to bite on. A `Command` carries a heading and nothing else.
    expect(Object.keys(createCommand()).sort()).toEqual(['dirX', 'dirY']);
  });

  it('flashes for a fixed time that no rule reads', () => {
    const game = meeting(CENTRE_Y + 200, CENTRE_Y + 200);
    step(game, STEP, still(), still());
    expect(game.p1.runner.flash).toBeLessThanOrEqual(FLASH_SECONDS);
    for (let i = 0; i < Math.ceil(FLASH_SECONDS * 60) + 2; i += 1) {
      step(game, STEP, still(), still());
    }
    expect(game.p1.runner.flash).toBe(0);
  });
});
