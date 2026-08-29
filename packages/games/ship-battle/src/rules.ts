import { resolve } from '@duelbox/game-sdk';
import type { Outcome, WinCondition } from '@duelbox/game-sdk';
import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Ship Battle, as pure rules.
 *
 * Two ships trade broadsides. On your turn you train the cannon on one section of the
 * enemy hull and fire; the shell takes a moment to cross, and while it is in the air the
 * board turns to the other player, who slides an armour plate along their own hull to
 * meet it. A shot that gets through breaches a section. Breach every section and she sinks.
 *
 * The interesting constraint is not the rules but that **only one seat may be acting at a
 * time** — the device has one pointer surface and it belongs to whoever is to move. So the
 * gunner and the defender are given the *same turn in two halves*: aim, then intercept.
 * Nobody is hidden from anybody, and the contest is reach rather than guesswork.
 *
 * No rendering, no timing, no DOM: the game module and the balance harness both reuse this.
 */

/** Long and shallow, like a ship seen from the side. The length is what the plate cannot cover. */
export const HULL_COLUMNS = 6;
export const HULL_ROWS = 2;
export const HULL_CELLS = HULL_COLUMNS * HULL_ROWS;

/**
 * Half-extents of the armour plate, in hull cells.
 *
 * Wider than one section and shorter than one deck, on purpose. The width forgives an
 * imprecise slide along the hull, which is the axis a player is really racing on; the
 * height does not, so parking half way between the two decks covers neither and choosing
 * a deck is a real decision rather than a free one.
 */
export const SHIELD_HALF_X = 0.7;
export const SHIELD_HALF_Y = 0.45;

/**
 * How fast the plate slides, in hull cells a second.
 *
 * One number for every instrument. A finger can name a point on the far side of the hull
 * instantly and a key cannot, so the pointer sets a *destination* the plate travels to at
 * this speed rather than teleporting to it — without that the thumb would win every
 * interception a keyboard lost, which is exactly the cross-device unfairness rule 10 and
 * `docs/input-parity.md` exist to prevent.
 */
export const SHIELD_SPEED = 1.8;

/** Blocks the plate can absorb before it is knocked out. */
export const SHIELD_CHARGES = 2;
/** Defensive turns it then spends being rebuilt, blocking nothing. */
export const RECHARGE_TURNS = 2;

/** The plate must stay wholly over the hull, so its centre lives inside these bounds. */
export const SHIELD_MIN_X = SHIELD_HALF_X;
export const SHIELD_MAX_X = HULL_COLUMNS - SHIELD_HALF_X;
export const SHIELD_MIN_Y = SHIELD_HALF_Y;
export const SHIELD_MAX_Y = HULL_ROWS - SHIELD_HALF_Y;

/** Where a fresh plate sits: the middle of the upper deck, identically for both seats. */
export const SHIELD_START_X = HULL_COLUMNS / 2;
export const SHIELD_START_Y = 0.5;

export interface Ship {
  /** One flag per hull section. A breached section cannot be breached again. */
  readonly breached: boolean[];
  /** Centre of the armour plate, in hull cells. */
  shieldX: number;
  shieldY: number;
  /** Blocks left before the plate is knocked out. */
  charges: number;
  /** Defensive turns the plate is still out for. Zero when it is live. */
  downTurns: number;
}

/** Phases of one turn. The seat that may act changes between `aim` and `flight`. */
export type Phase = 'aim' | 'flight' | 'reveal' | 'over';

/** What a shell found. `none` is a shell that arrived at a section already gone. */
export type ShotResult = 'none' | 'breach' | 'blocked';

export interface Game {
  readonly p1: Ship;
  readonly p2: Ship;
  /** Whose cannon is loaded. The other seat is the one being shot at. */
  attacker: SeatId;
  phase: Phase;
  /** The section the cannon is trained on. Always a section that is still there. */
  target: number;
  lastResult: ShotResult;
  /** Shots resolved so far, for the balance harness and for the stalemate argument. */
  turns: number;
}

const WIN: WinCondition = { kind: 'reduce-to-zero' };

export function createShip(): Ship {
  return {
    breached: new Array<boolean>(HULL_CELLS).fill(false),
    shieldX: SHIELD_START_X,
    shieldY: SHIELD_START_Y,
    charges: SHIELD_CHARGES,
    downTurns: 0,
  };
}

export function resetShip(ship: Ship): void {
  ship.breached.fill(false);
  ship.shieldX = SHIELD_START_X;
  ship.shieldY = SHIELD_START_Y;
  ship.charges = SHIELD_CHARGES;
  ship.downTurns = 0;
}

export function createGame(): Game {
  return {
    p1: createShip(),
    p2: createShip(),
    attacker: 'p1',
    phase: 'aim',
    target: 0,
    lastResult: 'none',
    turns: 0,
  };
}

/**
 * Reset the board, with `opener` holding the weather gauge.
 *
 * A symmetric race hands the match to whoever shoots first, so who fires first has to be
 * decided somewhere — and it used to be decided here, by `openingAttacker(rng)`, a seeded
 * coin tossed in front of both devices. That was the right answer at the wrong layer. The
 * shell already decides it: `GameContext.openingSeat` alternates across the rounds of a
 * best-of so first-mover advantage washes out over the match rather than over the seeds
 * (#2466, #2487), and a game that tossed its own coin on top of it would be compensating
 * twice — once here and once in the shell — with neither half able to see the other.
 *
 * So the toss is gone and the opener is the shell's. `p1` is the default only so the rules
 * tests can name a concrete side.
 */
export function resetGame(game: Game, opener: SeatId = 'p1'): void {
  resetShip(game.p1);
  resetShip(game.p2);
  game.attacker = opener;
  game.phase = 'aim';
  game.target = 0;
  game.lastResult = 'none';
  game.turns = 0;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function shipOf(game: Game, seat: SeatId): Ship {
  return seat === 'p1' ? game.p1 : game.p2;
}

/** The seat being shot at, which is the seat holding the plate. */
export function defenderOf(game: Game): SeatId {
  return otherOf(game.attacker);
}

export function columnOf(cell: number): number {
  return cell % HULL_COLUMNS;
}

export function rowOf(cell: number): number {
  return Math.floor(cell / HULL_COLUMNS);
}

export function cellAt(column: number, row: number): number {
  return row * HULL_COLUMNS + column;
}

export function inHull(column: number, row: number): boolean {
  return column >= 0 && column < HULL_COLUMNS && row >= 0 && row < HULL_ROWS;
}

/** Centre of a section, in hull cells — the point a shell arrives at. */
export function cellCentreX(cell: number): number {
  return columnOf(cell) + 0.5;
}

export function cellCentreY(cell: number): number {
  return rowOf(cell) + 0.5;
}

export function isBreached(ship: Ship, cell: number): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= HULL_CELLS) return true;
  return ship.breached[cell] === true;
}

export function intactCount(ship: Ship): number {
  let count = 0;
  for (let cell = 0; cell < HULL_CELLS; cell += 1) {
    if (ship.breached[cell] !== true) count += 1;
  }
  return count;
}

export function breachCount(ship: Ship): number {
  return HULL_CELLS - intactCount(ship);
}

/** Whether the plate is live. A plate with no charges left is being rebuilt. */
export function shieldLive(ship: Ship): boolean {
  return ship.downTurns === 0 && ship.charges > 0;
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export function clampShield(ship: Ship): void {
  ship.shieldX = clamp(ship.shieldX, SHIELD_MIN_X, SHIELD_MAX_X);
  ship.shieldY = clamp(ship.shieldY, SHIELD_MIN_Y, SHIELD_MAX_Y);
}

/** Whether the plate, where it is now, stands between a shell and this section. */
export function shieldCovers(ship: Ship, cell: number): boolean {
  if (!shieldLive(ship)) return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= HULL_CELLS) return false;
  return (
    Math.abs(ship.shieldX - cellCentreX(cell)) <= SHIELD_HALF_X &&
    Math.abs(ship.shieldY - cellCentreY(cell)) <= SHIELD_HALF_Y
  );
}

/**
 * Dead centre of a section, as a place to put the plate.
 *
 * Fixed per section rather than relative to the plate, which matters: a target that is
 * recomputed from the plate's own position walks away from itself once a misjudgement is
 * added to it, and the plate slides off the hull at full speed chasing its own tail.
 */
export function coverX(cell: number): number {
  return clamp(cellCentreX(cell), SHIELD_MIN_X, SHIELD_MAX_X);
}

export function coverY(cell: number): number {
  return clamp(cellCentreY(cell), SHIELD_MIN_Y, SHIELD_MAX_Y);
}

/** Where the plate has to be to cover a section, nearest to where it already is. */
export function interceptX(ship: Ship, cell: number): number {
  const centre = cellCentreX(cell);
  const low = Math.max(SHIELD_MIN_X, centre - SHIELD_HALF_X);
  const high = Math.min(SHIELD_MAX_X, centre + SHIELD_HALF_X);
  return clamp(ship.shieldX, low, high);
}

export function interceptY(ship: Ship, cell: number): number {
  const centre = cellCentreY(cell);
  const low = Math.max(SHIELD_MIN_Y, centre - SHIELD_HALF_Y);
  const high = Math.min(SHIELD_MAX_Y, centre + SHIELD_HALF_Y);
  return clamp(ship.shieldY, low, high);
}

/**
 * How far the plate has to slide to cover a section, in hull cells.
 *
 * Zero when it already does. This is the whole game in one number: the gunner wants the
 * section with the largest one, and the defender parks so that no section has a large one.
 */
export function requiredTravel(ship: Ship, cell: number): number {
  const dx = interceptX(ship, cell) - ship.shieldX;
  const dy = interceptY(ship, cell) - ship.shieldY;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Straight-line distance from the plate's centre to a section — what an eye judges. */
export function plateDistance(ship: Ship, cell: number): number {
  const dx = cellCentreX(cell) - ship.shieldX;
  const dy = cellCentreY(cell) - ship.shieldY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Slide the plate towards a point, by at most `maxDistance`.
 *
 * A pointer names the destination and a key names a direction, and both arrive here: the
 * plate travels the same distance a second whichever named it. Returns true once it is
 * there, so a caller can stop asking.
 *
 * Linear in time, so a hundred and twenty steps of half the length cover exactly the
 * ground sixty steps covered — the integral rule 8 asks for, rather than a per-step
 * multiplier that would make the plate faster on a faster screen.
 */
export function steerShield(
  ship: Ship,
  targetX: number,
  targetY: number,
  maxDistance: number,
): boolean {
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) return false;
  const wantX = clamp(targetX, SHIELD_MIN_X, SHIELD_MAX_X);
  const wantY = clamp(targetY, SHIELD_MIN_Y, SHIELD_MAX_Y);
  const dx = wantX - ship.shieldX;
  const dy = wantY - ship.shieldY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance <= maxDistance) {
    ship.shieldX = wantX;
    ship.shieldY = wantY;
    return true;
  }
  const scale = maxDistance / distance;
  ship.shieldX = clamp(ship.shieldX + dx * scale, SHIELD_MIN_X, SHIELD_MAX_X);
  ship.shieldY = clamp(ship.shieldY + dy * scale, SHIELD_MIN_Y, SHIELD_MAX_Y);
  return false;
}

/** Push the plate along a direction vector, by at most `distance`. The keyboard's form. */
export function nudgeShield(ship: Ship, dirX: number, dirY: number, distance: number): void {
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY) || !Number.isFinite(distance)) return;
  const lengthSq = dirX * dirX + dirY * dirY;
  if (lengthSq <= 0) return;
  // The engine already caps a two-key diagonal at unit length; anything longer is capped
  // here too, so no source can out-run the plate's speed by pushing harder.
  const scale = lengthSq > 1 ? distance / Math.sqrt(lengthSq) : distance;
  ship.shieldX = clamp(ship.shieldX + dirX * scale, SHIELD_MIN_X, SHIELD_MAX_X);
  ship.shieldY = clamp(ship.shieldY + dirY * scale, SHIELD_MIN_Y, SHIELD_MAX_Y);
}

/**
 * The nearest section still standing, so a shot is never wasted on a hole.
 *
 * Ties break to the lower index, which is arbitrary but has to be *decided*: two devices
 * stepping the same match must snap the same way.
 */
export function nearestIntact(ship: Ship, cell: number): number {
  const from = Number.isInteger(cell) && cell >= 0 && cell < HULL_CELLS ? cell : 0;
  if (ship.breached[from] !== true) return from;
  let best = -1;
  let bestDistance = Infinity;
  for (let candidate = 0; candidate < HULL_CELLS; candidate += 1) {
    if (ship.breached[candidate] === true) continue;
    const dx = cellCentreX(candidate) - cellCentreX(from);
    const dy = cellCentreY(candidate) - cellCentreY(from);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * The shell leaves the barrel and the defender's half of the turn begins.
 *
 * A named transition rather than an assignment, because it is the moment the board changes
 * hands: from here until the shell lands the seat that may act is the one being shot at.
 */
export function beginDefence(game: Game): void {
  game.phase = 'flight';
}

/**
 * Resolve the shell where it lands.
 *
 * **This is why the match always ends.** A block costs a charge, and a plate out of
 * charges is rebuilt over the next {@link RECHARGE_TURNS} defensive turns, during which
 * every shot gets through. So however well a defender plays, at most two of every four
 * shots at them can be stopped — a hull cannot be defended for ever, and a position where
 * neither side can make progress does not exist.
 */
export function resolveShot(game: Game): ShotResult {
  const defender = shipOf(game, defenderOf(game));
  const cell = game.target;
  let result: ShotResult = 'none';

  if (shieldCovers(defender, cell) && !isBreached(defender, cell)) {
    defender.charges -= 1;
    if (defender.charges <= 0) {
      defender.charges = 0;
      defender.downTurns = RECHARGE_TURNS;
    }
    result = 'blocked';
  } else {
    if (!isBreached(defender, cell)) {
      defender.breached[cell] = true;
      result = 'breach';
    }
    // The plate comes back one turn at a time, and only on turns it did not stop anything.
    if (defender.downTurns > 0) {
      defender.downTurns -= 1;
      if (defender.downTurns === 0) defender.charges = SHIELD_CHARGES;
    }
  }

  game.lastResult = result;
  game.turns += 1;
  game.phase = 'reveal';
  return result;
}

/** Hand the cannon to the other seat and train it on a section still standing. */
export function passTurn(game: Game): void {
  game.attacker = otherOf(game.attacker);
  game.phase = 'aim';
  game.lastResult = 'none';
  game.target = Math.max(0, nearestIntact(shipOf(game, defenderOf(game)), game.target));
}

/** Point the cannon at a section, snapped to one that is still there. Returns what it took. */
export function aimAt(game: Game, cell: number): number {
  const defender = shipOf(game, defenderOf(game));
  const snapped = nearestIntact(defender, cell);
  if (snapped < 0) return game.target;
  game.target = snapped;
  return snapped;
}

/**
 * The winner, or null while both ships float.
 *
 * Through the SDK's `reduce-to-zero`, with the sections still standing as the health: one
 * shell lands at a time, so there is no way for both hulls to go in the same step and no
 * draw to define.
 */
export function winnerOf(game: Game): Outcome {
  return resolve(WIN, { p1: intactCount(game.p1), p2: intactCount(game.p2) });
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * How the tiers differ.
 *
 * Everything here is a property of the *player*, never of the world: how long it takes to
 * pull the lanyard, how long its hands take to reach the plate, how well it judges where
 * the shell is going, and whether it uses the smoke after a shot to reposition. None of
 * them is information a person at the same screen does not have (CLAUDE.md rule 6), and
 * every tier's plate slides at exactly {@link SHIELD_SPEED}.
 */
export interface BotProfile {
  /** Seconds spent laying the gun before it fires. */
  readonly fireSeconds: number;
  /** Seconds before its hands reach the plate, once a shell is in the air. */
  readonly reactSeconds: number;
  /** Hull cells of error in where it believes the shell will land. Drawn once a shot. */
  readonly aimSpread: number;
  /** How often it fires somewhere other than the section it worked out. */
  readonly strayShots: number;
  /** Whether it reads the plate's own width, or only eyes the distance to its middle. */
  readonly readsReach: boolean;
  /** Whether it slides the plate back over the hull while the smoke clears. */
  readonly parks: boolean;
}

export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: {
    fireSeconds: 1.25,
    reactSeconds: 0.85,
    aimSpread: 1.15,
    strayShots: 1,
    readsReach: false,
    parks: false,
  },
  normal: {
    fireSeconds: 0.9,
    reactSeconds: 0.42,
    aimSpread: 0.62,
    strayShots: 0.3,
    readsReach: false,
    parks: false,
  },
  hard: {
    fireSeconds: 0.6,
    reactSeconds: 0.16,
    aimSpread: 0.18,
    strayShots: 0,
    readsReach: true,
    parks: true,
  },
});

const candidates: number[] = [];

/**
 * The section a bot fires at.
 *
 * It reads the enemy hull and the enemy plate, both of which are drawn on the screen the
 * whole time — a person aiming does exactly this by eye. `easy` fires at whatever is
 * still standing; `normal` picks the section furthest from the middle of the plate;
 * `hard` measures against the plate's actual width and the ends of its travel, which is
 * the difference between "far from the plate" and "out of its reach".
 */
export function botTarget(defender: Ship, rng: Rng, difficulty: BotDifficulty): number {
  const profile = BOT_PROFILES[difficulty];
  candidates.length = 0;
  for (let cell = 0; cell < HULL_CELLS; cell += 1) {
    if (defender.breached[cell] !== true) candidates.push(cell);
  }
  if (candidates.length === 0) return -1;
  // Drawn whatever the tier, so the tiers stay on the same point of the seeded stream and
  // one match can be compared with another.
  const stray = rng.bool(profile.strayShots);
  const wild = candidates[rng.int(0, candidates.length)] as number;
  if (stray) return wild;

  let best = candidates[0] as number;
  let bestScore = -1;
  for (const cell of candidates) {
    const score = profile.readsReach
      ? requiredTravel(defender, cell)
      : plateDistance(defender, cell);
    if (score > bestScore) {
      bestScore = score;
      best = cell;
    }
  }
  return best;
}

/**
 * Where a bot parks the plate between shots: over the middle of what it has left.
 *
 * The point that minimises the worst slide it can be asked for next turn, near enough,
 * and only reachable in the window a person also has — the smoke after a shot, while the
 * board still faces them.
 */
export function parkX(ship: Ship): number {
  let sum = 0;
  let count = 0;
  for (let cell = 0; cell < HULL_CELLS; cell += 1) {
    if (ship.breached[cell] === true) continue;
    sum += cellCentreX(cell);
    count += 1;
  }
  if (count === 0) return SHIELD_START_X;
  return clamp(sum / count, SHIELD_MIN_X, SHIELD_MAX_X);
}

export function parkY(ship: Ship): number {
  let sum = 0;
  let count = 0;
  for (let cell = 0; cell < HULL_CELLS; cell += 1) {
    if (ship.breached[cell] === true) continue;
    sum += cellCentreY(cell);
    count += 1;
  }
  if (count === 0) return SHIELD_START_Y;
  // Never left between the two decks, where it would cover neither. An even split parks
  // it on the upper deck, which is where a fresh plate sits.
  const middle = sum / count;
  const deck = middle <= HULL_ROWS / 2 ? 0.5 : HULL_ROWS - 0.5;
  return clamp(deck, SHIELD_MIN_Y, SHIELD_MAX_Y);
}
