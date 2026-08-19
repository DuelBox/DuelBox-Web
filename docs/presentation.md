# Presentation: shared-screen and single-seat

Every game renders two ways. The SDK decides which; the game never does.

- **Shared-screen** — two seats, one viewport. Two people on one device.
- **Single-seat** — one seat, the whole viewport. One person on their own device,
  playing someone else remotely or a bot.

Rules, scoring and simulation are byte-identical across both. Only placement, rotation
and control mapping change. This is the spec every downstream presentation issue
references rather than re-deciding.

## Why this is a first-class concept and not a layout flag

The temptation is to treat single-seat as "shared-screen with the other half hidden". It
is not, and building it that way produces a game that is unfair, unreadable, or both.

A shared-screen layout divides one viewport between two people who are looking at it from
opposite sides. A single-seat layout gives one person the whole viewport in their own
orientation. Those are different placements of the same objects, not a crop of one
another. Bolt the second on later and each of the 107 games grows its own private answer
to a question the shell should have answered once.

## What differs, exactly

|  | Shared-screen | Single-seat |
|---|---|---|
| **Seats visible** | Both | Both, but only one is *yours* |
| **Play area** | One board, shared or split | The same board, upright |
| **Rotation** | Turns 180° to face whoever has the move | **Never rotates** |
| **HUD** | Rendered twice, one copy per seat, the far one turned | Once, upright |
| **Control zones** | Split by the seat divider; a touch belongs to the seat it started in | Whole viewport is yours |
| **Safe areas** | Both edges matter — someone is reading from each end | The near edge matters most |
| **Pause** | Either player may pause | Pausing affects a remote opponent, so it is a request, not a command |

### Rotation in single-seat

**The play area never flips.** There is nobody at the other end of the device to read it.

This is worth stating flatly because the code that flips is shared: `SeatFlip` is driven
by `seatView(seat, presentation, localSeat)`, which returns `rotated: false` for every
seat whenever the presentation is single-seat. A game must never reach past that and
decide for itself.

The consequence for turn-based games is that the *cue* for "it is your turn" has to come
from somewhere else in single-seat, because the board turning is no longer available. The
shared HUD's turn indicator carries it.

### The HUD is drawn twice, and only once is spoken

In shared-screen the scoreboard renders twice — upright below the board and rotated above
it — so both people can read it. The rotated copy is `aria-hidden`: the score must be
*announced* once, not twice, or a screen-reader user hears everything doubled.

## What each archetype defaults to

Every game supports both presentations. "Default" here means which one the archetype was
designed around, and therefore which one gets the benefit of the doubt when the two
conflict.

| Archetype | Default | Single-seat notes |
|---|---|---|
| `turn-board` | shared-screen | Board upright; turn indicator replaces the flip as the cue |
| `turn-aim` | shared-screen | Aim controls move to the near edge, within thumb reach |
| `rt-split` | shared-screen | Your half fills the viewport; the opponent's half is drawn but not reachable |
| `rt-arena` | shared-screen | Whole arena upright; the camera never favours either seat |
| `rt-race` | single-seat | Lanes are already parallel and independent, so one screen each is the natural form |

A game declares support in its manifest's `presentations` array. The build fails if a game
offers a mode it cannot present: `modes: ['friend']` requires `shared-screen`, since two
friends on one device is what that mode means.

## Fairness: the identical logical viewport

**Neither player may ever see more of the play area than the other** (CLAUDE.md rule 9).

In shared-screen this is free — there is one screen. In single-seat across two devices it
is the fairness problem nobody sees coming: a laptop player whose wider screen reveals
more of the arena than the phone player's has a real, invisible competitive advantage.

The rule is therefore: **both devices letterbox to a negotiated shared logical viewport.**
`negotiateSharedLogical(a, b)` in the engine returns the largest box that fits inside
both, and each device letterboxes to it. Surplus screen space holds chrome — HUD,
controls, a pause button — and never extra field of view.

This is why no simulation value may be expressed in pixels (rule 8). The negotiation only
works because the play area is declared in logical units the two devices can agree on
before either has drawn anything.

## What a game is allowed to know

A game receives `presentation` and `localSeat` in its `GameContext`. That is the whole
surface, deliberately.

A game may use them to **place** things. A game may never use them to change **rules** —
no different win condition, no different physics, no different bot. If a game reads
`presentation` inside `update()` for anything other than a layout decision, that is a bug:
the two presentations must step the identical match, and the cross-viewport determinism
test enforces it.

A game may never ask what *device* it is on. There is no API for it, ESLint forbids the
globals that would answer, and a game that wants to know is a game about to break
one-build-serves-every-device (rule 10).

## Open, and deliberately so

**Runtime presentation switching is not implemented.** Switching mid-match — a player
starts alone, a friend joins on a second device — is #2351's subject. The abstraction
above supports it in principle: presentation is passed per frame rather than baked in at
`init`, and simulation state is untouched by it. Nothing exercises that path yet, so it is
untested rather than known-good.

**The dev toggle asked for in #1863 is not built.** A toggle that ships to production is
worse than no toggle, and the honest way to strip it is a build-time flag rather than a
runtime check — which is a small piece of work with a real decision in it, not a
five-minute add. Left open on that issue rather than half-done.
