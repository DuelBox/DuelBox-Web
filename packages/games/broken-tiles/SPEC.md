# Broken Tiles — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 640 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A floor of ice each, seven by seven. Standing wears the tile under you through; stepping off
one costs it as well. Go through, or run out of ice to step onto, and the round is the other
player's. First to three.

## Observed rules

From the reference genre: _"Run around but watch out, the ice breaks every time you run over
it or stop on it."_

## The floor is a resource that only ever shrinks **[ours]**

That single property does three jobs, and the game is written round it rather than round the
running.

- **It ends the round, with no clock anywhere.** Total ice is finite and strictly decreasing
  whenever anybody is alive — standing costs it, moving costs it, and nothing puts any back.
  A round between two players who never move and a round between two who never stop both
  finish, and the argument is arithmetic rather than a timer. A test drives both cases over
  ten seeds each.
- **It makes standing still a decision rather than a pause.** The tile under you is going;
  the only question is where you spend what is left.
- **It is its own difficulty ramp.** Nothing accelerates and nothing spawns. The last ten
  seconds of a round are hard because of what the first ten did.

## Seat fairness is answered by the deal

Both floors are dealt from **one seeded stream, identically** — the same six worn tiles in
the same places, never the middle one where both skaters start. So the fairness question is
settled before anybody moves, and a test plays the same input into both seats and asserts
their floors and positions stay equal number for number.

## The board

| | Value | Why |
|---|---|---|
| Floor | 7 × 7, tile 62 units | Sized from the half, not chosen — see below |
| Tile life | 3 | Crossable twice, or stood on briefly |
| Step cost | 1.5 to the tile behind | |
| Standing | 1.15 a second | |
| Step interval | 0.16 s | The only pace in the game |
| Worn tiles | 6, both floors, never the start | |
| Match | first to 3 rounds, 5 maximum | |

**The tile size is derived, not picked.** Seven tiles of 76 units came to 532 against a
500-unit half, so the first floor overhung its own board and the two would have overlapped
across the middle. 62 leaves 33 units of margin, which is where the round pips sit.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W` `A` `S` `D` | `↑` `←` `↓` `→` |
| Pointer | hold in your own half and pull | same, in the far half |

A **relative drag**, as in Snake Clash and Robot Arena and for the same reason: the shell
splits a shared surface into two pointer zones, so a thumb is only ever in its own seat's
half and could not point at a tile in the far one anyway.

**There is no repeat rate in this game to win.** A step takes `STEP_SECONDS` whoever asked
for it, and an ask that arrives mid-cooldown is *kept* and spent by the step it releases — so
a player pressing between steps loses nothing, and a mashed key covers no more ground than a
held one. A test asserts exactly that. It is why this game does not need `sameInputClassOnly`,
which Road Dodge did.

## The bot

Three tiers, all of them looking at the same floor a player looks at. They differ in how far
ahead they search and how much they value keeping a route open — never in speed, since the
step interval is the same for everybody, and never in knowledge, since the floor is fully
visible. There is simply nothing extra to give them, which makes this an unusually clean
place to keep rule 6.

| Tier | Searches | Reacts | Values ice over escapes |
|---|---|---|---|
| easy | 1 step | 0.20 s | 0.2 |
| normal | 3 steps | 0.10 s | 0.6 |
| hard | 5 steps | 0.05 s | 1.0 |

`easy` searching one step is exactly how somebody plays this the first time: step onto the
thickest neighbour, and be surprised to find yourself in a corner.

### Three things worth recording

**A shared scratch buffer was silently wrong.** The search recurses, and one scratch floor
meant the deeper call overwrote the floor the shallower one was still walking — so a two-step
lookahead worked and everything past it scored a position that never existed. It is now
make-and-unmake on a single working floor, which has no such hazard because there is only
ever one floor and it is always the true one on the way back out.

**And it was copying that floor at every node** — 4^depth copies of forty-nine numbers, which
cost the hardest tier ten seconds of a test suite. One copy per decision now; the worst step
costs 0.11 ms against a 22 ms budget.

**The reaction wander was not enough on its own, and that was the surprise.** In Robot Arena
and Slot Cars, jittering *when* a bot looks separated two identical ones. Here it did not: on
an open floor most directions score the same, so looking a few milliseconds later returns the
same answer and both skaters walk the same route. Two `normal` bots drew **77 rounds in 120**.
What separates them is which of several equal-best directions gets kept — a strict `>` keeps
the first one visited — so the scan now starts at a drawn offset. Draws fell to 14, and both
seats draw from the same distribution so neither is favoured.

Exactly two values per decision, unconditionally: one wanders the reaction, one turns the
scan. The two bots share the game's `Rng` with the deal, and a seat whose draw count depended
on what it chose would shift the other seat's stream — the seat bias Fruit Duel was caught by.

### Measured

120 seeded matches for equal tiers, 60 for the rest:

| | p1 | p2 | draws | p1 share of decided |
|---|---|---|---|---|
| easy v easy | 60 | 60 | 0 | 50% |
| normal v normal | 57 | 52 | 11 | 52% |
| hard v hard | 62 | 52 | 6 | 54% |
| hard v easy | 57 | 3 | 0 | 95% |
| easy v hard | 0 | 60 | 0 | 0% |
| normal v easy | 58 | 2 | 0 | 97% |
| hard v normal | 36 | 19 | 5 | 65% |
| normal v hard | 17 | 36 | 7 | 32% |

Stable across sample sizes — 56/52/51% at fifty seeds, 53/52/53% at sixty, 53/53/56% at
eighty — so the in-repo test uses sixty and keeps the per-test budget under two seconds.
Rounds run about twelve seconds and a match about a minute.

## Rule 7: never colour alone, and no text

- A tile's remaining life is drawn as **size and cracks**, not as shade: it shrinks as it
  wears and gains a countable crack for each unit gone. That is the only information in the
  game and the one a player reads while running, so it has to survive greyscale and a glance.
- p1 is a disc with a ring, p2 a square with a bar.
- A skater who has gone through gets a cross where they were.
- Rounds are pips on each player's own outer edge — circles for p1, squares for p2.
- A test asserts the renderer's `text` method is never called.
