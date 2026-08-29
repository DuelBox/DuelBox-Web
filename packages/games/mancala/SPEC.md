# Mancala Pits — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~90 s

> Specified alongside the implementation. **[ours]** marks a decision with no basis in
> the observed rules. The name is **Mancala Pits** **[ours]** — the mechanic is ancient
> and unownable, but a distinct name is ours to choose.

## Observed rules

> Move your stones counterclockwise across the board and try to collect more stones than
> your opponent!

The direction and the goal, which leaves the two rules that actually make the game to the
standard variant (Kalah).

## The board

| | Value |
|---|---|
| Pits | 6 per side |
| Stones | 4 per pit, 48 in total |
| Stores | one per seat, at the end of that seat's row |

**Laid out as one ring of fourteen**: 0–5 are p1's pits, 6 is p1's store, 7–12 are p2's
pits, 13 is p2's store. That single decision is what lets sowing be a modular walk with one
skip rather than a pile of special cases, and it is why `oppositeOf` is arithmetic rather
than a lookup table.

p1's row is drawn left to right along the bottom and p2's right to left along the top, so
the drawn ring matches the sowing order.

## Sowing

Take every stone from one of your own pits and drop them one at a time counter-clockwise.

- **Your own store gets a stone as you pass it.**
- **Your opponent's store is skipped entirely** — you never add to their score.

## The two rules that make the game

**Ending in your own store grants another turn.** This is what makes Mancala about
chaining rather than about alternating, and a bot blind to it plays a different game. It
also means the search tree is not strictly alternating — see below.

**Ending in an empty pit on your own side captures it**, along with everything directly
opposite, both going to your store. Three conditions, each tested separately: the landing
pit must be **yours**, it must have been **empty** before the stone arrived, and the pit
opposite must be **non-empty**.

## Ending, and the sweep

**The game ends when *either* side's pits are all empty**, not when both are.

Then **every remaining stone is swept into the store on its own side**. Missing that sweep
is the classic Mancala bug: the game ends with stones stranded on the board and the final
score is simply wrong. A test asserts the two stores add to 48 at the end of a real match,
which is the assertion that would catch it.

The sweep is idempotent, because the end of a game can be reached by more than one path.

## Scoring and the win condition

**Most stones banked.** A draw at 24–24 is possible and handled.

Stones are conserved throughout: a test asserts the total is 48 after every move of a real
game, so a sowing bug that duplicated or dropped a stone shows up immediately rather than
as a strange final score.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap one of your own pits | `A`/`D` or the arrows to pick a pit, Space or Enter to sow |

The cursor walks one row, so only the horizontal axis matters — a `GridCursor` would be a
one-row grid, and the far seat's row is drawn right to left, so "left" for that player
walks the array the other way. Handling that here is clearer than configuring it there.

After a move the cursor moves to the first pit that can actually be played, so a keyboard
player is never sitting on an empty pit wondering why nothing happens.

## Edge cases

- **An empty pit, the opponent's pit, or a store.** All refused, and the turn does not
  pass. `sow` returns `lastSlot: -1` for a refusal, distinct from any legal outcome.
- **A sow long enough to wrap the whole board.** Works, skipping the opponent's store on
  the way round — and if it lands back in the pit it started from, which is now empty, it
  captures. That is correct, and a test pins it because it looks surprising.
- **Input while the board is turning.** Refused, as everywhere.

## Determinism

Bot thinking (0.55 s) and the settle before the sweep (1.2 s) are counted in whole
simulation steps. The stones in a pit are drawn on a deterministic spiral rather than
scattered randomly, so the same board always draws the same way — which matters because a
game may be replayed from a seed.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and this game is
where ignoring it showed worst: on `hard` a solved opening played perfectly is one match
rather than a sample, and it went to seat two all 100 matches of 100. Measured at 50 seeds x
both opening seats, equal tiers: seat one takes **50.0%** on both `normal` and `hard`. Its
`hard` line was deleted from the balance harness's `OUTSIDE_THE_BAND` (#2487).

## The bot

Negamax with an alpha-beta window over the store difference, with stones still in your own
pits worth something but far less than a stone banked — they are yours to sow, and yours to
sweep if the game ends.

**The extra turn is what makes this search unusual.** A move ending in your own store does
not hand over, so the search recurses with the *same* seat to move and the sign unflipped.
Treating an extra turn as a normal move is the bug that makes a Mancala bot blind to the
chains that decide the game. A test asserts the bot takes the free extra turn available on
move one — pit 2, whose four stones land exactly in the store.

Difficulty is search depth and blunder rate, never information. A test plays hard against
easy over ten games with alternating seats.

## Presentations

Rotates to face whoever has the move in shared-screen; never rotates in single-seat. Each
store is ringed in its owner's colour, so whose bank is whose needs no label — and a ring
is a shape as well as a colour.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
