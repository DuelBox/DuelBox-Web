# Hammer Hit — specification

**Archetype:** `turn-aim` · **Category:** Party · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A fairground striker at each end of the board. A needle sweeps across a dial and one press
swings the hammer: the nearer the needle was to the white line, the harder the puck is
driven up the tower, and the band it reaches is the score. Let the needle turn round
instead and the hammer winds a notch further — a harder hit, and a faster needle to catch.
Four rounds, a swing each, and the higher total wins.

## Observed rules

From the reference genre: _"Hit the hammer when the needle is pointing up. The closer to
the white line, the stronger the hit. The best score in 3 rounds wins!"_

## The needle is the whole control, and that is why this game exists

A sweeping needle stopped by a button is **the one aiming idiom where a key and a thumb are
identical instruments**: both are a single binary event with a timestamp, and neither can
be aimed more finely than the other. Every other aiming game in this catalogue has to
decide whether a mouse out-points a thumb — Darts, Cornhole and Knife Thrower all do — and
this one cannot have the problem at all. It is why the reference genre's "hit the hammer
when the needle is pointing up" is worth taking literally rather than translating into a
drag, and why nothing in `rules.ts` reads a pointer position, a drag, or a second dial.

The press is the only input. There is no aim, no power gauge, and nothing to point at: a
tap anywhere is the same as `Space`.

## Waiting winds the hammer **[ours]**

The needle does not sweep once. It crosses the mark **once per traverse**, and every time
it turns round at an end the hammer winds one notch further and the needle comes back
faster. So the whole decision, made with the same one button, is *this* crossing or the
next one.

| Notch | Multiplier | Needle | Traverse | One band is worth |
|---|---|---|---|---|
| 0 | ×1.00 | 1.95 rad/s | 1.08 s | 96 ms — 5.8 frames |
| 1 | ×1.30 | 2.65 | 0.79 s | 54 ms — 3.3 frames |
| 2 | ×1.55 | 3.61 | 0.58 s | 33 ms — 2.0 frames |
| 3 | ×1.74 | 4.91 | 0.43 s | 22 ms — 1.3 frames |
| 4 | ×2.00 | 6.67 | 0.31 s | 14 ms — 0.8 frames |

The last column is the cost of waiting, stated the way a player actually meets it. On the
first notch a whole band of score is nearly six frames wide and the outcome is essentially
chosen; on the last it is under one, and the outcome is a gamble. Running out of notches
without pressing is a **slip**: the swing is spent and scores nothing.

### Trap six: is the whole of the dial worth using?

Two separate questions, both measured.

**Is the sweep live?** Cannon Duel's first power range could not reach the target from two
thirds of its span. Here nothing is dead:

| Notch | worth ≥ 1 band | worth ≥ 5 bands | worth ≥ 8 |
|---|---|---|---|
| 0 | 82.2% of the sweep | 11.0% | — |
| 2 | 88.5% | 42.6% | 8.1% |
| 4 | 91.1% | 55.5% | 28.8% |

**Is every notch worth standing on?** Each one is the best answer over its own band of
accuracy, and the best notch falls a step at a time as the hand gets shakier — measured by
scanning `chooseWind` over mean timing error:

| Mean error off the mark | Best notch |
|---|---|
| under 57 ms | 4 |
| 57 – 68 ms | 3 |
| 68 – 123 ms | 2 |
| 123 – 211 ms | 1 |
| over 211 ms | 0 |

The bell is the other half of the answer. It is reachable **only from the last notch** —
`FULL_CLIMB` sits above every multiplier but the top one, so a dead-centre hit from notch 3
falls one band short. The top notch therefore has the highest ceiling and the widest spread
of anybody's five choices, which is what makes it the rung to stand on when averages are
not going to be enough.

**What came out the opposite of the assumption.** The intention was a ladder whose optimum
was *interior* — a top notch that was a pure gamble even for a perfect hand. That is not
possible. As long as the bell is reachable only from the top notch, the top notch has the
highest ceiling, and for a hand accurate enough the ceiling is what it collects. The
honest shape of this ladder is therefore **skill-indexed rather than interior**: the last
notch belongs to the steadiest hands and to anybody far enough behind, and every notch
below is somebody else's home. The measured spreads say the rest — at `easy`, notch 2
returns 6.10 ± 1.26 bands and notch 4 returns 5.69 ± **2.86**.

## The board

| | Value | Why |
|---|---|---|
| Board | 700 × 1000 | |
| Bases | (215, 900) and (485, 100) | `centre ± offset`, so the half-turn maps one onto the other |
| Tower | foot 120 from the base, 600 long | Ten bands of 60; the two towers stand side by side, not on one line |
| Sweep | ±1.05 rad | About ±60°, a proper fairground arc |
| Bands | 10 | The band the puck reaches is the score for that swing |
| Wind-up | 5 notches | Running out is a slip |
| Ready pause | 0.45 s | Longer than the flip — see below |
| Settle | 0.7 s | |
| Match | 4 rounds minimum, 8 maximum | Both even; see the lead order |

Every position is written `centre ± offset` and a test asserts it: `baseX(p1) + baseX(p2)`
is the board width, and the same for both ends of both towers down the height. The board is
its own mirror through its centre, so the half-turn moves nothing that matters.

## The needle does not move while the board is turning **[ours]**

Every turn opens with a **ready pause of 0.45 s**, longer than the 0.36 s half-turn, and
the needle is frozen for the whole of it.

This is not decoration and it is not in the renderer. The shell refuses a person's press
for the whole of the flip; a game whose wind-up ran through that would be handing the bot a
window nobody else could press in — rule 6, broken by a third of a second a frame at a
time. Cannon Duel has the same shape and gets away with it because its aim needle sweeps
for as long as you like; here the wind-up is a *finite* five traverses, so a third of a
second is a rung.

It lives in the rules rather than in `game.ts` for a second reason: a game that gated its
simulation on the flip would step **two different matches in the two presentations**,
because `seatView` reports no rotation in single-seat play and there is then no flip to
gate on. `game.test.ts` asserts the traces are identical.

## The lead alternates, and a match can only end on an even round **[ours]**

Whoever swings second in a round has seen what they have to beat. In a game whose only
decision is how far to push a gamble, that is worth something — so seat one leads round
one, seat two leads round two, and so on, and the match may only be called after an even
number of rounds. Each seat then takes the informed swing exactly as often.

Measured, because a fairness claim without a number is a hope. Equal tiers, 900 matches a
row, seat one's share of the decided matches:

| | fixed lead | alternating |
|---|---|---|
| easy | 46.9% | 52.4% |
| normal | 44.8% | 52.9% |
| hard | 48.9% | 50.8% |

The advantage is real and it belongs to the **follower** — the seat that never leads takes
51–55% of a fixed-lead match. Alternating removes it.

**And it read backwards at first.** The first measurement taken was mean bands per swing by
position, which said the *leader* scored more (5.58 against 5.24 at `easy`) — the opposite
of the hypothesis. That number is an artefact of the bot's own gamble rule: a follower is
more often behind at the moment it plans, so it is more often on the top notch, which has
the lower mean and the higher ceiling. Scoring less per swing and winning more is exactly
what a gamble looks like. Only the win rates settle it.

## Equal turns

**A match ends only on a completed round** — both seats having swung the same number of
times — and only if one of them is then ahead. First-past-a-target would otherwise be won
by whoever swung first whenever both players were good: the trap Knife Thrower fell into
and the answer darts and cricket reach. Level after four rounds is not a finish; they swing
again, in pairs, until somebody leads or the eight rounds run out.

## Termination

Structural. Eight rounds, and nothing about how the match is played can add one. A turn
that is never pressed ends anyway — five traverses and the hammer slips — so two players
who touch nothing at all finish a drawn match in about 70 s of simulated play, and no clock
is involved. A bot match runs 33–41 s.

Nothing in `rules.ts` draws from the `Rng` at all. The only chance in a match is a player's
own hand, which is why `determinism.test` can replay a scripted match to an identical final
state without seeding anything.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere | tap anywhere |

Only on your own turn, and only once per swing. Input is refused while the board is
part-way through its half-turn — and the ready pause outlasts that, so the refusal costs
nothing at all.

## The bot

Three tiers, expressed only as how accurately a tier hits the moment it meant to, which is
the whole of the skill this game asks for.

| Tier | Timing error | Blunders | Mean error off the mark | Notch it settles on |
|---|---|---|---|---|
| easy | ±0.14 s | 10% | 112 ms | 2 |
| normal | ±0.10 s | 5% | 65 ms | 3 |
| hard | ±0.05 s | 2% | 28 ms | 4 |

The notch is **not** handed down per tier. `chooseWind` works it out from the tier's own
mean error, by the same arithmetic a player would do about themselves: expected strength at
a notch is its multiplier times the accuracy that survives its needle, and the best notch is
the largest of those five numbers. That the three tiers land on three different notches is
a result, not a setting — and the tiers therefore differ in *strategy* as well as in
steadiness, which no amount of tuning a table would have given honestly.

The mean error counts blunders, and has to: ignoring them had `easy` planning its turns as
though it were `normal`. Being **8 or more bands behind** overrides the arithmetic and sends
any tier to the top notch, because the last notch is the only one that can reach the bell.

Its error is in **seconds**, not in needle units. That is what makes a faster notch
genuinely harder for every tier rather than only for the loose ones.

The wanted angle is clamped into the sweep, so a blundered press still lands somewhere on
the traverse it was aimed at. Without the clamp a bad enough error names an angle the
needle never reaches, the bot sails past its notch in silence, and the difference between a
bad swing and no swing is an accident of arithmetic. A test drives 36 bot matches and
asserts every single press landed on the notch that was chosen and that nothing ever
slipped.

It draws exactly three values per swing, unconditionally — the Fruit Duel trap, where two
bots sharing one `Rng` and drawing a variable number of values shift each other's stream.
`BOT_DRAWS_PER_SWING` is asserted by a test that counts them, including with the scores set
so that `chooseWind` takes its other branch. `chooseWind` itself draws nothing.

### Mean bands of ten, by notch and tier

Sampled over the real scoring function, 6000 presses a cell:

| | notch 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| easy | 4.43 ± 0.49 | 5.50 ± 0.83 | **6.10 ± 1.26** | 6.05 ± 1.87 | 5.69 ± 2.86 |
| normal | 4.59 ± 0.49 | 5.86 ± 0.66 | 6.70 ± 0.93 | **6.98 ± 1.34** | 7.12 ± 2.02 |
| hard | 5.00 ± 0.00 | 6.33 ± 0.47 | 7.47 ± 0.50 | 8.11 ± 0.74 | **8.87 ± 0.99** |

Bold is what `chooseWind` picks. It is the sampled best at `easy` and at `hard`; at
`normal` the sampled best is notch 4 by **2%** (7.12 against 6.98). `chooseWind` is a linear
approximation that ignores the clipping at zero power, and this is what the approximation
costs — stated rather than hidden, because two per cent of a swing is cheaper than a search
and the resulting spread of notches across the tiers is worth more than the two per cent.

`hard` reads 5.00 ± 0.00 on notch 0: at 50 ms of scatter against a 96 ms band, the first
notch is not a gamble for it at all, it is a fixed number.

### Measured, 400 matches a pairing

| | p1 | p2 | draws | p1's share of decided | bands a swing | bells |
|---|---|---|---|---|---|---|
| easy v easy | 201 | 198 | 1 | 50.4% | 5.44 | 1.9% |
| normal v normal | 200 | 200 | 0 | 50.0% | 6.76 | 3.7% |
| hard v hard | 197 | 202 | 1 | 49.4% | 8.77 | 31.6% |
| hard v easy | 391 | 9 | 0 | 97.8% | | |
| easy v hard | 2 | 398 | 0 | 0.5% | | |
| normal v easy | 331 | 69 | 0 | 82.8% | | |
| easy v normal | 74 | 326 | 0 | 18.5% | | |
| hard v normal | 371 | 29 | 0 | 92.8% | | |
| normal v hard | 12 | 388 | 0 | 3.0% | | |

Every tier beats the one below it from either seat, by better than 4:1. Over **1200 fresh
seeds** each — because eighty was not enough for Match Rush and four hundred moved its
number by five points — equal tiers give seat one **50.2%**, **52.2%** and **51.4%** of the
decided matches.

**Draws are rare and were checked for on purpose** (Robot Arena and Slot Cars both
dead-heated every match between identical bots): 1, 0 and 1 in four hundred. Two bots on
one tier are not identical here — they draw from different positions in one stream, so
their hands differ — and the score has enough resolution that ties do not survive four
rounds. An early tuning had `hard` ringing the bell on 87% of its swings, which pinned both
totals to the ceiling and produced **15% draws**; the bell window was narrowed and `hard`'s
hand loosened until it rang about a third of the time.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called. Every number this game has is a
length or a shape, because a digit has a top and this board is read from both ends.

- p1's puck is a disc and p2's a block; p1's band marks are dots down the left of its rail
  and p2's are bars down the right; p1's bell is a ring and p2's a box. Two towers standing
  side by side are the pair most easily confused once the board has turned, so they differ
  in shape at every part a player actually looks at.
- The two totals are **bars growing out of the middle of the board in opposite directions**,
  adjacent and on one scale, so "who is ahead and by how much" is answered by which bar is
  longer. p1's is solid with a round cap; p2's is broken into blocks with a square one.
- The wind-up is a row of pips beside the dial, filling outward from the seat's own side so
  both players watch the row fill the same way.
- Rounds left is a bar **centred** on the middle of the board that shrinks from both ends.
  One that grew from the left would appear to grow from the right once the board had
  turned, and would be two readings of one number.
- The needle is drawn hollow-hubbed and steel through the ready pause and solid in the
  seat's colour once it is live, so "not yet" is a shape and not only a stillness.
- A slip is a cross on the base plate, because "no swing" and "a swing worth nothing" look
  identical if the only difference is a puck that did not move.
- The band ticks on the dial are drawn where the score actually changes **for the notch now
  wound**, so they crowd towards the mark as the hammer winds: the cost of waiting, as a
  picture.

## Presentation

- **Shared-screen** — the board makes a half-turn to face whoever is to swing, driven by the
  engine's `SeatFlip` at 0.36 s. Bases, towers, dials, score bars and the rounds bar are all
  placed as `centre ± offset`, so the turn moves nothing that matters.
- **Single-seat** — `seatView` reports no rotation, so the local player always reads it
  upright. `game.test.ts` asserts the two presentations produce an identical trace from the
  same seed, which the ready pause is what makes possible.
