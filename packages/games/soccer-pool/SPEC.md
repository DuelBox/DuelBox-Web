# Soccer Pool — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** ~90 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was read out of `src/rules.ts` and `src/game.ts` rather than
> remembered. Every measurement names the harness that produced it, and each one is
> re-checked on every run by `src/bot.test.ts` — a tuning change that moves them fails a
> test rather than quietly aging this document.

## Observed rules

> **Soccer Pool** — friend, bot — "Take turns to hit the ball and score."

Eight words, and they fix exactly three things: the turns alternate, what you hit is *the
ball*, and scoring is the point. They say nothing about how many balls there are, whether
anything defends the goal, where the ball goes after a shot, what a score is worth, how
many you need, or what stops a match in which nobody scores at all.

Everything from here down is **[ours]**.

## The shape of it **[ours]**

A pool table wearing a football shirt. One ball sits on the grass. Each seat has three
discs standing in front of its own net. On your turn you strike the ball itself, from
wherever the last player left it, and try to put it through the far goal. Miss, and your
opponent strikes the same ball from where it stopped, aiming the other way.

Striking **the ball** rather than a cue or a puck is the whole reason this is not Pool. It
makes the shot you leave behind part of the shot you play: a weak effort that dies in your
own half hands the other seat a short one, and a shot smashed at the far boards comes back
down the pitch to them. There is no cue ball to reposition and no second object to hide
behind — one ball, two directions, and whose turn it is.

## The pitch

| | Value | Why |
|---|---|---|
| Logical box | 700 × 1000 | Portrait; the bands above and below the pitch hold the status line |
| Pitch | x 40…660, y 110…890 | 620 × 780 of grass inside the boards |
| Centre spot | (350, 500) | Every restart, and the exact centre of the half turn |
| Ball | radius 15 | |
| Disc | radius 24 | Bigger than the ball, so a defender it meets head-on stops it |
| Goal mouth | ±78 from centre | A ball is through when its centre is within 63 of the middle |
| Goal depth | 40 | Presentation only. Nothing simulates behind the line |
| Strike speed | 0…1450 units/s | Full power rolls 948, a little over the 780-unit pitch |
| Roll drag | 0.22 per **second** | A per-second factor, not a per-step one |
| Stop speed | 14 units/s | The stop line. A ball reaching it stops dead rather than creeping |
| Board bounce | 0.72 | Enough to play a bank, little enough that it costs you |
| Disc bounce | 0.94 | Nearly a clean transfer, which is what a disc-on-disc contact looks like |
| Shot clock | 9 s | Long enough to line one up on a phone |
| Goal pause | 0.8 s | So both people see it go in |
| Roll cap | 4 s | A guard above the 3.06 s the physics already proves |

**No number here is a pixel.** The manifest declares the same 700 × 1000 box the rules use,
and a test asserts the two agree.

### The kick-off

The ball on the centre spot, a keeper on each goal line in the middle of its own mouth, and
two outfielders 200 units out at ±120 from the centre.

The keeper is the whole defence. Standing in the mouth it covers the middle of the goal
from every approach at once, so a wide angle is no easier than a straight one, and what a
shot has to find is one of the two windows either side of it — each 24 units of clear
mouth. The outfielders sit off the line of the goal entirely; they are what the ball takes
a deflection off on the way.

The layout is **exactly a half turn of itself** about the centre spot — the same half turn
the board makes when the turn changes — so neither seat is handed the easier side. A test
asserts the symmetry rather than trusting the seven pairs of numbers to stay paired.

### The defence goes back to its posts after every shot

Not only after a goal, and this is the rule the whole balance rests on. Left where they
were knocked, the discs accumulate: a seat that gets a shot away scatters the defence
guarding the goal it is shooting at, which makes its *next* shot easier, which is a
feedback loop that hands the match to whoever gets the first chance. Measured before the
rule went in, `hard` against itself over sixty matches: **9–50**, with seat one converting
0% of its shots and seat two over half of theirs.

Players trotting back into position between shots is also what the thing being modelled
looks like.

## Scoring and the win condition

`resolve({ kind: 'first-to', target: 3 }, { p1, p2 }, { timeExpired: shots >= 18 })`, from
`@duelbox/game-sdk`. Never a comparison written here, so "first to three" means the same
thing it does in every other game and a level score is a *defined* draw rather than an
accident of which seat the code happened to test first.

A goal is credited to **whoever attacks that end**, not to whoever struck the ball. That is
what makes putting it through your own net a gift rather than a special case in the code.

After a goal the ball goes back to the centre spot, the defence goes back to its posts, and
**the conceding seat restarts**, exactly as football does. That is the whole anti-runaway
rule: a seat three goals up has also handed over three kick-offs from the one spot on the
pitch neither seat owns.

### How the match is guaranteed to end

`roundSeconds` ends nothing — it is what prints "about 2 min" on the catalogue card. Pool
and Air Hockey both shipped unable to finish and were caught by
`apps/web/src/data/termination.test.ts`. Three caps here, each provable rather than hopeful:

1. **A shot settles, and quickly.** Every disc's speed is multiplied by `0.22^dt` each step
   and zeroed at the stop line, and *nothing on the pitch adds energy*: a board keeps 0.72
   of one component; an equal-mass contact mixes the two normal components into
   `(1−e)a + eb` and its mirror, whose squares sum to `s²/2 + (1−2e)²d²/2` against the
   original `s²/2 + d²/2` and so always fall; the separating push moves discs without
   touching a velocity. So `Σv²` never rises, no single disc ever exceeds `√(Σv²)`, and
   everything is stopped by `ln(1450/14) / 1.5141` = **3.06 s**. Measured over 240 struck
   shots from a grid of positions and angles, the worst was **3.00 s**. There is a
   `MAX_ROLL_SECONDS = 4` guard as well, which is unreachable and exists because the turn
   order rests on this one property — it was 9 s, which is the number Bowling shipped, and a
   cap that far above the real settling time is a cap that hides a ball still sailing on.
2. **A turn ends.** Nine seconds on the shot clock, then the turn passes and the shot is
   spent. A player who puts the phone down cannot freeze a match they are winning.
3. **The match ends.** Eighteen shots, nine each, counting the ones the clock took. When
   they are gone the higher score wins and a level score is an honest draw.

The arithmetic worst case is 18 × (9 + 4 + 0.8 + 0.36) + 0.5 ≈ **255 s**, against the ten
minutes the guard allows, and a test asserts that sum. In practice, over 1 200 bot matches:
**mean 56–72 s, worst 74 s**. Two people who never touch the screen at all reach a 0–0 draw
in **168 s** on eighteen shot-clock turns.

## Controls

| | Keyboard | Pointer |
|---|---|---|
| Seat one | `A`/`D` swing the line, hold `Space` to draw the boot back, release to shoot | Pull back from the ball and let go |
| Seat two | `←`/`→` swing the line, hold `Enter`, release to shoot | The same |

Every string in `manifest.ts` is checked against the code by `game.test.ts`, which drives
the game through the engine's real `InputManager` with those exact key codes and asserts
each one does what the sentence claims. The two keyboard halves belong to two different
people, here as everywhere: nothing remaps them when the turn changes, so seat one's keys
simply do nothing while seat two is up, and a test asserts that too.

**How the two sources combine, with no mode to switch between them.** A finger, while it is
down, owns both the line and the weight: the angle is the line from the finger *through*
the ball, and the weight is how far back it was drawn — 300 units for full power, under 20
and it is a thumb resting on the ball rather than a shot. The steering keys always add to
the line. The hold only sets the weight when there is no finger on the glass, because
`actionHeld` is true for a pointer too and reading both would have them fighting over one
number. `actionReleased` plays the shot whichever produced it.

**The weight is carried in a field, not read at the release.** `holdSeconds` is zero on the
step the key comes up, so a game that read it there would play every keyboard shot with
nothing behind it. There is a test for exactly that.

**The line starts pointed at the middle of the goal being attacked** at the start of every
turn. A keyboard has four directions and an action key and nothing absolute about it, so an
aim left wherever the last shot ended would make finding the goal again the whole game —
and the two instruments would not be playing the same game, which is what
`control-parity.test.ts` measures. Weight, and every adjustment off that line, is still the
player's. A finger overrides it the moment it pulls past the deadzone.

Both instruments can finish a match alone, and a test plays one out on each.

## Edge cases

- **Simultaneous input.** Impossible by construction: only the seat with the move is read,
  and the shell hands the whole surface to it.
- **Input in the other seat's zone.** There is no other zone — the board is `shared-board`
  and belongs to whoever is to play. The other seat's keys do nothing at all.
- **No input.** The shot clock takes the turn after nine seconds and spends the shot, so two
  absent players still reach full time and a draw rather than a frozen board.
- **A pull too short to be a shot.** Under 20 units it is ignored, or resting a thumb on the
  ball would fire it.
- **A shot with no power.** `strike` refuses it and returns false without spending a shot, so
  a refusal is never mistaken for a shot that went nowhere. Negative power is the same
  refusal rather than a shot backwards; power above one is clamped.
- **An own goal.** Credited to the other seat, and the conceding seat — which here is the
  seat that just played — restarts. It is the one case where the same seat strikes twice in
  a row, and a test allows it there and nowhere else.
- **A ball resting exactly on a post at a restart.** The defence goes back first and the ball
  is nudged clear along the line between them; a ball resting on the exact centre of a post
  is pushed straight up the pitch rather than dividing by zero, and never outside the boards.
- **A ball on the goal line but outside the mouth.** It bounces off the end board. Only the
  ball passes through a mouth; the six discs bounce off the end line everywhere, posts
  included. That is not quite football, and it is the right trade — a disc parked inside the
  net would be unreachable by either player for the rest of the match.
- **A ball that will not stop.** Cannot happen: see the settling bound. Stopped dead at four
  seconds if a future change ever makes it possible.
- **A stalemate.** There isn't one. Every turn ends inside 13 seconds and there are only
  eighteen of them.
- **Nonsense from the shell.** The input-fuzz guard sends four simulated minutes of unmatched
  key-ups, six fingers, pointers off the board and pause/resume at random. Nothing throws.

## Determinism

- **The only randomness is the bot's**, one `Rng.float()` per shot from the context's seeded
  generator, drawn once and held for the whole shot. There is none in the simulation: a
  strike of a given angle and power always rolls to the same place.
- **Every delay is counted in steps**, derived once from the first non-zero delta — the shot
  clock, the bot's thinking time, the pause after a goal, the pause on the final position.
  None of them reads a clock.
- **The integration has the matching analytic form.** See below. A shot rolls to the same
  place at 60, 90, 120 and 240 Hz, compared to nine decimal places.
- Two matches from the same seed replay identically, and neither the presentation nor which
  chair the local player is in changes a single shot. A test plays one seed through both
  presentations and compares every shot.

### Why the decay is integrated rather than stepped

The model is a per-second decay, `v(t) = v₀ · 0.22^t`, and it stays that model: this game's
power-to-distance law is **linear**, `d = (1450·p − 14) / 1.5141`, which is the most
learnable law there is for a gesture where the pull length *is* the power. Mini Golf's
constant deceleration gives `d = v²/2a`, which buys four times the distance at the top of
the dial as at the bottom — right for a putter, wrong for a boot drawn back.

What did change is how that model is stepped. It used to advance the ball by `v · dt` and
then decay `v`, which is forward Euler and overshoots the true integral by `dt·rate/2` —
about **1.3% at 60 Hz and 0.6% at 120 Hz**. So the same shot was a different shot on a
120 Hz phone, and the bot's own distance arithmetic, which uses the continuous integral,
was permanently 1.3% out. The step now moves each disc by `(v_before − v_after) / rate`,
which is that integral exactly, and coasts the last step to the stop line rather than
wherever the step boundary happened to fall. Those terms telescope, so a free roll totals
`(v₀ − 14) / 1.5141` **however finely it is sliced**.

That is Mini Golf's lesson — a provable stop time, an exact per-step integral, an exact
power-to-distance law — taken without taking its model, because this model already had a
better answer to the third one. `reachOf` and `powerFor` are now exact inverses of each
other and of the simulation, and tests hold all four claims.

## The bot

**What it reads:** where the seven discs are, where the mouth is, and where the boards are.
All of it is drawn on the screen in front of a person (CLAUDE.md rule 6). A test asserts
that changing the score or the shot count changes neither what it can see nor the shot it
picks, and that moving a disc changes both.

**What it does:** what a person does. It looks at a handful of lines across the far mouth,
keeps the ones nothing is standing in and that it can actually reach, aims at the middle of
the widest unbroken run of them, and hits it 45% harder than "just arrives" so the ball
gets there with pace instead of dying on the line. When the goal is covered — or too far
for the weight it dares use — it plays the safety that carries the ball furthest upfield,
sweeping sixteen directions and scoring each on how clear it is and how far up the pitch it
goes.

Both sweeps are walked **outwards from the seat's own left**, and the safety sweep starts
half a turn apart for the two seats, so a tie between two equally good options breaks the
same way seen from either chair. A test mirrors a hundred positions and asserts the chosen
angle is the mirrored angle to within 10⁻⁹ and the power identical.

**The error is one roll drawn once for the shot**, never redrawn per step. A per-step error
averages to zero and every tier plays the same; that is the single most repeated bug in this
repository and `@duelbox/game-sdk`'s `misjudgement` exists for it.

| | Aim spread | Power ceiling | Lines across the mouth | Time to play |
|---|---|---|---|---|
| easy | ±0.40 rad | 0.60 | 5 | 1.0 s |
| normal | ±0.20 rad | 0.76 | 9 | 0.7 s |
| hard | ±0.10 rad | 0.90 | 17 | 0.45 s |

The power ceiling is the lever that reads as skill. The pitch is 780 units long and the
power that rolls that far is 0.82, so `easy` **cannot shoot the length of it** and has to
work the ball upfield instead — which is what a weak player does — while `hard` can shoot
from anywhere. Measured conversion, 100 matches a tier against itself:

| | goals per shot | 0–160 | 160–320 | 320–480 | 480–640 | 640–800 | 800+ |
|---|---|---|---|---|---|---|---|
| easy | **3.7%** (67 / 1 800) | 0% | 35% | 14% | 3% | 0% | 0% |
| normal | **8.3%** (147 / 1 771) | — | 25% | 19% | 18% | 3% | 0% |
| hard | **16.0%** (271 / 1 696) | 89% | 100% | 38% | 19% | 7% | 0% |

The columns are how far the ball was from the goal being attacked when it was struck, in
logical units. The near buckets carry few shots — the ball is rarely left in front of a goal
— so read them as "a short one goes in" rather than as a rate. The far ones carry most of
them, and are where the tiers separate: `easy` scores nothing at all beyond 480 units,
because that is further than the weight it dares use will carry the ball.

### Measured win rates

200 matches a pairing — 100 seeds, each played from **both seats** and added together,
because seat one takes the opening kick-off from the centre spot and a one-sided sample
would credit that to whichever tier happened to sit there. The row's tier is the one named
first; the share is of *decided* matches.

| | v easy | v normal | v hard | draws | goals/match | mean | worst |
|---|---|---|---|---|---|---|---|
| easy | 50% | 7.9% | 1.9% | 60.0% (self) | 0.67 (self) | 71.7 s | 73.8 s |
| normal | **92.1%** | 50% | 15.0% | 42.0% (self) | 1.47 (self) | 65.7 s | 69.6 s |
| hard | **98.1%** | **85.0%** | 50% | 31.0% (self) | 2.71 (self) | 56.5 s | 64.7 s |

**The ladder is steep, and that is the trade this game made.** `easy` still wins 13 of its
400 matches against the other two, so it is an opponent rather than a wall — but the gap
between `easy` and `normal` is 92/8, not the 70/30 a gentler ladder would give. The reason
is the power ceiling, and removing it was tried: uncapping all three tiers cut the draw rate
at `easy` against itself from 67% to 42% and flattened the ladder to **69% / 83% / 69%**,
which is three tiers that are barely three tiers. The capped ladder was kept.

**Draws are the honest cost of a low-scoring sport.** First to three, over eighteen shots,
at 3.7% conversion means two `easy` bots usually finish level — 60% of the time. It falls to
42% at `normal` and 31% at `hard`, and it is a pairing that never happens in the product: a
person always occupies one of the two chairs, and a person converts far better than 3.7%.
A test holds the ordering — stronger pairs score more and draw less — so the shape cannot
silently invert.

**Seat one wins 55.3% of decided bot matches** (411 of 743 across the whole sweep) — the
first-move advantage every turn game has, and the same one Pool's break has. It is largest
at `easy`, 62.5%, where a shot from the centre spot is one of the few `easy` can actually
reach the goal with, and vanishes at `normal`, 48.3%. Both seats take exactly nine shots, and
the simulation itself is exactly mirror-symmetric: a test half-turns the pitch, plays the
mirrored shot, and compares every position step by step.

## Presentations

Shared-screen turns the whole board a half turn to face whoever is to play — `SeatFlip`,
from the engine, 0.36 s, with input suppressed and the shot clock stopped for the whole of
it, because a tap on a board that is moving lands where nobody aimed. Single-seat never
rotates. The simulation is identical in both; only the timing differs, by the 0.36 s a turn
takes to hand over, and a test compares the two shot for shot. See `docs/presentation.md`.

## Rule 7

Colour is never the only signal. Seat one's discs carry a **ring**, seat two's a **bar**,
and each net is marked with the same shape as the seat that defends it as well as painted in
its colour. The ball is white with a dark ring and centre, so it is neither seat's. The
status marker beside the shot count repeats the seat's own shape. Whose turn it is reaches
the player three ways — the marker, the aim guide drawn in the seat's colour, and the
board's own half turn — and the game draws **no turn banner**, because the shell owns that
one and `getActiveSeat` is how it is told.

The power ladder is drawn as ten notches of increasing height as well as filling with
colour, so the weight of a shot can be read, matched and repeated in greyscale.

## What is not specified here

- **Spin.** A ball struck off centre would curl, and would make the pull-back gesture two
  dimensions instead of one. It is real, and it is a second skill on top of a game that
  already has two.
- **Defenders that a player controls.** They stand on their posts and go back to them; nobody
  positions them. Moving one would be a second decision per turn, and turn-aim is one.
- **A shot clock a player can see running down from the start.** It only appears in the last
  three seconds, deliberately, so it does not rush a shot that is not in trouble.
- **The draw rate at the weakest pairing.** 60% for two `easy` bots is high for a game that
  can end level. Anything that fixes it — a wider mouth, a shorter pitch, a keeper that does
  not stand dead centre — changes what the game *is*, and would need measuring against all
  three tiers rather than tuned against the one.
- ~~**Whether the first-move advantage should be paid for.**~~ **Answered.** The opening
  kick-off was worth about five points of win rate to whoever took it, and the balance
  harness recorded this game at **57.5%** to seat one over a thousand seeds. It was seat one
  taking it every time: `resetMatch` opened from a literal `p1`. It now opens from
  `context.openingSeat` (#2466, #2487), which is football's alternate-by-half at the layer
  that owns the half. Measured at 50 seeds x both opening seats on `normal`, equal tiers:
  **50.0%** of 62 decided matches, and the game's line was deleted from `OUTSIDE_THE_BAND`.
