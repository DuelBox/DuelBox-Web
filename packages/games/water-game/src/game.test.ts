import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, MatchScore, Renderer } from '@duelbox/game-sdk';
import { SHAPE_AREAS, WaterGameGame } from './game.js';
import { manifest } from './manifest.js';
import { BALL_RADIUS, HOME_Y, MATCH_SECONDS } from './rules.js';

const STEP = 1 / 60;
const { width, height } = manifest.logical;

/* ------------------------------------------------------------------ a renderer */

interface Mark {
  readonly kind: string;
  readonly numbers: readonly number[];
  readonly colour: string;
}

/**
 * A renderer that records rather than draws.
 *
 * Games draw through {@link Renderer} and never touch a canvas, so this sees every mark the
 * game makes, in logical units — the same seam `cross-viewport.test.ts` and
 * `greyscale.test.ts` use.
 */
class Recorder implements Renderer {
  readonly marks: Mark[] = [];
  depth = 0;
  maxDepth = 0;

  clear(colour: string): void {
    this.marks.push({ kind: 'clear', numbers: [], colour });
  }
  rect(x: number, y: number, w: number, h: number, colour: string): void {
    this.marks.push({ kind: 'rect', numbers: [x, y, w, h], colour });
  }
  strokeRect(x: number, y: number, w: number, h: number, lineWidth: number, colour: string): void {
    this.marks.push({ kind: 'strokeRect', numbers: [x, y, w, h, lineWidth], colour });
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.marks.push({ kind: 'circle', numbers: [x, y, radius], colour });
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.marks.push({ kind: 'strokeCircle', numbers: [x, y, radius, lineWidth], colour });
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.marks.push({ kind: 'line', numbers: [x1, y1, x2, y2, lineWidth], colour });
  }
  text(value: string, x: number, y: number, size: number, colour: string): void {
    this.marks.push({ kind: `text:${value}`, numbers: [x, y, size], colour });
  }
  pushSeatRotation(): void {
    this.depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
  }
  pushRotation(): void {
    this.depth += 1;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
  }
  popSeatRotation(): void {
    this.depth -= 1;
  }
}

/* -------------------------------------------------------------------- contexts */

function context(overrides: Partial<GameContext> = {}): GameContext {
  return {
    manifest,
    rng: new Rng(20260829),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
    ...overrides,
  };
}

function botContext(
  difficulty: 'easy' | 'normal' | 'hard',
  seed: number,
  openingSeat: SeatId = 'p1',
  presentation: Presentation = 'shared-screen',
): GameContext {
  return context({
    rng: new Rng(seed),
    openingSeat,
    presentation,
    localSeat: openingSeat,
    botDifficulty: () => difficulty,
  });
}

function inputs(): { manager: InputManager; view: InputView } {
  return {
    manager: new InputManager(manifest.logical, { split: 'horizontal', bottomSeat: 'p1' }),
    view: new InputView(),
  };
}

/** Every score the match passed through, which is its whole observable surface. */
function botTrace(ctx: GameContext, steps: number): string {
  const game = new WaterGameGame();
  game.init(ctx);
  const { manager, view } = inputs();
  const out: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    const score = game.getScore();
    out.push(`${String(score.p1)}:${String(score.p2)}:${String(score.winner)}`);
  }
  game.destroy();
  return out.join('|');
}

/* ------------------------------------------------------------------ the contract */

describe('the Game contract', () => {
  it('never claims to have turns — it is real-time', () => {
    // `apps/web/src/data/turn-seat.test.ts` enforces this across the catalogue: a real-time
    // game that answered would switch the shell into shared-board mode and take one seat's
    // pointer zone away.
    const game: Game = new WaterGameGame();
    expect(typeof game.getActiveSeat).toBe('undefined');
    expect(game.getActiveSeat?.() ?? null).toBeNull();
  });

  it('reports a score of the shape the shell reads', () => {
    const game = new WaterGameGame();
    game.init(context());
    const score: MatchScore = game.getScore();
    expect(score).toEqual({ p1: 0, p2: 0, winner: null });
    game.destroy();
  });

  it('does nothing before it has been initialised', () => {
    const game = new WaterGameGame();
    const { manager, view } = inputs();
    for (let i = 0; i < 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
  });

  it('puts everything back the way it found it when it is destroyed', () => {
    const game = new WaterGameGame();
    game.init(botContext('hard', 5));
    const { manager, view } = inputs();
    for (let i = 0; i < 60 * 30; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.getScore().p1 + game.getScore().p2).toBeGreaterThan(0);
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.state.clock).toBe(0);
    expect(game.state.p1Ball.y).toBe(HOME_Y);
    expect(game.state.p2Ball.y).toBe(HOME_Y);
    // And it goes on being inert: a destroyed game may not simulate.
    for (let i = 0; i < 60; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.state.clock).toBe(0);
  });

  it('can be initialised twice and starts level both times', () => {
    const game = new WaterGameGame();
    game.init(botContext('normal', 9));
    const { manager, view } = inputs();
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    game.init(botContext('normal', 9));
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    expect(game.state.clock).toBe(0);
  });
});

/* --------------------------------------------------------------------- drawing */

describe('drawing', () => {
  function drawnAfter(steps: number, alpha: number): Recorder {
    const game = new WaterGameGame();
    game.init(botContext('normal', 11));
    const { manager, view } = inputs();
    for (let i = 0; i < steps; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const recorder = new Recorder();
    game.render(recorder, alpha);
    game.destroy();
    return recorder;
  }

  it('does not touch the simulation', () => {
    const game = new WaterGameGame();
    game.init(botContext('hard', 13));
    const { manager, view } = inputs();
    for (let i = 0; i < 400; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    const before = JSON.stringify(game.state);
    for (const alpha of [0, 0.25, 0.5, 0.99]) game.render(new Recorder(), alpha);
    expect(JSON.stringify(game.state)).toBe(before);
    game.destroy();
  });

  it('draws something, and draws it every frame', () => {
    expect(drawnAfter(300, 0).marks.length).toBeGreaterThan(20);
  });

  it('writes no text at all', () => {
    // There is no language in this game and nothing on the board has to be read. The clock
    // is a bar, the score is the shell's, and the two seats are told apart by shape.
    for (const steps of [1, 200, 900]) {
      for (const mark of drawnAfter(steps, 0.5).marks) {
        expect(mark.kind.startsWith('text')).toBe(false);
      }
    }
  });

  it('balances every rotation it pushes', () => {
    const recorder = drawnAfter(200, 0.5);
    expect(recorder.depth).toBe(0);
  });

  it('keeps every mark inside the declared logical box', () => {
    // A generous margin: strokes and the pointer's head legitimately overhang a little. What
    // this catches is a game simulating in a box unrelated to the one it declared — which is
    // a live risk here, because `rules.ts` simulates in a box centred on the origin.
    const margin = 90;
    for (const steps of [1, 120, 400, 1200]) {
      for (const mark of drawnAfter(steps, 0.5).marks) {
        if (mark.kind === 'clear') continue;
        const [x, y] = mark.numbers;
        expect(x, `${mark.kind} x`).toBeGreaterThanOrEqual(-margin);
        expect(x, `${mark.kind} x`).toBeLessThanOrEqual(width + margin);
        expect(y, `${mark.kind} y`).toBeGreaterThanOrEqual(-margin);
        expect(y, `${mark.kind} y`).toBeLessThanOrEqual(height + margin);
      }
    }
  });

  it('draws the two seats out of different primitives, at equal area', () => {
    // Rule 7. Seat one is round and seat two is square, and the square's side is chosen so
    // the two silhouettes cover the same area — so the shapes differ and nothing else about
    // them does. `greyscale.test.ts` is what checks a human could tell them apart.
    expect(SHAPE_AREAS.circle).toBeCloseTo(SHAPE_AREAS.square, 9);
    expect(SHAPE_AREAS.circle).toBeCloseTo(Math.PI * BALL_RADIUS * BALL_RADIUS, 9);

    const marks = drawnAfter(240, 0.5).marks;
    const circles = marks.filter((m) => m.kind === 'circle' && m.colour.startsWith('#ff'));
    const squares = marks.filter((m) => m.kind === 'rect' && m.colour.startsWith('#21'));
    expect(circles.length, 'seat one draws no circles').toBeGreaterThan(0);
    expect(squares.length, 'seat two draws no squares').toBeGreaterThan(0);
    // The evidence rule 7 asks for, in the form `greyscale.test.ts` looks for: a primitive
    // one seat draws and the other never does, in both directions.
    expect(marks.some((m) => m.kind === 'circle' && m.colour.startsWith('#21'))).toBe(false);
    expect(marks.some((m) => m.kind === 'strokeCircle' && m.colour.startsWith('#21'))).toBe(false);
    expect(marks.some((m) => m.kind === 'rect' && m.colour.startsWith('#ff'))).toBe(false);
    expect(marks.some((m) => m.kind === 'strokeRect' && m.colour.startsWith('#ff'))).toBe(false);
  });

  it('draws the clock as one object, shared and symmetric about the centre', () => {
    const marks = drawnAfter(600, 0).marks;
    const bars = marks.filter((m) => m.kind === 'rect' && m.colour.startsWith('rgba(222'));
    expect(bars.length).toBe(2);
    const [left, right] = bars;
    expect(left!.numbers[1]).toBe(right!.numbers[1]);
    expect(left!.numbers[3]).toBe(right!.numbers[3]);
    // Mirror images about the vertical centre line.
    expect(left!.numbers[0]! + left!.numbers[2]!).toBeCloseTo(width - right!.numbers[0]!, 9);
  });

  it('shortens the clock bar as the match runs', () => {
    const barAt = (steps: number): number => {
      const marks = drawnAfter(steps, 0).marks;
      const bar = marks.find((m) => m.kind === 'rect' && m.colour.startsWith('rgba(222'));
      return bar!.numbers[3]!;
    };
    expect(barAt(1)).toBeGreaterThan(barAt(60 * 30));
    expect(barAt(60 * 30)).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------- presentations */

describe('the two presentations', () => {
  it('step the identical match', () => {
    // `docs/presentation.md`: rules and simulation are byte-identical, only placement,
    // rotation and control mapping change. Here there is no control mapping at all — a press
    // has no position to rotate — so the two are the same code path rather than two paths
    // asserted to agree.
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const shared = botTrace(botContext(tier, 41, 'p1', 'shared-screen'), 60 * 60);
      const single = botTrace(botContext(tier, 41, 'p1', 'single-seat'), 60 * 60);
      expect(single).toBe(shared);
    }
  });

  it('read nothing from the device at all', () => {
    // The local seat is the other half of the same argument: a simulation that read it would
    // step a different match on the two devices of a remote pairing.
    const a = botTrace(botContext('normal', 42, 'p1', 'single-seat'), 60 * 40);
    const b = botTrace(
      context({
        rng: new Rng(42),
        presentation: 'single-seat',
        localSeat: 'p2',
        openingSeat: 'p1',
        botDifficulty: () => 'normal',
      }),
      60 * 40,
    );
    expect(b).toBe(a);
  });
});

/* ------------------------------------------------------------ the two instruments */

describe('a keyboard and a thumb play the same game', () => {
  /**
   * The same intent, spelled twice: `Space` on the keys, and a finger going down and up in
   * seat one's own half. `actionHeld` is `keys.action || pointerDown` in the engine, so the
   * two produce the identical edge — and because a press carries no position, the finger's
   * *place* cannot add anything a key lacks.
   */
  function play(instrument: 'keys' | 'thumb', seed: number): string {
    const game = new WaterGameGame();
    game.init(botContext('normal', seed));
    const { manager, view } = inputs();
    const script = new Rng(seed);
    const out: string[] = [];
    let down = false;
    let hold = 0;
    for (let i = 0; i < 60 * 90; i += 1) {
      hold -= 1;
      if (hold <= 0) {
        hold = 6 + Math.floor(script.float() * 40);
        if (down) {
          if (instrument === 'keys') manager.keyUp('Space');
          else manager.pointerUp(0);
          down = false;
        } else {
          if (instrument === 'keys') {
            manager.keyDown('Space');
          } else {
            // Anywhere in seat one's own half; the game must not care which point.
            manager.pointerDown(0, script.float() * width, height - 40);
          }
          down = true;
        }
      }
      game.update(STEP, view.sync(manager.beginStep(STEP)));
      const score = game.getScore();
      out.push(`${String(score.p1)}:${String(score.p2)}`);
    }
    game.destroy();
    return out.join('|');
  }

  it('produces the identical match from either instrument', () => {
    for (const seed of [3, 17, 55]) {
      expect(play('thumb', seed)).toBe(play('keys', seed));
    }
  });

  it('takes a human press at all', () => {
    const game = new WaterGameGame();
    game.init(context());
    const { manager, view } = inputs();
    // Past the opening pause, then one press.
    for (let i = 0; i < 60; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(game.state.p1Ball.vx).toBe(0);
    expect(game.state.p1Ball.vy).toBe(0);
    manager.keyDown('Space');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(Math.abs(game.state.p1Ball.vx) + Math.abs(game.state.p1Ball.vy)).toBeGreaterThan(0);
    // Seat two is untouched by seat one's key.
    expect(game.state.p2Ball.vx).toBe(0);
    expect(game.state.p2Ball.vy).toBe(0);
    game.destroy();
  });

  it('gives each seat its own key', () => {
    const game = new WaterGameGame();
    game.init(context());
    const { manager, view } = inputs();
    for (let i = 0; i < 60; i += 1) game.update(STEP, view.sync(manager.beginStep(STEP)));
    manager.keyDown('Enter');
    game.update(STEP, view.sync(manager.beginStep(STEP)));
    expect(Math.abs(game.state.p2Ball.vx) + Math.abs(game.state.p2Ball.vy)).toBeGreaterThan(0);
    expect(game.state.p1Ball.vx).toBe(0);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ seat balance */

describe('the opening seat', () => {
  it('hands the two bot streams over, so the same seed plays out mirrored', () => {
    // The whole of this game's seat-balance argument, at the level the shell actually uses
    // it. `balance-aggregate.test.ts` plays every seed once from each opening seat, so seat
    // one's share of decided matches is 50.0% by construction.
    let p1Wins = 0;
    let decided = 0;
    for (const tier of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 0; seed < 6; seed += 1) {
        const a = botTrace(botContext(tier, 800 + seed, 'p1'), 60 * MATCH_SECONDS + 4);
        const b = botTrace(botContext(tier, 800 + seed, 'p2'), 60 * MATCH_SECONDS + 4);
        const last = (trace: string): string[] => trace.split('|').at(-1)!.split(':');
        const [aP1, aP2, aWin] = last(a);
        const [bP1, bP2, bWin] = last(b);
        expect(aP1).toBe(bP2);
        expect(aP2).toBe(bP1);
        expect(aWin === 'p1' ? 'p2' : aWin === 'p2' ? 'p1' : aWin).toBe(bWin);
        for (const winner of [aWin, bWin]) {
          if (winner === 'p1') {
            p1Wins += 1;
            decided += 1;
          } else if (winner === 'p2') decided += 1;
        }
      }
    }
    expect(decided).toBeGreaterThan(30);
    expect(p1Wins / decided).toBe(0.5);
  });
});
