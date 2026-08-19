import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Dots and Boxes, as pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and any future balance harness all
 * drive this module, so what a harness measures is what a player feels.
 *
 * The board is a grid of dots. Players take turns drawing one edge between two adjacent
 * dots. Completing the fourth side of a box claims it **and grants another turn**, which
 * is the rule the whole game turns on: a chain of boxes falls to whoever opens it, so
 * the skill is in choosing which edge to give away.
 */

/** Boxes across and down. 5x5 boxes needs a 6x6 grid of dots. */
export const BOX_COLUMNS = 5;
export const BOX_ROWS = 5;
export const DOT_COLUMNS = BOX_COLUMNS + 1;
export const DOT_ROWS = BOX_ROWS + 1;

/** Horizontal edges: one per gap along each row of dots. */
export const H_EDGE_COUNT = BOX_COLUMNS * DOT_ROWS;
/** Vertical edges: one per gap down each column of dots. */
export const V_EDGE_COUNT = DOT_COLUMNS * BOX_ROWS;
export const EDGE_COUNT = H_EDGE_COUNT + V_EDGE_COUNT;
export const BOX_COUNT = BOX_COLUMNS * BOX_ROWS;

/** Who owns each box, or null while it is unclaimed. */
export type BoxOwner = SeatId | null;

export interface Board {
  /** True where an edge has been drawn. Horizontal edges first, then vertical. */
  readonly edges: boolean[];
  /**
   * Who drew each edge, or null where none has been.
   *
   * Recorded rather than inferred. The first version of this game inferred it from the
   * boxes an edge had closed, which is wrong for the great majority of edges — they close
   * nothing — and the fallback painted them in the colour of whoever had the move *now*.
   * So an edge visibly changed hands the moment the turn passed.
   */
  readonly edgeOwners: BoxOwner[];
  readonly boxes: BoxOwner[];
}

export function createBoard(): Board {
  return {
    edges: new Array<boolean>(EDGE_COUNT).fill(false),
    edgeOwners: new Array<BoxOwner>(EDGE_COUNT).fill(null),
    boxes: new Array<BoxOwner>(BOX_COUNT).fill(null),
  };
}

/** Reset in place, so a rematch allocates nothing. */
export function resetBoard(board: Board): void {
  board.edges.fill(false);
  board.edgeOwners.fill(null);
  board.boxes.fill(null);
}

/** Index of the horizontal edge above box column `column` on dot row `row`. */
export function horizontalEdge(column: number, row: number): number {
  return row * BOX_COLUMNS + column;
}

/** Index of the vertical edge left of box column `column` on box row `row`. */
export function verticalEdge(column: number, row: number): number {
  return H_EDGE_COUNT + row * DOT_COLUMNS + column;
}

export function isHorizontal(edge: number): boolean {
  return edge < H_EDGE_COUNT;
}

/**
 * The four edges of a box, in the order top, bottom, left, right.
 *
 * Written into a caller-supplied array rather than returned, because this is called for
 * every box adjacent to every candidate edge inside the bot's search — allocating here
 * would put four arrays per node on the heap.
 */
export function boxEdges(out: number[], box: number): void {
  const column = box % BOX_COLUMNS;
  const row = Math.floor(box / BOX_COLUMNS);
  out[0] = horizontalEdge(column, row);
  out[1] = horizontalEdge(column, row + 1);
  out[2] = verticalEdge(column, row);
  out[3] = verticalEdge(column + 1, row);
}

/** Scratch for the hot paths below. Single-threaded, and never held across a call. */
const scratchEdges = [0, 0, 0, 0];

/** How many of a box's four sides are drawn. */
export function sidesDrawn(board: Board, box: number): number {
  boxEdges(scratchEdges, box);
  let count = 0;
  for (let i = 0; i < 4; i += 1) {
    if (board.edges[scratchEdges[i] as number] === true) count += 1;
  }
  return count;
}

/**
 * The one or two boxes an edge borders.
 *
 * Written into `out` and returning how many were written, so an edge on the rim reports
 * one rather than padding with a sentinel a caller might forget to check.
 */
export function boxesTouching(out: number[], edge: number): number {
  if (isHorizontal(edge)) {
    const column = edge % BOX_COLUMNS;
    const row = Math.floor(edge / BOX_COLUMNS);
    let count = 0;
    // The box above this edge exists unless the edge is on the top rim.
    if (row > 0) out[count++] = (row - 1) * BOX_COLUMNS + column;
    if (row < BOX_ROWS) out[count++] = row * BOX_COLUMNS + column;
    return count;
  }
  const local = edge - H_EDGE_COUNT;
  const column = local % DOT_COLUMNS;
  const row = Math.floor(local / DOT_COLUMNS);
  let count = 0;
  if (column > 0) out[count++] = row * BOX_COLUMNS + (column - 1);
  if (column < BOX_COLUMNS) out[count++] = row * BOX_COLUMNS + column;
  return count;
}

const scratchBoxes = [0, 0];

export function isLegalMove(board: Board, edge: number): boolean {
  if (!Number.isInteger(edge) || edge < 0 || edge >= EDGE_COUNT) return false;
  return board.edges[edge] === false;
}

/**
 * Draw an edge.
 *
 * Returns how many boxes it completed — zero means the turn passes, one or two means the
 * same player goes again. Returns -1 for an illegal move so a caller cannot mistake a
 * refusal for a scoreless-but-legal move.
 */
export function applyMove(board: Board, edge: number, seat: SeatId): number {
  if (!isLegalMove(board, edge)) return -1;
  board.edges[edge] = true;
  board.edgeOwners[edge] = seat;

  let claimed = 0;
  const touching = boxesTouching(scratchBoxes, edge);
  for (let i = 0; i < touching; i += 1) {
    const box = scratchBoxes[i] as number;
    if (board.boxes[box] === null && sidesDrawn(board, box) === 4) {
      board.boxes[box] = seat;
      claimed += 1;
    }
  }
  return claimed;
}

export interface Tally {
  readonly p1: number;
  readonly p2: number;
}

export function tallyOf(board: Board): Tally {
  let p1 = 0;
  let p2 = 0;
  for (const owner of board.boxes) {
    if (owner === 'p1') p1 += 1;
    else if (owner === 'p2') p2 += 1;
  }
  return { p1, p2 };
}

export function isComplete(board: Board): boolean {
  return board.edges.every((drawn) => drawn);
}

/**
 * Who has won, or null while the board is unfinished.
 *
 * With 25 boxes a draw is impossible, but the check is here rather than assumed: change
 * the board to 4x4 and a draw becomes reachable, and a rule that silently stops being
 * true is worse than one that was always explicit.
 */
export function winnerOf(board: Board): SeatId | 'draw' | null {
  if (!isComplete(board)) return null;
  const { p1, p2 } = tallyOf(board);
  if (p1 === p2) return 'draw';
  return p1 > p2 ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** How often each tier ignores what it knows and plays at random instead. */
export const BLUNDER_CHANCE: Readonly<Record<BotDifficulty, number>> = Object.freeze({
  easy: 0.5,
  normal: 0.15,
  hard: 0,
});

/**
 * The move a bot plays.
 *
 * Three tiers of the same strategy rather than three strategies, and the difficulty is in
 * the *errors* rather than in the information: every tier sees exactly the board a human
 * sees. That is CLAUDE.md rule 6, and in this game it would be easy to break — a bot that
 * counted chains the player cannot see would be unbeatable and would feel like cheating.
 *
 * The strategy is the one every human learns:
 *
 * 1. Complete a box if you can. It is free and it grants another turn.
 * 2. Otherwise play an edge that does not give a box away — one whose neighbouring boxes
 *    all have fewer than two sides already drawn.
 * 3. If every move gives something away, give away the least: prefer the edge opening the
 *    shortest chain, because the opponent takes the whole of whatever you open.
 */
export function bestMove(board: Board, rng: Rng, blunderChance: number): number {
  const legal: number[] = [];
  for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
    if (board.edges[edge] === false) legal.push(edge);
  }
  if (legal.length === 0) return -1;

  if (blunderChance > 0 && rng.bool(blunderChance)) {
    return legal[rng.int(0, legal.length)] as number;
  }

  // 1. A free box.
  for (const edge of legal) {
    const touching = boxesTouching(scratchBoxes, edge);
    for (let i = 0; i < touching; i += 1) {
      if (sidesDrawn(board, scratchBoxes[i] as number) === 3) return edge;
    }
  }

  // 2. A safe edge — one that leaves no box on two sides, since a box on three sides is
  //    a gift to the opponent.
  const safe: number[] = [];
  for (const edge of legal) {
    const touching = boxesTouching(scratchBoxes, edge);
    let gives = false;
    for (let i = 0; i < touching; i += 1) {
      if (sidesDrawn(board, scratchBoxes[i] as number) === 2) {
        gives = true;
        break;
      }
    }
    if (!gives) safe.push(edge);
  }
  if (safe.length > 0) return safe[rng.int(0, safe.length)] as number;

  // 3. Everything gives something away, so give away the least. Sacrificing one box to
  //    keep the turn is how a good player breaks a long chain.
  let bestEdge = legal[0] as number;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const edge of legal) {
    const cost = chainLength(board, edge);
    if (cost < bestCost) {
      bestCost = cost;
      bestEdge = edge;
    }
  }
  return bestEdge;
}

/**
 * How many boxes the opponent takes if this edge is drawn.
 *
 * Walks the chain: taking a box often exposes the next one, and a player who opens a
 * chain of five loses all five. Bounded by the box count, so a cycle cannot loop forever.
 *
 * The edge is **not yet drawn** when this is called, which is the thing that is easy to
 * get wrong: a box that would be given away is one currently on *two* sides, because
 * drawing this edge takes it to three. Counting boxes already on three would count boxes
 * that were free before this move and have nothing to do with it.
 */
export function chainLength(board: Board, edge: number): number {
  if (board.edges[edge] === true) return 0;

  // Simulate the move, walk the consequences, and put the board back exactly as it was.
  // Mutating a shared board inside a bot search is a bug factory, so the restore is
  // unconditional rather than on a success path.
  board.edges[edge] = true;
  const seen = new Set<number>();
  const queue: number[] = [];
  const touching = boxesTouching(scratchBoxes, edge);
  for (let i = 0; i < touching; i += 1) {
    const box = scratchBoxes[i] as number;
    if (board.boxes[box] === null && sidesDrawn(board, box) === 3) queue.push(box);
  }

  let taken = 0;
  const neighbours = [0, 0];
  while (queue.length > 0 && taken <= BOX_COUNT) {
    const box = queue.pop() as number;
    if (seen.has(box)) continue;
    seen.add(box);
    taken += 1;
    // The one side still open is the door to the next box in the chain.
    boxEdges(scratchEdges, box);
    for (let i = 0; i < 4; i += 1) {
      const side = scratchEdges[i] as number;
      if (board.edges[side] === true) continue;
      const count = boxesTouching(neighbours, side);
      for (let n = 0; n < count; n += 1) {
        const next = neighbours[n] as number;
        if (next === box || seen.has(next)) continue;
        // Taking `box` means drawing `side`, which puts `next` on three sides if it was
        // on two — so the chain continues.
        if (board.boxes[next] === null && sidesDrawn(board, next) === 2) queue.push(next);
      }
    }
  }

  board.edges[edge] = false;
  return taken;
}
