# Two-player input design

The highest-risk piece of the project: two humans, one browser tab, several input
families, and no operating-system player separation. Every touch game is subtly broken if
this is wrong, so the design is settled here before the implementations land.

What a gesture *means* once it has a seat — press, drag, release, tap and cancel, per
archetype — is `docs/input-idiom.md`. This document stops at the seat.

## The problem in one sentence

A game must read **one shape** of input for each seat, no matter whether that seat is a
thumb on a shared phone, half a keyboard on a laptop, a mouse, or a second device
entirely.

## Seats, not devices

A **seat** is a player's position in a match: `p1` or `p2`. It is not a device, a person
or an input method. Everything below maps some hardware onto a seat, and games only ever
read seats.

## Configurations

| Configuration | Seats on this device | Presentation | Input sources |
|---|---|---|---|
| Shared screen | both | `shared-screen` | Split touch zones, or the keyboard split in two |
| Cross-device | one | `single-seat` | The whole device: touch, keyboard, pointer, gamepad |
| Solo | one (other is a bot) | `single-seat` | The whole device |

## Decision table

| Situation | Decision | Why |
|---|---|---|
| Touch lands on a shared screen | Seat is decided by the zone it **started** in, at `pointerdown` | A finger that crosses the midline must not steal the other player's control |
| That finger later crosses the divider | Ownership is unchanged until `pointerup` | Air hockey mallets and drag-aim shots routinely cross the centre |
| A point lands exactly on the divider | Belongs to the bottom seat | A tie-break has to exist and be written down; picking the near seat favours the player physically holding the device |
| Two players share one keyboard | P1 takes WASD + Space, P2 takes the arrows + Enter | Two comfortable, non-overlapping halves that avoid the worst ghosting combinations |
| A key is bound to both seats | Rejected, with an error naming the key | A silent collision is a match where one keypress moves both players |
| One player alone on a laptop | Keyboard **and** pointer both live at once | Nobody should have to choose a mode; some games aim better with a mouse and drive better with keys |
| Player switches from keys to mouse mid-match | Allowed, no mode switch, no dropped input | Switching modes mid-rally is the kind of friction that ends a session |
| Browser auto-repeats a held key | Ignored after the first `keydown` | Otherwise a held direction fires an action every repeat interval |
| Two inputs land in the same step | Ordered by source timestamp; inside the tolerance it is a **draw** | In cross-device play, ordering by arrival hands the win to the better connection |
| Diagonal movement from two keys | Normalised to unit length | Otherwise diagonal movement is 1.41x faster than straight, which is a real advantage |
| The tab loses focus | Every key and pointer is released | Otherwise a player returns to a stuck direction |

## Coordinates

Input reaches games in **logical units**, never device pixels. The pipeline is:

```
device pixels → viewport (scale + letterbox offset) → logical units → seat rotation
```

The seat rotation is applied last and is its own inverse, so a tap at a screen point maps
to the correct world point for a rotated seat. `toWorld`/`toScreen` are tested as exact
inverses because an off-by-one here misplaces every tap in every board game.

## Layouts a game may declare

| Layout | Divider | Used by |
|---|---|---|
| `horizontal` | A line across the middle; lower half is the bottom seat | Most shared-phone games |
| `vertical` | A line down the middle; left half is the bottom seat | Landscape games on a tablet |
| `shared-board` | No divider — both players tap the same board, turns alternate | Board games, where only the active seat's taps count |

## Input families and what each must satisfy

| Family | Must support | Known limitation |
|---|---|---|
| Touch | 10 simultaneous points, per-seat zone ownership | No hover state; fingers occlude the target |
| Keyboard | Both halves pressed at once, including a direction plus an action on each side | Keyboard ghosting on cheap membrane keyboards; defaults chosen to avoid the worst rows |
| Mouse / trackpad | Full single-seat control; drag-to-aim; hover where useful | One pointer only, so it can never drive two seats |
| Gamepad | Two pads mapped by connection order, reassignable | Hot-plug must pause rather than silently swap seats |
| Pen | Treated as a pointer | Pressure ignored for now |

## Fairness

Different hardware is not equally capable, so three rules keep matches honest:

1. **A shared precision envelope.** Aim is expressed as a normalised vector over a
   device-independent drag distance, so a mouse cannot place a shot finer than a thumb.
2. **Source timestamps.** Reaction outcomes are decided on when the input happened, not
   when the packet arrived.
3. **Same-class-only games.** A game that cannot be made fair across families says so in
   its manifest instead of shipping unfair.

## What the engine owns, and what a game owns

The engine owns: pointer capture, seat ownership, key state, auto-repeat suppression,
edge detection, hold timing, diagonal normalisation, coordinate mapping and rotation.

A game owns: what its actions mean. It reads `moveX`, `moveY`, `pointerX`, `pointerY`,
`actionPressed`, `actionHeld`, `actionReleased` and `holdSeconds`, and nothing else. No
game reads a key code, a pointer id, or a device type — a game that branches on hardware
is a bug, because the same build has to serve a phone, a tablet, a laptop and a desktop.
