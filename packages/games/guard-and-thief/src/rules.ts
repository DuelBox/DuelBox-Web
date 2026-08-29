import { createContact, envelopeFor, sweptCircleCircle } from '@duelbox/engine';
import type { Circle, Contact, Rng, SeatId } from '@duelbox/engine';
import { resolve } from '@duelbox/game-sdk';
import type { WinCondition } from '@duelbox/game-sdk';

/**
 * Guard and Thief, as pure rules.
 *
 * Two vaults, one at each end of the device, and one runner per seat. The coins you can
 * spend are in the **other** player's vault, so the only way to score is to leave your own
 * floor — and the moment you do, you are the thief and they are the guard. Come home and
 * the roles invert: you bank what you carried, you get your speed back, and it is their
 * turn to be caught.
 *
 * No rendering, no timing, no DOM — the bot, the balance harness and the tests all reuse
 * this module.
 *
 * ## The four decisions this file exists to record
 *
 * **The two roles are one rule, and it is written in the seat's own frame.** A runner is a
 * *guard* while it stands in its own half and a *thief* while it stands in the other one.
 * That single predicate — {@link atHome} — carries the speed, the pickup, the banking and
 * the catch, so there is no seat that "is" the thief and no half of the match that has to
 * be compared with the other. Seat one's share is 50.0% by construction rather than by
 * measurement; SPEC.md carries the argument and `rules.test.ts` asserts it board by board.
 *
 * **The catch has no tie-break, because it cannot tie.** When two runners touch they are
 * by definition in the same half, and exactly one of them owns that half — so the guard is
 * named by the geometry rather than chosen. When they touch *across* the midline neither
 * of them owns where the other stands, and nothing happens. Both branches are symmetric
 * under the half-turn, and the degenerate case (`y` exactly on the midline) resolves the
 * same way for both seats because the predicate is `seatAxisSign(seat) * (y - CENTRE_Y) > 0`,
 * which is exactly negated by the half-turn and therefore lands on the same side of zero.
 *
 * **The clock is the whole ending, not a backstop.** {@link WIN_CONDITION} is
 * `highest-when-time-expires`, which is what the catalogue row asks for, so a match is
 * exactly `MATCH_SECONDS` of simulated time and nothing else can end it. There is no
 * position two `easy` bots can reach that fails to terminate, because termination does not
 * depend on the position at all.
 *
 * **Nothing here is continuous except position.** A {@link Command} is one of nine
 * headings — eight compass points and a standstill — which is the whole vocabulary a
 * keyboard has. `game.ts` reduces an anchored drag to the *sign of the displacement on
 * each axis* and lands on the identical nine. See SPEC.md, "Fairness across input
 * families".
 */

/* ------------------------------------------------------------------------------------ */
/* The board                                                                             */
/* ------------------------------------------------------------------------------------ */

export const BOARD_WIDTH = 600;
export const BOARD_HEIGHT = 1000;

/**
 * The vault door: the line the whole game is written about.
 *
 * Both halves are half-turn images of one another about `(300, 500)`, so crossing it is
 * the same move, costs the same, and buys the same thing for either player.
 */
export const CENTRE_Y = BOARD_HEIGHT / 2;

/** How far the wall sits from the edge of the logical box. */
export const WALL = 20;

export const RUNNER_RADIUS = 20;
export const COIN_RADIUS = 11;

/** A coin is taken on contact. Swept, so a sprint cannot pass through one. */
export const PICKUP_RADIUS = RUNNER_RADIUS + COIN_RADIUS;

/** Two runners touch at the sum of their radii, and that is the catch. */
export const CATCH_RADIUS = RUNNER_RADIUS * 2;

/** How far a runner's centre may travel. The same box for both seats. */
export function minX(): number {
  return WALL + RUNNER_RADIUS;
}
export function maxX(): number {
  return BOARD_WIDTH - WALL - RUNNER_RADIUS;
}
export function minY(): number {
  return WALL + RUNNER_RADIUS;
}
export function maxY(): number {
  return BOARD_HEIGHT - WALL - RUNNER_RADIUS;
}

/** How far a seat's doorway sits from its own back wall. */
export const HOME_BACK = 80;

/**
 * Where a runner starts, and where a caught thief is put out.
 *
 * The middle of its own back wall: always inside its own half, always the same distance
 * from everything, and the same move for both seats under the half-turn.
 */
export function homeX(): number {
  return BOARD_WIDTH / 2;
}
export function homeY(seat: SeatId): number {
  return seat === 'p1' ? BOARD_HEIGHT - HOME_BACK : HOME_BACK;
}

/**
 * Which way a seat's own axes point along the board.
 *
 * Seat two sits at the top of the device and reads it upside down, so its own "forward"
 * is the device's down. Every seat-relative quantity in this file — the eight headings,
 * their tie-break order, the two roles — is written in the seat's frame and multiplied by
 * this, which is what makes the whole file covariant under the half-turn.
 */
export function seatAxisSign(seat: SeatId): number {
  return seat === 'p1' ? 1 : -1;
}

/**
 * How deep into its **own** half a point is, in this seat's frame. Positive means home.
 *
 * This is the one quantity the two roles are decided by, and it is written this way on
 * purpose. Under the half-turn `y -> 1000 - y` with the seats exchanged it is exactly
 * negated twice and therefore identical, so two mirror-image runners are never on
 * opposite sides of the test — including at `y === CENTRE_Y` exactly, where both read
 * zero and both are counted as *away*. `rules.test.ts` scrambles runners onto a lattice
 * that includes the midline for that reason: the knife edge is exercised rather than
 * assumed to be measure-zero (this is the family Frozen Beaks' rim and Snowball Throw's
 * ball age both belong to).
 */
export function ownDepth(seat: SeatId, y: number): number {
  return seatAxisSign(seat) * (y - CENTRE_Y);
}

/** True while this seat's runner stands on its own floor, which makes it the guard. */
export function atHome(seat: SeatId, y: number): boolean {
  return ownDepth(seat, y) > 0;
}

/* ------------------------------------------------------------------------------------ */
/* The two roles                                                                         */
/* ------------------------------------------------------------------------------------ */

/**
 * A guard is faster than a thief, and that asymmetry belongs to the *floor*, not to the
 * seat.
 *
 * It is what makes a chase resolve — two runners at one speed on an open floor never meet
 * — and it is what makes crossing the door a real decision rather than a free one: you
 * give up a third of your speed to be able to score at all. Both players pay exactly the
 * same price for exactly the same thing, which is the whole of the fairness argument.
 *
 * The ratio also bounds the chase: a thief `d` units from the door reaches safety in
 * `d / THIEF_SPEED`, and a guard `g` units away closes at `GUARD_SPEED - THIEF_SPEED` in
 * a straight run, so whether a catch is on is a question with an answer. {@link canCatch}
 * asks it, and the bot uses nothing else.
 */
export const THIEF_SPEED = 210;
export const GUARD_SPEED = 255;

/**
 * How far a finger must travel from where it pressed before it means a direction.
 *
 * Four precision envelopes, per `docs/input-idiom.md` rule 2, rather than a hand-picked
 * constant. `game.ts` reads the *sign* of the displacement on each axis, so this is the
 * only thing standing between a resting thumb and a held key.
 */
export const DRAG_DEADZONE = 4 * envelopeFor({ width: BOARD_WIDTH, height: BOARD_HEIGHT });

/**
 * How far the anchor of a drag is allowed to lag behind the finger.
 *
 * A fixed anchor is a stick you have to walk back to; a leashed one re-centres, so a
 * reversal costs `DRAG_LEASH + DRAG_DEADZONE` of travel — 36 units here, against the 200
 * that `docs/input-idiom.md` allows a gesture to ask for before a trackpad has to
 * re-clutch. Nothing continuous leaks out of it: the output is still one of nine signs.
 */
export const DRAG_LEASH = 2 * DRAG_DEADZONE;

/* ------------------------------------------------------------------------------------ */
/* The vaults                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * Where the coins in a seat's own vault lie, measured from the door.
 *
 * The strip either side of the door is deliberately empty. Without it the whole game is a
 * hop over the line and back, the guard never gets a chance to close, and the thief never
 * commits to anything. A hundred units is half a second of a thief's running, and it is
 * also what makes the pickup test below exact rather than approximate.
 */
export const VAULT_NEAR = 100;
export const VAULT_FAR = 380;
export const VAULT_INSET_X = 70;

/** How many coins lie loose in one vault at a time. */
export const COINS_LOOSE = 5;

/** Seconds between a coin being taken and its replacement being set out. */
export const RESPAWN_SECONDS = 1.5;

/** How many places the spawn cycle holds. A match uses forty-odd of them. */
export const SPAWN_SPOTS = 48;

/** How far apart the cycle tries to keep coins that are out at the same time. */
export const COIN_SEPARATION = 120;

/** Seconds a runner is drawn flashing after a catch. Never read by a rule. */
export const FLASH_SECONDS = 0.8;

/**
 * The clock, in seconds, and the only thing that ends a match.
 *
 * `roundSeconds` ends nothing — it is text on a catalogue card — so the clock lives here,
 * and a test asserts the manifest advertises the same number. Unlike every other game in
 * the catalogue this one has no other ending at all: the catalogue row says "whoever has
 * more coins at the end of the match", so the end of the match is the whole win condition
 * and termination is a property of the arithmetic rather than of the position.
 */
export const MATCH_SECONDS = 60;

export const WIN_CONDITION: WinCondition = Object.freeze({ kind: 'highest-when-time-expires' });

/* ------------------------------------------------------------------------------------ */
/* State                                                                                 */
/* ------------------------------------------------------------------------------------ */

export interface Runner {
  x: number;
  y: number;
  /** Position at the start of the step, for render interpolation and the swept catch. */
  prevX: number;
  prevY: number;
  /** The last heading actually walked, so a standing runner still faces somewhere. */
  faceX: number;
  faceY: number;
  /** Coins lifted on this raid and not yet banked. Lost in full to a catch. */
  carry: number;
  /** Coins banked. This is the score. */
  bank: number;
  /** Catches made as a guard. The tie-break, and half the ladder. */
  catches: number;
  /** Times caught as a thief. */
  losses: number;
  /** Doors gone out of. Reported in SPEC.md; never read by a rule. */
  raids: number;
  /**
   * Whether this runner stood on its own floor at the end of the last step.
   *
   * Counted rather than derived, because banking is a *transition* — you bank what you
   * carried at the moment you come through your own door, and a rule that recomputed the
   * side each step could not see the crossing.
   */
  home: boolean;
  /** Seconds since this runner was involved in a catch, purely so the drawing can flash. */
  flash: number;
}

export interface Coin {
  active: boolean;
  x: number;
  y: number;
  /** Seconds until this one is set out again. */
  delay: number;
}

export interface Spot {
  x: number;
  y: number;
}

/**
 * One seat's side of the board: its runner, and the vault it guards.
 *
 * The coins in a seat's vault are the ones the **other** seat comes to steal. Bundling
 * them with the seat rather than with the board is what makes the half-turn a plain swap
 * of `p1` and `p2` — see `rules.test.ts`.
 */
export interface Side {
  readonly runner: Runner;
  readonly vault: Coin[];
  /** How far through {@link Game.spots} this vault has been restocked. */
  cursor: number;
}

export interface Game {
  readonly p1: Side;
  readonly p2: Side;
  /**
   * The restock cycle, in seat one's frame.
   *
   * One list, read by both vaults through their own half-turn and at their own pace, so
   * the two players raid identical floors without ever competing for the same coin.
   */
  readonly spots: Spot[];
  /** Seconds left. Counts down; reaching zero is the only ending there is. */
  clock: number;
  winner: SeatId | 'draw' | null;
}

/** What one seat is asking for this step. The whole input surface of the simulation. */
export interface Command {
  /** A unit heading, or (0, 0) for a standstill. */
  dirX: number;
  dirY: number;
}

export function createCommand(): Command {
  return { dirX: 0, dirY: 0 };
}

export const SEATS: readonly SeatId[] = Object.freeze(['p1', 'p2']);

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function sideOf(game: Readonly<Game>, seat: SeatId): Side {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function runnerOf(game: Readonly<Game>, seat: SeatId): Runner {
  return sideOf(game, seat).runner;
}

/** The vault this seat raids: the other seat's. */
export function raidedVault(game: Readonly<Game>, seat: SeatId): Coin[] {
  return sideOf(game, otherOf(seat)).vault;
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/* ------------------------------------------------------------------------------------ */
/* The restock cycle                                                                     */
/* ------------------------------------------------------------------------------------ */

const SPOT_MIN_X = VAULT_INSET_X;
const SPOT_MAX_X = BOARD_WIDTH - VAULT_INSET_X;
const SPOT_MIN_Y = CENTRE_Y + VAULT_NEAR;
const SPOT_MAX_Y = CENTRE_Y + VAULT_FAR;

/** How many placements a spot tries before it settles for the best it saw. */
const SPOT_ATTEMPTS = 10;

/**
 * A number in [0, 1) for the `k`th draw of the layout.
 *
 * Two modes through one function. With a generator it is a seeded draw; without one it is
 * a golden-ratio low-discrepancy sequence, which spreads as evenly as a random one and
 * lets {@link createGame} hand back a real, playable board before anybody has a seed —
 * tests and the balance harness both want that.
 */
function layoutDraw(rng: Rng | null, k: number): number {
  if (rng !== null) return rng.float();
  const x = (k + 1) * 0.6180339887498949;
  return x - Math.floor(x);
}

/**
 * Lay out the restock cycle, once, in seat one's frame.
 *
 * Each spot is chosen as the best of ten candidates by clearance from the last
 * {@link COINS_LOOSE} spots, so the coins that are out together are spread rather than
 * piled. Bounded rather than rejection-sampled, and it *settles* for the best candidate
 * instead of looping, so `resetGame` always terminates however unlucky the seed is.
 *
 * Seat two's vault reads this same list through the half-turn, so the two floors are
 * identical and neither player can draw the easier one.
 */
function layout(game: Game, rng: Rng | null): void {
  let draw = 0;
  for (let k = 0; k < SPAWN_SPOTS; k += 1) {
    let bestX = 0;
    let bestY = 0;
    let bestClear = -1;
    for (let attempt = 0; attempt < SPOT_ATTEMPTS; attempt += 1) {
      const x = SPOT_MIN_X + layoutDraw(rng, draw) * (SPOT_MAX_X - SPOT_MIN_X);
      draw += 1;
      const y = SPOT_MIN_Y + layoutDraw(rng, draw) * (SPOT_MAX_Y - SPOT_MIN_Y);
      draw += 1;
      let nearest = Infinity;
      for (let back = 1; back <= COINS_LOOSE && k - back >= 0; back += 1) {
        const other = game.spots[k - back] as Spot;
        const gap = Math.hypot(x - other.x, y - other.y);
        if (gap < nearest) nearest = gap;
      }
      if (nearest > bestClear) {
        bestClear = nearest;
        bestX = x;
        bestY = y;
      }
      if (nearest >= COIN_SEPARATION) break;
    }
    const spot = game.spots[k] as Spot;
    spot.x = bestX;
    spot.y = bestY;
  }
}

/** Set one coin out on the next place in the cycle, in this vault's own frame. */
function restock(game: Game, seat: SeatId, coin: Coin): void {
  const side = sideOf(game, seat);
  const spot = game.spots[side.cursor % SPAWN_SPOTS] as Spot;
  side.cursor = (side.cursor + 1) % SPAWN_SPOTS;
  coin.x = seat === 'p1' ? spot.x : BOARD_WIDTH - spot.x;
  coin.y = seat === 'p1' ? spot.y : BOARD_HEIGHT - spot.y;
  coin.active = true;
  coin.delay = 0;
}

/* ------------------------------------------------------------------------------------ */
/* Building and resetting                                                                */
/* ------------------------------------------------------------------------------------ */

function makeRunner(seat: SeatId): Runner {
  return {
    x: homeX(),
    y: homeY(seat),
    prevX: homeX(),
    prevY: homeY(seat),
    faceX: 0,
    faceY: -seatAxisSign(seat),
    carry: 0,
    bank: 0,
    catches: 0,
    losses: 0,
    raids: 0,
    home: true,
    flash: 0,
  };
}

function makeSide(seat: SeatId): Side {
  const vault: Coin[] = [];
  for (let i = 0; i < COINS_LOOSE; i += 1) vault.push({ active: false, x: 0, y: 0, delay: 0 });
  return { runner: makeRunner(seat), vault, cursor: 0 };
}

export function createGame(): Game {
  const spots: Spot[] = [];
  for (let i = 0; i < SPAWN_SPOTS; i += 1) spots.push({ x: 0, y: 0 });
  const game: Game = {
    p1: makeSide('p1'),
    p2: makeSide('p2'),
    spots,
    clock: MATCH_SECONDS,
    winner: null,
  };
  resetGame(game, null);
  return game;
}

function resetRunner(runner: Runner, seat: SeatId): void {
  runner.x = homeX();
  runner.y = homeY(seat);
  runner.prevX = runner.x;
  runner.prevY = runner.y;
  runner.faceX = 0;
  runner.faceY = -seatAxisSign(seat);
  runner.carry = 0;
  runner.bank = 0;
  runner.catches = 0;
  runner.losses = 0;
  runner.raids = 0;
  runner.home = true;
  runner.flash = 0;
}

/**
 * Start a fresh match. `rng` is the match seed; pass null for the fixed opening board
 * {@link createGame} builds.
 */
export function resetGame(game: Game, rng: Rng | null): void {
  game.clock = MATCH_SECONDS;
  game.winner = null;
  for (let i = 0; i < SEATS.length; i += 1) {
    const seat = SEATS[i] as SeatId;
    const side = sideOf(game, seat);
    resetRunner(side.runner, seat);
    side.cursor = 0;
  }
  layout(game, rng);
  for (let i = 0; i < SEATS.length; i += 1) {
    const seat = SEATS[i] as SeatId;
    const side = sideOf(game, seat);
    for (let c = 0; c < side.vault.length; c += 1) {
      const coin = side.vault[c] as Coin;
      coin.active = false;
      coin.delay = 0;
      restock(game, seat, coin);
    }
  }
}

/* ------------------------------------------------------------------------------------ */
/* Stepping                                                                              */
/* ------------------------------------------------------------------------------------ */

/* Scratch shapes. Allocated once at module load and reused, so a step allocates nothing. */
const contact: Contact = createContact();
const mover: Circle = { x: 0, y: 0, radius: 0 };
const target: Circle = { x: 0, y: 0, radius: 0 };
const tally = { p1: 0, p2: 0 };
const TIME_UP = Object.freeze({ timeExpired: true });

/**
 * Move one runner, taking whatever it crosses on the way.
 *
 * Two rules live here and both are the same predicate. A runner moves at
 * {@link GUARD_SPEED} on its own floor and {@link THIEF_SPEED} off it, and it may only
 * lift coins off it. The pickup is gated on the side the runner ends the step on rather
 * than on the side it was on at the moment of contact, which is exact rather than
 * approximate: no coin lies within {@link VAULT_NEAR} of the door and no runner covers
 * more than `GUARD_SPEED * dt` in a step, so the two questions cannot disagree at any
 * step rate the loop will ever be run at. `rules.test.ts` asserts the margin.
 */
function driveSeat(game: Game, seat: SeatId, command: Readonly<Command>, dt: number): void {
  const runner = runnerOf(game, seat);
  runner.prevX = runner.x;
  runner.prevY = runner.y;
  if (runner.flash > 0) runner.flash = Math.max(0, runner.flash - dt);
  if (command.dirX !== 0 || command.dirY !== 0) {
    runner.faceX = command.dirX;
    runner.faceY = command.dirY;
  }

  const speed = atHome(seat, runner.y) ? GUARD_SPEED : THIEF_SPEED;
  const stride = speed * dt;
  const endX = clamp(runner.x + command.dirX * stride, minX(), maxX());
  const endY = clamp(runner.y + command.dirY * stride, minY(), maxY());
  const dx = endX - runner.x;
  const dy = endY - runner.y;

  if (!atHome(seat, endY)) {
    // Swept rather than sampled. It is not load-bearing at 60 Hz and the arithmetic says
    // so — tunnelling a 31-unit pickup needs a step longer than 62 / GUARD_SPEED, which is
    // a quarter of a second — but rule 8 says the step rate is not ours to assume, and the
    // sweep costs one function call and removes the question. A test carries the number.
    const vault = raidedVault(game, seat);
    mover.x = runner.x;
    mover.y = runner.y;
    mover.radius = RUNNER_RADIUS;
    target.radius = COIN_RADIUS;
    for (let i = 0; i < vault.length; i += 1) {
      const coin = vault[i] as Coin;
      if (!coin.active) continue;
      target.x = coin.x;
      target.y = coin.y;
      if (!sweptCircleCircle(contact, mover, dx, dy, target)) continue;
      coin.active = false;
      coin.delay = RESPAWN_SECONDS;
      runner.carry += 1;
    }
  }

  runner.x = endX;
  runner.y = endY;
}

/**
 * Settle a runner's crossing of its own door, **after** the catch has been resolved.
 *
 * Order matters and this is the reason it does. A thief that is caught at the start of a
 * step and reaches its own door by the end of the same step is caught: the contact came
 * first in time, so the loot goes to the guard rather than into the bank. Banking inside
 * {@link driveSeat}, which is where it started life, paid that thief twice — a test drives
 * exactly that step at 8 Hz.
 *
 * {@link capture} sets the caught runner's `home` flag itself, so a thief put out at its
 * own door neither banks nor is charged with a fresh raid.
 */
function settleDoor(game: Game, seat: SeatId): void {
  const runner = runnerOf(game, seat);
  const nowHome = atHome(seat, runner.y);
  if (nowHome && !runner.home) {
    // Through your own door: what you carried is yours, and cannot be taken off you again.
    runner.bank += runner.carry;
    runner.carry = 0;
  } else if (!nowHome && runner.home) {
    runner.raids += 1;
  }
  runner.home = nowHome;
}

/**
 * The catch, resolved once for the pair rather than once per seat.
 *
 * Swept against the **relative** motion, so the moment the two circles first come within
 * {@link CATCH_RADIUS} is found exactly however fast they are closing. Tunnelling is not
 * what that buys — a head-on approach closes at 465 units a second, and passing clean
 * through a 40-unit radius would need a step longer than an eighth of a second. What it
 * buys is that the catch is settled at the moment of contact rather than at the end of the
 * step, and that is observable: a thief caught on its way through its own door is caught,
 * where sampling the two ends would find both runners at home and let it go.
 *
 * Whose catch it is needs no arbitration. At the moment of contact both runners are in
 * the same half of the board, exactly one of them owns that half, and that one is the
 * guard. The two exceptions are symmetric and both mean nothing happens: two runners
 * meeting *across* the door are either both home (neither is trespassing) or both away
 * (there is no guard present). Written as `aHome === bHome`, which is the same statement
 * for either seat and is what keeps this covariant under the half-turn.
 */
function settleCatch(game: Game): void {
  const a = game.p1.runner;
  const b = game.p2.runner;
  mover.x = a.prevX;
  mover.y = a.prevY;
  mover.radius = RUNNER_RADIUS;
  target.x = b.prevX;
  target.y = b.prevY;
  target.radius = RUNNER_RADIUS;
  const dx = a.x - a.prevX - (b.x - b.prevX);
  const dy = a.y - a.prevY - (b.y - b.prevY);
  if (!sweptCircleCircle(contact, mover, dx, dy, target)) return;
  const t = contact.depth;
  const aHome = atHome('p1', a.prevY + (a.y - a.prevY) * t);
  const bHome = atHome('p2', b.prevY + (b.y - b.prevY) * t);
  if (aHome === bHome) return;
  if (aHome) capture(game, 'p1', 'p2');
  else capture(game, 'p2', 'p1');
}

/**
 * A guard takes the loot off a thief and puts it out of its own door.
 *
 * Everything the thief was carrying moves to the guard's **bank** rather than to its
 * hands, because a guard is standing on its own floor and has nothing left to carry it
 * through. That is what pays for guarding: the swing is twice the carry, which is what
 * makes staying home a live alternative to raiding rather than a way of scoring nothing.
 *
 * The thief is put back at its own door, which is the far end of the board, so a catch
 * can never repeat on the next step and no stun timer is needed to prevent it. The guard
 * is not moved at all — it is already where it is supposed to be.
 */
function capture(game: Game, guardSeat: SeatId, thiefSeat: SeatId): void {
  const guard = runnerOf(game, guardSeat);
  const thief = runnerOf(game, thiefSeat);
  guard.bank += thief.carry;
  guard.catches += 1;
  guard.flash = FLASH_SECONDS;
  thief.carry = 0;
  thief.losses += 1;
  thief.flash = FLASH_SECONDS;
  thief.x = homeX();
  thief.y = homeY(thiefSeat);
  thief.prevX = thief.x;
  thief.prevY = thief.y;
  thief.faceX = 0;
  thief.faceY = -seatAxisSign(thiefSeat);
  thief.home = true;
}

function restockVault(game: Game, seat: SeatId, dt: number): void {
  const vault = sideOf(game, seat).vault;
  for (let i = 0; i < vault.length; i += 1) {
    const coin = vault[i] as Coin;
    if (coin.active) continue;
    coin.delay -= dt;
    if (coin.delay <= 0) restock(game, seat, coin);
  }
}

/**
 * Who has won, or null while the clock is still running.
 *
 * `highest-when-time-expires` is the catalogue row exactly — "whoever has more coins at
 * the end of the match wins" — so there is nothing to decide until the whistle and
 * nothing left to decide after it. Only banked coins count: loot in a thief's hands never
 * made it through a door, and a guard who is still standing over it when the clock stops
 * has done its job.
 *
 * Level on coins, the runner that made **more catches** takes it. A tie-break has to be
 * something that is not a function of the board — a covariant rule returns the mirror
 * answer on a mirror position and therefore decides nothing — and catches are a count of
 * a seat's own doing rather than a coordinate. Level on both is an honest draw.
 */
function judge(game: Game): void {
  if (game.clock > 0) return;
  tally.p1 = game.p1.runner.bank;
  tally.p2 = game.p2.runner.bank;
  const decided = resolve(WIN_CONDITION, tally, TIME_UP);
  if (decided !== 'draw') {
    game.winner = decided;
    return;
  }
  const c1 = game.p1.runner.catches;
  const c2 = game.p2.runner.catches;
  game.winner = c1 === c2 ? 'draw' : c1 > c2 ? 'p1' : 'p2';
}

/** One fixed step. Deterministic, and allocates nothing. */
export function step(
  game: Game,
  dt: number,
  p1Command: Readonly<Command>,
  p2Command: Readonly<Command>,
): void {
  if (game.winner !== null) return;

  // Both runners move before anything is resolved, so no seat is advantaged by the order
  // this loop happens to visit them in. They can never contend for a coin — a coin is only
  // liftable by the seat that is away from home, and only one seat can be away in any one
  // vault — so the pickups above are order-independent by construction, and the catch
  // below is resolved once for the pair.
  driveSeat(game, 'p1', p1Command, dt);
  driveSeat(game, 'p2', p2Command, dt);
  settleCatch(game);
  settleDoor(game, 'p1');
  settleDoor(game, 'p2');
  restockVault(game, 'p1', dt);
  restockVault(game, 'p2', dt);

  game.clock = Math.max(0, game.clock - dt);
  judge(game);
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/* ------------------------------------------------------------------------------------ */
/* Geometry the bot and the tests share                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * The eight headings, in the **seat's own frame**, and the order is the tie-break.
 *
 * Written seat-relative and multiplied by {@link seatAxisSign} rather than chosen in board
 * coordinates, for the reason Snowball Throw's `dodgeSide` records: a preference expressed
 * in board coordinates is not covariant under the half-turn, so two mirrored boards break
 * an exact tie the same way instead of the opposite way, and one seat quietly plays a
 * better game. Index 0 is "toward the door", which is the same move for both players.
 *
 * A human's heading lands on exactly these nine vectors too — an anchored drag and the
 * movement keys both produce a per-axis sign, and a diagonal is normalised through the
 * same `Math.SQRT1_2` — so a bot cannot steer anywhere a player could not.
 */
const D = Math.SQRT1_2;
export const HEADINGS: readonly { readonly x: number; readonly y: number }[] = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: D, y: -D }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: D, y: D }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -D, y: D }),
  Object.freeze({ x: -1, y: 0 }),
  Object.freeze({ x: -D, y: -D }),
]);

/** How far past the door a runner aims when it is heading for safety. */
export const DOOR_MARGIN = RUNNER_RADIUS + 10;

/** Index of the loose coin nearest `(x, y)` in `vault`, or -1 when the vault is bare. */
export function nearestCoin(vault: readonly Coin[], x: number, y: number): number {
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < vault.length; i += 1) {
    const coin = vault[i] as Coin;
    if (!coin.active) continue;
    const gap = Math.hypot(coin.x - x, coin.y - y);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/**
 * The coin this runner is going for: the one it was already going for while that is still
 * on the floor, and otherwise the nearest.
 *
 * Sticky on purpose. Two coins nearly the same distance away make a bot that re-picks every
 * decision swerve between them and arrive at neither, and the faster it thinks the worse
 * that is — which is how `think` came out of its first sweep running *backwards*.
 */
export function pickCoin(vault: readonly Coin[], state: BotState, x: number, y: number): number {
  if (state.coin >= 0) {
    const held = vault[state.coin];
    if (held !== undefined && held.active) return state.coin;
  }
  state.coin = nearestCoin(vault, x, y);
  return state.coin;
}

/**
 * Whether a guard has a chase, given how far it is from the thief and how far the thief is
 * from the door.
 *
 * Both numbers are on the board and both players can see them, which is the point: this is
 * arithmetic a person does by eye, not a privilege. `slack` is the seconds of optimism the
 * caller grants itself; every tier passes {@link PURSUIT_SLACK}.
 */
export function canCatch(game: Readonly<Game>, seat: SeatId, slack: number): boolean {
  const me = runnerOf(game, seat);
  const foe = runnerOf(game, otherOf(seat));
  // How far the thief still has to run to reach the door, in its own frame. Negative
  // depth is exactly the distance past it, and it is the quantity the half-turn preserves.
  const toDoor = -ownDepth(otherOf(seat), foe.y);
  const escape = toDoor / THIEF_SPEED;
  const closing = Math.hypot(me.x - foe.x, me.y - foe.y) / GUARD_SPEED;
  return closing <= escape + slack;
}

/* ------------------------------------------------------------------------------------ */
/* The bot                                                                               */
/* ------------------------------------------------------------------------------------ */

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/**
 * Three knobs, and each of them is a different thing a person is better or worse at.
 *
 * Nothing here is information a player does not have. Both runners, every loose coin, and
 * how much loot each of them is carrying are all on the board and drawn — the carry as
 * pips over the runner's head, precisely so that judging whether a thief is worth chasing
 * is a skill and not a privilege. What a weaker tier is denied is attention, care and
 * nerve, never sight, and every heading it picks is one of the nine a player has.
 *
 * Two more knobs were built, swept, and deleted; SPEC.md carries the tables.
 */
export interface BotProfile {
  /**
   * Seconds between decisions. Between them it holds the heading it chose — which is why
   * a slower tier runs further on a stale plan, into a guard that has moved.
   *
   * Monotone over the range the ladder uses and **flat below it**: 59.4, 59.2, 52.8 and
   * 52.9 per cent won at 0.26, 0.18, 0.14 and 0.10 seconds, against 54.5, 29.3 and 3.5 at
   * 0.36, 0.50 and 0.75. Thinking faster than about a quarter of a second buys nothing
   * because the plan is not the thing that is wrong. SPEC.md carries the whole table and
   * the two knobs that were deleted for measuring flat and backwards.
   */
  readonly think: number;
  /**
   * How much clear floor a threatened thief will pay for, in units.
   *
   * The nerve knob: a careless runner walks past a guard and a careful one goes the long
   * way round. Monotone across its whole range — 49.7, 47.3, 51.0, 59.2, 72.4 and 76.0
   * per cent at 0, 40, 90, 180, 300 and 500 units, the one inversion a point and a half
   * inside a 3.5-point standard error.
   */
  readonly caution: number;
  /**
   * How many coins it will carry before it turns for the door.
   *
   * The strongest of the three and the most human: everything in your hands goes to the
   * guard that catches you, so the swing on a caught raid is **twice** what you were
   * holding. Strictly monotone and steep — 98.7, 87.4, 70.7, 59.2, 26.5, 10.5 and 0.0 per
   * cent at 1, 2, 3, 4, 6, 8 and 20 coins.
   */
  readonly greed: number;
}

/**
 * The three tiers.
 *
 * Every one of these is a strong knob on its own, and three strong knobs pulled apart by
 * intuition compound into a ladder nobody can climb, so the spread is deliberately narrow.
 * SPEC.md carries every sweep.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: Object.freeze({ think: 0.42, caution: 120, greed: 5 }),
  normal: Object.freeze({ think: 0.36, caution: 180, greed: 4 }),
  hard: Object.freeze({ think: 0.29, caution: 300, greed: 3 }),
});

/** How much the gap between decisions wanders, as a fraction. One draw. */
export const REACTION_WANDER = 0.25;

/**
 * The seconds of optimism a guard grants itself before it commits to a chase.
 *
 * **Not a difficulty knob — it was one, and the sweep deleted it.** Below about half a
 * second it is a real dial (8.8, 27.0, 54.6 and 68.9 per cent won at −1, −0.3, 0 and 0.25),
 * but every value a tier would plausibly hold is on a plateau: 73.6, 73.5, 75.3 and 75.3
 * per cent at 0.5, 1, 2 and 8 seconds, a spread inside its own 2.5-point standard error.
 * What is left is the shape of the game rather than a handicap — *chase what you can catch*
 * — and every tier uses it. See {@link canCatch} and SPEC.md.
 */
export const PURSUIT_SLACK = 0.5;

/**
 * How far ahead a heading is probed, in units.
 *
 * Fixed rather than derived from `think`, and that is a bug fix. Probing `speed * think`
 * made a slow bot look further ahead than a fast one, so `think` was measuring two
 * opposite things at once and its first sweep came out **backwards** — 49.6 per cent won
 * at 0.10 seconds against 61.4 at 0.26. Decoupling it, and making the coin target sticky,
 * is what made staleness monotone.
 */
export const LOOKAHEAD = 70;

/** Values a bot draws per decision. Always this many, always before anything branches. */
export const BOT_DRAWS_PER_DECISION = 1;

export interface BotState {
  cooldown: number;
  /** The heading it is running, in board coordinates. */
  wantX: number;
  wantY: number;
  /** Whether it is committed to a chase. */
  chasing: boolean;
  /** The coin it is going for, or -1. Sticky, so it does not swerve between two equal ones. */
  coin: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, wantX: 0, wantY: 0, chasing: false, coin: -1 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.wantX = 0;
  state.wantY = 0;
  state.chasing = false;
  state.coin = -1;
}

/**
 * Which of the eight headings to run, and it is the whole of the bot's plan.
 *
 * One decision covers both roles, because the roles are one predicate. Standing on its own
 * floor it is a guard and asks whether the chase is on; standing on the other one it is a
 * thief and asks whether it should still be there. Either way it ends up with a point to
 * head for and, if a guard is breathing on it, a distance it would like to keep.
 *
 * Every branch is covariant under the half-turn: the headings are seat-relative, every
 * comparison is between headings rather than against a board coordinate, the one
 * board-position test is {@link ownDepth}, and an exact tie keeps the lowest
 * **seat-relative** index.
 */
export function chooseHeading(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
): void {
  const me = runnerOf(game, seat);
  const foe = runnerOf(game, otherOf(seat));
  const sign = seatAxisSign(seat);
  const iAmHome = atHome(seat, me.y);
  const foeIsHome = atHome(otherOf(seat), foe.y);

  let targetX: number;
  let targetY: number;
  // A guard is a threat only when it is standing on the floor this runner is trespassing
  // on, which — since this runner is away and the foe is home — is the same statement.
  const threatened = !iAmHome && foeIsHome;

  if (iAmHome) {
    if (!foeIsHome) {
      if (!state.chasing) state.chasing = canCatch(game, seat, PURSUIT_SLACK);
    } else {
      state.chasing = false;
    }
    if (state.chasing) {
      state.coin = -1;
      targetX = foe.x;
      targetY = foe.y;
    } else {
      const vault = raidedVault(game, seat);
      const index = pickCoin(vault, state, me.x, me.y);
      if (index < 0) {
        // Nothing set out over there yet: go and wait by their door rather than at ours.
        targetX = homeX();
        targetY = homeY(otherOf(seat));
      } else {
        const coin = vault[index] as Coin;
        targetX = coin.x;
        targetY = coin.y;
      }
    }
  } else {
    state.chasing = false;
    const vault = raidedVault(game, seat);
    const full = me.carry >= profile.greed;
    const index = full ? -1 : pickCoin(vault, state, me.x, me.y);
    if (index < 0) {
      // Out through the **nearest** point of the door, not the middle of it. The door is
      // the whole width of the board, and running for the middle of it runs straight at
      // the guard, which is where it stands. Measured: fixing this took the share of
      // raids that end in a catch from 71% to under a half.
      state.coin = -1;
      targetX = me.x;
      targetY = CENTRE_Y + seatAxisSign(seat) * DOOR_MARGIN;
    } else {
      const coin = vault[index] as Coin;
      targetX = coin.x;
      targetY = coin.y;
    }
  }

  let bestScore = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < HEADINGS.length; i += 1) {
    const heading = HEADINGS[i] as { readonly x: number; readonly y: number };
    const px = clamp(me.x + heading.x * sign * LOOKAHEAD, minX(), maxX());
    const py = clamp(me.y + heading.y * sign * LOOKAHEAD, minY(), maxY());
    let score = -Math.hypot(px - targetX, py - targetY);
    if (threatened) {
      const gap = Math.hypot(px - foe.x, py - foe.y);
      score += gap < profile.caution ? gap : profile.caution;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  const chosen = HEADINGS[bestIndex] as { readonly x: number; readonly y: number };
  state.wantX = chosen.x * sign;
  state.wantY = chosen.y * sign;
}

/**
 * Decide where to run. Allocation-free; writes into `out`.
 *
 * A bot steers through the same nine headings a person gets and runs at the same two
 * speeds under the same rule, so it cannot go anywhere a player could not have gone.
 */
export function botStep(
  game: Readonly<Game>,
  seat: SeatId,
  profile: BotProfile,
  state: BotState,
  rng: Rng,
  dt: number,
  out: Command,
): void {
  state.cooldown -= dt;
  if (state.cooldown <= 0) {
    const jitter = rng.float();
    state.cooldown = profile.think * (1 + (jitter * 2 - 1) * REACTION_WANDER);
    chooseHeading(game, seat, profile, state);
  }
  out.dirX = state.wantX;
  out.dirY = state.wantY;
}

export function botCommand(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  dt: number,
  out: Command,
): void {
  botStep(game, seat, BOT_PROFILES[difficulty], state, rng, dt, out);
}
