import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { AIM_CENTRE_X, AIM_CENTRE_Y, AIM_RADIUS, DartsGame } from './game.js';
import { STARTING_SCORE } from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL_W = 700;
const LOGICAL_H = 1000;

class FakeSeat implements SeatInput {
  readonly move: Vec2 = vec2();
  pointer: Vec2 | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
  holdSecondsAtRelease = 0;
  pointerCancelled = false;
}

class FakeInput implements InputState {
  readonly p1 = new FakeSeat();
  readonly p2 = new FakeSeat();

  seat(seat: SeatId): SeatInput {
    return seat === 'p1' ? this.p1 : this.p2;
  }

  clear(): void {
    set(this.p1.move, 0, 0);
    set(this.p2.move, 0, 0);
    this.p1.pointer = null;
    this.p1.actionPressed = false;
    this.p1.pointerCancelled = false;
    this.p2.pointer = null;
    this.p2.actionPressed = false;
    this.p2.pointerCancelled = false;
  }
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  calls = 0;
  circles = 0;
  lines = 0;
  texts = 0;

  clear(): void {
    this.calls += 1;
  }
  rect(): void {
    this.calls += 1;
  }
  strokeRect(): void {
    this.calls += 1;
  }
  circle(): void {
    this.calls += 1;
    this.circles += 1;
  }
  strokeCircle(): void {
    this.calls += 1;
    this.circles += 1;
  }
  line(): void {
    this.calls += 1;
    this.lines += 1;
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
    expect(value.length).toBeGreaterThan(0);
    expect(Number.isFinite(x + y + sizePx)).toBe(true);
    expect(colour.length).toBeGreaterThan(0);
    expect(align === undefined || align.length > 0).toBe(true);
  }
  angles: number[] = [];
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

/** Drags the aim control to a point, in the frame the seat sees it. */
function aimAt(input: FakeInput, seat: SeatId, dx: number, dy: number, rotated = false): void {
  const x = AIM_CENTRE_X + dx * AIM_RADIUS;
  const y = AIM_CENTRE_Y + dy * AIM_RADIUS;
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: LOGICAL_W - x, y: LOGICAL_H - y } : { x, y };
  target.actionHeld = true;
}

/**
 * Releases, which is what commits a pointer throw.
 *
 * The pointer is cleared, because that is what actually happens when a finger lifts —
 * and modelling it any other way is how a real bug got past this suite: the game asked
 * whether a pointer was present *on the release step*, found none, took the keyboard
 * branch, and never threw the dart.
 */
function release(input: FakeInput, seat: SeatId): void {
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = null;
  target.actionHeld = false;
  target.actionReleased = true;
}

/**
 * Takes the gesture away rather than letting it go — a `pointercancel`, a pause, a lost
 * focus. The pointer is already gone on this step, and the engine never raises a release
 * alongside a cancel: they are opposite events.
 */
function cancel(input: FakeInput, seat: SeatId): void {
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = null;
  target.actionHeld = false;
  target.actionReleased = false;
  target.pointerCancelled = true;
}

function step(game: DartsGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** Aims, throws, and waits for the dart to land. */
function throwAt(game: DartsGame, input: FakeInput, seat: SeatId, dx: number, dy: number): void {
  input.clear();
  aimAt(input, seat, dx, dy);
  step(game, input);
  release(input, seat);
  step(game, input);
  input.clear();
  step(game, input, 30);
}

describe('taking turns', () => {
  let game: DartsGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new DartsGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts both seats at 301 with p1 to throw', () => {
    expect(game.activeSeat).toBe('p1');
    expect(game.remainingFor('p1')).toBe(STARTING_SCORE);
    expect(game.remainingFor('p2')).toBe(STARTING_SCORE);
    expect(game.getScore()).toMatchObject({ p1: STARTING_SCORE, p2: STARTING_SCORE });
  });

  it('reports points remaining rather than points scored', () => {
    // The number a darts player reads. A HUD counting upwards would be true and useless.
    throwAt(game, input, 'p1', 0, 0);
    expect(game.getScore().p1).toBeLessThan(STARTING_SCORE);
  });

  it('throws on release, not on press', () => {
    // Aiming and committing are separate acts, so a player can take as long as they like
    // over the aim and the throw is never a surprise.
    aimAt(input, 'p1', 0, 0);
    step(game, input, 5);
    expect(game.dartsThrownThisTurn, 'holding must not throw').toBe(0);
    release(input, 'p1');
    step(game, input, 30);
    expect(game.dartsThrownThisTurn).toBe(1);
  });

  it('will not throw before the player has aimed', () => {
    // A stray release with no aim would otherwise throw a dart at dead centre.
    input.p1.actionReleased = true;
    step(game, input, 10);
    expect(game.dartsThrownThisTurn).toBe(0);
  });

  it('hands over after three darts', () => {
    for (let i = 0; i < 3; i += 1) throwAt(game, input, 'p1', 0.1, 0.1);
    expect(game.activeSeat).toBe('p2');
  });

  it('accepts nothing while a dart is in flight', () => {
    // A fast tapper must not throw three darts before the first is scored.
    input.clear();
    aimAt(input, 'p1', 0, 0);
    step(game, input);
    release(input, 'p1');
    step(game, input);
    const during = game.dartsThrownThisTurn;
    input.clear();
    aimAt(input, 'p1', 0.5, 0.5);
    release(input, 'p1');
    step(game, input, 2);
    expect(game.dartsThrownThisTurn).toBe(during);
  });

  it("clears the previous seat's darts when the turn changes", () => {
    for (let i = 0; i < 3; i += 1) throwAt(game, input, 'p1', 0.1, 0.1);
    expect(game.activeSeat).toBe('p2');
    expect(game.stuckDartCount, 'the board is cleared for the next thrower').toBe(0);
  });
});

describe('a gesture taken away', () => {
  // A cancel is not a release. Per `docs/input-idiom.md` it **abandons** the gesture, so
  // the aim it was carrying is dropped and nothing is committed.
  let game: DartsGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new DartsGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('abandons an aim cancelled while the player is still aiming', () => {
    aimAt(input, 'p1', 0.6, -0.6);
    step(game, input);
    expect(game.hasAimed).toBe(true);

    input.clear();
    cancel(input, 'p1');
    step(game, input);
    expect(game.hasAimed, 'the aim is abandoned, not held').toBe(false);
    expect(game.aimX).toBe(0);
    expect(game.aimY).toBe(0);
    expect(game.dartsThrownThisTurn, 'and nothing is committed').toBe(0);
  });

  it('sees a cancel that lands while a dart is in flight', () => {
    // `update()` returns early during the flight, so before #2505 the one step the cancel
    // was raised on had passed before the game ever looked at the seat, and the bit — which
    // lasts exactly one step — was gone. The committed dart still lands, because it was
    // committed before the cancel; what must not survive is the aim it left behind.
    aimAt(input, 'p1', 0.6, -0.6);
    step(game, input);
    release(input, 'p1');
    step(game, input);
    expect(game.dartsThrownThisTurn, 'in the air, not yet scored').toBe(0);

    input.clear();
    cancel(input, 'p1');
    step(game, input);
    input.clear();
    step(game, input, 30);

    expect(game.dartsThrownThisTurn, 'the dart already committed still lands').toBe(1);
    expect(game.activeSeat, 'one dart of three: still the same turn').toBe('p1');
    expect(game.hasAimed, 'the next dart must be aimed afresh').toBe(false);
    expect(game.aimX).toBe(0);
    expect(game.aimY).toBe(0);
  });

  it('still throws on an ordinary release', () => {
    // The regression the cancel handling must not cause: a release is still a release.
    aimAt(input, 'p1', 0.2, 0.2);
    step(game, input);
    release(input, 'p1');
    step(game, input, 30);
    expect(game.dartsThrownThisTurn).toBe(1);
  });
});

describe('playing with the keyboard alone', () => {
  it('moves the sight and throws with the action, with no pointer at all', () => {
    const game = new DartsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    set(input.p1.move, 0, -1);
    step(game, input, 20);
    input.clear();
    input.p1.actionPressed = true;
    step(game, input, 30);

    expect(game.dartsThrownThisTurn).toBe(1);
    expect(game.remainingFor('p1')).toBeLessThanOrEqual(STARTING_SCORE);
  });

  it('commits on press for a key, since there is nothing to preview', () => {
    const game = new DartsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    set(input.p1.move, 1, 0);
    step(game, input, 10);
    input.clear();
    input.p1.actionPressed = true;
    step(game, input);
    // In flight already, before any release.
    step(game, input, 30);
    expect(game.dartsThrownThisTurn).toBe(1);
  });
});

describe('a whole match', () => {
  // A 301 match driven a step at a time is tens of thousands of steps.
  const MATCH_TIMEOUT_MS = 60_000;

  it('finishes, with one seat on exactly zero', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new DartsGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'hard'));

    for (let i = 0; i < 40_000; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }

    const score = game.getScore();
    expect(score.winner, 'the match never finished').not.toBeNull();
    // The double-out rule means the winner lands on exactly zero, never below.
    expect(Math.min(score.p1, score.p2)).toBe(0);
    expect(score.p1).toBeGreaterThanOrEqual(0);
    expect(score.p2).toBeGreaterThanOrEqual(0);
  });

  it('replays identically from the same seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const play = (): string => {
      const game = new DartsGame();
      const input = new FakeInput();
      game.init(makeContext('hard', 'normal', 'single-seat', 'p1', 24680));
      const trace: string[] = [];
      for (let i = 0; i < 40_000; i += 1) {
        game.update(STEP, input);
        const s = game.getScore();
        trace.push(`${String(s.p1)}:${String(s.p2)}`);
        if (s.winner !== null) break;
      }
      return trace.join('|');
    };
    expect(play()).toBe(play());
  });

  it('never lets a seat go below zero', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new DartsGame();
    const input = new FakeInput();
    game.init(makeContext('easy', 'hard'));
    for (let i = 0; i < 40_000; i += 1) {
      game.update(STEP, input);
      const s = game.getScore();
      expect(s.p1).toBeGreaterThanOrEqual(0);
      expect(s.p2).toBeGreaterThanOrEqual(0);
      if (s.winner !== null) break;
    }
  });
});

describe('lifecycle and render', () => {
  it('renders a balanced frame and draws no text', () => {
    const game = new DartsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 5);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.circles).toBeGreaterThan(0);
    expect(renderer.texts).toBe(0);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new DartsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    for (let i = 0; i < 3; i += 1) throwAt(game, input, 'p1', 0.1, 0.1);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.every((a) => a === 0)).toBe(true);
  });

  it('turns to face the far seat in shared-screen', () => {
    const game = new DartsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    for (let i = 0; i < 3; i += 1) throwAt(game, input, 'p1', 0.1, 0.1);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.some((a) => a > 0.01)).toBe(true);
  });

  it('resets both seats on destroy', () => {
    const game = new DartsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    throwAt(game, input, 'p1', 0, 0);
    game.destroy();
    expect(game.remainingFor('p1')).toBe(STARTING_SCORE);
    expect(game.stuckDartCount).toBe(0);
  });
});
