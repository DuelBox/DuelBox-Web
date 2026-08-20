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

## Not specified here

Spin, swerve, jump shots, ball-in-hand after a foul, two-shot carry, or nominating a
pocket. All are real pool; none of them survives a thumb on a phone.
