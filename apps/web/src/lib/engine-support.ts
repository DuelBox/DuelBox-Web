/**
 * Whether this browser can run a game at all, asked before the game chunk is fetched (#225).
 *
 * `docs/support-matrix.md` promises an unsupported browser "a clear message rather than a
 * broken page", and half of that was already kept by the architecture: the site is a static
 * export, so every page arrives as readable HTML, and a visitor with scripting off is told
 * why by the play route's `<noscript>` (#103). The half that was not is the engine that
 * *runs* script and still cannot draw. `createRendererBackend` returns null when the canvas
 * gives no context, `GameHost` returns from its mount effect on that null, and the player
 * who pressed Play watched an empty rectangle with nothing anywhere saying why — because
 * nothing knew. This is what knows.
 *
 * ## The list is read out of the code, not guessed
 *
 * Every entry is a call a match actually makes, and a browser without it fails at that call
 * rather than degrading. The file is named for each because a probe that turns away a
 * browser over something optional is worse than no probe at all.
 *
 * | Reason | What needs it |
 * |---|---|
 * | `canvas` | `lib/renderer-backend.ts` asks `canvas.getContext('2d')`; null there is a null backend and `GameHost` stops. Every game draws through `Canvas2DRenderer`; the WebGL backend behind `NEXT_PUBLIC_RENDERER` falls back to this one, so 2D is the requirement either way. |
 * | `frames` | `browserClock()` (`packages/engine/src/loop.ts`) throws without `requestAnimationFrame` **and** `cancelAnimationFrame`. |
 * | `clock` | The same function throws without `performance.now()`. |
 * | `resize` | `GameHost` constructs a `ResizeObserver` to keep the backing store the size of the element. |
 * | `pointer` | `GameHost` listens for `pointerdown`, `pointermove`, `pointerup` and `pointercancel`, and for nothing else — a browser without Pointer Events delivers no touch or mouse input to any game. |
 * | `media` | `GameHost` reads `matchMedia('(prefers-reduced-motion: reduce)')` and `RotatePrompt` reads `matchMedia('(orientation: portrait)')`, both unguarded. |
 *
 * What is deliberately **not** probed, because the code already survives its absence and a
 * check on it would refuse a browser that plays perfectly well: `AudioContext` — sound is an
 * enhancement, reached lazily, and the matrix says a blocked context costs the cues rather
 * than the game; `localStorage` — every read in `lib/local-store.ts` returns a fallback;
 * `devicePixelRatio` — `clampDevicePixelRatio` answers 1 for anything non-finite; and WebGL,
 * which no published build asks for.
 *
 * The probe is pure and takes its environment as an argument, so `engine-support.test.ts`
 * can take exactly one capability away at a time. `browserEngineEnvironment()` is the only
 * part that touches a global, and it is the part no unit test runs.
 */

/** Why the games cannot run here. One sentence each, in `REASON_TEXT`. */
export type UnsupportedReason = 'canvas' | 'frames' | 'clock' | 'resize' | 'pointer' | 'media';

/** Exactly what the probe reads. Injected, so a fake can be short one thing. */
export interface EngineEnvironment {
  /** Whether a canvas element can be made and will give a 2D context. */
  readonly canvas2d: boolean;
  readonly requestAnimationFrame: unknown;
  readonly cancelAnimationFrame: unknown;
  /** `performance.now`, unbound. */
  readonly now: unknown;
  readonly resizeObserver: unknown;
  readonly pointerEvent: unknown;
  readonly matchMedia: unknown;
}

/**
 * The reason in plain words, for the panel `PlaySurface` draws instead of the lobby.
 *
 * Registered for extraction in `lib/i18n/sources.ts` rather than found at a call site: the
 * render site is `t(messages, REASON_TEXT[reason])`, and the extractor cannot see a variable
 * (`docs/i18n.md`). No sentence names an API — a visitor on a browser this old is not the
 * person who can do anything about `ResizeObserver`, and the matrix owes them a reason, not
 * a diagnosis.
 */
export const REASON_TEXT: Readonly<Record<UnsupportedReason, string>> = {
  canvas: 'It will not give this page a drawing surface, and every game is drawn on one.',
  frames: 'It cannot schedule animation frames, so nothing could be drawn in time.',
  clock: 'It has no high-resolution clock, so a match could not be timed.',
  resize: 'It cannot watch the board for size changes, so it could not be fitted to the screen.',
  pointer: 'It sends no pointer events, so a tap or a click would never reach the board.',
  media: 'It cannot answer questions about the screen, so the board could not be laid out.',
};

/**
 * The first thing missing, or null when a match can run.
 *
 * Ordered by how fundamental the loss is rather than alphabetically, so a browser missing
 * several is told the one worth saying. The order is not load-bearing — any reason is a
 * refusal — but it is the difference between "no drawing surface" and "no pointer events"
 * on an engine that has neither.
 */
export function unsupportedReason(env: EngineEnvironment): UnsupportedReason | null {
  if (!env.canvas2d) return 'canvas';
  if (
    typeof env.requestAnimationFrame !== 'function' ||
    typeof env.cancelAnimationFrame !== 'function'
  ) {
    return 'frames';
  }
  if (typeof env.now !== 'function') return 'clock';
  if (typeof env.resizeObserver !== 'function') return 'resize';
  if (typeof env.pointerEvent !== 'function') return 'pointer';
  if (typeof env.matchMedia !== 'function') return 'media';
  return null;
}

/**
 * This browser, read once.
 *
 * The canvas is made and thrown away rather than asked about: whether a context can be had
 * is not something a feature test can infer, and a browser that refuses one under memory
 * pressure refuses it here too. `getContext` may not exist at all on an engine old enough to
 * matter, so the whole of it is guarded — a throw here is the same answer as a null.
 */
export function browserEngineEnvironment(): EngineEnvironment {
  // Read as a bag of unknowns rather than through the DOM types, which promise every one of
  // these exists — which is the assumption this function is here to stop making.
  const scope = globalThis as unknown as Record<string, unknown>;
  const clock = scope.performance as { now?: unknown } | undefined;
  let canvas2d = false;
  try {
    canvas2d = document.createElement('canvas').getContext('2d') !== null;
  } catch {
    canvas2d = false;
  }
  return {
    canvas2d,
    requestAnimationFrame: scope.requestAnimationFrame,
    cancelAnimationFrame: scope.cancelAnimationFrame,
    now: clock?.now,
    resizeObserver: scope.ResizeObserver,
    pointerEvent: scope.PointerEvent,
    matchMedia: scope.matchMedia,
  };
}
