import type { Vec2 } from './vec2.js';
import { set } from './vec2.js';

/**
 * 2D collision primitives in logical simulation units (never pixels).
 *
 * Every test writes into a caller-owned {@link Contact} and returns `out.hit`,
 * so a step can run thousands of tests without allocating. `createContact()` is
 * the only function here that allocates.
 *
 * Conventions shared by every test in this module:
 *
 * - The normal points from A out of B: moving A along +normal by `depth`
 *   separates the pair. On a hit it is always unit length.
 * - `depth` is the penetration distance and is never negative.
 * - Two shapes that touch exactly count as a hit, with depth 0. A resting body
 *   sits exactly at contact, so treating touching as separation would make it
 *   alternate between colliding and free from step to step and visibly jitter;
 *   a depth-0 contact resolves to a zero correction and leaves it still.
 * - `pointX`/`pointY` is the contact point: the point on B's boundary nearest A
 *   for the circle tests, the centre of the intersection rectangle for
 *   `aabbAabb`, and a representative point on the mid-plane of the overlap for
 *   the oriented-box tests, which have no intersection rectangle to centre.
 * - A miss zeroes the whole record, so a stale contact from an earlier test can
 *   never be read back as a live one.
 *
 * Shapes are read, never written, so a frozen or `Readonly<...>` shape is fine
 * to pass. Contacts hold loose scalars rather than {@link Vec2} pairs, which is
 * why the maths below is component-wise; `closestPointOnSegment` speaks Vec2 and
 * uses the vec2 helpers.
 */

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A box centred on (x, y), rotated counter-clockwise by `rotation` radians. */
export interface Obb {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  rotation: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * One collision result. The caller owns it and reuses it: a solver typically
 * keeps a single Contact for a whole step.
 */
export interface Contact {
  hit: boolean;
  depth: number;
  normalX: number;
  normalY: number;
  pointX: number;
  pointY: number;
}

/** The only allocating helper. Setup code only, never per step or per frame. */
export function createContact(): Contact {
  return { hit: false, depth: 0, normalX: 0, normalY: 0, pointX: 0, pointY: 0 };
}

/** Clears the record and reports no hit, so nothing stale survives a miss. */
function miss(out: Contact): boolean {
  out.hit = false;
  out.depth = 0;
  out.normalX = 0;
  out.normalY = 0;
  out.pointX = 0;
  out.pointY = 0;
  return false;
}

/**
 * Clamped parameter in [0, 1] of the point on `(x1, y1) + (sx, sy) * t` closest
 * to `(px, py)`. A zero-length segment yields 0, i.e. its single point.
 */
function segmentParam(
  px: number,
  py: number,
  x1: number,
  y1: number,
  sx: number,
  sy: number,
): number {
  const lenSq = sx * sx + sy * sy;
  if (lenSq === 0) return 0;
  const t = ((px - x1) * sx + (py - y1) * sy) / lenSq;
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

/**
 * Point on the segment closest to `(px, py)`, written into `out`. A zero-length
 * segment returns its own single point rather than dividing by zero.
 */
export function closestPointOnSegment(out: Vec2, px: number, py: number, seg: Segment): Vec2 {
  const sx = seg.x2 - seg.x1;
  const sy = seg.y2 - seg.y1;
  const t = segmentParam(px, py, seg.x1, seg.y1, sx, sy);
  return set(out, seg.x1 + sx * t, seg.y1 + sy * t);
}

/** Bounds are inclusive: a point exactly on an edge is inside, matching the touching rule. */
export function pointInAabb(px: number, py: number, box: Aabb): boolean {
  return px >= box.minX && px <= box.maxX && py >= box.minY && py <= box.maxY;
}

/** The circumference is inside, matching the touching rule. */
export function pointInCircle(px: number, py: number, c: Circle): boolean {
  const dx = px - c.x;
  const dy = py - c.y;
  return dx * dx + dy * dy <= c.radius * c.radius;
}

export function circleCircle(out: Contact, a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.radius + b.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq > r * r) return miss(out);

  const dist = Math.sqrt(distSq);
  let nx: number;
  let ny: number;
  if (dist === 0) {
    // Concentric circles: every direction separates them equally well, so there
    // is no normal to compute. Pick the fixed (1, 0) rather than dividing by
    // zero, and pick the same one every step so the pair cannot oscillate.
    nx = 1;
    ny = 0;
  } else {
    const inv = 1 / dist;
    nx = dx * inv;
    ny = dy * inv;
  }

  const depth = r - dist;
  out.hit = true;
  // Rounding in sqrt can put an exactly touching pair a fraction below zero.
  out.depth = depth > 0 ? depth : 0;
  out.normalX = nx;
  out.normalY = ny;
  out.pointX = b.x + nx * b.radius;
  out.pointY = b.y + ny * b.radius;
  return true;
}

/**
 * Circle against an axis-aligned box in min/max form, in whatever frame the
 * caller is working in; `out` comes back in that same frame. Shared by
 * `circleAabb` (world frame) and `circleObb` (the box's own frame).
 */
function circleBox(
  out: Contact,
  cx: number,
  cy: number,
  radius: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const qx = cx < minX ? minX : cx > maxX ? maxX : cx;
  const qy = cy < minY ? minY : cy > maxY ? maxY : cy;
  const dx = cx - qx;
  const dy = cy - qy;
  const distSq = dx * dx + dy * dy;
  if (distSq > radius * radius) return miss(out);

  if (distSq > 0) {
    const dist = Math.sqrt(distSq);
    const inv = 1 / dist;
    const depth = radius - dist;
    out.hit = true;
    out.depth = depth > 0 ? depth : 0;
    out.normalX = dx * inv;
    out.normalY = dy * inv;
    out.pointX = qx;
    out.pointY = qy;
    return true;
  }

  // The centre is inside the box, or exactly on its boundary, so the difference
  // vector carries no direction. Push out through the nearest face instead.
  // Faces are tried left, right, bottom, top and ties keep the earlier one, so
  // a centre at the exact middle of a square still gives one stable answer.
  let best = cx - minX;
  let nx = -1;
  let ny = 0;
  let d = maxX - cx;
  if (d < best) {
    best = d;
    nx = 1;
    ny = 0;
  }
  d = cy - minY;
  if (d < best) {
    best = d;
    nx = 0;
    ny = -1;
  }
  d = maxY - cy;
  if (d < best) {
    best = d;
    nx = 0;
    ny = 1;
  }

  // Travel to that face, then clear it by the radius.
  const depth = radius + best;
  out.hit = true;
  out.depth = depth > 0 ? depth : 0;
  out.normalX = nx;
  out.normalY = ny;
  out.pointX = nx === 0 ? cx : nx < 0 ? minX : maxX;
  out.pointY = ny === 0 ? cy : ny < 0 ? minY : maxY;
  return true;
}

export function circleAabb(out: Contact, c: Circle, box: Aabb): boolean {
  return circleBox(out, c.x, c.y, c.radius, box.minX, box.minY, box.maxX, box.maxY);
}

export function circleObb(out: Contact, c: Circle, box: Obb): boolean {
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  const rx = c.x - box.x;
  const ry = c.y - box.y;
  // Into the box's own frame, i.e. rotate by -rotation about the box centre.
  const lx = rx * cos + ry * sin;
  const ly = -rx * sin + ry * cos;
  const hw = box.halfWidth;
  const hh = box.halfHeight;
  if (!circleBox(out, lx, ly, c.radius, -hw, -hh, hw, hh)) return false;

  const nx = out.normalX;
  const ny = out.normalY;
  out.normalX = nx * cos - ny * sin;
  out.normalY = nx * sin + ny * cos;
  const px = out.pointX;
  const py = out.pointY;
  out.pointX = box.x + px * cos - py * sin;
  out.pointY = box.y + px * sin + py * cos;
  return true;
}

export function circleSegment(out: Contact, c: Circle, seg: Segment): boolean {
  const sx = seg.x2 - seg.x1;
  const sy = seg.y2 - seg.y1;
  const t = segmentParam(c.x, c.y, seg.x1, seg.y1, sx, sy);
  const qx = seg.x1 + sx * t;
  const qy = seg.y1 + sy * t;
  const dx = c.x - qx;
  const dy = c.y - qy;
  const r = c.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq > r * r) return miss(out);

  let nx: number;
  let ny: number;
  let depth: number;
  if (distSq > 0) {
    const dist = Math.sqrt(distSq);
    const inv = 1 / dist;
    nx = dx * inv;
    ny = dy * inv;
    depth = r - dist;
  } else {
    // The centre lies exactly on the segment, which has no thickness and so no
    // near side: the direction is genuinely ambiguous. Use the segment's left
    // perpendicular, always the same one, so a body on the line cannot flip
    // sides from step to step. Separating means moving a full radius clear.
    const lenSq = sx * sx + sy * sy;
    if (lenSq > 0) {
      const inv = 1 / Math.sqrt(lenSq);
      nx = -sy * inv;
      ny = sx * inv;
    } else {
      // A zero-length segment has no perpendicular at all; match the concentric
      // circle case and pick (1, 0).
      nx = 1;
      ny = 0;
    }
    depth = r;
  }

  out.hit = true;
  out.depth = depth > 0 ? depth : 0;
  out.normalX = nx;
  out.normalY = ny;
  out.pointX = qx;
  out.pointY = qy;
  return true;
}

export function aabbAabb(out: Contact, a: Aabb, b: Aabb): boolean {
  // Distance A must travel each way to clear B. Whichever is smaller is the
  // penetration on that axis; it is not the width of the intersection, which is
  // shorter than the escape whenever one box contains the other. At most one of
  // the pair can be negative, and a negative one means the boxes are apart.
  const leftX = a.maxX - b.minX;
  const rightX = b.maxX - a.minX;
  const negX = leftX < rightX;
  const overlapX = negX ? leftX : rightX;
  if (overlapX < 0) return miss(out);
  const leftY = a.maxY - b.minY;
  const rightY = b.maxY - a.minY;
  const negY = leftY < rightY;
  const overlapY = negY ? leftY : rightY;
  if (overlapY < 0) return miss(out);

  out.hit = true;
  // Centre of the intersection rectangle.
  out.pointX = ((a.minX > b.minX ? a.minX : b.minX) + (a.maxX < b.maxX ? a.maxX : b.maxX)) / 2;
  out.pointY = ((a.minY > b.minY ? a.minY : b.minY) + (a.maxY < b.maxY ? a.maxY : b.maxY)) / 2;
  // Least-penetration axis wins; a tie takes x, so a corner touch resolves the
  // same way every step. Equal escapes mean the centres agree on that axis, and
  // A then goes +axis, matching the concentric-circle choice.
  if (overlapX <= overlapY) {
    out.depth = overlapX;
    out.normalX = negX ? -1 : 1;
    out.normalY = 0;
  } else {
    out.depth = overlapY;
    out.normalX = 0;
    out.normalY = negY ? -1 : 1;
  }
  return true;
}

/**
 * Separating-axis theorem over the four box axes, in whatever frame the caller
 * is working in; `out` comes back in that same frame. Each box arrives as a
 * centre, half extents, and the cosine and sine of its rotation, so an
 * axis-aligned box passes (1, 0) and pays no trigonometry at all. Shared by
 * `obbObb` and `aabbObb`, exactly as `circleBox` is shared by `circleAabb` and
 * `circleObb`.
 *
 * Two rectangles overlap exactly when none of their four face normals separates
 * them, so four projections settle it and the shallowest overlap is the contact
 * normal.
 *
 * Each box projects onto its own axes as exactly its half extents, so only the
 * cross terms need computing, and those reduce to |cos| and |sin| of the angle
 * between the boxes. That is one trig pair instead of four dot products, and it
 * keeps an axis-aligned pair exact: rounding in `cos^2 + sin^2` must never turn
 * an exact touch into a miss.
 */
function boxBox(
  out: Contact,
  ax: number,
  ay: number,
  ahw: number,
  ahh: number,
  ca: number,
  sa: number,
  bx: number,
  by: number,
  bhw: number,
  bhh: number,
  cb: number,
  sb: number,
): boolean {
  const cr = Math.abs(ca * cb + sa * sb);
  const sr = Math.abs(sa * cb - ca * sb);

  const dx = ax - bx;
  const dy = ay - by;

  // A's x axis.
  const p0 = dx * ca + dy * sa;
  const o0 = ahw + (bhw * cr + bhh * sr) - Math.abs(p0);
  if (o0 < 0) return miss(out);
  // A's y axis.
  const p1 = -dx * sa + dy * ca;
  const o1 = ahh + (bhw * sr + bhh * cr) - Math.abs(p1);
  if (o1 < 0) return miss(out);
  // B's x axis.
  const r2 = ahw * cr + ahh * sr;
  const p2 = dx * cb + dy * sb;
  const o2 = bhw + r2 - Math.abs(p2);
  if (o2 < 0) return miss(out);
  // B's y axis.
  const r3 = ahw * sr + ahh * cr;
  const p3 = -dx * sb + dy * cb;
  const o3 = bhh + r3 - Math.abs(p3);
  if (o3 < 0) return miss(out);

  // Shallowest axis wins; ties keep the earlier one, so A's own axes are
  // preferred over B's and the choice never depends on iteration order.
  let depth = o0;
  let proj = p0;
  let radiusA = ahw;
  let nx = ca;
  let ny = sa;
  if (o1 < depth) {
    depth = o1;
    proj = p1;
    radiusA = ahh;
    nx = -sa;
    ny = ca;
  }
  if (o2 < depth) {
    depth = o2;
    proj = p2;
    radiusA = r2;
    nx = cb;
    ny = sb;
  }
  if (o3 < depth) {
    depth = o3;
    proj = p3;
    radiusA = r3;
    nx = -sb;
    ny = cb;
  }
  // Point the axis from B towards A. A zero projection means the centres agree
  // on this axis; the axis then stands as it is, which is arbitrary but stable.
  if (proj < 0) {
    nx = -nx;
    ny = -ny;
  }

  out.hit = true;
  out.depth = depth;
  out.normalX = nx;
  out.normalY = ny;
  // Contact point on the mid-plane of the overlap slab, taken along the normal
  // from A's centre. This is a representative point, not a clipped manifold:
  // face-face contact really has two corners, and a single point cannot say so.
  const k = depth / 2 - radiusA;
  out.pointX = ax + nx * k;
  out.pointY = ay + ny * k;
  return true;
}

/** Box against box, both oriented. See {@link boxBox} for how the axes are chosen. */
export function obbObb(out: Contact, a: Obb, b: Obb): boolean {
  return boxBox(
    out,
    a.x,
    a.y,
    a.halfWidth,
    a.halfHeight,
    Math.cos(a.rotation),
    Math.sin(a.rotation),
    b.x,
    b.y,
    b.halfWidth,
    b.halfHeight,
    Math.cos(b.rotation),
    Math.sin(b.rotation),
  );
}

/**
 * Axis-aligned box against oriented box. An AABB is an OBB at zero rotation, so
 * this is `obbObb` with (cos, sin) = (1, 0) for A and no trigonometry spent on
 * it, the same delegation `circleAabb` makes into `circleBox`.
 *
 * The contact point follows `obbObb`'s convention — a representative point on
 * the mid-plane of the overlap slab — and so is not the centre of the
 * intersection rectangle that `aabbAabb` reports. Two boxes at a general angle
 * do not intersect in a rectangle, so there is no centre of one to report.
 *
 * Working in centres and half extents also means the min/max form is halved and
 * differenced first: unlike `aabbAabb`, a touch that is exact in min/max
 * arithmetic can round to a hair either side of zero here.
 */
export function aabbObb(out: Contact, a: Aabb, b: Obb): boolean {
  return boxBox(
    out,
    (a.minX + a.maxX) / 2,
    (a.minY + a.maxY) / 2,
    (a.maxX - a.minX) / 2,
    (a.maxY - a.minY) / 2,
    1,
    0,
    b.x,
    b.y,
    b.halfWidth,
    b.halfHeight,
    Math.cos(b.rotation),
    Math.sin(b.rotation),
  );
}

/**
 * Exact test that `(px, py)` lies on the segment from `(x1, y1)` along
 * `(sx, sy)`, where `ss` is that direction's squared length. Collinearity is
 * tested exactly: no tolerance is right at every scale, and a fuzzy one would
 * make a near miss and a real touch indistinguishable.
 */
function pointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  sx: number,
  sy: number,
  ss: number,
): boolean {
  const dx = px - x1;
  const dy = py - y1;
  if (dx * sy - dy * sx !== 0) return false;
  const along = dx * sx + dy * sy;
  return along >= 0 && along <= ss;
}

/**
 * Completes a segment/segment hit at `(px, py)`. Depth is always 0 — segments
 * have no thickness to penetrate — and the normal is B's unit perpendicular
 * turned towards the side A lies on, which is what a reflection off B needs.
 */
function segmentHit(
  out: Contact,
  px: number,
  py: number,
  a: Segment,
  b: Segment,
  rx: number,
  ry: number,
  rr: number,
  sx: number,
  sy: number,
  ss: number,
): boolean {
  let nx: number;
  let ny: number;
  if (ss > 0) {
    const inv = 1 / Math.sqrt(ss);
    nx = -sy * inv;
    ny = sx * inv;
    // cross(B, a1 - b1) > 0 puts A's start on B's left, which is where the left
    // perpendicular already points. A start exactly on B's line says nothing, so
    // ask A's other end; if both are on the line the pair is collinear and has
    // no side at all, and the left perpendicular stands as the stable choice.
    let side = sx * (a.y1 - b.y1) - sy * (a.x1 - b.x1);
    if (side === 0) side = sx * (a.y2 - b.y1) - sy * (a.x2 - b.x1);
    if (side < 0) {
      nx = -nx;
      ny = -ny;
    }
  } else if (rr > 0) {
    // B is a single point and has no perpendicular; borrow A's.
    const inv = 1 / Math.sqrt(rr);
    nx = -ry * inv;
    ny = rx * inv;
  } else {
    // Two coincident points: no direction exists, so match the concentric case.
    nx = 1;
    ny = 0;
  }

  out.hit = true;
  out.depth = 0;
  out.normalX = nx;
  out.normalY = ny;
  out.pointX = px;
  out.pointY = py;
  return true;
}

/**
 * Segment against segment. Touching counts: a shared endpoint, a T junction and
 * a collinear overlap are all hits. `depth` is always 0, since segments are
 * infinitely thin; for a collinear overlap the contact point is the middle of
 * the overlapping stretch.
 */
export function segmentSegment(out: Contact, a: Segment, b: Segment): boolean {
  const rx = a.x2 - a.x1;
  const ry = a.y2 - a.y1;
  const sx = b.x2 - b.x1;
  const sy = b.y2 - b.y1;
  const rr = rx * rx + ry * ry;
  const ss = sx * sx + sy * sy;

  // A zero-length segment is a point. The parametric solution divides by the
  // lengths, so answer those separately rather than producing NaN.
  if (rr === 0 || ss === 0) {
    if (rr === 0 && ss === 0) {
      if (a.x1 !== b.x1 || a.y1 !== b.y1) return miss(out);
      return segmentHit(out, a.x1, a.y1, a, b, rx, ry, rr, sx, sy, ss);
    }
    if (rr === 0) {
      if (!pointOnSegment(a.x1, a.y1, b.x1, b.y1, sx, sy, ss)) return miss(out);
      return segmentHit(out, a.x1, a.y1, a, b, rx, ry, rr, sx, sy, ss);
    }
    if (!pointOnSegment(b.x1, b.y1, a.x1, a.y1, rx, ry, rr)) return miss(out);
    return segmentHit(out, b.x1, b.y1, a, b, rx, ry, rr, sx, sy, ss);
  }

  const qpx = b.x1 - a.x1;
  const qpy = b.y1 - a.y1;
  const denom = rx * sy - ry * sx;
  const qpXr = qpx * ry - qpy * rx;

  if (denom === 0) {
    // Parallel. Off each other's line unless the offset is also parallel.
    if (qpXr !== 0) return miss(out);
    // Collinear: compare the two spans in A's parameter.
    const invRr = 1 / rr;
    const t0 = (qpx * rx + qpy * ry) * invRr;
    const t1 = t0 + (sx * rx + sy * ry) * invRr;
    const lo = t0 < t1 ? t0 : t1;
    const hi = t0 < t1 ? t1 : t0;
    const start = lo > 0 ? lo : 0;
    const end = hi < 1 ? hi : 1;
    if (start > end) return miss(out);
    const mid = (start + end) / 2;
    return segmentHit(out, a.x1 + rx * mid, a.y1 + ry * mid, a, b, rx, ry, rr, sx, sy, ss);
  }

  const t = (qpx * sy - qpy * sx) / denom;
  if (t < 0 || t > 1) return miss(out);
  const u = qpXr / denom;
  if (u < 0 || u > 1) return miss(out);
  return segmentHit(out, a.x1 + rx * t, a.y1 + ry * t, a, b, rx, ry, rr, sx, sy, ss);
}

/**
 * Box against segment, in whatever frame the caller is working in; `out` comes
 * back in that same frame. The box arrives in the same centre/half-extent/
 * cos/sin form `boxBox` takes, so `aabbSegment` passes (1, 0) and pays no
 * trigonometry. Shared by `obbSegment` and `aabbSegment`.
 *
 * A segment is a box with no thickness. It is symmetric about its midpoint, so
 * its extent along any axis is |h . axis| for the half vector h, and the same
 * separating-axis test `boxBox` runs applies here with one axis fewer.
 *
 * Three axes are the complete set: the box's two face normals and the segment's
 * own perpendicular. The Minkowski difference of a box and a segment is a
 * hexagon whose edges are the box's four and the segment's two, and a separating
 * axis is always normal to one of those edges. The segment's own direction is
 * not in the set and does not need to be: an extra axis can never separate a
 * pair the complete set does not, and can never report a shallower overlap
 * either, because the shallowest over a complete set is already the smallest
 * escape in any direction at all.
 *
 * Ties keep the earlier axis, so the box's own axes win over the segment's, the
 * same preference `boxBox` gives A.
 */
function boxSegment(
  out: Contact,
  bx: number,
  by: number,
  hw: number,
  hh: number,
  cb: number,
  sb: number,
  seg: Segment,
): boolean {
  const sx = seg.x2 - seg.x1;
  const sy = seg.y2 - seg.y1;
  // The segment as a centre and a half vector, which is the form projection wants.
  const hx = sx / 2;
  const hy = sy / 2;
  const dx = bx - (seg.x1 + hx);
  const dy = by - (seg.y1 + hy);

  // The box's x axis.
  const p0 = dx * cb + dy * sb;
  const o0 = hw + Math.abs(hx * cb + hy * sb) - Math.abs(p0);
  if (o0 < 0) return miss(out);
  // The box's y axis.
  const p1 = dy * cb - dx * sb;
  const o1 = hh + Math.abs(hy * cb - hx * sb) - Math.abs(p1);
  if (o1 < 0) return miss(out);

  // The segment's perpendicular, the left one. Every term below is scaled by the
  // segment's length, so a separation is ruled out without a square root and only
  // a winning axis pays for one. A zero-length segment is a point and has no
  // perpendicular at all; the two box axes have already settled that case.
  const ss = sx * sx + sy * sy;
  let o2 = Infinity;
  let p2 = 0;
  let r2 = 0;
  let n2x = 0;
  let n2y = 0;
  if (ss > 0) {
    // The box's extent along the perpendicular, and the centre offset along it.
    const e = hw * Math.abs(sx * sb - sy * cb) + hh * Math.abs(sx * cb + sy * sb);
    const q = dy * sx - dx * sy;
    const scaled = e - Math.abs(q);
    if (scaled < 0) return miss(out);
    const inv = 1 / Math.sqrt(ss);
    o2 = scaled * inv;
    p2 = q * inv;
    r2 = e * inv;
    n2x = -sy * inv;
    n2y = sx * inv;
  }

  let depth = o0;
  let proj = p0;
  let radius = hw;
  let nx = cb;
  let ny = sb;
  if (o1 < depth) {
    depth = o1;
    proj = p1;
    radius = hh;
    nx = -sb;
    ny = cb;
  }
  if (o2 < depth) {
    depth = o2;
    proj = p2;
    radius = r2;
    nx = n2x;
    ny = n2y;
  }
  // Point the axis from the segment towards the box. A zero projection means the
  // two centres agree on this axis; the axis then stands as it is, arbitrary but
  // stable, as in `boxBox`.
  if (proj < 0) {
    nx = -nx;
    ny = -ny;
  }

  out.hit = true;
  out.depth = depth;
  out.normalX = nx;
  out.normalY = ny;
  // Mid-plane of the overlap slab, along the normal from the box's centre, which
  // is the same representative point `boxBox` reports.
  const k = depth / 2 - radius;
  out.pointX = bx + nx * k;
  out.pointY = by + ny * k;
  return true;
}

/**
 * Oriented box against segment. The normal points out of the segment towards the
 * box, so moving the box along it by `depth` clears the segment.
 *
 * A segment has no thickness, so a box resting a hair on either side of one is a
 * depth-0 hit rather than a miss, exactly as `circleSegment` and `segmentSegment`
 * treat a touch.
 */
export function obbSegment(out: Contact, a: Obb, b: Segment): boolean {
  return boxSegment(
    out,
    a.x,
    a.y,
    a.halfWidth,
    a.halfHeight,
    Math.cos(a.rotation),
    Math.sin(a.rotation),
    b,
  );
}

/**
 * Axis-aligned box against segment: `obbSegment` at zero rotation, with (1, 0)
 * standing in for the trigonometry.
 *
 * As with `aabbObb`, the box is halved into a centre and half extents first, so
 * a touch that min/max arithmetic would call exact can round to a hair either
 * side of zero here.
 */
export function aabbSegment(out: Contact, a: Aabb, b: Segment): boolean {
  return boxSegment(
    out,
    (a.minX + a.maxX) / 2,
    (a.minY + a.maxY) / 2,
    (a.maxX - a.minX) / 2,
    (a.maxY - a.minY) / 2,
    1,
    0,
    b,
  );
}

/**
 * The swept tests below answer a different question from the static tests above,
 * and the two disagree on purpose near zero. Read this before writing a solver
 * that uses both.
 *
 * A swept test asks when, during this step's motion, the shapes first touch. Its
 * entry time comes from a quadratic whose constant term is `distance^2 - r^2`.
 * When that term is a hair positive — a pair a few ULPs apart, which is what a
 * body resting against a wall usually is after a step of rounding — the entry
 * root lands somewhere around 1e-18 rather than at 0, and the swept test
 * correctly reports an impact within the step. The static test on those same two
 * shapes correctly reports no touch. Neither is wrong; they are answering
 * different questions.
 *
 * So: **an impact time near zero does not mean the shapes overlap now, and a
 * caller must not re-test with a static predicate before resolving.** That loop
 * — detect with the sweep, resolve from the static overlap — is the obvious way
 * to write a collision pass and it stalls. The sweep keeps naming an impact the
 * overlap-based resolver then declines, nothing moves, and the pass burns its
 * whole iteration guard on one pair: Ball Games bound at its full 24 passes and
 * ate a step of ball motion this way. Advance the body to the reported time and
 * resolve with the normal the sweep already returned.
 *
 * The record deliberately does not distinguish "touching now" from "touching at
 * the very start of this step", and adding a field for it would not help. The
 * boundary between the two cases is those same few ULPs, so the distinction is
 * not reliably computable: a hair-positive constant term can still round its
 * root to exactly 0 once the motion is fast enough. `depth === 0` is therefore
 * not a signal to branch on. The swept result is the authority for a swept
 * query, and a caller that genuinely wants the static answer should ask the
 * static test and use it for something other than vetoing the sweep.
 */

/**
 * Earliest time in [0, 1] at which a circle of radius `r` starting at `(cx, cy)`
 * and moving by `(dx, dy)` over the step reaches distance `r` from `(px, py)`.
 * Returns -1 when it never does, and 0 when it starts already within reach.
 */
function sweptPointTime(
  cx: number,
  cy: number,
  r: number,
  dx: number,
  dy: number,
  px: number,
  py: number,
): number {
  const ox = cx - px;
  const oy = cy - py;
  // |o + v t|^2 = r^2 expands to (v.v) t^2 + 2 (o.v) t + (o.o - r^2) = 0.
  const c = ox * ox + oy * oy - r * r;
  if (c <= 0) return 0;
  const aq = dx * dx + dy * dy;
  if (aq === 0) return -1;
  const bq = ox * dx + oy * dy;
  // Not closing: the distance only grows from here, so there is no entry root.
  if (bq >= 0) return -1;
  const disc = bq * bq - aq * c;
  if (disc < 0) return -1;
  // The smaller root is the entry; a tangent touch (disc 0) counts as a hit.
  const t = (-bq - Math.sqrt(disc)) / aq;
  return t <= 1 ? t : -1;
}

/**
 * Circle A swept by `(dx, dy)` over one step against a stationary circle B.
 *
 * `out.depth` carries the time of impact in [0, 1], not a penetration distance:
 * the two never apply at once, so one field serves both and the record stays six
 * numbers wide. Multiply the motion by it to get the position at contact. A pair
 * already touching or overlapping at the start of the step reports 0.
 *
 * Returns false, leaving the record cleared, when no impact happens within the
 * motion.
 *
 * A time near zero does not imply that {@link circleCircle} on the same two
 * shapes reports a touch, and the caller must not check. See the note above
 * `sweptPointTime`.
 */
export function sweptCircleCircle(
  out: Contact,
  a: Circle,
  dx: number,
  dy: number,
  b: Circle,
): boolean {
  const t = sweptPointTime(a.x, a.y, a.radius + b.radius, dx, dy, b.x, b.y);
  if (t < 0) return miss(out);

  const hx = a.x + dx * t - b.x;
  const hy = a.y + dy * t - b.y;
  const lenSq = hx * hx + hy * hy;
  let nx = 1;
  let ny = 0; // concentric fallback, as in circleCircle
  if (lenSq > 0) {
    const inv = 1 / Math.sqrt(lenSq);
    nx = hx * inv;
    ny = hy * inv;
  }

  out.hit = true;
  out.depth = t;
  out.normalX = nx;
  out.normalY = ny;
  out.pointX = b.x + nx * b.radius;
  out.pointY = b.y + ny * b.radius;
  return true;
}

/**
 * Circle swept by `(dx, dy)` over one step against a stationary segment. This is
 * what stops a fast puck from tunnelling: a static test only samples the ends of
 * the step, so a body that crosses a thin wall between them is never seen.
 *
 * `out.depth` carries the time of impact in [0, 1], exactly as in
 * {@link sweptCircleCircle}; a circle already touching the segment reports 0.
 * `pointX`/`pointY` is the point on the segment touched at impact.
 *
 * The segment is treated as a capsule of the circle's radius: the flat side and
 * the two end caps are solved separately and the earliest contact wins.
 *
 * A cap contact carries the same near-zero caveat as {@link sweptCircleCircle}:
 * it can report a time around 1e-18 for a circle {@link circleSegment} calls
 * clear. See the note above `sweptPointTime`.
 */
export function sweptCircleSegment(
  out: Contact,
  c: Circle,
  dx: number,
  dy: number,
  seg: Segment,
): boolean {
  // Already in contact at the start of the step: impact time 0, with the static
  // normal. A resting body must report this rather than sweeping past it.
  if (circleSegment(out, c, seg)) {
    out.depth = 0;
    return true;
  }

  const r = c.radius;
  const sx = seg.x2 - seg.x1;
  const sy = seg.y2 - seg.y1;
  const lenSq = sx * sx + sy * sy;

  let bestT = Infinity;
  let bestNx = 0;
  let bestNy = 0;
  let bestPx = 0;
  let bestPy = 0;

  if (lenSq > 0) {
    const len = Math.sqrt(lenSq);
    const inv = 1 / len;
    const ux = sx * inv;
    const uy = sy * inv;
    const nx = -uy;
    const ny = ux;
    const ox = c.x - seg.x1;
    const oy = c.y - seg.y1;
    const along = ox * ux + oy * uy;
    const perp = ox * nx + oy * ny;
    // Only a circle starting clear of the capsule's flat band can enter across
    // the flat side. One that starts inside the band but past an end has to come
    // round a cap, and the cap sweeps below find that earlier contact.
    if (perp > r || perp < -r) {
      const vPerp = dx * nx + dy * ny;
      if (vPerp !== 0) {
        const t = (perp > 0 ? r - perp : -r - perp) / vPerp;
        if (t >= 0 && t <= 1) {
          const at = along + (dx * ux + dy * uy) * t;
          if (at >= 0 && at <= len) {
            const sign = perp > 0 ? 1 : -1;
            bestT = t;
            bestNx = nx * sign;
            bestNy = ny * sign;
            bestPx = seg.x1 + ux * at;
            bestPy = seg.y1 + uy * at;
          }
        }
      }
    }
  }

  // End caps. A zero-length segment is nothing but its two coincident caps.
  let capT = sweptPointTime(c.x, c.y, r, dx, dy, seg.x1, seg.y1);
  if (capT >= 0 && capT < bestT) {
    bestT = capT;
    bestPx = seg.x1;
    bestPy = seg.y1;
    bestNx = c.x + dx * capT - seg.x1;
    bestNy = c.y + dy * capT - seg.y1;
  }
  capT = sweptPointTime(c.x, c.y, r, dx, dy, seg.x2, seg.y2);
  if (capT >= 0 && capT < bestT) {
    bestT = capT;
    bestPx = seg.x2;
    bestPy = seg.y2;
    bestNx = c.x + dx * capT - seg.x2;
    bestNy = c.y + dy * capT - seg.y2;
  }
  if (bestT === Infinity) return miss(out);

  const nLenSq = bestNx * bestNx + bestNy * bestNy;
  if (nLenSq > 0) {
    const inv = 1 / Math.sqrt(nLenSq);
    bestNx *= inv;
    bestNy *= inv;
  } else {
    // Only reachable for a zero-radius circle passing exactly through an end
    // point; there is no direction to report, so match the concentric case.
    bestNx = 1;
    bestNy = 0;
  }

  out.hit = true;
  out.depth = bestT;
  out.normalX = bestNx;
  out.normalY = bestNy;
  out.pointX = bestPx;
  out.pointY = bestPy;
  return true;
}

/**
 * Time in [0, 1] at which a circle crosses one face plane of a box, or -1 when
 * it does not. `p`/`dp` are the position and motion across the face, `q`/`dq`
 * the ones along it, and `[qMin, qMax]` the face's extent.
 *
 * The circle must start clear of the face's expanded plane. One that starts
 * inside that band is either already touching the box, or off past a corner,
 * where a corner sweep owns the contact and finds it earlier: to reach a face
 * from inside the band the circle would have to pass through the box first.
 */
function faceTime(
  p: number,
  dp: number,
  min: number,
  max: number,
  r: number,
  q: number,
  dq: number,
  qMin: number,
  qMax: number,
): number {
  let plane: number;
  if (p < min - r) plane = min - r;
  else if (p > max + r) plane = max + r;
  else return -1;
  if (dp === 0) return -1;
  const t = (plane - p) / dp;
  if (t < 0 || t > 1) return -1;
  const at = q + dq * t;
  return at >= qMin && at <= qMax ? t : -1;
}

/**
 * Circle swept by `(dx, dy)` over one step against a stationary axis-aligned
 * box. The box counterpart of {@link sweptCircleSegment}, and the same shape of
 * answer: `out.depth` is the time of impact in [0, 1], `pointX`/`pointY` the
 * point on the box touched at impact, and a circle already touching the box at
 * the start of the step reports time 0 with the static normal.
 *
 * The swept region is the box grown by the radius, with the corners rounded: the
 * four faces and the four corner caps are solved separately and the earliest
 * contact wins, exactly as the flat side and the two end caps are for a segment.
 * Every candidate is a real point of first touch, so the earliest of them is the
 * first touch.
 *
 * No fast-body flag guards this. Issue #111 asked for one — sweep only bodies
 * marked fast — and a flag is the wrong instrument. It is set by hand, so it is
 * wrong on exactly the body nobody thought would be fast, and a missed sweep is
 * a ball through a wall rather than a slow frame. The test itself is a handful
 * of multiplies against static geometry, cheaper than the broadphase that found
 * the pair. If a caller must skip work, the honest condition is measured, not
 * declared: compare the distance the body travels this step against its radius,
 * and sweep when the step could carry it past its own width. That reads the
 * simulation rather than trusting a boolean somebody forgot to set.
 */
export function sweptCircleAabb(
  out: Contact,
  c: Circle,
  dx: number,
  dy: number,
  box: Aabb,
): boolean {
  // Already in contact at the start of the step: impact time 0, with the static
  // normal. A resting body must report this rather than sweeping past it.
  if (circleAabb(out, c, box)) {
    out.depth = 0;
    return true;
  }

  const r = c.radius;
  let bestT = Infinity;
  let bestNx = 0;
  let bestNy = 0;
  let bestPx = 0;
  let bestPy = 0;

  // The left or right face; the circle cannot start clear of both.
  const tx = faceTime(c.x, dx, box.minX, box.maxX, r, c.y, dy, box.minY, box.maxY);
  if (tx >= 0) {
    const left = c.x < box.minX - r;
    bestT = tx;
    bestNx = left ? -1 : 1;
    bestNy = 0;
    bestPx = left ? box.minX : box.maxX;
    bestPy = c.y + dy * tx;
  }
  // The bottom or top face. Both axes can offer a crossing; the earlier is the
  // one the circle reaches.
  const ty = faceTime(c.y, dy, box.minY, box.maxY, r, c.x, dx, box.minX, box.maxX);
  if (ty >= 0 && ty < bestT) {
    const below = c.y < box.minY - r;
    bestT = ty;
    bestNx = 0;
    bestNy = below ? -1 : 1;
    bestPx = c.x + dx * ty;
    bestPy = below ? box.minY : box.maxY;
  }

  // The four corners, each rounded exactly like a capsule's end cap. The pair of
  // ternaries walks (min, min), (min, max), (max, min), (max, max).
  for (let i = 0; i < 4; i += 1) {
    const px = i < 2 ? box.minX : box.maxX;
    const py = (i & 1) === 1 ? box.maxY : box.minY;
    const t = sweptPointTime(c.x, c.y, r, dx, dy, px, py);
    if (t >= 0 && t < bestT) {
      bestT = t;
      bestPx = px;
      bestPy = py;
      bestNx = c.x + dx * t - px;
      bestNy = c.y + dy * t - py;
    }
  }
  if (bestT === Infinity) return miss(out);

  const nLenSq = bestNx * bestNx + bestNy * bestNy;
  if (nLenSq > 0) {
    const inv = 1 / Math.sqrt(nLenSq);
    bestNx *= inv;
    bestNy *= inv;
  } else {
    // Only reachable for a zero-radius circle passing exactly through a corner;
    // there is no direction to report, so match the concentric case.
    bestNx = 1;
    bestNy = 0;
  }

  out.hit = true;
  out.depth = bestT;
  out.normalX = bestNx;
  out.normalY = bestNy;
  out.pointX = bestPx;
  out.pointY = bestPy;
  return true;
}
