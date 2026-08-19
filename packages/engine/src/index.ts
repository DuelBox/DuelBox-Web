export { Rng } from './rng.js';
export type { RngState } from './rng.js';

export {
  vec2,
  set,
  copy,
  add,
  sub,
  scale,
  addScaled,
  negate,
  normalise,
  perp,
  lerp,
  rotate,
  reflect,
  dot,
  cross,
  length,
  lengthSq,
  distance,
  distanceSq,
  angle,
  equals,
  Vec2Pool,
} from './vec2.js';
export type { Vec2 } from './vec2.js';

export { FixedLoop, RunLoop, browserClock } from './loop.js';
export type { Clock, LoopCallbacks, LoopOptions } from './loop.js';

export {
  SEATS,
  otherSeat,
  seatView,
  toWorld,
  toScreen,
  seatForPoint,
  PointerOwnership,
} from './seat.js';
export type { SeatId, Presentation, SeatView, LogicalSize, ZoneSplit } from './seat.js';

export {
  NO_INSETS,
  fitViewport,
  viewportToLogical,
  logicalToViewport,
  isInsideLogical,
  clampDevicePixelRatio,
  negotiateSharedLogical,
} from './viewport.js';
export type { SafeAreaInsets, Viewport } from './viewport.js';

export {
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
export type { Circle, Aabb, Obb, Segment, Contact } from './collision.js';

export { InputState, InputManager, DEFAULT_BINDINGS } from './input.js';
export type { SeatInputState, KeyBinding } from './input.js';

export { Canvas2DRenderer } from './renderer.js';
export type { Renderer, Canvas2DLike, TextAlign } from './renderer.js';
