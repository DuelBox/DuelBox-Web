# Archery — specification

**Archetype:** `turn-aim` · **Category:** Shooter · **Logical box:** 700 × 1000 ·
**Zone split:** shared-board · **Round length:** 90 s advertised

> **Written from the implementation, not before it.** **[ours]** marks decisions with no
> basis in the observed rules. Every number below was either read out of `src/` or measured
> against the compiled `dist/`; none of them is remembered. Win rates come from playing
> whole matches through `dist/game.js` with both seats bot and no input at all; the
> per-arrow figures come from driving `dist/rules.js` directly, which is what lets a knob
> be swept without touching the frozen profiles.

A boss on a stand at the far end of the field, a flag halfway down it, and a shooting line
at the near edge. Take turns: point the bow, hold to bring it to full draw, let go. The
wind carries the arrow while it flies and the bow arm wanders if you dither. Three rounds
of four arrows each, and the higher card wins.

## Observed rules

> Tap the screen, drag to aim, and release the arrow. Watch out for the wind! Hit the inner
> rings for higher scores. The player with the most points after three rounds wins.

Unusually generous by the standards of this catalogue — four sentences, and three of them
decide something. The gesture is named (drag to aim, release to shoot), the wind is named
as a hazard, the scoring is named as concentric rings worth more towards the middle, and
the match is named as three rounds settled on points. What it leaves open is every number:
how many rings, how many arrows in a round, how strong the wind is, whether the wind is the
same for both archers, and what happens when the cards are level.

## The target

Ten rings, worth ten down to one from the middle outwards, which is the standard target
face and is what "inner rings for higher scores" means when you have to pick a number
**[ours]**. Scoring is pure geometry in units of the target radius, so nothing about it
depends on how large the boss is drawn.

| Ring | From | To | Worth |
|---|---|---|---|
| 1 — the gold | 0 | 0.1 | 10, and it is the tie-break |
| 2 | 0.1 | 0.2 | 9 |
| … | | | |
| 10 | 0.9 | 1.0 | 1 |
| Miss | beyond 1.0 | | 0 |

A boundary belongs to the ring **inside** it, and that needs saying in code rather than
being left to arithmetic: `0.7 * 10` is `7.000000000000001` in binary floating point, so
the line between the sevens and the sixes would score as a six without the `1e-9` nudge in
`scoreAt`. A billionth of a radius is far below anything a player or a device can express.

The distance test is written as a failed `<=` rather than as a `>`, so a `NaN` coordinate
scores a miss instead of falling through into `Math.ceil(NaN)` and indexing the ring table
with it. `scoreAt` hands back one of eleven frozen records, so a caller can never be given
a landing it is able to mutate.

Because it is a pure function of a point, it is tested exhaustively without simulating a
shot: every ring, both sides of every boundary, all four quadrants, and four thousand
random points asserting no arrow ever scores more than ten.

## The field

Three rounds comes from the observed rule. **Everything else in this table is ours**: four
arrows an end, the shot clock, the aiming pad, the draw and the wobble, and the strength of
the wind. Four an end because it is even, so the two seats lead exactly as often as each
other; twelve arrows a card is also enough for the scoring to have some resolution without
the match outstaying its ninety seconds.

| | Value | Why |
|---|---|---|
| Field | 700 × 1000, portrait | |
| Boss | centre (350, 240), radius 165 | Far end of the field, standing on the horizon at y = 400 |
| Flag | x = 350, y = 452 | Halfway down, where both the target and the flag are in one glance |
| Shooting line | x = 350, y = 950 | The near edge, so a half-turn of the board swaps the two |
| Aiming pad | (40, 505) 620 × 395 | The near half: thumb reach on a phone, and it does not cover the boss |
| Sight travel | ±1.3 radii | See below |
| Key aim rate | 1.25 radii/s | ~1.0 s from the middle to the edge of the travel |
| Full draw | 0.4 s | 24 steps at 60 Hz |
| Under-draw | 1.35 radii short at zero draw | An undrawn arrow is off the boss entirely |
| Sway limit | 0.3 radii, 0.65× that vertically | Three rings, and wider than it is tall as a bow arm is |
| Sway time constant | 0.55 s | 63% of the limit after that much dithering |
| Sway rate | 0.55–0.95 turns/s across, 0.4–0.75 up | Slow enough to read, fast enough to be a decision |
| Cross-wind drift | 0.46 radii at full strength | Four and a half rings |
| Along-range drift | 0.24 radii, and never blows past 0.45 | A nudge, not a shove |
| Flight | 0.5 s | 30 steps |
| Settle | 0.35 s | 21 steps |
| Shot clock | 5 s | 300 steps — the termination guarantee |
| Bot think | 0.32 s | Before it starts to draw |
| Match | 3 rounds × 4 arrows × 2 seats = 24 shots | |

**The sight reaches past the edge of the boss, and has to.** A full cross-wind carries an
arrow 0.46 radii, so an archer who could only point inside the target could not fight the
weather at all: they would be aiming at ring 5 and hoping. 1.3 radii is a little over
double the worst drift, which leaves the extremes of the pad useful rather than wasted.

**The field is not symmetric under the half-turn, and does not need to be.** The boss is at
the far end and the shooting line at the near edge; a half-turn puts each exactly where the
*other* archer needs it. This is the opposite of Knife Thrower, whose log sits at the exact
centre because both seats throw at the same object. Here the whole board belongs to one
seat at a time.

## The wind

The one thing the observed rules insist on, and the whole reason the game is not "point at
the middle and let go".

A wind is two numbers, both from the seeded stream: `x` is the cross-wind, uniform in
[-1, 1], and `y` the weaker head-or-tail wind, uniform in [-0.45, 0.45]. An arrow leaves on
the line the bow was pointing along and is carried `x × 0.46` and `y × 0.24` radii while it
travels. Nothing integrates — the landing point is the aim plus every error that acted on
it, in one line — so a phone and a laptop land the identical arrow.

### How it is seeded

`init` rolls **all twelve winds up front**, in order, from `context.rng` — the shell's
`Rng(seed)` — before the stream is touched by anything else. Two floats an arrow, twenty
four in total, drawn unconditionally. The weather of a match is therefore a function of the
seed alone and of nothing that happens inside the match, which is what makes a replay of a
seed a replay of the same afternoon.

### How it is kept fair between the seats

Three separate guards, and the first is the one the game turns on.

**One wind per *arrow*, not per shot.** The two shots of arrow *k* are consecutive shot
indices 2*k* and 2*k*+1, and both read `#winds[k]`. Rolled per shot instead, one archer
would get a gale and the other a still afternoon and the match would be decided by the
weather rather than by either of them. Both seats shoot arrow four into exactly the same
breeze, so the flag is a test of judgement and not of luck. A test walks every shot index
asserting the two shots of an arrow share an arrow index and belong to different seats.

**The lead alternates, so neither seat watches twice running.** Shooting *second* at an
arrow is a small advantage and a real one: you have just watched an arrow fly through the
wind you are about to shoot into. `leaderFor` alternates by arrow, which gives the AB–BA
rotation target archery actually uses — p1 p2, then p2 p1, then p1 p2. One seat does shoot
twice running, across the boundary between two arrows, and that is the point of the
rotation rather than a flaw in it: over twelve arrows each seat leads exactly six.

**The alternation starts from `context.openingSeat`, not from the literal `p1`.** Twelve
arrows is an even number, so each seat leads six whichever seat opens and the within-match
balance does not depend on this — but the SDK alternates the opener across the rounds of a
best-of (#2466), and a game that always opened with seat one would leave that rotation
reaching nothing. `leaderFor` and `shooterFor` take the opener as their starting value and
default to `p1` only so the rules tests can name a concrete order.

**Every turn draws the same number of values, in a fixed order.** A turn draws exactly four
floats for the wobble, and a bot turn four more (two for its hand, two for the Box-Muller
dither). The counts are unconditional and the turn order is fixed, so each seat's draws sit
at fixed offsets in the one stream and a seat's play can never become a function of how its
opponent is playing.

The end-to-end check on all three is the seat share at equal tiers, which is in the bot
table below: **50.8%, 49.5%, 50.5%** over 4000 seeds a tier.

### It is read, not felt

The flag carries the pennant's own direction and length, and the number `WIND 0`–`WIND 9`
written on it — `round(|x| × 9)`. The bot reads the same `Wind` record and nothing else,
so rule 6 holds in the obvious direction. It also holds in the *other* direction, which is
worth stating: the bot never uses the second-shooter observation a human can use, because
`botAim` sees only the flag. The alternation above is insurance for human play, not a bot
balance knob.

Ignoring the flag is playable and expensive, which is the shape a hazard should have. A
player who reads it perfectly and looses at full draw scores **10.00** an arrow; the same
player ignoring it entirely scores **8.06** and still never misses the boss. Two points an
arrow is better than twenty across a card — decisive against an equal opponent, survivable
against a weaker one.

## Drawing, and why dithering costs

The bow comes to full draw in 0.4 s and an arrow loosed before then falls short, by up to
1.35 radii — completely off the boss. Past full draw the bow arm starts to wander:

```
sway(t) = 0.3 × (1 − e^−(t − 0.4)/0.55)
```

so the perfect shot is loosed the moment the bow comes back, and every extra second of
aiming costs something. Measured, for a player who reads the flag perfectly:

| Held past full draw | Mean score | Golds |
|---|---|---|
| 0 s | 10.00 | 100% |
| 0.3 s | 9.45 | 44.8% |
| 1 s | 8.53 | 8.3% |
| 3 s | 8.09 | 5.6% |

It is written as a **closed form of elapsed time**, not as a per-step multiplier, so a
60 Hz device and a 120 Hz one sway by exactly the same amount at the same instant. A test
drives both rates and compares.

The wobble's phases and rates are drawn fresh every shot, so a player cannot memorise the
pattern and time it; what they can do is watch the reticle and loose as it crosses the
gold, which is a decision rather than a formality. A test asserts the wobble crosses the
middle in both axes over a hold.

## Scoring and the win condition

**Highest total after three rounds, with the count of golds breaking a tie, and a real draw
if both are level.** **[ours]** for the tie-break; the observed rule says only "most points
after three rounds".

Both comparisons go through the SDK's `resolve` with `{ kind: 'highest-when-time-expires' }`
rather than being written out by hand — once on points, and if that is a draw, again on
golds. "Highest when the match ends" then means the same thing here as everywhere in the
catalogue and a draw is a defined outcome rather than an oversight.

Golds are the right resolution for the tie-break because they are the thing the scoring
already asks for. They are also not decoration: a `hard` bot puts 38.1% of its arrows in
the gold, `normal` 7.9%, `easy` 2.2% — so the tie-break separates strong players often and
weak ones rarely, which is the direction that matters, since two weak players are the pair
most likely to be level on points. Measured draw rates at equal tiers, after the tie-break:
**2.3% (easy), 2.0% (normal), 3.6% (hard)** over 4000 seeds each.

A tie on points *and* on golds really is a draw, and the shell knows what to do with one.

### After a score

The arrow sticks in the boss and stays there for the rest of the round; a miss is drawn
just off the boss in the direction it went, because an under-drawn arrow truly lands off
the field and drawing it there tells the player nothing. 0.35 s later the turn passes.

**The boss is cleared between ends, not within one.** Each round is shot at a clean target,
so the eight arrows standing in it are always this round's eight and a player can read the
group they and their opponent are shooting. The pool is exactly eight arrows and is
reused — nothing is allocated during a match.

## Termination

**Structural, with a clock inside it.** Twenty-four shots, twelve a seat, and nothing any
player does or fails to do can add one or remove one: `#advanceTurn` increments a counter
and ends the match at `SHOTS_PER_MATCH`, and the counter is the only thing that ends it.
There is no target to race to and therefore no way for a match to be decided before both
seats have shot the same number of arrows.

Each shot is bounded in turn. The shot clock runs from the moment the board finishes
turning and decrements once per accepted step; at zero the arrow is loosed **as it stands**,
drawn or not. That is also what stops one player standing at full draw for ever while the
other waits — the clock runs *while* the bow is drawn, not only while it is idle.

The worst case is therefore exact rather than hoped for:

```
24 shots × (300 clock + 30 flight + 21 settle) = 8424 steps = 140.4 s
```

and in shared-screen the board's twelve half-turns add 21 steps each on top, because the
clock is stopped for the flip — for a human and for a bot alike, since a bot may not act on
a step a person is not allowed to act on. Measured, with two human seats and **nothing
touching anything at all**: 8424 steps in single-seat, exactly the arithmetic above, and
8676 in shared-screen, which is that plus the 252 steps of flipping. That match ends 0–0
and is a draw, because every undrawn arrow falls 1.35 radii short and misses the boss.

Two bots are much quicker: 45.7 s at `hard` up to 64.6 s at `easy`, averaged over 4000
seeds. The manifest advertises 90 s, which is where a deliberate pair of humans lands —
24 shots at two or three seconds of aiming each, plus 0.85 s of flight and settle a shot,
plus the flips.

## Controls

| | Seat one | Seat two |
|---|---|---|
| **Keyboard** | `W A S D` to move the sight, hold `Space` to draw, let go to loose | `↑ ↓ ← →`, hold `Enter`, let go |
| **Pointer** | Put a finger anywhere on the field to point the bow there, hold it down to draw, lift to loose | the same |

**One gesture, both instruments, no mode to switch between them** **[ours]**. A finger on
the glass and a held key are the same intent as far as the engine is concerned —
`actionHeld` is `keys.action || pointerDown` — so hold-to-draw and release-to-loose is
spelled identically on a phone and on a laptop. That is *not* the darts idiom, where a
pointer commits on release and a key commits on press and the game has to know which; the
difference is that darts has nothing to preview while a key is held and archery has the
whole draw.

The two sources combine by both writing the same stored aim. The pointer sets it
**absolutely** — where the finger is *is* where the bow points, because a finger held still
has no drag to read and a relative scheme would go dead — and the keys nudge that same
stored value at a rate from wherever it currently is. A player can start a shot with a
finger and finish it with the keys and nothing switches.

Because the aim is *stored* rather than read from the pointer at the moment of commit,
the darts bug cannot happen here: on the step a finger lifts there is no pointer, and a
game that asked for one on that step would never loose the arrow. Archery reads
`actionReleased` and the aim it already has.

Keys move the sight at a rate rather than jumping it, so a keyboard and a thumb are
comparable instruments rather than one being strictly finer — the fairness concern
`docs/input-parity.md` raises for exactly this archetype. Crossing the full travel takes
about a second, against a five-second clock.

### Verified, not asserted

`game.test.ts` drives the real `InputManager` with the literal key codes the manifest
string names — `KeyW`/`KeyA`/`KeyS`/`KeyD`/`Space` for seat one, the four arrows and
`Enter` for seat two — and checks that each of them does what the string says: aims, draws,
looses, and scores an arrow. It also checks that seat two's keys are inert on seat one's
turn.

That last one is why the string names the two halves **one player at a time**. A turn game
hands the whole *pointer* surface to whoever is to move (`setBoardSeat`); it does not remap
the keyboard, and nothing anywhere does. "W A S D or the arrows" would be false here in the
quiet way — the other half simply does nothing until it is that player's turn.

## Edge cases

- **A press that never drew the bow.** Ignored. A tap whose press and release land inside
  one frame is a fumbled nock, not a shot, so a stray touch never costs an arrow.
- **No input at all.** The shot clock looses the arrow undrawn; it falls 1.35 radii short
  and misses. A seat that never plays scores nothing and the match still ends.
- **A finger past the edge of the pad.** Clamped to the edge of the sight's travel rather
  than flinging the sight off the target. A finger *above* the pad — on the boss itself, in
  the sky — is clamped the same way rather than ignored, so no part of the board is dead.
- **Input in the other seat's zone.** There is no other zone: on a turn the whole pointer
  surface belongs to the active seat. Only the active seat's input record is read at all,
  so simultaneous input from both seats resolves to the one whose turn it is.
- **An arrow in the air.** Nothing is accepted until it lands, so a fast tapper cannot put
  three arrows in the boss before the first one is scored.
- **Input while the board is turning.** Refused, as everywhere — a tap on a moving board
  lands somewhere nobody aimed. The shot clock is stopped for the flip, for the bot too.
- **A pause mid-draw.** The nock is let down. A pause drops every key and pointer without
  an accompanying release, so a bow that was drawn when the menu opened would otherwise
  come back still drawn and loose a shot the player never took.
- **A ring boundary.** Belongs to the ring inside it. See the target, above.
- **Stalemate.** Cannot arise. There is no state a match can be in that does not advance,
  because the shot counter is the only thing that ends it and the clock is the only thing
  that gates it.

## Determinism

- **Every delay is counted in whole simulation steps.** Draw, flight, settle, the shot
  clock and the bot's think and dither are all converted through `#stepsFor` before they
  are counted down, so a replay is exact rather than nearly exact.
- **Nothing integrates.** `resolveShot` is a sum: aim plus wobble plus wind plus hand plus
  under-draw. There is no per-step accumulation anywhere in the flight model, so step rate
  cannot change where an arrow lands.
- **The sway is a closed form**, not a per-step multiplier, for the same reason. A test
  drives 60 Hz and 120 Hz and compares.
- **All randomness is seeded**, from `context.rng` and nowhere else: the twelve winds, the
  wobble of every shot, and the bot's hand and dither.
- The bot's scatter is Box-Muller. `float()` can return zero and `log(0)` is `-Infinity`,
  which would place an arrow at `NaN` and score it a miss for ever after, so the draw is
  nudged into `(0, 1]`. A uniform box would also make every bot miss look mechanical,
  clustering at the corners of a square rather than scattering round the point it aimed at.
  Tests draw five thousand scatters and twenty thousand normals and assert every one is
  finite.
- **The two presentations step the identical match.** Measured over 300 seeds at
  `normal` v `hard`: zero differences in either card or in the winner. The flip changes how
  long a match takes on the wall clock and nothing about what happens in it.
- **No simulation value is expressed in pixels** (rule 8). `rules.ts` is entirely in target
  radii and seconds and imports nothing from `game.ts`; the logical-unit constants in
  `game.ts` exist to draw the field and to read a finger off it.
- **No allocation in `update()`.** The winds, the wobble, the shot record, the aim, the
  scatter and the eight stuck arrows are all pooled and rewritten in place.

## The bot

It plays the game a person plays. It reads the flag, points into the wind by as much of it
as its tier can manage, draws the bow on the same clock everybody is on, dithers a bit, and
looses. Everything it uses is on the screen: the flag number, the rings, its own sight.
It does not correct for its own wobble, because it cannot see the future — it simply tries
to loose before the wobble matters.

| Tier | Reads of the flag | Hand spread | Dithers | ± on the dither |
|---|---|---|---|---|
| easy | 18% | 0.42 radii | 0.95 s | 0.40 |
| normal | 65% | 0.21 | 0.45 s | 0.22 |
| hard | 95% | 0.09 | 0.16 s | 0.08 |

Three knobs, all of them things a person does badly, and all three monotone across the
tiers. None of them hands the bot information the easy tier lacks.

### Which knob actually carries the ladder

Not the one the game is about, and it is worth being exact rather than flattering. Taking
`easy` and lifting **one** knob to `hard`'s value, 60 000 arrows each:

| | Mean score an arrow | Share of the 4.46-point gap |
|---|---|---|
| `easy` as shipped | 4.76 | |
| with `hard`'s `windRead` | 5.04 | 0.28 |
| with `hard`'s **`spread`** | **7.63** | **2.87** |
| with `hard`'s `dwell` | 4.97 | 0.21 |
| with `hard`'s `dwellSpread` | 4.73 | −0.03 |
| `hard` as shipped | 9.22 | |

The knobs interact, and that is the honest reading rather than "wind reading does not
matter": reading the flag is only worth points to a hand steady enough to use them. Swept
alone at **`hard`'s** spread, `windRead` from 0 to 0.95 is worth 1.47 points an arrow; at
`easy`'s spread the same move is worth 0.28. Wind reading is what the top of the ladder is
made of and the hand is what the bottom of it is made of.

Every knob swept alone, everything else as shipped at `hard`, 40 000 arrows each:

| `windRead` | 0 | 0.25 | 0.5 | 0.75 | **0.95** | 1 |
|---|---|---|---|---|---|---|
| mean | 7.75 | 8.27 | 8.74 | 9.09 | **9.22** | 9.23 |

| `spread` | 0 | 0.05 | **0.09** | 0.15 | 0.25 | 0.42 | 0.8 |
|---|---|---|---|---|---|---|---|
| mean | 9.87 | 9.63 | **9.22** | 8.53 | 7.31 | 5.27 | 2.36 |
| misses | 0% | 0% | 0% | 0% | 0% | 6.0% | 45.9% |

| `dwell` | 0 | **0.16** | 0.45 | 0.95 | 2 | 4 |
|---|---|---|---|---|---|---|
| mean | 9.35 | **9.22** | 8.79 | 8.25 | 7.94 | 7.88 |

`dwell` saturates because the sway does: past about two seconds the bow arm is already at
its 0.3-radius limit and holding longer costs nothing more. It is kept because it is what
makes a weak tier *look* weak — an easy bot visibly stands there wobbling — and because it
is the only knob that spends the shot clock.

### Solo, 40 000 arrows a tier

| Tier | Mean an arrow | Golds | Misses |
|---|---|---|---|
| easy | 4.75 | 2.2% | 10.4% |
| normal | 7.46 | 7.9% | 0.0% |
| hard | 9.22 | 38.1% | 0.0% |

A twelve-arrow card, 20 000 cards a tier:

| Tier | Mean | sd | Range seen |
|---|---|---|---|
| easy | 56.8 | 9.6 | 20–95 |
| normal | 89.6 | 5.6 | 64–109 |
| hard | 110.6 | 2.5 | 99–119 |

### Measured win rates — 4000 seeded matches a pairing

Played through the shipped `ArcheryGame`, both seats bots, no input at all.

Equal tiers:

| | p1 | p2 | draws | seat-one share of decided | points p1/p2 |
|---|---|---|---|---|---|
| easy v easy | 1986 | 1924 | 90 | **50.8%** | 57.0 / 56.9 |
| normal v normal | 1939 | 1981 | 80 | **49.5%** | 89.6 / 89.6 |
| hard v hard | 1948 | 1909 | 143 | **50.5%** | 110.6 / 110.6 |

All three are inside 47–53%, and the furthest from an even split sits one standard error
from it.

Cross tier, both seat orders:

| | p1 | p2 | draws | stronger tier's share of decided |
|---|---|---|---|---|
| hard as p1 v easy | 4000 | 0 | 0 | 100.0% |
| easy as p1 v hard | 0 | 4000 | 0 | 100.0% |
| normal as p1 v easy | 3991 | 7 | 2 | 99.8% |
| easy as p1 v normal | 4 | 3994 | 2 | 99.9% |
| hard as p1 v normal | 4000 | 0 | 0 | 100.0% |
| normal as p1 v hard | 0 | 4000 | 0 | 100.0% |

Every pairing is monotone and agrees with itself to a tenth of a point across the two seat
orders, which is the seat-fairness check repeated cross-tier.

**The cross-tier ladder is saturated, and that is a property of the format rather than of
the tuning.** A match is the sum of twelve independent arrows, so the law of large numbers
does the deciding: the gap between `normal` and `hard` is 21.0 points against a combined
card spread of 6.1, which is 3.4 standard deviations, and the gap between `easy` and
`normal` is 32.8 against 11.1, which is 3.0. At those separations a reversal is a fraction of a
percent per match: across the two `easy` v `normal` orders, 8000 matches turned up eleven
of them, and no pairing involving `hard` turned up one at all.

Stated rather than tuned away, because the tiers are not there to play each other. What a
tier is for is to be an opponent for a person, and against a person the ladder is the right
shape: a player who reads the flag perfectly and looses at full draw scores 10.00 an arrow
and **120** a match, so `hard` at 110.6 is beatable by good play and not by luck, `normal`
at 89.6 asks for the flag to be read at all, and `easy` at 56.8 is beaten by anyone who
gets to full draw. If the tiers ever do need to meet each other, the lever is the *format*
— fewer arrows, or a per-round race — and not the profiles.

### It is on the clock like everybody else

The bot thinks for 0.32 s, then draws the bow one step at a time, and looses when its
planned draw-plus-dither elapses **or** when the shot clock runs out, whichever comes
first. It is refused input through the board's half-turn exactly as a person is. It plans
once a turn — where to point, how far its hand will stray, how long it will dither — so its
worst step is a handful of arithmetic, which is what the guard suite's `bot-cost` case
measures and passes.

## Presentations

Per `docs/presentation.md`, and the game decides nothing here.

- **Shared-screen** — the field makes a half-turn to face whoever is shooting, driven by
  the engine's `SeatFlip`. The turn puts the boss at the far end and the shooting line at
  the near edge for the seat that has the shot. Input is refused and the shot clock stopped
  for the 0.36 s it takes.
- **Single-seat** — `seatView` reports no rotation, so the local player always reads the
  field upright, with the whole board as their pointer surface.

A pointer is converted through `toWorld` with the flip's current orientation, so seat two's
finger arriving mirrored means the same thing as seat one's. A test puts the same finger
down for both seats and asserts the same aim.

## Rule 7: never colour alone

- **Seat one is a disc and seat two a square, everywhere a seat owns something**: the
  arrows standing in the boss, the hand on the aiming pad, the two scorecards, the arrow
  nocked on the string and the arrow in the air. The last two were discs for both seats
  until this pass and are the only marks that ever moved, which is exactly when a player is
  watching them.
- **The boss has a line at every one of the ten ring boundaries**, not only at the five
  colour bands, so all ten rings can be counted in greyscale. The gold carries a cross as
  well as a colour, so the middle is findable without one.
- **The flag says its own strength**, `WIND 0` to `WIND 9`, as well as pointing.
- **The two gauges stand either side of the aiming pad**, the shot clock down one edge of
  the field and the draw down the other, so which is which is a position rather than a hue.
  Past full draw the draw gauge grows a second bar from its other end showing the wobble,
  which is the thing the player is actually deciding about.
- **The scorecard prints the round it is showing** (`R1`, `R2`, `R3`) and an `X` count for
  the golds, so the tie-break is on the board rather than explained afterwards.
- Whose turn it is is carried by the board's rotation, by the sight and hand mark taking
  the active seat's shape, and by the nocked arrow — three signals, none of them colour
  alone.

## Two defects found while writing this

Both were found by reading the code against this document, and both now have a test that
fails against the original.

**The arrow in the air and the arrow on the string were told apart by colour only.** Every
other seat-owned mark in the game is a disc for p1 and a square for p2. These two were
discs for both. Fixed by giving them the same mark as everything else.

**The shot-clock gauge flashed empty at the start of every turn.** The clock is not counted
until the turn's first accepted step and sits at `-1` until then; `shotClockSeconds` already
read that as "full", but the gauge read it as a count and clamped it to zero — so the bar
emptied and then refilled at the exact moment the board turned and a player looked up to
see how long they had. The gauge now reads it the way the getter does.

## What is not specified here

- **#725** — original art and the audio events. Everything on screen is drawn from
  primitives.
- **#2013** — correctness from 320px to 4K in both orientations.
- **#2014, #2015** — the single-seat and cross-device wiring beyond what the game already
  does through `seatView`.
- **#2016** — the fairness audit across devices and input families. The precision envelope
  is the engine's, and the key-versus-thumb parity is guarded by `control-parity.test.ts`,
  but neither is the audit.
