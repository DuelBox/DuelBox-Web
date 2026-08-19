# Product differentiation brief

Every design decision gets checked against this. Without a written answer to "why is this
not just a clone?", each individual decision drifts toward the thing we were looking at,
because that is always the path of least resistance — and a hundred small drifts add up to
a copy nobody decided to make.

## The positioning, in one sentence

**DuelBox is the two-player games collection that needs no install, works across two
different devices, and can be found from a search — the reference app is an app, and we
are the web.**

Everything below follows from that sentence. If a design decision does not serve it, it
is decoration; if a decision contradicts it, it is wrong.

## What we are that the reference app is not

These are not aspirations. They are structural properties we already have, and each is
something the reference app cannot easily acquire.

- **No install.** A link opens a game. No store, no download, no permission prompt, no
  50 MB before the first move. This is the single biggest advantage and most of the design
  should be spent making it obvious rather than hiding it.
- **Cross-device.** A phone against a laptop, in the same room or in different countries.
  An installed app on one device cannot do this without becoming a network product; we
  are a network product by default because we are the web.
- **Findable.** 107 indexable pages, one per game, each answering "how do you play X for
  two players" for someone who typed exactly that. An app has one store listing.
- **Offline.** Once cached, a game plays with the network off — the thing people assume
  only an installed app can do.
- **Free to run, therefore free to use.** No ads, no accounts, no upsell, because the
  hosting costs essentially nothing (ADR 0001). That is a product promise, not a
  temporary state.

## The three experiences we intend to be visibly better

Not "as good as". Better, and better in a way a person notices in the first minute.

**1. Browsing 107 games.** A flat scroll of 107 identical cards is a list, not a
catalogue — you cannot form an intention about it, so you tap the first thing. We should
make the collection navigable by *what you feel like*: length, energy, whether it needs a
steady hand or a fast one. The measure of success is a pair choosing a game deliberately
rather than defaulting to the top row.

**2. Pairing two devices.** This is the moment we have that the reference app does not, so
it should be the moment that feels most like magic. Two people, two devices, playing in
under ten seconds with no accounts and nothing typed. If pairing feels like configuration,
we have wasted our best card.

**3. Running a tournament.** Seven games, a running score, two people who have now been
playing for twenty minutes. This is where a session becomes an evening, and it is where a
collection beats a game.

## What we deliberately do not copy

Mechanics and rules are not protected and are fine to reimplement — that is what the
catalogue *is*. Everything below is expression, and copying any of it would be both wrong
and lazy.

- **Layout and navigation model.** Not their grid, not their tab bar, not the order or
  grouping of their screens.
- **Card design.** Not their aspect, their corner treatment, their art placement, or the
  way a card indicates a category.
- **HUD arrangement.** Where the score sits, how a turn is indicated, what a countdown
  looks like. Ours is a shared component precisely so it is one deliberate decision rather
  than 107 imitations.
- **Colour identity.** Their player pairing is theirs. See the open question below — this
  is the one where we currently sit closest to them, and it needs deciding.
- **Iconography and illustration.** Our own cast, our own hand, drawn by us.
- **Copy voice.** Their button labels, their tone, their names for things. "Play together
  here" is ours; a phrase lifted from their pre-game screen would not be.
- **Naming.** Game names are descriptive where they need to be (`Tic Tac Toe`) and ours
  where they can be (`Drop Four`, `Sumo Push`). A name copied from them for a game whose
  common name is different is a tell.

## How a reviewer uses this

Three questions, in order. Any "no" is grounds to reject a design.

1. **Does this serve the positioning sentence?** A beautiful screen that makes us look
   more like an app and less like the web is a step backwards.
2. **Would this decision be different if we had never seen the reference app?** If the
   honest answer is no, it was copied — even if it was arrived at independently, because
   we cannot prove that and neither can anyone else.
3. **Could a stranger describe this screen without naming another product?** If the only
   available description is "like theirs but blue", there is no identity yet.

## The open question, stated rather than buried

**Our player colours are currently too close to the reference app's, and worse, they fail
a colour-vision check.**

Measured, not estimated. Our coral `#ff5a4e` against our sky `#21b0e8` gives a worst-case
contrast of **1.03:1 under deuteranopia** — the most common form of colour blindness,
affecting roughly one man in sixteen. At 1.03:1 the two seats are indistinguishable. And
our sky sits within an RGB delta of (3, 40, 3) of a typical reference-app blue, which is
close enough to be awkward.

The product is still usable, because CLAUDE.md rule 7 requires that colour is never the
only signal: each seat also has a shape (Pip a disc, Bo a rounded square), a name, and a
position. That rule is doing real work here — but it is a safety net, not a reason to keep
a palette that fails.

This is a decision about the product's identity and it is deliberately not made here. The
data and the candidate palettes are on #2322.
