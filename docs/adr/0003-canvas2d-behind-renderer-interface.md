# ADR 0003 — Canvas2D behind the `Renderer` interface, in logical units only

**Status:** accepted
**Date:** 2026-09-06

## Context

Every game draws something, and 107 of them cannot each choose how. The reference app,
as recorded in `docs/reference-analysis.md`, draws flat two-dimensional play areas —
boards, arenas, lanes — with a shared score pill and exit control anchored to the edges,
and rotates the whole play area half a turn when the active seat changes. Nothing
observed there needs a third dimension, lighting, or a sprite pipeline.

`PLAN.md` (Stack table) says the engine is "Custom, Canvas2D, fixed timestep" because
"107 small games do not need a physics library, and React must never enter a game loop."
The same reasoning applies to the renderer: a WebGL scene graph would be a dependency
larger than most of the games it served, and `size-budget.json` allows 12,288 gzipped
bytes for a game's own chunk.

Three rules in `CLAUDE.md` shape the interface more than the backend does:

- Rule 8: no simulation value is ever expressed in pixels. A phone and a laptop must step
  the identical match.
- Rule 9: neither player may ever see more of the play area than the other. Surplus screen
  space holds chrome, never extra field of view.
- Rule 10: no game code branches on device type.

`docs/presentation.md` adds that every game renders two ways — shared-screen, where the
board turns to face whoever has the move, and single-seat, where it never rotates — and
that the SDK decides which, never the game. Whatever games draw through has to carry that
rotation for them.

## Decision

**Games draw through the `Renderer` interface in `packages/engine/src/renderer.ts`. The
only implementation is `Canvas2DRenderer`. Every value crossing the interface is in
logical units; the renderer owns the conversion to the device. A WebGL backend is
deferred until a game needs one.**

The interface is small on purpose: `clear`, `rect`, `strokeRect`, `circle`,
`strokeCircle`, `line`, `text`, and the pair `pushSeatRotation` / `pushRotation` with
`popSeatRotation`. That is the whole vocabulary a game has. Its comment states the
contract: "Games draw through Renderer and never touch a canvas context, so a WebGL
backend can be added later without editing a single game."

Logical units are the load-bearing part. A game declares its play area in its manifest —
`packages/games/tic-tac-toe/src/manifest.ts` is 900 × 900, air hockey is 600 × 1000 — and
every coordinate, radius, line width and text size it passes is in those units.
`packages/engine/src/viewport.ts` fits that box inside the screen minus the safe-area
insets, preserving aspect ratio and centring it, and the surplus becomes letterbox: "a
wider screen shows the same logical area as a narrower one, never more of it." Scale and
offsets are left unrounded so `viewportToLogical` and `logicalToViewport` are exact
inverses. `clampDevicePixelRatio` caps the backing store at 2× because rendering above
that costs frame budget for no visible gain at arm's length. `negotiateSharedLogical`
gives two devices one box to letterbox to, which is how rule 9 holds in remote play.

Seat rotation lives in the renderer, not in games. `pushSeatRotation(true)` turns the
world `HALF_TURN` — π radians, "exactly half a turn" — about the centre of the logical
area, and `pushRotation(radians)` is the continuous form a seat flip passes through. While
turning, the frame is scaled by `1 / (|cos| + |sin|)` so the corners of the board stay
inside the clipped box; the factor is 1 at every resting angle, so a settled board is
never scaled. Reduced motion is applied here too — `setReducedMotion` snaps to the nearest
half turn — because a game may not read the device (rule 10), and because the flip must
still step identically everywhere: reduced motion changes what is drawn, never what is
simulated.

Text uses one family. `FONT_FAMILY` is a system stack; games choose a size and never a
face, so metrics stay predictable and the font string cache keys on size alone.
`TextAlign` is spelled `'centre'` at the API edge and translated to the canvas spelling
inside, so the American form never leaks into a game.

The Canvas2D dependency is typed structurally. `Canvas2DLike` is the narrow slice of
`CanvasRenderingContext2D` the implementation uses, declared rather than imported, so
tests pass a recording fake with no DOM at all — that is how
`apps/web/src/data/cross-viewport.test.ts` drives every game at five viewports from a
320 × 568 phone to 4K and compares the states bit for bit.

## Consequences

- Primitives only. There is no image or sprite call on the interface, and no game ships a
  binary asset: `scripts/check-asset-licenses.mjs` records that the count of tracked image,
  audio, video and font files is zero, and that rule 3 held only because every game draws
  with primitives. Adding an asset means adding the licence entry and, very likely, an ADR.
- One typeface for the whole engine. A game that wants a display face has to make the case
  for a second family on the interface, not set `ctx.font` itself.
- A future WebGL backend must implement the same `Renderer` interface, including the
  rotation stack, the logical-unit contract and the `'centre'` spelling, and pass the same
  recording-fake tests. It changes no game.
- Rule 5 applies inside the renderer. `text` caches its font strings per size because
  building one per call allocates, and `measureText` is deliberately kept off the
  interface: the browser allocates a `TextMetrics` per call, so it is a layout-time
  question, not a per-frame one.
- The host draws its own chrome on the same context, so `text` sets baseline and alignment
  on every call rather than assuming state survives between draws.
- The cost is the ceiling. Canvas2D has no batching and no shaders; a game that needs
  thousands of bodies or a full-screen effect will be the game that forces the WebGL
  backend, and this record should be superseded when it does.
