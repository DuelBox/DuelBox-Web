# Responsive strategy: the canvas, and the shell around it

Two separate problems that are easy to conflate.

The **canvas** renders a fixed logical box scaled to fit. The **shell** — header, catalogue,
game pages — is a normal responsive web layout. The canvas strategy is nearly all
mechanism and barely any judgement; the shell strategy is nearly all judgement. Deciding
them together is how you end up with a game that reflows.

## Part one: the game canvas

### Fixed logical resolution, scaled to fit

Every game declares a logical box in its manifest — `{ width: 900, height: 900 }` for Tic
Tac Toe, `{ width: 600, height: 1000 }` for Air Hockey. The simulation runs in those units
and **no simulation value is ever expressed in pixels** (CLAUDE.md rule 8). The render
layer scales the box to the device and letterboxes the remainder.

This is not a rendering convenience. It is what makes cross-device play possible at all: a
phone and a laptop step the identical match because neither one's screen has any influence
on what is simulated. `cross-viewport.test.ts` drives every game at five viewport sizes and
requires bit-identical traces.

### The policy for mismatched aspect ratios

**Letterbox. Never crop, never stretch, never reveal more.**

- **Wider than the logical box** — bars left and right; the play area is unchanged.
- **Taller than the logical box** — bars top and bottom; the play area is unchanged.
- **Never** scale the axes independently. A stretched board changes the geometry the game
  simulates in, so a puck that bounces true on one device does not on another.
- **Never** show more of the world on a bigger screen. This is rule 9, and it is a
  fairness rule rather than an aesthetic one: a player whose screen reveals more of the
  arena has a real, invisible advantage. `viewport.test.ts` asserts it directly.

Surplus space belongs to chrome — the scoreboard, a pause button — and never to extra
field of view.

### Safe areas, browser chrome, and keyboards

**Safe areas belong to the layout, not the canvas.** The shell pads itself with
`max(spacing, env(safe-area-inset-*))`, so by the time the canvas is measured it is already
inside the safe region. The host passes `NO_INSETS` to `fitViewport` deliberately —
subtracting the root insets there as well shrank the play area twice over, which is a bug
this project actually shipped.

**Browser chrome must not resize a running match.** The shell is sized in `svh`, the
viewport with the chrome *visible*, rather than `dvh`, which tracks the address bar
sliding in and out and would resize the canvas mid-play. The cost is a strip of background
when the bar retracts; the alternative is a play area that moves while someone is aiming.
A `vh` fallback sits behind it for older engines.

**On-screen keyboards.** No game takes text input, so this does not arise during play. If
one ever does — a name entry, a chat — the keyboard must not be allowed to resize the
canvas; the input belongs in an overlay that scrolls independently.

### Below the minimum

**320 × 480 CSS pixels is the floor.** That is an iPhone SE in portrait, and it is the
smallest screen anyone still plays on.

Below it the shell does not pretend. The board has a `min-height` floor so it can never be
squeezed to nothing, and the page scrolls instead — an honest overflow is better than a
canvas collapsed to a sliver. Nothing is hidden, and no game is unreachable.

Above the ceiling there is no ceiling: the logical box scales up indefinitely and the
letterbox absorbs whatever the screen has spare. A 4K monitor gets a very large board and
very large bars.

## Part two: the shell grid

### The named classes

Seven ad-hoc widths were in use before this doc existed. These are the five that remain,
and nothing may introduce a sixth without changing this table.

| Class | From | Design intent |
|---|---|---|
| **compact** | 320px | One column. Thumb reach matters more than density. Tier one. |
| **phone** | 30rem / 480px | One column, more generous spacing. Tier one. |
| **tablet** | 40rem / 640px | Two columns. The first width where a grid beats a list. Tier one. |
| **laptop** | 64rem / 1024px | Three to four columns, persistent header. Tier one. |
| **wide** | 90rem / 1440px | Content stops growing; margin absorbs the rest. Tier two. |

**Tier one** means designed and verified at that class. **Tier two** means it works and is
not separately designed — above 1440px the layout is deliberately capped at `76rem` rather
than stretched, because a catalogue eight cards wide is harder to scan than one four cards
wide, not easier.

Ultrawide is not a class. It is `wide` with more margin, on purpose.

### The one height class

Width is not the whole story for a *match*. A phone held sideways is 844x390: wide enough
for anything, and short enough that a scoreboard above the board and another below leaves
the board almost nothing. Measured, before this class existed, a portrait 600x1000 game in
a 844x390 viewport got a **796x144** area and letterboxed inside it to about **85px wide**.
Unplayable — and identical for Whack a Mole, Air Hockey and Road Dodge, so it was the
shell rather than any one game.

| Class | Up to | Design intent |
|---|---|---|
| **short** | 30rem / 480px tall | The two scoreboards move to the sides of the board rather than above and below it. |

This is rule 9 doing its job rather than an exception to it: in a short, wide viewport the
surplus is *horizontal*, so that is where the chrome goes. It also matches how two people
actually hold a phone sideways between them — on opposite sides, left and right, which is
exactly where their own scoreboards then are.

`--db-bp-short` is the only permitted height breakpoint, and `breakpoints.test.ts` enforces
that on height queries the same way it does on width.

### Container queries

Used where a component's own box matters more than the viewport's — a game card in a
two-column grid on a tablet has the same width as one in a four-column grid on a desktop,
and should look the same in both. The viewport cannot answer that question; the container
can.

Not used for the page-level skeleton, where the viewport genuinely is the constraint.

### The rule that holds everywhere

**No horizontal page scroll at any width from 320px to 4K.** Wide content — tables, code,
a very long game name — scrolls inside its own container, never by moving the page. This
is asserted in the browser suite on four device profiles, and it is the one responsive
property that is a bug rather than a preference when it breaks.

### The layer ladder

The third dimension of the shell grid is named in `styles/tokens.css` too, as
`--db-z-overlay`, `--db-z-control`, `--db-z-hint`, `--db-z-cover`, `--db-z-confirm`,
`--db-z-recovery`, `--db-z-bar`, `--db-z-escape` and `--db-z-frame-notice` — ten apart, in
that order, from the pause panel over the board up to the framed-page notice. One ladder
rather than one per component, because there is only one stacking context to be a ladder
in: `PlaySurface` is `position: relative` with no `z-index`, no `isolation` and no
transform, so an overlay inside the board and a bar fixed to the viewport are painted
against each other rather than each within its own world. Layer zero has no token, since
everything in flow is ordered by the document. `tokens.test.ts` fails any `z-index` in the
shell that is not one of these, and any raw-pixel `padding` or `margin` that is not zero
and does not carry an `/* off-scale: why */` marker on its own line — a key cap's 6px and a
badge's 2px sit between two rungs of the 4px spacing grid and say so where they are
written.

## Verifying it

Two commands, and neither of them is a second screenshot-comparison system. The matrix is
evidence a person reads once, on the issue it was made for; the pictures a machine compares
on every push are `e2e/visual.spec.ts`'s committed baselines and nothing else.

### One game: `pnpm responsive <slug>`

```bash
pnpm build            # it drives the real static export, not a dev server
pnpm responsive tic-tac-toe
pnpm responsive tic-tac-toe --all-engines     # adds real WebKit
```

`scripts/responsive-matrix.mjs` serves `apps/web/out`, opens `/games/<slug>/`, the
`/play/<slug>/` lobby and `/play/<slug>/` with a match running, and walks all eleven cells of
this document's two tables — the five width classes in both orientations, plus `short`. Each
cell is photographed to `responsive-matrix/<slug>/<state>/<class>-<orientation>-<engine>.png`
(gitignored) and measured for three things: horizontal overflow, any visible interactive
element outside the viewport or inside the inset band, and the board's box relative to the
viewport. It prints a row per cell, prints the output directory, and exits non-zero with a
table of violations. `compact` and `short` carry a real iPhone's `--db-safe-*` values because
those are the classes a notched phone occupies; the wider ones carry zero, for the reason in
the section below.

**This is how a game's responsive issue closes.** Run it, read the table, attach the matrix —
the cells that changed, or all of them for a first pass — and say which class the fix was for.
An issue closed against a screenshot of one phone is an issue closed against one eighth of the
question.

### Every game: the nightly sweep

`e2e/responsive-sweep.spec.ts` opens every slug in `PLAYABLE` at 320px portrait and landscape
and asserts the same two properties through the same helpers (`e2e/responsive.ts`), so a
nightly failure reproduces exactly under `pnpm responsive <slug>`. It is inert without
`DUELBOX_RESPONSIVE_SWEEP=1` and runs in `nightly.yml` on Chromium and real WebKit. It starts
no match, deliberately: the lobby is the layout that differs per game, a running match is the
shell's furniture around a letterboxed canvas, and 107 countdowns would not fit the quarter
hour that job is budgeted.

### Diffs on a pull request

They come from the pipeline that already exists, because a second one would be a second set of
baselines to keep for the same five screens.

- **A change to the shell** — the header, the grid, a spacing token, anything in this
  document's part two — moves the committed PNGs in `e2e/__screenshots__`, the job goes red
  with a diff attached, and `docs/visual-regression.md` is the accept flow: download the
  baselines and the diffs, look at every lit pixel, and commit the new baselines *in the same
  commit as the change that moved them*.
- **A change to one game's layout** does not touch those five screens by design — the
  catalogue grid, the game landing pages and the category hubs are deliberately not
  photographed there, because a baseline that churns is a baseline nobody reads. The evidence
  for that change is the matrix from `pnpm responsive <slug>`, attached to the pull request.

The sweep is the backstop under both: it cannot say a screen looks wrong, only that nothing
scrolls sideways and no control has left the screen, on all 107 games rather than five.

## What is verified, and what is not

Verified in the browser suite, on Desktop Chrome, Pixel 7, and iPhone 14 Pro in both
orientations: no horizontal overflow; the board fits its viewport with no part off-screen;
nothing interactive sits outside the visual viewport.

**Verified at the floor, with a match running.** Each of those three profiles is a real
phone — 393x852 and 852x393 — and none of them is 320px. `e2e/safe-area.spec.ts` turns a
running match to both cells of `NARROWEST` and reads them through the same
`outsideSafeArea` the matrix uses, on one project per engine. That cell is there because the
match HUD put its pause button 2px into the home indicator at 320x568, and both of its
controls 8px into it at 568x320, on a layout every 393px project called clean (#2586).

**Not verified: real safe-area insets.** Playwright sets a viewport, not a cutout, so
`env(safe-area-inset-*)` resolves to zero in every test. The layout is provably sound; the
inset values are not exercised. That needs a physical device, and #1885 stays open on it.

**Not verified: anything above 1440px or below 320px.** The first because no test runs
there, the second because it is below the supported floor by definition.
