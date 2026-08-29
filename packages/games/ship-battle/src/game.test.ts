import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, InputManager, InputView, Rng, vec2 } from '@duelbox/engine';
import type { SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import {
  AIM_SECONDS,
  FLIGHT_SECONDS,
  HULL_CELL,
  HULL_HEIGHT,
  HULL_ORIGIN_X,
  HULL_ORIGIN_Y,
  HULL_WIDTH,
  REVEAL_SECONDS,
  SETTLE_SECONDS,
  ShipBattleGame,
  hullCellAt,
} from './game.js';
import {
  HULL_CELLS,
  RECHARGE_TURNS,
  SHIELD_START_X,
  SHIELD_START_Y,
  cellAt,
  cellCentreX,
  cellCentreY,
  coverX,
  coverY,
  shieldCovers,
} from './rules.js';
import type { BotDifficulty, Phase, Ship } from './rules.js';

const STEP = 1 / 60;
/** Four minutes at sixty steps: past the manifest's own round length by a wide margin. */
const MATCH_STEPS = 60 * 240;

/* ------------------------------------------------------------------ harness */

interface MutableSeatInput {
  move: Vec2;
  pointer: Vec2 | null;
  actionPressed: boolean;
  actionHeld: boolean;
  actionReleased: boolean;
  holdSeconds: number;
  holdSecondsAtRelease: number;
}

function blankSeat(): MutableSeatInput {
  return {
    move: vec2(),
    pointer: null,
    actionPressed: false,
    actionHeld: false,
    actionReleased: false,
    holdSeconds: 0,
    holdSecondsAtRelease: 0,
  };
}

/**
 * Input stated directly, for the tests that care about what a game does with a value
 * rather than about how the engine produced it. The tests that check the manifest's
 * control strings use {@link Rig} and real key codes instead.
 */
class ScriptedInput implements InputState {
  readonly #p1 = blankSeat();
  readonly #p2 = blankSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }

  point(seat: SeatId, x: number, y: number): void {
    const target = this.#of(seat);
    target.pointer = target.pointer ?? vec2();
    target.pointer.x = x;
    target.pointer.y = y;
  }

  release(seat: SeatId, released: boolean): void {
    this.#of(seat).actionReleased = released;
  }

  #of(seat: SeatId): MutableSeatInput {
    return seat === 'p1' ? this.#p1 : this.#p2;
  }
}

/**
 * State a position directly.
 *
 * Through a function rather than by assigning the field, so the compiler does not narrow
 * `phase` and `attacker` to the literal that was written and then report every later
 * comparison as dead — the simulation changes both of them, and a test that could not ask
 * what they are now would be asserting nothing.
 */
function setPhase(game: ShipBattleGame, phase: Phase): void {
  game.position.phase = phase;
}

function setAttacker(game: ShipBattleGame, seat: SeatId): void {
  game.position.attacker = seat;
}

/** A silent pair of humans: nobody touches anything for the whole match. */
const IDLE = new ScriptedInput();

function makeContext(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
  presentation: 'shared-screen' | 'single-seat' = 'shared-screen',
  localSeat: SeatId = 'p1',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat: 'p1',
    botDifficulty(seat: SeatId): BotDifficulty | null {
      return seat === 'p1' ? botP1 : botP2;
    },
  };
}

function started(
  seed: number,
  botP1: BotDifficulty | null = null,
  botP2: BotDifficulty | null = null,
): ShipBattleGame {
  const game = new ShipBattleGame();
  game.init(makeContext(seed, botP1, botP2));
  return game;
}

/** Run until somebody wins, or give up. Returns the winner, or null if it never ended. */
function playOut(
  game: ShipBattleGame,
  input: InputState = IDLE,
  limit = MATCH_STEPS,
): SeatId | 'draw' | null {
  for (let step = 0; step < limit; step += 1) {
    game.update(STEP, input);
    const { winner } = game.getScore();
    if (winner !== null) return winner;
  }
  return null;
}

type DrawArg = number | string | boolean | undefined;

interface DrawCall {
  readonly op: string;
  readonly args: readonly DrawArg[];
}

class RecordingRenderer implements Renderer {
  readonly calls: DrawCall[] = [];

  get ops(): string[] {
    return this.calls.map((call) => call.op);
  }

  texts(): string[] {
    return this.calls
      .filter((call) => call.op === 'text')
      .map((call) => String(call.args[0] ?? ''));
  }

  clear(colour: string): void {
    this.#record('clear', colour);
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#record('rect', x, y, width, height, colour);
  }
  strokeRect(x: number, y: number, w: number, h: number, lw: number, colour: string): void {
    this.#record('strokeRect', x, y, w, h, lw, colour);
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#record('circle', x, y, radius, colour);
  }
  strokeCircle(x: number, y: number, r: number, lw: number, colour: string): void {
    this.#record('strokeCircle', x, y, r, lw, colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lw: number, colour: string): void {
    this.#record('line', x1, y1, x2, y2, lw, colour);
  }
  text(v: string, x: number, y: number, size: number, colour: string, align?: TextAlign): void {
    this.#record('text', v, x, y, size, colour, align);
  }
  pushSeatRotation(rotated: boolean): void {
    this.#record('pushSeatRotation', rotated);
  }
  pushRotation(radians: number): void {
    this.#record('pushRotation', radians);
  }
  popSeatRotation(): void {
    this.#record('popSeatRotation');
  }

  #record(op: string, ...values: DrawArg[]): void {
    this.calls.push({ op, args: values });
  }
}

/**
 * A rolling hash of everything a match draws.
 *
 * Determinism is a claim about the whole simulation, and the score alone is far too coarse
 * to see it: two matches can score the same and have the plate in different places on every
 * step. Every position, radius and line width goes through the renderer, so hashing the
 * draw calls sees any divergence at all — and it stays inside the `Game` contract.
 */
function trace(game: ShipBattleGame, steps: number, input: InputState = IDLE): string {
  let hash = 2166136261;
  const record = (...args: unknown[]): void => {
    for (const arg of args) {
      if (typeof arg !== 'number') continue;
      hash ^= Math.round(arg * 1000) | 0;
      hash = Math.imul(hash, 16777619);
    }
  };
  const noop = (): void => undefined;
  const renderer: Renderer = {
    clear: noop,
    rect: record,
    strokeRect: record,
    circle: record,
    strokeCircle: record,
    line: record,
    text: (value: string, x: number, y: number, sizePx: number) => {
      record(x, y, sizePx);
      hash ^= value.length;
      hash = Math.imul(hash, 16777619);
    },
    pushSeatRotation: noop,
    pushRotation: record,
    popSeatRotation: noop,
  };
  const seen: string[] = [];
  for (let step = 0; step < steps; step += 1) {
    game.update(STEP, input);
    game.render(renderer, 0);
    if (step % 30 === 0) {
      const score = game.getScore();
      seen.push(`${String(score.p1)}:${String(score.p2)}:${String(hash >>> 0)}`);
    }
    if (game.getScore().winner !== null) break;
  }
  return seen.join('|');
}

/**
 * A game driven through the real `InputManager`, with the key codes and pointer events a
 * browser would deliver.
 *
 * The manifest's control strings are a promise to a player. Checking them against a hand
 * written `SeatInput` proves only that the game reads *some* seat's move vector; checking
 * them through the engine's own binding table proves the promise — that Space is seat one's
 * trigger and Enter is seat two's, and that no other key is.
 */
class Rig {
  readonly game = new ShipBattleGame();
  readonly input: InputManager;
  readonly #view = new InputView();

  constructor(context: GameContext) {
    this.game.init(context);
    this.input = new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' });
  }

  step(count = 1): void {
    for (let i = 0; i < count; i += 1) {
      // What the host does every step for a shared board: the surface belongs to whoever
      // is to move, and in this game that changes twice a turn.
      this.input.setBoardSeat(this.game.getActiveSeat());
      this.game.update(STEP, this.#view.sync(this.input.beginStep(STEP)));
    }
  }

  /** Step until the given phase is reached, so a test never depends on the shot clock. */
  stepUntil(predicate: () => boolean, limit = 60 * 20): boolean {
    for (let i = 0; i < limit; i += 1) {
      if (predicate()) return true;
      this.step();
    }
    return predicate();
  }
}

/** The logical point at the centre of a hull section on the big board. */
function pointOf(cell: number): [number, number] {
  return [
    HULL_ORIGIN_X + cellCentreX(cell) * HULL_CELL,
    HULL_ORIGIN_Y + cellCentreY(cell) * HULL_CELL,
  ];
}

function snapshot(ship: Ship): string {
  return JSON.stringify([ship.breached, ship.shieldX, ship.shieldY, ship.charges, ship.downTurns]);
}

/* ------------------------------------------------------------------- tests */

describe('the manifest control strings', () => {
  it('names the keys the engine actually binds, and no others', () => {
    // Every claim in the string, checked against the binding table rather than against
    // memory. Mini Soccer shipped five control strings that named keys nothing read.
    const { keyboard } = manifest.controls;
    expect(keyboard).toMatch(/player one/i);
    expect(keyboard).toMatch(/W A S D/);
    expect(keyboard).toMatch(/player two/i);
    expect(keyboard).toMatch(/arrow/i);
    expect(DEFAULT_BINDINGS.p1).toEqual({
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      action: 'Space',
    });
    expect(DEFAULT_BINDINGS.p2.action).toBe('Enter');
    expect(DEFAULT_BINDINGS.p2.up).toBe('ArrowUp');
    // The string promises Space and Enter by name, so it must not also promise a key the
    // engine has never heard of.
    expect(/space/i.test(keyboard)).toBe(true);
    expect(/enter/i.test(keyboard)).toBe(true);
    expect(/\b(shift|tab|ctrl|alt|escape|backspace)\b/i.test(keyboard)).toBe(false);
  });

  it('mentions both halves of a turn, because a keyboard player owns both', () => {
    // The string used to describe only the gunner's half. A keyboard player who is not
    // told the same keys slide the armour plate never defends, which is half the game.
    const { keyboard, pointer } = manifest.controls;
    expect(keyboard, 'the keyboard line must mention the plate').toMatch(/plate|shield|armour/i);
    expect(keyboard, 'the keyboard line must mention firing').toMatch(/fire/i);
    expect(pointer, 'the pointer line must mention the plate').toMatch(/plate|shield|armour/i);
    expect(pointer, 'the pointer line must mention firing').toMatch(/fire/i);
  });

  it('lets seat one fire with Space, exactly as it says', () => {
    const rig = new Rig(makeContext(3));
    rig.game.position.attacker = 'p1';
    rig.game.position.phase = 'aim';
    // Past the arming window, so the shot is the key rather than the shot clock.
    rig.step(30);
    expect(rig.game.position.phase).toBe('aim');
    rig.input.keyDown('Space');
    rig.step();
    rig.input.keyUp('Space');
    rig.step();
    expect(rig.game.position.phase, 'Space fired seat one gun').toBe('flight');
  });

  it('lets seat two fire with Enter, and never with Space', () => {
    const rig = new Rig(makeContext(3));
    rig.game.position.attacker = 'p2';
    rig.game.position.phase = 'aim';
    rig.step(40);
    // Seat one's trigger, pressed on seat two's turn: it belongs to the other person.
    rig.input.keyDown('Space');
    rig.step();
    rig.input.keyUp('Space');
    rig.step();
    expect(rig.game.position.phase, 'seat one cannot fire seat two gun').toBe('aim');
    rig.input.keyDown('Enter');
    rig.step();
    rig.input.keyUp('Enter');
    rig.step();
    expect(rig.game.position.phase).toBe('flight');
  });

  it('moves the sight with W A S D, as the string promises', () => {
    const rig = new Rig(makeContext(5));
    rig.game.position.attacker = 'p1';
    rig.game.position.phase = 'aim';
    rig.step(20);
    const before = rig.game.position.target;
    rig.input.keyDown('KeyD');
    rig.step(3);
    rig.input.keyUp('KeyD');
    rig.step();
    expect(rig.game.position.target, 'D walked the sight along the hull').not.toBe(before);
  });

  it('slides the plate with the same keys once a shell is in the air', () => {
    // Seat two reads the board upright here, so their left is the board's left.
    const rig = new Rig(makeContext(7, null, null, 'shared-screen', 'p2'));
    rig.game.position.attacker = 'p1';
    rig.game.position.phase = 'aim';
    rig.step(30);
    rig.input.keyDown('Space');
    rig.step();
    rig.input.keyUp('Space');
    rig.stepUntil(() => rig.game.position.phase === 'flight');
    expect(rig.game.position.phase).toBe('flight');
    const defender = rig.game.position.p2;
    const before = defender.shieldX;
    // Seat two is the one under fire, so seat two's keys are the ones that move.
    rig.input.keyDown('ArrowLeft');
    rig.step(20);
    rig.input.keyUp('ArrowLeft');
    expect(defender.shieldX, 'the arrows slid seat two plate').toBeLessThan(before);
  });

  it('inverts both axes for the seat reading the board upside down', () => {
    // Not a bug being tolerated: the far player's "left" is the board's right, and a plate
    // that walked the other way would be unusable from that side of the device.
    const near = new Rig(makeContext(7, null, null, 'shared-screen', 'p2'));
    const far = new Rig(makeContext(7, null, null, 'shared-screen', 'p1'));
    for (const rig of [near, far]) {
      rig.game.position.attacker = 'p1';
      rig.game.position.phase = 'flight';
      rig.step(20); // past the flip, so input is accepted again
      rig.input.keyDown('ArrowLeft');
      rig.step(10);
      rig.input.keyUp('ArrowLeft');
    }
    expect(near.game.position.p2.shieldX).toBeLessThan(SHIELD_START_X);
    expect(far.game.position.p2.shieldX).toBeGreaterThan(SHIELD_START_X);
  });

  it('puts the sight where a finger lands and fires when it lifts', () => {
    const rig = new Rig(makeContext(11));
    rig.game.position.attacker = 'p1';
    rig.game.position.phase = 'aim';
    rig.step(30);
    const wanted = cellAt(5, 1);
    const [x, y] = pointOf(wanted);
    rig.input.pointerDown(1, x, y);
    rig.step(2);
    expect(rig.game.position.target, 'the sight followed the finger').toBe(wanted);
    rig.input.pointerUp(1);
    rig.step(2);
    expect(rig.game.position.phase, 'lifting fired').toBe('flight');
  });

  it('slides the plate under a dragging finger', () => {
    const rig = new Rig(makeContext(13, null, null, 'shared-screen', 'p2'));
    rig.game.position.attacker = 'p1';
    rig.game.position.phase = 'aim';
    rig.step(30);
    rig.input.pointerDown(1, ...pointOf(cellAt(0, 0)));
    rig.step(2);
    rig.input.pointerUp(1);
    rig.stepUntil(() => rig.game.position.phase === 'flight');
    rig.step(20); // past the flip

    const defender = rig.game.position.p2;
    const before = defender.shieldX;
    const [farX, farY] = pointOf(cellAt(5, 1));
    rig.input.pointerDown(2, farX, farY);
    rig.step(20);
    expect(defender.shieldX, 'the plate followed the finger down the hull').toBeGreaterThan(before);
    expect(defender.shieldY, 'and on to the lower deck').toBeGreaterThan(SHIELD_START_Y);
  });

  it('is completable on the keyboard alone', () => {
    // Rule from the spec template: a game the keyboard cannot finish is a defect. Seat one
    // is a person holding W A S D and Space; seat two is a bot.
    const rig = new Rig(makeContext(17, null, 'normal'));
    let winner: SeatId | 'draw' | null = null;
    for (let step = 0; step < MATCH_STEPS && winner === null; step += 1) {
      const position = rig.game.position;
      if (position.phase === 'aim' && position.attacker === 'p1') {
        if (step % 24 < 12) rig.input.keyDown('KeyD');
        else rig.input.keyUp('KeyD');
        if (step % 24 === 20) rig.input.keyDown('Space');
        if (step % 24 === 22) rig.input.keyUp('Space');
      } else {
        rig.input.keyUp('Space');
        // Under fire: chase the shell with the movement keys.
        rig.input.keyDown(step % 8 < 4 ? 'KeyA' : 'KeyD');
        rig.input.keyUp(step % 8 < 4 ? 'KeyD' : 'KeyA');
      }
      rig.step();
      winner = rig.game.getScore().winner;
    }
    expect(winner, 'a keyboard finished the match').not.toBeNull();
  });

  it('is completable on the pointer alone', () => {
    const rig = new Rig(makeContext(19, null, 'normal'));
    let winner: SeatId | 'draw' | null = null;
    let down = false;
    for (let step = 0; step < MATCH_STEPS && winner === null; step += 1) {
      const position = rig.game.position;
      const [x, y] = pointOf(step % HULL_CELLS);
      if (position.phase === 'aim' && position.attacker === 'p1') {
        if (!down) {
          rig.input.pointerDown(1, x, y);
          down = true;
        } else if (step % 20 === 0) {
          rig.input.pointerUp(1);
          down = false;
        }
      } else if (down) {
        rig.input.pointerUp(1);
        down = false;
      }
      rig.step();
      winner = rig.game.getScore().winner;
    }
    expect(winner, 'a thumb finished the match').not.toBeNull();
  });
});

describe('whose turn it is', () => {
  it('hands the board to the gunner while the gun is being laid', () => {
    const game = started(23);
    game.position.attacker = 'p1';
    game.position.phase = 'aim';
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('hands it to the seat being shot at the moment the shell is away', () => {
    // The distinctive thing about this game: the turn changes twice, so the one pointer
    // surface always belongs to exactly one person and a reaction game fits on one device.
    const game = started(29);
    game.position.attacker = 'p1';
    game.position.phase = 'flight';
    expect(game.getActiveSeat()).toBe('p2');
    game.position.phase = 'reveal';
    expect(game.getActiveSeat()).toBe('p2');
  });

  it('never leaves the board belonging to nobody', () => {
    const game = started(31, 'normal', 'normal');
    for (let step = 0; step < 60 * 60; step += 1) {
      game.update(STEP, IDLE);
      expect(['p1', 'p2'], `step ${String(step)}`).toContain(game.getActiveSeat());
    }
  });

  it('turns the board to face whoever is to move, and only on a shared screen', () => {
    const shared = new ShipBattleGame();
    shared.init(makeContext(37, null, null, 'shared-screen', 'p1'));
    shared.position.attacker = 'p2';
    shared.update(STEP, IDLE);
    const rotated = new RecordingRenderer();
    shared.render(rotated, 0);
    const angle = rotated.calls.find((call) => call.op === 'pushRotation')?.args[0];
    expect(typeof angle).toBe('number');
    expect(angle as number, 'the far seat reads its own turn upright').toBeGreaterThan(0);

    const alone = new ShipBattleGame();
    alone.init(makeContext(37, null, null, 'single-seat', 'p1'));
    alone.position.attacker = 'p2';
    alone.update(STEP, IDLE);
    const upright = new RecordingRenderer();
    alone.render(upright, 0);
    expect(
      upright.calls.find((call) => call.op === 'pushRotation')?.args[0],
      'one player alone owns the whole viewport, always upright',
    ).toBe(0);
  });

  it('says in words what the board is waiting for', () => {
    const game = started(41);
    const phases = new Map<string, string>();
    for (const phase of ['aim', 'flight'] as const) {
      game.position.phase = phase;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      const headline = renderer.texts()[0];
      expect(headline, phase).toBeTruthy();
      phases.set(phase, headline ?? '');
    }
    expect(phases.get('aim')).not.toBe(phases.get('flight'));
  });

  it('refuses input while the board is turning', () => {
    // A tap on a board that is half way round lands somewhere the player did not aim, so
    // the engine suppresses input for the whole flip. The game must honour it.
    const game = started(43);
    game.position.attacker = 'p1';
    game.position.phase = 'aim';
    game.update(STEP, IDLE);
    game.position.attacker = 'p2'; // the active seat changed, so a flip starts
    const input = new ScriptedInput();
    input.release('p2', true);
    game.update(STEP, input);
    expect(game.position.phase, 'a release mid-flip did not fire').toBe('aim');
  });
});

describe('determinism', () => {
  it('replays a bot match exactly from the same seed', () => {
    expect(trace(started(53, 'hard', 'normal'), MATCH_STEPS)).toBe(
      trace(started(53, 'hard', 'normal'), MATCH_STEPS),
    );
  });

  it('plays a different match from a different seed', () => {
    expect(trace(started(59, 'normal', 'normal'), 60 * 60)).not.toBe(
      trace(started(61, 'normal', 'normal'), 60 * 60),
    );
  });

  it('steps the identical match at sixty and at a hundred and twenty', () => {
    // Rule 8, at the whole-match scale. Every duration here is seconds converted to steps,
    // and the plate's slide is linear in time, so a faster screen must not play a
    // different game — it must play the same one at a finer grain.
    const slow = started(67, 'hard', 'normal');
    const fast = started(67, 'hard', 'normal');
    for (let step = 0; step < MATCH_STEPS; step += 1) {
      slow.update(STEP, IDLE);
      fast.update(1 / 120, IDLE);
      fast.update(1 / 120, IDLE);
      if (slow.getScore().winner !== null) break;
    }
    expect(fast.getScore()).toEqual(slow.getScore());
    expect(fast.position.turns).toBe(slow.position.turns);
    expect(fast.position.attacker).toBe(slow.position.attacker);
    for (const seat of ['p1', 'p2'] as const) {
      expect(fast.position[seat].breached, seat).toEqual(slow.position[seat].breached);
      expect(fast.position[seat].charges, seat).toBe(slow.position[seat].charges);
      expect(fast.position[seat].downTurns, seat).toBe(slow.position[seat].downTurns);
      // The plate's own position agrees to within floating-point noise rather than
      // bit-for-bit: two half-length slides and one full-length slide are the same
      // distance analytically, and the last decimal place of a double is not the claim.
      expect(fast.position[seat].shieldX, seat).toBeCloseTo(slow.position[seat].shieldX, 9);
      expect(fast.position[seat].shieldY, seat).toBeCloseTo(slow.position[seat].shieldY, 9);
    }
  });

  it('tosses for the opening shot from the match seed, and both seats can win it', () => {
    const seats = new Set<SeatId>();
    for (let seed = 0; seed < 40; seed += 1) seats.add(started(seed).position.attacker);
    expect(seats.size, 'the toss must be able to go either way').toBe(2);
    expect(started(71).position.attacker).toBe(started(71).position.attacker);
  });

  it('starts a rematch from the same seed in the same place', () => {
    const game = started(73, 'easy', 'easy');
    playOut(game);
    game.init(makeContext(73, 'easy', 'easy'));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.turns).toBe(0);
    expect(game.position.p1.shieldX).toBe(SHIELD_START_X);
    expect(game.position.p2.shieldY).toBe(SHIELD_START_Y);
  });

  it('leaves nothing behind on destroy', () => {
    const game = started(79, 'hard', 'hard');
    for (let step = 0; step < 60 * 60; step += 1) game.update(STEP, IDLE);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.position.turns).toBe(0);
    expect(game.position.phase).toBe('aim');
  });
});

describe('the win condition at its boundaries', () => {
  it('is not won with one section still standing', () => {
    const game = started(83);
    game.position.p2.breached.fill(true);
    game.position.p2.breached[4] = false;
    game.update(STEP, IDLE);
    expect(game.getScore().p1).toBe(HULL_CELLS - 1);
    expect(game.getScore().winner, 'eleven of twelve is not a sinking').toBeNull();
  });

  it('is won by the shell that takes the twelfth section', () => {
    const game = started(89);
    const position = game.position;
    position.attacker = 'p1';
    position.p2.breached.fill(true);
    position.p2.breached[4] = false;
    position.p2.charges = 0;
    position.p2.downTurns = RECHARGE_TURNS;
    position.target = 4;
    position.phase = 'flight';
    game.update(STEP, IDLE);
    for (let step = 0; step < Math.ceil(FLIGHT_SECONDS / STEP) + 4; step += 1) {
      game.update(STEP, IDLE);
    }
    expect(position.phase, 'the match is over the instant the hull is gone').toBe('over');
    expect(game.getScore().p1).toBe(HULL_CELLS);
  });

  it('holds the result up before it announces it', () => {
    // A player must see the last section go, not a result card over the top of it.
    const game = started(97);
    const position = game.position;
    position.attacker = 'p1';
    position.p2.breached.fill(true);
    position.p2.breached[4] = false;
    position.p2.charges = 0;
    position.p2.downTurns = RECHARGE_TURNS;
    position.target = 4;
    position.phase = 'flight';
    for (let step = 0; step < Math.ceil(FLIGHT_SECONDS / STEP) + 4; step += 1) {
      game.update(STEP, IDLE);
    }
    expect(position.phase).toBe('over');
    expect(game.getScore().winner, 'still settling').toBeNull();
    for (let step = 0; step < Math.ceil(SETTLE_SECONDS / STEP) + 4; step += 1) {
      game.update(STEP, IDLE);
    }
    expect(game.getScore().winner).toBe('p1');
  });

  it('is not won by a shell the plate stops, however few sections are left', () => {
    const game = started(101);
    const position = game.position;
    position.attacker = 'p1';
    position.p2.breached.fill(true);
    position.p2.breached[4] = false;
    position.p2.shieldX = coverX(4);
    position.p2.shieldY = coverY(4);
    position.target = 4;
    position.phase = 'flight';
    for (let step = 0; step < Math.ceil(FLIGHT_SECONDS / STEP) + 4; step += 1) {
      game.update(STEP, IDLE);
    }
    expect(position.lastResult).toBe('blocked');
    expect(game.getScore().winner, 'a block is a reprieve').toBeNull();
    expect(position.phase).toBe('reveal');
  });

  it('cannot be drawn, even with both hulls down to their last section', () => {
    const game = started(103, 'hard', 'hard');
    for (const seat of ['p1', 'p2'] as const) {
      const ship = game.position[seat];
      ship.breached.fill(true);
      ship.breached[0] = false;
    }
    const winner = playOut(game);
    expect(winner === 'p1' || winner === 'p2', 'one shell lands at a time').toBe(true);
  });

  it('stops moving once it is decided', () => {
    const game = started(107, 'hard', 'easy');
    expect(playOut(game)).not.toBeNull();
    const frozen = JSON.stringify(game.getScore());
    const settled = JSON.stringify(game.position);
    for (let step = 0; step < 600; step += 1) game.update(STEP, IDLE);
    expect(JSON.stringify(game.getScore())).toBe(frozen);
    expect(JSON.stringify(game.position)).toBe(settled);
  });

  it('counts breaches on the other hull, which is the number a player watches', () => {
    const game = started(109);
    game.position.p2.breached[0] = true;
    game.position.p2.breached[1] = true;
    game.position.p1.breached[5] = true;
    expect(game.getScore().p1).toBe(2);
    expect(game.getScore().p2).toBe(1);
  });
});

describe('termination', () => {
  it('ends even when nobody touches the device', () => {
    // Every phase has a shot clock, which is what makes this true: a turn moves on whether
    // or not anybody acts, so no position can sit for ever.
    const winner = playOut(started(113));
    expect(winner === 'p1' || winner === 'p2').toBe(true);
  });

  it('ends from every pairing of tiers, from either seat', () => {
    const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];
    for (const first of tiers) {
      for (const second of tiers) {
        const winner = playOut(started(127, first, second));
        expect(winner, `${first} v ${second}`).not.toBeNull();
      }
    }
  });

  it('ends inside the round length the manifest advertises', () => {
    // `roundSeconds` is what the shell and the tournament pace a run by. A match that
    // routinely ran past it would make the catalogue's own number a lie.
    let worst = 0;
    for (let seed = 0; seed < 24; seed += 1) {
      const game = started(200 + seed * 3, 'hard', 'hard');
      let steps = 0;
      for (; steps < MATCH_STEPS; steps += 1) {
        game.update(STEP, IDLE);
        if (game.getScore().winner !== null) break;
      }
      expect(game.getScore().winner, `seed ${String(seed)}`).not.toBeNull();
      worst = Math.max(worst, steps);
    }
    expect(worst / 60, `worst match ran ${(worst / 60).toFixed(0)}s`).toBeLessThan(
      manifest.roundSeconds,
    );
  });

  it('cannot be stalled by a defender who covers every single shell', () => {
    // The stalemate argument at the whole-game level. A block costs a charge and a spent
    // plate is rebuilt over two defensive turns, so at most two shots in four can be
    // stopped however perfectly the defender plays.
    const game = started(131);
    const input = new ScriptedInput();
    let steps = 0;
    for (; steps < MATCH_STEPS; steps += 1) {
      const position = game.position;
      // A defender with a perfect hand: the plate is teleported on to the incoming shell
      // every step, which is stronger than any instrument could ever be.
      if (position.phase === 'flight') {
        const defender = position.attacker === 'p1' ? position.p2 : position.p1;
        defender.shieldX = coverX(position.target);
        defender.shieldY = coverY(position.target);
      }
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner, 'a hull cannot be defended for ever').not.toBeNull();
    expect(game.position.turns).toBeLessThanOrEqual(HULL_CELLS * 4);
    // And the bound is where `roundSeconds` comes from: forty-eight turns of a full shot
    // clock is a hair under three minutes, so the manifest's number is the worst case
    // rather than a guess. Nothing enforces `roundSeconds` at the platform level — it is
    // the catalogue card's promise, and this is what keeps it true.
    expect(steps / 60, `the worst case ran ${(steps / 60).toFixed(0)}s`).toBeLessThan(
      manifest.roundSeconds,
    );
    expect(HULL_CELLS * 4 * (AIM_SECONDS + FLIGHT_SECONDS + REVEAL_SECONDS)).toBeLessThan(
      manifest.roundSeconds,
    );
  });

  it('never spends a shot on a hole somebody already made', () => {
    const game = started(137, 'normal', 'hard');
    let wasted = 0;
    let lastTurn = 0;
    for (let step = 0; step < MATCH_STEPS; step += 1) {
      game.update(STEP, IDLE);
      if (game.position.turns !== lastTurn) {
        lastTurn = game.position.turns;
        if (game.position.lastResult === 'none') wasted += 1;
      }
      if (game.getScore().winner !== null) break;
    }
    expect(wasted, 'the sight snaps to something still standing').toBe(0);
  });
});

describe('seat symmetry', () => {
  /**
   * The same match, played with the seats exchanged.
   *
   * Not a statistical claim: the two games are stepped side by side and every value is
   * compared. Two idle humans make the simulation fully deterministic — no bot, no rng
   * after the toss — so the mirror has to be exact rather than close.
   */
  function mirrorPair(first: SeatId): [ShipBattleGame, ShipBattleGame] {
    const left = new ShipBattleGame();
    left.init(makeContext(149, null, null, 'shared-screen', 'p1'));
    const right = new ShipBattleGame();
    // Local seat exchanged as well, so the board turns the same way in both.
    right.init(makeContext(149, null, null, 'shared-screen', 'p2'));
    left.position.attacker = first;
    right.position.attacker = first === 'p1' ? 'p2' : 'p1';
    return [left, right];
  }

  it('plays the mirrored match to the mirrored end', () => {
    const [left, right] = mirrorPair('p1');
    for (let step = 0; step < MATCH_STEPS; step += 1) {
      left.update(STEP, IDLE);
      right.update(STEP, IDLE);
      expect(snapshot(right.position.p1), `step ${String(step)}`).toBe(snapshot(left.position.p2));
      expect(snapshot(right.position.p2), `step ${String(step)}`).toBe(snapshot(left.position.p1));
      if (left.getScore().winner !== null) break;
    }
    const leftScore = left.getScore();
    const rightScore = right.getScore();
    expect(rightScore.p1).toBe(leftScore.p2);
    expect(rightScore.p2).toBe(leftScore.p1);
    expect(rightScore.winner).toBe(leftScore.winner === 'p1' ? 'p2' : 'p1');
  });

  it('gives both seats the same board, the same turn length and the same plate', () => {
    const [left, right] = mirrorPair('p2');
    for (let step = 0; step < 60 * 30; step += 1) {
      left.update(STEP, IDLE);
      right.update(STEP, IDLE);
      expect(right.position.turns).toBe(left.position.turns);
      expect(right.position.phase).toBe(left.position.phase);
      expect(right.getActiveSeat()).toBe(left.getActiveSeat() === 'p1' ? 'p2' : 'p1');
    }
  });

  it('draws both hulls with the same number of strokes', () => {
    // Rule 7 is about telling the seats apart; symmetry is about neither being favoured.
    // Seat two's sections carry two ribs and seat one's carry one, so the counts differ
    // by exactly the rib — nothing else about the two ships may.
    const game = started(151);
    const before = new RecordingRenderer();
    game.render(before, 0);
    game.position.attacker = 'p2';
    const after = new RecordingRenderer();
    game.render(after, 0);
    expect(after.calls.length).toBeGreaterThan(0);
    expect(after.ops.filter((op) => op === 'rect').length).toBe(
      before.ops.filter((op) => op === 'rect').length,
    );
  });

  it('is balanced between the seats when the two tiers are equal', () => {
    for (const tier of ['easy', 'normal', 'hard'] as BotDifficulty[]) {
      let p1 = 0;
      let decided = 0;
      for (let seed = 0; seed < 40; seed += 1) {
        const winner = playOut(started(300 + seed * 11, tier, tier));
        if (winner === null || winner === 'draw') continue;
        decided += 1;
        if (winner === 'p1') p1 += 1;
      }
      expect(decided, `${tier} decided nothing`).toBeGreaterThan(35);
      const share = p1 / decided;
      expect(share, `${tier}: p1 took ${String(p1)} of ${String(decided)}`).toBeGreaterThan(0.3);
      expect(share, `${tier}: p1 took ${String(p1)} of ${String(decided)}`).toBeLessThan(0.7);
    }
  });
});

describe('the three tiers', () => {
  const tiers: BotDifficulty[] = ['easy', 'normal', 'hard'];

  /**
   * Seeds a series is played from. Fixed and named so the table in SPEC.md is a
   * measurement anybody can reproduce by running this file rather than a claim.
   */
  const SERIES_SEEDS = 60;

  /** Wins for the first-named tier over a series played from both seats. */
  function series(strong: BotDifficulty, weak: BotDifficulty, count: number): [number, number] {
    let wins = 0;
    let decided = 0;
    for (let seed = 0; seed < count; seed += 1) {
      for (const strongIsP1 of [true, false]) {
        const game = strongIsP1
          ? started(400 + seed * 13, strong, weak)
          : started(400 + seed * 13, weak, strong);
        const winner = playOut(game);
        if (winner === null || winner === 'draw') continue;
        decided += 1;
        const strongSeat: SeatId = strongIsP1 ? 'p1' : 'p2';
        if (winner === strongSeat) wins += 1;
      }
    }
    return [wins, decided];
  }

  it('ranks hard over normal over easy, from either seat', () => {
    // The measured numbers are written into SPEC.md. The bands here are wide enough that
    // a tuning change does not fail them and narrow enough that a tier going flat does.
    for (const [strong, weak, floor] of [
      ['hard', 'easy', 0.9],
      ['normal', 'easy', 0.85],
      ['hard', 'normal', 0.75],
    ] as [BotDifficulty, BotDifficulty, number][]) {
      const [wins, decided] = series(strong, weak, SERIES_SEEDS);
      expect(decided, `${strong} v ${weak} decided nothing`).toBe(SERIES_SEEDS * 2);
      const rate = wins / decided;
      expect(
        rate,
        `${strong} beat ${weak} in ${String(wins)} of ${String(decided)}`,
      ).toBeGreaterThan(floor);
    }
  });

  it('stops a larger share of the shells at each tier', () => {
    // The defensive half of the difficulty, measured rather than asserted from the
    // profile numbers. The ceiling is 50%: two blocks spend the plate, and it is out for
    // the next two defensive turns.
    const blocked = tiers.map((tier) => {
      let stopped = 0;
      let shots = 0;
      for (let seed = 0; seed < 12; seed += 1) {
        const game = started(500 + seed * 17, tier, tier);
        let lastTurn = 0;
        for (let step = 0; step < MATCH_STEPS; step += 1) {
          game.update(STEP, IDLE);
          if (game.position.turns !== lastTurn) {
            lastTurn = game.position.turns;
            shots += 1;
            if (game.position.lastResult === 'blocked') stopped += 1;
          }
          if (game.getScore().winner !== null) break;
        }
      }
      return stopped / shots;
    });
    const [easy, normal, hard] = blocked as [number, number, number];
    expect(normal, `easy ${easy.toFixed(2)} normal ${normal.toFixed(2)}`).toBeGreaterThan(easy);
    expect(hard, `normal ${normal.toFixed(2)} hard ${hard.toFixed(2)}`).toBeGreaterThan(normal);
    expect(hard, 'nobody may beat the recharge ceiling').toBeLessThan(0.5);
  });

  it('takes its time before it reaches for the plate, and less of it as it hardens', () => {
    // Rule 6 in its most concrete form: the bot's advantage is reaction, never knowledge,
    // and a slow tier must visibly be slow.
    const delays = tiers.map((tier) => {
      const game = started(601, null, tier);
      const position = game.position;
      position.attacker = 'p1';
      position.phase = 'aim';
      // Fire at the far end of the hull, so any movement at all is measurable.
      position.target = cellAt(5, 1);
      position.phase = 'flight';
      const startX = position.p2.shieldX;
      for (let step = 0; step < Math.ceil(FLIGHT_SECONDS / STEP); step += 1) {
        game.update(STEP, IDLE);
        if (Math.abs(position.p2.shieldX - startX) > 1e-9) return step;
      }
      return Number.POSITIVE_INFINITY;
    });
    const [easy, normal, hard] = delays as [number, number, number];
    expect(hard, `hard waited ${String(hard)} steps`).toBeLessThan(normal);
    expect(normal, `normal waited ${String(normal)} steps`).toBeLessThan(easy);
    expect(hard, 'even the hardest tier is not instant').toBeGreaterThan(0);
  });

  it('lays the gun for as long as its own tier says', () => {
    const shots = tiers.map((tier) => {
      const game = started(607, tier, null);
      setAttacker(game, 'p1');
      setPhase(game, 'aim');
      for (let step = 0; step < Math.ceil(AIM_SECONDS / STEP) + 4; step += 1) {
        game.update(STEP, IDLE);
        if (game.position.phase !== 'aim') return step;
      }
      return Number.POSITIVE_INFINITY;
    });
    const [easy, normal, hard] = shots as [number, number, number];
    expect(hard).toBeLessThan(normal);
    expect(normal).toBeLessThan(easy);
    expect(easy).toBeLessThan(Math.ceil(AIM_SECONDS / STEP) + 4);
  });

  it('never fires or defends for a seat a person is holding', () => {
    const game = started(613, null, 'hard');
    game.position.attacker = 'p1';
    game.position.phase = 'aim';
    const before = snapshot(game.position.p1);
    // A whole aim phase with nobody touching seat one: the shot clock may fire the gun,
    // but nothing may move seat one's own plate on seat one's behalf.
    for (let step = 0; step < Math.ceil(AIM_SECONDS / STEP); step += 1) game.update(STEP, IDLE);
    expect(snapshot(game.position.p1), 'a bot moved a human plate').toBe(before);
  });

  it('gives every tier exactly the same plate speed', () => {
    // The tiers differ by reaction and judgement, never by physics — a bot whose plate
    // outran a person's would be a different game, not a harder one.
    const reached = tiers.map((tier) => {
      const game = started(617, null, tier);
      const position = game.position;
      position.attacker = 'p1';
      position.target = cellAt(5, 1);
      position.phase = 'flight';
      let travelled = 0;
      let last = position.p2.shieldX;
      for (let step = 0; step < Math.ceil(FLIGHT_SECONDS / STEP); step += 1) {
        game.update(STEP, IDLE);
        travelled = Math.max(travelled, Math.abs(position.p2.shieldX - last));
        last = position.p2.shieldX;
      }
      return travelled;
    });
    const [easy, normal, hard] = reached as [number, number, number];
    expect(normal).toBeCloseTo(easy, 9);
    expect(hard).toBeCloseTo(easy, 9);
  });
});

describe('what is drawn', () => {
  it('keeps every mark inside the logical box', () => {
    const game = started(701, 'normal', 'normal');
    for (let step = 0; step < 60 * 90; step += 1) {
      game.update(STEP, IDLE);
      if (step % 37 !== 0) continue;
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      for (const call of renderer.calls) {
        if (call.op === 'text' || call.op === 'pushRotation') continue;
        for (const value of call.args) {
          if (typeof value !== 'number') continue;
          expect(Number.isFinite(value), call.op).toBe(true);
          expect(value, `${call.op} drew at ${String(value)}`).toBeGreaterThan(-80);
          expect(value, `${call.op} drew at ${String(value)}`).toBeLessThan(980);
        }
      }
    }
  });

  it('does not mutate the position', () => {
    const game = started(709, 'hard', 'normal');
    for (let step = 0; step < 60 * 40; step += 1) game.update(STEP, IDLE);
    const before = JSON.stringify(game.position);
    const asContract: Game = game;
    asContract.render(new RecordingRenderer(), 0);
    asContract.render(new RecordingRenderer(), 1);
    expect(JSON.stringify(game.position)).toBe(before);
  });

  it('closes every rotation it opens', () => {
    const game = started(719, 'normal', 'normal');
    for (let step = 0; step < 400; step += 1) {
      game.update(STEP, IDLE);
      const renderer = new RecordingRenderer();
      game.render(renderer, 0);
      const pushes = renderer.ops.filter((op) => op === 'pushRotation').length;
      const pops = renderer.ops.filter((op) => op === 'popSeatRotation').length;
      expect(pops, `step ${String(step)}`).toBe(pushes);
    }
  });

  it('tells the two hulls apart with the colour taken away', () => {
    // Rule 7. A seat one section carries one diagonal rib and a seat two section two, so
    // the ribs alone separate them; a greyscale screen loses nothing.
    const game = started(727);
    game.position.attacker = 'p1';
    const shotAtP2 = new RecordingRenderer();
    game.render(shotAtP2, 0);
    game.position.attacker = 'p2';
    const shotAtP1 = new RecordingRenderer();
    game.render(shotAtP1, 0);
    // Counted inside the hull under fire only. The whole frame draws both ships, so a
    // total over the frame is the same either way round and would prove nothing.
    const ribs = (renderer: RecordingRenderer): number =>
      renderer.calls.filter(
        (call) =>
          call.op === 'line' &&
          typeof call.args[0] === 'number' &&
          typeof call.args[1] === 'number' &&
          call.args[0] >= HULL_ORIGIN_X &&
          call.args[0] <= HULL_ORIGIN_X + HULL_WIDTH &&
          call.args[1] >= HULL_ORIGIN_Y &&
          call.args[1] <= HULL_ORIGIN_Y + HULL_HEIGHT,
      ).length;
    expect(
      ribs(shotAtP2) - ribs(shotAtP1),
      'a seat two section carries two ribs where a seat one section carries one',
    ).toBe(HULL_CELLS);
  });

  it('marks a spent plate differently from a live one', () => {
    const game = started(733);
    const live = new RecordingRenderer();
    game.render(live, 0);
    game.position.p2.charges = 0;
    game.position.p2.downTurns = RECHARGE_TURNS;
    const spent = new RecordingRenderer();
    game.render(spent, 0);
    expect(spent.texts().join(' '), 'a spent plate says so in words').toMatch(/out/i);
    expect(live.texts().join(' ')).not.toMatch(/plate out/i);
  });

  it('shows where the shell is going from the moment it leaves', () => {
    // The defender is being asked to beat it there, not to guess: the landing point is
    // drawn for the whole flight.
    const game = started(739);
    game.position.attacker = 'p1';
    game.position.target = cellAt(4, 1);
    game.position.phase = 'flight';
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const [x, y] = pointOf(cellAt(4, 1));
    const marked = renderer.calls.some(
      (call) =>
        call.op === 'strokeCircle' &&
        typeof call.args[0] === 'number' &&
        typeof call.args[1] === 'number' &&
        Math.abs(call.args[0] - x) < 1 &&
        Math.abs(call.args[1] - y) < 1,
    );
    expect(marked, 'the landing point is on the board').toBe(true);
  });

  it('draws both ships, so a gunner can see their own damage', () => {
    const game = started(743);
    game.position.p1.breached[0] = true;
    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    const labels = renderer.texts().filter((value) => /hull/i.test(value));
    expect(labels.length, 'the hull under fire and the gunner own ship').toBe(2);
    expect(labels.some((value) => value.startsWith('P1'))).toBe(true);
    expect(labels.some((value) => value.startsWith('P2'))).toBe(true);
  });
});

describe('the board mapping', () => {
  it('puts every section under its own square of the board', () => {
    for (let cell = 0; cell < HULL_CELLS; cell += 1) {
      const [x, y] = pointOf(cell);
      expect(hullCellAt(x, y), `section ${String(cell)}`).toBe(cell);
    }
  });

  it('reports nothing off the hull rather than the nearest section', () => {
    expect(hullCellAt(HULL_ORIGIN_X - 1, HULL_ORIGIN_Y + 10)).toBe(-1);
    expect(hullCellAt(HULL_ORIGIN_X + 10, HULL_ORIGIN_Y - 1)).toBe(-1);
    expect(hullCellAt(0, 0)).toBe(-1);
    expect(hullCellAt(899, 899)).toBe(-1);
  });

  it('claims its edges without overlapping the next section', () => {
    const [x, y] = pointOf(cellAt(2, 0));
    expect(hullCellAt(x - HULL_CELL / 2, y)).toBe(cellAt(2, 0));
    expect(hullCellAt(x + HULL_CELL / 2, y)).toBe(cellAt(3, 0));
    expect(hullCellAt(x, y + HULL_CELL / 2)).toBe(cellAt(2, 1));
  });

  it('leaves the plate somewhere it can still cover the section it is over', () => {
    const game = started(751);
    const ship = game.position.p2;
    expect(shieldCovers(ship, cellAt(3, 0))).toBe(true);
    expect(shieldCovers(ship, cellAt(3, 1))).toBe(false);
  });
});

describe('the reveal', () => {
  it('is the one window a defender gets to reposition between shells', () => {
    const game = new ShipBattleGame();
    game.init(makeContext(757, null, null, 'shared-screen', 'p2'));
    const position = game.position;
    position.attacker = 'p1';
    position.phase = 'reveal';
    position.lastResult = 'breach';
    const input = new ScriptedInput();
    input.point('p2', ...pointOf(cellAt(0, 1)));
    // Past the flip, so the board has settled on the defender.
    for (let step = 0; step < 20; step += 1) game.update(STEP, input);
    expect(position.p2.shieldX, 'the plate moved during the smoke').toBeLessThan(SHIELD_START_X);
    expect(position.p2.shieldY, 'and on to the deck the finger named').toBeGreaterThan(
      SHIELD_START_Y,
    );
  });

  it('hands the gun over when it is finished', () => {
    const game = started(761);
    const position = game.position;
    setAttacker(game, 'p1');
    setPhase(game, 'reveal');
    for (let step = 0; step < Math.ceil(REVEAL_SECONDS / STEP) + 20; step += 1) {
      game.update(STEP, IDLE);
      if (position.attacker === 'p2') break;
    }
    expect(position.attacker).toBe('p2');
    expect(position.phase).toBe('aim');
    expect(position.lastResult).toBe('none');
  });
});
