# Spin War — specification

**Archetype:** `rt-arena` · **Category:** Arena · **Logical box:** 800 × 800 ·
**Zone split:** shared-board · **Round length:** 40 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two spinning tops are launched into a shallow dish. Both players drive at once, all the
time; there are no turns. A top whose centre passes the crest of the lip has been pushed
out and pays the other seat two points. A top whose spin runs out topples where it stands
and pays the other seat one. First to four.

## Observed rules

From the reference genre, verbatim (`docs/observed-rules.md`, row **Spin War**):

> Push your opponent out of the bowl! Use your finger to move the spinner! 4 points to win!

That fixes four things and no more: the goal is a push-out, the instrument is a finger, the
target is four points, and both tops are on one board at once. It says nothing about how a
push is resolved, what stops a round that neither player wins, what a finger means for a
player holding a keyboard, or what "spin" is for beyond the name. Everything below those
four sentences is **[ours]**.

## Spin is a spendable resource, and that is the whole game **[ours]**

The name is the design. Each top starts a round with a full gauge and **nothing in the
simulation ever adds to it**. Spin does three jobs and they are what make the game a war
rather than a shoving match:

- it sets how hard a top can drive (`driveShare`), so a spent top cannot chase;
- it sets who wins a clash (`the bite`), so the fuller top throws the emptier one;
- it runs out, which is the termination guarantee — see below.

A player therefore chooses continuously between spending spin to hold the ground and
saving it to win the exchange that ends the round. Both choices lose to the other one done
better, which is the tension the game is made of.

## The bowl

Read out of `rules.ts`; the reasons are in the doc comments there.

| | Value | Why |
|---|---|---|
| Centre | (400, 400) | Dead centre of the 800 box, so the board is the same picture upside down |
| Crest radius `BOWL_RADIUS` | 285 units | The losing line. A top is out once its **centre** passes it |
| Lip drawn beyond the crest | 18 units | Presentation only; 285 + 18 fits the 400 half-box with room |
| Dish `BOWL_SPRING` | 1.3 /s² | A linear spring, so the step is solvable exactly. Damped period 5.75 s |
| Floor friction `BOWL_DRAG` | 0.65 /s | A decay **rate**. Damping ratio 0.285 — deliberately light |
| Top radius | 44 units | Contact distance 88, against 15 units of travel in one capped step |
| Drive `DRIVE_ACCELERATION` | 230 units/s² | Steady point 177 out; 207 counting the 39% overshoot |
| Speed cap `MAX_SPEED` | 900 units/s | Applied to the velocity a step starts with, so no clash is tunnelled |
| Launch distance | 130–225 units | Drawn per round, both tops the same. See "edge cases" |

**The dish is shallow on purpose.** A steeper one — the first build used 2.25 /s² against a
drive of 640 — holds both tops in the middle so firmly that no shove can carry either
anywhere near the lip. That build played four hundred bot matches and **not one top was
ever pushed out of the bowl**, which is to say it was not this game. Two numbers set the
whole balance and they are chosen against each other: a top driving flat out from the
middle peaks at **207**, and a top *launched* from the middle needs **476 units/s** to
cross the crest. No drive reaches 476. Clashes do. Every push-out in the game lives in the
gap between those two numbers.

## The push, and how a clash is resolved

`collideSpinners` resolves one contact. It never allocates and never runs a solver; it is
four ideas applied in order.

1. **Separation.** Any overlap is split by mass so a pair cannot grind through each other.
2. **The throw.** The contact drives the pair towards a **separation speed** — it never
   pulls them together, and it stops the instant they are already parting that fast:

   `thrown = KICK_SPEED · rub + BITE_SPEED · gap + RESTITUTION · (speed they met at)`

   `rub` is what the two have left between them (the rims' own energy), `gap` is the spin
   war, and the last term is the ram. A speed **target** rather than a shove is the load-
   bearing choice: a shove applied on every overlapping step is applied sixty times a second
   for as long as the pair stay touching, which is both sixty times its own size and a
   different game at a different step rate. The first build did exactly that and the two
   tops wound each other into a clinch whirling at the speed cap that nothing could break.
3. **The bite.** The throw is split between the two by `shareA`/`shareB`. Level, they part
   evenly. With daylight between the gauges the fuller top keeps its ground and the emptier
   one takes almost all of the throw. The split bends — `1 − (1 − lead)²` — rather than
   running straight, because both tops leave a clash heading *outwards*: unless the winner
   gives up much less ground than the loser, the exchange that throws the loser over the lip
   throws the winner over it too, and a round paying both seats is a stalemate with extra
   steps. It is **not** a square root, which was tried: a root turns a difference of 10⁻¹⁶ —
   arithmetic, not play — into a bias of 10⁻⁸, and a match nobody plays stopped ending level.
4. **The scrape and the toll.** Both rims turn the same way, so where they touch they move
   opposite ways and friction throws each along its own side of the contact — driven towards
   the rim speed and no further, for the same reason as the throw. Then each top pays spin
   **for the speed change it actually absorbed**, capped at two reference clashes.

**The gap is measured against what the two tops have left between them**, not against a full
gauge, so ten turns of daylight means nothing at the start of a round and is decisive at the
end. That is also the answer to the question the first build could not answer: an evenly
split bill can never open a gap between two tops that are playing identically, and with no
gap there is no bite, and with no bite nobody is ever pushed out. Charged on what each top
absorbed, any asymmetry at all — a clash met off-centre, a shove taken while already
sliding, the bite itself — costs the thrown top more than the one that threw it, and the gap
that opens buys a bigger bite.

## Scoring and the win condition

Resolved by the shared helper: **`first-to`, target 4** (`POINTS_TO_WIN`), handed the running
tally. No comparison is written by hand anywhere in this game, so "first to four" and the
draw both mean here exactly what they mean everywhere else.

| Ending | Award | |
|---|---|---|
| Over the lip | 2 to the other seat | `RING_OUT_POINTS` — the observed rule leads with the push, so the push is what pays |
| Both over the lip in one step | 2 to **both** | A genuinely simultaneous throw is a shared round, not a win for whichever seat was tested first |
| A gauge runs out | 1 to whichever top has more spin left | `TOPPLE_POINTS` — the slow road to the same four points |
| Both gauges level at the end | 1 to **both** | See "the tie tolerance" below |

Two clean throws win a match; out-lasting an opponent takes four rounds. After a score the
bowl is relaunched after `RESET_STEPS` = 66 **steps** — a little over a second — except for
the round that decides the match, which is left exactly as it fell so the last frame shows
how it ended.

### The tie tolerance

A run-down is settled by comparing the two gauges, but to `SPIN_TIE_EPSILON` = 10⁻⁶ spin
rather than exactly. A match nobody plays has two identical tops in a bowl symmetric about
its middle, so both gauges empty in the same step — but not on the same *number*, because
the seats' coordinates are mirror images about 400 rather than about zero and the arithmetic
differs in the last bit or two. A bare comparison hands the round to whichever side of the
bowl the rounding fell on. Ten femto-turns is not a spin war; it is a tie, and a game with a
draw available should say so. Measured: an untouched match now ends **4–4, a draw, in 4773
steps**. The tolerance is a millionth of a turn — far below one step of idle wear (0.05) and
far below the smallest difference any round of real play produces.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Seat one (near) | Touch your own half; the top drives at your finger | `W` `A` `S` `D` |
| Seat two (far) | Touch your own half; the top drives at your finger | `↑` `↓` `←` `→` |

Both come out of `#steer` as a direction of at most unit length, and the two are the same
instrument: a finger placed straight out to the right and the right-hand key produce the
identical push, asserted directly in `game.test.ts`. A pointer within `POINTER_DEADZONE` = 8
units of the top's own centre is a finger resting on it and pushes nothing.

**The two keyboard halves are two people, permanently.** The shell moves *pointer* ownership
between seats; it never folds both keyboard halves onto one seat, and this is a shared-board
real-time game with no active seat to fold them onto anyway. `W A S D` is seat one and the
arrows are seat two, at the same time, for the whole match — which is what the manifest's
keyboard line says and what `game.test.ts` asserts by driving seat two and checking seat one
did not move. **There is no action key**, and the manifest promises none; a match played
with the action key held down is byte-identical to one played without it.

The pointer surface is split horizontally for this archetype, so a touch has to *start* on
your own side of the device — after that it belongs to you and keeps that ownership wherever
you drag it, including across the middle. That is engine behaviour and the game does not
reimplement it; the manifest's pointer line is worded to match ("start on your own side …
wherever you take it") because the earlier wording, "touch anywhere in the bowl", promised
something the shell does not do.

## Edge cases

- **Simultaneous input.** Both seats are read before either top moves, so neither can ever
  act on the other's post-step position. There are no turns and nothing is queued.
- **No input at all.** The dish pulls the two tops together within the first second and they
  clash, part, and clash again until the gauges run out. A match nobody plays ends 4–4.
- **A finger in the other seat's zone.** It belongs to the seat it started in. Engine.
- **A top exactly on the crest.** In. Out is `> radius`, one rule, no epsilon.
- **Both tops out in the same step.** A shared round, both paid.
- **A top thrown out on its last turn of spin.** Counted as a throw, not a run-down: the lip
  is tested before the gauges.
- **Stalemate.** Impossible by construction — see termination.
- **The launch.** Both tops are placed on one diameter from a single draw, so however the
  angle falls neither seat starts nearer the crest or with more spin. The *distance* is drawn
  per round from a band (130–225) and is the same for both. That band is not decoration: the
  bowl is a circle and every rule in it is the same in every direction, so a launch that only
  varied the angle produced the same round rotated — forty seeded bot matches finished within
  four steps of each other. Varying how far out the pair start varies the speed of the first
  clash, which is what actually makes one round differ from the next.

## Determinism

- **The dish is solved, not integrated.** The spring, the drag and a held direction are one
  linear ODE per axis, and `solveSpring` writes its exact solution over a step as a 2×2
  matrix. Two steps of `h` compose to the matrix for `2h` — asserted to twelve places, in all
  four damping regimes — so a 144 Hz laptop plays the identical match to a 60 Hz phone. An
  Euler or Verlet step does not have that property, and a bowl is exactly where it would
  show.
- **Contact impulses are targets, not repeated shoves.** Every impulse in `collideSpinners`
  either fires once (the pair is already parting fast enough afterwards) or is a velocity
  target that stops applying once reached, so nothing in a contact scales with the step rate.
  This is the one place the first build was genuinely step-size dependent.
- **Delays are counted in steps.** `RESET_STEPS` is 66 steps, not 1.1 seconds. Reaction lag
  and the coast horizon are in seconds because they multiply a velocity, which is the form
  that is step-size independent.
- **All randomness is seeded** and comes from `context.rng`: two draws per launch, one per bot
  per step. `botInput` draws **exactly once on every path**, including the paths that return a
  zero vector, so a bot that changes its mind cannot put two replays of one match out of step.
- Nothing reads the wall clock, the presentation, or the device.

## Termination

**A round cannot outlast the gauge, and a match cannot outlast seven rounds.**

Spin is never added by any rule in `rules.ts`; the only place it is restored is the relaunch
between rounds. Every live step charges at least `IDLE_WEAR` = 3 spin per second whatever
either player does — driving, grinding at the rim and clashing only add to it — so a gauge
starting at 100 reaches zero within **33⅓ seconds**, and `scoreRound` ends the round the
moment either gauge reaches zero. Nothing either seat can do extends a round: there is no
move that adds spin, no state that pauses the wear, and no position outside the wear's reach.
The award is 1 or 2 points, so at most seven rounds are needed to carry a seat to four. The
ceiling is therefore about **four minutes** of simulated play, against the guard's ten.

Two things this is deliberately **not** relying on: it is not a clock (nothing reads elapsed
time), and it is not the bots (the bound holds for two motionless players, which is the case
a bot-driven guard cannot reach). The weakest pairing is the one that finds a position
nothing resolves, so the guard plays `easy` against `easy`; measured, that pairing's longest
match of a hundred is **2599 steps — 43 seconds**. The slowest thing this game can do is two
untouched tops, at 4773 steps (80 s), and the slowest bot pairing is `hard` against itself at
3276 (55 s).

The first build had a genuine standoff and it is worth recording what it looked like, because
it terminated and was still broken: the two tops locked together at the centre of the bowl,
whirling at the speed cap, and every round ran the gauge to zero with the two spins within
half a turn of each other. Nothing resolved it; the clock merely expired. A termination proof
is necessary and not sufficient.

## Seat symmetry

The bowl is centred in a square box, every constant is shared, both tops launch on one
diameter at the same distance with the same spin, and every rule that names the two seats is
written to be antisymmetric under a half-turn about the centre — the bite reads the *sign* of
the spin gap rather than which argument came first, and the scrape throws each top along its
own side of one contact.

The result, asserted rather than argued: rotate the board half a turn, swap the seats, and it
is the same match. `game.test.ts` drives mirrored inputs into both seats for 306 steps and
requires `p2` to equal `p1` reflected through the centre to six decimal places in position,
velocity and spin; `rules.test.ts` asserts the same property separately for the spring step,
the clash and the scoring. Measured across the ladder, seat one wins 29, 24 and 22 of 50
mirror matches on `easy`, `normal` and `hard` — three coin tosses.

## The bot

`botInput` reads the two tops' positions and velocities, both spin gauges and the bowl, and
nothing else. Every one of those is drawn on the screen the player is looking at, and the
vector it returns is the same length a held stick produces, so it never drives harder or
faster than a person (CLAUDE.md rule 6). It acts on where the opponent **was** — position
minus velocity times its reaction delay — which is strictly less information than the person
opposite has, never more.

The tiers differ in reaction delay, steering noise, and judgement:

| | `easy` | `normal` | `hard` |
|---|---|---|---|
| Reaction delay | 0.30 s | 0.15 s | 0.05 s |
| Steering noise | ±0.42 rad | ±0.20 rad | ±0.07 rad |
| Turns back from the lip at | 0.88 R | 0.68 R | 0.50 R |
| Spin lead wanted before charging | −25 (charges anyway) | −8 | +25 |
| Rests inside | never | 80 units | 230 units |

The last two rows are judgement, not information, and in this economy they are the same
question as skill: `easy` charges unless it is a quarter of a gauge behind and never once
lets go of the stick, so it arrives at the round's decisive exchange with nothing left;
`hard` waits for a quarter of a gauge **in hand**, and rests whenever it holds the middle and
the other top is far enough off to be no threat.

"Far enough off" is judged half a second ahead rather than as the gap stands, and that detail
is worth its own line. Measured on the gap as it stood, the patient bot rested whenever the
opponent was a third of the bowl away — including when they were a third of the bowl away and
closing at 500 units a second — and it was thrown out of the bowl in **every single match it
played**. A top standing still is the easiest thing in the game to hit, because the whole of a
charge's speed goes into whoever is not moving.

### Measured win rates

`measure.test.ts` prints these; `game.test.ts` gates them. A hundred matches per pairing,
fifty in each seating, seeds 101…5050. **Measured, not estimated.**

| Pairing | Result | Rounds ended by a throw | Average match | Longest |
|---|---|---|---|---|
| `hard` v `easy` | **hard 100, easy 0** | 42% | 942 steps (15.7 s) | 1351 |
| `hard` v `normal` | **hard 100, normal 0** | 100% | 565 steps (9.4 s) | 891 |
| `normal` v `easy` | **normal 100, easy 0** | 0% | 1439 steps (24 s) | 1469 |
| `easy` v `easy` | seat one 29 of 50 | 0% | 2164 steps (36 s) | 2599 |
| `normal` v `normal` | seat one 24 of 50 | 0% | 2192 steps (37 s) | 2583 |
| `hard` v `hard` | seat one 22 of 50 | 0% | 2629 steps (44 s) | 3276 |
| nobody plays | **draw, 4–4** | — | 4773 steps (80 s) | — |

No match in any pairing failed to finish, and no round paid both seats a throw.

Two honest observations rather than a boast. First, **the ladder is steeper than most in this
repository** — the tiers are not 60/40, they are absolute. That is the economy rather than
the tuning: a bot that never rests cannot win the exchange that decides a round, and losing
that exchange loses the round however well it was driven up to that point. Second, the
throw rate is uneven across pairings because bot play is repetitive; `normal` against `easy`
never opens enough of a gap to throw anybody and settles every round on the gauge. Both
scoring paths are alive in play, and a person varies far more than a bot does.

## Presentations

The dish never rotates. An arena seen from above reads correctly from any side, which is why
this archetype suits a shared board, and the game never reads `presentation` — shared-screen
and single-seat are the same picture, drawn by the shell at different sizes. See
`docs/presentation.md`.

## Colour is never the only signal

Three signals name each seat and only one of them is colour: the **blade count** differs
(three against five), the seat colour differs, and the spin gauge is a **count of eight lit
ticks** around the top rather than a coloured bar. The board is readable in greyscale and by
anybody who cannot separate red from blue, and `game.test.ts` counts the blades to prove it.
The crest is drawn last, at exactly the radius `isOut` tests, so no top can ever cover the
losing line.

## What is not specified here

Art, audio and the licensed-asset entries; cross-device play and the fairness audit against
the harness; the tournament reporting the SDK does for us. The bot ladder's steepness is a
known and measured property rather than a defended one — softening it means changing the
economy, not the profiles, and that is a design decision nobody has asked for yet.
