import type { Rng, SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES, SearchBudget, deepen, resolve } from '@duelbox/game-sdk';

/**
 * Blocks, as pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and the balance harness all drive
 * this module, so what a harness measures is what a player feels.
 *
 * The reference is a solitaire: drop shapes onto a nine-by-nine grid, and a full row,
 * column or three-by-three box clears. The duel is in SPEC.md; the two rules that make it
 * one are here. **A block belongs to the seat that placed it**, and **the tray of three is
 * shared** — you draw from the same three shapes your opponent will draw from, and it is
 * only refilled once all three are gone, so the third pick of every tray is forced.
 */

export const SIZE = 9;
export const CELL_COUNT = SIZE * SIZE;
export const BOX_SIZE = 3;
/** Nine rows, nine columns, nine boxes. */
export const UNIT_COUNT = 27;
export const TRAY_SIZE = 3;

/**
 * How many shapes a match is dealt.
 *
 * Sixteen trays of three, so the number of trays is even. Because three is odd and the
 * seats strictly alternate, the seat that gets the free first pick of a tray changes every
 * tray by itself — and over an even number of trays each seat opens exactly half of them
 * and is forced on the last shape of exactly half. That is what makes the sequence fair
 * structurally rather than on average.
 *
 * It is also the backstop that makes the match unable to run for ever: forty-eight
 * placements is a hard ceiling on the number of turns whatever the two players do. It is
 * deliberately far above where matches actually end — see SPEC.md, where the measured
 * share of matches that reach it is recorded.
 */
export const PIECES_PER_MATCH = 48;

export const EMPTY = 0;
export const MARK_P1 = 1;
export const MARK_P2 = 2;

export function markOf(seat: SeatId): number {
  return seat === 'p1' ? MARK_P1 : MARK_P2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function columnOf(cell: number): number {
  return cell % SIZE;
}

export function rowOf(cell: number): number {
  return Math.floor(cell / SIZE);
}

/**
 * The shapes, drawn rather than listed.
 *
 * A polyomino set is a rule, not artwork — these are written out here so the set can be
 * read at a glance and so the half-turn table below can be checked by eye. Rotation is not
 * a move a player makes: a shape is placed exactly as it is dealt, which is what keeps a
 * turn to one press on one slot for a thumb and for a key alike.
 */
const SHAPES: readonly (readonly string[])[] = [
  ['#'], // 0  single
  ['##'], // 1  pair across
  ['#', '#'], // 2  pair down
  ['###'], // 3  three across
  ['#', '#', '#'], // 4  three down
  ['####'], // 5  four across
  ['#', '#', '#', '#'], // 6  four down
  ['#####'], // 7  five across
  ['#', '#', '#', '#', '#'], // 8  five down
  ['##', '##'], // 9  two-by-two
  ['###', '###', '###'], // 10 three-by-three
  ['##', '#.'], // 11 corner, opening down-right
  ['##', '.#'], // 12 corner, opening down-left
  ['.#', '##'], // 13 corner, opening up-left
  ['#.', '##'], // 14 corner, opening up-right
];

/**
 * Which shape each one becomes under a half-turn of the board.
 *
 * The set is closed under the half-turn — every entry's 180° rotation is also in the set —
 * which is what lets `rules.test.ts` mirror a whole position, tray included, and require
 * the evaluation to come out identical. Nine of the fifteen are their own rotation; the
 * four corners pair up across the diagonal.
 */
const HALF_TURN_OF: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 11, 12];

export interface Piece {
  readonly width: number;
  readonly height: number;
  /** Board-index deltas from the top-left cell of the bounding box. */
  readonly offsets: readonly number[];
  /** How many cells it covers. */
  readonly size: number;
  /**
   * Which cell of the bounding box sits under the cursor or the finger.
   *
   * The middle of the bounding box, rounded down, so an odd shape is centred on the press
   * exactly and an even one hangs half a cell off it. See SPEC.md for why that offset is
   * fixed in board coordinates rather than in the seat's.
   */
  readonly anchorX: number;
  readonly anchorY: number;
}

function buildPieces(): readonly Piece[] {
  return SHAPES.map((rows) => {
    const height = rows.length;
    const width = (rows[0] ?? '').length;
    const offsets: number[] = [];
    for (let y = 0; y < height; y += 1) {
      const row = rows[y] ?? '';
      for (let x = 0; x < width; x += 1) {
        if (row[x] === '#') offsets.push(y * SIZE + x);
      }
    }
    return {
      width,
      height,
      offsets,
      size: offsets.length,
      anchorX: (width - 1) >> 1,
      anchorY: (height - 1) >> 1,
    };
  });
}

export const PIECES: readonly Piece[] = buildPieces();
export const PIECE_COUNT = PIECES.length;

/** The shape `piece` becomes when the whole board is turned half a turn. */
export function halfTurnOf(piece: number): number {
  return HALF_TURN_OF[piece] ?? piece;
}

/** The nine cells of each of the twenty-seven units: rows, then columns, then boxes. */
function buildUnits(): readonly (readonly number[])[] {
  const units: number[][] = [];
  for (let r = 0; r < SIZE; r += 1) {
    const cells: number[] = [];
    for (let c = 0; c < SIZE; c += 1) cells.push(r * SIZE + c);
    units.push(cells);
  }
  for (let c = 0; c < SIZE; c += 1) {
    const cells: number[] = [];
    for (let r = 0; r < SIZE; r += 1) cells.push(r * SIZE + c);
    units.push(cells);
  }
  for (let b = 0; b < SIZE; b += 1) {
    const cells: number[] = [];
    const originRow = Math.floor(b / BOX_SIZE) * BOX_SIZE;
    const originColumn = (b % BOX_SIZE) * BOX_SIZE;
    for (let y = 0; y < BOX_SIZE; y += 1) {
      for (let x = 0; x < BOX_SIZE; x += 1) {
        cells.push((originRow + y) * SIZE + originColumn + x);
      }
    }
    units.push(cells);
  }
  return units;
}

export const UNIT_CELLS: readonly (readonly number[])[] = buildUnits();

/** The three units — one row, one column, one box — each cell belongs to. */
function buildCellUnits(): readonly (readonly number[])[] {
  const owners: number[][] = Array.from({ length: CELL_COUNT }, () => []);
  for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
    for (const cell of UNIT_CELLS[unit] ?? []) (owners[cell] ?? []).push(unit);
  }
  return owners;
}

const CELL_UNITS: readonly (readonly number[])[] = buildCellUnits();

/**
 * What the player to move can see: the board, the shared tray, and what each seat has
 * banked. The bot is handed exactly this and nothing else — there is no argument carrying
 * the undealt shapes, so it cannot look at them however tempting a future evaluation makes
 * it. See SPEC.md, "Rule 6".
 */
export interface Position {
  readonly board: Uint8Array;
  /** Three shape ids; -1 for a slot already taken out of this tray. */
  readonly tray: Int8Array;
  p1: number;
  p2: number;
}

export interface MatchState extends Position {
  /** The whole deal, drawn once from the match seed. Never shown to a bot. */
  readonly deal: Int8Array;
  /** Cells the last placement cleared, for the reveal. */
  readonly cleared: Uint8Array;
  /** Cells the last placement filled, for the reveal. */
  readonly placedCells: Uint8Array;
  dealt: number;
  placed: number;
  active: SeatId;
  /** Cells the last placement cleared for the seat that made it, and for the other. */
  lastGain: number;
  lastLoss: number;
  /**
   * The score at the end of the last **complete round** — one shape each.
   *
   * `p1`/`p2` are cells banked the instant they are banked, which is what the bot reasons
   * about. These two are what the match is settled on, and they are not the same number
   * whenever a jam lands part-way through a round. See {@link winnerOf}.
   */
  scoredP1: number;
  scoredP2: number;
}

function emptyPosition(): Position {
  return {
    board: new Uint8Array(CELL_COUNT),
    tray: new Int8Array(TRAY_SIZE).fill(-1),
    p1: 0,
    p2: 0,
  };
}

/**
 * A whole match, dealt from the match seed.
 *
 * The deal is a run of shuffled bags rather than independent draws, so a match cannot hand
 * one tray four three-by-threes by luck; and because it is drawn before the first move, no
 * later draw can depend on how the game went.
 */
export function createMatch(rng: Rng, openingSeat: SeatId = 'p1'): MatchState {
  const deal = new Int8Array(PIECES_PER_MATCH);
  const bag: number[] = [];
  for (let i = 0; i < PIECES_PER_MATCH; i += 1) {
    if (bag.length === 0) {
      for (let piece = 0; piece < PIECE_COUNT; piece += 1) bag.push(piece);
      rng.shuffle(bag);
    }
    deal[i] = bag.pop() ?? 0;
  }

  const base = emptyPosition();
  const state: MatchState = {
    board: base.board,
    tray: base.tray,
    p1: 0,
    p2: 0,
    deal,
    cleared: new Uint8Array(CELL_COUNT),
    placedCells: new Uint8Array(CELL_COUNT),
    dealt: 0,
    placed: 0,
    active: openingSeat,
    lastGain: 0,
    lastLoss: 0,
    scoredP1: 0,
    scoredP2: 0,
  };
  refill(state);
  return state;
}

/**
 * Deal a fresh tray, but only once the last one is empty.
 *
 * Refilling a slot as soon as it is used would hand every player three choices for ever
 * and take the whole draft out of the game. Waiting until the tray is bare is what makes
 * the third pick forced, and the forced pick is where a strong player gets stuck.
 */
function refill(state: MatchState): void {
  for (const slot of state.tray) if (slot >= 0) return;
  for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
    state.tray[slot] = state.dealt < PIECES_PER_MATCH ? (state.deal[state.dealt++] ?? -1) : -1;
  }
}

export function traySize(tray: Int8Array): number {
  let count = 0;
  for (const piece of tray) if (piece >= 0) count += 1;
  return count;
}

/* ------------------------------------------------------------------- placements */

/**
 * A move is one number: which tray slot, and where the shape's bounding box lands.
 *
 * Packed because the bot generates hundreds of them a turn and an array of objects would
 * allocate on a path CLAUDE.md rule 5 forbids allocating on.
 */
export function encodeMove(slot: number, topLeft: number): number {
  return slot * CELL_COUNT + topLeft;
}

export function slotOf(move: number): number {
  return Math.floor(move / CELL_COUNT);
}

export function topLeftOf(move: number): number {
  return move % CELL_COUNT;
}

/** Where the bounding box lands if `piece` is dropped with its anchor on `cell`, or -1. */
export function topLeftFor(piece: number, cell: number): number {
  const shape = PIECES[piece];
  if (shape === undefined || cell < 0 || cell >= CELL_COUNT) return -1;
  const column = columnOf(cell) - shape.anchorX;
  const row = rowOf(cell) - shape.anchorY;
  if (column < 0 || row < 0) return -1;
  if (column + shape.width > SIZE || row + shape.height > SIZE) return -1;
  return row * SIZE + column;
}

/** Whether `piece` fits with its bounding box at `topLeft`: on the board, on empty cells. */
export function fitsAt(board: Uint8Array, piece: number, topLeft: number): boolean {
  const shape = PIECES[piece];
  if (shape === undefined || topLeft < 0 || topLeft >= CELL_COUNT) return false;
  const column = columnOf(topLeft);
  const row = rowOf(topLeft);
  if (column + shape.width > SIZE || row + shape.height > SIZE) return false;
  for (const offset of shape.offsets) {
    if ((board[topLeft + offset] ?? MARK_P1) !== EMPTY) return false;
  }
  return true;
}

/**
 * Every move available from this position, written into `out` and returning the count.
 *
 * Written into a caller-supplied buffer rather than returning an array: this runs at every
 * node of the bot's search, and a fresh array there would allocate per node.
 */
export function legalMoves(out: Int16Array, board: Uint8Array, tray: Int8Array): number {
  let count = 0;
  for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
    const piece = tray[slot] ?? -1;
    if (piece < 0) continue;
    const shape = PIECES[piece];
    if (shape === undefined) continue;
    for (let row = 0; row + shape.height <= SIZE; row += 1) {
      for (let column = 0; column + shape.width <= SIZE; column += 1) {
        const topLeft = row * SIZE + column;
        if (fitsAt(board, piece, topLeft)) out[count++] = encodeMove(slot, topLeft);
      }
    }
  }
  return count;
}

/** Whether the seat to move has anywhere at all to put anything in the tray. */
export function hasPlacement(board: Uint8Array, tray: Int8Array): boolean {
  for (let slot = 0; slot < TRAY_SIZE; slot += 1) {
    const piece = tray[slot] ?? -1;
    if (piece < 0) continue;
    const shape = PIECES[piece];
    if (shape === undefined) continue;
    for (let row = 0; row + shape.height <= SIZE; row += 1) {
      for (let column = 0; column + shape.width <= SIZE; column += 1) {
        if (fitsAt(board, piece, row * SIZE + column)) return true;
      }
    }
  }
  return false;
}

/** Scratch for the clear pass: which units to check, and which cells come off. */
const UNIT_TOUCHED = new Uint8Array(UNIT_COUNT);
const CELL_CLEARED = new Uint8Array(CELL_COUNT);

/**
 * Put a shape down and settle whatever it completes.
 *
 * Returns the number of cells the mover banked, or -1 if the move was refused. A legal
 * move can bank nothing, so -1 and 0 are deliberately different answers.
 *
 * **Every cleared cell scores for whoever placed it**, not for whoever completed the line.
 * That is the whole duel — see SPEC.md. The mover's own cells in the line count too, which
 * is why completing a line you own is worth more than completing one you do not.
 *
 * `clearedOut` and `placedOut` are for the reveal, and may be null: nothing in the rules
 * reads them.
 */
export function place(
  position: Position,
  move: number,
  seat: SeatId,
  clearedOut: Uint8Array | null,
  placedOut: Uint8Array | null,
): number {
  const slot = slotOf(move);
  if (slot < 0 || slot >= TRAY_SIZE) return -1;
  const piece = position.tray[slot] ?? -1;
  if (piece < 0) return -1;
  const topLeft = topLeftOf(move);
  if (!fitsAt(position.board, piece, topLeft)) return -1;

  const shape = PIECES[piece];
  if (shape === undefined) return -1;
  const mark = markOf(seat);
  const board = position.board;

  if (placedOut !== null) placedOut.fill(0);
  UNIT_TOUCHED.fill(0);
  for (const offset of shape.offsets) {
    const cell = topLeft + offset;
    board[cell] = mark;
    if (placedOut !== null) placedOut[cell] = 1;
    for (const unit of CELL_UNITS[cell] ?? []) UNIT_TOUCHED[unit] = 1;
  }
  position.tray[slot] = -1;

  // Only a unit the shape landed in can have become complete, so the other units are not
  // even looked at. Every complete unit is found before any of them is emptied, so two
  // units crossing each other both clear rather than the second one losing its cells to
  // the first.
  CELL_CLEARED.fill(0);
  let cleared = 0;
  for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
    if (UNIT_TOUCHED[unit] !== 1) continue;
    const cells = UNIT_CELLS[unit] ?? [];
    let full = true;
    for (const cell of cells) {
      if ((board[cell] ?? EMPTY) === EMPTY) {
        full = false;
        break;
      }
    }
    if (!full) continue;
    for (const cell of cells) CELL_CLEARED[cell] = 1;
    cleared += 1;
  }

  let gainP1 = 0;
  let gainP2 = 0;
  if (cleared > 0) {
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      if (CELL_CLEARED[cell] !== 1) continue;
      if ((board[cell] ?? EMPTY) === MARK_P1) gainP1 += 1;
      else gainP2 += 1;
      board[cell] = EMPTY;
    }
  }
  position.p1 += gainP1;
  position.p2 += gainP2;
  if (clearedOut !== null) clearedOut.set(CELL_CLEARED);

  return seat === 'p1' ? gainP1 : gainP2;
}

/**
 * Play a move in a real match: settle it, deal a fresh tray if this emptied the old one,
 * and hand the turn over. Returns the mover's gain, or -1 if the move was refused.
 *
 * The refill is here and not in {@link place} on purpose. The search calls `place` and so
 * can never see a shape that has not been dealt yet — the horizon in `chooseMove` is real
 * rather than a promise.
 */
export function playMove(state: MatchState, move: number): number {
  const seat = state.active;
  const before = seat === 'p1' ? state.p2 : state.p1;
  const gain = place(state, move, seat, state.cleared, state.placedCells);
  if (gain < 0) return -1;
  state.lastGain = gain;
  state.lastLoss = (seat === 'p1' ? state.p2 : state.p1) - before;
  state.placed += 1;
  // The round has closed: both seats have now placed the same number of shapes, so the
  // score is safe to settle. See `winnerOf` for why an unclosed round is not.
  if (state.placed % 2 === 0) {
    state.scoredP1 = state.p1;
    state.scoredP2 = state.p2;
  }
  refill(state);
  state.active = otherOf(seat);
  return gain;
}

/**
 * Whether the match is finished.
 *
 * Two ways, and both are needed. **The seat to move has nowhere to put anything** is the
 * reference's own game over, made two-player, and it is how most matches end. **The deal
 * has run out** is the structural ceiling that makes the match unable to run for ever
 * whatever the two players do — a clock would not, because a clock ends nothing that the
 * shell is not already ending.
 */
export function isOver(state: MatchState): boolean {
  if (state.placed >= PIECES_PER_MATCH) return true;
  return !hasPlacement(state.board, state.tray);
}

/**
 * Who won, or null while the match is still running.
 *
 * Settled on **complete rounds** — one shape each. Whether a shape fits is a fact about the
 * board and the tray, both of which the two seats share, so a jam is not something that
 * happens to a seat: it happens to the position. But it can land part-way through a round,
 * and then the seat that opened the round has placed one shape more than the seat that
 * answers it, for free.
 *
 * Honestly: **it measures as inert**, at half a point of opener share over 400 seeds, because
 * neither bot reads the score and so neither goes looking for the position it protects
 * against — a placement that banks a line *and* jams the board, which is available to the
 * seat that moves first and to nobody else. It is kept for the reason Cup Pong kept its own
 * inert alternation: it costs two numbers, and it is what keeps the property true the
 * moment a player who does read the score sits down. The table is in SPEC.md.
 */
export function winnerOf(state: MatchState): SeatId | 'draw' | null {
  return resolve(
    { kind: 'highest-when-time-expires' },
    { p1: state.scoredP1, p2: state.scoredP2 },
    { timeExpired: isOver(state) },
  );
}

/* ------------------------------------------------------------------------- the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * The ladder, and it is two knobs rather than four.
 *
 * `blunder` is a shape played wherever it will go instead of where the bot decided — the
 * ordinary way a person plays without thinking, and the axis that separates `easy` from
 * `normal`. `beam` is how many of its own candidate moves a tier checks the answer to;
 * nought means it does not look ahead at all, and it is what separates `normal` from
 * `hard`.
 *
 * Two more were built as per-tier switches — whether a tier counts the lines it owns, and
 * whether it notices the board running out of room — swept, and then **promoted to always
 * on** rather than kept. Both are real skills and both make a tier stronger, but turning
 * either off measurably moved the share of matches won by the seat that *opens*, which is
 * a fairness defect rather than a difficulty setting: a weak tier must be weak in a way
 * that does not depend on which chair you are sitting in. Sudoku found the same thing
 * about its `examine` cap. The measurements are in SPEC.md.
 */
export interface Tier {
  readonly blunder: number;
  readonly beam: number;
}

export const TIERS: Readonly<Record<BotDifficulty, Tier>> = Object.freeze({
  easy: { blunder: 0.45, beam: 0 },
  normal: { blunder: 0.1, beam: 0 },
  hard: { blunder: 0, beam: 4 },
});

/**
 * What a position is worth to `seat`, in hundredths of a banked cell.
 *
 * `SCORE_WEIGHT` dominates by design: a cell banked is a cell banked, and no arrangement
 * of the board is worth trading one for. Both weights were swept and both have a peak
 * rather than a direction — see SPEC.md. A fourth term, a plain count of empty cells, was
 * written, swept and deleted: it moved nothing at any value from 0 to 8.
 */
const SCORE_WEIGHT = 100;
/** A cell of mine in a unit is worth more the closer that unit is to clearing. */
const LINE_WEIGHT = 2;
/** Somewhere a two-by-two still fits. The cheap, honest measure of a board with room. */
const OPEN_WEIGHT = 3;

/**
 * How many positions a bot may look at in one turn.
 *
 * The SDK's node budget rather than a clock, because a clock makes the move depend on how
 * fast the device is and rule 8 says a phone and a laptop step the identical match. The
 * SDK's default is enough here, and the arithmetic says why: the widest position this game
 * has is an empty board with three single cells in the tray, which offers 3 × 81 = 243
 * moves; each of the four the beam keeps leaves a tray of two, so at most 2 × 81 = 162
 * answers. 243 + 4 × 162 = 891, comfortably inside 1,500 — so the second sweep is never
 * thrown away in the wide positions, which is exactly where a bot that stops looking ahead
 * would be most obvious. The measured worst step is in SPEC.md.
 */
const SEARCH_NODES = DEFAULT_SEARCH_NODES;

/** How full each unit is, weighted by who owns it, from `seat`'s point of view. */
function linePotential(board: Uint8Array, seat: SeatId): number {
  const mark = markOf(seat);
  let total = 0;
  for (let unit = 0; unit < UNIT_COUNT; unit += 1) {
    let mine = 0;
    let theirs = 0;
    for (const cell of UNIT_CELLS[unit] ?? []) {
      const value = board[cell] ?? EMPTY;
      if (value === EMPTY) continue;
      if (value === mark) mine += 1;
      else theirs += 1;
    }
    total += (mine + theirs) * (mine - theirs);
  }
  return total;
}

/** How many of the sixty-four two-by-two windows are completely empty. */
function openSquares(board: Uint8Array): number {
  let open = 0;
  for (let row = 0; row + 1 < SIZE; row += 1) {
    for (let column = 0; column + 1 < SIZE; column += 1) {
      const cell = row * SIZE + column;
      if (
        (board[cell] ?? EMPTY) === EMPTY &&
        (board[cell + 1] ?? EMPTY) === EMPTY &&
        (board[cell + SIZE] ?? EMPTY) === EMPTY &&
        (board[cell + SIZE + 1] ?? EMPTY) === EMPTY
      ) {
        open += 1;
      }
    }
  }
  return open;
}

/**
 * What `position` is worth to `seat`.
 *
 * Exported because the mirror test in `rules.test.ts` compares evaluations rather than
 * chosen moves: a tie broken by generation order is not covariant under a half-turn, but
 * the evaluation must be, and that is the property worth asserting.
 */
export function evaluate(position: Position, seat: SeatId): number {
  const mine = seat === 'p1' ? position.p1 : position.p2;
  const theirs = seat === 'p1' ? position.p2 : position.p1;
  return (
    SCORE_WEIGHT * (mine - theirs) +
    LINE_WEIGHT * linePotential(position.board, seat) +
    OPEN_WEIGHT * openSquares(position.board)
  );
}

/** Scratch, allocated once: two plies of position, two move buffers, one score buffer. */
const PLY: readonly Position[] = [emptyPosition(), emptyPosition()];
const ROOT_MOVES = new Int16Array(TRAY_SIZE * CELL_COUNT);
const REPLY_MOVES = new Int16Array(TRAY_SIZE * CELL_COUNT);
const ROOT_SCORES = new Float64Array(TRAY_SIZE * CELL_COUNT);
const BEAM = new Int16Array(16);
const TIED = new Int16Array(TRAY_SIZE * CELL_COUNT);

function loadPosition(target: Position, board: Uint8Array, tray: Int8Array): void {
  target.board.set(board);
  target.tray.set(tray);
  target.p1 = 0;
  target.p2 = 0;
}

function copyPosition(target: Position, source: Position): void {
  target.board.set(source.board);
  target.tray.set(source.tray);
  target.p1 = source.p1;
  target.p2 = source.p2;
}

/**
 * The move a bot plays, or -1 when it has nowhere to put anything.
 *
 * The arguments are the whole of what it knows: the board, the shared tray, and which seat
 * it is. **There is no argument carrying the deal**, so no tier can ever be tempted into
 * reading a shape that has not been dealt — CLAUDE.md rule 6 held by the signature rather
 * than by discipline. It does not read the score either, which is information a player does
 * have; SPEC.md records what that costs.
 */
export function chooseMove(
  board: Uint8Array,
  tray: Int8Array,
  seat: SeatId,
  rng: Rng,
  difficulty: BotDifficulty,
): number {
  const count = legalMoves(ROOT_MOVES, board, tray);
  if (count === 0) return -1;

  const tier = TIERS[difficulty];
  // Drawn before anything branches on the position, so a seat's stream advances at the same
  // rate whatever it is facing.
  const fumbled = rng.bool(tier.blunder);
  if (fumbled) return ROOT_MOVES[rng.int(0, count)] ?? -1;

  const opponent = otherOf(seat);
  const root = PLY[0];
  const reply = PLY[1];
  if (root === undefined || reply === undefined) return ROOT_MOVES[0] ?? -1;
  const budget = new SearchBudget(SEARCH_NODES);

  /**
   * Pick uniformly from the moves that tied for best.
   *
   * Not decoration. Taking the first move in generation order means taking the lowest
   * board index, and on a board where most moves evaluate to exactly the same number —
   * which is most of the game, and all of it for `easy` — that is a bot that stacks
   * everything into one corner. It measured as a **six-point advantage to the seat that
   * opens** at `easy`, because the two seats alternate into a deterministic pattern and
   * the parity of who reaches the good squares first decides it. A player with no reason
   * to prefer either square does not always choose the top-left one; nor does this.
   */
  const chooseTied = (tiedCount: number): number => {
    if (tiedCount <= 1) return TIED[0] ?? -1;
    return TIED[rng.int(0, tiedCount)] ?? -1;
  };

  /** One full sweep, or null if the budget ran out part-way and the depth is worthless. */
  const sweep = (depth: number): number | null => {
    let tied = 0;
    let bestScore = -Infinity;
    // The first sweep scores every move; the second reuses those scores rather than
    // recomputing them, which is a third of the whole cost. Each position is charged to the
    // budget once, on the sweep that actually visited it.
    if (depth === 1) {
      for (let i = 0; i < count; i += 1) {
        if (!budget.spend()) return null;
        const move = ROOT_MOVES[i] ?? -1;
        loadPosition(root, board, tray);
        place(root, move, seat, null, null);
        const score = evaluate(root, seat);
        ROOT_SCORES[i] = score;
        if (score > bestScore) {
          bestScore = score;
          tied = 0;
          TIED[tied++] = move;
        } else if (score === bestScore) {
          TIED[tied++] = move;
        }
      }
      return chooseTied(tied);
    }

    // The beam: only the moves that already look best are worth asking what the answer to
    // them is. Selection rather than a sort, because the whole list is never needed.
    const width = Math.min(tier.beam, count, BEAM.length);
    for (let k = 0; k < width; k += 1) {
      let pick = -1;
      let pickScore = -Infinity;
      for (let i = 0; i < count; i += 1) {
        let taken = false;
        for (let j = 0; j < k; j += 1) if (BEAM[j] === i) taken = true;
        if (taken) continue;
        const score = ROOT_SCORES[i] ?? -Infinity;
        if (score > pickScore) {
          pickScore = score;
          pick = i;
        }
      }
      BEAM[k] = pick;
    }

    bestScore = -Infinity;
    tied = 0;
    for (let k = 0; k < width; k += 1) {
      const i = BEAM[k] ?? -1;
      if (i < 0) continue;
      const move = ROOT_MOVES[i] ?? -1;
      loadPosition(root, board, tray);
      place(root, move, seat, null, null);

      let value = ROOT_SCORES[i] ?? -Infinity;
      // A tray emptied by this move is the horizon: the next three shapes have not been
      // dealt and neither player can see them, so the search stops rather than guessing.
      if (traySize(root.tray) > 0) {
        const answers = legalMoves(REPLY_MOVES, root.board, root.tray);
        if (answers > 0) {
          let worst = Infinity;
          for (let j = 0; j < answers; j += 1) {
            if (!budget.spend()) return null;
            copyPosition(reply, root);
            place(reply, REPLY_MOVES[j] ?? -1, opponent, null, null);
            const score = evaluate(reply, seat);
            if (score < worst) worst = score;
          }
          value = worst;
        }
      }
      if (value > bestScore) {
        bestScore = value;
        tied = 0;
        TIED[tied++] = move;
      } else if (value === bestScore) {
        TIED[tied++] = move;
      }
    }
    return chooseTied(tied);
  };

  const found = deepen(budget, tier.beam > 0 ? 2 : 1, sweep);
  return found >= 0 ? found : (ROOT_MOVES[0] ?? -1);
}
