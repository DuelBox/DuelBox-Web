import { describe, expect, it } from 'vitest';
import { Rng, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES } from '@duelbox/game-sdk';
import {
  BLUNDER_CHANCE,
  BOT_DRAWS_PER_MOVE,
  CELL_COUNT,
  DIRECTION_COUNT,
  DOWN,
  GAP,
  LEFT,
  MOVES_PER_SEAT,
  RIGHT,
  SEARCH_DEPTH,
  SHUFFLE_ATTEMPTS,
  SHUFFLE_WALK,
  SLIDES_PER_TURN,
  TILE_COUNT,
  UP,
  applyMove,
  bank,
  botMove,
  cellDistance,
  createBotRngs,
  createMatch,
  gapOf,
  homeCellFor,
  homeCount,
  homeDistance,
  isLegalMove,
  judge,
  legalMovesInto,
  movesLeft,
  opposite,
  resetMatch,
  rotateBoard,
  rotateCell,
  shuffleInto,
  solvedInto,
  stepCell,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Match } from './rules.js';

const TIERS: BotDifficulty[] = ['easy', 'normal', 'hard'];
const SEATS: SeatId[] = ['p1', 'p2'];

function emptyBoard(): number[] {
  const board: number[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell += 1) board.push(GAP);
  return board;
}

function solvedBoard(): number[] {
  const board = emptyBoard();
  solvedInto(board);
  return board;
}

function rotatedCopy(board: readonly number[]): number[] {
  const copy = [...board];
  rotateBoard(copy);
  return copy;
}

/** A packed key for a position, so a whole state space fits in a Set. */
function keyOf(board: readonly number[]): number {
  let key = 0;
  for (let cell = 0; cell < CELL_COUNT; cell += 1) key = key * CELL_COUNT + (board[cell] ?? 0);
  return key;
}

/**
 * Every position a legal slide can reach from the finished board.
 *
 * Breadth-first over the whole graph, with the takeback ban lifted — the ban is a rule of
 * the *match*, not of the puzzle, and the question here is which arrangements exist at all.
 */
function reachableOrbit(): Set<number> {
  const start = solvedBoard();
  const seen = new Set<number>([keyOf(start)]);
  const frontier: number[][] = [start];
  const moves: number[] = [0, 0, 0, 0];
  while (frontier.length > 0) {
    const board = frontier.pop();
    if (board === undefined) break;
    const gap = gapOf(board);
    const count = legalMovesInto(gap, -1, moves);
    for (let i = 0; i < count; i += 1) {
      const from = stepCell(gap, moves[i] ?? 0);
      const next = [...board];
      next[gap] = next[from] ?? GAP;
      next[from] = GAP;
      const key = keyOf(next);
      if (seen.has(key)) continue;
      seen.add(key);
      frontier.push(next);
    }
  }
  return seen;
}

/** A started match on the seed's own board. */
function started(seed: number, openingSeat: SeatId = 'p1'): Match {
  const match = createMatch();
  resetMatch(match, new Rng(seed), openingSeat);
  return match;
}

interface Played {
  readonly match: Match;
  readonly order: SeatId[];
  readonly slides: number[];
}

/**
 * One bot-versus-bot match with **no frame cap at all**: a match that failed to terminate
 * would hang the suite rather than pass quietly.
 */
function playMatch(
  seed: number,
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  openingSeat: SeatId = 'p1',
): Played {
  const match = createMatch();
  const rng = new Rng(seed);
  const rngs = createBotRngs(rng);
  resetMatch(match, rng, openingSeat);
  const tiers: Record<SeatId, BotDifficulty> = { p1: p1Tier, p2: p2Tier };
  const order: SeatId[] = [];
  const slides: number[] = [];
  while (match.winner === null) {
    const seat = match.active;
    const direction = botMove(match, rngs[seat], tiers[seat]);
    order.push(seat);
    slides.push(direction);
    if (!applyMove(match, direction)) {
      throw new Error(`seed ${String(seed)}: the bot offered an illegal slide`);
    }
  }
  return { match, order, slides };
}

function playSeries(
  p1Tier: BotDifficulty,
  p2Tier: BotDifficulty,
  matches: number,
  openingSeat: SeatId = 'p1',
): { p1: number; p2: number; draw: number } {
  const wins = { p1: 0, p2: 0, draw: 0 };
  for (let seed = 1; seed <= matches; seed += 1) {
    const outcome = winnerOf(playMatch(seed * 7919, p1Tier, p2Tier, openingSeat).match);
    if (outcome === 'p1') wins.p1 += 1;
    else if (outcome === 'p2') wins.p2 += 1;
    else wins.draw += 1;
  }
  return wins;
}

describe('the two goals', () => {
  it('are the same arrangement seen from the two chairs', () => {
    // Seat two's finished board is exactly seat one's turned half way round. That is what
    // makes the shell's seat flip the rule of the game rather than a presentation detail.
    const solved = solvedBoard();
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const value = solved[cell] ?? GAP;
      if (value === GAP) continue;
      expect(homeCellFor('p1', value)).toBe(cell);
      expect(homeCellFor('p2', value)).toBe(rotateCell(cell));
    }
    expect(homeCount(solved, 'p1')).toBe(TILE_COUNT);
    expect(homeCount(rotatedCopy(solved), 'p2')).toBe(TILE_COUNT);
  });

  it('share exactly one cell, the middle one', () => {
    // On an odd board the centre is its own half-turn, so one tile is wanted in the same
    // place by both players. Every other cell is contested.
    const shared: number[] = [];
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      for (let value = 1; value <= TILE_COUNT; value += 1) {
        if (homeCellFor('p1', value) === cell && homeCellFor('p2', value) === cell) {
          shared.push(cell);
        }
      }
    }
    expect(shared).toEqual([(CELL_COUNT - 1) / 2]);
  });

  it('are twenty taxicab units apart, which is what puts a floor under a fair start', () => {
    let separation = 0;
    for (let value = 1; value <= TILE_COUNT; value += 1) {
      separation += cellDistance(homeCellFor('p1', value), homeCellFor('p2', value));
    }
    expect(separation).toBe(20);
    // The triangle inequality then says the two distances always sum to at least this, so
    // a position equidistant from both goals is at least ten slides from either.
    for (let seed = 1; seed <= 200; seed += 1) {
      const match = started(seed);
      const p1 = homeDistance(match.board, 'p1');
      const p2 = homeDistance(match.board, 'p2');
      expect(p1 + p2).toBeGreaterThanOrEqual(separation);
      expect(p1).toBeGreaterThanOrEqual(separation / 2);
    }
  });

  it('swap scores when the board is turned round', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const match = started(seed);
      const mirrored = rotatedCopy(match.board);
      expect(homeCount(mirrored, 'p1')).toBe(homeCount(match.board, 'p2'));
      expect(homeCount(mirrored, 'p2')).toBe(homeCount(match.board, 'p1'));
      expect(homeDistance(mirrored, 'p1')).toBe(homeDistance(match.board, 'p2'));
      expect(homeDistance(mirrored, 'p2')).toBe(homeDistance(match.board, 'p1'));
    }
  });
});

/**
 * The one property that would ship a broken game if it were wrong.
 *
 * Exactly half of the 9! arrangements of a 3x3 sliding puzzle cannot be reached from the
 * finished board by any sequence of slides. A shuffle that permuted tiles would therefore
 * be impossible one time in two, and *silently* so — it would look like a hard board.
 */
describe('every board we ship is solvable', () => {
  const orbit = reachableOrbit();

  it('enumerates the reachable half of the state space, and it is exactly half', () => {
    let factorial = 1;
    for (let i = 2; i <= CELL_COUNT; i += 1) factorial *= i;
    expect(orbit.size).toBe(factorial / 2);
  });

  it('can tell an unsolvable board from a solvable one', () => {
    // Without this the membership tests below would pass against a set of everything.
    const swapped = solvedBoard();
    const first = swapped[0] ?? GAP;
    swapped[0] = swapped[1] ?? GAP;
    swapped[1] = first;
    expect(orbit.has(keyOf(swapped))).toBe(false);
    expect(orbit.has(keyOf(solvedBoard()))).toBe(true);
  });

  it('holds both goals, so neither player is chasing something unreachable', () => {
    expect(orbit.has(keyOf(solvedBoard()))).toBe(true);
    expect(orbit.has(keyOf(rotatedCopy(solvedBoard())))).toBe(true);
  });

  it('generates only positions inside it, over five thousand seeds', () => {
    const board = emptyBoard();
    for (let seed = 1; seed <= 5000; seed += 1) {
      shuffleInto(board, new Rng(seed * 2654435761));
      expect(orbit.has(keyOf(board)), `seed ${String(seed)} produced an unsolvable board`).toBe(
        true,
      );
    }
  });

  it('agrees with the parity invariant, which is the other way to prove the same thing', () => {
    // sign(permutation) must equal (-1) to the power of the gap's taxicab distance from
    // its home, because every slide is one transposition and moves the gap one cell.
    const board = emptyBoard();
    for (let seed = 1; seed <= 2000; seed += 1) {
      shuffleInto(board, new Rng(seed * 40503));
      expect(permutationIsEven(board)).toBe(cellDistance(gapOf(board), CELL_COUNT - 1) % 2 === 0);
    }
  });

  it('stays inside it for every position a match can reach', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const match = createMatch();
      const rng = new Rng(seed * 104729);
      const rngs = createBotRngs(rng);
      resetMatch(match, rng, 'p1');
      while (match.winner === null) {
        expect(orbit.has(keyOf(match.board))).toBe(true);
        applyMove(match, botMove(match, rngs[match.active], 'normal'));
      }
      expect(orbit.has(keyOf(match.board))).toBe(true);
    }
  });
});

/** Parity of the permutation that carries the finished board to this one. */
function permutationIsEven(board: readonly number[]): boolean {
  // The gap counts as the ninth tile, sitting in cell CELL_COUNT - 1 when finished.
  const position: number[] = new Array<number>(CELL_COUNT).fill(0);
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const value = board[cell] ?? GAP;
    position[value === GAP ? CELL_COUNT - 1 : value - 1] = cell;
  }
  let inversions = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    for (let j = i + 1; j < CELL_COUNT; j += 1) {
      if ((position[i] ?? 0) > (position[j] ?? 0)) inversions += 1;
    }
  }
  return inversions % 2 === 0;
}

describe('the shuffle', () => {
  it('starts the two seats exactly level, on every seed tried', () => {
    const board = emptyBoard();
    for (let seed = 1; seed <= 5000; seed += 1) {
      shuffleInto(board, new Rng(seed * 2654435761));
      expect(homeCount(board, 'p1')).toBe(homeCount(board, 'p2'));
      expect(homeDistance(board, 'p1')).toBe(homeDistance(board, 'p2'));
    }
  });

  it('is capped so it cannot hang, and the cap is never what decides the board', () => {
    // About one walk in twenty is accepted, so 200 attempts leave a three-in-a-hundred-
    // thousand chance of settling for the best walk seen. The test above is what proves
    // the fallback was not taken: a fallback board is not exactly level, and 5000 seeds
    // were.
    expect(SHUFFLE_ATTEMPTS).toBeGreaterThan(100);
    expect(SHUFFLE_WALK).toBeGreaterThan(10);
  });

  it('deals the same board for the same seed and different boards for different seeds', () => {
    const a = emptyBoard();
    const b = emptyBoard();
    shuffleInto(a, new Rng(4242));
    shuffleInto(b, new Rng(4242));
    expect(a).toEqual(b);
    shuffleInto(b, new Rng(4243));
    expect(a).not.toEqual(b);
  });

  it('is blind to which seat it is dealing for', () => {
    // The walk starts at *seat one's* finished board, so without the coin the distribution
    // of starts would lean towards seat one however level the two summary numbers were.
    // The half-turn pairs cell c with cell 8 - c, so a distribution invariant under it must
    // put the gap in each of a pair equally often — which is what is checked here, cell by
    // cell rather than in aggregate, so a lean that cancels in total cannot hide.
    const total = 8000;
    const board = emptyBoard();
    const seen: number[] = new Array<number>(CELL_COUNT).fill(0);
    for (let seed = 1; seed <= total; seed += 1) {
      shuffleInto(board, new Rng(seed * 97));
      seen[gapOf(board)] = (seen[gapOf(board)] ?? 0) + 1;
    }
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      const here = (seen[cell] ?? 0) / total;
      const there = (seen[rotateCell(cell)] ?? 0) / total;
      expect(Math.abs(here - there), `cell ${String(cell)} against its half-turn`).toBeLessThan(
        0.025,
      );
    }
  });

  it('lays exactly one gap and every tile once', () => {
    const board = emptyBoard();
    for (let seed = 1; seed <= 500; seed += 1) {
      shuffleInto(board, new Rng(seed * 31));
      const sorted = [...board].sort((a, b) => a - b);
      expect(sorted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    }
  });
});

describe('a slide', () => {
  it('names the tile on that side of the gap, whichever way the gap is described', () => {
    const match = started(11);
    for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
      const from = stepCell(match.gap, direction);
      if (from < 0) continue;
      expect(cellDistance(from, match.gap)).toBe(1);
    }
    expect(opposite(UP)).toBe(DOWN);
    expect(opposite(LEFT)).toBe(RIGHT);
    for (let direction = 0; direction < DIRECTION_COUNT; direction += 1) {
      expect(opposite(opposite(direction))).toBe(direction);
    }
  });

  it('moves the tile into the gap and the gap to where the tile was', () => {
    const match = started(12);
    const moves: number[] = [0, 0, 0, 0];
    const count = legalMovesInto(match.gap, match.lastDirection, moves);
    const direction = moves[0] ?? 0;
    const from = stepCell(match.gap, direction);
    const to = match.gap;
    const value = match.board[from] ?? GAP;
    expect(count).toBeGreaterThan(0);
    expect(applyMove(match, direction)).toBe(true);
    expect(match.board[to]).toBe(value);
    expect(match.board[from]).toBe(GAP);
    expect(match.gap).toBe(from);
    expect(match.movedValue).toBe(value);
    expect(match.movedFrom).toBe(from);
    expect(match.movedTo).toBe(to);
  });

  it('is refused off the board, and refused as an immediate takeback', () => {
    const match = started(13);
    const moves: number[] = [0, 0, 0, 0];
    legalMovesInto(match.gap, match.lastDirection, moves);
    const played = moves[0] ?? 0;
    applyMove(match, played);
    expect(isLegalMove(match, opposite(played))).toBe(false);
    expect(applyMove(match, opposite(played))).toBe(false);
    expect(applyMove(match, -1)).toBe(false);
    expect(applyMove(match, DIRECTION_COUNT)).toBe(false);
  });

  it('always leaves at least one legal slide, so nothing ever needs a pass rule', () => {
    // The gap has two neighbours in a corner and more elsewhere, so banning one reverse
    // can never empty the list. Checked over every cell and every previous direction.
    const moves: number[] = [0, 0, 0, 0];
    for (let gap = 0; gap < CELL_COUNT; gap += 1) {
      for (let last = -1; last < DIRECTION_COUNT; last += 1) {
        if (last >= 0 && stepCell(gap, opposite(last)) < 0) continue;
        const count = legalMovesInto(gap, last, moves);
        expect(count, `gap ${String(gap)} after ${String(last)}`).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(last < 0 ? DIRECTION_COUNT : DIRECTION_COUNT - 1);
      }
    }
  });
});

describe('the turn order', () => {
  it('runs one slide, then pairs, then one slide', () => {
    // A, BB, AA, BB, ..., AA, B. This is the whole answer to the first-mover problem and
    // it is worth asserting exactly rather than trusting the counters.
    const { order } = playMatch(555, 'normal', 'normal', 'p1');
    const expected: SeatId[] = [];
    let seat: SeatId = 'p1';
    let left = 1;
    const budget: Record<SeatId, number> = { p1: MOVES_PER_SEAT, p2: MOVES_PER_SEAT };
    while (budget.p1 + budget.p2 > 0) {
      expected.push(seat);
      budget[seat] -= 1;
      left -= 1;
      if (left > 0 && budget[seat] > 0) continue;
      seat = otherSeat(seat);
      left = Math.min(SLIDES_PER_TURN, budget[seat]);
    }
    expect(order).toEqual(expected);
    expect(order.slice(0, 4)).toEqual(['p1', 'p2', 'p2', 'p1']);
    expect(order[order.length - 1]).toBe('p2');
  });

  it('gives both seats the same number of slides, opening from either chair', () => {
    for (const opener of SEATS) {
      const { order } = playMatch(777, 'hard', 'hard', opener);
      expect(order.filter((seat) => seat === 'p1').length).toBe(MOVES_PER_SEAT);
      expect(order.filter((seat) => seat === 'p2').length).toBe(MOVES_PER_SEAT);
      expect(order[0]).toBe(opener);
    }
  });

  it('opens from the seat the shell nominates', () => {
    for (const opener of SEATS) {
      const match = started(99, opener);
      expect(match.active).toBe(opener);
      expect(match.turnSlides).toBe(1);
    }
  });

  it('reads the same forwards and backwards with the chairs swapped', () => {
    // The reply is the valuable half of an exchange in this game, which is why strict
    // alternation was unplayable, and this is the property that shares it out: reverse the
    // whole order and swap the two seats and you get the identical order back. Neither
    // seat is systematically the one who has to commit first.
    const { order } = playMatch(313, 'hard', 'hard');
    expect([...order].reverse().map(otherSeat)).toEqual(order);
    const turns: SeatId[] = [];
    for (const seat of order) if (turns[turns.length - 1] !== seat) turns.push(seat);
    expect(turns.filter((seat) => seat === 'p1').length).toBe(
      turns.filter((seat) => seat === 'p2').length,
    );
  });
});

describe('the score', () => {
  it('only ever climbs, and is taken from every position however it came about', () => {
    const match = started(21);
    let p1 = match.p1Best;
    let p2 = match.p2Best;
    const rng = new Rng(21);
    const rngs = createBotRngs(rng);
    while (match.winner === null) {
      applyMove(match, botMove(match, rngs[match.active], 'normal'));
      expect(match.p1Best).toBeGreaterThanOrEqual(p1);
      expect(match.p2Best).toBeGreaterThanOrEqual(p2);
      expect(match.p1Closest).toBeLessThanOrEqual(homeDistance(match.board, 'p1'));
      p1 = match.p1Best;
      p2 = match.p2Best;
    }
  });

  it('starts at the level the shuffle guarantees', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const match = started(seed * 13);
      expect(match.p1Best).toBe(match.p2Best);
      expect(match.p1Closest).toBe(match.p2Closest);
    }
  });

  it('is not a reading of the final position, which is the whole point', () => {
    // Build a match where seat one has banked a good arrangement and then let it be
    // wrecked. The banked mark survives; a final-position score would not.
    const match = started(31);
    match.board.splice(0, CELL_COUNT, ...solvedBoard());
    match.gap = gapOf(match.board);
    match.p1Best = 0;
    bank(match);
    expect(match.p1Best).toBe(TILE_COUNT);
    applyMove(match, UP);
    expect(homeCount(match.board, 'p1')).toBeLessThan(TILE_COUNT);
    expect(match.p1Best).toBe(TILE_COUNT);
  });

  it('gives the match to whoever fills the board in their own order, on the spot', () => {
    const match = started(32);
    match.board.splice(0, CELL_COUNT, ...solvedBoard());
    match.gap = gapOf(match.board);
    expect(judge(match)).toBe('p1');
    match.board.splice(0, CELL_COUNT, ...rotatedCopy(solvedBoard()));
    match.gap = gapOf(match.board);
    expect(judge(match)).toBe('p2');
  });

  it('settles a level match on the closest either seat came', () => {
    const match = started(33);
    match.p1Moves = 0;
    match.p2Moves = 0;
    match.p1Best = 3;
    match.p2Best = 3;
    match.p1Closest = 7;
    match.p2Closest = 9;
    expect(judge(match)).toBe('p1');
    match.p1Closest = 9;
    expect(judge(match)).toBe('draw');
    match.p2Best = 4;
    expect(judge(match)).toBe('p2');
  });

  it('is still running while either seat has a slide left', () => {
    const match = started(34);
    expect(judge(match)).toBeNull();
    match.p1Moves = 0;
    expect(judge(match)).toBeNull();
    match.p2Moves = 0;
    expect(judge(match)).not.toBeNull();
  });
});

describe('termination', () => {
  it('ends every match in exactly two budgets of slides, with no frame cap', () => {
    // The loop below has no ceiling, so a match that failed to finish would hang the suite
    // rather than pass quietly. Structural: nothing on the board can add a slide.
    for (let seed = 1; seed <= 200; seed += 1) {
      const played = playMatch(seed * 7919, 'easy', 'easy');
      expect(winnerOf(played.match)).not.toBeNull();
      expect(played.order.length).toBe(MOVES_PER_SEAT * 2);
      expect(movesLeft(played.match, 'p1')).toBe(0);
      expect(movesLeft(played.match, 'p2')).toBe(0);
    }
  });

  it('ends the weakest pairing too, from either chair', () => {
    for (const opener of SEATS) {
      for (let seed = 1; seed <= 60; seed += 1) {
        expect(winnerOf(playMatch(seed * 31337, 'easy', 'easy', opener).match)).not.toBeNull();
      }
    }
  });
});

describe('the bot', () => {
  it('never offers a slide the rules refuse', () => {
    for (const tier of TIERS) {
      for (let seed = 1; seed <= 30; seed += 1) {
        const match = createMatch();
        const rng = new Rng(seed * 61);
        const rngs = createBotRngs(rng);
        resetMatch(match, rng, 'p1');
        while (match.winner === null) {
          const direction = botMove(match, rngs[match.active], tier);
          expect(isLegalMove(match, direction)).toBe(true);
          applyMove(match, direction);
        }
      }
    }
  });

  it('draws the same number of values per slide whatever it decides to do', () => {
    // A conditional draw count couples one seat's stream to how its opponent is playing.
    for (const tier of TIERS) {
      const match = started(41);
      const used = new Rng(9001);
      const counted = new Rng(9001);
      botMove(match, used, tier);
      for (let i = 0; i < BOT_DRAWS_PER_MOVE; i += 1) counted.next();
      expect(used.next(), `${tier} did not spend ${String(BOT_DRAWS_PER_MOVE)} draws`).toBe(
        counted.next(),
      );
    }
  });

  it('gives each seat its own stream, so one seat is not a function of its opponent', () => {
    // Seat two must play the identical slides against `easy` and against `hard` until the
    // board they are handed actually differs.
    const againstEasy = playMatch(4242, 'easy', 'normal');
    const againstHard = playMatch(4242, 'hard', 'normal');
    const p2Easy = againstEasy.slides.filter((_, i) => againstEasy.order[i] === 'p2');
    const p2Hard = againstHard.slides.filter((_, i) => againstHard.order[i] === 'p2');
    expect(p2Easy[0]).toBe(p2Hard[0]);
    expect(p2Easy.length).toBe(p2Hard.length);
  });

  it('plays the same match for the same seed', () => {
    for (const tier of TIERS) {
      const a = playMatch(515, tier, tier);
      const b = playMatch(515, tier, tier);
      expect(a.slides).toEqual(b.slides);
      expect(a.match.board).toEqual(b.match.board);
      expect(winnerOf(a.match)).toBe(winnerOf(b.match));
    }
  });

  it('stays well inside the search budget, so its depth is the same on every device', () => {
    // A clock would make the depth depend on how fast the machine is, which rule 8 forbids.
    // The node budget is deterministic; the measured worst is 263 of 1500, so the shipped
    // depths are always reached and the budget is a guard rather than a limiter.
    expect(DEFAULT_SEARCH_NODES).toBeGreaterThan(1000);
    for (const tier of TIERS) {
      expect(SEARCH_DEPTH[tier] % 2, `${tier} must end on a turn boundary`).toBe(0);
    }
  });

  it('is ordered by strength, measured rather than asserted from intuition', () => {
    // Small samples here; the full sweep and its numbers are in SPEC.md.
    const hardOverEasy = playSeries('hard', 'easy', 120);
    const normalOverEasy = playSeries('normal', 'easy', 120);
    const hardOverNormal = playSeries('hard', 'normal', 120);
    expect(hardOverEasy.p1 / (hardOverEasy.p1 + hardOverEasy.p2)).toBeGreaterThan(0.9);
    expect(normalOverEasy.p1 / (normalOverEasy.p1 + normalOverEasy.p2)).toBeGreaterThan(0.72);
    expect(hardOverNormal.p1 / (hardOverNormal.p1 + hardOverNormal.p2)).toBeGreaterThan(0.65);
  });

  it('is level with itself from either chair', () => {
    const opens1 = playSeries('normal', 'normal', 200, 'p1');
    const opens2 = playSeries('normal', 'normal', 200, 'p2');
    const share = (opens1.p1 / (opens1.p1 + opens1.p2) + opens2.p1 / (opens2.p1 + opens2.p2)) / 2;
    expect(share).toBeGreaterThan(0.42);
    expect(share).toBeLessThan(0.58);
  });

  it('blunders more often the weaker it is, and the top tier never does', () => {
    expect(BLUNDER_CHANCE.easy).toBeGreaterThan(BLUNDER_CHANCE.normal);
    expect(BLUNDER_CHANCE.normal).toBeGreaterThan(BLUNDER_CHANCE.hard);
    expect(BLUNDER_CHANCE.hard).toBe(0);
    expect(SEARCH_DEPTH.easy).toBeLessThan(SEARCH_DEPTH.normal);
    expect(SEARCH_DEPTH.normal).toBeLessThan(SEARCH_DEPTH.hard);
  });

  it('reads nothing but the position it is handed, and leaves it exactly as it found it', () => {
    // The bot's whole input is the match, a generator and a tier: no solution, no reach
    // into the shuffle, no private state kept between moves. The search works on a copy,
    // so a move offered must leave the live match untouched — a bot that scribbled on the
    // board would be reading and writing state a player has no access to.
    for (const tier of TIERS) {
      const match = started(818);
      const before = JSON.stringify(match);
      botMove(match, new Rng(5), tier);
      expect(JSON.stringify(match)).toBe(before);
    }
  });

  it('answers the same position with the same slide', () => {
    const match = started(819);
    expect(botMove(match, new Rng(77), 'hard')).toBe(botMove(match, new Rng(77), 'hard'));
  });
});

describe('the match is the same match seen from either chair', () => {
  it('mirrors exactly when the board is turned round and the slides with it', () => {
    // The strongest fairness statement this game can make: **the rules are invariant under
    // the half-turn.** Turn a start position round, play every slide mirrored, and the
    // whole match is the original with the chairs swapped — same legality, same marks,
    // same result. Any residual seat bias therefore has to come from the distribution of
    // starting boards, and that is what the coin in the shuffle removes.
    //
    // Driven by a mirrored slide *list* rather than by two bots on purpose. A bot breaks
    // ties by direction index and no order on four directions survives an involution that
    // swaps them in pairs, so two mirrored bots may legitimately part company on an even
    // position. That is a property of the tie-break, not of the game, and testing the game
    // is what this is for.
    const scratch: number[] = [0, 0, 0, 0];
    for (let seed = 1; seed <= 60; seed += 1) {
      const direct = createMatch();
      const rng = new Rng(seed * 7);
      resetMatch(direct, rng, 'p1');

      const mirror = createMatch();
      mirror.board.splice(0, CELL_COUNT, ...rotatedCopy(direct.board));
      mirror.gap = gapOf(mirror.board);
      mirror.active = 'p2';
      mirror.turnSlides = direct.turnSlides;
      mirror.p1Moves = direct.p2Moves;
      mirror.p2Moves = direct.p1Moves;
      mirror.p1Best = direct.p2Best;
      mirror.p2Best = direct.p1Best;
      mirror.p1Closest = direct.p2Closest;
      mirror.p2Closest = direct.p1Closest;

      const chooser = new Rng(seed * 31);
      while (direct.winner === null) {
        const count = legalMovesInto(direct.gap, direct.lastDirection, scratch);
        const direction = scratch[chooser.int(0, count)] ?? 0;
        expect(isLegalMove(mirror, opposite(direction))).toBe(true);
        expect(applyMove(direct, direction)).toBe(true);
        expect(applyMove(mirror, opposite(direction))).toBe(true);
        expect(mirror.board).toEqual(rotatedCopy(direct.board));
        expect(mirror.active).toBe(otherSeat(direct.active));
        expect(mirror.p1Best).toBe(direct.p2Best);
        expect(mirror.p2Best).toBe(direct.p1Best);
        expect(mirror.p1Closest).toBe(direct.p2Closest);
        expect(mirror.p2Closest).toBe(direct.p1Closest);
      }
      const outcome = direct.winner;
      expect(mirror.winner).toBe(outcome === 'draw' ? 'draw' : otherSeat(outcome));
    }
  });
});
