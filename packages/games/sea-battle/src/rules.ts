import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Sea Battle, as pure rules.
 *
 * Each player lays out a fleet on their own ten-by-ten grid, then the two take turns
 * calling shots at the other's water. A shot is a hit or a miss; a ship whose every cell
 * has been hit is sunk. Sink the whole fleet to win.
 *
 * The interesting constraint here is not the rules — they are simple — but that **two
 * people share one screen and one of them must not see the other's fleet**. That is
 * handled by what is drawn rather than by what is stored: see the game module.
 *
 * No rendering, no timing, no DOM.
 */

export const GRID = 10;
export const CELL_COUNT = GRID * GRID;

/** The classic fleet: one of five, one of four, two of three, one of two. */
export const FLEET: readonly number[] = Object.freeze([5, 4, 3, 3, 2]);
export const FLEET_CELLS = FLEET.reduce((sum, length) => sum + length, 0);

export type Orientation = 'across' | 'down';

export interface Ship {
  /** Top-left cell. */
  readonly cell: number;
  readonly length: number;
  readonly orientation: Orientation;
  /** How many of its cells have been hit. */
  hits: number;
}

/** What a shot found. `repeat` means that cell had already been called. */
export type ShotResult = 'miss' | 'hit' | 'sunk' | 'repeat';

export interface Fleet {
  readonly ships: Ship[];
  /** Cells this seat's water has been shot at, by the *other* player. */
  readonly shotAt: boolean[];
  /** Cells occupied by a ship, for O(1) lookup. Index into `ships`, or -1. */
  readonly occupancy: number[];
}

export type Phase = 'placing' | 'firing' | 'over';

export interface Game {
  readonly p1: Fleet;
  readonly p2: Fleet;
  /** Whose turn to fire. Meaningless while placing, when both act at once. */
  seat: SeatId;
  /**
   * Who fires the first shot once both fleets are down. The shell's
   * `context.openingSeat`, never a literal `p1`: the SDK alternates it across the rounds
   * of a best-of so first-mover advantage washes out (#2466), and in a symmetric race
   * that is the whole match. Held on the game because firing starts long after `resetGame`.
   */
  opener: SeatId;
  phase: Phase;
  /** How many ships each seat has placed. Both must reach FLEET.length to start firing. */
  placedP1: number;
  placedP2: number;
}

function createFleet(): Fleet {
  return {
    ships: [],
    shotAt: new Array<boolean>(CELL_COUNT).fill(false),
    occupancy: new Array<number>(CELL_COUNT).fill(-1),
  };
}

export function createGame(): Game {
  return {
    p1: createFleet(),
    p2: createFleet(),
    seat: 'p1',
    opener: 'p1',
    phase: 'placing',
    placedP1: 0,
    placedP2: 0,
  };
}

function resetFleet(fleet: Fleet): void {
  fleet.ships.length = 0;
  fleet.shotAt.fill(false);
  fleet.occupancy.fill(-1);
}

export function resetGame(game: Game, opener: SeatId = 'p1'): void {
  resetFleet(game.p1);
  resetFleet(game.p2);
  game.seat = opener;
  game.opener = opener;
  game.phase = 'placing';
  game.placedP1 = 0;
  game.placedP2 = 0;
}

export function fleetOf(game: Game, seat: SeatId): Fleet {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function columnOf(cell: number): number {
  return cell % GRID;
}

export function rowOf(cell: number): number {
  return Math.floor(cell / GRID);
}

export function cellAt(column: number, row: number): number {
  return row * GRID + column;
}

export function inBounds(column: number, row: number): boolean {
  return column >= 0 && column < GRID && row >= 0 && row < GRID;
}

/** The cells a ship would occupy, appended to `out`. Empty if it would leave the grid. */
export function shipCells(
  out: number[],
  cell: number,
  length: number,
  orientation: Orientation,
): number {
  out.length = 0;
  const column = columnOf(cell);
  const row = rowOf(cell);
  if (orientation === 'across' && column + length > GRID) return 0;
  if (orientation === 'down' && row + length > GRID) return 0;
  for (let i = 0; i < length; i += 1) {
    out.push(orientation === 'across' ? cellAt(column + i, row) : cellAt(column, row + i));
  }
  return out.length;
}

const placeScratch: number[] = [];

/**
 * Whether a ship fits: on the grid, and **not touching another ship, even diagonally**.
 *
 * The no-touching rule is the one that makes the bot's "a sunk ship's neighbours are
 * empty" deduction sound, and it is what the reference genre uses. Without it a sunk ship
 * tells you nothing about the cells around it and hunting becomes much flatter.
 */
export function canPlace(
  fleet: Fleet,
  cell: number,
  length: number,
  orientation: Orientation,
): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return false;
  if (shipCells(placeScratch, cell, length, orientation) === 0) return false;
  for (const occupied of placeScratch) {
    const column = columnOf(occupied);
    const row = rowOf(occupied);
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
        const nc = column + dColumn;
        const nr = row + dRow;
        if (!inBounds(nc, nr)) continue;
        if (fleet.occupancy[cellAt(nc, nr)] !== -1) return false;
      }
    }
  }
  return true;
}

/** Place a ship. Returns false when it does not fit, so a refusal is never silent. */
export function place(
  fleet: Fleet,
  cell: number,
  length: number,
  orientation: Orientation,
): boolean {
  if (!canPlace(fleet, cell, length, orientation)) return false;
  shipCells(placeScratch, cell, length, orientation);
  const index = fleet.ships.length;
  fleet.ships.push({ cell, length, orientation, hits: 0 });
  for (const occupied of placeScratch) fleet.occupancy[occupied] = index;
  return true;
}

/** The length of the next ship this seat has to place, or 0 when the fleet is laid out. */
export function nextShipLength(game: Game, seat: SeatId): number {
  const placed = seat === 'p1' ? game.placedP1 : game.placedP2;
  return FLEET[placed] ?? 0;
}

export function recordPlacement(game: Game, seat: SeatId): void {
  if (seat === 'p1') game.placedP1 += 1;
  else game.placedP2 += 1;
  if (game.placedP1 === FLEET.length && game.placedP2 === FLEET.length) {
    game.phase = 'firing';
    game.seat = game.opener;
  }
}

/** Lay out a whole fleet at random. Used by the bot, and by a player who cannot be bothered. */
export function placeRandomFleet(fleet: Fleet, rng: Rng): void {
  resetFleet(fleet);
  for (const length of FLEET) {
    // Rejection sampling. With this fleet on this grid it succeeds quickly, but the bound
    // keeps a pathological seed from spinning for ever.
    let placed = false;
    for (let attempt = 0; attempt < 2000 && !placed; attempt += 1) {
      const cell = rng.int(0, CELL_COUNT);
      const orientation: Orientation = rng.bool() ? 'across' : 'down';
      placed = place(fleet, cell, length, orientation);
    }
    if (!placed) {
      // Give up on randomness and sweep for the first legal spot, so a fleet is always
      // complete. A short fleet would make the match unwinnable.
      for (let cell = 0; cell < CELL_COUNT && !placed; cell += 1) {
        placed = place(fleet, cell, length, 'across') || place(fleet, cell, length, 'down');
      }
    }
  }
}

export interface Shot {
  readonly result: ShotResult;
  /** The ship sunk by this shot, or null. */
  readonly sunk: Ship | null;
}

const MISS: Shot = Object.freeze({ result: 'miss', sunk: null });
const REPEAT: Shot = Object.freeze({ result: 'repeat', sunk: null });

/** Fire at a cell of `target`'s water. */
export function fire(game: Game, target: SeatId, cell: number): Shot {
  if (game.phase !== 'firing') return REPEAT;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return REPEAT;
  const fleet = fleetOf(game, target);
  if (fleet.shotAt[cell] === true) return REPEAT;
  fleet.shotAt[cell] = true;

  const index = fleet.occupancy[cell] ?? -1;
  if (index < 0) return MISS;
  const ship = fleet.ships[index];
  if (ship === undefined) return MISS;
  ship.hits += 1;
  if (ship.hits >= ship.length) return { result: 'sunk', sunk: ship };
  return { result: 'hit', sunk: null };
}

export function isSunk(ship: Ship): boolean {
  return ship.hits >= ship.length;
}

export function shipsRemaining(fleet: Fleet): number {
  let count = 0;
  for (const ship of fleet.ships) {
    if (!isSunk(ship)) count += 1;
  }
  return count;
}

export function fleetDestroyed(fleet: Fleet): boolean {
  return fleet.ships.length > 0 && shipsRemaining(fleet) === 0;
}

/** The winner, or null while the match is live. There is no draw: someone sinks first. */
export function winnerOf(game: Game): SeatId | null {
  if (fleetDestroyed(game.p2)) return 'p1';
  if (fleetDestroyed(game.p1)) return 'p2';
  return null;
}

/** Cells hit but belonging to ships not yet sunk — what the shell shows as damage. */
export function hitCount(fleet: Fleet): number {
  let count = 0;
  for (const ship of fleet.ships) count += ship.hits;
  return count;
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * How the tiers differ.
 *
 * `hunts` is whether a hit is followed up in the four neighbouring cells rather than
 * forgotten — the single largest difference between a beginner and everyone else.
 * `parity` is whether the search skips cells that cannot hold the smallest ship afloat,
 * which roughly halves the board a hunter has to sweep. `clears` is whether the ring
 * around a sunk ship is written off, which the no-touching placement rule makes sound.
 */
export const BOT_PROFILES: Readonly<
  Record<
    BotDifficulty,
    { readonly hunts: boolean; readonly parity: boolean; readonly clears: boolean }
  >
> = Object.freeze({
  easy: { hunts: false, parity: false, clears: false },
  normal: { hunts: true, parity: false, clears: false },
  hard: { hunts: true, parity: true, clears: true },
});

/** Everything a bot may look at. It sees exactly what a human sees of the enemy water. */
export interface BotMemory {
  /** Cells the bot has decided are not worth shooting, beyond those already shot. */
  readonly ruledOut: boolean[];
  /** Live hits belonging to a ship not yet sunk. */
  readonly openHits: number[];
}

export function createBotMemory(): BotMemory {
  return { ruledOut: new Array<boolean>(CELL_COUNT).fill(false), openHits: [] };
}

export function resetBotMemory(memory: BotMemory): void {
  memory.ruledOut.fill(false);
  memory.openHits.length = 0;
}

function known(fleet: Fleet, memory: BotMemory, cell: number): boolean {
  return fleet.shotAt[cell] === true || memory.ruledOut[cell] === true;
}

/** The smallest ship still afloat, which is the coarsest useful parity stride. */
export function smallestAfloat(fleet: Fleet): number {
  let smallest = Infinity;
  for (const ship of fleet.ships) {
    if (!isSunk(ship) && ship.length < smallest) smallest = ship.length;
  }
  return Number.isFinite(smallest) ? smallest : 2;
}

const candidateScratch: number[] = [];

/**
 * The cell a bot fires at.
 *
 * Every tier sees only which cells have been shot and what those shots found — never the
 * ship positions, per rule 6. `hard` is a competent human, not an oracle: it hunts around
 * damage, sweeps on a parity lattice, and writes off the ring around a sunk ship, all of
 * which a person does with a pencil.
 */
export function botShot(
  fleet: Fleet,
  memory: BotMemory,
  rng: Rng,
  difficulty: BotDifficulty,
): number {
  const profile = BOT_PROFILES[difficulty];

  // Follow up damage first.
  if (profile.hunts && memory.openHits.length > 0) {
    candidateScratch.length = 0;
    for (const hit of memory.openHits) {
      const column = columnOf(hit);
      const row = rowOf(hit);
      const around: readonly (readonly [number, number])[] = [
        [column + 1, row],
        [column - 1, row],
        [column, row + 1],
        [column, row - 1],
      ];
      for (const [nc, nr] of around) {
        if (!inBounds(nc, nr)) continue;
        const cell = cellAt(nc, nr);
        if (known(fleet, memory, cell)) continue;
        candidateScratch.push(cell);
      }
    }
    if (candidateScratch.length > 0) {
      return candidateScratch[rng.int(0, candidateScratch.length)] as number;
    }
  }

  // Otherwise sweep. On hard, only cells on a lattice coarse enough that no ship afloat
  // can slip between them.
  const stride = profile.parity ? smallestAfloat(fleet) : 1;
  candidateScratch.length = 0;
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (known(fleet, memory, cell)) continue;
    if (stride > 1 && (columnOf(cell) + rowOf(cell)) % stride !== 0) continue;
    candidateScratch.push(cell);
  }
  if (candidateScratch.length === 0) {
    // The lattice is exhausted; fall back to anything left.
    for (let cell = 0; cell < CELL_COUNT; cell += 1) {
      if (!known(fleet, memory, cell)) candidateScratch.push(cell);
    }
  }
  if (candidateScratch.length === 0) return -1;
  return candidateScratch[rng.int(0, candidateScratch.length)] as number;
}

/** Tell the bot what its shot found. */
export function rememberShot(
  memory: BotMemory,
  difficulty: BotDifficulty,
  cell: number,
  shot: Shot,
): void {
  const profile = BOT_PROFILES[difficulty];
  if (shot.result === 'hit') {
    memory.openHits.push(cell);
    return;
  }
  if (shot.result !== 'sunk') return;

  // A sunk ship's cells stop being live damage, and — because ships may not touch — every
  // cell around it is water. A player with a pencil crosses those off; so does this.
  const sunkShip = shot.sunk;
  memory.openHits.length = 0;
  if (sunkShip === null || !profile.clears) return;

  const cells: number[] = [];
  shipCells(cells, sunkShip.cell, sunkShip.length, sunkShip.orientation);
  for (const occupied of cells) {
    const column = columnOf(occupied);
    const row = rowOf(occupied);
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
        const nc = column + dColumn;
        const nr = row + dRow;
        if (!inBounds(nc, nr)) continue;
        memory.ruledOut[cellAt(nc, nr)] = true;
      }
    }
  }
}
