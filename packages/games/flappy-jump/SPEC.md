# Flappy Jump — specification

**Archetype:** `rt-split` · **Category:** Platform · **Logical box:** 640 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised, 40 hoops (≈ 64 s) hard bound

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two lanes, one each. Your jumper holds its place along your lane while hoops drift toward
it; tap to beat a wing and rise, hold to glide down slowly, let go and fall. Thread the
hoop as it passes and that is a basket. First to ten.

## Observed rules

From the reference genre: _"Tap to jump and shoot as many baskets as you can. First to 10
wins."_ — one button, a jump, hoops to score through, and a target of ten.

Everything below is how those four facts became a simulation.

## The field

| | Value | Why |
|---|---|---|
| Field | 640 × 1000 | Portrait: two people either side of an upright phone |
| Lane | 470 tall, ×2, with a 60-unit divider | Symmetric under a half turn |
| Jumper | radius 15, fixed at lane-x 150 | The world scrolls; the jumper never moves sideways |
| Flying band | centre held in 15 … 455 | Bounded by its edge, so it rests on the floor rather than in it |
| Gravity | 1350 u/s² | One beat = 82 units of climb, 0.35 s to the top of the arc |
| Wing-beat | sets climb to 470 u/s, recharges in 0.18 s | Sets, never adds — beats do not stack |
| Glide | caps a fall at 150 u/s | The second control, from the same button |
| Free fall | terminal 720 u/s | A drop from the ceiling takes about a second |
| Hoops | 290 u/s, 440 apart (1.52 s) | Two on screen at once, so you can plan |
| Gap | 144 at nil, −6 a basket, floor 90 | Clean window 57 → 30 |
| Rim posts | 74 long, 12 thick | Long enough that going round is a commitment |
| Gap centre | 110 … 360, ≤ 150 from the last | A path rather than noise |
| Rim strike | −260 u/s and 0.32 s stunned | A near miss costs more than a wide one |
| Match | first to 10 baskets, 40 hoops maximum | |

## Two lanes, and why that is the whole design **[ours]**

There is no ball to contest, no board to share, no turn order, and no first mover. Each
seat has its own jumper, its own floor, and its own hoops. **The hoops come out of one
seeded stream and are pushed into both lanes on the same step with the same gap centre**,
so the two seats are not merely balanced on average — they are handed the identical run of
obstacles at the identical moment.

The simulation is written in **lane-local** coordinates: `height` above your own floor,
`lead` ahead of your own jumper. Both lanes therefore hold literally the same numbers, and
the half turn that separates them lives in `worldXOf` / `worldYOf`, which only the renderer
calls.

### How the fairness was verified

Not statistically. `rules.test.ts` plays the **identical run of taps into both seats** and
asserts `expect(match.p1).toEqual(match.p2)` — every field, every hoop, every float. A
second test plays a real match that way and asserts it ends in a **draw**, because neither
seat can have had it easier. A third asserts the world mapping is an exact point reflection
about the centre of the field.

The one asymmetry that could exist is that the two bots draw from the shared generator in a
fixed order. That is measured rather than reasoned about: see the table below, where equal
tiers land at 45–50% over 400 matches each.

## The controls: one button says two things **[ours]**

| | Seat one (near) | Seat two (far) |
|---|---|---|
| Keyboard | `Space`, or `W` | `Enter`, or `↑` |
| Pointer | tap anywhere in the near half | tap anywhere in the far half |

A fresh press beats a wing. Anything **still held** glides — the fall caps at 150 u/s
instead of running to 720. Holding while rising does nothing at all, so a held button is
never simply a better beat. `W` and `↑` are folded in on their own rising edge, because
they are what a player reaches for first in a game about flying and the movement axis is a
level rather than an edge.

### The wing recharge is what makes this fair across input families

A one-button game is decided by how fast you can press, and a key can be pressed faster
than a screen can be tapped. Measured, with the beat set by the press alone:

| | climb rate |
|---|---|
| Pressing on every step | 447 u/s |
| Tapping six a second | 346 u/s |

29% of the game, for nothing but the instrument in your hand. Road Dodge answers that
problem by declaring `sameInputClassOnly`; this game answers it in the rules instead. **The
wing needs 0.18 s to recover**, so everybody is capped at 5.45 beats a second and 335 u/s —
a rate a thumb reaches comfortably.

### The press has to be *buffered*, not dropped

The first version ignored a press that arrived mid-recharge, and that was worse than having
no cap at all. It puts an aliasing beat between the player's rhythm and the wing's: a
tapper at six a second lands every other tap inside the recharge, loses it, and climbs at
**234 u/s** — a penalty that depends on a rhythm nobody can feel. Holding the press until
the wing is ready makes the ceiling flat:

| Tap rate | 60 Hz | 20 Hz | 12 Hz | 7.5 Hz | 6 Hz | 5.45 Hz | 5 Hz | 4 Hz | 3 Hz |
|---|---|---|---|---|---|---|---|---|---|
| Climb u/s | 335 | 335 | 335 | 335 | 335 | 335 | 330 | 299 | 248 |

Flat at and above the recharge rate, and degrading smoothly below it. `game.test.ts` drives
a masher and a six-a-second tapper through the real input stack and asserts they climb the
identical distance.

## A hoop resolves three ways **[ours]**

- **Through the gap** — the whole jumper fits between the lips: a basket.
- **Clear of the rim** — over the top of the upper post or under the bottom of the lower
  one: a plain miss. Costs the hoop and nothing else.
- **Anything between** — a **rim strike**: the jumper is knocked 260 u/s toward its floor
  and stunned for 0.32 s, during which the wing will not beat.

So going *round* a hoop is a legitimate choice with an honest price, and cutting it fine is
worse than not trying at all. That asymmetry is what stops a weak player's match being a
sequence of coin flips: a bad approach can be abandoned. A post that reaches the floor or
the ceiling seals that side, so a low hoop is one you must go through; the centre band
guarantees at least one side of every hoop is open.

Resolution reads the height at the **instant** the hoop's plane passes, interpolated across
the step. A jumper falling at the cap covers 12 units in a step against a clean window that
narrows to 30, so sampling on the step boundary would decide a third of the close ones by
where the frame happened to land.

## The rule that keeps a lead from running away: the gap narrows **[ours]**

**Every basket you score costs you 6 units of gap, down to a floor of 90.** The hoops
themselves are shared and identical; what differs between the lanes is only how much of
each one is open, and that depends on nothing but your own score. It is a handicap you
inflict on yourself by succeeding — symmetric by construction, and needing no knowledge of
the opponent, which matters because this game has no shared state by design.

It exists because of what the shared stream does to two evenly matched players. Measured
over 200 matches a side:

| | fixed gap | narrowing gap |
|---|---|---|
| `hard` hoops threaded | 93% | 84% |
| Hoops to reach ten | 11.7 | 12.9 |
| `hard` v `hard` drawn | 37.5% | 13% |

A perfect run reaches ten in ten hoops, and two perfect runs on identical hoops are a draw.
Narrowing the gap puts the last two baskets out of reach of a perfect run, so a match has
something in it to separate the two players by. It also makes the tenth basket the hard
one, which is the right shape for a game that ends at ten.

## Win, lose, draw

- **Win:** first seat to 10 baskets.
- **Level on baskets:** the cleaner run wins — fewer rim strikes.
- **Level on both:** the longer run of consecutive baskets wins.
- **Draw:** only a pair level on all three.

Two tie-breaks rather than none, and both were added because the drawn share was measured
and was not acceptable. Two `hard` bots drew **25%** of matches on baskets and rims alone,
and **11%** once the longest run was added behind them. Both also say something
true: two players on ten baskets are not equal if one bounced off five rims getting there,
and two who bounced off the same number are not equal if one put nine baskets together in a
row.

## Termination is structural

**Hoops enter at a fixed spacing and travel at a fixed speed whatever either player does.**
The field is worth exactly 40 of them, so the match is over after `1.4 + (40 × 440 + 530) /
290 = 63.9 s` of simulated play and is then called on baskets. A match in which neither
player ever scores still ends, because ending does not depend on scoring — `game.test.ts`
runs a match nobody plays at all and expects `{ p1: 0, p2: 0, winner: 'draw' }`.

`ROUND_SECONDS = 90` is a second, looser backstop. Nothing reaches it today, and a test
asserts the hoop budget bites first — it is there because `roundSeconds` in the manifest
ends nothing (the catalogue card is its only reader) and a game whose only guarantee lives
in its pacing constants is one change away from running for ever.

## Edge cases

| Case | Behaviour |
|---|---|
| Two hoops resolving in one step | Cannot happen: 440 apart against 4.8 units of scroll a step |
| A hoop retired before it is resolved | Cannot happen: it must cross the jumper first, and crossing resolves it |
| Press during the recharge | Buffered and spent the step the wing is ready |
| Press during a stun | Buffered; the stun is not shortened |
| Jumper at the floor or the ceiling | Stopped dead, never bounced — a bounce would hand out altitude nobody earned, and the ceiling is the divider the two lanes share |
| Both seats reach ten on the same hoop | Resolved by rims, then by longest run, then drawn |
| Both players idle | Every hoop resolves as a rim or a miss, the budget runs out, and the match is drawn |
| Match already decided | `step` returns immediately and nothing moves |
| Rematch on the same instance | `init` resets the match, both bot states, the clock and the key latches |

## The bot

Three tiers, expressed only as **reaction delay, aim error, and blunder rate** — never as a
stronger wing, a faster recharge, a wider gap, a shorter stun, or a look at anything a
player cannot see (rule 6). All three run the same policy and fly through the same `fly()`.

| Tier | Reaction | Error | Blunders |
|---|---|---|---|
| easy | 0.30 s | ±66 u | 0.55 /s |
| normal | 0.15 s | ±30 u | 0.32 /s |
| hard | 0.07 s | ±9 u | 0.20 /s |

A blunder freezes it for 0.36 s, which drops it 141 units out of a glide — more than the
widest clean window, so a blunder is reliably a hoop. The rate is expressed **per second**
rather than per look: a per-look chance means the sharp tier blunders four times as often
as the slow one for the same number, and two of the three knobs then pull against each
other.

### The policy: climb until a glide would land on the hoop, then glide **[ours]**

`height − 150 × secondsToHoop` is **invariant while gliding** — the jumper loses exactly the
height the shrinking clock gives back. So a jumper that climbs until that quantity reaches
the gap centre and then glides arrives on the gap centre, and the only error left is how
long it waited before looking. That converts reaction delay into landing error at 150 units
a second, which is what makes three numbers order the tiers at all.

It took three tries, and the first two both **inverted** the tiers:

1. **Hover on a projected height.** A beat *sets* the climb rate, so every beat is worth 82
   units whoever makes it, and a hover is a sawtooth 82 units deep sitting entirely above
   its own target. Looking more often does not shrink the sawtooth. Measured: `hard`
   finished 40 hoops with **0.1 baskets and 38 rim strikes** while `easy` finished with
   **9.8** — the most consistent tier was the least accurate one.
2. **Glide slope with an asymmetric band.** Beat below the aim, trim only 12 units above
   it: every correction was upward, so the band the bot flew sat above its target. `hard`
   arrived a mean **62 units high** with a spread of 43. Centring the band on the aim left
   the spread — which is what reaction delay governs — as the only thing separating the
   tiers.
3. **Gate the beat on the recharge.** Adding the input buffer broke the bot, because a bot
   asking for a beat during its own recharge now got one it had not chosen: `hard` fell from
   85% to 72% and its bias more than doubled. It now glides instead of asking. It reads only whether
   its own wing is ready, which the jumper draws as a thin ring, so a player can see it too.

Arrival error, measured over ~250 hoops a tier:

| Tier | mean offset | spread | hoops threaded |
|---|---|---|---|
| easy | −58 u | 103 u | 35% |
| normal | −1 u | 54 u | 68% |
| hard | +13 u | 29 u | 84% |

`easy` flies low and wide, `normal` is centred and loose, `hard` is centred and tight. That
`easy` is *biased* rather than merely noisy is a consequence of looking three times a
second: it free-falls between decisions.

### Measured, 400 matches a pairing (seeds 1000–1399)

| | p1 wins | p2 wins | draws | p1 win % | avg length |
|---|---|---|---|---|---|
| easy v easy | 197 | 203 | 0 | 49% | 38.2 s |
| normal v normal | 195 | 201 | 4 | 49% | 21.0 s |
| hard v hard | 184 | 163 | 53 | 46% | 17.2 s |
| easy v normal | 14 | 386 | 0 | 4% | 23.4 s |
| normal v easy | 394 | 6 | 0 | 99% | 23.1 s |
| normal v hard | 57 | 334 | 9 | 14% | 18.3 s |
| hard v normal | 324 | 67 | 9 | 81% | 18.1 s |
| easy v hard | 0 | 400 | 0 | 0% | 18.8 s |
| hard v easy | 398 | 2 | 0 | 100% | 18.4 s |

Equal tiers land at 46–49%, inside the 45–55% band the bot issue asks for. Every tier beats
the one below it **from either seat** — `normal` over `easy` 99% and 97%, `hard` over
`normal` 81% and 84%, `hard` over `easy` 100% and 100%.

The residual 14% of drawn `hard` v `hard` matches is the honest cost of perfect symmetry:
two near-flawless players handed the identical hoops at the identical moment sometimes have
nothing to be separated by. It falls to 1% at `normal` and to none at all at `easy`.

## Presentation

- **Shared-screen** — the field is symmetric about its own centre and carries no text, so
  both seats read it upright with nothing rotated. Each seat's floor is the edge nearest
  them, their hoops come from the far edge toward them, and their baskets fill as pips up
  their own outer edge.
- **Single-seat** — identical simulation; the shell owns the layout. `game.test.ts` asserts
  the two presentations produce a byte-identical trace from the same seed.

The hoop budget is drawn as ticks across the divider — the one strip that belongs to
neither player, for the one resource that genuinely belongs to both.

## Rule 7: never colour alone

- p1's jumper carries a single centre spot; p2's is banded across.
- p1's rim posts are plain; p2's are barred.
- p1's basket pips are plain; p2's carry a notch.
- The two floors are boarded differently — p1's upright, p2's raked.
- The two lanes are two shades, so which half is yours survives greyscale.
- A jumper whose wing is ready wears a thin ring; a stunned one wears a closing one.
