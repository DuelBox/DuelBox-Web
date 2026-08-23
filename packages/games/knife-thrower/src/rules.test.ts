import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BASE_SPIN,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CENTRE_X,
  CENTRE_Y,
  FLIGHT_SECONDS,
  IMPACT_ANGLE,
  KNIFE_CLEARANCE,
  LOG_RADIUS,
  MAX_KNIVES,
  MAX_THROWS,
  SETTLE_SECONDS,
  SPIN_PER_KNIFE,
  TARGET_POINTS,
  THROW_Y,
  angleDelta,
  botThrows,
  dressLog,
  clearanceAt,
  createBotState,
  createGame,
  landingAngle,
  landingAngleIn,
  otherOf,
  pointsOf,
  resetGame,
  spinRateFor,
  step,
  throwKnife,
  winnerOf,
  wouldStick,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(seed = 1): { game: Game; rng: Rng } {
  const game = createGame();
  const rng = new Rng(seed);
  resetGame(game, rng);
  return { game, rng };
}

/** Step until the phase changes away from `from`, or give up. */
function until(game: Game, rng: Rng, done: () => boolean, limit = 4000): number {
  let steps = 0;
  for (; steps < limit && !done(); steps += 1) step(game, STEP);
  return steps;
}

/** Throw and run the knife all the way to the wood. */
function throwAndLand(game: Game, rng: Rng): void {
  throwKnife(game, game.active);
  until(game, rng, () => game.phase !== 'flying');
}

describe('the board', () => {
  it('puts the log and the throwing hand where a half-turn leaves them', () => {
    // The board rotates 180° to face whoever is to throw. Anything not symmetric about
    // the centre would land somewhere else for the far player.
    expect(CENTRE_X).toBe(BOARD_WIDTH / 2);
    expect(CENTRE_Y).toBe(BOARD_HEIGHT / 2);
    expect(THROW_Y - CENTRE_Y).toBe(CENTRE_Y - (BOARD_HEIGHT - THROW_Y));
  });

  it('starts already dressed, level, and with p1 to throw', () => {
    const { game } = started();
    // Not bare: a bare log is a free point and only p1 would ever get one. See dressLog.
    expect(game.knives.length).toBeGreaterThan(MAX_KNIVES - 3);
    expect(game.knives.every((knife) => knife.seat === null)).toBe(true);
    expect(game.p1Points).toBe(0);
    expect(game.p2Points).toBe(0);
    expect(game.active).toBe('p1');
    expect(game.phase).toBe('aiming');
    expect(winnerOf(game)).toBeNull();
  });

  it('turns the log faster for every knife in it', () => {
    expect(spinRateFor(0)).toBe(BASE_SPIN);
    expect(spinRateFor(4)).toBeCloseTo(BASE_SPIN + SPIN_PER_KNIFE * 4, 10);
    expect(spinRateFor(4)).toBeGreaterThan(spinRateFor(3));
  });

  it('keeps the rotation inside one turn however long the match runs', () => {
    // A spin that grew without bound would eventually be large enough that a float could
    // no longer tell two nearby angles apart, and the clearance test would start lying.
    const { game } = started();
    for (let i = 0; i < 60 * 200; i += 1) step(game, STEP);
    expect(Math.abs(game.spin)).toBeLessThanOrEqual(Math.PI);
  });
});

describe('angles', () => {
  it('measures the shorter way round', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(0.2, 10);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2, 10);
    expect(Math.abs(angleDelta(3, -3))).toBeLessThan(Math.PI);
  });

  it('reports a bare log as clear all the way round', () => {
    const game = createGame();
    expect(clearanceAt(game, 0)).toBe(Math.PI);
    expect(wouldStick(game)).toBe(true);
  });

  it('never places two of the opening blades on top of each other', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const { game } = started(seed);
      for (let i = 0; i < game.knives.length; i += 1) {
        for (let j = i + 1; j < game.knives.length; j += 1) {
          const gap = Math.abs(angleDelta(game.knives[i]!.angle, game.knives[j]!.angle));
          expect(gap).toBeGreaterThanOrEqual(KNIFE_CLEARANCE);
        }
      }
    }
  });

  it('names the spot on the log that is under the knife right now', () => {
    const { game } = started();
    game.spin = 0.4;
    expect(landingAngle(game)).toBeCloseTo(IMPACT_ANGLE - 0.4, 10);
  });
});

describe('a throw', () => {
  it('only the seat whose turn it is may make', () => {
    const { game } = started();
    expect(throwKnife(game, 'p2')).toBe(false);
    expect(game.phase).toBe('aiming');
    expect(throwKnife(game, 'p1')).toBe(true);
    expect(game.phase).toBe('flying');
  });

  it('cannot be made twice while a knife is in the air', () => {
    const { game } = started();
    throwKnife(game, 'p1');
    expect(throwKnife(game, 'p1')).toBe(false);
    expect(game.throws).toBe(1);
  });

  it('reaches the wood in the time the bot is told it will', () => {
    const { game, rng } = started();
    throwKnife(game, 'p1');
    const steps = until(game, rng, () => game.phase !== 'flying');
    expect(steps * STEP).toBeCloseTo(FLIGHT_SECONDS, 1);
  });

  it('sticks in bare wood and scores', () => {
    const { game, rng } = started();
    game.knives.length = 0;
    throwAndLand(game, rng);
    expect(game.lastOutcome).toBe('stuck');
    expect(game.knives).toHaveLength(1);
    expect(game.knives[0]!.seat).toBe('p1');
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(0);
  });

  it('splinters on a knife already there, knocking that knife out', () => {
    const { game, rng } = started();
    game.knives.length = 0;
    // Stop the log so the second knife lands exactly where the first did.
    game.spinRate = 0;
    throwAndLand(game, rng);
    expect(game.knives).toHaveLength(1);
    until(game, rng, () => game.phase === 'aiming');

    game.spinRate = 0;
    throwAndLand(game, rng);
    expect(game.lastOutcome).toBe('splintered');
    // The knife it hit is gone; the log is not stripped, it is merely one knife lighter.
    expect(game.knives).toHaveLength(0);
    // p1 banked one and p2 paid one, from nothing, which cannot go negative.
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(0);
  });

  it('costs the thrower a point, and never puts them in debt', () => {
    const { game, rng } = started();
    game.knives.length = 0;
    game.p1Points = 4;
    game.spinRate = 0;
    game.knives.push({ angle: landingAngle(game), seat: 'p2' });
    throwAndLand(game, rng);
    expect(game.lastOutcome).toBe('splintered');
    expect(game.p1Points).toBe(3);

    const bare = started(2);
    bare.game.knives.length = 0;
    bare.game.spinRate = 0;
    bare.game.knives.push({ angle: landingAngle(bare.game), seat: 'p2' });
    throwAndLand(bare.game, bare.rng);
    expect(bare.game.p1Points).toBe(0);
  });

  it('lands at the angle the log had turned to, not at a fixed spot', () => {
    const seen: number[] = [];
    for (const spin of [0, 0.9, -1.7]) {
      const { game, rng } = started();
      game.knives.length = 0;
      game.spin = spin;
      game.spinRate = 0;
      throwAndLand(game, rng);
      seen.push(game.knives[0]!.angle);
    }
    expect(new Set(seen.map((a) => a.toFixed(4))).size).toBe(3);
  });

  it('turns with the log once it is in', () => {
    // Stored in the log's frame, so a knife's *world* angle moves and its relation to the
    // other knives never does. Anything else and the log would shed its knives as it spun.
    const { game, rng } = started();
    game.knives.length = 0;
    throwAndLand(game, rng);
    const stored = game.knives[0]!.angle;
    for (let i = 0; i < 200; i += 1) step(game, STEP);
    expect(game.knives[0]!.angle).toBe(stored);
  });
});

describe('a full log', () => {
  /** Land `count` knives, spacing them by hand so none splinters. */
  function fill(game: Game, rng: Rng, count: number): void {
    game.knives.length = 0;
    for (let i = 0; i < count; i += 1) {
      game.spinRate = 0;
      game.spin = -(KNIFE_CLEARANCE * 1.4 * i);
      throwAndLand(game, rng);
      if (game.phase === 'settling') until(game, rng, () => game.phase !== 'settling');
    }
  }

  it('pushes the oldest knife out rather than clearing', () => {
    const { game, rng } = started();
    fill(game, rng, MAX_KNIVES);
    expect(game.knives).toHaveLength(MAX_KNIVES);
    const oldest = game.knives[0]!.angle;

    game.spinRate = 0;
    game.spin = -(KNIFE_CLEARANCE * 1.4 * MAX_KNIVES);
    throwAndLand(game, rng);
    expect(game.knives).toHaveLength(MAX_KNIVES);
    expect(game.knives[0]!.angle).not.toBe(oldest);
    // Every throw still scored: nothing about the window costs the thrower anything.
    expect(game.p1Points + game.p2Points).toBe(MAX_KNIVES + 1);
  });

  it('keeps the count steady, so neither seat throws at the fuller log', () => {
    // The bias this replaced: knives arrived one a throw, so one seat always faced an even
    // count and the other an odd one. p1 landed 67% of its throws to p2's 53%.
    const { game, rng } = started();
    fill(game, rng, MAX_KNIVES + 4);
    expect(game.knives.length).toBeLessThanOrEqual(MAX_KNIVES);
  });

  it('holds fewer knives than the geometry would allow, so the endgame is playable', () => {
    // A log packed to the last gap would be decided by arithmetic rather than by throwing.
    expect(MAX_KNIVES).toBeLessThan(Math.floor((Math.PI * 2) / KNIFE_CLEARANCE));
  });
});

describe('turns', () => {
  it('passes to the other seat after the result has been shown', () => {
    const { game, rng } = started();
    throwAndLand(game, rng);
    expect(game.phase).toBe('settling');
    expect(game.active).toBe('p1');
    const steps = until(game, rng, () => game.active === 'p2');
    expect(steps * STEP).toBeCloseTo(SETTLE_SECONDS, 1);
    expect(game.phase).toBe('aiming');
  });

  it('alternates, so neither seat ever throws twice running', () => {
    const { game, rng } = started();
    const order: SeatId[] = [];
    for (let i = 0; i < 8; i += 1) {
      order.push(game.active);
      throwAndLand(game, rng);
      until(game, rng, () => game.phase === 'aiming' || game.phase === 'over');
    }
    for (let i = 1; i < order.length; i += 1) expect(order[i]).toBe(otherOf(order[i - 1]!));
  });
});

describe('the match ending', () => {
  it('is won by the first to the target, but only once the round is complete', () => {
    const { game, rng } = started();
    game.knives.length = 0;
    game.p1Points = TARGET_POINTS - 1;
    game.spinRate = 0;
    throwAndLand(game, rng);
    // p1 is at the target and p2 has thrown one time fewer: not over yet.
    until(game, rng, () => game.phase === 'aiming' || game.phase === 'over');
    expect(pointsOf(game, 'p1')).toBeGreaterThanOrEqual(TARGET_POINTS);
    expect(game.phase).toBe('aiming');
    expect(game.active).toBe('p2');

    // p2 answers and splinters, so p1 is ahead at the end of a completed round.
    game.knives.push({ angle: landingAngle(game), seat: 'p1' });
    throwAndLand(game, rng);
    until(game, rng, () => game.phase === 'over');
    expect(winnerOf(game)).toBe('p1');
  });

  it('plays on while the two are level at the target', () => {
    // A race to a target is won by whoever throws first whenever both players are good.
    // Two `hard` bots each landed essentially every knife and p1 simply arrived a throw
    // sooner: 40 to 0 over forty matches, with the points 20.0 to 19.0.
    const { game, rng } = started();
    game.knives.length = 0;
    game.p1Points = TARGET_POINTS;
    game.p2Points = TARGET_POINTS;
    game.p1Throws = 10;
    game.p2Throws = 10;
    game.throws = 20;
    game.active = 'p1';
    throwAndLand(game, rng);
    until(game, rng, () => game.phase === 'aiming' || game.phase === 'over');
    expect(game.phase).toBe('aiming');
    game.knives.length = 0;
    throwAndLand(game, rng);
    until(game, rng, () => game.phase === 'aiming' || game.phase === 'over');
    // Both scored again, so they are still level and it is still going.
    expect(game.p1Points).toBe(game.p2Points);
    expect(game.phase).toBe('aiming');
  });

  it('is called on points once the throws run out', () => {
    const { game, rng } = started();
    game.throws = MAX_THROWS - 1;
    game.p1Throws = MAX_THROWS / 2;
    game.p2Throws = MAX_THROWS / 2 - 1;
    game.active = 'p2';
    game.p2Points = 3;
    throwAndLand(game, rng);
    until(game, rng, () => game.phase === 'over');
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).not.toBeNull();
  });

  it('is a draw when the throws run out level', () => {
    const { game, rng } = started();
    game.knives.length = 0;
    game.throws = MAX_THROWS - 1;
    game.p1Throws = MAX_THROWS / 2;
    game.p2Throws = MAX_THROWS / 2 - 1;
    game.active = 'p2';
    game.p1Points = 5;
    game.p2Points = 4;
    // A clean stick levels it, and the throws are gone.
    game.spinRate = 0;
    throwAndLand(game, rng);
    until(game, rng, () => game.phase === 'over');
    expect(game.p2Points).toBe(5);
    expect(winnerOf(game)).toBe('draw');
  });

  it('stops simulating once it is decided', () => {
    const { game } = started();
    game.phase = 'over';
    game.winner = 'p1';
    const spin = game.spin;
    step(game, STEP);
    expect(game.spin).toBe(spin);
  });

  it('always ends, even between two players who never land a knife', () => {
    // The structural guarantee. A clock would not do here: a player who splinters every
    // throw never scores and never loses, and waiting changes nothing.
    const game = createGame();
    const rng = new Rng(3);
    resetGame(game, rng);
    let steps = 0;
    for (; steps < 60 * 600 && game.phase !== 'over'; steps += 1) {
      if (game.phase === 'aiming') {
        // Throw straight into a knife every single time.
        game.spinRate = 0;
        if (game.knives.length === 0) game.knives.push({ angle: landingAngle(game), seat: null });
        game.knives[0]!.angle = landingAngle(game);
        throwKnife(game, game.active);
      }
      step(game, STEP);
    }
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('draw');
    expect(game.throws).toBeLessThanOrEqual(MAX_THROWS);
  });
});

describe('dressing a fresh log', () => {
  it('fills the window with blades belonging to nobody, and turns either way', () => {
    const directions = new Set<number>();
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const game = createGame();
      const rng = new Rng(seed);
      game.knives.push({ angle: 0, seat: 'p1' });
      dressLog(game, rng);
      expect(game.knives.length).toBeGreaterThan(MAX_KNIVES - 3);
      expect(game.knives.every((knife) => knife.seat === null)).toBe(true);
      expect(game.spin).toBe(0);
      directions.add(Math.sign(game.spinRate));
      layouts.add(game.knives.map((k) => k.angle.toFixed(3)).join(','));
    }
    expect(directions.size).toBe(2);
    // A different log every match, or the second match is the first one memorised.
    expect(layouts.size).toBe(20);
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('predicts the landing angle the log will have turned to', () => {
    const { game } = started();
    game.spin = 0;
    game.spinRate = 2;
    expect(landingAngleIn(game, 0.5)).toBeCloseTo(IMPACT_ANGLE - 1, 10);
  });

  it('never throws out of turn or into the air', () => {
    for (const tier of TIERS) {
      const { game, rng } = started();
      const state = createBotState();
      for (let i = 0; i < 4000; i += 1) {
        if (botThrows(game, tier, state, rng, STEP)) {
          expect(game.phase).toBe('aiming');
          throwKnife(game, game.active);
        }
        step(game, STEP);
        if (game.phase === 'over') break;
      }
    }
  });

  it('lands a higher share of its throws as the tier goes up', () => {
    const rates = TIERS.map((tier) => landingRate(tier));
    const [easy, normal, hard] = rates as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
  });

  it('is balanced against itself, in both seats', () => {
    /*
     * p1 throws first, so a seat bias here would be a real advantage — and this game began
     * with an enormous one. Two `normal` bots went 36–4 to p1 and two `hard` bots 40–0,
     * from a free opening throw at a bare log that compounded, and from a race to a target
     * that whoever threw first was always going to reach first. The dressed opening log and
     * the equal-turns rule are what fixed them.
     *
     * Stated as a share of the *decided* matches, because two identical players on one
     * shared log draw often and a draw is a real outcome here rather than a failure to
     * finish. Measured over two hundred matches a tier: easy 49%, normal 47%, hard 41%.
     * The residue at `hard` is real and is not yet understood; it is small enough that a
     * pair of people, who are never identical, will not meet it, and large enough to be
     * worth saying out loud rather than papering over with a wider band.
     */
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 40);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(15);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.25,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.75);
    }
  });

  it('beats a weaker tier over a run of matches, from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = playSeries(strong, weak, 40);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 2);
      const asP2 = playSeries(weak, strong, 40);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 2);
    }
  });
});

/**
 * The share of a tier's throws that find bare wood.
 *
 * Measured from an identical opening log each time, one throw per log, so the number is a
 * fact about the tier and not about the boards it happened to inherit. Measured across a
 * whole match it is not: a better thrower fills the log faster and then has to throw at
 * the log it filled, which flattens every tier to about the same rate.
 */
function landingRate(tier: BotDifficulty): number {
  let thrown = 0;
  let stuck = 0;
  for (let trial = 0; trial < 300; trial += 1) {
    const game = createGame();
    const rng = new Rng(4000 + trial);
    resetGame(game, rng);
    const state = createBotState();
    for (let i = 0; i < 60 * 20; i += 1) {
      if (game.phase === 'aiming' && botThrows(game, tier, state, rng, STEP)) {
        throwKnife(game, game.active);
        thrown += 1;
      }
      const outcome = step(game, STEP);
      if (outcome.outcome !== null) {
        if (outcome.outcome === 'stuck') stuck += 1;
        break;
      }
    }
  }
  return stuck / thrown;
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const game = createGame();
    const rng = new Rng(500 + match);
    resetGame(game, rng);
    const p1State = createBotState();
    const p2State = createBotState();

    for (let i = 0; i < 60 * 900 && game.phase !== 'over'; i += 1) {
      if (game.phase === 'aiming') {
        const tier = game.active === 'p1' ? p1Tier : p2Tier;
        const state = game.active === 'p1' ? p1State : p2State;
        if (botThrows(game, tier, state, rng, STEP)) throwKnife(game, game.active);
      }
      step(game, STEP);
    }
    if (game.winner === 'p1') wins.p1 += 1;
    else if (game.winner === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

describe('determinism', () => {
  it('replays a fixed script to the identical final state', () => {
    const play = (): Game => {
      const game = createGame();
      const rng = new Rng(20260823);
      resetGame(game, rng);
      const script = new Rng(31337);
      for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
        if (game.phase === 'aiming' && script.float() < 0.04) throwKnife(game, game.active);
        step(game, STEP);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('two different scripts do not produce the same match', () => {
    const play = (seed: number): Game => {
      const game = createGame();
      const rng = new Rng(7);
      resetGame(game, rng);
      const script = new Rng(seed);
      for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
        if (game.phase === 'aiming' && script.float() < 0.04) throwKnife(game, game.active);
        step(game, STEP);
      }
      return game;
    };
    expect(play(1)).not.toEqual(play(2));
  });

  it('the log is where the knife arrives, at every viewport', () => {
    // Rule 8, restated as geometry: nothing here is in pixels, so the impact point is a
    // fact about the logical box and not about a device.
    const x = CENTRE_X + Math.cos(IMPACT_ANGLE) * LOG_RADIUS;
    const y = CENTRE_Y + Math.sin(IMPACT_ANGLE) * LOG_RADIUS;
    expect(x).toBeCloseTo(CENTRE_X, 10);
    expect(y).toBeCloseTo(CENTRE_Y + LOG_RADIUS, 10);
    expect(y).toBeLessThan(THROW_Y);
  });
});
