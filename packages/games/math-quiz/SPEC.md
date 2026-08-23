# Math Duel — specification

**Archetype:** `rt-split` · **Category:** Reaction · **Logical box:** 640 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

One sum, shown to both players at the same instant, with four answers in a diamond. Be
first with the right one and you score; give a wrong one and your opponent scores. Fifteen
sums, most points wins.

## Observed rules

From the reference genre: _"The first player to solve the task gets a point. For any wrong
answer the opponent gets a point."_

## The only game here that cannot be unfair

Every other game in this catalogue needed a measurement to discover whether it was
balanced, and two of them turned out not to be by wide margins. This one is symmetric **by
construction**: both seats see the identical question on the identical step, neither can
act before the other, there is no board that fills, no turn order, and no shared resource
one of them touches first. The balance test exists to confirm it rather than to tune it.

Two consequences fall straight out of that:

- **A question is resolved from the state as it stands, never on arrival.** Both answers
  are recorded during the step and scored together afterwards. Resolving the moment a key
  arrived would hand the point to whichever seat the loop happened to read first — a coin
  toss decided by iteration order, which is exactly what `resolveSimultaneous` and rule 9
  exist to prevent. Two right answers on one step score for both players.
- **The difficulty ramp is keyed to the question number**, never to a score. A ramp
  tracking the leader is a handicap; one tracking the trailer rewards being behind.

## The diamond is the input design **[ours]**

Four answers arranged up, left, down and right map exactly onto `W A S D` and the arrow
keys. A key names an answer as directly as a finger does — no cursor, no confirm step, no
second-class family. This is the one game here where the keyboard is not a translation of a
touch idiom but the same idiom in another shape.

The pointer reads the far seat's panel by mapping the point back through the centre of the
board rather than laying the diamond out twice, so there is one geometry and one place it
can be wrong.

## The board

| | Value | Why |
|---|---|---|
| Board | 640 × 1000, two 640 × 500 panels | Portrait, one player each way up |
| Tile | 190 × 92, spread ±210 / ±118 | Comfortably thumb-sized at 320 px wide |
| Answers | 4 | A guess is right 1 time in 4 and costs 3 |
| Questions | 15 | |
| Question clock | 8 s | |
| Reveal | 1.1 s | |

## The sums

Addition 45% of the time, subtraction 40%, multiplication 15%. Operands run to `9 + 2n`
by the *n*th question; multiplication is kept to single digits, because a two-digit product
is a different game and a slower one.

**Subtraction never goes below zero** — negative answers are a separate skill and one half
the audience for this has not met. **Wrong answers are near misses**, within 9 of the truth:
a distractor thirty away is discarded at a glance, and the game becomes a reading test.

## Win, lose, draw

Most points after fifteen questions. Level is a draw.

**Termination is structural.** Fifteen questions, each with its own clock, so nothing about
how the match is played can extend it — a match where neither player ever touches anything
finishes 0–0 in a little under two and a half minutes and is a draw.

A wrong answer does **not** end the question. Answering first must not be a way to deny the
other player their turn at it, so the question runs on until somebody is right, both have
answered, or the clock expires.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W` `A` `S` `D` | `↑` `←` `↓` `→` |
| Pointer | tap the tile, in your own half | tap the tile, in your own half |

A key must return to neutral before it names another answer, so a key held down does not
consume the next question the instant it appears. A diagonal is read as whichever axis was
pushed further rather than rejected.

## The bot

Three tiers, expressed as how long a sum takes them and how often they get it wrong — never
as a peek at the answer. Every tier picks from the four answers on the screen, and a
mistaken one is a near miss from the same list a person is choosing between.

| Tier | Reading time | Per unit of answer | Mistakes |
|---|---|---|---|
| easy | 1.9 s | +0.035 s | 30% |
| normal | 1.15 s | +0.018 s | 13% |
| hard | 0.62 s | +0.008 s | 4% |

The per-unit term matters: a tier is a **rate of working**, not a constant reaction time, so
the difficulty ramp bites the bot as it bites the player. Without it a `hard` bot would be
just as fast on question fifteen as on question one, and unbeatable by the middle of a
match.

It decides *what* it will answer and *when* the moment it first sees the question, and does
not change its mind. Re-rolling every step would let a slow tier stumble onto the right
answer by repetition — a bot that improves the longer it thinks, which is no difficulty
setting at all.

## Rule 7: never colour alone

- A chosen tile is marked by the caret on its own edge as well as by fill.
- The right answer gains a **tick**, drawn from lines, not merely a green fill.
- Each player's own score has a bar in their own seat colour under it, so which of the two
  numbers is yours does not depend on remembering which side you are sitting on.
- The sum gains its own answer on the right-hand side at the reveal, in place, rather than a
  second number appearing elsewhere.
