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

export {
  FixedLoop,
  RunLoop,
  browserClock,
  browserGamepadSource,
  browserBatterySource,
} from './loop.js';
export type { BatteryManagerLike } from './loop.js';
export type { Clock, LoopCallbacks, LoopOptions } from './loop.js';

export { LatencyMeter, INPUT_FAMILIES } from './latency.js';
export type { InputFamily, LatencyStats } from './latency.js';

export { GamepadManager } from './gamepad.js';
export type {
  GamepadSnapshot,
  GamepadSource,
  GamepadReading,
  GamepadEvent,
  GamepadEventKind,
  GamepadManagerOptions,
} from './gamepad.js';

export {
  SEATS,
  otherSeat,
  seatRotated,
  seatView,
  toWorld,
  toScreen,
  seatForPoint,
  zoneSplitFor,
  PointerOwnership,
} from './seat.js';
export type {
  SeatId,
  Presentation,
  SeatView,
  LogicalSize,
  ZoneSplit,
  DeclaredZoneSplit,
} from './seat.js';

export { GridCursor } from './cursor.js';
export type { GridCursorOptions } from './cursor.js';

export { SeatFlip } from './flip.js';
export type { SeatFlipOptions } from './flip.js';

export {
  Tween,
  linear,
  smoothstep,
  smootherstep,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeOutBack,
} from './tween.js';
export type { Easing, TweenOptions, MotionPreference } from './tween.js';

export {
  Shake,
  Flash,
  HitStop,
  Impact,
  applyShake,
  releaseShake,
  MAX_HOLD_SECONDS,
} from './juice.js';
export type { ShakeOptions, FlashOptions, ImpactOptions } from './juice.js';

export {
  SEAT_PALETTE,
  SEAT_PALETTES,
  seatPalette,
  setActiveSeatPalette,
  activeSeatPaletteId,
} from './palette.js';
export type { SeatPalette, SeatPaletteId } from './palette.js';

export {
  NO_INSETS,
  fitViewport,
  viewportToLogical,
  logicalToViewport,
  isInsideLogical,
  clampDevicePixelRatio,
  negotiateSharedLogical,
  negotiateSharedViewport,
} from './viewport.js';
export type { SafeAreaInsets, Viewport, DeviceScreen, SharedViewport } from './viewport.js';

export {
  createContact,
  circleCircle,
  circleAabb,
  circleObb,
  circleSegment,
  aabbAabb,
  aabbObb,
  aabbSegment,
  segmentSegment,
  obbObb,
  obbSegment,
  closestPointOnSegment,
  pointInAabb,
  pointInCircle,
  sweptCircleAabb,
  sweptCircleSegment,
  sweptCircleCircle,
} from './collision.js';
export type { Circle, Aabb, Obb, Segment, Contact } from './collision.js';

export {
  InputState,
  InputManager,
  PRECISION_ENVELOPE,
  envelopeFor,
  SCALAR_ENVELOPE,
  scalarEnvelopeFor,
  quantiseScalar,
  DEFAULT_BINDINGS,
  bindingConflicts,
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

export { SOUND_EVENTS, soundEventSpec } from './sound-events.js';
export type {
  SoundEvent,
  SoundEventSpec,
  SoundOwner,
  ShellSoundEvent,
  GameSoundEvent,
  GameSoundBus,
} from './sound-events.js';

export {
  LoopbackTransport,
  loopbackPair,
  frameProblem,
  createFrameBuffer,
  copyFrameInto,
} from './transport.js';
export type {
  MatchTransport,
  SeatInputFrame,
  SeatInputFrameBuffer,
  FrameSink,
  TransportStatus,
  LoopbackOptions,
} from './transport.js';

export { LockstepSession, configFingerprint, mixNumber } from './lockstep.js';
export type { LockstepOptions, MatchConfig, SessionStatus } from './lockstep.js';

export { SceneNode } from './scene.js';

export { createBody, resolveContact } from './resolve.js';
export type { Body, BodyInit, ResolveOptions } from './resolve.js';

export { SpatialHash, forEachBrutePair, brutePairCount } from './broadphase.js';

export { ParticlePool } from './particle.js';
export type { EmitterConfig } from './particle.js';

export { AdaptiveQuality, DEFAULT_QUALITY_LEVELS } from './quality.js';
export { LOW_BATTERY_LEVEL, RenderGate, isLowPower } from './power.js';
export type { BatterySnapshot, BatterySource } from './power.js';
export type { QualityLevel, AdaptiveQualityOptions } from './quality.js';

export { AssetLoader, AssetBundle, AssetLoadError } from './asset-loader.js';
export type {
  AssetKind,
  AssetDescriptor,
  AssetIO,
  ImageLike,
  AudioLike,
  AssetLoaderOptions,
} from './asset-loader.js';

export { SpriteAtlas, packShelf } from './atlas.js';
export type { AtlasFrame, AtlasManifest, PackInput, PackOptions, PackResult } from './atlas.js';

export { SpriteBatch, LineBatch, Canvas2DSpriteSink, WebGLSpriteSink } from './batch.js';
export type { SpriteSink, LineSink, DrawImageContext, ImageResolver, WebGLLike } from './batch.js';

export {
  RepresentativeLoop,
  measureStructuralGrowth,
  measureHeapBytesPerStep,
  heapMeasurementAvailable,
} from './hot-path.js';
export type { RepresentativeLoopOptions } from './hot-path.js';
