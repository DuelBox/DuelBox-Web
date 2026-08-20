/**
 * A deterministic ceiling on how much thinking a bot may do in one step.
 *
 * A searching bot does all its work in the single frame its think-timer expires, and that
 * frame can be enormous. Measured on a development machine, with the hardest tier:
 *
 * | | worst single `update` |
 * |---|---|
 * | Reversi | 31.5 ms |
 * | Ultimate Tic Tac Toe | 27.4 ms |
 * | Drop Four | 12.2 ms |
 * | Colour Wars | 6.7 ms |
 * | Checkers | 5.5 ms |
 *
 * A 60 Hz frame is 16.7 ms, so the top two already drop a frame *here* — and a phone is
 * several times slower, which turns a considered move into a visible freeze.
 *
 * The obvious fix is a stopwatch, and it is the wrong one: a clock makes the search depend
 * on how fast the device is, and rule 8 says a phone and a laptop must step the identical
 * match. **A node count is deterministic** — the same position on any device spends the
 * same budget and returns the same move.
 *
 * Used with iterative deepening, running out is safe: the best move from the last depth
 * that finished is already in hand.
 */
export class SearchBudget {
  #left: number;
  readonly #size: number;

  constructor(nodes: number) {
    if (!Number.isInteger(nodes) || nodes <= 0) {
      throw new RangeError(
        `A search budget must be a positive whole number of nodes, got ${String(nodes)}`,
      );
    }
    this.#size = nodes;
    this.#left = nodes;
  }

  /** Charge one node. Returns false once the budget is gone. */
  spend(): boolean {
    if (this.#left <= 0) return false;
    this.#left -= 1;
    return true;
  }

  get exhausted(): boolean {
    return this.#left <= 0;
  }

  get spent(): number {
    return this.#size - this.#left;
  }

  get size(): number {
    return this.#size;
  }

  reset(): void {
    this.#left = this.#size;
  }
}

/**
 * The default ceiling, in nodes.
 *
 * Chosen by measuring the trade rather than by taste. Reversi's hard tier against its own
 * normal tier, over 120 games, against the worst single `update` across the collection:
 *
 * | budget | hard's win rate | worst step |
 * |---|---|---|
 * | 500 | 63.3% | 4.0 ms |
 * | 800 | 74.2% | 5.9 ms |
 * | **1,500** | **87.5%** | **6.1 ms** |
 * | effectively unbounded | 93.3% | 31.5 ms |
 *
 * 1,500 keeps almost all of the strength for a fifth of the cost. Tightening to 500 saves
 * two more milliseconds and throws away a quarter of the bot, which is a bad trade.
 *
 * It is a defensible ceiling because **every game with a search in it is turn-based**:
 * nothing is animating while the bot thinks, and the games that do animate cost under
 * 0.2 ms a step. A frame's pause before a considered move is what a thinking opponent
 * looks like.
 *
 * Two things went wrong on the way here, both caught by measuring *after* the change
 * rather than before. The first value tried was 12,000, which is above a depth-four sweep
 * of Reversi and so limited nothing. Then the budget was charged only on internal nodes,
 * leaving the leaves — the overwhelming majority of the work — free, so a sweep counted
 * 1,100 nodes while visiting 11,000.
 */
export const DEFAULT_SEARCH_NODES = 1_500;

/**
 * Search deeper and deeper until the budget runs out, keeping the best move from the last
 * depth that finished.
 *
 * A partial depth is thrown away rather than trusted: half a ply is not an opinion, it is
 * whichever moves happened to be generated first.
 */
export function deepen(
  budget: SearchBudget,
  maxDepth: number,
  searchToDepth: (depth: number) => number | null,
): number {
  let best = -1;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const move = searchToDepth(depth);
    if (move === null) break; // the budget ran out part-way; keep the last full depth
    best = move;
    if (budget.exhausted) break;
  }
  return best;
}
