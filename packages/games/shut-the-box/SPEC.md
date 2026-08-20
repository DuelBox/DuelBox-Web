# Shut the Box — specification

**Archetype:** `turn-board` · **Category:** Dice · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 150 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Nine numbered tiles stand open. Roll two dice, then shut any set of open tiles adding up
to the roll. Keep going until no set adds up; what you failed to shut is your score. Both
players take a full turn, and the **lower** score wins.

Two things make this the odd game in the collection. It is the first where **randomness
drives play** rather than decorating it, and it is the first where **scoring down is the
goal** — which the shell's HUD had to be told about rather than left to infer.

## The box

| | Value | Why |
|---|---|---|
| Tiles | 1–9, total 45 | |
| Dice | two, six-sided | |
| One-die rule | offered once the highest open tile is below 7 | See below |
| Turn ends | when the roll cannot be made | |
| Score | the tiles left standing, lower wins | |

## Where the game actually is

Luck rolls the dice; judgement spends them. **A roll can usually be made several ways, and
which tiles you spend decides what you can still reach.** Shutting 7 as 7 keeps 3 and 4
available; shutting it as 3 + 4 keeps the 7. Every roll is that choice.

The bot's hardest tier is built on exactly this and nothing else — see below.

## The one-die rule

Traditional, and it earns its place. Once 7, 8 and 9 are shut, the best possible two-dice
roll is larger than anything the remaining tiles can make, so a player who has done well
would be punished for it. Below that threshold the player chooses one die or two, and it
is a real decision: with only the 1 left, one die makes it one time in six and two dice
never can.

`roll()` clamps to two dice whenever the rule does not apply, so a caller cannot roll one
with the 9 standing.

## No confirm button **[ours]**

Picking a tile that would take the total past the roll is refused. So the instant the
picked total matches the roll exactly, there is nothing further a player could want to
add — and the set is shut there and then. Choosing 7 rather than 3 + 4 is expressed by
which tile is tapped first, not by a separate confirmation.

That removes a control from a screen two people share, and loses nothing.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context — this is the first game here
where that rule does real work, since the dice *are* the game. The same seed replays to
the same open total at every sampled second, which a test checks by tracing two runs.

`legalSets` returns bitmasks rather than arrays so the bot search allocates nothing per
candidate, and `canMake` answers reachability with a nine-pass bitmask sweep rather than
enumerating all 512 subsets.

## The bot

| | Blunder | Looks ahead |
|---|---|---|
| easy | 0.65 | no |
| normal | 0.20 | yes |
| hard | 0 | yes |

Every tier sees the open tiles and the roll, and nothing else — no reroll, no peek at the
next die, per rule 6.

Without lookahead the bot uses the standard heuristic, "shut the highest tiles first".
With it, a candidate is also scored by the **chance the next roll can be made from what it
leaves** — computed over all 36 face pairs, weighted honestly, because 7 is six times as
likely as 2 and that skew is the whole shape of the risk.

Measured over 2,000 turns a tier, in tiles left standing (lower is better):

| | Average | Median | Shut the box |
|---|---|---|---|
| easy | 18.35 | 18 | 3.1% |
| normal | 14.05 | 13 | 6.1% |
| hard | 11.28 | 10 | 7.8% |

The two heuristics agree more often than they disagree, which made testing the lookahead
harder than writing it — see below.

## Controls

Turn-based, so both key halves drive whoever is playing and "A and D **or** the arrow
keys" is the truth here rather than the lie it is in a simultaneous game. Left and right
also choose between one die and two when that option is on offer.

Pointer play is tapping: the roll control, then tiles. A tap in the gap between two tiles
is ignored rather than rounded to a neighbour — with a roll of 3 the difference between
tile 1 and tile 2 is the whole move.

## Presentations

**Shared-screen** — one box, rotated 180° to face whoever is playing, with the frame in
that seat's colour. Nothing is accepted while the board is part-way round: the tile under
a finger is moving, so a tap would name one the player did not mean.

**Single-seat** — identical box, never rotated, since the local player owns the screen.

## Rule 7

A shut tile is **struck through** as well as darkened, and the number greys out. Fill
alone would be invisible to a player who cannot separate the two greys. A picked tile
carries a heavy inset border in the active seat's colour, which is a shape difference as
well as a colour one.

The dice are drawn as pips, not numerals — a die a player has to read as a number is not a
die.

## What testing this taught

The lookahead term was deleted from the source and **every test still passed**. The
fixture chosen to prove it — open 1, 2, 3, 4, 6 with a roll of 6 — was one where "shut the
highest" and "keep the box makeable" happen to choose the same tile, which the test's own
comment admitted without drawing the conclusion. The balance test did not catch it either,
because removing lookahead degrades normal and hard equally and leaves the ordering intact.

The replacement was found by sweeping all 512 boxes against all eleven rolls for the pair
that separates the two heuristics most: **open 1, 2, 4, 5, 6, 8 with a roll of 11**, where
shutting high takes 1 + 2 + 8 and leaves a box that survives half the time, and looking
ahead takes 5 + 6 and leaves one where every roll from 2 to 12 can still be made.

## Not specified here

Three or more players, the twelve-tile variant, betting, or the rule where a shut box ends
the match immediately. All are real Shut the Box; none improves two people and one device.
