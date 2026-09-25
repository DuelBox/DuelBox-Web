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

## Pushing and striking are the same collision, and both players press at once

There is no kick button. When a player overlaps the ball, the ball leaves along the line
between the two centres at `KICK_SPEED`, plus `KICK_TRANSFER` of the player's own
velocity, clamped to `MAX_BALL_SPEED`, and is then moved clear of the body so it cannot
be struck twice on consecutive frames.

That last clause is the entire reason the game is playable. Without it a player standing
on the ball re-kicks it every frame, and the ball either vibrates in place or shoots off
at a speed no rule produced. **[ours]** — the reference genre usually separates a dribble
from a shot with a button; collapsing them into one collision means a phone player with
one thumb is not at a disadvantage against a keyboard, which rule 6 and the fairness
section both want.

**When both players are on the ball, both of them press it.** Each contributes a push out
along the line from their own centre, weighted by how deep the ball is inside them, and the
ball leaves along the *sum* — so a defender pressing from the far side genuinely blocks a
striker, and two players squeezing it from exactly opposite sides cancel and the ball is
held between them until one of them moves. It is a continuous rule rather than a threshold,
which is the point: there is no knife edge for a seat to fall off, and the perfectly
balanced case is the one where nothing happens.

That replaced `if (touching p1) kick(p1); else if (touching p2) kick(p2)`, which is the
subject of the section below and is not a rule about football at all. Two alternatives were
measured before this one. Awarding the challenge to whichever player is *closer* is
symmetric and reads well, but it releases a squeezed ball at full pace instead of holding it
up, and the score went from 2 goals a match to **26**, with a ninety-second match taking a
hundred and sixty seconds of celebrations. Adding a cooldown on top made it 32. Summing the
press keeps the scoreline the game already had — 2.2 goals a match on `normal` against 2.7
before, and a mean match of 98.5 simulated seconds against 98 — while removing the seat
entirely.

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

## Neither seat, ever

The balance harness recorded this game at **75.6% for seat one** over a thousand seeds on
`normal`, not root-caused. The cause was one `else`:

```ts
if (touching(ball, game.p1)) kick(ball, game.p1);
else if (touching(ball, game.p2)) kick(ball, game.p2);
```

Two players contest one ball in one space — that is the sentence at the top of this file —
so a ball touching both of them is the *normal* state of this game rather than an edge case,
and every one of those was a free kick for seat one. It is worth **25 points of win rate on
`normal` and 25 on `hard`**, and a clean **0** on `easy`, which is too clumsy to reach the
ball at the same time as anybody else. A game whose unfairness only appears once the players
are good enough to contest anything is exactly the game a single-tier balance number calls
fair, and this one was measured on `normal` alone for its whole life.

A second, smaller one sat beside it: both bots drew their wobble from **one** generator in
seat order, so seat one took every even draw and seat two every odd one. Worse for the
harness, it meant the game ignored the opening seat completely, so a seed played twice — once
per opening seat, which is how the sweep separates the seat effect from the seed effect — was
the identical match both times. The sweep's hundred matches a game were fifty matches counted
twice. There are now three streams, and the two bot streams are handed out by **role**: the
first belongs to whichever seat the shell opened with, so across a seed pair each stream sits
in each chair exactly once.

Re-measured at a thousand seeds, both bots on the same tier, seat one's share of decided
matches:

| tier | before | after | draws | mean match |
|---|---|---|---|---|
| easy | — | **50.9%** | 37.9% | 99.6 s |
| normal | 75.6% | **49.2%** | 34.6% | 98.5 s |
| hard | — | **52.4%** | 52.3% | 95.1 s |

A third of the matches are draws, so a fifty-seed run only decides about 68 of its 100 and
reads anywhere in a wide band: the push gate measures **41.2%** on `normal`, the nightly's 250
seeds **49.5%**, and the thousand above 49.2%. That is what an allowance of 25.7 points at
fifty seeds means, and it is the Pinball case this repository has already been through — quote
the deep number, not the cheap one.

The `normal` line is deleted from `OUTSIDE_THE_BAND`. The draw rate and the match length are
where they were, which is the check that the repair did not quietly become a different game.
`hard` draws more than half its matches — two near-perfect defenders, and the tension the
bot section below is already about — and that is worth an issue of its own rather than a
number to tune here.

The mirror sweep then found two more, both **measure-zero and both real**: a ball sitting
exactly on a player's centre had no line between the centres to leave along and the code
answered `(1, 0)` — rightwards in pitch coordinates, which is towards the goal seat one is
attacking and towards the one seat two is defending; and a bot standing exactly on the spot
it was aiming at took `Math.atan2(0, 0)`, which is 0, and ran the same way for the same
reason. Neither is reachable in play today and neither moves any measurement — the
thousand-seed numbers above are identical with and without the fixes. They are recorded
because they are the same shape as the bug that *was* worth 25 points, and because the next
physics change is what makes a measure-zero case reachable. The ball is now carried by the
presser's own motion, and a bot already on its spot keeps the heading it committed to.

This is a **measured** symmetry rather than a structural one, and the difference is worth
naming. Paint Fight can prove its 50% exactly, because relabelling its two seats is a symmetry
of its rules; here the seats own opposite ends of the pitch, so the mirror is a half-turn of
the pitch and a half-turn does not commute with double-precision arithmetic to the last bit.
What *is* asserted exactly is the rule: `describe('the mirror')` turns hundreds of random
positions through 180 degrees, exchanges the seats, and requires the contest, the step, the
drive, the goal check and every bot decision on every tier to come out mirrored — the contest
to the bit, the rest to a few ulps. Reintroducing the old `else` fails two of those tests
immediately.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context, split into three streams. The
same seed and the same opening seat replay to the same ball position at every sampled frame,
which a test checks by tracing two runs.

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

Re-measured over 16 seeds a pairing, each played from both ends so the seat is not folded
into the tier: hard beats easy **24–0** with 8 draws at 4.9 goals a match; hard beats normal
**22–3** with 7 draws at 1.5; normal beats easy **22–1** with 9 draws at 3.1. Every
self-pairing comes out exactly level — 8–8, 12–12, 10–10. The tiers are ordered and the gaps
are visible without being hopeless.

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
