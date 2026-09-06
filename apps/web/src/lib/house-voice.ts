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
 */
export const AMERICAN: ReadonlyArray<readonly [string, string]> = [
  ['color', 'colour'],
  ['colors', 'colours'],
  ['colored', 'coloured'],
  ['coloring', 'colouring'],
  ['center', 'centre'],
  ['centers', 'centres'],
  ['centered', 'centred'],
  ['gray', 'grey'],
  ['defense', 'defence'],
  ['offense', 'offence'],
  ['favorite', 'favourite'],
  ['neighbor', 'neighbour'],
  ['armor', 'armour'],
  ['meter', 'metre'],
  ['meters', 'metres'],
  ['maneuver', 'manoeuvre'],
  ['traveled', 'travelled'],
  ['traveling', 'travelling'],
  ['canceled', 'cancelled'],
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
