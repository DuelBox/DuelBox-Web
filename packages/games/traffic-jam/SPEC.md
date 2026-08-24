# Traffic Jam — specification

**Archetype:** `rt-race` · **Category:** Puzzle · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~20 s typical, 110 s hard ceiling

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

The third `rt-race` game in the catalogue and the first that is not a race at all. Racing Cars
and Road Dodge each give a seat its own road and its own window on it; the two players never
touch. This one is the opposite: **one island, one board, two cars that can hit each other**,
and the whole game is what happens when they do.

## Observed rules

> "Crash your opponent and be careful not to fall into the water! Use the joystick to steer."

One sentence, and it fixes four things and no more: there are two cars, they can crash into
each other, there is water they can fall into, and the instrument is a **joystick** — a
direction, not a tap and not a point on a map. Everything below is **[ours]**.

Three of those four are worth restating as design constraints, because they rule things out:

- **"Crash your opponent"** rules out two separate lanes. The cars must share a board.
- **"Fall into the water"** rules out a bounded arena you bounce off. The edge is fatal.
- **"Use the joystick"** rules out "tap where you want the car to go". A joystick names a
  direction and holds it, which is exactly what a keyboard also does — see _Controls_.

## The island

The simulation works in **junction-centred** coordinates: the origin is the middle of the
crossroads and +y runs towards the near seat. The renderer adds (300, 500) and does nothing
else — there is no scale factor, because the island was sized in the units it is drawn in.

| | Value | Why |
|---|---|---|
| Carriageway half-width `BAR` | 120 (240 across) | Four car widths. Two is too narrow to be shouldered off in; six is a field |
| Main road half-length `ARM_Y` | 462 | The long axis of a portrait box, less a margin for the kerb |
| Side road half-length `ARM_X` | 268 | The short axis, same margin |
| Car | disc of radius 30; drawn 72 × 50 | The losing line is "where is its middle", which is the one point of a car a player can judge exactly |
| Flood minimum | `MIN_ARM` 18, `MIN_BAR` 18 | `hypot(18, 18)` = 25.46 < 30, which **is** the termination proof — see below |
| Flood duration | 20 s | About three passes down the main road at cruising speed |
| Start | 330 along each arm, ±46 across, one seeded draw | Far enough out that the flood is what closes a bout; offset so a bout never opens with a dead-straight head-on |
| Drive | 900 units/s², grip 3.0/s → **cruise 300 units/s** | |
| Lateral grip | 2.4/s | A shove at cruising speed slides **125 units**, a little more than the 120 from centre line to kerb. A hit taken in the middle of the road is survivable; the same hit taken in the outside lane is not |
| Turn rate | 3.4 rad/s | Turning circle 88, so a U-turn needs 176 of a carriageway's 240 — possible on a full road, impossible once the flood has taken a third of it |
| Speed cap | 900 units/s | One step covers 15 against a contact distance of 60: four steps of margin against tunnelling |
| Ram restitution | 1.0 | Equal masses swap the normal component. The mechanic *is* the transfer, so it is not damped |
| Lorry | 116 × 44, 240 units/s, restitution 0.2 | |
| Traffic spawn | first at 1.6 s, then 2.9–5.1 s | ~1.5 pairs in a typical bout |
| Splashes to win | 3 | |
| Settle after a splash | 72 **steps** | Counted in steps, not seconds, so it is the same countdown on every device |
| Round clock | 110 s | The backstop, not the mechanism |

### The plus is its own half turn

`onRoad` is the union of two axis-aligned bars through the origin, so the board is exactly
invariant under (x, y) → (−x, −y). Start positions are `(s, 330)` and `(−s, −330)` from **one**
draw. Traffic arrives in mirrored pairs (below). Nothing anywhere is asymmetric, so seat
fairness is a property of the geometry rather than something tuned into it — and
`rules.test.ts` checks it over a lattice at eleven flood levels rather than at four corners.

### The traffic

Lorries run the two carriageways in **180°-symmetric pairs**: one enters at the far end of a
road and its twin at the near end of the *same* road in the opposite lane, driving the other
way. The twin is precisely the first lorry rotated half a turn about the junction, so the
whole board — cars included — is its own half turn at every instant of every bout. That is
stronger than "both seats draw from one sequence", because there is only one sequence and only
one board. `rules.test.ts` walks a full sixty-second bot match asserting every live lorry has a
twin at the exact negation of its position and velocity.

Lanes are drawn against the *current* road width, so the two of a pair never overlap and
neither is ever half over the water at the moment it joins. **Roughly two spawns in five leave
no gap a car can fit through** — 44-unit lorries at ±lane on a 240-unit road — and the answer
then is the other carriageway, the junction, or taking the hit on purpose to put your rival in
the water. That is the puzzle the game is named after.

A lorry has no mass in the equation: it is never moved, slowed or turned. A car receives the
closing speed *relative to the lorry*, so being caught by a moving one is very different from
driving into a parked one, and a car running alongside at the same speed is not hit at all.
Traffic stops joining once the flood has narrowed the road below 70 (two lanes no longer fit);
lorries already running are seen out.

### The flood — and why the match cannot hang

The island shrinks linearly over `FLOOD_SECONDS` = 20 s. At full flood every point still on the
road is within `hypot(18, 18)` = **25.46** units of the junction, which is less than the car's
radius of 30. Two cars that are not overlapping stand at least 60 apart, so at least one of
them is at least 30 from the origin — and that one is off the road. `stepMatch` resolves the
car-to-car overlap **immediately before** it tests the road, precisely so those two facts meet.

So: **once the flood is full, every single step puts somebody in the water.** A bout cannot
outlive 20 s. `rules.test.ts` exercises it rather than arguing it — forty placements at full
flood, each of which must splash on the very next step — and separately drives twenty-four
seeds of the least-likely-to-resolve pairing (both cars aimed straight at each other's start)
and requires a bout to end inside the cap.

## Scoring and the win condition

**Score is splashes caused: the number of times the *other* car went in.** Resolved by the
SDK's `resolve()` with `{ kind: 'first-to', target: 3 }`, with `timeExpired` set once
`ROUND_SECONDS` is out — so "first to three", "both got there on the same step is a draw" and
"level when the clock runs out is a draw" mean here exactly what they mean everywhere else.

**A splash always scores for the other seat, whatever put the car in.** Blame is tracked — the
rival, the traffic, or nobody, from the last contact above 90 units/s of closing speed within
the last 1.6 s — but only for the picture and for the balance harness, never for the
scoreboard. A rule that had to decide whether a lorry counted would then have to decide who
nudged whom into the lorry's path, and that question has no clean answer. It also makes the
traffic a *weapon*: shouldering your rival into a lorry's lane is a legitimate way to win, and
one of the better ones.

After a splash the board is **held where it stands** for 72 steps — so the last thing a player
sees of a bout is how it was lost — with the losing car sinking and the water receding back to
the kerbs. Then both cars go back on their marks, the roads are cleared, and the next bout
starts.

### How the match is guaranteed to end, multiplied out

Every bout awards at least one point, and 3 points takes at most five bouts (2–2, then one
more). Five floods and four settles:

```
5 × 20 s  +  4 × 72 steps ÷ 60  =  100 + 4.8  =  104.8 s
```

`ROUND_SECONDS` is **110**, so the clock is above the worst case the rules can produce rather
than a number that truncates a legitimate match — and 110 is well under the 600 s
`termination.test.ts` allows. `rules.test.ts` does that multiplication as an assertion so it
cannot drift.

**Measured**: over 900 self-play bot matches, none ran past 40.7 s and none was unfinished.

| Tier | median | p90 | longest match | longest bout | bouts/match |
|---|---|---|---|---|---|
| easy | 13.7 s | 18.4 s | 24.2 s | 8.2 s | 4.12 |
| normal | 18.1 s | 23.9 s | 30.5 s | 9.3 s | 4.10 |
| hard | 23.6 s | 30.6 s | **40.7 s** | **14.0 s** | 4.08 |

The manifest advertises `roundSeconds: 45` on the catalogue card, which sits between the
hardest tier's p90 and its longest.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Player one | Press anywhere in the **lower** half and drag; the car turns the way you drag | `W` `A` `S` `D` |
| Player two | Press anywhere in the **upper** half and drag | `←` `→` `↑` `↓` |

**A floating stick.** The point the finger lands on is the base, wherever in that seat's own
half it happens to be, and the direction is the drag away from it. That is the joystick the
observed rule names, and it is the only idiom that works here: an absolute "drive towards my
finger" cannot ask for a direction the seat's own half does not contain, so a player whose car
had crossed the midline could never steer it back. (Sumo Push, which does aim absolutely,
has exactly that hole.)

**Length is read only against a 14-unit deadzone.** Past it, a nudge and a full sweep say the
same thing — `game.test.ts` asserts the two land on the identical heading. That is what makes a
thumb worth precisely what a key is worth: both name a direction and nothing else, and both
turn the car at exactly `TURN_RATE`. There is no press to repeat, so there is nothing a
keyboard can repeat faster; the manifest therefore does **not** declare `sameInputClassOnly`,
unlike Road Dodge.

**Neither seat's input is mirrored, and that is the point.** The board is shared and the far
seat reads it upside down, so what both players actually see is a thumb and a car moving the
same way across the same glass. A mirror would make the near seat's thumb agree with the
picture and the far seat's disagree with it. `game.test.ts` drives both seats' drags through a
real `InputManager` and asserts they answer alike.

**A finger down wins over a held key.** A player with a thumb on the glass is steering with the
thumb, and a stick inside its deadzone is that player saying *hold this line* — a real answer
rather than an absence of one. With no finger the keys have it; with neither, the car keeps
driving the way it was pointed, because a car in this game is never not moving.

Every clause above is driven through the real `InputManager` in `game.test.ts` rather than read
off the manifest and believed: all four of each seat's keys, in both seats, with the turn
measured against `TURN_RATE`; a press in each half; a drag that crosses the midline; the
deadzone from both sides; a finger lifted and replaced.

## Edge cases

- **A touch in the other seat's half.** Belongs to whoever put it down there. The engine's
  `PointerOwnership` decides that and a drag keeps feeding the seat it started in however far
  it travels — the game never sorts pointers itself, and a test drags from (500, 900) to
  (100, 100) to prove the far seat is untouched.
- **A finger the browser reports off the board.** The direction is still a direction, so it
  steers; the *drawn* stick is clamped into the box so a thumb on the bezel still shows one.
- **A direction that is not a number.** `turnToward` holds the current heading. The guard is at
  the one door every source of steering goes through, not at each call site.
- **A direction longer than any instrument could produce.** Only its angle is read, so
  `(900, 0)` and `(1, 0)` are the same ask — asserted.
- **Two direction keys at once.** The engine normalises the movement vector; a diagonal is a
  diagonal, not a faster turn. Two keys never out-run one.
- **Both cars going in on the same step.** Scores for both, decided after both have been
  stepped, so it is not settled by whichever seat the loop ran first. At 2–2 a double splash is
  3–3, which `resolve` calls a draw.
- **A car pinned against a lorry.** The lorry keeps moving and the depenetration carries the
  car with it — a lorry bulldozes. That is the intended behaviour and it is also why the
  car-to-car pass runs *after* the lorry passes: the termination guarantee needs the two cars
  to be genuinely a diameter apart when the road is tested.
- **A car resting exactly on the kerb.** On the road. The test is strict, so a car does not
  drown and revive on alternating steps.
- **No input at all.** Both cars drive themselves straight off their own arms in about a
  second and a half. This is the shortest possible match and it still terminates cleanly.
- **A pause mid-drag.** Both sticks are dropped. The engine has already forgotten its pointers,
  so a base latched from before the pause would be measured against a finger that landed
  somewhere else, and the car would jerk on the first step back. Momentum is state rather than
  intent and survives untouched.

## Determinism

- Every start offset and every lorry comes from the seeded generator. **Three floats on every
  spawn tick and two on every bot look, whatever comes of them** — a stream whose length
  depends on the state of the board is a stream two otherwise identical matches can fall out of
  step on. `rules.test.ts` counts both.
- Nothing reads a clock. The whole simulation is a function of (state, two directions, delta).
- **The car integrator is analytic, not Euler.** Forward speed relaxes towards cruise and
  sideways speed decays to nothing, both with their exact integrals, so a second of driving
  covers the same ground at any step size — asserted to ten places for a car that is not
  turning, which is every straight, every slide and the whole of every collision.
- **The heading is taken at the middle of the step, not at its start.** Half the turn, then the
  translation, then the other half. Two half-turns compose to exactly the whole turn, clamping
  included, so the heading itself is unaffected — but the frame the translation is integrated
  in is now the one the car was in half-way through the step, which makes the scheme second
  order. **Measured**: a standing U-turn lands 60 Hz and 120 Hz **0.0097 units** apart on a body
  60 units across, and ten seconds of weaving lands them 0.0078 apart. Taking the heading at
  the start of the step instead — the obvious way to write it — measures **2.58** on the same
  U-turn. Two hundred and sixty times better for one extra function call.
- The settle is counted in **steps**, not seconds, so it is the same countdown everywhere.
- `cross-viewport.test.ts` steps the identical trace at five viewports from 320 px to 4K and
  compares raw floats.

## Seat fairness

- **One board, not two mirrored halves.** There is nothing to keep in agreement.
- **`rules.test.ts` — "is its own half turn, point for point"**: `onRoad`, `marginOf` and
  `towardSafety` all checked over a lattice, at eleven flood levels.
- **"holds the board as its own half turn for a whole bot match"**: every live lorry must have
  a twin at the exact negation of its position and velocity, on every step of a full match.
- **"gives the mirrored duel the mirrored result"**: six seeds, two matches each, the seats'
  steering swapped and negated, compared every step for three hundred steps. Approximate rather
  than exact, and honestly so — `cos(h + π)` is not bit-for-bit `−cos(h)`.
- **Measured**: over **2,691 decided self-play matches** across three independent seed families,
  p1 takes **49.6%**. Per-family slices run 46.2%–56.3%, which is the spread you should expect
  from 300 matches and is exactly why three families are reported rather than one.

| Tier | p1 share | family A | family B | family C |
|---|---|---|---|---|
| easy | 51.1% (458/896) | 49.7% | 47.3% | 56.3% |
| normal | 48.8% (438/897) | 48.2% | 46.2% | 52.2% |
| hard | 48.8% (438/898) | 46.3% | 49.7% | 50.3% |

## Does the headline verb actually happen?

Spin War shipped with its core mechanic impossible and a fully green suite, because a suite
checks that a match *ends* and *scores*, not that it plays the way its name says. So this is
counted, in `rules.test.ts` ("the headline verb") and again end-to-end through the `Game`
contract in `game.test.ts` with a human thumb and with a keyboard.

**Measured over 900 self-play bot matches** (3,728 splashes in total):

| Tier | rams / match | rival splashes / match | rival | traffic | own mistake |
|---|---|---|---|---|---|
| easy | 1.8 | **0.99** | 24 % | 16 % | 61 % |
| normal | 3.9 | **1.36** | 33 % | 30 % | 37 % |
| hard | 5.9 | **1.16** | 28 % | 47 % | 25 % |

A "ram" is a car-to-car contact above 90 units/s of closing speed; a "rival splash" is a car
that went into the water with the rival as the last thing to have hit it. **Better than one a
match at every tier**, and roughly one ram in three ends with somebody wet.

The one honest caveat: at the `hard` tier the traffic accounts for more splashes (47 %) than
the rival does (28 %). Two very good drivers make few mistakes of their own, so what is left to
separate them is the lorries — and the lorries are the same lorries for both of them, at the
same instant, rotated half a turn. It is noise, but it is *symmetric* noise, and a looser
measure agrees the rival is usually involved: **87 %** of `hard`-tier splashes had the other
car within 96 units at some point in the preceding 1.6 s.

`game.test.ts` closes the loop with two tests a bot cannot fake: a human thumb dragging towards
the rival, through a real `InputManager`, must both make contact and put the other car in the
water; and the same with the four keys.

**Independently re-measured with a stricter attribution.** The table above blames whichever car
last hit the victim above 90 units/s, which `collideCars` marks on *both* cars — so a car that
rams and then drives itself off is counted as a rival splash, and a later lorry graze overwrites
the blame the rival earned. A second pass instead recovers the real contact normal from the
post-step positions and counts a splash only when the car-to-car impulse pushed *that* car along
its outward direction inside the last 1.6 s. Over 1,200 fresh seeded matches (400 per tier):

| Tier | rival splashes / match | share of all splashes | matches with at least one |
|---|---|---|---|
| easy | 0.92 | 22.2 % | 67.3 % |
| normal | 1.29 | 31.5 % | 75.8 % |
| hard | **1.82** | **43.6 %** | **88.5 %** |

The stricter measure is *higher* than the loose one at `hard` (43.6 % against 27.9 %), which
retires the caveat above: the traffic gets the blame field because it touches the car last, not
because it caused the splash. The headline verb happens more than once a match at every tier.

## The bot

It reads three things, all of them on the screen in front of both players: the island as it
stands, the lorries, and where the rival was `reaction` seconds ago. It has no lookahead into
the generator, no knowledge of what the other seat is asking for, and no way to turn faster
than `TURN_RATE`, because there is no such way.

Its decision is three lines in order of urgency:

1. **Am I about to be in the water?** Judged from where the car will be in 0.6 s, not from
   where it is — which is what a person means by looking ahead, and the only way a car doing
   300 units/s can act on a kerb 58 units away. If so, drive for the middle of the road, unless
   the rival is even further gone (a bot on the brink that charges a rival a hair further out
   takes a double splash, which scores for both seats).
2. **Otherwise, get outside them.** It aims not *at* the rival but at the point a car's width
   to the rival's safe side, so arriving means being between them and the middle of the road
   with the water beyond. That is the whole tactic of the game in one vector, and it is why a
   bot match produces rammings rather than two cars nudging each other in the junction.
3. **Is there a lorry in the way?** Bend away from the nearest one within 175 units, harder the
   closer it is.

The 0.6 s look-ahead is **identical for all three tiers**, deliberately: it is not a handicap
but the shape of the judgement every driver makes, and a tier that could see further would be
reading something off the board a person cannot.

| Tier | Reaction | Waver | Steering error | Beats the tier below |
|---|---|---|---|---|
| easy | 0.34 s | 0.30 | 0.55 rad | — |
| normal | 0.20 s | 0.20 | 0.32 rad | **78.8 %** vs easy |
| hard | 0.05 s | 0.05 | 0.07 rad | **66.0 %** vs normal, **90.0 %** vs easy |

Measured over 400 matches per pairing, in **both seat orders**: an ordering that only holds for
whoever happens to be p1 is not an ordering, it is a seat advantage. Three fields and no more —
`rules.test.ts` asserts the profile has exactly those keys, so a tier cannot quietly acquire a
faster car.

Two notes worth carrying to the next bot:

1. **Reaction does double duty**: it is both how long the bot holds a stale answer and how
   stale the rival's position it acted on was. They are the same fact about a driver, and
   splitting them into two constants would have been two knobs describing one thing.
2. **Both draws are taken on every look, used or not.** Racing Cars learned this from Fruit
   Duel, which gave p1 thirty wins in forty from exactly this.

## Presentations

- **Shared-screen** — one board, drawn once, read from both ends of the device. The play area
  is **not** rotated: a shared physical arena is meant to be read from both sides, and rotating
  it would show one player the board and the other the back of it. The pointer *surface* is
  split horizontally, which is what the manifest declares and what the controls say.
- **Single-seat** — the identical picture. **Nothing in this game reads the presentation or the
  local seat**, which is the point: rule 10 is kept by there being no branch to get wrong
  rather than by branching correctly. `game.test.ts` plays three hundred steps under both and
  compares the two frames call for call.

Rule 9 is true by construction: there is one board and both seats see all of it.

## Rendering

The interpolation `alpha` is deliberately not read: both cars, every lorry and the water's edge
are continuous values the simulation already carries at full resolution, so a frame is the
state as it stands rather than a guess between two of them.

Both carriageways are laid down twice — once oversize in kerb white, once at true size in
tarmac — so the bright edge that appears is exactly the outline of the union of the two, and
the losing line a player reads is the line `onRoad` tests. Tracing that outline by hand would
mean getting six corners right as the flood moves them.

Rule 7, four times over:

- Player one's car carries a **chevron** pointing the way it faces; player two's carries **two
  bars** across the roof. `game.test.ts` puts both cars in the same attitude and compares their
  markings shape for shape relative to their own centres — the chevron arms slope, the roof
  bars are exactly perpendicular.
- Both cars carry a bone-white **nose bar**, so which way a car is pointing never depends on
  telling two colours apart.
- A car in the water **shrinks, gains ripple rings and is struck through**, rather than turning
  a different colour.
- A lorry is a pale slab with a **dark cab at the end it is driving towards** and three hazard
  bars down its back, so which way it is going reads in silhouette and it can never be mistaken
  for a car.
- The box junction is **hatched**, not tinted, so the middle of the island is still the middle
  of the island in greyscale; and a thin ghost outline shows the road the flood has already
  taken.

The wave rows on the water are laid down **in mirrored pairs either side of the junction**, so
the sea is invariant under the same half turn the island is and the far seat is looking at the
same water rather than at different water. Their stagger is taken from the row index: reading it
off `y` — `(y / 52) % 2 === 0` on rows starting at 26 — is never true, so every row took the same
inset and the branch was dead. `game.test.ts` now asserts both the stagger and the half turn.

Nothing on the board is a word. Half the players are reading the device upside down —
`game.test.ts` asserts no `text` call is ever made.

## What is not specified here

Art, audio and haptics: the renderer draws primitives and nothing is licensed yet. Remote play
uses the same simulation unchanged — there is no per-device state to negotiate beyond the
shared logical viewport the engine already provides. The `hard`-tier traffic share noted above
is a balance question rather than a correctness one; if it is ever worth narrowing, the lever
is the spawn interval rather than the impulse, which was measured and barely moves it.
