# Mini Soccer — specification

**Archetype:** `rt-split` · **Category:** Sports · **Logical box:** 1000 × 640 ·
**Zone split:** vertical · **Round length:** 90 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

One outfield player each, one ball, a goal at either end, ninety seconds on the clock.
Run into the ball to push it; run into it hard to strike it. Most goals at the whistle
wins, and a draw is a real result rather than something to break.

Crabby Volley put a ball in the air between two seats that could not reach each other.
This is the first game where **both players contest the same object in the same space** —
there is no net, no midline they cannot cross, nothing keeping them apart. That is the
whole design problem, and most of what follows is about it.

## The pitch

| | Value | Why |
|---|---|---|
| Pitch | 1000 × 640, 26-unit wall | Landscape, so both seats sit along the long edge |
| Goal | 300 tall, 34 deep | Just under half the height: scoreable, not free |
| Player | radius 44, speed 420 | Two bodies fit side by side in the goal mouth |
| Ball | radius 22, max speed 900 | Small enough to slip past a defender who is late |
| Drag | 0.42 per second | See below |
| Kick | 620, 0.55 transfer | |
| Wall bounce | 0.7 | A ball off the wall is slower, so the rebound is playable |
| Match | 90 s, 1.6 s to celebrate | |

## Drag is per second, not per step

The ball keeps `0.42` of its speed each second, applied as `pow(BALL_DRAG, dt)`. Written
the obvious way — multiplying by a constant each step — the ball's deceleration would
depend on the frame rate, which is exactly the class of bug rule 8 exists to prevent. It
is the same value at 60 Hz and at any other step size, and a test steps the identical
throw at two step sizes and demands the resting places agree within 1%.

## Pushing and striking are the same collision

There is no kick button. When a player overlaps the ball, the ball leaves along the line
between the two centres at `KICK_SPEED`, plus `KICK_TRANSFER` of the player's own
velocity, clamped to `MAX_BALL_SPEED`, and is then pushed clear of the body so it cannot
be struck twice on consecutive frames.

That last clause is the entire reason the game is playable. Without it a player standing
on the ball re-kicks it every frame, and the ball either vibrates in place or shoots off
at a speed no rule produced. **[ours]** — the reference genre usually separates a dribble
from a shot with a button; collapsing them into one collision means a phone player with
one thumb is not at a disadvantage against a keyboard, which rule 6 and the fairness
section both want.

## Why the clock and not a target score

A first-to-N match between two players contesting one ball has no upper bound on length —
two defenders who both sit in front of their own goal produce a match that never ends.
The survival bug found earlier in the project was the same shape. A fixed 90 seconds
always terminates, and a test plays a full bot match and asserts the whistle goes.

A draw is therefore possible and is reported as one. **[ours]** — inventing golden goals
would mean inventing an unbounded match again.

## Controls

Both seats play at once, so the two key halves belong to different people: **W A S D for
the left seat, arrow keys for the right**. Presenting them as alternatives, which four
other manifests here did until this game was written, tells the second player to press
keys that move their opponent. A test now refuses that phrasing for every `rt-*` game.

Pointer play is a drag: the player runs toward the finger. A touch belongs to the seat it
started in and keeps it across the midline, which the engine already guarantees, so a
player chasing the ball into the far half does not lose their own input.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context. The same seed replays to the
same ball position at every sampled frame, which a test checks by tracing two runs.

## The bot

| | Reaction | Wobble | Lead | Approach |
|---|---|---|---|---|
| easy | 0.42 s | 0.8 | 0 | 0 |
| normal | 0.24 s | 0.35 | 0.18 | 30 |
| hard | 0.13 s | 0.16 | 0.3 | 40 |

The bot sees the ball a human can see and nothing else. It re-decides on its reaction
interval, and **the misjudgement it draws is held until the next decision** rather than
redrawn each step — a per-step error averages to zero, which is the mistake that made
three earlier bots in this project play at one strength across all three tiers.

`lead` aims where the ball will be rather than where it is; `approach` offsets the target
toward the goal being attacked, so a stronger bot arrives on the shooting side of the ball
instead of nudging it backwards.

Measured over 16 matches a pairing: hard beats easy 12–0 with 3 draws at 4.4 goals a
match; hard beats normal 11–1 with 4 draws at 2.0; normal beats easy 9–0 with 7 draws at
3.1. The tiers are ordered and the gaps are visible without being hopeless.

## Presentations

**Shared-screen** — one pitch, drawn once, never rotated. Both seats sit along the long
edge and read the same picture, so a 180° flip would put one of them upside down. Each
goal is painted in the colour of the seat defending it, because which way you are shooting
is the thing a new player gets wrong first.

**Single-seat** — identical simulation and identical pitch; only the control mapping
changes. Rule 9 holds trivially: there is nothing off-screen to see.

## Rule 7

Seat colour is never alone: **p1 is a disc, p2 a square**, each with an inked inner
outline, so the two players are told apart with the colour removed. The ball is a third
shape — a disc with a dark cap across it — so it is not mistaken for p1 in greyscale.

The goals carry the defender's colour, but their non-colour signal is **position**: yours
is the one behind you, and there are only two. That is a weaker signal than a shape would
be, and it is the one part of this game that leans hardest on the seat palette — which is
also the subject of the open contrast issue #2322.

## Not specified here

Offside, throw-ins, fouls, goalkeepers, more than one player a side. All of them are real
football and none of them survive contact with two thumbs on one phone.
