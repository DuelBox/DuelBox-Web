import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_DRAWS_PER_TURN,
  BOT_PROFILES,
  READY_SECONDS,
  SETTLE_SECONDS,
  SET_SIZE,
  SHAPE,
  STACK_LIMIT,
  THINK_SECONDS,
  canTake,
  chooseTake,
  copiesPerKind,
  createBotRngs,
  createBotState,
  createGame,
  createView,
  depthOf,
  distinctOf,
  driveBot,
  frontKind,
  heldOf,
  rackOf,
  readView,
  resetBotState,
  resetGame,
  scorePile,
  setsOf,
  sizeOf,
  step,
  take,
  winnerOf,
} from './rules.js';
import type { BoardShape, BoardView, BotDifficulty, BotProfile, Game } from './rules.js';

const STEP = 1 / 60;
const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];
const SEATS: SeatId[] = ['p1', 'p2'];

function started(seed = 1, opener: SeatId = 'p1', shape: BoardShape = SHAPE): Game {
  const game = createGame(shape);
  resetGame(game, new Rng(seed), opener);
  return game;
}

/** Run the clocks on until the seat to move may act. */
function toChoice(game: Game): void {
  for (let i = 0; i < 1000 && game.phase !== 'choosing' && game.phase !== 'over'; i += 1) {
    step(game, STEP);
  }
}

/**
 * Stage an exact position: one card on each named pile, and an exact rack for each seat.
 *
 * Every test that is about a rule rather than about a whole match uses this, so the rule
 * is stated on a board of four or five cards rather than buried in a played-out match.
 */
function stage(
  fronts: readonly number[],
  mine: readonly number[],
  theirs: readonly number[],
  active: SeatId = 'p1',
): Game {
  const game = createGame(SHAPE);
  game.left = 0;
  for (let p = 0; p < SHAPE.piles; p += 1) {
    const kind = fronts[p] ?? -1;
    if (kind < 0) {
      game.remaining[p] = 0;
      continue;
    }
    game.cards[p * SHAPE.depth] = kind;
    game.remaining[p] = 1;
    game.left += 1;
  }
  fillRack(game, active, mine);
  fillRack(game, active === 'p1' ? 'p2' : 'p1', theirs);
  game.opener = active;
  game.active = active;
  game.phase = 'choosing';
  game.timer = 0;
  game.winner = null;
  return game;
}

function fillRack(game: Game, seat: SeatId, kinds: readonly number[]): void {
  const rack = seat === 'p1' ? game.p1Rack : game.p2Rack;
  const sorted = [...kinds].sort((a, b) => a - b);
  for (let i = 0; i <= STACK_LIMIT; i += 1) rack[i] = sorted[i] ?? -1;
  if (seat === 'p1') game.p1Size = sorted.length;
  else game.p2Size = sorted.length;
}

interface Played {
  readonly winner: SeatId | 'draw' | null;
  readonly takes: number;
  readonly p1Sets: number;
  readonly p2Sets: number;
  readonly p1Takes: number;
  readonly p2Takes: number;
  readonly game: Game;
}

/**
 * One bot-versus-bot match, driven at the rules level.
 *
 * The step guard throws rather than returning, so a regression that stopped the match
 * ending fails loudly instead of quietly reporting whatever state it was stuck in.
 */
function playMatch(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  opener: SeatId = 'p1',
  shape: BoardShape = SHAPE,
  profiles: Readonly<Record<BotDifficulty, BotProfile>> = BOT_PROFILES,
): Played {
  const rng = new Rng(seed);
  const botRng = createBotRngs(rng);
  const game = createGame(shape);
  resetGame(game, rng, opener);
  const states = { p1: createBotState(shape), p2: createBotState(shape) };
  const tiers = { p1: p1Tier, p2: p2Tier };
  const takenBy = { p1: 0, p2: 0 };
  let takes = 0;

  for (;;) {
    toChoice(game);
    if (game.phase === 'over') break;
    if (takes > shape.piles * shape.depth + 2) {
      throw new Error(`seed ${String(seed)} did not finish inside the board`);
    }
    const seat = game.active;
    const state = states[seat];
    readView(state.view, game, seat);
    const pile = chooseTake(state.view, profiles[tiers[seat]], botRng[seat]);
    expect(pile, 'a bot refused to move with cards still on the board').toBeGreaterThanOrEqual(0);
    expect(take(game, seat, pile), 'a bot chose a pile it could not take').toBe(true);
    takes += 1;
    takenBy[seat] += 1;
  }

  return {
    winner: winnerOf(game),
    takes,
    p1Sets: game.p1Sets,
    p2Sets: game.p2Sets,
    p1Takes: takenBy.p1,
    p2Takes: takenBy.p2,
    game,
  };
}

/** Seat one's share of decided matches, played from both opening seats. */
function balance(seeds: number, p1Tier: BotDifficulty, p2Tier: BotDifficulty) {
  let p1 = 0;
  let p2 = 0;
  let draws = 0;
  let openerWins = 0;
  let takes = 0;
  for (let s = 0; s < seeds; s += 1) {
    const seed = 1000003 + s * 7919;
    for (const opener of SEATS) {
      const result = playMatch(seed, p1Tier, p2Tier, opener);
      takes += result.takes;
      if (result.winner === 'draw') draws += 1;
      else if (result.winner === 'p1') p1 += 1;
      else if (result.winner === 'p2') p2 += 1;
      if (result.winner === opener) openerWins += 1;
    }
  }
  const decided = p1 + p2;
  return {
    p1,
    p2,
    draws,
    decided,
    seatOne: decided === 0 ? Number.NaN : p1 / decided,
    opener: decided === 0 ? Number.NaN : openerWins / decided,
    takes: takes / (seeds * 2),
  };
}

/* ------------------------------------------------------------------ the table */

describe('the deal', () => {
  it('is the same board from the same seed, and a different one from a different seed', () => {
    const a = started(4242);
    const b = started(4242);
    const c = started(4243);
    expect(a.cards).toEqual(b.cards);
    expect(a.cards).not.toEqual(c.cards);
  });

  it('lays every kind out the same number of times', () => {
    const game = started(99);
    const counts = new Map<number, number>();
    for (const kind of game.cards) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    expect(counts.size).toBe(SHAPE.kinds);
    for (const [, n] of counts) expect(n).toBe(copiesPerKind(SHAPE));
  });

  it('fills every pile to the same depth, with both racks empty', () => {
    const game = started(7);
    expect(game.left).toBe(SHAPE.piles * SHAPE.depth);
    for (let p = 0; p < SHAPE.piles; p += 1) expect(depthOf(game, p)).toBe(SHAPE.depth);
    for (const seat of SEATS) {
      expect(sizeOf(game, seat)).toBe(0);
      expect(setsOf(game, seat)).toBe(0);
    }
  });

  it('holds an even number of cards, so the board cannot favour whoever opens', () => {
    expect((SHAPE.piles * SHAPE.depth) % 2).toBe(0);
  });

  it('hands the first turn to the seat it is given, never to p1', () => {
    expect(started(1, 'p2').active).toBe('p2');
    expect(started(1, 'p2').opener).toBe('p2');
  });

  it('refuses a shape that would not deal evenly, or would deal an odd board', () => {
    expect(() => createGame({ piles: 6, depth: 12, kinds: 10 })).toThrow(/does not divide/);
    expect(() => createGame({ piles: 5, depth: 9, kinds: 9 })).toThrow(/odd/);
    expect(() => createGame({ piles: 0, depth: 9, kinds: 9 })).toThrow(/piles/);
  });

  it('starts frozen for longer than the shell takes to turn the board', () => {
    const game = started(1);
    expect(game.phase).toBe('ready');
    // The shell's SeatFlip runs a half turn in 0.36 s. A freeze shorter than that would
    // let a bot act while the board was still moving under a person's thumb.
    expect(READY_SECONDS).toBeGreaterThan(0.36);
    step(game, READY_SECONDS - STEP);
    expect(game.phase).toBe('ready');
    step(game, STEP);
    expect(game.phase).toBe('choosing');
  });
});

/* ------------------------------------------------------------------ taking a card */

describe('a take', () => {
  it('takes the face-up card and turns the next one up', () => {
    const game = started(11);
    toChoice(game);
    const first = frontKind(game, 2);
    expect(take(game, 'p1', 2)).toBe(true);
    expect(heldOf(game, 'p1', first)).toBe(1);
    expect(depthOf(game, 2)).toBe(SHAPE.depth - 1);
    expect(game.left).toBe(SHAPE.piles * SHAPE.depth - 1);
  });

  it('is refused, and costs nothing, from the seat whose turn it is not', () => {
    const game = stage([0, 1, 2], [], []);
    expect(canTake(game, 'p2', 0)).toBe(false);
    expect(take(game, 'p2', 0)).toBe(false);
    expect(game.left).toBe(3);
    expect(game.phase).toBe('choosing');
  });

  it('is refused on an empty pile, on a pile that is not there, and mid-freeze', () => {
    const game = stage([0, -1, 2], [], []);
    expect(take(game, 'p1', 1)).toBe(false);
    expect(take(game, 'p1', 9)).toBe(false);
    expect(take(game, 'p1', -1)).toBe(false);
    game.phase = 'ready';
    expect(take(game, 'p1', 0)).toBe(false);
    expect(game.left).toBe(2);
  });

  it('keeps a rack sorted, so matching cards always sit together', () => {
    const game = stage([5, 1, 5, 0], [], []);
    take(game, 'p1', 0);
    game.phase = 'choosing';
    take(game, 'p1', 1);
    game.phase = 'choosing';
    take(game, 'p1', 3);
    expect(rackOf(game, 'p1').slice(0, 3)).toEqual([0, 1, 5]);
  });

  it('clears three alike and scores a set, freeing two slots', () => {
    const game = stage([4], [4, 4, 2, 7], []);
    expect(take(game, 'p1', 0)).toBe(true);
    expect(setsOf(game, 'p1')).toBe(1);
    expect(sizeOf(game, 'p1')).toBe(2);
    expect(heldOf(game, 'p1', 4)).toBe(0);
    expect(game.lastResult).toBe('cleared');
  });

  it('clears from a full rack, which is the only thing that saves one', () => {
    const game = stage([3], [3, 3, 0, 1, 2, 4, 5], []);
    expect(sizeOf(game, 'p1')).toBe(STACK_LIMIT);
    expect(take(game, 'p1', 0)).toBe(true);
    expect(game.p1Out).toBe(false);
    expect(sizeOf(game, 'p1')).toBe(STACK_LIMIT - 2);
    expect(setsOf(game, 'p1')).toBe(1);
  });

  it('overflows a full rack on an eighth card that completes nothing', () => {
    const game = stage([6], [0, 0, 1, 1, 2, 2, 3], []);
    expect(take(game, 'p1', 0)).toBe(true);
    expect(game.p1Out).toBe(true);
    expect(sizeOf(game, 'p1')).toBe(STACK_LIMIT + 1);
    expect(game.lastResult).toBe('overflow');
  });

  it('never overflows below the limit, whatever the card is', () => {
    for (let size = 0; size < STACK_LIMIT; size += 1) {
      const rack: number[] = [];
      for (let i = 0; i < size; i += 1) rack.push(i);
      const game = stage([8], rack, []);
      take(game, 'p1', 0);
      expect(game.p1Out, `a rack of ${String(size)} went out`).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ turns */

describe('turns', () => {
  it('pass to the other seat once the take has been shown', () => {
    const game = stage([0, 1, 2, 3], [], []);
    take(game, 'p1', 0);
    expect(game.phase).toBe('settling');
    expect(game.active).toBe('p1');
    step(game, SETTLE_SECONDS);
    expect(game.active).toBe('p2');
    expect(game.phase).toBe('ready');
  });

  it('cost nothing while nobody takes anything', () => {
    const game = stage([0, 1], [], []);
    for (let i = 0; i < 600; i += 1) step(game, STEP);
    expect(game.phase).toBe('choosing');
    expect(game.left).toBe(2);
    expect(winnerOf(game)).toBeNull();
  });

  it('give both seats the same number of cards when the board runs out', () => {
    // The tightest thing this game claims: a match that finishes the board is even.
    const shape: BoardShape = { piles: 2, depth: 3, kinds: 3 };
    const game = createGame(shape);
    resetGame(game, new Rng(5), 'p2');
    const taken = { p1: 0, p2: 0 };
    for (let guard = 0; guard < 100 && winnerOf(game) === null; guard += 1) {
      toChoice(game);
      if (game.phase === 'over') break;
      const seat = game.active;
      for (let p = 0; p < shape.piles; p += 1) {
        if (take(game, seat, p)) {
          taken[seat] += 1;
          break;
        }
      }
    }
    expect(taken.p1).toBe(taken.p2);
  });
});

/* ------------------------------------------------------------------ how it ends */

describe('the match ending', () => {
  it('gives the other seat their reply before an overflow decides it', () => {
    // The opener acts first in every round, so without this the seat that opened would
    // simply be the one whose turn it was when the board ran out of survivable cards.
    const game = stage([6, 4], [0, 0, 1, 1, 2, 2, 3], [4, 4, 5], 'p1');
    take(game, 'p1', 0);
    expect(game.p1Out).toBe(true);
    step(game, SETTLE_SECONDS);
    expect(winnerOf(game)).toBeNull();
    expect(game.active).toBe('p2');
    toChoice(game);
    take(game, 'p2', 1);
    step(game, SETTLE_SECONDS);
    expect(winnerOf(game)).toBe('p2');
  });

  it('decides it the moment the responder overflows, because the round is done', () => {
    const game = stage([6, 5], [0, 1], [0, 0, 1, 1, 2, 2, 3], 'p1');
    take(game, 'p1', 0);
    step(game, SETTLE_SECONDS);
    toChoice(game);
    take(game, 'p2', 1);
    expect(game.p2Out).toBe(true);
    step(game, SETTLE_SECONDS);
    expect(winnerOf(game)).toBe('p1');
  });

  it('separates two racks that both went out by the tidier one', () => {
    // Both seats have taken the same number of cards, so they are level on sets by
    // arithmetic; the only thing left that can differ is the shape of the rack.
    const game = stage([6, 6], [0, 0, 1, 1, 2, 2, 3], [0, 1, 2, 3, 4, 5, 7], 'p1');
    take(game, 'p1', 0);
    step(game, SETTLE_SECONDS);
    toChoice(game);
    take(game, 'p2', 1);
    step(game, SETTLE_SECONDS);
    expect(game.p1Out && game.p2Out).toBe(true);
    expect(distinctOf(game, 'p1')).toBe(5);
    expect(distinctOf(game, 'p2')).toBe(8);
    expect(winnerOf(game)).toBe('p1');
  });

  it('is a draw when both racks go out in the same round and match shape for shape', () => {
    const game = stage([6, 6], [0, 0, 1, 1, 2, 2, 3], [0, 0, 1, 1, 2, 2, 3], 'p1');
    take(game, 'p1', 0);
    step(game, SETTLE_SECONDS);
    toChoice(game);
    take(game, 'p2', 1);
    step(game, SETTLE_SECONDS);
    expect(winnerOf(game)).toBe('draw');
  });

  it('goes to the higher set count when the board runs out with both seats standing', () => {
    const game = stage([0, 1], [], []);
    game.p1Sets = 4;
    game.p2Sets = 2;
    take(game, 'p1', 0);
    step(game, SETTLE_SECONDS);
    toChoice(game);
    take(game, 'p2', 1);
    step(game, SETTLE_SECONDS);
    expect(game.left).toBe(0);
    expect(winnerOf(game)).toBe('p1');
  });

  it('stops simulating once it is decided', () => {
    const game = stage([6, 6], [], [0, 0, 1, 1, 2, 2, 3], 'p1');
    take(game, 'p1', 0);
    step(game, SETTLE_SECONDS);
    toChoice(game);
    take(game, 'p2', 1);
    step(game, SETTLE_SECONDS);
    expect(winnerOf(game)).toBe('p1');
    const before = JSON.stringify(game);
    for (let i = 0; i < 120; i += 1) step(game, STEP);
    expect(JSON.stringify(game)).toBe(before);
  });
});

/* ------------------------------------------------------------------ termination */

describe('termination', () => {
  it('ends inside the board however badly both seats play', () => {
    // Deliberately awful: always the lowest-numbered pile, from both seats, with no
    // regard for the rack at all. The guard throws rather than returning, so a match
    // that could not finish fails here instead of passing quietly.
    for (let seed = 0; seed < 60; seed += 1) {
      const game = started(seed, seed % 2 === 0 ? 'p1' : 'p2');
      let takes = 0;
      for (;;) {
        toChoice(game);
        if (game.phase === 'over') break;
        takes += 1;
        if (takes > SHAPE.piles * SHAPE.depth) {
          throw new Error(`seed ${String(seed)} took more cards than the board holds`);
        }
        for (let p = 0; p < SHAPE.piles; p += 1) {
          if (take(game, game.active, p)) break;
        }
      }
      expect(winnerOf(game)).not.toBeNull();
      expect(game.left).toBe(SHAPE.piles * SHAPE.depth - takes);
    }
  });

  it('takes exactly one card off the board a turn, and never puts one back', () => {
    const game = started(31);
    let expected = SHAPE.piles * SHAPE.depth;
    for (let turn = 0; turn < 30; turn += 1) {
      toChoice(game);
      if (game.phase === 'over') break;
      take(game, game.active, turn % SHAPE.piles);
      expected -= 1;
      expect(game.left).toBe(expected);
    }
  });

  it('two easy bots finish well inside the ten minutes the shell allows', () => {
    // The cross-game guard plays two `easy` bots and gives them ten simulated minutes.
    // Every turn here costs a ready freeze, a settle and a think, so the budget is a
    // number of turns rather than a number of seconds.
    const perTurn = READY_SECONDS + SETTLE_SECONDS + THINK_SECONDS;
    let worst = 0;
    for (let s = 0; s < 200; s += 1) {
      const result = playMatch(1000003 + s * 7919, 'easy', 'easy', s % 2 === 0 ? 'p1' : 'p2');
      worst = Math.max(worst, result.takes);
    }
    expect(worst * perTurn).toBeLessThan(600);
    // And the structural ceiling, which no seed can exceed, is inside it too.
    expect((SHAPE.piles * SHAPE.depth + 1) * perTurn).toBeLessThan(600);
  });
});

/* ------------------------------------------------------------------ rule 6 */

describe('what the bot can see', () => {
  it('is a view with no field for the cards underneath', () => {
    const view = createView(SHAPE);
    expect(Object.keys(view).sort()).toEqual(
      ['depth', 'front', 'kinds', 'mine', 'piles', 'theirs', 'mySize', 'theirSize'].sort(),
    );
  });

  it('reads both racks and the face-up cards, and nothing else', () => {
    const game = stage([1, 2, 3], [1, 1, 4], [2, 5], 'p1');
    const view = readView(createView(game.shape), game, 'p1');
    expect(view.front).toEqual([1, 2, 3, -1, -1, -1]);
    expect(view.depth).toEqual([1, 1, 1, 0, 0, 0]);
    expect(view.mine[1]).toBe(2);
    expect(view.mine[4]).toBe(1);
    expect(view.theirs[2]).toBe(1);
    expect(view.theirs[5]).toBe(1);
    expect(view.mySize).toBe(3);
    expect(view.theirSize).toBe(2);
  });

  it('plays the identical move when the buried cards are scrambled under it', () => {
    // The behavioural half of the guarantee. `chooseTake` is never handed the board, so
    // it cannot reach the buried cards; this proves it by changing them.
    const scramble = new Rng(808);
    for (let seed = 0; seed < 40; seed += 1) {
      const game = started(seed);
      toChoice(game);
      // Run a few turns in so the racks are not empty.
      for (let t = 0; t < 9; t += 1) {
        toChoice(game);
        take(game, game.active, t % SHAPE.piles);
        step(game, SETTLE_SECONDS);
      }
      toChoice(game);
      const seat = game.active;
      const view = readView(createView(SHAPE), game, seat);
      const before = chooseTake(view, BOT_PROFILES.hard, new Rng(3));

      // Reorder everything under each pile's face-up card.
      for (let p = 0; p < SHAPE.piles; p += 1) {
        const left = depthOf(game, p);
        const buried: number[] = [];
        for (let i = 0; i < left - 1; i += 1) buried.push(game.cards[p * SHAPE.depth + i] ?? 0);
        scramble.shuffle(buried);
        for (let i = 0; i < buried.length; i += 1) game.cards[p * SHAPE.depth + i] = buried[i] ?? 0;
      }

      const after = chooseTake(
        readView(createView(SHAPE), game, seat),
        BOT_PROFILES.hard,
        new Rng(3),
      );
      expect(after, `seed ${String(seed)} played the buried cards`).toBe(before);
    }
  });
});

/* ------------------------------------------------------------------ the bot */

describe('the bot', () => {
  it('draws the same number of values for every decision, whatever it decides', () => {
    const cases: Array<[number[], number[], number[]]> = [
      [[0, 1, 2, 3, 4, 5], [], []],
      [
        [0, 1, 2, 3, 4, 5],
        [0, 0],
        [1, 1],
      ],
      [
        [0, 1, 2, 3, 4, 5],
        [0, 1, 2, 3, 4, 5, 6],
        [0, 0, 1, 1, 2, 2, 3],
      ],
      [[-1, -1, -1, -1, -1, 8], [8, 8], []],
    ];
    for (const [fronts, mine, theirs] of cases) {
      for (const tier of TIERS) {
        const game = stage(fronts, mine, theirs);
        const rng = new Rng(77);
        chooseTake(readView(createView(game.shape), game, 'p1'), BOT_PROFILES[tier], rng);
        const spent = new Rng(77);
        for (let i = 0; i < BOT_DRAWS_PER_TURN; i += 1) spent.float();
        expect(rng.save()).toEqual(spent.save());
      }
    }
  });

  it('gives each seat a stream of its own, seeded from the match', () => {
    const source = new Rng(12345);
    const a = createBotRngs(source);
    expect(a.p1.save()).not.toEqual(a.p2.save());
    const b = createBotRngs(new Rng(12345));
    expect(a.p1.save()).toEqual(b.p1.save());
  });

  it("plays its own game whatever the other seat's tier is", () => {
    // A shared stream would make each seat's play a function of how its opponent played.
    for (const tier of TIERS) {
      const versusEasy = playMatch(555, tier, 'easy');
      const versusHard = playMatch(555, tier, 'hard');
      const chosen = (r: typeof versusEasy): string => rackOf(r.game, 'p1').join(',');
      // The two matches diverge because p2 plays differently, but p1's first four takes
      // cannot depend on a tier it has not met yet.
      expect(versusEasy.p1Takes).toBeGreaterThan(0);
      expect(chosen(versusEasy).length).toBeGreaterThan(0);
      expect(chosen(versusHard).length).toBeGreaterThan(0);
    }
    const solo = (tier: BotDifficulty, seed: number): number[] => {
      const rngs = createBotRngs(new Rng(seed));
      const game = createGame();
      resetGame(game, new Rng(seed), 'p1');
      const state = createBotState();
      const picks: number[] = [];
      for (let t = 0; t < 8; t += 1) {
        toChoice(game);
        readView(state.view, game, 'p1');
        const pile = chooseTake(state.view, BOT_PROFILES[tier], rngs.p1);
        picks.push(pile);
        take(game, 'p1', pile);
        step(game, SETTLE_SECONDS);
        game.active = 'p1';
      }
      return picks;
    };
    expect(solo('hard', 999)).toEqual(solo('hard', 999));
  });

  it('never walks into an overflow when a card it can survive is face up', () => {
    // A full rack — two of one kind and five singletons — with the rescue kind sitting on
    // exactly one of the six piles and every other pile holding something fatal.
    const others = (rescue: number): number[] => {
      const rest: number[] = [];
      for (let k = 0; k < SHAPE.kinds && rest.length < 5; k += 1) {
        if (k !== rescue) rest.push(k);
      }
      return rest;
    };
    for (const tier of TIERS) {
      // Slip is a careless take, not a policy; this is about what the policy chooses.
      const profile = { ...BOT_PROFILES[tier], slip: 0 };
      for (let seed = 0; seed < 400; seed += 1) {
        const rescue = seed % SHAPE.kinds;
        const rest = others(rescue);
        const rack = [rescue, rescue, ...rest];
        const fatal = SHAPE.kinds - 1 === rescue ? SHAPE.kinds - 2 : SHAPE.kinds - 1;
        const fronts: number[] = [];
        for (let p = 0; p < SHAPE.piles; p += 1)
          fronts.push(p === seed % SHAPE.piles ? rescue : fatal);
        const game = stage(fronts, rack, []);
        expect(sizeOf(game, 'p1')).toBe(STACK_LIMIT);
        const pile = chooseTake(
          readView(createView(game.shape), game, 'p1'),
          profile,
          new Rng(seed),
        );
        take(game, 'p1', pile);
        expect(game.p1Out, `${tier} overflowed with a rescue on the board`).toBe(false);
        expect(setsOf(game, 'p1')).toBe(1);
      }
    }
  });

  it('takes the card the other seat needs, once it has learned to look', () => {
    // p1 holds nothing useful; p2 is one card from a set and nearly full. `hard` takes it
    // away; `easy` has not learned to look at the other rack at all.
    const fronts = [0, 1, 2, 3, 4, 5];
    const theirs = [5, 5, 0, 1, 2, 3, 4];
    let hardDenied = 0;
    let easyDenied = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const game = stage(fronts, [6, 7], theirs);
      const view = readView(createView(game.shape), game, 'p1');
      if (chooseTake(view, BOT_PROFILES.hard, new Rng(seed)) === 5) hardDenied += 1;
      if (chooseTake(view, BOT_PROFILES.easy, new Rng(seed)) === 5) easyDenied += 1;
    }
    expect(hardDenied).toBe(200);
    expect(easyDenied).toBeLessThan(120);
  });

  it('waits its think delay before taking anything', () => {
    const game = started(3);
    const state = createBotState();
    const rng = new Rng(1);
    toChoice(game);
    const steps = Math.round(THINK_SECONDS / STEP);
    for (let i = 0; i < steps - 1; i += 1) {
      expect(driveBot(game, 'p1', 'normal', state, rng, STEP)).toBe(false);
    }
    // One extra step of slack: the countdown is in seconds and a frame of 1/60 does not
    // divide 0.45 exactly, so the last frame may land a hair short of zero. Deterministic
    // either way — every device steps the same fixed delta — but not exact.
    let took = false;
    for (let i = 0; i < 2 && !took; i += 1) {
      took = driveBot(game, 'p1', 'normal', state, rng, STEP);
    }
    expect(took).toBe(true);
    expect(game.left).toBe(SHAPE.piles * SHAPE.depth - 1);
  });

  it('does nothing at all on a seat that is not to move', () => {
    const game = started(3);
    toChoice(game);
    const state = createBotState();
    resetBotState(state);
    const rng = new Rng(1);
    for (let i = 0; i < 200; i += 1) {
      expect(driveBot(game, 'p2', 'hard', state, rng, STEP)).toBe(false);
    }
    expect(rng.save()).toEqual(new Rng(1).save());
  });
});

/* ------------------------------------------------------------------ symmetry */

describe('mirror symmetry', () => {
  /**
   * The half-turn this game makes is a *seat* swap, not a spatial one — both seats read
   * the same six piles, in the same order, from opposite sides of the table. So the
   * property that must hold is that the two seats are the same player: relabel the racks
   * and the same board must produce the same decision.
   *
   * This is the test Snowball Throw's 64.3% seat-one share was found with, in the form
   * this game's geometry gives it.
   */
  it('gives the same answer to the same position from either seat', () => {
    const rng = new Rng(20260829);
    for (let trial = 0; trial < 400; trial += 1) {
      const fronts: number[] = [];
      for (let p = 0; p < 6; p += 1) fronts.push(rng.int(0, SHAPE.kinds));
      const mine = randomRack(rng);
      const theirs = randomRack(rng);
      for (const tier of TIERS) {
        const asP1 = stage(fronts, mine, theirs, 'p1');
        const asP2 = stage(fronts, mine, theirs, 'p2');
        const one = chooseTake(
          readView(createView(asP1.shape), asP1, 'p1'),
          BOT_PROFILES[tier],
          new Rng(trial),
        );
        const two = chooseTake(
          readView(createView(asP2.shape), asP2, 'p2'),
          BOT_PROFILES[tier],
          new Rng(trial),
        );
        expect(two, `${tier} played seat two differently on trial ${String(trial)}`).toBe(one);
      }
    }
  });

  it('scores a pile by what is on it, never by where it is', () => {
    // Position independence is the honest model here: with the rest of a pile face down,
    // the only knowable consequence of a take is that the card has left the board. A
    // tie-break in board coordinates is what this would catch, and it is exactly the
    // defect that cost Snowball Throw its balance.
    const rng = new Rng(4242);
    for (let trial = 0; trial < 300; trial += 1) {
      const fronts: number[] = [];
      for (let p = 0; p < 6; p += 1) fronts.push(rng.int(0, SHAPE.kinds));
      const game = stage(fronts, randomRack(rng), randomRack(rng));
      const view = readView(createView(game.shape), game, 'p1');
      const scores = fronts.map((_, p) => scorePile(view, BOT_PROFILES.hard, p));

      const order = [5, 3, 1, 4, 0, 2];
      const shuffledFronts = order.map((p) => fronts[p] ?? 0);
      const shuffled = stage(
        shuffledFronts,
        [...rackOf(game, 'p1')].filter((k) => k >= 0),
        [...rackOf(game, 'p2')].filter((k) => k >= 0),
      );
      const shuffledView = readView(createView(shuffled.shape), shuffled, 'p1');
      const moved = order.map((_, p) => scorePile(shuffledView, BOT_PROFILES.hard, p));
      expect(moved).toEqual(order.map((p) => scores[p]));
    }
  });

  function randomRack(rng: Rng): number[] {
    const size = rng.int(0, STACK_LIMIT + 1);
    const held: number[] = [];
    const counts = new Map<number, number>();
    let guard = 0;
    while (held.length < size && guard < 200) {
      guard += 1;
      const kind = rng.int(0, SHAPE.kinds);
      const n = counts.get(kind) ?? 0;
      if (n >= SET_SIZE - 1) continue;
      counts.set(kind, n + 1);
      held.push(kind);
    }
    return held;
  }
});

/* ------------------------------------------------------------------ the ladder */

describe('the ladder', () => {
  it('is monotone at the solo game, which is the reference game', () => {
    // One seat alone against the board, taking until its rack goes out. No opponent, so
    // this measures nothing but how well a tier manages seven slots.
    const survived = (tier: BotDifficulty): number => {
      let total = 0;
      for (let s = 0; s < 300; s += 1) {
        const seed = 90001 + s * 7919;
        const rng = new Rng(seed);
        const rngs = createBotRngs(rng);
        const game = createGame();
        resetGame(game, rng, 'p1');
        const state = createBotState();
        let taken = 0;
        while (!game.p1Out && game.left > 0) {
          readView(state.view, game, 'p1');
          const pile = chooseTake(state.view, BOT_PROFILES[tier], rngs.p1);
          if (pile < 0) break;
          game.phase = 'choosing';
          game.active = 'p1';
          take(game, 'p1', pile);
          taken += 1;
        }
        total += taken;
      }
      return total / 300;
    };
    const easy = survived('easy');
    const normal = survived('normal');
    const hard = survived('hard');
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
    expect(easy).toBeGreaterThan(8);
  });

  it('beats a weaker tier from either seat', () => {
    for (const [strong, weak] of [
      ['hard', 'easy'],
      ['hard', 'normal'],
      ['normal', 'easy'],
    ] as Array<[BotDifficulty, BotDifficulty]>) {
      const asP1 = balance(120, strong, weak);
      const asP2 = balance(120, weak, strong);
      const share1 = asP1.p1 / asP1.decided;
      const share2 = asP2.p2 / asP2.decided;
      expect(share1, `${strong} as p1 v ${weak}`).toBeGreaterThan(0.6);
      expect(share2, `${weak} v ${strong} as p2`).toBeGreaterThan(0.6);
      // And it agrees with itself: a tier number measured from one chair is a tier
      // number plus a chair number, with nothing to say how much of each.
      expect(Math.abs(share1 - share2)).toBeLessThan(0.08);
    }
  });

  it('is balanced against itself, from both seats and from both openings', () => {
    for (const tier of TIERS) {
      const result = balance(200, tier, tier);
      expect(result.seatOne, `${tier} seat one`).toBeGreaterThan(0.43);
      expect(result.seatOne, `${tier} seat one`).toBeLessThan(0.57);
      expect(result.opener, `${tier} opener`).toBeGreaterThan(0.43);
      expect(result.opener, `${tier} opener`).toBeLessThan(0.57);
    }
  });

  it('leaves few enough matches undecided that the score is doing work', () => {
    for (const tier of TIERS) {
      const result = balance(150, tier, tier);
      expect(result.draws / (result.decided + result.draws), `${tier} draws`).toBeLessThan(0.2);
    }
  });

  it('does not play the identical match at two tiers', () => {
    // The failure this catches is a game that accepts a tier and ignores it. One seed is
    // not enough — two different matches can land on the same length by coincidence.
    let differed = 0;
    for (let s = 0; s < 30; s += 1) {
      const seed = 4321 + s * 7919;
      const signature = (r: ReturnType<typeof playMatch>): string =>
        `${String(r.winner)}:${String(r.takes)}:${String(r.p1Sets)}:${String(r.p2Sets)}`;
      if (
        signature(playMatch(seed, 'easy', 'easy')) !== signature(playMatch(seed, 'hard', 'hard'))
      ) {
        differed += 1;
      }
    }
    expect(differed).toBeGreaterThan(25);
  });
});

/* ------------------------------------------------------------------ determinism */

describe('determinism', () => {
  it('replays the identical match from the same seed and the same opener', () => {
    for (const opener of SEATS) {
      const a = playMatch(24680, 'normal', 'hard', opener);
      const b = playMatch(24680, 'normal', 'hard', opener);
      expect(b.winner).toBe(a.winner);
      expect(b.takes).toBe(a.takes);
      expect(b.p1Sets).toBe(a.p1Sets);
      expect(b.p2Sets).toBe(a.p2Sets);
    }
  });

  it('plays a different match from a different opener', () => {
    let differed = 0;
    for (let s = 0; s < 40; s += 1) {
      const seed = 1000003 + s * 7919;
      const a = playMatch(seed, 'normal', 'normal', 'p1');
      const b = playMatch(seed, 'normal', 'normal', 'p2');
      if (a.winner !== b.winner || a.takes !== b.takes) differed += 1;
    }
    // If this were zero the game would be ignoring `openingSeat`, which is the defect
    // #2487 is tracking across thirty-four older games.
    expect(differed).toBeGreaterThan(20);
  });

  it('is a fresh board again after a reset', () => {
    const game = started(17);
    toChoice(game);
    take(game, 'p1', 0);
    step(game, SETTLE_SECONDS);
    resetGame(game, new Rng(17), 'p1');
    expect(game.left).toBe(SHAPE.piles * SHAPE.depth);
    expect(sizeOf(game, 'p1')).toBe(0);
    expect(game.p1Out).toBe(false);
    expect(winnerOf(game)).toBeNull();
    expect(game.cards).toEqual(started(17).cards);
  });
});

/* ------------------------------------------------------------------ helpers used above */

describe('the view helpers', () => {
  it('count a rack by kind and by distinct kinds', () => {
    const game = stage([0], [1, 1, 4, 4, 7], []);
    expect(heldOf(game, 'p1', 1)).toBe(2);
    expect(heldOf(game, 'p1', 7)).toBe(1);
    expect(heldOf(game, 'p1', 3)).toBe(0);
    expect(distinctOf(game, 'p1')).toBe(3);
    expect(distinctOf(game, 'p2')).toBe(0);
  });

  it('report an empty pile as no card at all', () => {
    const game = stage([-1, 3], [], []);
    expect(frontKind(game, 0)).toBe(-1);
    expect(depthOf(game, 0)).toBe(0);
    expect(frontKind(game, 1)).toBe(3);
    expect(frontKind(game, 99)).toBe(-1);
  });

  it('score an empty pile below anything a legal one can score', () => {
    const game = stage([-1, 0], [0, 0, 1, 1, 2, 2, 3], []);
    const view: BoardView = readView(createView(game.shape), game, 'p1');
    expect(scorePile(view, BOT_PROFILES.hard, 0)).toBeLessThan(
      scorePile(view, BOT_PROFILES.hard, 1),
    );
  });
});
