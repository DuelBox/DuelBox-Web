# The pointer idiom, per archetype

`docs/input-design.md` decides how a piece of hardware becomes a seat. This decides what a
gesture *means* once it has one.

They are separate questions with separate lifetimes. The first is settled and has barely
moved since it was written; the second churns every time a game ships, and the audit at
the end of this document is a list that will shrink. Folding that list into
`input-design.md` would bury the decision table other documents cite. So: a second file,
and `input-design.md` stays the shorter, more stable one.

Nothing here restates `docs/input-parity.md` (which family is advantaged, and what the
engine does about it), `docs/presentation.md` (what shared-screen and single-seat change),
or `docs/play-configurations.md` (which configurations an archetype supports). Where those
already settle something it is cited rather than re-argued.

## The vocabulary, as it actually is

Five archetypes, in `ARCHETYPES` in `packages/game-sdk/src/manifest.ts`, across 79 built
games:

| Archetype | Games | `zoneSplit` declared | Pointer bindings actually in use |
|---|---|---|---|
| `rt-split` | 25 | 22 horizontal, 2 vertical, 1 shared-board | absolute follow, chase-the-finger, side-of-half, anchored drag, tap-a-target |
| `turn-board` | 17 | 17 shared-board | tap-to-commit, drag-then-release, hold-then-release |
| `turn-aim` | 17 | 17 shared-board | object-anchored pull, press-anchored drag, fixed-pad, absolute aim, tap-a-meter |
| `rt-arena` | 12 | 10 shared-board, 2 horizontal | anchored drag, chase-the-finger, side-of-half |
| `rt-race` | 8 | 7 horizontal, 1 vertical | absolute lane, chase-the-finger, anchored stick, hold-to-go |

Issue #2426 says "21 aim games". There are 17, and six of those seventeen have no aim in
them at all — they are timing games (tap to stop a moving needle) wearing the `turn-aim`
label. That is the first thing the idiom has to name, because a common idiom that covers
both is either wrong for one of them or so loose it decides nothing.

The full membership:

- **`turn-board`** — backgammon, checkers, color-wars, dots-and-boxes, four-in-a-row,
  ludo, mancala, memory, pop-it, reversi, sea-battle, ship-battle, shut-the-box,
  snakes-ladders, tic-tac-toe, ultimate-ttt, yazy
- **`turn-aim`** — archery, archery-master, basketball, bowling, cannon-duel, carrom,
  cornhole, cup-pong, darts, hammer-hit, knife-thrower, mini-golf, pool, shuriken,
  sling-puck, soccer-pool, sword-throwing
- **`rt-split`** — air-hockey, animal-stack, beach-ball, broken-tiles, chicken-jump,
  crabby-volley, flappy-jump, fruit-duel, gravity-run, hand-slap, happy-birds, hot-potato,
  light-fingers, lumber-jack, math-quiz, mini-soccer, paint-fight, penalty-kicks,
  ping-pong, pull-the-rope, rock-paper-scissors, spike-attacks, star-catcher, tennis,
  whack-a-mole
- **`rt-arena`** — brick-blast, dung-battle, frogs-fight, king-of-the-yard, match, pinball,
  robot-arena, snakes, spin-war, sumo, tanks, wrestle
- **`rt-race`** — crash-it, racing-cars, rat-race, road-dodge, slot-cars, taxi-race,
  traffic-jam, wheelie

## What the primitives can and cannot say

A game reads eight values per seat, through `SeatInputView` in
`packages/engine/src/input-view.ts`, and nothing else:

`move` · `pointer` (null when absent) · `actionPressed` · `actionHeld` · `actionReleased`
· `holdSeconds` · `holdSecondsAtRelease` · `pointerCancelled`

The last two were the first two items on the list at the end of this document, and both
have landed: `holdSecondsAtRelease` under #2475, `pointerCancelled` under #2480.

Every gesture below has to be expressible in those. Three of the five are not, and saying
which is the point of this section.

| Gesture | Expressible today | How, or what is missing |
|---|---|---|
| **press** | Yes | `actionPressed && pointer !== null`. The pointer is guaranteed present on the press step — `pointerLatched` in `input.ts` keeps the coordinates alive for exactly the step that reports the press. |
| **drag** | Yes, with game-side state | `pointer !== null` on subsequent steps. The *origin* is not kept by the engine; every game that needs it stores its own. |
| **release** | Yes, with game-side state | `actionReleased`. **The pointer is already null on that step**, so the last position must have been carried. |
| **tap** | No | There is no tap radius anywhere. A press-and-release that travelled 300 units is indistinguishable from one that travelled none. |
| **cancel** | Yes, as of #2480 | `pointerCancelled`, true for the one step on which the gesture was taken away. `GameHost` calls `InputManager.pointerCancel(id)` from its `pointercancel` listener, and `clear()` raises the same bit for every live pointer. A cancel **suppresses** the release, so the two can never both be true — see below. |
| **hover** | No, and deliberately | `pointerMove` returns immediately for an unowned id, and ownership is only claimed at `pointerDown`. A mouse moving with no button down produces nothing at all. |

### The three facts every game has had to rediscover

These are written in comments in seven different game packages, in seven different
wordings, and each of them was a shipped bug first:

1. **Most taps arrive with press and release on the same step.** Treating the release as
   an `else` branch of the press means only a deliberate hold does anything. Fixed
   separately in tic-tac-toe, four-in-a-row (`game.ts:233–242`) and pop-it (`game.ts:196–210`).
2. **The pointer is gone on the release step.** Asking "is there a pointer now" to decide
   whether a throw was aimed with a finger takes the keyboard branch and the throw never
   happens. Fixed separately in darts, shuriken and sword-throwing, each with a private
   `#pointerAiming` flag carrying the same one bit.
3. **`holdSeconds` is zero on the release step.** `#applySeat` sets it to `0` whenever the
   action is not held, and `input.test.ts:221` asserts it. Any "release after holding for
   *t*" rule must accumulate *t* itself. mini-golf says so in a comment at `game.ts:234`;
   sea-battle did not, and its long-press is dead code (see the audit).

One mechanism, three symptoms, ten private fields named `#dragging`, `#armed`,
`#pointerAiming`, `#anchorFromPointer`, `#dragOrigin`, `#pointerDown`, `#pointerLane`,
`stick.down`, `#held`, `runtime.held`. That is the case for putting it in one place.

## The four gestures, defined once

These definitions are archetype-independent. What differs per archetype is which of them
a game is allowed to bind, and to what.

**Press.** The step on which `actionPressed` is true *and* `pointer` is non-null. It marks
a point. It is **provisional** for anything continuous and **committing** only for a
discrete, drawn, labelled target — see the per-archetype rules.

**Drag.** Every subsequent step with `pointer` non-null. Two readings, and a game picks
one and says which in its SPEC:

- *Anchored* — the displacement from the press point. Use where the thing being driven is
  not under the finger, or where the finger is in a zone that cannot reach it.
- *Absolute* — the point itself, in seat space via `toWorld`. Use only where every point
  the player may want to name is inside that seat's own pointer zone.

Mixing them inside one game is the divergence, not either one on its own.

**Release.** `actionReleased`. It commits whatever the drag proposed, using values the
game carried — never values re-read from `pointer` or `holdSeconds`, both of which are
gone by then.

**Tap.** A press and a release whose drag never left **two precision envelopes** of the
press point — `2 × envelopeFor(logical)`, which is `min(w, h) / 100`. Expressed in
envelopes rather than units so it means the same on a 600-unit box and a 1080-unit one,
and so it can never be finer than the lattice the position was quantised onto.

**Cancel.** A gesture that **abandons**: it ends, and it commits nothing. Three sources,
and the engine now distinguishes the first two from a release:

- the browser cancelling (`pointercancel`: a system gesture, palm rejection, the page
  losing the pointer) — `pointerCancelled`
- the shell pausing or the window losing focus, which calls `InputManager.clear()` —
  also `pointerCancelled`, raised for every pointer that was live at the clear
- the player deliberately aborting — dragging back inside the deadzone and lifting. Still
  the game's own business, because only the game knows where its deadzone is; exactly one
  game implements it (cornhole).

**A cancel is not a release, and the engine enforces that rather than asking games to
remember it.** `pointercancel` was wired straight to `pointerUp` until #2480, so every one
of these arrived as an ordinary `actionReleased` — and every drag-and-release aim game
commits on `actionReleased`. A `pointercancel` during an aim drag in pool, mini-golf,
soccer-pool, bowling or carrom therefore released the stroke the player was still setting
up: the player did not get their aim cancelled, they got a shot they never took, at
whatever the aim happened to be. On a phone, where the edge swipe is how you leave an app,
that is not an edge case.

The fix is one line in `#applySeat`: a cancelled step raises `pointerCancelled` and
suppresses `actionReleased`, on that step and on every later one — the release does not
arrive a step late instead. So the shot stops being fired in all 107 games without a line
of game code changing, and `actionReleased` now means *the player let go* and nothing
else. The pointer is null on the cancel step, and a press that had not been read yet is
dropped with the rest of the gesture, so a tap-to-commit board does not play the move the
browser has just disowned.

What is still per game is the second half: **abandoning the aim the game is carrying.** A
game that keeps `#dragOrigin`, `#power`, `#pointerAiming` or a draw count must clear it on
`pointerCancelled`, or the aim stays armed and is committed by whatever release comes
next. The audit below names every game that needs it; none of them has it yet, and until
they do the engine's guarantee is the narrower one: no shot is fired *at the moment of the
cancellation*.

**Hover does not exist, and must not.** Touch has no hover; a game that used one would
either branch on device type (rule 10) or show one player information the other cannot
have (rule 9). The engine's silence on hover is correct and this document does not ask for
it. The cost is that a desktop player gets no preview before pressing, and the answer to
that is the provisional-press rule below rather than a hover state.

## Seat binding

One rule, owned by the engine, and no game restates it:

> A pointer belongs to the seat whose zone it went down in, at `pointerDown`, and keeps
> that seat until `pointerUp` however far it travels.

`PointerOwnership` in `packages/engine/src/seat.ts` implements it; `pointerMove` looks the
seat up by id and never re-derives it. Two consequences the idiom depends on:

**A gesture may start only where its seat can reach.** Under a horizontal or vertical
split the press must land in the player's own half. It may then be dragged anywhere,
including across the midline. Every "chase the finger" binding therefore has a hole: if
the thing being chased is currently on the far side, the player cannot press on it. Dung
Battle documents this and words its manifest to match ("start a drag on your own side …
wherever you take it"); Sumo does not, and its manifest tells the player to do something
the split forbids.

**On a turn-based board there are no zones at all.** `GameHost` gives the whole surface to
the seat to move whenever `getActiveSeat()` returns non-null, and restores the two zones
when it returns null. The manifest's `zoneSplit` is *not* what decides this — `GameHost.tsx:146`
says so, and the ten `rt-arena` games declaring `shared-board` get a horizontal split
anyway. The consequence for turn-based games is that **either player's finger drives the
active seat**. That is a deliberate trade recorded in `seat.ts`, and it means a turn-board
game must never treat a stray touch as intent (see the tap-must-be-able-to-miss rule).

## Shared-screen and single-seat

`docs/presentation.md` settles what changes. Only the pointer consequences are here.

| | Shared-screen | Single-seat |
|---|---|---|
| Zones | Split by `zoneSplit`, or the whole surface in a turn game | **The whole viewport is the local seat's** |
| Rotation of the gesture | `toWorld(..., flip.rotated)` for the far seat | `flip.rotated` is always false |
| Reachability | Half the glass, or all of it on your turn | All of it, always |
| Gesture start | Must begin in your own zone | Anywhere |

**This is not what the code does.** `GameHost` computes its split from `getActiveSeat()`
and `manifest.zoneSplit` and never reads `presentation`. In single-seat a real-time game
would still be split in half, with the far half's touches handed to the seat that is not
on this device — so half the screen would be dead. Nothing has hit it yet because
`PlaySurface.tsx:260` mounts `presentation="shared-screen"` and nothing else in the app
sets it. It is latent, not fixed, and it is the first thing that breaks when single-seat is
wired.

**The rule:** in single-seat the split is always `'shared'` and the bottom seat is always
`localSeat`, whatever the manifest says. A game does not participate in this and must not
read `presentation` to compensate.

## Mouse, trackpad, and the common precision envelope

There is one code path for every pointing device. `GameHost` listens to pointer events
only and branches on `pointerType` nowhere; a mouse, a trackpad, a pen and a thumb all
arrive as `pointerDown`/`pointerMove`/`pointerUp` with an id. That is why "does it work
the same on a trackpad" is mostly answered by construction rather than by testing — a
trackpad *is* a mouse to this code, and the only real differences are that a trackpad
re-clutches (so a drag can pause mid-gesture without lifting) and that its smoothing adds
a little latency.

`InputManager.#quantise` rounds every coordinate onto a lattice of `min(w, h) / 200`
before a game sees it, so no device can aim between the points the game asks anyone to
hit. `docs/input-parity.md` covers what that is for.

Three rules follow, and they are what a game must obey to stay inside the envelope:

1. **Bind to position or to displacement, never to pointer velocity.** The envelope caps
   how finely a position can be *named*; it says nothing about how far a pointer can
   travel between two steps. A mouse can cross 400 logical units in one 16ms step and a
   thumb cannot. Any rule of the form "sweep faster for more X" is outside the envelope
   and is a cross-device advantage the engine does not remove. One game does this today
   (shuriken's spin).
2. **Deadzones and tap radii are multiples of the envelope, not bare numbers.** They are
   currently 22 hand-picked constants between 6 and 26 logical units, in boxes between 600
   and 1080 units on the short side — a spread of 2.0 to 5.8 envelopes for what is the
   same intent in every case ("a finger resting on the thing means stop"). Two envelopes
   for a tap radius, four for a drag deadzone, expressed as multiples.
3. **A held finger and a held key are the same signal, and both are rate-limited by the
   simulation.** `actionHeld` is already `keys.action || pointerDown`; a game that adds its
   own per-press rate is re-deciding something the engine decided.

Trackpad-specific: nothing in the idiom may require a gesture longer than about a third of
the play area's short side without an intervening lift, because a trackpad has to
re-clutch and a re-clutch is a `pointerup`. The longest drag any current game asks for is
`DRAG_RANGE = 260` in a 900-unit box (cornhole), which is inside that.

## The cursor, and when the pointer is hidden

**The keyboard cursor.** `GridCursor` in `packages/engine/src/cursor.ts` is the only cursor
concept the engine has. It is invisible until a direction key wakes it, so a player who has
only ever tapped never sees a highlight. Fifteen games use it. Games that need a cursor
over something that is not a grid (dots-and-boxes, mancala, backgammon, rock-paper-scissors,
road-dodge, whack-a-mole) roll their own and each says why in a comment; that is acceptable,
but the visibility rule is not optional — a cursor a touch player did not summon must not
be drawn.

**The mouse cursor.** Nothing in the shell sets `cursor` on the canvas; the only `cursor`
declarations in the app are `cursor: pointer` on buttons. So the arrow sits over the play
area for the whole match.

The rule: **the system cursor is hidden over the play surface while a match is simulating,
and restored the moment it is not** — on pause, on the result screen, and whenever a
pointer is not down during a turn that is not the local player's. Hiding it is safe because
no game requires hover, so there is nothing the arrow is needed to point at; and it is
necessary because in every drag idiom the arrow is a second, lying cursor sitting next to
the reticle the game is actually drawing. This is a shell change (a CSS class on the canvas
driven by match phase), not an engine or game change, and it is not implemented.

## The idiom, per archetype

### `turn-board`

The play surface is one board, it belongs entirely to the seat to move, and every target
is a discrete drawn region.

| Gesture | Meaning |
|---|---|
| **Press** | Commits, if and only if it lands inside a drawn target. A press that hits nothing does nothing at all — it does not fall back on the keyboard cursor, and it does not select the nearest target. |
| **Drag** | Nothing, in the base idiom. |
| **Release** | Nothing, in the base idiom. |
| **Tap** | The whole interaction. |

**The one variation, and it must be declared.** Where a move is chosen from a continuum of
adjacent targets that a finger occludes — a column in four-in-a-row, a run of bubbles in
pop-it — the game may use **drag-then-release**: press arms, drag re-aims, release commits,
and a press that lands off the board arms nothing. A game using this says so in its
manifest's `controls.pointer` and in its SPEC. It is not a free choice per game; it is for
targets a fingertip covers.

**Input is closed while the board turns.** `SeatFlip.acceptsInput` is false for the whole
half-turn, and every turn game gates on it. A tap during the flip names a cell that is
moving.

**Shared-screen** — the board rotates, so every coordinate goes through
`toWorld(..., flip.rotated)` before it names anything. Both players' fingers reach the
whole board and both drive the active seat.
**Single-seat** — `flip.rotated` is always false and the turn indicator carries the cue
that the flip used to. Nothing else changes.

**Mouse and trackpad** — identical. A cell is a cell; there is no continuous value and
therefore nothing for sub-pixel precision to buy. This is the archetype where the mouse's
advantage is genuinely zero rather than merely normalised.

**Cross-device: fair.** Confirmed by `docs/input-parity.md`; nothing here changes it.

### `turn-aim`

Two idioms, not one, and the split is between games that ask *where* and games that ask
*when*. Both are legitimate; conflating them is what produced seventeen games with five
bindings.

#### `turn-aim` / **aim** — the drag-and-release idiom

For archery, archery-master, bowling, carrom, cornhole, darts, mini-golf, pool, shuriken,
soccer-pool, sword-throwing.

| Gesture | Meaning |
|---|---|
| **Press** | Begins the aim. Commits nothing, ever. |
| **Drag** | Sets the aim, continuously, and redraws the reticle. Anchored to the aimed object where the object is inside the active seat's reach, and to a drawn on-screen pad where it is not. |
| **Release** | Fires, using the aim the game carried. |
| **Tap** | Not bound. A press-and-release inside the tap radius sets no aim and must **cancel**, not fire a zero-power shot. |

**The anchor is the aimed object, or a drawn pad, and nothing else.** Anchoring to the
press point (cornhole, bowling's X axis) makes the same drag mean different things
depending on where the finger happened to land, which is exactly the inconsistency the
issue is about. Where the object cannot be dragged from — because it is off in a corner,
or the aim is an angle with no natural handle — the game draws a pad and anchors to the
pad's centre, as darts and both archery games do. The pad is drawn; it is never invisible.

**Power is drag distance, not hold time, whenever a pointer is aiming.** Hold time is the
keyboard's expression of the same thing, and the two must not both be live: `pointer ===
null && actionHeld` is the correct guard and six games already use it.

**Cancel is mandatory here.** Dragging back inside the deadzone and lifting must abandon
the shot. Cornhole is the only game that does this today.

**Shared-screen** — the board rotates; every coordinate through `toWorld`. The pad, where
there is one, is drawn at the active seat's near edge and rotates with the board.
**Single-seat** — no rotation; the pad moves to the local player's near edge (thumb reach),
per `docs/presentation.md`. That is a *placement* change and the only one permitted.

**Mouse and trackpad** — the same gesture. Button down anchors, move drags, button up
fires. The mouse's sub-pixel advantage is removed by the quantiser; what remains is that a
mouse can execute a long drag without re-clutching, which is why the maximum useful drag is
capped at a third of the short side.

**Cross-device: fair**, with one exception the parity doc does not currently carve out —
any rule binding to pointer *velocity* (shuriken's sideways sweep for spin) is not covered
by the envelope and must be re-expressed as a displacement.

#### `turn-aim` / **timing** — the tap-a-meter idiom

For basketball, cannon-duel, cup-pong, hammer-hit, knife-thrower, sling-puck.

| Gesture | Meaning |
|---|---|
| **Press** | Commits: it stops the moving needle. |
| **Drag** | Nothing. |
| **Release** | Nothing. |
| **Tap** | The whole interaction, and a tap anywhere in the active seat's surface counts — there is no target to miss. |

These games have no aim. What they measure is *when* the press landed, and that is the
same interaction `docs/input-parity.md` rules unfair for `rt-race`: a key is lower-latency
and more repeatable than a thumb leaving and returning to glass. The difference is
frequency — one press per turn against several per second — and that is why these are
fair and `rt-race` is not.

**The rule that follows:** a timing game may ask for at most one committing press per
turn, and the meter's period must be at least 1.2s so that a 30ms latency difference is
under 3% of the window. No current game is close to violating this, but it is the
constraint that keeps them fair and it was never written down.

**Cross-device: fair**, on that condition. If a timing game ever wants repeated presses, it
becomes `rt-race` and declares `sameInputClassOnly`.

### `rt-split`

Both seats act at once; each owns a zone; the two halves are usually mirror images.

| Gesture | Meaning |
|---|---|
| **Press** | Begins control, and is *also* the action edge where the game has a discrete action (a jump, a flap, a swing). |
| **Drag** | Steers, continuously. |
| **Release** | Ends control. Commits nothing. |
| **Tap** | Where the game has both movement and a discrete action, a tap is the action and a drag is the movement, separated by the tap radius. |

**The binding is absolute within the seat's own zone.** A horizontal split gives each seat
a full-width band, so every point that seat may want to name is under its own thumb —
star-catcher and rat-race both say exactly this in comments, and both are right. Absolute
is the correct default for `rt-split` and anchored drag is the exception, permitted only
under a **vertical** split where a seat's band is tall and narrow and an absolute Y would
be unreachable.

**Chase-the-finger is absolute, and must be honest about the deadzone.** Where the pointer
names a *target* the thing walks towards rather than a position it snaps to, the walk is
rate-limited by the simulation (`driveNet`, `movePlayer`, `steer`) so a finger cannot move
anything faster than a key can. Inside the deadzone the answer is zero, not "keep the last
direction" — otherwise a resting thumb is a held key.

**Shared-screen** — the far seat's half is upside down, and its zone's coordinates must be
mirrored into that seat's own frame before they mean anything. Games do this with a
per-game `toField`/`acrossOfWorld`/`mirror` helper rather than `toWorld`, because only the
seat's own band flips, not the whole box. That is correct and should stay per-game, but the
mirroring must be one function per game and not repeated at each call site.

**Single-seat** — the local seat's band fills the viewport; the opponent's is drawn and not
reachable (`docs/presentation.md`). The absolute binding still applies, to the whole
viewport.

**The mirror applies to `move` as well as to `pointer`.** A far seat pressing its own left
arrow means the device's right. whack-a-mole, road-dodge, lumber-jack, gravity-run,
animal-stack and rat-race all negate their axes for the rotated seat; pinball does not, on
either input family, which is the one place in the catalogue where the far player's
controls are reversed.

**Mouse and trackpad** — identical, with one caveat: an absolute binding means the pointer
must be *down* to steer, so a mouse player steers by holding the button for the whole
rally. That is the correct trade — the alternative is hover, which touch cannot have.

**Cross-device: fair.** `docs/input-parity.md` rules that the touch advantage (absolute
positioning) and the mouse advantage (precision) offset, and flags the claim as unverified.
Nothing here strengthens or weakens it.

### `rt-arena`

Both seats act at once in **one shared space**, and that is what separates it from
`rt-split`: the thing you are driving can be anywhere, including in the other seat's zone.

| Gesture | Meaning |
|---|---|
| **Press** | Anchors a virtual stick at the press point. |
| **Drag** | The displacement from the anchor is the direction, normalised, with magnitude beyond the deadzone meaning "full". |
| **Release** | Stops. The anchor is dropped. |
| **Tap** | Not bound to movement. Where the game has a discrete action it is `actionPressed`, and it is the only thing `actionPressed` means. |

**Anchored drag is the idiom for `rt-arena`, and absolute is wrong here.** This is the one
place where the two bindings genuinely conflict rather than merely differing. The surface
is split (a `shared-board` declaration does not change that — see Seat binding), so a press
must start in the player's own half; but the driven object can be in the far half. Under an
absolute binding the player then has to press somewhere they do not mean, drag to the
object, and only then start steering. Under an anchored binding they press anywhere in
their half and pull. Four `rt-arena` games already do this — frogs-fight, robot-arena,
snakes, tanks — and two `rt-split` games use the same `#dragOrigin` code where the
absolute binding would have served (broken-tiles, paint-fight; see the audit). Six copies
of one mechanism.

**Shared-screen and single-seat** — an anchored drag is a displacement, and displacements
do not need `toWorld`; they need the seat's own axes. The far seat's drag is negated in
both components. This is why the anchored binding is also the one that survives the
presentation change unchanged.

**Mouse and trackpad** — identical, and better than absolute here: a virtual stick is
exactly what a trackpad's short throws suit, and re-clutching re-anchors, which is the
correct behaviour rather than a glitch.

**Cross-device: fair.** No absolute aiming and rate-based movement, per
`docs/input-parity.md`.

### `rt-race`

Parallel lanes, no shared space, and the interaction is a discrete change repeated under
time pressure.

| Gesture | Meaning |
|---|---|
| **Press** | Names a lane, or begins a hold. |
| **Drag** | Re-names the lane; **latched**, so a drag across three lanes is three changes and not sixty. |
| **Release** | Ends the hold. |
| **Tap** | A lane change. |

**Cross-device: same-input-class only — for the games whose interaction is a repeated
discrete change, and not for the archetype.** `docs/input-parity.md` rules the whole
archetype unfair; the catalogue disagrees with it in practice, and the catalogue is right.
One of eight games declares `sameInputClassOnly` (road-dodge, one lane change per press).
Three others argue in manifest comments that their steering asks for a *place* rather than
a press, so both instruments arrive at the same `STEER_SPEED` and there is nothing to
repeat faster — racing-cars, taxi-race, traffic-jam. That reasoning is correct and should
be promoted out of three manifest comments into the parity doc's ruling:

> The unfair interaction is **rapid repeated discrete input**, not the `rt-race` archetype.
> A game declares `sameInputClassOnly` when winning requires more than about two
> committing presses per second. Holding, steering towards a place, and choosing a lane by
> position are all fair.

By that test: road-dodge unfair (declared); slot-cars, rat-race, wheelie fair (holds and
absolute positions); racing-cars, taxi-race, traffic-jam fair (argued); crash-it
**undetermined** — its jump is one press each, undeclared and unargued.

**Shared-screen** — two lanes side by side or stacked, each seat's own band mirrored into
its own frame.
**Single-seat** — `rt-race` is the one archetype that defaults to single-seat
(`docs/presentation.md`), and its lanes are already independent, so nothing changes but the
placement.

**Mouse and trackpad** — identical. Note that a latched lane binding is what makes the
mouse *not* better here: without the latch, a mouse dragging across a lane boundary
delivers a change every step.

## What the engine is missing

The idiom above cannot be implemented from `SeatInputView` as it stands. Six additions,
smallest first. None of them changes what a game already reads.

1. ~~**`pointerCancelled`**~~ — **done (#2480).** True for exactly one step when a gesture
   ended without a deliberate lift. `GameHost` calls `InputManager.pointerCancel(id)` from
   the `pointercancel` listener instead of `pointerUp`, `clear()` raises it for every
   pointer that was live, and a cancelled step suppresses `actionReleased`. The remaining
   work is per game — reading the bit and dropping the carried aim — and is listed in the
   audit.
2. **`pointerStartX` / `pointerStartY`** — where the live gesture went down, in the same
   logical frame as `pointerX`/`pointerY`, held until the gesture ends. Replaces
   `#dragOrigin` in six games, `#dragging`/`#dragX` in two, and `stick.originX` in one, and
   removes the only per-press allocation in any game's `update()`.
3. **`pointerEndX` / `pointerEndY`, valid on the release step** — the last position of the
   gesture that just ended. Replaces `#pointerAiming` in three games, `#armed` in
   four-in-a-row, `#anchorFromPointer` in pop-it, and closes fact 2 above permanently.
4. ~~**`heldSeconds` on the release step**~~ — **done (#2475),** as
   `holdSecondsAtRelease`: the total, valid on the release step and zero everywhere else.
   `holdSeconds` keeps its old meaning, so nothing that read it changed. Sea Battle's
   long-press works now; the games counting the hold by hand can drop their private
   fields.
5. **`wasTap`** — true on the release step when the gesture stayed within
   `2 × envelopeFor(logical)`. One definition, so a tap means the same thing in 79 games.
6. **Presentation-aware zoning** — `GameHost` must force `split: 'shared'` and
   `bottomSeat: localSeat` whenever `presentation === 'single-seat'`, and
   `apps/web/src/data/input-fuzz.ts` must derive its split the same way `GameHost` does
   (from `getActiveSeat()`, not from `manifest.zoneSplit`) or the storm exercises splits
   the shell never uses.

Of the four left, 6 is a correctness fix with no idiom attached and should not wait for the
rest.

## The audit

Every game measured against the idiom above. A game not listed conforms.

### `turn-board` — 6 of 17 diverge

| Game | Divergence | Fix |
|---|---|---|
| **backgammon** | `#nearestMove()` never misses: a press anywhere on the board selects the nearest legal move and the same step commits it. A stray touch by the *other* player — who also owns the surface on a turn board — plays a move. | Return -1 beyond a radius; a press that misses does nothing. |
| **snakes-ladders** | Same shape: `#dieFor()` falls back to nearest-by-distance and always returns a valid die, so a press anywhere commits a choice. | As above. |
| **four-in-a-row** | Drag-then-release, with a private `#armed` and a second commit path on `actionPressed` for the keyboard. Legal under the declared variation, but improvised. | Declare the variation in SPEC; move `#armed` onto `pointerEndX/Y` + `wasTap` once they exist. |
| **pop-it** | Same variation, different implementation, private `#anchorFromPointer` and `#anchorRow`. | As above; the two should share one shape. |
| **sea-battle** | `game.ts:189` — `actionReleased && holdSeconds > 0.4` is **dead code**. `holdSeconds` is zero on the release step. The keyboard long-press that rotates a ship has never fired. `game.test.ts` supplies a hand-built input record with `holdSeconds` set, so nothing catches it. | Accumulate the hold in the game until item 4 lands; fix the test to drive `InputManager` rather than a literal. |
| **sea-battle** | Two coordinate conventions in one game: `toWorld(..., false)` during placement, `toWorld(..., this.#flip.rotated)` during firing. Correct today only because placement never rotates. | One helper, one convention, gated on the phase. |
| **ship-battle** | Commits on `actionReleased` gated by `#phaseSteps >= ARM_SECONDS` — the `turn-aim` charge idiom on a `turn-board` game, and its manifest's pointer line ("Drag to aim, lift to fire") describes `turn-aim` too. | Decide whether it is `turn-aim`; if it stays `turn-board`, it needs a declared third variation or a rebind to tap-to-commit. |
| **memory, ludo, shut-the-box, yazy, tic-tac-toe, checkers, color-wars, reversi, ultimate-ttt, mancala, dots-and-boxes** | Conform. | — |

### `turn-aim` — 11 of 17 diverge

| Game | Divergence | Fix |
|---|---|---|
| **cornhole** | Press-anchored drag (`#dragging`, `#dragX/#dragY`) rather than object- or pad-anchored, so the same drag means different things depending on where the finger landed. The *only* game that implements cancel correctly. | Re-anchor to the bag; keep the cancel and make it the pattern. |
| **bowling** | Half press-anchored (X, via `#dragging`/`#dragX`) and half absolute (Y, from `FOUL_LINE_Y`). Two anchors in one gesture. | Anchor both axes to the ball. |
| **pool, mini-golf, soccer-pool, carrom** | Object-anchored, which is right, but **no cancel**: `actionReleased` commits whatever power was last set, and dragging back inside `PULL_DEADZONE` leaves the previous value standing rather than clearing it. A `pointercancel` fires the shot. | Zero the power inside the deadzone; abandon on `pointerCancelled`. |
| **darts** | Pad-anchored, correct; carries `#pointerAiming` by hand; no cancel. | Cancel; drop the flag once item 3 lands. |
| **archery, archery-master** | Pad-anchored, correct; count `#drawSteps` by hand because `holdSeconds` cannot be read at the release; no cancel. `onPause` has bespoke code to un-draw a bow that never got its release. | Cancel; item 1 makes the pause path uniform. |
| **shuriken** | Spin bound to **pointer velocity** — `addSpin((x - #lastPointerX) * SPIN_PER_UNIT)`, a per-step delta. Outside the precision envelope: a mouse can travel further per step than a thumb, and quantising position does not touch it. Also carries `#pointerDown` and `#pointerAiming`. | Bind spin to total sideways displacement over the gesture, not to per-step delta. |
| **sword-throwing** | Absolute-from-centre aim rather than object- or pad-anchored, and the parry in the same gesture; `#pointerAiming` by hand. | Pad-anchor the aim; declare the parry as a second bound gesture. |
| **basketball, cannon-duel, cup-pong, hammer-hit, knife-thrower, sling-puck** | Timing games in the `turn-aim` archetype. Not a bug — but nothing declares the meter-period constraint that keeps them fair, and nothing tests it. | Record the sub-idiom in each SPEC; add the period assertion. |

### `rt-split` — 10 of 25 diverge

| Game | Divergence | Fix |
|---|---|---|
| **broken-tiles** | Anchored drag under a **horizontal** split, where absolute is the default and reaches everything. Allocates a `vec2()` inside `update()` on each press. | Either rebind to absolute, or declare why anchored is needed here and take `pointerStartX/Y` when it lands. |
| **paint-fight** | Same: anchored drag, horizontal split, `vec2()` per press. | As above. |
| **mini-soccer** | Chase-the-finger passing the **raw gap** into `drive`, which normalises internally. Works, but the pointer and keyboard paths hand the same function two different magnitude conventions. | Normalise at the read, as beach-ball and tennis do. |
| **whack-a-mole** | Declares `zoneSplit: 'shared-board'` and gets a horizontal split, because `GameHost` decides from `getActiveSeat()`. `GameHost.tsx:148` names this game as the reason the rule exists. The manifest field is actively misleading. | Change the field to `horizontal`, or make the schema reject `shared-board` on a real-time archetype. |
| **crabby-volley, light-fingers, hand-slap, hot-potato** | Each re-derives the press edge as `down = actionHeld \|\| actionPressed` plus a private `held` field, because `actionPressed` alone was thought to miss same-step taps. It does not — `actionLatched` covers that — so this is four copies of a workaround for a bug the engine already fixed. | Read `actionPressed`. |
| **tennis** | Manifest says "every fresh press is a jump for a high ball" and the code binds the jump to `actionPressed`, which a *steering* press also raises. Steering and jumping share one edge, so beginning to move is also a jump. | Separate them with the tap radius once `wasTap` lands. |
| **animal-stack** | Three gestures through one hand-rolled `gripStep` state machine taking press, held and released. The most complete implementation of the idiom in the repo and the strongest argument for putting it in the SDK. | Port to the SDK gesture once items 2–5 land. |

### `rt-arena` — 6 of 12 diverge

| Game | Divergence | Fix |
|---|---|---|
| **sumo** | Absolute chase-the-finger, but the manifest says "Drag from your wrestler in the direction you want to push" — a relative gesture. The two are opposites, and the manifest's version is the one the archetype calls for. Worse, the wrestler can be in the far half, where the player cannot press at all. | Rebind to anchored drag. |
| **spin-war** | Same absolute chase, same reachability hole ("start on your own side … wherever you take it" is at least honest about it). | Rebind to anchored drag. |
| **dung-battle** | Same absolute chase. Alone among the three it documents the split and the reachability consequence fully in its SPEC and tests the cross-midline drag. | Rebind to anchored drag; keep the SPEC section, which is the model. |
| **king-of-the-yard** | Absolute chase with a raw un-normalised gap; manifest says "Drag anywhere to run that way" — both the "anywhere" (zones) and the "that way" (direction, not position) are wrong. | Rebind to anchored drag; rewrite the pointer line. |
| **wrestle** | Absolute lean from the wrestler's X, plus `actionPressed` as the leap — so beginning to lean is also a leap, same collision as tennis. | Anchored lean; separate the leap with the tap radius. |
| **pinball** | Two faults. It is really two buttons rather than the arena idiom, and the two touch halves are not drawn — only the flippers are. And `wantsFlipper` (`rules.ts:451`) reads **device** X (`pointerX < CENTRE_X`) and device `moveX` for *both* seats, while `flipperIndex`'s sides are screen-relative ("+1 for the screen-left flipper"). The far seat reads the device upside down, so its own left lifts the flipper on its right — on the pointer and on the keyboard alike — and the manifest promises "the left half lifts **your** left flipper". | Mirror the far seat's axes as every other mirrored game does; draw the two halves; declare the button sub-idiom. |
| **brick-blast, match, frogs-fight, robot-arena, snakes, tanks** | Conform (the last four are the anchored-drag reference implementations). | — |
| **All ten `shared-board` `rt-arena` games** | Declare a `zoneSplit` the shell ignores. | Same fix as whack-a-mole: correct the field or make the schema reject the combination. |

### `rt-race` — 4 of 8 diverge

| Game | Divergence | Fix |
|---|---|---|
| **crash-it** | One jump per `actionPressed` with no rate ceiling, undeclared and unargued, in the archetype the parity doc rules unfair. Either it is fair and should say why, as its three siblings do, or it is `sameInputClassOnly`. | Measure the presses-per-second a competitive match needs; declare accordingly. |
| **traffic-jam** | A virtual stick (`stick.down`/`originX`/`originY`) implemented in `rules.ts` — a seventh copy of the anchored-drag mechanism, under a seventh name. | Use `pointerStartX/Y` when it lands. |
| **taxi-race** | The hop is a ratchet over the finger's Y, described in a 12-line comment. It is positional and therefore inside the envelope, but it is a bespoke gesture no other game has and nothing shared defines. | Either promote the ratchet to the SDK or re-express as a tap. |
| **wheelie** | Absolute Y for lean is correct; the keyboard branch *holds* the lean on release while the pointer branch does not, so the two instruments have different release semantics. | Make the pointer hold too, or the keyboard not. |
| **racing-cars, rat-race, road-dodge, slot-cars** | Conform. | — |

### Cross-cutting, not per game

| Item | Where |
|---|---|
| ~~`pointercancel` fires the shot in every drag-and-release game~~ — fixed in #2480; what is left is per game, in the audit above | `GameHost.tsx`, `packages/engine/src/input.ts` |
| Single-seat still splits the pointer surface | `GameHost.tsx:154–160`, `:333–334` |
| The fuzz harness and the shell disagree about the split for the 11 real-time `shared-board` games | `input-fuzz.ts:50` vs `GameHost.tsx:155` |
| The system cursor is never hidden during a match | no `cursor` rule on the canvas anywhere |
| 22 hand-picked deadzone constants, 2.0 to 5.8 envelopes for one intent | listed above |
| `docs/input-parity.md` rules `rt-race` unfair by archetype; the catalogue rules by interaction | `input-parity.md`, per-archetype verdict table |

## What is verified, and what is not

**Verified.** That both instruments can move every game, and that neither wins at a
materially different rate — `apps/web/src/data/control-parity.test.ts`, 14 seeds per
instrument per game, reported in the second half of `docs/input-parity.md`. That the
pointer path survives an illegal event storm — `input-fuzz.ts`.

**Not verified: anything on a trackpad.** Issue #2426's fourth action item cannot be closed
by reasoning. A trackpad reaches this code as an ordinary pointer, which is why the idiom
*should* be identical, but "should" is not a measurement and the two real differences —
re-clutching mid-drag, and smoothing latency — are exactly the ones a synthetic pointer
script does not reproduce. What is needed is a Playwright spec that lifts and re-presses
mid-drag in one game per archetype and asserts the gesture survives it. That is the honest
form of the acceptance criterion.

**Not verified: any of this across two devices.** Same gap `docs/input-parity.md` records;
#1862's harness does not exist yet.
