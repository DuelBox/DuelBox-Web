# Sword Throwing — specification

**Archetype:** `turn-aim` · **Category:** Shooter · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions rather
> than the observed rule. Every number below was read out of `src/rules.ts` and `src/game.ts`
> or measured against the compiled `dist/` with throwaway harnesses; each measurement says
> how many seeds it used and what was driven, so any of them can be re-run.

Two fighters stand at opposite ends of a long arena, each with a rack of five targets behind
them and one sword in their hand. On your turn you pivot the sword and let it go; it flies a
straight line the length of the arena. **The moment it leaves your hand the arena belongs to
the other player**, who has about a second to carry the sword *they* are holding along their
guard line and meet the throw with it. A blade that gets there parries the throw dead; a
blade that arrives late watches it bury itself in a target. First to land five.

## Observed rules

From the reference genre, verbatim from `docs/observed-rules.md`:

> _"Draw your sword and throw it towards the targets of your enemy. Hold it in your hand and
> move it to parry your opponents throws!"_

That fixes four things and leaves everything else open: there is one sword and you throw it,
what you throw it at is the enemy's *targets*, the sword is **held** the rest of the time,
and **moving** the held sword is how you defend. It is unusually specific about the defence
for an observed rule — the parry is named as its own verb, with its own control — and that
is the thing the whole design is built around.

It says nothing about how many targets, how far apart anything stands, what a parried sword
does, what a landed sword does, how a match ends, or — the hard one — **how a turn-based
game gives the defender something to move in the middle of the thrower's turn.** All of
those are **[ours]**.

## The turn is two halves and they belong to different people **[ours]**

This is the decision everything else follows from.

A `turn-aim` game hands the whole board and both input families to one seat at a time, and
the shell decides which from `getActiveSeat()`. So the parry cannot be a thing the defender
does *during the thrower's turn* — there is no such moment. It has to be a turn of its own.

`activeOf` therefore returns **the thrower while a throw is being lined up and the defender
from the instant the sword is released**:

| phase | who may act | what they do |
|---|---|---|
| `aiming` | thrower | pivots the sword, then lets go |
| `flying` | **defender** | carries their own blade along their guard line |
| `settling` | defender | nothing; the arena is held for 0.5 s |

The seat therefore changes **exactly once a throw**, on the step of the release, and it is
already the next thrower by the time the arena changes hands — so the shell moves pointer
ownership once per throw rather than three times. A test counts the changes step by step over
six throws and asserts there are exactly six.

**Each half asks for exactly one number.** Where your sword points, or where your sword
stands. That is not minimalism for its own sake: it is what lets a keyboard and a finger say
the identical thing with nothing left over, which is the whole of rule 10 for a game whose
two halves are an aim and a chase.

**Your stance carries over, and nothing else does.** A blade moves only while its owner is
parrying, and a throw leaves from wherever the blade is standing. So chasing a throw to the
far side wins you the exchange and leaves you throwing the next one from the far side. That
single carried number is the entire strategic state of the match.

**You cannot parry with a sword you have thrown.** The thrower's blade is in the air, so it
is not drawn and it cannot be moved; `slideBlade` refuses for the thrower and a test drives
twenty steps of the thrower's own keys at it to prove the refusal.

## The arena

One frame, not two. Every position is in the **local** frame of the seat that owns it: `u`
across the arena, positive towards that fighter's own right, and `v` along it, positive
towards their own end. A seat's world position is `centre ± local`, so **one seat's local
frame is the other's negated**.

That is not tidiness. A mirror written as `WIDTH − x` is not exact in floating point — 700 −
0.1 is not representable — so mirroring twice does not return the number you started with,
and beach-ball and spin-war both found their two seats playing measurably different games
because of it. Negation is exact to the last bit, and a game that never leaves the local
frame never even has to negate: p1's throw and p2's throw are literally the same arithmetic
on the same numbers. The seat-symmetry tests compare with `toBe`, not `toBeCloseTo`.

| | Value | World y (p1 / p2) | Why |
|---|---|---|---|
| Board | 700 × 1000, portrait | | |
| Guard line `GUARD_V` | 260 | 760 / 240 | The two are 520 apart: 1.04 s of flight, the budget the parry lives in |
| Target row `TARGET_V` | 424 | 924 / 76 | Behind the fighter, so a throw passes the blade before it can score |
| Back wall `WALL_V` | 470 | 970 / 30 | Where a throw that beat the rack stops |
| Target slots | −260, −130, 0, 130, 260 | | Five, 130 apart |
| Slot jitter | ±12 | | Same nudge to both racks |
| Target radius | 34, capture 41 | | 48 units of clear gap between one capture circle and the next |
| Sword radius | 7 | | |
| Blade | half-length 34, reach 41 | | The held sword, lying across the guard line |
| Blade range | ±300 | x 50 … 650 | Covers every crossing point the rack can produce |
| Sword speed | 500 u/s, constant | | No power meter: a throw is one number |
| Blade speed | 250 u/s | | Identical for every tier and both seats (rule 6) |
| Aim cone | ±0.72 rad | | Reaches any target from any stance; 0.72 is 41° |
| Flight limit | 2.4 s | | Never reached — see Termination |
| Settle | 0.5 s | | |
| Throw cap | 44, both seats together | | The structural end |
| Starting stance | ±200, drawn per fighter | | See below |

### Only one rack is written down

`TARGET_SLOTS` holds five offsets and both fighters get them in their own local frame, with
**the same jitter draw applied to both**. A rack jittered independently would hand one player
an easier five than the other, which over a match is exactly the sort of bias nobody notices
and everybody feels.

### The number that decides how often a parry lands

`CROSS_FRACTION` is `2·GUARD_V / (GUARD_V + TARGET_V)` = **0.7602**: a throw is three
quarters of the way to the target it is aimed at by the time it passes the defender's blade.
So the point a throw has to be met at is

```
crossing = 0.7602 · target − 0.2398 · thrower's stance
```

and the arithmetic of the parry is a subtraction:

| | reaction | can travel in `1.04 − reaction` s | plus blade reach | **covers a blade within** |
|---|---|---|---|---|
| widest crossing | | | | 0.7602 × 260 = **198** |
| `easy` | 0.42 s | 155 | 41 | 196 — **−2** |
| `normal` | 0.26 s | 195 | 41 | 236 — **38** |
| `hard` | 0.15 s | 222 | 41 | 263 — **66** |

Read the last column as *how far off the middle of your guard line you may be standing and
still reach every target on the rack*. `hard` has 66 units of it, `normal` 38, and `easy`
has none at all — which is why `easy`'s measured parry rate is 11% and `hard`'s is 48%
without any tier ever moving its blade faster than any other.

**And it is why the game is about position rather than reflexes.** A throw is parried when
the last exchange left you near your guard and gets through when it left you out of it, and
the thrower can see exactly which. Moving `BLADE_SPEED` moves this and nothing else. Swept over 60
seeded matches a tier at each of three settings: 230 gives parry rates of 9 / 25 / 37 per
cent, 250 gives 12 / 29 / 48, and 270 gives 14 / 35 / 52 with `hard` matches running to 19
throws each. 250 is where the parry is a real threat at every tier without the best two
making the arena impassable; over the full 450 matches a tier reported below it settles at
11.2 / 28.8 / 47.5.

### Both fighters start somewhere different, and that is deliberate

The obvious thing is to give both the same starting stance, and it is wrong. A blade only
moves while its owner is parrying, so the two stances march in lockstep — and starting them
*equal* starts them in **opposite phases** of that lockstep, because the opening seat throws
first (`context.openingSeat`, which the shell alternates — #2466, #2487 — so over a best-of
it is not the same seat each time).
Measured over three independent families of 150 `hard` matches, seat one won **40.5%, 40.7%
and 39.5%** of the decided ones. That is not noise and it is not a difficulty ladder; it is a
seat advantage, and it was invisible in every other measurement.

Drawing the two stances independently scatters the phase, and how far they may scatter is
what is left to tune. The same three families give **44.4 / 40.9 / 41.7** per cent at a
spread of 120 and **46.5 / 46.3 / 45.1** at 200. It is still a fair draw — both come from the
same symmetric distribution about each fighter's own centre line — and a mirrored state is
still the same state.

## Scoring and the win condition

The score is **swords standing in the other seat's rack**, and there is exactly one place it
lives: `hitsFor` sums the rack rather than a counter kept alongside it. A struck target keeps
the sword and stays up **[ours]** — it is a target, not a thing to demolish, and a rack that
emptied would be a rack the defender could eventually cover completely. (The arithmetic, worked
before it was built this way rather than measured after: a rack of seven cut down to three
can leave three adjacent survivors whose crossings span 214 units, against `hard`'s 263 of
cover — an endgame that is a wall nothing gets through.)

Resolved by the shared `first-to` helper with a target of five, over
`{ p1: hitsFor('p1'), p2: hitsFor('p2') }`, with `timeExpired` set once `throws >=
MAX_THROWS`. Never by a comparison written here.

After a throw the arena is held for `SETTLE_SECONDS` and passes to the other seat, whose aim
starts from straight down the arena. Carrying an aim over would mean the second thrower
inherits a sight the first one set.

**A match ends only on a completed round.** `handOver` refuses to look at the win condition
unless `p1Throws === p2Throws`. p1 throws first, so ending the instant a seat reached five
would hand p1 every match that was going to be close; the reply throw is what makes throwing
first an advantage of tempo rather than of a whole turn. Two seats arriving in the same round
draw, which `first-to` decides once, the same way, for every game that uses it.

## Termination

Structural, and it has to be — nothing in the shell ends a match. `roundSeconds: 90` is
printed on the catalogue card and ends nothing.

Two fighters who never hit anything would otherwise throw for ever, so the cap is on
**throws**: 44 between them, 22 each, after which `timeExpired` is set and the match settles
on swords landed. `runs out of throws even when nobody ever hits anything` drives exactly
that, and `settles a capped match on hits rather than calling it a draw` drives the other
half of it.

**The arithmetic, multiplied out.** The longest a single exchange can take is the slowest
think plus the longest possible flight plus the settle. The longest flight is the back wall
at the widest aim: `(GUARD_V + WALL_V) / cos(0.72) / 500` = 730 / 375.9 = **1.942 s**, which
is why `FLIGHT_LIMIT_SECONDS = 2.4` is a backstop rather than a bound anybody meets.

```
44 × (1.15 s think + 1.942 s flight + 0.5 s settle) = 44 × 3.592 = 158 s
```

against the platform guard's 600 s ceiling, with 442 s to spare. A unit test does the same
multiplication from the constants and fails if it ever stops closing.

**Measured**, over 1350 seeded matches (three seed families of 150, three tiers, both seats
botted): every match finished, **not one reached the throw cap**, and the longest was 26
throws / 77.7 s at `easy` v `easy`. Per pairing:

| | reached the cap | longest match | avg throws |
|---|---|---|---|
| easy v easy | 0 / 450 | 26 throws, 78 s | 14.5 |
| normal v normal | 0 / 450 | 20 throws, 54 s | 13.0 |
| hard v hard | 0 / 450 | 22 throws, 53 s | 17.9 |
| any cross-tier pairing | 0 / 300 each | 52 s | 10.4 – 14.5 |

A human turn has no clock, so a human match is unbounded in wall time and bounded in throws
at 44 — the same answer the platform's own termination guard gives for a game that needs
input to progress.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard, your throw | `A` / `D` swing the sword, `Space` throws | `←` / `→`, `Enter` throws |
| Keyboard, their throw | `A` / `D` carry your blade | `←` / `→` carry your blade |
| Pointer, your throw | press, drag to point, lift to throw | the same |
| Pointer, their throw | slide your finger; the blade follows it | the same |

Both, always, with no mode to switch between them, and only when it is your half of the turn:
`#takeThrow` reads `input.seat(thrower)` and `#takeParry` reads `input.seat(defender)`, and
nothing reads the other. Twenty-three tests drive each clause through a real `InputManager` wired
the way `GameHost` wires it — shared split, `setBoardSeat(getActiveSeat())` every step — rather
than through a hand-made input object that could agree with the game about something the
engine does not.

**Nothing reads an up or a down key**, and the manifest string does not claim it does; a test
asserts the string mentions no such key. This game has one axis and says so.

**Left is left for both seats.** Seat two's arena runs the other way in its own local frame,
so a push to the right of the screen is a *negative* move in seat two's numbers — the two
facts are multiplied in `#lateralSign` rather than special-cased, and a test checks the world
x of seat two's blade decreases when seat two presses left. This is the convention every
real-time game in the collection already uses.

**The two instruments meet in the middle.** A finger names an angle directly through
`aimTowards`; the keys **walk** to it at `AIM_KEY_RATE = 1.05 rad/s`, so the centre of the
cone to either ±0.72 limit is 0.686 s of holding a key. There is no clock on a turn, so both
reach the same throw — a test drives the pointer to an angle and then walks the keyboard to
it and asserts the keyboard gets there, inside 1.5 s.

**And the finger is not allowed to be the better instrument at parrying.** A pointer that
named the blade's position outright would teleport it, which a key cannot do, so the blade
*follows* the finger at exactly `BLADE_SPEED` — the same cap a held key gets. A test walks a
finger 5000 units off the board and asserts the blade never moves more than `BLADE_SPEED ·
dt` in a step, and that it moved at all.

**A finger commits on release and a key commits on press**, and which applies is decided by
how the throw was *aimed*, not by what is present on the step it is committed. On the step a
finger lifts the pointer is already gone, so asking "is there a pointer now" takes the
keyboard branch and the throw silently never happens. Darts shipped that bug past its unit
tests; `#pointerAiming` is the same fix, and it is cleared on every hand-over because a fresh
turn is a fresh instrument.

## Edge cases

**Simultaneous input.** Only the acting seat is read. A test presses both seats' keys at once
and asserts the result is identical to pressing one.

**Input in the other seat's zone.** The engine owns this. The board is shared, `GameHost`
calls `setBoardSeat(getActiveSeat())`, and a pointer belongs to the seat it went down in for
as long as it is down. The game never reasons about zones. One consequence is worth knowing:
because the host moves ownership on the frame *after* the active seat changes, a finger
already resting on the glass when a throw is released still belongs to the thrower until it
is lifted. That is the platform's behaviour and the tests are written to it.

**No input at all.** The match waits, for ever, and that is deliberate. A silent human throws
nothing and the turn never passes. A bot in one seat never plays the other's turn — a test
drives 1800 steps with a bot in seat two only and asserts nothing is ever thrown, and another
asserts a bot in seat one throws exactly once and then waits.

**Boundaries.** The aim is clamped to ±0.72 and the blade to ±300, however long a key is held
or however far off the board a finger goes; a finger exactly on the hand leaves the sight
where it was; a finger behind the hand still cannot aim backwards, because the clamp is
applied to the angle rather than to the finger. Anything not finite is ignored before it can
reach the state.

**A throw that leaves the arena.** From an edge, thrown further outwards, a sword is over the
side before it reaches anybody's guard line. It is resolved as unparryable at the moment of
release — there is nothing left for the defender to do — and recorded as a miss.

**Stalemate.** The throw cap. There is no position from which a throw is impossible: the aim
cone reaches every target from every stance, which a test checks for all five targets from
five stances across the range.

**A zero-length step** moves nothing at all, which the fuzz storm reaches and a test pins.

## Determinism

- **All randomness is seeded.** `context.rng` only, drawn in `resetState` (seven values: five
  slot nudges and two stances) and in the two bot planners (two each). No `Math.random()`
  anywhere; lint enforces it.
- **The bot draws exactly two values per plan whatever it decides**, before anything branches
  on them. A plan that drew a different number when it blundered would put two devices out of
  step on the first unlucky throw and every throw after it. A test compares the generator's
  saved state against a counted one, for both planners and all three tiers.
- **The flight is analytic, not integrated.** Position comes from `elapsed`, not from the last
  position: `u = u0 + du · speed · t`. Constant velocity makes that the exact integral, so a
  step split in two gives the same answer as a step taken whole — asserted to nine decimals —
  and no number of steps can accumulate a different answer from another number of steps.
- **Targets are solved, not sampled.** A straight line against a circle is a quadratic and the
  smaller root is the moment of contact, so a 500-unit-a-second sword cannot step over a
  41-unit capture however coarse the step. A test throws with `dt = 0.2` — 100 units a step —
  and the target is still struck.
- **The parry is read at the instant of the crossing**, which almost never falls on a step
  boundary. The blade is interpolated between the two steps that bracket it, which is its true
  position because it moves at a constant rate inside a step whether a key or a finger is
  driving it. Reading it at the end of the step instead would make the parry depend on where
  in a frame the crossing landed — four units of blade against a 41-unit reach, which is small
  and is exactly the sort of small that decides a match once in fifty. A test runs the same
  sweep with the flight offset by a quarter of a step and asserts the answer does not move.
- **Countdowns are compared against a documented hair of slack.** Thirty subtractions of a
  sixtieth land about 1.4e-17 *above* zero, so a strict `> 0` spends one whole extra step on a
  delay that is arithmetically over. Basketball shipped a half-second freeze that took
  thirty-one frames for exactly this; both countdowns here (`think` and `react`) are whole
  numbers of steps at 60 Hz, which is precisely where it bites. `SPENT_SECONDS = 1e-9` is
  fourteen orders of magnitude above the residue and five below a step. A test asserts each
  tier's think takes `ceil(think / step)` steps exactly.
- **The sword's cosmetic tumble is kept inside one turn** rather than accumulating, so a long
  match cannot drift into the range where a float can no longer tell two nearby angles apart.
- **Nothing allocates in `update`.** The step result, the target search, the pointer's world
  position and both bot plans are preallocated module-level or instance-level records.

## The bot

It reads the rack, the other fighter's stance, its own stance, and the flight model. That is
precisely what is drawn on the screen in front of both players, and it is all it reads — no
future, no opponent's plan, no seed (CLAUDE.md rule 6). **Every tier carries its blade at
exactly `BLADE_SPEED`**; what a tier buys is judgement and reaction, never a faster arm.

**The error is drawn once and then acted on.** A fresh error every step averages to zero
sixty times a second and makes every tier identical — the mistake `bot-judgement` in the SDK
exists to document, made three times in this repository before it did.

### Throwing

Five candidates, one per target, scored by how far the throw would drag the other fighter.
The tiers differ in *what they measure that distance to*:

| judgement | tier | what it reads |
|---|---|---|
| `rack` | easy | the target's own position — the obvious thing, and wrong by a quarter of the thrower's stance |
| `crossing` | normal | where the throw would actually cross the guard line |
| `slack` | hard | that, less how far the blade can come in the time the throw takes |

The `rack` and `crossing` readings genuinely disagree: the middle of the rack and the middle
of the crossings are up to 72 units apart, so a blade parked between them looks nearest to
opposite ends of the rack depending on which you read. A test builds that arena and asserts
`easy` throws across it while `normal` and `hard` throw straight, for forty draws. The
`slack` term is a smaller correction — a few tens of units against distances of a few hundred
— and the test that pins it says so rather than pretending otherwise.

### Parrying

| judgement | tier | what it does |
|---|---|---|
| `chase` | easy | runs at the sword itself, which is behind where it needs to be the whole way |
| `intercept` | — | runs at where the sword will cross |
| `recover` | normal, hard | and **gives up on a throw it cannot reach**, resetting its guard to the middle instead |

`recover` was the single biggest correction this game needed, and the thing it buys is not the
throw it gives up on — that one was lost anyway — but the next one. A blade that chases an
unreachable throw all the way finishes standing exactly where that throw crossed, which is the
worst possible place to be for whatever comes next; the two seats then lock into opposite
phases of the same oscillation. Measured over 300 `hard` matches before the fix, seat one hit
68% of its throws and seat two 50%, and the parry rate sat at 19% against a 48% the geometry
says the same bots should reach.

Both planners stop moving once the sword is past the guard line, because there is nothing left
to parry.

| Tier | throw | parry | aim error | parry error | think | react | blunder |
|---|---|---|---|---|---|---|---|
| easy | `rack` | `chase` | ±0.075 rad | ±70 | 1.15 s | 0.42 s | 30% |
| normal | `crossing` | `recover` | ±0.032 rad | ±46 | 0.85 s | 0.26 s | 14% |
| hard | `slack` | `recover` | ±0.011 rad | ±13 | 0.62 s | 0.15 s | 5% |

A blunder multiplies both errors by 3.5.

**Where the ladder gets its room.** Two quantities, and both straddle their target rather than
sitting inside it. A target's capture circle is 41 units at about 690 away, so it is 0.060 rad
wide seen from the hand: the three aim errors are 1.25, 0.53 and 0.18 of that — wider than a
target, half a target, a fifth of one. And the parry errors of 70, 46 and 13 sit against a
blade reach of 41 — most of a blade out of place, a blade, a third of one. Had either ladder
sat entirely inside its target the three tiers would have been three spellings of "cannot
miss", which is what happened to Cup Pong before its geometry moved.

### Measured: what a throw comes to

1350 seeded matches — three independent seed families of 150, three tiers, both seats botted —
driven through the shipped `SwordThrowingGame` with a real idle `InputManager`. **Counted from
sampled state, not from the game's own record:** a hit is counted when a rack's own tally of
swords goes up, and a parry when a flight ends with the sword standing on the defender's guard
line and nothing in the rack having moved. That distinction is the point. A game whose
headline verb never happens still ends and still reports a winner, which is exactly how
spin-war passed all nine platform guards while being unplayable.

| Tier | throws | **struck the rack** | **parried out of the air** | missed |
|---|---|---|---|---|
| easy | 6450 | 3764 (58.4%) | **721 (11.2%)** | 1965 (30.5%) |
| normal | 5874 | 3937 (67.0%) | **1690 (28.8%)** | 247 (4.2%) |
| hard | 8064 | 4237 (52.5%) | **3827 (47.5%)** | 0 (0.0%) |
| **all** | **20 388** | **11 938 (58.6%)** | **6238 (30.6%)** | 2212 (10.8%) |

**4.62 parries and 8.84 hits in an average match.** Every throw is accounted for exactly once
— a test asserts `hits + parries + misses === throws` — and every one of the 1350 matches
finished.

`hard` missing the rack *zero* times in 8064 throws is the aim ladder doing what the table
above says: 0.011 rad at 690 units is 7.6 units of scatter against a 41-unit capture, so a
`hard` throw that is not parried always finds something. `easy` missing 30% of the time is the
same arithmetic from the other end.

### Measured: win rates, 300 seeded matches per ordered pairing

Seeds 40000–40299, shared-screen, both seats botted. Every match finished; none hit the 600 s
guard.

| pairing | p1 wins | p2 wins | draws | avg throws | avg match |
|---|---|---|---|---|---|
| easy v easy | 138 | 131 | 31 | 14.5 | 44 s |
| easy v normal | 1 | 298 | 1 | 11.2 | 32 s |
| easy v hard | 0 | 300 | 0 | 10.4 | 28 s |
| normal v easy | 295 | 1 | 4 | 11.3 | 32 s |
| normal v normal | 110 | 150 | 40 | 13.0 | 35 s |
| normal v hard | 16 | 276 | 8 | 14.0 | 36 s |
| hard v easy | 300 | 0 | 0 | 10.6 | 29 s |
| hard v normal | 246 | 9 | 45 | 14.5 | 37 s |
| hard v hard | 92 | 84 | 124 | 17.9 | 43 s |

Each pairing in both seat orders, 600 matches:

| | stronger tier | weaker tier | draws |
|---|---|---|---|
| normal v easy | **98.8%** | 0.3% | 0.8% |
| hard v easy | **100.0%** | 0.0% | 0.0% |
| hard v normal | **87.0%** | 4.2% | 8.8% |

**`hard` against `easy` is saturated**, and saying so is more useful than quoting a
flattering slice: 600 matches, 600 wins, not one loss and not one draw. It is not a defect —
the gap really is that wide, and the same 600 matches show `hard` v `normal` at a healthy 87%
— but a ladder that reads 100% cannot be used to detect a *further* improvement to `hard`,
and anyone tuning it should measure against `normal`.

The ladder is also ordered in tempo, not only in wins: a `hard` pair takes 17.9 throws to
decide a match where a `hard` against an `easy` needs 10.6, because two good defences make
every point expensive.

### Measured: seat balance

p1 throws first, so a bias here would be a real advantage. Three independent seed families of
150 matches, both seats on the same tier:

| Tier | family A | family B | family C | 300-seed run |
|---|---|---|---|---|
| easy | 47.0% | 51.8% | 46.2% | 51.3% |
| normal | 40.7% | 46.2% | 46.8% | 42.3% |
| hard | 46.5% | 46.3% | 45.1% | 52.3% |

(p1's share of *decided* matches.) The honest reading: it sits a little under half — the mean
of the twelve figures is 46.9% — with individual families ranging from 40.7% to 52.3%, which
is about what 120 decided matches can resolve (one standard error is 4.6 points). Two earlier
versions of the game had a bias here that was much larger and entirely reproducible: 39–41%
from the shared starting stance, and a 68%-versus-50% split in *hit rate* from the chasing
parry. Both are described above and both are gone. What is left is at the edge of what this
many matches can distinguish from noise, and it is reported rather than rounded off.

The suite asserts the share stays between 25% and 75% over 40 matches a tier — a loose bound
deliberately, because 40 matches cannot support a tight one.

**Draws are a real result, and at `hard` they are 41% of matches.** They are the completed-
round rule converting a tempo advantage into a shared result, which is precisely what it is
for: at `hard` a throw is parried nearly half the time, so both fighters arrive at five in the
same round often. It does not reach a player — `modes` is `friend` and `bot`, so two bots only
ever meet in this table.

### Measured: cost

There is no search here — five candidates, once a turn — so the bot is free. Worst single
`update` over 52 379 steps of `hard` versus `hard`: **0.241 ms** against a 16.7 ms frame, mean
0.2 µs. `bot-cost` re-measures it against a calibrated ceiling and passes.

## Presentations

Per `docs/presentation.md`, and the game decides neither.

**Shared-screen: the board does not turn.** This is the one place this game departs from the
usual `turn-aim` idiom, and it departs deliberately. A turn-based *board* rotates because both
players need to read the same board upright; this is not a board but an arena, and each
fighter's own end is already nearest them. Turning it to face whoever is to act would take
that away from the other player twice a throw — and it would put a 0.36 s flip, with input
suppressed, directly on top of the 1.04 s the defender has to parry. There is nothing to gain
and a third of the defence to lose.

**Single-seat.** The local seat owns the viewport, so the board is turned exactly when the
local seat is p2 — a single `pushSeatRotation`, decided once in `init`, never per turn. The
keyboard's lateral sign is turned with it, so left is still left.

Rules and simulation are byte-identical across the two: a test drives the same seed through
both with bots in both seats and compares the flight and both blades every step for 900 steps,
with `toBe`.

The shell owns the HUD, the countdown, the turn indicator and the result. The game draws no
text of its own — a second scoreboard disagreeing with the first is what that would be — and a
test renders 600 frames into a recording renderer and asserts its `text` method was never
called.

## Rule 7: colour is never the only signal

Every player-owned thing carries its seat in shape as well as colour, so the arena reads in
greyscale:

- **p1's targets are round and wear a ring; p2's are square and wear a cross.** Two racks
  facing each other down an arena are the pair most likely to be confused.
- **p1's sword has a round pommel, p2's a square one**, on the same steel blade — so which
  guard line is yours is legible even at the moment both are moving.
- **The sword of the seat that has thrown is simply not there.** Whose turn it is, and who has
  nothing to defend with, is carried by presence rather than by tint.
- **The score is drawn on the board**: the swords standing in a rack are the other player's
  tally, in their own colour and their own count, up to three per target.
- **The sight** is a line of dots along the first 0.3 s of the flight, growing along its
  length — enough to read the line, not enough to aim for you — and it stops at the edge of the
  arena rather than drawing outside it.
- **Throws left in the match** are a bar on the centre line, one object shared by both players.
- The flash after an exchange is drawn in the colour of whoever won it, around the whole arena,
  and is redundant with the sword that did or did not land.

## What is not specified here

- **Audio.** No sounds are specified or implemented. The SDK's audio layer is not wired in for
  this game.
- **Reduced motion.** The 0.45 s flash after an exchange is the only motion the game adds
  beyond the simulation; how it responds to `prefers-reduced-motion` is the shell's decision
  and is not made here.
- **Tournament weighting.** `roundSeconds: 90` is what the catalogue advertises. Measured
  bot-versus-bot matches run 28 s to 44 s on average and 78 s at the longest; a human taking
  their time is unbounded, since a turn has no clock. Whether the advertised figure should
  track the measurement is a catalogue question rather than a game one.
- **Whether the last four points of seat balance are real.** The mean over twelve independent
  measurements is 46.9%, and it would take a few thousand matches a tier to say whether that is
  a residual advantage to the second thrower or nothing at all. The two large biases that were
  found have been removed and described; this one is below the resolution of what has been run.
- **A parried sword does nothing but stop.** Deflecting it back down the arena, where it could
  strike the thrower's own rack, is the obvious next mechanic and would make the parry pay
  rather than merely deny. It is not implemented: it would double the flight model, and it
  would need the whole parry ladder above re-measured against it.
