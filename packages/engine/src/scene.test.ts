import { describe, expect, it } from 'vitest';
import { SceneNode } from './scene.js';
import { vec2 } from './vec2.js';

const HALF_PI = Math.PI / 2;

describe('transform composition', () => {
  it('composes a parent translation with a child translation', () => {
    const root = new SceneNode().setPosition(10, 5);
    const child = new SceneNode().setPosition(3, 2);
    root.addChild(child);
    const out = vec2();
    child.transformPoint(out, 0, 0);
    expect(out.x).toBeCloseTo(13, 9);
    expect(out.y).toBeCloseTo(7, 9);
  });

  it('applies a parent rotation to a child offset', () => {
    const root = new SceneNode().setRotation(HALF_PI);
    const child = new SceneNode().setPosition(1, 0);
    root.addChild(child);
    const out = vec2();
    // A child at local (1,0) under a 90-degree parent rotation lands at world (0,1).
    child.transformPoint(out, 0, 0);
    expect(out.x).toBeCloseTo(0, 9);
    expect(out.y).toBeCloseTo(1, 9);
  });

  it('multiplies scale down the chain', () => {
    const root = new SceneNode().setScale(2, 2);
    const child = new SceneNode().setScale(3, 3);
    root.addChild(child);
    const out = vec2();
    child.transformPoint(out, 1, 1);
    expect(out.x).toBeCloseTo(6, 9);
    expect(out.y).toBeCloseTo(6, 9);
  });

  it('composes a three-deep chain of translations', () => {
    const a = new SceneNode().setPosition(1, 0);
    const b = new SceneNode().setPosition(0, 2);
    const c = new SceneNode().setPosition(4, 4);
    a.addChild(b);
    b.addChild(c);
    const out = vec2();
    c.transformPoint(out, 0, 0);
    expect(out.x).toBeCloseTo(5, 9);
    expect(out.y).toBeCloseTo(6, 9);
  });
});

describe('dirty-flag caching', () => {
  it('recomputes each node once for a read, and not again while nothing changes', () => {
    const root = new SceneNode().setPosition(1, 1);
    const child = new SceneNode().setPosition(1, 0);
    root.addChild(child);

    const out = vec2();
    child.transformPoint(out, 0, 0);
    expect(root.recomputeCount).toBe(1);
    expect(child.recomputeCount).toBe(1);

    // Reading again with nothing changed recomposes nobody.
    child.transformPoint(out, 0, 0);
    root.transformPoint(out, 0, 0);
    expect(root.recomputeCount).toBe(1);
    expect(child.recomputeCount).toBe(1);
  });

  it('propagates a root mutation to descendants but recomposes them only when read', () => {
    const root = new SceneNode();
    const child = new SceneNode();
    const grandchild = new SceneNode();
    root.addChild(child);
    child.addChild(grandchild);

    const out = vec2();
    grandchild.transformPoint(out, 0, 0);
    expect(grandchild.recomputeCount).toBe(1);

    root.setPosition(5, 5);
    expect(grandchild.dirty).toBe(true);
    grandchild.transformPoint(out, 0, 0);
    expect(root.recomputeCount).toBe(2);
    expect(child.recomputeCount).toBe(2);
    expect(grandchild.recomputeCount).toBe(2);
    expect(out.x).toBeCloseTo(5, 9);
    expect(out.y).toBeCloseTo(5, 9);
  });

  it('leaves a clean sibling subtree uncomposed when another subtree mutates', () => {
    const root = new SceneNode();
    const left = new SceneNode().setPosition(1, 0);
    const right = new SceneNode().setPosition(-1, 0);
    const leftLeaf = new SceneNode();
    const rightLeaf = new SceneNode();
    root.addChild(left);
    root.addChild(right);
    left.addChild(leftLeaf);
    right.addChild(rightLeaf);

    const out = vec2();
    leftLeaf.transformPoint(out, 0, 0);
    rightLeaf.transformPoint(out, 0, 0);
    expect(leftLeaf.recomputeCount).toBe(1);
    expect(rightLeaf.recomputeCount).toBe(1);

    // Move only the left branch's node.
    left.setPosition(9, 9);
    leftLeaf.transformPoint(out, 0, 0);
    expect(leftLeaf.recomputeCount).toBe(2);

    // The right branch never became dirty and is not recomposed.
    expect(rightLeaf.dirty).toBe(false);
    rightLeaf.transformPoint(out, 0, 0);
    expect(rightLeaf.recomputeCount).toBe(1);
  });

  it('a child mutation does not dirty or recompose its parent', () => {
    const root = new SceneNode();
    const child = new SceneNode();
    root.addChild(child);
    const out = vec2();
    root.transformPoint(out, 0, 0);
    child.transformPoint(out, 0, 0);
    expect(root.recomputeCount).toBe(1);

    child.setPosition(4, 4);
    expect(root.dirty).toBe(false);
    root.transformPoint(out, 0, 0);
    expect(root.recomputeCount).toBe(1);
  });

  it('reparenting marks the moved node stale and recomposes under its new parent', () => {
    const a = new SceneNode().setPosition(10, 0);
    const b = new SceneNode().setPosition(0, 10);
    const leaf = new SceneNode().setPosition(1, 1);
    a.addChild(leaf);
    const out = vec2();
    leaf.transformPoint(out, 0, 0);
    expect(out.x).toBeCloseTo(11, 9);
    expect(out.y).toBeCloseTo(1, 9);

    b.addChild(leaf);
    expect(leaf.parent).toBe(b);
    leaf.transformPoint(out, 0, 0);
    expect(out.x).toBeCloseTo(1, 9);
    expect(out.y).toBeCloseTo(11, 9);
  });
});

describe('structural guards', () => {
  it('rejects a node becoming its own child', () => {
    const n = new SceneNode();
    expect(() => n.addChild(n)).toThrow();
  });

  it('rejects a cycle', () => {
    const a = new SceneNode();
    const b = new SceneNode();
    a.addChild(b);
    expect(() => b.addChild(a)).toThrow();
  });
});
