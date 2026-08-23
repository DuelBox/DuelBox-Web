# Gravity Run — specification

**Archetype:** `rt-split` · **Category:** Platform · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised, 120 s hard backstop

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A lane each and a runner apiece. The runner goes forward on its own and gets faster the
longer it goes clean; blocks stand on the floor and hang from the ceiling, and the only way
past one is to be on the other surface when it arrives. Say which way is down. Clip a block
and you are flat on your face for nearly a second and back to walking pace. First runner
home wins.

## Observed rules

From the reference genre: _"Tap to change gravity. Run fast and don't fall!"_ — a runner
that goes by itself, one control that inverts gravity, speed as the thing being asked for,
and falling as the thing that costs.

Everything below is how those four facts became a duel.

## The lane

| | Value | Why |
|---|---|---|
| Box | 600 × 1000 | Portrait: two lanes, one above the other, on an upright phone |
| Split | horizontal, 500 each | One lane per seat, point-symmetric about the centre |
| Corridor | rise 352, runner radius 24 | 400 units of lane; the rest of the half is the tally bar |
| Gravity | 6000 u/s² | Sized from the times it produces, not from a feel |
| Cell | 80 long | Blocks fill a whole cell, so a block is 80 wide |
| Block reach | 210 into a 352 rise | See below — the two bands **overlap** |
| Race | 90 cells, 7200 units | Measured races run 25–32 s |
| Speed | 240 → 560 over 22 clean cells | The genre's own instruction, as a rule |
| Flip lockout | 0.16 s | Input parity — see below |
| Caught | 0.9 s down, streak to zero | |
| Window a player sees | 5 cells ahead | The bot sees 3 |

## Each seat runs its own lane, on one course

There is no shared object and no turn order: the two lanes are one game played twice at
once, so neither seat can take anything from the other and neither can be blocked. But the
two lanes are **the same generated course**, read from each runner's own position — one
`Int8Array`, filled once per match from the seeded stream.

Two independently generated lanes would be fair on average, and a race is run once: a
player who drew four switches in a row while their opponent drew a clear straight has lost
to the seed rather than to the other player. Handing both seats the identical sequence
deletes the question outright. **The lanes are not similar in difficulty; they are the same
cells in the same order**, and `rules.test.ts` asserts it the only way that means anything
— by walking both seats' read-ahead over every cell of the course and requiring the same
answer at each. The density ramp is indexed by cell, so both runners meet the same ramp at
the same point of their own race.

The two halves are **point-symmetric**, not mirrored: the far seat's lane is the near
seat's turned half a turn about the centre of the box, exactly as the far player is turned.
So each player's floor is the edge of the device nearest them and each player's runner
travels towards their own right.

Nothing in the game branches on `context.presentation`, and there is no `pushSeatRotation`
anywhere, because the board is already symmetric under the rotation. `game.test.ts` asserts
the two presentations produce a byte-identical trace from the same seed.

## Gravity is real, and the middle is not a hiding place **[ours]**

A flip does not move the runner across the lane; it reverses an acceleration. The runner
falls, and everything about how far ahead a player has to read comes out of two times:

| | | |
|---|---|---|
| `CROSS_SECONDS` | 0.265 s | until the surface you **left** can no longer reach you |
| `COMMIT_SECONDS` | 0.218 s | until the surface you are **heading for** can start to reach you |
| rest to rest | 0.343 s | the whole crossing |

A block reaches 210 units into a 352-unit rise, so the floor's band and the ceiling's band
**overlap by 68 units in the middle of the lane**. There is no height that is safe from
both, which is what makes hovering — the natural product of flipping as fast as the lockout
allows — a bad idea rather than an exploit. It is also why a cell never carries a block on
both surfaces: that cell would have no way through it, and a rule a player cannot play
around is not a rule, it is a coin toss.

The crossing costs `BLOCK_REACH` of fall in **either** direction, so neither surface is
cheaper to leave than the other. A test asserts the two are the same number of frames.

## The rule that makes a course fair: a switch always has room **[ours]**

The generator never puts a block on the opposite surface within `SWITCH_GAP` = 1 cell of
the last one. That single constraint is what the runnability of the whole course rests on,
and the argument has two halves, both measured:

- **At the bottom of the ramp a purely reactive player clears everything.** A player who
  waits until the block being cleared is behind them before starting the crossing has
  `gap ÷ speed` to complete a `CROSS_SECONDS`, which holds below **302 units a second** —
  the first four cells of the ramp. A hundred seeded courses, both seats pinned there:
  **zero falls**.
- **Above that, the crossing has a window rather than a moment.** It may be begun while the
  runner is still over the block it is clearing, provided it has not dropped into that
  block's reach before the cell is behind it. The window is
  `gap + COMMIT_SECONDS − CROSS_SECONDS` wide: **0.29 s at a walk, 0.096 s flat out**, about
  six frames. It never closes.

So the ramp does not walk a runner towards something impossible. It walks them towards
something that has to be committed to **early** — a skill, and a legible one, because a
player can watch themselves leave the ceiling while the block is still under them.

The twenty seeded courses a reactive player clears without a scratch at walking pace cost
them **4.6 falls each** anywhere above 302 units a second — and the figure does not move
between 356 and 560. What such a player is failing is not the speed, it is the tight
switches themselves, all of them, every time. That is the shape of the skill this game
asks for, and a test asserts both halves of it.

## The rule that ends the race: the runner quickens **[ours]**

**`runSpeed` climbs from 240 units a second at a streak of zero to 560 at twenty-two clean
cells, and being caught puts it back to 240.**

This exists because a fixed speed decides races on a very coarse number. Both lanes are the
same cells and the runners move at the same rate, so the only thing separating them is how
many blocks each clipped — 0.9 s times an integer — and two runners who clipped the same
number arrive not usually but *exactly* together. Measured over 150 seeded races a pairing,
with the ramp pinned flat:

| flat speed | `hard` v `hard` drawn | `normal` v `normal` drawn | `easy` v `easy` drawn |
|---|---|---|---|
| 240 (walk) | 25 of 150 | 19 of 150 | 17 of 150 |
| 400 (mid) | 36 of 150 | 33 of 150 | 17 of 150 |
| 560 (sprint) | 37 of 150 | 26 of 150 | 24 of 150 |
| **the ramp** | **2 of 150** | **0 of 150** | **0 of 150** |

The ramp fixes it from both ends: going well shortens the time you have to read what is
coming, and being caught costs the 0.9 s on the ground **plus** the twenty-two cells it
takes to wind back up. The second cost is much the larger, and it is what turns one clipped
block into a decided race. Ramped on the streak rather than on the distance covered, which
was the other candidate and is quietly worse: a distance ramp is identical for both seats at
every moment, so it changes when the race ends and never who wins it.

The density ramps over the same stretch — 28% of cells blocked at the line, 70% by the
seventieth — so a clean run gets harder in two unrelated ways at once: less time to read,
and more to read.

## Controls

| | Seat one (near) | Seat two (far) |
|---|---|---|
| Keyboard | `W` / `S` name a surface, `A` `D` `Space` flip | `↑` / `↓` name a surface, `←` `→` `Enter` flip |
| Pointer | touch the near half of your lane for the floor, the far half for the ceiling | the same, in the far lane |

**A finger names a surface rather than toggling.** There are only two of them, both are
directly under the player's own thumb, and an absolute ask cannot get out of step with the
runner — a toggle punishes the tap the game already registered, which is the one mistake a
player cannot see coming. It is read in the seat's own frame, so each player's own half of
their own lane is their floor.

Keys need no such mapping, which is the part worth noticing: `W` is seat one's up and `↑` is
seat two's up whichever way up either of them is sitting, so the keyboard path is the same
three lines for both seats and cannot get the mirror wrong. All five of a seat's keys act,
because in a party game a hand lands where it lands.

The engine's precision envelope (3 units here) applies to the pointer, but nothing is aimed
finer than half a lane, so it never binds.

### Why this is fair across input families **[ours]**

The genre's instruction is "tap to change gravity", and a game where taps move a runner is
won by whoever's instrument repeats fastest — a keyboard, always, by a margin no shared
viewport or precision envelope closes. Road Dodge met the same wall and answered it by
declaring `sameInputClassOnly`, which is the honest answer for a game whose whole
interaction is rapid discrete input.

This one does not need to:

- **A flip is locked out for `FLIP_COOLDOWN` whatever asked for it.** Tapping faster than
  the cadence buys nothing at all.
- **A held key or a resting finger re-asks every step**, so it flips at exactly that
  cadence and neither family has to repeat to compete. `game.test.ts` asserts a mashed key
  and a held key produce the **identical** number of flips.
- **An ask that lands inside the lockout is kept and spent by the flip it releases.**
  Without that latch a player would have to press at the instant the lockout ends, and the
  game would be about timing a press rather than about choosing a moment. One tap is one
  flip, always.

What is left to be good at is *when*, and *which surface* — which a thumb and a key express
equally well.

## Win, lose, draw

- **Win:** first runner to cross the line at 90 cells.
- **Draw:** both crossing on the same step; or level when the clock runs out. Both runners
  are stepped before either is judged, so a simultaneous finish is the dead heat it is
  rather than a win for whichever seat the loop ran first.
- **Backstop:** at 120 s the race is called on **distance** — not on the cell count the
  scoreboard prints, because the count is the distance rounded down and calling on it would
  turn a race decided by a stride into a dead heat. The check lives in `stepMatch`, not in
  the game class, so a host that forgot to look at the clock still could not produce a race
  that never ends.

## Termination

Structural, and stronger than Lumberjack's: **a runner goes forward whether or not anybody
says anything**, so there is no such thing as a match nobody advances. Two absent players
clip every floor block and dead-heat over the line in 31 s. The slowest measured pairing —
two `easy` bots — averages 32 s and the longest of 150 ran 42 s, against the 120 s
backstop.

## Edge cases

| Case | Behaviour |
|---|---|
| Both players idle | Both runners hold the floor, clip every floor block, and dead-heat |
| A tap during the lockout | Latched and spent by the flip it releases; never dropped, never doubled |
| A key held across a pause | Latch cleared on pause and on resume, so nothing flips on the first step back |
| An absolute ask that is already true | Nothing happens, and no lockout is started |
| Caught against a block | Picked up on the surface that cell leaves open, so the same block cannot catch it twice |
| Flipping mid-crossing | Legal, and the velocity carries: you decelerate and come back. Bailing out of a crossing is a real move |
| Reading off the end of the course | `blockAt` answers CLEAR; the course is generated 7 cells longer than anybody can reach |
| Race already decided | `stepMatch` returns immediately and neither runner moves |
| One runner home, the other still coming | The finished runner freezes; the match is over on the same step anyway |
| Rematch on the same instance | `init` refills the course, resets both runners, both bot states and the clock |

## The bot

Three tiers, expressed only as **reaction delay, waver and blunder rate** — never a faster
runner, a shorter flip lockout, a longer look down the lane, or anything a player cannot
have (rule 6). It reads **3 cells** where a person sees 5, so it is the worse informed of
the two at every moment.

| Tier | Reaction | Waver | Blunder |
|---|---|---|---|
| easy | 0.40 s | ±0.24 s | 14% |
| normal | 0.22 s | ±0.11 s | 5% |
| hard | 0.11 s | ±0.05 s | 1.5% |

Between looks it holds the surface it last chose, exactly as a player whose eyes are still
on the last block would — and because the speed quickens with the streak, that is a trap it
walks into by *doing well*. Each tier climbs until the course arrives faster than it can
read and falls off there: measured average peak streak per race, `easy` 21, `normal` 25,
`hard` 29.

**Two floats a look, unconditionally**, whatever it decides. Fruit Duel gave p1 thirty wins
in forty in a game with no seat asymmetry anywhere in its rules, because a seat whose draw
count depended on what it decided shifted the other seat's stream. `BOT_DRAWS_PER_LOOK` is
asserted by a test that counts them, for every tier and forty starting positions, and a
second test asserts a step on which it does not look spends nothing.

Measured, seeds 5000+, 150 races an equal pairing and 40 a mixed one:

| p1 tier | p2 tier | p1 | p2 | draws | average | p1 falls / p2 falls | p1 share of decided |
|---|---|---|---|---|---|---|---|
| easy | easy | 76 | 74 | 0 | 31.8 s | 11.1 / 11.3 | 50.7% |
| normal | normal | 73 | 77 | 0 | 27.6 s | 7.8 / 7.8 | 48.7% |
| hard | hard | 72 | 76 | 2 | 25.4 s | 6.1 / 6.0 | 48.6% |
| easy | normal | 8 | 32 | 0 | 29.1 s | 10.6 / 8.3 | 20.0% |
| normal | easy | 35 | 5 | 0 | 29.5 s | 8.7 / 10.8 | 87.5% |
| easy | hard | 2 | 38 | 0 | 26.3 s | 9.1 / 6.1 | 5.0% |
| hard | easy | 40 | 0 | 0 | 26.3 s | 6.2 / 9.1 | 100% |
| normal | hard | 4 | 35 | 1 | 26.2 s | 7.8 / 6.1 | 10.3% |
| hard | normal | 36 | 3 | 1 | 26.4 s | 6.3 / 7.7 | 92.3% |

Equal-tier win rates are 48.6–50.7% to p1 of the decided races — all inside the 40–60% band
— and every tier beats the one below it from **either** seat, by 32 of 40 or better. The
tiers separate on the thing the game is about as well as on who wins: falls per race run
11.2, 7.8, 6.1 down the ladder, and a test asserts that ordering rather than leaving it to
the table.

**What came out the opposite of the assumption:** the speed ramp was put in for
*difficulty* — the genre says run fast — and it turned out to be the thing that makes the
race decidable at all, and the thing that keeps the two seats level. With the ramp pinned
flat, `hard` against `hard` drew 25–37 of 150 depending on the speed chosen, and the
equal-tier seat balance drifted as far as 42.7% to p1 (`normal`, flat at 400) because the
outcome was resting on an integer. With the ramp: two draws in 150 and 48.6%.

## Presentation

- **Shared-screen** — the lane is symmetric about the centre of the box and carries no
  text, so both seats read their own half upright with nothing rotated and no
  `pushSeatRotation` in the game at all. A test asserts `text` is never called.
- **Single-seat** — identical simulation; the shell owns the layout.

Every rectangle a seat owns is asserted to lie wholly within that seat's own half of the
box and wholly inside the box horizontally (rules 9 and 8), across a whole race, including
a fallen runner, a full tally bar and the finish line coming into view.

## Rule 7: never colour alone

- Seat one's runner is a **disc with a solid core**; seat two's is a **square with a bar
  across it**.
- Seat one's tally bar is solid; seat two's is hatched.
- The two lanes are two shades of ground, so which half is yours survives greyscale.
- **Which way is down** is drawn as an arrow on the runner itself, pointing at the surface
  gravity is pulling it towards. A gravity game whose gravity can only be inferred by
  watching the runner move is a game that has to be played twice before it can be read once.
- Speed is drawn as the **length of the runner's trail**, so how fast you are going is a
  measurement rather than a hue.
- Blocks carry teeth on their inner edge, pointing into the lane, so which surface a block
  belongs to is legible in silhouette.
- Being caught is drawn in silhouette — the runner **lies flat** — with a cross over it and
  a recovery bar whose length is the time left. Three signals, none of them colour, for the
  single most important thing the screen ever says.
