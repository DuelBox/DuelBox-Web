# Paint Fight — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 960 × 1080 ·
**Zone split:** horizontal · **Round length:** 45 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Both players roll across one shared board leaving colour behind them. Roll over what the
other player has painted and it becomes yours. Most of the board after forty-five seconds
wins.

This is the first game here scored by **territory** rather than by events. Everything else
counts goals, pots, pellets or rounds; here the score is a property of the whole board,
recomputed as it changes. That difference drives most of what follows.

## The score is walked, never accumulated

Painting over the other player changes two counts at once, and a cell can change hands many
times in a round. A running total is a bookkeeping bug waiting to happen, and the board is
576 cells, which is nothing. So both counts are computed by walking the board, and a test
asserts the three shares — yours, theirs, bare — always add up to the whole of it.

## The board

| | Value | Why |
|---|---|---|
| Grid | 24 × 24, 40-unit cells | |
| Roller | radius 56 | Nearly three cells across — see below |
| Speed | 300 a second | |
| Turn rate | 4.2 rad/s | |
| Round | 45 s | The only way the game ends |

**A roller paints a disc, not a point.** Painting only the cell under its centre leaves a
one-cell trail that no amount of driving fills in. The first radius tried was 34 against a
40-unit cell — barely wider than one cell — and a second of driving covered 18 cells; the
trail read as a pencil line rather than a paint roller. At 56 it covers 29.

**A wall turns a roller rather than stopping it.** A roller that stops is a roller that
paints one cell for ever, and a player who has run into a wall would have nothing to do but
turn around.

## Three findings about the bot

### The lookahead has an optimum, so it cannot be the difficulty

Swept head to head against 0.5 s, in percentage points of the board:

| lookahead | against 0.5 s |
|---|---|
| 0.25 s | −18 |
| 0.4 s | +3 |
| 0.6 s | −7 |
| 0.9 s | −5 |
| 1.4 s | −20 |

Too short and it cannot see round a corner; too long and it commits to a direction that is
good far away and bad right now. The first draft used it as the difficulty axis and made
the hardest tier **the worst one**, losing 37–58 to the weakest. Every tier now shares 0.5 s.

### The fan size is the axis that actually orders

Swept against a nine-wide fan: three is **−53** points, five is −13, fifteen is +2, and
twenty-one is **+10**. Monotonic, so that is what the tiers differ by — 3, 9 and 21.

### A tie has to be broken by the seed, not by the loop

The fan is built in pairs — straight ahead, then rank one to the left, then rank one to the
right — and the search kept a candidate on a strict `>`. So every tie went to whichever of a
pair was enumerated first, which is always the left one. On an empty board almost every
option ties, so the whole opening was a fixed script, and with no other randomness anywhere
in the game **fifty seeds produced one distinct match on every tier**. A tied heading is now
taken uniformly at random from the tied set by reservoir sampling, at no cost in strength:
the options it chooses between score the same.

### The fan must be dense near straight ahead

Spaced evenly, a fan's finest step is several times what one decision can turn, so every
option but "straight" clamps to full lock and the roller can only spin. A *wider* fan made
it worse. With the original long lookahead this was catastrophic: two of the hardest tier
covered 14% of the board each in a full round, against 69% for the weakest one alone.

Squaring the spacing fixed that. Measured again after the lookahead was corrected, the
squared fan is worth **1 to 3 points** at every tier — small, consistent and free, so it
stays. It is `fanOffset`, named and tested on its own rather than buried in the search.

## The bot

| | Fan | Lookahead | Counts their colour double |
|---|---|---|---|
| easy | 3 | 0.5 s | no |
| normal | 9 | 0.5 s | no |
| hard | 21 | 0.5 s | yes |

Taking a cell **off** the other player swings the gap by two rather than one, which is why a
good player chases rather than colouring in the corners. Only the hardest tier knows that.

Re-measured over twelve seeded rounds a pairing, as shares of the board: hard beats easy
**72–20**, hard beats normal **61–26**, normal beats easy **65–31**. Symmetric pairings come
out level — 48–47, 44–42 and 34–32 — and the seat share across a seed and its mirror is not
level but *exactly* one half, for the reason in "Neither seat, ever" below.

Its estimate of a heading never exceeds what driving that heading would really paint — the
samples along a path overlap heavily, and a bot that counts the overlap believes a slow,
tight turn is the most valuable move on the board. There is a test that drives the path and
compares.

Every tier sees the board a human sees, per rule 6.

## Controls

The **direction of the drag**, as in Snake Clash and for the same reason: the shell gives
each player half the screen, so a player whose roller is in the far half could not point
ahead of it. A relative drag works from anywhere in your own half. There is no stop.

The manifest used to name the seats by position — "A and D steer **the left roller**, arrow
keys the right" — and that is #2488. Nothing about this game keeps a roller on a side: both
free-roam one shared board and have swapped halves within seconds, so a player who reads the
line before the match finds their roller on the wrong side during it. Since the opening
became seeded it is not even true at kick-off, because the corner a seat starts in follows
the opening seat rather than the label. The line names **colour and mark** instead — "seat
one, the red ringed roller; seat two, the blue barred one" — which rule 7 already requires
the rendering to carry, and which is true for the whole round.

## The score is one bar, not two numbers **[ours]**

A pair of numbers is the wrong shape for a territory game. What a player needs to know is
who is ahead and by how much, which a bar says at a glance and two numbers do not — and the
bare share drawn between them says how much is still to play for.

## Rule 7

A seat's paint carries its colour **and** a pattern: p1's cells a dot in the corner, p2's a
bar along the top. Two blocks of flat colour side by side are the whole picture in this
game, so telling them apart without the colour is not a detail. The rollers repeat the same
two marks and each shows the way it is pointing.

## Neither seat, ever

The balance harness recorded this game three times, and all three lines are now deleted:
seat one took **100.0%** of 100 decided matches on `easy`, and on `normal` and `hard` **not
one match of 2000 was decided at all** — every single one ended 245-245. Those were the same
defect seen from two sides, and the flat draw was the more misleading half of it.

The two rollers started on marks that are exact half-turn images of one another, the bot used
no randomness whatsoever, and every rule in `rules.ts` treats the seats identically. So both
rollers played the identical round rotated through 180 degrees, and the two counts could not
do anything **but** tie to the cell. And because nothing read the seed, the hundred matches
the sweep played were one match counted a hundred times — `distinct 1`. On `easy` the
three-heading fan is coarse enough that the last-bit disagreement between `cos(h + π)` and
`−cos(h)` eventually pushes one roller off its mirror; the single match that exists then went
to seat one, and "100%" was a sample of one.

Underneath that, `step` painted p1's disc and then p2's, so **every cell the two rollers
crossed together went to whoever was painted second**. The comment above it claimed the
opposite. It never showed as a seat advantage because the overlap was symmetric too: two bugs,
each hiding the other, behind a number that read as a proof of fairness.

Three changes, and the third is the one that makes the first two provable:

- **Cells under both rollers change hands for nobody.** A rule two people can watch happen,
  and the only version of it that does not depend on a loop order.
- **The opening heading and the bot's tie-breaks come from the seed**, one stream a roller.
- **The marks and the streams are handed out by the opening seat, not by the seat label.**

That last one is what turns a measurement into a proof. The sweep plays every seed twice, once
per opening seat; those two rounds are now the same round with the labels exchanged, bit for
bit, so whichever seat wins one the other wins the other and seat one's share is *identically*
one half. Measured at fifty seeds: **50.0% on easy, normal and hard, 100 distinct matches, no
draws.** A test plays a full round both ways and asserts the final boards are exact
relabellings, and a `describe('the mirror')` block asserts the property function by function
over hundreds of random boards, exactly rather than approximately.

## Determinism

No wall clock and no `Math.random`: one `Rng` from the context, split into one stream a roller.
The same seed and the same opening seat replay the same round.

## A round always ends

On the clock, and only on the clock: nobody can be eliminated, so there is nothing else that
could end it. `roundSeconds` in the manifest is read only by the catalogue card, so the game
holds its own.

## Not specified here

Power-ups, obstacles, more than two rollers, or a brush that changes size. All are real
paint games; none of them is needed to make two people fight over a board.
