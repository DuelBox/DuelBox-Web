# Browser and device support matrix

Without a written matrix, every bug report turns into an argument about whether it counts
(#225). This is the tiered answer: which browsers and device classes are **designed and
verified**, which are **expected to work but not separately designed**, and what a browser
outside both sees.

It is derived from three things that already exist and must stay consistent with them:
`CLAUDE.md`'s definition of done, `playwright.config.ts`'s project list, and
`docs/responsive.md`'s device classes.

## The tiers

**Tier 1 — designed, and verified on every push.** A bug here is a release blocker. These
are the engines and viewports the browser suite runs against on every push, plus the two
mobile browsers CLAUDE.md's definition of done names explicitly.

**Tier 2 — supported, verified less often or by proxy.** Expected to work; a bug here is a
normal-priority defect, not a blocker. Either a nightly-only engine, or a viewport class
`docs/responsive.md` marks "works but is not separately designed".

**Tier 3 — unsupported.** Not tested, not designed for. The site should degrade to a clear
message rather than a broken screen (see the last section); it does not owe a playable game.

## Browser engines

| Engine | Tier | How it is verified | Source |
|---|---|---|---|
| **Chromium** (Chrome, Edge, Brave, …) — current & previous major | 1 | `chromium` and `mobile` (Pixel 7) Playwright projects, every push | `playwright.config.ts` |
| **WebKit** (Safari, all iOS browsers) — current & previous major | 1 | `notched-portrait` and `notched-landscape` (iPhone 14 Pro) projects, **real WebKit**, every push | `playwright.config.ts` |
| **iOS Safari** specifically | 1 | The two WebKit projects above are real WebKit; CLAUDE.md's definition of done names iOS Safari outright | `CLAUDE.md` |
| **Chrome on Android** | 1 | The `mobile` Pixel 7 project; named in the definition of done | `CLAUDE.md` |
| **Firefox** (Gecko) — current | 2 | Nightly only, behind `DUELBOX_ALL_ENGINES=1`. The whole suite passes on it and has since first tried, so a third engine per push buys nothing; a nightly failure moves it to Tier 1 | `playwright.config.ts`, `CLAUDE.md` |
| Any engine two or more majors behind current | 3 | Not tested | — |
| Non-evergreen engines (Internet Explorer, legacy EdgeHTML, UC Browser, …) | 3 | Not tested; the build targets modern baseline JS and Canvas | — |

**Why WebKit is Tier 1 and not emulated.** iOS Safari diverges on audio unlock, viewport
units, `touch-action`, storage limits and canvas memory — the list in `playwright.config.ts`
and in QA issue #230. Both iPhone projects are real WebKit rather than an emulated viewport
for exactly that reason, and #230 is the standing manual pass for the systems a headless run
cannot exercise (real audio unlock, real storage pressure).

## Device classes (viewport)

The five width classes and one height class from `docs/responsive.md`, mapped to tiers. That
document is the authority; this table only assigns support levels and must not introduce a
sixth class — `breakpoints.test.ts` fails a breakpoint outside the named set.

| Class | From | Tier | Verified |
|---|---|---|---|
| **compact** | 320px | 1 | Board fits, no horizontal overflow — browser suite on four device profiles |
| **phone** | 30rem / 480px | 1 | Designed one-column |
| **tablet** | 40rem / 640px | 1 | Designed two-column |
| **laptop** | 64rem / 1024px | 1 | Designed three-to-four column, persistent header |
| **wide** | 90rem / 1440px | 2 | Works; content caps at 76rem rather than stretching — deliberately not separately designed |
| **short** (height) | ≤ 30rem / 480px tall | 1 | The one height class; scoreboards move beside the board. `--db-bp-short` is the only permitted height breakpoint |
| Below **320 × 480** | — | 3 | Below the supported floor by definition; the page scrolls rather than collapsing the board, but it is not designed |
| Above **1440px** (to 4K) | — | 2 | No horizontal overflow guaranteed 320px→4K; above 1440 is `wide` with more margin, not a new design |

**The floor is 320 × 480 CSS px** — an iPhone SE in portrait. **There is no ceiling**: the
logical box scales up and the letterbox absorbs the rest, so a 4K monitor gets a large board
and large bars (`docs/responsive.md`).

## Capabilities a supported browser must have

A browser can be a current Chromium or WebKit and still be unsupported if the environment
removes something the games need. These are load-bearing:

- **JavaScript enabled.** The catalogue, every content page and all SEO metadata are
  server-rendered static HTML, so a no-JS browser can *read* the site — but a game is a
  Canvas simulation and does not run without JS. See the notice section below.
- **Canvas 2D.** Every game renders through `Canvas2DRenderer`. No WebGL is required. A WebGL backend exists behind `NEXT_PUBLIC_RENDERER=webgl` (ADR 0006) and is off in every published build; `scripts/check-renderer-flag.mjs` fails a build that ships it without the flag.
- **`localStorage` (or a working stub).** Used for settings, last-mode and the head-to-head
  record. Its absence is handled — every read returns a fallback rather than throwing
  (`docs/play-configurations.md`, `apps/web/src/lib/local-store.ts`) — so private-mode and
  storage-full browsers stay in Tier 1; they lose only a convenience.
- **Web Audio.** Sound is an enhancement, not a requirement; a blocked or absent AudioContext
  costs the cues, not the game.

## What an unsupported browser sees

The acceptance criterion is: **an unsupported browser gets a clear message rather than a
broken page.** Two halves, and they are at different states of doneness — stated plainly
because a matrix that overclaims is worse than none.

**Half one — the page is not broken, today.** Because the site is a static export whose
content is server-rendered HTML, a browser that cannot run the games still receives a fully
formed, readable page: the catalogue, the rules, the legal pages, all as plain markup and
links. It does not white-screen. This is a property of the architecture
(`docs/adr/0001-static-first-hosting.md`), not of a fallback anyone wrote, and it holds now.

**Half two — telling the visitor, in two cases.** A reader with JavaScript disabled is now
told: the play route carries a `<noscript>` block (#103, `apps/web/src/app/play/[slug]/page.tsx`)
saying a game needs JavaScript and linking back to the catalogue and the guide, and
`e2e/no-javascript.spec.ts` holds it on every push. It is on the play route rather than in the
shell deliberately — a `<noscript>` in `layout.tsx` would be serialised into all 108 play-route
payloads a catalogue browse prefetches (the thirteenth guard in CLAUDE.md is the measurement:
markup in the root layout is not free), and the play route is the only page where scripting
off leaves a visitor with nothing to do.

What is still owed is the too-old-engine case: an engine that runs script but cannot create a
Canvas 2D context, or lacks something the games need, still finds a play button that leads to a
canvas that never starts. The minimal implementation is a capability probe on the play route
that renders a "your browser can't run this game" panel in place of the dead canvas. It is a
small, well-specified follow-up, recorded here so the requirement is not assumed met.

## Keeping this honest

- A new Playwright project, or a change to the device classes in `docs/responsive.md`, must be
  reflected here in the same change — the two are the source, this is the summary.
- "Supported" means a bug is a defect we own. "Verified" means something runs that would fail
  if it broke. They are not the same word: Firefox is supported and verified nightly; the
  wide class is supported and verified only for overflow, not for design. The tiers keep that
  distinction visible so nobody reads "supported" as "someone checked".
