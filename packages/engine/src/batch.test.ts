import { describe, expect, it } from 'vitest';
import {
  Canvas2DSpriteSink,
  LineBatch,
  SpriteBatch,
  WebGLSpriteSink,
} from './batch.js';
import type { DrawImageContext, LineSink, SpriteSink, WebGLLike } from './batch.js';

/** Records the begin/sprite/end calls a flush makes, for asserting batching. */
class RecordingSpriteSink implements SpriteSink {
  readonly log: string[] = [];
  textureRuns = 0;
  sprites = 0;
  beginTexture(textureId: number): void {
    this.log.push(`begin ${textureId}`);
    this.textureRuns += 1;
  }
  sprite(): void {
    this.log.push('sprite');
    this.sprites += 1;
  }
  endTexture(): void {
    this.log.push('end');
  }
}

describe('SpriteBatch batching', () => {
  it('coalesces a run of one texture into a single begin/end', () => {
    const batch = new SpriteBatch();
    for (let i = 0; i < 100; i += 1) batch.add(7, 0, 0, 16, 16, i, 0, 16, 16);
    const sink = new RecordingSpriteSink();
    const runs = batch.flush(sink);
    expect(runs).toBe(1);
    expect(sink.textureRuns).toBe(1);
    expect(sink.sprites).toBe(100);
  });

  it('starts a new run each time the texture changes', () => {
    const batch = new SpriteBatch();
    batch.add(1, 0, 0, 1, 1, 0, 0, 1, 1);
    batch.add(1, 0, 0, 1, 1, 0, 0, 1, 1);
    batch.add(2, 0, 0, 1, 1, 0, 0, 1, 1);
    batch.add(1, 0, 0, 1, 1, 0, 0, 1, 1);
    const sink = new RecordingSpriteSink();
    const runs = batch.flush(sink);
    // 1,1 | 2 | 1  -> three runs.
    expect(runs).toBe(3);
  });

  it('begin() resets without shrinking capacity and flush of an empty batch is a no-op', () => {
    const batch = new SpriteBatch();
    batch.add(1, 0, 0, 1, 1, 0, 0, 1, 1);
    batch.begin();
    expect(batch.count).toBe(0);
    const sink = new RecordingSpriteSink();
    expect(batch.flush(sink)).toBe(0);
    expect(sink.log).toEqual([]);
  });

  it('stops allocating once warm across repeated identical frames', () => {
    const batch = new SpriteBatch(8);
    const sink = new RecordingSpriteSink();
    // Warm up past the initial capacity.
    for (let frame = 0; frame < 3; frame += 1) {
      batch.begin();
      for (let i = 0; i < 200; i += 1) batch.add(1, 0, 0, 1, 1, i, 0, 1, 1);
      batch.flush(sink);
    }
    const warm = batch.allocations;
    for (let frame = 0; frame < 50; frame += 1) {
      batch.begin();
      for (let i = 0; i < 200; i += 1) batch.add(1, 0, 0, 1, 1, i, 0, 1, 1);
      batch.flush(sink);
    }
    expect(batch.allocations).toBe(warm);
  });
});

describe('Canvas2DSpriteSink', () => {
  it('draws one image per sprite and resolves the texture', () => {
    const calls: string[] = [];
    const ctx: DrawImageContext = {
      globalAlpha: 1,
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      translate: () => calls.push('translate'),
      rotate: () => calls.push('rotate'),
      drawImage: (image) => calls.push(`draw ${String(image)}`),
    };
    const sink = new Canvas2DSpriteSink(ctx, (id) => `tex${id}`);
    const batch = new SpriteBatch();
    batch.add(3, 0, 0, 16, 16, 10, 10, 16, 16); // no rotation, full alpha
    batch.add(3, 0, 0, 16, 16, 30, 10, 16, 16, Math.PI / 2, 0.5); // rotated, translucent
    batch.flush(sink);
    expect(calls.filter((c) => c.startsWith('draw'))).toEqual(['draw tex3', 'draw tex3']);
    // The rotated/translucent one goes through save/rotate/restore.
    expect(calls).toContain('rotate');
    expect(calls).toContain('save');
    expect(calls).toContain('restore');
  });
});

describe('WebGLSpriteSink', () => {
  class FakeGL implements WebGLLike {
    readonly TRIANGLES = 4;
    readonly draws: { count: number }[] = [];
    readonly bound: number[] = [];
    bindTexture(textureId: number): void {
      this.bound.push(textureId);
    }
    bufferData(): void {
      // Vertex data captured implicitly by the draw count.
    }
    drawArrays(_mode: number, _first: number, count: number): void {
      this.draws.push({ count });
    }
  }

  it('issues one draw call per texture run, six vertices per sprite', () => {
    const gl = new FakeGL();
    const sink = new WebGLSpriteSink(gl);
    const batch = new SpriteBatch();
    for (let i = 0; i < 10; i += 1) batch.add(5, 0, 0, 8, 8, i, 0, 8, 8);
    for (let i = 0; i < 4; i += 1) batch.add(6, 0, 0, 8, 8, i, 0, 8, 8);
    const runs = batch.flush(sink);
    expect(runs).toBe(2);
    expect(gl.draws.length).toBe(2);
    expect(gl.draws[0]!.count).toBe(10 * 6); // 10 sprites, 6 verts each
    expect(gl.draws[1]!.count).toBe(4 * 6);
    expect(gl.bound).toEqual([5, 6]);
  });
});

describe('LineBatch batching', () => {
  it('coalesces runs of equal width and colour', () => {
    const log: string[] = [];
    const sink: LineSink = {
      beginStyle: (w, c) => log.push(`begin ${w}/${c}`),
      segment: () => log.push('seg'),
      endStyle: () => log.push('end'),
    };
    const batch = new LineBatch();
    batch.add(0, 0, 1, 1, 2, 100);
    batch.add(1, 1, 2, 2, 2, 100); // same style
    batch.add(2, 2, 3, 3, 2, 200); // colour changes
    const runs = batch.flush(sink);
    expect(runs).toBe(2);
    expect(log.filter((l) => l === 'seg').length).toBe(3);
  });
});
