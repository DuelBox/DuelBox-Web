# Air Hockey — specification

**Archetype:** `rt-split` · **Category:** Sports · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~90 s

> **This spec was written from the implementation, not before it.** The game was built
> first, and this records what it actually does so the next hundred games have something
> to copy and anyone changing this one has something to check against. Every number below
> was read out of `rules.ts` rather than remembered. Where a decision has no source in the
> observed rules it is marked **[ours]**.

## Observed rules

> Score in the opposing goal! Use your finger to move your paddle and get 3 goals!

That is the whole of what the reference genre states, recorded by playing it. Everything
else here is a decision we made, and is marked as such.

## The table

| | Value | Why |
|---|---|---|
| Table | 600 × 1000 logical units | Portrait, because two people share one phone held upright |
| Goal width | 200 units, centred on each short end | Third of the width: wide enough to score, narrow enough to defend |
| Puck radius | 18 | |
| Mallet radius | 34 | Comfortably larger than the puck, so a mallet blocks rather than deflects |
| Wall restitution | 0.92 | A little energy lost per bounce, so a rally decays instead of running forever |
| Friction | 0.4 /s | A **decay rate**, not a per-step multiplier — see determinism below |
| Max puck speed | 1600 units/s | Bounded so one step moves the puck less than the contact distance |
| Max mallet speed | 1400 units/s | A pointer that jumps further than this drags its mallet rather than teleporting |

p1 defends the bottom end (y = height), p2 the top (y = 0), matching the horizontal zone
split the manifest declares.

## Scoring and the win condition

**First to 7 goals** — `{ kind: 'first-to', target: 7 }`, resolved by the shared helper
rather than by a comparison written here. **[ours]** — the reference says three; seven
makes a match last closer to the 90 s the catalogue advertises.

### And a backstop clock, at 240 seconds

First to seven is the rule. The clock is what stops a cautious match running for ever, and
until it was added **nothing did**: `roundSeconds` is validated by the manifest schema and
read only by the catalogue card that prints "about 1m 30s". It ends nothing.

A registry-wide termination test found it, by playing two `easy` bots against each other:
**2–4 after thirty minutes of simulated play, and still going.** Goals were being scored —
about one every five minutes — so it was not stuck, merely unbounded, which for a player is
the same thing.

At the whistle the higher score takes it and a level match is a draw. Two people trading
goals reach seven inside a couple of minutes and never see it; the measured bot pace is
four to seven minutes, so the tiers do occasionally meet it.

The bar down the left edge exists because **a rule nobody can see is a rule nobody can play
to** — it would have been easier to leave the clock invisible and it would have been worse.

A goal is scored when the puck's centre crosses a goal line within the goal width. The
`GoalResult` type names the seat that **scored**, not the one whose goal was entered,
because every caller wants the scorer and the alternative is an inversion bug waiting to
happen.

After a goal the puck is served to the seat that conceded, after a fixed delay counted in
simulation steps.

## Controls

| | Touch / pointer | Keyboard |
|---|---|---|
| **Both seats** | Drag your mallet anywhere in your own half | `W A S D` for the near seat, arrows for the far seat |

The mallet follows the pointer under a speed cap rather than snapping to it, so a fast
flick drags rather than teleports. Without the cap a player could cross the table
instantly and block any shot.

Keyboard movement is rate-based at 900 units/s. Both sources feed the same mallet target;
there is no mode to switch between them.

## Edge cases

- **Simultaneous input.** Both seats act every step, and each owns its own half. There is
  no contested resource, so no tie-break is needed.
- **A tap in the other seat's half.** Ignored. Ownership is decided by the zone the
  pointer went *down* in and does not transfer, so a drag that crosses the midline keeps
  feeding the seat it started in.
- **Puck trapped against a wall.** Friction decays it to rest; the serve delay does not
  apply, and play continues. Not a stalemate in practice because a mallet can always
  reach the walls of its own half.
- **Puck tunnelling through a mallet.** Prevented by the speed ceiling rather than by
  swept collision: one step at 1600 units/s moves the puck less than the
  puck-plus-mallet contact distance, so no pair can pass through each other between two
  discrete tests.
- **No input at all.** The puck decays to rest and nothing happens. There is no timeout
  **[ours: deliberate]** — a match with two idle players is not a failure state worth
  code.

## Determinism

The property the whole product rests on, and the one thing in this game that took real
care.

Friction is a **decay rate in 1/s**, not a per-step multiplier. Velocity is multiplied by
`e^(-friction · dt)` and the position uses the matching analytic integral. That means two
steps of `h` and one step of `2h` land on identical numbers, so a 144 Hz laptop plays the
same match as a 60 Hz phone. A naive `v *= 0.99` per step would not, and the divergence
would compound invisibly.

No wall clock, no `Math.random`, no device reads — all three enforced by ESLint. The
serve delay is counted in whole simulation steps rather than seconds.

## The bot

Three difficulty tiers, each a `BotProfile` of reaction delay, top speed and aim error.
The bot reads only the puck's position and velocity — the same information a human has
looking at the same screen — and its speed cap is measured against the fixed step rather
than the caller's `dt`, so a slow device does not produce a slower opponent.

## Presentations

- **Shared-screen.** The table splits horizontally; each seat's half is its own. Nothing
  rotates: an air hockey table reads correctly from both ends already, which is why this
  archetype was chosen for a portrait phone.
- **Single-seat.** The whole table upright, the local seat at the bottom. The opponent's
  mallet is drawn but not reachable.

## What is not specified here

Art and audio (#830), cross-device play (#2043), and the fairness audit (#2044). Each has
its own issue and none is done.
