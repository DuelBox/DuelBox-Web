# Light Fingers — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~60 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions;
> everything not marked comes from the observed rule below.

Five pedestals under one display case. The case goes dark, the diamond is moved, and when
the lights come up it is glinting on exactly one of them. Both thieves reach at once and
the first hand to close on the right pedestal takes the point.

## Observed rules

> Steal the diamond faster than your opponent! First to 5 wins!

That fixes two things and no more: the contest is a **race for one object**, and the match
is **first to five**. It says nothing about how many places the diamond could be, what a
hand is, what happens when you reach for the wrong thing, or what stops a player simply
holding the button down. Everything below those two sentences is **[ours]**.

## The board

Simulated in logical units throughout; the renderer is the only thing that knows a device.

| Constant | Value | Why |
|---|---|---|
| `SLOT_COUNT` | 5 | Few enough to read at a glance from across a phone; enough that a blind guess is a one-in-five gamble rather than a coin toss |
| `RAIL_LEFT` / `SLOT_WIDTH` | 60 / 96 | 60 + 5 × 96 + 60 = 600, so the rail is symmetric about the middle and neither end is nearer to either seat |
| `START_SLOT` | 2 | Both hands begin on the middle pedestal, equidistant from everything |
| `MOVE_SECONDS` | 0.09 | One pedestal of travel. The number the whole fairness argument rests on — see **Controls** |
| `MIN_CASING_SECONDS` … `MAX_CASING_SECONDS` | 0.7 – 2.1, seeded | A fixed dark phase would be learnable and the reveal would stop being a surprise |
| `OPEN_SECONDS` | 2.6 | The whole rail is 0.28 s of travel, so there is room to cross it, lose an alarm, and cross it again; short enough that dithering costs the round |
| `ALARM_SECONDS` | 0.75 | Most of an open phase. A wrong grab must genuinely cost the round, or guessing would be free |
| `SETTLE_SECONDS` | 1.0 | Long enough for both players to read what happened |
| `TARGET_POINTS` | 5 | From the observed rule |
| `MATCH_SECONDS` | 150 | The backstop clock — see **Termination** |

Each seat owns half the box, split across the middle at `HALF_HEIGHT` = 500. Every
distance in the renderer is measured **from the divider into the seat's own half**, so
"towards the other player" means the same thing for both without either needing to know
which way up its half is drawn: pedestals at depth 130–170, the gem at 105, the hand
resting at 320 and reaching to 215, the two labels at 412 and 460.

## The round

| Phase | What it means |
|---|---|
| `casing` | The case is dark. Hands may move; a grab committed now waits for the lights |
| `open` | The diamond is showing. A hand that closes on it scores |
| `settling` | The round is over and the board is holding still |

Two rules make it a game rather than a reaction test **[ours]**:

1. **A hand takes time to travel** — one pedestal per `MOVE_SECONDS`, for every player and
   every instrument. Where you were standing when the lights came up matters as much as
   how fast you saw them.
2. **You may commit before the lights.** A grab armed in the dark fires on the very step
   the case opens: a one-in-five gamble that wins a whole round of tempo when it lands and
   costs `ALARM_SECONDS` — most of the round — when it does not.

So mashing loses. It arms in the dark, misses four times in five, and spends the round
frozen. Waiting for certainty loses to whoever guessed right. Neither extreme wins, which
is the only reason the middle is interesting.

The diamond's pedestal is drawn from the seeded stream **at the moment of the reveal**, not
at the start of the round. That is deliberate: there is then no hidden number in the state
at all for a bot to read early, so CLAUDE.md rule 6 holds by construction rather than by
promise. `rules.test.ts` asserts `state.diamond === -1` on every step of every dark phase.

## Scoring and the win condition

Resolved by the SDK's `resolve()` with `{ kind: 'first-to', target: 5 }`, never by a
comparison written here. `timeExpired` is passed from the backstop clock, so the helper
also owns what "highest when time runs out" means and what a level score is.

- **steal** — a hand closed on the diamond. That seat takes the point and the round ends.
- **alarm** — a hand closed on the wrong pedestal. No point; that hand freezes for
  `ALARM_SECONDS` and the round carries on for the other thief.
- **bust** — the case shut with the diamond still on its pedestal. Nobody scores.

After any of them the board settles for `SETTLE_SECONDS`, then the case goes dark again.
**Both hands stay exactly where they were left**, which is what makes pre-positioning a
gamble rather than a chore: it costs nothing and buys nothing, because the diamond is
drawn fresh every reveal.

Two hands can close on the same pedestal on the same step. A step is 16.7 ms, inside the
tolerance the SDK's `resolveSimultaneous` calls a genuine draw, so **the round is shared** —
both seats score — rather than handed to whichever seat the code looked at first. `resolve`
then calls a match where both crossed five at once a draw. In practice the bots' per-round
reaction jitter makes it rare: 5 draws in 800 measured bot matches.

## Controls

| | Keyboard | Pointer |
|---|---|---|
| Player one | `A` / `D` slide the hand, `Space` grabs | Touch your half at a pedestal |
| Player two | `←` / `→` slide the hand, `Enter` grabs | Touch your half at a pedestal |

Each seat gets its **own** half of the keyboard — `DEFAULT_BINDINGS`, unmodified. This is a
simultaneous game, so the other half moves your opponent; "A and D **or** the arrows" would
be false, and `game.test.ts` drives both halves and asserts each moves only its own hand.

**How the two sources combine.** There is no mode. A seat with a pointer down is aiming
with the pointer; a seat without one is aiming with its keys. Both write to the same
`want`, and the hand walks towards `want` at one pedestal per `MOVE_SECONDS` either way.

**Why they are equal.** This was got wrong first. The obvious shape gives the key-repeat
its own timer of `MOVE_SECONDS` — and that is measurably worse: the gate is checked before
it is decremented, so a held key walked the aim one pedestal per 6 steps against the hand's
own 5.4, and a keyboard crossed the rail **16 % slower** than a thumb that named the far
pedestal outright. That is exactly the instrument advantage `control-parity.test.ts` exists
to catch. The gate is now the hand itself: the aim may not run ahead while the hand is
still travelling. The two runs are then step-for-step identical, which `rules.test.ts`
asserts directly by crossing the rail both ways and comparing the step counts.

A press is an **edge**, never a level: one press, one commit. A held action does not re-arm
after an alarm, and an action still down across a pause is treated as already down on
resume, so a paused player does not come back having gambled in the dark.

## Edge cases

- **Simultaneous grabs on the diamond** — both seats score. See **Scoring** above.
- **No input at all** — every round busts and the backstop clock decides the match. Two
  empty seats draw at 0–0 after 150 s, which `game.test.ts` asserts.
- **A finger in the other seat's zone** — the engine decides ownership from the zone the
  touch *went down* in and keeps it across the midline; the game reads `pointer.x` and never
  re-derives a seat. A drag from seat one's half up into seat two's still drives seat one.
- **A thumb off the rail or off the box** — clamps to the nearest end pedestal, because a
  thumb on the bezel is a real event and "nothing" would be the wrong answer to it. A
  coordinate that is not a number at all falls back to the middle rather than propagating
  a NaN into the state.
- **Grabbing while frozen, or while the board settles** — refused, and refused distinctly
  (`commit` returns false), so a caller can tell a refusal from a grab that simply missed.
- **Aiming off the end of the rail** — refused; `want` does not change.
- **Stalemate** — impossible to sustain: the case shuts on its own after `OPEN_SECONDS` and
  the match ends on the backstop clock regardless. See below.

## Termination

Nothing in the round loop guarantees a *point* — two players who never grab would bust
every round for ever — so termination is a property of the rules rather than a hope about
the players. `MATCH_SECONDS` = 150 is a hard backstop: past it, `resolve` settles on the
higher score, or a draw. Measured: two `easy` bots decide in **21 s** on average and 31 s
at worst over 12 seeds; two absent players draw at 150 s exactly.

## Determinism

- Every dark phase, every diamond, and every bot decision comes from the seeded `Rng`. The
  first dark phase is seeded too — `createState(rng)` — so the opening round of a match is
  not always the shortest one.
- Delays are counted in seconds of the fixed delta and **carry their remainder**: a phase
  that expires mid-step adds the next duration to what is left rather than overwriting it,
  and a hand's move timer does the same. So the pace of a hand is a rate, not a multiple of
  whatever the step happens to be, and 60 Hz and 120 Hz cross the rail within one step of
  each other. `rules.test.ts` measures that.
- Nothing reads a clock, a device, or a viewport. `cross-viewport.test.ts` plays the game
  at five viewport sizes and compares raw floats.
- `update()` allocates nothing: both bots write their move into a preallocated `BotIntent`.

## The bot

**What it reads:** the phase, the diamond *once it is showing*, and its own hand. That is
exactly what is on the screen in front of a person in that seat. It is never told where the
diamond will be, because until the lights come up nothing knows.

| Tier | Reaction | Jitter | Slip | Gamble | Drift |
|---|---|---|---|---|---|
| easy | 0.40 s | +0–0.30 s | 30 % | 0.45/s | 1.4/s |
| normal | 0.33 s | +0–0.26 s | 16 % | 0.20/s | 0.9/s |
| hard | 0.28 s | +0–0.22 s | 9 % | 0.09/s | 0.6/s |

*Reaction* is how long it must watch an open case before it may act, *jitter* the extra
drawn per round (no human reacts to the same number twice, and it is also what stops two
bots arriving on the same step), *slip* the chance of reaching one pedestal off, *gamble*
the chance per dark second of committing blind, *drift* the chance per dark second of
wandering to another pedestal.

**No tier reacts faster than a person.** A simple visual reaction is about 0.25 s, so
`hard` sits at the quick end of human rather than past it. It also travels at exactly the
rate a player's hand travels — there is no bot-only movement rule.

### Measured win rates

160 matches per pairing, each seed played from both seats so any seat bias would show:

| | wins | draws | mean match |
|---|---|---|---|
| hard vs easy | **96 %** | 0 | 17.8 s |
| hard vs normal | **86 %** | 2 | 19.1 s |
| normal vs easy | **87 %** | 1 | 19.3 s |
| easy vs easy | 50 % | 0 | 20.8 s |
| hard vs hard | 50 % | 2 | 19.7 s |

The two mirror matches landing on exactly 50 % is the seat-symmetry check: the rules give
neither seat an edge.

Against a scripted player — waits for the lights, reaches for the diamond, never slips —
driven twice over, once with the keys and once with a finger, 60 matches each:

| Player | vs easy | vs hard |
|---|---|---|
| keyboard, 0.42 s reaction | 98 % | 42 % |
| pointer, 0.42 s reaction | 98 % | 46 % |
| keyboard, 0.26 s reaction | — | 100 % |
| pointer, 0.26 s reaction | — | 100 % |

Two things worth reading off that table. `easy` is a warm-up and `hard` is a real contest
for an average human reaction, which is the ladder working. And the keyboard and the
pointer track each other within four points at every level — the parity claim measured with
a *player* rather than with the flailing script the global guard uses.

## Presentations

- **Shared-screen** — two halves split across the middle. The rail itself is drawn in device
  orientation for **both** seats: a row of five pedestals reads the same either way up, and
  drawing it identically means a pointer x names the same pedestal for both seats with no
  per-seat mapping to get wrong. Only the *words* are turned, since those have a way up.
- **Single-seat** — the same two halves, nothing rotated.

`pushSeatRotation` turns the whole logical box about its centre rather than about one half,
so the far seat's labels are mirrored through the centre on **both** axes first; without
that they land in the near seat's half and on the wrong side of the rail.

## Colour is never the only signal

- p1's hand is a **disc**, p2's is a **block**, and each seat's own label names its mark.
- A committed hand wears a **ring** and reaches forward; a frozen one wears a **cross**.
- The diamond's pedestal wears a **gem** and a heavy outline; the other four wear nothing.
- Every state a player must act on is also spelled out in words: `LIGHTS OUT`, `COMMITTED`,
  `GRAB IT`, `REACHING`, `ALARM`, `STOLE IT`, `TOO SLOW`, `SPLIT!`, `CASE SHUT`.

## What is not specified here

Art, audio and haptics. A case slamming and an alarm both want a sound and a buzz more than
most things in the catalogue, and neither exists yet. Nothing here decides them.
