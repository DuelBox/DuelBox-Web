# Bowling — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 180 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Four frames each. Two balls a frame at ten pins, three in the last frame if you earn them.
Highest total wins. Four frames rather than ten is what the reference genre does on a
phone, and it is what `data/catalog.yaml` records as observed.

Two separate problems live here and the module keeps them apart: **scoring**, which is the
intricate part, and **the lane**, which is a ball and ten pins knocking each other about.

## Scoring is not additive

A frame's value is not known when it is bowled. A strike is worth ten plus your *next two
balls*; a spare, ten plus your next one. So the rolls are kept as a flat list and the score
is computed by walking it — the only shape where the bonuses stay obvious, and the shape
where an unfinished list simply scores what is known so far.

| | |
|---|---|
| Open frame | the pins you took |
| Spare | 10 + the next ball |
| Strike | 10 + the next two balls |
| Last frame | a strike or spare earns extra balls, up to three in all |

Four strikes and two bonus balls is 120, which both stronger bot tiers reach occasionally.

The scoreboard shows **frame by frame**, not one running total, because a player needs to
see which frames are still open — a strike two frames ago is still being paid.

## The lane

| | Value | Why |
|---|---|---|
| Lane | 700 × 1000, gutters 96 in | |
| Ball | radius 30, mass 7 | Seven times a pin, which is what carries a strike |
| Pin | radius 15, mass 1 | |
| Fall | 26 units from its spot | |
| Drag | ball 0.6/s, pins 0.08/s | Per **second**, so every device agrees (rule 8) |

**A fallen pin keeps sliding and keeps hitting things.** `down` is a scoring flag, not a
physics one — a pin that has been struck is travelling across the deck, and in bowling that
is precisely what takes out the pins behind it. Fallen pins are swept between balls, which
is when a real lane clears them too.

Measured, over 300 first balls by the strongest tier: **50.7% strikes with fallen pins
removed from the physics, 61.3% with them carrying.** A test sits at 55% so taking the
carry away fails rather than merely making the game a little worse.

The deck has walls and a pit behind it. Without them a struck pin slides off across empty
space for ever — invisible, because the renderer clips, but the lane never settles and the
draw coordinates end up hundreds of units outside the box. A test catches that now.

**The gutter is one rule, not two.** A ball in the channel has its sideways velocity zeroed
and runs straight past the rack. A second guard skipping the pin collision was redundant —
a ball held at x < 96 cannot reach a pin at x > 270 — and mutating it failed no test, which
is how it showed.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetGame`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat one
takes **50.0%** of 98 decided matches, and 49 of the 50 seed pairs end differently when only
the opening seat changes.

## The bot

| | Angular error | Power | First-ball strikes | Average over 4 frames |
|---|---|---|---|---|
| easy | ±0.24 rad | 0.62 | 18.8% | 36.3 |
| normal | ±0.10 rad | 0.74 | 47.3% | 72.6 |
| hard | ±0.045 rad | 0.84 | 59.8% | 87.0 |

Measured over 300 games a tier. Both stronger tiers have bowled 120 — four strikes and the
bonus balls — so a perfect game is reachable rather than theoretical.

Every tier sees the deck and nothing else, per rule 6, and its error is drawn **once for
the ball** rather than per step: a per-step error averages to zero and every tier would
bowl the same.

### Aiming at the pocket

At a full rack the bot aims **between the one and the three**, not at the head pin. This is
not a flourish. A ball that strikes the one pin dead centre leaves a split, which is why
every bowler is taught to come in at the pocket — and aiming at the centre of the rack made
the *most accurate* tier the worst of the three: 8.9 pins a ball against a weaker tier's
9.9. One offset of 22 units fixed it.

Once the rack is broken the pocket is meaningless and it aims at what is left.

The spreads were swept rather than guessed. At ±0.013 the strongest tier struck **93.5%** of
first balls, better than a professional and no fun to play; the shipped values put it at
59.8%, a strong club bowler, with the weakest at 18.8%, a casual one.

## Controls

Sideways to steer and a hold to build power — the same idiom as Darts and Cornhole, so a
player who has met either already knows this one. Dragging back down the lane also builds
power, which is the run-up. W A S D and Space are player one's, the arrows and Enter player
two's, and the lane turns to face whoever is bowling.

The aim is clamped so a ball is always sent up the lane; a bowler cannot turn round.

## Rule 7

A pin still standing is a filled disc with an inked collar; a fallen one is a faint
outline. Shape and weight, not only brightness. The ball carries the shooting seat's colour
**and** its shape — a ring for p1, a stripe for p2 — and the scoreboard repeats both
markers beside each row.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context. The same ball replays to
identical pin positions to six decimal places.

The step-size test measures a **bare lane**, not the rack: ten pins bouncing off each other
is chaotic, and a difference of a millionth in the first contact ends with a different pin
count, so comparing racks across step sizes would be testing the weather. The engine's
timestep is fixed for every device anyway; what that test guards is the shape of the drag,
and the seeded replay guards the rest.

## Not specified here

Ten frames, hooks and spin, oil patterns, handicaps, or the foul line. All are real
bowling; four frames and a straight ball is what the genre does on a phone.
