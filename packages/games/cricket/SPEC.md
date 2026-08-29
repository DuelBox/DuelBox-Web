# Cricket — specification

**Archetype:** `rt-split` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** horizontal · **Round length:** ~150 s

> **Written from the implementation, not before it.** Every number below was read out of
> `src/rules.ts` or measured against the shipped code, and each measurement names the
> sample that produced it. The ladder, the outcome mix and the seat symmetry are all
> re-checked by `src/rules.test.ts` and `src/game.test.ts` on every run, so a tuning change
> fails a test rather than quietly ageing this document.

A two-player cricket duel. One seat bowls, the other bats, and after two overs they swap.
The bigger total wins.

## Where this game came from

This is an original implementation. The laws of cricket — six-ball overs, wides, bowled,
caught, four along the ground and six over the rope — are rules of a sport and are nobody's
property, so they are free to implement. Nothing else here is borrowed: the ground, the
shot model, the field, the artwork, the timing windows and the bot tiers are all ours.

The game was requested as a straight port of an existing Flash-era browser game. It is not
one, and it deliberately is not: that game's code, art, layout and name belong to its
author, and CLAUDE.md rule 1 rules out copying any of them. What was taken is the *genre* —
a batting game decided by timing — which is not protected. Anyone comparing the two will
find a different view, a different control scheme, a different scoring model and a second
player, because this one is a duel rather than a solo score attack.

## Observed rules

Not observed from another app. Derived from the sport:

- An over is six balls. An innings here is two overs, or two wickets, whichever comes first.
- A ball that beats the bat and hits the stumps is **bowled**.
- A ball hit in the air and caught by a fielder is **caught**.
- A ball crossing the boundary is **six** in the air, **four** along the ground.
- A ball arriving too far outside the stumps is a **wide**: one run, and it is re-bowled.
- Leaving the ball is legal and safe. It scores nothing.

## The ground

A plan view. Two people on opposite sides of one device cannot share a side-on view of a
pitch — one of them would read it upside down — so the ground is a **circle centred on the
striker**, which reads identically from either end.

| | value |
| --- | --- |
| logical area | 700 × 1000 |
| ground centre | (350, 500) |
| boundary radius | 340 |
| release point | (350, 200), 300 units up the pitch |
| stumps | half-width 22, top at 0.75 stump heights |
| wide line | 95 either side of the stumps |

The 160 units above and below the boundary hold the scorecard. That is chrome, not field of
view: neither seat can see more of the ground than the other (rule 9).

The whole world is drawn a half turn round when `p1` is bowling, so each seat's own end is
nearest them. One rotation for the shared board, not two half-screens.

## The delivery

Three numbers the bowler chooses, and one the game rolls.

- **line** — where it arrives across the pitch.
- **length** — 0 is a yorker arriving at the base of the stumps, 1 a bouncer arriving well
  above them. Only a ball under 0.364 can bowl anybody; only a ball over it cannot.
- **pace** — 300 to 560 logical units a second, from a held charge. The pitch takes between
  0.54 s and 1.0 s.
- **swing** — rolled per delivery from the seeded stream, up to 46 units, scaled by pace.

Swing acts **quadratically**, so the ball holds its line and moves late. At the halfway
point only a quarter of it has acted. This is what makes the striker watch the ball rather
than read the bowler's hand, and it is drawn on screen — so a bot allowing for it is using
information a person sitting at the same device also has (rule 6).

Height is a closed form of flight progress, never an integration: the ball leaves the hand
at stump height, pitches to the ground at 0.68 of the way down, and rises to its arrival
height. A 60 Hz phone and a 120 Hz laptop therefore deliver the identical ball.

## Meeting the ball

Contact is **two independent tolerances multiplied**:

```
quality = (1 - |timingError| / 0.16) * (1 - |lateralError| / 46)
```

A product, not a sum, because being in the right place at the wrong moment is a miss and so
is the reverse. Either factor at or below zero is no contact at all, and a NaN in either
scores a miss rather than propagating into the shot.

The striker commits 0.12 s before the bat reaches the ball. That lag is the whole game, and
it is expressed in seconds of simulation, never in frames.

## Where the ball goes

Direction is **not a fourth control**. Where the bat met the ball decides where it goes:

```
angle = clamp((batX - 350) / 60, -1, 1) * 1.15 rad
```

This is the cross-device fairness rule doing real design work. A separate aiming stick
would have handed a pointer an angular precision a keyboard could not match. Tying
direction to bat position means a thumb tapping where the bat should be and a keyboard
sliding it there produce the *same shot from the same position*. It is also true to the
sport: play it square and it goes square.

Because the bat reaches only 46 units, the aim actually available is about ±50°, which is
what makes the fielders at ±49° worth playing around.

Height off the bat comes from two sources with **opposite signs on range**, and keeping
them apart is the whole of the shot model:

```
carry   = (height / 1.8) * 0.42 * quality      # middled into the air: adds range
balloon = (1 - quality) * 0.9                  # edged upwards: takes range away
loft    = carry + balloon
range   = (40 + 230 * q + pace * 0.2 * q) * (1 + carry * 0.55) * (1 - balloon * 0.55)
```

Carry is earned and is the only route to a six: the striker who picks the short ball and
middles it gets it. Balloon is the edge — straight up, and nowhere.

An earlier version added the two into one number and multiplied range by the sum, which
made **mistiming the ball pay**: a worse contact produced a higher loft and therefore a
longer shot. Range is now monotone in contact quality at every length and every pace.

A ball lofted past `SKY_THRESHOLD` (0.82) is caught wherever it went up, because a steepler
hangs long enough that *which* fielder takes it is not interesting. Carry alone cannot reach
that height — a perfectly middled bouncer tops out at 0.42 — so no shot worth runs is ever
caught by this rule. It is what makes a top edge a wicket rather than a dot.

## The field

Six fielders and a keeper, at fixed stations, **identical in both innings**. Fixed rather
than rolled because the field is the one thing both strikers must be able to plan against;
a field that moved between innings would make the two halves of the match incomparable, and
the match is nothing but a comparison of two innings.

Catch radius 36, fielding radius 62. A ball past the rope cannot be caught however close a
fielder was standing — the laws do not care where they stood.

## Scoring and the win condition

Runs by distance: 120 units for one, 200 for two, 275 for three, the rope for four or six.
A fielder within 62 units of a ball along the ground cuts off one run.

The bigger total wins; a tie on runs is broken by boundaries; a tie on both is a **tied
match**, which cricket has a word for and the shell knows how to show. Both comparisons go
through the SDK's `resolve` rather than being written out here.

## Termination

An innings cannot run for ever. Wides do not count towards the twelve balls, so a stream of
them cannot end an innings — but they concede a run each, so bowling them is losing. The
run-up is capped at 3.5 s, after which the ball is bowled at whatever charge it had: nobody
may stall the match by never letting go.

## Controls

| | bowling | batting |
| --- | --- | --- |
| keyboard | W A S D sets line and length, hold Space for pace | A D move the bat, Space swings |
| pointer | drag to the spot on the pitch, let go to bowl | tap where you want to meet the ball |

One swing per ball, and only once the ball is on its way — pressing during the run-up is a
flinch, not a shot, and must not silently consume the delivery. A cancelled gesture abandons
the run-up rather than bowling a ball nobody meant to bowl, and a charge held across a pause
is dropped on resume, both per `docs/input-idiom.md`.

## The bot

Six knobs, all of them things a person does badly: mistiming the ball, playing where it
pitched rather than where it swung, hitting it to a fielder, and spraying it wide.

| | easy | normal | hard |
| --- | --- | --- | --- |
| timing sd (s) | 0.115 | 0.06 | 0.032 |
| lateral sd (units) | 30 | 16 | 8 |
| swing read | 0.15 | 0.6 | 0.9 |
| placement | 0.2 | 0.55 | 0.85 |
| line sd (units) | 46 | 26 | 14 |
| length sd | 0.3 | 0.17 | 0.09 |

`swingRead` is capped below 1 even at `hard`: a bot may not read a ball better than the
person watching the same screen.

### Measured, 2000 innings a cell

Mean runs an innings. Rows are the batting tier, columns the bowling tier.

| bat \ bowl | easy | normal | hard |
| --- | --- | --- | --- |
| **easy** | 3.30 | 2.71 | 2.40 |
| **normal** | 11.12 | 10.57 | 10.22 |
| **hard** | 19.14 | 18.09 | 17.63 |

Monotone in both directions: a better bat scores more against every bowling tier, and
better bowling concedes less to every batting tier.

**That ordering is a test, not a note.** `rules.test.ts` measures the whole nine-cell grid
on three seeds at eight hundred innings a cell and asserts both directions, because the two
inversions below were each invisible to a check that compared tiers a pair at a time along
one axis. The sample is measured rather than guessed: at three hundred innings a cell the
closest pair — `hard` batting against `normal` bowling and against `hard` — swaps on about
one seed in fifteen, and at six hundred none of fifteen seeds does.

### What each tier's innings actually looks like, against `normal` bowling

Share of balls bowled, 2000 innings a tier:

| | dot | 1 | 2 | 3 | 4 | 6 | bowled | caught | wide |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 53.4% | 16.5% | 5.3% | 1.7% | 0.6% | 0.0% | 10.5% | 11.8% | 0.2% |
| normal | 32.6% | 36.7% | 16.1% | 5.6% | 1.9% | 0.1% | 0.8% | 6.2% | 0.0% |
| hard | 7.5% | 43.8% | 29.7% | 11.4% | 3.8% | 0.2% | 0.0% | 3.6% | 0.0% |

`easy` is bowled ten times in a hundred balls and caught twelve; `hard` is never bowled at
all and caught between three and four times. The mix is asserted, not merely printed:
`rules.test.ts` requires dot balls and catches to fall monotonically as the batting tier
improves, wides to fall as the bowling tier improves, and every tier to be dismissed
sometimes and not almost always. A ladder can be correctly ordered and still be nonsense —
a `hard` bot that outscored `normal` only by facing more balls would satisfy the grid above
and fail this. That is the tier reading as a standard of player rather than as
the same player with a shakier hand.

Sixes are rare for every tier (0.0–0.2%) and that is correct: a six needs a short ball
*and* a near-perfect contact, which is a combination a bot stumbles into rather than plans.
It is a shot left on the table for a person to find.

### Batting first is worth nothing

Eight hundred seeds a tier, each played **twice — once with each opening seat** — with both
bots on the same tier, which is how `apps/web/src/data/balance-aggregate.test.ts` measures
every game in the catalogue. Sixteen hundred matches a tier:

| tier | bats first wins | bats second wins | tied | seat one's share of decided matches |
| --- | --- | --- | --- | --- |
| easy | 46.6% | 44.3% | 9.1% | 50.0% |
| normal | 47.8% | 47.4% | 4.9% | 50.0% |
| hard | 45.6% | 49.8% | 4.6% | 50.0% |

Batting first is within noise of even at every tier. Seat one's share is **exactly** 50.0%
and not approximately, which is worth stating as what it is: a symmetry rather than a
measurement. Nothing in the simulation reads a seat label — the striker and the bowler are
derived from the innings number and `context.openingSeat`, the bots draw in innings order
rather than in seat order, and the rotation is a rendering decision. So a seed opened from
one chair is the same match as that seed opened from the other, reflected, and seat one
wins exactly one of each pair. The tie rate is the only thing left to vary, and it is a
property of twelve balls and small totals rather than of a chair.

**The opener is genuinely read, not merely accepted.** Changing only `context.openingSeat`
changes the scoreline on 90.9% of `easy` seeds, 95.1% of `normal` and 95.4% of `hard` — the
residue is the seeds whose two halves happen to end level. A game that took the parameter
and ignored it would read 0%, which is what
`apps/web/src/data/balance-aggregate.test.ts`'s `opener` column exists to catch, and it is
issue #2466.

## Five defects found while tuning this

Worth recording, because every one of them was found by *running the balance sweep and
reading the matrix* rather than by reasoning about the constants. Not one of them would
have been caught by a test asserting that the constants were what they were written as:

1. **Every shot was a six.** The range scale topped out around 533 units against a boundary
   at 340, so any decent contact cleared the rope — 70.5% of `hard`'s balls were sixes.
2. **The bowler could not take a wicket.** The bot aimed at length 0.42, which arrives at
   0.84 stump heights — *above* the stumps. `bowled` was 0.0% at every tier and nothing in
   the rules was wrong; the bot was simply bowling a ball that cannot hit the wicket.
3. **`hard` was worse than `normal`.** The placement nudge cost more contact quality than
   the gap it bought, and it cost the best tier most, inverting the ladder. `GAP_NUDGE` at
   30 units was spending 0.55 of a 46-unit lateral tolerance to buy 11° of angle.

4. **Mistiming the ball paid.** Range was multiplied by total loft, and loft included the
   mishit term — so a *worse* contact produced a longer shot. It showed up as `hard`
   scoring less than `normal`, because `hard` middled too much to balloon anything to the
   boundary. Fixed by splitting carry from balloon and giving them opposite signs.

   The fix moved the mishit to where its own comment already said it went — "almost
   straight up and nowhere" — and that opened a hole underneath it: a top edge now lands at
   the striker's feet, nowhere near a fielding station, so it was a **dot ball**. A mishit
   that costs nothing is not a mishit. `SKY_THRESHOLD` closes it.

5. **Wayward bowling was harder to bat against than accurate bowling.** The row direction,
   not the column: `easy` bowling conceded *fewer* runs than `hard` to the same bat. The
   cause was in `botBatX`, which read the ball by interpolating its whole *position*
   between mid-flight and arrival — and that folds half of the bowler's line deviation into
   the read as though it were unread late movement. A wide line therefore made the bot bat
   worse, which is backwards: the line is visible from the moment the ball leaves the hand,
   and only the swing moves late. The bot now reads `line + swing × swingRead`, which is
   what its own `swingRead` doc always claimed it did.

   This one is the reason the ladder is asserted as a **grid**. Defects 3 and 4 are column
   inversions and this is a row inversion; a test that walks one axis sees one kind and not
   the other, and the file had two such tests and neither could see this.

## Presentations

Shared-screen puts the two seats at opposite ends of one ground and rotates the world so
each reads their own end. Single-seat gives the local seat the same ground upright. Rules,
scoring and simulation are byte-identical: only the rotation changes.

## Rule 7: never colour alone

- The **bat** is the striker's colour *and* widens when it is swung.
- The **fielders** are nobody's colour — they belong to the match — and are drawn as rings
  so they stay legible against the grass in greyscale.
- The **bowler's mark** on the pitch is a ring with a bar through it, not a coloured dot.
- Every outcome is also **named in words**: `FOUR`, `BOWLED`, `wide`, `dot ball`.

## What is not specified here

No LBW, no run-outs, no stumpings, no second batter, no fielding side placement. Two
dismissals are enough to make the duel work, and every extra one is a rule two people have
to be taught before they can play a two-minute game.
