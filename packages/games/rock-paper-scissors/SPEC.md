# Rock Paper Scissors — specification

**Archetype:** `rt-split` · **Category:** Reaction · **Logical box:** 600 × 1000 ·
**Zone split:** horizontal · **Round length:** ~60 s

> **The first genuinely simultaneous game in the catalogue.** Everything else here is
> turn-based, or has each seat acting independently on its own half; this has both players
> committing at the same instant to the same decision. Specified alongside the
> implementation; **[ours]** marks decisions with no basis in the observed rules.

## Observed rules

> Press the button of your choice before the hand stops. First to 3 wins.

Two facts: a round is a **window** rather than a prompt, and the match is first to three.

## The board

Three buttons per seat, p1's row low and p2's high, so **each seat's buttons sit under its
own hands**. That is what makes a simultaneous game workable on a shared device at all —
if both players reached for the same controls, one would block the other.

A single window bar runs across the middle. Both seats read the same clock from the same
place: if each had its own countdown, one could believe it had longer than the other.

## Scoring and the win condition

**First to three rounds.**

A round resolves when **both seats have committed**, or when the window closes — whichever
comes first. There is no reason to wait out the clock once both have chosen.

| p1 | p2 | Outcome |
|---|---|---|
| a throw | the throw it beats | p1 |
| the same throw | | draw, nobody scores |
| a throw | nothing | p1 |
| nothing | nothing | draw, nobody scores |

## The rule this game exists to get right

**Speed decides nothing. Only the choice does.**

`resolveRound` deliberately does not consider *when* each seat committed. If being thirty
milliseconds quicker won a round, then across two devices the player with the better
connection would win the match, and no amount of timestamp reconciliation would fix it —
the game would be decided by the network.

The SDK's `resolveSimultaneous` and its eight-millisecond tolerance exist for games where
speed genuinely is the contest; this one references the constant so a change to the SDK
default is visible here, but the round is decided by the throws alone.

## Controls

| | Pointer | Keyboard |
|---|---|---|
| Both seats | Tap one of your three buttons before the bar runs out | `A`/`D` or arrows to choose, Space or Enter to lock it in |

Only three buttons, so a key press moves the cursor one and there is no repeat to
configure. A choice is **final** once committed — a second tap is ignored, because
changing your mind after seeing your opponent commit would defeat the whole point.

## Edge cases

- **A tap on the other seat's buttons.** Ignored. Ownership is by seat, not by where the
  finger happens to be.
- **A tap on nothing.** Ignored.
- **A second tap after committing.** Ignored. A choice is final.
- **Neither seat committing.** A draw; nobody scores. The match simply takes longer.
- **One seat committing.** That seat wins the round — pressing beats not pressing.

## Determinism

The window (2.2 s) and the reveal (1.1 s) are counted in whole simulation steps.

**A bug worth recording:** the first window was one step long, so the opening round
resolved before either player could touch anything. The step rate is not known until the
first `update` — the loop tells the game its delta rather than the game assuming one — and
the window was being sized in `init`. It is sized lazily now, with `-1` meaning "not yet
sized". The other games avoid this with the same sentinel for their think delays; this one
needed it for the round itself.

## The bot

It reads the *other* seat's habits and plays the counter, at a strength set by difficulty:
easy never reads at all, hard reads most of the time. That is the same thing a person does
across a table, and it means the bot has **no information a human lacks** — it can see
what its opponent has tended to throw, never what they are about to.

Difficulty also sets how early in the window it commits, which is presentation rather than
strength: an easy bot dithers.

A test plays each tier against an opponent who always throws rock and requires the hard
tier to win more often than the easy one — a reader should punish a predictable player,
and pure chance should roughly break even.

## Presentations

**Nothing rotates, in either presentation.** There is no active seat whose view the board
turns to face — both act at once, and each seat's buttons are already under its own hands.

This game therefore has no `getActiveSeat`, which the `Game` contract makes optional for
exactly this case: reporting a turn would make the shell's turn indicator claim something
untrue.

The three throws are distinguished by **shape** — a disc, a square, and an open cross —
because both seats use the same three symbols, so the symbols must be separable from each
other with no colour at all.

## Not specified here

Art and audio, cross-device play, and the fairness audit.
