# Sea Battle — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board (see below) · **Round length:** 240 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Each player lays out a fleet on their own ten-by-ten grid, then the two take turns calling
shots at the other's water. A hit buys another shot. Sink the whole fleet to win.

The rules are the easy part. The design problem is that **two people share one screen and
one of them must not see the other's fleet**, and that is what most of this document is
about.

## Hiding a fleet from someone sitting next to you

The obvious answer is a hand-the-device-over ceremony: place, cover the screen, pass, place
again. Real apps do it and it is tedious.

The answer here is that **once firing starts, neither fleet is ever drawn**. A player sees
the enemy water with their own shots on it, and a row of markers counting how many of their
own ships are still afloat — never where those ships are. Solve it in what is rendered and
there is nothing left to hide. A test asserts it directly: for every cell either fleet
occupies, nothing is painted there.

Placement is the one moment a fleet appears, and it is handled by **both seats laying out
at the same time, each on their own half of the device**. Nobody waits, and each player's
half is theirs. **[ours]**

This is honest rather than airtight, and worth saying plainly: a player who leans over
during placement can see their opponent's half, exactly as they could look at your hand of
cards. The game does not show it to them; it cannot stop them looking. Every shared-screen
game here has the same trust model.

## The split changes mid-match

Placement is simultaneous and firing is turn-based, so the device is divided differently in
each. `getActiveSeat()` returns **null while placing** and a seat once firing starts, and
the shell reads the live value: null means no turns right now, so each seat gets its own
zone; a seat means the whole board belongs to whoever is to move.

The shell used to decide this from whether the method *existed*, which allowed only one
answer for a game's whole life. Simultaneous and turn-based turn out to be phases of one
game rather than two kinds of game. `InputManager.setSplit` and the host change that made
this possible went in with this game.

## The board

| | Value | Why |
|---|---|---|
| Grid | 10 × 10 | |
| Fleet | 5, 4, 3, 3, 2 — 17 cells | The classic fleet |
| Touching | forbidden, diagonals included | See below |
| A hit | buys another shot | Makes finding a ship worth something |
| A miss | ends your turn | |

## Ships may not touch

Not decoration. It is what makes **"a sunk ship's neighbours are water"** a sound
deduction, which is the strongest thing a good player knows and the hard bot's best trick.
Without it a sunk ship tells you nothing about the cells around it and the endgame flattens
into a coin-flip sweep.

It also makes placement harder in a way players feel, since a five and a four cannot be
tucked alongside each other.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context. Random fleet layout is
rejection sampling with a bounded attempt count and a deterministic sweep as a fallback, so
a fleet is always complete — a short fleet would make a match unwinnable. Two runs from one
seed produce identical layouts and identical bot play, both asserted.

## The bot

| | Hunts a hit | Parity sweep | Clears a wreck's ring |
|---|---|---|---|
| easy | no | no | no |
| normal | yes | no | no |
| hard | yes | yes | yes |

Every tier sees only which cells have been shot and what those shots found — never the
ship positions, per rule 6. There is a property test for that: moving the fleet without
changing the shot record must not change where the bot fires.

`sunk` reports the ship's extent, which looks like extra information and is not: a ship is
only reported sunk once the bot has hit **every one of its cells**, so it is exactly what a
player would have written down themselves.

The three tricks are the three things that separate a beginner from a competent human.
Hunting a hit is the largest. The parity sweep skips cells no surviving ship could straddle,
halving the board to search. Clearing the ring around a wreck is the deduction the
no-touching rule pays for.

Measured over 1,500 fleets, in shots to clear all five ships (lower is better):

| | Average | Best | Worst |
|---|---|---|---|
| easy | 95.2 | 66 | 100 |
| normal | 66.9 | 31 | 98 |
| hard | 51.7 | 28 | 70 |

Easy is barely better than shooting at random on a hundred-cell board, which is what a
first-time player looks like. Hard sits where a decent human sits, and its worst case of 70
is the honest tail of a bad fleet rather than a guarantee.

## Controls

Turn-based for firing, so W A S D and Space are player one's and the arrows and Enter are
player two's, and the board turns to face whoever is calling the shot. During placement both
halves are live at once, each driving its own seat's half.

Tapping a square places the next ship there; tapping the square the cursor is already on
**turns the ship** rather than placing it on top of itself, which is the only rotation
gesture a one-finger board affords. A placement that would not fit is outlined in red
rather than silently refused.

## Rule 7

A hit cell is crossed once and a sunk cell crossed both ways, so the two are told apart
with the colour removed. A miss is a small dot rather than a filled cell, which keeps the
board readable when most of it has been called. Your own hulls below the board go from
solid to struck-through as they sink.

## Not specified here

Salvo rules, moving ships, aircraft, radar sweeps, larger grids, or the variant where
ships may touch. All are real Sea Battle; none is the version two people play on one phone.
