import { describe, expect, it } from 'vitest';
import { InputManager, InputView, Rng, SEAT_PALETTE } from '@duelbox/engine';
import type { SeatId } from '@duelbox/engine';
import type { Renderer } from '@duelbox/game-sdk';
import { manifest } from './manifest.js';
import { KIND_COLOUR, PizzaMemoryGame } from './game.js';
import { KIND_COUNT, STATION_COUNT, railX } from './rules.js';

/**
 * Rule 7, checked here rather than asserted in prose — and checked twice over, because in a
 * memory game about ingredients it is the whole of the design rather than a finish on it.
 *
 * `apps/web/src/data/greyscale.test.ts` is the repository's guard and it asks one question:
 * are the two *seats* told apart by anything but colour? That file is shared and this package
 * may not touch it, so **its algorithm is reproduced here, constant for constant**, against
 * this game alone — so the verdict is known before it lands rather than after.
 *
 * The second question is the one that file cannot ask and this game lives or dies on: are the
 * five *toppings* told apart by anything but colour? "Recompose the pizza exactly as you saw
 * it" is unplayable in greyscale if pepperoni and olive are two shades of the same disc. Each
 * kind therefore carries its own silhouette, and the colours are spaced in luminance as well,
 * so the shape and the shade say the same thing twice.
 */

/* ------------------------------------------------ the shared harness, reproduced */

const STEP = 1 / 60;
const STEPS_PER_MATCH = 1800;
const SAMPLE_EVERY = 12;
const MIN_INK_FRACTION = 1e-5;
const MAX_AREA_FRACTION = 0.25;
const SIZE_STEPS_PER_DOUBLING = 4;
const SIZE_SLACK = 1;
const STABILITY = 0.5;
const SIZE_CONSTANCY = 0.9;
const MIN_SHARED_FRAMES = 10;

interface Mark {
  readonly seat: SeatId | null;
  readonly kind: string;
  readonly dims: readonly number[];
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
}

const SEAT_COLOURS: ReadonlyMap<string, SeatId> = new Map(
  (['p1', 'p2'] as const).flatMap((seat): [string, SeatId][] => {
    const palette = SEAT_PALETTE[seat];
    return [palette.base, palette.deep, palette.tint, palette.soft].map((colour) => [colour, seat]);
  }),
);

class RecordingRenderer implements Renderer {
  readonly marks: Mark[] = [];
  readonly #minInk: number;

  constructor(minInk: number) {
    this.#minInk = minInk;
  }

  #push(
    kind: string,
    dims: readonly number[],
    colour: string,
    cx: number,
    cy: number,
    width: number,
    height: number,
  ): void {
    if (dims.some((dim) => !(dim > 0))) return;
    const w = Math.abs(width);
    const h = Math.abs(height);
    if (w * h < this.#minInk) return;
    this.marks.push({
      seat: SEAT_COLOURS.get(colour) ?? null,
      kind,
      dims,
      cx,
      cy,
      width: w,
      height: h,
    });
  }

  clear(): void {}
  rect(x: number, y: number, width: number, height: number, colour: string): void {
    this.#push(
      'rect',
      [Math.abs(width), Math.abs(height)],
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
      'srect',
      [Math.abs(width), Math.abs(height), lineWidth],
      colour,
      x + width / 2,
      y + height / 2,
      width,
      height,
    );
  }
  circle(x: number, y: number, radius: number, colour: string): void {
    this.#push('circ', [radius], colour, x, y, radius * 2, radius * 2);
  }
  strokeCircle(x: number, y: number, radius: number, lineWidth: number, colour: string): void {
    this.#push('scirc', [radius, lineWidth], colour, x, y, radius * 2, radius * 2);
  }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, colour: string): void {
    const length = Math.hypot(x2 - x1, y2 - y1);
    this.#push(
      'line',
      [length, lineWidth],
      colour,
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      Math.abs(x2 - x1) + lineWidth,
      Math.abs(y2 - y1) + lineWidth,
    );
  }
  text(value: string, x: number, y: number, sizePx: number, colour: string): void {
    this.#push(
      `text:${value}`,
      [value.length, sizePx],
      colour,
      x,
      y,
      value.length * sizePx * 0.6,
      sizePx,
    );
  }
  pushSeatRotation(): void {}
  pushRotation(): void {}
  popSeatRotation(): void {}
}

interface FrameMarks {
  readonly p1: readonly Mark[] | null;
  readonly p2: readonly Mark[] | null;
}

function ownFrame(marks: readonly Mark[], area: number): FrameMarks {
  const owned: Record<SeatId, Mark[]> = { p1: [], p2: [] };
  const playable = marks.filter((mark) => mark.width * mark.height <= area * MAX_AREA_FRACTION);
  for (const mark of playable) {
    if (mark.seat === null) continue;
    owned[mark.seat].push(mark);
  }
  if (owned.p1.length === 0 || owned.p2.length === 0) {
    return {
      p1: owned.p1.length > 0 ? owned.p1 : null,
      p2: owned.p2.length > 0 ? owned.p2 : null,
    };
  }
  const anchors: Record<SeatId, readonly Mark[]> = { p1: [...owned.p1], p2: [...owned.p2] };
  for (const mark of playable) {
    if (mark.seat !== null) continue;
    let owner: SeatId | null = null;
    let ambiguous = false;
    for (const seat of ['p1', 'p2'] as const) {
      const hit = anchors[seat].some(
        (anchor) =>
          mark.width <= anchor.width &&
          mark.height <= anchor.height &&
          Math.abs(mark.cx - anchor.cx) <= anchor.width / 2 &&
          Math.abs(mark.cy - anchor.cy) <= anchor.height / 2,
      );
      if (!hit) continue;
      if (owner !== null) ambiguous = true;
      owner = seat;
    }
    if (owner !== null && !ambiguous) owned[owner].push(mark);
  }
  return { p1: owned.p1, p2: owned.p2 };
}

function sizeClass(dims: readonly number[]): string {
  return dims.map((dim) => String(Math.floor(Math.log2(dim) * SIZE_STEPS_PER_DOUBLING))).join(',');
}

function glyphOf(mark: Mark): string {
  return `${mark.kind}#${sizeClass(mark.dims)}`;
}

function alike(a: string, b: string): boolean {
  const cutA = a.indexOf('#');
  const cutB = b.indexOf('#');
  if (a.slice(0, cutA) !== b.slice(0, cutB)) return false;
  const mine = a.slice(cutA + 1).split(',');
  const theirs = b.slice(cutB + 1).split(',');
  if (mine.length !== theirs.length) return false;
  return mine.every((value, i) => Math.abs(Number(value) - Number(theirs[i])) <= SIZE_SLACK);
}

interface Signature {
  readonly shared: number;
  readonly kinds: ReadonlyMap<string, number>;
  readonly glyphs: ReadonlyMap<string, string>;
}

function signatureOf(
  frames: readonly FrameMarks[],
  pick: (frame: FrameMarks) => readonly Mark[] | null,
): Signature {
  const kinds = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (const frame of frames) {
    const marks = pick(frame);
    if (marks === null) continue;
    const frameKinds = new Set<string>();
    const frameGlyphs = new Set<string>();
    for (const mark of marks) {
      frameKinds.add(mark.kind);
      frameGlyphs.add(glyphOf(mark));
    }
    for (const kind of frameKinds) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    for (const glyph of frameGlyphs) sizes.set(glyph, (sizes.get(glyph) ?? 0) + 1);
  }
  const holds = (mark: Mark): boolean =>
    (sizes.get(glyphOf(mark)) ?? 0) >= SIZE_CONSTANCY * (kinds.get(mark.kind) ?? 0);
  const counted = new Map<string, number[]>();
  for (const frame of frames) {
    const marks = pick(frame);
    if (marks === null) continue;
    const counts = new Map<string, number>();
    for (const mark of marks) {
      if (!holds(mark)) continue;
      const glyph = glyphOf(mark);
      counts.set(glyph, (counts.get(glyph) ?? 0) + 1);
    }
    for (const [glyph, n] of counts) {
      const list = counted.get(glyph);
      if (list === undefined) counted.set(glyph, [n]);
      else list.push(n);
    }
  }
  const glyphs = new Map<string, string>();
  for (const [glyph, list] of counted) {
    if (list.length < STABILITY * frames.length) continue;
    const first = list[0] ?? 0;
    glyphs.set(glyph, list.every((n) => n === first) ? String(first) : '*');
  }
  return { shared: frames.length, kinds, glyphs };
}

function indistinguishable(a: Signature, b: Signature): boolean {
  for (const [side, other] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const [kind, frames] of side.kinds) {
      if (frames < STABILITY * side.shared) continue;
      if (!other.kinds.has(kind)) return false;
    }
    for (const [glyph, count] of side.glyphs) {
      const theirs = other.glyphs.get(glyph);
      if (theirs !== undefined) {
        if (count !== '*' && theirs !== '*' && count !== theirs) return false;
        continue;
      }
      let near = false;
      for (const candidate of other.glyphs.keys()) {
        if (alike(glyph, candidate)) {
          near = true;
          break;
        }
      }
      if (!near) return false;
    }
  }
  return true;
}

interface Run {
  readonly seed: number;
  readonly opening: SeatId;
  readonly difficulty: 'easy' | 'normal' | 'hard' | null;
}

const RUNS: readonly Run[] = [
  { seed: 20260829, opening: 'p1', difficulty: 'normal' },
  { seed: 424242, opening: 'p2', difficulty: 'hard' },
  { seed: 90210, opening: 'p1', difficulty: null },
];

function playMatch(run: Run): FrameMarks[] {
  const logical = manifest.logical;
  const area = logical.width * logical.height;
  const renderer = new RecordingRenderer(area * MIN_INK_FRACTION);
  const game = new PizzaMemoryGame();
  game.init({
    manifest,
    rng: new Rng(run.seed),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: run.opening,
    botDifficulty: () => run.difficulty,
  });
  const input = new InputManager(logical, { split: 'horizontal', bottomSeat: 'p1' });
  const view = new InputView();
  const script = new Rng(run.seed ^ 0x5f3759df);
  const frames: FrameMarks[] = [];
  for (let step = 0; step < STEPS_PER_MATCH; step += 1) {
    if (step % 13 === 0) {
      input.pointerDown(step % 3, script.float() * logical.width, script.float() * logical.height);
    }
    if (step % 13 === 5) input.pointerUp(step % 3);
    if (step % 29 === 0) {
      input.keyDown('KeyW');
      input.keyDown('ArrowUp');
    }
    if (step % 29 === 11) {
      input.keyUp('KeyW');
      input.keyUp('ArrowUp');
    }
    game.update(STEP, view.sync(input.beginStep(STEP)));
    if (step % SAMPLE_EVERY !== 0) continue;
    renderer.marks.length = 0;
    game.render(renderer, 0);
    frames.push(ownFrame(renderer.marks, area));
  }
  game.destroy();
  return frames;
}

/* ------------------------------------------------------------------ the verdicts */

describe('rule 7: the two seats differ by more than colour', () => {
  it('reaches the shared harness’s verdict, and the verdict is that they differ', () => {
    const frames: FrameMarks[] = [];
    for (const run of RUNS) frames.push(...playMatch(run));
    const shared = frames.filter((frame) => frame.p1 !== null && frame.p2 !== null);
    expect(
      shared.length,
      'the two counters must be on screen together for the harness to judge this game at all',
    ).toBeGreaterThan(MIN_SHARED_FRAMES);

    const p1 = signatureOf(shared, (frame) => frame.p1);
    const p2 = signatureOf(shared, (frame) => frame.p2);
    expect(
      indistinguishable(p1, p2),
      `both seats drawn from the identical shapes.\n  p1: ${[...p1.glyphs.keys()].join(', ')}\n  p2: ${[...p2.glyphs.keys()].join(', ')}`,
    ).toBe(false);
  });

  it('separates them on a primitive one seat draws and the other never does', () => {
    // The strongest evidence rule 7 names, and the one this game is built on: seat one's
    // furniture is stroked circles and seat two's is stroked rectangles, everywhere.
    const frames = playMatch(RUNS[0]!);
    const shared = frames.filter((frame) => frame.p1 !== null && frame.p2 !== null);
    const p1 = signatureOf(shared, (frame) => frame.p1);
    const p2 = signatureOf(shared, (frame) => frame.p2);
    expect(p1.kinds.has('scirc')).toBe(true);
    expect(p2.kinds.has('scirc')).toBe(false);
    expect(p2.kinds.has('srect')).toBe(true);
    expect(p1.kinds.has('srect')).toBe(false);
  });

  it('is never told by a colour the harness would have to read as a seat', () => {
    // Every mark that is *not* in a seat palette is an ingredient or a fitting, and none of
    // them may be mistaken for one: a colour is a seat colour or it is not.
    const frames = playMatch(RUNS[1]!);
    expect(frames.length).toBeGreaterThan(50);
    for (const colour of KIND_COLOUR) expect(SEAT_COLOURS.has(colour)).toBe(false);
  });
});

/* --------------------------------------------------- the toppings, without colour */

/** sRGB relative luminance, the quantity a greyscale screen actually shows. */
function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((raw) => {
    const c = raw / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Every mark drawn inside the plate at one rail station, with its colour thrown away. */
function stationGlyph(seat: SeatId, station: number, keepColour: boolean): string {
  const renderer = new RecordingRenderer(0);
  const game = new PizzaMemoryGame();
  game.init({
    manifest,
    rng: new Rng(5150),
    presentation: 'shared-screen',
    localSeat: 'p1',
    openingSeat: 'p1',
    botDifficulty: () => null,
  });
  game.render(renderer, 0);
  game.destroy();
  const cx = railX(seat, station);
  const cy = seat === 'p1' ? 930 : 70;
  return renderer.marks
    .filter((mark) => Math.abs(mark.cx - cx) <= 34 && Math.abs(mark.cy - cy) <= 34)
    .filter((mark) => mark.seat === null)
    .map((mark) => `${mark.kind}:${mark.dims.map((d) => d.toFixed(2)).join('/')}`)
    .concat(keepColour ? ['coloured'] : [])
    .sort()
    .join(' ');
}

describe('rule 7: the five toppings differ by more than colour', () => {
  it('gives every topping its own silhouette, for both seats', () => {
    // Throw every colour away and the five ingredients must still be five different things,
    // or "recompose it exactly as you saw it" is a task a greyscale player cannot begin.
    for (const seat of ['p1', 'p2'] as const) {
      const glyphs = new Set<string>();
      for (let kind = 0; kind < KIND_COUNT; kind += 1) {
        const glyph = stationGlyph(seat, kind, false);
        expect(glyph.length, `${seat} station ${String(kind)} drew nothing`).toBeGreaterThan(0);
        glyphs.add(glyph);
      }
      expect(
        glyphs.size,
        `${seat} draws two toppings the same shape: ${[...glyphs].join(' | ')}`,
      ).toBe(KIND_COUNT);
    }
  });

  it('gives the bell a silhouette of its own too', () => {
    const bell = stationGlyph('p1', STATION_COUNT - 1, false);
    for (let kind = 0; kind < KIND_COUNT; kind += 1) {
      expect(bell).not.toBe(stationGlyph('p1', kind, false));
    }
  });

  it('draws the two seats’ toppings identically, so neither has an easier ingredient', () => {
    for (let kind = 0; kind < KIND_COUNT; kind += 1) {
      expect(stationGlyph('p2', kind, false)).toBe(stationGlyph('p1', kind, false));
    }
  });

  it('spaces the five colours in luminance, so the shade says it a second time', () => {
    const sorted = KIND_COLOUR.map(luminance).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = sorted[i]! - sorted[i - 1]!;
      expect(gap, `two toppings sit ${gap.toFixed(3)} apart in luminance`).toBeGreaterThan(0.04);
    }
    expect(KIND_COLOUR).toHaveLength(KIND_COUNT);
    expect(new Set(KIND_COLOUR).size).toBe(KIND_COUNT);
  });
});
