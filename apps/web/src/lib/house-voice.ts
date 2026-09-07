/**
 * The two tables that say how this product's prose is allowed to read.
 *
 * They were written for the catalogue rules and then copied, shorter, into the guard over
 * the category hub copy — thirteen spellings against twenty and eleven instruments against
 * fourteen, so "the colored tiles" or "a touchscreen" passed on a hub and failed on a rule,
 * while `categories.test.ts` claimed in its own docstring to hold hubs "to the same shape".
 * A guard that is weaker than it says it is is worse than one that is honestly narrow,
 * because the docstring is what the next author reads instead of the table.
 *
 * So there is one table each and both tests import them. Nothing in the app does: this
 * module is imported only by `data/catalogue-voice.test.ts` and `lib/categories.test.ts`,
 * so it reaches no bundle. Adding a word here tightens both guards at once, which is the
 * point — the next surface that carries house prose should import these too rather than
 * grow a third copy.
 */

/**
 * Spellings this shell does not use, with what it uses instead.
 *
 * Matched case-insensitively on a word boundary, so "Colors" is caught along with "colors"
 * and "watercolour" is not caught at all.
 *
 * **A word boundary and nothing more, which means every inflection has to be its own row.**
 * `colors` and `centers` were listed and `favorites`, `grays`, `neighbors`, `defenses` and
 * `armored` were not, so the table caught the singular of five words and passed the plural —
 * on all three surfaces that read it. `favorites` is the one that mattered: this product's
 * own store, its star and its settings page are all called favourites, so it is the American
 * spelling most likely to be typed here and the only one the guard could not see.
 *
 * Found by putting `favorites` into the landing copy on purpose and watching the check stay
 * green (#102), which is the only way a gap of this shape is ever found — a guard nobody has
 * seen fail is a guard nobody has seen. Measured before it was widened: not one of the 108
 * catalogue rules, none of the 18 hub blurbs and nothing on the landing page uses any of the
 * rows added below, so widening it fixed no existing copy. It is the next one it catches.
 *
 * The same widening then made the mirror-image mistake in one row: `travelers` was added and
 * `traveler` was not, so "one traveler each" passed everywhere "two travelers" failed. That
 * is the defect above with the number the other way round, in the paragraph that had just
 * described it. `house-voice.test.ts` now holds the shape rather than the words: a plural
 * whose British spelling is also a plural implies a singular that differs, and the singular
 * has to be its own row. It cannot see a missing `-ed` or `-ing` — "travelled" is not
 * "travel" plus a suffix in either dialect — so those stay a matter of adding the whole
 * family when a word is added at all.
 *
 * A stemmer would be the other answer and is deliberately not taken: it would have to know
 * that `defensive` and `offensive` are spelled the same either side of the Atlantic, and a
 * guard that fires on correct English is a guard somebody turns off.
 */
export const AMERICAN: ReadonlyArray<readonly [string, string]> = [
  ['color', 'colour'],
  ['colors', 'colours'],
  ['colored', 'coloured'],
  ['coloring', 'colouring'],
  ['colorful', 'colourful'],
  ['colorfully', 'colourfully'],
  ['center', 'centre'],
  ['centers', 'centres'],
  ['centered', 'centred'],
  ['centering', 'centring'],
  ['gray', 'grey'],
  ['grays', 'greys'],
  ['grayed', 'greyed'],
  ['defense', 'defence'],
  ['defenses', 'defences'],
  ['offense', 'offence'],
  ['offenses', 'offences'],
  ['favorite', 'favourite'],
  ['favorites', 'favourites'],
  ['neighbor', 'neighbour'],
  ['neighbors', 'neighbours'],
  ['neighboring', 'neighbouring'],
  ['armor', 'armour'],
  ['armors', 'armours'],
  ['armored', 'armoured'],
  ['armoring', 'armouring'],
  ['meter', 'metre'],
  ['meters', 'metres'],
  ['maneuver', 'manoeuvre'],
  ['maneuvers', 'manoeuvres'],
  ['maneuvering', 'manoeuvring'],
  ['traveled', 'travelled'],
  ['traveling', 'travelling'],
  ['traveler', 'traveller'],
  ['travelers', 'travellers'],
  ['canceled', 'cancelled'],
  ['canceling', 'cancelling'],
  ['jewelry', 'jewellery'],
];

/**
 * Instruments no game in this collection has, and therefore no copy may promise.
 *
 * Every one of the manifest `controls` strings was checked when this table was written: not
 * one names a stick, a pad, a gamepad, a mouse or a swipe, because DuelBox is two people on
 * one device with a keyboard and a finger. Copy naming one is describing a different
 * product — which is exactly how the catalogue acquired forty-seven of them before anybody
 * counted.
 *
 * Patterns rather than bare words, because English gets in the way of both halves of this:
 * a knife "sticks" in the wood and nobody has offered anybody a controller, so only the
 * qualified forms count as naming one.
 */
export const NEVER: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bjoy[\s-]?sticks?\b/i, 'joystick'],
  [/\b(?:left|right|analogue?|control|thumb)[\s-]?sticks?\b/i, 'a named stick'],
  [/\b(?:the|a|your|their)\s+sticks?\b/i, 'the stick'],
  [/\bd[\s-]?pads?\b/i, 'd-pad'],
  [/\bgame[\s-]?pads?\b/i, 'gamepad'],
  [/\bcontrollers?\b/i, 'a controller'],
  [/\bmouse\b/i, 'a mouse'],
  [/\bclick(?:s|ed|ing)?\b/i, 'a click'],
  [/\bswipe(?:s|d|ing)?\b/i, 'a swipe'],
  [/\bpinch(?:es|ed|ing)?\b/i, 'a pinch'],
  [/\btilt(?:s|ed|ing)?\b/i, 'a tilt'],
  [/\btrack[\s-]?pads?\b/i, 'a trackpad'],
  [/\btouch[\s-]?screens?\b/i, 'a touchscreen'],
  [/\btriggers?\b/i, 'a trigger'],
];
