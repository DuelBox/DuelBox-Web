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
  seatRotated,
  seatView,
  toWorld,
  toScreen,
  seatForPoint,
  PointerOwnership,
} from './seat.js';
export type { SeatId, Presentation, SeatView, LogicalSize, ZoneSplit } from './seat.js';

export { GridCursor } from './cursor.js';
export type { GridCursorOptions } from './cursor.js';

export { SeatFlip } from './flip.js';
export type { SeatFlipOptions } from './flip.js';

export { SEAT_PALETTE, seatPalette } from './palette.js';
export type { SeatPalette } from './palette.js';

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

export {
  InputState,
  InputManager,
  PRECISION_ENVELOPE,
  envelopeFor,
  DEFAULT_BINDINGS,
} from './input.js';
export type { SeatInputState, KeyBinding } from './input.js';

export { InputRecorder, TracePlayer, exportTrace, importTrace } from './record.js';
export type { InputEvent, RecordedFrame, Trace } from './record.js';
export { InputView } from './input-view.js';
export type { InputStateView, SeatInputView } from './input-view.js';

export { Canvas2DRenderer } from './renderer.js';
export type { Renderer, Canvas2DLike, TextAlign } from './renderer.js';

export { AudioSystem, browserAudioContext, GESTURE_EVENTS } from './audio.js';
export type {
  AudioSystemOptions,
  AudioState,
  AudioTarget,
  AudioEventListener,
  AudioListenerOptions,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  GainNodeLike,
} from './audio.js';
