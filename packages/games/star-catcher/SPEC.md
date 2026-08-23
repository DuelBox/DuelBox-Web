# Star Catcher

Two skies holding the same numbers, raced side by side. Fly your net into a star to take it,
into a black hole to lose two. First to ten stars wins. If the sky runs out first, whoever has
more wins.

- **Archetype** `rt-split`, **zone split** horizontal, **board** 640 × 1000 (two 640 × 460
  fields, one per seat).
- **Field** 640 × 460. **Net** radius 29, speed 235 u/s. **Star** radius 17, **hole** radius 30.
- **Drift** 150 u/s across the sky. **Target** 10 stars. **A hole costs 2.**
- **Sky** at most 13 objects at once, 110 in a match, first at 0.55 s and the interval decaying
  by 0.965 to a floor of 0.26 s. About a third of what falls is a hole.

## The decision

The net is smaller than a star is wide is not — catch distance is 46 units against a 640-unit
field — and it crosses the field in a little under three seconds. So you cannot have everything,
and the game is which star, given what is in the way. A hole is bigger than a star and costs
twice what a star pays, which makes the shortest line to a star frequently the wrong one.

The sky gets busier as the match goes on (the spawn interval decays), so the same decision gets
harder rather than the objects getting faster. Nothing about the game speeds up: rule 6 forbids
giving a bot reactions a person cannot have, and a game that outruns everybody eventually is a
clock, not a contest.

## Termination

Structural, not timed. `SPAWNS` is 110 and the sky spawns no more once it is exhausted; the
match ends when a seat reaches ten stars, or when the last object has left an empty sky. There
is no frame cap anywhere in the rules and the tests run to completion without one.

## Controls

Both seats own a full-width band, so **the pointer is absolute** — every part of your own sky is
directly under your own thumb, and there is no drag origin to establish. Keys give a direction
and move the net at exactly the speed `driveNet` allows a thumb, so neither instrument is
quicker (rule 10). `driveNet` is a rate rather than a set, so a finger that jumps to a corner
does not teleport the net after it, and a mashed key does nothing a held one does not.

## Reading it

No text anywhere. A star is a solid burst with four spikes and a dark centre; a hole is a dark
disc with two concentric rings and is nearly twice the size. Nets differ by shape — p1 a ring,
p2 a square frame — as do the score pips: discs and blocks. All of it survives greyscale
(rule 7). The bar on the halfway line is how much sky is left to fall.

## The two random streams, and why there are two

This is the part worth reading.

**The sky has its own generator.** Both bots used to draw from the same one, and the number of
*decisions* a tier makes depends on its reaction — `hard` looks about seven times as often as
`easy` — so different pairings consumed different numbers of floats and the spawns landed on
different values. The same tier measured 10.3 stars a match against one opponent and 9.5 against
another, purely from that. It also meant a human against a bot would fly a different sky from the
one every balance figure was measured on. `#skyRng` is seeded once from the context's generator,
so what falls is a function of the match seed and nothing else.

**Each seat has its own generator too**, and this is the half that is easy to miss. Drawing a
constant number of values per decision — the rule that fixed Fruit Duel — is not enough: whichever
seat is polled first still takes the earlier value from the shared stream every time. Over 2000
matches a tier that was worth **1.4 points of win rate** to the seat that drew second: seat one
took 47.7 / 49.2 / 48.6 per cent at the three tiers. Reversing the order of the two calls mirrored
the numbers exactly — 52.3 / 50.8 / 51.4 — which is what identified it as draw order rather than
anything in the rules. With a stream each, the poll order is not observable at all: the reversed
run is bit-identical. Both facts are asserted in `rules.test.ts`.

## The bot, and the knobs that turned out to be lies

Five knobs, all monotone, and **every one was swept alone** to check it moves the result in the
right direction. Three of them did not, at first:

| | reaction | lead | caution | aim | sight |
|---|---|---|---|---|---|
| easy | 0.30 s | 0 | 0.8 | 96 | 210 |
| normal | 0.20 s | 0.6 | 1.1 | 72 | 380 |
| hard | 0.06 s | 1.0 | 1.5 | 50 | 1000 |

- **`aim` was dead for two of three tiers.** It is how far off the middle of a star the bot
  actually steers — but below the catch distance of 46 units the net arrives off-centre and closes
  on the star anyway, so 8 and 22 and 46 all measure the same. It sat at 8 for `hard` and 22 for
  `normal` for a long time, reading in the source as the main difficulty axis while doing nothing
  whatsoever. Every tier's value is above the catch distance now, and a test enforces it.
- **`lead` made the sharpest tier the worst.** As a flat number of seconds it aimed a long way
  past a star just off the rim and nowhere near far enough ahead of one across the field. It is a
  fraction of the *real* intercept time now — distance over net speed — which is what makes more
  foresight strictly better.
- **`sight` had the sign backwards.** Seeing further made a bot chase distant stars across a sky
  full of holes; the best-sighted tier caught the most (10.7 a match) and finished last, because
  it also fell into 3.35 holes to `normal`'s 1.7. What fixed it was measuring a hole's distance
  from the *line the net would fly*, not from the star at the end of it. Sight is worth about six
  points of win rate now.
- **`caution` saturates** near 0.8 — 1.3 and 1.8 measure the same — so the tiers sit at 0.8 / 1.1
  / 1.5 rather than spread wider for the look of it.
- The bot also **commits to a target** (`STICKINESS`). Re-scoring from scratch every 0.06 s made
  `hard` steer at whichever of two near-identical stars was ahead that frame and reach neither.

The bot writes a target and `driveNet` moves the net, which is the same function a thumb goes
through — so no bot crosses the sky faster than a person can drag (rule 6), and a test measures it.

## What was measured

**Fairness, 2000 matches per equal tier**, seat one's share of decided matches:

| | seat one |
|---|---|
| easy v easy | 51.3 % |
| normal v normal | 50.4 % |
| hard v hard | 48.9 % |

Identical under a reversed poll order, to the match.

**The ladder, 400 matches a cell, both seat orders:**

| | v easy | v normal | v hard |
|---|---|---|---|
| **easy** | 52 % | 10 % | 2 % |
| **normal** | 90 % | 50 % | 25 % |
| **hard** | 98 % | 75 % | 51 % |

**Solo, 120 seeds** — how long a tier takes to reach ten stars on its own, and what it costs:

| | to target | reached | stars caught | holes hit |
|---|---|---|---|---|
| easy | 25.9 s | 81/120 | 17.4 | 6.0 |
| normal | 16.3 s | 118/120 | 14.7 | 2.8 |
| hard | 13.1 s | 120/120 | 13.0 | 1.7 |

Note the third column: the weakest tier *catches the most stars* and still loses, because it
pays for six holes. Counting catches would have said it was the best player. Time to the target
is the honest measure — it has no ceiling, where "stars at the end" saturates at ten for
everybody.

**A last note on measuring at all.** An early version of this sky spawned about 5 stars every 7
seconds, and every tier reached the target in 14 seconds give or take a fraction, because they
were all waiting on the spawn clock rather than on their own skill. No bot knob moved the result
at all — the game was supply-limited, and the fix was a richer sky, not a better bot. If every
tier measures the same, suspect the game before the bot.
