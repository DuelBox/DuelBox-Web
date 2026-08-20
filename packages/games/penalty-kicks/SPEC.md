# Penalty Kicks — specification

**Archetype:** `rt-split` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** horizontal · **Round length:** 150 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

One player takes the kick, the other keeps goal. Both commit at the same moment and neither
sees the other's choice until it is made. Score or save, then the roles swap. First to five,
and both players always take the same number of kicks.

This is the first game here where **the two players are doing different things at the same
time**. Everything else in this collection is symmetric — both push, both aim, both steer.
Here one seat is choosing where to put a ball and the other is choosing where to throw
themselves, and the whole game is that neither knows.

## Three findings, each of which changed the game

### The match was decided by seat order, not skill

First to five, checked after every kick, hands it to whoever kicks first. Two **identical**
bots playing each other gave the first kicker **63.7%** of matches.

Worse, that number is almost exactly what the difficulty tiers were "winning" by — so the
tiers looked like they were worth something and were worth nothing at all. It only came out
by measuring identical bots against each other, which is a check worth doing on every game
with an alternating turn in it.

A real shoot-out has both sides take the same number of kicks before anyone has won, and
that is the fix: **the winner is decided only on a pair boundary.** Identical bots now sit
at 49.8%.

### With no cost to aiming at a corner, there is no skill

A penalty is a simultaneous guess. If a corner is simply harder to save than the middle and
costs nothing, everyone aims at a corner and the game is a coin flip on which one — and it
is *provably* a coin flip: with the fairness fixed, hard against easy was 50.2%. Against an
opponent mixing at random, no strategy beats the base rate.

So a kick can miss the goal, and the corners are the likeliest to. The top corners are the
worst of both worlds: hardest to reach and easiest to put over the bar.

| | left | middle | right |
|---|---|---|---|
| **top** | 30% wide | 12% | 30% wide |
| **middle** | 14% | 2% | 14% |
| **bottom** | 10% | 1% | 10% |

That turns the choice into a judgement, and judging it well is a skill a bot can have more
or less of. **The best cell is now a bottom corner, not a top one** — 70% of blind kicks
score there against 54% at the top — which is a fact about the game a player can learn and
act on.

The risk is **drawn on the goal** as a row of ticks. A player who cannot see the trade-off
is guessing rather than judging, and this game is meant to be the second thing.

### A keeper must mix far more than a kicker

Both bots share one `focus` — how sharply they concentrate on the best cells — but the
keeper's exponent is a third of the kicker's. A kicker who concentrates is playing well; a
keeper who concentrates is **predictable**, and being read is the only way a keeper loses
badly. The version that shared the exponent made the hardest tier *worse* than the middle
one, 48.8% against it.

The keeper is also valued by **the shots a dive would stop**, not by how good the dive's own
cell is. Those are different: diving at the middle of a row covers all three cells of it.

## The bot

| | Focus | Reads a pattern |
|---|---|---|
| easy | 0 (uniform) | no |
| normal | 6 | no |
| hard | 11 | yes |

An exponent rather than a linear weight, because the values are close together — the best
cell scores 70% blind and the worst 54% — and a linear bias on numbers that close is almost
no preference: the first version produced weights in a 1.3 ratio and the tiers were
indistinguishable.

The hardest tier remembers what the other seat has been doing and shifts its belief toward
it, weighted by how much it has seen so one kick convinces it of nothing. **Reading a
pattern is a skill, not extra information** (rule 6) — a person watching the same keeper
dive left four times running learns exactly the same thing.

Measured over 600 matches a pairing: hard beats easy **60.5%**, hard beats normal **60.2%**,
normal beats easy **56.2%**. Identical bots come out level.

And the number that matters for a person: a human mixing at random scores **63%** against
the easy keeper, **61%** against normal and **60%** against hard. The game is never
hopeless, and the keeper tier is felt without being oppressive.

## Hiding a choice on a shared screen

Two people share the screen, so a choice drawn anywhere is a choice the opponent can read —
and reading it would end the game, because a keeper who sees the shot always saves it.

The first draft drew both cursors **on the shared goal**, which looking at it in a browser
made obviously wrong: a keeper can simply watch the kicker's cursor and know where the ball
is going before it is struck. A cursor is not a commitment, but it is a very good clue.

So each seat has its **own three-by-three selector, in its own half of the screen**. The
shell already divides a `horizontal` split into a bottom seat and a top one, so that half is
theirs; p2's is turned about, because the left of the goal from where they sit is the right
of it on screen. A committed selector shows only *that* it has committed, never where.

The shared goal in the middle shows the reveal and nothing else.

This is as private as anything on a shared screen gets — the same trust model as laying out
a fleet in Sea Battle, and no worse than being able to see an opponent's hand of cards if
you lean over. The pointer path has no leak at all: you tap your own half.

The **risk ticks are on the selectors** rather than on the goal, for the same reason
everything else is: the goal belongs to both players.

## The roles swap every round **[ours]**

Not every match. A shoot-out where one player kicks until they miss is a different game and
a worse one on a shared screen: the other player would sit and watch. And a player who only
ever keeps goal is playing a different, worse game than the one who only ever kicks.

## Controls

Tap the square you want **on your own selector** — the kicker aims there, the keeper dives
there. On a keyboard each seat steers its own cursor and commits with its own action key,
and **both are read every step**, because neither may wait for the other.

The two cursors start on different cells. Identical starting cells put both markers in the
same place, which reads as one confused cursor rather than two players.

## A match always ends

Two players who both save everything would never finish. `roundSeconds` in the manifest is
validated by the schema and read only by the catalogue card — it ends nothing — so the game
caps itself at 24 rounds and takes the higher score, drawn if level. The cap is even, so the
cap itself is not a first-kicker win either.

## Rule 7

p1's marker carries a ring and p2's a bar, on the cursor, on the diving keeper and on the
"who kicks" indicator alike. A keeper is a filled cell and the ball is a disc with a dark
band, so the two are never confused with each other.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context — the only randomness is whether
a kick goes wide, and it is drawn from that. The same seed replays to the same match.

## Not specified here

Run-ups, power, curl, the keeper moving early, sudden death after the fifth pair, or the
ball rebounding off a post. All are real penalties; none of them survives two thumbs on one
phone.
