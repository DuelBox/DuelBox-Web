# Ping Pong — specification

**Archetype:** `rt-split` · **Category:** Sports · **Logical box:** 640 × 960 ·
**Zone split:** horizontal · **Round length:** 60 s advertised, 150 s hard backstop

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A table seen from above, a racket at each end, and a ball that never stops. Slide your
racket along your own baseline; the ball bounces off the side rails and off whatever
racket reaches it. Miss and the other player scores. First to seven.

## Observed rules

From the reference genre: _"Use your finger to move the racket and to spin the ball. Get 7
points to win!"_ — two seats, one shared device, a racket driven directly by a finger, a
target of seven points, and spin as the thing a finger can express.

Everything below is how those four facts became a simulation.

## The table

| | Value | Why |
|---|---|---|
| Table | 640 × 960, rail 18 | Portrait: two people either side of an upright phone |
| Ball | radius 15 | |
| Racket | half-width 58 at serve, half-height 11 | Narrows — see below |
| Baselines | y = 74 and y = 886 | Symmetric under a half-turn, so neither seat has longer to react |
| Racket speed | 560 u/s | The same ceiling for a key and for a finger |
| Serve | 520 u/s after a 1.0 s hang | Both players get to look up |
| Rally speed-up | ×1.06 a return, capped at 1900 | |
| Points | first to 7 | From the observed rule |

## Spin is the whole game **[ours]**

A racket does not mirror the ball. It contributes its own sideways motion to the return —
36% of it — so a still racket sends the ball back the way it came and a racket sweeping
left as it strikes sends the ball left. Where on the face the ball lands bends it too, by
up to 240 u/s at the edge.

Two controls, deliberately: the sweep is the one a finger is better at, the contact point
is one a key can also reach. A player on a keyboard can aim; a player with a thumb can aim
*and* sweep. That is a real advantage to touch and a small one, which is the most a game
can have while still being fair across input families.

Returns are re-normalised to the rallied speed and then held inside an angle envelope
(|vx| ≤ 1.5·|vy|), so no shot can end up running the rails for a second and a half before
reaching anybody.

## The rule that ends a point: the racket narrows **[ours]**

**Every return you make costs you 9 units of half-width, down to a floor of 9, and it
resets at the next serve.**

This exists because the obvious mechanism does not work. The first draft relied on the
ball speeding up — a rally accelerates, and eventually the ball outruns a racket that has a
speed limit. That is simply false for a ball hit straight back, which arrives where the
receiver already stands however fast it travels. Measured over sixty bot matches a side:

| | before | after |
|---|---|---|
| Average `hard` v `hard` rally | 165 returns | 21 returns |
| Matches decided on the clock rather than on 7 points | 12 in 24 | 1 in 30 |

A narrowing racket shrinks the *target* rather than the time, so a straight ball stops
being a safe ball. It also opens the corners: the band a racket may patrol is fixed at the
full-width racket's limits, so a narrowed racket can no longer cover the rail, and a ball
tucked against the side wins the point outright.

And it makes a long rally *tense* rather than merely long — a player watching their own
racket thin out is being told what is about to happen, without a word in any language.

### Counted per seat, not per rally

The first version counted the rally's total returns. The two seats hit on alternate counts,
so the receiver had the wider racket on **every one of their shots**; p1 receives the
opening serve and won 13 of 24 against an identical opponent. Counting each seat's own
returns makes the two curves identical and the imbalance vanished (28–26 over 60).

## Controls

| | Seat one (near) | Seat two (far) |
|---|---|---|
| Keyboard | `A` / `D` | `←` / `→` |
| Pointer | drag anywhere in the near half | drag anywhere in the far half |

A finger names an **absolute** column, not a relative drag, and it can because the split is
horizontal: each seat owns a full-width band and every column their racket can reach is
directly under their own thumb. Asking for a relative drag would be asking a player to aim
at a place they can already touch.

Both families are rate-limited by the same `driveRacket`, so a key held down and a finger
dragged across the table cover the table in the same time. The engine's precision envelope
(3.2 units here) applies to the pointer, so a mouse cannot aim finer than a thumb.

## Win, lose, draw

- **Win:** first seat to 7 points.
- **Backstop:** at 150 s the match is called on points; level is a draw. Nothing else could
  end a match between two players who never miss, and `roundSeconds` in the manifest is read
  only by the catalogue card.
- **Draw:** only from the backstop. A point itself cannot be drawn — exactly one baseline is
  crossed.

## Edge cases

| Case | Behaviour |
|---|---|
| Ball arrives deep into a rail in one step | Reflected *about* the rail, not merely negated, so it cannot stick and flip every step |
| Ball leaving a racket | A racket only strikes a ball travelling **toward** it, or the ball would be caught again on the way out and the point would never end |
| Both players idle | The ball crosses a baseline and a point is scored; a match of two absent players still finishes |
| Ball faster than the strike band is deep | Cannot happen: 1900 × 1/60 = 32 units against a 52-unit band, and a test asserts the inequality |
| Simultaneous crossing | Impossible — one ball, one baseline |
| Match already decided | `step` returns immediately and the ball does not move |
| Rematch on the same instance | `init` resets the position, both bot states, and the clock |

## The bot

Three tiers, expressed only as **reaction delay, aim error, and ambition** — never as a
faster racket, a wider racket, or a look at anything a player cannot see (rule 6).

| Tier | Reaction | Error | Ambition |
|---|---|---|---|
| easy | 0.34 s | ±96 u | 0 — blocks, never angles |
| normal | 0.16 s | ±42 u | 0.45 |
| hard | 0.06 s | ±12 u | 0.85 |

It predicts where the ball will cross its baseline by **folding** the straight-line landing
point back into the table rather than by stepping the ball forward — exact, free per step,
and unable to disagree with the simulation about where a rail is.

Measured, 60 matches a pairing:

| | p1 wins | p2 wins | draws | avg rally |
|---|---|---|---|---|
| normal v normal | 28 | 26 | 6 | 13.2 |
| easy v easy | 29 | 31 | 0 | 5.0 |
| hard v hard | 31 | 27 | 2 | 21.4 |
| easy v normal | 0 | 60 | 0 | 7.0 |
| easy v hard | 0 | 60 | 0 | 6.5 |
| hard v normal | 59 | 1 | 0 | 14.9 |

Equal-tier win rates are 48–53%, inside the 45–55% band the bot issue asks for, and the
tiers are strictly ordered.

## Presentation

- **Shared-screen** — the table is symmetric about its own centre line and carries no text,
  so both seats read it upright with nothing rotated. Each seat's points run as pips up its
  own rail, filling *toward* that player.
- **Single-seat** — identical simulation; the shell owns the layout. `game.test.ts` asserts
  the two presentations produce a byte-identical trace from the same seed.

## Rule 7: never colour alone

- p1's racket is solid with a centre spot; p2's is barred across its face.
- p1's point pips are plain; p2's carry a notch.
- The two halves of the table are two shades, so which half is yours survives greyscale.
- A narrowed racket is drawn inside a ghost outline of its full width, so what has been
  lost is visible beside what is left.
