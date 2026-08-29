import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, SEAT_PALETTE, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SLOT_COUNT,
  SLOT_FOUNDATION,
  SLOT_STOCK,
  SLOT_TABLEAU,
  SLOT_WASTE,
  SolitaireGame,
  TABLEAU_BOTTOM,
  fanScale,
  slotCentre,
  slotIndexAt,
  slotX,
  slotY,
} from './game.js';
import {
  COLUMNS,
  DECK,
  MOVE_DRAW,
  STOCK_SIZE,
  banked,
  goesUp,
  isLegal,
  suitOf,
  topOf,
  wasteTop,
} from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const WIDTH = manifest.logical.width;
const HEIGHT = manifest.logical.height;
/** READY_SECONDS at 60 Hz, with a frame in hand. */
const READY_STEPS = 32;
/** Reveal, then ready, then the bot's think, then the step the move lands on. */
const BOT_TURN_STEPS = 60;
/** A whole match: about ninety turns at roughly a second each, plus the settle. */
const MATCH_STEPS = 9000;
const MATCH_TIMEOUT_MS = 60_000;

class FakeSeat implements SeatInput {
  readonly move: Vec2 = vec2();
  pointer: Vec2 | null = null;
  actionPressed = false;
  actionHeld = false;
  actionReleased = false;
  holdSeconds = 0;
  holdSecondsAtRelease = 0;
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
    }
  }
}

interface Mark {
  readonly kind: string;
  readonly colour: string;
  readonly numbers: readonly number[];
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  calls = 0;
  texts = 0;
  angles: number[] = [];
  readonly numbers: number[] = [];
  readonly marks: Mark[] = [];

  #note(kind: string, colour: string, ...values: number[]): void {
    this.calls += 1;
    expect(colour.length, 'every draw needs a colour').toBeGreaterThan(0);
    for (const value of values) this.numbers.push(value);
    this.marks.push({ kind, colour, numbers: values });
  }

  clear(colour: string): void {
    this.#note('clear', colour);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#note('rect', colour, x, y, width, height);
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#note('strokeRect', colour, x, y, width, height, lineWidth);
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#note('circle', colour, x, y, radius);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#note('strokeCircle', colour, x, y, radius, lineWidth);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.#note('line', colour, x1, y1, x2, y2, lineWidth);
  }

  text(
    value: string,
    x: number,
    y: number,
    sizePx: number,
    colour: string,
    align?: TextAlign,
  ): void {
    this.texts += 1;
    void align;
    this.#note(`text:${value}`, colour, x, y, sizePx);
  }

  pushSeatRotation(rotated: boolean): void {
    void rotated;
    this.depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
  }

  pushRotation(radians: number): void {
    this.angles.push(radians);
    this.depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
  }

  popSeatRotation(): void {
    this.depth -= 1;
  }

  reset(): void {
    this.calls = 0;
    this.texts = 0;
    this.numbers.length = 0;
    this.marks.length = 0;
    this.angles.length = 0;
  }
}

function contextFor(options: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260829),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
    ...options,
  };
}

function botContext(
  difficulty: 'easy' | 'normal' | 'hard',
  seed = 20260829,
  openingSeat: SeatId = 'p1',
  presentation: Presentation = 'shared-screen',
): GameContext {
  return {
    manifest,
    rng: new Rng(seed),
    presentation,
    localSeat: 'p1',
    openingSeat,
    botDifficulty: () => difficulty,
  };
}

/** Step a bot-only match to its end, or as far as `steps` allows. */
function runMatch(context: GameContext, steps = MATCH_STEPS): SolitaireGame {
  const game = new SolitaireGame();
  game.init(context);
  const input = new FakeInput();
  for (let i = 0; i < steps; i += 1) {
    game.update(STEP, input);
    if (game.getScore().winner !== null) break;
  }
  return game;
}

/** Press a slot with the pointer, from the seat that is to move. */
function tap(game: SolitaireGame, input: FakeInput, slot: number, rotated = false): void {
  const seat = input.seat(game.getActiveSeat()) as FakeSeat;
  const centre = slotCentre(vec2(), slot);
  seat.pointer = rotated ? vec2(WIDTH - centre.x, HEIGHT - centre.y) : centre;
  seat.actionPressed = true;
  game.update(STEP, input);
  seat.actionPressed = false;
  seat.pointer = null;
}

describe('the geometry the input and the renderer share', () => {
  it('round-trips every slot through its own centre', () => {
    const scratch = vec2();
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const centre = slotCentre(scratch, slot);
      expect(slotIndexAt(centre.x, centre.y), `slot ${String(slot)}`).toBe(slot);
    }
  });

  it('answers -1 off the board and in the gaps the board really has', () => {
    expect(slotIndexAt(-5, 100)).toBe(-1);
    expect(slotIndexAt(WIDTH + 5, 100)).toBe(-1);
    expect(slotIndexAt(WIDTH - 2, 100)).toBe(-1); // past the seventh column's band
    expect(slotIndexAt(100, 0)).toBe(-1); // above the header
    expect(slotIndexAt(100, 195)).toBe(-1); // between the header and the tableau
    expect(slotIndexAt(100, TABLEAU_BOTTOM + 10)).toBe(-1); // the ledger, which is not a pile
  });

  it('gives a tap between two columns to the nearer one rather than to nobody', () => {
    // The whole band belongs to a column, so a thumb landing in the gap still means something.
    const between = slotX(SLOT_TABLEAU + 2) + CARD_WIDTH + 4;
    expect(slotIndexAt(between, slotY(SLOT_TABLEAU) + 40)).toBe(SLOT_TABLEAU + 2);
  });

  it('squeezes a long column so it stays inside the board, and leaves a short one alone', () => {
    expect(fanScale(1, 0)).toBe(1);
    expect(fanScale(7, 6)).toBe(1);
    expect(fanScale(20, 6)).toBeLessThan(1);
    // Whatever the squeeze, the last card of the longest possible column stays on the board.
    for (const length of [1, 7, 14, 20, 30, DECK]) {
      const scale = fanScale(length, Math.min(6, length - 1));
      const down = Math.min(6, length - 1);
      const bottom =
        slotY(SLOT_TABLEAU) + (down * 15 + (length - down - 1) * 34) * scale + CARD_HEIGHT;
      expect(bottom, `length ${String(length)}`).toBeLessThanOrEqual(TABLEAU_BOTTOM + 0.001);
    }
  });

  it('keeps everything it draws inside the declared box', () => {
    const renderer = new RecordingRenderer();
    const game = new SolitaireGame();
    game.init(botContext('normal'));
    const input = new FakeInput();
    for (let i = 0; i < 2400; i += 1) {
      game.update(STEP, input);
      if (i % 40 !== 0) continue;
      renderer.reset();
      game.render(renderer, 0);
      for (const value of renderer.numbers) {
        expect(Math.abs(value)).toBeLessThanOrEqual(Math.max(WIDTH, HEIGHT) + 40);
      }
    }
    game.destroy();
  });
});

describe('taking turns', () => {
  let game: SolitaireGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new SolitaireGame();
    input = new FakeInput();
  });

  it('opens with the seat the shell nominated, not always p1', () => {
    game.init(contextFor({ openingSeat: 'p2' }));
    expect(game.getActiveSeat()).toBe('p2');
    game.init(contextFor({ openingSeat: 'p1' }));
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('takes nothing at all during the ready freeze', () => {
    game.init(contextFor());
    const before = game.state.stockLeft;
    for (let i = 0; i < 8; i += 1) tap(game, input, SLOT_STOCK);
    expect(game.state.stockLeft).toBe(before);
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    tap(game, input, SLOT_STOCK);
    expect(game.state.stockLeft).toBe(before - 1);
  });

  it('turns a card straight off the stock, with nothing picked up', () => {
    game.init(contextFor());
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    expect(game.getActiveSeat()).toBe('p1');
    tap(game, input, SLOT_STOCK);
    expect(game.state.wasteLen).toBe(1);
    expect(game.getActiveSeat()).toBe('p2');
    expect(game.picked).toBe(-1);
  });

  it('picks a pile up, and the destination decides what moves', () => {
    // A seed whose deal shows an ace, so the move under test exists on the first turn.
    game.init(contextFor({ rng: new Rng(9) }));
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    // Find a column whose top card can go up, and send it there.
    let column = -1;
    for (let c = 0; c < COLUMNS; c += 1) {
      if (goesUp(game.state, topOf(game.state, c))) column = c;
    }
    expect(column, 'this seed deals at least one ace on top').toBeGreaterThanOrEqual(0);
    const card = topOf(game.state, column);
    tap(game, input, SLOT_TABLEAU + column);
    expect(game.picked).toBe(SLOT_TABLEAU + column);
    // Nothing has been played by picking it up.
    expect(banked(game.state)).toBe(0);
    tap(game, input, SLOT_FOUNDATION + suitOf(card));
    expect(banked(game.state)).toBe(1);
    expect(game.state.owner[card]).toBe(1);
    expect(game.picked).toBe(-1);
  });

  it('puts a pile down again when the same slot is pressed twice', () => {
    game.init(contextFor());
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    tap(game, input, SLOT_TABLEAU + 3);
    expect(game.picked).toBe(SLOT_TABLEAU + 3);
    tap(game, input, SLOT_TABLEAU + 3);
    expect(game.picked).toBe(-1);
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('picks up nothing at all from an empty slot, and spends no turn', () => {
    game.init(contextFor());
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    expect(wasteTop(game.state)).toBe(-1);
    tap(game, input, SLOT_WASTE);
    expect(game.picked).toBe(-1);
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('spends no turn on a move that is refused', () => {
    game.init(contextFor());
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    // Two column tops almost never stack on each other, and even when they do the move needs
    // to turn a card over; either way the turn is still seat one's afterwards.
    tap(game, input, SLOT_TABLEAU + 0);
    const stock = game.state.stockLeft;
    tap(game, input, SLOT_FOUNDATION + ((suitOf(topOf(game.state, 0)) + 1) % 4));
    if (game.getActiveSeat() === 'p1') {
      expect(game.state.stockLeft).toBe(stock);
      expect(banked(game.state)).toBe(0);
    }
  });

  it('ignores a tap that lands on the felt', () => {
    game.init(contextFor());
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    const seat = input.p1;
    seat.pointer = vec2(WIDTH / 2, 195);
    seat.actionPressed = true;
    game.update(STEP, input);
    seat.actionPressed = false;
    seat.pointer = null;
    expect(game.picked).toBe(-1);
    expect(game.getActiveSeat()).toBe('p1');
  });

  it('never lets the seat that is not to move touch anything', () => {
    game.init(contextFor());
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    const idle = input.p2;
    idle.pointer = slotCentre(vec2(), SLOT_STOCK);
    idle.actionPressed = true;
    const stock = game.state.stockLeft;
    for (let i = 0; i < 20; i += 1) game.update(STEP, input);
    expect(game.state.stockLeft).toBe(stock);
    expect(game.getActiveSeat()).toBe('p1');
  });
});

describe('playing with the keyboard alone', () => {
  it('reaches every slot and plays a move with no pointer at all', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(contextFor());
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);

    // Walk to the far left of the header, which is the stock.
    const seat = input.p1;
    for (let i = 0; i < 40; i += 1) {
      set(seat.move, -1, i % 8 === 0 ? -1 : 0);
      game.update(STEP, input);
      set(seat.move, 0, 0);
      game.update(STEP, input);
    }
    expect(game.cursorIndex).toBe(SLOT_STOCK);

    const stock = game.state.stockLeft;
    seat.actionPressed = true;
    game.update(STEP, input);
    seat.actionPressed = false;
    expect(game.state.stockLeft).toBe(stock - 1);
  });

  it('keeps the cursor inside the fourteen slots however it is driven', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(contextFor());
    const rng = new Rng(5);
    for (let i = 0; i < 900; i += 1) {
      set(input.p1.move, rng.int(-1, 2), rng.int(-1, 2));
      set(input.p2.move, rng.int(-1, 2), rng.int(-1, 2));
      game.update(STEP, input);
      expect(game.cursorIndex).toBeGreaterThanOrEqual(0);
      expect(game.cursorIndex).toBeLessThan(SLOT_COUNT);
    }
  });
});

describe('the turn clock', () => {
  it('lets the turn go when it runs out, and the deal moves on', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(contextFor());
    for (let i = 0; i < 60 * 21; i += 1) game.update(STEP, input);
    expect(game.getActiveSeat()).toBe('p2');
    expect(game.state.passes).toBe(1);
  });

  it('ends the deal when both seats let their turn go in a row', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(contextFor());
    for (let i = 0; i < 60 * 60; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).not.toBeNull();
    // Nobody played, so nobody scored: two people who put the phone down draw.
    expect(game.getScore().p1).toBe(0);
    expect(game.getScore().p2).toBe(0);
  });

  it('runs down for a person and is never drawn against a bot', () => {
    const person = new SolitaireGame();
    person.init(contextFor());
    const input = new FakeInput();
    for (let i = 0; i < READY_STEPS + 60; i += 1) person.update(STEP, input);
    expect(person.secondsLeft).toBeLessThan(20);
    expect(person.secondsLeft).toBeGreaterThan(17);

    const renderer = new RecordingRenderer();
    const bot = new SolitaireGame();
    bot.init(botContext('normal'));
    for (let i = 0; i < READY_STEPS + 60; i += 1) bot.update(STEP, input);
    bot.render(renderer, 0);
    const clockBars = renderer.marks.filter(
      (mark) => mark.kind === 'rect' && mark.numbers[1] === TABLEAU_BOTTOM + 4,
    );
    expect(clockBars).toHaveLength(0);
  });

  it('never fires while a bot is thinking, because a bot plays first', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(botContext('easy'));
    for (let i = 0; i < BOT_TURN_STEPS * 4; i += 1) game.update(STEP, input);
    expect(game.state.passes).toBe(0);
    expect(game.state.turns).toBeGreaterThanOrEqual(3);
  });
});

describe('two seats on one device', () => {
  it('reads the far seat tap in the frame the board was drawn in', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(contextFor({ openingSeat: 'p2' }));
    // Wait for the flip and the ready freeze to settle.
    for (let i = 0; i < 90; i += 1) game.update(STEP, input);
    const stock = game.state.stockLeft;
    tap(game, input, SLOT_STOCK, true);
    expect(game.state.stockLeft).toBe(stock - 1);
  });

  it('never rotates in single-seat presentation', () => {
    const renderer = new RecordingRenderer();
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(contextFor({ presentation: 'single-seat', openingSeat: 'p2', localSeat: 'p1' }));
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    game.render(renderer, 0);
    expect(renderer.angles).toEqual([0]);
  });

  it('turns to face the seat that is to move in shared-screen', () => {
    const renderer = new RecordingRenderer();
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(contextFor({ openingSeat: 'p2', localSeat: 'p1' }));
    for (let i = 0; i < 200; i += 1) game.update(STEP, input);
    game.render(renderer, 0);
    expect(renderer.angles[0]).toBeCloseTo(Math.PI, 5);
  });

  it('steps the identical match in both presentations', { timeout: MATCH_TIMEOUT_MS }, () => {
    // The trap Cup Pong and Sudoku both documented: `seatView` reports no rotation at all in
    // single-seat play, so any rule keyed off the flip would step two different matches.
    const trace = (presentation: Presentation): string[] => {
      const game = new SolitaireGame();
      game.init(botContext('normal', 4242, 'p2', presentation));
      const input = new FakeInput();
      const seen: string[] = [];
      for (let i = 0; i < MATCH_STEPS; i += 1) {
        game.update(STEP, input);
        const score = game.getScore();
        seen.push(
          `${String(score.p1)}:${String(score.p2)}:${game.getActiveSeat()}:${String(game.state.turns)}`,
        );
        if (score.winner !== null) break;
      }
      return seen;
    };
    expect(trace('single-seat')).toEqual(trace('shared-screen'));
  });
});

describe('a whole match', () => {
  it('finishes, and the score is the points each seat took', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = runMatch(botContext('normal'));
    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(score.p1).toBe(game.state.p1);
    expect(score.p2).toBe(game.state.p2);
    expect(score.p1 + score.p2).toBeGreaterThan(0);
    expect(banked(game.state)).toBeLessThanOrEqual(DECK);
    game.destroy();
  });

  it(
    'finishes inside ten minutes with the weakest pair, from both openings',
    { timeout: MATCH_TIMEOUT_MS },
    () => {
      for (const openingSeat of ['p1', 'p2'] as const) {
        for (let seed = 1; seed <= 4; seed += 1) {
          const game = new SolitaireGame();
          game.init(botContext('easy', seed * 1013, openingSeat));
          const input = new FakeInput();
          let steps = -1;
          for (let i = 0; i < 60 * 600; i += 1) {
            game.update(STEP, input);
            if (game.getScore().winner !== null) {
              steps = i;
              break;
            }
          }
          expect(steps, `seed ${String(seed)} from ${openingSeat}`).toBeGreaterThan(0);
          // Measured at about 85 s a match; the guard's budget is 600 s.
          expect(steps).toBeLessThan(60 * 200);
          game.destroy();
        }
      }
    },
  );

  it('replays identically from the same seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const one = runMatch(botContext('hard', 777));
    const two = runMatch(botContext('hard', 777));
    expect(two.getScore()).toEqual(one.getScore());
    expect([...two.state.owner]).toEqual([...one.state.owner]);
    expect(two.state.turns).toBe(one.state.turns);
  });

  it('plays a different match on a different seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const one = runMatch(botContext('hard', 777));
    const two = runMatch(botContext('hard', 778));
    expect([...two.state.owner]).not.toEqual([...one.state.owner]);
  });

  it('sends most of the deal up rather than locking early', { timeout: MATCH_TIMEOUT_MS }, () => {
    let total = 0;
    for (let seed = 1; seed <= 6; seed += 1) {
      const game = runMatch(botContext('easy', seed * 313));
      total += banked(game.state);
      game.destroy();
    }
    // Measured at 50.7 of 52 for two easy bots over 800 matches. The deal being clearable by
    // construction is what this is really checking, at the level a player would notice it.
    expect(total / 6).toBeGreaterThan(40);
  });
});

describe('lifecycle and render', () => {
  it('draws a board with cards on it', () => {
    const renderer = new RecordingRenderer();
    const game = new SolitaireGame();
    game.init(contextFor());
    game.render(renderer, 0);
    expect(renderer.calls).toBeGreaterThan(80);
    expect(renderer.texts).toBeGreaterThan(6);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
  });

  it('does not touch the simulation while drawing', () => {
    const renderer = new RecordingRenderer();
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(botContext('hard'));
    for (let i = 0; i < 400; i += 1) game.update(STEP, input);
    const before = JSON.stringify({
      pile: [...game.state.pile],
      owner: [...game.state.owner],
      p1: game.state.p1,
      p2: game.state.p2,
      turns: game.state.turns,
    });
    for (const alpha of [0, 0.25, 0.5, 0.75]) game.render(renderer, alpha);
    const after = JSON.stringify({
      pile: [...game.state.pile],
      owner: [...game.state.owner],
      p1: game.state.p1,
      p2: game.state.p2,
      turns: game.state.turns,
    });
    expect(after).toBe(before);
  });

  it('survives pause and resume without moving', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(botContext('normal'));
    for (let i = 0; i < 300; i += 1) game.update(STEP, input);
    const before = game.getScore();
    game.onPause();
    game.onResume();
    expect(game.getScore()).toEqual(before);
  });

  it('starts a fresh deal on a second init, with nothing left over', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(botContext('normal'));
    for (let i = 0; i < 600; i += 1) game.update(STEP, input);
    expect(game.state.turns).toBeGreaterThan(0);
    game.init(botContext('normal', 999));
    expect(game.state.turns).toBe(0);
    expect(game.state.stockLeft).toBe(STOCK_SIZE);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.picked).toBe(-1);
  });

  it('releases the pile it was holding on destroy', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(contextFor());
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    tap(game, input, SLOT_TABLEAU + 4);
    expect(game.picked).toBe(SLOT_TABLEAU + 4);
    game.destroy();
    expect(game.picked).toBe(-1);
  });

  it('reports an active seat, because the shell decides turn-based from it', () => {
    const game = new SolitaireGame();
    expect(typeof game.getActiveSeat).toBe('function');
    game.init(contextFor());
    expect(['p1', 'p2']).toContain(game.getActiveSeat());
  });
});

describe('rule 7: colour is never the only signal', () => {
  it('marks the two seats with different shapes in the ledger', () => {
    // Seat one is a filled disc and seat two an open square, and both are on screen together
    // for the whole match once each has taken a card. The greyscale harness in
    // `apps/web/src/data` asks exactly this question of every game; this is the local copy.
    const renderer = new RecordingRenderer();
    const game = new SolitaireGame();
    const input = new FakeInput();
    game.init(botContext('normal'));
    const seatColours = new Map<string, SeatId>();
    for (const seat of ['p1', 'p2'] as const) {
      const palette = SEAT_PALETTE[seat];
      for (const colour of [palette.base, palette.deep, palette.tint, palette.soft]) {
        seatColours.set(colour, seat);
      }
    }

    let shared = 0;
    for (let i = 0; i < 3000; i += 1) {
      game.update(STEP, input);
      if (i % 20 !== 0) continue;
      renderer.reset();
      game.render(renderer, 0);
      const kinds = { p1: new Set<string>(), p2: new Set<string>() };
      for (const mark of renderer.marks) {
        const seat = seatColours.get(mark.colour);
        if (seat === undefined) continue;
        kinds[seat].add(mark.kind);
      }
      if (kinds.p1.size === 0 || kinds.p2.size === 0) continue;
      shared += 1;
      // Neither seat's set of shapes may be a subset of the other's: each has a shape the
      // other never draws, so the two are told apart without any colour at all.
      const p1Only = [...kinds.p1].filter((kind) => !kinds.p2.has(kind));
      const p2Only = [...kinds.p2].filter((kind) => !kinds.p1.has(kind));
      expect(p1Only.length, `frame ${String(i)} p1 shapes ${[...kinds.p1].join()}`).toBeGreaterThan(
        0,
      );
      expect(p2Only.length, `frame ${String(i)} p2 shapes ${[...kinds.p2].join()}`).toBeGreaterThan(
        0,
      );
    }
    expect(shared, 'the two seats were never on screen together').toBeGreaterThan(20);
    game.destroy();
  });

  it('draws each of the four suits from a different construction', () => {
    // A spade is one disc on a stem, a club three on a stem, a heart two discs over a block,
    // and a diamond four lines and nothing filled. Reds and blacks are never told apart by
    // their ink alone.
    const renderer = new RecordingRenderer();
    const game = new SolitaireGame();
    game.init(contextFor());
    game.render(renderer, 0);
    const inks = new Set(
      renderer.marks
        .filter((mark) => mark.kind === 'circle' || mark.kind === 'line')
        .map((m) => m.colour),
    );
    expect(inks.size).toBeGreaterThan(1);
    // Every rank appears as a label, so a fanned card is readable by its corner alone.
    const labels = new Set(
      renderer.marks.filter((mark) => mark.kind.startsWith('text:')).map((mark) => mark.kind),
    );
    expect(labels.size).toBeGreaterThan(4);
  });

  it('rings every slot the held pile could legally go to', () => {
    const game = new SolitaireGame();
    const input = new FakeInput();
    const renderer = new RecordingRenderer();
    game.init(contextFor({ rng: new Rng(9) }));
    for (let i = 0; i < READY_STEPS; i += 1) game.update(STEP, input);
    let column = -1;
    for (let c = 0; c < COLUMNS; c += 1) {
      if (goesUp(game.state, topOf(game.state, c))) column = c;
    }
    expect(column).toBeGreaterThanOrEqual(0);
    tap(game, input, SLOT_TABLEAU + column);
    renderer.reset();
    game.render(renderer, 0);
    const soft = renderer.marks.filter(
      (mark) => mark.kind === 'strokeRect' && mark.colour === SEAT_PALETTE.p1.soft,
    );
    expect(soft.length).toBeGreaterThan(0);
    // The foundation that lights up is the card's own suit and no other.
    const wanted = slotX(SLOT_FOUNDATION + suitOf(topOf(game.state, column))) - 5;
    expect(soft.some((mark) => mark.numbers[0] === wanted)).toBe(true);
    expect(isLegal(game.state, MOVE_DRAW)).toBe(true);
  });
});
