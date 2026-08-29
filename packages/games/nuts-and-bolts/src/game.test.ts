import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { Presentation, SeatId } from '@duelbox/engine';
import type { Game, GameContext, Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { NutsandBoltsGame, MOVE_SECONDS, THINK_SECONDS, boltAt, boltX, nutY } from './game.js';
import {
  BOLT_CAPACITY,
  BOLT_COUNT,
  MARK_P1,
  MARK_P2,
  MOVES_PER_SEAT,
  NUTS_PER_SEAT,
  TURN_SECONDS,
} from './rules.js';

const STEP = 1 / 60;
const SEATS: SeatId[] = ['p1', 'p2'];

/** One recorded draw call, reduced to what these tests care about. */
interface Mark {
  readonly kind: string;
  readonly colour: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

class Recorder implements Renderer {
  readonly marks: Mark[] = [];
  texts = 0;
  rotations = 0;

  #push(kind: string, colour: string, x: number, y: number, width: number, height: number): void {
    this.marks.push({ kind, colour, x, y, width: Math.abs(width), height: Math.abs(height) });
  }

  clear(colour: string): void {
    this.#push('clear', colour, 0, 0, 0, 0);
  }

  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push(
      `rect|${round(width)}|${round(height)}`,
      colour,
      x + width / 2,
      y + height / 2,
      width,
      height,
    );
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.#push(
      `srect|${round(width)}|${round(height)}|${round(lineWidth)}`,
      colour,
      x + width / 2,
      y + height / 2,
      width,
      height,
    );
  }

  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push(`circ|${round(radius)}`, colour, x, y, radius * 2, radius * 2);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#push(`scirc|${round(radius)}|${round(lineWidth)}`, colour, x, y, radius * 2, radius * 2);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    const length = Math.hypot(x2 - x1, y2 - y1);
    this.#push(
      `line|${round(length)}|${round(lineWidth)}`,
      colour,
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      Math.abs(x2 - x1) + lineWidth,
      Math.abs(y2 - y1) + lineWidth,
    );
  }

  text(value: string, x: number, y: number, sizePx: number, colour: string): void {
    this.texts += 1;
    this.#push(`text|${value}`, colour, x, y, sizePx * value.length, sizePx);
  }

  pushSeatRotation(): void {
    this.rotations += 1;
  }

  pushRotation(): void {
    this.rotations += 1;
  }

  popSeatRotation(): void {
    this.rotations -= 1;
  }
}

function round(value: number): number {
  return Math.round(value / 4);
}

function contextFor(options?: {
  presentation?: Presentation;
  localSeat?: SeatId;
  openingSeat?: SeatId;
  seed?: number;
  bot?: (seat: SeatId) => 'easy' | 'normal' | 'hard' | null;
}): GameContext {
  return {
    manifest,
    rng: new Rng(options?.seed ?? 20260829),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: options?.openingSeat ?? 'p1',
    botDifficulty: options?.bot ?? (() => null),
  };
}

function inputFor(): InputManager {
  return new InputManager(manifest.logical, { split: 'shared', bottomSeat: 'p1' });
}

/** Play a whole bot match, returning a per-step signature of everything observable. */
function trace(context: GameContext, steps = 60 * 90): string[] {
  const game = new NutsandBoltsGame();
  game.init(context);
  const input = inputFor();
  const view = new InputView();
  const seen: string[] = [];
  try {
    for (let step = 0; step < steps; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      const score = game.getScore();
      seen.push(
        `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${game.getActiveSeat()}`,
      );
      if (score.winner !== null) break;
    }
  } finally {
    game.destroy();
  }
  return seen;
}

/* -------------------------------------------------------------- the contract */

describe('the Game contract', () => {
  it('reports whose turn it is, and it is the seat the shell named', () => {
    for (const opener of SEATS) {
      const game = new NutsandBoltsGame();
      game.init(contextFor({ openingSeat: opener }));
      expect(game.getActiveSeat()).toBe(opener);
      game.destroy();
    }
  });

  it('reports a score that starts level and only ever climbs', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'normal' }));
    const opening = game.getScore();
    expect(opening).toEqual({ p1: 0, p2: 0, winner: null });
    const input = inputFor();
    const view = new InputView();
    let p1 = 0;
    let p2 = 0;
    for (let step = 0; step < 60 * 120; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      const score = game.getScore();
      expect(score.p1).toBeGreaterThanOrEqual(p1);
      expect(score.p2).toBeGreaterThanOrEqual(p2);
      expect(score.p1).toBeLessThanOrEqual(NUTS_PER_SEAT);
      expect(score.p2).toBeLessThanOrEqual(NUTS_PER_SEAT);
      p1 = score.p1;
      p2 = score.p2;
      if (score.winner !== null) break;
    }
    expect(game.getScore().winner).not.toBeNull();
    game.destroy();
  });

  it('renders without touching the simulation, at any alpha', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'normal' }));
    const input = inputFor();
    const view = new InputView();
    for (let step = 0; step < 200; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    const before = JSON.stringify(game.match);
    const selected = game.selected;
    const renderer = new Recorder();
    for (const alpha of [0, 0.25, 0.5, 0.75, 0.999]) game.render(renderer, alpha);
    expect(JSON.stringify(game.match)).toBe(before);
    expect(game.selected).toBe(selected);
    expect(renderer.marks.length).toBeGreaterThan(0);
    // Every push is paired with a pop, or the shell's own drawing would come out upside down.
    expect(renderer.rotations).toBe(0);
    game.destroy();
  });

  it('draws the same frame twice for the same state', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'hard' }));
    const input = inputFor();
    const view = new InputView();
    for (let step = 0; step < 150; step += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    const a = new Recorder();
    const b = new Recorder();
    game.render(a, 0);
    game.render(b, 0);
    expect(b.marks).toEqual(a.marks);
    game.destroy();
  });

  it('lets go of everything on destroy, and can be stood back up', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'normal' }));
    const input = inputFor();
    const view = new InputView();
    for (let step = 0; step < 300; step += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    game.destroy();
    expect(game.match.winner).toBeNull();
    expect(game.match.p1Score).toBe(0);
    expect(game.match.p2Score).toBe(0);
    expect(game.match.lockedCount).toBe(0);
    expect(game.selected).toBe(-1);
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) expect(game.match.height[bolt]).toBe(0);
    // A torn-down game must be usable again; the shell reuses the instance on a rematch.
    game.init(contextFor({ seed: 4242 }));
    expect(game.match.p1Moves).toBe(MOVES_PER_SEAT);
    game.destroy();
  });

  it('survives being paused and resumed at any moment', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'normal' }));
    const input = inputFor();
    const view = new InputView();
    for (let step = 0; step < 60 * 60; step += 1) {
      if (step % 37 === 0) game.onPause();
      if (step % 37 === 5) game.onResume();
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (game.getScore().winner !== null) break;
    }
    expect(game.getScore().winner).not.toBeNull();
    game.destroy();
  });
});

/* ------------------------------------------------------------- presentation */

describe('the presentation changes the picture and nothing else', () => {
  it('steps a bit-identical match on a shared screen and on a single seat', () => {
    for (const opener of SEATS) {
      const shared = trace(
        contextFor({ presentation: 'shared-screen', openingSeat: opener, bot: () => 'normal' }),
      );
      const single = trace(
        contextFor({ presentation: 'single-seat', openingSeat: opener, bot: () => 'normal' }),
      );
      expect(single).toEqual(shared);
      expect(shared.length).toBeGreaterThan(60);
    }
  });

  it('and on the other player’s device as much as on this one', () => {
    const here = trace(
      contextFor({ presentation: 'single-seat', localSeat: 'p1', bot: () => 'hard' }),
    );
    const there = trace(
      contextFor({ presentation: 'single-seat', localSeat: 'p2', bot: () => 'hard' }),
    );
    expect(there).toEqual(here);
  });

  it('keeps the turn clock in the rules, where no flip can reach it', () => {
    // The defect three shipped games carry: an input guard keyed off the board flip sitting
    // *above* the turn's own clock, so a turn is worth 0.36 s more on a shared screen than on
    // a single seat, which has no flip at all. Two absent humans is the sharpest form of it —
    // nothing but the clock decides the match.
    const shared = trace(contextFor({ presentation: 'shared-screen' }), 60 * 400);
    const single = trace(contextFor({ presentation: 'single-seat' }), 60 * 400);
    expect(single).toEqual(shared);
    expect(shared.length).toBe(MOVES_PER_SEAT * 2 * TURN_SECONDS * 60);
  });
});

/* ------------------------------------------------------------------- controls */

describe('a key and a thumb are the same instrument', () => {
  /**
   * Press a bolt with the keyboard: walk the cursor there, then press the action key.
   *
   * The cursor starts in the middle of the row and every key press moves it exactly one bolt,
   * which is what makes a key and a tap the same act — one of seven columns, named exactly.
   */
  function keyboardHand(
    game: NutsandBoltsGame,
    input: InputManager,
    view: InputView,
    seat: SeatId,
  ): (bolt: number) => void {
    const keys =
      seat === 'p1'
        ? { left: 'KeyA', right: 'KeyD', action: 'Space' }
        : { left: 'ArrowLeft', right: 'ArrowRight', action: 'Enter' };
    let at = Math.floor(BOLT_COUNT / 2);
    return (bolt: number): void => {
      while (at !== bolt) {
        const key = bolt > at ? keys.right : keys.left;
        input.keyDown(key);
        game.update(STEP, view.sync(input.beginStep(STEP)));
        input.keyUp(key);
        game.update(STEP, view.sync(input.beginStep(STEP)));
        at += bolt > at ? 1 : -1;
      }
      input.keyDown(keys.action);
      game.update(STEP, view.sync(input.beginStep(STEP)));
      input.keyUp(keys.action);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    };
  }

  it('plays a move from the keyboard', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor());
    const input = inputFor();
    const view = new InputView();
    input.setBoardSeat('p1');
    // Find a legal move on the opening rack and play it with keys alone.
    let from = -1;
    let to = -1;
    for (let a = 0; a < BOLT_COUNT && from < 0; a += 1) {
      for (let b = 0; b < BOLT_COUNT; b += 1) {
        if (a !== b && (game.match.height[a] ?? 0) > 0 && (game.match.height[b] ?? 0) === 0) {
          from = a;
          to = b;
          break;
        }
      }
    }
    expect(from).toBeGreaterThanOrEqual(0);
    const before = game.match.height[to] ?? 0;
    const press = keyboardHand(game, input, view, 'p1');
    press(from);
    expect(game.selected).toBe(from);
    press(to);
    expect(game.match.height[to]).toBe(before + 1);
    expect(game.match.active).toBe('p2');
    game.destroy();
  });

  it('plays the same move from a thumb', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor());
    const input = inputFor();
    const view = new InputView();
    input.setBoardSeat('p1');
    let from = -1;
    let to = -1;
    for (let a = 0; a < BOLT_COUNT && from < 0; a += 1) {
      for (let b = 0; b < BOLT_COUNT; b += 1) {
        if (a !== b && (game.match.height[a] ?? 0) > 0 && (game.match.height[b] ?? 0) === 0) {
          from = a;
          to = b;
          break;
        }
      }
    }
    const tap = (bolt: number): void => {
      input.pointerDown(1, boltX(bolt), 450);
      game.update(STEP, view.sync(input.beginStep(STEP)));
      input.pointerUp(1);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    };
    const before = game.match.height[to] ?? 0;
    tap(from);
    expect(game.selected).toBe(from);
    tap(to);
    expect(game.match.height[to]).toBe(before + 1);
    game.destroy();
  });

  it('spends one move on a press and no more on a hold', () => {
    // Seven moves is a small budget; an auto-repeating key would empty it in a fraction of a
    // second. A held action key must lift a nut and then do nothing at all.
    const game = new NutsandBoltsGame();
    game.init(contextFor());
    const input = inputFor();
    const view = new InputView();
    input.setBoardSeat('p1');
    input.keyDown('Space');
    for (let step = 0; step < 120; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    expect(game.match.p1Moves).toBe(MOVES_PER_SEAT);
    input.keyUp('Space');
    game.destroy();
  });

  it('lets a lift be taken back for nothing, and only a placement spends a move', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor());
    const input = inputFor();
    const view = new InputView();
    input.setBoardSeat('p1');
    const tap = (bolt: number): void => {
      input.pointerDown(1, boltX(bolt), 450);
      game.update(STEP, view.sync(input.beginStep(STEP)));
      input.pointerUp(1);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    };
    let holder = -1;
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
      if ((game.match.height[bolt] ?? 0) > 0) {
        holder = bolt;
        break;
      }
    }
    tap(holder);
    expect(game.selected).toBe(holder);
    tap(holder);
    expect(game.selected).toBe(-1);
    expect(game.match.p1Moves).toBe(MOVES_PER_SEAT);
    game.destroy();
  });

  it('refuses a tap on the seam between two bolts', () => {
    expect(boltAt(boltX(0))).toBe(0);
    expect(boltAt(boltX(BOLT_COUNT - 1))).toBe(BOLT_COUNT - 1);
    expect(boltAt(-40)).toBe(-1);
    expect(boltAt(manifest.logical.width + 40)).toBe(-1);
    const seam = (boltX(0) + boltX(1)) / 2;
    expect(boltAt(seam)).toBe(-1);
  });

  it('ignores the seat that is not to move', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ openingSeat: 'p1' }));
    const input = inputFor();
    const view = new InputView();
    input.setBoardSeat('p1');
    input.keyDown('Enter');
    for (let step = 0; step < 30; step += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.selected).toBe(-1);
    expect(game.match.p2Moves).toBe(MOVES_PER_SEAT);
    game.destroy();
  });

  it('ignores a person shouting at a seat a bot is holding', () => {
    // The balance harness drives every game with a frozen idle input and needs this to be
    // true: if a bot-held seat read the device, the sweep would be measuring the harness.
    const quiet = trace(contextFor({ bot: () => 'normal' }));
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'normal' }));
    const input = inputFor();
    const view = new InputView();
    const loud: string[] = [];
    for (let step = 0; step < quiet.length; step += 1) {
      input.keyDown('Space');
      input.keyDown('Enter');
      input.pointerDown(step % 4, 450 + (step % 7) * 30, 300 + (step % 5) * 40);
      game.update(STEP, view.sync(input.beginStep(STEP)));
      input.pointerUp(step % 4);
      input.keyUp('Space');
      input.keyUp('Enter');
      const score = game.getScore();
      loud.push(
        `${String(score.p1)}:${String(score.p2)}:${String(score.winner)}:${game.getActiveSeat()}`,
      );
      if (score.winner !== null) break;
    }
    expect(loud).toEqual(quiet);
    game.destroy();
  });
});

/* ------------------------------------------------------------- the turn clock */

describe('the turn clock', () => {
  it('forfeits a move when nobody plays, and finishes the match on its own', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor());
    const input = inputFor();
    const view = new InputView();
    let steps = 0;
    for (; steps < 60 * 600; steps += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (game.getScore().winner !== null) break;
    }
    expect(steps + 1).toBe(MOVES_PER_SEAT * 2 * TURN_SECONDS * 60);
    expect(game.match.p1Moves).toBe(0);
    expect(game.match.p2Moves).toBe(0);
    game.destroy();
  });

  it('gives a bot far less than the whole clock', () => {
    expect(THINK_SECONDS + MOVE_SECONDS).toBeLessThan(TURN_SECONDS);
  });
});

/* ------------------------------------------------------------------- drawing */

describe('rule 7: nothing is told by colour alone', () => {
  /**
   * A local replication of `apps/web/src/data/greyscale.test.ts`.
   *
   * Every mark drawn in one seat's palette becomes a glyph — the primitive and its size, never
   * its position — and the two seats' glyph sets must not be the same set. Position is
   * deliberately excluded: the rule names shape, pattern and label, and on a shared rack the
   * two seats' nuts are mixed together anyway.
   */
  function glyphsFor(seat: SeatId, marks: readonly Mark[]): Set<string> {
    const palette = SEAT_PALETTE[seat];
    const colours = new Set([palette.base, palette.deep, palette.tint, palette.soft]);
    const out = new Set<string>();
    for (const mark of marks) {
      if (colours.has(mark.colour)) out.add(mark.kind);
    }
    return out;
  }

  it('draws the two seats from different shapes, in every frame of a match', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'normal' }));
    const input = inputFor();
    const view = new InputView();
    let frames = 0;
    for (let step = 0; step < 60 * 60; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (step % 7 !== 0) continue;
      const renderer = new Recorder();
      game.render(renderer, 0);
      const p1 = glyphsFor('p1', renderer.marks);
      const p2 = glyphsFor('p2', renderer.marks);
      expect(p1.size, 'seat one drew nothing of its own').toBeGreaterThan(0);
      expect(p2.size, 'seat two drew nothing of its own').toBeGreaterThan(0);
      // Seat one is a ring and seat two is a box, everywhere: each has a glyph the other
      // never draws, so the two are told apart with the colour taken away.
      expect([...p1].some((glyph) => !p2.has(glyph))).toBe(true);
      expect([...p2].some((glyph) => !p1.has(glyph))).toBe(true);
      frames += 1;
      if (game.getScore().winner !== null) break;
    }
    expect(frames).toBeGreaterThan(20);
    game.destroy();
  });

  it('tells the five kinds apart by silhouette as well as by colour', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor());
    const renderer = new Recorder();
    game.render(renderer, 0);
    // Every kind's glyph is stamped on the nut in the kind's own ink, and the five inks are
    // five different strings; what matters here is that the *shapes* differ too, so count the
    // distinct non-seat-coloured glyph kinds drawn inside the rack.
    const seatColours = new Set(
      SEATS.flatMap((seat) => [
        SEAT_PALETTE[seat].base,
        SEAT_PALETTE[seat].deep,
        SEAT_PALETTE[seat].tint,
        SEAT_PALETTE[seat].soft,
      ]),
    );
    const glyphs = new Set(
      renderer.marks
        .filter((mark) => !seatColours.has(mark.colour) && mark.y > nutY(3) - 60 && mark.y < 620)
        .filter((mark) => mark.width <= 40 && mark.width > 0)
        .map((mark) => mark.kind),
    );
    expect(glyphs.size).toBeGreaterThanOrEqual(4);
    game.destroy();
  });

  it('writes no text at all, so nothing on the rack needs reading', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'normal' }));
    const input = inputFor();
    const view = new InputView();
    const renderer = new Recorder();
    for (let step = 0; step < 60 * 30; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      game.render(renderer, 0);
      if (game.getScore().winner !== null) break;
    }
    expect(renderer.texts).toBe(0);
    game.destroy();
  });

  it('gives seat two the exact half-turn of seat one’s margin', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor());
    const renderer = new Recorder();
    game.render(renderer, 0);
    const width = manifest.logical.width;
    const height = manifest.logical.height;
    // Only the margins: the rack in the middle belongs to both seats and holds their nuts
    // mixed together, so it is the two counters either side of it that must be mirror images.
    const inMargin = (mark: Mark): boolean => mark.y < nutY(3) - 60 || mark.y > 660;
    const marksFor = (seat: SeatId): Mark[] =>
      renderer.marks.filter((mark) => mark.colour === SEAT_PALETTE[seat].base && inMargin(mark));
    const p1 = marksFor('p1');
    const p2 = marksFor('p2');
    expect(p1.length).toBeGreaterThan(0);
    // The active seat's turn clock is the one thing only one margin carries; everything else
    // is drawn for both seats, at the half-turn of each other.
    const clock = (mark: Mark): boolean => mark.width > 400;
    expect(p1.filter((mark) => !clock(mark)).length).toBe(p2.filter((mark) => !clock(mark)).length);
    for (const mark of p1) {
      if (clock(mark)) continue;
      const partner = p2.find(
        (other) =>
          Math.abs(other.x - (width - mark.x)) < 0.01 &&
          Math.abs(other.y - (height - mark.y)) < 0.01,
      );
      expect(partner, `no half-turn partner for ${mark.kind}`).toBeDefined();
    }
    game.destroy();
  });
});

describe('rule 8: no pixels, and nothing outside the declared box', () => {
  it('keeps every drawn point inside the logical box it declared', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor({ bot: () => 'normal' }));
    const input = inputFor();
    const view = new InputView();
    const { width, height } = manifest.logical;
    for (let step = 0; step < 60 * 30; step += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      const renderer = new Recorder();
      game.render(renderer, 0);
      for (const mark of renderer.marks) {
        if (mark.kind === 'clear') continue;
        expect(mark.x - mark.width / 2).toBeGreaterThanOrEqual(-40);
        expect(mark.x + mark.width / 2).toBeLessThanOrEqual(width + 40);
        expect(mark.y - mark.height / 2).toBeGreaterThanOrEqual(-40);
        expect(mark.y + mark.height / 2).toBeLessThanOrEqual(height + 40);
      }
      if (game.getScore().winner !== null) break;
    }
    game.destroy();
  });

  it('draws a nut for every nut on the rack and none for a bolt that is bare', () => {
    const game = new NutsandBoltsGame();
    game.init(contextFor());
    const renderer = new Recorder();
    game.render(renderer, 0);
    let owned = 0;
    for (let bolt = 0; bolt < BOLT_COUNT; bolt += 1) {
      for (let level = 0; level < (game.match.height[bolt] ?? 0); level += 1) {
        const mark = game.match.marks[bolt * BOLT_CAPACITY + level];
        expect(mark === MARK_P1 || mark === MARK_P2).toBe(true);
        const x = boltX(bolt);
        const y = nutY(level);
        const drawn = renderer.marks.some(
          (candidate) =>
            Math.abs(candidate.x - x) < 0.01 &&
            Math.abs(candidate.y - y) < 0.01 &&
            candidate.kind.startsWith(mark === MARK_P1 ? 'scirc' : 'srect'),
        );
        expect(drawn, `no owner mark drawn at bolt ${String(bolt)} level ${String(level)}`).toBe(
          true,
        );
        owned += 1;
      }
    }
    expect(owned).toBe(NUTS_PER_SEAT * 2);
    game.destroy();
  });
});

/* ------------------------------------------------------------------- the module */

describe('the module the registry loads', () => {
  it('declares a bot alongside a friend, so a lone player can start it', () => {
    expect(manifest.modes).toContain('friend');
    expect(manifest.modes).toContain('bot');
    expect(manifest.presentations).toContain('shared-screen');
    expect(manifest.presentations).toContain('single-seat');
    expect(manifest.zoneSplit).toBe('shared-board');
    expect(manifest.archetype).toBe('turn-board');
  });

  it('is the same game whichever way the shell builds it', () => {
    const one: Game = new NutsandBoltsGame();
    expect(typeof one.getActiveSeat).toBe('function');
    one.init(contextFor());
    one.destroy();
  });
});
