import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { MancalaGame, slotCentre } from './game.js';
import { P1_STORE, P2_STORE, PITS_PER_SIDE, STONES_PER_PIT, firstPitOf } from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL_W = 900;
const LOGICAL_H = 900;
const TOTAL = PITS_PER_SIDE * 2 * STONES_PER_PIT;
const MATCH_TIMEOUT_MS = 60_000;

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

function tapSlot(input: FakeInput, seat: SeatId, slot: number, rotated = false): void {
  slotCentre(aim, slot);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated
    ? { x: LOGICAL_W - aim.x, y: LOGICAL_H - aim.y }
    : { x: aim.x, y: aim.y };
  target.actionPressed = true;
  target.actionHeld = true;
}

function step(game: MancalaGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

function settleFlip(game: MancalaGame, input: FakeInput): void {
  input.clear();
  step(game, input, 40);
}

function totalOnBoard(game: MancalaGame): number {
  let total = 0;
  for (let slot = 0; slot <= P2_STORE; slot += 1) total += game.stonesIn(slot);
  return total;
}

describe('taking turns', () => {
  let game: MancalaGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new MancalaGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts with p1, every pit full and both stores empty', () => {
    expect(game.activeSeat).toBe('p1');
    expect(game.stonesIn(P1_STORE)).toBe(0);
    expect(game.stonesIn(P2_STORE)).toBe(0);
    expect(totalOnBoard(game)).toBe(TOTAL);
  });

  it('sows the pit that was tapped and passes the turn', () => {
    // Pit 0 has four stones, which land in 1..4 — not the store, so the turn passes.
    tapSlot(input, 'p1', 0);
    step(game, input);
    expect(game.stonesIn(0)).toBe(0);
    expect(game.stonesIn(1)).toBe(STONES_PER_PIT + 1);
    expect(game.activeSeat).toBe('p2');
  });

  it('keeps the turn when the last stone lands in your own store', () => {
    // Four stones from pit 2 land in 3, 4, 5 and 6 — and 6 is p1's store.
    tapSlot(input, 'p1', 2);
    step(game, input);
    expect(game.stonesIn(P1_STORE)).toBe(1);
    expect(game.activeSeat, 'landing in your own store grants another turn').toBe('p1');
  });

  it('ignores a tap on an empty pit', () => {
    tapSlot(input, 'p1', 0);
    step(game, input);
    settleFlip(game, input);
    // p2's turn now; tapping p1's emptied pit does nothing at all.
    tapSlot(input, 'p2', 0);
    step(game, input);
    expect(game.activeSeat, 'an illegal move must not pass the turn').toBe('p2');
  });

  it("ignores a tap on the other seat's pit", () => {
    tapSlot(input, 'p1', firstPitOf('p2'));
    step(game, input);
    expect(game.activeSeat).toBe('p1');
    expect(totalOnBoard(game)).toBe(TOTAL);
  });

  it('ignores a tap on a store', () => {
    tapSlot(input, 'p1', P1_STORE);
    step(game, input);
    expect(game.activeSeat).toBe('p1');
    expect(game.stonesIn(P1_STORE)).toBe(0);
  });

  it('ignores a tap on nothing at all', () => {
    input.p1.pointer = { x: 10, y: 10 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.activeSeat).toBe('p1');
  });

  it('never creates or loses a stone', () => {
    for (let i = 0; i < 6; i += 1) {
      input.clear();
      step(game, input);
      const seat = game.activeSeat;
      const first = firstPitOf(seat);
      for (let pit = 0; pit < PITS_PER_SIDE; pit += 1) {
        if (game.stonesIn(first + pit) > 0) {
          tapSlot(input, seat, first + pit);
          break;
        }
      }
      step(game, input);
      expect(totalOnBoard(game), `after move ${String(i)}`).toBe(TOTAL);
      settleFlip(game, input);
    }
  });
});

describe('playing with the keyboard alone', () => {
  it('moves the cursor along the row and sows with the action', () => {
    const game = new MancalaGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    set(input.p1.move, 1, 0);
    step(game, input);
    const chosen = game.cursorPit;
    expect(chosen).toBeGreaterThan(0);
    input.clear();
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.stonesIn(chosen), 'the chosen pit was sown').toBe(0);
  });

  it("keeps the cursor inside the active seat's row", () => {
    const game = new MancalaGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (let i = 0; i < 60; i += 1) {
      input.clear();
      step(game, input);
      set(input.p1.move, i % 2 === 0 ? 1 : -1, 0);
      step(game, input);
      expect(game.cursorPit).toBeGreaterThanOrEqual(0);
      expect(game.cursorPit).toBeLessThan(PITS_PER_SIDE);
    }
  });
});

describe('a whole match', () => {
  it('finishes with every stone banked', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new MancalaGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'normal'));

    for (let i = 0; i < 200_000; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }

    const score = game.getScore();
    expect(score.winner, 'the match never finished').not.toBeNull();
    // The sweep at the end is what makes this add up. Without it, stones are stranded on
    // the board and the final score is simply wrong.
    expect(score.p1 + score.p2, 'stones were stranded on the board').toBe(TOTAL);
  });

  it('replays identically from the same seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const play = (): string => {
      const game = new MancalaGame();
      const input = new FakeInput();
      game.init(makeContext('hard', 'easy', 'single-seat', 'p1', 5150));
      const trace: string[] = [];
      for (let i = 0; i < 200_000; i += 1) {
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
    const game = new MancalaGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 5);

    const renderer = new RecordingRenderer();
    game.render(renderer);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.circles).toBeGreaterThan(0);
    expect(renderer.texts).toBe(0);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new MancalaGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    tapSlot(input, 'p1', 0);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer);
    }
    expect(renderer.angles.every((a) => a === 0)).toBe(true);
  });

  it('turns to face the far seat in shared-screen', () => {
    const game = new MancalaGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    tapSlot(input, 'p1', 0);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer);
    }
    expect(renderer.angles.some((a) => a > 0.01)).toBe(true);
  });

  it('restores the opening board on destroy', () => {
    const game = new MancalaGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapSlot(input, 'p1', 0);
    step(game, input);
    game.destroy();
    expect(game.stonesIn(0)).toBe(STONES_PER_PIT);
    expect(game.stonesIn(P1_STORE)).toBe(0);
  });
});
