import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  GRACE_SECONDS,
  HOLE_COST,
  HOLE_RADIUS,
  MAX_DRIFTERS,
  NET_RADIUS,
  NET_SPEED,
  SPAWNS,
  SPAWN_DRAWS,
  STAR_RADIUS,
  TARGET_STARS,
  botTarget,
  createBotState,
  createGame,
  driveNet,
  netOf,
  otherOf,
  resetGame,
  starsOf,
  step,
  takenBy,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(): Game {
  const game = createGame();
  resetGame(game);
  return game;
}

/** Run past the grace period so the sky starts filling. */
function toFlying(game: Game, rng: Rng): void {
  for (let i = 0; i < 600 && game.phase === 'grace'; i += 1) step(game, STEP, rng);
}

describe('the sky', () => {
  it('is one deal that both seats fly', () => {
    // The fairness claim, and it is structural: there is one array of drifters and both
    // seats are tested against it. Neither can have had the kinder sky because there is only
    // one sky.
    const game = started();
    const rng = new Rng(3);
    toFlying(game, rng);
    for (let i = 0; i < 60 * 30 && game.phase === 'flying'; i += 1) step(game, STEP, rng);
    expect(game.drifters.length).toBe(MAX_DRIFTERS);
    expect(game.p1Taken.length).toBe(MAX_DRIFTERS);
    expect(game.p2Taken.length).toBe(MAX_DRIFTERS);
  });

  it('deals exactly as many things as it promised, and no more', () => {
    // The termination guarantee, and it is a plain counter rather than a clock.
    const game = started();
    const rng = new Rng(4);
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) step(game, STEP, rng);
    expect(game.spawned).toBeLessThanOrEqual(SPAWNS);
    expect(game.phase).toBe('over');
  });

  it('brings everything in from a side, so nothing appears under a net', () => {
    const game = started();
    const rng = new Rng(5);
    toFlying(game, rng);
    const seen: number[] = [];
    for (let i = 0; i < 60 * 60 && game.phase === 'flying'; i += 1) {
      const before = game.drifters.filter((drifter) => drifter.active).length;
      step(game, STEP, rng);
      for (const drifter of game.drifters) {
        if (drifter.active && game.drifters.filter((d) => d.active).length > before) {
          seen.push(drifter.x);
        }
      }
    }
    for (const x of seen) {
      const entering = x <= 0 || x >= FIELD_WIDTH;
      expect(entering || (x > 0 && x < FIELD_WIDTH)).toBe(true);
    }
  });

  it('draws the same number of values for every spawn', () => {
    // The sky shares the game's Rng with both bots, so a variable count here shifts
    // everything after it.
    for (let seed = 1; seed <= 30; seed += 1) {
      const game = started();
      const counter = new Rng(seed);
      let draws = 0;
      const counted = {
        float: () => {
          draws += 1;
          return counter.float();
        },
      } as unknown as Rng;
      toFlying(game, counted);
      const before = draws;
      const spawnedBefore = game.spawned;
      for (let i = 0; i < 60 * 4 && game.spawned === spawnedBefore; i += 1)
        step(game, STEP, counted);
      expect(game.spawned, `seed ${String(seed)} never spawned`).toBe(spawnedBefore + 1);
      expect(draws - before, `seed ${String(seed)}`).toBe(SPAWN_DRAWS);
    }
  });

  it('holds a drifter inside the sky rather than letting it slide off the top', () => {
    const game = started();
    const rng = new Rng(6);
    toFlying(game, rng);
    for (let i = 0; i < 60 * 60 && game.phase === 'flying'; i += 1) {
      step(game, STEP, rng);
      for (const drifter of game.drifters) {
        if (!drifter.active) continue;
        expect(drifter.y).toBeGreaterThan(-1);
        expect(drifter.y).toBeLessThan(FIELD_HEIGHT + 1);
      }
    }
  });
});

describe('the net', () => {
  it('never moves faster than its own speed', () => {
    const net = { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2 };
    const from = { ...net };
    driveNet(net, FIELD_WIDTH * 10, FIELD_HEIGHT * 10, STEP);
    expect(Math.hypot(net.x - from.x, net.y - from.y)).toBeCloseTo(NET_SPEED * STEP, 5);
  });

  it('stays inside the sky', () => {
    const net = { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2 };
    for (let i = 0; i < 600; i += 1) driveNet(net, -9999, -9999, STEP);
    expect(net.x).toBe(NET_RADIUS);
    expect(net.y).toBe(NET_RADIUS);
    for (let i = 0; i < 600; i += 1) driveNet(net, 9999, 9999, STEP);
    expect(net.x).toBe(FIELD_WIDTH - NET_RADIUS);
    expect(net.y).toBe(FIELD_HEIGHT - NET_RADIUS);
  });

  it('arrives exactly when it is within reach, rather than overshooting', () => {
    const net = { x: 100, y: 100 };
    driveNet(net, 100.5, 100, STEP);
    expect(net.x).toBe(100.5);
    expect(net.y).toBe(100);
  });
});

describe('catching', () => {
  it('scores a star, once, for the seat that reached it', () => {
    const game = started();
    const rng = new Rng(7);
    toFlying(game, rng);
    const drifter = game.drifters[0]!;
    drifter.active = true;
    drifter.hole = false;
    drifter.x = 200;
    drifter.y = 200;
    drifter.vx = 0;
    drifter.vy = 0;
    game.p1.x = 200;
    game.p1.y = 200;

    const outcome = step(game, STEP, rng);
    expect(outcome.caught).toContain('p1');
    expect(starsOf(game, 'p1')).toBe(1);
    expect(takenBy(game, 'p1')[0]).toBe(true);

    // And not again on the next step, though it is still sitting there.
    step(game, STEP, rng);
    expect(starsOf(game, 'p1')).toBe(1);
  });

  it('lets both seats take the same drifter, because they are two different skies', () => {
    const game = started();
    const rng = new Rng(7);
    toFlying(game, rng);
    const drifter = game.drifters[0]!;
    drifter.active = true;
    drifter.hole = false;
    drifter.x = 200;
    drifter.y = 200;
    drifter.vx = 0;
    drifter.vy = 0;
    game.p1.x = 200;
    game.p1.y = 200;
    game.p2.x = 200;
    game.p2.y = 200;

    step(game, STEP, rng);
    expect(starsOf(game, 'p1')).toBe(1);
    expect(starsOf(game, 'p2')).toBe(1);
  });

  it('costs a hole more than a star pays', () => {
    // At a cost of one, steering round anything was a losing trade and the cautious tier
    // lost 85 matches in a hundred.
    expect(HOLE_COST).toBeGreaterThan(1);

    const game = started();
    const rng = new Rng(8);
    toFlying(game, rng);
    game.p1Stars = 5;
    const drifter = game.drifters[0]!;
    drifter.active = true;
    drifter.hole = true;
    drifter.x = 200;
    drifter.y = 200;
    drifter.vx = 0;
    drifter.vy = 0;
    game.p1.x = 200;
    game.p1.y = 200;

    const outcome = step(game, STEP, rng);
    expect(outcome.stung).toContain('p1');
    expect(starsOf(game, 'p1')).toBe(5 - HOLE_COST);
  });

  it('never puts a player into debt', () => {
    const game = started();
    const rng = new Rng(8);
    toFlying(game, rng);
    const drifter = game.drifters[0]!;
    drifter.active = true;
    drifter.hole = true;
    drifter.x = 200;
    drifter.y = 200;
    drifter.vx = 0;
    drifter.vy = 0;
    game.p1.x = 200;
    game.p1.y = 200;
    step(game, STEP, rng);
    expect(starsOf(game, 'p1')).toBe(0);
  });

  it('needs the net and the thing to actually overlap', () => {
    const game = started();
    const rng = new Rng(9);
    toFlying(game, rng);
    const drifter = game.drifters[0]!;
    drifter.active = true;
    drifter.hole = false;
    drifter.x = 200;
    drifter.y = 200;
    drifter.vx = 0;
    drifter.vy = 0;
    game.p1.x = 200 + NET_RADIUS + STAR_RADIUS + 5;
    game.p1.y = 200;
    step(game, STEP, rng);
    expect(starsOf(game, 'p1')).toBe(0);
  });

  it('gives a hole a bigger reach than a star, so it is the harder thing to dodge', () => {
    expect(HOLE_RADIUS).toBeGreaterThan(STAR_RADIUS);
  });
});

describe('the match', () => {
  it('opens with a moment of calm', () => {
    const game = started();
    const rng = new Rng(1);
    expect(game.phase).toBe('grace');
    let elapsed = 0;
    for (let i = 0; i < 600 && game.phase === 'grace'; i += 1) {
      step(game, STEP, rng);
      elapsed += STEP;
    }
    expect(elapsed).toBeCloseTo(GRACE_SECONDS, 1);
  });

  it('is won by the first to the target', () => {
    const game = started();
    const rng = new Rng(2);
    toFlying(game, rng);
    game.p1Stars = TARGET_STARS - 1;
    const drifter = game.drifters[0]!;
    drifter.active = true;
    drifter.hole = false;
    drifter.x = 200;
    drifter.y = 200;
    drifter.vx = 0;
    drifter.vy = 0;
    game.p1.x = 200;
    game.p1.y = 200;
    step(game, STEP, rng);
    expect(winnerOf(game)).toBe('p1');
  });

  it('finishes when the sky runs out, even if nobody ever moves', () => {
    const game = started();
    const rng = new Rng(3);
    let steps = 0;
    for (; steps < 60 * 400 && game.phase !== 'over'; steps += 1) step(game, STEP, rng);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('draw');
    expect(game.spawned).toBe(SPAWNS);
  });

  it('stops simulating once it is decided', () => {
    const game = started();
    const rng = new Rng(3);
    game.phase = 'over';
    game.winner = 'p1';
    const spawned = game.spawned;
    step(game, STEP, rng);
    expect(game.spawned).toBe(spawned);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];
  const out = { x: 0, y: 0 };

  it('draws the same number of values whatever it sees', () => {
    for (const tier of TIERS) {
      const game = started();
      const rng = new Rng(11);
      toFlying(game, rng);
      const state = createBotState();
      for (let i = 0; i < 300 && game.phase === 'flying'; i += 1) {
        const counter = new Rng(i + 1);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        state.cooldown = 0;
        botTarget(game, 'p1', tier, state, counted, STEP, out);
        expect(draws, `${tier} step ${String(i)}`).toBe(BOT_DRAWS_PER_DECISION);
        driveNet(netOf(game, 'p1'), out.x, out.y, STEP);
        step(game, STEP, rng);
      }
    }
  });

  it('spends nothing on a step it is not looking', () => {
    const game = started();
    const state = createBotState();
    state.cooldown = 10;
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return 0.5;
      },
    } as unknown as Rng;
    botTarget(game, 'p1', 'hard', state, counted, STEP, out);
    expect(draws).toBe(0);
  });

  it('never steers outside the sky', () => {
    for (const tier of TIERS) {
      const game = started();
      const rng = new Rng(12);
      const state = createBotState();
      for (let i = 0; i < 60 * 120 && game.phase !== 'over'; i += 1) {
        botTarget(game, 'p1', tier, state, rng, STEP, out);
        expect(out.x).toBeGreaterThanOrEqual(NET_RADIUS);
        expect(out.x).toBeLessThanOrEqual(FIELD_WIDTH - NET_RADIUS);
        expect(out.y).toBeGreaterThanOrEqual(NET_RADIUS);
        expect(out.y).toBeLessThanOrEqual(FIELD_HEIGHT - NET_RADIUS);
        driveNet(netOf(game, 'p1'), out.x, out.y, STEP);
        step(game, STEP, rng);
      }
    }
  });

  it('aims nearer the middle of a star as the tier goes up', () => {
    expect(BOT_PROFILES.hard.aim).toBeLessThan(BOT_PROFILES.normal.aim);
    expect(BOT_PROFILES.normal.aim).toBeLessThan(BOT_PROFILES.easy.aim);
  });

  it("keeps every tier's aim above the distance at which a wander stops costing anything", () => {
    // The knob is dead below the catch distance: the net arrives off-centre and closes on
    // the star regardless, so 8 and 22 and 46 all measure the same. It read in the source as
    // the main difficulty axis while doing nothing for two of the three tiers.
    const free = NET_RADIUS + STAR_RADIUS;
    for (const tier of TIERS) {
      expect(BOT_PROFILES[tier].aim, `${tier} aims within the catch distance`).toBeGreaterThan(
        free,
      );
    }
  });

  it('gives a hole more room as the tier goes up', () => {
    expect(BOT_PROFILES.easy.caution).toBeLessThan(BOT_PROFILES.normal.caution);
    expect(BOT_PROFILES.normal.caution).toBeLessThan(BOT_PROFILES.hard.caution);
  });

  it('looks further ahead and further afield as the tier goes up', () => {
    // Every knob on the profile is monotone, and each was swept alone to check it moves the
    // result in the right direction. `lead` was not, once: as a flat number of seconds it
    // made the sharpest tier aim past everything near it, and the tier with the most
    // foresight finished last. It is a fraction of the real intercept time now.
    expect(BOT_PROFILES.easy.lead).toBeLessThan(BOT_PROFILES.normal.lead);
    expect(BOT_PROFILES.normal.lead).toBeLessThan(BOT_PROFILES.hard.lead);
    expect(BOT_PROFILES.easy.sight).toBeLessThan(BOT_PROFILES.normal.sight);
    expect(BOT_PROFILES.normal.sight).toBeLessThan(BOT_PROFILES.hard.sight);
    expect(BOT_PROFILES.easy.reaction).toBeGreaterThan(BOT_PROFILES.normal.reaction);
    expect(BOT_PROFILES.normal.reaction).toBeGreaterThan(BOT_PROFILES.hard.reaction);
  });

  it('deals the same sky whoever is playing it', () => {
    // The sky's generator is its own, so what falls is a function of the seed and nothing
    // else. On a shared generator it was not: the tiers make different numbers of decisions,
    // draw different numbers of floats, and the spawns land on different values — so the
    // same tier caught 10.3 stars a match against one opponent and 9.5 against another, and
    // a human's sky would differ from the sky every balance figure was measured on.
    const trace = (tier: BotDifficulty): string[] => {
      const game = started();
      const sky = new Rng(4242);
      const bot = new Rng(99);
      const state = createBotState();
      const marks: string[] = [];
      for (let i = 0; i < 60 * 60 && game.phase !== 'over'; i += 1) {
        botTarget(game, 'p1', tier, state, bot, STEP, out);
        driveNet(netOf(game, 'p1'), out.x, out.y, STEP);
        step(game, STEP, sky);
        if (i % 30 === 0) {
          for (const drifter of game.drifters) {
            if (drifter.active) marks.push(`${drifter.hole ? 'h' : 's'}${drifter.y.toFixed(0)}`);
          }
        }
      }
      return marks;
    };
    // Compared over the frames both played: a sharper tier reaches the target sooner and so
    // stops watching earlier, which is a difference in the match, not in the sky.
    const slow = trace('easy');
    const quick = trace('hard');
    const shared = Math.min(slow.length, quick.length);
    expect(shared).toBeGreaterThan(100);
    expect(slow.slice(0, shared)).toEqual(quick.slice(0, shared));
  });

  it('cannot tell which seat was asked first', () => {
    // A stream each. Sharing one and drawing a constant number of values per decision still
    // hands the earlier value to whichever seat is polled first, which was worth 1.4 points
    // of win rate over two thousand matches — and reversing the two calls mirrored the
    // result exactly, which is what identified it.
    const run = (order: readonly SeatId[]): string => {
      const game = started();
      const sky = new Rng(77);
      const bots: Record<SeatId, Rng> = { p1: new Rng(11), p2: new Rng(22) };
      const states: Record<SeatId, ReturnType<typeof createBotState>> = {
        p1: createBotState(),
        p2: createBotState(),
      };
      for (let i = 0; i < 60 * 40 && game.phase !== 'over'; i += 1) {
        for (const seat of order) {
          botTarget(game, seat, 'normal', states[seat], bots[seat], STEP, out);
          driveNet(netOf(game, seat), out.x, out.y, STEP);
        }
        step(game, STEP, sky);
      }
      return `${game.p1Stars}:${game.p2Stars}`;
    };
    expect(run(['p1', 'p2'])).toBe(run(['p2', 'p1']));
  });

  it('reaches the target sooner as the tier goes up', () => {
    // Time rather than stars. Counting stars saturates: every tier gets to seven and stops,
    // so `normal` read 7.00 and `hard` 6.75 and the measure said the better bot was worse.
    // How long it took is monotone and has no ceiling.
    const times = TIERS.map((tier) => soloTime(tier));
    const [easy, normal, hard] = times as [number, number, number];
    expect(normal, `easy ${easy.toFixed(1)}s normal ${normal.toFixed(1)}s`).toBeLessThan(easy);
    expect(hard, `normal ${normal.toFixed(1)}s hard ${hard.toFixed(1)}s`).toBeLessThan(normal);
  });

  it('is balanced against itself', () => {
    /*
     * Four hundred seeds, because a hundred lies. `normal` read 66% at a hundred matches and
     * 52% at four hundred — the third game in this repo to report a seat bias that was
     * sample size. A match here is a dozen catches, so one unlucky sky moves the whole
     * result. The matches are cheap enough that the honest sample costs a fifth of a second.
     */
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 400);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(280);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.4,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.6);
    }
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['normal', 'easy'],
      ['hard', 'normal'],
    ] as [BotDifficulty, BotDifficulty][]) {
      const asP1 = playSeries(strong, weak, 120);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 1.25);
      const asP2 = playSeries(weak, strong, 120);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 1.25);
    }
  });
});

/** How long one tier takes to fill its own scorecard, averaged over skies. */
function soloTime(tier: BotDifficulty): number {
  const out = { x: 0, y: 0 };
  let total = 0;
  const runs = 20;
  for (let seed = 0; seed < runs; seed += 1) {
    const game = started();
    const rng = new Rng(500 + seed);
    const state = createBotState();
    let elapsed = 0;
    for (let i = 0; i < 60 * 200 && game.phase !== 'over'; i += 1) {
      botTarget(game, 'p1', tier, state, rng, STEP, out);
      driveNet(netOf(game, 'p1'), out.x, out.y, STEP);
      step(game, STEP, rng);
      elapsed += STEP;
    }
    total += elapsed;
  }
  return total / runs;
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  const out = { x: 0, y: 0 };
  for (let match = 0; match < matches; match += 1) {
    const game = started();
    const rng = new Rng(match * 5 + 1);
    const states = { p1: createBotState(), p2: createBotState() };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        botTarget(game, seat, tiers[seat], states[seat], rng, STEP, out);
        driveNet(netOf(game, seat), out.x, out.y, STEP);
      }
      step(game, STEP, rng);
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
      const game = started();
      const rng = new Rng(20260823);
      const script = new Rng(77);
      for (let i = 0; i < 60 * 200 && game.phase !== 'over'; i += 1) {
        driveNet(game.p1, script.float() * FIELD_WIDTH, script.float() * FIELD_HEIGHT, STEP);
        driveNet(game.p2, script.float() * FIELD_WIDTH, script.float() * FIELD_HEIGHT, STEP);
        step(game, STEP, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('deals a different sky from a different seed', () => {
    const trace = (seed: number): string => {
      const game = started();
      const rng = new Rng(seed);
      const seen: string[] = [];
      for (let i = 0; i < 60 * 25; i += 1) {
        step(game, STEP, rng);
        if (i % 20 !== 0) continue;
        for (const drifter of game.drifters) {
          if (drifter.active) seen.push(`${drifter.hole ? 'h' : 's'}${drifter.y.toFixed(0)}`);
        }
      }
      expect(seen.length, `seed ${String(seed)} saw an empty sky`).toBeGreaterThan(10);
      return seen.join(',');
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 25; seed += 1) seen.add(trace(seed));
    expect(seen.size).toBeGreaterThan(18);
  });

  it('gives both seats the same score from the same play', () => {
    // The plainest statement of the shared sky: two nets driven identically end level.
    const game = started();
    const rng = new Rng(31);
    const script = new Rng(13);
    for (let i = 0; i < 60 * 200 && game.phase !== 'over'; i += 1) {
      const x = script.float() * FIELD_WIDTH;
      const y = script.float() * FIELD_HEIGHT;
      driveNet(game.p1, x, y, STEP);
      driveNet(game.p2, x, y, STEP);
      step(game, STEP, rng);
      expect(game.p2Stars).toBe(game.p1Stars);
    }
    expect(winnerOf(game)).toBe('draw');
  });
});
