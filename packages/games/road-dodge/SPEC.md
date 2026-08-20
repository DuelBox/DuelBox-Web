# Road Dodge — specification

**Archetype:** `rt-race` · **Category:** Racing · **Logical box:** 600 × 1000 ·
**Zone split:** vertical · **Round length:** ~60 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

The first `rt-race` game in the catalogue, and the first game of any kind to declare
`sameInputClassOnly: true`.

## The field

| | Value | Why |
|---|---|---|
| Lanes | 3 | Two would make every dodge forced; four leaves the middle safe too often |
| Track | 1000 logical units long, car fixed at `y = 860` | The car never moves down the track — the track moves past it |
| Roads | One per seat, side by side, `(600 − 2·24 − 28) / 2` wide each | Neither seat can touch the other's traffic |
| Obstacle pool | 12 per seat | Pre-allocated; no per-frame allocation |
| Speed | 320 → 900 units/s | |
| Spawn interval | 1.05 s → 0.34 s | |
| Paired spawns | 0 → 72% chance | **[ours]** — see below |
| Ramp | 45 s to maximum | |
| Lane change | 0.14 s | Discrete: one lane per press, never a slide |

Both seats run the same generator from the same seed, so **they face the identical
sequence of obstacles**. The race is the driving, not the draw.

## Scoring and the win condition

**Score is obstacles cleared. The winner is whoever is still driving.** A crashed seat
stops scoring immediately, so the score is a record of how far you got rather than a
target to reach; `winnerOf` returns the surviving seat, or `'draw'` when both crash on
the same step.

The match therefore ends **on a step that changes neither score** — which turned out to
matter well beyond this game (see *What this game found*, below).

### Why obstacles come in pairs

A single obstacle in a three-lane road is a coin flip you almost always win, so the first
build never ended: every difficulty of bot survived indefinitely and the match had no
result. Pairs block two lanes and leave exactly one open, which turns a reflex into a
decision — *which* lane, and can you reach it. `otherBlockableLane` guarantees the third
lane stays free: a game that can kill you regardless of what you do is not a game, it is
a countdown.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap or drag the left or right half of your road | `A`/`D` or arrow keys to change lane |

**One lane per press, never per step.** A held key does not slide the car across the road.
This is deliberate and it is the reason the parity ruling below is only *partly* mitigated.

## Input parity — same-input-class only

`docs/input-parity.md` rules `rt-race` the one genuinely unfair archetype: the interaction
*is* rapid discrete input, which is what a key is for and what a touchscreen is worst at.
No shared viewport and no precision envelope closes that, because the gap is neither field
of view nor precision — it is how fast a thumb can leave the glass and come back.

This game declares `sameInputClassOnly: true` rather than shipping a match one player
cannot win. It is the first game in the repository to set the field, which had existed in
the schema unused since the manifest was written.

## Edge cases

- **Steering off the road.** Clamped. The car stops at lane 0 or lane 2.
- **A held key.** Steers once. Releasing and pressing again steers again.
- **A key still held when the game pauses.** On resume the controller *re-syncs* to what
  the keys currently say and acts on none of it. Clearing the held axis instead — the
  obvious implementation — read the still-down key as brand new, so a player who paused
  mid-press came back to find the car had already changed lane on its own.
- **A finger dragged across lanes.** Latched per lane, so a drag asks once per lane rather
  than once per step.
- **A finger on the other seat's road.** Ignored.
- **The seat reading the device upside down.** Both its keys and its half of the road are
  mirrored, so reaching right moves right from where that player is sitting.
- **Both seats crash on the same step.** A draw, decided after both have stepped, so it is
  not settled by whichever seat happened to be simulated first.
- **No input at all.** The car crashes. This is the shortest path to a finished match and
  is what the e2e regression test uses.

## Determinism

Every spawn lane, spawn interval and pair decision comes from the seeded RNG. Speed and
spawn rate are functions of elapsed simulated seconds, and the whole simulation is driven
by the fixed delta — `stepSeat` takes `fixedDeltaSeconds` and reads no clock. A match
replays byte-identically from its seed, and the same simulated time split into
different-sized steps agrees.

## The bot

Every tier sees exactly the road a human sees — no obstacle before it spawns, no
information about the other seat. Difficulty is **errors and hesitation, never
information**.

| Tier | Look-ahead | Mistake | Freeze | Re-centre | Measured survival |
|---|---|---|---|---|---|
| easy | 190 | 50% | 0.34 s | never | ~7.6 s |
| normal | 300 | 35% | 0.26 s | 55% | ~13.5 s |
| hard | 400 | 0% | — | always | ~17.1 s |

Survival measured over 200 seeded runs each.

Three things about this bot were wrong before they were right, and each is worth knowing
before writing the next real-time bot:

1. **Difficulty as *seconds of hesitation* subtracted from the car's position** made the
   slower bot effectively look *further* ahead, and the easy tier survived twenty times
   longer than the hard one.
2. **A mistake that steers the wrong way barely graded at all.** On a three-lane road the
   wrong way is often still out of the obstacle's lane, so raising the error rate from 0%
   to 40% cost a fraction of a second. A mistake is now a *freeze*.
3. **A per-step mistake roll is not a mistake.** `botSteer` runs on all sixty steps a
   second, so a hesitation lasting one step is re-decided 16 ms later and costs nothing:
   sweeping the per-step rate from 0 to 0.5 moved survival by 0.00 s. Hesitation has to be
   a duration held in state, which is why the bot has state at all.

Two further behaviours are what actually separate the tiers, and both are simply better
play rather than better information:

- **Pathing to the nearest lane that *stays* clear**, not merely one that is clear this
  instant. Considering only adjacent lanes meant a pair blocking the car's lane and the
  one beside it left the bot sitting still, because the free lane was two moves away.
- **Waiting in the middle lane.** The middle has two escapes and an edge has one. Seeing
  further only pays if you are somewhere you can use what you saw.

## Presentations

- **Shared-screen** — two roads side by side, the opposite seat's road flipped along the
  track so its traffic flows towards its own driver. Both seats see exactly the same
  amount of road.
- **Single-seat** — identical geometry, nothing mirrored, nothing rotated.

Simulation is byte-identical across the two. Only placement and control mapping change.

## Rendering

Interpolated by `alpha`, because obstacles cover about fifteen logical units per step at
full speed and stutter visibly without it. Every obstacle in a seat's pool travels at one
ramped speed, so **one number per seat interpolates all twelve exactly** — no render-only
field bolted onto simulation state. The lane dashes scroll on the same number, so the road
moves at the speed the traffic does.

Rule 7: p1 drives a pointed car, p2 a blunt one with a tail fin; a wreck is struck through
with a white cross. The cross replaced a red flash, which was invisible on p1 — whose own
base colour is `#ff5a4e` — and was colour-only besides.

## What this game found

The host reported the score, **and the winner riding along with it**, only when one of the
two score numbers changed:

```ts
if (score.p1 !== lastP1 || score.p2 !== lastP2) { onScore(score.p1, score.p2, score.winner) }
```

A match decided by survival changes neither number, so Road Dodge played to its end and
then sat frozen behind a live pause button with no result screen, indefinitely. Twelve
games had shipped without hitting it because every one of them scores points. Fixed in
`GameHost.tsx` by watching the winner too, and pinned by an e2e test that plays this game
with nobody touching the controls.

## Not specified here

Art, audio and haptics. The renderer draws primitives; nothing is licensed yet.
