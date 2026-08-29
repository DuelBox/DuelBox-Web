import { describe, expect, it } from 'vitest';
import { Rng, otherSeat } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import {
  CELL_COUNT,
  CENTRE_INDEX,
  COLUMNS,
  DIRECTION_COUNT,
  DOWN,
  FLOOR,
  LEFT,
  OPPOSITE,
  P1_PAINT,
  P1_START,
  P2_PAINT,
  P2_START,
  PROFILES,
  RIGHT,
  ROWS,
  STALL_LIMIT,
  UNPAINTED,
  UP,
  WALL,
  WALL_PAIRS,
  applyMove,
  canRoll,
  chooseDirection,
  columnOf,
  createMatch,
  createPosition,
  directionContaining,
  generateMaze,
  hasPaintingMove,
  indexOf,
  isLegalDirection,
  isOver,
  legalDirections,
  mirrorIndex,
  mirrorPosition,
  neighbour,
  outcomeOf,
  ownerOf,
  paintCount,
  paintGain,
  positionsMatch,
  rowOf,
  seatCode,
  settle,
  startMatch,
  stepMatch,
  travelLength,
  winnerOf,
} from './rules.js';
import type { BotDifficulty, Match, Position, Tuning } from './rules.js';

const STEP = 1 / 60;
const TIERS: readonly BotDifficulty[] = ['easy', 'normal', 'hard'];

/* ------------------------------------------------------------------ helpers */

interface Played {
  readonly winner: SeatId | null;
  readonly p1: number;
  readonly p2: number;
  readonly moves: number;
  readonly steps: number;
  readonly floor: number;
}

/**
 * Play a whole match, bot against bot.
 *
 * The generators are handed out **by role rather than by seat**, exactly as `game.ts` does
 * in `init`: whoever opens gets the first stream. That is what makes the same seed played
 * from the two openings one match and its mirror image.
 */
function playMatch(
  seed: number,
  opener: SeatId,
  tierP1: BotDifficulty,
  tierP2: BotDifficulty,
  tuning?: Tuning,
  cap = 0,
): Played {
  const match = createMatch();
  const rng = new Rng(seed);
  startMatch(match, rng, opener, tuning);
  const first = new Rng(rng.next() | 0);
  const second = new Rng(rng.next() | 0);
  const streams: Record<SeatId, Rng> =
    opener === 'p1' ? { p1: first, p2: second } : { p1: second, p2: first };
  const tiers: Record<SeatId, BotDifficulty> = { p1: tierP1, p2: tierP2 };

  let steps = 0;
  // No ceiling by default: a match that failed to terminate hangs the suite loudly rather
  // than passing quietly with a `winner` of null nobody looked at.
  while (match.winner === null) {
    stepMatch(match, STEP, -1, tiers[match.active], streams[match.active]);
    steps += 1;
    if (cap > 0 && steps >= cap) break;
  }
  let floor = 0;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if ((match.position.terrain[i] ?? WALL) === FLOOR) floor += 1;
  }
  return {
    winner: match.winner,
    p1: paintCount(match.position, 'p1'),
    p2: paintCount(match.position, 'p2'),
    moves: match.moves,
    steps,
    floor,
  };
}

function seedFor(index: number): number {
  return 1000003 + index * 7919;
}

/** A maze plus a scattering of paint, for the covariance sweeps. */
function randomPosition(rng: Rng): Position {
  const position = createPosition();
  generateMaze(position, rng);
  const rolls = rng.int(0, 14);
  let seat: SeatId = rng.bool() ? 'p1' : 'p2';
  const buffer = new Int32Array(DIRECTION_COUNT);
  for (let i = 0; i < rolls; i += 1) {
    const count = legalDirections(buffer, position, seat);
    if (count === 0) break;
    applyMove(position, seat, buffer[rng.int(0, count)] ?? UP);
    seat = otherSeat(seat);
  }
  return position;
}

/* ------------------------------------------------------------------ the board */

describe('the board', () => {
  it('is square, odd-sided, and has a centre that is its own mirror image', () => {
    expect(COLUMNS).toBe(ROWS);
    expect(CELL_COUNT % 2).toBe(1);
    expect(mirrorIndex(CENTRE_INDEX)).toBe(CENTRE_INDEX);
  });

  it('starts the two rollers on squares that are each other under the half-turn', () => {
    expect(mirrorIndex(P1_START)).toBe(P2_START);
    expect(P1_START).toBe(indexOf(0, ROWS - 1));
    expect(P2_START).toBe(indexOf(COLUMNS - 1, 0));
  });

  it('mirrors every square exactly once', () => {
    const seen = new Set<number>();
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const twin = mirrorIndex(index);
      expect(mirrorIndex(twin)).toBe(index);
      expect(columnOf(twin)).toBe(COLUMNS - 1 - columnOf(index));
      expect(rowOf(twin)).toBe(ROWS - 1 - rowOf(index));
      seen.add(twin);
    }
    expect(seen.size).toBe(CELL_COUNT);
  });

  it('sends every direction to its opposite under the half-turn', () => {
    for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
      expect(OPPOSITE[OPPOSITE[dir] ?? 0]).toBe(dir);
      // Stepping a square and then mirroring is the same as mirroring and stepping back.
      for (let index = 0; index < CELL_COUNT; index += 1) {
        const stepped = neighbour(index, dir);
        const mirrored = neighbour(mirrorIndex(index), OPPOSITE[dir] ?? 0);
        expect(mirrored).toBe(stepped < 0 ? -1 : mirrorIndex(stepped));
      }
    }
  });

  it('never steps off the edge of the board', () => {
    expect(neighbour(indexOf(0, 0), UP)).toBe(-1);
    expect(neighbour(indexOf(0, 0), LEFT)).toBe(-1);
    expect(neighbour(indexOf(COLUMNS - 1, ROWS - 1), DOWN)).toBe(-1);
    expect(neighbour(indexOf(COLUMNS - 1, ROWS - 1), RIGHT)).toBe(-1);
    expect(neighbour(indexOf(3, 4), RIGHT)).toBe(indexOf(4, 4));
    expect(neighbour(indexOf(3, 4), UP)).toBe(indexOf(3, 3));
  });
});

describe('the maze generator', () => {
  const positions = Array.from({ length: 200 }, (_, i) => {
    const position = createPosition();
    generateMaze(position, new Rng(seedFor(i)));
    return position;
  });

  it('is deterministic from the seed alone', () => {
    const a = createPosition();
    const b = createPosition();
    generateMaze(a, new Rng(4242));
    generateMaze(b, new Rng(4242));
    expect(positionsMatch(a, b)).toBe(true);
  });

  it('deals different mazes for different seeds', () => {
    const shapes = new Set(positions.map((p) => p.terrain.join('')));
    expect(shapes.size).toBeGreaterThan(190);
  });

  it('is symmetric under the half-turn, every time', () => {
    for (const position of positions) {
      for (let index = 0; index < CELL_COUNT; index += 1) {
        expect(position.terrain[index]).toBe(position.terrain[mirrorIndex(index)]);
      }
    }
  });

  it('places the same number of blocks every time, in pairs', () => {
    for (const position of positions) {
      let walls = 0;
      for (let index = 0; index < CELL_COUNT; index += 1) {
        if ((position.terrain[index] ?? FLOOR) === WALL) walls += 1;
      }
      expect(walls).toBe(WALL_PAIRS * 2);
    }
  });

  it('never lets two blocks touch, corners included', () => {
    for (const position of positions) {
      for (let index = 0; index < CELL_COUNT; index += 1) {
        if ((position.terrain[index] ?? FLOOR) !== WALL) continue;
        const column = columnOf(index);
        const row = rowOf(index);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const c = column + dx;
            const r = row + dy;
            if (c < 0 || c >= COLUMNS || r < 0 || r >= ROWS) continue;
            expect(position.terrain[r * COLUMNS + c]).toBe(FLOOR);
          }
        }
      }
    }
  });

  it('leaves the floor in one piece, so no square is walled off from the rest', () => {
    for (const position of positions) {
      const seen = new Uint8Array(CELL_COUNT);
      const stack = [P1_START];
      seen[P1_START] = 1;
      let reached = 0;
      while (stack.length > 0) {
        const cell = stack.pop() ?? 0;
        reached += 1;
        for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
          const next = neighbour(cell, dir);
          if (next < 0) continue;
          if ((position.terrain[next] ?? WALL) !== FLOOR) continue;
          if ((seen[next] ?? 1) !== 0) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
      let floor = 0;
      for (let index = 0; index < CELL_COUNT; index += 1) {
        if ((position.terrain[index] ?? WALL) === FLOOR) floor += 1;
      }
      expect(reached).toBe(floor);
      expect(floor).toBe(CELL_COUNT - WALL_PAIRS * 2);
    }
  });

  it('starts both rollers on their own paint, and neither is walled in', () => {
    for (const position of positions) {
      expect(position.terrain[P1_START]).toBe(FLOOR);
      expect(position.terrain[P2_START]).toBe(FLOOR);
      expect(position.paint[P1_START]).toBe(P1_PAINT);
      expect(position.paint[P2_START]).toBe(P2_PAINT);
      expect(position.roller[P1_PAINT]).toBe(P1_START);
      expect(position.roller[P2_PAINT]).toBe(P2_START);
      expect(hasPaintingMove(position, 'p1')).toBe(true);
      expect(hasPaintingMove(position, 'p2')).toBe(true);
      expect(paintCount(position, 'p1')).toBe(1);
      expect(paintCount(position, 'p2')).toBe(1);
    }
  });

  it('resets in place, so a rematch is a fresh maze on the same arrays', () => {
    const position = createPosition();
    generateMaze(position, new Rng(1));
    applyMove(position, 'p1', UP);
    generateMaze(position, new Rng(2));
    expect(paintCount(position, 'p1')).toBe(1);
    expect(paintCount(position, 'p2')).toBe(1);
  });
});

/* ------------------------------------------------------------------ rolling */

describe('a roll', () => {
  /** An empty floor, so the geometry under test is the roll and not the maze. */
  function bareBoard(): Position {
    const position = createPosition();
    generateMaze(position, new Rng(7), 0);
    return position;
  }

  it('runs to the edge of the board and paints everything on the way', () => {
    const position = bareBoard();
    const gain = applyMove(position, 'p1', RIGHT);
    expect(gain).toBe(COLUMNS - 1);
    expect(position.roller[P1_PAINT]).toBe(indexOf(COLUMNS - 1, ROWS - 1));
    for (let column = 0; column < COLUMNS; column += 1) {
      expect(position.paint[indexOf(column, ROWS - 1)]).toBe(P1_PAINT);
    }
  });

  it('stops against a block without painting it', () => {
    const position = bareBoard();
    position.terrain[indexOf(4, ROWS - 1)] = WALL;
    expect(travelLength(position, 'p1', RIGHT)).toBe(3);
    expect(applyMove(position, 'p1', RIGHT)).toBe(3);
    expect(position.paint[indexOf(4, ROWS - 1)]).toBe(UNPAINTED);
    expect(position.roller[P1_PAINT]).toBe(indexOf(3, ROWS - 1));
  });

  it("rolls over its own paint and stops dead at the other seat's", () => {
    const position = bareBoard();
    position.paint[indexOf(1, ROWS - 1)] = P1_PAINT;
    position.paint[indexOf(2, ROWS - 1)] = P1_PAINT;
    position.paint[indexOf(5, ROWS - 1)] = P2_PAINT;
    expect(travelLength(position, 'p1', RIGHT)).toBe(4);
    expect(paintGain(position, 'p1', RIGHT)).toBe(2);
    expect(applyMove(position, 'p1', RIGHT)).toBe(2);
    expect(position.roller[P1_PAINT]).toBe(indexOf(4, ROWS - 1));
    expect(position.paint[indexOf(5, ROWS - 1)]).toBe(P2_PAINT);
  });

  it('refuses a direction that cannot move at all', () => {
    const position = bareBoard();
    expect(applyMove(position, 'p1', DOWN)).toBe(-1);
    expect(applyMove(position, 'p1', LEFT)).toBe(-1);
    expect(applyMove(position, 'p1', 4)).toBe(-1);
    expect(applyMove(position, 'p1', -1)).toBe(-1);
    expect(applyMove(position, 'p1', 1.5)).toBe(-1);
    expect(position.roller[P1_PAINT]).toBe(P1_START);
    expect(paintCount(position, 'p1')).toBe(1);
  });

  it('refuses a paintless direction while any direction still paints', () => {
    const position = bareBoard();
    applyMove(position, 'p1', RIGHT);
    // Rolling back left over its own paint pays nothing, and up is still available.
    expect(travelLength(position, 'p1', LEFT)).toBe(COLUMNS - 1);
    expect(paintGain(position, 'p1', LEFT)).toBe(0);
    expect(isLegalDirection(position, 'p1', LEFT)).toBe(false);
    expect(applyMove(position, 'p1', LEFT)).toBe(-1);
  });

  it('allows a paintless shift, and only a shift, once nothing paints', () => {
    const position = bareBoard();
    // Wall the corner off into a two-square corridor that p1 has already painted.
    position.terrain[indexOf(2, ROWS - 1)] = WALL;
    position.terrain[indexOf(0, ROWS - 2)] = WALL;
    position.terrain[indexOf(1, ROWS - 2)] = WALL;
    applyMove(position, 'p1', RIGHT);
    expect(hasPaintingMove(position, 'p1')).toBe(false);
    expect(canRoll(position, 'p1')).toBe(true);
    expect(isLegalDirection(position, 'p1', LEFT)).toBe(true);
    expect(applyMove(position, 'p1', LEFT)).toBe(0);
    expect(position.roller[P1_PAINT]).toBe(P1_START);
  });

  it('leaves a seat that cannot roll unable to roll for the rest of the match', () => {
    // The property the turn machine leans on: paint only spreads and the other seat's paint
    // only ever shortens a roll, so a roller that is stuck cannot come back.
    const rng = new Rng(31337);
    for (let trial = 0; trial < 300; trial += 1) {
      const position = randomPosition(rng);
      for (const seat of ['p1', 'p2'] as const) {
        if (canRoll(position, seat)) continue;
        const other = otherSeat(seat);
        const buffer = new Int32Array(DIRECTION_COUNT);
        for (let i = 0; i < 6; i += 1) {
          const count = legalDirections(buffer, position, other);
          if (count === 0) break;
          applyMove(position, other, buffer[0] ?? UP);
          expect(canRoll(position, seat)).toBe(false);
        }
      }
    }
  });

  it('never takes a square back, and never paints one twice', () => {
    const rng = new Rng(5150);
    for (let trial = 0; trial < 120; trial += 1) {
      const position = createPosition();
      generateMaze(position, new Rng(seedFor(trial)));
      const buffer = new Int32Array(DIRECTION_COUNT);
      let seat: SeatId = 'p1';
      let painted = 2;
      for (let turn = 0; turn < 200; turn += 1) {
        const count = legalDirections(buffer, position, seat);
        if (count === 0) break;
        const before = paintCount(position, 'p1') + paintCount(position, 'p2');
        const other = otherSeat(seat);
        const theirsBefore = paintCount(position, other);
        const gain = applyMove(position, seat, buffer[rng.int(0, count)] ?? UP);
        expect(gain).toBeGreaterThanOrEqual(0);
        expect(paintCount(position, other)).toBe(theirsBefore);
        expect(paintCount(position, 'p1') + paintCount(position, 'p2')).toBe(before + gain);
        painted = before + gain;
        seat = other;
      }
      expect(painted).toBeLessThanOrEqual(CELL_COUNT - WALL_PAIRS * 2);
    }
  });
});

describe('the lane a press names', () => {
  it('names the direction whose run the square is in, and nothing else', () => {
    const rng = new Rng(90210);
    const buffer = new Int32Array(DIRECTION_COUNT);
    for (let trial = 0; trial < 200; trial += 1) {
      const position = randomPosition(rng);
      const seat: SeatId = trial % 2 === 0 ? 'p1' : 'p2';
      const legal = new Set<number>();
      const count = legalDirections(buffer, position, seat);
      for (let i = 0; i < count; i += 1) legal.add(buffer[i] ?? -1);

      const claimed = new Map<number, number>();
      for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
        if (!legal.has(dir)) continue;
        let walk = position.roller[seatCode(seat)] ?? 0;
        for (let i = 0; i < travelLength(position, seat, dir); i += 1) {
          walk = neighbour(walk, dir);
          // Disjointness: the four runs leave along different axes, so no square is in two.
          expect(claimed.has(walk)).toBe(false);
          claimed.set(walk, dir);
        }
      }
      for (const [cell, dir] of claimed) {
        expect(directionContaining(position, seat, cell)).toBe(dir);
      }
      // The roller's own square, and anything off the board, name nothing.
      expect(directionContaining(position, seat, position.roller[seatCode(seat)] ?? 0)).toBe(-1);
      expect(directionContaining(position, seat, -1)).toBe(-1);
      expect(directionContaining(position, seat, CELL_COUNT)).toBe(-1);
    }
  });

  it('names nothing in a lane that is not a move', () => {
    const position = createPosition();
    generateMaze(position, new Rng(7), 0);
    applyMove(position, 'p1', RIGHT);
    // The way back is travellable and pays nothing, so it is not a lane.
    expect(travelLength(position, 'p1', LEFT)).toBeGreaterThan(0);
    expect(directionContaining(position, 'p1', P1_START)).toBe(-1);
  });
});

/* ------------------------------------------------------------------ scoring */

describe('the win condition', () => {
  it('gives it to whoever painted more', () => {
    expect(settle(40, 30, 'p1')).toBe('p1');
    expect(settle(40, 30, 'p2')).toBe('p1');
    expect(settle(30, 40, 'p1')).toBe('p2');
    expect(settle(30, 40, 'p2')).toBe('p2');
  });

  it('gives a level match to the seat that moved second, and never draws', () => {
    expect(settle(36, 36, 'p1')).toBe('p2');
    expect(settle(36, 36, 'p2')).toBe('p1');
    for (let p1 = 0; p1 <= 60; p1 += 1) {
      for (const opener of ['p1', 'p2'] as const) {
        const winner: string = settle(p1, 60 - p1, opener);
        expect(['p1', 'p2']).toContain(winner);
      }
    }
  });

  it('says nothing while either roller can still move', () => {
    const position = createPosition();
    generateMaze(position, new Rng(11));
    expect(isOver(position)).toBe(false);
    expect(winnerOf(position, 'p1')).toBeNull();
  });

  it('reports the outcome of a finished position from the counts on the board', () => {
    const position = createPosition();
    generateMaze(position, new Rng(11), 0);
    // Wall both rollers in completely; nobody can roll, so the position is finished.
    position.terrain.fill(WALL);
    position.terrain[P1_START] = FLOOR;
    position.terrain[P2_START] = FLOOR;
    expect(isOver(position)).toBe(true);
    expect(paintCount(position, 'p1')).toBe(1);
    expect(paintCount(position, 'p2')).toBe(1);
    expect(outcomeOf(position, 'p1')).toBe('p2');
    expect(outcomeOf(position, 'p2')).toBe('p1');
    expect(winnerOf(position, 'p1')).toBe('p2');
  });

  it('reads ownership off the board', () => {
    const position = createPosition();
    generateMaze(position, new Rng(3));
    expect(ownerOf(position, P1_START)).toBe('p1');
    expect(ownerOf(position, P2_START)).toBe('p2');
    expect(ownerOf(position, CENTRE_INDEX)).toBeNull();
    expect(ownerOf(position, -1)).toBeNull();
    expect(ownerOf(position, CELL_COUNT)).toBeNull();
  });
});

/* ------------------------------------------------------------------ the match */

describe('a match', () => {
  it('opens with the seat the shell nominated, not with p1', () => {
    for (const opener of ['p1', 'p2'] as const) {
      const match = createMatch();
      startMatch(match, new Rng(99), opener);
      stepMatch(match, STEP, -1, null, new Rng(1));
      expect(match.active).toBe(opener);
      expect(match.opener).toBe(opener);
    }
  });

  it('freezes at the top of every turn, in the rules rather than in the shell', () => {
    const match = createMatch();
    startMatch(match, new Rng(5), 'p1');
    // READY_SECONDS is 0.5 s: thirty steps at 60 Hz, and the first step sizes the timer.
    for (let step = 0; step < 29; step += 1) {
      stepMatch(match, STEP, RIGHT, null, new Rng(1));
      expect(match.phase).toBe('ready');
      expect(match.moves).toBe(0);
    }
    stepMatch(match, STEP, -1, null, new Rng(1));
    expect(match.phase).toBe('live');
    stepMatch(match, STEP, RIGHT, null, new Rng(1));
    expect(match.moves).toBe(1);
  });

  it('sizes its turn from the step rate it is actually given', () => {
    const fast = createMatch();
    startMatch(fast, new Rng(5), 'p1');
    let steps = 0;
    while (fast.phase === 'ready') {
      stepMatch(fast, 1 / 120, -1, null, new Rng(1));
      steps += 1;
    }
    expect(steps).toBe(60);
  });

  it('spends no turn on a direction it refuses', () => {
    const match = createMatch();
    startMatch(match, new Rng(5), 'p1');
    for (let step = 0; step < 30; step += 1) stepMatch(match, STEP, -1, null, new Rng(1));
    expect(match.phase).toBe('live');
    // Seat one starts in the bottom-left corner: down and left are off the board.
    stepMatch(match, STEP, DOWN, null, new Rng(1));
    expect(match.moves).toBe(0);
    expect(match.phase).toBe('live');
    expect(match.active).toBe('p1');
  });

  it('hands the turn over, and skips a seat that has nothing to roll', () => {
    const match = createMatch();
    startMatch(match, new Rng(21), 'p1');
    for (let step = 0; step < 31; step += 1) stepMatch(match, STEP, RIGHT, null, new Rng(1));
    expect(match.moves).toBe(1);
    expect(match.active).toBe('p2');
  });

  it('counts a shift against the stall limit and a roll that paints resets it', () => {
    const match = createMatch();
    startMatch(match, new Rng(5), 'p1');
    expect(match.stalls).toBe(0);
    expect(match.stallLimit).toBe(STALL_LIMIT);
  });

  it('ends, every time, with two easy bots and no ceiling on the loop', () => {
    // Deliberately uncapped. A regression that stopped the match terminating would hang the
    // suite pointing at this line rather than passing quietly with a null winner.
    let longest = 0;
    for (let i = 0; i < 40; i += 1) {
      for (const opener of ['p1', 'p2'] as const) {
        const played = playMatch(seedFor(i), opener, 'easy', 'easy');
        expect(played.winner === 'p1' || played.winner === 'p2').toBe(true);
        expect(played.moves).toBeGreaterThan(4);
        longest = Math.max(longest, played.steps);
      }
    }
    // Ten minutes is the cross-game budget in `apps/web/src/data/termination.test.ts`.
    expect(longest).toBeLessThan(60 * 600);
    // And this game is nowhere near it: assert the real figure so a change that slowed a
    // turn down fails here first rather than at the catalogue-wide guard.
    expect(longest).toBeLessThan(60 * 120);
  });

  it('cannot run longer than the squares and the stall limit allow', () => {
    // The termination argument, asserted rather than described: every turn either paints one
    // of the floor squares or is one of a bounded run of shifts.
    for (let i = 0; i < 20; i += 1) {
      const played = playMatch(seedFor(i), 'p1', 'easy', 'hard');
      expect(played.moves).toBeLessThanOrEqual(played.floor * STALL_LIMIT + STALL_LIMIT);
    }
  });

  it('paints monotonically and never past the floor', () => {
    const match = createMatch();
    startMatch(match, new Rng(4242), 'p1');
    const streams: Record<SeatId, Rng> = { p1: new Rng(1), p2: new Rng(2) };
    let painted = 0;
    let floor = 0;
    for (let i = 0; i < CELL_COUNT; i += 1) {
      if ((match.position.terrain[i] ?? WALL) === FLOOR) floor += 1;
    }
    while (match.winner === null) {
      stepMatch(match, STEP, -1, 'normal', streams[match.active]);
      const now = paintCount(match.position, 'p1') + paintCount(match.position, 'p2');
      expect(now).toBeGreaterThanOrEqual(painted);
      expect(now).toBeLessThanOrEqual(floor);
      painted = now;
    }
  });

  it('never leaves a match undecided or drawn', () => {
    for (const tier of TIERS) {
      for (let i = 0; i < 20; i += 1) {
        const played = playMatch(seedFor(i), 'p1', tier, tier);
        expect(played.winner === 'p1' || played.winner === 'p2').toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ mirroring */

/**
 * Mirror symmetry is the property a win-rate ladder cannot see.
 *
 * A rule written in board coordinates rather than in the mover's own frame gives a game that
 * is a few points kinder to one chair and looks perfectly correct in every other test here.
 * Snowball Throw shipped two of them. So: take a board, mirror it, mirror the inputs, run
 * both, and require the results to be images of one another — on the roll, on every bot
 * decision, and on whole matches.
 */
describe('everything is covariant under the half-turn', () => {
  it('mirrors a position and its mirror back to itself', () => {
    const rng = new Rng(1234);
    for (let trial = 0; trial < 100; trial += 1) {
      const position = randomPosition(rng);
      expect(positionsMatch(mirrorPosition(mirrorPosition(position)), position)).toBe(true);
    }
  });

  it('mirrors a roll', () => {
    const rng = new Rng(24680);
    for (let trial = 0; trial < 400; trial += 1) {
      const position = randomPosition(rng);
      const seat: SeatId = trial % 2 === 0 ? 'p1' : 'p2';
      const dir = rng.int(0, DIRECTION_COUNT);

      expect(travelLength(mirrorPosition(position), otherSeat(seat), OPPOSITE[dir] ?? 0)).toBe(
        travelLength(position, seat, dir),
      );
      expect(paintGain(mirrorPosition(position), otherSeat(seat), OPPOSITE[dir] ?? 0)).toBe(
        paintGain(position, seat, dir),
      );

      const straight = mirrorPosition(position);
      const gain = applyMove(position, seat, dir);
      const mirroredGain = applyMove(straight, otherSeat(seat), OPPOSITE[dir] ?? 0);
      expect(mirroredGain).toBe(gain);
      expect(positionsMatch(mirrorPosition(position), straight)).toBe(true);
    }
  });

  it('mirrors the list of legal directions, in the same order', () => {
    const rng = new Rng(13579);
    const a = new Int32Array(DIRECTION_COUNT);
    const b = new Int32Array(DIRECTION_COUNT);
    for (let trial = 0; trial < 300; trial += 1) {
      const position = randomPosition(rng);
      const seat: SeatId = trial % 2 === 0 ? 'p1' : 'p2';
      const count = legalDirections(a, position, seat);
      const mirroredCount = legalDirections(b, mirrorPosition(position), otherSeat(seat));
      expect(mirroredCount).toBe(count);
      for (let i = 0; i < count; i += 1) expect(b[i]).toBe(OPPOSITE[a[i] ?? 0]);
    }
  });

  it('mirrors every bot decision, at every tier', () => {
    for (const tier of TIERS) {
      const rng = new Rng(8675309);
      for (let trial = 0; trial < 120; trial += 1) {
        const position = randomPosition(rng);
        const seat: SeatId = trial % 2 === 0 ? 'p1' : 'p2';
        const opener: SeatId = trial % 4 < 2 ? 'p1' : 'p2';
        // The same generator position for both, because a bot's stream belongs to the role
        // it is playing and the mirrored bot is playing the same role.
        const straight = chooseDirection(position, seat, new Rng(4711), tier, opener);
        const mirrored = chooseDirection(
          mirrorPosition(position),
          otherSeat(seat),
          new Rng(4711),
          tier,
          otherSeat(opener),
        );
        expect(mirrored).toBe(straight < 0 ? -1 : OPPOSITE[straight]);
      }
    }
  });

  it('plays the same seed from the two openings as one match and its mirror image', () => {
    // The strongest statement in this file. It is what makes seat balance structural rather
    // than measured: seat one's share at equal skill is exactly 50%, by construction.
    for (const tier of TIERS) {
      for (let i = 0; i < 30; i += 1) {
        const opened = playMatch(seedFor(i), 'p1', tier, tier);
        const answered = playMatch(seedFor(i), 'p2', tier, tier);
        expect(answered.p1).toBe(opened.p2);
        expect(answered.p2).toBe(opened.p1);
        expect(answered.moves).toBe(opened.moves);
        expect(answered.steps).toBe(opened.steps);
        expect(answered.winner).toBe(opened.winner === 'p1' ? 'p2' : 'p1');
      }
    }
  });
});

/* ------------------------------------------------------------------ the bot */

describe('the bot', () => {
  it('always answers with a direction it is allowed to roll', () => {
    const rng = new Rng(777);
    const buffer = new Int32Array(DIRECTION_COUNT);
    for (const tier of TIERS) {
      for (let trial = 0; trial < 200; trial += 1) {
        const position = randomPosition(rng);
        const seat: SeatId = trial % 2 === 0 ? 'p1' : 'p2';
        const dir = chooseDirection(position, seat, new Rng(trial), tier, 'p1');
        const count = legalDirections(buffer, position, seat);
        if (count === 0) {
          expect(dir).toBe(-1);
          continue;
        }
        expect(isLegalDirection(position, seat, dir)).toBe(true);
      }
    }
  });

  it('spends exactly two draws a turn, whatever it decides', () => {
    // A generator that spent a different number of values depending on what it found would
    // make a seat's play a function of its opponent's. Cup Pong measured that coupling.
    const rng = new Rng(31415);
    for (const tier of TIERS) {
      for (let trial = 0; trial < 60; trial += 1) {
        const position = randomPosition(rng);
        const seat: SeatId = trial % 2 === 0 ? 'p1' : 'p2';
        const stream = new Rng(2718);
        chooseDirection(position, seat, stream, tier, 'p1');
        const after = stream.save();
        const reference = new Rng(2718);
        reference.next();
        reference.next();
        expect(after).toEqual(reference.save());
      }
    }
  });

  it('is a pure function of the position it is shown', () => {
    // Rule 6: there is no channel for privileged state. The same board and the same stream
    // give the same move however the board was arrived at.
    const rng = new Rng(2024);
    for (const tier of TIERS) {
      for (let trial = 0; trial < 60; trial += 1) {
        const position = randomPosition(rng);
        const copy = createPosition();
        copy.terrain.set(position.terrain);
        copy.paint.set(position.paint);
        copy.roller.set(position.roller);
        const seat: SeatId = trial % 2 === 0 ? 'p1' : 'p2';
        expect(chooseDirection(copy, seat, new Rng(9), tier, 'p1')).toBe(
          chooseDirection(position, seat, new Rng(9), tier, 'p1'),
        );
      }
    }
  });

  it('plays a different match on easy and on hard', () => {
    const easy = playMatch(seedFor(3), 'p1', 'easy', 'easy');
    const hard = playMatch(seedFor(3), 'p1', 'hard', 'hard');
    expect(`${String(hard.p1)}:${String(hard.p2)}:${String(hard.moves)}`).not.toBe(
      `${String(easy.p1)}:${String(easy.p2)}:${String(easy.moves)}`,
    );
  });

  it('reaches deeper and blunders less as the tier rises', () => {
    expect(PROFILES.easy.depth).toBeLessThan(PROFILES.normal.depth);
    expect(PROFILES.normal.depth).toBeLessThan(PROFILES.hard.depth);
    expect(PROFILES.easy.blunder).toBeGreaterThan(PROFILES.normal.blunder);
    expect(PROFILES.normal.blunder).toBeGreaterThan(PROFILES.hard.blunder);
    expect(PROFILES.hard.blunder).toBe(0);
  });

  /**
   * The ladder, at a sample this suite can afford.
   *
   * The numbers in SPEC.md come from 500 seeds a pairing; these bounds are wide enough that
   * the cheap sample cannot fail them by luck, and narrow enough that a tier that stopped
   * being stronger than the one below it would.
   */
  it('is monotone: hard beats normal beats easy', () => {
    const pairs: [BotDifficulty, BotDifficulty, number][] = [
      ['hard', 'easy', 0.62],
      ['hard', 'normal', 0.53],
      ['normal', 'easy', 0.54],
    ];
    for (const [strong, weak, floor] of pairs) {
      let wins = 0;
      let played = 0;
      for (let i = 0; i < 60; i += 1) {
        for (const opener of ['p1', 'p2'] as const) {
          const result = playMatch(seedFor(i + 500), opener, strong, weak);
          played += 1;
          if (result.winner === 'p1') wins += 1;
        }
      }
      expect(
        wins / played,
        `${strong} took only ${String(wins)} of ${String(played)} from ${weak}`,
      ).toBeGreaterThan(floor);
    }
  });

  it('measures the same from both seat orders, exactly', () => {
    // A tier number measured from one chair is a tier number plus a chair number. Here the
    // two are separable by construction, and this asserts it end to end.
    let asSeatOne = 0;
    let asSeatTwo = 0;
    for (let i = 0; i < 40; i += 1) {
      for (const opener of ['p1', 'p2'] as const) {
        if (playMatch(seedFor(i), opener, 'hard', 'easy').winner === 'p1') asSeatOne += 1;
        if (playMatch(seedFor(i), opener, 'easy', 'hard').winner === 'p2') asSeatTwo += 1;
      }
    }
    expect(asSeatTwo).toBe(asSeatOne);
  });

  it('neither seat wins more than the 45-55 band at equal skill', () => {
    for (const tier of TIERS) {
      let seatOne = 0;
      let decided = 0;
      for (let i = 0; i < 50; i += 1) {
        for (const opener of ['p1', 'p2'] as const) {
          const result = playMatch(seedFor(i), opener, tier, tier);
          decided += 1;
          if (result.winner === 'p1') seatOne += 1;
        }
      }
      // Exactly even, not approximately: the mirror property makes it arithmetic.
      expect(seatOne * 2, `${tier} gave seat one ${String(seatOne)} of ${String(decided)}`).toBe(
        decided,
      );
    }
  });
});

describe('the tuning that SPEC.md records', () => {
  it('is reachable through the real match loop, not a copy of it', () => {
    const tuning: Tuning = {
      wallPairs: 2,
      stallLimit: 1,
      profiles: { normal: { depth: 1, blunder: 1 } },
    };
    const swept = playMatch(seedFor(1), 'p1', 'normal', 'normal', tuning);
    const shipped = playMatch(seedFor(1), 'p1', 'normal', 'normal');
    expect(swept.floor).toBe(CELL_COUNT - 4);
    expect(shipped.floor).toBe(CELL_COUNT - WALL_PAIRS * 2);
    expect(swept.moves).not.toBe(shipped.moves);
  });

  it('leaves the shipped defaults in place when nothing is passed', () => {
    const match: Match = createMatch();
    startMatch(match, new Rng(1), 'p1');
    expect(match.stallLimit).toBe(STALL_LIMIT);
    expect(match.profiles).toBeNull();
  });
});
