# Slot Cars — specification

**Archetype:** `rt-race` · **Category:** Racing · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 75 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Hold the throttle and the car goes faster. Let go and it slows. Carry too much speed into a
bend and it leaves the slot, and you lose nearly two seconds getting it back. Three laps.

## Observed rules

From the reference genre: _"Tap the screen and race your car round the laps as fast as you
can. But be careful, if you go too fast you fly off."_

## The track is one number long **[ours]**

A slot car cannot steer. It has one control — power — and one state that matters: how fast
it is going and where it is round the lap. So the simulation is a **distance and a speed**,
and the circuit is a curvature profile read off by arc length. The two-dimensional track
exists only in the renderer, which integrates the same profile once at load into a polyline.

Three things fall out of that, and each would have been work otherwise:

- **It is exactly fair.** Both cars run the identical profile from the identical start. The
  two lanes on screen are a *drawing device* — offset sideways so you can tell the cars
  apart, and the offset touches no distance. A real slot track needs crossovers to equalise
  its lanes; a track that is one number long does not. A test drives both seats with one
  input stream and asserts their states stay identical, field for field.
- **It is trivially deterministic.** There is nothing to integrate but `v` and `s`, and no
  collision to resolve at all.
- **The skill is legible.** The safe speed anywhere is a number, so "too fast for this bend"
  is a fact that can be drawn rather than a feeling.

## The circuit is built, not written down

A rounded rectangle with **four different corner radii** — 55, 170, 90 and 130 — which is
the smallest shape that gives a lap a rhythm worth learning rather than one corner repeated.
Each straight is what is left of its side once its two corners have taken their bite, so the
track **closes by construction**.

The first version was a hand-written list of segments and it did not close: the signed turn
came to 3π rather than 2π, so the drawn track would have spiralled. A constant cannot tell
you that; a construction cannot get it wrong. Two tests check it anyway — the heading closes
to 2π, and, the stronger claim, the *place* comes back within half a percent of a lap.

| | Value |
|---|---|
| Lap | 2,369 units, 3 laps |
| Corner radii | 55, 170, 90, 130 |
| Safe speeds | 335, 589, 428, 515 |
| Motor | 95 (crawl) to 620 |
| Throttle / drag | +175 / −130 a second |
| A spill | 1.9 s, rejoin at 90 |

**The grip constant was out by a factor of sixteen** in the first draft: every corner came
out safe at over 1,200 units a second against a motor that tops out at 620, so no bend on
the track could be taken too fast and the only control in the game did nothing.

## Termination has no clock in it **[ours]**

A slot car is fed by the rail; it does not stop because you stopped asking. The motor holds
a **crawl of 95** with the throttle off, so a race between two absent players still finishes
— in about seventy-five seconds — and the argument needs no wall clock at all. A test runs
exactly that race and expects a draw.

The race is also called the moment one car crosses, rather than making the loser drive a lap
alone: the order is already known.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | hold `Space` | hold `Enter` |
| Pointer | hold anywhere in your own half | hold anywhere in your own half |

**Held, never tapped.** A repeated tap is won by whichever instrument repeats fastest, which
is why Road Dodge had to declare itself `sameInputClassOnly`. Power here is a *level*, not
an event, so there is no rate in it to win — a test mashes a key at ten presses a second
against a held one and finds the mashed car slower, never faster.

## The bot

Three tiers, expressed only as how far ahead a tier reads, how finely it reads, and how near
the limit it is willing to run.

| Tier | Margin | Look ahead | Reacts | Resolution |
|---|---|---|---|---|
| easy | 1.10 | 0.50 s | 0.26 s | 26 u |
| normal | 0.82 | 1.10 s | 0.12 s | 12 u |
| hard | 0.93 | 1.90 s | 0.05 s | 5 u |

It looks along the track for the first corner it could not still slow down for, using
`v² = u² − 2·a·s` with the drag it knows it has — the same sum a person does by eye. A test
checks the game's drag is the drag the bot assumes, because a bot braking with different
physics is racing a different car.

**The tiers are ordered by accuracy, not by bravery**, and getting that wrong was the
interesting failure. A spill costs 1.9 s and a race is about eighteen, so running nearer the
limit only pays if it does not cost a fall. The first set had `hard` at a margin of 0.99
against `normal`'s 0.95 — and `hard` **lost**, spilling six times a race to `normal`'s five,
which is eleven seconds of penalty. `hard`'s advantage is now a finer resolution and a
longer look; its margin is higher than `normal`'s but nowhere near the edge.

**Two equal bots dead-heated every single race** until `REACTION_WANDER` existed. The track
is the same every lap, both cars start together, and a bot with no randomness in it is a
pure function of the state — so two of the same tier braked on the same step and crossed at
the identical thousandth of a second. Twenty races of every equal pairing, twenty draws. A
ten-per-cent wander in *when it looks* is the smallest thing that separates them and the
most honest, since that is what distinguishes two people of the same ability. It is exactly
one draw per decision, unconditionally.

### Measured, 120 seeded races a pairing

| | p1 | p2 | draws | p1 share of decided |
|---|---|---|---|---|
| easy v easy | 51 | 46 | 23 | 53% |
| normal v normal | 63 | 53 | 4 | 54% |
| hard v hard | 50 | 62 | 8 | 45% |
| hard v easy | 120 | 0 | 0 | |
| easy v hard | 0 | 120 | 0 | |
| normal v easy | 120 | 0 | 0 | |
| hard v normal | 92 | 28 | 0 | |
| normal v hard | 22 | 98 | 0 | |

Sixty seeds was not enough and said so: the first sixty gave `easy` a 66% split that a
hundred and twenty put at 53%. A race decided by a handful of spills is noisy, and the
answer was more samples rather than a wider band.

## Rule 7: never colour alone

- p1's car is a rounded body with a single roundel; p2's is squared with a stripe down it.
  Two cars a few units apart on the same corner is exactly where colour alone stops being
  enough.
- A car off the slot gets a cross through it.
- Each seat's gauge shows speed against the safe speed **where the car is about to be**, not
  where it is — the only version of that number that is any use, since by the time a corner
  is under you it is too late. Over the limit the bar changes colour *and* grows a spike
  above it.
- Laps are pips beside each player's own gauge, on their own edge of the board.
