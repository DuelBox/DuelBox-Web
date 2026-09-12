# Typefaces

The site is drawn in five faces served from its own origin, declared in
`apps/web/src/styles/fonts.css` and listed by the three `--db-font-*` stacks in
`apps/web/src/styles/tokens.css`. Three are the Latin faces the site is written in; two are
the script faces #224 added so that the launch locales of #221 and #222 — Hindi in
Devanagari and Arabic in Arabic script — reach a face that has their glyphs before they
reach whatever the device has. Indonesian, Portuguese and Spanish are Latin and were already
covered by the `latin` and `latin-ext` subsets.

| Family | File | Subset | Bytes | Weight axis | In the stacks as |
|---|---|---|---|---|---|
| Fredoka | `fredoka-latin.woff2` | latin | 29,704 | 500–700 | display, first |
| Fredoka | `fredoka-latin-ext.woff2` | latin-ext | 4,564 | 500–700 | display, first |
| Plus Jakarta Sans | `plus-jakarta-sans-latin.woff2` | latin | 27,272 | 400–700 | body, first |
| Plus Jakarta Sans | `plus-jakarta-sans-latin-ext.woff2` | latin-ext | 21,688 | 400–700 | body, first |
| JetBrains Mono | `jetbrains-mono-latin.woff2` | latin | 31,340 | 500–700 | mono, first |
| JetBrains Mono | `jetbrains-mono-latin-ext.woff2` | latin-ext | 11,596 | 500–700 | mono, first |
| Noto Sans Devanagari | `noto-sans-devanagari-devanagari.woff2` | devanagari | 121,188 | 400–700 | all three, second |
| Noto Sans Arabic | `noto-sans-arabic-arabic.woff2` | arabic | 166,152 | 400–700 | all three, third |

Beside those eight there are three more `@font-face` blocks that ship no file at all — the
metric-matched stand-ins of #187, `src: local(…)` and four descriptors, listed second in each
stack. They have a section of their own below.

Every file is one of Google's own subsetted variable builds, fetched from the Google Fonts
CSS2 API with the weight axis clipped to the range the site sets, and redistributed
unmodified under the OFL. The licence text and the five copyright lines are in
`apps/web/src/styles/fonts/OFL.txt`; the per-file entries rule 3 requires are in
`apps/web/assets.license.json`.

## Why the script faces are range-gated rather than merged

Every `@font-face` carries a `unicode-range`, and a browser fetches a face only when a run
of text needs a code point inside it. The three `latin-ext` faces have always relied on that:
they sit in the build unfetched until a diacritic in a player's name needs one. The two
script faces are the same mechanism with more at stake, because together they are 287,340
bytes — more than the three base Latin faces put together — and every page this site exports
today is English. Neither range touches printable ASCII, so an English page never asks for
either file, and a Hindi or Arabic page asks for exactly the one it needs.

That is measured on every build and every push, not believed:

- `scripts/check-size.mjs` reads each `@font-face`'s range out of the *built* stylesheet — the
  one the browser reads — and classifies a face as range-gated when its range excludes printable
  ASCII (U+0020–U+007E). Those faces are reported beside the session totals rather than in
  them. Until #224 the rule was the literal filename suffix `-latin-ext`; a rule that read the
  name would have billed 287 KB of script faces to every English visitor's first session, or,
  had the files been renamed to dodge it, hidden a base face. The line now reads
  `5 range-gated face(s) fetched only for a glyph outside basic Latin (fredoka-latin-ext,
  jetbrains-mono-latin-ext, noto-sans-arabic-arabic, noto-sans-devanagari-devanagari,
  plus-jakarta-sans-latin-ext), 317.6 KB not counted`.
- `scripts/check-size.mjs` also scans the text of every exported document and every route
  payload for a code point that lies inside a range-gated face's range and outside every base
  face's, and fails the build on one. Neither script range is disjoint from the Latin ones,
  and five of the code points inside them are outside every primary `latin` range — U+20A8,
  U+20B9, U+20F0 and U+25CC in the Devanagari block, U+2E41 in the Arabic one — so a single
  rupee sign or dotted circle in an English page's markup is an unconditional fetch of a
  range-gated file.
  None today, across 353 documents and 108 payloads. Watched failing with a ₹ planted in one
  built page; the header comment in `fonts.css` carries the ranges and the half of the
  question a declared range cannot settle.
- `e2e/fonts.spec.ts` opens `/` in a real browser with request logging and fails if either
  script file is requested; then appends one word of Hindi and one of Arabic, lays them out,
  and fails if each face is *not* then requested from this origin and drawn — width in the
  stack against width in the stack without the face, the same measurement that caught #2469.
  It is one document of the 353, which is why the scan above exists.
- `apps/web/src/styles/font-coverage.test.ts` holds the declared ranges of every stack against
  the launch locales' text; see the limitation below.

What the English visitor paid for this: the fonts line is unchanged at 86.2 KB — the same
three base faces as before, because neither script file is on it — the shell is unchanged at
128.2 KB, and **one built stylesheet grew from 3,266 to 3,619 bytes gzipped, +353 bytes at
level 9.** One, not two: both the two `@font-face` blocks and the three `--db-font-*` stacks
compile into the same global sheet, so the whole cost of the change lands in a single file.
Measured by stripping it back out of that built file rather than by differencing two builds —
drop the two blocks and it gzips to 3,293; drop the extra families from the three stacks as
well and it gzips to 3,266 — which puts 326 bytes on the blocks, 198 of those being the tail
of Google's Arabic range (the Arabic Mathematical Alphabetic Symbols, listed as some forty
single code points), and 27 bytes on the stacks. An earlier version of this paragraph said
341 bytes and attributed 15 of them to the stacks; that 15 was an unrelated CSS-module rule
reorder in the same build, which a rebuild does not reproduce, and the stacks are in the file
the blocks are in rather than in one of their own. That is the whole of the move on the `css`
term of the session lines, 11.4 KB to 11.7 KB, which took the first-session line from
317.0 KB to 317.4 KB; it is the cost of declaring the faces in the one stylesheet every page
links rather than in a per-locale one, and there is no per-locale stylesheet to put them in
until there is a per-locale page. The range was kept verbatim rather than trimmed to save 198
bytes, for the reason in the section after next.

## The metric-matched stand-ins, and what they are actually worth (#187)

`font-display: swap` means text is never invisible: the browser draws it in whatever the stack
reaches next and redraws it when the real file lands. #187 is the price of that — "a
late-swapping display face reflows the hero exactly when the visitor is deciding whether to
stay" — and the answer is a fallback that is already the right size.

Each Latin family has a companion face in `fonts.css` whose `src` is `local()`: no `url()`, so
no file, no request and no byte on the wire, naming the face the stack would have fallen
through to anyway, with four descriptors that bend it onto the primary's metrics.

| Stand-in | Asks the device for | size-adjust | ascent | descent | line-gap |
|---|---|---|---|---|---|
| Fredoka Fallback | Arial, then Helvetica | 101.50% | 95.96% | 23.25% | 0% |
| Plus Jakarta Sans Fallback | Arial, then Helvetica | 104.08% | 99.73% | 21.33% | 0% |
| JetBrains Mono Fallback | Courier New, then Menlo | 99.98% | 102.02% | 30.00% | 0% |

All three carry the same `unicode-range`, the union of the `latin` and `latin-ext` ranges
their primaries declare.

Each also carries a `unicode-range`: the union of the two ranges its own primary declares,
which is the same union for all three because all three declare Google's same `latin` and
`latin-ext`. That is not tidiness, and the section after next is what it cost to learn. On
Android, which has none of these four font names, `local()` matches nothing, the family
resolves to nothing, and the stack carries on exactly as it did before.

`tokens.css` lists each one immediately after its primary, ahead of the two script faces and
the generics.

The formula is Capsize's, which is what `next/font`'s `adjustFontFallback` computes:
`size-adjust` is the ratio of the two faces' mean advance, and each vertical override is the
primary's own metric over its upm divided by `size-adjust` (divided, because the browser
applies `size-adjust` first, so an override is a fraction of the adjusted em). The raw inputs,
the fontkit reading that produced them and the four things about the table that decided the
numbers are in `fonts.css`'s header; two of them are worth repeating here.

**OS/2 `xAvgCharWidth` cannot be used.** Arial's is 0.4414 em by the legacy weighted-lowercase
formula and Fredoka's is 0.532 em by the modern mean-of-all-advances formula. The ratio of
those two is 1.205 — a `size-adjust` of 120%, every heading a fifth too large. A file does not
say which formula it used, so every average here is computed from the advances with the same
code over the same characters.

**The characters averaged are the ones the site renders, weighted by how often it renders
them — not the 52 letters**, and that is the correction that changed all three numbers. A
space is 16.5% of the printable ASCII in 24,098 characters of this site's own rendered text,
and the faces disagree about the space far more than about any letter: Arial 0.2778 em, Plus
Jakarta Sans 0.1700 em, Fredoka 0.2412 em. A letters-only mean is blind to one character in
six.

### Why each one carries a range, which is the expensive thing this change learned

The stand-ins were written without a `unicode-range` first. A `local()` face has no cmap this
repository can read, so claiming nothing looked like the honest default, and the note in
`tokens.css` said in as many words that they took nothing from the script faces because
"neither Arial nor Courier New has a Devanagari or Arabic glyph to take."

That sentence was wrong, and `e2e/fonts.spec.ts` — a guard written for #224, about a different
question — failed on all four browser projects with `Noto Sans Arabic was not requested for
العربية`. **Arial and Courier New both have Arabic**, and Hebrew, Greek and Cyrillic besides;
checked with fontkit against the files on this machine rather than assumed, and Devanagari is
genuinely absent from both, which is why only the Arabic half went red. A face with no
`unicode-range` claims every code point, so `'Plus Jakarta Sans Fallback'` sat between Plus
Jakarta Sans and Noto Sans Arabic in the body stack and drew Arabic out of the device's Arial.
Noto Sans Arabic was never fetched at all. That is #224 undone — one Arabic face everywhere,
replaced by whatever the device happens to have — by a face added to stop a reflow.

So the rule the range encodes: **a stand-in claims what the face it stands in for claims, and
not one code point more.** `font-coverage.test.ts` derives the union from the primary's own
`@font-face` blocks and fails if the two ever differ, in either direction, so neither side can
be edited without the other; a `local()` face with no range at all is refused by the parse.
Both were watched failing, with the Arabic block added to one stand-in's range and with a
range deleted.

### What it is worth, and where it is worth less than nothing

Measured, not assumed: the woff2 files held back four seconds, the page left to hydrate and
settle in the stand-in, and `document.documentElement.scrollHeight` read before and after the
real faces land. Five routes at four viewport widths, twenty pairs, stable across repeats.
Total absolute movement:

| | total movement over the twenty pairs |
|---|---|
| No stand-in at all — the site before #187 | 507 px |
| Stand-in, descriptors from the 52-letter mean | 589 px |
| Stand-in, descriptors from the frequency-weighted mean | **412 px** |

Nineteen percent better than nothing — and the letters-only mean, which is the textbook one,
is **sixteen percent worse than nothing**. Against no stand-in the shipped set is better on
nine pairs, identical on eight and worse on three: `/` at 320px (60 px against 0), `/games/`
at 390px (80 px against 0) and `/settings/` at 320px (26 px against 0).

Those three are the mechanism rather than a defect, and they mean **#187's "no visible layout
shift on font swap" is not met and cannot be met this way.** A line wraps or it does not — it
is a threshold on one line's width, and `size-adjust` matches a mean. With the mean exactly
right an individual line is still up to a percent out either way, so a paragraph whose last
word sits near the edge wraps one way in the stand-in and the other in the real face, at a
cost of a whole line each time. Only a fallback carrying the primary's own per-glyph advances
would remove that, and a face with the primary's advances is the primary.

The three vertical overrides are **inert on this site today** and are set anyway. Every block
that holds text sets an explicit `line-height` — `globals.css` sets 1.55 on `body`, the
modules set their own — so a line box is the stylesheet's number and not the face's, and every
pixel measured above is a paragraph rewrapping rather than a line box changing height. They
are correct, they cost about forty bytes gzipped, and the first element given
`line-height: normal` is the one that needs them.

Two guards hold this. `apps/web/src/styles/font-coverage.test.ts` parses the `local()` faces
into a list of their own that contributes **no coverage** — a `local()` face borrows the
device's glyphs, which is exactly what this repository cannot see, the same unknown as
`system-ui`; counting a face with no `unicode-range` as covering everything would have made
the Bengali and Thai control come back empty from every stack and gutted the guard — and holds
that one exists per primary, that all four descriptors are present and are percentages, that
none names a file or takes a licence entry, and that each sits second in its stack ahead of
the generics. `e2e/font-swap.spec.ts` holds the line box exactly, the width loosely and for
the reason above, and re-runs four of the twenty pairs — three the stand-ins win and the one
they lose worst. Both were watched failing: the unit guard with a descriptor deleted, a
stand-in moved behind the script faces, one given a `url()`, one given a wider range and one
given no range; the e2e with every descriptor stripped out of the built stylesheet, which
failed both of its tests.

The cost on the wire is **+183 bytes gzipped**, all of it in the one global stylesheet every
page links — 165 bytes on the three blocks and 18 on the three stacks, measured by stripping
each back out of the built file at level 9, the same way #224's numbers were taken, rather
than by differencing two builds (the speculated line alone moves a few hundred bytes between
builds of identical source, which is what `size-budget.json`'s headroom note is about). The
fonts line is unchanged at 86.2 KB, because there is no new file; the first session measures
326,540 bytes against the 333,824 allowed, and nothing in `size-budget.json` was raised.

### Preloading the display face: measured, and not done

#187's second action item asks for a `<link rel="preload">` on the display face. It is not
here, and this is the measurement that decided it rather than an omission.

**Cost**, measured by injecting the three tags into all 353 documents of a built export and
re-running `check-size.mjs` against the same export: **+100 gzipped bytes on the landing
document** (323,947 → 324,047 on the first-session line), the same on the catalogue, and no
change at all to the 506,032-byte speculated line, because tags injected after the build never
reach the route payloads.

**Benefit**, measured in Chromium with the document served identically in both arms and only
the tags differing, under CDP network emulation, median of three:

| Link | Real face arrives | All shell JS arrives |
|---|---|---|
| 4G — 40 ms, 10 Mbps | 73 ms earlier | 48 ms later |
| Fast 3G — 150 ms, 1.6 Mbps | 383 ms earlier | 83 ms later |
| Slow 3G — 300 ms, 0.4 Mbps | 1080 ms earlier | 1 ms later |

So a preload is a reordering, not a saving: on a bandwidth-limited link 86 KB of faces jump
the queue ahead of 129 KB of shell script, and the total is the same.

Not done, for four reasons in that order of weight. It does not reduce the reflow #187 asks
about — the swap still happens and still rewraps whatever it rewraps, only sooner, and the
stand-ins have already made what is on screen before it the right size, so what a preload buys
is a cosmetic difference seen for a shorter time. It delays the shell on exactly the links
where it helps, and `size-budget.json` calls the shell "the number worth defending". The URLs
are webpack-hashed, so it needs a post-build injection step in `package.json`'s build chain and
a new failure mode — a stale hash preloads a 404 that nothing would notice. And the 100 bytes
are paid by every visitor on every document, while the benefit is a first visit only.

What would change the decision: wanting the real face at first paint, which is a
`font-display` question before it is a preload one; or the shell leaving the critical path.

## What the precache does with them, and the limitation that implies

`scripts/emit-service-worker.mjs` decides what a first visit installs, and it applies the
same rule, function for function: a face whose range excludes printable ASCII is left out of
the precache list and left to the worker's runtime path, which saves any same-origin asset the
first time a page asks for it. `check-size.mjs` reads the emitted worker and fails the build
if the two scripts disagree in either direction — a range-gated face in the list, or a base
face missing from it.

Applying one rule to the whole stylesheet changed the `latin-ext` faces as well. They were in
the precache until #224, 37 KB of every first install that an English page never draws; they
are now on the runtime path with the script faces. On the build that added the two script
faces the precache went from 52 URLs and 411 KB over the wire to 49 URLs and 375 KB, and the
build's summary line reads `left to the runtime path: 5 range-gated face(s), 318 KB`.

The limitation is worth stating plainly. A face on the runtime path is on the device only
after a page that draws a glyph in its range has been drawn while connected, and the runtime
cache is renamed on every deploy. So a Hindi or Arabic page opened on a device that has lost
its connection is drawn in the system's Devanagari or Arabic face — or in boxes, on a device
with none — unless a page in that script was drawn while connected since the last deploy. The
same is true of a player's name with a diacritic in it and the `latin-ext` faces, which was
already true of any game this device had not opened (#196). The alternative, precaching the
faces, would install 318 KB of type nobody on an English page uses on every first visit, and
the day the site has Hindi or Arabic *pages*, the right answer is for those pages' own
documents to be what pulls their face onto the device, not for every visitor to carry it.

## The limitation of the coverage guard

`font-coverage.test.ts` checks the **declared** `unicode-range` of each face, not the glyphs
inside the woff2. There is no font parser in this repository. A range is a promise the
stylesheet makes about a file, and the measurement that shows the two are not the same thing
is in `fonts.css`: Baloo Bhaijaan 2's `arabic` subset from the same API is 38,588 bytes, Noto
Sans Arabic's is 166,152, and Google declares the identical range for both, because its ranges
are per subset and not per face. A range edited by hand to claim a block the file does not
carry would pass the unit guard and draw boxes in a browser.

Two things make the declared range the right thing to hold regardless. It is the range the
browser trusts — a browser never opens a font file to decide whether to fetch it, it believes
the stylesheet, so the range in `fonts.css` is what decides which face a character reaches.
And the ranges here are Google's own for the subset each file *is*, copied verbatim and
recorded with the request that produced them, which is why the Arabic tail was not trimmed:
a range this repository edited is a range this repository would have to vouch for glyph by
glyph, and it cannot. `e2e/fonts.spec.ts` is the half that watches a real browser draw the
text in the face, which is what would catch a range that lied about the file behind it.

## Adding a locale's script

1. **Find the subset.** Request the CSS2 API for the family with the weight axis clipped to
   what the stacks set, with a desktop Chrome User-Agent so the answer is woff2 with a
   `unicode-range` per subset (the API answers TTF with no ranges to a client it does not
   recognise):

   ```
   curl -sS -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' \
     'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400..700&display=swap'
   ```

   In `zsh`, quote the URL or write `${f}:wght` — `$f:wght` is a history modifier, and the API
   answers 400 to what it produces. Take only the block for the script's subset. The Latin
   subsets of a script face are never reached behind the primary faces.

2. **Download the file the block names** into `apps/web/src/styles/fonts/`, named
   `<family>-<subset>.woff2`, and record its byte count and sha256. The gstatic URL is
   versioned and content-addressed, so the bytes are reproducible for as long as Google serves
   that version; the hash is what lets a reviewer check that the file in the tree is the file
   the URL names.

3. **Declare it** in `fonts.css`: the family, the weight range, `font-display: swap` like every
   face there, a relative `src` (webpack rewrites it; an absolute path 404s under `basePath`),
   and the API's `unicode-range` verbatim. Record the request URL, the User-Agent, the date,
   the file URL and the hash in the header comment.

4. **List it** after the primary face in each of the three `--db-font-*` stacks in
   `tokens.css`, before any system family. The unit guard fails if a script face is listed
   after `system-ui`, because the system's face would then win and the file would never be
   fetched.

5. **License it**: an entry in `assets.license.json` with the file, family, subset, axes,
   source (the specimen page, the upstream repository, and the API request), `OFL-1.1`, the
   licence URL and the author as the font's own OFL names them; and the copyright line from the
   font's `OFL.txt` added to `fonts/OFL.txt`, after checking the licence text itself is the same
   (compare the two files; the five here differ only in the URL on one line).

6. **Add the locale's text** to the fixture in `font-coverage.test.ts` — the native name and one
   sentence with the punctuation the language uses — and run `pnpm test`. Then `pnpm build` and
   read the two lines quoted above: the new face must appear in `check-size`'s range-gated list
   and in the worker's "left to the runtime path" line, and the fonts figure must not move.
   Extend `e2e/fonts.spec.ts`'s `SCRIPT_FACES` with the family, its file and a word in the script.

## Why Noto, and the rounded faces that were measured

Fredoka is a rounded display face, and the brief for #224 asked whether a rounded OFL face
could carry the second scripts in its voice. The candidates were Baloo 2 (Devanagari) and Baloo
Bhaijaan 2 (Arabic), both by Ek Type under the OFL, sized through the same API on the same day
by the `Content-Length` of the file each subset block names:

| Face | Subset | Bytes | Against Noto |
|---|---|---|---|
| Baloo 2 | devanagari | 115,276 | Noto Sans Devanagari 121,188 — 5% smaller |
| Baloo Bhaijaan 2 | arabic | 38,588 | Noto Sans Arabic 166,152 — under a quarter |

Noto was kept for both, for two reasons that are not about bytes. One face per script serves
all three stacks, so a reader of that script fetches one file; a rounded face in the display
stack alone would put a second Arabic file on the wire for the same reader, and 38 KB on top
of 166 is more, not less. And the body stack is where a Hindi or Arabic reader spends the
match: a heavy rounded display face drawing body copy is the wrong voice for it, which is the
same reason Fredoka is not the Latin body face. Baloo Bhaijaan 2's size is also glyphs it does
not carry — the identical declared range over a file a quarter the size — and without a font
parser this repository cannot say which. If a display-only rounded face is ever wanted for
Arabic headings, Baloo Bhaijaan 2 is the measured candidate, and the coverage guard would need
to learn a stack whose script faces differ from the other stacks'.

## Provenance of the two script files

Fetched 2026-09-12 from the CSS2 API with the User-Agent above, `wght@400..700`,
`display=swap`; the `devanagari` and `arabic` blocks taken and their ranges copied verbatim.

| File | From | sha256 |
|---|---|---|
| `noto-sans-devanagari-devanagari.woff2` | `https://fonts.gstatic.com/s/notosansdevanagari/v30/TuG7UUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHN5TV_5Kl4-GIB.woff2` | `12223f2beeb4752c6fe7662550978ee22be4d56e49a8f937c324b015ac5ef77a` |
| `noto-sans-arabic-arabic.woff2` | `https://fonts.gstatic.com/s/notosansarabic/v33/nwpCtLGrOAZMl5nJ_wfgRg3DrWFZWsnVBJ_sS6tlqHHFlj4wv4rqxzLIhjE.woff2` | `69cdf0bf005fdc9cc13fb5a8581697eb9ba8f761aeaf255fc717d14c62c38891` |

Re-fetched from those URLs on the same day and compared byte for byte with the files in the
tree: identical. The API's answer to the request above, on that day, listed `devanagari`,
`latin-ext` and `latin` blocks for the first family and `arabic`, `math`, `symbols`,
`latin-ext` and `latin` for the second; only the first block of each was taken.
