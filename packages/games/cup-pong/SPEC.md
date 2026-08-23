# Cup Pong — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured with `/tmp/cp-*.mjs` against `dist/rules.js`.

A table seen from above with a rack of six cups at each end. A needle sweeps a line across
the table; press to keep it. A marker then runs out along that line; press again and the ball
goes. Land in one of the opponent's cups and it comes off the table. Clear all six of theirs
and the match is yours.

## Observed rules

From the reference genre: _"Throw balls into your opponent's cups. Land in the cup to remove
it. First to clear all your cups wins."_

The catalogue row for this game describes the throw as a swipe. **We did not build a swipe**,
and that is deliberate — see immediately below. Everything else in the row is as built.

## Aiming is two presses, never a drag **[ours]**

A drag hands a thumb a continuous quantity a key cannot match, and CLAUDE.md rule 10 says one
build serves every device. A press is one binary event with a timestamp on a phone, a
trackpad and a keyboard alike, and neither instrument can place it more finely than the
other.

Two presses, because a throw needs two numbers: the first keeps the **line** and the second
the **distance along it**. They are polar coordinates with one dial each, and they are drawn
as exactly that — the line is a ray from the throwing spot and the second needle is a marker
sliding up it, so what the second press is choosing is literally where the ball will land.
No gauge anywhere on the table needs translating into a position.

## The ready pause is in the rules, not in the shell **[ours]**

The shell turns the table to face whoever is throwing and refuses human input for the 0.36 s
that takes. **A bot does not go through the shell**, so without this it would get that third
of a second of free needle. `READY_SECONDS = 0.5` freezes both needles at the start of every
turn, in the simulation, where a person and a bot are the same thing.

It is worth a lot here: the needle travels 0.37 rad/s across a ±0.12 gauge, so 0.36 s of it
is 0.133 rad — more than half the whole sweep. A person who had to wait out the flip would
find every line from the left limit to just past the middle already gone on the first pass —
the entire left half of the rack — and would wait most of a second more for the needle to
come back.

It cannot live in `game.ts` instead. `seatView` reports **no rotation at all** in single-seat
play, so a freeze keyed off the flip would step one match on a shared phone and a different
one on two phones playing remotely. A test drives the same seed through both presentations
and compares.

## A match ends only on a completed round — and the lead alternation is honest insurance

Nine rounds, one throw each. The lead alternates: p1 opens round 1, p2 round 2, and so on.
Clearing a rack does **not** end the match on the spot — the other seat still gets the throw
it is owed, and may clear their own.

Being exact about which of those three does the work, because the answer is not what we
expected:

| Structure | `hard` seat-one share of decided | z |
|---|---|---|
| completed round, alternating lead (**shipped**) | 49.3% | −0.64 |
| completed round, seat one always leads | 49.3% — **bit-identical** | −0.64 |
| ends the instant a rack is cleared, alternating lead | 49.5% | −0.41 |
| ends the instant a rack is cleared, **seat one always leads** | **52.8%** | **+2.45** |
| ends the instant a rack is cleared, **eight rounds** (even) | **47.6%** | **−2.06** |

2000 seeds each. **The completed-round rule is the load-bearing one.** Given it, the lead
order is provably inert in this game — the two racks never touch, a seat's throws depend on
nothing but its own, and both seats throw the same number of times whatever happens — so the
alternating-lead run and the fixed-lead run come out bit-identical, with 7389 lead flips
actually applied.

The alternation and the odd round count are kept anyway. They cost one line; they are what
keeps the property true the moment anything shared is added to the table; and an odd count is
what gives the first throw of a match and the last one to **different people**, which is what
somebody sitting at the table notices even when the arithmetic is indifferent.

The last row is the one that ran backwards against expectation. Over an even eight rounds the
bias lands on seat one *negatively*: with the match ending mid-round, the seat that throws
**second** in the final round is the one whose last throw can be cancelled, and over eight
alternating rounds that is seat one.

## The table

| | Value | Why |
|---|---|---|
| Table | 700 × 1000 | |
| Throw lines | y = 930 and y = 70, both at x = 350 | Symmetric under the half-turn |
| Rack | six cups, 1-2-3 with the apex toward the thrower, apex 200 from the centre line | |
| Cup | radius 26, rows 45 apart so cups touch | |
| Ball | radius 9 | |
| **Mouth** | **17** = cup − ball | A ball whose centre is on the rim does not go in |
| Clean drop | within 12 of the middle | The score's fine resolution |
| Line needle | ±0.12 rad at 0.37 rad/s | 0.65 s a crossing |
| Range needle | 590–760 units at 1.54 of the gauge a second | 0.65 s a crossing |
| Ready freeze | 0.5 s | Longer than the shell's 0.36 s flip |
| Settle | 0.55 s | |
| Match | 9 rounds, one throw each | |

### The mouth is where the whole difficulty ladder lives

The quantity that decides everything is **how many seconds of press error the mouth is
worth**: `MOUTH_RADIUS ÷ (needle rate × throw distance)`.

The first version had a radius-10 mouth under a needle covering 400 units of table a second,
putting that figure at about 0.025 s. The three tiers then came out at **0.046, 0.053 and
0.062 seconds** of press error — a 1.35× window, every bit of it inside four frames of
perfect. That is not a difficulty ladder, it is three spellings of "nearly perfect", and no
bot tuning fixes it because the bottom of the window is the frame rate.

A **smaller ball in the same cup** is what moved it, and this is the non-obvious part: a
rack's width and its cups' mouths both scale with `CUP_RADIUS`, so making the cups bigger
changes nothing at all. Making the *mouth* bigger inside them changes everything. At 9
against 26 the ladder sits at 0.11, 0.15 and 0.20 seconds, which is where a person's timing
error actually is.

### The needle rate is a lattice

A needle can only be stopped on a whole frame, so a throw's landing point can only fall on a
grid — here 4.3 units apart, eight steps across a 17-unit mouth. The first version ran the
line needle at 1.0 rad/s, where one frame was 11 units and the **grid was coarser than the
cup**: whether a throw went in was decided by where the lattice happened to fall, and two
neighbouring mouth radii, 8 and 9, gave the identical hit rate to three significant figures.
That is the symptom to look for.

## Scoring, and why a clean drop counts for something

Winner is **more cups taken**; level on cups, **more clean drops**; level on both, a draw.

The tiebreak is not decoration, it is the score's resolution. Cups taken is a number between
nought and six, and two players of the same standard land on the same one of those seven
values often:

| | draws on cups alone | draws with the clean-drop tiebreak |
|---|---|---|
| easy v easy | 22.9% | **9.1%** |
| normal v normal | 18.9% | **5.8%** |
| hard v hard | 15.3% | **4.5%** |

2000 seeds a tier. `SWISH_RADIUS = 12` is set so a bit over half of what goes in goes in
clean (54% at `easy`, 62% at `hard`) — a tiebreak that almost never separates anybody is not
one.

It is deliberately a tiebreak and not points: a player who clears the rack has won whatever
the other one's throws looked like, because that is what the game says it is.

Both failure modes named in the brief were live at some point here. **Pinning**: the first
geometry had `hard` making 89% of its throws and clearing the rack in every match, so both
totals sat on six. The fix was the mouth, not the bot. **Too few distinct values**: cups
alone left `easy` drawing nearly a quarter of its matches, which is the table above.

## Termination

Structural. Nine rounds, one throw each seat, and nothing about how the match is played can
add one. A test plays a match with both seats throwing deliberately wide, **with no frame cap
at all** — the loop has no ceiling, so a match that failed to terminate would hang the suite
rather than pass quietly — and asserts both seats threw exactly nine times. The harness runs
6000 matches a configuration with a five-million-step guard that throws rather than returns;
it has never fired since the deadlock below was fixed.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere | tap anywhere |

Only on your own turn, only twice per throw, and never during the ready freeze or while the
table is part-way through its half-turn.

## The bot

Three tiers, expressed only as how accurately a tier hits the moment it meant to — which is
the whole of the skill this game asks for.

| Tier | Press error | Fumbles |
|---|---|---|
| easy | ±0.20 s | 15% |
| normal | ±0.15 s | 8% |
| hard | ±0.11 s | 2% |

It takes the **nearest cup still standing**, solved in closed form: the line and the distance
that land a throw on a point are the exact inverse of the throw itself, so it never searches
a grid and every number it uses is on the table in front of a player. `bot-cost` measures its
worst step at well inside a frame.

Four things about it are load-bearing.

**It counts down to a moment; it does not watch for a position.** Watching for a position is
the obvious way to write this and it hangs. The error is added in whichever direction the
needle is currently travelling, so an error larger than the gauge is out of reach *both* ways
— the needle turns round at the end of its sweep and the wanted value turns round with it,
and the two never meet. Two `easy` seats went into exactly that on **seed 2 of the very first
harness run** and would have swept for ever. A countdown cannot fail to expire, and it is the
more honest model anyway: a person commits to a moment, and pressing late enough that the
needle has turned round is a real way to miss.

**Its press error is triangular, not flat.** Two draws a needle, summed. Flat, the ladder has
almost nowhere to stand — a flat error either fits inside the mouth or it does not, with
nothing in between:

| press error | flat | triangular (**shipped**) |
|---|---|---|
| 0.05 s | 96% of throws made | 98% |
| 0.08 s | 53% | 85% |
| 0.11 s | 28% | 61% |
| 0.20 s | 13% | 29% |
| 0.40 s | 7% | 14% |

The three shipped tiers fit inside the triangular curve with room either side; on the flat
one they would be crammed between 0.05 s and 0.11 s.

**It ranks cups in the thrower's own frame.** Ranking them by how far down the table they sit
and taking the first of a tie sorted them by *board* x — which is not the same order for the
two seats, because the table turns between them. The two ends of the back row are the same
throw mirrored, but not from the needle's point of view: one is reached a third of the way
through the sweep and the other two thirds, so a fumble large enough to run the press back
past the start of the sweep is truncated for one seat and not the other. A test now drives
both seats with a fixed generator and asserts they choose the identical line and distance.

**It clears the line it chose the moment it presses.** `wantAim` is radians; the range press
divides a gauge fraction by a gauge rate. A single `want` shared between the two presses is
how the second needle ends up stopped at the first one's number — 0.07 radians read as 0.07
of the range gauge is a throw that lands 550 units short of every cup on the table. Two
fields, a `stage`, and both cleared on the press.

### Randomness

**A generator per seat**, derived in `init` from `context.rng`, and **exactly six values per
throw**, drawn unconditionally before anything branches. Both are asserted by tests.

Honestly: in this game each guard is on its own sufficient, and the measurement says the
shipped bias would be zero without either.

| | seat-one share, 2000 seeds a tier |
|---|---|
| shipped (a stream each, constant draws) | 50.5% / 50.0% / 49.6% |
| one shared stream, constant draws | 50.5% / 50.0% / 49.6% |
| one shared stream, draw count made conditional | 49.6% / 49.5% / 50.2% |

A shared stream is unbiased here for a reason that is true of this game and of nothing in
general: only the seat whose turn it is draws anything, turns strictly alternate, and a turn
costs exactly six values — so the two seats sit on fixed, disjoint residues of one stream and
never trade places. Every one of those three facts is something a later change could quietly
break, and breaking one couples the seats immediately:

| | seat two threw the identical shots against `easy` and against `hard` |
|---|---|
| shipped | **500 / 500** |
| a stream each, conditional draw count | 500 / 500 |
| one shared stream, constant draws | 500 / 500 |
| **one shared stream, conditional draw count** | **148 / 500**, mean matching prefix 57.5% |

In the last row seat two's play had become a function of how its opponent was playing.

A reversed poll order gives a **bit-identical** match at every tier — asserted over 75 seeds
in the suite and 600 in the harness. In a turn game that holds partly because only the active
seat draws at all; the per-seat streams are what make it structural rather than incidental.

### Every knob, swept alone

Both are strictly monotone with everything else left as shipped. Win rate is against an
untouched `normal` over 600 seeds in each seat order; make rate is the solo measure below.

| `hard` press error | win vs `normal` | make rate |
|---|---|---|
| 0.06 s | 99.9% | 97.6% |
| 0.08 s | 98.6% | 85.3% |
| **0.11 s (shipped)** | **84.4%** | **60.6%** |
| 0.15 s | 54.1% | 40.6% |
| 0.20 s | 31.8% | 28.7% |
| 0.28 s | 19.0% | 20.1% |
| 0.40 s | 10.3% | 13.6% |

| `hard` fumble rate | win vs `normal` | make rate |
|---|---|---|
| 0 | 85.5% | 61.6% |
| **0.02 (shipped)** | **84.4%** | **60.6%** |
| 0.06 | 82.3% | 58.8% |
| 0.12 | 78.9% | 56.0% |
| 0.25 | 70.2% | 50.3% |
| 0.45 | 56.9% | 40.9% |
| 0.80 | 27.1% | 24.5% |

**A third knob was written, swept and deleted.** `wander` moved the bot's aim point off the
middle of the cup by a fixed number of units. Swept alone at `hard` it was monotone — 50.2%,
48.7%, 44.9%, 32.6% and 18.6% of throws made at 0, 5, 10, 20 and 40 units — but all of its
useful travel is *above* the mouth radius, and the values that made a good three-tier ladder
were 4 to 8 units, which is inside the mouth and does nothing. It read in the source as an
aiming skill and was in practice a second, redundant spelling of the press error. It went.

### Solo, per tier, with no ceiling

12 000 throws a tier at a full rack, so nothing can saturate at six cups.

| Tier | throws made | clean | clean share of makes |
|---|---|---|---|
| easy | 25.8% | 13.7% | 53.0% |
| normal | 38.3% | 21.6% | 56.4% |
| hard | 60.3% | 36.6% | 60.7% |

### Balance, 1500 seeds a pairing

Equal tiers:

| | p1 | p2 | draws | seat-one share of decided | cups p1/p2 |
|---|---|---|---|---|---|
| easy v easy | 691 | 676 | 133 | **50.5%** | 2.52 / 2.50 |
| normal v normal | 704 | 708 | 88 | **49.9%** | 3.49 / 3.51 |
| hard v hard | 716 | 725 | 59 | **49.7%** | 4.88 / 4.93 |

Cross tier, both seat orders:

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| hard as p1 v easy | 1395 | 79 | 26 | 94.6% |
| easy as p1 v hard | 79 | 1399 | 22 | 94.7% |
| normal as p1 v easy | 1027 | 384 | 89 | 72.8% |
| easy as p1 v normal | 404 | 1007 | 89 | 71.4% |
| hard as p1 v normal | 1214 | 235 | 51 | 83.8% |
| normal as p1 v hard | 218 | 1241 | 41 | 85.1% |

Every equal-tier share is inside 47–53%; every pairing is monotone and agrees with itself
within 1.7 points across the two seat orders. A match takes about 40–43 s of simulated play.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match.

- **Seat one is round and seat two is square, everywhere.** Cups carry a round or a square
  centre mark, the ball in flight carries the thrower's, and the pips are circles for p1 and
  squares for p2. Two racks facing each other across a table that turns are the pair most
  likely to be confused.
- A cup's centre mark **is** the clean-drop zone, drawn at its real radius, so what the
  tiebreak asks for is on the table rather than explained afterwards.
- A cup already taken leaves a faint ring where it stood, so a player can see the shape of
  the rack they have broken.
- A landing is a **double ring** for a clean drop, a **single ring** for one that went in off
  the rim, and a **cross** for a miss: three outcomes told apart by shape, with colour
  confirming what the shape already said.
- Cups taken are pips: **solid** for a clean drop, **hollow** for a rim throw, **faint** for a
  cup still standing. That is the tiebreak made visible — a player level on cups can see
  which way it will go.
- Rounds left is a bar on the halfway line: one object, shared by both players.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the seat flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders forty frames and asserts neither needle moved.
