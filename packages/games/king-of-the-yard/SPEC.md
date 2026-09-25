# King of the Yard — specification

**Archetype:** `rt-arena` · **Category:** Arena · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** ~90 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

One crown in an open yard. Whoever is wearing it banks time; touching the wearer takes it.
First to twenty banked seconds wins.

The tension is that the two players want opposite things at every moment, and the roles
swap the instant they meet — the same touch that wins you the crown puts you in the
position of being chased. There is no safe place and no waiting move.

## The yard

| | Value | Why |
|---|---|---|
| Yard | 900 × 900, 40 of wall | |
| Player | radius 46, speed 320 | |
| Crown drag | ×0.72 | **The entire balance** — see below |
| Steal cooldown | 0.85 s | |
| Loose delay | 1.2 s | Both players can see where it landed before the race starts |
| Target | 20 banked seconds | |

**The wearer is slower.** Without it the game has no tension at all: whoever takes the
crown first simply runs away with it for the rest of the match, because both players move
identically and a chase nobody can win is not a chase.

A diagonal run is not faster than a straight one — the heading is normalised — which is the
sort of thing that is invisible until somebody notices they can move 41% faster by holding
two keys.

## The two rules that stop it breaking

**A steal cooldown.** Two circles that overlap stay overlapping for many steps, so without
one the crown would flip back and forth every step while the players touched. That reads as
the game having a seizure rather than as a struggle.

**A tie for a loose crown goes to the closer player.** "A tie goes to nobody" was the first
rule and it **deadlocked the whole game**: the two start symmetric, the crown drops on the
centre line, and two bots of the same tier move identically — so they arrived together on
every step and nobody ever picked it up. Measured, normal against normal spent three
hundred seconds with the crown untouched.

Closer wins; on an exact tie the seat that has worn it *less* takes it, which is the fair
answer rather than an arbitrary one; and if that is level too, a seeded coin, because
something has to decide and it must replay the same way **[ours]**.

## Scoring

Banked seconds, reported to the shell as **whole** seconds so the number changes at a
readable rate rather than flickering sixty times a second.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Drag anywhere to run that way | `W A S D` or the arrow keys |

## Determinism

The crown's drop position and the coin that settles a total tie come from the seeded RNG;
everything else is the fixed delta. A match replays identically from its seed. **Each bot has
its own generator**, seeded from the match RNG — shared, the seat polled first would take the
earlier value of every pair, and here the two seats decide on the same step rather than
alternately, so that would be a standing bias rather than an occasional one.

There is no opening seat. This is a real-time game and the SDK's contract says outright that
real-time games may ignore `context.openingSeat`; both halves of every seed pair come out
identical, which the balance harness reports and does not fail.

## Seat balance

The yard is one square with the two seats side by side, so swapping them is the reflection
`x -> 900 - x`; `y` is untouched. Both starting positions, the walls, the crown's drop column
and the movement clamp are all fixed by that reflection, so if every rule were covariant under
it the game would be fair by construction. **The balance harness recorded it at 38.9% for seat
one over a thousand seeds**, and three rules were not covariant. None of them was in the rules
module's arithmetic, which is why nothing in `rules.test.ts` could see the largest of them.

**The two seats were resolved one after the other.** `game.ts` ran heading-p1, move-p1,
heading-p2, move-p2. A chase is nothing but "where is the other player", so seat two was aiming
at where seat one had *already moved to this step* while seat one aimed at where seat two had
been at the end of the last one — half a step of extra freshness, every step, for one seat.
That is information a person at the glass does not have, so it is a rule 6 breach as well as an
unfair one. Both seats now read the yard, and only then do both move. **Worth ten points**,
measured by putting it back: 39.7% against 50.3% over a thousand seeds. `rules.test.ts`'s own
`play` helper had always read both headings before moving either player, which is exactly why
every test in that file passed while the shipped game did the other thing; `game.test.ts` now
asserts the property directly — a human seat's input on step N may not reach the bot seat's
position until step N + 1.

**The chaser's velocity estimate started from the top-left corner.** `lastTargetX/Y` were
initialised to `0`, and `0` is a point in board coordinates. The first frame of every chase
differenced the prey's position against it and called the result a velocity: about 1700 units a
second at a `normal` reaction, pointing at increasing `x` and `y`, which the bot then led by a
quarter of a second. A wrong answer with a fixed compass bearing is a seat bias in a mirrored
yard, and nothing cleared the stale reading between chases either, so it fired again every time
a bot lost the crown it had been wearing. `BotState.tracking` now records *whom* the bot has
been watching, and one observation is treated as a position rather than as a velocity. **Worth
3.3 points**: 46.7% with it back.

**The wearer picked its escape corner against the yard's midline.** `chaser.x < 450` does not
change sign under the reflection, where `chaser.x - me.x` does — and the crown is dropped on
`x = 450` every single match, so the chaser stands on that knife edge by construction rather
than by coincidence. It is now "the far side from the chaser", with a third case: level on an
axis means no preference on that axis, because zero is the fixed point of the antisymmetric
quantity and any corner chosen there could only be chosen in absolute board terms. **Worth 1.2
points**: 51.2% with it back.

The wobble is the one thing here that cannot be covariant and does not need to be: a mirrored
heading needs the *negated* angular error, so the mirror suite feeds `1 - roll`, which is
exactly `-misjudgement(roll, spread)`. Over a seeded stream the two are the same distribution.
For the same reason this game's balance stays a **measurement** rather than becoming a proof —
the two bots wobble on separate streams and a chase amplifies a last-bit difference into a
different match — so the tests assert three sigma of the sample rather than an exact half.

Re-measured on the balance harness, seat one's share of decided matches:

| seeds | easy | normal | hard |
|---|---|---|---|
| 50 | 48.0 % | 44.0 % | 50.0 % |
| 250 (nightly) | 49.2 % | 51.6 % | 50.4 % |
| 1000 (the record's sample) | 47.1 % | 50.3 % | 53.1 % |

Three sigma at a thousand seeds is 4.7 points, so all three tiers are inside the 45–55 band at
the sample the 38.9 % record was taken at, and the game's line has been deleted from the
harness's `OUTSIDE_THE_BAND`. The 44.0 % at fifty seeds is the same fifty-seed figure the
deleted record itself quoted, and it is noise: three sigma at fifty seeds is 21.2 points.

## The bot

| Tier | Reaction | Wobble | Lead |
|---|---|---|---|
| easy | 0.50 s | 0.85 rad | 0 s |
| normal | 0.26 s | 0.40 rad | 0.25 s |
| hard | 0.12 s | 0.12 rad | 0.50 s |

Measured over thirty matches a pairing: hard beats normal **90%**, and both beat easy.

It chases the crown when it does not have it and runs for the far corner when it does. It
sees only what is on the screen.

**`lead` is the interesting one.** Chasing where somebody *is* means always arriving where
they were, so a good chaser cuts the corner and a poor one follows the tail. The bot
estimates the wearer's motion from where they were when it last looked — which is exactly
the information a person has. **One look is a position, not a velocity**, and saying so was
worth 3.3 points of seat balance: see **Seat balance**.

**It commits to a heading between decisions.** Re-choosing every step would average the
wobble to zero and make the tiers meaningless. That is a mistake this codebase has now made
in three separate games, which is why it is written down here rather than only fixed.

No tier reacts faster than a person.

## Presentations

One open yard read the same way up by both players: nothing rotates, and a test says so.

## Rule 7

p1 is a disc and p2 a square, and **the wearer is ringed in gold** as well as having the
crown drawn on their head. Who has the crown is the only thing either player needs to know
at a glance, and in a chase there is no time to read a number. A steal flashes for the same
reason: it is announced rather than left to be noticed.

## Not specified here

Art, audio and haptics. Also unmodelled: any collision between the two players other than
the steal — they pass through each other, which is deliberate, because a chase that can be
blocked by standing still is a different and worse game.
