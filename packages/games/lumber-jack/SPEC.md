# Lumberjack — specification

**Archetype:** `rt-split` · **Category:** Party · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 40 s advertised, 120 s hard backstop

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two woodcutters, a tree each, an axe apiece. Chop from the left or from the right; every
swing takes a log off the foot of your trunk and drops the whole tree one notch onto you.
What lands at your shoulder is what you must not be standing under. First to sixty logs.

## Observed rules

From the reference genre: _"Tap on the left or right side to cut down the tree. But be
careful not to get hit by the branches."_ — one tree, two sides to stand on, taps that
fell logs, and branches that punish standing in the wrong place.

Everything below is how those four facts became a duel.

## The yard

| | Value | Why |
|---|---|---|
| Box | 600 × 1000 | Portrait: a tree is taller than it is wide, and so is a phone held up |
| Split | horizontal, 500 each | One yard per seat, point-symmetric about the centre |
| Trunk | 7 segments visible, 88 wide | Six segments of read-ahead above the one that decides |
| Segment | 56 tall | Seven of them plus one segment of headroom for the drop clears the divider |
| Target | 60 logs | ~15 s of flawless felling; measured matches run 18–39 s |
| Branch density | 34% at the foot, ramping to 86% by the 38th | See below |
| Clout | 1.5 s flat on your back, streak to zero | |

## Each seat fells its own tree

There is no shared resource and no turn order: the two halves are one game played twice
at once, so neither seat can take anything from the other and neither can be blocked. It
is the reason this genre makes a good duel at all — everything that decides the match is
something a player did to their own tree.

The two halves are **point-symmetric**, not mirrored: the far seat's yard is the near
seat's turned half a turn about the centre of the box, exactly as the far player is
turned. So the far seat's *left* is the device's right, and their tree grows away from
them just as the near seat's does.

Nothing in the game branches on `context.presentation`, and there is no `pushSeatRotation`
anywhere, because the board is already symmetric under the rotation. `game.test.ts`
asserts the two presentations produce a byte-identical trace from the same seed.

## One trunk, read by both **[ours]**

Both seats are handed the **identical generated sequence** of segments, from a single
seeded fill at the start of the match.

Two independently generated trees would be fair on average, and a party game is played
once: a player who drew four forced switches in a row while their opponent drew four clear
segments has lost to the seed rather than to the other player. Handing both seats the same
tree deletes the question and makes the whole of the match about who executes it better.

The leader's half does show the trailing player segments they have not reached — but never
more than the seven they can already see on their own tree, because a player seven logs
behind has lost anyway. Nothing leaks that reading your own tree would not say sooner.

## The rule that ends a point: only the segment that *drops* can catch you

Swinging from a side moves you there and takes the bottom log off. You are clouted if the
segment that lands at your shoulder carries a branch on **your** side. The log you just cut
goes, branch and all — so stepping across to the side a branch is already on is fine, you
are cutting that branch off.

One thing to remember, learned in a single mistake, and it leaves an invariant the
rendering leans on: a woodcutter still on their feet is never under the branch at their
own shoulder.

## The cadence is what makes this fair across input families **[ours]**

The genre's instruction is "tap the left or right side", and a game where taps land logs is
won by whoever's instrument repeats fastest — a keyboard, always, by a margin no shared
viewport or precision envelope closes. Road Dodge met the same wall and answered it by
declaring `sameInputClassOnly`, which is the honest answer for a game whose whole
interaction is rapid discrete input.

This one does not need to:

- **A swing takes `swingSeconds` whatever asked for it.** Tapping faster than the cadence
  buys nothing at all.
- **A side held down keeps chopping at exactly that rate.** A finger resting on the glass
  and a key held are the same instruction, so neither family has to repeat to compete.
- **A tap that lands mid-swing is kept and spent by the swing it releases.** Without that
  latch a player would have to press at the instant the cooldown ends, and the game would
  be about timing a press rather than choosing a side. One tap is one log, always.

What is left to be good at is *which side*, which a thumb and a key express equally well.
`game.test.ts` asserts that a mashed key and a held key fell the identical number of logs.

## The rule that ends the match: the axe quickens **[ours]**

**`swingSeconds` runs from 0.46 s at a streak of zero to 0.11 s at a streak of twenty, and
a clout resets the streak.**

This exists because a fixed cadence produces a game nobody can lose. Two competent players
alternate correctly for sixty logs and finish within a step of each other. Measured at a
flat 0.30 s, 150 seeded matches a pairing:

| | flat 0.30 s | streak ramp |
|---|---|---|
| `hard` v `hard` drawn | 52 of 150 | **8 of 150** |
| `normal` v `normal` drawn | 27 of 150 | 1 of 150 |
| `hard` v `normal` drawn | 22 of 150 | 0 of 150 |

Quickening fixes it from both ends. The better you are doing the less time you have to read
the next segment, so a clean run walks itself into a mistake; and because a clout resets
the streak, being caught costs 1.5 s on your back **and** the twenty swings it takes to get
the tempo back. The second cost is much the larger, and it is what turns a two-log lead
into a decided match.

Ramped on the streak rather than on the log count, which was the other candidate and is
quietly worse: a count ramp is identical for both seats at every moment, so it changes when
the match ends and never who wins it.

The fast end is past what a person can hold, and that is the design rather than an
oversight — it is a limit the ramp walks you towards, not a target. Every player, and every
bot, finds their own ceiling somewhere on the way up. Measured average peak streak per
match: `easy` 13, `normal` 19, `hard` 27.

The branch density ramps over the same stretch — a third of segments at the foot of the
tree, 86% by the thirty-eighth — so a clean run gets harder in two unrelated ways at once:
less time to read, and more to read.

## Controls

| | Seat one (near) | Seat two (far) |
|---|---|---|
| Keyboard | `A` / `D` | `←` / `→` |
| Pointer | tap or hold the left or right of the near half | the same, in the far half |

A finger names a side by which half of the box it is in — absolute, because there are only
two of them and both are under the player's own thumb. It is read in the seat's own frame,
so the far seat's left is the device's right: they are looking at the same yard from the
other end of the room.

Keys need no such mapping, which is the part worth noticing. `A` is seat one's left and `←`
is seat two's left whichever way up either of them is sitting, so the keyboard path is the
same three lines for both seats and cannot get the mirror wrong.

The engine's precision envelope applies to the pointer, but nothing here is aimed finer
than half a screen, so it never binds.

## Win, lose, draw

- **Win:** first seat to 60 logs.
- **Draw:** both seats felling their sixtieth on the same step; or level when the clock
  runs out. Both seats are stepped before either is judged, so a simultaneous finish is the
  draw it is rather than a win for whichever seat the loop ran first.
- **Backstop:** at 120 s the match is called on logs. Nothing in this simulation moves on
  its own, so a match nobody is playing is a still picture — that is the case the clock
  exists for, not slow play. `roundSeconds` in the manifest ends nothing; it prints a
  number on the catalogue card. The check lives in `stepMatch`, not in the game class, so a
  host that forgot to look at the clock still could not produce a match that never ends.

## Edge cases

| Case | Behaviour |
|---|---|
| Both players idle | Nobody swings, the clock expires at 120 s, 0–0, draw |
| A tap during a swing | Latched and spent by the next swing; never dropped, never doubled |
| A side held across a pause | Latch cleared on pause and on resume, so nothing swings on the first step back |
| Clouted at a streak of twenty | 1.5 s down and the cadence back to 0.46 s — the larger of the two costs |
| Standing where a branch already is | Legal: that log is the one being cut |
| Reading off the end of the trunk | `segmentAt` answers CLEAR; the trunk is generated 9 segments longer than anybody can reach |
| Match already decided | `stepMatch` returns immediately and no axe moves |
| Rematch on the same instance | `init` refills the trunk, resets both woodcutters, both bot states and the clock |

## The bot

Three tiers, expressed only as **reaction delay, error magnitude and blunder rate** — never
a faster axe, a longer look up the trunk, or anything a player cannot see (rule 6). The bot
reads one segment ahead where a person sees seven, so if anything it is the worse informed.

| Tier | Reaction | Waver | Blunder |
|---|---|---|---|
| easy | 0.44 s | ±0.26 s | 14% |
| normal | 0.24 s | ±0.12 s | 5% |
| hard | 0.13 s | ±0.05 s | 2% |

Between looks it holds the side it last chose, exactly as a player whose eyes are still on
the previous segment would — and because the cadence quickens with the streak, that is a
trap it walks into by *doing well*. Each tier climbs until the tree arrives faster than it
can read, and falls off there. That self-limiting is why three numbers separate three tiers
cleanly here, where Ping Pong needed an ambition knob as well: the difficulty is not how
accurately the bot aims, it is whether it has looked recently enough to have an answer.

Measured, 150 seeded matches a pairing:

| p1 tier | p2 tier | p1 wins | p2 wins | draws | avg length | clouts a side |
|---|---|---|---|---|---|---|
| easy | easy | 71 | 78 | 1 | 32.9 s | 9.6 |
| normal | normal | 76 | 73 | 1 | 23.5 s | 3.9 |
| hard | hard | 64 | 78 | 8 | 18.2 s | 2.2 |
| easy | normal | 0 | 150 | 0 | 24.9 s | 5.6 |
| normal | easy | 149 | 1 | 0 | 25.0 s | 5.6 |
| easy | hard | 0 | 150 | 0 | 19.5 s | 3.8 |
| hard | easy | 150 | 0 | 0 | 19.4 s | 3.7 |
| normal | hard | 7 | 143 | 0 | 19.7 s | 2.8 |
| hard | normal | 148 | 2 | 0 | 19.7 s | 2.8 |

Equal-tier win rates, of the matches that were decided: easy 52.3% to p2, normal 49.0%,
hard 54.9% — all inside the 40–60% band. Every tier beats the one below it from **either**
seat, by 143–150 of 150 or better. The longest match of the 1350 played ran 39.4 s, against
the 120 s backstop.

## Presentation

- **Shared-screen** — the yard is symmetric about the centre of the box and carries no
  text, so both seats read their own half upright with nothing rotated and no
  `pushSeatRotation` in the game at all.
- **Single-seat** — identical simulation; the shell owns the layout.

Every rectangle a seat owns is asserted to lie wholly within that seat's own half of the
box (rule 9), across a whole match, including a tree mid-drop and a full tally bar.

## Rule 7: never colour alone

- Seat one's woodcutter is **round-headed** with a solid axe head; seat two's is
  **square-headed** with a barred one.
- Seat one's tally bar is solid; seat two's is hatched.
- The two yards are two shades of ground, so which half is yours survives greyscale.
- Being clouted is drawn in silhouette — the figure **lies down** — with a cross over it and
  a recovery bar whose length is the time left. Three signals, none of them colour, for the
  single most important thing the screen ever says.
- The tree carries a ring at every joint, so it reads as a stack of logs and the size of one
  swing's drop is legible without motion.
