/**
 * Impulse-based collision resolution with restitution and friction.
 *
 * The narrow-phase in `collision.ts` reports a {@link Contact}: a unit normal, a
 * penetration depth, and a contact point. This module turns that into a change of
 * velocity — the resolver that powers air hockey, sumo, spinner war, pin soccer,
 * and pool.
 *
 * It is deterministic and allocation-free per pair: every quantity is a local
 * scalar, so a step resolving hundreds of contacts touches no heap. Impulses are
 * applied equal and opposite, weighted by inverse mass, so linear momentum is
 * conserved to the float — a property a soak test leans on directly.
 *
 * The {@link Contact} convention is the module's own: the normal points from A out
 * of B, i.e. moving A along +normal separates the pair. A body with `invMass === 0`
 * is immovable (a wall, a static peg): it takes no impulse and the whole reaction
 * lands on its dynamic partner.
 *
 * Tunnelling of a fast, small body through a thin wall is a *broadphase/narrow-phase*
 * concern, not this module's: the swept tests in `collision.ts` (sweptCircleCircle,
 * sweptCircleSegment, sweptCircleAabb) find the time-of-impact contact this resolver
 * then consumes. Feed this a swept contact and there is nothing to tunnel through.
 */

import type { Contact } from './collision.js';

/**
 * A body the resolver can push. Positions and velocities are in LOGICAL units.
 * `invMass` is 1/mass, with 0 meaning immovable. Restitution is the bounciness in
 * [0, 1]; friction is the Coulomb coefficient, >= 0.
 */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 1 / mass. 0 is immovable and cannot be accelerated. */
  invMass: number;
  /** Bounciness in [0, 1]: 0 absorbs, 1 rebounds fully. */
  restitution: number;
  /** Coulomb friction coefficient, >= 0. */
  friction: number;
}

export interface ResolveOptions {
  /**
   * Nudge the pair apart to undo penetration. On by default; positions change but
   * velocities (and therefore momentum) do not, so a momentum soak is unaffected.
   */
  readonly positionalCorrection?: boolean;
  /** Fraction of penetration corrected per resolve. Under-correcting avoids jitter. */
  readonly correctionPercent?: number;
  /** Penetration below this is left alone, so a resting stack does not buzz. */
  readonly slopLogical?: number;
}

const DEFAULT_CORRECTION_PERCENT = 0.2;
const DEFAULT_SLOP = 0.01;

export interface BodyInit {
  readonly x?: number;
  readonly y?: number;
  readonly vx?: number;
  readonly vy?: number;
  readonly invMass?: number;
  readonly restitution?: number;
  readonly friction?: number;
}

/** Build a {@link Body} with sensible defaults. Setup only — allocates. */
export function createBody(init: BodyInit = {}): Body {
  return {
    x: init.x ?? 0,
    y: init.y ?? 0,
    vx: init.vx ?? 0,
    vy: init.vy ?? 0,
    invMass: init.invMass ?? 1,
    restitution: init.restitution ?? 0,
    friction: init.friction ?? 0,
  };
}

/**
 * Resolve one contact between `a` and `b`, mutating their velocities (and, unless
 * disabled, their positions). No-op when the pair is separating or both bodies are
 * immovable. Allocates nothing.
 *
 * Returns the scalar normal impulse applied (0 when nothing was done), which a
 * caller can use for a hit sound or juice intensity.
 */
export function resolveContact(
  a: Body,
  b: Body,
  contact: Contact,
  options?: ResolveOptions,
): number {
  if (!contact.hit) return 0;
  const invMassSum = a.invMass + b.invMass;
  if (invMassSum === 0) return 0; // two immovable bodies: nothing to do.

  const nx = contact.normalX;
  const ny = contact.normalY;

  // Relative velocity of A with respect to B.
  const rvx = a.vx - b.vx;
  const rvy = a.vy - b.vy;
  const velAlongNormal = rvx * nx + rvy * ny;

  // +normal separates A from B, so an approaching pair has a negative component.
  // A separating pair is left alone: resolving it would suck the bodies together.
  if (velAlongNormal >= 0) {
    if (options?.positionalCorrection !== false) applyPositionalCorrection(a, b, contact, options);
    return 0;
  }

  const restitution = a.restitution < b.restitution ? a.restitution : b.restitution;

  // Normal impulse magnitude.
  const j = (-(1 + restitution) * velAlongNormal) / invMassSum;
  const jx = j * nx;
  const jy = j * ny;
  a.vx += jx * a.invMass;
  a.vy += jy * a.invMass;
  b.vx -= jx * b.invMass;
  b.vy -= jy * b.invMass;

  // Friction acts along the tangent — the part of the relative velocity across the normal.
  const friction = Math.sqrt(a.friction * b.friction);
  if (friction > 0) {
    // Recompute relative velocity after the normal impulse.
    const rvx2 = a.vx - b.vx;
    const rvy2 = a.vy - b.vy;
    const vDotN = rvx2 * nx + rvy2 * ny;
    let tx = rvx2 - vDotN * nx;
    let ty = rvy2 - vDotN * ny;
    const tLenSq = tx * tx + ty * ty;
    if (tLenSq > 1e-12) {
      const inv = 1 / Math.sqrt(tLenSq);
      tx *= inv;
      ty *= inv;
      // Impulse that would stop tangential motion entirely.
      let jt = -(rvx2 * tx + rvy2 * ty) / invMassSum;
      // Coulomb cone: tangential impulse cannot exceed friction * normal impulse.
      const maxFriction = friction * j;
      if (jt > maxFriction) jt = maxFriction;
      else if (jt < -maxFriction) jt = -maxFriction;
      const ftx = jt * tx;
      const fty = jt * ty;
      a.vx += ftx * a.invMass;
      a.vy += fty * a.invMass;
      b.vx -= ftx * b.invMass;
      b.vy -= fty * b.invMass;
    }
  }

  if (options?.positionalCorrection !== false) applyPositionalCorrection(a, b, contact, options);
  return j;
}

/**
 * Push the pair apart along the normal to undo penetration. Only positions move,
 * so momentum is untouched. Correction is shared by inverse mass, so a light body
 * moves and a heavy one barely does.
 */
function applyPositionalCorrection(
  a: Body,
  b: Body,
  contact: Contact,
  options?: ResolveOptions,
): void {
  const invMassSum = a.invMass + b.invMass;
  if (invMassSum === 0) return;
  const slop = options?.slopLogical ?? DEFAULT_SLOP;
  const penetration = contact.depth - slop;
  if (penetration <= 0) return;
  const percent = options?.correctionPercent ?? DEFAULT_CORRECTION_PERCENT;
  const correction = (penetration / invMassSum) * percent;
  const cx = correction * contact.normalX;
  const cy = correction * contact.normalY;
  // +normal moves A off B, so A goes with the normal and B against it.
  a.x += cx * a.invMass;
  a.y += cy * a.invMass;
  b.x -= cx * b.invMass;
  b.y -= cy * b.invMass;
}
