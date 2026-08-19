# Drop Four — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~90 s

> **Written from the implementation, not before it.** Numbers read from source.
> **[ours]** marks a decision with no source in the observed rules.

## Observed rules

> Drop your discs and get four in a row to win!

## The board

| | Value |
|---|---|
| Grid | 7 columns × 6 rows, cell extent 105 units |
| Board | 735 × 630 units, centred horizontally, origin y = 210 |
| Disc radius | 42 units |
| Hover row | One cell above the board, where the waiting disc sits |

The name is **Drop Four** **[ours]**, not the reference app's. The common name for this
mechanic is genuinely descriptive and the trademarked one is not ours to use.

## Scoring and the win condition

**Best of three; two round wins takes the match.** **[ours]** A round is won by four in a
row in any direction, or drawn when the board fills. As with Tic Tac Toe the outcome is
reported rather than derived, because "four in a row" is not a generic condition.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Drag over a column, release to drop | Arrows or `A`/`D` to slide across, Space or Enter to drop |

The two idioms differ deliberately. The pointer **commits on release**, so a finger can
slide along the columns and see where the disc will land before letting go — the thing a
touchscreen can do that a key cannot. A key press drops immediately, because there is
nothing to preview.

Arming only over a column is what stops a tap on the chrome either side from dropping a
disc.

## Edge cases

- **A full column.** The drop is refused and the turn does not pass.
- **A gesture that starts on the board and ends off it.** Keeps its aim; the drop
  commits at the last valid column.
- **A gesture that starts off the board.** Never arms.
- **Input while the board is turning.** Refused, for the same reason as Tic Tac Toe.
- **Board full with no line.** A drawn round, which still consumes one of the three.

## Determinism

Bot thinking (0.5 s), the drop animation (0.25 s) and the settle after a round (1 s) are
all counted in whole simulation steps. The drop animation is presentational only — the
disc's final position is decided the instant the move is made, so a slow device does not
land it elsewhere.

## The bot

Negamax with alpha-beta pruning and a positional heuristic that values the centre column,
which is the strongest opening in this game. Easier tiers search shallower **and** blunder;
neither tier is given information a human looking at the board lacks.

## Presentations

As Tic Tac Toe: rotates in shared-screen, never in single-seat.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
