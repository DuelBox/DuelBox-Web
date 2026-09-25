# The pointer idiom, per archetype

Deciding what a mouse, a trackpad, a pen or a thumb does in each kind of game **once** is
what makes twenty-one aim games behave one way instead of twenty-one slightly different
ways (#2426). This document is the canonical, compact statement of that idiom per
archetype, and an honest tally of how far the catalogue already follows it.

> **Relationship to `docs/input-idiom.md`.** That document is the long form: the vocabulary,
> the four gestures defined once, the seat-binding rules, and the full **per-game** audit with
> a fix noted for every divergence. This one is the short form a game author reads before
> binding a pointer — the idiom tables, the cursor rule, and the divergence counts — and it
> points back there for the per-game detail. Where the two ever disagree, `input-idiom.md`'s
> per-game audit is the authority; keep them in step.

There is **one pointer code path for every pointing device.** `GameHost` listens to pointer
events only and branches on `pointerType` nowhere, so a mouse, a trackpad, a pen and a thumb
all arrive as `pointerDown` / `pointerMove` / `pointerUp` with an id. "Does it work the same
on a trackpad" is therefore mostly answered by construction — a trackpad *is* a mouse to this
code — with two real differences to keep in mind: a trackpad re-clutches (a drag can pause
mid-gesture without lifting) and its smoothing adds a little latency. Neither changes the
idiom; both are why the trackpad claim still needs a real test (see the open items).

The engine quantises every pointer position onto a lattice of `min(w, h) / 200` before a game
sees it (`InputManager.#quantise`), so no device can aim between the points the game asks
anyone to hit. `docs/input-parity.md` covers what that envelope is for.

## The five gestures, and cancel

Every idiom below is written in the vocabulary defined once in `docs/input-idiom.md`:

- **Hover** — a pointer moving with no button down. Available to mouse, trackpad and pen;
  **touch has none**, so no idiom may *require* hover to reach a target.
- **Press** — the step `actionPressed` is true and `pointer` is non-null. Marks a point.
- **Drag** — every later step with `pointer` non-null. *Anchored* (displacement from the press
  point or an object) or *absolute* (the point itself); a game picks one and says which.
- **Release** — `actionReleased`. Commits what the drag proposed, using values the game
  **carried** — never re-read from `pointer` or `holdSeconds`, both gone by the release step.
- **Tap** — a press and release staying within `2 × envelopeFor(logical)` of the press point.
- **Cancel** — a gesture that **abandons** and commits nothing: a `pointercancel`, a pause/lost
  focus (`InputManager.clear`), or a deliberate return to the deadzone. The engine raises
  `pointerCancelled` and suppresses the release for the first two (#2480); the third is the
  game's own business.

**Drag can always be cancelled without committing** — the third acceptance criterion — and it
is mandatory wherever a release fires a shot (see `turn-aim` / aim). The shared
`DragAim`/`PressGesture`/`HoldToAct` recognisers in `@duelbox/game-sdk` (`gesture.ts`)
implement all of this once so a game does not re-derive it.

## The idiom, per archetype

### `turn-board`

One board, owned entirely by the seat to move; every target is a discrete drawn region.

| Gesture | Meaning |
|---|---|
| Hover | Optional highlight of the target under the cursor; never required. |
| Press | Commits **iff** it lands inside a drawn target. A press that hits nothing does nothing. |
| Drag / Release | Nothing, in the base idiom. |
| Tap | The whole interaction. |

One declared variation: where a move is chosen from a continuum of adjacent targets a finger
occludes (a four-in-a-row column, a pop-it run), **drag-then-release** — press arms, drag
re-aims, release commits. Declared in `controls.pointer` and the SPEC; not a free per-game
choice. Input is closed while the board turns (`SeatFlip.acceptsInput`). **Mouse advantage
here is genuinely zero** — a cell is a cell.

### `turn-aim`

Two idioms, split between games that ask *where* and games that ask *when*.

**aim — drag-and-release** (archery, archery-master, bowling, carrom, cornhole, darts,
mini-golf, pool, shuriken, soccer-pool, sword-throwing):

| Gesture | Meaning |
|---|---|
| Press | Begins the aim. Commits nothing, ever. |
| Drag | Sets aim + power continuously; redraws the reticle. Anchored to the aimed object, or to a drawn on-screen pad where the object is out of reach — never to the bare press point. |
| Release | Fires, using the carried aim. |
| Tap / short release | **Cancels** — a zero-power shot must never fire. Cancel is mandatory. |

Power is drag distance, not hold time, whenever a pointer is aiming (`pointer === null &&
actionHeld` guards the keyboard's hold path). This is exactly `DragAim`.

**timing — tap-a-meter** (basketball, cannon-duel, cup-pong, hammer-hit, knife-thrower,
sling-puck): press commits by stopping a moving needle; drag/release unused; a tap anywhere in
the seat's surface counts. Fair on one condition — at most one committing press per turn and a
meter period ≥ 1.2 s, so a 30 ms latency gap is under 3% of the window.

### `rt-split`

Both seats act at once, each owning a zone, usually mirror images.

| Gesture | Meaning |
|---|---|
| Press | Begins control, and is the action edge where the game has a discrete action. |
| Drag | Steers continuously. **Absolute** within the seat's own zone is the default (every point is under the seat's own thumb); anchored drag only under a tall-narrow vertical split. |
| Release | Ends control; commits nothing. |
| Tap | The discrete action, separated from steering by the tap radius. |

Chase-the-finger is absolute and rate-limited by the simulation; inside the deadzone the
answer is **zero**, not "hold the last direction", or a resting thumb is a held key. The far
seat's axes (and `move`) are mirrored into its own frame.

### `rt-arena`

Both seats act at once in **one shared space**; the driven object can be anywhere.

| Gesture | Meaning |
|---|---|
| Press | Anchors a virtual stick at the press point. |
| Drag | Displacement from the anchor = direction (normalised), magnitude past the deadzone = full. |
| Release | Stops; drops the anchor. |
| Tap | Not movement; a discrete action is `actionPressed` and nothing else. |

**Anchored drag is the idiom here and absolute is wrong**: the surface is split so a press must
start in the player's own half, but the object may be in the far half. A virtual stick suits a
trackpad's short throws, and re-clutching re-anchors — correct behaviour, not a glitch.

### `rt-race`

Parallel lanes, no shared space, a discrete change repeated under time pressure.

| Gesture | Meaning |
|---|---|
| Press | Names a lane, or begins a hold. |
| Drag | Re-names the lane, **latched** — a drag across three lanes is three changes, not sixty. |
| Release | Ends the hold. |
| Tap | A lane change. |

The latch is what keeps the mouse from being better here. **Same-input-class only** applies to
the *interaction* (rapid repeated discrete input: > ~2 committing presses/second), not the
archetype: holding, steering toward a place, and choosing a lane by position are all fair.

## The cursor, during play

**Decision (#2426):** during active play, a game that draws its own reticle or aims with the
pointer should **hide the system cursor** over the play surface (`canvas { cursor: none }`
while `phase` is `playing`), and restore it on pause, menu and result so the shell's own
controls stay usable. A `turn-board` game that only taps discrete targets keeps the cursor —
there is nothing drawn under it to replace. This is currently **unimplemented**: there is no
`cursor` rule on the canvas anywhere (`input-idiom.md` records the same gap). It is a small CSS
+ phase change in `PlaySurface`/`GameHost`, tracked as a follow-up rather than smuggled in
unverified.

## The audit — 37 of 79 games diverge, and that is a follow-up, not a conversion

`docs/input-idiom.md` measured every game against the idiom above. The tally:

| Archetype | Games | Diverge | The shape of the divergence |
|---|---|---|---|
| `turn-board` | 17 | **6** | nearest-move fallbacks that commit on any press; improvised drag-then-release; one dead long-press |
| `turn-aim` | 17 | **11** | press-anchored instead of object/pad-anchored; **no cancel**; one spin bound to pointer *velocity* (outside the envelope) |
| `rt-split` | 25 | **10** | anchored drag where absolute reaches everything; four copies of an `actionPressed` workaround for a bug already fixed |
| `rt-arena` | 12 | **6** | absolute chase-the-finger where anchored drag is the idiom; one seat's axes not mirrored |
| `rt-race` | 8 | **4** | one undeclared jump; bespoke ratchets; a keyboard/pointer release-semantics mismatch |
| **Total** | **79** | **37** | — |

**The acceptance criterion "every archetype has a documented pointer idiom used by all its
games" is met on the first half and deliberately not forced on the second.** Converting 37
games by hand — several of which also want the not-yet-built engine additions
(`pointerStartX/Y`, `pointerEndX/Y`, `wasTap`) that `input-idiom.md` lists — is a large,
per-game, individually-tested effort with real regression risk across a green catalogue of
107 games. Forcing it in one pass is exactly the kind of wide unverified change this project's
history warns against. So:

- The idiom is **documented and canonical** (this file), and the shared `gesture.ts`
  recognisers now exist for games to converge onto.
- The 42 conforming games are the reference.
- The 37 divergences are **itemised with a fix each** in `input-idiom.md`'s per-game audit, to
  be closed game-by-game as each is touched — not en masse.

## Open verification items

1. **Trackpad parity is asserted by construction, not measured.** A trackpad reaches this code
   as an ordinary pointer, so the idiom *should* be identical — but re-clutching mid-drag and
   smoothing latency are precisely what a synthetic pointer script does not reproduce. The
   honest form of the criterion is a Playwright spec that lifts and re-presses mid-drag in one
   game per archetype and asserts the gesture survives. Not yet written.
2. **The system cursor is never hidden during a match** — the decision above is unimplemented.
3. **Cross-device parity of any of this is unverified** — the same gap `docs/input-parity.md`
   records; #1862's harness does not exist yet.
