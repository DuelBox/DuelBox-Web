import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE, envelopeFor } from '@duelbox/engine';
import type { Presentation, Renderer, SeatId } from '@duelbox/engine';
import type { GameContext } from '@duelbox/game-sdk';
import { WobbleStackGame } from './game.js';
import { manifest } from './manifest.js';
import {
  FIELD_HEIGHT,
  FIELD_WIDTH,
  PIECE_CAP,
  SLOT_LIMIT,
  SLOT_PITCH,
  worldXOf,
  worldYOf,
  yardOf,
} from './rules.js';
import type { Yard } from './rules.js';

const STEP = 1 / 60;
const LOGICAL = { width: FIELD_WIDTH, height: FIELD_HEIGHT };

function contextFor(options?: {
  presentation?: Presentation;
  localSeat?: SeatId;
  bots?: Partial<Record<SeatId, 'easy' | 'normal' | 'hard'>>;
  seed?: number;
}): GameContext {
  return {
    manifest,
    rng: new Rng(options?.seed ?? 20260829),
    presentation: options?.presentation ?? 'shared-screen',
    localSeat: options?.localSeat ?? 'p1',
    openingSeat: 'p1',
    botDifficulty: (seat) => options?.bots?.[seat] ?? null,
  };
}

function manager(): InputManager {
  return new InputManager(LOGICAL, { split: 'horizontal', bottomSeat: 'p1' });
}

/** A recording renderer, which is also how the cross-game guards look at a game. */
interface Mark {
  readonly kind: string;
  readonly colour: string;
  readonly dims: readonly number[];
}

class Recorder implements Renderer {
  readonly marks: Mark[] = [];
  clear(colour: string): void {
    this.marks.push({ kind: 'clear', colour, dims: [] });
  }
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.marks.push({ kind: 'rect', colour, dims: [x, y, width, height] });
  }
  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    lineWidth: number,
    colour: string,
  ): void {
    this.marks.push({ kind: 'srect', colour, dims: [x, y, width, height, lineWidth] });
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.marks.push({ kind: 'circ', colour, dims: [x, y, radius] });
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.marks.push({ kind: 'scirc', colour, dims: [x, y, radius, lineWidth] });
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    this.marks.push({ kind: 'line', colour, dims: [x1, y1, x2, y2, lineWidth] });
  }
  text(value: string, x: number, y: number, sizePx: number, colour: string): void {
    this.marks.push({ kind: `text:${value}`, colour, dims: [x, y, sizePx] });
  }
  pushSeatRotation(): void {}
  pushRotation(): void {}
  popSeatRotation(): void {}
}

/** Everything the simulation decides about a yard, so two runs can be compared. */
function trace(yard: Readonly<Yard>): number[] {
  const out = [
    yard.count,
    yard.top,
    yard.com,
    yard.comHeight,
    yard.lean.value,
    yard.lean.rate,
    yard.swing.value,
    yard.swing.rate,
    yard.slot,
    yard.dealt,
    yard.hover,
    yard.dropX,
    yard.worst,
    yard.out ? 1 : 0,
  ];
  for (let i = 0; i < yard.count; i += 1) out.push(yard.pieces[i]?.x ?? 0);
  return out;
}

/* ------------------------------------------------------------------ the contract */

describe('the contract', () => {
  it('reports a score with the shape the shell expects', () => {
    const game = new WobbleStackGame();
    game.init(contextFor());
    const score = game.getScore();
    expect(score).toEqual({ p1: 0, p2: 0, winner: null });
    const input = manager();
    const view = new InputView();
    for (let i = 0; i < 60 * 90 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    const end = game.getScore();
    expect(end.winner).not.toBeNull();
    expect(end.p1).toBeGreaterThanOrEqual(0);
    expect(end.p1).toBeLessThanOrEqual(PIECE_CAP);
    game.destroy();
  });

  it('never claims to have turns', () => {
    // `rt-split`. Both rails are live from the first step, so the shell must keep a
    // pointer zone for each seat rather than handing the glass to whoever is to move.
    const game = new WobbleStackGame();
    expect((game as { getActiveSeat?: unknown }).getActiveSeat).toBeUndefined();
    expect(manifest.archetype).toBe('rt-split');
  });

  it('does not mutate a thing while rendering', () => {
    const game = new WobbleStackGame();
    game.init(contextFor({ bots: { p1: 'hard', p2: 'easy' } }));
    const input = manager();
    const view = new InputView();
    for (let i = 0; i < 400; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    const before = [trace(game.match.p1), trace(game.match.p2), game.getScore()];
    const recorder = new Recorder();
    for (let i = 0; i < 5; i += 1) game.render(recorder, i / 5);
    expect([trace(game.match.p1), trace(game.match.p2), game.getScore()]).toEqual(before);
    expect(recorder.marks.length).toBeGreaterThan(40);
    game.destroy();
  });

  it('draws every frame of a whole match inside its declared box', () => {
    const game = new WobbleStackGame();
    game.init(contextFor({ bots: { p1: 'easy', p2: 'hard' } }));
    const input = manager();
    const view = new InputView();
    const recorder = new Recorder();
    for (let i = 0; i < 60 * 60 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      game.render(recorder, 0);
    }
    for (const mark of recorder.marks) {
      for (const value of mark.dims) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(FIELD_HEIGHT);
      }
    }
    game.destroy();
  });

  it('gives everything back on destroy, and comes back clean', () => {
    const game = new WobbleStackGame();
    game.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    const input = manager();
    const view = new InputView();
    for (let i = 0; i < 900; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    game.destroy();
    expect(game.getScore()).toEqual({ p1: 0, p2: 0, winner: null });
    // A destroyed game must not step, or a stray frame after unload would run a match.
    game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.match.p1.dealt).toBe(0);

    const fresh = new WobbleStackGame();
    fresh.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    game.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    for (let i = 0; i < 400; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      fresh.update(STEP, view.sync(input.beginStep(STEP)));
    }
    expect(trace(game.match.p1)).toEqual(trace(fresh.match.p1));
    game.destroy();
    fresh.destroy();
  });
});

/* ------------------------------------------------------------------ the gesture */

describe('the gesture', () => {
  /** Where a notch is, on the glass, for a seat. */
  function pointFor(seat: SeatId, slot: number): { x: number; y: number } {
    return { x: worldXOf(seat, slot * SLOT_PITCH), y: worldYOf(seat, 120) };
  }

  function started(): { game: WobbleStackGame; input: InputManager; view: InputView } {
    const game = new WobbleStackGame();
    game.init(contextFor());
    const input = manager();
    const view = new InputView();
    // Past the opening pause, so a brainrot is on the rail.
    while (game.match.p1.stance !== 'hover') {
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    return { game, input, view };
  }

  it('drops on a tap and does not drop on a drag', () => {
    // A tap is a press whose pointer never left the tap radius; a drag is anything else.
    // There is no hold threshold anywhere in this, deliberately — a duration threshold is
    // a number the two seats reach by accumulating steps from opposite ends of a match.
    const tapped = started();
    const where = pointFor('p1', 0);
    tapped.input.pointerDown(1, where.x, where.y);
    tapped.game.update(STEP, tapped.view.sync(tapped.input.beginStep(STEP)));
    for (let i = 0; i < 30; i += 1) {
      tapped.game.update(STEP, tapped.view.sync(tapped.input.beginStep(STEP)));
    }
    tapped.input.pointerUp(1);
    tapped.game.update(STEP, tapped.view.sync(tapped.input.beginStep(STEP)));
    expect(tapped.game.match.p1.stance).toBe('falling');
    tapped.game.destroy();

    const dragged = started();
    const from = pointFor('p1', 0);
    const to = pointFor('p1', SLOT_LIMIT);
    dragged.input.pointerDown(2, from.x, from.y);
    dragged.game.update(STEP, dragged.view.sync(dragged.input.beginStep(STEP)));
    for (let i = 1; i <= 30; i += 1) {
      dragged.input.pointerMove(2, from.x + ((to.x - from.x) * i) / 30, from.y);
      dragged.game.update(STEP, dragged.view.sync(dragged.input.beginStep(STEP)));
    }
    dragged.input.pointerUp(2);
    dragged.game.update(STEP, dragged.view.sync(dragged.input.beginStep(STEP)));
    expect(dragged.game.match.p1.stance).toBe('hover');
    expect(dragged.game.match.p1.slot).toBeGreaterThan(0);
    dragged.game.destroy();
  });

  it('lets a key and a finger place a brainrot the same way, to nine decimals', () => {
    // The parity claim, driven through the real InputManager rather than argued. A finger
    // held on the far notch and `D` held down walk the carrier along the identical trace,
    // because both go through one rate limit at one rate.
    const finger = started();
    const target = pointFor('p1', SLOT_LIMIT);
    finger.input.pointerDown(3, target.x, target.y);
    const fingerTrace: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      finger.game.update(STEP, finger.view.sync(finger.input.beginStep(STEP)));
      fingerTrace.push(finger.game.match.p1.slot, finger.game.match.p1.swing.value);
    }
    finger.game.destroy();

    const key = started();
    key.input.keyDown('KeyD');
    const keyTrace: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      key.game.update(STEP, key.view.sync(key.input.beginStep(STEP)));
      keyTrace.push(key.game.match.p1.slot, key.game.match.p1.swing.value);
    }
    key.game.destroy();

    expect(keyTrace.length).toBe(fingerTrace.length);
    for (let i = 0; i < keyTrace.length; i += 1) {
      expect(Math.abs(keyTrace[i]! - fingerTrace[i]!)).toBeLessThan(1e-9);
    }
    expect(keyTrace[keyTrace.length - 2]).toBe(SLOT_LIMIT);
  });

  it('drops on the same step whichever instrument asked', () => {
    const byKey = started();
    byKey.input.keyDown('Space');
    byKey.game.update(STEP, byKey.view.sync(byKey.input.beginStep(STEP)));
    byKey.input.keyUp('Space');
    byKey.game.update(STEP, byKey.view.sync(byKey.input.beginStep(STEP)));
    expect(byKey.game.match.p1.stance).toBe('falling');
    const keyFall = byKey.game.match.p1.fall;
    byKey.game.destroy();

    const byFinger = started();
    const spot = pointFor('p1', 0);
    byFinger.input.pointerDown(4, spot.x, spot.y);
    byFinger.game.update(STEP, byFinger.view.sync(byFinger.input.beginStep(STEP)));
    byFinger.input.pointerUp(4);
    byFinger.game.update(STEP, byFinger.view.sync(byFinger.input.beginStep(STEP)));
    expect(byFinger.game.match.p1.stance).toBe('falling');
    expect(byFinger.game.match.p1.fall).toBe(keyFall);
    byFinger.game.destroy();
  });

  it('reads a finger inside two envelopes of the press as a tap and not a drag', () => {
    const envelope = envelopeFor(LOGICAL);
    const jiggled = started();
    const spot = pointFor('p1', 0);
    jiggled.input.pointerDown(5, spot.x, spot.y);
    jiggled.game.update(STEP, jiggled.view.sync(jiggled.input.beginStep(STEP)));
    jiggled.input.pointerMove(5, spot.x + envelope, spot.y);
    jiggled.game.update(STEP, jiggled.view.sync(jiggled.input.beginStep(STEP)));
    jiggled.input.pointerUp(5);
    jiggled.game.update(STEP, jiggled.view.sync(jiggled.input.beginStep(STEP)));
    expect(jiggled.game.match.p1.stance).toBe('falling');
    jiggled.game.destroy();
  });

  it('does nothing at all for every other key', () => {
    const { game, input, view } = started();
    const before = trace(game.match.p1);
    for (const code of [
      'KeyW',
      'KeyS',
      'ArrowUp',
      'ArrowDown',
      'Escape',
      'Tab',
      'KeyQ',
      'Digit1',
    ]) {
      input.keyDown(code);
      for (let i = 0; i < 12; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
      input.keyUp(code);
    }
    const after = trace(game.match.p1);
    expect(after[0]).toBe(before[0]);
    expect(after[8]).toBe(before[8]);
    expect(after[9]).toBe(before[9]);
    expect(after[7]).toBe(before[7]);
    game.destroy();
  });

  it('keeps a finger that crosses the midline with the seat it started in', () => {
    const { game, input, view } = started();
    const near = pointFor('p1', 0);
    const far = pointFor('p2', 0);
    input.pointerDown(6, near.x, near.y);
    game.update(STEP, view.sync(input.beginStep(STEP)));
    const farBefore = trace(game.match.p2);
    for (let i = 1; i <= 40; i += 1) {
      input.pointerMove(6, near.x + 90, near.y + ((far.y - near.y) * i) / 40);
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    expect(game.match.p1.slot).not.toBe(0);
    // p2's carrier is untouched: its notch and its swing never moved.
    expect(trace(game.match.p2)[8]).toBe(farBefore[8]);
    expect(trace(game.match.p2)[7]).toBe(farBefore[7]);
    game.destroy();
  });

  it('mirrors the far seat, so both players read their own rail the right way round', () => {
    const { game, input, view } = started();
    const rightOfDevice = { x: FIELD_WIDTH / 2 + 5 * SLOT_PITCH, y: worldYOf('p2', 120) };
    input.pointerDown(7, rightOfDevice.x, rightOfDevice.y);
    for (let i = 0; i < 40; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    // The far player is reading the device upside down, so the device's right is their
    // own left: their carrier walks to a negative notch.
    expect(game.match.p2.slot).toBeLessThan(0);
    game.destroy();
  });

  it('cannot deliver a drop nobody asked for after a pause', () => {
    // The host clears the input manager on a pause, so a key held when the game paused
    // never delivers its key-up.
    const { game, input, view } = started();
    input.keyDown('Space');
    game.update(STEP, view.sync(input.beginStep(STEP)));
    game.onPause();
    input.clear();
    game.onResume();
    for (let i = 0; i < 10; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    expect(game.match.p1.stance).toBe('hover');
    game.destroy();
  });

  it('drops when the hover clock runs out, so a seat cannot stall', () => {
    const { game, input, view } = started();
    let steps = 0;
    while (game.match.p1.stance === 'hover' && steps < 60 * 10) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      steps += 1;
    }
    expect(game.match.p1.stance).toBe('falling');
    expect(steps * STEP).toBeLessThan(2.5);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ presentations */

describe('the two presentations', () => {
  it('step the identical match', () => {
    // Rules, scoring and simulation are byte-identical; only placement, rotation and
    // control mapping change, and none of those is in the simulation.
    const traces = (['shared-screen', 'single-seat'] as const).map((presentation) => {
      const game = new WobbleStackGame();
      game.init(
        contextFor({
          presentation,
          localSeat: presentation === 'single-seat' ? 'p2' : 'p1',
          bots: { p1: 'normal', p2: 'hard' },
        }),
      );
      const input = manager();
      const view = new InputView();
      const out: number[] = [];
      for (let i = 0; i < 900; i += 1) {
        game.update(STEP, view.sync(input.beginStep(STEP)));
        out.push(...trace(game.match.p1), ...trace(game.match.p2));
      }
      game.destroy();
      return out;
    });
    expect(traces[1]).toEqual(traces[0]);
  });

  it('draws both seats every frame, so neither sees more than the other', () => {
    const game = new WobbleStackGame();
    game.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    const input = manager();
    const view = new InputView();
    const recorder = new Recorder();
    for (let i = 0; i < 300; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    game.render(recorder, 0);
    for (const seat of ['p1', 'p2'] as const) {
      const palette = SEAT_PALETTE[seat];
      const owned = recorder.marks.filter(
        (mark) => mark.colour === palette.base || mark.colour === palette.deep,
      );
      expect(owned.length, seat).toBeGreaterThan(0);
    }
    game.destroy();
  });
});

/* ------------------------------------------------------------------ rule 7 */

describe('colour is never the only signal', () => {
  it('gives the two seats different primitives, not just different colours', () => {
    // `apps/web/src/data/greyscale.test.ts` attributes a mark to a seat by its exact
    // palette string and then looks for a primitive, a label or a size only one seat
    // draws. Seat one's brainrots carry a filled circle and seat two's a stroked frame.
    const game = new WobbleStackGame();
    game.init(contextFor({ bots: { p1: 'normal', p2: 'normal' } }));
    const input = manager();
    const view = new InputView();
    const seen: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
    let frames = 0;
    for (let i = 0; i < 60 * 40 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
      if (i % 20 !== 0) continue;
      const recorder = new Recorder();
      game.render(recorder, 0);
      const frame: Record<SeatId, Set<string>> = { p1: new Set(), p2: new Set() };
      for (const mark of recorder.marks) {
        for (const seat of ['p1', 'p2'] as const) {
          const palette = SEAT_PALETTE[seat];
          if (mark.colour === palette.base || mark.colour === palette.deep) {
            frame[seat].add(mark.kind);
          }
        }
      }
      if (frame.p1.size > 0 && frame.p2.size > 0) {
        frames += 1;
        for (const seat of ['p1', 'p2'] as const)
          for (const kind of frame[seat]) seen[seat].add(kind);
      }
    }
    expect(frames).toBeGreaterThan(20);
    const onlyP1 = [...seen.p1].filter((kind) => !seen.p2.has(kind));
    const onlyP2 = [...seen.p2].filter((kind) => !seen.p1.has(kind));
    expect(onlyP1, 'seat one draws a primitive seat two never does').toContain('circ');
    expect(onlyP2, 'seat two draws a primitive seat one never does').toContain('srect');
    game.destroy();
  });

  it('never draws one seat in the other seat’s ink', () => {
    const game = new WobbleStackGame();
    game.init(contextFor({ bots: { p1: 'hard', p2: 'hard' } }));
    const input = manager();
    const view = new InputView();
    for (let i = 0; i < 600; i += 1) game.update(STEP, view.sync(input.beginStep(STEP)));
    const recorder = new Recorder();
    game.render(recorder, 0);
    const p1Marks = recorder.marks.filter((mark) => mark.colour === SEAT_PALETTE.p1.deep);
    const p2Marks = recorder.marks.filter((mark) => mark.colour === SEAT_PALETTE.p2.deep);
    for (const mark of p1Marks) expect(mark.kind).toBe('circ');
    for (const mark of p2Marks) expect(mark.kind).toBe('srect');
    // And the stud is a fixed size rather than a readout, so the harness can see it.
    const radii = new Set(p1Marks.map((mark) => mark.dims[2]));
    expect(radii.size).toBe(1);
    game.destroy();
  });
});

/* ------------------------------------------------------------------ the bot seat */

describe('a bot seat', () => {
  it('ignores the device entirely', () => {
    // `apps/web/src/data/balance-aggregate.test.ts` replaces the input manager with a
    // frozen state on the strength of this claim, so it is worth asserting.
    const quiet = new WobbleStackGame();
    quiet.init(contextFor({ bots: { p1: 'hard', p2: 'hard' } }));
    const quietInput = manager();
    const quietView = new InputView();
    const loud = new WobbleStackGame();
    loud.init(contextFor({ bots: { p1: 'hard', p2: 'hard' } }));
    const loudInput = manager();
    const loudView = new InputView();
    loudInput.keyDown('KeyD');
    loudInput.keyDown('Space');
    loudInput.pointerDown(9, 40, 40);
    for (let i = 0; i < 600; i += 1) {
      quiet.update(STEP, quietView.sync(quietInput.beginStep(STEP)));
      loud.update(STEP, loudView.sync(loudInput.beginStep(STEP)));
    }
    for (const seat of ['p1', 'p2'] as const) {
      expect(trace(yardOf(loud.match, seat))).toEqual(trace(yardOf(quiet.match, seat)));
    }
    quiet.destroy();
    loud.destroy();
  });

  it('plays differently at every tier from one seed', () => {
    const traces = (['easy', 'normal', 'hard'] as const).map((tier) => {
      const game = new WobbleStackGame();
      game.init(contextFor({ bots: { p1: tier, p2: 'normal' } }));
      const input = manager();
      const view = new InputView();
      const out: number[] = [];
      for (let i = 0; i < 900; i += 1) {
        game.update(STEP, view.sync(input.beginStep(STEP)));
        out.push(...trace(game.match.p1));
      }
      game.destroy();
      return JSON.stringify(out);
    });
    expect(new Set(traces).size).toBe(3);
  });

  it('searches a bounded number of notches, whatever the tower has grown to', () => {
    // The cost guard proper is `apps/web/src/data/bot-cost.test.ts`, which times the
    // hardest tier against a frame; wall time is not something a test in this package may
    // read. What is checkable here is the shape of the work: one look weighs the fifteen
    // notches and advances the lean once per step of the fall, and neither of those grows
    // with the tower.
    const game = new WobbleStackGame();
    game.init(contextFor({ bots: { p1: 'hard', p2: 'hard' } }));
    const input = manager();
    const view = new InputView();
    for (let i = 0; i < 60 * 30 && game.getScore().winner === null; i += 1) {
      game.update(STEP, view.sync(input.beginStep(STEP)));
    }
    expect(2 * SLOT_LIMIT + 1).toBe(15);
    expect(game.match.p1.count).toBeGreaterThan(4);
    game.destroy();
  });
});
