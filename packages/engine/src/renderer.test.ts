import { describe, it, expect } from 'vitest';
import { Canvas2DRenderer } from './renderer.js';
import type { Canvas2DLike } from './renderer.js';
import { fitViewport } from './viewport.js';
import type { Viewport } from './viewport.js';
import type { LogicalSize } from './seat.js';

const LOGICAL: LogicalSize = { width: 800, height: 600 };
const CENTRE_X = 400;
const CENTRE_Y = 300;
const TAU = Math.PI * 2;

/** 800x600 fitted into a 2000x1200 screen: scale 2, letterboxed 200 either side. */
const VIEW: Viewport = {
  scale: 2,
  offsetX: 200,
  offsetY: 0,
  width: 1600,
  height: 1200,
  logicalWidth: 800,
  logicalHeight: 600,
};

type CallArg = number | string | boolean | undefined;

interface RecordedCall {
  readonly op: string;
  readonly args: readonly CallArg[];
}

/** Canvas transform in the browser's own order: [a, b, c, d, e, f]. */
type Matrix = [number, number, number, number, number, number];

/**
 * Hand-written Canvas2DLike that logs every call and property write, and tracks the
 * composed transform so tests can check where a logical point actually lands. No
 * jsdom and no real canvas: the renderer's whole contract is observable from here.
 *
 * Property writes are logged as `set:<name>`. Trailing arguments the caller omitted
 * are trimmed, so an optional parameter that was never passed does not appear.
 */
class RecordingContext implements Canvas2DLike {
  readonly calls: RecordedCall[] = [];
  /** Deterministic stand-in for real font metrics. */
  widthPerChar = 7;

  #matrix: Matrix = [1, 0, 0, 1, 0, 0];
  #stack: Matrix[] = [];

  #fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  #strokeStyle: string | CanvasGradient | CanvasPattern = '#000000';
  #lineWidth = 1;
  #font = '10px sans-serif';
  #textAlign: CanvasTextAlign = 'start';
  #textBaseline: CanvasTextBaseline = 'alphabetic';

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.#fillStyle;
  }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    this.#fillStyle = value;
    this.#record('set:fillStyle', RecordingContext.#styleTag(value));
  }

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.#strokeStyle;
  }
  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    this.#strokeStyle = value;
    this.#record('set:strokeStyle', RecordingContext.#styleTag(value));
  }

  get lineWidth(): number {
    return this.#lineWidth;
  }
  set lineWidth(value: number) {
    this.#lineWidth = value;
    this.#record('set:lineWidth', value);
  }

  get font(): string {
    return this.#font;
  }
  set font(value: string) {
    this.#font = value;
    this.#record('set:font', value);
  }

  get textAlign(): CanvasTextAlign {
    return this.#textAlign;
  }
  set textAlign(value: CanvasTextAlign) {
    this.#textAlign = value;
    this.#record('set:textAlign', value);
  }

  get textBaseline(): CanvasTextBaseline {
    return this.#textBaseline;
  }
  set textBaseline(value: CanvasTextBaseline) {
    this.#textBaseline = value;
    this.#record('set:textBaseline', value);
  }

  save(): void {
    const m = this.#matrix;
    this.#stack.push([m[0], m[1], m[2], m[3], m[4], m[5]]);
    this.#record('save');
  }

  restore(): void {
    const previous = this.#stack.pop();
    // A real context silently ignores this; the fake is strict so an unbalanced
    // restore fails the test that caused it instead of the next one.
    if (previous === undefined) throw new Error('fake: restore without a matching save');
    this.#matrix = previous;
    this.#record('restore');
  }

  translate(x: number, y: number): void {
    const m = this.#matrix;
    m[4] = m[0] * x + m[2] * y + m[4];
    m[5] = m[1] * x + m[3] * y + m[5];
    this.#record('translate', x, y);
  }

  rotate(angle: number): void {
    const m = this.#matrix;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const a = m[0];
    const b = m[1];
    const cc = m[2];
    const d = m[3];
    m[0] = a * c + cc * s;
    m[1] = b * c + d * s;
    m[2] = cc * c - a * s;
    m[3] = d * c - b * s;
    this.#record('rotate', angle);
  }

  scale(x: number, y: number): void {
    const m = this.#matrix;
    m[0] *= x;
    m[1] *= x;
    m[2] *= y;
    m[3] *= y;
    this.#record('scale', x, y);
  }

  beginPath(): void {
    this.#record('beginPath');
  }

  closePath(): void {
    this.#record('closePath');
  }

  moveTo(x: number, y: number): void {
    this.#record('moveTo', x, y);
  }

  lineTo(x: number, y: number): void {
    this.#record('lineTo', x, y);
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    this.#record('arc', x, y, radius, startAngle, endAngle, counterclockwise);
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.#record('rect', x, y, width, height);
  }

  fill(): void {
    this.#record('fill');
  }

  stroke(): void {
    this.#record('stroke');
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.#record('fillRect', x, y, width, height);
  }

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this.#record('fillText', text, x, y, maxWidth);
  }

  measureText(text: string): { readonly width: number } {
    this.#record('measureText', text);
    return { width: text.length * this.widthPerChar };
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.#record('clearRect', x, y, width, height);
  }

  /** Where the current transform puts a logical point. */
  deviceX(x: number, y: number): number {
    const m = this.#matrix;
    return m[0] * x + m[2] * y + m[4];
  }

  deviceY(x: number, y: number): number {
    const m = this.#matrix;
    return m[1] * x + m[3] * y + m[5];
  }

  get saveDepth(): number {
    return this.#stack.length;
  }

  reset(): void {
    this.calls.length = 0;
  }

  static #styleTag(value: string | CanvasGradient | CanvasPattern): string {
    return typeof value === 'string' ? value : '<non-string style>';
  }

  #record(op: string, ...args: CallArg[]): void {
    let end = args.length;
    while (end > 0 && args[end - 1] === undefined) end -= 1;
    this.calls.push({ op, args: args.slice(0, end) });
  }
}

function setup(): { fake: RecordingContext; renderer: Canvas2DRenderer } {
  const fake = new RecordingContext();
  return { fake, renderer: new Canvas2DRenderer(fake, LOGICAL) };
}

function opsOf(fake: RecordingContext): string[] {
  return fake.calls.map((call) => call.op);
}

function countOp(fake: RecordingContext, op: string): number {
  let total = 0;
  for (const call of fake.calls) {
    if (call.op === op) total += 1;
  }
  return total;
}

/** Every argument list recorded for `op`, in order. */
function argsFor(fake: RecordingContext, op: string): (readonly CallArg[])[] {
  const found: (readonly CallArg[])[] = [];
  for (const call of fake.calls) {
    if (call.op === op) found.push(call.args);
  }
  return found;
}

/** First argument of every record for `op`, in order. */
function valuesOf(fake: RecordingContext, op: string): CallArg[] {
  const found: CallArg[] = [];
  for (const call of fake.calls) {
    if (call.op === op) found.push(call.args[0]);
  }
  return found;
}

describe('construction', () => {
  it('rejects a logical box that is not positive and finite', () => {
    const fake = new RecordingContext();
    expect(() => new Canvas2DRenderer(fake, { width: 0, height: 600 })).toThrow(RangeError);
    expect(() => new Canvas2DRenderer(fake, { width: 800, height: -1 })).toThrow(RangeError);
    expect(() => new Canvas2DRenderer(fake, { width: Number.NaN, height: 600 })).toThrow(
      RangeError,
    );
    expect(fake.calls).toEqual([]);
  });

  it('draws with an identity transform until a viewport is set', () => {
    const { fake, renderer } = setup();

    renderer.beginFrame();

    expect(fake.calls).toEqual([
      { op: 'save', args: [] },
      { op: 'translate', args: [0, 0] },
      { op: 'scale', args: [1, 1] },
    ]);
  });
});

describe('draw calls', () => {
  it('clear wipes then fills the whole logical area', () => {
    const { fake, renderer } = setup();

    renderer.clear('#101820');

    expect(fake.calls).toEqual([
      { op: 'clearRect', args: [0, 0, 800, 600] },
      { op: 'set:fillStyle', args: ['#101820'] },
      { op: 'fillRect', args: [0, 0, 800, 600] },
    ]);
  });

  it('rect fills at the logical coordinates it was given', () => {
    const { fake, renderer } = setup();

    renderer.rect(10, 20, 30, 40, '#ff00ff');

    expect(fake.calls).toEqual([
      { op: 'set:fillStyle', args: ['#ff00ff'] },
      { op: 'fillRect', args: [10, 20, 30, 40] },
    ]);
  });

  it('strokeRect builds a path and strokes it at the given width', () => {
    const { fake, renderer } = setup();

    renderer.strokeRect(1, 2, 3, 4, 5, '#00ff00');

    expect(fake.calls).toEqual([
      { op: 'beginPath', args: [] },
      { op: 'rect', args: [1, 2, 3, 4] },
      { op: 'set:lineWidth', args: [5] },
      { op: 'set:strokeStyle', args: ['#00ff00'] },
      { op: 'stroke', args: [] },
    ]);
  });

  it('circle arcs a full turn and fills', () => {
    const { fake, renderer } = setup();

    renderer.circle(40, 50, 12, '#0000ff');

    expect(fake.calls).toEqual([
      { op: 'beginPath', args: [] },
      { op: 'arc', args: [40, 50, 12, 0, TAU] },
      { op: 'closePath', args: [] },
      { op: 'set:fillStyle', args: ['#0000ff'] },
      { op: 'fill', args: [] },
    ]);
  });

  it('strokeCircle arcs a full turn and strokes', () => {
    const { fake, renderer } = setup();

    renderer.strokeCircle(40, 50, 12, 3, '#ffffff');

    expect(fake.calls).toEqual([
      { op: 'beginPath', args: [] },
      { op: 'arc', args: [40, 50, 12, 0, TAU] },
      { op: 'closePath', args: [] },
      { op: 'set:lineWidth', args: [3] },
      { op: 'set:strokeStyle', args: ['#ffffff'] },
      { op: 'stroke', args: [] },
    ]);
  });

  it('line moves and draws to the two logical points', () => {
    const { fake, renderer } = setup();

    renderer.line(0, 0, 100, 50, 3, '#cccccc');

    expect(fake.calls).toEqual([
      { op: 'beginPath', args: [] },
      { op: 'moveTo', args: [0, 0] },
      { op: 'lineTo', args: [100, 50] },
      { op: 'set:lineWidth', args: [3] },
      { op: 'set:strokeStyle', args: ['#cccccc'] },
      { op: 'stroke', args: [] },
    ]);
  });

  it('never turns logical coordinates into pixels itself', () => {
    const { fake, renderer } = setup();
    renderer.setViewport(VIEW);
    renderer.beginFrame();
    fake.reset();

    renderer.rect(10, 20, 30, 40, '#fff');
    renderer.circle(400, 300, 25, '#fff');

    // Arguments are the logical ones; the scale and offset live in the transform.
    expect(argsFor(fake, 'fillRect')).toEqual([[10, 20, 30, 40]]);
    expect(argsFor(fake, 'arc')).toEqual([[400, 300, 25, 0, TAU]]);
  });

  it('repeats the identical call sequence when the same shape is drawn twice', () => {
    const { fake, renderer } = setup();

    renderer.rect(10, 20, 30, 40, '#ff00ff');
    renderer.rect(10, 20, 30, 40, '#ff00ff');

    // Nothing extra on the second draw: no per-call save/restore, no re-setup.
    expect(fake.calls).toHaveLength(4);
    expect(fake.calls.slice(0, 2)).toEqual(fake.calls.slice(2, 4));
  });
});

describe('setViewport', () => {
  it('applies the letterbox offset and the scale once per frame', () => {
    const { fake, renderer } = setup();

    renderer.setViewport(VIEW);
    renderer.beginFrame();

    expect(fake.calls).toEqual([
      { op: 'save', args: [] },
      { op: 'translate', args: [200, 0] },
      { op: 'scale', args: [2, 2] },
    ]);
  });

  it('places the logical corners where the fitted viewport says', () => {
    const { fake, renderer } = setup();
    renderer.setViewport(fitViewport(LOGICAL, 2000, 1200));

    renderer.beginFrame();

    expect(fake.deviceX(0, 0)).toBeCloseTo(200, 10);
    expect(fake.deviceY(0, 0)).toBeCloseTo(0, 10);
    expect(fake.deviceX(800, 600)).toBeCloseTo(1800, 10);
    expect(fake.deviceY(800, 600)).toBeCloseTo(1200, 10);
  });

  it('applies a collapsed viewport rather than throwing', () => {
    const { fake, renderer } = setup();

    renderer.setViewport(fitViewport(LOGICAL, 0, 0));
    renderer.beginFrame();

    expect(argsFor(fake, 'scale')).toEqual([[0, 0]]);
  });

  it('rejects a viewport fitted to a different logical box', () => {
    const { renderer } = setup();
    const wrong = fitViewport({ width: 1000, height: 600 }, 2000, 1200);

    expect(() => {
      renderer.setViewport(wrong);
    }).toThrow(RangeError);
  });

  it('uses only one save and one restore however many shapes a frame draws', () => {
    const { fake, renderer } = setup();
    renderer.setViewport(VIEW);

    renderer.beginFrame();
    for (let i = 0; i < 20; i += 1) {
      renderer.rect(i, i, 4, 4, '#fff');
      renderer.circle(i, i, 2, '#fff');
      renderer.text('x', i, i, 16, '#fff');
    }
    renderer.endFrame();

    expect(countOp(fake, 'save')).toBe(1);
    expect(countOp(fake, 'restore')).toBe(1);
    expect(fake.saveDepth).toBe(0);
  });
});

describe('frames', () => {
  it('restores the transform it found', () => {
    const { fake, renderer } = setup();
    renderer.setViewport(VIEW);

    renderer.beginFrame();
    renderer.endFrame();

    expect(fake.deviceX(10, 10)).toBe(10);
    expect(fake.deviceY(10, 10)).toBe(10);
  });

  it('rejects a second beginFrame while a frame is open', () => {
    const { renderer } = setup();
    renderer.beginFrame();

    expect(() => {
      renderer.beginFrame();
    }).toThrow(/beginFrame/);
  });

  it('rejects endFrame with no frame open', () => {
    const { renderer } = setup();

    expect(() => {
      renderer.endFrame();
    }).toThrow(/endFrame/);
  });

  it('unwinds a leaked seat rotation before reporting it', () => {
    const { fake, renderer } = setup();
    renderer.beginFrame();
    renderer.pushSeatRotation(true);

    expect(() => {
      renderer.endFrame();
    }).toThrow(/unbalanced/);

    // The context stack is left clean, so the next frame is not corrupted.
    expect(fake.saveDepth).toBe(0);
    expect(countOp(fake, 'save')).toBe(2);
    expect(countOp(fake, 'restore')).toBe(2);
    expect(renderer.seatRotationDepth).toBe(0);
    renderer.beginFrame();
    renderer.endFrame();
    expect(fake.saveDepth).toBe(0);
  });
});

describe('seat rotation', () => {
  it('turns half a turn about the logical centre', () => {
    const { fake, renderer } = setup();

    renderer.pushSeatRotation(true);

    expect(fake.calls).toEqual([
      { op: 'save', args: [] },
      { op: 'translate', args: [CENTRE_X, CENTRE_Y] },
      { op: 'rotate', args: [Math.PI] },
      { op: 'translate', args: [-CENTRE_X, -CENTRE_Y] },
    ]);
  });

  it('maps each logical corner onto the opposite one', () => {
    const { fake, renderer } = setup();

    renderer.pushSeatRotation(true);

    expect(fake.deviceX(0, 0)).toBeCloseTo(800, 9);
    expect(fake.deviceY(0, 0)).toBeCloseTo(600, 9);
    expect(fake.deviceX(800, 600)).toBeCloseTo(0, 9);
    expect(fake.deviceY(800, 600)).toBeCloseTo(0, 9);
    // The centre is the fixed point of the rotation.
    expect(fake.deviceX(CENTRE_X, CENTRE_Y)).toBeCloseTo(CENTRE_X, 9);
    expect(fake.deviceY(CENTRE_X, CENTRE_Y)).toBeCloseTo(CENTRE_Y, 9);
  });

  it('composes with the viewport rather than replacing it', () => {
    const { fake, renderer } = setup();
    renderer.setViewport(VIEW);
    renderer.beginFrame();

    renderer.pushSeatRotation(true);

    // Logical (0,0) now lands where the unrotated logical (800,600) does: 200 + 800*2.
    expect(fake.deviceX(0, 0)).toBeCloseTo(1800, 8);
    expect(fake.deviceY(0, 0)).toBeCloseTo(1200, 8);
  });

  it('still saves and restores for the seat that is not rotated', () => {
    const { fake, renderer } = setup();

    renderer.pushSeatRotation(false);

    expect(fake.calls).toEqual([{ op: 'save', args: [] }]);
    expect(fake.deviceX(10, 20)).toBe(10);
    expect(fake.deviceY(10, 20)).toBe(20);

    renderer.popSeatRotation();

    expect(opsOf(fake)).toEqual(['save', 'restore']);
    expect(renderer.seatRotationDepth).toBe(0);
  });

  it('balances nested pushes', () => {
    const { fake, renderer } = setup();

    renderer.pushSeatRotation(true);
    expect(renderer.seatRotationDepth).toBe(1);
    renderer.pushSeatRotation(false);
    expect(renderer.seatRotationDepth).toBe(2);
    renderer.popSeatRotation();
    renderer.popSeatRotation();

    expect(renderer.seatRotationDepth).toBe(0);
    expect(countOp(fake, 'save')).toBe(2);
    expect(countOp(fake, 'restore')).toBe(2);
    expect(fake.saveDepth).toBe(0);
    // Back to where it started.
    expect(fake.deviceX(123, 45)).toBe(123);
    expect(fake.deviceY(123, 45)).toBe(45);
  });

  it('undoes the rotation on pop', () => {
    const { fake, renderer } = setup();

    renderer.pushSeatRotation(true);
    renderer.popSeatRotation();

    expect(fake.deviceX(0, 0)).toBe(0);
    expect(fake.deviceY(0, 0)).toBe(0);
  });

  it('throws on a pop with no matching push, without touching the context', () => {
    const { fake, renderer } = setup();

    expect(() => {
      renderer.popSeatRotation();
    }).toThrow(/pushSeatRotation/);

    expect(fake.calls).toEqual([]);
    expect(renderer.seatRotationDepth).toBe(0);
  });

  it('throws on the pop that overruns a balanced pair', () => {
    const { fake, renderer } = setup();
    renderer.pushSeatRotation(true);
    renderer.popSeatRotation();
    fake.reset();

    expect(() => {
      renderer.popSeatRotation();
    }).toThrow(Error);

    expect(fake.calls).toEqual([]);
  });
});

describe('text', () => {
  it('sets font, alignment, baseline and colour before filling', () => {
    const { fake, renderer } = setup();

    renderer.text('42', 10, 20, 24, '#ffffff');

    expect(opsOf(fake)).toEqual([
      'set:font',
      'set:textAlign',
      'set:textBaseline',
      'set:fillStyle',
      'fillText',
    ]);
    expect(valuesOf(fake, 'set:textBaseline')).toEqual(['middle']);
    expect(argsFor(fake, 'fillText')).toEqual([['42', 10, 20]]);
  });

  it('defaults to left alignment', () => {
    const { fake, renderer } = setup();

    renderer.text('42', 10, 20, 24, '#ffffff');

    expect(valuesOf(fake, 'set:textAlign')).toEqual(['left']);
  });

  it("maps 'centre' to the canvas spelling", () => {
    const { fake, renderer } = setup();

    renderer.text('42', 10, 20, 24, '#ffffff', 'centre');

    expect(valuesOf(fake, 'set:textAlign')).toEqual(['center']);
  });

  it('passes left and right through unchanged', () => {
    const { fake, renderer } = setup();

    renderer.text('a', 0, 0, 24, '#fff', 'left');
    renderer.text('b', 0, 0, 24, '#fff', 'right');

    expect(valuesOf(fake, 'set:textAlign')).toEqual(['left', 'right']);
  });

  it('names the size in the font declaration', () => {
    const { fake, renderer } = setup();

    renderer.text('42', 10, 20, 24, '#ffffff');

    expect(String(valuesOf(fake, 'set:font')[0])).toMatch(/^24px \S/);
  });
});

describe('font cache', () => {
  it('hands back the same string for a repeated size', () => {
    const { fake, renderer } = setup();

    renderer.text('a', 0, 0, 24, '#fff');
    renderer.text('b', 10, 10, 24, '#fff');

    const fonts = valuesOf(fake, 'set:font');
    // One assignment per call and no template string rebuilt in between.
    expect(fonts).toHaveLength(2);
    expect(fonts[0]).toBe(fonts[1]);
  });

  it('keeps a size cached across an intervening different size', () => {
    const { fake, renderer } = setup();

    renderer.text('a', 0, 0, 24, '#fff');
    renderer.text('b', 0, 0, 48, '#fff');
    renderer.text('c', 0, 0, 24, '#fff');

    const fonts = valuesOf(fake, 'set:font');
    expect(fonts).toHaveLength(3);
    expect(fonts[0]).toBe(fonts[2]);
    expect(fonts[0]).not.toBe(fonts[1]);
  });

  it('is shared with measureText', () => {
    const { fake, renderer } = setup();

    renderer.text('a', 0, 0, 24, '#fff');
    const width = renderer.measureText('abc', 24);

    const fonts = valuesOf(fake, 'set:font');
    expect(fonts[0]).toBe(fonts[1]);
    expect(width).toBe(3 * fake.widthPerChar);
  });

  it('builds the identical declaration in a second renderer with a cold cache', () => {
    const first = setup();
    const second = setup();

    first.renderer.text('a', 0, 0, 32, '#fff');
    second.renderer.text('a', 0, 0, 32, '#fff');

    expect(valuesOf(first.fake, 'set:font')[0]).toBe(valuesOf(second.fake, 'set:font')[0]);
  });
});
