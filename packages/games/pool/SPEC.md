# Pool — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 1000 × 640 ·
**Zone split:** shared-board · **Round length:** 300 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A cue ball, seven a side and a black. Strike the cue ball; pot one of yours and you shoot
again. Clear your seven, then pot the black to win. Pot the black early, or off a foul, and
you lose.

This is the first game here with **many bodies colliding with each other**. Air Hockey has
one puck and Mini Soccer one ball; here sixteen circles resolve against each other and six
pockets every frame, and the whole thing has to replay identically from a seed.

## The table

| | Value | Why |
|---|---|---|
| Table | 1000 × 560, 34 cushion | |
| Ball | radius 15 | |
| Pocket | radius 26 | Wider than a ball, so a good line drops rather than rattles |
| Cue speed | up to 1500 | |
| Drag | 0.22 per second | Per **second**, so a phone and a laptop agree (rule 8) |
| Cushion | 0.86 restitution | |
| Stop speed | 12 | Below this a ball stops, so the table settles |

## The collision

Equal masses, exchanging only the component along the line of centres — the tangential part
of each velocity is untouched, which is what makes a cut shot behave.

Two details are load-bearing and both were found by things going wrong:

- **A positional push.** Two balls caught overlapping swap velocities every frame and buzz
  in place instead of separating. Each is pushed out by half the overlap before the
  impulse.
- **A separating pair is left alone.** A pair can still be touching on the step *after*
  they collide; striking them again there applies the impulse the wrong way and pulls them
  back together, quietly adding energy. Nothing else in the suite noticed — the positional
  push separates them anyway — so it took a test that reads their velocities rather than
  their positions.

Order within a step is deliberate: move, cushions, ball-on-ball, then pockets. Resolving
pockets first let a ball be potted and then struck by another in the same step, which put a
potted ball back on the table.

## The rack

Fixed, not random. An opening both players know is part of the game, and a random rack
would make the first shot a lottery. The black sits at the centre of the third row, as it
should.

## Aiming

The gesture is drawing a cue back: put a finger down, pull away from the cue ball, and let
go. The ball leaves along the line from the finger *through* the ball, and how far you
pulled is how hard you hit it — the thing the object itself suggests. A pull shorter than
18 units is a rest, not a shot.

**Full power is the edge of the table, not a fixed distance. [ours]** The draw used to be
measured against a flat 260 units, and a 260-unit pull has to fit somewhere: the only
surface a player can reliably touch is the canvas, which is exactly the logical box. A
resting ball is at least `CUSHION + BALL_RADIUS` = **49 units** from the edge of that box,
so playing firmly off a cushion meant dragging to a point that was not on the canvas.

That failed two ways, both of them #1965's subject and neither of them visibly:

- **It depended on the screen.** The host captures the pointer and converts with
  `viewportToLogical`, which clamps nothing, so a drag that leaves the canvas keeps
  reporting logical coordinates. On a 4K desktop the letterbox bars beside a 1.5625 box are
  enormous and every shot was available; on a phone whose canvas meets the glass the same
  shot was not. Measured: a ball on the side rail could be struck at **0.188** power, and
  nothing higher, without leaving the board.
- **It aimed the player at the system gesture area.** The edge of a phone screen is where
  back, home and the notification shade live. The OS answers with `pointercancel`, which
  since #2480 is correctly not a release — so the harder someone pulled, the likelier the
  shot was to vanish.

So the draw is measured against the room that is there: `min(room behind the ball, 260)`,
floored at 40 so a potted cue ball sitting in a pocket cannot collapse the scale. A ball
tight on a cushion is played with a short, sharp action and hits just as hard, which is what
a real player does on the rail. The deadzone stays absolute at 18 units, so a short draw
costs *resolution* — about ten distinguishable levels against seventy-five on open table, at
the engine's 3.2-unit input lattice — and never costs the shot.

The obvious companion change, clamping the pointer into the box before measuring it, was
written and then removed: with the draw already no longer than the room, full power is
reached *at* the edge and a finger beyond it is saturated, so the clamp guarded nothing —
and a per-axis clamp of a diagonal drag is not a point on the same ray, so it bent the aim.
It was found by putting it back and watching no test fail.

The drawn cue follows the same room, because the picture has to agree with the control: a
fixed 150-unit cue drawn back by up to 154 units put the whole thing outside the box on a
rail shot, where the frame clip removed it — so the one thing a player reads power from
disappeared exactly when they were pulling hardest. It now takes a little over half the
available room for its length and travels through the rest: 21 to 135 units behind the ball
on open table, against the old 34 to 154, and a short cue with a short action on the
cushion.

On a keyboard, steer to turn the cue, hold to build power, release to strike. The cue is
drawn back on screen by how hard the shot will be, so power is read from the cue's position
rather than from a number.

`strike` owns the rule that a shot needs power. The game module used to re-check it, which
mutating and failing no test is exactly how the duplicate showed.

## A frame always ends **[ours]**

Pool can reach a position neither player can clear, and **nothing else in this project
would ever end such a frame**: `roundSeconds` is validated by the manifest schema and used
to print "about 5 min" on a catalogue card, and enforced nowhere. An unwinnable position is
therefore an unwinnable *match*.

Two bots on `easy` proved it: forty frames, not one finished, over a thousand shots each,
never potting anything.

So: **twenty consecutive shots with nothing potted ends the frame**, decided on balls
potted, drawn if level. Ten visits each without a pot is a dead frame in any real sense,
and calling one is a real tournament rule rather than an invention.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetGame`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat one
takes **50.0%** of the 58 matches that are decided at all, and all 50 seed pairs end
differently when only the opening seat changes.

## The bot

| | Angular error | Power |
|---|---|---|
| easy | ±0.13 rad (~7°) | 0.55 |
| normal | ±0.06 rad (~3°) | 0.70 |
| hard | ±0.018 rad (~1°) | 0.80 |

Every tier aims at the **ghost ball** — where the cue must be at contact to send the target
at a pocket, the line every player is taught — and prefers a short cue travel and a small
cut, both of which are what makes a shot easy and both of which a person can see. It sees
only the table, per rule 6; the tiers differ in how accurately they hit the line they have
chosen.

Two refusals matter more than the aiming:

- A shot **through another ball** is not a shot. A segment-to-centre test rejects it.
- A shot whose contact point is **buried in a cushion** is not a shot either.

Before those, the bot replayed impossible strokes for ever: thirty of forty `hard` frames
never ended. With them, and with a safety — hit your nearest ball at all — when nothing can
be potted, every pairing finishes.

Measured over 40 frames a pairing:

| | Result | Drawn | Ended by stalemate |
|---|---|---|---|
| hard v easy | 31–3 | 6 | 29 |
| hard v normal | 29–2 | 9 | 24 |
| normal v easy | 17–7 | 16 | 38 |
| hard v hard | 17–20 | 3 | 38 |

**The honest note.** The tiers are ordered and the gaps are large, but most bot frames end
by stalemate rather than by potting the black: `hard` sinks about four of its seven and then
runs out of shots it can make. It is a plausible club player, not a shark. Building a strong
pool bot is a project of its own, and pretending otherwise in this document would be worse
than saying so.

Shot power was swept rather than guessed: 0.8 pots 4.2 of 7 and wins 31–3; 0.65 pots 3.4;
0.5 and 0.4 both collapse to 1.6, because a soft shot does not reach the pocket.

## Rule 7

A seat's balls carry its colour **and** its shape — p1 a ring, p2 a stripe across the
middle — so the two sides are told apart with the colour removed. The cue ball is plain and
the black is the only ball with neither mark. The status bar carries the same marker, so
which side you are is never a memory test.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context, and the bot's error drawn once
per shot rather than per step — a per-step error averages to zero and every tier plays the
same. The same opening shot replays to identical ball positions to six decimal places, and
the same throw settles within 1% at 60 Hz and 120 Hz.

## Every screen size, both orientations

**Most of #1965 is true here by construction, and saying so is the finding.** The logical
box is a fixed 1000 × 640 in the manifest; the host fits it with `fitViewport` and
letterboxes the surplus; `Canvas2DRenderer.beginFrame` clips the frame to it. There is not
one device API under `packages/games/pool/src` — no `window`, no `devicePixelRatio`, no
`matchMedia` — so this game *cannot* lay out from pixel values, cannot branch on a device
(rule 10), and cannot be resized by anything: a resize reaches `renderer.setViewport` and
stops there. Match state across resize, rotation and fold is therefore preserved by there
being nothing to preserve it from. `apps/web/src/data/cross-viewport.test.ts` drives this
game at five viewports including a notched phone and requires bit-identical traces;
`e2e/resize.spec.ts` proves the host does not rebuild a game on a resize.

**One layout, because there can only be one.** "Design the layout at each device class" is
not a knob a game has: rule 8 fixes the box, and a game that reshaped itself per device
would break cross-device play. What Pool declares instead is `orientation: 'landscape'`,
which `shouldPromptRotate` turns into a non-blocking hint when the device is the other way
up. A pool table is strongly landscape and that is the honest answer for it. Both
orientations still *play*. Fitting the box to the whole of a viewport gives 320 × 205 at a
320 × 568 phone held upright and 609 × 390 at 844 × 390 held sideways, where `PlaySurface`'s
`short` class moves the scoreboards off the vertical axis; the board area is smaller than
the viewport by whatever the shell's chrome takes, and that part is not measurable from a
node test, so it is not claimed here. `layout.test.ts` fits every named class from
`docs/responsive.md` in both orientations and asserts the box is whole, unstretched, inside
the safe rectangle, and never overflowing.

**What was not free is what the game draws.** Two things were outside the box at every
screen size, invisibly, because the frame clip removed them:

- the foul message, centred on `TABLE_HEIGHT + 80` — the bottom edge exactly — with
  `Renderer.text` taking `y` as the *centre* of the line, so half of it was gone;
- the cue, on any firm shot played off a cushion.

Both are placed from `layout.ts` now, and `rowCentre` is a clamp rather than a corrected
constant so the next arithmetic slip cannot repeat it. `game.test.ts` walks every draw call
as the rectangle it actually covers — including text, and with no slack — which is the
game-side half of "nothing outside the safe area". It has to be game-side:
`e2e/safe-area.spec.ts` and `e2e/touch-targets.spec.ts` walk the DOM, every control and
every word here is drawn on a canvas, and neither spec visits `/play/pool/`. The repo-wide
`cross-viewport.test.ts` check allows `max(width, height) × 2` of overhang by design, so it
could not see a 12-unit one.

## Not specified here

Spin, swerve, jump shots, ball-in-hand after a foul, two-shot carry, or nominating a
pocket. All are real pool; none of them survives a thumb on a phone.
