import { beforeEach, describe, expect, it } from 'vitest';
import { Rng, set, vec2 } from '@duelbox/engine';
import type { Presentation, SeatId, TextAlign, Vec2 } from '@duelbox/engine';
import type { GameContext, InputState, Renderer, SeatInput } from '@duelbox/game-sdk';
import { DotsAndBoxesGame, edgeCentre, edgeIndexAt } from './game.js';
import { BOX_COUNT, EDGE_COUNT, boxEdges } from './rules.js';
import type { BotDifficulty } from './rules.js';
import { manifest } from './manifest.js';

const STEP = 1 / 60;
const LOGICAL = 900;
/** THINK_SECONDS (0.4) at 60 Hz, plus the step the move is played on. */
const BOT_STEPS = 26;

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

/** Aims a tap at an edge, in the frame the seat sees it. */
function tapEdge(input: FakeInput, seat: SeatId, edge: number, rotated = false): void {
  edgeCentre(aim, edge);
  const target = seat === 'p1' ? input.p1 : input.p2;
  target.pointer = rotated ? { x: LOGICAL - aim.x, y: LOGICAL - aim.y } : { x: aim.x, y: aim.y };
  target.actionPressed = true;
  target.actionHeld = true;
}

function step(game: DotsAndBoxesGame, input: FakeInput, times = 1): void {
  for (let i = 0; i < times; i += 1) game.update(STEP, input);
}

/** Runs the seat flip out with nothing pressed, so a tap lands on a settled board. */
function settleFlip(game: DotsAndBoxesGame, input: FakeInput): void {
  input.clear();
  step(game, input, 40);
}

describe('taking turns', () => {
  let game: DotsAndBoxesGame;
  let input: FakeInput;

  beforeEach(() => {
    game = new DotsAndBoxesGame();
    input = new FakeInput();
    game.init(makeContext(null, null));
  });

  it('starts with p1 and an empty board', () => {
    expect(game.activeSeat).toBe('p1');
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) expect(game.edgeDrawn(edge)).toBe(false);
  });

  it('draws the edge that was tapped', () => {
    tapEdge(input, 'p1', 0);
    step(game, input);
    expect(game.edgeDrawn(0)).toBe(true);
  });

  it('passes the turn when no box was completed', () => {
    tapEdge(input, 'p1', 0);
    step(game, input);
    expect(game.activeSeat).toBe('p2');
  });

  it('keeps the turn when a box was completed', () => {
    // The rule the whole game turns on: a chain falls to whoever opens it.
    const edges = [0, 0, 0, 0];
    boxEdges(edges, 0);
    let seat: SeatId = 'p1';
    for (let i = 0; i < 3; i += 1) {
      input.clear();
      tapEdge(input, seat, edges[i] as number);
      step(game, input);
      settleFlip(game, input);
      seat = game.activeSeat;
    }
    const closer = game.activeSeat;
    input.clear();
    tapEdge(input, closer, edges[3] as number);
    step(game, input);
    expect(game.boxOwner(0)).toBe(closer);
    expect(game.activeSeat, 'completing a box must not pass the turn').toBe(closer);
  });

  it('ignores a tap on an edge already drawn', () => {
    tapEdge(input, 'p1', 0);
    step(game, input);
    const seat = game.activeSeat;
    settleFlip(game, input);
    tapEdge(input, seat, 0);
    step(game, input);
    expect(game.activeSeat, 'an illegal move must not pass the turn').toBe(seat);
  });

  it('ignores a tap nowhere near an edge', () => {
    input.p1.pointer = { x: 5, y: 5 };
    input.p1.actionPressed = true;
    step(game, input);
    expect(game.activeSeat).toBe('p1');
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) expect(game.edgeDrawn(edge)).toBe(false);
  });
});

describe('playing with the keyboard alone', () => {
  it('moves the cursor and draws with the action, with no pointer at all', () => {
    const game = new DotsAndBoxesGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));

    set(input.p1.move, 1, 0);
    step(game, input);
    const moved = game.cursorEdge;
    input.clear();
    input.p1.actionPressed = true;
    step(game, input);

    expect(game.edgeDrawn(moved)).toBe(true);
  });

  it('reaches every edge on the board from the keyboard, not only one lattice', () => {
    // The navigation problem in this game: horizontal and vertical edges are two
    // interleaved grids, and a cursor must walk both to reach every line.
    //
    // "Reaches both kinds" was the assertion here before #1924, and it passed while a third
    // of the board was unreachable: nearest-by-distance let a press drift onto the other
    // grid, and from the centre that drift never straightened, so the lower-right twenty
    // edges had no keyboard route in at all. A tap reaches all sixty (the test below), so on
    // a shared screen those were lines one player could draw and the other could not. The
    // guard has to be reachability of *every* edge, walked as a graph, or it does not bite —
    // this one was watched failing at 40/60 before the fix.
    const directions: readonly (readonly [number, number])[] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const cursorAfter = (path: readonly (readonly [number, number])[]): number => {
      const game = new DotsAndBoxesGame();
      const input = new FakeInput();
      game.init(makeContext(null, null));
      for (const [x, y] of path) {
        input.clear();
        step(game, input);
        set(input.p1.move, x, y);
        step(game, input);
      }
      return game.cursorEdge;
    };
    const start = cursorAfter([]);
    const seen = new Set<number>([start]);
    const paths = new Map<number, readonly (readonly [number, number])[]>([[start, []]]);
    const queue: number[] = [start];
    while (queue.length > 0) {
      const edge = queue.shift() as number;
      const path = paths.get(edge) as readonly (readonly [number, number])[];
      for (const direction of directions) {
        const next = cursorAfter([...path, direction]);
        if (!seen.has(next)) {
          seen.add(next);
          paths.set(next, [...path, direction]);
          queue.push(next);
        }
      }
    }
    const horizontal = [...seen].filter((e) => e < 30).length;
    const vertical = [...seen].filter((e) => e >= 30).length;
    expect(horizontal, 'never reached a horizontal edge').toBeGreaterThan(0);
    expect(vertical, 'never reached a vertical edge').toBeGreaterThan(0);
    expect(seen.size, 'some edges have no keyboard route').toBe(EDGE_COUNT);
  });

  it('a tap on any edge centre names exactly that edge, so the pointer reaches all sixty', () => {
    // The other half of cross-device fairness on this board: the keyboard reaching every
    // edge is only fair if the pointer does too. It does — a tap on a line's midpoint names
    // that line and no other — which is why the reach gap #1924 measured was the keyboard's
    // to close, not the tap's.
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
      edgeCentre(aim, edge);
      expect(edgeIndexAt(aim.x, aim.y), `a tap on edge ${edge} named another`).toBe(edge);
    }
  });

  it('never leaves the board', () => {
    const game = new DotsAndBoxesGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    for (let i = 0; i < 200; i += 1) {
      input.clear();
      step(game, input);
      set(input.p1.move, i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 0 : 1);
      step(game, input);
      expect(game.cursorEdge).toBeGreaterThanOrEqual(0);
      expect(game.cursorEdge).toBeLessThan(EDGE_COUNT);
    }
  });
});

describe('a whole match', () => {
  const MATCH_TIMEOUT_MS = 60_000;

  it('plays out bot against bot and accounts for every box', { timeout: MATCH_TIMEOUT_MS }, () => {
    const game = new DotsAndBoxesGame();
    const input = new FakeInput();
    game.init(makeContext('hard', 'normal'));

    for (let i = 0; i < EDGE_COUNT * BOT_STEPS + 400; i += 1) {
      game.update(STEP, input);
      if (game.getScore().winner !== null) break;
    }

    const score = game.getScore();
    expect(score.winner, 'the match never finished').not.toBeNull();
    expect(score.p1 + score.p2, 'a box went missing').toBe(BOX_COUNT);
  });

  it('replays identically from the same seed', { timeout: MATCH_TIMEOUT_MS }, () => {
    const play = (): string => {
      const game = new DotsAndBoxesGame();
      const input = new FakeInput();
      game.init(makeContext('hard', 'easy', 'single-seat', 'p1', 4242));
      const trace: string[] = [];
      for (let i = 0; i < EDGE_COUNT * BOT_STEPS + 400; i += 1) {
        game.update(STEP, input);
        const s = game.getScore();
        trace.push(`${String(s.p1)}:${String(s.p2)}:${String(s.winner)}`);
        if (s.winner !== null) break;
      }
      return trace.join('|');
    };
    expect(play()).toBe(play());
  });
});

describe('lifecycle and render', () => {
  it('renders a balanced frame and draws no text', () => {
    const game = new DotsAndBoxesGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    step(game, input, 5);

    const renderer = new RecordingRenderer();
    game.render(renderer, 0);
    expect(renderer.depth).toBe(0);
    expect(renderer.maxDepth).toBe(1);
    expect(renderer.calls).toBeGreaterThan(0);
    // The score and the turn belong to the shell's HUD; a game drawing its own gives the
    // player two scoreboards to reconcile.
    expect(renderer.texts).toBe(0);
  });

  it('never rotates in single-seat presentation', () => {
    const game = new DotsAndBoxesGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'single-seat', 'p1'));
    tapEdge(input, 'p1', 0);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.every((a) => a === 0)).toBe(true);
  });

  it('turns to face the far seat in shared-screen', () => {
    const game = new DotsAndBoxesGame();
    const input = new FakeInput();
    game.init(makeContext(null, null, 'shared-screen', 'p1'));
    tapEdge(input, 'p1', 0);
    step(game, input);
    input.clear();

    const renderer = new RecordingRenderer();
    for (let i = 0; i < 40; i += 1) {
      game.update(STEP, input);
      game.render(renderer, 0);
    }
    expect(renderer.angles.some((a) => a > 0.01)).toBe(true);
    expect(renderer.angles[renderer.angles.length - 1]).toBeCloseTo(Math.PI, 5);
  });

  it('leaves nothing behind on destroy', () => {
    const game = new DotsAndBoxesGame();
    const input = new FakeInput();
    game.init(makeContext(null, null));
    tapEdge(input, 'p1', 0);
    step(game, input);
    game.destroy();
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) expect(game.edgeDrawn(edge)).toBe(false);
  });
});
