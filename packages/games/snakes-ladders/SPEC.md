# Snakes and Ladders — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~150 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.
> Every number below was read out of the code rather than remembered.

## Observed rules

> Roll a die to move across the board. Land on a ladder to climb higher, or a snake to slide
> down. First to reach or pass the last field wins!

That is the whole of it, from `docs/observed-rules.md`, and it settles less than it looks.
It fixes the topology — a numbered track, forward jumps, backward jumps, a finish you may
overshoot — and leaves open the board size, the layout, whether a snake can bite twice,
and, most importantly, **whether the player ever decides anything**. Read literally there is
exactly one legal action per turn, which is a problem this spec has to solve rather than
inherit: a game with no decision cannot have honest difficulty tiers, only rigged dice.

## The one rule we added, and why **[ours]**

**Two dice are rolled each turn and the player moves by one of them.** The other is
discarded.

This is the whole design. It leaves every roll fair — both dice come from the same seeded
stream, neither is nudged, nobody rerolls — and puts all of the skill in reading the board:
one die may drop you on a snake and the other on a ladder, and you can see both before you
choose. It also means the bot has something real to be good or bad at, which is the only way
rule 6 ("bots never get information, speed, or physics a human cannot get") and a
three-tier difficulty selector can both be true at once.

Measured over 3,600 bot matches, **81% of turns offer two different destinations**. The
remaining 19% are the turns where both dice land you in the same place — usually a double —
and there is genuinely nothing to decide.

Rejected alongside it, and worth naming so nobody re-derives them:

- **Two tokens each, move one of them.** A real decision, but it is Ludo Dash's decision,
  and we already ship it.
- **Pass the unused die to your opponent.** Interesting, but it takes their choice away on
  their own turn, which is worse than having no interaction at all.
- **Bumping the opponent's token back.** The only interaction that fits a race — and it
  breaks the termination proof below, because backward movement would stop being bounded.

## The board

| Constant | Value | Why |
|---|---|---|
| `COLUMNS` × `ROWS` | 8 × 8 | 64 fields is about nine turns a side with two dice. Ten by ten was the classic size and twice the match for no extra decision. |
| `FIELDS` | 64 | Fields are numbered 1–64; field 0 is the start, off the board. |
| `DICE` | 2 | The decision. See above. |
| `DIE_FACES` | 6 | A die. |
| `LADDERS` | 6 | 3→19, 9→28, 17→35, 24→41, 33→50, 44→58 |
| `SNAKES` | 6 | 21→6, 30→12, 38→23, 47→26, 54→37, 61→45 |
| `SNAKE_BUDGET` | 102 | The sum of the six drops. The termination proof is built on it. |
| `MAX_TURNS_PER_SEAT` | 166 | `FIELDS + SNAKE_BUDGET`. The worst case, proved rather than sampled. |

The board is a **boustrophedon**: field 1 is bottom-left, the bottom row runs right, and
every row above it doubles back. That is what lets a ladder reach across the board rather
than only up one file, and it is asserted in `rules.test.ts` because getting it wrong draws
every jump as a diagonal.

Three properties of the layout are enforced by tests rather than by care:

- **No jump lands on the mouth of another.** A chain would fire two jumps from one roll, and
  a chain that came back on itself would fire for ever.
- **No snake head shares a field with a ladder foot.**
- **Nothing at all sits on field 64.** The finish is never guarded, which matters below.

Geometry, all in logical units and never in pixels (rule 8): `CELL` 88, board from x 98 to
802 and y 72 to 776, `TOKEN_RADIUS` 26, the two seats offset within a shared field by
`TOKEN_OFFSET` 18 horizontally and `TOKEN_STAGGER` 10 vertically so they sit on a diagonal
rather than touching. The dice tray is below the board: two 88-unit boxes at y 792 with a
40-unit gap, and the two waiting tokens either side of it at x 170 and x 730.

## Scoring and the win condition

`resolve({ kind: 'first-to', target: FIELDS }, position)` — the SDK's helper, exported from
`rules.ts` as `WIN_CONDITION` and never a comparison written by hand. The tally each seat
reports is simply the field it stands on, so the shell's HUD shows the race itself.

Reaching **or passing** field 64 wins. There is no exact finish and no bouncing back off the
end; `settle` clamps anything past 64 to 64.

After a move the turn changes hands once the move has been *seen* — 0.3 s for a plain move
and 0.6 s for a snake or a ladder. A win is held for 1.0 s before the winner is reported, so
the last slide is on screen when the result panel arrives.

## The match always ends

`termination.test.ts` plays two `easy` bots and fails a game that cannot finish in ten
simulated minutes. Snakes and Ladders is the classic way to fail it: a long snake near the
finish plus an exact-finish rule makes a match that can run for ever. Neither of those
exists here, and the guarantee is deterministic rather than probabilistic.

Three layers, in order of strength:

1. **No exact finish.** "Reach or pass" is the observed rule, and it removes the endgame
   bottleneck entirely — there is no shuffling about below 64 waiting for the right number.
2. **Nothing sits on the last field.** No snake can take the win away at the moment it is
   won.
3. **A snake bites a given player once.** **[ours]** Once it has swallowed you it is full,
   and its head is spent for you for the rest of the match — marked on the board in your own
   seat's shape so you can see it. This is the layer that makes the bound *provable*:

   > A player's total backward movement over a whole match is at most `SNAKE_BUDGET` = 102
   > fields, fixed before the first roll. Every turn moves them forward by at least 1. So
   > after T turns their field is at least `T − 102`, and they must be past field 64 by turn
   > `64 + 102 = 166` — whatever the dice do, however badly they choose.

   `rules.test.ts` proves it by playing the adversarial case a person would contrive: every
   die a one, for ever. That loop terminates here and does not terminate with snakes that
   bite repeatedly.

The arithmetic against the guard: a turn costs at most 0.4 s of bot thought before the roll,
0.4 s before the choice, and 0.6 s of showing a slide — 1.4 s. Two seats at 166 turns each is
332 turns, or **465 s**, inside the guard's 600 s with a settle second to spare. In practice
it is nowhere near that: the longest of 3,600 measured bot matches was **54 turns in total**,
and the average is 16 to 25 depending on the tiers.

## Controls

| Seat | Keyboard | Pointer |
|---|---|---|
| Player one | `A` / `D` move between the two dice · `Space` rolls, then moves by the selected die | Tap anywhere to roll · tap a die, or the square you want to move to |
| Player two | `←` / `→` move between the two dice · `Enter` rolls, then moves | The same; the board belongs to whoever is to move |

The two halves of the keyboard belong to two different people and nothing remaps them, so
each seat's keys only do anything on that seat's turn. The manifest strings say exactly
this, and `game.test.ts` asserts each claim in them against the behaviour the tests already
prove — control strings that lie are the recurring bug in this repository.

The two sources combine with no mode to switch between: the cursor is invisible until a
direction key wakes it, and a tap acts directly without moving it out from under anybody.

**A tap is never dead.** Inside a die box it is that die; anywhere else it is read as "take
me there" and picks the die whose landing — or whose snake or ladder destination — is nearest
the finger. Both dice are always legal, so there is nothing a tap could sensibly be refused
for, and a refused tap in a game offering exactly two choices only ever reads as the board
ignoring somebody.

Both places this roll could put you are drawn on the board while you choose, with the die
face in each and a line down the snake or up the ladder if one is waiting there. Without
that the decision the whole game rests on becomes mental arithmetic every turn.

## Edge cases

- **Simultaneous input.** Impossible to act on: only the seat to move is read, and the
  engine gives the whole board to that seat. The other seat's keys and fingers do nothing.
- **No input.** Nothing happens, for ever, and that is correct — a turn game with a human
  seat waits. The match clock is the shell's business, not the game's.
- **Input in the other seat's zone.** `zoneSplit: shared-board`, so there is no other
  seat's zone; the host hands the whole surface to whoever is to move.
- **A tap off the board.** Answered rather than swallowed, as above. Tested at (−400, −400).
- **Both dice the same.** 19% of turns. Both ghosts land on one square, the cursor still
  works, and either choice does the same thing.
- **Landing on a snake you have already been down.** Nothing happens; the status line says
  "That snake has already eaten" so a player is not left wondering whether it broke.
- **Both tokens on one field.** They sit on opposite diagonals of it, 41 units apart against
  a token radius of 26.
- **Stalemate.** There is none. The proof above is the reason: no position exists from which
  the finish is unreachable, and no player can be sent backwards indefinitely.

## Determinism

- **All randomness is seeded.** Both dice come from the one `Rng` on the context. There is
  no `Math.random` and no wall clock anywhere in the package.
- **Every delay is counted in simulation steps**, derived once from the first fixed delta.
- **Every delay is a whole tenth of a second** — 0.4, 0.3, 0.6, 1.0 — so each is a whole
  number of steps at 60, 90 and 120 Hz and the same seed plays the same match on all three.
  A test asserts it at all three rates.
- Nothing integrates or decays, so there is no per-step multiplier to get wrong.
- `update` allocates nothing: the hit test compares squared distances through scalar
  `tokenX`/`tokenY` rather than the object-returning `tokenCentre`, which only `render` and
  the tests use.

## The bot

It reads the board, the two dice that were rolled, its own field, and which snakes have
already eaten it. All of that is drawn on the screen in front of both players — the spent
snakes are marked in each seat's own shape precisely so that the information the hard tier
uses is information a person has too (rule 6). It never rerolls, never sees a die before it
is rolled, and never touches the dice.

| | Blunder rate | Foresight | What it actually does |
|---|---|---|---|
| easy | 0.80 | 0 | Four turns in five it grabs a die without looking at where it goes. |
| normal | 0.20 | 0 | Takes the die that leaves it furthest along, ladders and snakes included. |
| hard | 0 | 0.7 | The same, plus what the square it lands on exposes it to next turn. |

`foresight` weights `outlook(field)`: the average over all thirty-six pairs of dice of the
better of the two landings from that field — which is exactly the choice the player will
face next turn. It is what tells the hard tier to stop one short of the ladder at 44 rather
than one short of the snake at 47, and it correctly stops fearing a snake that has already
had it.

The blunder roll is drawn even at a rate of zero, so the three tiers consume the seeded
stream the same way when they agree, and a difference between two traces means a different
*decision* rather than a different dice sequence.

### Measured, over 400 matches a pairing

| | Win rate for the row | Average turns |
|---|---|---|
| hard v easy | **84.5%** | 18.0 |
| normal v easy | 79.5% | 19.1 |
| hard v normal | 65.8% | 17.0 |
| easy v easy | 51.2% | 25.2 |
| normal v normal | 53.5% | 17.8 |
| hard v hard | 55.0% | 16.1 |

The tiers are strongly ordered, which is worth noting because the sibling dice game could
not manage it: Ludo Dash tops out at a 60/40 edge because two thirds of its turns have only
one legal move. Here 81% of turns are a genuine choice, so difficulty has something to act
on nearly every turn.

**The seat that rolls first has an edge**, and the mirror matches are how it shows: 51.2% at
easy, 53.5% at normal, 55.0% at hard. It grows with skill because better play shortens the
race, and in a race whoever arrives first wins. It is the same order as moving first in
Checkers, and it is small next to the 84.5% a hard tier takes off an easy one — the tier,
not the seat order, decides a match. Nothing in the SDK rotates who opens across a rematch;
that is a catalogue-wide gap rather than this game's, and it is noted at the end.

## Presentations

Per `docs/presentation.md`. **Shared-screen**: one board, all of it, handed to whoever is to
move — `zoneSplit: shared-board` — and the whole board turns 180° through `SeatFlip` so each
person reads it upright on their own turn. Input is refused mid-flip, so nobody acts on a
board that is halfway round. **Single-seat**: the same board, never rotated, the local seat
always upright. The rules and the simulation are byte-identical; only the rotation differs.

## Rule 7, colour never alone

- Seat one's token is a disc with a ring; seat two's is a disc with a bar. Same shapes as
  Ludo Dash, so a pair who learn them in one game keep them in the next.
- The seat to move carries a further white ring, so the board says whose turn it is on its
  own as well as through the shell's banner.
- A ladder is two rigid rails with four rungs; a snake is one curved body with a head and an
  eye. Each also carries a chevron — up or down — and the number of the field it leads to, in
  the square it starts from.
- Every one of the 64 fields is numbered.
- A spent snake is marked with the ring or the bar of the seat it is spent for.

## What is not specified here

- ~~**Who opens.**~~ **Answered.** It was seat one, always, in every turn game in the
  catalogue — the issue this entry reported. `match.ts` alternates the opener across the
  rounds of a best-of now (#2466) and publishes it as `context.openingSeat`; `resetPosition`
  reads it (#2487), so the first-mover edge measured above washes out over a match instead of
  landing on the same chair every time. The balance harness measures seat one at **50.0%** of
  100 decided matches at 50 seeds × both opening seats on `normal`, and all 50 seed pairs end
  differently when only the opening seat changes. What is still open is #2489: the bot ladder
  above was measured from one seat order and so carries the first-mover edge inside its tier
  numbers.
- **Interaction between the players.** There is none: two tokens race up one board and never
  affect each other. Every mechanism that would add some — bumping, blocking, stealing a die
  — either breaks the termination proof or takes a decision away from the person whose turn
  it is. If a future issue wants interaction, it has to say what it does to the bound.
- **A rematch on a different board.** The layout is fixed and hand-authored so that a player
  can learn it, which is most of the skill. Generating a seeded board per match would make
  the hard tier's foresight worth more and the human's memory worth nothing.
