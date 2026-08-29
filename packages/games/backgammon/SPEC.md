# Backgammon — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~90 s

> **Written from the implementation, not before it.** **[ours]** marks a decision with no
> basis in the observed rules.

## Observed rules

> Move your fifteen checkers according to the roll of two dice. The objective is to move
> all checkers into your home board and then bear them off. You can also hit opponent's
> blots to send them to the bar, delaying their progress.

That is more than most entries in `docs/observed-rules.md` give, and still less than a
game. It names the fifteen checkers, the two dice, the home board, bearing off, blots and
the bar — and leaves open the opening position, what a die may do, what closes a point,
what happens to a roll that cannot be played, who moves first, and when a match is over.
Everything below that is not in the quotation above is either the standard rule any
backgammon player would expect or a decision of ours, and each is marked.

## Travel indices, not point numbers

The one idea the whole implementation rests on, so it belongs at the top.

A backgammon board is twenty-four points read in opposite directions by the two players,
and every rule in the game is stated from the mover's own end: *your* home board, *your*
bar, *your* bear-off. So positions are addressed by **travel index** — how far a checker of
that seat has come — 0 on the point furthest from home, 23 on the last point before
bearing off, `-1` for the bar and `24` for borne off. `boardIndex(seat, travel)` converts
to the shared point, and it is the only place the two directions meet.

Every rule, every bot score and every test is then written once and reads the same for both
seats, and a mirrored position produces exactly the mirrored moves. `rules.test.ts` asserts
that rather than assuming it.

## The board

| | Value | Why |
|---|---|---|
| Points | 24 | the game |
| Checkers | 15 a seat | the observed rule says fifteen |
| Home board | travel 18–23 | the last six points, standard |
| Opening position | 2 on travel 0, 5 on 11, 3 on 16, 5 on 18 | the standard set-out, read from the mover's end: the 24-point, 13-point, 8-point and 6-point |
| Opening pip count | 167 a seat | falls out of the layout; `START_PIPS` asserts it |
| Bar | travel −1 | one step behind the board, which is why a hit costs 25 pips |
| Turn cap | 220 turns | the backstop — see **Termination** |

Drawn as **two rows of twelve with a gap down the middle**, not as the traditional
horseshoe **[ours]**. The horseshoe is familiar; this layout is *exactly rotationally
symmetric*, so point `i` sits precisely where point `23 − i` sits after the half turn.
When the board turns to face the other seat, that player sees their own position drawn
identically to how the first player saw theirs — same corner for their home board, same
place for their tray, highlight walking the same way. On a phone two people pass back and
forth, that is worth more than the shape being familiar. `game.test.ts` asserts the
symmetry point by point rather than trusting the arithmetic.

| Geometry | Value |
|---|---|
| Column width | 63 (900 − 2×60 side − 24 centre gap, over 12) |
| Point length | 282, drawn as 7 stacked rectangles narrowing to a tip |
| Checker radius | 26, stacked every 48, at most 5 shown then a count |
| Middle strip | y 378–522, kept clear of both rows of points |
| Tray | 56 tall, 26 from its owner's edge |
| Die | 48, two of them 56 apart in the middle |

## The rules that are actually implemented

**A die moves one checker that many points forward.** Two dice, two moves, either order,
and either die may move the same checker twice.

**Doubles are played four times.** Everyone knows this one; `roll` pushes the same face
four times rather than twice.

**Two or more opposing checkers close a point.** One is a **blot** and may be landed on:
it goes to the bar and starts its lap again, which costs it 25 pips — the whole reason
hitting is worth anything.

**The bar comes first.** A seat with a checker on the bar may move nothing else until it is
back on, entering on the point its die names inside the opponent's home board. A closed
home board can shut a seat out entirely; that is a turn with no move in it, below.

**Bearing off needs every checker home**, and then an exact roll — except from the point
furthest back, where a larger die bears off rather than being wasted. Anything still behind
that checker has to be brought in first, which is what makes the last few rolls a decision
rather than a formality.

### What is deliberately not implemented **[ours]**

- **No doubling cube.** It is a betting instrument, and there is nothing to bet.
- **No gammon or backgammon multiplier.** A win is a win; the shell scores matches, not
  points.
- **No opening roll-off.** p1 throws first, always. A roll-off decides one thing once and
  costs a whole extra state in the machine.
- **The "use both dice if you can, and the higher one if you can only use one" rule is not
  enforced.** Each die is offered whenever that single move is legal on its own. Enforcing
  it means searching every ordering of the roll before the move list is even shown, on
  every step, for a rule that changes the outcome of a small fraction of turns and that
  most casual players do not know they are breaking. It is the one place this game is
  laxer than a tournament board, and it is written down here rather than left to be
  discovered.

## Scoring and the win condition

**Bearing off all fifteen wins.** Resolved by the shared helper —
`resolve({ kind: 'first-to', target: 15 }, { p1: offP1, p2: offP2 })` — so "first to
fifteen" means in this game what it means everywhere else in the catalogue. No comparison
is written by hand.

**The number in the HUD is pips gained, not checkers borne off.** Borne-off checkers is the
score a backgammon player would name, and it sits at nought for most of a match and tells a
spectator nothing about who is ahead. Pips gained (`167 − pips left`) moves on *every* move
and is the number the game is actually about — and it goes **down** when you are hit, which
is the point of being hit. Early on it can read below zero, and it should: a checker on the
bar is further from home than it was when it started.

After a win the position freezes and the shell is told 1.1 s later, so the last move can be
read. Nothing restarts inside the game; rematch is the shell's.

## Termination

Backgammon has no draw, no clock and no rule that stops two weak players hitting each other
back and forth for ever. The guarantee is built in three parts, and only the first is a
proof.

**1. A turn is bounded.** A roll puts two dice in hand, or four on a double. Every applied
move consumes exactly one die, and a turn ends the moment the dice are spent. A turn with
dice left and no legal move is **passed** — held on screen for 0.7 s first, then handed
over. So a turn is at most one roll, four moves and one pass, and it always ends.

**2. The match is bounded.** `endTurn` increments a counter, and `winnerOf` settles the
match on pip count once it reaches `MAX_TURNS = 220`, through
`resolve({ kind: 'highest-when-time-expires' }, …)` with the two pip counts as the scores —
the same helper every game with a clock uses, and a level race at the cap is a draw. This
is the part no amount of average-case measurement can replace: it is what makes the match
*guaranteed* to end.

**3. The clock arithmetic clears the guard.** Every bot action costs
`round(0.22 × rate)` steps — 13 at 60 Hz. The most expensive possible turn is a double
whose fourth die is dead: roll (13) + three moves (39) + the pass hold (42) = 94 steps. At
the cap that is 220 × 94 + 66 settle = **20 746 steps, 345.8 s** — inside
`termination.test.ts`'s ten simulated minutes with 42% to spare, in a case the dice will
never actually produce.

**Measured**, which is the part that says the cap is a backstop and not a rule anybody plays
against:

| Two bots, through the real game loop, 40 seeds | Mean | Worst |
|---|---|---|
| easy v easy | 46.6 s | 79.7 s |
| hard v easy | 59.3 s | 115.6 s |
| hard v hard | 77.7 s | 155.1 s |
| normal v normal | 97.0 s | 162.2 s |

None unfinished. Over **2000** easy-against-easy matches at the rules level the cap was
reached **not once**; the longest ran 121 turns of the 220 available. The cap does bite
occasionally in the slower pairings — 18 matches in 400 for normal against normal, which
trade blots for a long time — and those end on pips, correctly, rather than running on.

### The stuck state this game could have had

Ludo Dash shipped a state a human could reach with no move and no pass. The equivalent here
is a turn that reaches `moving` with nothing legal in it, and there are **two** ways in, not
one:

- the whole roll is dead — being shut out on the bar is the common case;
- **the roll was live, the move was played, and what is left of it is dead** — a double
  whose fourth die has nowhere to go, or a six that opens nothing for the one.

The check therefore runs where the **position** is read, at the top of `update`, and not
where the dice are thrown. Tying it to the roll catches the first and leaves a human sitting
on a live board holding a die they cannot use, with no move to make and no way to hand the
turn over. Both routes have a test.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| p1 | tap to roll; tap the point you want to move **from**, and out towards the landing point to choose the die | `W A S D` walks the move list, `Space` rolls and plays |
| p2 | the same, upright for them because the board turns | arrows and `Enter` |

`W A S D`/`Space` and arrows/`Enter` are `DEFAULT_BINDINGS` in the engine, and a test
asserts the manifest string still names what the engine binds. Each seat has its own half
of the keyboard at all times — it is never one player choosing a half.

**The keyboard cursor is a grid over the legal moves, not over the board.** Over the board
it would be unplayable: twenty-four points with a handful movable means most presses land
on nothing, and a keyboard that mostly does nothing is a game that cannot be played without
a touchscreen. Over the moves, every press plays something. Left and right step one move,
up and down jump six, and six by six is comfortably more than the thirty (fifteen points,
two dice) a position can offer — `rules.test.ts` asserts the list never outgrows the grid.
The list is ordered by starting point and then by die, always, so the order is something a
player can predict.

**The two sources combine with no mode to switch between them.** Both write the same
selection. A tap picks the nearest legal move — nearest by the point it starts from, and
then by where it lands, which is how a finger chooses a die: tap the checker to move it the
short way, tap out towards the landing point to move it the long way — and it also carries
the keyboard cursor to that move, so picking the keyboard back up does not throw the
highlight somewhere unrelated. Ties go to the earlier move in board order, so the same tap
always plays the same move.

**The move a press would play is drawn before it is played**: a ring on the checker that
would leave, a line to where it would land, a hollow checker waiting there and the die
printed on it. A dot under each point a checker may leave this turn — with twenty-four
points and two dice, the short list of places something *can* happen is what a player needs
shown.

## Edge cases

- **A turn with no legal move.** Held 0.7 s with "No move — the turn passes" on screen,
  then handed over. Both routes into it are described under **Termination** above.
- **A press from the seat that is not to move.** Nothing. Input is read only for the seat
  the position says has the move.
- **A press while the board is turning.** Refused, as everywhere — `SeatFlip.acceptsInput`
  is false for the whole half turn, so a tap cannot land somewhere the player did not aim.
- **Both seats pressing at once.** Not a case: only the moving seat's input is read at all.
- **A checker on the bar with a closed home board.** No entry, so no move, so the turn
  passes — repeatedly, if the board stays closed. This is a real backgammon position and
  the pass path is what keeps it from being a hang.
- **Bearing off with an overshoot while a checker is further back.** Refused; the one
  behind must come in first.
- **A level race at the turn cap.** A draw, resolved by the shared helper rather than by an
  arbitrary tie-break.
- **`render` before the first `update`.** Draws the opening position with no selection; the
  move list is recomputed at the top of every step, and a caller that writes a position
  straight into the game has to let a step run before reading it back.

## Determinism

- **All randomness is the seeded `Rng` from the context.** The dice above all: `roll` takes
  two `rng.int` calls and nothing else. No `Math.random` anywhere.
- **Every delay is counted in whole simulation steps**, taken from the observed rate:
  `round(seconds × stepsPerSecond)`. Bot thinking 0.22 s, the dead-roll hold 0.7 s, the
  settle after a win 1.1 s.
- **A delay starts and counts down in the same step.** This needed care and was wrong:
  starting it in one step and counting it in the next cost `steps + 1` per action, and a
  constant one added to a count taken from the frame rate does not scale with the rate.
  Fourteen steps at 60 Hz is 0.233 s and twenty-seven at 120 Hz is 0.225 s — two devices
  stepping the same match drifted a move apart inside ten seconds. Rule 8 is not only about
  pixels; a delay expressed in frames is the same mistake. A test steps the same seeded
  match at 60 and at 120 and compares the trace second by second.
- **The rate must divide the delay evenly for the match to be step-identical.** 60 and 120
  both give whole multiples of the same 0.22 s; an odd rate rounds differently and the
  match is then the same *game* but not the same *steps*. That is a property of integer
  steps, not of this game, and it is the reason the fixed timestep exists.
- Nothing in `render` touches the position — a test renders twice and compares.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetPosition`. Measured at 50 seeds x both opening seats on `normal`, equal tiers: seat
one takes **50.0%** of 100 decided matches, and all 50 seed pairs end differently when only
the opening seat changes.

## The bot

| | Blunder rate | Hunts blots | Counts shots against its own |
|---|---|---|---|
| easy | 0.55 | no | 0 |
| normal | 0.18 | yes | half |
| hard | 0 | yes | fully |

It scores each legal move on the four things a person weighs on an ordinary turn: how far
the checker gets, whether it hits, whether it lands somewhere safe, and whether it breaks a
point it was holding. Bearing off outranks all of it and has to be said so explicitly, or a
fat hit bonus talks the bot out of finishing the game — a test makes the two compete.

**Rule 6 holds by construction.** The only thing the bot reads that is not the position on
screen is `exposure` — how many of the six dice would let the opponent land on a given
point — and that is a number a human counts off the board in a second and the first thing
anybody looks at. Direct shots only; combination shots are not counted, by anybody. The
tiers differ in *how well they choose among the legal moves*, never in what they can see:
`easy` grabs a move without looking better than half the time, and cannot see a hit or a
shot at all; `hard` looks every time.

### Measured win rates

400 matches a pairing, **seats alternated** so the first-move advantage cancels, seeds
`i × 7919 + 13`:

| | Win rate | Average length | Reached the cap |
|---|---|---|---|
| hard v easy | **94.0%** | 76.5 turns | 0/400 |
| normal v easy | **93.0%** | 80.8 turns | 0/400 |
| hard v normal | **62.0%** | 115.8 turns | 3/400 |
| easy v easy | 48.3% | 62.5 turns | 0/400 |
| normal v normal | 51.0% | 127.4 turns | 18/400 |
| hard v hard | 51.5% | 103.5 turns | 2/400 |

The three mirror pairings sitting within two points of even is the check that seat
alternation did its job and that neither seat is playing a different game.

`rules.test.ts`'s `wins more often the harder it is` runs the same pairings over 150
matches with p1 fixed as the stronger tier — 97.3%, 94.7% and 68.7%, about two points
higher across the board, which is the first-move advantage — and asserts floors of 0.80,
0.75 and 0.55 so the ordering cannot silently invert.

**Why the gap between hard and normal is only 62/38.** 19% of all decisions in a match have
exactly one legal move, so a fifth of the time there is nothing to decide; the dice decide a
great deal of the rest. A 62/38 edge over a tier that already hits blots and counts half the
shots against it is a real edge for a dice game, and it is honest to say it is not chess.

## Presentations

**Shared-screen**: one board both seats reach across, turning 180° to face whoever has the
move — which is the whole reason for the two-rows-of-twelve layout above. **Single-seat**:
the same board, never rotated, upright for the local seat all match. Rules, dice and
simulation are byte-identical across both; only rotation changes. See
`docs/presentation.md`.

## Rule 7 — colour is never the only signal

p1's checkers carry a **ring**, p2's a **bar**, on the board, on the bar and in the tray
alike, so the two sides are told apart with the colour taken away. Each home board is
tinted in its owner's palette *and* the tray carries a printed `n/15` count, so how far each
side has got is readable in greyscale. Whose turn it is is stated three ways: the board
faces them, the status line names the action ("Roll", "Move", "Enter from the bar"), and
`getActiveSeat` tells the shell, which is what makes it a turn game to the HUD.

## Not specified here

Art and audio, cross-device play and the fairness audit. The doubling cube, match play to a
points target, and the tournament rules around a roll that can only be played one way — all
real backgammon, none of them a fit for two people passing a phone.
