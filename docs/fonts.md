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
- `e2e/fonts.spec.ts` opens `/` in a real browser with request logging and fails if either
  script file is requested; then appends one word of Hindi and one of Arabic, lays them out,
  and fails if each face is *not* then requested from this origin and drawn — width in the
  stack against width in the stack without the face, the same measurement that caught #2469.
- `apps/web/src/styles/font-coverage.test.ts` holds the declared ranges of every stack against
  the launch locales' text; see the limitation below.

What the English visitor paid for this, measured on the build that added the faces against
the build before it: the fonts line is unchanged at 86.2 KB, the shell is unchanged at
128.2 KB, and the stylesheet every page links grew by 341 bytes gzipped — 326 for the two
`@font-face` blocks, 198 of which is the tail of Google's Arabic range (the Arabic
Mathematical Alphabetic Symbols, listed as some forty single code points), and 15 for the
longer stacks. That is the whole of the move on the `css` term of the session lines, 11.4 KB
to 11.8 KB, which took the first-session line from 317.0 KB to 317.4 KB; it is the cost of
declaring the faces in the one stylesheet every page links rather than in a per-locale one,
and there is no per-locale stylesheet to put them in until there is a per-locale page. The
range was kept verbatim rather than trimmed to save 198 bytes, for the reason in the section
after next.

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
