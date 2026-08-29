# Ludo Dash — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 150 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Three tokens each. Roll a six to bring one out; walk it round the shared loop and up your
own home column. **Get one token home and you have won** — the race, not the full
four-token game, which is what the reference genre does on a phone and what
`data/catalog.yaml` records as observed.

Land on an opponent and they go back to the start. That capture is the whole of the
interaction: without it two players roll dice at each other in parallel and never meet.

## The board is a ring **[ours]**

A full Ludo board is a cross with four arms. Two seats do not need four, and a ring puts
every square the same distance from the die in the middle — so no square is harder to reach
with a thumb than another, which on a phone matters more than the shape being traditional.

Thirty-two squares, the two entries opposite each other so both laps are the same length,
each entry painted in its seat's colour because where you join is the one thing a new
player has to be shown.

A home column of five runs inward from each entry. **A token in its home column is off the
shared loop and cannot be captured**, which is what makes reaching it worth something. It
must land on home exactly; overshooting is not a move.

A six earns another roll, which stops a bad run of dice from being hopeless.

## This game is mostly the die, and the numbers say so

Worth stating plainly rather than dressing up. Measured over 400 matches a pairing:

| | Result | Average length |
|---|---|---|
| hard v easy | 60.5% | 36 turns |
| normal v easy | 56.5% | 36 turns |
| hard v normal | 51.7% | 34 turns |
| hard v hard | 49.0% | 33 turns |

The tiers are ordered, and a 60/40 edge is a real edge for a dice race — but it is not
chess, and the reason is measurable: **66.9% of all decisions have only one legal move.**
Two thirds of the time there is nothing to decide. Difficulty can only act on the other
third.

### The skill this game does not have

Avoiding capture is the main skill in ordinary Ludo, and it is the first thing I reached
for. `isThreatened` is implemented and tested — but **the bot deliberately does not use
it**, because it was measured and it is worth nothing here.

Wiring it into the hard tier changed the chosen move on almost every unforced turn and
moved the win rate by **−0.2 points against `easy` and −0.7 against `normal`**. Nothing, or
slightly worse.

The reason is the ruleset: winning means getting **one** token home, so being sent back
costs one of three tokens rather than the race, and dodging is not worth the tempo. Keeping
an expensive behaviour that changes every decision and no outcome would have been
decoration, so it came out.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetGame`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat one
takes **50.0%** of 100 decided matches, and all 50 seed pairs end differently when only the
opening seat changes.

## The bot

| | Blunder rate | Hunts captures |
|---|---|---|
| easy | 0.60 | no |
| normal | 0.20 | yes |
| hard | 0 | yes |

It scores each legal move by how far the token would have come, a bonus for reaching the
safety of the home column, and a bonus for landing on an opponent. Going home is worth more
than all of it and has to be said so explicitly: a capture scores 300 plus how far the
victim had walked, which can beat a home move scored on distance alone — **without the
special case the bot takes the capture and declines to win the game.** A test makes the two
compete.

Every tier sees the board a human sees, per rule 6.

## Controls

Tap to roll, then tap the token you want to move. On a keyboard, the action key rolls and
then moves the token under the cursor, which steers left and right. W A S D and Space are
player one's, the arrows and Enter player two's, and the board turns to face whoever is
playing.

**Tokens that cannot take this roll are drawn hollow**, so a player is never left tapping a
dead one and told nothing. Only the *active* seat's are hollowed — doing it to the
opponent's as well made their whole side look dead when all it meant was that it was not
their turn.

## A turn with nothing in it

A roll that no token can take is held on screen for a second before the turn changes hands.
A turn that silently bounces back looks like the game ignored someone.

That check runs where the position is read rather than where the die is rolled. Tying it to
the roll left a stuck state reachable: anything that put the game in `choosing` by another
route sat there for ever with no move and no pass.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context. The same seed replays to the
same board at every sampled second.

## Rule 7

p1's tokens carry a ring and p2's a bar, on the board and at the start alike, so the two
sides are told apart with the colour removed. A token that has reached home carries a
further ring, and the token under the cursor a wider one.

## Not specified here

Four players, four tokens each and having to bring them all home, blocks, safe squares, or
the rule that three sixes forfeit the turn. All are real Ludo; none of them survives a
board two people share on a phone.
