import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, InputManager, InputView, Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { Game, GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import {
  AIM_KEY_RATE,
  ArcheryMasterGame,
  DRAW_KEY_RATE,
  PAD_CX,
  PAD_H,
  PAD_HALF_W,
  PAD_Y,
} from './game.js';
import {
  AIM_LIMIT,
  BOW_Y,
  FIELD_HEIGHT,
  FIELD_WIDTH,
  MAX_FLIGHT_SECONDS,
  PLAN_TIMES,
  RACK_SIZE,
  ROUND_CAP,
  TARGET_GOAL,
  aimThrough,
  createAim,
  targetXAt,
} from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
/** Steps in the settle, which is what hands the turn on once an arrow has landed. */
const SETTLE_FRAMES = 12;
/** A cap on any wait, so a test that stops making progress fails rather than hanging. */
const WAIT_CAP = 200;

class FakeSeat implements SeatInput {
  readonly move: Vec2 = vec2();
  pointer: Vec2 | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
}

class FakeInput implements InputState {
  readonly p1 = new FakeSeat();
  readonly p2 = new FakeSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.p1 : this.p2;
  }

  clear(): void {
    for (const seat of [this.p1, this.p2]) {
      set(seat.move, 0, 0);
      seat.pointer = null;
      seat.actionPressed = false;
      seat.actionHeld = false;
      seat.actionReleased = false;
      seat.holdSeconds = 0;
    }
  }
}

/** A filled disc, kept so a test can ask what *shape* something was drawn as. */
interface Disc {
  x: number;
  y: number;
  radius: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  calls = 0;
  texts = 0;
  angles: number[] = [];
  /** Filled shapes only: an outline confirms a mark, it is never the mark itself. */
  discs: Disc[] = [];
  boxes: Box[] = [];
  numbers: number[] = [];
  labels: string[] = [];

  clear(): void {
    this.calls += 1;
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.calls += 1;
    this.boxes.push({ x, y, width, height });
    this.numbers.push(x, y, width, height);
  }
  strokeRect(x: number, y: number, width: number, height: number): void {
    this.calls += 1;
    this.numbers.push(x, y, width, height);
  }
  circle(x: number, y: number, radius: number): void {
    this.calls += 1;
    this.discs.push({ x, y, radius });
    this.numbers.push(x, y, radius);
  }
  strokeCircle(x: number, y: number, radius: number): void {
    this.calls += 1;
    this.numbers.push(x, y, radius);
  }
  line(x1: number, y1: number, x2: number, y2: number): void {
    this.calls += 1;
    this.numbers.push(x1, y1, x2, y2);
  }
  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.calls += 1;
    this.texts += 1;
    this.labels.push(value);
    this.numbers.push(x, y, sizePx);
    expect(value.length).toBeGreaterThan(0);
    expect(Number.isFinite(x + y + sizePx)).toBe(true);
    expect(sizePx).toBeGreaterThan(0);
    expect(colour.length).toBeGreaterThan(0);
    expect(align === undefined || align.length > 0).toBe(true);
  }
  pushSeatRotation(): void {
    this.depth += 1;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
  }
  pushRotation(radians = 0): void {
    this.angles.push(radians);
    this.pushSeatRotation();
  }
  popSeatRotation(): void {
    this.depth -= 1;
  }
}

function makeContext(
  p1Bot: BotDifficulty | null,
  p2Bot: BotDifficulty | null,
  presentation: Presentation = 'single-seat',
  localSeat: SeatId = 'p1',
  seed = 1234,
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat,
    openingSeat: 'p1',
    botDifficulty: (seat: SeatId) => (seat === 'p1' ? p1Bot : p2Bot),
  };
}

function step(game: ArcheryMasterGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** Where on the pad an aim lives. The one mapping, shared by the game and by a test. */
function padXFor(angle: number): number {
  return PAD_CX + (angle / AIM_LIMIT) * PAD_HALF_W;
}

function padYFor(power: number): number {
  return PAD_Y + power * PAD_H;
}

function touch(
  input: FakeInput,
  seat: SeatId,
  angle: number,
  power: number,
  rotated = false,
): void {
  const x = padXFor(angle);
  const y = padYFor(power);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: FIELD_WIDTH - x, y: FIELD_HEIGHT - y } : { x, y };
  target.actionHeld = true;
}

function lift(input: FakeInput, seat: SeatId): void {
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = null;
  target.actionHeld = false;
  target.actionReleased = true;
}

/**
 * Wait out the arrow and the settle, and stop on the step the turn is handed on.
 *
 * Bounded, never a `while`: a synchronous spin cannot be timed out by the runner, so a
 * game that stopped making progress would hang the whole suite instead of failing it.
 */
function finishTurn(game: ArcheryMasterGame, input: FakeInput): void {
  for (let i = 0; i < WAIT_CAP; i += 1) {
    if (!game.arrowInFlight) break;
    step(game, input);
  }
  for (let i = 0; i < SETTLE_FRAMES; i += 1) {
    if (game.getScore().winner !== null) return;
    step(game, input);
  }
}

/** A whole shot: point the bow, draw, loose, and stop as the turn is handed on. */
function shoot(
  game: ArcheryMasterGame,
  input: FakeInput,
  seat: SeatId,
  angle: number,
  power: number,
  holdFrames = 4,
  rotated = false,
): void {
  input.clear();
  touch(input, seat, angle, power, rotated);
  step(game, input, holdFrames);
  lift(input, seat);
  step(game, input, 1);
  input.clear();
  finishTurn(game, input);
}

/**
 * An aim that puts an arrow through a target of the current rack.
 *
 * It leads the target the way a player does, to where it will be when the arrow arrives,
 * and tries every flight time the bow can make before giving up.
 */
function aimAtTarget(game: ArcheryMasterGame, index: number) {
  const target = game.rackFor(game.roundIndex)[index];
  const out = createAim();
  if (target === undefined) return null;
  for (const seconds of PLAN_TIMES) {
    const x = targetXAt(target, game.turnSeconds + seconds);
    if (aimThrough(out, x, target.y, seconds)) return out;
  }
  return null;
}

describe('a fresh match', () => {
  let game: ArcheryMasterGame;

  beforeEach(() => {
    game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
  });

  it('starts level with nothing decided', () => {
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBeNull();
  });

  it('starts with seat one to shoot', () => {
    expect(game.getActiveSeat()).toBe('p1');
    expect(game.activeSeat).toBe('p1');
  });

  it('starts in the first round with its first shot', () => {
    expect(game.roundIndex).toBe(0);
    expect(game.shotInRound).toBe(0);
  });

  it('starts with the bow undrawn and pointing straight up', () => {
    expect(game.aimAngle).toBe(0);
    expect(game.aimPower).toBe(0);
  });

  it('has a full shot clock before the first step', () => {
    expect(game.shotClockSeconds).toBeGreaterThan(3);
  });

  it('has a rack for every round it could ever play', () => {
    for (let round = 0; round < ROUND_CAP; round += 1) {
      expect(game.rackFor(round)).toHaveLength(RACK_SIZE);
    }
  });

  it('gives the two seats the identical rack in a round', () => {
    // The fairness decision the game turns on: a rack belongs to a round, not to a shot.
    const input = new FakeInput();
    const first = game.rackFor(0).map((target) => ({ ...target }));
    shoot(game, input, 'p1', 0, 0.5);
    expect(game.activeSeat).toBe('p2');
    expect(game.rackFor(game.roundIndex).map((target) => ({ ...target }))).toEqual(first);
  });

  it('gives two rounds two different racks', () => {
    expect(game.rackFor(1)).not.toEqual(game.rackFor(0));
  });

  it('rolls the same gallery for the same seed', () => {
    const other = new ArcheryMasterGame();
    other.init(makeContext(null, null));
    for (let round = 0; round < ROUND_CAP; round += 1) {
      expect(other.rackFor(round)).toEqual(game.rackFor(round));
    }
  });

  it('rolls a different gallery for a different seed', () => {
    const other = new ArcheryMasterGame();
    other.init(makeContext(null, null, 'single-seat', 'p1', 999));
    expect(other.rackFor(0)).not.toEqual(game.rackFor(0));
  });
});

describe('taking a shot with a finger', () => {
  let game: ArcheryMasterGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    input = new FakeInput();
  });

  it('points the bow where the finger is', () => {
    touch(input, 'p1', 0.4, 0.7);
    step(game, input);
    expect(game.aimAngle).toBeCloseTo(0.4, 6);
    expect(game.aimPower).toBeCloseTo(0.7, 6);
  });

  it('reads the pad absolutely, so a finger held still keeps its aim', () => {
    touch(input, 'p1', -0.3, 0.25);
    step(game, input, 30);
    expect(game.aimAngle).toBeCloseTo(-0.3, 6);
    expect(game.aimPower).toBeCloseTo(0.25, 6);
  });

  it('clamps a finger past the side of the pad to the edge of the aim', () => {
    input.p1.pointer = { x: -400, y: padYFor(0.5) };
    input.p1.actionHeld = true;
    step(game, input);
    expect(game.aimAngle).toBeCloseTo(-AIM_LIMIT, 6);
    input.p1.pointer = { x: 4000, y: padYFor(0.5) };
    step(game, input);
    expect(game.aimAngle).toBeCloseTo(AIM_LIMIT, 6);
  });

  it('clamps a finger above the pad to no draw at all, so no part of the board is dead', () => {
    input.p1.pointer = { x: PAD_CX, y: 40 };
    input.p1.actionHeld = true;
    step(game, input);
    expect(game.aimPower).toBe(0);
    input.p1.pointer = { x: PAD_CX, y: FIELD_HEIGHT - 1 };
    step(game, input);
    expect(game.aimPower).toBe(1);
  });

  it('looses the arrow when the finger lifts', () => {
    touch(input, 'p1', 0, 0.6);
    step(game, input, 4);
    expect(game.arrowInFlight).toBe(false);
    lift(input, 'p1');
    step(game, input);
    expect(game.arrowInFlight).toBe(true);
  });

  it('ignores a release that never drew the bow at all', () => {
    lift(input, 'p1');
    step(game, input);
    expect(game.arrowInFlight).toBe(false);
    expect(game.activeSeat).toBe('p1');
  });

  it('refuses everything while the arrow is in the air', () => {
    touch(input, 'p1', 0, 0.6);
    step(game, input, 4);
    lift(input, 'p1');
    step(game, input);
    const aim = game.aimAngle;
    touch(input, 'p1', 0.8, 1);
    step(game, input, 3);
    expect(game.aimAngle).toBe(aim);
  });

  it('passes the turn once the arrow has landed and settled', () => {
    shoot(game, input, 'p1', 0, 0.5);
    expect(game.activeSeat).toBe('p2');
    expect(game.shotInRound).toBe(1);
    expect(game.roundIndex).toBe(0);
  });

  it('starts the next round after both seats have shot', () => {
    shoot(game, input, 'p1', 0, 0.5);
    shoot(game, input, 'p2', 0, 0.5);
    expect(game.roundIndex).toBe(1);
    expect(game.shotInRound).toBe(0);
    expect(game.activeSeat).toBe('p2');
  });

  it('gives the two seats the same number of arrows at every round boundary', () => {
    for (let round = 0; round < 6; round += 1) {
      shoot(game, input, game.activeSeat, 0.1, 0.5);
      shoot(game, input, game.activeSeat, -0.1, 0.6);
      expect(game.arrowsFor('p1')).toBe(game.arrowsFor('p2'));
    }
  });

  it('resets the bow for the next archer', () => {
    shoot(game, input, 'p1', 0.6, 0.9);
    expect(game.aimAngle).toBe(0);
    expect(game.aimPower).toBe(0);
  });

  it('starts each turn with a fresh gallery of twenty', () => {
    shoot(game, input, 'p1', 0, 0.5);
    expect(game.burstCount).toBe(0);
  });
});

describe('the keyboard, exactly as the manifest describes it', () => {
  let game: ArcheryMasterGame;
  let manager: InputManager;
  let view: InputView;

  beforeEach(() => {
    game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    manager = new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' });
    view = new InputView();
  });

  function drive(times = 1): void {
    for (let i = 0; i < times; i += 1) {
      manager.setBoardSeat(game.getActiveSeat());
      game.update(STEP, view.sync(manager.beginStep(STEP)));
    }
  }

  it('binds the keys the manifest actually names', () => {
    expect(DEFAULT_BINDINGS.p1).toEqual({
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      action: 'Space',
    });
    expect(DEFAULT_BINDINGS.p2.action).toBe('Enter');
  });

  it('swings the bow left with A and right with D, for seat one', () => {
    manager.keyDown('KeyA');
    drive(30);
    expect(game.aimAngle).toBeLessThan(-0.4);
    expect(game.aimAngle).toBeCloseTo(-AIM_KEY_RATE * 30 * STEP, 5);
    manager.keyUp('KeyA');
    manager.keyDown('KeyD');
    drive(60);
    expect(game.aimAngle).toBeGreaterThan(0);
  });

  it('sets the draw with W and S, for seat one', () => {
    manager.keyDown('KeyS');
    drive(30);
    expect(game.aimPower).toBeCloseTo(DRAW_KEY_RATE * 30 * STEP, 5);
    manager.keyUp('KeyS');
    manager.keyDown('KeyW');
    drive(20);
    expect(game.aimPower).toBeLessThan(DRAW_KEY_RATE * 30 * STEP);
  });

  it('shoots when Space is let go, for seat one', () => {
    manager.keyDown('KeyS');
    drive(40);
    manager.keyDown('Space');
    drive(2);
    expect(game.arrowInFlight).toBe(false);
    manager.keyUp('Space');
    drive(1);
    expect(game.arrowInFlight).toBe(true);
  });

  it('never lets a key cross the aim limit however long it is held', () => {
    // Inside one shot clock, which is 210 steps: past that the clock looses the arrow and
    // the next archer starts from a fresh bow.
    manager.keyDown('KeyD');
    manager.keyDown('KeyS');
    drive(150);
    expect(game.aimAngle).toBeCloseTo(AIM_LIMIT, 9);
    expect(game.aimPower).toBe(1);
  });

  it('crosses the whole aim and the whole draw well inside the shot clock', () => {
    const acrossSeconds = (2 * AIM_LIMIT) / AIM_KEY_RATE;
    const drawSeconds = 1 / DRAW_KEY_RATE;
    expect(acrossSeconds).toBeLessThan(1.5);
    expect(drawSeconds).toBeLessThan(1.3);
    expect(acrossSeconds + drawSeconds).toBeLessThan(3.5);
  });

  it("leaves seat two's keys inert while it is seat one's turn", () => {
    manager.keyDown('ArrowLeft');
    manager.keyDown('ArrowDown');
    drive(40);
    expect(game.aimAngle).toBe(0);
    expect(game.aimPower).toBe(0);
    manager.keyDown('Enter');
    drive(2);
    manager.keyUp('Enter');
    drive(2);
    expect(game.arrowInFlight).toBe(false);
  });

  it('answers seat two on its own turn, with arrows and Enter', () => {
    manager.keyDown('KeyS');
    drive(20);
    manager.keyDown('Space');
    drive(2);
    manager.keyUp('Space');
    manager.keyUp('KeyS');
    drive(90);
    expect(game.getActiveSeat()).toBe('p2');

    manager.keyDown('ArrowLeft');
    drive(30);
    expect(game.aimAngle).toBeLessThan(-0.4);
    manager.keyUp('ArrowLeft');
    manager.keyDown('ArrowDown');
    drive(30);
    expect(game.aimPower).toBeGreaterThan(0.3);
    manager.keyUp('ArrowDown');
    manager.keyDown('Enter');
    drive(2);
    manager.keyUp('Enter');
    drive(1);
    expect(game.arrowInFlight).toBe(true);
  });

  it("leaves seat one's keys inert while it is seat two's turn", () => {
    manager.keyDown('Space');
    drive(2);
    manager.keyUp('Space');
    drive(90);
    expect(game.getActiveSeat()).toBe('p2');
    manager.keyDown('KeyA');
    manager.keyDown('KeyS');
    drive(40);
    expect(game.aimAngle).toBe(0);
    expect(game.aimPower).toBe(0);
  });

  it('finishes a whole match on the keyboard alone', () => {
    let steps = 0;
    for (; steps < 60 * 600; steps += 1) {
      manager.setBoardSeat(game.getActiveSeat());
      // Hold a draw and the action for ever: the clock and the release both fire.
      if (steps % 40 === 0) manager.keyDown('Space');
      if (steps % 40 === 20) manager.keyUp('Space');
      manager.keyDown('KeyS');
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).not.toBeNull();
  });

  it('reaches the same aim from a finger and from the keys', () => {
    // Parity in the plainest terms: two instruments, one stored aim, no mode between them.
    manager.keyDown('KeyD');
    drive(24);
    const byKey = game.aimAngle;
    const other = new ArcheryMasterGame();
    other.init(makeContext(null, null));
    const fake = new FakeInput();
    touch(fake, 'p1', byKey, 0);
    other.update(STEP, fake);
    expect(other.aimAngle).toBeCloseTo(byKey, 6);
  });

  it('takes a finger and then the keys within one shot, with nothing to switch', () => {
    const fake = new FakeInput();
    touch(fake, 'p1', 0.2, 0.4);
    game.update(STEP, fake);
    expect(game.aimAngle).toBeCloseTo(0.2, 6);
    manager.keyDown('KeyD');
    drive(12);
    expect(game.aimAngle).toBeGreaterThan(0.2);
  });
});

describe('the shot clock', () => {
  let game: ArcheryMasterGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    input = new FakeInput();
  });

  it('runs down while a turn is being taken', () => {
    step(game, input, 60);
    expect(game.shotClockSeconds).toBeCloseTo(2.5, 1);
  });

  it('looses the arrow as it stands when it runs out', () => {
    step(game, input, 210);
    expect(game.arrowInFlight).toBe(true);
    expect(game.aimPower).toBe(0);
  });

  it('runs while the bow is drawn, so nobody can hold a shot for ever', () => {
    touch(input, 'p1', 0, 1);
    step(game, input, 211);
    expect(game.arrowInFlight).toBe(true);
  });

  it('refills for the next archer', () => {
    shoot(game, input, 'p1', 0, 0.5);
    expect(game.shotClockSeconds).toBeGreaterThan(3);
  });

  it('scores nothing for an arrow nobody drew', () => {
    step(game, input, 210);
    finishTurn(game, input);
    expect(game.targetsFor('p1')).toBe(0);
    expect(game.blanksFor('p1')).toBe(1);
  });
});

describe('skewering targets', () => {
  let game: ArcheryMasterGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    input = new FakeInput();
  });

  it('takes the target the bow was pointed at', () => {
    let taken = 0;
    for (let index = 0; index < RACK_SIZE; index += 1) {
      const fresh = new ArcheryMasterGame();
      fresh.init(makeContext(null, null));
      const aim = aimAtTarget(fresh, index);
      if (aim === null) continue;
      const fakes = new FakeInput();
      shoot(fresh, fakes, 'p1', aim.angle, aim.power);
      if (fresh.targetsFor('p1') >= 1) taken += 1;
    }
    expect(taken).toBeGreaterThan(RACK_SIZE - 3);
  });

  it('scores nothing when the bow is barely drawn', () => {
    shoot(game, input, 'p1', 0, 0);
    expect(game.targetsFor('p1')).toBe(0);
    expect(game.blanksFor('p1')).toBe(1);
  });

  it('bursts targets as the arrow reaches them, not all at the end', () => {
    const aim = aimAtTarget(game, 0);
    expect(aim).not.toBeNull();
    touch(input, 'p1', aim!.angle, aim!.power);
    step(game, input, 4);
    lift(input, 'p1');
    step(game, input, 1);
    input.clear();
    let seenMidFlight = false;
    for (let i = 0; i < 90; i += 1) {
      step(game, input);
      const flying = game.arrowInFlight;
      if (!flying) break;
      if (game.burstCount > 0) seenMidFlight = true;
    }
    expect(seenMidFlight).toBe(true);
  });

  it('counts every burst target on the card by the time the arrow rests', () => {
    const aim = aimAtTarget(game, 4);
    expect(aim).not.toBeNull();
    shoot(game, input, 'p1', aim!.angle, aim!.power);
    expect(game.targetsFor('p1')).toBe(game.lastShotCount);
  });

  it('records the arrow once, whatever it took', () => {
    const aim = aimAtTarget(game, 4);
    shoot(game, input, 'p1', aim?.angle ?? 0, aim?.power ?? 0.5);
    expect(game.arrowsFor('p1')).toBe(1);
    expect(game.bestFor('p1')).toBe(game.lastShotCount);
  });

  it('keeps a flight inside the ceiling the termination bound is built on', () => {
    for (let i = 0; i < 8; i += 1) {
      shoot(game, input, game.activeSeat, (i / 8) * AIM_LIMIT, i / 8);
      expect(game.lastShotSeconds).toBeLessThan(MAX_FLIGHT_SECONDS);
      expect(game.lastShotSeconds).toBeGreaterThan(0);
    }
  });
});

describe('both seats play the same field', () => {
  it('reads a mirrored finger as the same aim', () => {
    // Seat two touches the board upside down; the engine turns the point round, and the
    // two seats must arrive at the same bow.
    const upright = new ArcheryMasterGame();
    upright.init(makeContext(null, null, 'single-seat'));
    const a = new FakeInput();
    touch(a, 'p1', 0.35, 0.62);
    upright.update(STEP, a);

    const flipped = new ArcheryMasterGame();
    flipped.init(makeContext(null, null, 'shared-screen', 'p2'));
    // Seat one is the far seat here, so its board is rotated and its finger arrives
    // mirrored about the centre of the logical box.
    const b = new FakeInput();
    touch(b, 'p1', 0.35, 0.62, true);
    flipped.update(STEP, b);

    expect(flipped.aimAngle).toBeCloseTo(upright.aimAngle, 6);
    expect(flipped.aimPower).toBeCloseTo(upright.aimPower, 6);
  });

  it('steps the identical match in both presentations', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const shared = new ArcheryMasterGame();
      shared.init(makeContext('normal', 'hard', 'shared-screen', 'p1', 400 + seed));
      const single = new ArcheryMasterGame();
      single.init(makeContext('normal', 'hard', 'single-seat', 'p1', 400 + seed));
      const input = new FakeInput();
      for (let i = 0; i < 60 * 400; i += 1) {
        shared.update(STEP, input);
        if (shared.getScore().winner !== null) break;
      }
      for (let i = 0; i < 60 * 400; i += 1) {
        single.update(STEP, input);
        if (single.getScore().winner !== null) break;
      }
      expect(single.getScore()).toEqual(shared.getScore());
    }
  });

  it('gives neither seat an advantage from shooting first', () => {
    // The race is never decided in the middle of a round, so a seat that crosses seventy
    // is always answered before anything is awarded.
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    const input = new FakeInput();
    for (let round = 0; round < 40; round += 1) {
      if (game.getScore().winner !== null) break;
      shoot(game, input, game.activeSeat, 0, 0.5);
      expect(Math.abs(game.arrowsFor('p1') - game.arrowsFor('p2'))).toBeLessThanOrEqual(1);
      if (game.shotInRound === 0) {
        expect(game.arrowsFor('p1')).toBe(game.arrowsFor('p2'));
      }
    }
  });
});

describe('the board turning', () => {
  it('refuses input while it turns', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    const input = new FakeInput();
    // Seat one is local, so its turn needs no flip; take a shot to hand over to seat two.
    shoot(game, input, 'p1', 0, 0.5);
    expect(game.activeSeat).toBe('p2');
    touch(input, 'p2', 0.5, 0.9);
    step(game, input, 1);
    // Still turning: the aim has not moved.
    expect(game.aimAngle).toBe(0);
  });

  it('stops the shot clock for the turn, for a bot as much as for a person', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    const input = new FakeInput();
    shoot(game, input, 'p1', 0, 0.5);
    const before = game.shotClockSeconds;
    step(game, input, 1);
    expect(game.shotClockSeconds).toBe(before);
  });

  it('holds the gallery still through the turn, so both presentations agree', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    const input = new FakeInput();
    shoot(game, input, 'p1', 0, 0.5);
    expect(game.turnSeconds).toBe(0);
    step(game, input, 5);
    expect(game.turnSeconds).toBe(0);
  });
});

describe('pausing', () => {
  it('lets the nock down, so a drawn bow does not fire on its own', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    const input = new FakeInput();
    touch(input, 'p1', 0.2, 0.8);
    step(game, input, 10);
    game.onPause();
    game.onResume();
    // A pause drops every key and pointer without a release; the release that arrives
    // afterwards must not loose a shot the player never took.
    input.clear();
    input.p1.actionReleased = true;
    step(game, input, 1);
    expect(game.arrowInFlight).toBe(false);
  });
});

describe('the bot', () => {
  function playOut(
    p1: BotDifficulty | null,
    p2: BotDifficulty | null,
    seed = 5,
  ): ArcheryMasterGame {
    const game = new ArcheryMasterGame();
    game.init(makeContext(p1, p2, 'single-seat', 'p1', seed));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    return game;
  }

  it('finishes a match against another bot', () => {
    const game = playOut('easy', 'easy');
    expect(game.getScore().winner).not.toBeNull();
  });

  it('races to seventy rather than running out of rounds', () => {
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const game = playOut(tier, tier, 77);
      const score = game.getScore();
      expect(Math.max(score.p1, score.p2)).toBeGreaterThanOrEqual(TARGET_GOAL);
      expect(game.roundIndex).toBeLessThan(ROUND_CAP - 1);
    }
  });

  it('shoots the same number of arrows as its opponent', () => {
    const game = playOut('normal', 'hard');
    expect(game.arrowsFor('p1')).toBe(game.arrowsFor('p2'));
  });

  it('plays a stronger game at each tier', () => {
    // Seat two never touches anything, so each of these is one tier racing to seventy on
    // its own — and what separates them is how many arrows it takes, not the final count,
    // which is seventy-something in all three by definition of a race.
    const easy = playOut('easy', null, 31);
    const normal = playOut('normal', null, 31);
    const hard = playOut('hard', null, 31);
    for (const game of [easy, normal, hard]) {
      expect(game.targetsFor('p1')).toBeGreaterThanOrEqual(TARGET_GOAL);
    }
    expect(normal.arrowsFor('p1')).toBeLessThan(easy.arrowsFor('p1'));
    expect(hard.arrowsFor('p1')).toBeLessThan(normal.arrowsFor('p1'));
  });

  it('beats a weaker tier from either seat', () => {
    expect(playOut('hard', 'easy', 12).getScore().winner).toBe('p1');
    expect(playOut('easy', 'hard', 12).getScore().winner).toBe('p2');
    expect(playOut('normal', 'easy', 13).getScore().winner).toBe('p1');
    expect(playOut('easy', 'normal', 13).getScore().winner).toBe('p2');
  });

  it('is on the same clock as a person, and never runs one out', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext('hard', 'hard'));
    const input = new FakeInput();
    let clockRanOut = 0;
    for (let i = 0; i < 60 * 90; i += 1) {
      game.update(STEP, input);
      if (game.shotClockSeconds <= 0) clockRanOut += 1;
      if (game.getScore().winner !== null) break;
    }
    expect(clockRanOut).toBe(0);
  });

  it('draws the bow to somewhere legal on every shot', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext('easy', 'hard'));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, input);
      expect(game.aimAngle).toBeGreaterThanOrEqual(-AIM_LIMIT);
      expect(game.aimAngle).toBeLessThanOrEqual(AIM_LIMIT);
      expect(game.aimPower).toBeGreaterThanOrEqual(0);
      expect(game.aimPower).toBeLessThanOrEqual(1);
      if (game.getScore().winner !== null) break;
    }
  });

  it('plays a different match at each tier from the same seed', () => {
    const easy = playOut('easy', 'easy', 91);
    const hard = playOut('hard', 'hard', 91);
    expect(hard.getScore()).not.toEqual(easy.getScore());
  });

  it('plays a different match from two absent humans', () => {
    const bots = playOut('normal', 'normal', 55);
    const nobody = playOut(null, null, 55);
    expect(bots.getScore()).not.toEqual(nobody.getScore());
  });
});

describe('termination', () => {
  it('ends 0-0 as a draw when nobody ever touches anything', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    const input = new FakeInput();
    let steps = 0;
    for (; steps < 60 * 600; steps += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const score = game.getScore();
    expect(score.p1).toBe(0);
    expect(score.p2).toBe(0);
    expect(score.winner).toBe('draw');
    expect(game.arrowsFor('p1')).toBe(ROUND_CAP);
    expect(game.arrowsFor('p2')).toBe(ROUND_CAP);
    expect(steps).toBeLessThan(60 * 400);
  });

  it('stays ended once it has ended', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext('hard', 'hard'));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const settled = game.getScore();
    step(game, input, 300);
    expect(game.getScore()).toEqual(settled);
  });

  it('never runs past the round cap', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 600; i += 1) {
      game.update(STEP, input);
      expect(game.roundIndex).toBeLessThan(ROUND_CAP);
      if (game.getScore().winner !== null) break;
    }
  });
});

describe('the same match at any step rate', () => {
  function play(seed: number, stepSeconds: number, p1: BotDifficulty, p2: BotDifficulty) {
    const game = new ArcheryMasterGame();
    game.init(makeContext(p1, p2, 'single-seat', 'p1', seed));
    const input = new FakeInput();
    const limit = Math.round(600 / stepSeconds);
    for (let i = 0; i < limit; i += 1) {
      game.update(stepSeconds, input);
      if (game.getScore().winner !== null) break;
    }
    return { score: game.getScore(), rounds: game.roundIndex, best: game.bestFor('p1') };
  }

  it('is bit-identical at 60, 90 and 120 Hz', () => {
    for (let seed = 0; seed < 8; seed += 1) {
      const at60 = play(700 + seed, 1 / 60, 'easy', 'hard');
      const at90 = play(700 + seed, 1 / 90, 'easy', 'hard');
      const at120 = play(700 + seed, 1 / 120, 'easy', 'hard');
      expect(at90).toEqual(at60);
      expect(at120).toEqual(at60);
    }
  });

  it('resolves the same human shot the same way at both rates', () => {
    const a = new ArcheryMasterGame();
    a.init(makeContext(null, null));
    const b = new ArcheryMasterGame();
    b.init(makeContext(null, null));
    const inputA = new FakeInput();
    const inputB = new FakeInput();
    touch(inputA, 'p1', 0.24, 0.78);
    for (let i = 0; i < 12; i += 1) a.update(1 / 60, inputA);
    lift(inputA, 'p1');
    a.update(1 / 60, inputA);
    touch(inputB, 'p1', 0.24, 0.78);
    for (let i = 0; i < 24; i += 1) b.update(1 / 120, inputB);
    lift(inputB, 'p1');
    b.update(1 / 120, inputB);
    expect(b.lastShotCount).toBe(a.lastShotCount);
    expect(b.lastShotSeconds).toBeCloseTo(a.lastShotSeconds, 12);
  });
});

describe('drawing', () => {
  let game: ArcheryMasterGame;
  let renderer: RecordingRenderer;

  beforeEach(() => {
    game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    renderer = new RecordingRenderer();
  });

  it('balances every rotation it pushes', () => {
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
  });

  it('draws something', () => {
    game.render(renderer, 0);
    expect(renderer.calls).toBeGreaterThan(40);
    expect(renderer.texts).toBeGreaterThan(3);
  });

  it('keeps every number it draws finite and inside its own box', () => {
    const input = new FakeInput();
    for (let i = 0; i < 400; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    for (const value of renderer.numbers) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(Math.max(FIELD_WIDTH, FIELD_HEIGHT) * 2);
    }
  });

  it('says what the race is', () => {
    game.render(renderer, 0);
    expect(renderer.labels.join(' ')).toContain(String(TARGET_GOAL));
  });

  it('draws twenty standing targets and no more', () => {
    game.render(renderer, 0);
    const rack = game.rackFor(0);
    const faces = renderer.discs.filter((disc) => Math.abs(disc.radius - 29) < 1e-9);
    expect(faces).toHaveLength(rack.length);
  });

  it('draws the targets where the rules put them', () => {
    const input = new FakeInput();
    step(game, input, 37);
    game.render(renderer, 0);
    const rack = game.rackFor(0);
    for (const target of rack) {
      const x = targetXAt(target, game.turnSeconds);
      const found = renderer.discs.some(
        (disc) => Math.abs(disc.x - x) < 1e-6 && Math.abs(disc.y - target.y) < 1e-6,
      );
      expect(found).toBe(true);
    }
  });

  it("marks seat one's hand with a disc and seat two's with a square", () => {
    const input = new FakeInput();
    touch(input, 'p1', 0.3, 0.5);
    step(game, input, 2);
    game.render(renderer, 0);
    const handX = padXFor(game.aimAngle);
    const handY = padYFor(game.aimPower);
    expect(
      renderer.discs.some(
        (disc) =>
          Math.abs(disc.radius - 15) < 1e-9 &&
          Math.abs(disc.x - handX) < 1e-6 &&
          Math.abs(disc.y - handY) < 1e-6,
      ),
    ).toBe(true);

    shoot(game, input, 'p1', 0.3, 0.5);
    expect(game.activeSeat).toBe('p2');
    touch(input, 'p2', -0.2, 0.4);
    step(game, input, 2);
    const second = new RecordingRenderer();
    game.render(second, 0);
    const twoX = padXFor(game.aimAngle);
    const twoY = padYFor(game.aimPower);
    expect(
      second.boxes.some(
        (box) =>
          Math.abs(box.width - 28) < 1e-9 &&
          Math.abs(box.x + 14 - twoX) < 1e-6 &&
          Math.abs(box.y + 14 - twoY) < 1e-6,
      ),
    ).toBe(true);
    expect(
      second.discs.some(
        (disc) => Math.abs(disc.radius - 15) < 1e-9 && Math.abs(disc.x - twoX) < 1e-6,
      ),
    ).toBe(false);
  });

  it('turns the board for the far seat and leaves it upright for the near one', () => {
    const shared = new ArcheryMasterGame();
    shared.init(makeContext(null, null, 'shared-screen', 'p1'));
    const input = new FakeInput();
    const upright = new RecordingRenderer();
    shared.render(upright, 0);
    expect(upright.angles[0]).toBe(0);
    shoot(shared, input, 'p1', 0, 0.5);
    // The turn is handed on and the board only then begins to swing; give it the 0.36 s.
    step(shared, input, 30);
    const turned = new RecordingRenderer();
    shared.render(turned, 0);
    expect(turned.angles[0]).toBeCloseTo(Math.PI, 6);
  });

  it('never turns the board in single-seat play', () => {
    const input = new FakeInput();
    for (let i = 0; i < 4; i += 1) {
      shoot(game, input, game.activeSeat, 0, 0.4);
      const check = new RecordingRenderer();
      game.render(check, 0);
      expect(check.angles[0]).toBe(0);
    }
  });

  it('keeps drawing after the match is over', () => {
    const finished = new ArcheryMasterGame();
    finished.init(makeContext('hard', 'hard'));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 600; i += 1) {
      finished.update(STEP, input);
      if (finished.getScore().winner !== null) break;
    }
    const after = new RecordingRenderer();
    finished.render(after, 0);
    expect(after.calls).toBeGreaterThan(20);
    expect(after.depth).toBe(0);
  });

  it('draws the arrow on the arc it was resolved along', () => {
    const input = new FakeInput();
    touch(input, 'p1', 0.3, 0.8);
    step(game, input, 4);
    lift(input, 'p1');
    step(game, input, 6);
    expect(game.arrowInFlight).toBe(true);
    game.render(renderer, 0);
    const heads = renderer.discs.filter((disc) => Math.abs(disc.radius - 5) < 1e-9);
    expect(heads.length).toBeGreaterThan(0);
    for (const head of heads) {
      expect(head.y).toBeLessThanOrEqual(BOW_Y + 60);
      expect(head.x).toBeGreaterThanOrEqual(0);
      expect(head.x).toBeLessThanOrEqual(FIELD_WIDTH);
    }
  });
});

describe('tearing down', () => {
  it('empties both cards', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext('hard', 'hard'));
    const input = new FakeInput();
    step(game, input, 600);
    game.destroy();
    expect(game.targetsFor('p1')).toBe(0);
    expect(game.targetsFor('p2')).toBe(0);
    expect(game.arrowsFor('p1')).toBe(0);
    expect(game.bestFor('p1')).toBe(0);
  });

  it('can be stood back up and played again', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext('hard', 'hard'));
    const input = new FakeInput();
    step(game, input, 600);
    game.destroy();
    game.init(makeContext('hard', 'hard'));
    expect(game.getScore().winner).toBeNull();
    expect(game.roundIndex).toBe(0);
    expect(game.activeSeat).toBe('p1');
  });
});

describe('the manifest', () => {
  it('declares the box the game simulates in', () => {
    expect(manifest.logical.width).toBe(FIELD_WIDTH);
    expect(manifest.logical.height).toBe(FIELD_HEIGHT);
  });

  it('is a turn game with a shared board', () => {
    expect(manifest.archetype).toBe('turn-aim');
    expect(manifest.zoneSplit).toBe('shared-board');
  });

  it('offers a friend and a bot', () => {
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
  });

  it('names both instruments', () => {
    expect(manifest.controls.keyboard.length).toBeGreaterThan(20);
    expect(manifest.controls.pointer.length).toBeGreaterThan(20);
  });

  it('names the keys it is actually bound to', () => {
    const keyboard = manifest.controls.keyboard;
    expect(keyboard).toMatch(/A and D/);
    expect(keyboard).toMatch(/W and S/);
    expect(keyboard).toMatch(/Space/);
    expect(keyboard).toMatch(/arrows/i);
    expect(keyboard).toMatch(/Enter/);
  });

  it("never offers the two key halves as one player's choice", () => {
    expect(manifest.controls.keyboard).not.toMatch(/\bor\b[^,:]*arrow/i);
    expect(manifest.controls.keyboard).toMatch(/player one|player two|seat/i);
  });

  it('says the pointer idiom the pad actually implements', () => {
    expect(manifest.controls.pointer).toMatch(/pad/i);
    expect(manifest.controls.pointer).toMatch(/draw/i);
    expect(manifest.controls.pointer).toMatch(/lift/i);
  });
});

describe('the Game contract', () => {
  it('is satisfied by the exported class', () => {
    // Typed as the interface on purpose: the SDK declares render(renderer, alpha) and a
    // concrete class declares render(renderer), so a call against the class type would
    // not compile with an alpha — which is exactly what the CI typecheck catches.
    const game: Game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    const renderer = new RecordingRenderer();
    game.render(renderer, 0.5);
    game.onPause();
    game.onResume();
    expect(game.getActiveSeat?.()).toBe('p1');
    game.destroy();
  });

  it('reports a seat for every step of a match', () => {
    const game: Game = new ArcheryMasterGame();
    game.init(makeContext('easy', 'easy'));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, input);
      const seat = game.getActiveSeat?.();
      expect(seat === 'p1' || seat === 'p2').toBe(true);
      if (game.getScore().winner !== null) break;
    }
  });

  it('scores two finite numbers at every step', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext('normal', 'easy'));
    const input = new FakeInput();
    for (let i = 0; i < 60 * 200; i += 1) {
      game.update(STEP, input);
      const score = game.getScore();
      expect(Number.isFinite(score.p1)).toBe(true);
      expect(Number.isFinite(score.p2)).toBe(true);
      if (score.winner !== null) break;
    }
  });
});

describe('a garbled aim', () => {
  it('never lets a bad number reach the arrow', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    const input = new FakeInput();
    input.p1.pointer = { x: Number.NaN, y: Number.NaN };
    input.p1.actionHeld = true;
    step(game, input, 3);
    lift(input, 'p1');
    step(game, input, 1);
    expect(game.arrowInFlight).toBe(true);
    expect(Number.isFinite(game.lastShotSeconds)).toBe(true);
    expect(game.lastShotCount).toBeGreaterThanOrEqual(0);
  });

  it('survives an infinite finger', () => {
    const game = new ArcheryMasterGame();
    game.init(makeContext(null, null));
    const input = new FakeInput();
    input.p1.pointer = { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY };
    input.p1.actionHeld = true;
    step(game, input, 3);
    lift(input, 'p1');
    step(game, input, 1);
    expect(game.arrowInFlight).toBe(true);
    finishTurn(game, input);
    expect(game.arrowsFor('p1')).toBe(1);
  });
});
