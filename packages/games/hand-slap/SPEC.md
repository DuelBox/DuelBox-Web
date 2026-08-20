# Hand Slap — specification

**Archetype:** `rt-split` · **Category:** Reaction · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~90 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

One seat holds their hands out; the other tries to slap them before they pull away. One
button each, and the whole game is *when* you press it.

## The round

| Phase | What it means |
|---|---|
| `ready` | Hands settling. Nothing counts. |
| `live` | The attacker may swing; the defender may pull away. |
| `swinging` | A swing is in the air and has not yet landed. |
| `settling` | A point has been scored and the board holds still so both players see it. |

| | Value | Why |
|---|---|---|
| Swing flight | 0.34 s | The window the defender reacts in — the number everything balances on |
| Dodge window | 0.42 s | Deliberately **longer than the swing**, so a dodge made in time always wins |
| Dodge cooldown | 0.55 s | You cannot pull away twice in a row |
| Wait before live | 0.6 – 2.4 s, seeded | A fixed wait would be learnable, and the game is a bluff |
| Settle | 1.1 s | Long enough to read what happened |
| Target | 5 points | |

**The seats swap every round**, so neither player attacks twice running and whatever
advantage attacking carries is shared exactly rather than settled by who happened to go
first **[ours]**.

## The rule the whole game rests on

**A dodge with nothing to dodge costs the defender a point.**

Without it the defender simply holds the button and never gets hit. With it, a defender who
flinches bleeds points and an attacker who swings on every twitch bleeds them too — so
neither player can win by being fast alone. That matters more than it sounds: a pure
reaction contest is decided by hardware, and this game is played on whatever two people
happen to be holding.

It is also why `sameInputClassOnly` is **false**. One button pressed at a moment of your
choosing rewards no input family over another — there is no aiming, no tracking and no
rapid repeat.

## Scoring

- **hit** — the swing connected. Attacker scores.
- **dodged** — the swing landed on nothing. Defender scores.
- **flinch** — a dodge with no swing in the air. Attacker scores.

A dodge made *too early* is its own mistake: the hands come back before the slap lands, and
it scores as a hit.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap your half | Space or Enter |

**One press, one action.** A held button does not act every step; holding it down would
otherwise be the dominant strategy and there would be no moment to choose. A button still
held when the game pauses is treated as *already down* on resume, so it takes a genuine
release before the next press counts — otherwise a paused player comes back having swung at
nothing and given away a point.

## Edge cases

- **Swinging during the wait** — refused, and refused *distinctly*, so a caller can tell it
  from a swing that simply missed.
- **Swinging with a swing already in the air** — refused.
- **Dodging during the wait or while settling** — refused; costs nothing.
- **Dodging while the hands are already away** — refused.
- **Dodging again before the cooldown has run** — refused.
- **Nobody presses anything** — the round stays live indefinitely. The attacker takes as
  long as they like, which is the bluff.

## Determinism

Every wait comes from the seeded RNG, and the bot's decisions are per-second rates
converted per step, so a 30 Hz simulation plays the same game as a 60 Hz one. The whole
state machine is driven by the fixed delta and reads no clock.

## The bot

| Tier | Reaction | Swing rate | Flinch rate |
|---|---|---|---|
| easy | 0.42 s | 0.7/s | 0.55/s |
| normal | 0.30 s | 1.1/s | 0.22/s |
| hard | 0.22 s | 1.6/s | 0.04/s |

**No tier reacts faster than a person.** A simple visual reaction is about 0.25 s, so
`hard` sits at the quick end of human rather than past it — rule 6 says a bot never gets
speed a human cannot have, and in a reaction game that is the rule most easily broken by
accident. The bot must also *watch* a swing for its whole reaction time before it may act
on it; it is told nothing about when the swing started beyond having seen it, and nothing
at all about the other seat's intentions.

A silent human attacker still collects points from a jumpy bot defender, because flinches
score for the attacker. That is the design working rather than a leak, and there is a test
saying so — the first version of that test asserted the opposite and was simply wrong about
the game.

## Presentations

- **Shared-screen** — two halves split across the middle, the far seat's labels turned to
  face it.
- **Single-seat** — the same halves, nothing rotated.

## Rendering

Everything is measured **from the divider**, into each seat's own half. Measuring from each
seat's outer edge was the obvious first choice and read wrongly: the hands sat far from the
middle and the attacker's arm swung *away* from them, so the slap never appeared to reach
anything. The two players' hands are together in the real game, and the divider is where
they meet.

The half is 500 deep and everything has to fit without overlapping — hands at 130, the arm
cocked with its fist around 280–380, the two labels at 425 and 470. The first layout put a
label straight through the fist, and a test now measures the gap.

Rule 7 twice over: p1's hands are discs and p2's are squares, and **each seat is told its
role in words** — a player who cannot tell whether they are slapping or dodging is not
playing the game at all, so that can never rest on colour.

`pushSeatRotation` turns the whole logical box about its centre rather than about one half,
so the far seat's labels are mirrored through the centre first; without that they land in
the *near* seat's half.

## Not specified here

Art, audio and haptics. A slap is a game that wants a sound and a buzz more than most, and
neither exists yet.
