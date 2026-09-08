# Orientation, and what a game may say about it

Two people share one device, and one of them turns it over mid-rally. This is what happens
then, why, and which parts of it are built.

`docs/responsive.md` is the neighbouring document and the one to read first: it settles that
the canvas letterboxes a fixed logical box and that the shell is a normal responsive layout.
This one settles the single question that document leaves open — whether a game may be given
a *different* logical box depending on which way the device is being held.

## Rule 8 decides the shape of the whole problem

Issue #1886 asks for four things: a game declaring its preferred and supported orientations;
re-layout rather than letterbox where it supports both; a non-blocking rotate prompt where it
supports only one; and never losing match state across an orientation change.

The second of those cannot mean what it sounds like it means. A game never sees a pixel — it
simulates in fixed logical units and the renderer alone knows the device (CLAUDE.md rule 8) —
and no game may branch on the device at all (rule 10). So "re-layout" cannot be a game reading
the viewport and arranging itself. There is exactly one lever available:

> **The logical size a game is given can differ by orientation, and the game lays out from
> that.**

Everything below follows from that sentence. It also explains why the third and fourth items
are in tension with the second, and how the tension is resolved.

## Three parts, in three places

| Question | Answered by | Lives in |
|---|---|---|
| Which way round is this screen? | `screenOrientation(w, h)` | `packages/engine/src/viewport.ts` |
| Which way round does this game want to be? | `orientation`, `alternateLogical` | `packages/game-sdk/src/manifest.ts` |
| Which box does *this match* use, and do we say anything to the player? | `logicalForOrientation`, `rotateHintFor` | `packages/game-sdk/src/manifest.ts` |

The split is the same one the rest of the engine already uses. Pixels become words in the
render layer and nowhere else; the manifest declares; the SDK decides. A game participates in
none of it, which is what keeps rule 10 true by construction rather than by discipline.

`screenOrientation` is worth one note. A game cannot misuse it even though it can import it,
because a game is handed a `LogicalSize` and never a screen size — it has no pixels to pass
in, and feeding it the logical box answers a question about the box, which is a constant of
the match and identical on every device. It also returns `null` rather than an answer while a
screen has no shape: a rotation is not instantaneous, mobile browsers report a zero-height
frame in the middle of one, and a function that had to answer anyway would flap between the
two words while the device turned, blinking anything downstream of it on and off.

## What a game declares

`orientation` has been in every manifest since the first one and, until this issue, **nothing
read it**. 108 games declared one of three words and no line of the product branched on any of
them. That is why giving it a meaning breaks nothing: there was no behaviour to preserve.

- **`'portrait'` / `'landscape'`** — the box has a long axis and this says which way it runs.
  67 games and 4 games respectively.
- **`'any'`** — one box serves both. The default, so a manifest that says nothing gets it. 37
  games: the 33 square boards, and Blocks, Solitaire, Sudoku (900x1000) and Paint Fight
  (960x1080).
- **`alternateLogical`** — new, optional, and declared by nothing yet. A second logical box,
  adopted when a match starts with the device turned the way `orientation` does not name.

The default is what keeps all 108 games behaving exactly as they do today: absent
`alternateLogical` means one box both ways up, which is what every game already does, and the
field is `.optional()` rather than defaulted so that it does not become a required member of
the inferred type and force a hundred already-compiled `.d.ts` files to be rebuilt — the same
argument `handoff` and `options` record.

### The word is now held against the geometry

Three checks in `gameManifestSchema`, all of which the catalogue passes as it stands:

1. `'portrait'` needs a box taller than wide, `'landscape'` one wider than tall.
2. A **square** box may only say `'any'`. A 900x900 board letterboxes to precisely the same
   drawn area either way up, so a preference is a word describing something the geometry
   cannot express.
3. `'any'` needs a box within 5:4 of square, in either direction.

The third is a judgement and the number can move with a reason, so here is the reason. A box
of aspect *a* (short side over long) drawn on a screen and on that same screen turned over
ends up in exactly the ratio *a*, so the bound is a plain statement: **a game claiming to serve
both orientations may not lose more than a fifth of its board's linear size when the device is
turned.** The four non-square `'any'` games sit at 1.11 and 1.125 and pass with room.

What the bound forecloses is the cheap way out of this issue. A 600x1000 game does not become
a game that supports both orientations by having one word changed to `'any'`; it loses two
fifths of its board that way. It declares a second box and means it, or it keeps its
preference and is honest about it.

### "Supported" is derived, never declared

There is no second field for the supported set. It is `orientation` plus whether a second box
exists, so a manifest cannot claim to support an orientation it has no layout for. Two
declarations that can disagree is the shape of defect this repository has already paid for
once — `zoneSplit` and the live active seat disagreed for eleven games (#2479) — and one
derivation is the cheapest possible way not to buy it again.

`isDesignedForOrientation` is named for what it is, and **it is not a gate.** Every game in the
catalogue is playable in every orientation: the box letterboxes, the pointer maths is in
logical units, and the shell's `short` height class already moves the scoreboards to the sides
of a sideways phone. Turning the device may make a board smaller; it never makes a game
unreachable. `supportsViewport` and `supportsDeviceClass` are gates and are named for it — this
one must not end up filtering a catalogue by accident.

## The box is chosen once, and a rotation cannot change it

This is the part where #1886's second and fourth items meet, and only one of them can win at a
given moment.

Every position a game holds is expressed in its logical box. Handing it a different box
mid-match therefore moves the entire simulation under two people who are in the middle of a
rally — a match lost to a gesture neither player thought of as an input, which is the precise
failure the fourth item forbids. So:

> **The logical box is a match-start decision. Turning the device after that re-letterboxes
> and changes nothing else.**

`GameHost` already works this way, and that is worth saying plainly rather than claiming as
new work: it computes the box once in its setup effect and its resize path recomputes only the
viewport. Its `logical` never moves. What this issue adds is the reason written down, the
place to hang the second box, and a guard.

The guard is in `packages/engine/src/viewport.test.ts`. A deterministic simulation is driven
through the screens one phone passes through when somebody turns it over — upright, a
collapsed zero-height frame, sideways, upright again — and is required to produce a trace
identical to the same match played on a screen that never moved. That assertion alone would be
close to worthless, because a test that never varies the box cannot fail, so the counterfactual
is asserted beside it: the same simulation with the box re-derived from the screen each time,
which is the obvious implementation of "re-layout on rotate", must **diverge**, and the
divergence must start at the first step after the turn. One is what makes the other mean
anything.

`e2e/resize.spec.ts` covers the half that a unit test cannot reach: that the host does not
rebuild the game across four viewport changes, and that the score and whose turn it is survive
a portrait-landscape-portrait round trip in a real browser.

## The rotate prompt must not block

`rotateHintFor` returns the orientation to suggest, or null. It is null in three of the four
cases — no preference, already held the preferred way, or a second layout exists for where the
device already is — and today it is null for every game in the catalogue, because none of them
is in the fourth case with the shell wired to ask.

Where it is not null, the constraint on what the shell does with it is the acceptance criterion
rather than a matter of taste. A full-screen "please rotate your device" overlay is the obvious
implementation and it is exactly what "non-blocking" is there to forbid:

- **It does not stop the match.** No overlay over the board, no modal, no focus trap, no
  pausing. A pair happy playing sideways ignore it forever and keep playing.
- **It does not take focus**, and it is not inserted in front of the board in the tab order.
  The board holds focus during play so that seat two's Enter reaches the game rather than a
  button; a prompt that stole it would break that.
- **It reads in greyscale** (rule 7): words, not a colour or a rotating icon alone. "Turn the
  phone upright for a bigger board" says what the player gets, which is the honest framing —
  the game is not broken where they are, it is smaller.
- **It is dismissible, and it stays dismissed for the match.**
- **It is chrome, so it goes in the letterbox.** A sideways phone showing a portrait box has
  surplus at the sides by definition, which is where rule 9 says chrome belongs; it must never
  be paid for out of the board.

## Remote play

If a game ever does declare a second box, the box becomes part of the match configuration
rather than a per-device presentation choice. Both devices adopt the same one however each
player is holding their own phone, because neither may see more of the world than the other
(rule 9) and `LockstepSession` refuses a pair whose configuration fingerprints disagree. One of
the two therefore letterboxes. That is a real cost and it is why the field is opt-in.

## What is built, and what is not

Built and tested:

- `screenOrientation` in the engine, with the null-while-collapsed behaviour and the
  square-screen tie-break (asserted to be free: on a square screen a box and that box turned
  letterbox to the same drawn area).
- `orientation` given a meaning, held against the box's actual shape in the schema.
- `alternateLogical`, its coherence checks in the schema and its magnitude bounds in
  `scripts/validate-manifests.mjs`, which runs inside `pnpm build`.
- `preferredOrientation`, `isDesignedForOrientation`, `logicalForOrientation`, `rotateHintFor`.
- The state-preservation guarantee, with its counterfactual.

**Not built**, and not claimed:

- **The prompt itself.** There is no component and no wiring. What exists is the decision it
  would render from and the constraints above.
- **The shell reading any of this.** `GameHost` still takes `manifest.logical` directly; it
  does not yet ask `logicalForOrientation` at match start, and nothing calls
  `screenOrientation`. Two of the four helpers are also not reachable from outside the SDK
  package yet: `packages/game-sdk/src/index.ts` and `packages/engine/src/index.ts` do not
  re-export the new names.
- **Any game laid out both ways.** Zero manifests declare `alternateLogical`. Doing that for a
  game is a design job per game, not a schema change — the build log prints the count on every
  run so that it is visible when it stops being zero.

Nothing above changes what any of the 108 games does today. The declarations they already
carry now mean something, and the one thing that would change a match — a second box — is a
field none of them sets.
