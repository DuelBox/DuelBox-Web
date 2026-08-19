# Dots and Boxes — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~90 s

> This one was specified alongside the implementation rather than after it, which is the
> intended order and is worth noting because the first seven were not. **[ours]** marks a
> decision with no basis in the observed rules.

## Observed rules

> Take turns tapping horizontal or vertical lines to connect the boxes. The player who
> completes a box gets a point and another turn.

Unusually complete for this catalogue — most entries are one clause. The rule that matters
is stated outright: completing a box grants another turn.

## The board

| | Value | Why |
|---|---|---|
| Boxes | 5 × 5 | **[ours]** Large enough for chains to form, small enough to finish inside a minute or two |
| Dots | 6 × 6 | Implied by the boxes |
| Edges | 60 — 30 horizontal, 30 vertical | |
| Pitch | 120 units, origin (150, 150) | |
| Tap reach | 44 units from an edge's midpoint | Comfortably under half the pitch, so the zones cannot overlap |

Edges are indexed horizontals first, then verticals, which makes `isHorizontal` a
comparison rather than a lookup.

## Scoring and the win condition

**Most boxes when every edge is drawn.** One round; there is no best-of, because a full
board already takes a minute or two.

**Completing a box grants another turn**, and that single rule is the entire game. A chain
of boxes falls to whoever opens it, so the skill is not in taking boxes — it is in
choosing which edge to give away, and in sacrificing a short chain to avoid opening a long
one.

With 25 boxes a draw is arithmetically impossible. The check exists anyway: change the
board to 4 × 4 and a draw becomes reachable, and a rule that silently stops being true is
worse than one that was always explicit.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap the line you want to draw | Arrows or `W A S D` to move between lines, Space or Enter to draw |

**The keyboard cursor is this game's own rather than the shared `GridCursor`**, and the
reason is the interesting part. The playable positions are the gaps *between* dots, so the
lattice is two interleaved grids of different shapes — 5 × 6 horizontals and 6 × 5
verticals. Moving between them is the whole navigation problem and a rectangular cursor
cannot express it.

The cursor finds the nearest edge inside a 45-degree cone in the direction pressed. The
obvious first attempt — nearest, with sideways drift penalised — was written and rejected
because it kept the cursor on whichever lattice it started in: from a horizontal edge, the
horizontal edge directly below scored better than the vertical edge that was actually
nearer, so **half the board was unreachable from the keyboard**. A test asserts both kinds
are reachable.

## Edge cases

- **A tap on an edge already drawn.** Refused, and the turn does not pass. `applyMove`
  returns -1 rather than 0 for this, because "refused" and "legal but scored nothing" mean
  opposite things for whose turn it is, and a caller that confuses them hands the turn
  over on an illegal move.
- **A tap nowhere near an edge.** Ignored.
- **One edge completing two boxes.** Both are claimed and the player still goes again. The
  shared edge between two boxes each on three sides.
- **Who owns a box.** Whoever drew the fourth side, not whoever drew the first three.
- **Input while the board is turning.** Refused, as in every turn-based game here.
- **A press with no pointer.** Only a key can produce one, so it draws at the cursor.

## Determinism

Bot thinking (0.4 s) and the settle after the last edge (1.1 s) are counted in whole
simulation steps. The bot's only randomness is the seeded RNG — for its blunders and for
choosing among equally safe edges.

## The bot

The strategy every human learns, at three levels of reliability:

1. Complete a box if one is available. Free, and it grants another turn.
2. Otherwise play a **safe** edge — one that leaves no box on two sides, since a box on
   three is a gift.
3. If every move gives something away, give away the **least**: prefer the edge opening
   the shortest chain, because the opponent takes the whole of whatever is opened.

`chainLength` walks the consequence: taking a box usually exposes the next, and a player
who opens a chain of five loses all five. It simulates the move on the real board and
restores it unconditionally rather than on a success path — mutating a shared board inside
a search is a bug factory.

The subtle part, and the one I got wrong first: the edge is **not yet drawn** when
`chainLength` is called, so a box that will be given away is one currently on *two* sides.
Counting boxes already on three counts boxes that were free before this move and have
nothing to do with it.

Difficulty is in the **errors**, never in the information: every tier sees exactly the
board a human sees. That is CLAUDE.md rule 6, and this game makes it easy to break — a bot
that counted chains a player could not see would be unbeatable and would feel like
cheating rather than like a strong opponent.

## Presentations

Rotates to face whoever has the move in shared-screen; never rotates in single-seat.

## Not specified here

Art and audio, cross-device play, and the fairness audit. Each has its own issue.
