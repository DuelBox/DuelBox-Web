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

**Round one's attacker is `context.openingSeat`**, never a literal `p1`. That sentence is
one line of code and it was the whole of this game's seat bias — see *Seat balance* below.

## Seat balance

Measured by `apps/web/src/data/balance-aggregate.test.ts`, fifty seed pairs, both bots on
the same tier, seat one's share of decided matches:

| tier | before | after |
|---|---|---|
| easy | **100.0%** | **50.0%** |
| normal | 38.0% (35.2% at 1000 seeds) | **50.0%** |
| hard | **12.0%** | **50.0%** |

The *after* column is unchanged by the #2504 fix below — it is a symmetry, not a
measurement, so nothing that keeps the mirror can move it. Re-measured over 800 matches a
tier afterwards: 50.0%, 50.0%, 50.0%.

An advantage that *changes sign* with the bot tier cannot be a constant asymmetry, and it
was not. Two things composed into it, and both are now fixed:

1. **A round's winner was decided by the role, not by the play** — defect #2504. Whether a
   dodge beats a swing is the bot's reaction against `SWING_SECONDS`, and while `reaction`
   was a bare constant that was a comparison of **two constants with no variance anywhere
   near it**. `easy` reacted in 0.42 s against a 0.34 s swing, so an easy defender could
   *never* dodge in time and the attacker took every round. `normal` (0.30 s) and `hard`
   (0.22 s) were both inside the window, so the defender took every round except when it
   flinched. The tier picked which role won, and it picked it absolutely. A traced `easy`
   match is literally `p1/hit p2/hit p1/hit …` to 5-4. See *The bot* below for the fix.
2. **The favoured role was pinned to a seat.** The attacker alternates strictly from round
   zero and the target is **five points, an odd number**: the seat that attacks round zero
   also attacks rounds two, four, six and eight — five of the nine rounds a 5-4 match runs
   to. `createState` started every match with `attacker: 'p1'`, so seat one held the
   favoured role in every deciding round. At `easy` that is 5-4 to seat one in 100 matches
   of 100; at `hard` it is 5-4 to seat two in 88 of 100.

Reading `openingSeat` removes the second, and the second is what made it a *seat* problem —
which is why the after column is already 50.0% at every tier with the first still in place.
The two are worth keeping apart: **a seat bias and a decided role look the same in a
win-rate ladder and are different defects.** The ladder was monotone throughout #2504.

Alongside it, the bots' rolls are drawn **by role — attacker first, then defender — never
by seat**. Both bots draw from the one match generator, so whoever is driven first takes
the first number; driving `p1` first made a seed opened from one chair a genuinely
different match from the same seed opened from the other. Ordering by role makes a seed and
its mirror **one match and its exact reflection**, which is why the numbers above are
exactly 50.0% rather than approximately: `game.test.ts` asserts winner, scoreline *and step
count* mirror for every seed at every tier, so this is a symmetry proof and not a
measurement. `rules.test.ts` does the same one step at a time, over 600 random boards whose
timers are whole numbers of fixed steps so every threshold is hit exactly rather than
nearly.

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

**A reaction is drawn per swing, not per tier.** This is the fix for #2504, and the whole
of it: each swing the bot sees, it draws its own reaction uniformly from
`reaction ± 0.10 s`, seeded (rule 4) and **once per swing** rather than once per step — a
per-step re-roll would be a lottery a long swing always eventually wins.

| Tier | Reaction | Range | Swing rate | Flinch rate |
|---|---|---|---|---|
| easy | 0.42 s | 0.32 – 0.52 s | 0.7/s | 0.55/s |
| normal | 0.37 s | 0.27 – 0.47 s | 1.1/s | 0.22/s |
| hard | 0.32 s | 0.22 – 0.42 s | 1.6/s | 0.04/s |

A dodge beats a swing when the reaction that swing drew comes in under **0.35 s** —
`SWING_SECONDS` rounded up to the next whole fixed step, because the defender's last chance
to act is the step before the slap lands. Every tier's range now **straddles** that number
rather than sitting on one side of it, so a tier is a rate rather than a verdict:

| Tier | swings dodged in time — before | after (design) | after (measured) | attacker's share of rounds, before → after |
|---|---|---|---|---|
| easy | **0.0%** | 15% | 14.9% | 100.0% → 91.3% |
| normal | **100.0%** | 40% | 40.4% | 17.5% → 66.5% |
| hard | **100.0%** | 65% | 65.2% | 2.6% → 35.6% |

The design column is `(0.35 - reaction + 0.10) / 0.20` exactly; the measured column is
20 000 seeded swings a tier in `rules.test.ts`, which asserts each within a point of it.
The last column is over whole same-tier matches — 800 a tier — and counts flinches, which
end a round before any swing is thrown and are why `easy` is 91% rather than 85%.

**Why ±0.10 s.** The width is squeezed from both ends. It must be wide enough for the
slowest tier to reach 0.35 s at all — `easy` is 0.42 s, so anything under ±0.07 s leaves
`easy` a verdict — and narrow enough that the quickest tier's floor stays at a speed a
person can manage. ±0.10 s clears both and leaves the three rates 25 points apart, so no
tier can be mistaken for its neighbour. At ±0.05 s these same centres give 0%, 30% and 80%,
and `easy` is a verdict again.

**No tier reacts faster than a person, on its luckiest swing.** A simple visual reaction is
about 0.25 s, and what rule 6 constrains is the **fastest the bot can ever be**, not its
average — asserting the tier's middle would let a wide jitter smuggle a superhuman bot in
under a human-looking number. `hard` bottoms out at 0.22 s, which is the number `hard` used
to hit on *every* swing and is now the best it can ever do. The bot must also *watch* a
swing for its whole drawn reaction before it may act on it; it is told nothing about when
the swing started beyond having seen it, and nothing at all about the other seat's
intentions.

Every tier got **slower on average** — `normal` from 0.30 to 0.37 s, `hard` from 0.22 to
0.32 s — which is the safe direction under rule 6: jitter can only ever cost the bot a
swing it used to win. The ladder is clearer for it, because the tiers now differ by how
often they dodge rather than by whether they can:

| | before | after |
|---|---|---|
| hard beats easy | 100.0% | 97.5% |
| hard beats normal | 64.5% | 82.3% |
| normal beats easy | 100.0% | 77.8% |

Four hundred matches a pairing, both orderings. Note that the ladder was **monotone before
and after**: a win-rate ladder cannot see the difference between a tier that is better and
a tier that is a verdict, which is exactly why #2504 survived it.

The jitter is drawn **by role rather than by seat**, from the roll the defender already
draws each step, so it consumes nothing extra from the match generator and a seed opened
from either chair is the same match. The paired sweep in *Seat balance* still splits
**exactly** 40-40, before and after.

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
