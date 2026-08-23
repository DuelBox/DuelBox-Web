# Tanks

One yard, two tanks, and a stack of crates that both players are slowly knocking down. Your
gun is bolted to your hull, so aiming and driving are the same act. **Hold the controls to
swing the gun and load it; let go and it fires** — or hold too long and it goes off on its
own. A shell that reaches a tank costs it a life. First to take the other's three wins.

- **Archetype** `rt-arena`, **zone split** `shared-board`, **yard** 900 × 900, one arena
  shared by both seats.
- **Tank** radius 22, 175 u/s forward, 105 u/s back, turning at 2.4 rad/s and giving up 45 %
  of its speed while it does.
- **Shell** radius 7, 95 u/s from a snap shot and 430 u/s from a full one, alive 1.15 s —
  so it carries **109 units at worst and 495 at best**, in a yard 900 across.
- **Gun** fires on the release of the controls at 0.35 s of load, by itself at 1.25 s, and
  stalls the tank for 0.22 s afterwards.
- **Rack** 34 shells a tank. **Lives** 3. **Cover** seven mirrored pairs of two-shell crates.

## The decision

**A snap shot is a knife and a charged one is a rifle.** Letting go the instant the gun will
fire at all gets you a shell that travels four tank-lengths; holding to the top of the load
gets one that crosses half the yard at four times the speed. Since the trigger *is* letting
go of the controls, choosing the moment is choosing to stop steering — and holding on past
the top does not keep the shot in the barrel, it fires it wherever the hull happens to be
pointing.

Around that sit two more:

- **Cover is shared.** The crate you are hiding behind is the crate they are hiding behind.
  Opening a lane through it takes two shells and opens it in both directions.
- **Standing off beats charging in**, and it is measurable: a bot holding 470 units beats one
  holding 300 by 76 % to 24, and one holding 120 loses at 24.8 %. A fully charged shell
  carries 495, so from four hundred units out only a fully loaded gun can touch you — and
  a tank that charges in arrives inside everybody's reach with an empty one. The counter is
  that **reverse is 40 % slower than forward**, so backing away is answerable.

## Termination

Structural, not timed. **The gun loads whether or not anybody is driving and fires itself
when it is full**, so every tank spends a shell at least every `RECOIL + LOAD_FULL` = 1.47 s
no matter what happens, and the rack is 34. A match nobody touches at all runs out of
ammunition and is decided on lives in a measured **52.2 s**; there is no clock anywhere in
the rules and no frame cap in the tests — `playMatch` in `rules.test.ts` has no loop bound at
all and runs sixty seeds to completion.

## Rule 9: one arena, and the symmetry is measured

There are no mirrored halves to copy here, so fairness has to be built into the yard itself.
Crates are dealt **in pairs**: a cell drawn from the twelve before the centre and its
point-reflection, so a crate at `(x, y)` implies one at `(900 − x, 900 − y)` with the same
size and the same armour. The three spawn pads are stated once and mirrored the same way, and
the two opening headings are opposite. The centre cell is always left clear — it is its own
mirror either way, but blocking the one square both tanks must cross made every match two
tanks circling the same obstacle in the same direction.

Both seats see the whole yard at one scale because there is one yard, drawn once. `render`
never calls `pushRotation` or `pushSeatRotation`, and a test asserts it.

**The strongest statement is structural rather than statistical.** Hand both seats the *same*
bot stream and the two tanks must stay exact mirror images for the whole match. They do:
worst departure **6.5 × 10⁻¹² units** over sixty matches a tier, and **60 out of 60 are
draws**. Anything in `step` that could tell the seats apart — an ordered loop, an uneven
collision push, two draws where there should be one — shows up there immediately, where a
win-rate measurement needs thousands of matches to see it. Getting it there took three
specific choices:

- Overlapping hulls are separated by **half the overlap each**, never by moving whichever
  tank was stepped second.
- Shell hits are collected against the positions every shell already had and applied
  together, so two tanks can go on the same step.
- **A respawn that catches both tanks draws one pad index, not two.** Two draws would hand
  seat one the earlier value every time, which is the same arithmetic bias a shared generator
  produces and exactly as measurable.

## Rule 10: neither instrument is quicker, and it is an equality

**A turn-and-drive tank is a trap in a shared arena**, and the trap is the pointer. If a drag
named a *bearing* — point where you want the gun — a thumb could stop the gun exactly on it,
where a key can only stop it by letting go at the right moment. At 2.4 radians a second, a
fifth of a second of reaction is thirty degrees of aim, and no keyboard could ever match it.

So the drag names **the same thing a key names**: a turn and a throttle, each reduced to a
sign. `setIntent` takes `Math.sign` of both components and is the only door into the
simulation, so a drag four hundred units long, a drag twenty-seven units long, and a held key
are the identical order. A test plays six gestures — sideways, forward, back, both diagonals
— through both instruments for four hundred frames and compares `JSON.stringify(position)`:
**byte-identical, not close**.

Three further things that had to be true for that to hold:

- **Speed reads the hull, not the order.** A turning tank loses 45 % of its speed, and the
  test is `intent.turn !== 0` — the hull's own state — so a flicked thumb and a held key pay
  the same. Charging it against the *size* of the gesture would have made a big drag cheaper.
- **There is no fire button.** The trigger is releasing the controls, which is one act for a
  thumb and one for a finger. A separate action key would have let a keyboard steer and fire
  at once while a thumb, which has one gesture channel, had to choose.
- **`RECOIL` exists for this reason and not for feel.** Firing deliberately means letting go
  and taking hold again, and a thumb leaving and returning to glass is slower than a finger
  lifting off a key. Locking the tank out for 0.22 s after every shot hides that gap
  completely: neither instrument can do anything during it. A test measures the first shot
  from both and gets the same frame; another mashes for twelve seconds and confirms the shot
  rate never exceeds `RECOIL + LOAD_MIN`.

A resting thumb inside the 26-unit deadzone is not an order and does not silence the keys —
one player may well have a hand on both.

**One honest wrinkle.** The drag is read in device orientation, exactly as the arrow keys
are, so the far seat's *gesture* is mirrored relative to their own body — the same choice
Frogs Fight, Robot Arena and Snake Clash made. It is identical for both seats, which is what
fairness requires; making it body-relative would mean the game reading the presentation.
Turning and throttle are hull-relative, and a half-turn of the view preserves handedness, so
their *effect* reads correctly from either side of the device.

## The three streams

**The world has its own generator.** It deals the crates and every respawn pad. Both bots
would otherwise draw from it, and the number of *decisions* a tier makes depends on its
reaction — `hard` looks about four times as often as `easy` — so a different pairing would
deal a different yard and a human against a bot would fight in a yard none of the balance
figures were measured in. A test compares the pad sequence two different tiers are dealt from
the same seed, over the destructions both matches played, and they are equal.

**Each seat has its own generator too.** A constant number of draws per decision fixes the
*count* and not the *order*: whichever seat is polled first still takes the earlier value from
a shared stream. With a stream each, the poll order is not observable at all — a test runs the
same match with the two calls in both orders and the final states are bit-identical, frame
count included.

## The bot: three axes, and five more that were deleted

Every axis was swept **alone**, with the other knobs flattened to `normal`'s value so the
three tiers differed in one number and nothing else. All three order the tiers on **both**
steps:

| swept alone | normal > easy | hard > normal | hard > easy |
| --- | --- | --- | --- |
| `reaction` 0.26 / 0.15 / 0.07 s | 67.4 % | 63.2 % | 73.8 % |
| `aim` 0.38 / 0.24 / 0.16 rad | 65.3 % | 62.2 % | 74.7 % |
| `range` 210 / 300 / 390 u | 60.1 % | 59.5 % | 67.3 % |
| **all three** | **81.6 %** | **78.6 %** | **91.6 %** |

800 matches a cell in both seat orders.

**`range` came out backwards from what was written.** A tank that closes in looked obviously
the stronger player — it is inside its own snap shot's reach, where a shell cannot be
outrun. Shipped that way it measured 23.8 / 26.7 / 20.5 per cent, which is a difficulty axis
pointing at the floor. Standing off wins because a shell only carries 495 units: from 390 you
can be reached only by a fully charged shot. **A beginner drives at the other tank; that is
what makes them a beginner.**

**`aim` is dead below the cone the bot already fires inside.** Swept at 0, 0.02, 0.04, 0.06 it
measures 6.0 to 6.6 seconds a life — flat — and from 0.09 up it is 7.5, 8.1, 9.2, 10.5, 12.4.
`FIRE_CONE` is 0.09, and a wander smaller than the gate's own tolerance is invisible. Every
tier is above it and a test enforces the floor. This is Star Catcher's `aim` bug, which sat at
8 and 22 units below a 46-unit catch distance and read in the source as the main axis while
doing nothing.

**`reaction` stops paying below 0.06 s.** At 0.03 the solo cost is 8.26 seconds a life against
8.05 at 0.06: re-drawing the aim wander five times a second means never settling on a bearing,
which is the dithering Star Catcher fixed with stickiness. `hard` sits at 0.07 for that reason
rather than as low as it would go.

### What was deleted, and why

Five knobs were written, measured, and are gone. A dead knob is source that lies.

| deleted | swept | result |
| --- | --- | --- |
| `screen` — hold fire when a crate is on the line | 0, 0.3, 0.6, 1, 1.4 under three cover densities | never left the noise; 4.18 shots a life either way |
| `dodge` — steer out of the way of an incoming shell | 0, 1, 2 | **backwards**: 40.9 / 22.3 / 17.8 % |
| `lead` — fraction of the real intercept time | 0, 0.3, 0.6, 1, 1.5 | 50.9 / 50.0 / 51.9 / 53.0 / 50.1 % — flat |
| `discipline` — waiting for a shell that will carry | 0, 0.25, 0.5, 0.75, 1 | 41.4 / 49.3 / 51.9 / 50.9 / 50.4 % — one step, not three |

- **`screen`** read as "the tier that understands cover" and never fired: the bot declined a
  shot so rarely that `hard`'s cost was identical to two decimal places with and without it. A
  firing solution inside a 0.09-radian cone and a crate on the same line almost never
  coincide.
- **`dodge`** is the one that stings, because breaking off from a shell that is about to hit
  you is the most obviously correct behaviour in the file. It is not: **the shot you give up
  costs more than the life you save**, and a tank that keeps stepping sideways never finishes
  anybody. It pulled the complete ladder from 92 / 96 down to 73 / 64. It is the same shape as
  Star Catcher's sight range, where seeing further made a bot chase stars across a sky full of
  holes and finish last.
- **`lead` and `discipline` survive as constants** (`LEAD_FRACTION` 0.6, `SHOT_DISCIPLINE`
  0.6) because they are the right behaviour, not because they order anybody. Leading is worth
  nothing at any tier's shipped aim — but pin the aim wander at 0.06 radians and the same
  sweep reads 40.8 / 50.0 / 56.2 / 55.2 / 47.1, a fifteen-point axis. **Every tier's own aim
  wander is several times larger than the correction, so the lead disappears into it.** That
  is a fact about this bot rather than about leading.

### Two identical bots

They open on mirrored pads facing each other, so without a wander they give mirrored orders
for ever. Measured, and it is absolute:

| | easy | normal | hard |
| --- | --- | --- | --- |
| as shipped | 0.0 % draws | 0.0 % | 0.0 % |
| reaction wander off | 0.3 % | 0.0 % | 0.3 % |
| aim wander off | 0.3 % | 0.0 % | 0.0 % |
| **both off** | **100 %** | **100 %** | **100 %** |

Either one alone breaks the mirror; both are drawn unconditionally, before any branch, which
is what keeps `BOT_DRAWS_PER_DECISION` at exactly two.

## What was measured

**Seat fairness, 4000 matches per equal tier over three independent seed bases** — seat one's
share of decided matches. A shared arena is where a small asymmetry compounds, so 400 is not
a sample:

| | base 11 | base 500003 | base 999331 | all 12000 |
| --- | --- | --- | --- | --- |
| easy v easy | 49.7 % | 49.8 % | 50.2 % | **49.9 %** |
| normal v normal | 50.7 % | 49.6 % | 49.8 % | **50.0 %** |
| hard v hard | 49.4 % | 50.5 % | 49.7 % | **49.9 %** |

The sign flips between bases, which is what sampling noise looks like and what a structural
bias does not.

**The ladder, 400 matches a cell, both seat orders** — the row's share of decided matches:

| | v easy | v normal | v hard |
| --- | --- | --- | --- |
| **easy** | — | 15.0 % | 7.5 % |
| **normal** | 81.8 % | — | 25.5 % |
| **hard** | 91.3 % | 74.3 % | — |

Monotone in both directions, and the two orders agree to within the noise: easy-as-seat-one
against normal reads 15.0 % where normal-as-seat-one reads 81.8 %.

**Per tier, no ceiling in it, 400 seeds** — against a fixed `normal`, in both seat orders:

| | seconds per life **taken** | seconds per life **conceded** | shots per life taken |
| --- | --- | --- | --- |
| easy | 16.21 | 7.34 | 10.07 |
| normal | 9.90 | 9.90 | 6.60 |
| hard | **8.24** | **14.18** | 6.35 |

Both are rates, so neither saturates: a hopeless tier reads a large number rather than
bumping into a maximum.

**And a measure that saturated, reported rather than smoothed over.** The obvious solo
measure — seconds a life against a dummy that never touches the controls — reads
**10.06 / 9.08 / 10.30**, which is not monotone and puts `hard` last. That is a fault in the
measure, not in the game: the strongest axis is `range`, `range` is about not being shot, and
a dummy does not shoot. `hard` hangs back at 390 units and takes longer to finish something
that was never going to hurt it. A circling dummy reads 8.19 / 7.45 / 8.85 and fails the same
way. Rule 8 says suspect the game before the bot when every tier measures the same — checked,
and it is not the game: each axis orders the tiers on both steps in isolation, and the ladder
is 81.6 / 78.6 / 91.6.

**Other things swept, and what they were worth:**

| | swept | effect on the ladder |
| --- | --- | --- |
| `TURN_DRAG` | 0, 0.2, 0.45, 0.7 | 83.3/77.6 → 80.8/76.6 — **inside the noise** |
| `CRATE_PAIRS` | 0, 4, 7, 10, 12 | hard-over-normal 74.0 → 81.0 % — **cover is worth 7 points to the better player** |
| `CRATE_ARMOUR` | 1, 2, 3, 5 | 75.6 → 80.2 %, mostly match length: 20.6 s → 28.9 s |
| `PADS` | 1, 3 | 75.7 → 78.3 % — about one standard error |
| `SHELLS` | 14, 18, 22, 26, 34 | nothing above 22: **no match ends on ammunition**, so the game is skill-limited rather than supply-limited |

`TURN_DRAG` is kept despite measuring flat, and the honest reason is that it is a decision for
a *person* that these bots have nothing to trade against — they turn when they need to and
roll when they do not, and never commit to a line. The shell pool's high-water mark across
every run is **three of ten**, and a test asserts it never fills.

## Reading it

No text anywhere. Seat one is a round hull with an inner ring and disc pips; seat two a square
hull with a bar and block pips, and their shells differ the same way — a disc against a
square. A crate's remaining armour is **size and cracks**, not shade: it shrinks as it is
knocked about and gains one countable crack per shell taken. The load in a gun is a bar across
the back of the hull whose length is the charge, so how dangerous a tank is right now is
readable from across the room. Respawn grace is a ring outside the hull. All of it survives
greyscale (rule 7), and a test asserts `text` is never drawn.

## Rule 8: nothing in pixels

`rules.ts` holds the whole simulation in yard units and imports nothing from `game.ts`. Every
number above — 900, 22, 2.4, 495 — is a yard unit; `game.ts` adds only colours, line widths
and the length a barrel is drawn.

## Rule 6: proved, not asserted

A bot writes an `Intent` — the same pair of signs a thumb writes — and it goes through the
same `setIntent`, so nothing it does is faster or finer than a person. What it *knows* is
tested by rewriting the world: the other tank's load, recoil, shield, remaining shells, lives
and held-order flag are all inverted, the elapsed time is shifted, every crate is moved and
re-cracked and every shell's remaining life is flipped — and the bot's decision does not move
by a single component. The only two things it reads about its opponent are **where it is and
which way it is moving**, and both are drawn on the screen.
