# Basketball — specification

**Archetype:** `turn-aim` · **Category:** Sports · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions rather
> than anything the observed rule text settles. Every measured number below was produced by
> `src/measure.test.ts`, which both prints the figures and asserts the bands they sit in —
> run `npx vitest run packages/games/basketball` and read them off the console.

One fenced street court seen from above, one hoop standing on the halfway line, one ball.
Whoever's half the ball is lying in shoots at that hoop: a needle sweeps for the **line**, a
second needle runs out for the **range**, and the ball is in the air. Land it through the
ring and you score; miss short and it rebounds back to you for another go; miss long and it
rolls into the other half and the possession is over. Fourteen possessions, seven each.

## Observed rules

From the reference genre, verbatim (`docs/observed-rules.md`, row **Basketball**):

> _"Hoop! Take the ball when it's in your half of the field and shoot. Until the ball bounces
> off the ground, the opponent can't touch it!"_

That settles three things and no more: there is a **hoop** to shoot at, possession follows
**whose half the ball is lying in**, and a ball **in the air is untouchable**. Everything
else below is ours.

The third clause costs no code at all, and that is worth saying plainly rather than claiming
credit for it: nothing but the ball and the floor is simulated, so there is no opponent body
that *could* touch a ball in flight. The rule is true here by construction. What the clause
really decides is that the interesting moment is the one **after** the ball comes down — so
the rebound is where this implementation spends its rules.

## The shot model

A shot is **two presses and nothing else** **[ours]**, and no drag anywhere.

A drag hands a thumb a continuous quantity a key cannot match, and CLAUDE.md rule 10 says one
build serves every device. A press is one binary event with a timestamp on a phone, a
trackpad and a keyboard alike, and neither instrument can place it more finely than the
other.

Two presses because a shot needs two numbers, and they are polar coordinates with one dial
each:

1. **The line.** `aim` sweeps a triangle wave over ±`AIM_SWEEP` = 0.3 rad at 1.35 rad/s, so a
   crossing takes 0.444 s. It is measured **from the line to the hoop**, not from the court:
   `shotDirection` rotates the unit vector *toward the ring*, so a press dead in the middle of
   the sweep is a shot dead at the ring from anywhere on the floor, and the mirrored court
   gives an exactly negated direction with no `atan2` in between to round the two apart.
2. **The range.** `power` sweeps 0 → 1 of a gauge at 1.03 of the gauge a second, 0.971 s a
   crossing, and maps onto 180–700 logical units of **carry**. Absolute rather than a fraction
   of the distance to the hoop, deliberately: a fixed error in seconds is then a fixed error
   in units of carry from anywhere, while the same error on the aim needle opens out with
   distance — so a long shot is genuinely harder than a short one. A gauge scaled to the shot
   would have made every spot on the court the same shot.

The ball then flies for `0.22 + carry / 1300` seconds — 0.36 s at the near end of the gauge
and 0.76 s at the far end, so a long shot hangs longer — and comes down at the closed-form
landing point. Where it comes down is the whole of the judgement; there is no arc, no height,
and no collision loop. Both dials are **drawn as the shot they describe** — the line is a ray
from the ball and the range needle is a marker sliding up that ray — so nothing on the floor
has to be translated into a position by the player.

### One hoop, on the centre line **[ours]**

Two hoops at the two ends is what a real court has and it is the wrong shape for this device.
The board turns half a turn to face whoever is shooting, so the geometry has to be **its own
mirror image**. A hoop at the exact centre is. Two hoops at the ends are only if you also
swap which one each seat aims at — and then a miss that runs deep into the opponent's half
hands them a shot from the far side of the court, which pays for bricking. One hoop removes
the whole class of problem, and it makes `halfOf` — the observed rule — the only thing that
decides possession.

### A short miss comes back; a long one does not **[ours]**

The ring is a real object here rather than a radius test. A ball whose centre lands within
`MOUTH_RADIUS` drops through; one between that and `CLANG_RADIUS` has struck the ring and is
thrown **straight back out along the line from the hoop to where it struck**.

Land short of the hoop and that line points at the shooter, so the ball rebounds into their
own half and they shoot again. Land long and it points away, into the other half, and the
possession is over. That single asymmetry is the whole of the game's advice — **shade it
short** — and it costs no rule text at all, because it falls out of where the ball hit.
Nothing about it is random: two players who take the same shot get the same rebound, which is
what makes shading it short a skill rather than a hope.

A ball that missed the ring entirely (`brick`) never touched anything, so it keeps the line
it was on, including whichever way round the fence has already turned it.

## The court

Read out of `rules.ts`. Every value is a logical unit; nothing here is a pixel.

| | Value | Why |
|---|---|---|
| Court | 700 × 1000 | Portrait, halved across the middle |
| Fence | margin 40 | A ball never leaves; it bounces, so there is no out of bounds |
| Ball | radius 13 | |
| Reachable box | x 53–647, y 53–947 | Margin plus the ball, and symmetric under the half-turn |
| Hoop | (350, 500) | Dead centre, so the floor is its own mirror image |
| Ring | radius 56 | |
| **Mouth** | **43** = ring − ball | What a shot is actually judged against |
| Clang band | 43–69 | Struck the ring: thrown back out radially, scores nothing |
| Swish | within 20 | Nothing but net, and the score's fine resolution |
| Take-back arc | radius 300 | A rebound inside it is carried back out along its own line |
| Top of the key | (350, 800) and (350, 200) | Where every fresh possession starts |
| Aim needle | ±0.3 rad at 1.35 rad/s | 0.444 s a crossing; ±89 units at the ring from the key |
| Range needle | 180–700 units at 1.03 of the gauge a second | 0.971 s a crossing |
| Flight | 0.22 s + carry ÷ 1300 | 0.36–0.76 s |
| Roll | constant −520 units/s², closed form | Exact at any timestep; see **Determinism** |
| Clang roll | 200 + 0.2 × carry | Enough to clear the ring and the arc |
| Brick roll | 0.45 × carry | A ball that touched nothing keeps most of its pace |
| Ready freeze | 0.5 s | Longer than the shell's 0.36 s board flip |
| Settle | 0.45 s | The ball is left where it stopped before the court turns |
| Match | 14 possessions, at most 3 shots each | |
| Score | 2 for a basket, 3 for a swish | |

### The mouth is where the whole difficulty ladder lives

The quantity that decides everything is **how many seconds of press error the mouth is
worth**: the mouth divided by how fast a needle moves the landing point.

- **Range needle:** 43 ÷ (1.03 × 520) = **0.080 s**, at any distance, because the gauge is
  absolute.
- **Aim needle:** 43 ÷ (1.35 × *distance*) — **0.106 s** from the top of the key at 300 units
  out, falling to **0.080 s** at 400 units and 0.064 s at 500.

So a typical shot asks for both presses inside about a twelfth of a second, which is 4.8
frames at 60 Hz. **Four frames is the floor.** Below it the needle's own lattice is coarser
than the target and whether a shot goes in stops being a decision at all — Cup Pong records
the same trap and the same arithmetic. The price is a ring about twice a real one's size
relative to the court, and it is worth paying: shrinking it would move the three tiers into a
1.3× band that no amount of bot tuning could spread out again.

## Scoring and the win condition

`resolve({ kind: 'highest-when-time-expires' }, …, { timeExpired: true })` on **points**, and
when that returns `draw`, the same helper again on **swishes**. Never a hand-written
comparison: the helper is what makes "highest when the possessions run out" mean the same
thing here as everywhere else, and a level match a draw by the same definition.

A swish pays 3 and an ordinary basket 2, so the tiebreak is also a second gradient the aim
needle is already being played for rather than a separate mini-game.

**After a score, or a miss that ends the possession:** the ball goes to the other seat at the
top of *their* key, after the 0.45 s settle and the board flip. A change of possession always
restarts at the top of the key rather than leaving the ball where it stopped — otherwise a
seat could aim a *miss* to strand its opponent somewhere awkward, which is a game that pays
for bad shooting. **After a rebound the shooter kept:** the ball is played from where it
stopped, unless that is inside the take-back arc, in which case it is carried straight back
out along its own line — so the angle a rebound came off the ring at survives into the next
shot, and a ball trickling to a stop under the ring is never a free basket.

### What the tiebreak is actually worth, measured

400 matches a tier, both seats on the same tier:

| | level on points | still level after the swish tiebreak |
|---|---|---|
| easy v easy | 15.0% | **14.8%** |
| normal v normal | 6.5% | **4.5%** |
| hard v hard | 8.5% | **5.5%** |

Honestly: **it barely works at `easy`.** Two easy bots make 19.1% of about nine shots each,
of which 4.2% are clean — under one swish per seat per match — so when they finish level on
points they are usually level on swishes too. It does the job it was put there for at the two
tiers where there is anything to resolve, and at the bottom of the ladder a drawn match stays
drawn. That is a real limitation of a tiebreak built on a rarer version of the same event, and
it is recorded here rather than papered over.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere | tap anywhere |

Both instruments express the same two presses: the first sets the line, the second shoots.
There is no mode to switch between them and no state that remembers which one you used —
`#take` reads `input.seat(shooter).actionPressed`, which the engine raises for a bound key
*or* a pointer going down, and looks at the pointer's **position** nowhere at all.

**The two keyboard halves belong to two different people, and nothing remaps them.** This is
the one thing about the shell that is easy to get wrong here. When the turn changes,
`GameHost` calls `setSplit('shared')` and `setBoardSeat(activeSeat)` — that moves **pointer
ownership** so the whole surface belongs to whoever is shooting, which a turn game needs
because the court turns to face them and its far side would otherwise sit in the other seat's
zone. It does **not** touch `DEFAULT_BINDINGS`. Seat two's `Enter` never moves seat one's
ball, on seat one's turn or on any other. The manifest's keyboard line names each seat's own
key for exactly that reason, and `game.test.ts` drives both seats through a real
`InputManager` to prove it in both directions.

A press is refused during the ready freeze and while the board is part-way round, and is
accepted only from the seat whose possession it is (`press` checks `seat !== court.shooter`
first). Everything is completable from the keyboard alone and from the pointer alone.

## Edge cases

**Simultaneous input.** Cannot arise as a conflict: only the shooting seat's presses do
anything, and the other seat's are dropped by `press` before they reach a phase. Two fingers
in the same step are one `actionPressed` for one seat.

**No input.** The needles sweep for ever and the match does not end. `roundSeconds` is
advertising on the game card, not a clock the shell enforces, and there is deliberately no
shot timer: a timer would make the game about the timer, and the shell's pause and quit are
always available. A **bot** cannot stall — see the termination argument below — so no
unattended match hangs.

**Input in the other seat's zone.** There are no zones. The shell hands the whole pointer
surface to the active seat, and a tap deep in the far half is that seat's tap. This is
covered by a test, because the opposite arrangement is a known repeated bug: a divided
surface under a board that rotates makes the far half of the board untouchable.

**Boundary conditions.** A ball resting exactly on the halfway line is a held ball and goes to
whoever was **not** shooting — the one answer that survives the half-turn, since mirroring the
court swaps the seats and leaves the line where it was. A ball asked for its direction from
the exact centre of the ring falls back to a fixed unit vector rather than dividing by zero.
A shot that would land outside the fence is folded back in by reflection, as many times as it
takes; the fence is never an out-of-bounds.

**Stalemate.** There is none to have. Possessions strictly alternate and are capped, so
neither seat can be starved of the ball by an opponent on a run, and a possession is capped at
three shots so an endless string of offensive rebounds is impossible.

## Termination

Structural, and it needs two facts.

1. **A match is at most 42 shots.** `POSSESSIONS` = 14 strictly alternating, `shooterOf` is a
   parity of the possession number, and `SHOTS_PER_POSSESSION` = 3 is checked by
   `retainsPossession` before any rebound can extend a possession. Nothing a player does adds
   a possession or a shot.
2. **Every shot terminates.** The freeze, the flight, the roll and the settle are all finite
   countdowns; the roll in particular is a closed form with a known duration
   (`√(2 · distance ÷ 520)`) rather than an integration that might asymptote. The only phase
   that can wait indefinitely is `aiming`/`charging`, waiting on a press.

So the whole termination question reduces to **does a press always arrive**, and for a bot the
answer is structural: `driveBot` **counts down to a moment; it never watches for a position.**
Watching for a position is the obvious way to write it and it hangs — the press error is
added in whichever direction the needle happens to be travelling, so an error larger than the
gauge is out of reach *both* ways: the needle turns round at the end of its sweep and the
wanted value turns round with it, and the two never meet. A countdown cannot fail to expire.
It is also the more honest model of a person, who commits to a moment, and for whom pressing
late enough that the needle has turned round is a real way to miss.

Measured: the longest match out of 400 at each tier is 4255 steps (70.9 s) for two `easy`
bots — the weakest pairing is the slowest, because they miss more and a miss is a flight plus
a roll — against the shell guard's ten simulated minutes. `easy` averages 46.9 s, `normal`
42.6 s and `hard` 33.5 s. The suite asserts every tier's worst case stays under the
advertised 90 s round, and a separate test plays 40 `easy` v `easy` matches and asserts each
one reaches a winner.

## Determinism

The rules draw **no random numbers at all**; only the bots do, from seeded generators. Two
people playing each other run a fixed game, which is what makes "shade it short" advice
rather than superstition.

Three things needed care.

**Everything is a closed form of elapsed time, not an accumulation.** The roll walks an
analytic arc length rather than integrating a velocity; a per-step decay multiplier steps
differently at 60 and at 120 Hz and the two devices would drift apart by a frame's worth of
velocity at every bounce. Fence bounces are the same trick: bouncing between two walls is a
triangle wave of the straight-line position, so a whole flight or roll with any number of
bounces in it is one `foldInto` call rather than a collision loop. Tests compare a flight and
a roll at 60 Hz and at 120 Hz.

**A phase takes only the part of a step it needs and hands the rest to the next one.**
Consuming the whole step whichever phase was running would end the ready freeze a fraction
later on a slow device than on a fast one, and the needle a player is reading when input
reopens would be in a different place on the two. Every boundary lands where the clock says
rather than on the frame edge that noticed it.

**With one deliberate exception: the settle rounds up to a whole frame.** **[ours]** A flight
and a roll last however long the arithmetic says, so a shot *ends* part way through a step.
Carried into the next shot, the freeze would lift part way through a step too, and the sweep a
player is reading would sit at a different offset against the frames on every shot — the same
press timing would be a different shot each time. Worse, the offset a seat inherited came from
**whoever shot last**, so a bot's play became a function of how its opponent had been shooting
— exactly the coupling per-seat generators exist to remove, arriving by the back door. Ending
the settle on a frame edge costs at most one frame of a pause nobody is playing during, and
buys every shot in the match an identical needle. The remainder is dropped only *between*
shots; inside one, the freeze, the flight and the roll all still hand their unused time on.

A related trap, and a real bug that this spec's first draft would have papered over: `hold` is
walked down a step at a time, and thirty subtractions of a sixtieth leave it 1.04 × 10⁻¹⁶
**above** a step rather than exactly on one. Compared with `>` alone that reads as "a step
still to run", so the half-second freeze took 31 frames and handed the sweep a whole frame of
the last one — the needle was never once readable at the end of its gauge, which is the
position the bot's own arithmetic assumes it starts from. Countdowns now compare against
`dt + 1e-9`: eight orders of magnitude above the error and eight below a frame, so it can
only ever close that gap.

## The bot

**What it reads:** where the ball is lying, and where the ring is. Both are drawn on the floor
in front of both players, so CLAUDE.md rule 6 holds — it is told nothing a person cannot see
on the same screen. It has no choice of target (there is one hoop) so the only question it
ever answers is *how well are the two needles stopped*, which is also the only question a
person answers.

**How the tiers differ:** by how accurately a tier hits the moment it meant to, and by nothing
else. No tier is given information, speed or physics another lacks.

| Tier | Press error | Fumbles |
|---|---|---|
| easy | ±0.30 s | 16% |
| normal | ±0.20 s | 8% |
| hard | ±0.13 s | 3% |

A fumble multiplies the error by 5 on one of the two presses. Against the mouth's 0.080 s
window, the three tiers run from 1.6× to 3.7× — and every one of them is several frames wide,
so rule 6 holds by construction: none of these can stop a needle more finely than a hand can.

**The error is triangular, not flat** — two draws a needle, summed. Flat, the ladder has
almost nowhere to stand: a flat error either fits inside the mouth or it does not, with
nothing in between. It is also the better picture of a person — mostly close, occasionally
nowhere.

**Exactly six values a shot, drawn unconditionally before anything branches.** A conditional
draw count — one extra value only when there is a fumble — would make a seat's stream depend
on its own choices, and then on its opponent's through the shot count.

**A generator per seat**, both derived in `init` from the match's own before anything else
touches it. Cup Pong can get away with one shared stream because its turns strictly alternate
and cost a fixed number of draws; here a possession runs to one shot or three depending on how
the ball bounced, so seat two's draws would depend on how well seat one had been shooting and
its play would become a function of its opponent's. A test plays seat two against `easy` and
against `hard` from the same seed and asserts it takes the identical shots.

### Measured, 400 matches a tier and a pairing

Solo, both seats on the same tier (seeds `1000 + 17i`):

| Tier | shots/match | made | swish | points/match | match length avg / worst | seat-one share of decided |
|---|---|---|---|---|---|---|
| easy | 18.3 | **19.1%** | 4.2% | 7.8 | 46.9 s / 70.9 s | 46.9% |
| normal | 17.6 | **39.4%** | 10.0% | 15.6 | 42.6 s / 61.0 s | 50.3% |
| hard | 15.8 | **73.5%** | 22.9% | 26.9 | 33.5 s / 49.1 s | 48.1% |

Neither end of the court is worth anything: every equal-tier seat share is within 3.2 points of
even (46.9%, 50.3%, 48.1%), and shooting first is worth nothing.

Cross tier, both seat orders (seeds `500000 + 31i`), stronger tier's share of **decided**
matches:

| | stronger as p2 | stronger as p1 | mean | draws |
|---|---|---|---|---|
| easy v normal | 84.9% | 84.7% | **84.8%** | 7.0% / 5.0% |
| normal v hard | 94.1% | 93.7% | **93.9%** | 2.0% / 1.5% |
| easy v hard | 99.7% | 99.7% | **99.7%** | 0.8% / 0.5% |

The two seat orders agree with each other to within 0.4 points everywhere, which is what says
the ladder is measuring the tier rather than the chair it sat in.

**On saturation, honestly.** The top rung is *nearly* there: `easy` beat `hard` twice in 795
decided matches. A match sums fourteen-odd independent shots, so a per-shot edge of 19%
against 73% compounds into something a single match almost never reverses — the same effect
Archery measured, where the ladder saturated outright at 100% cross-tier. This one has not
quite: `easy` v `hard` is 99.7% and not 100%, and the two rungs that a player actually meets in
sequence, `easy` → `normal` (84.8%) and `normal` → `hard` (93.9%), are genuinely apart and
genuinely beatable. The figure quoted for the ladder is the mean over both seat orders of
every pairing, not a flattering slice of one.

## Presentations

Per `docs/presentation.md`, and decided by the SDK rather than here.

**Shared-screen:** two seats at one device. The court rotates a half turn between possessions
so whoever is shooting reads it upright, driven by `SeatFlip` from `seatView` — the one
definition of when a seat reads the board upside down. Human input is refused while it turns.

**Single-seat:** the local seat owns the whole viewport, always upright. `seatView` reports
**no rotation at all** here, which is precisely why the ready freeze lives in `rules.ts` and
not in `game.ts`: a freeze keyed off the flip would step one match on a phone playing remotely
and a different one on a phone passed across a table. A test drives the same seed through both
presentations and both local seats and compares the traces.

## Rule 7: never colour alone, and no text at all

A test asserts the renderer's `text` method is never called through a whole match.

- **Seat one is round and seat two is square, everywhere on the floor** — the possession pips,
  the shot clock and the landing marker all carry the shooting seat's shape.
- Each half is washed in its owner's tint, and each has its own key line drawn in that seat's
  colour, so "whose ball is it" is answered by the ground it stopped on — but the pips on the
  two baselines say the same thing by shape.
- A landing is a **double ring** for a swish, a **single ring** for a basket and a **cross**
  for a miss: three outcomes told apart by shape, with colour confirming what the shape
  already said.
- The ring, the mouth and the swish circle are all drawn at their real radii, so every rule
  that decides the match is a mark on the floor rather than something explained afterwards.
  So is the take-back arc.
- The shot clock is pips on the shooter's baseline only, because that is the one place it
  means anything; possessions used are pips on each seat's own baseline.

## Rule 8: no pixels anywhere

`rules.ts` holds the whole simulation in logical units and imports nothing from `game.ts`.
`game.ts` owns the seat flip, the palette and the drawing, and reads the simulation without
adding to it — a test renders forty frames and asserts neither needle nor the ball moved.
Nothing in the simulation or the drawing allocates per frame: the step result, the shot
direction, the take-back spot and the render's landing mark are all module-level records
written into, and `rules.ts` has no `new` in a hot path at all.

One honest exception, and it is the engine's rather than ours: `#shouldRotate` calls
`seatView`, which returns a fresh two-field record every frame. That is the shape of the
engine's own API and every turn game in the repository calls it the same way from `update`.
Worth writing down rather than claiming a clean sheet — if rule 5 is ever tightened to the
letter, this is the line it lands on, and the fix belongs in `seat.ts` for all of them at
once rather than here for one.

## What is not specified here

- **Audio.** No sounds are declared; there is no `assets.license.json` because there are no
  assets — the whole game is drawn from primitives.
- **Remote play.** Cross-device negotiation, the shared viewport and source-timestamp
  resolution are the shell's, per CLAUDE.md. Nothing in this game is same-class-only: a shot
  is two presses, which a thumb and a key place equally well, and the precision envelope is
  applied by the engine on the one pointer coordinate this game does not read anyway.
- **Tournament reporting, rematch, difficulty selection and the result screen** all come from
  the SDK; a bespoke version of any of them in this package would be a bug.
