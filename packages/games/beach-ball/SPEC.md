# Beach Ball — specification

**Archetype:** `rt-split` · **Category:** Sports · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~60 s

> **This spec was written from the implementation, not before it.** Every number below was
> read out of `src/rules.ts` and `src/manifest.ts` rather than remembered, and every win
> rate was measured by running the code. Where a decision has no source in the observed
> rules it is marked **[ours]**.

## Observed rules

> Try to shoot the beachball over the opponent's side. First to 3 wins.

That is the whole of it, recorded by playing the reference genre (`docs/observed-rules.md`).
It fixes two things — the ball crosses to the other side, and the target is three — and
leaves everything else open: what a court is, what a touch is, what ends a rally, and what
a player actually controls. All of that is ours.

## The court

Sand seen from above, a net across the middle, one player each side. The ball has a
**height**, `z`, and gravity acts on `z` alone. **[ours]** That is the load-bearing
decision in the whole game: a `horizontal` split puts the two seats at the top and the
bottom of the device, so a side-on game with gravity down the screen would pull the ball
toward one of them and the bottom seat would be playing a different game from the top one.
On a third axis that belongs to neither seat, the court is point-symmetric about the net.

| | Value | Why |
|---|---|---|
| Court | 600 × 1000 units | Portrait: two people share one upright phone, a half each |
| Net | at y = 500, 100 high | Each half exactly 500 deep; the net is a height on `z`, not a wall on the sand |
| Net bounce | 0.3 | A clipped ball drops back on the side it came from with most of its pace gone |
| Ball radius | 16 | |
| Player radius | 38, reach 54 | Reach is radius + ball: you play what you can touch, not what you stand on |
| Reach height | 118 | Above this the ball goes over you. It is what makes height readable and worth reading |
| Gravity | 700 units/s² | Deliberately gentle — a beach ball floats, and a floating ball is a readable one |
| Player speed | 320 units/s | Identical for both seats and both input families |
| Half bounds | x ∈ [38, 562], y ∈ [538, 962] for p1 | p2's is the exact reflection; neither seat has a step more room |
| Ready spot | 210 behind the net | Where a player returns to between shots |
| Serve spot | 380 behind the net, ±150 across, ±90 deep | Seeded nudge, so points do not all open identically |

p1 defends the bottom (y ≥ 500), p2 the top, matching the `horizontal` zone split the
manifest declares and the engine's `bottomSeat: 'p1'`.

**Nothing here is in pixels.** The renderer is the only thing that knows a device exists,
and `cross-viewport.test.ts` plays the identical match at every viewport size to prove it.

## The rally model

A touch is not a bounce. When a player reaches the ball, the ball is **aimed** at a spot on
the far sand and given the arc that lands there:

- **Where on you it was met decides where it goes.** Off the edge of your reach it goes
  sideways (`PLACE_WIDTH` 260 off centre at full stretch); met in front of you it goes deep,
  behind you it goes short (`PLACE_MID_DEPTH` 250 ± `PLACE_DEPTH` 190 from the net, clamped
  to [70, 460]). Your own run adds to both at `MOVE_TRANSFER` 0.3.
- **There is no aim button.** Standing in the right place *is* the aim, and it is the one
  thing a thumb and a key express identically. `MOVE_TRANSFER` is well below one on purpose:
  at 0.55 it inverted the bot tiers, because a bot that reacted slowly arrived late and was
  therefore still running when it played the ball, which aimed better than a bot that had
  got there early and stopped.
- **The vertical speed is solved from the flight time**, not chosen:
  `z(t) = z + v·t − G·t²/2 = 0`. A short flight therefore means a flat arc, and a flat
  enough arc does not clear the net. Met high with a short flight it solves negative — a
  spike, hit down over the net rather than up over it.

### Why a rally ends

**Every touch buys less air than the last.** `flightTimeFor(touches) = 1.05 − 0.08·touches`,
floored at 0.34 s. The arc flattens, so it clears the net by less and gives the far player
less of the flight to cross the sand in. One of those two runs out, and one of them always
does. This is the only rule that needs to end a rally, and it does: a return is aimed rather
than reflected, so placement alone would never end a point.

Meeting the ball high **multiplies** the remaining flight by up to `1 + 0.4` rather than
adding to it. **[ours]** Added, a player who kept meeting the ball high out-ran the decay
for ever and the rally had no end but the hard cap. Multiplied, getting under the ball buys
a proportion of a shrinking number: it stretches a rally without ever saving one. It also
keeps the rally from being pure arithmetic — without it the flight depends only on the touch
count, the arc fails on the same touch of every rally, and two equal bots traded points
strictly by who served, so the opening coin flip decided the match.

**And a hard cap at 14 touches**, past which the ball is dead and nobody may play it, so it
lands and the point resolves. It exists because a rally that cannot end is the classic way a
volley game hangs and a guarantee that depends on tuning is not a guarantee. It has never
been reached: over 1000 measured bot matches the longest rally was **9** touches, and easy
against easy never passed 7.

**One touch a side.** `canPlay` refuses the seat that touched last, which is also why the
other classic hang is impossible: a ball with no pace left cannot rest on a player and be
struck again every step, because that player may not touch it.

## Scoring and the win condition

**First to 3** — `{ kind: 'first-to', target: 3 }`, resolved by the SDK's `resolve` helper
with `timeExpired` from the clock below. No comparison is written by hand anywhere in this
package.

The ball is dead at `z ≤ 0`. Whoever's sand it landed on concedes; a ball that only a net
clip could have put outside the court is conceded by whoever last touched it. **The seat
that conceded serves next**, which keeps a one-sided match from running away.

After a point: a 0.9 s pause, then the serve. The serve is a 1.1 s hang above the server at
`z = 96`, aimed like any other shot so it always crosses and always lands in — a serve that
could fault would hand the receiver free points.

### The termination argument

1. **Nothing waits for input.** The serve is on a timer, not a trigger. Two seats that never
   touch a control still play the match out: 300 measured, every one decided, 11.4 s to
   24.2 s. A game that needs a press to progress does not progress when nobody presses.
   Nor does an idle match collapse to "whoever served first wins" — the serve is aimed into
   the band the receiver's ready spot sits in, so a player standing perfectly still returns
   some of them. The first server takes 59% of 300, p1 takes 51.7%.
2. **Every rally is bounded.** Shrinking flight ends it in practice; the 14-touch cap ends
   it in principle.
3. **Every point is bounded.** Serve hang, flight, pause — all finite, all on the clock.
4. **The match has a backstop at 180 s.** `MATCH_SECONDS`, drawn as the bar down the left
   edge, because a rule nobody can see is a rule nobody can play to. Level at the whistle is
   a draw, which the helper defines rather than this package.

Measured, 500 matches a pairing: easy against easy — the pairing the termination guard uses,
because the weakest play is the most likely to reach a position nothing resolves — finishes
in **33.7 s at worst**, and hard against hard in **41.3 s**. Neither the 180 s clock nor the
14-touch cap was reached in any of the 1000. The guard's budget is ten simulated minutes.

## The seat-symmetry result

Every `y` in `rules.ts` is paired with a `forwardOf`, and the two halves, ready spots and
serve spots are exact reflections. `rules.test.ts` plays a whole three-point match twice —
once as given, once reflected top to bottom with the seats swapped — and compares them every
step, in two strengths:

- **Decisions match to the bit.** Who served, who touched, who scored, the score, the phase,
  the touch count, the result. Over the 1101 steps of that match, not one differed.
- **Measurements match to 1e-2 units.** Measured drift over the same match: **9.7e-6 units**
  at worst, on a 1000-unit court.

The tolerance is not slack, it is arithmetic. `COURT_HEIGHT − y` is **not an involution** in
double precision: the court is measured from a corner, so p2's sand (0–500) is spaced twice
as finely as p1's (500–1000) and a point on one half can name a spot on the other that no
double lands on. Reflect 220.1 twice and it moves by 2.8e-14. Only putting the origin on the
net would make the two halves representationally equal, and that is a different coordinate
system, not a bug fix. What is left over is the representation leaning half an ulp at a time,
compounded through a chaotic rally; a real asymmetry — a missing `forwardOf`, a bound short
by a player radius — is tens or hundreds of units and trips the same check on the first step.

Independently: bot against bot at the same tier over 200 matches, p1 takes **48.5%** (easy),
**45.0%** (normal) and **53.0%** (hard).

## Controls

| | Pointer | Keyboard |
|---|---|---|
| **p1** (near, bottom half) | Drag in your own half; your player runs to your finger | `W` `A` `S` `D` |
| **p2** (far, top half) | The same, in the top half | Arrow keys |

Both are a **direction**, never a distance: the pointer contributes the unit vector from the
player to the finger, the keys contribute the unit vector they are holding, and both go
through `movePlayer` under the same 320 units/s cap. Nothing rewards a mouse over a thumb,
which is why `sameInputClassOnly` is `false`. There is no mode to switch between the two:
a pointer that is down wins for that seat this step, and the keys drive when it is not.

**There is no action button**, and neither control string mentions one. `seatInput.action`
is never read. Returning the ball is automatic — you return what you can reach — because
adding a swing key would make the game about timing a press rather than about arriving.

Both control strings in `manifest.ts` were re-checked line by line against `game.ts` for
this spec, and `game.test.ts` asserts them: the keyboard string names both halves and says
which is which, promises running and nothing else; the pointer string promises a drag inside
your own half and no tap.

## Edge cases

- **Simultaneous input.** Both seats act every step and each owns its own half. There is one
  contested object, the ball, and `contactSeat` cannot hand it to both: only one seat's half
  contains it, and the seat that touched last is refused outright.
- **Input in the other seat's zone.** A touch belongs to the seat it *started* in and keeps
  it across the midline — that is the engine's `seatForPoint` and `PointerOwnership`, used
  here through `input.seat(...)` and not reimplemented.
  Pointing across the net simply runs your player up to their own line, because `movePlayer`
  confines them. There is deliberately no second copy of that rule in `game.ts`.
- **No input at all.** The match still finishes; see the termination argument.
- **A ball on the net line exactly.** `sideOf` gives y = 500 to p1, so the two halves never
  both claim or both refuse a point. It is a measure-zero case and it has one answer.
- **A ball clipping the net.** Tested on the *crossing*, not at the step boundary: the ball
  can cover twenty units in a step and the net is thinner than that. It comes back on the
  side it came from and the player who put it there may not touch it again, so it lands on
  their own sand. That is the commonest way a point ends, and it is deliberate.
- **Pause with a key held.** `onPause`/`onResume` zero both players' velocities, because a
  shot takes some of the runner's motion and a key still down across a pause must not read
  as a sprint into the ball on the first step back.
- **Stalemate.** There is none to have. Every rally is capped, every phase is timed, and the
  match has a clock.

## Determinism

- **Fixed timestep everywhere.** Every duration is in seconds and integrated against
  `fixedDeltaSeconds`; nothing counts frames.
- **Height uses the analytic integral**, `z += v·dt − G·dt²/2` with `v -= G·dt`, not one
  Euler step of it. A half-step of `vz` accumulates, and only the analytic form puts the ball
  in the same place at 60, 90 and 120 Hz — asserted.
- **All randomness is seeded.** The opening coin flip and every serve nudge come from the
  injected `Rng`. No `Math.random` anywhere, which lint enforces.
- **The two seats consume the stream at the same rate.** `game.ts` draws exactly two floats
  per bot seat per step whether or not they are used, so one bot's decisions cannot shift the
  other's, and a bot match cannot be decided by draw ordering.
- **`update()` allocates nothing.** `step` rewrites one shared `StepResult`, the bot writes
  into one shared `Intent` and one shared `Interception`, and the win condition and its
  options object are held rather than rebuilt.

## The bot

It reads the ball's position, velocity and height, its own position, and whose touch it is —
all of which a person sees on the same screen, and the court draws the landing marker for
both players from the same aim the bot predicts against. It runs no faster and reaches no
further than a person (CLAUDE.md rule 6).

| Tier | Reaction | Judgement error | Anticipation | Measured |
|---|---|---|---|---|
| easy | 0.30 s | 80 units | 0.55 of reach height | — |
| normal | 0.20 s | 45 units | 0.74 | beats easy **100%** |
| hard | 0.15 s | 36 units | 0.80 | beats normal **75%**, easy **100%** |

Measured over **200 matches a pairing**, seats swapped every other match, driving the same
`botIntent` the game does. All 600 were decided; none drawn, none out of clock. Method: run
`createMatch` / `botIntent` / `movePlayer` / `step` at 1/60 from a seeded `Rng`, alternate
which tier sits in p1, count wins. Re-measuring is a `node` script over `dist/rules.js`.

Four things about this bot are worth carrying forward:

- **It predicts the earliest point on the descent it can reach, not where the ball lands.**
  Aiming at the landing spot is the obvious thing and it makes a bot *worse the quicker it
  is*: a player waiting on the spot meets the ball at ankle height and returns it flat and
  low, straight into the net.
- **`anticipation` is the whole difficulty gradient and it is not a physical advantage.**
  Every tier runs at 320 and reaches 54. The tiers differ only in how far up the descent they
  have decided to go and get the ball.
- **It runs the real physics to predict**, net included, because a straight line is worse the
  further ahead it looks — a ball that clips the net comes back, and a bot that had not
  noticed stands on the wrong side waiting for it.
- **It commits to its misjudgement**, once per shot, through the SDK's `bot-judgement`
  module. A fresh error sixty times a second averages to zero, so the bot stands on exactly
  the right spot however large its supposed inaccuracy and every tier plays the same.
- **A new shot starts the reaction clock rather than invalidating the decision.** With an
  immediate re-look, sweeping reaction from 0.40 s to 0.08 s moved the win rate by nothing at
  all, because a ball in flight is ballistic and looking at it twice tells you no more.

The three tiers are closer together than they look, deliberately: a shot either clears the
net or it does not, so the game turns on a threshold. Every wider set measured produced a
ladder of straight hundreds, which is a wall rather than a difficulty setting.

## Presentations

Neither the presentation nor the local seat is read, and that is deliberate. The court is
point-symmetric about the net, so rotating it half a turn maps each seat's half onto the
other's exactly and both people already read their own end upright.

- **Shared-screen.** The court splits across the middle, a half each, nothing rotates. A
  `turn-board` game needs `seatView`; a split court does not, and the branch could only ever
  be wrong.
- **Single-seat.** The whole court upright. The opponent is drawn and unreachable.

The ball's shadow slants along **x**, the axis the two seats share. Slanting it along `y`
would put it nearer one seat and give that player a fractionally better read on the height,
which is exactly what rule 9 is about.

## Rule 7 — colour is never the only signal

p1 is a **disc with one ring**; p2 is a **square with two**. The ball is panelled rather
than plain so it is not a pale circle next to a pale line. In greyscale the silhouette and
the ring count still separate all three, and in a fast game the silhouette is what a player
actually tracks.

## What is not specified here

Art, audio and haptics. Also unmodelled, and deliberately: spin, wind, any collision between
the two players (they cannot reach each other), and any concept of a fault or a let. The
serve cannot fault by construction, so there is nothing to model.
