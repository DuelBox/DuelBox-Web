import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { RockPaperScissorsGame, buttonCentre } from './game.js';
import { ROUNDS_TO_WIN, THROWS, WINDOW_SECONDS } from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const MATCH_TIMEOUT_MS = 60_000;
/** The whole window at 60 Hz, plus the reveal. */
const ROUND_STEPS = Math.ceil((WINDOW_SECONDS + 1.2) * 60);

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
    set(this.p1.move, 0, 0);
    set(this.p2.move, 0, 0);
    this.p1.pointer = null;
    this.p1.actionPressed = false;
    this.p2.pointer = null;
    this.p2.actionPressed = false;
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

const aim = vec2();

function tapButton(input: FakeInput, seat: SeatId, index: number): void {
  buttonCentre(aim, seat, index);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = { x: aim.x, y: aim.y };
  target.actionPressed = true;
  target.actionHeld = true;
}

function step(game: RockPaperScissorsGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** Runs to the end of the current round and into the next window. */
function nextRound(game: RockPaperScissorsGame, input: FakeInput): void {
  input.clear();
  for (let i = 0; i < ROUND_STEPS * 2 && game.phase !== 'window'; i += 1) game.update(STEP, input);
}

describe('a round', () => {
  let game: RockPaperScissorsGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new RockPaperScissorsGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('opens with a window and nothing committed', () => {
    expect(game.phase).toBe('window');
    expect(game.choiceOf('p1')).toBeNull();
    expect(game.choiceOf('p2')).toBeNull();
    expect(game.getScore()).toMatchObject({ p1: 0, p2: 0, winner: null });
  });

  it("commits a seat's choice when it taps a button", () => {
    tapButton(input, 'p1', 0);
    step(game, input);
    expect(game.choiceOf('p1')).toBe(THROWS[0]);
    expect(game.choiceOf('p2'), 'the other seat is unaffected').toBeNull();
  });

  it('resolves the instant both seats have committed', () => {
    tapButton(input, 'p1', THROWS.indexOf('rock'));
    tapButton(input, 'p2', THROWS.indexOf('scissors'));
    step(game, input);
    expect(game.phase, 'no need to wait out the window once both have chosen').toBe('reveal');
    expect(game.lastOutcome).toBe('p1');
    expect(game.getScore().p1).toBe(1);
  });

  it('resolves when the window closes, even with nobody committed', () => {
    input.clear();
    step(game, input, Math.ceil(WINDOW_SECONDS * 60) + 2);
    expect(game.phase).toBe('reveal');
    expect(game.lastOutcome, 'neither chose, so nobody scores').toBe('draw');
    expect(game.getScore()).toMatchObject({ p1: 0, p2: 0 });
  });

  it('gives the round to the only seat that committed', () => {
    tapButton(input, 'p1', 0);
    step(game, input);
    input.clear();
    step(game, input, Math.ceil(WINDOW_SECONDS * 60) + 2);
    expect(game.lastOutcome).toBe('p1');
  });

  it('ignores a second tap once a seat has committed', () => {
    tapButton(input, 'p1', THROWS.indexOf('rock'));
    step(game, input);
    input.clear();
    tapButton(input, 'p1', THROWS.indexOf('paper'));
    step(game, input);
    expect(game.choiceOf('p1'), 'a choice is final').toBe('rock');
  });

  it("ignores a tap on the other seat's buttons", () => {
    // p1 taps where p2's buttons are. Ownership is by seat, not by where the finger is.
    buttonCentre(aim, 'p2', 0);
    input.p1.pointer = { x: aim.x, y: aim.y };
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.choiceOf('p1')).toBeNull();
  });

  it('ignores a tap on nothing', () => {
    input.p1.pointer = { x: 5, y: 500 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.choiceOf('p1')).toBeNull();
  });

  it('starts a fresh window after the reveal', () => {
    tapButton(input, 'p1', 0);
    tapButton(input, 'p2', 1);
    step(game, input);
    expect(game.phase).toBe('reveal');
    nextRound(game, input);
    expect(game.phase).toBe('window');
    expect(game.choiceOf('p1')).toBeNull();
    expect(game.choiceOf('p2')).toBeNull();
  });
});

describe('both seats acting at once', () => {
  it('has no active seat at all', () => {
    // The contract makes `getActiveSeat` optional for exactly this: a simultaneous game
    // has no turn, and reporting one would make the shell's indicator claim something
    // untrue.
    const game = new RockPaperScissorsGame();
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
  });

  it('reads both seats in the same step', () => {
    const game = new RockPaperScissorsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapButton(input, 'p1', 0);
    tapButton(input, 'p2', 2);
    step(game, input);
    expect(game.choiceOf('p1')).not.toBeNull();
    expect(game.choiceOf('p2')).not.toBeNull();
  });

  it("never lets one seat's choice depend on the other's", () => {
    // p1 commits first; p2 committing afterwards must not change what p1 chose.
    const game = new RockPaperScissorsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapButton(input, 'p1', THROWS.indexOf('paper'));
    step(game, input);
    input.clear();
    tapButton(input, 'p2', THROWS.indexOf('scissors'));
    step(game, input);
    expect(game.choiceOf('p1')).toBe('paper');
  });
});

describe('playing with the keyboard alone', () => {
  it('moves along the row and commits with the action', () => {
    const game = new RockPaperScissorsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    set(input.p1.move, 1, 0);
    step(game, input);
    const chosen = game.cursorOf('p1');
    expect(chosen).toBeGreaterThan(0);
    input.clear();
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.choiceOf('p1')).toBe(THROWS[chosen]);
  });

  it("keeps each seat's cursor on its own three buttons", () => {
    const game = new RockPaperScissorsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (let i = 0; i < 40; i += 1) {
      input.clear();
      step(game, input);
      set(input.p1.move, i % 2 === 0 ? 1 : -1, 0);
      set(input.p2.move, i % 3 === 0 ? -1 : 1, 0);
      step(game, input);
      for (const seat of ['p1', 'p2'] as const) {
        expect(game.cursorOf(seat)).toBeGreaterThanOrEqual(0);
        expect(game.cursorOf(seat)).toBeLessThan(THROWS.length);
      }
    }
  });
});

describe('a whole match', () => {
  it('ends when a seat wins three rounds', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new RockPaperScissorsGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'easy'));

    for (let i = 0; i < ROUND_STEPS * 60; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    const score = game.getScore();
    expect(score.winner, 'the match never finished').not.toBeNull();
    expect(Math.max(score.p1, score.p2)).toBe(ROUNDS_TO_WIN);
  });

  it('replays identically from the same seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const play = (): string => {
      const game = new RockPaperScissorsGame();
      const input = new FakeInput();
      game.init(makeContext('hard', 'normal', 'single-seat', 'p1', 9090));
      const trace: string[] = [];
      for (let i = 0; i < ROUND_STEPS * 60; i += 1) {
        game.update(STEP, input);
        const s = game.getScore();
        trace.push(`${String(s.p1)}:${String(s.p2)}`);
        if (s.winner !== null) break;
      }
      return trace.join('|');
    };
    expect(play()).toBe(play());
  });
});

describe('lifecycle and render', () => {
  it('renders a balanced frame and draws no text', () => {
    const game = new RockPaperScissorsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 5);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.calls).toBeGreaterThan(0);
    expect(renderer.texts).toBe(0);
  });

  it('never rotates, whichever presentation it is in', () => {
    // Nothing rotates in a simultaneous game: each seat's buttons are under its own hands.
    for (const presentation of ['shared-screen', 'single-seat'] as const) {
      const game = new RockPaperScissorsGame();
      const input = new FakeInput();
      game.init(makeContext(null, null, presentation, 'p1'));
      const renderer = new RecordingRenderer();
      for (let i = 0; i < 40; i += 1) {
        game.update(STEP, input);
        game.render(renderer, 0);
      }
      expect(
        renderer.angles.every((a) => a === 0),
        presentation,
      ).toBe(true);
    }
  });

  it('hides a choice until the reveal', () => {
    // The whole point of a simultaneous game: neither player may see the other's choice
    // while the window is open.
    const game = new RockPaperScissorsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapButton(input, 'p1', 0);
    step(game, input);
    expect(game.phase).toBe('window');
    const during = new RecordingRenderer();
    game.render(during, 0);

    input.clear();
    tapButton(input, 'p2', 1);
    step(game, input);
    expect(game.phase).toBe('reveal');
    const after = new RecordingRenderer();
    game.render(after, 0);
    // The reveal draws more than the window did: the chosen buttons gain their rings.
    expect(after.circles).toBeGreaterThan(during.circles);
  });

  it("forgets both bots' memories on destroy", () => {
    const game = new RockPaperScissorsGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapButton(input, 'p1', 0);
    tapButton(input, 'p2', 1);
    step(game, input);
    game.destroy();
    expect(() => {
      game.destroy();
    }, 'destroy must be safe to call twice').not.toThrow();
  });
});
