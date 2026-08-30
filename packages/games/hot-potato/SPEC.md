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
| Sweep | 0.85 → 1.25 bars/s | Faster as the fuse burns, so the end of a round is the hard part |
| Band at first throw | ±0.30 of the bar | Easy enough that anyone can play |
| Band decay | ×0.86 a throw | |
| Band floor | ±0.15625 | **Derived**: `MIN_TRANSIT × MAX_SWEEP ÷ 2`. See below |
| Window floor | 0.25 s | One simple visual reaction. Never impossible |
| Flight | 0.35 s | |
| Rounds to win | 3 | |

**The band narrows every throw.** That is the whole game: a round ends because the players
ran out of skill rather than because a timer ran out on its own.

A band is placed at least its own width from each end, so it never straddles the wrap
point. A wrapped band would be two bands to look at and one to hit — a puzzle rather than a
test of timing. The first version used a fixed margin and did not survive its own test: at
full width the band ran off the end of the bar.

## Difficulty is a window, not a width

What a player actually has is `transit = 2 × band ÷ sweep`: how long the marker spends
inside the target. The band's width alone says nothing, because a band is only hard in
proportion to how fast the marker crosses it.

Band and sweep both push transit down, and until #2507 they were set independently and
compounded. Band decayed ×0.86 a throw towards ±0.055 while sweep climbed towards 1.9,
which produced this, measured at the top sweep:

| Throw | Band | Player's window | easy | normal | hard |
|---|---|---|---|---|---|
| 0 | 0.300 | 0.316 s | lands | lands | lands |
| 3 | 0.191 | 0.201 s | acts, never lands | lands | lands |
| 5 | 0.141 | 0.149 s | cannot act | cannot act | lands |
| 6 | 0.121 | 0.128 s | cannot act | cannot act | cannot act |
| 12 | 0.055 | **0.058 s** | cannot act | cannot act | cannot act |

Two things are wrong with that, and the second is the worse one. From the sixth throw no
bot tier could act at all, so `easy` and `hard` became the same opponent and the round fell
to whoever happened to be holding it — the difficulty a player chose quietly expiring
part-way through the match. And a **person** was out of it sooner still: against ~0.25 s of
simple visual reaction, the window was already too short at the *second* throw, and by the
floor it was 0.058 s, a quarter of a reaction.

So the floor is now derived rather than chosen:

```
MIN_BAND = MIN_TRANSIT_SECONDS × MAX_SWEEP ÷ 2      = 0.15625
2 × MIN_BAND ÷ MAX_SWEEP = MIN_TRANSIT_SECONDS      = 0.25 s, exactly, always
```

Raising the sweep now widens the floor in step, so the two cannot silently compound again.
`MAX_SWEEP` came down from 1.9 to 1.25 to buy the band back its range: the total ramp is
fixed by the start and the floor, and `MAX_SWEEP` only decides how much of it is the band
narrowing and how much is the marker speeding up. The band narrowing is the game, so it
keeps the larger share.

What the ramp does now, at the top sweep: **0.480 s → 0.413 → 0.355 → 0.305 → 0.263 →
0.250 s from the fifth throw on.** At a full fuse the same bands give 0.706 s down to
0.368 s. The floor is deliberately the *conservative* human number: this bar is a
predictable, constant-speed target, so a person timing the marker's arrival beats their own
raw reaction time, and 0.25 s is a floor nobody bumps into by being slow.

Rule 6 is what forces this shape. The fix could not be to give the bots a faster reaction —
that is exactly the thing rule 6 forbids — so it had to be the ramp.

### It was also the seat lean

Fixing the ramp removed a seat asymmetry nobody had connected to it. Measured over 200
seeds of equal-tier self-play, seat one's share of decided matches:

| Tier | Before | After |
|---|---|---|
| easy | 95.0% | 49.5% |
| normal | 91.5% | 50.0% |
| hard | 63.5% | 53.5% |

Which is what the defect had to do. Once the window shut, neither seat could throw again, so
the round went to whichever seat was *not* holding it at that moment — and since seat one
throws first, the parity of the exchange decided the round rather than either player. The
lean was the ramp, seen from the other end.

Note for whoever owns `apps/web/src/data/balance-aggregate.test.ts`: its
`OUTSIDE_THE_BAND` records this game at 92.0% on `normal` and 94% on `easy`. Both are now
stale and inside the band.

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
| easy | 1.50 | 0.30 s | 80% |
| normal | 1.10 | 0.18 s | 55% |
| hard | 0.80 | 0.13 s | 5% |

`aim` is how much of the band the bot trusts itself to use, from the centre out. **Below 1
it commits to the middle and lands; above 1 it grabs at the edge and misses.** That is the
skill a person has too: a good player commits early enough to land inside a narrow band, a
poor one is late and clips the edge.

`reaction` is a **cost**, not a gift — the bot has to stay inside its window that long
before it commits, so a shorter reaction is a better player. It is never shortened to
rescue a bot from a window that has closed; that is what the window floor is for.

`freeze` is hesitation: the chance of letting a whole pass of the marker go by. It is
rolled **once**, when the marker enters the window, and held until it leaves.

Measured over forty matches a pairing: **hard beats easy 95%, hard beats normal 90%, normal
beats easy 80%.** Per-tier throw rates over throws six and later, across 240 matches:
**easy 3.3, normal 10.3, hard 29.8** throws per thousand steps of holding the potato — a
ladder that is still a ladder in the last third of a round, which a win rate alone cannot
see. A test asserts those rates, not just the win rate, because #2504 paid for that lesson.

It was 100% and 88% before #2507, and those numbers were not earned. `freeze` was 25/7/2%
and did **nothing**: drawn afresh every step, the chance of never throwing across a k-step
window is freeze^k, so normal's nominal 7% was one in fourteen million. What actually
separated the tiers was the ramp shutting the window on both seats — they differed only in
*which of them was still holding it* when the game became unplayable for both. Giving the
window a human-playable floor removes that separator, so the tiers now have to be told apart
by something a person also does, and `freeze` was made real and sized to do the work. This
is the same failure the SDK's `bot-judgement` module was written to prevent — an error drawn
every step averages to nothing — arriving by a different route.

No tier sees anything a person cannot: the marker and the band are on screen for both
players the whole time. And no tier can act inside a window a person could not, because the
window has a floor of one simple visual reaction and every tier's own window is that floor
scaled by its `aim`.

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
