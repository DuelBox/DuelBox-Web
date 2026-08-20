# Snake Clash — specification

**Archetype:** `rt-arena` · **Category:** Racing & Trails · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 90 s

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

Two snakes share one arena. Steer; you cannot stop and you cannot reverse. Run into a wall,
into yourself, or into the other snake and you die. Eat ten pellets and you win.

This is the first game here with a **body that grows into a hazard**. Every other obstacle
in this collection is placed by the game; these are placed by the players, one segment at a
time, and the arena fills up with the consequences of your own success.

## Continuous, not gridded **[ours]**

A grid makes the two snakes take turns in effect — everything happens on cell boundaries —
and turns steering into typing. Continuous movement with a turn *rate* keeps a thumb
meaningful, and it is what makes a near miss feel like a near miss.

## The arena

| | Value | Why |
|---|---|---|
| Arena | 900 × 900, wall 20 | |
| Head | radius 13 | |
| Segment spacing | 11 | Recorded by distance, never by frame |
| Speed | 130 a second | See below |
| Turn rate | 3.4 rad/s | About a full circle in two seconds |
| Neck | 6 segments ignored | Or a hard turn kills you on your own neck |
| Pellets | 3 out, +7 segments each | |
| Target | 10 pellets | |

Segments are recorded **by distance travelled**, not per frame, so a snake's length in
segments does not depend on the frame rate.

## Four things came out the opposite of what I assumed

Each was measured, and each changed the game rather than polishing it.

### The opening was unplayable

The snakes started face to face across the middle — perfectly fair, and the rounds lasted
**three seconds** and half of them were draws before anyone had eaten anything. They simply
met head-on. Starting them diagonally opposite, each heading along its own edge, is fair in
exactly the same way (the position is identical under a half-turn of the arena) and is a
game. **A fair opening is not the same as a good one.**

### Eating was pure downside

With no target, a pellet makes you longer, which makes the arena tighter *for you*, and
gains nothing. The bot tiers proved it: the tier that ignored food **beat** the tier that
chased it, 40 to 17, by circling an empty half while the other two grew and crashed.

The pellet target makes eating the way you win rather than a way you lose. It fires in
about a fifth of bot rounds — a real alternative win that does not dominate the crash.

### The bot only avoided where the opponent *was*

Two snakes approaching each other both saw a clear path into the empty space between them,
drove into it, and met. **103 of 109 deaths were head-on collisions.** Projecting the
opponent's head forward along its heading — crude, since it might turn, but being wrong
about a threat is far cheaper than not seeing one — nearly doubled the round length and
collapsed the draws.

### Slower is better

Swept: at 210 units a second a round lasted 7.7 seconds and the snakes ate 2.4 pellets
between crashes; at 130 a round lasts about 20 seconds and they eat 5.2. Slower is not more
sluggish here — it is the difference between a game with decisions in it and two snakes
meeting in the middle before anything has happened.

## The bot

| | Lookahead | Fan |
|---|---|---|
| easy | 0.45 s | 5 headings |
| normal | 0.90 s | 7 |
| hard | 1.50 s | 11 |

**Every tier chases pellets**; they differ only in how well they stay alive while doing it.
An earlier draft had the weakest tier ignore food, which made it play a different game
rather than the same game worse.

It fans out headings either side of the one it is on, keeps the ones whose path is clear,
and prefers the one pointing nearest a pellet. The exact bearing to each pellet is offered
as a candidate too — a fan of eleven across ±135° has its finest step at 27°, so a bot
steering only by fan slots can aim *near* a pellet and never at one.

Steering is **proportional**: the offset it wants divided by what one decision can turn. The
first version divided by a constant a tenth that size, so every offset clamped to full lock,
and the bot could only ever turn as hard as possible — which is why it circled the arena and
ate 1.2 pellets in a 65-second round.

Measured over 60 rounds a pairing: hard beats easy 38–21, hard beats normal 35–24, normal
beats easy 33–26. Symmetric pairings come out level, as they should.

Every tier sees the arena a human sees, per rule 6.

## Controls

The **direction of the drag**, not the position of the finger. Put a thumb down anywhere and
pull the way you want to go.

Pointing at an absolute spot was the obvious first try and does not work here: the shell
divides a shared board into two pointer zones, so each player owns half the screen, and a
player whose snake is in the far half could not point ahead of it. A relative drag works
from anywhere in your own half, which is the only place a thumb can be.

On a keyboard, A and D steer the left snake and the arrow keys the right. There is no stop.

A new touch takes a fresh origin even when the seat's pointer never went null — a second
finger can take over mid-drag, and measuring from the old origin would lurch the snake.

## A round always ends

Two cautious snakes circling their own halves would never meet. `roundSeconds` in the
manifest is validated by the schema and read only by the catalogue card — it ends nothing —
so the game holds its own 90-second clock and decides on pellets eaten, drawn if level.

## Rule 7

p1 is a plain body with a **ringed** head; p2 carries a **bar** across every segment. The
case that matters is two snakes tangled together on screen, which is most of this game, so
the bar is on the body rather than only the head. Both taper toward the tail, so which end
is the head is never in doubt, and a dead snake dims — the wreck is still in the way, so it
has to stay visible.

## Determinism

No wall clock, no `Math.random`, one `Rng` from the context. Pellet placement is rejection
sampling with a bounded attempt count and a fallback, because a pellet that never appears
would stall the round. The same seed replays to the same arena.

Both snakes move before either is tested, so a head-on kills both rather than whichever was
checked first — iteration order must never decide a death.

## Not specified here

Portals, speed boosts, more than two snakes, or the variant where your tail is safe. All are
real snake games; none of them is two people on one phone.
