# Whack a Mole — specification

**Archetype:** `rt-split` · **Category:** Reaction · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~60 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

## The field

| | Value | Why |
|---|---|---|
| Grid | 4 × 3 = 12 holes, **shared by both seats**, cell extent 140 units |
| Mole pool | 8 | Pre-allocated; no per-frame allocation |
| Lifetime | 0.8 s – 1.4 s | |
| Spawn rate | 1.8/s rising to 4.5/s | |
| Ramp | 40 s to reach maximum | **[ours]** — the difficulty ramp is the pacing |

## Scoring and the win condition

**First to 30 hits** — `{ kind: 'first-to', target: 30 }` via the shared helper.

**One shared field, and this is the whole game.** Both seats' moles surface in the same
twelve holes. Hitting your own scores; **hitting the other seat's costs you a point**; an
empty hole does nothing. So the mechanic is not "swing fast", it is "tell them apart at
speed" — which is a judgement rather than a reflex, and stays interesting when both players
are quick.

That design has a direct accessibility consequence, and the code takes it seriously: if the
two seats' moles differed only in colour, the game would be **unplayable** — not merely
harder — for a colour-blind player, because telling the colours apart *is* the task. So
p1's mole is round with big ears and p2's is square with horns, separable from the
silhouette with no colour at all. This is the sharpest case in the catalogue of why
CLAUDE.md rule 7 exists.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap a mole the moment it appears | `W A S D` or arrows to pick a hole, Space or Enter to strike |

## Edge cases

- **Tapping an empty hole.** A miss, with feedback. It costs nothing but the time.
- **Tapping a mole already struck.** Ignored; one mole, one hit.
- **Tapping the other seat's mole.** Costs you a point. Deliberate, and the reason the
  shapes matter.
- **Two moles in one hole.** Impossible by construction, and there is a fuzz test that
  spawns a thousand moles and asserts it.
- **Who a tap belongs to.** The seat the pointer went down in, as everywhere else — the
  field is shared but the *input zones* are not, so each player swings from their own side.
- **No input at all.** Moles appear and expire. Missing costs nothing **[ours]**; only
  hitting the *wrong* mole does. A penalty for inaction would make a party game stressful,
  whereas a penalty for a wrong swing is the game.

## Determinism

Every lifetime and spawn interval comes from the seeded RNG and is counted in whole
simulation steps. The difficulty ramp is a function of elapsed steps.

## The bot

Reads what a player reads and no more: which moles are up, whose colour they are, and how
long each has been visible. It takes the one that has been up longest. It **cannot see a
mole before it appears** — the property that would be trivial to break here and would make
the hard tier feel like cheating rather than like a fast opponent.

## Presentations

Split horizontally, each seat's field its own. The far seat's per-hit feedback is turned to
face it; the score is the shell's, drawn once per seat by the shared HUD.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
