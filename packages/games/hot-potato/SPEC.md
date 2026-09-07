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

**Round one's holder is `context.openingSeat`**, never a literal `p1` — see below.

## Seat balance

Measured by `apps/web/src/data/balance-aggregate.test.ts`, fifty seed pairs, both bots on
the same tier, seat one's share of decided matches:

| tier | before | after |
|---|---|---|
| easy | **94.0%** | **50.0%** |
| normal | 96.0% (92.0% at 1000 seeds) | **50.0%** |
| hard | 58.0% | **50.0%** |

It is a **parity** bug, and the comeback rule above is the half of it that hides the other
half. Two equal bots make the same number of throws in a twelve-second fuse — five on
`easy`, seven on `normal` — and that count is **odd**, so the seat caught is the seat that
did *not* start the round. The loser then opens the next round, so the catch alternates
seat by seat; and `TARGET_ROUNDS` is **three, also odd**. Compose the two and the seat that
held the potato first wins 3-2 in every match that is not disturbed by a missed throw.
`resetGame` handed that seat to a literal `p1`, so seat one won 94 to 96 of every hundred.
`hard` is only 58% because its bots miss often enough to break the parity sometimes — the
same bug, sampled through more noise, which is why one tier is never an answer.

Three changes, all structural rather than tuned:

- **The first holder is `context.openingSeat`.** The shell already alternates the opener
  between the rounds of a best-of; this reads it.
- **The bots' rolls are drawn by role — holder first, then the seat waiting — never by
  seat.** Both draw from the one match generator, so whoever is driven first takes the
  first number, and driving `p1` first made a seed opened from one chair a different match
  from the same seed opened from the other.
- **`step` no longer names a seat.** When a settling round could not say who was caught it
  fell back to a literal `'p1'`. That line is unreachable in real play — settling is only
  ever entered by a catch — but a seat written as a constant is not covariant under the
  half-turn, and the mirror test in `rules.test.ts` reaches it and fails on it. The
  fallback is now `game.holder`.

Together those make a seed and its mirror **one match and its exact reflection**, so the
50.0% above is a symmetry proof rather than a measurement: `game.test.ts` asserts winner,
scoreline *and step count* mirror for every seed at every tier, and `rules.test.ts` asserts
the same one step at a time over 600 random boards whose fuse, flight and settle are whole
numbers of fixed steps — so a fuse expiring on the very step a flight lands, the case that
decides who is caught, happens by construction rather than by luck.

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
