# Sumo Push — specification

**Archetype:** `rt-arena` · **Category:** Arena · **Logical box:** 800 × 800 ·
**Zone split:** shared-board · **Round length:** ~60 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

## Observed rules

> Push your opponent out of the ring!

## The arena

| | Value | Why |
|---|---|---|
| Centre | (400, 400) | |
| Start radius | 330 units | |
| Minimum radius | 34 units | The floor the ring shrinks to |
| Shrink rate | 20 units/s | **[ours]** — forces a decision; two cautious players cannot stall |
| Wrestler radius | 46 units | |
| Drive acceleration | 1500 units/s² | |
| Friction | 2.4 /s | A decay **rate**, not a per-step multiplier |
| Max speed | 1000 units/s | |

**The shrinking ring is ours.** Without it two defensive players circle indefinitely, and
a real-time game with no clock and no pressure is not a game.

## Scoring and the win condition

**Last one in the ring.** A wrestler whose centre passes the ring edge is out.

Both out in the same step is a **draw**, resolved by the shared helper rather than by
whichever check ran first — which is exactly the kind of arbitrary tie-break the shared
win conditions exist to prevent.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Drag from your wrestler in the direction to push | `W A S D` near seat, arrows far seat |

Both are rate-based: a direction accelerates, it does not teleport. That is what makes the
two families comparable here, and why this archetype is judged fair cross-device.

## Edge cases

- **Both wrestlers out in the same step.** A draw.
- **A wrestler exactly on the edge.** In, until its centre passes. One rule, no epsilon.
- **Neither player moving.** The ring shrinks and eventually forces contact. There is no
  timeout because the arena is the timeout.
- **A collision at maximum closing speed.** Bounded by the speed cap, so no pair can pass
  through each other between two discrete tests.

## Determinism

Friction is a decay rate with the matching analytic integral, so two steps of `h` and one
of `2h` agree — the same treatment as Air Hockey, and for the same reason. The ring radius
is a function of elapsed **steps**, not seconds.

## The bot

Reads both wrestlers' positions and velocities and the current ring radius — all visible
on screen. Difficulty varies reaction delay and aim error, never information.

## Presentations

Never rotates: an arena viewed from above reads correctly from any side, which is why this
archetype suits a shared board.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
