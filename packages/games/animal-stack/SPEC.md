# Animal Stack — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~45 s advertised, 18 animals (≤ 62.1 s) hard bound

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A platform each. A crane swings an animal in over your platform, off to one side; you walk it
left and right, turn it round if it is facing the wrong way, and let go. It drops onto
whatever is already there. **If anything comes off the platform, you have lost.**

## Observed rules

From the reference genre: _"Take turns dropping animals. First player to drop an animal off
the platform loses, so take care to drag left & right, and tap to rotate before you drop."_

Four facts, and only four: animals are dropped onto a platform, dropping one off the platform
**loses** (rather than scoring), you place it by dragging sideways, and a tap turns it. Every
other decision below is **[ours]** — what an animal is shaped like, what makes a tower fall,
how a match that nobody loses is settled, and what "take turns" becomes in a game the shell
runs as `rt-split`.

### The one place this departs from the observed rule **[ours]**

The rule says "take turns"; this does not. `rt-*` games must not model turns — the shell reads
`getActiveSeat()` and, for a game that answers it, hands the **whole** pointer surface to
whoever is to move, which would take one seat's half of the glass away for half the match.

So each seat gets its own platform and its own crane, and both play at once. The animals come
out of one seeded stream and are handed out **by index**, so the nth animal of the match is
the same animal, facing the same way, arriving at the same offset, for both seats. Two people
are therefore set the identical run of problems rather than merely balanced on average — which
is what "taking turns at the same tower" was buying, delivered without a turn model.

## The board

Read out of `src/rules.ts` rather than from memory.

| | Value | Why |
|---|---|---|
| Field | 600 × 1000 | Portrait: two people either side of an upright phone |
| Yard | 470 tall, ×2, with a 60-unit gutter between | Symmetric under a half turn |
| Platform top | 74 above each seat's own edge | Deep enough to draw a plinth with a drop either side |
| Platform | ±92 from the centre line | Exactly two tortoises wide, so a first animal fits anywhere on it |
| Minimum contact | 6 units | A toe on the edge is not a foothold |
| Crane reach | ±176 | **The losing move has to be reachable**; ±176 + 46 still fits the 300 half-field |
| Walk speed | 250 u/s | One speed for a key and a finger; the full reach crosses in 1.41 s |
| Carry height | 90 above the tower | Also how far an animal falls |
| Crane clock | 4.00 s falling 0.16 s an animal, floor 1.80 s | Below |
| Delivery offset | ±62 growing to ±150, never inside 40% of it | An animal nobody touches is dropped off the platform |
| Fall / rest | 0.34 s / 0.30 s | |
| Opening pause | 1.0 s | Both cranes hang over an empty platform |
| Budget | 18 animals a seat | What bounds the match |
| Tap threshold | 0.19 s | Below |
| Backstop | 80 s, which nothing reaches | `roundSeconds` ends nothing, so the rules must |

### The animals **[ours]**

| | feet (half) | back (half) | back offset | weight | weight offset | height |
|---|---|---|---|---|---|---|
| tortoise | 46 | 40 | 0 | 1.2 | 0 | 30 |
| pig | 38 | 32 | −8 | 1.5 | +6 | 36 |
| sheep | 32 | 26 | +9 | 1.1 | −8 | 40 |
| goat | 26 | 21 | −11 | 0.9 | +10 | 46 |
| giraffe | 20 | 14 | +13 | 1.1 | −9 | 58 |
| flamingo | 15 | 10 | −13 | 0.6 | +7 | 50 |

Three properties do all the work, and each of them is a thing you can see on the screen:

- **The back is offset from the feet.** Stack one animal squarely on the next and the tower
  walks sideways, one offset at a time. **This is what the turn is for**: turning an animal
  round mirrors the offset, so alternating facings is how you keep a tower straight, and it
  costs you a gesture and the time to make it.
- **The weight is offset from the feet.** A leaning animal is a liability however neatly you
  put it down. Every one obeys `|lean| < baseHalf`, because an animal whose weight fell
  outside its own feet could not stand on the bare platform — that is a broken animal, not a
  hard one. The tightest is the goat, 10 against 26.
- **The backs get narrower down the list**, and the deal walks down the list as the tower
  grows: a match opens with tortoises and pigs and ends with goats, giraffes and flamingos.

The contact an animal gets, put down squarely, is twice the smaller of its feet and the back
beneath it:

| standing on → | tortoise | pig | sheep | goat | giraffe | flamingo |
|---|---|---|---|---|---|---|
| tortoise | 80 | 76 | 64 | 52 | 40 | 30 |
| pig | 64 | 64 | 64 | 52 | 40 | 30 |
| sheep | 52 | 52 | 52 | 52 | 40 | 30 |
| goat | 42 | 42 | 42 | 42 | 40 | 30 |
| giraffe | 28 | 28 | 28 | 28 | 28 | 28 |
| flamingo | 20 | 20 | 20 | 20 | 20 | 20 |

A flamingo on a flamingo gives you 20 units to land a weight in. That is the end of a match.

### What the crane is doing to you

| animal | species drawn from | crane seconds | delivered at most | time to cross the yard |
|---|---|---|---|---|
| 0 | tortoise, pig | 4.00 | 62 | 0.95 |
| 4 | tortoise … sheep | 3.36 | 83 | 1.03 |
| 8 | pig … goat | 2.72 | 103 | 1.12 |
| 12 | goat … flamingo | 2.08 | 124 | 1.20 |
| 17 | goat … flamingo | 1.80 | 150 | 1.30 |

The last column is the constraint that had to be checked and is asserted in `rules.test.ts`:
**the crane always gives you more time than it takes to walk the animal the whole way in.**
If it ever did not, a placement would be impossible rather than hard, and the game would be
deciding matches by arithmetic nobody could see. The margin narrows from 3.05 s to 0.50 s,
which is the difficulty ramp expressed as time rather than as geometry.

## Why a tower stands, or does not

There is no fudge factor here. A stack of rigid bodies stands exactly when, **at every join,
the centre of mass of everything above that join lies inside the patch the two bodies actually
touch on.** `marginOf` computes one join: intersect the upper animal's feet with the lower
one's back, and report how far the weight above is from the nearer edge of that overlap.
`stands` is precisely `margin >= 0`, so there is one comparison in the game rather than two
that could disagree.

**A tower breaks at the highest join that gives way, and everything above that join goes.**
That single rule covers both failures without a special case: an animal that lands with a toe
on the edge fails its own join, slides off alone, and leaves the tower standing; a tower whose
base is overloaded is scanned all the way down and loses the lot. It is also self-consistent —
every prefix of a stack was checked when it was built, so whatever is left after a break was
standing before the drop and is standing after it, which `rules.test.ts` drives over 200 towers
rather than argues.

**The statics are restated longhand in the test**, from the physical claim rather than reused
from `rules.ts`, and the two are compared over a thousand random towers (both answers seen:
they must disagree about neither the standing ones nor the broken ones) and again at **every
step of every match** in a run of 900. Zero disagreements. Checking `marginOf` against itself
would have proved nothing.

## Scoring and the win condition

**Last one standing**, resolved by the shared helper:
`resolve({ kind: 'last-standing' }, tally, { timeExpired, eliminated })` — see `CONDITION` in
`rules.ts`. The observed rule is a *losing* condition rather than a scoring one, and this is
the helper for that. Nothing here writes a comparison by hand, so two towers that come down in
the same step are a draw because the helper says so and not because this game picked a seat.

The tally is **animals standing on your platform**, which is what the shell's HUD shows. It
goes down when a tower comes down, because that is what happened. It is only consulted when
nobody has been eliminated — the clock expiring mid-match, which nothing reaches today.

After an animal settles: 0.30 s, then the crane swings the next one in. There is no serve and
nothing alternates: each seat's clock is its own.

### The tie-break **[ours]**

Two seats are dealt identical animals, so two players who both survive the whole budget finish
on the same count by construction. "Level on animals" therefore has to mean something, and the
honest thing it means here is **whose tower is standing more honestly**: the margin at the
tightest join, higher wins. That is the same number the balance bar has been showing all match,
so it is something both players watched happen rather than a hidden second scoreboard.

Two towers that both came down in the same step are a genuine draw — they were level, and
neither has a margin left to compare. `breakTie` is only ever reached through `resolve`
returning `draw`, so it separates rather than replaces the shared helper.

**Nothing is decided on a clamped value.** `across` is clamped to the crane reach, but no
outcome is compared on it — a placement at the clamp is off the platform and falls. The
contact interval is an intersection of two real intervals, not a clamp of the quantity being
compared against it. (Two games here shipped with a distance pinned to the finish line and
then judged on that distance, which made one in five hard matches a false dead heat.)

## Controls

| | Seat one (near) | Seat two (far) |
|---|---|---|
| Keyboard | `A` / `D` to walk, `Space` to turn or drop | `←` / `→` to walk, `Enter` to turn or drop |
| Pointer | drag in the near half, lift to drop; tap to turn | drag in the far half, lift to drop; tap to turn |

**One gesture, and both instruments spell it the same way**: a tap turns the animal round, a
press held past 0.19 s and then let go drops it. A thumb taps the glass or drags and lifts; a
keyboard taps its action key or holds it and lets go. Neither has a gesture the other cannot
make, and there is no mode to switch between them.

The two sources combine by the engine folding this seat's action key and a pointer down in
this seat's own zone into one action before the game sees it, so `gripStep` never learns which
instrument raised it. Where they differ is what they can say about *position*: a key names a
direction, a finger names a point. Both reach the animal through **one rate limit at one
speed**, so a finger that jumps across the yard does not teleport the animal after it, and
neither instrument can place it faster than the other. A finger is the more specific
instruction, so it wins while it is down.

Every clause above is driven through the real `InputManager` in `game.test.ts` and asserted,
including that **nothing else on the keyboard does anything**: `W`, `S`, `↑`, `↓`, `Escape`,
`Tab`, `Q` and `1` are all pressed and neither animal moves, turns or drops.

### Why a thumb and a keyboard are worth exactly the same

Two assertions rather than an argument. Driven through the engine, a finger dragged to the far
edge and `D` held down walk the animal along the **identical** trace for forty steps, to nine
decimal places; and a press of the same length drops it on the **same step** whichever
instrument made it. That is why `sameInputClassOnly` is `false`.

Two residual differences, both measured and both small enough to name rather than hide:

- **Precision**, which goes the other way from the usual worry. A finger is quantised onto the
  engine's 3-unit lattice and then snapped to exactly once it is within one step's walk, so a
  thumb can name a point to 3 units; a key stops wherever the step boundary falls, which is
  4.17 units. Both are far finer than the 20-unit contact a flamingo gives you.
- **Turning costs a thumb one step of walking and a key none.** A finger has to come off the
  glass to tap, and the step it is off the glass is a step the animal does not walk — 4.17
  units, against a crane clock with between 3.05 s and 0.50 s of slack in it. A keyboard can
  hold `D` and tap `Space` at once. The bot is held to the thumb's version rather than the
  key's — it turns before it starts walking, never both at once — so the stronger of the two
  is the one a person has and not the one the bot has.

## Edge cases

- **Simultaneous input.** The two seats never touch the same object, so there is nothing to
  order. Both yards are stepped in the same call and neither can read the other; a test steps
  one yard six hundred times and asserts the other is untouched.
- **No input at all.** Every animal is dropped by the crane where it was delivered, and the
  crane delivers at least 40% of the way out — past the edge of the platform from the fourth
  animal on. Measured over 200 seeds: **9.9 to 33.6 s, mean 14.0 s, 2 to 8 animals**, and
  because both seats are dealt identically it is a draw on all 200. This is the case a stacking
  game has to earn: nothing arrives on its own.
- **Mashing.** A tap every two steps is a *turn* every two steps and never a drop, so mashing
  spins the animal and hands every one of them to the crane. Measured: both seats mashing at
  the middle of their own half play all 18 animals in 54.1 s and draw 14–14. Mashing is
  therefore not a strategy but it is not suicide either — a finger parked on the centre line
  is a real, mediocre way to play, and it loses to anyone who compensates for the drift.
- **Input in the other seat's zone.** A touch belongs to the seat it started in and keeps that
  ownership across the midline. That lives in the engine; the game reads `input.seat(seat)` and
  never asks where a finger is. A test drags a finger from the near half deep into the far half
  and asserts the far animal was not touched.
- **A press swallowed by a pause.** The host clears the input manager on a pause, so a key held
  when the game was paused never delivers its key-up. `onResume` drops the grip, so a resume
  cannot deliver a drop nobody asked for.
- **An animal walked to the end of the crane reach.** It stops there. It can still be dropped,
  and it will fall — that is the point.
- **A contact exactly `MIN_CONTACT` wide, and a weight exactly on the edge of it.** Both stand;
  a hair narrower or a hair further out and they do not. Asserted on both sides of the bit.
- **A tap and a drop that are one step apart.** 11 steps turns, 12 drops. See below.
- **A tower nobody can break.** The budget bounds it, and 80 s bounds that.

## Termination

Guaranteed **twice over**, and the arithmetic is multiplied out rather than felt:

1. **The crane clock.** An animal nobody drops is let go by the crane after `carrySecondsFor`
   seconds and charged to the budget. A seat cannot stall.
2. **The budget.** 18 animals a seat, after which the platform is `safe`; when both seats are
   done one way or the other, the shared helper settles it.

The dearest a player can make one animal cost is the whole crane clock, then the fall, then the
rest. Summed over the eighteen:

```
1.0 + Σ(i=0..17) carrySecondsFor(i) + 18 × (0.34 + 0.30)
  = 1.0 + 48.64 + 11.52
  = 61.16 s
```

plus at most three steps of slack an animal, because each clock is checked after it is
advanced: **62.06 s**. `ROUND_SECONDS` (80 s) sits above that as a second, looser backstop,
because a game whose only guarantee lives in its pacing constants is one change away from
running for ever. `apps/web/src/data/termination.test.ts` allows 600 s, so the bound clears it
by a factor of nine and a half.

Measured, driven through `AnimalStackGame`: the longest of 3600 bot matches was **21.6 s**, the
longest of 200 idle matches **33.6 s**, and the mashing case **54.1 s**. None of 3600 + 900 +
200 matches failed to reach a decision. `rules.test.ts` asserts the arithmetic bound, drives
the idle, brink, drop-instantly and bot-pair cases to a decision, and fires the 80 s backstop.

## Determinism

- **All randomness is seeded**, and it is consumed by the *match* rather than by a yard:
  `ensureDrawn` draws three values by animal **index**, so what either player does cannot
  change which animals either of them is given. A test plays two matches completely differently
  from one seed and gets the identical run of species and delivery offsets; another plays one
  seat fast and one slow and gets the identical run in both.
- **Every clock is counted in simulated seconds off the fixed step**, never in wall time.
- **The tap threshold is deliberately not on a step boundary.** 0.19 s sits between eleven
  steps (0.18333 s) and twelve (0.2 s). A threshold on a boundary is decided by whether thirty
  additions of a sixtieth land a hair above or below it — which is exactly how a 0.5 s freeze
  in another game here took 31 frames — and this one decides whether an animal is turned or
  dropped. A test asserts 11 turns, 12 drops, and that the accumulated sum never lands within
  a millionth of the threshold.
- **The walk is a constant-velocity integral, and it snaps.** Once the animal is within one
  step's reach of the point a finger names it lands **exactly** on it, so a placement arrives
  at the same place however the steps fall. A test walks the same finger to the same point at
  60, 90 and 120 Hz and gets the identical float. Nothing here decays, so there is no forward
  Euler overshoot to disagree with the analytic answer.
- **Nothing about the fall is integrated.** The landing is judged when the fall clock expires;
  where the animal is mid-air is drawn and never simulated. A test asserts the fall takes
  exactly `ceil(0.34 / step)` steps and that the landing is not judged before it.
- **Nothing allocates per step.** Both stacks are preallocated to the budget and written into
  by index; the deal arrays likewise; the step result is one record rewritten in place; the
  join scan writes its answers into module scratch. All four are asserted, and a test plays a
  whole match and checks the stack still holds the same eighteen objects.
- **Nothing is expressed in pixels.** Every number above is a logical unit; the renderer is the
  only code that knows what a device is, and the scroll that keeps a tall tower in its own yard
  lives there and nowhere else. `cross-viewport.test.ts` plays the identical trace at 320 × 568
  through 4K and compares raw floats.
- `resetMatch` leaves a match indistinguishable from a fresh one, arrays included, so a rematch
  cannot start part-played — asserted with `toEqual` against `createMatch()`.

## The bot

It reads **one yard and no match** — `botIntent` is handed the yard, so there is nothing in
scope for it to peek at, and a test runs 200 calls and asserts the other seat is byte-identical
afterwards. Within that yard it reads the positions, feet, backs, weights and heights of the
animals already down, the animal on the crane, and its own crane clock.

**Every one of those is drawn** (CLAUDE.md rule 6). The renderer puts the support strip the
next animal must land on and the landing footprint of the held animal at the same height, so
where they overlap is visible; it marks each animal's back; it draws a balance bar on the
plinth showing the contact the tightest join is standing on and where the weight above it
falls; and it marks the tightest join on the tower itself with a chevron.

What is **not** drawn is the verdict — whether a given drop would stand. That is arithmetic
over the drawn quantities, and it is deliberately left as arithmetic: a game that printed
"this drop topples" would have no decision left in it. This is the one place this game differs
from Chicken Jump, which draws the single number its bot reads because that game is entirely
about that number. Here the bot is faster at sums than a person, which is what a bot is, and it
is given no quantity a person cannot see.

The policy is one line for every tier: **weigh a spread of placements either side of the strip
you have to land on, both ways round, and keep the one whose tower would have the most slack —
less a penalty for leaving the next animal a back that is off centre.** That last clause is not
a difficulty knob; every tier uses it, because it is a fact about the game rather than about
the player. The join that eventually gives way is nearly always the one at the bottom, and what
puts weight out there is the tower walking sideways one back at a time. At `DRIFT_WEIGHT` 0.35
a bot will give up a unit of margin to pull the next back three units straighter.

It turns the animal **before** it starts walking it, never both at once, because a thumb has to
come off the glass to tap — a bot that turned mid-drag would be using a gesture no player has.
It walks through the same `walk` every player uses, at the same speed.

The three tiers differ only in these five numbers:

| | reaction | aim error | blunders/s | placements weighed | settles within |
|---|---|---|---|---|---|
| `easy` | 0.30 s | ± 17 | 0.40 | 7 | 14 |
| `normal` | 0.14 s | ± 9 | 0.22 | 15 | 6 |
| `hard` | 0.07 s | ± 5 | 0.10 | 27 | 2 |

- **Reaction** is how often it may change its mind. Look intervals wander by ±35%; without it a
  bot looking on a metronome lands every look at the same offset from the animal's arrival for
  the whole match, so the gap between where it looks and where it wants to be is a fixed error
  rather than a spread and never averages out. Inherited from Chicken Jump, where the effect
  was measured; re-checked here by setting the jitter to zero, which flattened the ladder.
- **Aim error** is drawn **once per animal and held** to the drop, never per step. A fresh
  error sixty times a second averages to zero and every tier plays the same — the bug
  `@duelbox/game-sdk`'s `misjudgement` exists to prevent and which three games here shipped
  before it did. Asserted: 40 calls on one animal leave the bias unchanged, and the next animal
  gets a fresh one.
- **Blunders** freeze it for 0.5 s, which is a quarter of the crane clock by the end of a
  match. A duration rather than a coin flip per step, because a bot that re-decides fourteen
  times a second and hesitates for one of those has jittered rather than blundered.
- **Placements weighed** is deliberation, not information: every tier sees the same tower and
  the same backs. It sets how finely the search can land, not what it is allowed to know.
- **Settles within** is how fussy it is about arriving before it lets go — and it is a real
  cost, because the crane clock is running while it fusses.

### What each tier does with an animal

300 seeded matches per tier, both seats on the same tier, driven through `AnimalStackGame`.

| | animals a seat | animals off a match | matches with a fall | budget survived | mean match |
|---|---|---|---|---|---|
| `easy` | 7.5 | 2.23 | 100.0% | 0.0% | 8.0 s |
| `normal` | 13.7 | 2.35 | 99.0% | 1.0% | 14.0 s |
| `hard` | 15.9 | 2.55 | 93.7% | 7.5% | 16.4 s |

A weak bot gets seven animals down and drops the eighth; a strong one gets sixteen and drops
the seventeenth. Seven and a half per cent of `hard` seats get all eighteen down, which is what
makes the budget a real bound rather than a decoration — and what makes the tie-break worth
having.

### Measured win rates

400 seeded matches per pairing, driven through `AnimalStackGame` itself, seeds `3 + 977n`.
Cell is the **row seat's** (p1's) win share. Seven draws in 3600; none failed to finish.

| p1 \ p2 | `easy` | `normal` | `hard` |
|---|---|---|---|
| `easy` | 52.4% | 9.5% | 3.0% |
| `normal` | 90.8% | 46.5% | 23.5% |
| `hard` | 97.5% | 76.1% | 48.9% |

The ladder reads the same from either seat: `hard` takes 97.5% of its matches against `easy` as
p1 and 97.0% as p2; `hard` against `normal` is 76.1% and 76.5%. Mean match length ran from 8.0 s
(`easy` v `easy`) to 16.4 s (`hard` v `hard`), longest 21.6 s.

Equal tiers, over **four independent seed families of 400 each**:

| | family 1 | 2 | 3 | 4 | overall (1600) | draws |
|---|---|---|---|---|---|---|
| `easy` | 52.4% | 49.1% | 51.3% | 48.4% | **50.3%** | 5 |
| `normal` | 46.5% | 53.3% | 51.3% | 52.4% | **50.8%** | 3 |
| `hard` | 48.9% | 45.1% | 50.1% | 48.6% | **48.2%** | 6 |

The families matter and the first pass proved it: a 120-seed slice of `hard` v `hard` came out
at 61.7%, which looks exactly like a seat bias, and over 1600 matches in four families it is
48.2%. Anything under a few hundred seeds in one family here is noise wearing a suit. The
residual is the fixed order in which the two bots draw from the shared generator, and it is the
only asymmetry the design has — everything else is checked by equality or by mirror rather than
statistically.

## The mechanic, measured

Spin War shipped with its headline verb impossible — across 400 bot matches no top was ever
pushed out of the bowl — and every global guard passed the whole time, because a match still
ended and still reported a winner. So this is measured, and it is measured **without reading a
counter that could be wrong in the same way the rule is**.

Every animal a seat is dealt either ends up standing on its platform or it went over the side,
so `dealt - count` is how many left: two pieces of bookkeeping that know nothing about falling.
Over **900 matches spanning all nine tier pairings**, seeds `7 + 4099n`, driven through
`AnimalStackGame`:

- **23.0 animals dealt a match**, and **21.3 standing at the peak across the two platforms** —
  animals really do stack.
- **2.35 animals off the platform a match** (a collapse takes more than one with it).
- **880 of 900 matches (97.8%) contained at least one animal going off.** The other 20 were
  decided on the tie-break: 13 `hard` v `hard`, 6 `hard` against `normal` either way round, and
  one `normal` v `normal`.
- **0 steps** in which a standing tower disagreed with the statics written out longhand.
- **0 matches** failed to reach a decision; longest 21.6 s.

Both halves of the rule are reachable and both happen constantly: towers get built and towers
come down. `rules.test.ts` holds a shorter version of this measurement on every commit,
including the case that says the budget is not a fiction — a careful player does sometimes get
all eighteen down.

## Presentations

See `docs/presentation.md`; nothing here re-decides it.

- **Shared-screen** — the two yards stack, p1's platform along the bottom edge and p2's along
  the top, with a gutter between that belongs to neither. The layout is a point reflection
  about the centre of the field, so both players read their own tower upright with their own
  platform nearest them and neither sees more of anything than the other. Nothing rotates:
  there are no turns, so there is nothing to flip, and `getActiveSeat` returns `null` for ever
  so the shell keeps a pointer zone for each seat.
- **Single-seat** — the local seat owns the viewport. The simulation is byte-identical; only
  placement changes. `game.test.ts` asserts a `single-seat` match on seat two traces identically
  to a `shared-screen` match on seat one from the same seed.
- **A tall tower scrolls**, by the same rule for both seats and derived from that seat's own
  tower alone, so neither player ever sees more of their own yard than the other sees of theirs
  (rule 9). The scroll lives in the renderer; the simulation has no idea a window exists. The
  plinth is **pinned** rather than scrolled, because the base join is the one that takes the
  whole tower with it, so a player must be able to see where the platform ends however tall
  their tower has got. A broken line marks where the tower leaves the window.

Colour is never the only signal (rule 7): p1's animals are plain and p2's are barred across in
ink; p1's platform posts are plain and p2's notched; the two halves are two distinguishable
shades in greyscale. **Species** are told apart by silhouette — a tortoise is wide and low, a
flamingo narrow and tall — and by a row of pips along the body, one more than the last, so all
six read apart without colour. The balance needle carries shape as well as colour: it grows a
foot when the tightest join is comfortable and loses it when it is not.

## What is not specified here

- Sound. No game in the collection has it yet.
- Reduced motion: the fall arc and the landing flash are the only motion this game adds beyond
  the simulation, and neither is currently gated on the preference.
- The `roundSeconds: 45` on the manifest is a catalogue label and ends nothing. The two real
  bounds are `MAX_ANIMALS` and `ROUND_SECONDS`, both in `rules.ts`.
- Whether a *human* pair reaches the budget more often than `hard` does. Every number above is
  a bot measurement; a person can plan the next animal and a bot here cannot, so the budget may
  matter more in real play than 7.5% suggests.
