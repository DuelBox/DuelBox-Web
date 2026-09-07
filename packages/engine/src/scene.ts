/**
 * Retained scene graph with a transform hierarchy.
 *
 * A node holds a local transform — translation, rotation, and per-axis scale —
 * and links to a parent and children. Its world transform is the product of every
 * ancestor's local transform down to it, cached as a 2x3 affine matrix so a node
 * whose branch has not moved is never recomposed.
 *
 * Caching is by version stamp rather than an eager descendant sweep. Changing a
 * node's local transform marks that node, and reading a node's world matrix walks
 * up to the root, recomposing exactly the ancestors whose input changed and
 * nobody else. A sibling subtree that nothing touched keeps its cached matrices
 * and is not recomposed — which is the whole point: static furniture in a scene
 * costs nothing per frame.
 *
 * All maths is in LOGICAL units. Composing a world matrix writes into fields the
 * node already owns, so a steady-state frame that reads world transforms allocates
 * nothing. The only allocations are structural: a node, and the array backing its
 * children, both built when the tree is assembled rather than per frame.
 */

import type { Vec2 } from './vec2.js';

/**
 * A node in the scene graph.
 *
 * Local transform is set through the mutators, which mark the node so its world
 * matrix is recomposed on next read. World matrix components are exposed as
 * `worldA..worldF` for the affine `[[a, c, e], [b, d, f], [0, 0, 1]]`, matching the
 * canvas transform order, and {@link SceneNode.transformPoint} applies them.
 */
export class SceneNode {
  #parent: SceneNode | null = null;
  readonly #children: SceneNode[] = [];

  // Local transform.
  #x = 0;
  #y = 0;
  #rotation = 0;
  #scaleX = 1;
  #scaleY = 1;

  // Cached world matrix [[a, c, e], [b, d, f], [0, 0, 1]].
  #wa = 1;
  #wb = 0;
  #wc = 0;
  #wd = 1;
  #we = 0;
  #wf = 0;

  /** Set when the local transform changed and the world matrix is stale. */
  #localDirty = true;
  /** Bumped every time this node recomposes, so descendants can tell its world moved. */
  #worldStamp = 0;
  /** The parent's `#worldStamp` at this node's last recompose; -1 forces a first compose. */
  #seenParentStamp = -1;
  /** Diagnostic: how many times this node has actually recomposed its world matrix. */
  #recomputeCount = 0;

  get parent(): SceneNode | null {
    return this.#parent;
  }

  /** Live view of the children. Do not mutate directly; use addChild/removeChild. */
  get children(): readonly SceneNode[] {
    return this.#children;
  }

  get x(): number {
    return this.#x;
  }
  get y(): number {
    return this.#y;
  }
  get rotation(): number {
    return this.#rotation;
  }
  get scaleX(): number {
    return this.#scaleX;
  }
  get scaleY(): number {
    return this.#scaleY;
  }

  /** True while a recompose is pending — this node's local changed, or an ancestor's world did. */
  get dirty(): boolean {
    if (this.#localDirty) return true;
    const p = this.#parent;
    if (p === null) return false;
    // Reading dirty must reflect an ancestor that has moved but not yet been read here.
    return p.dirty || p.#worldStamp !== this.#seenParentStamp;
  }

  /** Number of times this node has recomposed its world matrix. Test/diagnostic only. */
  get recomputeCount(): number {
    return this.#recomputeCount;
  }

  get worldA(): number {
    this.#ensureWorld();
    return this.#wa;
  }
  get worldB(): number {
    this.#ensureWorld();
    return this.#wb;
  }
  get worldC(): number {
    this.#ensureWorld();
    return this.#wc;
  }
  get worldD(): number {
    this.#ensureWorld();
    return this.#wd;
  }
  get worldE(): number {
    this.#ensureWorld();
    return this.#we;
  }
  get worldF(): number {
    this.#ensureWorld();
    return this.#wf;
  }

  setPosition(x: number, y: number): this {
    this.#x = x;
    this.#y = y;
    this.#localDirty = true;
    return this;
  }

  setRotation(radians: number): this {
    this.#rotation = radians;
    this.#localDirty = true;
    return this;
  }

  setScale(scaleX: number, scaleY: number = scaleX): this {
    this.#scaleX = scaleX;
    this.#scaleY = scaleY;
    this.#localDirty = true;
    return this;
  }

  /** Set the whole local transform at once. */
  setLocal(x: number, y: number, rotation: number, scaleX: number, scaleY: number = scaleX): this {
    this.#x = x;
    this.#y = y;
    this.#rotation = rotation;
    this.#scaleX = scaleX;
    this.#scaleY = scaleY;
    this.#localDirty = true;
    return this;
  }

  /**
   * Attach `child` under this node. A node already parented elsewhere is detached
   * first, so a node is never in two trees. Returns the child for chaining.
   *
   * @throws Error if `child` is this node or one of its own ancestors — that would
   * make a cycle, and composing a world transform would never terminate.
   */
  addChild(child: SceneNode): SceneNode {
    if (child === this) {
      throw new Error('a scene node cannot be its own child');
    }
    // Walk this node's ancestors: if `child` is among them, attaching it here loops.
    for (let n = this.#parent; n !== null; n = n.#parent) {
      if (n === child) {
        throw new Error('adding this child would create a cycle in the scene graph');
      }
    }
    if (child.#parent !== null) child.#parent.removeChild(child);
    child.#parent = this;
    this.#children.push(child);
    // Its parent chain changed, so its cached world is stale.
    child.#localDirty = true;
    child.#seenParentStamp = -1;
    return child;
  }

  /** Detach `child`. No-op if it is not a child of this node. */
  removeChild(child: SceneNode): void {
    const i = this.#children.indexOf(child);
    if (i === -1) return;
    this.#children.splice(i, 1);
    child.#parent = null;
    child.#localDirty = true;
    child.#seenParentStamp = -1;
  }

  /**
   * Map a point from this node's local space into world space, writing into `out`.
   * Recomposes stale ancestors first. Allocates nothing.
   */
  transformPoint(out: Vec2, localX: number, localY: number): Vec2 {
    this.#ensureWorld();
    out.x = this.#wa * localX + this.#wc * localY + this.#we;
    out.y = this.#wb * localX + this.#wd * localY + this.#wf;
    return out;
  }

  /** Ensure this node — and every stale ancestor — has a current world matrix. */
  #ensureWorld(): void {
    const p = this.#parent;
    if (p !== null) p.#ensureWorld();
    const parentStamp = p === null ? 0 : p.#worldStamp;
    if (!this.#localDirty && parentStamp === this.#seenParentStamp) {
      return; // Neither our local transform nor any ancestor's world has changed.
    }
    this.#compose(p);
    this.#seenParentStamp = parentStamp;
    this.#localDirty = false;
    this.#worldStamp += 1;
    this.#recomputeCount += 1;
  }

  #compose(parent: SceneNode | null): void {
    const cos = Math.cos(this.#rotation);
    const sin = Math.sin(this.#rotation);
    // Local matrix from rotation and per-axis scale.
    const la = cos * this.#scaleX;
    const lb = sin * this.#scaleX;
    const lc = -sin * this.#scaleY;
    const ld = cos * this.#scaleY;
    const le = this.#x;
    const lf = this.#y;
    if (parent === null) {
      this.#wa = la;
      this.#wb = lb;
      this.#wc = lc;
      this.#wd = ld;
      this.#we = le;
      this.#wf = lf;
      return;
    }
    const pa = parent.#wa;
    const pb = parent.#wb;
    const pc = parent.#wc;
    const pd = parent.#wd;
    const pe = parent.#we;
    const pf = parent.#wf;
    // world = parentWorld * local.
    this.#wa = pa * la + pc * lb;
    this.#wb = pb * la + pd * lb;
    this.#wc = pa * lc + pc * ld;
    this.#wd = pb * lc + pd * ld;
    this.#we = pa * le + pc * lf + pe;
    this.#wf = pb * le + pd * lf + pf;
  }
}
