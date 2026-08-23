# Carrom — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 720 × 900 ·
**Zone split:** shared-board · **Round length:** ~90 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions, and
> every number below was read out of `src/rules.ts` and `src/game.ts` rather than remembered.
> Every measurement below was taken by running the code and is reproducible from the seeds
> in `src/rules.test.ts`.

## Observed rules

> **Carrom** — friend, bot — "Pot all your pucks before your opponent and win. The Queen can
> be potted anytime but it must be potted before the last puck and must be covered
> immediately in the same turn."

Three sentences, and between them they fix four things: a player owns a set of pucks, the
frame is won by clearing yours first, the queen may go down at any point *before* your last
puck, and a queen not covered in the turn that took her does not count.

They say nothing about how many pucks a side, how big the board is, what a striker is or how
it is placed, what happens when you pot your opponent's puck or the striker itself, what
"covered" costs when it fails, or — the omission that matters most — what ends a frame
neither player can finish. Everything from here down is **[ours]**.

`roundSeconds` is 90 in the manifest, which is the catalogue card's estimate and is enforced
nowhere. It is honest for the middle tier — `normal` against `normal` averages 80 s — and
generous against `hard` at 41 s. Two `easy` bots take longer, which is what being bad at
carrom looks like.

## The board **[ours]**

Square, centred in the logical box, so a half turn maps the board exactly onto itself and the
two seats are the same problem rather than two similar ones.

| | Value | Why |
|---|---|---|
| Board | 660 square at (30, 120) | Centred: `CENTRE` is (360, 450), the middle of the box |
| Frame | 34 | The wooden rail; the bed is 592 square, x 64…656, y 154…746 |
| Puck radius | 17 | Twelve of them plus the queen fit the opening rosette with room |
| Striker radius | 22 | Bigger and heavier, as it is on a real board |
| Puck mass | 1 | |
| Striker mass | 2 | The whole feel of the game is in this ratio — see below |
| Pocket mouth | 40 | The rails stop this far short of each corner |
| Frame bounce | 0.62 | Wood, not cloth over rubber: it gives much less back than a pool cushion |
| Puck bounce | 0.94 | |
| Striker speed | 0…1200 units/s | Full power rolls 2118 units, two and a half board diagonals |
| Friction | 340 units/s² | Constant. `d = v²/2a`, so weight is learnable |
| Baseline | 218 from centre | On the shooter's own side |
| Baseline half-length | 200 | How far either way the striker may slide |
| Aim cone | ±1.15 rad | About ±66° off straight ahead |
| Pucks a side | 6 | Nine a side is a real board; six fits a phone and a 90-second frame |

**A pocket is a hole cut into the corner, and modelling it any other way does not work.** The
rails stop `POCKET_MOUTH` short of each corner and anything reaching the square that leaves is
in. With rails running right to the corner and a circular capture zone, a puck struck perfectly
at a pocket is deflected by whichever rail it reaches first — a couple of units off the
diagonal is enough — and skids away along it. Measured, with a bot aiming the exact ghost-ball
line and zero error: 46 of 190 open shots dropped, every departure angle correct to three
decimal places. The pocket was not missing the puck; the rail was taking it away first. With
the mouth, the same 190 shots dropped 152. The mouth is also what keeps a body *in*: the rails
are open only over a square that pots whatever enters it, in the same sub-step, so there is no
gap to leak through. A test flicks two dozen strokes and asserts nothing ever finishes a step
off the bed.

**The striker is twice a puck, and the impulse is mass-weighted because of it.** Pool could
exchange velocities outright because every ball there weighs the same. Here a head-on strike
gives the puck `(1 + e)·m_s/(m_s + m_p)` = 1.29 times the striker's speed, which is why a
carrom striker exists at all. The separation push that pulls two overlapping bodies apart is
split by inverse mass too, or a struck puck shoves the striker backwards as if it were the
heavier body.

## The opening

Fixed, never seeded. An opening both players know is part of carrom, and a random spread would
make the break a lottery.

The queen sits on the centre spot; six pucks ring her at 35 units, alternating colours, and six
more at 70 units, offset by 30°. The arrangement is **antisymmetric under a half turn** —
every puck has one of the other colour exactly opposite it through the centre — so neither seat
opens with the easier board. A test asserts it puck by puck rather than trusting the arithmetic.

## Scoring and the win condition

`resolve({ kind: 'first-to', target: 6 }, { p1: potted, p2: potted })`, from
`@duelbox/game-sdk`, asked after every settled stroke. A seat's score is how many of *its own*
pucks are down. Potting an opponent's puck scores **for them**, which is what makes a wild
stroke expensive.

The queen is a gate on the last puck rather than a point. A queen tiebreak was written and
measured before it was thrown away: scoring `2 × pucks + 1 for the queen` against a target of
12 keeps the same meaning for "clear your six", resolves a level expiry in favour of whoever
covered her, and still goes through `resolve` rather than a hand-written comparison. Over 1080
bot frames it changed **three** outcomes under the old stalemate rule and **none at all** under
the current one — because a frame that expires level is almost always one in which nobody ever
covered her. Not worth a win condition whose target is not the number of pucks.

**What happens after a stroke:**

- Pot one of your own — you shoot again.
- Pot one of the opponent's — it counts for them and your visit ends. Not a foul; nothing
  comes back.
- Pot the striker — a foul. One of your pucks comes back, the one you potted in that very
  stroke if there was one, and your visit ends.
- Pot the queen — she is held pending. Cover her by potting one of your own in the same stroke
  or in the next stroke of the same visit. Otherwise she goes back to the centre spot and your
  visit ends. **She never crosses the change of hands**: a foul in the stroke that took her
  sends her straight back, so the opponent can never inherit a queen to cover for free.
- Pot your last puck with the queen unresolved — it comes straight back and the stroke is a
  foul. This is the observed rule "the queen must be potted before the last puck", enforced
  rather than merely stated. The gate is checked for *both* seats, because potting the
  opponent's last puck for them would otherwise hand them the frame through a door the rules
  keep shut.

A returned body goes to the centre spot, or to the first free place on a fixed ring search
outward from it. Never seeded — a player has to be able to predict where it lands.

**Between strokes** the striker is lifted off the board and placed again: the slide and the aim
both start from the middle every time, rather than from wherever the last stroke left them.

### How the frame is guaranteed to end

"First to six" on its own can run for ever, and Pool shipped that way: two `easy` bots played
forty frames, finished none, and took over a thousand strokes each without potting anything.
Three caps, each of them provable rather than hopeful:

1. **A stroke settles.** Friction is constant, so a body at `v` is stopped after `v / 340`
   seconds. The stroke starts with `½·2·1200²` of energy and every contact takes some away
   (restitution 0.94 between bodies, 0.62 off the frame; the separation push moves positions
   and never velocities), so no body ever exceeds `sqrt(2E/1)` = 1697 units/s and nothing can
   still be rolling after **4.99 s**. `MAX_ROLL_SECONDS = 5` stops anything that somehow is.
   Measured worst over 1080 bot frames: **2.48 s**.
2. **A visit ends.** Every branch above either repeats the visit on a *gain* — a puck of your
   own down, or the queen covered — or hands the board over. The one exception, a pending
   queen, is granted exactly one extra stroke, tracked by whether she was already pending when
   the stroke began.
3. **The frame ends.** `STALEMATE_SHOTS = 24` consecutive strokes that gain nothing for
   anybody ends it, and `SHOT_LIMIT = 96` strokes ends it whatever happens. Either resolves on
   what is down, drawn if that is level.

The ceiling is therefore `SHOT_LIMIT × (MAX_ROLL_SECONDS + THINK_SECONDS)` = 96 × 5.35 =
**514 s**, against the 600 s `apps/web/src/data/termination.test.ts` allows. Six seconds was
the first value of `MAX_ROLL_SECONDS`, which put the ceiling at 610 s — over the line, and so
not a guarantee at all, merely a frame that had never happened to need it.

Measured through the real `CarromGame` loop, 24 seeds a pairing: **41 s average and 69 s worst
at `hard`, 80/107 at `normal`, 165/202 at `easy`.** The slowest frame anybody has produced is a
third of the budget.

**`STALEMATE_SHOTS` was 16 and that was too few**, which only measuring showed. The weakest tier
pots on roughly one stroke in twelve, so a run of sixteen dry strokes happens by bad luck alone
about a quarter of the time — and the rule was ending **three easy frames in four** on boards
that were perfectly playable, with `normal` drawing a fifth of its frames against itself.
Twenty-four halved that (20% → 10%) and costs nothing, because it is `SHOT_LIMIT` and not this
number that bounds how long a frame can run.

## Controls

| | Keyboard | Pointer |
|---|---|---|
| Seat one | `A`/`D` slide the striker along the line, `W`/`S` swing the aim, hold `Space` to build the stroke, release to flick | Touch behind your own line to slide; carry the same finger into the board to aim, further in for harder; let go to flick |
| Seat two | `←`/`→` slide, `↑`/`↓` swing the aim, hold `Enter`, release to flick | The same |

Three numbers make a stroke here where Pool needs two — where along the baseline, which way,
how hard — so both instruments have to express all three, and a test completes a whole stroke
from the keyboard alone.

**The two sources combine with no mode between them.** A finger, while it is down, owns both
the line and the weight; the steering keys always add to the line and the slide; and the hold
only sets the weight when there is no finger on the glass (`pointer === null && actionHeld`).
`actionReleased` plays the stroke whichever produced it — `flick` itself owns the rule that a
stroke needs power behind it, so a refusal is never mistaken for a stroke that went nowhere.

`holdSeconds` is zero on the step the key comes up, so the weight is carried in a field rather
than read at the release. A game that read it there would play every keyboard stroke with no
weight at all; there is a test for exactly that.

**Everything is in seat space.** `+1` right is the shooter's *own* right whichever side of the
device they sit on, and the aim's zero is straight up the board away from them. The two seats
are mirror images rather than one of them being asked to play the board upside down.

| Game constant | Value |
|---|---|
| Drag for full power | 300 units |
| Drag ignored below | 26 units |
| Hold for full power | 0.9 s |
| Aim swing rate | 1.2 rad/s |
| Slide rate | 0.9 of the half-baseline per second |
| Bot thinking time | 0.35 s, the same for every tier |
| Board held after the frame | 0.5 s |

## Edge cases

- **Simultaneous input.** Impossible by construction. Only the seat with the move is read, and
  the shell hands the whole pointer surface to it (`getActiveSeat` is what turns that on).
- **No input.** Nothing happens and nothing times out. A turn game with a silent player is a
  game waiting, not a game stuck — and a test asserts the bot never plays a stroke for a seat a
  person is sitting in.
- **Input in the other seat's zone.** There is no other zone; a finger anywhere on the board
  belongs to whoever is to play. The two keyboard halves stay disjoint, so seat one's keys
  cannot move seat two's striker even on seat two's turn. A test asserts that too.
- **Input during the seat flip.** Refused for the whole 0.36 s of the half turn. The board is
  moving, and a tap on it would land somewhere nobody aimed.
- **A drag too short to be a stroke.** Under 26 units it is a thumb resting on the striker and
  is ignored, or resting a thumb there would fire it.
- **A puck resting on the baseline.** The striker stops *against* it rather than overlapping
  it: `freeOffset` searches outward from the requested slide in steps of 0.025 for the nearest
  legal place, which is what a hand does. A striker placed overlapping would be flung sideways
  by the separation push the instant it was flicked. What is drawn is always what will be
  flicked, because the placement runs at the top of the same step.
- **Nonsense.** An angle past the cone, a power above one or at zero, a pointer two thousand
  units off the board: all clamped or refused. A 600-step fuzz drives seat one with random
  garbage and asserts no body ever reaches a non-finite position and the aim never leaves the
  cone.
- **A body that will not stop.** Stopped dead at five seconds. Unreachable through `flick` —
  see the energy bound above — and it exists for a body wedged in a corner being fed by the
  separation push.
- **A stalemate.** Twenty-four dry strokes, or ninety-six strokes altogether. Both settle on
  what is down and are drawn when that is level. Measured draw rates, a tier against itself:
  **25% at `easy`, 10% at `normal`, 0% at `hard`.** The `easy` figure is high and it is honest:
  two players who clear a quarter of their boards in eighty strokes have not decided anything,
  and no rule can invent a winner for them. With one competent player in the frame it falls to
  2–9%.

## Determinism

- **All randomness is the bot's**: two `Rng.float()` draws per stroke, from the context's
  seeded generator, and nothing else in the game reads a random number. A given placement,
  angle and power always produces the same board.
- **Every delay is counted in steps**, derived once from the first non-zero delta — the bot's
  thinking time and the pause after the frame is decided. Nothing reads a clock.
- **The integration has the matching analytic form.** Constant deceleration integrated as
  `(v − ½at)·t`, with the last part-step covering the exact `v²/2a` that remains. The total
  roll is therefore the same number at 60, 90, 120, 144 and 240 Hz — a test steps the same
  stroke at all five and compares where it stopped to six decimal places — and the same at any
  number of sub-steps, because the exact integral telescopes. A plain `v·t` throws away `½at²`
  every step and drifts by about a unit over a full-power stroke; `pow(drag, dt)` would need
  its matching analytic power to survive a change of frame rate at all, and would still only
  ever approach zero rather than reach it.
- **Six sub-steps per fixed step, and this is the most load-bearing number in the file.** A
  striker at 1200 units/s crosses 20 units in a sixtieth, against a striker-puck contact circle
  of radius 39 — so a whole-step integration detects contact up to 20 units past the point the
  stroke was aimed at, by which time the line of centres has swung twenty degrees and the puck
  leaves nowhere near the pocket. Measured: a bot aiming the perfect ghost-ball line potted 16
  of 190 open shots. Six sub-steps put the overshoot under three units and the same 190 shots
  potted 150. Sub-stepping keeps frame-rate independence rather than breaking it: the sub-step
  is a fraction of whatever delta arrives.
- **Contact normals are read at the instant of touching, not at the instant of noticing.** A
  step finds a pair already overlapping, and by then the line of centres has swung four or five
  degrees on a fast cut — thirty units of miss over a four-hundred-unit run. The relative
  motion is wound back to the touching distance by the positive root of a quadratic and the
  normal read from there. This is the difference between a bot that pots a quarter of its open
  shots and one that pots four fifths.
- **A separating pair is left alone.** Applying the impulse again would push them together and
  quietly add energy; a test steps a whole stroke and asserts the total kinetic energy never
  rises.
- Two matches from the same seed replay to identical positions to nine decimal places, and the
  presentation — shared-screen or single-seat, either local seat — changes nothing but the
  picture.

### Seat symmetry

The board is exactly antisymmetric under a half turn, and `mirror()` in `rules.test.ts` is the
assertion of it: rotate every body about the centre, exchange the two colours, swap the seat,
and the same seat-space stroke produces the mirrored board, the mirrored pot list and the
mirrored outcome, stroke after stroke.

Two honest exceptions, both about *which of several equally good strokes the bot picks* rather
than about the rules:

- **The opening ties.** The rosette is also a reflection of itself with the colours exchanged,
  so the shooter has two lines of identical score, one either way off the middle. `botAim`
  keeps the first it meets, and the half turn reverses the order the four pockets are
  enumerated in, so the tie falls the other way. Both seats are offered the same pair. On any
  board without that residual symmetry the two seats name the identical stroke to nine decimal
  places, and a test checks it over sixteen consecutive strokes.
- **`easy` picks by index.** It takes a playable line rather than the best one, drawn uniformly
  over everything it found — and the reversed pocket order permutes that list. The *set* is
  identical from either side, which a test asserts over 400 draws, and a permutation of a
  uniform distribution is that distribution.

The break is worth something, as it is in every turn game: over 120 frames a tier against
itself, seat one takes **40% (easy), 54% (normal), 57% (hard)** of the decided frames. It is
tempo, not position — the position is provably equal.

## The bot

It reads the board and nothing else: where the pucks are, where the four pockets are, and its
own baseline. Every one of those is drawn on the screen in front of the person opposite, and
the proof is structural — `botAim` is handed the state, a tier and two numbers, and the state
has no seat-private field to read. A test pins the whole list of state keys so a new one cannot
be added without somebody noticing (CLAUDE.md rule 6).

It plays the shot a carrom player is taught. For each of its own pucks and each of the four
pockets it works out the **ghost point** — where the striker has to be at contact to send that
puck at that pocket — and tries nine placements along its baseline, keeping the lines that are
on the board, inside the aiming cone and not through another puck. It scores what a player
weighs by eye: a thin cut is hard, a long run to the pocket is hard, and a striker that has to
cross the whole board is hard.

When nothing at all can be potted it **plays the board** — hits its own nearest puck, which
moves the position, cannot foul, and may open something up. Firing the least bad impossible
line instead is how a frame grinds to a halt; Pool measured thirty of forty frames never ending
before it learned this.

Its error is **two rolls drawn once for the stroke**, never redrawn per step. A per-step error
averages to zero and every tier plays the same; that is the single most repeated bug in this
repository and `@duelbox/game-sdk`'s bot-judgement module exists for it.

| | Line error | Power | Takes | Goes for the queen early | v easy | v normal |
|---|---|---|---|---|---|---|
| easy | ±0.055 rad | 0.64 | any playable line | no | — | — |
| normal | ±0.045 rad | 0.66 | the best line | no | **85%** | — |
| hard | ±0.014 rad | 0.78 | the best line | yes | **89%** | **68%** |

120 frames a pairing, played from both seats and averaged, with the draws counted as neither.
Drawn frames: 9% for normal–easy, 2% for both hard pairings.

**The lever that makes `easy` easy is *which* shot it takes, not how straight it hits it.** The
spreads of 0.055 and 0.045 are close together on purpose: the gap in the table is almost
entirely the uniform draw over every playable line, which is what a weak player does — sees the
board, and plays a shot rather than *the* shot.

**A narrower draw was measured and thrown away.** A "tolerance window" was added so `easy` drew
only from lines within a given score of the best, on the reasoning that a uniform draw over 216
candidates is worse than a person. It made `easy` far too strong and flattened the ladder:
`normal` beat it 50% at a window of 8, 60% at 15, 64% at 25, 70% at 70, against **85%** with no
window at all. Three tiers that all pick sensible shots and differ only in a hundredth of a
radian are not three tiers. Reverted.

**Where the tiers show up in play**, 120 frames of a tier against itself:

| | Strokes a frame | Frames decided by clearing a board | Draws |
|---|---|---|---|
| easy | 81.5 | 25% | 25% |
| normal | 38.0 | 90% | 10% |
| hard | 19.3 | 100% | 0% |

`hard` is the only tier that goes for the queen before it is forced to, and it is the only one
that covers her in every frame. It costs it strokes — a queen potted and not covered goes back
and the visit ends — which is why `hard` beats `easy` by only four points more than `normal`
does while finishing in a third of the strokes.

## Presentations

Shared-screen turns the whole board half about to face whoever is to play — `SeatFlip` from the
engine, 0.36 s, with input suppressed for the whole of it. Single-seat never rotates: seat two
alone on their own device would otherwise be asked to shoot from the far edge of a board drawn
for seat one, which is the one presentation carrom cannot survive. The simulation is identical
in both, and a test plays the same seed through all four combinations of presentation and local
seat and compares the boards. See `docs/presentation.md`.

## Rule 7 — colour is never the only signal

Seat one's puck is a disc with a **ring** cut in it, seat two's a disc with a **bar** across it,
and the two readouts repeat the same two markers beside their counts. The queen is the only
puck marked with a **cross**, and the striker the only one with no mark at all. The two
baselines carry the same ring and bar in their end circles. Whose stroke it is reaches the
player three ways — the halo round the striker in that seat's colour, the count drawn larger
at that seat's end, and the board's own rotation — and the game draws **no turn banner**,
because the shell owns that one.

The status line says in words what the board is asking for: *Slide, aim, flick* · *Cover the
queen* · *The queen first* · *Foul — a puck goes back* · *Running* · *Frame over*.

## What is not specified here

- **Nine pucks a side and a real 29-inch board.** Six a side is what fits a 90-second frame and
  a phone. Nothing in the rules layer depends on the number; `PUCKS_PER_SIDE` is one constant.
- **The queen as three points.** Real carrom scores the frame as the loser's remaining pucks
  plus three for the queen. Here she is a gate rather than a score, because the win condition is
  "clear your six" and a points system needs a match structure to be worth anything.
- **Thumbing, back-hand strokes, and the rule against a striker touching the baseline circles.**
  All are real carrom; none of them is expressible with a slide, an angle and a power.
- **Alternating the break.** Seat one always breaks, and the measured advantage is real if
  small. Fixing it needs a match structure — best of three frames with the break alternating —
  which is the shell's business, not this game's.
- **Spin.** A carrom striker can be cut; this one cannot. Adding it would mean a third number
  in the stroke and a fourth in the bot's search.
