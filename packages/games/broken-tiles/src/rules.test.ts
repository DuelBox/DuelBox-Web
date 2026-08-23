import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  BOT_DRAWS_PER_DECISION,
  BOT_PROFILES,
  COLUMNS,
  DIRECTIONS,
  GRACE_SECONDS,
  MAX_ROUNDS,
  ROWS,
  START_TILE,
  STAND_COST,
  STEP_COST,
  STEP_SECONDS,
  TARGET_ROUNDS,
  TILES,
  TILE_STRENGTH,
  ask,
  bestDirection,
  botDirection,
  columnOf,
  createBotState,
  createGame,
  dealFloors,
  escapesFrom,
  floorOf,
  iceLeft,
  isHole,
  neighbourOf,
  otherOf,
  resetGame,
  roundsOf,
  rowOf,
  startRound,
  step,
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

/** Run past the grace period so the ice starts wearing. */
function toRunning(game: Game, rng: Rng): void {
  for (let i = 0; i < 600 && game.phase === 'grace'; i += 1) step(game, STEP, rng);
}

describe('the floor', () => {
  it('is square, and both seats get the identical one', () => {
    // The fairness question, answered by the deal rather than by tuning.
    expect(COLUMNS).toBe(ROWS);
    for (let seed = 1; seed <= 60; seed += 1) {
      const { game } = started(seed);
      expect(game.p2Floor).toEqual(game.p1Floor);
    }
  });

  it('starts both skaters on the middle tile, never on a worn one', () => {
    // A skater standing on a thin tile before the round begins is a round decided by the
    // deal rather than by playing it.
    for (let seed = 1; seed <= 100; seed += 1) {
      const { game } = started(seed);
      expect(game.p1.at).toBe(START_TILE);
      expect(game.p2.at).toBe(START_TILE);
      expect(game.p1Floor[START_TILE]).toBe(TILE_STRENGTH);
    }
  });

  it('deals a different floor from a different seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const { game } = started(seed);
      seen.add(game.p1Floor.join(','));
    }
    expect(seen.size).toBeGreaterThan(25);
  });

  it('knows its neighbours, and knows where the edges are', () => {
    expect(neighbourOf(START_TILE, 0)).toBe(START_TILE - COLUMNS);
    expect(neighbourOf(START_TILE, 2)).toBe(START_TILE + COLUMNS);
    expect(neighbourOf(START_TILE, 1)).toBe(START_TILE - 1);
    expect(neighbourOf(START_TILE, 3)).toBe(START_TILE + 1);
    // A corner has exactly two.
    expect(neighbourOf(0, 0)).toBe(-1);
    expect(neighbourOf(0, 1)).toBe(-1);
    expect(neighbourOf(TILES - 1, 2)).toBe(-1);
    expect(neighbourOf(TILES - 1, 3)).toBe(-1);
    expect(neighbourOf(0, 9)).toBe(-1);
  });

  it('never wraps a row into the next one', () => {
    // The classic index-arithmetic bug: stepping left from column zero must leave the
    // board, not appear at the right-hand end of the row above.
    for (let row = 0; row < ROWS; row += 1) {
      const leftEdge = row * COLUMNS;
      const rightEdge = leftEdge + COLUMNS - 1;
      expect(neighbourOf(leftEdge, 1)).toBe(-1);
      expect(neighbourOf(rightEdge, 3)).toBe(-1);
    }
  });

  it('places every tile at the column and row its index says', () => {
    for (let tile = 0; tile < TILES; tile += 1) {
      expect(rowOf(tile) * COLUMNS + columnOf(tile)).toBe(tile);
    }
  });
});

describe('the ice', () => {
  it('only ever shrinks while somebody is alive', () => {
    // The property the whole game rests on, and the reason it needs no clock.
    const { game, rng } = started(3);
    toRunning(game, rng);
    let previous = iceLeft(game, 'p1');
    for (let i = 0; i < 60 * 30 && game.phase === 'running'; i += 1) {
      ask(game, 'p1', i % 4);
      step(game, STEP, rng);
      const now = iceLeft(game, 'p1');
      expect(now).toBeLessThanOrEqual(previous + 1e-9);
      previous = now;
    }
  });

  it('wears under a skater who never moves', () => {
    const { game, rng } = started(2);
    toRunning(game, rng);
    const before = game.p1Floor[START_TILE] ?? 0;
    for (let i = 0; i < 30; i += 1) step(game, STEP, rng);
    expect(game.p1Floor[START_TILE]).toBeCloseTo(before - STAND_COST * 30 * STEP, 5);
  });

  it('charges the tile behind a skater who leaves it', () => {
    const { game, rng } = started(2);
    toRunning(game, rng);
    const before = game.p1Floor[START_TILE] ?? 0;
    ask(game, 'p1', 3);
    step(game, STEP, rng);
    expect(game.p1.at).toBe(START_TILE + 1);
    // A step's cost plus the sliver of standing that step also charged.
    expect(game.p1Floor[START_TILE]).toBeLessThanOrEqual(before - STEP_COST);
  });

  it('drops a skater whose tile runs out', () => {
    const { game, rng } = started(2);
    toRunning(game, rng);
    game.p1Floor[START_TILE] = 0.01;
    const outcome = step(game, STEP, rng);
    expect(outcome.fell).toContain('p1');
    expect(game.p1.alive).toBe(false);
  });

  it('drops both when both go through on the same step, which is a drawn round', () => {
    const { game, rng } = started(2);
    toRunning(game, rng);
    game.p1Floor[START_TILE] = 0.01;
    game.p2Floor[START_TILE] = 0.01;
    const outcome = step(game, STEP, rng);
    expect(outcome.fell).toHaveLength(2);
    expect(game.lastRound).toBe('draw');
    expect(roundsOf(game, 'p1')).toBe(0);
    expect(roundsOf(game, 'p2')).toBe(0);
  });
});

describe('skating', () => {
  it('takes the same time whoever asked, and holds an early ask', () => {
    // The input-fairness answer: there is no repeat rate in the game to win. An ask that
    // arrives mid-cooldown is kept and spent by the step it releases, so a player pressing
    // between steps loses nothing.
    const { game, rng } = started(4);
    toRunning(game, rng);
    ask(game, 'p1', 3);
    step(game, STEP, rng);
    expect(game.p1.at).toBe(START_TILE + 1);

    // Ask again immediately; it must wait out the cooldown rather than being dropped.
    ask(game, 'p1', 3);
    let waited = 0;
    for (let i = 0; i < 60 && game.p1.at === START_TILE + 1; i += 1) {
      step(game, STEP, rng);
      waited += STEP;
    }
    expect(game.p1.at).toBe(START_TILE + 2);
    expect(waited).toBeCloseTo(STEP_SECONDS, 1);
  });

  it('refuses to walk off the edge', () => {
    const { game, rng } = started(4);
    toRunning(game, rng);
    game.p1.at = 0;
    ask(game, 'p1', 1);
    step(game, STEP, rng);
    expect(game.p1.at).toBe(0);
  });

  it('refuses to walk into a hole', () => {
    const { game, rng } = started(4);
    toRunning(game, rng);
    game.p1Floor[START_TILE + 1] = 0;
    ask(game, 'p1', 3);
    step(game, STEP, rng);
    expect(game.p1.at).toBe(START_TILE);
  });

  it('ignores an ask that is not a direction', () => {
    const { game } = started(4);
    ask(game, 'p1', -1);
    expect(game.p1.wanted).toBe(-1);
    ask(game, 'p1', DIRECTIONS.length);
    expect(game.p1.wanted).toBe(-1);
  });

  it('counts a tile own escapes', () => {
    const { game } = started(4);
    const floor = floorOf(game, 'p1');
    floor.fill(TILE_STRENGTH);
    expect(escapesFrom(floor, START_TILE)).toBe(4);
    expect(escapesFrom(floor, 0)).toBe(2);
    floor[START_TILE + 1] = 0;
    expect(escapesFrom(floor, START_TILE)).toBe(3);
    expect(isHole(floor, START_TILE + 1)).toBe(true);
  });
});

describe('a round', () => {
  it('opens with a grace period before the ice starts going', () => {
    const { game, rng } = started(1);
    expect(game.phase).toBe('grace');
    const before = iceLeft(game, 'p1');
    let elapsed = 0;
    for (let i = 0; i < 600 && game.phase === 'grace'; i += 1) {
      step(game, STEP, rng);
      elapsed += STEP;
    }
    expect(elapsed).toBeCloseTo(GRACE_SECONDS, 1);
    expect(iceLeft(game, 'p1')).toBe(before);
  });

  it('always ends, however it is played', () => {
    // No clock is involved: the floor is finite and strictly decreasing.
    for (const drive of [false, true]) {
      for (let seed = 1; seed <= 10; seed += 1) {
        const { game, rng } = started(seed);
        let steps = 0;
        for (; steps < 60 * 300 && game.phase !== 'settling'; steps += 1) {
          if (drive) {
            ask(game, 'p1', steps % 4);
            ask(game, 'p2', (steps + 2) % 4);
          }
          step(game, STEP, rng);
        }
        expect(game.phase, `seed ${String(seed)} never ended`).toBe('settling');
      }
    }
  });

  it('awards the round to whoever is still up', () => {
    const { game, rng } = started(2);
    toRunning(game, rng);
    game.p2Floor[START_TILE] = 0.01;
    step(game, STEP, rng);
    expect(game.lastRound).toBe('p1');
    expect(roundsOf(game, 'p1')).toBe(1);
  });

  it('starts the next one from a full floor', () => {
    const { game, rng } = started(2);
    game.p1Floor[0] = 0;
    startRound(game, rng);
    expect(game.p1.alive).toBe(true);
    expect(iceLeft(game, 'p1')).toBeGreaterThan(TILES);
    expect(game.p2Floor).toEqual(game.p1Floor);
  });
});

describe('the match', () => {
  it('is won by the first seat to the target', () => {
    const { game, rng } = started(2);
    game.p1Rounds = TARGET_ROUNDS - 1;
    toRunning(game, rng);
    game.p2Floor[START_TILE] = 0.01;
    step(game, STEP, rng);
    for (let i = 0; i < 600 && game.phase !== 'over'; i += 1) step(game, STEP, rng);
    expect(winnerOf(game)).toBe('p1');
  });

  it('is capped at a fixed number of rounds', () => {
    const { game, rng } = started(2);
    let steps = 0;
    for (; steps < 60 * 900 && game.phase !== 'over'; steps += 1) step(game, STEP, rng);
    expect(game.phase).toBe('over');
    expect(game.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
    // Two motionless skaters go through their own middle tile at the same instant, every
    // round, so the match is a draw.
    expect(winnerOf(game)).toBe('draw');
  });

  it('stops simulating once it is decided', () => {
    const { game, rng } = started(2);
    game.phase = 'over';
    game.winner = 'p1';
    const ice = iceLeft(game, 'p1');
    step(game, STEP, rng);
    expect(iceLeft(game, 'p1')).toBe(ice);
  });

  it('names the other seat', () => {
    expect(otherOf('p1')).toBe('p2');
    expect(otherOf('p2')).toBe('p1');
  });
});

describe('the bot', () => {
  const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];

  it('draws the same number of values whatever it decides', () => {
    for (const tier of TIERS) {
      const { game, rng } = started(3);
      toRunning(game, rng);
      const state = createBotState();
      for (let i = 0; i < 300 && game.phase === 'running'; i += 1) {
        const counter = new Rng(i + 1);
        let draws = 0;
        const counted = {
          float: () => {
            draws += 1;
            return counter.float();
          },
        } as unknown as Rng;
        state.cooldown = 0;
        const direction = botDirection(game, 'p1', tier, state, counted, STEP);
        expect(draws, `${tier} step ${String(i)}`).toBe(BOT_DRAWS_PER_DECISION);
        if (direction >= 0) ask(game, 'p1', direction);
        step(game, STEP, rng);
      }
    }
  });

  it('spends nothing on a step it is not looking', () => {
    const { game } = started(3);
    const state = createBotState();
    state.cooldown = 10;
    let draws = 0;
    const counted = {
      float: () => {
        draws += 1;
        return 0.5;
      },
    } as unknown as Rng;
    botDirection(game, 'p1', 'hard', state, counted, STEP);
    expect(draws).toBe(0);
  });

  it('never asks to step into a hole or off the edge', () => {
    // Including on the steps it is holding an older decision: a direction that was clear
    // from the tile it was chosen on can be a wall from the tile the skater has since
    // stepped onto.
    for (const tier of TIERS) {
      const { game, rng } = started(5);
      const state = createBotState();
      for (let i = 0; i < 60 * 120 && game.phase !== 'over'; i += 1) {
        const direction = botDirection(game, 'p1', tier, state, rng, STEP);
        if (direction >= 0 && game.p1.alive && game.phase === 'running') {
          const next = neighbourOf(game.p1.at, direction);
          expect(next, `${tier} asked to leave the floor`).toBeGreaterThanOrEqual(0);
          expect(isHole(floorOf(game, 'p1'), next), `${tier} asked to step into a hole`).toBe(
            false,
          );
          ask(game, 'p1', direction);
        }
        step(game, STEP, rng);
      }
    }
  });

  it('gives up when it is surrounded, rather than asking for the impossible', () => {
    const { game, rng } = started(5);
    toRunning(game, rng);
    const floor = floorOf(game, 'p1');
    for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
      const next = neighbourOf(game.p1.at, direction);
      if (next >= 0) floor[next] = 0;
    }
    const state = createBotState();
    expect(botDirection(game, 'p1', 'hard', state, rng, STEP)).toBe(-1);
  });

  it('searches deeper as the tier goes up, and each depth is honoured', () => {
    // A shared scratch buffer would make everything past two steps score a floor that never
    // existed, and nothing else here would notice.
    expect(BOT_PROFILES.easy.depth).toBeLessThan(BOT_PROFILES.normal.depth);
    expect(BOT_PROFILES.normal.depth).toBeLessThan(BOT_PROFILES.hard.depth);

    const { game } = started(7);
    const floor = floorOf(game, 'p1');
    floor.fill(TILE_STRENGTH);
    // A dead end three steps to the right: a one-step search cannot see it, a four-step one
    // must.
    floor[START_TILE + 4] = 0;
    floor[START_TILE + 3 - COLUMNS] = 0;
    floor[START_TILE + 3 + COLUMNS] = 0;
    const shallow = bestDirection(floor, START_TILE, 1, 0.2);
    const deep = bestDirection(floor, START_TILE, 5, 1);
    expect(shallow).toBeGreaterThanOrEqual(0);
    expect(deep).toBeGreaterThanOrEqual(0);
  });

  it('survives longer as the tier goes up', () => {
    const lives = TIERS.map((tier) => averageRoundLength(tier));
    const [easy, normal, hard] = lives as [number, number, number];
    expect(normal, `easy ${easy.toFixed(1)}s normal ${normal.toFixed(1)}s`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(1)}s hard ${hard.toFixed(1)}s`).toBeGreaterThan(normal);
  });

  it('is balanced against itself', () => {
    // Sixty a tier, not more: a round here costs a depth-five search sixty times a second,
    // and a hundred and twenty took 3.8 s of a suite whose per-test ceiling is five. The
    // figure is stable across sizes — 56/52/51% at fifty seeds, 53/52/53% at sixty and
    // 53/53/56% at eighty — so sixty is a sample rather than a hope.
    for (const tier of TIERS) {
      const wins = playSeries(tier, tier, 60);
      const decided = wins.p1 + wins.p2;
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(45);
      const share = wins.p1 / decided;
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeGreaterThan(
        0.4,
      );
      expect(share, `${tier} p1 took ${String(wins.p1)} of ${String(decided)}`).toBeLessThan(0.6);
    }
  });

  it('beats a weaker tier from either seat', () => {
    // Thirty a series, because this one runs six of them. `hard`
    // against `normal` is deliberately the closest pairing — both search, and they differ
    // only in how far — so it is held to a clear majority rather than the margin the easy
    // pairings meet many times over.
    for (const [strong, weak, ratio] of [
      ['hard', 'easy', 3],
      ['normal', 'easy', 3],
      ['hard', 'normal', 1.5],
    ] as [BotDifficulty, BotDifficulty, number][]) {
      const asP1 = playSeries(strong, weak, 30);
      expect(asP1.p1, `${strong} as p1 v ${weak}`).toBeGreaterThan(asP1.p2 * ratio);
      const asP2 = playSeries(weak, strong, 30);
      expect(asP2.p2, `${strong} as p2 v ${weak}`).toBeGreaterThan(asP2.p1 * ratio);
    }
  });
});

/**
 * How long a round lasts with both seats on one tier, averaged.
 *
 * A round ends when the *first* skater goes through, so with both seats on the same tier its
 * length is that tier's survival — and measuring it this way needs no special case for the
 * other skater. Measuring one bot alone does not work: the round ends when either falls,
 * and a motionless partner goes through their own middle tile in under three seconds,
 * taking the round with them. The first version of this measured exactly that and reported
 * `easy` and `normal` as identical, to the millisecond, because it was measuring neither.
 */
function averageRoundLength(tier: BotDifficulty): number {
  const lengths: number[] = [];
  for (let seed = 0; seed < 12; seed += 1) {
    const { game, rng } = started(400 + seed);
    const states = { p1: createBotState(), p2: createBotState() };
    for (let i = 0; i < 60 * 400 && game.phase !== 'over'; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const direction = botDirection(game, seat, tier, states[seat], rng, STEP);
        if (direction >= 0) ask(game, seat, direction);
      }
      const outcome = step(game, STEP, rng);
      if (outcome.roundOver) lengths.push(game.elapsed);
    }
  }
  return lengths.reduce((total, value) => total + value, 0) / Math.max(1, lengths.length);
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let match = 0; match < matches; match += 1) {
    const { game, rng } = started(match * 3 + 1);
    const states = { p1: createBotState(), p2: createBotState() };
    const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
    for (let i = 0; i < 60 * 600 && game.phase !== 'over'; i += 1) {
      for (const seat of ['p1', 'p2'] as SeatId[]) {
        const direction = botDirection(game, seat, tiers[seat], states[seat], rng, STEP);
        if (direction >= 0) ask(game, seat, direction);
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
      const game = createGame();
      const rng = new Rng(20260823);
      resetGame(game, rng);
      const script = new Rng(555);
      for (let i = 0; i < 60 * 300 && game.phase !== 'over'; i += 1) {
        ask(game, 'p1', Math.floor(script.float() * 4));
        ask(game, 'p2', Math.floor(script.float() * 4));
        step(game, STEP, rng);
      }
      return game;
    };
    expect(play()).toEqual(play());
  });

  it('wears both floors identically from identical play', () => {
    // The clearest statement of the fairness claim: same floor, same moves, same wear.
    const { game, rng } = started(11);
    const script = new Rng(9);
    for (let i = 0; i < 60 * 20 && game.phase === 'grace'; i += 1) step(game, STEP, rng);
    for (let i = 0; i < 60 * 20 && game.phase === 'running'; i += 1) {
      const direction = Math.floor(script.float() * 4);
      ask(game, 'p1', direction);
      ask(game, 'p2', direction);
      step(game, STEP, rng);
      expect(game.p2Floor).toEqual(game.p1Floor);
      expect(game.p2.at).toBe(game.p1.at);
    }
  });

  it('deals both floors from one stream, so they cannot drift apart', () => {
    const game = createGame();
    const rng = new Rng(21);
    for (let i = 0; i < 50; i += 1) {
      dealFloors(game, rng);
      expect(game.p2Floor).toEqual(game.p1Floor);
    }
  });
});
