# Sticky Tongues — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 100 s advertised and enforced

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and every
> number below was measured by driving `dist/rules.js` headless — sweeping one constant at a
> time against a rebuilt copy of it — rather than estimated. The harness is described under
> "How the numbers were taken".

One marsh, seen from above, with a frog on each bank and eight dragonflies drifting through the
air between them. Hop about your own bank and flick: the tongue goes straight out, hangs at full
stretch, and drags back whatever it touched. A dragonfly is a point. Nothing is a **wasted shot**,
and six of those lose you the match. The other frog is a **blow** — it goes home stunned, which
costs it two seconds and its position and costs you the shot. First to thirty-five dragonflies.

## Observed rules

From the catalogue row: _"Use your tongue to catch the dragonfly, and use the joystick to escape
from your opponent's blows! Don't miss too many shots or you'll lose the match!"_

All three clauses are built: the tongue and the dragonfly, the blow you have to escape, and the
loss condition on missed shots. What is **not** built is the row's implied controller. "Joystick"
names a *position on a pad*, which is a continuous two-dimensional quantity a thumb can produce
and a key cannot; the next-but-one section is the decision that replaces it, and it is the same
move Frozen Beaks made for the same reason.

Everything else — the marsh, the two banks, the fly band, the thirty-five, the six, the hundred
seconds, and what exactly a blow costs — is ours, and each is marked below.

## The frog cannot move while its tongue is out **[ours]**

This reads as flavour and is the load-bearing decision in the file.

It makes the path the tongue sweeps a **vertical segment**, which is a shape that can be tested
exactly. `reaches(x, y0, y1, targetX, targetY, radius)` is point-to-segment distance, and it is
what the simulation applies one step at a time *and* what the bot applies to a whole shot. For a
sky that is holding still the union of the per-step segments **is** the whole-shot segment, so
`shotValue` and the outcome are the same number rather than nearly the same number. That is issue
#2465 designed out rather than patched, and `rules.test.ts` asserts it over sixty random marshes
in both seats. Happy Hippos solved this first and the debt is acknowledged here rather than
rediscovered.

It is also the whole tension of the game. **The price of shooting is three quarters of a second
in which you cannot dodge** — and the other frog's tongue reaches you, if you have come far enough
forward to be worth reaching. Catching and escaping are not two mechanics bolted together; they
are one commitment, taken or not taken.

## Two mechanics, one hand **[ours]**

`docs/input-idiom.md` records the fault this section exists to avoid, twice:

> **tennis** — Manifest says "every fresh press is a jump for a high ball" and the code binds the
> jump to `actionPressed`, which a *steering* press also raises. Steering and jumping share one
> edge, so beginning to move is also a jump.
>
> **wrestle** — Absolute lean from the wrestler's X, plus `actionPressed` as the leap — so
> beginning to lean is also a leap, same collision as tennis.

The cause is in `packages/engine/src/input.ts`: `actionHeld = keys.action || pointerDown`. **A
finger on the glass is the action.** A keyboard has never had this problem, because the four
directions and the action are five separate key slots. So the whole difficulty is the pointer,
and this game answers it by never firing on a pointer press at all.

**One latch decides which channel a gesture is, and it decides once:**

| | Stays inside `TAP_RADIUS` **and** ends inside `TAP_SECONDS` | Anything else |
|---|---|---|
| What it is | a tongue shot | steering |
| When it fires | on the release, with the values the game carried | never |
| What it steers | nothing — inside the radius the heading is zero anyway | the frog, at `FROG_SPEED` |

`TAP_RADIUS` is **6 units = two precision envelopes**, which is the tap radius
`docs/input-idiom.md` defines, in envelopes so it can never be finer than the five-unit lattice
`InputManager` quantises a coordinate onto. The latch is one-way: a drag that wanders 40 units and
comes back to the press point is still a drag and still cannot fire.

### Why the radius alone is not enough, measured

The obvious implementation is the radius on its own, and it is wrong in a way that only shows up
against the real engine. A finger resting on one spot is quantised onto a **five-unit lattice**,
so a player holding still to steer never leaves the six-unit radius, never reads as a drag, and
**never steers at all**. `TAP_SECONDS = 0.25` closes it: a gesture that outlives the window is a
steer whether it has moved or not.

Two hundred and fifty milliseconds is a boundary **no player aims at**. It is a ceiling on a
gesture nobody wants to be long — a deliberate tap is 50 to 150 ms — rather than a target to land
on, so the 30 ms of latency `docs/input-parity.md` allows between input families cannot push
anybody over it. That is a stronger argument than a plateau, and it is the reason this is not
`sameInputClassOnly`.

The cost, stated plainly: a player who presses and holds *perfectly still* waits a quarter of a
second before the frog starts walking. A player who drags — which is what moving a frog to a place
looks like — crosses six units inside one or two frames and waits for nothing.

### Six tests, all driven through a real `InputManager`

Every test in `game.test.ts` under "steering and the tongue are separate channels" drives the real
engine, never a hand-built input record, because the fusion this is about **only exists inside
`InputManager`** and a literal cannot reproduce it. That is also the shape of the Sea Battle
defect the same audit records: `actionReleased && holdSeconds > 0.4` is a contradiction the engine
can never emit, and its test supplied the literal anyway, so a keyboard long-press that had never
once fired stayed green for months.

- a 200-step wandering drag over the whole bank fires **zero** tongues, and moves the frog;
- a press-and-release fires exactly one, and **not on the press step**;
- a finger held on one spot past the window steers and fires nothing;
- a drag that returns to the press point still fires nothing;
- holding `W` and `D` for two seconds fires nothing, and `Space` on the next step fires one;
- a pause mid-gesture forgets it rather than releasing it into a shot.

## Steering is nine headings, and the argument for it **[ours]**

The row says joystick. A joystick is a position on a pad: two continuous numbers. A key produces
one of three values per axis and nothing between them, so a game that reads a pad position gives
a thumb a vocabulary a key cannot spell, and `docs/input-parity.md` rules that unfair.

So the steering command in this game is **the sign of the gap on each axis, deadzoned** — nine
values, eight compass points and a standstill, which is exactly what `InputManager` already hands
a game as `move`. `headingSign` is the only function that produces one, and every caller goes
through it: the keyboard path, the pointer path and the bot. Diagonals are normalised through
`Math.SQRT1_2`, the same factor the engine applies when it caps two keys at unit length, so all
eight directions cover the same ground.

`STEER_DEADZONE` is **12 units = four precision envelopes**, per `docs/input-idiom.md` rule 2
rather than a hand-picked constant. Inside it the answer is a standstill and never "keep going the
way you were", because a resting thumb must not read as a held key.

`game.test.ts` drives the same walk through both instruments on a real `InputManager` — `D`+`W`
held, against a finger parked up and to the right of the frog — and asserts the two frogs land on
**the same coordinate to twelve decimal places**. A second test slams a thumb into the far corner
and asserts the frog still moves exactly one frame's worth.

**Why not chase-the-finger with an absolute target?** Because the position would then be the
command, and a thumb can name a position a key cannot. Rate-limiting the walk fixes the *speed*
and not the *vocabulary*: with an absolute target a finger can ask for a heading of 13.7° and a
key cannot ask for anything but 45°. Nine headings is the only binding where the two instruments
are producing the same alphabet rather than one being a coarser sampling of the other.

### Fairness across input families

**Verdict: cross-device fair.** `sameInputClassOnly` is false, and the manifest says why.

| | Values | How a key names it | How a finger names it |
|---|---|---|---|
| **Heading** | one of nine | which of W A S D are down | the sign of the gap on each axis, deadzoned |
| **Shot** | one binary event with a timestamp | `actionPressed`, with no pointer under it | a gesture inside the tap radius and window |

Nothing else crosses the interface. There is no aim, no charge, no power meter, and no continuous
quantity anywhere in the game.

**Cadence.** `docs/input-idiom.md` draws the cross-device line at about two committing presses a
second. A shot costs `SHOT_CYCLE_SECONDS = 0.75`, so the ceiling is **1.33 shots a second** by
construction, and measured the three bot tiers spend 0.62, 0.82 and 0.95 a second. `rules.test.ts`
asserts both the ceiling and the measurement.

**Rule 9.** Both players see the whole marsh. There is nothing to see more of.

**The one asymmetry, and its size.** A key fires on the press; a finger fires on the release, so a
pointer player's shot is late by however long their tap was. A tap is 1 to 9 frames; a tongue
takes 9 frames to reach full stretch and hangs there for 7 more; a dragonfly drifts at most 190
units a second against a 28-unit catch radius. So a slow 150 ms tap moves the aim point by 28
units at the very worst — one catch radius — and the pointer buys, in exchange, an absolute
binding that names a destination in one gesture where a key has to hold a direction. The two are
not identical and they are not orderable; `control-parity` passes.

## Rule 7: the thing you are aiming at is the other player

Colour was never going to be enough here, because the two frogs share one board and one of them is
a target. **Seat one is round throughout and seat two is square throughout**, and the pair runs
through every object a seat owns:

| | Seat one | Seat two |
|---|---|---|
| Frog body | disc, radius 32 | square, half-side 28.36 |
| Eyes | two discs | two squares |
| Tongue tip | disc | square |
| Shots left | a row of discs | a row of squares |
| Stun ring | a ring | a box |

The square's half-side is `radius × sqrt(pi) / 2 = 28.36`, so the two frogs cover **the same
area**, and both are hit by the identical circular test at `SLAP_RADIUS = 44`. Neither seat is the
bigger target and neither is easier to pick out of the marsh. `game.test.ts` asserts the area
equality from the render trace rather than from the constant.

**The dragonfly is neither.** It is a pair of crossed strokes with a small body — an X in
silhouette, drawn in neutral ink — so it cannot be read as either frog with the colour taken away.
A replacement that has not settled yet is drawn **hollow and growing**, so "cannot be caught yet"
is a fill and not a hue. A wasted shot turns a solid pip into an outline, so the count that loses
the match is a number of solid marks.

A test asserts that every mark drawn in seat one's palette is a circle, a stroke, a line or a
label, that every mark in seat two's is a rect, a stroke rect, a line or a label, and that with
every colour argument stripped out of the trace the frame still contains both families.
`apps/web/src/data/greyscale.test.ts` judges this game — it is in none of that file's exception
buckets — and passes.

## The marsh

| | Value | Why |
|---|---|---|
| Board | 600 × 1000, portrait | A bank at each end, the air between them, and each seat's own band is full width so an absolute pointer binding reaches all of it |
| Water | x 20–580, y 20–980 | |
| Bank | seat one y ∈ [560, 950], seat two y ∈ [50, 440] | Half-turn images. The banks stop 120 apart, so the frogs never overlap |
| Frog | radius 32, x ∈ [60, 540] | 480 units of lane, 1.6 s to cross |
| Home | (300, 950) and (300, 50) | Where a blow puts you: the middle of your own back line, always out of reach |
| Air | y ∈ [300, 700] | 400 units, symmetric about the middle |
| Dragonfly | radius 16, eight of them, 110–190 units/s | Caught at 28 = tongue + fly |
| Tongue | half-width 12, reach 340 | Hits a frog at 44 = tongue + frog |
| Shot | out 0.15 s, **held 0.12 s**, back 0.20 s, recover 0.28 s | 0.75 s a cycle, tongue out for 0.47 of it |
| Blow | home, 2.0 s stunned, shot over | |
| Match | first to 35 dragonflies, or six wasted shots; a 100 s clock behind both **[ours]** | |

### The depth gradient, which is the whole decision **[ours]**

The reach and the band depth are chosen against each other, not for the look of them. A tongue
covers the segment from the frog to `frog ± 340`, so how much of the 400-unit band it sweeps
depends on how far forward the frog is standing. Measured on the shipped constants, by firing a
shot from a fixed depth at 400 arbitrary skies and counting what it took:

| Frog stands at | Band swept | Dragonflies a blind shot takes | Can the far tongue reach it? |
|---|---|---|---|
| its own back line, y = 950 | 90 units | **0.29** | no, from anywhere |
| the threat line, y = 824 | 216 units | — | only just |
| the peak, y = 700 | 340 units | **1.18** | yes |
| the front of its bank, y = 560 | 260 units | **1.06** | yes |

So **coming forward is worth four times as much hunting, and coming forward is exactly what puts a
frog inside the other tongue's arc.** The back line is a safe harbour with poor pickings; the
richest water is the strip that both tongues can reach; and over-advancing to the very front is
*worse* than the peak, because the tongue then hangs out past the far edge of the band. There is
an interior optimum and it is dangerous, which is the shape a duel wants.

The two numbers that make it true, and which a change to either constant would break:

- from its own back line a tongue tip stops at `950 − 340 = 610`, which is **126 short** of what it
  would need to touch the nearest the far frog may ever come (440, plus its own 44) — so a retreated frog is unreachable,
  for any position of the attacker, and a test asserts it by sweeping the whole far bank;
- from the front of its bank a tip reaches `560 − 340 = 220`, well past the far frog's own front
  line at 440 — so two frogs that both want the peak are both in range.

The changeover is `threatLineOf(seat) = 824` for seat one and 176 for seat two, and it is **drawn
on the board** as a chalk line, because "how far forward is safe" is the decision the game is made
of and a player should not have to discover it by being hit.

### A caught dragonfly is replaced at the half-turn image of where it was caught **[ours]**

No randomness at all, and it buys three separate things:

- **The simulation after the opening layout is exactly covariant under the half-turn.** Nothing
  the players do draws from a stream, so mirroring the marsh and mirroring the commands gives back
  the mirror of every step. Seat balance is a structural claim here rather than a measured one —
  see "The half-turn" below.
- **A tier that thinks more often cannot be dealt a different marsh.** With a shared stream, `hard`
  looking three times as often as `easy` would change what the air held, and every balance number
  here would be a fiction about a marsh nobody else plays.
- **It is a fair rule a player can read off the board.** Whatever you take from your side comes
  back on the other side, which is what stops a strong hunter emptying the middle and standing in
  it. The 0.85 s it spends settling is drawn, so nothing can camp a spawn point either.

## Scoring, and the two ways a match ends

A shot resolves against everything its segment covered, and it is judged when the frog comes back
to rest:

- **every live dragonfly the segment touched is caught**, one point each;
- **the far frog, if the segment reached it, is knocked home and stunned**;
- **a shot that caught nothing is wasted**, and six wasted shots lose the match.

Landing a blow does **not** excuse a wasted shot. A shot fired at the far frog costs you a shot and
buys their tempo, which is a trade a player may choose to make rather than a free move. A shot that
takes a dragonfly *and* clips the far frog costs nothing at all, and lining that up is the best
thing you can do in this game.

**A clash does excuse it.** When both tongues cover one dragonfly, `resolveSimultaneous` on the two
commit times decides it — a step is 16.7 ms and the SDK's tolerance is 8, so "committed on the same
step" and "a genuine draw" are the same statement, and a draw means neither frog gets it. Whichever
way it goes, the tongue that came away empty is marked as having clashed and is not charged a shot.
Two tongues arriving on one dragonfly is a coincidence of timing that falls on both seats equally,
and charging both for it would put a slice of every match on a coin.

`resolveSimultaneous` is **imported, not copied**. Three games in this catalogue inlined their own
four-line version; the fourth would have been the one where the tolerance and the step size stopped
agreeing without anybody noticing.

### The verdict is three SDK calls in a fixed order, and not one comparison of our own

```
1. reduce-to-zero  over shots remaining   -> has anybody run out?
2. first-to 35     over dragonflies       -> has anybody got there, or has the whistle gone?
3. highest-when-time-expires over shots remaining
                                          -> the whistle left them level: who wasted fewer?
```

Both endings the catalogue row names are real, so both are asked. A level crossing of thirty-five
on one step is a genuine draw and is left alone; a level *whistle* is broken on wasted shots,
because a score is one of thirty-six values and two players of the same standard sit on the same
one of them often. `resolve`'s options object and the shots-left tally are **hoisted to module
scope and mutated**, because the match is judged on every step and a fresh object sixty times a
second is exactly what rule 5 forbids.

### Termination is the clock, and it lives in the rules **[ours]**

`manifest.roundSeconds` ends nothing anywhere in this repository — it is text on a catalogue card.
`MATCH_SECONDS = 100` is in `rules.ts`, where a person and a bot are the same thing, and a test
asserts the two numbers are the same hundred.

It is a genuine backstop and not the game: **in 4500 bot matches it decided none of them.**
`rules.test.ts` plays two seats who never touch the device **with no step cap at all** — a match
that could not end would hang the suite rather than pass quietly — and asserts it ends, drawn, on
the step the clock says. `apps/web/src/data/termination.test.ts` passes.

### Is the waste limit dead code? No — measured

The honest question about a second loss condition is whether anything ever reaches it. Over 1500
equal-tier matches at each tier:

| | ended on thirty-five | ended on six wasted shots | ended on the clock |
|---|---|---|---|
| easy v easy | 1461 | **39** (2.6%) | 0 |
| normal v normal | 1388 | **112** (7.5%) | 0 |
| hard v hard | 1404 | **96** (6.4%) | 0 |

About one match in twenty, bot against bot — and that is the *low* figure, because a bot only ever
shoots when it has a reason to. A person who taps at the sky, which is what a child does and what
the row is warning about, reaches six in well under a minute: the pips run out in four and a half
seconds of spraying. Solo, three or four `easy` bots in every four hundred lose to it with nobody
opposite them at all.

## The half-turn, and the symmetry proof

**Seat one's share at equal skill is not a measurement that came out near fifty. It is a property
of the file, asserted board by board.**

Three things make it so:

1. **The opening layout is mirrored pairs.** Slot `2k + 1` is placed at the half-turn image of slot
   `2k` with its heading reversed, so the opening marsh is exactly symmetric for any seed. Asserted
   over 200 seeds to ten decimal places.
2. **Nothing after the opening is random.** Replacements are reflections, not draws.
3. **Both seats decide before either moves.** `botDecide` writes a heading into `BotState` and the
   caller applies it, in a separate pass, after both seats have looked. This is not decoration: a
   bot reads where the far frog is standing, so moving seat one before seat two looked handed seat
   two half a step of fresher information — and it is exactly the kind of asymmetry the mirror
   test *would* catch, because mirroring swaps the two frogs and leaves the read order alone. It is
   designed out rather than caught: `rules.test.ts` asserts that reading the two seats in the
   reverse order gives a bit-identical match, at every tier, over 25 seeds each.

The tests, written first and in this order:

- **`steps a mirrored board to the mirror of the stepped board`** — 500 arbitrary boards, mirrored,
  with mirrored commands, compared field by field. `scramble` deliberately puts the three
  by-construction thresholds on the board: a **shot clock on a whole frame** (Snowball Throw's ball
  age), a **frog pinned against its own bank edge** (Frozen Beaks' dunked bird on a hole rim), and
  **two shots committed on one step**. Continuous values are compared to six decimals and every
  decision — who caught what, who was hit, how many shots are gone, who won — exactly.
- **`makes a bot want the mirrored thing on a mirrored board`** — 900 boards over three tiers,
  comparing `botLook`'s chosen spot and its valuation.
- **`plays a whole mirrored match to the mirrored result`** — 180 matches over three tiers, each
  played against its own mirror with the two bot streams swapped. **No winner flipped and no
  scoreline differed.** Frozen Beaks records 1 in 900 here and Snowball Throw recorded 24 in 60
  before its fix; this game records 0 in 180, because there is no random stream left for the two
  seats to consume differently.

Everything the geometry rests on is asserted to be its own half-turn image as well: the two banks,
the home points, the fly band, the frog lane and the threat lines.

### There is no opening seat to read **[ours]**

`GameContext.openingSeat` is deliberately not read, and the contract says explicitly that a
real-time game may ignore it. Happy Hippos reads it because its balls belong to seats and slot
parity decides which; **nothing here belongs to a seat.** Both frogs act from step zero, no
dragonfly is anybody's, and the one stream in the game is drawn from once before the first step.
There is no opener for the shell's alternation to alternate, so alternating it would be a line of
code that provably does nothing.

That is a claim rather than an omission, so it is tested: `game.test.ts` plays the same seed with
both openers and asserts the two matches are byte-identical.
`apps/web/src/data/balance-aggregate.test.ts` reports `opener 0 of 50` for this game, which is the
same fact from the other side.

## The bot

Two knobs. Both are things a person has, both were swept alone at the shipped configuration, and
both are monotone across the range where they do anything.

| Tier | `thinkSeconds` | `blindChance` |
|---|---|---|
| easy | 0.34 | 0.36 |
| normal | 0.20 | 0.18 |
| hard | 0.11 | 0.05 |

- **`thinkSeconds`** is how often it looks at the marsh. Everything it does between two looks it
  does on the older picture, so a dragonfly that drifted into reach a third of a second ago is
  invisible to it until it looks again. That is this game's reaction time.
- **`blindChance`** is the chance of failing to see one dragonfly at a look, drawn afresh at every
  look, per slot. It is the skill the game actually asks for — reading which dragonflies your
  tongue would really reach from where you are standing — so it is the skill the ladder is built
  from.

It sees dragonfly positions, whether they are live, and where the far frog is standing. It is not
given a dragonfly's velocity, the far frog's shot timing, or a dragonfly that has not settled yet.
It steers with `headingSign` and walks at `FROG_SPEED`, exactly as a person does, and a test
asserts every heading it emits is one of the nine. `bot-cost` measures its worst step well inside a
frame: a look costs eight booleans and about eighty distance tests.

### Both knobs, swept alone

`hard`'s value varied with everything else as shipped, against an untouched `normal`, 250 seeds in
each seat order; `solo` is 200 seeds of one bot alone in the marsh.

| `hard` thinkSeconds | v normal | solo | shots | catches |
|---|---|---|---|---|
| 0.04 | 75.8% | 17.9 s | 21.1 | 33.0 |
| 0.07 | 75.2% | 17.9 s | 20.7 | 33.0 |
| **0.11 (shipped)** | **69.2%** | **18.0 s** | **20.4** | **32.4** |
| 0.16 | 68.4% | 18.1 s | 19.9 | 31.9 |
| 0.24 | 54.4% | 19.3 s | 18.9 | 30.5 |
| 0.36 | 31.3% | 21.6 s | 16.8 | 26.8 |
| 0.55 | 11.4% | 26.2 s | 12.9 | 20.6 |

| `hard` blindChance | v normal | solo | shots | catches |
|---|---|---|---|---|
| 0 | 73.2% | 18.1 s | 20.9 | 33.0 |
| 0.02 | 74.4% | 17.9 s | 20.6 | 32.6 |
| **0.05 (shipped)** | **69.2%** | **18.0 s** | **20.4** | **32.4** |
| 0.12 | 70.1% | 18.1 s | 20.3 | 32.5 |
| 0.25 | 65.4% | 18.1 s | 19.5 | 31.8 |
| 0.4 | 63.2% | 18.8 s | 18.8 | 31.6 |
| 0.6 | 50.0% | 20.0 s | 16.8 | 29.4 |

The same two knobs on `normal`, against an untouched `easy`:

| `normal` thinkSeconds | v easy | | `normal` blindChance | v easy |
|---|---|---|---|---|
| 0.08 | 93.0% | | 0 | 86.8% |
| 0.14 | 92.0% | | 0.08 | 83.6% |
| **0.20 (shipped)** | **86.4%** | | **0.18 (shipped)** | **86.4%** |
| 0.28 | 74.0% | | 0.3 | 81.2% |
| 0.4 | 50.4% | | 0.45 | 69.2% |
| 0.6 | 21.4% | | 0.65 | 47.2% |

Two things worth being straight about. **`thinkSeconds` saturates below about a tenth of a
second** — 0.04, 0.07 and 0.11 measure the same within the 2.2-point standard error of a 500-match
row — because at that point it is re-reading the marsh faster than the marsh changes. And
**`blindChance` is flat below about 0.12**: `hard`'s 0.05 sits on a plateau, and the tier
separation on this knob comes from `easy` and `normal`, not from `hard`. Both shipped values sit at
the top of their useful range rather than past it, which is where a knob belongs if the tier below
it is to have somewhere to stand.

### Two constants that are not knobs, and the sweeps that say so

**`SHOT_THRESHOLD` — how good a shot a bot holds out for — is a fact about the marsh, not a
difficulty axis.** It is the strongest lever in the file and it is *monotone upward*, which is
precisely why it must not be a knob: a ladder built on it would put the sharp tier at 3 and the
weak one at 0, and 0 is not a player.

| threshold | hard v normal | solo | easy v easy match | wasted a seat | ended on six wasted |
|---|---|---|---|---|---|
| 0 (shoot at anything) | 51.6% | 6.7 s | 8.2 s | 5.57 | **498 / 500** |
| **1 (shipped)** | **69.2%** | **18.0 s** | **20.6 s** | **1.83** | **18 / 500** |
| 2 | 94.8% | 18.6 s | 23.0 s | 0.31 | 0 / 500 |
| 3 | 99.2% | 28.5 s | 33.4 s | 0.06 | 0 / 500 |

At 0 the match is eight seconds long and 99.6% of them end with somebody out of shots — a game, but
not this one. At 2 and above nobody ever runs out and the second loss condition is dead code. One
is the only value at which both endings the catalogue row names are live, and it is also the
principled value: a shot that takes one dragonfly is not a wasted shot, and wasted shots are what
you lose by. It is on a lattice, so 1.5 and 2 select exactly the same shots.

**`AGGRESSION` — what a blow is worth to a bot, in dragonflies — is 0.5, and every value strictly
between 0 and 1 is the identical policy.** Dragonfly counts are integers, so a term below one can
break a tie between candidate spots and can never on its own clear the shot threshold. That is
exactly what it is for: the bot will *stand* where its shot also clips the far frog, and will never
talk itself into spending a shot on a blow. Measured, the three rows 0.25 / 0.5 / 0.75 are
bit-identical, and one is where the policy changes:

| aggression | hard v normal | blows a match | wasted a seat | ended on six wasted |
|---|---|---|---|---|
| 0 | 69.4% | 0.67 | 1.74 | 11 / 500 |
| **0.5 (shipped)** | **69.2%** | **0.84** | **1.83** | **18 / 500** |
| 1 | 64.4% | 1.09 | 2.33 | 34 / 500 |
| 2 | 64.8% | 1.20 | 2.48 | 51 / 500 |

At 1 and above the bot starts firing at the far frog on purpose, and it costs the sharper tier five
points of separation while doubling the wasted shots. Below 1 it costs nothing and still puts a
quarter more blows on the board.

**`STUN_SECONDS` is 2.0 and is not a difficulty axis either.** Swept from 0 to 4 the hard-versus-
normal rate moves between 69.2% and 74.6% with no monotone trend against a 2.2-point error. It was
chosen on design grounds — two seconds plus the 0.8 s walk back to the peak is nearly three seconds
of a twenty-second match, which is two or three dragonflies, a cost a player feels without a blow
being a match-ender.

### A knob that was written, swept, and deleted **[ours]**

The first bot carried a third knob: `caution`, how much a spot inside the far tongue's arc was
worth less than a safe one. It is the obvious "does it dodge" dial and the one that looks like it
should own the whole second half of the catalogue row. Swept alone on the `hard` tier across its
entire useful range, 500 seeds a row:

| `caution` | −2 | −0.6 | 0 | 0.6 | 1.1 | 2 | 4 | 8 |
|---|---|---|---|---|---|---|---|---|
| win v normal | 67.9% | 67.1% | 68.5% | 69.0% | 69.0% | 69.6% | 70.4% | 70.4% |
| blows taken | 1.09 | 0.94 | 0.83 | 0.68 | 0.68 | 0.63 | 0.63 | 0.63 |

**It demonstrably works and the score demonstrably cannot hear it.** Blows taken fall by 42% across
the range, which is the knob doing exactly what it was written to do; the win rate moves 3.3 points
against a 2.2-point standard error, and a bot told to *seek* danger (−2) lands in the middle of the
spread. Deleted.

The cause is worth naming because it will be true of the next bot written for this genre, and it is
the same one Happy Hippos found when it deleted three: **this bot's shooting is decided by what is
in front of it when it looks, not by where it was going.** A blow costs three seconds; a bot takes
0.8 of them a match; refusing the richest water to avoid that costs hunting every second. The
arithmetic never favours the dodge, for a bot. It favours it heavily for two people who are aiming
at each other, and that is the honest asymmetry between what this file can measure and what the
game is.

### Randomness: three streams, and only one of them is ever drawn from

`init` derives three generators from the one seed the shell gives us. The marsh's lays out the
opening and is then never touched again. Each seat's bot has its own, so the order the two are
polled in is not observable at all — asserted directly. **A look draws exactly one value per
dragonfly slot, unconditionally, before anything branches**, so a busy marsh and an empty one leave
a seat in the same place in its own stream; also asserted directly, by comparing generator states
after a look at each.

## What was measured

### How the numbers were taken

`packages/games/sticky-tongues/dist/rules.js` driven headless from Node, both seats bot-driven
through exactly the loop `game.ts` runs: both seats decide, both move, both shoot, then `step`.
Sweeps rewrite one constant in a copy of the built module and import it, so every row differs from
the shipped one in exactly one number.

### Equal tiers, 1500 seeds each

| | p1 | p2 | draws | unfinished | seat one's share | z | a match | shots a seat | blows a match |
|---|---|---|---|---|---|---|---|---|---|
| easy v easy | 756 | 744 | 0 | 0 | **50.4%** | +0.31 | 29.6 s | 18.3 | 2.47 |
| normal v normal | 764 | 736 | 0 | 0 | **50.9%** | +0.72 | 23.3 s | 19.2 | 1.59 |
| hard v hard | 780 | 720 | 0 | 0 | **52.0%** | +1.55 | 20.9 s | 19.9 | 1.15 |

Every share is inside the 45–55% band, no z is past 1.6, not one of the 4500 matches failed to
finish, and not one was decided by the clock.

The same 1500 seeds played **both ways round** — the two bots' streams swapped, which is what a
seat-order swap means in a game with no opener to alternate:

| | seat one's share of decided | p1 | p2 | draws |
|---|---|---|---|---|
| easy v easy | **50.1%** | 1504 | 1496 | 0 |
| normal v normal | **49.8%** | 1495 | 1505 | 0 |
| hard v hard | **51.6%** | 1546 | 1453 | 1 |

A seed pair is one independent draw, not two, so these are 1500-seed figures with a standard error
of 1.3 points: z of +0.10, −0.13 and +1.20. `apps/web/src/data/balance-aggregate.test.ts` reads
**54.0% at `normal` over its own fifty seeds**, which is 0.57 standard errors of that sample and
inside the flat band as well as the enforced one.

The two tongues are out together for **172, 227 and 273 steps a match** at the three tiers — about
three to four and a half seconds of every match in which both frogs are committed at once, which is
where clashes and blows come from.

### Cross tier, 500 seeds a cell, both seat orders

| | as seat one | as seat two | mean | a match |
|---|---|---|---|---|
| hard v normal | 68.5% | 69.2% | **68.9%** | 20.7 s |
| normal v easy | 85.0% | 86.0% | **85.5%** | 23.2 s |
| hard v easy | 93.6% | 91.0% | **92.3%** | 20.7 s |

Monotone, and every pairing agrees with itself within 2.6 points across the two seat orders.

### Solo, 400 seeds — one bot alone in the marsh

| | to thirty-five | reached it | shots | wasted | dragonflies a shot |
|---|---|---|---|---|---|
| easy | 24.2 s | 397/400 | 18.9 | 1.11 | 1.86 |
| normal | 19.7 s | 396/400 | 20.1 | 1.45 | 1.73 |
| hard | 18.0 s | 400/400 | 20.4 | 1.11 | 1.72 |

Time to the target is the honest measure; "dragonflies at the end" saturates at thirty-five for
everybody. The seven runs that did not reach it are the waste limit doing its job with nobody
opposite.

**The dragonflies-a-shot column runs the "wrong" way and is worth reading.** `easy` is not slower
because it misses more — it misses slightly less — it is slower because it **takes fewer shots**:
`blindChance` hides dragonflies from it, so it sees fewer reasons to flick, and the ones it does
take are the ones it was sure about. The ladder here is opportunities recognised, not accuracy.

## Rendering

Everything is drawn through the `Renderer` interface, and **interpolated with the loop's `alpha`**.
That is not decoration: the tongue crosses the marsh at 2267 units a second, which is 38 units a
step, and it is the object a player is watching — uninterpolated it strobes visibly on any display
running above the simulation rate. Dragonflies and frogs interpolate too.

Two things are deliberately not interpolated. A frog knocked home, and a dragonfly reappearing at
the half-turn image of where it was caught, are not motion, so anything moving more than 30 units
in a step is drawn where it is rather than streaked across the marsh. And a shot that started or
ended this step would run its own clock backwards through the whole profile, so those two frames
are drawn as they stand.

The previous step's positions live in typed arrays allocated once at construction and written in
place at the top of `update`, as does this step's intent for the two seats. `render` reads them and
never writes: a test renders 120 frames at five different alphas and asserts the simulation did not
move.

Seat colours come from the engine's `SEAT_PALETTE`. The marsh, banks, air and ink are local
constants, as they are in every other game here — scenery is not seat identity and there is no
token for "the colour of a reed bed".

The only text on the board is what the last shot was worth, `+2` or `−1`, beside the frog that took
it. It is a signed number rather than a word, it is feedback rather than a game element, and it is
turned half a turn for the seat sitting opposite so both players read their own tally the right way
up. A test asserts nothing is drawn as text until somebody has finished a shot.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W A S D` to hop, `Space` to flick | the arrow keys to hop, `Enter` to flick |
| Pointer | hold and drag inside your own half to hop; a quick tap flicks | the same, in your own half |

The seat sitting opposite reads the device upside down, so **its keys mirror** — its "right" is the
board's left. The pointer does not mirror, because the marsh is one board drawn one way up and a
finger is already over the water it means. Both are tested, in both presentations.

## Termination

Structural, then structural again, then timed. Thirty-five dragonflies ends 92 to 97% of matches,
six wasted shots ends the rest, and the 100-second clock has never had to end one.
`rules.test.ts` plays forty `easy`-against-`easy` matches and a match with no input at all **with
no frame cap on the loop** — a match that could not end would hang the suite rather than pass
quietly. `apps/web/src/data/termination.test.ts` passes.

## Not built, and not specified here

- **The joystick.** The catalogue row's controller is a pad position, which is the one quantity a
  key cannot spell. Nine headings replaces it, and the argument is above. Everything else in the
  row is built as written.
- **Dragonflies do not collide with each other or with a frog.** Eight independent drifters. It
  keeps the step O(n), keeps it allocation-free, and removes a family of numerical instability for
  a behaviour a player would read as noise.
- **A blow does not cost a shot.** It was written that way first and it made the loss condition
  partly the opponent's to spend, which is not what "don't miss too many shots" says. A blow costs
  two seconds, your position and the shot the attacker spent on it; that is three costs, and it is
  enough.
- **No audio and no art assets.** Everything is drawn with engine primitives, so
  `assets.license.json` has nothing to declare.
- Cross-device netcode and the tournament wiring are the shell's.
