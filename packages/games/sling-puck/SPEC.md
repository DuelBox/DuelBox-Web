# Sling Puck

One board, a wall across the middle with a gap in it, and eight pucks a side to be rid of. Two
presses a shot: one stops a sweeping line, one stops a sweeping strength. Seven shots each. Most
pucks through wins.

- **Archetype** `turn-aim`, **zone split** shared-board, **board** 640 × 1000.
- **Wall** at the halfway line, **gap** 72 units wide against a 52-unit puck — ten units of
  clearance either side.
- **Puck** radius 26. **Rack** 8 a side, in four rows. **Shots** 7 each. **Ready pause** 0.45 s.
- **Strength** 290 to 1010 units a second, **aim sweep** ±0.62 rad.
- **A crossing is worth 3 through the middle third, 2 clean, 1 if it rattled off a post.**

## The decision

Which line, and how hard. The gap is narrow enough that a shot is a real act — the sharpest bot
puts 0.78 pucks a shot through, the weakest 0.29 — and the three scoring bands mean going
through is not the end of the question. A rattled crossing counts, so a wild shot is not wasted;
a threaded one counts three times as much, so precision is worth aiming for rather than merely
worth having.

The rack empties from the front, so each shot is taken from a puck with a clear lane, and the
lane gets longer as the match goes on. The last shots are the hard ones.

## Termination

Structural, and a count rather than a clock: seven shots each, and the match ends when both have
spent them. `rules.test.ts` plays 30 matches to completion **with no frame cap in the loop at
all** — if the rules failed to end a match the test would hang rather than quietly pass.

## Controls

**A press, and nothing else.** No position, no direction, no rate: the game reads `actionPressed`
and never looks at where a pointer is. A key and a thumb produce the identical event, holding
does nothing a single press does not (it is an edge), and mashing does nothing at all. A test
plays the same match through both instruments and compares the scores.

A **0.45 s ready pause at the start of every turn** lives in the rules. The board turns to face
whoever is shooting, and the shell refuses a person's input while it turns — but a bot does not
go through the shell, so without this it had the first third of a second of every turn to itself.
Cannon Duel has that asymmetry and can live with it because its needle sweeps forever; here the
needle *is* the shot. Freezing the needle in the presentation layer instead would be worse:
`seatView` reports no rotation in single-seat play, so the same match would step differently on
two devices. A test plays a match out in both presentations and compares.

## Reading it

No text. The far half is a shade darker; the wall's gap ends are drawn as the round posts the
physics treats them as; p1's pucks carry a ring and p2's a bar; a puck that is through is drawn
hollow and racked at the back. The aim needle is drawn **as the line the puck will take**, from
the puck itself, and the strength needle grows along that same line — so there is nothing to
translate between a gauge and the board, and the second press needs no new place to look.

## Four things that came out backwards

**The real table game does not work turn by turn.** In it, a puck you sling over becomes your
opponent's problem, and you win by being faster than they can return them. Take the speed away
and nothing decreases: score the position and two equal bots spent **87 seconds** arriving at the
same count, one match in five drawn, with `normal` beating `hard` **57–43** — the better player
simply handed the better opponent more to work with. Scoring crossings instead makes every shot
worth something that cannot be taken back.

**Then the arriving puck became the bug.** A crossed puck stops hard against the far side of the
wall, where it is the nearest puck on its new owner's side and therefore their next shot — from a
position with almost no angle left to the gap. That made **the first shot of the match the only
one taken at an undisturbed board**: seat one's opening shot went through 100 times in 100, seat
two's 54, and all sixteen others were level. It survived alternating the lead, an odd round count
and a generator per seat, because all of those move turns around and the advantage was in the
board.

**And it was still there when the puck was racked away**, because a crossing was only credited
when the shot *settled* — so the flying puck spent the rest of the shot inside the opponent's
rack, scattering it. Credited and removed the instant it clears the wall, neither board can reach
the other, and the seats are equal by construction rather than by measurement.

**Two of the outer rack pucks could not be aimed at the gap at all.** They sat 0.74 rad off
straight against a needle that sweeps 0.62. Since the rack empties from the front they were
always the second shot, and crossings on shot two measured **0.20 against 0.96 either side of
it**, at every tier. A shot nobody can reach the answer with is not a hard shot. `rules.test.ts`
now checks the whole rack against the sweep rather than trusting the numbers.

**Who moves first is `context.openingSeat`, never a literal `p1`.** The SDK alternates it
across the rounds of a best-of so first-mover advantage washes out (#2466), and a game that
assumed seat one would leave that rotation reaching nothing (#2487). It is read in
`resetGame`, which sets the lead as well as the active seat. Measured at 50 seeds x both
opening seats on `normal`, equal tiers: seat one takes **34.1%** of 85 decided matches,
against 36.6% with the lead fixed to seat one, so the seat-two lean here is not the opener —
it survives both of them and is worth an issue of its own.

## The bot

Three knobs, all monotone, each swept alone.

| | aim (rad) | strength (of range) | reads |
|---|---|---|---|
| easy | 0.30 | 0.34 | 0 |
| normal | 0.13 | 0.17 | 0.55 |
| hard | 0.045 | 0.07 | 1 |

`reads` is whether it works out how hard to hit or slings everything at a flat three-quarters.

**A fourth knob was deleted rather than tuned.** A tier that "read the board" and shifted its
target away from its own nearby pucks cost rather than paid: the gap gives ten units of clearance
and the shift was twenty-two, so it aimed at a post. Crossings went from 0.67 a shot to 0.55 with
it on. The loading rule already hands every shot a clear lane — nothing on that side is nearer
the gap than the puck being slung — so there was never anything to dodge. A knob that reads like
skill and is not one is worse than no knob at all.

The bot picks a value for a needle once and then waits for the needle to reach it, exactly as a
person does; it gets no extra looks and no resolution finer than the frame it is shown (rule 6).
Two draws a needle, unconditionally, before it looks at anything — asserted. **The stored value
is cleared when it presses**: left standing, the angle needle's answer was still there when the
strength needle started, so the bot stopped the second needle at a number in a different unit.

## What was measured

**Fairness, 3000 matches per equal tier**, seat one's share of decided matches:

| | seat one | draws | mean score |
|---|---|---|---|
| easy v easy | 50.2 % | 333 | 3.98 / 3.95 |
| normal v normal | 50.9 % | 330 | 7.43 / 7.36 |
| hard v hard | 51.1 % | 411 | 12.57 / 12.53 |

**The ladder, 400 matches a cell, both seat orders** (the row's share):

| | v easy | v normal | v hard |
|---|---|---|---|
| **easy** | — | 12 % | 0 % |
| **normal** | 84 % | — | 8 % |
| **hard** | 99 % | 90 % | — |

**Per shot, solo:** easy 0.29, normal 0.52, hard 0.78 pucks through. Matches run about 34
seconds.

**On draws.** At a flat point a crossing, `hard` against itself drew **947 matches in 2000** —
two good players both landed on five or six and there was nothing left to separate them. Two
bands took it to 680 in 3000; three bands to 411. If equal tiers draw a lot, the score has too
few distinct values, and the fix is to give the skill something finer to pay off in rather than
to make the bot worse.
