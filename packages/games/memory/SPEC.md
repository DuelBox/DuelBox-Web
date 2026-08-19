# Memory Match — specification

**Archetype:** `turn-board` · **Category:** Memory · **Logical box:** 800 × 1000 ·
**Zone split:** shared-board · **Round length:** ~90 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

## Observed rules

> Find the matching pairs! Tap two cards to turn them over.

## The table

| | Value |
|---|---|
| Cards | 16, in 8 pairs |
| Grid | 4 × 4, pitch 170 units, card 150 units |
| Origin | (60, 190) |
| Glyphs | 8 distinct shapes |

**Glyphs rather than colours** **[ours]**, and this is the important decision in the game.
A memory game whose pairs are distinguished by colour alone is unplayable for a colour-blind
player — and unlike a seat colour, there is no shape to fall back on because the shape *is*
the information. Eight shapes, each distinct in silhouette.

## Scoring and the win condition

**Most pairs when all sixteen cards are matched.** With 8 pairs there is no possible draw
in pairs found, though a 4–4 split is possible and resolves as a draw.

Finding a pair **keeps the turn** — the rule that makes the game about memory rather than
luck, since a player who remembers can clear the table in one visit.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap a card | Arrows or `W A S D` to move a cursor, Space or Enter to turn one over |

Same `GridCursor` as the other turn-based games, with the same invisible-until-used rule.

## Edge cases

- **Tapping an already face-up card.** Ignored.
- **Tapping the same card twice.** Ignored; the second tap is not a second choice.
- **Tapping during the reveal delay.** Ignored — a mismatched pair is visible for 0.9 s
  before turning back, and taps in that window would be made on information the player has
  not had time to read.
- **A press with no pointer.** Turns over the card at the cursor.
- **Input while the table is turning.** Refused.

## Determinism

The three delays — bot thinking 0.5 s, match reveal 0.4 s, mismatch reveal 0.9 s — are
counted in whole simulation steps. The card layout comes from the seeded RNG, so a
rematch with a new seed deals differently and a replay of the same seed deals identically.

## The bot

Holds a memory of cards it has seen, sized by difficulty: the easy tier forgets most of
what it has seen, the hard tier forgets nothing. **It only ever remembers cards that have
been face up**, so it never uses information a human at the same table did not also have —
which is CLAUDE.md rule 6 and the only honest way to make a memory bot harder.

## Presentations

Rotates in shared-screen, never in single-seat.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
