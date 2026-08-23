import type { Rng, SeatId } from '@duelbox/engine';

/**
 * Tanks, as pure rules.
 *
 * One yard, two tanks, and a wall of crates that both of them are slowly knocking down.
 * A tank turns and rolls; its gun is bolted to the hull, so aiming and driving are the
 * same act. The gun loads by itself and goes off when you let go of the controls — or by
 * itself when it is full. A shell that reaches a tank costs it a life. First to take the
 * other's three lives wins.
 *
 * ## One arena, not two halves
 *
 * This is `rt-arena`: both players are in the same yard, shooting at each other, and every
 * crate is cover for whoever is behind it. That makes fairness a harder question than in a
 * split game, where each seat has its own field and the deal can simply be copied. Here the
 * only answer is **point symmetry**: the whole yard is generated so that a crate at
 * `(x, y)` implies a crate at `(ARENA - x, ARENA - y)` with the same size and the same
 * armour, and both spawn pads are mirror images through the centre with opposite headings.
 * Turn the board half a turn and it is the same board with the seats swapped, which is the
 * strongest statement of "neither start is better" available. Crates are dealt in pairs by
 * {@link mirrorX} and {@link mirrorY} rather than dealt and then checked, and the tests
 * measure the result anyway. **[ours]**
 *
 * No rendering, no timing, no DOM.
 */

/** The yard is square, so the same box works in either orientation. */
export const ARENA = 900;

export const TANK_RADIUS = 22;

/**
 * How fast a tank rolls, and the two numbers that make turning cost something.
 *
 * `TURN_DRAG` makes a swinging hull give up nearly half its speed, so lining a shot up and
 * getting away are the same resource spent twice. **Swept at 0, 0.2, 0.45 and 0.7 it moves
 * the bot ladder by less than the noise** — 83.3/77.6, 81.6/75.8, 81.1/78.3, 80.8/76.6 per
 * cent for normal-over-easy and hard-over-normal — and lengthens a match from 19.4 s to
 * 22.4 s. It is kept anyway, and the honest reason is that it is a decision for a *person*
 * that a bot has nothing to trade against: these bots never commit to a line, they turn when
 * they need to and roll when they do not. It is also the form of the speed rule that reads
 * only what the hull did rather than what was asked of it, which is what makes the two input
 * families provably identical rather than nearly so.
 *
 * `REVERSE_SPEED` is well under `DRIVE_SPEED` and that is load-bearing: the strongest thing
 * a tank can do is hold its distance (see `BotProfile.range`), and a reverse gear as quick
 * as the forward one would make backing away unanswerable.
 */
export const DRIVE_SPEED = 175;
export const REVERSE_SPEED = 105;
export const TURN_RATE = 2.4;
export const TURN_DRAG = 0.45;

/**
 * The shell, and why a snap shot barely leaves the barrel.
 *
 * Travel time is the point, and `SHELL_LIFE` being a fixed number of seconds rather than a
 * range is what turns the charge into reach as well as speed: a snap shot carries 109 units
 * and a full one 495, against a yard 900 across. **Nobody can shoot the length of the
 * yard**, which is what stops a match opening as a long-range exchange between the two pads.
 *
 * `SHELL_SLOW` began at 210 — a snap shot reaching 241 — and at that value the tier knob
 * that says how long a bot waits for a shell that will actually arrive **did nothing at
 * all**: 22.8 / 20.5 / 23.3 / 23.0 per cent across its whole range, which is noise. A snap
 * shot reaching 241 units is a usable weapon at the range these tanks fight at, so choosing
 * when to take one was not a choice. At 95 the same sweep reads 15.9 / 23.0 / 26.2, and the
 * solo measure with it: 11.5, 9.4, 9.0 seconds a life. **The knob was not weak; the game had
 * nothing for it to decide.** A snap shot is a knife now and a charged one is a rifle.
 */
export const SHELL_RADIUS = 7;
export const SHELL_SLOW = 95;
export const SHELL_FAST = 430;
export const SHELL_LIFE = 1.15;

/**
 * Shells in the air at once, both tanks together.
 *
 * A tank cannot fire faster than one shell per `RECOIL + LOAD_MIN` = 0.57 s and a shell
 * lives 1.15 s, so three of a tank's own can overlap and six in total is the arithmetic
 * ceiling. Measured over every match in the balance run the high-water mark is three. Ten is
 * that with room to spare, and a test asserts the pool is never exhausted rather than
 * leaving it as arithmetic in a comment.
 */
export const SHELL_SLOTS = 10;

/**
 * The gun: the shortest hold that fires, the hold at which it goes off by itself, and the
 * stall after a shot.
 *
 * **`RECOIL` is what makes the two input families equal, and it was added for that reason
 * rather than for feel.** The trigger is *letting go of the controls*, so a player has to
 * release and re-take them to fire deliberately — and a thumb leaving and returning to
 * glass takes appreciably longer than a finger lifting off a key. Locking the tank out for
 * 0.22 s after every shot hides that gap completely: neither instrument can do anything at
 * all during it, so the difference between them is no longer observable in the simulation.
 *
 * `LOAD_FULL` is the termination guarantee. The gun loads whether or not anybody is
 * driving, and fires itself when it is full, so a tank that is never touched still spends a
 * shell every `RECOIL + LOAD_FULL` = 1.47 s. See {@link SHELLS}.
 */
export const LOAD_MIN = 0.35;
export const LOAD_FULL = 1.25;
export const RECOIL = 0.22;

/**
 * Shells a tank is given for the whole match, and the reason the match must end.
 *
 * Termination here is structural in exactly the sense Broken Tiles' ice is: a finite
 * quantity that only ever decreases, whatever anybody does. Two tanks that are never
 * touched still cook off a shell each every 1.47 s, so a match nobody plays at all runs out
 * of ammunition and is decided on lives in a measured 52.2 s. No clock is involved and no
 * frame cap is doing the work — the tests run to completion without one.
 */
export const SHELLS = 34;
export const LIVES = 3;

/** Seconds of grace after a respawn, so a tank cannot be shot as it appears. */
export const SHIELD = 1;

/** Seconds of calm before the guns start loading. */
export const GRACE_SECONDS = 0.9;

/**
 * The crates, on a five-by-five lattice inside the yard.
 *
 * The lattice exists so point symmetry is exact rather than nearly exact: cell `i` mirrors
 * to cell `CELLS - 1 - i`, which is integer arithmetic, where mirroring a floating-point
 * position and comparing is not. `65 + 5 * 154 = 835`, leaving the same 65 units of clear
 * margin on both sides — and the pads live in that margin, so no crate can ever be dealt on
 * top of a tank.
 */
export const GRID = 5;
export const CELLS = GRID * GRID;
export const CELL = 154;
export const GRID_ORIGIN = 65;
export const CRATE = 84;
export const CRATE_HALF = CRATE / 2;

/**
 * How many shells a crate takes, and how many pairs are dealt.
 *
 * **The count is worth having and the armour is only pacing.** Sweeping the pairs from none
 * to twelve moves hard-over-normal from 74.0 to 81.0 per cent: cover is worth about seven
 * points to the better player, which is the clearest evidence that the yard is part of the
 * game rather than scenery. Sweeping the armour from 1 to 5 moves the same figure by less
 * than the noise (75.6, 78.3, 80.9, 80.2) and only stretches the match, from 20.6 s to
 * 28.9 s. Two, at seven pairs, leaves about eight of the fourteen standing at the end of a
 * typical match and keeps a match near the 22 s these tiers take.
 */
export const CRATE_ARMOUR = 2;
export const CRATE_PAIRS = 7;
export const CRATES = CRATE_PAIRS * 2;

/**
 * Where a tank starts, and where it comes back.
 *
 * Three pads, each stated once for seat one and mirrored through the centre for seat two, so
 * the set is point-symmetric by construction. They sit in the clear margin outside the crate
 * lattice, and pad 0 — the middle of seat one's own edge — is where both tanks open.
 *
 * The pad is **drawn** rather than fixed so that the tank that just scored cannot simply
 * keep its nose on the one place the other will appear. Measured, that is worth 78.3 per
 * cent hard-over-normal against 75.7 with a single pad — about one standard error, so it is
 * a design decision rather than a balance one, and it is stated that way rather than dressed
 * up. One draw per destruction, and when both tanks go at once they take the same index, so
 * no seat is ever handed the earlier value from the stream.
 */
export const PAD_X: readonly number[] = [450, 170, 730];
export const PAD_Y: readonly number[] = [852, 852, 852];
export const PADS = 3;

export type Phase = 'grace' | 'fighting' | 'over';

export interface Crate {
  x: number;
  y: number;
  armour: number;
}

export interface Shell {
  active: boolean;
  /** 0 for seat one, 1 for seat two. A shell never touches the tank that fired it. */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export interface Tank {
  x: number;
  y: number;
  /** Radians. The hull and the gun are the same thing; there is no turret. */
  heading: number;
  /** Movement actually applied last step, which is what a person watching would see. */
  vx: number;
  vy: number;
  /** Seconds of charge in the gun, 0 to {@link LOAD_FULL}. */
  load: number;
  /** Seconds of the post-shot stall left. Nothing can be asked of a tank during it. */
  recoil: number;
  /** Seconds of respawn grace left. */
  shield: number;
  shells: number;
  lives: number;
  /** Whether the controls were held on the previous step. The trigger is the falling edge. */
  ordered: boolean;
}

/**
 * One seat's order for this step: which way to swing, and whether to roll.
 *
 * **Both components are integers in {−1, 0, +1}, and that is the whole of rule 10 here.**
 * A key gives a direction and a thumb gives a drag, and both are reduced to this same pair
 * before anything in the simulation sees them, so there is no gesture either instrument can
 * make that the other cannot. `setIntent` is the only door in, and it takes the sign of
 * whatever it is handed rather than trusting the caller.
 */
export interface Intent {
  turn: number;
  throttle: number;
}

export interface Game {
  readonly crates: Crate[];
  readonly shells: Shell[];
  readonly p1: Tank;
  readonly p2: Tank;
  readonly p1Intent: Intent;
  readonly p2Intent: Intent;
  phase: Phase;
  elapsed: number;
  hold: number;
  winner: SeatId | 'draw' | null;
}

const SEATS: readonly SeatId[] = ['p1', 'p2'];

/** A point turned half a turn about the centre of the yard. */
export function mirrorX(x: number): number {
  return ARENA - x;
}

export function mirrorY(y: number): number {
  return ARENA - y;
}

function makeTank(): Tank {
  return {
    x: 0,
    y: 0,
    heading: 0,
    vx: 0,
    vy: 0,
    load: 0,
    recoil: 0,
    shield: 0,
    shells: SHELLS,
    lives: LIVES,
    ordered: false,
  };
}

export function createGame(): Game {
  const crates: Crate[] = [];
  for (let i = 0; i < CRATES; i += 1) crates.push({ x: 0, y: 0, armour: 0 });
  const shells: Shell[] = [];
  for (let i = 0; i < SHELL_SLOTS; i += 1)
    shells.push({ active: false, owner: 0, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  return {
    crates,
    shells,
    p1: makeTank(),
    p2: makeTank(),
    p1Intent: { turn: 0, throttle: 0 },
    p2Intent: { turn: 0, throttle: 0 },
    phase: 'grace',
    elapsed: 0,
    hold: GRACE_SECONDS,
    winner: null,
  };
}

export function tankOf(game: Readonly<Game>, seat: SeatId): Tank {
  return seat === 'p1' ? game.p1 : game.p2;
}

export function intentOf(game: Readonly<Game>, seat: SeatId): Intent {
  return seat === 'p1' ? game.p1Intent : game.p2Intent;
}

export function otherOf(seat: SeatId): SeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

export function winnerOf(game: Readonly<Game>): SeatId | 'draw' | null {
  return game.winner;
}

/** The centre of lattice cell `i`, in yard units. */
export function cellX(index: number): number {
  return GRID_ORIGIN + (index % GRID) * CELL + CELL / 2;
}

export function cellY(index: number): number {
  return GRID_ORIGIN + Math.floor(index / GRID) * CELL + CELL / 2;
}

/**
 * Deal the yard: seven cells drawn from the twelve before the centre, each with its mirror.
 *
 * The centre cell is left clear whatever happens. It is its own mirror, so putting a crate
 * there would be symmetric — but it is also the one square both tanks have to cross to
 * reach each other, and blocking it turned every match into two tanks circling the same
 * obstacle in the same direction and never meeting.
 *
 * Exactly eleven draws, always — one shuffle of the twelve candidate cells — and they are
 * the first thing the world's generator is asked for. Nothing about how the match is played
 * can move them.
 */
function dealCrates(game: Game, rng: Rng): void {
  const order: number[] = [];
  const half = (CELLS - 1) / 2;
  for (let i = 0; i < half; i += 1) order.push(i);
  // Fisher-Yates with a plain float draw rather than `Rng.int`, whose rejection sampling
  // draws a variable number of values. Nothing depends on the count here — the deal is over
  // before anything else touches the stream — but a variable count is the shape of bug this
  // repo keeps finding, so it is not written even where it would be harmless.
  for (let i = half - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.float() * (i + 1));
    const held = order[i] as number;
    order[i] = order[j] as number;
    order[j] = held;
  }
  for (let i = 0; i < CRATE_PAIRS; i += 1) {
    const cell = order[i] as number;
    const near = game.crates[i * 2] as Crate;
    const far = game.crates[i * 2 + 1] as Crate;
    write(near, cellX(cell), cellY(cell));
    write(far, mirrorX(cellX(cell)), mirrorY(cellY(cell)));
  }
}

function write(crate: Crate, x: number, y: number): void {
  crate.x = x;
  crate.y = y;
  crate.armour = CRATE_ARMOUR;
}

/** Where a seat's tank starts or returns, for pad `index`. Seat two's is the mirror. */
export function padXOf(seat: SeatId, index: number): number {
  const x = PAD_X[index] as number;
  return seat === 'p1' ? x : mirrorX(x);
}

export function padYOf(seat: SeatId, index: number): number {
  const y = PAD_Y[index] as number;
  return seat === 'p1' ? y : mirrorY(y);
}

/** Facing into the yard from the pad: seat one looks up the board, seat two down it. */
export function padHeadingOf(seat: SeatId): number {
  return seat === 'p1' ? -Math.PI / 2 : Math.PI / 2;
}

function placeTank(tank: Tank, seat: SeatId, pad: number): void {
  tank.x = padXOf(seat, pad);
  tank.y = padYOf(seat, pad);
  tank.heading = padHeadingOf(seat);
  tank.vx = 0;
  tank.vy = 0;
  tank.load = 0;
  tank.recoil = 0;
  tank.ordered = false;
}

export function resetGame(game: Game, rng: Rng): void {
  dealCrates(game, rng);
  for (const shell of game.shells) shell.active = false;
  for (const seat of SEATS) {
    const tank = tankOf(game, seat);
    placeTank(tank, seat, 0);
    tank.shield = 0;
    tank.shells = SHELLS;
    tank.lives = LIVES;
  }
  game.p1Intent.turn = 0;
  game.p1Intent.throttle = 0;
  game.p2Intent.turn = 0;
  game.p2Intent.throttle = 0;
  game.phase = 'grace';
  game.elapsed = 0;
  game.hold = GRACE_SECONDS;
  game.winner = null;
}

/**
 * The one door input comes through.
 *
 * Takes the sign of each component, so a key held down and a thumb dragged four hundred
 * units both arrive as 1. A gesture cannot be finer than this and neither can a keystroke,
 * which is what makes the parity test in `game.test.ts` an equality rather than a tolerance.
 */
export function setIntent(game: Game, seat: SeatId, turn: number, throttle: number): void {
  const intent = intentOf(game, seat);
  intent.turn = Math.sign(turn);
  intent.throttle = Math.sign(throttle);
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Shortest signed angle from `from` to `to`, in (−π, π]. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** The speed of the shell a gun holding `load` seconds would fire. */
export function shellSpeedFor(load: number): number {
  const power = clamp((load - LOAD_MIN) / (LOAD_FULL - LOAD_MIN), 0, 1);
  return SHELL_SLOW + (SHELL_FAST - SHELL_SLOW) * power;
}

/** How far a shell fired at that load would carry. */
export function reachFor(load: number): number {
  return shellSpeedFor(load) * SHELL_LIFE;
}

/** The shortest hold whose shell still carries `distance`, or Infinity if none does. */
export function loadToReach(distance: number): number {
  const speed = distance / SHELL_LIFE;
  if (speed <= SHELL_SLOW) return LOAD_MIN;
  if (speed > SHELL_FAST) return Infinity;
  return LOAD_MIN + ((speed - SHELL_SLOW) / (SHELL_FAST - SHELL_SLOW)) * (LOAD_FULL - LOAD_MIN);
}

/** Push a circle out of an axis-aligned crate along whichever side it is nearest. */
function shove(tank: Tank, crate: Readonly<Crate>): void {
  const dx = tank.x - crate.x;
  const dy = tank.y - crate.y;
  const overlapX = CRATE_HALF + TANK_RADIUS - Math.abs(dx);
  const overlapY = CRATE_HALF + TANK_RADIUS - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return;
  if (overlapX < overlapY) tank.x += dx >= 0 ? overlapX : -overlapX;
  else tank.y += dy >= 0 ? overlapY : -overlapY;
}

function hitsCrate(crate: Readonly<Crate>, x: number, y: number, radius: number): boolean {
  const nearestX = clamp(x, crate.x - CRATE_HALF, crate.x + CRATE_HALF);
  const nearestY = clamp(y, crate.y - CRATE_HALF, crate.y + CRATE_HALF);
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

/**
 * Roll one tank, and work out whether its gun goes off this step.
 *
 * Order matters and is stated here once: **the trigger is the falling edge of the
 * controls.** A tank that is being driven is loading; the step on which its order goes away
 * is the step it fires, provided the gun has at least `LOAD_MIN` in it. A gun that reaches
 * `LOAD_FULL` fires whatever anybody is doing, which is both the tension in the game and
 * the reason the match is guaranteed to end.
 */
function rollTank(game: Game, seat: SeatId, dt: number): boolean {
  const tank = tankOf(game, seat);
  const intent = intentOf(game, seat);
  if (tank.shield > 0) tank.shield = Math.max(0, tank.shield - dt);
  if (tank.recoil > 0) {
    tank.recoil = Math.max(0, tank.recoil - dt);
    tank.vx = 0;
    tank.vy = 0;
    // A tank cannot be *holding* the controls while it is stalled, so the step it comes
    // back is a fresh press rather than an edge that fires the moment it is free.
    tank.ordered = false;
    return false;
  }

  const held = intent.turn !== 0 || intent.throttle !== 0;
  const released = tank.ordered && !held;
  tank.load += dt;
  const fires = tank.load >= LOAD_FULL || (released && tank.load >= LOAD_MIN);
  tank.ordered = held;

  if (intent.turn !== 0) tank.heading += intent.turn * TURN_RATE * dt;
  // Speed is a function of what the hull is doing, never of what was asked for. A thumb
  // that flicks and a key that is held both put the hull at full rate, so both pay the
  // same. Reading the *order* here instead would have charged the two instruments
  // differently for the same manoeuvre.
  const turning = intent.turn === 0 ? 0 : 1;
  const base = intent.throttle > 0 ? DRIVE_SPEED : intent.throttle < 0 ? -REVERSE_SPEED : 0;
  const speed = base * (1 - TURN_DRAG * turning);
  tank.vx = Math.cos(tank.heading) * speed;
  tank.vy = Math.sin(tank.heading) * speed;
  tank.x = clamp(tank.x + tank.vx * dt, TANK_RADIUS, ARENA - TANK_RADIUS);
  tank.y = clamp(tank.y + tank.vy * dt, TANK_RADIUS, ARENA - TANK_RADIUS);
  for (const crate of game.crates) {
    if (crate.armour > 0) shove(tank, crate);
  }
  tank.x = clamp(tank.x, TANK_RADIUS, ARENA - TANK_RADIUS);
  tank.y = clamp(tank.y, TANK_RADIUS, ARENA - TANK_RADIUS);
  return fires;
}

/**
 * Two hulls cannot occupy the same ground, and both are pushed the same distance.
 *
 * Splitting the overlap evenly rather than moving whichever tank was stepped second is what
 * keeps the seat order out of the simulation: reversing the two calls in {@link step}
 * leaves the positions bit-identical.
 */
function separate(game: Game): void {
  const a = game.p1;
  const b = game.p2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const gap = Math.hypot(dx, dy);
  const want = TANK_RADIUS * 2;
  if (gap >= want) return;
  // Exactly on top of each other: push apart along the board's own axis rather than
  // dividing by zero. Both tanks start on mirrored pads so this is reachable only after a
  // simultaneous respawn onto the same pad.
  const nx = gap === 0 ? 0 : dx / gap;
  const ny = gap === 0 ? 1 : dy / gap;
  const push = (want - gap) / 2;
  a.x = clamp(a.x - nx * push, TANK_RADIUS, ARENA - TANK_RADIUS);
  a.y = clamp(a.y - ny * push, TANK_RADIUS, ARENA - TANK_RADIUS);
  b.x = clamp(b.x + nx * push, TANK_RADIUS, ARENA - TANK_RADIUS);
  b.y = clamp(b.y + ny * push, TANK_RADIUS, ARENA - TANK_RADIUS);
}

function fire(game: Game, seat: SeatId): boolean {
  const tank = tankOf(game, seat);
  tank.recoil = RECOIL;
  const load = tank.load;
  tank.load = 0;
  // The shell is spent whether or not there is a slot for it. The pool cannot actually
  // fill — see SHELL_SLOTS — but "the gun always costs a shell" is what the termination
  // argument rests on, and it must not have an exception hiding in it.
  if (tank.shells <= 0) return false;
  tank.shells -= 1;
  let slot = -1;
  for (let i = 0; i < game.shells.length; i += 1) {
    if (!(game.shells[i] as Shell).active) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return false;
  const shell = game.shells[slot] as Shell;
  const speed = shellSpeedFor(load);
  const muzzle = TANK_RADIUS + SHELL_RADIUS + 1;
  shell.active = true;
  shell.owner = seat === 'p1' ? 0 : 1;
  shell.x = tank.x + Math.cos(tank.heading) * muzzle;
  shell.y = tank.y + Math.sin(tank.heading) * muzzle;
  shell.vx = Math.cos(tank.heading) * speed;
  shell.vy = Math.sin(tank.heading) * speed;
  shell.life = SHELL_LIFE;
  return true;
}

export interface StepResult {
  /** Seats that fired this step. */
  readonly fired: readonly SeatId[];
  /** Seats that lost a life this step. */
  readonly struck: readonly SeatId[];
  /** True when a crate was broken open this step. */
  crateBroken: boolean;
}

const firedScratch: SeatId[] = [];
const struckScratch: SeatId[] = [];
const result: StepResult = { fired: firedScratch, struck: struckScratch, crateBroken: false };
const hitScratch = [false, false];

/**
 * One fixed step. Intents are written by the caller first, through {@link setIntent}.
 *
 * The seat order inside is p1 then p2 and it is not observable: movement is separated
 * symmetrically, hits are collected against the positions every shell already had and
 * applied together, and a respawn that catches both tanks takes one draw shared between
 * them.
 */
export function step(game: Game, dt: number, rng: Rng): StepResult {
  firedScratch.length = 0;
  struckScratch.length = 0;
  result.crateBroken = false;
  if (game.phase === 'over') return result;

  if (game.phase === 'grace') {
    game.hold -= dt;
    if (game.hold <= 0) game.phase = 'fighting';
    return result;
  }

  game.elapsed += dt;

  for (const seat of SEATS) {
    if (rollTank(game, seat, dt)) firedScratch.push(seat);
  }
  separate(game);
  for (const seat of firedScratch) fire(game, seat);

  hitScratch.fill(false);
  for (const shell of game.shells) {
    if (!shell.active) continue;
    shell.x += shell.vx * dt;
    shell.y += shell.vy * dt;
    shell.life -= dt;
    if (shell.life <= 0 || shell.x < 0 || shell.x > ARENA || shell.y < 0 || shell.y > ARENA) {
      shell.active = false;
      continue;
    }
    let stopped = false;
    for (const crate of game.crates) {
      if (crate.armour <= 0) continue;
      if (!hitsCrate(crate, shell.x, shell.y, SHELL_RADIUS)) continue;
      crate.armour -= 1;
      if (crate.armour <= 0) result.crateBroken = true;
      stopped = true;
      break;
    }
    if (stopped) {
      shell.active = false;
      continue;
    }
    for (let i = 0; i < SEATS.length; i += 1) {
      if (shell.owner === i) continue;
      const target = tankOf(game, SEATS[i] as SeatId);
      if (target.shield > 0) continue;
      if (Math.hypot(target.x - shell.x, target.y - shell.y) > TANK_RADIUS + SHELL_RADIUS) continue;
      hitScratch[i] = true;
      shell.active = false;
      break;
    }
  }

  if (hitScratch[0] || hitScratch[1]) {
    // One draw for the whole batch. Two draws would hand seat one the earlier value every
    // time both tanks went together, which is the same arithmetic bias a shared generator
    // produces and just as measurable.
    const pad = Math.floor(rng.float() * PADS);
    for (let i = 0; i < SEATS.length; i += 1) {
      if (!hitScratch[i]) continue;
      const seat = SEATS[i] as SeatId;
      const tank = tankOf(game, seat);
      tank.lives -= 1;
      placeTank(tank, seat, pad);
      tank.shield = SHIELD;
      struckScratch.push(seat);
    }
  }

  finishIfDecided(game);
  return result;
}

function anyShellFlying(game: Readonly<Game>): boolean {
  for (const shell of game.shells) if (shell.active) return true;
  return false;
}

function finishIfDecided(game: Game): void {
  if (game.p1.lives <= 0 || game.p2.lives <= 0) {
    game.phase = 'over';
    game.winner =
      game.p1.lives === game.p2.lives ? 'draw' : game.p1.lives > game.p2.lives ? 'p1' : 'p2';
    return;
  }
  // Both guns dry and nothing still in the air: nobody can take another life, so the match
  // is over on lives. This is the branch the termination argument lands in when neither
  // player ever hits the other.
  if (game.p1.shells > 0 || game.p2.shells > 0 || anyShellFlying(game)) return;
  game.phase = 'over';
  game.winner =
    game.p1.lives === game.p2.lives ? 'draw' : game.p1.lives > game.p2.lives ? 'p1' : 'p2';
}

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface BotProfile {
  /**
   * Seconds between decisions; between them it holds the order it last gave.
   *
   * Monotone across the whole tier range and past it — swept alone at 0.06, 0.1, 0.15, 0.22,
   * 0.28, 0.4 and 0.6 it reads 37.3, 33.0, 25.5, 15.0, 13.9, 10.0 and 4.0 per cent against a
   * fixed opponent. It **stops paying below 0.06**: at 0.03 the solo cost is 8.26 seconds a
   * life against 8.05 at 0.06, because re-drawing the aim wander five times a second means
   * never settling on a bearing. `hard` sits at 0.07 rather than lower for that reason.
   */
  readonly reaction: number;
  /**
   * How far off the middle of the other tank it swings, in radians.
   *
   * **Every tier's value is above the cone the bot already fires inside, and that is not
   * decoration.** A wander smaller than {@link FIRE_CONE} disappears into the tolerance the
   * fire gate already has, and the knob is simply dead there — the mistake Star Catcher's
   * `aim` made for two of its three tiers while reading in the source as the main difficulty
   * axis. Swept, it is flat below the cone and steep above it: 0, 0.02, 0.04 and 0.06 all
   * measure 6.0 to 6.6 seconds a life, and from 0.09 up it is 7.5, 8.1, 9.2, 10.5, 12.4. A
   * test enforces the floor.
   */
  readonly aim: number;
  /**
   * The distance it tries to hold from the other tank, in yard units.
   *
   * **The strongest of the three, and its sign was backwards for a whole afternoon.** A
   * tank that closes in seemed obviously the stronger player — it is inside its own snap
   * shot's 109-unit reach, where a shell cannot be dodged. It measured 24.8 per cent
   * against a tier holding 300, and a tier hanging back at 470 measured 76.0. Standing off
   * is better because a shell only carries 495 units at best: from 420 you can be reached
   * and hit only by a fully charged shot, and the tank that charges in arrives inside
   * everybody's reach with an empty gun. **A beginner drives at the other tank; that is
   * exactly what makes them a beginner.**
   */
  readonly range: number;
}

/**
 * Three tiers on three axes. Five more were written and measured, and all five are gone.
 *
 * Each surviving axis was swept **alone**, with every other knob flattened to `normal`'s
 * value so the three tiers differed in one number and nothing else. All three order the
 * tiers on both steps: reaction 67.4 / 63.2, aim 65.3 / 62.2, range 60.1 / 59.5 per cent for
 * normal-over-easy and hard-over-normal, against 81.6 / 78.6 with all three together.
 *
 * What was deleted, and why, because a dead knob is source that lies:
 *
 * - **`screen`** — how wide a berth a crate on the firing line had to earn before a tier
 *   held fire. Swept at 0, 0.3, 0.6, 1 and 1.4 under three cover densities without leaving
 *   the noise. Applied to every tier at once it changed the ladder by under a point and left
 *   `hard`'s cost identical to two decimals — **4.18 shots a life either way**, which is the
 *   giveaway: a firing solution inside a 0.09-radian cone and a crate on the same line
 *   almost never coincide, so the knob practically never fired.
 * - **`dodge`** — steering out of the way of a shell already in the air, which is the most
 *   obviously good behaviour in the whole file. It measured **backwards**: 40.9, 22.3, 17.8
 *   per cent for the three ladder cells, and it pulled the complete ladder down from
 *   92 / 96 to 73 / 64. A shell you break off to avoid costs a shot and a manoeuvre, and a
 *   tank that keeps stepping sideways never finishes anybody.
 * - **`lead`** and **`discipline`**, which are still in the file as constants — see
 *   {@link LEAD_FRACTION}.
 *
 * Nothing in what remains is hidden from a player: every tank, crate and shell is on the
 * screen, moves in a straight line, and is drawn at the size the rules use.
 */
export const BOT_PROFILES: Readonly<Record<BotDifficulty, BotProfile>> = Object.freeze({
  easy: { reaction: 0.26, aim: 0.38, range: 210 },
  normal: { reaction: 0.15, aim: 0.24, range: 300 },
  hard: { reaction: 0.07, aim: 0.16, range: 390 },
});

/**
 * How far a bot's reaction wanders, and how many values it draws to do it.
 *
 * **Two identical bots open on mirrored pads facing each other**, so without a wander they
 * give mirrored orders for ever. Measured, and it is as absolute as it sounds: with both
 * wanders switched off **every match at every tier is a draw, 400 out of 400 three times
 * over**. Either one alone is enough to break it — the reaction wander alone leaves 0.0 to
 * 0.3 per cent draws, the aim wander alone the same — and with both, 0.0 per cent, at
 * 50.2 / 50.0 / 52.3 per cent to seat one. The wander is in *when* a tank looks and *where
 * on the target* it swings, which is what separates two people of the same ability, and both
 * are one unconditional draw each.
 */
export const REACTION_WANDER = 0.35;

/**
 * Values a bot draws per decision. Always exactly this many, drawn before any branch.
 *
 * The count is constant because a seat whose draws depended on what it saw would shift the
 * other seat's stream — the seat bias made of arithmetic that Fruit Duel was caught by. It
 * is not enough on its own, which is why each seat also has a generator of its own; see
 * `TanksGame`.
 */
export const BOT_DRAWS_PER_DECISION = 2;

export interface BotState {
  cooldown: number;
  turn: number;
  throttle: number;
}

export function createBotState(): BotState {
  return { cooldown: 0, turn: 0, throttle: 0 };
}

export function resetBotState(state: BotState): void {
  state.cooldown = 0;
  state.turn = 0;
  state.throttle = 0;
}

/** Within this of the target bearing a bot will take the shot. */
export const FIRE_CONE = 0.09;

/**
 * Two behaviours every tier shares, because both were swept as difficulty axes and neither
 * could order three tiers. They are constants rather than knobs so the source stops
 * claiming a difference that is not there.
 *
 * **`LEAD_FRACTION` — how much of the real intercept time a bot accounts for when it leads a
 * moving tank.** Swept on a flat profile at 0, 0.3, 0.6, 1 and 1.5 over 2400 decided matches
 * a point: 50.9, 50.0, 51.9, 53.0, 50.1 per cent. Flat. It is not that leading does not
 * work — pin the aim wander at 0.06 radians and the same sweep reads 40.8, 50.0, 56.2, 55.2,
 * 47.1, which is a fifteen-point axis. It is that **every tier's own aim wander is several
 * times larger than the correction**, so the lead disappears into it. Kept at 0.6 because it
 * is the right behaviour and a bot that does not lead looks broken to a person who does.
 *
 * **`SHOT_DISCIPLINE` — how much of the load needed to actually reach the target a bot waits
 * for.** Swept at 0, 0.25, 0.5, 0.75, 1: 41.4, 49.3, 51.9, 50.9, 50.4. It separates exactly
 * one thing — whether the tier fires shells that fall short — and is flat everywhere above
 * a quarter, so it can distinguish two kinds of player and not three.
 */
export const LEAD_FRACTION = 0.6;
export const SHOT_DISCIPLINE = 0.6;

/**
 * What a bot asks its tank to do this step.
 *
 * The output is an {@link Intent}, which is the same pair of signs a person's keys or thumb
 * produce, and it goes through {@link setIntent} exactly as theirs does — so no bot turns
 * faster, rolls faster or fires sooner than a person can (rule 6). Firing is not a separate
 * output: a bot fires by *letting go*, which is the only way anybody fires.
 */
export function botIntent(
  game: Readonly<Game>,
  seat: SeatId,
  difficulty: BotDifficulty,
  state: BotState,
  rng: Rng,
  dt: number,
  out: Intent,
): void {
  state.cooldown -= dt;
  if (state.cooldown > 0) {
    out.turn = state.turn;
    out.throttle = state.throttle;
    return;
  }
  // Both drawn before any branch on what it sees, so the count is constant.
  const wanderRoll = rng.float();
  const aimRoll = rng.float();
  const profile = BOT_PROFILES[difficulty];
  state.cooldown = profile.reaction * (1 + (wanderRoll * 2 - 1) * REACTION_WANDER);

  const me = tankOf(game, seat);
  const foe = tankOf(game, otherOf(seat));
  const flat = Math.hypot(foe.x - me.x, foe.y - me.y);
  // Lead the target by how long the shell it is holding would actually take to get there.
  const flight = flat / shellSpeedFor(me.load);
  const aimX = foe.x + foe.vx * flight * LEAD_FRACTION;
  const aimY = foe.y + foe.vy * flight * LEAD_FRACTION;
  const range = Math.hypot(aimX - me.x, aimY - me.y);
  const bearing = Math.atan2(aimY - me.y, aimX - me.x) + (aimRoll * 2 - 1) * profile.aim;
  const off = angleDelta(me.heading, bearing);

  const wanted = loadToReach(range);
  const ready = me.load >= LOAD_MIN + (Math.min(wanted, LOAD_FULL) - LOAD_MIN) * SHOT_DISCIPLINE;
  if (ready && Math.abs(off) < FIRE_CONE && me.recoil <= 0) {
    // Let go: that is the trigger, for a bot exactly as for a person.
    state.turn = 0;
    state.throttle = 0;
    out.turn = 0;
    out.throttle = 0;
    return;
  }

  const turn = Math.abs(off) > FIRE_CONE / 2 ? Math.sign(off) : 0;
  // Never idle when it is not shooting: an order held is what keeps the gun from going off
  // at a moment it did not choose. A person holds their thumb down for the same reason.
  const throttle = range > profile.range ? 1 : -1;
  state.turn = turn;
  state.throttle = throttle;
  out.turn = turn;
  out.throttle = throttle;
}
