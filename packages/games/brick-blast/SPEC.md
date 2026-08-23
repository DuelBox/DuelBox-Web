# Brick Blast — specification

**Archetype:** `rt-arena` · **Category:** Arcade · **Logical box:** 640 × 1000 ·
**Zone split:** horizontal · **Round length:** ~40 s

> **This spec was written from the implementation, not before it.** The game was built
> first and this records what it actually does. Every number below was read out of
> `src/rules.ts` and `src/game.ts` rather than remembered, and every measurement was taken
> from the harness described under *The bot*. Where a decision has no source in the
> observed rules it is marked **[ours]**.

## Observed rules

> Move the paddle with your finger to keep the balls in play. If you miss, your opponent
> scores a point.

That is the whole of what the reference genre states, recorded by playing it. It fixes
four things and no more: a paddle each, a **plural** of balls, a finger as the instrument,
and scoring by the other player's miss. It says nothing about a wall of bricks, about how
many balls, about how a ball leaves a paddle, or about when a match ends. All of that is
ours.

## The court

| | Value | Why |
|---|---|---|
| Court | 640 × 1000 logical units | Portrait: two people share one phone held upright, one at each end |
| Ball radius | 13 | |
| Balls in play | 2 | The observed rule says *balls*. Two is the smallest plural, and it is what splits a player's attention **[ours]** |
| Paddle | 120 × 26 units | 19% of the width — wide enough to rally, narrow enough that a corner is a real threat |
| Paddle inset | 66 units off its own baseline | Leaves room behind the paddle, so a miss is visible before it is a point |
| Paddle speed | 620 units/s | One ceiling for a thumb, a key and every bot tier |
| Serve speed | 420 units/s | |
| Max ball speed | 1000 units/s | Bounded so one step moves a ball 16.7 units against a 26-unit contact distance — nothing can pass through a paddle between two discrete tests |
| Paddle gain | ×1.06 per return | A rally tightens; a long one ends on its own |
| Brick gain | ×1.012 per brick | Smaller: breaking a brick is not a rally |
| Max deflection | 1.05 rad (60°) | The angle of a return, set by where along the paddle the ball struck |
| Vertical floor | 0.28 of the ball's speed | The anti-stalemate rule; see *Edge cases* |
| Wall | 8 columns × 4 rows, 32 bricks | Centred on the halfway line |
| Brick | 64 × 26 units, 6-unit gaps, 34-unit row pitch | The 8-unit row gap is narrower than a ball, so no ball can slip between two rows |
| Doubled rows | The two either side of the halfway line | Read from the distance to the middle, so the wall is its own mirror image |
| Regrowth | 420 steps (7 s), back at 1 hit point | A hole closes, but stays weaker than the wall was |
| Serve spots | (170, 640) and (470, 360) | Each other's image through the centre of the court; both clear of the wall and of both paddles |
| Serve delay | 48 steps | |

p1 defends the bottom baseline (y = 1000), p2 the top (y = 0), matching the horizontal zone
split the manifest declares.

**The court is its own picture upside down.** Every brick has a partner at
(width − x, height − y), the two serve spots are each other's image, and the two balls are
launched as exact opposites — one drawn angle, spent twice, the second ball taking the
negation of the first's velocity. Neither seat is ever handed the easier half, and
`rules.test.ts` asserts each of those three separately.

### What the bricks are for **[ours]**

The observed rules do not mention a wall; the game's own name does. A wall between the two
paddles is what makes this something other than the two paddle games already in the
collection: a ball cannot simply be traded back and forth, it has to be **put through
something**, and where the hole is changes as the point runs. Regrowth is what stops that
becoming a one-way ratchet — punch a hole and it will close in seven seconds, so a break is
an opening rather than a permanent advantage, and a match cannot decay into an empty court.

## Scoring and the win condition

**First to 5 points** — `{ kind: 'first-to', target: 5 }`, resolved by the SDK's `resolve()`
rather than by a comparison written here, so a double point in one step is a draw rather
than a win for whichever seat the code happened to check first. **[ours]** — the observed
rule gives no target; five lands a bot match between one and two minutes.

A point is scored when a ball passes a baseline **entirely** — centre plus radius past the
line, not merely touching it. `PointResult` names the seat that **scored**, never the one
whose baseline was crossed, because every caller wants the scorer and the alternative is an
inversion bug waiting to happen.

After a point **both** balls are re-served and the whole wall is stood back up: a point ends
the rally, not one ball of it. The serve is symmetric every time — it is never "the
conceding seat's serve", because with a mirrored pair there is nothing to compensate for.

### And a backstop clock, at 100 seconds

First to five is the rule; the clock is what guarantees the match ends. `roundSeconds` ends
nothing — it is validated by the manifest schema and read only by the catalogue card that
prints "about 40s" — so every game must guarantee its own termination, and this is how this
one does. At the whistle the higher score takes it and a level match is a draw, both through
the same `resolve()` call with `timeExpired`.

Two bars, one down each rail, fill from the halfway line outwards as the clock runs down.
**Two of them, because one bar down one edge is nearer to one player than the other**, and a
rule one seat reads more easily than the other is not the same rule for both.

## Controls

| | Touch / pointer | Keyboard |
|---|---|---|
| **p1** (near seat) | Drag anywhere in the bottom half; the paddle slides to your finger | `A` / `D` |
| **p2** (far seat) | Drag anywhere in the top half | `←` / `→` |

Both sources feed the same target and the same `movePaddle`, under the same 620 units/s
ceiling, so there is no mode to switch between them and neither instrument can cover the
court faster than the other. A finger names a **place**; a key names a **direction** and the
paddle travels at the ceiling while it is held. `W`/`S` and `↑`/`↓` do nothing: a paddle
slides along its baseline and never advances.

The skill both instruments express identically is **where along the paddle you catch the
ball**. A ball is not mirrored off a paddle — it leaves at an angle set by the contact
offset, up to 60° from straight, so a paddle is an aiming tool rather than a wall. Placing
the paddle is the whole game, and placing it is exactly what a thumb and a key both do.

Measured over the registry's own control-parity script — one seeded flail expressed as keys
and as a finger, 14 seeds against a `normal` bot — the keyboard won 0 of 14 and the pointer
0 of 14, with 71 and 72 score movements respectively. A flailing script is not a player;
what matters is that both instruments reached the game equally and neither outperformed the
other.

## Edge cases

- **Simultaneous input.** Both seats act every step and each owns its own end. There is no
  contested resource, so there is nothing to tie-break.
- **A touch in the other seat's half.** It belongs to the seat it went *down* in and keeps
  that ownership across the midline — the engine's `PointerOwnership` owns this, and the
  game never asks where a pointer is, only which seat's input it arrived on.
- **A finger lifted mid-rally.** The paddle stays exactly where it was left. There is no
  drift to the centre: a paddle you parked is a decision.
- **Both balls out in the same step.** Both points are awarded, then the pair is re-served.
  If that takes both seats to five at once, `resolve()` calls it a draw.
- **A ball skimming sideways.** The one position this court could not resolve on its own: a
  ball travelling flat between two brick rows is unreachable by either paddle, and the wall
  simply regrows around it. `enforceVertical` puts a floor of 0.28 of the ball's speed on
  the vertical component after every brick contact, which costs nothing anybody can feel — a
  paddle return is already at least 0.49 vertical — and removes the stalemate outright
  rather than leaving the backstop clock to notice it.
- **A ball in the seam between two bricks.** At most one brick is broken per ball per step,
  the deepest overlap of the ones it touches. Resolving both would cancel the bounce and
  leave the ball inside the wall.
- **A ball caught by a paddle chasing it.** A paddle always returns a ball up the court,
  whichever face it caught it on, so a ball can never be knocked *behind* the paddle that
  just saved it. A ball already travelling away is pushed clear but not deflected again.
- **No input at all.** The bots play on; two absent humans concede alternately and the match
  still ends, at the target or at the whistle.
- **A pointer off the edge of the board.** The target is clamped into the court before the
  paddle moves, so a thumb on the bezel parks the paddle against the rail.

## Determinism

- **No randomness outside the seeded stream.** Two draws exist: the serve angle, once per
  serve, and one noise sample per bot per step — drawn whether or not it is used, so the
  stream advances at one rate however the match goes.
- **No decay, so no rate to get wrong.** A ball travels at a constant velocity between
  contacts, so the position integral is exact however the step is chopped up: two steps of
  `h` and one of `2h` land on the same numbers, and 60 Hz, 90 Hz and 144 Hz step the same
  match. There is deliberately no drag term — the friction-as-a-rate problem the other
  physics games solve carefully does not arise here because there is no friction.
- **Every delay is counted in whole simulation steps**, never in seconds: the serve
  countdown (48 steps) and brick regrowth (420 steps).
- **No wall clock, no device reads, no `Math.random`** — all three enforced by ESLint.
- The one thing that is *not* rate-independent is which step a contact is detected on, which
  is true of every discrete collision in the collection. The fixed loop makes it moot: every
  device steps at the same rate.

## The bot

It reads the two balls' positions and velocities, and nothing else — the same picture a
player has. It picks whichever ball reaches its own baseline first, predicts a straight line
folded off the side rails, and goes there. It is **not** told which brick a ball is about to
meet, so a deflection surprises it exactly as it surprises a person.

Difficulty is reaction delay, aim error and top speed, and nothing else:

| Tier | Reaction | Aim error | Top speed |
|---|---|---|---|
| easy | 0.38 s | ±145 units | 260 units/s |
| normal | 0.20 s | ±78 units | 400 units/s |
| hard | 0.06 s | ±14 units | 610 units/s |

The lag is applied by **rewinding** the ball, so a laggier tier acts on strictly *less*
information than a player has, never more. Every top speed is at or below the 620 units/s a
human paddle gets, and the bot writes a target that goes through the same `movePaddle` a
thumb does (CLAUDE.md rule 6). `game.test.ts` measures that the furthest a `hard` bot moves
its paddle in one step is no more than a person can.

### Measured win rates

Both seats, 60 matches each way (120 per pairing), seeds `n × 101`:

| Pairing | Stronger tier wins |
|---|---|
| hard vs easy | 117 / 120 (97.5%) |
| normal vs easy | 108 / 120 (90%) |
| hard vs normal | 84 / 120 (70%) |

Mirror matches, 80 seeds each, are level within noise: p1 takes 43/80 at easy, 32/80 at
normal, 37/80 at hard. The strongest statement of seat fairness in the set is the cross-tier
pair — `hard` as p1 beat `easy` 60/60, and `hard` as p2 beat `easy` 57/60.

### Measured pace

20 matches per tier: a point every **8.1 s** at easy, **10.4 s** at normal, **18.3 s** at
hard. The longest single rally seen was 19 s at easy, 26 s at normal and 48 s at hard —
inside the 100 s backstop in every case. Mean bricks standing over a match: 29, 28 and 26 of
32, so the wall spends its life mostly intact with holes opening and closing in it.

Two `hard` bots defend almost everything and usually meet the whistle rather than the fifth
point; that is honest — it is the pairing a human never plays.

## Presentations

- **Shared-screen.** The court splits horizontally, each seat owning its own end and its own
  half of the pointer surface. **Nothing rotates**: like the air hockey table and the ping
  pong table, a court with a paddle at each end reads correctly from both ends already,
  which is why a portrait phone suits it. The keyboard axis is screen-relative for both
  seats, the same convention those two games use.
- **Single-seat.** The whole court upright, the local seat at the bottom. The opponent's
  paddle is drawn but not reachable. Rules, scoring and simulation are byte-identical.

Both seats always see the whole court — there is nothing to letterbox differently and no
information either seat has that the other does not (rule 9).

Colour is never the only signal (rule 7): p1's baseline and paddle carry **one** pip, p2's
carry **two**, the doubled bricks carry an inner outline as well as a warmer fill, and the
second ball wears a hollow centre so two balls crossing are still two balls.

## What is not specified here

Art and audio (#830), cross-device play (#2043), and the input fairness audit (#2044). Each
has its own issue and none is done. The wall's shape is a single fixed layout; whether it
should vary between matches from the seed is open and deliberately not decided here.
