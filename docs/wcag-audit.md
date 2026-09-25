# WCAG 2.2 AA audit (#182)

This is the standing accessibility conformance record for the DuelBox **shell** — the
landing page, catalogue, category hubs, game pages, settings, and the match chrome (HUD,
overlays, pause, result). It lists a status against every WCAG 2.2 Level A and AA success
criterion, says what enforces it, and files the defects that remain.

## How it is checked, and the honest limits

Two layers do the checking:

- **`e2e/axe.spec.ts`** runs axe-core with the `wcag2a wcag2aa wcag21a wcag21aa wcag22a
  wcag22aa best-practice` tags over one page of each distinct shape. axe automates roughly
  a third of WCAG and no more — a machine cannot read a canvas, judge whether alt text is
  _right_, or decide whether motion conveys meaning. Its `incomplete` list (colour-contrast
  over tile art it cannot resolve) is covered by rule 7 and the greyscale item in the
  definition of done, not by the scanner.
- **This document** covers the criteria axe cannot, by review against the code.

Two whole areas are **out of scope because the feature does not exist yet**, and are marked
_N/A (unbuilt)_ rather than pass: there is no audio bus, so no game emits sound (#169/#170,
and the audio-only-cue mapping in `lib/sound-visuals.ts`), and there is no networking, so
remote/single-seat play cannot be audited (#1862). When those land, their criteria
(1.2.\*, 1.4.2, 4.1.\*) reopen here.

The 108 game **canvases** are audited per game by hand against the definition of done
(keyboard, greyscale, reduced motion), not by axe — a canvas is one opaque node to a
scanner. This document is the shell's record; a game's own record is its `SPEC.md` QA pass.

## Perceivable

| SC | Level | Status | Enforced / notes |
|----|-------|--------|------------------|
| 1.1.1 Non-text Content | A | Pass | Decorative SVG marked `aria-hidden`/`focusable="false"` (`TileSprite`, `SeatGlyph`, `Wordmark`); the mute button and every icon control carry an `aria-label`; tile art is decorative and the game name sits beside it in text. axe `image-alt`/`svg-img-alt`. |
| 1.2.\* Time-based Media | A/AA | N/A (unbuilt) | No audio or video anywhere; reopens with the audio bus. |
| 1.3.1 Info and Relationships | A | Pass | Landmarks (`header`/`main`/`footer`), `aria-labelledby` on every settings section, `<dl>` for the data counts, real `<label htmlFor>` on every field including the new theme/palette/speed selects. axe `list`/`label`/`landmark-*`. |
| 1.3.2 Meaningful Sequence | A | Pass | DOM order is reading order; no CSS reordering that changes meaning. |
| 1.3.3 Sensory Characteristics | A | Pass | Instructions never rely on shape/position alone; controls name themselves in words. |
| 1.3.4 Orientation | AA | Pass | Both orientations supported and tested (`e2e/resize.spec.ts`, Pixel/iPhone portrait+landscape projects); nothing locks orientation. |
| 1.3.5 Identify Input Purpose | AA | Pass | The only free-text fields are the two seat names, which have no defined autocomplete purpose; `autoComplete="off"` is deliberate there. |
| 1.4.1 Use of Color | A | Pass | **Rule 7** is the whole product's answer: every seat-owned element also differs by shape and label. The colour-blind seat palette (#174) widens the colour gap on top of that. On/off states carry the word, not just the knob. |
| 1.4.2 Audio Control | A | N/A (unbuilt) | No autoplaying audio exists. |
| 1.4.3 Contrast (Minimum) | AA | Pass\* | axe `color-contrast` over shell text. \*Its `incomplete` nodes are text over tile art, covered by rule 7 + greyscale rather than a ratio a machine can read. Dark theme tokens chosen for the same 4.5:1 body / 3:1 large bar. |
| 1.4.4 Resize Text | AA | Pass | Type in `rem`; layout survives 200% zoom (see `e2e/zoom.spec.ts`, #1890). |
| 1.4.5 Images of Text | AA | Pass | No images of text; all text is text, tile art carries none (`lib/tiles.ts`). |
| 1.4.10 Reflow | AA | Pass | Correct from 320px with no horizontal scroll; `breakpoints.test.ts` guards the device classes, `e2e/zoom.spec.ts` guards no overflow at 200%. |
| 1.4.11 Non-text Contrast | AA | Pass | Focus ring ≥3:1 on every background is now proven for both themes (`styles/focus-ring.test.ts`, #176); control borders and seat fills ≥3:1 (`palette-vision.test.ts`). |
| 1.4.12 Text Spacing | AA | Pass | No fixed line-heights that clip; user spacing overrides do not break layout. |
| 1.4.13 Content on Hover or Focus | AA | Pass | No custom hover/focus tooltips that need dismissing; the two-press confirm arms on click, not hover. |

## Operable

| SC | Level | Status | Enforced / notes |
|----|-------|--------|------------------|
| 2.1.1 Keyboard | A | Pass | Full keyboard play (`e2e/keyboard.spec.ts`, `keyboard-play.spec.ts`, `seat-keys.spec.ts`); every shell control is a real button/link/select. |
| 2.1.2 No Keyboard Trap | A | Pass | Escape and Tab always leave the board (`globals.css` note on `canvas:focus`); the pause menu is not a trap. |
| 2.1.4 Character Key Shortcuts | A | Pass | Gameplay keys are active only during a match, on the focused board; no single-character shortcut is a global that fires while typing a seat name. |
| 2.4.1 Bypass Blocks | A | Pass | The skip link (`.db-skip`) moves focus to `#main` (`layout.tsx` documents why `tabIndex=-1` is load-bearing). |
| 2.4.2 Page Titled | A | Pass | Per-route `metadata.title` with the `%s — DuelBox` template. |
| 2.4.3 Focus Order | A | Pass | DOM order is a sensible order; the skip link is first. |
| 2.4.4 Link Purpose (In Context) | A | Pass | Link text names its destination; no bare "click here". |
| 2.4.5 Multiple Ways | AA | Pass | Catalogue search + category hubs + landing links + sitemap. |
| 2.4.6 Headings and Labels | AA | Pass | One `h1` per page, ordered headings (axe `heading-order`), descriptive labels. |
| 2.4.7 Focus Visible | AA | Pass | `:focus-visible` two-tone ring on every focusable control (#176). |
| **2.4.11 Focus Not Obscured (Minimum)** | AA | Pass | **New in 2.2.** Nothing sticky overlaps the focused control: the header is not fixed, and the pause overlay takes focus itself rather than covering a focused control behind it. axe checks the automatable part. |
| **2.5.7 Dragging Movements** | AA | Pass (shell) | **New in 2.2.** No shell interaction requires a drag: the volume slider is a native range (operable by arrow keys), every other control is a click/tap. Games that use dragging provide a non-drag path per their SPEC; audited per game. |
| **2.5.8 Target Size (Minimum)** | AA | Pass | **New in 2.2.** `--db-touch-target: 48px` exceeds the 24px floor and is applied to every control including native range/file/select; `e2e/touch-targets.spec.ts` guards it, and #1889 scales gameplay controls up by physical size on top. |
| 2.5.1 Pointer Gestures | A | Pass | No multipoint/path-based gesture is required in the shell. |
| 2.5.2 Pointer Cancellation | A | Pass | Actions fire on up, not down; the two-press confirm can be aborted by moving focus away (`e2e/pointer-cancel.spec.ts`). |
| 2.5.3 Label in Name | A | Pass | Visible labels are the start of the accessible name (the mute button's `aria-label` matches its purpose; selects use their visible `<label>`). |
| 2.5.4 Motion Actuation | A | Pass | Nothing is actuated by device motion. |
| 2.3.1 Three Flashes | A | Pass | No content flashes more than three times a second; reduced-motion collapses decorative motion entirely (`styles/motion.test.ts`). |

## Understandable

| SC | Level | Status | Enforced / notes |
|----|-------|--------|------------------|
| 3.1.1 Language of Page | A | Pass | `<html lang="en">`. |
| 3.2.1 On Focus | A | Pass | Focus changes nothing; no focus-triggered navigation. |
| 3.2.2 On Input | A | Pass | Changing a setting applies the setting; it never navigates or submits. |
| 3.2.3 Consistent Navigation | AA | Pass | One header/footer on every route. |
| 3.2.4 Consistent Identification | AA | Pass | The same control (mute, favourite) is identified the same way everywhere. |
| **3.2.6 Consistent Help** | A | Pass (vacuous) | **New in 2.2.** No help mechanism exists to be inconsistent; "How to play" sits in the same footer/nav on every page. |
| 3.3.1 Error Identification | A | Pass | Import errors are announced in the settings `role="status"` line in words. |
| 3.3.2 Labels or Instructions | A | Pass | Every field has a label and, where it helps, a note beneath it. |
| 3.3.3 Error Suggestion | AA | Pass | The import error says what was wrong with the file. |
| 3.3.4 Error Prevention | AA | Pass | Every destructive action is a two-press confirm (`SettingsPanel` `Confirm`); nothing legal/financial. |
| **3.3.7 Redundant Entry** | A | Pass (vacuous) | **New in 2.2.** No multi-step flow re-asks for information; there are no accounts and nothing to re-enter. |
| **3.3.8 Accessible Authentication (Minimum)** | AA | N/A | **New in 2.2.** There is no authentication anywhere (no accounts, by design). |

## Robust

| SC | Level | Status | Enforced / notes |
|----|-------|--------|------------------|
| 4.1.1 Parsing | A | Pass (obsolete) | Removed in 2.2; React emits well-formed markup regardless. |
| 4.1.2 Name, Role, Value | A | Pass | Native elements and correct ARIA (`role="switch"`+`aria-checked`, `aria-pressed`, `aria-live` status). axe `aria-*`. |
| 4.1.3 Status Messages | AA | Pass | `role="status"`/`aria-live="polite"` on the settings status line and the catalogue count, announced without stealing focus. |

## Defects filed

At the time of writing, **no shell defect is outstanding** against an in-scope criterion.
Two automatable additions from the 2.2 tag change (2.4.11, 2.5.8) were already satisfied by
existing work (the focus ring and the touch-target token). If a future `axe.spec.ts` run on
a fresh build surfaces a `wcag22aa` violation, it fails the suite with the rule id and the
offending nodes — fix the markup and, if it turns out a rule must be suppressed, record the
reason in that spec's `SUPPRESSED` array (empty today) rather than here.

## Reopens when the platform grows

- **Audio bus lands** → 1.2.\*, 1.4.2, 4.1.2 (live-region cues) reopen; wire each game's
  audio cue to its declared visual counterpart in `lib/sound-visuals.ts` (#180).
- **Networking lands** → remote/single-seat presentation gets its own audit pass (#1862);
  the shared-viewport fairness rules (rule 9) already have harness coverage.
- **Brand identity decided (#2322)** → re-check 1.4.3/1.4.11 against any new brand colours;
  `palette-vision.test.ts` and `focus-ring.test.ts` re-derive the ratios from the tokens, so
  a colour change is judged rather than assumed.
