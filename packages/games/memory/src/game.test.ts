import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import {
  CARD_COUNT,
  CARD_PITCH,
  MATCH_SECONDS,
  MISMATCH_SECONDS,
  MemoryMatchGame,
  PAIRS,
  THINK_SECONDS,
  cardCentre,
} from './game.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const RATE = 60;
const STEP = 1 / RATE;
const MATCH_STEPS = Math.round(MATCH_SECONDS * RATE);
const MISMATCH_STEPS = Math.round(MISMATCH_SECONDS * RATE);
/** The think delay, plus the step the card is actually turned on. */
const BOT_FLIP_STEPS = Math.round(THINK_SECONDS * RATE) + 1;

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
    for (const seat of [this.p1, this.p2]) {
      seat.pointer = null;
      seat.actionPressed = false;
      seat.actionHeld = false;
    }
  }
}

class RecordingRenderer implements Renderer {
  depth = 0;
  maxDepth = 0;
  calls = 0;
  rects = 0;
  circles = 0;
  lines = 0;
  texts = 0;
  readonly colours = new Set<string>();

  clear(colour: string): void {
    this.calls += 1;
    this.colours.add(colour);
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.calls += 1;
    this.rects += 1;
    this.colours.add(colour);
  }
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.calls += 1;
    this.rects += 1;
    this.colours.add(colour);
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.calls += 1;
    this.circles += 1;
    this.colours.add(colour);
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.calls += 1;
    this.circles += 1;
    this.colours.add(colour);
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.calls += 1;
    this.lines += 1;
    this.colours.add(colour);
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
    this.colours.add(colour);
    expect(value.length).toBeGreaterThan(0);
    expect(Number.isFinite(x + y + sizePx)).toBe(true);
    expect(colour.length).toBeGreaterThan(0);
    expect(align === undefined || align.length > 0).toBe(true);
  }
  pushSeatRotation(): void {
    this.depth += 1;
    if (this.depth > this.maxDepth) this.maxDepth = this.depth;
  }
  pushRotation(): void {
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

/** Presses the action on a seat, aimed at the centre of a card as drawn for that seat. */
function tapCard(input: FakeInput, seat: SeatId, index: number, rotated = false): void {
  cardCentre(aim, index);
  const target = seat === 'p1' ? input.p1 : input.p2;
  const x = rotated ? manifest.logical.width - aim.x : aim.x;
  const y = rotated ? manifest.logical.height - aim.y : aim.y;
  target.pointer = { x, y };
  target.actionPressed = true;
  target.actionHeld = true;
}

function step(game: MemoryMatchGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

function playFlip(game: MemoryMatchGame, input: FakeInput, seat: SeatId, index: number): void {
  input.clear();
  tapCard(input, seat, index);
  game.update(STEP, input);
  input.clear();
}

/** Turns a known pair over and waits out the pause that follows a match. */
function takePair(
  game: MemoryMatchGame,
  input: FakeInput,
  seat: SeatId,
  a: number,
  b: number,
): void {
  playFlip(game, input, seat, a);
  playFlip(game, input, seat, b);
  step(game, input, MATCH_STEPS);
}

/** Turns two cards that do not match and waits until they go back over. */
function missPair(
  game: MemoryMatchGame,
  input: FakeInput,
  seat: SeatId,
  a: number,
  b: number,
): void {
  playFlip(game, input, seat, a);
  playFlip(game, input, seat, b);
  step(game, input, MISMATCH_STEPS);
}

function findPair(game: MemoryMatchGame): [number, number] {
  for (let i = 0; i < CARD_COUNT; i += 1) {
    const a = game.cardAt(i);
    if (a === null || a.matched || a.faceUp) continue;
    for (let j = i + 1; j < CARD_COUNT; j += 1) {
      const b = game.cardAt(j);
      if (b === null || b.matched || b.faceUp) continue;
      if (a.value === b.value) return [i, j];
    }
  }
  throw new Error('no pair is left on the table');
}

function findMismatch(game: MemoryMatchGame): [number, number] {
  for (let i = 0; i < CARD_COUNT; i += 1) {
    const a = game.cardAt(i);
    if (a === null || a.matched || a.faceUp) continue;
    for (let j = i + 1; j < CARD_COUNT; j += 1) {
      const b = game.cardAt(j);
      if (b === null || b.matched || b.faceUp) continue;
      if (a.value !== b.value) return [i, j];
    }
  }
  throw new Error('every card left on the table is a pair');
}

function sweep(game: MemoryMatchGame, input: FakeInput, seat: SeatId, pairs: number): void {
  for (let taken = 0; taken < pairs; taken += 1) {
    const pair = findPair(game);
    takePair(game, input, seat, pair[0], pair[1]);
  }
}

function faceUpCount(game: MemoryMatchGame): number {
  let count = 0;
  for (let i = 0; i < CARD_COUNT; i += 1) {
    const card = game.cardAt(i);
    if (card !== null && card.faceUp && !card.matched) count += 1;
  }
  return count;
}

function valuesOf(game: MemoryMatchGame): number[] {
  const values: number[] = [];
  for (let i = 0; i < CARD_COUNT; i += 1) {
    values.push(game.cardAt(i)?.value ?? -1);
  }
  return values;
}

/** Everything the simulation holds, flattened so a replay can be compared cheaply. */
function snapshot(game: MemoryMatchGame): string {
  let out = `${game.activeSeat}|${game.firstPick}|${game.hideCountdown}|`;
  for (let i = 0; i < CARD_COUNT; i += 1) {
    const card = game.cardAt(i);
    const face = card === null ? '?' : `${card.value}${card.faceUp ? 'u' : 'd'}`;
    const won = card !== null && card.matched ? 'm' : '-';
    out += `${face}${won}${game.ownerAt(i) ?? 'n'},`;
  }
  const score = game.getScore();
  return `${out}|${score.p1}:${score.p2}:${score.winner ?? '-'}`;
}

describe('the manifest', () => {
  it('declares a turn-based shared board', () => {
    expect(manifest.archetype).toBe('turn-board');
    expect(manifest.zoneSplit).toBe('shared-board');
    // Four columns of four cards at the declared pitch have to fit the logical box.
    expect(manifest.logical.width).toBeGreaterThanOrEqual(4 * CARD_PITCH);
    expect(manifest.logical.height).toBeGreaterThanOrEqual(4 * CARD_PITCH);
  });
});

describe('the deal', () => {
  let game: MemoryMatchGame;

  beforeEach(() => {
    game = new MemoryMatchGame();
    game.init(makeContext(null, null));
  });

  it('starts with p1 on a table of face-down cards', () => {
    expect(game.activeSeat).toBe('p1');
    expect(game.firstPick).toBe(-1);
    expect(faceUpCount(game)).toBe(0);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    for (let i = 0; i < CARD_COUNT; i += 1) {
      expect(game.ownerAt(i)).toBeNull();
    }
  });

  it('lays every value exactly twice', () => {
    const counts = new Map<number, number>();
    for (const value of valuesOf(game)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect(counts.size).toBe(PAIRS);
    for (const count of counts.values()) {
      expect(count).toBe(2);
    }
  });

  it('deals the same table for the same seed', () => {
    const other = new MemoryMatchGame();
    other.init(makeContext(null, null, 'single-seat', 'p1', 1234));
    expect(valuesOf(other)).toEqual(valuesOf(game));
  });
});

describe('turns', () => {
  let game: MemoryMatchGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new MemoryMatchGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('scores a pair and keeps the turn', () => {
    const [a, b] = findPair(game);
    playFlip(game, input, 'p1', a);
    expect(game.firstPick).toBe(a);
    expect(game.cardAt(a)?.faceUp).toBe(true);
    expect(game.activeSeat).toBe('p1');

    playFlip(game, input, 'p1', b);
    expect(game.cardAt(a)?.matched).toBe(true);
    expect(game.cardAt(b)?.matched).toBe(true);
    expect(game.cardAt(a)?.faceUp).toBe(true);
    expect(game.ownerAt(a)).toBe('p1');
    expect(game.ownerAt(b)).toBe('p1');
    expect(game.getScore()).toEqual({ p1: 1, p2: 0, winner: null });

    step(game, input, MATCH_STEPS);
    expect(game.activeSeat).toBe('p1');
    expect(game.firstPick).toBe(-1);
  });

  it('turns a mismatch back over after the delay and passes the turn', () => {
    const [a, b] = findMismatch(game);
    playFlip(game, input, 'p1', a);
    playFlip(game, input, 'p1', b);
    expect(game.cardAt(a)?.faceUp).toBe(true);
    expect(game.cardAt(b)?.faceUp).toBe(true);
    expect(game.activeSeat).toBe('p1');

    step(game, input, MISMATCH_STEPS - 1);
    expect(game.cardAt(a)?.faceUp).toBe(true);
    expect(game.activeSeat).toBe('p1');

    step(game, input);
    expect(game.cardAt(a)?.faceUp).toBe(false);
    expect(game.cardAt(b)?.faceUp).toBe(false);
    expect(game.cardAt(a)?.matched).toBe(false);
    expect(game.activeSeat).toBe('p2');
    expect(game.firstPick).toBe(-1);
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('ignores a tap on a card that is already face up', () => {
    const [a] = findMismatch(game);
    playFlip(game, input, 'p1', a);
    playFlip(game, input, 'p1', a);
    expect(faceUpCount(game)).toBe(1);
    expect(game.firstPick).toBe(a);
  });

  it('ignores a tap on a card that has already been won', () => {
    const [a, b] = findPair(game);
    takePair(game, input, 'p1', a, b);
    playFlip(game, input, 'p1', a);
    expect(game.firstPick).toBe(-1);
    expect(game.getScore().p1).toBe(1);
  });

  it('ignores a tap in the gap between two cards', () => {
    cardCentre(aim, 0);
    input.p1.pointer = { x: aim.x + CARD_PITCH / 2, y: aim.y };
    input.p1.actionPressed = true;
    step(game, input);
    expect(faceUpCount(game)).toBe(0);
  });

  it('ignores a tap off the table', () => {
    input.p1.pointer = { x: 10, y: 10 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(faceUpCount(game)).toBe(0);
  });

  it('turns over the card at the keyboard cursor when a press arrives with no pointer', () => {
    // This used to turn over nothing, which is what made the game unplayable on a
    // keyboard: a tap names a card directly, so a press without one had nowhere to go.
    // Only a key can raise a press with no pointer — a tap always carries its position.
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.cardAt(0)?.faceUp).toBe(true);
  });

  it('ignores a pointer with no press', () => {
    input.clear();
    cardCentre(aim, 0);
    input.p1.pointer = { x: aim.x, y: aim.y };
    input.p1.actionHeld = true;
    step(game, input);
    expect(game.cardAt(0)?.faceUp).toBe(false);
  });

  it('ignores the seat whose turn it is not', () => {
    const [a, b] = findMismatch(game);
    input.clear();
    tapCard(input, 'p2', a);
    step(game, input);
    expect(faceUpCount(game)).toBe(0);
    expect(game.activeSeat).toBe('p1');

    // Both seats pressing at once still only lets the active one through.
    input.clear();
    tapCard(input, 'p1', a);
    tapCard(input, 'p2', b);
    step(game, input);
    expect(game.cardAt(a)?.faceUp).toBe(true);
    expect(game.cardAt(b)?.faceUp).toBe(false);
  });

  it('a held press turns one card, not one per step', () => {
    const [a] = findMismatch(game);
    input.clear();
    tapCard(input, 'p1', a);
    step(game, input, 8);
    expect(faceUpCount(game)).toBe(1);
    expect(game.firstPick).toBe(a);
  });
});

/**
 * Run out the seat flip with nothing pressed.
 *
 * The board turns to face whoever has the move and refuses input while it is part-way
 * round — what sits under a finger is moving, so a tap would name something the player
 * did not mean. A test that acts the instant the turn changes is aiming at a board
 * nobody could have seen.
 */
function settleFlip(game: MemoryMatchGame, input: FakeInput): void {
  input.clear();
  step(game, input, 40);
}

describe('shared-screen rotation', () => {
  it('reads the far seat tap in the rotated frame it was drawn in', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));

    // p1 is local, so its own view is upright; a mismatch hands the turn over.
    const [a, b] = findMismatch(game);
    missPair(game, input, 'p1', a, b);
    expect(game.activeSeat).toBe('p2');

    // p2 sits opposite: the table is turned half a turn for its turn, so the upright
    // point misses and the diagonally opposite one lands.
    const [c] = findPair(game);
    settleFlip(game, input);
    tapCard(input, 'p2', c, false);
    step(game, input);
    expect(game.cardAt(c)?.faceUp).toBe(false);

    input.clear();
    tapCard(input, 'p2', c, true);
    step(game, input);
    expect(game.cardAt(c)?.faceUp).toBe(true);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    const [a, b] = findMismatch(game);
    missPair(game, input, 'p1', a, b);
    expect(game.activeSeat).toBe('p2');

    const [c] = findPair(game);
    settleFlip(game, input);
    tapCard(input, 'p2', c, false);
    step(game, input);
    expect(game.cardAt(c)?.faceUp).toBe(true);
  });
});

describe('terminal states', () => {
  let game: MemoryMatchGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new MemoryMatchGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('ends when the last pair goes, and p1 wins on the higher pile', () => {
    sweep(game, input, 'p1', PAIRS);
    for (let i = 0; i < CARD_COUNT; i += 1) {
      expect(game.cardAt(i)?.matched).toBe(true);
      expect(game.ownerAt(i)).toBe('p1');
    }
    expect(game.getScore()).toEqual({ p1: PAIRS, p2: 0, winner: 'p1' });
  });

  it('lets p2 win when p1 gives the table away', () => {
    const [a, b] = findMismatch(game);
    missPair(game, input, 'p1', a, b);
    sweep(game, input, 'p2', PAIRS);
    expect(game.getScore()).toEqual({ p1: 0, p2: PAIRS, winner: 'p2' });
  });

  it('calls a level match a draw', () => {
    const half = PAIRS / 2;
    const opener = findMismatch(game);
    missPair(game, input, 'p1', opener[0], opener[1]);

    sweep(game, input, 'p2', half);
    const handover = findMismatch(game);
    missPair(game, input, 'p2', handover[0], handover[1]);
    expect(game.activeSeat).toBe('p1');

    sweep(game, input, 'p1', half);
    expect(game.getScore()).toEqual({ p1: half, p2: half, winner: 'draw' });
  });

  it('stops stepping once the match is decided', () => {
    sweep(game, input, 'p1', PAIRS);
    const settled = snapshot(game);
    step(game, input, 600);
    expect(snapshot(game)).toBe(settled);
  });
});

describe('bot seats', () => {
  it('waits its think delay before turning a card', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    game.init(makeContext(null, 'hard'));

    const [a, b] = findMismatch(game);
    missPair(game, input, 'p1', a, b);
    expect(game.activeSeat).toBe('p2');
    expect(faceUpCount(game)).toBe(0);

    step(game, input, BOT_FLIP_STEPS - 1);
    expect(faceUpCount(game)).toBe(0);
    step(game, input);
    expect(faceUpCount(game)).toBe(1);
  });

  it('turns a card nobody has turned over yet', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    game.init(makeContext(null, 'hard'));

    const [a, b] = findMismatch(game);
    missPair(game, input, 'p1', a, b);
    step(game, input, BOT_FLIP_STEPS);

    // The bot watched p1 turn a and b over, so exploring either of them again would be
    // wasting a look it has already had.
    expect(game.cardAt(a)?.faceUp).toBe(false);
    expect(game.cardAt(b)?.faceUp).toBe(false);
    expect(faceUpCount(game)).toBe(1);
  });

  it('does not let a human play for a bot seat', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    game.init(makeContext(null, 'hard'));

    const [a, b] = findMismatch(game);
    missPair(game, input, 'p1', a, b);
    input.clear();
    tapCard(input, 'p1', a);
    tapCard(input, 'p2', b);
    step(game, input, BOT_FLIP_STEPS - 1);
    expect(faceUpCount(game)).toBe(0);
  });

  it('replays identically from the same seed and the same inputs', () => {
    const first = new MemoryMatchGame();
    const second = new MemoryMatchGame();
    const input = new FakeInput();
    first.init(makeContext('easy', 'hard', 'single-seat', 'p1', 4242));
    second.init(makeContext('easy', 'hard', 'single-seat', 'p1', 4242));

    for (let i = 0; i < 20000; i += 1) {
      first.update(STEP, input);
      second.update(STEP, input);
      expect(snapshot(second)).toBe(snapshot(first));
    }
    expect(first.getScore().winner).not.toBeNull();
    expect(second.getScore()).toEqual(first.getScore());
  });

  it('clears the table when two bots play it out', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    game.init(makeContext('normal', 'hard', 'single-seat', 'p1', 77));
    step(game, input, 20000);

    const score = game.getScore();
    expect(score.winner).not.toBeNull();
    expect(score.p1 + score.p2).toBe(PAIRS);
    for (let i = 0; i < CARD_COUNT; i += 1) {
      expect(game.cardAt(i)?.matched).toBe(true);
    }
  });

  it('gives a harder bot a longer memory, and nothing else', () => {
    const easy = new MemoryMatchGame();
    const hard = new MemoryMatchGame();
    const input = new FakeInput();
    easy.init(makeContext(null, 'easy', 'single-seat', 'p1', 555));
    hard.init(makeContext(null, 'hard', 'single-seat', 'p1', 555));

    // Same seed, same deal, and both bots take the same number of steps per card: the
    // tiers differ in what they recall, never in how fast they may act.
    expect(valuesOf(hard)).toEqual(valuesOf(easy));
    for (const game of [easy, hard]) {
      const [a, b] = findMismatch(game);
      missPair(game, input, 'p1', a, b);
      step(game, input, BOT_FLIP_STEPS - 1);
      expect(faceUpCount(game)).toBe(0);
      step(game, input);
      expect(faceUpCount(game)).toBe(1);
    }
  });
});

describe('lifecycle and render', () => {
  it('pause and resume leave the table alone', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    const [a, b] = findPair(game);
    takePair(game, input, 'p1', a, b);

    const before = snapshot(game);
    game.onPause();
    game.onResume();
    expect(snapshot(game)).toBe(before);
  });

  it('destroy clears the table and the tally', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    sweep(game, input, 'p1', PAIRS);
    game.destroy();

    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(faceUpCount(game)).toBe(0);
    for (let i = 0; i < CARD_COUNT; i += 1) {
      expect(game.cardAt(i)?.matched).toBe(false);
      expect(game.ownerAt(i)).toBeNull();
    }
  });

  it('renders a balanced frame and never mutates the table', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    const renderer = new RecordingRenderer();
    game.init(makeContext(null, null));
    const [a, b] = findPair(game);
    takePair(game, input, 'p1', a, b);

    const before = snapshot(game);
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.rects).toBeGreaterThan(0);
    // No text on the board: the score and the turn belong to the shell's HUD, and a
    // game that draws its own gives the player two scoreboards to reconcile.
    expect(renderer.texts).toBe(0);
    expect(snapshot(game)).toBe(before);
  });

  it('draws a face-down back and a claimed card differently', () => {
    const game = new MemoryMatchGame();
    const input = new FakeInput();
    const dealt = new RecordingRenderer();
    const played = new RecordingRenderer();
    game.init(makeContext(null, null));

    game.render(dealt, 0);
    const [a, b] = findPair(game);
    takePair(game, input, 'p1', a, b);
    game.render(played, 0);

    // A won pair shows a face, a glyph and a seat mark that a face-down card never does.
    expect(played.colours.size).toBeGreaterThan(dealt.colours.size);
    expect(played.depth).toBe(0);
    expect(dealt.lines).toBeGreaterThan(CARD_COUNT);
  });
});
