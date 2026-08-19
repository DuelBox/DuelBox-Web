import { describe, it, expect } from 'vitest';
import { vec2 } from './vec2.js';
import type { Aabb, Circle, Contact, Obb, Segment } from './collision.js';
import {
  createContact,
  circleCircle,
  circleAabb,
  circleObb,
  circleSegment,
  aabbAabb,
  segmentSegment,
  obbObb,
  closestPointOnSegment,
  pointInAabb,
  pointInCircle,
  sweptCircleSegment,
  sweptCircleCircle,
} from './collision.js';

function expectNormal(out: Contact, x: number, y: number, precision = 12): void {
  expect(out.normalX).toBeCloseTo(x, precision);
  expect(out.normalY).toBeCloseTo(y, precision);
  expect(Math.hypot(out.normalX, out.normalY)).toBeCloseTo(1, 12);
}

function expectPoint(out: Contact, x: number, y: number, precision = 12): void {
  expect(out.pointX).toBeCloseTo(x, precision);
  expect(out.pointY).toBeCloseTo(y, precision);
}

function expectCleared(out: Contact): void {
  expect(out.hit).toBe(false);
  expect(out.depth).toBe(0);
  expect(out.normalX).toBe(0);
  expect(out.normalY).toBe(0);
  expect(out.pointX).toBe(0);
  expect(out.pointY).toBe(0);
}

function circle(x: number, y: number, radius: number): Circle {
  return { x, y, radius };
}

function aabb(minX: number, minY: number, maxX: number, maxY: number): Aabb {
  return { minX, minY, maxX, maxY };
}

function obb(x: number, y: number, halfWidth: number, halfHeight: number, rotation: number): Obb {
  return { x, y, halfWidth, halfHeight, rotation };
}

function segment(x1: number, y1: number, x2: number, y2: number): Segment {
  return { x1, y1, x2, y2 };
}

describe('createContact', () => {
  it('starts cleared and allocates a fresh record each call', () => {
    const a = createContact();
    expectCleared(a);
    expect(createContact()).not.toBe(a);
  });
});

describe('circleCircle', () => {
  const out = createContact();

  it('reports a clear overlap with the depth and the normal out of B', () => {
    expect(circleCircle(out, circle(0, 0, 2), circle(3, 0, 2))).toBe(true);
    expect(out.hit).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, -1, 0);
    // The point on B's boundary nearest A.
    expectPoint(out, 1, 0);
  });

  it('reports clear separation and clears the record', () => {
    expect(circleCircle(out, circle(0, 0, 1), circle(5, 0, 1))).toBe(false);
    expectCleared(out);
  });

  it('counts an exact touch as a hit with depth 0', () => {
    expect(circleCircle(out, circle(0, 0, 1), circle(3, 0, 2))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, -1, 0);
  });

  it('normalises a diagonal normal', () => {
    expect(circleCircle(out, circle(0, 0, 5), circle(3, 4, 5))).toBe(true);
    expect(out.depth).toBeCloseTo(5, 12);
    expectNormal(out, -0.6, -0.8);
    expectPoint(out, 0, 0);
  });

  it('picks (1, 0) for concentric circles instead of dividing by zero', () => {
    expect(circleCircle(out, circle(4, -7, 1), circle(4, -7, 2))).toBe(true);
    expect(out.depth).toBe(3);
    expectNormal(out, 1, 0);
    expectPoint(out, 6, -7);
    // Identical circles are the same degenerate case.
    expect(circleCircle(out, circle(0, 0, 2), circle(0, 0, 2))).toBe(true);
    expect(out.depth).toBe(4);
    expectNormal(out, 1, 0);
  });

  it('moving A along +normal by depth leaves the pair exactly touching', () => {
    const a = circle(0, 0, 2);
    const b = circle(3, 0, 2);
    expect(circleCircle(out, a, b)).toBe(true);
    const moved = circle(a.x + out.normalX * out.depth, a.y + out.normalY * out.depth, a.radius);
    expect(circleCircle(out, moved, b)).toBe(true);
    expect(out.depth).toBeCloseTo(0, 12);
  });

  it('one record serves a run of tests', () => {
    expect(circleCircle(out, circle(0, 0, 2), circle(1, 0, 2))).toBe(true);
    expect(out.hit).toBe(true);
    expect(circleCircle(out, circle(0, 0, 2), circle(9, 0, 2))).toBe(false);
    expectCleared(out);
  });
});

describe('circleAabb', () => {
  const out = createContact();
  const box = aabb(0, 0, 10, 6);

  it('overlaps each edge with the outward normal of that edge', () => {
    expect(circleAabb(out, circle(-1, 3, 2), box)).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, -1, 0);
    expectPoint(out, 0, 3);

    expect(circleAabb(out, circle(11, 3, 2), box)).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, 1, 0);
    expectPoint(out, 10, 3);

    expect(circleAabb(out, circle(5, -1, 2), box)).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, 0, -1);
    expectPoint(out, 5, 0);

    expect(circleAabb(out, circle(5, 7, 2), box)).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, 0, 1);
    expectPoint(out, 5, 6);
  });

  it('counts an exact touch on each edge as a hit with depth 0', () => {
    expect(circleAabb(out, circle(-2, 3, 2), box)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, -1, 0);

    expect(circleAabb(out, circle(12, 3, 2), box)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 1, 0);

    expect(circleAabb(out, circle(5, -2, 2), box)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0, -1);

    expect(circleAabb(out, circle(5, 8, 2), box)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0, 1);
  });

  it('counts an exact touch on each corner as a hit with depth 0', () => {
    // 3-4-5 triangles put the centre exactly one radius from the corner.
    expect(circleAabb(out, circle(-3, -4, 5), box)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, -0.6, -0.8);
    expectPoint(out, 0, 0);

    expect(circleAabb(out, circle(13, -4, 5), box)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0.6, -0.8);
    expectPoint(out, 10, 0);

    expect(circleAabb(out, circle(13, 10, 5), box)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0.6, 0.8);
    expectPoint(out, 10, 6);

    expect(circleAabb(out, circle(-3, 10, 5), box)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, -0.6, 0.8);
    expectPoint(out, 0, 6);
  });

  it('measures depth against a corner along the diagonal', () => {
    expect(circleAabb(out, circle(-3, -4, 6), box)).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, -0.6, -0.8);
    expectPoint(out, 0, 0);
  });

  it('reports clear separation, including diagonally past a corner', () => {
    expect(circleAabb(out, circle(-3, 3, 2), box)).toBe(false);
    expectCleared(out);
    expect(circleAabb(out, circle(-3, -4, 4.9), box)).toBe(false);
    expectCleared(out);
  });

  it('pushes a centre inside the box out through the nearest face', () => {
    expect(circleAabb(out, circle(2, 3, 1), box)).toBe(true);
    expect(out.depth).toBeCloseTo(3, 12);
    expectNormal(out, -1, 0);
    expectPoint(out, 0, 3);

    expect(circleAabb(out, circle(5, 5, 1), box)).toBe(true);
    expect(out.depth).toBeCloseTo(2, 12);
    expectNormal(out, 0, 1);
    expectPoint(out, 5, 6);
  });

  it('treats a centre exactly on an edge as inside, continuing the outside case', () => {
    expect(circleAabb(out, circle(0, 3, 1), box)).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, -1, 0);
    expectPoint(out, 0, 3);
  });

  it('breaks a four-way tie at the centre of a square the same way every time', () => {
    const square = aabb(0, 0, 4, 4);
    expect(circleAabb(out, circle(2, 2, 1), square)).toBe(true);
    expect(out.depth).toBeCloseTo(3, 12);
    expectNormal(out, -1, 0);
    expect(circleAabb(out, circle(2, 2, 1), square)).toBe(true);
    expectNormal(out, -1, 0);
  });

  it('moving the circle along +normal by depth leaves it exactly touching', () => {
    const c = circle(-3, -4, 6);
    expect(circleAabb(out, c, box)).toBe(true);
    const moved = circle(c.x + out.normalX * out.depth, c.y + out.normalY * out.depth, c.radius);
    expect(circleAabb(out, moved, box)).toBe(true);
    expect(out.depth).toBeCloseTo(0, 12);
  });
});

describe('circleObb', () => {
  const out = createContact();
  const other = createContact();

  it('matches circleAabb for an unrotated box', () => {
    expect(circleAabb(out, circle(-1, 3, 2), aabb(0, 0, 10, 6))).toBe(true);
    expect(circleObb(other, circle(-1, 3, 2), obb(5, 3, 5, 3, 0))).toBe(true);
    expect(other.depth).toBeCloseTo(out.depth, 12);
    expect(other.normalX).toBeCloseTo(out.normalX, 12);
    expect(other.normalY).toBeCloseTo(out.normalY, 12);
    expect(other.pointX).toBeCloseTo(out.pointX, 12);
    expect(other.pointY).toBeCloseTo(out.pointY, 12);
  });

  it('only overlaps once the box is rotated', () => {
    const c = circle(0, 5.8, 1);
    expect(circleObb(out, c, obb(0, 0, 5, 0.5, 0))).toBe(false);
    expectCleared(out);

    expect(circleObb(out, c, obb(0, 0, 5, 0.5, Math.PI / 2))).toBe(true);
    expect(out.depth).toBeCloseTo(0.2, 12);
    expectNormal(out, 0, 1);
    expectPoint(out, 0, 5, 10);
  });

  it('reports the normal in world space for a 45 degree box', () => {
    const c = circle(1.06, 0.4, 0.05);
    expect(circleObb(out, c, obb(0, 0, 1, 1, 0))).toBe(false);

    expect(circleObb(out, c, obb(0, 0, 1, 1, Math.PI / 4))).toBe(true);
    // The circle sits just outside the face whose outward normal is 45 degrees.
    expect(out.depth).toBeCloseTo(0.05 - ((1.06 + 0.4) * Math.SQRT1_2 - 1), 12);
    expectNormal(out, Math.SQRT1_2, Math.SQRT1_2);
  });

  it('counts an exact touch as a hit with depth 0, rotated or not', () => {
    expect(circleObb(out, circle(4, 0, 2), obb(0, 0, 2, 1, 0))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 1, 0);
    expectPoint(out, 2, 0);

    expect(circleObb(out, circle(0, 4, 2), obb(0, 0, 2, 1, Math.PI / 2))).toBe(true);
    expect(out.depth).toBeCloseTo(0, 12);
    expectNormal(out, 0, 1);
    expectPoint(out, 0, 2, 10);
  });

  it('pushes a centre inside a rotated box out along a rotated face normal', () => {
    expect(circleObb(out, circle(0, 0, 0.5), obb(0, 0, 3, 1, Math.PI / 2))).toBe(true);
    // Nearest face in the box frame is the left one, which now faces -y.
    expect(out.depth).toBeCloseTo(1.5, 12);
    expectNormal(out, 0, -1);
  });

  it('moving the circle along +normal by depth leaves it exactly touching', () => {
    const box = obb(0, 0, 1, 1, Math.PI / 4);
    const c = circle(1.06, 0.4, 0.05);
    expect(circleObb(out, c, box)).toBe(true);
    const moved = circle(c.x + out.normalX * out.depth, c.y + out.normalY * out.depth, c.radius);
    expect(circleObb(out, moved, box)).toBe(true);
    expect(out.depth).toBeCloseTo(0, 12);
  });
});

describe('circleSegment', () => {
  const out = createContact();
  const seg = segment(0, 0, 10, 0);

  it('reports overlap from either side with the depth', () => {
    expect(circleSegment(out, circle(5, 2, 3), seg)).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, 0, 1);
    expectPoint(out, 5, 0);

    expect(circleSegment(out, circle(5, -2, 3), seg)).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, 0, -1);
  });

  it('counts an exact touch as a hit with depth 0', () => {
    expect(circleSegment(out, circle(5, 3, 3), seg)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0, 1);
  });

  it('reports clear separation', () => {
    expect(circleSegment(out, circle(5, 4, 3), seg)).toBe(false);
    expectCleared(out);
    // Past the end, beyond reach of the endpoint.
    expect(circleSegment(out, circle(16, 0, 5), seg)).toBe(false);
    expectCleared(out);
  });

  it('measures against an endpoint once past the end', () => {
    expect(circleSegment(out, circle(13, 4, 5), seg)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0.6, 0.8);
    expectPoint(out, 10, 0);
  });

  it('falls back to the left perpendicular when the centre lies on the segment', () => {
    expect(circleSegment(out, circle(5, 0, 2), seg)).toBe(true);
    expect(out.depth).toBe(2);
    expectNormal(out, 0, 1);
    expectPoint(out, 5, 0);

    // Same choice on an endpoint, so a body sliding along cannot flip sides.
    expect(circleSegment(out, circle(0, 0, 2), seg)).toBe(true);
    expect(out.depth).toBe(2);
    expectNormal(out, 0, 1);
  });

  it('handles a zero-length segment as a point', () => {
    const point = segment(3, 3, 3, 3);
    expect(circleSegment(out, circle(3, 4, 1), point)).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0, 1);
    expectPoint(out, 3, 3);

    expect(circleSegment(out, circle(3, 3, 1), point)).toBe(true);
    expect(out.depth).toBe(1);
    expectNormal(out, 1, 0);

    expect(circleSegment(out, circle(3, 5, 1), point)).toBe(false);
  });

  it('normalises a diagonal normal', () => {
    expect(circleSegment(out, circle(5, 0, 4), segment(0, 0, 10, 10))).toBe(true);
    expect(out.depth).toBeCloseTo(4 - Math.hypot(2.5, 2.5), 12);
    expectNormal(out, Math.SQRT1_2, -Math.SQRT1_2);
    expectPoint(out, 2.5, 2.5);
  });
});

describe('aabbAabb', () => {
  const out = createContact();
  const a = aabb(0, 0, 4, 4);

  it('resolves a clear overlap on the shallower axis', () => {
    expect(aabbAabb(out, a, aabb(3, 1, 9, 5))).toBe(true);
    expect(out.depth).toBeCloseTo(1, 12);
    expectNormal(out, -1, 0);
    // Centre of the overlap rectangle.
    expectPoint(out, 3.5, 2.5);

    expect(aabbAabb(out, aabb(0, 0, 10, 2), aabb(0, 1.5, 10, 5))).toBe(true);
    expect(out.depth).toBeCloseTo(0.5, 12);
    expectNormal(out, 0, -1);
  });

  it('reports clear separation on either axis', () => {
    expect(aabbAabb(out, a, aabb(4.5, 0, 8, 4))).toBe(false);
    expectCleared(out);
    expect(aabbAabb(out, a, aabb(0, -9, 4, -5))).toBe(false);
    expectCleared(out);
  });

  it('counts an exact edge touch as a hit with depth 0', () => {
    expect(aabbAabb(out, a, aabb(4, 0, 8, 4))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, -1, 0);
    expectPoint(out, 4, 2);

    expect(aabbAabb(out, a, aabb(-4, 0, 0, 4))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 1, 0);
  });

  it('counts an exact corner touch as a hit, breaking the tie towards x', () => {
    expect(aabbAabb(out, a, aabb(4, 4, 8, 8))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, -1, 0);
    expectPoint(out, 4, 4);
  });

  it('pushes A along +x when the centres coincide', () => {
    expect(aabbAabb(out, aabb(0, 0, 10, 10), aabb(4, 4, 6, 6))).toBe(true);
    expect(out.depth).toBe(2);
    expectNormal(out, 1, 0);
    expectPoint(out, 5, 5);
  });

  it('moving A along +normal by depth leaves the boxes exactly touching', () => {
    const b = aabb(3, 1, 9, 5);
    expect(aabbAabb(out, a, b)).toBe(true);
    const moved = aabb(
      a.minX + out.normalX * out.depth,
      a.minY + out.normalY * out.depth,
      a.maxX + out.normalX * out.depth,
      a.maxY + out.normalY * out.depth,
    );
    expect(aabbAabb(out, moved, b)).toBe(true);
    expect(out.depth).toBeCloseTo(0, 12);
  });
});

describe('obbObb', () => {
  const out = createContact();

  it('resolves an axis-aligned overlap on the shallower axis', () => {
    expect(obbObb(out, obb(0, 0, 1, 1, 0), obb(1.5, 0, 1, 1, 0))).toBe(true);
    expect(out.depth).toBeCloseTo(0.5, 12);
    expectNormal(out, -1, 0);
    expectPoint(out, 0.75, 0);
  });

  it('reports clear separation', () => {
    expect(obbObb(out, obb(0, 0, 1, 1, 0), obb(2.5, 0, 1, 1, 0))).toBe(false);
    expectCleared(out);
    expect(obbObb(out, obb(0, 0, 1, 1, 0), obb(0, 3, 1, 1, 0))).toBe(false);
    expectCleared(out);
  });

  it('counts an exact touch as a hit with depth 0', () => {
    expect(obbObb(out, obb(0, 0, 1, 1, 0), obb(2, 0, 1, 1, 0))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, -1, 0);

    expect(obbObb(out, obb(0, 0, 1, 1, 0), obb(0, -2, 1, 1, 0))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0, 1);
  });

  it('separates on B own axis when that is the shallow one', () => {
    // A long thin box lying across a square: the square's own faces cut deeper
    // than the thin box's, so the contact normal comes from A.
    expect(obbObb(out, obb(0, 0, 4, 0.25, 0), obb(0, 1, 1, 1, 0))).toBe(true);
    expect(out.depth).toBeCloseTo(0.25, 12);
    expectNormal(out, 0, -1);
  });

  it('only overlaps once B is rotated', () => {
    const a = obb(0, 0, 1, 1, 0);
    expect(obbObb(out, a, obb(2.2, 0, 1, 1, 0))).toBe(false);
    expectCleared(out);

    expect(obbObb(out, a, obb(2.2, 0, 1, 1, Math.PI / 4))).toBe(true);
    expect(out.depth).toBeCloseTo(1 + Math.SQRT2 - 2.2, 12);
    expectNormal(out, -1, 0);
  });

  it('a rotated box touching corner to face is still a hit with depth 0', () => {
    // The diamond's left vertex reaches exactly A's right face.
    expect(obbObb(out, obb(0, 0, 1, 1, 0), obb(1 + Math.SQRT2, 0, 1, 1, Math.PI / 4))).toBe(true);
    expect(out.depth).toBeCloseTo(0, 12);
    expectNormal(out, -1, 0);
  });

  it('is unchanged by rotating both boxes together', () => {
    const spun = createContact();
    expect(obbObb(out, obb(0, 0, 1, 1, 0), obb(1.5, 0, 1, 1, 0))).toBe(true);
    const t = 0.7;
    const c = Math.cos(t);
    const s = Math.sin(t);
    expect(obbObb(spun, obb(0, 0, 1, 1, t), obb(1.5 * c, 1.5 * s, 1, 1, t))).toBe(true);
    expect(spun.depth).toBeCloseTo(out.depth, 12);
    // The normal rides along with the pair.
    expect(spun.normalX).toBeCloseTo(out.normalX * c - out.normalY * s, 12);
    expect(spun.normalY).toBeCloseTo(out.normalX * s + out.normalY * c, 12);
  });

  it('moving A along +normal by depth leaves the boxes exactly touching', () => {
    const b = obb(2.2, 0, 1, 1, Math.PI / 4);
    expect(obbObb(out, obb(0, 0, 1, 1, 0), b)).toBe(true);
    const moved = obb(out.normalX * out.depth, out.normalY * out.depth, 1, 1, 0);
    expect(obbObb(out, moved, b)).toBe(true);
    expect(out.depth).toBeCloseTo(0, 12);
  });
});

describe('segmentSegment', () => {
  const out = createContact();
  const wall = segment(0, 0, 10, 0);

  it('finds a clean crossing and the perpendicular of B facing A', () => {
    expect(segmentSegment(out, wall, segment(5, -5, 5, 5))).toBe(true);
    expect(out.depth).toBe(0);
    expectPoint(out, 5, 0);
    expectNormal(out, -1, 0);
  });

  it('flips the normal when A approaches B from the other side', () => {
    expect(segmentSegment(out, segment(10, 0, 0, 0), segment(5, -5, 5, 5))).toBe(true);
    expectNormal(out, 1, 0);
  });

  it('reports no hit when the lines cross outside either segment', () => {
    expect(segmentSegment(out, segment(0, 0, 1, 0), segment(5, -5, 5, 5))).toBe(false);
    expectCleared(out);
    expect(segmentSegment(out, wall, segment(5, 1, 5, 5))).toBe(false);
    expectCleared(out);
  });

  it('reports no hit for parallel segments that never meet', () => {
    expect(segmentSegment(out, wall, segment(0, 1, 10, 1))).toBe(false);
    expectCleared(out);
  });

  it('treats a collinear overlap as a hit at the middle of the shared stretch', () => {
    expect(segmentSegment(out, wall, segment(5, 0, 15, 0))).toBe(true);
    expect(out.depth).toBe(0);
    expectPoint(out, 7.5, 0);
    // No side exists for a collinear pair, so the left perpendicular stands.
    expectNormal(out, 0, 1);

    // Direction of the second segment does not change the answer.
    expect(segmentSegment(out, wall, segment(15, 0, 5, 0))).toBe(true);
    expectPoint(out, 7.5, 0);

    // Fully contained.
    expect(segmentSegment(out, wall, segment(2, 0, 4, 0))).toBe(true);
    expectPoint(out, 3, 0);
  });

  it('reports no hit for collinear segments that do not reach each other', () => {
    expect(segmentSegment(out, wall, segment(11, 0, 20, 0))).toBe(false);
    expectCleared(out);
  });

  it('counts a shared endpoint as a hit', () => {
    expect(segmentSegment(out, wall, segment(10, 0, 10, 10))).toBe(true);
    expect(out.depth).toBe(0);
    expectPoint(out, 10, 0);

    // Collinear, meeting at exactly one point.
    expect(segmentSegment(out, wall, segment(10, 0, 20, 0))).toBe(true);
    expectPoint(out, 10, 0);
  });

  it('counts a T junction as a hit', () => {
    expect(segmentSegment(out, wall, segment(5, 0, 5, 5))).toBe(true);
    expectPoint(out, 5, 0);
  });

  it('handles zero-length segments as points', () => {
    expect(segmentSegment(out, segment(5, 0, 5, 0), wall)).toBe(true);
    expectPoint(out, 5, 0);
    expectNormal(out, 0, 1);

    expect(segmentSegment(out, segment(5, 1, 5, 1), wall)).toBe(false);
    expectCleared(out);

    expect(segmentSegment(out, wall, segment(5, 0, 5, 0))).toBe(true);
    expectPoint(out, 5, 0);
    expectNormal(out, 0, 1);

    expect(segmentSegment(out, segment(2, 2, 2, 2), segment(2, 2, 2, 2))).toBe(true);
    expectPoint(out, 2, 2);
    expectNormal(out, 1, 0);

    expect(segmentSegment(out, segment(2, 2, 2, 2), segment(3, 3, 3, 3))).toBe(false);
    expectCleared(out);
  });
});

describe('closestPointOnSegment', () => {
  it('clamps to the segment and returns out', () => {
    const out = vec2();
    const seg = segment(0, 0, 10, 0);
    expect(closestPointOnSegment(out, 4, 5, seg)).toBe(out);
    expect(out.x).toBe(4);
    expect(out.y).toBe(0);
    closestPointOnSegment(out, -7, 2, seg);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
    closestPointOnSegment(out, 99, -2, seg);
    expect(out.x).toBe(10);
    expect(out.y).toBe(0);
  });

  it('projects onto a diagonal segment', () => {
    const out = vec2();
    closestPointOnSegment(out, 5, 0, segment(0, 0, 10, 10));
    expect(out.x).toBeCloseTo(2.5, 12);
    expect(out.y).toBeCloseTo(2.5, 12);
  });

  it('returns the single point of a zero-length segment', () => {
    const out = vec2();
    closestPointOnSegment(out, 5, 5, segment(3, -1, 3, -1));
    expect(out.x).toBe(3);
    expect(out.y).toBe(-1);
  });
});

describe('point tests', () => {
  it('pointInAabb includes the boundary', () => {
    const box = aabb(0, 0, 10, 6);
    expect(pointInAabb(5, 3, box)).toBe(true);
    expect(pointInAabb(0, 0, box)).toBe(true);
    expect(pointInAabb(10, 6, box)).toBe(true);
    expect(pointInAabb(10.0001, 6, box)).toBe(false);
    expect(pointInAabb(5, -0.0001, box)).toBe(false);
  });

  it('pointInCircle includes the circumference', () => {
    const c = circle(1, 2, 5);
    expect(pointInCircle(1, 2, c)).toBe(true);
    expect(pointInCircle(4, 6, c)).toBe(true);
    expect(pointInCircle(4, 6.0001, c)).toBe(false);
    expect(pointInCircle(-4, 2, c)).toBe(true);
    expect(pointInCircle(1, 2, circle(1, 2, 0))).toBe(true);
  });
});

describe('sweptCircleCircle', () => {
  const out = createContact();

  it('reports the time of impact in depth', () => {
    expect(sweptCircleCircle(out, circle(0, 0, 1), 20, 0, circle(10, 0, 1))).toBe(true);
    expect(out.hit).toBe(true);
    expect(out.depth).toBeCloseTo(0.4, 12);
    expectNormal(out, -1, 0);
    expectPoint(out, 9, 0);
  });

  it('returns false when the motion stops short', () => {
    expect(sweptCircleCircle(out, circle(0, 0, 1), 5, 0, circle(10, 0, 1))).toBe(false);
    expectCleared(out);
  });

  it('returns false when the circles move apart or do not move', () => {
    expect(sweptCircleCircle(out, circle(0, 0, 1), -20, 0, circle(10, 0, 1))).toBe(false);
    expect(sweptCircleCircle(out, circle(0, 0, 1), 0, 0, circle(10, 0, 1))).toBe(false);
    expectCleared(out);
  });

  it('reports impact time 0 for a pair already touching', () => {
    expect(sweptCircleCircle(out, circle(0, 0, 1), 50, 0, circle(2, 0, 1))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, -1, 0);
  });

  it('catches an exactly grazing pass and misses a hair wider one', () => {
    expect(sweptCircleCircle(out, circle(0, 0, 1), 10, 0, circle(5, 2, 1))).toBe(true);
    expect(out.depth).toBeCloseTo(0.5, 12);
    expectNormal(out, 0, -1);

    expect(sweptCircleCircle(out, circle(0, 0, 1), 10, 0, circle(5, 2.001, 1))).toBe(false);
  });

  it('places the circles exactly one radius sum apart at the reported time', () => {
    const a = circle(-3, -7, 1.5);
    const b = circle(9, 4, 2.5);
    const dx = 30;
    const dy = 28;
    expect(sweptCircleCircle(out, a, dx, dy, b)).toBe(true);
    const hx = a.x + dx * out.depth;
    const hy = a.y + dy * out.depth;
    expect(Math.hypot(hx - b.x, hy - b.y)).toBeCloseTo(a.radius + b.radius, 9);
    expectNormal(out, (hx - b.x) / 4, (hy - b.y) / 4, 9);
  });
});

describe('sweptCircleSegment', () => {
  const out = createContact();

  it('reports the time of impact against the flat side', () => {
    expect(sweptCircleSegment(out, circle(0, 0, 1), 10, 0, segment(5, -10, 5, 10))).toBe(true);
    expect(out.depth).toBeCloseTo(0.4, 12);
    expectNormal(out, -1, 0);
    expectPoint(out, 5, 0);
  });

  it('returns false when the motion stops short of the wall', () => {
    expect(sweptCircleSegment(out, circle(0, 0, 1), 3, 0, segment(5, -10, 5, 10))).toBe(false);
    expectCleared(out);
  });

  it('reports impact time 0 for a circle already resting on the wall', () => {
    expect(sweptCircleSegment(out, circle(5, 1, 1), 0, -50, segment(0, 0, 10, 0))).toBe(true);
    expect(out.depth).toBe(0);
    expectNormal(out, 0, 1);
    expectPoint(out, 5, 0);
  });

  it('rounds an end cap when the flat side is never crossed', () => {
    const wall = segment(0, 0, 10, 0);
    expect(sweptCircleSegment(out, circle(15, 0.5, 1), -10, 0, wall)).toBe(true);
    // Level with the wall but past its end: only the endpoint can be hit.
    expect(out.depth).toBeCloseTo(0.4133974596215561, 9);
    expectPoint(out, 10, 0);
    expectNormal(out, Math.sqrt(3) / 2, 0.5, 9);
    const hx = 15 - 10 * out.depth;
    expect(Math.hypot(hx - 10, 0.5)).toBeCloseTo(1, 9);
  });

  it('returns false when sliding parallel to the wall without reaching it', () => {
    expect(sweptCircleSegment(out, circle(5, 3, 1), 5, 0, segment(0, 0, 10, 0))).toBe(false);
    expectCleared(out);
  });

  it('returns false when it crosses the line beyond the end of the segment', () => {
    expect(sweptCircleSegment(out, circle(20, -5, 1), 0, 10, segment(0, 0, 10, 0))).toBe(false);
    expectCleared(out);
  });

  it('handles a zero-length segment as a point', () => {
    expect(sweptCircleSegment(out, circle(0, 0, 1), 10, 0, segment(5, 0, 5, 0))).toBe(true);
    expect(out.depth).toBeCloseTo(0.4, 12);
    expectNormal(out, -1, 0);
    expectPoint(out, 5, 0);
  });

  it('picks the earliest of the flat side and the two caps', () => {
    // Aimed at the far end of a short wall: the cap is reached first.
    const wall = segment(0, 0, 4, 0);
    expect(sweptCircleSegment(out, circle(6, 6, 1), -3, -8, wall)).toBe(true);
    const hx = 6 - 3 * out.depth;
    const hy = 6 - 8 * out.depth;
    // Whatever feature was hit, the circle is exactly one radius from the wall.
    const t = Math.max(0, Math.min(1, hx / 4));
    expect(Math.hypot(hx - t * 4, hy)).toBeCloseTo(1, 9);
  });
});

describe('tunnelling regression', () => {
  // 5000 logical units per second at 60 Hz moves 83.3 units in one step, so a
  // 2-unit-thick wall sits entirely between the sampled positions.
  const speed = 5000;
  const dt = 1 / 60;
  const dx = speed * dt;
  const wall = segment(101, -50, 101, 50);
  const wallBox = aabb(100, -50, 102, 50);
  const start = circle(50, 0, 0.5);
  const end = circle(start.x + dx, 0, 0.5);

  it('the static tests see nothing at either end of the step', () => {
    const out = createContact();
    expect(end.x).toBeGreaterThan(102);
    expect(circleSegment(out, start, wall)).toBe(false);
    expect(circleSegment(out, end, wall)).toBe(false);
    expect(circleAabb(out, start, wallBox)).toBe(false);
    expect(circleAabb(out, end, wallBox)).toBe(false);
  });

  it('the swept test catches it inside the step', () => {
    const out = createContact();
    expect(sweptCircleSegment(out, start, dx, 0, wall)).toBe(true);
    expect(out.depth).toBeGreaterThan(0);
    expect(out.depth).toBeLessThan(1);
    expect(out.depth).toBeCloseTo((101 - 0.5 - 50) / dx, 12);
    expectNormal(out, -1, 0);
    expectPoint(out, 101, 0);
    // Stopping at the reported time leaves the circle touching the wall, not through it.
    expect(start.x + dx * out.depth).toBeCloseTo(100.5, 9);
  });

  it('holds for the return journey and for a slower body that never arrives', () => {
    const out = createContact();
    expect(sweptCircleSegment(out, circle(150, 0, 0.5), -dx, 0, wall)).toBe(true);
    expectNormal(out, 1, 0);
    expect(sweptCircleSegment(out, start, 10, 0, wall)).toBe(false);
    expectCleared(out);
  });
});
