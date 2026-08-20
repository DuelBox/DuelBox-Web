# Crabby Volley — specification

**Archetype:** `rt-split` · **Category:** Sports · **Logical box:** 1000 × 620 ·
**Zone split:** vertical · **Round length:** ~120 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two crabs, a net between them, and a ball. Move along your own half and jump; the ball
bounces off whatever it touches. Let it land on your side and the other player scores.
First to five.

This is the first game here with **continuous physics that both seats share at once**. What
that demands is discipline rather than cleverness: it has to be deterministic, it must not
wedge, and neither player may reach into the other's half.

## The court

| | Value | Why |
|---|---|---|
| Court | 1000 × 620, floor at 560 | |
| Net | top at 340, 8 either side | Low enough that a serve clears it — see below |
| Crab | radius 44, speed 400 | Small enough that standing in the wrong place costs you |
| Ball | radius 26, gravity 900 | Falls more slowly than a crab, so a rally is readable |
| Jump | 760, gravity 1750 | Up and back down in about 0.9 s |
| Serve | 520 across, no drop | |
| Target | 5 points | |

**Neither crab may cross the net**, whatever it holds down and wherever it points. The rule
lives in `steer` alone — a second copy in the game module was redundant, which a mutation
of it failing no test is exactly how I noticed.

## The paddle model

Where the ball strikes a crab decides where it goes: middle sends it up, edge sends it
sideways, bounded by a maximum return angle. A moving crab tilts it a little further, so a
player can chase and place.

The obvious model — sending the ball out along the line between the two centres — made the
game **chaotic rather than skilful**: a crab standing slightly off returned the ball at a
wildly different angle, so standing in the right place paid nothing. Swept against a fixed
opponent, every bot lever came back as noise between 33% and 67% with no trend at all, and
the baseline scored 58% against *itself*.

## Why a rally ends

Three separate things had to be true, and each was wrong first:

1. **A strike loses energy.** `STRIKE_DECAY` is 0.88 and nothing is added. The first
   version took `max(430, speed)` — a *floor* — which made the rally a perpetual motion
   machine. Normal against normal scored **zero points in four hundred seconds**.
2. **A moving crab aims rather than adds power.** Adding the crab's velocity afterwards
   let a jump put in far more than the decay took out: a jump is 760 and half of that
   dwarfs a 12% loss.
3. **A dead ball is not returned.** Below `MIN_RALLY_SPEED` the ball drops through to the
   floor and the point ends. Without this a rally does not end even with decay, because a
   ball with no energy left **rests on a crab and is struck again every step** — a few
   units up, a few down, for ever, with the crab holding it off the floor.

A serve at about 500 falls under the threshold after nine touches, so a rally is bounded at
roughly nine returns. Measured: matches finish in about 78 s with rallies of about 7.5 s.

## The serve

It goes **over the net**, as a serve does, from above the server's own half.

Dropping it straight down on the server's head was the first version and it was quietly
fatal: the server had to keep their own serve up, could only knock it straight back up
again, and eventually lost the point — then served again. **Whoever served first lost 0-5
every time, at every tier.**

The net then had to come down (300 → 340) and the serve had to lose its initial drop,
because the first serve could not clear the net: it had to cross 220 units before falling
the 100 that would bring it into the net's top, and it managed 163.

Whoever loses a point serves the next one, which keeps a one-sided match from running away.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Drag on your half to move, tap to jump | `A`/`D` or arrows to move, `W` or Space to jump |

**One press, one jump.** A held button pumping the crab up the screen would make jumping
the whole game, and a button still held when the game pauses is treated as already down on
resume.

## Determinism

Every serve nudge comes from the seeded RNG, and the whole simulation is the fixed delta.
A match replays byte-identically from its seed.

## The bot

| Tier | Reaction | Look-ahead | Slop | Jump rate |
|---|---|---|---|---|
| easy | 0.42 s | 0.4 s | 110 | 2.2/s |
| normal | 0.24 s | 0.8 s | 55 | 1.2/s |
| hard | 0.10 s | 1.4 s | 18 | 0.8/s |

Measured over forty matches a pairing: **hard beats easy 75%, normal beats easy 70%, hard
beats normal 58%**, with no seat bias.

Four things about this bot are worth carrying to the next physics game:

- **It predicts where the ball comes down, not where it is in a fixed time.** A fixed
  horizon has the bot standing where the ball will be *after* it has gone by, so the tier
  that looked furthest ahead aimed most wrongly — it lost 65% of its duels to the tier that
  barely looked at all.
- **It runs the real physics to predict.** Straight-line extrapolation is worse the further
  ahead it looks, because the ball bounces.
- **It commits to its misjudgement.** A fresh random offset sixty times a second **averages
  to zero**, so the crab hovered on exactly the right spot however large its supposed
  error, and the tiers meant nothing.
- **Jumping more is worse, and the rate falls as the tier rises.** A crab in the air
  returns the ball more steeply and keeps a rally alive, so jumping at everything is a
  novice's habit that costs points. Swept against a fixed opponent, 0.5–1.4 won 65% of
  duels while 2.6 and 4.0 won 50% and 45%.

No tier reacts faster than a person: even `hard` at 0.10 s is quick within human range
rather than past it.

## Presentations

Neither the presentation nor the local seat is read, deliberately. The court is split left
and right, so both players read it the same way up — there is nothing to rotate and nothing
to mirror. A `turn-board` game needs `seatView`; a side-by-side one does not, and
pretending otherwise would add a branch that could only ever be wrong.

## Rule 7

p1 is a round crab with two eyes, p2 is squared off with a single band, and the ball has a
stripe so it is not a plain disc next to a pale crab. In a fast game with shapes bouncing
about, the silhouette is what a player actually tracks.

## Not specified here

Art, audio and haptics. Also unmodelled: spin, and any interaction between the two crabs.
Both are deliberate — the crabs cannot reach each other, so they cannot collide.
