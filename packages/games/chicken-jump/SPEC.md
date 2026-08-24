# Chicken Jump — specification

**Archetype:** `rt-split` · **Category:** Platform · **Logical box:** 680 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised, 16 blocks (≤ 73.4 s) hard bound

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A perch each. Above your perch a block swings back and forth on a rope; press once and two
things happen in the same instant — your chicken hops, and the block is cut loose. The block
slides on, slowing, and comes to rest somewhere. If it has stopped **on the pole** by the
time the chicken lands there is somewhere to stand and the block is stacked; if it stopped
**in the middle** of the pole it is worth double. If it is still sliding when the chicken
comes down, the chicken lands on something moving, stumbles, and the block is lost.

## Observed rules

From the reference genre: _"Jump to stack blocks and get points if the block stops in the
middle before the chicken lands on it."_

Four facts: one press that both jumps and releases, blocks that stack, points for stopping
in the middle, and a deadline of "before the chicken lands". Everything else is **[ours]** —
in particular what makes the block stop where it does, how wide "the middle" is, what
happens to a block that stops off the pole, how a match ends, and what separates two players
who finish level.

## The board

Read out of `src/rules.ts` rather than from memory.

| | Value | Why |
|---|---|---|
| Field | 680 × 1000 | Portrait: two people either side of an upright phone |
| Perch | 470 tall, ×2, with a 60-unit fence between | Symmetric under a half turn |
| Pole | perch-local x = 0 | The origin, so both seats hold literally the same numbers |
| Swing rate | 3.36 rad/s — a period of 1.87 s | One tempo for the whole game, learned once |
| Swing width | 106 … 126 either side of the pole | Each block is a variation on a known rhythm |
| Deceleration | 428 u/s² | What puts a mid-swing release past the pole and an outer one short |
| Hop | 0.76 s, apex 150 (drawn, never simulated) | The clock every release is measured against |
| Catch band | 88 at nil points, −2.4 a point, floor 46 | Narrows with your own score and nobody else's |
| Middle band | 45% of whatever is left — 39.6 → 26.6 | Worth double |
| Hesitation | 3 s a block, then it is cut down and lost | A swing and a half: three right instants offered |
| Rest / stumble | 0.45 s / 0.75 s | A moving block is the expensive mistake |
| Opening pause | 1.2 s | Both chickens look at an empty rope |
| Budget | 16 blocks a seat | What bounds the match |
| Target | first to 13; middle 2, pole 1 | |
| Backstop | 90 s, which nothing reaches | `roundSeconds` ends nothing, so the rules must |

### Why there is a right instant at all **[ours]**

The block is a **pendulum**, and where it will *stop* is not where it is — it is where it is
plus however far it still slides, which grows with the **square** of its speed. A pendulum's
speed is largest exactly where its position is smallest, so the two terms are at odds:

- At the end of a swing the block is still, so it stops where it hangs — 106 to 126 units
  out, which is clear of an 88-unit pole. **Pressing at the top always misses.**
- Crossing the pole it is at its quickest, so it overshoots by more than the swing is wide
  *and* needs 0.83 s to settle against a 0.76 s hop. **Pressing at the bottom always
  stumbles.**
- `stopPointOf` therefore passes through zero exactly once on each inward swing, and
  `rules.test.ts` counts the crossings to prove it is once and not three times.

Measured, at the crossing: the narrowest block is 74.6 units out and moving at 253 u/s and
takes 0.591 s to settle; the widest is 93.7 units out at 283 u/s and takes 0.661 s. Both are
inside the 0.76 s hop, which is the tuning claim the whole game rests on — if the crossing
needed longer than the hop, no release on that block could score at all. A test asserts it
for both ends of the amplitude band.

### The middle, as time rather than distance

The band the block has to stop in is a distance, but what a player experiences is the
**instant** they have to press in. Measured over a whole inward swing:

| Points | Narrowest block (106) | Widest block (126) |
|---|---|---|
| 0 | 107 ms middle, 253 ms catch | 82 ms middle, 147 ms catch |
| 6 | 89 ms, 211 ms | 68 ms, 127 ms |
| 12 | 72 ms, 165 ms | 55 ms, 108 ms |

That table is what the narrowing pole actually buys: **the last point is the hardest**, and
the player who is behind is being asked an easier question than the player ahead. It is a
handicap you inflict on yourself by succeeding, it reads only your own score, and it needs
no knowledge of the opponent — which matters, because a rubber band that read the *other*
seat's score would make one player's game depend on the other's, and this game has no shared
state by design. `rules.test.ts` measures both ends of the table.

It does **not** put the last points out of reach: a release exactly on the crossing scores
the middle at any score, and a test plays a run of seven perfect blocks to a 14–7 win in
10.8 s to prove it. Two players who both play perfectly therefore *do* finish level, and the
tie-break is what separates them — which is the honest answer: they were equal.

## Two perches, and nothing between them **[ours]**

Nothing is shared and nothing alternates — no board to contest, no turn order, no first
mover. Each seat has its own perch, its own pole, its own budget and its own swinging block.
The blocks come out of one seeded stream and are handed out **by index**, so the nth block
of the match is the same block for both seats: the same width, from the same side. The two
seats are therefore not merely balanced on average, they are set the **identical run of
problems** — at their own pace, since each seat spends its own blocks when it chooses to.

Everything is written in **perch-local** coordinates: `across` is signed distance from your
own pole, `height` is measured up from your own floor. Both perches hold literally the same
numbers, and the half turn that separates them lives in `worldXOf` / `worldYOf`, which only
the renderer calls.

### How the fairness was verified

Not by argument, and mostly not statistically:

- **By equality.** Two seats given the identical press script hold byte-identical perches at
  the end of a match, and the match is a draw. Because both are perch-local, that is an
  `toEqual` on two records rather than mirror arithmetic that could itself be wrong.
- **By mirror.** Two genuinely different players — one holding out for the middle, one
  taking the first block that would catch — are swapped between the seats over 16 seeds, and
  every number comes out the other way round: points, middles, stumbles, blocks spent and
  the winner. A companion test asserts the two scripts really do separate, so the mirror is
  not passing on two copies of one player.
- **By geometry.** The world mapping is an exact point reflection about the centre of the
  field, asserted to nine places.
- **By independence.** One seat playing fast and the other slow see the identical run of
  blocks, and what one seat does cannot change what the other is dealt — the stream is
  consumed by block *index*, never by time.
- **Statistically, only for the bots**, which do share a generator in a fixed order: equal
  tiers land at 47.5–52.3% over three independent families of 400 matches each.

## Scoring and the win condition

Points, resolved by the shared helper: `resolve({ kind: 'first-to', target: 13 }, …)` — see
`CONDITION` in `rules.ts`. Nothing here writes a comparison by hand, so "first to thirteen"
means in this game exactly what it means in every other one, and the case where both seats
cross on the same block is not left to whichever seat the code happened to check first.

A block scores 2 in the middle, 1 anywhere else on the pole, and nothing at all otherwise.
When the budget runs out the same helper settles it on points (`timeExpired`).

After a block settles: 0.45 s, then the next block is hung. After a stumble: 0.75 s. Nothing
alternates and nobody serves — each seat's clock is its own.

### The tie-break **[ours]**

Two seats are set identical blocks, so two evenly matched players finish level far more
often than they would in a game where they took turns — and both perfect players finish
level by construction. So "level on points" has to mean something:

1. **More middles.** Two players on the same points are not equal if one got there by
   settling blocks in the middle and the other by scraping the ends of the pole.
2. **Then fewer stumbles.** A block lost by leaving it sliding is the mistake this game is
   about.
3. Level on all three is an honest draw.

`breakTie` is only ever reached through `resolve` returning `draw`, so it separates rather
than replaces the shared helper.

## Controls

| | Seat one (near) | Seat two (far) |
|---|---|---|
| Keyboard | `Space` | `Enter` |
| Pointer | tap anywhere in the near half | tap anywhere in the far half |

One press is the whole game: it hops the chicken and cuts the block loose in the same
instant. **Nothing is held** — the game reads `actionPressed`, which is an edge, so a key
left down cannot hop twice and a finger resting on the glass cannot hold the rope. Both are
driven through the real input stack in `game.test.ts` and asserted.

Nothing else on the keyboard does anything: W A S D, the arrow keys, Escape, Tab and a stray
letter are all pressed in a test and the two chickens do not move. The manifest line
therefore names one key a seat and never offers the two halves as one player's choice — the
shell does **not** map both halves onto the active seat; `setBoardSeat` moves *pointer*
ownership and touches the keyboard not at all.

The two sources combine by the engine folding this seat's action key and a pointer down in
this seat's zone into one edge before the game sees it. There is no mode to switch between
them, and a match is completable with either alone.

### Why a thumb and a keyboard are worth exactly the same

There is no cadence to out-press and no aim to out-point: the only decision in the game is
*when*, and both instruments deliver "now" with the same one-step resolution. `game.test.ts`
plays a 40-second match twice from the same seed — once spelling the script with `Space`,
once with a finger in the near half on the same schedule — and asserts the two traces are
identical, not merely similar. That is why `sameInputClassOnly` is `false`.

## Edge cases

- **Simultaneous input.** The two seats never touch the same object, so there is nothing to
  order. Both perches are stepped in the same call and neither can read the other.
- **No input at all.** Every block is cut down after 3 s and charged to the budget, so two
  absent players play 16 lost blocks each and the match is a 0–0 draw in 56.9 s. This is the
  case a stacking game has to earn: nothing arrives on its own.
- **Mashing from the first frame.** Every block is cut at the end of its swing, where it is
  still and 106–126 units clear of an 88-unit pole, so mashing scores **exactly nothing** —
  16 misses and a 0–0 draw in 21 s. Asserted, because "press faster" must not be a strategy.
- **Input in the other seat's zone.** It belongs to the seat it started in and keeps that
  ownership across the midline. That lives in the engine; the game reads `input.seat(seat)`
  and never asks where a finger is. A test drags a finger from the near half into the far
  half and asserts the far chicken was not touched.
- **A press while the chicken is in the air, or between blocks.** Nothing. The hop is a
  fixed clock, and a hop whose length the player controlled would let a greedy release be
  bought back with a bigger jump — the "before the chicken lands" half of the rule would
  stop meaning anything.
- **A block that stops one unit off the end of the pole.** It falls, exactly as one that
  stopped a hundred units off does. Deliberately not graded: a near miss that scored
  something would make the middle band a formality rather than the thing the game is about.
- **Boundaries.** A block resting exactly on the end of the pole catches; a hair past it
  misses. A block resting exactly on the edge of the middle is the middle. A block that
  settles on the very last instant of the hop counts; a hair later is a stumble. All four
  are asserted at 1e-9.
- **A stumble beats position.** A block that would have stopped dead centre but was still
  sliding is a stumble, not a middle.
- **A match nobody can win.** The budget bounds it (below), and 90 s bounds that.

## Termination

The property this game had to earn, because nothing here arrives on its own — no wall
approaching, no ball in play. It is guaranteed **twice over**:

1. **The hesitation clock.** A block nobody releases is cut down after 3 s and charged to
   the budget. So a seat cannot stall: every block it is dealt is spent, by pressing or by
   waiting.
2. **The budget.** 16 blocks a seat, after which the perch is `done`; when both are, the
   match is settled on points by the shared helper.

The worst a player can make one block cost is the whole hesitation clock, then a hop, then
the longest rest there is — hold it to the brink and then leave it sliding — so the outside
bound is `1.2 + 16 × (3 + 0.76 + 0.75) = 73.4 s`, and a match nobody plays costs
`1.2 + 16 × (3 + 0.45) = 56.4 s`. `ROUND_SECONDS` (90 s) sits above that as a second,
looser backstop, because a game whose only guarantee lives in its pacing constants is one
change away from running for ever. Nothing reaches it today.

Measured: two `easy` bots — the slowest pairing there is, because a weak bot loses blocks to
hesitation rather than spending them — average **47.6 s** and none of 400 matches failed to
finish. That is comfortably inside the ten simulated minutes `apps/web/src/data/
termination.test.ts` allows. `rules.test.ts` asserts the arithmetic bound, drives the worst
single block, and runs the idle, mashing, brink and bot-pair cases to a decision.

## Determinism

- **All randomness is seeded**, and it is consumed by the *match* rather than by a perch:
  `ensureDrawn` is the only call `step` makes, and it draws by block **index**, so what
  either player does cannot change which blocks either of them is given. A test plays two
  matches completely differently from one seed and gets the identical run of amplitudes.
- **The block is analytic on both sides of the release.** A hanging block is
  `amp · sin(phase)`; a cut-loose one is exact constant-deceleration motion evaluated at the
  time it has been sliding. Nothing is integrated, so nothing depends on the step size — and
  the slide is *capped* at the hop, so the landing is judged on the block's exact state at
  0.76 s however the steps happen to fall. A test judges the same release at 60 Hz and at
  120 Hz and gets the same landing. At the crossing the stopping point sweeps 13 to 17 units
  in a 60 Hz step, against a middle band that has narrowed to 27 by the end of a match, so
  judging on the step boundary instead would decide half the close ones by where the frame
  happened to land.
- **Every delay is counted in simulated seconds off the fixed step**, never in wall time:
  `wait`, `air`, `rest`, `since`, `elapsed`, and the bot's `look` and `frozen`.
- **The press is answered before the swing moves on**, so a release lands on the block the
  player was looking at rather than one a frame later — which at the crossing would charge
  everybody 14 units of stopping point they had no way to know about.
- **Nothing allocates per step.** The two block arrays are preallocated to the budget and
  drawn into once each; the step result is one record rewritten in place. Both are asserted,
  because block spawning is the classic offender.
- **Nothing is expressed in pixels.** Every number above is a logical unit; the renderer is
  the only code that knows what a device is. `cross-viewport.test.ts` plays the identical
  trace at 320 × 568 through 4K and compares raw floats.
- `resetMatch` leaves a match indistinguishable from a fresh one, arrays included, so a
  rematch cannot start part-played.

## The bot

It reads **the shadow** — where the block would come to rest if it were cut loose right now
— the block's speed, its own hesitation clock and its own score. Every one of those is on
the screen in front of a player: the shadow is drawn on the pole as a bar (wide when it
would catch, a narrow tick when it would not, a filled gold square when it would settle in
the middle), and the score is on the shell's HUD. `botJump` is handed **one perch and no
match**, so there is nothing in scope for it to peek at, and a test asserts 120 calls leave
the other seat untouched.

The policy is one line for every tier: **read the shadow, and release on the look where
waiting another look would put it further from the pole than it is now.** That last clause
took measuring. The obvious version releases at the first look where the shadow is inside
the band it will accept — and because the shadow sweeps in from one side, that puts every
release on the *entering* edge of the band. The tiers then differ in how far in they get
before they commit rather than in how accurate they are, `hard` lands consistently 20 units
to one side, and the whole thing measures reaction time twice instead of measuring reaction
and aim once each. Comparing this look with where the next one would be centres the release
on the pole, leaving spread as the only thing separating the tiers.

Every tier holds out for the middle for the first 55% of the hesitation clock and then takes
whatever catches, because that is a fact about the scoring rather than about the player.

The three tiers differ only in these four numbers:

| | reaction | aim error | blunders/s | haste |
|---|---|---|---|---|
| `easy` | 0.30 s | ± 96 | 0.42 | 0.12 s |
| `normal` | 0.125 s | ± 52 | 0.28 | 0.025 s |
| `hard` | 0.08 s | ± 40 | 0.20 | 0 |

- **Reaction** is both how long it takes to notice the moment and how finely it can place a
  release inside one, since it cannot press between two looks.
- **Aim error** is drawn **once per block and held** to the release, never per step — a
  fresh error sixty times a second averages to zero and every tier plays the same, which is
  the bug `@duelbox/game-sdk`'s `misjudgement` exists to prevent and which three games here
  shipped before it did. `easy` misreads the shadow by more than the whole pole is wide.
- **Blunders** freeze it for 0.45 s, which is most of a swing — long enough that it misses
  the instant it was lining up. A duration rather than a coin flip per step, because a bot
  that re-decides twenty times a second and hesitates for one of those has jittered rather
  than blundered.
- **Haste** is how much "still sliding" it is willing to talk itself into. Not information:
  every tier can see the speed. `hard` talks itself into none, and over eight seeded matches
  it stumbles exactly zero times — asserted.

Look intervals **wander** by ±35%, and that is not a flourish: without it the tiers do not
order at all. A bot looking on a perfectly regular tick, at a block that always starts from
the same place, lands every look on the same swing phases for the whole match — so the
offset between its looks and the instant it wants is a *fixed* error rather than a spread,
and it never averages out over any number of blocks. Measured with aim error switched off,
arrival error swung between 7 and 33 units as reaction was stepped from 0.04 s to 0.3 s, in
no order whatever, and sweeping the aim error from 0 to 40 units moved arrival by 0.9 units.
Two of the three knobs did nothing and the middle tier came out strongest.

### What each tier does with a block

300 seeded matches per tier, driven through `ChickenJumpGame`, both seats on the same tier.

| | blocks/match | middle | on the pole | missed | stumbled | never cut | points/match | longest match |
|---|---|---|---|---|---|---|---|---|
| `easy` | 15.3 | 22% | 19% | 12% | 13% | 33% | 9.7 | 56.9 s |
| `normal` | 8.4 | 53% | 31% | 1% | 4% | 6% | 11.6 | 35.4 s |
| `hard` | 7.4 | 68% | 26% | 0% | 0% | 1% | 12.0 | 19.7 s |

A third of `easy`'s blocks are never cut at all, which is what a beginner at this game
actually looks like — and it is also why an `easy` pair is the longest match in the game
rather than the shortest.

### Measured win rates

400 seeded matches per pairing, driven through `ChickenJumpGame` itself, seeds `1 + 61n`.
Cell is the **row seat's** (p1's) win share. One draw in 3600 matches; none failed to finish.

| p1 \ p2 | `easy` | `normal` | `hard` |
|---|---|---|---|
| `easy` | 52.3% | 0.0% | 0.0% |
| `normal` | 99.5% | 48.8% | 8.3% |
| `hard` | 100.0% | 93.5% | 49.3% |

Mean match length ran from 13.8 s (`hard` v `hard`) to 47.6 s (`easy` v `easy`). Equal tiers
land at 48.8–52.3%; repeated over two further independent seed families the spread was
47.5–52.3%, which at 400 samples is inside 2.5 points of one standard error. That residual
is the fixed order in which the two bots draw from the shared generator, and it is the only
asymmetry the design has. `rules.test.ts` holds the ladder and the seat balance to a shorter
run of the same measurement on every commit.

## Presentations

See `docs/presentation.md`; nothing here re-decides it.

- **Shared-screen** — the two perches stack, p1's floor along the bottom edge and p2's along
  the top, with a fence between them that belongs to neither. The layout is a point
  reflection about the centre of the field, so both players read their own perch upright
  with their own floor nearest them and neither sees more of anything than the other.
  Nothing rotates: there are no turns, so there is nothing to flip, and `getActiveSeat`
  returns `null` for ever so the shell keeps a pointer zone for each seat.
- **Single-seat** — the local seat owns the viewport. The simulation is byte-identical; only
  placement changes. `game.test.ts` asserts a `single-seat` match on seat two traces
  identically to a `shared-screen` match on seat one from the same seed.

Colour is never the only signal (rule 7): p1's chicken wears a single comb and p2's is banded
across; p2's stacked blocks are notched down the middle and its hanging block is barred
across, where p1's are plain; p1's straw is upright and p2's raked; the two halves are two
distinguishable shades in greyscale. The shadow on the pole carries **shape** as well as
colour — a wide bar when the block would catch, a narrow tick when it would not, a filled
square when it would settle in the middle — and the flash after a block carries shape too: a
gold post for the middle, a chalk bar for the pole, a broken cross for everything that
scored nothing, so a miss, a stumble and a block nobody cut all read as "that one is gone".

## What is not specified here

- Sound. No game in the collection has it yet.
- Reduced motion: the hop arc, the stumble lean and the landing flash are the only motion
  this game adds beyond the simulation, and none is currently gated on the preference.
- The `roundSeconds: 60` on the manifest is a catalogue label and ends nothing. The two real
  bounds are `MAX_BLOCKS` and `ROUND_SECONDS`, both in `rules.ts`.
