# Hot Potato — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~90 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A potato on a fuse, thrown back and forth. Whoever is holding it when the fuse runs out
loses the round. You throw by tapping while the marker crosses your target band.

## The bar

One dimension, so the whole skill is **when** and never **where**. The marker sweeps a
vertical bar and wraps; the band is a slice of that bar.

| | Value | Why |
|---|---|---|
| Fuse | 12 s | |
| Sweep | 0.85 → 1.9 bars/s | Faster as the fuse burns, so the end of a round is the hard part |
| Band at first throw | ±0.30 of the bar | Easy enough that anyone can play |
| Band decay | ×0.86 a throw | |
| Band floor | ±0.055 | Never impossible |
| Flight | 0.35 s | |
| Rounds to win | 3 | |

**The band narrows every throw.** That is the whole game: a round ends because the players
ran out of skill rather than because a timer ran out on its own.

A band is placed at least its own width from each end, so it never straddles the wrap
point. A wrapped band would be two bands to look at and one to hit — a puzzle rather than a
test of timing. The first version used a fixed margin and did not survive its own test: at
full width the band ran off the end of the bar.

## Three outcomes, all distinct

`tryThrow` returns **thrown**, **missed** or **refused**, and the difference matters. A
miss costs you the fuse you burn recovering; a refusal is the game telling you it was not
yours to throw. A player who cannot tell one from the other will think the game ignored
them — so a miss is drawn as a cross over the potato, in shape rather than a flicker.

## The fuse burns through a flight

A throw is not a rest. If it were, a player could keep themselves safe by throwing
constantly and the potato would spend the fuse in the air rather than in anybody's hands.

**A catch mid-flight counts against the receiver**, not the thrower: they were about to
hold it, and the alternative punishes a player for a throw that had already left their
hands **[ours]**.

Whoever is caught starts the next round, which hands them the throw and is the closest
thing this game has to a comeback rule.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap your half | Space or Enter |

**One press, one throw.** A button still held when the game pauses is treated as already
down on resume, so a paused player does not come back having thrown.

## Determinism

Every band placement comes from the seeded RNG; everything else is the fixed delta. A match
replays identically from its seed.

## The bot

| Tier | Aim | Reaction | Freeze |
|---|---|---|---|
| easy | 1.50 | 0.30 s | 25% |
| normal | 1.10 | 0.18 s | 7% |
| hard | 0.80 | 0.13 s | 2% |

`aim` is how much of the band the bot trusts itself to use, from the centre out. **Below 1
it commits to the middle and lands; above 1 it grabs at the edge and misses.** That is the
whole skill, and it is the same skill a person has: a good player commits early enough to
land inside a narrow band, a poor one is late and clips the edge.

Measured over forty matches a pairing: hard beats normal **88%** and both beat easy. The
first hard tier beat normal **100%**, which is a wall rather than an opponent — the same
objection raised against Cornhole's first bot, and it applies just as well here. It now
misses sometimes.

No tier reacts faster than a person, and none sees anything a person cannot: the marker and
the band are on screen for both players the whole time.

## Presentations

Neither the presentation nor the local seat is read, deliberately. One bar, shared, read
the same way up by both players — and each seat's own potato already sits nearest to them.
There is nothing to rotate and nothing to mirror.

## Rule 7

The potato is round in p1's hands and squared off in p2's, so a glance at the silhouette
answers the only question that matters when the fuse is nearly out. The fuse itself is a
**length** as well as a colour: colour alone would tell a colour-blind player nothing about
how long they have.

## Not specified here

Art, audio and haptics. This is the game in the catalogue that most obviously wants a
ticking sound, and there is not one.
