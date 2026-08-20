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
everything else is the fixed delta. A match replays identically from its seed.

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
the information a person has.

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
