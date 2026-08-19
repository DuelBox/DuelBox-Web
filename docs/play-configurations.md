# The three play configurations

Single-player against a bot, two players sharing a device, and two players on separate
devices are three different products wearing the same games. Deciding the rules once is
what stops each of the 107 growing its own answer.

| | **Solo** | **Together** | **Remote** |
|---|---|---|---|
| Seats | One human, one bot | Two humans, one device | Two humans, two devices |
| Presentation | single-seat | shared-screen | single-seat, both ends |
| Rotation | Never | Turns to face whoever has the move | Never |
| Input | Whole device is yours | Split by the seat divider | Whole device is yours |
| Netcode | None | None | Peer-to-peer, lockstep |
| Works offline | Yes | Yes | No — needs the signalling handshake |
| Costs us | Nothing | Nothing | Signalling only, on a free tier |
| Manifest gate | `modes: ['bot']` | `modes: ['friend']` | `presentations: ['single-seat']` |

Two of the three cost nothing to run and work with the network off. That is not an
accident of implementation, it is the product: the simulation is on the player's device in
every configuration, and remote play differs only in where the *other* player's inputs
come from.

## Where the choice is made

**Per game, at the moment of playing — not globally.**

A player who wants a bot in Chess may want a friend in Air Hockey five minutes later, and
a global setting makes the second choice cost a trip to preferences. The pre-match screen
offers exactly the configurations that game supports, and the choice is made there.

**What is remembered is the last configuration used, as a default rather than a decision.**
Reopening a game you last played against a bot pre-selects the bot; it does not start one.
The distinction matters because the alternative — remembering hard — means a player who
hands their phone to a friend once has to undo it every time afterwards.

Stored in `localStorage`, which fits the zero-cost constraint: no account, no server, no
sync. It is a convenience, and losing it costs a tap.

## Switching mid-session

**Between matches: free.** The result screen offers a rematch in the same configuration
and a route back to the mode choice. Nothing is carried across except the head-to-head
record for that sitting.

**Mid-match: the match ends.** Changing configuration means changing who is playing, and
there is no honest way to continue a game whose second player has been replaced. The
result is recorded as abandoned rather than a win for either seat.

The one case worth designing rather than refusing is a **friend joining a solo match** —
you start alone against a bot, someone picks up a second device, and the bot hands over.
That is #2351's subject and is deliberately out of scope here. When it lands, the rule
above changes for exactly that transition and no other.

## Which archetypes support which

Every archetype supports all three, with one exception and one caveat.

- **The exception.** `rt-race` is `sameInputClassOnly` — see `docs/input-parity.md`. It
  supports Remote only when both devices are in the same input class, because the
  interaction is rapid discrete input, which a key does far better than a thumb and no
  normalisation fixes.
- **The caveat.** `turn-board` and `turn-aim` in Remote need a turn timer that Together
  does not, because there is no social pressure across a network. Nobody has written one
  yet; it belongs with the netcode work.

A game declares support through `modes` and `presentations`, and the manifest schema
already refuses the incoherent combinations — `modes: ['friend']` without
`presentations: ['shared-screen']` fails the build, because two friends on one device is
what that mode *means*.

## Acceptance criteria status, honestly

- **Doc committed with a decision table per configuration.** Done — the table above.
- **A game never offers a configuration it cannot support.** Done, and enforced at build
  time rather than at runtime: the pre-match screen renders a button per entry in
  `manifest.modes`, and the schema rejects a manifest whose modes and presentations
  disagree.
- **The choice survives navigation and reload.** Done. `apps/web/src/lib/last-mode.ts`
  stores it per game in `localStorage`, and the pre-match screen puts the remembered mode
  first so the button under the player's thumb is the one they used last. It changes
  *order*, never preselection — nothing starts without a deliberate press, which is the
  difference between a default and a decision.

  Every failure path returns the fallback rather than throwing: storage is genuinely
  absent in private browsing on some engines and full on others, and neither is worth a
  broken pre-match screen. Stored values are validated rather than trusted, because
  another tab, an older version, or a user with the console open can all put something
  unexpected there.
