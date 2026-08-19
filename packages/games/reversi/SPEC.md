# Reversi — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~90 s

> Specified alongside the implementation. **[ours]** marks a decision with no basis in the
> observed rules.

## Observed rules

> Fill the board with more pieces of your color than the opponents to win!

One sentence, and it describes the *goal* rather than the mechanic. Everything about how
pieces change hands is the standard game, which is not ours to invent and not theirs to
own.

## The board

| | Value |
|---|---|
| Grid | 8 × 8, 64 squares |
| Board | 720 × 720 units, origin (90, 90); cell extent 90 |
| Opening | Four pieces on the centre four squares, **diagonally paired** |

The opening four are diagonal by rule. Placing them in blocks instead is a classic bug: it
mirrors every opening and quietly changes the whole game, while looking plausible. A test
pins the exact four squares, and another asserts each seat has exactly four opening moves
— if it is not four, the flanking rule is wrong.

## The rule everything follows from

A move is legal only where it **flanks**: the placed piece must sandwich an unbroken run of
the opponent's pieces against one of your own, in at least one of eight directions. Every
flanked run flips.

A run counts only when it is unbroken opponent pieces *terminated by your own*. Running off
the board flanks nothing; an empty square breaks the run. Both are tested, because both are
easy to get wrong in a way that produces a game that almost works.

That single rule gives the game its character: a board can swing completely in one move, so
counting pieces mid-game tells you very little — which is why the bot does not score by
piece count.

## Scoring and the win condition

**Most pieces when the game ends.** A draw is possible and handled.

**The game ends when *neither* seat can move — not when the board is full.** This is the
distinction most implementations get wrong. A game ends early when one colour is wiped out
or both seats are blocked, and treating a full board as the only end condition leaves such
a game unable to finish at all. A test builds a nearly empty board that is genuinely over.

## Passing

**A seat with no legal move passes.** This is a real position in Reversi rather than an
error, and the turn returns to the other player without a move being made.

The game holds a pass for about 0.9 s **[ours]** so the other player can see it happen. A
turn that silently bounces back looks like the game ignored their opponent.

Two passes in a row is the end of the game.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap any square marked with a dot | Arrows or `W A S D` to move between squares, Space or Enter to place |

The shared `GridCursor` fits here, unlike in Dots and Boxes: the playable positions are
squares on a rectangular grid, which is exactly what it models.

**Every legal square is marked with a dot.** Not a hint in the sense of advice — which
squares are legal is a fact about the position that a player is entitled to see, and
working it out by eye in eight directions is bookkeeping rather than skill. A physical set
makes it obvious too, since you can see which runs you would flank.

## Edge cases

- **A tap on a square that flanks nothing.** Refused, and the turn does not pass.
- **A tap on an occupied square, or off the board.** Refused.
- **A legal move always flips at least one piece**, so `applyMove` returning 0 could only
  ever mean "refused" — which is why it returns -1 instead, and why a test asserts no
  legal move ever reports 0.
- **A move never grants another turn**, however many pieces it flips. Unlike Dots and
  Boxes, where completing a box does.
- **Input while the board is turning.** Refused, as in every turn-based game here.

## Determinism

Bot thinking (0.5 s), the pass hold (0.9 s) and the settle after the last move (1.1 s) are
counted in whole simulation steps. The only randomness is the seeded RNG, for blunders.

## The bot

Negamax with an alpha-beta window, over a positional evaluation rather than a piece count —
because piece count is nearly worthless before the endgame.

The square-value table is the interesting part. **Corners can never be flipped**, since
nothing can flank them, so they are the only permanent squares on the board and are worth
far more than anything else. The squares diagonally adjacent to a corner are the *worst* on
the board, because playing one hands the corner over. Mobility is added on top: having
moves your opponent lacks is real material here, since a player with no move must pass and
hand over the initiative.

**A pass is a position inside the search**, not an error: the search recurses with the turn
handed over and the depth unchanged. Two passes in a row scores the finished position
decisively rather than positionally.

Difficulty is **search depth and blunder rate**, never information — every tier sees exactly
the board a human sees. A test plays hard against easy over ten games with alternating
seats, so a first-move advantage cannot account for the result.

The search reuses one board per ply, so no node allocates.

## Presentations

Rotates to face whoever has the move in shared-screen; never rotates in single-seat.

Pieces carry a shape as well as a colour — p1's has a centre dot, p2's a ring — so the two
are separable in greyscale and to a colour-blind player. That matters more here than in
most games, since the entire board is pieces.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
