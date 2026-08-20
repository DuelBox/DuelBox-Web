# Colour Wars — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~240 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A six-by-six grid. Add a dot to a cell that is empty or already yours. A cell holding as
many dots as it has neighbours **bursts**, sending one dot into each neighbour and turning
every one of them your colour — and those may burst in turn.

## The geometry, which is the game

| Cell | Neighbours | Bursts at |
|---|---|---|
| corner | 2 | 2 dots |
| edge | 3 | 3 dots |
| middle | 4 | 4 dots |

A corner is therefore the **cheapest** place to build a threat and the middle the most
expensive, which is the opposite of most board games and is what makes this one feel
different to play. Capacity is computed from the position rather than tabled, so the two
can never disagree.

## Rules

- You may place into an empty cell or one of your own, **never** the opponent's. Ground
  changes hands only by bursting.
- A bursting cell **spends everything** rather than keeping a remainder — otherwise one
  cell could burst repeatedly from a single placement.
- A burst turns every neighbour your colour, whoever held it.
- A cascade stops when the opponent has nothing left, because it has nothing further to
  decide. Without that a won position can cascade for a very long time.
- A seat loses when it holds no cells — but only **once it has had a turn**. Without that
  the game ends on the very first move, with the second player beaten before touching
  anything **[ours]**.

## Scoring

Cells held, not dots. First to hold everything wins.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap an empty cell or one of your own | Arrows or `W A S D` to pick a cell, Space or Enter to add a dot |

The keyboard cursor dims on a cell you cannot play, so the refusal is explained *before* it
happens rather than after.

## Determinism

The bot's blunder rolls come from the seeded RNG; the think delay is counted in whole
simulation steps, sized on the first update once the step rate is known.

## The bot

| Tier | Depth | Blunder |
|---|---|---|
| easy | 1 | 60% |
| normal | 2 | 20% |
| hard | 3 | 0% |

Every tier sees exactly the board a human sees. The evaluation counts cells and dots, but
the term that matters is the third: **a cell one dot from bursting beside an enemy cell is
a threat, and one beside an enemy threat is a liability.** That is the whole tactical
texture of the game, and a bot without it plays Colour Wars as a filling exercise.

## Rendering

Dots are laid out so their count reads at a glance — one centred, two across, three in a
triangle, four on a diamond — and **a cell one dot from bursting is ringed**. That ring
matters more than it looks: knowing which cells are primed *is* the game, and counting
three dots against four across thirty-six cells under time pressure is exactly what a
player should not have to do. It is a shape, so it survives greyscale (rule 7), as does the
seat difference: p1's dots are round, p2's are square.

## What this game found

**A tap in the far half of the device did nothing, on every turn-based shared board.**

The seat zones exist so that two people playing *at once* each own their own touches. A
turn-based board rotates to face whoever has the move, so its far side sits in the other
seat's zone — and every tap aimed there was attributed to a player whose turn it was not,
and dropped. In Tic Tac Toe the far row of cells could not be reached by touch at all.

Ten shared-board games had it, and it had shipped, because the tap test aimed at a point
"well clear of the seat midline" — that is, only where it already worked.

The fix is in the engine and the host: a new `'shared'` zone split hands the whole surface
to one seat, and the host gives it to whoever is to move. The discriminator is
`getActiveSeat`, not the manifest's `zoneSplit` — Whack a Mole is a shared board too, but
both seats swing at it simultaneously, so it needs its zones exactly as much as Tic Tac Toe
needed to lose them.

## Not specified here

Art, audio and haptics. A cascade is the thing in this game that most wants a sound.
