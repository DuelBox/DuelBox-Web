# DuelBox

A browser collection of two-player mini-games played by two people on one device
in one tab. Original implementations of game genres that are free to reimplement.
No accounts. Once a page has loaded it needs no network at all, and coming back to
a game this device has opened before needs none either: a service worker keeps the
shell and each played game on the device (#192, #2445). A game it has never opened
still needs a connection, and the catalogue says which games are here.

Read `docs/reference-analysis.md` before touching engine, input, or SDK code — it
records what the reference app actually does and why our architecture is shaped
the way it is.

## Non-negotiable rules

1. **Original assets only.** Never copy art, audio, code, UI layouts, or names from
   another product. Mechanics and rules are fine — they are not protected.
   Everything else is not.
2. **Never decompile, unpack, or extract from any APK.** Reference apps are
   researched by playing them and writing down what is observed. If you find
   yourself reaching for apktool, jadx, or unzip on an APK, stop and say so.
3. Every asset needs an `assets.license.json` entry. CI enforces it.
4. All simulation runs on the fixed timestep. Never `Math.random()` in gameplay —
   seeded RNG only. Lint enforces it.
5. No per-frame allocations in engine or game `update()`.
6. Bots never get information, speed, or physics a human cannot get.
7. Colour is never the only signal. Every player-owned element also differs by
   shape, pattern, or label.
8. **No simulation value is ever expressed in pixels.** Games simulate in fixed
   logical units; only the render layer knows the device. A phone and a laptop
   must step the identical match, or cross-device play is impossible.
9. **Neither player may ever see more of the play area than the other.** In
   remote play both devices letterbox to a negotiated shared viewport. Surplus
   screen space holds chrome, never extra field of view.
10. **No game code branches on device type.** One build serves phone, tablet,
    laptop, and desktop; differences are handled by presentation and layout.
11. Nothing merges without tests, and nothing merges over the size budget.

## The two ideas the whole product rests on

**Seats.** Two people sit on opposite sides of one device. A touch belongs to the
seat it *started* in and keeps that ownership even when the finger crosses the
midline. In turn-based games the play area rotates 180° and recolours to the active
player so each person reads it upright. Both live in the engine, never in a game.

**One shell, many games.** Games supply a simulation and a win condition. Countdown,
HUD, pause, result, rematch, seat rotation, difficulty, and tournament reporting all
come from the SDK. A bespoke version of any of those inside a game package is a bug.

## Two presentations, one game

Every game renders two ways, and the SDK decides which — the game never does:

- **Shared-screen** — two seats on one device. The play area splits or rotates so
  both people can read it, exactly as the reference app does.
- **Single-seat** — one player alone on their own device, playing someone else
  remotely. The local seat owns the whole viewport, always upright, with
  full-device controls.

Rules, scoring, and simulation are byte-identical across both. Only placement,
rotation, and control mapping change.

## Fairness across devices

A thumb, a mouse, and a trackpad are not equivalent instruments, and a laptop
screen is not a phone screen. Three rules keep cross-device matches honest:
the shared logical viewport (rule 9), a common precision envelope so no input
family can aim finer than another, and reaction outcomes resolved on source
timestamps rather than packet arrival. A game that cannot be made fair
cross-device declares itself same-class-only rather than shipping unfair.

## Layout

```
apps/web            site shell, routing, landing, catalog, game host
packages/engine     loop, renderer, physics, input, seats, audio (synthesised, no files)
packages/game-sdk   the Game contract every game implements
packages/games/*    one folder per game, one chunk per game
packages/ui         shared components
docs/               research, design docs, ADRs
```

## Commands

`pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build` · `pnpm size`

The gate CI runs, in order — run all of it before claiming a change is done:

```
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

`format:check` is first because it is cheapest and it is the one that gets skipped:
CI failed on it for every commit until 20 August 2026 while local runs of the other
five passed, so the repository looked green and was not. `pnpm build` runs
`pnpm size` at the end, so the size budget is checked as part of it.

`pnpm e2e` runs Chromium and real WebKit. `pnpm e2e:all` adds Firefox and is what
the nightly workflow runs — the suite passes on Firefox and has since it was first
tried, so paying for a third engine on every push buys nothing. If a nightly ever
fails, move it back to every push.

**Four things run nightly rather than on every push, and the gate above does not
cover them.** The third browser engine; the deep seat-balance sample
(`pnpm balance:audit`, 250 seeds a game against the push gate's 50, plus an `easy`
and `hard` pass); and **the coverage gate** (`pnpm test:coverage`, 70% of lines,
functions, branches and statements over `packages/engine/src/**` and every game's
`rules.ts`). Coverage is not in `verify` because instrumentation makes the suite
several times slower and `verify` is already the job that put #2459 on the board —
so a change that drops coverage merges green and is caught the next morning. That
trade is written into `nightly.yml`, along with what to do if it ever costs more
than it saves.

Those thresholds were correct and **unexecuted from the day they were written**
until 29 August 2026: nothing under `.github/` contained the word "coverage", so
nothing could fail. Counting honestly, that makes it the **fifth** guard in this
repository found claiming something nothing ran — after `pnpm size` falling
through to the system `size(1)`, the asset-licence check this file said CI
enforced, CI itself being red on every commit behind another workflow's green
tick, and a balance harness whose headline promised a band it did not enforce.
The React hook rules, enforced by nothing at all, were the sixth.
`Canvas2DRenderer.setReducedMotion` — the whole of reduced motion for a board, and
the one part of it that reaches all forty-five flip-owning games — had no test of
any kind until 7 September 2026. That is the seventh. The **eighth** is the sentence
this file opened with until the same day: README.md line 4 and CLAUDE.md line 5 both
called the product "offline-capable" while the repository contained no service worker
of any kind, and the only file that mentioned one was
`apps/web/src/lib/privacy-claims.test.ts`, asserting that none exists — a check
written for the privacy page when #2513 corrected it for making exactly this claim,
and aimed for ever afterwards at the one file that had already stopped making it. So
the guard existed, ran on every push, and could not fail on the two files a reader
opens first. It is the first entry here that is a claim rather than a check, and it
is the same failure: something believed to be held that nothing held.
`apps/web/src/lib/offline-claims.test.ts` now reads every file that describes this
product — this one included — against whether a service worker exists, and fails
whichever of the two has drifted from the other. The **ninth** was found the same day
and is the same shape one file over: `app/layout.tsx` promised a match played "across
two devices" in the `description`, the `og:description` and the Twitter card — the
object all 223 exported pages inherit unless they set their own — while `PlayMode` is
`'friend' | 'bot'` and there is no pairing route, no signalling and no transport
behind it. The same batch that rewrote the landing page took that exact claim out of
the hero and out of one of three cards offering it as a way to play, corrected the
catalogue page's version of it, and left the `<meta>` tag underneath the landing page
saying it still, so the page contradicted itself in the only copy a search engine
reads. Beside it the description counted "a hundred and seven" games two lines under a
title that says 108. Neither could fail: the offline guard added in that same batch
reads `layout.tsx` on every push and looked straight past both, because a guard aimed
at one claim is not a guard on the file. `app/metadata-claims.test.ts` holds the count
against `CATALOGUE.length` and the mode wording against the `PlayMode` union, in both
directions. **The count lives here.** A file
that finds the next one adds it to this list rather than numbering it where it was
found, which is how two files came to claim a different sixth.

The **tenth** is the privacy page's list of what this product stores, and it is the first
one where the docstring naming the guard was written by the same hand as the guard. The page
opens "Six things, all kept in your browser's own storage" over a list of exactly six, and
the comment above it said the section "lists all six, and `privacy-claims.test.ts` fails the
moment a second writer appears, so the list cannot fall behind quietly". Both halves were
true and the pairing was wrong: the test held the *funnel* — every store goes through
`lib/local-store.ts`, so the keys are findable — and never the *list*, and a funnel a new
store passes through by construction is a guard that cannot notice one. The tournament
(#157) put a seventh key under `duelbox:` through that very module, `exportPlayerData` walks
all seven, and a pair who started a tournament and pressed Export downloaded a store the
page's exhaustive list did not mention — while the landing copy one click away advertised
exactly that persistence. The list is now counted against `PLAYER_DATA_KEYS`, in the number
the page states as well as in the bullets, so a key that travels in a player's export and is
not named on that page fails on every push.

Three smaller versions of the same shape were found beside it and are recorded here rather
than numbered, because none of them was ever false: `metadata-claims.test.ts`'s list of
cross-device phrasings did not contain the most prominent one this repository had used, so
pasting the exact sentence #102 deleted back into the hero left it silent — it is now held
against every deleted sentence verbatim; its self-check "on the real reader" compared two
hard-coded lists to each other and could not fail; and the count that "lives here" lived in
`app/layout.tsx` alone while four statements of it in `docs/` still said 107, two of them in
files the same batch had open. What generalises is not any of the three. It is that a guard
written beside the thing it guards is tested against the defect that prompted it and nothing
else, so **the sentence to distrust is the one in the docstring, not the one in the code**.

The **eleventh** is rule 5 above, and it is the first entry that was never a guard at all —
only a sentence. "No per-frame allocations in engine or game `update()`" had been believed
since it was written and had never once been measured, and it was false in four places.
`obbSegment` cost 125 bytes a call, `sweptCircleAabb` 94, `obbObb` 119, `aabbSegment` 95,
`aabbObb` 40, and `InputManager.beginStep` 16 bytes on every step of every match in the
collection, since every game reads its controls through it. None of it was visible to a
reader, and that is the part worth keeping: the source allocates nothing, and what allocates
is the *generated code* — a floating-point value crossing a call the optimiser has declined
to inline cannot travel as a raw double, so V8 materialises it on the heap first. Inlining
depends on the size of the calling function, which is why the same helper was free from one
caller and expensive from another, and why reading the file could not have found it.
`packages/engine/src/allocation.test.ts` measures all 44 paths on every push, and it proves
it can see a single 16-byte allocation before it asserts the absence of one — its first
16-byte control read 0.07 bytes and would have let everything below it pass. Its second half
is not closed: a game's `update()` is its own compilation unit with its own inlining budget,
a plausible two-puck one costs 64 bytes a step with every engine call inside it free, and no
game here measures itself. The benchmark's header says so in as many words rather than
implying a coverage it does not have. And the ceiling it enforces had to come down one
notch on contact with a second engine: **the identical source reads 0.000 B/call on V8 26 and
16.000 on V8 12.4**, which is the Node 22 CI runs, because whether a double crossing a call is
materialised is the optimiser's decision and the inlining budget is spent by the *caller*. The
proof is inside the benchmark: take the two `mix` calls out of the remote-pair case and the
`beginStep` pair beside them reads 0.000 on the engine that read 16 with them — a shorter
caller, not a changed callee. A benchmark whose own closure decides the verdict cannot assert
that verdict about the code, and `calibration` cannot save it, because it is one caller and
inlining is decided per caller. So a single boxed double is now **reported by name with the V8
version** and passes; two of them, or an object, an array, a closure or a string, still fails,
and none of those depends on a budget. Watched failing with an object planted in
`InputManager.beginStep`: 48 B/call, five cases red.

The **twelfth** was found while reviewing the batch that added the eleventh, and it is the
shortest story here: "CSS modules use the `var(--db-*)` tokens; no raw hex" was enforced by
nothing whatsoever. `tokens.test.ts` checked that the TS and CSS palettes agree and that
every `var()` names a token that exists — both real checks, neither of them this one — and a
stylesheet that simply declines to use `var()` walked past all four style suites in silence.
There is no stylelint in this repository. It had already drifted to thirteen `color: #fff`
declarations across eight stylesheets, every one of them `--db-paper` spelled a second way,
and the cost of that habit is on the record two rules above one of them: `page.module.css`
still carries a comment about a hand-copied `#a06f00` that shipped at 3.93:1, below AA,
because it was a colour nobody could reach the palette from. The thirteen are now
`var(--db-paper)` and `tokens.test.ts` scans every stylesheet but `tokens.css` itself. What
that guard has that the tenth entry's did not is a control on real input: the scanner is run
over `tokens.css`, which must come back with the whole palette. Watched, both halves — with
a hex planted in a module the check named it by file and line and ignored the `#178` beside
it, and with the comment stripper made greedy the check went green **with the plant still
there** while the control failed on its own, which is the pass that would otherwise have
been indistinguishable from a clean one. Reviewing it a day later found the guard narrower
than its own headline sentence twice over, which is this list's most reliable finding about
itself: it matched `#` and nothing else, so `rgb()`, `oklch()` and `background: white` were
all still free — one `rgb(0 0 0 / 45%)` was already live — and it read stylesheets, so
`app/layout.tsx`'s `themeColor: '#4b3beb'`, the brand written out a second time in a
TypeScript object, sat exactly where the `#a06f00` scar says a colour goes to hide. Both are
scanned now, and the entry stands as written: the sentence to distrust is the one in the
docstring.

The **thirteenth** is rule 11's, and it is the largest number in this list. `pnpm size` has
never known what the biggest download on this site is, because `scripts/check-size.mjs`
collects a file only if it ends `.js` — so the three budgets it defends are three facts
about scripts, and every note in `size-budget.json` says in as many words that CSS and
server-rendered markup are therefore free. Browsing the catalogue downloads something else.
`next/link` prefetches the route payload of every card that passes within 200px of the
viewport, and the grid has one card per game, so a visitor who scrolls it and presses
nothing fetches 108 `/play/<slug>/index.txt` payloads: **397 KB gzipped, more than twice the
182 KB ADR 0001 budgets for a whole first session.** The spec added in that same batch to
hold #185 — whose other half is "do not waste bytes on links nobody presses" — did not merely
fail to bound them, it *required* them, since its liveness control fails when fewer than
fifty-five are speculated. And "markup is free" was falsified by the same batch that repeated
it: the play route's `<noscript>` (#103) is 207 gzipped bytes of markup, in every one of
those 108 payloads, so a block only a scripting-off visitor ever reads costs 22.4 KB of
speculative download — more than everything that batch spent on both script budgets put
together, in the one file that had written down that it cost nothing. `speculatedBytes` now holds the total,
measured from the export by `check-size.mjs` and from a real browse by `e2e/prefetch.spec.ts`
so the two ends cannot drift. Watched failing on purpose, both ways: fifty-five bytes appended
to each payload in the built export failed the build with `browsing the catalogue speculates
390.7 KB of route payloads, over the 390.0 KB budget`, and with the payloads moved aside the
floor fired instead — `no route payloads at all — the export has stopped writing index.txt
files` — because a guard that reads zero must never report a saving.

The **fourteenth** is the clickjacking defence, and it is the plainest case in the list of a
guard that reads a file instead of running it. On a host that serves neither
`X-Frame-Options` nor CSP `frame-ancestors` — which is this one (#2481) — the inline
`FRAME_GUARD` is the *entire* defence. Two things watched it, and both watched the text:
`security/header-delivery.test.ts` asserts things about the source string, and
`check-headers.mjs` looks for its first forty-two characters after a literal `<script>` in
every exported page. Both of those pass on a guard that throws on its second line, and
**nothing in the repository had ever put a page in a frame.** Found while cutting the script
down for #2545, which is the useful part: it was rewritten to hide-and-flag, with the notice
moved into the layout and its styling into `globals.css`, and the entire rewrite could have
shipped a defence that did nothing with every existing check green. `e2e/frame-guard.spec.ts`
frames a real page in Chromium and WebKit now, and it was watched failing with the refusal
short-circuited. Two false starts are worth recording beside it, because each produced a red
that looked like a bug in the test rather than in the page: a DuelBox page cannot be the
framing page at all, since every one of them carries `default-src 'none'` with no `frame-src`;
and framing a loopback address from an `about:blank` document is refused by Private Network
Access before the server hears about it. In both the child never loaded, and what the report
said was "element not found".

The **fifteenth** is the shell budget itself, one line under the thirteenth, and it is the
largest single number in this list: **38.5 KB of the 164 KB described as "paid by every
visitor" was paid by nobody.** Next emits `polyfills-*.js` and references it as
`<script nomodule>`, which every engine that understands `<script type=module>` skips without
a request — that is every engine in tiers 1 and 2 of `docs/support-matrix.md`, and has been
since 2018. The only engines that fetch it are the ones that document explicitly does not
support. `check-size.mjs` counted it because `polyfillFiles` sits in the same manifest array
as `rootMainFiles`, which every route really does load, and because #2516 — the rewrite that
found 94.9 KB of pages-router surface in exactly this position, four lines below in the same
file — read past it. So 23% of the number rule 11 defends described a download nobody makes,
and it has been the number every batch for weeks has been squeezing itself against: the true
figure is 125.5 KB, which is also the answer to #4's "under 150 KB gzipped excluding any
game", met and unnoticed. The polyfills now have a bucket and a budget of their own, and the
`nomodule` claim is *read out of the export on every build* rather than believed — the moment
one of those scripts loses the attribute, everybody fetches it, it is shell again, and the
build says so. Watched failing both ways: with the attribute stripped from all 353 pages, and
with the file left in the manifest and unreferenced by any of them.

The **sixteenth** is the audio vocabulary, and it is the mildest shape in this list: not a guard
that was false, but two guards that **could only ever pass**. `sound-events.ts` declares fourteen
cues, eight of them `owner: 'game'`, and `sound-visuals.test.ts` walks all 108 game packages
looking for a game emitting one it should not, or one with no drawn counterpart. Both scans read
every file and find nothing, every time, for a reason neither of them states: **`GameContext`
carries no way to make a sound at all**, so not one of those eight is reachable by anybody.
`GameSoundBus` — the typed bus written so that a game raising the shell's countdown would be a
compile error — has no caller either. To their credit both tests say in their own comments that
they are vacuous today; what was missing is anything aimed at the moment they stop being. That is
now `the seam a game would emit through`: it reads `GameContext` and fails when it grows anything
that looks like audio, with the review in the failure message, because that is the commit where
#180's "playable with sound off" stops holding by construction and starts needing a per-game
pass. Watched failing with an `audio` field added to the context.

Five of the first six were found in a single day, by looking. The habit that finds
them is cheap: when a rule matters, **run the thing that is supposed to execute
it and watch it fail on purpose.** A guard nobody has seen fail is a guard
nobody has seen.

**CI was over its own budget** — 14 minutes against the 8 that issue #2459 names —
for two reasons, both now addressed: Playwright defaults to a **single worker on CI**,
and `smoke.spec.ts` was re-confirming the same server-rendered HTML on four engines.
Two workers and one engine for pure-content specs. Check a real run before trusting
the arithmetic.

## Definition of done

Tests pass · types clean · lint clean · under size budget · both seats verified ·
both presentations verified · correct from 320px to 4K in both orientations ·
cross-device match verified against the harness · works on iOS Safari and Chrome
Android · keyboard accessible · reduced-motion respected · playable in greyscale ·
assets licensed
