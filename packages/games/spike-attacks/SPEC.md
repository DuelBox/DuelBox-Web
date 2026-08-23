# Spike Attacks — specification

**Archetype:** `rt-split` · **Category:** Survival · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** 60 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.

A row of nine standing stones each, and a volley of spikes down the row from one end or the
other. Each stone leans against one end and shelters the ground behind it; be in that pocket
when the volley lands and the stone takes the blow and cracks. Be anywhere else and it is
you the spikes reach. Two blows and you are out of the round. First to three rounds, nine at
most.

## Observed rules

From the reference genre: _"Hide behind the stones so you don't get hit by the spikes."_

Everything below is how that one sentence became a duel: a *which*, a *when*, and a reason
you cannot simply stay put.

## A stone holds off one end of the row, not both **[ours]**

That single asymmetry is the whole game. If a stone sheltered from everything, the answer
would be "stand behind a stone" and there would be nothing left to decide. Because it
shelters from **one** end:

- there is no position that is safe from everything, only positions safe from what has been
  announced;
- where a left-leaning stone and a right-leaning stone sit within a pocket of each other,
  their pockets overlap and leave ground that is safe from **either** end. Those are the
  **nooks**, and finding the next one is the game;
- a **pincer** — a volley from both ends at once — can only be survived in a nook, so the
  pincers are what eventually end a round.

The second rule that makes it a game is that **sheltering costs the stone**. Cover is a
consumable, so the nook you are standing in is the one you are destroying; standing still is
a strategy with a fuse on it. A whole stone takes two blows and a pincer costs two stones,
one at each end.

| | Value | Why |
|---|---|---|
| Box | 600 × 1000 | Portrait: a row each, one above the other, on an upright phone |
| Row | 9 stones, 58 apart, 464 long | Odd, so the middle has the same reach either way |
| Pocket | 66 behind a stone, 15 in front | See below — the 15 is not decoration |
| Walk | 190 u/s | One stone in 0.31 s |
| Stone | 2 blows | A nook is therefore four volleys of shelter, no more |
| Lives | 2 | See "the shared clock", below |
| Warning | 1.60 s, ×0.8 a volley, floor 0.30 | The whole difficulty curve |
| Pincers | from volley 5, +8% each, ceiling 60% | |
| Rounds | first to 3, 9 maximum | |

**The pocket starts 15 units in *front* of the stone**, which is to say you may stand
*against* it as well as behind it. That is not generosity, it is the difference between
cover and a trap: with the pocket starting exactly at the stone's centre, the safest-looking
place on the board is a knife-edge with the killing side of it three units — one step of
walk — away. The first measured set of bots died there, repeatedly, and `rules.test.ts` now
walks the whole width of a stone and requires every offset to count as sheltered.

**The reach is the difficulty curve**, and there is nothing else in it:

| volley | 0 | 2 | 4 | 6 | 8+ |
|---|---|---|---|---|---|
| warning | 1.60 s | 1.02 s | 0.66 s | 0.42 s | 0.30 s |
| reach | 5.2 stones | 3.4 | 2.1 | 1.4 | 1.0 |

Nothing ever becomes impossible; everything becomes **near**. By the sixth volley you can no
longer fetch cover from across the row, so you must already be standing beside what you are
going to need — which is exactly what makes a nook worth more than a pocket, and what the
`hard` bot's foresight is for.

## Both seats are dealt one field **[ours]**

Each seat has its own row of stones and receives its own volley, and the two are identical
because **they are dealt once and copied**, not drawn twice. Two independent draws from the
same generator would be fair on average, and a round is played once: a seat dealt three
nooks in a row against a seat dealt none has lost to the stream rather than to the other
player.

The stones and the volleys need different treatment, and the difference is the interesting
part:

- **The stones are per-seat objects.** They have to be: a stone is *spent* by the player who
  hides behind it, so one shared array would mean one seat's shelter crumbling under the
  other seat's blows. The price of that independence is that equality is no longer free, so
  it is tested — `rules.test.ts` compares both rows stone for stone (position, lean and
  remaining life) across 300 seeds and again on the second and third rounds of a match, and
  separately asserts the two arrays are *different objects* by cracking one and finding the
  other whole.
- **The volley schedule is one object.** A volley is an event in the world rather than a
  possession; both rows receive the same one, from the same end, at the same instant, and
  there is nothing to keep in step because there is only one of it.

The schedule for a whole round is dealt **before either player moves** — 20 bearings, one
per volley a round can possibly contain. That is worth more than it looks: the world is
drawn from the seeded stream at a fixed point, before any bot has spent a value, so the same
seed deals the same volleys whether the seats hold two people, two bots, or one of each. A
bearing rolled per volley would let a bot's own draws move the world. A test replays one
seed against three different input scripts and requires the same bearings at the same steps.

A deal is exactly **30 values**: one for the nook anchor, nine for the leans, twenty for the
bearings. Constant, so the shape of a round cannot depend on how the last one was played.

**One adjacent pair is forced to lean apart**, which guarantees every row opens with at
least one nook and so with at least one stone of each lean. Without it, one row in 256 leans
entirely one way and the first volley from the other end kills both seats before either has
taken a step. Both seats being equally robbed is not a defence: that is a round nobody
played.

## Termination is arithmetic, not a clock

Every volley costs a seat one of exactly two finite things: **a point of durability** if it
took cover — one for a single bearing, two for a pincer — or **a life** if it did not. The
field holds 9 × 2 = 18 points and the player 2 lives, neither of which is ever replaced, and
the round ends on the volley that takes a seat's last life. So no round can contain more
than **20** volleys, whatever either player does and however well they do it. `MAX_VOLLEYS`
is that sum rather than a number somebody measured, and the schedule is exactly that long.

The density ramp shortens a round a great deal in practice — measured rounds run 8 to 9
volleys, about seven seconds — but it is not what guarantees the end. `rules.test.ts` drives
a player that is simply *placed* in cover whenever cover exists, which is better than any
player could be, and finds the round over inside the bound on all 120 seeds, having read no
schedule entry past the end. A match between two players who never touch a key finishes 0–0
in about fifty-six seconds: nine rounds, each ending when the volleys reach the spot in the
middle of the row that neither of them ever left.

## The shared clock, and why there are two lives **[ours]**

The identical-field property has a sting in it, and it took a measurement to see. Both rows
are dealt the same stones and receive the same volleys, and **a survived volley costs the
same durability on both** — so two players who never make a mistake run out of cover on the
identical volley and draw. The two seats share an exhaustion clock exactly.

A hit costs a life and *no* durability. So the moment one seat is caught, the two fields
stop being the same field: the seat that was hit still holds cover the other has spent, and
from there the two rounds go different ways. Measured, `hard` against `hard`:

| | drawn rounds | `hard` v `normal`, decided |
|---|---|---|
| one life | 69% | 79% |
| two lives | 61% | 88% |

It is worth the extra field, and it is honest about what it is besides: a mistake in the
first second of a round should not be the whole round.

## Perfect symmetry, and the three things that break it

This game is its own mirror in the strongest sense — same stones, same volleys, same
starting spot, no interaction between the seats at all. Two bots of one tier with nothing
random in them are the same pure function of the same state, so they choose the same cover,
spend the same stone and die to the same volley, for ever.

Measured with the reaction wander, the taste and the stance all pinned to zero:

| | p1 | p2 | drawn matches | drawn rounds |
|---|---|---|---|---|
| easy v easy | 0 | 0 | 100 of 100 | 900 of 900 |
| normal v normal | 0 | 0 | 100 of 100 | 900 of 900 |
| hard v hard | 0 | 0 | 100 of 100 | 900 of 900 |

Every round of every match, at every tier. (Unequal pairings were unaffected — `hard`
against `easy` still finished 91–5 — which is what makes it a mirror problem rather than a
bug.) Three draws a look fix it, and each has a separate job:

- **when they look** — the reaction interval wanders by up to the tier's `wander`;
- **what they think of it** — every candidate's score is nudged by up to half of
  `BOT_TASTE`, which is deliberately far too small to send a bot to a stone that will not
  hold or that it cannot reach, and just large enough to reorder the stones that would each
  have done. Which of several equally good stones to spend is precisely the decision that is
  arbitrary for a person;
- **where they stand** — the spot inside the chosen pocket varies by `BOT_STANCE`, checked
  against the shelter before it is taken so it never steps a bot out of the cover it just
  chose.

The third is the one that compounds: a different stone spent is a different field, and from
there the two rounds are no longer the same round.

That is exactly **three** values per look, drawn unconditionally before anything branches on
any of them — the trap Fruit Duel was caught by, where a seat whose draw count depended on
its decision shifted the other seat's stream and gave p1 thirty wins in forty in a game with
no seat asymmetry anywhere. `BOT_DRAWS_PER_LOOK` is asserted by a test that counts them at
every tier over 500 steps.

## Controls

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `A` and `D` walk (of `W A S D`) | `←` and `→` walk (of the arrow keys) |
| Pointer | touch your own half; you walk towards your finger | the same, in the far half |

**There is nothing to press.** Walking is a *level*: there is no press to repeat, no cadence
to beat and nothing at all that happens faster if it is asked for more often, so a mashed
key, a held key and a thumb resting on the glass all move a player at exactly 190 units a
second. `game.test.ts` mashes a key at ten presses a second against a held one and finds the
mashed player strictly **behind** — never ahead — and the held one exactly where the clock
says. That is why this game does not have to declare `sameInputClassOnly` as Road Dodge did:
a rate cannot be won when there is no rate in it.

Only the *sign* of the ask survives, so a pointer cannot ask for a fraction of a step and a
keyboard cannot ask for a whole one. The pointer is read in the seat's own frame — the same
point on the glass is a different place on the two rows, because the far seat is reading the
board upside down — while the keys need no mapping at all: `D` is seat one's right and the
right arrow is seat two's right whichever way up either of them is sitting.

The two rows are **point-symmetric**, not mirrored: the far seat's row is the near seat's
turned half a turn about the centre of the box, exactly as the far player is turned. So
nothing here reads `context.presentation`, there is no `SeatFlip` and no `pushSeatRotation`
anywhere, and `game.test.ts` asserts the two presentations produce a byte-identical trace
from the same seed.

## The bot

Three tiers, all of them seeing exactly the row a player sees: which stones still stand,
which way they lean, how cracked they are, which end this volley is coming from and how long
there is. They differ in how often they look, how metronomic that is, and how far past the
volley in flight they think.

| Tier | Looks every | Wanders by | Foresight |
|---|---|---|---|
| easy | 0.32 s | +0–0.30 s | 0 |
| normal | 0.20 s | +0–0.18 s | 0.7 |
| hard | 0.05 s | +0–0.05 s | 1.5 |

Foresight is what a place is worth *next* time: a pocket that is also a nook answers either
end, and a stone with life in it will still be there. A tier with none is blind to both and
burns its cover. `easy` has none, which is exactly how a person plays this before they have
noticed that the stones run out.

**Rule 6 is proved rather than asserted, twice.** A bot that read one volley ahead would
know where to stand for a bearing nobody on the screen can see, so a test rewrites the whole
rest of the schedule underneath it and requires the same answer. A bot that read the other
seat would be playing a game its opponent is not, so a test wrecks the far field — position,
lives, every stone — and requires the same answer. And it never asks for a distance, only a
direction, so the same `driveField` moves it at the same 190 units a second as moves a
person.

### Two findings, both the opposite of what was assumed

**The tiers came out backwards, and the cause was three units of jitter.** The first
measurement had `easy` beating `hard` 122–78 and 119–77 from both seats. The bot walks to
its chosen stone and stops within three units of it — and the pocket started exactly at the
stone's centre, so half the time it settled two units on the killing side of the boundary it
had just chosen. `easy` looks rarely and so wandered less; `hard` re-chose sixty times a
second and so straddled the edge more often. Cover you can stand against fixed it. The
lesson is not about bots: a boundary a body straddles was a bad rule for a person too.

**Being able to walk somewhere better is not the same as it being worth walking.** With that
fixed, `hard` still only drew level with `normal`. Its taste for fresh stone and for nooks
had it hopping *between pockets it was already safe in*, and a step across open ground is
the only way to die here. The distance term was faint — 0.05 a unit, so the whole row cost
23 against foresight bonuses of up to 108. At a full unit a unit the row costs 464, more
than any preference can offer, and `hard` moves only when moving is worth it. `easy`, which
has no preferences and therefore stays put, had been beating it on that alone.

**And the reaction gap had to be widened to make `hard` mean anything.** At 0.07 s against
`normal`'s 0.15 s the two were 71–29 and 73–27, because the volley interval never
falls below 0.30 s and a bot that looks every 0.15 s never misses one. At 0.05 against 0.20
— where `normal` plus its wander can miss a whole interval late in a round, and `hard`
cannot — it is 88–12. The tiers are ordered by accuracy and reach and by nothing else: the
one knob that would be *nerve*, how much of a volley's flight a bot will spend walking, is a
shared 0.88, so no tier is braver than another. That is the mistake Slot Cars made and its
`hard` lost to it.

### Measured, 400 seeded matches a pairing

| | p1 | p2 | draws | p1 share of decided |
|---|---|---|---|---|
| easy v easy | 204 | 163 | 33 | 56% |
| normal v normal | 178 | 170 | 52 | 51% |
| hard v hard | 168 | 165 | 67 | 50% |
| normal v easy | 286 | 75 | 39 | 79% |
| easy v normal | 80 | 295 | 25 | 21% |
| hard v easy | 381 | 14 | 5 | 96% |
| easy v hard | 16 | 376 | 8 | 4% |
| hard v normal | 324 | 44 | 32 | 88% |
| normal v hard | 44 | 320 | 36 | 12% |

Every tier beats the one below it from **either** seat, by better than two to one in all six
directions. Matches run 45–64 seconds of simulated play against the 60 the catalogue
advertises.

**Four hundred seeds is not enough for the equal pairings and says so.** The four hundred
above put `easy` at 56%, which is a hair outside the band this repo asks for and would have
been reported as a seat bias. Twelve hundred, in three blocks of four hundred from unrelated
seed bases:

| | p1 | p2 | draws | p1 share |
|---|---|---|---|---|
| easy v easy | 561 | 523 | 116 | 51.8% |
| normal v normal | 543 | 496 | 161 | 52.3% |
| hard v hard | 470 | 492 | 238 | 48.9% |

The individual blocks ranged from 47.7% to 55.6%. A round here is decided by a handful of
volleys, so four hundred is inside the noise and a wider band would have hidden the question
rather than answered it. The test that runs on every commit uses four hundred with a 40–60%
band, which is what fits in half a second; the twelve hundred are here.

Solo survival, against an opponent placed in cover so it cannot lose first: **6.50, 6.95 and
7.37** volleys. The first version of that measurement let the opponent stand still, which
ends the round in two volleys and put all three tiers within a fifth of a volley of each
other — it was measuring the opponent's absence.

**Drawn rounds remain high between equal tiers** — 61% for `hard` against `hard`, 44% for
`easy` — and the reason is the shared clock above: with both fields identical, the endgame
arrives for both at once unless something has already separated them. It costs the match far
less than it costs the round (`hard` v `hard` matches are 83% decided), and it is a bot
artefact rather than a game one: two people diverge on the first volley they disagree about.

## Rule 7: never colour alone

Nothing on this board is text — a test asserts the renderer's `text` method is never called
through a whole match — so nothing needs translating and nothing has a right way up, which
is what lets one drawing serve two people sitting at opposite ends of it.

- **Which end a stone holds off** is a buttress drawn on that end: a shape, on a side, and
  the only thing on the board that is not symmetric left to right. It is the fact the whole
  game turns on, so it could never have been a hue.
- **How much of a stone is left** is its height *and* the notches cut in its face, so a
  stone about to fail is visibly shorter than a fresh one from across the room. A spent one
  is a flat mound of rubble.
- **Where the safe ground is** is drawn as bars under the row — one line of bars for the
  stones holding off the left, a second for those holding off the right, and only for the
  ends this volley is actually coming from. Ground with **two** bars under it is a nook.
  Position and count, not colour.
- **What is coming** is chevrons at the end it is coming from, pointing the way the spikes
  travel; a pincer is two sets facing inwards and needs no legend. The bar beneath drains
  from both sides as the volley closes.
- **Who is who**: seat one is a disc with a chevron, seat two a square with two bars. Lives
  are ticks over the head — a count, not a shade — and a player who is out gets a cross.
  A player currently sheltered from what is coming wears a roof.
- Round pips are discs for seat one and squares for seat two, each set on that player's own
  edge of the board.
- The near seat's ground is the lighter of the two grounds, so which half is yours survives
  greyscale even before you find your own figure.
