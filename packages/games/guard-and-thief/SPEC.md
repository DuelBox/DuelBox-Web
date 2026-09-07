# Guard and Thief — specification

**Archetype:** `rt-split` · **Category:** Stealth · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised and enforced

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was measured against the shipped `rules.ts` — the harness is described
> under "How the numbers were taken".

Two vaults, one at each end of the device, and one runner each. The coins you can spend are
in the **other** player's vault, so the only way to score is to leave your own floor — and
the moment you do, you are the thief and they are the guard. Come home and the roles invert:
you bank what you carried, you get your speed back, and it is their turn to be caught. Most
coins banked when the minute runs out.

## Observed rules

From the catalogue row: _"The thief has to collect the coins, the guard must catch the
thief. Whoever has more coins at the end of the match wins!"_

All three clauses are built literally: a thief collects coins, a guard catches the thief,
and the winner is whoever has more coins at the end of the match — which is
`highest-when-time-expires`, the SDK's spelling of exactly that sentence.

What is **not** built is the row's implied gesture, and there is no gesture in the row to
build: "collect" and "catch" are both positions, and a position is the quantity
`docs/input-parity.md` says a thumb can name and a key cannot. The control idiom is
therefore ours; see "Fairness across input families".

Two smaller departures, both marked below: **loot is carried rather than banked on pickup**,
and a caught thief loses its loot to the guard rather than being eliminated.

## The problem this game exists to solve: two roles that are not symmetric **[ours]**

A thief collects and a guard chases. Those are not the same job, they do not pay the same
way, and a game where seat one is the thief cannot be fair — `balance-aggregate.test.ts`
would say so and it would be right. There were three ways out, and the brief for this game
named all three: **swap the roles partway** and compare the two halves; **make both players
both roles at once**; or **make the payoffs genuinely symmetric and prove it**.

This game takes the second, and it takes it in the strongest available form: **the role is
not a property of a seat at all. It is a property of where you are standing.**

```
runner is a GUARD  while  seatAxisSign(seat) * (y - CENTRE_Y) > 0     (its own half)
runner is a THIEF  otherwise                                          (the other half)
```

That one predicate — `ownDepth` / `atHome` in `rules.ts` — carries **four** rules:

| | Guard (own floor) | Thief (their floor) |
|---|---|---|
| Speed | 255 units a second | 210 units a second |
| Coins | may not lift them | lifts them on contact |
| The catch | takes the other's loot | loses its loot and its position |
| Banking | already home; nothing to bank | banks on the way back through its own door |

Nothing about that is written per seat. `seatAxisSign` is the only thing that differs, and
the half-turn negates it exactly, so **the map "turn the board over and exchange the seats"
is a symmetry of the whole file**. Not approximately: `ownDepth(p1, y)` and
`ownDepth(p2, 1000 − y)` are the same number, including at `y = 500` where both read zero,
which is the one threshold in this game a state variable can land on by construction. A test
scrambles runners onto a lattice that *includes the door* for that reason.

### Why swapping roles partway was rejected

It is the obvious answer and it does not survive contact with the brief's own warning: "then
the two halves must be compared fairly." You can give both players the same course and the
same clock, but you cannot give them the same *opponent*, because the opponent is the other
player. Half A is measured against one person's guarding and half B against another's, and
the two halves are only comparable if guarding and thieving are equally hard — which is the
thing you were trying to establish. Worse, only half of each match is spent doing the thing
the catalogue row is about.

Making the role a function of position removes the comparison problem instead of solving it.
There are no halves. Both players are guarding and thieving continuously, against each
other, on the same clock.

### Why the catch needs no tie-break, which is where this design pays for itself

The lesson the last eight games keep re-learning is that a tie-break written in board
coordinates settles nothing on a symmetric position (Snowball Throw's `dodgeSide`, Maze
Paint, Sudoku). This game has no such tie-break, because the catch cannot tie:

> When two runners touch they are, by definition, in the same half. Exactly one of them owns
> that half. That one is the guard.

The two exceptions are the same statement written once — `aHome === bHome` — and both mean
nothing happens: runners meeting *across* the door are either both at home (neither is
trespassing) or both away (there is no guard present). A pair standing exactly on the door
is the both-away case, and both seats agree about it.

### The one thing that was not already symmetric, and what was done with it

The board is symmetric, the rules are symmetric, and both runners start at half-turn image
points. The single remaining asymmetry is **which of the two bot generators a seat is
handed**, and generators cannot be shared: `hard` decides 1.4 times as often as `easy`, so a
shared stream would make one seat's play a function of which tier sat opposite.

So `game.ts` binds it to `context.openingSeat`. A real-time game may ignore that field and
this one has no opener to name — but the SDK alternates it across the rounds of a best-of
*precisely so that a residual seat asymmetry washes out*, and this is the residual seat
asymmetry. Binding it makes the two matches the repository's balance harness plays from one
seed **one match and its exact mirror**, so seat one's share of that sweep is 50.0% by
construction rather than by sampling. The `OPENER_BLIND` ratchet in
`balance-aggregate.test.ts` never applied here either way — it counts `turn-*` games only,
and this one is `rt-split` — so binding the field is worth doing on its own merits rather
than to satisfy a guard. It is also why the `openerSwung` column below is high: the two
matches from a seed really are different matches, which is what that column reports and, as
of the fix that set the ratchet to 0, all that it reports.

Measured on the repository's own harness, replicated exactly (50 seed pairs, frozen idle
input, both opening seats):

| tier | seat one | decided | draws | unfinished | match | `openerSwung` | `distinct` |
|---|---|---|---|---|---|---|---|
| easy | **50.0%** | 100 | 0 | 0 | 60.0 s | 50 of 50 | 90 |
| normal | **50.0%** | 100 | 0 | 0 | 60.0 s | 50 of 50 | 90 |
| hard | **50.0%** | 98 | 2 | 0 | 60.0 s | 49 of 50 | 95 |

Not 49.7%. Fifty point zero, and at 600 seed pairs it is still 50.0% of 1188 decided
matches. `rules.test.ts` asserts it **board by board** rather than in aggregate, because an
aggregate 50% can hide two errors that cancel.

## Fairness across input families **[ours]**

**Verdict: cross-device fair.** `sameInputClassOnly` is false, and the manifest says why in
a comment.

### One quantity, and it is discrete

The interaction carries **exactly one** quantity, and it has nine values:

| | Values | How a key names it | How a finger names it |
|---|---|---|---|
| **Heading** | one of nine | which of W A S D are down | the sign of the drag on each axis, with a deadzone |

Eight compass points and a standstill. `InputManager` hands a game `move`, already
`(right − left, down − up)` capped to unit length, so the keyboard's whole vocabulary is
those nine values; `game.ts` takes the sign of the drag on each axis and lands on the
identical nine, normalised through the same `Math.SQRT1_2`. A test asserts every heading the
bot emits is drawn from that set, and `game.test.ts` runs the same intent through a real
`InputManager` on both instruments and asserts **the runner that comes out is the same
object**, to the last bit, after 10, 40 and 90 steps.

### The binding is an anchored drag, which is the archetype's exception, and why

`docs/input-idiom.md` makes an **absolute** binding the default for `rt-split`, on the
stated grounds that a horizontal split gives each seat a full-width band so "every point that
seat may want to name is under its own thumb". That premise is false here, and it is false
*on purpose*: a runner's entire job is to cross into the other seat's band, and a gesture may
only *start* in its own (`PointerOwnership`, and a test in this package covers it). An
absolute binding would therefore have the reachability hole the same document describes for
`rt-arena` — a raiding player could never steer their runner further away from themselves.

So this game takes the exception the document permits, and pays the price it names: an
anchored drag is a *displacement*, which is continuous. **It is reduced to a sign before the
simulation sees it.** That is the same move Frozen Beaks makes on an absolute pointer,
applied to a displacement instead, and it leaves nothing continuous in the input path at all.

### The anchor is leashed, and a trackpad is better off here than in most of the catalogue

A fixed anchor is a stick you have to walk back to. The anchor here is clamped to
`DRAG_LEASH = 24` units behind the finger, so a reversal costs `leash + deadzone = 36` units
of glass however far the drag has already travelled — against the ~200 units
(`min(w, h) / 3`) beyond which `docs/input-idiom.md` says a trackpad must re-clutch. A test
drags 360 units and asserts the runner turns round 36 units later.

And the re-clutch itself costs almost nothing, because **there is no committing gesture in
this game**. `docs/input-idiom.md` lists `pointerCancelled` as missing primitive 1, and every
drag-and-release game in the catalogue pays for it by firing a shot nobody meant. The worst a
cancel can do here is stop you for a step, and the anchor is dropped on pause and resume so
the next press re-anchors under the finger. A test covers both directions.

### The deadzone, and the one frame an anchor costs

`DRAG_DEADZONE = 4 × envelopeFor({600, 1000}) = 12` units, per `docs/input-idiom.md` rule 2
rather than a twenty-third hand-picked constant; the leash is twice that. Inside it the
answer is a standstill, so a resting thumb is not a held key.

The one asymmetry that remains, stated rather than hidden: an anchored drag costs **one
step** to plant the anchor, where a key is live on the step it goes down. That is 16 ms once
per press, worth 4.25 units of running — one and a half precision envelopes — and it is paid
once per gesture in a game with nothing to time. `game.test.ts` measures it by construction:
the pointer run is given one anchor step and is then bit-identical to the keyboard run.

### There is no action key, and that is the point

`actionHeld` is `keys.action || pointerDown` (`packages/engine/src/input.ts`), so a finger on
the glass *is* the action. A keyboard player can hold a direction without pressing Space; a
pointer player cannot steer without also raising the action. Any rule bound to the action
therefore costs one instrument something the other gets free.

This game never reads it. A test holds Space through a whole run and asserts the runner ends
in a bit-identical position. Space and Enter do nothing at all.

### No rapid pressing, and the number

`docs/input-idiom.md` promotes the real rule out of three manifest comments: a game is
same-input-class-only when winning requires more than about **two committing presses a
second**. There are no presses. The fastest thing this game asks anyone to do is change
heading, which both instruments do by holding something different, and a bot at the strongest
tier changes its mind 3.4 times a second while a person does not need to.

### A direction on the glass is not mirrored; a key is

The far seat reads the device upside down, so `move` is multiplied by `seatAxisSign` — its
own left arrow is the device's right. The **drag is not**, and that is not an oversight: a
key is a *label* and a drag is a *physical displacement*, and the far player's hand is
rotated by exactly the same half-turn their eyes are. Dragging away from yourself means away
from yourself for either player with nothing done to it. A test asserts seat two's own up
arrow and a drag away from seat two run its runner the same way down the board — the
opposite board direction from what seat one's W key produces.

## The field

| | Value | Why |
|---|---|---|
| Board | 600 × 1000, portrait | Two vaults stacked; each seat's own floor is a full-width band under its own thumb |
| The door | y = 500, full width | Not a point but a 520-unit line: a thief always has somewhere to run for, which is what stops a faster guard being a certainty |
| Runner | radius 20, x ∈ [40, 560], y ∈ [40, 960] | One box, shared; a runner may stand anywhere on the board |
| Home | (300, 920) and (300, 80) | The middle of a seat's own back wall — always inside its own half, and a half-turn pair |
| Vault | y ∈ [600, 880] and [120, 400]; x ∈ [70, 530] | Coins live 100 units clear of the door, so a raid is a commitment rather than a hop |
| Coin | radius 11, taken at 31 | Five loose in each vault; a replacement is set out 1.5 s later |
| Catch | 40 units, swept | The sum of two runners' radii, and it is drawn at that radius |
| Guard | 255 units a second | The floor's speed, not the seat's |
| Thief | 210 units a second | 21% slower: the price of being able to score at all |
| Deadzone / leash | 12 / 24 units | 4 and 8 precision envelopes, `docs/input-idiom.md` rule 2 |
| Clock | 60 s | The whole win condition, and the same 60 the manifest advertises |

### The vaults are half-turn images, and they are not contested **[ours]**

The restock cycle — 48 places, best of ten candidates each by clearance from the last five —
is generated **once, in seat one's frame**. Seat two's vault reads the same list through
`(x, y) → (600 − x, 1000 − y)`. Every coin is therefore a mirror image and **neither seat can
draw the easier floor**. A test checks it over 200 seeds.

The two players never contest a coin, and that is a consequence of the role rule rather than
a separate decision: a coin can only be lifted by a runner that is away from home, and only
one runner can be away in any one vault. So the pickups are order-independent by
construction, which is what lets both runners be stepped before anything is resolved.

The cost is that the coins are not the contest — the **bodies** are. Two thieves in opposite
vaults are farming identical courses at identical rates, and the whole of the difference
between them is what happens when one of them decides to stay home instead.

### The speed asymmetry belongs to the floor

A guard 21% faster than a thief is what makes a chase resolve at all: two runners at one
speed on an open floor never meet, and there are no obstacles here to change that. It is also
what makes crossing the door a decision instead of a formality — you give up a fifth of your
speed to be able to score, and you get it back the instant you are home.

It is deliberately not larger. At 290 (the first value tried) a guard caught **74%** of all
raids and the game collapsed onto a single strategy: carry one coin and run, because
everything in your hands goes to whoever catches you. At 255 it is 56% at `easy` and 58% at
`hard`, and carrying more than one coin pays.

## Carrying, banking, and the catch **[ours]**

The row says the thief collects coins and the guard catches the thief. It does not say what a
catch *costs*, and the three candidates are not equal:

- **Elimination** ends the match on the first mistake, and the coins become decoration.
- **A fixed fine** is a fine either player can arrange to be able to pay, and it makes the
  guard's timing irrelevant.
- **The loot itself** makes the guard's timing the whole point, and it is the fiction: a
  guard recovers what was taken.

So loot is **carried** until you are through your own door, and a catch moves all of it into
the guard's bank. The swing is **twice the carry** — you lose it and they gain it — which is
what makes standing at home a live alternative to raiding rather than a way of scoring
nothing, and it is why the bot's greed knob is the strongest of its three.

A caught thief is put out at its own door, which is 840 units away, so a catch can never
repeat on the next step and no stun timer is needed to prevent it. The guard is not moved: it
is already where it is supposed to be.

**Order matters, and it cost a bug.** Banking started life inside `driveSeat`, which meant a
thief caught at the start of a step and through its own door by the end of the same step was
paid twice: it banked the loot *and* the guard was handed nothing. The catch is settled first
now, and a test drives exactly that step at 8 Hz.

### The catch is swept, and the sweep is not for tunnelling

Two runners closing head-on cover 465 units a second between them, so passing clean through a
40-unit radius would need a step longer than an eighth of a second. Sweeping is not what
stops that; the arithmetic does, and a test carries the number. What the sweep buys is that
the catch is settled **at the moment of contact** rather than at the end of the step, which
is observable — the thief above is caught on its way through the door, where sampling the two
ends of the step would find both runners at home and let it go.

## Scoring and the end of a match

**The clock is the whole ending, not a backstop.** `WIN_CONDITION` is
`highest-when-time-expires`, which is the catalogue row word for word, so a match is exactly
`MATCH_SECONDS` of simulated time and nothing else can end it. There is no position two
`easy` bots can reach that fails to terminate, because termination does not depend on the
position at all: `termination.test.ts` finds this game at 3600 steps every time, and a test
here plays a match in which **neither runner ever moves, with no step cap**, so a match that
could not finish would hang the suite rather than pass quietly.

`roundSeconds` ends nothing — it is text on a catalogue card — and a test asserts the two
numbers are the same 60.

Only banked coins count. Loot in a thief's hands never made it through a door, and a guard
still standing over it when the clock stops has done its job.

Level on coins, the runner that made **more catches** takes it. A tie-break has to be
something that is not a function of the board — a covariant rule returns the mirror answer on
a mirror position and therefore decides nothing — and a catch count is a record of a seat's
own doing rather than a coordinate. Level on both is an honest draw, and draws are
**0.8–2.7%** of matches depending on tier.

## The bot

Three knobs, and each is a different thing a person is better or worse at.

| Knob | `easy` | `normal` | `hard` | What it is |
|---|---|---|---|---|
| `think` | 0.42 | 0.36 | 0.29 | Seconds between decisions |
| `caution` | 120 | 180 | 300 | Units of clear floor a threatened thief will pay for |
| `greed` | 5 | 4 | 3 | Coins carried before it turns for its own door |

Nothing in any of them is information a player does not have. Both runners, every loose coin
and **how much each runner is carrying** are on the board and drawn — the carry as pips over
the runner's head, precisely so that judging whether a thief is worth chasing is a skill and
not a privilege. What a weaker tier is denied is attention, nerve and patience, never sight.
A test asserts every heading a bot emits is one of the nine a person's keys or finger
produce, and that `chooseHeading` writes nothing into the board it is handed.

The bot makes **one** choice — which of eight headings to run — scored by a probe a fixed 70
units ahead, against a point it wants to reach and, when a guard is on it, a distance it
would like to keep. What the point is depends on the one predicate:

- **At home, with a thief on my floor and a chase that is on** → the thief.
- **At home otherwise** → the nearest coin in their vault. (A guard that has nothing to catch
  is a thief who has not left yet.)
- **Away, hands full or the vault bare** → the **nearest point of my own door**, not the
  middle of it.
- **Away otherwise** → the coin it is already going for, while that coin is still there.

One value is drawn per decision, unconditionally, before anything branches on the board, so
the count can never depend on the position — which is what lets two bots on separate streams
stay in step with themselves. A test asserts it.

### Every knob, swept alone

`hard`'s value varied with everything else left as shipped, against an untouched `normal`,
**300 seeds a row pooled over both seat orders** (600 matches, standard error 2.0 points).

| `think` | win | | `caution` | win | | `greed` | win |
|---|---|---|---|---|---|---|---|
| 0.14 | 79.4% | | 0 | 64.8% | | 1 | 97.1% |
| 0.20 | 76.9% | | 40 | 64.4% | | 2 | 84.6% |
| 0.27 | 72.2% | | 90 | 61.2% | | **3** | **73.6%** |
| 0.38 | 63.6% | | 170 | 63.8% | | 4 | 66.2% |
| 0.52 | 31.8% | | **330** | **74.1%** | | 6 | 44.7% |
| 0.70 | 9.2% | | 500 | 77.4% | | 8 | 15.3% |
| 1.00 | 0.8% | | 800 | 77.0% | | 20 | 0.7% |

- **`greed` is strictly monotone across its whole range** and is the strongest of the three,
  which is the design working: everything in your hands goes to whoever catches you, so
  greed is punished twice over. It is also the most human failing of the three.
- **`think` is monotone over the range the ladder uses and flat above it.** Thinking faster
  than about a fifth of a second buys 2.5 points, well inside two standard errors — the plan
  is not the thing that is wrong at that end.
- **`caution` is flat below about 170 and strongly monotone from there to 500, then flat
  again.** The 3.6-point wobble between 0 and 90 is 1.8 standard errors and is not claimed as
  real. The consequence is worth stating plainly: on this knob alone, `easy` and `normal`
  (120 and 180) are barely separated, and what separates them in the ladder is `think` and
  `greed`. `hard` sits at the top of the useful range on purpose.

### Two knobs that were swept and deleted **[ours]**

**`blunder` — a chance a decision comes out as nothing at all.** The obvious knob, and the
one Frozen Beaks ships. Measured against the shipped `normal`, it is strictly monotone:

| `blunder` | 0 | 0.05 | 0.12 | 0.25 | 0.40 | 0.60 | 0.80 |
|---|---|---|---|---|---|---|---|
| win | 73.6% | 70.2% | 63.3% | 46.4% | 22.0% | 3.8% | 0.2% |

It was deleted anyway, and the reason is the more interesting measurement. Against an
*earlier* `normal` — one whose `think` happened to sit at the interior optimum of the `think`
sweep — the same knob ran **backwards**: 56.2, 55.6, 59.2, 59.4 and 62.9 per cent at 0, 0.03,
0.07, 0.15 and 0.30. Blundering made the bot *better*.

That is not noise and it is not a bug in the sweep. Skipping a decision is **exactly a longer
decision interval**: `blunder` is `think` wearing a different name, so its sign is a function
of where `think` is set. A knob whose direction depends on another knob's value is the
compounding trap the brief warns about, and two knobs measuring one quantity is a ladder
nobody can reason about. `think` was kept because it is the honest name for the thing.

**`pursuit` — the seconds of optimism a guard grants itself before starting a chase.**

| `pursuit` | −1 | −0.3 | 0 | 0.25 | **0.5** | 1 | 2 | 8 |
|---|---|---|---|---|---|---|---|---|
| win | 8.8% | 27.0% | 54.6% | 68.9% | **73.6%** | 73.5% | 75.3% | 75.3% |

Real below half a second and **flat above it** — 1.7 points across a sixteen-fold range,
inside its own standard error, because past that slack `canCatch` is simply always true.
Negative slack means refusing chases you could win, which is not a thing to ask of a tier. So
the dial was deleted and the shape kept: `PURSUIT_SLACK = 0.5` for every tier, and *chase
what you can catch* is now part of the game rather than a handicap.

### Two bot bugs the sweeps found, both worth naming

**`think` measured backwards at first**, 49.6% at 0.10 seconds against 61.4% at 0.26. Two
causes, both of the same family — the knob was doing a second job:

1. The heading probe was `speed × think`, so a *slower* bot looked *further ahead*. It is a
   fixed 70 units now, and a test asserts two profiles a factor of eighteen apart in `think`
   choose the same heading from the same board.
2. The bot re-picked its target coin every decision, so two coins nearly equidistant made it
   swerve between them and arrive at neither — and the faster it thought, the worse that was.
   The target is sticky now: it keeps the coin it was already going for while that coin is
   still on the floor.

**A fleeing thief ran at the guard.** "Head home" was implemented as the seat's home point,
which is the middle of its own back wall — and the middle of the door is exactly where a
guard stands. The door is 520 units wide; a thief now runs for the nearest point of it. That
one line took the share of raids ending in a catch from 74% to 58%.

## The half-turn

Neither seat may have a better game than the other, and in this game that is a statement
about the *code* rather than about the geometry: the board is its own half-turn image by
construction, so turning it over and exchanging the seats must produce the mirror image of
the same match.

Three tests guard it, and they are the most valuable in the package:

- **`step()` is driven from 500 scrambled boards** with mirrored commands, and the **whole
  state** is compared to six decimals — both runners' positions and previous positions,
  facings, carry, bank, catches, losses, raids, the `home` flag and the flash timer; every
  coin with its respawn delay; both restock cursors; the clock and the winner. Runners are
  scrambled onto a lattice **that includes the door exactly**, so the one threshold a state
  variable can land on by construction is an everyday event in the sample rather than a
  measure-zero one.
- **`chooseHeading` and `canCatch` are mirror-checked directly** over 400 boards a tier,
  including the coin the bot picked and whether it committed to a chase.
- **A whole match is played against its own mirror**, 40 seeds at each of three tiers.
  **No winner flipped and no scoreline differed**, 120 for 120.

The family this is looking for, worth naming because it will happen to you: *a threshold that
a state variable lands on exactly by construction rather than by coincidence.* Frozen Beaks'
dunked bird sitting exactly on a hole rim; Snowball Throw's ball age on a whole frame. Here
it is the door, and it was designed out rather than tested around: the role predicate is
`seatAxisSign(seat) * (y − CENTRE_Y) > 0`, which the half-turn negates twice and therefore
leaves alone, so `y = 500` reads *away from home* for both seats and can never be read
differently by one of them.

## Balance

### Equal tiers, 600 seeds, both stream orders

Seat one's share of decided matches. "A" and "B" are the same 600 boards with the two seats'
generators exchanged:

| | A | B | mean | draws |
|---|---|---|---|---|
| easy v easy | 47.9% | 52.1% | **50.0%** | 1.50% |
| normal v normal | 51.8% | 48.2% | **50.0%** | 0.83% |
| hard v hard | 49.7% | 50.3% | **50.0%** | 2.50% |

The A and B rows are **exact complements** — 283/308 against 308/283, 308/287 against
287/308, 291/294 against 294/291 — which is the half-turn property showing up in the balance
table rather than in a unit test. Exchanging the generators produces the mirror image of the
same match, so seat order is not merely fair here, it is provably irrelevant.

And what those matches look like, per seat:

| | banked | catches made | raids | share of raids caught |
|---|---|---|---|---|
| easy | 31.6 | 5.73 | 10.31 | 56% |
| normal | 27.0 | 6.78 | 11.35 | 60% |
| hard | 21.6 | 7.76 | 13.41 | 58% |

**The better tier banks less, and that is not the inversion it looks like.** Nuts and Bolts'
failure was a *payout* rule that paid the opponent for your progress; this is two bots
guarding each other better, and both sides are suppressed identically. Cross-tier, where only
one side improves, the stronger tier banks more every time:

| pairing (stronger as p1, 400 seeds) | stronger banks | weaker banks |
|---|---|---|
| hard v normal | 25.0 | 19.4 |
| normal v easy | 31.6 | 24.3 |
| hard v easy | 32.0 | 15.7 |

It is still worth being explicit that the *scale* of the score shrinks with skill, because a
score that shrinks far enough stops separating anybody. It does not get close: 21.6 banked at
`hard` is 22 distinguishable outcomes, and draws are 2.5%.

### Cross tier, both seat orders, 400 seeds each

| | stronger as p1 | stronger as p2 | pooled | draws |
|---|---|---|---|---|
| hard v easy | 93.5% | 88.6% | **91.1%** | 1 and 4 of 400 |
| normal v easy | 75.6% | 72.9% | **74.3%** | 7 and 1 of 400 |
| hard v normal | 72.3% | 73.2% | **72.7%** | 3 and 5 of 400 |

Every pairing is monotone and every one agrees with itself within **4.9 points** across the
two seat orders.

### Against the repository's own harness

Replicated exactly, and then confirmed by running the real file: `balance-aggregate.test.ts`
reports

```
guard-and-thief   rt-split   50.0%   21.2   100 decided   0.0% draws   60.0 s   opener 50   distinct 90
```

Fifty point zero of a hundred decided matches, no draws, none unfinished, and it is 50.0% for
the reason given at the top rather than because the sample was kind — at 600 seed pairs the
same harness reads 50.0% of 1188 decided matches. `getActiveSeat` is not implemented at all,
which `turn-seat.test.ts` requires of an `rt-*` game.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match, and a
second asserts the two seats' shapes never cross over.

- **The near seat is round and the far seat is square, everywhere**: the runner, its doorway,
  the ripple when it is involved in a catch, and the three milestone markers on its tally. Two
  runners on one screen at once — and in this game frequently in the same half — is the pair
  most likely to be confused, and the two seat colours sit at **1.03:1 under deuteranopia**
  (`packages/engine/src/palette-vision.test.ts`), so for those players the shape is not a
  layer over colour: it is the only signal there is.
- **One stripe of seat colour along the near seat's wall, two along the far seat's.** A fixed
  multiplicity, so it reads as a pattern rather than as a score.
- **The two roles are marked in ink, not colour.** A guard wears a ring at exactly
  `CATCH_RADIUS` — the reach it catches at, so "how close is too close" is a thing a player
  can see rather than a number in a spec — and a thief does not. A test counts the rings as
  the roles change. Ink rather than seat colour so the mark reads identically on either
  runner and does not muddle the seat comparison above.
- **A coin is a ring: a disc with a hole in it.** Different primitive from either runner and
  from the doorways.
- **The carry is pips over the head**, the near seat's round and the far seat's square, and
  they are public because the bot reads nothing else about a thief worth chasing.
- **The door is a dashed line** across the middle, owned by neither seat, and each doorway has
  a stub pointing the way out of it, so the geography reads without colour.
- **The clock is a bar down the left edge that drains from both ends toward the door** — one
  object, shared, unchanged by the half-turn.
- **The tally is a length, not a number**, with three seat-shaped milestone markers on it.

A local copy of `apps/web/src/data/greyscale.test.ts`'s question lives in `game.test.ts`, so
this package fails on its own before the shared guard does.

## Rule 8: no pixels, rule 9: no extra field of view, rule 10: no device branch

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the input mapping, the palette and the drawing, and reads the simulation
without adding to it — a test plays nine hundred steps, renders the same frame at five alphas
and asserts nothing moved, and another asserts a running runner interpolates by the alpha at
0, 0.5 and 1. A third asserts the same simulated match ends after the same simulated *time*
at 30, 60, 120 and 240 Hz.

**Rule 9 is about field of view, and this game is the case where that distinction matters.**
Both players see the whole board — there is one board — so the split-field assertion Frozen
Beaks makes ("no seat-coloured mark in the other half") would be wrong here: a runner's whole
job is to cross. What must not cross is the *furniture*. A test walks a whole match and
requires that the only seat-coloured mark ever seen on the far side of the door is no taller
than a runner, and separately requires that it does happen, so the assertion is guarding
something.

Nothing here reads `presentation`, and a test asserts the same seed plays the identical match
in both.

## How the numbers were taken

Every figure comes from driving the shipped `rules.ts` directly — `botStep` against a
constructed profile for the sweeps and against `BOT_PROFILES` for the pairings — with a
generator for the layout and one per seat derived from one match seed, exactly as `game.ts`
derives them. Match lengths are simulated seconds, not wall clock. The harness lived in the
package while the game was being tuned and was deleted; `rules.test.ts` carries a cheap
version of the ladder, the board-by-board seat split and the mirror check that fails if any
of them ever inverts.

The repository-harness figures were taken twice: replicated against the built `dist/`, and
then read off a real run of `apps/web/src/data/balance-aggregate.test.ts`.

## What is not verified

- **Anything on a trackpad, or across two real devices.** `docs/input-parity.md` and
  `docs/input-idiom.md` both record that gap; #1862's harness does not exist. The
  re-clutch argument above is the one that is comfortable and might be wrong — though it is
  a weaker claim than most games in the catalogue have to make, because a re-clutch here
  costs a step of standing still rather than a shot.
- **Anything against a human.** Every balance number here is bot against bot. The bot never
  waits at its own door for a raid it can see coming, never baits one, and never counts the
  clock — all three are things a person does within a match or two — so a human match will
  look different from these tables, probably with more catches and lower scores.
- **The size budget**, which needs `pnpm build` and belongs to the orchestrator. The built
  `dist/` gzips to 18.0 kB against Frozen Beaks' 17.1 kB and Cup Pong's 13.4 kB, measured
  identically; Frozen Beaks' minified-and-gzipped chunk is 5418 bytes against a 12288-byte
  budget, which puts this one at roughly 5.7 kB on the same ratio. It is not the real number.
