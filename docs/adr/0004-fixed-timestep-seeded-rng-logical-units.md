# ADR 0004 — Fixed timestep, seeded randomness, and no wall clock in the simulation

**Status:** accepted
**Date:** 2026-09-06

## Context

`PLAN.md` lists the fixed timestep third among the things that cannot be retrofitted:
"Physics must behave identically at 60, 90, and 120Hz. Retrofitting means rewriting every
game." A simulation that advances by whatever time the last frame took gives a 144 Hz
laptop a different match from a 60 Hz phone — a different number of integration steps, a
different rounding error at each one, and, in any game with a ball, a different result.

Three features of the product depend on two devices agreeing exactly:

- **Cross-device play.** `packages/engine/src/lockstep.ts` runs a match on two machines by
  exchanging inputs and nothing else. It works only if the same inputs, applied on the same
  step, produce the same world on both — "provably running the same match, which is the
  property this whole exercise is for."
- **Replays.** `packages/engine/src/record.ts` records input events against a step index
  rather than a timestamp, "deliberately. The loop is fixed-step, so the index _is_ the
  time as far as the simulation is concerned." A trace carries the game id, the seed, the
  logical size and the fixed delta, and replaying it reproduces the match.
- **Tests.** Every determinism test in the repository — `apps/web/src/data/cross-viewport.test.ts`,
  `apps/web/src/data/lockstep-determinism.test.ts` — compares raw floats with
  `toEqual`, not a tolerance, "because 'nearly the same' diverges by the
  hundredth step."

`CLAUDE.md` rule 4 says all simulation runs on the fixed timestep and gameplay never calls
`Math.random()`; rule 8 says no simulation value is ever expressed in pixels. This record
covers the three together because they are one decision: a simulation whose inputs are
whole steps, a seeded stream and logical coordinates has nothing left that varies by
device.

## Decision

**Simulation advances in whole steps of 1/60 s. Randomness comes from a seeded `Rng`
handed to the game per match. Time, device and screen are unreadable from engine, SDK and
game code, and lint fails the build on any attempt.**

`packages/engine/src/loop.ts` holds the loop. `FixedLoop` defaults to 60 steps per
second and at most 5 steps per frame. `advance(frameDeltaSeconds)` adds the frame to an
accumulator, runs `update(stepSeconds)` while a whole step is owed, and then calls
`render(alpha)` with the unsimulated fraction in `[0, 1)` so a game can interpolate
between its last two states on a display faster than 60 Hz. A frame that owes more than
five steps has the remainder discarded: the match briefly runs in slow motion rather than
every frame owing more than the last until the tab locks up, and "time is only ever
dropped, never invented, so both devices in a cross-device match stay on whole-step
boundaries." `RunLoop` is the only thing that reads a wall clock, through an injected
`Clock`, and clamps a single frame to 0.25 s so a tab returning from the background does
not fast-forward. `requestStop` ends a frame's budget between steps so no step runs
against a finished match.

`packages/engine/src/rng.ts` is xoshiro128\*\* seeded by splitmix32, "exact 32-bit integer
arithmetic, so the same seed produces the same sequence on every engine, platform, and
device." `float()` lands on a 2⁻²⁴ grid so every value is exactly representable; `int()`
uses rejection sampling rather than a modulo; `shuffle` is allocation-free for per-step
use; `save`/`restore` exist for snapshots and are marked as allocating. The game receives
it as `GameContext.rng` in `packages/game-sdk/src/contract.ts`: "Seeded per match. The
only source of randomness a game may use."

The rules are enforced in `eslint.config.js`, scoped to `packages/engine`,
`packages/game-sdk` and `packages/games`. `no-restricted-properties` forbids
`Math.random` with the message that it "breaks determinism, replays and lockstep".
`no-restricted-globals` forbids `Date`, `performance` and `requestAnimationFrame` (time
comes from the fixed loop), `window`, `document`, `screen`, `devicePixelRatio`,
`navigator` and `matchMedia` (the device belongs to the host, and "screen size must not
reach the simulation, or two devices step different matches"). The single exception is
`packages/engine/src/loop.ts`, where `browserClock` lives.

Lockstep is what proves the decision. `lockstep.ts` chooses input delay over rollback:
input is stamped for step `now + inputDelaySteps` and applied on that step by both devices
alike, so nothing is predicted and nothing is taken back. `configFingerprint` folds the
game id, seed, shared logical box, step rate and delay into the first frame's checksum, so
two devices that disagree about any of them fail before a step runs rather than after the
match has silently forked. `apps/web/src/data/lockstep-determinism.test.ts` runs every
playable game across a loopback link with latency and reordering and requires the drawn
output of both sides to hash identically, step for step.

## Consequences

- Replays are a list of inputs and a seed. A bug report can be a trace file, and a trace
  replays into a failing test without the reporter's device.
- Tests are exact. Two runs of a match are compared bit for bit, which catches a
  divergence on the step it happens rather than when it becomes visible.
- Cross-device play needs no server authority: both devices are authoritative because both
  compute the same thing. The peer-to-peer architecture ADR 0001 requires is possible only
  because of this.
- Simulation is fixed at 60 Hz on every display. A 144 Hz screen renders 144 interpolated
  frames from 60 states; a game that ignores `alpha` in `render` looks like a 60 Hz game on
  it. Raising the rate is a `LoopOptions` change, but it changes every replay and every
  balance number, so it is a decision, not a tweak.
- A hitch costs time, not correctness. Five steps a frame is 83 ms of catch-up; beyond that
  the match falls behind wall-clock time and stays behind. A player on a struggling device
  sees slow motion rather than a skip.
- Input delay is paid equally and is not hidden: at 60 Hz a delay of 4 steps is 67 ms on
  every action. A game whose feel cannot survive that declares itself same-class-only.
- Everything a game needs — time, randomness, input, the play area — arrives as an
  argument. A game cannot be written against the browser, and a game that needs the wall
  clock for gameplay is a bug by definition.
