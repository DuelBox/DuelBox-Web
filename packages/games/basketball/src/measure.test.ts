import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { manifest } from './manifest.js';
import { BasketballGame } from './game.js';
import type { GameContext, InputState, SeatInput } from '@duelbox/game-sdk';
import type { BotDifficulty } from './rules.js';

const STEP = 1 / 60;

/** Two bots and nobody touching anything. One record, reused, so a match allocates nothing. */
const IDLE_SEAT: SeatInput = {
  move: { x: 0, y: 0 },
  pointer: null,
  actionPressed: false,
  actionHeld: false,
  actionReleased: false,
  holdSeconds: 0,
};

const idle: InputState = { seat: () => IDLE_SEAT };

function context(seed: number, p1: BotDifficulty | null, p2: BotDifficulty | null): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1 : p2),
  };
}

function playMatch(seed: number, p1: BotDifficulty, p2: BotDifficulty) {
  const game = new BasketballGame();
  game.init(context(seed, p1, p2));
  let steps = 0;
  for (; steps < 60 * 600; steps += 1) {
    game.update(STEP, idle);
    if (game.getScore().winner !== null) break;
  }
  const court = game.court;
  return {
    steps,
    winner: game.getScore().winner,
    p1: court.p1Points,
    p2: court.p2Points,
    p1Shots: court.p1Shots,
    p2Shots: court.p2Shots,
    p1Baskets: court.p1Baskets,
    p2Baskets: court.p2Baskets,
    p1Swishes: court.p1Swishes,
    p2Swishes: court.p2Swishes,
  };
}

/**
 * The ladder, measured through the whole `Game` rather than through the rules alone.
 *
 * This is where `SPEC.md`'s numbers come from, so it both **prints** them — one command to
 * re-measure after any change to the shot model — and **asserts** the bands they sit in.
 * Printing alone was not enough: a spec quoting figures nothing checks is a spec that goes
 * quietly stale the first time a constant moves. The bands are wide enough that only a real
 * change in the game can break them, and every match here is seeded, so a run that passes
 * today passes for ever.
 */
describe('measurement', () => {
  it('reports the ladder', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    const made: Record<BotDifficulty, number> = { easy: 0, normal: 0, hard: 0 };
    const longest: Record<BotDifficulty, number> = { easy: 0, normal: 0, hard: 0 };
    // A Map with a throwing reader rather than an index signature: a pairing this never
    // measured is a mistake in the harness, and reading `undefined` out of it silently would
    // make the ladder's assertions pass on nothing at all.
    const share = new Map<string, number>();
    const shareOf = (a: BotDifficulty, b: BotDifficulty): number => {
      const value = share.get(`${a}v${b}`);
      if (value === undefined) throw new Error(`${a} v ${b} was never measured`);
      return value;
    };
    for (const tier of tiers) {
      let shots = 0;
      let baskets = 0;
      let swishes = 0;
      let points = 0;
      let maxSteps = 0;
      let totalSteps = 0;
      let levelOnPoints = 0;
      let stillLevel = 0;
      let p1Wins = 0;
      const matches = 400;
      for (let i = 0; i < matches; i += 1) {
        const r = playMatch(1000 + i * 17, tier, tier);
        if (r.winner === 'p1') p1Wins += 1;
        shots += r.p1Shots + r.p2Shots;
        baskets += r.p1Baskets + r.p2Baskets;
        swishes += r.p1Swishes + r.p2Swishes;
        points += r.p1 + r.p2;
        maxSteps = Math.max(maxSteps, r.steps);
        totalSteps += r.steps;
        if (r.p1 === r.p2) levelOnPoints += 1;
        if (r.winner === 'draw') stillLevel += 1;
      }
      // eslint-disable-next-line no-console
      console.log(
        `${tier}: shots/match ${(shots / matches).toFixed(1)} made ${((baskets / shots) * 100).toFixed(1)}% ` +
          `swish ${((swishes / shots) * 100).toFixed(1)}% points/match ${(points / matches).toFixed(1)} ` +
          `steps avg ${(totalSteps / matches).toFixed(0)} max ${maxSteps} ` +
          `level on points ${((levelOnPoints / matches) * 100).toFixed(1)}% ` +
          `still level after the swish tiebreak ${((stillLevel / matches) * 100).toFixed(1)}% ` +
          `seat one takes ${((p1Wins / (matches - stillLevel)) * 100).toFixed(1)}% of decided`,
      );
      made[tier] = baskets / shots;
      longest[tier] = maxSteps;
      share.set(`${tier}v${tier}`, 1 - p1Wins / (matches - stillLevel));
      // The tiebreak is the score's fine resolution, not decoration: two seats of the same
      // standard reach the same total often, and a clean drop is the second gradient the aim
      // needle is already being played for. It has to separate a real share of those.
      expect(stillLevel, `${tier} draws are not being broken`).toBeLessThan(levelOnPoints);
    }

    // The three tiers land about a fifth, two fifths and three quarters of their shots.
    expect(made.easy).toBeGreaterThan(0.14);
    expect(made.easy).toBeLessThan(0.25);
    expect(made.normal).toBeGreaterThan(made.easy + 0.15);
    expect(made.normal).toBeLessThan(0.45);
    expect(made.hard).toBeGreaterThan(made.normal + 0.25);
    expect(made.hard).toBeLessThan(0.85);

    // The longest match any pair of bots played, against the round the manifest advertises.
    // The weakest pair are the slowest: they miss more, and a miss is a flight and a roll.
    for (const tier of tiers) {
      expect(longest[tier] / 60, `${tier} ran past the advertised round`).toBeLessThan(
        manifest.roundSeconds,
      );
    }

    // Both seat orders for every cross-tier pairing: seat one shoots first and seat two
    // shoots last, and a ladder that only ever put the stronger tier in one of those chairs
    // could not tell a tier apart from the chair it was sitting in.
    const pairs: [BotDifficulty, BotDifficulty][] = [
      ['easy', 'hard'],
      ['hard', 'easy'],
      ['easy', 'normal'],
      ['normal', 'easy'],
      ['normal', 'hard'],
      ['hard', 'normal'],
    ];
    for (const [a, b] of pairs) {
      let p1Wins = 0;
      let p2Wins = 0;
      let draws = 0;
      const matches = 400;
      for (let i = 0; i < matches; i += 1) {
        const r = playMatch(500000 + i * 31, a, b);
        if (r.winner === 'p1') p1Wins += 1;
        else if (r.winner === 'p2') p2Wins += 1;
        else draws += 1;
      }
      // eslint-disable-next-line no-console
      console.log(
        `${a} as p1 vs ${b}: p1 ${((p1Wins / matches) * 100).toFixed(1)}% p2 ${((p2Wins / matches) * 100).toFixed(1)}% ` +
          `draw ${((draws / matches) * 100).toFixed(1)}% — p2 takes ` +
          `${((p2Wins / (p1Wins + p2Wins)) * 100).toFixed(1)}% of decided`,
      );
      share.set(`${a}v${b}`, p2Wins / (p1Wins + p2Wins));
    }

    /** The stronger tier's share of decided matches, whichever chair it was sitting in. */
    const stronger = (weak: BotDifficulty, strong: BotDifficulty): number =>
      (shareOf(weak, strong) + (1 - shareOf(strong, weak))) / 2;
    const easyNormal = stronger('easy', 'normal');
    const normalHard = stronger('normal', 'hard');
    const easyHard = stronger('easy', 'hard');

    // Ordered, and every step of the ladder is a real step rather than a rounding.
    expect(easyNormal).toBeGreaterThan(0.75);
    expect(normalHard).toBeGreaterThan(easyNormal);
    expect(easyHard).toBeGreaterThan(normalHard);
    // The top of the ladder is nearly saturated and `SPEC.md` says so; what matters is that
    // it is not *exactly* saturated, because a rung that never loses cannot be ordered
    // against a stronger one that never loses either.
    expect(easyHard).toBeLessThan(1);
    // The two seat orders have to agree with each other, or the ladder is measuring which
    // chair a tier sat in rather than the tier.
    const orders: [BotDifficulty, BotDifficulty][] = [
      ['easy', 'normal'],
      ['normal', 'hard'],
      ['easy', 'hard'],
    ];
    for (const [weak, strong] of orders) {
      const asP2 = shareOf(weak, strong);
      const asP1 = 1 - shareOf(strong, weak);
      expect(
        Math.abs(asP2 - asP1),
        `${weak} v ${strong} disagrees across seat orders`,
      ).toBeLessThan(0.07);
    }

    // Neither end of the court is worth more, which is the one result a turn game that
    // rotates its board has to have. Seat one shoots first, and that is worth nothing.
    for (const tier of tiers) {
      expect(Math.abs(shareOf(tier, tier) - 0.5), `${tier} favours a seat`).toBeLessThan(0.1);
    }
  }, 120000);
});
