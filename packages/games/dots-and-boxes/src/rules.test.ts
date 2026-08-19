import { describe, expect, it } from 'vitest';
import { Rng } from '@duelbox/engine';
import {
  BLUNDER_CHANCE,
  BOX_COLUMNS,
  BOX_COUNT,
  BOX_ROWS,
  EDGE_COUNT,
  H_EDGE_COUNT,
  V_EDGE_COUNT,
  applyMove,
  bestMove,
  boxEdges,
  boxesTouching,
  chainLength,
  createBoard,
  horizontalEdge,
  isComplete,
  isLegalMove,
  resetBoard,
  sidesDrawn,
  tallyOf,
  verticalEdge,
  winnerOf,
} from './rules.js';

describe('the board', () => {
  it('has the edge and box counts the geometry implies', () => {
    expect(BOX_COUNT).toBe(BOX_COLUMNS * BOX_ROWS);
    expect(H_EDGE_COUNT).toBe(BOX_COLUMNS * (BOX_ROWS + 1));
    expect(V_EDGE_COUNT).toBe((BOX_COLUMNS + 1) * BOX_ROWS);
    expect(EDGE_COUNT).toBe(H_EDGE_COUNT + V_EDGE_COUNT);
  });

  it('starts empty', () => {
    const board = createBoard();
    expect(board.edges.every((drawn) => !drawn)).toBe(true);
    expect(board.boxes.every((owner) => owner === null)).toBe(true);
    expect(isComplete(board)).toBe(false);
  });

  it('resets in place, so a rematch allocates nothing', () => {
    const board = createBoard();
    const edges = board.edges;
    applyMove(board, 0, 'p1');
    resetBoard(board);
    expect(board.edges).toBe(edges);
    expect(board.edges.every((drawn) => !drawn)).toBe(true);
  });

  it('gives every edge a distinct index', () => {
    const seen = new Set<number>();
    for (let row = 0; row <= BOX_ROWS; row += 1) {
      for (let column = 0; column < BOX_COLUMNS; column += 1) seen.add(horizontalEdge(column, row));
    }
    for (let row = 0; row < BOX_ROWS; row += 1) {
      for (let column = 0; column <= BOX_COLUMNS; column += 1) seen.add(verticalEdge(column, row));
    }
    expect(seen.size).toBe(EDGE_COUNT);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(EDGE_COUNT - 1);
  });
});

describe('geometry', () => {
  it('gives every box four distinct edges', () => {
    const out = [0, 0, 0, 0];
    for (let box = 0; box < BOX_COUNT; box += 1) {
      boxEdges(out, box);
      expect(new Set(out).size, `box ${String(box)}`).toBe(4);
      for (const edge of out) {
        expect(edge).toBeGreaterThanOrEqual(0);
        expect(edge).toBeLessThan(EDGE_COUNT);
      }
    }
  });

  it('agrees with itself: an edge of a box touches that box', () => {
    // The two mappings are written separately, so this is the check that they describe
    // the same board rather than two boards that happen to be the same size.
    const edges = [0, 0, 0, 0];
    const boxes = [0, 0];
    for (let box = 0; box < BOX_COUNT; box += 1) {
      boxEdges(edges, box);
      for (const edge of edges) {
        const count = boxesTouching(boxes, edge);
        expect(boxes.slice(0, count), `edge ${String(edge)} of box ${String(box)}`).toContain(box);
      }
    }
  });

  it('gives rim edges one box and interior edges two', () => {
    const boxes = [0, 0];
    let rim = 0;
    let interior = 0;
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
      const count = boxesTouching(boxes, edge);
      expect(count === 1 || count === 2, `edge ${String(edge)} touches ${String(count)}`).toBe(
        true,
      );
      if (count === 1) rim += 1;
      else interior += 1;
    }
    // The rim of a 5x5 grid of boxes is 4 sides of 5 edges.
    expect(rim).toBe(2 * BOX_COLUMNS + 2 * BOX_ROWS);
    expect(rim + interior).toBe(EDGE_COUNT);
  });
});

describe('drawing an edge', () => {
  it('refuses an edge already drawn, and says so distinctly', () => {
    const board = createBoard();
    expect(applyMove(board, 0, 'p1')).toBe(0);
    // -1 rather than 0: a refusal must not be mistakable for a legal move that scored
    // nothing, because those two mean opposite things for whose turn it is.
    expect(applyMove(board, 0, 'p2')).toBe(-1);
  });

  it('refuses an edge off the board', () => {
    const board = createBoard();
    for (const edge of [-1, EDGE_COUNT, 1.5, Number.NaN]) {
      expect(isLegalMove(board, edge), String(edge)).toBe(false);
      expect(applyMove(board, edge, 'p1')).toBe(-1);
    }
  });

  it('claims a box on its fourth side and not before', () => {
    const board = createBoard();
    const edges = [0, 0, 0, 0];
    boxEdges(edges, 0);
    for (let i = 0; i < 3; i += 1) {
      expect(applyMove(board, edges[i] as number, 'p1')).toBe(0);
      expect(board.boxes[0]).toBeNull();
    }
    expect(sidesDrawn(board, 0)).toBe(3);
    expect(applyMove(board, edges[3] as number, 'p1')).toBe(1);
    expect(board.boxes[0]).toBe('p1');
  });

  it('can claim two boxes with one edge', () => {
    // The shared edge between two boxes each already on three sides.
    const board = createBoard();
    const shared = verticalEdge(1, 0);
    const left = [0, 0, 0, 0];
    const right = [0, 0, 0, 0];
    boxEdges(left, 0);
    boxEdges(right, 1);
    for (const edge of [...left, ...right]) {
      if (edge !== shared) applyMove(board, edge, 'p1');
    }
    expect(applyMove(board, shared, 'p2')).toBe(2);
    expect(board.boxes[0]).toBe('p2');
    expect(board.boxes[1]).toBe('p2');
  });

  it('gives the box to whoever drew the fourth side, not whoever drew the first three', () => {
    const board = createBoard();
    const edges = [0, 0, 0, 0];
    boxEdges(edges, 4);
    for (let i = 0; i < 3; i += 1) applyMove(board, edges[i] as number, 'p1');
    applyMove(board, edges[3] as number, 'p2');
    expect(board.boxes[4]).toBe('p2');
  });
});

describe('the score', () => {
  it('counts boxes per seat', () => {
    const board = createBoard();
    const edges = [0, 0, 0, 0];
    boxEdges(edges, 0);
    for (const edge of edges) applyMove(board, edge, 'p1');
    expect(tallyOf(board)).toEqual({ p1: 1, p2: 0 });
  });

  it('has no winner until every edge is drawn', () => {
    const board = createBoard();
    for (let edge = 0; edge < EDGE_COUNT - 1; edge += 1) {
      applyMove(board, edge, 'p1');
      expect(winnerOf(board)).toBeNull();
    }
    applyMove(board, EDGE_COUNT - 1, 'p1');
    expect(winnerOf(board)).toBe('p1');
  });

  it('accounts for every box once the board is full', () => {
    const board = createBoard();
    const rng = new Rng(11);
    let seat: 'p1' | 'p2' = 'p1';
    while (!isComplete(board)) {
      const move = bestMove(board, rng, 0);
      const claimed = applyMove(board, move, seat);
      expect(claimed).toBeGreaterThanOrEqual(0);
      if (claimed === 0) seat = seat === 'p1' ? 'p2' : 'p1';
    }
    const { p1, p2 } = tallyOf(board);
    // Every box belongs to someone. A dropped box would be an invisible scoring bug.
    expect(p1 + p2).toBe(BOX_COUNT);
  });
});

describe('the chain', () => {
  it('counts a single exposed box as one', () => {
    const board = createBoard();
    const edges = [0, 0, 0, 0];
    boxEdges(edges, 0);
    for (let i = 0; i < 2; i += 1) applyMove(board, edges[i] as number, 'p1');
    // Drawing a third side leaves the box on three: one free box for the opponent.
    expect(chainLength(board, edges[2] as number)).toBe(1);
  });

  it('counts a run of boxes, because the opponent takes all of them', () => {
    // Build a corridor: boxes 0..3 in a row, each missing only its shared verticals.
    const board = createBoard();
    for (let box = 0; box < 4; box += 1) {
      const column = box % BOX_COLUMNS;
      applyMove(board, horizontalEdge(column, 0), 'p1');
      applyMove(board, horizontalEdge(column, 1), 'p1');
    }
    applyMove(board, verticalEdge(0, 0), 'p1');
    // Closing the far end opens the whole corridor.
    const length = chainLength(board, verticalEdge(4, 0));
    expect(length).toBeGreaterThan(1);
  });

  it('never runs away, even on a board full of threes', () => {
    const board = createBoard();
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
      if (edge % 3 !== 0) applyMove(board, edge, 'p1');
    }
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
      expect(chainLength(board, edge)).toBeLessThanOrEqual(BOX_COUNT + 1);
    }
  });
});

describe('the bot', () => {
  it('always returns a legal move while any remain', () => {
    const board = createBoard();
    const rng = new Rng(3);
    let seat: 'p1' | 'p2' = 'p1';
    while (!isComplete(board)) {
      const move = bestMove(board, rng, 0);
      expect(isLegalMove(board, move), `illegal move ${String(move)}`).toBe(true);
      if (applyMove(board, move, seat) === 0) seat = seat === 'p1' ? 'p2' : 'p1';
    }
    expect(bestMove(board, rng, 0)).toBe(-1);
  });

  it('takes a free box when one is available', () => {
    const board = createBoard();
    const edges = [0, 0, 0, 0];
    boxEdges(edges, 12);
    for (let i = 0; i < 3; i += 1) applyMove(board, edges[i] as number, 'p1');
    expect(bestMove(board, new Rng(1), 0)).toBe(edges[3]);
  });

  it('does not hand over a box while a safe edge exists', () => {
    const board = createBoard();
    const edges = [0, 0, 0, 0];
    boxEdges(edges, 0);
    // Box 0 now has two sides: drawing a third would give it away.
    applyMove(board, edges[0] as number, 'p1');
    applyMove(board, edges[1] as number, 'p1');

    const move = bestMove(board, new Rng(5), 0);
    const boxes = [0, 0];
    const count = boxesTouching(boxes, move);
    for (let i = 0; i < count; i += 1) {
      expect(sidesDrawn(board, boxes[i] as number), 'bot opened a box needlessly').not.toBe(2);
    }
  });

  it('is deterministic for a seed', () => {
    const play = (): number[] => {
      const board = createBoard();
      const rng = new Rng(99);
      const moves: number[] = [];
      let seat: 'p1' | 'p2' = 'p1';
      while (!isComplete(board)) {
        const move = bestMove(board, rng, BLUNDER_CHANCE.normal);
        moves.push(move);
        if (applyMove(board, move, seat) === 0) seat = seat === 'p1' ? 'p2' : 'p1';
      }
      return moves;
    };
    expect(play()).toEqual(play());
  });

  it('beats a blundering version of itself over a series', () => {
    // The tiers must actually differ in strength, or difficulty is a label rather than a
    // setting. Played as a series because one game of this can turn on a single chain.
    let hardWins = 0;
    for (let game = 0; game < 12; game += 1) {
      const board = createBoard();
      const rng = new Rng(1000 + game);
      let seat: 'p1' | 'p2' = game % 2 === 0 ? 'p1' : 'p2';
      while (!isComplete(board)) {
        const chance = seat === 'p1' ? BLUNDER_CHANCE.hard : BLUNDER_CHANCE.easy;
        const move = bestMove(board, rng, chance);
        if (applyMove(board, move, seat) === 0) seat = seat === 'p1' ? 'p2' : 'p1';
      }
      if (winnerOf(board) === 'p1') hardWins += 1;
    }
    expect(hardWins, `hard won ${String(hardWins)} of 12`).toBeGreaterThan(6);
  });
});

describe('who drew each edge', () => {
  it('records the seat that drew it, not the seat that later owns the box', () => {
    // Inferring this from claimed boxes was the first implementation and it was wrong for
    // the great majority of edges, which close nothing: they were painted in the colour
    // of whoever had the move *now*, so an edge changed hands when the turn passed.
    const board = createBoard();
    applyMove(board, 0, 'p1');
    applyMove(board, 1, 'p2');
    expect(board.edgeOwners[0]).toBe('p1');
    expect(board.edgeOwners[1]).toBe('p2');
  });

  it('leaves an undrawn edge unowned', () => {
    const board = createBoard();
    expect(board.edgeOwners[5]).toBeNull();
  });

  it('does not change hands when a box is later completed by the other seat', () => {
    const board = createBoard();
    const edges = [0, 0, 0, 0];
    boxEdges(edges, 0);
    for (let i = 0; i < 3; i += 1) applyMove(board, edges[i] as number, 'p1');
    applyMove(board, edges[3] as number, 'p2');
    for (let i = 0; i < 3; i += 1) {
      expect(board.edgeOwners[edges[i] as number], 'p1 drew this edge').toBe('p1');
    }
    expect(board.edgeOwners[edges[3] as number]).toBe('p2');
    expect(board.boxes[0], 'the box goes to whoever closed it').toBe('p2');
  });

  it('is cleared by a reset', () => {
    const board = createBoard();
    applyMove(board, 0, 'p1');
    resetBoard(board);
    expect(board.edgeOwners.every((owner) => owner === null)).toBe(true);
  });

  it('records an owner for exactly the edges that are drawn', () => {
    const board = createBoard();
    const rng = new Rng(7);
    let seat: 'p1' | 'p2' = 'p1';
    while (!isComplete(board)) {
      const move = bestMove(board, rng, 0);
      if (applyMove(board, move, seat) === 0) seat = seat === 'p1' ? 'p2' : 'p1';
    }
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
      expect(board.edges[edge], `edge ${String(edge)}`).toBe(true);
      expect(board.edgeOwners[edge], `edge ${String(edge)} has no owner`).not.toBeNull();
    }
  });
});
