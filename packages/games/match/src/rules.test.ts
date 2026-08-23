import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_DRAWS_PER_ROUND,
  BOT_PROFILES,
  DEAL_DRAWS,
  MAX_ROUNDS,
  PENALTY_SECONDS,
  REVEAL_SECONDS,
  ROUND_SECONDS,
  SET_SIZE,
  SYMBOL_TYPES,
  TARGET_POINTS,
  botTouch,
  createBotState,
  createGame,
  deal,
  foundOf,
  lockOf,
  otherOf,
  pointsOf,
  resetGame,
  setOf,
  step,
  touch,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Game } from './rules.js';

const STEP = 1 / 60;

function started(seed = 1): { game: Game; rng: Rng } {
  const game = createGame();
  const rng = new Rng(seed);
  resetGame(game, rng);
  return { game, rng };
}

function run(game: Game, rng: Rng, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) step(game, STEP, rng);
}

/** Which slot in a seat's set holds the common symbol. */
function answerFor(game: Game, seat: SeatId): number {
  return setOf(game, seat).indexOf(game.common);
}

describe('the deal', () => {
  it('has enough kinds that exactly one can be shared', () => {
    // A pair of sets sharing exactly one symbol needs 1 + 2·(SET_SIZE − 1) distinct kinds,
    // or the two are forced to share a second.
    expect(SYMBOL_TYPES).toBeGreaterThanOrEqual(1 + 2 * (SET_SIZE - 1));
  });

  it('shares exactly one symbol between the two sets, every time', () => {
    // The property the whole game rests on. It is a fact about the construction rather than
    // something to test for and retry, but it is worth checking the construction is right.
    const game = createGame();
    const rng = new Rng(9);
    for (let round = 0; round < 3000; round += 1) {
      deal(game, rng);
      const shared = game.p1Set.filter((kind) => game.p2Set.includes(kind));
      expect(shared, `round ${String(round)}`).toEqual([game.common]);
    }
  });

  it('never repeats a symbol inside one set', () => {
    const game = createGame();
    const rng = new Rng(4);
    for (let round = 0; round < 2000; round += 1) {
      deal(game, rng);
      expect(new Set(game.p1Set).size).toBe(SET_SIZE);
      expect(new Set(game.p2Set).size).toBe(SET_SIZE);
    }
  });

  it('puts the shared symbol at the same ring index in both sets', () => {
    // The board is point-symmetric, so the same index is the same place relative to each
    // player — neither seat has a longer look than the other. Knowing the index is no help,
    // because you only learn it by having already found it.
    const game = createGame();
    const rng = new Rng(5);
    for (let round = 0; round < 500; round += 1) {
      deal(game, rng);
      expect(game.p1Set[game.commonIndex]).toBe(game.common);
      expect(game.p2Set[game.commonIndex]).toBe(game.common);
    }
  });

  it('uses every slot for the answer across a run', () => {
    // If the answer were always in the same place the game would be one key pressed fast.
    const game = createGame();
    const rng = new Rng(6);
    const seen = new Set<number>();
    for (let round = 0; round < 500; round += 1) {
      deal(game, rng);
      seen.add(game.commonIndex);
    }
    expect(seen.size).toBe(SET_SIZE);
  });

  it('draws the same number of values every time', () => {
    // The deal shares the game's Rng with both bots, so a variable count here shifts
    // everything after it.
    for (let seed = 1; seed <= 40; seed += 1) {
      const game = createGame();
      const counter = new Rng(seed);
      let draws = 0;
      const counted = {
        float: () => {
          draws += 1;
          return counter.float();
        },
      } as unknown as Rng;
      deal(game, counted);
      expect(draws, `seed ${String(seed)}`).toBe(DEAL_DRAWS);
    }
  });
});

describe('touching a symbol', () => {
  it('is recorded, not resolved', () => {
    // Two players finding it on the same step have both found it; settling as each touch
    // arrived would hand the point to whichever seat the loop read first.
    const { game } = started();
    expect(touch(game, 'p1', answerFor(game, 'p1'))).toBe(true);
    expect(foundOf(game, 'p1')).toBe(answerFor(game, 'p1'));
    expect(game.p1Points).toBe(0);
    expect(game.phase).toBe('searching');
  });

  it('locks a seat out for a wrong one', () => {
    const { game } = started();
    const wrong = (answerFor(game, 'p1') + 1) % SET_SIZE;
    expect(touch(game, 'p1', wrong)).toBe(false);
    expect(lockOf(game, 'p1')).toBeCloseTo(PENALTY_SECONDS, 6);
    expect(lockOf(game, 'p2')).toBe(0);
  });

  it('refuses anything from a locked-out seat', () => {
    const { game, rng } = started();
    touch(game, 'p1', (answerFor(game, 'p1') + 1) % SET_SIZE);
    expect(touch(game, 'p1', answerFor(game, 'p1'))).toBe(false);
    // And the lock runs down.
    run(game, rng, PENALTY_SECONDS + STEP);
    expect(lockOf(game, 'p1')).toBe(0);
  });

  it('makes guessing worse than looking', () => {
    // Without the lockout the fastest strategy is to touch all five as quickly as possible,
    // which is not searching — a set of five would be solved by mashing in under a second.
    const averageSearch = (BOT_PROFILES.normal.perSymbol * (SET_SIZE + 1)) / 2;
    expect(PENALTY_SECONDS).toBeGreaterThan(averageSearch);
  });

  it('cannot be repeated once a seat has found it', () => {
    const { game } = started();
    touch(game, 'p1', answerFor(game, 'p1'));
    expect(touch(game, 'p1', answerFor(game, 'p1'))).toBe(false);
  });

  it('rejects a slot that is not on the board', () => {
    const { game } = started();
    expect(touch(game, 'p1', -1)).toBe(false);
    expect(touch(game, 'p1', SET_SIZE)).toBe(false);
  });

  it('is refused once the round is being revealed', () => {
    const { game, rng } = started();
    touch(game, 'p1', answerFor(game, 'p1'));
    step(game, STEP, rng);
    expect(game.phase).toBe('revealing');
    expect(touch(game, 'p2', answerFor(game, 'p2'))).toBe(false);
  });
});

describe('scoring', () => {
  it('scores the seat that found it', () => {
    const { game, rng } = started();
    touch(game, 'p1', answerFor(game, 'p1'));
    step(game, STEP, rng);
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(0);
  });

  it('scores both when both find it on the same step', () => {
    const { game, rng } = started();
    touch(game, 'p1', answerFor(game, 'p1'));
    touch(game, 'p2', answerFor(game, 'p2'));
    step(game, STEP, rng);
    expect(game.p1Points).toBe(1);
    expect(game.p2Points).toBe(1);
  });

  it('scores nobody when the round runs out', () => {
    const { game, rng } = started();
    run(game, rng, ROUND_SECONDS + STEP);
    expect(game.p1Points).toBe(0);
    expect(game.p2Points).toBe(0);
    expect(game.phase).toBe('revealing');
  });

  it('deals a fresh round after the reveal', () => {
    const { game, rng } = started();
    const before = game.p1Set.join(',');
    touch(game, 'p1', answerFor(game, 'p1'));
    step(game, STEP, rng);
    run(game, rng, REVEAL_SECONDS + STEP);
    expect(game.phase).toBe('searching');
    expect(game.rounds).toBe(2);
    expect(foundOf(game, 'p1')).toBe(-1);
    expect(game.p1Set.join(',')).not.toBe(before);
  });
});

describe('the match', () => {
  it('always ends, even if neither player ever touches anything', () => {
    // Structural: a fixed number of rounds each with its own clock, so nothing about how it
    // is played can extend it.
    const { game, rng } = started();
    let steps = 0;
    const ceiling = Math.round((MAX_ROUNDS * (ROUND_SECONDS + REVEAL_SECONDS) + 5) / STEP);
    for (; steps < ceiling && game.phase !== 'over'; steps += 1) step(game, STEP, rng);
    expect(game.phase).toBe('over');
    expect(winnerOf(game)).toBe('draw');
    expect(game.rounds).toBe(MAX_ROUNDS);
  });

  it('is won by the first to the target', () => {
    const { game, rng } = started();
    for (let round = 0; round < TARGET_POINTS; round += 1) {
      touch(game, 'p1', answerFor(game, 'p1'));
      step(game, STEP, rng);
      run(game, rng, REVEAL_SECONDS + STEP);
    }
    expect(pointsOf(game, 'p1')).toBe(TARGET_POINTS);
    expect(winnerOf(game)).toBe('p1');
  });

  it('stops simulating once it is decided', () => {
    const { game, rng } = started();
    game.phase = 'over';
    game.winner = 'draw';
    const rounds = game.rounds;
    step(game, STEP, rng);
    expect(game.rounds).toBe(rounds);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('draws the same number of values per round whatever it finds', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const { game } = started(seed);
        const state = createBotState();
        const counter = new Rng(seed);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        // The first call of a round plans; the rest spend nothing.
        botTouch(game, 'p1', tier, state, counted, STEP);
        for (let i = 0; i < 200; i += 1) botTouch(game, 'p1', tier, state, counted, STEP);
        expect(draws, `${tier} seed ${String(seed)}`).toBe(BOT_DRAWS_PER_ROUND);
      }
    }
  });

  it('only ever touches a slot on the board', () => {
    for (const tier of TIERS) {
      const { game, rng } = started(3);
      const state = createBotState();
      for (let i = 0; i < 60 * 300 && game.phase !== 'over'; i += 1) {
        const slot = botTouch(game, 'p1', tier, state, rng, STEP);
        if (slot >= 0) {
          expect(slot).toBeGreaterThanOrEqual(0);
          expect(slot).toBeLessThan(SET_SIZE);
          touch(game, 'p1', slot);
        }
        step(game, STEP, rng);
      }
      expect(game.phase).toBe('over');
    }
  });

  it('searches its own set rather than being told the answer', () => {
    // A tier that simply knew the index would not be a difficulty setting. It walks an order
    // drawn before the deal is useful, one symbol at a time, and takes some real time to
    // reach a slot late in that order.
    const { game, rng } = started(2);
    const state = createBotState();
    let taken = 0;
    for (let i = 0; i < 60 * 20; i += 1) {
      const slot = botTouch(game, 'p1', 'hard', state, rng, STEP);
      taken += STEP;
      if (slot >= 0) break;
    }
    expect(taken).toBeGreaterThan(BOT_PROFILES.hard.settle);
  });

  it('finds it faster as the tier goes up', () => {
    const times = TIERS.map((tier) => searchTime(tier));
    const [easy, normal, hard] = times as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)}s normal ${normal.toFixed(2)}s`).toBeLessThan(easy);
    expect(hard, `normal ${normal.toFixed(2)}s hard ${hard.toFixed(2)}s`).toBeLessThan(normal);
  });

  it('is balanced against itself', () => {
    /*
     * Four hundred seeds, and it took three tries to believe that number.
     *
     * A match here is a dozen searches of a second or two, so a single unlucky deal moves
     * the whole result. The same `hard` pairing read 58% at eighty seeds, 61.5% at a
     * hundred and twenty, and 53% at four hundred — three answers from one unchanged game.
     * The temptation each time was to widen the band; the honest fix was more samples, and
     * the band is the one the bot issue actually asks for.
     */
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 400);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(300);
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
      const asP1 = playSeries(strong, weak, 30);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * 2);
      const asP2 = playSeries(weak, strong, 30);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * 2);
    }
  });

  it('guesses less as the tier goes up', () => {
    expect(BOT_PROFILES.hard.guesses).toBeLessThan(BOT_PROFILES.normal.guesses);
    expect(BOT_PROFILES.normal.guesses).toBeLessThan(BOT_PROFILES.easy.guesses);
  });
});

/** How long one tier takes to touch the right symbol, averaged over deals. */
function searchTime(tier: BotDifficulty): number {
  let total = 0;
  const runs = 60;
  for (let seed = 0; seed < runs; seed += 1) {
    const { game, rng } = started(200 + seed);
    const state = createBotState();
    let taken = 0;
    for (let i = 0; i < 60 * 20 && game.phase === 'searching'; i += 1) {
      const slot = botTouch(game, 'p1', tier, state, rng, STEP);
      if (slot >= 0) touch(game, 'p1', slot);
      step(game, STEP, rng);
      taken += STEP;
      if (foundOf(game, 'p1') !== -1) break;
    }
    total += taken;
  }
  return total / runs;
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const { game, rng } = started(match * 7 + 1);
    const states = { p1: createBotState(), p2: createBotState() };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const slot = botTouch(game, seat, tiers[seat], states[seat], rng, STEP);
        if (slot >= 0) touch(game, seat, slot);
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
  it('deals the identical match from the same seed', () => {
    const play = (): Game => {
      const game = createGame();
      const rng = new Rng(20260823);
      resetGame(game, rng);
      const script = new Rng(88);
      for (let i = 0; i < 60 * 300 && game.phase !== 'over'; i += 1) {
        if (script.float() < 0.02) touch(game, 'p1', Math.floor(script.float() * SET_SIZE));
        if (script.float() < 0.02) touch(game, 'p2', Math.floor(script.float() * SET_SIZE));
        step(game, STEP, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('deals a different match from a different seed', () => {
    const first = (seed: number): string => {
      const game = createGame();
      resetGame(game, new Rng(seed));
      return `${game.p1Set.join(',')}|${game.p2Set.join(',')}`;
    };
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) seen.add(first(seed));
    expect(seen.size).toBeGreaterThan(30);
  });
});
