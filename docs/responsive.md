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

## What is verified, and what is not

Verified in the browser suite, on Desktop Chrome, Pixel 7, and iPhone 14 Pro in both
orientations: no horizontal overflow; the board fits its viewport with no part off-screen;
nothing interactive sits outside the visual viewport.

**Not verified: real safe-area insets.** Playwright sets a viewport, not a cutout, so
`env(safe-area-inset-*)` resolves to zero in every test. The layout is provably sound; the
inset values are not exercised. That needs a physical device, and #1885 stays open on it.

**Not verified: anything above 1440px or below 320px.** The first because no test runs
there, the second because it is below the supported floor by definition.
