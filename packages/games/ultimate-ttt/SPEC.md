# Ultimate Tic Tac Toe — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~90 s

> Specified alongside the implementation. **[ours]** marks decisions with no basis in the
> observed rules.

## Observed rules

> Play on a big board with nine small tic-tac-toe games. Where you place your mark tells
> the other player where they must play next. Win small boards, then get three small
> boards in a row to win.

The most complete rule text in the catalogue, and it names the mechanic that matters.

## The board

Nine small boards in a three-by-three arrangement, each of nine cells: 81 in total. Cells
are indexed small-board-major, so `boardOf` and `cellOf` are integer arithmetic and a test
asserts the mapping is a bijection over all 81.

## The rule the game turns on

**Where you place your mark decides which small board your opponent must play in next.**

So every move is two decisions at once: what it does *here*, and where it *sends them*.
That is what makes this one game rather than nine.

**The escape:** if the board a player is sent to is already decided or full, they may play
anywhere. Without it a player could be sent somewhere with no legal move and the game
would deadlock. A test drives a whole real match asserting the active seat always has at
least one legal move.

## Winning

A small board is won by three in a row inside it, or drawn when it fills with no line.

The match is won by **three small boards in a line**. If no line exists and no small board
is still playable, it is decided on **count** **[ours]** — the natural tie-break, and
better than declaring a draw when one player clearly took more of the board. Equal counts
are a draw.

The HUD shows **small boards won**, which is the number that tells a player how the match
is going. Cells taken would be a much larger number that means much less.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap a square in the highlighted board | Arrows or `W A S D` to move, Space or Enter to place |

**The cursor walks a flat nine-by-nine grid**, which is what a player sees, while the
rules index by small board. The two conversions live in one place in the game module and
nowhere else. A cursor trapped inside one small board would make most of the grid
unreachable from the keyboard.

## Feedback

**The board you must play in is highlighted.** That is the game's most important piece of
feedback: without it a player has to work out where they are allowed to move from the
previous move's cell, every single turn, which is bookkeeping rather than thinking. When
the choice is free, every playable board lights.

A won small board carries one large mark over it, so the big grid reads at a glance
without counting.

## Edge cases

- **A move outside the board you were sent to.** Refused, and the turn does not pass.
- **An occupied cell, or a decided or full small board.** Refused.
- **A tap in the gap between small boards.** Belongs to neither and is ignored — the gaps
  are real space on screen, so a tap can genuinely land there.
- **Input while the board is turning.** Refused, as everywhere.

## Determinism

Bot thinking (0.55 s) and the settle (1.2 s) are counted in whole simulation steps. The
only randomness is the seeded RNG, for blunders.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and this game is
where ignoring it showed worst: on `hard` two near-perfect bots play the *same game* every
time, and it went to seat one all 100 matches of 100. Measured at 50 seeds x both opening
seats, equal tiers: seat one takes **50.0%** on both `normal` and `hard`. Its `hard` line
was deleted from the balance harness's `OUTSIDE_THE_BAND` (#2487).

## The bot

Negamax with an alpha-beta window. The evaluation weights a won small board far above the
cells inside it, weights corners and the centre above edges on both scales, and — the part
specific to this game — **treats sending the opponent to a free choice as a real cost**.
That freedom is usually worth more than whatever the move gained, and a bot that ignores
it plays every move as though it were ordinary noughts and crosses.

A decided position is scored by depth, so the bot prefers a win sooner and a loss later
rather than treating all wins as equal.

Difficulty is search depth and blunder rate, never information. A test plays hard against
easy over eight games with alternating seats.

## Presentations

Rotates to face whoever has the move in shared-screen; never rotates in single-seat.

p1 is a ring and p2 a cross — shape as well as colour, which matters doubly here because
the same seat's mark appears at two very different sizes and must read as the same player
at both.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
