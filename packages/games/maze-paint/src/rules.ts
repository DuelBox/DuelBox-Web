import { otherSeat } from '@duelbox/engine';
import type { Rng, SeatId } from '@duelbox/engine';
import { DEFAULT_SEARCH_NODES, SearchBudget, deepen, resolve } from '@duelbox/game-sdk';

/**
 * Maze Paint, as pure rules.
 *
 * No rendering, no timing, no DOM. The game, the bot and the balance harness all drive this
 * module, so what a harness measures is what a player feels.
 *
 * A roller sits on a square maze. A move is one of four **directions**: the roller slides
 * that way and stops at a wall or the edge of the board, painting every unpainted square it
 * crosses. **The other seat's paint stops it too; its own does not.** That one added rule is
 * the whole two-player conversion — it is what lets a player wall the other one in, and it
 * is the only place either player's choices reach the other.
 *
 * A direction that would paint nothing is a move only when nothing else is. So all but a
 * bounded run of turns paints at least one of the hundred and five floor squares, squares
 * never change hands, and the match cannot fail to end — the bound is arithmetic rather than
 * a clock. See {@link legalDirections} and {@link STALL_LIMIT}.
 */

/* ------------------------------------------------------------------ the board */

export const COLUMNS = 11;
export const ROWS = 11;
export const CELL_COUNT = COLUMNS * ROWS;

/**
 * The centre square, which is its own image under the half-turn.
 *
 * Exported because it is the one square a mirroring responder cannot answer — every other
 * square has a distinct image, so a roll that takes the middle puts its owner one ahead in a
 * game that was otherwise going to finish level. It carries no special rule of its own; see
 * {@link settle} for the two that were tried on it and removed.
 */
export const CENTRE_INDEX = ((ROWS - 1) / 2) * COLUMNS + (COLUMNS - 1) / 2;

/** Bottom-left and top-right: each is the other's image under the half-turn. */
export const P1_START = (ROWS - 1) * COLUMNS;
export const P2_START = COLUMNS - 1;

/**
 * How many mirrored *pairs* of blocks the generator tries to place.
 *
 * Swept from nothing to twenty, `normal` against `normal`, 250 seeds a row played from both
 * openings. An empty floor is a spiral both players walk until they collide; a dense one
 * chops the maze into rooms nobody can leave. Eight pairs is where the fill peaks and the
 * opener's share is closest to even:
 *
 * | pairs | squares painted | rolls a match | finish level | opener's share |
 * |---|---|---|---|---|
 * | 0 | 45.7% | 15 | 0.0% | **8.8%** |
 * | 2 | 62.4% | 22 | 17.6% | 46.0% |
 * | 4 | 68.4% | 28 | 22.4% | 49.6% |
 * | 6 | 70.8% | 33 | 20.0% | 50.4% |
 * | **8** | **69.3%** | **35** | **17.2%** | **55.2%** |
 * | 12 | 62.8% | 32 | 24.0% | 54.0% |
 * | 16 | 61.9% | 32 | 29.6% | 47.2% |
 * | 20 | 61.9% | 32 | 29.6% | 47.2% |
 *
 * The first row is the finding, and it ran opposite to expectation: **on an empty floor the
 * second player wins 91% of matches.** With nothing to stop a roll, every roll crosses the
 * whole board, the responder can answer each one with its image, and the mirror never
 * breaks — so the opener's tempo is worth nothing and the level-match rule decides
 * everything. Blocks are what convert tempo into squares. The last two rows are identical
 * because the generator refuses blocks that touch, and sixteen pairs is as many as fit.
 */
export const WALL_PAIRS = 8;

export const FLOOR = 0;
export const WALL = 1;

/** A square nobody has painted. Otherwise a square holds a seat code. */
export const UNPAINTED = -1;
export const P1_PAINT = 0;
export const P2_PAINT = 1;

export const UP = 0;
export const RIGHT = 1;
export const DOWN = 2;
export const LEFT = 3;
export const DIRECTION_COUNT = 4;

const STEP_X: readonly number[] = [0, 1, 0, -1];
const STEP_Y: readonly number[] = [-1, 0, 1, 0];

/** The image of each direction under the half-turn. Up becomes down, left becomes right. */
export const OPPOSITE: readonly number[] = [DOWN, LEFT, UP, RIGHT];

/**
 * The order each seat considers its four directions in — **in that seat's own frame**.
 *
 * This is not decoration. Two seats sit on opposite sides of one board, so a tie-break
 * written in board coordinates is not covariant under the half-turn: ranking directions
 * `up, right, down, left` for both seats means seat two's "first" is seat one's "third",
 * and two mirror-image positions produce two moves that are not mirror images. Snowball
 * Throw shipped exactly that bug in board coordinates and it cost it six points of seat
 * balance. Seat two's order is seat one's order mapped through {@link OPPOSITE}.
 */
const SEAT_ORDER: Readonly<Record<SeatId, readonly number[]>> = Object.freeze({
  p1: Object.freeze([UP, RIGHT, DOWN, LEFT]),
  p2: Object.freeze([DOWN, LEFT, UP, RIGHT]),
});

export function seatCode(seat: SeatId): number {
  return seat === 'p1' ? P1_PAINT : P2_PAINT;
}

export function seatOfCode(code: number): SeatId | null {
  if (code === P1_PAINT) return 'p1';
  if (code === P2_PAINT) return 'p2';
  return null;
}

export function columnOf(index: number): number {
  return index % COLUMNS;
}

export function rowOf(index: number): number {
  return Math.floor(index / COLUMNS);
}

export function indexOf(column: number, row: number): number {
  return row * COLUMNS + column;
}

/** The square a half-turn about the centre of the board sends `index` to. */
export function mirrorIndex(index: number): number {
  return CELL_COUNT - 1 - index;
}

/** The neighbouring square in `dir`, or -1 off the edge of the board. */
export function neighbour(index: number, dir: number): number {
  const column = columnOf(index) + (STEP_X[dir] ?? 0);
  const row = rowOf(index) + (STEP_Y[dir] ?? 0);
  if (column < 0 || column >= COLUMNS || row < 0 || row >= ROWS) return -1;
  return row * COLUMNS + column;
}

/* ------------------------------------------------------------------ the position */

export interface Position {
  /** {@link FLOOR} or {@link WALL}. Fixed for the whole match. */
  readonly terrain: Uint8Array;
  /** {@link UNPAINTED}, or the seat code of whoever painted it. */
  readonly paint: Int8Array;
  /** Where each roller stands, indexed by seat code. */
  readonly roller: Int32Array;
}

export function createPosition(): Position {
  return {
    terrain: new Uint8Array(CELL_COUNT),
    paint: new Int8Array(CELL_COUNT),
    roller: new Int32Array(2),
  };
}

/**
 * Lay out a maze, in place, from a seeded generator.
 *
 * **Every maze is symmetric under the half-turn**, and the two starts are each other's
 * image. That is what makes the game fair between the two chairs rather than fair on
 * average: the same seed played from both openings is one match and its mirror image, so a
 * seat advantage could only come from a rule that is not covariant. Any that crept in shows
 * up immediately as a seat-one share away from 50 percent.
 *
 * Walls go in as mirrored pairs, one pair at a time, and a pair that would cut the floor in
 * two is taken back out. A disconnected pocket is not a fatal position — it is simply
 * squares neither player can ever reach — but it makes the board a worse puzzle and it can
 * hand one seat a private room, so the generator refuses them.
 */
export function generateMaze(position: Position, rng: Rng, wallPairs: number = WALL_PAIRS): void {
  const { terrain, paint, roller } = position;
  terrain.fill(FLOOR);
  paint.fill(UNPAINTED);
  roller[P1_PAINT] = P1_START;
  roller[P2_PAINT] = P2_START;
  // A roller begins standing on its own paint, so neither can ever roll back over its start.
  paint[P1_START] = P1_PAINT;
  paint[P2_START] = P2_PAINT;

  const candidates: number[] = [];
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const twin = mirrorIndex(index);
    // One of each mirrored pair. `index === twin` is the centre square, which never walls.
    if (index >= twin) continue;
    if (index === P1_START || index === P2_START) continue;
    if (twin === P1_START || twin === P2_START) continue;
    candidates.push(index);
  }
  rng.shuffle(candidates);

  const seen = new Uint8Array(CELL_COUNT);
  const stack = new Int32Array(CELL_COUNT);
  let placed = 0;
  for (const index of candidates) {
    if (placed >= wallPairs) break;
    const twin = mirrorIndex(index);
    if (touchesWall(terrain, index) || touchesWall(terrain, twin)) continue;
    terrain[index] = WALL;
    terrain[twin] = WALL;
    if (floorIsConnected(terrain, seen, stack)) {
      placed += 1;
    } else {
      terrain[index] = FLOOR;
      terrain[twin] = FLOOR;
    }
  }
}

/**
 * Whether a square touches an existing block, corners included.
 *
 * **No two blocks ever touch**, and that constraint is doing more work than it looks. Walls
 * that join up make corridors, corridors make dead ends, and a roller that rolls into a dead
 * end is stranded: nothing it can reach in a straight line is unpainted any more, so it is
 * out of the match with most of the maze still bare. Measured on the first version, which
 * placed walls freely, two `normal` bots finished after thirteen rolls with sixty-six of the
 * ninety-one squares that version left never painted at all.
 *
 * Scattered single blocks are also what the reference genre actually looks like: an open
 * floor with things to carom off, where the interesting question is which wall you choose to
 * stop against. A field of isolated blocks cannot disconnect a grid either, so the
 * connectivity check above never fires — it is kept as insurance rather than as a filter.
 */
function touchesWall(terrain: Uint8Array, index: number): boolean {
  const column = columnOf(index);
  const row = rowOf(index);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const c = column + dx;
      const r = row + dy;
      if (c < 0 || c >= COLUMNS || r < 0 || r >= ROWS) continue;
      if ((terrain[r * COLUMNS + c] ?? FLOOR) === WALL) return true;
    }
  }
  return false;
}

function floorIsConnected(terrain: Uint8Array, seen: Uint8Array, stack: Int32Array): boolean {
  let floor = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((terrain[index] ?? WALL) === FLOOR) floor += 1;
  }
  seen.fill(0);
  seen[P1_START] = 1;
  stack[0] = P1_START;
  let top = 1;
  let reached = 0;
  while (top > 0) {
    top -= 1;
    const cell = stack[top] ?? 0;
    reached += 1;
    for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
      const next = neighbour(cell, dir);
      if (next < 0) continue;
      if ((terrain[next] ?? WALL) !== FLOOR) continue;
      if ((seen[next] ?? 1) !== 0) continue;
      seen[next] = 1;
      stack[top] = next;
      top += 1;
    }
  }
  return reached === floor;
}

/* ------------------------------------------------------------------ moves */

/** Whether `seat`'s roller may pass through a square: floor, and not the other seat's paint. */
function passable(position: Position, seat: SeatId, cell: number): boolean {
  if ((position.terrain[cell] ?? WALL) !== FLOOR) return false;
  const owner = position.paint[cell] ?? UNPAINTED;
  return owner === UNPAINTED || owner === seatCode(seat);
}

/**
 * How far the roller travels rolling `dir` — over its own paint, never over the other
 * seat's, and never through a wall or off the board.
 *
 * The bot uses this function and nothing else to work out where a roll ends, so the move it
 * believes it is playing and the move the simulation plays are the same computation rather
 * than two that agree today (issue #2465).
 */
export function travelLength(position: Position, seat: SeatId, dir: number): number {
  let cell = position.roller[seatCode(seat)] ?? 0;
  let travel = 0;
  for (;;) {
    const next = neighbour(cell, dir);
    if (next < 0) return travel;
    if (!passable(position, seat, next)) return travel;
    cell = next;
    travel += 1;
  }
}

/**
 * How many **unpainted** squares that roll would take. Zero means the direction is not a
 * move at all: rolling up and down your own corridor without painting anything would be a
 * turn that changes nothing, and a game made of those could not end.
 */
export function paintGain(position: Position, seat: SeatId, dir: number): number {
  let cell = position.roller[seatCode(seat)] ?? 0;
  let gain = 0;
  for (;;) {
    const next = neighbour(cell, dir);
    if (next < 0) return gain;
    if (!passable(position, seat, next)) return gain;
    if ((position.paint[next] ?? P1_PAINT) === UNPAINTED) gain += 1;
    cell = next;
  }
}

/**
 * Roll, painting everything unpainted along the way.
 *
 * Returns how many squares were painted, which is **0 for a forced shift** and **-1 for a
 * direction that is not a move at all**. The two are deliberately different numbers: a shift
 * spends a turn and moves the roller, and a refusal does neither.
 */
export function applyMove(position: Position, seat: SeatId, dir: number): number {
  if (!isLegalDirection(position, seat, dir)) return -1;
  const code = seatCode(seat);
  const { paint, roller } = position;
  let cell = roller[code] ?? 0;
  let gain = 0;
  for (;;) {
    const next = neighbour(cell, dir);
    if (next < 0) break;
    if (!passable(position, seat, next)) break;
    if ((paint[next] ?? P1_PAINT) === UNPAINTED) {
      paint[next] = code;
      gain += 1;
    }
    cell = next;
  }
  roller[code] = cell;
  return gain;
}

/** Whether `seat` has any roll that would paint something. */
export function hasPaintingMove(position: Position, seat: SeatId): boolean {
  for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
    if (paintGain(position, seat, dir) > 0) return true;
  }
  return false;
}

/**
 * Whether `seat` can move at all, painting or not.
 *
 * This is the one that can never come back once it is false: travel is stopped only by
 * walls, by the edge and by the other seat's paint, and the other seat's paint only ever
 * grows. So a roller that cannot move now will never move again, which is what lets a seat
 * with nothing to do be skipped rather than made to sit through turns.
 */
export function canRoll(position: Position, seat: SeatId): boolean {
  for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
    if (travelLength(position, seat, dir) > 0) return true;
  }
  return false;
}

/**
 * Every direction `seat` may roll, in that seat's own frame order.
 *
 * **You must paint if you can.** A roll that paints nothing — back down a corridor you have
 * already claimed — is a move only when no roll paints anything, and then it is the only
 * kind of move there is. That single sentence does two jobs. It is what stops a player
 * being written out of the match by their own trail: a roller that has boxed itself in can
 * always shift somewhere else and carry on, and the board fills instead of the match ending
 * with half of it bare. And because a shift is *forced* rather than chosen, a turn that
 * paints nothing only ever happens to a player who had no alternative, which is what keeps
 * {@link STALL_LIMIT} a backstop rather than a clock anybody plays against.
 *
 * Written into a caller-supplied array and returning the count, because this runs at every
 * node of the bot's search and returning a fresh array there would allocate per node.
 */
export function legalDirections(out: Int32Array, position: Position, seat: SeatId): number {
  const order = SEAT_ORDER[seat];
  let count = 0;
  for (let i = 0; i < DIRECTION_COUNT; i += 1) {
    const dir = order[i] ?? UP;
    if (paintGain(position, seat, dir) > 0) {
      out[count] = dir;
      count += 1;
    }
  }
  if (count > 0) return count;
  for (let i = 0; i < DIRECTION_COUNT; i += 1) {
    const dir = order[i] ?? UP;
    if (travelLength(position, seat, dir) > 0) {
      out[count] = dir;
      count += 1;
    }
  }
  return count;
}

/** Whether `dir` is a move for `seat` right now. */
export function isLegalDirection(position: Position, seat: SeatId, dir: number): boolean {
  if (!Number.isInteger(dir) || dir < 0 || dir >= DIRECTION_COUNT) return false;
  if (travelLength(position, seat, dir) === 0) return false;
  if (paintGain(position, seat, dir) > 0) return true;
  return !hasPaintingMove(position, seat);
}

/**
 * The direction whose run contains `cell`, or -1.
 *
 * This is what a tap means. The four runs leave the roller along different axes, so they
 * are disjoint and a square can name at most one of them — which is why a press needs no
 * tie-break and never has to guess. A press that lands anywhere else does nothing at all,
 * exactly as `docs/input-idiom.md` requires of `turn-board`.
 */
export function directionContaining(position: Position, seat: SeatId, cell: number): number {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return -1;
  const from = position.roller[seatCode(seat)] ?? 0;
  for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
    // Only lanes that are really moves are drawn, so only those may be pressed — and when a
    // seat has nothing left to paint, its forced shifts are the lanes.
    if (!isLegalDirection(position, seat, dir)) continue;
    const travel = travelLength(position, seat, dir);
    let walk = from;
    for (let i = 0; i < travel; i += 1) {
      walk = neighbour(walk, dir);
      if (walk < 0) break;
      if (walk === cell) return dir;
    }
  }
  return -1;
}

/* ------------------------------------------------------------------ the score */

export function paintCount(position: Position, seat: SeatId): number {
  const code = seatCode(seat);
  const { paint } = position;
  let count = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((paint[index] ?? UNPAINTED) === code) count += 1;
  }
  return count;
}

export function ownerOf(position: Position, cell: number): SeatId | null {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return null;
  return seatOfCode(position.paint[cell] ?? UNPAINTED);
}

/** Neither roller can move: the position itself is finished, whatever the stall count says. */
export function isOver(position: Position): boolean {
  return !canRoll(position, 'p1') && !canRoll(position, 'p2');
}

/**
 * More squares wins; **level on squares, the seat that moved second wins.**
 *
 * The comparison itself comes from the SDK rather than being written again here, so
 * "highest wins" means in this game exactly what it means in every other one. The fallback
 * is ours, and it is the single most load-bearing rule in the package.
 *
 * A maze symmetric under the half-turn hands the responder a mirroring strategy: answer
 * every roll with its image and finish exactly level. **No tie-break written in board
 * coordinates can ever settle the result of one**, because a covariant rule applied to a
 * mirror-image position gives a mirror-image answer. So the only rule that can break a
 * mirrored finish is one that is not a function of the board at all — which is what the
 * second mover is. Measured over 1 000 matches a tier at the shipped tuning, **13.6% of
 * `easy`, 18.4% of `normal` and 31.4% of `hard` matches finish exactly level**; before this
 * rule they were draws, which is the defect `paint-fight` is recorded with in
 * `balance-aggregate.test.ts`.
 *
 * It is also the right compensation on its own terms. The opener paints first and it is
 * worth a measured 2.9 to 3.8 squares out of about 37, so requiring it to be *ahead* rather
 * than merely level is half a square handed back — and half a square turns out to be close
 * to the right price. Opener's share of decided matches, easy / normal / hard:
 *
 * | | easy | normal | hard |
 * |---|---|---|---|
 * | level counts as a draw | 56.5% | 62.0% | 69.4% |
 * | **level goes to the second mover** | **48.8%** | **50.6%** | **47.6%** |
 */
export function outcomeOf(position: Position, opener: SeatId): SeatId {
  return settle(paintCount(position, 'p1'), paintCount(position, 'p2'), opener);
}

/** The outcome of a *finished* position, or null while either roller can still move. */
export function winnerOf(position: Position, opener: SeatId): SeatId | null {
  return isOver(position) ? outcomeOf(position, opener) : null;
}

/**
 * The scoring rule on its own, so a test can drive it without building a finished board.
 *
 * **A third rule was written here, measured and deleted.** A level match used to go to
 * whoever held the centre square before it fell through to the second mover, on the
 * reasoning that the centre is the one square the half-turn leaves where it is and so the
 * one square neither chair is nearer to. **It almost never fires**, and the reason is worth
 * writing down: painting the centre is itself a square, so a match in which somebody took it
 * is usually a match that is no longer level. Over 1 000 matches a tier the centre finishes
 * painted 54 to 56% of the time — but among the matches that finish *level* it is painted in
 * 14.7% (easy), 3.3% (normal) and 7.0% (hard) of them, so the rule could decide at most 2.2%
 * of matches and did so 1.3 to 2.7 points in the opener's favour, because the opener reaches
 * the middle first. It was a first-mover bonus wearing a tie-break's clothes, which is what
 * Sudoku warns against, so it went.
 *
 * A second rule went with it: the generator used to keep the middle three-by-three clear of
 * blocks so the centre could always be reached. Measured at the shipped tuning over 800
 * matches a tier it moved the level rate by less than its own noise and cost 2 points of
 * fill, so it went too. The centre still breaks a mirrored game — as an ordinary square,
 * which is the honest version of the same idea, since it is the only square whose image
 * under the half-turn is itself.
 */
export function settle(p1: number, p2: number, opener: SeatId): SeatId {
  const outcome = resolve({ kind: 'highest-when-time-expires' }, { p1, p2 }, { timeExpired: true });
  if (outcome !== null && outcome !== 'draw') return outcome;
  return otherSeat(opener);
}

/* ------------------------------------------------------------------ the bot */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * What a tier is, in two numbers.
 *
 * `depth` is how far ahead it looks and `blunder` how often it rolls a legal direction at
 * random instead of the one it found. Both are honest: neither is information, speed or
 * physics a person cannot have.
 *
 * **A third was written, swept and deleted.** `readsSpace` turned off the part of the
 * evaluation that counts ground nobody has painted yet, so a tier without it took the
 * longest run available and nothing else. Swept alone against an untouched `normal` over
 * 500 matches it is worth 10.8 points at depth 1, 6.8 at depth 3 and 2.6 at depth 6 — a real
 * knob, shrinking as the search rediscovers by looking ahead what the term was telling it.
 * But at the only place it shipped, `easy`, it is worth **2.1 points against `normal` and
 * 1.9 against `hard` over 1 000 matches**, because a tier that plays at random 55% of the
 * time cannot use a better evaluation. It read in the source as a kind of judgement and was
 * in practice a second, weaker spelling of the blunder rate, so it went.
 *
 * A profile is a value rather than a constant so that the sweeps recorded in SPEC.md run
 * through the real match loop rather than through a copy of it — every number in that
 * document was measured by handing this object to {@link startMatch}.
 */
export interface BotProfile {
  readonly depth: number;
  readonly blunder: number;
}

export const PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ depth: 1, blunder: 0.55 }),
  normal: Object.freeze({ depth: 3, blunder: 0.15 }),
  hard: Object.freeze({ depth: 7, blunder: 0 }),
});

/** A painted square, in eval points. The unit everything else is measured against. */
const CELL_VALUE = 10;
/** A square nobody has painted yet but this seat would reach first. */
const SPACE_VALUE = 6;
/**
 * The half-square the second mover is spotted, in eval points.
 *
 * The win condition gives a level match to the seat that moved second, so "level" is a loss
 * for the opener and a win for the responder, and an evaluation that scored it zero for both
 * would have the opener content to draw a game it was actually losing. Half a square is
 * exactly what the rule is worth, and expressing it as a constant offset rather than as a
 * special case at zero keeps the function smooth.
 */
const KOMI = CELL_VALUE / 2;
/** A finished position, scored decisively so no heuristic can outweigh a won board. */
const WIN_VALUE = 1000;

const MAX_PLY = 8;
/**
 * Scratch for the search, one whole position per ply.
 *
 * Module-level and shared, as Reversi's is: `chooseDirection` is synchronous, never yields,
 * and never re-enters, so two matches cannot be inside it at once. Nothing here is
 * allocated per node, which is what rule 5 asks for.
 */
const plies: Position[] = Array.from({ length: MAX_PLY }, () => createPosition());
const spare = createPosition();
const searchMoves: Int32Array[] = Array.from(
  { length: MAX_PLY },
  () => new Int32Array(DIRECTION_COUNT),
);
const rootMoves = new Int32Array(DIRECTION_COUNT);
const distanceP1 = new Int32Array(CELL_COUNT);
const distanceP2 = new Int32Array(CELL_COUNT);
const walkQueue = new Int32Array(CELL_COUNT);

function plyAt(index: number): Position {
  return plies[index] ?? spare;
}

function copyPosition(target: Position, source: Position): void {
  target.paint.set(source.paint);
  target.roller[P1_PAINT] = source.roller[P1_PAINT] ?? 0;
  target.roller[P2_PAINT] = source.roller[P2_PAINT] ?? 0;
}

/**
 * How far every unpainted square is from a roller, over unpainted floor.
 *
 * A plain breadth-first walk, so the answer is a distance rather than an artefact of the
 * order squares came off the queue — which is what makes it covariant under the half-turn,
 * and therefore what stops the two seats valuing mirror-image boards differently.
 */
function distancesFrom(
  terrain: Uint8Array,
  paint: Int8Array,
  start: number,
  blocker: number,
  out: Int32Array,
): void {
  out.fill(-1);
  out[start] = 0;
  walkQueue[0] = start;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const cell = walkQueue[head] ?? 0;
    head += 1;
    const step = (out[cell] ?? 0) + 1;
    for (let dir = 0; dir < DIRECTION_COUNT; dir += 1) {
      const next = neighbour(cell, dir);
      if (next < 0) continue;
      if ((terrain[next] ?? WALL) !== FLOOR) continue;
      // Own paint is a road and the other seat's is a wall, exactly as it is for a roll.
      if ((paint[next] ?? blocker) === blocker) continue;
      if ((out[next] ?? -1) >= 0) continue;
      out[next] = step;
      walkQueue[tail] = next;
      tail += 1;
    }
  }
}

/**
 * Unpainted squares this seat would reach first, minus the ones the other seat would.
 *
 * Nothing here is information a player cannot get: it is "which parts of the maze am I
 * nearer to", read off the board in front of both of them. A square both rollers reach in
 * the same number of steps counts for neither, which keeps the measure symmetric.
 */
function spaceAdvantage(
  terrain: Uint8Array,
  paint: Int8Array,
  roller: Int32Array,
  code: number,
): number {
  distancesFrom(terrain, paint, roller[P1_PAINT] ?? 0, P2_PAINT, distanceP1);
  distancesFrom(terrain, paint, roller[P2_PAINT] ?? 0, P1_PAINT, distanceP2);
  let one = 0;
  let two = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((paint[index] ?? P1_PAINT) !== UNPAINTED) continue;
    const first = distanceP1[index] ?? -1;
    const second = distanceP2[index] ?? -1;
    if (first >= 0 && second < 0) one += 1;
    else if (second >= 0 && first < 0) two += 1;
    else if (first >= 0 && second >= 0) {
      if (first < second) one += 1;
      else if (second < first) two += 1;
    }
  }
  return code === P1_PAINT ? one - two : two - one;
}

function tallyInto(paint: Int8Array, code: number): number {
  let mine = 0;
  let theirs = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const owner = paint[index] ?? UNPAINTED;
    if (owner === code) mine += 1;
    else if (owner !== UNPAINTED) theirs += 1;
  }
  return mine - theirs;
}

function evaluate(
  terrain: Uint8Array,
  paint: Int8Array,
  roller: Int32Array,
  code: number,
  openerCode: number,
): number {
  const komi = code === openerCode ? -KOMI : KOMI;
  return (
    tallyInto(paint, code) * CELL_VALUE +
    komi +
    spaceAdvantage(terrain, paint, roller, code) * SPACE_VALUE
  );
}

/**
 * A finished board, scored so that no heuristic term can reach across it.
 *
 * It settles the position by the **match's own win condition** rather than by the square
 * count alone. A search that stopped at the count would happily walk into a level finish,
 * which the opener loses.
 */
function terminalScore(paint: Int8Array, code: number, openerCode: number): number {
  const diff = tallyInto(paint, code);
  if (diff !== 0) return diff * WIN_VALUE;
  return code === openerCode ? -WIN_VALUE : WIN_VALUE;
}

/**
 * Negamax with an alpha-beta window, scored from `toMove`'s point of view.
 *
 * A seat with nothing to play hands the turn over at the same depth, exactly as a pass does
 * in Reversi. It cannot loop: a stuck roller stays stuck, so the seat receiving the turn
 * either has a move — which spends a ply — or the position is finished.
 */
function search(
  toMove: SeatId,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  budget: SearchBudget,
  openerCode: number,
): number {
  const node = plyAt(ply);
  const code = seatCode(toMove);

  // Charged before the leaf check, so the leaves — which are most of the work and all of
  // the evaluation — are paid for rather than free.
  if (!budget.spend() || depth <= 0) {
    return evaluate(node.terrain, node.paint, node.roller, code, openerCode);
  }

  const buffer = searchMoves[ply] ?? rootMoves;
  const count = legalDirections(buffer, node, toMove);

  if (count === 0) {
    if (!canRoll(node, otherSeat(toMove))) return terminalScore(node.paint, code, openerCode);
    return -search(otherSeat(toMove), depth, ply, -beta, -alpha, budget, openerCode);
  }

  const child = plyAt(ply + 1);
  let best = -Infinity;
  let window = alpha;
  for (let i = 0; i < count; i += 1) {
    copyPosition(child, node);
    applyMove(child, toMove, buffer[i] ?? UP);
    const score = -search(
      otherSeat(toMove),
      depth - 1,
      ply + 1,
      -beta,
      -window,
      budget,
      openerCode,
    );
    if (score > best) best = score;
    if (best > window) window = best;
    if (window >= beta) break;
  }
  return best;
}

/**
 * The direction a bot rolls, or -1 when it has none.
 *
 * Every tier sees exactly the board a person sees — CLAUDE.md rule 6. Difficulty is search
 * depth and blunder rate, never a fact about the position that is hidden from the other
 * chair.
 *
 * **Two draws, unconditionally, before anything branches.** A generator that spends a
 * different number of values depending on what it found makes a seat's play a function of
 * its opponent's, which is the coupling Cup Pong measured and documented.
 */
export function chooseDirection(
  position: Position,
  seat: SeatId,
  rng: Rng,
  difficulty: BotDifficulty,
  opener: SeatId,
  profile: BotProfile = PROFILES[difficulty],
): number {
  const count = legalDirections(rootMoves, position, seat);
  const roll = rng.float();
  const pick = rng.float();
  if (count === 0) return -1;

  if (roll < profile.blunder) {
    return rootMoves[Math.min(count - 1, Math.floor(pick * count))] ?? -1;
  }

  // The maze never changes during a match, so it is stamped into the scratch once a turn
  // rather than copied at every node.
  for (const ply of plies) ply.terrain.set(position.terrain);
  const openerCode = seatCode(opener);
  const budget = new SearchBudget(DEFAULT_SEARCH_NODES);

  /** One full sweep at a fixed depth, or null when the budget ran out part-way. */
  const sweep = (depth: number): number | null => {
    let best = rootMoves[0] ?? -1;
    let bestScore = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const move = rootMoves[i] ?? UP;
      const root = plyAt(1);
      copyPosition(root, position);
      applyMove(root, seat, move);
      const score = -search(otherSeat(seat), depth - 1, 1, -Infinity, Infinity, budget, openerCode);
      if (budget.exhausted) return null;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  };

  const found = deepen(budget, profile.depth, sweep);
  return found >= 0 ? found : (rootMoves[0] ?? -1);
}

/* ------------------------------------------------------------------ the match */

export type Phase = 'ready' | 'live' | 'settle' | 'over';

/**
 * Every turn opens frozen, in the **simulation**, not in the shell.
 *
 * The board turns to face whoever is to move and takes 0.36 s doing it, and a press landing
 * mid-turn names a square that is moving. The obvious place to stop that is
 * `SeatFlip.acceptsInput` — and it is the wrong place, because `seatView` reports no
 * rotation at all in single-seat play, so a freeze keyed off the flip would step one match
 * on a shared phone and a different one on two phones playing remotely. Half a second is
 * comfortably longer than the flip, so this closes the same window and closes it identically
 * in both presentations. Cup Pong and Sudoku both document the same trap.
 */
export const READY_SECONDS = 0.5;
/** What a bot spends looking at the board, after the freeze every seat gets. */
export const THINK_SECONDS = 0.3;
/** Long enough to see the last roll land before the result is declared. */
export const SETTLE_SECONDS = 0.9;

/**
 * How many turns in a row may paint nothing before the match is called.
 *
 * The backstop, and it is deliberately not a clock. A forced shift happens only to a player
 * who cannot paint, so a run of them means both rollers are shuffling around ground they
 * already own with nothing left to take. Three in a row is the point at which that has
 * stopped being a manoeuvre and started being a stalemate.
 *
 * It is also what bounds the match from above: every other turn paints at least one of
 * one hundred and five squares, so no match can run past 105 x STALL_LIMIT turns whatever
 * either player does. Measured, matches take 34 of them and 29 simulated seconds; the longest
 * of 6 000 was 75 seconds, against the ten-minute budget the catalogue-wide guard allows.
 *
 * Swept at eight wall pairs, `normal` against `normal`, 250 seeds a row. It buys fill and
 * pays for it in match length, and it runs out of fill long before it runs out of length:
 *
 * | limit | squares painted | rolls | simulated seconds |
 * |---|---|---|---|
 * | 1 | 51.5% | 16 | 14.0 |
 * | 3 | 64.4% | 26 | 22.4 |
 * | **6** | **69.3%** | **35** | **29.2** |
 * | 12 | 72.0% | 46 | 38.1 |
 * | 40 | 73.7% | 82 | 67.7 |
 *
 * Six is the knee. Past it the board is not going to fill however long anybody is given —
 * some squares simply cannot be reached in a straight line from anywhere a roller can stand
 * — and the match is still under half a minute.
 */
export const STALL_LIMIT = 6;

/**
 * The two numbers a test or a sweep may vary.
 *
 * They are parameters rather than constants because both were chosen by measurement and the
 * measurement has to be repeatable: `SPEC.md` records what each of them does to fill, to
 * match length and to the draw rate across its whole useful range.
 */
export interface Tuning {
  readonly wallPairs?: number;
  readonly stallLimit?: number;
  /** Overrides for one or more tiers, so a sweep can vary a single knob in place. */
  readonly profiles?: Partial<Record<BotDifficulty, BotProfile>>;
}

export interface Match {
  readonly position: Position;
  /** The seat that opened, which is what settles a match level on squares. */
  opener: SeatId;
  stallLimit: number;
  profiles: Partial<Record<BotDifficulty, BotProfile>> | null;
  active: SeatId;
  phase: Phase;
  phaseSteps: number;
  thinkSteps: number;
  /** Turns in a row that have painted nothing. Reset by any turn that paints. */
  stalls: number;
  /** Discovered from the first fixed delta, so a turn is a whole number of steps. */
  stepsPerSecond: number;
  /** No `'draw'`: {@link settle} always names a seat, so a finished match always has one. */
  winner: SeatId | null;
  moves: number;
  /** The roll just played, for the trail the renderer draws. */
  lastSeat: SeatId | null;
  lastFrom: number;
  lastDir: number;
  lastRun: number;
}

export function createMatch(): Match {
  return {
    position: createPosition(),
    opener: 'p1',
    stallLimit: STALL_LIMIT,
    profiles: null,
    active: 'p1',
    phase: 'ready',
    phaseSteps: 0,
    thinkSteps: 0,
    stalls: 0,
    stepsPerSecond: 0,
    winner: null,
    moves: 0,
    lastSeat: null,
    lastFrom: -1,
    lastDir: -1,
    lastRun: 0,
  };
}

/**
 * Deal a fresh maze and hand the first turn to `openingSeat`.
 *
 * The opening seat is read rather than assumed: the SDK alternates it across the rounds of
 * a best-of so first-mover advantage washes out, and a game that always opened with `p1`
 * would leave that promise unkept.
 */
export function startMatch(match: Match, rng: Rng, openingSeat: SeatId, tuning?: Tuning): void {
  generateMaze(match.position, rng, tuning?.wallPairs ?? WALL_PAIRS);
  match.opener = openingSeat;
  match.stallLimit = tuning?.stallLimit ?? STALL_LIMIT;
  match.profiles = tuning?.profiles ?? null;
  match.active = openingSeat;
  match.phase = 'ready';
  match.phaseSteps = 0;
  match.thinkSteps = 0;
  match.stalls = 0;
  match.stepsPerSecond = 0;
  match.winner = null;
  match.moves = 0;
  match.lastSeat = null;
  match.lastFrom = -1;
  match.lastDir = -1;
  match.lastRun = 0;
}

export function stepsFor(match: Match, seconds: number): number {
  const steps = Math.round(seconds * match.stepsPerSecond);
  return steps < 1 ? 1 : steps;
}

function beginTurn(match: Match): void {
  match.phase = 'ready';
  match.phaseSteps = stepsFor(match, READY_SECONDS);
  match.thinkSteps = stepsFor(match, THINK_SECONDS);
}

/**
 * Hand the turn on.
 *
 * A seat with nothing left to play is skipped rather than made to sit through a turn it
 * cannot use — and because a stuck roller stays stuck, skipping it is not a guess about the
 * future. When neither can move the match is finished.
 */
function handOver(match: Match): void {
  if (match.stalls >= match.stallLimit) {
    finish(match);
    return;
  }
  const other = otherSeat(match.active);
  if (canRoll(match.position, other)) {
    match.active = other;
    beginTurn(match);
    return;
  }
  if (canRoll(match.position, match.active)) {
    beginTurn(match);
    return;
  }
  finish(match);
}

function finish(match: Match): void {
  match.phase = 'settle';
  match.phaseSteps = stepsFor(match, SETTLE_SECONDS);
}

/**
 * One fixed step of the whole simulation.
 *
 * `request` is the direction the seat at the controls has asked for, or -1; it is ignored
 * unless a human holds the active seat and the turn is live. `difficulty` and `rng` belong
 * to the active seat.
 */
export function stepMatch(
  match: Match,
  fixedDeltaSeconds: number,
  request: number,
  difficulty: BotDifficulty | null,
  rng: Rng,
): void {
  if (match.phase === 'over') return;

  if (match.stepsPerSecond === 0) {
    if (!(fixedDeltaSeconds > 0)) return;
    match.stepsPerSecond = Math.max(1, Math.round(1 / fixedDeltaSeconds));
    // Sized only now that the step rate is known, and the opener is checked here rather
    // than in startMatch so a maze that somehow walled a roller in still opens correctly.
    handOverToOpener(match);
  }

  switch (match.phase) {
    case 'ready':
      match.phaseSteps -= 1;
      if (match.phaseSteps <= 0) match.phase = 'live';
      return;

    case 'live': {
      let dir = -1;
      if (difficulty !== null) {
        if (match.thinkSteps > 0) {
          match.thinkSteps -= 1;
          return;
        }
        dir = chooseDirection(
          match.position,
          match.active,
          rng,
          difficulty,
          match.opener,
          match.profiles?.[difficulty] ?? PROFILES[difficulty],
        );
      } else {
        dir = request;
      }
      if (dir < 0) return;
      const from = match.position.roller[seatCode(match.active)] ?? 0;
      const run = applyMove(match.position, match.active, dir);
      // A direction that paints nothing is refused and costs no turn, exactly as an
      // illegal square costs no turn in Reversi.
      if (run < 0) return;
      match.lastSeat = match.active;
      match.lastFrom = from;
      match.lastDir = dir;
      match.lastRun = run;
      match.moves += 1;
      match.stalls = run > 0 ? 0 : match.stalls + 1;
      handOver(match);
      return;
    }

    case 'settle':
      match.phaseSteps -= 1;
      if (match.phaseSteps <= 0) {
        match.phase = 'over';
        match.winner = outcomeOf(match.position, match.opener);
      }
      return;
  }
}

function handOverToOpener(match: Match): void {
  if (canRoll(match.position, match.active)) {
    beginTurn(match);
    return;
  }
  if (canRoll(match.position, otherSeat(match.active))) {
    match.active = otherSeat(match.active);
    beginTurn(match);
    return;
  }
  finish(match);
}

/* ------------------------------------------------------------------ mirroring */

/**
 * The same maze seen from the other chair: every square sent to its image under the
 * half-turn and the two seats exchanged.
 *
 * Only the tests use it, and they use it a great deal. Mirror symmetry is the one property
 * a win-rate ladder cannot see: a rule written in board coordinates rather than in the
 * mover's own frame produces a game that is a few points kinder to one chair and looks
 * perfectly correct in every other test.
 */
export function mirrorPosition(position: Position): Position {
  const out = createPosition();
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const twin = mirrorIndex(index);
    out.terrain[twin] = position.terrain[index] ?? WALL;
    const owner = position.paint[index] ?? UNPAINTED;
    out.paint[twin] = owner === UNPAINTED ? UNPAINTED : owner === P1_PAINT ? P2_PAINT : P1_PAINT;
  }
  out.roller[P1_PAINT] = mirrorIndex(position.roller[P2_PAINT] ?? 0);
  out.roller[P2_PAINT] = mirrorIndex(position.roller[P1_PAINT] ?? 0);
  return out;
}

/** Two positions that should be images of one another, compared square by square. */
export function positionsMatch(a: Position, b: Position): boolean {
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if ((a.terrain[index] ?? WALL) !== (b.terrain[index] ?? WALL)) return false;
    if ((a.paint[index] ?? UNPAINTED) !== (b.paint[index] ?? UNPAINTED)) return false;
  }
  return (
    (a.roller[P1_PAINT] ?? -1) === (b.roller[P1_PAINT] ?? -2) &&
    (a.roller[P2_PAINT] ?? -1) === (b.roller[P2_PAINT] ?? -2)
  );
}
