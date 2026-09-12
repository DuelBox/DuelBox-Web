# Right-to-left layout

Arabic is a launch locale, and a shell that does not turn round for it is not
localised (#222). This records what mirrors, what never does and why, how a
stylesheet says which, and what still has to be checked by a person reading a
real Arabic build (#221).

The single sentence: **the shell follows the sentence; the play surface follows
the device.**

## What mirrors

Everything a visitor reads: the header, the navigation, the footer, the
catalogue and its cards, the game pages, the settings page, the prose pages, the
pre-match lobby with its mode buttons, the tournament track, and every panel the
shell draws outside a match. All of it is written in logical properties —
`margin-inline-start`, `inset-inline-end`, `padding-inline`, `text-align: start`,
`border-inline-start-width`, `border-start-start-radius` — so a browser told
`<html dir="rtl">` lays it out from the right without a second stylesheet.

Three things CSS cannot say logically have a token each in `styles/tokens.css`:

| Token                    | `:root`               | `[dir='rtl']`         | For                                                                          |
| ------------------------ | --------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `--db-safe-inline-start` | `var(--db-safe-left)` | `var(--db-safe-right)`| chrome at the _start_ of a line that must also clear the cutout (skip link)  |
| `--db-safe-inline-end`   | `var(--db-safe-right)`| `var(--db-safe-left)` | chrome at the _end_ of a line (exit control, trace panel)                    |
| `--db-inline-sign`       | `1`                   | `-1`                  | a `translateX` that travels along the line (the settings switch's thumb)     |

A transform that moves something towards the end of the line is written
`translateX(calc(1rem * var(--db-inline-sign)))`; CSS has logical insets and
margins and no logical translate, and the token is what turns the travel round.

## What never mirrors, and why

**The play surface.** Rule 9 says neither player may ever see more of the play
area than the other. A board mirrored on one device is a different play area
from the un-mirrored one on the other device the moment two devices play the
same match, and on one device the seats make the same argument: player one's
zone is a side of the phone, not a side of a sentence, and the two people
holding it have not moved because the menus changed language. The engine draws
control zones, seat colours and the turn rotation in device space, and the two
scoreboards, the far seat's turned copy and the overlays drawn over the board
are the same physical object under an Arabic shell as under an English one.

The issue asks to "let each game declare whether its canvas mirrors". The answer
is that none may, and it is a decision rather than a manifest field on purpose: a
field no game could legitimately set is a guard that enforces nothing, and this
repository keeps a count of those (CLAUDE.md). There is no `mirrors` field, no
per-game branch, and nothing for a game to opt into.

How the surface is pinned, in `PlaySurface.module.css` and `PlaySurface.tsx`:

- `.surface { direction: ltr }` for the box model, so the landscape flex row and
  every logical property inside the island resolve as left-to-right;
- `dir="ltr"` on the same element for the bidi algorithm, so the text inside
  agrees with the boxes;
- the three tokens above set back to their `:root` values under `[dir='ltr']` in
  `tokens.css`, which the attribute selects. Custom properties inherit from
  `<html>`, where `[dir='rtl']` has swapped them, so without this a control
  inside the island would sit at the right edge (`inset-inline-end` under `ltr`)
  while clearing the _left_ cutout (`--db-safe-inline-end` from the shell's
  `rtl`). `direction.test.ts` holds the `[dir='ltr']` block to the `[dir='rtl']`
  one, key for key, so a fourth token cannot be turned round there and forgotten
  here. (In `tokens.css` rather than on `.surface` because `safe-area.test.ts`
  reads every `var(--db-safe-*)` in that module against a `max(` on its line.)

Inside the island a logical property resolves as `ltr`, so the trace panel's
`inset-inline-end` is the right edge and would follow the shell if the panel were
ever drawn outside the surface, which is what debug chrome should do. Two
declarations inside the island are deliberately physical because the physical
word is the honest one there: `text-align: right` on seat two's scoreboard in
`MatchHud.module.css`, and `right:` on the exit control, which holds the corner
diagonally opposite the pause button in every locale. In both, `end` would
resolve to the same edge and say the wrong thing about why.

**Symmetric safe-area gutters.** `padding-left: max(…, var(--db-safe-left))`
beside `padding-right: max(…, var(--db-safe-right))` is about the notch, which is
on a side of the phone. Both halves stay physical, and both carry the marker
below. A _lone_ `right: … var(--db-safe-right)` is chrome at the end of a line
and wants the logical token instead.

## The marker

A physical declaration stays physical by carrying, on its own line, a comment of
exactly this shape:

```css
padding-left: max(var(--db-space-5), var(--db-safe-left)); /* physical: side of the device */
```

`styles/direction.test.ts` scans every stylesheet under `apps/web/src` and the
inline `style={{…}}` objects in every component, and fails with `file:line` on
any physical directional property — `left`, `margin-right`,
`border-top-left-radius`, `text-align: right`, `float: left`, a four-value
shorthand whose sides differ, a `border-radius` whose left corners differ from
its right, a `translateX` without the sign token, a `direction` — that has no
marker. The reason is part of the syntax (`/* physical: */` with nothing after
the colon is not a marker), a marker on a line with nothing physical to excuse
fails too, and the count of markers in the tree is held to a number, so adding
one is a decision that shows up in a diff of the test. The marker is kept short
(`/* physical: side of the device */`) because Prettier wraps a declaration whose
line runs past 100 columns, and `safe-area.test.ts` reads each `var(--db-safe-*)`
against the `max(` on its own line; the reasons are here. Twenty-one today:

| Where                                          | Count | Reason                                                                 |
| ---------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| `app/globals.css` `.db-wrap` (two breakpoints) | 4     | page gutter, symmetric safe-area pair                                  |
| `app/globals.css` `.db-net-bar`                | 2     | offline bar, symmetric safe-area pair                                  |
| `components/SiteHeader.module.css`             | 2     | header, symmetric safe-area pair                                       |
| `components/PlaySurface.module.css`            | 3     | surface gutters (pair) and `direction: ltr` (rule 9)                   |
| `components/MatchOverlay.module.css`           | 2     | pause and result panels, symmetric safe-area pair                      |
| `components/HandoffOverlay.module.css`         | 2     | hand-off blackout, symmetric safe-area pair                            |
| `components/ExitControl.module.css`            | 3     | exit confirmation (pair), and the control's own `right:` in the island |
| `components/GameErrorBoundary.module.css`      | 2     | recovery screen, symmetric safe-area pair                              |
| `components/MatchHud.module.css`               | 1     | seat two's `text-align: right`                                         |

A second `dir` attribute anywhere in `apps/web/src` also fails the test: the play
surface is the only island, and another wants its reason written here first.

## Icons

`lib/icons.ts` has `MIRRORED_ICONS`, `Icon.tsx` puts the global class `db-mirror`
on exactly those names, and `globals.css` scales that class by the sign token —
`transform: scaleX(var(--db-inline-sign))` — rather than under a `[dir='rtl']`
ancestor selector, because an ancestor selector cannot see the island: `<html
dir="rtl">` matches from outside it, and an arrow drawn inside a match would flip
while everything around it stayed. The token is -1 in the shell and 1 in the
island, which is exactly the question the glyph is asking.

| Icon          | Mirrors | Why                                                        |
| ------------- | ------- | ---------------------------------------------------------- |
| `back`        | yes     | points towards the start of the line, which is the right   |
| `forward`     | yes     | points towards the end of the line                         |
| `play`        | no      | a media convention; mirrored it is the rewind glyph        |
| `pause`       | no      | symmetric                                                  |
| `sound-on`    | no      | a speaker faces the same way in every script               |
| `sound-off`   | no      | as above, with a stroke                                    |
| `settings`    | no      | a cog has no direction                                     |
| `close`       | no      | symmetric                                                  |
| `star`        | no      | symmetric                                                  |
| `star-filled` | no      | symmetric                                                  |
| `trophy`      | no      | symmetric                                                  |
| `refresh`     | no      | clockwise means clockwise; turned round it says anticlockwise |
| `check`       | no      | a tick is one stroke, the same in every script             |
| `info`        | no      | symmetric                                                  |

`lib/icons.test.ts` holds the set to `ICONS` in both directions and calls
`iconClassName` for every name; the component is held to using it by reading the
one line of `Icon.tsx`, because Vitest cannot import a `.tsx` under this
repository's `jsx: preserve` (the test says so rather than claiming a render).
`e2e/rtl.spec.ts` measures the rule in a browser: `matrix(-1, 0, 0, 1, 0, 0)` on
a `db-mirror` element in the shell, `matrix(1, 0, 0, 1, 0, 0)` on one inside the
island, `none` on a glyph without the class. No route renders an `<Icon>` today
(#74 left the sprite unmounted), so the spec synthesises the element; the day a
route draws one, locate it there instead.

## Text direction

- **Player names** are typed by the people they belong to (#161) and can be in
  any script. The HUD's `.name` carries `unicode-bidi: plaintext`, which is
  `dir="auto"` spelled in CSS: the box takes its base direction from the name's
  first strong character, so an Arabic name in an English shell — or the reverse —
  keeps its letters in order and its ellipsis at its own end. The stylesheet is
  the file #222 owns; the `<span>` is unchanged.
- **Names inside a sentence** — `{p1} 2 — 1 {p2}` on the round and match
  panels, the tournament track's score line, the "X wins" line — are left to the
  bidi algorithm today, which handles all-Latin and all-Arabic runs correctly. The
  right fix is `<bdi>` around each name in `MatchOverlay.tsx`,
  `TournamentTrack.tsx` and `MatchHud.tsx`, and `dir="auto"` on the two name
  inputs in `SettingsPanel.tsx`; those files are outside this batch's territory and
  are listed as open work below.
- **Numbers.** Scores, the clock and the countdown are ASCII digits from
  `String(n)` and `formatClock`, and nothing calls `toLocaleString` on them, so no
  locale will ever shape them into Arabic-Indic digits — which is what is wanted:
  a score is read across the device by two people who may not share a script. A
  bare number is directionally neutral and renders left-to-right in either base
  direction, so the score cells need no `unicode-bidi: isolate`; inside the play
  surface they are under the `ltr` island anyway.

## How `dir` gets set

The locale registry (`lib/i18n`, built in parallel) stamps both `lang` and `dir`
on `<html>` in `applyLocale`, from the locale's own record. Nothing here reads
the browser's language setting — the privacy policy says the product never does,
and that stays true. Until the registry lands, `e2e/rtl.spec.ts` gives every page the same
attribute from an init script before the site's own script runs, which is the
same DOM and a smaller claim: it proves the shell mirrors when told to. The spec
carries the exact line to switch to (`?lang=ar-XB`) when the registry arrives.

## Manual check list for a real Arabic locale (#221)

None of the guards above have seen an Arabic string. When the translation lands,
a person reading Arabic should open the build on a phone and a laptop and check:

1. The header: brand at the right, "Games" and "How to play" to its left, the
   tools at the far left where the width allows them.
2. The catalogue: cards read from the right; the favourite star sits at the
   inline start of each tile; the sort control's triangle sits at the end of the
   select, over its end padding.
3. Settings: the switches' thumbs travel _left_ when turned on; the select
   arrow sits at the end; the two name fields accept an Arabic name and show it
   back the same way; the number values sit at the end of their rows.
4. A match: the lobby mirrors; the moment a match starts the surface does not —
   seat one's scoreboard is on the same side of the device as in English, the
   board is the same picture, the pause button and the exit control are where a
   returning player expects them.
5. Names: an Arabic name and a Latin name on the same HUD, and both in the
   result and tournament sentences, read correctly and neither is reversed.
6. Digits: every score, clock and countdown shows Western digits.
7. Prose pages: lists indent from the right; tables align their cells to the
   start; the DMCA placeholder's accent border is on the right.
8. Nothing scrolls sideways at 320px, and the skip link, when focused, appears
   at the top right.
9. Arrows: any `back`/`forward` glyph a route has grown since this was written
   points towards the start and the end of the line respectively.

## What is open

- `<bdi>` around player names in `MatchOverlay.tsx`, `TournamentTrack.tsx` and
  `MatchHud.tsx`, and `dir="auto"` on the name inputs in `SettingsPanel.tsx`.
- Switching `e2e/rtl.spec.ts` from the init script to `?lang=ar-XB` once the
  registry lands.
- Overlays drawn over the board — pause, result, hand-off, the exit confirmation
  — inherit the island's `ltr` and so lay their Arabic copy out left-to-right. A
  translated build should decide whether those panels want
  `unicode-bidi: plaintext` on their text; the boards under them do not move
  either way.
