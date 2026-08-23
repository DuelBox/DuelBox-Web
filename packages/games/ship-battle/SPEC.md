# Ship Battle — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 180 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions rather
> than observations. Every number below is read out of `src/rules.ts`, `src/game.ts` or
> `src/manifest.ts`, and every measurement is reproduced by `src/game.test.ts`.

## Observed rules

> **Ship Battle** — "Protect your ship from your opponent's cannon shots! Move your finger
> to move the shield!" (`docs/observed-rules.md`, line 120)

That is the whole of it, and it determines three things: there is a ship, there are cannon
shots coming at it, and the defence is a shield moved by a finger. It leaves open who
fires, when, at what, how a shield stops anything, what a shield costs, and how the match
ends. Everything below is **[ours]**.

The one thing the rule does settle is which side of the exchange the player is on. This is
a *defensive* game: the sentence names protecting first, and the verb the player is given
is moving the shield. So the design puts both people on the defensive side as often as the
offensive one, and the fun is in the reach rather than in the aim.

## The shape of a turn

The constraint that decided the design is not in the rules. It is that **only one seat may
be acting at any instant** — the device has one pointer surface, and a turn-based game
hands it to whoever is to move. A reaction game where one player shoots and the other
dodges seems to need both people acting at once, which one phone cannot give.

The answer is that the gunner and the defender get **the same turn in two halves**:

| Phase | Who holds the board | What they do | Length |
|---|---|---|---|
| `aim` | the attacker | trains the cannon on a hull section and fires | 1.8 s clock, 0.3 s arming |
| `flight` | **the defender** | slides the armour plate to meet the shell | 1.4 s |
| `reveal` | the defender | sees the result, repositions in the smoke | 0.5 s |
| `over` | — | the last section goes, then the result | 1.2 s settle |

`getActiveSeat()` therefore changes **twice a turn**, and the board turns to face the new
holder each time (0.24 s, shorter than the SDK default because it happens twice a turn
rather than once). The shell reads that value every step and moves pointer ownership with
it. Nothing is hidden from anybody at any point: both hulls, both plates and the shell's
landing point are all on the screen the whole time. The contest is reach, not guesswork.

## The board

Every constant, with the reason it has that value. Read out of the code.

| | Value | Where | Why |
|---|---|---|---|
| Hull | 6 × 2 = 12 sections | `HULL_COLUMNS`, `HULL_ROWS` | Long and shallow, like a ship from the side. The length is the axis the plate cannot cover. |
| Plate half-width | 0.7 cells | `SHIELD_HALF_X` | Wider than a section, so an imprecise slide along the hull is forgiven a little. |
| Plate half-height | 0.45 cells | `SHIELD_HALF_Y` | **Shorter** than a deck, so parking between the two decks covers neither and choosing a deck is a real decision. |
| Plate speed | 1.8 cells/s | `SHIELD_SPEED` | One number for every instrument — see Controls. |
| Plate travel bounds | x ∈ [0.7, 5.3], y ∈ [0.45, 1.55] | `SHIELD_MIN/MAX_*` | The plate stays wholly over the hull. |
| Plate start | (3.0, 0.5) | `SHIELD_START_*` | Middle of the upper deck, identically for both seats. |
| Charges | 2 | `SHIELD_CHARGES` | Two blocks and the plate is knocked out. |
| Recharge | 2 defensive turns | `RECHARGE_TURNS` | Blocking nothing while it is rebuilt. |
| Flight | 1.4 s | `FLIGHT_SECONDS` | The defender's whole window. |
| Aim clock | 1.8 s | `AIM_SECONDS` | Fires whether or not anybody acts. |
| Arming | 0.3 s | `ARM_SECONDS` | A release left over from the previous phase cannot fire the gun. |
| Board geometry | hull at (90, 330), 120 units a section | `HULL_ORIGIN_*`, `HULL_CELL` | Render-side, exported because `hullCellAt` is the mapping a finger goes through and the tests need the same one. |

### Why the hull is long and shallow

This is the single number that makes the game work, and it is worth stating as a
measurement rather than as an intention. A shell is in the air for 1.4 s and the plate
covers 1.8 × 1.4 = **2.52 hull cells** in that time. So:

- From the middle of the hull, the longest slide any section can demand is **1.88 cells** —
  inside the flight, so every shot is answerable and the defender is only racing.
- From either end, the far end demands **4.14 cells** — outside the flight, so the shot is
  unanswerable and the gunner takes a section for free.

Whether a shot can be answered *at all* is therefore decided before it is fired, by where
the defender chose to leave the plate. That is the game. `rules.test.ts` asserts both
numbers against `SHIELD_SPEED × FLIGHT_SECONDS` rather than as literals, so tuning either
one cannot quietly break the claim.

## Scoring and the win condition

`WinCondition` is `{ kind: 'reduce-to-zero' }`, resolved by the SDK's `resolve()` with the
**sections still standing** as each seat's health:

```ts
resolve(WIN, { p1: intactCount(game.p1), p2: intactCount(game.p2) })
```

No comparison is written by hand. `getScore()` reports the *breaches on the other hull*
counting up from zero, because that is the number a player is actually watching; the win
condition reads the intact count going down. Twelve breaches sinks a ship.

**There is no draw.** One shell lands at a time, so the two hulls cannot reach zero on the
same step and the `'draw'` branch of `reduce-to-zero` is unreachable here. A test states it
by taking both hulls to their last section and playing on.

After a shot: the reveal runs for 0.5 s, then `passTurn()` hands the cannon to the other
seat and trains it on a section still standing. There is no reward for a hit and no penalty
for a block — the turn alternates unconditionally, which is what keeps the two seats
symmetric. **[ours]**

When the twelfth section goes, the phase becomes `over` immediately but the *winner* is
withheld for 1.2 s (`SETTLE_SECONDS`) so the player sees the last section go rather than a
result card over the top of it.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Aim | `W A S D` walks the sight, one section a press, repeating on a hold | arrows, likewise |
| Fire | release `Space` (after 0.3 s arming) | release `Enter` |
| Defend | `W A S D` slide the plate | arrows slide the plate |
| Pointer | drag anywhere on the hull to put the sight there; **lift to fire**; then drag to slide the plate | same — the whole surface belongs to whoever is to move |

The manifest strings are:

- keyboard: *"Player one W A S D and Space, player two arrows and Enter: aim and fire, then slide your armour plate"*
- pointer: *"Drag to aim, lift to fire — then drag to slide your armour plate in front of the shell"*

Both are driven through the engine's own `InputManager` and `DEFAULT_BINDINGS` in
`game.test.ts` rather than through a hand-written `SeatInput`, so a string naming a key
nothing reads fails the suite. Seat one pressing `Space` on seat two's turn is asserted to
do nothing, and a whole match is completed on each family alone.

The first draft of the keyboard string described only the gunner's half. A keyboard player
who is never told that the same keys slide the plate never defends — which is the half of
the game the observed rule is actually about — so the string now names both halves.

### How the two sources combine

They do not switch; both are read in the same step and the pointer has the last word. In
`aim`, the keys walk the sight and a finger on the hull then puts it wherever the finger
is. In `flight` and `reveal`, a pointer names a **destination** the plate travels towards
and the keys name a **direction** it is pushed along — and both are capped at the same
`SHIELD_SPEED`.

That cap is the whole of input parity here, and it is not a detail. A finger can name a
point at the far end of the hull instantly and a key cannot. If the pointer *teleported*
the plate, a thumb would reach every interception a keyboard could not, and a match would
be decided by which peripheral somebody happened to be holding — exactly what rule 10 and
`docs/input-parity.md` exist to prevent. A test drives thirty steps of each and asserts the
plate lands in the same place to ten decimal places.

The far seat reads the board half a turn round, so **both** of their axes invert — handled
by `SeatFlip.rotated` and asserted from both sides.

## Edge cases

| Case | What happens | Why that is right |
|---|---|---|
| **No input at all** | Every phase has a clock. The aim phase fires after 1.8 s at whatever the sight is on. | A turn moves on whether or not anybody touches the screen, which is what makes the match end. Two silent humans still play a whole match to a winner. |
| **Simultaneous input** | Impossible by construction: exactly one seat is active at every instant, and the shell hands the pointer surface to that seat. The other seat's keys are read and ignored. | A shared board belongs to whoever is to move. Seat two holding the arrows during seat one's aim moves nothing. |
| **Input in the other seat's zone** | The split is `shared`, so there are no zones: the whole surface is the active seat's. A drag that crosses the midline keeps feeding the seat it started in. | Dividing the surface on a rotating board made the far row of cells untouchable in Tic Tac Toe — see the note in `packages/engine/src/seat.ts`. |
| **Input during the flip** | Suppressed for the whole 0.24 s. `SeatFlip.acceptsInput` is false and the game honours it. | A tap on a board half way round lands somewhere the player did not aim, and whose it was would depend on frame timing. |
| **Aiming at a hole** | `aimAt` snaps to the nearest section still standing; ties break to the lower index. | A shot is never wasted on damage somebody already did, and two devices must snap the same way. A test plays a full bot match and asserts zero shots resolved as `'none'`. |
| **Plate over a hole** | The shell resolves as `'none'` and **no charge is spent**. | There is nothing there to protect. |
| **Plate at the edge of the hull** | Clamped so it stays wholly over the hull; `interceptX/Y` return a station the plate can actually occupy. | A defender must never be asked to stand off the ship to answer an end section. |
| **A shell exactly a half-width away** | Covered. The comparison is `<=` on both axes. | A knife edge either way; what matters is that it falls in the same place on every device. |
| **Both hulls on their last section** | Whoever fires next wins. | See "no draw" above. |
| **Stalemate** | Cannot happen — see below. | |

## Termination

**A hull cannot be defended for ever**, and this is a property of the rules rather than of
a clock.

A block costs a charge. Spending the second charge knocks the plate out for
`RECHARGE_TURNS` = 2 defensive turns, and it comes back one turn at a time *only on turns
it did not stop anything*. So a defender who never misses still blocks exactly two shells
in every four: **at most half of the shots at a hull can ever be stopped**, and twelve
sections therefore take at most 24 shells to breach.

That bounds a match at 2 × 24 = **48 turns**. A turn is at most 1.8 + 1.4 + 0.5 = 3.7 s, so
the worst case a match can reach is 177.6 s — which is where `roundSeconds: 180` comes
from. It is a bound, not a guess.

Three tests carry this:

- `rules.test.ts` plays a defender with a perfect hand — the plate teleported on to every
  incoming shell — and asserts the losing hull blocked exactly twelve and lost exactly
  twelve, so the ceiling is reached and not exceeded.
- `game.test.ts` does the same through the real `update()` loop and asserts the elapsed
  time is inside `manifest.roundSeconds`.
- Two idle humans still reach a winner, and so does every one of the nine tier pairings.

Measured bot-versus-bot match lengths, for what actually happens rather than the bound:
mean **78–98 s**, worst observed **111 s**, 27–39 turns.

## Determinism

Trivially deterministic, with four places that needed care.

- **All randomness is seeded** and comes from the one `Rng` on the `GameContext`. There are
  exactly three draws: the opening toss (`rng.bool()` once per match), the bot's stray-shot
  roll and target index (once per bot shot), and the bot's interception misjudgement
  (`rng.float()` twice, at the moment of firing).
- **The misjudgement is drawn once and held for the whole flight.** A fresh error every
  step averages to zero, every tier intercepts perfectly, and the difficulty does nothing —
  the bug `@duelbox/game-sdk`'s `bot-judgement` module exists to stop being written a
  fourth time. It is drawn in `#fire()` and acted on until the shell lands.
- **Every delay is counted in simulation steps**, converted once by `#stepsFor(seconds)`
  from the observed step rate, never from a wall clock.
- **The plate's slide is linear in time**, so its integral is step-size independent. A
  per-step multiplier would make the plate faster on a faster screen.

A whole bot match stepped at 120 Hz reaches the same winner, the same turn count and the
same breach pattern as the same match stepped at 60 Hz, with the plate agreeing to nine
decimal places. Two runs from one seed hash identically over every draw call.

The opening attacker is a **coin toss from the match seed**. A symmetric race hands the
match to whoever shoots first, and the honest answer is the one two people would reach for:
toss for the weather gauge, in front of both of them, before a shot is fired. It falls
1003/2000 to seat one over 2000 seeds.

## The bot

### What it reads

The enemy hull (which sections are gone) and the enemy plate (where it is). Both are drawn
on the screen for the whole turn, and a person aiming does exactly this by eye — rule 6
holds. A property test mutates the parts of a `Ship` the bot must *not* be reading —
`charges` and `downTurns` — and asserts the choice is unchanged.

Every tier's plate moves at exactly `SHIELD_SPEED`; a test measures the per-step travel of
all three and asserts they agree to nine decimal places. The tiers differ only in
properties of the *player*.

### How the tiers differ

| | `fireSeconds` | `reactSeconds` | `aimSpread` | `strayShots` | `readsReach` | `parks` |
|---|---|---|---|---|---|---|
| easy | 1.25 | 0.85 | 1.15 | 1.0 | no | no |
| normal | 0.9 | 0.42 | 0.62 | 0.3 | no | no |
| hard | 0.6 | 0.16 | 0.18 | 0 | yes | yes |

- **`fireSeconds`** — how long it takes to pull the lanyard. It swings the gun on to its
  chosen section half way through, so the person opposite gets the same warning a human
  gunner would give them.
- **`reactSeconds`** — how long its hands take to reach the plate once a shell is in the
  air. Counted **only while the board is settled**, because that is when a person can see
  the shell; a bot may not start reacting during the flip.
- **`aimSpread`** — hull cells of error in where it believes the shell will land, in the
  units the plate is measured in. `easy` at 1.15 is wider than the plate's own half-width,
  so it genuinely misses; `hard` at 0.18 is inside the half-height, so it does not.
- **`strayShots`** — how often it fires somewhere other than the section it worked out.
  `easy` is 1.0, so easy effectively fires at random; that is the whole of what makes it
  easy to beat.
- **`readsReach`** — whether it measures against the plate's *width and travel*
  (`requiredTravel`) or only eyes the distance to its middle (`plateDistance`). This is the
  difference between "far from the plate" and "out of the plate's reach", and it is the
  single largest thing separating a competent human from a beginner.
- **`parks`** — whether it uses the smoke after a shot to slide the plate back over the
  middle of what it has left. Only `hard`, and only in the window a person also has.

### Measured

Bot against bot, both seats, no human input, shared-screen presentation. Seeds
`400 + n·13` for n = 0…59, each pairing played twice with the seats exchanged — 120 matches
a row. Reproduce by running `src/game.test.ts`.

| | wins | rate |
|---|---|---|
| hard v easy | 120 / 120 | **100.0 %** |
| normal v easy | 117 / 120 | **97.5 %** |
| hard v normal | 114 / 120 | **95.0 %** |

A wider sweep — 200 seeds a pairing, 400 matches a row, at different seeds — gives 100.0 %,
97.8 % and 91.5 %, so the ordering is not an artefact of the seeds the test happens to use.

Same tier against itself, which is the seat-fairness measurement:

| | seat one won | share |
|---|---|---|
| easy v easy | 52 / 120 | 43.3 % |
| normal v normal | 69 / 120 | 57.5 % |
| hard v hard | 63 / 120 | 52.5 % |

Share of shells stopped, which is the defensive half of the difficulty (seeds `500 + n·17`,
40 matches a tier, both seats the same tier). The ceiling is 50 %:

| | blocked |
|---|---|
| easy | 21.5 % |
| normal | 32.9 % |
| hard | 41.0 % |

Two numbers worth reading honestly:

**`hard` against `hard` is decided by the toss.** Over 300 matches the seat that fired
first won 300 times. Two perfect gunners firing at sections the other's plate cannot reach
sink each other at the same rate, so the first shell fired is the whole margin — the mean
margin in a hard-versus-hard match is 1.0 sections. This is not a defect being tolerated: a
symmetric race has that property by construction, and the seeded coin toss is the reason it
is fair rather than the reason it is close. `easy` and `normal` are far noisier, with the
first mover taking 61 % and 63 %.

**`easy` loses to a player who never touches the plate 46 % of the time** (65 wins in 120).
That is the right shape for an easy tier: a starting plate covers two of twelve sections, so
doing nothing at all is a real if poor defence, and a beginner who actually moves the plate
beats `easy` comfortably. `normal` and `hard` both take 120 of 120 against a silent
opponent.

## Presentations

Per `docs/presentation.md`; nothing is re-decided here.

- **Shared-screen.** One board, `zoneSplit: 'shared-board'`, so the whole pointer surface
  belongs to whoever is to move. The board turns 180° to face them, and turns again the
  moment the shell is away because the seat that may act has changed — twice a turn, which
  is why the flip is shortened from the SDK's 0.36 s to 0.24 s. The hull under fire is
  drawn large; the gunner's own ship is drawn small below it so they can see their own
  damage without the board being handed over.
- **Single-seat.** Never rotates. `#shouldRotate()` returns false for the whole match and
  the shell's turn indicator carries "whose turn it is" instead. Rules, scoring and
  simulation are byte-identical: the same seed plays the same match in both.

## Rule 7 — colour is never the only signal

- A seat-one hull section carries **one** diagonal rib and a seat-two section **two**, so
  the two ships are told apart with the colour removed. A test counts the ribs inside the
  hull under fire and asserts the difference is exactly twelve.
- A breached section is a **hole crossed both ways**, not a recoloured square.
- A live plate is a **filled slab with chevrons**; a plate being rebuilt is a **dashed
  outline**, and the label beside it reads "plate out" in words rather than changing colour.
- The headline names the phase in words — "Take aim", "Incoming", "Clang — plate holds",
  "Breach" — so the state of the turn survives greyscale entirely.

## What is not specified here

Art and audio (#830), cross-device play (#2043) and the fairness audit (#2044); all three
are open and none is done. Also deliberately undecided: whether the plate should be
destructible per-deck, whether a breach should open a path to something behind it, and
whether a longer hull is a better game than a faster plate. All three are real ways to
extend this; none is needed for two people to play it on one phone.
