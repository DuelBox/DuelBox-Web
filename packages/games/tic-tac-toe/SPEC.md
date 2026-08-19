# Tic Tac Toe — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~60 s

> **Written from the implementation, not before it.** Every number was read out of the
> source rather than remembered. Decisions with no source in the observed rules are
> marked **[ours]**.

## Observed rules

> Get three in a row! Tap a square to place your mark.

## The board

| | Value |
|---|---|
| Board | 660 × 660 units, origin at (120, 120) inside a 900 × 900 box |
| Grid | 3 × 3, cell extent 220 units |
| Mark radius | 66 units |

One shared board rather than a split, which is why the play area rotates to face whoever
has the move.

## Scoring and the win condition

**Best of five rounds; three round wins takes the match.** **[ours]** — a single game of
noughts and crosses between two competent players is a draw, so one round is not a match.

A round is won by three in a row, or drawn when the board fills. The round outcome is
reported to the shell rather than derived from a score, because "a line of three" is not
something a generic win condition can express — see `match.ts` and its `outcome` field.

The starting seat alternates between rounds, so neither player has the first-move
advantage twice running.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap the square you want | Arrows or `W A S D` to move a cursor, Space or Enter to place |

The keyboard cursor is `GridCursor` from the engine. It stays **invisible until a
direction is pressed**, so a player who only taps never sees a highlight they did not
summon; and a tap moves it to where the finger went, so switching to keys continues from
there. It moves in the *player's* frame, so the far seat's "up" is the board's "down".

## Edge cases

- **A tap on an occupied square.** Ignored; the turn does not pass.
- **A tap while the board is turning.** Refused entirely. The cell under a finger is
  moving, so a tap would name one the player did not mean — see determinism below.
- **A press with no pointer.** Only a key can produce this, since a tap always carries its
  position, so it places at the cursor.
- **Board full with no line.** A drawn round. It still consumes one of the five, or a pair
  who draw repeatedly would never finish a match.
- **Both seats acting at once.** Impossible: only the active seat's input is read.

## Determinism

Both delays — 0.45 s of bot thinking and 0.9 s of settle after a round — are converted to
**whole simulation steps** before being counted down, so a replay produces the same match
on any machine. Nothing reads the wall clock.

The seat flip is the subtle part. Input ownership must change at a **single instant**
rather than continuously: interpolating the mapping through the turn would put a tap
halfway through into whichever seat frame timing happened to favour. So the settled
orientation holds for the whole flip and input is refused while it runs.

## The bot

Minimax over nine cells — exhaustive, so the hard tier is unbeatable, which is correct for
this game. Easier tiers blunder with a declared probability rather than searching less
deeply, so the difficulty is in the errors rather than in the information.

## Presentations

- **Shared-screen.** One board, rotating 180° to face whoever has the move.
- **Single-seat.** Upright, never rotating. The turn indicator in the shared HUD carries
  the cue the flip would otherwise give.

## Not specified here

Art and audio, cross-device play, and the fairness audit each have their own issue.
