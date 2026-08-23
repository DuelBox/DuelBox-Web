# Fruit Duel — specification

**Archetype:** `rt-split` · **Category:** Reaction · **Logical box:** 640 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

One thing appears between the two players. If it is fruit, cut it — first blade in scores.
If it is not, keep still; cutting scores for the other player. First to ten, thirty rounds
at most.

## Observed rules

From the reference genre: _"Watch the icon in the center and tap the saber as soon as you
see a fruit (watermelon, pomegranate, orange). First to 10 wins."_

## A go/no-go game lives inside forty milliseconds

That single fact decides almost everything below.

**A round is never resolved on arrival.** Both blades are recorded during the step; the
round is settled afterwards, from source times. Deciding as each input landed would hand
the point to whichever seat the loop read first — a coin toss settled by iteration order,
and across two devices, by whoever had the better connection.

**The tolerance is a real draw, not a tie-break.** Two blades inside 8 ms — half a frame at
60 Hz, and the finest distinction a fixed step can honestly make — score for *both*
players. Two people cannot be separated by four milliseconds, and pretending otherwise is
a lie the game would tell sixty times a match. It is the SDK's `resolveSimultaneous`
default, and a test asserts the two agree so they cannot drift.

## The board

| | Value | Why |
|---|---|---|
| Board | 640 × 1000 | Portrait: the two players face each other across the subject |
| Subject | radius 96, at the centre | Radially symmetric — no right way up |
| Wait | 0.7–2.6 s, seeded | A fixed delay is learnable in three rounds, and then it is a rhythm game |
| Showing | 1.6 s | |
| Reveal | 1.0 s | |
| Tie tolerance | 8 ms | |
| Target | 10 points, 30 rounds max | |

**Fruit appears 62% of the time.** Weighted deliberately: at an even split the cheapest
strategy is to keep still, and at four in five a player may as well cut on sight. Between
the two, both decisions cost something.

**A false start ends the wait at once** rather than making the player who jumped sit out
the remaining two seconds. A punishment with no information in it is just a delay.

## Scoring

| | |
|---|---|
| Cut fruit, first | +1 |
| Cut fruit, inside 8 ms of the other | +1 each |
| Cut something that is not fruit | +1 to the **other** player |
| Move before the subject appears | +1 to the **other** player |
| Hold correctly | nothing — being right is not rewarded, being wrong is punished |

Mistakes are scored first and independently, so cutting a bomb costs you even when the
other player also erred.

## The bug that mattered: two bots, one RNG **[ours]**

`normal` against `normal` gave p1 **30 wins in 40**, in a game with no turn order, no
shared board and no seat asymmetry anywhere in its rules.

The two bots share the game's single seeded `Rng`, and the first version drew a *variable*
number of values per round: two normally, three when a false start fired, and none for the
mistake roll on a round it jumped. **A seat whose draw count depends on what it did shifts
the other seat's stream** — and that is a seat bias, not a coincidence. It was invisible
because every individual draw was uniform and every rule was symmetric.

Everything is now drawn in `planRound`, unconditionally: four values, always, whatever they
turn out to be used for. Each seat occupies a fixed window of the stream every round.
`BOT_DRAWS_PER_ROUND` is asserted by a test that counts the draws.

Measured after the fix, 200 matches a tier, as p1's share of decided matches:

| | p1 | p2 | draws | share |
|---|---|---|---|---|
| easy v easy | 98 | 99 | 3 | 50% |
| normal v normal | 99 | 98 | 3 | 50% |
| hard v hard | 106 | 88 | 6 | 55% |

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere in your own half | tap anywhere in your own half |

One press, from either family, and nothing else — there is nothing to aim and nothing to
steer. `actionPressed` is the edge, so a key held down through a round does not cut the
next one as it opens. This is the fairest game in the catalogue across input families for
the simplest possible reason: a key and a thumb are both a single binary event, and neither
can be aimed.

## The bot

Three tiers, expressed only as reaction time and error rates.

| Tier | Reaction | Jitter | Cuts a non-fruit | False starts |
|---|---|---|---|---|
| easy | 0.62 s | ±0.16 | 30% | 10% |
| normal | 0.42 s | ±0.09 | 13% | 4% |
| hard | 0.28 s | ±0.05 | 4% | 1.5% |

Rule 6 is unusually literal here. A human's simple visual reaction is about 250 ms and a
go/no-go decision costs another hundred; `hard` sits at 280 ms, which is a very good person.
A bot reacting in one frame would not be a hard opponent, it would be a wall — a test
asserts no tier's fastest possible blade lands inside 150 ms.

It commits to its whole round before the subject appears — including *whether* it will
misjudge, which means "this round I will get it wrong", not "this round the answer is X".
It still cannot see what is coming. Deciding afresh each step would let a slow tier keep
rolling until it got lucky, which is a bot that improves the longer it waits.

## Termination

Structural. Thirty rounds, each with its own wait and show clocks, so nothing about how the
match is played can extend it. A match where neither player ever moves finishes 0–0 as a
draw in a little over two minutes.

## Rule 7: never colour alone, and never text at all

Nothing on this board is text — a test asserts the renderer's `text` method is never called
— so nothing needs translating and nothing has a right way up. That is what lets one
drawing serve two people sitting opposite each other.

- The five subjects differ by **shape**: a melon is a plain disc with a bright band, a
  pomegranate has six pips, an orange eight segments, a stone three chips, and a bomb a
  fuse and a ring. Fruit-or-not never rests on hue.
- Verdicts are shapes on the player's own side: a tick for a good cut, a cross for a bad
  one, a bar for holding, an arrow for jumping early.
- p1's hilt is a disc, p2's a bar; p2's score pips are split down the middle.
- The wait shows a steady outline and nothing that counts down — a closing ring would give
  the appearance away, and this is a reaction game rather than an anticipation one.
