# Happy Hippos — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 40 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and every
> number below was measured by driving `dist/rules.js` headless — sweeping one constant at a time
> against a rebuilt copy of it — rather than estimated.

One pond, seen from above, with a hippo sitting on each bank. Twelve balls drift about in it —
six round ones and six square ones, one kind for each seat. Walk your hippo along your bank and
tap: it lunges out, gapes at full stretch, and drags back whatever its mouth touched. Your own
kind is worth two. The other seat's costs you one. First to fifty.

## Observed rules

From the catalogue row: _"Tap to eat balls and score. +2 points for your color, and -1 if you
eat your opponent's color. First to 50 points wins!"_

Everything in that sentence is built as written: the tap, the two point values, and fifty. The
pond, the two banks, the lunge, the fixed stock of twelve, the match clock and the standoff rule
are all ours, and each is marked below.

## Rule 7 is the game here, not a finish on it

The whole scoring rule is "two for your kind, minus one for theirs", so **a player who cannot
separate the two kinds cannot play at all** — not "finds it harder", cannot play. Colour was
never going to be enough, and it was designed around before a line was written rather than
patched afterwards.

**Seat one's ball is round. Seat two's is square.** Both are caught by the identical circular
test at 50 units, and the square's half-side is `radius × sqrt(pi) / 2 = 17.7`, so the two kinds
cover **the same area**: neither is a bigger target and neither is easier to pick out of a
crowd. Each carries a hollow mark of its own silhouette in the middle — a ring inside the disc,
a box inside the square — so the shape is stated twice, once by the outline and once by the
interior.

The same pair runs through everything a seat owns, so "which of these is mine" always has the
same answer:

| | Seat one | Seat two |
|---|---|---|
| Ball | disc, with a ring inside | square, with a box inside |
| Hippo body | round, round ears, round eyes | square, square ears, square eyes |
| Mouth | round, gaping to a round gullet | square, gaping to a square gullet |
| Steering marker | a ring on its own bank | a box on its own bank |

**How a greyscale player reads the board.** Round things are seat one's and square things are
seat two's, everywhere, with no exceptions and nothing else to learn. A ball that is not yet in
play is drawn as an **outline with no fill**, so "cannot be eaten yet" is a fill and not a hue.
A standoff — both mouths on one ball, neither able to take it — is a **double ring** round the
ball. The clock is a **bar length** on each side margin. The only text on the board is the net
of the chomp you just took, `+4` or `-1`, which is a signed number rather than a word and is
feedback rather than a game element: nothing in the pond has to be read to play. Tests assert
that seat one's balls are drawn as discs of exactly the ball radius, that seat two's are not,
and that with every colour argument stripped out of the render trace the frame still contains
both families of shape.

## The pond

| | Value | Why |
|---|---|---|
| Board | 600 × 1000 | Portrait: a bank at each end and the water between them |
| Water | x 30–570, y 170–830 | 540 × 660 |
| Ball | radius 20, centre within x 50–550, y 190–810 | |
| Stock | **12, six of each kind, fixed for the whole match** | See immediately below |
| Ball speed | 120–210 units/s, constant per ball | |
| Hippo | half-width 46, walks x 76–524 at 340 units/s | |
| Mouth | radius 30; catches at 50 = mouth + ball | |
| Reach | 370 from its own bank | Tips at y = 460 and y = 540 |
| Chomp | out 0.17 s, **held 0.13 s**, back 0.22 s, recover 0.18 s | 0.70 s a cycle, mouth open for 0.52 of it |
| Replacement | 0.9 s parked on a side wall, outline only | |
| Match | first to 50; a 90 s clock behind it **[ours]** | |

### The stock is fixed at six of each, and that is load-bearing **[ours]**

A ball's colour is decided by its slot — even slots belong to the opening seat — and never changes
after the pond is laid out. An eaten ball is replaced by another of its own kind.

The obvious alternative, drawing each replacement's colour at random, has a rubber band hidden
in it: the better player removes their own kind faster, the pond fills with the other seat's,
and the game quietly hands the leader a harder board. It would compress the skill ladder for a
reason nobody could see on the screen. A fixed stock has none of that, and it is also simply
easier to read — there are always six of yours in there somewhere.

### The middle strip, and why the reach is 370 rather than 400 **[ours]**

The two fully stretched mouths sit at y = 460 and y = 540. That is **eighty apart against a
catch radius of fifty each**, so a ball on the middle line at y = 500 is forty from both — inside
*both* mouths at once. The strip of water down the centre of the pond is therefore the one place
two hippos can be holding the same ball, and it is drawn as its own shade with a line at each
edge so a player can see where it is.

At a reach of 400 the tips would be a hundred and forty apart and that strip would not exist:
the pond would be two private halves with a dead gap between them and the standoff rule would be
unreachable code. The **hold at full stretch** is the other half of it — without it each mouth
passes its furthest point in a single frame, and two mouths are only ever both out there by
coincidence.

### A hippo cannot walk while its mouth is out **[ours]**

This reads as flavour and is not. It makes the path the mouth sweeps a **vertical segment**,
which is a shape that can be tested exactly — and the bot's model of a whole chomp is then the
exact union of the per-step segments the simulation applies. See "The bot cannot be wrong about
its own reach" below.

## Fairness across instruments and devices

**Not same-class-only.** A phone, a laptop and a keyboard can all play this against each other.

- **The chomp is a press.** One binary event with a timestamp, identical on a thumb, a trackpad
  and a keyboard. Nothing is ever aimed by a drag.
- **The walk is rate-limited on both instruments.** `driveHippo` is a *rate*, never a set: a
  thumb that jumps to the far bank moves the hippo at exactly `HIPPO_SPEED`, which is exactly
  what a held key does. A test drives one hippo with a finger slammed against the wall and
  another with a key held down and asserts they arrive together, to nine decimal places.
- **The pointer is absolute and unmirrored, for both seats.** The pond is one shared board drawn
  in one orientation, so a finger is already over the water it is pointing at whichever side of
  the device its owner sits on. Only the *keys* mirror for the seat reading upside down, and
  that is control mapping, which the two presentations are allowed to differ in. A test drives
  the same pointer script through both presentations and asserts the two matches are identical
  step for step.
- **Rule 9.** Both players see the whole pond. There is nothing to see more of.

### The one place they are not equivalent, measured

The engine reports a finger going down as the action, so **a pointer player cannot begin a new
gesture without also chomping**. A keyboard player can walk without snapping.

It is not a capability difference — the technique that avoids it is to keep the finger down and
slide, lifting only to snap — but a player who taps-to-go instead pays for it. Measured, one
policy played two ways over 300 seeds:

| | to fifty | chomps | points a chomp |
|---|---|---|---|
| snaps only on purpose | **26.1 s** | 23.7 | 2.13 |
| snaps whenever it starts a new walk | **33.0 s** | 40.3 | 1.25 |

A quarter of the rate, and it cannot be removed without a gesture recogniser that would make the
pointer a different instrument from the key rather than the same one. The manifest's pointer line
therefore teaches the drag — _"keep your finger down and slide to walk your hippo"_ — instead of
describing the tap and leaving the trap to be discovered. `control-parity` passes.

## Two mouths on one ball

Both seats act at once, so two hippos can be on the same ball. It is settled from **when each
chomp was committed**, through the SDK's `resolveSimultaneous`, on source times rather than on
which seat this file happened to look at first — which across two devices would mean whoever had
the better connection.

A step is 16.7 ms and the SDK's tolerance is 8, so "committed on the same step" and "a genuine
draw" are the same statement. A draw means **neither hippo gets it**: they butt heads and the
ball goes free. That needs no extra state at all — both mouths keep covering it while the two
chomps last, and the same verdict comes back every step, so the standoff holds itself up.

`resolveSimultaneous` is **imported, not copied**. Three games in this catalogue inlined their
own four-line version of it; the fourth would have been the one where the tolerance and the
step size stopped agreeing without anybody noticing.

The whole-match numbers are worth being honest about:

| | both mouths open | contested steps a match | matches with a standoff |
|---|---|---|---|
| easy v easy | 16.5% of steps | 0.19 | 19 / 400 |
| normal v normal | 21.1% | 0.18 | 24 / 400 |
| hard v hard | 25.1% | 0.08 | 11 / 400 |

**About one match in twenty**, measured bot against bot — and that is the pessimistic
measurement, because the two bots hunt different colours and therefore different water. Two
people both diving for the same ball in the middle strip will meet a great deal more often than
this. Every contested step measured was a standoff, and there is a structural reason: if the two
chomps had started on different steps, the earlier mouth would already have taken the ball on an
earlier step, so by the time both cover a *live* ball they must have started together.

## The win condition, and the clock behind it

`{ kind: 'first-to', target: 50 }`, resolved by the SDK's `resolve` on every step. Both seats can
cross fifty on the same step — measured at **8 in 4500 matches, seven of them level** — and
`resolve` calls a level crossing a draw rather than handing it to whichever seat the code checked
first. Judging it ourselves would have got seven matches wrong and nobody would have seen it.

The winner is judged on every step, so `resolve`'s options object is **hoisted to module scope
and mutated** rather than written as a literal: a fresh object sixty times a second is exactly
what rule 5 forbids, and the SDK hoists its own empty-eliminations array for the same reason.

**A penalty never takes a score below zero.** A negative score is not a score, and a player who
is behind has to be able to read the gap they still have to close. A single *chomp*'s net still
goes negative, and that is the number shown beside the hippo.

### Termination is a clock, and it lives in the rules **[ours]**

`manifest.roundSeconds` ends nothing anywhere in this repository — it is text on a catalogue
card. `MATCH_SECONDS = 90` is in `rules.ts`, where a person and a bot are the same thing. When it
expires the higher score wins and a level one is a draw, which is what `resolve` already does
with `timeExpired` for a `first-to` condition.

It is a genuine backstop and not the game: **in 4500 bot matches it decided none of them.** What
it exists for is two seats who both keep eating the wrong colour and would otherwise sit at
nought for ever, and for two people who put the phone down. A test plays two seats who never
touch the screen and asserts the match ends, as a draw, at 90 seconds.

## What a chomp is worth, and where the difficulty lives

A chomp sweeps a corridor 100 units wide (twice the catch radius) over 400 units of the 620-unit
ball band — 12.9% of the water. With twelve balls that is **1.55 balls a chomp**, half of them
yours, so a blind chomp is worth `1.55 × (0.5 × 2 + 0.5 × −1) = 0.78` points.

Measured: a player who never moves and snaps on rhythm scores **0.76 a chomp**, 47.3 points in
sixty seconds. The arithmetic and the simulation agree, which is the check that the geometry is
doing what it was designed to.

So **mashing is viable and losing**. The three bot tiers get 1.75, 1.97 and 2.15 points a chomp —
two to three times the blind rate — and the whole of that gap is choosing where to stand and when
to snap. That is the shape a party game wants: a child who taps at random is playing, and an
adult who looks at the water beats them without playing a different game.

## The bot

Two knobs. Both are things a person has, both were swept alone, and both are strictly monotone.

| Tier | thinkSeconds | misreadChance |
|---|---|---|
| easy | 0.25 | 0.24 |
| normal | 0.17 | 0.13 |
| hard | 0.11 | 0.05 |

- **`thinkSeconds`** is how often it looks at the pond. Everything it does between two looks it
  does on the older picture, so a ball that drifted into reach half a second ago is invisible to
  it until it looks again. That is this game's reaction time.
- **`misreadChance`** is the chance of reading one ball's colour the wrong way round, drawn
  afresh at every look, per ball slot. It is the skill the game actually asks for, so it is the
  skill the ladder is built from — a seat that cannot tell the two kinds apart eats the wrong
  ones, which is exactly what happens to a person going too fast.

It sees ball positions, ball colours and whether a ball is in play — everything a person sees and
nothing else. It is not given ball velocities, the other hippo's chomp timing, or a ball that has
not rolled in yet. `bot-cost` measures its worst step well inside a frame; a look costs twelve
booleans and about a hundred and sixty distance tests.

### The bot cannot be wrong about its own reach

It evaluates a whole chomp as the vertical segment from its bank to its full stretch, with
`reaches` — **the identical predicate the simulation applies one step at a time**. Because a
hippo may not walk while its mouth is out, that segment is exactly the union of the per-step
segments, so for a pond that is holding still the prediction and the outcome are the same number
rather than nearly the same number. Issue #2465 is about precisely this, and there is a test:
sixty random ponds, both seats, comparing `chompValue` against what a real chomp actually took.

What it does *not* model is the ball drifting during the half-second the chomp lasts, and the
other hippo getting there first. A person cannot do either of those exactly either, and both
errors fall on the two seats alike.

### Both knobs, swept alone

Everything else as shipped. Win rate is `hard` against an untouched `normal` over 250 seeds in
each seat order; solo is 200 seeds of one bot alone in the pond.

| `hard` thinkSeconds | v normal | solo | points a chomp |
|---|---|---|---|
| 0.04 | 76.0% | 26.5 s | 1.94 |
| 0.07 | 74.9% | 25.6 s | 2.08 |
| **0.11 (shipped)** | **74.0%** | **25.5 s** | **2.18** |
| 0.16 | 70.9% | 27.1 s | 2.20 |
| 0.24 | 52.2% | 29.5 s | 2.18 |
| 0.36 | 23.8% | 34.7 s | 2.10 |
| 0.55 | 3.2% | 47.0 s | 2.24 |

| `hard` misreadChance | v normal | solo | points a chomp |
|---|---|---|---|
| 0 | 84.2% | 24.7 s | 2.30 |
| 0.02 | 84.0% | 25.3 s | 2.25 |
| **0.05 (shipped)** | **74.0%** | **25.5 s** | **2.18** |
| 0.1 | 61.8% | 27.4 s | 2.02 |
| 0.2 | 42.2% | 31.6 s | 1.71 |
| 0.35 | 11.6% | 40.3 s | 1.32 |
| 0.5 | 2.2% | 48.0 s | 1.02 |

`thinkSeconds` **saturates below about a tenth of a second** — 0.04, 0.07 and 0.11 measure the
same within noise — because at that point it is already re-reading the pond faster than the pond
changes. The shipped value sits at the top of the useful range rather than past it, which is
where a knob should sit if the tier below it is to have somewhere to stand.

### Three knobs that were written and are not knobs

This is the part worth reading, and all three failures have the same cause.

**`minValue` — patience — is not a difficulty axis. It is a constant.** How good a chomp a bot
holds out for was the first difficulty knob, and swept alone it is **strongly non-monotone**:

| threshold | solo easy | solo normal | solo hard | hard v normal |
|---|---|---|---|---|
| 0 (snap at anything) | 40.5 s | 38.2 s | 35.6 s | 59.5% |
| 1 | 37.3 s | 29.7 s | 26.3 s | 72.5% |
| **2 (shipped)** | **38.2 s** | **30.2 s** | **25.5 s** | **73.5%** |
| 3 | 47.6 s | 36.5 s | 30.2 s | 74.7% |
| 4 | 53.0 s | 38.0 s | 31.2 s | 75.5% |
| 5 | 69.2 s | 57.3 s | 47.1 s | 79.3% |

A bot that snaps at anything and a bot that holds out for a mouthful are both far worse than one
in the middle, and the optimum is in the same place for all three tiers. The first version had
`easy` at 0, `normal` at 1.5 and `hard` at 3 — which put **`normal` on the optimum and `hard`
handicapped past it**, so a knob that read in the source as the difficulty axis was in fact
making the sharpest tier worse. `CHOMP_THRESHOLD = 2` for everybody: "at least one clean ball of
my own", since one of mine against one of theirs nets only 1 and is not worth a cycle. A
fractional threshold is indistinguishable from the integer above it, because a chomp is worth a
whole number of points.

**`aimError` was completely dead.** Triangular error on where the bot decides to stand, swept
from 0 to 220 units — the whole width of the bank — and every value measured the same, 32 to 34
seconds solo. Deleted.

**`TRAVEL_COST` and `SWITCH_MARGIN` bought nothing either.** Star Catcher needed both — a value
net of the time to walk there, and a margin before abandoning a target — and both were written
here for the same reasons. Swept as shared constants, 0 was as good as or better than any
non-zero value, and large values only hurt. Both deleted.

All four have one cause, and it is worth stating because it will be true of the next bot written
for this genre: **this bot's chomping is decided by where it is standing, not by where it was
going.** It snaps whenever the water in front of it clears the threshold, so refinements to
target *selection* — the aim, the travel cost, the stickiness — barely reach the score. What is
left, and what measures, is how fresh its picture of the pond is and whether it can read the
colours in it.

Walking itself does matter, and by more the better the bot is — which is the other half of the
same fact. Taking the hippo's speed to nothing and letting each tier snap where it stands, 200
seeds:

| | walking | pinned to one spot |
|---|---|---|
| easy | 38.2 s | 43.3 s |
| normal | 30.2 s | 38.8 s |
| hard | 25.5 s | 36.4 s |

### Randomness: three streams

`init` derives three generators from the one seed the shell gives us.

**The pond has its own.** `hard` looks three times as often as `easy`, so on a shared stream the
number of *decisions* a tier makes would change what rolled into the water — a different pairing
would be dealt a different pond, and every balance number here would be a fiction about a pond
nobody else plays.

**Each seat's bot has its own.** With one stream, whichever seat is polled first takes the earlier
value every time. Star Catcher measured that at 1.4 points of win rate; here it is not measurable
at all, because with a stream each the poll order is not observable: **a reversed poll order gives
a bit-identical match**, asserted over 25 seeds at each tier and 200 in the harness.

**A look draws exactly one value per ball slot**, unconditionally, before anything branches — so a
busy pond and an empty one leave a seat in the same place in its own stream. Asserted directly by
comparing generator states after a look at each.

The pond's stream does react to what gets eaten, and that is unavoidable: a replacement is drawn
when a ball goes. What it does not react to is how hard anybody was *thinking*.

### The opening pond is exactly symmetric

Slot `2k + 1` is placed at the half-turn image of slot `2k` with its heading reversed, and the two
slots are opposite colours — so rotating the pond and swapping the colours gives back exactly the
pond you started with. Neither seat can be dealt the better opening, for any seed and either
opener. Asserted for a hundred seeds and both openers, to ten decimal places.

### `context.openingSeat`, and exactly what it buys **[ours]**

Both hippos act from step zero, so this game has no opener in the sense a turn game does, and
`GameContext` says a real-time game may ignore the field. It is read anyway, for one honest
reason: **replacements are drawn from the pond's stream in slot order**, so when several balls go
in the same step the seat holding the even slots draws first. `openingSeat` decides which seat
that is.

The effect is immeasurably small — 48.4 to 50.2% to seat one with the opener pinned, across three
tiers and 4500 matches — but it is the one structural asymmetry the game has, and the SDK
alternates `openingSeat` across the rounds of a best-of precisely so that things like it wash out.
It costs one line, and moving the parity also hands a seed's opening pond to the two seats turn
about: the two ponds a seed can deal are each other's half-turn image with the colours swapped, so
neither opener is the better one.

**Measured, and worth being plain about: the alternation is inert.** Playing each of 1500 seeds
with both openers moves seat one's share to 48.4 / 48.6 / 48.6% — not distinguishable from the
pinned-opener numbers at this sample. What it does do is make the swing real rather than
theoretical: **about 44% of seed pairs end differently under the two openers**, which is the
property that would let the alternation pay if anything asymmetric were ever added to the pond.

## What was measured

### Equal tiers, 1500 seeds each, opener pinned to seat one

| | p1 | p2 | draws | unfinished | seat one's share of decided | z | a match |
|---|---|---|---|---|---|---|---|
| easy v easy | 753 | 747 | 0 | 0 | **50.2%** | +0.15 | 31.7 s |
| normal v normal | 742 | 754 | 4 | 0 | **49.6%** | −0.31 | 25.2 s |
| hard v hard | 725 | 772 | 3 | 0 | **48.4%** | −1.21 | 22.3 s |

Every share is inside 47–53% and no z is past 1.3. Not one of the 4500 matches failed to finish,
and not one was decided by the clock.

The same 1500 seeds played with **both** openers, which is what the shell actually does across the
rounds of a best-of:

| | seat one's share of decided | seed pairs the opener swung |
|---|---|---|
| easy v easy | **48.4%** | 681 / 1500 |
| normal v normal | **48.6%** | 674 / 1500 |
| hard v hard | **48.6%** | 628 / 1500 |

A seed pair is one independent draw, not two, so these are 1500-seed figures with a standard error
of about 1.3 points — inside the band and about a sigma from level.

### Cross tier, 500 seeds a cell, both seat orders

| | as seat one | as seat two | mean | a match |
|---|---|---|---|---|
| hard v normal | 73.2% | 74.8% | **74.0%** | 23.4 s |
| normal v easy | 85.2% | 83.8% | **84.5%** | 27.1 s |
| hard v easy | 96.2% | 95.6% | **95.9%** | 23.8 s |

Monotone, and every pairing agrees with itself within 1.6 points across the two seat orders.

### Solo, 400 seeds — one bot alone in the pond

| | to fifty | reached | chomps | points a chomp |
|---|---|---|---|---|
| easy | 37.7 s | 398/400 | 28.7 | 1.75 |
| normal | 30.1 s | 400/400 | 25.6 | 1.97 |
| hard | 25.7 s | 400/400 | 23.4 | 2.15 |

Time to the target is the honest measure: "points at the end" saturates at fifty for everybody.
The two `easy` runs that did not reach it are the clock doing its job.

## Rendering

Everything is drawn through the `Renderer` interface, and **interpolated with the loop's `alpha`**.
That is not decoration here: the mouth crosses the pond at 2176 units a second, which is 36 units
a step, and it is the object a player is watching — uninterpolated it strobes visibly on any
display running above the simulation rate. Balls and hippos interpolate too.

Two things are deliberately *not* interpolated. A ball that has been eaten reappears on a side
wall, which is not motion, so anything moving more than 20 units in a step — six times the fastest
a ball can drift — is drawn where it is rather than streaked across the pond. And a chomp that
started or ended this step would run its own clock backwards through the whole profile, so those
two frames are drawn as they stand.

The previous step's positions live in typed arrays allocated once at construction and written in
place at the top of `update`, so nothing here allocates per frame. `render` reads them and never
writes: a test renders a hundred and twenty frames at three different alphas and asserts the
simulation did not move.

Seat colours come from the engine's `SEAT_PALETTE`, which is the one definition of what a seat
looks like. The pond, banks and ink are local constants, as they are in every other game here —
scenery is not seat identity and there is no token for "the colour of water".

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `A` / `D` to walk, `Space` to snap | `←` / `→` to walk, `Enter` to snap |
| Pointer | tap your own half to snap; hold and slide to walk | the same, in your own half |

The seat sitting opposite reads the device upside down, so **its keys mirror** — its "right" is
the board's left. The pointer does not mirror, because the pond is one board drawn one way up and
a finger is already over the water it means.

## Termination

Structural, then timed. First to fifty ends nearly every match; the 90-second clock is behind it
and ends the rest. `rules.test.ts` plays forty `easy`-against-`easy` matches **with no frame cap
on the loop at all** — a match that could not end would hang the suite rather than pass quietly —
and asserts every one finishes inside `MATCH_SECONDS`. `apps/web/src/data/termination.test.ts`
passes.

## Not built, and not specified here

- **Nothing from the catalogue row was left out.** The tap, `+2`, `−1` and fifty are all as
  written.
- **Balls do not collide with each other.** Twelve independent drifters, no pairwise pass. It
  keeps the step O(n), keeps it allocation-free, and removes a whole family of numerical
  instability for a behaviour a player would read as noise anyway.
- **No audio and no art assets.** Everything is drawn with engine primitives, so
  `assets.license.json` has nothing to declare.
- Cross-device netcode and the tournament wiring are the shell's.
