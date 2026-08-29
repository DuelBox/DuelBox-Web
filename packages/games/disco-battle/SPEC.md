# Disco Battle — specification

**Archetype:** `rt-split` · **Category:** Rhythm · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 40 s advertised, and 40 s played

> **Written from the implementation, not before it.** **[ours]** marks our decisions and
> separates them from what the observed row dictates. Every number below was measured against
> the compiled `dist/` with the harnesses in
> `…/scratchpad/h/` (`harness.mjs`, `ladder.mjs`, `balance.mjs`); none of it is remembered or
> hoped for.

One track of notes runs at both players at once. Two lanes leave the middle of the device and
end at a platform at each end; a note travels its lane and lands on the platform. Press as it
lands. Dead centre is worth three, near enough is worth one, a note you let go costs a point,
and so does a press that answers nothing. The track is a fixed length, and the higher score at
the end of it wins.

## Observed rules

> Go wild at the disco! Press at the right moment when the notes hit your platform! Each
> mistake will lower your score, the one with more points at the end of the song wins!

Four clauses, and all four are built: press on the moment, a mistake costs a point, the song
has an end, and the higher score at that end takes it. The row names **no control scheme
beyond "press"**, which — as with The Last Sashimi — meant nothing had to be traded away to
make the game fair.

## A rhythm game is the most instrument-neutral archetype in the catalogue **[ours]**

Cup Pong had to **give up** the reference's swipe, because a drag hands a thumb a continuous
quantity a key cannot match, and it replaced it with two presses against two gauges. Target
Practice spends one press on a distance and one on a moment, and argued that a moment is the
more neutral of the two because it is read off the board rather than off an instrument. The
Last Sashimi went one step further and made every press a bare timestamped event.

This game is the end of that line, and it did not have to work for it:

- **The entire control surface is `actionPressed`.** One bit, per seat, per fixed step.
  `game.ts` reads nothing else — not the pointer position, not the move vector, not the hold
  duration, not `holdSecondsAtRelease`. A test drives two identical matches, one of them with
  the pointer jumping randomly around the board, the move vector saturated, and the action
  held down for the whole match, and asserts the two scores are identical.
- **There is no continuous quantity in the game at all.** Nowhere for a trackpad to be finer
  than a thumb, or a mouse finer than either, because nothing anybody does has a magnitude.
  A press either fell inside a window or it did not.
- So `sameInputClassOnly` is **false**, with no caveat and no "same class recommended"
  footnote. This is the only game so far that can say that without one.

The one thing a rhythm game *does* demand of an instrument is that it not add latency, and
that is a device property rather than an input-family one — a Bluetooth keyboard and a
Bluetooth touchscreen are equally guilty. The engine's reaction rule (outcomes resolved on
source timestamps rather than packet arrival) is the right place for that, and this game does
not need to add anything to it: a press is judged against the clock of the step it arrived
on, and nothing else in the match depends on when it was delivered.

## There is no audio in this product, so the beat is a shape **[ours]**

The engine has an `AudioSystem`, nothing is wired to it, and the repository contains zero
sound files (#168, #169, #170). A rhythm game is the worst case for that, and #180 requires a
visual indicator for every audio-only cue in any case. So this one is designed as if audio
were never coming, and every cue it gives is a shape on the board:

- **The beat is a moving object.** A note is born on the centre line and travels its lane at
  a constant 180 units a second, arriving in exactly `APPROACH_SECONDS = 2`. So the distance
  between a note and the platform *is* the time left before it lands, linearly, and reading
  it is the whole skill.
- **The tolerance is a band, not a number.** The good window is `0.18 s × 180 = 32.4` units
  either side of the platform and the perfect window is `0.075 s × 180 = 13.5`, and both are
  drawn straddling the platform line at exactly that height. A player is never told a window
  in milliseconds; they are shown the shape they have to land inside. `game.test.ts` reads
  the drawn band heights back out of the frame and asserts they are `window × speed`, so the
  picture cannot drift from the referee.
- **Every judgement leaves a mark of its own silhouette** in the gutter behind the platform:
  three pips for a perfect, one for a good, one hollow ring for a note let go, two concentric
  rings for a press that answered nothing.
- **A scoring press drops two markers on the lane at the point it actually landed**, offset
  from the platform line by `lastOffset × 180`. That is how a player learns *which way* they
  were wrong — the marker sits above the line if they were early and below it if they were
  late — with no text and no sound.

There is no text anywhere on the board. A test sweeps a whole match and asserts no `text`
call is ever made.

## Timing windows are in the simulation, and they are wide enough to be a ladder

The fixed step is 60 Hz. A tolerance under about 16 ms is unhittable, and a tolerance
*measured in frames* is measured in the wrong unit — which is how Target Practice's whole
difficulty ladder once collapsed into three spellings of "nearly perfect" inside four frames
of each other, because the floor of its window was the frame rate.

| window | seconds either side | frames across | drawn as |
| --- | --- | --- | --- |
| perfect | 0.075 | **9.0** | ±13.5 units |
| good | 0.180 | **21.6** | ±32.4 units |
| good but not perfect | 0.105 each side | 6.3 each side | the ring between the two bands |

Target Practice asserts eight frames as its floor; this file asserts the same floor for both
windows, and separately asserts the band *between* them is over six frames — because a ladder
whose rungs are one frame apart is a ladder with no rungs.

### Neither boundary can land on a frame

A press only ever lands on a whole frame, and every arrival is `2.5 + k × 0.25`. So
`|press − arrival| = 0.075` would need frame `154.5 + 15k`, and `= 0.18` would need
`160.8 + 15k`. Neither is ever an integer: the margins are half a frame and a fifth of one.

That is deliberate rather than lucky, and it is the lesson from Frozen Beaks and Snowball
Throw — **a threshold that a state variable lands on exactly by construction**. There a
dunked bird's distance from a hole rim was *exactly* the hole radius, and the two seats,
accumulating from opposite ends of the board, straddled the inside-test in the last bits.
Here there is only one accumulator (`clock`) and both seats are judged against it, so there
are no last bits to disagree about — but the boundaries are placed off the lattice anyway,
and a test checks it for every note of every track.

### Two windows can never overlap

The shortest gap the track allows is two slots, 0.5 s, and two good windows together are
0.36 s. So no press can ever be inside the window of two different notes, and the referee
never needs a tie-break between notes — which is exactly the thing Maze Paint and Frozen
Beaks were caught getting wrong. Asserted over every gap of sixty random tracks.

## The track, and why termination is structural

| | |
| --- | --- |
| slot | 0.25 s (a quaver at 120 bpm) |
| gaps | 2, 3 or 4 slots — 0.5, 0.75, 1.0 s |
| gap multiset | **16 of each**, always; only the order is shuffled |
| notes | 49 |
| track | 144 slots = **36.0 s**, for every seed |
| lead-in | 2.5 s |
| tail | 1.5 s |
| match | **40.0 s = 2401 fixed steps**, for every seed |

The gaps are **shuffled rather than drawn**, and that is the whole termination argument.
Drawing 48 gaps from {2, 3, 4} would give a track anywhere between 24 and 48 seconds and a
`roundSeconds` that was an average rather than a fact. Fixing the multiset and permuting it
gives a track whose *rhythm* is different every match and whose *length* is 36.0 seconds
every match. Nothing a player or a bot can do adds a note or a second.

`roundSeconds` ends nothing — it is text on a catalogue card. It reads 40 here because a test
asserts `manifest.roundSeconds === MATCH_SECONDS`, and for no other reason.

**2401 steps, not 2400.** Twenty-four hundred sixtieths accumulated in floating point come to
39.999999999999670, a hair under the forty the match ends at, so the tail's last step is
charged on step 2401. That is asserted as a literal rather than computed, so a change to the
accumulation shows up as a failing count.

## Scoring, and the two tie-breaks

| | |
| --- | --- |
| press inside ±0.075 s | **+3** |
| press inside ±0.18 s | **+1** |
| note whose window closed unanswered | **−1** |
| press with no unanswered note in reach | **−1** |
| best possible | 147 |

The second penalty is the half of the row that makes the game a game. A press outside every
window costs **twice**: once as a wild press, and again when the note it was aimed at closes
unanswered. That is what stops a player mashing, and it is measured rather than assumed — a
seat that presses on **every one of the 2401 frames** finishes on **−2303**, for every seed:
49 goods, 2352 wild presses, and **not one perfect** — the earliest frame inside a window is
the one that takes the note, and that frame is 0.18 s early.

Scores go negative and are meant to. `easy` sits at +29 and a bad human will sit below zero.

### The win condition is the SDK's; the tie-breaks are ours

`resolve({ kind: 'highest-when-time-expires' }, …)` decides the score comparison, so "highest
at the end" means here what it means everywhere else. Level on score, two more rules apply,
in order: **more dead-centre hits**, then **fewer mistakes** (notes let go plus wild presses),
then a genuine draw.

They exist because the score is a small integer two players of the same standard land on
together more often than is comfortable — measured over 1500 matches a tier:

| tier | level on score | still level after perfects | true draw |
| --- | --- | --- | --- |
| easy | 2.33% | 0.40% | 0.13% |
| normal | 1.47% | 0.00% | 0.00% |
| hard | 1.60% | 0.33% | 0.33% |

**Neither tie-break is a function of the board**, which is the trap Maze Paint and Sudoku were
dug out of: on a symmetric position a covariant rule returns a mirrored answer and so decides
nothing. There is no board here to be a function of — a note's arrival is shared by both seats
— and both tie-breaks count what a *player* did, which is the only thing in this game that
can differ between the two of them.

## Seat symmetry is a proof, not a measurement

**Seat one takes exactly 50.0% at every tier and every sample size.** Not 49.7%, not 50.4%.
Three things stack up to that, and the third was added after measuring:

1. **One track, one clock, one cursor.** `arrivals` is a single array read by both seats.
   There is no per-seat generation to drift, and — the point Snowball Throw's 64.3% turned on
   — no board coordinate for a rule to be written in and get wrong under the half-turn.
2. **The seats never touch each other.** Each answers the same track alone; the match is the
   comparison of the two answers, which is what the row asks for. `judgePress` reads only its
   own seat's arrays and moves no shared state, so swapping the two press bits swaps the two
   scores **exactly**. Asserted over 400 random tracks and press streams (0 mismatches) and
   over 360 bot matches with the two streams changing seats (0 mismatches), with `toEqual` and
   never `toBeCloseTo`.
3. **`openingSeat` decides which of the two derived bot streams goes to which seat.** **[ours]**

The third is worth explaining, because a real-time game is allowed to ignore that field and
this one initially did. `balance-aggregate.test.ts` plays each seed once from each opener; a
game that ignores the opener plays the *same match twice* under both, so the pair of rounds
carries one sample, not two, and the fifty-seed push sample read:

| tier | ignoring `openingSeat` (50 seeds) | ignoring it (250 seeds) | handing streams out by role |
| --- | --- | --- | --- |
| easy | 56.0% | 50.4% | **50.0%** |
| normal | 56.0% | 50.4% | **50.0%** |
| hard | **64.0%** | 57.7% | **50.0%** |

Nothing was wrong with the game — the 64.0% was the seed sequence, and 3000 independent seeds
gave 49.7%. But "50-ish by sampling" is the weaker of the two things a game can have (lesson
9), and the fix is three lines. The two seat streams are drawn in a fixed order from the match
seed and handed out **by role rather than by seat**: the opener gets the first, the answerer
the second. The track is drawn before both, so both halves of a pair play the identical music.
Combined with the proven involution, the second round of a pair is the *exact mirror* of the
first, and seat one's share over any seed set is 50.0% by construction. A test asserts the
mirroring board-by-board rather than the share.

This is the only thing in the game the two seats do not already share, which is why it is the
only thing the opener has to decide.

## The board

```
 y = 0     ── seat two's outer edge ──────────────────────
 y = 140   ═══ seat two's platform ═══   (good band 107.6 … 172.4)
              seat two's lane, notes travelling up
 y = 500   ─── the stage: notes are born here ───
              seat one's lane, notes travelling down
 y = 860   ═══ seat one's platform ═══   (good band 827.6 … 892.4)
 y = 1000  ── seat one's outer edge ──────────────────────
```

`PLATFORM_Y_P2 = 1000 − PLATFORM_Y_P1` exactly, and the lane geometry is one sign flip rather
than two copies. So the board is its own half-turn image, and rule 9 holds as a picture:
neither seat can see a note a moment sooner than the other, or from further away. A test
plays thirty stretches of a no-input match and asserts that every mark either seat owns has a
partner at the point exactly half a turn away.

`APPROACH_SPEED = LANE_SPAN / APPROACH_SECONDS = 180` is the **only** conversion between the
simulation and the board in the whole game.

### Rule 8: no pixels anywhere in `rules.ts`

Nothing in the simulation is a length. A note is an arrival *time*; a window is a tolerance in
*seconds*; a note's place on the lane is reported as a **fraction** (`approachOf`), and so is
the clock (`remainingOf`). `game.ts` multiplies by 180 and that is the only place a unit of
board exists. Rule 8 is not merely obeyed here, it is inexpressible.

That is not tidiness — it is what makes the bot's countdown and the referee's window the
**same arithmetic** rather than two roads to nearly the same answer. See below.

### Rule 7: never colour alone, and no text at all

`greyscale.test.ts` throws away position and rotation before it compares the two seats, so on
a board that is its own half-turn image "the lane at the bottom" is **no distinction at all**.
That is the specific trap an `rt-split` rhythm game walks into. What separates the seats here
is the silhouette, stated as an invariant:

- **every mark drawn in one of seat one's four palette colours is a circle**, and
- **every mark drawn in one of seat two's four palette colours is a square**,

for platforms, notes, judgement marks and press markers alike, with no exception. The
harness's evidence collapses the moment the other seat draws the same primitive **even once**,
so `game.test.ts` sweeps 600-plus sampled frames of a whole match and asserts it on every
seat-coloured draw call. It also asserts both seats have marks on **every** sampled frame
rather than the ten the harness needs — the receptors are unconditional and on screen from
frame zero.

Everything else — lanes, bands, platform line, clock — is a neutral colour, because it belongs
to neither player and both seats are asked for the same tolerance.

Within a seat, the four judgements differ by shape too (3 pips / 1 pip / 1 ring / 2 concentric
rings), and a note's three states differ by fill (live: solid; taken: outline at full size;
let go: outline at 55%). Seat two's squares are drawn at `√π/2` of seat one's radii, so the
two silhouettes cover the **same area** — neither seat's marks are the bigger target or the
easier one to spot.

Seat two's squares against seat one's circles is the same pair Happy Hippos uses, deliberately:
a pair who learn that they are the round player in one game should be the round player in the
next.

## Controls

| | |
| --- | --- |
| keyboard | Space is player one, Enter is player two. One press as the note lands. |
| pointer | Tap anywhere in your own half as the note lands on your platform. |

The tap has **no target**. Anywhere in your own half is the same event as your key, which is
what makes the two instruments equivalent and is also what `control-parity.test.ts`'s pointer
arm needs — it aims at a random point in seat one's half and nothing else.

The engine owns seat ownership: a touch belongs to the seat it started in. Nothing in this
package reimplements that, and nothing in it reads where the touch was.

## Termination

A fixed-length track, and 2401 steps whatever anybody does. Asserted three ways: with nobody
pressing, with both seats pressing on every frame, and with two `easy` bots — the pairing
`termination.test.ts` uses. In every case the match ends and every one of the 98 note/seat
outcomes is resolved (`cursor === NOTE_COUNT`, no judgement left at `none`).

`termination.test.ts` allows ten simulated minutes. This takes forty seconds.

## The bot

Three tiers, differing only in **how accurately the tier hits the moment it meant to**. That
is the whole of the skill a rhythm game asks for, so it is the whole of what the tiers differ
in.

| | `timing` (s) | `fumble` | `stray` |
| --- | --- | --- | --- |
| easy | 0.40 | 0.10 | 0.14 |
| normal | 0.31 | 0.05 | 0.07 |
| hard | 0.25 | 0.02 | 0.02 |

- **`timing`** is the half-range of a **triangular** error (two uniform draws summed). Flat,
  a tier either fits inside the window or it does not with nothing in between, and three
  tiers have almost nowhere to stand between them.
- **`fumble`** is how often a note's error is multiplied by `FUMBLE_SCALE = 2` outright.
- **`stray`** is how often the tier double-taps `STRAY_GAP_SECONDS = 0.34` after its real
  press — larger than the good window, so a double-tap can never rescue the note it follows,
  and not a whole number of slots.

Rule 6 holds by construction: every number is in seconds of human error, every one is several
frames wide, and there is no channel a bot could be told anything on — it produces the same
one bit a person does, on the same step, judged by the same referee. A tier commits to a
moment when the note **appears on the lane**, which is exactly when a player can first see it.

`easy` at four tenths of a second sounds generous until you remember there is no sound: a
beginner reading a beat off a moving shape, with nothing to hear, is that far out often.

### The bot's countdown and the referee's window are the same arithmetic

Issue #2465: a bot that reasons analytically about a quantity the simulation integrates
numerically must agree with it *exactly*, and five games in this repository did not.

Here they cannot disagree, and one ordering decision is why. A tier commits to
`arrival − clock + offset` and counts that down by one delta a step, so it presses on the
frame nearest `arrival + offset`. `step()` therefore **judges a press against the clock the
step began with and advances the clock afterwards** — so the referee reads that same frame's
clock. Judging after the advance would make every bot press in the catalogue a systematic
sixtieth of a second late: a fifth of the perfect window, charged to one player and not to the
person sitting opposite.

A test commits by hand, reads the moment the tier drew, and asserts the press lands within
half a step of it. Worst case over 180 commitments across all three tiers: **≤ 1/120 s**, the
bound half a frame gives, with `toBeLessThanOrEqual` and no tolerance added.

### A bug found by measuring, not by reading

The tiers first measured at 19.5 / 54.8 / 96.3, with `hard` letting **25.8 of 49 notes go**
while making only **1.7** wild presses. That shape — not pressing, rather than pressing badly
— is what gave it away.

`timer` uses **−1 as its idle sentinel** and was decremented while `timer > delta/2`. A
decrement from just above `delta/2` lands in `(−delta/2, 0)`, which reads as *idle* on the
very next step: the committed press vanished without a trace and the tier planned the
following note instead. It cost **about half of every tier's presses**, at every tier, in a
way no unit test in the package could see and no win-rate ladder could either — because it
hit both seats equally.

The fix is a floor at zero on the decrement. It cannot move which frame a press lands on: it
only ever applies on the step whose remainder is already inside half a delta, which is the
step the fire branch takes anyway. The ladder went to 29.0 / 57.5 / 83.4, and a test now
asserts every tier presses at least once per note.

Worth naming as a family, alongside the two from Frozen Beaks and Snowball Throw: **a
sentinel value that a live quantity can reach by ordinary arithmetic.** Zero and −1 are both
in the range of a countdown.

### Randomness: three streams

The track has its own, so the music is a function of the match seed and never of how many
values a tier happened to draw — two `hard` bots and two `easy` ones must be able to play the
*same* forty seconds, or a tier comparison is comparing two different songs. Each seat then
has its own, because on one shared stream whichever seat is polled first takes the earlier
value every time, which is a seat bias dressed as chance.

Every tier draws exactly **`BOT_DRAWS_PER_NOTE = 4`** values per note, unconditionally, before
anything branches — so a fumbled note and a clean one cost the same randomness and nothing on
the board can pull a stream out of step. Asserted by counting: 49 notes, 196 draws, at every
tier.

### Every knob, swept alone

Each swept across its whole range with the other two held at `normal`, against a `normal`
opponent, 800 seeds a point from each seat order. **All three are monotone across their whole
range**, which is not a given — three of the first six games deleted knobs after measuring
them, one of which ran backwards and one of which changed sign across the ladder.

**`timing`** — the lever the tiers actually ride:

| value | win rate vs `normal` | mean score |
| --- | --- | --- |
| 0.15 | 100.0% | 115.5 |
| 0.20 | 99.6% | 99.3 |
| **0.25** (`hard`) | 90.7% | 79.2 |
| 0.28 | 72.2% | 67.9 |
| **0.31** (`normal`) | 50.0% | 57.6 |
| 0.34 | 29.0% | 48.2 |
| **0.40** (`easy`) | 7.8% | 32.5 |
| 0.50 | 1.3% | 14.0 |
| 0.65 | 0.0% | −2.3 |

**`fumble`** — real, and about eleven points across the range the tiers use:

| value | win rate | mean score |
| --- | --- | --- |
| 0 | 57.5% | 60.8 |
| **0.02** (`hard`) | 54.0% | 59.4 |
| **0.05** (`normal`) | 50.0% | 57.6 |
| **0.10** (`easy`) | 42.2% | 54.4 |
| 0.20 | 30.3% | 48.4 |
| 0.35 | 15.3% | 39.1 |
| 0.50 | 6.6% | 30.3 |

**`stray`** — the one that was expected to misbehave, and does not:

| value | win rate | mean score |
| --- | --- | --- |
| 0 | 53.6% | 59.3 |
| **0.02** (`hard`) | 53.0% | 58.8 |
| **0.07** (`normal`) | 50.0% | 57.6 |
| **0.14** (`easy`) | 46.3% | 55.7 |
| 0.25 | 37.8% | 52.5 |
| 0.40 | 28.8% | 48.3 |

The worry about `stray` was concrete: a double-tap 0.34 s after a late press can land inside
the *next* note's window when the gap is two slots, so the knob could have paid a tier for
being sloppy. It does not — a stray that steals the next note leaves the tier's own planned
press for that note wild, so the two roughly cancel and the wasted presses dominate. All three
knobs are kept; none is flat and none is backwards.

### The tiers were narrowed after measuring the duel, not the scores

The first set — 0.46 / 0.32 / 0.22 — read as a fine ladder on its own scores (18.2 / 54.6 /
95.3) and was a **cliff as a duel**: `hard` took **99.4%** off `normal` and **100.0%** off
`easy` over 1600 matches each, so two of the three tiers were unplayable rather than merely
harder. Narrowing the ends to 0.40 and 0.25 costs nothing in separation and buys a `normal`
player a real chance.

## What was measured

All figures from `dist/` through the real `GameModule` — `init`, `update`, `getScore`,
`destroy` — rather than from `rules.ts` directly.

### Per tier, 1500 matches, both seats at that tier

| tier | perfect | good | let go | wild | score (of 147) |
| --- | --- | --- | --- | --- | --- |
| easy | 16.19 | 17.65 | 15.15 | 22.08 | **29.0 ± 13.8** |
| normal | 20.32 | 19.12 | 9.55 | 13.06 | **57.5 ± 13.1** |
| hard | 24.70 | 19.65 | 4.65 | 5.65 | **83.4 ± 11.1** |

Because the two seats never interact, these are also the solo numbers: a bot alone in the
game scores exactly this.

**`hard` does not saturate.** It answers 44.35 of 49 notes and scores 57% of the maximum,
leaving 4.65 notes on the floor and 5.65 wasted presses a match. Sudoku's `hard` answered
100.0% of squares and made a duel nobody could lose; there is a real match left here at the
top tier, and the ±11.1 spread is what makes it one.

### Equal tier, seat one's share, 1500 seeds a tier from **each** opening seat

| tier | seat one | draws |
| --- | --- | --- |
| easy | **50.0%** (1498 / 2996) | 4 of 3000 |
| normal | **50.0%** (1500 / 3000) | 0 of 3000 |
| hard | **50.0%** (1495 / 2990) | 10 of 3000 |

Exact, by construction, at every sample size — including the fifty-seed sample
`balance-aggregate.test.ts` runs on every push, where a local replica of that file's own
methodology also reads 50.0% at all three tiers.

### Cross tier, 1500 seeds a cell, from each seat order

| | as seat one | as seat two | mean |
| --- | --- | --- | --- |
| `normal` beats `easy` | 92.8% | 93.2% | **93.0%** |
| `hard` beats `normal` | 93.4% | 93.7% | **93.5%** |
| `hard` beats `easy` | 99.9% | 99.9% | **99.9%** |

The two seat orders agree to within half a point everywhere, which is the ladder saying the
same thing the symmetry proof says.

The ladder is steeper than most games in the catalogue, and that is what a rhythm game is:
0.31 s of timing error against 0.25 s is an enormous difference in a discipline whose entire
content is timing error. Adjacent tiers still leave the weaker side a real 6.5–7% rather than
the 0.6% the first tuning gave.

## Cross-game guards

Verified against the built `dist/`, with `npx tsc --build packages/games/disco-battle/tsconfig.build.json`
run first (the guards load from `dist`, not `src`):

| guard | result |
| --- | --- |
| `termination` | ✓ two `easy` bots reach a decision |
| `input-fuzz` | ✓ survives two children mashing the screen |
| `cross-viewport` | ✓ identical match at every viewport; every point inside the box |
| `greyscale` | ✓ the two seats differ by more than colour |
| `presentation-parity` | ✓ all three rows, including switching presentation mid-match |
| `control-parity` | ✓ answers a keyboard and a thumb alike |
| `bot-parity` | ✓ all three rows |
| `bot-cost` | ✓ inside a frame at the hardest tier |
| `balance-aggregate` | 50.0% at every tier — see note below |

`balance-aggregate.test.ts` could not be run in-tree: its suite fails to load while sibling
packages other agents have registered are missing from `node_modules`. The figure above is
from a faithful local replica of that file's own methodology (same seed sequence
`1000003 + 7919s`, same both-openers pairing, same silent driver, same tier), run against this
game alone.

## What we did not build from the catalogue row, and why

- **The disco.** "Go wild at the disco!" is the row's flavour, not a rule. Lights, a crowd and
  a dance floor are art, and CLAUDE.md rule 1 forbids taking any of it from anywhere; the
  catalogue ships zero image assets and this game adds none. The board is a stage strip, two
  lanes and two platforms, all drawn with engine primitives.
- **Music.** There is none in the product (#168–#170) and none is invented here. When audio
  lands, the track in `rules.ts` is already a list of beat times in seconds and needs no
  change to be played — the visual design stands on its own either way, which is the point.
- **Multiple lanes or note kinds.** The row says "the notes", singular kind. One lane a seat,
  one kind of note, one press. A second lane would need a second key and would put a
  keyboard's two-hand advantage against a thumb, which is exactly the fairness this archetype
  was chosen for.
- **A combo multiplier.** Not in the row, and it would make an early mistake compound into a
  lost match — an outcome a player cannot read off the board and cannot recover from.
- **`roundSeconds` as a clock.** It ends nothing anywhere in this product. The clock is in
  `rules.ts`.

## For whoever picks this up

The three things most likely to be broken by a well-meaning change:

1. **The order inside `step()`.** Presses are judged, *then* the clock advances, *then*
   windows close. Moving the advance to the top makes every bot press a frame late and
   nothing will fail loudly.
2. **The one-primitive-per-seat invariant in `game.ts`.** Adding a seat-coloured `rect` to
   seat one's side — a score bar, a flash, anything — silently destroys `greyscale.test.ts`'s
   evidence, because it has no stability threshold on the other seat's side: one frame is
   enough.
3. **`openingSeat` deciding the stream order in `init`.** It looks like dead code for a
   real-time game. It is what makes seat one's share exactly 50.0% instead of 64.0% on the
   push sample.
