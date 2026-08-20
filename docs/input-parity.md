# Cross-device input parity

A thumb and a mouse are not equivalent instruments. Left alone, a cross-device match is
decided by hardware rather than by skill — and the loser cannot see why, which is worse
than losing.

This document decides, per archetype, where that matters and what we do about it.

## The families, and what each is actually good at

| Family | Precision | Travel | Occlusion | Latency | Multi-point |
|---|---|---|---|---|---|
| **Touch** | Low — a fingertip covers ~9mm | Absolute; anywhere instantly | **Severe** — the hand hides the target | Lowest; no intermediary | Yes, several |
| **Mouse** | **Highest** — sub-pixel | Relative; limited by desk and mat | None | Low | One |
| **Trackpad** | Medium — precise but short throws | Relative; needs re-clutching | None | Slightly higher; smoothing | Gestures only |
| **Keyboard** | Discrete — no aiming at all | N/A | None | Lowest, deterministic | Limited by rollover |
| **Gamepad** | Medium — analogue, dead zones | Relative, rate-based | None | Low, plus polling | Two sticks |
| **Pen** | **Highest** — sub-millimetre | Absolute | Moderate — the hand rests | Low | One, plus pressure |

Two asymmetries do the damage.

**Absolute versus relative.** Touch and pen put the cursor exactly where you point, in one
motion. Mouse, trackpad and gamepad have to travel there. In a game where reaching a
target *fast* wins, absolute devices win. In a game where reaching it *precisely* wins,
relative devices win — a mouse can hold a pixel that a thumb cannot.

**Occlusion.** A finger covers what it touches. In a game where you must watch the thing
you are manipulating, touch is at a real disadvantage that no software normalisation
removes.

## Normalisation policy, per interaction

Four rules, applied by the engine so no game implements its own.

**Aim precision — a common envelope.** No family may aim finer than the coarsest supported
one. The engine quantises pointer position to a grid derived from the logical box, so a
mouse cannot exploit sub-pixel precision a thumb cannot match. This costs the mouse player
nothing they can perceive and removes an advantage they could not otherwise give up.

**Drag distance — logical, not physical.** A drag is measured in logical units, never in
millimetres of desk or screen. A short trackpad flick and a long phone swipe that cover
the same fraction of the play area mean the same thing.

**Tap latency — resolved on source timestamps.** A reaction is decided by when the input
*happened*, not when its packet arrived. Anything inside the measurement tolerance is a
genuine draw. `resolveSimultaneous` already implements this, with an 8ms default
tolerance — roughly half a frame, below which no honest claim of "first" can be made.

**Hold timing — counted in simulation steps.** Never in wall-clock milliseconds. A device
running at 30fps and one at 144fps must agree on how long a hold lasted, and steps are the
only unit both can count identically.

## Per-archetype verdict

| Archetype | Advantaged family | Why | Ruling |
|---|---|---|---|
| `turn-board` | None material | Discrete targets, no time pressure; a cell is a cell | **Fair cross-device** |
| `turn-aim` | Mouse and pen | Sub-pixel aim over a continuous angle is a real edge | **Fair** — the precision envelope is implemented |
| `rt-split` | Touch | Absolute positioning beats travel when tracking a fast object | **Fair cross-device** — the envelope narrows it, and the mouse's precision offsets it |
| `rt-arena` | None material | Rate-based movement suits every family; no absolute aiming | **Fair cross-device** |
| `rt-race` | Keyboard and gamepad | Discrete, low-latency, no travel at all; a thumb repeatedly tapping cannot match a held key | **Same-input-class only** |

`rt-race` is the one genuinely unfair archetype, and it is unfair in a direction software
cannot fix: the interaction *is* rapid discrete input, which is exactly what a key is for
and exactly what a touchscreen is worst at. Those games declare `sameInputClassOnly: true`
in their manifest rather than shipping a match one player cannot win.

That field already exists in the schema. **Road Dodge sets it** — the first game in the
repository to, and the first `rt-race` game built. Its manifest carries the reasoning and
`packages/games/road-dodge/SPEC.md` records what the ruling does and does not mitigate:
lane changes are discrete and a held key does not repeat, which narrows the gap, but it
does not close it, because the gap is how fast a thumb can leave the glass and come back.

## What is implemented, and what is not

**Implemented.** Drag distance in logical units — the engine's input path takes logical
coordinates and nothing else. Hold timing in simulation steps — `holdSeconds` accumulates
the fixed delta. Source-timestamp resolution — `resolveSimultaneous`, with tests covering
the tolerance window and simultaneous outcomes resolving as draws. One code path for every
pointing device — pointer events only, no branching on `pointerType` anywhere.

**Implemented: the precision envelope.** Every pointer position is rounded onto a shared
lattice before a game sees it, in `InputManager` — the one place logical coordinates enter
the engine, so every game gets it without asking and none can opt out.

The lattice is **one two-hundredth of the shorter logical side**: 4.5 units in a 900-unit
box, about 1.6 device pixels on a 320px phone and 5.8 on a 1440px desktop. So the desktop
gives up precision it had and the phone gives up none it ever had, which is the whole idea.

It removes *excess* precision rather than inventing any. Quantising cannot make a thumb
steadier — that is a property of hands, not of software — but it stops a mouse from aiming
between the points the game asks anyone to hit. Two aims inside one envelope give the same
answer; two a whole envelope apart still differ, so the game is levelled and not flattened.

This was overdue. The note here said it "must exist before the first `turn-aim` game
ships", and by the time it landed **two had** — Darts and Cornhole. Darts had mitigated it
locally, by nudging its reticle at a rate rather than jumping it; Cornhole had not, and the
measurement on its issue is worth reading, because the gap turned out to be smaller than
the game's own seeded wobble. Both are now levelled by the engine instead of by argument.

**Not implemented: gamepad support.** #130 covers it. The table above anticipates it so
the decision is not made twice.

**Not verified: any of this across two real devices.** There is no cross-device harness
yet, so every judgement here is reasoned from the properties of the input families rather
than measured from matches. The verdicts are falsifiable and should be revisited once
#1862's harness exists — particularly `rt-split`, where I have claimed two advantages
cancel out, which is exactly the kind of claim that is comfortable and might be wrong.
