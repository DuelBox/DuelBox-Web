# Pull the Rope — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~45 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

## Observed rules

> Tap as fast as you can to pull the rope over!

## The rope

| | Value | Why |
|---|---|---|
| Win distance | 380 units | |
| Marks to win | 10 | The rope is scored in marks, not raw distance |
| Pull strength | 26 units per tap | |
| Stamina | 1.0, full at start | |
| Cost per pull | 0.085 | About 12 pulls from full |
| Recovery rate | 0.28 /s | |
| Exhausted pull | 0.12 of normal | Not zero — an exhausted player is weak, not helpless |
| Decay rate | 0.12 /s | The rope drifts back toward centre |

**Stamina is ours, and it is the whole design.** Without it the game is "who can tap
fastest", which rewards a hardware property — screen sampling rate — rather than a
decision, and would make the game unfair cross-device by construction. With it the game
becomes *when to rest*, which is a decision both a thumb and a key can make equally.

`SUSTAINED_TAP_RATE` is derived rather than tuned: it is exactly the tap rate at which
recovery balances cost, so the design intent is in the code rather than in a comment.

## Scoring and the win condition

**First to 10 marks** — `{ kind: 'first-to', target: 10 }` via the shared helper.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Near seat | Tap your half of the screen | Space |
| Far seat | Tap your half | Enter |

A tap is an **edge**, not a held state, so holding the key down does nothing. That matters:
without it, the keyboard would beat the touchscreen outright by auto-repeating.

## Edge cases

- **Tapping while exhausted.** Pulls at 0.12 strength. The player is weak, not blocked —
  being unable to act at all reads as a bug rather than a mechanic.
- **Neither player tapping.** The rope decays toward the centre and nothing resolves.
- **Both tapping at identical rates.** The rope holds. The decay applies to displacement,
  not to either side, so a balanced contest stays balanced.
- **A tap in the other seat's half.** Belongs to the seat the pointer went down in.

## Determinism

Stamina recovery and rope decay are both **rates** integrated against the fixed delta,
never per-step multipliers. The tug animation is counted in whole steps (`TUG_STEPS = 7`).

## The bot

Taps at a cadence with a rest threshold — it stops pulling below 0.35 stamina and resumes
after a cadence gap. Difficulty varies the cadence and how well it judges the rest point,
which is the same decision a human makes.

## Presentations

Split horizontally; each seat owns its half. Nothing rotates — a rope is symmetric.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
